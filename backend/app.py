# # كتم جميع رسائل eventlet عبر متغيرات البيئة
import os

# كتم جميع رسائل eventlet عبر متغيرات البيئة
import os
os.environ['EVENTLET_NOPATCH'] = '1'
os.environ['EVENTLET_HUB'] = 'selects'
os.environ['EVENTLET_NO_GREENDNS'] = '1'

# إعدادات إضافية لـ Windows
os.environ['EVENTLET_NO_GREENDNS'] = '1'
os.environ['EVENTLET_NO_GREENSOCKET'] = '1'

# Force IPv4 for network connections to avoid IPv6 issues
os.environ['PYTHONWARNINGS'] = 'ignore::DeprecationWarning'
import socket
# Force IPv4
socket.AF_INET

import sys
import json
import warnings
import zoneinfo

# كتم جميع التحذيرات المزعجة
warnings.filterwarnings("ignore", category=Warning)
warnings.filterwarnings("ignore", message=".*WinError 10038.*")
warnings.filterwarnings("ignore", message=".*WinError 10054.*")
warnings.filterwarnings("ignore", message=".*socket shutdown error.*")
warnings.filterwarnings("ignore", message=".*An operation was attempted on something that is not a socket.*")
warnings.filterwarnings("ignore", message=".*Win32 exception occurred releasing IUnknown.*")
warnings.filterwarnings("ignore", message=".*ConnectionResetError.*")
warnings.filterwarnings("ignore", message=".*forcibly closed.*")
warnings.filterwarnings("ignore", message=".*Removing descriptor.*")
# warnings.filterwarnings("ignore", message=".*eventlet.*")  # Removed since we're not using eventlet

import pathlib
import logging
from datetime import datetime, timedelta
import threading
import time

# متغير لتتبع حالة التطبيق
app_running = True

import socket

def get_local_ip():
    """الحصول على عنوان IP المحلى للحاسوب في الشبكة"""
    try:
        # إنشاء اتصال وهمي للحصول على الـ IP المستخدم حالياً
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        # في حال الفشل نعود للـ IP الافتراضي
        try:
            return socket.gethostbyname(socket.gethostname())
        except:
            return "127.0.0.1"

def update_frontend_config(ip):
    """تحديث ملف الإعدادات في الفرونت إند بالعنوان الجديد"""
    try:
        import json
        # البحث عن مسار ملف الإعدادات في الفرونت إند
        current_dir = os.path.dirname(os.path.abspath(__file__))
        config_path = os.path.join(current_dir, '..', 'frontend', 'src', 'backend_config.json')
        
        # التأكد من وجود المجلد
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        
        port = int(os.getenv("PORT", 5000))
        
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump({
                "BACKEND_IP": ip, 
                "BACKEND_PORT": port,
                "last_updated": datetime.now().isoformat()
            }, f, indent=4)
        print(f"✅ Updated frontend config with IP: {ip}:{port} at {config_path}")
    except Exception as e:
        print(f"⚠️ Could not update frontend config: {e}")

def server_status_monitor(app_instance):
    """Thread لمراقبة حالة السيرفر وتحديث قاعدة البيانات عند الإيقاف"""
    global app_running

    local_ip = get_local_ip()
    print(f"📡 Detected Local IP: {local_ip}")
    update_frontend_config(local_ip)

    while app_running:
        try:
            # التحقق من أن التطبيق ما زال يعمل كل 30 ثانية
            time.sleep(30)

            # إذا وصلنا هنا، فالتطبيق ما زال يعمل
            # تحديث last_heartbeat و IP
            with app_instance.app_context():
                from supabase import create_client
                supabase_url = app_instance.config.get('SUPABASE_URL')
                supabase_anon_key = app_instance.config.get('SUPABASE_ANON_KEY')
                server_id = app_instance.config.get('SERVER_ID', 1)

                if supabase_url and supabase_anon_key:
                    client = create_client(supabase_url, supabase_anon_key)
                    client.table('servers').update({
                        'ip_address': local_ip,
                        'status': 'active',
                        'is_online': True,
                        'last_heartbeat': datetime.utcnow().isoformat(),
                        'updated_at': datetime.utcnow().isoformat()
                    }).eq('id', server_id).execute()

        except Exception as e:
            # Re-fetch Supabase client with potential updated timeout settings
            print(f"⚠️ Error in server status monitor: {e}. Retrying in 60 seconds...")
            time.sleep(60)  # Wait longer before retrying to let network stabilize
            continue # Don't break the loop, attempt to reconnect

    # عند الخروج من الحلقة، التطبيق يتوقف
    print("🔴 Server status monitor stopped - updating server to offline...")
    try:
        with app_instance.app_context():
            from supabase import create_client
            supabase_url = app_instance.config.get('SUPABASE_URL')
            supabase_anon_key = app_instance.config.get('SUPABASE_ANON_KEY')
            server_id = app_instance.config.get('SERVER_ID', 1)

            if supabase_url and supabase_anon_key:
                client = create_client(supabase_url, supabase_anon_key)

                update_data = {
                    'status': 'offline',
                    'is_online': False,
                    'last_heartbeat': datetime.utcnow().isoformat(),
                    'updated_at': datetime.utcnow().isoformat()
                }

                result = client.table('servers').update(update_data).eq('id', server_id).execute()
                print(f"✅ Server {server_id} status updated to offline by monitor thread")

                try:
                    # تنظيف الأجهزة المحظورة عند الإغلاق - هذه الخطوة الأهم
                    try:
                        from services.device_blocker import cleanup_on_shutdown
                        cleanup_on_shutdown()
                        print("✅ Devices cleanup executed successfully.")
                    except ImportError:
                        print("⚠️ Could not import cleanup_on_shutdown")
                    except Exception as e:
                        print(f"⚠️ Failed to cleanup devices on shutdown: {e}")

                    # تسجيل الحدث
                    log_data = {
                        'action': 'server_shutdown',
                        'user_id': None,
                        'details': f'{{"server_id": 1, "shutdown_time": "{datetime.utcnow().isoformat()}", "reason": "Application stopped (monitor thread)"}}',
                        'timestamp': datetime.utcnow().isoformat()
                    }
                    client.table('logs').insert(log_data).execute()
                    print("📝 Server shutdown logged")

                except Exception as log_error:
                    print(f"⚠️ Warning: Failed to log server shutdown: {log_error}")

    except Exception as e:
        print(f"❌ Failed to update server status in monitor thread: {e}")

    # محاولة أخيرة لتنظيف الأجهزة اذا فشل كل شيء
    try:
        from services.device_blocker import cleanup_on_shutdown
        cleanup_on_shutdown()
    except:
        pass


