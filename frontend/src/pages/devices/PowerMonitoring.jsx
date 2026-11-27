// src/pages/devices/PowerMonitoring.jsx

import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { monitorPower, autoDisableHighPowerDevices } from '../../utils/api';
import 'react-toastify/dist/ReactToastify.css';

// إضافة CSS مخصص للتصميم المحسن
const customStyles = `
  .power-card {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    border-radius: 12px;
    overflow: hidden;
  }
  
  .power-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 24px rgba(0,0,0,0.15) !important;
  }
  
  .power-stats {
    background: linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%);
    border-radius: 12px;
  }
  
  .progress-bar {
    transition: width 0.6s ease;
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

const PowerMonitoring = () => {
  const [powerData, setPowerData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  // eslint-disable-next-line no-unused-vars
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [timeRange, setTimeRange] = useState('24h'); // 24h, 7d, 30d
  const [isAutoDisabling, setIsAutoDisabling] = useState(false);

  // إضافة CSS مخصص للتصميم المحسن
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = customStyles;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // تحميل بيانات استهلاك الطاقة - محسن للدوال الجديدة
  const loadPowerData = async () => {
    try {
      setIsLoading(true);
      const data = await monitorPower();
      setPowerData(data);
    } catch (error) {
      console.error('Error loading power data:', error);
      toast.error('خطأ في تحميل بيانات استهلاك الطاقة');
      // إرجاع بيانات افتراضية في حالة الخطأ
      setPowerData({
        total_power: 0.0,
        device_count: 0,
        high_consumption_devices: [],
        average_consumption: 0.0,
        power_by_server: {},
        os: 'Unknown'
      });
    } finally {
      setIsLoading(false);
    }
  };

  // إيقاف الأجهزة عالية الاستهلاك تلقائياً
  const handleAutoDisable = async (threshold = 7) => {
    try {
      setIsAutoDisabling(true);
      const result = await autoDisableHighPowerDevices(threshold);
      toast.success(result.message || 'تم إيقاف الأجهزة عالية الاستهلاك بنجاح');
      await loadPowerData(); // إعادة تحميل البيانات
    } catch (error) {
      console.error('Error auto disabling devices:', error);
      toast.error('خطأ في إيقاف الأجهزة عالية الاستهلاك');
    } finally {
      setIsAutoDisabling(false);
    }
  };

  useEffect(() => {
    loadPowerData();
  }, [timeRange]);

  if (isLoading) {
    return (
      <div className="container-fluid">
        <div className="row justify-content-center">
          <div className="col-12 text-center py-5 loading-container">
            <div className="mb-3">
              <i className="fas fa-bolt fs-1 text-muted opacity-50 pulse-animation"></i>
            </div>
            <div className="spinner-border text-primary mb-3" role="status"></div>
            <h6 className="text-muted">جاري تحميل بيانات مراقبة الطاقة...</h6>
            <p className="text-muted small">
              يرجى الانتظار بينما نقوم بجمع معلومات استهلاك الطاقة
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid">
      {/* <ToastContainer position="top-right" rtl /> */}
      
      {/* Header */}
      <div className="row mb-4">
        <div className="col-12">
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <h2 className="mb-0">
                <i className="fas fa-bolt me-2"></i>
                مراقبة استهلاك الطاقة
              </h2>
              <p className="text-muted mb-0">مراقبة وإدارة استهلاك الطاقة للأجهزة المتصلة</p>
            </div>
            <div className="d-flex gap-2">
              <button
                className={`btn ${isAutoDisabling ? 'btn-secondary' : 'btn-warning'}`}
                onClick={() => handleAutoDisable(7)}
                disabled={isAutoDisabling}
              >
                {isAutoDisabling ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                    جاري الإيقاف...
                  </>
                ) : (
                  <>
                    <i className="fas fa-shield-alt me-2"></i>
                    إيقاف الأجهزة عالية الاستهلاك
                  </>
                )}
              </button>
              <button
                className="btn btn-outline-primary"
                onClick={loadPowerData}
              >
                <i className="fas fa-sync-alt me-2"></i>
                تحديث البيانات
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* فلتر النطاق الزمني */}
      <div className="row mb-4">
        <div className="col-12">
          <div className="card">
            <div className="card-body">
              <div className="d-flex align-items-center">
                <label className="form-label me-3 mb-0">النطاق الزمني:</label>
                <select
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value)}
                  className="form-select w-auto"
                >
                  <option value="24h">آخر 24 ساعة</option>
                  <option value="7d">آخر 7 أيام</option>
                  <option value="30d">آخر 30 يوم</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ملخص إحصائيات الطاقة */}
      {powerData && (
        <div className="row mb-4">
          <div className="col-md-3 mb-3">
            <div className="card bg-primary text-white power-card">
              <div className="card-body">
                <div className="d-flex justify-content-between">
                  <div>
                    <h4 className="card-title">{powerData.total_power?.toFixed(2) || 0} واط</h4>
                    <p className="card-text">إجمالي الاستهلاك</p>
                  </div>
                  <div className="align-self-center">
                    <i className="fas fa-bolt fa-2x"></i>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="col-md-3 mb-3">
            <div className="card bg-success text-white power-card">
              <div className="card-body">
                <div className="d-flex justify-content-between">
                  <div>
                    <h4 className="card-title">{powerData.device_count || 0}</h4>
                    <p className="card-text">الأجهزة المتصلة</p>
                  </div>
                  <div className="align-self-center">
                    <i className="fas fa-usb fa-2x"></i>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="col-md-3 mb-3">
            <div className="card bg-info text-white power-card">
              <div className="card-body">
                <div className="d-flex justify-content-between">
                  <div>
                    <h4 className="card-title">{powerData.average_consumption?.toFixed(2) || 0} واط</h4>
                    <p className="card-text">متوسط الاستهلاك</p>
                  </div>
                  <div className="align-self-center">
                    <i className="fas fa-chart-line fa-2x"></i>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="col-md-3 mb-3">
            <div className="card bg-danger text-white power-card">
              <div className="card-body">
                <div className="d-flex justify-content-between">
                  <div>
                    <h4 className="card-title">{powerData.high_consumption_devices?.length || 0}</h4>
                    <p className="card-text">أجهزة عالية الاستهلاك</p>
                  </div>
                  <div className="align-self-center">
                    <i className="fas fa-exclamation-triangle fa-2x"></i>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* إحصائيات حسب السيرفر */}
      {powerData?.power_by_server && Object.keys(powerData.power_by_server).length > 0 && (
        <div className="row mb-4">
          <div className="col-12">
            <div className="card power-stats text-white">
              <div className="card-header border-0" style={{ background: 'transparent' }}>
                <h5 className="mb-0">
                  <i className="fas fa-server me-2"></i>
                  استهلاك الطاقة حسب السيرفر
                </h5>
              </div>
              <div className="card-body">
                <div className="row">
                  {Object.entries(powerData.power_by_server).map(([serverId, data]) => (
                    <div key={serverId} className="col-md-4 mb-3">
                      <div className="card bg-light border-0">
                        <div className="card-body">
                          <div className="d-flex justify-content-between align-items-center mb-3">
                            <div>
                              <h6 className="card-title mb-1">السيرفر {serverId}</h6>
                              <small className="text-muted">{data.devices.length} جهاز متصل</small>
                            </div>
                            <div className="text-end">
                              <h4 className="text-primary mb-0">{data.total.toFixed(1)}W</h4>
                              <small className="text-muted">إجمالي الاستهلاك</small>
                            </div>
                          </div>
                          
                          {/* شريط التقدم للطاقة */}
                          <div className="mb-2">
                            <div className="d-flex justify-content-between align-items-center mb-1">
                              <small className="text-muted">مستوى الطاقة</small>
                              <small className="text-muted">{((data.total / 50) * 100).toFixed(0)}%</small>
                            </div>
                            <div className="progress" style={{ height: '6px' }}>
                              <div 
                                className={`progress-bar ${
                                  data.total > 35 ? 'bg-danger' : 
                                  data.total > 20 ? 'bg-warning' : 'bg-success'
                                }`}
                                style={{ width: `${Math.min((data.total / 50) * 100, 100)}%` }}
                              ></div>
                            </div>
                          </div>
                          
                          {/* قائمة الأجهزة */}
                          {data.devices.length > 0 && (
                            <div>
                              <small className="text-muted fw-bold">الأجهزة:</small>
                              <div className="mt-1">
                                {data.devices.slice(0, 3).map((device, idx) => (
                                  <span key={idx} className="badge bg-light text-dark me-1 mb-1 device-badge">
                                    <i className="fas fa-usb me-1"></i>
                                    {device.name || 'جهاز غير معروف'}
                                    <span className="ms-1">({device.power_consumption?.toFixed(1)}W)</span>
                                  </span>
                                ))}
                                {data.devices.length > 3 && (
                                  <span className="badge bg-secondary device-badge">
                                    +{data.devices.length - 3} أخرى
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* الأجهزة عالية الاستهلاك */}
      {powerData?.high_consumption_devices && powerData.high_consumption_devices.length > 0 && (
        <div className="row mb-4">
          <div className="col-12">
            <div className="card border-warning">
              <div className="card-header bg-warning text-dark">
                <h5 className="mb-0">
                  <i className="fas fa-exclamation-triangle me-2"></i>
                  الأجهزة عالية الاستهلاك
                </h5>
              </div>
              <div className="card-body">
                <div className="row">
                  {powerData.high_consumption_devices.map((device, index) => (
                    <div key={index} className="col-md-6 col-lg-4 mb-3">
                      <div className="card border-danger">
                        <div className="card-body">
                          <div className="d-flex justify-content-between align-items-start mb-2">
                            <div>
                              <h6 className="card-title mb-1">{device.name || 'جهاز غير معروف'}</h6>
                              <small className="text-muted">منفذ: {device.usb_port || 'غير محدد'}</small>
                            </div>
                            <span className="badge bg-danger">
                              {device.power_consumption?.toFixed(1)}W
                            </span>
                          </div>
                          
                          {/* شريط التقدم للطاقة */}
                          <div className="mb-2">
                            <div className="d-flex justify-content-between align-items-center mb-1">
                              <small className="text-muted">مستوى الاستهلاك</small>
                              <small className="text-muted">{((device.power_consumption / 10) * 100).toFixed(0)}%</small>
                            </div>
                            <div className="progress" style={{ height: '6px' }}>
                              <div 
                                className="progress-bar bg-danger"
                                style={{ width: `${Math.min((device.power_consumption / 10) * 100, 100)}%` }}
                              ></div>
                            </div>
                          </div>
                          
                          <div className="d-flex gap-2">
                            <button
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => {
                                toast.info('سيتم إضافة ميزة إيقاف الجهاز قريباً');
                              }}
                            >
                              <i className="fas fa-stop me-1"></i>
                              إيقاف الجهاز
                            </button>
                            <button
                              className="btn btn-sm btn-outline-info"
                              onClick={() => {
                                toast.info('سيتم إضافة ميزة تفاصيل الجهاز قريباً');
                              }}
                            >
                              <i className="fas fa-eye me-1"></i>
                              التفاصيل
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* معلومات النظام */}
      {powerData?.os && (
        <div className="row">
          <div className="col-12">
            <div className="card bg-light">
              <div className="card-body">
                <div className="d-flex align-items-center">
                  <i className="fas fa-desktop me-3 text-muted"></i>
                  <div>
                    <h6 className="mb-1">نظام التشغيل</h6>
                    <p className="mb-0 text-muted">{powerData.os}</p>
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

export default PowerMonitoring; 