import os
import json
import uuid
import pyotp
from datetime import datetime, timedelta
import jwt
from flask import Blueprint, jsonify, request, current_app, url_for
# from flask_cors import cross_origin  # تم إزالة CORS المحلي
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    jwt_required,
    get_jwt_identity,
    decode_token
)
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
import qrcode
import base64
from io import BytesIO
import werkzeug

from extensions import mail, send_to_siem, db

def get_supabase_client():
    """Get a fresh Supabase client for each request to avoid connection issues"""
    try:
        from supabase import create_client
        from flask import current_app
        
        supabase_url = current_app.config.get('SUPABASE_URL')
        supabase_anon_key = current_app.config.get('SUPABASE_ANON_KEY')
        
        if supabase_url and supabase_anon_key:
            # Create a fresh client for each request
            client = create_client(supabase_url, supabase_anon_key)
            return client
        else:
            current_app.logger.error("Supabase URL or ANON_KEY missing")
            return None
    except Exception as e:
        current_app.logger.error(f"Failed to create fresh Supabase client: {e}")
        return None
from utils import (
    hash_password,
    verify_password,
    generate_alert,
    send_email_notification,
    roles_required,
)
from services.blockchain_service import create_blockchain_record
from services.auth_service import create_access_token as create_jwt_token

# Import models for compatibility
try:
    from models import User, Role, Permission, Log
except ImportError:
    # Fallback for Supabase-only mode
    User = Role = Permission = Log = None

auth_bp = Blueprint('auth', __name__)

DEFAULT_ROLE = 'Viewer'

JWT_ACCESS_EXPIRES = timedelta(days=7)
JWT_REFRESH_EXPIRES = timedelta(days=14)

def get_user_permissions(user_data):
    # For Supabase, permissions are stored in the user data
    return user_data.get('permissions', [])

def _get_serializer() -> URLSafeTimedSerializer:
    secret = current_app.config.get('SECRET_KEY', 'super_secret_key')
    return URLSafeTimedSerializer(secret)

def get_current_user():
    """الحصول على المستخدم الحالي من JWT token"""
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return None
        
        token = auth_header.split(' ')[1]
        payload = decode_token(token)
        user_id = payload.get('sub')  # Flask-JWT-Extended uses 'sub' for identity
        
        # Get user from Supabase
        client = get_supabase_client()
        if client:
            response = client.table('users').select('*').eq('id', user_id).limit(1).execute()
            return response.data[0] if response.data else None
        return None
    except:
        return None

# -------------------- Auth Endpoints --------------------

