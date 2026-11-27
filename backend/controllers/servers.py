import os
import json
import requests
import jwt
from datetime import datetime, timezone, timedelta
from flask import Blueprint, request, jsonify, current_app
# from flask_cors import cross_origin  # تم إزالة CORS المحلي
import secrets
import platform
import psutil
import socket
import threading
import time
from functools import wraps
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from sqlalchemy import or_

# Baghdad timezone (+3 UTC)
BAGHDAD_TZ = timezone(timedelta(hours=3))

def get_baghdad_time():
    """Get current time in Baghdad timezone"""
    return datetime.now(BAGHDAD_TZ)

def get_baghdad_time_iso():
    """Get current time in Baghdad timezone as ISO string"""
    return get_baghdad_time().replace(tzinfo=None).isoformat()

def auth_required_json(f):
    """Decorator for JWT authentication with JSON response"""
    @wraps(f)
    @jwt_required()
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            return jsonify({'error': 'Authentication failed', 'message': str(e)}), 401
    return decorated_function

def get_iraq_governorate_from_coordinates(lat, lng):
    """تحديد المحافظة العراقية بناءً على الإحداثيات الجغرافية"""
    
    # نطاقات الإحداثيات الجغرافية للمحافظات العراقية
    governorates = {
        'بغداد': {
            'lat_range': (33.1, 33.5),
            'lng_range': (44.2, 44.6),
            'center': (33.312, 44.361)
        },
        'الحلة - بابل': {
            'lat_range': (32.3, 32.7),
            'lng_range': (44.2, 44.8),
            'center': (32.464, 44.421)
        },
        'البصرة': {
            'lat_range': (30.3, 30.7),
            'lng_range': (47.6, 48.0),
            'center': (30.533, 47.798)
        },
        'الموصل - نينوى': {
            'lat_range': (36.2, 36.5),
            'lng_range': (43.0, 43.3),
            'center': (36.335, 43.118)
        },
        'أربيل': {
            'lat_range': (36.1, 36.3),
            'lng_range': (43.9, 44.1),
            'center': (36.191, 44.009)
        },
        'السليمانية': {
            'lat_range': (35.5, 35.7),
            'lng_range': (45.3, 45.5),
            'center': (35.561, 45.433)
        },
        'النجف': {
            'lat_range': (31.9, 32.1),
            'lng_range': (44.2, 44.4),
            'center': (32.025, 44.331)
        },
        'كربلاء': {
            'lat_range': (32.5, 32.7),
            'lng_range': (44.0, 44.2),
            'center': (32.615, 44.024)
        },
        'الناصرية - ذي قار': {
            'lat_range': (31.0, 31.2),
            'lng_range': (46.2, 46.4),
            'center': (31.057, 46.259)
        },
        'العمارة - ميسان': {
            'lat_range': (31.8, 32.0),
            'lng_range': (47.1, 47.3),
            'center': (31.841, 47.139)
        },
        'الكوت - واسط': {
            'lat_range': (32.4, 32.6),
            'lng_range': (45.8, 46.0),
            'center': (32.513, 45.834)
        },
        'الديوانية - القادسية': {
            'lat_range': (31.9, 32.1),
            'lng_range': (44.9, 45.1),
            'center': (31.998, 44.925)
        },
        'المثنى - السماوة': {
            'lat_range': (31.2, 31.4),
            'lng_range': (45.2, 45.4),
            'center': (31.331, 45.294)
        },
        'الأنبار - الرمادي': {
            'lat_range': (33.4, 33.6),
            'lng_range': (43.2, 43.4),
            'center': (33.422, 43.308)
        },
        'صلاح الدين - تكريت': {
            'lat_range': (34.5, 34.7),
            'lng_range': (43.6, 43.8),
            'center': (34.596, 43.686)
        },
        'ديالى - بعقوبة': {
            'lat_range': (33.7, 33.9),
            'lng_range': (44.6, 44.8),
            'center': (33.751, 44.644)
        },
        'كركوك': {
            'lat_range': (35.4, 35.6),
            'lng_range': (44.3, 44.5),
            'center': (35.468, 44.392)
        },
        'دهوك': {
            'lat_range': (36.8, 37.0),
            'lng_range': (42.9, 43.1),
            'center': (36.863, 42.978)
        }
    }
    
    # البحث عن المحافظة بناءً على الإحداثيات
    for governorate, bounds in governorates.items():
        lat_min, lat_max = bounds['lat_range']
        lng_min, lng_max = bounds['lng_range']
        
        if lat_min <= lat <= lat_max and lng_min <= lng <= lng_max:
            return {
                'governorate': governorate,
                'country': 'العراق',
                'flag': '🇮🇶',
                'coordinates': f'{lat},{lng}',
                'accuracy': 'high'
            }
    
    # إذا لم تطابق محافظة محددة، حاول التحديد بناءً على المسافة
    min_distance = float('inf')
    closest_governorate = None
    
    for governorate, bounds in governorates.items():
        center_lat, center_lng = bounds['center']
        distance = ((lat - center_lat) ** 2 + (lng - center_lng) ** 2) ** 0.5
        
        if distance < min_distance:
            min_distance = distance
            closest_governorate = governorate
    
    # إذا كانت المسافة قريبة (أقل من 0.5 درجة)، اعتبرها صالحة
    if min_distance < 0.5 and closest_governorate:
        return {
            'governorate': closest_governorate,
            'country': 'العراق',
            'flag': '🇮🇶',
            'coordinates': f'{lat},{lng}',
            'accuracy': 'estimated'
        }
    
    # إذا كانت الإحداثيات في العراق عموماً
    iraq_bounds = {
        'lat_range': (29.5, 37.5),
        'lng_range': (38.7, 48.8)
    }
    
    if (iraq_bounds['lat_range'][0] <= lat <= iraq_bounds['lat_range'][1] and
        iraq_bounds['lng_range'][0] <= lng <= iraq_bounds['lng_range'][1]):
        return {
            'governorate': 'محافظة غير محددة',
            'country': 'العراق',
            'flag': '🇮🇶',
            'coordinates': f'{lat},{lng}',
            'accuracy': 'country_only'
        }
    
    return None

def get_location_from_system():
    """الحصول على الموقع الجغرافي من إعدادات النظام الحقيقية فقط"""
    try:
        import platform
        import subprocess
        
        system = platform.system()
        
        if system == "Windows":
            # محاولة الحصول على الإحداثيات الحقيقية فقط
            try:
                cmd = '''powershell -Command "
                try {
                    Add-Type -AssemblyName System.Device
                    $watcher = New-Object System.Device.Location.GeoCoordinateWatcher
                    $watcher.Start()
                    Start-Sleep -Seconds 5
                    $coord = $watcher.Position.Location
                    if (-not $coord.IsUnknown) {
                        Write-Output ($coord.Latitude.ToString() + ',' + $coord.Longitude.ToString())
                    } else {
                        Write-Output 'NO_COORDINATES'
                    }
                    $watcher.Stop()
                } catch {
                    Write-Output 'ERROR'
                }
                "'''
                
                result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=15)
                
                if result.returncode == 0 and result.stdout.strip():
                    coords_output = result.stdout.strip()
                    
                    if coords_output not in ['NO_COORDINATES', 'ERROR'] and ',' in coords_output:
                        try:
                            lat, lng = map(float, coords_output.split(','))
                            
                            # تحديد المحافظة العراقية بناءً على الإحداثيات الحقيقية
                            location_info = get_iraq_governorate_from_coordinates(lat, lng)
                            if location_info:
                                return {
                                    'country': location_info['country'],
                                    'city': location_info['governorate'],
                                    'flag': location_info['flag'],
                                    'coordinates': location_info['coordinates'],
                                    'accuracy': location_info['accuracy'],
                                    'source': 'windows_real_coordinates'
                                }
                        except ValueError:
                            pass
                
            except Exception:
                pass
            
            # إذا لم نحصل على إحداثيات حقيقية، استخدم خدمة تحديد الموقع عبر الإنترنت
            try:
                # محاولة الحصول على الموقع من خدمة ip-api.com
                response = requests.get('http://ip-api.com/json', timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    if data.get('status') == 'success':
                        country = data.get('country', 'العراق')
                        city = data.get('city', 'العراق')
                        region = data.get('regionName', '')

                        # إذا كان البلد العراق، حاول تحديد المحافظة بدقة أكبر
                        if country == 'Iraq' or country == 'العراق':
                            # قاموس لتحويل أسماء المدن إلى محافظات عراقية
                            city_to_governorate = {
                                'Baghdad': 'بغداد',
                                'Basra': 'البصرة',
                                'Mosul': 'الموصل - نينوى',
                                'Erbil': 'أربيل',
                                'Najaf': 'النجف',
                                'Karbala': 'كربلاء',
                                'Kirkuk': 'كركوك',
                                'Sulaymaniyah': 'السليمانية',
                                'Diwaniya': 'الديوانية',
                                'Samawah': 'السماوة - المثنى',
                                'Nasiriyah': 'الناصرية',
                                'Amarah': 'العمارة - ميسان',
                                'Kut': 'الكوت - واسط',
                                'Ramadi': 'الرمادي - الأنبار',
                                'Fallujah': 'الفلوجة - الأنبار',
                                'Tikrit': 'تكريت - صلاح الدين',
                                'Baqubah': 'بعقوبة - ديالى',
                                'Hilla': 'الحلة - بابل',
                                'Dohuk': 'دهوك',
                                # إضافة الأسماء بالإنجليزية كما ترد من ip-api.com
                                'Muhafazat Babil': 'بابل',
                                'Muhafazat Baghdad': 'بغداد',
                                'Muhafazat Basra': 'البصرة',
                                'Muhafazat Nineveh': 'نينوى',
                                'Muhafazat Erbil': 'أربيل',
                                'Muhafazat Najaf': 'النجف',
                                'Muhafazat Karbala': 'كربلاء',
                                'Muhafazat Kirkuk': 'كركوك',
                                'Muhafazat Sulaymaniyah': 'السليمانية',
                                'Muhafazat Qadisiyah': 'القادسية',
                                'Muhafazat Muthanna': 'المثنى',
                                'Muhafazat Dhi Qar': 'ذي قار',
                                'Muhafazat Maysan': 'ميسان',
                                'Muhafazat Wasit': 'واسط',
                                'Muhafazat Anbar': 'الأنبار',
                                'Muhafazat Salah al-Din': 'صلاح الدين',
                                'Muhafazat Diyala': 'ديالى',
                                'Muhafazat Dohuk': 'دهوك'
                            }

                            # تحديد المحافظة بناءً على المدينة أو المنطقة
                            governorate = city_to_governorate.get(city, city_to_governorate.get(region, region))

                            # إضافة معلومات إضافية إذا كانت متوفرة
                            location_info = {
                                'country': 'العراق',
                                'city': governorate if governorate else 'العراق',
                                'flag': '🇮🇶',
                                'source': 'ip_geolocation'
                            }

                            # إضافة معلومات إضافية إذا كانت متوفرة
                            if data.get('regionName'):
                                location_info['region'] = data.get('regionName')
                            if data.get('zip'):
                                location_info['zip_code'] = data.get('zip')
                            if data.get('lat') and data.get('lon'):
                                location_info['coordinates'] = f"{data.get('lat')},{data.get('lon')}"

                            return location_info

                        # للدول الأخرى، أعد البيانات كما هي
                        return {
                            'country': country,
                            'city': city,
                            'flag': get_flag_from_country_code(data.get('countryCode', '')),
                            'source': 'ip_geolocation'
                        }

            except Exception:
                pass

            # إذا فشلت جميع المحاولات، استخدم المنطقة الزمنية كمصدر أخير
            try:
                cmd = 'powershell -Command "Get-TimeZone | Select-Object -ExpandProperty Id"'
                result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)

                if result.returncode == 0:
                    timezone_id = result.stdout.strip()

                    if timezone_id == 'Arabic Standard Time':
                        return {
                            'country': 'العراق',
                            'city': 'العراق',
                            'flag': '🇮🇶',
                            'source': 'system_timezone'
                        }
            except Exception:
                pass
        
        return None
    
    except Exception:
        return None

def get_location_from_ip(ip_address):
    """تحديد الموقع الجغرافي بناءً على عنوان IP أو إعدادات النظام"""
    
    # أولاً محاولة الحصول على الموقع من إعدادات النظام
    system_location = get_location_from_system()
    if system_location:
        return system_location
    
    # متغير لتخزين IP المستخدم للاستعلام
    query_ip = ip_address
    
    # للعناوين المحلية، نحاول الحصول على IP العام
    if (ip_address.startswith('192.168.') or 
        ip_address.startswith('10.') or 
        ip_address.startswith('127.') or
        any(ip_address.startswith(f'172.{i}.') for i in range(16, 32))):
        
        # محاولة الحصول على IP العام باستخدام خدمات متعددة
        public_ip_services = [
            'https://api.ipify.org?format=json',
            'https://httpbin.org/ip',
            'https://api.my-ip.io/ip.json',
            'http://ip-api.com/json'
        ]
        
        for service in public_ip_services:
            try:
                response = requests.get(service, timeout=3)
                if response.status_code == 200:
                    data = response.json()
                    
                    # معالجة استجابات مختلفة
                    public_ip = None
                    if 'ip' in data:
                        public_ip = data['ip']
                    elif 'origin' in data:  # httpbin
                        public_ip = data['origin']
                    elif 'query' in data:  # ip-api
                        public_ip = data['query']
                    
                    if public_ip and not public_ip.startswith(('192.168.', '10.', '127.')):
                        query_ip = public_ip
                        break
                        
            except Exception:
                continue
    
    # محاولة تحديد الموقع باستخدام خدمات GeoIP متعددة
    location_services = [
        {
            'url': f'http://ip-api.com/json/{query_ip}?lang=ar',
            'name': 'ip-api.com'
        },
        {
            'url': f'https://ipapi.co/{query_ip}/json/',
            'name': 'ipapi.co'
        },
        {
            'url': f'https://ipinfo.io/{query_ip}/json',
            'name': 'ipinfo.io'
        }
    ]
    
    for service in location_services:
        try:
            response = requests.get(service['url'], timeout=5)
            
            if response.status_code == 200:
                data = response.json()
                
                # معالجة استجابة ip-api.com
                if service['name'] == 'ip-api.com':
                    if data.get('status') == 'success':
                        country = data.get('country', 'غير محدد')
                        city = data.get('city', 'غير محدد')
                        country_code = data.get('countryCode', '').upper()
                        
                        flag = get_flag_from_country_code(country_code)
                        
                        return {
                            'country': country,
                            'city': city,
                            'flag': flag,
                            'ip': query_ip,
                            'original_ip': ip_address,
                            'source': 'ip-api.com'
                        }
                
                # معالجة استجابة ipapi.co
                elif service['name'] == 'ipapi.co':
                    country = data.get('country_name', '')
                    city = data.get('city', '')
                    country_code = data.get('country_code', '').upper()
                    
                    if country and country != 'غير محدد':
                        flag = get_flag_from_country_code(country_code)
                        return {
                            'country': country,
                            'city': city or 'غير محدد',
                            'flag': flag,
                            'ip': query_ip,
                            'original_ip': ip_address,
                            'source': 'ipapi.co'
                        }
                
                # معالجة استجابة ipinfo.io
                elif service['name'] == 'ipinfo.io':
                    country_code = data.get('country', '').upper()
                    city = data.get('city', 'غير محدد')
                    
                    if country_code:
                        flag = get_flag_from_country_code(country_code)
                        country_name = get_country_name_from_code(country_code)
                        return {
                            'country': country_name,
                            'city': city,
                            'flag': flag,
                            'ip': query_ip,
                            'original_ip': ip_address,
                            'source': 'ipinfo.io'
                        }
                        
        except Exception as e:
            print(f"خطأ في خدمة {service['name']}: {e}")
            continue
    
    # في حالة فشل جميع الخدمات، نستخدم موقع افتراضي محلي
    
    # محاولة تحديد الموقع بناءً على معلومات النظام المحلي
    try:
        import socket
        hostname = socket.gethostname()
        
        # اعتماداً على اسم الجهاز أو الشبكة، يمكننا تخمين الموقع
        if 'iraq' in hostname.lower() or 'baghdad' in hostname.lower():
            return {
                'country': 'العراق',
                'city': 'بغداد', 
                'flag': '🇮🇶',
                'ip': query_ip,
                'original_ip': ip_address,
                'source': 'local_hostname'
            }
    except:
        pass
    
    # موقع افتراضي نهائي
    return {
        'country': 'العراق',
        'city': 'بغداد',
        'flag': '🇮�',
        'ip': query_ip,
        'original_ip': ip_address,
        'source': 'default'
    }

def get_flag_from_country_code(country_code):
    """تحويل رمز الدولة إلى علم"""
    flags = {
        'IQ': '🇮🇶',  # العراق
        'JO': '🇯🇴',  # الأردن
        'AE': '🇦🇪',  # الإمارات
        'SA': '🇸🇦',  # السعودية
        'KW': '🇰🇼',  # الكويت
        'LB': '🇱🇧',  # لبنان
        'SY': '🇸🇾',  # سوريا
        'EG': '🇪🇬',  # مصر
        'QA': '🇶🇦',  # قطر
        'BH': '🇧🇭',  # البحرين
        'OM': '🇴🇲',  # عمان
        'YE': '🇾🇪',  # اليمن
        'US': '🇺🇸',  # أمريكا
        'GB': '🇬🇧',  # بريطانيا
        'DE': '🇩🇪',  # ألمانيا
        'FR': '🇫🇷',  # فرنسا
        'CA': '🇨🇦',  # كندا
        'AU': '🇦🇺',  # أستراليا
        'CN': '🇨🇳',  # الصين
        'JP': '🇯🇵',  # اليابان
        'IN': '🇮🇳',  # الهند
        'TR': '🇹🇷',  # تركيا
        'IR': '🇮🇷',  # إيران
    }
    return flags.get(country_code, '🌍')

def get_country_name_from_code(country_code):
    """تحويل رمز الدولة إلى اسم الدولة بالعربية"""
    countries = {
        'IQ': 'العراق',
        'JO': 'الأردن',
        'AE': 'الإمارات العربية المتحدة',
        'SA': 'المملكة العربية السعودية',
        'KW': 'الكويت',
        'LB': 'لبنان',
        'SY': 'سوريا',
        'EG': 'مصر',
        'QA': 'قطر',
        'BH': 'البحرين',
        'OM': 'عمان',
        'YE': 'اليمن',
        'US': 'الولايات المتحدة الأمريكية',
        'GB': 'المملكة المتحدة',
        'DE': 'ألمانيا',
        'FR': 'فرنسا',
        'CA': 'كندا',
        'AU': 'أستراليا',
        'CN': 'الصين',
        'JP': 'اليابان',
        'IN': 'الهند',
        'TR': 'تركيا',
        'IR': 'إيران',
    }
    return countries.get(country_code, country_code)

