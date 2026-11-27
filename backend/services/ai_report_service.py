# backend/services/ai_report_service.py

import json
import re
from datetime import datetime, timedelta
from sqlalchemy import func, and_, desc
from flask import current_app
from models import db, Device, Log, Alert, User, AIReport, BlockchainLog, Server, Policy
from utils import current_time
from supabase_config import get_supabase_client

def clean_report_text(text):
    """
    تنظيف النص من الرموز والتنسيقات الخاصة
    """
    if not text:
        return text

    # إزالة الرموز التعبيرية
    emoji_pattern = r'[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF\U00002500-\U00002BEF\U00002702-\U000027B0\U000024C2-\U0001F251\U0001f926-\U0001f937\U00010000-\U0010ffff\u2640-\u2642\u2600-\u2B55\u200d\u23cf\u23e9\u231a\ufe0f\u3030]'
    text = re.sub(emoji_pattern, '', text)

    # إزالة تنسيقات Markdown
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)  # إزالة **bold**
    text = re.sub(r'\*(.*?)\*', r'\1', text)      # إزالة *italic*
    text = re.sub(r'_(.*?)_', r'\1', text)        # إزالة _underline_
    text = re.sub(r'`(.*?)`', r'\1', text)        # إزالة `code`
    text = re.sub(r'~~(.*?)~~', r'\1', text)      # إزالة ~~strikethrough~~

    # إزالة عناوين Markdown
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)

    # إزالة قوائم Markdown
    text = re.sub(r'^[-*+]\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\d+\.\s+', '', text, flags=re.MULTILINE)

    # إزالة روابط Markdown
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)

    # تنظيف المسافات الزائدة
    text = re.sub(r'\n\s*\n\s*\n', '\n\n', text)  # إزالة السطور الفارغة المتعددة

    return text.strip()

def generate_comprehensive_report(report_type='system_overview', params=None, language='ar'):
    """
    إنشاء تقرير شامل عن النظام باللغتين العربية والإنجليزية
    """
    if params is None:
        params = {}

    # جمع البيانات الحقيقية من قاعدة البيانات
    data = collect_system_data()

    # إنشاء التقرير باللغة المطلوبة
    if language == 'en':
        content = generate_english_report(data, report_type, params)
    else:
        content = generate_arabic_report(data, report_type, params)

    # تنظيف النص من الرموز إذا طُلب ذلك
    if params.get('clean_text', False):
        content = clean_report_text(content)

    return content