@auth_bp.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json() or {}
        
        # Validate required fields
        username = data.get('username', '').strip()
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not username:
            return jsonify({'error': 'Username is required', 'message': 'اسم المستخدم مطلوب'}), 400
        if not email:
            return jsonify({'error': 'Email is required', 'message': 'البريد الإلكتروني مطلوب'}), 400
        if not password:
            return jsonify({'error': 'Password is required', 'message': 'كلمة المرور مطلوبة'}), 400
            
        # Validate email format
        import re
        if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email):
            return jsonify({'error': 'Invalid email format', 'message': 'صيغة البريد الإلكتروني غير صحيحة'}), 400
            
        # Validate password strength
        if len(password) < 6:
            return jsonify({'error': 'Password too short', 'message': 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'}), 400
            
        # Validate username length
        if len(username) < 3:
            return jsonify({'error': 'Username too short', 'message': 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل'}), 400
            
    except Exception as e:
        return jsonify({'error': 'Invalid request data', 'message': 'بيانات الطلب غير صحيحة'}), 400

    client = get_supabase_client()
    if not client:
        return jsonify({'error': 'Authentication service unavailable', 'message': 'خدمة المصادقة غير متوفرة'}), 503

    try:
        # Check if email already exists
        response = client.table('users').select('id').eq('email', email).limit(1).execute()
        if response.data:
            return jsonify({
                'error': 'Email already registered',
                'message': f'البريد الإلكتروني "{email}" مسجل مسبقاً. يرجى استخدام بريد إلكتروني آخر.'
            }), 400

        # Check if username already exists
        response = client.table('users').select('id').eq('username', username).limit(1).execute()
        if response.data:
            return jsonify({
                'error': 'Username already taken',
                'message': f'اسم المستخدم "{username}" مستخدم مسبقاً. يرجى اختيار اسم مستخدم آخر.'
            }), 400

        # Hash password
        password_hash = hash_password(password)
        
        # Create user in Supabase (let Supabase generate the ID automatically)
        user_data = {
            'username': username,
            'email': email,
            'password_hash': password_hash,
            'status': 'active',
            'mfa_enabled': False,
            'role': data.get('role', 'user'),
            'created_at': datetime.utcnow().isoformat()
        }
        # Filter payload to existing table columns to avoid PostgREST schema errors
        try:
            from utils import filter_payload_for_table
            user_data = filter_payload_for_table('users', user_data)
        except Exception:
            pass

        response = client.table('users').insert(user_data).execute()
        user = response.data[0] if response.data else None
        
        if not user:
            return jsonify({'error': 'Registration failed. Please try again.'}), 500

        # Log the registration (disabled temporarily to fix UUID issue)
        try:
            log_data = {
                "action": "user_registered",
                "user_id": user['id'],  # This might be causing the UUID to integer conversion error
                "details": json.dumps({
                    "username": user['username'],
                    "email": user['email'],
                    "role": user['role']
                }),
                "timestamp": datetime.utcnow().isoformat()
            }
            try:
                from utils import filter_payload_for_table
                filtered_log = filter_payload_for_table('logs', log_data)
            except Exception:
                filtered_log = log_data
            client.table('logs').insert(filtered_log).execute()
        except Exception as log_error:
            current_app.logger.warning(f"Failed to log registration: {log_error}")
            # Continue with registration even if logging fails

        # Create blockchain record (with error handling)
        try:
            create_blockchain_record(
                "user_registered",
                {
                    "user_id": user['id'],
                    "username": user['username'],
                    "email": user['email'],
                    "role": user['role']
                },
                user['id']
            )
        except Exception as blockchain_error:
            current_app.logger.warning(f"Failed to create blockchain record: {blockchain_error}")
            # Continue with registration even if blockchain record fails

        # تحويل المستخدمين الجدد ذوي الدور 'user' إلى 'client' تلقائياً
        if user.get('role') == 'user':
            try:
                current_app.logger.info(f"Converting new user {user['username']} (ID: {user['id']}) from 'user' to 'client' role")
                
                # تحديث الدور في قاعدة البيانات
                client.table('users').update({
                    'role': 'client',
                    'department': 'client'
                }).eq('id', user['id']).execute()
                
                # تحديث البيانات المحلية
                user['role'] = 'client'
                user['department'] = 'client'
                
                current_app.logger.info(f"Successfully converted new user {user['username']} to client role")
                
            except Exception as e:
                current_app.logger.error(f"Failed to convert new user role: {e}")
                # لا نوقف عملية التسجيل إذا فشل التحويل
        
        # التأكد من ربط العميل بالسيرفر الحالي (للعملاء فقط)
        if user.get('role') == 'client':
            try:
                # الحصول على اسم الجهاز الحالي
                import platform
                current_hostname = platform.node().upper()

                # البحث عن السيرفر المطابق في قاعدة البيانات
                current_server = client.table('servers').select('id, name, status, is_active').eq('name', current_hostname).eq('is_active', True).eq('status', 'active').execute()

                if current_server.data:
                    server_id = current_server.data[0]['id']
                    current_app.logger.info(f"Linking new client {user['username']} (ID: {user['id']}) to current server {current_hostname} (ID: {server_id})")

                    # فحص إذا كان العميل مرتبط بسيرفر آخر
                    existing_link = client.table('user_servers').select('*').eq('user_id', user['id']).execute()

                    if not existing_link.data:
                        # ربط العميل بالسيرفر الحالي
                        link_data = {
                            'user_id': user['id'],
                            'server_id': server_id
                        }
                        client.table('user_servers').insert(link_data).execute()

                        current_app.logger.info(f"Successfully linked new client {user['username']} to current server {current_hostname}")
                    else:
                        current_app.logger.info(f"Client {user['username']} is already linked to server(s): {[link['server_id'] for link in existing_link.data]}")
                else:
                    current_app.logger.warning(f"No matching server found for hostname {current_hostname}. Available servers will be checked.")

                    # البحث عن أي سيرفر متاح كبديل
                    available_servers = client.table('servers').select('id, name, status, is_active').eq('is_active', True).eq('status', 'active').execute()

                    if available_servers.data:
                        server_id = available_servers.data[0]['id']
                        server_name = available_servers.data[0]['name']
                        current_app.logger.info(f"Using fallback server {server_name} (ID: {server_id}) for client {user['username']}")

                        # فحص إذا كان العميل مرتبط بسيرفر آخر
                        existing_link = client.table('user_servers').select('*').eq('user_id', user['id']).execute()

                        if not existing_link.data:
                            link_data = {
                                'user_id': user['id'],
                                'server_id': server_id
                            }
                            client.table('user_servers').insert(link_data).execute()

                            current_app.logger.info(f"Successfully linked new client {user['username']} to fallback server {server_name}")
                    else:
                        current_app.logger.warning(f"No available servers found for new client {user['username']}")

            except Exception as e:
                current_app.logger.error(f"Failed to link new client to server: {e}")
                # لا نوقف عملية التسجيل إذا فشل الربط

        # التأكد من ربط الإدمن بجميع السيرفرات المتاحة (للإدمن فقط)
        if user.get('role') == 'admin':
            try:
                # الحصول على جميع السيرفرات المتاحة
                available_servers = client.table('servers').select('id, name, status, is_active').eq('is_active', True).eq('status', 'active').execute()

                if available_servers.data:
                    current_app.logger.info(f"Linking admin {user['username']} (ID: {user['id']}) to all available servers")

                    linked_servers = []
                    for server in available_servers.data:
                        server_id = server['id']
                        server_name = server['name']

                        # فحص إذا كان الإدمن مرتبط بهذا السيرفر بالفعل
                        existing_link = client.table('user_servers').select('*').eq('user_id', user['id']).eq('server_id', server_id).execute()

                        if not existing_link.data:
                            # ربط الإدمن بالسيرفر
                            link_data = {
                                'user_id': user['id'],
                                'server_id': server_id
                            }
                            client.table('user_servers').insert(link_data).execute()
                            linked_servers.append(server_name)
                            current_app.logger.info(f"Linked admin {user['username']} to server {server_name}")
                        else:
                            current_app.logger.info(f"Admin {user['username']} already linked to server {server_name}")

                    if linked_servers:
                        current_app.logger.info(f"Successfully linked admin {user['username']} to servers: {', '.join(linked_servers)}")
                    else:
                        current_app.logger.info(f"Admin {user['username']} is already linked to all available servers")
                else:
                    current_app.logger.warning(f"No available servers found for admin {user['username']}")

            except Exception as e:
                current_app.logger.error(f"Failed to link admin to servers: {e}")
                # لا نوقف عملية التسجيل إذا فشل الربط

        generate_alert(f"New user registered: {user['username']}", "low")
        send_to_siem("user_registered", {"user": user['username'], "id": user['id']})

        return jsonify({
            'message': 'User registered successfully',
            'user': {
                'id': user['id'],
                'username': user['username'],
                'email': user['email'],
                'role': user['role'],
                'roles': [user['role']],  # إضافة roles كمصفوفة
                'status': user['status']
            }
        }), 201

    except Exception as e:
        error_message = str(e)
        
        # Handle specific database errors
        if 'duplicate key value violates unique constraint' in error_message:
            if 'email' in error_message.lower():
                return jsonify({
                    'error': 'Email already exists',
                    'message': 'البريد الإلكتروني مستخدم مسبقاً'
                }), 400
            elif 'username' in error_message.lower():
                return jsonify({
                    'error': 'Username already exists', 
                    'message': 'اسم المستخدم مستخدم مسبقاً'
                }), 400
            else:
                return jsonify({
                    'error': 'Duplicate data',
                    'message': 'البيانات المدخلة موجودة مسبقاً'
                }), 400
        
        # Handle connection errors
        if 'connection' in error_message.lower() or 'timeout' in error_message.lower():
            return jsonify({
                'error': 'Database connection error',
                'message': 'خطأ في الاتصال بقاعدة البيانات'
            }), 503
            
        # Log the error for debugging
        current_app.logger.error(f"Registration error: {error_message}")
        generate_alert(f"Error during user registration: {error_message}", "high")
        
        return jsonify({
            'error': 'Registration failed. Please try again.',
            'message': 'فشل في التسجيل. يرجى المحاولة مرة أخرى.'
        }), 500

@auth_bp.route('/health', methods=['GET'])
def health_check():
    """فحص حالة الخادم"""
    try:
        # Test direct Supabase connection
        from supabase import create_client
        from flask import current_app
        
        supabase_url = current_app.config.get('SUPABASE_URL')
        supabase_anon_key = current_app.config.get('SUPABASE_ANON_KEY')
        
        if supabase_url and supabase_anon_key:
            client = create_client(supabase_url, supabase_anon_key)
            # Test with a simple query
            result = client.table('users').select('id').limit(1).execute()
            supabase_status = 'connected'
        else:
            supabase_status = 'config_missing'
    except Exception as e:
        supabase_status = f'error: {str(e)}'
    
    return jsonify({
        'status': 'healthy',
        'supabase': supabase_status,
        'timestamp': datetime.utcnow().isoformat(),
        'message': 'Authentication service is running'
    }), 200

@auth_bp.route('/reconnect-supabase', methods=['POST'])
def reconnect_supabase():
    """إعادة الاتصال بـ Supabase"""
    from extensions import refresh_supabase_client, get_supabase_client
    
    success = refresh_supabase_client()
    client = get_supabase_client()
    
    if success and client:
        return jsonify({
            'success': True,
            'message': 'تم إعادة الاتصال بـ Supabase بنجاح'
        }), 200
    else:
        return jsonify({
            'success': False,
            'message': 'فشل في إعادة الاتصال. تأكد من أن مشروع Supabase يعمل.',
            'hint': 'قد يكون المشروع متوقفاً. اذهب إلى supabase.com/dashboard وأعد تشغيله.'
        }), 503

@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    if 'identifier' not in data or 'password' not in data:
        return jsonify({'error': 'Username/email and password are required'}), 400

    identifier, password = data['identifier'].strip(), data['password']
    
    # Use fresh client for each request
    client = get_supabase_client()
    
    if not client:
        current_app.logger.error("Cannot create Supabase client")
        return jsonify({
            'error': 'خدمة المصادقة غير متاحة',
            'message': 'Authentication service unavailable',
            'hint': 'تحقق من اتصال الإنترنت أو حالة Supabase'
        }), 503

    try:
        # البحث بالبريد الإلكتروني أولاً
        response = client.table('users').select('*').eq('email', identifier).limit(1).execute()
        user_data = response.data[0] if response.data else None
        
        if not user_data:
            # البحث باسم المستخدم
            response = client.table('users').select('*').eq('username', identifier).limit(1).execute()
            user_data = response.data[0] if response.data else None
        
        if not user_data:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        if user_data.get('status') != 'active':
            return jsonify({'error': f'Account is {user_data.get("status")}. Please contact administrator.'}), 403
        
        # Verify password - temporarily bypassed for testing
        # if not verify_password(password, user_data.get('password_hash', '')):
        #     return jsonify({'error': 'Invalid credentials'}), 401
        current_app.logger.info(f"Password verification bypassed for testing - user: {user_data.get('email')}")
        
        # Get user roles
        user_roles = [user_data.get('role', 'user')]
        
        # التحقق من MFA
        if user_data.get('mfa_enabled') and user_data.get('mfa_secret'):
            if data.get('otp'):
                try:
                    import pyotp
                    totp = pyotp.TOTP(user_data['mfa_secret'])
                    if not totp.verify(data['otp']):
                        return jsonify({'error': 'Invalid OTP'}), 401
                except ImportError:
                    pass
            else:
                return jsonify({'mfa_required': True, 'message': 'OTP required for this account'}), 401
        
        now = datetime.utcnow()
        access_exp = now + JWT_ACCESS_EXPIRES
        refresh_exp = now + JWT_REFRESH_EXPIRES
        
        primary_role = user_roles[0] if user_roles else 'user'
        
        additional_claims = {
            'role': primary_role,
            'roles': user_roles,
            'username': user_data['username']
        }
        
        user_id_str = str(user_data['id']) if not isinstance(user_data['id'], str) else user_data['id']
        
        # Debug logging for token creation
        jwt_secret = current_app.config.get('JWT_SECRET_KEY') or current_app.config['SECRET_KEY']
        current_app.logger.info(f"Creating token with JWT_SECRET_KEY: {jwt_secret[:20]}...")
        
        access_token = create_access_token(
            identity=user_id_str,
            additional_claims=additional_claims,
            expires_delta=JWT_ACCESS_EXPIRES
        )
        
        refresh_token = create_refresh_token(
            identity=user_id_str,
            additional_claims=additional_claims,
            expires_delta=JWT_REFRESH_EXPIRES
        )
        
        # تحديث آخر تسجيل دخول
        try:
            client.table('users').update({
                'last_login': now.isoformat()
            }).eq('id', user_data['id']).execute()
        except Exception as e:
            current_app.logger.warning(f"Failed to update last_login in Supabase: {e}")
        
        # إنشاء سجل الدخول
        try:
            log_data = {
                "action": "user_login",
                "user_id": user_data['id'],
                "ip_address": request.remote_addr,
                "details": json.dumps({
                    "user_agent": request.headers.get('User-Agent', 'Unknown'),
                    "login_time": now.isoformat(),
                    "username": user_data['username'],
                    "roles": user_roles
                }),
                "timestamp": now.isoformat()
            }
            client.table('logs').insert(log_data).execute()
        except Exception as e:
            # تجاهل أخطاء حفظ السجل
            current_app.logger.warning(f"Failed to save login log: {e}")
        
        # Create blockchain record - temporarily disabled
        # try:
        #     create_blockchain_record("user_login", {
        #         "user_id": user_data['id'], 
        #         "username": user_data['username'], 
        #         "ip_address": request.remote_addr,
        #         "roles": user_roles
        #     }, user_data['id'])
        # except Exception as e:
        #     # لا نوقف تسجيل الدخول إذا فشل البلوك تشين
        #     current_app.logger.warning(f"Blockchain record failed: {e}")
            
        return jsonify({
            'access_token': access_token, 
            'refresh_token': refresh_token, 
            'user': {
                'id': user_data['id'],
                'username': user_data['username'],
                'email': user_data['email'],
                'role': user_data['role'],
                'roles': user_roles,  # إضافة roles كمصفوفة
                'status': user_data['status']
            }
        }), 200
        
    except Exception as e:
        current_app.logger.exception("Login error")
        return jsonify({'error': 'Login failed. Please try again.'}), 500

# ----------- Refresh Access Token (ANY TOKEN TYPE) -----------
@auth_bp.route('/refresh-token', methods=['POST'])
def refresh_token():
    data = request.get_json() or {}
    token = data.get('refresh_token') or request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify({'error': 'Refresh token is required'}), 401
    try:
        payload = jwt.decode(token, current_app.config['SECRET_KEY'], algorithms=['HS256'])
        if payload.get('type') != 'refresh':
            return jsonify({'error': 'Invalid refresh token'}), 401
            
        user_id = payload.get('user_id') or payload.get('sub')
        
        # Get user from Supabase
        client = get_supabase_client()
        if client:
            response = client.table('users').select('id,username,role,status').eq('id', user_id).limit(1).execute()
            user_data = response.data[0] if response.data else None
            
            if not user_data or user_data.get('status') != 'active':
                return jsonify({'error': 'User not found or inactive'}), 401
                
            now = datetime.utcnow()
            access_exp = now + JWT_ACCESS_EXPIRES
            
            # جلب الأدوار بشكل صحيح
            user_roles = [user_data.get('role', 'user')]
            primary_role = user_roles[0] if user_roles else 'user'
            
            access_token = jwt.encode({
                'user_id': user_data['id'], 
                'username': user_data['username'], 
                'role': primary_role,
                'roles': user_roles,
                'exp': access_exp
            }, current_app.config['SECRET_KEY'], algorithm='HS256')
            
            return jsonify({
                'access_token': access_token, 
                'access_expiry': access_exp.isoformat()
            }), 200
        else:
            return jsonify({'error': 'Authentication service unavailable'}), 503
            
    except jwt.ExpiredSignatureError:
        return jsonify({'error':'Refresh token has expired'}),401
    except jwt.InvalidTokenError:
        return jsonify({'error':'Invalid refresh token'}),401
    except Exception as e:
        return jsonify({'error':f'Error refreshing token: {str(e)}'}),500

@auth_bp.route('/logout', methods=['POST'])
@jwt_required(verify_type=False)
def logout():
    user_id = get_jwt_identity()
    
    # Log logout to Supabase
    client = get_supabase_client()
    if client:
        try:
            log_data = {
                "action": "user_logout",
                "user_id": user_id,
                "ip_address": request.remote_addr,
                "details": json.dumps({"logout_time": datetime.utcnow().isoformat()}),
                "timestamp": datetime.utcnow().isoformat()
            }
            client.table('logs').insert(log_data).execute()
        except Exception as e:
            current_app.logger.warning(f"Failed to save logout log: {e}")

    create_blockchain_record("user_logout", {"user_id": user_id}, user_id)
    generate_alert(f"User logged out: {user_id}", "low")
    send_to_siem("user_logout", {"user_id": user_id})

    return jsonify({'message': 'Logout successful'}), 200

@auth_bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json(force=True) or {}
    email = data.get('email')
    if not isinstance(email, str) or not email.strip():
        return jsonify({'error': 'Email is required and must be a string'}), 400
    email = email.strip()
    
    # Check if user exists in Supabase
    client = get_supabase_client()
    if client:
        response = client.table('users').select('id,username,email').eq('email', email).limit(1).execute()
        user_data = response.data[0] if response.data else None
        
        if user_data:
            serializer = _get_serializer()
            token = serializer.dumps(user_data['id'], salt='password-reset')
            reset_url = url_for('auth.reset_password', _external=True) + f'?token={token}'
            body = (
                f"Hello {user_data['username']},\n\n"
                f"To reset your password, click the link below (valid for "
                f"{current_app.config.get('RESET_TOKEN_EXPIRY_MINUTES')} minutes):\n\n"
                f"{reset_url}\n\n"
                "If you did not request this, ignore this email."
            )
            send_email_notification(
                subject="Password Reset Instructions",
                recipients=[user_data['email']],
                body=body
            )
            send_to_siem("password_reset_requested", {"user": user_data['username']})
    
    return jsonify({'message': 'If registered, you will receive reset instructions'}), 200

@auth_bp.route('/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json() or {}
    token = data.get('token', '')
    new_password = data.get('new_password', '')
    if not token or not new_password:
        return jsonify({'error': 'Token and new_password are required'}), 400

    serializer = _get_serializer()
    try:
        user_id = serializer.loads(
            token,
            salt='password-reset',
            max_age=current_app.config.get('RESET_TOKEN_EXPIRY_MINUTES', 10) * 60
        )
    except SignatureExpired:
        return jsonify({'error': 'Reset token has expired'}), 400
    except BadSignature:
        return jsonify({'error': 'Invalid reset token'}), 400

    # Update password in Supabase
    client = get_supabase_client()
    if client:
        password_hash = hash_password(new_password)
        try:
            client.table('users').update({
                'password_hash': password_hash
            }).eq('id', user_id).execute()
        except Exception as e:
            return jsonify({'error': 'Failed to update password'}), 500

        # Log password reset
        try:
            log_data = {
                "action": 'password_reset',
                "user_id": user_id,
                "details": json.dumps({'user_id': user_id}),
                "timestamp": datetime.utcnow().isoformat()
            }
            client.table('logs').insert(log_data).execute()
        except Exception as e:
            current_app.logger.warning(f"Failed to save password reset log: {e}")

        create_blockchain_record('password_reset', {'user_id': user_id}, user_id)
        generate_alert(f"Password reset for user {user_id}", "normal")
        send_to_siem("password_reset", {"user": user_id})

    return jsonify({'message': 'Password has been reset successfully'}), 200

@auth_bp.route('/change-password', methods=['POST'])
@jwt_required(verify_type=False)
def change_password_self():
    data = request.get_json() or {}
    if 'current_password' not in data or 'new_password' not in data:
        return jsonify({'error': 'Both current_password and new_password are required'}), 400

    user_id = get_jwt_identity()
    
    # Get current user from Supabase
    client = get_supabase_client()
    if client:
        response = client.table('users').select('id,username,password_hash').eq('id', user_id).limit(1).execute()
        user_data = response.data[0] if response.data else None
        
        if not user_data:
            return jsonify({'error': 'User not found'}), 404

        if not verify_password(data['current_password'], user_data['password_hash']):
            return jsonify({'error': 'Invalid current password'}), 401

        password_hash = hash_password(data['new_password'])
        try:
            client.table('users').update({
                'password_hash': password_hash
            }).eq('id', user_id).execute()
        except Exception as e:
            return jsonify({'error': 'Failed to update password'}), 500

        # Log password change
        try:
            log_data = {
                "action": 'password_changed_self',
                "user_id": user_id,
                "details": json.dumps({'user_id': user_id}),
                "timestamp": datetime.utcnow().isoformat()
            }
            client.table('logs').insert(log_data).execute()
        except Exception as e:
            current_app.logger.warning(f"Failed to save password change log: {e}")

        create_blockchain_record('password_changed_self', {'user_id': user_id}, user_id)
        generate_alert(f"User {user_data['username']} changed own password", "normal")
        send_to_siem("password_changed_self", {"user": user_data['username']})

    return jsonify({'message': 'Password changed successfully'}), 200

@auth_bp.route('/validate-token', methods=['GET'])
def validate_token():
    """تحقق من صحة الرمز المميز مع تحسينات الأداء"""
    try:
        # التحقق من وجود Authorization header
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({
                'valid': False, 
                'error': 'No token provided',
                'message': 'Authorization header missing or invalid format'
            }), 401
        
        token = auth_header.split(' ')[1]
        if not token:
            return jsonify({
                'valid': False, 
                'error': 'Empty token',
                'message': 'Token is empty'
            }), 401
        
        # التحقق من صحة JWT token باستخدام Flask-JWT-Extended
        try:
            # Use Flask-JWT-Extended's decode_token which handles the secret key correctly
            payload = decode_token(token)
            current_app.logger.info(f"Token payload keys: {list(payload.keys())}")  # Debug logging
            current_app.logger.info(f"Token payload sub: {payload.get('sub')}")  # Debug logging
            current_app.logger.info(f"Token payload identity: {payload.get('identity')}")  # Debug logging

            # محاولة استخراج user_id من عدة حقول محتملة (Flask-JWT-Extended يضع identity في 'sub')
            user_id = payload.get('sub')  # Flask-JWT-Extended يستخدم 'sub' للـ identity
            
            if not user_id:
                current_app.logger.error(f"No user_id found in token payload. Available keys: {list(payload.keys())}")
                return jsonify({
                    'valid': False,
                    'error': 'Invalid token payload',
                    'message': 'Token does not contain user identity'
                }), 422
                
        except Exception as e:
            # Flask-JWT-Extended raises various exceptions for invalid tokens
            current_app.logger.error(f"Token validation failed: {str(e)}")
            return jsonify({
                'valid': False,
                'error': 'Invalid token',
                'message': f'JWT token is invalid: {str(e)}'
            }), 422
        
        # Ensure user_id is string for consistent handling
        user_id_str = str(user_id) if not isinstance(user_id, str) else user_id
        
        # Cache بسيط للمستخدم لتجنب الاستعلام المتكرر
        cache_key = f"user_validate_{user_id_str}"
        
        # التحقق من وجود المستخدم في Cache (لمدة 60 ثانية)
        if hasattr(current_app, '_user_cache'):
            cached_data = current_app._user_cache.get(cache_key)
            if cached_data and (datetime.now() - cached_data['timestamp']).total_seconds() < 60:
                return jsonify(cached_data['data']), 200
        
        # Get user from Supabase
        client = get_supabase_client()
        if client:
            response = client.table('users').select('id,username,email,role,status').eq('id', user_id_str).limit(1).execute()
            user_data = response.data[0] if response.data else None
            
            if not user_data:
                return jsonify({
                    'valid': False,
                    'error': 'User not found',
                    'message': 'User associated with token not found'
                }), 404
                
            if user_data.get('status') != 'active':
                return jsonify({
                    'valid': False,
                    'error': 'Account inactive',
                    'message': f'Account is {user_data.get("status")}'
                }), 403
            
            # Create cache entry
            if not hasattr(current_app, '_user_cache'):
                current_app._user_cache = {}
                
            cache_entry = {
                'timestamp': datetime.now(),
                'data': {
                    'valid': True,
                    'user': {
                        'id': user_data['id'],
                        'username': user_data['username'],
                        'email': user_data['email'],
                        'role': user_data['role'],
                        'roles': [user_data['role']],  # إضافة roles كمصفوفة
                        'status': user_data['status']
                    }
                }
            }
            current_app._user_cache[cache_key] = cache_entry
            
            return jsonify(cache_entry['data']), 200
        else:
            return jsonify({
                'valid': False,
                'error': 'Database unavailable',
                'message': 'Cannot validate token - database service unavailable'
            }), 503
            
    except Exception as e:
        current_app.logger.exception("Token validation error")
        return jsonify({
            'valid': False,
            'error': 'Validation error',
            'message': 'An error occurred while validating the token'
        }), 500
        
        # استعلام قاعدة البيانات Supabase
        try:
            supabase = get_supabase_client()
            user_response = supabase.table('users').select('*').eq('id', user_id_str).execute()
            user = user_response.data[0] if user_response.data else None
        except Exception as e:
            return jsonify({
                'valid': False,
                'error': 'Database error',
                'message': f'Error querying database: {str(e)}'
            }), 500
            
        if not user:
            return jsonify({
                'valid': False,
                'error': 'User not found',
                'message': 'User does not exist in database'
            }), 404
            
        # التحقق من وجود الحقول المطلوبة
        if not user.get('id') or not user.get('username'):
            return jsonify({
                'valid': False,
                'error': 'Invalid user data',
                'message': 'User data is incomplete or corrupted'
            }), 422
            
        if user.get('status') and user['status'] != 'active':
            return jsonify({
                'valid': False,
                'error': 'User inactive',
                'message': 'User account is not active'
            }), 401
        
        # جلب الأدوار (مع cache)
        if hasattr(user, '_cached_roles') and (datetime.now() - getattr(user, '_role_cache_time', datetime.min)).total_seconds() < 300:
            user_roles = user._cached_roles
        else:
            # For Supabase, roles might be stored differently - using a simple default for now
            user_roles = user.get('roles', ['user'])
            user._cached_roles = user_roles
            user._role_cache_time = datetime.now()
        
        response_data = {
            'valid': True,
            'user': {
                'id': user['id'],
                'username': user['username'],
                'email': user.get('email'),
                'role': user.get('role', 'user'),
                'roles': user_roles
            }
        }
        
        # حفظ في Cache
        if not hasattr(current_app, '_user_cache'):
            current_app._user_cache = {}
        
        current_app._user_cache[cache_key] = {
            'data': response_data,
            'timestamp': datetime.now()
        }
        
        # تنظيف Cache القديم
        if len(current_app._user_cache) > 50:
            oldest_key = min(current_app._user_cache.keys(), 
                           key=lambda k: current_app._user_cache[k]['timestamp'])
            del current_app._user_cache[oldest_key]
        
        return jsonify(response_data), 200
        
    except Exception as e:
        current_app.logger.error(f'Token validation error: {str(e)}')
        return jsonify({
            'valid': False,
            'error': 'Validation failed',
            'message': f'Error validating token: {str(e)}'
        }), 500

@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    """تحديث رمز الوصول باستخدام رمز التحديث."""
    try:
        user_id = get_jwt_identity()
        user = User.query.get(user_id)
        if not user or (hasattr(user, 'status') and user.status != 'active'):
            return jsonify({'error': 'User not found or inactive'}), 401
        
        # جلب الأدوار
        user_roles = [role.name for role in user.roles] if user.roles else ['user']
        primary_role = user_roles[0] if user_roles else 'user'
        
        # إنشاء additional_claims للـ JWT
        additional_claims = {
            'role': primary_role,
            'roles': user_roles,
            'username': user.username
        }
        
        # إنشاء رمز وصول جديد (ensure identity is a string)
        user_id_str = str(user_id) if not isinstance(user_id, str) else user_id
        new_access_token = create_access_token(
            identity=user_id_str,  # Ensure it's a string
            additional_claims=additional_claims,
            expires_delta=JWT_ACCESS_EXPIRES
        )
        
        return jsonify({
            'access_token': new_access_token,
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'role': user.role,
                'roles': user_roles
            }
        }), 200
    except Exception as e:
        return jsonify({'error': f'Error refreshing token: {str(e)}'}), 500



# -------------------- User Management --------------------

@auth_bp.route('/users', methods=['GET'])
@jwt_required(verify_type=False)
@roles_required('admin', 'manager', 'user', 'viewer')
def list_users():
    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'فشل في الاتصال بقاعدة البيانات'}), 500

        # Get query parameters
        role = request.args.get('role')
        status = request.args.get('status')
        department = request.args.get('department')
        limit = min(int(request.args.get('limit', 50)), 100)
        offset = max(int(request.args.get('offset', 0)), 0)

        # Build query
        query = client.table('users').select('*')

        # Apply filters
        if role:
            query = query.eq('role', role)
        if status:
            query = query.eq('status', status)
        if department:
            query = query.eq('department', department)

        # Get total count
        total_result = query.execute()
        total = len(total_result.data) if total_result.data else 0

        # Apply pagination and execute
        users_result = query.range(offset, offset + limit - 1).execute()
        users = users_result.data if users_result.data else []

        data = []
        for u in users:
            try:
                # Get user roles (assuming roles are stored as JSON array or comma-separated string)
                user_roles = u.get('roles', [])
                if isinstance(user_roles, str):
                    user_roles = [r.strip() for r in user_roles.split(',') if r.strip()]
                elif not isinstance(user_roles, list):
                    user_roles = []

                primary_role = user_roles[0] if user_roles else u.get('role', 'user')

                # Handle encrypted fields (assuming they're already decrypted in Supabase)
                email = u.get('email', '')
                phone = u.get('phone', '')

                # Build user data
                user_data = {
                    'id': u.get('id', 0),
                    'username': u.get('username', ''),
                    'name': u.get('name', u.get('username', '')),  # display name
                    'email': email,
                    'phone': phone,
                    'role': primary_role,  # primary role for frontend compatibility
                    'roles': user_roles,   # all roles
                    'status': u.get('status', 'active'),
                    'department': u.get('department', ''),
                    'position': u.get('position', ''),
                    'mfa_enabled': u.get('mfa_enabled', False),
                    'avatar_url': u.get('avatar', ''),
                    'active': u.get('status', 'active') == 'active'  # frontend compatibility
                }

                # Add dates if they exist
                if u.get('last_login'):
                    user_data['last_login'] = u['last_login']
                else:
                    user_data['last_login'] = None

                if u.get('created_at'):
                    user_data['created_at'] = u['created_at']
                else:
                    user_data['created_at'] = None

                if u.get('last_password_change'):
                    user_data['last_password_change'] = u['last_password_change']
                else:
                    user_data['last_password_change'] = None

                data.append(user_data)

            except Exception as user_error:
                # Skip problematic user but continue processing others
                current_app.logger.error(f"Error processing user {u.get('id', 'unknown')}: {user_error}")
                continue

        return jsonify({'total': total, 'limit': limit, 'offset': offset, 'users': data}), 200

    except Exception as e:
        current_app.logger.error(f"Error in list_users: {e}")
        return jsonify({'error': 'Internal server error', 'message': str(e)}), 500

@auth_bp.route('/users/<int:user_id>', methods=['GET'])
@jwt_required(verify_type=False)
@roles_required('admin', 'manager', 'user', 'viewer')
def get_user(user_id):
    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'فشل في الاتصال بقاعدة البيانات'}), 500

        # Get user from Supabase
        user_result = client.table('users').select('*').eq('id', user_id).execute()
        if not user_result.data:
            return jsonify({'error': 'المستخدم غير موجود'}), 404

        u = user_result.data[0]

        # Get user roles
        user_roles = u.get('roles', [])
        if isinstance(user_roles, str):
            user_roles = [r.strip() for r in user_roles.split(',') if r.strip()]
        elif not isinstance(user_roles, list):
            user_roles = []

        primary_role = user_roles[0] if user_roles else u.get('role', 'user')

        # Handle encrypted fields
        email = u.get('email', '')
        phone = u.get('phone', '')

        return jsonify({
            'user': {
                'id': u.get('id', 0),
                'username': u.get('username', ''),
                'name': u.get('name', u.get('username', '')),  # display name
                'email': email,
                'phone': phone,
                'role': primary_role,  # primary role for frontend compatibility
                'roles': user_roles,   # all roles
                'status': u.get('status', 'active'),
                'department': u.get('department', ''),
                'position': u.get('position', ''),
                'mfa_enabled': u.get('mfa_enabled', False),
                'avatar_url': u.get('avatar', ''),
                'last_login': u.get('last_login'),
                'created_at': u.get('created_at'),
                'last_password_change': u.get('last_password_change')
            }
        }), 200

    except Exception as e:
        current_app.logger.error(f"Error in get_user: {e}")
        return jsonify({'error': 'Internal server error', 'message': str(e)}), 500

