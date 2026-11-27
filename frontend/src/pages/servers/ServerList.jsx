import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import useServer from '../../hooks/useServer';
import useSocket from '../../hooks/useSocket';
import { formatDateTime } from '../../utils/formatters';
import StatusBadge from '../../components/StatusBadge';
import { serverSync } from '../../utils/api';
import { toast } from 'react-toastify';
import ServerCard from '../../components/ServerCard';

const ServerListComponent = () => {
  const navigate = useNavigate();
  const { servers, isLoading, error, fetchServers } = useServer();
  const [search, setSearch] = useState('');
  const [syncResult, setSyncResult] = useState(null);
  const [apiKeyModal, setApiKeyModal] = useState({ show: false, key: '' });
  const [syncingId, setSyncingId] = useState(null);
  const [heartbeatMsg, setHeartbeatMsg] = useState('');
  const [lastSync, setLastSync] = useState(null);

  // CMD Terminal Modal State
  const [cmdModal, setCmdModal] = useState({
    show: false,
    minimized: false, // حالة جديدة للتصغير
    maximized: false,
    command: '',
    output: '',
    history: [],
    commandHistory: [],
    historyIndex: -1,
    currentPath: 'C:\\Users',
    isExecuting: false,
    // إضافة خصائص السحب والتحريك وتغيير الحجم
    position: { x: 100, y: 50 },
    size: { width: 800, height: 500 },
    isDragging: false,
    isResizing: false,
    dragOffset: { x: 0, y: 0 },
    resizeDirection: null
  });

  // Map server status to StatusBadge status
  const mapServerStatusToBadgeStatus = (serverStatus, isOnline) => {
    // First check if the server is explicitly marked as online
    if (isOnline === true) {
      return 'connected';
    }
    
    // Then check the server status value
    switch (serverStatus) {
      case 'active':
      case 'online':
        return 'connected';
      case 'inactive':
      case 'offline':
        return 'disconnected';
      case 'blocked':
        return 'blocked';
      case 'disabled':
        return 'disabled';
      default:
        // If we don't recognize the status, default to disconnected
        return 'disconnected';
    }
  };

  // جلب القائمة
  const loadServers = useCallback(async () => {
    await fetchServers();
  }, [fetchServers]);

  useEffect(() => {
    loadServers();
    
    // تحديث تلقائي كل 30 ثانية للحفاظ على البيانات محدثة
    const interval = setInterval(() => {
      loadServers();
    }, 30000); // 30 ثانية
    
    return () => clearInterval(interval);
  }, [loadServers]);

  // تصفية قائمة الخوادم - عرض جميع الخوادم النشطة
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let filteredServers = servers;
    
    // عرض جميع الخوادم النشطة (بما في ذلك الخادم الرئيسي)
    if (!term) return filteredServers;
    
    return filteredServers.filter(s =>
      s.name.toLowerCase().includes(term) || 
      s.ip_address?.toLowerCase().includes(term) ||
      s.ip?.toLowerCase().includes(term)
    );
  }, [servers, search]);

  const handleSync = async (server) => {
    setSyncingId(server.id);
    setSyncResult(null);
    try {
      const res = await serverSync(server.id, server.api_key);
      setSyncResult({ id: server.id, msg: res.message || 'تمت المزامنة بنجاح' });
      toast.success(`تمت مزامنة الخادم ${server.name} بنجاح`);
    } catch (e) {
      setSyncResult({ id: server.id, msg: 'فشل المزامنة' });
      toast.error(`فشل في مزامنة الخادم ${server.name}`);
    } finally {
      setSyncingId(null);
    }
  };

  const handleShowApiKey = (key) => setApiKeyModal({ show: true, key });
  
  const handleCopyApiKey = () => {
    navigator.clipboard.writeText(apiKeyModal.key);
    toast.success('تم نسخ مفتاح API إلى الحافظة');
    setApiKeyModal({ ...apiKeyModal, show: false });
  };

  // CMD Terminal Functions
  const handleOpenCmd = async () => {
    // إذا كانت النافذة موجودة بالفعل ولكن مخفية، أظهرها
    if (cmdModal.show && cmdModal.minimized) {
      setCmdModal({
        ...cmdModal,
        minimized: false
      });
      return;
    }

    // إذا كانت النافذة مفتوحة بالفعل وظاهرة، لا تفعل شيء
    if (cmdModal.show && !cmdModal.minimized) {
      return;
    }

    try {
      // Get the primary server first, then fallback to secondary if primary fails
      let targetServer = servers.find(s => s.role === 'primary') || servers.find(s => s.role === 'secondary') || servers[0];
      
      if (!targetServer) {
        toast.error('لم يتم العثور على خادم متاح');
        return;
      }

      // Try to get current path from the target server
      let currentPath = 'C:\\Windows\\system32';
      try {
        const token = localStorage.getItem('token');
        const headers = {};
        if (token && token.trim() !== '') {
          headers['Authorization'] = `Bearer ${token}`;
        }
        
        const pathResponse = await fetch(`/api/servers/${targetServer.id}/cmd/current-path`, {
          headers: headers
        });
        if (pathResponse.ok) {
          const pathData = await pathResponse.json();
          currentPath = pathData.current_path || currentPath;
        }
      } catch (error) {
        console.warn('Could not get current path from server, using default:', error);
      }
      
      setCmdModal({
        show: true,
        minimized: false,
        maximized: false,
        command: '',
        output: `Microsoft Windows [Version 10.0.19045.3570]\n(c) Microsoft Corporation. All rights reserved.\n\n${currentPath}>`,
        history: [],
        commandHistory: [],
        historyIndex: -1,
        currentPath: currentPath,
        targetServer: targetServer,
        isExecuting: false,
        position: { x: 100, y: 50 },
        size: { width: 800, height: 500 },
        isDragging: false,
        isResizing: false,
        dragOffset: { x: 0, y: 0 },
        resizeDirection: null
      });
    } catch (error) {
      console.error('Error opening CMD:', error);
      setCmdModal({
        show: true,
        minimized: false,
        maximized: false,
        command: '',
        output: 'C:\\Windows\\system32>',
        history: [],
        commandHistory: [],
        historyIndex: -1,
        currentPath: 'C:\\Windows\\system32',
        targetServer: null,
        isExecuting: false,
        position: { x: 100, y: 50 },
        size: { width: 800, height: 500 },
        isDragging: false,
        isResizing: false,
        dragOffset: { x: 0, y: 0 },
        resizeDirection: null
      });
    }
  };

  const handleCloseCmd = () => {
    // زر X يغلق النافذة ويمسح كل شيء
    setCmdModal({
      show: false,
      minimized: false,
      maximized: false,
      command: '',
      output: '',
      history: [],
      commandHistory: [],
      historyIndex: -1,
      currentPath: 'C:\\Windows\\system32',
      targetServer: null,
      isExecuting: false,
      position: { x: 100, y: 50 },
      size: { width: 800, height: 500 },
      isDragging: false,
      isResizing: false,
      dragOffset: { x: 0, y: 0 },
      resizeDirection: null
    });
  };

  const handleMaximizeCmd = () => {
    setCmdModal({
      ...cmdModal,
      maximized: !cmdModal.maximized
    });
  };

  const handleMinimizeCmd = () => {
    // زر - يخفي النافذة فقط (لا يمسح الأوامر)
    setCmdModal({
      ...cmdModal,
      minimized: true
    });
  };

  // مُعالجات السحب والتحريك
  const handleMouseDown = (e, type, direction = null) => {
    e.preventDefault();
    
    if (type === 'drag') {
      setCmdModal(prev => ({
        ...prev,
        isDragging: true,
        dragOffset: {
          x: e.clientX - prev.position.x,
          y: e.clientY - prev.position.y
        }
      }));
    } else if (type === 'resize') {
      setCmdModal(prev => ({
        ...prev,
        isResizing: true,
        resizeDirection: direction
      }));
    }
  };

  const handleMouseMove = useCallback((e) => {
    if (cmdModal.isDragging) {
      setCmdModal(prev => ({
        ...prev,
        position: {
          x: Math.max(0, Math.min(window.innerWidth - prev.size.width, e.clientX - prev.dragOffset.x)),
          y: Math.max(0, Math.min(window.innerHeight - prev.size.height, e.clientY - prev.dragOffset.y))
        }
      }));
    } else if (cmdModal.isResizing && cmdModal.resizeDirection) {
      setCmdModal(prev => {
        const newSize = { ...prev.size };
        const newPosition = { ...prev.position };
        
        const minWidth = 400;
        const minHeight = 300;
        const maxWidth = window.innerWidth - prev.position.x;
        const maxHeight = window.innerHeight - prev.position.y;
        
        switch (cmdModal.resizeDirection) {
          case 'n':
            const newHeight = prev.size.height - (e.clientY - prev.position.y);
            if (newHeight >= minHeight) {
              newSize.height = newHeight;
              newPosition.y = e.clientY;
            }
            break;
          case 's':
            newSize.height = Math.max(minHeight, Math.min(maxHeight, e.clientY - prev.position.y));
            break;
          case 'w':
            const newWidth = prev.size.width - (e.clientX - prev.position.x);
            if (newWidth >= minWidth) {
              newSize.width = newWidth;
              newPosition.x = e.clientX;
            }
            break;
          case 'e':
            newSize.width = Math.max(minWidth, Math.min(maxWidth, e.clientX - prev.position.x));
            break;
          case 'nw':
            const nwHeight = prev.size.height - (e.clientY - prev.position.y);
            const nwWidth = prev.size.width - (e.clientX - prev.position.x);
            if (nwHeight >= minHeight) {
              newSize.height = nwHeight;
              newPosition.y = e.clientY;
            }
            if (nwWidth >= minWidth) {
              newSize.width = nwWidth;
              newPosition.x = e.clientX;
            }
            break;
          case 'ne':
            const neHeight = prev.size.height - (e.clientY - prev.position.y);
            if (neHeight >= minHeight) {
              newSize.height = neHeight;
              newPosition.y = e.clientY;
            }
            newSize.width = Math.max(minWidth, Math.min(maxWidth, e.clientX - prev.position.x));
            break;
          case 'sw':
            newSize.height = Math.max(minHeight, Math.min(maxHeight, e.clientY - prev.position.y));
            const swWidth = prev.size.width - (e.clientX - prev.position.x);
            if (swWidth >= minWidth) {
              newSize.width = swWidth;
              newPosition.x = e.clientX;
            }
            break;
          case 'se':
            newSize.height = Math.max(minHeight, Math.min(maxHeight, e.clientY - prev.position.y));
            newSize.width = Math.max(minWidth, Math.min(maxWidth, e.clientX - prev.position.x));
            break;
          default:
            // لا نفعل شيء للاتجاهات غير المعروفة
            break;
        }
        
        return {
          ...prev,
          size: newSize,
          position: newPosition
        };
      });
    }
  }, [cmdModal.isDragging, cmdModal.isResizing, cmdModal.resizeDirection]);

  const handleMouseUp = useCallback(() => {
    setCmdModal(prev => ({
      ...prev,
      isDragging: false,
      isResizing: false,
      resizeDirection: null
    }));
  }, []);

  // إضافة event listeners للماوس
  useEffect(() => {
    if (cmdModal.isDragging || cmdModal.isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [cmdModal.isDragging, cmdModal.isResizing, handleMouseMove, handleMouseUp]);

  const handleExecuteCommand = async () => {
    if (!cmdModal.command.trim()) return;

    const command = cmdModal.command.trim();
    let targetServer = cmdModal.targetServer || servers.find(s => s.role === 'primary') || servers.find(s => s.role === 'secondary') || servers[0];
    
    if (!targetServer) {
      setCmdModal(prev => ({
        ...prev,
        output: prev.output + '\nخطأ: لم يتم العثور على خادم متاح\n' + prev.currentPath + '>',
        isExecuting: false,
        command: ''
      }));
      return;
    }

    // Add command to history for arrow navigation
    const newHistory = [...cmdModal.commandHistory, command];
    
    setCmdModal(prev => ({
      ...prev,
      isExecuting: true,
      output: prev.output + command + '\n',
      commandHistory: newHistory,
      historyIndex: -1
    }));

    try {
      // Handle built-in commands first
      const cmdParts = command.toLowerCase().split(' ');
      const baseCmd = cmdParts[0];

      if (baseCmd === 'exit') {
        // Exit command
        handleCloseCmd();
        return;
      }

      if (baseCmd === 'cls' || baseCmd === 'clear') {
        // Clear screen command
        setCmdModal(prev => ({
          ...prev,
          output: `Microsoft Windows [Version 10.0.19045.3570]\n(c) Microsoft Corporation. All rights reserved.\n\n${prev.currentPath}>`,
          isExecuting: false,
          command: '',
          commandHistory: newHistory.slice(-10),
          historyIndex: -1
        }));
        return;
      }

      // Execute all other commands via API
      const token = localStorage.getItem('token');
      const headers = {
        'Content-Type': 'application/json'
      };
      if (token && token.trim() !== '') {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const response = await fetch(`/api/servers/${targetServer.id}/execute-command`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ 
          command: command,
          current_path: cmdModal.currentPath 
        })
      });

      const result = await response.json();

      let outputText = '';
      if (response.ok) {
        outputText = result.stdout || '';
        if (result.stderr) {
          outputText += '\nSTDERR:\n' + result.stderr;
        }
        // Update current path if it changed
        if (result.current_path && result.current_path !== cmdModal.currentPath) {
          setCmdModal(prev => ({
            ...prev,
            currentPath: result.current_path
          }));
        }
      } else {
        outputText = `Error: ${result.error || 'Failed to execute command'}`;
      }

      setCmdModal(prev => ({
        ...prev,
        output: prev.output + outputText + '\n\n' + prev.currentPath + '>',
        isExecuting: false,
        command: '',
        commandHistory: [...prev.commandHistory, command].slice(-10),
        historyIndex: -1
      }));

    } catch (error) {
      setCmdModal(prev => ({
        ...prev,
        output: prev.output + `Network error: ${error.message}\n\n` + cmdModal.currentPath + '>',
        isExecuting: false,
        command: '',
        commandHistory: [...prev.commandHistory, command].slice(-10),
        historyIndex: -1
      }));
    }
  };

  const handleCommandKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleExecuteCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      // Navigate command history up
      if (cmdModal.commandHistory.length > 0) {
        const newIndex = cmdModal.historyIndex + 1;
        if (newIndex < cmdModal.commandHistory.length) {
          const historyCommand = cmdModal.commandHistory[cmdModal.commandHistory.length - 1 - newIndex];
          setCmdModal(prev => ({
            ...prev,
            command: historyCommand,
            historyIndex: newIndex
          }));
        }
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      // Navigate command history down
      if (cmdModal.historyIndex > 0) {
        const newIndex = cmdModal.historyIndex - 1;
        const historyCommand = cmdModal.commandHistory[cmdModal.commandHistory.length - 1 - newIndex];
        setCmdModal(prev => ({
          ...prev,
          command: historyCommand,
          historyIndex: newIndex
        }));
      } else if (cmdModal.historyIndex === 0) {
        setCmdModal(prev => ({
          ...prev,
          command: '',
          historyIndex: -1
        }));
      }
    }
  };

  const handleHeartbeat = async (server) => {
    setHeartbeatMsg('');
    try {
      const apiKey = server.api_key;
      await serverSync(server.id, apiKey);
      setHeartbeatMsg('تم إرسال نبضة الحياة بنجاح');
      toast.success(`تم إرسال نبضة الحياة للخادم ${server.name}`);
    } catch {
      setHeartbeatMsg('فشل إرسال نبضة الحياة');
      toast.error(`فشل في إرسال نبضة الحياة للخادم ${server.name}`);
    }
  };

  // استقبال أحداث WebSocket
  const { subscribe: subscribeSocket, isConnected } = useSocket();

  useEffect(() => {
    if (!isConnected) return;

    // الاشتراك في أحداث WebSocket
    const unsubscribeSyncSuccess = subscribeSocket('secondary_sync_success', (data) => {
      setLastSync(data.sync_time);
      toast.success(`تمت مزامنة الخادم الاحتياطي مع الرئيسي (${data.primary_url}) بنجاح`);
    });

    const unsubscribeRegistered = subscribeSocket('server_registered', (data) => {
      toast.success(`تم تسجيل خادم جديد: ${data.name}`);
      loadServers();
    });

    const unsubscribeUpdated = subscribeSocket('server_updated', (data) => {
      toast.info(`تم تحديث الخادم: ${data.name}`);
      loadServers();
    });

    const unsubscribeDeleted = subscribeSocket('server_deleted', (data) => {
      toast.info(`تم حذف الخادم: ${data.server_name}`);
      loadServers();
    });

    // تنظيف الاشتراكات عند إلغاء التحميل
    return () => {
      unsubscribeSyncSuccess?.();
      unsubscribeRegistered?.();
      unsubscribeUpdated?.();
      unsubscribeDeleted?.();
    };
  }, [subscribeSocket, isConnected, loadServers]);

  return (
    <div className="container py-4" dir="rtl">
      {/* مؤشر النافذة المصغرة */}
      {cmdModal.show && cmdModal.minimized && (
        <div 
          className="position-fixed bg-primary text-white px-3 py-2 rounded-top cursor-pointer"
          style={{ 
            bottom: 0, 
            left: '20px', 
            zIndex: 1040,
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold'
          }}
          onClick={handleOpenCmd}
          title="انقر لاستعادة نافذة CMD"
        >
          <i className="fas fa-terminal me-2"></i>
          Command Prompt
        </div>
      )}

      {/* إشعار آخر مزامنة احتياطي/رئيسي */}
      {lastSync && (
        <div className="alert alert-success text-center mb-3">
          <i className="fas fa-check-circle me-2"></i>
          آخر مزامنة احتياطي/رئيسي: {formatDateTime(lastSync)}
        </div>
      )}

      {/* رأس الصفحة */}
      <header className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center mb-4">
        <div>
          <h1 className="h3 mb-1">
            <i className="fas fa-server me-2 text-primary"></i>
            إدارة الخوادم
          </h1>
          <small className="text-muted">عرض ومراقبة حالة جميع الخوادم النشطة</small>
        </div>
        <div className="mt-3 mt-md-0">
          <button
            className="btn btn-outline-secondary me-2"
            onClick={loadServers}
            disabled={isLoading}
            title="تحديث القائمة"
          >
            <i className="fas fa-sync-alt me-1" />
            تحديث
          </button>
          <button
            className="btn btn-info me-2"
            onClick={handleOpenCmd}
            title="فتح CMD Terminal"
          >
            <i className="fas fa-terminal me-1" />
            CMD
          </button>
        </div>
      </header>

      {/* شريط البحث */}
      <div className="mb-4">
        <div className="input-group">
          <span className="input-group-text">
            <i className="fas fa-search"></i>
          </span>
          <input
            type="text"
            className="form-control form-control-lg"
            placeholder="ابحث بالاسم أو الـ IP..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            disabled={isLoading}
          />
        </div>
      </div>

      {/* حالة التحميل */}
      {isLoading && (
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status" />
          <p className="mt-2 text-muted">جاري تحميل الخوادم...</p>
        </div>
      )}

      {/* خطأ في التحميل */}
      {!isLoading && error && (
        <div className="alert alert-danger d-flex justify-content-between align-items-center">
          <div>
            <i className="fas fa-exclamation-triangle me-2" />
            فشل في تحميل الخوادم: {error}
          </div>
          <button className="btn btn-sm btn-outline-light" onClick={loadServers}>
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* لا توجد خوادم */}
      {!isLoading && !error && filtered.length === 0 && (
        <div className="text-center text-muted py-5">
          <i className="fas fa-server fa-3x mb-3 text-muted"></i>
          <h5 className="mb-2">لا توجد خوادم لعرضها</h5>
          <p>يمكنك إضافة خادم جديد بالضغط على زر "خادم جديد".</p>
        </div>
      )}

      {/* عرض الجدول على الشاشات المتوسطة والكبيرة */}
      {!isLoading && !error && filtered.length > 0 && (
        <>
          {/* على الشاشات الكبيرة */}
          <div className="table-responsive d-none d-md-block">
            <table className="table table-hover align-middle">
              <thead className="table-light">
                <tr>
                  <th>الاسم</th>
                  <th>IP</th>
                  <th>النظام</th>
                  <th>المعالج</th>
                  <th>الذاكرة</th>
                  <th>الدور</th>
                  <th>الحالة</th>
                  <th>آخر نبضة حياة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} className="hover-row" style={{cursor: 'pointer'}} onClick={() => navigate(`/servers/details/${s.id}`)}>
                    <td className="fw-bold text-primary">{s.name}</td>
                    <td><code>{s.ip_address || s.ip}</code></td>
                    <td>{s.os || '—'}</td>
                    <td>{s.cpu || '—'}</td>
                    <td>{s.ram || '—'}</td>
                    <td>
                      {s.role === 'primary' ? 
                        <span className="badge bg-primary fs-6">رئيسي</span> : 
                        <span className="badge bg-secondary fs-6">احتياطي</span>
                      }
                    </td>
                    <td><StatusBadge status={mapServerStatusToBadgeStatus(s.status, s.is_online)} /></td>
                    <td>{formatDateTime(s.last_heartbeat)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="btn-group btn-group-sm" role="group">
                        <button 
                          className="btn btn-info" 
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleHeartbeat(s);
                          }} 
                          title="نبضة حياة"
                        >
                          <i className="fas fa-heartbeat" />
                        </button>
                        <button 
                          className="btn btn-success" 
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleSync(s);
                          }} 
                          disabled={syncingId === s.id} 
                          title="مزامنة السياسات والسجلات"
                        >
                          <i className={`fas ${syncingId === s.id ? 'fa-spinner fa-spin' : 'fa-sync'}`} />
                        </button>
                        <button 
                          className="btn btn-dark" 
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleShowApiKey(s.api_key);
                          }} 
                          title="API Key"
                        >
                          <i className="fas fa-key" />
                        </button>
                        <button 
                          className="btn btn-warning" 
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleOpenCmd();
                          }} 
                          title="فتح CMD Terminal"
                        >
                          <i className="fas fa-terminal" />
                        </button>
                        <span className="badge bg-info ms-1" title="TLS">
                          {window.location.protocol === 'https:' ? 'TLS' : 'غير آمن'}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* على الشاشات الصغيرة - بطاقات */}
          <div className="d-block d-md-none">
            <div className="row g-3">
              {filtered.map(s => (
                <div key={s.id} className="col-12">
                  <ServerCard
                    server={{
                      ...s,
                      address: s.ip_address || s.ip,
                      ports: s.active_ports_count ? Array.from({length: s.active_ports_count}, (_, i) => `${i + 1}`) : [], // استخدام عدد المنافذ النشطة
                      lastHeartbeat: s.last_heartbeat,
                      status: s.status === 'active' ? 'متصل' : 'منقطع',
                      is_backup: s.role === 'secondary',
                      system_specs: `${s.os || 'غير محدد'} | ${s.cpu || 'غير محدد'} | ${s.ram || 'غير محدد'}`,
                      connected_devices_count: s.connected_devices_count || 0,
                      total_power_consumption: s.total_power_consumption || 0
                    }}
                    onClick={() => navigate(`/servers/details/${s.id}`)}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* عرض نتيجة المزامنة أو نبضة الحياة */}
      {syncResult && <div className="alert alert-info mt-3">{syncResult.msg}</div>}
      {heartbeatMsg && <div className="alert alert-info mt-3">{heartbeatMsg}</div>}

      {/* Modal API Key */}
      {apiKeyModal.show && (
        <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header bg-dark text-white">
                <h5 className="modal-title">
                  <i className="fas fa-key me-2"></i>
                  مفتاح API
                </h5>
                <button 
                  type="button" 
                  className="btn-close btn-close-white" 
                  onClick={() => setApiKeyModal({ show: false, key: '' })}
                ></button>
              </div>
              <div className="modal-body">
                <div className="input-group">
                  <input 
                    type="text" 
                    className="form-control form-control-lg" 
                    value={apiKeyModal.key} 
                    readOnly 
                  />
                  <button 
                    className="btn btn-primary btn-lg" 
                    onClick={handleCopyApiKey}
                  >
                    <i className="fas fa-copy me-2"></i>
                    نسخ
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CMD Terminal Modal */}
      {cmdModal.show && !cmdModal.minimized && (
        <div 
          className="modal show d-block" 
          tabIndex="-1" 
          style={{ 
            background: 'rgba(0,0,0,0.8)',
            zIndex: 1050,
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: cmdModal.isDragging || cmdModal.isResizing ? 'none' : 'auto'
          }}
        >
          <div 
            className="modal-dialog" 
            style={{
              position: 'absolute',
              top: cmdModal.maximized ? 0 : cmdModal.position.y,
              left: cmdModal.maximized ? 0 : cmdModal.position.x,
              width: cmdModal.maximized ? '100vw' : cmdModal.size.width,
              height: cmdModal.maximized ? '100vh' : cmdModal.size.height,
              margin: 0,
              maxWidth: 'none',
              pointerEvents: 'auto',
              cursor: cmdModal.isDragging ? 'grabbing' : 'default'
            }}
          >
            <div 
              className="modal-content border-0 shadow-lg" 
              style={{ 
                background: 'transparent',
                width: '100%',
                height: '100%',
                position: 'relative'
              }}
            >
              {/* Resize handles */}
              {!cmdModal.maximized && (
                <>
                  {/* Top */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 8,
                      right: 8,
                      height: 4,
                      cursor: 'n-resize',
                      zIndex: 10
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'resize', 'n')}
                  />
                  {/* Bottom */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 8,
                      right: 8,
                      height: 4,
                      cursor: 's-resize',
                      zIndex: 10
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'resize', 's')}
                  />
                  {/* Left */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      bottom: 8,
                      left: 0,
                      width: 4,
                      cursor: 'w-resize',
                      zIndex: 10
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'resize', 'w')}
                  />
                  {/* Right */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      bottom: 8,
                      right: 0,
                      width: 4,
                      cursor: 'e-resize',
                      zIndex: 10
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'resize', 'e')}
                  />
                  {/* Corners */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: 8,
                      height: 8,
                      cursor: 'nw-resize',
                      zIndex: 10
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'resize', 'nw')}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      width: 8,
                      height: 8,
                      cursor: 'ne-resize',
                      zIndex: 10
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'resize', 'ne')}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      width: 8,
                      height: 8,
                      cursor: 'sw-resize',
                      zIndex: 10
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'resize', 'sw')}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      right: 0,
                      width: 8,
                      height: 8,
                      cursor: 'se-resize',
                      zIndex: 10
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'resize', 'se')}
                  />
                </>
              )}

              {/* Windows-style Title Bar */}
              <div 
                className="d-flex align-items-center justify-content-between px-3 py-2"
                style={{ 
                  background: 'linear-gradient(to right, #0054e3, #0054e3)',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  borderTopLeftRadius: '8px',
                  borderTopRightRadius: '8px',
                  cursor: cmdModal.maximized ? 'default' : 'grab',
                  userSelect: 'none',
                  position: 'relative',
                  zIndex: 5
                }}
                onMouseDown={(e) => !cmdModal.maximized && handleMouseDown(e, 'drag')}
              >
                <div className="d-flex align-items-center">
                  <i className="fas fa-terminal me-2"></i>
                  <span>Command Prompt - {cmdModal.currentPath || 'C:\\Windows\\system32'}</span>
                </div>
                <div className="d-flex gap-0">
                  <button 
                    type="button" 
                    className="btn border-0 p-1 d-flex align-items-center justify-content-center"
                    onClick={handleMinimizeCmd}
                    title="Minimize"
                    style={{ 
                      width: '45px', 
                      height: '28px', 
                      background: 'transparent', 
                      color: 'white',
                      fontSize: '16px',
                      fontWeight: 'bold',
                      borderRadius: '0',
                      fontFamily: 'Segoe UI Symbol, Arial'
                    }}
                    onMouseEnter={(e) => e.target.style.background = '#3a6ea5'}
                    onMouseLeave={(e) => e.target.style.background = 'transparent'}
                  >
                    −
                  </button>
                  <button 
                    type="button" 
                    className="btn border-0 p-1 d-flex align-items-center justify-content-center"
                    onClick={handleMaximizeCmd}
                    title={cmdModal.maximized ? "Restore Down" : "Maximize"}
                    style={{ 
                      width: '45px', 
                      height: '28px', 
                      background: 'transparent', 
                      color: 'white',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      borderRadius: '0',
                      fontFamily: 'Segoe UI Symbol, Arial'
                    }}
                    onMouseEnter={(e) => e.target.style.background = '#3a6ea5'}
                    onMouseLeave={(e) => e.target.style.background = 'transparent'}
                  >
                    {cmdModal.maximized ? '🗗' : '☐'}
                  </button>
                  <button 
                    type="button" 
                    className="btn border-0 p-1 d-flex align-items-center justify-content-center"
                    onClick={handleCloseCmd}
                    title="Close"
                    style={{ 
                      width: '45px', 
                      height: '28px', 
                      background: 'transparent', 
                      color: 'white',
                      fontSize: '18px',
                      fontWeight: 'bold',
                      borderRadius: '0',
                      fontFamily: 'Segoe UI Symbol, Arial'
                    }}
                    onMouseEnter={(e) => e.target.style.background = '#e81123'}
                    onMouseLeave={(e) => e.target.style.background = 'transparent'}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Terminal Body */}
              <div 
                className="p-0"
                style={{ 
                  background: 'var(--black)',
                  borderBottomLeftRadius: '8px',
                  borderBottomRightRadius: '8px',
                  border: '2px solid #0054e3',
                  borderTop: 'none',
                  height: cmdModal.maximized ? 'calc(100vh - 60px)' : cmdModal.size.height - 60,
                  position: 'relative',
                  zIndex: 1
                }}
              >
                <div className="p-3" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  {/* Terminal Output */}
                  <div 
                    className="terminal-output mb-3 p-2 flex-grow-1"
                    style={{ 
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      fontFamily: '"Courier New", Consolas, Monaco, monospace',
                      fontSize: '14px',
                      lineHeight: '1.2',
                      background: 'var(--black)',
                      color: '#00ff00',
                      border: '1px solid #333',
                      direction: 'ltr',
                      textAlign: 'left'
                    }}
                  >
                    <div style={{ color: '#00ff00', direction: 'ltr' }}>
                      Microsoft Windows [Version 10.0.19045.3570]<br/>
                      (c) Microsoft Corporation. All rights reserved.<br/>
                      <br/>
                      {cmdModal.currentPath ? `${cmdModal.currentPath}>` : 'C:\\Windows\\system32>'}
                    </div>
                    {cmdModal.output && (
                      <div className="mt-2" style={{ color: 'var(--white)', direction: 'ltr' }}>
                        {cmdModal.output}
                      </div>
                    )}
                    {cmdModal.isExecuting && (
                      <div className="mt-2" style={{ color: '#ffff00', direction: 'ltr' }}>
                        <i className="fas fa-spinner fa-spin me-1"></i>
                        Executing command...
                      </div>
                    )}
                  </div>
                  
                  {/* Command Input */}
                  <div className="d-flex align-items-center" style={{ background: 'var(--black)', padding: '8px', direction: 'ltr' }}>
                    <span style={{ color: '#00ff00', fontFamily: 'monospace', marginRight: '8px' }}>
                      {cmdModal.currentPath ? `${cmdModal.currentPath}>` : 'C:\\Windows\\system32>'}
                    </span>
                    <input
                      type="text"
                      className="flex-grow-1 border-0 bg-transparent"
                      placeholder=""
                      value={cmdModal.command}
                      onChange={(e) => setCmdModal(prev => ({ ...prev, command: e.target.value }))}
                      onKeyPress={handleCommandKeyPress}
                      disabled={cmdModal.isExecuting}
                      style={{ 
                        fontFamily: '"Courier New", Consolas, Monaco, monospace',
                        fontSize: '14px',
                        color: '#00ff00',
                        background: 'transparent',
                        outline: 'none',
                        caretColor: '#00ff00',
                        direction: 'ltr'
                      }}
                      autoFocus
                    />
                  </div>
                  
                  {/* Command History */}
                  {cmdModal.history.length > 0 && (
                    <div className="mt-2 px-2">
                      <small className="text-muted">Recent commands:</small>
                      <div className="d-flex flex-wrap gap-1 mt-1">
                        {cmdModal.history.slice(-5).map((cmd, index) => (
                          <button
                            key={index}
                            className="btn btn-sm"
                            onClick={() => setCmdModal(prev => ({ ...prev, command: cmd }))}
                            title="Click to reuse command"
                            style={{
                              background: '#333',
                              color: '#00ff00',
                              border: '1px solid #555',
                              fontSize: '12px',
                              fontFamily: 'monospace'
                            }}
                          >
                            {cmd.length > 15 ? cmd.substring(0, 15) + '...' : cmd}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* عرض نتيجة المزامنة أو نبضة الحياة */}
      {syncResult && <div className="alert alert-info mt-3">{syncResult.msg}</div>}
      {heartbeatMsg && <div className="alert alert-info mt-3">{heartbeatMsg}</div>}
    </div>
  );
};

// تغليف بمذكرة وإضافة displayName
export const ServerList = React.memo(ServerListComponent);
ServerList.displayName = 'ServerList';

export default ServerList;