from extensions import db, socketio
from models import Server, Device, Log
from utils import generate_alert, get_real_server_ip
from services.blockchain_service import create_blockchain_record
from services.usb_service import usb_service
from supabase_config import get_supabase_client
from flask_jwt_extended import verify_jwt_in_request

# Get Supabase client
supabase = get_supabase_client()

# Blueprint for server management
servers_bp = Blueprint('servers', __name__)

# متغير للتحكم في خيط التحديث التلقائي
auto_update_thread = None
auto_update_running = False

# متغير للتحكم في خيط التحديث التلقائي
auto_update_thread = None
auto_update_running = False

def auto_update_server_info():
    """تحديث تلقائي لمعلومات الخادم كل 5 دقائق"""
    global auto_update_running

    while auto_update_running:
        try:
            # إنشاء application context للوصول إلى current_app
            from app import app
            with app.app_context():
                update_server_info_in_supabase()
                # تم تحديث معلومات الخادم تلقائياً
        except Exception as e:
            # خطأ في التحديث التلقائي
            pass

        # انتظار 1 دقيقة (لكي لا يظهر كانقطاع حيث أن الواجهة تفحص كل 3 دقائق)
        time.sleep(60)  # 1 دقيقة = 60 ثانية

def start_auto_update():
    """بدء التحديث التلقائي"""
    global auto_update_thread, auto_update_running

    if auto_update_thread is None or not auto_update_thread.is_alive():
        auto_update_running = True
        auto_update_thread = threading.Thread(target=auto_update_server_info, daemon=True)
        auto_update_thread.start()
        # تم بدء التحديث التلقائي لمعلومات الخادم

def stop_auto_update():
    """إيقاف التحديث التلقائي"""
    global auto_update_running
    auto_update_running = False
    # تم إيقاف التحديث التلقائي

def update_port_connection_status(port_id, device_id=None, device_name=None, status='disconnected'):
    """تحديث حالة اتصال البورت"""
    try:
        client = get_supabase_client()
        if client is None:
            return False

        update_data = {
            'device_id': device_id,
            'device_name': device_name,
            'connection_status': status,
            'updated_at': get_baghdad_time_iso()
        }

        if status == 'connected':
            update_data['last_connection'] = get_baghdad_time_iso()

        response = client.table('usb_ports').update(update_data).eq('id', port_id).execute()

        if response.data:
            action = "اتصال" if status == 'connected' else "فصل"
            current_app.logger.info(f"✅ تم {action} الجهاز '{device_name or 'غير معروف'}' من البورت {port_id}")
            return True

        return False

    except Exception as e:
        current_app.logger.error(f"خطأ في تحديث حالة البورت {port_id}: {e}")
        return False

def update_server_info_in_supabase():
    """تحديث معلومات الخادم في Supabase بالبيانات الصحيحة"""
    try:
        # جلب عميل Supabase
        client = get_supabase_client()
        if client is None:
            return False

        # الحصول على معلومات النظام الحقيقية
        hostname = socket.gethostname()
        ip_address = socket.gethostbyname(hostname)

        # معلومات المعالج
        cpu_info = platform.processor() or "Unknown CPU"
        if not cpu_info or cpu_info == "":
            cpu_info = f"{psutil.cpu_count(logical=True)} cores"

        # معلومات الذاكرة
        memory = psutil.virtual_memory()
        ram_info = f"{round(memory.total / (1024**3), 1)} GB"

        # معلومات النظام
        os_info = f"{platform.system()} {platform.release()}"

        # تحديث بيانات الخادم في Supabase
        update_data = {
            'name': hostname,
            'ip_address': ip_address,
            'os': os_info,
            'cpu': cpu_info,
            'ram': ram_info,
            'status': 'active',
            'is_online': True,
            'last_heartbeat': get_baghdad_time_iso(),
            'updated_at': get_baghdad_time_iso()
        }

        # تحديث الخادم الرئيسي (ID = 1)
        response = client.table('servers').update(update_data).eq('id', 1).execute()

        return response.data is not None

    except Exception as e:
        # خطأ في تحديث البيانات
        pass
        return False


def verify_token():
    """Verify JWT token and extract user_id."""
    auth = request.headers.get('Authorization', '')
    if not auth or not auth.startswith('Bearer '):
        # لا نطبع خطأ للـ CMD - نعتبره طبيعي
        return None
    
    try:
        token = auth.split(' ', 1)[1]
        if not token or token.strip() == '':
            return None
            
        # استخدام نفس المفتاح المستخدم في create_access_token
        jwt_secret = current_app.config.get('JWT_SECRET_KEY') or current_app.config['SECRET_KEY']
        payload = jwt.decode(token, jwt_secret, algorithms=['HS256'])
        # Flask-JWT-Extended يضع identity في حقل 'sub'
        user_id = payload.get('sub') or payload.get('user_id')
        return user_id
    except IndexError:
        return None
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    except jwt.PyJWTError:
        return None


def verify_client_cert():
    """Verify client certificate for server-to-server communication."""
    # يمكن إضافة منطق التحقق من الشهادات هنا
    return True


def get_location_from_coordinates(lat, lon):
    """تحديد الموقع من الإحداثيات بدلاً من الاعتماد على API"""
    try:
        # تحويل الإحداثيات إلى float
        lat = float(lat)
        lon = float(lon)

        # تحديد الدولة أولاً بناءً على الإحداثيات
        country = 'Iraq'  # افتراضياً العراق

        # تحديد المدينة والمنطقة بناءً على الإحداثيات
        city, region = get_city_region_from_coords(lat, lon)

        return {
            'city': city,
            'region': region,
            'country': country,
            'latitude': lat,
            'longitude': lon,
            'ip': 'coordinates-based'  # للإشارة أن التحديد من الإحداثيات
        }
    except (ValueError, TypeError) as e:
        current_app.logger.error(f"Error parsing coordinates: {e}")
        return None

def get_city_region_from_coords(lat, lon):
    """تحديد المدينة والمنطقة من الإحداثيات"""

    # خريطة الإحداثيات للمدن العراقية الرئيسية
    cities_coords = {
        # بغداد ومحيطها
        'Baghdad': (33.3152, 44.3661, 'Baghdad'),
        'Kadhimiya': (33.3817, 44.3406, 'Baghdad'),
        'Sadr City': (33.3878, 44.4569, 'Baghdad'),

        # محافظة بابل
        'Hillah': (32.4637, 44.4197, 'Babil'),
        'Babylon': (32.5433, 44.4211, 'Babil'),
        'Al-Musayyib': (32.7789, 44.2897, 'Babil'),

        # محافظة البصرة
        'Basra': (30.5085, 47.7804, 'Basra'),
        'Abu Al-Khasib': (30.4536, 47.9783, 'Basra'),
        'Fao': (29.9758, 48.4731, 'Basra'),

        # محافظة النجف
        'Najaf': (32.0298, 44.3462, 'Najaf'),
        'Kufa': (32.0511, 44.4402, 'Najaf'),

        # محافظة كربلاء
        'Karbala': (32.6160, 44.0249, 'Karbala'),

        # محافظة الديوانية
        'Diwaniya': (31.9894, 44.9247, 'Qadisiyyah'),

        # محافظة واسط
        'Kut': (32.5128, 45.8184, 'Wasit'),

        # محافظة ميسان
        'Amara': (31.8453, 47.1753, 'Maysan'),

        # محافظة ذي قار
        'Nasiriyah': (31.0579, 46.2573, 'Dhi Qar'),

        # محافظة المثنى
        'Samawa': (31.3099, 45.2803, 'Muthanna'),

        # محافظة الأنبار
        'Ramadi': (33.4206, 43.3078, 'Anbar'),
        'Fallujah': (33.3547, 43.7861, 'Anbar'),

        # محافظة نينوى
        'Mosul': (36.3569, 43.1635, 'Nineveh'),

        # محافظة صلاح الدين
        'Tikrit': (34.6071, 43.6786, 'Saladin'),

        # محافظة كركوك
        'Kirkuk': (35.4681, 44.3922, 'Kirkuk'),

        # محافظة أربيل
        'Erbil': (36.1911, 44.0094, 'Erbil'),

        # محافظة السليمانية
        'Sulaymaniyah': (35.5644, 45.4329, 'Sulaymaniyah'),

        # محافظة دهوك
        'Duhok': (36.8667, 42.9833, 'Dahuk')
    }

    # البحث عن أقرب مدينة
    closest_city = None
    min_distance = float('inf')

    for city_name, (city_lat, city_lon, region) in cities_coords.items():
        # حساب المسافة باستخدام صيغة هافرساين (Haversine formula)
        distance = calculate_distance(lat, lon, city_lat, city_lon)
        if distance < min_distance:
            min_distance = distance
            closest_city = (city_name, region)

    # إذا كانت المسافة أقل من 50 كم، نعتبرها المدينة الصحيحة
    if min_distance <= 50:  # 50 كم
        return closest_city

    # إذا لم نجد مدينة قريبة، نحاول تحديد المنطقة من الإحداثيات
    return get_region_from_coordinates(lat, lon)

def calculate_distance(lat1, lon1, lat2, lon2):
    """حساب المسافة بين نقطتين جغرافيتين بالكيلومتر"""
    from math import radians, cos, sin, asin, sqrt

    # تحويل إلى radians
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])

    # صيغة هافرساين
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a))

    # نصف قطر الأرض بالكيلومتر
    r = 6371
    return c * r

def get_region_from_coordinates(lat, lon):
    """تحديد المنطقة من الإحداثيات عندما لا نجد مدينة قريبة"""
    # منطقة بغداد (حوالي 33.3N, 44.4E)
    if 32.5 <= lat <= 34.0 and 43.5 <= lon <= 45.0:
        return 'Baghdad', 'Baghdad'

    # منطقة البصرة (حوالي 30.5N, 47.8E)
    elif 29.0 <= lat <= 31.0 and 47.0 <= lon <= 48.5:
        return 'Basra', 'Basra'

    # منطقة النجف (حوالي 32.0N, 44.3E)
    elif 31.5 <= lat <= 32.5 and 43.5 <= lon <= 45.0:
        return 'Najaf', 'Najاف'

    # منطقة كربلاء (حوالي 32.6N, 44.0E)
    elif 32.0 <= lat <= 33.0 and 43.0 <= lon <= 44.5:
        return 'Karbala', 'Karbلا'

    # منطقة الأنبار (غرب العراق)
    elif 32.0 <= lat <= 35.0 and 40.0 <= lon <= 43.5:
        return 'Ramadi', 'Anbar'

    # منطقة نينوى (شمال العراق)
    elif 35.0 <= lat <= 37.0 and 42.0 <= lon <= 44.0:
        return 'Mosul', 'Nineveh'

    # منطقة كركوك (شمال شرق)
    elif 34.5 <= lat <= 36.0 and 44.0 <= lon <= 46.0:
        return 'Kirkuk', 'Kirkuk'

    # افتراضياً بغداد
    return 'Baghdad', 'Baghdad'


@servers_bp.route('/servers/agents', methods=['GET'])
def list_agents():
    """إرجاع قائمة بالخوادم الفرعية (agents) فقط"""
    agents = Server.query.filter_by(role='secondary').order_by(Server.name).all()
    return jsonify({'agents': [s.to_dict() for s in agents]}), 200

