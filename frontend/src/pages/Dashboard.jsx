// src/pages/Dashboard.jsx

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchDashboardOverview,
  fetchDashboardServers,
  getAlerts,
  fetchLogs,
  listDevices,
  controlDevice,
  enableUsbPort,
  disableUsbPort,
  bulkEnableAllUsbPorts,
  bulkDisableAllUsbPorts,
  clearAllDevices,
  clearAllAlerts,
  clearAllLogs,
  fetchAgentPendingDevices,
  fetchBlockedDevices
} from '../utils/api';
import useAuth from '../hooks/useAuth';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { toast } from 'react-toastify';
import useSocketEvent from '../hooks/useSocketEvent';
import PowerAnalytics from '../components/PowerAnalytics';
import { getServerStatusText, getServerStatusColor, isServerOnline } from '../utils/formatters';

ChartJS.register(ArcElement, Tooltip, Legend);

// CSS Styles للبطاقات المحسنة
const styles = `
  .hover-bg-light:hover {
    background-color: var(--light) !important;
    transition: background-color 0.2s ease;
  }
  
  .device-icon {
    width: 50px;
    height: 50px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%);
    border-radius: 50%;
    color: white;
  }
  
  .btn-group .btn {
    font-size: 0.75rem;
    padding: 0.375rem 0.75rem;
  }
  
  .bg-gradient {
    background: linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%) !important;
  }
  
  .card-shadow {
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
  }
  
  /* تأثيرات متقدمة للبطاقة المحسنة */
  @keyframes shimmer {
    0% { 
      transform: translateX(-100%); 
      opacity: 0;
    }
    50% {
      opacity: 1;
    }
    100% { 
      transform: translateX(100%); 
      opacity: 0;
    }
  }
  
  @keyframes pulse-glow {
    0%, 100% {
      box-shadow: 0 8px 25px rgba(86, 171, 47, 0.3);
    }
    50% {
      box-shadow: 0 12px 35px rgba(86, 171, 47, 0.5);
    }
  }
  
  @keyframes pulse-glow-danger {
    0%, 100% {
      box-shadow: 0 8px 25px rgba(255, 65, 108, 0.3);
    }
    50% {
      box-shadow: 0 12px 35px rgba(255, 65, 108, 0.5);
    }
  }
  
  .hover-effect:hover {
    transform: translateY(-2px) !important;
    box-shadow: 0 12px 25px rgba(0,0,0,0.15) !important;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  .btn-enhanced {
    position: relative;
    overflow: hidden;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    border: none;
    border-radius: 12px;
  }
  
  .btn-enhanced:hover {
    transform: translateY(-3px) scale(1.02);
  }
  
  .btn-enhanced:active {
    transform: translateY(-1px) scale(0.98);
  }
  
  .btn-enhanced.processing {
    animation: pulse-glow 2s infinite;
  }
  
  .btn-enhanced.processing.btn-danger {
    animation: pulse-glow-danger 2s infinite;
  }
  
  .processing {
    animation: pulse-glow 2s infinite;
  }
  
  .processing.bg-danger {
    animation: pulse-glow-danger 2s infinite;
  }
  
  .cursor-pointer {
    cursor: pointer;
  }
  
  .progress-animated {
    background: linear-gradient(90deg, var(--primary-color), #6610f2, #e83e8c, #fd7e14, var(--secondary-color), var(--primary-color));
    background-size: 200% 100%;
    animation: gradient-shift 2s linear infinite;
  }
  
  @keyframes gradient-shift {
    0% { background-position: 0% 0%; }
    100% { background-position: 200% 0%; }
  }
  
  .blink {
    animation: blink 1.5s infinite;
  }
  
  @keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0.3; }
  }
  
  .card-professional {
    backdrop-filter: blur(10px);
    background: rgba(255, 255, 255, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
  
  .status-indicator {
    position: relative;
    display: inline-block;
  }
  
  .status-indicator::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    animation: ripple 2s infinite;
  }
  
  .status-indicator.active::after {
    background: rgba(40, 167, 69, 0.3);
  }
  
  .status-indicator.inactive::after {
    background: rgba(220, 53, 69, 0.3);
  }
  
  @keyframes ripple {
    0% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 1;
    }
    100% {
      transform: translate(-50%, -50%) scale(2);
      opacity: 0;
    }
  }
`;

