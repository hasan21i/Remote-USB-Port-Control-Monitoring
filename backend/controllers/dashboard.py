from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from supabase_config import get_supabase_client
from datetime import datetime, timedelta


dashboard_bp = Blueprint('dashboard', __name__)

# RBAC: تحقق من صلاحية المستخدم
ADMIN_ROLES = {'admin', 'manager'}
VIEW_ROLES = {'admin', 'manager', 'user', 'viewer'}

def get_server_id():
    """Extract server_id from header X-Server-Id."""
    try:
        server_id = request.headers.get('X-Server-Id', '')
        if server_id:
            return int(server_id)
        # إذا لم يتم إرسال server_id، استخدم القيمة الافتراضية 1
        return 1
    except (TypeError, ValueError):
        # في حالة خطأ، استخدم القيمة الافتراضية 1
        return 1

def has_role(required):
    try:
        # استخدم get_jwt() للحصول على الأدوار من الـ JWT token
        jwt_data = get_jwt()
        roles = set(jwt_data.get('roles', []))
        # إذا لم يكن هناك أدوار، افترض أن المستخدم لديه دور 'user'
        if not roles:
            roles = {'user'}
        return bool(roles & required)
    except Exception:
        # في حالة أي خطأ، افترض أن المستخدم لديه دور 'user'
        return 'user' in required

@dashboard_bp.route('/overview', methods=['GET'])
@jwt_required()
def overview():
    if not has_role(VIEW_ROLES):
        return jsonify({'error': 'لا تملك الصلاحية الكافية'}), 403
    
    discovered_count = 0
    total_devices = 0
    connected_devices = 0
    pending_devices = 0
    disconnected_devices = 0
    denied_devices = 0
    total_servers = 0
    total_alerts = 0
    total_logs = 0
    
    try:
        # استخدم server_id افتراضي
        server_id = get_server_id()
        client = get_supabase_client()
        if not client:
            return jsonify({
                'total_devices': 0,
                'connected_devices': 0,
                'pending_devices': 0,
                'disconnected_devices': 0,
                'denied_devices': 0,
                'total_servers': 1,
                'total_alerts': 0,
                'total_logs': 0,
            })

        # تم تعطيل المسح الفعلي لأنه بطيء جداً ويسبب timeout
        # الأجهزة المكتشفة تأتي من الـ Agent تلقائياً
        discovered_count = 0

        # عد الأجهزة حسب الحالة من قاعدة البيانات
        try:
            total_devices_result = client.table('devices').select('*', count='exact').eq('server_id', server_id).execute()
            total_devices = total_devices_result.count if total_devices_result.count is not None else 0
        except:
            total_devices = 0

        try:
            connected_devices_result = client.table('devices').select('*', count='exact').eq('server_id', server_id).eq('status', 'connected').execute()
            connected_devices = connected_devices_result.count if connected_devices_result.count is not None else 0
        except:
            connected_devices = 0

        # الأجهزة المعلقة من جدول السيرفر المعزول (server_pending_devices)
        server_pending_count = 0
        try:
            server_pending_result = client.table('server_pending_devices').select('*', count='exact').execute()
            server_pending_count = server_pending_result.count if server_pending_result.count is not None else 0
        except:
            server_pending_count = 0

        # الأجهزة المعلقة من جدول العملاء المعزول (agent_pending_devices)
        agent_pending_count = 0
        try:
            agent_pending_result = client.table('agent_pending_devices').select('*', count='exact').eq('status', 'pending').execute()
            agent_pending_count = agent_pending_result.count if agent_pending_result.count is not None else 0
        except:
            agent_pending_count = 0
        
        # مجموع الأجهزة المعلقة = سيرفر + عملاء (بدون تكرار من جدول devices)
        pending_devices = server_pending_count + agent_pending_count

        try:
            disconnected_devices_result = client.table('devices').select('*', count='exact').eq('server_id', server_id).eq('status', 'disconnected').execute()
            disconnected_devices = disconnected_devices_result.count if disconnected_devices_result.count is not None else 0
        except:
            disconnected_devices = 0

        try:
            denied_devices_result = client.table('devices').select('*', count='exact').eq('server_id', server_id).eq('status', 'denied').execute()
            denied_devices = denied_devices_result.count if denied_devices_result.count is not None else 0
        except:
            denied_devices = 0

        # عد الخوادم والتنبيهات والسجلات
        try:
            total_servers_result = client.table('servers').select('*', count='exact').execute()
            total_servers = total_servers_result.count if total_servers_result.count is not None else 0
        except:
            total_servers = 1

        try:
            total_alerts_result = client.table('alerts').select('*', count='exact').execute()
            total_alerts = total_alerts_result.count if total_alerts_result.count is not None else 0
        except:
            total_alerts = 0

        try:
            total_logs_result = client.table('logs').select('*', count='exact').execute()
            total_logs = total_logs_result.count if total_logs_result.count is not None else 0
        except:
            total_logs = 0

    except Exception as e:
        # في حالة أي خطأ عام، إرجاع قيم من الأجهزة المحلية
        pass

    return jsonify({
        'total_devices': total_devices,
        'connected_devices': connected_devices,
        'pending_devices': pending_devices,
        'disconnected_devices': disconnected_devices,
        'denied_devices': denied_devices,
        'total_servers': total_servers,
        'total_alerts': total_alerts,
        'total_logs': total_logs,
    })

