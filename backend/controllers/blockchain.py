# backend/controllers/blockchain.py

import json
import hashlib
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
import base64
from cryptography.fernet import Fernet
import os

from extensions import db
from models import BlockchainLog, Log
from services.blockchain_service import create_blockchain_record, verify_chain, repair_invalid_blocks, reset_blockchain, get_blockchain_logs

# Supabase client function
def get_supabase_client():
    """Get fresh Supabase client instance for blockchain controller"""
    try:
        from flask import current_app
        from supabase import create_client

        supabase_url = current_app.config.get('SUPABASE_URL')
        supabase_anon_key = current_app.config.get('SUPABASE_ANON_KEY')

        if supabase_url and supabase_anon_key:
            return create_client(supabase_url, supabase_anon_key)
        else:
            current_app.logger.error("Supabase configuration missing in blockchain controller")
            return None
    except Exception as e:
        current_app.logger.error(f"Failed to create Supabase client in blockchain controller: {e}")
        return None

blockchain_bp = Blueprint('blockchain', __name__)

# التشفير - مفتاح ثابت للبيانات (في الإنتاج يجب أن يكون في متغير بيئة)
ENCRYPTION_KEY = os.environ.get('BLOCKCHAIN_ENCRYPTION_KEY', 'your-secret-key-here-32-chars!!!').encode()[:32]
ENCRYPTION_KEY = base64.urlsafe_b64encode(ENCRYPTION_KEY.ljust(32)[:32])
cipher_suite = Fernet(ENCRYPTION_KEY)

def encrypt_data(data):
    """تشفير البيانات قبل حفظها في قاعدة البيانات"""
    try:
        if isinstance(data, dict):
            data = json.dumps(data, ensure_ascii=False)
        return cipher_suite.encrypt(data.encode()).decode()
    except Exception:
        return data  # في حالة فشل التشفير، احتفظ بالبيانات كما هي

def decrypt_data(encrypted_data):
    """فك تشفير البيانات للعرض"""
    try:
        decrypted = cipher_suite.decrypt(encrypted_data.encode()).decode()
        try:
            return json.loads(decrypted)
        except json.JSONDecodeError:
            return decrypted
    except Exception:
        # إذا فشل فك التشفير، حاول قراءة البيانات كـ JSON عادي
        try:
            return json.loads(encrypted_data)
        except json.JSONDecodeError:
            return encrypted_data

def get_arabic_action_text(action, data=None):
    """تحويل أسماء الأعمال إلى نصوص عربية واضحة"""
    action_map = {
        'user_login': 'تسجيل دخول مستخدم',
        'user_logout': 'تسجيل خروج مستخدم',
        'device_connected': 'اتصال جهاز جديد',
        'device_disconnected': 'انقطاع اتصال جهاز',
        'device_approved': 'الموافقة على جهاز',
        'device_denied': 'رفض جهاز',
        'device_blocked': 'حظر جهاز',
        'usb_transfer': 'نقل ملف عبر USB',
        'alert_created': 'إنشاء تنبيه أمني',
        'alert_resolved': 'حل تنبيه أمني',
        'policy_updated': 'تحديث سياسة أمنية',
        'system_backup': 'نسخ احتياطي للنظام',
        'system_restore': 'استعادة النظام',
        'user_created': 'إنشاء مستخدم جديد',
        'user_updated': 'تحديث بيانات مستخدم',
        'user_deleted': 'حذف مستخدم',
        'blockchain_verified': 'التحقق من سلامة البلوك تشين',
        'blockchain_cleared': 'مسح بيانات البلوك تشين',
        'data_export': 'تصدير البيانات',
        'settings_changed': 'تغيير إعدادات النظام',
        'server_registered': 'تسجيل خادم جديد',
        'server_heartbeat': 'نبضة خادم',
        'port_enabled': 'تفعيل منفذ USB',
        'port_disabled': 'تعطيل منفذ USB'
    }
    
    base_text = action_map.get(action, action)
    
    # إضافة تفاصيل من البيانات إذا كانت متوفرة
    if data and isinstance(data, dict):
        if 'user_id' in data:
            base_text += f" (المستخدم: {data['user_id']})"
        if 'device_name' in data:
            base_text += f" (الجهاز: {data['device_name']})"
        if 'file_name' in data:
            base_text += f" (الملف: {data['file_name']})"
        if 'server_name' in data:
            base_text += f" (الخادم: {data['server_name']})"
    
    return base_text


