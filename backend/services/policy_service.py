# services/policy_service.py

import json
import requests
from datetime import datetime, timezone, timedelta
from flask import current_app
from extensions import db, socketio
from models import Policy, Device, Log
from utils import generate_alert
from services.blockchain_service import create_blockchain_record
from utils import current_time as now_baghdad
from supabase_config import get_supabase_client

def create_policy(data: dict, creator_id: int) -> Policy:
    """Create a new policy, log, alert, and blockchain-record it."""
    p = Policy(
        name=data['name'],
        description=data.get('description', ''),
        policy_type=data['policy_type'],
        device_pattern=data['device_pattern'],
        is_active=data.get('is_active', True),
        created_by=creator_id,
        created_at=now_baghdad()
    )
    if isinstance(data.get('rules'), dict):
        p.rules = json.dumps(data['rules'])
    db.session.add(p)
    db.session.commit()

    # Log activity
    db.session.add(Log(
        action='policy_created',
        user_id=creator_id,
        details=json.dumps({'policy_id': p.id, 'name': p.name}),
        timestamp=now_baghdad()
    ))
    db.session.commit()

    # Blockchain record
    create_blockchain_record(
        'policy_created',
        {'policy_id': p.id, 'user_id': creator_id},
        creator_id
    )

    # Alert
    generate_alert(f"Policy created: {p.name}", 'normal', {'policy_id': p.id})

    # Emit via SocketIO
    try:
        socketio.emit("policy_created", p.to_dict(), namespace="/policies", broadcast=True)
    except Exception:
        current_app.logger.exception("SocketIO emit failed for policy_created")

    return p


def list_policies(policy_type: str = None, active: bool = None):
    """Fetch policies with optional filters, return list of dicts."""
    q = Policy.query
    if policy_type:
        q = q.filter_by(policy_type=policy_type)
    if active is not None:
        q = q.filter_by(is_active=active)
    return [p.to_dict() for p in q.all()]


def get_policy(policy_id: int):
    """Retrieve a single policy by ID."""
    return Policy.query.get(policy_id)


def update_policy(policy: Policy, updates: dict, user_id: int) -> Policy:
    """Update fields on a policy, then log, alert, blockchain-record."""
    changed = []
    for fld in ('name', 'description', 'policy_type', 'device_pattern', 'is_active'):
        if fld in updates:
            setattr(policy, fld, updates[fld])
            changed.append(fld)
    if isinstance(updates.get('rules'), dict):
        policy.rules = json.dumps(updates['rules'])
        changed.append('rules')
    policy.modified_at = now_baghdad()
    db.session.commit()

    # Log activity
    db.session.add(Log(
        action='policy_updated',
        user_id=user_id,
        details=json.dumps({'policy_id': policy.id, 'updated_fields': changed}),
        timestamp=now_baghdad()
    ))
    db.session.commit()

    # Blockchain record
    create_blockchain_record(
        'policy_updated',
        {'policy_id': policy.id, 'updated_fields': changed, 'user_id': user_id},
        user_id
    )

    # Alert
    generate_alert(f"Policy updated: {policy.name}", 'normal', {'policy_id': policy.id, 'changes': changed})

    # Emit via SocketIO
    try:
        socketio.emit("policy_updated", {'id': policy.id, 'updated_fields': changed},
                      namespace="/policies", broadcast=True)
    except Exception:
        current_app.logger.exception("SocketIO emit failed for policy_updated")

    return policy


def delete_policy(policy: Policy, user_id: int) -> None:
    """Delete a policy, then log, alert, blockchain-record."""
    name = policy.name
    pid = policy.id
    db.session.delete(policy)
    db.session.commit()

    # Log activity
    db.session.add(Log(
        action='policy_deleted',
        user_id=user_id,
        details=json.dumps({'policy_id': pid, 'name': name}),
        timestamp=now_baghdad()
    ))
    db.session.commit()

    # Blockchain record
    create_blockchain_record(
        'policy_deleted',
        {'policy_id': pid, 'user_id': user_id},
        user_id
    )

    # Alert
    generate_alert(f"Policy deleted: {name}", 'normal', {'policy_id': pid})

    # Emit via SocketIO
    try:
        socketio.emit("policy_deleted", {'id': pid}, namespace="/policies", broadcast=True)
    except Exception:
        current_app.logger.exception("SocketIO emit failed for policy_deleted")


