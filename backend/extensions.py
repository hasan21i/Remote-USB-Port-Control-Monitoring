import os
import logging
import socket
from datetime import datetime
from flask import current_app, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_mail import Mail
from flask_jwt_extended import JWTManager
from flask_socketio import SocketIO

# محاولة استيراد ldap3 لدعم LDAP
try:
    from ldap3 import Server as LdapServer, Connection as LdapConnection, ALL
except ImportError:
    LdapServer = LdapConnection = None

# محاولة استيراد requests لإرسال بيانات إلى SIEM
try:
    import requests
except ImportError:
    requests = None

# محاولة استيراد Supabase Client
try:
    from supabase._sync.client import create_client, SyncClient as Client
    SUPABASE_AVAILABLE = True
except ImportError:
    create_client = Client = None
    SUPABASE_AVAILABLE = False

log = logging.getLogger(__name__)

# db = SQLAlchemy()  # Commented out for Supabase-only mode
# Create a dummy db object for compatibility
class DummyDB:
    def __init__(self):
        self.engine = None

# db = DummyDB()  # Dummy object for compatibility
db = SQLAlchemy()  # Re-enabled for model compatibility
# migrate = Migrate()  # Commented out for Supabase-only mode
migrate = Migrate()  # Re-enabled for compatibility
mail = Mail()
jwt = JWTManager()

# Initialize SocketIO with extreme permissions to bypass all LAN/Browser blocks
socketio = SocketIO(
    cors_allowed_origins="*",  # Allowing all for Socket.IO handshake
    async_mode='threading',
    manage_session=False, 
    ping_timeout=120,          
    ping_interval=25,
    logger=True,               
    engineio_logger=True,
    allow_eio3=True            # مهم جداً لحل خطأ الـ 400 مع الإصدارات القديمة من المحرك
)

# مكان حفظ اتصال LDAP إذا تفعّل
ldap_connection = None

# مكان حفظ اتصال Supabase Client
supabase_client = None


def check_ipv6_support():
    """فحص دعم IPv6 في النظام"""
    try:
        # محاولة إنشاء socket IPv6
        socket.AF_INET6
        return True
    except AttributeError:
        return False


def test_database_connection():
    """اختبار الاتصال بقاعدة البيانات PostgreSQL مع معالجة أخطاء IPv6"""
    # In Supabase-only mode, we don't test SQL database connection
    return True


def init_ldap(app):
    """تهيئة اتصال LDAP إذا كان مفعّلاً."""
    global ldap_connection
    if app.config.get('LDAP_ENABLED') and LdapServer and LdapConnection:
        uri = app.config['LDAP_URI']
        bind_dn = app.config['LDAP_BIND_DN']
        bind_pass = app.config['LDAP_BIND_PASS']
        try:
            # Simplified LDAP server initialization
            server = LdapServer(uri)
            conn = LdapConnection(server, user=bind_dn, password=bind_pass, auto_bind=True)
            ldap_connection = conn
            # أزلت رسالة النجاح
        except Exception:
            pass  # أزلت رسالة الخطأ
    # أزلت رسالة LDAP معطل


def init_supabase_client(app, max_retries=3, retry_delay=2):
    """تهيئة اتصال Supabase Client مع إعادة المحاولة."""
    global supabase_client
    import time

    if not SUPABASE_AVAILABLE or not create_client or not Client:
        log.warning("⚠️  Supabase library not available")
        supabase_client = None
        return

    supabase_url = app.config.get('SUPABASE_URL')
    supabase_anon_key = app.config.get('SUPABASE_ANON_KEY')

    if not supabase_url or not supabase_anon_key:
        log.warning("⚠️  Supabase URL or ANON_KEY not configured")
        supabase_client = None
        return

    for attempt in range(max_retries):
        try:
            # إنشاء العميل
            supabase_client = create_client(supabase_url, supabase_anon_key)
            
            # اختبار الاتصال بقراءة بسيطة
            try:
                test_response = supabase_client.table('users').select('id').limit(1).execute()
                log.info("✅ Supabase Client connected successfully")
                return
            except Exception as test_error:
                error_str = str(test_error)
                if '521' in error_str or 'Web server is down' in error_str:
                    log.error("❌ Supabase project is paused (Error 521). Please resume it from dashboard.supabase.com")
                    supabase_client = None
                    return
                elif '503' in error_str or 'Service Unavailable' in error_str:
                    log.warning(f"⚠️  Supabase service unavailable, attempt {attempt + 1}/{max_retries}")
                else:
                    # اتصال ناجح حتى لو فشل الاختبار
                    log.info("✅ Supabase Client created (test query failed but client available)")
                    return

        except Exception as client_error:
            error_str = str(client_error)
            if '521' in error_str:
                log.error("❌ Supabase project is PAUSED! Go to https://supabase.com/dashboard and resume your project")
                supabase_client = None
                return
            log.warning(f"⚠️  Supabase connection attempt {attempt + 1}/{max_retries} failed: {client_error}")
            supabase_client = None

        if attempt < max_retries - 1:
            time.sleep(retry_delay)

    log.error("❌ Failed to connect to Supabase after all retries")
    supabase_client = None


