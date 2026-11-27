import React, { useState } from 'react';
import { Button, Card, Spinner, Container, Row, Col } from 'react-bootstrap';

function App() {
  // دوال مساعدة لتحويل البايت إلى جيجابايت
  const bytesToGB = (bytes) => {
    if (!bytes || bytes === 'جاري التحميل...') return 'جاري التحميل...';
    return Math.round(bytes / (1024 * 1024 * 1024));
  };

  // تحديد الواجهة الابتدائية - دائماً ابدأ بواجهة الترحيب
  const [currentView, setCurrentView] = useState('welcome');
  const [currentTab, setCurrentTab] = useState('connected');
  const [theme, setTheme] = useState('dark');
  const [status, setStatus] = useState('offline');

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('dir', 'rtl');
    document.documentElement.setAttribute('lang', 'ar');
  }, [theme]);

  const [systemInfo, setSystemInfo] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginMessage, setLoginMessage] = useState('');
  const [electronAvailable, setElectronAvailable] = useState(false);
  const [subServerConnected, setSubServerConnected] = useState(false);
  const [isCentralServer, setIsCentralServer] = useState(false);
  const [connectedCount, setConnectedCount] = useState(null);
  const [pendingCount, setPendingCount] = useState(null);
  const [dbTotalCount, setDbTotalCount] = useState(null);
  const [debugOutput, setDebugOutput] = useState(null);
  const [discoveredDevicesList, setDiscoveredDevicesList] = useState([]);
  const [approvedConnectedDevices, setApprovedConnectedDevices] = useState([]);
  const [approvedDisconnectedDevices, setApprovedDisconnectedDevices] = useState