def apply_policy(policy: Policy, user_id: int):
    """
    Apply a policy by matching device_pattern against:
      - vendor_id, product_id, manufacturer, product columns
      - meta_data JSON fields via "meta.<key>=<value>" syntax
    Returns list of affected device dicts.
    """
    try:
        supabase_client = get_supabase_client()
        if not supabase_client:
            current_app.logger.error("Supabase client not available")
            return []
            
        patt = policy.device_pattern
        devices = []

        if patt.startswith('meta.'):
            # pattern: "meta.key=value"
            try:
                _, rest = patt.split('.', 1)
                key, val = rest.split('=', 1)
            except ValueError:
                current_app.logger.error(f"Invalid meta pattern: {patt}")
                return []
            
            # Get all devices and filter by meta_data
            response = supabase_client.table('devices').select('*').execute()
            all_devices = response.data if response.data else []
            
            for d in all_devices:
                try:
                    meta = json.loads(d.get('meta_data', '{}'))
                    if str(meta.get(key, '')).lower() == val.lower():
                        devices.append(d)
                except Exception:
                    continue
        else:
            # pattern: "field:value"
            try:
                field, val = patt.split(':', 1)
            except ValueError:
                current_app.logger.error(f"Invalid pattern: {patt}")
                return []
            
            # Build Supabase query
            query = supabase_client.table('devices').select('*')
            if field in ['vendor_id', 'product_id', 'manufacturer', 'product']:
                query = query.ilike(field, f"%{val}%")
            else:
                current_app.logger.error(f"Unknown field in pattern: {field}")
                return []
            
            response = query.execute()
            devices = response.data if response.data else []

        affected = []
        for d in devices:
            device_id = d['id']
            update_data = {}
            
            if policy.policy_type == 'whitelist':
                update_data = {'whitelisted': True, 'blacklisted': False}
            else:
                update_data = {'blacklisted': True, 'whitelisted': False}
            
            # Update device in Supabase
            supabase_client.table('devices').update(update_data).eq('id', device_id).execute()
            affected.append(d)

        # Log activity to Supabase
        log_data = {
            'action': 'policy_applied',
            'user_id': user_id,
            'details': json.dumps({'policy_id': policy.id, 'affected_count': len(affected)}),
            'timestamp': now_baghdad().isoformat()
        }
        supabase_client.table('logs').insert(log_data).execute()

        # Blockchain record
        create_blockchain_record(
            'policy_applied',
            {'policy_id': policy.id, 'affected': len(affected), 'user_id': user_id},
            user_id
        )

        return affected
        
    except Exception as e:
        current_app.logger.error(f"Error applying policy: {e}")
        return []

    # Alert
    generate_alert(f"Policy applied: {policy.name} to {len(affected)} devices", 'normal', {'policy_id': policy.id})

    # Emit via SocketIO
    try:
        socketio.emit("policy_applied",
                      {'policy_id': policy.id, 'affected': affected},
                      namespace="/policies", broadcast=True)
    except Exception:
        current_app.logger.exception("SocketIO emit failed for policy_applied")

    return affected


def sync_policies_to_agents():
    """
    Push current whitelist/blacklist to all configured client agents.
    Hit each CLIENT_SERVERS URL at '/api/policies/sync' with JSON payload:
      { whitelist, blacklist, timestamp }
    """
    agents = current_app.config.get('CLIENT_SERVERS', [])
    if not agents:
        current_app.logger.info("No client agents configured for policy sync")
        return

    # gather global lists
    whitelist = [d.serial_number for d in Device.query.filter_by(whitelisted=True).all()]
    blacklist = [d.serial_number for d in Device.query.filter_by(blacklisted=True).all()]
    payload = {
        'whitelist': whitelist,
        'blacklist': blacklist,
        'timestamp': now_baghdad().isoformat()
    }

    for base_url in agents:
        url = base_url.rstrip('/') + '/api/policies/sync'
        try:
            resp = requests.post(url, json=payload, timeout=5)
            if resp.status_code != 200:
                current_app.logger.error(f"Policy sync to {url} failed: {resp.status_code}")
        except Exception as e:
            current_app.logger.error(f"Policy sync to {url} error: {e}")

