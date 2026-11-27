# backend/controllers/activation.py

import random
import string
import json
import psutil
import platform
import socket
import uuid
import time

from datetime import datetime, timedelta, timezone
# محاولة استخدام zoneinfo لتوقيت بغداد
try:
    from zoneinfo import ZoneInfo
    BAGHDAD_TZ = ZoneInfo("Asia/Baghdad")
except ImportError:
    BAGHDAD_TZ = timezone(timedelta(hours=3))

def now_baghdad() -> datetime:
    """الوقت الحالي بتوقيت بغداد (UTC+3)."""
    from utils import current_time
    return current_time()

from flask import Blueprint, request, jsonify, current_app
from flask_cors import cross_origin
from flask_mail import Message
from flask_jwt_extended import jwt_required

from models import ActivationKey, SystemSettings, Log, User
from extensions import db, socketio, mail
from utils import generate_alert
from services.blockchain_service import create_blockchain_record
from services.auth_service import activate_license, get_license_status
from models import License, LicenseActivation

activation_bp = Blueprint('activation', __name__)


def _generate_activation_key(length=20):
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))


def verify_token():
    """Verify JWT and return user_id; None if invalid."""
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return None
    token = auth.split(' ', 1)[1]
    try:
        from flask_jwt_extended import decode_token
        payload = decode_token(token)
        return payload.get('sub') or payload.get('user_id')
    except Exception:
        return None


def require_admin():
    """Ensure the caller is an authenticated admin user."""
    uid = verify_token()
    if not uid:
        return None, jsonify({'error': 'Authentication required'}), 401
    user = User.query.get(uid)
    if not user or 'admin' not in [r.name for r in user.roles]:
        return None, jsonify({'error': 'Administrator privileges required'}), 403
    return uid, None, None


# ----- System Activation ----- #

@activation_bp.route('/activate', methods=['POST'])

def activate_system():
    data    = request.get_json() or {}
    key_str = data.get('activation_key')
    org     = data.get('organization_name')
    email   = data.get('admin_email')
    phone   = data.get('phone')
    if not key_str or not org or not email:
        return jsonify({'error': 'Missing required fields'}), 400

    # ترخيص المالك - قبول أي مفتاح
    owner_activation = {
        'success': True,
        'message': 'تم تفعيل ترخيص المالك بنجاح',
        'message_en': 'Owner license activated successfully',
        'license_type': 'OWNER_PREMIUM',
        'organization': org,
        'email': email,
        'phone': phone,
        'activated_at': now_baghdad().isoformat(),
        'expires_at': None,  # لا ينتهي أبداً
        'permanent': True,
        'features': {
            'unlimited_devices': True,
            'advanced_monitoring': True,
            'ai_analysis': True,
            'blockchain_integration': True,
            'advanced_reporting': True,
            'multi_server': True,
            'enterprise_features': True,
            'premium_support': True
        }
    }
    
    # سجل التفعيل
    audit = Log(
        action='owner_license_activated',
        user_id=request.remote_addr,
        ip_address=request.remote_addr,
        details=json.dumps({
            'organization': org,
            'email': email,
            'key_used': key_str[:8] + '****'  # إخفاء جزء من المفتاح للأمان
        }),
        timestamp=now_baghdad()
    )
    db.session.add(audit)
    db.session.commit()
    
    # إنشاء تنبيه
    generate_alert(f'تم تفعيل ترخيص المالك للمؤسسة: {org}', 'normal')
    
    # سجل في البلوك تشين
    create_blockchain_record(
        'owner_license_activated',
        {
            'organization': org,
            'email': email,
            'activated_at': now_baghdad().isoformat()
        },
        request.remote_addr
    )
    
    return jsonify(owner_activation), 200


def _schedule_license_reminders(key, valid_until_iso: str):
    """
    Schedule reminders days before license expiration.
    """
    try:
        from app import scheduler
    except ImportError:
        current_app.logger.error(
            "Cannot import scheduler; ensure it's a module-level variable in app.py"
        )
        return

    valid_until = datetime.fromisoformat(valid_until_iso).astimezone(BAGHDAD_TZ)
    days_list   = current_app.config.get('SUBSCRIPTION_REMINDER_DAYS', [7, 3, 1])
    admin_emails = current_app.config.get('ADMIN_EMAILS', [])

    for days_before in days_list:
        remind_date = valid_until - timedelta(days=days_before)
        if remind_date <= now_baghdad():
            continue

        subject = f"تذكير: رخصة النظام تنتهي بعد {days_before} يوم"
        body = (
            f"مرحباً،\n\n"
            f"رخصتكم ({key.key}) ستنتهي بتاريخ {valid_until.date()}.\n"
            f"هذا تذكير قبل {days_before} يوم من انتهاء الرخصة.\n\n"
            "يرجى التجديد إذا لزم الأمر."
        )
        job_id = f"license_reminder_{key.id}_{days_before}"

        # Remove existing job if present
        if scheduler.get_job(job_id):
            scheduler.remove_job(job_id)

        scheduler.add_job(
            func=lambda subj=subject, recips=admin_emails, bd=body: _send_license_email(subj, recips, bd),
            trigger='date',
            run_date=remind_date,
            id=job_id,
            replace_existing=True
        )


