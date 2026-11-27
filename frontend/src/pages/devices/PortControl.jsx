// src/pages/devices/PortControl.jsx

import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { getUsbPorts, controlUsbPort, monitorPower } from '../../utils/api';
import 'react-toastify/dist/ReactToastify.css';

// إضافة CSS مخصص للتصميم المحسن
const customStyles = `
  .port-card {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    border-radius: 12px;
    overflow: hidden;
  }
  
  .port-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 24px rgba(0,0,0,0.15) !important;
  }
  
  .port-card.active {
    border-left: 4px solid var(--success-color);
  }
  
  .port-card.inactive {
    border-left: 4px solid var(--danger-color);
  }
  
  .stats-card {
    transition: all 0.2s ease;
    border-radius: 10px;
  }
  
  .stats-card:hover {
    transform: scale(1.02);
  }
  
  .gradient-header {
    background: linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%);
    border-radius: 12px 12px 0 0;
  }
  
  .progress-bar {
    transition: width 0.6s ease;
  }
  
  .btn-group .btn {
    transition: all 0.2s ease;
  }
  
  .btn-group .btn:hover {
    transform: translateY(-1px);
  }
  
  .device-badge {
    background: rgba(255,255,255,0.9);
    backdrop-filter: blur(10px);
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.2);
  }
  
  .loading-container {
    background: linear-gradient(45deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));
    border-radius: 12px;
    backdrop-filter: blur(10px);
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  
  .pulse-animation {
    animation: pulse 2s ease-in-out infinite;
  }
`;

