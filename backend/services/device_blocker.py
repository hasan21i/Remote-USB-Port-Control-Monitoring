# backend/services/device_blocker.py
"""
خدمة حظر أجهزة USB الطرفية فعلياً (بدون محاكاة)
=================================================
- يكشف كل جهاز طرفي جديد يتصل بالحاسبة
- يجلب بياناته الكاملة قبل حظره
- يعطّله فعلياً عبر Disable-PnpDevice
- يستثني الأجهزة الداخلية (كيبورد داخلي، تاتش باد، كاميرا داخلية، بلوتوث داخلي)
- عند الموافقة من الأدمن، يعيد تفعيل الجهاز عبر Enable-PnpDevice

تحسين الأداء (VID/PID Optimized):
- استخدام Registry مباشرة للاكتشاف السريع (~20ms بدلاً من ~1000ms WMI)
- يدعم الطريقتين: Registry (سريع) و WMI (شامل)
"""

import os
import json
import time
import platform
import subprocess
import logging
import threading
import winreg
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple, Set

logger = logging.getLogger(__name__)

# ============================================================
# قائمة الأجهزة الداخلية المستثناة من الحظر
# ============================================================

# أنماط DeviceID للأجهزة الداخلية التي لا يجب حظرها
INTERNAL_DEVICE_PATTERNS = [
    # Root Hubs و Controllers - أساسية للنظام
    'ROOT_HUB',
    'USB\\ROOT_HUB',

    # الكيبورد الداخلي (PS/2 و I2C - ليست USB عادةً لكن للأمان)
    'ACPI\\PNP0303',      # PS/2 Keyboard
    'ACPI\\PNP0F13',      # PS/2 Mouse
    'HID\\INTC',          # Intel Internal HID
    'HID\\ELAN',          # ELAN Touchpad (ASUS)
    'HID\\SYN',           # Synaptics Touchpad
    'HID\\ALPS',          # ALPS Touchpad
    'HID\\MSFT',          # Microsoft Internal
    'I2C\\',              # I2C Bus devices (internal)

    # ASUS specific internal devices
    'HID\\ASUS',          # ASUS Internal HID
    'HID\\ATK',           # ASUS ATK Hotkey
    'ACPI\\ATK',          # ASUS ATK

    # أجهزة الصوت الداخلية
    'HDAUDIO\\',
    'INTELAUDIO\\',

    # كاميرات داخلية شائعة
    'PCI\\',              # PCI devices are internal

    # أجهزة الشبكة الداخلية
    'SWD\\',              # Software devices
    'ACPI\\',             # ACPI devices (all internal)
]

# VID:PID للأجهزة الداخلية المعروفة (ASUS laptops وغيرها)
INTERNAL_VID_PID = {
    # Intel Internal Bluetooth Adapters
    ('8087', '0026'),  # Intel AX201 BT
    ('8087', '0029'),  # Intel AX200 BT
    ('8087', '0032'),  # Intel AX210 BT
    ('8087', '0033'),  # Intel BE200 BT
    ('8087', '0025'),  # Intel 9560 BT
    ('8087', '0aaa'),  # Intel BT
    ('8087', '0a2b'),  # Intel BT
    ('8087', '0a2a'),  # Intel BT

    # Intel Internal Cameras
    ('8086', '0a80'),  # Intel Camera
    ('8086', '09d4'),  # Intel Camera
    ('5986', '2150'),  # Acer/ASUS Internal Camera (Bison)
    ('5986', '2141'),  # Acer/ASUS Internal Camera
    ('5986', '214c'),  # Acer/ASUS Internal Camera
    ('04f2', 'b71a'),  # Chicony Internal Camera (common in ASUS)
    ('04f2', 'b6d9'),  # Chicony Internal Camera
    ('04f2', 'b5ee'),  # Chicony Internal Camera
    ('04f2', 'b725'),  # Chicony Internal Camera
    ('0408', '1091'),  # Quanta Internal Camera
    ('13d3', '56ff'),  # IMC Internal Camera (common in ASUS)
    ('13d3', '5a02'),  # IMC Internal Camera
    ('13d3', '5248'),  # IMC Internal Camera

    # Fingerprint readers (internal)
    ('06cb', '00bd'),  # Synaptics Fingerprint
    ('06cb', '00be'),  # Synaptics Fingerprint
    ('138a', '0097'),  # Validity/Synaptics Fingerprint
    ('27c6', '63ac'),  # Goodix Fingerprint (ASUS)
    ('27c6', '55a4'),  # Goodix Fingerprint

    # ASUS Internal Devices
    ('0b05', '19b6'),  # ASUS NumberPad/ScreenPad
    ('0b05', '1866'),  # ASUS Internal
    ('0b05', '1837'),  # ASUS Internal
}

# فئات الأجهزة التي هي دائماً داخلية (لا تُحظر)
INTERNAL_DEVICE_CLASSES = {
    'system',
    'firmware',
    'processor',
    'computer',
    'volume',
    'diskdrive',   # سيتم التعامل معه بشكل منفصل
}

# ============================================================
# مخزن مؤقت للأجهزة المعروفة (لتجنب حظر متكرر)
# ============================================================
_known_device_ids: Set[str] = set()       # DeviceIDs المعروفة المكتشفة مسبقاً
_blocked_device_ids: Set[str] = set()     # DeviceIDs المحظورة حالياً
_approved_device_ids: Set[str] = set()    # DeviceIDs الموافق عليها
_approved_device_ids_upper: Set[str] = set()  # DeviceIDs الموافق عليها (غير حساس لحالة الأحرف)
_approved_serials: Set[str] = set()       # الأرقام التسلسلية الموافق عليها (غير حساس لحالة الأحرف)
_internal_device_ids: Set[str] = set()    # DeviceIDs المعرفة كأجهزة داخلية
_failed_device_ids: Set[str] = set()      # DeviceIDs التي فشل حظرها (لتجنب التكرار)
_baseline_device_ids: Set[str] = set()    # DeviceIDs الأولية عند بدء النظام (للمقارنة السريعة)
_last_approved_sync: float = 0.0          # آخر وقت لتحديث قائمة الموافق عليها من القاعدة
_lock = threading.Lock()                   # قفل للأمان في multi-threading


def _extract_serial_from_device_id(device_id: str) -> str:
    """استخراج السيريال الحقيقي من InstanceId مع تجاهل معرفات المنافذ مثل 5&1BDE3AAF&0&5."""
    if not device_id:
        return ''
    parts = device_id.replace('\\\\', '\\').split('\\')
    if not parts:
        return ''
    last_part = parts[-1].strip()
    if len(last_part) >= 5 and '&' not in last_part and '_' not in last_part and last_part.isalnum():
        return last_part.upper()
    return ''


def _is_valid_hardware_serial(serial: str) -> bool:
    """التحقق أن السيريال رقم تسلسلي حقيقي وليس معرف منفذ مؤقت."""
    if not serial:
        return False
    s = str(serial).strip()
    return len(s) >= 5 and '&' not in s and not s.upper().startswith('AUTO_') and not s.upper().startswith('INST_')


def is_device_approved(device_id: str, serial_number: str = '') -> bool:
    """فحص الموافقة على الجهاز بالاعتماد على DeviceID (بدون حساسية لحالة الأحرف) أو السيريال."""
    dev_id_upper = (device_id or '').strip().upper()
    serial_upper = (serial_number or '').strip().upper()
    extracted_serial = _extract_serial_from_device_id(device_id)

    with _lock:
        if device_id in _approved_device_ids or (dev_id_upper and dev_id_upper in _approved_device_ids_upper):
            return True
        if serial_upper and _is_valid_hardware_serial(serial_upper) and serial_upper in _approved_serials:
            return True
        if extracted_serial and extracted_serial in _approved_serials:
            return True
    return False