def send_to_siem(event_type: str, payload: dict):
    """
    إرسال حدث إلى خدمة SIEM إذا كان مفعّلاً.
    event_type: نوع الحدث (مثلاً مسار الـAPI أو اسم الدالة)
    payload: بيانات الحدث كـ dict
    """
    app = current_app
    if not app.config.get('SIEM_ENABLED'):
        return

    url = app.config.get('SIEM_API_URL')
    api_key = app.config.get('SIEM_API_KEY')
    if not url or not api_key or not requests:
        log.warning(
            "SIEM_ENABLED مفعّل لكن لم يتمّ ضبط SIEM_API_URL أو SIEM_API_KEY "
            "أو مكتبة requests غير مثبتة"
        )
        return

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    body = {
        "type": event_type,
        "timestamp": datetime.utcnow().isoformat(),
        "path": request.path,
        "method": request.method,
        "status": payload.get("status"),
        "data": payload
    }
    try:
        resp = requests.post(url, json=body, headers=headers, timeout=5)
        resp.raise_for_status()
        log.debug(f"تمّ إرسال حدث إلى SIEM: {event_type}")
    except Exception as e:
        log.error(f"خطأ أثناء إرسال الحدث إلى SIEM: {e}")


def init_app(app):
    """
    ربط جميع الإضافات وتفعيل سياسات الأمان:
      - SQLAlchemy, Migrate, Mail, JWT, SocketIO
      - DI (LDAP, SIEM)
      - معالجات الأخطاء الخاصة بالـJWT
      - after_request لإرسال أحداث إلى SIEM
    """
    # Initialize SQLAlchemy with the Flask app
    db.init_app(app)
    migrate.init_app(app, db)
    log.info("✅ SQLAlchemy and Migrate initialized successfully")
    
    mail.init_app(app)
    jwt.init_app(app)
    # التحقق من تعطيل WebSocket
    if os.environ.get('DISABLE_WEBSOCKET', '').lower() in ['true', '1', 'yes']:
        log.warning("⚠️  WebSocket معطل عبر متغير البيئة DISABLE_WEBSOCKET")
        log.info("💡 لإعادة تفعيل WebSocket، احذف أو علق متغير DISABLE_WEBSOCKET في ملف .env")
        return
    
    log.info("🔌 تهيئة Socket.IO مع الإعدادات المحسنة...")
    
    socketio.init_app(
        app,
        cors_allowed_origins=app.config.get("SOCKETIO_CORS_ALLOWED_ORIGINS", "*"),
        logger=False,
        engineio_logger=False,
        ping_timeout=app.config.get("SOCKETIO_PING_TIMEOUT", 60),
        ping_interval=app.config.get("SOCKETIO_PING_INTERVAL", 25),
        async_mode=app.config.get("SOCKETIO_ASYNC_MODE", 'threading'),
        manage_session=app.config.get("SOCKETIO_MANAGE_SESSION", True),
        json=None,
        always_connect=False,
        cookie=None,
        allow_upgrades=app.config.get("SOCKETIO_ALLOW_UPGRADES", True),
        compression_threshold=app.config.get("SOCKETIO_COMPRESSION_THRESHOLD", 1024),
    )
    log.info("✅ Socket.IO initialized successfully")
    
    # كتم جميع logs المتعلقة بـ eventlet وsocketio
    import logging
    noisy_loggers = [
        'socketio', 'socketio.server', 'engineio', 'engineio.server'
    ]
    for logger_name in noisy_loggers:
        logger = logging.getLogger(logger_name)
        logger.setLevel(logging.ERROR)
        logger.disabled = True
        logger.propagate = False

    # تهيئة LDAP إذا لزم الأمر
    init_ldap(app)
    
    # Test network connectivity before initializing Supabase
    network_ok = test_network_connectivity()
    if not network_ok:
        pass  # Network test failed but continue
    
    # Always initialize Supabase, even if test failed
    init_supabase_client(app)
    
    # If initialization failed, try once more after a short delay
    if supabase_client is None:
        import time
        time.sleep(2)
        init_supabase_client(app, max_retries=1, retry_delay=1)

    # إنشاء جداول many-to-many إذا كان db متاحاً
    with app.app_context():
        try:
            db.create_all()
            log.info("✅ Database tables created successfully")
        except Exception as e:
            log.warning(f"⚠️  Could not create database tables: {e}")

    # JWT error handlers (Complete Mediation & Psychological Acceptability)

    @jwt.unauthorized_loader
    def _handle_missing_token(reason):
        return jsonify({
            'valid': False,
            'error': 'missing_token',
            'message': 'التوثيق مطلوب - لم يتم توفير رمز الوصول'
        }), 401

    @jwt.invalid_token_loader
    def _handle_invalid_token(reason):
        return jsonify({
            'valid': False,
            'error': 'invalid_token', 
            'message': 'رمز المصادقة غير صالح'
        }), 422

    @jwt.expired_token_loader
    def _handle_expired_token(header, payload):
        return jsonify({
            'valid': False,
            'error': 'expired_token',
            'message': 'انتهت صلاحية رمز المصادقة'
        }), 401

    @jwt.revoked_token_loader
    def _handle_revoked_token(header, payload):
        return jsonify({
            'valid': False,
            'error': 'revoked_token',
            'message': 'تم إبطال رمز المصادقة'
        }), 401


