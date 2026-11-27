# controllers/policies.py

import json
import jwt
from datetime import datetime
from flask import Blueprint, request, jsonify, current_app, make_response

from extensions import db, socketio
from models import Device, Policy, Log
from utils import generate_alert
from services.blockchain_service import create_blockchain_record
from supabase_config import get_supabase_client

policies_bp = Blueprint('policies', __name__)

def verify_token():
    """تحقق من صلاحيّة الـ JWT واستخرج user_id."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None, "Missing or invalid Authorization header"
    
    token = auth[7:]
    try:
        payload = jwt.decode(token, current_app.config["JWT_SECRET_KEY"], algorithms=["HS256"])
        return payload.get("sub"), None
    except jwt.ExpiredSignatureError:
        return None, "Token expired"
    except jwt.InvalidTokenError:
        return None, "Invalid token"

def schedule_policy_job(policy_id: int, cron_expr: dict, action: str):
    """
    جدولة مهمة لتفعيل/إلغاء تفعيل سياسة تلقائياً.
    - cron_expr: dict بصيغة CronTrigger من APScheduler.
    - action: 'activate' أو 'deactivate'.
    """
    job_id = f"policy_{policy_id}_{action}"
    scheduler = current_app.scheduler  # app.scheduler must be set in create_app

    # remove existing
    try:
        scheduler.remove_job(job_id)
    except Exception:
        pass

    def job_func():
        with current_app.app_context():
            try:
                client = get_supabase_client()
                if not client:
                    current_app.logger.error("Supabase client not available for scheduled policy job")
                    return
                    
                # الحصول على السياسة من Supabase
                response = client.table('policies').select('*').eq('id', policy_id).execute()
                policy = response.data[0] if response.data else None
                
                if not policy:
                    current_app.logger.error(f"Policy {policy_id} not found for scheduled job")
                    return
                    
                # تحديث حالة السياسة
                update_data = {
                    'active': (action == "activate"),
                    'updated_at': datetime.utcnow().isoformat()
                }
                
                client.table('policies').update(update_data).eq('id', policy_id).execute()
                
                # تسجيل العملية في السجلات
                act = "policy_activated" if action == "activate" else "policy_deactivated"
                log_data = {
                    "action": act,
                    "user_id": None,
                    "details": json.dumps({"policy_id": policy_id, "auto": True}),
                    "timestamp": datetime.utcnow().isoformat()
                }
                try:
                    from utils import safe_insert
                    safe_insert(client, 'logs', log_data)
                except Exception:
                    client.table('logs').insert(log_data).execute()
                
                generate_alert(f"السياسة «{policy.get('name', 'Unknown')}» تم {action} تلقائياً", "normal")
                
                # إرسال إشعار عبر socket
                socketio.emit(
                    f"policy:{action}d",
                    policy,
                    namespace="/api/policies",
                    broadcast=True
                )
                
            except Exception as e:
                current_app.logger.error(f"Error in scheduled policy job for policy {policy_id}: {e}")

    scheduler.add_job(
        func=job_func,
        trigger="cron",
        id=job_id,
        replace_existing=True,
        **cron_expr
    )


# ----- Whitelist/Blacklist Endpoints -----

@policies_bp.route("/whitelist", methods=["OPTIONS", "POST"])
def add_to_whitelist():
    if request.method == "OPTIONS":
        return make_response('', 204)

    user_id, error = verify_token()
    if error:
        return jsonify(error=error), 401

    data = request.get_json() or {}
    serial = data.get("serial_number")
    if not serial:
        return jsonify(error="serial_number is required"), 400

    try:
        client = get_supabase_client()
        if not client:
            return jsonify(error="Database service unavailable"), 503
            
        # البحث عن الجهاز
        response = client.table('devices').select('*').eq('serial_number', serial).execute()
        device = response.data[0] if response.data else None
        
        if not device:
            return jsonify(error="Device not found"), 404
            
        # تحديث حالة الجهاز
        update_data = {
            'whitelisted': True,
            'blacklisted': False,
            'last_activity': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat()
        }
        
        response = client.table('devices').update(update_data).eq('serial_number', serial).execute()
        updated_device = response.data[0] if response.data else None
        
        if not updated_device:
            return jsonify(error="Failed to update device"), 500
            
        # تسجيل العملية في السجلات
        log_data = {
            "action": "device_whitelisted",
            "user_id": user_id,
            "target_device": serial,
            "ip_address": request.remote_addr,
            "details": json.dumps({"device_name": updated_device.get('name', 'Unknown')}),
            "timestamp": datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()
        
        # إنشاء سجل blockchain
        create_blockchain_record("device_whitelisted", {"device_id": updated_device.get('id'), "user_id": user_id}, user_id)
        generate_alert(f"Device {updated_device.get('name', 'Unknown')} added to whitelist", "normal")
        
        # إرسال إشعار عبر socket
        socketio.emit(
            "policy:whitelisted",
            {"serial_number": serial, "device": updated_device},
            namespace="/api/policies",
            broadcast=True
        )
        
        # تحويل البيانات للرد
        formatted_device = {
            'id': updated_device.get('id'),
            'name': updated_device.get('name'),
            'serial_number': updated_device.get('serial_number'),
            'whitelisted': updated_device.get('whitelisted'),
            'blacklisted': updated_device.get('blacklisted'),
            'last_activity': updated_device.get('last_activity')
        }
        
        return jsonify(message="Device whitelisted", device=formatted_device), 200
        
    except Exception as e:
        current_app.logger.error(f"Error whitelisting device {serial}: {e}")
        generate_alert(f"Error whitelisting device: {e}", "high")
        return jsonify(error="Failed to whitelist device"), 500


@policies_bp.route("/blacklist", methods=["OPTIONS", "POST"])
def add_to_blacklist():
    if request.method == "OPTIONS":
        return make_response('', 204)

    user_id, error = verify_token()
    if error:
        return jsonify(error=error), 401

    data = request.get_json() or {}
    serial = data.get("serial_number")
    if not serial:
        return jsonify(error="serial_number is required"), 400

    try:
        client = get_supabase_client()
        if not client:
            return jsonify(error="Database service unavailable"), 503
            
        # البحث عن الجهاز
        response = client.table('devices').select('*').eq('serial_number', serial).execute()
        device = response.data[0] if response.data else None
        
        if not device:
            return jsonify(error="Device not found"), 404
            
        # تحديث حالة الجهاز
        update_data = {
            'blacklisted': True,
            'whitelisted': False,
            'last_activity': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat()
        }
        
        response = client.table('devices').update(update_data).eq('serial_number', serial).execute()
        updated_device = response.data[0] if response.data else None
        
        if not updated_device:
            return jsonify(error="Failed to update device"), 500
            
        # تسجيل العملية في السجلات
        log_data = {
            "action": "device_blacklisted",
            "user_id": user_id,
            "target_device": serial,
            "ip_address": request.remote_addr,
            "details": json.dumps({"device_name": updated_device.get('name', 'Unknown')}),
            "timestamp": datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()
        
        # إنشاء سجل blockchain
        create_blockchain_record("device_blacklisted", {"device_id": updated_device.get('id'), "user_id": user_id}, user_id)
        generate_alert(f"Device {updated_device.get('name', 'Unknown')} added to blacklist", "high")
        
        # إرسال إشعار عبر socket
        socketio.emit(
            "policy:blacklisted",
            {"serial_number": serial, "device": updated_device},
            namespace="/api/policies",
            broadcast=True
        )
        
        # تحويل البيانات للرد
        formatted_device = {
            'id': updated_device.get('id'),
            'name': updated_device.get('name'),
            'serial_number': updated_device.get('serial_number'),
            'whitelisted': updated_device.get('whitelisted'),
            'blacklisted': updated_device.get('blacklisted'),
            'last_activity': updated_device.get('last_activity')
        }
        
        return jsonify(message="Device blacklisted", device=formatted_device), 200
        
    except Exception as e:
        current_app.logger.error(f"Error blacklisting device {serial}: {e}")
        generate_alert(f"Error blacklisting device: {e}", "high")
        return jsonify(error="Failed to blacklist device"), 500


@policies_bp.route("/remove-blacklist", methods=["OPTIONS", "POST"])
def remove_from_blacklist():
    if request.method == "OPTIONS":
        return make_response('', 204)

    user_id, error = verify_token()
    if error:
        return jsonify(error=error), 401

    data = request.get_json() or {}
    serial = data.get("serial_number")
    if not serial:
        return jsonify(error="serial_number is required"), 400

    try:
        client = get_supabase_client()
        if not client:
            return jsonify(error="Database service unavailable"), 503
            
        # البحث عن الجهاز
        response = client.table('devices').select('*').eq('serial_number', serial).execute()
        device = response.data[0] if response.data else None
        
        if not device:
            return jsonify(error="Device not found"), 404
            
        if not device.get('blacklisted'):
            return jsonify(error="Device is not blacklisted"), 400
            
        # تحديث حالة الجهاز
        update_data = {
            'blacklisted': False,
            'last_activity': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat()
        }
        
        response = client.table('devices').update(update_data).eq('serial_number', serial).execute()
        updated_device = response.data[0] if response.data else None
        
        if not updated_device:
            return jsonify(error="Failed to update device"), 500
            
        # تسجيل العملية في السجلات
        log_data = {
            "action": "device_removed_from_blacklist",
            "user_id": user_id,
            "target_device": serial,
            "ip_address": request.remote_addr,
            "details": json.dumps({"device_name": updated_device.get('name', 'Unknown')}),
            "timestamp": datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()
        
        # إنشاء سجل blockchain
        create_blockchain_record("device_removed_from_blacklist", {"device_id": updated_device.get('id'), "user_id": user_id}, user_id)
        generate_alert(f"Device {updated_device.get('name', 'Unknown')} removed from blacklist", "normal")
        
        # إرسال إشعار عبر socket
        socketio.emit(
            "policy:blacklist_removed",
            {"serial_number": serial, "device": updated_device},
            namespace="/api/policies",
            broadcast=True
        )
        
        # تحويل البيانات للرد
        formatted_device = {
            'id': updated_device.get('id'),
            'name': updated_device.get('name'),
            'serial_number': updated_device.get('serial_number'),
            'whitelisted': updated_device.get('whitelisted'),
            'blacklisted': updated_device.get('blacklisted'),
            'last_activity': updated_device.get('last_activity')
        }
        
        return jsonify(message="Device removed from blacklist", device=formatted_device), 200
        
    except Exception as e:
        current_app.logger.error(f"Error removing device from blacklist {serial}: {e}")
        generate_alert(f"Error removing device from blacklist: {e}", "high")
        return jsonify(error="Failed to remove device from blacklist"), 500


@policies_bp.route("/whitelist/bulk", methods=["OPTIONS", "POST"])
def bulk_add_to_whitelist():
    if request.method == "OPTIONS":
        return make_response('', 204)
    user_id, error = verify_token()
    if error:
        return jsonify(error=error), 401
    data = request.get_json() or {}
    pattern = data.get("pattern")
    if not pattern:
        return jsonify(error="pattern is required"), 400
    # دعم البحث حسب pattern: device_type, manufacturer, vendor_id, product_id
    try:
        supabase_client = get_supabase_client()
        if not supabase_client:
            return jsonify(error="Database connection error"), 500
            
        query = supabase_client.table('devices').select('*')
        
        if pattern.startswith("device_type:"):
            value = pattern.split(":",1)[1]
            # For meta_data JSON field, we need to get all and filter
            response = supabase_client.table('devices').select('*').execute()
            devices = response.data if response.data else []
            devices = [d for d in devices if json.loads(d.get('meta_data', '{}')).get('device_type') == value]
        elif pattern.startswith("manufacturer:"):
            value = pattern.split(":",1)[1]
            query = query.ilike('manufacturer', f"%{value}%")
            response = query.execute()
            devices = response.data if response.data else []
        elif pattern.startswith("vendor_id:"):
            value = pattern.split(":",1)[1]
            query = query.ilike('vendor_id', f"%{value}%")
            response = query.execute()
            devices = response.data if response.data else []
        elif pattern.startswith("product_id:"):
            value = pattern.split(":",1)[1]
            query = query.ilike('product_id', f"%{value}%")
            response = query.execute()
            devices = response.data if response.data else []
        else:
            return jsonify(error="Unsupported pattern"), 400
            
        if not pattern.startswith("device_type:"):
            devices = response.data if response.data else []

        affected = []
        for device in devices:
            device_id = device['id']
            serial = device['serial_number']
            
            # Update device in Supabase
            update_data = {
                'whitelisted': True,
                'blacklisted': False,
                'last_activity': datetime.utcnow().isoformat()
            }
            supabase_client.table('devices').update(update_data).eq('id', device_id).execute()
            affected.append(serial)
            
            # Log to Supabase
            log_data = {
                'action': "device_whitelisted_bulk",
                'user_id': user_id,
                'target_device': serial,
                'ip_address': request.remote_addr,
                'details': json.dumps({"pattern": pattern}),
                'timestamp': datetime.utcnow().isoformat()
            }
            supabase_client.table('logs').insert(log_data).execute()
        
        create_blockchain_record("device_whitelisted_bulk", {"pattern": pattern, "count": len(affected)}, user_id)
        generate_alert(f"Bulk whitelist: {len(affected)} devices", "normal")
        
    except Exception as e:
        current_app.logger.error(f"Error in bulk whitelist: {e}")
        return jsonify(error="Internal server error"), 500
        
    socketio.emit(
        "policy:whitelisted_bulk",
        {"pattern": pattern, "affected": affected},
        namespace="/api/policies",
        broadcast=True
    )
    return jsonify(message="Devices whitelisted", affected=affected), 200

@policies_bp.route("/blacklist/bulk", methods=["OPTIONS", "POST"])
def bulk_add_to_blacklist():
    if request.method == "OPTIONS":
        return make_response('', 204)
    user_id, error = verify_token()
    if error:
        return jsonify(error=error), 401
    data = request.get_json() or {}
    pattern = data.get("pattern")
    if not pattern:
        return jsonify(error="pattern is required"), 400
    try:
        supabase_client = get_supabase_client()
        if not supabase_client:
            return jsonify(error="Database connection error"), 500
            
        query = supabase_client.table('devices').select('*')
        
        if pattern.startswith("device_type:"):
            value = pattern.split(":",1)[1]
            # For meta_data JSON field, we need to get all and filter
            response = supabase_client.table('devices').select('*').execute()
            devices = response.data if response.data else []
            devices = [d for d in devices if json.loads(d.get('meta_data', '{}')).get('device_type') == value]
        elif pattern.startswith("manufacturer:"):
            value = pattern.split(":",1)[1]
            query = query.ilike('manufacturer', f"%{value}%")
            response = query.execute()
            devices = response.data if response.data else []
        elif pattern.startswith("vendor_id:"):
            value = pattern.split(":",1)[1]
            query = query.ilike('vendor_id', f"%{value}%")
            response = query.execute()
            devices = response.data if response.data else []
        elif pattern.startswith("product_id:"):
            value = pattern.split(":",1)[1]
            query = query.ilike('product_id', f"%{value}%")
            response = query.execute()
            devices = response.data if response.data else []
        else:
            return jsonify(error="Unsupported pattern"), 400
            
        if not pattern.startswith("device_type:"):
            devices = response.data if response.data else []

        affected = []
        for device in devices:
            device_id = device['id']
            serial = device['serial_number']
            
            # Update device in Supabase
            update_data = {
                'blacklisted': True,
                'whitelisted': False,
                'last_activity': datetime.utcnow().isoformat()
            }
            supabase_client.table('devices').update(update_data).eq('id', device_id).execute()
            affected.append(serial)
            
            # Log to Supabase
            log_data = {
                'action': "device_blacklisted_bulk",
                'user_id': user_id,
                'target_device': serial,
                'ip_address': request.remote_addr,
                'details': json.dumps({"pattern": pattern}),
                'timestamp': datetime.utcnow().isoformat()
            }
            supabase_client.table('logs').insert(log_data).execute()
        
        create_blockchain_record("device_blacklisted_bulk", {"pattern": pattern, "count": len(affected)}, user_id)
        generate_alert(f"Bulk blacklist: {len(affected)} devices", "high")
        
    except Exception as e:
        current_app.logger.error(f"Error in bulk blacklist: {e}")
        return jsonify(error="Internal server error"), 500
        
    socketio.emit(
        "policy:blacklisted_bulk",
        {"pattern": pattern, "affected": affected},
        namespace="/api/policies",
        broadcast=True
    )
    return jsonify(message="Devices blacklisted", affected=affected), 200


# ----- Policy Management Endpoints -----

@policies_bp.route("/create", methods=["OPTIONS", "POST"])
def create_policy():
    if request.method == "OPTIONS":
        return make_response('', 204)
    
    user_id, error = verify_token()
    if error:
        return jsonify(error=error), 401
    
    data = request.get_json() or {}
    
    try:
        client = get_supabase_client()
        if not client:
            return jsonify(error="Database service unavailable"), 503
            
        # إنشاء بيانات السياسة
        policy_data = {
            'name': data["name"],
            'description': data.get("description", ""),
            'rules': json.dumps(data.get("rules", {})) if "rules" in data and isinstance(data["rules"], dict) else "{}",
            'active': data.get("is_active", True),
            'created_at': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat()
        }
        
        # إنشاء السياسة في Supabase
        response = client.table('policies').insert(policy_data).execute()
        created_policy = response.data[0] if response.data else None
        
        if not created_policy:
            return jsonify(error="Failed to create policy"), 500
            
        # تسجيل العملية في السجلات
        log_data = {
            "action": "policy_created",
            "user_id": user_id,
            "details": json.dumps({"policy_id": created_policy.get('id')}),
            "timestamp": datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()
        
        # إنشاء سجل blockchain
        create_blockchain_record("policy_created", {"policy_id": created_policy.get('id'), "user_id": user_id}, user_id)
        generate_alert(f"تم إنشاء السياسة {created_policy.get('name', 'Unknown')}", "normal")
        
        # إرسال إشعار عبر socket
        socketio.emit("policy:created", created_policy, namespace="/api/policies")
        
        # تحويل البيانات للرد
        formatted_policy = {
            'id': created_policy.get('id'),
            'name': created_policy.get('name'),
            'description': created_policy.get('description'),
            'rules': created_policy.get('rules', {}),
            'active': created_policy.get('active', False),
            'created_at': created_policy.get('created_at'),
            'updated_at': created_policy.get('updated_at')
        }
        
        return jsonify(message="Policy created", policy=formatted_policy), 201
        
    except Exception as e:
        current_app.logger.error(f"Error creating policy: {e}")
        generate_alert(f"Error creating policy: {e}", "high")
        return jsonify(error="Failed to create policy"), 500

@policies_bp.route("/list", methods=["OPTIONS", "GET"])
def list_policies():
    if request.method == "OPTIONS":
        return make_response('', 204)
    
    try:
        client = get_supabase_client()
        if not client:
            return jsonify(error="Database service unavailable"), 503
            
        response = client.table('policies').select('*').execute()
        policies = response.data if response.data else []
        
        # تحويل البيانات لتنسيق موحد
        formatted_policies = []
        for policy in policies:
            formatted_policies.append({
                'id': policy.get('id'),
                'name': policy.get('name'),
                'description': policy.get('description'),
                'rules': policy.get('rules', {}),
                'active': policy.get('active', False),
                'created_at': policy.get('created_at'),
                'updated_at': policy.get('updated_at')
            })
        
        return jsonify(formatted_policies), 200
    except Exception as e:
        current_app.logger.error(f"Error listing policies: {e}")
        return jsonify(error="Failed to retrieve policies"), 500

@policies_bp.route("/<int:policy_id>", methods=["OPTIONS", "GET"])
def get_policy(policy_id):
    if request.method == "OPTIONS":
        return make_response('', 204)
    
    try:
        client = get_supabase_client()
        if not client:
            return jsonify(error="Database service unavailable"), 503
            
        response = client.table('policies').select('*').eq('id', policy_id).execute()
        policy = response.data[0] if response.data else None
        
        if not policy:
            return jsonify(error="Policy not found"), 404
            
        # تحويل البيانات لتنسيق موحد
        formatted_policy = {
            'id': policy.get('id'),
            'name': policy.get('name'),
            'description': policy.get('description'),
            'rules': policy.get('rules', {}),
            'active': policy.get('active', False),
            'created_at': policy.get('created_at'),
            'updated_at': policy.get('updated_at')
        }
        
        return jsonify(formatted_policy), 200
    except Exception as e:
        current_app.logger.error(f"Error getting policy {policy_id}: {e}")
        return jsonify(error="Failed to retrieve policy"), 500

@policies_bp.route("/<int:policy_id>", methods=["OPTIONS", "PUT"])
def update_policy(policy_id):
    if request.method == "OPTIONS":
        return make_response('', 204)
    
    user_id, error = verify_token()
    if error:
        return jsonify(error=error), 401
    
    data = request.get_json() or {}
    
    try:
        client = get_supabase_client()
        if not client:
            return jsonify(error="Database service unavailable"), 503
            
        # التحقق من وجود السياسة
        response = client.table('policies').select('*').eq('id', policy_id).execute()
        existing_policy = response.data[0] if response.data else None
        
        if not existing_policy:
            return jsonify(error="Policy not found"), 404
            
        # تحديث البيانات
        update_data = {
            'updated_at': datetime.utcnow().isoformat()
        }
        
        # تحديث الحقول المسموح بها
        allowed_fields = ["name", "description", "rules", "active"]
        for field in allowed_fields:
            if field in data:
                if field == "rules" and isinstance(data[field], dict):
                    update_data[field] = json.dumps(data[field])
                else:
                    update_data[field] = data[field]
        
        # تحديث السياسة في Supabase
        response = client.table('policies').update(update_data).eq('id', policy_id).execute()
        updated_policy = response.data[0] if response.data else None
        
        if not updated_policy:
            return jsonify(error="Failed to update policy"), 500
            
        # تسجيل العملية في السجلات
        log_data = {
            "action": "policy_updated",
            "user_id": user_id,
            "details": json.dumps({"policy_id": policy_id}),
            "timestamp": datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()
        
        # إنشاء سجل blockchain
        create_blockchain_record("policy_updated", {"policy_id": policy_id, "user_id": user_id}, user_id)
        generate_alert(f"تم تعديل السياسة {updated_policy.get('name', 'Unknown')}", "normal")
        
        # إرسال إشعار عبر socket
        socketio.emit("policy:updated", updated_policy, namespace="/api/policies")
        
        # تحويل البيانات للرد
        formatted_policy = {
            'id': updated_policy.get('id'),
            'name': updated_policy.get('name'),
            'description': updated_policy.get('description'),
            'rules': updated_policy.get('rules', {}),
            'active': updated_policy.get('active', False),
            'created_at': updated_policy.get('created_at'),
            'updated_at': updated_policy.get('updated_at')
        }
        
        return jsonify(message="Policy updated", policy=formatted_policy), 200
        
    except Exception as e:
        current_app.logger.error(f"Error updating policy {policy_id}: {e}")
        generate_alert(f"Error updating policy: {e}", "high")
        return jsonify(error="Failed to update policy"), 500

@policies_bp.route("/<int:policy_id>/activate", methods=["OPTIONS", "POST"])
def activate_policy(policy_id):
    if request.method == "OPTIONS":
        return make_response('', 204)
    
    user_id, error = verify_token()
    if error:
        return jsonify(error=error), 401
    
    try:
        client = get_supabase_client()
        if not client:
            return jsonify(error="Database service unavailable"), 503
            
        # التحقق من وجود السياسة
        response = client.table('policies').select('*').eq('id', policy_id).execute()
        policy = response.data[0] if response.data else None
        
        if not policy:
            return jsonify(error="Policy not found"), 404
            
        # تفعيل السياسة
        update_data = {
            'active': True,
            'updated_at': datetime.utcnow().isoformat()
        }
        
        response = client.table('policies').update(update_data).eq('id', policy_id).execute()
        updated_policy = response.data[0] if response.data else None
        
        if not updated_policy:
            return jsonify(error="Failed to activate policy"), 500
            
        # تسجيل العملية في السجلات
        log_data = {
            "action": "policy_activated",
            "user_id": user_id,
            "details": json.dumps({"policy_id": policy_id}),
            "timestamp": datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()
        
        # إنشاء سجل blockchain
        create_blockchain_record("policy_activated", {"policy_id": policy_id, "user_id": user_id}, user_id)
        generate_alert(f"تم تفعيل السياسة {updated_policy.get('name', 'Unknown')}", "normal")
        
        # إرسال إشعار عبر socket
        socketio.emit("policy:activated", updated_policy, namespace="/api/policies")
        
        # تحويل البيانات للرد
        formatted_policy = {
            'id': updated_policy.get('id'),
            'name': updated_policy.get('name'),
            'description': updated_policy.get('description'),
            'rules': updated_policy.get('rules', {}),
            'active': updated_policy.get('active', False),
            'created_at': updated_policy.get('created_at'),
            'updated_at': updated_policy.get('updated_at')
        }
        
        return jsonify(message="Policy activated", policy=formatted_policy), 200
        
    except Exception as e:
        current_app.logger.error(f"Error activating policy {policy_id}: {e}")
        generate_alert(f"Error activating policy: {e}", "high")
        return jsonify(error="Failed to activate policy"), 500

@policies_bp.route("/<int:policy_id>/deactivate", methods=["OPTIONS", "POST"])
def deactivate_policy(policy_id):
    if request.method == "OPTIONS":
        return make_response('', 204)
    
    user_id, error = verify_token()
    if error:
        return jsonify(error=error), 401
    
    try:
        client = get_supabase_client()
        if not client:
            return jsonify(error="Database service unavailable"), 503
            
        # التحقق من وجود السياسة
        response = client.table('policies').select('*').eq('id', policy_id).execute()
        policy = response.data[0] if response.data else None
        
        if not policy:
            return jsonify(error="Policy not found"), 404
            
        # تعطيل السياسة
        update_data = {
            'active': False,
            'updated_at': datetime.utcnow().isoformat()
        }
        
        response = client.table('policies').update(update_data).eq('id', policy_id).execute()
        updated_policy = response.data[0] if response.data else None
        
        if not updated_policy:
            return jsonify(error="Failed to deactivate policy"), 500
            
        # تسجيل العملية في السجلات
        log_data = {
            "action": "policy_deactivated",
            "user_id": user_id,
            "details": json.dumps({"policy_id": policy_id}),
            "timestamp": datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()
        
        # إنشاء سجل blockchain
        create_blockchain_record("policy_deactivated", {"policy_id": policy_id, "user_id": user_id}, user_id)
        generate_alert(f"تم تعطيل السياسة {updated_policy.get('name', 'Unknown')}", "medium")
        
        # إرسال إشعار عبر socket
        socketio.emit("policy:deactivated", updated_policy, namespace="/api/policies")
        
        # تحويل البيانات للرد
        formatted_policy = {
            'id': updated_policy.get('id'),
            'name': updated_policy.get('name'),
            'description': updated_policy.get('description'),
            'rules': updated_policy.get('rules', {}),
            'active': updated_policy.get('active', False),
            'created_at': updated_policy.get('created_at'),
            'updated_at': updated_policy.get('updated_at')
        }
        
        return jsonify(message="Policy deactivated", policy=formatted_policy), 200
        
    except Exception as e:
        current_app.logger.error(f"Error deactivating policy {policy_id}: {e}")
        generate_alert(f"Error deactivating policy: {e}", "high")
        return jsonify(error="Failed to deactivate policy"), 500

@policies_bp.route("/<int:policy_id>", methods=["OPTIONS", "DELETE"])
def delete_policy(policy_id):
    if request.method == "OPTIONS":
        return make_response('', 204)
    
    user_id, error = verify_token()
    if error:
        return jsonify(error=error), 401
    
    try:
        client = get_supabase_client()
        if not client:
            return jsonify(error="Database service unavailable"), 503
            
        # التحقق من وجود السياسة
        response = client.table('policies').select('*').eq('id', policy_id).execute()
        policy = response.data[0] if response.data else None
        
        if not policy:
            return jsonify(error="Policy not found"), 404
            
        # حفظ اسم السياسة قبل الحذف
        policy_name = policy.get('name', 'Unknown')
            
        # حذف السياسة من Supabase
        response = client.table('policies').delete().eq('id', policy_id).execute()
        
        if not response.data:
            return jsonify(error="Failed to delete policy"), 500
            
        # تسجيل العملية في السجلات
        log_data = {
            "action": "policy_deleted",
            "user_id": user_id,
            "details": json.dumps({"policy_id": policy_id}),
            "timestamp": datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()
        
        # إنشاء سجل blockchain
        create_blockchain_record("policy_deleted", {"policy_id": policy_id, "user_id": user_id}, user_id)
        generate_alert(f"تم حذف السياسة {policy_name}", "high")
        
        # إرسال إشعار عبر socket
        socketio.emit("policy:deleted", {"policy_id": policy_id}, namespace="/api/policies")
        
        return jsonify(message="Policy deleted", policy_id=policy_id), 200
        
    except Exception as e:
        current_app.logger.error(f"Error deleting policy {policy_id}: {e}")
        generate_alert(f"Error deleting policy: {e}", "high")
        return jsonify(error="Failed to delete policy"), 500


