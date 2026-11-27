import json
import requests
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify, current_app, make_response
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt

from extensions import db, socketio, supabase_client
from models import Log, User, Device
from utils import generate_alert
from services.blockchain_service import create_blockchain_record
from services.log_service import log_usb_transfer

logs_bp = Blueprint('logs', __name__)

# Ensure Supabase client is initialized
def get_supabase_client():
    """Get fresh Supabase client instance for logs controller"""
    try:
        from flask import current_app
        from supabase import create_client
        
        supabase_url = current_app.config.get('SUPABASE_URL')
        supabase_anon_key = current_app.config.get('SUPABASE_ANON_KEY')
        
        if supabase_url and supabase_anon_key:
            return create_client(supabase_url, supabase_anon_key)
        else:
            current_app.logger.error("Supabase configuration missing in logs controller")
            return None
    except Exception as e:
        current_app.logger.error(f"Failed to create Supabase client in logs controller: {e}")
        return None

def send_log_to_siem(log_entry: dict) -> None:
    """Send a log entry to the configured SIEM endpoint, if enabled."""
    if not current_app.config.get("SIEM_ENABLED"):
        return
    url = current_app.config.get("SIEM_API_URL")
    api_key = current_app.config.get("SIEM_API_KEY")
    if not url or not api_key:
        return
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    try:
        resp = requests.post(
            url,
            json=log_entry,
            headers=headers,
            timeout=5,
            verify=current_app.config.get("SIEM_TLS_VERIFY", True)
        )
        resp.raise_for_status()
    except Exception as e:
        current_app.logger.error(f"SIEM log send failed: {e}")

@logs_bp.route('/', methods=['GET'])
def get_logs():
    """Fetch logs with filters, pagination, and audit."""

    # بدون توكن، نستخدم IP فقط كـ user_id وهمي
    user_id = request.remote_addr

    # Query filters
    action        = request.args.get('action', '').strip()
    start_date    = request.args.get('start_date', '').strip()
    end_date      = request.args.get('end_date', '').strip()
    user_filter   = request.args.get('user_id', '').strip()
    device_filter = request.args.get('device', '').strip()
    try:
        limit  = min(int(request.args.get('limit', 20)), 100)
        offset = max(int(request.args.get('offset', 0)), 0)
    except ValueError:
        return jsonify({'error': 'Invalid limit or offset value'}), 400

    # Get Supabase client
    client = get_supabase_client()
    if client is None:
        return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500

    # Build Supabase query
    query = client.table('logs').select('*', count='exact')

    if action:
        query = query.eq('action', action)
    if start_date:
        try:
            sd = datetime.strptime(start_date, '%Y-%m-%d')
            query = query.gte('timestamp', sd.isoformat())
        except ValueError:
            return jsonify({'error': 'Invalid start_date format'}), 400
    if end_date:
        try:
            ed = datetime.strptime(end_date, '%Y-%m-%d') + timedelta(days=1)
            query = query.lt('timestamp', ed.isoformat())
        except ValueError:
            return jsonify({'error': 'Invalid end_date format'}), 400
    if user_filter:
        query = query.eq('user_id', user_filter)
    if device_filter:
        query = query.eq('target_device', device_filter)

    # Apply ordering, limit and offset
    query = query.order('timestamp', desc=True).range(offset, offset + limit - 1)
    
    # Execute query
    response = query.execute()
    logs = response.data if response.data else []
    total = response.count if hasattr(response, 'count') else len(logs)

    result = []
    for log in logs:
        entry = log.copy()
        if log.get('user_id'):
            # Get user information from Supabase
            user_response = client.table('users').select('id,username').eq('id', log['user_id']).execute()
            if user_response.data:
                u = user_response.data[0]
                entry['user'] = {'id': u['id'], 'username': u['username']}
            else:
                entry['user'] = None
        if log.get('target_device'):
            # Get device information from Supabase
            device_response = client.table('devices').select('id,name,serial_number').eq('serial_number', log['target_device']).execute()
            if device_response.data:
                d = device_response.data[0]
                entry['device'] = {
                    'id': d['id'],
                    'name': d['name'],
                    'serial_number': d['serial_number']
                }
            else:
                entry['device'] = None
        result.append(entry)

    # Audit this action using Supabase
    audit_data = {
        'action': 'logs_viewed',
        'user_id': None if user_id == request.remote_addr else (int(user_id) if user_id and user_id.isdigit() else None),
        'ip_address': request.remote_addr,
        'details': json.dumps({
            'filters': {
                'action': action,
                'start_date': start_date,
                'end_date': end_date,
                'user_id': user_filter,
                'device': device_filter
            },
            'results_count': len(result)
        }),
        'timestamp': datetime.utcnow().isoformat()
    }
    client.table('logs').insert(audit_data).execute()

    # Send audit to SIEM and blockchain
    send_log_to_siem(audit_data)
    create_blockchain_record('logs_viewed', {'count': len(result), 'user_id': user_id}, user_id)

    return jsonify({
        'logs':   result,
        'total':  total,
        'limit':  limit,
        'offset': offset
    }), 200