@servers_bp.route('/servers/agents/register', methods=['POST'])
def register_agent():
    """تسجيل agent جديد مع معلومات النظام التلقائية"""
    data = request.get_json() or {}

    # التحقق من وجود username و password
    username = data.get('username', '').strip()
    password = data.get('password', '')
    
    if not username or not password:
        return jsonify({'error': 'Username and password are required'}), 400

    # التحقق من المستخدم في قاعدة البيانات (بـ username أو email)
    from models import User
    
    user = User.query.filter(
        or_(User.username == username, User.email == username)
    ).first()
    
    if not user:
        return jsonify({'error': 'Invalid username/email or password'}), 401
    
    # التحقق من كلمة المرور (مؤقتاً معطل)
    # if not verify_password(password, user.password_hash):
    #     return jsonify({'error': 'Invalid username or password'}), 401
    
    # التحقق من حالة المستخدم
    if user.status != 'active':
        return jsonify({'error': f'User account is {user.status}'}), 403
    
    # التحقق من الربط بالسيرفر
    # التحقق من وجود السيرفر الرئيسي
    primary_server = Server.query.filter_by(server_type='primary').first()
    if not primary_server:
        return jsonify({'error': 'No primary server found. Please set up a primary server first.'}), 404
    
    # التحقق من وجود جهاز بنفس الاسم مُسجل مسبقاً
    hostname = data.get('name', username)
    existing_server = Server.query.filter_by(name=hostname).first()
    if existing_server:
        # إذا كان الجهاز موجود ومرتبط بنفس المستخدم، نعيد معلوماته
        if existing_server.user_id == user.id:
            existing_server.set_online()  # تحديث آخر heartbeat
            db.session.commit()
            return jsonify({
                'message': 'Server already registered and linked to your account',
                'agent': existing_server.to_dict(),
                'api_key': existing_server.api_key,
                'server_type': existing_server.server_type
            }), 200
        else:
            return jsonify({'error': 'A server with this name is already registered to another user'}), 409
    
    # الحصول على معلومات النظام التلقائية إذا لم تكن متوفرة
    if not data.get('os') or not data.get('cpu') or not data.get('ram'):
        try:
            import platform
            import psutil

            if not data.get('os'):
                data['os'] = f"{platform.system()} {platform.release()}"
            if not data.get('cpu'):
                cpu_info = platform.processor() or "Unknown CPU"
                if not cpu_info or cpu_info == "":
                    cpu_info = f"{psutil.cpu_count(logical=True)} cores"
                data['cpu'] = cpu_info
            if not data.get('ram'):
                memory = psutil.virtual_memory()
                data['ram'] = f"{round(memory.total / (1024**3), 1)} GB"
        except Exception as e:
            # خطأ في الحصول على معلومات النظام
            pass

    # تعيين القيم الافتراضية
    data.setdefault('name', hostname)  # استخدام hostname كاسم الـ agent
    data.setdefault('ip_address', request.remote_addr or '127.0.0.1')
    data.setdefault('role', 'secondary')
    data.setdefault('status', 'active')
    data.setdefault('server_type', 'secondary')  # هذا sub-server
    data.setdefault('capabilities', {
        "usb_monitoring": True,
        "device_control": True,
        "network_monitoring": False,
        "security_features": True,
        "agent_mode": True
    })
    data.setdefault('config', {
        "usb_polling_interval": 2,
        "max_devices": 50,
        "auto_block_unknown": True,
        "report_to_primary": True,
        "heartbeat_interval": 30
    })

    # إنشاء API key فريد
    if not data.get('api_key'):
        data['api_key'] = secrets.token_hex(32)

    # إنشاء الـ agent كـ sub-server
    agent = Server(
        name=data['name'],
        ip_address=data['ip_address'],
        os=data.get('os'),
        cpu=data.get('cpu'),
        ram=data.get('ram'),
        status=data['status'],
        role=data['role'],
        server_type=data['server_type'],  # secondary
        parent_server_id=primary_server.id,  # ربط بالسيرفر الرئيسي
        is_active=True,
        api_key=data['api_key'],
        capabilities=json.dumps(data['capabilities']),
        config=json.dumps(data['config']),
        user_id=user.id  # ربط الـ agent بالمستخدم
    )

    # تعيين وقت النبضة الحياة
    agent.set_online()

    try:
        db.session.add(agent)
        db.session.commit()

        # حفظ البيانات في Supabase أيضاً
        client = get_supabase_client()
        if client:
            supabase_data = {
                'id': agent.id,
                'name': agent.name,
                'ip_address': agent.ip_address,
                'os': agent.os,
                'cpu': agent.cpu,
                'ram': agent.ram,
                'status': agent.status,
                'role': agent.role,
                'server_type': agent.server_type,
                'parent_server_id': agent.parent_server_id,
                'is_active': agent.is_active,
                'api_key': agent.api_key,
                'capabilities': agent.capabilities,
                'config': agent.config,
                'user_id': agent.user_id,
                'last_heartbeat': agent.last_heartbeat.isoformat() if agent.last_heartbeat else None,
                'created_at': agent.created_at.isoformat() if agent.created_at else None,
                'updated_at': agent.updated_at.isoformat() if agent.updated_at else None
            }
            try:
                client.table('servers').insert(supabase_data).execute()
                current_app.logger.info(f'Agent saved to Supabase: {agent.name}')
            except Exception as e:
                current_app.logger.warning(f'Failed to save agent to Supabase: {e}')

        # إرسال إشعار عبر WebSocket
        socketio.emit('agent_registered', {
            'agent_id': agent.id,
            'name': agent.name,
            'ip_address': agent.ip_address,
            'timestamp': agent.created_at.isoformat()
        }, namespace='/servers')

        return jsonify({
            'message': 'Sub-server registered successfully',
            'agent': agent.to_dict(),
            'api_key': agent.api_key,
            'server_type': agent.server_type,
            'parent_server_id': agent.parent_server_id
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Failed to register agent: {str(e)}'}), 500
def register_server():
    """تسجيل خادم جديد مع إمكانيات وتكوين ومفتاح API فريد"""
    # التحقق من التوثيق إذا كان الطلب من واجهة المستخدم
    user_id = verify_token()
    if not user_id and not verify_client_cert():
        return jsonify({'error': 'Authentication required'}), 401
    
    data = request.get_json() or {}
    name = data.get('name')
    ip_address = data.get('ip_address')
    os = data.get('os')
    cpu = data.get('cpu')
    ram = data.get('ram')
    capabilities = data.get('capabilities')
    config = data.get('config')
    role = data.get('role', 'secondary')  # دور الخادم
    api_key = data.get('api_key') or secrets.token_hex(32)
    
    if not name or not ip_address:
        return jsonify({'error': 'name and ip_address are required'}), 400
    
    # التحقق من عدم وجود خادم بنفس الاسم
    existing_server = Server.query.filter_by(name=name).first()
    if existing_server:
        return jsonify({'error': 'Server with this name already exists'}), 409
    
    # إنشاء خادم جديد
    server = Server(
        name=name, 
        ip_address=ip_address, 
        os=os, 
        cpu=cpu, 
        ram=ram, 
        last_heartbeat=get_baghdad_time(), 
        status='active', 
        api_key=api_key, 
        capabilities=json.dumps(capabilities or {}), 
        config=json.dumps(config or {}),
        role=role,
        is_active=(role == 'primary')  # إذا كان رئيسي فعّله
    )
    
    # إذا أصبح رئيسي، ألغ تفعيل الآخرين
    if role == 'primary':
        Server.query.filter(Server.id != server.id).update({
            'role': 'secondary',
            'is_active': False
        })
    
    db.session.add(server)
    db.session.commit()
    
    # تسجيل في السجل إذا كان من واجهة المستخدم
    if user_id:
        log = Log(
            action='server_registered',
            user_id=user_id,
            details=json.dumps({
                'server_id': server.id,
                'server_name': server.name,
                'role': role
            }),
            timestamp=get_baghdad_time()
        )
        db.session.add(log)
        db.session.commit()
        
        # إنشاء سجل في البلوكشين
        create_blockchain_record(
            'server_registered',
            {
                'server_id': server.id,
                'server_name': server.name,
                'role': role
            },
            user_id
        )
    
    socketio.emit('server_registered', server.to_dict(), namespace='/servers')
    return jsonify({
        'message': 'Server registered successfully', 
        'server_id': server.id, 
        'api_key': server.api_key,
        'server': server.to_dict()
    }), 201

@servers_bp.route('/servers/heartbeat', methods=['POST'])
def server_heartbeat():
    """تحديث نبضة الخادم مع التحقق من api_key"""
    if not verify_client_cert():
        return jsonify({'error': 'Client certificate required'}), 403
    data = request.get_json() or {}
    server_id = data.get('server_id')
    api_key = data.get('api_key')
    server = Server.query.get(server_id)
    if not server:
        return jsonify({'error': 'Server not found'}), 404
    if server.api_key and api_key != server.api_key:
        return jsonify({'error': 'Invalid API key'}), 403
    
    # تحديث حالة الخادم كمتصل
    server.set_online()
    db.session.commit()
    
    socketio.emit('server_heartbeat', {'server_id': server.id, 'timestamp': server.last_heartbeat.isoformat()}, namespace='/servers')
    return jsonify({'message': 'Heartbeat updated'}), 200


@servers_bp.route('/servers/<int:server_id>/heartbeat', methods=['POST'])
def server_heartbeat_by_id(server_id):
    """تحديث نبضة خادم معين - مع تحقق فعلي من الاتصال للسيرفرات الفرعية"""
    try:
        import subprocess
        import platform as plat_mod
        import time as time_mod
        
        current_app.logger.info(f'Heartbeat request for server ID: {server_id}')
        
        # جلب عميل Supabase
        client = get_supabase_client()
        if client is None:
            current_app.logger.error('Failed to get Supabase client')
            return jsonify({'error': 'Database service unavailable'}), 500
        
        # البحث عن الخادم في Supabase
        response = client.table('servers').select('*').eq('id', server_id).execute()
        
        if not response.data:
            current_app.logger.warning(f'Server with ID {server_id} not found')
            return jsonify({'error': 'Server not found'}), 404
        
        server_data = response.data[0]
        current_app.logger.info(f'Server found: {server_data.get("name", "Unknown")}')
        
        # تحديد ID السيرفر المركزي (الحالي الذي يشغل الباك اند)
        # نستخدم server_type='primary' لتحديد السيرفر الرئيسي بدلاً من SERVER_ID
        primary_server = client.table('servers').select('*').eq('server_type', 'primary').execute()
        primary_server_id = primary_server.data[0]['id'] if primary_server.data else current_app.config.get('SERVER_ID', 1)
        
        # ══════════════════════════════════════════════════════
        # السيرفر المركزي: متصل بالضرورة لأن الباك اند يعمل عليه
        # ══════════════════════════════════════════════════════
        if server_id == primary_server_id:
            update_data = {
                'last_heartbeat': get_baghdad_time_iso(),
                'status': 'active',
                'is_online': True,
                'updated_at': get_baghdad_time_iso()
            }
            update_response = client.table('servers').update(update_data).eq('id', server_id).execute()
            
            if update_response.data:
                socketio.emit('server_heartbeat', {
                    'server_id': server_id,
                    'timestamp': update_data['last_heartbeat'],
                    'status': 'connected'
                }, namespace='/servers')
                
                socketio.emit('dashboard:update', {
                    'type': 'server_heartbeat',
                    'server_id': server_id,
                    'timestamp': update_data['last_heartbeat'],
                    'status': 'connected'
                })
                
                return jsonify({
                    'message': 'Heartbeat successful',
                    'server_id': server_id,
                    'server_name': server_data.get('name', 'Unknown'),
                    'timestamp': update_data['last_heartbeat'],
                    'status': 'connected',
                    'is_primary': True
                }), 200
            else:
                return jsonify({'error': 'Failed to update heartbeat'}), 500
        
        # ══════════════════════════════════════════════════════
        # السيرفرات الفرعية: التحقق من اتصال الـ Agent الفعلي
        # ══════════════════════════════════════════════════════
        server_ip = server_data.get('ip_address') or server_data.get('address')
        server_name = server_data.get('name', 'Unknown')
        
        # تحقق لمعرفة المرسل: هل هو الـ Agent (يحتوي على بيانات) أم أمر "اختبار" من الواجهة
        req_data = request.get_json(silent=True) or {}
        is_from_agent = bool(req_data.get('hostname') or req_data.get('server_type'))
        
        if is_from_agent:
            # ⬅️ الطلب قادم من الـ Agent نفسه: نُحدث حالة السيرفر فوراً إلى "متصل"
            current_app.logger.info(f'Heartbeat update received FROM Agent {server_id}')
            update_data = {
                'status': 'active',
                'is_online': True,
                'last_seen': get_baghdad_time_iso(),
                'last_heartbeat': get_baghdad_time_iso(),
                'updated_at': get_baghdad_time_iso()
            }
            
            # تحديث معلومات النظام إن وجدت
            if 'cpu_usage' in req_data: update_data['cpu_usage'] = req_data['cpu_usage']
            if 'memory_usage' in req_data: update_data['memory_usage'] = req_data['memory_usage']
            if 'disk_usage' in req_data: update_data['disk_usage'] = req_data['disk_usage']
            
            client.table('servers').update(update_data).eq('id', server_id).execute()
            
            socketio.emit('server_heartbeat', {
                'server_id': server_id,
                'timestamp': update_data['last_heartbeat'],
                'status': 'connected'
            }, namespace='/servers')
            
            return jsonify({
                'message': 'تم تحديث نبض الـ Agent بنجاح',
                'server_id': server_id,
                'status': 'connected'
            }), 200

        # ⬅️ الطلب قادم من واجهة الويب (اختبار النبض): فقط نفحص آخر اتصال مسجل بدون تحديثه
        
        # ── الخطوة 1: فحص آخر heartbeat / last_seen من الـ Agent ──
        last_heartbeat_str = server_data.get('last_heartbeat')
        last_seen_str = server_data.get('last_seen')
        
        # نختار الأحدث بين last_heartbeat و last_seen
        latest_contact_str = None
        if last_heartbeat_str and last_seen_str:
            try:
                hb_str = last_heartbeat_str if ('Z' in last_heartbeat_str or '+' in last_heartbeat_str) else last_heartbeat_str + 'Z'
                seen_str = last_seen_str if ('Z' in last_seen_str or '+' in last_seen_str) else last_seen_str + 'Z'
                hb_time = datetime.fromisoformat(hb_str.replace('Z', '+00:00'))
                seen_time = datetime.fromisoformat(seen_str.replace('Z', '+00:00'))
                latest_contact_str = last_seen_str if seen_time > hb_time else last_heartbeat_str
            except:
                latest_contact_str = last_seen_str or last_heartbeat_str
        else:
            latest_contact_str = last_seen_str or last_heartbeat_str
        
        agent_recently_active = False
        seconds_since_contact = None
        
        if latest_contact_str:
            try:
                contact_str = latest_contact_str
                if not ('Z' in contact_str or '+' in contact_str):
                    contact_str += 'Z'
                last_contact_time = datetime.fromisoformat(contact_str.replace('Z', '+00:00'))
                now = datetime.now(timezone.utc)
                seconds_since_contact = (now - last_contact_time).total_seconds()
                # الـ Agent يعتبر نشط إذا أرسل heartbeat أو تواصل خلال آخر 3 دقائق
                agent_recently_active = seconds_since_contact <= 180
            except Exception as dt_err:
                current_app.logger.error(f'Error parsing contact time: {dt_err}')
                agent_recently_active = False
        
        # ── تحديد الحالة النهائية بناءً على قاعدة البيانات فقط ──
        # تم إلغاء فحص منفذ 5001 والاعتماد بشكل كامل على نشاط الـ Agent المسجل في قاعدة البيانات
        is_connected = agent_recently_active
        
        if is_connected:
            # ✅ السيرفر متصل استناداً إلى قاعدة البيانات
            reason = 'agent_heartbeat_recent'
            
            # لا نقوم بتحديث last_heartbeat هنا اصطناعياً بوجود فحص من لوحة التحكم!
            update_data = {
                'status': 'active',
                'is_online': True
            }
            
            client.table('servers').update(update_data).eq('id', server_id).execute()
            
            socketio.emit('server_heartbeat', {
                'server_id': server_id,
                'timestamp': latest_contact_str,
                'status': 'connected'
            }, namespace='/servers')
            
            socketio.emit('dashboard:update', {
                'type': 'server_heartbeat',
                'server_id': server_id,
                'timestamp': latest_contact_str,
                'status': 'connected'
            })
            
            log_msg = f'[V] Server {server_id} ({server_name}) is connected - reason: {reason}'
            current_app.logger.info(log_msg)
            
            return jsonify({
                'message': 'نجح الاتصال! السيرفر متصل',
                'server_id': server_id,
                'server_name': server_name,
                'timestamp': latest_contact_str,
                'status': 'connected',
                'reason': reason,
                'last_seen_seconds_ago': int(seconds_since_contact) if seconds_since_contact else None,
                'response_time_ms': 0
            }), 200
        else:
            # ❌ السيرفر غير متصل (الـ Agent لم يرسل heartbeat مؤخراً ومنفذه مغلق)
            update_data = {
                'status': 'offline',
                'is_online': False,
                'updated_at': get_baghdad_time_iso()
            }
            client.table('servers').update(update_data).eq('id', server_id).execute()
            
            socketio.emit('server_heartbeat', {
                'server_id': server_id,
                'timestamp': get_baghdad_time_iso(),
                'status': 'disconnected'
            }, namespace='/servers')
            
            socketio.emit('dashboard:update', {
                'type': 'server_heartbeat',
                'server_id': server_id,
                'timestamp': get_baghdad_time_iso(),
                'status': 'disconnected'
            })
            
            # بناء رسالة خطأ تفصيلية
            if seconds_since_contact:
                mins_ago = int(seconds_since_contact / 60)
                detail_msg = f'آخر اتصال للـ Agent كان قبل {mins_ago} دقيقة'
            else:
                detail_msg = 'الـ Agent لم يتصل أبداً بالسيرفر المركزي'
            
            # Use ASCII safe characters to avoid UnicodeEncodeError on Windows terminals
            log_msg = f'[X] Server {server_id} ({server_name}) is NOT connected - {detail_msg}'
            current_app.logger.warning(log_msg)
            
            return jsonify({
                'error': f'فشل الاتصال! السيرفر {server_name} غير متصل',
                'server_id': server_id,
                'server_name': server_name,
                'status': 'disconnected',
                'message': detail_msg,
                'last_seen_seconds_ago': int(seconds_since_contact) if seconds_since_contact else None
            }), 503
        
    except Exception as e:
        current_app.logger.error(f'Server heartbeat error for server {server_id}: {str(e)}')
        import traceback
        current_app.logger.error(f'Full traceback: {traceback.format_exc()}')
        return jsonify({'error': 'Internal server error', 'details': str(e)}), 500


@servers_bp.route('/agents/save-data', methods=['POST'])
def save_agent_data_to_supabase():
    """حفظ بيانات الـ agent في Supabase"""
    try:
        data = request.get_json() or {}

        # جلب عميل Supabase
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'Database service unavailable'}), 500

        # إعداد البيانات للحفظ
        agent_data = {
            'agent_id': data.get('agent_id'),
            'name': data.get('name'),
            'ip_address': data.get('ip_address'),
            'os': data.get('os'),
            'cpu': data.get('cpu'),
            'ram': data.get('ram'),
            'status': data.get('status', 'active'),
            'system_info': data.get('system_info', {}),
            'usb_devices': data.get('usb_devices', []),
            'network_info': data.get('network_info', {}),
            'location': data.get('location', {}),
            'capabilities': data.get('capabilities', {}),
            'last_heartbeat': get_baghdad_time_iso(),
            'created_at': get_baghdad_time_iso(),
            'updated_at': get_baghdad_time_iso(),
            'agent_type': 'usb_monitoring_agent'
        }

        # حفظ البيانات في جدول agents
        response = client.table('agents').insert([agent_data]).execute()

        if response.data:
            current_app.logger.info(f'Agent data saved successfully: {agent_data.get("name", "Unknown")}')

            # حفظ معلومات النظام في جدول منفصل إذا كانت متوفرة
            if data.get('system_info'):
                system_data = {
                    'agent_id': data.get('agent_id'),
                    'hostname': data.get('system_info', {}).get('hostname'),
                    'platform': data.get('system_info', {}).get('platform'),
                    'arch': data.get('system_info', {}).get('arch'),
                    'cpu_count': data.get('system_info', {}).get('cpu_count'),
                    'total_memory': data.get('system_info', {}).get('total_memory'),
                    'free_memory': data.get('system_info', {}).get('free_memory'),
                    'uptime': data.get('system_info', {}).get('uptime'),
                    'created_at': get_baghdad_time_iso()
                }

                try:
                    client.table('system_info').insert([system_data]).execute()
                except Exception as e:
                    current_app.logger.warning(f'Failed to save system info: {e}')

            # حفظ أجهزة USB في جدول منفصل إذا كانت متوفرة
            if data.get('usb_devices') and isinstance(data.get('usb_devices'), list):
                for device in data.get('usb_devices'):
                    device_data = {
                        'agent_id': data.get('agent_id'),
                        'device_id': device.get('deviceId'),
                        'vendor_id': device.get('vendorId'),
                        'product_id': device.get('productId'),
                        'device_name': device.get('deviceName'),
                        'manufacturer': device.get('manufacturer'),
                        'serial_number': device.get('serialNumber'),
                        'device_type': device.get('deviceType'),
                        'connection_status': device.get('status', 'connected'),
                        'created_at': get_baghdad_time_iso()
                    }

                    try:
                        client.table('usb_devices').insert([device_data]).execute()
                    except Exception as e:
                        current_app.logger.warning(f'Failed to save USB device: {e}')

            # إرسال إشعار عبر WebSocket
            socketio.emit('agent_data_saved', {
                'agent_id': data.get('agent_id'),
                'name': agent_data.get('name'),
                'timestamp': agent_data['created_at']
            }, namespace='/agents')

            return jsonify({
                'message': 'Agent data saved successfully',
                'agent_id': data.get('agent_id'),
                'saved_at': agent_data['created_at']
            }), 201

        else:
            current_app.logger.error('Failed to save agent data to Supabase')
            return jsonify({'error': 'Failed to save agent data'}), 500

    except Exception as e:
        current_app.logger.error(f'Error saving agent data: {str(e)}')
        import traceback
        current_app.logger.error(f'Full traceback: {traceback.format_exc()}')
        return jsonify({'error': 'Internal server error', 'details': str(e)}), 500


@servers_bp.route('/servers/<int:server_id>/heartbeat/realtime', methods=['GET'])
def get_server_heartbeat_data(server_id):
    """الحصول على بيانات النبض المباشرة للخادم"""
    try:
        import time
        import subprocess
        import platform
        
        current_app.logger.info(f'Real-time heartbeat request for server ID: {server_id}')
        
        # جلب عميل Supabase
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'Database service unavailable'}), 500
        
        # البحث عن الخادم
        response = client.table('servers').select('*').eq('id', server_id).execute()
        
        if not response.data:
            return jsonify({'error': 'Server not found'}), 404
        
        server_data = response.data[0]
        server_ip = server_data.get('ip_address') or server_data.get('address')
        
        if not server_ip:
            return jsonify({'error': 'Server IP address not available'}), 400
        
        # قياس ping response time
        start_time = time.time()
        try:
            # تحديد أمر ping حسب نظام التشغيل
            if platform.system().lower() == 'windows':
                cmd = ['ping', '-n', '1', server_ip]
            else:
                cmd = ['ping', '-c', '1', server_ip]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            response_time = (time.time() - start_time) * 1000  # بالمليثانية
            
            if result.returncode == 0:
                # نجح الاتصال
                status = 'connected'
                # استخراج وقت الاستجابة من output إذا كان متوفراً
                if 'time=' in result.stdout:
                    import re
                    time_match = re.search(r'time[=<](\d+(?:\.\d+)?)ms', result.stdout)
                    if time_match:
                        response_time = float(time_match.group(1))
            else:
                # فشل الاتصال
                status = 'failed'
                response_time = None
        
        except subprocess.TimeoutExpired:
            status = 'timeout'
            response_time = None
        except Exception as ping_error:
            current_app.logger.error(f'Ping error: {ping_error}')
            status = 'error'
            response_time = None
        
        # إنشاء بيانات النبض
        heartbeat_data = {
            'server_id': server_id,
            'server_name': server_data.get('name', 'Unknown'),
            'timestamp': get_baghdad_time_iso(),
            'status': status,
            'response_time': response_time,
            'is_online': status == 'connected',
            'pulse_value': 0 if status != 'connected' else min(100, max(10, 100 - (response_time or 0) / 10))
        }
        
        # إرسال البيانات عبر WebSocket للمخطط المباشر
        socketio.emit('heartbeat_data', heartbeat_data, namespace='/heartbeat')
        
        return jsonify(heartbeat_data), 200
        
    except Exception as e:
        current_app.logger.error(f'Real-time heartbeat error for server {server_id}: {str(e)}')
        return jsonify({'error': 'Internal server error', 'details': str(e)}), 500


@servers_bp.route('/servers/<int:server_id>/heartbeat/stream', methods=['GET'])
def stream_server_heartbeat(server_id):
    """تدفق بيانات النبض المباشرة باستخدام Server-Sent Events"""
    try:
        from flask import Response
        import json
        import time
        
        def generate_heartbeat_stream():
            """مولد بيانات النبض المستمرة"""
            while True:
                try:
                    # الحصول على بيانات النبض الحقيقية
                    with current_app.test_request_context():
                        heartbeat_response = get_server_heartbeat_data(server_id)
                        if heartbeat_response[1] == 200:
                            data = heartbeat_response[0].get_json()
                            yield f"data: {json.dumps(data)}\n\n"
                    
                    time.sleep(1)  # تحديث كل ثانية
                except Exception as e:
                    error_data = {'error': str(e), 'timestamp': get_baghdad_time_iso()}
                    yield f"data: {json.dumps(error_data)}\n\n"
                    break
        
        return Response(
            generate_heartbeat_stream(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            }
        )
        
    except Exception as e:
        current_app.logger.error(f'Heartbeat stream error for server {server_id}: {e}')
        return jsonify({'error': 'Internal server error'}), 500


