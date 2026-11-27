import os
import pathlib
import json
from datetime import timedelta
# from sqlalchemy import event  # Commented out for Supabase-only mode
# from sqlalchemy.pool import NullPool  # Commented out for Supabase-only mode
# from extensions import db  # Commented out for Supabase-only mode
from urllib.parse import quote_plus, urlparse
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Import Supabase configuration
try:
    from supabase_config import get_supabase_config
    supabase_config = get_supabase_config()
except ImportError:
    supabase_config = {}

class Config:
    """إعدادات التطبيق العامة."""

    # ----------------------------
    # Load MCP configuration if available
    # ----------------------------
    @staticmethod
    def load_mcp_config():
        """Load configuration from MCP file if it exists"""
        mcp_path = pathlib.Path(__file__).parent.parent / '.vscode' / 'mcp.json'
        mcp_env_path = pathlib.Path(__file__).parent.parent / '.vscode' / '.env'
        
        config = {}
        
        # Load MCP JSON config
        if mcp_path.exists():
            try:
                with open(mcp_path, 'r', encoding='utf-8') as f:
                    mcp_data = json.load(f)
                    if 'servers' in mcp_data and 'supabase' in mcp_data['servers']:
                        supabase_config = mcp_data['servers']['supabase']
                        if 'env' in supabase_config:
                            config.update(supabase_config['env'])
            except Exception as e:
                print(f"Warning: Could not load MCP JSON config: {e}")
        
        # Load MCP .env file
        if mcp_env_path.exists():
            try:
                with open(mcp_env_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith('#') and '=' in line:
                            key, value = line.split('=', 1)
                            config[key.strip()] = value.strip()
            except Exception as e:
                print(f"Warning: Could not load MCP .env config: {e}")
        
        return config

    # ----------------------------
    # Server Configuration
    # ----------------------------
    # Load MCP configuration
    mcp_config = load_mcp_config.__func__() if hasattr(load_mcp_config, '__func__') else load_mcp_config()
    
    HOST = os.environ.get('HOST', mcp_config.get('HOST', supabase_config.get('HOST', '0.0.0.0')))
    PORT = int(os.environ.get('PORT', mcp_config.get('PORT', supabase_config.get('PORT', 5000))))
    DEBUG = os.environ.get('DEBUG', mcp_config.get('DEBUG', str(supabase_config.get('DEBUG', False)))).lower() in ['true','1','t']

    # ----------------------------
    # Security & Auth settings
    # ----------------------------
    SECRET_KEY = os.environ.get('SECRET_KEY', mcp_config.get('SECRET_KEY', supabase_config.get('SECRET_KEY', 'super_secret_key')))
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY', mcp_config.get('JWT_SECRET_KEY', supabase_config.get('JWT_SECRET_KEY', SECRET_KEY)))
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(
        days=int(os.environ.get('JWT_EXPIRATION_DAYS', mcp_config.get('JWT_EXPIRATION_DAYS', supabase_config.get('JWT_EXPIRATION_DAYS', 7))))  # أسبوع كامل
    )
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(
        days=int(os.environ.get('JWT_REFRESH_EXPIRATION_DAYS', mcp_config.get('JWT_REFRESH_EXPIRATION_DAYS', supabase_config.get('JWT_REFRESH_EXPIRATION_DAYS', 30))))  # شهر للتحديث
    )
    JWT_TOKEN_LOCATION = ("headers",)
    JWT_HEADER_NAME = "Authorization"
    JWT_HEADER_TYPE = "Bearer"
    RESET_TOKEN_EXPIRY_MINUTES = int(os.environ.get('RESET_TOKEN_EXPIRY_MINUTES', mcp_config.get('RESET_TOKEN_EXPIRY_MINUTES', supabase_config.get('RESET_TOKEN_EXPIRY_MINUTES', 10))))

    # ----------------------------
    # Database - Supabase Only
    # ----------------------------
    BASE_DIR = pathlib.Path(__file__).parent
    
    # Supabase PostgreSQL Database (Primary and Only Database)
    supabase_project_id = os.environ.get('SUPABASE_PROJECT_REF', mcp_config.get('SUPABASE_PROJECT_REF', supabase_config.get('SUPABASE_PROJECT_REF', 'fnsrzgbuusmyesdeedky')))
    supabase_password = os.environ.get('SUPABASE_PASSWORD', mcp_config.get('SUPABASE_PASSWORD', supabase_config.get('SUPABASE_PASSWORD', 'Lenovolaptop2003')))
    supabase_access_token = os.environ.get('SUPABASE_ACCESS_TOKEN', mcp_config.get('SUPABASE_ACCESS_TOKEN', supabase_config.get('SUPABASE_ACCESS_TOKEN', 'sbp_628f740f9fcf1bd187a0fc8a813a9a5b568a46d7')))
    
    # Supabase Client Configuration (REST API)
    supabase_url = f"https://{supabase_project_id}.supabase.co"
    supabase_anon_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZuc3J6Z2J1dXNteWVzZGVlZGt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYzNjQyOTYsImV4cCI6MjA3MTk0MDI5Nn0.IggzpWm40DQzA1Uirwb7SqZ8BMOT3RgiqmV1oXXkspY"

    # ----------------------------
    # Instance Configuration
    # ----------------------------
    SERVER_ID = int(os.environ.get('SERVER_ID', 1))  # Default to 1 (Main Server)
    
    # Make these available in app.config
    SUPABASE_URL = supabase_url
    SUPABASE_ANON_KEY = supabase_anon_key
    
    encoded_password = quote_plus(supabase_password)
    
    # Get DATABASE_URL from environment or construct it
    database_url = os.environ.get('DATABASE_URL', supabase_config.get('DATABASE_URL'))
    if database_url:
        # Parse the existing DATABASE_URL
        parsed = urlparse(database_url)
        # Use Supavisor Transaction Pooler port (6543) - IPv4 compatible
        if parsed.port == 5432:
            new_netloc = parsed.netloc.replace(':5432', ':6543')
            # SQLALCHEMY_DATABASE_URI = parsed._replace(netloc=new_netloc).geturl()
        else:
            # SQLALCHEMY_DATABASE_URI = database_url
            pass
    else:
        # Construct the connection string with Direct Connection (without db prefix)
        supabase_host = f"{supabase_project_id}.supabase.co"
        # SQLALCHEMY_DATABASE_URI = f"postgresql://postgres:{encoded_password}@{supabase_host}:5432/postgres?sslmode=require&connect_timeout=30&keepalives=1&keepalives_idle=30&keepalives_interval=10&keepalives_count=5"
        pass

    # Force Supabase connection - no fallback to SQLite
    print("🔄 Using Supabase Client only (no direct database connection)")
    # print(f"📊 Database URL: {SQLALCHEMY_DATABASE_URI}")
    print(f"🔑 Supabase Project ID: {supabase_project_id}")
    print(f"🔑 Supabase Access Token: {supabase_access_token[:20]}...")
    
    # Set dummy URI for SQLAlchemy compatibility (required for initialization)
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    
    # Supabase configuration
    SUPABASE_URL = f"https://{supabase_project_id}.supabase.co"
    SUPABASE_ANON_KEY = supabase_anon_key  # Use the hardcoded value
    SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    
    # Legacy configurations (kept for compatibility but not used)
    USE_SUPABASE = True  # Always use Supabase
    USE_FIREBASE = False  # Firebase disabled
    
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        # SQLite-compatible options (no pooling needed for in-memory database)
        "connect_args": {
            "check_same_thread": False,  # Allow multi-threading for SQLite
        }
    }

    # ----------------------------
    # TLS / HTTPS (Disabled for local HTTP development to fix browser blocks)
    PREFERRED_URL_SCHEME = 'http'
    SESSION_COOKIE_SECURE = False
    REMEMBER_COOKIE_SECURE = False
    JWT_COOKIE_SECURE = False

    # ----------------------------
    # CORS (Fail-Safe Defaults) - معطل لتجنب التضارب مع الإعداد في app.py
    # ----------------------------
    # FRONTEND_URL = '*'  
    # CORS_RESOURCES = { r"/api/*": {"origins": "*"} }
    
    # ----------------------------
    # SocketIO Settings
    # ----------------------------
    SOCKETIO_CORS_ALLOWED_ORIGINS = "*"
    SOCKETIO_PING_TIMEOUT = 60
    SOCKETIO_PING_INTERVAL = 25
    # إضافة إعدادات إضافية للتوافق مع WebSocket
    SOCKETIO_ASYNC_MODE = 'threading'
    SOCKETIO_MANAGE_SESSION = True
    SOCKETIO_ALLOW_UPGRADES = True
    SOCKETIO_ALLOW_EIO3 = True
    SOCKETIO_COMPRESSION_THRESHOLD = 1024

    # ----------------------------
    # Email (Flask-Mail)
    # ----------------------------
    MAIL_SERVER = os.environ.get('MAIL_SERVER', 'smtp.example.com')
    MAIL_PORT = int(os.environ.get('MAIL_PORT', 587))
    MAIL_USE_TLS = os.environ.get('MAIL_USE_TLS', 'True').lower() in ['true', '1', 't']
    MAIL_USERNAME = os.environ.get('MAIL_USERNAME')
    MAIL_PASSWORD = os.environ.get('MAIL_PASSWORD')
    MAIL_DEFAULT_SENDER = os.environ.get('MAIL_DEFAULT_SENDER', 'noreply@example.com')

    # ----------------------------
    # Admins & Notifications
    # ----------------------------
    ADMIN_EMAILS = [
        e.strip() for e in os.environ.get('ADMIN_EMAILS', '').split(',') if e.strip()
    ]

    # ----------------------------
    # OpenAI
    # ----------------------------
    OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')

    # ----------------------------
    # Mistral AI (optional)
    # ----------------------------
    # Set MISTRAL_API_KEY in environment for server-side Mistral access.
    # NOTE: a fallback is provided for local testing only. For production, set MISTRAL_API_KEY in env or secret store.
    MISTRAL_API_KEY = os.environ.get('MISTRAL_API_KEY', 'TtFCHbCf3iM6QT92TPdmvRk3CFbvWots')

    # ----------------------------
    # USB Monitoring
    # ----------------------------
    USB_POLLING_INTERVAL = int(os.environ.get('USB_POLLING_INTERVAL', supabase_config.get('USB_POLLING_INTERVAL', 1)))
    USB_AUTO_BLOCK_UNKNOWN = os.environ.get('USB_AUTO_BLOCK_UNKNOWN', str(supabase_config.get('USB_AUTO_BLOCK_UNKNOWN', False))).lower() in ['true','1','t']
    USB_ALLOW_PERIPHERALS = os.environ.get('USB_ALLOW_PERIPHERALS', str(supabase_config.get('USB_ALLOW_PERIPHERALS', True))).lower() in ['true','1','t']
    USB_ALLOW_DEVICES_WITHOUT_SERIAL = os.environ.get('USB_ALLOW_DEVICES_WITHOUT_SERIAL', str(supabase_config.get('USB_ALLOW_DEVICES_WITHOUT_SERIAL', True))).lower() in ['true','1','t']
    USB_MAX_POWER_DRAW_MA = int(os.environ.get('USB_MAX_POWER_DRAW_MA', supabase_config.get('USB_MAX_POWER_DRAW_MA', 500)))
    USB_MIN_VOLTAGE_V    = float(os.environ.get('USB_MIN_VOLTAGE_V', supabase_config.get('USB_MIN_VOLTAGE_V', 4.75)))

    # ----------------------------
    # Offline Mode / Caching
    # ----------------------------
    OFFLINE_MODE_ENABLED = os.environ.get('OFFLINE_MODE_ENABLED', str(supabase_config.get('OFFLINE_MODE_ENABLED', True))).lower() in ['true','1','t']
    OFFLINE_CACHE_PATH   = os.environ.get(
        'OFFLINE_CACHE_PATH',
        str(BASE_DIR / 'db' / 'offline_events.json')
    )
    OFFLINE_SYNC_INTERVAL= int(os.environ.get('OFFLINE_SYNC_INTERVAL', 300))

    # ----------------------------
    # Security Policies & Hours
    # ----------------------------
    SECURITY_AFTER_HOURS_BLOCK        = os.environ.get('SECURITY_AFTER_HOURS_BLOCK', 'False').lower() in ['true','1','t']
    SECURITY_WORK_HOUR_START          = int(os.environ.get('SECURITY_WORK_HOUR_START', 9))
    SECURITY_WORK_HOUR_END            = int(os.environ.get('SECURITY_WORK_HOUR_END', 17))
    SECURITY_AUTO_WHITELIST_KEYBOARDS = os.environ.get('SECURITY_AUTO_WHITELIST_KEYBOARDS', 'True').lower() in ['true','1','t']
    SECURITY_AUTO_WHITELIST_MICE      = os.environ.get('SECURITY_AUTO_WHITELIST_MICE', 'True').lower() in ['true','1','t']
    SECURITY_LOG_USB_TRANSFER         = os.environ.get('SECURITY_LOG_USB_TRANSFER', 'True').lower() in ['true','1','t']

    # ----------------------------
    # Blockchain
    # ----------------------------
    BLOCKCHAIN_ENABLED         = os.environ.get('BLOCKCHAIN_ENABLED', str(supabase_config.get('BLOCKCHAIN_ENABLED', True))).lower() in ['true','1','t']
    BLOCKCHAIN_VERIFY_ON_START = os.environ.get('BLOCKCHAIN_VERIFY_ON_START', 'False').lower() in ['true','1','t']
    BLOCKCHAIN_AUTO_RESET_ON_FAILURE = os.environ.get('BLOCKCHAIN_AUTO_RESET_ON_FAILURE', 'False').lower() in ['true','1','t']
    BLOCKCHAIN_DIFFICULTY      = int(os.environ.get('BLOCKCHAIN_DIFFICULTY', 4))

    # ----------------------------
    # AI Monitoring
    # ----------------------------
    AI_MONITORING_ENABLED   = os.environ.get('AI_MONITORING_ENABLED', str(supabase_config.get('AI_MONITORING_ENABLED', True))).lower() in ['true','1','t']
    AI_ANOMALY_THRESHOLD     = float(os.environ.get('AI_ANOMALY_THRESHOLD', 0.7))
    AI_AUTO_BLOCK_HIGH_RISK  = os.environ.get('AI_AUTO_BLOCK_HIGH_RISK', 'False').lower() in ['true','1','t']

    # ----------------------------
    # Reporting & Analytics
    # ----------------------------
    REPORT_CSV_PATH = os.environ.get(
        'REPORT_CSV_PATH',
        str(BASE_DIR / 'exports' / 'csv')
    )
    REPORT_PDF_PATH = os.environ.get(
        'REPORT_PDF_PATH',
        str(BASE_DIR / 'exports' / 'pdf')
    )

    # ----------------------------
    # Subscription Reminders
    # ----------------------------
    SUBSCRIPTION_REMINDER_DAYS = [
        int(x) for x in os.environ.get('SUBSCRIPTION_REMINDER_DAYS', '7,3,1').split(',') if x
    ]

    # ----------------------------
    # Client Servers (multi-tenant)
    # ----------------------------
    CLIENT_SERVERS       = [
        u.strip() for u in os.environ.get('CLIENT_SERVERS', '').split(',') if u.strip()
    ]
    POLICY_SYNC_INTERVAL = int(os.environ.get('POLICY_SYNC_INTERVAL', 300))
    CLIENT_SYNC_INTERVAL = int(os.environ.get('CLIENT_SYNC_INTERVAL', 300))

    # ----------------------------
    # Activation / Licensing
    # ----------------------------
    LICENSE_CHECK_ENABLED = os.environ.get('LICENSE_CHECK_ENABLED', 'True').lower() in ['true','1','t']
    LICENSE_KEY           = os.environ.get('LICENSE_KEY')

    # ----------------------------
    # SIEM Integration
    # ----------------------------
    SIEM_ENABLED    = os.environ.get('SIEM_ENABLED', 'False').lower() in ['true','1','t']
    SIEM_API_URL    = os.environ.get('SIEM_API_URL', '')
    SIEM_API_KEY    = os.environ.get('SIEM_API_KEY', '')
    SIEM_TLS_VERIFY = os.environ.get('SIEM_TLS_VERIFY', 'True').lower() in ['true','1','t']

    # ----------------------------
    # LDAP / Active Directory
    # ----------------------------
    LDAP_ENABLED   = os.environ.get('LDAP_ENABLED', 'False').lower() in ['true','1','t']
    LDAP_URI       = os.environ.get('LDAP_URI', '')
    LDAP_BIND_DN   = os.environ.get('LDAP_BIND_DN', '')
    LDAP_BIND_PASS = os.environ.get('LDAP_BIND_PASS', '')
    LDAP_BASE_DN   = os.environ.get('LDAP_BASE_DN', '')

    # ----------------------------
    # TLS / HTTPS
    # ----------------------------
    SSL_CERT_PATH = os.environ.get('SSL_CERT_PATH', '')
    SSL_KEY_PATH  = os.environ.get('SSL_KEY_PATH', '')

    # ----------------------------
    # Performance & Logging
    # ----------------------------
    DEBUG                = os.environ.get('DEBUG', str(supabase_config.get('DEBUG', False))).lower() in ['true','1','t']
    TESTING              = os.environ.get('TESTING', 'False').lower() in ['true','1','t']
    LOG_LEVEL            = os.environ.get('LOG_LEVEL', 'WARNING')
    PERFORMANCE_LOGGING  = os.environ.get('PERFORMANCE_LOGGING', 'False').lower() in ['true','1','t']
    PERFORMANCE_INTERVAL = int(os.environ.get('PERFORMANCE_INTERVAL', 60))

    # ----------------------------
    # Backup
    # ----------------------------
    BACKUP_ENABLED        = os.environ.get('BACKUP_ENABLED', 'True').lower() in ['true','1','t']
    BACKUP_INTERVAL_HOURS = int(os.environ.get('BACKUP_INTERVAL_HOURS', 24))
    # ----------------------------
    # SMS & Twilio
    # ----------------------------
    ALERTS_SMS_ENABLED = os.environ.get('ALERTS_SMS_ENABLED', 'False').lower() in ['true','1','t']
    SMS_ACCOUNT_SID    = os.environ.get('SMS_ACCOUNT_SID', '')
    SMS_AUTH_TOKEN     = os.environ.get('SMS_AUTH_TOKEN', '')
    SMS_FROM_NUMBER    = os.environ.get('SMS_FROM_NUMBER', '')

    # ----------------------------
    # SIEM Integration
    # ----------------------------
    SIEM_API_KEY = os.environ.get('SIEM_API_KEY', 'your_siem_api_key')

    # ----------------------------
    # Timezone
    # ----------------------------
    TIMEZONE = os.environ.get('TIMEZONE', supabase_config.get('TIMEZONE', 'Asia/Baghdad'))

    # ------------------------------------------------------------------
    # PostgreSQL specific settings for Supabase (disabled in Supabase-only mode)
    # ------------------------------------------------------------------
    @classmethod
    def init_app(cls, app):
        # SQLAlchemy event listeners disabled for Supabase-only mode
        # @event.listens_for(db.engine, 'connect')
        # def _set_postgresql_settings(dbapi_conn, connection_record):
        #     """Set PostgreSQL specific settings for Supabase"""
        #     cursor = dbapi_conn.cursor()
        #     # Set timezone to Baghdad
        #     cursor.execute("SET timezone = 'Asia/Baghdad';")
        #     # Set client encoding
        #     cursor.execute("SET client_encoding = 'UTF8';")
        #     # Enable foreign key constraints
        #     cursor.execute("SET session_replication_role = 'origin';")
        #     cursor.close()
        pass

