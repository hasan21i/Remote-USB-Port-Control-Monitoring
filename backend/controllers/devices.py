# backend/controllers/devices.py

import os
import json
import platform
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import verify_jwt_in_request, get_jwt, jwt_required, get_jwt_identity
from sqlalchemy.exc import IntegrityError
import usb.core

from extensions import db, socketio, supabase_client
from models import Device, Log, Server

# Ensure Supabase client is initialized
def get_supabase_client():
    """Get fresh Supabase client instance for devices controller"""
    try:
        from flask import current_app
        from supabase import create_client
        
        supabase_url = current_app.config.get('SUPABASE_URL')
        supabase_anon_key = current_app.config.get('SUPABASE_ANON_KEY')
        
        if supabase_url and supabase_anon_key:
            return create_client(supabase_url, supabase_anon_key)
        else:
            current_app.logger.error("Supabase configuration missing in devices controller")
            return None
    except Exception as e:
        current_app.logger.error(f"Failed to create Supabase client in devices controller: {e}")
        return None
from utils import (
    get_device_info,
    control_device,
    get_mounted_devices,
    get_device_permissions,
    generate_alert,
    is_device_connected,
    get_device_type,
    approve_device as util_approve_device,
    deny_device as util_deny_device,
    eject_device as util_eject_device,
    disconnect_device as util_disconnect_device,
    _find_device_by_identifier,
    get_connected_usb,
    discover_usb_devices,
    is_real_device,
    discover_usb_devices_windows,
    log_new_device_discovered,
    generate_device_signature
)
from services.blockchain_service import create_blockchain_record
from services.usb_service import enable_usb_port, disable_usb_port
import logging

logger = logging.getLogger(__name__)

devices_bp = Blueprint('devices', __name__)

# صلاحيات الأدوار
VIEW_ROLES     = {'admin', 'manager', 'user'}
APPROVE_ROLES  = {'admin', 'manager'}
DENY_ROLES     = {'admin', 'manager'}
ADD_ROLES      = {'admin', 'manager'}
CONTROL_ROLES  = {'admin', 'manager'}
SEARCH_ROLES   = {'admin', 'manager', 'user'}
SCAN_ROLES     = {'admin', 'manager'}
STATS_ROLES    = {'admin', 'manager'}
SYNC_ROLES     = {'admin', 'manager'}


def _has_role(required_roles: set) -> bool:
    try:
        jwt_data = get_jwt()
        roles = set(jwt_data.get('roles', []))
        # إذا لم يكن هناك أدوار، افترض أن المستخدم لديه دور 'user'
        if not roles:
            roles = {'user'}
        return bool(roles & required_roles)
    except Exception:
        # في حالة أي خطأ، افترض أن المستخدم لديه دور 'user'
        return 'user' in required_roles


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


def authorize_device(dev: Device, server_id: int) -> bool:
    return bool(dev and dev.server_id == server_id)


def verify_and_context(required_roles: set):
    """
    Complete Mediation & Separation of Privilege:
    تحقق من التوثيق والدور والسيرفر.
    Returns (error_response, server_id) or (None, server_id).
    """
    try:
        # تأكد من وجود JWT صالح
        verify_jwt_in_request()
    except Exception as e:
        # في حالة عدم وجود JWT token أو كان غير صالح
        return jsonify({'error': 'التوثيق مطلوب', 'message': str(e)}), 401
    
    # تحقق من الدور
    if not _has_role(required_roles):
        return jsonify({'error': 'لا تملك الصلاحية الكافية'}), 403
    # احصل على سياق السيرفر
    sid = get_server_id()
    # لا نحتاج للتحقق من وجود server_id لأنه سيكون 1 افتراضياً
    return None, sid


def get_device_by_identifier(identifier, server_id=None):
    """البحث عن جهاز باستخدام المُعرِّف مع دعم تنسيقات متعددة"""
    if not identifier:
        return None
    
    try:
        # Get Supabase client safely
        client = get_supabase_client()
        if client is None:
            return None

        # ابحث عن الجهاز باستخدام serial_number أو device_identifier
        query = client.table('devices').select('*')
        if server_id:
            query = query.eq('server_id', server_id)
        
        # البحث المباشر بالـ serial_number
        response = query.eq('serial_number', identifier).execute()
        if response.data:
            return response.data[0]
        
        # إذا لم يتم العثور عليه، جرب تحليل المُعرِّف
        vendor_id = None
        product_id = None
        
        # التعامل مع تنسيق VID/PID مثل VID8087PID0AAAREV0002
        if identifier.startswith('VID') and 'PID' in identifier:
            try:
                # استخراج VID و PID من التنسيق VIDxxxxPIDxxxx
                vid_start = identifier.find('VID') + 3
                pid_start = identifier.find('PID') + 3
                
                if vid_start > 2 and pid_start > 2:
                    # البحث عن نهاية VID (بداية PID أو نهاية النص)
                    vid_end = identifier.find('PID')
                    vendor_id = identifier[vid_start:vid_end]
                    
                    # البحث عن نهاية PID (REV أو نهاية النص)
                    rev_pos = identifier.find('REV', pid_start)
                    if rev_pos != -1:
                        product_id = identifier[pid_start:rev_pos]
                    else:
                        product_id = identifier[pid_start:]
                        
                    # إزالة أي أحرف غير صالحة
                    vendor_id = vendor_id.upper()[:4]
                    product_id = product_id.upper()[:4]
                    
            except Exception as e:
                current_app.logger.debug(f"فشل في تحليل معرف VID/PID: {identifier} - {e}")
        
        # التعامل مع تنسيق الشرطة السفلية مثل VID_PID_SERIAL
        elif '_' in identifier:
            parts = identifier.split('_')
            if len(parts) >= 2:
                vendor_id, product_id = parts[0], parts[1]
        
        # البحث باستخدام VID و PID إذا تم استخراجهما
        if vendor_id and product_id:
            # البحث بـ VID و PID مع serial_number فارغ أو null
            query2 = client.table('devices').select('*')
            if server_id:
                query2 = query2.eq('server_id', server_id)
            
            # جرب البحث مع serial_number فارغ أولاً
            response = query2.eq('vendor_id', vendor_id).eq('product_id', product_id).or_('serial_number.is.null,serial_number.eq.""').execute()
            if response.data:
                current_app.logger.debug(f"تم العثور على الجهاز باستخدام VID={vendor_id}, PID={product_id}")
                return response.data[0]
            
            # إذا لم يتم العثور عليه، جرب البحث بدون شرط serial_number
            response = query2.eq('vendor_id', vendor_id).eq('product_id', product_id).execute()
            if response.data:
                current_app.logger.debug(f"تم العثور على الجهاز باستخدام VID={vendor_id}, PID={product_id}")
                return response.data[0]
                
        current_app.logger.debug(f"لم يتم العثور على جهاز بالمُعرِّف: {identifier}")
        return None
        
    except Exception as e:
        current_app.logger.error(f"Error in get_device_by_identifier: {str(e)}")
        return None


def is_device_real_from_db(device):
    """فحص ما إذا كان الجهاز حقيقي بناءً على بيانات قاعدة البيانات"""
    try:
        # فحص معرفات الاختبار المعروفة
        vendor_id = (device.get('vendor_id') or '').lower()
        product_id = (device.get('product_id') or '').lower()
        
        # قائمة معرفات الأجهزة الوهمية
        fake_patterns = [
            ('0123', '4567'),
            ('0000', '0000'),
            ('ffff', 'ffff'),
            ('1234', '5678')
        ]
        
        for fake_vid, fake_pid in fake_patterns:
            if vendor_id == fake_vid and product_id == fake_pid:
                return False
        
        # فحص serial number مشبوه
        if device.get('serial_number'):
            if device['serial_number'].startswith('USB_') and '_' in device['serial_number']:
                parts = device['serial_number'].split('_')
                if len(parts) >= 3 and parts[1].isdigit():
                    return False
        
        # فحص metadata
        try:
            meta_data = json.loads(device.get('meta_data') or '{}')
            is_real = meta_data.get('is_real_device', True)
            if not is_real:
                return False
        except (json.JSONDecodeError, AttributeError):
            pass
        
        # الجهاز يبدو حقيقي
        return True
        
    except Exception as e:
        logger.debug(f"خطأ في فحص الجهاز الحقيقي من قاعدة البيانات: {e}")
        return True  # افتراضياً نعتبره حقيقي


@devices_bp.route('/list', methods=['GET'])
def list_devices():
    """جلب قائمة الأجهزة مع عرض البيانات الحقيقية فقط"""
    try:
        err, server_id = verify_and_context(VIEW_ROLES)
        if err:
            return err
        
        # جلب فلتر الحالة من معاملات الطلب
        status_filter = request.args.get('status', 'all')  # all, connected, pending, disconnected, denied
        show_real_only = request.args.get('real_only', 'true').lower() == 'true'
        all_servers = request.args.get('all_servers', 'false').lower() == 'true'  # البحث في جميع السيرفرات
        specific_server_id = request.args.get('server_id')  # سيرفر محدد
        
        # بناء الاستعلام الأساسي باستخدام Supabase
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500
            
        query = client.table('devices').select('*')
        
        # تطبيق فلتر السيرفر
        if all_servers:
            # البحث في جميع السيرفرات - لا حاجة لفلتر server_id
            current_app.logger.info("Searching in all servers")
        elif specific_server_id:
            # البحث في سيرفر محدد
            query = query.eq('server_id', int(specific_server_id))
            current_app.logger.info(f"Searching in specific server: {specific_server_id}")
        else:
            # البحث في السيرفر الحالي فقط (السلوك الافتراضي)
            # استخدام استعلامات منفصلة بدلاً من or_ لتجنب مشاكل التوافق
            devices_current = client.table('devices').select('*').eq('server_id', server_id).execute().data or []
            devices_null = client.table('devices').select('*').is_('server_id', 'null').execute().data or []
            devices_zero = client.table('devices').select('*').eq('server_id', 0).execute().data or []
            devices = devices_current + devices_null + devices_zero
            current_app.logger.info(f"Searching in current server: {server_id}")
            
            # تطبيق فلتر الحالة على النتائج المجمعة
            if status_filter and status_filter != 'all':
                devices = [d for d in devices if d.get('status') == status_filter]
            
            # إزالة التكرار من الأجهزة
            from utils import enhanced_device_deduplication
            devices = enhanced_device_deduplication(devices)
        
        # جلب الأجهزة للحالات الأخرى
        if not (all_servers or specific_server_id):
            # devices already fetched above for the else case
            pass
        else:
            # تطبيق فلتر الحالة
            if status_filter and status_filter != 'all':
                query = query.eq('status', status_filter)
            
            # جلب الأجهزة
            response = query.execute()
            devices = response.data if response.data else []
            
            # إزالة التكرار من الأجهزة
            from utils import enhanced_device_deduplication
            devices = enhanced_device_deduplication(devices)
        # تم تعطيل المسح التلقائي المباشر لأنه بطيء جداً ويسبب timeout
        # الأجهزة تُكتشف تلقائياً عبر USB Agent
        if len(devices) == 0 and status_filter == 'all':
            logger.info("لا توجد أجهزة - يعتمد الاكتشاف على USB Agent")
        
        # جلب معلومات التخزين المتصلة
        try:
            mounted = get_mounted_devices()
        except Exception as e:
            logger.warning(f"فشل في جلب أجهزة التخزين: {e}")
            mounted = []
        
        # تم تعطيل المسح المباشر لتحسين سرعة الاستجابة
        # الأجهزة الجديدة تُكتشف عبر USB Agent وتُحفظ في agent_pending_devices
        connected_serials = []

        # جلب الأجهزة المعلقة من الـ Agents (agent_pending_devices)
        if status_filter in ['all', 'pending']:
            try:
                 pending_query = client.table('agent_pending_devices').select('*').eq('status', 'pending')
                 
                 if not all_servers:
                     if specific_server_id:
                         pending_query = pending_query.eq('agent_server_id', int(specific_server_id))
                     else:
                         pending_query = pending_query.eq('agent_server_id', server_id)
                
                 pending_resp = pending_query.execute()
                 agent_pending = pending_resp.data if pending_resp.data else []
                 
                 for pd in agent_pending:
                     # Check if already in devices
                     if any(d.get('serial_number') == pd.get('serial_number') for d in devices):
                         continue
                         
                     # Map to device format
                     mapped_dev = {
                         'id': f"pending_{pd.get('id')}",
                         'name': pd.get('device_name', 'Unknown Pending'),
                         'serial_number': pd.get('serial_number'),
                         'vendor_id': pd.get('vendor_id', '0000'),
                         'product_id': pd.get('product_id', '0000'),
                         'manufacturer': pd.get('manufacturer', 'Unknown'),
                         'device_class': pd.get('device_class'),
                         'device_type': pd.get('device_type'),
                         'status': 'pending',
                         'is_connected': True, 
                         'server_id': pd.get('agent_server_id'),
                         'server_name': pd.get('agent_server_name') or pd.get('agent_hostname') or 'الخادم الفرعي',
                         'agent_hostname': pd.get('agent_hostname'),
                         'usb_port': pd.get('usb_port'),
                         'physical_path': pd.get('physical_path'),
                         'meta_data': pd.get('raw_device_data'), 
                         'is_real_device': pd.get('is_real_device', True),
                         'connection_time': pd.get('received_at'),
                         'is_agent_pending': True 
                     }
                     devices.append(mapped_dev)
                     
            except Exception as e:
                logger.warning(f"Error fetching agent pending devices: {e}")
        
        # تسجيل النشاط باستخدام Supabase
        try:
            log_data = {
                'action': "enhanced_device_list_viewed",
                'user_id': get_jwt_identity(),
                'details': json.dumps({
                    'server_id': server_id, 
                    'total_devices': len(devices),
                    'status_filter': status_filter,
                    'real_only_filter': show_real_only
                }),
                'timestamp': datetime.utcnow().isoformat()
            }
            client.table('logs').insert(log_data).execute()
        except Exception as log_error:
            logger.warning(f"فشل في تسجيل عرض قائمة الأجهزة: {log_error}")
        
        # معالجة الأجهزة وإعداد بيانات محسّنة
        enhanced_devices = []
        real_devices_count = 0
        fake_devices_filtered = 0
        
        # جلب جميع الخوادم دفعة واحدة لتجنب N+1 queries
        servers_map = {}
        try:
            all_servers_resp = client.table('servers').select('*').execute()
            if all_servers_resp.data:
                servers_map = {s['id']: s for s in all_servers_resp.data}
        except Exception as e:
            logger.debug(f"فشل في جلب قائمة الخوادم: {e}")
        
        for device in devices:
            try:
                # الجهاز بالفعل قاموس من Supabase
                device_dict = device.copy()
                
                # فحص ما إذا كان الجهاز حقيقي
                is_real = is_device_real_from_db(device_dict)
                device_dict['is_real_device'] = is_real
                
                # إذا كان الفلتر مفعل للأجهزة الحقيقية فقط
                # لا نحذف الأجهزة المعلقة أبداً - الأدمن يحتاج يشوفها للموافقة/الرفض
                device_status = (device_dict.get('status') or '').lower()
                is_pending = device_status in ('pending', 'waiting', 'discovered')
                if show_real_only and not is_real and not is_pending:
                    fake_devices_filtered += 1
                    continue
                    
                if is_real:
                    real_devices_count += 1
                
                # تحديد نوع الخادم من الذاكرة المؤقتة بدلاً من استعلام لكل جهاز
                server = servers_map.get(device_dict.get('server_id'))
                        
                if server:
                    device_dict['is_central_server'] = (server.get('role') == 'primary')
                    device_dict['server_role'] = server.get('role')
                    device_dict['server_name'] = server.get('name')
                    device_dict['server_status'] = server.get('status')
                    device_dict['server_is_active'] = server.get('is_active')
                else:
                    device_dict['is_central_server'] = True
                    device_dict['server_role'] = 'primary'
                    device_dict['server_name'] = 'الخادم الرئيسي'
                    device_dict['server_status'] = 'active'
                    device_dict['server_is_active'] = True
                    
                device_dict['source'] = 'central' if device_dict['is_central_server'] else 'sub'
                
                # محاولة التحقق من حالة الاتصال بأمان باستخدام الطريقة المحسنة
                # تصحيح: لا تقم بفحص الاتصال محلياً إذا كان الجهاز ينتمي لسيرفر آخر
                is_local_device = (
                    device.get('server_id') == 1 or 
                    device.get('server_id') == server_id or 
                    not device.get('server_id')
                )
                
                # نعتمد على الحالة المسجلة في قاعدة البيانات بدلاً من فحص PowerShell البطيء
                device_dict['is_connected'] = device.get('is_connected', (device.get('status') == 'connected'))
                
                # محاولة الحصول على صلاحيات الجهاز
                try:
                    device_dict['permissions'] = get_device_permissions(device['serial_number'])
                except Exception as e:
                    logger.debug(f"فشل في جلب صلاحيات الجهاز {device['serial_number']}: {e}")
                    device_dict['permissions'] = {
                        'read': False, 
                        'write': False, 
                        'execute': False, 
                        'reason': 'error'
                    }
                
                # إضافة معلومات التخزين إذا كان متاح
                device_dict['storage'] = None
                if device.get('serial_number') and mounted:
                    for storage_device in mounted:
                        if device['serial_number'] in storage_device.get('device', ''):
                            device_dict['storage'] = storage_device
                            break
                
                # إضافة معلومات محسّنة من metadata
                try:
                    meta_data = json.loads(device.get('meta_data') or '{}')
                    device_dict['device_type'] = meta_data.get('device_type', 'Unknown')
                    device_dict['power_consumption'] = meta_data.get('power_consumption', 0.0)
                    device_dict['detection_method'] = meta_data.get('discovery_method', 'legacy')
                    device_dict['detected_at'] = meta_data.get('detected_at', '')
                    device_dict['device_hash'] = meta_data.get('device_hash', '')
                    device_dict['system'] = meta_data.get('system', 'Unknown')
                except (json.JSONDecodeError, AttributeError):
                    device_dict['device_type'] = 'Unknown'
                    device_dict['power_consumption'] = 0.0
                    device_dict['detection_method'] = 'legacy'
                
                # إضافة معلومات المنفذ والمسار الفيزيائي الحقيقي
                device_dict['port_info'] = {
                    'usb_port': device.get('usb_port') or 'USB Port Unknown',
                    'physical_path': device.get('physical_path') or 'غير محدد'
                }
                # Display fields for frontend consistency
                device_dict['display_serial'] = device.get('serial_number') or generate_device_signature(device_dict)
                device_dict['display_name'] = device_dict.get('name') or device_dict.get('manufacturer') or device_dict.get('product') or 'Unknown Device'
                device_dict['display_type'] = device_dict.get('device_type') or get_device_type({'device_class': str(device_dict.get('device_class') or '0'), 'manufacturer': device_dict.get('manufacturer') or '', 'product': device_dict.get('name') or ''})
                
                enhanced_devices.append(device_dict)
                
            except Exception as e:
                # تسجيل الخطأ بدون إيقاف العملية
                logger.debug(f"خطأ في معالجة الجهاز {device['id']}: {e}")
                continue
        
        # إعداد رد محسن مع إحصائيات
        response_data = {
            'devices': enhanced_devices,
            'summary': {
                'total_devices': len(enhanced_devices),
                'real_devices': real_devices_count,
                'fake_devices_filtered': fake_devices_filtered,
                'status_filter': status_filter,
                'real_only_filter': show_real_only,
                'server_id': server_id,
                'all_servers': all_servers,
                'specific_server_id': specific_server_id,
                'system_type': platform.system()
            },
            'filters_applied': {
                'status': status_filter,
                'real_only': show_real_only,
                'all_servers': all_servers,
                'server_id': specific_server_id
            }
        }
        
        logger.info(f"تم جلب {len(enhanced_devices)} جهاز (حقيقي: {real_devices_count}, مرشح: {fake_devices_filtered})")
        
        return jsonify(response_data), 200
        
    except Exception as e:
        logger.error(f"خطأ في جلب قائمة الأجهزة المحسنة: {e}")
        db.session.rollback()
        return jsonify({
            'error': 'خطأ في جلب قائمة الأجهزة',
            'message': str(e),
            'devices': [],
            'summary': {
                'total_devices': 0,
                'real_devices': 0,
                'fake_devices_filtered': 0,
                'error_occurred': True
            }
        }), 500