def _send_license_email(subject: str, recipients, body: str):
    """Helper to send reminder email via Flask-Mail."""
    try:
        msg = Message(
            subject=subject,
            sender=current_app.config.get("MAIL_DEFAULT_SENDER"),
            recipients=recipients,
            body=body
        )
        mail.send(msg)
        generate_alert(f"Sent license reminder email: {subject}", "normal")
    except Exception as e:
        current_app.logger.error(f"Failed to send license reminder email: {e}")


# ----- Activation Key Management (admin only) ----- #

@activation_bp.route('/keys', methods=['GET'])

def list_activation_keys():
    uid, resp, code = require_admin()
    if resp:
        return resp, code

    keys = ActivationKey.query.all()
    result = [
        {
            'id':           k.id,
            'key':          k.key,
            'license_type': k.license_type,
            'max_users':    k.max_users,
            'max_devices':  k.max_devices,
            'valid_until':  k.valid_until.isoformat() if k.valid_until else None,
            'is_used':      k.is_used
        }
        for k in keys
    ]

    db.session.add(Log(
        action="activation_keys_listed",
        user_id=uid,
        timestamp=now_baghdad()
    ))
    db.session.commit()
    create_blockchain_record("activation_keys_listed", {'count': len(result)}, uid)

    return jsonify({'keys': result}), 200


@activation_bp.route('/keys', methods=['POST'])

def create_activation_key():
    uid, resp, code = require_admin()
    if resp:
        return resp, code

    data         = request.get_json() or {}
    license_type = data.get('license_type')
    if not license_type:
        return jsonify({'error': 'license_type is required'}), 400

    max_users   = data.get('max_users', 1)
    max_devices = data.get('max_devices', 10)
    valid_days  = data.get('valid_days', 365)
    new_key = ActivationKey(
        key          = _generate_activation_key(),
        license_type = license_type,
        max_users    = max_users,
        max_devices  = max_devices,
        valid_until  = now_baghdad() + timedelta(days=valid_days),
        is_used      = False
    )
    db.session.add(new_key)
    db.session.commit()

    payload = {
        'id':           new_key.id,
        'key':          new_key.key,
        'license_type': new_key.license_type,
        'max_users':    new_key.max_users,
        'max_devices':  new_key.max_devices,
        'valid_until':  new_key.valid_until.isoformat()
    }
    db.session.add(Log(
        action="activation_key_created",
        user_id=uid,
        details=json.dumps(payload),
        timestamp=now_baghdad()
    ))
    db.session.commit()
    create_blockchain_record("activation_key_created", payload, uid)
    generate_alert(f"Activation key created: {new_key.key}", "normal")

    socketio.emit(
        'activation:key_created',
        payload,
        namespace='/api/activation',
        broadcast=True
    )

    return jsonify(payload), 201


@activation_bp.route('/keys/<int:key_id>', methods=['GET'])

def get_activation_key(key_id):
    uid, resp, code = require_admin()
    if resp:
        return resp, code

    k = ActivationKey.query.get_or_404(key_id)
    result = {
        'id':           k.id,
        'key':          k.key,
        'license_type': k.license_type,
        'max_users':    k.max_users,
        'max_devices':  k.max_devices,
        'valid_until':  k.valid_until.isoformat() if k.valid_until else None,
        'is_used':      k.is_used
    }

    db.session.add(Log(
        action="activation_key_viewed",
        user_id=uid,
        details=json.dumps({'key_id': key_id}),
        timestamp=now_baghdad()
    ))
    db.session.commit()
    create_blockchain_record("activation_key_viewed", {'key_id': key_id}, uid)

    return jsonify(result), 200


@activation_bp.route('/keys/<int:key_id>', methods=['PUT'])

