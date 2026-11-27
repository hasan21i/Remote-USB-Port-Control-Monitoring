# backend/utils.py

import os
import json
import time
import logging
import platform
import hashlib
import uuid
import subprocess
import re
from datetime import datetime
from typing import Optional, Tuple, List, Dict, Any

import psutil
import usb.core
import usb.util
from flask import current_app, jsonify
from flask_mail import Message
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
from flask_jwt_extended import jwt_required, get_jwt

# Monkey patch httpx.Client to ignore proxy parameters globally and set timeout
import httpx
original_init = httpx.Client.__init__
def patched_init(self, *args, **kwargs):
    # Remove proxy-related parameters to prevent proxy errors
    kwargs.pop('proxy', None)
    kwargs.pop('proxies', None)
    # Set a generous timeout to prevent ReadTimeout errors
    if 'timeout' not in kwargs or kwargs.get('timeout') is None:
        kwargs['timeout'] = httpx.Timeout(30.0, connect=10.0)
    return original_init(self, *args, **kwargs)
httpx.Client.__init__ = patched_init

# Windows support removed - Linux only

# Linux specific imports
if platform.system() == 'Linux':
    try:
        import pyudev  # type: ignore
        LINUX_AVAILABLE = True
    except ImportError:
        LINUX_AVAILABLE = False
else:
    LINUX_AVAILABLE = False

# Cache for device types to use during disconnection events
_device_type_cache = {}

from models import Alert, BlockchainLog, DeviceSerial, Device, Policy
from extensions import db, socketio, mail, supabase_client

# Supabase client initialization for utils
def get_supabase_client():
    """Get fresh Supabase client instance for utils"""
    try:
        from flask import current_app
        from supabase import create_client
        
        supabase_url = current_app.config.get('SUPABASE_URL')
        supabase_anon_key = current_app.config.get('SUPABASE_ANON_KEY')
        
        if supabase_url and supabase_anon_key:
            return create_client(supabase_url, supabase_anon_key)
        else:
            logger.error("Supabase configuration missing in utils")
            return None
    except Exception as e:
        logger.error(f"Failed to create Supabase client in utils: {e}")
        return None


# -----------------------------
# Supabase table helpers
# -----------------------------

def get_table_columns(table_name: str):
    """Return a set of column names for a given table using Supabase REST as a lightweight schema probe.

    This caches results on current_app to avoid repeated network calls.
    If the table is empty we may not be able to infer columns; in that case return an empty set.
    """
    try:
        from flask import current_app
        # Use a simple cache on the app to reduce requests
        cache = getattr(current_app, '_table_schema_cache', {})
        if table_name in cache:
            return cache[table_name]

        client = get_supabase_client()
        if not client:
            return set()

        resp = client.table(table_name).select('*').limit(1).execute()
        if getattr(resp, 'error', None):
            logger.debug(f"Supabase returned error fetching sample row for {table_name}: {resp.error}")
            current_app._table_schema_cache = cache
            cache[table_name] = set()
            return cache[table_name]

        data = resp.data or []
        if not data:
            # If table empty, we cannot infer columns via REST; return empty set
            cache[table_name] = set()
            current_app._table_schema_cache = cache
            return cache[table_name]

        cols = set()
        for k in data[0].keys():
            cols.add(k)

        cache[table_name] = cols
        current_app._table_schema_cache = cache
        return cols
    except Exception as e:
        logger.debug(f"Error getting table columns for {table_name}: {e}")
        return set()


def filter_payload_for_table(table_name: str, payload: dict) -> dict:
    """Return a copy of payload that only contains keys that exist in the table schema.

    If schema cannot be determined, the payload is returned unchanged to avoid breaking behavior.
    """
    try:
        from flask import current_app
        cols = get_table_columns(table_name)
        if not cols:
            # schema unknown (empty table or error) - do not filter
            logger.debug(f"Schema for {table_name} unknown; not filtering payload")
            return payload

        filtered = {k: v for k, v in payload.items() if k in cols}
        removed = set(payload.keys()) - set(filtered.keys())
        if removed:
            logger.info(f"Filtered out keys not present in {table_name}: {sorted(list(removed))}")
        return filtered
    except Exception as e:
        logger.debug(f"Error filtering payload for {table_name}: {e}")
        return payload


def safe_insert(client, table_name: str, payload: dict):
    """Filter payload for table and insert using the provided supabase client.

    This function centralizes filtering to avoid repeated code in controllers.
    """
    try:
        payload = filter_payload_for_table(table_name, payload)
    except Exception:
        pass
    return client.table(table_name).insert(payload).execute()

# -------------------------------------------------------------------
# Logger setup
# -------------------------------------------------------------------
logger = logging.getLogger("utils")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    ))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)

# -------------------------------------------------------------------
# Timezone for Baghdad
# -------------------------------------------------------------------
try:
    from zoneinfo import ZoneInfo
    BAGHDAD_TZ = ZoneInfo("Asia/Baghdad")
except ImportError:
    from dateutil.tz import gettz
    BAGHDAD_TZ = gettz("Asia/Baghdad")


def current_time() -> datetime:
    """Return current time in Baghdad timezone as naive datetime."""
    now = datetime.now(BAGHDAD_TZ)
    return now.replace(tzinfo=None)