@dashboard_bp.route('/servers', methods=['GET'])
@jwt_required()
def servers():
    if not has_role(VIEW_ROLES):
        return jsonify({'error': 'لا تملك الصلاحية الكافية'}), 403
    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'فشل في الاتصال بقاعدة البيانات'}), 500

        servers_result = client.table('servers').select('*').execute()
        servers = servers_result.data if servers_result.data else []

        # استعلام واحد لجلب عدد الأجهزة لكل الخوادم بدلاً من استعلام لكل خادم
        all_devices_result = client.table('devices').select('server_id').execute()
        device_counts = {}
        if all_devices_result.data:
            for d in all_devices_result.data:
                sid = d.get('server_id')
                if sid:
                    device_counts[sid] = device_counts.get(sid, 0) + 1

        result = []
        for s in servers:
            server_dict = s.copy()
            server_dict['device_count'] = device_counts.get(s['id'], 0)
            
            # التأكد من توفر الحقول المطلوبة للواجهة الأمامية
            # إضافة عنوان IP للتوافق مع Frontend
            if not server_dict.get('address'):
                server_dict['address'] = server_dict.get('ip_address') or server_dict.get('ip', '')
            
            # التأكد من وجود حقل last_heartbeat
            if 'last_heartbeat' not in server_dict and 'lastHeartbeat' in server_dict:
                server_dict['last_heartbeat'] = server_dict['lastHeartbeat']
            elif 'last_heartbeat' not in server_dict:
                server_dict['last_heartbeat'] = server_dict.get('updated_at') or server_dict.get('createdAt', '')
            
            # تحديد حالة is_online:
            # السيرفر الرئيسي (المركزي) متصل دائماً لأنه هو الذي يخدم هذا الطلب
            # السيرفرات الفرعية نستخدم القيمة المخزنة في قاعدة البيانات مباشرة
            if server_dict.get('role') == 'primary' or server_dict.get('id') == 1:
                server_dict['is_online'] = True
                server_dict['status'] = 'active'
            else:
                # للسيرفرات الفرعية: نقرأ is_online من قاعدة البيانات مباشرة
                # الـ Agent يحدث is_online عند إرسال heartbeat
                if 'is_online' not in server_dict:
                    server_dict['is_online'] = False
            
            if 'created_at' not in server_dict and 'createdAt' in server_dict:
                server_dict['created_at'] = server_dict['createdAt']
                
            if 'updated_at' not in server_dict and 'updatedAt' in server_dict:
                server_dict['updated_at'] = server_dict['updatedAt']
            
            result.append(server_dict)
        return jsonify(result)
    except Exception as e:
        return jsonify([])  # إرجاع مصفوفة فارغة في حالة الخطأ

@dashboard_bp.route('/devices', methods=['GET'])
@jwt_required()
def devices():
    if not has_role(VIEW_ROLES):
        return jsonify({'error': 'لا تملك الصلاحية الكافية'}), 403
    try:
        # استخدم server_id افتراضي
        server_id = get_server_id()
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'فشل في الاتصال بقاعدة البيانات'}), 500

        devices_result = client.table('devices').select('*').eq('server_id', server_id).execute()
        devices = devices_result.data if devices_result.data else []
        return jsonify(devices)
    except Exception as e:
        return jsonify([])  # إرجاع مصفوفة فارغة في حالة الخطأ

@dashboard_bp.route('/activity', methods=['GET'])
@jwt_required()
def activity():
    if not has_role(VIEW_ROLES):
        return jsonify({'error': 'لا تملك الصلاحية الكافية'}), 403
    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'فشل في الاتصال بقاعدة البيانات'}), 500

        since = request.args.get('since')
        query = client.table('logs').select('*').order('timestamp', desc=True).limit(50)

        if since:
            try:
                since_dt = datetime.fromisoformat(since)
                query = query.gte('timestamp', since_dt.isoformat())
            except Exception:
                pass

        logs_result = query.execute()
        logs = logs_result.data if logs_result.data else []
        return jsonify(logs)
    except Exception as e:
        return jsonify([])  # إرجاع مصفوفة فارغة في حالة الخطأ

@dashboard_bp.route('/alerts', methods=['GET'])
@jwt_required()
def alerts():
    if not has_role(VIEW_ROLES):
        return jsonify({'error': 'لا تملك الصلاحية الكافية'}), 403
    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'فشل في الاتصال بقاعدة البيانات'}), 500

        alerts_result = client.table('alerts').select('*').order('created_at', desc=True).limit(50).execute()
        alerts = alerts_result.data if alerts_result.data else []
        return jsonify(alerts)
    except Exception as e:
        return jsonify([])  # إرجاع مصفوفة فارغة في حالة الخطأ

# دعم real-time: بث socketio عند أي تغيير مهم
# مثال: عند إضافة جهاز جديد أو تنبيه جديد
# إرسال تحديث للوحة القيادة عند تغيير البيانات
from extensions import socketio
def emit_dashboard_update():
    try:
        socketio.emit('dashboard:update', {'timestamp': datetime.now().isoformat()}, namespace='/api/devices')
    except Exception:
        pass  # تجاهل الأخطاء لعدم تعطيل العملية الأساسية
# إرسال تحديث للوحة القيادة عند تغيير البيانات
from extensions import socketio
def emit_dashboard_update():
    try:
        socketio.emit('dashboard:update', {'timestamp': datetime.now().isoformat()}, namespace='/api/devices')
    except Exception:
        pass  # تجاهل الأخطاء لعدم تعطيل العملية الأساسية 