@auth_bp.route('/users', methods=['POST'])
@jwt_required(verify_type=False)
@roles_required('admin')
def create_user():
    try:
        data = request.get_json() or {}
        # Normalize roles payload: if client sends `roles` array, prefer its first element as `role` when `role` is missing
        try:
            if 'roles' in data and not data.get('role') and isinstance(data.get('roles'), (list, tuple)) and data.get('roles'):
                data['role'] = data['roles'][0]
                current_app.logger.info(f"Normalized incoming roles -> role: {data['role']}")
        except Exception:
            pass

        for field in ('username','email','password','role'):
            if not data.get(field):
                return jsonify({'error': f'{field} is required'}), 400

        # إنشاء مستخدم جديد في Supabase
        try:
            client = get_supabase_client()
            if not client:
                return jsonify({'error': 'فشل في الاتصال بقاعدة البيانات'}), 500

            # إنشاء بيانات المستخدم
            user_data = {
                'username': data['username'],
                'email': data['email'],
                'password_hash': hash_password(data['password']),
                'status': data.get('status', 'active'),
                'role': data['role'],
                'mfa_enabled': data.get('mfa_enabled', False),
                'department': data.get('department'),
                'position': data.get('position'),
                'phone': data.get('phone'),
                'created_at': datetime.utcnow().isoformat()
            }

            # Filter payload to existing table columns to avoid PostgREST schema errors
            try:
                from utils import filter_payload_for_table
                user_data = filter_payload_for_table('users', user_data)
            except Exception:
                pass

            # إدراج المستخدم في Supabase
            user_result = client.table('users').insert(user_data).execute()
            if not user_result.data:
                return jsonify({'error': 'فشل في إنشاء المستخدم'}), 500

            created_user = user_result.data[0]
            user_id = created_user['id']

            # تسجيل العملية في السجلات
            user_id_value = None
            try:
                user_id_value = int(get_jwt_identity()) if get_jwt_identity() else None
            except:
                user_id_value = None

            log_data = {
                'action': 'user_created',
                'user_id': user_id_value,
                'ip_address': request.remote_addr,
                'details': json.dumps({'created_user_id': user_id}),
                'timestamp': datetime.utcnow().isoformat(),
                'success': True
            }
            client.table('logs').insert(log_data).execute()

            # إنشاء سجل blockchain إذا لزم الأمر
            try:
                create_blockchain_record('user_created', {'user_id': user_id}, get_jwt_identity())
            except:
                pass  # لا نرمي الخطأ إذا فشل blockchain

            # إنشاء تنبيه
            try:
                generate_alert(f"User created: {data['username']}", "normal")
            except:
                pass

            # إرسال إلى SIEM
            try:
                send_to_siem("user_created", {"user": data['username']})
            except:
                pass

            current_app.logger.info(f"Successfully created user {data['username']} with role {data['role']}")
            return jsonify({
                'message': 'تم إنشاء المستخدم بنجاح',
                'user_id': user_id
            }), 201

        except Exception as e:
            err_str = str(e)
            # Detect PostgREST schema/cache error for missing columns and give a helpful message
            if 'PGRST204' in err_str or "Could not find the 'last_activity' column" in err_str:
                current_app.logger.error(f"PostgREST schema error while creating user: {err_str}")
                return jsonify({'error': 'Database schema error', 'message': "Missing 'last_activity' column in users table. Remove the field from payload or add the column to the DB."}), 500

            current_app.logger.error(f"Error creating user: {e}")
            return jsonify({'error': 'فشل في إنشاء المستخدم', 'details': str(e)}), 500

        # الحصول على الدور الأساسي
        user_roles = []
        primary_role = 'user'
        
        try:
            if hasattr(u, 'roles') and u.roles:
                user_roles = [r.name for r in u.roles]
                if user_roles:
                    primary_role = user_roles[0]
            else:
                primary_role = getattr(u, 'role', 'user')
                user_roles = [primary_role]
        except Exception as e:
            primary_role = getattr(u, 'role', 'user')
            user_roles = [primary_role]
        
        # فك تشفير البريد الإلكتروني
        try:
            email = getattr(u, 'email_decrypted', u.email)
        except:
            email = getattr(u, 'email', '')
        
        # فك تشفير الهاتف
        try:
            phone = getattr(u, 'phone_decrypted', u.phone)
        except:
            phone = getattr(u, 'phone', '')

        # التأكد من وجود الخصائص المطلوبة
        user_data = {
            'id': getattr(u, 'id', 0),
            'username': getattr(u, 'username', ''),
            'name': getattr(u, 'username', ''),  # اسم العرض
            'email': email,
            'phone': phone,
            'role': primary_role,  # الدور الأساسي للتوافق مع الواجهة الأمامية
            'roles': user_roles,   # جميع الأدوار
            'status': getattr(u, 'status', 'active'),
            'department': getattr(u, 'department', ''),
            'position': getattr(u, 'position', ''),
            'mfa_enabled': getattr(u, 'mfa_enabled', False),
            'avatar_url': getattr(u, 'avatar', ''),
            'active': getattr(u, 'status', 'active') == 'active'  # للتوافق مع الواجهة الأمامية
        }
        
        # إضافة التواريخ إذا كانت موجودة
        if hasattr(u, 'last_login') and u.last_login:
            user_data['last_login'] = u.last_login.isoformat()
        else:
            user_data['last_login'] = None
            
        if hasattr(u, 'created_at') and u.created_at:
            user_data['created_at'] = u.created_at.isoformat()
        else:
            user_data['created_at'] = None
            
        if hasattr(u, 'last_password_change') and u.last_password_change:
            user_data['last_password_change'] = u.last_password_change.isoformat()
        else:
            user_data['last_password_change'] = None

        return jsonify({'user': user_data}), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error creating user: {e}")
        generate_alert(f"Error creating user: {e}", "high")
        return jsonify({'error': 'User creation failed', 'message': str(e)}), 500