function Dashboard() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [overview, setOverview] = useState({});
  const [servers, setServers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [activity, setActivity] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState({});
  const [showAllDevices, setShowAllDevices] = useState(false);
  const [clearing, setClearing] = useState({});
  const [forceUpdate, setForceUpdate] = useState(0); // إضافة آلية إجبار إعادة العرض
  const [agentPendingCount, setAgentPendingCount] = useState(0); // عداد الأجهزة المعلقة من العملاء
  const [serverPendingCount, setServerPendingCount] = useState(0); // عداد الأجهزة المعلقة من السيرفر
  const [blockerPendingCount, setBlockerPendingCount] = useState(0); // عداد الأجهزة المكتشفة من البلوكر

  // دالة مساعدة لتوليد منافذ افتراضية
  const generateDefaultPorts = useCallback((count) => {
    const ports = [];
    for (let i = 1; i <= count; i++) {
      ports.push({
        port_id: `USB${i}`,
        name: `USB Port ${i}`,
        enabled: true,
        status: 'active',
        device_name: null,
        device_serial: null
      });
    }
    return ports;
  }, []);

  // تحويل بيانات الإحصائيات إلى منافذ
  const _generatePortsFromStats = useCallback((statsData) => {
    const ports = [];
    const totalPorts = statsData.total_ports || 8;
    const enabledPorts = statsData.total_enabled_ports || totalPorts;
    const _disabledPorts = statsData.total_disabled_ports || 0;

    for (let i = 1; i <= totalPorts; i++) {
      ports.push({
        port_id: `USB${i}`,
        name: `USB Port ${i}`,
        enabled: i <= enabledPorts,
        status: i <= enabledPorts ? 'active' : 'disabled',
        device_name: null,
        device_serial: null
      });
    }

    return ports;
  }, []);

  // دالة بديلة لجلب بيانات الخوادم
  const _getFallbackServersData = useCallback(async () => {
    try {
      // محاولة جلب بيانات من مصادر مختلفة
      const allPortsResponse = await fetch('/api/servers/all-usb-ports', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });

      if (allPortsResponse.ok) {
        const allPortsData = await allPortsResponse.json();
        // تجميع المنافذ بواسطة الخادم
        const serverPortsMap = {};
        (allPortsData.usb_ports || []).forEach(port => {
          if (!serverPortsMap[port.server_id]) {
            serverPortsMap[port.server_id] = {
              id: port.server_id,
              name: port.server_name || `Server ${port.server_id}`,
              ip_address: port.server_ip || 'localhost',
              is_active: true,
              ports: []
            };
          }
          serverPortsMap[port.server_id].ports.push(port);
        });

        return Object.values(serverPortsMap);
      }
    } catch (error) {
      // console.warn('Fallback method also failed:', error);
    }

    // العودة إلى خادم افتراضي واحد
    return [{
      id: 1,
      name: 'الخادم الرئيسي',
      ip_address: 'localhost',
      is_active: true,
      ports: generateDefaultPorts(8),
      total_ports: 8
    }];
  }, [generateDefaultPorts]);

  // دالة مبسطة لجلب الخوادم مع المنافذ
  const fetchServersWithPorts = useCallback(async () => {
    try {
      // جلب قائمة الخوادم أولاً
      const serversData = await fetchDashboardServers();
      const servers = Array.isArray(serversData) ? serversData : [];

      if (servers.length === 0) {
        return [{
          id: 1,
          name: 'الخادم الرئيسي',
          ip_address: 'localhost',
          is_active: true,
          ports: generateDefaultPorts(8),
          total_ports: 8
        }];
      }

      // إضافة منافذ افتراضية لكل خادم لتحسين الأداء
      const serversWithPorts = servers.map(server => ({
        ...server,
        ports: generateDefaultPorts(8),
        total_ports: 8
      }));

      return serversWithPorts;
    } catch (error) {
      // في حالة الخطأ، إرجاع خادم افتراضي
      return [{
        id: 1,
        name: 'الخادم الرئيسي',
        ip_address: 'localhost',
        is_active: true,
        ports: generateDefaultPorts(8),
        total_ports: 8
      }];
    }
  }, [generateDefaultPorts]);

  const loadAll = useCallback(async (isInitial = false) => {
    // فقط أظهر loading في التحميل الأولي
    if (isInitial) {
      setLoading(true);
    }

    try {
      // تحميل جميع البيانات بشكل متوازي (بما في ذلك السجلات والخوادم والأجهزة المعلقة من العملاء)
      const [
        overviewData,
        devicesData,
        _pendingDevicesData,
        alertsData,
        logsData,
        serversData,
        agentPendingData,
        blockerData
      ] = await Promise.all([
        fetchDashboardOverview().catch(() => ({ data: {} })),
        listDevices({ real_only: true, all_servers: true }).catch(() => ({ data: [], summary: {} })),
        listDevices({ status: 'pending', real_only: true, all_servers: true }).catch(() => ({ data: [], summary: {} })),
        getAlerts().catch(() => []),
        fetchLogs(5).catch(() => ({ logs: [] })),
        fetchServersWithPorts().catch(() => [{
          id: 1,
          name: 'الخادم الرئيسي',
          ip_address: 'localhost',
          is_active: true,
          ports: generateDefaultPorts(8),
          total_ports: 8
        }]),
        fetchAgentPendingDevices({ status: 'pending', all_servers: true }).catch(() => ({ devices: [], total: 0 })),
        fetchBlockedDevices().catch(() => ({ blocked_devices: [], count: 0 }))
      ]);

      // تحديث جميع البيانات فوراً
      const newOverview = overviewData?.data || overviewData || {};
      const newDevices = Array.isArray(devicesData?.data) ? devicesData.data :
        Array.isArray(devicesData) ? devicesData : [];
      const newAlerts = Array.isArray(alertsData?.alerts || alertsData) ? (alertsData?.alerts || alertsData) : [];
      const newLogs = Array.isArray(logsData?.logs || logsData) ? (logsData?.logs || logsData) : [];
      const newServers = Array.isArray(serversData) ? serversData : [];

// قوائم وعدادات أجهزة العملاء والسيرفر (من الجداول المعزولة)
        const allPendingList = agentPendingData?.devices || [];
        const agentPendingTotal = allPendingList.filter(d => d.source === 'agent').length;
        const serverPendingTotal = allPendingList.filter(d => d.source === 'server').length;
        setAgentPendingCount(agentPendingTotal);
        setServerPendingCount(serverPendingTotal);

        // قوائم وعدادات الأجهزة المكتشفة من البلوكر (ذاكرة مؤقتة)
        const blockerDevicesList = blockerData?.blocked_devices || [];
        const blockerTotal = blockerDevicesList.length || blockerData?.count || 0;
        setBlockerPendingCount(blockerTotal);

        // === حساب الأجهزة المعلقة ===
        // حساب إجمالي الأجهزة المعلقة من جميع المصادر (سيرفر + عملاء) بناءً على قاعدة البيانات
      const pendingCount = serverPendingTotal + agentPendingTotal;
      
      // الأجهزة الموافق عليها فقط
      const approvedDevices = newDevices.filter(d =>
        d.status !== 'pending' && d.status !== 'waiting' && d.status !== 'discovered' && d.status !== 'agent_pending'
      );
      
      const isDeviceConnected = (d) => d.is_connected === true || d.status === 'connected';

      const connectedCount = approvedDevices.filter(d => isDeviceConnected(d) && d.status !== 'denied' && d.status !== 'blocked').length;
      
      const disconnectedCount = approvedDevices.filter(d => !isDeviceConnected(d) && d.status !== 'denied' && d.status !== 'blocked').length;
      const deniedCount = newDevices.filter(d => d.status === 'denied' || d.status === 'blocked').length;
      const totalApproved = approvedDevices.length;

      // تحديث الـ Overview
      setOverview(prev => ({
        ...prev,
        ...newOverview,
        pending_devices: pendingCount,
        server_pending_devices: serverPendingTotal,
        agent_pending_devices: agentPendingTotal,
        connected_devices: connectedCount,
        disconnected_devices: disconnectedCount,
        denied_devices: deniedCount,
        total_devices: totalApproved + deniedCount
      }));

      setDevices(newDevices);
      setAlerts(newAlerts);
      setLogs(newLogs);
      setActivity(newLogs.slice(0, 10));
      setServers(newServers.length > 0 ? newServers : [{
        id: 1,
        name: 'الخادم الرئيسي',
        ip_address: 'localhost',
        is_active: true,
        ports: generateDefaultPorts(8),
        total_ports: 8
      }]);

    } catch (error) {
      // فقط أظهر خطأ في التحميل الأولي
      if (isInitial) {
        toast.error('حدث خطأ في تحميل بيانات اللوحة الرئيسية');
      }
      // لا تمسح البيانات الموجودة عند الخطأ
    } finally {
      if (isInitial) {
        setLoading(false);
      }
    }
  }, [generateDefaultPorts, fetchServersWithPorts]);



  useEffect(() => {
    if (!currentUser) return;
    loadAll(true); // التحميل الأولي

    // إضافة تحديث دوري كل 60 ثانية للأجهزة (زيادة الفترة لتقليل الوميض)
    const interval = setInterval(() => {
      loadAll(false); // تحديث صامت
    }, 60000); // 60 ثانية بدلاً من 30

    return () => clearInterval(interval);
  }, [loadAll, currentUser]);

  // Socket Events - استخدام تحديث صامت بدلاً من loadAll الكامل
  useSocketEvent('dashboard:update', () => loadAll(false));
  useSocketEvent('port:updated', (data) => {
    toast.info(`تغيير حالة منفذ ${data?.port_id} في الخادم ${data?.server_name || data?.server_id}: ${data?.enabled ? 'مفعل' : 'معطل'}`);
    loadAll(false);
  });

  // الاستماع لجميع أحداث الأجهزة المحددة - تحديث صامت
  useSocketEvent('device:discovered', (data) => {
    const deviceName = data?.device?.name || data?.device_name || data?.serial_number || data?.device?.serial_number || 'Unknown';
    toast.success(`تم اكتشاف جهاز جديد: ${deviceName}`);
    loadAll(false);
  });
  useSocketEvent('device:reconnected', (data) => {
    toast.success(`تم إعادة توصيل جهاز: ${data?.device_name || data?.serial_number || ''}`);
    loadAll(false);
  });
  useSocketEvent('device:disconnected', (data) => {
    toast.warning(`تم فصل جهاز: ${data?.device_name || data?.serial_number || ''}`);
    loadAll(false);
  });
  useSocketEvent('device:added', (data) => {
    toast.info(`تم إضافة جهاز جديد: ${data?.device_name || data?.serial_number || ''}`);
    loadAll(false);
  });
  useSocketEvent('device:updated', (data) => {
    toast.info(`تغيير حالة جهاز ${data?.device_name || data?.device_serial || ''} في الخادم ${data?.server_name || data?.server_id}`);
    loadAll(false);
  });
  useSocketEvent('device:blocked', (data) => {
    toast.error(`🚫 تم حظر جهاز: ${data?.device_name || data?.serial_number || 'غير معروف'}`);
    loadAll(false);
  });

  useSocketEvent('alert:new', (data) => {
    toast.error(`تنبيه أمني: ${data.message}`);
    loadAll(false);
  });

  // Electron IPC Events
  useEffect(() => {
    if (window.electronAPI) {
      const handlePendingRemoved = (event, data) => {
        // eslint-disable-next-line no-console
        console.log('IPC: pending-device-removed', data);
        if (data && data.message) {
          toast.warning(data.message);
        }
        loadAll(false);
      };

      const handleDeviceApproved = (event, data) => {
        // eslint-disable-next-line no-console
        console.log('IPC: device-approved', data);
        if (data && data.message) {
          toast.success(data.message);
        }
        loadAll(false);
      };

      const handleDeviceRejected = (event, data) => {
        // eslint-disable-next-line no-console
        console.log('IPC: device-rejected', data);
        if (data && data.message) {
          toast.error(data.message);
        }
        loadAll(false);
      };

      // الاشتراك في الأحداث
      window.electronAPI.onPendingDeviceRemoved(handlePendingRemoved);
      window.electronAPI.onDeviceApproved(handleDeviceApproved);
      window.electronAPI.onDeviceRejected(handleDeviceRejected);

      return () => {
        // تنظيف المستمعين إذا كان متاحاً في preload
        if (window.electronAPI.removeAllListeners) {
          window.electronAPI.removeAllListeners('pending-device-removed');
          window.electronAPI.removeAllListeners('device-approved');
          window.electronAPI.removeAllListeners('device-rejected');
        }
      };
    }
  }, [loadAll]);

  // معالج heartbeat للسيرفرات
  useSocketEvent('server_heartbeat', (data) => {
    // تحديث حالة السيرفر المحدد
    setServers(prevServers =>
      prevServers.map(server =>
        server.id === data.server_id
          ? {
            ...server,
            last_heartbeat: data.timestamp,
            is_active: true,
            status: 'active'
          }
          : server
      )
    );
  });

  // فحص دوري لحالة السيرفرات (للكشف عن السيرفرات المنقطعة)
  useEffect(() => {
    const checkServerStatus = () => {
      // لا نحدث الـ state، بل نتركه كما هو من API ونعتمد على isServerOnline في العرض فقط
      setServers(prevServers => [...prevServers]); // إعادة رندر فقط
    };

    const interval = setInterval(checkServerStatus, 10000); // فحص كل 10 ثوان
    return () => clearInterval(interval);
  }, []);

  // وظائف التحكم في الأجهزة
  const handleDeviceAction = async (deviceSerial, action) => {
    const key = `${deviceSerial}_${action}`;
    if (processing[key]) return;

    try {
      setProcessing(prev => ({ ...prev, [key]: true }));
      await controlDevice(deviceSerial, { action });
      await loadAll();
    } catch (error) {
      // console.error(`Error ${action} device:`, error);
      const actionText = {
        'eject': 'فصل',
        'reconnect': 'إعادة توصيل',
        'disable': 'إطفاء',
        'enable': 'تشغيل'
      }[action] || action;
      toast.error(`فشل في ${actionText} الجهاز`);
    } finally {
      setProcessing(prev => {
        const newState = { ...prev };
        delete newState[key];
        return newState;
      });
    }
  };

  // فصل جميع الأجهزة
  const handleDisconnectAllDevices = async () => {
    if (!window.confirm('هل أنت متأكد من فصل جميع الأجهزة المتصلة؟')) return;

    const key = 'disconnect_all';
    if (processing[key]) return;

    try {
      setProcessing(prev => ({ ...prev, [key]: true }));

      const connectedDevices = devices.filter(d => d.status === 'connected');
      for (const device of connectedDevices) {
        await controlDevice(device.serial_number, { action: 'eject' });
      }

      toast.success('تم فصل جميع الأجهزة بنجاح');
      await loadAll();
    } catch (error) {
      // console.error('Error disconnecting all devices:', error);
      toast.error('فشل في فصل جميع الأجهزة');
    } finally {
      setProcessing(prev => {
        const newState = { ...prev };
        delete newState[key];
        return newState;
      });
    }
  };

  // إعادة توصيل جميع الأجهزة المفصولة
  const handleReconnectAllDevices = async () => {
    if (!window.confirm('هل أنت متأكد من إعادة توصيل جميع الأجهزة المفصولة؟')) return;

    const key = 'reconnect_all';
    if (processing[key]) return;

    try {
      setProcessing(prev => ({ ...prev, [key]: true }));

      const disconnectedDevices = devices.filter(d => d.status === 'disconnected' || d.status === 'ejected');
      if (disconnectedDevices.length === 0) {
        toast.info('لا توجد أجهزة مفصولة لإعادة توصيلها');
        return;
      }

      for (const device of disconnectedDevices) {
        await controlDevice(device.serial_number, { action: 'reconnect' });
      }

      toast.success(`تم إعادة توصيل ${disconnectedDevices.length} جهاز بنجاح`);
      await loadAll();
    } catch (error) {
      // console.error('Error reconnecting all devices:', error);
      toast.error('فشل في إعادة توصيل الأجهزة');
    } finally {
      setProcessing(prev => {
        const newState = { ...prev };
        delete newState[key];
        return newState;
      });
    }
  };

  // التحكم الجماعي بالمنافذ
  const _handleAllPorts = async (enable) => {
    try {
      let portsChanged = 0;
      for (const s of servers) {
        for (const p of (s.ports || [])) {
          if (!!p.enabled !== enable) {
            if (enable) {
              await enableUsbPort(s.id, p.port_id);
            } else {
              await disableUsbPort(s.id, p.port_id);
            }
            portsChanged++;
          }
        }
      }

      // تحديث فوري لحالة جميع المنافذ
      setServers(prevServers =>
        prevServers.map(server => ({
          ...server,
          ports: (server.ports || []).map(port => ({
            ...port,
            enabled: enable
          }))
        }))
      );

      toast.success(enable ? `تم تفعيل ${portsChanged} منفذ` : `تم تعطيل ${portsChanged} منفذ`);

      // إعادة تحميل البيانات للتأكد من التزامن
      setTimeout(async () => {
        await loadAll();
      }, 500);

    } catch (e) {
      // console.error('خطأ في التحكم الجماعي بالمنافذ:', e);
      toast.error('حدث خطأ أثناء التحكم الجماعي بالمنافذ');
    }
  };

  // التحكم المحسن بالمنافذ - تحكم حقيقي عبر PowerShell
  const handleEnhancedAllPorts = async (enable) => {
    const action = enable ? 'تفعيل' : 'تعطيل';

    let confirmMessage;
    if (enable) {
      confirmMessage = `هل تريد تفعيل جميع منافذ USB؟\n\nسيتم:\n• تفعيل جميع أجهزة USB المعطلة فعلياً عبر PowerShell\n• الأجهزة الداخلية (كيبورد، كاميرا، بلوتوث) لن تتأثر`;
    } else {
      confirmMessage = `هل تريد تعطيل جميع منافذ USB؟\n\n⚠️ تحذير: سيتم تعطيل جميع أجهزة USB الخارجية فعلياً!\n• الأجهزة الداخلية (كيبورد، كاميرا، بلوتوث) لن تتأثر\n• يمكنك إعادة تفعيلها لاحقاً`;
    }

    if (!window.confirm(confirmMessage)) return;

    const key = enable ? 'bulk_enable' : 'bulk_disable';
    if (processing[key]) return;

    try {
      setProcessing(prev => ({
        ...prev,
        [key]: true,
        total_ports: 1,
        current_progress: 0
      }));

      toast.info(`⚡ بدء ${action} جميع منافذ USB فعلياً...`);

      // *** استدعاء API الحقيقي - PowerShell Bulk Enable/Disable ***
      let result;
      if (enable) {
        result = await bulkEnableAllUsbPorts();
      } else {
        result = await bulkDisableAllUsbPorts();
      }

      // تحديث التقدم
      setProcessing(prev => ({
        ...prev,
        current_progress: 1,
        total_ports: 1
      }));

      // عرض النتائج التفصيلية
      const results = result.results || {};
      const actionCount = enable ? (results.enabled || 0) : (results.disabled || 0);
      const skippedInternal = results.skipped_internal || 0;
      const failed = results.failed || 0;
      const totalFound = results.total_found || 0;
      const alreadyDone = enable ? (results.already_enabled || 0) : (results.already_disabled || 0);

      // رسالة النتيجة
      let successMsg = `✅ تم ${action} ${actionCount} جهاز USB بنجاح!\n`;
      if (skippedInternal > 0) {
        successMsg += `🛡️ تم تخطي ${skippedInternal} جهاز داخلي (محمي)\n`;
      }
      if (alreadyDone > 0) {
        successMsg += `ℹ️ ${alreadyDone} جهاز كان ${enable ? 'مفعل' : 'معطل'} مسبقاً\n`;
      }
      if (failed > 0) {
        successMsg += `⚠️ فشل ${action} ${failed} جهاز`;
      }

      if (actionCount > 0 || alreadyDone > 0) {
        toast.success(successMsg, { autoClose: 5000 });
      } else if (totalFound === 0) {
        toast.info('لم يتم العثور على أجهزة USB طرفية');
      } else {
        toast.warning(`لم يتم ${action} أي جهاز - جميعها ${enable ? 'مفعلة' : 'معطلة'} مسبقاً أو داخلية`);
      }

      // عرض تفاصيل كل جهاز في الكونسول
      if (results.devices) {
        // eslint-disable-next-line no-console
        console.log(`📋 تفاصيل ${action} المنافذ:`);
        results.devices.forEach(d => {
          const icon = d.action === 'enabled' || d.action === 'disabled' ? '✅' :
            d.action === 'skipped' ? '🛡️' :
              d.action === 'failed' ? '❌' : 'ℹ️';
          // eslint-disable-next-line no-console
          console.log(`  ${icon} ${d.name}: ${d.action} ${d.error || d.message || d.reason || ''}`);
        });
      }

      // تحديث الواجهة
      setServers(prevServers => {
        return prevServers.map(server => ({
          ...server,
          ports: (server.ports || []).map(port => ({
            ...port,
            enabled: enable,
            status: enable ? 'active' : 'disabled'
          }))
        }));
      });

      setForceUpdate(prev => prev + 1);

      // إعادة تحميل البيانات
      setTimeout(async () => {
        try {
          await loadAll();
          setForceUpdate(prev => prev + 1);
        } catch (reloadError) {
          // console.warn('خطأ في إعادة تحميل البيانات:', reloadError);
        }
      }, 1500);

    } catch (error) {
      console.error(`خطأ في ${action} المنافذ:`, error);
      const errorMsg = error?.response?.data?.error || error.message || 'خطأ غير معروف';
      toast.error(`❌ فشل في ${action} المنافذ: ${errorMsg}`);
    } finally {
      setProcessing(prev => {
        const newState = { ...prev };
        delete newState[key];
        delete newState.total_ports;
        delete newState.current_progress;
        return newState;
      });
    }
  };


  // دوال مسح البيانات المحسنة
  const handleClearData = async (type, clearFunction, confirmMessage) => {
    if (!window.confirm(confirmMessage)) return;

    setClearing(prev => ({ ...prev, [type]: true }));

    try {
      const result = await clearFunction();
      toast.success(result.message || 'تم المسح بنجاح');

      // تحديث فوري للواجهة بدلاً من إعادة تحميل كل شيء
      if (type === 'devices') {
        setDevices([]);
        setOverview(prev => ({ ...prev, total_devices: 0, connected_devices: 0, pending_devices: 0 }));
      } else if (type === 'alerts') {
        setAlerts([]);
        setOverview(prev => ({ ...prev, total_alerts: 0 }));
      } else if (type === 'logs') {
        setLogs([]);
        setActivity([]);
        setOverview(prev => ({ ...prev, total_logs: 0 }));
      }

      // إعادة تحميل البيانات الأساسية فقط بعد فترة قصيرة
      setTimeout(async () => {
        try {
          if (type === 'devices') {
            const devicesData = await listDevices({ real_only: true }).catch(() => ({ data: [] }));
            setDevices(Array.isArray(devicesData?.data) ? devicesData.data : []);
          } else if (type === 'alerts') {
            const alertsData = await getAlerts().catch(() => []);
            setAlerts(Array.isArray(alertsData?.alerts || alertsData) ? (alertsData?.alerts || alertsData) : []);
          } else if (type === 'logs') {
            const logsData = await fetchLogs(10).catch(() => ({ logs: [] }));
            setLogs(Array.isArray(logsData?.logs || logsData) ? (logsData?.logs || logsData) : []);
            setActivity(Array.isArray(logsData?.logs || logsData) ? (logsData?.logs || logsData).slice(0, 10) : []);
          }
        } catch (error) {
          // في حالة فشل التحديث الجزئي، إعادة تحميل كل شيء
          await loadAll();
        }
      }, 500);

    } catch (error) {
      toast.error(error.response?.data?.error || `خطأ في مسح ${type}`);
    } finally {
      setClearing(prev => ({ ...prev, [type]: false }));
    }
  };

  const handleClearAllDevices = () => handleClearData(
    'all_devices',
    clearAllDevices,
    'هل أنت متأكد من مسح جميع الأجهزة؟ هذا الإجراء لا يمكن التراجع عنه!'
  );

  const handleClearAllAlerts = () => handleClearData(
    'all_alerts',
    clearAllAlerts,
    'هل أنت متأكد من مسح جميع التنبيهات؟'
  );

  const handleClearAllLogs = () => handleClearData(
    'all_logs',
    clearAllLogs,
    'هل أنت متأكد من مسح جميع السجلات؟ هذا الإجراء لا يمكن التراجع عنه!'
  );

  // حساب إحصائيات الأجهزة بشكل ديناميكي من قائمة الأجهزة
  const deviceStats = useMemo(() => {
    // الأجهزة الموافق عليها (المسجلة في قاعدة البيانات وليست معلقة)
    const approvedDevices = devices.filter(d =>
      d.status !== 'pending' && d.status !== 'waiting' && d.status !== 'discovered' && d.status !== 'agent_pending'
    );

    // الأجهزة المعلقة المحلية (قادمة من جدول devices) مع استبعاد أجهزة العملاء والبلوكر لمنع التكرار
    const localPending = devices.filter(d => 
      (d.status === 'pending' || d.status === 'waiting' || d.status === 'discovered') &&
      !d.is_agent_pending && !d.is_blocked_device
    ).length;

    const stats = {
      // إجمالي الأجهزة المسجلة (الموافق عليها فقط)
      total: approvedDevices.length,
      // الأجهزة المتصلة فعلياً = موافق عليها + is_connected = true
      connected: approvedDevices.filter(d => (d.is_connected === true || d.status === 'connected') && d.status !== 'denied' && d.status !== 'blocked').length,
      // الأجهزة المعلقة = (المحلية + الخاصة بالعملاء + سيرفر مركزي) 
      pending: localPending + agentPendingCount + serverPendingCount,
      // الأجهزة المنفصلة = موافق عليها لكن غير متصلة
      disconnected: approvedDevices.filter(d => d.is_connected !== true && d.status !== 'connected' && d.status !== 'denied' && d.status !== 'blocked').length,
      // الأجهزة المرفوضة
      denied: devices.filter(d => d.status === 'denied' || d.status === 'blocked').length
    };
    return stats;
  }, [devices, agentPendingCount, serverPendingCount, blockerPendingCount]);

  // الرسوم البيانية - استخدام البيانات من overview أو deviceStats
  const deviceStatusChart = useMemo(() => {
    // استخدم ألوان حقيقية بدلاً من متغيرات CSS لأن Chart.js و Canvas لا يدعمانها بشكل مثالي دائماً
    const themeDark = document.documentElement.getAttribute('data-theme') === 'dark';
    
    return {
      labels: ['متصلة', 'معلقة', 'مفصولة', 'مرفوضة'],
      datasets: [{
        data: [
          overview.connected_devices || deviceStats.connected,
          overview.pending_devices || deviceStats.pending,
          overview.disconnected_devices || deviceStats.disconnected,
          overview.denied_devices || deviceStats.denied
        ],
        backgroundColor: [
          '#4CAF50',  // --success-color
          '#FF9800',  // --warning-color
          themeDark ? '#6B7280' : '#819CA9',  // --gray or secondary-light
          '#F44336'   // --danger-color
        ],
        borderColor: themeDark ? '#1a2027' : '#ffffff',
        borderWidth: 2
      }]
    };
  }, [overview, deviceStats]);

  // حساب إحصائيات المنافذ بشكل ديناميكي
  const portStatistics = useMemo(() => {
    if (!Array.isArray(servers) || servers.length === 0) {
      return {
        totalPorts: 0,
        enabledPorts: 0,
        disabledPorts: 0
      };
    }

    let totalPorts = 0;
    let enabledPorts = 0;
    let disabledPorts = 0;

    servers.forEach(server => {
      const ports = server.ports || [];
      totalPorts += ports.length;
      enabledPorts += ports.filter(p => p.enabled === true).length;
      disabledPorts += ports.filter(p => p.enabled === false).length;
    });

    // console.log('🔢 إحصائيات المنافذ المحدثة:', {
    //   totalPorts,
    //   enabledPorts,
    //   disabledPorts,
    //   servers: servers.length,
    //   serversData: servers.map(s => ({
    //     id: s.id,
    //     name: s.name,
    //     portsCount: (s.ports || []).length,
    //     enabledCount: (s.ports || []).filter(p => p.enabled === true).length
    //   }))
    // });

    return {
      totalPorts,
      enabledPorts,
      disabledPorts
    };
  }, [servers]); // إزالة forceUpdate من dependency array

  // Helper to parse UTC dates consistently
  const parseUTCDate = (dateString) => {
    if (!dateString) return null;
    let str = dateString;
    if (str && !str.endsWith('Z') && !str.includes('+')) {
      str += 'Z';
    }
    return new Date(str);
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return 'غير محدد';
    try {
      const date = parseUTCDate(dateString);
      return date.toLocaleString('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'تاريخ غير صالح';
    }
  };

  if (!currentUser) return <div>يجب تسجيل الدخول</div>;
  if (loading) return <div className="text-center py-5">جاري التحميل...</div>;

  return (
    <>
      {/* Custom Styles */}
      <style>{styles}</style>

      <div className="container py-4" dir="rtl">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h2 className="mb-0 fw-bold">لوحة التحكم المركزية</h2>

          {/* أزرار التحكم والمسح - فقط للمدير */}
          {currentUser && (currentUser.roles?.includes('admin') || currentUser.roles?.includes('super_admin')) && (
            <div className="btn-group">
              <button
                className="btn btn-outline-danger btn-sm"
                onClick={handleClearAllDevices}
                disabled={clearing.all_devices}
                title="مسح جميع الأجهزة"
              >
                <i className={`fas ${clearing.all_devices ? 'fa-spinner fa-spin' : 'fa-usb'} me-1`}></i>
                مسح الأجهزة
              </button>
              <button
                className="btn btn-outline-warning btn-sm"
                onClick={handleClearAllAlerts}
                disabled={clearing.all_alerts}
                title="مسح جميع التنبيهات"
              >
                <i className={`fas ${clearing.all_alerts ? 'fa-spinner fa-spin' : 'fa-bell'} me-1`}></i>
                مسح التنبيهات
              </button>
              <button
                className="btn btn-outline-info btn-sm"
                onClick={handleClearAllLogs}
                disabled={clearing.all_logs}
                title="مسح جميع السجلات"
              >
                <i className={`fas ${clearing.all_logs ? 'fa-spinner fa-spin' : 'fa-clipboard-list'} me-1`}></i>
                مسح السجلات
              </button>
            </div>
          )}
        </div>

        {/* البطاقات الرئيسية - تصميم 3×2 مع الشكل الحالي */}
        <div
          className="dashboard-cards-grid mb-5"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.7rem',
            justifyContent: 'center',
            marginBottom: '2.2rem',
          }}
        >
          {/* البطاقة الأولى - إجمالي الأجهزة */}
          <div
            className="card dashboard-card shadow-sm text-center bg-primary text-white"
            style={{
              borderRadius: '1.5rem',
              minWidth: 170,
              minHeight: 145,
              maxWidth: 210,
              margin: '0.3rem 0.4rem',
              boxShadow: '0 3px 22px #0002',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '1.2rem 0.2rem 1.3rem 0.2rem',
              cursor: 'default',
            }}
          >
            <div className="card-body d-flex flex-column justify-content-center align-items-center p-0">
              <i className="fas fa-layer-group fa-2x mb-2" style={{ opacity: 0.92 }} />
              <h6 className="card-title text-white mb-1" style={{ fontSize: 17 }}>إجمالي الأجهزة</h6>
              <div className="display-5 fw-bold" style={{ fontSize: 33 }}>{overview.total_devices || deviceStats.total}</div>
            </div>
          </div>

          {/* البطاقة الثانية - الأجهزة المتصلة */}
          <div
            className="card dashboard-card shadow-sm text-center bg-success text-white"
            style={{
              borderRadius: '1.5rem',
              minWidth: 170,
              minHeight: 145,
              maxWidth: 210,
              margin: '0.3rem 0.4rem',
              boxShadow: '0 3px 22px #0002',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '1.2rem 0.2rem 1.3rem 0.2rem',
              cursor: 'default',
            }}
          >
            <div className="card-body d-flex flex-column justify-content-center align-items-center p-0">
              <i className="fas fa-plug fa-2x mb-2" style={{ opacity: 0.92 }} />
              <h6 className="card-title text-white mb-1" style={{ fontSize: 17 }}>متصلة</h6>
              <div className="display-5 fw-bold" style={{ fontSize: 33 }}>{overview.connected_devices || deviceStats.connected}</div>
            </div>
          </div>

          {/* البطاقة الثالثة - الخوادم */}
          <div
            className="card dashboard-card shadow-sm text-center bg-info text-white"
            style={{
              borderRadius: '1.5rem',
              minWidth: 170,
              minHeight: 145,
              maxWidth: 210,
              margin: '0.3rem 0.4rem',
              boxShadow: '0 3px 22px #0002',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '1.2rem 0.2rem 1.3rem 0.2rem',
              cursor: 'default',
            }}
          >
            <div className="card-body d-flex flex-column justify-content-center align-items-center p-0">
              <i className="fas fa-server fa-2x mb-2" style={{ opacity: 0.92 }} />
              <h6 className="card-title text-white mb-1" style={{ fontSize: 17 }}>إجمالي الخوادم</h6>
              <div className="display-5 fw-bold" style={{ fontSize: 33 }}>{overview.total_servers || 0}</div>
            </div>
          </div>

          {/* البطاقة الرابعة - التنبيهات */}
          <div
            className="card dashboard-card shadow-sm text-center bg-warning text-white"
            style={{
              borderRadius: '1.5rem',
              minWidth: 170,
              minHeight: 145,
              maxWidth: 210,
              margin: '0.3rem 0.4rem',
              boxShadow: '0 3px 22px #0002',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '1.2rem 0.2rem 1.3rem 0.2rem',
              cursor: 'default',
            }}
          >
            <div className="card-body d-flex flex-column justify-content-center align-items-center p-0">
              <i className="fas fa-bell fa-2x mb-2" style={{ opacity: 0.92 }} />
              <h6 className="card-title text-white mb-1" style={{ fontSize: 17 }}>التنبيهات</h6>
              <div className="display-5 fw-bold" style={{ fontSize: 33 }}>{overview.total_alerts || 0}</div>
            </div>
          </div>

          {/* البطاقة الخامسة - الأجهزة المعلقة */}
          <div
            className="card dashboard-card shadow-sm text-center bg-warning text-dark"
            style={{
              borderRadius: '1.5rem',
              minWidth: 170,
              minHeight: 145,
              maxWidth: 210,
              margin: '0.3rem 0.4rem',
              boxShadow: '0 3px 22px #0002',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '1.2rem 0.2rem 1.3rem 0.2rem',
              cursor: 'pointer',
            }}
            onClick={() => navigate('/devices?filter=pending')}
            title="انقر لعرض الأجهزة المعلقة"
          >
            <div className="card-body d-flex flex-column justify-content-center align-items-center p-0">
              <i className="fas fa-clock fa-2x mb-2" style={{ opacity: 0.92 }} />
              <h6 className="card-title mb-1" style={{ fontSize: 17 }}>معلقة</h6>
              <div className="display-5 fw-bold" style={{ fontSize: 33 }}>{deviceStats.pending}</div>
              {serverPendingCount > 0 && (
                <small className="mt-1 d-block" style={{ fontSize: '0.75rem', opacity: 0.9 }}>
                  <i className="fas fa-server me-1"></i>
                  {serverPendingCount} من السيرفر
                </small>
              )}
              {agentPendingCount > 0 && (
                <small className="mt-1" style={{ fontSize: '0.75rem', opacity: 0.9 }}>
                  <i className="fas fa-desktop me-1"></i>
                  {agentPendingCount} من العملاء
                </small>
              )}
              {blockerPendingCount > 0 && (
                <small className="mt-1 d-block" style={{ fontSize: '0.75rem', opacity: 0.9 }}>
                  <i className="fas fa-shield-alt me-1"></i>
                  {blockerPendingCount} مكتشفة جديدة
                </small>
              )}
            </div>
          </div>

          {/* البطاقة السادسة - السجلات */}
          <div
            className="card dashboard-card shadow-sm text-center text-white"
            style={{
              borderRadius: '1.5rem',
              minWidth: 170,
              minHeight: 145,
              maxWidth: 210,
              margin: '0.3rem 0.4rem',
              boxShadow: '0 3px 22px rgba(0, 0, 0, 0.15)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '1.2rem 0.2rem 1.3rem 0.2rem',
              cursor: 'default',
              background: 'linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%)',
              border: '2px solid rgba(102, 126, 234, 0.3)'
            }}
          >
            <div className="card-body d-flex flex-column justify-content-center align-items-center p-0">
              <i className="fas fa-clipboard-list fa-2x mb-2" style={{
                opacity: 0.92,
                textShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                filter: 'drop-shadow(0 0 8px rgba(255, 255, 255, 0.3))'
              }} />
              <h6 className="card-title text-white mb-1" style={{
                fontSize: 17,
                textShadow: '0 2px 4px rgba(0, 0, 0, 0.3)'
              }}>السجلات</h6>
              <div className="display-5 fw-bold" style={{
                fontSize: 33,
                textShadow: '0 2px 8px rgba(0, 0, 0, 0.4)'
              }}>{overview.total_logs || 0}</div>
            </div>
          </div>
        </div>

        {/* تحليلات الطاقة لكل المنافذ */}
        <div className="card mb-4 border-danger shadow">
          <div className="card-header bg-danger text-white fw-bold">
            <i className="fas fa-bolt me-2" /> مراقبة وتحليل استهلاك الطاقة لجميع منافذ USB
          </div>
          <div className="card-body">
            {servers && servers.length > 0 && servers.some(s => s.power_analytics) ? (
              <PowerAnalytics
                analytics={{
                  devices: servers.flatMap(s => (s.power_analytics?.devices || []).map(d => ({ ...d, server_id: s.id, server_name: s.name }))),
                  total_power: servers.reduce((sum, s) => sum + (s.power_analytics?.total_power || 0), 0),
                  max_device: (() => {
                    let all = servers.flatMap(s => (s.power_analytics?.devices || []).map(d => ({ ...d, server_id: s.id, server_name: s.name })));
                    return all.reduce((max, d) => (d.power_consumption > (max?.power_consumption || 0) ? d : max), null);
                  })(),
                  device_count: servers.reduce((sum, s) => sum + (s.power_analytics?.device_count || 0), 0),
                  threshold: 2.5
                }}
                onAutoDisable={(device) => handleDeviceAction(device.serial_number, 'poweroff')}
              />
            ) : (
              <div className="alert alert-info">لا توجد بيانات طاقة متاحة من الخوادم حالياً.</div>
            )}
          </div>
        </div>

        {/* الرسوم البيانية - تصميم أفقي محسن */}
        <div className="row g-4 mb-5">
          <div className="col-12">
            <div className="card border-0 shadow-lg">
              <div className="card-header bg-gradient-primary text-white border-0">
                <div className="d-flex align-items-center">
                  <i className="fas fa-chart-pie me-2"></i>
                  <span className="fw-bold">توزيع الأجهزة حسب الحالة</span>
                </div>
              </div>
              <div className="card-body" style={{ height: '300px' }}>
                <Pie
                  data={deviceStatusChart}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        position: 'bottom',
                        labels: {
                          padding: 15,
                          font: { size: 11, family: 'Tajawal' },
                          usePointStyle: true,
                          pointStyle: 'circle'
                        }
                      },
                      tooltip: {
                        titleFont: { family: 'Tajawal' },
                        bodyFont: { family: 'Tajawal' }
                      }
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* تحكم جماعي بالمنافذ - تصميم محترف ومحسن */}
        <div key={`bulk-control-${forceUpdate}`} className="card border-0 shadow-sm mb-5 position-relative overflow-hidden">
          {/* شريط علوي بسيط */}
          <div className="position-absolute top-0 start-0 w-100" style={{
            height: '3px',
            background: 'linear-gradient(90deg, var(--primary-color), var(--success-color), var(--secondary-color))'
          }}></div>

          {/* Header محسن */}
          <div className="card-header border-0 bg-white"
            style={{ borderBottom: '1px solid #var(--mid)' }}>
            <div className="d-flex justify-content-between align-items-center">
              <div className="d-flex align-items-center">
                <div className="me-3 p-2 rounded-circle bg-light">
                  <i className="fas fa-sliders-h text-primary"></i>
                </div>
                <div>
                  <h5 className="mb-0 fw-bold text-dark">التحكم الجماعي بالمنافذ</h5>
                  <small className="text-muted">تفعيل أو تعطيل جميع المنافذ مع إدارة حالة الأجهزة</small>
                </div>
              </div>
              {/* تم إزالة إحصائيات المنافذ حسب طلب المستخدم */}
            </div>
          </div>

          <div className="card-body p-4">
            {/* أزرار التحكم الرئيسية - بحجم بطاقات لوحة التحكم مرتبة أفقياً */}
            <div className="d-flex justify-content-center mb-4">
              <div className="d-flex gap-5" style={{ gap: '4rem' }}> {/* مسافة إضافية بين البطاقتين */}
                {/* زر تفعيل المنافذ */}
                <div
                  className={`card dashboard-card shadow-sm text-center bg-success text-white cursor-pointer ${processing.bulk_enable ? 'processing' : 'hover-effect'
                    }`}
                  style={{
                    borderRadius: '1.5rem',
                    minWidth: 170,
                    minHeight: 145,
                    maxWidth: 210,
                    boxShadow: '0 8px 25px rgba(40, 167, 69, 0.3)',
                    cursor: processing.bulk_enable || processing.bulk_disable ? 'not-allowed' : 'pointer',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    border: 'none',
                    opacity: processing.bulk_enable || processing.bulk_disable ? 0.7 : 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: '1.2rem 0.2rem 1.3rem 0.2rem'
                  }}
                  onClick={() => !processing.bulk_enable && !processing.bulk_disable && handleEnhancedAllPorts(true)}
                >
                  <div className="card-body d-flex flex-column justify-content-center align-items-center p-0">
                    {processing.bulk_enable ? (
                      <div className="spinner-border mb-2" role="status" style={{ width: '2.5rem', height: '2.5rem' }}>
                        <span className="visually-hidden">Loading...</span>
                      </div>
                    ) : (
                      <i className="fas fa-power-off fa-2x mb-2" style={{ opacity: 0.92 }}></i>
                    )}
                    <h6 className="card-title text-white mb-1" style={{ fontSize: 17 }}>
                      {processing.bulk_enable ? 'جاري التفعيل...' : 'تفعيل المنافذ'}
                    </h6>
                    <div className="small opacity-75" style={{ fontSize: 12 }}>
                      {processing.bulk_enable ? 'يرجى الانتظار' : 'تشغيل جميع منافذ USB'}
                    </div>
                  </div>
                </div>

                {/* زر إطفاء المنافذ */}
                <div
                  className={`card dashboard-card shadow-sm text-center bg-danger text-white cursor-pointer ${processing.bulk_disable ? 'processing' : 'hover-effect'
                    }`}
                  style={{
                    borderRadius: '1.5rem',
                    minWidth: 170,
                    minHeight: 145,
                    maxWidth: 210,
                    boxShadow: '0 8px 25px rgba(220, 53, 69, 0.3)',
                    cursor: processing.bulk_enable || processing.bulk_disable ? 'not-allowed' : 'pointer',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    border: 'none',
                    opacity: processing.bulk_enable || processing.bulk_disable ? 0.7 : 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: '1.2rem 0.2rem 1.3rem 0.2rem'
                  }}
                  onClick={() => !processing.bulk_enable && !processing.bulk_disable && handleEnhancedAllPorts(false)}
                >
                  <div className="card-body d-flex flex-column justify-content-center align-items-center p-0">
                    {processing.bulk_disable ? (
                      <div className="spinner-border mb-2" role="status" style={{ width: '2.5rem', height: '2.5rem' }}>
                        <span className="visually-hidden">Loading...</span>
                      </div>
                    ) : (
                      <i className="fas fa-power-off fa-2x mb-2" style={{ opacity: 0.92 }}></i>
                    )}
                    <h6 className="card-title text-white mb-1" style={{ fontSize: 17 }}>
                      {processing.bulk_disable ? 'جاري الإطفاء...' : 'إطفاء المنافذ'}
                    </h6>
                    <div className="small opacity-75" style={{ fontSize: 12 }}>
                      {processing.bulk_disable ? 'يرجى الانتظار' : 'إيقاف جميع منافذ USB'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* شريط التقدم */}
            {(processing.bulk_enable || processing.bulk_disable) && (
              <div className="mt-4">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <small className="text-muted fw-bold d-flex align-items-center">
                    <i className="fas fa-cog fa-spin me-2 text-primary"></i>
                    <span className="status-indicator active me-2">
                      <i className="fas fa-circle fa-xs text-success"></i>
                    </span>
                    {processing.bulk_enable ? 'جاري تفعيل المنافذ وإدارة الأجهزة...' : 'جاري تعطيل المنافذ وإدارة الأجهزة...'}
                  </small>
                  <div className="d-flex align-items-center gap-2">
                    <small className="text-muted fw-bold">
                      {processing.current_progress || 0}/{processing.total_ports || 1}
                    </small>
                    <span className="badge bg-primary rounded-pill px-2 py-1">
                      {Math.round(((processing.current_progress || 0) / (processing.total_ports || 1)) * 100)}%
                    </span>
                  </div>
                </div>
                <div className="progress mb-2" style={{ height: '10px', borderRadius: '8px' }}>
                  <div
                    className="progress-bar progress-bar-striped progress-bar-animated progress-animated"
                    role="progressbar"
                    style={{
                      width: `${((processing.current_progress || 0) / (processing.total_ports || 1)) * 100}%`,
                      borderRadius: '8px',
                      transition: 'width 0.3s ease'
                    }}
                  ></div>
                </div>
                <div className="text-center">
                  <small className="text-muted opacity-75">
                    <i className="fas fa-info-circle me-1"></i>
                    يرجى عدم إغلاق النافذة أثناء العملية
                  </small>
                </div>
              </div>
            )}

            {/* ملاحظة مهمة */}
            <div className="alert alert-info border-0 mb-4" style={{ backgroundColor: '#e3f2fd' }}>
              <div className="d-flex align-items-center">
                <i className="fas fa-info-circle text-info me-3 fa-lg"></i>
                <div>
                  <div className="fw-bold text-info mb-1">ملاحظة مهمة</div>
                  <small className="text-muted">
                    عند تعطيل المنافذ، سيتم فصل جميع الأجهزة المتصلة. عند التفعيل، سيتم إعادة توصيل الأجهزة المفصولة.
                  </small>
                </div>
              </div>
            </div>
          </div>

          {/* Footer مع معلومات إضافية */}
          <div className="card-footer bg-light border-0">
            <div className="row text-center">
              <div className="col-md-3">
                <small className="text-muted d-flex align-items-center justify-content-center">
                  <i className="fas fa-server me-2 text-primary"></i>
                  <strong>{servers.length}</strong> خادم نشط
                </small>
              </div>
              <div className="col-md-3">
                <small className="text-muted d-flex align-items-center justify-content-center">
                  <i className="fas fa-plug me-2 text-success"></i>
                  <strong>{Math.round((portStatistics.enabledPorts / Math.max(1, portStatistics.totalPorts)) * 100)}%</strong> منافذ مفعلة
                </small>
              </div>
              <div className="col-md-3">
                <small className="text-muted d-flex align-items-center justify-content-center">
                  <i className="fas fa-usb me-2 text-info"></i>
                  <strong>{overview.connected_devices || 0}</strong> جهاز متصل
                </small>
              </div>
              <div className="col-md-3">
                <small className="text-muted d-flex align-items-center justify-content-center">
                  <i className="fas fa-shield-alt me-2 text-warning"></i>
                  <strong>نشط</strong> الحماية
                </small>
              </div>
            </div>
          </div>
        </div>

        {/* الأقسام التفصيلية */}
        <div className="row g-4">
          {/* قائمة الأجهزة المتصلة بالخادم - محسنة */}
          <div className="col-lg-6">
            <div className="card h-100 border-0 shadow-lg">
              {/* Header محسن مع gradiant */}
              <div className="card-header bg-gradient text-white border-0" style={{ background: 'linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%)' }}>
                <div className="d-flex justify-content-between align-items-center">
                  <h5 className="card-title mb-0 fw-bold">
                    <i className="fas fa-database me-2"></i>
                    الأجهزة المسجلة (الموافق عليها)
                  </h5>
                  <div className="d-flex align-items-center gap-2">
                    <button
                      className="btn btn-light btn-sm text-danger fw-bold"
                      onClick={handleDisconnectAllDevices}
                      disabled={loading || Object.keys(processing).length > 0}
                      title="فصل جميع الأجهزة"
                    >
                      <i className={`fas ${processing.disconnect_all ? 'fa-spinner fa-spin' : 'fa-power-off'} me-1`}></i>
                      {processing.disconnect_all ? 'جاري الفصل...' : 'فصل الكل'}
                    </button>
                    <button
                      className="btn btn-light btn-sm text-primary fw-bold"
                      onClick={handleReconnectAllDevices}
                      disabled={loading || Object.keys(processing).length > 0}
                      title="إعادة توصيل جميع الأجهزة المفصولة"
                    >
                      <i className={`fas ${processing.reconnect_all ? 'fa-spinner fa-spin' : 'fa-link'} me-1`}></i>
                      {processing.reconnect_all ? 'جاري التوصيل...' : 'توصيل الكل'}
                    </button>
                    <span className="badge bg-white text-primary fs-6 fw-bold px-3 py-2 rounded-pill">
                      {devices.filter(d => d.status !== 'pending' && d.status !== 'waiting' && d.status !== 'discovered').length} جهاز مرخص
                    </span>
                  </div>
                </div>
              </div>

              <div className="card-body p-0">
                {devices.filter(d => d.status !== 'pending' && d.status !== 'waiting' && d.status !== 'discovered').length === 0 ? (
                  <div className="text-center py-5">
                    <div className="mb-4">
                      <i className="fas fa-inbox text-muted" style={{ fontSize: '4rem' }}></i>
                    </div>
                    <h5 className="text-muted mb-2">لا توجد أجهزة مسجلة</h5>
                    <p className="text-muted small">سيتم عرض الأجهزة الموافق عليها هنا</p>
                  </div>
                ) : (
                  <div className="list-group list-group-flush">
                    {devices.filter(d => d.status !== 'pending' && d.status !== 'waiting' && d.status !== 'discovered').map((device, index) => (
                      <div key={device.id || index} className="list-group-item border-0 py-3 hover-bg-light">
                        <div className="row align-items-center">
                          {/* معلومات الجهاز */}
                          <div className="col-md-6">
                            <div className="d-flex align-items-center">
                              <div className="device-icon me-3">
                                <i className="fas fa-usb fa-2x text-primary"></i>
                              </div>
                              <div>
                                <h6 className="mb-1 fw-bold text-dark">
                                  {device.name || device.custom_name || 'جهاز غير معروف'}
                                </h6>
                                <div className="d-flex align-items-center gap-2">
                                  <small className="text-muted d-flex align-items-center">
                                    <i className="fas fa-hashtag me-1"></i>
                                    <span className="serial-number me-2">{device.serial_number || 'بدون رقم تسلسلي'}</span>
                                    {device.serial_number && (
                                      <button
                                        className="btn btn-link btn-sm p-0 text-muted ms-1"
                                        title="نسخ الرقم التسلسلي"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigator.clipboard.writeText(device.serial_number)
                                            .then(() => toast.success('تم نسخ الرقم التسلسلي بنجاح'))
                                            .catch((_e) => toast.error('فشل في نسخ الرقم التسلسلي'));
                                        }}
                                      >
                                        <i className="fas fa-copy" style={{ fontSize: '12px' }}></i>
                                      </button>
                                    )}
                                  </small>
                                  {device.manufacturer && (
                                    <small className="text-muted">
                                      <i className="fas fa-industry me-1"></i>
                                      {device.manufacturer}
                                    </small>
                                  )}
                                </div>
                                {device.usb_port && (
                                  <small className="text-info">
                                    <i className="fas fa-plug me-1"></i>
                                    منفذ {device.usb_port}
                                  </small>
                                )}
                                {/* عرض اسم السيرفر إذا كان الجهاز من سيرفر فرعي */}
                                {device.server_id && device.server_id !== 1 && (
                                  <small className="text-warning ms-2">
                                    <i className="fas fa-server me-1"></i>
                                    {device.server_name || `سيرفر ${device.server_id}`}
                                  </small>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* الحالة - تعكس الاتصال الفعلي (من is_connected أو status === 'connected') */}
                          <div className="col-md-3 text-center">
                            <span className={`badge fs-6 px-3 py-2 rounded-pill bg-${(device.is_connected === true || device.status === 'connected') ? 'success' : 'secondary'}`}>
                              <i className={`fas me-1 ${(device.is_connected === true || device.status === 'connected') ? 'fa-check-circle' : 'fa-times-circle'}`}></i>
                              {(device.is_connected === true || device.status === 'connected') ? 'متصل' : 'منفصل'}
                            </span>
                          </div>

                          {/* الإجراءات */}
                          <div className="col-md-3 text-end">
                            <div className="btn-group btn-group-sm" role="group">
                              {/* أزرار الفصل - تظهر للأجهزة المتصلة */}
                              {(device.status === 'connected' || device.is_connected === true) && (
                                <>
                                  <button
                                    className="btn btn-outline-warning border-2 fw-bold"
                                    title="فصل الجهاز بأمان"
                                    onClick={() => handleDeviceAction(device.serial_number, 'eject')}
                                    disabled={processing[`${device.serial_number}_eject`]}
                                  >
                                    <i className={`fas ${processing[`${device.serial_number}_eject`] ? 'fa-spinner fa-spin' : 'fa-eject'} me-1`}></i>
                                    فصل
                                  </button>
                                  <button
                                    className="btn btn-outline-danger border-2 fw-bold"
                                    title="إطفاء الجهاز"
                                    onClick={() => handleDeviceAction(device.serial_number, 'poweroff')}
                                    disabled={processing[`${device.serial_number}_poweroff`]}
                                  >
                                    <i className={`fas ${processing[`${device.serial_number}_poweroff`] ? 'fa-spinner fa-spin' : 'fa-power-off'} me-1`}></i>
                                    إطفاء
                                  </button>
                                </>
                              )}
                              {/* زر إعادة التوصيل - يظهر للأجهزة المنفصلة */}
                              {(device.status === 'disconnected' || device.status === 'ejected' || device.is_connected === false) && device.status !== 'connected' && (
                                <button
                                  className="btn btn-outline-success border-2 fw-bold"
                                  title="إعادة توصيل الجهاز"
                                  onClick={() => handleDeviceAction(device.serial_number, 'reconnect')}
                                  disabled={processing[`${device.serial_number}_reconnect`]}
                                >
                                  <i className={`fas ${processing[`${device.serial_number}_reconnect`] ? 'fa-spinner fa-spin' : 'fa-link'} me-1`}></i>
                                  إعادة توصيل
                                </button>
                              )}
                              <button
                                className="btn btn-outline-info border-2 fw-bold"
                                title="عرض تفاصيل الجهاز وفحص التوافق"
                                onClick={() => {
                                  // التحقق من صحة الرقم التسلسلي قبل الانتقال
                                  const serial = device.serial_number;
                                  if (!serial || typeof serial !== 'string' || serial.trim() === '') {
                                    toast.error('لا يوجد رقم تسلسلي صالح لهذا الجهاز');
                                    console.error('Invalid device serial number:', { device, serial });
                                    return;
                                  }
                                  // الانتقال إلى صفحة تفاصيل الجهاز مع ملء رقم التسلسل تلقائياً
                                  navigate(`/devices/details?serial=${encodeURIComponent(serial.trim())}`);
                                }}
                              >
                                <i className="fas fa-info-circle me-1"></i>
                                تفاصيل
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* معلومات إضافية */}
                        {device.last_activity && (
                          <div className="row mt-2">
                            <div className="col-12">
                              <small className="text-muted">
                                <i className="fas fa-clock me-1"></i>
                                آخر نشاط: {formatDateTime(device.last_activity)}
                              </small>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Footer للبطاقة */}
                {devices.filter(d => d.status !== 'pending' && d.status !== 'waiting' && d.status !== 'discovered').length > 5 && (
                  <div className="card-footer bg-transparent border-0 text-center">
                    <button
                      className="btn btn-outline-primary btn-sm"
                      onClick={() => navigate('/devices')}
                    >
                      <i className="fas fa-eye me-2"></i>
                      عرض جميع الأجهزة ({devices.length})
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* قائمة الخوادم المتصلة - محسنة */}
          <div className="col-lg-6">
            <div className="card h-100 border-0 shadow-lg">
              {/* Header محسن مع gradiant */}
              <div className="card-header bg-gradient text-white border-0" style={{ background: 'linear-gradient(135deg, var(--secondary-color) 0%, var(--dark) 100%)' }}>
                <div className="d-flex justify-content-between align-items-center">
                  <h5 className="card-title mb-0 fw-bold">
                    <i className="fas fa-server me-2"></i>
                    الخوادم المتصلة بالنظام
                  </h5>
                  <div className="d-flex align-items-center gap-2">
                    <button
                      className="btn btn-light btn-sm text-info fw-bold"
                      onClick={() => navigate('/servers')}
                      title="إدارة الخوادم"
                    >
                      <i className="fas fa-cogs me-1"></i>
                      إدارة
                    </button>
                    <span className="badge bg-white text-info fs-6 fw-bold px-3 py-2 rounded-pill">
                      {servers.length} خادم
                    </span>
                  </div>
                </div>
              </div>

              <div className="card-body p-0">
                {servers.length === 0 ? (
                  <div className="text-center py-5">
                    <div className="mb-4">
                      <i className="fas fa-server text-muted" style={{ fontSize: '4rem' }}></i>
                    </div>
                    <h5 className="text-muted mb-2">لا توجد خوادم متصلة</h5>
                    <p className="text-muted small">سيتم عرض الخوادم المتصلة هنا</p>
                  </div>
                ) : (
                  <div className="list-group list-group-flush">
                    {servers.slice(0, 5).map((server, index) => (
                      <div key={server.id || index} className="list-group-item border-0 py-3 hover-bg-light">
                        <div className="row align-items-center">
                          {/* معلومات الخادم */}
                          <div className="col-md-6">
                            <div className="d-flex align-items-center">
                              <div className="device-icon me-3" style={{ background: 'linear-gradient(135deg, var(--secondary-color) 0%, var(--dark) 100%)' }}>
                                <i className="fas fa-server fa-2x text-white"></i>
                              </div>
                              <div>
                                <h6 className="mb-1 fw-bold text-dark">
                                  {server.name || `خادم ${index + 1}`}
                                </h6>
                                <div className="d-flex align-items-center gap-2">
                                  <small className="text-muted">
                                    <i className="fas fa-network-wired me-1"></i>
                                    {server.ip_address || server.address || 'غير محدد'}
                                  </small>
                                  {server.os && (
                                    <small className="text-muted">
                                      <i className="fas fa-desktop me-1"></i>
                                      {server.os}
                                    </small>
                                  )}
                                </div>
                                {server.last_heartbeat && (
                                  <small className="text-info">
                                    <i className="fas fa-heartbeat me-1"></i>
                                    آخر نبضة: {formatDateTime(server.last_heartbeat)}
                                  </small>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* الحالة والنوع */}
                          <div className="col-md-3 text-center">
                            <div className="mb-2">
                              <span className={`badge fs-6 px-3 py-2 rounded-pill bg-${getServerStatusColor(server)}`}>
                                <i className={`fas me-1 ${isServerOnline(server) ? 'fa-check-circle' : 'fa-times-circle'
                                  }`}></i>
                                {getServerStatusText(server)}
                              </span>
                            </div>
                            <div>
                              <span className={`badge ${server.role === 'primary' ? 'bg-primary' : 'bg-secondary'
                                } fs-6 px-2 py-1`}>
                                {server.role === 'primary' ? 'رئيسي' : 'احتياطي'}
                              </span>
                            </div>
                          </div>

                          {/* الإجراءات */}
                          <div className="col-md-3 text-end">
                            <div className="btn-group btn-group-sm" role="group">
                              <button
                                className="btn btn-outline-info border-2 fw-bold"
                                title="عرض تفاصيل الخادم"
                                onClick={() => navigate(`/servers/details/${server.id}`)}
                              >
                                <i className="fas fa-info-circle me-1"></i>
                                تفاصيل
                              </button>
                              <button
                                className="btn btn-outline-success border-2 fw-bold"
                                title="فحص حالة الخادم"
                                onClick={async () => {
                                  try {
                                    toast.info(`جاري فحص حالة الخادم ${server.name}...`);
                                    await loadAll(false);

                                    // التحقق من الحالة بعد التحديث
                                    setTimeout(() => {
                                      const online = isServerOnline(server);
                                      if (online) {
                                        toast.success(`الخادم ${server.name} متصل حالياً بنجاح`);
                                      } else {
                                        toast.error(`الخادم ${server.name} غير متصل حالياً`);
                                      }
                                    }, 500);
                                  } catch (error) {
                                    toast.error('فشل في فحص حالة الخادم');
                                  }
                                }}
                              >
                                <i className="fas fa-heartbeat me-1"></i>
                                فحص
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* معلومات إضافية */}
                        {(server.cpu || server.ram) && (
                          <div className="row mt-2">
                            <div className="col-12">
                              <small className="text-muted d-flex gap-3">
                                {server.cpu && (
                                  <span>
                                    <i className="fas fa-microchip me-1"></i>
                                    {server.cpu}
                                  </span>
                                )}
                                {server.ram && (
                                  <span>
                                    <i className="fas fa-memory me-1"></i>
                                    {server.ram}
                                  </span>
                                )}
                              </small>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Footer للبطاقة */}
                {servers.length > 5 && (
                  <div className="card-footer bg-transparent border-0 text-center">
                    <button
                      className="btn btn-outline-info btn-sm"
                      onClick={() => navigate('/servers')}
                    >
                      <i className="fas fa-eye me-2"></i>
                      عرض جميع الخوادم ({servers.length})
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* جداول تفصيلية */}

        {/* جدول التنبيهات الحرجة */}
        {alerts.filter(a => a.priority === 'high').length > 0 && (
          <div className="card border-0 shadow-lg mt-5 mb-4">
            <div className="card-header bg-gradient-danger text-white border-0">
              <div className="d-flex justify-content-between align-items-center">
                <div className="d-flex align-items-center">
                  <i className="fas fa-bell me-2"></i>
                  <span className="fw-bold">التنبيهات الحرجة</span>
                </div>

              </div>
            </div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead className="table-light">
                    <tr>
                      <th className="border-0 fw-bold">الوقت</th>
                      <th className="border-0 fw-bold">الرسالة</th>
                      <th className="border-0 fw-bold">الأولوية</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.filter(a => a.priority === 'high').slice(0, 5).map(a => (
                      <tr key={a.id}>
                        <td className="text-muted">{formatDateTime(a.created_at)}</td>
                        <td className="fw-bold">{a.message}</td>
                        <td>
                          <span className="badge bg-danger">عالي</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* جدول الخوادم التفصيلي */}
        {/* جدول الخوادم النشطة - عرض تفصيلي محسن */}
        {servers.length > 0 && (
          <div className="card border-0 shadow-lg mb-5">
            <div className="card-header bg-gradient text-white border-0" style={{ background: 'linear-gradient(135deg, var(--secondary-color) 0%, var(--dark) 100%)' }}>
              <div className="d-flex justify-content-between align-items-center">
                <div className="d-flex align-items-center">
                  <i className="fas fa-server me-2"></i>
                  <span className="fw-bold">الخوادم النشطة - عرض تفصيلي</span>
                </div>
                <span className="badge bg-white text-info fs-6 fw-bold px-3 py-2 rounded-pill">
                  {servers.length} خادم
                </span>
              </div>
            </div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead className="table-light">
                    <tr>
                      <th className="border-0 fw-bold">
                        <i className="fas fa-server me-1 text-primary"></i>
                        الاسم
                      </th>
                      <th className="border-0 fw-bold">
                        <i className="fas fa-crown me-1 text-warning"></i>
                        الدور
                      </th>
                      <th className="border-0 fw-bold">
                        <i className="fas fa-network-wired me-1 text-info"></i>
                        العنوان
                      </th>
                      <th className="border-0 fw-bold">
                        <i className="fas fa-desktop me-1 text-success"></i>
                        النظام
                      </th>
                      <th className="border-0 fw-bold">
                        <i className="fas fa-heartbeat me-1 text-danger"></i>
                        آخر نبضة
                      </th>
                      <th className="border-0 fw-bold">
                        <i className="fas fa-usb me-1 text-purple"></i>
                        عدد الأجهزة
                      </th>
                      <th className="border-0 fw-bold">
                        <i className="fas fa-signal me-1 text-secondary"></i>
                        الحالة
                      </th>
                      <th className="border-0 fw-bold text-center">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {servers.map(s => (
                      <tr key={s.id} className={`${s.is_active ? 'table-light border-success border-start border-3' : 'table-light'} hover-bg-light`}>
                        <td className="fw-bold">
                          <div className="d-flex align-items-center">
                            <div className="me-3">
                              <i className={`fas fa-server fa-lg ${s.is_active ? 'text-success' : 'text-muted'}`}></i>
                            </div>
                            <div>
                              <div className="fw-bold text-dark">{s.name}</div>
                              {s.cpu && (
                                <small className="text-muted">
                                  <i className="fas fa-microchip me-1"></i>
                                  {s.cpu}
                                </small>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`badge fs-6 px-3 py-2 ${s.role === 'primary' ? 'bg-primary' : 'bg-secondary'}`}>
                            <i className={`fas me-1 ${s.role === 'primary' ? 'fa-crown' : 'fa-shield-alt'}`}></i>
                            {s.role === 'primary' ? 'رئيسي' : 'احتياطي'}
                          </span>
                        </td>
                        <td>
                          <code className="bg-light text-info px-2 py-1 rounded">
                            {s.address || s.ip_address || 'غير محدد'}
                          </code>
                          {s.ram && (
                            <div>
                              <small className="text-muted">
                                <i className="fas fa-memory me-1"></i>
                                {s.ram}
                              </small>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="d-flex align-items-center">
                            <i className={`fab ${s.os?.toLowerCase().includes('windows') ? 'fa-windows text-primary' :
                              s.os?.toLowerCase().includes('linux') ? 'fa-linux text-warning' :
                                s.os?.toLowerCase().includes('ubuntu') ? 'fa-ubuntu text-danger' :
                                  s.os?.toLowerCase().includes('debian') ? 'fa-debian text-danger' :
                                    s.os?.toLowerCase().includes('centos') ? 'fa-centos text-purple' :
                                      s.os?.toLowerCase().includes('fedora') ? 'fa-fedora text-info' :
                                        s.os?.toLowerCase().includes('mac') ? 'fa-apple text-dark' :
                                          'fa-desktop text-secondary'
                              } fa-lg me-2`}></i>
                            <div>
                              <div className="fw-semibold">
                                {s.os || 'نظام غير محدد'}
                              </div>
                              {s.os && (
                                <small className="text-muted">
                                  نظام التشغيل
                                </small>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="d-flex align-items-center">
                            <i className={`fas fa-heartbeat me-2 ${isServerOnline(s) ? 'text-success' : 'text-danger'
                              }`}></i>
                            <div>
                              <div className="fw-semibold">
                                {s.last_heartbeat ? formatDateTime(s.last_heartbeat) : 'لم يتم التواصل'}
                              </div>
                              {s.last_heartbeat && (
                                <small className={`${isServerOnline(s)
                                  ? (parseUTCDate(s.last_heartbeat) > new Date(Date.now() - 120000) ? 'text-success' : 'text-warning')
                                  : 'text-danger'
                                  }`}>
                                  {parseUTCDate(s.last_heartbeat) > new Date(Date.now() - 120000) ? 'متصل الآن' :
                                    isServerOnline(s) ? 'متصل (نشط)' : 'غير متصل'}
                                </small>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="d-flex align-items-center">
                            <span className="badge bg-info fs-6 px-3 py-2 rounded-pill">
                              <i className="fas fa-usb me-1"></i>
                              {s.device_count || 0}
                            </span>
                            <span className="ms-2 small text-muted">جهاز</span>
                          </div>
                        </td>
                        <td>
                          <span className={`badge fs-6 px-3 py-2 bg-${getServerStatusColor(s)}`}>
                            <i className={`fas me-1 ${isServerOnline(s) ? 'fa-check-circle' : 'fa-times-circle'
                              }`}></i>
                            {getServerStatusText(s)}
                          </span>
                        </td>
                        <td className="text-center">
                          <div className="btn-group btn-group-sm">
                            <button
                              className="btn btn-outline-info"
                              title="التفاصيل"
                              onClick={() => navigate(`/servers/details/${s.id}`)}
                            >
                              <i className="fas fa-info-circle"></i>
                            </button>
                            <button
                              className="btn btn-outline-success"
                              title="فحص الاتصال"
                              onClick={async () => {
                                toast.info(`جاري فحص حالة ${s.name}...`);
                                await loadAll(false);
                                setTimeout(() => {
                                  if (isServerOnline(s)) {
                                    toast.success(`الخادم ${s.name} متصل`);
                                  } else {
                                    toast.error(`الخادم ${s.name} غير متصل`);
                                  }
                                }, 500);
                              }}
                            >
                              <i className="fas fa-heartbeat"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer معلومات إضافية */}
            <div className="card-footer bg-light border-0">
              <div className="row text-center">
                <div className="col-md-3">
                  <div className="d-flex align-items-center justify-content-center">
                    <i className="fas fa-server text-primary me-2"></i>
                    <small className="text-muted">
                      <strong>{servers.length}</strong> خادم مسجل
                    </small>
                  </div>
                </div>
                <div className="col-md-3">
                  <div className="d-flex align-items-center justify-content-center">
                    <i className="fas fa-check-circle text-success me-2"></i>
                    <small className="text-muted">
                      <strong>{servers.filter(s => s.is_active).length}</strong> خادم نشط
                    </small>
                  </div>
                </div>
                <div className="col-md-3">
                  <div className="d-flex align-items-center justify-content-center">
                    <i className="fas fa-usb text-info me-2"></i>
                    <small className="text-muted">
                      <strong>{servers.reduce((sum, s) => sum + (s.device_count || 0), 0)}</strong> جهاز إجمالي
                    </small>
                  </div>
                </div>
                <div className="col-md-3">
                  <div className="d-flex align-items-center justify-content-center">
                    <i className="fas fa-crown text-warning me-2"></i>
                    <small className="text-muted">
                      <strong>{servers.filter(s => s.role === 'primary').length}</strong> خادم رئيسي
                    </small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* جدول الأجهزة المتصلة فعلياً - موافق عليها + متصلة */}
        {devices.filter(d => (d.is_connected === true || d.status === 'connected') && d.status !== 'pending' && d.status !== 'waiting' && d.status !== 'discovered').length > 0 && (
          <div className="card border-0 shadow-lg mb-5">
            <div
              className="card-header bg-gradient-success text-white border-0"
            >
              <div className="d-flex justify-content-between align-items-center">
                <div
                  className="d-flex align-items-center cursor-pointer"
                  onClick={() => setShowAllDevices(!showAllDevices)}
                  style={{ cursor: 'pointer', flex: 1 }}
                >
                  <i className="fas fa-usb me-2"></i>
                  <span className="fw-bold">الأجهزة المتصلة حالياً</span>
                  <span className="badge bg-light text-dark ms-2">{devices.filter(d => (d.is_connected === true || d.status === 'connected') && d.status !== 'pending' && d.status !== 'waiting' && d.status !== 'discovered').length}</span>
                  <i className={`fas fa-chevron-${showAllDevices ? 'up' : 'down'} ms-2`}></i>
                </div>

              </div>
            </div>
            {showAllDevices && (
              <div className="card-body p-0">
                <div className="table-responsive">
                  <table className="table table-hover mb-0">
                    <thead className="table-light">
                      <tr>
                        <th className="border-0 fw-bold">الاسم</th>
                        <th className="border-0 fw-bold">الرقم التسلسلي</th>
                        <th className="border-0 fw-bold">النوع</th>
                        <th className="border-0 fw-bold">الحالة</th>
                        <th className="border-0 fw-bold">آخر نشاط</th>
                      </tr>
                    </thead>
                    <tbody>
                      {devices.filter(d => (d.is_connected === true || d.status === 'connected') && d.status !== 'pending' && d.status !== 'waiting' && d.status !== 'discovered').map(d => (
                        <tr key={d.id || d.serial_number}>
                          <td className="fw-bold">{d.name || d.custom_name || 'جهاز غير معروف'}</td>
                          <td>
                            <code className="text-primary">{d.serial_number || d.display_serial || '—'}</code>
                          </td>
                          <td>
                            <span className="badge bg-secondary">{d.device_type || d.display_type || 'USB Device'}</span>
                          </td>
                          <td>
                            <span className="badge bg-success">
                              <i className="fas fa-circle me-1" style={{ fontSize: '8px' }}></i>
                              متصل
                            </span>
                          </td>
                          <td className="text-muted">{formatDateTime(d.last_activity || d.connection_time)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* جدول آخر الأنشطة */}
        <div className="card border-0 shadow-lg mb-5">
          <div className="card-header bg-gradient-warning text-white border-0">
            <div className="d-flex justify-content-between align-items-center">
              <div className="d-flex align-items-center">
                <i className="fas fa-history me-2"></i>
                <span className="fw-bold">أحدث النشاطات</span>
              </div>
              <span className="badge bg-light text-dark">
                {activity.length} سجل
              </span>
            </div>
          </div>
          <div className="card-body p-0">
            {activity.length > 0 ? (
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead className="table-light">
                    <tr>
                      <th className="border-0 fw-bold">الوقت</th>
                      <th className="border-0 fw-bold">الحدث</th>
                      <th className="border-0 fw-bold">الجهاز</th>
                      <th className="border-0 fw-bold">المستخدم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.map(l => (
                      <tr key={l.id || Math.random()}>
                        <td className="text-muted">
                          {l.timestamp ? formatDateTime(l.timestamp) : 'غير محدد'}
                        </td>
                        <td>
                          <span className={`badge ${l.success === false ? 'bg-danger' : 'bg-success'} me-1`}>
                            <i className={`fas ${l.success === false ? 'fa-times' : 'fa-check'} me-1`}></i>
                          </span>
                          <span className="fw-bold">{l.action || 'عملية غير محددة'}</span>
                        </td>
                        <td>
                          <span className="text-primary">
                            <i className="fas fa-usb me-1"></i>
                            {l.device_name || l.target_device || '—'}
                          </span>
                        </td>
                        <td>
                          <span className="text-info">
                            <i className="fas fa-user me-1"></i>
                            {l.user_name || (l.user_id ? `مستخدم ${l.user_id}` : 'النظام')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-5">
                <i className="fas fa-history text-muted fs-1 mb-3"></i>
                <h5 className="text-muted">لا توجد سجلات نشاط</h5>
                <p className="text-muted">
                  سيتم عرض أحدث النشاطات والأحداث هنا عند توفرها
                </p>
              </div>
            )}
          </div>
        </div>

      </div>
    </>
  );
}

export default Dashboard;