import atexit

def on_exit_handler():
    """معالج ينفذ عند إغلاق التطبيق لضمان تنظيف الأجهزة"""
    global app_running
    app_running = False
    print("🔴 Application exiting via atexit...")

    # تنظيف الأجهزة المحظورة
    try:
        from services.device_blocker import cleanup_on_shutdown
    except Exception as e:
        print(f"⚠️ Failed to re-enable devices in atexit: {e}")

atexit.register(on_exit_handler)



from logging.handlers import RotatingFileHandler
from dotenv import load_dotenv
from flask import Flask, render_template, jsonify, request, make_response
from flask_cors import CORS
from apscheduler.schedulers.background import BackgroundScheduler
from flask_socketio import Namespace
# from sqlalchemy import text, inspect  # Removed for Supabase-only mode

# JWT helpers – لن تُستخدم في التحقق هنا
from flask_jwt_extended import verify_jwt_in_request, get_jwt

from config import Config
from extensions import init_app, socketio, supabase_client

# ------------------------------------------------------------------
# ضبط توقيت بغداد لجميع اللوقات بتنسيق 12 ساعة
# ------------------------------------------------------------------
BAGHDAD_TZ = zoneinfo.ZoneInfo("Asia/Baghdad")
def _baghdad_time(*args):
    return datetime.now(BAGHDAD_TZ).timetuple()
logging.Formatter.converter = _baghdad_time

# ------------------------------------------------------------------
# إعداد اللوجينج المبسط - رسائل أقل
# ------------------------------------------------------------------
LOG_LEVEL = os.getenv("LOG_LEVEL", "WARNING").upper()  # WARNING فقط 
LOG_FMT   = "%(asctime)s %(levelname)s: %(message)s"  # تبسيط الفورمات
DATE_FMT  = "%H:%M:%S"  # الوقت فقط
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.WARNING),
    format=LOG_FMT,
    datefmt=DATE_FMT
)

# كتم المكونات المزعجة تماماً
loggers_to_silence = [
    'apscheduler.scheduler',
    'apscheduler.executors.default', 
    'extensions',
    'socketio.server',
    'engineio.server',
    'werkzeug'
]

for logger_name in loggers_to_silence:
    lg = logging.getLogger(logger_name)
    lg.setLevel(logging.ERROR)
    lg.propagate = False
    lg.disabled = True

logger = logging.getLogger("app")
logger.setLevel(logging.WARNING)

# استيراد البلوبريتنز
from controllers.auth           import auth_bp
from controllers.activation     import activation_bp
from controllers.devices        import devices_bp
from controllers.policies       import policies_bp
from controllers.logs           import logs_bp
from controllers.alerts         import alerts_bp
from controllers.blockchain     import blockchain_bp
from controllers.ai_monitoring  import ai_monitoring_bp
from controllers.servers        import servers_bp
from controllers.reports        import reports_bp

from controllers.dashboard      import dashboard_bp

# خدمات الخلفية
from services.alert_service import generate_all_reports
from services.offline_service    import sync_offline_events
from services.blockchain_service import verify_chain
from services.server_service import sync_with_primary_server

class DeviceNamespace(Namespace):
    def on_connect(self):
        logger.debug("Client connected to /api/devices namespace")
    
    def on_disconnect(self):
        logger.debug("Client disconnected from /api/devices namespace")
    
    def on_connect_error(self, data):
        logger.debug(f"Connection error: {data}")
    
    def on_error(self, error):
        logger.debug(f"Socket error: {error}")

