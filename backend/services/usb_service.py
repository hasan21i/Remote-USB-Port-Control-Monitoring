# backend/services/usb_service.py

import os
import platform
import subprocess
import json
import psutil
# Prefer the enhanced discovery helpers from utils to match client behavior
from utils import (
    discover_usb_devices,
    get_real_usb_devices,
    is_real_device,
    capture_initial_discovery_baseline,
    is_initial_discovery_captured
)
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
import logging

logger = logging.getLogger(__name__)

class USBService:
    """خدمة لجلب معلومات USB ports الحقيقية من النظام"""
    
    def __init__(self):
        self.system = platform.system().lower()
        self.is_windows = self.system == 'windows'
        self.is_linux = self.system == 'linux'
        self.is_darwin = self.system == 'darwin'  # macOS
    
    def get_usb_ports(self, devices_only: bool = True) -> List[Dict[str, Any]]:
        """Return USB information for the host.

        By default (devices_only=True) this will return only real USB devices
        discovered using the enhanced discovery in backend.utils which mirrors
        the client discovery logic and filters out internal/virtual components.

        If devices_only is False the service will fall back to returning a
        broader set (controllers, hubs, physical ports) - kept for backward
        compatibility but not used by most discovery/count APIs.
        """
        try:
            if devices_only:
                # Use the robust, pre-filtered discovery implemented in utils
                discovered = []
                try:
                    discovered = discover_usb_devices() or []
                except Exception as e:
                    logger.debug(f"discover_usb_devices failed: {e}")

                # Ensure we capture a server-side baseline on first discovery so
                # devices present at server startup are not treated as pending.
                try:
                    if not is_initial_discovery_captured():
                        capture_initial_discovery_baseline()
                except Exception:
                    # Non-fatal: continue without baseline
                    logger.debug("Failed to capture initial discovery baseline from usb_service")

                # Try to deduplicate/merge interface-level entries into
                # physical devices before mapping to the return shape.
                try:
                    from utils import enhanced_device_deduplication
                    discovered = enhanced_device_deduplication(discovered)
                except Exception:
                    # If deduplication fails, continue with raw discovered list
                    pass

                ports: List[Dict[str, Any]] = []
                for dev in discovered:
                    # Normalize keys for compatibility with callers
                    port_id = dev.get('serial_number') or dev.get('device_id') or f"{dev.get('vendor_id','0000')}:{dev.get('product_id','0000')}"
                    ports.append({
                        'port_id': port_id,
                        'name': dev.get('name') or dev.get('product') or 'USB Device',
                        'description': dev.get('description', '') or dev.get('product', ''),
                        'status': dev.get('status', 'OK'),
                        'type': 'device',
                        'vendor_id': dev.get('vendor_id'),
                        'product_id': dev.get('product_id'),
                        'serial_number': dev.get('serial_number'),
                        'device_class': dev.get('device_class'),
                        'system': dev.get('system') or 'Unknown',
                        'detected_at': dev.get('detected_at') or datetime.utcnow().isoformat(),
                        'meta_data': dev.get('meta_data', {})
                    })

                return ports

            # Legacy / broader mode: return hubs/controllers/physical ports (kept for compatibility)
            if self.is_windows:
                return self._get_windows_usb_ports()
            elif self.is_linux:
                return self._get_linux_usb_ports()
            elif self.is_darwin:
                return self._get_macos_usb_ports()
            else:
                logger.warning(f"نظام التشغيل غير مدعوم: {self.system}")
                return []
        except Exception as e:
            logger.error(f"خطأ في جلب USB ports: {e}")
            return []
    
    def _get_windows_usb_ports(self) -> List[Dict[str, Any]]:
        """جلب USB ports في Windows مع دعم محسّن"""
        ports = []
        try:
            # جلب معلومات USB Hubs الرئيسية
            cmd_hubs = [
                'powershell', '-NoProfile', '-NonInteractive', '-Command',
                'Get-WmiObject -Class Win32_USBHub | Select-Object DeviceID, Name, Description, Status | ConvertTo-Json'
            ]
            
            result_hubs = subprocess.run(cmd_hubs, capture_output=True, text=True, timeout=30)
            
            if result_hubs.returncode == 0 and result_hubs.stdout.strip():
                try:
                    hub_data = json.loads(result_hubs.stdout)
                    if not isinstance(hub_data, list):
                        hub_data = [hub_data]
                    
                    for hub in hub_data:
                        port_info = {
                            'port_id': hub.get('DeviceID', ''),
                            'name': hub.get('Name', ''),
                            'description': hub.get('Description', ''),
                            'status': hub.get('Status', ''),
                            'type': 'hub',
                            'system': 'Windows',
                            'detected_at': datetime.utcnow().isoformat()
                        }
                        ports.append(port_info)
                except json.JSONDecodeError as e:
                    logger.warning(f"فشل في تحليل بيانات USB Hubs: {e}")
            
            # جلب معلومات USB Controllers
            cmd_controllers = [
                'powershell', '-NoProfile', '-NonInteractive', '-Command',
                'Get-WmiObject -Class Win32_USBController | Select-Object DeviceID, Name, Description, Status | ConvertTo-Json'
            ]
            
            result_controllers = subprocess.run(cmd_controllers, capture_output=True, text=True, timeout=30)
            
            if result_controllers.returncode == 0 and result_controllers.stdout.strip():
                try:
                    controller_data = json.loads(result_controllers.stdout)
                    if not isinstance(controller_data, list):
                        controller_data = [controller_data]
                    
                    for controller in controller_data:
                        port_info = {
                            'port_id': controller.get('DeviceID', ''),
                            'name': controller.get('Name', ''),
                            'description': controller.get('Description', ''),
                            'status': controller.get('Status', ''),
                            'type': 'controller',
                            'system': 'Windows',
                            'detected_at': datetime.utcnow().isoformat()
                        }
                        ports.append(port_info)
                except json.JSONDecodeError as e:
                    logger.warning(f"فشل في تحليل بيانات USB Controllers: {e}")
            
            # جلب الأجهزة المتصلة حالياً
            cmd_devices = [
                'powershell', '-NoProfile', '-NonInteractive', '-Command',
                'Get-PnpDevice -Class USB | Where-Object {$_.Status -eq "OK"} | Select-Object InstanceId, FriendlyName, Status, Class | ConvertTo-Json'
            ]
            
            result_devices = subprocess.run(cmd_devices, capture_output=True, text=True, timeout=30)
            
            if result_devices.returncode == 0 and result_devices.stdout.strip():
                try:
                    device_data = json.loads(result_devices.stdout)
                    if not isinstance(device_data, list):
                        device_data = [device_data]
                    
                    for device in device_data:
                        device_info = {
                            'port_id': device.get('InstanceId', ''),
                            'name': device.get('FriendlyName', ''),
                            'status': device.get('Status', ''),
                            'class': device.get('Class', ''),
                            'type': 'device',
                            'system': 'Windows',
                            'detected_at': datetime.utcnow().isoformat()
                        }
                        ports.append(device_info)
                except json.JSONDecodeError as e:
                    logger.warning(f"فشل في تحليل بيانات USB Devices: {e}")
            
            # إضافة معلومات المنافذ الفيزيائية
            physical_ports = self._get_windows_physical_ports()
            ports.extend(physical_ports)
                            
        except Exception as e:
            logger.error(f"خطأ في جلب USB ports من Windows: {e}")
        
        return ports
    
    def _get_windows_physical_ports(self) -> List[Dict[str, Any]]:
        """جلب معلومات المنافذ الفيزيائية في Windows"""
        physical_ports = []
        try:
            # جلب معلومات المنافذ من Registry
            cmd_registry = [
                'powershell', '-NoProfile', '-NonInteractive', '-Command',
                'Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\USB\\*\\*" | Select-Object PSChildName, FriendlyName | ConvertTo-Json'
            ]
            
            result = subprocess.run(cmd_registry, capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0 and result.stdout.strip():
                try:
                    registry_data = json.loads(result.stdout)
                    if not isinstance(registry_data, list):
                        registry_data = [registry_data]

                    port_count = 1
                    for item in registry_data:
                        if item.get('PSChildName'):
                            physical_ports.append({
                                'port_id': f'USB_PORT_{port_count}',
                                'name': f'Physical USB Port {port_count}',
                                'description': item.get('FriendlyName', f'USB Port {port_count}'),
                                'status': 'Available',
                                'type': 'physical_port',
                                'system': 'Windows',
                                'detected_at': datetime.utcnow().isoformat()
                            })
                            port_count += 1
                except json.JSONDecodeError:
                    # If registry parsing failed, do not fabricate fake ports.
                    # Returning an empty list is preferable to adding phantom ports
                    # which lead to incorrect device discovery/counts in UIs.
                    logger.debug("Windows registry USB port parsing failed; returning empty physical ports list")
                    return []
        except Exception as e:
            logger.warning(f"خطأ في جلب المنافذ الفيزيائية: {e}")
            # Do not fabricate ports on error — return an empty list so callers
            # rely on actual discovered devices instead of synthetic placeholders.
            return []
        
        return physical_ports
    
    def _get_linux_usb_ports(self) -> List[Dict[str, Any]]:
        """جلب USB ports في Linux مع دعم محسّن"""
        ports = []
        try:
            # جلب USB Controllers أولاً
            controllers = self._get_linux_usb_controllers()
            ports.extend(controllers)
            
            # جلب USB Hubs
            hubs = self._get_linux_usb_hubs()
            ports.extend(hubs)
            
            # جلب الأجهزة المتصلة باستخدام lsusb
            devices = self._get_linux_connected_devices()
            ports.extend(devices)
            
            # جلب المنافذ الفيزيائية
            physical_ports = self._get_linux_physical_ports()
            ports.extend(physical_ports)
            
            # قراءة معلومات إضافية من /sys/bus/usb/devices
            sys_devices = self._get_linux_sys_devices()
            ports.extend(sys_devices)
                            
        except Exception as e:
            logger.error(f"خطأ في جلب USB ports من Linux: {e}")
        
        return ports
    
    def _get_linux_usb_controllers(self) -> List[Dict[str, Any]]:
        """جلب USB Controllers في Linux"""
        controllers = []
        try:
            # قراءة /proc/bus/usb/devices للحصول على controllers
            if os.path.exists('/proc/bus/usb/devices'):
                with open('/proc/bus/usb/devices', 'r') as f:
                    content = f.read()
                
                devices = content.split('\n\n')
                controller_count = 1
                
                for device in devices:
                    if device.strip() and 'T:' in device:
                        lines = device.split('\n')
                        for line in lines:
                            if line.startswith('T:') and 'Bus=' in line:
                                controllers.append({
                                    'port_id': f'USB_CONTROLLER_{controller_count}',
                                    'name': f'USB Controller {controller_count}',
                                    'description': 'USB Host Controller',
                                    'status': 'Active',
                                    'type': 'controller',
                                    'system': 'Linux',
                                    'detected_at': datetime.utcnow().isoformat()
                                })
                                controller_count += 1
                                break
        except Exception as e:
            logger.warning(f"خطأ في جلب USB Controllers: {e}")
        
        return controllers
    
    def _get_linux_usb_hubs(self) -> List[Dict[str, Any]]:
        """جلب USB Hubs في Linux"""
        hubs = []
        try:
            # البحث عن USB hubs في /sys/bus/usb/devices
            sys_usb_path = '/sys/bus/usb/devices'
            if os.path.exists(sys_usb_path):
                hub_count = 1
                for device_dir in os.listdir(sys_usb_path):
                    device_path = os.path.join(sys_usb_path, device_dir)
                    
                    # فحص إذا كان hub
                    dev_class_path = os.path.join(device_path, 'bDeviceClass')
                    if os.path.exists(dev_class_path):
                        with open(dev_class_path, 'r') as f:
                            dev_class = f.read().strip()
                            if dev_class == '09':  # USB Hub class
                                hubs.append({
                                    'port_id': f'USB_HUB_{hub_count}',
                                    'name': f'USB Hub {hub_count}',
                                    'description': f'USB Hub ({device_dir})',
                                    'status': 'Active',
                                    'type': 'hub',
                                    'device_path': device_dir,
                                    'system': 'Linux',
                                    'detected_at': datetime.utcnow().isoformat()
                                })
                                hub_count += 1
        except Exception as e:
            logger.warning(f"خطأ في جلب USB Hubs: {e}")
        
        return hubs
    
    def _get_linux_connected_devices(self) -> List[Dict[str, Any]]:
        """جلب الأجهزة المتصلة في Linux"""
        devices = []
        try:
            # استخدام lsusb command
            result = subprocess.run(['lsusb'], capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                lines = result.stdout.strip().split('\n')
                for line in lines:
                    if line.strip():
                        device_info = self._parse_lsusb_output(line)
                        if device_info:
                            device_info['type'] = 'connected_device'
                            devices.append(device_info)
        except FileNotFoundError:
            logger.warning("lsusb command غير متوفر")
        except Exception as e:
            logger.warning(f"خطأ في جلب الأجهزة المتصلة: {e}")
        
        return devices
    
    def _get_linux_physical_ports(self) -> List[Dict[str, Any]]:
        """جلب المنافذ الفيزيائية في Linux"""
        physical_ports = []
        try:
            # فحص /sys/bus/usb/devices للحصول على عدد المنافذ
            sys_usb_path = '/sys/bus/usb/devices'
            port_count = 0
            
            if os.path.exists(sys_usb_path):
                for device_dir in os.listdir(sys_usb_path):
                    if device_dir.startswith('usb'):
                        # فحص maxchild لمعرفة عدد المنافذ
                        maxchild_path = os.path.join(sys_usb_path, device_dir, 'maxchild')
                        if os.path.exists(maxchild_path):
                            with open(maxchild_path, 'r') as f:
                                try:
                                    max_ports = int(f.read().strip())
                                    port_count += max_ports
                                except ValueError:
                                    continue
            
            # إنشاء قائمة المنافذ الفيزيائية
            if port_count == 0:
                port_count = 8  # قيمة افتراضية
            
            for i in range(1, port_count + 1):
                physical_ports.append({
                    'port_id': f'USB_PORT_{i}',
                    'name': f'Physical USB Port {i}',
                    'description': f'USB Port {i}',
                    'status': 'Available',
                    'type': 'physical_port',
                    'system': 'Linux',
                    'detected_at': datetime.utcnow().isoformat()
                })
                
        except Exception as e:
            logger.warning(f"خطأ في جلب المنافذ الفيزيائية: {e}")
            # قيم افتراضية في حالة الخطأ
            for i in range(1, 9):
                physical_ports.append({
                    'port_id': f'USB_PORT_{i}',
                    'name': f'Physical USB Port {i}',
                    'description': f'USB Port {i}',
                    'status': 'Available',
                    'type': 'physical_port',
                    'system': 'Linux',
                    'detected_at': datetime.utcnow().isoformat()
                })
        
        return physical_ports
    
    def _get_linux_sys_devices(self) -> List[Dict[str, Any]]:
        """جلب معلومات الأجهزة من /sys/bus/usb/devices"""
        sys_devices = []
        try:
            sys_usb_path = '/sys/bus/usb/devices'
            if os.path.exists(sys_usb_path):
                for device_dir in os.listdir(sys_usb_path):
                    if not device_dir.startswith('usb') and ':' in device_dir:
                        device_info = self._get_sys_usb_info(device_dir)
                        if device_info:
                            device_info['type'] = 'sys_device'
                            sys_devices.append(device_info)
        except Exception as e:
            logger.warning(f"خطأ في جلب أجهزة sys: {e}")
        
        return sys_devices
    
    def _parse_linux_usb_device(self, device_content: str) -> Optional[Dict[str, Any]]:
        """تحليل محتوى جهاز USB من /proc/bus/usb/devices"""
        try:
            lines = device_content.split('\n')
            port_info = {
                'system': 'Linux',
                'detected_at': datetime.utcnow().isoformat()
            }
            
            for line in lines:
                if line.startswith('T:'):
                    # Bus info
                    parts = line.split()
                    if len(parts) >= 4:
                        port_info['port_id'] = f"{parts[1]}-{parts[2]}.{parts[3]}"
                elif line.startswith('S:'):
                    # String info
                    if 'Manufacturer=' in line:
                        port_info['manufacturer'] = line.split('Manufacturer=')[1].strip()
                    elif 'Product=' in line:
                        port_info['product'] = line.split('Product=')[1].strip()
                elif line.startswith('P:'):
                    # Product info
                    parts = line.split()
                    if len(parts) >= 3:
                        port_info['vendor_id'] = parts[1]
                        port_info['product_id'] = parts[2]
            
            return port_info if 'port_id' in port_info else None
            
        except Exception as e:
            logger.error(f"خطأ في تحليل جهاز USB: {e}")
            return None
    
    def _parse_lsusb_output(self, line: str) -> Optional[Dict[str, Any]]:
        """تحليل مخرجات lsusb command"""
        try:
            # مثال: Bus 001 Device 002: ID 046d:c52b Logitech, Inc. Unifying Receiver
            parts = line.split()
            if len(parts) >= 6:
                bus_device = parts[2].split(':')
                if len(bus_device) == 2:
                    port_info = {
                        'port_id': f"{parts[1]}-{bus_device[0]}.{bus_device[1]}",
                        'vendor_id': parts[3].split(':')[0],
                        'product_id': parts[3].split(':')[1],
                        'manufacturer': ' '.join(parts[4:]),
                        'system': 'Linux',
                        'detected_at': datetime.utcnow().isoformat()
                    }
                    return port_info
        except Exception as e:
            logger.error(f"خطأ في تحليل lsusb output: {e}")
        
        return None
    
    def _get_sys_usb_info(self, device_dir: str) -> Optional[Dict[str, Any]]:
        """جلب معلومات USB من /sys/bus/usb/devices"""
        try:
            sys_path = f'/sys/bus/usb/devices/{device_dir}'
            
            port_info = {
                'port_id': device_dir,
                'system': 'Linux',
                'detected_at': datetime.utcnow().isoformat()
            }
            
            # قراءة vendor_id
            vendor_file = os.path.join(sys_path, 'idVendor')
            if os.path.exists(vendor_file):
                with open(vendor_file, 'r') as f:
                    port_info['vendor_id'] = f.read().strip()
            
            # قراءة product_id
            product_file = os.path.join(sys_path, 'idProduct')
            if os.path.exists(product_file):
                with open(product_file, 'r') as f:
                    port_info['product_id'] = f.read().strip()
            
            # قراءة manufacturer
            manufacturer_file = os.path.join(sys_path, 'manufacturer')
            if os.path.exists(manufacturer_file):
                with open(manufacturer_file, 'r') as f:
                    port_info['manufacturer'] = f.read().strip()
            
            # قراءة product
            product_name_file = os.path.join(sys_path, 'product')
            if os.path.exists(product_name_file):
                with open(product_name_file, 'r') as f:
                    port_info['product'] = f.read().strip()
            
            return port_info if 'vendor_id' in port_info else None
            
        except Exception as e:
            logger.error(f"خطأ في قراءة معلومات USB من sys: {e}")
            return None
    
    def _get_macos_usb_ports(self) -> List[Dict[str, Any]]:
        """جلب USB ports في macOS"""
        ports = []
        try:
            # استخدام system_profiler
            cmd = ['system_profiler', 'SPUSBDataType', '-xml']
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                # تحليل XML output
                import xml.etree.ElementTree as ET
                root = ET.fromstring(result.stdout)
                
                for device in root.findall('.//dict'):
                    port_info = self._parse_macos_usb_device(device)
                    if port_info:
                        ports.append(port_info)
            
            # استخدام ioreg
            cmd_ioreg = ['ioreg', '-p', 'IOUSB', '-l']
            result_ioreg = subprocess.run(cmd_ioreg, capture_output=True, text=True, timeout=30)
            
            if result_ioreg.returncode == 0:
                lines = result_ioreg.stdout.strip().split('\n')
                for line in lines:
                    if 'USB' in line and 'Product Name' in line:
                        port_info = self._parse_ioreg_output(line)
                        if port_info:
                            ports.append(port_info)

        except Exception as e:
            logger.error(f"خطأ في جلب USB ports من macOS: {e}")
        
        return ports
    
    def _parse_macos_usb_device(self, device_elem) -> Optional[Dict[str, Any]]:
        """تحليل جهاز USB من system_profiler XML"""
        try:
            port_info = {
                'system': 'macOS',
                'detected_at': datetime.utcnow().isoformat()
            }
            
            for key in device_elem.findall('key'):
                key_text = key.text
                if key_text == '_name':
                    value = device_elem.find('string')
                    if value is not None:
                        port_info['name'] = value.text
                elif key_text == 'vendor_id':
                    value = device_elem.find('string')
                    if value is not None:
                        port_info['vendor_id'] = value.text
                elif key_text == 'product_id':
                    value = device_elem.find('string')
                    if value is not None:
                        port_info['product_id'] = value.text
                elif key_text == 'manufacturer':
                    value = device_elem.find('string')
                    if value is not None:
                        port_info['manufacturer'] = value.text
            
            return port_info if 'name' in port_info else None
            
        except Exception as e:
            logger.error(f"خطأ في تحليل جهاز macOS USB: {e}")
            return None
    
    def _parse_ioreg_output(self, line: str) -> Optional[Dict[str, Any]]:
        """تحليل مخرجات ioreg"""
        try:
            if 'Product Name' in line:
                product_name = line.split('"')[1] if '"' in line else 'Unknown'
                port_info = {
                    'name': product_name,
                    'system': 'macOS',
                    'detected_at': datetime.utcnow().isoformat()
                }
                return port_info
        except Exception as e:
            logger.error(f"خطأ في تحليل ioreg output: {e}")
        
        return None
    
    def get_system_info(self) -> Dict[str, Any]:
        """جلب معلومات النظام"""
        try:
            info = {
                'system': self.system,
                'platform': platform.platform(),
                'machine': platform.machine(),
                'processor': platform.processor(),
                'python_version': platform.python_version(),
                'cpu_count': psutil.cpu_count(),
                'memory_total': psutil.virtual_memory().total,
                'memory_available': psutil.virtual_memory().available,
                'disk_usage': psutil.disk_usage('/').percent if os.path.exists('/') else 0,
                'uptime': psutil.boot_time(),
                'hostname': platform.node(),
                'detected_at': datetime.utcnow().isoformat()
            }
            
            # معلومات إضافية حسب النظام
            if self.is_windows:
                info.update(self._get_windows_system_info())
            elif self.is_linux:
                info.update(self._get_linux_system_info())
            elif self.is_darwin:
                info.update(self._get_macos_system_info())
            
            return info
            
        except Exception as e:
            logger.error(f"خطأ في جلب معلومات النظام: {e}")
            return {'system': self.system, 'error': str(e)}
    
    def _get_windows_system_info(self) -> Dict[str, Any]:
        """جلب معلومات إضافية لنظام Windows"""
        info = {}
        try:
            # استخدام PowerShell لجلب معلومات إضافية مع معالجة أفضل للأخطاء
            cmd = [
                'powershell',
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                'try { Get-ComputerInfo -ErrorAction Stop | Select-Object WindowsProductName, WindowsVersion, TotalPhysicalMemory | ConvertTo-Json -Compress } catch { Write-Error $_.Exception.Message }'
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if result.returncode == 0 and result.stdout.strip():
                try:
                    import json
                    data = json.loads(result.stdout)
                    if isinstance(data, dict):
                        info['os_name'] = data.get('WindowsProductName', 'Windows')
                        info['os_version'] = data.get('WindowsVersion', 'Unknown')
                        info['total_memory'] = data.get('TotalPhysicalMemory', 'Unknown')
                except json.JSONDecodeError:
                    # Fallback to parsing text output
                    lines = result.stdout.strip().split('\n')
                    for line in lines:
                        if line.strip() and '|' in line:
                            parts = line.split('|')
                            if len(parts) >= 3:
                                info['os_name'] = parts[0].strip()
                                info['os_version'] = parts[1].strip()
                                info['total_memory'] = parts[2].strip()
        except Exception as e:
            logger.error(f"خطأ في جلب معلومات Windows: {e}")
        
        return info
    
    def _get_linux_system_info(self) -> Dict[str, Any]:
        """جلب معلومات إضافية لنظام Linux"""
        info = {}
        try:
            # قراءة /etc/os-release
            if os.path.exists('/etc/os-release'):
                with open('/etc/os-release', 'r') as f:
                    for line in f:
                        if '=' in line:
                            key, value = line.strip().split('=', 1)
                            if key == 'PRETTY_NAME':
                                info['os_name'] = value.strip('"')
                            elif key == 'VERSION':
                                info['os_version'] = value.strip('"')
            
            # قراءة /proc/cpuinfo
            if os.path.exists('/proc/cpuinfo'):
                with open('/proc/cpuinfo', 'r') as f:
                    content = f.read()
                    if 'model name' in content:
                        for line in content.split('\n'):
                            if line.startswith('model name'):
                                info['cpu_model'] = line.split(':')[1].strip()
                                break
            
            # قراءة /proc/meminfo
            if os.path.exists('/proc/meminfo'):
                with open('/proc/meminfo', 'r') as f:
                    for line in f:
                        if line.startswith('MemTotal:'):
                            info['total_memory'] = line.split()[1] + ' KB'
                            break
                            
        except Exception as e:
            logger.error(f"خطأ في جلب معلومات Linux: {e}")
        
        return info
    
    def _get_macos_system_info(self) -> Dict[str, Any]:
        """جلب معلومات إضافية لنظام macOS"""
        info = {}
        try:
            # استخدام system_profiler
            cmd = ['system_profiler', 'SPSoftwareDataType', '-xml']
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                import xml.etree.ElementTree as ET
                root = ET.fromstring(result.stdout)
                
                for item in root.findall('.//string'):
                    if item.text and 'macOS' in item.text:
                        info['os_name'] = item.text
                        break
            
            # استخدام sysctl
            cmd_sysctl = ['sysctl', '-n', 'hw.memsize']
            result_sysctl = subprocess.run(cmd_sysctl, capture_output=True, text=True, timeout=30)
            
            if result_sysctl.returncode == 0:
                memory_bytes = int(result_sysctl.stdout.strip())
                info['total_memory'] = f"{memory_bytes // (1024**3)} GB"
                
        except Exception as e:
            logger.error(f"خطأ في جلب معلومات macOS: {e}")
        
        return info

    pass

# إنشاء instance عام للخدمة
usb_service = USBService()

# دوال مساعدة للاستيراد
def enable_usb_port(server_id: int, port_id: str, user_id: int = None) -> Tuple[bool, str, Dict[str, Any]]:
    """تفعيل منفذ USB مع دعم للأنظمة المختلفة"""
    try:
        system = platform.system().lower()
        
        if system == 'windows':
            return enable_usb_port_windows(port_id, user_id)
        elif system == 'linux':
            return enable_usb_port_linux(port_id, user_id)
        else:
            return enable_usb_port_generic(port_id, user_id)
            
    except Exception as e:
        logger.error(f"خطأ في تفعيل المنفذ {port_id}: {e}")
        return False, f"فشل في تفعيل المنفذ: {str(e)}", {}

def disable_usb_port(server_id: int, port_id: str, user_id: int = None) -> Tuple[bool, str, Dict[str, Any]]:
    """تعطيل منفذ USB مع دعم للأنظمة المختلفة"""
    try:
        system = platform.system().lower()
        
        if system == 'windows':
            return disable_usb_port_windows(port_id, user_id)
        elif system == 'linux':
            return disable_usb_port_linux(port_id, user_id)
        else:
            return disable_usb_port_generic(port_id, user_id)
            
    except Exception as e:
        logger.error(f"خطأ في تعطيل المنفذ {port_id}: {e}")
        return False, f"فشل في تعطيل المنفذ: {str(e)}", {}

def enable_usb_port_windows(port_id: str, user_id: int = None) -> Tuple[bool, str, Dict[str, Any]]:
    """تفعيل منفذ USB في Windows - حقيقي بدون محاكاة"""
    try:
        from services.device_blocker import enable_device_real, add_to_approved_list
        
        # إذا كان port_id معرف PnP حقيقي، استخدمه مباشرة
        actual_device_id = port_id
        
        # إذا كان معرف عام (USB_PORT_1, USB1, etc.)، ابحث عن الجهاز الحقيقي
        if (port_id.startswith('USB_PORT_') or 
            port_id.startswith('USB') and port_id[3:].isdigit() or
            port_id.upper().startswith('USB') and len(port_id) <= 6):
            # محاولة البحث عن أقرب جهاز معطل
            try:
                cmd = [
                    'powershell', '-NoProfile', '-NonInteractive', '-Command',
                    'Get-PnpDevice | Where-Object { $_.InstanceId -like "USB\\VID_*" -and $_.Status -ne "OK" -and $_.Present -eq $true } | Select-Object -First 1 -ExpandProperty InstanceId'
                ]
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
                if result.returncode == 0 and result.stdout.strip():
                    actual_device_id = result.stdout.strip()
                else:
                    return False, f"لم يتم العثور على جهاز معطل لتفعيله في المنفذ {port_id}", {}
            except Exception as e:
                return False, f"خطأ في البحث عن الجهاز: {str(e)}", {}
        
        # تفعيل فعلي
        success, msg = enable_device_real(actual_device_id)
        if success:
            add_to_approved_list(actual_device_id)
            return True, f"تم تفعيل المنفذ {port_id} بنجاح (الجهاز: {actual_device_id})", {
                'port_id': port_id,
                'device_id': actual_device_id,
                'enabled': True,
                'timestamp': datetime.utcnow().isoformat(),
                'method': 'real_pnp_enable'
            }
        else:
            return False, f"فشل في تفعيل المنفذ: {msg}", {}
            
    except ImportError:
        # fallback إذا لم يكن device_blocker متاح
        cmd = [
            'powershell', '-NoProfile', '-NonInteractive', '-Command',
            f'Enable-PnpDevice -InstanceId "{port_id}" -Confirm:$false'
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            return True, f"تم تفعيل المنفذ {port_id} بنجاح", {
                'port_id': port_id, 'enabled': True,
                'timestamp': datetime.utcnow().isoformat(), 'method': 'powershell_direct'
            }
        return False, f"فشل في تفعيل المنفذ: {result.stderr}", {}
    except Exception as e:
        return False, f"خطأ: {str(e)}", {}

def disable_usb_port_windows(port_id: str, user_id: int = None) -> Tuple[bool, str, Dict[str, Any]]:
    """تعطيل منفذ USB في Windows - حقيقي بدون محاكاة"""
    try:
        from services.device_blocker import disable_device_real
        
        # إذا كان port_id معرف PnP حقيقي، استخدمه مباشرة
        actual_device_id = port_id
        
        # إذا كان معرف عام، ابحث عن الجهاز النشط
        if (port_id.startswith('USB_PORT_') or 
            port_id.startswith('USB') and port_id[3:].isdigit() or
            port_id.upper().startswith('USB') and len(port_id) <= 6):
            try:
                cmd = [
                    'powershell', '-NoProfile', '-NonInteractive', '-Command',
                    'Get-PnpDevice | Where-Object { $_.InstanceId -like "USB\\VID_*" -and $_.Status -eq "OK" -and $_.Present -eq $true } | Select-Object -First 1 -ExpandProperty InstanceId'
                ]
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
                if result.returncode == 0 and result.stdout.strip():
                    actual_device_id = result.stdout.strip()
                else:
                    return False, f"لم يتم العثور على جهاز نشط لتعطيله في المنفذ {port_id}", {}
            except Exception as e:
                return False, f"خطأ في البحث عن الجهاز: {str(e)}", {}
        
        # تعطيل فعلي
        success, msg = disable_device_real(actual_device_id)
        if success:
            return True, f"تم تعطيل المنفذ {port_id} بنجاح (الجهاز: {actual_device_id})", {
                'port_id': port_id,
                'device_id': actual_device_id,
                'enabled': False,
                'timestamp': datetime.utcnow().isoformat(),
                'method': 'real_pnp_disable'
            }
        else:
            return False, f"فشل في تعطيل المنفذ: {msg}", {}
            
    except ImportError:
        cmd = [
            'powershell', '-NoProfile', '-NonInteractive', '-Command',
            f'Disable-PnpDevice -InstanceId "{port_id}" -Confirm:$false'
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            return True, f"تم تعطيل المنفذ {port_id} بنجاح", {
                'port_id': port_id, 'enabled': False,
                'timestamp': datetime.utcnow().isoformat(), 'method': 'powershell_direct'
            }
        return False, f"فشل في تعطيل المنفذ: {result.stderr}", {}
    except Exception as e:
        return False, f"خطأ: {str(e)}", {}

def enable_usb_port_linux(port_id: str, user_id: int = None) -> Tuple[bool, str, Dict[str, Any]]:
    """تفعيل منفذ USB في Linux"""
    try:
        # بحث عن المنفذ في /sys/bus/usb/devices
        sys_usb_path = '/sys/bus/usb/devices'
        if os.path.exists(sys_usb_path):
            for device_dir in os.listdir(sys_usb_path):
                if port_id in device_dir:
                    authorized_path = os.path.join(sys_usb_path, device_dir, 'authorized')
                    if os.path.exists(authorized_path):
                        with open(authorized_path, 'w') as f:
                            f.write('1')
                        return True, f"تم تفعيل المنفذ {port_id}", {
                            'port_id': port_id,
                            'enabled': True,
                            'timestamp': datetime.utcnow().isoformat()
                        }
        return False, f"لم يتم العثور على {port_id}", {}
    except Exception as e:
        return False, f"خطأ: {str(e)}", {}

def disable_usb_port_linux(port_id: str, user_id: int = None) -> Tuple[bool, str, Dict[str, Any]]:
    """تعطيل منفذ USB في Linux"""
    try:
        sys_usb_path = '/sys/bus/usb/devices'
        if os.path.exists(sys_usb_path):
            for device_dir in os.listdir(sys_usb_path):
                if port_id in device_dir:
                    authorized_path = os.path.join(sys_usb_path, device_dir, 'authorized')
                    if os.path.exists(authorized_path):
                        with open(authorized_path, 'w') as f:
                            f.write('0')
                        return True, f"تم تعطيل المنفذ {port_id}", {
                            'port_id': port_id,
                            'enabled': False,
                            'timestamp': datetime.utcnow().isoformat()
                        }
        return False, f"لم يتم العثور على {port_id}", {}
    except Exception as e:
        return False, f"خطأ: {str(e)}", {}

def enable_usb_port_generic(port_id: str, user_id: int = None) -> Tuple[bool, str, Dict[str, Any]]:
    return True, f"تم تفعيل {port_id} (محاكاة)", {'port_id': port_id, 'enabled': True}

def disable_usb_port_generic(port_id: str, user_id: int = None) -> Tuple[bool, str, Dict[str, Any]]:
    return True, f"تم تعطيل {port_id} (محاكاة)", {'port_id': port_id, 'enabled': False}

def get_usb_ports(server_id: int = None) -> List[Dict[str, Any]]:
    """جلب USB ports"""
    # Return only real devices by default so callers get the same
    # client-like discovery behavior and internal components are ignored.
    return usb_service.get_usb_ports(devices_only=True)

def get_system_info() -> Dict[str, Any]:
    """جلب معلومات النظام"""
    return usb_service.get_system_info()

def get_usb_port_status(port_id: str) -> Dict[str, Any]:
    """جلب حالة منفذ USB"""
    try:
        ports = usb_service.get_usb_ports(devices_only=True)
        for port in ports:
            if port.get('port_id') == port_id:
                return {
                    'success': True,
                    'port_id': port_id,
                    'status': port.get('status', 'unknown'),
                    'enabled': port.get('status', '').lower() == 'ok',
                    'details': port
                }
        return {
            'success': False,
            'message': f'لم يتم العثور على المنفذ {port_id}',
            'port_id': port_id
        }
    except Exception as e:
        logger.error(f"خطأ في جلب حالة المنفذ {port_id}: {e}")
        return {
            'success': False,
            'message': f'خطأ في جلب حالة المنفذ {port_id}',
            'error': str(e)
        }

def get_power_analytics() -> Dict[str, Any]:
    """جلب تحليلات الطاقة"""
    try:
        system_info = usb_service.get_system_info()
        ports = usb_service.get_usb_ports(devices_only=True)
        
        # حساب استهلاك الطاقة التقريبي
        total_power = 0
        device_count = len(ports)
        
        # كل جهاز USB يستهلك حوالي 500mW تقريباً
        estimated_power_per_device = 0.5  # واط
        
        for port in ports:
            if port.get('status', '').lower() == 'ok':
                total_power += estimated_power_per_device
        
        return {
            'success': True,
            'total_power_consumption': total_power,
            'device_count': device_count,
            'active_devices': len([p for p in ports if p.get('status', '').lower() == 'ok']),
            'system_info': system_info,
            'ports': ports,
            'timestamp': datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"خطأ في جلب تحليلات الطاقة: {e}")
        return {
            'success': False,
            'message': 'خطأ في جلب تحليلات الطاقة',
            'error': str(e)
        }

    def control_usb_device(self, device_id: str, action: str) -> Dict[str, Any]:
        """التحكم في جهاز USB (enable/disable)"""
        try:
            if self.is_windows:
                return self._control_windows_usb_device(device_id, action)
            elif self.is_linux:
                return self._control_linux_usb_device(device_id, action)
            elif self.is_darwin:
                return self._control_macos_usb_device(device_id, action)
            else:
                return {
                    'success': False,
                    'message': f'نظام التشغيل غير مدعوم: {self.system}'
                }
        except Exception as e:
            logger.error(f"خطأ في التحكم في جهاز USB: {e}")
            return {
                'success': False,
                'message': 'خطأ في التحكم في الجهاز',
                'error': str(e)
            }

    def _control_windows_usb_device(self, device_id: str, action: str) -> Dict[str, Any]:
        """التحكم في جهاز USB في Windows"""
        try:
            if action.lower() == 'disable':
                cmd = [
                    'powershell', '-NoProfile', '-NonInteractive', '-Command',
                    f'Get-PnpDevice | Where-Object {{$_.InstanceId -eq "{device_id}"}} | Disable-PnpDevice -Confirm:$false'
                ]
            elif action.lower() == 'enable':
                cmd = [
                    'powershell', '-NoProfile', '-NonInteractive', '-Command',
                    f'Get-PnpDevice | Where-Object {{$_.InstanceId -eq "{device_id}"}} | Enable-PnpDevice -Confirm:$false'
                ]
            else:
                return {
                    'success': False,
                    'message': f'الإجراء غير مدعوم: {action}'
                }
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                return {
                    'success': True,
                    'message': f'تم {action} الجهاز بنجاح',
                    'device_id': device_id,
                    'action': action
                }
            else:
                return {
                    'success': False,
                    'message': f'فشل في {action} الجهاز',
                    'error': result.stderr
                }
        except Exception as e:
            return {
                'success': False,
                'message': 'خطأ في التحكم في الجهاز',
                'error': str(e)
            }

    def _control_linux_usb_device(self, device_id: str, action: str) -> Dict[str, Any]:
        """التحكم في جهاز USB في Linux"""
        try:
            # في Linux، يمكن استخدام udev rules أو usb_modeswitch
            # هذا مثال بسيط، قد يحتاج تعديل حسب النظام
            if action.lower() == 'disable':
                cmd = ['sudo', 'udevadm', 'control', '--stop-exec-queue']
                # ثم إضافة rule لمنع الجهاز
            elif action.lower() == 'enable':
                cmd = ['sudo', 'udevadm', 'control', '--start-exec-queue']
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                return {
                    'success': True,
                    'message': f'تم {action} الجهاز بنجاح',
                    'device_id': device_id,
                    'action': action
                }
            else:
                return {
                    'success': False,
                    'message': f'فشل في {action} الجهاز',
                    'error': result.stderr
                }
        except Exception as e:
            return {
                'success': False,
                'message': 'خطأ في التحكم في الجهاز',
                'error': str(e)
            }

    def _control_macos_usb_device(self, device_id: str, action: str) -> Dict[str, Any]:
        """التحكم في جهاز USB في macOS"""
        try:
            # في macOS، يمكن استخدام system_profiler و diskutil
            if action.lower() == 'disable':
                cmd = ['diskutil', 'unmount', f'/dev/{device_id}']
            elif action.lower() == 'enable':
                cmd = ['diskutil', 'mount', f'/dev/{device_id}']
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                return {
                    'success': True,
                    'message': f'تم {action} الجهاز بنجاح',
                    'device_id': device_id,
                    'action': action
                }
            else:
                return {
                    'success': False,
                    'message': f'فشل في {action} الجهاز',
                    'error': result.stderr
                }
        except Exception as e:
            return {
                'success': False,
                'message': 'خطأ في التحكم في الجهاز',
                'error': str(e)
            }