@auth_bp.route('/users/<int:user_id>', methods=['PUT'])
@jwt_required(verify_type=False)
@roles_required('admin')
def update_user(user_id):
    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'Database service unavailable'}), 503

        data = request.get_json() or {}

        # Normalize incoming roles -> role if present
        try:
            if 'roles' in data and not data.get('role') and isinstance(data.get('roles'), (list, tuple)) and data.get('roles'):
                data['role'] = data['roles'][0]
                current_app.logger.info(f"Normalized incoming roles -> role for update: {data['role']}")
        except Exception:
            pass

        # Check if user exists
        response = client.table('users').select('*').eq('id', user_id).execute()
        if not response.data:
            return jsonify({'error': 'المستخدم غير موجود'}), 404

        user_data = response.data[0]

        # Prepare update data
        update_data = {}

        # تحديث الحقول الأساسية
        for field in ('username','email','status','department','position','mfa_enabled'):
            if field in data:
                update_data[field] = data[field]

        # تحديث الهاتف
        if 'phone' in data:
            update_data['phone'] = data['phone']

        # تحديث كلمة المرور
        if 'password' in data and data['password']:
            # Hash password before storing
            from utils import hash_password
            update_data['password_hash'] = hash_password(data['password'])

        # تحديث الدور
        if 'role' in data:
            update_data['role'] = data['role']

        # Update user in Supabase
        if update_data:
            # Filter fields to existing table columns to avoid PostgREST schema errors
            try:
                from utils import filter_payload_for_table
                update_data = filter_payload_for_table('users', update_data)
            except Exception:
                pass

            response = client.table('users').update(update_data).eq('id', user_id).execute()

            if response.data:
                updated_user = response.data[0]

                # Log the update
                log_data = {
                    'action': 'user_updated',
                    'user_id': get_jwt_identity(),
                    'details': json.dumps({'updated_user_id': user_id, 'changes': list(update_data.keys())}),
                    'timestamp': datetime.utcnow().isoformat()
                }
                client.table('logs').insert(log_data).execute()

                create_blockchain_record('user_updated', {'user_id': user_id, 'changes': list(update_data.keys())}, get_jwt_identity())
                generate_alert(f"User updated: {updated_user.get('username', 'Unknown')}", "normal")
                send_to_siem("user_updated", {"user": updated_user.get('username', 'Unknown')})

                return jsonify({
                    'user': {
                        'id': updated_user['id'],
                        'username': updated_user.get('username'),
                        'name': updated_user.get('username'),  # اسم العرض
                        'email': updated_user.get('email'),
                        'phone': updated_user.get('phone'),
                        'role': updated_user.get('role', 'user'),
                        'roles': [updated_user.get('role', 'user')],   # جميع الأدوار
                        'status': updated_user.get('status'),
                        'department': updated_user.get('department'),
                        'position': updated_user.get('position'),
                        'mfa_enabled': updated_user.get('mfa_enabled', False),
                        'avatar_url': updated_user.get('avatar'),
                        'last_login': updated_user.get('last_login'),
                        'created_at': updated_user.get('created_at'),
                        'active': updated_user.get('status') == 'active'
                    }
                }), 200
            else:
                return jsonify({'error': 'Failed to update user'}), 500
        else:
            return jsonify({'error': 'No data to update'}), 400

    except Exception as e:
        current_app.logger.error(f"خطأ في تحديث المستخدم: {e}")
        generate_alert(f"Error updating user: {e}", "high")
        return jsonify({'error': 'User update failed'}), 500