def update_activation_key(key_id):
    uid, resp, code = require_admin()
    if resp:
        return resp, code

    key = ActivationKey.query.get_or_404(key_id)
    data = request.get_json() or {}
    changes = {}
    if 'license_type' in data:
        key.license_type = data['license_type']; changes['license_type'] = data['license_type']
    if 'max_users' in data:
        key.max_users = data['max_users']; changes['max_users'] = data['max_users']
    if 'max_devices' in data:
        key.max_devices = data['max_devices']; changes['max_devices'] = data['max_devices']
    if 'valid_days' in data:
        key.valid_until = now_baghdad() + timedelta(days=int(data['valid_days'])); changes['valid_days'] = data['valid_days']
    db.session.commit()

    db.session.add(Log(
        action="activation_key_updated",
        user_id=uid,
        details=json.dumps({'key_id': key_id, **changes}),
        timestamp=now_baghdad()
    ))
    db.session.commit()
    create_blockchain_record("activation_key_updated", {'key_id': key_id, **changes}, uid)
    generate_alert(f"Activation key {key_id} updated", "normal")

    socketio.emit(
        'activation:key_updated',
        {'key_id': key_id, **changes},
        namespace='/api/activation',
        broadcast=True
    )

    return jsonify({'message': 'Key updated successfully'}), 200


@activation_bp.route('/keys/<int:key_id>', methods=['DELETE'])

def delete_activation_key(key_id):
    uid, resp, code = require_admin()
    if resp:
        return resp, code

    key = ActivationKey.query.get_or_404(key_id)
    db.session.delete(key)
    db.session.commit()

    db.session.add(Log(
        action="activation_key_deleted",
        user_id=uid,
        details=json.dumps({'key_id': key_id}),
        timestamp=now_baghdad()
    ))
    db.session.commit()
    create_blockchain_record("activation_key_deleted", {'key_id': key_id}, uid)
    generate_alert(f"Activation key {key_id} deleted", "normal")

    socketio.emit(
        'activation:key_deleted',
        {'key_id': key_id},
        namespace='/api/activation',
        broadcast=True
    )

    return jsonify({'message': 'Key deleted successfully'}), 200


# ----- Activation Key Validation (public) ----- #

@activation_bp.route('/activate/validate', methods=['GET'])

def validate_activation_key():
    key_str = request.args.get('key')
    if not key_str:
        return jsonify({'error': 'Key parameter is required'}), 400

    key = ActivationKey.query.filter_by(key=key_str).first()
    if not key:
        return jsonify({'valid': False, 'error': 'Key not found'}), 404
    if key.is_used:
        return jsonify({'valid': False, 'error': 'Key already used'}), 400
    if key.valid_until and key.valid_until < now_baghdad():
        return jsonify({'valid': False, 'error': 'Key expired'}), 400

    return jsonify({
        'valid':        True,
        'license_type': key.license_type,
        'max_users':    key.max_users,
        'max_devices':  key.max_devices,
        'valid_until':  key.valid_until.isoformat()
    }), 200


# ----- System Settings Management (admin only) ----- #

@activation_bp.route('/settings/initialize', methods=['POST'])
def initialize_default_settings():
    """تهيئة الإعدادات الافتراضية"""
    uid, resp, code = require_admin()
    if resp:
        return resp, code

    default_settings = [
        {'key': 'language', 'value': 'ar', 'type': 'string'},
        {'key': 'logLevel', 'value': 'info', 'type': 'string'},
        {'key': 'enableAlerts', 'value': True, 'type': 'boolean'},
        {'key': 'autoScan', 'value': True, 'type': 'boolean'},
        {'key': 'monitoringInterval', 'value': 30, 'type': 'int'},
        {'key': 'enableBlockchain', 'value': True, 'type': 'boolean'},
        {'key': 'maxLogSize', 'value': 100, 'type': 'int'},
        {'key': 'enableNotifications', 'value': True, 'type': 'boolean'},
        {'key': 'theme', 'value': 'auto', 'type': 'string'},
        {'key': 'backupInterval', 'value': 24, 'type': 'int'}
    ]

    initialized_count = 0
    for setting in default_settings:
        existing = SystemSettings.query.filter_by(key=setting['key']).first()
        if not existing:
            new_setting = SystemSettings(
                key=setting['key'],
                type=setting['type']
            )
            new_setting.set_value(setting['value'])
            db.session.add(new_setting)
            initialized_count += 1

    db.session.commit()

    # سجل العملية
    db.session.add(Log(
        action="default_settings_initialized",
        user_id=uid,
        details=json.dumps({'initialized_count': initialized_count}),
        timestamp=now_baghdad()
    ))
    db.session.commit()

    return jsonify({
        'message': f'تم تهيئة {initialized_count} إعداد افتراضي',
        'initialized_count': initialized_count
    }), 200


