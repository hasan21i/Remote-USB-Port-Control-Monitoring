import os
import json
import logging
from datetime import datetime, timedelta
from typing import Optional

import jwt
from flask import current_app, request

from extensions import socketio, send_to_siem
from utils import generate_alert  # للتأكد من وجود الدالة

# Ensure Supabase client is initialized
def get_supabase_client():
    """Get fresh Supabase client instance for auth service"""
    try:
        from flask import current_app
        from supabase import create_client
        
        supabase_url = current_app.config.get('SUPABASE_URL')
        supabase_anon_key = current_app.config.get('SUPABASE_ANON_KEY')
        
        if supabase_url and supabase_anon_key:
            return create_client(supabase_url, supabase_anon_key)
        else:
            current_app.logger.error("Supabase configuration missing in auth service")
            return None
    except Exception as e:
        current_app.logger.error(f"Failed to create Supabase client in auth service: {e}")
        return None

import base64
import hashlib
from Crypto.PublicKey import RSA
from Crypto.Signature import pkcs1_15
from Crypto.Hash import SHA256
from Crypto.Cipher import AES

MASTER_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----\n...YOUR_RSA_PUBLIC_KEY...\n-----END PUBLIC KEY-----"""  # ضع المفتاح العام الصحيح هنا


logger = logging.getLogger(__name__)

def configure_logger():
    logger.setLevel(current_app.config.get("LOG_LEVEL", "INFO"))


def hash_password(password: str) -> str:
    """Hash a password with a random salt; raises on empty."""
    if not password:
        raise ValueError("كلمة المرور مطلوبة")
    # For Supabase integration, we'll use a simple hash method
    # In production, you should use a proper password hashing library
    salt = os.urandom(16).hex()
    # Simple hash for demonstration - use proper library in production
    hashed = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"{salt}${hashed}"


def verify_password(plain: str, hashed: str) -> bool:
    """Verify plaintext against salted hash; returns False on error."""
    try:
        salt, hash_val = hashed.split('$', 1)
        # Simple verification for demonstration - use proper library in production
        return hashlib.sha256((salt + plain).encode()).hexdigest() == hash_val
    except Exception:
        logger.warning("تنسيق هاش كلمة المرور غير صالح")
        return False


def create_access_token(user_data: dict) -> str:
    """
    Issue a JWT for a user, include roles, log the event, SIEM, and SocketIO.
    """
    secret = current_app.config['JWT_SECRET_KEY']
    expiry = current_app.config.get('JWT_ACCESS_TOKEN_EXPIRES', timedelta(hours=2))
    exp = datetime.utcnow() + expiry

    # include roles array for RBAC
    payload = {
        "sub": user_data.get('id'),
        "username": user_data.get('username'),
        "roles": user_data.get('roles', ['user']),
        "exp": exp.timestamp()
    }

    try:
        token = jwt.encode(payload, secret, algorithm='HS256')
    except Exception as e:
        logger.error(f"JWT encode failed: {e}")
        raise

    # Log issuance to Supabase
    client = get_supabase_client()
    if client:
        try:
            log_data = {
                "action": 'token_issued',
                "user_id": user_data.get('id'),
                "ip_address": request.remote_addr,
                "details": json.dumps({"event": "issued", **payload}),
                "timestamp": datetime.utcnow().isoformat()
            }
            client.table('logs').insert(log_data).execute()
        except Exception as e:
            logger.error(f"Failed to log token issuance to Supabase: {e}")

    # SIEM
    send_to_siem("token_issued", {
        "user_id": user_data.get('id'),
        "ip": request.remote_addr
    })

    # SocketIO emit
    try:
        socketio.emit("token_issued", {
            "user_id": user_data.get('id'),
            "timestamp": datetime.utcnow().isoformat()
        }, namespace="/auth")
    except Exception as e:
        logger.exception(f"SocketIO emit failed: {e}")

    return token


def decode_token(token: str) -> Optional[dict]:
    """
    Decode and verify JWT; on failure log, alert, SIEM, and return None.
    Successful decodes are also logged and sent to SIEM.
    """
    secret = current_app.config['JWT_SECRET_KEY']
    try:
        payload = jwt.decode(token, secret, algorithms=['HS256'])
    except jwt.ExpiredSignatureError:
        msg = "انتهت صلاحية رمز المصادقة"
        logger.info(msg)
        send_to_siem("token_expired", {"ip": request.remote_addr})
        generate_alert(msg, "medium", {"ip": request.remote_addr})
        return None
    except jwt.InvalidTokenError:
        msg = "رمز المصادقة غير صالح"
        logger.info(msg)
        send_to_siem("token_invalid", {"ip": request.remote_addr})
        generate_alert(msg, "high", {"ip": request.remote_addr})
        return None

    # successful decode: سجل الحدث
    client = get_supabase_client()
    if client:
        try:
            log_data = {
                "action": 'token_decoded',
                "user_id": payload.get('sub'),
                "ip_address": request.remote_addr,
                "details": json.dumps({"event": "decoded"}),
                "timestamp": datetime.utcnow().isoformat()
            }
            client.table('logs').insert(log_data).execute()
        except Exception as e:
            logger.error(f"Failed to log token decode to Supabase: {e}")

    send_to_siem("token_decoded", {"user_id": payload.get('sub'), "ip": request.remote_addr})
    return payload


def verify_license_key(license_key: str, digital_signature: str) -> bool:
    """التحقق من صحة الرخصة والتوقيع الرقمي باستخدام RSA-4096/SHA-256."""
    try:
        pubkey = RSA.import_key(MASTER_PUBLIC_KEY)
        h = SHA256.new(license_key.encode('utf-8'))
        signature = base64.b64decode(digital_signature)
        pkcs1_15.new(pubkey).verify(h, signature)
        return True
    except Exception:
        return False


def activate_license(license_data: dict, server_id: int, ip_address: str) -> dict:
    """تفعيل الرخصة وتخزينها في قاعدة البيانات."""
    license_key = license_data['license_key']
    digital_signature = license_data['digital_signature']
    if not verify_license_key(license_key, digital_signature):
        return {"success": False, "message": "توقيع الرخصة غير صحيح"}
    
    supabase_client = get_supabase_client()
    if supabase_client:
        try:
            # Check if license already exists
            response = supabase_client.table('licenses').select('*').eq('license_key', license_key).limit(1).execute()
            lic_data = response.data[0] if response.data else None
            
            if not lic_data:
                # Create new license
                lic_data = {
                    'organization_id': license_data['organization_id'],
                    'license_key': license_key,
                    'license_type': license_data['license_type'],
                    'features': json.dumps(license_data.get('features', {})),
                    'issued_at': license_data['issued_at'],
                    'expires_at': license_data['expires_at'],
                    'max_servers': license_data.get('max_servers', 1),
                    'max_users': license_data.get('max_users', 1),
                    'status': 'active',
                    'digital_signature': digital_signature,
                    'is_active': True,
                }
                response = supabase_client.table('licenses').insert(lic_data).execute()
                lic_data = response.data[0] if response.data else lic_data
            
            # Activate on server
            activation_data = {
                'license_id': lic_data['id'],
                'server_id': server_id,
                'ip_address': ip_address,
                'activated_at': datetime.utcnow().isoformat(),
                'last_heartbeat': datetime.utcnow().isoformat(),
                'status': 'active',
            }
            supabase_client.table('license_activations').insert(activation_data).execute()
            
            return {"success": True, "message": "تم تفعيل الرخصة بنجاح", "license": lic_data}
        except Exception as e:
            return {"success": False, "message": f"فشل تفعيل الرخصة: {str(e)}"}
    
    return {"success": False, "message": "خدمة قاعدة البيانات غير متوفرة"}


def periodic_license_check():
    """التحقق الدوري من الرخصة (كل 24 ساعة)."""
    supabase_client = get_supabase_client()
    if supabase_client:
        try:
            now = datetime.utcnow().isoformat()
            response = supabase_client.table('licenses').select('*').eq('is_active', True).execute()
            licenses = response.data if response.data else []
            
            for lic in licenses:
                if lic['expires_at'] < now:
                    supabase_client.table('licenses').update({
                        'status': 'expired',
                        'is_active': False
                    }).eq('id', lic['id']).execute()
        except Exception as e:
            logger.error(f"License check failed: {e}")


def get_license_status() -> dict:
    """جلب حالة الرخصة والميزات المفعلة."""
    supabase_client = get_supabase_client()
    if supabase_client:
        try:
            response = supabase_client.table('licenses').select('*').eq('is_active', True).order('issued_at', desc=True).limit(1).execute()
            lic = response.data[0] if response.data else None
            
            if not lic:
                return {"active": False, "message": "لا توجد رخصة مفعلة"}
            
            return {
                "active": True,
                "license": lic,
                "features": json.loads(lic.get('features', '{}')),
                "expires_at": lic.get('expires_at'),
                "status": lic.get('status'),
            }
        except Exception as e:
            return {"active": False, "message": f"فشل في جلب حالة الرخصة: {str(e)}"}
    
    return {"active": False, "message": "خدمة قاعدة البيانات غير متوفرة"}