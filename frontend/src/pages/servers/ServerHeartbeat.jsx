// src/pages/servers/ServerHeartbeat.jsx

import React, { useEffect, useState } from 'react';
import { serverHeartbeat, fetchServers } from '../../utils/api';
import { formatDateTime, isServerOnline } from '../../utils/formatters';
import { toast } from 'react-toastify';
import HeartbeatChart from '../../components/HeartbeatChart';

const ServerHeartbeat = () => {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState(null);
  const [heartbeatResults, setHeartbeatResults] = useState({});
  const [showChart, setShowChart] = useState(false);
  const [selectedServer, setSelectedServer] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return document.documentElement.getAttribute('data-bs-theme') === 'dark';
  });

  // جلب قائمة السيرفرات
  useEffect(() => {
    const loadServers = async () => {
      try {
        setLoading(true);
        const response = await fetchServers();
        setServers(response.servers || []);
      } catch (error) {
        console.error('Error loading servers:', error);
        toast.error('فشل في تحميل قائمة السيرفرات');
      } finally {
        setLoading(false);
      }
    };

    loadServers();
  }, []);

  // اختبار نبض السيرفر
  const handleHeartbeat = async (server) => {
    setTestingId(server.id);
    
    try {
      // إظهار رسوم القلب (نبض) لمدة ثانية
      setHeartbeatResults(prev => ({
        ...prev,
        [server.id]: { status: 'testing', message: 'جاري الاختبار...' }
      }));

      const result = await serverHeartbeat(server.id);
      
      // نجح الاختبار
      const responseTime = result.response_time_ms ? ` (${Math.round(result.response_time_ms)}ms)` : '';
      setHeartbeatResults(prev => ({
        ...prev,
        [server.id]: { 
          status: 'success', 
          message: `نجح الاتصال!${responseTime}`,
          timestamp: new Date()
        }
      }));
      
      toast.success(`نجح اختبار نبض السيرفر ${server.name}`);
      
      // تحديث قائمة السيرفرات لعرض الحالة الجديدة
      try {
        const response = await fetchServers();
        setServers(response.servers || []);
      } catch (e) { /* تجاهل */ }
      
    } catch (error) {
      // فشل الاختبار - استخراج رسالة الخطأ من الباكند
      const errorData = error.response?.data;
      const errorMessage = errorData?.message || errorData?.error || 'فشل الاتصال!';
      
      setHeartbeatResults(prev => ({
        ...prev,
        [server.id]: { 
          status: 'failed', 
          message: errorMessage,
          timestamp: new Date()
        }
      }));
      
      toast.error(`فشل اختبار نبض السيرفر ${server.name}: ${errorMessage}`);
      
      // تحديث قائمة السيرفرات لعرض الحالة الجديدة
      try {
        const response = await fetchServers();
        setServers(response.servers || []);
      } catch (e) { /* تجاهل */ }
      
    } finally {
      setTestingId(null);
    }
  };

  // تحديد لون الحالة
  const getStatusColor = (server) => {
    return isServerOnline(server) ? 'text-success' : 'text-danger';
  };

  // تحديد نص الحالة
  const getStatusText = (server) => {
    return isServerOnline(server) ? 'متصل' : 'غير متصل';
  };

  // فتح مخطط النبض
  const openHeartbeatChart = (server) => {
    setSelectedServer(server);
    setShowChart(true);
  };

  // إغلاق مخطط النبض
  const closeHeartbeatChart = () => {
    setShowChart(false);
    setSelectedServer(null);
  };

  // مراقبة تغيير الثيم
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.getAttribute('data-bs-theme') === 'dark');
    });
    
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-bs-theme']
    });
    
    return () => observer.disconnect();
  }, []);

  return (
    <div className="container-fluid py-4">
      <div className="row">
        <div className="col-12">
          <div className="card shadow-sm">
            <div className="card-header bg-primary text-white">
              <h4 className="mb-0">
                <i className="fas fa-heartbeat me-2"></i>
                مراقبة نبض السيرفرات
              </h4>
              <small>اختبار حالة الاتصال مع السيرفرات المتاحة</small>
            </div>
            
            <div className="card-body">
              {loading ? (
                <div className="text-center py-5">
                  <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">جاري التحميل...</span>
                  </div>
                  <p className="mt-2 text-muted">جاري تحميل قائمة السيرفرات...</p>
                </div>
              ) : servers.length === 0 ? (
                <div className="text-center py-5">
                  <i className="fas fa-server fa-3x text-muted mb-3"></i>
                  <p className="text-muted">لا توجد سيرفرات متاحة</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover align-middle">
                    <thead className="table-dark">
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">اسم السيرفر</th>
                        <th scope="col">عنوان IP</th>
                        <th scope="col">نظام التشغيل</th>
                        <th scope="col">المعالج</th>
                        <th scope="col">الذاكرة</th>
                        <th scope="col">الحالة</th>
                        <th scope="col">آخر نبضة</th>
                        <th scope="col">الإجراء</th>
                        <th scope="col">نتيجة الاختبار</th>
                      </tr>
                    </thead>
                    <tbody>
                      {servers.map((server, index) => (
                        <tr key={server.id}>
                          <td>{index + 1}</td>
                          <td>
                            <strong>{server.name}</strong>
                          </td>
                          <td>
                            <code className="bg-light px-2 py-1 rounded">
                              {server.ip_address || 'غير محدد'}
                            </code>
                          </td>
                          <td>{server.os || 'غير محدد'}</td>
                          <td>{server.cpu || 'غير محدد'}</td>
                          <td>{server.ram || 'غير محدد'}</td>
                          <td>
                            <span className={`fw-bold ${getStatusColor(server)}`}>
                              <i className={`fas fa-circle me-1 ${isServerOnline(server) ? 'text-success' : 'text-danger'}`}></i>
                              {getStatusText(server)}
                            </span>
                          </td>
                          <td>
                            {server.last_heartbeat ? 
                              formatDateTime(server.last_heartbeat) : 
                              <span className="text-muted">لا يوجد</span>
                            }
                          </td>
                          <td>
                            <div className="d-flex gap-1">
                              <button
                                className="btn btn-outline-primary btn-sm"
                                onClick={() => handleHeartbeat(server)}
                                disabled={testingId === server.id}
                              >
                                {testingId === server.id ? (
                                  <>
                                    <span className="spinner-border spinner-border-sm me-1" role="status"></span>
                                    <i className="fas fa-heartbeat text-danger heartbeat-animation"></i>
                                  </>
                                ) : (
                                  <>
                                    <i className="fas fa-heartbeat me-1"></i>
                                    اختبار النبض
                                  </>
                                )}
                              </button>
                              
                              <button
                                className="btn btn-outline-success btn-sm"
                                onClick={() => openHeartbeatChart(server)}
                                title="عرض مخطط النبض المباشر"
                              >
                                <i className="fas fa-chart-line me-1"></i>
                                مخطط النبض
                              </button>
                            </div>
                          </td>
                          <td>
                            {heartbeatResults[server.id] && (
                              <div className={`small ${
                                heartbeatResults[server.id].status === 'success' ? 'text-success' :
                                heartbeatResults[server.id].status === 'failed' ? 'text-danger' :
                                'text-info'
                              }`}>
                                <i className={`fas ${
                                  heartbeatResults[server.id].status === 'success' ? 'fa-check-circle' :
                                  heartbeatResults[server.id].status === 'failed' ? 'fa-times-circle' :
                                  'fa-spinner fa-spin'
                                } me-1`}></i>
                                {heartbeatResults[server.id].message}
                                {heartbeatResults[server.id].timestamp && (
                                  <div className="text-muted" style={{fontSize: '0.7rem'}}>
                                    {formatDateTime(heartbeatResults[server.id].timestamp)}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* مخطط النبض المباشر */}
      {showChart && selectedServer && (
        <HeartbeatChart
          serverName={selectedServer.name}
          isActive={isServerOnline(selectedServer)}
          onClose={closeHeartbeatChart}
          isDarkMode={isDarkMode}
        />
      )}

      {/* إضافة CSS للرسوم المتحركة */}
      <style dangerouslySetInnerHTML={{
        __html: `
          .heartbeat-animation {
            animation: heartbeat 1s ease-in-out infinite;
          }
          
          @keyframes heartbeat {
            0% {
              transform: scale(1);
            }
            14% {
              transform: scale(1.3);
            }
            28% {
              transform: scale(1);
            }
            42% {
              transform: scale(1.3);
            }
            70% {
              transform: scale(1);
            }
          }
        `
      }} />
    </div>
  );
};

export default ServerHeartbeat;