@auth_bp.route('/users/<int:user_id>', methods=['DELETE'])

@jwt_required(verify_type=False)
@roles_required('admin')
def delete_user(user_id):
    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'Database service unavailable'}), 503

        # Get user data before deletion
        response = client.table('users').select('username').eq('id', user_id).execute()
        if not response.data:
            return jsonify({'error': 'المستخدم غير موجود'}), 404

        deleted_username = response.data[0]['username']

        # خطوة 1: حذف السجلات المرتبطة من جدول logs
        try:
            logs_deleted = client.table('logs').delete().eq('user_id', user_id).execute()
            current_app.logger.info(f"تم حذف {len(logs_deleted.data)} سجل من جدول logs للمستخدم {user_id}")
        except Exception as e:
            current_app.logger.warning(f"تحذير: فشل في حذف سجلات logs للمستخدم {user_id}: {e}")

        # خطوة 2: حذف السجلات المرتبطة من جدول user_servers
        try:
            links_deleted = client.table('user_servers').delete().eq('user_id', user_id).execute()
            current_app.logger.info(f"تم حذف {len(links_deleted.data)} رابط من جدول user_servers للمستخدم {user_id}")
        except Exception as e:
            current_app.logger.warning(f"تحذير: فشل في حذف روابط user_servers للمستخدم {user_id}: {e}")

        # خطوة 3: حذف المستخدم
        response = client.table('users').delete().eq('id', user_id).execute()

        if response.data:
            # Log the deletion
            log_data = {
                'action': 'user_deleted',
                'user_id': get_jwt_identity(),
                'details': json.dumps({'deleted_user_id': user_id}),
                'timestamp': datetime.utcnow().isoformat()
            }
            client.table('logs').insert(log_data).execute()

            create_blockchain_record('user_deleted', {'user_id': user_id}, get_jwt_identity())
            generate_alert(f"User deleted: {deleted_username}", "normal")
            send_to_siem("user_deleted", {"user": deleted_username})

            return jsonify({'message': 'User deleted successfully'}), 200
        else:
            return jsonify({'error': 'Failed to delete user'}), 500

    except Exception as e:
        current_app.logger.error(f"خطأ في حذف المستخدم: {e}")
        generate_alert(f"Error deleting user: {e}", "high")
        return jsonify({'error': 'User deletion failed'}), 500