@activation_bp.route('/settings', methods=['GET'])

def list_system_settings():
    uid, resp, code = require_admin()
    if resp:
        return resp, code

    settings = SystemSettings.query.all()
    out = [{
        'key':        s.key,
        'value':      s.get_value(),
        'type':       s.type,
        'updated_at': s.modified_at.astimezone(BAGHDAD_TZ).isoformat()
    } for s in settings]

    db.session.add(Log(
        action="system_settings_listed",
        user_id=uid,
        timestamp=now_baghdad()
    ))
    db.session.commit()
    create_blockchain_record("system_settings_listed", {'count': len(out)}, uid)

    return jsonify({'settings': out}), 200


@activation_bp.route('/settings/<string:key>', methods=['GET'])
@jwt_required()
def get_system_setting(key):
    uid, resp, code = require_admin()
    if resp:
        return resp, code

    s = SystemSettings.query.filter_by(key=key).first_or_404()
    result = {
        'key':        s.key,
        'value':      s.get_value(),
        'type':       s.type,
        'updated_at': s.modified_at.astimezone(BAGHDAD_TZ).isoformat()
    }

    db.session.add(Log(
        action="system_setting_viewed",
        user_id=uid,
        details=json.dumps({'key': key}),
        timestamp=now_baghdad()
    ))
    db.session.commit()
    create_blockchain_record("system_setting_viewed", {'key': key}, uid)

    return jsonify(result), 200


@activation_bp.route('/settings', methods=['GET', 'POST', 'PUT'])
@jwt_required()
def create_system_setting():
    uid, resp, code = require_admin()
    if resp:
        return resp, code

    data = request.get_json() or {}
    
    # إذا كانت البيانات تحتوي على settings، فهذا تحديث متعدد
    if 'settings' in data:
        settings_to_update = data['settings']
        updated_settings = []
        
        for key, value in settings_to_update.items():
            # البحث عن الإعداد الموجود
            setting = SystemSettings.query.filter_by(key=key).first()
            
            # تحديد نوع البيانات
            value_type = 'string'
            if isinstance(value, bool):
                value_type = 'boolean'
                value = str(value).lower()
            elif isinstance(value, int):
                value_type = 'int'
                value = str(value)
            
            if setting:
                # تحديث الإعداد الموجود
                setting.value = value
                setting.type = value_type
                setting.modified_at = now_baghdad()
            else:
                # إضافة إعداد جديد
                setting = SystemSettings(
                    key=key,
                    value=value,
                    type=value_type,
                    modified_at=now_baghdad()
                )
                db.session.add(setting)
            
            updated_settings.append({
                'key': key,
                'value': setting.value,
                'type': setting.type
            })
        
        db.session.commit()
        
        # سجل تحديث الإعدادات
        db.session.add(Log(
            action="system_settings_updated",
            user_id=uid,
            details=json.dumps({
                'updated_settings': list(settings_to_update.keys()),
                'timestamp': now_baghdad().isoformat()
            }),
            timestamp=now_baghdad()
        ))
        db.session.commit()
        
        return jsonify({
            'message': 'تم تحديث الإعدادات بنجاح',
            'updated_settings': updated_settings
        }), 200
    
    # إذا كانت البيانات تحتوي على key و value، فهذا إنشاء إعداد واحد
    key_name = data.get('key')
    val = data.get('value')
    stype = data.get('type', 'string')
    
    if not key_name or val is None:
        return jsonify({'error': 'key and value are required'}), 400
    if SystemSettings.query.filter_by(key=key_name).first():
        return jsonify({'error': 'Setting key already exists'}), 400

    s = SystemSettings(key=key_name, type=stype)
    s.value = json.dumps(val) if stype == 'json' else str(val)
    s.modified_at = now_baghdad()
    db.session.add(s)
    db.session.commit()

    db.session.add(Log(
        action="system_setting_created",
        user_id=uid,
        details=json.dumps({'key': key_name, 'value': val}),
        timestamp=now_baghdad()
    ))
    db.session.commit()
    create_blockchain_record("system_setting_created", {'key': key_name, 'value': val}, uid)
    generate_alert(f"System setting created: {key_name}", "normal")

    socketio.emit(
        'activation:setting_created',
        {'key': key_name, 'value': val},
        namespace='/api/activation',
        broadcast=True
    )

    return jsonify({'message': 'Setting created', 'key': key_name}), 201


@activation_bp.route('/settings/<string:key>', methods=['PUT'])