# إعدادات طريقة الاكتشاف
DETECTION_METHOD = 'registry'  # 'registry' (سريع ~20ms) أو 'wmi' (شامل ~1000ms)
REGISTRY_POLL_INTERVAL = 0.02  # 20ms - سريع جداً


def is_internal_device(device_id: str, vid: str = '', pid: str = '',
                       device_class: str = '', name: str = '',
                       location: str = '') -> bool:
    """
    تحديد ما إذا كان الجهاز داخلي (يجب استثناؤه من الحظر).

    المعايير:
    1. DeviceID يطابق أنماط الأجهزة الداخلية
    2. VID:PID في قائمة الأجهزة الداخلية المعروفة
    3. فئة الجهاز داخلية
    4. الموقع يشير لأنه داخلي (port 0 على root hub)
    """
    device_id_upper = device_id.upper()

    # 1. فحص أنماط DeviceID
    for pattern in INTERNAL_DEVICE_PATTERNS:
        if pattern.upper() in device_id_upper:
            return True

    # 2. فحص VID:PID
    vid_clean = vid.upper().replace('VID_', '').strip()
    pid_clean = pid.upper().replace('PID_', '').strip()
    if (vid_clean.lower(), pid_clean.lower()) in INTERNAL_VID_PID:
        return True

    # 3. فحص فئة الجهاز
    if device_class.lower() in INTERNAL_DEVICE_CLASSES:
        return True

    # 4. فحص الاسم لأجهزة داخلية واضحة
    name_lower = name.lower()
    internal_name_patterns = [
        'host controller', 'root hub', 'generic hub',
    ]
    for pattern in internal_name_patterns:
        if pattern in name_lower:
            return True

    return False


# ============================================================
# طرق الاكتشاف السريعة (VID/PID Optimized - Registry-based)
# ============================================================

def get_usb_devices_registry_fast() -> Set[str]:
    """
    اكتشاف أجهزة USB المتصلة حالياً عبر Registry مباشرة.
    هذه الطريقة أسرع بكثير من WMI (~20ms بدلاً من ~1000ms).
    
    تفحص وجود مفتاح "Control" في Registry للتأكد أن الجهاز متصل حالياً.
    
    Returns:
        مجموعة من InstanceId للأجهزة المتصلة
    """
    devices = set()
    usb_key_path = r"SYSTEM\CurrentControlSet\Enum\USB"
    
    try:
        usb_key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, usb_key_path)
        i = 0
        while True:
            try:
                vid_pid = winreg.EnumKey(usb_key, i)
                
                # تخطي ROOT_HUB وأجهزة غير VID_
                if 'ROOT_HUB' in vid_pid.upper() or not vid_pid.upper().startswith('VID_'):
                    i += 1
                    continue
                
                vid_pid_key = winreg.OpenKey(usb_key, vid_pid)
                j = 0
                while True:
                    try:
                        serial = winreg.EnumKey(vid_pid_key, j)
                        instance_id = f"USB\\{vid_pid}\\{serial}"
                        
                        # تخطي composite interfaces (&MI_)
                        if '&MI_' in instance_id.upper():
                            j += 1
                            continue
                        
                        # التحقق من أن الجهاز متصل فعلاً (وجود مفتاح Control)
                        try:
                            dev_key = winreg.OpenKey(vid_pid_key, serial)
                            try:
                                ctrl_key = winreg.OpenKey(dev_key, "Control")
                                winreg.CloseKey(ctrl_key)
                                devices.add(instance_id)
                            except FileNotFoundError:
                                pass
                            winreg.CloseKey(dev_key)
                        except Exception:
                            pass
                        j += 1
                    except OSError:
                        break
                winreg.CloseKey(vid_pid_key)
                i += 1
            except OSError:
                break
        winreg.CloseKey(usb_key)
    except Exception as e:
        logger.debug(f"Registry scan error: {e}")
    
    return devices


def detect_new_devices_fast() -> Set[str]:
    """
    اكتشاف الأجهزة الجديدة بالمقارنة مع الـ baseline.
    يُستخدم للاكتشاف السريع (~20ms).
    
    Returns:
        مجموعة من InstanceId للأجهزة الجديدة
    """
    global _baseline_device_ids
    
    current = get_usb_devices_registry_fast()
    
    with _lock:
        # إذا لم يتم تعيين baseline، نعينه الآن
        if not _baseline_device_ids:
            _baseline_device_ids = current.copy()
            return set()
        
        # الأجهزة الجديدة = الحالية - الـ baseline - المعروفة
        new_devices = current - _baseline_device_ids - _known_device_ids - _approved_device_ids - _internal_device_ids
        
        # تحديث baseline بالأجهزة الحالية
        _baseline_device_ids = current.copy()
    
    # فلترة الأجهزة الداخلية والموافق عليها
    external_new = set()
    for device_id in new_devices:
        if not is_internal_device_fast(device_id) and not is_device_approved(device_id):
            external_new.add(device_id)
    
    return external_new


def is_internal_device_fast(instance_id: str) -> bool:
    """
    فحص سريع إذا كان الجهاز داخلي (يجب استثناؤه).
    نسخة مبسطة وسريعة من is_internal_device.
    """
    upper_id = instance_id.upper()
    
    # Internal device prefixes
    internal_prefixes = [
        'USB\\ROOT_HUB',
        'USB\\VID_8087',     # Intel Bluetooth
        'USB\\VID_0C45',     # Internal webcam
        'USB\\VID_04F2',     # Chicony webcam
        'USB\\VID_13D3',     # Azurewave Bluetooth/Webcam
        'USB\\VID_0BDA',     # Realtek Bluetooth
        'USB\\VID_5986',     # Acer/ASUS Internal Camera
        'USB\\VID_0B05',     # ASUS Internal (NumberPad/ScreenPad)
        'USB\\VID_06CB',     # Synaptics Fingerprint
        'USB\\VID_27C6',     # Goodix Fingerprint
        'HID\\',
        'SWD\\',
    ]
    
    for prefix in internal_prefixes:
        if upper_id.startswith(prefix):
            return True
    
    return False


def initialize_baseline():
    """
    تهيئة الـ baseline عند بدء النظام.
    يجب استدعاؤها مرة واحدة عند تشغيل الباك إند.
    """
    global _baseline_device_ids
    
    with _lock:
        _baseline_device_ids = get_usb_devices_registry_fast()
        logger.info(f"📋 Baseline initialized: {len(_baseline_device_ids)} USB devices found")


def scan_and_block_fast() -> Dict[str, Any]:
    """
    المسح السريع والحظر باستخدام Registry-based detection.
    أسرع بـ 50x من الطريقة التقليدية (WMI).
    
    Returns:
        {
            'new_devices': [device_ids],
            'blocked': [device_ids],
            'errors': [str]
        }
    """
    result = {
        'new_devices': [],
        'blocked': [],
        'errors': []
    }
    
    try:
        # اكتشاف الأجهزة الجديدة
        new_devices = detect_new_devices_fast()
        
        for device_id in new_devices:
            result['new_devices'].append(device_id)
            
            # فحص إضافي: هل هو موافق عليه أو داخلي؟
            if is_device_approved(device_id):
                continue
            with _lock:
                if device_id in _blocked_device_ids:
                    continue
                if device_id in _internal_device_ids:
                    continue
            
            # جلب معلومات الجهاز
            device_info = get_device_full_info(device_id)
            
            if device_info:
                vid = device_info.get('vid', '')
                pid = device_info.get('pid', '')
                dev_class = device_info.get('class', '')
                name = device_info.get('name', '')
                location = device_info.get('location', '')
                
                # فحص شامل للأجهزة الداخلية
                if is_internal_device(device_id, vid, pid, dev_class, name, location):
                    with _lock:
                        _internal_device_ids.add(device_id)
                    continue
            
            # حظر الجهاز
            success, msg = disable_device_real(device_id)
            
            if success:
                result['blocked'].append(device_id)
                
                # حفظ في قاعدة البيانات (حتى لو لم تتوفر معلومات كاملة لضمان ظهوره في الداشبورد)
                info_to_save = device_info if device_info else {'device_id': device_id, 'name': 'Unknown USB Device'}
                info_to_save['blocked_at'] = datetime.utcnow().isoformat()
                info_to_save['block_method'] = 'Registry-Fast'
                save_pending_device_to_db(device_id, info_to_save)
                
                logger.info(f"🚫 FAST BLOCKED: {info_to_save.get('name', device_id)}")
            else:
                result['errors'].append(f"Failed to block {device_id}: {msg}")
                with _lock:
                    _failed_device_ids.add(device_id)
    
    except Exception as e:
        logger.error(f"Error in fast scan: {e}")
        result['errors'].append(str(e))
    
    return result