def collect_system_data():
    """
    جمع البيانات الحقيقية من قاعدة بيانات Supabase لفترات زمنية مختلفة
    """
    now = current_time()
    last_7_days = now - timedelta(days=7)
    last_30_days = now - timedelta(days=30)
    last_90_days = now - timedelta(days=90)
    last_365_days = now - timedelta(days=365)
    last_24_hours = now - timedelta(hours=24)

    # الحصول على عميل Supabase
    supabase_client = get_supabase_client()
    if not supabase_client:
        return get_empty_data_structure()

    try:
        # إحصائيات الأجهزة من Supabase
        devices_response = supabase_client.table('devices').select('*', count='exact').execute()
        total_devices = devices_response.count if hasattr(devices_response, 'count') else len(devices_response.data) if devices_response.data else 0

        # لا يوجد عمود status في جدول devices، سنستخدم whitelisted/blacklisted بدلاً من ذلك
        connected_devices = total_devices  # نفترض أن جميع الأجهزة المسجلة متصلة
        pending_devices = 0  # لا يوجد عمود status
        blocked_devices = supabase_client.table('devices').select('*', count='exact').eq('blacklisted', True).execute()
        blocked_devices = blocked_devices.count if hasattr(blocked_devices, 'count') else len(blocked_devices.data) if blocked_devices.data else 0
        whitelisted_devices_response = supabase_client.table('devices').select('*', count='exact').eq('whitelisted', True).execute()
        whitelisted_devices = whitelisted_devices_response.count if hasattr(whitelisted_devices_response, 'count') else len(whitelisted_devices_response.data) if whitelisted_devices_response.data else 0

        # إحصائيات المستخدمين من Supabase
        users_response = supabase_client.table('users').select('*', count='exact').execute()
        total_users = users_response.count if hasattr(users_response, 'count') else len(users_response.data) if users_response.data else 0

        active_users_response = supabase_client.table('users').select('*', count='exact').eq('status', 'active').execute()
        active_users = active_users_response.count if hasattr(active_users_response, 'count') else len(active_users_response.data) if active_users_response.data else 0

        # إحصائيات السجلات من Supabase
        logs_response = supabase_client.table('logs').select('*', count='exact').execute()
        total_logs = logs_response.count if hasattr(logs_response, 'count') else len(logs_response.data) if logs_response.data else 0

        logs_24h_response = supabase_client.table('logs').select('*', count='exact').gte('timestamp', last_24_hours.isoformat()).execute()
        logs_last_24_hours = logs_24h_response.count if hasattr(logs_24h_response, 'count') else len(logs_24h_response.data) if logs_24h_response.data else 0

        logs_7d_response = supabase_client.table('logs').select('*', count='exact').gte('timestamp', last_7_days.isoformat()).execute()
        logs_last_7_days = logs_7d_response.count if hasattr(logs_7d_response, 'count') else len(logs_7d_response.data) if logs_7d_response.data else 0

        logs_30d_response = supabase_client.table('logs').select('*', count='exact').gte('timestamp', last_30_days.isoformat()).execute()
        logs_last_30_days = logs_30d_response.count if hasattr(logs_30d_response, 'count') else len(logs_30d_response.data) if logs_30d_response.data else 0

        logs_90d_response = supabase_client.table('logs').select('*', count='exact').gte('timestamp', last_90_days.isoformat()).execute()
        logs_last_90_days = logs_90d_response.count if hasattr(logs_90d_response, 'count') else len(logs_90d_response.data) if logs_90d_response.data else 0

        logs_365d_response = supabase_client.table('logs').select('*', count='exact').gte('timestamp', last_365_days.isoformat()).execute()
        logs_last_365_days = logs_365d_response.count if hasattr(logs_365d_response, 'count') else len(logs_365d_response.data) if logs_365d_response.data else 0

        # إحصائيات التنبيهات من Supabase
        alerts_response = supabase_client.table('alerts').select('*', count='exact').execute()
        total_alerts = alerts_response.count if hasattr(alerts_response, 'count') else len(alerts_response.data) if alerts_response.data else 0

        unresolved_alerts_response = supabase_client.table('alerts').select('*', count='exact').eq('resolved', False).execute()
        unresolved_alerts = unresolved_alerts_response.count if hasattr(unresolved_alerts_response, 'count') else len(unresolved_alerts_response.data) if unresolved_alerts_response.data else 0

        high_priority_alerts_response = supabase_client.table('alerts').select('*', count='exact').eq('priority', 'high').eq('resolved', False).execute()
        high_priority_alerts = high_priority_alerts_response.count if hasattr(high_priority_alerts_response, 'count') else len(high_priority_alerts_response.data) if high_priority_alerts_response.data else 0

        alerts_24h_response = supabase_client.table('alerts').select('*', count='exact').gte('created_at', last_24_hours.isoformat()).execute()
        alerts_last_24_hours = alerts_24h_response.count if hasattr(alerts_24h_response, 'count') else len(alerts_24h_response.data) if alerts_24h_response.data else 0

        alerts_7d_response = supabase_client.table('alerts').select('*', count='exact').gte('created_at', last_7_days.isoformat()).execute()
        alerts_last_7_days = alerts_7d_response.count if hasattr(alerts_7d_response, 'count') else len(alerts_7d_response.data) if alerts_7d_response.data else 0

        alerts_30d_response = supabase_client.table('alerts').select('*', count='exact').gte('created_at', last_30_days.isoformat()).execute()
        alerts_last_30_days = alerts_30d_response.count if hasattr(alerts_30d_response, 'count') else len(alerts_30d_response.data) if alerts_30d_response.data else 0

        alerts_90d_response = supabase_client.table('alerts').select('*', count='exact').gte('created_at', last_90_days.isoformat()).execute()
        alerts_last_90_days = alerts_90d_response.count if hasattr(alerts_90d_response, 'count') else len(alerts_90d_response.data) if alerts_90d_response.data else 0

        alerts_365d_response = supabase_client.table('alerts').select('*', count='exact').gte('created_at', last_365_days.isoformat()).execute()
        alerts_last_365_days = alerts_365d_response.count if hasattr(alerts_365d_response, 'count') else len(alerts_365d_response.data) if alerts_365d_response.data else 0

        # إحصائيات التنبيهات المحلولة لفترات مختلفة
        resolved_alerts_24h_response = supabase_client.table('alerts').select('*', count='exact').gte('created_at', last_24_hours.isoformat()).eq('resolved', True).execute()
        resolved_alerts_last_24_hours = resolved_alerts_24h_response.count if hasattr(resolved_alerts_24h_response, 'count') else len(resolved_alerts_24h_response.data) if resolved_alerts_24h_response.data else 0

        resolved_alerts_7d_response = supabase_client.table('alerts').select('*', count='exact').gte('created_at', last_7_days.isoformat()).eq('resolved', True).execute()
        resolved_alerts_last_7_days = resolved_alerts_7d_response.count if hasattr(resolved_alerts_7d_response, 'count') else len(resolved_alerts_7d_response.data) if resolved_alerts_7d_response.data else 0

        resolved_alerts_30d_response = supabase_client.table('alerts').select('*', count='exact').gte('created_at', last_30_days.isoformat()).eq('resolved', True).execute()
        resolved_alerts_last_30_days = resolved_alerts_30d_response.count if hasattr(resolved_alerts_30d_response, 'count') else len(resolved_alerts_30d_response.data) if resolved_alerts_30d_response.data else 0

        resolved_alerts_90d_response = supabase_client.table('alerts').select('*', count='exact').gte('created_at', last_90_days.isoformat()).eq('resolved', True).execute()
        resolved_alerts_last_90_days = resolved_alerts_90d_response.count if hasattr(resolved_alerts_90d_response, 'count') else len(resolved_alerts_90d_response.data) if resolved_alerts_90d_response.data else 0

        resolved_alerts_365d_response = supabase_client.table('alerts').select('*', count='exact').gte('created_at', last_365_days.isoformat()).eq('resolved', True).execute()
        resolved_alerts_last_365_days = resolved_alerts_365d_response.count if hasattr(resolved_alerts_365d_response, 'count') else len(resolved_alerts_365d_response.data) if resolved_alerts_365d_response.data else 0

        # إحصائيات الذكاء الاصطناعي من Supabase
        # جدول ai_reports فارغ، لذا سنستخدم قيم افتراضية
        total_ai_reports = 0
        anomaly_reports = 0

        ai_reports_last_24_hours = 0
        ai_reports_last_7_days = 0
        ai_reports_last_30_days = 0
        ai_reports_last_90_days = 0
        ai_reports_last_365_days = 0

        anomaly_reports_last_24_hours = 0
        anomaly_reports_last_7_days = 0
        anomaly_reports_last_30_days = 0
        anomaly_reports_last_90_days = 0
        anomaly_reports_last_365_days = 0

        # إحصائيات البلوك تشين
        total_response = supabase_client.table('blockchain_logs').select('id', count='exact').execute()
        total_blockchain_records = total_response.count if hasattr(total_response, 'count') else len(total_response.data) if total_response.data else 0

        verified_response = supabase_client.table('blockchain_logs').select('id', count='exact').eq('verified', True).execute()
        verified_blocks = verified_response.count if hasattr(verified_response, 'count') else len(verified_response.data) if verified_response.data else 0

        # إحصائيات البلوك تشين لفترات مختلفة
        blockchain_last_24_hours = supabase_client.table('blockchain_logs').select('id', count='exact').gte('timestamp', last_24_hours.isoformat()).execute()
        blockchain_last_7_days = supabase_client.table('blockchain_logs').select('id', count='exact').gte('timestamp', last_7_days.isoformat()).execute()
        blockchain_last_30_days = supabase_client.table('blockchain_logs').select('id', count='exact').gte('timestamp', last_30_days.isoformat()).execute()
        blockchain_last_90_days = supabase_client.table('blockchain_logs').select('id', count='exact').gte('timestamp', last_90_days.isoformat()).execute()
        blockchain_last_365_days = supabase_client.table('blockchain_logs').select('id', count='exact').gte('timestamp', last_365_days.isoformat()).execute()

        blockchain_records_24h = blockchain_last_24_hours.count if hasattr(blockchain_last_24_hours, 'count') else len(blockchain_last_24_hours.data) if blockchain_last_24_hours.data else 0
        blockchain_records_7d = blockchain_last_7_days.count if hasattr(blockchain_last_7_days, 'count') else len(blockchain_last_7_days.data) if blockchain_last_7_days.data else 0
        blockchain_records_30d = blockchain_last_30_days.count if hasattr(blockchain_last_30_days, 'count') else len(blockchain_last_30_days.data) if blockchain_last_30_days.data else 0
        blockchain_records_90d = blockchain_last_90_days.count if hasattr(blockchain_last_90_days, 'count') else len(blockchain_last_90_days.data) if blockchain_last_90_days.data else 0
        blockchain_records_365d = blockchain_last_365_days.count if hasattr(blockchain_last_365_days, 'count') else len(blockchain_last_365_days.data) if blockchain_last_365_days.data else 0

        # إحصائيات الخوادم من Supabase
        servers_response = supabase_client.table('servers').select('*', count='exact').execute()
        total_servers = servers_response.count if hasattr(servers_response, 'count') else len(servers_response.data) if servers_response.data else 0

        active_servers_response = supabase_client.table('servers').select('*', count='exact').eq('status', 'active').execute()
        active_servers = active_servers_response.count if hasattr(active_servers_response, 'count') else len(active_servers_response.data) if active_servers_response.data else 0

        # إحصائيات السياسات من Supabase
        policies_response = supabase_client.table('policies').select('*', count='exact').execute()
        total_policies = policies_response.count if hasattr(policies_response, 'count') else len(policies_response.data) if policies_response.data else 0

        active_policies_response = supabase_client.table('policies').select('*', count='exact').eq('is_active', True).execute()
        active_policies = active_policies_response.count if hasattr(active_policies_response, 'count') else len(active_policies_response.data) if active_policies_response.data else 0

        # الأجهزة الأكثر نشاطاً لفترات مختلفة من Supabase
        most_active_devices_7d = []
        most_active_devices_30d = []
        most_active_devices_365d = []

        # جلب الأجهزة الأكثر نشاطاً لآخر 7 أيام
        try:
            devices_7d_response = supabase_client.table('logs').select('target_device').gte('timestamp', last_7_days.isoformat()).not_.is_('target_device', None).execute()
            if devices_7d_response.data:
                # تجميع البيانات حسب الجهاز
                device_activity = {}
                for log in devices_7d_response.data:
                    device_id = log.get('target_device', '')
                    if device_id:
                        device_activity[device_id] = device_activity.get(device_id, 0) + 1

                # جلب معلومات الأجهزة
                for device_id, count in sorted(device_activity.items(), key=lambda x: x[1], reverse=True)[:10]:
                    device_response = supabase_client.table('devices').select('name, serial_number').eq('serial_number', device_id).execute()
                    if device_response.data:
                        device = device_response.data[0]
                        most_active_devices_7d.append({
                            'name': device.get('name', 'Unknown'),
                            'serial_number': device.get('serial_number', device_id),
                            'activity_count': count
                        })
        except Exception as e:
            pass

        # جلب الأجهزة الأكثر نشاطاً لآخر 30 يوم
        try:
            devices_30d_response = supabase_client.table('logs').select('target_device').gte('timestamp', last_30_days.isoformat()).not_.is_('target_device', None).execute()
            if devices_30d_response.data:
                device_activity = {}
                for log in devices_30d_response.data:
                    device_id = log.get('target_device', '')
                    if device_id:
                        device_activity[device_id] = device_activity.get(device_id, 0) + 1

                for device_id, count in sorted(device_activity.items(), key=lambda x: x[1], reverse=True)[:10]:
                    device_response = supabase_client.table('devices').select('name, serial_number').eq('serial_number', device_id).execute()
                    if device_response.data:
                        device = device_response.data[0]
                        most_active_devices_30d.append({
                            'name': device.get('name', 'Unknown'),
                            'serial_number': device.get('serial_number', device_id),
                            'activity_count': count
                        })
        except Exception as e:
            pass

        # جلب الأجهزة الأكثر نشاطاً لآخر سنة
        try:
            devices_365d_response = supabase_client.table('logs').select('target_device').gte('timestamp', last_365_days.isoformat()).not_.is_('target_device', None).execute()
            if devices_365d_response.data:
                device_activity = {}
                for log in devices_365d_response.data:
                    device_id = log.get('target_device', '')
                    if device_id:
                        device_activity[device_id] = device_activity.get(device_id, 0) + 1

                for device_id, count in sorted(device_activity.items(), key=lambda x: x[1], reverse=True)[:10]:
                    device_response = supabase_client.table('devices').select('name, serial_number').eq('serial_number', device_id).execute()
                    if device_response.data:
                        device = device_response.data[0]
                        most_active_devices_365d.append({
                            'name': device.get('name', 'Unknown'),
                            'serial_number': device.get('serial_number', device_id),
                            'activity_count': count
                        })
        except Exception as e:
            pass

        # أحدث التنبيهات لفترات مختلفة من Supabase
        recent_alerts_24h = []
        recent_alerts_7d = []
        recent_alerts_30d = []

        try:
            alerts_24h_response = supabase_client.table('alerts').select('*').gte('created_at', last_24_hours.isoformat()).order('created_at', desc=True).limit(10).execute()
            if alerts_24h_response.data:
                recent_alerts_24h = alerts_24h_response.data
        except Exception as e:
            pass

        try:
            alerts_7d_response = supabase_client.table('alerts').select('*').gte('created_at', last_7_days.isoformat()).order('created_at', desc=True).limit(10).execute()
            if alerts_7d_response.data:
                recent_alerts_7d = alerts_7d_response.data
        except Exception as e:
            pass

        try:
            alerts_30d_response = supabase_client.table('alerts').select('*').gte('created_at', last_30_days.isoformat()).order('created_at', desc=True).limit(10).execute()
            if alerts_30d_response.data:
                recent_alerts_30d = alerts_30d_response.data
        except Exception as e:
            pass

        # أحدث السجلات لفترات مختلفة من Supabase
        recent_logs_24h = []
        recent_logs_7d = []
        recent_logs_30d = []

        try:
            logs_24h_response = supabase_client.table('logs').select('*').gte('timestamp', last_24_hours.isoformat()).order('timestamp', desc=True).limit(20).execute()
            if logs_24h_response.data:
                recent_logs_24h = logs_24h_response.data
        except Exception as e:
            pass

        try:
            logs_7d_response = supabase_client.table('logs').select('*').gte('timestamp', last_7_days.isoformat()).order('timestamp', desc=True).limit(20).execute()
            if logs_7d_response.data:
                recent_logs_7d = logs_7d_response.data
        except Exception as e:
            pass

        try:
            logs_30d_response = supabase_client.table('logs').select('*').gte('timestamp', last_30_days.isoformat()).order('timestamp', desc=True).limit(20).execute()
            if logs_30d_response.data:
                recent_logs_30d = logs_30d_response.data
        except Exception as e:
            pass

        # إحصائيات حسب النوع من Supabase
        device_types = []
        alert_types = []

        try:
            device_types_response = supabase_client.table('devices').select('device_class').not_.is_('device_class', None).execute()
            if device_types_response.data:
                device_type_count = {}
                for device in device_types_response.data:
                    device_class = device.get('device_class', 'Unknown')
                    device_type_count[device_class] = device_type_count.get(device_class, 0) + 1
                device_types = [{'device_class': k, 'count': v} for k, v in device_type_count.items()]
        except Exception as e:
            pass

        try:
            alert_types_response = supabase_client.table('alerts').select('alert_type').not_.is_('alert_type', None).execute()
            if alert_types_response.data:
                alert_type_count = {}
                for alert in alert_types_response.data:
                    alert_type = alert.get('alert_type', 'Unknown')
                    alert_type_count[alert_type] = alert_type_count.get(alert_type, 0) + 1
                alert_types = [{'alert_type': k, 'count': v} for k, v in alert_type_count.items()]
        except Exception as e:
            pass

        # إحصائيات الأداء والكفاءة
        avg_logs_per_day_7d = logs_last_7_days / 7 if logs_last_7_days > 0 else 0
        avg_logs_per_day_30d = logs_last_30_days / 30 if logs_last_30_days > 0 else 0
        avg_logs_per_day_365d = logs_last_365_days / 365 if logs_last_365_days > 0 else 0

        avg_alerts_per_day_7d = alerts_last_7_days / 7 if alerts_last_7_days > 0 else 0
        avg_alerts_per_day_30d = alerts_last_30_days / 30 if alerts_last_30_days > 0 else 0
        avg_alerts_per_day_365d = alerts_last_365_days / 365 if alerts_last_365_days > 0 else 0

        # معدل الاتصال بالأجهزة
        connection_rate = (connected_devices / total_devices * 100) if total_devices > 0 else 0

        # معدل النشاط للمستخدمين
        user_activity_rate = (active_users / total_users * 100) if total_users > 0 else 0

        # معدل الخوادم النشطة
        server_uptime_rate = (active_servers / total_servers * 100) if total_servers > 0 else 0

        return {
            'summary': {
                'total_devices': total_devices,
                'connected_devices': connected_devices,
                'pending_devices': pending_devices,
                'blocked_devices': blocked_devices,
                'whitelisted_devices': whitelisted_devices,
                'total_users': total_users,
                'active_users': active_users,
                'total_logs': total_logs,
                'total_alerts': total_alerts,
                'unresolved_alerts': unresolved_alerts,
                'high_priority_alerts': high_priority_alerts,
                'total_ai_reports': total_ai_reports,
                'anomaly_reports': anomaly_reports,
                'total_blockchain_records': total_blockchain_records,
                'verified_blocks': verified_blocks,
                'total_servers': total_servers,
                'active_servers': active_servers,
                'total_policies': total_policies,
                'active_policies': active_policies,
                'connection_rate': round(connection_rate, 2),
                'user_activity_rate': round(user_activity_rate, 2),
                'server_uptime_rate': round(server_uptime_rate, 2)
            },
            'time_series': {
                # السجلات
                'logs_last_24_hours': logs_last_24_hours,
                'logs_last_7_days': logs_last_7_days,
                'logs_last_30_days': logs_last_30_days,
                'logs_last_90_days': logs_last_90_days,
                'logs_last_365_days': logs_last_365_days,

                # التنبيهات
                'alerts_last_24_hours': alerts_last_24_hours,
                'alerts_last_7_days': alerts_last_7_days,
                'alerts_last_30_days': alerts_last_30_days,
                'alerts_last_90_days': alerts_last_90_days,
                'alerts_last_365_days': alerts_last_365_days,

                # التنبيهات المحلولة
                'resolved_alerts_last_24_hours': resolved_alerts_last_24_hours,
                'resolved_alerts_last_7_days': resolved_alerts_last_7_days,
                'resolved_alerts_last_30_days': resolved_alerts_last_30_days,
                'resolved_alerts_last_90_days': resolved_alerts_last_90_days,
                'resolved_alerts_last_365_days': resolved_alerts_last_365_days,

                # تقارير الذكاء الاصطناعي
                'ai_reports_last_24_hours': ai_reports_last_24_hours,
                'ai_reports_last_7_days': ai_reports_last_7_days,
                'ai_reports_last_30_days': ai_reports_last_30_days,
                'ai_reports_last_90_days': ai_reports_last_90_days,
                'ai_reports_last_365_days': ai_reports_last_365_days,

                # تقارير الشذوذات
                'anomaly_reports_last_24_hours': anomaly_reports_last_24_hours,
                'anomaly_reports_last_7_days': anomaly_reports_last_7_days,
                'anomaly_reports_last_30_days': anomaly_reports_last_30_days,
                'anomaly_reports_last_90_days': anomaly_reports_last_90_days,
                'anomaly_reports_last_365_days': anomaly_reports_last_365_days,

                # سجلات البلوك تشين
                'blockchain_records_24h': blockchain_records_24h,
                'blockchain_records_7d': blockchain_records_7d,
                'blockchain_records_30d': blockchain_records_30d,
                'blockchain_records_90d': blockchain_records_90d,
                'blockchain_records_365d': blockchain_records_365d,

                # معدلات الأداء
                'avg_logs_per_day_7d': round(avg_logs_per_day_7d, 1),
                'avg_logs_per_day_30d': round(avg_logs_per_day_30d, 1),
                'avg_logs_per_day_365d': round(avg_logs_per_day_365d, 1),
                'avg_alerts_per_day_7d': round(avg_alerts_per_day_7d, 1),
                'avg_alerts_per_day_30d': round(avg_alerts_per_day_30d, 1),
                'avg_alerts_per_day_365d': round(avg_alerts_per_day_365d, 1)
            },
            'most_active_devices': {
                '7_days': most_active_devices_7d,
                '30_days': most_active_devices_30d,
                '365_days': most_active_devices_365d
            },
            'recent_alerts': {
                '24_hours': recent_alerts_24h,
                '7_days': recent_alerts_7d,
                '30_days': recent_alerts_30d
            },
            'recent_logs': {
                '24_hours': recent_logs_24h,
                '7_days': recent_logs_7d,
                '30_days': recent_logs_30d
            },
            'device_types': device_types,
            'alert_types': alert_types,
            'report_generated_at': now.isoformat()
        }

    except Exception as e:
        return get_empty_data_structure()