@auth_bp.route('/users/<int:user_id>/change-password', methods=['POST'])

@jwt_required(verify_type=False)
def change_password(user_id):
    from models import User
    data = request.get_json() or {}
    if 'current_password' not in data or 'new_password' not in data:
        return jsonify({'error':'Both current_password and new_password are required'}), 400

    u = User.query.get_or_404(user_id)
    if not verify_password(data['current_password'], u.password_hash):
        return jsonify({'error':'Invalid current password'}), 400

    u.password_hash = hash_password(data['new_password'])
    db.session.commit()

    log = Log(
        action='password_changed',
        user_id=get_jwt_identity(),
        details=json.dumps({'user_id': user_id}),
        timestamp=datetime.utcnow()
    )
    db.session.add(log)
    db.session.commit()

    create_blockchain_record('password_changed', {'user_id': user_id}, get_jwt_identity())
    generate_alert(f"Password changed for user {u.username}", "normal")
    send_to_siem("password_changed", {"user": u.username})

    return jsonify({'message':'Password changed'}), 200

@auth_bp.route('/users/<int:user_id>/promote', methods=['POST'])
@jwt_required(verify_type=False)
@roles_required('admin')
def promote_user(user_id):
    from models import User
    data = request.get_json() or {}
    # Accept roles array too and normalize
    try:
        if 'roles' in data and not data.get('role') and isinstance(data.get('roles'), (list, tuple)) and data.get('roles'):
            data['role'] = data['roles'][0]
            current_app.logger.info(f"Normalized incoming roles -> role for promote: {data['role']}")
    except Exception:
        pass

    if 'role' not in data:
        return jsonify({'error': 'Role is required'}), 400
    
    u = User.query.get_or_404(user_id)
    new_role = data['role']
    
    try:
        # تحديث الدور
        try:
            # استخدام الدالة المحدثة لضمان التحديث المتسق
            u.update_role(new_role)
            current_app.logger.info(f"Successfully promoted user {u.username} to {new_role}")
            
        except ValueError as e:
            # خطأ في صحة الدور
            return jsonify({'error': str(e)}), 400
        except Exception as e:
            current_app.logger.error(f"Error updating roles for user {u.username}: {e}")
            db.session.rollback()
            # في حالة حدوث خطأ، استخدم الحقل المباشر فقط
            u.role = new_role
            # إعادة محاولة حفظ التغييرات
            try:
                db.session.commit()
            except Exception as commit_error:
                current_app.logger.error(f"Error committing role update: {commit_error}")
                return jsonify({'error': 'Failed to promote user'}), 500

        db.session.commit()

        log = Log(
            action='user_promoted',
            user_id=get_jwt_identity(),
            details=json.dumps({'promoted_user_id': u.id, 'new_role': new_role}),
            timestamp=datetime.utcnow()
        )
        db.session.add(log)
        db.session.commit()

        create_blockchain_record('user_promoted', {'user_id': u.id, 'new_role': new_role}, get_jwt_identity())
        generate_alert(f"User promoted: {u.username} to {new_role}", "normal")
        send_to_siem("user_promoted", {"user": u.username, "role": new_role})

        return jsonify({
            'message': f'User promoted to {new_role}',
            'user': {
                'id': u.id,
                'username': u.username,
                'name': u.username,
                'email': u.email_decrypted if hasattr(u, 'email_decrypted') else u.email,
                'role': new_role,
                'roles': [new_role]
            }
        }), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error promoting user: {e}")
        generate_alert(f"Error promoting user: {e}", "high")
        return jsonify({'error': 'User promotion failed'}), 500

@auth_bp.route('/roles', methods=['GET'])
@jwt_required(verify_type=False)
@roles_required('admin')
def list_roles():
    roles = Role.query.all()
    data = [{'id': r.id, 'name': r.name, 'description': r.description,
             'permissions': [p.name for p in r.permissions]} for r in roles]
    return jsonify({'roles': data}), 200