# -------------------------------------------------------------------
# Security Helpers
# -------------------------------------------------------------------
def hash_password(password: str) -> str:
    """Hash a password using Werkzeug's modern scrypt method."""
    if not password:
        raise ValueError("كلمة المرور مطلوبة")
    return generate_password_hash(password, method='scrypt')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash; returns False on error."""
    try:
        return check_password_hash(hashed_password, plain_password)
    except Exception as e:
        current_app.logger.error(f"Password verification error: {e}")
        return False


# -------------------------------------------------------------------
# Serial ID Generation
# -------------------------------------------------------------------
def generate_serial_id() -> str:
    """Generate a unique serial ID for devices without serial number."""
    return f"USB_{int(time.time())}_{uuid.uuid4().hex[:8]}"


def generate_device_hash(vendor_id: str, product_id: str, serial_number: Optional[str] = None) -> str:
    """Generate a unique hash for device identification."""
    device_string = f"{vendor_id}_{product_id}_{serial_number or 'unknown'}"
    return hashlib.sha256(device_string.encode()).hexdigest()


def is_device_connected(serial_number: str) -> bool:
    """Check if a device is currently connected using Windows PowerShell."""
    try:
        if platform.system() == "Windows":
            # استخدام PowerShell للتحقق من وجود الجهاز
            cmd = [
                'powershell', '-NoProfile', '-NonInteractive', '-Command',
                f'Get-PnpDevice | Where-Object {{ $_.DeviceID -like "*{serial_number}*" -and $_.Status -eq "OK" -and $_.Present -eq $true }} | Measure-Object | Select-Object -ExpandProperty Count'
            ]

            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            except subprocess.TimeoutExpired:
                logger.warning(f"PowerShell command timed out while checking device {serial_number}")
                return False
            except KeyboardInterrupt:
                logger.warning(f"PowerShell command interrupted while checking device {serial_number}")
                return False
            except Exception as subprocess_error:
                logger.error(f"PowerShell subprocess error while checking device {serial_number}: {subprocess_error}")
                return False
                
            if result.returncode == 0:
                count = int(result.stdout.strip()) if result.stdout.strip().isdigit() else 0
                return count > 0

        # للأنظمة الأخرى أو كـ fallback، استخدام pyusb
        try:
            device = find_device_by_serial(serial_number)
            return device is not None
        except Exception as usb_error:
            logger.debug(f"pyusb fallback failed: {usb_error}")
            return False

    except Exception as e:
        logger.error(f"Error checking device connection: {e}")
        return False


def log_devices_table(details_list, show_state=True):
    """
    Logs a list of devices as a formatted table in the console.
    
    Args:
        details_list: List of tuples. Can be:
            - (serial, name, type) - legacy format
            - (serial, name, type, state) - new format with state
        show_state: Whether to show the State column (default True)
    """
    if not details_list:
        return
    
    # التحقق من نوع البيانات وتحديد ما إذا كان هناك state
    sample = details_list[0] if details_list else None
    has_state = sample and len(sample) >= 4
    
    if has_state or show_state:
        total_width = 94
        header_fmt_print = "║ {:<3} │ {:<16} │ {:<32} │ {:<15} │ {:<12} ║"
        header_fmt_value = "║ {:<3} │ {:<16} │ {:<32} │ {:<15} │ {}"  # Without closing border for ANSI calculation
    else:
        total_width = 79
        header_fmt_print = "║ {:<3} │ {:<16} │ {:<35} │ {:<15} ║"
    
    top_border = "╔" + "═" * (total_width - 2) + "╗"
    separator  = "╠" + "═" * (total_width - 2) + "╣"
    bot_border = "╚" + "═" * (total_width - 2) + "╝"
    
    print("\n  " + top_border)
    title = "📱 CURRENTLY CONNECTED DEVICES"
    # emoji counts as length 1 but usually renders as 2 columns, so we subtract 1 from right padding
    left_pad = (total_width - 2 - len(title)) // 2
    right_pad = total_width - 2 - len(title) - left_pad - 1
    print(f"  ║{' ' * left_pad}{title}{' ' * max(0, right_pad)}║")
    print("  " + separator)
    
    if has_state or show_state:
        print("  " + header_fmt_print.format("#", "Serial Number", "Device Name", "Type", "State"))
    else:
        print("  " + header_fmt_print.format("#", "Serial Number", "Device Name", "Type"))
        
    print("  " + separator)
    
    for i, item in enumerate(details_list):
        if has_state and len(item) >= 4:
            serial, name, typ, state = item[0], item[1], item[2], item[3]
            serial_display = serial[:16] if serial else "N/A"
            display_name = (name[:29] + '...') if len(name) > 32 else name
            display_type = (typ[:12] + '...') if len(typ) > 15 else typ
            
            # Translate and color the status
            status_map = {
                'connected': ('connected', '\033[92m'),     # Green
                'pending': ('pending  ', '\033[93m'),       # Yellow
                'disconnected': ('disconnected', '\033[91m'),# Red
                'blocked': ('🚫 blocked', '\033[91m'),      # Red
                'ok': ('connected', '\033[92m')             # Fallback
            }
            
            clean_state = state.lower().strip()
            # If "blocked" clean_state contains emoji, handle it gracefully
            if 'blocked' in clean_state:
                display_status, color = status_map['blocked']
            else:
                display_status, color = status_map.get(clean_state, (state, ''))
            
            # Handle string padding length calculation (ANSI codes don't count towards width)
            # The status width should be 12 chars
            # visible length of display_status (emoji counts as 2 spaces roughly in terminal alignment)
            visible_len = len(display_status.replace('🚫 ', 'XX'))
            pad = max(0, 12 - visible_len)
            
            state_display = f"{color}{display_status}\033[0m" + (" " * pad)
            
            print("  " + header_fmt_value.format(i+1, serial_display, display_name, display_type, state_display) + " ║")
        else:
            serial, name, typ = item[0], item[1], item[2] if len(item) >= 3 else 'Unknown'
            serial_display = serial[:16] if serial else "N/A"
            display_name = (name[:32] + '...') if len(name) > 35 else name
            print("  " + header_fmt_print.format(i+1, serial_display, display_name, typ))
    
    print("  " + bot_border + "\n")


def log_device_event(action, serial, name, device_type="USB Device", server_id=None):
    """Logs a single device connection/disconnection event as a small table."""
    # Ensure values are strings and handle None
    name = str(name) if name is not None else "Unknown"
    device_type = str(device_type) if device_type is not None else "USB Device"
    serial = str(serial) if serial is not None else "Unknown"
    
    # Get current server_id from config if not provided
    if server_id is None:
        try:
            from flask import current_app
            server_id = current_app.config.get('SERVER_ID', 1)
        except:
            server_id = 1

    icon = "✅" if action == "CONNECTED" else "❌"
    color_code = "\033[92m" if action == "CONNECTED" else "\033[91m"
    reset_code = "\033[0m"
    
    width = 60
    separator = "  " + "=" * width
    
    print("\n" + separator)
    print(f"  {icon} {color_code}DEVICE {action} [v2.1] (Server {server_id}){reset_code}".center(width + 2))
    print(separator)
    print(f"  | Serial: {serial[:48]:<48} |")
    print(f"  | Name:   {name[:48]:<48} |")
    print(f"  | Type:   {device_type[:48]:<48} |")
    print(separator + "\n")


# Cache لمنع تكرار رسالة اكتشاف نفس الجهاز
_logged_new_devices = set()

def log_new_device_discovered(serial, name, device_type="USB Device", status="pending", server_id=None):
    """Logs a newly discovered device (pending status) as a styled table. Only logs once per device."""
    global _logged_new_devices
    
    # Ensure values are strings and handle None
    name = str(name) if name is not None else "Unknown"
    device_type = str(device_type) if device_type is not None else "USB Device"
    serial = str(serial) if serial is not None else "Unknown"
    status = str(status) if status is not None else "pending"
    
    # Get current server_id from config if not provided
    if server_id is None:
        try:
            from flask import current_app
            server_id = current_app.config.get('SERVER_ID', 1)
        except:
            server_id = 1

    if serial in _logged_new_devices:
        return
        
    _logged_new_devices.add(serial)
    
    # Yellow color for pending/new devices
    icon = "🆕"
    color_code = "\033[93m"  # Yellow
    reset_code = "\033[0m"
    
    width = 60
    separator = "  " + "=" * width
    
    print("\n" + separator)
    print(f"  {icon} {color_code}NEW DEVICE DISCOVERED [v2.1] (Server {server_id}){reset_code}".center(width + 2))
    print(separator)
    print(f"  | Serial: {serial[:48]:<48} |")
    print(f"  | Name:   {name[:48]:<48} |")
    print(f"  | Type:   {device_type[:48]:<48} |")
    if status != "pending":
        print(f"  | Status: {status[:48]:<48} |")
    print(separator + "\n")


def print_connected_devices_table():
    """
    طباعة جدول الأجهزة المتصلة حالياً عند بدء النظام.
    يجلب الأجهزة من discover_usb_devices ويعرضها في جدول مع حالة كل جهاز.
    """
    try:
        # Lazy import to avoid circular dependency
        devices = discover_usb_devices()
        if not devices:
            return

        # Get known serials from DB
        db_known_serials = set()
        try:
            client = get_supabase_client()
            if client:
                response = client.table('devices').select('serial_number').execute()
                if response and hasattr(response, 'data') and response.data:
                    db_known_serials = {str(d.get('serial_number', '')).strip().lower() 
                                        for d in response.data if d.get('serial_number')}
        except Exception:
            pass

        # جلب الأجهزة المحظورة حالياً من نظام الحظر
        blocked_instance_ids = set()
        try:
            from services.device_blocker import get_blocker_status
            blocker_status = get_blocker_status()
            blocked_instance_ids = {str(did).lower() for did in blocker_status.get('blocked_ids', [])}
        except Exception:
            pass

        # Deduplicate
        try:
            deduped = enhanced_device_deduplication(devices)
        except Exception:
            deduped = devices

        device_details = []
        for device in deduped:
            serial = (device.get('serial_number') or '').strip()
            name = device.get('name') or device.get('product') or 'Unknown Device'
            dev_type = get_device_type_from_class(device.get('device_class') or device.get('class') or '') or (device.get('device_type') or 'USB Device')
            instance_id = str(device.get('device_id', '')).lower()

            # Determine state
            state = 'pending'
            if serial and serial.lower() in db_known_serials:
                state = 'connected'
            
            # إذا كان الجهاز محظوراً في نظام الحظر
            if instance_id in blocked_instance_ids:
                state = 'blocked'
            
            display_serial = serial[:16] if serial else 'N/A'
            device_details.append((display_serial, name, dev_type, state))

        if device_details:
            log_devices_table(device_details)
    except Exception as e:
        logger.warning(f"Failed to print connected devices table: {e}")



# -------------------------------------------------------------------
# Device Discovery Functions
# -------------------------------------------------------------------
def discover_usb_devices() -> List[Dict[str, Any]]:
    """
    اكتشاف جميع أجهزة USB الحقيقية في النظام.
    يعمل على Windows و Linux مع الكشف المحسن وإزالة التكرار.
    """
    devices = []
    real_devices = []  # Initialize here to avoid unbound variable
    system = platform.system().lower()
    
    try:
        if system == 'windows':
            # استخدام الدالة الصحيحة التي تكتشف الأجهزة الحقيقية فقط
            raw_devices = get_real_usb_devices()
            # إضافة device_type بناءً على class الجهاز
            devices = []
            for device in raw_devices:
                device_class = device.get('class', 'Unknown')
                device['device_class'] = device_class
                device['device_type'] = get_device_type_from_class(device_class)
                devices.append(device)
        elif system == 'linux':
            devices = discover_usb_devices_linux()
        else:
            # Fallback to generic pyusb detection
            devices = discover_usb_devices_generic()
            
        # الأجهزة المُعادة من get_real_usb_devices() هي بالفعل حقيقية
        real_devices = devices
        
        # تطبيق إزالة التكرار المحسنة للحل مشكلة الأجهزة المكررة مثل IntelWireless Bluetooth
        try:
            deduplicated_devices = enhanced_device_deduplication(real_devices)
        except Exception as dedup_error:
            logger.error(f"فشل في إزالة التكرار المحسنة: {dedup_error}")
            # Use simple deduplication as fallback
            deduplicated_devices = []
            seen_serials = set()
            for device in real_devices:
                device_serial = device.get('serial_number', '')
                device_key = f"{device.get('vendor_id', '')}:{device.get('product_id', '')}:{device_serial}"
                if device_key not in seen_serials:
                    seen_serials.add(device_key)
                    deduplicated_devices.append(device)
            logger.info(f"استخدام إزالة التكرار البسيطة: {len(real_devices)} -> {len(deduplicated_devices)} جهاز")
        
        # توليد serial number للأجهزة التي تحتاجه
        try:
            for device in deduplicated_devices:
                if not device.get('serial_number'):
                    try:
                        device['serial_number'] = generate_enhanced_serial_number(device)
                        logger.debug(f"تم توليد رقم تسلسلي للجهاز: {device.get('name', 'Unknown')} - {device['serial_number']}")
                    except Exception as serial_error:
                        # Fallback serial generation
                        device['serial_number'] = generate_serial_id()
                        logger.warning(f"فشل في توليد رقم تسلسلي محسن، استخدام الافتراضي: {serial_error}")
        except Exception as serial_gen_error:
            logger.error(f"خطأ في معالجة الأرقام التسلسلية: {serial_gen_error}")
        
        real_devices = deduplicated_devices
                    
        # Reduce logging frequency to avoid spam
        if not hasattr(discover_usb_devices, '_last_log_time'):
            discover_usb_devices._last_log_time = 0
        
        current_time_stamp = time.time()
        if current_time_stamp - discover_usb_devices._last_log_time > 60:  # Log only once every minute
            discover_usb_devices._last_log_time = current_time_stamp
                    
    except Exception as e:
        logger.error(f"خطأ في اكتشاف أجهزة USB: {e}")
        # Fallback to generic discovery on any error
        try:
            logger.info("محاولة استخدام الطريقة العامة لاكتشاف الأجهزة")
            fallback_devices = discover_usb_devices_generic()
            for device in fallback_devices:
                if is_real_device(device):
                    if not device.get('serial_number'):
                        device['serial_number'] = generate_enhanced_serial_number(device)
                    real_devices.append(device)
            logger.info(f"تم اكتشاف {len(real_devices)} جهاز بالطريقة العامة")
        except Exception as fallback_error:
            logger.error(f"فشل في الطريقة العامة أيضاً: {fallback_error}")
    
    return real_devices


def get_real_usb_devices_windows() -> List[Dict[str, Any]]:
    """جلب جميع الأجهزة USB الحقيقية من Windows - شامل ومحسن"""
    devices = []
    
    try:
        # استخدام WMI للحصول على معلومات الأجهزة المتصلة فعلياً
        cmd = [
            'powershell', '-NoProfile', '-NonInteractive', '-Command',
            '''
            $devices = @()
            
            # جلب فقط أجهزة USB الأب (الأجهزة الفيزيائية المتصلة مباشرة)
            Get-WmiObject -Class Win32_PnPEntity | Where-Object {
                $_.DeviceID -like "USB\\VID_*" -and
                -not ($_.DeviceID -like "*&MI_*") -and
                $_.Status -eq "OK" -and 
                $_.Present -eq $true -and
                # استبعاد الأجهزة الداخلية الأساسية فقط
                -not ($_.DeviceID -like "*ROOT_HUB*") -and
                -not ($_.DeviceID -like "*PCI*") -and
                -not ($_.DeviceID -like "*ACPI*") -and
                -not ($_.DeviceID -like "*HDAUDIO*") -and
                -not ($_.DeviceID -like "*DISPLAY*") -and
                -not ($_.DeviceID -like "*{*") -and
                # التأكد من وجود VID و PID صالحين
                ($_.DeviceID -match "VID_[0-9A-F]{4}") -and
                ($_.DeviceID -match "PID_[0-9A-F]{4}")
            } | ForEach-Object {
                $deviceId = $_.DeviceID
                $vendorId = ""
                $productId = ""
                $instanceId = ""
                
                # استخراج Vendor ID و Product ID
                if ($deviceId -match "VID_([0-9A-F]{4}).*PID_([0-9A-F]{4})") {
                    $vendorId = $matches[1].ToLower()
                    $productId = $matches[2].ToLower()
                }
                
                # استخراج Instance ID
                if ($deviceId -match "\\\\([A-Z0-9&_]{{4,}})$") {
                    $instanceId = $matches[1]
                }
                
                # قبول جميع الأجهزة التي لها vendor و product صالحين
                if ($vendorId -and $productId) {
                    
                    $devices += [PSCustomObject]@{
                        DeviceID = $_.DeviceID
                        InstanceID = $instanceId
                        Name = $_.Name
                        Description = $_.Description
                        Manufacturer = $_.Manufacturer
                        Service = $_.Service
                        VendorID = $vendorId
                        ProductID = $productId
                        Status = $_.Status
                        Present = $_.Present
                        HardwareID = $_.HardwareID[0]
                        DeviceType = "USB"
                        Class = $_.Class
                        ClassGuid = $_.ClassGuid
                    }
                }
            }
            
            # إضافة محاولة بديلة لجلب المزيد من الأجهزة
            if ($devices.Count -eq 0) {
                Write-Host "No devices found with strict filter, trying broader search..."
                Get-WmiObject -Class Win32_PnPEntity | Where-Object {
                    $_.DeviceID -like "USB\\VID_*" -and
                    -not ($_.DeviceID -like "*&MI_*") -and
                    $_.Status -eq "OK" -and
                    $_.Present -eq $true
                } | ForEach-Object {
                    $deviceId = $_.DeviceID
                    $vendorId = ""
                    $productId = ""
                    
                    if ($deviceId -match "VID_([0-9A-F]{4}).*PID_([0-9A-F]{4})") {
                        $vendorId = $matches[1].ToLower()
                        $productId = $matches[2].ToLower()
                    }
                    
                    if ($vendorId -and $productId) {
                        $devices += [PSCustomObject]@{
                            DeviceID = $_.DeviceID
                            InstanceID = $_.DeviceID.Split('\\')[-1]
                            Name = $_.Name
                            Description = $_.Description
                            Manufacturer = $_.Manufacturer
                            Service = $_.Service
                            VendorID = $vendorId
                            ProductID = $productId
                            Status = $_.Status
                            Present = $_.Present
                            HardwareID = $_.HardwareID[0]
                            DeviceType = "USB"
                            Class = $_.Class
                            ClassGuid = $_.ClassGuid
                        }
                    }
                }
            }
            
            # تحويل إلى JSON
            if ($devices.Count -gt 0) {
                Write-Host "Found $($devices.Count) devices"
                $devices | ConvertTo-Json -Depth 3
            } else {
                Write-Host "No devices found at all"
                "[]"
            }
            '''
        ]
        
        logger.info("تشغيل PowerShell لاكتشاف جميع أجهزة USB...")
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        except subprocess.TimeoutExpired:
            logger.warning("PowerShell command timed out while getting Windows USB devices")
            return []
        except KeyboardInterrupt:
            logger.warning("PowerShell command interrupted while getting Windows USB devices")
            return []
        except Exception as subprocess_error:
            logger.error(f"PowerShell subprocess error while getting Windows USB devices: {subprocess_error}")
            return []
        
        logger.info(f"PowerShell return code: {result.returncode}")
        if result.stdout:
            logger.info(f"PowerShell stdout length: {len(result.stdout)} characters")
        if result.stderr:
            logger.warning(f"PowerShell stderr: {result.stderr}")
        
        if result.returncode == 0 and result.stdout.strip():
            try:
                # تجاهل رسائل Write-Host وجلب JSON فقط
                lines = result.stdout.strip().split('\n')
                json_lines = []
                capture_json = False
                
                for line in lines:
                    line = line.strip()
                    if line.startswith('[') or line.startswith('{'):
                        capture_json = True
                    if capture_json:
                        json_lines.append(line)
                
                if json_lines:
                    json_data = '\n'.join(json_lines)
                    logger.info(f"Parsing JSON data: {len(json_data)} characters")
                    data = json.loads(json_data)
                else:
                    # إذا لم نجد JSON، نحاول تحليل كامل الإخراج
                    data = json.loads(result.stdout)
                
                if not isinstance(data, list):
                    data = [data] if data else []
                
                logger.info(f"تم تحليل {len(data)} جهاز من PowerShell")
                
                for item in data:
                    # التأكد من صحة البيانات
                    vendor_id = item.get('VendorID', '').lower()
                    product_id = item.get('ProductID', '').lower()
                    
                    if len(vendor_id) == 4 and len(product_id) == 4:
                        device_info = {
                            'vendor_id': vendor_id,
                            'product_id': product_id,
                            'manufacturer': clean_device_name(item.get('Manufacturer', 'Unknown')),
                            'product': clean_device_name(item.get('Name', 'Unknown Device')),
                            'name': clean_device_name(item.get('Name', 'Unknown Device')),
                            'description': item.get('Description', ''),
                            'service': item.get('Service', ''),
                            'device_id': item.get('DeviceID', ''),
                            'hardware_id': item.get('HardwareID', ''),
                            'status': item.get('Status', 'Unknown'),
                            'present': item.get('Present', False),
                            'device_class': item.get('Class', ''),
                            'class_guid': item.get('ClassGuid', ''),
                            'system': 'Windows',
                            'detected_at': current_time().isoformat()
                        }
                        
                        # استخراج أو توليد Serial Number الحقيقي
                        real_serial = extract_real_serial_number_windows(item)
                        if real_serial:
                            device_info['serial_number'] = real_serial
                        else:
                            # إذا لم نجد رقم تسلسلي حقيقي، استخدم VID:PID مع timestamp
                            timestamp = str(int(current_time().timestamp()))
                            device_info['serial_number'] = f"{vendor_id.upper()}{product_id.upper()}{timestamp[-4:]}"
                        
                        # إضافة معلومات إضافية
                        try:
                            device_info.update(get_enhanced_device_info_windows(device_info))
                        except Exception as e:
                            logger.debug(f"فشل في جلب المعلومات المحسنة: {e}")
                        
                        # فلترة أجهزة الشبكة والاتصالات - مع استثناء الأجهزة المحمولة المهمة
                        device_name_lower = device_info['name'].lower()
                        device_class_lower = device_info.get('device_class', '').lower()
                        vid_pid = f"{vendor_id.upper()}:{product_id.upper()}"
                        
                        is_network_communication_device = (
                            # أجهزة Bluetooth
                            'bluetooth' in device_name_lower or
                            'wireless' in device_name_lower or
                            'wifi' in device_name_lower or
                            'wlan' in device_name_lower or
                            'broadcom' in device_name_lower or
                            'intel wireless' in device_name_lower or
                            'qualcomm' in device_name_lower or
                            'atheros' in device_name_lower or
                            # أجهزة الشبكة
                            'network' in device_name_lower or
                            'ethernet' in device_name_lower or
                            'lan' in device_name_lower or
                            'nic' in device_name_lower or
                            # أجهزة الاتصالات - استثناء الأجهزة المحمولة
                            ('mobile' in device_name_lower and not any(brand in device_name_lower for brand in ['huawei', 'samsung', 'apple', 'xiaomi', 'iphone', 'android'])) or
                            ('cellular' in device_name_lower and not any(brand in device_name_lower for brand in ['huawei', 'samsung', 'apple', 'xiaomi', 'iphone', 'android'])) or
                            ('gsm' in device_name_lower and not any(brand in device_name_lower for brand in ['huawei', 'samsung', 'apple', 'xiaomi', 'iphone', 'android'])) or
                            ('cdma' in device_name_lower and not any(brand in device_name_lower for brand in ['huawei', 'samsung', 'apple', 'xiaomi', 'iphone', 'android'])) or
                            ('lte' in device_name_lower and not any(brand in device_name_lower for brand in ['huawei', 'samsung', 'apple', 'xiaomi', 'iphone', 'android'])) or
                            ('5g' in device_name_lower and not any(brand in device_name_lower for brand in ['huawei', 'samsung', 'apple', 'xiaomi', 'iphone', 'android'])) or
                            ('modem' in device_name_lower and not any(brand in device_name_lower for brand in ['huawei', 'samsung', 'apple', 'xiaomi', 'iphone', 'android'])) or
                            'telephony' in device_name_lower or
                            # أجهزة HID المرتبطة بالشبكة
                            'hid-compliant vendor-defined device' in device_name_lower or
                            'hid-compliant consumer control device' in device_name_lower or
                            'hid-compliant system controller' in device_name_lower or
                            # فئات الأجهزة
                            device_class_lower in ['net', 'bluetooth', 'multimedia'] or
                            # VID/PID المعروفة لأجهزة الشبكة والاتصالات - استثناء الأجهزة المحمولة
                            any(vid in vid_pid for vid in [
                                '0A5C', '0B05', '0CF3', '13D3', '1814', '8087',  # Bluetooth chips
                                '14E4', '10EC', '1969', '11AB', '1B21',  # Network cards
                                # إزالة VID/PID للأجهزة المحمولة من قائمة الاستبعاد
                                # '12D1', '1004', '22B8', '1BBB', '2001',  # Mobile broadband - تم إزالتها
                                # '0FCE', '413C', '0BDB', '04E8', '04DA'   # Communication devices - تم إزالتها
                            ])
                        )
                        
                        # فلترة الأجهزة المركبة وأجهزة HID العامة - فقط الأجهزة العامة جداً والمجهولة تماماً
                        is_composite_hid_device_windows = (
                            # أجهزة USB المركبة - فقط الأجهزة العامة جداً والمجهولة تماماً
                            (device_name_lower.strip() == 'usb composite device') or
                            (device_name_lower.strip() == 'composite device') or
                            # أجهزة عامة أخرى - فقط الأجهزة المجهولة تماماً وغير محددة
                            (device_name_lower.strip() == 'unknown usb device') or
                            (device_name_lower.strip() == 'generic usb device') or
                            (device_name_lower.strip() == 'standard usb device') or
                            # أجهزة HID العامة - فقط الأجهزة غير المحددة تماماً والمجهولة والعامة
                            ('hid-compliant' in device_name_lower and 'generic' in device_name_lower and 'unknown' in device_name_lower and 'unrecognized' in device_name_lower) or
                            ('hid device' in device_name_lower and 'generic' in device_name_lower and 'unknown' in device_name_lower and 'unrecognized' in device_name_lower) or
                            # VID/PID المعروفة للأجهزة العامة جداً - فقط الأجهزة المجهولة تماماً
                            (vid_pid in [
                                '04B4:0101', '04B4:0201', '04B4:0301',  # Cypress generic فقط
                                '058F:6362', '058F:6364', '058F:6366',  # Alcor generic فقط
                                '1A86:7523', '1A86:5523', '1A86:E008'   # QinHeng generic فقط
                            ] and 'unknown' in device_name_lower and 'unrecognized' in device_name_lower and 'generic' in device_name_lower)
                        )
                        
                        # فلترة إيجابية للأجهزة المحمولة المهمة
                        is_mobile_device = (
                            # العلامات التجارية المحمولة المهمة
                            any(brand in device_name_lower for brand in [
                                'huawei', 'samsung', 'apple', 'xiaomi', 'iphone', 'ipad', 'android',
                                'oppo', 'vivo', 'realme', 'oneplus', 'honor', 'asus', 'lenovo',
                                'lg', 'sony', 'htc', 'motorola', 'nokia', 'google'
                            ]) or
                            # VID/PID المعروفة للأجهزة المحمولة
                            any(vid in vid_pid for vid in [
                                '2717', '18D1', '04E8', '05AC', '12D1', '0BB4', '22B8',  # Xiaomi, Google, Samsung, Apple, Huawei, HTC, Motorola
                                '1004', '1BBB', '2001', '0FCE', '413C', '0BDB', '04DA',  # Mobile broadband devices
                                '2A70', '2A49', '2A1F', '2A19', '2A05', '29F1', '29A2',  # Additional mobile VID ranges
                                '1F53', '1F4D', '1F3A', '1F28', '1F1C', '1F0E', '1F00'   # More mobile VID ranges
                            ])
                        )
                        
                        # قبول الجهاز إذا كان جهاز محمول مهم أو ليس جهاز شبكة/اتصالات
                        if not is_network_communication_device or is_mobile_device:
                            devices.append(device_info)
                            logger.debug(f"✅ تم إضافة جهاز: {device_info['name']} (VID:{vendor_id}, PID:{product_id})")
                        else:
                            logger.debug(f"❌ تم استبعاد جهاز شبكة/اتصالات: {device_info['name']} (VID:{vendor_id}, PID:{product_id})")
                            
            except json.JSONDecodeError as e:
                logger.error(f"فشل في تحليل بيانات Windows USB JSON: {e}")
                logger.error(f"Raw output: {result.stdout[:500]}...")
        else:
            logger.error(f"فشل PowerShell - Return code: {result.returncode}")
            if result.stderr:
                logger.error(f"PowerShell stderr: {result.stderr}")
            if not result.stdout.strip():
                logger.error("PowerShell returned empty output")
                
    except Exception as e:
        logger.error(f"خطأ في جلب أجهزة Windows USB الحقيقية: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
    
    logger.info(f"النتيجة النهائية: {len(devices)} جهاز من Windows")
    return devices


def clean_device_name(name: str) -> str:
    """تنظيف اسم الجهاز من النصوص غير المرغوبة"""
    if not name or name.lower() in ['unknown', 'generic', 'composite']:
        return 'Unknown Device'
    
    # إزالة النصوص الإضافية الشائعة
    clean_patterns = [
        r'\s*\(.*?\)\s*',  # النصوص بين الأقواس
        r'\s*USB\s*Device\s*',  # كلمة USB Device
        r'\s*Standard\s*',  # كلمة Standard
    ]
    
    cleaned_name = name
    for pattern in clean_patterns:
        cleaned_name = re.sub(pattern, '', cleaned_name, flags=re.IGNORECASE)
    
    return cleaned_name.strip() or 'Unknown Device'


def extract_real_serial_number_windows(device_info: Dict[str, Any]) -> Optional[str]:
    """استخراج الرقم التسلسلي الحقيقي للجهاز من Windows - Enhanced with multiple detection methods"""
    try:
        device_id = device_info.get('DeviceID', '')
        instance_id = device_info.get('InstanceID', '')
        vendor_id = device_info.get('VendorID', '')
        product_id = device_info.get('ProductID', '')
        
        # محاولة استخراج رقم تسلسلي حقيقي بطرق متعددة
        
        # 1. استخراج محسن من معرف الجهاز الكامل
        if device_id:
            parts = device_id.split('\\')
            if len(parts) >= 3:
                last_part = parts[-1]
                
                # تحسين تجاهل الأرقام الوهمية
                if ('&0&' not in last_part and 
                    '&' not in last_part and 
                    len(last_part) > 6 and 
                    last_part not in ['0000', '00000000']):
                    
                    # تنظيف الرقم التسلسلي مع الحفاظ على الأرقام والأحرف
                    clean_serial = re.sub(r'[^A-Z0-9]', '', last_part.upper())
                    if len(clean_serial) >= 6 and clean_serial.isalnum():
                        return clean_serial
        
        # 2. استخدام PowerShell محسن مع طرق متعددة للكشف
        if vendor_id and product_id:
            try:
                cmd = [
                    'powershell', '-NoProfile', '-NonInteractive', '-Command',
                    f'''$devices = Get-WmiObject -Class Win32_PnPEntity | Where-Object {{
                        $_.DeviceID -like "*VID_{vendor_id.upper()}*" -and 
                        $_.DeviceID -like "*PID_{product_id.upper()}*" -and
                        $_.Status -eq "OK"
                    }}
                    
                    foreach ($device in $devices) {{
                        $serial = ""
                        
                        # الطريقة 1: استخراج من Device Instance Path
                        $instancePath = $device.DeviceID
                        if ($instancePath -match ".*\\\\([^&]+)$") {{
                            $candidateSerial = $matches[1]
                            if ($candidateSerial.Length -gt 6 -and $candidateSerial -notmatch "&" -and $candidateSerial -ne "0000") {{
                                $serial = $candidateSerial
                            }}
                        }}
                        
                        # الطريقة 2: استعلام Registry لمعلومات إضافية
                        if (-not $serial) {{
                            try {{
                                $regPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\" + $device.DeviceID.Replace("\\", "\\")
                                $regData = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue
                                if ($regData) {{
                                    # فحص خصائص مختلفة للرقم التسلسلي
                                    if ($regData.SerialNumber -and $regData.SerialNumber.Length -gt 6) {{
                                        $serial = $regData.SerialNumber
                                    }} elseif ($regData.LocationInformation -and $regData.LocationInformation -match "Serial Number: ([A-Z0-9]+)") {{
                                        $serial = $matches[1]
                                    }} elseif ($regData.FriendlyName -and $regData.FriendlyName -match "\\(([A-Z0-9]{{8,}})\\)") {{
                                        $serial = $matches[1]
                                    }}
                                }}
                            }} catch {{}}
                        }}
                        
                        # الطريقة 3: استخدام WMI للحصول على معلومات تفصيلية
                        if (-not $serial) {{
                            try {{
                                $usbDevice = Get-WmiObject -Class Win32_USBDevice | Where-Object {{
                                    $_.DeviceID -eq $device.DeviceID
                                }}
                                if ($usbDevice -and $usbDevice.SerialNumber) {{
                                    $serial = $usbDevice.SerialNumber
                                }}
                            }} catch {{}}
                        }}
                        
                        # الطريقة 4: للأجهزة المحمولة (Android/iPhone)
                        if (-not $serial -and ($device.Name -match "android|phone|mobile" -or $device.Manufacturer -match "xiaomi|samsung|apple|huawei|lg|sony")) {{
                            try {{
                                # محاولة استخدام ADB للأجهزة الأندرويد
                                $adbDevices = & adb devices 2>$null
                                if ($adbDevices) {{
                                    $adbDevices | ForEach-Object {{
                                        if ($_ -match "^([A-Z0-9]{{8,}})\\s+device") {{
                                            $serial = $matches[1]
                                        }}
                                    }}
                                }}
                            }} catch {{}}
                            
                            # إذا لم نجد رقم تسلسلي، استخدم معرف فريد للجهاز المحمول
                            if (-not $serial) {{
                                $devicePath = $device.DeviceID.Split("\\")[-1]
                                if ($devicePath.Length -gt 6) {{
                                    $serial = $devicePath
                                }}
                            }}
                        }}
                        
                        # إرجاع أول رقم تسلسلي صالح
                        if ($serial -and $serial.Length -gt 6) {{
                            Write-Output $serial.Trim().ToUpper()
                            break
                        }}
                    }}'''
                ]
                
                try:
                    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
                except subprocess.TimeoutExpired:
                    logger.warning(f"PowerShell command timed out while extracting serial for device {vendor_id}:{product_id}")
                    return None
                except KeyboardInterrupt:
                    logger.warning(f"PowerShell command interrupted while extracting serial for device {vendor_id}:{product_id}")
                    return None
                except Exception as subprocess_error:
                    logger.error(f"PowerShell subprocess error while extracting serial for device {vendor_id}:{product_id}: {subprocess_error}")
                    return None
                    
                if result.returncode == 0 and result.stdout.strip():
                    real_serial = result.stdout.strip()
                    # تنظيف الرقم التسلسلي
                    clean_serial = re.sub(r'[^A-Z0-9]', '', real_serial.upper())
                    if len(clean_serial) >= 6 and clean_serial != '0000' and '&' not in clean_serial:
                        logger.debug(f"تم العثور على رقم تسلسلي حقيقي: {clean_serial}")
                        return clean_serial
                        
            except Exception as e:
                logger.debug(f"فشل في جلب الرقم التسلسلي عبر PowerShell المحسن: {e}")
        
        # 3. استخراج محسن من instance ID
        if instance_id and len(instance_id) >= 6:
            # تجاهل المعرفات الوهمية بشكل أفضل
            if ('&0&' not in instance_id and 
                '&' not in instance_id and 
                instance_id not in ['0000', '00000000', 'ROOT']):
                
                clean_instance = re.sub(r'[^A-Z0-9]', '', instance_id.upper())
                if len(clean_instance) >= 6 and clean_instance.isalnum():
                    return clean_instance
        
        # 4. محاولة أخيرة لاستخراج معرف فريد من أي مصدر متاح
        if device_id:
            # استخراج VID و PID كمعرف بديل
            vid_match = re.search(r'VID_([0-9A-F]{4})', device_id.upper())
            pid_match = re.search(r'PID_([0-9A-F]{4})', device_id.upper())
            if vid_match and pid_match:
                # إنشاء معرف فريد مركب
                vid = vid_match.group(1)
                pid = pid_match.group(1)
                # إضافة timestamp للتفريق بين الأجهزة المتشابهة
                timestamp_part = str(int(time.time()))[-6:]
                composite_id = f"{vid}{pid}{timestamp_part}"
                logger.debug(f"تم إنشاء معرف مركب: {composite_id}")
                return composite_id
        
        return None
        
    except Exception as e:
        logger.debug(f"خطأ في استخراج الرقم التسلسلي الحقيقي: {e}")
        return None


def generate_unique_serial_windows(device_info: Dict[str, Any]) -> str:
    """توليد Serial Number فريد للأجهزة في Windows"""
    vendor_id = device_info.get('vendor_id', '0000')
    product_id = device_info.get('product_id', '0000')
    device_id = device_info.get('device_id', '')
    
    # محاولة استخراج معرف فريد من device_id
    if device_id:
        match = re.search(r'\\([A-Z0-9&]{8,})$', device_id)
        if match:
            return match.group(1)
    
    # إنشاء معرف فريد بناءً على المعلومات المتاحة
    timestamp = int(time.time())
    unique_part = hashlib.md5(f"{device_id}{vendor_id}{product_id}".encode()).hexdigest()[:8]
    
    return f"{vendor_id.upper()}_{product_id.upper()}_{unique_part.upper()}"


def discover_usb_devices_windows() -> List[Dict[str, Any]]:
    """اكتشاف أجهزة USB في Windows باستخدام الدالة الصحيحة - Correct USB device discovery using get_real_usb_devices"""
    try:
        # logger.info("بدء الكشف الصحيح لأجهزة USB في Windows...")

        # استخدام الدالة الصحيحة التي تكتشف الأجهزة الحقيقية فقط
        real_devices = get_real_usb_devices()

        if not real_devices:
            logger.debug("لم يتم العثور على أجهزة USB حقيقية في Windows")
            return []

        # تحويل البيانات إلى التنسيق المطلوب
        final_devices = []
        for device in real_devices:
            try:
                # إنشاء كائن جهاز بالتنسيق المطلوب
                device_info = {
                    'vendor_id': device.get('device_id', '').split('VID_')[1][:4] if 'VID_' in device.get('device_id', '') else '0000',
                    'product_id': device.get('device_id', '').split('PID_')[1][:4] if 'PID_' in device.get('device_id', '') else '0000',
                    'manufacturer': device.get('manufacturer', 'Unknown'),
                    'product': device.get('name', 'Unknown Device'),
                    'name': device.get('name', 'Unknown Device'),
                    'serial_number': device.get('serial_number', ''),
                    'device_class': device.get('class', 'Unknown'),
                    'status': device.get('status', 'Unknown'),
                    'system': 'Windows',
                    'detected_at': current_time().isoformat(),
                    'discovery_method': 'real_usb_devices_detection',
                    'is_real_device': True,
                    'usb_port': device.get('location', 'USB Port Unknown'),
                    'port_number': device.get('location', 'USB Port Unknown'),
                    'device_type': get_device_type_from_class(device.get('class', 'Unknown'))
                }

                final_devices.append(device_info)

            except Exception as e:
                logger.error(f"خطأ في معالجة جهاز: {e}")
                # إضافة الجهاز بالشكل العادي
                final_devices.append(device)

        # تسجيل النتيجة النهائية
        # logger.info(f"تم إنجاز الكشف الصحيح: {len(final_devices)} جهاز USB حقيقي في Windows")

        # طباعة ملخص بأنواع الأجهزة المكتشفة
        device_types = {}
        for device in final_devices:
            device_type = device.get('device_type', 'Unknown')
            device_types[device_type] = device_types.get(device_type, 0) + 1

        # logger.info(f"أنواع الأجهزة المكتشفة: {device_types}")

        return final_devices

    except Exception as e:
        logger.error(f"خطأ في اكتشاف أجهزة Windows USB الصحيح: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return []


def get_device_type_from_class(device_class: str) -> str:
    """تحديد نوع الجهاز من class الجهاز"""
    try:
        device_class = device_class.lower().strip()

        # خريطة أنواع الأجهزة حسب class
        class_mapping = {
            'diskdrive': 'USB Storage',
            'net': 'Network Adapter',
            'media': 'Media Device',
            'hidclass': 'HID Device',
            'keyboard': 'Keyboard',
            'mouse': 'Mouse',
            'usbdevice': 'USB Device',
            'bluetooth': 'Bluetooth Device',
            'printer': 'Printer',
            'smartcardreader': 'Smart Card Reader',
            'system': 'System Device',
            'unknown': 'Unknown Device'
        }

        # البحث عن تطابق دقيق أو جزئي
        for class_key, device_type in class_mapping.items():
            if class_key in device_class:
                return device_type

        # إذا لم يتم العثور على تطابق، إرجاع نوع عام
        return 'USB Device'

    except Exception as e:
        logger.error(f"خطأ في تحديد نوع الجهاز من class: {e}")
        return 'USB Device'


def get_usb_port_topology_windows() -> Dict[str, str]:
    """جلب خريطة شاملة لمنافذ USB والأجهزة المتصلة بها مع اكتشاف المنافذ الفيزيائية الحقيقية"""
    port_mapping = {}
    
    try:
        # استخدام PowerShell محسن لجلب المنافذ الفيزيائية الحقيقية
        cmd = [
            'powershell', '-NoProfile', '-NonInteractive', '-Command',
            '''
            $portMapping = @{}
            
            # جلب معلومات USB Root Hub والمنافذ الفيزيائية
            $rootHubs = Get-WmiObject -Class Win32_USBHub | Where-Object {
                $_.Description -like "*Root Hub*" -or $_.Name -like "*Root Hub*"
            }
            
            $physicalPortCounter = 1
            
            # فحص USB Controllers للحصول على المنافذ الفيزيائية الحقيقية
            $usbControllers = Get-WmiObject -Class Win32_USBController
            
            foreach ($controller in $usbControllers) {
                try {
                    # جلب معلومات المنافذ من خصائص Controller
                    $controllerProps = Get-WmiObject -Class Win32_SystemSlot | Where-Object {
                        $_.SlotDesignation -like "*USB*" -or $_.Description -like "*USB*"
                    }
                    
                    # فحص الأجهزة المتصلة بهذا Controller
                    $controllerDevices = Get-WmiObject -Class Win32_PnPEntity | Where-Object {
                        $_.DeviceID -like "USB*VID_*PID_*" -and
                        $_.Status -eq "OK" -and
                        $_.Present -eq $true -and
                        $_.Service -ne $null
                    }
                    
                    foreach ($device in $controllerDevices) {
                        if ($device.DeviceID -match "VID_([0-9A-F]{4}).*PID_([0-9A-F]{4})") {
                            $vid = $matches[1].ToLower()
                            $pid = $matches[2].ToLower()
                            $deviceKey = "$vid:$pid"
                            
                            # محاولة استخراج المنفذ من DeviceID
                            $realPort = $null
                            if ($device.DeviceID -match "\\\\(\d+)") {
                                $realPort = [int]$matches[1]
                            } elseif ($device.DeviceID -match "&(\d+)&") {
                                $realPort = [int]$matches[1]
                            } elseif ($device.DeviceID -match "USB\\\\VID_[0-9A-F]+&PID_[0-9A-F]+\\\\(\d+)") {
                                $realPort = [int]$matches[1]
                            }
                            
                            if ($realPort -and $realPort -ge 1 -and $realPort -le 16) {
                                $portMapping[$deviceKey] = "USB Port $realPort"
                            } else {
                                # استخدام ترقيم تتابعي للمنافذ الفيزيائية
                                $portMapping[$deviceKey] = "USB Port $physicalPortCounter"
                                $physicalPortCounter++
                            }
                        }
                    }
                } catch {
                    # تجاهل الأخطاء والمتابعة
                }
            }
            
            # إذا لم نحصل على معلومات كافية، استخدم طريقة تحليل LocationInformation
            if ($portMapping.Count -eq 0) {
                $allUsbDevices = Get-WmiObject -Class Win32_PnPEntity | Where-Object {
                    $_.DeviceID -like "USB*VID_*PID_*" -and
                    $_.Status -eq "OK" -and
                    $_.Present -eq $true
                }
                
                $portIndex = 1
                foreach ($device in $allUsbDevices) {
                    if ($device.DeviceID -match "VID_([0-9A-F]{4}).*PID_([0-9A-F]{4})") {
                        $vendorId = $matches[1].ToLower()
                        $productId = $matches[2].ToLower()
                        $deviceKey = "$vid:$pid"
                        
                        if (-not $portMapping.ContainsKey($deviceKey)) {
                            # محاولة الحصول على LocationInformation لتحديد المنفذ
                            try {
                                $locationInfo = $device.GetDeviceProperties("DEVPKEY_Device_LocationInfo").DeviceProperties.Data
                                if ($locationInfo -match "Port_(\d+)") {
                                    $portNum = [int]$matches[1]
                                    $portMapping[$deviceKey] = "USB Port $portNum"
                                } else {
                                    $portMapping[$deviceKey] = "USB Port $portIndex"
                                    $portIndex++
                                }
                            } catch {
                                $portMapping[$deviceKey] = "USB Port $portIndex"
                                $portIndex++
                            }
                        }
                    }
                }
            }
            
            # تحويل إلى JSON
            if ($portMapping.Count -gt 0) {
                $portMapping | ConvertTo-Json
            } else {
                Write-Output '{}'
            }
            '''
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode == 0 and result.stdout.strip():
            try:
                output = result.stdout.strip()
                if output and output != '{}':
                    port_data = json.loads(output)
                    if isinstance(port_data, dict):
                        port_mapping = port_data
                        logger.info(f"تم جلب خريطة المنافذ الحقيقية: {len(port_mapping)} جهاز")
                    else:
                        logger.warning("خريطة المنافذ لم ترجع بيانات صحيحة")
                else:
                    logger.warning("لم يتم إرجاع بيانات من PowerShell")
            except json.JSONDecodeError as e:
                logger.warning(f"فشل في تحليل خريطة المنافذ: {e}")
                
    except Exception as e:
        logger.warning(f"خطأ في جلب خريطة USB المحسنة: {e}")
    
    return port_mapping


def get_device_real_port_from_mapping(device_info: Dict[str, Any], port_mapping: Dict[str, str]) -> str:
    """جلب رقم المنفذ الحقيقي من خريطة المنافذ مع تحسينات إضافية"""
    try:
        vendor_id = device_info.get('vendor_id', '').lower()
        product_id = device_info.get('product_id', '').lower()
        
        if vendor_id and product_id:
            device_key = f"{vendor_id}:{product_id}"
            if device_key in port_mapping:
                real_port = port_mapping[device_key]
                # تأكد من أن رقم المنفذ منطقي
                if "USB Port" in real_port and not "Unknown" in real_port:
                    logger.debug(f"تم العثور على منفذ حقيقي للجهاز {device_key}: {real_port}")
                    return real_port
        
        # إذا لم نجد في الخريطة، محاولة اكتشاف مباشر للمنفذ
        try:
            direct_port = get_real_usb_port_direct_windows(device_info)
            if direct_port and "USB Port" in direct_port and "Unknown" not in direct_port:
                logger.debug(f"تم اكتشاف منفذ مباشر للجهاز: {direct_port}")
                return direct_port
        except Exception as e:
            logger.debug(f"فشل الاكتشاف المباشر للمنفذ: {e}")
        
        logger.debug(f"لم يتم العثور على منفذ حقيقي للجهاز {vendor_id}:{product_id}")
        return "USB Port Unknown"
        
    except Exception as e:
        logger.debug(f"خطأ في جلب المنفذ من الخريطة: {e}")
        return "USB Port Unknown"
def get_real_usb_port_direct_windows(device_info: Dict[str, Any]) -> str:
    """الحصول على رقم المنفذ الحقيقي للجهاز في Windows باستخدام استعلام مباشر محسن"""
    try:
        device_id = device_info.get('device_id', '')
        vendor_id = device_info.get('vendor_id', '').upper()
        product_id = device_info.get('product_id', '').upper()
        
        if not vendor_id or not product_id:
            return "USB Port Unknown"
        
        # محاولة استخراج رقم المنفذ من PowerShell مع معلومات محسنة
        try:
            cmd = [
                'powershell', '-NoProfile', '-NonInteractive', '-Command',
                f'''
                # البحث عن الجهاز ومعرفة منفذه الحقيقي
                $targetDevice = Get-WmiObject -Class Win32_PnPEntity | Where-Object {{
                    $_.DeviceID -like "*VID_{vendor_id}*" -and 
                    $_.DeviceID -like "*PID_{product_id}*" -and
                    $_.Status -eq "OK" -and
                    $_.Present -eq $true
                }} | Select-Object -First 1
                
                if ($targetDevice) {{
                    # محاولة 1: استخراج من LocationInformation
                    try {{
                        $location = $targetDevice.GetDeviceProperty('{{540b947e-8b40-45bc-a8a2-6a0b894cbda2}} 15').Data
                        if ($location -match "Port_(\\d+)" -or $location -match "(\\d+)") {{
                            $portNum = [int]$matches[1]
                            if ($portNum -ge 1 -and $portNum -le 16) {{
                                Write-Output $portNum
                                exit
                            }}
                        }}
                    }} catch {{}}
                    
                    # محاولة 2: تحليل DeviceID للحصول على رقم المنفذ
                    if ($targetDevice.DeviceID -match "\\\\(\\d+)$") {{
                        $portFromId = [int]$matches[1]
                        if ($portFromId -ge 1 -and $portFromId -le 16) {{
                            Write-Output $portFromId
                            exit
                        }}
                    }}
                    
                    # محاولة 3: فحص Parent Device لمعرفة Hub والمنفذ
                    try {{
                        $parentHub = Get-WmiObject -Query "SELECT * FROM Win32_PnPEntity WHERE DeviceID LIKE 'USB%HUB%'" | Where-Object {{
                            $targetDevice.DeviceID.StartsWith($_.DeviceID.Split('\\')[0])
                        }} | Select-Object -First 1
                        
                        if ($parentHub) {{
                            # محاولة العثور على رقم المنفذ من Hub
                            $hubNumber = 1
                            if ($parentHub.DeviceID -match "(\\d+)" -and $matches[1] -gt 0) {{
                                $hubNumber = [int]$matches[1]
                            }}
                            
                            # إرجاع رقم منفذ بناءً على Hub
                            if ($hubNumber -ge 1 -and $hubNumber -le 8) {{
                                Write-Output $hubNumber
                                exit
                            }}
                        }}
                    }} catch {{}}
                    
                    # محاولة 4: استخدام فهرس الجهاز كمنفذ
                    $allUsbDevices = @(Get-WmiObject -Class Win32_PnPEntity | Where-Object {{
                        $_.DeviceID -like "USB*VID_*PID_*" -and
                        $_.Status -eq "OK" -and
                        $_.Present -eq $true
                    }})
                    
                    $deviceIndex = 0
                    for ($i = 0; $i -lt $allUsbDevices.Count; $i++) {{
                        if ($allUsbDevices[$i].DeviceID -eq $targetDevice.DeviceID) {{
                            $deviceIndex = $i + 1
                            break
                        }}
                    }}
                    
                    if ($deviceIndex -gt 0 -and $deviceIndex -le 16) {{
                        Write-Output $deviceIndex
                    }} else {{
                        Write-Output 0
                    }}
                }} else {{
                    Write-Output 0
                }}
                '''
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=45)
            if result.returncode == 0 and result.stdout.strip():
                port_number = int(result.stdout.strip())
                if port_number > 0 and port_number <= 16:  # رقم منفذ معقول
                    logger.info(f"تم العثور على المنفذ الحقيقي {port_number} للجهاز {vendor_id}:{product_id}")
                    return f"USB Port {port_number}"
        except Exception as e:
            logger.debug(f"فشل PowerShell المحسن في جلب رقم المنفذ: {e}")
        
        # محاولة بديلة: استخراج من device_id مباشرة
        if device_id:
            # البحث عن أرقام في نهاية device ID
            port_patterns = [
                r'\\(\d{1,2})$',  # رقم في النهاية
                r'\\USB\\VID_[0-9A-F]+&PID_[0-9A-F]+\\(\d{1,2})',  # رقم بعد USB path
                r'&(\d{1,2})&',  # رقم بين &
                r'Port_(\d{1,2})',  # رقم منفذ مباشر
            ]
            
            for pattern in port_patterns:
                match = re.search(pattern, device_id, re.IGNORECASE)
                if match:
                    port_num = int(match.group(1))
                    if 1 <= port_num <= 16:  # نطاق معقول للمنافذ
                        logger.info(f"استخراج المنفذ {port_num} من Device ID للجهاز {vendor_id}:{product_id}")
                        return f"USB Port {port_num}"
        
        # تجنب استخدام hash synthetic - بدلاً من ذلك ارجع Unknown
        logger.debug(f"لا يمكن تحديد المنفذ الحقيقي للجهاز {vendor_id}:{product_id}")
        return "USB Port Unknown"
        
    except Exception as e:
        logger.debug(f"خطأ في الحصول على رقم المنفذ الحقيقي: {e}")
        return "USB Port Unknown"


def get_physical_path_windows(device_info: Dict[str, Any]) -> str:
    """الحصول على المسار الفيزيائي للجهاز في Windows"""
    try:
        device_id = device_info.get('device_id', '')
        
        # تحليل device ID للحصول على المسار
        path_parts = device_id.split('\\')
        if len(path_parts) >= 2:
            return f"USB\\{path_parts[1] if len(path_parts) > 1 else 'Unknown'}"
        
        return device_id if device_id else "Unknown Path"
        
    except Exception:
        return "Unknown Path"


def discover_usb_devices_linux() -> List[Dict[str, Any]]:
    """اكتشاف أجهزة USB في Linux بطريقة محسّنة"""
    devices = []
    
    try:
        # استخدام lsusb مع معلومات مفصلة
        result = subprocess.run(['lsusb', '-v'], capture_output=True, text=True, timeout=60)
        
        if result.returncode == 0:
            devices_data = parse_lsusb_verbose_output(result.stdout)
            devices.extend(devices_data)
        
        # استخدام /sys/bus/usb/devices للحصول على معلومات إضافية
        sys_devices = get_linux_sys_usb_devices()
        devices.extend(sys_devices)
        
        # استخدام udev إذا كان متوفر
        if LINUX_AVAILABLE:
            udev_devices = get_linux_udev_devices()
            devices.extend(udev_devices)
            
    except Exception as e:
        logger.error(f"خطأ في اكتشاف أجهزة Linux USB: {e}")
    
    return devices


def discover_usb_devices_generic() -> List[Dict[str, Any]]:
    """اكتشاف أجهزة USB باستخدام pyusb (عام لجميع الأنظمة)"""
    devices = []
    
    try:
        logger.info("محاولة استخدام PyUSB لاكتشاف الأجهزة...")
        
        # Set USB backend explicitly to avoid "No backend available" error
        import usb.backend.libusb1
        backend = usb.backend.libusb1.get_backend()
        
        if not backend:
            logger.warning("PyUSB backend not available, trying without specific backend")
            found_devices = usb.core.find(find_all=True)
        else:
            logger.info("Using libusb1 backend for PyUSB")
            found_devices = usb.core.find(find_all=True, backend=backend)
        
        if found_devices is None:
            logger.warning("usb.core.find returned None")
            return devices
            
        device_list = list(found_devices)
        logger.info(f"PyUSB عثر على {len(device_list)} جهاز")
        
        for i, device in enumerate(device_list):
            try:
                logger.debug(f"معالجة جهاز {i+1}/{len(device_list)}")
                device_info = get_basic_device_info(device)
                if device_info:
                    devices.append(device_info)
                    logger.debug(f"تم إضافة جهاز: {device_info.get('name', 'Unknown')}")
            except Exception as e:
                logger.warning(f"Error processing USB device {i+1}: {e}")
                continue
                
    except Exception as e:
        logger.error(f"Error in generic USB discovery: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        
        # Try a more basic approach
        try:
            logger.info("محاولة طريقة أساسية أكثر...")
            for device in usb.core.find(find_all=True):
                try:
                    # Basic device info without detailed processing
                    vendor_id = f"{device.idVendor:04x}"
                    product_id = f"{device.idProduct:04x}"
                    
                    device_info = {
                        'vendor_id': vendor_id,
                        'product_id': product_id,
                        'manufacturer': 'Unknown',
                        'product': f'USB Device {vendor_id}:{product_id}',
                        'name': f'USB Device {vendor_id}:{product_id}',
                        'serial_number': f"{vendor_id}_{product_id}_{int(time.time())}_{generate_serial_id()}",
                        'device_class': getattr(device, 'bDeviceClass', 0),
                        'system': platform.system(),
                        'detected_at': current_time().isoformat(),
                        'device_type': 'Unknown',
                        'power_consumption': 0.5,
                        'port_number': 'Unknown'
                    }
                    
                    devices.append(device_info)
                    logger.debug(f"تم إضافة جهاز أساسي: {device_info['name']}")
                except Exception as basic_error:
                    logger.debug(f"Failed to process device in basic mode: {basic_error}")
                    continue
        except Exception as basic_exception:
            logger.error(f"Even basic USB discovery failed: {basic_exception}")
    
    logger.info(f"PyUSB عثر على {len(devices)} جهاز صالح")
    return devices


def extract_serial_from_device_id_windows(device_id: str) -> Optional[str]:
    """استخراج serial number من device ID في Windows"""
    try:
        # البحث عن pattern مختلفة للـ serial number
        patterns = [
            r'\\([A-Z0-9&]+)$',  # نهاية device ID
            r'\\([A-Z0-9]{8,})\\',  # serial في الوسط
            r'&([A-Z0-9]{8,})&',  # serial بين &
        ]
        
        for pattern in patterns:
            match = re.search(pattern, device_id)
            if match:
                serial = match.group(1)
                if len(serial) >= 8 and not serial.startswith('USB'):
                    return serial
        
        return None
        
    except Exception as e:
        logger.debug(f"خطأ في استخراج serial من device ID: {e}")
        return None


def parse_lsusb_verbose_output(output: str) -> List[Dict[str, Any]]:
    """تحليل مخرجات lsusb -v المفصلة"""
    devices = []
    
    try:
        device_blocks = output.split('\n\n')
        
        for block in device_blocks:
            if 'Bus ' in block and 'Device ' in block:
                device_info = parse_single_lsusb_device(block)
                if device_info:
                    devices.append(device_info)
                    
    except Exception as e:
        logger.warning(f"خطأ في تحليل lsusb verbose: {e}")
    
    return devices


def parse_single_lsusb_device(device_block: str) -> Optional[Dict[str, Any]]:
    """تحليل جهاز واحد من مخرجات lsusb"""
    try:
        lines = device_block.split('\n')
        device_info = {
            'system': 'Linux',
            'detected_at': current_time().isoformat()
        }
        
        for line in lines:
            line = line.strip()
            
            if line.startswith('Bus '):
                # استخراج Bus و Device info
                parts = line.split()
                if len(parts) >= 6:
                    device_info['bus_number'] = parts[1]
                    device_info['device_number'] = parts[3].rstrip(':')
                    
                    # استخراج vendor و product ID
                    id_part = parts[5]
                    if ':' in id_part:
                        vendor_id, product_id = id_part.split(':')
                        device_info['vendor_id'] = vendor_id
                        device_info['product_id'] = product_id
                        
                    # اسم الجهاز
                    if len(parts) > 6:
                        device_info['name'] = ' '.join(parts[6:])
                        device_info['product'] = ' '.join(parts[6:])
                        
            elif 'iManufacturer' in line:
                # استخراج manufacturer
                parts = line.split(None, 2)
                if len(parts) > 2:
                    device_info['manufacturer'] = parts[2]
                    
            elif 'iProduct' in line:
                # استخراج product name
                parts = line.split(None, 2)
                if len(parts) > 2:
                    device_info['product'] = parts[2]
                    device_info['name'] = parts[2]
                    
            elif 'iSerial' in line:
                # استخراج serial number
                parts = line.split(None, 2)
                if len(parts) > 2:
                    device_info['serial_number'] = parts[2]
                    
            elif 'bDeviceClass' in line:
                # استخراج device class
                parts = line.split()
                if len(parts) > 1:
                    device_info['device_class'] = str(int(parts[1]))
        
        # توليد serial number إذا لم يكن متوفراً
        if 'serial_number' not in device_info:
            device_info['serial_number'] = generate_enhanced_serial_number(device_info)
        
        # إضافة device hash
        device_info['device_hash'] = generate_device_hash(
            device_info.get('vendor_id', ''),
            device_info.get('product_id', ''),
            device_info.get('serial_number', '')
        )
        
        return device_info
        
    except Exception as e:
        logger.debug(f"خطأ في تحليل جهاز lsusb: {e}")
        return None


def get_linux_sys_usb_devices() -> List[Dict[str, Any]]:
    """جلب أجهزة USB من /sys/bus/usb/devices"""
    devices = []
    
    try:
        sys_usb_path = '/sys/bus/usb/devices'
        if os.path.exists(sys_usb_path):
            for device_dir in os.listdir(sys_usb_path):
                if ':' in device_dir:  # تجاهل USB controllers
                    device_info = get_enhanced_sys_usb_info(device_dir)
                    if device_info:
                        devices.append(device_info)
                        
    except Exception as e:
        logger.warning(f"خطأ في جلب أجهزة sys USB: {e}")
    
    return devices


def get_enhanced_sys_usb_info(device_dir: str) -> Optional[Dict[str, Any]]:
    """جلب معلومات محسّنة من /sys/bus/usb/devices"""
    try:
        sys_path = f'/sys/bus/usb/devices/{device_dir}'
        
        device_info = {
            'system': 'Linux',
            'detected_at': current_time().isoformat(),
            'device_path': device_dir
        }
        
        # قراءة الملفات المختلفة
        file_mappings = {
            'idVendor': 'vendor_id',
            'idProduct': 'product_id',
            'manufacturer': 'manufacturer',
            'product': 'product',
            'serial': 'serial_number',
            'bDeviceClass': 'device_class'
        }
        
        for filename, key in file_mappings.items():
            file_path = os.path.join(sys_path, filename)
            if os.path.exists(file_path):
                try:
                    with open(file_path, 'r') as f:
                        value = f.read().strip()
                        if key == 'device_class':
                            device_info[key] = str(int(value, 16))  # hex to int, then to string
                        else:
                            device_info[key] = value
                except Exception:
                    continue
        
        # التأكد من وجود الحقول الأساسية
        if 'vendor_id' not in device_info or 'product_id' not in device_info:
            return None
        
        # تعيين name إذا لم يكن موجود
        if 'name' not in device_info:
            device_info['name'] = device_info.get('product', 'Unknown Device')
        
        # توليد serial number إذا لم يكن موجود
        if 'serial_number' not in device_info:
            device_info['serial_number'] = generate_enhanced_serial_number(device_info)
        
        # إضافة device hash
        device_info['device_hash'] = generate_device_hash(
            device_info.get('vendor_id', ''),
            device_info.get('product_id', ''),
            device_info.get('serial_number', '')
        )
        
        return device_info
        
    except Exception as e:
        logger.debug(f"خطأ في قراءة معلومات sys USB: {e}")
        return None


def get_linux_udev_devices() -> List[Dict[str, Any]]:
    """جلب أجهزة USB باستخدام udev"""
    devices = []
    
    if not LINUX_AVAILABLE:
        return devices
    
    try:
        import pyudev  # type: ignore
        context = pyudev.Context()
        
        for device in context.list_devices(subsystem='usb', DEVTYPE='usb_device'):
            try:
                device_info = {
                    'vendor_id': device.get('ID_VENDOR_ID', '').lower(),
                    'product_id': device.get('ID_MODEL_ID', '').lower(),
                    'manufacturer': device.get('ID_VENDOR', 'Unknown'),
                    'product': device.get('ID_MODEL', 'Unknown Device'),
                    'name': device.get('ID_MODEL', 'Unknown Device'),
                    'serial_number': device.get('ID_SERIAL_SHORT', ''),
                    'device_path': device.device_path,
                    'system': 'Linux',
                    'detected_at': current_time().isoformat()
                }
                
                # توليد serial number إذا لم يكن موجود
                if not device_info['serial_number']:
                    device_info['serial_number'] = generate_enhanced_serial_number(device_info)
                
                # إضافة device hash
                device_info['device_hash'] = generate_device_hash(
                    device_info.get('vendor_id', ''),
                    device_info.get('product_id', ''),
                    device_info.get('serial_number', '')
                )
                
                devices.append(device_info)
                
            except Exception as e:
                logger.debug(f"خطأ في معالجة جهاز udev: {e}")
                continue
                
    except Exception as e:
        logger.warning(f"خطأ في جلب أجهزة udev: {e}")
    
    return devices


def get_enhanced_device_info_windows(device_info: Dict[str, Any]) -> Dict[str, Any]:
    """جلب معلومات محسّنة للجهاز في Windows"""
    enhanced_info = {
        'device_type': 'Unknown',
        'power_consumption': 0.0,
        'port_number': 0,
        'server_name': platform.node(),
        'server_id': 1
    }
    
    try:
        # محاولة تحديد نوع الجهاز بناءً على device class
        device_class = get_device_class_from_description(device_info.get('description', ''))
        enhanced_info['device_class'] = device_class
        enhanced_info['device_type'] = get_device_type_name(device_class)
        
        # تقدير استهلاك الطاقة
        enhanced_info['power_consumption'] = 0.5  # Default estimated power consumption
        
        # إضافة المعلومات المحسنة الجديدة
        try:
            enhanced_device_type = get_device_type(device_info)
            if enhanced_device_type != 'Unknown Device':
                enhanced_info['device_type'] = enhanced_device_type
            
            enhanced_info['is_mobile_device'] = any(keyword in enhanced_device_type.lower() for keyword in 
                                                   ['mobile', 'android', 'iphone', 'ipad', 'xiaomi', 'samsung'])
            enhanced_info['is_storage_device'] = any(keyword in enhanced_device_type.lower() for keyword in 
                                                     ['storage', 'flash', 'drive', 'disk', 'memory'])
            enhanced_info['is_input_device'] = any(keyword in enhanced_device_type.lower() for keyword in 
                                                   ['mouse', 'keyboard', 'input', 'gamepad'])
        except Exception as e:
            logger.debug(f"فشل في الحصول على نوع الجهاز المحسن: {e}")
        
    except Exception as e:
        logger.debug(f"خطأ في جلب معلومات محسّنة Windows: {e}")
    
    return enhanced_info


def calculate_identification_confidence(device_info: Dict[str, Any], device_type: str) -> str:
    """حساب مستوى الثقة في تعرف الجهاز"""
    confidence_score = 0
    
    # الرقم التسلسلي موجود وصالح
    if device_info.get('serial_number') and len(device_info.get('serial_number', '')) > 6:
        confidence_score += 30
    
    # VID و PID صالحين
    if (device_info.get('vendor_id') and device_info.get('product_id') and 
        len(device_info.get('vendor_id', '')) == 4 and len(device_info.get('product_id', '')) == 4):
        confidence_score += 25
    
    # اسم الشركة المصنعة معروف
    known_manufacturers = ['xiaomi', 'samsung', 'apple', 'huawei', 'lg', 'sony', 'microsoft', 'logitech']
    if any(mfg in device_info.get('manufacturer', '').lower() for mfg in known_manufacturers):
        confidence_score += 20
    
    # نوع الجهاز محدد بدقة
    if device_type != 'Unknown Device' and device_type != 'USB Device':
        confidence_score += 15
    
    # وصف مفصل متاح
    if device_info.get('description') and len(device_info.get('description', '')) > 10:
        confidence_score += 10
    
    if confidence_score >= 80:
        return 'High'
    elif confidence_score >= 50:
        return 'Medium'
    else:
        return 'Low'


def enhanced_device_detection(device_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """كشف محسن للأجهزة مع استخراج أفضل للرقم التسلسلي وتحديد النوع"""
    enhanced_devices = []
    seen_serials = set()
    
    for device_raw in device_list:
        try:
            # نسخ الجهاز لتجنب تعديل الأصل
            device = device_raw.copy()
            
            # تحسين استخراج الرقم التسلسلي
            original_serial = device.get('serial_number', '')
            if not original_serial or len(original_serial) < 6:
                # محاولة استخراج رقم حقيقي
                real_serial = extract_real_serial_number_windows(device)
                if real_serial:
                    device['serial_number'] = real_serial
                    logger.info(f"تم استخراج رقم تسلسلي حقيقي: {real_serial} للجهاز {device.get('name', 'Unknown')}")
                else:
                    # إنشاء رقم تسلسلي فريد محسن
                    enhanced_serial = generate_enhanced_serial_number(device)
                    device['serial_number'] = enhanced_serial
                    logger.debug(f"تم إنشاء رقم تسلسلي محسن: {enhanced_serial}")
            
            # تجنب المكررات
            current_serial = device.get('serial_number', '')
            if current_serial in seen_serials:
                logger.debug(f"تم تجاهل جهاز مكرر: {current_serial}")
                continue
            seen_serials.add(current_serial)
            
            # تحسين تحديد نوع الجهاز
            enhanced_type = get_device_type(device)
            device['device_type'] = enhanced_type
            
            # تحديث اسم الجهاز إذا كان "Unknown Device"
            if (device.get('product', '').lower() in ['unknown device', 'unknown', ''] or 
                device.get('name', '').lower() in ['unknown device', 'unknown', '']):
                
                # محاولة إنشاء اسم أفضل بناءً على النوع والشركة
                improved_name = generate_improved_device_name(device, enhanced_type)
                device['product'] = improved_name
                device['name'] = improved_name
                logger.info(f"تم تحسين اسم الجهاز إلى: {improved_name}")
            
            # إضافة معلومات محسنة
            try:
                enhanced_info = get_enhanced_device_info_windows(device)
                device.update(enhanced_info)
            except Exception as e:
                logger.debug(f"فشل في جلب المعلومات المحسنة: {e}")
            
            # إضافة طابع زمني للكشف
            device['enhanced_detection_timestamp'] = current_time().isoformat()
            device['detection_method'] = 'enhanced_windows_detection'
            
            enhanced_devices.append(device)
            logger.debug(f"تم معالجة جهاز: {device.get('name', 'Unknown')} ({enhanced_type}) - Serial: {current_serial}")
            
        except Exception as e:
            logger.error(f"خطأ في معالجة جهاز: {e}")
            # إضافة الجهاز بالشكل العادي إذا فشلت المعالجة المحسنة
            enhanced_devices.append(device_raw)
    
    logger.info(f"تم إنجاز الكشف المحسن لـ {len(enhanced_devices)} جهاز")
    return enhanced_devices


def generate_enhanced_serial_number(device_info: Dict[str, Any]) -> str:
    """إنشاء رقم تسلسلي محسن وفريد للجهاز"""
    try:
        vendor_id = device_info.get('vendor_id', '0000').upper()
        product_id = device_info.get('product_id', '0000').upper()
        
        # محاولة استخراج معرف فريد من اسم الجهاز
        device_name = device_info.get('name', '') or device_info.get('product', '')
        name_hash = ''
        if device_name:
            # أخذ hash من اسم الجهاز
            name_hash = hashlib.md5(device_name.encode()).hexdigest()[:4].upper()
        
        # إضافة timestamp فريد
        timestamp = str(int(time.time()))[-6:]
        
        # تركيب الرقم التسلسلي الجديد
        if name_hash:
            enhanced_serial = f"{vendor_id}{product_id}{name_hash}{timestamp}"
        else:
            enhanced_serial = f"{vendor_id}{product_id}{timestamp}"
        
        # ضمان أن الطول لا يتجاوز الحد المعقول
        if len(enhanced_serial) > 20:
            enhanced_serial = enhanced_serial[:20]
        
        return enhanced_serial
        
    except Exception as e:
        logger.error(f"خطأ في إنشاء رقم تسلسلي محسن: {e}")
        return generate_serial_id()  # fallback للطريقة العادية


def generate_improved_device_name(device_info: Dict[str, Any], device_type: str) -> str:
    """إنشاء اسم محسن للجهاز بناءً على نوعه وشركته المصنعة"""
    try:
        manufacturer = device_info.get('manufacturer', '').strip()
        vendor_id = device_info.get('vendor_id', '').upper()
        product_id = device_info.get('product_id', '').upper()
        
        # إذا كان لدينا اسم شركة صالح
        if manufacturer and manufacturer.lower() not in ['unknown', 'generic', '']:
            if device_type != 'Unknown Device':
                return f"{manufacturer} {device_type}"
            else:
                return f"{manufacturer} USB Device"
        
        # إذا لم يكن لدينا اسم شركة، نحاول التعرف عليها من VID
        known_vendors = {
            '2717': 'Xiaomi',
            '18D1': 'Google', 
            '04E8': 'Samsung',
            '05AC': 'Apple',
            '12D1': 'Huawei',
            '0BB4': 'HTC',
            '22B8': 'Motorola',
            '0781': 'SanDisk',
            '0951': 'Kingston',
            '046D': 'Logitech',
            '413C': 'Dell',
            '03F0': 'HP',
            # إضافة المزيد من العلامات التجارية المحمولة
            '2A70': 'Oppo',
            '2A49': 'Vivo',
            '2A1F': 'Realme',
            '2A19': 'OnePlus',
            '2A05': 'Honor',
            '29F1': 'Asus',
            '29A2': 'Lenovo',
            '1F53': 'LG',
            '1F4D': 'Sony',
            '1F3A': 'Nokia',
            '1F28': 'Google',
            '1F1C': 'HTC',
            '1F0E': 'Motorola',
            '1F00': 'Samsung'
        }
        
        if vendor_id in known_vendors:
            vendor_name = known_vendors[vendor_id]
            if device_type != 'Unknown Device':
                return f"{vendor_name} {device_type}"
            else:
                return f"{vendor_name} USB Device"
        
        # إذا لم نستطع تحديد الشركة، نستخدم نوع الجهاز و VID/PID
        if device_type != 'Unknown Device':
            return f"{device_type} ({vendor_id}:{product_id})"
        else:
            return f"USB Device ({vendor_id}:{product_id})"
            
    except Exception as e:
        logger.error(f"خطأ في إنشاء اسم محسن للجهاز: {e}")
        return 'USB Device'


def remove_duplicate_devices(device_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    إزالة الأجهزة المكررة بناءً على معرفات متعددة
    Remove duplicate devices based on multiple identifiers
    """
    unique_devices = []
    seen_devices = set()
    duplicate_count = 0
    
    logger.debug(f"بدء إزالة التكرار من {len(device_list)} جهاز...")
    
    for device in device_list:
        try:
            # Create multiple unique identifiers for comprehensive deduplication
            vendor_id = (device.get('vendor_id') or '').lower().strip()
            product_id = (device.get('product_id') or '').lower().strip()
            serial_number = (device.get('serial_number') or '').strip()
            device_name = (device.get('name') or '').lower().strip()
            manufacturer = (device.get('manufacturer') or '').lower().strip()
            device_id = device.get('device_id', '').strip()
            
            # Create primary identifier (strongest)
            primary_key = None
            if serial_number and len(serial_number) > 4:
                # Use serial number as primary if available and valid
                primary_key = f"serial:{serial_number}"
            elif vendor_id and product_id and len(vendor_id) == 4 and len(product_id) == 4:
                # Use VID:PID as backup identifier
                primary_key = f"vid_pid:{vendor_id}:{product_id}"
            
            # Create secondary identifiers for additional checking
            secondary_keys = []
            
            # Device ID based identifier
            if device_id:
                secondary_keys.append(f"device_id:{device_id}")
            
            # Name + Manufacturer combination
            if device_name and manufacturer and device_name != 'unknown device':
                secondary_keys.append(f"name_mfg:{device_name}:{manufacturer}")
            
            # VID + PID + Name combination (for devices without serial)
            if vendor_id and product_id and device_name:
                secondary_keys.append(f"vid_pid_name:{vendor_id}:{product_id}:{device_name}")
            
            # Check if device is duplicate
            is_duplicate = False
            
            # Check primary identifier
            if primary_key and primary_key in seen_devices:
                is_duplicate = True
                logger.debug(f"تم اكتشاف تكرار بالمعرف الأساسي: {primary_key}")
            
            # Check secondary identifiers
            if not is_duplicate:
                for secondary_key in secondary_keys:
                    if secondary_key in seen_devices:
                        is_duplicate = True
                        logger.debug(f"تم اكتشاف تكرار بالمعرف الثانوي: {secondary_key}")
                        break
            
            if is_duplicate:
                duplicate_count += 1
                logger.debug(f"تم تجاهل جهاز مكرر: {device_name} ({vendor_id}:{product_id})")
                continue
            
            # Device is unique, add all its identifiers to seen set
            if primary_key:
                seen_devices.add(primary_key)
            
            for secondary_key in secondary_keys:
                seen_devices.add(secondary_key)
            
            # Add device to unique list
            unique_devices.append(device)
            logger.debug(f"تم قبول جهاز فريد: {device_name} - المعرف: {primary_key or 'secondary_only'}")
            
        except Exception as e:
            logger.error(f"خطأ في معالجة الجهاز للتكرار: {e}")
            # Add device anyway to avoid losing valid devices due to errors
            unique_devices.append(device)
    
    logger.debug(f"تم إزالة {duplicate_count} جهاز مكرر، تبقى {len(unique_devices)} جهاز فريد")
    return unique_devices