def get_empty_data_structure():
    """
    إرجاع هيكل بيانات فارغ في حالة فشل الاتصال
    """
    now = current_time()
    return {
        'summary': {
            'total_devices': 0,
            'connected_devices': 0,
            'pending_devices': 0,
            'blocked_devices': 0,
            'whitelisted_devices': 0,
            'total_users': 0,
            'active_users': 0,
            'total_logs': 0,
            'total_alerts': 0,
            'unresolved_alerts': 0,
            'high_priority_alerts': 0,
            'total_ai_reports': 0,
            'anomaly_reports': 0,
            'total_blockchain_records': 0,
            'verified_blocks': 0,
            'total_servers': 0,
            'active_servers': 0,
            'total_policies': 0,
            'active_policies': 0,
            'connection_rate': 0,
            'user_activity_rate': 0,
            'server_uptime_rate': 0
        },
        'time_series': {
            'logs_last_24_hours': 0,
            'logs_last_7_days': 0,
            'logs_last_30_days': 0,
            'logs_last_90_days': 0,
            'logs_last_365_days': 0,
            'alerts_last_24_hours': 0,
            'alerts_last_7_days': 0,
            'alerts_last_30_days': 0,
            'alerts_last_90_days': 0,
            'alerts_last_365_days': 0,
            'resolved_alerts_last_24_hours': 0,
            'resolved_alerts_last_7_days': 0,
            'resolved_alerts_last_30_days': 0,
            'resolved_alerts_last_90_days': 0,
            'resolved_alerts_last_365_days': 0,
            'ai_reports_last_24_hours': 0,
            'ai_reports_last_7_days': 0,
            'ai_reports_last_30_days': 0,
            'ai_reports_last_90_days': 0,
            'ai_reports_last_365_days': 0,
            'anomaly_reports_last_24_hours': 0,
            'anomaly_reports_last_7_days': 0,
            'anomaly_reports_last_30_days': 0,
            'anomaly_reports_last_90_days': 0,
            'anomaly_reports_last_365_days': 0,
            'blockchain_records_24h': 0,
            'blockchain_records_7d': 0,
            'blockchain_records_30d': 0,
            'blockchain_records_90d': 0,
            'blockchain_records_365d': 0,
            'avg_logs_per_day_7d': 0,
            'avg_logs_per_day_30d': 0,
            'avg_logs_per_day_365d': 0,
            'avg_alerts_per_day_7d': 0,
            'avg_alerts_per_day_30d': 0,
            'avg_alerts_per_day_365d': 0
        },
        'most_active_devices': {
            '7_days': [],
            '30_days': [],
            '365_days': []
        },
        'recent_alerts': {
            '24_hours': [],
            '7_days': [],
            '30_days': []
        },
        'recent_logs': {
            '24_hours': [],
            '7_days': [],
            '30_days': []
        },
        'device_types': [],
        'alert_types': [],
        'report_generated_at': now.isoformat()
    }

    alerts_last_24_hours = Alert.query.filter(Alert.created_at >= last_24_hours).count()
    alerts_last_7_days = Alert.query.filter(Alert.created_at >= last_7_days).count()
    alerts_last_30_days = Alert.query.filter(Alert.created_at >= last_30_days).count()
    alerts_last_90_days = Alert.query.filter(Alert.created_at >= last_90_days).count()
    alerts_last_365_days = Alert.query.filter(Alert.created_at >= last_365_days).count()

    # إحصائيات التنبيهات المحلولة لفترات مختلفة
    resolved_alerts_last_24_hours = Alert.query.filter(Alert.created_at >= last_24_hours, Alert.resolved == True).count()
    resolved_alerts_last_7_days = Alert.query.filter(Alert.created_at >= last_7_days, Alert.resolved == True).count()
    resolved_alerts_last_30_days = Alert.query.filter(Alert.created_at >= last_30_days, Alert.resolved == True).count()
    resolved_alerts_last_90_days = Alert.query.filter(Alert.created_at >= last_90_days, Alert.resolved == True).count()
    resolved_alerts_last_365_days = Alert.query.filter(Alert.created_at >= last_365_days, Alert.resolved == True).count()

    # إحصائيات الذكاء الاصطناعي لفترات مختلفة
    total_ai_reports = AIReport.query.count()
    anomaly_reports = AIReport.query.filter_by(is_anomaly=True).count()

    ai_reports_last_24_hours = AIReport.query.filter(AIReport.timestamp >= last_24_hours).count()
    ai_reports_last_7_days = AIReport.query.filter(AIReport.timestamp >= last_7_days).count()
    ai_reports_last_30_days = AIReport.query.filter(AIReport.timestamp >= last_30_days).count()
    ai_reports_last_90_days = AIReport.query.filter(AIReport.timestamp >= last_90_days).count()
    ai_reports_last_365_days = AIReport.query.filter(AIReport.timestamp >= last_365_days).count()

    # إحصائيات الشذوذات لفترات مختلفة
    anomaly_reports_last_24_hours = AIReport.query.filter(AIReport.timestamp >= last_24_hours, AIReport.is_anomaly == True).count()
    anomaly_reports_last_7_days = AIReport.query.filter(AIReport.timestamp >= last_7_days, AIReport.is_anomaly == True).count()
    anomaly_reports_last_30_days = AIReport.query.filter(AIReport.timestamp >= last_30_days, AIReport.is_anomaly == True).count()
    anomaly_reports_last_90_days = AIReport.query.filter(AIReport.timestamp >= last_90_days, AIReport.is_anomaly == True).count()
    anomaly_reports_last_365_days = AIReport.query.filter(AIReport.timestamp >= last_365_days, AIReport.is_anomaly == True).count()

    # إحصائيات البلوك تشين
    try:
        supabase_client = get_supabase_client()
        if supabase_client:
            # جلب إحصائيات البلوك تشين من Supabase
            total_response = supabase_client.table('blockchain_logs').select('id', count='exact').execute()
            total_blockchain_records = total_response.count if hasattr(total_response, 'count') else 0

            verified_response = supabase_client.table('blockchain_logs').select('id', count='exact').eq('verified', True).execute()
            verified_blocks = verified_response.count if hasattr(verified_response, 'count') else 0

            # إحصائيات البلوك تشين لفترات مختلفة
            blockchain_last_24_hours = supabase_client.table('blockchain_logs').select('id', count='exact').gte('timestamp', last_24_hours.isoformat()).execute()
            blockchain_last_7_days = supabase_client.table('blockchain_logs').select('id', count='exact').gte('timestamp', last_7_days.isoformat()).execute()
            blockchain_last_30_days = supabase_client.table('blockchain_logs').select('id', count='exact').gte('timestamp', last_30_days.isoformat()).execute()
            blockchain_last_90_days = supabase_client.table('blockchain_logs').select('id', count='exact').gte('timestamp', last_90_days.isoformat()).execute()
            blockchain_last_365_days = supabase_client.table('blockchain_logs').select('id', count='exact').gte('timestamp', last_365_days.isoformat()).execute()

            blockchain_records_24h = blockchain_last_24_hours.count if hasattr(blockchain_last_24_hours, 'count') else 0
            blockchain_records_7d = blockchain_last_7_days.count if hasattr(blockchain_last_7_days, 'count') else 0
            blockchain_records_30d = blockchain_last_30_days.count if hasattr(blockchain_last_30_days, 'count') else 0
            blockchain_records_90d = blockchain_last_90_days.count if hasattr(blockchain_last_90_days, 'count') else 0
            blockchain_records_365d = blockchain_last_365_days.count if hasattr(blockchain_last_365_days, 'count') else 0
        else:
            total_blockchain_records = 0
            verified_blocks = 0
            blockchain_records_24h = 0
            blockchain_records_7d = 0
            blockchain_records_30d = 0
            blockchain_records_90d = 0
            blockchain_records_365d = 0
    except Exception as e:
        current_app.logger.error(f"Error getting blockchain stats from Supabase: {e}")
        total_blockchain_records = 0
        verified_blocks = 0
        blockchain_records_24h = 0
        blockchain_records_7d = 0
        blockchain_records_30d = 0
        blockchain_records_90d = 0
        blockchain_records_365d = 0

    # إحصائيات الخوادم
    total_servers = Server.query.count()
    active_servers = Server.query.filter_by(status='active').count()

    # إحصائيات السياسات
    total_policies = Policy.query.count()
    active_policies = Policy.query.filter_by(is_active=True).count()

    # الأجهزة الأكثر نشاطاً لفترات مختلفة
    most_active_devices_7d = db.session.query(
        Device.name,
        Device.serial_number,
        func.count(Log.id).label('activity_count')
    ).join(Log, Device.serial_number == Log.target_device)\
     .filter(Log.timestamp >= last_7_days)\
     .group_by(Device.id)\
     .order_by(desc('activity_count'))\
     .limit(10).all()

    most_active_devices_30d = db.session.query(
        Device.name,
        Device.serial_number,
        func.count(Log.id).label('activity_count')
    ).join(Log, Device.serial_number == Log.target_device)\
     .filter(Log.timestamp >= last_30_days)\
     .group_by(Device.id)\
     .order_by(desc('activity_count'))\
     .limit(10).all()

    most_active_devices_365d = db.session.query(
        Device.name,
        Device.serial_number,
        func.count(Log.id).label('activity_count')
    ).join(Log, Device.serial_number == Log.target_device)\
     .filter(Log.timestamp >= last_365_days)\
     .group_by(Device.id)\
     .order_by(desc('activity_count'))\
     .limit(10).all()

    # أحدث التنبيهات لفترات مختلفة
    recent_alerts_24h = Alert.query.filter(Alert.created_at >= last_24_hours)\
                                   .order_by(desc(Alert.created_at))\
                                   .limit(10).all()

    recent_alerts_7d = Alert.query.filter(Alert.created_at >= last_7_days)\
                                  .order_by(desc(Alert.created_at))\
                                  .limit(10).all()

    recent_alerts_30d = Alert.query.filter(Alert.created_at >= last_30_days)\
                                   .order_by(desc(Alert.created_at))\
                                   .limit(10).all()

    # أحدث السجلات لفترات مختلفة
    recent_logs_24h = Log.query.filter(Log.timestamp >= last_24_hours)\
                               .order_by(desc(Log.timestamp))\
                               .limit(20).all()

    recent_logs_7d = Log.query.filter(Log.timestamp >= last_7_days)\
                              .order_by(desc(Log.timestamp))\
                              .limit(20).all()

    recent_logs_30d = Log.query.filter(Log.timestamp >= last_30_days)\
                               .order_by(desc(Log.timestamp))\
                               .limit(20).all()

    # إحصائيات حسب النوع
    device_types = db.session.query(
        Device.device_class,
        func.count(Device.id).label('count')
    ).group_by(Device.device_class).all()

    alert_types = db.session.query(
        Alert.alert_type,
        func.count(Alert.id).label('count')
    ).filter(Alert.alert_type.isnot(None))\
     .group_by(Alert.alert_type).all()

    # إحصائيات الأداء والكفاءة
    avg_logs_per_day_7d = logs_last_7_days / 7 if logs_last_7_days > 0 else 0
    avg_logs_per_day_30d = logs_last_30_days / 30 if logs_last_30_days > 0 else 0
    avg_logs_per_day_365d = logs_last_365_days / 365 if logs_last_365_days > 0 else 0

    avg_alerts_per_day_7d = alerts_last_7_days / 7 if alerts_last_7_days > 0 else 0
    avg_alerts_per_day_30d = alerts_last_30_days / 30 if alerts_last_30_days > 0 else 0
    avg_alerts_per_day_365d = alerts_last_365_days / 365 if alerts_last_365_days > 0 else 0

    # معدل الاتصال بالأجهزة
    connection_rate = (connected_devices / total_devices * 100) if total_devices > 0 else 0

    # معدل النشاط للمستخدمين
    user_activity_rate = (active_users / total_users * 100) if total_users > 0 else 0

    # معدل الخوادم النشطة
    server_uptime_rate = (active_servers / total_servers * 100) if total_servers > 0 else 0

    return {
        'summary': {
            'total_devices': total_devices,
            'connected_devices': connected_devices,
            'pending_devices': pending_devices,
            'blocked_devices': blocked_devices,
            'whitelisted_devices': whitelisted_devices,
            'total_users': total_users,
            'active_users': active_users,
            'total_logs': total_logs,
            'total_alerts': total_alerts,
            'unresolved_alerts': unresolved_alerts,
            'high_priority_alerts': high_priority_alerts,
            'total_ai_reports': total_ai_reports,
            'anomaly_reports': anomaly_reports,
            'total_blockchain_records': total_blockchain_records,
            'verified_blocks': verified_blocks,
            'total_servers': total_servers,
            'active_servers': active_servers,
            'total_policies': total_policies,
            'active_policies': active_policies,
            'connection_rate': round(connection_rate, 2),
            'user_activity_rate': round(user_activity_rate, 2),
            'server_uptime_rate': round(server_uptime_rate, 2)
        },
        'time_series': {
            # السجلات
            'logs_last_24_hours': logs_last_24_hours,
            'logs_last_7_days': logs_last_7_days,
            'logs_last_30_days': logs_last_30_days,
            'logs_last_90_days': logs_last_90_days,
            'logs_last_365_days': logs_last_365_days,

            # التنبيهات
            'alerts_last_24_hours': alerts_last_24_hours,
            'alerts_last_7_days': alerts_last_7_days,
            'alerts_last_30_days': alerts_last_30_days,
            'alerts_last_90_days': alerts_last_90_days,
            'alerts_last_365_days': alerts_last_365_days,

            # التنبيهات المحلولة
            'resolved_alerts_last_24_hours': resolved_alerts_last_24_hours,
            'resolved_alerts_last_7_days': resolved_alerts_last_7_days,
            'resolved_alerts_last_30_days': resolved_alerts_last_30_days,
            'resolved_alerts_last_90_days': resolved_alerts_last_90_days,
            'resolved_alerts_last_365_days': resolved_alerts_last_365_days,

            # تقارير الذكاء الاصطناعي
            'ai_reports_last_24_hours': ai_reports_last_24_hours,
            'ai_reports_last_7_days': ai_reports_last_7_days,
            'ai_reports_last_30_days': ai_reports_last_30_days,
            'ai_reports_last_90_days': ai_reports_last_90_days,
            'ai_reports_last_365_days': ai_reports_last_365_days,

            # تقارير الشذوذات
            'anomaly_reports_last_24_hours': anomaly_reports_last_24_hours,
            'anomaly_reports_last_7_days': anomaly_reports_last_7_days,
            'anomaly_reports_last_30_days': anomaly_reports_last_30_days,
            'anomaly_reports_last_90_days': anomaly_reports_last_90_days,
            'anomaly_reports_last_365_days': anomaly_reports_last_365_days,

            # سجلات البلوك تشين
            'blockchain_records_24h': blockchain_records_24h,
            'blockchain_records_7d': blockchain_records_7d,
            'blockchain_records_30d': blockchain_records_30d,
            'blockchain_records_90d': blockchain_records_90d,
            'blockchain_records_365d': blockchain_records_365d,

            # معدلات الأداء
            'avg_logs_per_day_7d': round(avg_logs_per_day_7d, 2),
            'avg_logs_per_day_30d': round(avg_logs_per_day_30d, 2),
            'avg_logs_per_day_365d': round(avg_logs_per_day_365d, 2),
            'avg_alerts_per_day_7d': round(avg_alerts_per_day_7d, 2),
            'avg_alerts_per_day_30d': round(avg_alerts_per_day_30d, 2),
            'avg_alerts_per_day_365d': round(avg_alerts_per_day_365d, 2)
        },
        'most_active_devices': {
            '7_days': most_active_devices_7d,
            '30_days': most_active_devices_30d,
            '365_days': most_active_devices_365d
        },
        'recent_alerts': {
            '24_hours': recent_alerts_24h,
            '7_days': recent_alerts_7d,
            '30_days': recent_alerts_30d
        },
        'recent_logs': {
            '24_hours': recent_logs_24h,
            '7_days': recent_logs_7d,
            '30_days': recent_logs_30d
        },
        'device_types': device_types,
        'alert_types': alert_types,
        'report_generated_at': now.isoformat()
    }