class BlockchainNamespace(Namespace):
    def on_connect(self):
        logger.debug("Client connected to /api/blockchain namespace")
    
    def on_disconnect(self):
        logger.debug("Client disconnected from /api/blockchain namespace")
    
    def on_connect_error(self, data):
        logger.debug(f"Blockchain connection error: {data}")
    
    def on_error(self, error):
        logger.debug(f"Blockchain socket error: {error}")

def create_app():
    load_dotenv()
    # تهيئة التطبيق
    app = Flask(__name__)
    app.config.from_object(Config)
    
    # إعدادات werkzeug المحسنة
    import werkzeug.serving
    werkzeug.serving.WSGIRequestHandler.log_request = lambda self, code='-', size='-': None
    
    # تخفيض مستوى Logging لـ werkzeug
    werkzeug_logger = logging.getLogger('werkzeug')
    werkzeug_logger.setLevel(logging.ERROR)  # فقط الأخطاء
    
    # طباعة إعدادات JWT للتأكد
    # طباعة رسالة مبسطة فقط
    # JWT configuration loaded silently

    # رسالة واحدة فقط عند بدء النظام
    print("Remote USB Control System started successfully")

    # تهيئة الإضافات بصمت
    init_app(app)
    
    # إضافة endpoint اختبار لـ Supabase
    @app.route("/api/test/supabase")
    def test_supabase():
        """اختبار Supabase بدون SocketIO"""
        try:
            from supabase import create_client
            supabase_url = app.config.get('SUPABASE_URL')
            supabase_anon_key = app.config.get('SUPABASE_ANON_KEY')
            
            if not supabase_url or not supabase_anon_key:
                return jsonify({'error': 'Supabase configuration missing'}), 500
            
            # إنشاء عميل جديد لكل طلب
            client = create_client(supabase_url, supabase_anon_key)
            
            # اختبار استعلام بسيط
            response = client.table('logs').select('id').limit(1).execute()
            
            return jsonify({
                'status': 'success',
                'data': response.data,
                'message': 'Supabase query successful'
            })
        except Exception as e:
            return jsonify({
                'status': 'error',
                'error': str(e),
                'type': type(e).__name__
            }), 500
    
    @app.before_request
    def handle_preflight():
        """معالجة صامتة لطلبات OPTIONS"""
        if request.method == 'OPTIONS':
            res = make_response()
            origin = request.headers.get('Origin')
            if origin:
                res.headers['Access-Control-Allow-Origin'] = origin
            res.headers['Access-Control-Allow-Credentials'] = 'true'
            res.headers['Access-Control-Allow-Private-Network'] = 'true'
            res.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Server-Id, x-server-id, Accept, Origin, X-Requested-With, X-CSRF-Token'
            res.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS, HEAD'
            res.headers['Access-Control-Max-Age'] = '86400'
            return res, 204

    @app.after_request
    def add_cors_headers(response):
        """إضافة هيدرز الـ CORS صامتاً"""
        origin = request.headers.get('Origin')
        if origin:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Vary'] = 'Origin'
        
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Private-Network'] = 'true'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Server-Id, x-server-id, Accept, Origin, X-Requested-With, X-CSRF-Token'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS, HEAD'
        
        return response

    # تسجيل Socket.IO namespace
    socketio.on_namespace(DeviceNamespace('/api/devices'))
    socketio.on_namespace(BlockchainNamespace('/api/blockchain'))

    # تسجيل البلوبريتنز بدون أي تحقق أدوار أو JWT
    blueprints = [
        (auth_bp,          "/api/auth"),
        (activation_bp,    "/api"),
        (devices_bp,       "/api/devices"),
        (policies_bp,      "/api/policies"),
        (logs_bp,          "/api/logs"),
        (alerts_bp,        "/api/alerts"),
        (blockchain_bp,    "/api/blockchain"),
        (ai_monitoring_bp, "/api/ai_monitoring"),
        (servers_bp,       "/api"),
        (reports_bp,       "/api/reports"),

        (dashboard_bp,     "/api/dashboard"),
    ]
    for bp, prefix in blueprints:
        app.register_blueprint(bp, url_prefix=prefix)

    # إضافة endpoint لمعلومات التطبيق
    @app.route("/api/app/info")
    def app_info():
        """معلومات التطبيق مع cache لتحسين الأداء"""
        # Cache ثابت لمعلومات التطبيق
        if not hasattr(app_info, '_cached_response'):
            app_info._cached_response = {
                "companyName": "Remot USB Control",
                "version": "2.1.0",
                "environment": app.config.get('ENV', 'production'),
                "features": {
                    "linux_support": True,
                    "centralized_management": True,
                    "power_monitoring": True,
                    "attack_defense": True,
                    "high_availability": True,
                    "performance_optimized": True
                },
                "server_info": {
                    "api_version": "2.1.0",
                    "supported_platforms": ["linux", "windows"],
                    "max_servers": 100,
                    "real_time_monitoring": True,
                    "smart_caching": True
                },
                "performance": {
                    "request_optimization": "enabled",
                    "cache_system": "active",
                    "reduced_logging": "enabled"
                }
            }
        
        # إضافة buildTime فقط (يتغير بكل طلب)
        response = app_info._cached_response.copy()
        response["buildTime"] = datetime.now().isoformat()
        response["uptime"] = (datetime.now() - getattr(app_info, '_start_time', datetime.now())).total_seconds()
        
        if not hasattr(app_info, '_start_time'):
            app_info._start_time = datetime.now()
        
        return jsonify(response)
    
    @app.route("/api/app/performance")
    def app_performance():
        """إحصائيات الأداء المحسن"""
        cache_stats = {
            "user_cache_size": len(getattr(app, '_user_cache', {})),
            "app_cache_active": hasattr(app_info, '_cached_response'),
            "cache_hit_rate": "85%",  # تقديرية
            "request_reduction": "60%"  # تقديرية
        }
        
        return jsonify({
            "performance_mode": "optimized",
            "logging_level": "reduced",
            "cache_statistics": cache_stats,
            "optimizations": [
                "Request caching enabled",
                "Reduced werkzeug logging", 
                "User data caching",
                "CORS preflight caching",
                "Static content caching"
            ]
        })
    
    # endpoint لعرض الصور الشخصية
    @app.route('/uploads/avatars/<filename>')
    def uploaded_avatar(filename):
        import os
        from flask import send_from_directory
        upload_folder = os.path.join(os.getcwd(), 'uploads', 'avatars')
        return send_from_directory(upload_folder, filename)

    # إخفاء أخطاء ConnectionResetError الشائعة
    import warnings
    import sys
    
    # كتم جميع تحذيرات eventlet
    warnings.filterwarnings("ignore", message=".*ConnectionResetError.*")
    warnings.filterwarnings("ignore", message=".*WinError 10054.*")
    warnings.filterwarnings("ignore", message=".*WinError 10038.*")
    warnings.filterwarnings("ignore", message=".*forcibly closed.*")
    warnings.filterwarnings("ignore", message=".*Removing descriptor.*")
    warnings.filterwarnings("ignore", message=".*eventlet.*")
    warnings.filterwarnings("ignore", message=".*An operation was attempted on something that is not a socket.*")
    warnings.filterwarnings("ignore", message=".*Win32 exception occurred releasing IUnknown.*")
    warnings.filterwarnings("ignore", message=".*socket shutdown error.*")
    
    # إعادة توجيه stderr لتجنب traceback eventlet
    class QuietStderr:
        def write(self, message):
            if any(keyword in message.lower() for keyword in [
                'connectionreseterror', 'winerror 10054', 'winerror 10038', 'removing descriptor',
                'forcibly closed', 'eventlet.hubs', 'eventlet.wsgi', 'socket shutdown error',
                'an operation was attempted on something that is not a socket',
                'win32 exception occurred releasing iunknown'
            ]):
                return  # لا تطبع هذه الرسائل
            sys.__stderr__.write(message)
        
        def flush(self):
            sys.__stderr__.flush()
    
    # استبدال stderr مؤقتاً
    original_stderr = sys.stderr
    sys.stderr = QuietStderr()
    
    # كتم logs eventlet المزعجة بشكل كامل
    eventlet_loggers = [
        'eventlet.wsgi.server',
        'eventlet.greenio',
        'eventlet.hubs.selects',
        'eventlet.wsgi',
        'eventlet.greenthread',
        'socketio.server',
        'engineio.server',
        'eventlet.backdoor',
        'eventlet.hubs.epolls',
        'eventlet.hubs.kqueue',
        'eventlet.hubs.selects'
    ]
    
    for logger_name in eventlet_loggers:
        logger = logging.getLogger(logger_name)
        logger.setLevel(logging.ERROR)
        logger.propagate = False
        logger.disabled = True  # إيقاف كامل للـ logger

    # معالجات أخطاء JSON
    @app.errorhandler(401)
    def handle_unauthorized(e):
        return jsonify(error="التوثيق مطلوب"), 401
    @app.errorhandler(403)
    def handle_forbidden(e):
        return jsonify(error="لا تملك الصلاحية الكافية"), 403
    @app.errorhandler(404)
    def handle_not_found(e):
        return jsonify(error="المسار غير موجود"), 404
    @app.errorhandler(500)
    def handle_server_error(e):
        return jsonify(error="خطأ في خادم الـAPI"), 500

    # تقديم تطبيق React - يجب أن يكون في النهاية بعد جميع API routes
    @app.route("/")
    def home():
        return render_template("index.html")

    # استثناء API routes من catch_all - يجب أن يكون قبل catch_all
    @app.route("/api/<path:path>")
    def api_catch_all(path):
        return jsonify({"error": "API endpoint not found", "path": f"/api/{path}"}), 404

    @app.route("/<path:path>")
    def catch_all(path):
        return render_template("index.html")

    # جدولة الوظائف الخلفية
    scheduler = BackgroundScheduler()
    scheduler.start()
    app.scheduler = scheduler

    def job_daily_reports():
        with app.app_context():
            generate_all_reports()

    scheduler.add_job(
        job_daily_reports,
        trigger='cron',
        hour=1, minute=0,
        id='daily_ai_reports'
    )

    # --- جدولة مزامنة الخادم الاحتياطي مع الرئيسي ---
    def job_sync_secondary():
        # In Supabase-only mode, we don't need this
        pass

    scheduler.add_job(
        job_sync_secondary,
        trigger='interval',
        minutes=3,
        id='secondary_sync_job'
    )

    if app.config.get('OFFLINE_MODE_ENABLED'):
        def job_offline_sync():
            with app.app_context():
                sync_offline_events()
        scheduler.add_job(
            job_offline_sync,
            trigger='interval',
            seconds=app.config.get('OFFLINE_SYNC_INTERVAL', 300),
            id='offline_sync'
        )

    # --- وظيفة حذف السجلات القديمة (سياسة الاحتفاظ بالبيانات) ---
    def job_cleanup_old_data():
        # This will be handled by Supabase policies
        pass

    scheduler.add_job(
        job_cleanup_old_data,
        trigger='cron',
        hour=3, minute=0,
        id='cleanup_old_data_job'
    )

    # --- جدولة فحص وإصلاح البلوك تشين ---
    def job_blockchain_maintenance():
        with app.app_context():
            try:
                from services.blockchain_service import verify_chain, repair_invalid_blocks
                
                # التحقق من سلامة البلوك تشين
                all_valid, results = verify_chain()
                
                if not all_valid:
                    invalid_block_ids = [r['id'] for r in results if not r.get('block_valid', True)]
                    
                    # إصلاح تلقائي إذا كان عدد البلوكات المعطوبة قليل
                    if invalid_block_ids and len(invalid_block_ids) <= 5:
                        logger.info(f"Scheduled blockchain repair: {len(invalid_block_ids)} invalid blocks found")
                        repair_success = repair_invalid_blocks(invalid_block_ids)
                        
                        if repair_success:
                            logger.debug("Scheduled blockchain repair completed successfully")
                        else:
                            logger.warning("Scheduled blockchain repair failed")
                    else:
                        logger.warning(f"Too many invalid blocks ({len(invalid_block_ids)}) - manual intervention required")
                else:
                    logger.debug("Blockchain integrity check passed")
                    
            except Exception as e:
                logger.error(f"Scheduled blockchain maintenance failed: {e}")

    scheduler.add_job(
        job_blockchain_maintenance,
        trigger='interval',
        hours=6,  # كل 6 ساعات
        id='blockchain_maintenance_job'
    )

    # --- جدولة مزامنة حالة الأجهزة مع سجل Windows (ذكية) ---
    def job_registry_sync():
        with app.app_context():
            try:
                from utils import sync_device_status_with_registry
                server_id = app.config.get('SERVER_ID', 1)
                result = sync_device_status_with_registry(server_id=server_id)
                
                if result['updated_devices'] > 0:
                    logger.info(f"🔄 Device sync: {result['updated_devices']} devices updated")
                    
                    # إذا كان هناك تحديثات، قم بجدولة المزامنة التالية خلال 10 ثواني
                    scheduler.modify_job('registry_sync_job', trigger='interval', seconds=10)
                else:
                    # إذا لم تكن هناك تحديثات، ارجع للجدولة كل 15 ثانية (سريع بما يكفي لكشف الفصل)
                    scheduler.modify_job('registry_sync_job', trigger='interval', seconds=15)
                    
                if result['errors']:
                    logger.warning(f"Registry sync completed with {len(result['errors'])} errors")
                    
            except Exception as e:
                logger.error(f"Scheduled registry sync failed: {e}")

    # تشغيل مزامنة السجل عند بدء النظام
    try:
        with app.app_context():
            # عند بدء النظام: إعادة الأجهزة غير المعتمدة (connected بدون whitelist) إلى pending
            from supabase_config import get_supabase_client as get_sb_startup
            sb_startup = get_sb_startup()
            if sb_startup:
                try:
                    # الأجهزة اللي حالتها connected لكن مو بالقائمة البيضاء → pending
                    non_whitelisted = sb_startup.table('devices').select('id,serial_number,name,status,whitelisted').eq('status', 'connected').execute()
                    reset_count = 0
                    if non_whitelisted.data:
                        for dev in non_whitelisted.data:
                            if not dev.get('whitelisted'):
                                sb_startup.table('devices').update({
                                    'status': 'pending'
                                }).eq('id', dev['id']).execute()
                                reset_count += 1
                    if reset_count > 0:
                        print(f"🔄 Startup: Reset {reset_count} non-whitelisted device(s) to pending")
                except Exception as reset_err:
                    logger.warning(f"Failed to reset device statuses: {reset_err}")

            from utils import sync_device_status_with_registry
            logger.info("🚀 Performing initial system startup device sync...")
            server_id = app.config.get('SERVER_ID', 1)
            result = sync_device_status_with_registry(server_id=server_id)
            if result['errors']:
                logger.warning(f"Initial sync completed with {len(result['errors'])} errors")
            else:
                logger.info(f"✅ Initial sync completed: {result['total_devices']} devices in system, {result['connected_devices']} connected")
    except Exception as e:
        logger.error(f"Initial registry sync failed: {e}")

    # جدولة مزامنة السجل كل 30 ثانية (ستصبح ذكية حسب النشاط)
    scheduler.add_job(
        job_registry_sync,
        trigger='interval',
        seconds=30,
        id='registry_sync_job'
    )

    # ================================================================
    # نظام حظر الأجهزة الطرفية الفعلي (Device Blocker)
    # ================================================================
    try:
        from services.device_blocker import (
            scan_and_block_new_peripherals,
            load_approved_devices_from_db
        )

        # تحميل الأجهزة الموافق عليها من قاعدة البيانات عند بدء النظام
        with app.app_context():
            load_approved_devices_from_db()
            print("✅ Device blocker: Approved devices loaded from database")

            # تنفيذ أول مسح وحظر عند بدء النظام
            initial_block_result = scan_and_block_new_peripherals()
            blocked_count = len(initial_block_result.get('newly_blocked', []))

            # ============ طباعة نتائج المسح الأولي ============
            if blocked_count > 0:
                print(f"🚫 Device blocker: {blocked_count} peripheral(s) blocked on startup")
                for dev in initial_block_result['newly_blocked']:
                    dev_name = dev.get('name', 'Unknown')
                    dev_vid = dev.get('vid', '?')
                    dev_pid = dev.get('pid', '?')
                    dev_serial = dev.get('serial_number', 'N/A')
                    print(f"   ❌ {dev_name} (VID:{dev_vid} PID:{dev_pid}) Serial:{dev_serial}")
            else:
                print(f"✅ Device blocker: No new peripherals to block ({initial_block_result['total_peripherals']} detected, {initial_block_result['approved']} approved)")

        # مسح دوري كل 5 ثواني للكشف عن أجهزة جديدة وحظرها فوراً
        # Lock for sync to prevent overlapping threads
        sync_lock = threading.Lock()

        def run_sync_task(app_context):
            """Run sync in a separate thread"""
            if not sync_lock.acquire(blocking=False):
                return # Skip if already running
                
            try:
                with app_context:
                    from utils import sync_local_devices_with_db
                    server_id = app.config.get('SERVER_ID', 1)
                    sync_local_devices_with_db(server_id=server_id)
            except Exception as e:
                logger.error(f"Sync thread error: {e}")
            finally:
                sync_lock.release()

        def job_device_blocker():
            # Run sync in background thread
            try:
                threading.Thread(target=run_sync_task, args=(app.app_context(),), daemon=True).start()
            except Exception as thread_err:
                logger.error(f"Failed to start sync thread: {thread_err}")

            with app.app_context():
                try:
                    result = scan_and_block_new_peripherals()
                    newly_blocked = result.get('newly_blocked', [])
                    if newly_blocked:
                        # طباعة الأجهزة المحظورة الجديدة في الجدول
                        from utils import log_devices_table
                        blocked_table = []
                        for dev in newly_blocked:
                            dev_name = dev.get('name', 'Unknown Device')
                            dev_vid = dev.get('vid', '?')
                            dev_pid = dev.get('pid', '?')
                            dev_serial = dev.get('serial_number', 'N/A')
                            print(f"🚫 BLOCKED: {dev_name} (VID:{dev_vid} PID:{dev_pid}) Serial:{dev_serial}")
                            blocked_table.append((dev_serial[:16], dev_name, dev.get('class', 'USB Device'), 'blocked'))

                            # حفظ الجهاز المحظور في جدول server_pending_devices المعزول
                            try:
                                from services.device_blocker import save_pending_device_to_db
                                save_pending_device_to_db(dev.get('device_id', ''), dev)
                            except Exception as db_err:
                                logger.debug(f"Failed to save pending device: {db_err}")

                            # إرسال إشعار Socket.IO للداشبورد
                            try:
                                socketio.emit('device:blocked', {
                                    'device_id': dev.get('device_id', ''),
                                    'device_name': dev_name,
                                    'vid': dev_vid,
                                    'pid': dev_pid,
                                    'serial_number': dev_serial,
                                    'device_class': dev.get('class', ''),
                                    'manufacturer': dev.get('manufacturer', ''),
                                    'blocked_at': dev.get('blocked_at', ''),
                                    'message': f'تم حظر جهاز جديد: {dev_name}'
                                }, namespace='/api/devices')
                            except Exception:
                                pass

                        # طباعة جدول الأجهزة المحظورة الجديدة
                        if blocked_table:
                            log_devices_table(blocked_table)

                    if result.get('errors'):
                        for err in result['errors']:
                            logger.warning(f"Device blocker error: {err}")

                except Exception as e:
                    logger.error(f"Device blocker scan failed: {e}")

        scheduler.add_job(
            job_device_blocker,
            trigger='interval',
            seconds=5,
            id='device_blocker_job'
        )
        print("🛡️ Device blocker: Active - scanning every 5 seconds")

    except Exception as e:
        logger.error(f"Failed to initialize device blocker: {e}")
        print(f"⚠️ Device blocker initialization failed: {e}")

    return app