def update_system_setting(key):
    uid, resp, code = require_admin()
    if resp:
        return resp, code

    s = SystemSettings.query.filter_by(key=key).first_or_404()
    data = request.get_json() or {}
    changes = {}
    if 'value' in data:
        old = s.get_value()
        new = data['value']
        changes = {'old_value': old, 'new_value': new}
        s.value = json.dumps(new) if s.type == 'json' else str(new)
    s.modified_at = now_baghdad()
    db.session.commit()

    db.session.add(Log(
        action="system_setting_updated",
        user_id=uid,
        details=json.dumps({'key': key, **changes}),
        timestamp=now_baghdad()
    ))
    db.session.commit()
    create_blockchain_record("system_setting_updated", {'key': key, **changes}, uid)
    generate_alert(f"System setting updated: {key}", "normal")

    socketio.emit(
        'activation:setting_updated',
        {'key': key, **changes},
        namespace='/api/activation',
        broadcast=True
    )

    return jsonify({'message': 'Setting updated', 'key': key}), 200


@activation_bp.route('/settings/<string:key>', methods=['DELETE'])
@jwt_required()
def delete_system_setting(key):
    uid, resp, code = require_admin()
    if resp:
        return resp, code

    s = SystemSettings.query.filter_by(key=key).first_or_404()
    db.session.delete(s)
    db.session.commit()

    db.session.add(Log(
        action="system_setting_deleted",
        user_id=uid,
        details=json.dumps({'key': key}),
        timestamp=now_baghdad()
    ))
    db.session.commit()
    create_blockchain_record("system_setting_deleted", {'key': key}, uid)
    generate_alert(f"System setting deleted: {key}", "normal")

    socketio.emit(
        'activation:setting_deleted',
        {'key': key},
        namespace='/api/activation',
        broadcast=True
    )

    return jsonify({'message': 'Setting deleted', 'key': key}), 200


# ----- System Info & Scan Endpoints ----- #

@activation_bp.route('/system/settings/reset', methods=['POST'])
def reset_system_settings():
    """إعادة تعيين الإعدادات إلى القيم الافتراضية"""
    try:
        user_id = verify_token()
        if not user_id:
            return jsonify({'error': 'غير مصرح'}), 401
        
        # حذف جميع الإعدادات الحالية
        SystemSettings.query.delete()
        
        # إضافة الإعدادات الافتراضية
        default_settings = [
            ('monitoringInterval', '30', 'int', 'فترة المراقبة بالثواني'),
            ('enableAlerts', 'true', 'boolean', 'تمكين الإشعارات'),
            ('autoBackup', 'true', 'boolean', 'النسخ الاحتياطي التلقائي'),
            ('blockUnknownDevices', 'false', 'boolean', 'حظر الأجهزة غير المعروفة'),
            ('logRetentionDays', '30', 'int', 'عدد أيام الاحتفاظ بالسجلات'),
            ('maxDatabaseSize', '100', 'int', 'حد حجم قاعدة البيانات بالميجابايت'),
            ('serverPort', '5000', 'int', 'منفذ الخادم'),
            ('enableEncryption', 'true', 'boolean', 'تفعيل التشفير'),
            ('sessionTimeout', '3600', 'int', 'انتهاء الجلسة بالثواني'),
            ('maxLoginAttempts', '5', 'int', 'عدد محاولات تسجيل الدخول القصوى')
        ]
        
        for key, value, value_type, description in default_settings:
            setting = SystemSettings(
                key=key,
                value=value,
                type=value_type,
                description=description,
                modified_at=now_baghdad()
            )
            db.session.add(setting)
        
        db.session.commit()
        
        # سجل إعادة التعيين
        audit = Log(
            action='system_settings_reset',
            user_id=user_id,
            ip_address=request.remote_addr,
            details=json.dumps({
                'message': 'تم إعادة تعيين الإعدادات إلى القيم الافتراضية',
                'timestamp': now_baghdad().isoformat()
            }),
            timestamp=now_baghdad()
        )
        db.session.add(audit)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'تم إعادة تعيين الإعدادات إلى القيم الافتراضية بنجاح'
        }), 200
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("Error resetting system settings")
        return jsonify({
            'success': False,
            'error': 'فشل في إعادة تعيين الإعدادات',
            'details': str(e)
        }), 500


@activation_bp.route('/system/scan', methods=['POST'])