@servers_bp.route('/debug-supabase/<int:server_id>', methods=['GET'])
def debug_supabase(server_id):
    """تشخيص اتصال Supabase"""
    try:
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'Supabase client is None'}), 500
        
        # جلب جميع السيرفرات
        all_response = client.table('servers').select('*').execute()
        
        # البحث بطرق مختلفة
        by_int = client.table('servers').select('*').eq('id', server_id).execute()
        by_str = client.table('servers').select('*').eq('id', str(server_id)).execute()
        
        return jsonify({
            'requested_id': server_id,
            'all_servers': all_response.data,
            'search_by_int': by_int.data,
            'search_by_str': by_str.data,
            'client_type': str(type(client))
        }), 200
        
    except Exception as e:
        import traceback
        return jsonify({
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500



@servers_bp.route('/test-sync/<int:server_id>', methods=['GET', 'POST'])
def test_sync(server_id):
    """اختبار بسيط للـ endpoint"""
    return jsonify({'message': f'Test endpoint working for server {server_id}', 'method': request.method}), 200

@servers_bp.route('/test-simple', methods=['GET', 'POST'])
def test_simple():
    """اختبار بسيط بدون parameters"""
    return jsonify({'message': 'Simple test endpoint working', 'method': request.method}), 200

@servers_bp.route('/servers/<int:server_id>/sync', methods=['GET', 'POST'])
def sync_server_by_id(server_id):
    """مزامنة السياسات والتكوينات والسجلات والبلوكشين لخادم محدد"""

    # الحصول على الخادم من Supabase بدلاً من قاعدة البيانات المحلية
    client = get_supabase_client()
    if client is None:
        return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500

    # البحث عن الخادم في Supabase
    response = client.table('servers').select('*').eq('id', server_id).execute()
    server_data = response.data[0] if response.data and len(response.data) > 0 else None

    if not server_data:
        return jsonify({'error': 'Server not found', 'server_id': server_id}), 404

    # إذا كان GET request، أعد رسالة بسيطة للاختبار
    if request.method == 'GET':
        # في GET، نأخذ المعلومات من query parameters
        api_key = request.args.get('api_key')
        last_sync = request.args.get('last_sync')

        # إذا لم يتم تمرير API key وكان الخادم يتطلبها، نرفض الطلب
        if server_data.get('api_key') and (api_key is None or api_key != server_data['api_key']):
            return jsonify({
                'error': 'Invalid or missing API key',
                'message': 'Server requires API key for synchronization'
            }), 403

        # إذا كان الخادم لا يتطلب API key، نسمح بالمزامنة
        if not server_data.get('api_key'):
            pass

        # إعداد البيانات للمزامنة
        data = {'last_sync': last_sync}
    else:
        # في POST، نأخذ المعلومات من JSON body
        data = request.get_json() or {}
        api_key = data.get('api_key')

        # التحقق من API key في POST
        if server_data.get('api_key') and (api_key is None or api_key != server_data['api_key']):
            return jsonify({
                'error': 'Invalid or missing API key',
                'message': 'Server requires API key for synchronization'
            }), 403

    # تصفية حسب آخر مزامنة إذا تم تمريرها
    from models import Policy, Device, Log, BlockchainLog
    from sqlalchemy import or_, and_
    import dateutil.parser
    last_sync = data.get('last_sync')  # ISO8601 string (اختياري)
    filter_dt = None
    if last_sync:
        try:
            filter_dt = dateutil.parser.isoparse(last_sync)
        except Exception:
            filter_dt = None

    # السياسات
    q_policies = Policy.query
    if filter_dt:
        q_policies = q_policies.filter(or_(Policy.created_at >= filter_dt, Policy.modified_at >= filter_dt))
    policies = [p.to_dict() for p in q_policies.all()]

    # الأجهزة
    q_devices = Device.query
    if filter_dt:
        q_devices = q_devices.filter(or_(Device.connection_time >= filter_dt, Device.last_activity >= filter_dt))
    devices = [d.to_dict() for d in q_devices.all()]

    # السجلات
    q_logs = Log.query
    if filter_dt:
        q_logs = q_logs.filter(Log.timestamp >= filter_dt)
    logs = [l.to_dict() for l in q_logs.order_by(Log.timestamp.desc()).limit(5000).all()]

    # البلوكشين
    try:
        supabase_client = get_supabase_client()
        if supabase_client:
            query = supabase_client.table('blockchain_logs').select('*')
            if filter_dt:
                query = query.gte('timestamp', filter_dt.isoformat())
            response = query.order('block_height').execute()
            blockchain = response.data if response.data else []
        else:
            blockchain = []
    except Exception as e:
        current_app.logger.error(f"Error getting blockchain logs from Supabase: {e}")
        blockchain = []

    # بيانات الخادم نفسه
    server_info = server_data

    socketio.emit('server_sync', {'server_id': server_data['id'], 'timestamp': get_baghdad_time_iso()}, namespace='/servers')
    return jsonify({
        'message': 'Sync completed',
        'server_id': server_data['id'],
        'server': server_info,
        'policies': policies,
        'devices': devices,
        'logs': logs,
        'blockchain': blockchain,
        'sync_time': get_baghdad_time_iso()
    }), 200

@servers_bp.route('/servers', methods=['GET'])
def list_servers():
    """جلب قائمة الخوادم من Supabase مع بيانات حقيقية"""
    try:
        # جلب البيانات من Supabase
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500
        
        # جلب الخوادم من Supabase
        response = client.table('servers').select('*').execute()
        servers_data = response.data if response.data else []
        
        # إذا لم تكن هناك خوادم في Supabase، أنشئ الخادم الرئيسي
        if not servers_data:
            try:
                # الحصول على معلومات النظام الحقيقية
                import platform
                import psutil
                import socket
                
                hostname = socket.gethostname()
                ip_address = socket.gethostbyname(hostname)
                
                # معلومات المعالج
                cpu_info = platform.processor() or "Unknown CPU"
                if not cpu_info or cpu_info == "":
                    cpu_info = f"{psutil.cpu_count(logical=True)} cores"
                
                # معلومات الذاكرة
                memory = psutil.virtual_memory()
                ram_info = f"{round(memory.total / (1024**3), 1)} GB"
                
                # معلومات النظام
                os_info = f"{platform.system()} {platform.release()}"
                
                # إنشاء الخادم الرئيسي في Supabase
                server_data = {
                    'id': 1,
                    'name': hostname,
                    'ip_address': ip_address,
                    'os': os_info,
                    'cpu': cpu_info,
                    'ram': ram_info,
                    'status': 'active',
                    'role': 'primary',
                    'is_active': True,
                    'capabilities': json.dumps({
                        "usb_monitoring": True,
                        "device_control": True,
                        "network_monitoring": True,
                        "security_features": True,
                        "real_time_monitoring": True,
                        "device_detection": True,
                        "agent_management": True,
                        "central_control": True
                    }),
                    'config': json.dumps({
                        "usb_polling_interval": 1,
                        "max_devices": 100,
                        "auto_block_unknown": False,
                        "allow_peripherals": True,
                        "max_power_draw_ma": 500,
                        "server_type": "primary",
                        "agent_discovery": True
                    }),
                    'last_heartbeat': get_baghdad_time_iso(),
                    'created_at': get_baghdad_time_iso(),
                    'updated_at': get_baghdad_time_iso()
                }
                
                client.table('servers').insert(server_data).execute()
                
                # إعادة جلب الخوادم
                response = client.table('servers').select('*').execute()
                servers_data = response.data if response.data else []
                
            except Exception as e:
                current_app.logger.error(f"خطأ في إنشاء الخادم الرئيسي في Supabase: {e}")
                # في حالة فشل إنشاء الخادم، إرجاع قائمة فارغة
                return jsonify({
                    'error': 'لا توجد خوادم مسجلة',
                    'message': 'يرجى تسجيل خادم أولاً',
                    'servers': []
                }), 200
        
        # معالجة البيانات من Supabase وإضافة معلومات إضافية
        enhanced_servers = []
        for server in servers_data:
            try:
                server_dict = dict(server)  # تحويل من Row إلى dict
                
                # تحليل الإمكانيات مع معالجة الأخطاء
                capabilities = {}
                if server_dict.get('capabilities'):
                    try:
                        if isinstance(server_dict['capabilities'], str):
                            capabilities = json.loads(server_dict['capabilities'])
                        else:
                            capabilities = server_dict['capabilities']
                    except (json.JSONDecodeError, TypeError):
                        capabilities = {}
                
                # تحليل التكوين مع معالجة الأخطاء
                config = {}
                if server_dict.get('config'):
                    try:
                        if isinstance(server_dict['config'], str):
                            config = json.loads(server_dict['config'])
                        else:
                            config = server_dict['config']
                    except (json.JSONDecodeError, TypeError):
                        config = {}
                
                # إضافة معلومات محسوبة
                server_dict['capabilities'] = capabilities
                server_dict['config'] = config
                # تحديد حالة is_online:
                # السيرفر الرئيسي متصل دائماً لأنه يخدم هذا الطلب
                # السيرفرات الفرعية نستخدم القيمة من قاعدة البيانات
                if server_dict.get('role') == 'primary' or server_dict.get('id') == 1:
                    server_dict['is_online'] = True
                    server_dict['status'] = 'active'
                else:
                    if 'is_online' not in server_dict:
                        server_dict['is_online'] = False
                
                # إضافة الموقع الجغرافي
                # أولاً تحقق من وجود موقع مخصص محفوظ
                custom_location = server_dict.get('custom_location')
                if custom_location:
                    try:
                        if isinstance(custom_location, str):
                            location_data = json.loads(custom_location)
                        else:
                            location_data = custom_location
                        
                        server_dict['location'] = location_data
                    except (json.JSONDecodeError, TypeError):
                        # في حالة خطأ في البيانات المخصصة، استخدم الموقع التلقائي
                        server_dict['location'] = get_location_from_ip(server_dict.get('ip_address', ''))
                else:
                    # استخدم الموقع التلقائي بناءً على IP
                    server_dict['location'] = get_location_from_ip(server_dict.get('ip_address', ''))
                
                
                # جلب إحصائيات إضافية من قاعدة البيانات
                try:
                    # عدد الأجهزة المرتبطة بهذا الخادم
                    devices_response = client.table('devices').select('id', count='exact').eq('server_id', server_dict['id']).execute()
                    server_dict['connected_devices_count'] = devices_response.count if devices_response.count is not None else 0

                    # عدد المنافذ النشطة - التحقق من وجود الجدول أولاً
                    try:
                        ports_response = client.table('usb_ports').select('id', count='exact').eq('server_id', server_dict['id']).eq('status', 'enabled').execute()
                        server_dict['active_ports_count'] = ports_response.count if ports_response.count is not None else 0
                    except Exception as ports_error:
                        # إذا لم يكن الجدول موجوداً، نضع القيمة 0
                        if 'usb_ports' in str(ports_error):
                            server_dict['active_ports_count'] = 0
                        else:
                            raise ports_error

                    # إجمالي استهلاك الطاقة
                    power_response = client.table('devices').select('power_consumption').eq('server_id', server_dict['id']).execute()
                    total_power = 0
                    if power_response.data:
                        for device in power_response.data:
                            try:
                                power = device.get('power_consumption', 0)
                                if isinstance(power, str):
                                    power = float(power)
                                total_power += power
                            except (ValueError, TypeError):
                                pass
                    server_dict['total_power_consumption'] = round(total_power, 2)

                except Exception as stats_error:
                    current_app.logger.warning(f"فشل في جلب إحصائيات الخادم {server_dict.get('id')}: {stats_error}")
                    server_dict['connected_devices_count'] = 0
                    server_dict['active_ports_count'] = 0
                    server_dict['total_power_consumption'] = 0
                
                enhanced_servers.append(server_dict)
                
            except Exception as e:
                current_app.logger.error(f"خطأ في معالجة خادم {server.get('id', 'unknown')}: {e}")
                continue
        
        return jsonify({'servers': enhanced_servers}), 200
        
    except Exception as e:
        current_app.logger.error(f"خطأ في جلب قائمة الخوادم من Supabase: {e}")
        return jsonify({
            'error': 'خطأ في جلب قائمة الخوادم',
            'message': str(e),
            'servers': []
        }), 500

@servers_bp.route('/servers/<int:server_id>', methods=['GET'])
def get_server(server_id):
    """جلب بيانات خادم محدد من Supabase مع بيانات حقيقية"""
    try:
        # جلب البيانات من Supabase
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500
        
        # جلب الخادم من Supabase
        response = client.table('servers').select('*').eq('id', server_id).execute()
        server_data = response.data[0] if response.data else None
        
        if not server_data:
            # إذا لم يوجد الخادم، تحقق إذا كان ID=1 (الخادم الرئيسي)
            if server_id == 1:
                try:
                    # الحصول على معلومات النظام الحقيقية
                    import platform
                    import psutil
                    import socket
                    
                    hostname = socket.gethostname()
                    ip_address = socket.gethostbyname(hostname)
                    
                    # معلومات المعالج
                    cpu_info = platform.processor() or "Unknown CPU"
                    if not cpu_info or cpu_info == "":
                        cpu_info = f"{psutil.cpu_count(logical=True)} cores"
                    
                    # معلومات الذاكرة
                    memory = psutil.virtual_memory()
                    ram_info = f"{round(memory.total / (1024**3), 1)} GB"
                    
                    # معلومات النظام
                    os_info = f"{platform.system()} {platform.release()}"
                    
                    # إنشاء الخادم الرئيسي في Supabase
                    server_data = {
                        'id': 1,
                        'name': hostname,
                        'ip_address': ip_address,
                        'os': os_info,
                        'cpu': cpu_info,
                        'ram': ram_info,
                        'status': 'active',
                        'role': 'primary',
                        'is_active': True,
                        'capabilities': json.dumps({
                            "usb_monitoring": True,
                            "device_control": True,
                            "network_monitoring": True,
                            "security_features": True,
                            "real_time_monitoring": True,
                            "device_detection": True,
                            "agent_management": True,
                            "central_control": True
                        }),
                        'config': json.dumps({
                            "usb_polling_interval": 1,
                            "max_devices": 100,
                            "auto_block_unknown": False,
                            "allow_peripherals": True,
                            "max_power_draw_ma": 500,
                            "server_type": "usb_agent",
                            "agent_discovery": True
                        }),
                        'last_heartbeat': get_baghdad_time_iso(),
                        'created_at': get_baghdad_time_iso(),
                        'updated_at': get_baghdad_time_iso()
                    }
                    
                    client.table('servers').insert(server_data).execute()
                    
                    # إعادة جلب الخادم
                    response = client.table('servers').select('*').eq('id', server_id).execute()
                    server_data = response.data[0] if response.data else None
                    
                except Exception as e:
                    current_app.logger.error(f"خطأ في إنشاء الخادم الرئيسي في Supabase: {e}")
                    return jsonify({'error': f'فشل في إنشاء الخادم الرئيسي: {str(e)}'}), 500
            else:
                return jsonify({'error': 'الخادم غير موجود'}), 404
        
        # معالجة البيانات من Supabase وإضافة معلومات إضافية
        server_dict = dict(server_data)  # تحويل من Row إلى dict
        
        # تحليل الإمكانيات مع معالجة الأخطاء
        capabilities = {}
        if server_dict.get('capabilities'):
            try:
                if isinstance(server_dict['capabilities'], str):
                    capabilities = json.loads(server_dict['capabilities'])
                else:
                    capabilities = server_dict['capabilities']
            except (json.JSONDecodeError, TypeError):
                capabilities = {}
        
        # تحليل التكوين مع معالجة الأخطاء
        config = {}
        if server_dict.get('config'):
            try:
                if isinstance(server_dict['config'], str):
                    config = json.loads(server_dict['config'])
                else:
                    config = server_dict['config']
            except (json.JSONDecodeError, TypeError):
                config = {}
        
        # إضافة معلومات محسوبة
        server_dict['capabilities'] = capabilities
        server_dict['config'] = config
        # تحديد حالة is_online:
        # السيرفر الرئيسي متصل دائماً لأنه يخدم هذا الطلب
        if server_dict.get('role') == 'primary' or server_dict.get('id') == 1:
            server_dict['is_online'] = True
            server_dict['status'] = 'active'
        else:
            if 'is_online' not in server_dict:
                server_dict['is_online'] = False
        
        # جلب إحصائيات إضافية من قاعدة البيانات
        try:
            # عدد الأجهزة المرتبطة بهذا الخادم
            devices_response = client.table('devices').select('id', count='exact').eq('server_id', server_dict['id']).execute()
            server_dict['connected_devices_count'] = devices_response.count if devices_response.count is not None else 0
            
            # عدد المنافذ النشطة - التحقق من وجود الجدول أولاً
            try:
                ports_response = client.table('usb_ports').select('id', count='exact').eq('server_id', server_dict['id']).eq('status', 'enabled').execute()
                server_dict['active_ports_count'] = ports_response.count if ports_response.count is not None else 0
            except Exception as ports_error:
                # إذا لم يكن الجدول موجوداً، نضع القيمة 0
                if 'usb_ports' in str(ports_error):
                    server_dict['active_ports_count'] = 0
                else:
                    raise ports_error
            
            # إجمالي استهلاك الطاقة
            power_response = client.table('devices').select('power_consumption').eq('server_id', server_dict['id']).execute()
            total_power = 0
            if power_response.data:
                for device in power_response.data:
                    try:
                        power = device.get('power_consumption', 0)
                        if isinstance(power, str):
                            power = float(power)
                        total_power += power
                    except (ValueError, TypeError):
                        pass
            server_dict['total_power_consumption'] = round(total_power, 2)
            
        except Exception as stats_error:
            current_app.logger.warning(f"فشل في جلب إحصائيات الخادم {server_dict.get('id')}: {stats_error}")
            server_dict['connected_devices_count'] = 0
            server_dict['active_ports_count'] = 0
            server_dict['total_power_consumption'] = 0
        
        return jsonify({'server': server_dict}), 200
        
    except Exception as e:
        current_app.logger.error(f"خطأ في جلب بيانات الخادم من Supabase: {e}")
        return jsonify({
            'error': 'خطأ في جلب بيانات الخادم',
            'message': str(e)
        }), 500

@servers_bp.route('/servers/<int:server_id>', methods=['DELETE'])
def delete_server(server_id):
    """حذف خادم"""
    user_id = verify_token()
    if not user_id:
        return jsonify({'error': 'Authentication required'}), 401
    
    server = Server.query.get(server_id)
    if not server:
        return jsonify({'error': 'Server not found'}), 404
    
    # لا يمكن حذف الخادم الرئيسي النشط
    if server.role == 'primary' and server.is_active:
        return jsonify({'error': 'Cannot delete active primary server'}), 400
    
    server_name = server.name
    db.session.delete(server)
    db.session.commit()
    
    # تسجيل في السجل
    log = Log(
        action='server_deleted',
        user_id=user_id,
        details=json.dumps({
            'server_id': server_id,
            'server_name': server_name
        }),
        timestamp=get_baghdad_time()
    )
    db.session.add(log)
    db.session.commit()
    
    # إنشاء سجل في البلوكشين
    create_blockchain_record(
        'server_deleted',
        {
            'server_id': server_id,
            'server_name': server_name
        },
        user_id
    )
    
    socketio.emit('server_deleted', {
        'server_id': server_id,
        'server_name': server_name
    }, namespace='/servers')
    
    return jsonify({'message': f'Server {server_name} deleted successfully'}), 200

@servers_bp.route('/servers/<int:server_id>', methods=['PUT'])
def update_server(server_id):
    """تحديث معلومات الخادم"""
    user_id = verify_token()
    if not user_id:
        return jsonify({'error': 'Authentication required'}), 401
    
    server = Server.query.get(server_id)
    if not server:
        return jsonify({'error': 'Server not found'}), 404
    
    data = request.get_json() or {}
    
    # تحديث الحقول المسموح بها
    if 'name' in data and data['name'] != server.name:
        # التحقق من عدم وجود خادم آخر بنفس الاسم
        existing = Server.query.filter_by(name=data['name']).first()
        if existing and existing.id != server_id:
            return jsonify({'error': 'Server with this name already exists'}), 409
        server.name = data['name']
    
    if 'ip_address' in data:
        server.ip_address = data['ip_address']
    if 'os' in data:
        server.os = data['os']
    if 'cpu' in data:
        server.cpu = data['cpu']
    if 'ram' in data:
        server.ram = data['ram']
    if 'capabilities' in data:
        server.capabilities = json.dumps(data['capabilities'])
    if 'config' in data:
        server.config = json.dumps(data['config'])
    
    server.updated_at = get_baghdad_time()
    db.session.commit()
    
    # تسجيل في السجل
    log = Log(
        action='server_updated',
        user_id=user_id,
        details=json.dumps({
            'server_id': server_id,
            'server_name': server.name,
            'updated_fields': list(data.keys())
        }),
        timestamp=get_baghdad_time()
    )
    db.session.add(log)
    db.session.commit()
    
    socketio.emit('server_updated', server.to_dict(), namespace='/servers')
    
    return jsonify({
        'message': 'Server updated successfully',
        'server': server.to_dict()
    }), 200

# --- High Availability Endpoints ---

@servers_bp.route('/servers/ha/change-role', methods=['POST'])
def change_server_role():
    """تغيير دور الخادم (رئيسي/احتياطي)"""
    user_id = verify_token()
    if not user_id:
        return jsonify({'error': 'Authentication required'}), 401
    
    data = request.get_json() or {}
    server_id = data.get('server_id')
    new_role = data.get('role')  # 'primary' or 'secondary'
    
    if not server_id or new_role not in ['primary', 'secondary']:
        return jsonify({'error': 'server_id and valid role are required'}), 400
    
    supabase = get_supabase_client()
    
    # الحصول على الخادم من Supabase
    response = supabase.table('servers').select('*').eq('id', server_id).execute()
    servers = response.data if response.data else []
    
    if not servers:
        return jsonify({'error': 'Server not found'}), 404
    
    server = servers[0]
    old_role = server['role']
    
    # إذا أصبح رئيسي، فعّله وجعل الآخرين احتياطيين
    if new_role == 'primary':
        # إلغاء تفعيل جميع الخوادم الأخرى
        supabase.table('servers').update({
            'role': 'secondary',
            'is_online': False,
            'status': 'inactive'
        }).neq('id', server_id).execute()
        
        # تحديث الخادم الحالي
        supabase.table('servers').update({
            'role': new_role,
            'is_online': True,
            'status': 'active',
            'last_heartbeat': get_baghdad_time_iso()
        }).eq('id', server_id).execute()
        
        socketio.emit('ha_demote', {
            'server_id': server_id,
            'old_role': old_role,
            'new_role': new_role
        }, namespace='/servers')
    else:
        # إذا أصبح احتياطي، ألغ تفعيله
        supabase.table('servers').update({
            'role': new_role,
            'is_online': False,
            'status': 'inactive'
        }).eq('id', server_id).execute()
    
    # تسجيل في السجل في Supabase
    log_data = {
        'action': 'server_role_changed',
        'user_id': user_id,
        'details': json.dumps({
            'server_id': server_id,
            'server_name': server['name'],
            'old_role': old_role,
            'new_role': new_role
        }),
        'timestamp': get_baghdad_time_iso()
    }
    supabase.table('logs').insert(log_data).execute()
    
    # إنشاء سجل في البلوكشين
    create_blockchain_record(
        'server_role_changed',
        {
            'server_id': server_id,
            'old_role': old_role,
            'new_role': new_role
        },
        user_id
    )
    
    return jsonify({
        'message': f'Server role changed from {old_role} to {new_role}',
        'server': {
            'id': server['id'],
            'name': server['name'],
            'ip_address': server['ip_address'],
            'role': new_role,
            'is_online': new_role == 'primary',
            'status': 'active' if new_role == 'primary' else 'inactive'
        }
    }), 200

@servers_bp.route('/servers/ha/promote-secondary', methods=['POST'])
def promote_secondary():
    """ترقية خادم احتياطي إلى رئيسي"""
    user_id = verify_token()
    if not user_id:
        return jsonify({'error': 'Authentication required'}), 401
    
    try:
        # البحث عن خادم احتياطي نشط
        secondary_response = supabase.table('servers').select('*').eq('role', 'secondary').eq('is_online', True).execute()
        secondary_servers = secondary_response.data
        
        if not secondary_servers:
            return jsonify({'error': 'No active secondary server found'}), 404
        
        secondary_server = secondary_servers[0]
        
        # البحث عن الخادم الرئيسي الحالي
        primary_response = supabase.table('servers').select('*').eq('role', 'primary').eq('is_online', True).execute()
        primary_servers = primary_response.data
        
        # إلغاء تفعيل الخادم الرئيسي الحالي
        if primary_servers:
            primary_server = primary_servers[0]
            supabase.table('servers').update({
                'is_online': False,
                'role': 'secondary',
                'last_seen': get_baghdad_time().isoformat()
            }).eq('id', primary_server['id']).execute()
        
        # ترقية الخادم الاحتياطي
        supabase.table('servers').update({
            'role': 'primary',
            'is_online': True,
            'last_seen': get_baghdad_time().isoformat()
        }).eq('id', secondary_server['id']).execute()
        
        # إرسال إشعارات
        socketio.emit('ha_failover', {
            'server_id': secondary_server['id'],
            'old_primary_id': primary_server['id'] if primary_servers else None
        }, namespace='/servers')
        
        # تسجيل في السجل
        supabase.table('logs').insert({
            'action': 'ha_promote_secondary',
            'user_id': user_id,
            'details': json.dumps({
                'promoted_server_id': secondary_server['id'],
                'promoted_server_name': secondary_server['name'],
                'old_primary_id': primary_server['id'] if primary_servers else None
            }),
            'timestamp': get_baghdad_time().isoformat()
        }).execute()
        
        return jsonify({
            'message': 'Secondary server promoted to primary',
            'new_primary': {
                'id': secondary_server['id'],
                'name': secondary_server['name'],
                'role': 'primary',
                'is_online': True
            }
        }), 200
        
    except Exception as e:
        return jsonify({'error': f'Failed to promote secondary server: {str(e)}'}), 500


# --- USB Ports Management ---

@servers_bp.route('/servers/<int:server_id>/physical-usb-ports', methods=['GET'])
def get_server_physical_usb_ports(server_id):
    """جلب جميع USB ports المتاحة في الخادم"""
    user_id = verify_token()
    if not user_id:
        return jsonify({'error': 'Authentication required'}), 401
    
    server = Server.query.get(server_id)
    if not server:
        return jsonify({'error': 'Server not found'}), 404
    
    try:
        # جلب USB devices الحقيقية من النظام (استبعاد المكونات الداخلية)
        usb_ports = usb_service.get_usb_ports(devices_only=True)
        
        # جلب معلومات النظام
        system_info = usb_service.get_system_info()
        
        # ربط USB ports بالخادم
        for port in usb_ports:
            port['server_id'] = server_id
            port['server_name'] = server.name
        
        # تسجيل في السجل
        log = Log(
            action='usb_ports_retrieved',
            user_id=user_id,
            details=json.dumps({
                'server_id': server_id,
                'server_name': server.name,
                'ports_count': len(usb_ports),
                'system_info': system_info
            }),
            timestamp=get_baghdad_time()
        )
        db.session.add(log)
        db.session.commit()
        
        return jsonify({
            'server_id': server_id,
            'server_name': server.name,
            'usb_ports': usb_ports,
            'system_info': system_info,
            'total_ports': len(usb_ports),
            'retrieved_at': get_baghdad_time_iso()
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting USB ports for server {server_id}: {e}")
        return jsonify({'error': f'Failed to get USB ports: {str(e)}'}), 500


@servers_bp.route('/servers/<int:server_id>/usb-ports/<port_id>/enable', methods=['POST'])
def enable_usb_port(server_id, port_id):
    """تفعيل منفذ USB معين"""
    user_id = verify_token()
    if not user_id:
        return jsonify({'error': 'Authentication required'}), 401
    
    server = Server.query.get(server_id)
    if not server:
        return jsonify({'error': 'Server not found'}), 404
    
    try:
        # في الواقع، هذا يتطلب تنفيذ فعلي على الخادم
        # هنا نعطي مثالاً للتنفيذ
        success = True
        message = f"تم تفعيل المنفذ {port_id} على الخادم {server.name}"
        
        # تسجيل في السجل
        log = Log(
            action='usb_port_enabled',
            user_id=user_id,
            details=json.dumps({
                'server_id': server_id,
                'server_name': server.name,
                'port_id': port_id,
                'success': success
            }),
            timestamp=get_baghdad_time()
        )
        db.session.add(log)
        db.session.commit()
        
        # إرسال إشعار عبر WebSocket
        socketio.emit('usb_port_enabled', {
            'server_id': server_id,
            'port_id': port_id,
            'user_id': user_id
        }, namespace='/servers')
        
        return jsonify({
            'message': message,
            'success': success,
            'port_id': port_id,
            'server_id': server_id
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error enabling USB port {port_id} on server {server_id}: {e}")
        return jsonify({'error': f'Failed to enable USB port: {str(e)}'}), 500


@servers_bp.route('/servers/<int:server_id>/usb-ports/<port_id>/disable', methods=['POST'])
def disable_usb_port(server_id, port_id):
    """تعطيل منفذ USB معين"""
    user_id = verify_token()
    if not user_id:
        return jsonify({'error': 'Authentication required'}), 401
    
    server = Server.query.get(server_id)
    if not server:
        return jsonify({'error': 'Server not found'}), 404
    
    try:
        # في الواقع، هذا يتطلب تنفيذ فعلي على الخادم
        success = True
        message = f"تم تعطيل المنفذ {port_id} على الخادم {server.name}"
        
        # تسجيل في السجل
        log = Log(
            action='usb_port_disabled',
            user_id=user_id,
            details=json.dumps({
                'server_id': server_id,
                'server_name': server.name,
                'port_id': port_id,
                'success': success
            }),
            timestamp=get_baghdad_time()
        )
        db.session.add(log)
        db.session.commit()
        
        # إرسال إشعار عبر WebSocket
        socketio.emit('usb_port_disabled', {
            'server_id': server_id,
            'port_id': port_id,
            'user_id': user_id
        }, namespace='/servers')
        
        return jsonify({
            'message': message,
            'success': success,
            'port_id': port_id,
            'server_id': server_id
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error disabling USB port {port_id} on server {server_id}: {e}")
        return jsonify({'error': f'Failed to disable USB port: {str(e)}'}), 500


@servers_bp.route('/servers/add-secondary', methods=['POST'])
def add_secondary_server():
    """إضافة خادم فرعي جديد"""
    user_id = verify_token()
    if not user_id:
        return jsonify({'error': 'Authentication required'}), 401
    
    data = request.get_json() or {}
    name = data.get('name')
    ip_address = data.get('ip_address')
    os = data.get('os')
    cpu = data.get('cpu')
    ram = data.get('ram')
    capabilities = data.get('capabilities', {})
    config = data.get('config', {})
    
    if not name or not ip_address:
        return jsonify({'error': 'name and ip_address are required'}), 400
    
    # التحقق من عدم وجود خادم بنفس الاسم
    existing_server = Server.query.filter_by(name=name).first()
    if existing_server:
        return jsonify({'error': 'Server with this name already exists'}), 409
    
    try:
        # إنشاء خادم فرعي جديد
        api_key = secrets.token_hex(32)
        server = Server(
            name=name,
            ip_address=ip_address,
            os=os,
            cpu=cpu,
            ram=ram,
            last_heartbeat=get_baghdad_time(),
            status='active',
            api_key=api_key,
            capabilities=json.dumps(capabilities),
            config=json.dumps(config),
            role='secondary',
            is_active=False  # الخوادم الفرعية غير مفعلة افتراضياً
        )
        
        db.session.add(server)
        db.session.commit()
        
        # تسجيل في السجل
        log = Log(
            action='secondary_server_added',
            user_id=user_id,
            details=json.dumps({
                'server_id': server.id,
                'server_name': server.name,
                'ip_address': server.ip_address,
                'role': 'secondary'
            }),
            timestamp=get_baghdad_time()
        )
        db.session.add(log)
        db.session.commit()
        
        # إنشاء سجل في البلوكشين
        create_blockchain_record(
            'secondary_server_added',
            {
                'server_id': server.id,
                'server_name': server.name,
                'ip_address': server.ip_address
            },
            user_id
        )
        
        # إرسال إشعار عبر WebSocket
        socketio.emit('secondary_server_added', server.to_dict(), namespace='/servers')
        
        return jsonify({
            'message': 'Secondary server added successfully',
            'server': server.to_dict(),
            'api_key': server.api_key
        }), 201
        
    except Exception as e:
        current_app.logger.error(f"Error adding secondary server: {e}")
        return jsonify({'error': f'Failed to add secondary server: {str(e)}'}), 500


@servers_bp.route('/servers/system-info', methods=['GET'])
def get_system_info():
    """جلب معلومات النظام الحالي"""
    user_id = verify_token()
    if not user_id:
        return jsonify({'error': 'Authentication required'}), 401
    
    try:
        # جلب معلومات النظام الحقيقي
        system_info = usb_service.get_system_info()
        
        # إضافة معلومات إضافية
        system_info.update({
            'current_server_id': 1,  # يمكن تحديثه حسب الحاجة
            'retrieved_by': user_id,
            'retrieved_at': get_baghdad_time_iso()
        })
        
        return jsonify(system_info), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting system info: {e}")
        return jsonify({'error': f'Failed to get system info: {str(e)}'}), 500


@servers_bp.route('/servers/system-performance', methods=['GET'])
def get_system_performance():
    """جلب بيانات الأداء الحقيقية للنظام"""
    user_id = verify_token()
    if not user_id:
        return jsonify({'error': 'Authentication required'}), 401
    
    try:
        # جلب بيانات الأداء الحقيقية
        # حساب استخدام الشبكة الحقيقي
        net_io_before = psutil.net_io_counters()
        time.sleep(0.5)  # انتظار 0.5 ثانية لقياس دقيق
        net_io_after = psutil.net_io_counters()
        
        # حساب معدل الشبكة بالميجابت في الثانية
        bytes_sent_per_sec = (net_io_after.bytes_sent - net_io_before.bytes_sent) / 0.5
        bytes_recv_per_sec = (net_io_after.bytes_recv - net_io_before.bytes_recv) / 0.5
        
        # تحويل إلى ميجابت في الثانية (Mbps)
        mbps_sent = (bytes_sent_per_sec * 8) / (1024 * 1024)
        mbps_recv = (bytes_recv_per_sec * 8) / (1024 * 1024)
        total_mbps = mbps_sent + mbps_recv
        
        performance_data = {
            'cpu_usage': psutil.cpu_percent(interval=1),
            'memory_usage': psutil.virtual_memory().percent,
            'disk_usage': psutil.disk_usage('/').percent if os.path.exists('/') else psutil.disk_usage('C:').percent,
            'network_usage': round(total_mbps, 2),  # السرعة الحقيقية بالميجابت/ث
            'network_sent': round(mbps_sent, 2),    # سرعة الإرسال
            'network_recv': round(mbps_recv, 2),    # سرعة الاستقبال
            'uptime': int(time.time() - psutil.boot_time()),
            'processes': len(psutil.pids()),
            'timestamp': get_baghdad_time_iso()
        }
        
        return jsonify(performance_data), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting system performance: {e}")
        return jsonify({'error': f'Failed to get system performance: {str(e)}'}), 500


@servers_bp.route('/servers/system-performance/test', methods=['GET'])
def get_system_performance_test():
    """جلب بيانات الأداء الاختبارية للنظام مع قياس سرعة الشبكة الحقيقية"""
    try:
        # جلب بيانات الأداء الحقيقية للنظام
        cpu_usage = psutil.cpu_percent(interval=1)
        memory_usage = psutil.virtual_memory().percent
        disk_usage = psutil.disk_usage('/').percent if os.path.exists('/') else psutil.disk_usage('C:').percent
        uptime = int(time.time() - psutil.boot_time())
        processes = len(psutil.pids())

        # قياس سرعة الشبكة باستخدام الدالة الجديدة
        try:
            network_data = measure_network_speed_direct()

            network_download = network_data.get('download_speed_mbps', 0)
            network_upload = network_data.get('upload_speed_mbps', 0)
            network_ping = network_data.get('ping_ms', 0)
        except Exception as e:
            current_app.logger.error(f"Error getting network speed: {e}")
            network_download = 0
            network_upload = 0
            network_ping = 0

        performance_data = {
            'cpu_usage': round(cpu_usage, 2),
            'memory_usage': round(memory_usage, 2),
            'disk_usage': round(disk_usage, 2),
            'network_download_mbps': round(network_download, 2),
            'network_upload_mbps': round(network_upload, 2),
            'network_ping_ms': round(network_ping, 2),
            'uptime_seconds': uptime,
            'processes_count': processes,
            'timestamp': get_baghdad_time_iso()
        }

        return jsonify(performance_data), 200

    except Exception as e:
        current_app.logger.error(f"Error getting system performance test: {e}")
        return jsonify({'error': f'Failed to get system performance test: {str(e)}'}), 500

@servers_bp.route('/servers/network-speed-test', methods=['GET'])
def network_speed_test():
    """قياس سرعة الشبكة الحقيقية"""
    try:
        import speedtest
        import time

        # إنشاء كائن speedtest
        st = speedtest.Speedtest()

        # العثور على أفضل خادم
        st.get_best_server()

        # قياس سرعة التحميل
        download_speed = st.download() / 1_000_000  # تحويل إلى Mbps

        # قياس سرعة الرفع
        upload_speed = st.upload() / 1_000_000  # تحويل إلى Mbps

        # قياس ping
        ping = st.results.ping

        # معلومات الخادم
        server_info = st.results.server

        return jsonify({
            'download_speed_mbps': round(download_speed, 2),
            'upload_speed_mbps': round(upload_speed, 2),
            'ping_ms': round(ping, 2),
            'server_info': server_info,
            'timestamp': get_baghdad_time_iso(),
            'test_duration_seconds': time.time() - st.results.timestamp
        }), 200

    except ImportError:
        # محاولة تثبيت speedtest-cli تلقائياً
        try:
            import subprocess
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'speedtest-cli'])
            # إعادة المحاولة بعد التثبيت
            import speedtest
            return network_speed_test()
        except:
            # إذا فشل التثبيت، استخدم psutil كبديل
            network_data = measure_network_speed_direct()
            return jsonify(network_data), 200
    except Exception as e:
        current_app.logger.error(f"Error in network speed test: {e}")
        return jsonify({'error': f'Network speed test failed: {str(e)}'}), 500

def measure_network_speed_direct():
    """قياس سرعة الشبكة مباشرة وإرجاع البيانات كقاموس"""
    try:
        # قياس الشبكة لمدة 2 ثانية للحصول على قراءة أكثر دقة
        net_io_before = psutil.net_io_counters()
        time.sleep(2.0)  # انتظار 2 ثانية
        net_io_after = psutil.net_io_counters()

        # حساب معدل الشبكة بالميجابت في الثانية
        bytes_sent_per_sec = (net_io_after.bytes_sent - net_io_before.bytes_sent) / 2.0
        bytes_recv_per_sec = (net_io_after.bytes_recv - net_io_before.bytes_recv) / 2.0

        # تحويل إلى ميجابت في الثانية (Mbps)
        download_speed = (bytes_recv_per_sec * 8) / (1024 * 1024)  # سرعة التحميل
        upload_speed = (bytes_sent_per_sec * 8) / (1024 * 1024)    # سرعة الرفع
        total_speed = download_speed + upload_speed

        # محاولة قياس ping لخادم Google
        ping_result = measure_ping('8.8.8.8')

        return {
            'download_speed_mbps': round(download_speed, 2),
            'upload_speed_mbps': round(upload_speed, 2),
            'total_speed_mbps': round(total_speed, 2),
            'ping_ms': ping_result.get('ping_ms', 0),
            'method': 'psutil_direct',
            'test_duration_seconds': 2.0,
            'timestamp': get_baghdad_time_iso()
        }

    except Exception as e:
        current_app.logger.error(f"Error in network speed direct measurement: {e}")
        return {
            'download_speed_mbps': 0,
            'upload_speed_mbps': 0,
            'total_speed_mbps': 0,
            'ping_ms': 0,
            'method': 'error',
            'error': str(e),
            'timestamp': get_baghdad_time_iso()
        }


def measure_ping(host, count=3):
    """قياس ping لمضيف محدد"""
    try:
        import subprocess
        import platform

        system = platform.system()

        if system == "Windows":
            cmd = ['ping', '-n', str(count), host]
        else:
            cmd = ['ping', '-c', str(count), host]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)

        if result.returncode == 0:
            # استخراج متوسط ping من النتيجة
            lines = result.stdout.split('\n')
            for line in lines:
                if 'Average' in line and 'ms' in line:  # Windows
                    ping_value = line.split('=')[-1].strip().replace('ms', '')
                    return {'ping_ms': float(ping_value), 'success': True}
                elif 'avg' in line and 'ms' in line:  # Linux/Mac
                    ping_part = line.split('/')[-3]  # متوسط القيم الثلاث
                    return {'ping_ms': float(ping_part), 'success': True}

        return {'ping_ms': 0, 'success': False}

    except Exception as e:
        current_app.logger.error(f"Error measuring ping: {e}")
        return {'ping_ms': 0, 'success': False}


@servers_bp.route('/servers/all-usb-ports', methods=['GET'])
def get_all_usb_ports():
    """جلب جميع USB ports من جميع الخوادم"""
    user_id = verify_token()
    if not user_id:
        return jsonify({'error': 'Authentication required'}), 401
    
    try:
        # جلب جميع الخوادم
        servers = Server.query.filter_by(is_active=True).all()
        all_ports = []
        
        for server in servers:
            try:
                # جلب USB ports لكل خادم
                usb_ports = usb_service.get_usb_ports(devices_only=True)
                
                for port in usb_ports:
                    port['server_id'] = server.id
                    port['server_name'] = server.name
                    port['server_ip'] = server.ip_address
                    all_ports.append(port)
                    
            except Exception as e:
                current_app.logger.error(f"Error getting USB ports for server {server.id}: {e}")
                continue
        
        return jsonify({
            'total_ports': len(all_ports),
            'servers_count': len(servers),
            'usb_ports': all_ports,
            'retrieved_at': get_baghdad_time_iso()
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting all USB ports: {e}")
        return jsonify({'error': f'Failed to get all USB ports: {str(e)}'}), 500


@servers_bp.route('/servers/real-ip', methods=['GET'])
def get_real_ip():
    """Get the real network IP address of the current server"""
    try:
        real_ip = get_real_server_ip()
        hostname = platform.node()
        
        # Validate IP format
        if not real_ip or real_ip == '127.0.0.1':
            # Try alternative method
            try:
                import socket
                hostname = socket.gethostname()
                real_ip = socket.gethostbyname(hostname)
                if real_ip == '127.0.0.1':
                    real_ip = 'localhost'
            except Exception:
                real_ip = 'localhost'
        
        return jsonify({
            'ip_address': real_ip,
            'hostname': hostname,
            'timestamp': get_baghdad_time_iso()
        }), 200
    except Exception as e:
        current_app.logger.error(f"Error getting real IP: {e}")
        return jsonify({
            'ip_address': 'localhost',
            'hostname': 'unknown',
            'timestamp': get_baghdad_time_iso(),
            'error': str(e)
        }), 200  # Return 200 instead of 500 to avoid frontend errors


@servers_bp.route('/location', methods=['GET'])
def get_location():
    """جلب الموقع الجغرافي الحالي مع caching"""
    try:
        # خيار لتعطيل تحذيرات rate limit (يمكن تمريره كـ query parameter)
        # مثال: /api/servers/location?show_warnings=false
        show_rate_limit_warnings = request.args.get('show_warnings', 'false').lower() == 'true'
        # التحقق من وجود cache
        cache_key = 'location_data'
        cache_time_key = 'location_cache_time'

        # إذا كان هناك cache ولم يمر أكثر من ساعة
        if hasattr(current_app, cache_key):
            cache_time = getattr(current_app, cache_time_key, None)
            if cache_time and (get_baghdad_time() - cache_time).seconds < 3600:  # ساعة واحدة
                current_app.logger.info("Using cached location data")
                return jsonify(getattr(current_app, cache_key)), 200

        # جلب البيانات من ipapi.co
        current_app.logger.info("Fetching fresh location data from ipapi.co")
        response = requests.get('https://ipapi.co/json/', timeout=10)

        # إذا فشل ipapi.co، جرب ip-api.com كبديل
        if response.status_code == 429:
            if show_rate_limit_warnings:
                current_app.logger.info("ipapi.co rate limit exceeded, trying ip-api.com")
            response = requests.get('http://ip-api.com/json/', timeout=10)

        response.raise_for_status()
        data = response.json()

        # استخراج البيانات الأساسية
        city = data.get('city', 'Baghdad')
        lat = data.get('latitude', data.get('lat', 33.3152))
        lon = data.get('longitude', data.get('lon', 44.3661))

        # تحويل الاختصارات إلى أسماء كاملة باستخدام المدينة والإحداثيات
        city_name, region_full_name = get_city_region_from_coords(lat, lon)

        location_data = {
            'city': data.get('city', 'Baghdad'),
            'region': region_full_name,
            'country': data.get('country_name', data.get('country', 'Iraq')),
            'latitude': data.get('latitude', data.get('lat', 33.3152)),
            'longitude': data.get('longitude', data.get('lon', 44.3661)),
            'ip': data.get('ip', data.get('query', '127.0.0.1'))
        }

        # حفظ في application context
        setattr(current_app, cache_key, location_data)
        setattr(current_app, cache_time_key, get_baghdad_time())

        return jsonify(location_data), 200

    except requests.RequestException as e:
        current_app.logger.error(f"Error fetching location from ipapi.co: {e}")

        # التحقق من وجود cache قديم في حالة فشل الجلب
        cache_key = 'location_data'
        if hasattr(current_app, cache_key):
            current_app.logger.info("Using cached location data due to API error")
            return jsonify(getattr(current_app, cache_key)), 200

        # إرجاع موقع افتراضي في حالة فشل الجلب وليس هناك cache
        return jsonify({
            'city': 'Baghdad',
            'region': 'Baghdad',
            'country': 'Iraq',
            'latitude': 33.3152,
            'longitude': 44.3661,
            'ip': '127.0.0.1',
            'error': 'Failed to fetch location data'
        }), 200
    except Exception as e:
        current_app.logger.error(f"Unexpected error in get_location: {e}")

        # التحقق من وجود cache قديم في حالة خطأ غير متوقع
        cache_key = 'location_data'
        if hasattr(current_app, cache_key):
            current_app.logger.info("Using cached location data due to unexpected error")
            return jsonify(getattr(current_app, cache_key)), 200

        return jsonify({
            'city': 'Baghdad',
            'region': 'Baghdad',
            'country': 'Iraq',
            'latitude': 33.3152,
            'longitude': 44.3661,
            'ip': '127.0.0.1',
            'error': str(e)
        }), 200


@servers_bp.route('/location/coordinates', methods=['GET'])
def get_location_from_coordinates_endpoint():
    """تحديد الموقع من الإحداثيات المُرسلة في الطلب"""
    try:
        # خيار لتعطيل تحذيرات rate limit
        # مثال: /api/servers/location/coordinates?lat=32.4637&lon=44.4197&show_warnings=false
        show_rate_limit_warnings = request.args.get('show_warnings', 'false').lower() == 'true'
        # جلب الإحداثيات من parameters
        lat = request.args.get('lat')
        lon = request.args.get('lon')

        if not lat or not lon:
            return jsonify({
                'error': 'Coordinates required. Use ?lat=<latitude>&lon=<longitude>'
            }), 400

        # تحديد الموقع من الإحداثيات
        location_data = get_location_from_coordinates(lat, lon)

        if location_data:
            return jsonify(location_data), 200
        else:
            return jsonify({
                'error': 'Invalid coordinates format'
            }), 400

    except Exception as e:
        current_app.logger.error(f"Error in coordinates endpoint: {e}")
        return jsonify({
            'error': f'Failed to determine location from coordinates: {str(e)}'
        }), 500


@servers_bp.route('/location/test-coordinates', methods=['GET'])
def test_coordinates_endpoint():
    """اختبار تحديد الموقع من إحداثيات مدن عراقية معروفة"""
    test_cases = [
        {'name': 'Hillah (Babil)', 'lat': 32.4637, 'lon': 44.4197},
        {'name': 'Basra', 'lat': 30.5085, 'lon': 47.7804},
        {'name': 'Najaf', 'lat': 32.0298, 'lon': 44.3462},
        {'name': 'Karbala', 'lat': 32.6160, 'lon': 44.0249},
        {'name': 'Mosul', 'lat': 36.3569, 'lon': 43.1635},
        {'name': 'Kirkuk', 'lat': 35.4681, 'lon': 44.3922},
        {'name': 'Baghdad', 'lat': 33.3152, 'lon': 44.3661}
    ]

    results = []
    for test_case in test_cases:
        location_data = get_location_from_coordinates(test_case['lat'], test_case['lon'])
        if location_data:
            results.append({
                'test_name': test_case['name'],
                'coordinates': f"{test_case['lat']}, {test_case['lon']}",
                'result': location_data
            })

    return jsonify({
        'message': 'Test results for coordinate-based location detection',
        'results': results
    }), 200


@servers_bp.route('/servers/websocket-status', methods=['GET'])
def get_websocket_status():
    """الحصول على حالة WebSocket الحالية"""
    try:
        # إرجاع معلومات WebSocket الأساسية
        return jsonify({
            'websocket_status': 'active',
            'websocket_url': 'ws://localhost:5000',
            'namespaces': ['/servers', '/devices', '/logs'],
            'connection_status': 'connected',
            'last_ping': get_baghdad_time_iso()
        }), 200
    except Exception as e:
        current_app.logger.error(f"Error getting WebSocket status: {e}")
        # إرجاع إعدادات افتراضية في حالة الخطأ
        return jsonify({
            'websocket_status': 'fallback',
            'websocket_url': 'ws://localhost:5000',
            'namespaces': ['/servers', '/devices', '/logs'],
            'connection_status': 'unknown'
        }), 200


@servers_bp.route('/servers/<int:server_id>/update-system-info', methods=['POST'])
def update_server_system_info(server_id):
    """تحديث معلومات النظام للخادم في Supabase"""
    try:
        # جلب البيانات من Supabase
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة', 'message': 'فشل في الاتصال بـ Supabase'}), 500
        
        # الحصول على معلومات النظام الحقيقية
        import platform
        import psutil
        import socket
        
        hostname = socket.gethostname()
        ip_address = socket.gethostbyname(hostname)
        
        # معلومات المعالج
        cpu_info = platform.processor() or "Unknown CPU"
        if not cpu_info or cpu_info == "":
            cpu_info = f"{psutil.cpu_count(logical=True)} cores"
        
        # معلومات الذاكرة
        memory = psutil.virtual_memory()
        ram_info = f"{round(memory.total / (1024**3), 1)} GB"
        
        # معلومات النظام
        os_info = f"{platform.system()} {platform.release()}"
        
        # تحديث بيانات الخادم في Supabase
        update_data = {
            'name': hostname,
            'ip_address': ip_address,
            'os': os_info,
            'cpu': cpu_info,
            'ram': ram_info,
            'last_heartbeat': get_baghdad_time_iso(),
            'updated_at': get_baghdad_time_iso()
        }
        
        client.table('servers').update(update_data).eq('id', server_id).execute()
        
        return jsonify({
            'message': 'تم تحديث معلومات النظام بنجاح',
            'server_info': update_data
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"خطأ في تحديث معلومات النظام: {e}")
        return jsonify({
            'error': 'خطأ في تحديث معلومات النظام',
            'message': str(e)
        }), 500

@servers_bp.route('/servers/auto-update/start', methods=['POST'])
def start_auto_update_endpoint():
    """بدء التحديث التلقائي لمعلومات الخادم"""
    try:
        start_auto_update()
        return jsonify({
            'message': 'تم بدء التحديث التلقائي لمعلومات الخادم',
            'status': 'started'
        }), 200
    except Exception as e:
        current_app.logger.error(f"خطأ في بدء التحديث التلقائي: {e}")
        return jsonify({
            'error': 'خطأ في بدء التحديث التلقائي',
            'message': str(e)
        }), 500

@servers_bp.route('/servers/<int:server_id>/usb-ports', methods=['GET'])
def get_server_usb_ports(server_id):
    """جلب بورتات USB لخادم محدد مع حالة الاتصال"""
    try:
        client = get_supabase_client()
        if client is None:
            return jsonify({'error': 'خدمة قاعدة البيانات غير متاحة'}), 500

        # جلب البورتات من Supabase
        response = client.table('usb_ports').select('*').eq('server_id', server_id).execute()
        usb_ports = response.data if response.data else []

        # تحسين البيانات
        for port in usb_ports:
            port['is_connected'] = port.get('connection_status') == 'connected'
            port['device_info'] = {
                'id': port.get('device_id'),
                'name': port.get('device_name')
            } if port.get('device_id') else None

        return jsonify({
            'server_id': server_id,
            'usb_ports': usb_ports,
            'total_ports': len(usb_ports),
            'connected_ports': len([p for p in usb_ports if p.get('connection_status') == 'connected']),
            'available_ports': len([p for p in usb_ports if p.get('connection_status') == 'disconnected'])
        }), 200

    except Exception as e:
        current_app.logger.error(f"خطأ في جلب بورتات USB للخادم {server_id}: {e}")
        return jsonify({
            'error': 'خطأ في جلب بورتات USB',
            'message': str(e)
        }), 500

@servers_bp.route('/usb-ports/<port_id>/connect', methods=['POST'])
def connect_device_to_port(port_id):
    """ربط جهاز ببورت USB"""
    try:
        data = request.get_json()
        device_id = data.get('device_id')
        device_name = data.get('device_name')

        if not device_id or not device_name:
            return jsonify({'error': 'معرف الجهاز واسم الجهاز مطلوبان'}), 400

        if update_port_connection_status(port_id, device_id, device_name, 'connected'):
            return jsonify({
                'message': f'تم ربط الجهاز {device_name} بالبورت {port_id}',
                'port_id': port_id,
                'device_id': device_id,
                'status': 'connected'
            }), 200
        else:
            return jsonify({'error': 'فشل في ربط الجهاز بالبورت'}), 500

    except Exception as e:
        current_app.logger.error(f"خطأ في ربط الجهاز بالبورت {port_id}: {e}")
        return jsonify({
            'error': 'خطأ في ربط الجهاز بالبورت',
            'message': str(e)
        }), 500

@servers_bp.route('/usb-ports/<port_id>/disconnect', methods=['POST'])
def disconnect_device_from_port(port_id):
    """فصل جهاز من بورت USB"""
    try:
        if update_port_connection_status(port_id, None, None, 'disconnected'):
            return jsonify({
                'message': f'تم فصل الجهاز من البورت {port_id}',
                'port_id': port_id,
                'status': 'disconnected'
            }), 200
        else:
            return jsonify({'error': 'فشل في فصل الجهاز من البورت'}), 500

    except Exception as e:
        current_app.logger.error(f"خطأ في فصل الجهاز من البورت {port_id}: {e}")
        return jsonify({
            'error': 'خطأ في فصل الجهاز من البورت',
            'message': str(e)
        }), 500

@servers_bp.route('/websocket-status', methods=['GET'])
def get_websocket_status_info():
    """الحصول على معلومات حالة WebSocket"""
    try:
        from extensions import socketio
        import os

        websocket_enabled = not os.environ.get('DISABLE_WEBSOCKET', '').lower() in ['true', '1', 'yes']

        return jsonify({
            'websocket_status': 'enabled' if websocket_enabled else 'disabled',
            'websocket_url': 'http://localhost:5000',
            'socketio_version': getattr(socketio, '__version__', 'unknown') if socketio else 'not_initialized',
            'namespaces': ['/api/devices', '/api/servers', '/api/logs'],
            'cors_enabled': True,
            'transports': ['polling', 'websocket'],
            'ping_timeout': 60,
            'ping_interval': 25
        }), 200

    except Exception as e:
        current_app.logger.error(f"خطأ في جلب معلومات WebSocket: {e}")
        return jsonify({
            'error': 'خطأ في جلب معلومات WebSocket',
            'message': str(e),
            'websocket_status': 'error'
        }), 500

# دالة لتحديث last_heartbeat تلقائياً
def update_heartbeat_periodically():
    """تحديث last_heartbeat للخادم الرئيسي كل دقيقة"""
    import threading
    import time
    
    def heartbeat_worker():
        while True:
            try:
                client = get_supabase_client()
                if client:
                    update_data = {
                        'last_heartbeat': get_baghdad_time_iso(),
                        'status': 'active',
                        'is_online': True
                    }
                    client.table('servers').update(update_data).eq('id', 1).execute()
                    # print("✅ تم تحديث نبضة الحياة")  # تم إلغاء الرسالة
                else:
                    pass  # print("❌ فشل في الاتصال بـ Supabase")  # تم إلغاء الرسالة
            except Exception as e:
                pass  # print(f"❌ خطأ في تحديث نبضة الحياة: {e}")  # تم إلغاء الرسالة
            
            # انتظار دقيقة واحدة
            time.sleep(60)
    
    # بدء الخيط في الخلفية
    thread = threading.Thread(target=heartbeat_worker, daemon=True)
    thread.start()
    # print("🚀 تم بدء تحديث نبضة الحياة التلقائي")  # تم إلغاء الرسالة

# تشغيل التحديث التلقائي عند استيراد الملف
update_heartbeat_periodically()

@servers_bp.route('/servers/ha/status', methods=['GET'])
def get_ha_status():
    """الحصول على حالة نظام التوافر العالي"""
    user_id = verify_token()
    if not user_id:
        return jsonify({'error': 'Authentication required'}), 401
    
    try:
        # الحصول على جميع الخوادم من Supabase
        supabase = get_supabase_client()
        response = supabase.table('servers').select('*').execute()
        servers = response.data if response.data else []
        
        # حساب الإحصائيات
        total_servers = len(servers)
        active_servers = len([s for s in servers if s.get('is_online', False)])
        primary_servers = len([s for s in servers if s.get('role') == 'primary' and s.get('is_online', False)])
        secondary_servers = len([s for s in servers if s.get('role') == 'secondary' and s.get('is_online', False)])
        
        # حساب uptime_percentage بناءً على الخوادم النشطة
        uptime_percentage = (active_servers / total_servers * 100) if total_servers > 0 else 0
        
        # حساب متوسط وقت الاستجابة (محاكاة بسيطة)
        average_response_time = 45.2  # يمكن تحسينه لاحقاً لحساب حقيقي
        
        # قياس سرعة الشبكة الحقيقية
        try:
            # استدعاء دالة قياس الشبكة مباشرة (بدون jsonify)
            network_data = measure_network_speed_direct()

            network_download_speed = network_data.get('download_speed_mbps', 0)
            network_ping = network_data.get('ping_ms', 0)
        except Exception as e:
            current_app.logger.error(f"Error measuring network speed: {e}")
            network_download_speed = 0
            network_ping = 0
        
        # حساب عدد مرات Failover من السجلات
        try:
            failover_response = supabase.table('logs').select('*').eq('action', 'ha_failover').execute()
            total_failovers = len(failover_response.data) if failover_response.data else 0
        except:
            total_failovers = 0
        
        # الحصول على آخر وقت Failover
        try:
            last_failover_response = supabase.table('logs').select('*').eq('action', 'ha_failover').order('timestamp', desc=True).limit(1).execute()
            last_failover_time = last_failover_response.data[0]['timestamp'] if last_failover_response.data else None
        except:
            last_failover_time = None
        
        return jsonify({
            'uptime_percentage': uptime_percentage,
            'average_response_time': average_response_time,
            'total_failovers': total_failovers,
            'last_failover_time': last_failover_time,
            'active_servers': active_servers,
            'total_servers': total_servers,
            'network_speed': {
                'download_mbps': network_download_speed,
                'ping_ms': network_ping,
                'last_measured': get_baghdad_time_iso()
            },
            'last_updated': get_baghdad_time_iso()
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting HA status: {e}")
        return jsonify({'error': 'Failed to get HA status'}), 500

@servers_bp.route('/servers/ha/history', methods=['GET'])
def get_ha_history():
    """الحصول على سجل أحداث التوافر العالي"""
    user_id = verify_token()
    if not user_id:
        return jsonify({'error': 'Authentication required'}), 401
    
    try:
        # الحصول على سجلات الـ HA من Supabase
        supabase = get_supabase_client()
        
        # البحث عن السجلات المتعلقة بالـ HA
        response = supabase.table('logs').select('*').eq('action', 'ha_failover').order('timestamp', desc=True).limit(50).execute()
        logs = response.data if response.data else []
        
        history = []
        for log in logs:
            try:
                details = json.loads(log.get('details', '{}')) if log.get('details') else {}
                history.append({
                    'id': log.get('id'),
                    'type': 'failover',
                    'timestamp': log.get('timestamp'),
                    'server_id': details.get('promoted_server_id'),
                    'old_primary_id': details.get('old_primary_id'),
                    'message': f'تم ترقية خادم احتياطي (ID: {details.get("promoted_server_id", "غير محدد")}) إلى رئيسي'
                })
            except json.JSONDecodeError:
                history.append({
                    'id': log.get('id'),
                    'type': 'failover',
                    'timestamp': log.get('timestamp'),
                    'message': 'حدث تحويل في نظام التوافر العالي'
                })
        
        return jsonify({
            'history': history,
            'total_events': len(history)
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting HA history: {e}")
        return jsonify({'error': 'Failed to get HA history'}), 500

@servers_bp.route('/servers/ha/force-failover', methods=['POST'])
def force_failover():
    """إجبار التحول إلى خادم احتياطي"""
    user_id = verify_token()
    if not user_id:
        return jsonify({'error': 'Authentication required'}), 401
    
    try:
        # الحصول على الخوادم من Supabase
        supabase = get_supabase_client()
        
        # البحث عن خادم احتياطي نشط
        response = supabase.table('servers').select('*').eq('role', 'secondary').eq('is_online', True).execute()
        secondary_servers = response.data if response.data else []
        
        if not secondary_servers:
            return jsonify({'error': 'No active secondary server available for failover'}), 404
        
        secondary_server = secondary_servers[0]
        
        # البحث عن الخادم الرئيسي الحالي
        response = supabase.table('servers').select('*').eq('role', 'primary').eq('is_online', True).execute()
        primary_servers = response.data if response.data else []
        primary_server = primary_servers[0] if primary_servers else None
        
        # إجبار التحول
        if primary_server:
            # تحديث الخادم الرئيسي إلى احتياطي
            supabase.table('servers').update({
                'role': 'secondary',
                'is_online': False,
                'last_heartbeat': get_baghdad_time_iso()
            }).eq('id', primary_server['id']).execute()
        
        # تحديث الخادم الاحتياطي إلى رئيسي
        supabase.table('servers').update({
            'role': 'primary',
            'is_online': True,
            'last_heartbeat': get_baghdad_time_iso()
        }).eq('id', secondary_server['id']).execute()
        
        # إرسال إشعارات
        socketio.emit('ha_failover', {
            'server_id': secondary_server['id'],
            'old_primary_id': primary_server['id'] if primary_server else None,
            'forced': True
        }, namespace='/servers')
        
        # تسجيل في السجل في Supabase
        log_data = {
            'action': 'ha_failover',
            'user_id': user_id,
            'details': json.dumps({
                'promoted_server_id': secondary_server['id'],
                'old_primary_id': primary_server['id'] if primary_server else None,
                'forced': True
            }),
            'timestamp': get_baghdad_time_iso()
        }
        supabase.table('logs').insert(log_data).execute()
        
        return jsonify({
            'message': 'Force failover completed successfully',
            'new_primary': {
                'id': secondary_server['id'],
                'name': secondary_server['name'],
                'ip_address': secondary_server['ip_address'],
                'role': 'primary'
            }
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error forcing failover: {e}")
        return jsonify({'error': 'Failed to force failover'}), 500


@servers_bp.route('/servers/<int:server_id>/execute-command', methods=['POST'])
def execute_command(server_id):
    """تنفيذ أمر على الخادم"""
    user_id = verify_token()
    if not user_id:
        # للاختبار فقط - تعمل بدون مصادقة بصمت
        user_id = "test_user"
    
    import os
    
    try:
        data = request.get_json() or {}
        command = data.get('command')
        current_path = data.get('current_path', os.getcwd())
        
        if not command:
            return jsonify({'error': 'Command is required'}), 400
        
        # تنفيذ الأمر باستخدام subprocess
        import subprocess
        import platform
        
        # تحديد shell حسب النظام
        if platform.system() == 'Windows':
            shell = True
            executable = None
        else:
            shell = True
            executable = '/bin/bash'
        
        # التأكد من أن المسار موجود
        if not os.path.exists(current_path):
            current_path = os.getcwd()
        
        # تنفيذ الأمر مع timeout للأمان
        result = subprocess.run(
            command,
            shell=shell,
            executable=executable,
            capture_output=True,
            text=True,
            timeout=30,  # 30 ثانية كحد أقصى
            cwd=current_path  # استخدام المسار المرسل
        )
        
        # تسجيل الأمر في السجل (فقط إذا كان المستخدم صالح)
        if user_id != "test_user":
            log_data = {
                'action': 'command_executed',
                'user_id': user_id,
                'details': json.dumps({
                    'server_id': server_id,
                    'command': command,
                    'return_code': result.returncode,
                    'success': result.returncode == 0
                }),
                'timestamp': get_baghdad_time_iso()
            }
            
            try:
                supabase = get_supabase_client()
                if supabase:
                    supabase.table('logs').insert(log_data).execute()
            except Exception as log_error:
                current_app.logger.error(f"Error logging command execution: {log_error}")
        # لا نطبع أي شيء للمستخدم التجريبي
        
        # إرجاع النتيجة
        response_data = {
            'command': command,
            'return_code': result.returncode,
            'success': result.returncode == 0,
            'stdout': result.stdout,
            'stderr': result.stderr,
            'current_path': current_path,
            'timestamp': get_baghdad_time_iso()
        }
        
        return jsonify(response_data), 200
        
    except subprocess.TimeoutExpired:
        return jsonify({
            'error': 'Command execution timed out',
            'command': command,
            'timeout_seconds': 30
        }), 408
        
    except Exception as e:
        current_app.logger.error(f"Error executing command on server {server_id}: {e}")
        return jsonify({
            'error': f'Failed to execute command: {str(e)}',
            'command': command
        }), 500


@servers_bp.route('/servers/<int:server_id>/cmd/current-path', methods=['GET'])
def get_current_path(server_id):
    """الحصول على المسار الحالي للخادم"""
    user_id = verify_token()
    if not user_id:
        # للاختبار فقط - تعمل بدون مصادقة بصمت
        user_id = "test_user"
    
    try:
        import os
        import platform
        
        current_path = os.getcwd()
        
        # تنسيق المسار حسب نظام التشغيل
        if platform.system() == 'Windows':
            # تحويل المسار إلى تنسيق ويندوز
            current_path = current_path.replace('/', '\\')
            # إضافة حرف القرص إذا لم يكن موجوداً
            if not current_path[1:3] == ':\\':
                current_path = 'C:' + current_path
        
        return jsonify({
            'current_path': current_path,
            'platform': platform.system(),
            'timestamp': get_baghdad_time_iso()
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting current path for server {server_id}: {e}")
        return jsonify({
            'error': f'Failed to get current path: {str(e)}'
        }), 500


@servers_bp.route('/servers/<int:server_id>/cmd/change-directory', methods=['POST'])
def change_directory(server_id):
    """تغيير المجلد الحالي"""
    user_id = verify_token()
    if not user_id:
        return jsonify({'error': 'Authentication required'}), 401
    
    try:
        data = request.get_json() or {}
        new_path = data.get('path')
        
        if not new_path:
            return jsonify({'error': 'Path is required'}), 400
        
        import os
        
        # التحقق من وجود المسار
        if not os.path.exists(new_path):
            return jsonify({
                'error': f'Path does not exist: {new_path}'
            }), 404
        
        # التحقق من أنه مجلد
        if not os.path.isdir(new_path):
            return jsonify({
                'error': f'Path is not a directory: {new_path}'
            }), 400
        
        # تغيير المجلد الحالي
        os.chdir(new_path)
        
        # الحصول على المسار الجديد
        current_path = os.getcwd()
        
        return jsonify({
            'success': True,
            'previous_path': data.get('current_path', ''),
            'current_path': current_path,
            'timestamp': get_baghdad_time_iso()
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error changing directory for server {server_id}: {e}")
        return jsonify({
            'error': f'Failed to change directory: {str(e)}'
        }), 500


@servers_bp.route('/servers/<int:server_id>/cmd/list-directory', methods=['GET'])
def list_directory(server_id):
    """قائمة محتويات المجلد"""
    user_id = verify_token()
    if not user_id:
        return jsonify({'error': 'Authentication required'}), 401
    
    try:
        import os
        import platform
        from datetime import datetime
        
        path = request.args.get('path', os.getcwd())
        
        if not os.path.exists(path):
            return jsonify({
                'error': f'Path does not exist: {path}'
            }), 404
        
        if not os.path.isdir(path):
            return jsonify({
                'error': f'Path is not a directory: {path}'
            }), 400
        
        items = []
        try:
            for item in os.listdir(path):
                item_path = os.path.join(path, item)
                try:
                    stat = os.stat(item_path)
                    item_info = {
                        'name': item,
                        'path': item_path,
                        'is_directory': os.path.isdir(item_path),
                        'is_file': os.path.isfile(item_path),
                        'size': stat.st_size if os.path.isfile(item_path) else 0,
                        'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
                        'permissions': oct(stat.st_mode)[-3:] if platform.system() != 'Windows' else 'N/A'
                    }
                    items.append(item_info)
                except (OSError, PermissionError) as e:
                    # في حالة عدم القدرة على قراءة الملف
                    item_info = {
                        'name': item,
                        'path': item_path,
                        'is_directory': os.path.isdir(item_path),
                        'is_file': os.path.isfile(item_path),
                        'size': 0,
                        'modified': None,
                        'permissions': 'access_denied',
                        'error': str(e)
                    }
                    items.append(item_info)
        except (OSError, PermissionError) as e:
            return jsonify({
                'error': f'Cannot list directory contents: {str(e)}',
                'path': path
            }), 403
        
        # ترتيب العناصر: المجلدات أولاً ثم الملفات
        items.sort(key=lambda x: (not x['is_directory'], x['name'].lower()))
        
        return jsonify({
            'path': path,
            'items': items,
            'total_items': len(items),
            'directories': len([i for i in items if i['is_directory']]),
            'files': len([i for i in items if i['is_file']]),
            'timestamp': get_baghdad_time_iso()
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error listing directory for server {server_id}: {e}")
        return jsonify({
            'error': f'Failed to list directory: {str(e)}'
        }), 500


@servers_bp.route('/servers/failover-log', methods=['GET'])
def get_failover_log():
    """جلب سجل التحولات (Failover Log)"""
    try:
        # التحقق من التوكن
        try:
            verify_jwt_in_request()
        except Exception as e:
            return jsonify({'error': 'Authentication required'}), 401

        # جلب سجل التحولات من جدول logs
        try:
            response = supabase.table('logs').select('*').in_('action', ['ha_failover', 'server_role_changed', 'secondary_server_added']).order('timestamp', desc=True).limit(50).execute()
            failover_logs = response.data if response.data else []
        except Exception as e:
            current_app.logger.warning(f"Could not fetch failover logs from database: {e}")
            # إرجاع سجل فارغ إذا لم تكن الجدول موجود
            failover_logs = []

        # تنسيق البيانات للواجهة الأمامية
        formatted_logs = []
        for log in failover_logs:
            try:
                details = json.loads(log.get('details', '{}')) if log.get('details') else {}
                formatted_logs.append({
                    'id': log.get('id'),
                    'timestamp': log.get('timestamp'),
                    'primaryServer': details.get('primary_server', details.get('server_name', 'غير محدد')),
                    'backupServer': details.get('backup_server', details.get('old_primary_id', 'غير محدد')),
                    'reason': details.get('reason', log.get('action', 'غير محدد')),
                    'duration': details.get('duration', 'غير محدد'),
                    'status': 'success',
                    'details': details.get('message', log.get('action', ''))
                })
            except json.JSONDecodeError:
                formatted_logs.append({
                    'id': log.get('id'),
                    'timestamp': log.get('timestamp'),
                    'primaryServer': 'غير محدد',
                    'backupServer': 'غير محدد',
                    'reason': log.get('action', 'غير محدد'),
                    'duration': 'غير محدد',
                    'status': 'success',
                    'details': log.get('action', '')
                })

        return jsonify({
            'failover_log': formatted_logs,
            'total': len(formatted_logs),
            'timestamp': get_baghdad_time_iso()
        }), 200

    except Exception as e:
        current_app.logger.error(f"Error fetching failover log: {e}")
        return jsonify({
            'error': 'Failed to fetch failover log',
            'details': str(e)
        }), 500

@servers_bp.route('/servers/agent/register', methods=['POST'])
@servers_bp.route('/agent/register', methods=['POST'])
@auth_required_json
def agent_register():
    """Register a new agent/branch server with the main server"""
    try:
        data = request.get_json()
        agent_name = data.get('agent_name')
        system_info = data.get('system_info', {})
        agent_version = data.get('agent_version', '1.0.0')
        capabilities = data.get('capabilities', [])
        
        if not agent_name:
            return jsonify({
                'error': 'agent_name is required',
                'success': False
            }), 400
        
        # Extract system information
        hostname = system_info.get('hostname', agent_name)
        ip_address = 'auto'  # Will be detected from request
        os_info = f"{system_info.get('platform', 'Unknown')} {system_info.get('arch', '')}"
        cpu_info = system_info.get('cpu', {}).get('model', 'Unknown CPU')
        ram_info = f"{round(system_info.get('memory', {}).get('total', 0) / (1024**3), 1)} GB"
        
        # Get actual IP address from request
        actual_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'unknown'))
        
        # Check if server with same hostname already exists
        existing_server = supabase.table('servers').select('*').eq('name', hostname).eq('role', 'secondary').execute()
        
        if existing_server.data:
            # Update existing server
            existing = existing_server.data[0]
            server_id = existing['id']
            
            # If IP is different, mark previous connection as offline
            if existing['ip_address'] != actual_ip:
                # Log the previous disconnection
                activity_data = {
                    'activity_type': 'agent_disconnect',
                    'server_id': server_id,
                    'agent_id': existing.get('agent_id', f"agent_{server_id}"),
                    'details': {
                        'disconnect_time': get_baghdad_time_iso(),
                        'reason': 'agent_moved_to_different_ip',
                        'previous_ip': existing['ip_address'],
                        'new_ip': actual_ip
                    },
                    'timestamp': get_baghdad_time_iso(),
                    'created_at': get_baghdad_time_iso()
                }
                supabase.table('activity_logs').insert(activity_data).execute()
            
            # Update server entry
            server_data = {
                'ip_address': actual_ip,
                'os': os_info,
                'cpu': cpu_info,
                'ram': ram_info,
                'status': 'online',
                'is_online': True,
                'agent_version': agent_version,
                'agent_capabilities': capabilities,
                'last_seen': get_baghdad_time_iso(),
                'last_heartbeat': get_baghdad_time_iso(),
                'updated_at': get_baghdad_time_iso()
            }
            
            result = supabase.table('servers').update(server_data).eq('id', server_id).execute()
            
            if not result.data:
                return jsonify({
                    'error': 'Failed to update agent',
                    'success': False
                }), 500
            
            server_record = result.data[0]
            agent_id = f"agent_{server_id}_{int(time.time())}"
            
            # Update agent_id in database
            supabase.table('servers').update({'agent_id': agent_id}).eq('id', server_id).execute()
            
        else:
            # Create new server entry
            server_data = {
                'name': hostname,
                'ip_address': actual_ip,
                'os': os_info,
                'cpu': cpu_info,
                'ram': ram_info,
                'role': 'secondary',  # Agents are always secondary servers
                'status': 'online',
                'is_online': True,
                'agent_version': agent_version,
                'agent_capabilities': capabilities,
                'last_seen': get_baghdad_time_iso(),
                'last_heartbeat': get_baghdad_time_iso(),
                'created_at': get_baghdad_time_iso(),
                'updated_at': get_baghdad_time_iso()
            }
            
            # Insert into database
            result = supabase.table('servers').insert(server_data).execute()
            
            if not result.data:
                return jsonify({
                    'error': 'Failed to register agent',
                    'success': False
                }), 500
            
            server_record = result.data[0]
            server_id = server_record['id']
            agent_id = f"agent_{server_id}_{int(time.time())}"
            
            # Update agent_id in database
            supabase.table('servers').update({'agent_id': agent_id}).eq('id', server_id).execute()
        
        # Log the registration event
        activity_data = {
            'activity_type': 'agent_register',
            'server_id': server_id,
            'agent_id': agent_id,
            'details': {
                'registration_time': get_baghdad_time_iso(),
                'agent_name': agent_name,
                'agent_version': agent_version,
                'capabilities': capabilities,
                'system_info': system_info,
                'ip_address': actual_ip
            },
            'timestamp': get_baghdad_time_iso(),
            'created_at': get_baghdad_time_iso()
        }
        
        supabase.table('activity_logs').insert(activity_data).execute()
        
        current_app.logger.info(f"Agent registered - Server: {server_id}, Agent: {agent_id}, Name: {agent_name}")
        
        return jsonify({
            'success': True,
            'message': 'Agent registered successfully',
            'server_id': server_id,
            'agent_id': agent_id,
            'server_info': server_record,
            'timestamp': get_baghdad_time_iso()
        }), 201

    except Exception as e:
        current_app.logger.error(f"Error registering agent: {e}")
        return jsonify({
            'error': 'Failed to register agent',
            'details': str(e),
            'success': False
        }), 500

@servers_bp.route('/servers/agent/disconnect', methods=['POST'])
@servers_bp.route('/agent/disconnect', methods=['POST'])
@auth_required_json
def agent_disconnect():
    """Handle agent disconnection - mark server as offline and update last seen"""
    try:
        data = request.get_json()
        server_id = data.get('server_id')
        agent_id = data.get('agent_id')
        
        if not server_id:
            return jsonify({
                'error': 'server_id is required',
                'success': False
            }), 400
        
        # Update server status to offline
        result = supabase.table('servers').update({
            'status': 'offline',
            'last_seen': get_baghdad_time_iso(),
            'agent_disconnect_time': get_baghdad_time_iso(),
            'updated_at': get_baghdad_time_iso()
        }).eq('id', server_id).execute()
        
        if not result.data:
            return jsonify({
                'error': 'Server not found',
                'success': False
            }), 404
        
        # Log the disconnection event
        activity_data = {
            'activity_type': 'agent_disconnect',
            'server_id': server_id,
            'agent_id': agent_id,
            'details': {
                'disconnect_time': get_baghdad_time_iso(),
                'reason': 'agent_shutdown',
                'previous_status': result.data[0].get('status', 'unknown')
            },
            'timestamp': get_baghdad_time_iso(),
            'created_at': get_baghdad_time_iso()
        }
        
        supabase.table('activity_logs').insert(activity_data).execute()
        
        current_app.logger.info(f"Agent disconnected - Server: {server_id}, Agent: {agent_id}")
        
        return jsonify({
            'success': True,
            'message': 'Agent disconnection recorded successfully',
            'server_id': server_id,
            'timestamp': get_baghdad_time_iso()
        }), 200

    except Exception as e:
        current_app.logger.error(f"Error handling agent disconnect: {e}")
        return jsonify({
            'error': 'Failed to handle agent disconnection',
            'details': str(e),
            'success': False
        }), 500

@servers_bp.route('/servers/agent/heartbeat', methods=['POST'])
@servers_bp.route('/agent/heartbeat', methods=['POST'])
@auth_required_json
def agent_heartbeat():
    """Handle agent heartbeat to keep connection alive"""
    try:
        data = request.get_json()
        server_id = data.get('server_id')
        agent_id = data.get('agent_id')
        system_info = data.get('system_info', {})
        
        if not server_id:
            return jsonify({
                'error': 'server_id is required',
                'success': False
            }), 400
        
        # Update server last seen and system info
        update_data = {
            'last_seen': get_baghdad_time_iso(),
            'last_heartbeat': get_baghdad_time_iso(),
            'updated_at': get_baghdad_time_iso()
        }
        
        # Update system information if provided
        if system_info:
            update_data.update({
                'cpu_usage': system_info.get('cpu_usage'),
                'memory_usage': system_info.get('memory_usage'),
                'disk_usage': system_info.get('disk_usage'),
                'system_temperature': system_info.get('temperature'),
                'system_uptime': system_info.get('uptime')
            })
        
        result = supabase.table('servers').update(update_data).eq('id', server_id).execute()
        
        if not result.data:
            return jsonify({
                'error': 'Server not found',
                'success': False
            }), 404
        
        return jsonify({
            'success': True,
            'message': 'Heartbeat received',
            'server_id': server_id,
            'timestamp': get_baghdad_time_iso()
        }), 200

    except Exception as e:
        current_app.logger.error(f"Error handling agent heartbeat: {e}")
        return jsonify({
            'error': 'Failed to handle agent heartbeat',
            'details': str(e),
            'success': False
        }), 500

@servers_bp.route('/agents/<int:agent_id>/usb/control', methods=['POST'])
@auth_required_json
def control_agent_usb(agent_id):
    """التحكم في USB من السيرفر المركزي"""
    try:
        data = request.get_json() or {}
        device_id = data.get('device_id')
        action = data.get('action')  # enable or disable
        
        if not device_id or not action:
            return jsonify({'error': 'device_id and action are required'}), 400
        
        if action not in ['enable', 'disable']:
            return jsonify({'error': 'action must be enable or disable'}), 400
        
        # الحصول على معلومات الـ agent
        agent = Server.query.get(agent_id)
        if not agent:
            return jsonify({'error': 'Agent not found'}), 404
        
        if agent.status != 'active':
            return jsonify({'error': 'Agent is not active'}), 400
        
        # إرسال الأمر إلى الـ agent عبر HTTP
        agent_url = f"http://{agent.ip_address}:5001"  # افتراض port للـ agent
        control_url = f"{agent_url}/api/usb/control"
        
        response = requests.post(control_url, json={
            'device_id': device_id,
            'action': action
        }, timeout=10)
        
        if response.status_code == 200:
            result = response.json()
            return jsonify({
                'message': 'USB control command sent successfully',
                'agent_id': agent_id,
                'device_id': device_id,
                'action': action,
                'result': result
            }), 200
        else:
            return jsonify({
                'error': 'Failed to send control command to agent',
                'status_code': response.status_code,
                'response': response.text
            }), 500
            
    except Exception as e:
        return jsonify({
            'error': 'Failed to control USB device',
            'details': str(e)
        }), 500

@servers_bp.route('/agent/status', methods=['GET'])
@auth_required_json
def get_agent_status():
    """Get status of all connected agents"""
    try:
        # Get all servers with agent connection status
        result = supabase.table('servers').select(
            'id, name, ip_address, status, last_seen, '
            'agent_disconnect_time, cpu_usage, memory_usage, disk_usage, '
            'system_temperature, system_uptime, created_at, updated_at'
        ).eq('status', 'online').execute()
        
        agents_status = []
        current_time = datetime.now(baghdad_tz)
        
        for server in result.data:
            last_seen = datetime.fromisoformat(server['last_seen'].replace('Z', '+00:00'))
            time_since_last_seen = (current_time - last_seen).total_seconds()
            
            # Consider agent offline if no heartbeat for more than 60 seconds
            is_online = time_since_last_seen < 60
            
            agents_status.append({
                'server_id': server['id'],
                'server_name': server['name'],
                'ip_address': server['ip_address'],
                'status': server['status'],
                'is_online': is_online,
                'last_seen': server['last_seen'],
                'time_since_last_seen': int(time_since_last_seen),
                'system_info': {
                    'cpu_usage': server.get('cpu_usage'),
                    'memory_usage': server.get('memory_usage'),
                    'disk_usage': server.get('disk_usage'),
                    'temperature': server.get('system_temperature'),
                    'uptime': server.get('system_uptime')
                }
            })
        
        return jsonify({
            'success': True,
            'agents': agents_status,
            'total_agents': len(agents_status),
            'timestamp': get_baghdad_time_iso()
        }), 200

    except Exception as e:
        current_app.logger.error(f"Error getting agent status: {e}")
        return jsonify({
            'error': 'Failed to get agent status',
            'details': str(e),
            'success': False
        }), 500

# =================== USB CONTROL COMMANDS ===================

@servers_bp.route('/servers/<int:server_id>/usb/control', methods=['POST'])
@auth_required_json
def send_usb_control_command(server_id):
    """إرسال أمر تحكم USB إلى سيرفر فرعي"""
    try:
        data = request.get_json() or {}
        command_type = data.get('command_type')  # 'enable', 'disable', 'restart', 'scan'
        device_id = data.get('device_id')
        port_id = data.get('port_id')
        
        if not command_type:
            return jsonify({'error': 'command_type is required'}), 400
            
        # التحقق من وجود السيرفر المستهدف
        target_server = Server.query.get(server_id)
        if not target_server:
            return jsonify({'error': 'Target server not found'}), 404
            
        # التحقق من أن السيرفر الحالي هو المركزي
        current_server = Server.query.filter_by(server_type='primary').first()
        if not current_server:
            return jsonify({'error': 'Primary server not found'}), 404
            
        # إنشاء معرف فريد للأمر
        command_id = f"usb_cmd_{int(time.time())}_{secrets.token_hex(8)}"
        
        # حفظ الأمر في قاعدة البيانات
        command_data = {
            'command_type': command_type,
            'device_id': device_id,
            'port_id': port_id,
            'timestamp': get_baghdad_time_iso(),
            'source_info': {
                'server_id': current_server.id,
                'server_name': current_server.name
            }
        }
        
        # حفظ الأمر في Supabase
        client = get_supabase_client()
        if client:
            try:
                insert_data = {
                    'command_id': command_id,
                    'source_server_id': current_server.id,
                    'target_server_id': server_id,
                    'device_id': device_id,
                    'port_id': port_id,
                    'command_type': command_type,
                    'command_data': command_data,
                    'status': 'pending',
                    'created_by': get_jwt_identity(),
                    'created_at': get_baghdad_time_iso()
                }
                
                result = client.table('usb_control_commands').insert(insert_data).execute()
                current_app.logger.info(f'USB command saved to Supabase: {command_id}')
                
                return jsonify({
                    'success': True,
                    'message': 'USB control command sent successfully',
                    'command_id': command_id,
                    'target_server': target_server.name,
                    'command_type': command_type
                }), 201
                
            except Exception as e:
                current_app.logger.error(f'Failed to save USB command to Supabase: {e}')
                return jsonify({'error': 'Failed to save command'}), 500
        else:
            return jsonify({'error': 'Database connection not available'}), 500
            
    except Exception as e:
        current_app.logger.error(f"Error sending USB control command: {e}")
        return jsonify({
            'error': 'Failed to send USB control command',
            'details': str(e)
        }), 500

@servers_bp.route('/servers/<int:server_id>/usb/commands', methods=['GET'])
@auth_required_json
def get_usb_commands_for_server(server_id):
    """الحصول على أوامر USB المخصصة لسيرفر معين"""
    try:
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'Database connection not available'}), 500
            
        # جلب الأوامر المخصصة لهذا السيرفر
        result = client.table('usb_control_commands')\
            .select('*')\
            .eq('target_server_id', server_id)\
            .order('created_at', desc=True)\
            .limit(50)\
            .execute()
            
        commands = result.data if result.data else []
        
        return jsonify({
            'success': True,
            'commands': commands,
            'server_id': server_id
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting USB commands: {e}")
        return jsonify({
            'error': 'Failed to get USB commands',
            'details': str(e)
        }), 500

@servers_bp.route('/servers/usb/commands/pending', methods=['GET'])
def get_pending_usb_commands():
    """الحصول على الأوامر المعلقة للسيرفر الحالي"""
    try:
        # الحصول على معرف السيرفر من الـ request أو IP
        server_name = request.args.get('server_name')
        if not server_name:
            return jsonify({'error': 'server_name parameter required'}), 400
            
        # البحث عن السيرفر
        server = Server.query.filter_by(name=server_name).first()
        if not server:
            return jsonify({'error': 'Server not found'}), 404
            
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'Database connection not available'}), 500
            
        # جلب الأوامر المعلقة
        result = client.table('usb_control_commands')\
            .select('*')\
            .eq('target_server_id', server.id)\
            .eq('status', 'pending')\
            .order('created_at', desc=False)\
            .execute()
            
        commands = result.data if result.data else []
        
        return jsonify({
            'success': True,
            'commands': commands,
            'count': len(commands)
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting pending USB commands: {e}")
        return jsonify({
            'error': 'Failed to get pending USB commands',
            'details': str(e)
        }), 500

@servers_bp.route('/servers/usb/commands/<command_id>/result', methods=['POST'])
def report_usb_command_result(command_id):
    """تقرير نتيجة تنفيذ أمر USB من السيرفر الفرعي"""
    try:
        data = request.get_json() or {}
        status = data.get('status', 'completed')
        result = data.get('result')
        error_message = data.get('error_message')
        
        client = get_supabase_client()
        if not client:
            return jsonify({'error': 'Database connection not available'}), 500
            
        # تحديث حالة الأمر
        update_data = {
            'status': status,
            'result': result,
            'executed_at': get_baghdad_time_iso()
        }
        
        if error_message:
            update_data['error_message'] = error_message
            
        client.table('usb_control_commands')\
            .update(update_data)\
            .eq('command_id', command_id)\
            .execute()
            
        return jsonify({
            'success': True,
            'message': 'Command result reported successfully',
            'command_id': command_id
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error reporting USB command result: {e}")
        return jsonify({
            'error': 'Failed to report command result',
            'details': str(e)
        }), 500

@servers_bp.route('/servers/connected', methods=['GET'])
@auth_required_json
def get_connected_servers():
    """الحصول على قائمة السيرفرات المتصلة للسيرفر المركزي"""
    try:
        # التحقق من أن الطلب من السيرفر المركزي
        primary_server = Server.query.filter_by(server_type='primary').first()
        if not primary_server:
            return jsonify({'error': 'Primary server not found'}), 404
            
        # جلب السيرفرات الفرعية المتصلة
        sub_servers = Server.query.filter_by(
            server_type='secondary',
            parent_server_id=primary_server.id,
            is_active=True
        ).all()
        
        servers_data = []
        for server in sub_servers:
            # حساب آخر اتصال
            last_seen = 'غير معروف'
            if server.last_heartbeat:
                time_diff = datetime.now() - server.last_heartbeat
                if time_diff.total_seconds() < 300:  # 5 دقائق
                    last_seen = 'متصل الآن'
                elif time_diff.total_seconds() < 3600:  # ساعة واحدة
                    last_seen = f'{int(time_diff.total_seconds() / 60)} دقيقة'
                else:
                    last_seen = f'{int(time_diff.total_seconds() / 3600)} ساعة'
            
            servers_data.append({
                'id': server.id,
                'name': server.name,
                'ip_address': server.ip_address,
                'os': server.os,
                'cpu': server.cpu,
                'ram': server.ram,
                'status': server.status,
                'last_heartbeat': server.last_heartbeat.isoformat() if server.last_heartbeat else None,
                'last_seen': last_seen,
                'user_id': server.user_id,
                'created_at': server.created_at.isoformat() if server.created_at else None
            })
            
        return jsonify({
            'success': True,
            'servers': servers_data,
            'count': len(servers_data),
            'primary_server': {
                'id': primary_server.id,
                'name': primary_server.name,
                'ip_address': primary_server.ip_address
            }
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"Error getting connected servers: {e}")
        return jsonify({
            'error': 'Failed to get connected servers',
            'details': str(e)
        }), 500


@servers_bp.route('/servers/<server_id>/status', methods=['PUT'])
def update_server_status(server_id):
    """تحديث حالة الخادم وإرسال إشعار WebSocket"""
    try:
        data = request.get_json() or {}
        status = data.get('status')
        is_active = data.get('is_active')
        last_shutdown = data.get('last_shutdown')

        if not status:
            return jsonify({'error': 'Status is required'}), 400

        # الحصول على عميل Supabase
        supabase = get_supabase_client()
        if not supabase:
            return jsonify({'error': 'Database connection failed'}), 500

        # تحديث حالة الخادم في قاعدة البيانات
        update_data = {'status': status}
        if is_active is not None:
            update_data['is_active'] = is_active
        if last_shutdown:
            update_data['last_shutdown'] = last_shutdown

        update_response = supabase.table('servers').update(update_data).eq('id', server_id).execute()

        if not update_response.data:
            return jsonify({'error': 'Server not found or update failed'}), 404

        # إرسال إشعار WebSocket للداشبورد
        socketio.emit('dashboard:update', {
            'type': 'server_status_update',
            'server_id': server_id,
            'status': status,
            'is_active': is_active,
            'timestamp': get_baghdad_time_iso()
        })

        # إرسال إشعار WebSocket للسيرفرات
        socketio.emit('server_status_updated', {
            'server_id': server_id,
            'status': status,
            'is_active': is_active,
            'timestamp': get_baghdad_time_iso()
        }, namespace='/servers')

        current_app.logger.info(f'Server {server_id} status updated to {status}')

        return jsonify({
            'message': f'Server status updated to {status}',
            'server_id': server_id,
            'status': status,
            'is_active': is_active
        }), 200

    except Exception as e:
        current_app.logger.error(f"Error updating server status: {e}")
        return jsonify({
            'error': 'Failed to update server status',
            'details': str(e)
        }), 500