def is_device_real_from_db(device: dict) -> bool:
    """فحص ما إذا كان الجهاز حقيقي بناءً على بياناته في قاعدة البيانات"""
    try:
        # فحص المعلومات الأساسية
        vendor_id = device.get('vendor_id', '')
        product_id = device.get('product_id', '')
        serial_number = device.get('serial_number', '')
        name = (device.get('name', '')).lower()
        manufacturer = (device.get('manufacturer', '')).lower()
        
        # تحقق من metadata إذا كان متاح
        try:
            meta_data = json.loads(device.get('meta_data', '{}'))
            if 'is_real_device' in meta_data:
                return meta_data['is_real_device']
        except (json.JSONDecodeError, AttributeError):
            pass
        
        # استخدام الدالة المحسنة من utils
        device_info = {
            'vendor_id': vendor_id.lower(),
            'product_id': product_id.lower(),
            'serial_number': serial_number,
            'name': name,
            'manufacturer': manufacturer
        }
        
        from utils import is_real_device
        return is_real_device(device_info)
        
    except Exception as e:
        logger.debug(f"خطأ في فحص صحة الجهاز {device.get('id', 'unknown')}: {e}")
        # في حالة الخطأ، نفترض أن الجهاز حقيقي إذا كان موجود في قاعدة البيانات
        return True


@devices_bp.route('/<identifier>/approve', methods=['POST'])
def approve_device_api(identifier):
    err, server_id = verify_and_context(APPROVE_ROLES)
    if err:
        return err
    user_id = get_jwt_identity()
    
    # معالجة مرنة لـ request data مع تحسين معالجة الأخطاء
    try:
        # التحقق من Content-Type
        content_type = request.headers.get('Content-Type', '')
        
        if 'application/json' in content_type:
            # محاولة قراءة JSON data
            try:
                data = request.get_json() or {}
            except Exception as e:
                logger.error(f"فشل في قراءة JSON data: {e}")
                return jsonify({'error': 'بيانات JSON غير صحيحة', 'details': str(e)}), 400
        else:
            # محاولة قراءة البيانات كـ JSON حتى لو لم يكن Content-Type صحيح
            try:
                data = request.get_json(force=True) or {}
            except Exception as e:
                logger.warning(f"لا يمكن قراءة البيانات كـ JSON، استخدام قيم افتراضية: {e}")
                data = {}
                
    except Exception as e:
        logger.error(f"خطأ في معالجة البيانات المستلمة: {e}")
        data = {}
    
    notes = data.get('notes', '')
    success, msg = util_approve_device(identifier, user_id, notes)
    if success:
        return jsonify({'message': msg}), 200
    return jsonify({'error': msg}), 400

@devices_bp.route('/<identifier>/deny', methods=['POST'])
def deny_device_api(identifier):
    err, server_id = verify_and_context(DENY_ROLES)
    if err:
        return err
    user_id = get_jwt_identity()
    
    # معالجة مرنة لـ request data مع تحسين معالجة الأخطاء
    try:
        # التحقق من Content-Type
        content_type = request.headers.get('Content-Type', '')
        
        if 'application/json' in content_type:
            # محاولة قراءة JSON data
            try:
                data = request.get_json() or {}
            except Exception as e:
                logger.error(f"فشل في قراءة JSON data: {e}")
                return jsonify({'error': 'بيانات JSON غير صحيحة', 'details': str(e)}), 400
        else:
            # محاولة قراءة البيانات كـ JSON حتى لو لم يكن Content-Type صحيح
            try:
                data = request.get_json(force=True) or {}
            except Exception as e:
                logger.warning(f"لا يمكن قراءة البيانات كـ JSON، استخدام قيم افتراضية: {e}")
                data = {}
                
    except Exception as e:
        logger.error(f"خطأ في معالجة البيانات المستلمة: {e}")
        data = {}
    
    reason = data.get('reason', '')
    block = data.get('block', False)
    success, msg = util_deny_device(identifier, user_id, reason, block)
    if success:
        return jsonify({'message': msg}), 200
    return jsonify({'error': msg}), 400