([]);
  const [expandedDeviceKeys, setExpandedDeviceKeys] = useState(new Set());


  const handleSaveToSupabase = async () => {
    if (!electronAvailable || !window.electronAPI) {
      setLoginMessage('إشعار النظام');
      return;
    }

    if (!email || !password) {
      setLoginMessage('إشعار النظام');
      return;
    }

    try {
      setLoginMessage('إشعار النظام');

      const result = await window.electronAPI.saveAgentDataToSupabase({
        timestamp: new Date().toISOString(),
        manual_save: true,
        user_email: email,
        agent_id: `agent_${email}_${Date.now()}`,
        system_info: systemInfo,
        connection_status: status,
        server_connection_status: status,
        server_type: 'main'
      });

      if (result && result.success) {
        setLoginMessage('إشعار النظام');
        console.log('تم حفظ البيانات بنجاح:', result);
      } else {
        const errorMsg = result?.message || 'حدث خطأ أثناء الاتصال';
        setLoginMessage(`❌ ${errorMsg}`);
        console.error('خطأ في حفظ البيانات:', result);
      }
    } catch (e) {
      setLoginMessage(`❌ خطأ في حفظ البيانات: ${e.message}`);
      console.error('خطأ في حفظ البيانات:', e);
    }
  };

  const handleTestSupabaseConnection = async () => {
    if (!electronAvailable || !window.electronAPI) {
      setLoginMessage('إشعار النظام');
      return;
    }

    try {
      setLoginMessage('إشعار النظام');

      const result = await window.electronAPI.testSupabaseConnection();

      if (result && result.success) {
        setLoginMessage('إشعار النظام');
        console.log('تم اختبار الاتصال بقاعدة البيانات بنجاح:', result);
      } else {
        const errorMsg = result?.error || 'حدث خطأ في الاتصال مع قاعدة البيانات';
        setLoginMessage(`❌ ${errorMsg}`);
        console.error('خطأ في اختبار الاتصال:', result);
      }
    } catch (e) {
      setLoginMessage(`❌ خطأ في اختبار الاتصال: ${e.message}`);
      console.error('خطأ في اختبار الاتصال:', e);
    }
  };

  const handleConnect = async () => {

    if (!electronAvailable || !window.electronAPI) {
      setLoginMessage('إشعار النظام');
      return;
    }

    if (!email || !password) {
      setLoginMessage('إشعار النظام');
      return;
    }

    setConnecting(true);
    setLoginMessage('إشعار النظام');

    try {
      const serverCheck = await window.electronAPI.checkServerMode({
        username: email.trim(),
        password: password.trim(),
      });

      console.log('نتائج فحص وضع السيرفر:', serverCheck);

      if (serverCheck.isServer && serverCheck.serverType === 'primary') {
        setStatus('online');
        setIsCentralServer(true);
        setLoginMessage('إشعار النظام');
        setCurrentView('dashboard');
        setConnecting(false);
        return;
      }

      if (serverCheck.success && serverCheck.serverType === 'secondary') {
        setStatus('online');
        setIsCentralServer(false);
        setSubServerConnected(true);
        const username = serverCheck.user ? serverCheck.user.username : email;
        setLoginMessage(`✅ تم ربط السيرفر بحسابك (${username}) بنجاح!`);
        setCurrentView('dashboard');
        setConnecting(false);
        return;
      }

      if (serverCheck.error) {
        setLoginMessage(`❌ ${serverCheck.error}`);
        setConnecting(false);
        return;
      }

      // إذا لم يكن هناك ربط تلقائي، عرض رسالة عامة
      setLoginMessage('إشعار النظام');
      setConnecting(false);

    } catch (checkError) {
      console.error('خطأ في فحص وضع السيرفر:', checkError);
      setLoginMessage(`❌ خطأ في ربط السيرفر: ${checkError.message}`);
      setConnecting(false);
      return;
    }
  };

  const handleAutoConnectToSubServer = async () => {
    if (!electronAvailable || !window.electronAPI) {
      console.log('Electron API غير متاح للاتصال بالسيرفر الفرعي');
      return;
    }

    try {
      console.log('جاري محاولة الاتصال بالسيرفر الفرعي تلقائياً...');
      
      const result = await window.electronAPI.connectToServer({
        email: 'auto-connect@subserver.local',
        password: 'auto-password',
        serverType: 'sub'
      });

      if (result && result.success) {
        setSubServerConnected(true);
        setStatus('online');
        setLoginMessage('إشعار النظام');
        console.log('تم الاتصال بالسيرفر الفرعي بنجاح');

        // تحديث معلومات النظام
        if (window.electronAPI.getSystemInfo) {
          const updatedSystemInfo = await window.electronAPI.getSystemInfo();
          setSystemInfo(updatedSystemInfo);
        }
      } else {
        console.log('فشل الاتصال بالسيرفر الفرعي، سيتم إعادة المحاولة...');
        // إعادة المحاولة بعد 30 ثانية
        setTimeout(handleAutoConnectToSubServer, 30000);
      }
    } catch (error) {
      console.log('خطأ في الاتصال بالسيرفر الفرعي:', error);
      // إعادة المحاولة بعد 30 ثانية
      setTimeout(handleAutoConnectToSubServer, 30000);
    }
  };

  React.useEffect(() => {
    const checkElectronAPI = () => {
      const available = !!(window.electronAPI);
      setElectronAvailable(available);
      console.log('Electron API available:', available);
      console.log('window.electronAPI:', window.electronAPI);
      console.log('Current view:', currentView);

      // تحديث معلومات النظام عند توفر electronAPI
      if (available && window.electronAPI?.getSystemInfo) {
        window.electronAPI.getSystemInfo()
          .then(initialInfo => {
            setSystemInfo(initialInfo);
            console.log('تم تحديث معلومات النظام الأولية:', initialInfo);
            console.log('IP from initial load:', initialInfo?.ip);
            
            if (window.electronAPI?.checkServerMode) {
              window.electronAPI.checkServerMode()
                .then(serverCheck => {
                  console.log('نتائج فحص وضع السيرفر عند التحميل:', serverCheck);
                  
                  if (serverCheck.isServer && serverCheck.serverType === 'primary') {
                    setStatus('online');
                    setIsCentralServer(true);
                    setSubServerConnected(false);
                    setLoginMessage('إشعار النظام');
                    setCurrentView('dashboard');
                  } else if (!serverCheck.isServer && serverCheck.serverType ===
 'secondary') {
                    setStatus('online');
                    setIsCentralServer(false);
                    setSubServerConnected(true);
                    const username = serverCheck.user ? serverCheck.user.username : 'مستخدم مجهول';
                    setLoginMessage(`✅ جهاز مُسجل كسيرفر فرعي لحساب ${username}`);
                    setCurrentView('dashboard');
                  }
                })
                .catch(err => console.log('إشعار النظام', err));
            }
          })
          .catch(err => console.log('إشعار النظام', err));
      }

      if (available) {
        setTimeout(() => {
          handleAutoConnectToSubServer();
        }, 2000);
      }

      return available;
    };

    setTimeout(checkElectronAPI, 100);
  }, []);

  // تحديث معلومات النظام عند تسجيل الدخول
  React.useEffect(() => {
    if (email && password && electronAvailable && window.electronAPI?.getSystemInfo) {
      // تحديث معلومات النظام عند تسجيل الدخول
      window.electronAPI.getSystemInfo()
        .then(updatedInfo => {
          setSystemInfo(updatedInfo);
          console.log('تم تحديث معلومات النظام:', updatedInfo);
        })
        .catch(err => console.log('إشعار النظام', err));
    }
  }, [email, password, electronAvailable]);

  React.useEffect(() => {
    // Start discovery as soon as the Electron API is ready so local counts are available even
    // if the app is not registered with the central server yet.
    if (electronAvailable && window.electronAPI?.startDeviceDiscovery) {
      console.log('Starting background device discovery (electronAvailable)...')
;
      window.electronAPI.startDeviceDiscovery()
        .then(result => {
          if (result.success) {
            console.log('Background device discovery started successfully');
          }
        })
        .catch(error => console.error('Error starting background device discovery:', error));
    }
  }, [status, electronAvailable]);

  // Initialize and listen for device counts (connected / pending)
  React.useEffect(() => {
    if (!electronAvailable || !window.electronAPI) return;

    // helper to normalize usb list response
    const normalizeUsbTotal = (res) => {
      if (!res) return 0;
      if (Array.isArray(res)) return res.length;
      return res.total ?? (res.devices ? res.devices.length : 0) ?? 0;
    };

    // Fetch initial counts via combined device-counts endpoint
    try {
      window.electronAPI.getDeviceCounts()
        .then(res => {
          if (res && res.success) {
            // connected devices are read from DB status='connected'
            setConnectedCount(res.dbConnectedCount ?? 0);
            setPendingCount(res.pendingCount ?? 0);
            setDbTotalCount(res.dbTotal ?? 0);
          } else {
            setConnectedCount(0);
            setPendingCount(0);
            setDbTotalCount(0);
          }
        })
        .catch(() => {
          setConnectedCount(0);
          setPendingCount(0);
          setDbTotalCount(0);
        });
    } catch (e) {
      setConnectedCount(0);
      setPendingCount(0);
      setDbTotalCount(0);
    }

    // Event handlers for updates coming from main process
    const onDeviceUpdate = (event, payload) => {
      try {
        if (!payload || !payload.action) return;
        if (payload.action === 'approve') {
          // Connected count update from DB real-time
          setPendingCount(prev => Math.max(0, (prev || 0) - 1));
        } else if (payload.action === 'deny') {
          // Deny removes device from pending list
          setPendingCount(prev => Math.max(0, (prev || 0) - 1));
        }
      } catch (e) {
        console.warn('Error handling device-update in renderer:', e);
      }
    };

    const onDevicesDetected = (event, payload) => {
      try {
        if (payload?.total !== undefined) {
          setPendingCount(payload.total);
        }
      } catch (e) {
        console.warn('Error handling devices-detected in renderer:', e);
      }
    };

    const onDiscoveredChanged = (event, payload) => {
      try {
        const total = payload?.total ?? (payload?.devices ? payload.devices.length : 0) ?? 0;
        setPendingCount(total);
      } catch (e) {
        console.warn('Error handling discovered-devices-changed in renderer:', e);
      }
    };

    const onDBConnectedCountUpdated = (event, payload) => {
      try {
        console.log('? DB connected count updated:', payload);
        if (payload?.count !== undefined) {
          setConnectedCount(payload.count);
        }
      } catch (e) {
        console.warn('Error handling db-connected-count-updated in renderer:', e);
      }
    };

    // Subscribe to various events
    window.electronAPI.onDeviceUpdate(onDeviceUpdate);
    window.electronAPI.onDevicesDetected && window.electronAPI.onDevicesDetected(onDevicesDetected);
    window.electronAPI.onDiscoveredDevicesChanged && window.electronAPI.onDiscoveredDevicesChanged(onDiscoveredChanged);
    
    window.electronAPI.onDBConnectedCountUpdated && window.electronAPI.onDBConnectedCountUpdated(onDBConnectedCountUpdated);

    const onDiscoveredDevicesList = (event, payload) => {
      try {
        console.log('? Received discovered devices:', payload);
        if (payload?.devices) {
          setDiscoveredDevicesList(prev => {
            const newDevices = payload.devices.filter(newDev => 
              !prev.some(existingDev => existingDev.serial_number === newDev.serial_number)
            );
          });
        }
      } catch (e) {
        console.warn('Error handling discovered-devices-list:', e);
      }
    };

    // تحديث معلومات النظام دورياً (كل 5 ثواني - تحديث تلقائي)
    const onDevicesDiscovered = (event, payload) => {
      try {
        console.log('تم اكتشاف أجهزة (لم يتم حفظها في قاعدة البيانات):', payload);

        // Normalize payload into array (if present) and optional total
        const totalFromPayload = payload && typeof payload.total === 'number' ? 
payload.total : undefined;
        let devicesArr = [];
        if (Array.isArray(payload)) {
          devicesArr = payload;
        } else if (payload && Array.isArray(payload.devices)) {
          devicesArr = payload.devices;
        }

        // Always update the discovered devices list for display
        if (devicesArr.length > 0) {
          setDiscoveredDevicesList(prev => {
            const newDevices = devicesArr.filter(newDev => 
              !prev.some(existingDev => (existingDev.serial_number || existingDev.serial) === (newDev.serial_number || newDev.serial))
            );
            return [...newDevices, ...prev].slice(0, 50);
          });
        }

        // Update pending count: prefer explicit total from main process, otherwise increment
        if (typeof totalFromPayload === 'number') {
          setPendingCount(totalFromPayload);
        } else if (devicesArr.length > 0) {
          setPendingCount(prev => (prev || 0) + devicesArr.length);
        }
      } catch (e) {
        console.warn('Error handling devices-discovered:', e);
      }
    };

    window.electronAPI.onDiscoveredDevicesList && window.electronAPI.onDiscoveredDevicesList(onDiscoveredDevicesList);
    window.electronAPI.onDevicesDiscovered && window.electronAPI.onDevicesDiscovered(onDevicesDiscovered);
    window.electronAPI.onApprovedConnectedDevices && window.electronAPI.onApprovedConnectedDevices((event, devices) => {
      try {
        const arr = Array.isArray(devices) ? devices : [];
        console.log('Received approved-connected-devices:', arr);
        setApprovedConnectedDevices(arr);
        // Keep the connected count in sync with the approved+physically-connected set
        setConnectedCount(arr.length);
      } catch (e) { console.warn('Error handling approved-connected-devices', e); }
    });
    window.electronAPI.onApprovedDisconnectedDevices && window.electronAPI.onApprovedDisconnectedDevices((event, devices) => {
      try {
        const arr = Array.isArray(devices) ? devices : [];
        console.log('Received approved-disconnected-devices:', arr);
        setApprovedDisconnectedDevices(arr);
      } catch (e) { console.warn('Error handling approved-disconnected-devices', e); }
    });

    const onDevicesSentToServer = (event, payload) => {
      try {
        console.log('? Devices sent to server result:', payload);
        if (payload?.success) {
          console.log(`? ${payload.count} devices sent to central server success
fully`);
        } else {
          console.warn('فشل إرسال الأجهزة إلى السيرفر المركزي:', payload?.message);
        }
      } catch (e) {
        console.warn('Error handling devices-sent-to-server:', e);
      }
    };

    window.electronAPI.onDevicesSentToServer && window.electronAPI.onDevicesSentToServer(onDevicesSentToServer);

    const onDeviceApproved = (event, payload) => {
      try {
        console.log('? Device approved by central server:', payload);
        if (payload?.device) {
          const approvedDevice = payload.device;
          
          setDiscoveredDevicesList(prev => 
              prev.filter(d => (d.serial_number || d.serial) !== (approvedDevice.serial_number || approvedDevice.serial))
          );
          
          setApprovedConnectedDevices(prev => [...prev, approvedDevice]);
          
          setPendingCount(prev => Math.max(0, (prev || 0) - 1));
          setConnectedCount(prev => (prev || 0) + 1);
          
          setLoginMessage('إشعار النظام');
        }
      } catch (e) {
        console.warn('Error handling device-approved:', e);
      }
    };

    const onDeviceRejected = (event, payload) => {
      try {
        console.log('تم رفض الجهاز من قبل السيرفر المركزي:', payload);
        if (payload?.device) {
          const rejectedDevice = payload.device;
          
          setDiscoveredDevicesList(prev => 
              prev.filter(d => (d.serial_number || d.serial) !== (rejectedDevice.serial_number || rejectedDevice.serial))
          );
          
          setPendingCount(prev => Math.max(0, (prev || 0) - 1));
          
          setLoginMessage('إشعار النظام');
        }
      } catch (e) {
        console.warn('Error handling device-rejected:', e);
      }
    };

    const onPendingDeviceRemoved = (event, payload) => {
      try {
        console.log('تم إزالة الجهاز المعلق:', payload);
        // تحديث البيانات من قاعدة البيانات مباشرة باستخدام الدالة الجديدة
        if (window.electronAPI?.getPendingDevicesFromDB) {
          window.electronAPI.getPendingDevicesFromDB()
            .then(res => {
              if (res && res.success) {
                setDiscoveredDevicesList(res.devices || []);
                setPendingCount(res.total || 0);
              }
            })
            .catch(err => console.log('خطأ في تحميل الأجهزة المعلقة:', err));
        }
      } catch (e) {
        console.warn('Error handling pending-device-removed:', e);
      }
    };

    window.electronAPI.onDeviceApproved && window.electronAPI.onDeviceApproved(onDeviceApproved);
    window.electronAPI.onDeviceRejected && window.electronAPI.onDeviceRejected(onDeviceRejected);
    window.electronAPI.onPendingDeviceRemoved && window.electronAPI.onPendingDeviceRemoved(onPendingDeviceRemoved);

    // Cleanup
    return () => {
      try {
        window.electronAPI.removeAllListeners && window.electronAPI.removeAllListeners('device-update');
        window.electronAPI.removeAllListeners && window.electronAPI.removeAllListeners('usb-device-changed');
        window.electronAPI.removeAllListeners && window.electronAPI.removeAllListeners('discovered-devices-changed');
        window.electronAPI.removeAllListeners && window.electronAPI.removeAllListeners('discovered-devices-list');
        window.electronAPI.removeAllListeners && window.electronAPI.removeAllListeners('devices-discovered');
        window.electronAPI.removeAllListeners && window.electronAPI.removeAllListeners('db-connected-count-updated');
        window.electronAPI.removeAllListeners && window.electronAPI.removeAllListeners('approved-connected-devices');
        window.electronAPI.removeAllListeners && window.electronAPI.removeAllListeners('approved-disconnected-devices');
        window.electronAPI.removeAllListeners && window.electronAPI.removeAllListeners('devices-sent-to-server');
        window.electronAPI.removeAllListeners && window.electronAPI.removeAllListeners('device-approved');
        window.electronAPI.removeAllListeners && window.electronAPI.removeAllListeners('device-rejected');
        window.electronAPI.removeAllListeners && window.electronAPI.removeAllListeners('pending-device-removed');
      } catch (e) {
        // ignore
      }
    };
  }, [electronAvailable]);

  React.useEffect(() => {
    if (electronAvailable && window.electronAPI?.getSystemInfo) {
      const interval = setInterval(() => {
        window.electronAPI.getSystemInfo()
          .then(updatedInfo => {
            setSystemInfo(updatedInfo);
            // console.log('Auto refresh - IP:', updatedInfo?.ip);
          })
          .catch(err => console.log('خطأ في العملية:', err));
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [electronAvailable]);

  // تحميل الأجهزة المعلقة عند فتح التبويب
  React.useEffect(() => {
    if (electronAvailable && currentTab === 'pending' && window.electronAPI?.getPendingDevicesFromDB) {
      window.electronAPI.getPendingDevicesFromDB()
        .then(res => {
          if (res && res.success) {
            setDiscoveredDevicesList(res.devices || []);
            setPendingCount(res.total || 0);
          }
        })
        .catch(err => console.log('خطأ في تحميل الأجهزة المعلقة:', err));
    }
  }, [currentTab, electronAvailable]);

  // تحديث دوري للبيانات من قاعدة البيانات كل 5 ثواني
  React.useEffect(() => {
    if (electronAvailable && currentTab === 'pending' && window.electronAPI?.getPendingDevicesFromDB) {
      const interval = setInterval(() => {
        window.electronAPI.getPendingDevicesFromDB()
          .then(res => {
            if (res && res.success) {
              setDiscoveredDevicesList(res.devices || []);
              setPendingCount(res.total || 0);
            }
          })
          .catch(err => console.log('خطأ في تحميل الأجهزة المعلقة:', err));
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [currentTab, electronAvailable]);

  // الانتقال للواجهة الرئيسية
  const handleStart = () => {
    setCurrentView('main');
  };

  const handleRefreshSystemInfo = async () => {
    if (electronAvailable && window.electronAPI?.getSystemInfo) {
      try {
        const updatedInfo = await window.electronAPI.getSystemInfo();
        setSystemInfo(updatedInfo);
        console.log('تم تحديث معلومات النظام يدوياً:', updatedInfo);
        console.log('Manual refresh - IP:', updatedInfo?.ip);
      } catch (err) {
        console.log('خطأ في تحديث معلومات النظام:', err);
      }
    }
  };

  return (
    <div className="app-container" data-theme="dark">
      {/* Custom Title Bar for Dragging */}
      <div style={{ WebkitAppRegion: 'drag', position: 'absolute', top: 0, left: 0, right: 0, height: '30px', zIndex: 9999 }}></div>

      {currentView === 'welcome' ? (
        <div id="splash-screen" className="fullscreen-overlay active-overlay">
          <div className="splash-content">
            <div className="logo-shield large-shield"></div>
            <h1>Smart Zero-Trust Security</h1>
            <p>نظام مراقبة وحماية منافذ USB المتقدم</p>
            <button id="startBtn" className="btn btn-primary large-btn" onClick={handleStart}>
              ابدأ النظام (Start)
            </button>
            <div className="mt-4" style={{ marginTop: '20px' }}>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                <strong>Developed by<br/>Hasan Ali Hasan Saleh<br/>Alpha Team - Development Department</strong>
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Header */}
          <header className="header" style={{ position: 'relative', zIndex: 1000 }}>
            <div className="header-logo">
              <div className="logo-shield"></div>
              <div className="header-titles">
                <h1>Smart Zero-Trust Security</h1>
                <h2>نظام إدارة USB - العميل</h2>
              </div>
            </div>
            <div className="header-controls" style={{ display: 'flex', alignItems: 'center' }}>
              <span className={`badge ${status === 'online' ? 'badge-allowed' : 'badge-blocked'}`} style={{ marginRight: '15px' }}>
                {status === 'online' ? (subServerConnected ? 'سيرفر فرعي' : 'متصل') : 'غير متصل'}
              </span>
              <button onClick={() => setCurrentView('welcome')} className="btn btn-primary" style={{ marginRight: '10px' }}>عودة للترحيب</button>
                <button style={{ WebkitAppRegion: 'no-drag' }} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="btn-icon" title="تبديل المظهر">
                  {theme === 'dark' ? (
                    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                  )}
                </button>
                <button style={{ WebkitAppRegion: 'no-drag' }} onClick={() => window.electronAPI?.minimizeWindow && window.electronAPI.minimizeWindow()} className="btn-icon" title="تصغير">
                  <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
                <button style={{ WebkitAppRegion: 'no-drag' }} onClick={() => window.electronAPI?.toggleMaximizeWindow && window.electronAPI.toggleMaximizeWindow()} className="btn-icon" title="تكبير/استعادة">
                  <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
              </button>
              <button style={{ WebkitAppRegion: 'no-drag' }} onClick={() => window.electronAPI?.closeWindow && window.electronAPI.closeWindow()} className="btn-icon" title="إغلاق">
                <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
          </header>

          {/* Login Overlay if not connected */}
          {status !== 'online' && (
             <div id="login-screen" className="fullscreen-overlay active-overlay" style={{ top: '65px', background: 'var(--bg-base)' }}>
                <div className="login-box">
                    <div className="logo-shield medium-shield" style={{ margin: '0 auto 20px' }}></div>
                    <h2>تسجيل الدخول للنظام</h2>
                    <p>يرجى إدخال البريد الإلكتروني وكلمة المرور للربط بالسيرفر المركزي</p>
                    <div className="login-form">
                        <input 
                          type="text" 
                          placeholder="البريد الإلكتروني" 
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required 
                        />
                        <input 
                          type="password" 
                          placeholder="كلمة المرور" 
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required 
                        />
                        <button 
                          id="loginSubmitBtn" 
                          className="btn btn-primary full-width"
                          onClick={handleConnect}
                          disabled={connecting || !email || !password}
                        >
                          {connecting ? 'جاري الاتصال...' : 'تسجيل الدخول'}
                        </button>
                        {loginMessage && (
                          <p id="loginErrorMsg" className="error-msg" style={{ color: loginMessage.includes('❌') ? 'var(--status-blocked)' : 'var(--status-safe)' }}>
                            {loginMessage}
                          </p>
                        )}
                    </div>
                </div>
             </div>
          )}

          {/* Main Layout if connected */}
          {status === 'online' && (
            <main className="main-content">
              {/* Sidebar */}
              <aside className="sidebar">
          <div className="header-logo" style={{ justifyContent: "center", marginBottom: "40px", marginTop: "20px" }}>
            <div className="logo-shield large-shield" style={{ width: "60px", height: "72px" }}></div>
          </div>
          
          <nav className="side-nav">
            <a href="#" className={`nav-item ${currentTab === "connected" ? "active" : ""}`} onClick={(e) => { e.preventDefault(); setCurrentTab("connected"); }}>الأجهزة المتصلة ({connectedCount ?? 0})</a>
            <a href="#" className={`nav-item ${currentTab === "pending" ? "active" : ""}`} onClick={(e) => { e.preventDefault(); setCurrentTab("pending"); }}>الأجهزة المعلقة ({pendingCount ?? 0})</a>
            <a href="#" className={`nav-item ${currentTab === "settings" ? "active" : ""}`}  onClick={(e) => { e.preventDefault(); setCurrentTab("settings"); }}>الإعدادات وحالة النظام</a>
          </nav>
        </aside>

              {/* Dashboard Content */}
              <section id="devices-section" className="dashboard active-section">
                
                {loginMessage && (
                  <div style={{ backgroundColor: loginMessage.includes('❌') ? 'rgba(239, 68, 68, 0.1)' : 'rgba(212, 175, 55, 0.1)', padding: '15px', borderRadius: '8px', marginBottom: '20px', color: loginMessage.includes('❌') ? 'var(--status-blocked)' : 'var(--accent-gold)', border: loginMessage.includes('❌') ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(212, 175, 55, 0.2)' }}>
                    {loginMessage}
                  </div>
                )}

                {currentTab === 'connected' && (
                  <React.Fragment>
                <div className="dashboard-header d-flex justify-content-between align-items-center" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                  <div>
                    <h2>الأجهزة المتصلة الحالية</h2>
                    <p>قائمة بمنافذ الـ USB المعتمدة والموصولة بالخادم.</p>
                  </div>
                  <button className="btn btn-primary" onClick={async () => {
                    if (window.electronAPI?.getSystemInfo) { setSystemInfo(await window.electronAPI.getSystemInfo()); }
                    if (window.electronAPI?.runOnceDiscovery) { await window.electronAPI.runOnceDiscovery(); }
                  }}>تحديث الإحصائيات</button>
                </div>

                <div className="table-container mb-4" style={{ marginBottom: '40px' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'center' }}>معرف الجهاز (VID:PID)</th>
                        <th style={{ textAlign: 'center' }}>اسم الجهاز</th>
                        <th style={{ textAlign: 'center' }}>الرقم التسلسلي</th>
                        <th style={{ textAlign: 'center' }}>الفئة (Class)</th>
                        <th style={{ textAlign: 'center' }}>الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvedConnectedDevices && approvedConnectedDevices.length > 0 ? (
                        approvedConnectedDevices.map((device, idx) => (
                           <tr key={idx}>
                             <td dir="ltr" style={{ textAlign: 'center' }}>{device.vendor_id || '----'}:{device.product_id || '----'}</td>
                             <td style={{ textAlign: 'center' }}>{device.name || device.device_name || 'غير معروف'}</td>
                             <td dir="ltr" style={{ textAlign: 'center', fontFamily: 'monospace' }}>{device.serial_number || device.serial || '-'}</td>
                             <td dir="ltr" style={{ textAlign: 'center' }}>{device.device_class || device.class || '-'}</td>
                             <td style={{ textAlign: 'center' }}><span className="badge badge-allowed">مسموح</span></td>
                           </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary)' }}>
                            لا توجد أجهزة USB معتمدة متصلة حالياً.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                  </React.Fragment>
                )}
                {currentTab === 'pending' && (
                  <React.Fragment>
                <div className="dashboard-header mt-4 d-flex justify-content-between align-items-center" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                  <div>
                    <h2>الأجهزة المعلقة (غير معتمدة)</h2>
                    <p>قائمة بالأجهزة المكتشفة التي تنتظر موافقة من السيرفر المركزي.</p>
                  </div>
                  <button className="btn btn-primary" onClick={async () => {
                    if (window.electronAPI?.getDiscoveredDevices) {
                      const res = await window.electronAPI.getDiscoveredDevices();
                      if (res && res.success) {
                        setDiscoveredDevicesList(res.pending || []);
                        setPendingCount(res.pendingTotal || 0);
                      }
                    }
                  }}>تحديث القائمة</button>
                </div>

                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'center' }}>معرف الجهاز (VID:PID)</th>
                        <th style={{ textAlign: 'center' }}>اسم الجهاز</th>
                        <th style={{ textAlign: 'center' }}>الرقم التسلسلي</th>
                        <th style={{ textAlign: 'center' }}>الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discoveredDevicesList && discoveredDevicesList.length > 0 ? (
                         discoveredDevicesList.map((device, idx) => (
                            <tr key={`${device.serial_number || device.serial || device.device_id || idx}-${device.vendor_id || ''}-${device.product_id || ''}`}>
                               <td dir="ltr" style={{ textAlign: 'center' }}>{device.vendor_id || '----'}:{device.product_id || '----'}</td>
                               <td style={{ textAlign: 'center' }}>{device.name || device.device_name || 'غير معروف'}</td>
                               <td dir="ltr" style={{ textAlign: 'center', fontFamily: 'monospace' }}>{device.serial_number || device.serial || '-'}</td>
                               <td style={{ textAlign: 'center' }}><span className="badge badge-blocked">معلق (بانتظار الموافقة)</span></td>
                            </tr>
                         ))
                      ) : (
                        <tr>
                          <td colSpan="4" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary)' }}>
                            لا توجد أجهزة معلقة.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                  </React.Fragment>
                )}
                {/* Settings Section directly in dashboard inside bottom status */}
                {currentTab === "settings" && (
                  <React.Fragment>
                  <div className="dashboard-header" style={{ marginBottom: "30px" }}>
                    <h2>الإعدادات وحالة النظام</h2>
                    <p>مراقبة حالة الخدمات الأساسية ومعلومات النظام للجهاز الحالي.</p>
                  </div>

                  <div className="settings-grid">
                    <div className="glass-card">
                      <h3>حالة العميل (Agent)</h3>
                      <div className="value">يعمل بنجاح</div>
                      <span className="badge badge-allowed badge-inline">قيد العمل</span>
                    </div>
                    <div className="glass-card">
                      <h3>حالة السيرفر المركزي</h3>
                      <div className="value">{isCentralServer ? "سيرفر مركزي" : (subServerConnected ? "سيرفر فرعي" : "غير متصل")}</div>
                      <span className={`badge badge-inline ${isCentralServer || subServerConnected ? "badge-allowed" : "badge-blocked"}`}>{isCentralServer || subServerConnected ? "متصل" : "مفصول"}</span>
                    </div>
                    <div className="glass-card">
                      <h3>حالة قاعدة البيانات</h3>
                      <div className="value">تعمل بدون مشاكل</div>
                      <span className="badge badge-allowed badge-inline">متصل</span>
                    </div>
                  </div>

                  <div className="dashboard-header mt-4" style={{ marginBottom: "20px", marginTop: "40px" }}>
                    <h2>معلومات النظام الأساسية</h2>
                  </div>

                  <div className="settings-grid">
                    <div className="glass-card">
                      <h3>اسم الجهاز (Hostname)</h3>
                      <div className="value">{systemInfo?.hostname || "جاري التحميل..."}</div>
                    </div>
                    <div className="glass-card">
                      <h3>عنوان الـ IP</h3>
                      <div className="value" style={{ fontFamily: "monospace" }}>{systemInfo?.ip || "127.0.0.1"}</div>
                    </div>
                    <div className="glass-card" style={{ justifyContent: "center", alignItems: "center" }}>
                      <button className="btn btn-primary" style={{ width: "100%", padding: "12px" }} onClick={handleRefreshSystemInfo}>تحديث معلومات النظام</button>
                    </div>
                  </div>
                  </React.Fragment>
                )}</section>
            </main>
          )}
        </>
      )}
    </div>
  );
}

export default App;