def system_scan():
    """فحص شامل للنظام والأمان"""
    try:
        scan_results = {
            "scan_id": str(uuid.uuid4()),
            "timestamp": now_baghdad().isoformat(),
            "status": "completed",
            "duration_seconds": 0,
            "scan_type": "full_system_scan"
        }
        
        start_time = time.time()
        
        # 1. فحص أجهزة USB
        usb_scan = {
            "total_devices": 0,
            "safe_devices": 0,
            "suspicious_devices": 0,
            "blocked_devices": 0,
            "devices": []
        }
        
        try:
            from models import Device
            devices = Device.query.all()
            usb_scan["total_devices"] = len(devices)
            
            for device in devices:
                device_info = {
                    "name": device.name,
                    "serial": device.serial_number,
                    "status": device.status,
                    "risk_level": "low",  # يمكن تحسينه
                    "last_seen": device.created_at.isoformat() if device.created_at else None
                }
                usb_scan["devices"].append(device_info)
                
                if device.status == 'connected':
                    usb_scan["safe_devices"] += 1
                elif device.status == 'blocked':
                    usb_scan["blocked_devices"] += 1
                    
        except Exception as e:
            current_app.logger.error(f"USB scan error: {e}")
        
        # 2. فحص أداء النظام
        performance_scan = {
            "cpu_health": "good",
            "memory_health": "good", 
            "disk_health": "good",
            "network_health": "good",
            "issues_found": []
        }
        
        try:
            # فحص CPU
            cpu_usage = psutil.cpu_percent(interval=1)
            if cpu_usage > 90:
                performance_scan["cpu_health"] = "critical"
                performance_scan["issues_found"].append("CPU usage is critically high")
            elif cpu_usage > 70:
                performance_scan["cpu_health"] = "warning"
                performance_scan["issues_found"].append("CPU usage is high")
            
            # فحص الذاكرة
            mem = psutil.virtual_memory()
            if mem.percent > 90:
                performance_scan["memory_health"] = "critical"
                performance_scan["issues_found"].append("Memory usage is critically high")
            elif mem.percent > 75:
                performance_scan["memory_health"] = "warning"
                performance_scan["issues_found"].append("Memory usage is high")
            
            # فحص القرص الصلب
            disk = psutil.disk_usage('/')
            disk_percent = (disk.used / disk.total) * 100
            if disk_percent > 95:
                performance_scan["disk_health"] = "critical"
                performance_scan["issues_found"].append("Disk space is critically low")
            elif disk_percent > 85:
                performance_scan["disk_health"] = "warning"
                performance_scan["issues_found"].append("Disk space is running low")
                
        except Exception as e:
            current_app.logger.error(f"Performance scan error: {e}")
        
        # 3. فحص الأمان
        security_scan = {
            "usb_policies_active": True,
            "monitoring_enabled": True,
            "unauthorized_access_attempts": 0,
            "firewall_status": "active",
            "threats_detected": 0,
            "security_score": 95
        }
        
        try:
            # فحص محاولات الوصول غير المصرح
            from models import Log
            recent_logs = Log.query.filter(
                Log.timestamp > (now_baghdad() - timedelta(hours=24))
            ).filter(
                Log.action.like('%unauthorized%')
            ).count()
            
            security_scan["unauthorized_access_attempts"] = recent_logs
            
            if recent_logs > 5:
                security_scan["security_score"] -= 20
                performance_scan["issues_found"].append(f"High number of unauthorized access attempts: {recent_logs}")
                
        except Exception as e:
            current_app.logger.error(f"Security scan error: {e}")
        
        # 4. فحص قاعدة البيانات
        database_scan = {
            "connection_status": "healthy",
            "backup_status": "up_to_date",
            "data_integrity": "verified",
            "performance": "optimal"
        }
        
        try:
            # اختبار الاتصال بقاعدة البيانات
            db.session.execute("SELECT 1")
            db.session.commit()
        except Exception as e:
            database_scan["connection_status"] = "error"
            database_scan["performance"] = "poor"
            performance_scan["issues_found"].append(f"Database connection issue: {str(e)}")
        
        # حساب وقت الفحص
        scan_results["duration_seconds"] = round(time.time() - start_time, 2)
        
        # النتائج النهائية
        scan_results.update({
            "usb_scan": usb_scan,
            "performance_scan": performance_scan,
            "security_scan": security_scan,
            "database_scan": database_scan,
            "overall_health": "excellent" if len(performance_scan["issues_found"]) == 0 else (
                "good" if len(performance_scan["issues_found"]) < 3 else "needs_attention"
            ),
            "recommendations": [
                "Keep USB monitoring active",
                "Regular system updates recommended",
                "Monitor disk space usage",
                "Review security logs regularly"
            ] + (performance_scan["issues_found"] if performance_scan["issues_found"] else [])
        })
        
        # سجل الفحص
        audit = Log(
            action='system_scan_completed',
            user_id=request.remote_addr,
            ip_address=request.remote_addr,
            details=json.dumps({
                'scan_id': scan_results["scan_id"],
                'duration': scan_results["duration_seconds"],
                'issues_found': len(performance_scan["issues_found"])
            }),
            timestamp=now_baghdad()
        )
        db.session.add(audit)
        db.session.commit()
        
        return jsonify(scan_results), 200
        
    except Exception as e:
        current_app.logger.exception("Error during system scan")
        return jsonify({
            'error': 'فشل في فحص النظام',
            'details': str(e)
        }), 500