def get_all_usb_peripherals() -> List[Dict[str, Any]]:
    """
    جلب جميع أجهزة USB الطرفية المتصلة حالياً مع بياناتها الكاملة.
    يستثني الأجهزة الداخلية تلقائياً.

    يُرجع قائمة بالأجهزة الطرفية مع البيانات الكاملة:
    - device_id (InstanceId)
    - name (FriendlyName)
    - class
    - manufacturer
    - status (OK/Error/Disabled)
    - vid, pid
    - serial_number
    - location
    - hardware_ids
    - is_enabled
    - is_internal
    """
    if platform.system() != 'Windows':
        logger.warning("Device blocker currently supports Windows only")
        return []

    try:
        # PowerShell script شامل لجلب كافّة أجهزة USB الفيزيائيّة فقط
        # نستخدم Get-PnpDevice ونركز على الأجهزة التي تبدأ بـ USB\VID_*
        # ونستبعد المركبات (Composite) والواجهات الفرعية (&MI_*) لمنع التكرار
        ps_script = '''
        $allDevices = @()
        
        # جلب الأجهزة الأب فقط (Physical Parent Devices)
        # هذا يمنع ظهور الماوس والكيبورد كأجهزة منفصلة إذا كانت جزءاً من USB Composite
        $usbDevices = Get-PnpDevice | Where-Object {
            ($_.InstanceId -like "USB\\VID_*" -or $_.InstanceId -like "USBSTOR\\*") -and
            -not ($_.InstanceId -like "*&MI_*") -and
            $_.Present -eq $true
        }

        # قاموس لمنع تكرار نفس الجهاز بناءً على InstanceId
        $seen = @{}

        foreach ($dev in $usbDevices) {
            $instanceId = $dev.InstanceId
            if ($seen.ContainsKey($instanceId)) { continue }
            $seen[$instanceId] = $true
            
            try {
                $devVid = ""
                $devPid = ""
                $serial = ""

                # استخراج VID و PID
                if ($instanceId -match "VID_([0-9A-Fa-f]{4})") { 
                    $devVid = $matches[1] 
                }
                if ($instanceId -match "PID_([0-9A-Fa-f]{4})") { 
                    $devPid = $matches[1] 
                }
                
                # استخراج Serial Number الحقيقي إن وجد
                if ($instanceId -match "\\\\([^\\\\]+)$") {
                    $lastPart = $matches[1]
                    if ($lastPart -match "^[A-Za-z0-9]{5,}$" -and $lastPart -notmatch "[&_]") {
                        $serial = $lastPart
                    }
                }

                # جلب خصائص إضافية من Registry
                $regPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\$instanceId"
                $manufacturer = ""
                $locationInfo = ""
                $hardwareIds = @()
                $friendlyName = $dev.FriendlyName

                if (Test-Path $regPath) {
                    $props = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue
                    if ($props) {
                        if ($props.Mfg) { $manufacturer = $props.Mfg }
                        if ($props.LocationInformation) { $locationInfo = $props.LocationInformation }
                        if ($props.HardwareID) { $hardwareIds = $props.HardwareID }
                        if (-not $friendlyName -and $props.DeviceDesc) {
                            $friendlyName = $props.DeviceDesc
                        }
                    }
                }

                # تحديد حالة التفعيل
                $isEnabled = ($dev.Status -eq "OK")

                $devName = if ($friendlyName) { $friendlyName } else { "Unknown USB Device" }
                $devClass = if ($dev.Class) { $dev.Class } else { "Unknown" }
                $devProblem = if ($dev.Problem) { [int]$dev.Problem } else { 0 }
                $devStatus = [string]$dev.Status

                $deviceObj = @{
                    'device_id'    = $instanceId
                    'name'         = $devName
                    'class'        = $devClass
                    'manufacturer' = $manufacturer
                    'status'       = $devStatus
                    'vid'          = $devVid
                    'pid'          = $devPid
                    'serial_number'= $serial
                    'location'     = $locationInfo
                    'hardware_ids' = ($hardwareIds -join ";")
                    'is_enabled'   = $isEnabled
                    'problem_code' = $devProblem
                }

                $allDevices += $deviceObj

            } catch {
                # تخطي الأجهزة التي تسبب أخطاء
                continue
            }
        }

        $allDevices | ConvertTo-Json -Depth 3
        '''

        result = subprocess.run(
            ['powershell', '-NoProfile', '-NonInteractive', '-Command', ps_script],
            capture_output=True, text=True, timeout=45
        )

        if result.returncode != 0:
            logger.error(f"PowerShell error getting peripherals: {result.stderr}")
            return []

        output = result.stdout.strip()
        if not output or output == '':
            return []

        devices = json.loads(output)
        if isinstance(devices, dict):
            devices = [devices]
        if not isinstance(devices, list):
            return []

        # فلترة الأجهزة الداخلية وتصنيف كل جهاز
        peripherals = []
        for dev in devices:
            device_id = dev.get('device_id', '')
            vid = dev.get('vid', '')
            pid = dev.get('pid', '')
            dev_class = dev.get('class', '')
            name = dev.get('name', '')
            location = dev.get('location', '')

            internal = is_internal_device(device_id, vid, pid, dev_class, name, location)
            dev['is_internal'] = internal

            if internal:
                with _lock:
                    _internal_device_ids.add(device_id)
                continue  # استثناء من القائمة الطرفية

            peripherals.append(dev)

        return peripherals

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse device list JSON: {e}")
        return []
    except subprocess.TimeoutExpired:
        logger.error("Timeout getting USB peripherals")
        return []
    except Exception as e:
        logger.error(f"Error getting USB peripherals: {e}")
        return []