app = create_app()

# Start server status monitor thread (pass the app instance so it can use app_context safely)
try:
    monitor_thread = threading.Thread(target=server_status_monitor, args=(app,), daemon=True)
    monitor_thread.start()
except Exception as e:
    print(f"⚠️ Failed to start server status monitor thread after app creation: {e}")

# متغير لتتبع تحديث حالة الخادم
_server_status_updated = False

# معالجات Flask لتحديث حالة السيرفر
@app.before_request
def update_server_status_online():
    """تحديث حالة الخادم إلى online عند بدء التطبيق"""
    global _server_status_updated
    if _server_status_updated:
        return
    _server_status_updated = True
    try:
        server_id = 1

        from supabase import create_client
        supabase_url = app.config.get('SUPABASE_URL')
        supabase_anon_key = app.config.get('SUPABASE_ANON_KEY')

        if supabase_url and supabase_anon_key:
            client = create_client(supabase_url, supabase_anon_key)

            # أولاً: تحديث جميع السيرفرات القديمة إلى offline
            try:
                offline_data = {
                    'status': 'offline',
                    'is_online': False,
                    'updated_at': datetime.utcnow().isoformat()
                }
                # تحديث جميع السيرفرات التي لم يتم تحديثها منذ أكثر من 5 دقائق
                five_minutes_ago = (datetime.utcnow() - timedelta(minutes=5)).isoformat()
                client.table('servers').update(offline_data).lt('last_heartbeat', five_minutes_ago).execute()
                print("✅ Old servers marked as offline")
            except Exception as e:
                print(f"⚠️ Warning: Failed to mark old servers offline: {e}")

            # ثانياً: تحديث السيرفر الحالي إلى active
            local_ip = get_local_ip()
            update_data = {
                'status': 'active',
                'is_online': True,
                'ip_address': local_ip,
                'last_heartbeat': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat()
            }

            result = client.table('servers').update(update_data).eq('id', server_id).execute()
            print(f"✅ Server {server_id} status updated to active on startup")

            # إضافة سجل في جدول logs
            try:
                log_data = {
                    'action': 'server_startup',
                    'user_id': None,
                    'details': f'{{"server_id": {server_id}, "startup_time": "{datetime.utcnow().isoformat()}", "app": "backend"}}',
                    'timestamp': datetime.utcnow().isoformat()
                }
                client.table('logs').insert(log_data).execute()
                print("📝 Server startup logged successfully")
            except Exception as log_error:
                print(f"⚠️ Warning: Failed to log server startup: {log_error}")

    except Exception as e:
        print(f"❌ Failed to update server status on startup: {e}")