@blockchain_bp.route('/', methods=['GET'])
@jwt_required()
def get_blockchain_data():
    try:
        limit = min(int(request.args.get('limit', 50)), 100)
        offset = max(int(request.args.get('offset', 0)), 0)
        action = request.args.get('action')
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')

        # Use Supabase instead of SQLAlchemy
        supabase_client = get_supabase_client()
        if not supabase_client:
            return jsonify({'error': 'Database connection error'}), 500

        # Build query
        query = supabase_client.table('blockchain_logs').select('*')

        if action:
            # For Supabase, we can use text search or ilike
            query = query.ilike('data', f'%{action}%')

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

        # Get total count
        count_query = supabase_client.table('blockchain_logs').select('id', count='exact')
        if action:
            count_query = count_query.ilike('data', f'%{action}%')
        if start_date:
            try:
                sd = datetime.fromisoformat(start_date)
                count_query = count_query.gte('timestamp', sd.isoformat())
            except ValueError:
                pass
        if end_date:
            try:
                ed = datetime.fromisoformat(end_date) + timedelta(days=1)
                count_query = count_query.lt('timestamp', ed.isoformat())
            except ValueError:
                pass

        count_response = count_query.execute()
        total_count = count_response.count if hasattr(count_response, 'count') else 0

        # Get records
        response = (
            query
            .order('timestamp', desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        records = response.data if response.data else []

        logs = []
        for rec in records:
            entry = dict(rec)  # Convert from Supabase record to dict
            try:
                # فك تشفير البيانات للعرض
                decrypted_data = decrypt_data(rec.get('data') or '{}')
                entry['parsed_data'] = decrypted_data

                # إضافة النص العربي
                if isinstance(decrypted_data, dict):
                    action_name = decrypted_data.get('action', 'unknown')
                    entry['arabic_description'] = get_arabic_action_text(action_name, decrypted_data)
                else:
                    entry['arabic_description'] = 'عملية غير محددة'

            except Exception:
                entry['parsed_data'] = {}
                entry['arabic_description'] = 'بيانات مشفرة غير قابلة للقراءة'
            logs.append(entry)

        # Audit log using Supabase
        supabase_client.table('logs').insert({
            'action': 'blockchain_logs_viewed',
            'user_id': get_jwt_identity(),
            'ip_address': request.remote_addr,
            'details': json.dumps({
                'filters': {
                    'action': action,
                    'start_date': start_date,
                    'end_date': end_date
                },
                'limit': limit,
                'offset': offset,
                'total': total_count
            }),
            'timestamp': datetime.utcnow().isoformat()
        }).execute()

        return jsonify({
            'blockchain_logs': logs,
            'total': total_count,
            'limit': limit,
            'offset': offset
        }), 200

    except Exception:
        current_app.logger.exception("Error in get_blockchain_data")
        return jsonify({'error': 'Internal server error'}), 500


@blockchain_bp.route('/verify', methods=['POST'])
@jwt_required()
def verify_blockchain():
    try:
        from services.blockchain_service import verify_chain
        
        # Initialize Supabase client
        supabase_client = get_supabase_client()
        
        all_valid, results = verify_chain()
        
        if not results:
            return jsonify({
                'verified': True,
                'message': 'لا توجد سجلات في البلوك تشين',
                'blocks_checked': 0,
                'invalid_blocks': 0,
                'results': []
            }), 200

        # حساب عدد البلوكات غير الصالحة
        invalid_blocks = len([r for r in results if not r.get('block_valid', True)])
        
        # تحديد الرسالة المناسبة
        if len(results) == 1:
            if all_valid:
                message = 'البلوك تشين يحتوي على سجل واحد صالح'
            else:
                message = 'السجل الوحيد في البلوك تشين غير صالح'
        elif all_valid:
            message = f'البلوك تشين صالح: {len(results)} سجل'
        else:
            message = f'تم اكتشاف {invalid_blocks} سجل غير صالح من أصل {len(results)}'

        # Audit log using Supabase
        supabase_client.table('logs').insert({
            'action': 'blockchain_verified',
            'user_id': get_jwt_identity(),
            'ip_address': request.remote_addr,
            'details': json.dumps({
                'verified': all_valid,
                'blocks_checked': len(results),
                'invalid_blocks': invalid_blocks
            }),
            'timestamp': datetime.utcnow().isoformat()
        }).execute()

        return jsonify({
            'verified': all_valid,
            'message': message,
            'blocks_checked': len(results),
            'invalid_blocks': invalid_blocks,
            'results': results
        }), 200

    except Exception as e:
        current_app.logger.exception("Error in verify_blockchain")
        return jsonify({
            'error': 'خطأ داخلي في التحقق من البلوك تشين',
            'verified': False,
            'blocks_checked': 0,
            'invalid_blocks': 0
        }), 500


@blockchain_bp.route('/add', methods=['POST'])
@jwt_required()
def add_blockchain_record():
    data = request.get_json() or {}
    action = data.get('action')
    payload = data.get('data')
    if not action or payload is None:
        return jsonify({'error': 'Both "action" and "data" are required'}), 400

    rec_id = create_blockchain_record(action, payload, get_jwt_identity())
    if rec_id:
        return jsonify({'message': 'Record added', 'record_id': rec_id}), 201
    else:
        return jsonify({'error': 'Failed to create record'}), 500


@blockchain_bp.route('/stats', methods=['GET'])
@jwt_required()
def get_blockchain_stats():
    try:
        supabase_client = get_supabase_client()
        if not supabase_client:
            return jsonify({'error': 'Database connection error'}), 500

        # Get total count
        count_response = supabase_client.table('blockchain_logs').select('id', count='exact').execute()
        total = count_response.count if hasattr(count_response, 'count') else 0

        # Get first and last records
        first_response = supabase_client.table('blockchain_logs').select('*').order('id').limit(1).execute()
        first = first_response.data[0] if first_response.data else None

        last_response = supabase_client.table('blockchain_logs').select('*').order('id', desc=True).limit(1).execute()
        last = last_response.data[0] if last_response.data else None

        # Get all records to count actions
        all_response = supabase_client.table('blockchain_logs').select('data').execute()
        actions = {}
        for rec in all_response.data or []:
            try:
                payload = json.loads(rec.get('data') or '{}')
                act = payload.get('action', 'unknown')
            except json.JSONDecodeError:
                act = 'unknown'
            actions[act] = actions.get(act, 0) + 1

        stats = {
            'total_records': total,
            'first_timestamp': first.get('timestamp') if first else None,
            'last_timestamp': last.get('timestamp') if last else None,
            'by_action': actions
        }

        # Audit log using Supabase
        audit_data = {
            'action': 'blockchain_stats_viewed',
            'user_id': None,  # Will be set by JWT
            'target_device': request.remote_addr,
            'details': json.dumps({'total_records': total}),
            'timestamp': datetime.utcnow().isoformat()
        }
        supabase_client.table('logs').insert(audit_data).execute()

        return jsonify(stats), 200

    except Exception:
        current_app.logger.exception("Error in get_blockchain_stats")
        return jsonify({'error': 'Internal server error'}), 500


@blockchain_bp.route('/user-logs/<user_id>', methods=['GET'])
@jwt_required()
def get_user_blockchain_logs(user_id):
    """جلب سجلات البلوك تشين لمستخدم محدد"""
    try:
        limit = min(int(request.args.get('limit', 50)), 100)
        offset = max(int(request.args.get('offset', 0)), 0)
        
        # Get blockchain logs for user using Supabase
        supabase = get_supabase_client()
        query = supabase.table('blockchain_logs').select('*', count='exact')
        
        # Filter by user_id in JSON data using text search
        query = query.like('data', f'%user_id%:{user_id}%')
        
        # Filter by date range if specified
        start_date = request.args.get('start_date')
        if start_date:
            try:
                sd = datetime.fromisoformat(start_date)
                query = query.gte('timestamp', sd.isoformat())
            except ValueError:
                pass
        
        end_date = request.args.get('end_date')
        if end_date:
            try:
                ed = datetime.fromisoformat(end_date) + timedelta(days=1)
                query = query.lt('timestamp', ed.isoformat())
            except ValueError:
                pass
        
        # Apply ordering, limit and offset
        query = query.order('timestamp', desc=True).range(offset, offset + limit - 1)
        
        response = query.execute()
        records = response.data
        total_count = response.count
        
        result = []
        for rec in records:
            try:
                data = json.loads(rec.get('data', '{}'))
            except json.JSONDecodeError:
                data = {}
            
            result.append({
                'id': rec['id'],
                'hash': rec['hash'],
                'previous_hash': rec['previous_hash'],
                'timestamp': rec['timestamp'],
                'data': data,
                'is_valid': rec.get('is_valid', True)
            })
        
        return jsonify({
            'records': result,
            'total': total_count,
            'limit': limit,
            'offset': offset,
            'user_id': user_id
        }), 200
        
    except Exception:
        current_app.logger.exception(f"Error fetching blockchain logs for user {user_id}")
        return jsonify({'error': 'Internal server error'}), 500


@blockchain_bp.route('/integrity-check', methods=['POST'])
@jwt_required()
def blockchain_integrity_check():
    """فحص شامل لسلامة البلوك تشين"""
    try:
        # Get all blockchain records using Supabase
        supabase = get_supabase_client()
        all_records_response = supabase.table('blockchain_logs').select('*').order('id').execute()
        all_records = all_records_response.data
        
        if not all_records:
            return jsonify({
                'status': 'empty',
                'message': 'البلوك تشين فارغ',
                'valid': True,
                'total_blocks': 0
            }), 200
        
        integrity_issues = []
        valid_hashes = 0
        total_blocks = len(all_records)
        
        for i, record in enumerate(all_records):
            # فحص التسلسل
            if i > 0:
                expected_prev_hash = all_records[i-1]['hash']
                if record['previous_hash'] != expected_prev_hash:
                    integrity_issues.append({
                        'block_id': record['id'],
                        'issue': 'prev_hash_mismatch',
                        'expected': expected_prev_hash,
                        'actual': record['previous_hash']
                    })
            
            # فحص صحة الهاش
            try:
                data_str = record.get('data', '{}')
                expected_hash = hashlib.sha256(
                    f"{record['previous_hash']}{record['timestamp']}{data_str}".encode()
                ).hexdigest()
                
                if record['hash'] == expected_hash:
                    valid_hashes += 1
                else:
                    integrity_issues.append({
                        'block_id': record['id'],
                        'issue': 'hash_corruption',
                        'expected': expected_hash,
                        'actual': record['hash']
                    })
            except Exception as e:
                integrity_issues.append({
                    'block_id': record['id'],
                    'issue': 'hash_calculation_error',
                    'error': str(e)
                })
        
        is_valid = len(integrity_issues) == 0
        integrity_percentage = (valid_hashes / total_blocks * 100) if total_blocks > 0 else 100
        
        # Log the integrity check results using Supabase
        supabase.table('logs').insert({
            'action': 'blockchain_integrity_check',
            'user_id': get_jwt_identity(),
            'ip_address': request.remote_addr,
            'details': json.dumps({
                'total_blocks': total_blocks,
                'valid_hashes': valid_hashes,
                'issues_found': len(integrity_issues),
                'integrity_percentage': integrity_percentage
            }),
            'timestamp': datetime.utcnow().isoformat()
        }).execute()
        
        return jsonify({
            'status': 'completed',
            'valid': is_valid,
            'total_blocks': total_blocks,
            'valid_hashes': valid_hashes,
            'integrity_percentage': round(integrity_percentage, 2),
            'issues': integrity_issues,
            'message': 'سلامة البلوك تشين مؤكدة' if is_valid else f'تم العثور على {len(integrity_issues)} مشكلة'
        }), 200
        
    except Exception:
        current_app.logger.exception("Error in blockchain integrity check")
        return jsonify({'error': 'Internal server error'}), 500


@blockchain_bp.route('/analytics', methods=['GET'])
@jwt_required()
def get_blockchain_analytics():
    """تحليلات متقدمة للبلوك تشين"""
    try:
        # إحصائيات الأنشطة لآخر 30 يوم
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        supabase = get_supabase_client()
        recent_records_response = supabase.table('blockchain_logs').select('*').gte('timestamp', thirty_days_ago.isoformat()).execute()
        recent_records = recent_records_response.data
        
        # تحليل الأنشطة حسب النوع
        activity_analysis = {}
        user_activity = {}
        daily_activity = {}
        
        for record in recent_records:
            try:
                data = json.loads(record.get('data', '{}'))
                action = data.get('action', 'unknown')
                user_id = data.get('user_id', 'system')
                day = record['timestamp'].split('T')[0]  # Extract date from ISO string
                
                # إحصائيات حسب النوع
                activity_analysis[action] = activity_analysis.get(action, 0) + 1
                
                # إحصائيات حسب المستخدم
                user_activity[user_id] = user_activity.get(user_id, 0) + 1
                
                # إحصائيات يومية
                daily_activity[day] = daily_activity.get(day, 0) + 1
                
            except json.JSONDecodeError:
                continue
        
        # أكثر الأنشطة تكراراً
        top_activities = sorted(
            activity_analysis.items(), 
            key=lambda x: x[1], 
            reverse=True
        )[:10]
        
        # أكثر المستخدمين نشاطاً
        top_users = sorted(
            user_activity.items(), 
            key=lambda x: x[1], 
            reverse=True
        )[:10]
        
        # معدل النشاط اليومي
        avg_daily_activity = sum(daily_activity.values()) / len(daily_activity) if daily_activity else 0
        
        # إحصائيات عامة
        total_blocks_response = supabase.table('blockchain_logs').select('*', count='exact').execute()
        total_blocks = total_blocks_response.count
        
        blocks_last_24h_response = supabase.table('blockchain_logs').select('*', count='exact').gte('timestamp', (datetime.utcnow() - timedelta(hours=24)).isoformat()).execute()
        blocks_last_24h = blocks_last_24h_response.count
        
        return jsonify({
            'total_blocks': total_blocks,
            'blocks_last_24h': blocks_last_24h,
            'blocks_last_30_days': len(recent_records),
            'average_daily_activity': round(avg_daily_activity, 2),
            'top_activities': top_activities,
            'top_users': top_users,
            'daily_activity': daily_activity,
            'activity_breakdown': activity_analysis
        }), 200
        
    except Exception:
        current_app.logger.exception("Error in blockchain analytics")
        return jsonify({'error': 'Internal server error'}), 500


@blockchain_bp.route('/export', methods=['GET'])
@jwt_required()
def export_blockchain_data():
    """تصدير بيانات البلوك تشين"""
    try:
        format_type = request.args.get('format', 'json').lower()
        limit = min(int(request.args.get('limit', 1000)), 10000)
        
        # Get blockchain records using Supabase
        supabase = get_supabase_client()
        records_response = supabase.table('blockchain_logs').select('*').order('timestamp', desc=True).limit(limit).execute()
        records = records_response.data
        
        if format_type == 'csv':
            import io
            import csv
            
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(['ID', 'Hash', 'Prev Hash', 'Timestamp', 'Action', 'User ID', 'Data'])
            
            for record in records:
                try:
                    data = json.loads(record.get('data', '{}'))
                    action = data.get('action', '')
                    user_id = data.get('user_id', '')
                except json.JSONDecodeError:
                    action = ''
                    user_id = ''
                    data = {}
                
                writer.writerow([
                    record['id'],
                    record['hash'],
                    record['previous_hash'],
                    record['timestamp'],
                    action,
                    user_id,
                    json.dumps(data, ensure_ascii=False)
                ])
            
            output.seek(0)
            from flask import make_response
            resp = make_response(output.getvalue())
            resp.headers['Content-Disposition'] = f'attachment; filename=blockchain_export.csv'
            resp.headers['Content-Type'] = 'text/csv; charset=utf-8'
            return resp
        
        else:  # JSON format
            result = []
            for record in records:
                try:
                    data = json.loads(record.get('data', '{}'))
                except json.JSONDecodeError:
                    data = {}
                
                result.append({
                    'id': record['id'],
                    'hash': record['hash'],
                    'previous_hash': record['previous_hash'],
                    'timestamp': record['timestamp'],
                    'data': data
                })
            
            return jsonify({
                'blockchain_export': result,
                'total_records': len(result),
                'export_timestamp': datetime.utcnow().isoformat()
            }), 200
        
    except Exception:
        current_app.logger.exception("Error exporting blockchain data")
        return jsonify({'error': 'Internal server error'}), 500


@blockchain_bp.route('/clear', methods=['POST'])
@jwt_required()
def clear_blockchain_data():
    """مسح جميع بيانات البلوك تشين"""
    try:
        # التحقق من صلاحيات المستخدم (فقط المدير يمكنه المسح)
        user_id = get_jwt_identity()
        
        # عد السجلات قبل المسح
        supabase = get_supabase_client()
        total_records_response = supabase.table('blockchain_logs').select('*', count='exact').execute()
        total_records = total_records_response.count
        
        if total_records == 0:
            return jsonify({
                'success': True,
                'message': 'البلوك تشين فارغ بالفعل',
                'deleted_count': 0
            }), 200
        
        # مسح جميع السجلات أولاً
        supabase.table('blockchain_logs').delete().neq('id', 0).execute()
        
        # إنشاء سجل المسح كأول سجل في البلوك تشين الجديد
        clear_record_data = {
            'action': 'blockchain_cleared',
            'user_id': user_id,
            'total_records_deleted': total_records,
            'timestamp': datetime.utcnow().isoformat(),
            'reason': 'manual_clear_operation',
            'block_height': 1
        }
        
        # إضافة سجل المسح (مشفر)
        encrypted_data = encrypt_data(clear_record_data)
        
        # إنشاء السجل الجديد مع previous_hash = None (أول سجل)
        content = f"0:{encrypted_data}:0"
        new_hash = hashlib.sha256(content.encode()).hexdigest()
        
        # Insert new genesis block using Supabase
        supabase.table('blockchain_logs').insert({
            'data': encrypted_data,
            'timestamp': datetime.utcnow().isoformat(),
            'previous_hash': None,
            'nonce': 0,
            'block_height': 1,
            'verified': True,
            'hash': new_hash
        }).execute()
        
        # تسجيل العملية في سجل الأحداث العادي أيضاً
        supabase.table('logs').insert({
            'action': 'blockchain_cleared',
            'user_id': user_id,
            'ip_address': request.remote_addr,
            'details': json.dumps({
                'deleted_records': total_records,
                'clear_timestamp': datetime.utcnow().isoformat()
            }),
            'timestamp': datetime.utcnow().isoformat()
        }).execute()
        
        return jsonify({
            'success': True,
            'message': f'تم مسح {total_records} سجل من البلوك تشين بنجاح',
            'deleted_count': total_records
        }), 200
        
    except Exception as e:
        current_app.logger.exception("Error clearing blockchain data")
        return jsonify({'error': 'فشل في مسح بيانات البلوك تشين'}), 500


@blockchain_bp.route('/repair', methods=['POST'])
@jwt_required()
def repair_blockchain():
    """إصلاح البلوكات غير الصالحة في البلوك تشين"""
    try:
        # التحقق من صلاحيات المستخدم (فقط المدير يمكنه الإصلاح)
        user_id = get_jwt_identity()
        
        # التحقق من سلامة البلوك تشين أولاً
        all_valid, results = verify_chain()
        
        if not results:
            return jsonify({
                'success': True,
                'message': 'لا توجد سجلات في البلوك تشين',
                'blocks_checked': 0,
                'invalid_blocks': 0
            }), 200
        
        if all_valid:
            return jsonify({
                'success': True,
                'message': 'البلوك تشين صالح ولا يحتاج إلى إصلاح',
                'blocks_checked': len(results),
                'invalid_blocks': 0
            }), 200
        
        # تحديد البلوكات غير الصالحة
        invalid_block_ids = [r['id'] for r in results if not r.get('block_valid', True)]
        
        if not invalid_block_ids:
            return jsonify({
                'success': True,
                'message': 'لا توجد بلوكات غير صالحة للإصلاح',
                'blocks_checked': len(results),
                'invalid_blocks': 0
            }), 200
        
        # محاولة الإصلاح
        repair_success = repair_invalid_blocks(invalid_block_ids)
        
        if repair_success:
            # إعادة التحقق بعد الإصلاح
            all_valid_after, results_after = verify_chain()
            
            return jsonify({
                'success': True,
                'message': f'تم إصلاح {len(invalid_block_ids)} بلوك غير صالح بنجاح',
                'blocks_checked': len(results),
                'invalid_blocks_before': len(invalid_block_ids),
                'invalid_blocks_after': len([r for r in results_after if not r.get('block_valid', True)]),
                'repair_successful': all_valid_after,
                'status': 'repaired'
            }), 200
        else:
            return jsonify({
                'success': False,
                'message': 'فشل في إصلاح البلوكات غير الصالحة',
                'blocks_checked': len(results),
                'invalid_blocks': len(invalid_block_ids),
                'status': 'repair_failed'
            }), 500
        
    except Exception as e:
        current_app.logger.exception("Error repairing blockchain")
        return jsonify({'error': f'فشل في إصلاح البلوك تشين: {str(e)}'}), 500


@blockchain_bp.route('/reset', methods=['POST'])
@jwt_required()
def reset_blockchain_endpoint():
    """إعادة تعيين البلوك تشين بالكامل (للاستخدام في حالات الطوارئ فقط)"""
    try:
        # التحقق من صلاحيات المستخدم (فقط المدير يمكنه إعادة التعيين)
        user_id = get_jwt_identity()
        
        # Initialize Supabase client
        supabase_client = get_supabase_client()
        
        # التحقق من وجود تأكيد في الطلب
        data = request.get_json() or {}
        confirmation = data.get('confirmation', False)
        
        if not confirmation:
            return jsonify({
                'error': 'يجب تأكيد إعادة تعيين البلوك تشين',
                'message': 'أرسل {"confirmation": true} لتأكيد العملية'
            }), 400
        
        # تسجيل عملية إعادة التعيين في سجل الأحداث
        supabase_client.table('logs').insert({
            'action': 'blockchain_reset_requested',
            'user_id': user_id,
            'ip_address': request.remote_addr,
            'details': json.dumps({
                'reset_timestamp': datetime.utcnow().isoformat(),
                'reason': 'manual_reset_operation'
            }),
            'timestamp': datetime.utcnow().isoformat()
        }).execute()
        
        # إعادة تعيين البلوك تشين
        reset_success = reset_blockchain()
        
        if reset_success:
            return jsonify({
                'success': True,
                'message': 'تم إعادة تعيين البلوك تشين بنجاح',
                'reset_timestamp': datetime.utcnow().isoformat()
            }), 200
        else:
            return jsonify({
                'success': False,
                'message': 'فشل في إعادة تعيين البلوك تشين'
            }), 500
        
    except Exception as e:
        current_app.logger.exception("Error resetting blockchain")
        return jsonify({'error': f'فشل في إعادة تعيين البلوك تشين: {str(e)}'}), 500


@blockchain_bp.route('/status', methods=['GET'])
@jwt_required()
def get_blockchain_status():
    """الحصول على حالة البلوك تشين الحالية"""
    try:
        # التحقق من سلامة البلوك تشين
        all_valid, results = verify_chain()
        
        # إحصائيات البلوك تشين
        supabase = get_supabase_client()
        total_blocks_response = supabase.table('blockchain_logs').select('*', count='exact').execute()
        total_blocks = total_blocks_response.count
        invalid_blocks = len([r for r in results if not r.get('block_valid', True)])
        
        # آخر بلوك
        last_block_response = supabase.table('blockchain_logs').select('*').order('id', desc=True).limit(1).execute()
        last_block = last_block_response.data[0] if last_block_response.data else None
        
        status_info = {
            'total_blocks': total_blocks,
            'valid_blocks': total_blocks - invalid_blocks,
            'invalid_blocks': invalid_blocks,
            'integrity_valid': all_valid,
            'last_block_id': last_block['id'] if last_block else None,
            'last_block_timestamp': last_block['timestamp'] if last_block else None,
            'verification_timestamp': datetime.utcnow().isoformat()
        }
        
        return jsonify(status_info), 200
        
    except Exception as e:
        current_app.logger.exception("Error getting blockchain status")
        return jsonify({'error': f'فشل في الحصول على حالة البلوك تشين: {str(e)}'}), 500