def disable_device_real(device_id: str) -> Tuple[bool, str]:
    """
    تعطيل جهاز USB فعلياً.
    يجرب أولاً Disable-PnpDevice، وعند الفشل يجرب pnputil /disable-device.
    هذا ليس محاكاة - الجهاز سيتوقف عن العمل فعلياً.

    Returns:
        (success, message)
    """
    if platform.system() != 'Windows':
        return False, "Windows only"

    try:
        # تنظيف device_id من أحرف خاصة لمنع injection
        safe_id = device_id.replace('"', '').replace("'", "").replace(';', '')

        # ---- المحاولة الأولى: pnputil /disable-device ----
        # نستخدم pnputil أولاً لأنه يتعامل مع التعريفات بشكل أفضل ولا يسبب مشكلة "يتصل ويفصل"
        try:
            logger.info(f"Trying pnputil to disable {device_id}...")
            pnp_result = subprocess.run(
                ['pnputil', '/disable-device', safe_id],
                capture_output=True, text=True, timeout=15
            )
            pnp_output = (pnp_result.stdout + pnp_result.stderr).strip()

            if pnp_result.returncode == 0 or 'successfully' in pnp_output.lower():
                with _lock:
                    _blocked_device_ids.add(device_id)
                logger.info(f"🔒 BLOCKED device (pnputil): {device_id}")
                return True, f"تم تعطيل الجهاز عبر pnputil: {device_id}"
        except FileNotFoundError:
            logger.debug(f"pnputil not found, attempting WMI for {device_id}")
        except Exception as pnp_err:
            logger.debug(f"pnputil error for {device_id}: {pnp_err}")

        # ---- المحاولة الثانية: WMI Disable() ----
        # نبتعد عن Disable-PnpDevice لأنه يسبب إعادة تحميل للجهاز في بعض الحالات
        logger.debug(f"Attempting WMI disable for {device_id}...")
        wmi_safe_id = safe_id.replace('\\', '\\\\')
        wmi_cmd = [
            'powershell', '-NoProfile', '-NonInteractive', '-Command',
            f'$dev = Get-WmiObject Win32_PnPEntity -Filter "DeviceID=\'{wmi_safe_id}\'"; if ($dev) {{ $dev.Disable() | Out-Null; Write-Output "DISABLED_WMI_OK" }} else {{ Write-Output "NOT_FOUND" }}'
        ]
        wmi_result = subprocess.run(wmi_cmd, capture_output=True, text=True, timeout=15)

        if 'DISABLED_WMI_OK' in wmi_result.stdout:
            with _lock:
                _blocked_device_ids.add(device_id)
            logger.info(f"🔒 BLOCKED device (WMI): {device_id}")
            return True, f"تم تعطيل الجهاز عبر WMI: {device_id}"

        # ---- المحاولة الثالثة: Disable-PnpDevice (كملاذ أخير) ----
        logger.debug(f"Attempting Disable-PnpDevice for {device_id}...")
        ps_cmd = [
            'powershell', '-NoProfile', '-NonInteractive', '-Command',
            f'try {{ Disable-PnpDevice -InstanceId "{safe_id}" -Confirm:$false -ErrorAction Stop; Write-Output "DISABLED_PS_OK" }} catch {{ Write-Host $_.Exception.Message }}'
        ]
        ps_result = subprocess.run(ps_cmd, capture_output=True, text=True, timeout=15)
        
        if 'DISABLED_PS_OK' in ps_result.stdout or ps_result.returncode == 0:
            # Check if it was silently blocked
            if 'Not supported' not in ps_result.stdout and 'NotImplemented' not in ps_result.stdout:
                with _lock:
                    _blocked_device_ids.add(device_id)
                logger.info(f"🔒 BLOCKED device (Disable-PnpDevice): {device_id}")
                return True, f"تم تعطيل الجهاز عبر Disable-PnpDevice: {device_id}"

        # كل الطرق فشلت
        return False, f"فشل التعطيل بجميع الطرق. خطأ pnputil: {pnp_output}"

    except subprocess.TimeoutExpired:
        return False, "انتهت مهلة التعطيل"
    except Exception as e:
        logger.error(f"Error disabling device {device_id}: {e}")
        return False, str(e)


def enable_device_real(device_id: str) -> Tuple[bool, str]:
    """
    إعادة تفعيل جهاز USB فعلياً.
    يجرب أولاً Enable-PnpDevice، وعند الفشل يجرب pnputil /enable-device.

    Returns:
        (success, message)
    """
    if platform.system() != 'Windows':
        return False, "Windows only"

    try:
        safe_id = device_id.replace('"', '').replace("'", "").replace(';', '')

        # ---- المحاولة الأولى: pnputil /enable-device ----
        try:
            logger.info(f"Trying pnputil to enable {device_id}...")
            pnp_result = subprocess.run(
                ['pnputil', '/enable-device', safe_id],
                capture_output=True, text=True, timeout=15
            )
            pnp_output = (pnp_result.stdout + pnp_result.stderr).strip()

            if pnp_result.returncode == 0 or 'successfully' in pnp_output.lower():
                with _lock:
                    _blocked_device_ids.discard(device_id)
                    _approved_device_ids.add(device_id)
                logger.info(f"🔓 ENABLED device (pnputil): {device_id}")
                return True, f"تم تفعيل الجهاز عبر pnputil: {device_id}"
        except FileNotFoundError:
            logger.debug(f"pnputil not found, attempting WMI for {device_id}")
        except Exception as pnp_err:
            logger.debug(f"pnputil error for {device_id}: {pnp_err}")

        # ---- المحاولة الثانية: WMI Enable() ----
        logger.debug(f"Attempting WMI enable for {device_id}...")
        wmi_safe_id = safe_id.replace('\\', '\\\\')
        wmi_cmd = [
            'powershell', '-NoProfile', '-NonInteractive', '-Command',
            f'$dev = Get-WmiObject Win32_PnPEntity -Filter "DeviceID=\'{wmi_safe_id}\'"; if ($dev) {{ $dev.Enable() | Out-Null; Write-Output "ENABLED_WMI_OK" }} else {{ Write-Output "NOT_FOUND" }}'
        ]
        wmi_result = subprocess.run(wmi_cmd, capture_output=True, text=True, timeout=15)
        
        if 'ENABLED_WMI_OK' in wmi_result.stdout:
            with _lock:
                _blocked_device_ids.discard(device_id)
                _approved_device_ids.add(device_id)
            logger.info(f"🔓 ENABLED device (WMI): {device_id}")
            return True, f"تم تفعيل الجهاز عبر WMI: {device_id}"

        # ---- المحاولة الثالثة: Enable-PnpDevice (كملاذ أخير) ----
        logger.debug(f"Attempting Enable-PnpDevice for {device_id}...")
        ps_cmd = [
            'powershell', '-NoProfile', '-NonInteractive', '-Command',
            f'try {{ Enable-PnpDevice -InstanceId "{safe_id}" -Confirm:$false -ErrorAction Stop; Write-Output "ENABLED_PS_OK" }} catch {{ Write-Host $_.Exception.Message }}'
        ]
        ps_result = subprocess.run(ps_cmd, capture_output=True, text=True, timeout=15)
        
        if 'ENABLED_PS_OK' in ps_result.stdout or ps_result.returncode == 0:
            if 'Not supported' not in ps_result.stdout and 'NotImplemented' not in ps_result.stdout:
                with _lock:
                    _blocked_device_ids.discard(device_id)
                    _approved_device_ids.add(device_id)
                logger.info(f"🔓 ENABLED device (Enable-PnpDevice): {device_id}")
                return True, f"تم تفعيل الجهاز عبر Enable-PnpDevice: {device_id}"

        # كل الطرق فشلت
        return False, f"فشل التفعيل بجميع الطرق. خطأ pnputil: {pnp_output}"

    except subprocess.TimeoutExpired:
        return False, "انتهت مهلة التفعيل"
    except Exception as e:
        logger.error(f"Error enabling device {device_id}: {e}")
        return False, str(e)


