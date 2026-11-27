# src/controllers/alerts.py

import json
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request, current_app
# from flask_cors import cross_origin  # تم إزالة CORS المحلي للاعتماد على الإعداد العالمي
from flask_jwt_extended import verify_jwt_in_request, get_jwt, jwt_required, get_jwt_identity
from sqlalchemy import or_

from extensions import db, supabase_client
from models import Alert, User, Log
from utils import generate_alert

alerts_bp = Blueprint('alerts', __name__)

# Ensure Supabase client is initialized
def get_supabase_client():
    """Get fresh Supabase client instance for alerts controller"""
    try:
        from flask import current_app
        from supabase import create_client
        
        supabase_url = current_app.config.get('SUPABASE_URL')
        supabase_anon_key = current_app.config.get('SUPABASE_ANON_KEY')
        
        if supabase_url and supabase_anon_key:
            return create_client(supabase_url, supabase_anon_key)
        else:
            current_app.logger.error("Supabase configuration missing in alerts controller")
            return None
    except Exception as e:
        current_app.logger.error(f"Failed to create Supabase client in alerts controller: {e}")
        return None


@alerts_bp.route('', methods=['OPTIONS', 'GET'])
def get_alerts():
    if request.method == 'OPTIONS':
        return jsonify({}), 200
        
    # فقط التحقق من JWT، بدون أدوار
    verify_jwt_in_request()
    try:
        priority  = request.args.get('priority')
        search    = request.args.get('search')
        date_from = request.args.get('dateFrom') or request.args.get('start_date')
        date_to   = request.args.get('dateTo')   or request.args.get('end_date')
        resolved  = request.args.get('resolved')
        limit     = min(int(request.args.get('limit', 100)), 100)
        offset    = max(int(request.args.get('offset', 0)), 0)

        # Get Supabase client
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500

        # Build Supabase query
        query = client.table('alerts').select('*', count='exact')

        # Apply search filter
        if search:
            pattern = f"%{search}%"
            query = query.or_(f'message.ilike.{pattern},target_device.ilike.{pattern}')

        # Apply priority filter
        if priority:
            query = query.eq('priority', priority)

        # Apply date filters
        if date_from:
            try:
                sd = datetime.strptime(date_from, '%Y-%m-%d')
                query = query.gte('created_at', sd.isoformat())
            except ValueError:
                pass

        if date_to:
            try:
                ed = datetime.strptime(date_to, '%Y-%m-%d') + timedelta(days=1)
                query = query.lt('created_at', ed.isoformat())
            except ValueError:
                pass

        # Apply resolved filter
        if resolved is not None and resolved != '':
            is_res = resolved.lower() == 'true'
            query = query.eq('resolved', is_res)

        # Apply ordering, limit and offset
        query = query.order('created_at', desc=True).range(offset, offset + limit - 1)
        
        # Execute query with retry
        def execute_with_retry(operation, max_retries=3):
            for attempt in range(max_retries):
                try:
                    return operation()
                except Exception as e:
                    if attempt == max_retries - 1:
                        current_app.logger.error(f"Query failed after {max_retries} attempts: {e}")
                        raise e
                    current_app.logger.warning(f"Query failed (attempt {attempt + 1}/{max_retries}): {e}")
                    import time
                    time.sleep(1)  # Wait 1 second before retry
        
        try:
            response = execute_with_retry(lambda: query.execute())
            alerts = response.data if response.data else []
            total_count = response.count if hasattr(response, 'count') else len(alerts)
        except Exception as e:
            current_app.logger.error(f"Failed to fetch alerts: {e}")
            return jsonify({'error': 'فشل في استرجاع التنبيهات', 'message': str(e)}), 500

        # Batch fetch all resolver user info to avoid N+1 queries
        resolved_by_ids = list(set([
            alert['resolved_by'] for alert in alerts
            if alert.get('resolved') and alert.get('resolved_by')
        ]))
        users_map = {}
        if resolved_by_ids:
            try:
                users_resp = execute_with_retry(
                    lambda: client.table('users').select('id,username').in_('id', resolved_by_ids).execute()
                )
                if users_resp.data:
                    users_map = {u['id']: u for u in users_resp.data}
            except Exception as e:
                current_app.logger.warning(f"Failed to batch-fetch user info: {e}")

        alerts_data = []
        for alert in alerts:
            data = alert.copy()
            if alert.get('resolved') and alert.get('resolved_by'):
                uid = alert['resolved_by']
                if uid in users_map:
                    data['resolved_by_user'] = {
                        'id': users_map[uid]['id'],
                        'username': users_map[uid]['username']
                    }
            alerts_data.append(data)

        # Log this operation using Supabase with retry
        try:
            log_data = {
                'action': "alerts_viewed",
                'user_id': get_jwt()['sub'],
                'ip_address': request.remote_addr,
                'details': json.dumps({
                    'filters': {
                        'priority':  priority,
                        'search':    search,
                        'dateFrom':  date_from,
                        'dateTo':    date_to,
                        'resolved':  resolved
                    },
                    'limit':  limit,
                    'offset': offset,
                    'returned': len(alerts_data)
                }),
                'timestamp': datetime.utcnow().isoformat()
            }
            try:
                from utils import safe_insert
                safe_insert(client, 'logs', log_data)
            except Exception:
                execute_with_retry(lambda: client.table('logs').insert(log_data).execute())
        except Exception as e:
            current_app.logger.warning(f"Failed to log alerts view operation: {e}")
            # Don't fail the request if logging fails

        return jsonify({
            'alerts': alerts_data,
            'total':  total_count,
            'limit':  limit,
            'offset': offset
        }), 200

    except Exception:
        current_app.logger.exception("Error in get_alerts")
        return jsonify({'error': 'حدث خطأ في الخادم'}), 500