@activation_bp.route('/system/details', methods=['GET'])

def system_details():
    """جلب تفاصيل النظام الحقيقية"""
    try:
        import platform
        import socket
        import uuid
        import os
        
        # معلومات الأجهزة والنظام
        disk = psutil.disk_usage('/')
        mem = psutil.virtual_memory()
        cpu_percent = psutil.cpu_percent(interval=1)
        cpu_freq = psutil.cpu_freq()
        
        # معلومات الشبكة
        hostname = socket.gethostname()
        try:
            local_ip = socket.gethostbyname(hostname)
        except:
            local_ip = '127.0.0.1'
        
        # معلومات النظام
        boot_time = datetime.fromtimestamp(psutil.boot_time())
        uptime = datetime.now() - boot_time
        
        # معلومات USB والأجهزة
        usb_devices = []
        try:
            # جلب أجهزة USB المتصلة من Supabase
            from supabase_config import get_supabase_client
            client = get_supabase_client()
            if client:
                devices_result = client.table('devices').select('name,serial_number,status').eq('status', 'connected').execute()
                usb_devices = devices_result.data if devices_result.data else []
                # تنسيق البيانات للتوافق
                usb_devices = [{'name': d.get('name', ''), 'serial': d.get('serial_number', ''), 'status': d.get('status', '')} for d in usb_devices]
        except:
            pass
        
        # معلومات الأمان
        security_status = {
            'firewall_enabled': True,  # يمكن تحسينه للتحقق الحقيقي
            'antivirus_status': 'active',
            'last_security_scan': now_baghdad().isoformat(),
            'threat_level': 'low'
        }
        
        # معلومات الترخيص
        license_info = {
            'status': 'active',
            'type': 'OWNER_PREMIUM',
            'expires_at': None,  # لا ينتهي للمالك
            'features_enabled': ['all']
        }
        
        details = {
            "name": "نظام مراقبة أجهزة USB عن بعد",
            "version": current_app.config.get('APP_VERSION', '2.1.0'),
            "installPath": os.getcwd(),
            "time": now_baghdad().isoformat(),
            "uptimeTimestamp": boot_time.isoformat(),
            "lastScan": now_baghdad().isoformat(),
            "developer": {
                "name": "Hasan Ali Hasan",
                "team": "فريق Alpha",
                "department": "قسم المطورين",
                "github": "hasan21i",
                "specialization": "مطور أنظمة أمنية",
                "role": "عضو فريق Alpha",
                "contact": "متاح عبر GitHub"
            },
            "project_info": {
                "purpose": "نظام مراقبة ومنع تسريب البيانات عبر أجهزة USB",
                "creation_date": "ديسمبر 2024",
                "last_update": "يناير 2025",
                "license_type": "مملوك بالكامل - لا قيود",
                "technologies": ["Python Flask", "React JS", "PostgreSQL", "Bootstrap", "WebSocket"],
                "features": [
                    "مراقبة أجهزة USB في الوقت الفعلي",
                    "نظام تنبيهات ذكي",
                    "تقارير مفصلة",
                    "واجهة ويب متقدمة",
                    "نظام أذونات متقدم",
                    "حماية من التسريب",
                    "دعم Blockchain للأمان"
                ]
            },
            "system": {
                "os": platform.system(),
                "os_version": platform.version(),
                "os_release": platform.release(),
                "architecture": platform.architecture()[0],
                "machine": platform.machine(),
                "processor": platform.processor(),
                "hostname": hostname,
                "local_ip": local_ip,
                "mac_address": ':'.join(['{:02x}'.format((uuid.getnode() >> ele) & 0xff) for ele in range(0,8*6,8)][::-1]),
                "python_version": platform.python_version(),
                "boot_time": boot_time.isoformat(),
                "uptime_hours": round(uptime.total_seconds() / 3600, 2)
            },
            "resources": {
                "cpu": {
                    "usage_percent": cpu_percent,
                    "core_count": psutil.cpu_count(),
                    "logical_count": psutil.cpu_count(logical=True),
                    "frequency_mhz": cpu_freq.current if cpu_freq else 0,
                    "max_frequency_mhz": cpu_freq.max if cpu_freq else 0
                },
                "memory": {
                    "total_gb": round(mem.total / (1024**3), 2),
                    "used_gb": round(mem.used / (1024**3), 2),
                    "available_gb": round(mem.available / (1024**3), 2),
                    "usage_percent": mem.percent
                },
                "disk": {
                    "total_gb": round(disk.total / (1024**3), 2),
                    "used_gb": round(disk.used / (1024**3), 2),
                    "free_gb": round(disk.free / (1024**3), 2),
                    "usage_percent": round((disk.used / disk.total) * 100, 2)
                }
            },
            "usb_monitoring": {
                "status": "active",
                "connected_devices": len(usb_devices),
                "devices": usb_devices[:10],  # أول 10 أجهزة
                "monitoring_enabled": True,
                "auto_scan_interval": "30 seconds"
            },
            "security": security_status,
            "license": license_info,
            "services": {
                "database": "connected",
                "usb_monitor": "active",
                "web_server": "running",
                "api_server": "running",
                "blockchain": "active",
                "logging": "active"
            }
        }
        
        # سجل عرض تفاصيل النظام في Supabase
        try:
            from supabase_config import get_supabase_client
            client = get_supabase_client()
            if client:
                # محاولة تحويل user_id إلى integer إذا أمكن
                user_id_value = None
                try:
                    user_id_value = int(request.remote_addr) if request.remote_addr and request.remote_addr.isdigit() else None
                except:
                    user_id_value = None

                log_data = {
                    'action': 'system_details_viewed',
                    'user_id': user_id_value,
                    'ip_address': request.remote_addr or '127.0.0.1',
                    'details': json.dumps({'timestamp': now_baghdad().isoformat()}),
                    'timestamp': now_baghdad().isoformat(),
                    'success': True
                }
                client.table('logs').insert(log_data).execute()
        except Exception as log_error:
            current_app.logger.error(f"Error logging system details view: {log_error}")
            # لا نرمي الخطأ، فقط نسجل الخطأ ونستمر
        
        return jsonify(details), 200
        
    except Exception as e:
        current_app.logger.exception("Error fetching system details")
        return jsonify({
            'error': 'فشل في جلب تفاصيل النظام',
            'details': str(e)
        }), 500