def get_device_full_info(device_id: str) -> Optional[Dict[str, Any]]:
    """
    جلب البيانات الكاملة لجهاز محدد قبل حظره.
    يتضمن: الاسم، الشركة المصنعة، النوع، VID/PID، Serial، Driver، الحالة.
    """
    if platform.system() != 'Windows':
        return None

    try:
        safe_id = device_id.replace('"', '').replace("'", "").replace(';', '')

        ps_script = f'''
        $dev = Get-PnpDevice | Where-Object {{ $_.InstanceId -eq "{safe_id}" }} | Select-Object -First 1
        if ($dev) {{
            $regPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\{safe_id}"
            $manufacturer = ""
            $locationInfo = ""
            $driver = ""
            $hardwareIds = @()

            if (Test-Path $regPath) {{
                $props = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue
                if ($props) {{
                    if ($props.Mfg) {{ $manufacturer = $props.Mfg }}
                    if ($props.LocationInformation) {{ $locationInfo = $props.LocationInformation }}
                    if ($props.Driver) {{ $driver = $props.Driver }}
                    if ($props.HardwareID) {{ $hardwareIds = $props.HardwareID }}
                }}
            }}

            $devVid = ""
            $devPid = ""
            $serial = ""
            if ("{safe_id}" -match "VID_([0-9A-Fa-f]{{4}})") {{ $devVid = $matches[1] }}
            if ("{safe_id}" -match "PID_([0-9A-Fa-f]{{4}})") {{ $devPid = $matches[1] }}
            if ("{safe_id}" -match "\\\\([^\\\\]+)$") {{
                $lastPart = $matches[1]
                if ($lastPart -match "^[A-Za-z0-9]{{5,}}$" -and $lastPart -notmatch "^[0-9]&") {{
                    $serial = $lastPart
                }}
            }}

            $devName = if ($dev.FriendlyName) {{ $dev.FriendlyName }} else {{ "Unknown USB Device" }}
            $devClass = if ($dev.Class) {{ $dev.Class }} else {{ "Unknown" }}
            $devProblem = if ($dev.Problem) {{ [int]$dev.Problem }} else {{ 0 }}
            $devStatus = [string]$dev.Status

            @{{
                'device_id'     = "{safe_id}"
                'name'          = $devName
                'class'         = $devClass
                'manufacturer'  = $manufacturer
                'status'        = $devStatus
                'vid'           = $devVid
                'pid'           = $devPid
                'serial_number' = $serial
                'location'      = $locationInfo
                'driver'        = $driver
                'hardware_ids'  = ($hardwareIds -join ";")
                'is_enabled'    = ($devStatus -eq "OK")
                'problem_code'  = $devProblem
                'present'       = $dev.Present
            }} | ConvertTo-Json -Depth 2
        }} else {{
            Write-Output "NOT_FOUND"
        }}
        '''

        result = subprocess.run(
            ['powershell', '-NoProfile', '-NonInteractive', '-Command', ps_script],
            capture_output=True, text=True, timeout=10
        )

        if result.returncode == 0:
            output = result.stdout.strip()
            if output == 'NOT_FOUND' or not output:
                return None
            try:
                return json.loads(output)
            except:
                return None

        return None

    except Exception as e:
        # Reduced logging for dynamic device info retrieval timeouts/errors
        logger.debug(f"Info retrieval skipped for {device_id}: {e}")
        return None


def scan_and_block_new_peripherals() -> Dict[str, Any]:
    """
    المسح الرئيسي: يكشف كل الأجهزة الطرفية ويحظر الجديدة فعلياً.

    هذه الدالة تُستدعى دورياً من الـ scheduler.

    Returns:
        {
            'total_peripherals': int,
            'newly_blocked': [{ device info }],
            'already_blocked': int,
            'approved': int,
            'internal_skipped': int,
            'errors': [str]
        }
    """
    result = {
        'total_peripherals': 0,
        'newly_blocked': [],
        'already_blocked': 0,
        'approved': 0,
        'internal_skipped': 0,
        'errors': []
    }

    try:
        # تحديث قائمة الأجهزة الموافق عليها من القاعدة بشكل دوري كل 5 ثواني قبل أي فحص
        if time.time() - _last_approved_sync >= 5.0:
            load_approved_devices_from_db()

        peripherals = get_all_usb_peripherals()
        result['total_peripherals'] = len(peripherals)
        result['internal_skipped'] = len(_internal_device_ids)

        for device in peripherals:
            device_id = device.get('device_id', '')
            if not device_id:
                continue

            is_approved = is_device_approved(device_id, device.get('serial_number', ''))
            with _lock:
                is_already_blocked = device_id in _blocked_device_ids
                is_failed = device_id in _failed_device_ids

            # إذا الجهاز موافق عليه، لا تحظره، وأعد تفعيله إن كان معطلاً في ويندوز
            if is_approved:
                if not device.get('is_enabled', True):
                    enable_ok, _ = enable_device_real(device_id)
                    if enable_ok:
                        with _lock:
                            _blocked_device_ids.discard(device_id)
                            _failed_device_ids.discard(device_id)
                        logger.info(f"🔓 Auto-enabled approved device: {device.get('name', device_id)}")
                result['approved'] += 1
                continue

            # إذا الجهاز محظور مسبقاً وما زال معطّل
            if is_already_blocked:
                result['already_blocked'] += 1
                continue

            # إذا فشل الحظر مسبقاً (مثلاً بسبب عدم صلاحيات Admin)
            if is_failed:
                result['already_blocked'] += 1
                continue

            # ---- جهاز جديد غير معروف → حظره فعلياً ----

            # استخدم البيانات المتوفرة مباشرة بدلاً من استدعاء PowerShell إضافي
            # البيانات الكاملة موجودة أصلاً من get_all_usb_peripherals
            full_info = device.copy()
            if not full_info:
                full_info = device  # استخدم البيانات المتوفرة

            # 2. حظر فعلي
            is_enabled = device.get('is_enabled', True)
            if is_enabled:
                success, msg = disable_device_real(device_id)
                if success:
                    full_info['blocked_at'] = datetime.utcnow().isoformat()
                    full_info['block_status'] = 'blocked'
                    full_info['block_method'] = 'Disable-PnpDevice'
                    result['newly_blocked'].append(full_info)
                    logger.info(
                        f"🚫 NEW DEVICE BLOCKED: {full_info.get('name', 'Unknown')} "
                        f"(VID:{full_info.get('vid', '?')} PID:{full_info.get('pid', '?')}) "
                        f"Serial: {full_info.get('serial_number', 'N/A')}"
                    )
                else:
                    # إضافة للقائمة الفاشلة لتجنب التكرار كل 5 ثواني
                    with _lock:
                        _failed_device_ids.add(device_id)
                    if 'Generic failure' in msg or 'Access' in msg:
                        logger.warning(
                            f"⚠️ فشل حظر {device_id}: يحتاج تشغيل كـ Administrator. "
                            f"شغّل: python app.py بصلاحيات المسؤول"
                        )
                    result['errors'].append(f"Failed to block {device_id}: {msg}")
                    
                    # إضافته للقاعدة كمعلق حتى لو فشل الحظر لكي يظهر للمسؤول
                    full_info['blocked_at'] = datetime.utcnow().isoformat()
                    full_info['block_status'] = 'failed'
                    full_info['block_method'] = 'failed'
                    result['newly_blocked'].append(full_info)
            else:
                # الجهاز بالفعل معطّل (ربما حُظر سابقاً) أو النظام أقلع وهو معطّل
                with _lock:
                    _blocked_device_ids.add(device_id)
                
                # إضافة الجهاز لقائمة المحظورين الجدد لضمان إرساله لقاعدة البيانات
                full_info['blocked_at'] = datetime.utcnow().isoformat()
                full_info['block_status'] = 'blocked'
                full_info['block_method'] = 'Already Disabled'
                result['newly_blocked'].append(full_info)
                result['already_blocked'] += 1

        # إضافة كل الأجهزة للقائمة المعروفة
        with _lock:
            for dev in peripherals:
                _known_device_ids.add(dev.get('device_id', ''))

    except Exception as e:
        logger.error(f"Error in scan_and_block: {e}")
        result['errors'].append(str(e))

    # --- تنظيف الأجهزة المعلقة التي انفصلت ---
    try:
        from supabase_config import get_supabase_client
        client = get_supabase_client()
        if client:
            # جلب الأجهزة المعلقة الحالية لهذا السيرفر
            pending_db = client.table('server_pending_devices').select('device_id').eq('server_id', 1).execute()
            if pending_db.data:
                db_device_ids = {d['device_id'] for d in pending_db.data}
                
                # جلب الأجهزة المتصلة حالياً (بما فيها المخفية/المعطلة)
                current_present_ids = set()
                ps_present = 'Get-PnpDevice | Where-Object { $_.Present -eq $true } | Select-Object -ExpandProperty InstanceId'
                try:
                    pres_res = subprocess.run(['powershell', '-NoProfile', '-Command', ps_present], capture_output=True, text=True, timeout=10)
                    current_present_ids = {line.strip() for line in pres_res.stdout.split('\n') if line.strip()}
                except: pass

                # إذا الجهاز في DB وليس متصلاً فعلياً بالنظام -> احذفه
                for dev_id in db_device_ids:
                    if dev_id not in current_present_ids:
                        remove_pending_device_from_db(dev_id)
                        logger.info(f"🗑️ Auto-removed disconnected pending device from DB: {dev_id}")
    except Exception as e:
        logger.debug(f"Error auto-cleaning pending devices: {e}")

    return result