@alerts_bp.route('', methods=['OPTIONS', 'POST'])
def create_alert_route():
    if request.method == 'OPTIONS':
        return jsonify({}), 200
        
    verify_jwt_in_request()
    try:
        data    = request.get_json() or {}
        message = data.get('message')
        if not message:
            return jsonify({'error': 'الرسالة مطلوبة'}), 400

        priority = data.get('priority', 'normal')
        metadata = data.get('metadata', {})

        alert_id = generate_alert(message, priority, metadata)
        if not alert_id:
            raise RuntimeError("generate_alert returned no ID")

        return jsonify({
            'message':  'تم إنشاء التنبيه بنجاح',
            'alert_id': alert_id
        }), 201

    except Exception:
        db.session.rollback()
        current_app.logger.exception("Error in create_alert_route")
        return jsonify({'error': 'حدث خطأ في الخادم'}), 500


@alerts_bp.route('/<int:alert_id>/resolve', methods=['OPTIONS', 'POST'])
@jwt_required()
def resolve_alert(alert_id):
    """حل تنبيه واحد محدد"""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
        
    try:
        user_id = get_jwt_identity()
        
        # Get Supabase client
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500
        
        # Get alert from Supabase
        alert_response = client.table('alerts').select('*').eq('id', alert_id).execute()
        if not alert_response.data:
            return jsonify({
                'success': False,
                'error': 'التنبيه غير موجود'
            }), 404
            
        alert = alert_response.data[0]
            
        if alert.get('resolved'):
            return jsonify({
                'success': True,
                'message': 'التنبيه محلول مسبقاً',
                'alert': alert
            }), 200

        # Update alert in Supabase
        update_data = {
            'resolved': True,
            'resolved_by': user_id,
            'resolved_at': datetime.utcnow().isoformat()
        }
        client.table('alerts').update(update_data).eq('id', alert_id).execute()

        # تسجيل العملية في السجل باستخدام Supabase
        log_data = {
            'action': "alert_resolved",
            'user_id': user_id,
            'ip_address': request.remote_addr,
            'details': json.dumps({
                'alert_id': alert['id'],
                'action': 'resolve_single_alert'
            }),
            'timestamp': datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()

        # Get updated alert
        updated_alert_response = client.table('alerts').select('*').eq('id', alert_id).execute()
        updated_alert = updated_alert_response.data[0] if updated_alert_response.data else alert

        return jsonify({
            'success': True,
            'message': 'تم حل التنبيه بنجاح',
            'alert': updated_alert
        }), 200

    except Exception as e:
        current_app.logger.exception("Error in resolve_alert")
        return jsonify({
            'success': False,
            'error': f'خطأ في حل التنبيه: {str(e)}'
        }), 500


@alerts_bp.route('/stats', methods=['OPTIONS', 'GET'])
def get_alert_stats():
    if request.method == 'OPTIONS':
        return jsonify({}), 200

    verify_jwt_in_request()
    try:
        # استخدام period_days بدلاً من days للتوافق مع الواجهة الأمامية
        days = max(min(int(request.args.get('periodDays', request.args.get('days', 7))), 365), 1)
        cutoff = datetime.utcnow() - timedelta(days=days)

        supabase_client = get_supabase_client()
        if not supabase_client:
            return jsonify({'error': 'Database connection error'}), 500

        # جلب جميع التنبيهات من Supabase
        all_response = supabase_client.table('alerts').select('*').execute()
        all_alerts = all_response.data or []

        # جلب التنبيهات الحديثة
        recent_response = supabase_client.table('alerts').select('*').gte('created_at', cutoff.isoformat()).execute()
        recent_alerts = recent_response.data or []

        # إحصائيات حسب الأولوية (جميع التنبيهات)
        pr_counts = {'low': 0, 'normal': 0, 'high': 0}
        res_count = unr_count = 0
        daily = {}

        # حساب الإحصائيات العامة
        for a in all_alerts:
            priority = a.get('priority', 'normal')
            if priority in pr_counts:
                pr_counts[priority] += 1
            else:
                pr_counts[priority] = 1

            if a.get('resolved'):
                res_count += 1
            else:
                unr_count += 1

        # حساب النشاط اليومي للفترة المحددة
        for a in recent_alerts:
            # Parse the created_at string from Supabase (ISO format)
            created_at_str = a['created_at']
            if isinstance(created_at_str, str):
                try:
                    created_at = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
                    d = created_at.strftime('%Y-%m-%d')
                except (ValueError, AttributeError):
                    # Fallback to current date if parsing fails
                    d = datetime.utcnow().strftime('%Y-%m-%d')
            else:
                # If it's already a datetime object
                d = created_at_str.strftime('%Y-%m-%d')
            daily[d] = daily.get(d, 0) + 1

        # Get high priority unresolved alerts using Supabase
        supabase = get_supabase_client()
        high_unresolved_response = supabase.table('alerts').select('*').eq('priority', 'high').eq('resolved', False).order('created_at', desc=True).limit(5).execute()
        high_unresolved = high_unresolved_response.data

        stats = {
            'total_alerts':       len(all_alerts),
            'resolved':           res_count,
            'unresolved':         unr_count,
            'by_priority':        pr_counts,
            'daily_activity':     sorted(
                [{'date': d, 'count': c} for d, c in daily.items()],
                key=lambda x: x['date']
            ),
            'recent_high_alerts': high_unresolved,
            'recent_alerts_count': len(recent_alerts),
            'period_days':        days
        }

        # Log the action using Supabase
        supabase.table('logs').insert({
            'action': 'alert_stats_viewed',
            'user_id': get_jwt()['sub'],
            'ip_address': request.remote_addr,
            'details': json.dumps({'period_days': days}),
            'timestamp': datetime.utcnow().isoformat()
        }).execute()

        return jsonify(stats), 200

    except Exception:
        current_app.logger.exception("Error in get_alert_stats")
        return jsonify({'error': 'حدث خطأ في الخادم'}), 500


@alerts_bp.route('/resolve-all', methods=['OPTIONS', 'POST'])
@jwt_required()
def resolve_all_alerts():
    """حل جميع التنبيهات غير المحلولة"""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
        
    try:
        user_id = get_jwt_identity()
        data = request.get_json() or {}
        priority = data.get('priority')
        
        # Get unresolved alerts using Supabase
        supabase = get_supabase_client()
        query = supabase.table('alerts').select('*').eq('resolved', False)
        
        if priority:
            query = query.eq('priority', priority)

        unresolved_response = query.execute()
        unresolved_alerts = unresolved_response.data
        
        count = len(unresolved_alerts)
        if count == 0:
            return jsonify({
                'success': True,
                'message': 'لا توجد تنبيهات غير محلولة',
                'resolved_count': 0
            }), 200

        # Update all matching alerts to be resolved using Supabase
        now = datetime.utcnow().isoformat()
        update_data = {
            'resolved': True,
            'resolved_by': user_id,
            'resolved_at': now
        }
        
        # Update each alert individually since Supabase doesn't support bulk update with complex filters
        for alert in unresolved_alerts:
            supabase.table('alerts').update(update_data).eq('id', alert['id']).execute()

        # Log the action using Supabase
        supabase.table('logs').insert({
            'action': 'alerts_bulk_resolved',
            'user_id': user_id,
            'ip_address': request.remote_addr,
            'details': json.dumps({
                'resolved_count': count, 
                'priority': priority,
                'action': 'resolve_all_alerts'
            }),
            'timestamp': now
        }).execute()

        return jsonify({
            'success': True,
            'message': f'تم حل {count} تنبيه بنجاح',
            'resolved_count': count
        }), 200

    except Exception as e:
        current_app.logger.exception("Error in resolve_all_alerts")
        return jsonify({
            'success': False,
            'error': f'خطأ في حل التنبيهات: {str(e)}'
        }), 500


@alerts_bp.route('/delete/<int:alert_id>', methods=['OPTIONS', 'DELETE'])
@jwt_required()
def delete_alert(alert_id):
    """حذف تنبيه واحد محدد من قاعدة البيانات"""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
        
    try:
        user_id = get_jwt_identity()
        
        # Get Supabase client
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500
        
        # البحث عن التنبيه باستخدام Supabase
        alert_response = client.table('alerts').select('*').eq('id', alert_id).execute()
        if not alert_response.data:
            return jsonify({
                'success': False,
                'error': 'التنبيه غير موجود'
            }), 404

        alert = alert_response.data[0]

        # حفظ معلومات التنبيه قبل الحذف للسجل
        alert_info = {
            'id': alert['id'],
            'message': alert.get('message'),
            'priority': alert.get('priority'),
            'resolved': alert.get('resolved')
        }

        # حذف التنبيه من قاعدة البيانات باستخدام Supabase
        client.table('alerts').delete().eq('id', alert_id).execute()

        # تسجيل العملية في السجل باستخدام Supabase
        log_data = {
            'action': "alert_deleted",
            'user_id': user_id,
            'ip_address': request.remote_addr,
            'details': json.dumps({
                'alert_id': alert_id,
                'alert_info': alert_info,
                'action': 'delete_single_alert'
            }),
            'timestamp': datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()

        return jsonify({
            'success': True,
            'message': 'تم حذف التنبيه بنجاح من قاعدة البيانات'
        }), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("Error in delete_alert")
        return jsonify({
            'success': False,
            'error': f'خطأ في حذف التنبيه: {str(e)}'
        }), 500


@alerts_bp.route('/clear-all', methods=['OPTIONS', 'DELETE'])
@jwt_required()
def clear_all_alerts():
    """مسح جميع التنبيهات من قاعدة البيانات"""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
        
    try:
        user_id = get_jwt_identity()
        
        # Count alerts before deletion using Supabase
        supabase = get_supabase_client()
        all_alerts_response = supabase.table('alerts').select('*', count='exact').execute()
        alerts_count = all_alerts_response.count
        
        if alerts_count == 0:
            return jsonify({
                'success': True,
                'message': 'لا توجد تنبيهات لحذفها',
                'deleted_count': 0
            }), 200
        
        # Delete all alerts using Supabase
        supabase.table('alerts').delete().neq('id', 0).execute()  # Delete all records
        
        # Log the action using Supabase
        supabase.table('logs').insert({
            'action': 'all_alerts_deleted',
            'user_id': user_id,
            'ip_address': request.remote_addr,
            'details': json.dumps({
                'deleted_count': alerts_count,
                'action': 'clear_all_alerts'
            }),
            'timestamp': datetime.utcnow().isoformat()
        }).execute()
        
        return jsonify({
            'success': True,
            'message': f'تم حذف {alerts_count} تنبيه بنجاح من قاعدة البيانات',
            'deleted_count': alerts_count
        }), 200
        
    except Exception as e:
        current_app.logger.exception("Error in clear_all_alerts")
        return jsonify({
            'success': False,
            'error': f'خطأ في حذف التنبيهات: {str(e)}'
        }), 500

@alerts_bp.route('/clear-resolved', methods=['OPTIONS', 'DELETE'])
@jwt_required()
def clear_resolved_alerts():
    """مسح التنبيهات المحلولة فقط من قاعدة البيانات"""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
        
    try:
        user_id = get_jwt_identity()
        
        # Count resolved alerts before deletion using Supabase
        supabase = get_supabase_client()
        resolved_alerts_response = supabase.table('alerts').select('*', count='exact').eq('resolved', True).execute()
        alerts_count = resolved_alerts_response.count
        
        if alerts_count == 0:
            return jsonify({
                'success': True,
                'message': 'لا توجد تنبيهات محلولة لحذفها',
                'deleted_count': 0
            }), 200
        
        # Delete resolved alerts using Supabase
        supabase.table('alerts').delete().eq('resolved', True).execute()
        
        # Log the action using Supabase
        supabase.table('logs').insert({
            'action': 'resolved_alerts_deleted',
            'user_id': user_id,
            'ip_address': request.remote_addr,
            'details': json.dumps({
                'deleted_count': alerts_count,
                'action': 'clear_resolved_alerts'
            }),
            'timestamp': datetime.utcnow().isoformat()
        }).execute()
        
        return jsonify({
            'success': True,
            'message': f'تم حذف {alerts_count} تنبيه محلول بنجاح من قاعدة البيانات',
            'deleted_count': alerts_count
        }), 200
        
    except Exception as e:
        current_app.logger.exception("Error in clear_resolved_alerts")
        return jsonify({
            'success': False,
            'error': f'خطأ في حذف التنبيهات المحلولة: {str(e)}'
        }), 500

@alerts_bp.route('/clear-old', methods=['OPTIONS', 'DELETE'])
@jwt_required()
def clear_old_alerts():
    """مسح التنبيهات القديمة (أكثر من 30 يوم) من قاعدة البيانات"""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
        
    try:
        user_id = get_jwt_identity()
        
        # حساب التاريخ من 30 يوم مضت
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        
        # Count old alerts before deletion using Supabase
        supabase = get_supabase_client()
        old_alerts_response = supabase.table('alerts').select('*', count='exact').lt('created_at', thirty_days_ago.isoformat()).execute()
        alerts_count = old_alerts_response.count
        
        if alerts_count == 0:
            return jsonify({
                'success': True,
                'message': 'لا توجد تنبيهات قديمة لحذفها',
                'deleted_count': 0
            }), 200
        
        # Delete old alerts using Supabase
        supabase.table('alerts').delete().lt('created_at', thirty_days_ago.isoformat()).execute()
        
        # Log the action using Supabase
        supabase.table('logs').insert({
            'action': 'old_alerts_deleted',
            'user_id': user_id,
            'ip_address': request.remote_addr,
            'details': json.dumps({
                'deleted_count': alerts_count,
                'action': 'clear_old_alerts',
                'cutoff_date': thirty_days_ago.isoformat()
            }),
            'timestamp': datetime.utcnow().isoformat()
        }).execute()
        
        return jsonify({
            'success': True,
            'message': f'تم حذف {alerts_count} تنبيه قديم بنجاح من قاعدة البيانات',
            'deleted_count': alerts_count
        }), 200
        
    except Exception as e:
        current_app.logger.exception("Error in clear_old_alerts")
        return jsonify({
            'success': False,
            'error': f'خطأ في حذف التنبيهات القديمة: {str(e)}'
        }), 500


@alerts_bp.route('/bulk-delete', methods=['OPTIONS', 'POST'])
@jwt_required()
def bulk_delete_alerts():
    """حذف عدة تنبيهات مرة واحدة"""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
        
    try:
        user_id = get_jwt_identity()
        data = request.get_json() or {}
        alert_ids = data.get('alert_ids', [])
        
        if not alert_ids:
            return jsonify({
                'success': False,
                'error': 'لم يتم تحديد تنبيهات للحذف'
            }), 400
        
        deleted_count = 0
        errors = []
        supabase = get_supabase_client()
        
        for alert_id in alert_ids:
            try:
                # Check if alert exists and delete using Supabase
                alert_response = supabase.table('alerts').select('*').eq('id', alert_id).execute()
                if alert_response.data:
                    supabase.table('alerts').delete().eq('id', alert_id).execute()
                    deleted_count += 1
                else:
                    errors.append(f"التنبيه {alert_id} غير موجود")
                    
            except Exception as e:
                errors.append(f"خطأ في حذف التنبيه {alert_id}: {str(e)}")
        
        if deleted_count > 0:
            # Log the action using Supabase
            supabase.table('logs').insert({
                'action': 'alerts_bulk_deleted',
                'user_id': user_id,
                'ip_address': request.remote_addr,
                'details': json.dumps({
                    'deleted_count': deleted_count,
                    'errors': errors,
                    'alert_ids': alert_ids,
                    'action': 'bulk_delete_alerts'
                }),
                'timestamp': datetime.utcnow().isoformat()
            }).execute()
        
        return jsonify({
            'success': True,
            'message': f'تم حذف {deleted_count} تنبيه بنجاح',
            'deleted_count': deleted_count,
            'errors': errors
        }), 200
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("Error in bulk_delete_alerts")
        return jsonify({
            'success': False,
            'error': f'خطأ في الحذف المجمّع للتنبيهات: {str(e)}'
        }), 500




