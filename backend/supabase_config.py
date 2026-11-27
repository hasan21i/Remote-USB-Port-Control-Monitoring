# Supabase Configuration File
# Copy this file to .env or set these environment variables

import os

# Supabase Configuration - Read from environment variables
SUPABASE_PROJECT_REF = os.getenv('SUPABASE_PROJECT_REF', "fnsrzgbuusmyesdeedky")
SUPABASE_PASSWORD = os.getenv('SUPABASE_PASSWORD', "Lenovolaptop2003")
SUPABASE_ACCESS_TOKEN = os.getenv('SUPABASE_ACCESS_TOKEN', "sbp_628f740f9fcf1bd187a0fc8a813a9a5b568a46d7")
SUPABASE_URL = os.getenv('SUPABASE_URL', f"https://{SUPABASE_PROJECT_REF}.supabase.co")
SUPABASE_ANON_KEY = os.getenv('SUPABASE_ANON_KEY', "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZuc3J6Z2J1dXNteWVzZGVlZGt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYzNjQyOTYsImV4cCI6MjA3MTk0MDI5Nn0.IggzpWm40DQzA1Uirwb7SqZ8BMOT3RgiqmV1oXXkspY")  # Updated with correct anon key

# Database Configuration - Using Direct Connection without db prefix
DATABASE_URL = f"postgresql://postgres:{SUPABASE_PASSWORD}@{SUPABASE_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require"

# Supabase Client Function
def get_supabase_client():
    """Get a fresh Supabase client instance with increased timeout"""
    try:
        from supabase import create_client, Client
        from postgrest import SyncPostgrestClient
        from httpx import Timeout
        
        # Increase the connection timeout to 30 seconds for unstable networks
        custom_timeout = Timeout(30.0)
        
        # Create client with explicit parameters
        # We can also handle it by passing options if the version supports it
        client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        
        # Manually set timeout on the underlying postgrest client if possible
        if hasattr(client, 'postgrest'):
            client.postgrest.timeout = 30.0
            
        return client
    except Exception as e:
        return None

# Application Configuration
HOST = "0.0.0.0"
PORT = 5000
DEBUG = False
SECRET_KEY = "super_secret_key_for_supabase_only"
JWT_SECRET_KEY = "super_secret_key_for_supabase_only"

# Security Settings
JWT_EXPIRATION_DAYS = 7
JWT_REFRESH_EXPIRATION_DAYS = 30
RESET_TOKEN_EXPIRY_MINUTES = 10

# Timezone
TIMEZONE = "Asia/Baghdad"

# USB Monitoring
USB_POLLING_INTERVAL = 1
USB_AUTO_BLOCK_UNKNOWN = False
USB_ALLOW_PERIPHERALS = True
USB_ALLOW_DEVICES_WITHOUT_SERIAL = True
USB_MAX_POWER_DRAW_MA = 500
USB_MIN_VOLTAGE_V = 4.75

# Features
BLOCKCHAIN_ENABLED = True
AI_MONITORING_ENABLED = True
OFFLINE_MODE_ENABLED = True

def get_supabase_config():
    """Get Supabase configuration as dictionary"""
    return {
        'SUPABASE_PROJECT_REF': SUPABASE_PROJECT_REF,
        'SUPABASE_PASSWORD': SUPABASE_PASSWORD,
        'SUPABASE_ACCESS_TOKEN': SUPABASE_ACCESS_TOKEN,
        'SUPABASE_URL': SUPABASE_URL,
        'DATABASE_URL': DATABASE_URL,
        'HOST': HOST,
        'PORT': PORT,
        'DEBUG': DEBUG,
        'SECRET_KEY': SECRET_KEY,
        'JWT_SECRET_KEY': JWT_SECRET_KEY,
        'JWT_EXPIRATION_DAYS': JWT_EXPIRATION_DAYS,
        'JWT_REFRESH_EXPIRATION_DAYS': JWT_REFRESH_EXPIRATION_DAYS,
        'RESET_TOKEN_EXPIRY_MINUTES': RESET_TOKEN_EXPIRY_MINUTES,
        'TIMEZONE': TIMEZONE,
        'USB_POLLING_INTERVAL': USB_POLLING_INTERVAL,
        'USB_AUTO_BLOCK_UNKNOWN': USB_AUTO_BLOCK_UNKNOWN,
        'USB_ALLOW_PERIPHERALS': USB_ALLOW_PERIPHERALS,
        'USB_ALLOW_DEVICES_WITHOUT_SERIAL': USB_ALLOW_DEVICES_WITHOUT_SERIAL,
        'USB_MAX_POWER_DRAW_MA': USB_MAX_POWER_DRAW_MA,
        'USB_MIN_VOLTAGE_V': USB_MIN_VOLTAGE_V,
        'BLOCKCHAIN_ENABLED': BLOCKCHAIN_ENABLED,
        'AI_MONITORING_ENABLED': AI_MONITORING_ENABLED,
        'OFFLINE_MODE_ENABLED': OFFLINE_MODE_ENABLED,
    }

if __name__ == "__main__":
    # Configuration loaded silently
    pass