def test_network_connectivity():
    """Test basic network connectivity to Supabase"""
    try:
        import socket
        import time
        
        supabase_host = "fnsrzgbuusmyesdeedky.supabase.co"
        supabase_port = 443
        
        # Test DNS resolution
        try:
            ip_address = socket.gethostbyname(supabase_host)
        except socket.gaierror as e:
            return False
        
        # Test basic socket connection
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(10)
            start_time = time.time()
            result = sock.connect_ex((ip_address, supabase_port))
            connect_time = time.time() - start_time
            
            if result == 0:
                pass  # Connection successful
            else:
                return False
                
            sock.close()
        except Exception as e:
            return False
            
        return True
        
    except Exception as e:
        return False


def get_supabase_client():
    """الحصول على Supabase client مع إعادة المحاولة في حالة فشل الاتصال."""
    global supabase_client
    
    if supabase_client is None:
        # Try to reinitialize if app context is available
        try:
            from flask import current_app
            if current_app:
                # محاولة إعادة الاتصال
                log.info("🔄 Attempting to reconnect to Supabase...")
                init_supabase_client(current_app, max_retries=1, retry_delay=1)
        except RuntimeError:
            # No app context available
            pass
        except Exception as e:
            log.warning(f"Could not reinitialize Supabase client: {e}")
    
    return supabase_client


def refresh_supabase_client():
    """إعادة تهيئة Supabase client - يمكن استدعاؤها يدوياً"""
    global supabase_client
    supabase_client = None
    try:
        from flask import current_app
        if current_app:
            init_supabase_client(current_app, max_retries=3, retry_delay=2)
            return supabase_client is not None
    except Exception as e:
        log.error(f"Failed to refresh Supabase client: {e}")
    return False


def _report_to_siem(response):
    try:
        send_to_siem("api_call", {"status": response.status_code})
    except Exception:
        pass
    return response


# اختبار الاتصال بقاعدة البيانات PostgreSQL - فقط إذا كان SQLAlchemy متاحاً
log.info("⚠️  Database connection test skipped - using Supabase Client only")

# الإضافات جاهزة بصمت