def cleanup_all_blocked_devices() -> Dict[str, Any]:
    """
    إعادة تفعيل جميع الأجهزة المحظورة عند إغلاق التطبيق.
    يضمن تفعيل كافة الأجهزة التي عطلها البرنامج، حتى لو لم تعد في قائمة _blocked_device_ids.
    """
    result = {'enabled': 0, 'failed': 0, 'errors': []}

    # 1. تفعيل الأجهزة المسجلة في الذاكرة أولاً
    with _lock:
        blocked_ids_in_memory = list(_blocked_device_ids)

    # 2. البحث عن أي أجهزة USB معطلة فعلياً في النظام لضمان تنظيف شامل
    ps_find_disabled = '''
    $disabled = Get-PnpDevice | Where-Object {
        ($_.InstanceId -like "USB\\VID_*" -or $_.InstanceId -like "HID\\VID_*") -and
        $_.Present -eq $true -and
        ($_.Status -eq "Error" -or $_.Status -eq "Disabled")
    } | Select-Object -ExpandProperty InstanceId
    if ($disabled) { $disabled | Out-String } else { "" }
    '''
    
    try:
        find_res = subprocess.run(['powershell', '-NoProfile', '-Command', ps_find_disabled], 
                                  capture_output=True, text=True, timeout=10)
        system_disabled_ids = [line.strip() for line in find_res.stdout.split('\n') if line.strip()]
    except Exception:
        system_disabled_ids = []

        # دمج القائمتين وحذف التكرار
    all_to_cleanup = list(set(blocked_ids_in_memory + system_disabled_ids))

    # 3. تنظيف جدول server_pending_devices في قاعدة البيانات
    try:
        cleanup_pending_devices_from_db()
        print("   ✅ server_pending_devices table cleared in DB")
    except Exception as e:
        print(f"   ⚠️ Failed to clear pending devices in DB: {e}")

    if not all_to_cleanup:
        print("✅ No blocked devices to clean up")
        return result

    print(f"🧹 Cleaning up {len(all_to_cleanup)} blocked device(s)...")

    for device_id in all_to_cleanup:
        try:
            success, msg = enable_device_real(device_id)
            if success:
                result['enabled'] += 1
                print(f"   ✅ Re-enabled: {device_id}")
            else:
                result['failed'] += 1
                result['errors'].append(f"{device_id}: {msg}")
                print(f"   ❌ Failed to re-enable: {device_id} - {msg}")
        except Exception as e:
            result['failed'] += 1
            result['errors'].append(f"{device_id}: {str(e)}")
            print(f"   ❌ Error re-enabling: {device_id} - {e}")

    # تنظيف القوائم الداخلية
    with _lock:
        _blocked_device_ids.clear()
        _failed_device_ids.clear()

    print(f"🧹 Cleanup complete: {result['enabled']} enabled, {result['failed']} failed")
    return result


def approve_and_enable_device(device_id: str) -> Tuple[bool, str, Optional[Dict]]:
    """
    الموافقة على جهاز معلق وتفعيله فعلياً.
    يُستدعى عندما يضغط الأدمن "موافقة" في الداشبورد.
    - يفعّل الجهاز فعلياً عبر Enable-PnpDevice
    - يحفظه في قاعدة البيانات (Supabase) بحالة connected

    Returns:
        (success, message, device_info)
    """
    try:
        # جلب بيانات الجهاز
        device_info = get_device_full_info(device_id)

        # تفعيل الجهاز فعلياً
        success, msg = enable_device_real(device_id)

        if success:
            # نقل الجهاز من المحظور إلى الموافق عليه
            serial_num = (device_info or {}).get('serial_number', '')
            add_to_approved_list(device_id, serial_num)

            logger.info(f"✅ Device approved and enabled: {device_id}")

            if device_info:
                device_info['approved_at'] = datetime.utcnow().isoformat()
                device_info['block_status'] = 'approved'

            # ---- حفظ الجهاز في قاعدة البيانات (Supabase) ----
            _save_approved_device_to_db(device_id, device_info)

            return True, msg, device_info

        return success, msg, device_info

    except Exception as e:
        logger.error(f"Error approving device {device_id}: {e}")
        return False, str(e), None


def _save_approved_device_to_db(device_id: str, device_info: Optional[Dict]):
    """
    حفظ الجهاز الموافق عليه في Supabase (جدول devices الرئيسي).
    - ينقله من server_pending_devices → devices
    - إذا كان موجوداً في devices → يحدّث الحالة إلى connected + whitelisted
    - إذا كان جديداً → يضيفه بحالة connected + whitelisted
    """
    try:
        from supabase_config import get_supabase_client
        client = get_supabase_client()
        if not client:
            logger.warning("Supabase client not available - device not saved to DB")
            return

        info = device_info or {}
        serial = info.get('serial_number', '')
        vid = info.get('vid', '')
        pid_val = info.get('pid', '')
        now_iso = datetime.utcnow().isoformat()

        # إذا ما عندنا سيريال نمبر نحاول نستخرجه من device_id
        if not serial:
            parts = device_id.replace('\\\\', '\\').split('\\')
            if len(parts) >= 3:
                serial = parts[-1]

        if not serial:
            logger.warning(f"Cannot save device to DB - no serial number for {device_id}")
            return

        # نبحث بالسيريال أولاً
        response = client.table('devices').select('id, serial_number, status') \
            .eq('serial_number', serial).execute()

        if response.data:
            # الجهاز موجود → نحدّث حالته
            existing = response.data[0]
            update_data = {
                'status': 'connected',
                'is_verified': True,
                'whitelisted': True,
                'approved_at': now_iso,
                'last_scan_time': now_iso,
                'meta_data': json.dumps({
                    'device_id': device_id,
                    'pnp_instance_id': device_id,
                    'manufacturer': info.get('manufacturer', ''),
                    'class': info.get('class', ''),
                    'vid': vid,
                    'pid': pid_val,
                    'name': info.get('name', ''),
                    'approved_via': 'device_blocker',
                    'approved_at': now_iso,
                    'is_real_device': True
                })
            }
            client.table('devices').update(update_data).eq('id', existing['id']).execute()
            logger.info(f"✅ Updated existing device in DB: {serial} -> connected")

        else:
            # الجهاز جديد → نضيفه
            # جلب server_id
            server_id = 1
            try:
                from flask_jwt_extended import get_jwt
                jwt_data = get_jwt()
                server_id = jwt_data.get('server_id', 1)
            except Exception:
                pass

            device_meta = {
                'device_id': device_id,
                'pnp_instance_id': device_id,
                'manufacturer': info.get('manufacturer', 'Unknown'),
                'class': info.get('class', 'USB Device'),
                'vid': vid,
                'pid': pid_val,
                'name': info.get('name', ''),
                'location': info.get('location', ''),
                'hardware_ids': info.get('hardware_ids', []),
                'approved_via': 'device_blocker',
                'approved_at': now_iso,
                'is_real_device': True,
                'discovery_method': 'device_blocker'
            }

            new_device = {
                'server_id': server_id,
                'name': (info.get('name', '') or f"USB {vid}:{pid_val}")[:100],
                'serial_number': serial,
                'vendor_id': vid or '0000',
                'product_id': pid_val or '0000',
                'manufacturer': (info.get('manufacturer', 'Unknown'))[:100],
                'device_class': info.get('class', 'USB Device'),
                'status': 'connected',
                'connection_time': now_iso,
                'last_scan_time': now_iso,
                'meta_data': json.dumps(device_meta),
                'risk_level': 'low',
                'usb_port': info.get('location', 'USB Port'),
                'is_verified': True,
                'whitelisted': True,
                'whitelisted_at': now_iso,
                'approved_at': now_iso,
            }

            try:
                client.table('devices').insert(new_device).execute()
                logger.info(f"✅ New device saved to DB: {serial} (VID:{vid} PID:{pid_val})")
            except Exception as insert_err:
                err_msg = str(insert_err).lower()
                if 'duplicate' in err_msg or 'unique' in err_msg:
                    logger.warning(f"Device {serial} already exists in DB (duplicate key)")
                else:
                    raise

    except Exception as e:
        logger.warning(f"Could not save approved device to DB: {e}")
    finally:
        # ---- حذف الجهاز من جدول الانتظار المعزول دائماً (عند النجاح أو الفشل) ----
        try:
            from supabase_config import get_supabase_client
            _cli = get_supabase_client()
            if _cli:
                _cli.table('server_pending_devices').delete().eq('device_id', device_id).execute()
                logger.debug(f"🗑️ Removed from pending table after approval: {device_id}")
        except Exception:
            pass