@logs_bp.route('/', methods=['POST'])
def create_log():
    """Create a new log entry manually."""
    user_id = request.remote_addr

    if not request.is_json:
        return jsonify({'error': 'Request must be JSON'}), 400

    data = request.get_json()
    if 'action' not in data:
        return jsonify({'error': 'Action is required'}), 400

    # Get Supabase client
    client = get_supabase_client()
    if client is None:
        return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500

    try:
        log_data = {
            'action': data['action'],
            'user_id': None if user_id == request.remote_addr else (int(user_id) if user_id and user_id.isdigit() else None),
            'target_device': data.get('target_device'),
            'ip_address': request.remote_addr,
            'details': json.dumps(data.get('details')) if 'details' in data else None,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        # Insert log using Supabase
        response = client.table('logs').insert(log_data).execute()
        new_log = response.data[0] if response.data else log_data

        # Send to SIEM, blockchain, and alert
        send_log_to_siem(new_log)
        create_blockchain_record('log_created', {'log_id': new_log.get('id'), 'user_id': user_id}, user_id)
        generate_alert('Log created', 'normal')

        # Emit real-time event
        socketio.emit(
            'new_log',
            new_log,
            namespace='/api/logs',
            broadcast=True
        )

        return jsonify({'message': 'Log created', 'log': new_log.to_dict()}), 201

    except Exception:
        current_app.logger.exception('Error creating log')
        generate_alert('Error creating log', 'high')
        return jsonify({'error': 'Internal server error'}), 500

@logs_bp.route('/actions', methods=['GET'])
def get_log_actions():
    """Fetch list of distinct log actions."""
    try:
        # Get Supabase client
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500
        
        # Get distinct actions from Supabase
        response = client.table('logs').select('action').execute()
        if response.data:
            actions = list(set(log['action'] for log in response.data if log.get('action')))
            return jsonify(actions), 200
        else:
            return jsonify([]), 200
    except Exception:
        current_app.logger.exception('Error fetching log actions')
        generate_alert('Error fetching log actions', 'medium')
        return jsonify({'error': 'Internal server error'}), 500

@logs_bp.route('/stats', methods=['GET'])
def get_log_stats():
    """Statistics on logs over a specified period."""
    try:
        days = int(request.args.get('days', 7))
        if days < 1 or days > 365:
            return jsonify({'error': 'Days out of range (1-365)'}), 400
    except ValueError:
        return jsonify({'error': 'Invalid days parameter'}), 400

    # Get Supabase client
    client = get_supabase_client()
    if client is None:
        return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500

    cutoff = datetime.utcnow() - timedelta(days=days)
    
    # Get recent logs from Supabase
    recent_response = client.table('logs').select('*').gte('timestamp', cutoff.isoformat()).execute()
    recent_logs = recent_response.data if recent_response.data else []
    
    # Get total logs count
    total_response = client.table('logs').select('*', count='exact').execute()
    total_logs = total_response.count if hasattr(total_response, 'count') else len(total_response.data or [])
    
    action_counts = {}
    user_counts   = {}
    device_counts = {}
    daily_counts  = {}

    for log in recent_logs:
        action = log.get('action')
        if action:
            action_counts[action] = action_counts.get(action, 0) + 1
        
        user_id = log.get('user_id')
        if user_id:
            user_counts[user_id] = user_counts.get(user_id, 0) + 1
        
        target_device = log.get('target_device')
        if target_device:
            device_counts[target_device] = device_counts.get(target_device, 0) + 1
        
        timestamp = log.get('timestamp')
        if timestamp:
            try:
                # Parse timestamp and get date
                dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                day = dt.strftime('%Y-%m-%d')
                daily_counts[day] = daily_counts.get(day, 0) + 1
            except (ValueError, AttributeError):
                pass

    # Get top users with usernames
    top_users = []
    for user_id, count in sorted(user_counts.items(), key=lambda x: -x[1])[:5]:
        try:
            user_response = client.table('users').select('username').eq('id', user_id).execute()
            username = user_response.data[0]['username'] if user_response.data else 'Unknown'
        except:
            username = 'Unknown'
        top_users.append({'id': user_id, 'username': username, 'count': count})

    # Get top devices with names
    top_devices = []
    for serial, count in sorted(device_counts.items(), key=lambda x: -x[1])[:5]:
        try:
            device_response = client.table('devices').select('id,name').eq('serial_number', serial).execute()
            if device_response.data:
                device = device_response.data[0]
                top_devices.append({
                    'id': device['id'],
                    'name': device['name'],
                    'serial_number': serial,
                    'count': count
                })
            else:
                top_devices.append({
                    'id': None,
                    'name': 'Unknown',
                    'serial_number': serial,
                    'count': count
                })
        except:
            top_devices.append({
                'id': None,
                'name': 'Unknown',
                'serial_number': serial,
                'count': count
            })

    top_actions = [{'action': a, 'count': c} for a, c in sorted(action_counts.items(), key=lambda x: -x[1])[:5]]
    daily_activity = [{'date': date, 'count': count} for date, count in sorted(daily_counts.items())]

    # Audit stats view using Supabase
    audit_data = {
        'action': 'log_stats_viewed',
        'user_id': None,  # IP addresses can't be user IDs
        'target_device': request.remote_addr,
        'details': json.dumps({'days': days, 'ip_address': request.remote_addr}),
        'timestamp': datetime.utcnow().isoformat()
    }
    client.table('logs').insert(audit_data).execute()
    
    send_log_to_siem(audit_data)
    create_blockchain_record('log_stats_viewed', {'days': days, 'user_id': request.remote_addr}, request.remote_addr)

    return jsonify({
        'total_logs':     total_logs,
        'recent_logs':    len(recent_logs),
        'top_users':      top_users,
        'top_devices':    top_devices,
        'top_actions':    top_actions,
        'daily_activity': daily_activity,
        'period_days':    days
    }), 200

@logs_bp.route('/clear', methods=['POST'])
def clear_logs():
    """Delete logs older than a specified number of days (>=30)."""
    if not request.is_json:
        return jsonify({'error': 'Request must be JSON'}), 400

    try:
        days = int(request.get_json().get('days', 0))
    except (ValueError, TypeError):
        return jsonify({'error': 'Days must be a number'}), 400

    if days < 30:
        return jsonify({'error': 'Cannot delete logs younger than 30 days'}), 400

    # Get Supabase client
    client = get_supabase_client()
    if client is None:
        return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500

    cutoff = datetime.utcnow() - timedelta(days=days)
    
    # Count logs to be deleted
    count_response = client.table('logs').select('*', count='exact').lt('timestamp', cutoff.isoformat()).execute()
    count = count_response.count if hasattr(count_response, 'count') else len(count_response.data or [])
    
    if count == 0:
        return jsonify({'message': 'No logs to delete'}), 200

    # Delete old logs
    client.table('logs').delete().lt('timestamp', cutoff.isoformat()).execute()

    # Audit delete action using Supabase
    audit_data = {
        'action': 'logs_cleared',
        'user_id': request.remote_addr,
        'ip_address': request.remote_addr,
        'details': json.dumps({'days': days, 'deleted': count}),
        'timestamp': datetime.utcnow().isoformat()
    }
    client.table('logs').insert(audit_data).execute()
    
    send_log_to_siem(audit_data)
    create_blockchain_record('logs_cleared', {'days': days, 'deleted': count, 'user_id': request.remote_addr}, request.remote_addr)
    generate_alert(f'Cleared {count} logs older than {days} days', 'normal')

    return jsonify({'message': f'Cleared {count} logs', 'logs_deleted': count}), 200

@logs_bp.route('/clear-all', methods=['DELETE'])
@jwt_required()
def clear_all_logs():
    """مسح جميع السجلات"""
    try:
        # Get Supabase client
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500
        
        user_id = get_jwt_identity()
        
        # تحقق من الصلاحيات
        current_user_roles = get_jwt().get('roles', [])
        if not any(role in current_user_roles for role in ['admin', 'super_admin']):
            return jsonify({'error': 'ليس لديك صلاحية لتنفيذ هذا الإجراء'}), 403
        
        # عد السجلات قبل المسح
        count_response = client.table('logs').select('*', count='exact').execute()
        logs_count = count_response.count if hasattr(count_response, 'count') else len(count_response.data or [])
        
        # مسح جميع السجلات
        client.table('logs').delete().neq('id', 0).execute()  # Delete all records
        
        # تسجيل العملية (بعد المسح) باستخدام Supabase
        try:
            log_data = {
                'action': 'CLEAR_ALL_LOGS',
                'user_id': user_id,
                'details': f'تم مسح {logs_count} سجل',
                'timestamp': datetime.utcnow().isoformat()
            }
            client.table('logs').insert(log_data).execute()
        except Exception:
            pass
        
        return jsonify({
            'success': True,
            'message': f'تم مسح {logs_count} سجل بنجاح',
            'deleted_count': logs_count
        })
        
    except Exception as e:
        return jsonify({'error': f'خطأ في مسح السجلات: {str(e)}'}), 500

@logs_bp.route('/clear-old', methods=['DELETE'])
@jwt_required()
def clear_old_logs():
    """مسح السجلات القديمة (أكثر من 30 يوم)"""
    try:
        # Get Supabase client
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500
        
        user_id = get_jwt_identity()
        
        current_user_roles = get_jwt().get('roles', [])
        if not any(role in current_user_roles for role in ['admin', 'super_admin']):
            return jsonify({'error': 'ليس لديك صلاحية لتنفيذ هذا الإجراء'}), 403
        
        # حساب التاريخ من 30 يوم مضت
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        
        # عد السجلات القديمة
        count_response = client.table('logs').select('*', count='exact').lt('timestamp', thirty_days_ago.isoformat()).execute()
        logs_count = count_response.count if hasattr(count_response, 'count') else len(count_response.data or [])
        
        # مسح السجلات القديمة
        client.table('logs').delete().lt('timestamp', thirty_days_ago.isoformat()).execute()
        
        try:
            log_data = {
                'action': 'CLEAR_OLD_LOGS',
                'user_id': user_id,
                'details': f'تم مسح {logs_count} سجل قديم',
                'timestamp': datetime.utcnow().isoformat()
            }
            client.table('logs').insert(log_data).execute()
        except Exception:
            pass
            pass
        
        return jsonify({
            'success': True,
            'message': f'تم مسح {logs_count} سجل قديم بنجاح',
            'deleted_count': logs_count
        })
        
    except Exception as e:
        return jsonify({'error': f'خطأ في مسح السجلات القديمة: {str(e)}'}), 500

@logs_bp.route('/clear-by-type', methods=['DELETE'])
@jwt_required()
def clear_logs_by_type():
    """مسح السجلات حسب النوع"""
    try:
        # Get Supabase client
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500
        
        user_id = get_jwt_identity()
        log_type = request.json.get('type', '')
        
        current_user_roles = get_jwt().get('roles', [])
        if not any(role in current_user_roles for role in ['admin', 'super_admin']):
            return jsonify({'error': 'ليس لديك صلاحية لتنفيذ هذا الإجراء'}), 403
        
        if not log_type:
            return jsonify({'error': 'نوع السجل مطلوب'}), 400
        
        # عد السجلات قبل المسح
        count_response = client.table('logs').select('*', count='exact').ilike('action', f'%{log_type}%').execute()
        logs_count = count_response.count if hasattr(count_response, 'count') else len(count_response.data or [])
        
        # مسح السجلات حسب النوع
        client.table('logs').delete().ilike('action', f'%{log_type}%').execute()
        
        try:
            log_data = {
                'action': 'CLEAR_LOGS_BY_TYPE',
                'user_id': user_id,
                'details': f'تم مسح {logs_count} سجل من نوع {log_type}',
                'timestamp': datetime.utcnow().isoformat()
            }
            client.table('logs').insert(log_data).execute()
        except Exception:
            pass
        
        return jsonify({
            'success': True,
            'message': f'تم مسح {logs_count} سجل من نوع {log_type} بنجاح',
            'deleted_count': logs_count
        })
        
    except Exception as e:
        return jsonify({'error': f'خطأ في مسح السجلات: {str(e)}'}), 500

@logs_bp.route('/export', methods=['GET'])
def export_logs():
    """تصدير السجلات بصيغة CSV أو JSON"""

    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة'}), 500
            
        format_type = request.args.get('format', 'csv').lower()
        limit = min(int(request.args.get('limit', 1000)), 10000)
        action_filter = request.args.get('action')
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')

        # Build Supabase query
        query = client.table('logs').select('*')

        if action_filter:
            query = query.ilike('action', f'%{action_filter}%')

        if start_date:
            try:
                sd = datetime.fromisoformat(start_date)
                query = query.gte('timestamp', sd.isoformat())
            except ValueError:
                pass

        if end_date:
            try:
                ed = datetime.fromisoformat(end_date) + timedelta(days=1)
                query = query.lt('timestamp', ed.isoformat())
            except ValueError:
                pass

        logs = query.order('timestamp', desc=True).limit(limit).execute()
        logs_data = logs.data if logs.data else []

        if format_type == 'csv':
            import io
            import csv
            
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow([
                'ID', 'Action', 'User ID', 'Target Device', 'IP Address', 
                'Timestamp', 'Details'
            ])

            for log in logs_data:
                writer.writerow([
                    log.get('id', ''),
                    log.get('action', ''),
                    log.get('user_id', ''),
                    log.get('target_device', ''),
                    log.get('ip_address', ''),
                    log.get('timestamp', ''),
                    log.get('details', '')
                ])

            output.seek(0)
            from flask import make_response
            resp = make_response(output.getvalue())
            resp.headers['Content-Disposition'] = 'attachment; filename=logs_export.csv'
            resp.headers['Content-Type'] = 'text/csv; charset=utf-8'
            return resp

        else:  # JSON format
            result = []
            for log in logs_data:
                result.append(log)

            return jsonify({
                'logs': result,
                'total_exported': len(result),
                'export_timestamp': datetime.utcnow().isoformat(),
                'filters_applied': {
                    'action': action_filter,
                    'start_date': start_date,
                    'end_date': end_date,
                    'limit': limit
                }
            }), 200

    except Exception as e:
        current_app.logger.exception("Error exporting logs")
        return jsonify({'error': 'خطأ في تصدير السجلات'}), 500

@logs_bp.route('/usb-transfer', methods=['POST'])
def log_usb_transfer_endpoint():
    """
    سجل عملية نقل بيانات عبر USB (قراءة/كتابة) في السجلات.
    Body: {
      serial_number: str,
      user_id: int,
      transfer_size: int,
      transfer_type: 'read'|'write',
      filename: str (اختياري),
      success: bool (اختياري),
      ip_address: str (اختياري)
    }
    """
    data = request.get_json() or {}
    required = ['serial_number', 'user_id', 'transfer_size', 'transfer_type']
    for field in required:
        if not data.get(field):
            return jsonify({'error': f'{field} is required'}), 400
    log = log_usb_transfer(
        serial_number = data['serial_number'],
        user_id       = data['user_id'],
        transfer_size = int(data['transfer_size']),
        transfer_type = data['transfer_type'],
        filename      = data.get('filename'),
        success       = data.get('success', True),
        ip_address    = data.get('ip_address', request.remote_addr)
    )
    return jsonify({'message': 'USB transfer logged', 'log': log.to_dict()}), 201

@logs_bp.route('/list', methods=['GET'])
@jwt_required()
def list_logs():
    """عرض قائمة السجلات"""
    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة'}), 500
            
        # الحصول على المعاملات
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 50, type=int)
        search = request.args.get('search', '')
        
        # Build Supabase query
        query = client.table('logs').select('*', count='exact')
        
        if search:
            pattern = f"%{search}%"
            query = query.or_(f'action.ilike.{pattern},target_device.ilike.{pattern},user_id.ilike.{pattern}')
        
        # Calculate offset and apply pagination
        offset = (page - 1) * per_page
        logs = query.order('timestamp', desc=True).range(offset, offset + per_page - 1).execute()
        logs_data = logs.data if logs.data else []
        total_count = logs.count if hasattr(logs, 'count') else len(logs_data)
        
        return jsonify({
            'logs': logs_data,
            'total': total_count,
            'pages': logs.pages,
            'current_page': page
        })
        
    except Exception as e:
        return jsonify({'error': f'خطأ في جلب السجلات: {str(e)}'}), 500