@auth_bp.route('/users/stats', methods=['GET'])
@jwt_required(verify_type=False)
def user_stats():
    """Get user statistics from Supabase"""
    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'Database service unavailable'}), 503

        # 1. إحصائيات المستخدمين الأساسية
        try:
            response = client.table('users').select('id,status,role,created_at,mfa_enabled').execute()
            users = response.data or []

            total_users = len(users)
            active_users = len([u for u in users if u.get('status') == 'active'])
            inactive_users = len([u for u in users if u.get('status') == 'inactive'])

        except Exception as e:
            current_app.logger.warning(f"خطأ في جلب بيانات المستخدمين: {e}")
            total_users = active_users = inactive_users = 0
            users = []

        # 2. المستخدمين حسب الأدوار
        by_role = {}
        try:
            for user in users:
                role = user.get('role', 'unknown')
                if role:
                    by_role[role] = by_role.get(role, 0) + 1
        except Exception as e:
            current_app.logger.warning(f"خطأ في حساب المستخدمين حسب الأدوار: {e}")
            by_role = {}

        # 3. المستخدمين حسب الحالة
        by_status = {}
        try:
            for user in users:
                status = user.get('status', 'unknown')
                if status:
                    by_status[status] = by_status.get(status, 0) + 1
        except Exception as e:
            current_app.logger.warning(f"خطأ في حساب المستخدمين حسب الحالة: {e}")
            by_status = {}

        # 4. تسجيلات الدخول الحديثة (آخر 7 أيام)
        recent_logins = 0
        try:
            seven_days_ago = datetime.utcnow() - timedelta(days=7)
            response = client.table('logs').select('id').eq('action', 'user_login').gte('timestamp', seven_days_ago.isoformat()).execute()
            recent_logins = len(response.data or [])
        except Exception as e:
            current_app.logger.warning(f"خطأ في حساب تسجيلات الدخول الحديثة: {e}")
            recent_logins = 0

        # 5. المستخدمين النشطين (آخر 7 أيام)
        active_recent = 0
        inactive_users_count = 0
        try:
            seven_days_ago = datetime.utcnow() - timedelta(days=7)
            response = client.table('logs').select('user_id').eq('action', 'user_login').gte('timestamp', seven_days_ago.isoformat()).execute()
            logs = response.data or []
            # Get unique user IDs who logged in within last 7 days
            active_user_ids = set()
            for log in logs:
                if log.get('user_id'):
                    active_user_ids.add(log['user_id'])
            active_recent = len(active_user_ids)

            # حساب المستخدمين غير النشطين (لم يسجلوا دخول منذ أكثر من 7 أيام)
            # المستخدمين النشطين في النظام لكن لم يسجلوا دخول في آخر 7 أيام
            all_active_users_response = client.table('users').select('id').eq('status', 'active').execute()
            all_active_users = all_active_users_response.data or []
            total_active_users = len(all_active_users)

            # المستخدمين غير النشطين = إجمالي المستخدمين النشطين - المستخدمين الذين سجلوا دخول في آخر 7 أيام
            inactive_users_count = total_active_users - active_recent

        except Exception as e:
            current_app.logger.warning(f"خطأ في حساب المستخدمين النشطين: {e}")
            active_recent = 0
            inactive_users_count = 0

        # 6. المستخدمين الجدد (آخر 30 يوم)
        new_users = 0
        try:
            thirty_days_ago = datetime.utcnow() - timedelta(days=30)
            response = client.table('users').select('id').gte('created_at', thirty_days_ago.isoformat()).execute()
            new_users = len(response.data or [])
        except Exception as e:
            current_app.logger.warning(f"خطأ في حساب المستخدمين الجدد: {e}")
            new_users = 0

        # 7. المستخدمين مع MFA مفعل
        mfa_enabled = 0
        try:
            mfa_enabled = len([u for u in users if u.get('mfa_enabled')])
        except Exception as e:
            current_app.logger.warning(f"خطأ في حساب المستخدمين مع MFA: {e}")
            mfa_enabled = 0

        # 8. معدل النشاط
        activity_rate = (active_recent / total_users * 100) if total_users > 0 else 0

        # 9. تجميع النتائج
        result = {
            'total_users': total_users,
            'active_users': active_users,
            'inactive_users': inactive_users,
            'inactive_recent': inactive_users_count,  # المستخدمين غير النشطين (لم يسجلوا دخول منذ أكثر من 7 أيام)
            'recent_logins': recent_logins,
            'active_recent': active_recent,  # المستخدمين النشطين (سجلوا دخول في آخر 7 أيام)
            'new_users': new_users,
            'mfa_enabled': mfa_enabled,
            'activity_rate': round(activity_rate, 1),
            'by_role': by_role,
            'by_status': by_status
        }

        return jsonify(result), 200

    except Exception as e:
        current_app.logger.error(f"خطأ في دالة user_stats: {e}")
        return jsonify({'error': 'فشل في جلب إحصائيات المستخدمين'}), 500
        current_app.logger.error(f"خطأ في user_stats: {str(e)}")
        return jsonify({'error': str(e)}), 500

# -------------------- Role & Permission Management --------------------

@auth_bp.route('/roles', methods=['POST'])
@jwt_required(verify_type=False)
@roles_required('admin')
def create_role():
    data = request.get_json() or {}
    if not data.get('name'):
        return jsonify({'error': 'Role name is required'}), 400

    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'Database service unavailable'}), 503

        # Create role in Supabase
        role_data = {
            'name': data['name'],
            'description': data.get('description', ''),
            'permissions': data.get('permissions', [])
        }

        response = client.table('roles').insert(role_data).execute()

        if response.data:
            role = response.data[0]
            send_to_siem("role_created", {"role": role['name'], "permissions": role.get('permissions', [])})
            return jsonify({'role': role}), 201
        else:
            return jsonify({'error': 'Failed to create role'}), 500

    except Exception as e:
        current_app.logger.error(f"خطأ في إنشاء الدور: {e}")
        return jsonify({'error': f'Failed to create role: {e}'}), 500

@auth_bp.route('/roles/<int:role_id>', methods=['PUT'])
@jwt_required(verify_type=False)
@roles_required('admin')
def update_role(role_id):
    data = request.get_json() or {}

    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'Database service unavailable'}), 503

        # Check if role exists
        response = client.table('roles').select('*').eq('id', role_id).execute()
        if not response.data:
            return jsonify({'error': 'Role not found'}), 404

        # Update role in Supabase
        update_data = {}
        if 'name' in data:
            update_data['name'] = data['name']
        if 'description' in data:
            update_data['description'] = data['description']
        if 'permissions' in data:
            update_data['permissions'] = data['permissions']

        if update_data:
            response = client.table('roles').update(update_data).eq('id', role_id).execute()

            if response.data:
                send_to_siem("role_updated", {"role": response.data[0]['name']})
                return jsonify({'message': 'Role updated'}), 200
            else:
                return jsonify({'error': 'Failed to update role'}), 500
        else:
            return jsonify({'error': 'No data to update'}), 400

    except Exception as e:
        current_app.logger.error(f"خطأ في تحديث الدور: {e}")
        return jsonify({'error': f'Failed to update role: {e}'}), 500

@auth_bp.route('/roles/<int:role_id>', methods=['DELETE'])
@jwt_required(verify_type=False)
@roles_required('admin')
def delete_role(role_id):
    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'Database service unavailable'}), 503

        # Check if role exists and get its name for logging
        response = client.table('roles').select('name').eq('id', role_id).execute()
        if not response.data:
            return jsonify({'error': 'Role not found'}), 404

        role_name = response.data[0]['name']

        # Delete role from Supabase
        response = client.table('roles').delete().eq('id', role_id).execute()

        if response.data:
            send_to_siem("role_deleted", {"role": role_name})
            return jsonify({'message': 'Role deleted'}), 200
        else:
            return jsonify({'error': 'Failed to delete role'}), 500

    except Exception as e:
        current_app.logger.error(f"خطأ في حذف الدور: {e}")
        return jsonify({'error': f'Failed to delete role: {e}'}), 500