# ==============================================================
# جدول الأجهزة المعلقة المعزول: server_pending_devices
# ==============================================================

def save_pending_device_to_db(device_id: str, device_info: Optional[Dict]) -> bool:
    """
    حفظ جهاز محظور (معلق) في جدول server_pending_devices المعزول.
    لا يُضاف إلى جدول devices الرئيسي حتى يُوافق عليه الأدمن.

    Returns:
        True إذا نجح الحفظ أو الجهاز موجود مسبقاً، False عند الخطأ
    """
    try:
        from flask import current_app
        from supabase_config import get_supabase_client
        client = get_supabase_client()
        if not client:
            return False

        # Get server_id from config
        server_id = 1
        try:
            server_id = current_app.config.get('SERVER_ID', 1)
        except:
            pass

        info = device_info or {}
        serial = info.get('serial_number', '')
        if not serial:
            parts = device_id.replace('\\\\', '\\').split('\\')
            if len(parts) >= 1:
                serial = parts[-1]

        now_iso = datetime.utcnow().isoformat()
        vid = info.get('vid', '0000')
        pid = info.get('pid', '0000')

        row = {
            'server_id':      server_id,
            'device_id':      device_id,
            'serial_number':  serial,
            'name':           info.get('name', 'Unknown USB Device'),
            'product':        info.get('name', ''),
            'vendor_id':      vid,
            'product_id':     pid,
            'manufacturer':   info.get('manufacturer', ''),
            'device_class':   info.get('class', 'USB Device'),
            'device_type':    info.get('class', 'USB Device'),
            'usb_port':       info.get('location', ''),
            'physical_path':  info.get('location', ''),
            'risk_level':     'high',
            'security_score': 0.0,
            'blocked_at':     now_iso,
            'connection_time': now_iso,
            'last_activity':  now_iso,
            'meta_data':      json.dumps({
                'pnp_instance_id':  device_id,
                'hardware_ids':     info.get('hardware_ids', ''),
                'blocked_at':       info.get('blocked_at', now_iso),
                'block_method':     info.get('block_method', 'Disable-PnpDevice'),
                'detection_method': 'device_blocker',
                'vid': vid,
                'pid': pid,
            })
        }

        # upsert: يعتمد على (server_id, device_id) لضمان عدم حدوث خطأ Duplicate Key
        try:
            # التحقق من وجود الجهاز لهذا السيرفر بالتحديد
            existing = client.table('server_pending_devices').select('id').eq('server_id', server_id).eq('device_id', device_id).execute()
            if existing.data and len(existing.data) > 0:
                # إذا كان موجوداً، نحدث فقط وقت النشاط لتجنب الخطأ
                client.table('server_pending_devices').update({'last_activity': now_iso}).eq('id', existing.data[0]['id']).execute()
            else:
                # إذا لم يكن موجوداً، نقوم بإدخاله
                from utils import safe_insert
                safe_insert(client, 'server_pending_devices', row)
        except Exception as e:
            # محاولة أخيرة في حالة التداخل اللحظي
            logger.debug(f"Handling potential race condition for pending device: {e}")
            pass

        logger.info(f"📋 Pending device saved to isolated table: {info.get('name', device_id)} (Server {server_id})")
        return True

    except Exception as e:
        logger.warning(f"Could not save pending device to isolated table: {e}")
        return False


def remove_pending_device_from_db(device_id: str) -> bool:
    """
    حذف جهاز معين من جدول server_pending_devices عند انقطاع اتصاله.
    """
    try:
        from supabase_config import get_supabase_client
        client = get_supabase_client()
        if not client:
            return False
        
        client.table('server_pending_devices').delete().eq('device_id', device_id).execute()
        return True
    except Exception as e:
        logger.warning(f"Failed to remove disconnected pending device from DB: {e}")
        return False


def cleanup_pending_devices_from_db(server_id: int = 1):
    """
    حذف جميع الأجهزة المعلقة من جدول server_pending_devices للسيرفر الحالي.
    يُستدعى تلقائياً عند إغلاق الباك إند.
    """
    try:
        from supabase_config import get_supabase_client
        client = get_supabase_client()
        if not client:
            return
            
        # حذف الأجهزة المعلقة الخاصة بهذا السيرفر فقط لضمان العزل
        client.table('server_pending_devices').delete().eq('server_id', server_id).execute()
        print(f"🧹 server_pending_devices table cleared for Server {server_id} in DB")
    except Exception as e:
        print(f"⚠️ Error cleaning DB: {e}")

def _discard_from_approved(device_id: str, serial_number: str = ''):
    """إزالة الجهاز وسيرياله من قوائم الموافقة."""
    dev_upper = (device_id or '').strip().upper()
    serial_upper = (serial_number or '').strip().upper()
    extracted = _extract_serial_from_device_id(device_id)
    with _lock:
        _approved_device_ids.discard(device_id)
        if dev_upper:
            _approved_device_ids_upper.discard(dev_upper)
        if serial_upper:
            _approved_serials.discard(serial_upper)
        if extracted:
            _approved_serials.discard(extracted)


def reject_and_keep_blocked(device_id: str) -> Tuple[bool, str]:
    """
    رفض طلب تفعيل الجهاز وإبقاؤه محظوراً.
    """
    try:
        success, msg = disable_device_real(device_id)
        _discard_from_approved(device_id)
        with _lock:
            _blocked_device_ids.add(device_id)
        return True, "الجهاز مرفوض ومحظور"
    except Exception as e:
        return False, str(e)