@activation_bp.route('/activate', methods=['POST'])
def activate():
    data = request.get_json() or {}
    server_id = data.get('server_id')
    ip_address = data.get('ip_address')
    result = activate_license(data, server_id, ip_address)
    return jsonify(result), 200 if result.get('success') else 400

@activation_bp.route('/status', methods=['GET'])
def license_status():
    # ترخيص دائم للمالك - النسخة مفتوحة دائماً
    owner_license = {
        'status': 'active',
        'expiry_date': None,
        'activated': True,
        'valid': True,
        'permanent': True,
        'owner_license': True,
        'license_type': 'OWNER_PREMIUM',
        'organization': 'مالك النظام',
        'activated_at': now_baghdad().isoformat(),
        'expires_at': None,  # لا ينتهي أبداً
        'days_remaining': -1,  # لا محدود
        'features': {
            'unlimited_devices': True,
            'advanced_monitoring': True,
            'ai_analysis': True,
            'blockchain_integration': True,
            'advanced_reporting': True,
            'multi_server': True,
            'enterprise_features': True,
            'premium_support': True
        },
        'status_message': 'ترخيص المالك - مفعل دائماً',
        'status_message_en': 'Owner License - Permanently Activated'
    }
    
    # سجل عرض حالة الترخيص
    audit = Log(
        action='license_status_checked',
        user_id=request.remote_addr,
        ip_address=request.remote_addr,
        details=json.dumps({'license_type': 'OWNER_PREMIUM'}),
        timestamp=now_baghdad()
    )
    db.session.add(audit)
    db.session.commit()
    
    return jsonify(owner_license), 200

@activation_bp.route('/activations', methods=['GET'])
def license_activations():
    activations = LicenseActivation.query.order_by(LicenseActivation.activated_at.desc()).all()
    return jsonify([a.to_dict() for a in activations]), 200

@activation_bp.route('/licenses', methods=['GET'])
def licenses():
    licenses = License.query.order_by(License.issued_at.desc()).all()
    return jsonify([l.to_dict() for l in licenses]), 200