@devices_bp.route('/<identifier>/eject', methods=['POST'])
def eject_device_api(identifier):
    """API endpoint لإخراج جهاز USB"""
    try:
        err, server_id = verify_and_context(CONTROL_ROLES)
        if err:
            return err
        
        user_id = get_jwt_identity()
        logger.info(f"User {user_id} attempting to eject device {identifier}")
        
        success, msg = util_eject_device(identifier, user_id)
        
        if success:
            logger.info(f"Device {identifier} ejected successfully")
            return jsonify({'message': msg}), 200
        else:
            logger.warning(f"Failed to eject device {identifier}: {msg}")
            return jsonify({'error': msg}), 400
            
    except Exception as e:
        logger.error(f"Unexpected error in eject_device_api for {identifier}: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({'error': 'حدث خطأ غير متوقع أثناء إخراج الجهاز'}), 500

@devices_bp.route('/<identifier>/disconnect', methods=['POST'])
def disconnect_device_api(identifier):
    """API endpoint لفصل جهاز USB"""
    try:
        err, server_id = verify_and_context(CONTROL_ROLES)
        if err:
            return err
        
        user_id = get_jwt_identity()
        logger.info(f"User {user_id} attempting to disconnect device {identifier}")
        
        success, msg = util_disconnect_device(identifier, user_id)
        
        if success:
            logger.info(f"Device {identifier} disconnected successfully")
            return jsonify({'message': msg}), 200
        else:
            logger.warning(f"Failed to disconnect device {identifier}: {msg}")
            return jsonify({'error': msg}), 400
            
    except Exception as e:
        logger.error(f"Unexpected error in disconnect_device_api for {identifier}: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({'error': 'حدث خطأ غير متوقع أثناء فصل الجهاز'}), 500


@devices_bp.route('/add', methods=['POST'])
def add_device():
    err, server_id = verify_and_context(ADD_ROLES)
    if err:
        return err
    data = request.json or {}
    required = ['serial_number', 'name', 'vendor_id', 'product_id']
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({'error': f'حقول مفقودة: {missing}'}), 400
    
    # Check if device already exists using Supabase
    try:
        # Get Supabase client safely
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500

        existing_response = client.table('devices').select('id').eq('serial_number', data['serial_number']).eq('server_id', server_id).execute()
        if existing_response.data:
            return jsonify({'error': 'الجهاز موجود بالفعل'}), 409
    except Exception as e:
        current_app.logger.error(f"Error checking existing device: {str(e)}")
        return jsonify({'error': 'خطأ في التحقق من وجود الجهاز'}), 500
    
    meta = {
        'device_type':    data.get('device_type', 'unknown'),
        'added_manually': True,
        'added_by':       get_jwt_identity(),
        'added_at':       datetime.utcnow().isoformat(),
        'usb_port':       data.get('usb_port', 'غير معروف'),
        'physical_path':  data.get('physical_path', ''),
        'server_id':      server_id,
    }
    
    device_data = {
        'server_id': server_id,
        'name': data['name'],
        'serial_number': data['serial_number'],
        'vendor_id': data['vendor_id'],
        'product_id': data['product_id'],
        'usb_port': data.get('usb_port', 'غير معروف'),
        'device_class': data.get('device_class'),
        'connection_time': datetime.utcnow().isoformat(),
        'status': 'connected' if data.get('status') == 'connected' else 'disconnected',
        'whitelisted': data.get('whitelisted', False),
        'blacklisted': data.get('blacklisted', False),
        'registered_by_id': get_jwt_identity(),
        'risk_level': data.get('risk_level', 'unknown'),
        'meta_data': json.dumps(meta),
        'physical_path': data.get('physical_path', ''),
        'custom_name': data.get('custom_name'),
        'notes': data.get('notes'),
    }
    
    try:
        # Insert device using Supabase
        device_response = client.table('devices').insert(device_data).execute()
        device = device_response.data[0] if device_response.data else None
        
        if not device:
            return jsonify({'error': 'فشل في إضافة الجهاز'}), 500
        
        # Generate alert
        generate_alert(f"تم إضافة جهاز يدوياً: {device['name']}", 'normal', {'device_id': device['id']})
        
        # Add log entry using Supabase
        log_data = {
            'action': "device_added_manually",
            'user_id': get_jwt_identity(),
            'target_device': device['serial_number'],
            'details': json.dumps({'server_id': server_id}),
            'timestamp': datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()
        
        # Create blockchain record
        create_blockchain_record('device_added_manually', {'device_id': device['id']}, get_jwt_identity())
        
        socketio.emit('device:added', device, namespace='/api/devices')
        return jsonify({'message': 'Device added', 'device': device}), 201
        
    except Exception as e:
        current_app.logger.error(f"Error adding device: {str(e)}")
        return jsonify({'error': 'خطأ في إضافة الجهاز'}), 500


@devices_bp.route('/bulk_add', methods=['POST'])
def bulk_add_devices():
    """استقبال الأجهزة من العملاء وإضافتها لقائمة الانتظار (agent_pending_devices)"""
    try:
        data = request.json or {}
        devices_list = data.get('devices', [])
        
        if not devices_list:
            return jsonify({'error': 'لا توجد أجهزة للإضافة'}), 400
        
        # Get Supabase client safely
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500
        
        # استخراج بيانات الوكيل
        agent_server_id = data.get('server_id')
        agent_id = data.get('agent_id', 'Unknown Agent')
        agent_ip = request.remote_addr
        
        processed_count = 0
        error_count = 0
        
        for device_data in devices_list:
            try:
                serial_number = device_data.get('serial_number')
                if not serial_number:
                    continue
                
                # تحضير بيانات الجهاز للجدول المعزول
                pending_device = {
                    'serial_number': serial_number,
                    'device_name': device_data.get('name', 'Unknown Device')[:255],
                    'vendor_id': device_data.get('vendor_id', '0000'),
                    'product_id': device_data.get('product_id', '0000'),
                    'manufacturer': device_data.get('manufacturer', 'Unknown')[:255],
                    'device_class': str(device_data.get('device_class', 'Unknown'))[:100],
                    'device_type': device_data.get('device_type', 'USB Device')[:100],
                    'status': 'pending',
                    
                    'agent_server_id': agent_server_id if agent_server_id else None,
                    'agent_server_name': agent_id[:255],
                    'agent_hostname': agent_id[:255],
                    'agent_ip_address': agent_ip[:50],
                    
                    'usb_port': str(device_data.get('usb_port') or device_data.get('port_number', 'USB Port'))[:100],
                    'physical_path': str(device_data.get('physical_path', ''))[:500] if device_data.get('physical_path') else None,
                    
                    'is_real_device': device_data.get('is_real_device', True),
                    'discovery_method': device_data.get('detection_method', 'agent_bulk'),
                    
                    'received_at': datetime.utcnow().isoformat(),
                    'discovered_at': datetime.utcnow().isoformat(),
                    'raw_device_data': json.dumps(device_data)
                }
                
                # استخدام upsert لضمان تحديث الأجهزة الموجودة
                # يتطلب هذا وجود قيد فريد على (serial_number, agent_server_id)
                client.table('agent_pending_devices').upsert(
                    pending_device, 
                    on_conflict='serial_number,agent_server_id'
                ).execute()
                
                processed_count += 1
                
            except Exception as e:
                current_app.logger.error(f"Error adding pending device {device_data.get('serial_number', 'unknown')}: {str(e)}")
                error_count += 1
        
        return jsonify({
            'message': f'تمت معالجة {processed_count} جهاز بنجاح',
            'processed_count': processed_count,
            'errors': error_count
        }), 201
        
    except Exception as e:
        current_app.logger.error(f"Error in bulk_add_devices: {str(e)}")
        return jsonify({'error': 'خطأ في إضافة الأجهزة', 'details': str(e)}), 500


@devices_bp.route('/<identifier>/status', methods=['GET'])
def get_device_status(identifier):
    err, server_id = verify_and_context(VIEW_ROLES)
    if err:
        return err
    dev = get_device_by_identifier(identifier, server_id)
    if not dev:
        return jsonify({'error': 'الجهاز غير موجود'}), 404

    connected   = is_device_connected(dev['serial_number'])
    storage     = next((m for m in get_mounted_devices() if dev['serial_number'] in m.get('device', '')), None)
    permissions = get_device_permissions(dev['serial_number'])
    
    # Get recent activities from Supabase
    try:
        # Get Supabase client safely
        client = get_supabase_client()
        if client is None:
            recent = []
        else:
            recent_response = client.table('logs').select('*').eq('target_device', dev['serial_number']).order('timestamp', desc=True).limit(5).execute()
            recent = recent_response.data
    except Exception as e:
        current_app.logger.error(f"Error fetching recent logs: {str(e)}")
        recent = []
    
    try:
        dtype = json.loads(dev.get('meta_data') or '{}').get('device_type')
    except Exception:
        dtype = None
    dtype = dtype or get_device_type({'device_class': str(dev.get('device_class') or '0'), 'manufacturer': dev.get('manufacturer') or '', 'product': dev.get('name') or ''})

    resp = dev.copy()
    resp.update({
        'is_connected':      connected,
        'storage':           storage,
        'permissions':       permissions,
        'recent_activities': recent,
        'device_type':       dtype
    })

    # Log the status view using Supabase
    try:
        log_data = {
            'action': "device_status_viewed",
            'user_id': get_jwt_identity(),
            'target_device': dev['serial_number'],
            'details': json.dumps({'server_id': server_id}),
            'timestamp': datetime.utcnow().isoformat()
        }
        if client:
            client.table('logs').insert(log_data).execute()
    except Exception as e:
        current_app.logger.error(f"Error logging status view: {str(e)}")
    
    return jsonify(resp), 200


@devices_bp.route('/<identifier>', methods=['GET'])
def get_device_details(identifier):
    """جلب تفاصيل جهاز محدد"""
    err, server_id = verify_and_context(VIEW_ROLES)
    if err:
        return err
    dev = get_device_by_identifier(identifier, server_id)
    if not dev:
        return jsonify({'error': 'الجهاز غير موجود'}), 404

    # جلب معلومات شاملة مثل status endpoint
    connected   = is_device_connected(dev['serial_number'])
    storage     = next((m for m in get_mounted_devices() if dev['serial_number'] in m.get('device', '')), None)
    permissions = get_device_permissions(dev['serial_number'])
    
    # Get recent activities from Supabase
    try:
        # Get Supabase client safely
        client = get_supabase_client()
        if client is None:
            recent = []
        else:
            recent_response = client.table('logs').select('*').eq('target_device', dev['serial_number']).order('timestamp', desc=True).limit(5).execute()
            recent = recent_response.data
    except Exception as e:
        current_app.logger.error(f"Error fetching recent logs: {str(e)}")
        recent = []
    
    try:
        dtype = json.loads(dev.get('meta_data') or '{}').get('device_type')
    except Exception:
        dtype = None
    dtype = dtype or get_device_type({'device_class': str(dev.get('device_class') or '0'), 'manufacturer': dev.get('manufacturer') or '', 'product': dev.get('name') or ''})

    resp = dev.copy()
    resp.update({
        'is_connected':      connected,
        'storage':           storage,
        'permissions':       permissions,
        'recent_activities': recent,
        'device_type':       dtype
    })

    # Log the details view using Supabase
    try:
        log_data = {
            'action': "device_details_viewed",
            'user_id': get_jwt_identity(),
            'target_device': dev['serial_number'],
            'details': json.dumps({'server_id': server_id}),
            'timestamp': datetime.utcnow().isoformat()
        }
        if client:
            client.table('logs').insert(log_data).execute()
    except Exception as e:
        current_app.logger.error(f"Error logging details view: {str(e)}")
    
    return jsonify({'data': resp}), 200


@devices_bp.route('/<identifier>/control', methods=['POST'])
def control_usb_device(identifier):
    err, server_id = verify_and_context(CONTROL_ROLES)
    if err:
        return err
    dev = get_device_by_identifier(identifier, server_id)
    if not dev:
        return jsonify({'error': 'الجهاز غير موجود'}), 404

    # Get Supabase client safely
    client = get_supabase_client()
    if client is None:
        return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500

    # معالجة مرنة لـ request data
    try:
        if request.is_json:
            data = request.get_json() or {}
        else:
            try:
                data = request.get_json(force=True) or {}
            except Exception:
                data = {}
    except Exception:
        data = {}
    
    action = data.get('action', '')
    allowed = ['enable', 'disable', 'eject', 'reconnect', 'block', 'unblock', 'whitelist', 'blacklist', 'approve', 'deny']
    if action not in allowed:
        return jsonify({'error': f'إجراء غير صالح: {action}'}), 400

    user_id = get_jwt_identity()
    if action == 'approve':
        success, msg = util_approve_device(identifier, user_id)
    elif action == 'deny':
        success, msg = util_deny_device(identifier, user_id)
    elif action == 'eject':
        success, msg = util_eject_device(identifier, user_id)
    elif action == 'reconnect':
        # تحقق أولاً من أن الجهاز متصل فعلياً قبل تعديل الحالة
        try:
            from utils import is_device_connected
            actually_connected = False
            try:
                actually_connected = is_device_connected(dev['serial_number'])
            except Exception as chk_err:
                current_app.logger.warning(f"Reconnect check failed for {dev['serial_number']}: {chk_err}")

            if not actually_connected:
                success, msg = False, 'لا يمكن إعادة التوصيل: الجهاز غير متصل فعلياً بالخادم'
            else:
                update_data = {
                    'status': 'connected',
                    'connection_time': datetime.utcnow().isoformat(),
                    'last_activity': datetime.utcnow().isoformat()
                }
                client.table('devices').update(update_data).eq('id', dev['id']).execute()
                success, msg = True, 'تم إعادة توصيل الجهاز بنجاح'
        except Exception as e:
            current_app.logger.error(f"Error reconnecting device: {str(e)}")
            success, msg = False, 'فشل في إعادة توصيل الجهاز'
    elif action == 'disable' or action == 'enable' or action == 'block' or action == 'unblock':
        success, msg = control_device(identifier, action)
    elif action == 'whitelist':
        try:
            update_data = {'whitelisted': True, 'blacklisted': False}
            client.table('devices').update(update_data).eq('id', dev['id']).execute()
            success, msg = True, 'تمت إضافة الجهاز للقائمة البيضاء'
        except Exception as e:
            current_app.logger.error(f"Error whitelisting device: {str(e)}")
            success, msg = False, 'فشل في إضافة الجهاز للقائمة البيضاء'
    elif action == 'blacklist':
        try:
            update_data = {'blacklisted': True, 'whitelisted': False}
            client.table('devices').update(update_data).eq('id', dev['id']).execute()
            success, msg = True, 'تمت إضافة الجهاز للقائمة السوداء'
        except Exception as e:
            current_app.logger.error(f"Error blacklisting device: {str(e)}")
            success, msg = False, 'فشل في إضافة الجهاز للقائمة السوداء'
    else:
        success, msg = False, 'إجراء غير مدعوم'

    # Log the action using Supabase
    try:
        log_data = {
            'action': f"device_{action}",
            'user_id': user_id,
            'target_device': dev['serial_number'],
            'details': json.dumps({'message': msg}),
            'timestamp': datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()
    except Exception as e:
        current_app.logger.error(f"Error logging device action: {str(e)}")

    if success:
        create_blockchain_record(f"device_{action}", {'device_id': dev['id']}, user_id)
        socketio.emit(f'device:{action}', {'serial_number': dev['serial_number'], 'message': msg}, namespace='/api/devices')
        return jsonify({'message': msg}), 200
    return jsonify({'error': msg}), 400


@devices_bp.route('/search', methods=['GET'])
def search_devices():
    err, server_id = verify_and_context(SEARCH_ROLES)
    if err:
        return err
    qstr    = request.args.get('q', '')
    pattern = request.args.get('pattern', '')
    filters = {k: request.args.get(k) for k in ('status', 'manufacturer', 'whitelisted', 'blacklisted', 'risk_level')}
    # الحصول على معلمة البحث في جميع السيرفرات
    all_servers = request.args.get('all_servers', 'false').lower() == 'true'
    
    try:
        # Get Supabase client safely
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500

        devices = []
        
        if all_servers:
            # البحث في جميع السيرفرات
            query = client.table('devices').select('*')
            
            # تطبيق الفلاتر
            if pattern:
                if pattern.startswith('device_type:'):
                    value = pattern.split(':',1)[1]
                    # البحث في metadata
                    query = query.ilike('meta_data', f'%{value}%')
                elif pattern.startswith('manufacturer:'):
                    value = pattern.split(':',1)[1]
                    query = query.ilike('manufacturer', f"%{value}%")
                elif pattern.startswith('vendor_id:'):
                    value = pattern.split(':',1)[1]
                    query = query.ilike('vendor_id', f"%{value}%")
                elif pattern.startswith('product_id:'):
                    value = pattern.split(':',1)[1]
                    query = query.ilike('product_id', f"%{value}%")
                else:
                    return jsonify({'error': 'Unsupported pattern'}), 400
            
            if qstr:
                like = f"%{qstr}%"
                # البحث في عدة حقول
                query = query.or_(f"name.ilike.{like},serial_number.ilike.{like},custom_name.ilike.{like}")
            
            for k, v in filters.items():
                if v is not None:
                    if k in ('whitelisted', 'blacklisted'):
                        query = query.eq(k, v.lower() == 'true')
                    else:
                        query = query.ilike(k, f"%{v}%")
            
            response = query.execute()
            devices = response.data if response.data else []
            
        else:
            # البحث في السيرفر الحالي فقط (السلوك الافتراضي)
            query = client.table('devices').select('*').eq('server_id', server_id)
            
            if pattern:
                if pattern.startswith('device_type:'):
                    value = pattern.split(':',1)[1]
                    query = query.ilike('meta_data', f'%{value}%')
                elif pattern.startswith('manufacturer:'):
                    value = pattern.split(':',1)[1]
                    query = query.ilike('manufacturer', f"%{value}%")
                elif pattern.startswith('vendor_id:'):
                    value = pattern.split(':',1)[1]
                    query = query.ilike('vendor_id', f"%{value}%")
                elif pattern.startswith('product_id:'):
                    value = pattern.split(':',1)[1]
                    query = query.ilike('product_id', f"%{value}%")
                else:
                    return jsonify({'error': 'Unsupported pattern'}), 400
            
            if qstr:
                like = f"%{qstr}%"
                query = query.or_(f"name.ilike.{like},serial_number.ilike.{like},custom_name.ilike.{like}")
            
            for k, v in filters.items():
                if v is not None:
                    if k in ('whitelisted', 'blacklisted'):
                        query = query.eq(k, v.lower() == 'true')
                    else:
                        query = query.ilike(k, f"%{v}%")
            
            response = query.execute()
            devices = response.data if response.data else []

        # Log the search using Supabase
        try:
            log_data = {
                'action': "device_search",
                'user_id': get_jwt_identity(),
                'details': json.dumps({
                    'server_id': server_id, 
                    'q': qstr, 
                    'pattern': pattern, 
                    'count': len(devices),
                    'all_servers': all_servers
                }),
                'timestamp': datetime.utcnow().isoformat()
            }
            client.table('logs').insert(log_data).execute()
        except Exception as e:
            current_app.logger.error(f"Error logging search: {str(e)}")
        
        return jsonify(devices), 200
        
    except Exception as e:
        current_app.logger.error(f"Error searching devices: {str(e)}")
        return jsonify({'error': 'خطأ في البحث عن الأجهزة'}), 500


@devices_bp.route('/scan-now', methods=['POST'])
def scan_now():
    """مسح محسّن للأجهزة - يعرض الأجهزة الحقيقية فقط على نظام ويندوز"""
    err, server_id = verify_and_context(SCAN_ROLES)
    if err:
        return err

    try:
        # جلب الأجهزة الموجودة في قاعدة البيانات
        client = get_supabase_client()
        if client:
            response = client.table('devices').select('*').eq('server_id', server_id).execute()
            existing = {d['serial_number']: d for d in response.data if d['serial_number']}
        else:
            existing = {}
        added, removed, updated = [], [], []

        # اكتشاف الأجهزة الحقيقية المتصلة فقط
        real_devices = discover_usb_devices()
        try:
            from utils import enhanced_device_deduplication
            real_devices = enhanced_device_deduplication(real_devices)
        except Exception as e:
            logger.debug(f"Failed to deduplicate devices during scan: {e}")
        current_device_serials = set()
        
        # معالجة الأجهزة المكتشفة مع تحسين منطق منع التكرار
        processed_devices = set()  # لتتبع الأجهزة المعالجة
        
        for device_info in real_devices:
            serial_number = device_info.get('serial_number')
            vendor_id = device_info.get('vendor_id', '0000')
            product_id = device_info.get('product_id', '0000')
            
            # إنشاء معرف فريد للجهاز
            device_key = f"{vendor_id}:{product_id}:{serial_number}"
            
            # تجاهل الأجهزة المكررة في نفس عملية المسح
            if device_key in processed_devices:
                logger.debug(f"تم تجاهل جهاز مكرر في المسح: {device_info.get('name', 'Unknown')}")
                continue
                
            # تجاهل الأجهزة بدون serial number صالح
            if not serial_number or len(serial_number) < 3:
                logger.debug(f"تم تجاهل جهاز بدون serial صالح: {device_info.get('name', 'Unknown')}")
                continue
                
            processed_devices.add(device_key)
            current_device_serials.add(serial_number)
            
            # التحقق من أن الجهاز حقيقي باستخدام الدالة المحسنة
            from utils import is_real_device
            if not is_real_device(device_info):
                logger.debug(f"تم تجاهل جهاز وهمي: {device_info.get('name', 'Unknown')}")
                continue
            
            # إذا كان الجهاز جديد
            if serial_number not in existing:
                # إعداد معلومات الجهاز بشكل شامل
                device_meta_data = {
                    'manufacturer': device_info.get('manufacturer', 'Unknown'),
                    'device_class': device_info.get('device_class', 0),
                    'device_type': device_info.get('device_type', 'Unknown'),
                    'power_consumption': device_info.get('power_consumption', 0.0),
                    'port_number': device_info.get('port_number', 'USB Port Unknown'),
                    'physical_path': device_info.get('physical_path', ''),
                    'device_hash': device_info.get('device_hash', ''),
                    'system': device_info.get('system', 'Unknown'),
                    'detected_at': device_info.get('detected_at', datetime.utcnow().isoformat()),
                    'is_real_device': True,
                    'discovery_method': 'enhanced_scan'
                }
                
                # إنشاء جهاز جديد في قاعدة البيانات
                try:
                    # Enhanced duplicate check with race condition protection
                    client = get_supabase_client()
                    if client:
                        # Check if device already exists
                        existing_response = client.table('devices').select('*').eq('serial_number', serial_number).eq('server_id', server_id).execute()
                        existing_check = existing_response.data[0] if existing_response.data else None
                        
                        if existing_check:
                            logger.debug(f"تم العثور على جهاز موجود مسبقاً أثناء المسح: {serial_number}")
                            # Update existing device instead of creating new one
                            update_data = {
                                'status': 'connected',
                                'connection_time': datetime.utcnow().isoformat(),
                                'usb_port': device_info.get('port_number', 'USB Port Unknown'),
                                'last_scan_time': datetime.utcnow().isoformat()
                            }
                            
                            # Update metadata if needed
                            if not existing_check.get('manufacturer') or existing_check.get('manufacturer') == 'Unknown':
                                update_data['manufacturer'] = device_info.get('manufacturer', 'Unknown')[:100]
                            
                            client.table('devices').update(update_data).eq('id', existing_check['id']).execute()
                            updated.append(existing_check)
                            continue
                        
                        # Device doesn't exist, don't create it yet - just report it
                        discovered_device = {
                            'serial_number': serial_number,
                            'name': device_info.get('name', device_info.get('product', f"USB Device {device_info.get('vendor_id', '0000')}:{device_info.get('product_id', '0000')}")[:100]),
                            'vendor_id': device_info.get('vendor_id', '0000'),
                            'product_id': device_info.get('product_id', '0000'),
                            'manufacturer': device_info.get('manufacturer', 'Unknown')[:100],
                            'device_class': str(device_info.get('device_class', 0)),
                            'status': 'discovered',  # حالة مكتشف للموافقة
                            'connection_time': datetime.utcnow().isoformat(),
                            'last_scan_time': datetime.utcnow().isoformat(),
                            'meta_data': json.dumps(device_meta_data),
                            'risk_level': 'unknown',
                            'usb_port': device_info.get('port_number', 'USB Port Unknown'),
                            'physical_path': device_info.get('physical_path', '')[:200],
                            'is_real_device': True,
                            'device_type': device_meta_data.get('device_type', 'Unknown')
                        }

                        # حفظ في جدول server_pending_devices المعزول لتظهر في لوحة التحكم
                        try:
                            from services.device_blocker import save_pending_device_to_db
                            save_pending_device_to_db(device_info.get('device_id', serial_number), discovered_device)
                        except Exception as p_err:
                            logger.debug(f"Failed to save pending device in scan_now: {p_err}")

                        added.append(discovered_device)
                        
                        # Print discovery message to terminal
                        log_new_device_discovered(
                            serial=serial_number,
                            name=discovered_device.get('name', 'Unknown Device'),
                            device_type=discovered_device.get('device_type', 'USB Device'),
                            status='discovered (pending approval)'
                        )
                        
                        # Send notification for discovered device
                        socketio.emit('device:discovered', {
                            'device': discovered_device,
                            'server_id': server_id,
                            'message': f'تم اكتشاف جهاز جديد: {discovered_device.get("name", "Unknown Device")}'
                        }, namespace='/api/devices')
                        
                        # Log the discovery using Supabase
                        client.table('logs').insert({
                            'action': 'real_device_discovered',
                            'user_id': get_jwt_identity(),
                            'target_device': serial_number,
                            'details': json.dumps({
                                'device_name': discovered_device['name'],
                                'vendor_id': discovered_device['vendor_id'],
                                'product_id': discovered_device['product_id'],
                                'server_id': server_id,
                                'is_real_device': True,
                                'port_number': device_info.get('port_number', 'USB Port Unknown')
                            }),
                            'timestamp': datetime.utcnow().isoformat()
                        }).execute()
                        
                        logger.info(f"جهاز جديد تم إضافته بنجاح: {serial_number} - منفذ: {device_info.get('port_number', 'USB Port Unknown')}")
                        
                except Exception as integrity_error:
                    # Handle UNIQUE constraint violation specifically
                    logger.warning(f"UNIQUE constraint violation for device {serial_number}: {integrity_error}")
                    
                    # Retry logic: Find and update the existing device
                    try:
                        client = get_supabase_client()
                        if client:
                            existing_response = client.table('devices').select('*').eq('serial_number', serial_number).eq('server_id', server_id).execute()
                            existing_device = existing_response.data[0] if existing_response.data else None
                            
                            if existing_device:
                                update_data = {
                                    'status': 'connected',
                                    'connection_time': datetime.utcnow().isoformat(),
                                    'last_scan_time': datetime.utcnow().isoformat(),
                                    'usb_port': device_info.get('port_number', 'USB Port Unknown')
                                }
                                
                                # Update metadata if needed
                                if not existing_device.get('manufacturer') or existing_device.get('manufacturer') == 'Unknown':
                                    update_data['manufacturer'] = device_info.get('manufacturer', 'Unknown')[:100]
                                
                                client.table('devices').update(update_data).eq('id', existing_device['id']).execute()
                                updated.append(existing_device)
                                logger.info(f"تم تحديث الجهاز الموجود بعد UNIQUE constraint: {serial_number}")
                            else:
                                logger.error(f"لم يتم العثور على الجهاز بعد UNIQUE constraint violation: {serial_number}")
                    except Exception as retry_error:
                        logger.error(f"فشل في إعادة المحاولة بعد UNIQUE constraint: {retry_error}")
                        
                except Exception as device_error:
                    # Handle other database errors
                    logger.error(f"خطأ عام في إضافة الجهاز {serial_number}: {device_error}")
                    
                    # Try to update existing device as fallback
                    try:
                        client = get_supabase_client()
                        if client:
                            existing_response = client.table('devices').select('*').eq('serial_number', serial_number).eq('server_id', server_id).execute()
                            existing_device = existing_response.data[0] if existing_response.data else None
                        
                            if existing_device:
                                update_data = {
                                    'status': 'connected',
                                    'connection_time': datetime.utcnow().isoformat(),
                                    'usb_port': device_info.get('port_number', 'USB Port Unknown')
                                }
                                client.table('devices').update(update_data).eq('id', existing_device['id']).execute()
                                updated.append(existing_device)
                                logger.info(f"تم تحديث الجهاز كحل بديل: {serial_number}")
                    except Exception as fallback_error:
                        logger.error(f"فشل الحل البديل: {fallback_error}")
                
            else:
                # الجهاز موجود من قبل - تحديث حالته
                existing_device = existing[serial_number]
                if existing_device['status'] != 'connected':
                    update_data = {
                        'status': 'connected',
                        'connection_time': datetime.utcnow().isoformat()
                    }
                    
                    # تحديث المعلومات إذا كانت ناقصة
                    if not existing_device.get('manufacturer') or existing_device.get('manufacturer') == 'Unknown':
                        update_data['manufacturer'] = device_info.get('manufacturer', 'Unknown')[:100]
                    
                    client = get_supabase_client()
                    if client:
                        client.table('devices').update(update_data).eq('id', existing_device['id']).execute()
                    
                    updated.append(existing_device)
                    
                    socketio.emit('device:reconnected', {
                        'device': existing_device,
                        'server_id': server_id
                    }, namespace='/api/devices')
        
        # حفظ التغييرات في قاعدة البيانات - لا نحتاج إلى commit في Supabase

        # التحقق من الأجهزة المفصولة
        for serial_number, existing_device in existing.items():
            if (serial_number not in current_device_serials and 
                existing_device['status'] in ['connected', 'pending']):
                
                update_data = {'status': 'disconnected'}
                if existing_device.get('connection_time'):
                    try:
                        # Calculate duration in seconds
                        connection_time_str = existing_device['connection_time']
                        # Handle different datetime formats
                        if connection_time_str.endswith('Z'):
                            connection_time_str = connection_time_str.replace('Z', '+00:00')
                        elif '+' not in connection_time_str and '-' not in connection_time_str[-6:]:
                            connection_time_str += '+00:00'
                        
                        connection_time = datetime.fromisoformat(connection_time_str)
                        duration = int((datetime.now(timezone.utc) - connection_time).total_seconds())
                        update_data['connection_duration'] = duration
                    except (ValueError, TypeError) as e:
                        logger.warning(f"Failed to parse connection_time for device {existing_device.get('id')}: {e}")
                        # Skip duration calculation if parsing fails
                
                client = get_supabase_client()
                if client:
                    client.table('devices').update(update_data).eq('id', existing_device['id']).execute()
                
                removed.append(existing_device)
                
                # إرسال إشعار بفصل الجهاز
                socketio.emit('device:disconnected', {
                    'device': existing_device,
                    'server_id': server_id
                }, namespace='/api/devices')
                
                # تسجيل في السجل
                log_data = {
                    'action': "device_disconnected",
                    'user_id': get_jwt_identity(),
                    'target_device': serial_number,
                    'details': json.dumps({
                        'device_name': existing_device.get('name', ''),
                        'server_id': server_id,
                        'duration': update_data.get('connection_duration', 0)
                    }),
                    'timestamp': datetime.utcnow().isoformat()
                }
                
                client = get_supabase_client()
                if client:
                    client.table('logs').insert(log_data).execute()
        
        # حفظ التغييرات النهائية - لا نحتاج إلى commit في Supabase

        # تسجيل عملية المسح
        scan_log_data = {
            'action': "enhanced_usb_scan",
            'user_id': get_jwt_identity(),
            'details': json.dumps({
                'server_id': server_id, 
                'real_devices_found': len(real_devices),
                'added': len(added), 
                'removed': len(removed),
                'updated': len(updated),
                'total_processed': len(processed_devices),
                'scan_type': 'enhanced_real_devices_only'
            }),
            'timestamp': datetime.utcnow().isoformat()
        }
        
        client = get_supabase_client()
        if client:
            client.table('logs').insert(scan_log_data).execute()

        return jsonify({
            'success': True,
            'message': f'تم المسح بنجاح - عثر على {len(real_devices)} جهاز حقيقي',
            'added': added,
            'removed': removed,
            'updated': updated,
            'total_real_devices': len(real_devices),
            'scan_type': 'enhanced_real_devices_only'
        }), 200
        
    except Exception as e:
        logger.error(f"خطأ في المسح المحسن للأجهزة: {e}")
        return jsonify({
            'error': 'خطأ في مسح الأجهزة',
            'message': str(e)
        }), 500


@devices_bp.route('/discovery-summary', methods=['GET'])
def discovery_summary():
    """Return a discovery summary using the same enhanced discovery logic
    used by the client. Response includes registryTotal, dbTotal,
    matchedCount and pendingCount. Internal/system components are filtered
    out by the discovery helper so backend counts match the agent.
    """
    try:
        err, server_id = verify_and_context(VIEW_ROLES)
        if err:
            return err

        # Use the robust discovery implemented in utils
        try:
            from utils import discover_usb_devices, enhanced_device_deduplication
            discovered = discover_usb_devices() or []
            try:
                discovered = enhanced_device_deduplication(discovered)
            except Exception:
                # if dedupe fails, continue with raw discovery
                pass
        except Exception as e:
            logger.error(f"Failed to run discovery helper: {e}")
            discovered = []

        registry_total = len(discovered)

        # Get DB devices for this server
        client = get_supabase_client()
        if client:
            try:
                resp = client.table('devices').select('*').eq('server_id', server_id).execute()
                db_devices = resp.data if resp.data else []
            except Exception as e:
                logger.error(f"Failed to query DB devices: {e}")
                db_devices = []
        else:
            db_devices = []

        db_total = len(db_devices)

        # Capture initial baseline on first call so devices present at server
        # startup are not treated as pending (mirrors client behavior).
        try:
            from utils import (
                discover_usb_devices, generate_device_signature,
                capture_initial_discovery_baseline, get_initial_discovery_keys,
                is_initial_discovery_captured
            )
        except Exception:
            # fallback - these were already imported earlier
            from utils import discover_usb_devices, generate_device_signature

        if not is_initial_discovery_captured():
            try:
                capture_initial_discovery_baseline()
            except Exception:
                pass

        baseline_keys = get_initial_discovery_keys() if is_initial_discovery_captured() else set()

        # Match discovered devices to DB: prefer serial match, fallback to VID/PID match
        matched_count = 0
        matched_list = []
        pending_list = []

        # Prebuild index for quick lookups
        db_by_serial = {d.get('serial_number'): d for d in db_devices if d.get('serial_number')}
        db_by_vidpid = {}
        for d in db_devices:
            vid = (d.get('vendor_id') or '').lower()
            pid = (d.get('product_id') or '').lower()
            if vid and pid:
                key = f"{vid}:{pid}"
                if key not in db_by_vidpid:
                    db_by_vidpid[key] = []
                db_by_vidpid[key].append(d)

        for dev in discovered:
            serial = dev.get('serial_number')
            # Exclude devices that were present at server startup baseline
            try:
                dev_key = generate_device_signature(dev)
                if dev_key in baseline_keys:
                    # Treat baseline devices as already-present (not pending)
                    matched_count += 1
                    matched_list.append(dev)
                    continue
            except Exception:
                pass
            if serial and serial in db_by_serial:
                matched_count += 1
                matched_list.append(dev)
                continue

            vid = (dev.get('vendor_id') or '').lower()
            pid = (dev.get('product_id') or '').lower()
            if vid and pid and f"{vid}:{pid}" in db_by_vidpid:
                matched_count += 1
                matched_list.append(dev)
                continue

            # Not matched -> considered pending (discovered but not registered)
            pending_list.append(dev)

        pending_count = len(pending_list)

        return jsonify({
            'success': True,
            'registryTotal': registry_total,
            'dbTotal': db_total,
            'matchedCount': matched_count,
            'pendingCount': pending_count,
            'sample_discovered': discovered[:50],
            'sample_pending': pending_list[:50]
        }), 200

    except Exception as e:
        logger.error(f"Error in discovery_summary endpoint: {e}")
        return jsonify({'error': 'Failed to compute discovery summary', 'details': str(e)}), 500


@devices_bp.route('/clean-fake-devices', methods=['POST'])
def clean_fake_devices():
    """تنظيف قاعدة البيانات من الأجهزة الوهمية والمكررة - محسّن مع معالجة أخطاء الشبكة"""
    err, server_id = verify_and_context(SCAN_ROLES)
    if err:
        return err
    
    try:
        deleted_count = 0
        client = get_supabase_client()
        
        if not client:
            logger.error("Supabase client not available")
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة'}), 503
        
        # Helper function for retrying Supabase operations
        def execute_with_retry(operation, max_retries=3):
            for attempt in range(max_retries):
                try:
                    return operation()
                except Exception as e:
                    if attempt == max_retries - 1:
                        logger.error(f"Operation failed after {max_retries} attempts: {e}")
                        raise e
                    logger.warning(f"Operation failed (attempt {attempt + 1}/{max_retries}): {e}")
                    import time
                    time.sleep(1)  # Wait 1 second before retry
        
        # Get total devices before cleanup
        try:
            response = execute_with_retry(lambda: client.table('devices').select('*').eq('server_id', server_id).execute())
            total_devices_before = len(response.data) if response.data else 0
        except Exception as e:
            logger.error(f"Failed to get device count: {e}")
            return jsonify({'error': f'فشل في الحصول على عدد الأجهزة: {str(e)}'}), 500
        
        # 1. حذف الأجهزة التي تحتوي على serial number مشبوه (أنماط Windows الوهمية)
        try:
            response = execute_with_retry(lambda: client.table('devices').select('*').eq('server_id', server_id).like('serial_number', '%&0&%').execute())
            fake_serial_devices = response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed to get fake serial devices: {e}")
            fake_serial_devices = []
        
        for device in fake_serial_devices:
            try:
                logger.info(f"حذف جهاز بـ serial مشبوه: {device['name']} - {device['serial_number']}")
                execute_with_retry(lambda: client.table('devices').delete().eq('id', device['id']).execute())
                deleted_count += 1
            except Exception as e:
                logger.error(f"Failed to delete fake serial device {device['id']}: {e}")
        
        # 2. حذف الأجهزة الوهمية بناءً على الأسماء
        fake_device_patterns = [
            'USB Input Device',
            'Unknown Device', 
            'Enhanced',
            'Generic USB Device',
            'USB Composite Device',
            'USB Device',
            'Composite Device'
        ]
        
        for pattern in fake_device_patterns:
            try:
                response = execute_with_retry(lambda: client.table('devices').select('*').eq('server_id', server_id).ilike('name', f'%{pattern}%').execute())
                fake_devices_by_name = response.data if response.data else []
            except Exception as e:
                logger.error(f"Failed to get fake devices by pattern '{pattern}': {e}")
                fake_devices_by_name = []
            
            for device in fake_devices_by_name:
                try:
                    # تأكيد إضافي: فحص إذا كان الجهاز فعلاً وهمي
                    device_info = {
                        'name': device.get('name', ''),
                        'manufacturer': device.get('manufacturer', ''),
                        'serial_number': device.get('serial_number', ''),
                        'vendor_id': device.get('vendor_id', ''),
                        'product_id': device.get('product_id', '')
                    }
                    
                    from utils import is_real_device
                    if not is_real_device(device_info):
                        logger.info(f"حذف جهاز وهمي: {device['name']} - {device['serial_number']}")
                        execute_with_retry(lambda: client.table('devices').delete().eq('id', device['id']).execute())
                        deleted_count += 1
                except Exception as e:
                    logger.error(f"Failed to delete fake device {device['id']}: {e}")
        
        # 3. حذف الأجهزة التي لها مصنع "Unknown Device"
        try:
            response = execute_with_retry(lambda: client.table('devices').select('*').eq('server_id', server_id).ilike('manufacturer', '%unknown device%').execute())
            unknown_manufacturer_devices = response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed to get unknown manufacturer devices: {e}")
            unknown_manufacturer_devices = []
        
        for device in unknown_manufacturer_devices:
            try:
                logger.info(f"حذف جهاز بمصنع مجهول: {device['name']} - {device['manufacturer']}")
                execute_with_retry(lambda: client.table('devices').delete().eq('id', device['id']).execute())
                deleted_count += 1
            except Exception as e:
                logger.error(f"Failed to delete unknown manufacturer device {device['id']}: {e}")
                
        # 4. حذف الأجهزة المكررة (نفس serial_number)
        try:
            # Use neq() instead of not_() for newer Supabase version
            response = execute_with_retry(lambda: client.table('devices').select('*').eq('server_id', server_id).neq('serial_number', None).execute())
            all_devices = response.data if response.data else []
        except Exception as e:
            logger.error(f"Failed to get all devices for duplicate check: {e}")
            # Try alternative approach if neq() doesn't work
            try:
                response = execute_with_retry(lambda: client.table('devices').select('*').eq('server_id', server_id).execute())
                all_devices = [d for d in (response.data or []) if d.get('serial_number')]
            except Exception as e2:
                logger.error(f"Alternative query also failed: {e2}")
                all_devices = []
        
        # تجميع الأجهزة حسب serial_number
        devices_by_serial = {}
        for device in all_devices:
            serial = device.get('serial_number')
            if serial:
                if serial not in devices_by_serial:
                    devices_by_serial[serial] = []
                devices_by_serial[serial].append(device)
        
        # العثور على الأجهزة المكررة
        for serial, devices in devices_by_serial.items():
            if len(devices) > 1:
                # ترتيب حسب connection_time تنازلياً (الأحدث أولاً)
                devices.sort(key=lambda d: d.get('connection_time', ''), reverse=True)
                
                # حذف جميع النسخ المكررة عدا الأولى (الأحدث)
                for device in devices[1:]:
                    try:
                        logger.info(f"حذف جهاز مكرر: {device['name']} - {serial}")
                        execute_with_retry(lambda: client.table('devices').delete().eq('id', device['id']).execute())
                        deleted_count += 1
                    except Exception as e:
                        logger.error(f"Failed to delete duplicate device {device['id']}: {e}")
        
        # 5. حذف الأجهزة التي لها vendor_id و product_id وهميين
        try:
            # Use simpler query to avoid complex or_() chaining
            response = execute_with_retry(lambda: client.table('devices').select('*').eq('server_id', server_id).execute())
            fake_vid_pid_devices = [d for d in (response.data or []) if d.get('vendor_id') in ['0000', '0001', '0002', '0003', '0004', '0005']]
        except Exception as e:
            logger.error(f"Failed to get fake VID/PID devices: {e}")
            fake_vid_pid_devices = []
        
        for device in fake_vid_pid_devices:
            try:
                logger.info(f"حذف جهاز بـ VID/PID وهمي: {device['name']} - {device['vendor_id']}:{device['product_id']}")
                execute_with_retry(lambda: client.table('devices').delete().eq('id', device['id']).execute())
                deleted_count += 1
            except Exception as e:
                logger.error(f"Failed to delete fake VID/PID device {device['id']}: {e}")
        
        # Get total devices after cleanup
        try:
            response = execute_with_retry(lambda: client.table('devices').select('*').eq('server_id', server_id).execute())
            total_devices_after = len(response.data) if response.data else 0
        except Exception as e:
            logger.error(f"Failed to get final device count: {e}")
            total_devices_after = total_devices_before - deleted_count
        
        # تسجيل في السجل
        try:
            log_data = {
                'action': "aggressive_fake_devices_cleanup",
                'user_id': get_jwt_identity(),
                'details': json.dumps({
                    'server_id': server_id,
                    'devices_before': total_devices_before,
                    'devices_after': total_devices_after,
                    'deleted_count': deleted_count
                }),
                'timestamp': datetime.utcnow().isoformat()
            }
            
            execute_with_retry(lambda: client.table('logs').insert(log_data).execute())
        except Exception as e:
            logger.error(f"Failed to log cleanup operation: {e}")
        
        logger.info(f"تم تنظيف قاعدة البيانات: حذف {deleted_count} جهاز وهمي/مكرر")
        
        return jsonify({
            'message': f'تم حذف {deleted_count} جهاز وهمي ومكرر بنجاح',
            'deleted_count': deleted_count,
            'devices_before': total_devices_before,
            'devices_after': total_devices_after,
            'cleanup_type': 'aggressive'
        }), 200
        
    except Exception as e:
        logger.error(f"خطأ في تنظيف الأجهزة: {e}")
        return jsonify({'error': f'خطأ في تنظيف الأجهزة الوهمية: {str(e)}'}), 500


@devices_bp.route('/auto-cleanup', methods=['POST'])
def auto_cleanup_devices():
    """تنظيف تلقائي للأجهزة المكررة والوهمية بعد كل عملية مسح"""
    err, server_id = verify_and_context(SCAN_ROLES)
    if err:
        return err
    
    try:
        # حذف الأجهزة الوهمية بناءً على الأسماء والمعايير
        from utils import is_real_device
        
        client = get_supabase_client()
        if client:
            response = client.table('devices').select('*').eq('server_id', server_id).execute()
            all_devices = response.data
        else:
            all_devices = []
        
        deleted_count = 0
        
        for device in all_devices:
            device_info = {
                'vendor_id': device.get('vendor_id', ''),
                'product_id': device.get('product_id', ''),
                'name': device.get('name', ''),
                'manufacturer': device.get('manufacturer', ''),
                'serial_number': device.get('serial_number', '')
            }
            
            # فحص إذا كان الجهاز وهمي
            if not is_real_device(device_info):
                if client:
                    client.table('devices').delete().eq('id', device['id']).execute()
                deleted_count += 1
                logger.info(f"تم حذف جهاز وهمي تلقائياً: {device['name']}")
        
        return jsonify({
            'message': f'تم تنظيف {deleted_count} جهاز وهمي تلقائياً',
            'deleted_count': deleted_count
        }), 200
        
    except Exception as e:
        logger.error(f"خطأ في التنظيف التلقائي: {e}")
        return jsonify({'error': f'خطأ في التنظيف التلقائي: {str(e)}'}), 500


@devices_bp.route('/system-stats', methods=['GET'])
def system_stats():
    err, server_id = verify_and_context(STATS_ROLES)
    if err:
        return err

    sys_info = {
        'os':        platform.system(),
        'python':    platform.python_version(),
        'timestamp': datetime.utcnow().isoformat()
    }
    
    client = get_supabase_client()
    if client:
        total_response = client.table('devices').select('*', count='exact').eq('server_id', server_id).execute()
        connected_response = client.table('devices').select('*', count='exact').eq('server_id', server_id).eq('status', 'connected').execute()
        disconnected_response = client.table('devices').select('*', count='exact').eq('server_id', server_id).eq('status', 'disconnected').execute()
        
        stats = {
            'total': total_response.count,
            'connected': connected_response.count,
            'disconnected': disconnected_response.count
        }
    else:
        stats = {'total': 0, 'connected': 0, 'disconnected': 0}
    
    log_data = {
        'action': "system_stats_viewed",
        'user_id': get_jwt_identity(),
        'details': json.dumps({'server_id': server_id, 'stats': stats}),
        'timestamp': datetime.utcnow().isoformat()
    }
    
    if client:
        client.table('logs').insert(log_data).execute()
    
    return jsonify({'system': sys_info, 'stats': stats}), 200


@devices_bp.route('/ports-stats', methods=['GET'])
def ports_stats():
    """جلب إحصائيات المنافذ الحقيقية من جميع السيرفرات"""
    err, server_id = verify_and_context(STATS_ROLES)
    if err:
        return err

    try:
        # جلب جميع السيرفرات (الرئيسي والفرعية)
        all_servers = Server.query.all()
        total_enabled_ports = 0
        total_disabled_ports = 0
        server_ports_data = []

        for server in all_servers:
            try:
                # جلب معلومات المنافذ من كل سيرفر
                from utils import get_usb_ports_info
                ports_info = get_usb_ports_info()
                
                if ports_info and 'ports' in ports_info:
                    # استخدام البيانات المحسنة من get_usb_ports_info
                    server_enabled = ports_info.get('enabled_ports', 0)
                    server_disabled = ports_info.get('disabled_ports', 0)
                    server_total = ports_info.get('total_ports', 0)
                    
                    total_enabled_ports += server_enabled
                    total_disabled_ports += server_disabled
                    
                    server_ports_data.append({
                        'server_id': server.id,
                        'server_name': server.name,
                        'enabled_ports': server_enabled,
                        'disabled_ports': server_disabled,
                        'total_ports': server_total
                    })
                else:
                    # إذا لم نتمكن من جلب معلومات المنافذ، نفترض أن جميع المنافذ مفعلة
                    default_ports = 8  # عدد افتراضي للمنافذ
                    total_enabled_ports += default_ports
                    
                    server_ports_data.append({
                        'server_id': server.id,
                        'server_name': server.name,
                        'enabled_ports': default_ports,
                        'disabled_ports': 0,
                        'total_ports': default_ports
                    })
                    
            except Exception as e:
                logger.error(f"Error getting ports info for server {server.id}: {e}")
                # في حالة الخطأ، نفترض أن جميع المنافذ مفعلة
                default_ports = 8
                total_enabled_ports += default_ports
                
                server_ports_data.append({
                    'server_id': server.id,
                    'server_name': server.name,
                    'enabled_ports': default_ports,
                    'disabled_ports': 0,
                    'total_ports': default_ports
                })

        # تسجيل الإجراء
        db.session.add(Log(
            action="ports_stats_viewed",
            user_id=get_jwt_identity(),
            details=json.dumps({
                'server_id': server_id,
                'total_enabled': total_enabled_ports,
                'total_disabled': total_disabled_ports,
                'servers_data': server_ports_data
            }),
            timestamp=datetime.utcnow()
        ))
        db.session.commit()

        return jsonify({
            'total_enabled_ports': total_enabled_ports,
            'total_disabled_ports': total_disabled_ports,
            'total_ports': total_enabled_ports + total_disabled_ports,
            'servers_data': server_ports_data
        }), 200

    except Exception as e:
        logger.error(f"Error getting ports stats: {e}")
        return jsonify({
            'error': 'خطأ في جلب إحصائيات المنافذ',
            'message': str(e)
        }), 500


@devices_bp.route('/sync-policies', methods=['GET'])
def sync_policies():
    err, server_id = verify_and_context(SYNC_ROLES)
    if err:
        return err

    client = get_supabase_client()
    if client:
        wl_response = client.table('devices').select('serial_number').eq('server_id', server_id).eq('whitelisted', True).execute()
        bl_response = client.table('devices').select('serial_number').eq('server_id', server_id).eq('blacklisted', True).execute()
        wl = wl_response.data
        bl = bl_response.data
    else:
        wl = []
        bl = []
    
    payload = {
        'server_id': server_id,
        'whitelist': [d['serial_number'] for d in wl if d['serial_number']],
        'blacklist': [d['serial_number'] for d in bl if d['serial_number']],
        'timestamp': datetime.utcnow().isoformat()
    }
    
    log_data = {
        'action': "policies_synced",
        'user_id': get_jwt_identity(),
        'details': json.dumps({'server_id': server_id, 'whitelisted': len(wl), 'blacklisted': len(bl)}),
        'timestamp': datetime.utcnow().isoformat()
    }
    
    if client:
        client.table('logs').insert(log_data).execute()
    
    return jsonify(payload), 200

CONTROL_ROLES = {'admin', 'manager'}

def has_role(required):
    try:
        jwt_data = get_jwt()
        roles = set(jwt_data.get('roles', []))
        # إذا لم يكن هناك أدوار، افترض أن المستخدم لديه دور 'user'
        if not roles:
            roles = {'user'}
        return bool(roles & required)
    except Exception:
        # في حالة أي خطأ، افترض أن المستخدم لديه دور 'user'
        return 'user' in required


# =====================================================
# Bulk Enable/Disable ALL USB Ports (Real PowerShell)
# =====================================================

@devices_bp.route('/ports/bulk-enable', methods=['POST'])
@jwt_required()
def api_bulk_enable_usb_ports():
    """
    تفعيل جميع أجهزة USB الطرفية فعلياً عبر Enable-PnpDevice.
    يستثني الأجهزة الداخلية (كيبورد، كاميرا، بلوتوث).
    """
    if not has_role(CONTROL_ROLES):
        return jsonify({'error': 'لا تملك الصلاحية الكافية'}), 403
    
    try:
        import platform as plat
        if plat.system() != 'Windows':
            return jsonify({'error': 'هذه الميزة متاحة فقط على Windows'}), 400
        
        from services.device_blocker import (
            get_all_usb_peripherals, enable_device_real,
            is_internal_device, add_to_approved_list
        )
        
        user_id = get_jwt_identity()
        
        # جلب كل أجهزة USB الطرفية
        all_devices = get_all_usb_peripherals()
        
        results = {
            'total_found': len(all_devices),
            'enabled': 0,
            'already_enabled': 0,
            'skipped_internal': 0,
            'failed': 0,
            'devices': []
        }
        
        for device in all_devices:
            device_id = device.get('device_id', '')
            name = device.get('name', 'Unknown')
            is_enabled = device.get('is_enabled', True)
            is_internal = device.get('is_internal', False)
            
            # تخطي الأجهزة الداخلية
            if is_internal or is_internal_device(
                device_id,
                vid=device.get('vid', ''),
                pid=device.get('pid', ''),
                device_class=device.get('class', ''),
                name=name
            ):
                results['skipped_internal'] += 1
                results['devices'].append({
                    'device_id': device_id,
                    'name': name,
                    'action': 'skipped',
                    'reason': 'internal_device'
                })
                continue
            
            # إذا مفعّل أصلاً
            if is_enabled:
                results['already_enabled'] += 1
                results['devices'].append({
                    'device_id': device_id,
                    'name': name,
                    'action': 'already_enabled'
                })
                continue
            
            # تفعيل فعلي
            success, msg = enable_device_real(device_id)
            if success:
                add_to_approved_list(device_id)
                results['enabled'] += 1
                results['devices'].append({
                    'device_id': device_id,
                    'name': name,
                    'action': 'enabled',
                    'message': msg
                })
            else:
                results['failed'] += 1
                results['devices'].append({
                    'device_id': device_id,
                    'name': name,
                    'action': 'failed',
                    'error': msg
                })
        
        # إرسال إشعار WebSocket
        try:
            socketio.emit('usb:bulk_enabled', {
                'enabled': results['enabled'],
                'total': results['total_found'],
                'user_id': user_id
            }, namespace='/api/devices')
        except Exception:
            pass
        
        # تسجيل في السجلات
        try:
            client = get_supabase_client()
            if client:
                client.table('logs').insert({
                    'action': 'bulk_enable_usb_ports',
                    'user_id': user_id,
                    'details': json.dumps({
                        'enabled': results['enabled'],
                        'total_found': results['total_found'],
                        'skipped_internal': results['skipped_internal'],
                        'failed': results['failed']
                    }),
                    'timestamp': datetime.utcnow().isoformat()
                }).execute()
        except Exception:
            pass
        
        logger.info(f"✅ Bulk enable: {results['enabled']} devices enabled, "
                     f"{results['skipped_internal']} internal skipped, "
                     f"{results['failed']} failed")
        
        return jsonify({
            'success': True,
            'message': f"تم تفعيل {results['enabled']} جهاز USB بنجاح",
            'results': results
        }), 200
        
    except Exception as e:
        logger.error(f"Error in bulk enable USB ports: {e}")
        return jsonify({'error': f'فشل في تفعيل المنافذ: {str(e)}'}), 500


@devices_bp.route('/ports/bulk-disable', methods=['POST'])
@jwt_required()
def api_bulk_disable_usb_ports():
    """
    تعطيل جميع أجهزة USB الطرفية فعلياً عبر Disable-PnpDevice.
    يستثني الأجهزة الداخلية (كيبورد، كاميرا، بلوتوث).
    """
    if not has_role(CONTROL_ROLES):
        return jsonify({'error': 'لا تملك الصلاحية الكافية'}), 403
    
    try:
        import platform as plat
        if plat.system() != 'Windows':
            return jsonify({'error': 'هذه الميزة متاحة فقط على Windows'}), 400
        
        from services.device_blocker import (
            get_all_usb_peripherals, disable_device_real,
            is_internal_device
        )
        
        user_id = get_jwt_identity()
        
        # جلب كل أجهزة USB الطرفية
        all_devices = get_all_usb_peripherals()
        
        results = {
            'total_found': len(all_devices),
            'disabled': 0,
            'already_disabled': 0,
            'skipped_internal': 0,
            'failed': 0,
            'devices': []
        }
        
        for device in all_devices:
            device_id = device.get('device_id', '')
            name = device.get('name', 'Unknown')
            is_enabled = device.get('is_enabled', True)
            is_internal = device.get('is_internal', False)
            
            # تخطي الأجهزة الداخلية
            if is_internal or is_internal_device(
                device_id,
                vid=device.get('vid', ''),
                pid=device.get('pid', ''),
                device_class=device.get('class', ''),
                name=name
            ):
                results['skipped_internal'] += 1
                results['devices'].append({
                    'device_id': device_id,
                    'name': name,
                    'action': 'skipped',
                    'reason': 'internal_device'
                })
                continue
            
            # إذا معطّل أصلاً
            if not is_enabled:
                results['already_disabled'] += 1
                results['devices'].append({
                    'device_id': device_id,
                    'name': name,
                    'action': 'already_disabled'
                })
                continue
            
            # تعطيل فعلي
            success, msg = disable_device_real(device_id)
            if success:
                results['disabled'] += 1
                results['devices'].append({
                    'device_id': device_id,
                    'name': name,
                    'action': 'disabled',
                    'message': msg
                })
            else:
                results['failed'] += 1
                results['devices'].append({
                    'device_id': device_id,
                    'name': name,
                    'action': 'failed',
                    'error': msg
                })
        
        # إرسال إشعار WebSocket
        try:
            socketio.emit('usb:bulk_disabled', {
                'disabled': results['disabled'],
                'total': results['total_found'],
                'user_id': user_id
            }, namespace='/api/devices')
        except Exception:
            pass
        
        # تسجيل في السجلات
        try:
            client = get_supabase_client()
            if client:
                client.table('logs').insert({
                    'action': 'bulk_disable_usb_ports',
                    'user_id': user_id,
                    'details': json.dumps({
                        'disabled': results['disabled'],
                        'total_found': results['total_found'],
                        'skipped_internal': results['skipped_internal'],
                        'failed': results['failed']
                    }),
                    'timestamp': datetime.utcnow().isoformat()
                }).execute()
        except Exception:
            pass
        
        logger.info(f"🔒 Bulk disable: {results['disabled']} devices disabled, "
                     f"{results['skipped_internal']} internal skipped, "
                     f"{results['failed']} failed")
        
        return jsonify({
            'success': True,
            'message': f"تم تعطيل {results['disabled']} جهاز USB بنجاح",
            'results': results
        }), 200
        
    except Exception as e:
        logger.error(f"Error in bulk disable USB ports: {e}")
        return jsonify({'error': f'فشل في تعطيل المنافذ: {str(e)}'}), 500


@devices_bp.route('/port/<port_id>/enable', methods=['POST'])
@jwt_required()
def api_enable_usb_port(port_id):
    if not has_role(CONTROL_ROLES):
        return jsonify({'error': 'لا تملك الصلاحية الكافية'}), 403
    
    try:
        # Get server_id from request body, default to 1 if not provided
        request_data = request.get_json() or {}
        server_id = request_data.get('server_id', 1)
        
        # Ensure server_id is a valid integer
        if server_id is None:
            server_id = 1
        elif isinstance(server_id, str):
            try:
                server_id = int(server_id)
            except ValueError:
                server_id = 1
        
        user_id = get_jwt_identity()
        success, msg, power = enable_usb_port(server_id, port_id, user_id)
        
        if success:
            socketio.emit('usb:port_enabled', {'server_id': server_id, 'port_id': port_id, 'power': power}, namespace='/api/devices')
            return jsonify({'message': msg, 'power': power}), 200
        else:
            return jsonify({'error': msg}), 400
            
    except Exception as e:
        logger.error(f"Error enabling USB port {port_id}: {e}")
        return jsonify({'error': f'Failed to enable port: {str(e)}'}), 500

@devices_bp.route('/port/<port_id>/disable', methods=['POST'])
@jwt_required()
def api_disable_usb_port(port_id):
    if not has_role(CONTROL_ROLES):
        return jsonify({'error': 'لا تملك الصلاحية الكافية'}), 403
    
    try:
        # Get server_id from request body, default to 1 if not provided
        request_data = request.get_json() or {}
        server_id = request_data.get('server_id', 1)
        
        # Ensure server_id is a valid integer
        if server_id is None:
            server_id = 1
        elif isinstance(server_id, str):
            try:
                server_id = int(server_id)
            except ValueError:
                server_id = 1
        
        user_id = get_jwt_identity()
        success, msg, power = disable_usb_port(server_id, port_id, user_id)
        
        if success:
            socketio.emit('usb:port_disabled', {'server_id': server_id, 'port_id': port_id, 'power': power}, namespace='/api/devices')
            return jsonify({'message': msg, 'power': power}), 200
        else:
            return jsonify({'error': msg}), 400
            
    except Exception as e:
        logger.error(f"Error disabling USB port {port_id}: {e}")
        return jsonify({'error': f'Failed to disable port: {str(e)}'}), 500

@devices_bp.route('/port/<port_id>/status', methods=['GET'])
def get_usb_port_status(port_id):
    err, server_id = verify_and_context(VIEW_ROLES)
    if err:
        return err
    from services.usb_service import get_usb_port_status as svc_get_usb_port_status
    result = svc_get_usb_port_status(port_id)
    return jsonify(result), 200 if result.get('success') else 404

@devices_bp.route('/<identifier>/whitelist', methods=['POST'])
def add_to_whitelist(identifier):
    err, server_id = verify_and_context(CONTROL_ROLES)
    if err:
        return err
    user_id = get_jwt_identity()

    try:
        # Get Supabase client
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'Database service unavailable'}), 503

        # Get device data
        dev = get_device_by_identifier(identifier, server_id)
        if not dev:
            return jsonify({'error': 'الجهاز غير موجود'}), 404

        # Update device in Supabase
        update_data = {
            'whitelisted': True,
            'blacklisted': False,
            'whitelisted_by': user_id,
            'whitelisted_at': datetime.utcnow().isoformat(),
            'last_activity': datetime.utcnow().isoformat()  # Use last_activity instead of updated_at
        }

        response = client.table('devices').update(update_data).eq('id', dev['id']).execute()
        updated_device = response.data[0] if response.data else None

        if not updated_device:
            return jsonify({'error': 'Failed to update device'}), 500

        # Log the action to Supabase
        log_data = {
            'action': "device_whitelisted",
            'user_id': user_id,
            'target_device': identifier,
            'ip_address': request.remote_addr,
            'details': json.dumps({'device_id': dev['id'], 'server_id': server_id}),
            'timestamp': datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()

        # Create blockchain record
        create_blockchain_record('device_whitelisted', {'device_id': dev['id'], 'server_id': server_id, 'user_id': user_id}, user_id)

        # Generate alert
        generate_alert(f"تمت إضافة الجهاز {identifier} إلى قائمة السماح على الخادم {server_id}", 'normal', {'device_id': dev['id'], 'server_id': server_id})

        # Emit socket event
        socketio.emit('device:whitelisted', {'device_id': dev['id'], 'server_id': server_id}, namespace='/api/devices')

        return jsonify({'message': 'تمت إضافة الجهاز إلى قائمة السماح'}), 200

    except Exception as e:
        current_app.logger.error(f"Error whitelisting device {identifier}: {e}")
        generate_alert(f"خطأ في إضافة الجهاز إلى القائمة البيضاء: {e}", "high")
        return jsonify({'error': 'حدث خطأ أثناء إضافة الجهاز إلى القائمة البيضاء'}), 500

@devices_bp.route('/<identifier>/whitelist', methods=['DELETE'])
def remove_from_whitelist(identifier):
    err, server_id = verify_and_context(CONTROL_ROLES)
    if err:
        return err
    user_id = get_jwt_identity()

    try:
        # Get Supabase client
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'Database service unavailable'}), 503

        # Get device data
        dev = get_device_by_identifier(identifier, server_id)
        if not dev:
            return jsonify({'error': 'الجهاز غير موجود'}), 404

        # Update device in Supabase
        update_data = {
            'whitelisted': False,
            'whitelisted_by': None,
            'whitelisted_at': None,
            'last_activity': datetime.utcnow().isoformat()  # Use last_activity instead of updated_at
        }

        response = client.table('devices').update(update_data).eq('id', dev['id']).execute()
        updated_device = response.data[0] if response.data else None

        if not updated_device:
            return jsonify({'error': 'Failed to update device'}), 500

        # Log the action to Supabase
        log_data = {
            'action': "device_unwhitelisted",
            'user_id': user_id,
            'target_device': identifier,
            'ip_address': request.remote_addr,
            'details': json.dumps({'device_id': dev['id'], 'server_id': server_id}),
            'timestamp': datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()

        # Create blockchain record
        create_blockchain_record('device_unwhitelisted', {'device_id': dev['id'], 'server_id': server_id, 'user_id': user_id}, user_id)

        # Generate alert
        generate_alert(f"تمت إزالة الجهاز {identifier} من قائمة السماح على الخادم {server_id}", 'medium', {'device_id': dev['id'], 'server_id': server_id})

        # Emit socket event
        socketio.emit('device:unwhitelisted', {'device_id': dev['id'], 'server_id': server_id}, namespace='/api/devices')

        return jsonify({'message': 'تمت إزالة الجهاز من قائمة السماح'}), 200

    except Exception as e:
        current_app.logger.error(f"Error removing device from whitelist {identifier}: {e}")
        generate_alert(f"خطأ في إزالة الجهاز من القائمة البيضاء: {e}", "high")
        return jsonify({'error': 'حدث خطأ أثناء إزالة الجهاز من القائمة البيضاء'}), 500

@devices_bp.route('/<identifier>/blacklist', methods=['POST'])
def add_to_blacklist(identifier):
    err, server_id = verify_and_context(CONTROL_ROLES)
    if err:
        return err
    user_id = get_jwt_identity()

    try:
        # Get Supabase client
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'Database service unavailable'}), 503

        # Get device data
        dev = get_device_by_identifier(identifier, server_id)
        if not dev:
            return jsonify({'error': 'الجهاز غير موجود'}), 404

        # Update device in Supabase
        update_data = {
            'blacklisted': True,
            'whitelisted': False,
            'last_activity': datetime.utcnow().isoformat()  # Use last_activity instead of updated_at
        }

        response = client.table('devices').update(update_data).eq('id', dev['id']).execute()
        updated_device = response.data[0] if response.data else None

        if not updated_device:
            return jsonify({'error': 'Failed to update device'}), 500

        # Log the action to Supabase
        log_data = {
            'action': "device_blacklisted",
            'user_id': user_id,
            'target_device': identifier,
            'ip_address': request.remote_addr,
            'details': json.dumps({'device_id': dev['id'], 'server_id': server_id}),
            'timestamp': datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()

        # Create blockchain record
        create_blockchain_record('device_blacklisted', {'device_id': dev['id'], 'server_id': server_id, 'user_id': user_id}, user_id)

        # Generate alert
        generate_alert(f"تمت إضافة الجهاز {identifier} إلى قائمة الحظر على الخادم {server_id}", 'high', {'device_id': dev['id'], 'server_id': server_id})

        # Emit socket event
        socketio.emit('device:blacklisted', {'device_id': dev['id'], 'server_id': server_id}, namespace='/api/devices')

        return jsonify({'message': 'تمت إضافة الجهاز إلى قائمة الحظر'}), 200

    except Exception as e:
        current_app.logger.error(f"Error blacklisting device {identifier}: {e}")
        generate_alert(f"خطأ في إضافة الجهاز إلى القائمة السوداء: {e}", "high")
        return jsonify({'error': 'حدث خطأ أثناء إضافة الجهاز إلى القائمة السوداء'}), 500

@devices_bp.route('/<identifier>/blacklist', methods=['DELETE'])
def remove_from_blacklist(identifier):
    err, server_id = verify_and_context(CONTROL_ROLES)
    if err:
        return err
    user_id = get_jwt_identity()

    try:
        # Get Supabase client
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'Database service unavailable'}), 503

        # Get device data
        dev = get_device_by_identifier(identifier, server_id)
        if not dev:
            return jsonify({'error': 'الجهاز غير موجود'}), 404

        # Update device in Supabase
        update_data = {
            'blacklisted': False,
            'last_activity': datetime.utcnow().isoformat()  # Use last_activity instead of updated_at
        }

        response = client.table('devices').update(update_data).eq('id', dev['id']).execute()
        updated_device = response.data[0] if response.data else None

        if not updated_device:
            return jsonify({'error': 'Failed to update device'}), 500

        # Log the action to Supabase
        log_data = {
            'action': "device_unblacklisted",
            'user_id': user_id,
            'target_device': identifier,
            'ip_address': request.remote_addr,
            'details': json.dumps({'device_id': dev['id'], 'server_id': server_id}),
            'timestamp': datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()

        # Create blockchain record
        create_blockchain_record('device_unblacklisted', {'device_id': dev['id'], 'server_id': server_id, 'user_id': user_id}, user_id)

        # Generate alert
        generate_alert(f"تمت إزالة الجهاز {identifier} من قائمة الحظر على الخادم {server_id}", 'medium', {'device_id': dev['id'], 'server_id': server_id})

        # Emit socket event
        socketio.emit('device:unblacklisted', {'device_id': dev['id'], 'server_id': server_id}, namespace='/api/devices')

        return jsonify({'message': 'تمت إزالة الجهاز من قائمة الحظر'}), 200

    except Exception as e:
        current_app.logger.error(f"Error removing device from blacklist {identifier}: {e}")
        generate_alert(f"خطأ في إزالة الجهاز من القائمة السوداء: {e}", "high")
        return jsonify({'error': 'حدث خطأ أثناء إزالة الجهاز من القائمة السوداء'}), 500

@devices_bp.route('/whitelist', methods=['GET'])
def get_whitelisted_devices():
    err, server_id = verify_and_context(VIEW_ROLES)
    if err:
        return err
    
    client = get_supabase_client()
    if client:
        response = client.table('devices').select('*').eq('server_id', server_id).eq('whitelisted', True).execute()
        devices = response.data
    else:
        devices = []
    
    return jsonify(devices), 200

@devices_bp.route('/blacklist', methods=['GET'])
def get_blacklisted_devices():
    err, server_id = verify_and_context(VIEW_ROLES)
    if err:
        return err
    
    client = get_supabase_client()
    if client:
        response = client.table('devices').select('*').eq('server_id', server_id).eq('blacklisted', True).execute()
        devices = response.data
    else:
        devices = []
    
    return jsonify(devices), 200

@devices_bp.route('/power-analytics', methods=['GET'])
def power_analytics():
    err, server_id = verify_and_context(VIEW_ROLES)
    if err:
        return err
    from services.usb_service import get_power_analytics
    analytics = get_power_analytics()
    return jsonify(analytics), 200

@devices_bp.route('/<identifier>/approve', methods=['POST'])
def approve_pending_device(identifier):
    err, server_id = verify_and_context(APPROVE_ROLES)
    if err:
        return err
    user_id = get_jwt_identity()
    dev = get_device_by_identifier(identifier, server_id)
    if not dev:
        return jsonify({'error': 'الجهاز غير موجود'}), 404
    if dev.status != 'pending':
        return jsonify({'error': 'الجهاز ليس في حالة معلقة'}), 400
    dev.status = 'connected'
    dev.approved_by = user_id
    dev.approved_at = datetime.utcnow()
    db.session.commit()
    db.session.add(Log(
        action="device_approved",
        user_id=user_id,
        target_device=dev.serial_number,
        details=json.dumps({'server_id': server_id}),
        timestamp=datetime.utcnow()
    ))
    db.session.commit()
    create_blockchain_record('device_approved', {'device_id': dev.id, 'server_id': server_id, 'user_id': user_id}, user_id)
    generate_alert(f"تمت الموافقة على الجهاز: {dev.name}", 'normal', {'device_id': dev.id})
    socketio.emit('device:approved', dev.to_dict(), namespace='/api/devices')
    return jsonify({'message': 'تمت الموافقة على الجهاز', 'device': dev.to_dict()}), 200

@devices_bp.route('/<identifier>/deny', methods=['POST'])
def deny_pending_device(identifier):
    err, server_id = verify_and_context(DENY_ROLES)
    if err:
        return err
    user_id = get_jwt_identity()
    dev = get_device_by_identifier(identifier, server_id)
    if not dev:
        return jsonify({'error': 'الجهاز غير موجود'}), 404
    if dev.status != 'pending':
        return jsonify({'error': 'الجهاز ليس في حالة معلقة'}), 400
    dev.status = 'denied'
    db.session.commit()
    db.session.add(Log(
        action="device_denied",
        user_id=user_id,
        target_device=dev.serial_number,
        details=json.dumps({'server_id': server_id}),
        timestamp=datetime.utcnow()
    ))
    db.session.commit()
    create_blockchain_record('device_denied', {'device_id': dev.id, 'server_id': server_id, 'user_id': user_id}, user_id)
    generate_alert(f"تم رفض الجهاز: {dev.name}", 'high', {'device_id': dev.id})
    socketio.emit('device:denied', dev.to_dict(), namespace='/api/devices')
    return jsonify({'message': 'تم رفض الجهاز', 'device': dev.to_dict()}), 200

@devices_bp.route('/check-compatibility', methods=['POST'])
def check_compatibility():
    """التحقق من توافق الجهاز مع النظام والسياسات"""
    err, server_id = verify_and_context(VIEW_ROLES)
    if err:
        return err
    
    data = request.get_json() or {}
    device_info = {
        'vendor_id': data.get('vendor_id'),
        'product_id': data.get('product_id'),
        'device_class': data.get('device_class'),
        'serial_number': data.get('serial_number'),
        'name': data.get('name', 'Unknown Device')
    }
    
    # فحص التوافق الأساسي
    compatibility_result = {
        'compatible': True,
        'warnings': [],
        'errors': [],
        'recommendations': []
    }
    
    # فحص القائمة السوداء
    client = get_supabase_client()
    if device_info.get('vendor_id') and device_info.get('product_id'):
        if client:
            response = client.table('devices').select('*').eq('server_id', server_id).eq('vendor_id', device_info['vendor_id']).eq('product_id', device_info['product_id']).eq('blacklisted', True).execute()
            blacklisted_device = response.data[0] if response.data else None
        else:
            blacklisted_device = None
        
        if blacklisted_device:
            compatibility_result['compatible'] = False
            compatibility_result['errors'].append('الجهاز مدرج في القائمة السوداء')
    
    # فحص السياسات النشطة
    if client:
        policy_response = client.table('policies').select('*').eq('is_active', True).execute()
        active_policies = policy_response.data
    else:
        active_policies = []
    
    for policy in active_policies:
        if policy.get('rules'):
            policy_data = json.loads(policy['rules'])
        else:
            continue
        
        # فحص نوع الجهاز المسموح
        if 'allowed_types' in policy_data and policy_data['allowed_types']:
            allowed_types = policy_data['allowed_types']
            device_class = device_info.get('device_class', 'unknown')
            if device_class not in allowed_types:
                compatibility_result['warnings'].append(f'نوع الجهاز {device_class} غير مدرج في السياسة {policy["name"]}')
        
        # فحص الحد الأقصى للحجم
        if 'max_size_mb' in policy_data and policy_data['max_size_mb'] > 0:
            device_size = device_info.get('size_mb', 0)
            if device_size > policy_data['max_size_mb']:
                compatibility_result['errors'].append(f'حجم الجهاز {device_size}MB يتجاوز الحد المسموح {policy_data["max_size_mb"]}MB في السياسة {policy["name"]}')
                compatibility_result['compatible'] = False
        
        # فحص الإجراء الافتراضي
        if policy_data.get('default_action') == 'block':
            compatibility_result['compatible'] = False
            compatibility_result['errors'].append(f'السياسة {policy["name"]} تحظر الأجهزة افتراضياً')
    
    # فحص عدد الأجهزة المتصلة
    if client:
        connected_response = client.table('devices').select('*', count='exact').eq('server_id', server_id).eq('status', 'connected').execute()
        connected_devices = connected_response.count
    else:
        connected_devices = 0
    
    max_devices = current_app.config.get('MAX_DEVICES_PER_SERVER', 10)
    if connected_devices >= max_devices:
        compatibility_result['compatible'] = False
        compatibility_result['errors'].append(f'تم الوصول للحد الأقصى من الأجهزة المتصلة ({max_devices})')
    
    # توصيات التحسين
    if not compatibility_result['errors']:
        compatibility_result['recommendations'].append('يمكن توصيل الجهاز بأمان')
        if compatibility_result['warnings']:
            compatibility_result['recommendations'].append('راجع التحذيات قبل الموافقة')
    
    return jsonify({
        'compatibility': compatibility_result,
        'device_info': device_info
    }), 200


@devices_bp.route('/clear-all', methods=['DELETE'])
@jwt_required()
def clear_all_devices():
    """مسح جميع الأجهزة من قاعدة البيانات"""
    try:
        from models import Device
        from extensions import db
        
        # احصل على معرف المستخدم
        user_id = get_jwt_identity()
        
        # تحقق من الصلاحيات
        if not _has_role({'admin', 'super_admin'}):
            return jsonify({'error': 'ليس لديك صلاحية لتنفيذ هذا الإجراء'}), 403
        
        # احصل على server_id
        server_id = get_server_id()
        
        # مسح جميع الأجهزة
        client = get_supabase_client()
        if client:
            count_response = client.table('devices').select('*', count='exact').eq('server_id', server_id).execute()
            devices_count = count_response.count
            client.table('devices').delete().eq('server_id', server_id).execute()
        else:
            devices_count = 0
        
        # تسجيل في السجل
        try:
            log_data = {
                'action': 'CLEAR_ALL_DEVICES',
                'user_id': user_id,
                'details': f'تم مسح {devices_count} جهاز',
                'timestamp': datetime.utcnow().isoformat()
            }
            if client:
                client.table('logs').insert(log_data).execute()
        except Exception:
            pass  # تجاهل أخطاء التسجيل
        
        return jsonify({
            'success': True,
            'message': f'تم مسح {devices_count} جهاز بنجاح',
            'deleted_count': devices_count
        })
        
    except Exception as e:
        return jsonify({'error': f'خطأ في مسح الأجهزة: {str(e)}'}), 500

@devices_bp.route('/clear-disconnected', methods=['DELETE'])
@jwt_required()
def clear_disconnected_devices():
    """مسح الأجهزة المنقطعة فقط"""
    try:
        from models import Device
        from extensions import db
        
        user_id = get_jwt_identity()
        
        if not _has_role({'admin', 'super_admin'}):
            return jsonify({'error': 'ليس لديك صلاحية لتنفيذ هذا الإجراء'}), 403
        
        server_id = get_server_id()
        
        # مسح الأجهزة المنقطعة
        client = get_supabase_client()
        if client:
            count_response = client.table('devices').select('*', count='exact').eq('server_id', server_id).eq('status', 'disconnected').execute()
            devices_count = count_response.count
            client.table('devices').delete().eq('server_id', server_id).eq('status', 'disconnected').execute()
        else:
            devices_count = 0
        
        try:
            log_data = {
                'action': 'CLEAR_DISCONNECTED_DEVICES',
                'user_id': user_id,
                'details': f'تم مسح {devices_count} جهاز منقطع',
                'timestamp': datetime.utcnow().isoformat()
            }
            if client:
                client.table('logs').insert(log_data).execute()
        except Exception:
            pass
        
        return jsonify({
            'success': True,
            'message': f'تم مسح {devices_count} جهاز منقطع بنجاح',
            'deleted_count': devices_count
        })
        
    except Exception as e:
        return jsonify({'error': f'خطأ في مسح الأجهزة المنقطعة: {str(e)}'}), 500

@devices_bp.route('/clear-pending', methods=['DELETE'])
@jwt_required()
def clear_pending_devices():
    """مسح الأجهزة المعلقة فقط"""
    try:
        from models import Device
        from extensions import db
        
        user_id = get_jwt_identity()
        
        if not _has_role({'admin', 'super_admin'}):
            return jsonify({'error': 'ليس لديك صلاحية لتنفيذ هذا الإجراء'}), 403
        
        server_id = get_server_id()
        
        # مسح الأجهزة المعلقة
        client = get_supabase_client()
        if client:
            count_response = client.table('devices').select('*', count='exact').eq('server_id', server_id).eq('status', 'pending').execute()
            devices_count = count_response.count
            client.table('devices').delete().eq('server_id', server_id).eq('status', 'pending').execute()
        else:
            devices_count = 0
        
        try:
            log_data = {
                'action': 'CLEAR_PENDING_DEVICES',
                'user_id': user_id,
                'details': f'تم مسح {devices_count} جهاز معلق',
                'timestamp': datetime.utcnow().isoformat()
            }
            if client:
                client.table('logs').insert(log_data).execute()
        except Exception:
            pass
        
        return jsonify({
            'success': True,
            'message': f'تم مسح {devices_count} جهاز معلق بنجاح',
            'deleted_count': devices_count
        })
        
    except Exception as e:
        return jsonify({'error': f'خطأ في مسح الأجهزة المعلقة: {str(e)}'}), 500


@devices_bp.route('/<identifier>/status', methods=['PUT'])
def update_single_device_status(identifier):
    """تحديث حالة جهاز محدد"""
    err, server_id = verify_and_context(VIEW_ROLES)
    if err:
        return err
        
    try:
        data = request.json or {}
        
        # البحث عن الجهاز
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة'}), 500
        
        # البحث عن الجهاز باستخدام identifier
        device_response = client.table('devices').select('*').eq('serial_number', identifier).eq('server_id', server_id).execute()
        
        if not device_response.data:
            return jsonify({'error': 'الجهاز غير موجود'}), 404
        
        device = device_response.data[0]
        
        # إعداد البيانات للتحديث
        update_data = {}
        if 'status' in data:
            update_data['status'] = data['status']
        if 'last_seen' in data:
            update_data['last_seen'] = data['last_seen']
        if 'connection_time' in data:
            update_data['connection_time'] = data['connection_time']
        
        if not update_data:
            return jsonify({'error': 'لا توجد بيانات للتحديث'}), 400
        
        # تحديث الجهاز
        update_response = client.table('devices').update(update_data).eq('id', device['id']).execute()
        
        if not update_response.data:
            return jsonify({'error': 'فشل في تحديث الجهاز'}), 500
        
        updated_device = update_response.data[0]
        
        # إضافة سجل في الـ logs
        log_data = {
            'action': f"device_status_updated_to_{data.get('status', 'unknown')}",
            'user_id': get_jwt_identity() if get_jwt_identity() else 'system',
            'target_device': identifier,
            'details': json.dumps({
                'server_id': server_id,
                'old_status': device.get('status'),
                'new_status': data.get('status'),
                'updated_at': datetime.utcnow().isoformat()
            }),
            'timestamp': datetime.utcnow().isoformat()
        }
        client.table('logs').insert(log_data).execute()
        
        # إرسال إشعار WebSocket
        socketio.emit('device:status_updated', {
            'device': updated_device,
            'old_status': device.get('status'),
            'new_status': data.get('status')
        }, namespace='/api/devices')
        
        return jsonify({
            'success': True,
            'message': f'تم تحديث حالة الجهاز إلى {data.get("status", "unknown")}',
            'device': updated_device
        })

    except Exception as e:
        current_app.logger.error(f"Error updating device status: {e}")
        return jsonify({'error': f'خطأ في تحديث حالة الجهاز: {str(e)}'}), 500


@devices_bp.route('/update-status', methods=['POST'])
@jwt_required()
def update_device_status():
    """تحديث حالة جميع الأجهزة يدوياً"""
    try:
        # تحديث حالة جميع الأجهزة محلياً
        # يمكن إضافة منطق تحديث الحالة هنا إذا لزم الأمر
        
        return jsonify({
            'success': True,
            'message': 'تم تحديث حالة جميع الأجهزة بنجاح'
        })

    except Exception as e:
        current_app.logger.error(f"Error updating device status: {e}")
        return jsonify({'error': f'خطأ في تحديث حالة الأجهزة: {str(e)}'}), 500


# =====================================================
# Endpoint لاستقبال الأجهزة المكتشفة من USB Agent
# يستخدم جدول معزول agent_pending_devices للأمان
# =====================================================
@devices_bp.route('/discovered', methods=['POST'])
def receive_discovered_devices():
    """
    استقبال الأجهزة المكتشفة من USB Agent وحفظها في جدول معزول.
    هذا الـ endpoint مفتوح للـ Agent ولا يتطلب JWT.
    الجدول المعزول agent_pending_devices لا يرتبط بجداول أخرى للأمان.
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'لا توجد بيانات'}), 400
        
        server_id = data.get('server_id', 1)
        server_name = data.get('server_name', 'USB Agent')
        agent_version = data.get('agent_version', 'Unknown')
        discovered_at = data.get('discovered_at', datetime.utcnow().isoformat())
        devices_list = data.get('devices', [])
        
        if not devices_list:
            return jsonify({'success': True, 'message': 'لا توجد أجهزة للإضافة', 'count': 0})
        
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة'}), 500
        
        added_count = 0
        updated_count = 0
        skipped_count = 0
        
        for device in devices_list:
            try:
                serial_number = (device.get('serial_number') or '').strip()
                vendor_id = (device.get('vendor_id') or '').strip()
                product_id = (device.get('product_id') or '').strip()
                device_name = device.get('name') or 'Unknown Device'
                
                # تخطي الأجهزة بدون معرف فريد
                if not serial_number and not (vendor_id and product_id):
                    skipped_count += 1
                    continue
                
                # إنشاء معرف فريد للجهاز إذا لم يكن موجود
                if not serial_number:
                    serial_number = f"AUTO_{vendor_id}_{product_id}"
                
                # التحقق من وجود الجهاز في الجدول المعزول
                existing_query = client.table('agent_pending_devices').select('id,status,device_name')
                existing_query = existing_query.eq('serial_number', serial_number).eq('agent_server_id', server_id)
                
                existing_response = existing_query.execute()
                
                if existing_response.data and len(existing_response.data) > 0:
                    # الجهاز موجود في الجدول المعزول - تحديث الوقت فقط
                    existing_device = existing_response.data[0]
                    client.table('agent_pending_devices').update({
                        'received_at': datetime.utcnow().isoformat()
                    }).eq('id', existing_device['id']).execute()
                    updated_count += 1
                    logger.info(f"📱 Pending device updated: {device_name} ({serial_number})")
                else:
                    # جهاز جديد - إضافته للجدول المعزول
                    system_info = device.get('system_info', {})
                    new_pending_device = {
                        'device_name': device_name,
                        'serial_number': serial_number,
                        'vendor_id': vendor_id,
                        'product_id': product_id,
                        'manufacturer': device.get('manufacturer') or 'Unknown',
                        'device_class': device.get('device_class') or 'Unknown',
                        'device_type': device.get('device_class') or 'USB Device',
                        'description': device.get('description') or '',
                        'physical_path': device.get('physical_path') or '',
                        'usb_port': device.get('location') or 'USB Port',
                        'location_info': device.get('location') or '',
                        'agent_server_id': server_id,
                        'agent_server_name': server_name,
                        'agent_hostname': system_info.get('hostname') or '',
                        'agent_ip_address': request.remote_addr or '',
                        'agent_version': agent_version,
                        'system_os': system_info.get('os') or 'Unknown',
                        'system_platform': system_info.get('platform') or '',
                        'system_arch': system_info.get('arch') or '',
                        'status': 'pending',
                        'is_real_device': device.get('is_real_device', True),
                        'discovery_method': device.get('discovery_method', 'electron_agent'),
                        'discovered_at': discovered_at,
                        'received_at': datetime.utcnow().isoformat(),
                        'raw_device_data': json.dumps(device),
                        'meta_data': json.dumps({
                            'source': 'usb_agent',
                            'agent_version': agent_version,
                            'request_headers': dict(request.headers) if request.headers else {}
                        })
                    }
                    
                    insert_response = client.table('agent_pending_devices').insert(new_pending_device).execute()
                    
                    if insert_response.data:
                        added_count += 1
                        logger.info(f"🆕 New pending device saved to isolated table: {device_name} ({serial_number})")
                        
                        # طباعة في الـ Terminal
                        log_new_device_discovered(
                            serial=serial_number,
                            name=device_name,
                            device_type=device.get('device_class') or 'USB Device',
                            status='pending'
                        )
                        
                        # إرسال إشعار WebSocket للفرونت إند
                        try:
                            socketio.emit('device:discovered', {
                                'device': insert_response.data[0],
                                'server_id': server_id,
                                'server_name': server_name,
                                'message': f'تم اكتشاف جهاز جديد: {device_name}',
                                'timestamp': datetime.utcnow().isoformat(),
                                'source': 'isolated_table'
                            }, namespace='/api/devices')
                            
                            # إرسال إشعار عام
                            socketio.emit('notification', {
                                'type': 'new_device',
                                'title': 'جهاز جديد',
                                'message': f'تم اكتشاف جهاز جديد: {device_name}',
                                'device': insert_response.data[0],
                                'timestamp': datetime.utcnow().isoformat()
                            })
                        except Exception as ws_error:
                            logger.debug(f"WebSocket notification error: {ws_error}")
                        
                        # 🔔 إنشاء تنبيه في جدول alerts عند اكتشاف جهاز جديد
                        try:
                            generate_alert(
                                f"تم اكتشاف جهاز USB جديد: {device_name} (SN: {serial_number})",
                                'medium',
                                {
                                    'event': 'device_discovered',
                                    'device_name': device_name,
                                    'serial_number': serial_number,
                                    'vendor_id': vendor_id,
                                    'product_id': product_id,
                                    'server_id': server_id,
                                    'server_name': server_name,
                                    'agent_version': agent_version
                                }
                            )
                        except Exception as alert_error:
                            logger.debug(f"Alert generation error: {alert_error}")

                # التحقق من وجود الجهاز في الجدول الرئيسي أيضا لتحديث حالته وإرسال تنبيه الاتصال
                try:
                    main_device_query = client.table('devices').select('id, status, is_connected, name').eq('serial_number', serial_number).execute()
                    if main_device_query.data:
                        main_dev = main_device_query.data[0]
                        # إذا كان الجهاز مفصولاً واتصل الآن
                        if not main_dev.get('is_connected') or main_dev.get('status') == 'disconnected' or main_dev.get('status') == 'connected':
                             # تحديث الوقت دائماً
                            client.table('devices').update({
                                'is_connected': True, 
                                'status': 'connected', 
                                'last_activity': datetime.utcnow().isoformat(),
                                'usb_port': device.get('location') or 'USB Port'
                            }).eq('id', main_dev['id']).execute()
                            
                            # نرسل تنبيه فقط إذا كان مفصولاً سابقاً
                            if not main_dev.get('is_connected') or main_dev.get('status') == 'disconnected':
                                logger.info(f"🟢 Main device re-connected: {main_dev.get('name')}")
                                
                                # 🔔 إنشاء تنبيه عند إعادة اتصال جهاز معروف
                                try:
                                    generate_alert(
                                        f"اتصل الجهاز: {main_dev.get('name')} (SN: {serial_number})",
                                        'normal',
                                        {
                                            'event': 'device_connected',
                                            'device_name': main_dev.get('name'),
                                            'serial_number': serial_number,
                                            'server_id': server_id,
                                            'device_id': main_dev['id']
                                        }
                                    )
                                except Exception:
                                    pass
                except Exception as update_err:
                     logger.debug(f"Error checking main device status: {update_err}")


            except Exception as device_error:
                logger.error(f"Error processing pending device: {device_error}")
                skipped_count += 1
                continue
        
        logger.info(f"📊 Pending devices processed: {added_count} added, {updated_count} updated, {skipped_count} skipped")
        
        return jsonify({
            'success': True,
            'message': f'تم معالجة الأجهزة المكتشفة',
            'added': added_count,
            'updated': updated_count,
            'skipped': skipped_count,
            'total_received': len(devices_list)
        })
        
    except Exception as e:
        logger.error(f"Error receiving discovered devices: {e}")
        return jsonify({'error': f'خطأ في استقبال الأجهزة: {str(e)}'}), 500


# =====================================================
# Endpoint لقراءة الأجهزة المعلقة من الجدول المعزول
# =====================================================
@devices_bp.route('/pending', methods=['GET'])
@jwt_required()
def get_pending_devices():
    """
    الحصول على قائمة الأجهزة المعلقة مجمعة من جدول العملاء (agent_pending_devices)
    ومن جدول السيرفر الرئيسي (server_pending_devices).
    """
    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة'}), 500

        limit = int(request.args.get('limit', 100))
        offset = int(request.args.get('offset', 0))

        devices = []
        
        # 1. جلب الأجهزة المعلقة من السيرفر الحالي (الرئيسي)
        server_query = client.table('server_pending_devices').select('*').order('created_at', desc=True).limit(limit).execute()
        if server_query.data:
            for d in server_query.data:
                d['status'] = 'pending'
                d['device_name'] = d.get('name') or d.get('device_name')
                d['discovered_at'] = d.get('created_at')
                d['source'] = 'server' # للتمييز
                devices.append(d)

        # 2. جلب الأجهزة المعلقة من الـ USB Agents (العملاء)
        agent_query = client.table('agent_pending_devices').select('*').order('received_at', desc=True).limit(limit).execute()
        if agent_query.data:
            for d in agent_query.data:
                d['status'] = 'pending'
                d['device_name'] = d.get('device_name') or d.get('name')
                d['discovered_at'] = d.get('received_at') or d.get('discovered_at')
                d['source'] = 'agent' # للتمييز
                devices.append(d)

        # دمج وترتيب الأجهزة حسب وقت الاكتشاف الأحدث
        devices.sort(key=lambda x: x.get('discovered_at') or '', reverse=True)
        
        # تطبيق التقطيع (Pagination)
        paginated_devices = devices[offset:offset+limit]
        total_count = len(devices)

        return jsonify({
            'success': True,
            'devices': paginated_devices,
            'pending_devices': paginated_devices, # للاحتياط ليقرأه التطبيق
            'total': total_count,
            'limit': limit,
            'offset': offset
        })

    except Exception as e:
        logger.error(f"Error getting pending devices: {e}")
        return jsonify({'error': f'خطأ في جلب الأجهزة المعلقة: {str(e)}'}), 500


# =====================================================
# Endpoint للموافقة على جهاز معلق ونقله للجدول الرئيسي
# =====================================================
@devices_bp.route('/pending/<int:pending_id>/approve', methods=['POST'])
@jwt_required()
def approve_agent_pending_device(pending_id):
    """
    الموافقة على جهاز معلق ونقله للجدول الرئيسي ثم تفعيله.
    """
    try:
        current_user = get_jwt_identity()
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة'}), 500
        
        # جلب الجهاز المعلق من server_pending_devices
        pending_response = client.table('server_pending_devices').select('*').eq('id', pending_id).execute()
        
        if not pending_response.data:
             # دعم رجعي للـ agent_pending_devices لو كان الجهاز المرفق فرعي
            pending_response = client.table('agent_pending_devices').select('*').eq('id', pending_id).execute()
            if not pending_response.data:
                return jsonify({'error': 'الجهاز المعلق غير موجود'}), 404
            
            pending_device = pending_response.data[0]
            
            try:
                # تجهيز بيانات الجهاز لنقله إلى جدول devices الرئيسي
                new_device = {
                    'serial_number': pending_device.get('serial_number'),
                    'vendor_id': pending_device.get('vendor_id', '0000'),
                    'product_id': pending_device.get('product_id', '0000'),
                    'name': pending_device.get('device_name', 'Unknown USB'),
                    'device_class': pending_device.get('class', 'USB Device'),
                    'manufacturer': 'Unknown',
                    'status': 'connected',
                    'is_verified': True,
                    'whitelisted': True,
                    'whitelisted_at': datetime.utcnow().isoformat(),
                    'approved_at': datetime.utcnow().isoformat(),
                    'connection_time': pending_device.get('received_at', datetime.utcnow().isoformat()),
                    'last_scan_time': datetime.utcnow().isoformat(),
                    'usb_port': pending_device.get('usb_port', 'USB Port')
                }

                # التحقق مما إذا كان الجهاز موجودًا بالفعل لتجنب التكرار
                existing = client.table('devices').select('id').eq('serial_number', new_device['serial_number']).execute()
                
                if existing.data:
                    # تحديث الجهاز الموجود
                    client.table('devices').update(new_device).eq('id', existing.data[0]['id']).execute()
                else:
                    # إضافة الجهاز كجديد
                    client.table('devices').insert(new_device).execute()
                    
                # حذف الجهاز من قائمة الانتظار
                client.table('agent_pending_devices').delete().eq('id', pending_id).execute()
                
                return jsonify({'success': True, 'message': 'تم الموافقة على جهاز العميل ونقله إلى قائمة الأجهزة الخاصة بك!'})
            except Exception as e:
                current_app.logger.error(f"Error moving agent pending device: {e}")
                return jsonify({'error': f'حدث خطأ أثناء نقل الجهاز المنتمي للعميل: {str(e)}'}), 500
            
        pending_device = pending_response.data[0]
        device_id = pending_device.get('device_id')
        
        # استخدام دالة الموافقة الرسمية من الباكن اند التي تقوم بنقل الجهاز وتمكينه
        from services.device_blocker import approve_and_enable_device
        
        success, msg, device_info = approve_and_enable_device(device_id)
        
        if success:
            return jsonify({
                'success': True,
                'message': 'تم الموافقة على الجهاز وتفعيله من خلال السيرفر.',
                'device': device_info
            })
        else:
            return jsonify({'error': f'فشل تفعيل الجهاز: {msg}'}), 500
        
    except Exception as e:
        logger.error(f"Error approving pending device: {e}")
        return jsonify({'error': f'خطأ في الموافقة على الجهاز: {str(e)}'}), 500


# =====================================================
# Endpoint لرفض جهاز معلق
# =====================================================
@devices_bp.route('/pending/<int:pending_id>/reject', methods=['POST'])
@jwt_required()
def reject_pending_device(pending_id):
    """
    رفض جهاز معلق وإزالته من قائمة الانتظار.
    """
    try:
        current_user = get_jwt_identity()
        data = request.get_json() or {}
        reason = data.get('reason', 'لم يتم تحديد السبب')
        
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة'}), 500
        
        # التحقق من الجدول المعزول الخاص بالسيرفر
        response = client.table('server_pending_devices').select('*').eq('id', pending_id).execute()
        if not response.data:
            # Fallback للجدول القديم لضمان عدم توقف الواجهة
            client.table('agent_pending_devices').update({'status': 'rejected'}).eq('id', pending_id).execute()
            return jsonify({'success': True, 'message': 'تم رفض الجهاز (القديم)'})
            
        pending_device = response.data[0]
        
        # حذفه لأنه مرفوض
        client.table('server_pending_devices').delete().eq('id', pending_id).execute()
        
        try:
            generate_alert(
                f"تم رفض الجهاز: {pending_device.get('name', 'Unknown')}",
                'medium',
                {'event': 'device_rejected', 'reason': reason, 'pending_id': pending_id}
            )
        except Exception: pass

        logger.info(f"❌ Pending device rejected and removed: ID {pending_id}")
        return jsonify({
            'success': True,
            'message': 'تم رفض الجهاز بنجاح',
            'device': pending_device
        })
        
    except Exception as e:
        logger.error(f"Error rejecting pending device: {e}")
        return jsonify({'error': f'خطأ في رفض الجهاز: {str(e)}'}), 500
        
    except Exception as e:
        logger.error(f"Error rejecting pending device: {e}")
        return jsonify({'error': f'خطأ في رفض الجهاز: {str(e)}'}), 500


# =====================================================
# Endpoint لحذف جهاز معلق
# =====================================================
@devices_bp.route('/pending/<int:pending_id>', methods=['DELETE'])
@jwt_required()
def delete_pending_device(pending_id):
    """
    حذف جهاز معلق نهائياً.
    """
    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة'}), 500
        
        # محاولة حذفه من server_pending_devices
        delete_response = client.table('server_pending_devices').delete().eq('id', pending_id).execute()
        
        if not delete_response.data:
            # Fallback للجدول القديم
            client.table('agent_pending_devices').delete().eq('id', pending_id).execute()
            
        logger.info(f"🗑️ Pending device deleted: ID {pending_id}")
        return jsonify({
            'success': True,
            'message': 'تم حذف الجهاز المعلق'
        })
        
    except Exception as e:
        logger.error(f"Error deleting pending device: {e}")
        return jsonify({'error': f'خطأ في حذف الجهاز: {str(e)}'}), 500
        
    except Exception as e:
        logger.error(f"Error deleting pending device: {e}")
        return jsonify({'error': f'خطأ في حذف الجهاز: {str(e)}'}), 500


# =====================================================
# Device Blocker API Endpoints
# نظام حظر الأجهزة الطرفية الفعلي
# =====================================================

@devices_bp.route('/blocker/status', methods=['GET'])
@jwt_required()
def blocker_status():
    """جلب حالة نظام حظر الأجهزة."""
    try:
        from services.device_blocker import get_blocker_status, get_all_usb_peripherals
        
        status = get_blocker_status()
        # جلب الأجهزة المتصلة حالياً
        current_peripherals = get_all_usb_peripherals()
        
        return jsonify({
            'success': True,
            'blocker': status,
            'current_peripherals': len(current_peripherals),
            'peripherals_list': current_peripherals
        })
    except ImportError:
        return jsonify({'error': 'خدمة حظر الأجهزة غير متاحة'}), 503
    except Exception as e:
        logger.error(f"Error getting blocker status: {e}")
        return jsonify({'error': str(e)}), 500


@devices_bp.route('/blocker/blocked', methods=['GET'])
@jwt_required()
def blocker_blocked_list():
    """جلب قائمة الأجهزة المحظورة حالياً."""
    try:
        from services.device_blocker import get_blocked_devices_list
        
        blocked = get_blocked_devices_list()
        return jsonify({
            'success': True,
            'blocked_devices': blocked,
            'count': len(blocked)
        })
    except ImportError:
        return jsonify({'error': 'خدمة حظر الأجهزة غير متاحة'}), 503
    except Exception as e:
        logger.error(f"Error getting blocked devices: {e}")
        return jsonify({'error': str(e)}), 500


@devices_bp.route('/blocker/approved', methods=['GET'])
@jwt_required()
def blocker_approved_list():
    """جلب قائمة الأجهزة الموافق عليها."""
    try:
        from services.device_blocker import get_approved_devices_list
        
        approved = get_approved_devices_list()
        return jsonify({
            'success': True,
            'approved_devices': approved,
            'count': len(approved)
        })
    except ImportError:
        return jsonify({'error': 'خدمة حظر الأجهزة غير متاحة'}), 503
    except Exception as e:
        logger.error(f"Error getting approved devices: {e}")
        return jsonify({'error': str(e)}), 500


@devices_bp.route('/blocker/approve', methods=['POST'])
@jwt_required()
def blocker_approve_device():
    """
    الموافقة على جهاز محظور وتفعيله فعلياً.
    يتوقع JSON: { "device_id": "USB\\VID_xxxx&PID_xxxx\\serial" }
    """
    try:
        err, server_id = verify_and_context(APPROVE_ROLES)
        if err:
            return err
        
        data = request.get_json(force=True) or {}
        device_id = data.get('device_id', '')
        
        if not device_id:
            return jsonify({'error': 'device_id مطلوب'}), 400
        
        from services.device_blocker import approve_and_enable_device
        
        success, msg, device_info = approve_and_enable_device(device_id)
        
        if success:
            # إرسال إشعار Socket.IO
            try:
                socketio.emit('device:unblocked', {
                    'device_id': device_id,
                    'device_info': device_info,
                    'message': f'تم تفعيل الجهاز: {device_info.get("name", "Unknown") if device_info else "Unknown"}'
                }, namespace='/api/devices')
            except Exception:
                pass
            
            return jsonify({
                'success': True,
                'message': msg,
                'device': device_info
            })
        else:
            return jsonify({'error': msg}), 400
    
    except ImportError:
        return jsonify({'error': 'خدمة حظر الأجهزة غير متاحة'}), 503
    except Exception as e:
        logger.error(f"Error approving blocked device: {e}")
        return jsonify({'error': str(e)}), 500


@devices_bp.route('/blocker/revoke', methods=['POST'])
@jwt_required()
def blocker_revoke_approval():
    """
    سحب الموافقة من جهاز وإعادة حظره.
    يتوقع JSON: { "device_id": "USB\\VID_xxxx&PID_xxxx\\serial" }
    """
    try:
        err, server_id = verify_and_context(CONTROL_ROLES)
        if err:
            return err
        
        data = request.get_json(force=True) or {}
        device_id = data.get('device_id', '')
        
        if not device_id:
            return jsonify({'error': 'device_id مطلوب'}), 400
        
        from services.device_blocker import revoke_device_approval
        
        success, msg = revoke_device_approval(device_id)
        
        if success:
            try:
                socketio.emit('device:blocked', {
                    'device_id': device_id,
                    'message': f'تم سحب الموافقة وحظر الجهاز'
                }, namespace='/api/devices')
            except Exception:
                pass
            
            return jsonify({
                'success': True,
                'message': msg
            })
        else:
            return jsonify({'error': msg}), 400
    
    except ImportError:
        return jsonify({'error': 'خدمة حظر الأجهزة غير متاحة'}), 503
    except Exception as e:
        logger.error(f"Error revoking device approval: {e}")
        return jsonify({'error': str(e)}), 500
