# services/server_service.py

import json
from datetime import timedelta
from flask import current_app
from extensions import db, socketio
from models import Server, Log
from utils import generate_alert
from services.blockchain_service import create_blockchain_record
from utils import current_time as now_baghdad
from supabase_config import get_supabase_client
import requests

def get_heartbeat_tolerance() -> timedelta:
    """Return heartbeat tolerance from config (in seconds)."""
    secs = current_app.config.get("SERVER_HEARTBEAT_TOLERANCE_SEC", 30)
    return timedelta(seconds=secs)

def register_server(name: str, address: str, ports, user_id: int) -> Server:
    """Register a new server and persist its port list."""
    now = now_baghdad()
    srv = Server(
        name=name,
        address=address,
        ports=json.dumps(ports),
        last_heartbeat=now,
        is_active=True,
        created_by=user_id,
        created_at=now
    )
    db.session.add(srv)
    db.session.commit()

    # Audit log
    log = Log(
        action="server_registered",
        user_id=user_id,
        details=json.dumps({"server_id": srv.id, "ports": ports}),
        timestamp=now
    )
    db.session.add(log)
    db.session.commit()

    # Blockchain
    create_blockchain_record("server_registered",
                             {"server_id": srv.id, "ports": ports},
                             user_id)

    # Real-time notification
    socketio.emit("server_registered", srv.to_dict(), namespace="/servers")
    return srv

# --- High Availability (HA) logic ---
def get_primary_server() -> Server:
    return Server.query.filter_by(role="primary").filter(
        Server.is_online == True
    ).first()
def get_secondary_server() -> Server:
    return Server.query.filter_by(role="secondary").first()
def promote_secondary():
    sec = get_secondary_server()
    if sec:
        sec.role = "primary"
        sec.set_online()
        db.session.commit()
        socketio.emit("ha_failover", {"server_id": sec.id, "role": "primary"}, namespace="/servers")
def demote_primary():
    prim = get_primary_server()
    if prim:
        prim.role = "secondary"
        prim.set_offline()
        db.session.commit()
        socketio.emit("ha_demote", {"server_id": prim.id, "role": "secondary"}, namespace="/servers")

def update_heartbeat(server_id: int) -> None:
    """Update the heartbeat timestamp to indicate the server is alive."""
    srv = Server.query.get(server_id)
    if not srv:
        return
    
    # تحديث حالة الخادم كمتصل
    srv.set_online()
    db.session.commit()
    
    # إذا كان هذا الخادم احتياطي وكان الرئيسي غير نشط، فعّله كرئيسي
    if srv.role == "secondary":
        prim = get_primary_server()
        if not prim or not prim.is_online:
            promote_secondary()
    socketio.emit("server_heartbeat", {
        "server_id": server_id,
        "timestamp": srv.last_heartbeat.isoformat()
    }, namespace="/servers")

def list_servers():
    """Return all servers with their status (active/inactive)."""
    servers = Server.query.order_by(Server.created_at.desc()).all()
    return [s.to_dict() for s in servers]

def get_active_servers():
    """Return servers with a recent heartbeat within tolerance."""
    cutoff = now_baghdad() - get_heartbeat_tolerance()
    active = Server.query.filter(
        Server.last_heartbeat >= cutoff,
        Server.is_online == True
    ).all()
    return [s.to_dict() for s in active]

def cleanup_inactive_servers():
    """
    Mark servers inactive if they missed heartbeat beyond tolerance.
    Returns list of IDs that were marked inactive.
    Implements HA failover: إذا كان الرئيسي غير نشط، فعّل الاحتياطي.
    """
    cutoff = now_baghdad() - get_heartbeat_tolerance()
    stale = Server.query.filter(
        Server.last_heartbeat < cutoff,
        Server.is_online == True
    ).all()
    ids = []
    for srv in stale:
        # تحديث حالة الخادم كغير متصل
        srv.set_offline()
        db.session.commit()
        ids.append(srv.id)
        now = now_baghdad()
        log = Log(
            action="server_inactive",
            details=json.dumps({"server_id": srv.id}),
            timestamp=now
        )
        db.session.add(log)
        db.session.commit()
        create_blockchain_record("server_inactive", {"server_id": srv.id}, None)
        generate_alert(f"Server inactive: {srv.name}", "high", {"server_id": srv.id})
        socketio.emit("server_inactive", {"server_id": srv.id}, namespace="/servers")
    # منطق HA: إذا كان الرئيسي غير نشط، فعّل الاحتياطي
    prim = get_primary_server()
    if not prim or not prim.is_online:
        promote_secondary()
    return ids

