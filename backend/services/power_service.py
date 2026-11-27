import json
import time
import threading
from datetime import datetime, timedelta
from flask import current_app
from extensions import db, socketio
from models import Server, Log

class PowerMonitoringService:
    """خدمة مراقبة استهلاك الطاقة للخوادم"""
    
    def __init__(self):
        self.monitoring_threads = {}
        self.power_thresholds = {
            'total_power': 50,  # واط
            'port_power': 10,   # واط لكل منفذ
            'idle_threshold': 0.1  # واط للمنافذ غير المستخدمة
        }
        self.alert_cooldown = {}  # لتجنب تكرار التنبيهات
    
    def start_monitoring(self, server_id):
        """بدء مراقبة الطاقة للخادم"""
        if server_id in self.monitoring_threads:
            return  # المراقبة قيد التشغيل بالفعل
        
        thread = threading.Thread(
            target=self._monitor_server_power,
            args=(server_id,),
            daemon=True
        )
        thread.start()
        self.monitoring_threads[server_id] = thread
        
        current_app.logger.info(f"Started power monitoring for server {server_id}")
    
    def stop_monitoring(self, server_id):
        """إيقاف مراقبة الطاقة للخادم"""
        if server_id in self.monitoring_threads:
            # إشارة للإيقاف (يمكن إضافة متغير للتحكم)
            del self.monitoring_threads[server_id]
            current_app.logger.info(f"Stopped power monitoring for server {server_id}")
    
    def _monitor_server_power(self, server_id):
        """مراقبة استهلاك الطاقة للخادم"""
        while server_id in self.monitoring_threads:
            try:
                server = Server.query.get(server_id)
                if not server or server.status != 'active':
                    break
                
                # جمع بيانات الطاقة
                power_data = self._collect_power_data(server)
                
                # حفظ البيانات
                self._save_power_data(server_id, power_data)
                
                # فحص العتبات
                self._check_power_thresholds(server_id, power_data)
                
                # إرسال البيانات عبر WebSocket
                socketio.emit('power:updated', {
                    'server_id': server_id,
                    'data': power_data,
                    'timestamp': datetime.utcnow().isoformat()
                })
                
                time.sleep(30)  # فحص كل 30 ثانية
                
            except Exception as e:
                current_app.logger.error(f"Power monitoring error for server {server_id}: {e}")
                time.sleep(60)  # انتظار أطول في حالة الخطأ
    
    def _collect_power_data(self, server):
        """جمع بيانات الطاقة من الخادم"""
        try:
            # محاولة الاتصال بالخادم لجلب بيانات الطاقة
            import requests
            power_url = f"http://{server.ip_address}/api/power/status"
            headers = {'X-API-Key': server.api_key}
            response = requests.get(power_url, headers=headers, timeout=None)
            
            if response.status_code == 200:
                return response.json()
            else:
                # استخدام بيانات افتراضية إذا فشل الاتصال
                return self._generate_mock_power_data(server)
                
        except Exception as e:
            current_app.logger.error(f"Error collecting power data from server {server.id}: {e}")
            return self._generate_mock_power_data(server)
    
    def _generate_mock_power_data(self, server):
        """توليد بيانات طاقة افتراضية للتجربة"""
        import random
        
        # توليد بيانات واقعية نسبياً
        total_power = random.uniform(5, 25)  # 5-25 واط
        ports_count = random.randint(2, 8)
        ports_power = {}
        
        for i in range(ports_count):
            port_id = f"USB{i+1}"
            # بعض المنافذ نشطة وبعضها غير نشط
            if random.random() > 0.3:  # 70% من المنافذ نشطة
                power = random.uniform(0.5, 8.0)
                ports_power[port_id] = round(power, 2)
            else:
                ports_power[port_id] = 0.0
        
        return {
            'total_power': round(total_power, 2),
            'ports_power': ports_power,
            'timestamp': datetime.utcnow().isoformat(),
            'server_id': server.id,
            'voltage': 5.0,  # فولت
            'current': total_power / 5.0,  # أمبير
            'efficiency': random.uniform(0.85, 0.95)
        }
    
    def _save_power_data(self, server_id, power_data):
        """حفظ بيانات الطاقة في قاعدة البيانات باستخدام Log"""
        try:
            # حذف السجلات القديمة للطاقة (احتفاظ بآخر 500 سجل)
            old_logs = Log.query.filter_by(action='power_monitoring').filter(
                Log.details.contains(f'"server_id": {server_id}')
            ).order_by(Log.timestamp.desc()).offset(500).all()
            
            for old_log in old_logs:
                db.session.delete(old_log)
            
            # إضافة سجل جديد للطاقة
            power_log = Log(
                action='power_monitoring',
                details=json.dumps({
                    'server_id': server_id,
                    'total_power': power_data.get('total_power', 0),
                    'ports_power': power_data.get('ports_power', {}),
                    'measurement_data': power_data
                }),
                timestamp=datetime.utcnow()
            )
            
            db.session.add(power_log)
            db.session.commit()
            
        except Exception as e:
            current_app.logger.error(f"Error saving power data: {e}")
            db.session.rollback()
    
    def _check_power_thresholds(self, server_id, power_data):
        """فحص عتبات الطاقة وإرسال التنبيهات"""
        try:
            total_power = power_data.get('total_power', 0)
            ports_power = power_data.get('ports_power', {})
            
            # فحص إجمالي استهلاك الطاقة
            if total_power > self.power_thresholds['total_power']:
                self._create_power_alert(
                    server_id, 
                    'high', 
                    f"استهلاك مرتفع للطاقة: {total_power}W",
                    {
                        'server_id': server_id,
                        'power_consumption': total_power,
                        'threshold': self.power_thresholds['total_power']
                    }
                )
            
            # فحص استهلاك الطاقة لكل منفذ
            for port_id, port_power in ports_power.items():
                if port_power > self.power_thresholds['port_power']:
                    self._create_power_alert(
                        server_id,
                        'medium',
                        f"استهلاك مرتفع للطاقة في المنفذ {port_id}: {port_power}W",
                        {
                            'server_id': server_id,
                            'port_id': port_id,
                            'power_consumption': port_power,
                            'threshold': self.power_thresholds['port_power']
                        }
                    )
                
                # فحص المنافذ غير المستخدمة
                elif port_power < self.power_thresholds['idle_threshold']:
                    self._create_power_alert(
                        server_id,
                        'low',
                        f"منفذ غير مستخدم: {port_id}",
                        {
                            'server_id': server_id,
                            'port_id': port_id,
                            'power_consumption': port_power,
                            'type': 'idle_port'
                        }
                    )
                    
        except Exception as e:
            current_app.logger.error(f"Error checking power thresholds: {e}")
    
    def _create_power_alert(self, server_id, priority, message, metadata):
        """إنشاء تنبيه طاقة"""
        try:
            # تجنب تكرار التنبيهات
            alert_key = f"{server_id}_{priority}_{message[:50]}"
            current_time = datetime.utcnow()
            
            if alert_key in self.alert_cooldown:
                last_alert = self.alert_cooldown[alert_key]
                if (current_time - last_alert).seconds < 300:  # 5 دقائق
                    return  # تجنب تكرار التنبيه
            
            # إنشاء التنبيه كـ Log
            alert_log = Log(
                action='power_alert',
                details=json.dumps({
                    'message': message,
                    'priority': priority,
                    'alert_type': 'power_consumption',
                    'metadata': metadata,
                    'server_id': metadata.get('server_id')
                }),
                timestamp=datetime.utcnow()
            )
            
            db.session.add(alert_log)
            db.session.commit()
            
            # تحديث وقت آخر تنبيه
            self.alert_cooldown[alert_key] = current_time
            
            # إرسال تنبيه فوري عبر WebSocket
            socketio.emit('power:alert', {
                'server_id': server_id,
                'message': message,
                'priority': priority,
                'metadata': metadata
            })
            
        except Exception as e:
            current_app.logger.error(f"Error creating power alert: {e}")
    
    def get_power_analytics(self, server_id, time_range='24h'):
        """جلب تحليلات الطاقة للخادم"""
        try:
            # حساب الفترة الزمنية
            end_time = datetime.utcnow()
            if time_range == '1h':
                start_time = end_time - timedelta(hours=1)
            elif time_range == '6h':
                start_time = end_time - timedelta(hours=6)
            elif time_range == '7d':
                start_time = end_time - timedelta(days=7)
            else:  # 24h
                start_time = end_time - timedelta(hours=24)
            
            # جلب بيانات الطاقة من الـ logs
            power_logs = Log.query.filter(
                Log.action == 'power_monitoring',
                Log.details.contains(f'"server_id": {server_id}'),
                Log.timestamp >= start_time,
                Log.timestamp <= end_time
            ).order_by(Log.timestamp.asc()).all()
            
            if not power_logs:
                return self._get_empty_analytics(server_id)
            
            # تحليل البيانات من الـ logs
            total_powers = []
            all_ports_power = {}
            
            for log in power_logs:
                try:
                    details = json.loads(log.details)
                    total_powers.append(details.get('total_power', 0))
                    
                    # تجميع بيانات المنافذ
                    ports_power = details.get('ports_power', {})
                    for port, power in ports_power.items():
                        if port not in all_ports_power:
                            all_ports_power[port] = []
                        all_ports_power[port].append(power)
                except:
                    continue
            
            # حساب الإحصائيات
            analytics = {
                'server_id': server_id,
                'total_power': sum(total_powers) / len(total_powers) if total_powers else 0,
                'peak_consumption': max(total_powers) if total_powers else 0,
                'average_consumption': sum(total_powers) / len(total_powers) if total_powers else 0,
                'ports_power': {
                    port_id: sum(powers) / len(powers) if powers else 0
                    for port_id, powers in all_ports_power.items()
                },
                'power_history': [
                    {
                        'timestamp': log.timestamp.isoformat(),
                        'total_power': json.loads(log.details).get('total_power', 0),
                        'ports_power': json.loads(log.details).get('ports_power', {})
                    }
                    for log in power_logs
                ],
                'alerts': self._get_power_alerts(server_id, start_time, end_time)
            }
            
            return analytics
            
        except Exception as e:
            current_app.logger.error(f"Error getting power analytics: {e}")
            return self._get_empty_analytics(server_id)
    
    def _get_empty_analytics(self, server_id):
        """إرجاع تحليلات فارغة"""
        return {
            'server_id': server_id,
            'total_power': 0,
            'peak_consumption': 0,
            'average_consumption': 0,
            'ports_power': {},
            'power_history': [],
            'alerts': []
        }
    
    def _get_power_alerts(self, server_id, start_time, end_time):
        """جلب تنبيهات الطاقة للخادم من الـ logs"""
        try:
            alert_logs = Log.query.filter(
                Log.action == 'power_alert',
                Log.details.contains(f'"server_id": {server_id}'),
                Log.timestamp >= start_time,
                Log.timestamp <= end_time
            ).order_by(Log.timestamp.desc()).limit(10).all()
            
            alerts = []
            for log in alert_logs:
                try:
                    details = json.loads(log.details)
                    alerts.append({
                        'message': details.get('message', ''),
                        'priority': details.get('priority', 'medium'),
                        'timestamp': log.timestamp.isoformat(),
                        'metadata': details.get('metadata', {})
                    })
                except:
                    continue
                    
            return alerts
            
        except Exception as e:
            current_app.logger.error(f"Error getting power alerts: {e}")
            return []
    
    def update_power_thresholds(self, server_id, thresholds):
        """تحديث عتبات الطاقة للخادم"""
        try:
            server = Server.query.get(server_id)
            if not server:
                return False
            
            # تحديث العتبات العامة
            if 'total_power' in thresholds:
                self.power_thresholds['total_power'] = thresholds['total_power']
            if 'port_power' in thresholds:
                self.power_thresholds['port_power'] = thresholds['port_power']
            if 'idle_threshold' in thresholds:
                self.power_thresholds['idle_threshold'] = thresholds['idle_threshold']
            
            # حفظ العتبات في إعدادات الخادم
            config = json.loads(server.config or '{}')
            config['power_thresholds'] = thresholds
            server.config = json.dumps(config)
            db.session.commit()
            
            return True
            
        except Exception as e:
            current_app.logger.error(f"Error updating power thresholds: {e}")
            return False

# إنشاء نسخة عامة من الخدمة
power_service = PowerMonitoringService() 