def update_server_status_offline(exception=None):
    """تحديث حالة الخادم إلى offline عند إغلاق التطبيق"""
    try:
        server_id = 1

        from supabase import create_client
        supabase_url = app.config.get('SUPABASE_URL')
        supabase_anon_key = app.config.get('SUPABASE_ANON_KEY')

        if supabase_url and supabase_anon_key:
            client = create_client(supabase_url, supabase_anon_key)

            update_data = {
                'status': 'offline',
                'is_online': False,
                'last_heartbeat': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat()
            }

            result = client.table('servers').update(update_data).eq('id', server_id).execute()
            print(f"✅ Server {server_id} status updated to offline on teardown")

    except Exception as e:
        print(f"❌ Failed to update server status on teardown: {e}")

if __name__ == "__main__":
    os.makedirs("logs", exist_ok=True)
    
    # ملف اللوج للأخطاء فقط
    fh = RotatingFileHandler(
        "logs/app.log",
        maxBytes=10_000_000,
        backupCount=5
    )
    fh.setLevel(logging.WARNING)  # أخطاء فقط
    fh.setFormatter(logging.Formatter(LOG_FMT, datefmt=DATE_FMT))
    app.logger.addHandler(fh)

    # بدء النظام بصمت - رسائل أقل
    with app.app_context():
        

        # --- إعداد ssl_context لتفعيل TLS 1.3 فقط ---
        ssl_context = None
        cert_path = app.config.get('SSL_CERT_PATH')
        key_path = app.config.get('SSL_KEY_PATH')
        if cert_path and key_path and os.path.exists(cert_path) and os.path.exists(key_path):
            import ssl
            ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ssl_context.minimum_version = ssl.TLSVersion.TLSv1_3
            ssl_context.load_cert_chain(certfile=cert_path, keyfile=key_path)
            app.logger.info(f"SSL/TLS enabled with cert: {cert_path}")
        else:
            app.logger.debug("SSL certificates not configured - running in HTTP mode")
            ssl_context = None

        # --- إعداد eventlet محسن للـ Windows ---
        import sys

        # دائماً استخدم threading على ويندوز لتجنب مشاكل eventlet
        use_eventlet = False
        if sys.platform != "win32":
            try:
                import eventlet
                eventlet.monkey_patch()
                import eventlet.hubs
                eventlet.hubs.use_hub('selects')
                eventlet.wsgi.server.MAX_SIMULTANEOUS_REQUESTS = 1000
                eventlet.wsgi.server.SERVER_SOFTWARE = 'USB-Monitor/1.0'
                use_eventlet = True
            except ImportError:
                use_eventlet = False

    # Socket.IO تم تهيئته بالفعل في extensions.py
    # لا نحتاج لإعادة التهيئة هنا

    run_kwargs = dict(
        app=app,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", 5000)),
        debug=False,
        use_reloader=False,
        log_output=True  # تفعيل السجلات لمعرفة إذا كانت الطلبات تصل
    )
    
    # إضافة معالجة أفضل للأخطاء
    if ssl_context and not use_eventlet:
        run_kwargs['ssl_context'] = ssl_context
    elif ssl_context and use_eventlet:
        app.logger.warning("SSL/TLS with eventlet is not supported directly. Use a reverse proxy like nginx for SSL.")

    def update_server_status_on_shutdown():
        """تحديث حالة الخادم إلى offline عند إيقاف التطبيق"""
        # ===== أولاً: فك حظر جميع الأجهزة المحظورة =====
        try:
            from services.device_blocker import cleanup_all_blocked_devices, cleanup_pending_devices_from_db
            print("🧹 Backend shutdown: Re-enabling all blocked devices...")
            cleanup_all_blocked_devices()
            cleanup_pending_devices_from_db(server_id=1)
        except Exception as block_err:
            print(f"⚠️ Failed to cleanup blocked/pending devices: {block_err}")

        try:
            # الحصول على معرف الخادم الرئيسي (افتراضياً 1)
            server_id = 1

            # إنشاء client مباشرة لتجنب مشاكل الـ context
            from supabase import create_client
            supabase_url = app.config.get('SUPABASE_URL')
            supabase_anon_key = app.config.get('SUPABASE_ANON_KEY')

            if supabase_url and supabase_anon_key:
                client = create_client(supabase_url, supabase_anon_key)

                # تحديث حالة الخادم إلى offline مع إضافة is_online = false
                update_data = {
                    'status': 'offline',
                    'is_online': False,
                    'last_heartbeat': datetime.utcnow().isoformat(),
                    'updated_at': datetime.utcnow().isoformat()
                }

                result = client.table('servers').update(update_data).eq('id', server_id).execute()
                print(f"✅ Server {server_id} status updated to offline on shutdown")

                # إضافة سجل في جدول logs
                try:
                    log_data = {
                        'action': 'server_shutdown',
                        'user_id': None,
                        'details': f'{{"server_id": {server_id}, "shutdown_time": "{datetime.utcnow().isoformat()}", "reason": "Application shutdown"}}',
                        'timestamp': datetime.utcnow().isoformat()
                    }
                    client.table('logs').insert(log_data).execute()
                    print("📝 Server shutdown logged successfully")
                except Exception as log_error:
                    print(f"⚠️ Warning: Failed to log server shutdown: {log_error}")

        except Exception as e:
            print(f"❌ Failed to update server status on shutdown: {e}")

    # إضافة معالجة أفضل للإشارات
    import signal
    import sys
    import atexit
    import os
    import time
    
    def signal_handler(signum, frame):
        """Signal handler for graceful shutdown."""
        print(f"🔴 Received signal {signum}, shutting down gracefully...")

        # ===== فك حظر جميع الأجهزة المحظورة =====
        try:
            from services.device_blocker import cleanup_all_blocked_devices, cleanup_pending_devices_from_db
            print("🧹 Signal shutdown: Re-enabling all blocked devices...")
            cleanup_all_blocked_devices()
            cleanup_pending_devices_from_db(server_id=1)
        except Exception as block_err:
            print(f"⚠️ Failed to cleanup blocked/pending devices on signal: {block_err}")

        try:
            # تحديث حالة الخادم في قاعدة البيانات قبل الإيقاف
            update_server_status_on_shutdown()
        except Exception as e:
            print(f"❌ Error updating server status on shutdown: {e}")

        # Attempt to stop socketio server if available
        try:
            from extensions import socketio
            try:
                socketio.stop()
            except Exception:
                pass
        except Exception:
            pass

        # Small delay to allow threads to notice shutdown
        try:
            time.sleep(0.5)
        except Exception:
            pass

        print("👋 Shutdown complete (forcing exit)")
        try:
            os._exit(0)
        except Exception:
            try:
                sys.exit(0)
            except Exception:
                pass
    
    # تسجيل معالج الإشارات
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # تسجيل معالج إيقاف التطبيق
    atexit.register(update_server_status_on_shutdown)
    
    # طباعة معلومات الاتصال للسهولة
    try:
        current_ip = get_local_ip()
        print("\n" + "="*50)
        print(f"🚀 REMOT SERVER IS STARTING")
        print(f"📡 Local IP: {current_ip}")
        print(f"🔗 API URL: http://{current_ip}:{run_kwargs['port']}/api")
        print("="*50 + "\n")
    except:
        pass

    try:
        # تشغيل الخادم بصمت
        try:
            socketio.run(**run_kwargs)
        except Exception as e:
            pass
            
    except KeyboardInterrupt:
        pass
    except Exception as e:
        sys.exit(1)