def update_server_ports(server_id: int, new_ports, user_id: int) -> Server:
    """Update a server’s port list."""
    srv = Server.query.get_or_404(server_id)
    old = json.loads(srv.ports)
    srv.ports = json.dumps(new_ports)
    db.session.commit()

    now = now_baghdad()
    log = Log(
        action="server_ports_updated",
        user_id=user_id,
        details=json.dumps({"server_id": server_id, "old": old, "new": new_ports}),
        timestamp=now
    )
    db.session.add(log)
    db.session.commit()

    create_blockchain_record("server_ports_updated",
                             {"server_id": server_id, "new": new_ports},
                             user_id)

    socketio.emit("server_ports_updated",
                  {"server_id": server_id, "ports": new_ports},
                  namespace="/servers")
    return srv

def apply_sync_data(sync_data: dict):
    """
    تُطبق بيانات المزامنة (من الخادم الرئيسي) على قاعدة البيانات المحلية:
    - تحديث أو إدراج السياسات
    - تحديث أو إدراج الأجهزة
    - تحديث أو إدراج السجلات
    - تحديث أو إدراج البلوكشين
    - تحديث بيانات الخادم نفسه
    """
    from models import Policy, Device, Log, BlockchainLog, Server
    from sqlalchemy.exc import IntegrityError
    import logging
    logger = logging.getLogger("server_sync")

    # سياسات
    for p in sync_data.get('policies', []):
        obj = Policy.query.get(p['id'])
        if obj:
            for k, v in p.items():
                if k != 'id':
                    setattr(obj, k, v)
        else:
            try:
                db.session.add(Policy(**p))
            except Exception as e:
                logger.error(f"Policy insert error: {e}")
    # أجهزة
    for d in sync_data.get('devices', []):
        obj = Device.query.get(d['id'])
        if obj:
            for k, v in d.items():
                if k != 'id':
                    setattr(obj, k, v)
        else:
            try:
                db.session.add(Device(**d))
            except Exception as e:
                logger.error(f"Device insert error: {e}")
    # سجلات
    for l in sync_data.get('logs', []):
        obj = Log.query.get(l['id'])
        if obj:
            for k, v in l.items():
                if k != 'id':
                    setattr(obj, k, v)
        else:
            try:
                db.session.add(Log(**l))
            except Exception as e:
                logger.error(f"Log insert error: {e}")
    # بلوكشين
    try:
        supabase_client = get_supabase_client()
        if supabase_client:
            for b in sync_data.get('blockchain', []):
                try:
                    # Check if record exists
                    existing_response = supabase_client.table('blockchain_logs').select('id').eq('id', b['id']).execute()
                    if existing_response.data:
                        # Update existing record
                        update_data = {k: v for k, v in b.items() if k != 'id'}
                        supabase_client.table('blockchain_logs').update(update_data).eq('id', b['id']).execute()
                    else:
                        # Insert new record
                        supabase_client.table('blockchain_logs').insert(b).execute()
                except Exception as e:
                    logger.error(f"Blockchain sync error for record {b.get('id', 'unknown')}: {e}")
        else:
            logger.warning("Supabase client not available for blockchain sync")
    except Exception as e:
        logger.error(f"Error in blockchain sync: {e}")
    # بيانات الخادم نفسه
    s = sync_data.get('server')
    if s:
        obj = Server.query.get(s['id'])
        if obj:
            for k, v in s.items():
                if k != 'id':
                    setattr(obj, k, v)
        else:
            try:
                db.session.add(Server(**s))
            except Exception as e:
                logger.error(f"Server insert error: {e}")
    try:
        db.session.commit()
    except IntegrityError as e:
        db.session.rollback()
        logger.error(f"DB commit error: {e}")

def sync_with_primary_server(primary_url: str, api_key: str, last_sync: str = None):
    """
    تستدعي /servers/sync من الخادم الرئيسي وتطبق البيانات باستخدام apply_sync_data.
    primary_url: عنوان الخادم الرئيسي (مثال: http://192.168.1.10:5000)
    api_key: مفتاح API للخادم الاحتياطي
    last_sync: آخر وقت مزامنة (ISO8601) (اختياري)
    """
    import logging
    logger = logging.getLogger("server_sync")
    payload = {
        'server_id': None,  # يمكن ملؤها لاحقاً إذا لزم
        'api_key': api_key
    }
    if last_sync:
        payload['last_sync'] = last_sync
    try:
        url = primary_url.rstrip('/') + '/api/servers/sync'
        resp = requests.post(url, json=payload, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            apply_sync_data(data)
            logger.info(f"Sync with primary server succeeded at {primary_url}")
            # بث socket.io عند نجاح المزامنة
            try:
                from extensions import socketio
                socketio.emit('secondary_sync_success', {
                    'primary_url': primary_url,
                    'sync_time': data.get('sync_time'),
                    'server_id': data.get('server_id')
                }, namespace='/servers')
            except Exception as e:
                logger.error(f"SocketIO emit error: {e}")
            return True
        else:
            logger.error(f"Sync failed: {resp.status_code} {resp.text}")
            return False
    except Exception as e:
        logger.error(f"Exception during sync: {e}")
        return False