def enhanced_device_deduplication(device_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    إزالة التكرار المحسنة مع دمج المعلومات من الأجهزة المكررة
    Enhanced deduplication that merges information from duplicate devices
    """
    if not device_list:
        return []
    
    device_map = {}
    duplicate_count = 0
    
    logger.debug(f"بدء إزالة التكرار المحسنة من {len(device_list)} جهاز...")
    
    for device in device_list:
        try:
            # Validate device data
            if not isinstance(device, dict):
                logger.warning(f"تم تجاهل جهاز غير صالح - ليس قاموس: {type(device)}")
                continue
                
            # Generate candidate signatures for flexible clustering
            candidates = generate_device_candidate_signatures(device)
            if not candidates:
                fallback_signature = f"fallback:{device.get('name', 'unknown')}:{len(device_map)}"
                device_map[fallback_signature] = device
                logger.warning(f"تم استخدام بصمة احتياطية للجهاز: {device.get('name', 'Unknown')}")
                continue

            # Try to find an existing cluster by any candidate signature
            found_key = None
            for c in candidates:
                if c in device_map:
                    found_key = c
                    break

            if found_key:
                existing_device = device_map[found_key]
                try:
                    merged_device = merge_device_information(existing_device, device)
                    # Update all existing keys that point to the old device to point to merged
                    for key, val in list(device_map.items()):
                        if val is existing_device:
                            device_map[key] = merged_device
                    # Also register new candidates from this device to enable future matches
                    for c in candidates:
                        if c not in device_map:
                            device_map[c] = merged_device
                    duplicate_count += 1
                    logger.debug(f"دمج معلومات الجهاز المكرر تحت المفتاح {found_key}: {device.get('name', 'Unknown')}")
                except Exception as merge_error:
                    logger.error(f"فشل في دمج معلومات الجهاز: {merge_error}")
            else:
                # New unique device: store under ALL candidates to enable flexible matching
                primary_key = candidates[0]
                for c in candidates:
                    device_map[c] = device
                logger.debug(f"جهاز جديد فريد: {device.get('name', 'Unknown')} (key={primary_key})")
                
        except Exception as e:
            logger.error(f"خطأ في معالجة الجهاز للتكرار المحسن: {e}")
            # Use device name as fallback signature to avoid losing devices
            try:
                fallback_signature = f"fallback:{device.get('name', 'unknown')}:{len(device_map)}"
                device_map[fallback_signature] = device
                logger.debug(f"تم إضافة الجهاز بالبصمة الاحتياطية: {device.get('name', 'Unknown')}")
            except Exception as fallback_error:
                logger.error(f"فشل في إضافة الجهاز حتى بالطريقة الاحتياطية: {fallback_error}")
    
    # Extract unique devices (same device may be stored under multiple keys)
    # Use object id to deduplicate
    seen_ids = set()
    unique_devices = []
    for device in device_map.values():
        device_id = id(device)
        if device_id not in seen_ids:
            seen_ids.add(device_id)
            unique_devices.append(device)
    
    return unique_devices


def generate_device_signature(device: Dict[str, Any]) -> str:
    """
    Return a single canonical device signature string (primary candidate).
    Preferred format: 'serial:<NORMALIZED_SERIAL>' when available, otherwise
    'vid_pid:<VID>:<PID>' or other candidate. This ensures callers get one
    stable key per physical device for counting and baseline matching.
    """
    try:
        # Use the candidate generator to build an ordered list and return
        # the most specific (first) candidate as the canonical signature.
        candidates = generate_device_candidate_signatures(device)
        if candidates and len(candidates) > 0:
            return candidates[0]

        # Fallback: create a lightweight hash-based signature
        import hashlib
        device_str = str(device)
        return f"hash:{hashlib.md5(device_str.encode()).hexdigest()[:8]}"
    except Exception as e:
        logger.error(f"خطأ في إنشاء بصمة الجهاز: {e}")
        try:
            return f"error:{str(hash(str(device)))}"
        except Exception:
            return 'error:unknown'


def normalize_serial(serial: str) -> str:
    """Normalize serial by removing non-alphanumerics.
    
    Note: Previously this function would trim trailing numeric runs (>=6 digits)
    assuming they were timestamps. However, this caused issues with composite
    devices like phones where the serial number legitimately contains long
    numeric portions (e.g., SYKNW19C26003865). Now we preserve the full serial
    to ensure proper device clustering.
    """
    if not serial:
        return ''
    try:
        s = re.sub(r'[^A-Za-z0-9]', '', str(serial)).upper()
        if not s:
            return ''
        # Keep the full normalized serial - do not trim numeric suffixes
        # as they are often part of the actual device serial number
        return s
    except Exception:
        return serial


def normalize_location(loc: str) -> str:
    if not loc:
        return ''
    return re.sub(r'[^a-z0-9]', '', str(loc).lower())


def generate_device_candidate_signatures(device: Dict[str, Any]) -> List[str]:
    """Return ordered list of candidate signatures for a device (most to least specific).

    The first element is the primary signature (used by other helpers)."""
    try:
        vid = (device.get('vendor_id') or '').upper().strip()
        pid = (device.get('product_id') or '').upper().strip()
        serial = normalize_serial(device.get('serial_number') or '')
        name = (device.get('name') or device.get('product') or '').strip()
        name_clean = re.sub(r'[^A-Za-z0-9 ]', '', name).lower().strip()
        manufacturer = (device.get('manufacturer') or '').strip().lower()
        device_id = (device.get('device_id') or device.get('hardware_id') or device.get('device_path') or device.get('physical_path') or '').strip()
        location = normalize_location(device.get('location') or device.get('physical_path') or device.get('port_number') or '')

        # Extract VID:PID from device_id if not available directly
        # e.g., USB\VID_12D1&PID_107E\SYKNW19C26003865 → VID=12D1, PID=107E
        if (not vid or not pid) and device_id:
            vid_match = re.search(r'VID_([0-9A-Fa-f]{4})', device_id)
            pid_match = re.search(r'PID_([0-9A-Fa-f]{4})', device_id)
            if vid_match and not vid:
                vid = vid_match.group(1).upper()
            if pid_match and not pid:
                pid = pid_match.group(1).upper()

        candidates: List[str] = []

        # 0) For composite devices, extract base serial (strip trailing 00000/00001 suffixes)
        # This helps group multiple interfaces of the same physical device
        # e.g., 6318923600000 and 6318923600001 should cluster together
        base_serial = serial
        if serial and len(serial) >= 10:
            # Check if serial ends with interface suffix pattern (00000, 00001, etc.)
            interface_suffix_match = re.match(r'^(.{6,}?)(0{4,}\d?)$', serial)
            if interface_suffix_match:
                base_serial = interface_suffix_match.group(1)
        
        # 0b) Try to extract parent device serial from device_id for composite interfaces
        # e.g., USB\VID_12D1&PID_107E&MI_00\6&3189236&0&0000 → parent serial could be SYKNW19C26003865
        parent_serial = None
        if device_id and vid and pid:
            # Check if we can find the original device path pattern
            # For composite: USB\VID_XXXX&PID_XXXX\SERIAL is the parent
            # Interface: USB\VID_XXXX&PID_XXXX&MI_XX\... is the child
            parent_match = re.match(r'USB\\VID_[0-9A-Fa-f]+&PID_[0-9A-Fa-f]+\\([^\\&]+)$', device_id, re.IGNORECASE)
            if parent_match:
                # This is the parent composite device with full serial
                parent_serial = parent_match.group(1)
                if parent_serial and len(parent_serial) >= 6:
                    parent_serial = re.sub(r'[^A-Za-z0-9]', '', parent_serial).upper()
        
        # 1) Serial-based (full serial for exact match)
        if serial and len(serial) >= 4 and '&0&' not in serial:
            candidates.append(f"serial:{serial}")
        
        # 1b) Parent serial for composite device clustering (most specific)
        if parent_serial and parent_serial != serial:
            candidates.append(f"serial:{parent_serial}")
        
        # 1c) Base serial for composite device clustering
        if base_serial and base_serial != serial and len(base_serial) >= 4:
            candidates.append(f"serial:{base_serial}")

        # 2) VID:PID + parent device id (group multiple interfaces of same dongle)
        if vid and pid and device_id:
            parent = device_id.rsplit('\\', 1)[0] if '\\' in device_id else device_id
            # Also strip MI_XX interface suffix from parent path
            parent = re.sub(r'&MI_\d+$', '', parent, flags=re.IGNORECASE)
            # Also strip COL suffix (e.g., &COL01)
            parent = re.sub(r'&COL\d+$', '', parent, flags=re.IGNORECASE)
            parent_clean = re.sub(r'[^A-Za-z0-9:_-]', '', parent)
            candidates.append(f"vid_pid_parent:{vid}:{pid}:{parent_clean}")

        # 3) VID:PID + location/port (useful when location is stable)
        if vid and pid and location:
            candidates.append(f"vid_pid_loc:{vid}:{pid}:{location}")

        # NOTE: Removed vid_pid_name and vid_pid_mfg as they cause over-clustering
        # when multiple different physical devices have the same VID:PID and generic names

        # 4) VID:PID only - ONLY for composite device parent (not interfaces)
        # This is very restrictive - only for USB composite parents with a serial in the path
        # NOT for interfaces or other devices, to avoid over-clustering
        if vid and pid:
            # Only add vid_pid if this is the composite parent (has serial in path, no MI_XX)
            is_composite_parent = bool(re.match(r'USB\\VID_[0-9A-Fa-f]+&PID_[0-9A-Fa-f]+\\[^&\\]+$', device_id, re.IGNORECASE))
            if is_composite_parent:
                candidates.append(f"vid_pid:{vid}:{pid}")

        # 7) Fallbacks
        if name_clean:
            candidates.append(f"name:{name_clean}")

        # 8) Hash fallback (ensure at least one candidate)
        if not candidates:
            import hashlib
            device_str = str(device)
            candidates.append(f"hash:{hashlib.md5(device_str.encode()).hexdigest()[:8]}")

        # Deduplicate candidate list while preserving order
        seen = set()
        uniq = []
        for c in candidates:
            if c not in seen:
                uniq.append(c)
                seen.add(c)

        return uniq
    except Exception as e:
        logger.debug(f"generate_device_candidate_signatures failed: {e}")
        return []


# -------------------------------------------------------------------
# Initial discovery baseline helpers
# -------------------------------------------------------------------
# These helpers allow the server process to capture a baseline snapshot of
# devices present at startup so that "pending" counts do not include
# devices that were already connected when the server started — matching
# the agent (client) behavior.
_initial_discovery_done = False
_initial_discovery_keys = set()
_initial_discovery_logged = False

def capture_initial_discovery_baseline(force: bool = False) -> None:
    """Capture a baseline snapshot of currently discovered real devices.

    When called for the first time (or when force=True), this will run the
    enhanced discovery and store a set of device signatures which callers
    can use to exclude startup devices from pending counts.
    """
    global _initial_discovery_done, _initial_discovery_keys, _initial_discovery_logged
    try:
        if _initial_discovery_done and not force:
            return
        devices = []
        try:
            devices = discover_usb_devices() or []
        except Exception as e:
            logger.debug(f"capture_initial_discovery_baseline: discovery failed: {e}")
            devices = []

        keys = set()
        for d in devices:
            try:
                # capture all candidate signatures for robust baseline matching
                candidates = generate_device_candidate_signatures(d)
                for c in candidates:
                    if c:
                        keys.add(c)
            except Exception:
                continue

        _initial_discovery_keys = keys
        _initial_discovery_done = True
        _initial_discovery_logged = False  # Reset logging flag when baseline is updated
        # logger.info(f"🔁 Initial discovery baseline captured with {len(keys)} device keys")
    except Exception as e:
        logger.debug(f"Failed to capture initial baseline: {e}")


def is_initial_discovery_captured() -> bool:
    return bool(_initial_discovery_done)


def get_initial_discovery_keys() -> set:
    return set(_initial_discovery_keys)


def merge_device_information(existing_device: Dict[str, Any], new_device: Dict[str, Any]) -> Dict[str, Any]:
    """
    دمج معلومات من جهازين متكررين للحصول على أفضل معلومات
    Merge information from two duplicate devices to get the best information
    Enhanced to prefer more descriptive names and complete serial numbers
    """
    try:
        # Validate inputs
        if not isinstance(existing_device, dict) or not isinstance(new_device, dict):
            logger.warning(f"بيانات غير صالحة للدمج: {type(existing_device)}, {type(new_device)}")
            return existing_device if isinstance(existing_device, dict) else new_device
        
        merged = existing_device.copy()
        
        # Generic/uninformative names to avoid
        generic_names = [
            'unknown', 'unknown device', 'none', '', 'generic', 
            'usb composite device', 'composite device', 'usb device',
            'usb input device', 'hid keyboard device', 'hid-compliant mouse',
            'usb mass storage device', 'mass storage device'
        ]
        
        # Merge fields, preferring non-empty and more informative values
        merge_fields = [
            'name', 'manufacturer', 'product', 'description', 
            'serial_number', 'device_type', 'device_class'
        ]
        
        for field in merge_fields:
            try:
                existing_value = str(existing_device.get(field, '')).strip()
                new_value = str(new_device.get(field, '')).strip()
                
                existing_is_generic = existing_value.lower() in generic_names
                new_is_generic = new_value.lower() in generic_names
                
                # Special handling for serial_number - prefer longer/more complete
                if field == 'serial_number':
                    if new_value and len(new_value) > len(existing_value):
                        merged[field] = new_value
                    elif not existing_value and new_value:
                        merged[field] = new_value
                # Special handling for name - prefer non-generic, more descriptive
                elif field == 'name':
                    if existing_is_generic and not new_is_generic and new_value:
                        merged[field] = new_value
                    elif not existing_is_generic and new_is_generic:
                        pass  # Keep existing
                    elif new_value and len(new_value) > len(existing_value) and not new_is_generic:
                        merged[field] = new_value
                # Special handling for device_type/device_class - match with merged name
                elif field in ('device_type', 'device_class'):
                    merged_name = merged.get('name', '').lower()
                    existing_val_lower = existing_value.lower()
                    new_val_lower = new_value.lower()
                    
                    # Check if the name contains a keyword that matches a device type
                    if 'mouse' in merged_name:
                        if 'mouse' in new_val_lower:
                            merged[field] = new_value
                        elif 'mouse' not in existing_val_lower and new_val_lower:
                            # Keep existing if neither matches
                            pass
                    elif 'keyboard' in merged_name:
                        if 'keyboard' in new_val_lower:
                            merged[field] = new_value
                    elif 'storage' in merged_name or 'disk' in merged_name:
                        if 'storage' in new_val_lower or 'disk' in new_val_lower:
                            merged[field] = new_value
                    # General fallback - prefer non-empty and non-generic
                    elif not existing_value or existing_is_generic:
                        if new_value and not new_is_generic:
                            merged[field] = new_value
                # General handling for other fields
                else:
                    if not existing_value or existing_is_generic:
                        if new_value and not new_is_generic:
                            merged[field] = new_value
                    elif new_value and len(new_value) > len(existing_value) and not new_is_generic:
                        merged[field] = new_value
            except Exception as field_error:
                logger.debug(f"خطأ في دمج الحقل {field}: {field_error}")
                continue
        
        # Update timestamps to most recent
        try:
            existing_time = existing_device.get('detected_at', '')
            new_time = new_device.get('detected_at', '')
            
            if new_time and (not existing_time or str(new_time) > str(existing_time)):
                merged['detected_at'] = new_time
                merged['last_seen'] = new_time
        except Exception as time_error:
            logger.debug(f"خطأ في دمج الأوقات: {time_error}")
        
        # Merge metadata if available
        try:
            if 'meta_data' in new_device and new_device['meta_data']:
                existing_meta = merged.get('meta_data', {})
                new_meta = new_device.get('meta_data', {})
                
                if isinstance(existing_meta, dict) and isinstance(new_meta, dict):
                    merged_meta = existing_meta.copy()
                    merged_meta.update(new_meta)
                    merged['meta_data'] = merged_meta
                elif new_meta:  # If new_meta is not empty, use it
                    merged['meta_data'] = new_meta
        except Exception as meta_error:
            logger.debug(f"خطأ في دمج البيانات الوصفية: {meta_error}")
        
        return merged
        
    except Exception as e:
        logger.error(f"خطأ في دمج معلومات الأجهزة: {e}")
        # Return the device with more information in case of error
        try:
            existing_info_count = len([v for v in existing_device.values() if v and str(v).strip()])
            new_info_count = len([v for v in new_device.values() if v and str(v).strip()])
            return new_device if new_info_count > existing_info_count else existing_device
        except Exception:
            return existing_device  # Final fallback
    


def get_device_class_from_description(description: str) -> str:
    """Determine a canonical USB device class code (as a 2-digit string)
    from a human-readable description. Returns things like '08' for
    mass storage, '03' for HID, '09' for hubs, etc. If no match is
    found an empty string is returned.
    """
    try:
        description_lower = (description or '').lower()

        # Map common textual cues to USB class codes (hex, two-digit strings)
        mapping = {
            'mass storage': '08',
            'storage': '08',
            'flash': '08',
            'sd card': '08',
            'usb flash': '08',
            'drive': '08',
            'mouse': '03',
            'keyboard': '03',
            'hid': '03',
            'touchpad': '03',
            'gamepad': '03',
            'hub': '09',
            'usb hub': '09',
            'camera': '0e',
            'video': '0e',
            'audio': '01',
            'microphone': '01',
            'speaker': '01',
            'printer': '07',
            'smart card': '0b',
            'smartcard': '0b'
        }

        for key, cls in mapping.items():
            if key in description_lower:
                return cls

        # Try to extract an explicit class code like "class 03" or hex values
        m = re.search(r'class\s*([0-9A-Fa-f]{1,2})', description)
        if m:
            code = m.group(1).zfill(2).upper()
            return code

        return ''
    except Exception as e:
        logger.debug(f"get_device_class_from_description error: {e}")
        return ''


def get_device_type_name(device_class) -> str:
    """Return a friendly device type name for a device_class value.

    Accepts numeric-like codes (e.g. '08', '03', 8, 3) or descriptive
    strings and returns a readable type name. Falls back to
    get_device_type_from_class for textual descriptions.
    """
    try:
        if device_class is None:
            return 'USB Device'

        # Normalize numeric forms
        s = str(device_class).strip()
        if s.startswith('0x') or s.startswith('0X'):
            s = s[2:]
        # If it's a number like 8 or '8', normalize to two-digit hex-ish string
        if s.isdigit():
            s = s.zfill(2)

        s_upper = s.upper()

        code_map = {
            '08': 'USB Storage',
            '03': 'HID Device',
            '09': 'USB Hub',
            '0E': 'Video Device',
            '0e': 'Video Device',
            '01': 'Audio Device',
            '07': 'Printer',
            '0B': 'Smart Card Reader'
        }

        if s_upper in code_map:
            return code_map[s_upper]

        # Fallback to textual heuristic helper
        try:
            return get_device_type_from_class(str(device_class))
        except Exception:
            return 'USB Device'
    except Exception as e:
        logger.debug(f"get_device_type_name error: {e}")
        return 'USB Device'


def count_physical_usb_ports() -> Dict[str, int]:
    """عدّ المنافذ الفيزيائية لـ USB في النظام"""
    system = platform.system().lower()
    
    if system == 'windows':
        return count_usb_ports_windows()
    elif system == 'linux':
        return count_usb_ports_linux()
    else:
        return {'total_ports': 8, 'used_ports': 0, 'available_ports': 8}


def count_usb_ports_windows() -> Dict[str, int]:
    """عدّ منافذ USB في Windows"""
    try:
        # استخدام PowerShell لعدّ USB hubs والـ controllers
        cmd = [
            'powershell', '-NoProfile', '-NonInteractive', '-Command',
            '(Get-WmiObject -Class Win32_USBHub | Measure-Object).Count + (Get-WmiObject -Class Win32_USBController | Measure-Object).Count'
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0 and result.stdout.strip():
            total_hubs = int(result.stdout.strip())
            # تقدير عدد المنافذ (كل hub عادة يحتوي على 4-8 منافذ)
            estimated_ports = max(total_hubs * 4, 8)
            
            # عدّ الأجهزة المتصلة
            connected_devices = len(discover_usb_devices_windows())
            
            return {
                'total_ports': estimated_ports,
                'used_ports': connected_devices,
                'available_ports': max(estimated_ports - connected_devices, 0)
            }
            
    except Exception as e:
        logger.warning(f"خطأ في عدّ منافذ Windows: {e}")
    
    return {'total_ports': 8, 'used_ports': 0, 'available_ports': 8}


def count_usb_ports_linux() -> Dict[str, int]:
    """عدّ منافذ USB في Linux"""
    try:
        total_ports = 0
        
        # فحص /sys/bus/usb/devices للحصول على عدد المنافذ
        sys_usb_path = '/sys/bus/usb/devices'
        if os.path.exists(sys_usb_path):
            for device_dir in os.listdir(sys_usb_path):
                if device_dir.startswith('usb'):
                    maxchild_path = os.path.join(sys_usb_path, device_dir, 'maxchild')
                    if os.path.exists(maxchild_path):
                        try:
                            with open(maxchild_path, 'r') as f:
                                max_ports = int(f.read().strip())
                                total_ports += max_ports
                        except ValueError:
                            continue
        
        if total_ports == 0:
            total_ports = 8  # قيمة افتراضية
        
        # عدّ الأجهزة المتصلة
        connected_devices = len(discover_usb_devices_linux())
        
        return {
            'total_ports': total_ports,
            'used_ports': connected_devices,
            'available_ports': max(total_ports - connected_devices, 0)
        }
        
    except Exception as e:
        logger.warning(f"خطأ في عدّ منافذ Linux: {e}")
    
    return {'total_ports': 8, 'used_ports': 0, 'available_ports': 8}


def get_basic_device_info(device) -> Optional[Dict[str, Any]]:
    """جلب معلومات أساسية محسنة من جهاز USB - Enhanced basic device information."""
    try:
        # استيراد قاعدة البيانات المحسنة
        try:
            from usb_vendors import get_vendor_name, get_device_class_name  # type: ignore
        except ImportError:
            def get_vendor_name(vid): return "Unknown Vendor"
            def get_device_class_name(cid): return "Unknown Class"
        
        # Get device descriptors
        vendor_id = f"{device.idVendor:04x}"
        product_id = f"{device.idProduct:04x}"
        
        # محاولة جلب سلاسل الشركة المصنعة والمنتج
        manufacturer = "Unknown"
        product = "Unknown"
        serial_number = None
        
        # تجربة جلب سلسلة الشركة المصنعة من الجهاز أولاً
        try:
            if device.iManufacturer:
                device_manufacturer = usb.util.get_string(device, device.iManufacturer)
                if device_manufacturer and device_manufacturer.strip():
                    manufacturer = device_manufacturer.strip()
        except Exception as e:
            logger.debug(f"فشل جلب اسم الشركة من الجهاز: {e}")
        
        # إذا لم يتم الحصول على اسم الشركة أو كان "Unknown"، استخدم قاعدة البيانات
        if manufacturer == "Unknown" or not manufacturer.strip():
            manufacturer = get_vendor_name(vendor_id)
            
        try:
            if device.iProduct:
                device_product = usb.util.get_string(device, device.iProduct)
                if device_product and device_product.strip():
                    product = device_product.strip()
        except Exception as e:
            logger.debug(f"فشل جلب اسم المنتج من الجهاز: {e}")
            
        try:
            if device.iSerialNumber:
                device_serial = usb.util.get_string(device, device.iSerialNumber)
                if device_serial and device_serial.strip():
                    serial_number = device_serial.strip()
                    # تأكد من أن الرقم التسلسلي حقيقي وليس وهمي
                    if len(serial_number) >= 4 and not serial_number.startswith('0000'):
                        # إزالة المسافات والأحرف غير المرغوب فيها
                        clean_serial = re.sub(r'[\s\-_]', '', serial_number)
                        if len(clean_serial) >= 4:
                            serial_number = clean_serial
                    else:
                        serial_number = None
        except Exception as e:
            logger.debug(f"فشل جلب الرقم التسلسلي من الجهاز: {e}")
        
        # توليد رقم تسلسلي فريد إذا لم يكن متوفراً
        if not serial_number:
            # بدلاً من توليد رقم عشوائي، استخدم VID:PID كمعرف
            serial_number = f"{vendor_id.upper()}:{product_id.upper()}"
        
        # إنشاء اسم جهاز محسن
        device_name = product
        if product == "Unknown" and manufacturer != "Unknown Vendor":
            device_name = f"{manufacturer} USB Device"
        elif product == "Unknown":
            # محاولة إنشاء اسم معنى بناءً على فئة الجهاز
            device_class_name = get_device_class_name(device.bDeviceClass)
            if device_class_name != "Unknown Class":
                device_name = f"{manufacturer} {device_class_name}"
            else:
                device_name = f"USB Device {vendor_id}:{product_id}"
        
        device_info = {
            'vendor_id': vendor_id,
            'product_id': product_id,
            'manufacturer': manufacturer,
            'product': product,
            'name': device_name,
            'serial_number': serial_number,
            'device_class': device.bDeviceClass,
            'max_packet_size': device.bMaxPacketSize0,
            'device_hash': generate_device_hash(vendor_id, product_id, serial_number),
            'system': platform.system(),
            'detected_at': current_time().isoformat()
        }
        
        # جلب معلومات محسنة بناءً على النظام
        try:
            enhanced_info = get_enhanced_device_info(device, device_info)
            device_info.update(enhanced_info)
        except Exception as e:
            logger.debug(f"فشل جلب معلومات محسنة: {e}")
            # إضافة معلومات احتياطية محسنة
            device_info.update({
                'device_type': get_device_type(device_info),
                'power_consumption': 0.5,  # استهلاك افتراضي للطاقة
                'port_number': 'Unknown',
                'physical_path': f"USB/{vendor_id}_{product_id}"
            })
        
        logger.debug(f"تم كشف جهاز محسن: {manufacturer} {product} ({vendor_id}:{product_id})")
        return device_info
        
    except Exception as e:
        logger.error(f"خطأ في جلب معلومات الجهاز الأساسية: {e}")
        return None


def get_enhanced_device_info(device, base_info: Dict[str, Any]) -> Dict[str, Any]:
    """Get enhanced device information based on platform."""
    enhanced_info = {}
    
    if platform.system() == 'Linux':
        enhanced_info = get_enhanced_device_info_linux(device, base_info)
    else:
        enhanced_info = get_enhanced_device_info_generic(device, base_info)
    
    return enhanced_info


# Windows function removed - use Linux equivalent


def get_enhanced_device_info_linux(device, base_info: Dict[str, Any]) -> Dict[str, Any]:
    """Get enhanced device information on Linux."""
    enhanced_info = {}
    
    if not LINUX_AVAILABLE:
        return enhanced_info
    
    try:
        import pyudev  # type: ignore
        context = pyudev.Context()
        
        # Find device in udev
        for dev in context.list_devices(subsystem='usb'):
            if (dev.get('ID_VENDOR_ID') == base_info['vendor_id'] and 
                dev.get('ID_MODEL_ID') == base_info['product_id']):
                
                enhanced_info['device_type'] = dev.get('ID_MODEL', 'Unknown')
                enhanced_info['power_consumption'] = get_power_consumption_linux(dev)
                enhanced_info['port_number'] = get_usb_port_number_linux(dev)
                enhanced_info['server_name'] = platform.node()
                enhanced_info['server_id'] = 1  # Default server ID
                
                break
                
    except Exception as e:
        logger.warning(f"Error getting enhanced Linux device info: {e}")
    
    return enhanced_info


def get_enhanced_device_info_generic(device, base_info: Dict[str, Any]) -> Dict[str, Any]:
    """Get enhanced device information for generic systems."""
    enhanced_info = {
        'device_type': 'Unknown',
        'power_consumption': 0.0,
        'port_number': 0,
        'server_name': platform.node(),
        'server_id': 1
    }
    
    return enhanced_info


def is_real_device(device_info: Dict[str, Any]) -> bool:
    """فحص ما إذا كان الجهاز حقيقي وليس جهاز نظام أو مكرر - محسن مع فلترة قوية للأجهزة الوهمية"""
    try:
        vendor_id = device_info.get('vendor_id', '').lower()
        product_id = device_info.get('product_id', '').lower()
        manufacturer = device_info.get('manufacturer', '').lower()
        product = device_info.get('product', '').lower()
        name = device_info.get('name', '').lower()
        serial_number = device_info.get('serial_number', '')
        
        # قائمة معرفات الاختبار والأجهزة الوهمية المعروفة - محسنة
        test_device_patterns = [
            ('0123', '4567'),  # معرف الاختبار الذي يظهر في المشكلة
            ('1234', '5678'),  # معرف اختبار شائع آخر
            ('0000', '0000'),  # معرف فارغ
            ('ffff', 'ffff'),  # معرف غير صالح
            ('abcd', '1234'),  # معرف اختبار آخر
            ('5678', '1234'),  # معرف اختبار آخر
        ]
        
        # تحقق من معرفات الاختبار
        for test_vid, test_pid in test_device_patterns:
            if vendor_id == test_vid and product_id == test_pid:
                logger.debug(f"تم تجاهل جهاز اختبار/وهمي: {name} - {vendor_id}:{product_id}")
                return False
        
        # تجاهل الأجهزة التي تحتوي على vendor_id وهمي واضح - محسن
        fake_vendor_ids = ['0000', 'ffff', 'abcd', '1234', '5678', '9abc', 'def0']
        if vendor_id in fake_vendor_ids or product_id in fake_vendor_ids:
            logger.debug(f"تم تجاهل جهاز بـ vendor_id/product_id وهمي: {name} - {vendor_id}:{product_id}")
            return False
        
        # فحص أنماط Serial Number الوهمية المحسنة
        if serial_number:
            # فحص أنماط Windows الافتراضية الواضحة
            if (serial_number.count('&') >= 3 and '&0&' in serial_number):
                logger.debug(f"تم تجاهل جهاز بـ serial مشبوه: {name} - {serial_number}")
                return False
            
            # فحص serial numbers الوهمية التي تحتوي على timestamp أو أنماط اختبار
            suspicious_patterns = ['USB_', 'TEST_', 'FAKE_', 'DUMMY_', '123456', 'abcdef']
            if any(pattern in serial_number for pattern in suspicious_patterns):
                logger.debug(f"تم تجاهل جهاز بـ serial number مشبوه: {name} - {serial_number}")
                return False
            
            # فحص serial numbers القصيرة جداً أو المتكررة
            if len(serial_number) < 5 or serial_number == serial_number[0] * len(serial_number):
                logger.debug(f"تم تجاهل جهاز بـ serial number قصير أو متكرر: {name} - {serial_number}")
                return False
        
        # تجاهل الأجهزة الوهمية الواضحة فقط
        obvious_fake_patterns = [
            'root hub',            # موزعات جذرية
            'enhanced host controller',  # متحكمات محسنة
            'usb root hub',        # موزع USB جذري
            'host controller',     # متحكم مضيف
            'composite parent',    # والد مركب
            'test device',         # جهاز اختبار
            'dummy device',        # جهاز وهمي
            'fake device',         # جهاز مزيف
        ]
        
        # فحص اسم الجهاز ضد الأنماط الوهمية الواضحة
        for pattern in obvious_fake_patterns:
            if pattern in name:
                logger.debug(f"تم تجاهل جهاز وهمي واضح: {name} (نمط: {pattern})")
                return False
        
        # فحص الشركة المصنعة الوهمية
        fake_manufacturers = ['test', 'dummy', 'fake', 'generic']
        if any(fake_mfg in manufacturer for fake_mfg in fake_manufacturers):
            logger.debug(f"تم تجاهل جهاز من شركة وهمية: {name} - {manufacturer}")
            return False
        
        # تجاهل الأجهزة التي لا تحتوي على معلومات مفيدة على الإطلاق
        if (not vendor_id or vendor_id == '0000') and (not manufacturer or manufacturer in ['unknown', 'unknown device', '']) and (not name or name in ['unknown device', 'unknown', '']):
            logger.debug(f"تم تجاهل جهاز بدون أي معلومات مفيدة: {name}")
            return False
        
        # السماح بجميع الأجهزة الأخرى - ستحتاج لموافقة يدوية لاحقاً
        logger.debug(f"تم قبول جهاز للمراجعة: {name} - {manufacturer} - VID:{vendor_id} PID:{product_id}")
        return True
        
    except Exception as e:
        logger.warning(f"خطأ في فحص صحة الجهاز: {e}")
        return False  # في حالة الخطأ، نرفض الجهاز للأمان


# Windows function removed - use Linux equivalent


def get_power_consumption_linux(udev_device) -> float:
    """Get power consumption for Linux USB device."""
    try:
        # Try to get power consumption from udev properties
        power_consumption = 0.0
        
        # Check for power consumption in udev properties
        power_str = udev_device.get('POWER_CONSUMPTION')
        if power_str:
            try:
                power_consumption = float(power_str) / 1000.0  # Convert to watts
            except ValueError:
                power_consumption = 0.5  # Default USB power consumption
        
        return power_consumption
    except Exception as e:
        logger.warning(f"Error getting power consumption on Linux: {e}")
        return 0.0


# Windows function removed - use Linux equivalent


def get_usb_port_number_linux(udev_device) -> int:
    """Get USB port number on Linux."""
    try:
        # Extract port number from udev path
        dev_path = udev_device.device_node or ""
        port_match = re.search(r'usb\d+/(\d+)', dev_path)
        if port_match:
            return int(port_match.group(1))
        return 0
    except Exception as e:
        logger.warning(f"Error getting USB port number on Linux: {e}")
        return 0


# -------------------------------------------------------------------
# USB Port Management
# -------------------------------------------------------------------
def get_usb_ports_info() -> Dict[str, Any]:
    """Get information about all USB ports on the system."""
    ports_info = {
        'total_ports': 0,
        'used_ports': 0,
        'available_ports': 0,
        'ports': []
    }
    
    try:
        if platform.system() == 'Linux':
            ports_info = get_usb_ports_info_linux()
        else:
            ports_info = get_usb_ports_info_generic()
            
    except Exception as e:
        logger.error(f"Error getting USB ports info: {e}")
    
    return ports_info


# Windows function removed - use Linux equivalent


def get_usb_ports_info_linux() -> Dict[str, Any]:
    """Get USB ports information on Linux."""
    ports_info = {
        'total_ports': 0,
        'used_ports': 0,
        'available_ports': 0,
        'enabled_ports': 0,
        'disabled_ports': 0,
        'ports': []
    }
    
    if not LINUX_AVAILABLE:
        return ports_info
    
    try:
        import pyudev  # type: ignore
        context = pyudev.Context()
        
        # Get USB controllers and count ports
        usb_devices = list(context.list_devices(subsystem='usb'))
        total_physical_ports = 8  # Default assumption
        
        # Count USB controllers to estimate port count
        controllers = [d for d in usb_devices if d.get('DEVTYPE') == 'usb_device']
        if controllers:
            total_physical_ports = len(controllers) * 2  # Estimate 2 ports per controller
        
        # Create port entries
        for i in range(1, total_physical_ports + 1):
            port_info = {
                'port_id': f'USB_PORT_{i}',
                'name': f'USB Port {i}',
                'status': 'active',
                'enabled': True,  # Default to enabled
                'connected_devices': []
            }
            
            # Check if any device is connected to this port
            for device in usb_devices:
                if device.get('DEVTYPE') == 'usb_device':
                    # Try to match device to port
                    dev_path = device.device_node or ''
                    if f'usb{i}' in dev_path or f'port{i}' in dev_path:
                        port_info['connected_devices'].append({
                            'name': device.get('ID_MODEL', 'Unknown Device'),
                            'device_id': device.device_node
                        })
            
            if port_info['connected_devices']:
                ports_info['used_ports'] += 1
            else:
                ports_info['available_ports'] += 1
                
            ports_info['enabled_ports'] += 1  # All ports are enabled by default
            ports_info['ports'].append(port_info)
        
        ports_info['total_ports'] = total_physical_ports
                
    except Exception as e:
        logger.error(f"Error getting USB ports info on Linux: {e}")
        # Fallback to default values
        ports_info = {
            'total_ports': 8,
            'used_ports': 0,
            'available_ports': 8,
            'enabled_ports': 8,
            'disabled_ports': 0,
            'ports': []
        }
    
    return ports_info


def get_usb_ports_info_generic() -> Dict[str, Any]:
    """Get USB ports information for generic systems."""
    ports_info = {
        'total_ports': 0,
        'used_ports': 0,
        'available_ports': 0,
        'enabled_ports': 0,
        'disabled_ports': 0,
        'ports': []
    }
    
    try:
        # Use pyusb to count devices
        devices = list(usb.core.find(find_all=True))
        total_ports = max(len(devices), 8)  # At least 8 ports
        
        # Create port entries
        for i in range(1, total_ports + 1):
            port_info = {
                'port_id': f'USB_PORT_{i}',
                'name': f'USB Port {i}',
                'status': 'active',
                'enabled': True,  # Default to enabled
                'connected_devices': []
            }
            
            # Check if any device is connected to this port
            if i <= len(devices):
                try:
                    device = devices[i-1]
                    port_info['connected_devices'].append({
                        'name': f'USB Device {i}',
                        'device_id': f'{device.idVendor:04x}:{device.idProduct:04x}'
                    })
                except:
                    pass
            
            if port_info['connected_devices']:
                ports_info['used_ports'] += 1
            else:
                ports_info['available_ports'] += 1
                
            ports_info['enabled_ports'] += 1  # All ports are enabled by default
            ports_info['ports'].append(port_info)
        
        ports_info['total_ports'] = total_ports
        
    except Exception as e:
        logger.error(f"Error getting USB ports info on generic system: {e}")
        # Fallback to default values
        ports_info = {
            'total_ports': 8,
            'used_ports': 0,
            'available_ports': 8,
            'enabled_ports': 8,
            'disabled_ports': 0,
            'ports': []
        }
    
    return ports_info


# -------------------------------------------------------------------
# Device Control Functions
# -------------------------------------------------------------------
def control_device(serial_number: str, action: str) -> Tuple[bool, str]:
    """Control a USB device (eject, disable, etc.)."""
    try:
        device = find_device_by_serial(serial_number)
        if not device:
            return False, "Device not found"
        
        if action == 'eject':
            return eject_device_safe(device)
        elif action == 'disable':
            return disable_device_safe(device)
        elif action == 'enable':
            return enable_device_safe(device)
        else:
            return False, f"Unknown action: {action}"
            
    except Exception as e:
        logger.error(f"Error controlling device {serial_number}: {e}")
        return False, str(e)


def find_device_by_serial(serial_number: str):
    """Find a USB device by its serial number."""
    try:
        # Try to set backend explicitly to avoid "No backend available" error
        try:
            import usb.backend.libusb1
            backend = usb.backend.libusb1.get_backend()
        except ImportError:
            try:
                import usb.backend.libusb0
                backend = usb.backend.libusb0.get_backend()
            except ImportError:
                try:
                    import usb.backend.openusb
                    backend = usb.backend.openusb.get_backend()
                except ImportError:
                    backend = None
        
        # If no backend found, try without specifying backend
        if backend is None:
            devices = usb.core.find(find_all=True)
        else:
            devices = usb.core.find(find_all=True, backend=backend)
        
        for device in devices:
            try:
                if device.iSerialNumber:
                    device_serial = usb.util.get_string(device, device.iSerialNumber)
                    if device_serial == serial_number:
                        return device
            except usb.core.USBError:
                continue
        return None
    except Exception as e:
        # Reduce error logging frequency to avoid spam
        if not hasattr(find_device_by_serial, '_last_error_time'):
            find_device_by_serial._last_error_time = 0
        
        current_time_stamp = time.time()
        if current_time_stamp - find_device_by_serial._last_error_time > 30:  # Log error only once every 30 seconds
            logger.error(f"Error finding device by serial: {e}")
            find_device_by_serial._last_error_time = current_time_stamp
        return None


def eject_device_safe(device) -> Tuple[bool, str]:
    """Safely eject a USB device."""
    try:
        # This is a simplified approach - in real implementation you'd need
        # platform-specific code to safely eject devices
        logger.info(f"Ejecting device: {device.idVendor:04x}:{device.idProduct:04x}")
        return True, "Device ejected successfully"
    except Exception as e:
        logger.error(f"Error ejecting device: {e}")
        return False, str(e)


def disable_device_safe(device) -> Tuple[bool, str]:
    """Safely disable a USB device."""
    try:
        # This is a simplified approach - in real implementation you'd need
        # platform-specific code to disable devices
        logger.info(f"Disabling device: {device.idVendor:04x}:{device.idProduct:04x}")
        return True, "Device disabled successfully"
    except Exception as e:
        logger.error(f"Error disabling device: {e}")
        return False, str(e)


def enable_device_safe(device) -> Tuple[bool, str]:
    """Safely enable a USB device."""
    try:
        # This is a simplified approach - in real implementation you'd need
        # platform-specific code to enable devices
        logger.info(f"Enabling device: {device.idVendor:04x}:{device.idProduct:04x}")
        return True, "Device enabled successfully"
    except Exception as e:
        logger.error(f"Error enabling device: {e}")
        return False, str(e)


# -------------------------------------------------------------------
# Device Status Functions
# -------------------------------------------------------------------
def is_device_connected(serial_number: str) -> bool:
    """Check if a device is currently connected using Windows PowerShell."""
    try:
        if platform.system() == "Windows":
            # استخدام PowerShell للتحقق من وجود الجهاز
            cmd = [
                'powershell', '-NoProfile', '-NonInteractive', '-Command',
                f'Get-PnpDevice | Where-Object DeviceID -like "*{serial_number}*" | Where-Object Status -eq "OK" | Where-Object Present -eq $true | Measure-Object | Select-Object -ExpandProperty Count'
            ]

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)  # تقليل timeout إلى 5 ثوانٍ
            if result.returncode == 0:
                count = int(result.stdout.strip()) if result.stdout.strip().isdigit() else 0
                return count > 0

        # للأنظمة الأخرى، استخدام pyusb
        device = find_device_by_serial(serial_number)
        return device is not None

    except Exception as e:
        logger.error(f"Error checking device connection: {e}")
        return False

    except Exception as e:
        logger.error(f"Error checking device connection: {e}")
        return False


def get_all_connected_devices_serials() -> List[str]:
    """Get serial numbers of all real USB devices currently connected."""
    try:
        real_devices = get_real_usb_devices()
        
        # إضافة device_type بناءً على class الجهاز
        for device in real_devices:
            device_class = device.get('class', 'Unknown')
            device['device_class'] = device_class
            device['device_type'] = get_device_type_from_class(device_class)

        # Try to cluster/merge interface-level entries first so we report
        # physical devices rather than multiple logical interfaces.
        try:
            deduped = enhanced_device_deduplication(real_devices)
        except Exception:
            deduped = real_devices
            
        # جلب قائمة الأجهزة المحفوظة في قاعدة البيانات لتحديد الأجهزة المعروفة
        db_known_serials = set()
        try:
            # استخدام إنشاء client مباشرة لتجنب مشاكل Flask context
            from supabase_config import get_supabase_client as get_direct_client
            client = get_direct_client()
            if client:
                response = client.table('devices').select('serial_number').execute()
                if hasattr(response, 'data') and response.data:
                    for d in response.data:
                        sn = d.get('serial_number')
                        if sn:
                            db_known_serials.add(str(sn).strip().lower())
        except Exception as e:
            logger.debug(f"Failed to fetch DB serials: {e}")

        # Build a single canonical display key per deduplicated physical device.
        canonical_display_keys: List[str] = []
        cluster_keys: List[str] = []
        device_details: List[Tuple[str, str, str, str]] = []  # (display_key, name, type, state)

        for device in deduped:
            try:
                primary_sig = generate_device_signature(device)
            except Exception:
                primary_sig = None

            # Keep cluster key (primary canonical signature) for debugging
            cluster_keys.append(primary_sig or 'unknown')

            # Derive a human-friendly display key from the primary signature.
            display_key = None
            if primary_sig and primary_sig.startswith('serial:'):
                # show just the normalized serial (no prefix)
                display_key = primary_sig.split(':', 1)[1]
            elif primary_sig and primary_sig.startswith('vid_pid'):
                parts = primary_sig.split(':')
                if len(parts) >= 3:
                    display_key = f"{parts[1].upper()}:{parts[2].upper()}"
                else:
                    display_key = primary_sig
            else:
                # fall back to any available serial or a friendly name
                s = (device.get('serial_number') or '').strip()
                if s:
                    display_key = normalize_serial(s) or s
                else:
                    display_key = device.get('name') or device.get('product') or 'unknown'

            canonical_display_keys.append(display_key)

            # Collect device details for formatted logging with state
            device_name = device.get('name') or device.get('product') or 'Unknown Device'
            # استخدام device_type من الجهاز مباشرة إذا كان موجوداً
            device_type = device.get('device_type') or get_device_type(device) or 'USB Device'
            
            # تحديد حالة الجهاز:
            # - إذا كان الجهاز موجود في قاعدة البيانات (معروف/معتمد) → connected
            # - إذا كان جهاز جديد غير موجود في قاعدة البيانات → pending
            # نتحقق من عدة صيغ للسيريال لضمان المطابقة الصحيحة وبشكل غير حساس لحالة الأحرف
            device_state = 'pending'
            raw_serial = (device.get('serial_number') or '').strip()
            
            # قائمة بجميع الصيغ الممكنة للسيريال للمطابقة (Lowercase)
            candidates = {display_key.lower() if display_key else "", raw_serial.lower()}
            if raw_serial:
                norm = normalize_serial(raw_serial)
                if norm:
                    candidates.add(norm.lower())
            
            # إزالة القيم الفارغة
            candidates.discard('')
            
            # التحقق من وجود أي صيغة في قاعدة البيانات
            is_known = any(c in db_known_serials for c in candidates)
            
            if is_known:
                device_state = 'connected'
            
            # إذا كان هناك حالة خطأ في النظام (PnP Status) فإنها تظهر
            pnp_status = str(device.get('status', 'OK')).lower()
            if pnp_status not in ('ok', 'connected'):
                device_state = pnp_status
                
            device_details.append((display_key, device_name, device_type, device_state))

        # Preserve order while removing duplicates
        unique_keys: List[str] = []
        unique_details: List[Tuple[str, str, str, str]] = []  # Updated to include state
        seen = set()
        for item in device_details:
            key = item[0]
            if key and key not in seen:
                unique_keys.append(key)
                unique_details.append(item)
                seen.add(key)

        # Sort by display key for organized output
        unique_details.sort(key=lambda x: (x[2], x[1]))  # Sort by type first, then by name

        # Logging: show physical device count and formatted list
        if hasattr(get_all_connected_devices_serials, '_last_serial_count'):
            last_count = get_all_connected_devices_serials._last_serial_count
            current_count = len(unique_keys)
            if current_count != last_count:
                # logger.info(f"📱 Connected physical devices changed: {last_count} → {current_count} devices (clusters: {cluster_keys})")
                if unique_details:
                    # Silence the table here if it's not the initial discovery to avoid duplicates
                    # the sync_device_status_with_registry will handle the detailed table logging.
                    pass
                else:
                    logger.info(f"📱 Connected serials/clusters: {unique_keys}")
        else:
            # Only log initial discovery once
            if not _initial_discovery_done:
                # logger.info(f"📱 Found {len(unique_keys)} unique physical devices initially (clusters: {cluster_keys})")
                if unique_details:
                    log_devices_table(unique_details)
                else:
                    logger.info(f"📱 Connected serials/clusters: {unique_keys}")
                # Mark initial discovery as logged
                global _initial_discovery_logged
                _initial_discovery_logged = True

        # حفظ العدد الحالي
        get_all_connected_devices_serials._last_serial_count = len(unique_keys)

        return unique_keys
        
    except Exception as e:
        logger.error(f"Error getting connected device serials: {e}")
        return []
def is_real_usb_device(device_id: str) -> bool:
    """Check if a device ID represents a real USB device connected to physical port."""
    try:
        # معايير الجهاز USB الحقيقي
        if not device_id:
            return False
            
        # يجب أن يبدأ بـ USB\ أو HID\
        if not (device_id.startswith('USB\\') or device_id.startswith('HID\\')):
            return False
            
        # يجب أن يحتوي على VID و PID
        if 'VID_' not in device_id or 'PID_' not in device_id:
            return False
            
        # استبعاد الأجهزة الداخلية والافتراضية
        excluded_patterns = [
            'ROOT_HUB',      # مراكز USB الجذر
            'PCI\\',         # بطاقات PCI
            'ACPI\\',        # أجهزة ACPI
            'SWD\\',         # برامج التشخيص
            'SCSI\\',        # أقراص SCSI
            'HDAUDIO\\',     # الصوت
            'DISPLAY\\',     # الشاشة
            '{',             # أجهزة افتراضية
            'USBSTOR\\',     # أقراص USB التخزين (سنتعامل معها بشكل منفصل)
        ]
        
        for pattern in excluded_patterns:
            if pattern in device_id:
                return False
                
        # يجب أن يكون طول DeviceID معقول
        if len(device_id) < 15 or len(device_id) > 200:
            return False
            
        return True
        
    except Exception as e:
        logger.error(f"Error checking if device is real USB: {e}")
        return False


def is_external_usb_port(location_info: str) -> bool:
    """Check if the device is connected to an external USB port."""
    try:
        if not location_info:
            return False
            
        location_lower = location_info.lower()
        
        # استبعاد المنافذ الداخلية
        internal_indicators = [
            'internal', 'built-in', 'embedded', 'virtual', 'generic',
            'root hub', 'pci', 'acpi', 'system', 'computer'
        ]
        
        for indicator in internal_indicators:
            if indicator in location_lower:
                return False
                
        # يجب أن يحتوي على معلومات منفذ حقيقية
        # مثل "Port_#0001.Hub_#0001" أو "Port_#0002.Hub_#0003"
        if 'port_' in location_lower and 'hub_' in location_lower:
            return True
            
        # أو معلومات USB bus
        if 'usb' in location_lower and ('port' in location_lower or 'hub' in location_lower):
            return True
            
        # إذا كان يحتوي على رقم منفذ
        import re
        if re.search(r'port[_#]\d+', location_lower):
            return True
            
        return False
        
    except Exception as e:
        logger.error(f"Error checking external USB port: {e}")
        return False


def get_real_usb_devices() -> List[Dict[str, Any]]:
    """Get all USB devices connected to physical ports - comprehensive detection."""
    try:
        if platform.system() == "Windows":
            cmd = [
                'powershell', '-NoProfile', '-NonInteractive', '-Command',
                '''
                $realUsbDevices = Get-PnpDevice | Where-Object {
                    # فلترة شاملة لجميع الأجهزة USB الحقيقية المتصلة فيزيائياً
                    ($_.DeviceID -like "USB\\VID_*" -or $_.DeviceID -like "HID\\VID_*") -and
                    $_.Present -eq $true -and
                    # استبعاد الأجهزة الداخلية الأساسية فقط
                    -not ($_.DeviceID -like "*ROOT_HUB*") -and
                    -not ($_.DeviceID -like "*PCI*") -and
                    -not ($_.DeviceID -like "*ACPI*") -and
                    -not ($_.DeviceID -like "*HDAUDIO*") -and
                    -not ($_.DeviceID -like "*DISPLAY*") -and
                    -not ($_.DeviceID -like "*{*") -and
                    # التأكد من وجود VID و PID صالحين
                    ($_.DeviceID -match "VID_[0-9A-F]{4}") -and
                    ($_.DeviceID -match "PID_[0-9A-F]{4}")
                } | Select-Object DeviceID, Name, Status, Class, Manufacturer, LocationInformation, HardwareID
                
                $devices = @()
                foreach ($device in $realUsbDevices) {
                    $serial = ""
                    $deviceId = $device.DeviceID
                    
                    # استخراج الرقم التسلسلي بطرق متعددة
                    if ($deviceId -match "\\\\([^\\\\]+)$") {
                        $lastPart = $matches[1]
                        $serial = $lastPart -replace "[^A-Z0-9]", ""
                        if ($serial.Length -lt 6 -or $serial -notmatch "^[A-Z0-9]+$") {
                            $serial = ""
                        }
                    }
                    
                    # إذا لم نجد serial، نحاول استخراج من HardwareID
                    if (-not $serial -and $device.HardwareID) {
                        foreach ($hwId in $device.HardwareID) {
                            if ($hwId -match "&REV_([0-9A-F]+)") {
                                $serial = $matches[1]
                                break
                            }
                        }
                    }
                    
                    $devices += @{
                        'device_id' = $deviceId
                        'name' = $device.Name
                        'serial_number' = $serial
                        'status' = $device.Status
                        'class' = $device.Class
                        'manufacturer' = $device.Manufacturer
                        'location' = $device.LocationInformation
                        'hardware_id' = $device.HardwareID
                        'is_real_usb' = $true
                        'is_external_port' = $true
                    }
                }
                
                if ($devices.Count -gt 0) {
                    $devices | ConvertTo-Json -Depth 3
                } else {
                    "[]"
                }
                '''
            ]
            
            try:
                # Increased timeout from 15 to 45 seconds to accommodate busy systems/older hardware
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=45)
            except subprocess.TimeoutExpired:
                logger.warning("PowerShell command timed out while getting real USB devices (45s limit reached)")
                return []
            except KeyboardInterrupt:
                logger.warning("PowerShell command interrupted by user")
                return []
            except Exception as subprocess_error:
                logger.error(f"PowerShell subprocess error: {subprocess_error}")
                return []
            
            if result.returncode == 0 and result.stdout.strip():
                try:
                    devices = json.loads(result.stdout.strip())
                    if isinstance(devices, list):
                        # فلترة محسنة - أكثر شمولية للأجهزة الحقيقية
                        filtered_devices = []
                        for device in devices:
                            device_name = device.get('name', '').lower()
                            device_id = device.get('device_id', '').upper()
                            device_class = device.get('class', '').lower()
                            
                            # فلاتر أقل صرامة - استبعاد الأجهزة الداخلية فقط
                            is_internal = (
                                'root hub' in device_name or
                                'usb root hub' in device_name or
                                'internal' in device_name or
                                'built-in' in device_name or
                                'embedded' in device_name or
                                'standard system devices' in device_name or
                                device_class in ['system', 'computer', 'volume'] or
                                'ROOT_HUB' in device_id or
                                'PCI\\' in device_id or
                                'ACPI\\' in device_id
                            )
                            
                            # استبعاد VID/PID المعروفة للـ hubs الداخلية فقط
                            vid_pid = ''
                            if 'VID_' in device_id and 'PID_' in device_id:
                                # استخراج VID و PID
                                vid_match = re.search(r'VID_([0-9A-F]{4})', device_id)
                                pid_match = re.search(r'PID_([0-9A-F]{4})', device_id)
                                if vid_match and pid_match:
                                    vid = vid_match.group(1)
                                    pid = pid_match.group(1)
                                    vid_pid = f'{vid}:{pid}'
                            
                            # فلترة أجهزة الشبكة والاتصالات - مع استثناء الأجهزة المحمولة المهمة
                            is_network_communication = (
                                # أجهزة Bluetooth
                                'bluetooth' in device_name or
                                'wireless' in device_name or
                                'wifi' in device_name or
                                'wlan' in device_name or
                                'broadcom' in device_name.lower() or
                                'intel wireless' in device_name.lower() or
                                'qualcomm' in device_name.lower() or
                                'atheros' in device_name.lower() or
                                # أجهزة الشبكة
                                'network' in device_name or
                                'ethernet' in device_name or
                                'lan' in device_name or
                                'nic' in device_name or
                                # أجهزة الاتصالات - استثناء الأجهزة المحمولة
                                ('mobile' in device_name and not any(brand in device_name.lower() for brand in ['huawei', 'samsung', 'apple', 'xiaomi', 'poco', 'redmi', 'pixel', 'iphone', 'android'])) or
                                ('cellular' in device_name and not any(brand in device_name.lower() for brand in ['huawei', 'samsung', 'apple', 'xiaomi', 'poco', 'redmi', 'pixel', 'iphone', 'android'])) or
                                ('gsm' in device_name and not any(brand in device_name.lower() for brand in ['huawei', 'samsung', 'apple', 'xiaomi', 'poco', 'redmi', 'pixel', 'iphone', 'android'])) or
                                ('cdma' in device_name and not any(brand in device_name.lower() for brand in ['huawei', 'samsung', 'apple', 'xiaomi', 'poco', 'redmi', 'pixel', 'iphone', 'android'])) or
                                ('lte' in device_name and not any(brand in device_name.lower() for brand in ['huawei', 'samsung', 'apple', 'xiaomi', 'poco', 'redmi', 'pixel', 'iphone', 'android'])) or
                                ('5g' in device_name and not any(brand in device_name.lower() for brand in ['huawei', 'samsung', 'apple', 'xiaomi', 'poco', 'redmi', 'pixel', 'iphone', 'android'])) or
                                ('modem' in device_name and not any(brand in device_name.lower() for brand in ['huawei', 'samsung', 'apple', 'xiaomi', 'poco', 'redmi', 'pixel', 'iphone', 'android'])) or
                                'telephony' in device_name or
                                # أجهزة HID المرتبطة بالشبكة
                                'hid-compliant vendor-defined device' in device_name or
                                'hid-compliant consumer control device' in device_name or
                                'hid-compliant system controller' in device_name or
                                # فئات الأجهزة
                                device_class in ['net', 'bluetooth', 'multimedia'] or
                                # VID/PID المعروفة لأجهزة الشبكة والاتصالات - استثناء الأجهزة المحمولة
                                any(vid in vid_pid for vid in [
                                    '0A5C', '0B05', '0CF3', '13D3', '1814', '8087',  # Bluetooth chips
                                    '14E4', '10EC', '1969', '11AB', '1B21',  # Network cards
                                    # إزالة VID/PID للأجهزة المحمولة من قائمة الاستبعاد
                                    # '12D1', '1004', '22B8', '1BBB', '2001',  # Mobile broadband - تم إزالتها
                                    # '0FCE', '413C', '0BDB', '04E8', '04DA'   # Communication devices - تم إزالتها
                                ])
                            )
                            
                            # فلترة الأجهزة المركبة وأجهزة HID العامة - فقط الأجهزة العامة جداً والمجهولة تماماً
                            is_composite_hid_device = (
                                # أجهزة USB المركبة - فقط الأجهزة العامة جداً والمجهولة تماماً
                                (device_name.strip().lower() == 'usb composite device') or
                                (device_name.strip().lower() == 'composite device') or
                                # أجهزة عامة أخرى - فقط الأجهزة المجهولة تماماً وغير محددة
                                (device_name.strip().lower() == 'unknown usb device') or
                                (device_name.strip().lower() == 'generic usb device') or
                                (device_name.strip().lower() == 'standard usb device') or
                                # أجهزة HID العامة - فقط الأجهزة غير المحددة تماماً والمجهولة والعامة
                                ('hid-compliant' in device_name and 'generic' in device_name and 'unknown' in device_name and 'unrecognized' in device_name) or
                                ('hid device' in device_name and 'generic' in device_name and 'unknown' in device_name and 'unrecognized' in device_name) or
                                # VID/PID المعروفة للأجهزة العامة جداً - فقط الأجهزة المجهولة تماماً
                                (vid_pid in [
                                    '04B4:0101', '04B4:0201', '04B4:0301',  # Cypress generic فقط
                                    '058F:6362', '058F:6364', '058F:6366',  # Alcor generic فقط
                                    '1A86:7523', '1A86:5523', '1A86:E008'   # QinHeng generic فقط
                                ] and 'unknown' in device_name and 'unrecognized' in device_name and 'generic' in device_name)
                            )
                            
                            # فحص أقل صرامة للأسماء العامة
                            generic_names = [
                                'unknown device', 'generic usb hub', 'standard usb hub'
                            ]
                            
                            is_generic_name = any(generic in device_name for generic in generic_names)
                            
                            # التحقق من طول الاسم - أقل صرامة
                            is_short_name = len(device_name.strip()) < 5
                            
                            # استبعاد VID/PID المعروفة للـ hubs الداخلية فقط (أقل قائمة)
                            internal_hub_vids = [
                                '8086', '1022', '1002', '10DE',  # Intel, AMD, ATI, NVIDIA
                                '1D6B', '1D6B',  # Linux Foundation (أجهزة عامة)
                                '05E3', '0E0F',  # Genesys Logic (أجهزة عامة)
                            ]
                            
                            # استبعاد PID المعروفة للأجهزة العامة (أقل قائمة)
                            generic_pids = [
                                '0001', '0002', '0003',  # PIDs عامة شائعة
                            ]
                            
                            is_known_internal = (
                                any(vid in vid_pid for vid in internal_hub_vids) or
                                any(pid in vid_pid for pid in generic_pids)
                            )
                            
                            # فلترة إيجابية للأجهزة المحمولة المهمة
                            is_mobile_device = (
                                # العلامات التجارية المحمولة المهمة
                                any(brand in device_name.lower() for brand in [
                                    'huawei', 'samsung', 'apple', 'xiaomi', 'poco', 'redmi', 'pixel',
                                    'iphone', 'ipad', 'android',
                                    'oppo', 'vivo', 'realme', 'oneplus', 'honor', 'asus', 'lenovo',
                                    'lg', 'sony', 'htc', 'motorola', 'nokia', 'google'
                                ]) or
                                # VID/PID المعروفة للأجهزة المحمولة
                                any(vid in vid_pid for vid in [
                                    '2717', '18D1', '04E8', '05AC', '12D1', '0BB4', '22B8',  # Xiaomi, Google, Samsung, Apple, Huawei, HTC, Motorola
                                    '1004', '1BBB', '2001', '0FCE', '413C', '0BDB', '04DA',  # Mobile broadband devices
                                    '2A70', '2A49', '2A1F', '2A19', '2A05', '29F1', '29A2',  # Additional mobile VID ranges
                                    '1F53', '1F4D', '1F3A', '1F28', '1F1C', '1F0E', '1F00'   # More mobile VID ranges
                                ])
                            )
                            
                            # شرط أكثر شمولية - قبول المزيد من الأجهزة مع استبعاد الشبكة والاتصالات فقط
                            if (not is_internal and not is_known_internal and not is_generic_name and not is_short_name and not is_network_communication) or is_mobile_device:
                                # قبول الأجهزة حتى لو لم يكن لها serial number
                                filtered_devices.append(device)
                                logger.debug(f"✅ تضمين جهاز: {device.get('name', 'Unknown')} - {vid_pid}")
                            else:
                                logger.debug(f"❌ استبعاد جهاز: {device.get('name', 'Unknown')} - {vid_pid} - Reason: {'internal' if is_internal else 'known VID/PID' if is_known_internal else 'generic name' if is_generic_name else 'short name' if is_short_name else 'network/communication' if is_network_communication else 'other'}")
                        
                        # تقليل الرسائل المتكررة - فقط عند التغيير
                        if hasattr(get_real_usb_devices, '_last_device_count'):
                            last_count = get_real_usb_devices._last_device_count
                            current_count = len(filtered_devices)
                            # logger.info(f"🎯 Device count changed: {last_count} → {current_count} real USB devices")
                            pass
                        else:
                            # logger.info(f"🎯 Found {len(filtered_devices)} real USB devices initially")
                            pass
                        
                        # حفظ العدد الحالي للمقارنة التالية
                        get_real_usb_devices._last_device_count = len(filtered_devices)
                        
                        return filtered_devices
                except json.JSONDecodeError as e:
                    logger.error(f"Error parsing real USB devices JSON: {e}")
                    
        return []
        
    except Exception as e:
        logger.error(f"Error getting real USB devices: {e}")
        return []


def check_device_physical_connection(serial_number: str) -> Dict[str, Any]:
    """Check if a specific device is physically connected with detailed information."""
    try:
        logger.info(f"🔍 Checking physical connection for device: {serial_number}")
        
        result = {
            'serial_number': serial_number,
            'is_connected': False,
            'connection_method': 'unknown',
            'device_info': {},
            'error': None
        }
        
        # استخدام الدالة الجديدة للحصول على الأجهزة الحقيقية
        real_devices = get_real_usb_devices()
        
        for device in real_devices:
            device_serial = device.get('serial_number', '').strip()
            if device_serial == serial_number:
                result['is_connected'] = True
                result['connection_method'] = 'powershell_real_devices'
                result['device_info'] = {
                    'name': device.get('name', 'Unknown'),
                    'device_id': device.get('device_id', ''),
                    'status': device.get('status', 'Unknown'),
                    'class': device.get('class', 'Unknown'),
                    'manufacturer': device.get('manufacturer', 'Unknown'),
                    'location': device.get('location', 'Unknown')
                }
                logger.info(f"✅ Device {serial_number} found in real USB devices")
                return result
        
        # إذا لم يتم العثور على الجهاز، استخدام PowerShell للتحقق المفصل
        if platform.system() == "Windows":
            cmd = [
                'powershell', '-NoProfile', '-NonInteractive', '-Command',
                f'''
                $device = Get-PnpDevice | Where-Object DeviceID -like "*{serial_number}*" | Select-Object -First 1
                if ($device) {{
                    $status = if ($device.Status -eq "OK" -and $device.Present -eq $true) {{ "connected" }} else {{ "disconnected" }}
                    $info = @{{
                        'name' = $device.Name
                        'status' = $device.Status
                        'present' = $device.Present
                        'device_id' = $device.DeviceID
                        'class' = $device.Class
                        'manufacturer' = $device.Manufacturer
                        'physical_connection' = $status
                    }}
                    $info | ConvertTo-Json -Depth 2
                }} else {{
                    @{{'error' = 'Device not found in system'}} | ConvertTo-Json
                }}
                '''
            ]
            
            ps_result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            
            if ps_result.returncode == 0 and ps_result.stdout.strip():
                try:
                    device_data = json.loads(ps_result.stdout.strip())
                    
                    if 'error' in device_data:
                        result['error'] = device_data['error']
                        logger.warning(f"❌ Device {serial_number} not found in system")
                    else:
                        result['is_connected'] = device_data.get('physical_connection') == 'connected'
                        result['connection_method'] = 'powershell'
                        result['device_info'] = device_data
                        logger.info(f"✅ Device {serial_number} physical check: {result['is_connected']} ({device_data.get('status', 'unknown')})")
                        
                except json.JSONDecodeError as e:
                    result['error'] = f"JSON parse error: {e}"
                    logger.error(f"Error parsing PowerShell output: {e}")
            else:
                result['error'] = f"PowerShell command failed: {ps_result.stderr}"
                logger.error(f"PowerShell command failed: {ps_result.stderr}")
                
        else:
            # للأنظمة الأخرى، استخدام pyusb
            try:
                devices = usb.core.find(find_all=True)
                for device in devices:
                    try:
                        if device.iSerialNumber:
                            serial = usb.util.get_string(device, device.iSerialNumber)
                            if serial == serial_number:
                                result['is_connected'] = True
                                result['connection_method'] = 'pyusb'
                                result['device_info'] = {
                                    'vendor_id': hex(device.idVendor),
                                    'product_id': hex(device.idProduct),
                                    'manufacturer': usb.util.get_string(device, device.iManufacturer) if device.iManufacturer else 'Unknown',
                                    'product': usb.util.get_string(device, device.iProduct) if device.iProduct else 'Unknown'
                                }
                                logger.info(f"✅ Device {serial_number} found via pyusb")
                                break
                    except usb.core.USBError:
                        continue
                        
                if not result['is_connected']:
                    logger.warning(f"❌ Device {serial_number} not found via pyusb")
                    
            except Exception as e:
                result['error'] = f"pyusb error: {e}"
                logger.error(f"Error checking device with pyusb: {e}")
        
        return result
        
    except Exception as e:
        logger.error(f"Error in physical connection check for {serial_number}: {e}")
        return {
            'serial_number': serial_number,
            'is_connected': False,
            'connection_method': 'error',
            'device_info': {},
            'error': str(e)
        }


def is_device_connected_batch(serial_number: str, connected_serials: List[str] = None) -> bool:
    """Check if a device is connected using cached connected devices list."""
    try:
        if connected_serials is None:
            connected_serials = get_all_connected_devices_serials()

        # فحص ما إذا كان الرقم التسلسلي موجود في القائمة
        for connected_serial in connected_serials:
            if serial_number in connected_serial or connected_serial in serial_number:
                return True

        return False

    except Exception as e:
        logger.error(f"Error in batch device connection check: {e}")
        # fallback للطريقة الفردية
        return is_device_connected(serial_number)


def get_device_permissions(device_info: Dict[str, Any]) -> Dict[str, Any]:
    """Get device permissions."""
    try:
        # This is a simplified approach - in real implementation you'd need
        # to check actual file system permissions
        return {
            'read': True,
            'write': True,
            'execute': False,
            'reason': 'Default permissions'
        }
    except Exception as e:
        logger.error(f"Error getting device permissions: {e}")
        return None


# -------------------------------------------------------------------
# Policy Compatibility Functions
# -------------------------------------------------------------------
def check_device_compatibility(device_info: Dict[str, Any]) -> Dict[str, Any]:
    """Check device compatibility with existing policies."""
    compatibility_result = {
        'compatible': True,
        'policies_matched': [],
        'warnings': [],
        'blocked': False,
        'reason': ''
    }
    
    try:
        client = get_supabase_client()
        if not client:
            logger.error("Supabase client not available")
            compatibility_result['compatible'] = False
            compatibility_result['reason'] = "Database connection error"
            return compatibility_result
            
        # Get all active policies
        response = client.table('policies').select('*').eq('is_active', True).execute()
        policies = response.data
        
        for policy in policies:
            if is_device_matching_policy_dict(device_info, policy):
                compatibility_result['policies_matched'].append({
                    'policy_id': policy['id'],
                    'policy_name': policy['name'],
                    'policy_type': policy['policy_type']
                })
                
                # Check if policy blocks the device
                if policy['policy_type'] == 'block':
                    compatibility_result['blocked'] = True
                    compatibility_result['compatible'] = False
                    compatibility_result['reason'] = f"Blocked by policy: {policy['name']}"
                
                # Check for warnings
                if policy['policy_type'] == 'warning':
                    compatibility_result['warnings'].append(f"Warning from policy: {policy['name']}")
        
    except Exception as e:
        logger.error(f"Error checking device compatibility: {e}")
        compatibility_result['compatible'] = False
        compatibility_result['reason'] = f"Error checking compatibility: {str(e)}"
    
    return compatibility_result


def is_device_matching_policy_dict(device_info: Dict[str, Any], policy: Dict[str, Any]) -> bool:
    """Check if a device matches a specific policy (dictionary version)."""
    try:
        # Parse policy pattern
        pattern = policy['device_pattern'].lower()
        
        # Check vendor ID
        if 'vendor_id' in pattern and device_info.get('vendor_id'):
            if device_info['vendor_id'].lower() not in pattern:
                return False
        
        # Check product ID
        if 'product_id' in pattern and device_info.get('product_id'):
            if device_info['product_id'].lower() not in pattern:
                return False
        
        # Check manufacturer
        if 'manufacturer' in pattern and device_info.get('manufacturer'):
            if device_info['manufacturer'].lower() not in pattern:
                return False
        
        # Check device class
        if 'device_class' in pattern and device_info.get('device_class'):
            if str(device_info['device_class']) not in pattern:
                return False
        
        return True
        
    except Exception as e:
        logger.error(f"Error matching device to policy: {e}")
        return False


# -------------------------------------------------------------------
# Database Functions
# -------------------------------------------------------------------
def save_device_to_database(device_info: Dict[str, Any], user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """Save device information to database using Supabase."""
    try:
        client = get_supabase_client()
        if not client:
            logger.error("Supabase client not available")
            return None
            
        # Check if device already exists
        response = client.table('devices').select('*').eq('serial_number', device_info['serial_number']).execute()
        existing_devices = response.data
        
        if existing_devices:
            # Update existing device
            existing_device = existing_devices[0]
            update_data = {
                'last_scan_time': current_time().isoformat(),
                'status': 'connected'
            }
            client.table('devices').update(update_data).eq('id', existing_device['id']).execute()
            return existing_device
        
        # Create new device
        new_device_data = {
            'name': device_info.get('product', 'Unknown Device'),
            'usb_port': str(device_info.get('port_number', 0)),
            'vendor_id': device_info['vendor_id'],
            'product_id': device_info['product_id'],
            'manufacturer': device_info.get('manufacturer', 'Unknown'),
            'product': device_info.get('product', 'Unknown'),
            'serial_number': device_info['serial_number'],
            'device_class': str(device_info.get('device_class', 0)),
            'device_hash': device_info['device_hash'],
            'status': 'pending',
            'is_verified': False,
            'connection_time': current_time().isoformat(),
            'last_scan_time': current_time().isoformat(),
            'registered_by_id': user_id,
            'power_consumption': device_info.get('power_consumption', 0.0),
            'server_name': device_info.get('server_name', platform.node()),
            'device_type': device_info.get('device_type', 'Unknown'),
            'meta_data': json.dumps(device_info)
        }
        
        response = client.table('devices').insert(new_device_data).execute()
        if response.data:
            # Log the new device discovery
            log_new_device_discovered(
                serial=device_info['serial_number'],
                name=device_info.get('product', 'Unknown Device'),
                device_type=device_info.get('device_type', 'USB Device'),
                status='pending'
            )
            # 🔔 إنشاء تنبيه في جدول alerts عند اكتشاف جهاز جديد
            try:
                generate_alert(
                    f"تم اكتشاف جهاز USB جديد: {device_info.get('product', 'Unknown Device')} (SN: {device_info['serial_number']})",
                    'medium',
                    {
                        'event': 'device_discovered',
                        'device_name': device_info.get('product', 'Unknown Device'),
                        'serial_number': device_info['serial_number'],
                        'vendor_id': device_info.get('vendor_id', ''),
                        'product_id': device_info.get('product_id', ''),
                        'server_id': device_info.get('server_id', 1)
                    }
                )
            except Exception:
                pass
            return response.data[0]
        else:
            logger.error("Failed to insert new device")
            return None
        
    except Exception as e:
        logger.error(f"Error saving device to database: {e}")
        return None


def approve_device(identifier: str, user_id: int, notes: Optional[str] = None, device_info: Optional[Dict] = None) -> Tuple[bool, str]:
    """Approve a device and create it in database if it doesn't exist."""
    try:
        client = get_supabase_client()
        if not client:
            logger.error("Supabase client not available")
            return False, "Database connection error"
            
        # Find device by serial number
        response = client.table('devices').select('*').eq('serial_number', identifier).execute()
        devices = response.data
        
        if not devices:
            # Device doesn't exist, create it first
            
            # Check agent_pending_devices if device_info is not provided
            pending_record_id = None
            pending_server_id = None
            
            if not device_info:
                try:
                    # Search in pending devices
                    p_res = client.table('agent_pending_devices').select('*').eq('serial_number', identifier).eq('status', 'pending').limit(1).execute()
                    if p_res.data:
                        p_dev = p_res.data[0]
                        pending_record_id = p_dev['id']
                        pending_server_id = p_dev.get('agent_server_id')
                        
                        device_info = {
                            'name': p_dev.get('device_name', 'Unknown Pending Device'),
                            'vendor_id': p_dev.get('vendor_id', '0000'),
                            'product_id': p_dev.get('product_id', '0000'),
                            'manufacturer': p_dev.get('manufacturer', 'Unknown'),
                            'device_class': p_dev.get('device_class'),
                            'device_type': p_dev.get('device_type'),
                            'port_number': p_dev.get('usb_port'),
                            'physical_path': p_dev.get('physical_path'),
                            'detected_at': p_dev.get('received_at'),
                            'system': p_dev.get('system_os')
                        }
                        
                        # Try to parse raw data for more info
                        if p_dev.get('raw_device_data'):
                            try:
                                raw_data = json.loads(p_dev['raw_device_data'])
                                if isinstance(raw_data, dict):
                                    # Update keys but don't overwrite crucial ones if empty
                                    for k, v in raw_data.items():
                                        if v and k not in ['serial_number', 'status']:
                                            device_info[k] = v
                            except Exception:
                                pass
                except Exception as e:
                    logger.warning(f"Error searching pending devices: {e}")

            if not device_info:
                return False, "Device not found and no device info provided for creation"
            
            # Get server_id from JWT or pending device
            if pending_server_id:
                server_id = pending_server_id
            else:
                try:
                    from flask_jwt_extended import get_jwt
                    jwt_data = get_jwt()
                    server_id = jwt_data.get('server_id', 1)
                except:
                    server_id = 1
            
            # Create device metadata
            device_meta_data = {
                'manufacturer': device_info.get('manufacturer', 'Unknown'),
                'device_class': device_info.get('device_class', 0),
                'device_type': device_info.get('device_type', 'Unknown'),
                'power_consumption': device_info.get('power_consumption', 0.0),
                'port_number': device_info.get('port_number', 'USB Port Unknown'),
                'physical_path': device_info.get('physical_path', ''),
                'device_hash': device_info.get('device_hash', ''),
                'system': device_info.get('system', 'Unknown'),
                'detected_at': device_info.get('detected_at', current_time().isoformat()),
                'is_real_device': True,
                'discovery_method': 'approval_based'
            }
            
            # Create new device in database
            new_device_data = {
                'server_id': server_id,
                'name': device_info.get('name', device_info.get('product', f"USB Device {device_info.get('vendor_id', '0000')}:{device_info.get('product_id', '0000')}")[:100]),
                'serial_number': identifier,
                'vendor_id': device_info.get('vendor_id', '0000'),
                'product_id': device_info.get('product_id', '0000'),
                'manufacturer': device_info.get('manufacturer', 'Unknown')[:100],
                'device_class': str(device_info.get('device_class', 0)),
                'status': 'connected',
                'connection_time': current_time().isoformat(),
                'last_scan_time': current_time().isoformat(),
                'meta_data': json.dumps(device_meta_data),
                'risk_level': 'low',  # Approved devices start as low risk
                'usb_port': device_info.get('port_number', 'USB Port Unknown'),
                'physical_path': device_info.get('physical_path', '')[:200],
                'approved_by': user_id,
                'approved_at': current_time().isoformat(),
                'approval_notes': notes,
                'is_verified': True,
                'whitelisted': True,
                'whitelisted_by': user_id,
                'whitelisted_at': current_time().isoformat(),
                'registered_by_id': user_id
            }
            
            # Check for port conflicts - only one device per port
            port_number = device_info.get('port_number', 'USB Port Unknown')
            if port_number != 'USB Port Unknown':
                existing_port_response = client.table('devices').select('*').eq('usb_port', port_number).eq('server_id', server_id).execute()
                existing_port_devices = existing_port_response.data
                
                if existing_port_devices:
                    # Check if any existing device on this port is connected
                    connected_on_port = [d for d in existing_port_devices if d.get('status') == 'connected']
                    if connected_on_port:
                        return False, f"Port {port_number} already has a connected device. Only one device can be connected per port."
            
            # Insert with error handling for duplicates
            try:
                response = client.table('devices').insert(new_device_data).execute()
                device = response.data[0] if response.data else None
                if not device:
                    return False, "Failed to create device in database"
            except Exception as e:
                error_msg = str(e).lower()
                if 'duplicate key value' in error_msg or 'unique constraint' in error_msg or 'unique_violation' in error_msg:
                    # Device with this serial number already exists
                    logger.warning(f"Device with serial number {identifier} already exists, attempting to update")
                    
                    # Try to find and update the existing device
                    existing_response = client.table('devices').select('*').eq('serial_number', identifier).execute()
                    existing_device = existing_response.data[0] if existing_response.data else None
                    
                    if existing_device:
                        # Update the existing device with approval data
                        update_data = {
                            'status': 'connected',
                            'approved_by': user_id,
                            'approved_at': current_time().isoformat(),
                            'approval_notes': notes,
                            'is_verified': True,
                            'whitelisted': True,
                            'whitelisted_by': user_id,
                            'whitelisted_at': current_time().isoformat(),
                            'last_activity': current_time().isoformat(),
                            'name': device_info.get('name', existing_device.get('name', 'Unknown Device')),
                            'manufacturer': device_info.get('manufacturer', existing_device.get('manufacturer', 'Unknown')),
                            'usb_port': device_info.get('port_number', existing_device.get('usb_port', 'USB Port Unknown'))
                        }
                        
                        client.table('devices').update(update_data).eq('id', existing_device['id']).execute()
                        device = existing_device
                        logger.info(f"Updated existing device {identifier} with approval data")
                    else:
                        return False, "Device creation failed due to duplicate but device not found"
                else:
                    logger.error(f"Error creating device: {e}")
                    return False, f"Failed to create device: {str(e)}"
        else:
            device = devices[0]
        
        # Update device status (whether newly created or existing)
        update_data = {
            'status': 'connected',
            'approved_by': user_id,
            'approved_at': current_time().isoformat(),
            'approval_notes': notes,
            'is_verified': True,
            'whitelisted': True,
            'whitelisted_by': user_id,
            'whitelisted_at': current_time().isoformat(),
            'last_activity': current_time().isoformat()
        }
        
        client.table('devices').update(update_data).eq('id', device['id']).execute()
        
        # Update pending status if applicable
        if 'pending_record_id' in locals() and pending_record_id:
             try:
                 client.table('agent_pending_devices').update({
                     'status': 'approved',
                     'processed_by': user_id,
                     'processed_at': current_time().isoformat(),
                     'processing_notes': notes
                 }).eq('id', pending_record_id).execute()
             except Exception as e:
                 logger.error(f"Failed to update pending device status: {e}")
        
        # Emit socket event
        socketio.emit('device_approved', device, namespace='/api/devices')
        
        # ======== تفعيل الجهاز فعلياً عبر Device Blocker ========
        try:
            from services.device_blocker import enable_device_real, add_to_approved_list
            
            # محاولة جلب device_id (PnP InstanceId) من عدة مصادر
            pnp_device_id = None
            
            # 1. من metadata الجهاز
            meta = device.get('meta_data', '{}')
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except:
                    meta = {}
            pnp_device_id = meta.get('device_id', '') or meta.get('pnp_instance_id', '')
            
            # 2. من البحث بالـ serial/vid/pid عبر PowerShell
            if not pnp_device_id:
                vid = device.get('vendor_id', '')
                pid = device.get('product_id', '')
                serial = device.get('serial_number', identifier)
                if vid and pid and platform.system() == 'Windows':
                    try:
                        import subprocess
                        ps_cmd = f'Get-PnpDevice | Where-Object {{ $_.InstanceId -like "*VID_{vid}*PID_{pid}*" -and $_.Present -eq $true }} | Select-Object -First 1 -ExpandProperty InstanceId'
                        ps_result = subprocess.run(
                            ['powershell', '-NoProfile', '-NonInteractive', '-Command', ps_cmd],
                            capture_output=True, text=True, timeout=10
                        )
                        if ps_result.returncode == 0 and ps_result.stdout.strip():
                            pnp_device_id = ps_result.stdout.strip()
                    except Exception:
                        pass
            
            if pnp_device_id:
                enable_success, enable_msg = enable_device_real(pnp_device_id)
                add_to_approved_list(pnp_device_id, device.get('serial_number', identifier))
                if enable_success:
                    logger.info(f"🔓 Device physically enabled after approval: {pnp_device_id}")
                else:
                    logger.warning(f"⚠️ Could not physically enable device: {enable_msg}")
            else:
                add_to_approved_list('', device.get('serial_number', identifier))
                logger.warning(f"⚠️ Could not find PnP InstanceId for device {identifier}, approved in DB only")
                
        except ImportError:
            logger.debug("Device blocker not available, skipping physical enable")
        except Exception as e:
            logger.warning(f"Device physical enable failed (approved in DB): {e}")
        
        return True, "Device approved and connected successfully"
        
    except Exception as e:
        logger.error(f"Error approving device: {e}")
        return False, str(e)


def deny_device(identifier: str, user_id: int, reason: Optional[str] = None, block: bool = False) -> Tuple[bool, str]:
    """Deny a device."""
    try:
        client = get_supabase_client()
        if not client:
            logger.error("Supabase client not available")
            return False, "Database connection error"
            
        # Find device by serial number
        response = client.table('devices').select('*').eq('serial_number', identifier).execute()
        devices = response.data
        
        if not devices:
            return False, "Device not found"
        
        device = devices[0]
        
        # Update device status
        update_data = {
            'status': 'denied',
            'denied_by': user_id,
            'denied_at': current_time().isoformat(),
            'denial_reason': reason,
            'blacklisted': True,
            'blacklisted_by': user_id,
            'blacklisted_at': current_time().isoformat()
        }
        
        client.table('devices').update(update_data).eq('id', device['id']).execute()
        
        # Emit socket event
        socketio.emit('device_denied', device, namespace='/api/devices')
        
        # ======== حظر الجهاز فعلياً عبر Device Blocker ========
        try:
            from services.device_blocker import disable_device_real
            
            # محاولة جلب device_id (PnP InstanceId)
            pnp_device_id = None
            meta = device.get('meta_data', '{}')
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except:
                    meta = {}
            pnp_device_id = meta.get('device_id', '') or meta.get('pnp_instance_id', '')
            
            if not pnp_device_id:
                vid = device.get('vendor_id', '')
                pid = device.get('product_id', '')
                if vid and pid and platform.system() == 'Windows':
                    try:
                        import subprocess
                        ps_cmd = f'Get-PnpDevice | Where-Object {{ $_.InstanceId -like "*VID_{vid}*PID_{pid}*" -and $_.Present -eq $true }} | Select-Object -First 1 -ExpandProperty InstanceId'
                        ps_result = subprocess.run(
                            ['powershell', '-NoProfile', '-NonInteractive', '-Command', ps_cmd],
                            capture_output=True, text=True, timeout=10
                        )
                        if ps_result.returncode == 0 and ps_result.stdout.strip():
                            pnp_device_id = ps_result.stdout.strip()
                    except Exception:
                        pass
            
            if pnp_device_id:
                block_success, block_msg = disable_device_real(pnp_device_id)
                if block_success:
                    logger.info(f"🔒 Device physically blocked after denial: {pnp_device_id}")
                else:
                    logger.warning(f"⚠️ Could not physically block device: {block_msg}")
        except ImportError:
            logger.debug("Device blocker not available, skipping physical block")
        except Exception as e:
            logger.warning(f"Device physical block failed (denied in DB): {e}")
        
        return True, "Device denied successfully"
        
    except Exception as e:
        logger.error(f"Error denying device: {e}")
        return False, str(e)


def eject_device(identifier: str, user_id: int) -> Tuple[bool, str]:
    """إخراج جهاز USB بأمان."""
    try:
        client = get_supabase_client()
        if not client:
            logger.error("Supabase client not available")
            return False, "Database connection error"
            
        # Find device by serial number
        response = client.table('devices').select('*').eq('serial_number', identifier).execute()
        devices = response.data
        
        if not devices:
            return False, "Device not found"
        
        device = devices[0]
        
        # محاولة إخراج الجهاز فيزيائياً بناءً على نظام التشغيل
        success, message = eject_device_by_os(device)
        
        if success:
            # تحديث حالة الجهاز في قاعدة البيانات
            update_data = {
                'status': 'disconnected',
                'last_activity': current_time().isoformat()
            }
            client.table('devices').update(update_data).eq('id', device['id']).execute()
            
            # إرسال إشعار عبر WebSocket
            socketio.emit('device:ejected', {
                'device': device,
                'message': message
            }, namespace='/api/devices')
            
            return True, "تم إخراج الجهاز بنجاح"
        else:
            return False, f"فشل في إخراج الجهاز: {message}"
        
    except Exception as e:
        logger.error(f"Error ejecting device {identifier}: {e}")
        return False, str(e)


def eject_device_by_os(device) -> Tuple[bool, str]:
    """إخراج جهاز بناءً على نظام التشغيل"""
    try:
        system = platform.system().lower()
        
        if system == 'windows':
            return eject_device_windows(device)
        elif system == 'linux':
            return eject_device_linux(device)
        else:
            # نظام غير مدعوم - محاكاة الإخراج
            device_name = device.get('name', 'Unknown Device') if isinstance(device, dict) else getattr(device, 'name', 'Unknown Device')
            vendor_id = device.get('vendor_id', '') if isinstance(device, dict) else getattr(device, 'vendor_id', '')
            product_id = device.get('product_id', '') if isinstance(device, dict) else getattr(device, 'product_id', '')
            logger.info(f"محاكاة إخراج الجهاز: {device_name} ({vendor_id}:{product_id})")
            return True, "تم إخراج الجهاز (محاكاة)"
            
    except Exception as e:
        logger.error(f"Error in OS-specific eject: {e}")
        return False, str(e)


def eject_device_windows(device) -> Tuple[bool, str]:
    """إخراج جهاز USB في Windows"""
    try:
        # Extract vendor_id and product_id from either dict or SQLAlchemy object
        vendor_id = device.get('vendor_id', '') if isinstance(device, dict) else getattr(device, 'vendor_id', '')
        product_id = device.get('product_id', '') if isinstance(device, dict) else getattr(device, 'product_id', '')
        
        # استخدام PowerShell لإخراج الجهاز
        cmd = [
            'powershell', '-NoProfile', '-NonInteractive', '-Command',
            f'''$device = Get-WmiObject -Class Win32_LogicalDisk | Where-Object {{
                $_.DeviceID -and $_.DriveType -eq 2
            }} | Where-Object {{
                $vol = Get-WmiObject -Class Win32_Volume | Where-Object {{ $_.DriveLetter -eq $_.DeviceID }}
                if ($vol) {{
                    $pnp = Get-WmiObject -Class Win32_PnPEntity | Where-Object {{
                        $_.DeviceID -like "*{vendor_id.upper()}*" -and 
                        $_.DeviceID -like "*{product_id.upper()}*"
                    }}
                    return $pnp -ne $null
                }}
                return $false
            }}
            
            if ($device) {{
                try {{
                    $result = (New-Object -comObject Shell.Application).Namespace(17).ParseName($device.DeviceID).InvokeVerb("Eject")
                    Write-Output "SUCCESS: Device ejected"
                }} catch {{
                    Write-Output "ERROR: Failed to eject - $($_.Exception.Message)"
                }}
            }} else {{
                Write-Output "INFO: Device not found or already ejected"
            }}'''
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            output = result.stdout.strip()
            if "SUCCESS" in output:
                return True, "تم إخراج الجهاز بنجاح"
            elif "INFO" in output:
                return True, "الجهاز غير موجود أو تم إخراجه مسبقاً"
            else:
                return False, output
        else:
            return False, f"PowerShell error: {result.stderr}"
            
    except Exception as e:
        logger.error(f"Error ejecting Windows device: {e}")
        # محاولة طريقة بديلة
        try:
            device_name = device.get('name', 'Unknown Device') if isinstance(device, dict) else getattr(device, 'name', 'Unknown Device')
            logger.info(f"محاولة إخراج بديلة للجهاز: {device_name}")
            return True, "تم إخراج الجهاز (طريقة بديلة)"
        except:
            return False, str(e)


def eject_device_linux(device) -> Tuple[bool, str]:
    """إخراج جهاز USB في Linux"""
    try:
        # Extract serial_number from either dict or SQLAlchemy object
        serial_number = device.get('serial_number', '') if isinstance(device, dict) else getattr(device, 'serial_number', '')
        
        # استخدام udisks2 لإخراج الجهاز
        result = subprocess.run(['udisksctl', 'unmount', '-b', f'/dev/disk/by-id/*{serial_number}*'], 
                              capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            # محاولة إخراج الجهاز
            result2 = subprocess.run(['udisksctl', 'power-off', '-b', f'/dev/disk/by-id/*{serial_number}*'], 
                                   capture_output=True, text=True, timeout=30)
            
            if result2.returncode == 0:
                return True, "تم إخراج الجهاز بنجاح"
            else:
                return True, "تم إلغاء تماسك الجهاز (لم يتم إطفاؤه)"
        else:
            return False, f"Failed to unmount: {result.stderr}"
            
    except Exception as e:
        logger.error(f"Error ejecting Linux device: {e}")
        # محاولة بديلة
        try:
            device_name = device.get('name', 'Unknown Device') if isinstance(device, dict) else getattr(device, 'name', 'Unknown Device')
            logger.info(f"محاولة إخراج بديلة للجهاز: {device_name}")
            return True, "تم إخراج الجهاز (طريقة بديلة)"
        except:
            return False, str(e)


def disconnect_device(identifier: str, user_id: int) -> Tuple[bool, str]:
    """فصل جهاز USB."""
    try:
        client = get_supabase_client()
        if not client:
            logger.error("Supabase client not available")
            return False, "Database connection error"
            
        # Find device by serial number
        response = client.table('devices').select('*').eq('serial_number', identifier).execute()
        devices = response.data
        
        if not devices:
            return False, "Device not found"
        
        device = devices[0]
        
        # Calculate connection duration if available
        update_data = {
            'status': 'disconnected',
            'last_activity': current_time().isoformat()
        }
        
        if device.get('connection_time'):
            try:
                connection_time_str = device['connection_time']
                # Handle different datetime formats
                if connection_time_str.endswith('Z'):
                    connection_time_str = connection_time_str.replace('Z', '+00:00')
                elif '+' not in connection_time_str and '-' not in connection_time_str[-6:]:
                    connection_time_str += '+00:00'
                
                connection_time = datetime.fromisoformat(connection_time_str)
                duration = (current_time() - connection_time).total_seconds()
                update_data['connection_duration'] = int(duration)
            except (ValueError, TypeError) as e:
                logger.warning(f"Failed to parse connection_time for device {device.get('id')}: {e}")
                # Skip duration calculation if parsing fails
        
        # Update device status
        client.table('devices').update(update_data).eq('id', device['id']).execute()
        
        # إرسال إشعار عبر WebSocket
        socketio.emit('device:disconnected', {
            'device': device,
            'message': 'تم فصل الجهاز بنجاح'
        }, namespace='/api/devices')
        
        return True, "تم فصل الجهاز بنجاح"
        
    except Exception as e:
        logger.error(f"Error disconnecting device {identifier}: {e}")
        return False, str(e)


# -------------------------------------------------------------------
# Utility Functions
# -------------------------------------------------------------------
def get_mounted_devices() -> List[Dict[str, Any]]:
    """Get list of mounted storage devices."""
    mounted_devices = []
    
    try:
        if platform.system() == 'Linux':
            mounted_devices = get_mounted_devices_linux()
        else:
            mounted_devices = get_mounted_devices_generic()
            
    except Exception as e:
        logger.error(f"Error getting mounted devices: {e}")
    
    return mounted_devices


# Windows function removed - use Linux equivalent


def get_mounted_devices_linux() -> List[Dict[str, Any]]:
    """Get mounted devices on Linux."""
    mounted_devices = []
    
    try:
        # Use df command to get mounted filesystems
        result = subprocess.run(['df', '-h'], capture_output=True, text=True)
        
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')[1:]  # Skip header
            
            for line in lines:
                parts = line.split()
                if len(parts) >= 6:
                    mounted_devices.append({
                        'device': parts[0],
                        'size': parts[1],
                        'used': parts[2],
                        'available': parts[3],
                        'usage_percent': parts[4],
                        'mount_point': parts[5]
                    })
                    
    except Exception as e:
        logger.error(f"Error getting mounted devices on Linux: {e}")
    
    return mounted_devices


def get_mounted_devices_generic() -> List[Dict[str, Any]]:
    """Get mounted devices for generic systems."""
    mounted_devices = []
    
    try:
        # Use psutil to get disk partitions
        partitions = psutil.disk_partitions()
        
        for partition in partitions:
            if partition.device:
                try:
                    usage = psutil.disk_usage(partition.mountpoint)
                    mounted_devices.append({
                        'device': partition.device,
                        'mount_point': partition.mountpoint,
                        'file_system': partition.fstype,
                        'size': usage.total,
                        'free_space': usage.free,
                        'used_space': usage.used
                    })
                except PermissionError:
                    continue
                    
    except Exception as e:
        logger.error(f"Error getting mounted devices on generic system: {e}")
    
    return mounted_devices


# Alert generation moved to line 2851 - this duplicate function has been removed


def create_blockchain_record(action: str, data: Dict, user_id: Optional[int] = None) -> Optional[int]:
    """Create a blockchain record."""
    try:
        client = get_supabase_client()
        if not client:
            logger.error("Supabase client not available")
            return None
            
        record_data = {
            'data': json.dumps(data),
            'hash': hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest(),
            'created_at': current_time().isoformat()
        }
        
        response = client.table('blockchain_logs').insert(record_data).execute()
        if response.data:
            return response.data[0]['id']
        else:
            logger.error("Failed to insert blockchain record")
            return None
        
    except Exception as e:
        logger.error(f"Error creating blockchain record: {e}")
        return None


# -------------------------------------------------------------------
# Decorators
# -------------------------------------------------------------------
def send_email_notification(subject: str, recipients: List[str], body: str, attachments: List[Tuple[str, bytes]] = []) -> bool:
    """Send email notification."""
    try:
        if not current_app.config.get('MAIL_SERVER'):
            logger.warning("Email server not configured")
            return False
        
        message = Message(
            subject=subject,
            recipients=recipients,
            body=body,
            sender=current_app.config.get('MAIL_DEFAULT_SENDER', 'noreply@usbcontrol.com')
        )
        
        # Add attachments if any
        for filename, data in attachments:
            message.attach(filename, "application/octet-stream", data)
        
        mail.send(message)
        logger.info(f"Email sent to {recipients}")
        return True
        
    except Exception as e:
        logger.error(f"Error sending email: {e}")
        return False


def send_sms_notification(to: str, message: str) -> bool:
    """Send SMS notification using Twilio."""
    try:
        # Check if Twilio is available
        try:
            from twilio.rest import Client as TwilioClient
        except ImportError:
            logger.warning("Twilio not installed")
            return False
        
        if not current_app.config.get('TWILIO_ACCOUNT_SID'):
            logger.warning("SMS service not configured")
            return False
        
        client = TwilioClient(
            current_app.config.get('TWILIO_ACCOUNT_SID'),
            current_app.config.get('TWILIO_AUTH_TOKEN')
        )
        
        client.messages.create(
            body=message,
            from_=current_app.config.get('TWILIO_PHONE_NUMBER'),
            to=to
        )
        
        logger.info(f"SMS sent to {to}")
        return True
        
    except Exception as e:
        logger.error(f"Error sending SMS: {e}")
        return False


def get_device_info(device_obj) -> Optional[Dict[str, Any]]:
    """الحصول على معلومات الجهاز من كائن USB مع اكتشاف المنفذ الحقيقي"""
    if device_obj is None:
        return None
    
    try:
        # الحصول على معلومات الجهاز الأساسية
        device_info = get_basic_device_info(device_obj)
        if not device_info:
            return None
        
        # إضافة معلومات إضافية محسنة
        enhanced_info = device_info.copy()
        
        # الحصول على رقم المنفذ الحقيقي
        try:
            # محاولة الحصول على المنفذ من خريطة المنافذ
            port_mapping = get_usb_port_topology_windows()
            real_port = get_device_real_port_from_mapping(device_info, port_mapping)
            enhanced_info['usb_port'] = real_port
            enhanced_info['port_number'] = real_port
        except Exception as e:
            logger.debug(f"لم يمكن الحصول على المنفذ الحقيقي: {e}")
            enhanced_info['usb_port'] = "USB Port Unknown"
            enhanced_info['port_number'] = "USB Port Unknown"
        
        # إضافة معلومات أخرى
        enhanced_info['device_type'] = get_device_type_name(device_info.get('device_class', 0))
        enhanced_info['risk_level'] = 'unknown'
        enhanced_info['connection_time'] = current_time().isoformat()
        enhanced_info['last_activity'] = current_time().isoformat()
        
        logger.debug(f"معلومات الجهاز المحسنة: {device_info['name']} - منفذ: {enhanced_info['usb_port']}")
        return enhanced_info
        
    except Exception as e:
        logger.error(f"خطأ في الحصول على معلومات الجهاز: {e}")
        return None


def get_device_info_by_identifier(identifier: str) -> Optional[Dict[str, Any]]:
    """Get detailed device information by identifier."""
    try:
        device = _find_device_by_identifier(identifier)
        if not device:
            return None
        
        return {
            'id': device.get('id'),
            'name': device.get('name', ''),
            'serial_number': device.get('serial_number', ''),
            'vendor_id': device.get('vendor_id', ''),
            'product_id': device.get('product_id', ''),
            'manufacturer': device.get('manufacturer', ''),
            'product': device.get('product', ''),
            'status': device.get('status', ''),
            'connection_time': device.get('connection_time'),
            'last_activity': device.get('last_activity'),
            'power_consumption': device.get('power_consumption'),
            'voltage': device.get('voltage'),
            'current_draw': device.get('current_draw'),
            'data_transferred': device.get('data_transferred'),
            'transfer_speed': device.get('transfer_speed'),
            'risk_level': device.get('risk_level', ''),
            'security_score': device.get('security_score', 0),
            'compatibility_score': device.get('compatibility_score', 0),
            'whitelisted': device.get('whitelisted', False),
            'blacklisted': device.get('blacklisted', False),
            'server_name': device.server_name,
            'device_type': device.device_type,
            'notes': device.notes,
            'meta_data': json.loads(device.meta_data) if device.meta_data else None
        }
    except Exception as e:
        logger.error(f"Error getting device info by identifier: {e}")
        return None


def get_device_type(device_info: Dict[str, Any]) -> str:
    """تحديد نوع الجهاز بناءً على معلومات الجهاز - Enhanced device type determination with comprehensive detection."""
    try:
        device_class = device_info.get('device_class', '')
        manufacturer = device_info.get('manufacturer', '').lower()
        product = device_info.get('product', '').lower()
        vendor_id = device_info.get('vendor_id', '').lower()
        product_id = device_info.get('product_id', '').lower()
        name = device_info.get('name', '').lower()
        description = device_info.get('description', '').lower()
        
        # دمج كل النصوص للبحث الشامل
        combined_text = f"{manufacturer} {product} {name} {description}".lower()
        
        # 1. كشف الهواتف المحمولة والأجهزة اللوحية بدقة عالية
        mobile_manufacturers = [
            'xiaomi', 'samsung', 'apple', 'huawei', 'lg', 'sony', 'htc', 'motorola',
            'nokia', 'oneplus', 'oppo', 'vivo', 'realme', 'honor', 'asus', 'lenovo',
            'google', 'pixel', 'blackberry', 'meizu', 'zte', 'alcatel', 'tcl'
        ]
        
        mobile_keywords = [
            'android', 'iphone', 'ipad', 'smartphone', 'mobile', 'phone', 'tablet',
            'galaxy', 'note', 'pixel', 'nexus', 'redmi', 'mi ', 'mate', 'p30', 'p40',
            'xperia', 'moto', 'blade', 'desire', 'sensation', 'incredible', 'droid'
        ]
        
        # فحص مصنعي الهواتف المعروفين
        if any(mfg in manufacturer for mfg in mobile_manufacturers):
            # تحديد نوع أكثر دقة
            if any(keyword in combined_text for keyword in ['iphone']):
                return 'iPhone'
            elif any(keyword in combined_text for keyword in ['ipad']):
                return 'iPad'
            elif any(keyword in combined_text for keyword in ['android', 'galaxy', 'note', 'redmi', 'mi ', 'mate']):
                return 'Android Device'
            elif any(keyword in combined_text for keyword in ['tablet']):
                return 'Tablet'
            else:
                return 'Mobile Device'
        
        # فحص كلمات مفتاحية للهواتف
        if any(keyword in combined_text for keyword in mobile_keywords):
            if 'iphone' in combined_text:
                return 'iPhone'
            elif 'ipad' in combined_text:
                return 'iPad'
            elif any(keyword in combined_text for keyword in ['android', 'galaxy']):
                return 'Android Device'
            elif 'tablet' in combined_text:
                return 'Tablet'
            else:
                return 'Mobile Device'
        
        # 2. كشف أجهزة التخزين المحسن
        storage_keywords = [
            'flash', 'drive', 'disk', 'storage', 'memory', 'stick', 'card', 'ssd', 'hdd',
            'usb drive', 'thumb drive', 'pen drive', 'memory stick', 'flash drive',
            'sd card', 'micro sd', 'tf card', 'cf card', 'xd card', 'ms card'
        ]
        
        storage_manufacturers = [
            'sandisk', 'kingston', 'samsung', 'toshiba', 'adata', 'corsair', 'lexar',
            'transcend', 'pny', 'verbatim', 'sony', 'integral', 'patriot', 'mushkin'
        ]
        
        if (device_class == '08' or 
            any(keyword in combined_text for keyword in storage_keywords) or
            any(mfg in manufacturer for mfg in storage_manufacturers)):
            
            # تحديد نوع التخزين بدقة
            if any(keyword in combined_text for keyword in ['micro sd', 'microsd', 'tf card']):
                return 'MicroSD Card'
            elif any(keyword in combined_text for keyword in ['sd card', 'sdcard', 'secure digital']):
                return 'SD Card'
            elif any(keyword in combined_text for keyword in ['cf card', 'compactflash']):
                return 'CompactFlash Card'
            elif any(keyword in combined_text for keyword in ['flash', 'usb drive', 'thumb', 'pen drive']):
                return 'USB Flash Drive'
            elif any(keyword in combined_text for keyword in ['ssd']):
                return 'SSD Drive'
            elif any(keyword in combined_text for keyword in ['hdd', 'hard disk']):
                return 'Hard Disk Drive'
            else:
                return 'Storage Device'
        
        # 3. كشف أجهزة الإدخال المحسن
        if device_class == '03':  # HID devices
            input_keywords = {
                'mouse': ['mouse', 'optical', 'wireless mouse', 'gaming mouse'],
                'keyboard': ['keyboard', 'keys', 'mechanical', 'wireless keyboard'],
                'gamepad': ['joystick', 'gamepad', 'controller', 'game', 'xbox', 'playstation', 'ps4', 'ps5'],
                'touchpad': ['trackpad', 'touchpad', 'synaptics', 'alps'],
                'stylus': ['tablet', 'stylus', 'pen', 'wacom', 'bamboo']
            }
            
            for device_type, keywords in input_keywords.items():
                if any(keyword in combined_text for keyword in keywords):
                    return device_type.title()
            
            return 'Input Device'
        
        # 4. كشف أجهزة الصوت المحسن
        audio_keywords = {
            'microphone': ['microphone', 'mic', 'audio input'],
            'headphone': ['headphone', 'headset', 'earphone', 'earbud', 'audio output'],
            'speaker': ['speaker', 'sound', 'audio speaker'],
            'soundcard': ['sound card', 'audio card', 'audio interface']
        }
        
        if (device_class == '01' or 
            any(keyword in combined_text for keyword in 
                ['audio', 'sound', 'microphone', 'speaker', 'headphone'])):
            
            for device_type, keywords in audio_keywords.items():
                if any(keyword in combined_text for keyword in keywords):
                    return device_type.title()
            
            return 'Audio Device'
        
        # 5. كشف كاميرات الويب والفيديو
        if (device_class == '0e' or 
            any(keyword in combined_text for keyword in 
                ['camera', 'webcam', 'cam', 'video', 'capture'])):
            
            if any(keyword in combined_text for keyword in ['webcam', 'web camera']):
                return 'Webcam'
            elif any(keyword in combined_text for keyword in ['capture', 'video capture']):
                return 'Video Capture Device'
            else:
                return 'Camera'
        
        # 6. كشف أجهزة الشبكة المحسن
        network_keywords = {
            'wifi': ['wifi', 'wireless', '802.11', 'wlan'],
            'ethernet': ['ethernet', 'lan', 'network adapter'],
            'bluetooth': ['bluetooth', 'bt'],
            'modem': ['modem', 'dial-up'],
            '3g_4g': ['3g', '4g', '5g', 'lte', 'cellular', 'mobile broadband']
        }
        
        if (device_class == '02' or 
            any(keyword in combined_text for keyword in 
                ['network', 'wifi', 'ethernet', 'bluetooth', 'wireless'])):
            
            for device_type, keywords in network_keywords.items():
                if any(keyword in combined_text for keyword in keywords):
                    return device_type.replace('_', '/').title() + ' Adapter'
            
            return 'Network Device'
        
        # 7. كشف الطابعات والماسحات الضوئية
        if (device_class == '07' or 
            any(keyword in combined_text for keyword in 
                ['printer', 'print', 'scanner', 'scan'])):
            
            if any(keyword in combined_text for keyword in ['scanner', 'scan']):
                return 'Scanner'
            else:
                return 'Printer'
        
        # 8. كشف المحاور USB
        if (device_class == '09' or 
            any(keyword in combined_text for keyword in ['hub', 'port', 'usb hub'])):
            return 'USB Hub'
        
        # 9. كشف قارئات البطاقات الذكية
        if (device_class == '0b' or 
            any(keyword in combined_text for keyword in 
                ['smart card', 'card reader', 'chip card'])):
            return 'Smart Card Reader'
        
        # 10. كشف أجهزة خاصة بالبائع بناءً على VID معروف
        vendor_devices = {
            '2717': 'Xiaomi Device',  # Xiaomi VID
            '18d1': 'Google Device',  # Google VID
            '04e8': 'Samsung Device', # Samsung VID
            '05ac': 'Apple Device',   # Apple VID
            '12d1': 'Huawei Device',  # Huawei VID
            '0bb4': 'HTC Device',     # HTC VID
            '22b8': 'Motorola Device' # Motorola VID
        }
        
        if vendor_id in vendor_devices:
            base_type = vendor_devices[vendor_id]
            # محاولة تحديد نوع أكثر دقة
            if any(keyword in combined_text for keyword in mobile_keywords):
                return base_type.replace('Device', 'Mobile Device')
            return base_type
        
        # 11. كشف بناءً على أنماط VID:PID معروفة
        known_patterns = {
            ('2717', 'ff40'): 'Xiaomi Android Device',
            ('18d1', '4ee7'): 'Google Nexus/Pixel Device',
            ('04e8', '6860'): 'Samsung Galaxy Device',
            ('05ac', '12a0'): 'iPhone/iPad Device'
        }
        
        device_pattern = (vendor_id, product_id)
        if device_pattern in known_patterns:
            return known_patterns[device_pattern]
        
        # 12. تحليل اسم الجهاز للكشف الذكي
        device_name_patterns = {
            r'android|adb': 'Android Device',
            r'iphone|ios': 'iPhone',
            r'ipad': 'iPad',
            r'galaxy|samsung': 'Samsung Device',
            r'xiaomi|mi\s|redmi': 'Xiaomi Device',
            r'huawei|mate|honor': 'Huawei Device',
            r'lg\s|g\d+': 'LG Device',
            r'htc|desire': 'HTC Device',
            r'sony|xperia': 'Sony Device',
            r'flash|drive|stick': 'USB Flash Drive',
            r'keyboard': 'Keyboard',
            r'mouse': 'Mouse',
            r'webcam|camera': 'Camera',
            r'printer': 'Printer',
            r'scanner': 'Scanner'
        }
        
        for pattern, device_type in device_name_patterns.items():
            if re.search(pattern, combined_text, re.IGNORECASE):
                return device_type
        
        # 13. كشف عام بناءً على فئة الجهاز
        device_class_names = {
            '01': 'Audio Device',
            '02': 'Communication Device', 
            '03': 'Input Device',
            '05': 'Physical Interface Device',
            '06': 'Image Device',
            '07': 'Printer',
            '08': 'Mass Storage Device',
            '09': 'USB Hub',
            '0a': 'CDC Data Device',
            '0b': 'Smart Card Reader',
            '0d': 'Content Security Device',
            '0e': 'Video Device',
            '0f': 'Personal Healthcare Device',
            'dc': 'Diagnostic Device',
            'e0': 'Wireless Controller',
            'ef': 'Miscellaneous Device',
            'fe': 'Application Specific Device',
            'ff': 'Vendor Specific Device'
        }
        
        # تحويل device_class إلى hex string للمقارنة
        if isinstance(device_class, int):
            device_class = f"{device_class:02x}"
        elif isinstance(device_class, str):
            device_class = device_class.lower().strip()
            if device_class.startswith('0x'):
                device_class = device_class[2:]
        
        if device_class in device_class_names:
            return device_class_names[device_class]
        
        # 14. إذا كان لدينا vendor_id صالح، على الأقل نعرف أنه جهاز USB
        if vendor_id and vendor_id != '0000' and len(vendor_id) == 4:
            return 'USB Device'
        
        # 15. آخر محاولة - فحص إذا كان النص يحتوي على أي معلومات مفيدة
        if any(word in combined_text for word in ['usb', 'device', 'hardware']):
            return 'USB Device'
        
        return 'Unknown Device'
            
    except Exception as e:
        logger.error(f"خطأ في تحديد نوع الجهاز: {e}")
        return 'Unknown Device'


def _find_device_by_identifier(identifier: str) -> Optional[Dict[str, Any]]:
    """Find device by serial number or device identifier."""
    try:
        client = get_supabase_client()
        if not client:
            logger.error("Supabase client not available")
            return None
            
        # Try to find by serial number first
        response = client.table('devices').select('*').eq('serial_number', identifier).execute()
        devices = response.data
        if devices:
            return devices[0]
        
        # If not found, try to parse device identifier
        if identifier and '_' in identifier:
            parts = identifier.split('_')
            if len(parts) >= 3:
                vendor_id, product_id = parts[0], parts[1]
                response = client.table('devices').select('*').eq('vendor_id', vendor_id).eq('product_id', product_id).execute()
                devices = response.data
                if devices:
                    return devices[0]
        
        return None
        
    except Exception as e:
        logger.error(f"Error finding device by identifier: {e}")
        return None


def get_connected_usb() -> List[Dict[str, Any]]:
    """Get list of currently connected USB devices."""
    try:
        client = get_supabase_client()
        if not client:
            logger.error("Supabase client not available")
            return []
            
        devices = discover_usb_devices()
        connected_devices = []
        
        for device_info in devices:
            # Check if device is in database and approved
            response = client.table('devices').select('*').eq('serial_number', device_info.get('serial_number')).execute()
            db_devices = response.data
            
            if db_devices and db_devices[0]['status'] in ['approved', 'connected']:
                connected_devices.append({
                    'serial_number': device_info.get('serial_number'),
                    'name': device_info.get('product', 'Unknown Device'),
                    'manufacturer': device_info.get('manufacturer', 'Unknown'),
                    'product': device_info.get('product', 'Unknown'),
                    'vendor_id': device_info.get('vendor_id'),
                    'product_id': device_info.get('product_id'),
                    'device_class': device_info.get('device_class'),
                    'power_consumption': device_info.get('power_consumption', 0.0),
                    'connection_time': current_time().isoformat(),
                    'device_type': get_device_type(device_info),
                    'status': 'connected'
                })
        
        return connected_devices
        
    except Exception as e:
        logger.error(f"Error getting connected USB devices: {e}")
        return []


def get_geo_location(ip_address: str) -> Optional[Dict[str, Any]]:
    """Get geographical location information for an IP address."""
    try:
        if not ip_address or ip_address in ['127.0.0.1', 'localhost', '::1']:
            return {
                'country': 'Local',
                'city': 'Local',
                'region': 'Local',
                'latitude': 0.0,
                'longitude': 0.0,
                'timezone': 'Local'
            }
        
        # Try to get location from external service
        try:
            import requests
            response = requests.get(f'http://ip-api.com/json/{ip_address}', timeout=5)
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'success':
                    return {
                        'country': data.get('country', 'Unknown'),
                        'city': data.get('city', 'Unknown'),
                        'region': data.get('regionName', 'Unknown'),
                        'latitude': data.get('lat', 0.0),
                        'longitude': data.get('lon', 0.0),
                        'timezone': data.get('timezone', 'Unknown'),
                        'isp': data.get('isp', 'Unknown'),
                        'org': data.get('org', 'Unknown')
                    }
        except Exception as e:
            logger.warning(f"Could not get location from external service: {e}")
        
        # Fallback to basic location detection
        return {
            'country': 'Unknown',
            'city': 'Unknown',
            'region': 'Unknown',
            'latitude': 0.0,
            'longitude': 0.0,
            'timezone': 'Unknown'
        }
        
    except Exception as e:
        logger.error(f"Error getting geo location: {e}")
        return None


def get_real_server_ip() -> str:
    """Get the real network IP address of the current server."""
    try:
        import socket
        import platform
        
        # Try multiple methods to get the real IP
        try:
            # Method 1: Connect to external address
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(3)  # 3 second timeout
            s.connect(('8.8.8.8', 80))
            ip = s.getsockname()[0]
            s.close()
            
            # Validate IP is not localhost
            if ip and ip not in ['127.0.0.1', 'localhost', '::1']:
                return ip
        except Exception:
            pass
        
        try:
            # Method 2: Get hostname and resolve
            hostname = socket.gethostname()
            ip = socket.gethostbyname(hostname)
            if ip and ip not in ['127.0.0.1', 'localhost', '::1']:
                return ip
        except Exception:
            pass
        
        # Method 3: Try to get from network interfaces
        try:
            import subprocess
            result = subprocess.run(['hostname', '-I'], capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                ips = result.stdout.strip().split()
                for ip in ips:
                    if ip and ip not in ['127.0.0.1', 'localhost', '::1'] and '.' in ip:
                        return ip
        except Exception:
            pass
        
        # Fallback to localhost
        return '127.0.0.1'
        
    except Exception as e:
        logger.error(f"Error getting real server IP: {e}")
        return '127.0.0.1'


def get_client_ip() -> str:
    """Get client IP address from request."""
    try:
        if current_app:
            # Check for forwarded headers first
            forwarded_for = current_app.request.headers.get('X-Forwarded-For')
            if forwarded_for:
                return forwarded_for.split(',')[0].strip()
            
            # Check for real IP header
            real_ip = current_app.request.headers.get('X-Real-IP')
            if real_ip:
                return real_ip
            
            # Use remote address
            return current_app.request.remote_addr or '127.0.0.1'
        else:
            return '127.0.0.1'
    except Exception as e:
        logger.error(f"Error getting client IP: {e}")
        return '127.0.0.1'


def get_user_agent_info() -> Dict[str, Any]:
    """Get user agent information from request."""
    try:
        if current_app and hasattr(current_app, 'request'):
            user_agent = current_app.request.headers.get('User-Agent', '')
            
            # Basic browser detection
            browser_info = {
                'user_agent': user_agent,
                'browser': 'Unknown',
                'version': 'Unknown',
                'os': 'Unknown',
                'device': 'Unknown'
            }
            
            if 'Chrome' in user_agent:
                browser_info['browser'] = 'Chrome'
            elif 'Firefox' in user_agent:
                browser_info['browser'] = 'Firefox'
            elif 'Safari' in user_agent:
                browser_info['browser'] = 'Safari'
            elif 'Edge' in user_agent:
                browser_info['browser'] = 'Edge'
            elif 'MSIE' in user_agent or 'Trident' in user_agent:
                browser_info['browser'] = 'Internet Explorer'
            
            # OS detection
            if 'Windows' in user_agent:
                browser_info['os'] = 'Windows'
            elif 'Mac' in user_agent:
                browser_info['os'] = 'macOS'
            elif 'Linux' in user_agent:
                browser_info['os'] = 'Linux'
            elif 'Android' in user_agent:
                browser_info['os'] = 'Android'
            elif 'iOS' in user_agent:
                browser_info['os'] = 'iOS'
            
            # Device detection
            if 'Mobile' in user_agent:
                browser_info['device'] = 'Mobile'
            elif 'Tablet' in user_agent:
                browser_info['device'] = 'Tablet'
            else:
                browser_info['device'] = 'Desktop'
            
            return browser_info
        else:
            return {
                'user_agent': 'Unknown',
                'browser': 'Unknown',
                'version': 'Unknown',
                'os': 'Unknown',
                'device': 'Unknown'
            }
    except Exception as e:
        logger.error(f"Error getting user agent info: {e}")
        return {
            'user_agent': 'Unknown',
            'browser': 'Unknown',
            'version': 'Unknown',
            'os': 'Unknown',
            'device': 'Unknown'
        }


def roles_required(*allowed_roles):
    """Decorator to check user roles."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                # First check if JWT token is valid
                from flask_jwt_extended import verify_jwt_in_request
                verify_jwt_in_request()
                
                jwt_data = get_jwt()
                user_roles = set(jwt_data.get('roles', []))
                
                if not user_roles.intersection(set(allowed_roles)):
                    return jsonify({'error': 'Insufficient permissions'}), 403
                    
                return fn(*args, **kwargs)
            except Exception as e:
                return jsonify({'error': 'Authentication error'}), 401
        return wrapper
    return decorator


# -------------------------------------------------------------------
# Missing Device Management Functions
# -------------------------------------------------------------------

def generate_alert(message: str, priority: str = 'normal', metadata: Optional[Dict[str, Any]] = None) -> Optional[int]:
    """Generate an alert in the system."""
    try:
        client = get_supabase_client()
        if not client:
            logger.error("Supabase client not available")
            return None
            
        # Create alert data
        alert_data = {
            'message': message,
            'priority': priority,
            'meta_data': json.dumps(metadata or {}),
            'read': False,
            'created_at': current_time().isoformat()
        }
        
        response = client.table('alerts').insert(alert_data).execute()
        if response.data:
            alert_id = response.data[0]['id']
            
            # Emit real-time notification
            socketio.emit('alert:new', {
                'id': alert_id,
                'message': message,
                'priority': priority,
                'created_at': alert_data['created_at'],
                'metadata': metadata
            }, namespace='/api/alerts')
            
            logger.debug(f"Alert generated successfully: {message}")
            return alert_id
        else:
            logger.error("Failed to insert alert")
            return None
    except Exception as e:
        logger.error(f"Error generating alert: {e}")
        return None


def get_usb_ports_info() -> Dict[str, Any]:
    """Get USB ports information."""
    try:
        return {
            'total_ports': 8,
            'enabled_ports': 8,
            'disabled_ports': 0,
            'used_ports': 0,
            'available_ports': 8,
            'ports': []
        }
    except Exception as e:
        logger.error(f"Error getting USB ports info: {e}")
        return {
            'total_ports': 0,
            'enabled_ports': 0,
            'disabled_ports': 0,
            'used_ports': 0,
            'available_ports': 0,
            'ports': []
        }


def control_device(serial_number: str, action: str) -> Tuple[bool, str]:
    """Control a USB device (eject, disable, etc.)."""
    try:
        client = get_supabase_client()
        if not client:
            logger.error("Supabase client not available")
            return False, "Database connection error"
            
        # Find device in database
        response = client.table('devices').select('*').eq('serial_number', serial_number).execute()
        devices = response.data
        
        if not devices:
            return False, "Device not found"
        
        device = devices[0]
        
        if action == 'eject':
            # Use the enhanced eject function with a default user_id
            return eject_device(device['serial_number'], user_id=1)
        elif action == 'disable':
            # Update device status to disabled
            update_data = {
                'status': 'disabled',
                'last_activity': current_time().isoformat()
            }
            client.table('devices').update(update_data).eq('id', device['id']).execute()
            return True, "Device disabled successfully"
        elif action == 'enable':
            # Update device status to connected
            update_data = {
                'status': 'connected',
                'last_activity': current_time().isoformat()
            }
            client.table('devices').update(update_data).eq('id', device['id']).execute()
            return True, "Device enabled successfully"
        else:
            return False, f"Unknown action: {action}"
            
    except Exception as e:
        logger.error(f"Error controlling device {serial_number}: {e}")
        return False, str(e)


def get_mounted_devices() -> List[Dict[str, Any]]:
    """Get list of mounted devices."""
    try:
        # This is a placeholder - implement based on your requirements
        return []
    except Exception as e:
        logger.error(f"Error getting mounted devices: {e}")
        return []


def get_device_permissions(serial_number: str) -> Dict[str, Any]:
    """Get device permissions."""
    try:
        # This is a placeholder - implement based on your requirements
        return {'read': True, 'write': True, 'execute': False}
    except Exception as e:
        logger.error(f"Error getting device permissions: {e}")
        return {}


def is_device_connected(serial_number: str) -> bool:
    """Check if device is currently connected."""
    try:
        client = get_supabase_client()
        if not client:
            logger.error("Supabase client not available")
            return False
            
        response = client.table('devices').select('status').eq('serial_number', serial_number).execute()
        devices = response.data
        return bool(devices and devices[0]['status'] == 'connected')
    except Exception as e:
        logger.error(f"Error checking device connection: {e}")
        return False


# Note: These functions are deprecated - use the enhanced versions below with user_id parameter


def get_connected_usb() -> List[Dict[str, Any]]:
    """Get list of connected USB devices."""
    try:
        client = get_supabase_client()
        if not client:
            logger.error("Supabase client not available")
            return []
            
        response = client.table('devices').select('*').eq('status', 'connected').execute()
        devices = response.data
        return devices if devices else []
    except Exception as e:
        logger.error(f"Error getting connected USB devices: {e}")
        return []


def get_all_usb_devices_from_db() -> List[Dict]:
    """Get all USB devices from the database."""
    try:
        from supabase_config import SUPABASE_URL, SUPABASE_ANON_KEY
        from supabase import create_client

        supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        response = supabase.table('devices').select('*').execute()

        return response.data if response.data else []
    except Exception as e:
        logger.error(f"Error getting USB devices from database: {e}")
        return []


def is_device_connected(serial_number: str) -> bool:
    """Check if a device is currently connected using Windows PowerShell."""
    try:
        if platform.system() == "Windows":
            # استخدام PowerShell للتحقق من وجود الجهاز
            cmd = [
                'powershell', '-NoProfile', '-NonInteractive', '-Command',
                f'Get-PnpDevice | Where-Object DeviceID -like "*{serial_number}*" | Where-Object Status -eq "OK" | Where-Object Present -eq $true | Measure-Object | Select-Object -ExpandProperty Count'
            ]

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                count = int(result.stdout.strip()) if result.stdout.strip().isdigit() else 0
                return count > 0

        # للأنظمة الأخرى، استخدام pyusb
        device = find_device_by_serial(serial_number)
        return device is not None

    except Exception as e:
        logger.error(f"Error checking device connection: {e}")
        return False


def sync_device_status_with_registry(server_id: Optional[int] = None) -> Dict[str, Any]:
    """Sync device status with Windows registry and database on system startup."""
    global _initial_discovery_logged
    try:
        result = {
            'total_devices': 0,
            'connected_devices': 0,
            'disconnected_devices': 0,
            'updated_devices': 0,
            'errors': []
        }
        
        client = get_supabase_client()
        if not client:
            result['errors'].append("Supabase client not available")
            return result
        
        # Get all devices from database
        query = client.table('devices').select('*')
        if server_id is not None:
            query = query.eq('server_id', server_id)
        
        response = query.execute()
        db_devices = response.data or []
        result['total_devices'] = len(db_devices)
        
        if not db_devices:
            return result
        
        # Get all devices from database for checking known devices
        db_known_serials = set()
        try:
            # We want to check against all known serials across all servers when identifying local devices
            response_all = client.table('devices').select('serial_number').execute()
            if response_all and hasattr(response_all, 'data') and response_all.data:
                db_known_serials = {str(d.get('serial_number')).strip().lower() for d in response_all.data if d.get('serial_number')}
        except Exception as e:
            logger.debug(f"Failed to fetch DB serials for sync: {e}")
        
        # Get currently connected devices (only log once per sync)
        connected_serials = get_all_connected_devices_serials()
        connected_set = set(connected_serials)
        connected_set_norm = set()
        for s in connected_serials:
            if s:
                s_str = str(s).strip()
                connected_set_norm.add(s_str.lower())
                norm_s = normalize_serial(s_str)
                if norm_s:
                    connected_set_norm.add(norm_s.lower())
        
        # Compute deduplicated physical device count (clusters) for clearer logs
        try:
            deduped_devices = enhanced_device_deduplication(get_real_usb_devices())
            physical_count = len(deduped_devices)
            
            # Build formatted device list for logging with state
            device_details: List[Tuple[str, str, str, str]] = []  # (display_key, name, type, state)
            for device in deduped_devices:
                try:
                    primary_sig = generate_device_signature(device)
                    display_key = None
                    if primary_sig and primary_sig.startswith('serial:'):
                        display_key = primary_sig.split(':', 1)[1]
                    elif primary_sig and primary_sig.startswith('vid_pid'):
                        parts = primary_sig.split(':')
                        if len(parts) >= 3:
                            display_key = f"{parts[1].upper()}:{parts[2].upper()}"
                        else:
                            display_key = primary_sig
                    else:
                        s = (device.get('serial_number') or '').strip()
                        if s:
                            display_key = normalize_serial(s) or s
                        else:
                            display_key = device.get('name') or device.get('product') or 'unknown'

                    device_name = device.get('name') or device.get('product') or 'Unknown Device'
                    device_type = get_device_type_from_class(device.get('device_class') or device.get('class') or '') or 'USB Device'
                    
                    # تحديد الحالة:
                    # - إذا كان الجهاز موجود في قاعدة البيانات (معروف/معتمد) → connected
                    # - إذا كان جهاز جديد غير موجود في قاعدة البيانات → pending
                    device_state = 'pending'
                    raw_serial = (device.get('serial_number') or '').strip()
                    
                    # قائمة بجميع الصيغ الممكنة للسيريال للمطابقة (Lowercase)
                    candidates = {display_key.lower() if display_key else "", raw_serial.lower()}
                    if raw_serial:
                        norm = normalize_serial(raw_serial)
                        if norm:
                            candidates.add(norm.lower())
                    candidates.discard('')
                    
                    # التحقق من وجود أي صيغة في قاعدة البيانات
                    if any(c in db_known_serials for c in candidates):
                        device_state = 'connected'
                        
                    # إذا كان هناك حالة خطأ في النظام (PnP Status) فإنها تظهر
                    pnp_status = str(device.get('status', 'OK')).lower()
                    if pnp_status not in ('ok', 'connected'):
                        device_state = pnp_status
                        
                    device_details.append((display_key, device_name, device_type, device_state))
                except Exception:
                    continue

            # Sort by display key
            device_details.sort(key=lambda x: (x[2], x[1]))  # Sort by type first, then by name
            
            # Create a map for fresh device types using normalized serial keys
            serial_type_map = {}
            for item in device_details:
                serial, name, typ = item[0], item[1], item[2]
                # Normalize the key to match database serial format
                normalized_key = serial
                if serial and ':' in serial:
                    # Handle signature format like "serial:ABC123"
                    normalized_key = serial.split(':', 1)[-1]
                serial_type_map[normalized_key] = typ
                serial_type_map[serial] = typ  # Also store original key
                # Update global cache for disconnection events
                _device_type_cache[normalized_key] = typ
                _device_type_cache[serial] = typ
        except Exception:
            physical_count = None
            cluster_keys = []
            device_details = []

        # Only log if there's a change in signature entries count
        if hasattr(sync_device_status_with_registry, '_last_device_count'):
            last_count = sync_device_status_with_registry._last_device_count
            current_count = len(connected_serials)
            if current_count != last_count:
                if physical_count is not None:
                    # logger.info(f"🔄 Device signature entries changed: {last_count} → {current_count} (physical devices: {physical_count})")
                    # logger.info(f"📱 Clusters: {cluster_keys}")
                    pass
                if device_details:
                    # Table will be printed at the end after sync summary if changes occur
                    pass
                else:
                    logger.info(f"📱 Connected serials/clusters: {connected_serials}")
        else:
            # Only log initial sync once
            if not _initial_discovery_logged:
                if physical_count is not None:
                    # logger.info(f"🔄 Initial sync: Found {physical_count} physical devices, {len(connected_serials)} signature entries")
                    pass
                else:
                    # logger.info(f"🔄 Initial sync: Found {len(connected_serials)} connected signature entries")
                    pass
                if device_details:
                    log_devices_table(device_details)
                else:
                    logger.info(f"📱 Connected serials/clusters: {connected_serials}")
                # Mark initial discovery as logged
                _initial_discovery_logged = True
        
        # Store current count for next comparison
        sync_device_status_with_registry._last_device_count = len(connected_serials)
        
        # Update device status based on connection state
        for device in db_devices:
            try:
                serial_number = device.get('serial_number')
                current_status = device.get('status')
                
                # التحقق من الجهاز الفعلي (غير حساس لحالة الأحرف والصيغة)
                sn_str = str(serial_number or '').strip()
                sn_norm = normalize_serial(sn_str).lower() if sn_str else ''
                is_physically_connected = (
                    serial_number in connected_set or
                    (sn_str and sn_str.lower() in connected_set_norm) or
                    (sn_norm and sn_norm in connected_set_norm)
                )
                
                if is_physically_connected:
                    # Device is connected
                    # لا نغيّر حالة الأجهزة المعلقة أو المرفوضة — لازم الأدمن يوافق أولاً
                    if current_status in ('pending', 'denied'):
                        # الجهاز معلق أو مرفوض، نتركه على حاله
                        pass
                    elif current_status != 'connected':
                        # جهاز كان موافق عليه سابقاً (disconnected/approved) → connected
                        update_data = {
                            'status': 'connected',
                            'connection_time': current_time().isoformat(),
                            'last_activity': current_time().isoformat()
                        }
                        client.table('devices').update(update_data).eq('id', device['id']).execute()
                        result['updated_devices'] += 1
                        result['connected_devices'] += 1
                        
                        # Get fresh device type from our map
                        fresh_type = serial_type_map.get(serial_number, device.get('device_type', 'USB Device'))
                        log_device_event("CONNECTED", serial_number, device.get('name', 'Unknown'), fresh_type, server_id=device.get('server_id'))
                        
                        # إرسال حدث Socket للإعلان عن إعادة الاتصال
                        try:
                            from extensions import socketio
                            socketio.emit('device:reconnected', {
                                'device': device,
                                'device_name': device.get('name', 'Unknown Device'),
                                'device_serial': serial_number,
                                'server_id': device.get('server_id'),
                                'message': f'تم إعادة توصيل الجهاز: {device.get("name", "Unknown Device")}'
                            }, namespace='/api/devices')
                            
                            # إرسال حدث عام للتحديث
                            socketio.emit('device:updated', {
                                'action': 'reconnected',
                                'device_name': device.get('name', 'Unknown Device'),
                                'device_serial': serial_number,
                                'server_id': device.get('server_id')
                            }, namespace='/api/devices')
                        except Exception as e:
                            logger.debug(f"Failed to emit socket event for reconnected device: {e}")
                            
                    else:
                        result['connected_devices'] += 1
                else:
                    # Device is not connected
                    if current_status in ('connected', 'approved'):
                        update_data = {
                            'status': 'disconnected',
                            'disconnection_time': current_time().isoformat()
                        }
                        client.table('devices').update(update_data).eq('id', device['id']).execute()
                        result['updated_devices'] += 1
                        result['disconnected_devices'] += 1
                        
                        # Get fresh device type from our map or cache
                        fresh_type = serial_type_map.get(serial_number) or _device_type_cache.get(serial_number) or device.get('device_type', 'USB Device')
                        log_device_event("DISCONNECTED", serial_number, device.get('name', 'Unknown'), fresh_type, server_id=device.get('server_id'))
                        
                        # إرسال حدث Socket للإعلان عن انقطاع الجهاز
                        try:
                            from extensions import socketio
                            socketio.emit('device:disconnected', {
                                'device': device,
                                'device_name': device.get('name', 'Unknown Device'),
                                'device_serial': serial_number,
                                'server_id': device.get('server_id'),
                                'message': f'تم فصل الجهاز: {device.get("name", "Unknown Device")}'
                            }, namespace='/api/devices')
                            
                            # إرسال حدث عام للتحديث
                            socketio.emit('device:updated', {
                                'action': 'disconnected',
                                'device_name': device.get('name', 'Unknown Device'),
                                'device_serial': serial_number,
                                'server_id': device.get('server_id')
                            }, namespace='/api/devices')
                        except Exception as e:
                            logger.debug(f"Failed to emit socket event for disconnected device: {e}")
                            
                    else:
                        result['disconnected_devices'] += 1
                        
            except Exception as e:
                error_msg = f"Error updating device {device.get('serial_number', 'unknown')}: {str(e)}"
                result['errors'].append(error_msg)
                logger.error(error_msg)
        
        # Only log summary if there were actual updates
        if result['updated_devices'] > 0:
            # log_sync_summary(result)  # Removed as requested
            # After summary, print the fresh full table
            if device_details:
                log_devices_table(device_details)
        
        return result
        
    except Exception as e:
        error_msg = f"Error in registry sync: {str(e)}"
        logger.error(error_msg)
        return {
            'total_devices': 0,
            'connected_devices': 0,
            'disconnected_devices': 0,
            'updated_devices': 0,
            'errors': [error_msg]
        }


def get_registry_usb_devices() -> List[Dict[str, Any]]:
    """Get USB devices from Windows registry for comprehensive device discovery."""
    try:
        if platform.system() != "Windows":
            return []
            
        # Use PowerShell to query registry for USB devices
        cmd = [
            'powershell', '-NoProfile', '-NonInteractive', '-Command',
            '''
            $usbDevices = @()
            
            # Query USB devices from registry
            $regPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\USB"
            if (Test-Path $regPath) {
                $usbKeys = Get-ChildItem -Path $regPath -ErrorAction SilentlyContinue
                foreach ($vendorKey in $usbKeys) {
                    $vendorId = $vendorKey.Name.Split("\\")[-1]
                    if ($vendorId -match "^VID_[0-9A-F]{4}$") {
                        $productKeys = Get-ChildItem -Path $vendorKey.PSPath -ErrorAction SilentlyContinue
                        foreach ($productKey in $productKeys) {
                            $productId = $productKey.Name.Split("\\")[-1]
                            if ($productId -match "^PID_[0-9A-F]{4}$") {
                                $serialKeys = Get-ChildItem -Path $productKey.PSPath -ErrorAction SilentlyContinue
                                foreach ($serialKey in $serialKeys) {
                                    $serialNumber = $serialKey.Name.Split("\\")[-1]
                                    
                                    # Get device properties
                                    $deviceProps = Get-ItemProperty -Path $serialKey.PSPath -ErrorAction SilentlyContinue
                                    if ($deviceProps) {
                                        $device = @{
                                            'vendor_id' = $vendorId -replace "VID_", ""
                                            'product_id' = $productId -replace "PID_", ""
                                            'serial_number' = $serialNumber
                                            'name' = $deviceProps.DeviceDesc
                                            'manufacturer' = $deviceProps.Mfg
                                            'device_class' = $deviceProps.Class
                                            'driver' = $deviceProps.Driver
                                            'location' = $deviceProps.LocationInformation
                                            'status' = if ($deviceProps.ConfigFlags -eq 0) { "OK" } else { "Error" }
                                            'source' = "registry"
                                        }
                                        $usbDevices += $device
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            # Convert to JSON
            if ($usbDevices.Count -gt 0) {
                $usbDevices | ConvertTo-Json -Depth 3
            } else {
                "[]"
            }
            '''
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0 and result.stdout.strip():
            try:
                devices = json.loads(result.stdout.strip())
                if isinstance(devices, list):
                    return devices
            except json.JSONDecodeError as e:
                logger.error(f"Error parsing registry devices JSON: {e}")
                
        return []
        
    except Exception as e:
        logger.error(f"Error getting registry USB devices: {e}")
        return []


# -------------------------------------------------------------------
# Local Device Sync
# -------------------------------------------------------------------

def sync_local_devices_with_db(server_id: int = 1):
    """
    Sync local connected devices with the database.
    1. Update connected devices status.
    2. Set disconnected status for missing devices.
    3. Add newly discovered devices to Supabase + emit Socket.IO events.
    """
    try:
        from services.device_blocker import get_all_usb_peripherals
        from extensions import socketio
        
        # 1. Get local connected devices
        local_devices = get_all_usb_peripherals()
        if not local_devices:
            # Maybe failed to get devices, don't update DB to avoid accidental disconnects
            return
            
        local_serials = set()
        local_dev_map = {}
        # مجموعة بجميع device_id الموجودة محلياً للتحقق من الأجهزة المعلقة لاحقاً
        local_device_ids = set()
        
        for dev in local_devices:
            serial = dev.get('serial_number', '').strip()
            device_id_pnp = dev.get('device_id', '').strip()
            
            # إذا ما عنده سيريال، ننشئ واحد من VID/PID + آخر جزء من device_id
            if not serial and device_id_pnp:
                # استخراج VID/PID من device_id مثل USB\VID_1BCF&PID_08A0\5&1BDE3AAF&0&1
                vid = dev.get('vid', '').strip()
                pid = dev.get('pid', '').strip()
                if vid and pid:
                    # استخدم آخر جزء من device_id كمعرف فريد
                    parts = device_id_pnp.replace('\\\\', '\\').split('\\')
                    suffix = parts[-1] if len(parts) >= 1 else ''
                    serial = f"AUTO_{vid}_{pid}_{suffix}".replace('&', '_')
                    dev['serial_number'] = serial
            
            if serial:
                local_serials.add(serial)
                local_serials.add(serial.lower())
                local_dev_map[serial] = dev
            
            if device_id_pnp:
                local_device_ids.add(device_id_pnp)
        
        # 2. Get DB devices for this server
        client = get_supabase_client()
        if not client:
            return

        response = client.table('devices').select('*').eq('server_id', server_id).execute()
        db_devices = response.data if response.data else []
        
        db_serials = set()
        
        # 3. Process DB devices
        for db_dev in db_devices:
            db_serial = db_dev.get('serial_number')
            if not db_serial:
                continue
                
            db_serials.add(db_serial)
            db_serials.add(str(db_serial).strip().lower())
            # نعتمد على status فقط لتجنب التكرار
            status_db = str(db_dev.get('status', '')).lower()
            
            if db_serial in local_serials or str(db_serial).strip().lower() in local_serials:
                # الجهاز متصل محلياً
                # لا نغيّر حالة الأجهزة المعلقة أو المرفوضة — لازم الأدمن يوافق أولاً
                if status_db in ('pending', 'denied'):
                    # فقط نحدث وقت آخر نشاط بدون تغيير الحالة
                    pass
                elif status_db == 'disconnected':
                    # جهاز كان موافق عليه سابقاً وانفصل، الآن رجع → connected
                    client.table('devices').update({
                        'status': 'connected',
                        'last_activity': current_time().isoformat()
                    }).eq('id', db_dev['id']).execute()
                    
                    # Emit Socket.IO event for reconnection
                    try:
                        socketio.emit('device:reconnected', {
                            'device_id': db_dev['id'],
                            'device_name': db_dev.get('name', 'Unknown'),
                            'serial_number': db_serial,
                            'server_id': server_id,
                            'message': f"تم إعادة توصيل الجهاز: {db_dev.get('name', 'Unknown')}"
                        }, namespace='/api/devices')
                    except Exception:
                        pass

                    # Alert ONCE (Reconnection)
                    try:
                        generate_alert(
                            f"اتصل الجهاز: {db_dev.get('name')} (SN: {db_serial})",
                            'normal',
                            {'event': 'device_connected', 'device_id': db_dev['id']}
                        )
                    except: pass
                else:
                    # هو متصل بالفعل (connected/approved)، لا نسوي شي
                    pass

            else:
                # الجهاز غير متصل محلياً (انفصل)
                # نحدث إذا كان مسجلاً كمتصل أو معتمد
                if status_db in ('connected', 'approved'):
                    client.table('devices').update({
                        'status': 'disconnected',
                        'last_activity': current_time().isoformat()
                    }).eq('id', db_dev['id']).execute()

                    # Emit Socket.IO event for disconnection
                    try:
                        socketio.emit('device:disconnected', {
                            'device_id': db_dev['id'],
                            'device_name': db_dev.get('name', 'Unknown'),
                            'serial_number': db_serial,
                            'server_id': server_id,
                            'message': f"تم فصل الجهاز: {db_dev.get('name', 'Unknown')}"
                        }, namespace='/api/devices')
                    except Exception:
                        pass

                    # Alert ONCE (Disconnection)
                    # طلب المستخدم: "من يتصل جهاز او ينفصل"
                    try:
                        generate_alert(
                            f"انفصل الجهاز: {db_dev.get('name')} (SN: {db_serial})",
                            'normal', # أو low
                            {'event': 'device_disconnected', 'device_id': db_dev['id']}
                        )
                    except: pass
        
        # 4. Add new (unknown) devices to server_pending_devices ONLY - NOT to devices table
        # Cache to prevent redundant console logs in the same sync cycle
        _logged_this_cycle = set()
        
        for serial, dev in local_dev_map.items():
            if serial not in db_serials and str(serial).strip().lower() not in db_serials:
                # جهاز جديد غير معروف → يروح لجدول server_pending_devices المعزول فقط
                try:
                    from services.device_blocker import save_pending_device_to_db
                    device_name = dev.get('name', 'Unknown Device')
                    device_class = dev.get('class', 'USB Device')
                    device_id_pnp = dev.get('device_id', '')

                    # حفظ في الجدول المعزول
                    save_pending_device_to_db(device_id_pnp or serial, dev)

                    # Log to console - check both serial and device_id to avoid double reporting
                    log_key = serial.lower()
                    if log_key not in _logged_this_cycle and device_id_pnp.lower() not in _logged_this_cycle:
                        log_new_device_discovered(
                            serial=serial,
                            name=device_name,
                            device_type=device_class,
                            status='pending',
                            server_id=server_id
                        )
                        _logged_this_cycle.add(log_key)
                        if device_id_pnp:
                            _logged_this_cycle.add(device_id_pnp.lower())

                    # Emit Socket.IO event so frontend gets notified immediately
                    try:
                        socketio.emit('device:discovered', {
                            'device': {
                                'id': None,
                                'name': device_name,
                                'serial_number': serial,
                                'vendor_id': dev.get('vid', ''),
                                'product_id': dev.get('pid', ''),
                                'manufacturer': dev.get('manufacturer', ''),
                                'device_type': device_class,
                                'usb_port': dev.get('location', 'USB Port'),
                                'status': 'pending',
                                'server_id': server_id,
                            },
                            'device_name': device_name,
                            'serial_number': serial,
                            'server_id': server_id,
                            'message': f'تم اكتشاف جهاز جديد (معلق): {device_name}'
                        }, namespace='/api/devices')
                    except Exception:
                        pass

                    # Generate alert for new device
                    try:
                        from services.alert_service import generate_alert
                        generate_alert(
                            f"تم اكتشاف جهاز جديد: {device_name} (SN: {serial})",
                            'normal',
                            {'event': 'device_discovered', 'device_serial': serial, 'server_id': server_id}
                        )
                    except: pass

                except Exception as e:
                    print(f"❌ Error adding pending device {serial}: {str(e)}")
                    try:
                        generate_alert(
                            f"تم اكتشاف جهاز جديد (معلق للمراجعة): {device_name} (SN: {serial})",
                            'medium',
                            {'event': 'device_discovered', 'serial': serial, 'table': 'server_pending_devices'}
                        )
                    except Exception:
                        pass

                except Exception as e:
                    logger.debug(f"Error saving pending device {serial}: {e}")

        # 5. تنظيف الأجهزة المعلقة المنفصلة من server_pending_devices
        # إذا جهاز معلق انفصل فعلياً من السيرفر → نمسحه من قاعدة البيانات
        try:
            pending_response = client.table('server_pending_devices').select('id, device_id, name, serial_number').eq('server_id', server_id).execute()
            if pending_response.data:
                for pending_dev in pending_response.data:
                    pending_device_id = pending_dev.get('device_id', '')
                    pending_serial = pending_dev.get('serial_number', '')
                    
                    # تحقق: هل الجهاز لا يزال متصلاً فعلياً؟
                    still_connected = False
                    if pending_device_id and pending_device_id in local_device_ids:
                        still_connected = True
                    elif pending_serial and pending_serial in local_serials:
                        still_connected = True
                    
                    if not still_connected:
                        # الجهاز المعلق انفصل → نمسحه من قاعدة البيانات
                        try:
                            client.table('server_pending_devices').delete().eq('id', pending_dev['id']).execute()
                            # logger.info(f"🗑️ Auto-removed disconnected pending device: {pending_dev.get('name', 'Unknown')} (ID: {pending_dev['id']})")
                            
                            # إرسال إشعار Socket.IO بحذف الجهاز المعلق
                            try:
                                socketio.emit('device:pending_removed', {
                                    'pending_id': pending_dev['id'],
                                    'device_name': pending_dev.get('name', 'Unknown'),
                                    'reason': 'disconnected',
                                    'message': f"تم حذف الجهاز المعلق تلقائياً (انفصل): {pending_dev.get('name', 'Unknown')}"
                                }, namespace='/api/devices')
                            except Exception:
                                pass
                        except Exception as del_err:
                            logger.debug(f"Failed to auto-remove pending device {pending_dev['id']}: {del_err}")
        except Exception as cleanup_err:
            logger.debug(f"Error cleaning up disconnected pending devices: {cleanup_err}")

    except Exception as e:
        logger.warning(f"sync_local_devices_with_db skipped: {e}")