def revoke_device_approval(device_id: str) -> Tuple[bool, str]:
    """
    سحب الموافقة من جهاز وإعادة حظره.
    """
    try:
        success, msg = disable_device_real(device_id)
        _discard_from_approved(device_id)
        with _lock:
            _blocked_device_ids.add(device_id)
        if success:
            return True, "تم سحب الموافقة وحظر الجهاز"
        return False, msg
    except Exception as e:
        return False, str(e)


def get_blocked_devices_list() -> List[Dict[str, Any]]:
    """
    جلب قائمة الأجهزة المحظورة حالياً مع بياناتها.
    """
    blocked = []
    with _lock:
        blocked_ids = list(_blocked_device_ids)

    for device_id in blocked_ids:
        info = get_device_full_info(device_id)
        if info:
            info['block_status'] = 'blocked'
            blocked.append(info)

    return blocked


def get_approved_devices_list() -> List[Dict[str, Any]]:
    """
    جلب قائمة الأجهزة الموافق عليها.
    """
    approved = []
    with _lock:
        approved_ids = list(_approved_device_ids)

    for device_id in approved_ids:
        info = get_device_full_info(device_id)
        if info:
            info['block_status'] = 'approved'
            approved.append(info)

    return approved


def add_to_approved_list(device_id: str, serial_number: str = ''):
    """
    إضافة جهاز مباشرة لقائمة الموافق عليها (مثلاً من قاعدة البيانات عند بدء النظام).
    """
    dev_upper = (device_id or '').strip().upper()
    serial_upper = (serial_number or '').strip().upper()
    extracted = _extract_serial_from_device_id(device_id)

    with _lock:
        if device_id:
            _approved_device_ids.add(device_id)
        if dev_upper:
            _approved_device_ids_upper.add(dev_upper)
        if serial_upper and _is_valid_hardware_serial(serial_upper):
            _approved_serials.add(serial_upper)
        if extracted:
            _approved_serials.add(extracted)
        if device_id:
            _blocked_device_ids.discard(device_id)
            _failed_device_ids.discard(device_id)


def load_approved_devices_from_db():
    """
    تحميل الأجهزة الموافق عليها من قاعدة البيانات.
    يبحث عن PnP InstanceId في metadata أو يستخدم serial_number + VID/PID
    ويحفظ السيريالات أيضاً لضمان عدم حظر الأجهزة الموافق عليها حتى عند تغيّر وضع USB أو حالة الأحرف.
    """
    global _last_approved_sync
    try:
        from supabase_config import get_supabase_client
        client = get_supabase_client()
        if not client:
            return

        _last_approved_sync = time.time()

        # جلب الأجهزة الموافق عليها أو الموثقة أو في القائمة البيضاء
        fields = 'serial_number, vendor_id, product_id, status, meta_data, whitelisted, blacklisted, is_verified'

        approved_resp = client.table('devices').select(fields).eq('status', 'approved').execute()
        whitelisted_resp = client.table('devices').select(fields).eq('whitelisted', True).execute()
        verified_resp = client.table('devices').select(fields).eq('is_verified', True).execute()

        # دمج النتائج مع إزالة التكرار واستبعاد المحظورة في القائمة السوداء
        all_devices = {}
        for dev in (approved_resp.data or []) + (whitelisted_resp.data or []) + (verified_resp.data or []):
            if dev.get('blacklisted'):
                continue
            key = (dev.get('serial_number') or '').strip().upper()
            if key and key not in all_devices:
                all_devices[key] = dev

        response_data = list(all_devices.values())

        new_ids: Set[str] = set()
        new_ids_upper: Set[str] = set()
        new_serials: Set[str] = set()

        for dev in response_data:
            serial = (dev.get('serial_number') or '').strip()
            meta = dev.get('meta_data', '{}')
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except Exception:
                    meta = {}
            if not isinstance(meta, dict):
                meta = {}

            pnp_id = (meta.get('device_id', '') or meta.get('pnp_instance_id', '')).strip()

            # إذا ما لقينا PnP ID، نبني واحد من VID/PID/Serial بحروف كبيرة مطابقة لويندوز
            if not pnp_id:
                vid = (dev.get('vendor_id') or '').strip().upper()
                pid_val = (dev.get('product_id') or '').strip().upper()
                if vid and pid_val and serial:
                    pnp_id = f"USB\\VID_{vid}&PID_{pid_val}\\{serial}"

            if pnp_id:
                new_ids.add(pnp_id)
                new_ids_upper.add(pnp_id.upper())
                extracted = _extract_serial_from_device_id(pnp_id)
                if extracted:
                    new_serials.add(extracted)

            if _is_valid_hardware_serial(serial):
                new_serials.add(serial.upper())

        with _lock:
            _approved_device_ids.clear()
            _approved_device_ids.update(new_ids)
            _approved_device_ids_upper.clear()
            _approved_device_ids_upper.update(new_ids_upper)
            _approved_serials.clear()
            _approved_serials.update(new_serials)
            for pid_str in new_ids:
                _blocked_device_ids.discard(pid_str)
                _failed_device_ids.discard(pid_str)

        logger.debug(f"✅ Loaded {len(new_ids)} approved IDs and {len(new_serials)} serials from DB")

    except Exception as e:
        logger.warning(f"Could not load approved devices from DB: {e}")


def get_blocker_status() -> Dict[str, Any]:
    """
    جلب حالة نظام الحظر.
    """
    with _lock:
        return {
            'total_known': len(_known_device_ids),
            'blocked_count': len(_blocked_device_ids),
            'approved_count': len(_approved_device_ids),
            'internal_count': len(_internal_device_ids),
            'blocked_ids': list(_blocked_device_ids),
            'approved_ids': list(_approved_device_ids),
        }



def cleanup_on_shutdown():
    """
    تنظيف عند إغلاق الباك إند:
    إعادة تفعيل جميع الأجهزة التي تم حظرها (لجعلها متصلة عادي).
    ومسح الأجهزة المعلقة من قاعدة البيانات.
    """
    try:
        from flask import current_app
        server_id = 1
        try:
            server_id = current_app.config.get('SERVER_ID', 1)
        except:
            pass
        cleanup_pending_devices_from_db(server_id=server_id)
    except Exception as e:
        logger.warning(f"Could not clean pending devices table during shutdown: {e}")

    with _lock:
        blocked_list = list(_blocked_device_ids)
    
    if not blocked_list:
        return

    logger.info(f"🧹 Cleanup: Enabling {len(blocked_list)} blocked devices on shutdown...")
    
    for device_id in blocked_list:
        try:
            enable_device_real(device_id)
            logger.info(f"   🔓 Re-enabled: {device_id}")
        except Exception as e:
            logger.error(f"   ❌ Failed to re-enable {device_id}: {e}")
    
    with _lock:
        _blocked_device_ids.clear()
        # يمكن أيضاً نقلها للموافق عليها أو تفريغ القوائم

# ============================================================
# تصدير الدوال الرئيسية
# ============================================================
__all__ = [
    'scan_and_block_new_peripherals',
    'approve_and_enable_device',
    'deny_and_keep_blocked',
    'revoke_device_approval',
    'get_all_usb_peripherals',
    'get_blocked_devices_list',
    'get_approved_devices_list',
    'get_blocker_status',
    'add_to_approved_list',
    'load_approved_devices_from_db',
    'disable_device_real',
    'enable_device_real',
    'get_device_full_info',
    'is_internal_device',
    'cleanup_on_shutdown',
    # الدوال الجديدة للاكتشاف السريع (VID/PID Optimized)
    'get_usb_devices_registry_fast',
    'detect_new_devices_fast',
    'is_internal_device_fast',
    'initialize_baseline',
    'scan_and_block_fast',
    'DETECTION_METHOD',
    'REGISTRY_POLL_INTERVAL',
]