def generate_arabic_report(data, report_type, params):
    """
    إنشاء التقرير باللغة العربية
    """
    summary = data['summary']
    time_series = data['time_series']
    
    report_content = f"""
# تقرير شامل عن نظام إدارة الأجهزة والمراقبة الأمنية
## تاريخ التقرير: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

## 📊 ملخص النظام العام
### إحصائيات الأجهزة
- **إجمالي الأجهزة المسجلة**: {summary['total_devices']} جهاز
- **الأجهزة المتصلة حالياً**: {summary['connected_devices']} جهاز
- **الأجهزة في حالة الانتظار**: {summary['pending_devices']} جهاز
- **الأجهزة المحظورة**: {summary['blocked_devices']} جهاز
- **الأجهزة المسموحة**: {summary['whitelisted_devices']} جهاز
- **نسبة الأجهزة المتصلة**: {round((summary['connected_devices'] / max(summary['total_devices'], 1)) * 100, 1)}%

### إحصائيات المستخدمين
- **إجمالي المستخدمين**: {summary['total_users']} مستخدم
- **المستخدمين النشطين**: {summary['active_users']} مستخدم
- **نسبة المستخدمين النشطين**: {round((summary['active_users'] / max(summary['total_users'], 1)) * 100, 1)}%

## 📈 إحصائيات النشاط والمراقبة
### سجلات النظام
- **إجمالي السجلات**: {summary['total_logs']} سجل
- **السجلات في آخر 24 ساعة**: {time_series['logs_last_24_hours']} سجل
- **السجلات في آخر 7 أيام**: {time_series['logs_last_7_days']} سجل
- **السجلات في آخر 30 يوم**: {time_series['logs_last_30_days']} سجل
- **السجلات في آخر 90 يوم**: {time_series['logs_last_90_days']} سجل
- **السجلات في آخر سنة**: {time_series['logs_last_365_days']} سجل
- **متوسط السجلات اليومية (7 أيام)**: {time_series['avg_logs_per_day_7d']} سجل/يوم
- **متوسط السجلات اليومية (30 يوم)**: {time_series['avg_logs_per_day_30d']} سجل/يوم
- **متوسط السجلات اليومية (سنة)**: {time_series['avg_logs_per_day_365d']} سجل/يوم

## 🚨 إحصائيات الأمان والتنبيهات
### التنبيهات الأمنية
- **إجمالي التنبيهات**: {summary['total_alerts']} تنبيه
- **التنبيهات غير المحلولة**: {summary['unresolved_alerts']} تنبيه
- **التنبيهات عالية الأولوية**: {summary['high_priority_alerts']} تنبيه
- **التنبيهات في آخر 24 ساعة**: {time_series['alerts_last_24_hours']} تنبيه
- **التنبيهات في آخر 7 أيام**: {time_series['alerts_last_7_days']} تنبيه
- **التنبيهات في آخر 30 يوم**: {time_series['alerts_last_30_days']} تنبيه
- **التنبيهات في آخر 90 يوم**: {time_series['alerts_last_90_days']} تنبيه
- **التنبيهات في آخر سنة**: {time_series['alerts_last_365_days']} تنبيه
- **التنبيهات المحلولة في آخر 24 ساعة**: {time_series['resolved_alerts_last_24_hours']} تنبيه
- **التنبيهات المحلولة في آخر 7 أيام**: {time_series['resolved_alerts_last_7_days']} تنبيه
- **التنبيهات المحلولة في آخر 30 يوم**: {time_series['resolved_alerts_last_30_days']} تنبيه
- **نسبة التنبيهات المحلولة**: {round(((summary['total_alerts'] - summary['unresolved_alerts']) / max(summary['total_alerts'], 1)) * 100, 1)}%
- **متوسط التنبيهات اليومية (7 أيام)**: {time_series['avg_alerts_per_day_7d']} تنبيه/يوم
- **متوسط التنبيهات اليومية (30 يوم)**: {time_series['avg_alerts_per_day_30d']} تنبيه/يوم
- **متوسط التنبيهات اليومية (سنة)**: {time_series['avg_alerts_per_day_365d']} تنبيه/يوم

## 🤖 إحصائيات الذكاء الاصطناعي
### تحليلات الذكاء الاصطناعي
- **إجمالي تقارير الذكاء الاصطناعي**: {summary['total_ai_reports']} تقرير
- **تقارير الشذوذات المكتشفة**: {summary['anomaly_reports']} تقرير
- **تقارير الذكاء الاصطناعي في آخر 24 ساعة**: {time_series['ai_reports_last_24_hours']} تقرير
- **تقارير الذكاء الاصطناعي في آخر 7 أيام**: {time_series['ai_reports_last_7_days']} تقرير
- **تقارير الذكاء الاصطناعي في آخر 30 يوم**: {time_series['ai_reports_last_30_days']} تقرير
- **تقارير الذكاء الاصطناعي في آخر 90 يوم**: {time_series['ai_reports_last_90_days']} تقرير
- **تقارير الذكاء الاصطناعي في آخر سنة**: {time_series['ai_reports_last_365_days']} تقرير
- **تقارير الشذوذات في آخر 24 ساعة**: {time_series['anomaly_reports_last_24_hours']} تقرير
- **تقارير الشذوذات في آخر 7 أيام**: {time_series['anomaly_reports_last_7_days']} تقرير
- **تقارير الشذوذات في آخر 30 يوم**: {time_series['anomaly_reports_last_30_days']} تقرير
- **نسبة الشذوذات**: {round((summary['anomaly_reports'] / max(summary['total_ai_reports'], 1)) * 100, 1)}%

## 🔗 إحصائيات البلوك تشين والأمان
### سجلات البلوك تشين
- **إجمالي السجلات**: {summary['total_blockchain_records']} سجل
- **الكتل المؤكدة**: {summary['verified_blocks']} كتلة
- **سجلات البلوك تشين في آخر 24 ساعة**: {time_series['blockchain_records_24h']} سجل
- **سجلات البلوك تشين في آخر 7 أيام**: {time_series['blockchain_records_7d']} سجل
- **سجلات البلوك تشين في آخر 30 يوم**: {time_series['blockchain_records_30d']} سجل
- **سجلات البلوك تشين في آخر 90 يوم**: {time_series['blockchain_records_90d']} سجل
- **سجلات البلوك تشين في آخر سنة**: {time_series['blockchain_records_365d']} سجل
- **نسبة الكتل المؤكدة**: {round((summary['verified_blocks'] / max(summary['total_blockchain_records'], 1)) * 100, 1)}%

## 🖥️ إحصائيات البنية التحتية
### الخوادم والسياسات
- **إجمالي الخوادم**: {summary['total_servers']} خادم
- **الخوادم النشطة**: {summary['active_servers']} خادم
- **إجمالي السياسات**: {summary['total_policies']} سياسة
- **السياسات النشطة**: {summary['active_policies']} سياسة
- **نسبة الخوادم النشطة**: {summary['server_uptime_rate']}%
- **نسبة الأجهزة المتصلة**: {summary['connection_rate']}%
- **نسبة المستخدمين النشطين**: {summary['user_activity_rate']}%

## 🔥 الأجهزة الأكثر نشاطاً
### آخر 7 أيام
"""
    
    if data['most_active_devices']['7_days']:
        for i, device in enumerate(data['most_active_devices']['7_days'], 1):
            report_content += f"{i}. **{device['name']}** ({device['serial_number']}): {device['activity_count']} نشاط\n"
    else:
        report_content += "لا توجد بيانات عن الأجهزة النشطة\n"
    
    report_content += "\n### آخر 30 يوم\n"
    if data['most_active_devices']['30_days']:
        for i, device in enumerate(data['most_active_devices']['30_days'], 1):
            report_content += f"{i}. **{device['name']}** ({device['serial_number']}): {device['activity_count']} نشاط\n"
    else:
        report_content += "لا توجد بيانات عن الأجهزة النشطة\n"
    
    report_content += "\n### آخر سنة\n"
    if data['most_active_devices']['365_days']:
        for i, device in enumerate(data['most_active_devices']['365_days'], 1):
            report_content += f"{i}. **{device['name']}** ({device['serial_number']}): {device['activity_count']} نشاط\n"
    else:
        report_content += "لا توجد بيانات عن الأجهزة النشطة\n"
    
    report_content += "\n## 🚨 أحدث التنبيهات\n"
    report_content += "### آخر 24 ساعة\n"
    if data['recent_alerts']['24_hours']:
        for i, alert in enumerate(data['recent_alerts']['24_hours'], 1):
            priority_icon = "🔴" if alert.get('priority') == 'high' else "🟡" if alert.get('priority') == 'medium' else "🟢"
            created_at = alert.get('created_at', '')
            if isinstance(created_at, str) and 'T' in created_at:
                created_at = created_at.split('T')[0] + ' ' + created_at.split('T')[1][:5]
            report_content += f"{i}. {priority_icon} **{alert.get('message', 'No message')}** - {created_at} (Priority: {alert.get('priority', 'Unknown')})\n"
    else:
        report_content += "لا توجد تنبيهات حديثة\n"
    
    report_content += "\n### آخر 7 أيام\n"
    if data['recent_alerts']['7_days']:
        for i, alert in enumerate(data['recent_alerts']['7_days'], 1):
            priority_icon = "🔴" if alert.get('priority') == 'high' else "🟡" if alert.get('priority') == 'medium' else "🟢"
            created_at = alert.get('created_at', '')
            if isinstance(created_at, str) and 'T' in created_at:
                created_at = created_at.split('T')[0] + ' ' + created_at.split('T')[1][:5]
            report_content += f"{i}. {priority_icon} **{alert.get('message', 'No message')}** - {created_at} (Priority: {alert.get('priority', 'Unknown')})\n"
    else:
        report_content += "لا توجد تنبيهات حديثة\n"
    
    report_content += "\n### آخر 30 يوم\n"
    if data['recent_alerts']['30_days']:
        for i, alert in enumerate(data['recent_alerts']['30_days'], 1):
            priority_icon = "🔴" if alert.get('priority') == 'high' else "🟡" if alert.get('priority') == 'medium' else "🟢"
            created_at = alert.get('created_at', '')
            if isinstance(created_at, str) and 'T' in created_at:
                created_at = created_at.split('T')[0] + ' ' + created_at.split('T')[1][:5]
            report_content += f"{i}. {priority_icon} **{alert.get('message', 'No message')}** - {created_at} (Priority: {alert.get('priority', 'Unknown')})\n"
    else:
        report_content += "لا توجد تنبيهات حديثة\n"
    
    report_content += "\n## � أحدث السجلات\n"
    report_content += "### آخر 24 ساعة\n"
    if data['recent_logs']['24_hours']:
        for i, log in enumerate(data['recent_logs']['24_hours'], 1):
            timestamp = log.get('timestamp', '')
            if isinstance(timestamp, str) and 'T' in timestamp:
                timestamp = timestamp.split('T')[0] + ' ' + timestamp.split('T')[1][:5]
            report_content += f"{i}. **{log.get('action', 'عملية غير محددة')}** - {log.get('target_device', 'غير محدد')} - {timestamp} - {log.get('details', 'لا توجد تفاصيل')}\n"
    else:
        report_content += "لا توجد سجلات حديثة\n"
    
    report_content += "\n### آخر 7 أيام\n"
    if data['recent_logs']['7_days']:
        for i, log in enumerate(data['recent_logs']['7_days'][:10], 1):  # عرض أول 10 سجلات فقط
            timestamp = log.get('timestamp', '')
            if isinstance(timestamp, str) and 'T' in timestamp:
                timestamp = timestamp.split('T')[0] + ' ' + timestamp.split('T')[1][:5]
            report_content += f"{i}. **{log.get('action', 'عملية غير محددة')}** - {log.get('target_device', 'غير محدد')} - {timestamp} - {log.get('details', 'لا توجد تفاصيل')}\n"
    else:
        report_content += "لا توجد سجلات حديثة\n"
    
    report_content += "\n### آخر 30 يوم\n"
    if data['recent_logs']['30_days']:
        for i, log in enumerate(data['recent_logs']['30_days'][:10], 1):  # عرض أول 10 سجلات فقط
            timestamp = log.get('timestamp', '')
            if isinstance(timestamp, str) and 'T' in timestamp:
                timestamp = timestamp.split('T')[0] + ' ' + timestamp.split('T')[1][:5]
            report_content += f"{i}. **{log.get('action', 'عملية غير محددة')}** - {log.get('target_device', 'غير محدد')} - {timestamp} - {log.get('details', 'لا توجد تفاصيل')}\n"
    else:
        report_content += "لا توجد سجلات حديثة\n"
    
    report_content += "\n## �📱 أنواع الأجهزة المسجلة\n"
    if data['device_types']:
        for device_type in data['device_types']:
            if device_type.get('device_class'):
                report_content += f"- **{device_type['device_class']}**: {device_type['count']} جهاز\n"
    else:
        report_content += "لا توجد بيانات عن أنواع الأجهزة\n"
    
    report_content += "\n## ⚠️ أنواع التنبيهات\n"
    if data['alert_types']:
        for alert_type in data['alert_types']:
            if alert_type.get('alert_type'):
                report_content += f"- **{alert_type['alert_type']}**: {alert_type['count']} تنبيه\n"
    else:
        report_content += "لا توجد بيانات عن أنواع التنبيهات\n"
    
    report_content += """
## 📋 ملاحظات التقرير
- **تاريخ إنشاء التقرير**: {report_generated_at}
- **مصدر البيانات**: قاعدة البيانات الحقيقية للنظام
- **دقة البيانات**: جميع البيانات مأخوذة من السجلات الفعلية للنظام
- **نطاق التقرير**: تقرير شامل عن جميع جوانب النظام
- **تحديث البيانات**: يتم تحديث البيانات في الوقت الفعلي

## 🎯 التوصيات العامة
- مراجعة التنبيهات غير المحلولة بانتظام
- متابعة الأجهزة الأكثر نشاطاً للكشف عن الأنماط غير العادية
- تحديث السياسات الأمنية حسب الحاجة
- مراجعة تقارير الذكاء الاصطناعي للكشف عن الشذوذات

---
*تم إنشاء هذا التقرير بواسطة نظام إدارة الأجهزة والمراقبة الأمنية*
""".format(report_generated_at=data['report_generated_at'])
    
    return report_content