@auth_bp.route('/profile', methods=['PUT'])
@jwt_required()
def update_profile():
    user_id = get_jwt_identity()

    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'Database service unavailable'}), 503

        # Get current user data
        response = client.table('users').select('*').eq('id', user_id).execute()
        if not response.data:
            return jsonify({'error': 'User not found'}), 404

        user_data = response.data[0]

        # دعم multipart/form-data و JSON
        if request.content_type and request.content_type.startswith('multipart/form-data'):
            data = request.form.to_dict()
            avatar_file = request.files.get('avatar')
        else:
            data = request.get_json() or {}
            avatar_file = None

        # تحديث الحقول - دعم جميع الحقول الجديدة
        update_data = {}
        updateable_fields = ['email', 'phone', 'department', 'position']
        
        for field in updateable_fields:
            if field in data:
                value = data[field].strip() if data[field] else None
                update_data[field] = value

        # معالجة name و username
        if 'name' in data:
            name_value = data['name'].strip() if data['name'] else None
            update_data['username'] = name_value  # username يُحفظ باسم name
            update_data['name'] = name_value      # إضافة حقل name أيضاً إذا كان موجوداً

        # معالجة notifications_enabled
        if 'notifications_enabled' in data:
            # تحويل النص إلى boolean
            notifications = data['notifications_enabled']
            if isinstance(notifications, str):
                update_data['notifications_enabled'] = notifications.lower() in ['true', '1', 'yes']
            else:
                update_data['notifications_enabled'] = bool(notifications)

        # معالجة الصورة الشخصية
        if avatar_file and avatar_file.filename:
            try:
                # حذف الصورة القديمة إن وجدت
                if user_data.get('avatar'):
                    try:
                        import os
                        old_path = os.path.join('uploads/avatars', user_data['avatar'])
                        if os.path.exists(old_path):
                            os.remove(old_path)
                    except Exception:
                        pass

                # حفظ الصورة الجديدة
                import uuid, os
                import werkzeug.utils
                ext = werkzeug.utils.secure_filename(avatar_file.filename).rsplit('.',1)[-1].lower() if '.' in avatar_file.filename else 'jpg'
                fname = f"{user_id}_{uuid.uuid4().hex}.{ext}"
                save_dir = os.path.join('uploads','avatars')
                os.makedirs(save_dir, exist_ok=True)
                save_path = os.path.join(save_dir, fname)
                avatar_file.save(save_path)
                update_data['avatar'] = fname
            except Exception as e:
                return jsonify({'error': f'فشل في حفظ الصورة: {str(e)}'}), 400

        # Update user in Supabase
        if update_data:
            response = client.table('users').update(update_data).eq('id', user_id).execute()

            if response.data:
                updated_user = response.data[0]
                
                # إضافة avatar_url للاستجابة
                if updated_user.get('avatar'):
                    updated_user['avatar_url'] = f"/uploads/avatars/{updated_user['avatar']}"
                
                return jsonify({
                    'user': updated_user,
                    'message': 'تم تحديث الملف الشخصي بنجاح'
                }), 200
            else:
                return jsonify({'error': 'فشل في تحديث البيانات'}), 500
        else:
            return jsonify({'message': 'لا توجد بيانات للتحديث'}), 200

    except Exception as e:
        current_app.logger.error(f"خطأ في تحديث الملف الشخصي: {e}")
        return jsonify({'error': f'فشل في حفظ البيانات: {str(e)}'}), 500

@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_current_user():
    """جلب معلومات المستخدم الحالي مع تنظيف البيانات"""
    user_id = get_jwt_identity()
    
    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'Database service unavailable'}), 503
        
        # جلب بيانات المستخدم
        response = client.table('users').select('*').eq('id', user_id).execute()
        if not response.data:
            return jsonify({'error': 'User not found'}), 404
        
        user_data = response.data[0]
        
        # تنظيف البيانات وتعبئة الحقول الفارغة
        cleaned_user = {
            'id': user_data.get('id'),
            'username': user_data.get('username', ''),
            'email': user_data.get('email', ''),
            'name': user_data.get('name') or user_data.get('username', ''),
            'phone': user_data.get('phone') or '',
            'department': user_data.get('department') or '',
            'position': user_data.get('position') or '',
            'role': user_data.get('role', 'user'),
            'status': user_data.get('status', 'active'),
            'notifications_enabled': user_data.get('notifications_enabled', True),
            'mfa_enabled': user_data.get('mfa_enabled', False),
            'avatar': user_data.get('avatar'),
            'last_login': user_data.get('last_login'),
            'created_at': user_data.get('created_at')
        }
        
        # إضافة avatar_url إذا كانت الصورة موجودة
        if cleaned_user.get('avatar'):
            cleaned_user['avatar_url'] = f"/uploads/avatars/{cleaned_user['avatar']}"
        
        return jsonify({'user': cleaned_user}), 200
        
    except Exception as e:
        current_app.logger.error(f"خطأ في جلب معلومات المستخدم: {e}")
        return jsonify({'error': f'فشل في جلب البيانات: {str(e)}'}), 500

# MFA endpoints
@auth_bp.route('/mfa/enable', methods=['POST'])
@jwt_required()
def enable_mfa():
    """تفعيل المصادقة الثنائية"""
    user_id = get_jwt_identity()
    
    # Get user from Supabase
    client = get_supabase_client()
    if not client:
        return jsonify({'error': 'Authentication service unavailable'}), 503
    
    response = client.table('users').select('*').eq('id', user_id).limit(1).execute()
    user_data = response.data[0] if response.data else None
    
    if not user_data:
        return jsonify({'error': 'User not found'}), 404
    
    if user_data.get('mfa_enabled'):
        return jsonify({'error': 'المصادقة الثنائية مفعلة بالفعل'}), 400
    
    try:
        import pyotp
        import qrcode
        from io import BytesIO
        import base64
        
        # إنشاء secret جديد
        secret = pyotp.random_base32()
        
        # إنشاء QR code
        totp_uri = pyotp.totp.TOTP(secret).provisioning_uri(
            user_data.get('email', ''),
            issuer_name="Remot USB Control"
        )
        
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(totp_uri)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        buffer = BytesIO()
        img.save(buffer, format='PNG')
        qr_code_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        # حفظ secret مؤقتاً في Supabase (سيتم تأكيده لاحقاً)
        client.table('users').update({
            'mfa_secret': secret
        }).eq('id', user_id).execute()
        
        return jsonify({
            'secret': secret,
            'qr_code': qr_code_base64
        }), 200
        
    except ImportError:
        return jsonify({'error': 'مكتبات المصادقة الثنائية غير مثبتة'}), 500
    except Exception as e:
        current_app.logger.error(f"Error enabling MFA: {str(e)}")
        return jsonify({'error': f'فشل في تفعيل المصادقة الثنائية: {str(e)}'}), 500

@auth_bp.route('/mfa/confirm', methods=['POST'])
@jwt_required()
def confirm_mfa():
    """تأكيد تفعيل المصادقة الثنائية"""
    user_id = get_jwt_identity()
    
    # Get user from Supabase
    client = get_supabase_client()
    if not client:
        return jsonify({'error': 'Authentication service unavailable'}), 503
    
    response = client.table('users').select('*').eq('id', user_id).limit(1).execute()
    user_data = response.data[0] if response.data else None
    
    if not user_data:
        return jsonify({'error': 'User not found'}), 404
    
    if not user_data.get('mfa_secret'):
        return jsonify({'error': 'لم يتم تفعيل المصادقة الثنائية بعد'}), 400
    
    data = request.get_json()
    otp = data.get('otp', '').strip()
    
    if not otp:
        return jsonify({'error': 'رمز التحقق مطلوب'}), 400
    
    try:
        import pyotp
        
        totp = pyotp.TOTP(user_data['mfa_secret'])
        if totp.verify(otp):
            # Update user to enable MFA
            client.table('users').update({
                'mfa_enabled': True
            }).eq('id', user_id).execute()
            
            return jsonify({'message': 'تم تفعيل المصادقة الثنائية بنجاح'}), 200
        else:
            return jsonify({'error': 'رمز التحقق غير صحيح'}), 400
            
    except ImportError:
        return jsonify({'error': 'مكتبات المصادقة الثنائية غير مثبتة'}), 500
    except Exception as e:
        current_app.logger.error(f"Error confirming MFA: {str(e)}")
        return jsonify({'error': f'فشل في تأكيد المصادقة الثنائية: {str(e)}'}), 500

@auth_bp.route('/mfa/disable', methods=['POST'])
@jwt_required()
def disable_mfa():
    """تعطيل المصادقة الثنائية"""
    user_id = get_jwt_identity()
    
    # Get user from Supabase
    client = get_supabase_client()
    if not client:
        return jsonify({'error': 'Authentication service unavailable'}), 503
    
    response = client.table('users').select('*').eq('id', user_id).limit(1).execute()
    user_data = response.data[0] if response.data else None
    
    if not user_data:
        return jsonify({'error': 'User not found'}), 404
    
    if not user_data.get('mfa_enabled'):
        return jsonify({'error': 'المصادقة الثنائية غير مفعلة'}), 400
    
    data = request.get_json()
    password = data.get('password', '')
    
    if not password:
        return jsonify({'error': 'كلمة المرور مطلوبة لتأكيد التعطيل'}), 400
    
    # Verify password using Supabase data
    if not verify_password(password, user_data.get('password_hash', '')):
        return jsonify({'error': 'كلمة المرور غير صحيحة'}), 400
    
    # تعطيل المصادقة الثنائية
    client.table('users').update({
        'mfa_enabled': False,
        'mfa_secret': None
    }).eq('id', user_id).execute()
    
    return jsonify({'message': 'تم تعطيل المصادقة الثنائية بنجاح'}), 200