const PortControl = () => {
  const [ports, setPorts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [powerData, setPowerData] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const [selectedPort, setSelectedPort] = useState(null);
  const [isPortControlLoading, setIsPortControlLoading] = useState({});

  // إضافة CSS مخصص للتصميم المحسن
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = customStyles;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // تحميل بيانات المنافذ - محسن للدوال الجديدة
  const loadPorts = async () => {
    try {
      setIsLoading(true);
      const data = await getUsbPorts();
      setPorts(data.ports || []);
    } catch (error) {
      console.error('Error loading ports:', error);
      toast.error('خطأ في تحميل بيانات المنافذ');
      // إرجاع بيانات افتراضية في حالة الخطأ
      setPorts([
        { id: 'usb-1', name: 'USB Port 1', status: 'active', type: 'usb', port_count: 4, manufacturer: 'Unknown', os: 'Windows' },
        { id: 'usb-2', name: 'USB Port 2', status: 'active', type: 'usb', port_count: 4, manufacturer: 'Unknown', os: 'Windows' },
        { id: 'usb-3', name: 'USB Port 3', status: 'active', type: 'usb', port_count: 4, manufacturer: 'Unknown', os: 'Windows' },
        { id: 'usb-4', name: 'USB Port 4', status: 'active', type: 'usb', port_count: 4, manufacturer: 'Unknown', os: 'Windows' }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // تحميل بيانات استهلاك الطاقة - محسن للدوال الجديدة
  const loadPowerData = async () => {
    try {
      const data = await monitorPower();
      setPowerData(data);
    } catch (error) {
      console.error('Error loading power data:', error);
      // إرجاع بيانات افتراضية في حالة الخطأ
      setPowerData({
        total_power: 0.0,
        device_count: 0,
        high_consumption_devices: [],
        average_consumption: 0.0,
        power_by_server: {},
        os: 'Unknown'
      });
    }
  };

  // تفعيل/تعطيل منفذ - محسن للدوال الجديدة
  const togglePort = async (portId, action) => {
    try {
      setIsPortControlLoading(prev => ({ ...prev, [portId]: true }));
      const result = await controlUsbPort(portId, action);
      toast.success(result.message || `تم ${action === 'enable' ? 'تفعيل' : 'تعطيل'} المنفذ بنجاح`);
      await loadPorts(); // إعادة تحميل البيانات
    } catch (error) {
      console.error('Error toggling port:', error);
      toast.error(`خطأ في ${action === 'enable' ? 'تفعيل' : 'تعطيل'} المنفذ`);
    } finally {
      setIsPortControlLoading(prev => ({ ...prev, [portId]: false }));
    }
  };

  // الحصول على حالة منفذ محدد
  const getPortStatus = async (portId) => {
    try {
      const result = await controlUsbPort(portId, 'status');
      return result;
    } catch (error) {
      console.error('Error getting port status:', error);
      return null;
    }
  };

  // إيقاف جميع المنافذ
  const disableAllPorts = async () => {
    try {
      const promises = ports.map(port => {
        if (port.status === 'active') {
          return togglePort(port.id, 'disable');
        }
        return Promise.resolve();
      });
      
      await Promise.all(promises);
      toast.success('تم إيقاف جميع المنافذ بنجاح');
    } catch (error) {
      console.error('Error disabling all ports:', error);
      toast.error('خطأ في إيقاف جميع المنافذ');
    }
  };

  // تفعيل جميع المنافذ
  const enableAllPorts = async () => {
    try {
      const promises = ports.map(port => {
        if (port.status !== 'active') {
          return togglePort(port.id, 'enable');
        }
        return Promise.resolve();
      });
      
      await Promise.all(promises);
      toast.success('تم تفعيل جميع المنافذ بنجاح');
    } catch (error) {
      console.error('Error enabling all ports:', error);
      toast.error('خطأ في تفعيل جميع المنافذ');
    }
  };

  useEffect(() => {
    loadPorts();
    loadPowerData();
  }, []);

  if (isLoading) {
    return (
      <div className="container-fluid">
        <div className="row justify-content-center">
          <div className="col-12 text-center py-5 loading-container">
            <div className="mb-3">
              <i className="fas fa-plug fs-1 text-muted opacity-50 pulse-animation"></i>
            </div>
            <div className="spinner-border text-primary mb-3" role="status"></div>
            <h6 className="text-muted">جاري تحميل منافذ USB...</h6>
            <p className="text-muted small">
              يرجى الانتظار بينما نقوم بفحص منافذ USB المتاحة
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid">
      {/* Header */}
      <div className="row mb-4">
        <div className="col-12">
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <h2 className="mb-0">
                <i className="fas fa-plug me-2"></i>
                التحكم في منافذ USB
              </h2>
              <p className="text-muted mb-0">مراقبة وإدارة منافذ USB المتصلة</p>
            </div>
            <div className="d-flex gap-2">
              <button
                className="btn btn-outline-success"
                onClick={enableAllPorts}
              >
                <i className="fas fa-play me-2"></i>
                تفعيل الكل
              </button>
              <button
                className="btn btn-outline-danger"
                onClick={disableAllPorts}
              >
                <i className="fas fa-stop me-2"></i>
                إيقاف الكل
              </button>
              <button
                className="btn btn-outline-primary"
                onClick={loadPorts}
              >
                <i className="fas fa-sync-alt me-2"></i>
                تحديث
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* إحصائيات سريعة */}
      <div className="row mb-4">
        <div className="col-md-3 mb-3">
          <div className="card bg-primary text-white stats-card">
            <div className="card-body text-center">
              <div className="mb-2">
                <i className="fas fa-plug fs-2"></i>
              </div>
              <h4 className="card-title">{ports.length}</h4>
              <p className="card-text">إجمالي المنافذ</p>
            </div>
          </div>
        </div>
        <div className="col-md-3 mb-3">
          <div className="card bg-success text-white stats-card">
            <div className="card-body text-center">
              <div className="mb-2">
                <i className="fas fa-check-circle fs-2"></i>
              </div>
              <h4 className="card-title">{ports.filter(p => p.status === 'active').length}</h4>
              <p className="card-text">منافذ مفعلة</p>
            </div>
          </div>
        </div>
        <div className="col-md-3 mb-3">
          <div className="card bg-danger text-white stats-card">
            <div className="card-body text-center">
              <div className="mb-2">
                <i className="fas fa-times-circle fs-2"></i>
              </div>
              <h4 className="card-title">{ports.filter(p => p.status !== 'active').length}</h4>
              <p className="card-text">منافذ معطلة</p>
            </div>
          </div>
        </div>
        <div className="col-md-3 mb-3">
          <div className="card bg-info text-white stats-card">
            <div className="card-body text-center">
              <div className="mb-2">
                <i className="fas fa-bolt fs-2"></i>
              </div>
              <h4 className="card-title">{powerData?.total_power?.toFixed(1) || 0}W</h4>
              <p className="card-text">إجمالي الطاقة</p>
            </div>
          </div>
        </div>
      </div>

      {/* قائمة المنافذ */}
      <div className="row">
        {ports.map((port, index) => (
          <div key={port.id || index} className="col-lg-4 col-md-6 mb-4">
            <div className={`card h-100 border-0 shadow-sm position-relative overflow-hidden port-card ${
              port.status === 'active' ? 'active' : 'inactive'
            }`}>
              
              {/* شريط الحالة العلوي */}
              <div 
                className={`position-absolute top-0 start-0 w-100`}
                style={{ 
                  height: '4px',
                  background: port.status === 'active' 
                    ? 'linear-gradient(90deg, var(--success-color), var(--secondary-color))' 
                    : 'linear-gradient(90deg, var(--danger-color), #fd7e14)'
                }}
              ></div>

              <div className="card-body p-4">
                {/* Header with Icon and Status */}
                <div className="d-flex justify-content-between align-items-start mb-3">
                  <div className="d-flex align-items-center">
                    <div 
                      className={`p-3 rounded-circle me-3 ${
                        port.status === 'active' ? 'bg-success bg-opacity-10' : 'bg-danger bg-opacity-10'
                      }`}
                    >
                      <i className={`fas fa-plug fs-5 ${
                        port.status === 'active' ? 'text-success' : 'text-danger'
                      }`}></i>
                    </div>
                    <div>
                      <h6 className="card-title mb-1 fw-bold">
                        {port.name || `منفذ USB ${port.id}`}
                      </h6>
                      <span className={`badge ${
                        port.status === 'active' ? 'bg-success' : 'bg-danger'
                      }`}>
                        <i className={`fas fa-circle me-1`}></i>
                        {port.status === 'active' ? 'مفعل' : 'معطل'}
                      </span>
                    </div>
                  </div>
                  
                  {/* Dropdown Menu */}
                  <div className="dropdown">
                    <button 
                      className="btn btn-link text-muted p-0" 
                      type="button" 
                      data-bs-toggle="dropdown"
                    >
                      <i className="fas fa-ellipsis-v"></i>
                    </button>
                    <ul className="dropdown-menu dropdown-menu-end">
                      <li>
                        <button 
                          className="dropdown-item" 
                          type="button"
                          onClick={() => {
                            setSelectedPort(port);
                            toast.info(`تفاصيل ${port.name || `منفذ USB ${port.id}`}`);
                          }}
                        >
                          <i className="fas fa-info-circle me-2"></i>تفاصيل المنفذ
                        </button>
                      </li>
                      <li>
                        <button 
                          className="dropdown-item" 
                          type="button"
                          onClick={() => {
                            toast.info('سجل النشاط قريباً...');
                          }}
                        >
                          <i className="fas fa-history me-2"></i>سجل النشاط
                        </button>
                      </li>
                    </ul>
                  </div>
                </div>

                {/* Port Information */}
                <div className="row g-2 mb-3">
                  <div className="col-6">
                    <div className="bg-light rounded p-2 text-center">
                      <small className="text-muted d-block">عدد المنافذ</small>
                      <strong className="text-primary">{port.port_count || 0}</strong>
                    </div>
                  </div>
                  <div className="col-6">
                    <div className="bg-light rounded p-2 text-center">
                      <small className="text-muted d-block">الشركة المصنعة</small>
                      <strong className="text-info">
                        {port.manufacturer || 'غير محدد'}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* System Information */}
                {port.os && (
                  <div className="mb-3">
                    <div className="bg-light rounded p-2 text-center">
                      <small className="text-muted d-block">نظام التشغيل</small>
                      <strong className="text-secondary">
                        <i className="fas fa-desktop me-1"></i>
                        {port.os}
                      </strong>
                    </div>
                  </div>
                )}

                {/* Control Buttons */}
                <div className="d-grid gap-2">
                  <div className="btn-group">
                    <button
                      className={`btn ${
                        port.status === 'active' ? 'btn-outline-success' : 'btn-success'
                      } flex-fill`}
                      onClick={() => togglePort(port.id, 'enable')}
                      disabled={isPortControlLoading[port.id] || port.status === 'active'}
                    >
                      {isPortControlLoading[port.id] ? (
                        <span className="spinner-border spinner-border-sm me-2"></span>
                      ) : (
                        <i className="fas fa-play me-2"></i>
                      )}
                      تفعيل
                    </button>
                    <button
                      className={`btn ${
                        port.status !== 'active' ? 'btn-outline-danger' : 'btn-danger'
                      } flex-fill`}
                      onClick={() => togglePort(port.id, 'disable')}
                      disabled={isPortControlLoading[port.id] || port.status !== 'active'}
                    >
                      {isPortControlLoading[port.id] ? (
                        <span className="spinner-border spinner-border-sm me-2"></span>
                      ) : (
                        <i className="fas fa-stop me-2"></i>
                      )}
                      تعطيل
                    </button>
                  </div>
                </div>

                {/* Status Check Button */}
                <div className="mt-2">
                  <button
                    className="btn btn-sm btn-outline-info w-100"
                    onClick={() => getPortStatus(port.id)}
                    disabled={isPortControlLoading[port.id]}
                  >
                    <i className="fas fa-eye me-2"></i>
                    فحص الحالة
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* معلومات إضافية */}
      {powerData && (
        <div className="row mt-4">
          <div className="col-12">
            <div className="card bg-light">
              <div className="card-body">
                <h6 className="card-title mb-3">
                  <i className="fas fa-info-circle me-2"></i>
                  معلومات إضافية
                </h6>
                <div className="row">
                  <div className="col-md-4">
                    <div className="d-flex align-items-center">
                      <i className="fas fa-bolt text-warning me-3"></i>
                      <div>
                        <small className="text-muted">إجمالي استهلاك الطاقة</small>
                        <div className="fw-bold">{powerData.total_power?.toFixed(1) || 0}W</div>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-4">
                    <div className="d-flex align-items-center">
                      <i className="fas fa-usb text-primary me-3"></i>
                      <div>
                        <small className="text-muted">الأجهزة المتصلة</small>
                        <div className="fw-bold">{powerData.device_count || 0}</div>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-4">
                    <div className="d-flex align-items-center">
                      <i className="fas fa-desktop text-info me-3"></i>
                      <div>
                        <small className="text-muted">نظام التشغيل</small>
                        <div className="fw-bold">{powerData.os || 'غير محدد'}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortControl; 