@logs_bp.route('/simple', methods=['GET'])
def get_simple_logs():
    """Get logs - real data only from database."""
    try:
        limit = int(request.args.get('limit', 100))
        
        # Get Supabase client safely
        client = get_supabase_client()
        if client is None:
            current_app.logger.error("Supabase client not available")
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة'}), 500
        
        # Get logs from Supabase with error handling
        try:
            response = client.table('logs').select('*').order('timestamp', desc=True).limit(limit).execute()
            logs_data = response.data if response.data else []
        except Exception as e:
            current_app.logger.error(f"Error querying logs table: {str(e)}")
            return jsonify({'error': 'خطأ في استعلام السجلات'}), 500
        
        response_data = []
        
        # Process each log entry
        for log_dict in logs_data:
            # إضافة معلومات المستخدم
            if log_dict.get('user_id'):
                try:
                    user_response = client.table('users').select('username').eq('id', log_dict['user_id']).execute()
                    user_data = user_response.data
                    log_dict['user_name'] = user_data[0]['username'] if user_data else 'مستخدم محذوف'
                except Exception as e:
                    current_app.logger.warning(f"Error fetching user info for {log_dict['user_id']}: {str(e)}")
                    log_dict['user_name'] = 'مستخدم محذوف'
            else:
                log_dict['user_name'] = 'النظام'
            
            # إضافة معلومات الجهاز
            if log_dict.get('target_device'):
                try:
                    device_response = client.table('devices').select('name').eq('serial_number', log_dict['target_device']).execute()
                    device_data = device_response.data
                    log_dict['device_name'] = device_data[0]['name'] if device_data else log_dict['target_device']
                except Exception as e:
                    current_app.logger.warning(f"Error fetching device info for {log_dict['target_device']}: {str(e)}")
                    log_dict['device_name'] = log_dict['target_device']
            else:
                log_dict['device_name'] = 'غير محدد'
            
            response_data.append(log_dict)
        
        return jsonify(response_data)
        
    except Exception as e:
        current_app.logger.error(f"Error fetching logs: {str(e)}")
        return jsonify({'error': 'خطأ في جلب السجلات'}), 500

