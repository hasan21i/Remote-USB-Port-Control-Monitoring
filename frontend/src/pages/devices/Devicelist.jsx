// src/pages/devices/DeviceList.jsx

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Link, useNavigate } from 'react-router-dom';
import useDevice from '../../hooks/useDevice';
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import useSocket from '../../hooks/useSocket';
import { ToastContainer } from 'react-toastify';
import {
  fetchAgentPendingDevices,
  approveAgentPendingDevice,
  rejectAgentPendingDevice,
  fetchBlockedDevices,
  approveBlockedDevice,
} from '../../utils/api';


const DeviceList = () => {
  const {
    devices,
    isLoading,
    error,
    fetchDevices,
    scanDevices,
    approveDevice,
    denyDevice,
    ejectDevice,
    addToWhitelist,
    addToBlacklist,
    createDevice,
  } = useDevice();

  const navigate = useNavigate();

  // فلاتر البحث المحسّنة
  const [filters, setFilters] = useState({
    search: '',
    type: '',
    whitelist: '',
    blacklist: '',
    risk: '',
    real_only: 'true', // فلتر جديد للأجهزة الحقيقية فقط
    server_id: '', // فلتر جديد للبحث في سيرفر محدد أو جميع السيرفرات
    all_servers: 'true' // البحث في جميع السيرفرات افتراضياً
  });

  const [isScanning, setIsScanning] = useState(false);
  const [devicesSummary, setDevicesSummary] = useState(null);
  const [processingDevices, setProcessingDevices] = useState(new Set()); // أجهزة تتم معالجتها حالياً

  // إضافة حالة للأجهزة المكتشفة مؤقتاً
  const [discoveredDevices, setDiscoveredDevices] = useState([]);
  const [recentlyApproved, setRecentlyApproved] = useState(new Set());

  // *** جديد: الأجهزة المعلقة من العملاء (من الجدول المعزول) ***
  const [agentPendingDevices, setAgentPendingDevices] = useState([]);

  // *** جديد: الأجهزة المحظورة فعلياً من نظام Device Blocker ***
  const [blockedDevices, setBlockedDevices] = useState([]);

  // إضافة فلتر الحالة - افتراضياً عرض الأجهزة المعلقة
  const [statusFilter, setStatusFilter] = useState('pending');

  // *** جديد: جلب الأجهزة المعلقة من العملاء ***
  const loadAgentPendingDevices = useCallback(async () => {
    try {
      const response = await fetchAgentPendingDevices({ status: 'pending', limit: 100 });
      if (response.success && response.devices) {
        setAgentPendingDevices(response.devices);
      }
    } catch (err) {
      console.error('Error loading agent pending devices:', err);
    }
  }, []);

  // *** جديد: جلب الأجهزة المحظورة فعلياً من Device Blocker ***
  const loadBlockedDevices = useCallback(async () => {
    try {
      const response = await fetchBlockedDevices();
      if (response.blocked_devices) {
        setBlockedDevices(response.blocked_devices);
      }
    } catch (err) {
      console.error('Error loading blocked devices:', err);
    }
  }, []);

  // جلب الأجهزة المعلقة من العملاء عند التحميل وبشكل دوري
  useEffect(() => {
    loadAgentPendingDevices();
    loadBlockedDevices();
    // تحديث كل 30 ثانية
    const interval = setInterval(() => {
      loadAgentPendingDevices();
      loadBlockedDevices();
    }, 15000);

    // إضافة مستمعين Electron IPC لتحديث فوري
    if (window.electronAPI) {
      const handleRefresh = () => {
        loadAgentPendingDevices();
        if (typeof fetchDevices === 'function') {
          fetchDevices({ status: statusFilter });
        }
      };

      window.electronAPI.onPendingDeviceRemoved(handleRefresh);
      window.electronAPI.onDeviceApproved(handleRefresh);
      window.electronAPI.onDeviceRejected(handleRefresh);
      window.electronAPI.onDeviceDetected(handleRefresh);

      return () => {
        clearInterval(interval);
        if (window.electronAPI.removeAllListeners) {
          window.electronAPI.removeAllListeners('pending-device-removed');
          window.electronAPI.removeAllListeners('device-approved');
          window.electronAPI.removeAllListeners('device-rejected');
          window.electronAPI.removeAllListeners('device-detected');
        }
      };
    }

    return () => clearInterval(interval);
  }, [loadAgentPendingDevices, loadBlockedDevices, fetchDevices, statusFilter]);

  // تعريف دوال الإشعارات
  const notifyDeviceConnection = useCallback((data) => {
    toast.info(
      <div className="device-notification device-connection-toast">
        <div className="notification-header">
          <i className="fas fa-plug me-2 text-warning" />
          جهاز جديد متصل
        </div>
        <div className="notification-body">
          <div className="device-details">
            <div><strong>الاسم:</strong> {data.name || data.product || 'غير معروف'}</div>
            <div><strong>الرقم التسلسلي:</strong> {data.serial_number}</div>
            <div><strong>الشركة:</strong> {data.manufacturer}</div>
          </div>
        </div>
      </div>,
      {
        position: "top-right",
        autoClose: 5000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        className: "device-connection-toast"
      }
    );
  }, []);

  const notifyDeviceReconnection = useCallback((data) => {
    toast.success(
      <div className="device-notification device-reconnection-toast">
        <div className="notification-header">
          <i className="fas fa-wifi me-2 text-success" />
          إعادة اتصال الجهاز
        </div>
        <div className="notification-body">
          <div className="device-details">
            <div><strong>الاسم:</strong> {data.name || data.product || 'غير معروف'}</div>
            <div><strong>الرقم التسلسلي:</strong> {data.serial_number}</div>
            <div><strong>الحالة:</strong> متصل مرة أخرى</div>
          </div>
        </div>
      </div>,
      {
        position: "top-right",
        autoClose: 4000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        className: "device-reconnection-toast"
      }
    );
  }, []);

  const notifyDeviceDisconnection = useCallback((data) => {
    toast.warning(
      <div className="device-notification device-disconnection-toast">
        <div className="notification-header">
          <i className="fas fa-unlink me-2 text-warning" />
          انقطاع اتصال الجهاز
        </div>
        <div className="notification-body">
          <div className="device-details">
            <div><strong>الاسم:</strong> {data.name || data.product || 'غير معروف'}</div>
            <div><strong>الرقم التسلسلي:</strong> {data.serial_number}</div>
            <div><strong>الحالة:</strong> منفصل</div>
          </div>
        </div>
      </div>,
      {
        position: "top-right",
        autoClose: 4000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        className: "device-disconnection-toast"
      }
    );
  }, []);

  const notifyGenericDevice = useCallback((data) => {
    toast.info(
      <div className="device-notification generic-notification">
        <div className="notification-header">
          <i className="fas fa-bell me-2 text-info" />
          إشعار الجهاز
        </div>
        <div className="notification-body">
          <div className="device-details">
            <div><strong>الرسالة:</strong> {data.message || 'رسالة عامة من الجهاز'}</div>
            {data.device_name && <div><strong>الجهاز:</strong> {data.device_name}</div>}
          </div>
        </div>
      </div>,
      {
        position: "top-right",
        autoClose: 4000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        className: "generic-notification"
      }
    );
  }, []);

  const notifySecurityAlert = useCallback((alert) => {
    toast.error(
      <div className="device-notification security-alert-toast">
        <div className="notification-header">
          <i className="fas fa-shield-alt me-2 text-danger" />
          تنبيه أمني
        </div>
        <div className="notification-body">
          <div className="device-details">
            <div><strong>نوع التنبيه:</strong> {alert.type || 'تنبيه أمني'}</div>
            <div><strong>الرسالة:</strong> {alert.message || 'رسالة تنبيه أمني'}</div>
            {alert.device_name && <div><strong>الجهاز:</strong> {alert.device_name}</div>}
            {alert.severity && <div><strong>مستوى الخطورة:</strong> {alert.severity}</div>}
          </div>
        </div>
      </div>,
      {
        position: "top-right",
        autoClose: 6000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        className: "security-alert-toast"
      }
    );
  }, []);

  // تحميل الأجهزة أول مرة مع الفلاتر المحسّنة
  useEffect(() => {
    const params = {
      status: statusFilter,
      real_only: filters.real_only,
      all_servers: filters.all_servers, // البحث في جميع السيرفرات
      server_id: filters.server_id || undefined // سيرفر محدد (إذا لم يكن البحث في الكل)
    };

    fetchDevices(params).then((response) => {
      // معالجة البيانات الجديدة من الـ API المحسن
      if (response && response.summary) {
        setDevicesSummary(response.summary);
      }
    }).catch(_error => {
      // Failed to fetch devices - error handling
      // console.warn('Failed to fetch devices:', _error);
    });
  }, [fetchDevices, statusFilter, filters.real_only, filters.all_servers, filters.server_id]);

  // عرض الأجهزة الموجودة بالجداول فقط (الأجهزة المعلقة من الأيجنت والسيرفر) وبدون تكرار
  const pendingDevices = useMemo(() => {
    // 1. جلب الأجهزة من الجداول المعزولة (agent_pending_devices و server_pending_devices المدمجة)
    const agentPendingMapped = agentPendingDevices.map(d => {
      const isSubServer = d.source === 'agent';
      return {
        id: `${isSubServer ? 'agent' : 'server'}_${d.id}`,
        agent_pending_id: d.id,
        server_pending_id: d.id,
        name: d.device_name || d.name || 'Unknown Device',
        serial_number: d.serial_number || '',
        manufacturer: d.manufacturer || 'Unknown',
        device_type: d.device_type || d.device_class || 'USB Device',
        vendor_id: d.vendor_id || '',
        product_id: d.product_id || '',
        usb_port: d.usb_port || d.physical_path || 'USB Port',
        status: isSubServer ? 'agent_pending' : 'server_pending',
        is_agent_pending: isSubServer,
        is_server_pending: !isSubServer,
        is_connected: true,
        connection_time: d.discovered_at || d.created_at || new Date().toISOString(),
        server_name: isSubServer ? (d.agent_server_name || d.agent_hostname || 'خادم فرعي') : 'الخادم المركزي',
        server_id: isSubServer ? d.agent_server_id : (d.server_id || 1),
        agent_hostname: d.agent_hostname || '',
        agent_ip_address: d.agent_ip_address || '',
        system_os: d.system_os || '',
        discovery_method: isSubServer ? (d.discovery_method || 'electron_agent') : 'server_agent'
      };
    });

    // 2. إزالة التكرار: ممنوع عرض أي جهاز مرتين، يعتمد على الرقم التسلسلي، وإن لم يوجد يعتمد على VID+PID
    const uniquePending = agentPendingMapped.reduce((acc, current) => {
      const exists = acc.find(item => 
        (item.serial_number && current.serial_number && item.serial_number === current.serial_number) || 
        (!item.serial_number && !current.serial_number && item.vendor_id === current.vendor_id && item.product_id === current.product_id)
      );
      if (!exists) {
        return acc.concat([current]);
      }
      return acc;
    }, []);

    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.debug('📋 Pending devices (From tables only, no duplicates):', {
        agentPending: agentPendingMapped.length,
        totalUnique: uniquePending.length
      });
    }

    return uniquePending;
  }, [agentPendingDevices]);

  // تحميل الأجهزة حسب الفلتر
  useEffect(() => {
    const params = {
      status: statusFilter,
      real_only: filters.real_only,
      all_servers: filters.all_servers, // البحث في جميع السيرفرات
      server_id: filters.server_id || undefined // سيرفر محدد (إذا لم يكن البحث في الكل)
    };

    fetchDevices(params).then((response) => {
      if (response && response.summary) {
        setDevicesSummary(response.summary);
      }
    }).catch(_error => {
      // Failed to fetch devices with filter - error handling
      // console.warn('Failed to fetch devices with filter:', _error);
    });
  }, [fetchDevices, statusFilter, filters.real_only, filters.all_servers, filters.server_id]);

  // فلترة الأجهزة مع دعم البنية الجديدة وتحسين منطق الحالة
  const filteredDevices = useMemo(() => {
    let deviceList = [];

    // استخراج قائمة الأجهزة من الاستجابة
    if (Array.isArray(devices)) {
      deviceList = devices;
    } else if (devices && devices.devices && Array.isArray(devices.devices)) {
      deviceList = devices.devices;
    }

    // إضافة الأجهزة المكتشفة مؤقتاً
    const discoveredDeviceList = discoveredDevices.map(d => {
      const dev = d.device || d;
      const wasRecentlyApproved = recentlyApproved.has(dev.serial_number);
      const forcedStatus = wasRecentlyApproved && statusFilter === 'connected' ? 'connected' : (dev.status || 'discovered');
      return ({
        ...dev,
        status: forcedStatus,
        is_discovered: true,
        is_recently_approved: wasRecentlyApproved,
        discovered_at: dev.detected_at || new Date().toISOString()
      });
    });

    // دمج الأجهزة من قاعدة البيانات مع المكتشفة
    let combinedDevices = [...deviceList, ...discoveredDeviceList];

    // إذا كان الفلتر "الكل"، يجب إضافة أجهزة العملاء (agents) المعلقة والأجهزة المحظورة (blocker) للقائمة الشاملة
    if (statusFilter === 'all') {
      const agentPendingMapped = agentPendingDevices.map(d => ({
        ...d,
        status: 'agent_pending',
        is_agent_pending: true
      }));


      // دمج الكل وتصفية المكرر بناءً على الرقم التسلسلي
      const allMerged = [...combinedDevices, ...agentPendingMapped];
      const seenSerials = new Set();
      combinedDevices = allMerged.filter(d => {
         const sn = d.serial_number || (d.meta_data ? (typeof d.meta_data === 'string' ? JSON.parse(d.meta_data).device_identifier : d.meta_data.device_identifier) : null);
         if (sn && seenSerials.has(sn)) return false;
         if (sn) seenSerials.add(sn);
         return true;
      });
    }

    if (!combinedDevices.length) return [];

    return combinedDevices
      .map(d => {
        const meta = typeof d.meta_data === 'string' ? JSON.parse(d.meta_data || '{}') : d.meta_data || d.metadata || {};
        return {
          ...d,
          metadata: meta,
          serial_number: d.serial_number || meta.device_identifier,
          usb_port: d.usb_port || d.port_info?.usb_port || meta.port_number || '-',
          physical_path: d.physical_path || d.port_info?.physical_path || meta.physical_path || '-',
          // إضافة الحقول الجديدة
          device_type: d.device_type || meta.device_type || 'Unknown',
          power_consumption: d.power_consumption || meta.power_consumption || 0,
          detection_method: d.detection_method || meta.discovery_method || 'legacy',
          is_real_device: d.is_real_device !== undefined ? d.is_real_device : true,
          system: d.system || meta.system || 'Unknown'
        };
      })
      // فلترة حسب الحالة المحددة فقط - لا نخلط الحالات
      // القاعدة: الأجهزة المعلقة (pending) تعرض فقط إذا كانت متصلة فعلياً
      // الأجهزة المسجلة (الموافقة عليها) تعرض دائماً حسب اختيار المستخدم
      .filter(d => {
        // إذا كان الفلتر "الكل"، لا نستثني أجهزة العملاء لنعرض كل شيء
        if (statusFilter !== 'all') {
          // استثناء الأجهزة التي حالتها agent_pending (معروضة في القسم المنفصل أعلى)
          if (d.status === 'agent_pending' || d.is_agent_pending) return false;

          // استثناء الأجهزة الموجودة في قائمة agent pending (مطابقة الرقم التسلسلي)
          const agentSerials = new Set(agentPendingDevices.map(a => a.serial_number));
          if (d.serial_number && agentSerials.has(d.serial_number)) return false;
        }

        const isWaitingApproval = d.status === 'pending' || d.status === 'discovered' || d.status === 'waiting';

        // إذا كان الجهاز معلقاً لكنه قادم من DB أو اكتشاف محلي، وليس متصلاً فعلياً، لا نعرضه في أي قائمة
        // *ملاحظة:* لا نطبق هذا الشرط على أجهزة الـ agent المعلقة لأن اتصالها يدار من طرف الـ Agent نفسه
        if (isWaitingApproval && d.is_connected !== true && statusFilter !== 'all') {
          return false;
        }

        if (statusFilter === 'all') return true;
        if (statusFilter === 'discovered') return d.status === 'discovered';
        return d.status === statusFilter;
      })
      // فلترة البحث
      .filter(d => {
        const term = filters.search.trim().toLowerCase();
        if (term) {
          const hay = `${d.name} ${d.serial_number} ${d.manufacturer} ${d.product} ${d.usb_port} ${d.physical_path} ${d.device_type}`.toLowerCase();
          if (!hay.includes(term)) return false;
        }
        return true;
      })
      // فلترة نوع الجهاز
      .filter(d => {
        if (!filters.type || filters.type === 'all') return true;
        return d.device_type.toLowerCase().includes(filters.type.toLowerCase());
      })
      // فلترة القائمة البيضاء
      .filter(d => {
        if (filters.whitelist === 'true') return d.whitelisted;
        if (filters.whitelist === 'false') return !d.whitelisted;
        return true;
      })
      // فلترة القائمة السوداء
      .filter(d => {
        if (filters.blacklist === 'true') return d.blacklisted;
        if (filters.blacklist === 'false') return !d.blacklisted;
        return true;
      })
      // فلترة مستوى الخطر
      .filter(d => {
        return !filters.risk || d.risk_level === filters.risk;
      })
      // إزالة التكرار بناءً على serial_number مع تفضيل البيانات الأحدث
      .reduce((unique, device) => {
        const index = unique.findIndex(d => d.serial_number === device.serial_number);
        if (index === -1) {
          unique.push(device);
        } else {
          // إذا كان الجهاز الجديد "مكتشف" (discovered) والموجود لا، استبدله لأنه أحدث
          if (device.is_discovered && !unique[index].is_discovered) {
            unique[index] = device;
          }
        }
        return unique;
      }, []);
  }, [devices, discoveredDevices, filters, statusFilter, recentlyApproved, agentPendingDevices]);

  // تغير فلتر واحد
  const handleFilterChange = useCallback((name, value) => {
    setFilters(f => ({ ...f, [name]: value }));
  }, []);

  // زر تحديث الأجهزة المحسن
  const handleScan = useCallback(async () => {
    if (isScanning) return; // منع المسح المتكرر

    setIsScanning(true);
    const scanStartTime = Date.now();

    try {
      // إظهار رسالة بدء المسح
      toast.info(
        <div>
          <i className="fas fa-search me-2" />
          <b>جاري فحص الأجهزة...</b>
          <div className="mt-1 small">
            يتم البحث عن الأجهزة USB الحقيقية المتصلة
          </div>
        </div>,
        {
          autoClose: false,
          toastId: 'scan-progress'
        }
      );

      // تنفيذ المسح واستخدام النتيجة المُعادة
      const devicesResponse = await scanDevices();

      // حساب وقت المسح
      const scanDuration = Date.now() - scanStartTime;

      // استخراج الإحصائيات من الاستجابة
      let scanStats = {
        duration: scanDuration,
        total_found: 0,
        real_devices: 0,
        fake_devices: 0
      };

      if (devicesResponse && devicesResponse.summary) {
        // إذا وُجدت summary يستخدمها
        scanStats = {
          ...scanStats,
          total_found: devicesResponse.summary.total_devices || 0,
          real_devices: devicesResponse.summary.real_devices || 0,
          fake_devices: (devicesResponse.summary.total_devices || 0) - (devicesResponse.summary.real_devices || 0)
        };
      } else if (Array.isArray(devicesResponse)) {
        // إذا كانت مصفوفة، يتصرّف كالسابق
        scanStats.total_found = devicesResponse.length;
        scanStats.real_devices = devicesResponse.filter(d => d.is_real !== false).length;
        scanStats.fake_devices = devicesResponse.length - scanStats.real_devices;
      } else if (devicesResponse && devicesResponse.total_real_devices !== undefined) {
        // وإلا، يقرأ total_real_devices ويحسب total_found كأكبر قيمة بين total_real_devices وطول added
        const addedCount = devicesResponse.added ? devicesResponse.added.length : 0;
        scanStats.real_devices = devicesResponse.total_real_devices;
        scanStats.total_found = Math.max(devicesResponse.total_real_devices, addedCount);
        scanStats.fake_devices = scanStats.total_found - scanStats.real_devices;
      }

      // دمج added في discoveredDevices ليظهر الجهاز فوراً ضمن "معلقة"
      if (devicesResponse && devicesResponse.added && Array.isArray(devicesResponse.added)) {
        setDiscoveredDevices(prev => {
          const newDevices = [...prev];
          devicesResponse.added.forEach(addedDevice => {
            // تجنب التكرار
            const exists = newDevices.find(d =>
              d.device && d.device.serial_number === addedDevice.serial_number
            );
            if (!exists) {
              newDevices.push({
                device: addedDevice,
                server_id: devicesResponse.server_id || 1,
                message: `تم اكتشاف جهاز جديد: ${addedDevice.name || 'Unknown Device'}`
              });
            }
          });
          return newDevices;
        });
      }

      // تحديث قوائم الأجهزة المعلقة بعد المسح
      await loadAgentPendingDevices();
      await loadBlockedDevices();

      // إزالة رسالة التقدم
      toast.dismiss('scan-progress');

      // دمج الأجهزة لمنع التكرار وحساب العدد الصحيح
      const uniqueSerials = new Set();
      
      // إضافة أجهزة السيرفر (Blocked)
      blockedDevices.forEach(device => {
        if (device.serial_number) uniqueSerials.add(device.serial_number);
      });
      
      // إضافة أجهزة العملاء (Agent)
      agentPendingDevices.forEach(device => {
        if (device.serial_number) uniqueSerials.add(device.serial_number);
      });

      // إضافة المكتشفة حديثاً
      const newlyDiscovered = scanStats.total_found > 0 ? scanStats.total_found : 0;

      // حساب إجمالي الأجهزة بشكل صحيح من دون تكرار (نأخذ العدد الأكبر من المكتشفة أو المعلقة فريدة)
      const totalPending = Math.max(uniqueSerials.size, newlyDiscovered);

      // إظهار نتيجة المسح التفصيلية
      toast.success(
        <div>
          <i className="fas fa-check-circle me-2 text-success" />
          <b>تم إكمال فحص الأجهزة بنجاح</b>
          <div className="mt-2 small">
            <div><strong>وقت المسح:</strong> {Math.round(scanDuration / 1000)} ثانية</div>
            <div><strong>إجمالي الأجهزة المعلقة المتصلة:</strong> {totalPending}</div>
            {newlyDiscovered > 0 && (
              <div><strong>جهاز متصل تم معالجته:</strong> {newlyDiscovered}</div>
            )}
          </div>
        </div>,
        {
          autoClose: 6000,
          toastId: 'scan-result'
        }
      );

      // تحديث الإحصائيات إذا كانت متوفرة
      if (devicesResponse && devicesResponse.summary) {
        setDevicesSummary(devicesResponse.summary);
      }

    } catch (error) {
      console.error('Scan error:', error);

      // إزالة رسالة التقدم
      toast.dismiss('scan-progress');

      // إظهار رسالة خطأ مفصلة
      const errorMessage = error.response?.data?.error ||
        error.message ||
        'حدث خطأ غير متوقع أثناء فحص الأجهزة';

      toast.error(
        <div>
          <i className="fas fa-exclamation-triangle me-2 text-danger" />
          <b>فشل في فحص الأجهزة</b>
          <div className="mt-1 small">
            {errorMessage}
          </div>
        </div>,
        {
          autoClose: 5000,
          toastId: 'scan-error'
        }
      );
    } finally {
      setIsScanning(false);
    }
  }, [scanDevices, isScanning, loadAgentPendingDevices, loadBlockedDevices, agentPendingDevices, blockedDevices]);

  // الموافقة على جهاز
  const handleAddToWhitelist = useCallback(async device => {
    if (processingDevices.has(device.serial_number)) return; // منع النقرات المتكررة

    setProcessingDevices(prev => new Set([...prev, device.serial_number]));
    try {
      await addToWhitelist(device.serial_number);
      toast.success(`تم إضافة الجهاز ${device.name || device.product || 'غير معروف'} إلى القائمة البيضاء`);
      await fetchDevices({ status: statusFilter, real_only: filters.real_only });

      // توجيه إلى صفحة القائمة البيضاء بعد ثانيتين
      setTimeout(() => {
        navigate('/security/whitelist');
      }, 2000);
    } catch (error) {
      console.error('خطأ في إضافة الجهاز إلى القائمة البيضاء:', error);
      toast.error('فشل في إضافة الجهاز إلى القائمة البيضاء');
    } finally {
      setProcessingDevices(prev => {
        const newSet = new Set(prev);
        newSet.delete(device.serial_number);
        return newSet;
      });
    }
  }, [addToWhitelist, fetchDevices, statusFilter, filters.real_only, processingDevices, navigate]);

  // رفض جهاز
  const handleAddToBlacklist = useCallback(async device => {
    if (processingDevices.has(device.serial_number)) return; // منع النقرات المتكررة

    setProcessingDevices(prev => new Set([...prev, device.serial_number]));
    try {
      await addToBlacklist(device.serial_number);
      toast.success(`تم إضافة الجهاز ${device.name || device.product || 'غير معروف'} إلى القائمة السوداء`);
      await fetchDevices({ status: statusFilter, real_only: filters.real_only });

      // توجيه إلى صفحة القائمة السوداء بعد ثانيتين
      setTimeout(() => {
        navigate('/security/blacklist');
      }, 2000);
    } catch (error) {
      console.error('خطأ في إضافة الجهاز إلى القائمة السوداء:', error);
      toast.error('فشل في إضافة الجهاز إلى القائمة السوداء');
    } finally {
      setProcessingDevices(prev => {
        const newSet = new Set(prev);
        newSet.delete(device.serial_number);
        return newSet;
      });
    }
  }, [addToBlacklist, fetchDevices, statusFilter, filters.real_only, processingDevices, navigate]);

  // إخراج الجهاز
  const handleEjectDevice = useCallback(async device => {
    await ejectDevice(device.serial_number);
    await fetchDevices({ status: statusFilter, real_only: filters.real_only });
  }, [ejectDevice, fetchDevices, statusFilter, filters.real_only]);

  // الموافقة/الرفض
  const handleApprove = useCallback(async (device) => {
    // *** جديد: التعامل مع الأجهزة المحظورة فعلياً من Device Blocker ***
    if (device.is_blocked_device && device.pnp_device_id) {
      try {
        setProcessingDevices(prev => new Set(prev).add(device.serial_number));

        const result = await approveBlockedDevice(device.pnp_device_id);

        if (result.success) {
          // إزالة من القائمة المحلية فوراً
          setBlockedDevices(prev => prev.filter(d => d.device_id !== device.pnp_device_id));

          toast.success(
            `✅ تمت الموافقة على الجهاز: ${device.name} وتم تفعيله`
          );

          // تحديث قوائم الأجهزة
          await loadBlockedDevices();
          await fetchDevices({ status: statusFilter });
        } else {
          toast.error(result.error || 'فشل في تفعيل الجهاز');
        }
      } catch (error) {
        console.error('خطأ في الموافقة على الجهاز المحظور:', error);
        const errorMsg = error.response?.data?.error || error.message || 'فشل في تفعيل الجهاز';
        toast.error(errorMsg);
      } finally {
        setProcessingDevices(prev => {
          const next = new Set(prev);
          next.delete(device.serial_number);
          return next;
        });
      }
      return;
    }

    // *** التعامل مع الأجهزة المعلقة من العملاء ***
    if (device.is_agent_pending && device.agent_pending_id) {
      try {
        setProcessingDevices(prev => new Set(prev).add(device.serial_number));

        const result = await approveAgentPendingDevice(device.agent_pending_id);

        if (result.success) {
          setAgentPendingDevices(prev => prev.filter(d => d.id !== device.agent_pending_id));

          setStatusFilter('connected');
          await fetchDevices({
            status: 'connected',
            real_only: filters.real_only,
            all_servers: filters.all_servers
          });

          await loadAgentPendingDevices();

          setRecentlyApproved(prev => {
            const next = new Set(prev);
            next.add(device.serial_number);
            return next;
          });

          setTimeout(() => {
            setRecentlyApproved(prev => {
              const next = new Set(prev);
              next.delete(device.serial_number);
              return next;
            });
          }, 15000);

          toast.success(`✅ تمت الموافقة على الجهاز من العميل: ${device.name} وتم نقله لتاب متصل`);
        }
      } catch (error) {
        console.error('خطأ في الموافقة على جهاز العميل:', error);
        toast.error('فشل في الموافقة على الجهاز');
      } finally {
        setProcessingDevices(prev => {
          const next = new Set(prev);
          next.delete(device.serial_number);
          return next;
        });
      }
      return;
    }

    if (device.is_discovered) {
      // إذا كان الجهاز مكتشفاً، أضفه مباشرة بحالة متصلة
      try {
        // تحويل vendor_id و product_id إلى نصوص آمنة
        const safeVendorId = String(device.vendor_id || '0000');
        const safeProductId = String(device.product_id || '0000');

        await createDevice({
          name: device.name,
          serial_number: device.serial_number,
          vendor_id: safeVendorId,
          product_id: safeProductId,
          manufacturer: device.manufacturer,
          usb_port: device.usb_port,
          physical_path: device.physical_path,
          device_type: device.device_type,
          status: 'connected' // تغيير من 'pending' إلى 'connected'
        });

        // إزالة من الأجهزة المكتشفة
        setDiscoveredDevices(prev => prev.filter(d => d.device.serial_number !== device.serial_number));

        // وسم الجهاز كموافق عليه مؤخراً حتى يظهر في قائمة المتصلة فوراً
        setRecentlyApproved(prev => {
          const next = new Set(prev);
          next.add(device.serial_number);
          return next;
        });
        // إزالة الوسم بعد 15 ثانية إن لم يحدث تحديث من الخادم
        setTimeout(() => {
          setRecentlyApproved(prev => {
            const next = new Set(prev);
            next.delete(device.serial_number);
            return next;
          });
        }, 15000);

        // تحديث قائمة الأجهزة المتصلة مباشرة
        await fetchDevices({ status: 'connected' });

        toast.success(`تمت إضافة الجهاز ${device.name || device.product || 'غير معروف'} وهو الآن متصل`);
      } catch (error) {
        console.error('خطأ في إضافة الجهاز المكتشف:', error);
        // عرض رسالة الخطأ الحقيقية من الخادم
        const errorMessage = error.response?.data?.error ||
          error.response?.data?.message ||
          error.message ||
          'فشل في إضافة الجهاز المكتشف';
        toast.error(errorMessage);
      }
    } else {
      await approveDevice(device.serial_number);
      await fetchDevices({ status: statusFilter });
    }
  }, [createDevice, approveDevice, fetchDevices, statusFilter, loadAgentPendingDevices, loadBlockedDevices, filters.all_servers, filters.real_only]);

  const handleDeny = useCallback(async (device) => {
    // *** التعامل مع الأجهزة المكتشفة من البلوكر - الرفض يبقيها معطلة ***
    if (device.is_blocked_device && device.pnp_device_id) {
      setBlockedDevices(prev => prev.filter(d => d.device_id !== device.pnp_device_id));
      toast.info(`❌ تم رفض الجهاز: ${device.name}`);
      return;
    }

    // *** التعامل مع الأجهزة المعلقة من العملاء ***
    if (device.is_agent_pending && device.agent_pending_id) {
      try {
        setProcessingDevices(prev => new Set(prev).add(device.serial_number));

        const result = await rejectAgentPendingDevice(device.agent_pending_id, 'رفض من قبل المسؤول');

        if (result.success) {
          // إزالة من القائمة المحلية
          setAgentPendingDevices(prev => prev.filter(d => d.id !== device.agent_pending_id));
          toast.info(`❌ تم رفض الجهاز من العميل: ${device.name}`);
        }
      } catch (error) {
        console.error('خطأ في رفض جهاز العميل:', error);
        toast.error('فشل في رفض الجهاز');
      } finally {
        setProcessingDevices(prev => {
          const next = new Set(prev);
          next.delete(device.serial_number);
          return next;
        });
      }
      return;
    }

    if (device.is_discovered) {
      // إزالة من الأجهزة المكتشفة فقط
      setDiscoveredDevices(prev => prev.filter(d => d.device.serial_number !== device.serial_number));
      toast.info(`تم تجاهل الجهاز المكتشف: ${device.name || device.product || 'غير معروف'}`);
    } else {
      await denyDevice(device.serial_number);
      await fetchDevices({ status: statusFilter });
    }
  }, [denyDevice, fetchDevices, statusFilter]);

  // مكون عرض إحصائيات محسّن
  const DevicesSummaryCard = ({ summary }) => {
    if (!summary && pendingDevices.length === 0 && filteredDevices.length === 0) return null;

    // حساب الأرقام الصحيحة بناءً على الحالة
    let dbPendingCount = 0;
    let agentCount = 0;
    let totalPendingCount = 0;

    if (statusFilter === 'pending') {
        // نعتمد على الأجهزة المجمعة المعروضة فعلياً في الشاشة لتكون الأرقام متطابقة
        dbPendingCount = pendingDevices.filter(d => d.is_server_pending || !d.is_agent_pending).length;
        agentCount = pendingDevices.filter(d => d.is_agent_pending).length;
        totalPendingCount = pendingDevices.length;
    } else {
      // الحالات الأخرى (متصل، مفصول، الخ)
      dbPendingCount = filteredDevices.length;
      totalPendingCount = filteredDevices.length;
    }

    // تسمية العنوان حسب الحالة المختارة
    const statusLabels = {
      pending: 'المعلقة',
      connected: 'المتصلة',
      disconnected: 'المفصولة',
      denied: 'المرفوضة',
      all: 'الكل'
    };
    const statusLabel = statusLabels[statusFilter] || statusFilter;
    const scopeLabel = filters.all_servers === 'true' ? 'جميع السيرفرات' : 'السيرفر الحالي';

    return (
      <div className="card mb-4 border-info shadow-sm" style={{ borderRadius: '12px', overflow: 'hidden' }}>
        <div className="card-header bg-info bg-opacity-10 border-info border-opacity-25 d-flex justify-content-between align-items-center py-3">
          <div className="d-flex align-items-center gap-2">
            <i className="fas fa-chart-bar text-info" style={{ fontSize: '1.1rem' }} />
            <span className="fw-semibold text-body" style={{ fontSize: '1rem' }}>
              ملخص الأجهزة {statusLabel}
            </span>
          </div>
          <span className="badge bg-info text-dark" style={{ fontSize: '0.75rem', padding: '5px 10px', borderRadius: '20px' }}>
            <i className="fas fa-globe me-1" />{scopeLabel}
          </span>
        </div>
        <div className="card-body py-3">
          <div className="row g-3">
            {/* الإجمالي */}
            <div className="col">
              <div className="p-3 bg-body border-start border-4 border-primary rounded shadow-sm d-flex flex-column align-items-center justify-content-center h-100">
                <div className="text-primary mb-1" style={{ fontSize: '1.75rem', fontWeight: 600, lineHeight: 1 }}>{totalPendingCount}</div>
                <div className="text-body-secondary" style={{ fontSize: '0.85rem' }}>
                  <i className="fas fa-layer-group me-1" />إجمالي {statusLabel}
                </div>
              </div>
            </div>
            {/* السيرفر الرئيسي */}
            <div className="col">
              <div className="p-3 bg-body border-start border-4 border-success rounded shadow-sm d-flex flex-column align-items-center justify-content-center h-100">
                <div className="text-success mb-1" style={{ fontSize: '1.75rem', fontWeight: 600, lineHeight: 1 }}>{dbPendingCount}</div>
                <div className="text-body-secondary" style={{ fontSize: '0.85rem' }}>
                  <i className="fas fa-server me-1" />السيرفر الرئيسي
                </div>
              </div>
            </div>
            {/* الـ Agents - يظهر للمعلق أو الكل */}
            {(statusFilter === 'pending' || statusFilter === 'all') && (
              <div className="col">
                <div className="p-3 bg-body border-start border-4 border-warning rounded shadow-sm d-flex flex-column align-items-center justify-content-center h-100">
                  <div className="text-warning mb-1" style={{ fontSize: '1.75rem', fontWeight: 600, lineHeight: 1 }}>{agentCount}</div>
                  <div className="text-body-secondary" style={{ fontSize: '0.85rem' }}>
                    <i className="fas fa-desktop me-1" />الخوادم الفرعية
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    );
  };

  // PropTypes for DevicesSummaryCard
  DevicesSummaryCard.propTypes = {
    summary: PropTypes.shape({
      total_devices: PropTypes.number,
      system_type: PropTypes.string
    })
  };

  // مكون عرض معلومات الجهاز المحسّنة
  const EnhancedDeviceCard = ({ device, onAddToWhitelist, onAddToBlacklist, onEjectDevice, onApprove, onDeny }) => {
    const isDiscovered = device.status === 'discovered' || device.is_discovered;
    const isAgentPending = device.is_agent_pending;
    const isBlockedDevice = device.is_blocked_device;
    const isProcessing = processingDevices.has(device.serial_number);

    return (
      <div className={`card h-100 ${device.is_real_device ? 'border-success' : 'border-warning'} ${isDiscovered ? 'border-info' : ''} ${isAgentPending ? 'border-warning' : ''}`}>
        <div className="card-header d-flex justify-content-between align-items-center">
          <h6 className="mb-0">{device.name || device.product || 'جهاز غير معروف'}</h6>
          <div className="d-flex gap-1">
            {device.is_real_device && (
              <span className="badge bg-success" title="جهاز حقيقي">
                <i className="fas fa-check" />
              </span>
            )}
            {isAgentPending && (
              <span className="badge bg-warning text-dark" title="جهاز من خادم فرعي (Sub-server)">
                <i className="fas fa-desktop me-1" />
                خادم فرعي
              </span>
            )}
            {isDiscovered && !isAgentPending && (
              <span className="badge bg-info" title="جهاز مكتشف حديثاً">
                <i className="fas fa-search-plus" />
              </span>
            )}
            {device.detection_method === 'enhanced_scan' && (
              <span className="badge bg-info" title="مكتشف بالطريقة المحسنة">
                <i className="fas fa-star" />
              </span>
            )}
          </div>
        </div>
        <div className="card-body">
          <div className="row text-small">
            <div className="col-12 mb-2">
              <strong>الرقم التسلسلي:</strong> {device.serial_number || 'غير متاح'}
            </div>
            <div className="col-6 mb-2">
              <strong>الشركة:</strong> {device.manufacturer || 'غير معروف'}
            </div>
            <div className="col-6 mb-2">
              <strong>النوع:</strong> {device.device_type || device.device_class || 'غير معروف'}
            </div>
            <div className="col-6 mb-2">
              <strong>المنفذ:</strong> {device.usb_port || 'غير محدد'}
            </div>
            <div className="col-6 mb-2">
              <strong>الطاقة:</strong> {device.power_consumption ? `${device.power_consumption}W` : 'غير محدد'}
            </div>
            {device.system && (
              <div className="col-6 mb-2">
                <strong>النظام:</strong> {device.system}
              </div>
            )}
            {/* معلومات العميل للأجهزة من العملاء */}
            {isAgentPending && (
              <>
                {device.agent_hostname && (
                  <div className="col-6 mb-2">
                    <strong>جهاز الخادم الفرعي:</strong> {device.agent_hostname}
                  </div>
                )}
                {device.system_os && (
                  <div className="col-6 mb-2">
                    <strong>نظام التشغيل:</strong> {device.system_os}
                  </div>
                )}
              </>
            )}
            {device.detected_at && (
              <div className="col-6 mb-2">
                <strong>وقت الاكتشاف:</strong> {(() => {
                  let dStr = device.detected_at;
                  if (dStr && !dStr.endsWith('Z') && !dStr.includes('+')) dStr += 'Z';
                  return new Date(dStr).toLocaleString('ar-IQ');
                })()}
              </div>
            )}
            {/* المصدر: السيرفر المركزي أو العميل الفرعي */}
            <div className="col-12 mb-2">
              <strong>المصدر:</strong>
              {(() => {
                // تحديد نوع المصدر
                if (isAgentPending || device.discovery_method === 'electron_agent') {
                  // جهاز من خادم فرعي
                  return (
                    <span className="ms-2">
                      <span className="badge bg-warning text-dark me-1">
                        <i className="fas fa-desktop me-1" />
                        خادم فرعي
                      </span>
                      {device.server_name && (
                        <span className="badge bg-secondary me-1">{device.server_name}</span>
                      )}
                      {device.agent_hostname && (
                        <span className="badge bg-info">{device.agent_hostname}</span>
                      )}
                    </span>
                  );
                } else if (device.server_id || device.server_name) {
                  // جهاز من سيرفر مسجل
                  return (
                    <span className="ms-2">
                      <span className={`badge ${device.is_central_server || device.server_role === 'primary' ? 'bg-primary' : 'bg-info'} me-1`}>
                        <i className={`fas ${device.is_central_server || device.server_role === 'primary' ? 'fa-server' : 'fa-network-wired'} me-1`} />
                        {device.is_central_server || device.server_role === 'primary' ? 'سيرفر رئيسي' : 'سيرفر فرعي'}
                      </span>
                      {device.server_name && (
                        <span className="badge bg-secondary">{device.server_name}</span>
                      )}
                    </span>
                  );
                } else if (isDiscovered) {
                  // جهاز مكتشف محلياً
                  return (
                    <span className="ms-2">
                      <span className="badge bg-success">
                        <i className="fas fa-search me-1" />
                        اكتشاف محلي
                      </span>
                    </span>
                  );
                } else {
                  // جهاز من قاعدة البيانات  
                  return (
                    <span className="ms-2">
                      <span className="badge bg-secondary">
                        <i className="fas fa-database me-1" />
                        السيرفر المركزي
                      </span>
                    </span>
                  );
                }
              })()}
            </div>
            {device.server_name && !isAgentPending && (
              <div className="col-12 mb-2">
                <strong>الخادم:</strong>
                <span className={`badge ${device.is_central_server ? 'bg-primary' : 'bg-info'} me-2`}>
                  {device.server_name}
                </span>
                {device.server_role && (
                  <span className="badge bg-secondary">
                    {device.server_role === 'primary' ? 'رئيسي' : 'فرعي'}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="mt-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <span className="fw-bold">الحالة:</span>
              <span className={`badge bg-${device.status === 'connected' ? 'success' : device.status === 'discovered' ? 'info' : (device.status === 'pending' || device.is_blocked_device) ? 'warning' : 'secondary'}`}>
                {device.status === 'connected' ? 'متصل' : device.status === 'discovered' ? 'مكتشف' : (device.is_blocked_device || device.status === 'pending') ? 'pending' : device.status}
              </span>
            </div>

            {device.whitelisted && (
              <span className="badge bg-success me-1">قائمة بيضاء</span>
            )}
            {device.blacklisted && (
              <span className="badge bg-danger me-1">قائمة سوداء</span>
            )}
            {device.risk_level && (
              <span className={`badge bg-${device.risk_level === 'high' ? 'danger' : device.risk_level === 'medium' ? 'warning' : 'success'} me-1`}>
                خطورة: {device.risk_level}
              </span>
            )}
          </div>
        </div>
        <div className="card-footer">
          <div className="btn-group w-100" role="group">
            {(isDiscovered || isAgentPending || isBlockedDevice) ? (
              // أزرار خاصة بالأجهزة المكتشفة وأجهزة العملاء والمحظورة
              <>
                <button
                  className="btn btn-sm btn-success"
                  onClick={() => onApprove(device)}
                  disabled={isProcessing}
                >
                  <i className="fas fa-check me-1" />
                  {isProcessing ? 'جاري...' : 'موافقة'}
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => onDeny(device)}
                  disabled={isProcessing}
                >
                  <i className="fas fa-times me-1" /> رفض
                </button>
              </>
            ) : (
              // أزرار عادية للأجهزة الموجودة
              <>
                <button
                  className="btn btn-sm btn-outline-success"
                  onClick={() => onAddToWhitelist(device)}
                  disabled={device.whitelisted || isProcessing}
                >
                  <i className="fas fa-plus" />
                  {isProcessing ? 'جاري الإضافة...' : 'إضافة للقائمة البيضاء'}
                </button>
                <button
                  className="btn btn-sm btn-outline-danger"
                  onClick={() => onAddToBlacklist(device)}
                  disabled={device.blacklisted || isProcessing}
                >
                  <i className="fas fa-ban" />
                  {isProcessing ? 'جاري الإضافة...' : 'إضافة للقائمة السوداء'}
                </button>
                <button
                  className="btn btn-sm btn-outline-warning"
                  onClick={() => onEjectDevice(device)}
                >
                  <i className="fas fa-eject" /> إخراج
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // PropTypes for EnhancedDeviceCard
  EnhancedDeviceCard.propTypes = {
    device: PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      name: PropTypes.string,
      product: PropTypes.string,
      serial_number: PropTypes.string,
      manufacturer: PropTypes.string,
      device_type: PropTypes.string,
      device_class: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      usb_port: PropTypes.string,
      power_consumption: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      system: PropTypes.string,
      detected_at: PropTypes.string,
      status: PropTypes.string,
      is_real_device: PropTypes.bool,
      is_discovered: PropTypes.bool,
      detection_method: PropTypes.string,
      whitelisted: PropTypes.bool,
      blacklisted: PropTypes.bool,
      risk_level: PropTypes.string,
      server_name: PropTypes.string,
      server_role: PropTypes.string,
      is_central_server: PropTypes.bool,
      server_status: PropTypes.string,
      server_is_active: PropTypes.bool,
      is_agent_pending: PropTypes.bool,
      is_blocked_device: PropTypes.bool,
      agent_hostname: PropTypes.string,
      system_os: PropTypes.string,
      discovery_method: PropTypes.string,
      agent_pending_id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      server_id: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
    }).isRequired,
    onAddToWhitelist: PropTypes.func.isRequired,
    onAddToBlacklist: PropTypes.func.isRequired,
    onEjectDevice: PropTypes.func.isRequired,
    onApprove: PropTypes.func.isRequired,
    onDeny: PropTypes.func.isRequired
  };

  // إشعارات محسنة عند وصول الأجهزة مع رسائل عربية مفصلة ونظام صوتي
  const { subscribe: subscribeSocket, isConnected } = useSocket();

  // منظم لمنع المسح التلقائي المتكرر
  const autoScanRef = React.useRef(false);

  useEffect(() => {
    if (!isConnected) return;

    // إشعار الأجهزة المعلقة الجديدة
    const unsubscribePending = subscribeSocket('device:pending', (data) => {
      // عرض إشعار
      notifyDeviceConnection(data);
      // إضافة الجهاز المكتشف إلى قائمة الأجهزة المؤقتة ليظهر تلقائياً في واجهة "المعلقة"
      try {
        const dev = data.device || data;
        setDiscoveredDevices(prev => {
          const exists = prev.find(d => d.device && d.device.serial_number === (dev.serial_number || dev.id));
          if (!exists) {
            return [...prev, {
              device: dev,
              server_id: data.server_id || dev.server_id || 1,
              message: data.message || `تم اكتشاف جهاز معلق: ${dev.name || dev.product || dev.serial_number}`
            }];
          }
          return prev;
        });
      } catch (e) {
        // Failed to add pending device to discoveredDevices - continue silently
      }
    });

    // إشعار الأجهزة المكتشفة الجديدة
    const unsubscribeDiscovered = subscribeSocket('device:discovered', (data) => {
      // إضافة الجهاز المكتشف إلى القائمة المؤقتة
      setDiscoveredDevices(prev => {
        // تجنب التكرار
        const exists = prev.find(d => d.device.serial_number === data.device.serial_number);
        if (!exists) {
          return [...prev, data];
        }
        return prev;
      });

      // إظهار إشعار للمستخدم
      toast.info(
        <div>
          <i className="fas fa-search-plus me-2 text-info" />
          <b>تم اكتشاف جهاز جديد</b>
          <div className="mt-1">
            <div><strong>الاسم:</strong> {data.device.name || 'غير معروف'}</div>
            <div><strong>الرقم التسلسلي:</strong> {data.device.serial_number}</div>
            <div><strong>المنفذ:</strong> {data.device.usb_port}</div>
          </div>
        </div>,
        {
          autoClose: 8000,
          toastId: `discovered-${data.device.serial_number}`
        }
      );
    });

    // إشعار إعادة الاتصال
    const unsubscribeReconnected = subscribeSocket('device:reconnected', (data) => {
      notifyDeviceReconnection(data);
      fetchDevices();
    });

    // إشعار انقطاع الاتصال
    const unsubscribeDisconnected = subscribeSocket('device:disconnected', (data) => {
      notifyDeviceDisconnection(data);
      fetchDevices();
    });

    // إشعار عام للأجهزة (إضافي)
    const unsubscribeNotification = subscribeSocket('device:notification', (data) => {
      notifyGenericDevice(data);
    });

    // إشعارات الأمان والتنبيهات
    const unsubscribeAlert = subscribeSocket('new_alert', (alert) => {
      notifySecurityAlert(alert);
    });

    // إشعار حظر جهاز جديد
    const unsubscribeBlocked = subscribeSocket('device:blocked', (data) => {
      toast.error(
        <div>
          <i className="fas fa-ban me-2 text-danger" />
          <b>تم حظر جهاز</b>
          <div className="mt-1">
            <div><strong>الاسم:</strong> {data?.device_name || 'غير معروف'}</div>
            <div><strong>الرقم التسلسلي:</strong> {data?.serial_number || 'N/A'}</div>
          </div>
        </div>,
        { autoClose: 8000, toastId: `blocked-${data?.serial_number || Date.now()}` }
      );
      // تحديث قائمة الأجهزة
      fetchDevices();
    });

    return () => {
      unsubscribePending?.();
      unsubscribeDiscovered?.();
      unsubscribeReconnected?.();
      unsubscribeDisconnected?.();
      unsubscribeNotification?.();
      unsubscribeAlert?.();
      unsubscribeBlocked?.();
    };
  }, [subscribeSocket, isConnected, navigate, notifyDeviceConnection, notifyDeviceReconnection, notifyDeviceDisconnection, notifyGenericDevice, notifySecurityAlert, discoveredDevices.length, fetchDevices]);

  // تنفيذ المسح تلقائياً عند دخول صفحة الأجهزة المعلقة إذا لم تكن هناك أجهزة معلقة أو مكتشفة
  useEffect(() => {
    if (autoScanRef.current) return;
    // نفعل المسح التلقائي مرة واحدة فقط
    autoScanRef.current = true;

    // فقط نطلق المسح التلقائي إذا المستخدم يعرض قائمة "المعلقة"
    if (statusFilter !== 'pending') return;

    // عندما لا توجد أجهزة معلقة في الـ DB ولا توجد أجهزة مكتشفة محلياً، نفعل المسح
    const hasDbPending = (() => {
      if (!devices) return false;
      if (Array.isArray(devices)) return devices.some(d => d.status === 'pending');
      if (devices.devices && Array.isArray(devices.devices)) return devices.devices.some(d => d.status === 'pending');
      return false;
    })();

    if (!hasDbPending && discoveredDevices.length === 0) {
      // تأخير بسيط للسماح للصفحة بالظهور والاستجابة قبل بدء المسح
      setTimeout(() => {
        // استدعاء handleScan لبدء الفحص المحسن وادراج الأجهزة المضافة تلقائياً
        handleScan();
      }, 600);
    }
  }, [statusFilter, devices, discoveredDevices.length, handleScan]);

  return (
    <div className="devices-page">
      {/* Custom CSS for enhanced notifications */}
      <style>{`
        .device-notification {
          min-width: 350px;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        .device-notification .notification-header {
          display: flex;
          align-items: center;
          margin-bottom: 12px;
          font-weight: 600;
        }
        .device-notification .notification-body {
          line-height: 1.5;
        }
        .device-notification .device-details > div {
          margin-bottom: 6px;
          font-size: 0.9em;
        }
        .device-notification .notification-actions {
          border-top: 1px solid var(--mid);
          padding-top: 12px;
          margin-top: 12px;
        }
        .device-notification .arabic-message {
          background-color: var(--light);
          border-left: 3px solid var(--primary-color);
          font-size: 0.85em;
          color: #495057;
        }
        .device-connection-toast {
          border-left: 4px solid var(--warning-color) !important;
        }
        .device-reconnection-toast {
          border-left: 4px solid var(--success-color) !important;
        }
        .device-disconnection-toast {
          border-left: 4px solid #fd7e14 !important;
        }
        .security-alert-toast {
          border-left: 4px solid var(--danger-color) !important;
        }
        .generic-notification {
          border-left: 4px solid var(--primary-color) !important;
        }
      `}</style>

      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1>الأجهزة المتصلة</h1>
        <div className="btn-group">
          <Link to="/devices/add" className="btn btn-primary">
            <i className="fas fa-plus me-1" /> إضافة جهاز
          </Link>
          <button
            className="btn btn-secondary"
            onClick={handleScan}
            disabled={isScanning}
          >
            {isScanning
              ? 'جاري المسح…'
              : <><i className="fas fa-sync-alt me-1" /> مسح محسّن</>}
          </button>
        </div>
      </div>

      {/* عرض ملخص الأجهزة */}
      <DevicesSummaryCard summary={devicesSummary} />

      {/* Filters */}
      <div className="card mb-4 shadow-sm" style={{ borderRadius: '12px' }}>
        <div className="card-header bg-body-tertiary d-flex align-items-center gap-2 py-3" style={{ borderBottom: '1px solid var(--bs-border-color)' }}>
          <i className="fas fa-sliders-h text-primary" />
          <span className="fw-semibold text-body">فلاتر البحث</span>
        </div>
        <div className="card-body bg-body">
          {/* فلتر الحالة - أزرار Pill */}
          <div className="mb-3">
            <label className="form-label fw-semibold text-body-secondary mb-2" style={{ fontSize: '0.8rem' }}>
              <i className="fas fa-toggle-on me-1" /> الحالة
            </label>
            <div className="d-flex flex-wrap gap-2">
              {[
                { val: 'all', label: 'الكل', icon: 'fa-list', colorClass: 'secondary', activeClass: 'dark' },
                { val: 'connected', label: 'متصلة', icon: 'fa-check-circle', colorClass: 'success', activeClass: 'success' },
                { val: 'pending', label: 'معلقة', icon: 'fa-clock', colorClass: 'warning', activeClass: 'warning' },
                { val: 'disconnected', label: 'مفصولة', icon: 'fa-unlink', colorClass: 'secondary', activeClass: 'secondary' },
                { val: 'denied', label: 'مرفوضة', icon: 'fa-ban', colorClass: 'danger', activeClass: 'danger' },
              ].map(({ val, label, icon, colorClass, activeClass }) => {
                const isActive = statusFilter === val;
                return (
                  <button
                    key={val}
                    className={`btn btn-sm ${isActive ? `btn-${activeClass}` : `btn-outline-${colorClass}`}`}
                    style={{
                      borderRadius: '6px',
                      fontWeight: isActive ? 600 : 500,
                      padding: '5px 16px',
                      transition: 'all 0.2s ease',
                      boxShadow: isActive ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                    }}
                    onClick={() => setStatusFilter(val)}
                  >
                    <i className={`fas ${icon} me-2`} />{label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* نطاق البحث */}
          <div className="mb-3">
            <label className="form-label fw-semibold text-body-secondary mb-2" style={{ fontSize: '0.8rem' }}>
              <i className="fas fa-globe me-1" /> نطاق البحث
            </label>
            <div className="d-flex gap-2">
              {[
                { val: 'true', label: 'جميع الخوادم', icon: 'fa-network-wired' },
                { val: 'false', label: 'الخادم الحالي فقط', icon: 'fa-server' },
              ].map(({ val, label, icon }) => {
                const isActive = filters.all_servers === val;
                return (
                  <button
                    key={val}
                    className={`btn btn-sm ${isActive ? 'btn-dark' : 'btn-outline-secondary'}`}
                    style={{
                      borderRadius: '6px',
                      fontWeight: isActive ? 600 : 500,
                      padding: '5px 16px',
                      transition: 'all 0.2s ease',
                      boxShadow: isActive ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                    }}
                    onClick={() => handleFilterChange('all_servers', val)}
                  >
                    <i className={`fas ${icon} me-2`} />{label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* البحث النصي */}
          <div>
            <label className="form-label fw-semibold text-body-secondary mb-2" style={{ fontSize: '0.8rem' }}>
              <i className="fas fa-search me-1" /> بحث
            </label>
            <div className="input-group" style={{ borderRadius: '8px', overflow: 'hidden' }}>
              <span className="input-group-text bg-body-tertiary">
                <i className="fas fa-search text-body-secondary" />
              </span>
              <input
                type="text"
                className="form-control"
                placeholder="ابحث بالاسم، الرقم التسلسلي، الشركة..."
                value={filters.search}
                onChange={e => handleFilterChange('search', e.target.value)}
              />
              {filters.search && (
                <button className="btn btn-outline-secondary" onClick={() => handleFilterChange('search', '')}>
                  <i className="fas fa-times" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="alert alert-danger mb-4">
          <i className="fas fa-exclamation-triangle me-2" />
          حدث خطأ: {error}
        </div>
      )}

      {/* Loading */}
      {isLoading && !isScanning && (
        <div className="text-center py-5">
          <div className="spinner-border mb-3" />
          <p>جاري تحميل الأجهزة…</p>
        </div>
      )}

      {/* Empty state - removed per user request */}
      {/* الأجهزة المعلقة */}
      {statusFilter === 'pending' && (
        <div className="card mb-4">
          <div className="card-header bg-warning text-dark">
            <h5 className="mb-0">
              <i className="fas fa-clock me-2" />
              الأجهزة المعلقة بانتظار الموافقة
            </h5>
          </div>
          <div className="card-body">
            {pendingDevices.length === 0 ? (
              <div className="text-muted text-center py-3">
                <i className="fas fa-check-circle fa-2x mb-2" />
                <p>لا توجد أجهزة معلقة حالياً.</p>
              </div>
            ) : (
              <div className="row">
                {pendingDevices.map(device => (
                  <div key={device.id || device.serial_number} className="col-md-6 col-lg-4 mb-3">
                    <div className="card border-warning">
                      <div className="card-body">
                        <h5 className="card-title">{device.name || device.product || 'جهاز غير معروف'}</h5>
                        {device.is_blocked_device && (
                          <div className="mb-2">
                            <span className="badge bg-warning text-dark me-1">
                              <i className="fas fa-clock me-1" />
                              معلق - بانتظار الموافقة
                            </span>
                            <span className="badge bg-info">
                              مكتشف تلقائياً
                            </span>
                          </div>
                        )}
                        {device.is_agent_pending && (
                          <div className="mb-2">
                            <span className="badge bg-warning text-dark">
                              <i className="fas fa-desktop me-1" />
                              خادم فرعي
                            </span>
                          </div>
                        )}
                        <div className="mb-2"><b>الرقم التسلسلي:</b> {device.serial_number}</div>
                        {device.pnp_device_id && (
                          <div className="mb-2"><b>PnP ID:</b> <small className="text-muted">{device.pnp_device_id}</small></div>
                        )}
                        <div className="mb-2"><b>الخادم:</b> <span className="badge bg-secondary">{device.server_name || 'السيرفر المركزي'}</span></div>
                        <div className="mb-2"><b>الشركة:</b> {device.manufacturer}</div>
                        <div className="mb-2"><b>النوع:</b> {device.device_type || device.device_class || 'غير معروف'}</div>
                        <div className="mb-2"><b>المنفذ:</b> {device.usb_port}</div>
                        <div className="mb-2"><b>وقت الاكتشاف:</b> {(() => {
                          let dStr = device.connection_time || device.detected_at;
                          if (!dStr) return 'غير متاح';
                          if (dStr && !dStr.endsWith('Z') && !dStr.includes('+')) dStr += 'Z';
                          try {
                            return new Date(dStr).toLocaleString('ar-IQ');
                          } catch (e) {
                            return dStr;
                          }
                        })()}</div>
                        {device.is_real_device && (
                          <div className="mb-2">
                            <span className="badge bg-success">
                              <i className="fas fa-check me-1" />
                              جهاز حقيقي
                            </span>
                          </div>
                        )}
                        <div className="d-flex gap-2 mt-3">
                          <button
                            className="btn btn-success flex-fill"
                            onClick={() => handleApprove(device)}
                            disabled={processingDevices.has(device.serial_number)}
                          >
                            {processingDevices.has(device.serial_number) ? (
                              <><span className="spinner-border spinner-border-sm me-1" /> جاري...</>
                            ) : (
                              <><i className="fas fa-check me-1" /> موافقة</>
                            )}
                          </button>
                          <button
                            className="btn btn-danger flex-fill"
                            onClick={() => handleDeny(device)}
                            disabled={processingDevices.has(device.serial_number)}
                          >
                            <i className="fas fa-times me-1" />
                            رفض
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Device cards - استخدام المكون المحسّن */}
      {!isLoading && filteredDevices.length > 0 && (
        <>
          <div className="row">
            {filteredDevices.map(device => {
              // تحديد ما إذا كان الجهاز مكتشفاً حديثاً
              const isDiscovered = discoveredDevices.some(d =>
                (d.device && (d.device.serial_number === device.serial_number || d.device.id === device.id))
              );

              return (
                <div key={device.id || device.serial_number} className="col-md-6 col-lg-4 mb-4">
                  <EnhancedDeviceCard
                    device={device}
                    onAddToWhitelist={() => handleAddToWhitelist(device)}
                    onAddToBlacklist={() => handleAddToBlacklist(device)}
                    onEjectDevice={() => handleEjectDevice(device)}
                    onApprove={() => handleApprove(device)}
                    onDeny={() => handleDeny(device)}
                    is_discovered={isDiscovered}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}

      <ToastContainer rtl position="top-right" />
    </div>
  );
};

export default DeviceList;