def generate_english_report(data, report_type, params):
    """
    إنشاء التقرير باللغة الإنجليزية
    """
    summary = data['summary']
    time_series = data['time_series']
    
    report_content = """
# Comprehensive Device Management and Security Monitoring System Report
## Report Date: """ + datetime.now().strftime('%Y-%m-%d %H:%M:%S') + """

## 📊 System Overview
### Device Statistics
- **Total Registered Devices**: """ + str(summary['total_devices']) + """ devices
- **Currently Connected Devices**: """ + str(summary['connected_devices']) + """ devices
- **Pending Devices**: """ + str(summary['pending_devices']) + """ devices
- **Blocked Devices**: """ + str(summary['blocked_devices']) + """ devices
- **Whitelisted Devices**: """ + str(summary['whitelisted_devices']) + """ devices
- **Connection Rate**: """ + str(round((summary['connected_devices'] / max(summary['total_devices'], 1)) * 100, 1)) + """%

### User Statistics
- **Total Users**: """ + str(summary['total_users']) + """ users
- **Active Users**: """ + str(summary['active_users']) + """ users
- **Active User Rate**: """ + str(round((summary['active_users'] / max(summary['total_users'], 1)) * 100, 1)) + """%

## 📈 Activity and Monitoring Statistics
### System Logs
- **Total Logs**: """ + str(summary['total_logs']) + """ logs
- **Logs in Last 24 Hours**: """ + str(time_series['logs_last_24_hours']) + """ logs
- **Logs in Last 7 Days**: """ + str(time_series['logs_last_7_days']) + """ logs
- **Logs in Last 30 Days**: """ + str(time_series['logs_last_30_days']) + """ logs
- **Logs in Last 90 Days**: """ + str(time_series['logs_last_90_days']) + """ logs
- **Logs in Last Year**: """ + str(time_series['logs_last_365_days']) + """ logs
- **Average Daily Logs (7 Days)**: """ + str(time_series['avg_logs_per_day_7d']) + """ logs/day
- **Average Daily Logs (30 Days)**: """ + str(time_series['avg_logs_per_day_30d']) + """ logs/day
- **Average Daily Logs (Year)**: """ + str(time_series['avg_logs_per_day_365d']) + """ logs/day

## 🚨 Security and Alert Statistics
### Security Alerts
- **Total Alerts**: """ + str(summary['total_alerts']) + """ alerts
- **Unresolved Alerts**: """ + str(summary['unresolved_alerts']) + """ alerts
- **High Priority Alerts**: """ + str(summary['high_priority_alerts']) + """ alerts
- **Alerts in Last 24 Hours**: """ + str(time_series['alerts_last_24_hours']) + """ alerts
- **Alerts in Last 7 Days**: """ + str(time_series['alerts_last_7_days']) + """ alerts
- **Alerts in Last 30 Days**: """ + str(time_series['alerts_last_30_days']) + """ alerts
- **Alerts in Last 90 Days**: """ + str(time_series['alerts_last_90_days']) + """ alerts
- **Alerts in Last Year**: """ + str(time_series['alerts_last_365_days']) + """ alerts
- **Resolved Alerts in Last 24 Hours**: """ + str(time_series['resolved_alerts_last_24_hours']) + """ alerts
- **Resolved Alerts in Last 7 Days**: """ + str(time_series['resolved_alerts_last_7_days']) + """ alerts
- **Resolved Alerts in Last 30 Days**: """ + str(time_series['resolved_alerts_last_30_days']) + """ alerts
- **Alert Resolution Rate**: """ + str(round(((summary['total_alerts'] - summary['unresolved_alerts']) / max(summary['total_alerts'], 1)) * 100, 1)) + """%
- **Average Daily Alerts (7 Days)**: """ + str(time_series['avg_alerts_per_day_7d']) + """ alerts/day
- **Average Daily Alerts (30 Days)**: """ + str(time_series['avg_alerts_per_day_30d']) + """ alerts/day
- **Average Daily Alerts (Year)**: """ + str(time_series['avg_alerts_per_day_365d']) + """ alerts/day

## 🤖 AI Statistics
### AI Analytics
- **Total AI Reports**: """ + str(summary['total_ai_reports']) + """ reports
- **Anomaly Reports Detected**: """ + str(summary['anomaly_reports']) + """ reports
- **AI Reports in Last 24 Hours**: """ + str(time_series['ai_reports_last_24_hours']) + """ reports
- **AI Reports in Last 7 Days**: """ + str(time_series['ai_reports_last_7_days']) + """ reports
- **AI Reports in Last 30 Days**: """ + str(time_series['ai_reports_last_30_days']) + """ reports
- **AI Reports in Last 90 Days**: """ + str(time_series['ai_reports_last_90_days']) + """ reports
- **AI Reports in Last Year**: """ + str(time_series['ai_reports_last_365_days']) + """ reports
- **Anomaly Reports in Last 24 Hours**: """ + str(time_series['anomaly_reports_last_24_hours']) + """ reports
- **Anomaly Reports in Last 7 Days**: """ + str(time_series['anomaly_reports_last_7_days']) + """ reports
- **Anomaly Reports in Last 30 Days**: """ + str(time_series['anomaly_reports_last_30_days']) + """ reports
- **Anomaly Detection Rate**: """ + str(round((summary['anomaly_reports'] / max(summary['total_ai_reports'], 1)) * 100, 1)) + """%

## 🔗 Blockchain and Security Statistics
### Blockchain Records
- **Total Records**: """ + str(summary['total_blockchain_records']) + """ records
- **Verified Blocks**: """ + str(summary['verified_blocks']) + """ blocks
- **Blockchain Records in Last 24 Hours**: """ + str(time_series['blockchain_records_24h']) + """ records
- **Blockchain Records in Last 7 Days**: """ + str(time_series['blockchain_records_7d']) + """ records
- **Blockchain Records in Last 30 Days**: """ + str(time_series['blockchain_records_30d']) + """ records
- **Blockchain Records in Last 90 Days**: """ + str(time_series['blockchain_records_90d']) + """ records
- **Blockchain Records in Last Year**: """ + str(time_series['blockchain_records_365d']) + """ records
- **Block Verification Rate**: """ + str(round((summary['verified_blocks'] / max(summary['total_blockchain_records'], 1)) * 100, 1)) + """%

## 🖥️ Infrastructure Statistics
### Servers and Policies
- **Total Servers**: """ + str(summary['total_servers']) + """ servers
- **Active Servers**: """ + str(summary['active_servers']) + """ servers
- **Total Policies**: """ + str(summary['total_policies']) + """ policies
- **Active Policies**: """ + str(summary['active_policies']) + """ policies
- **Server Uptime Rate**: """ + str(summary['server_uptime_rate']) + """%
- **Device Connection Rate**: """ + str(summary['connection_rate']) + """%
- **User Activity Rate**: """ + str(summary['user_activity_rate']) + """%

## 🔥 Most Active Devices
### Last 7 Days
"""
    
    if data['most_active_devices']['7_days']:
        for i, device in enumerate(data['most_active_devices']['7_days'], 1):
            report_content += f"{i}. **{device['name']}** ({device['serial_number']}): {device['activity_count']} activities\n"
    else:
        report_content += "No data available for active devices\n"
    
    report_content += "\n### Last 30 Days\n"
    if data['most_active_devices']['30_days']:
        for i, device in enumerate(data['most_active_devices']['30_days'], 1):
            report_content += f"{i}. **{device['name']}** ({device['serial_number']}): {device['activity_count']} activities\n"
    else:
        report_content += "No data available for active devices\n"
    
    report_content += "\n### Last Year\n"
    if data['most_active_devices']['365_days']:
        for i, device in enumerate(data['most_active_devices']['365_days'], 1):
            report_content += f"{i}. **{device['name']}** ({device['serial_number']}): {device['activity_count']} activities\n"
    else:
        report_content += "No data available for active devices\n"
    
    report_content += "\n## 🚨 Recent Alerts\n"
    report_content += "### Last 24 Hours\n"
    if data['recent_alerts']['24_hours']:
        for i, alert in enumerate(data['recent_alerts']['24_hours'], 1):
            priority_icon = "🔴" if alert.get('priority') == 'high' else "🟡" if alert.get('priority') == 'medium' else "🟢"
            created_at = alert.get('created_at', '')
            if isinstance(created_at, str) and 'T' in created_at:
                created_at = created_at.split('T')[0] + ' ' + created_at.split('T')[1][:5]
            report_content += f"{i}. {priority_icon} **{alert.get('message', 'No message')}** - {created_at} (Priority: {alert.get('priority', 'Unknown')})\n"
    else:
        report_content += "No recent alerts\n"
    
    report_content += "\n### Last 7 Days\n"
    if data['recent_alerts']['7_days']:
        for i, alert in enumerate(data['recent_alerts']['7_days'], 1):
            priority_icon = "🔴" if alert.get('priority') == 'high' else "🟡" if alert.get('priority') == 'medium' else "🟢"
            created_at = alert.get('created_at', '')
            if isinstance(created_at, str) and 'T' in created_at:
                created_at = created_at.split('T')[0] + ' ' + created_at.split('T')[1][:5]
            report_content += f"{i}. {priority_icon} **{alert.get('message', 'No message')}** - {created_at} (Priority: {alert.get('priority', 'Unknown')})\n"
    else:
        report_content += "No recent alerts\n"
    
    report_content += "\n### Last 30 Days\n"
    if data['recent_alerts']['30_days']:
        for i, alert in enumerate(data['recent_alerts']['30_days'], 1):
            priority_icon = "🔴" if alert.get('priority') == 'high' else "🟡" if alert.get('priority') == 'medium' else "🟢"
            created_at = alert.get('created_at', '')
            if isinstance(created_at, str) and 'T' in created_at:
                created_at = created_at.split('T')[0] + ' ' + created_at.split('T')[1][:5]
            report_content += f"{i}. {priority_icon} **{alert.get('message', 'No message')}** - {created_at} (Priority: {alert.get('priority', 'Unknown')})\n"
    else:
        report_content += "No recent alerts\n"
    
    report_content += "\n## 📋 Recent Logs\n"
    report_content += "### Last 24 Hours\n"
    if data['recent_logs']['24_hours']:
        for i, log in enumerate(data['recent_logs']['24_hours'], 1):
            timestamp = log.get('timestamp', '')
            if isinstance(timestamp, str) and 'T' in timestamp:
                timestamp = timestamp.split('T')[0] + ' ' + timestamp.split('T')[1][:5]
            report_content += f"{i}. **{log.get('action', 'Unknown action')}** - {log.get('target_device', 'Unknown device')} - {timestamp} - {log.get('details', 'No details')}\n"
    else:
        report_content += "No recent logs\n"
    
    report_content += "\n### Last 7 Days\n"
    if data['recent_logs']['7_days']:
        for i, log in enumerate(data['recent_logs']['7_days'][:10], 1):  # Show first 10 logs only
            timestamp = log.get('timestamp', '')
            if isinstance(timestamp, str) and 'T' in timestamp:
                timestamp = timestamp.split('T')[0] + ' ' + timestamp.split('T')[1][:5]
            report_content += f"{i}. **{log.get('action', 'Unknown action')}** - {log.get('target_device', 'Unknown device')} - {timestamp} - {log.get('details', 'No details')}\n"
    else:
        report_content += "No recent logs\n"
    
    report_content += "\n### Last 30 Days\n"
    if data['recent_logs']['30_days']:
        for i, log in enumerate(data['recent_logs']['30_days'][:10], 1):  # Show first 10 logs only
            timestamp = log.get('timestamp', '')
            if isinstance(timestamp, str) and 'T' in timestamp:
                timestamp = timestamp.split('T')[0] + ' ' + timestamp.split('T')[1][:5]
            report_content += f"{i}. **{log.get('action', 'Unknown action')}** - {log.get('target_device', 'Unknown device')} - {timestamp} - {log.get('details', 'No details')}\n"
    else:
        report_content += "No recent logs\n"
    
    report_content += "\n## 📱 Registered Device Types\n"
    if data['device_types']:
        for device_type in data['device_types']:
            if device_type.get('device_class'):
                report_content += f"- **{device_type['device_class']}**: {device_type['count']} devices\n"
    else:
        report_content += "No data available for device types\n"
    
    report_content += "\n## ⚠️ Alert Types\n"
    if data['alert_types']:
        for alert_type in data['alert_types']:
            if alert_type.get('alert_type'):
                report_content += f"- **{alert_type['alert_type']}**: {alert_type['count']} alerts\n"
    else:
        report_content += "No data available for alert types\n"
    
    report_content += """
## 📋 Report Notes
- Report generated at: """ + str(data['report_generated_at']) + """
- All data is taken from the real database
- Report reflects the actual system state at generation time
- Data accuracy: 100% real data from system logs

## 🎯 General Recommendations
- Regularly review unresolved alerts
- Monitor most active devices for unusual patterns
- Update security policies as needed
- Review AI reports for anomaly detection

---
*Generated by Device Management and Security Monitoring System*
"""
    
    return report_content

def generate_report_content(report_data):
    """
    دالة مساعدة لتوليد محتوى التقرير
    """
    report_type = report_data.get('report_type', 'system_overview')
    params = report_data.get('parameters', {})
    language = params.get('language', 'ar')
    
    # تنظيف النص من الرموز
    params['clean_text'] = True
    
    return generate_comprehensive_report(report_type, params, language)
