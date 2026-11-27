// src/pages/servers/ServerDetails.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchServer, serverHeartbeat } from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import {
  FaServer, FaNetworkWired, FaSpinner, FaArrowRight,
  FaHeartbeat, FaClock, FaMemory, FaMicrochip, FaMapMarkerAlt,
  FaCopy, FaSync, FaInfoCircle, FaDesktop
} from 'react-icons/fa';
import { formatDateTime, isServerOnline, getServerStatusText } from '../../utils/formatters';
import { toast } from 'react-toastify';

const ServerDetails = () => {
  const navigate = useNavigate();
  const { id: serverId } = useParams(); // الحصول على معرف الخادم من URL

  // الحالات الأساسية
  const [server, setServer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [heartbeatLoading, setHeartbeatLoading] = useState(false);
  const [error, setError] = useState('');

  // جلب تفاصيل الخادم
  const loadServerDetails = useCallback(async () => {
    if (!serverId) {
      setError('معرف الخادم مطلوب');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError('');
      const response = await fetchServer(serverId);
      const serverData = response?.server || response?.data || response;
      setServer(serverData);
    } catch (err) {
      console.error('Error loading server details:', err);
      setError('فشل في تحميل تفاصيل الخادم');
      setServer(null);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  // تشغيل heartbeat للخادم
  const handleHeartbeat = useCallback(async () => {
    if (!serverId) return;

    try {
      setHeartbeatLoading(true);
      await serverHeartbeat(serverId);
      toast.success('تم إرسال نبضة الحياة بنجاح - السيرفر متصل');

      // إعادة تحميل تفاصيل الخادم
      await loadServerDetails();
    } catch (err) {
      console.error('Heartbeat error:', err);
      const errorData = err.response?.data;
      const errorMessage = errorData?.message || errorData?.error || 'فشل في إرسال نبضة الحياة';
      toast.error(errorMessage);
      
      // إعادة تحميل تفاصيل الخادم لعرض الحالة المحدثة
      await loadServerDetails();
    } finally {
      setHeartbeatLoading(false);
    }
  }, [serverId, loadServerDetails]);

  // تحميل البيانات عند تحميل المكون أو تغيير معرف الخادم
  useEffect(() => {
    loadServerDetails();
  }, [loadServerDetails]);

  // دالة mapping لحالة الخادم
  const mapServerStatusToBadgeStatus = (serverStatus, isOnline) => {
    if (isOnline === true) {
      return 'connected';
    }
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
        return 'disconnected';
    }
  };

  // دالة ذكية لعرض حالة الاتصال
  const getConnectionStatus = (server) => {
    const isCurrentlyOnline = isServerOnline(server);

    // إذا كان متصل حالياً
    if (isCurrentlyOnline) {
      return {
        text: 'متصل حالياً',
        className: 'text-success fw-bold',
        icon: '🟢'
      };
    }

    // إذا كان غير متصل، نتحقق من آخر وقت اتصال
    const lastConnection = server.last_connection || server.last_heartbeat;

    if (lastConnection) {
      const lastConnTime = new Date(lastConnection);
      const now = new Date();
      const diffMs = now - lastConnTime;
      const diffMins = Math.floor(diffMs / (1000 * 60));

      // إذا كان آخر اتصال قريب (أقل من 5 دقائق) نعتبره متصل مؤقتاً
      if (diffMins < 5) {
        return {
          text: 'متصل (آخر نشاط مؤخراً)',
          className: 'text-success',
          icon: '🟡'
        };
      }

      // إذا كان أكثر من 5 دقائق، نعرض آخر وقت اتصال
      return {
        text: formatDateTime(lastConnection),
        className: 'text-muted',
        icon: '🔴'
      };
    }

    // إذا لم يكن هناك أي سجل اتصال
    return {
      text: 'لم يتصل مطلقاً',
      className: 'text-warning fw-bold',
      icon: '⚠️'
    };
  };

  // Loading State
  if (loading) {
    return (
      <div className="container-fluid py-4">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <div>
            <h2 className="mb-1">
              <FaServer className="me-2 text-primary" />
              تفاصيل الخادم
            </h2>
            <p className="text-muted mb-0">جاري تحميل معلومات الخادم...</p>
          </div>

          <button
            className="btn btn-secondary"
            onClick={() => navigate('/servers')}
          >
            <FaArrowRight className="me-1" />
            العودة للقائمة
          </button>
        </div>

        <div className="card border-0 shadow-sm">
          <div className="card-body d-flex justify-content-center align-items-center" style={{ minHeight: '400px' }}>
            <div className="text-center">
              <FaSpinner className="fa-spin fa-3x mb-3 text-primary" />
              <p>جاري تحميل تفاصيل الخادم...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error State
  if (error || !server) {
    return (
      <div className="container-fluid py-4">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <div>
            <h2 className="mb-1">
              <FaServer className="me-2 text-primary" />
              تفاصيل الخادم
            </h2>
            <p className="text-muted mb-0">حدث خطأ في تحميل معلومات الخادم</p>
          </div>

          <button
            className="btn btn-secondary"
            onClick={() => navigate('/servers')}
          >
            <FaArrowRight className="me-1" />
            العودة للقائمة
          </button>
        </div>

        <div className="card border-0 shadow-sm">
          <div className="card-body d-flex justify-content-center align-items-center" style={{ minHeight: '400px' }}>
            <div className="text-center text-muted">
              <FaInfoCircle size={64} className="mb-3 opacity-50" />
              <h5>{error || 'الخادم غير موجود'}</h5>
              <p>تأكد من صحة معرف الخادم أو عد إلى قائمة الخوادم</p>
              <button
                className="btn btn-primary mt-3"
                onClick={() => navigate('/servers')}
              >
                <FaArrowRight className="me-1" />
                العودة إلى قائمة الخوادم
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main Content
  return (
    <div className="container-fluid py-4">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1">
            <FaServer className="me-2 text-primary" />
            تفاصيل الخادم - {server.name || `خادم ${server.id}`}
          </h2>
          <p className="text-muted mb-0">معلومات شاملة عن الخادم المحدد</p>
        </div>

        <div className="d-flex gap-2">
          <button
            className="btn btn-outline-primary"
            onClick={loadServerDetails}
            disabled={loading}
          >
            {loading ? (
              <FaSpinner className="fa-spin me-1" />
            ) : (
              <FaSync className="me-1" />
            )}
            تحديث
          </button>

          <button
            className="btn btn-secondary"
            onClick={() => navigate('/servers')}
          >
            <FaArrowRight className="me-1" />
            العودة للقائمة
          </button>
        </div>
      </div>

      {/* Server Details Card */}
      <div className="card border-0 shadow-sm">
        <div className="card-header bg-gradient-primary text-white">
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <h4 className="mb-1">
                <FaServer className="me-2" />
                {server.name || `خادم ${server.id}`}
              </h4>
              <div className="d-flex align-items-center">
                <StatusBadge
                  status={mapServerStatusToBadgeStatus(server.status, isServerOnline(server))}
                  size="sm"
                />
                <span className="ms-2">
                  {getServerStatusText(server)}
                </span>
              </div>
            </div>
            <button
              className="btn btn-light btn-sm"
              onClick={handleHeartbeat}
              disabled={heartbeatLoading}
            >
              {heartbeatLoading ? (
                <FaSpinner className="fa-spin me-1" />
              ) : (
                <FaHeartbeat className="me-1" />
              )}
              نبضة الحياة
            </button>
          </div>
        </div>

        <div className="card-body">
          <div className="row g-4">
            {/* معلومات الشبكة */}
            <div className="col-md-6">
              <div className="card border-primary h-100">
                <div className="card-header bg-primary bg-opacity-10">
                  <h6 className="mb-0">
                    <FaNetworkWired className="me-2 text-primary" />
                    معلومات الشبكة
                  </h6>
                </div>
                <div className="card-body">
                  <div className="mb-3">
                    <label className="form-label fw-bold">عنوان IP:</label>
                    <div className="d-flex align-items-center">
                      <span className="me-2">{server.ip_address || server.ip || 'غير محدد'}</span>
                      {(server.ip_address || server.ip) && (
                        <button
                          className="btn btn-outline-primary btn-sm"
                          onClick={() => navigator.clipboard.writeText(server.ip_address || server.ip)}
                        >
                          <FaCopy />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-bold">المنفذ:</label>
                    <span className="ms-2">{server.port || '22'}</span>
                  </div>

                  {server.location && (
                    <div className="mb-3">
                      <label className="form-label fw-bold">الموقع:</label>
                      <div className="d-flex align-items-center">
                        <FaMapMarkerAlt className="me-1 text-danger" />
                        <span>{server.location}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* معلومات النظام */}
            <div className="col-md-6">
              <div className="card border-success h-100">
                <div className="card-header bg-success bg-opacity-10">
                  <h6 className="mb-0">
                    <FaDesktop className="me-2 text-success" />
                    معلومات النظام
                  </h6>
                </div>
                <div className="card-body">
                  <div className="mb-3">
                    <label className="form-label fw-bold">نظام التشغيل:</label>
                    <span className="ms-2">{server.os || 'غير محدد'}</span>
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-bold">المعالج:</label>
                    <div className="d-flex align-items-center">
                      <FaMicrochip className="me-1 text-info" />
                      <span>{server.cpu || 'غير محدد'}</span>
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label fw-bold">الذاكرة:</label>
                    <div className="d-flex align-items-center">
                      <FaMemory className="me-1 text-warning" />
                      <span>{server.ram || 'غير محدد'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* معلومات الحالة والزمن */}
            <div className="col-12">
              <div className="card border-info">
                <div className="card-header bg-info bg-opacity-10">
                  <h6 className="mb-0">
                    <FaClock className="me-2 text-info" />
                    معلومات الحالة والزمن
                  </h6>
                </div>
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label fw-bold">آخر نبضة حياة:</label>
                      <p className="mb-0">
                        {server.last_heartbeat ?
                          formatDateTime(server.last_heartbeat) :
                          <span className="text-muted">لا توجد</span>
                        }
                      </p>
                    </div>

                    <div className="col-md-6">
                      <label className="form-label fw-bold">حالة الاتصال:</label>
                      <div className="d-flex align-items-center">
                        <span className="me-2 fs-5">{getConnectionStatus(server).icon}</span>
                        <div>
                          <span className={`${getConnectionStatus(server).className}`}>
                            {getConnectionStatus(server).text.includes('متصل') ?
                              getConnectionStatus(server).text :
                              `آخر اتصال: ${getConnectionStatus(server).text}`
                            }
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="col-md-6">
                      <label className="form-label fw-bold">تاريخ الإنشاء:</label>
                      <p className="mb-0">
                        {server.created_at ?
                          formatDateTime(server.created_at) :
                          <span className="text-muted">غير محدد</span>
                        }
                      </p>
                    </div>

                    <div className="col-md-6">
                      <label className="form-label fw-bold">مدة التشغيل:</label>
                      <p className="mb-0">
                        {server.last_heartbeat ? (
                          (() => {
                            const lastHeartbeat = new Date(server.last_heartbeat);
                            const now = new Date();
                            const diffMs = now - lastHeartbeat;
                            const diffMins = Math.floor(diffMs / (1000 * 60));

                            if (diffMins < 5) {
                              return <span className="text-success">نشط (أقل من 5 دقائق)</span>;
                            } else if (diffMins < 60) {
                              return <span className="text-warning">آخر نشاط قبل {diffMins} دقيقة</span>;
                            } else if (diffMins < 1440) {
                              const hours = Math.floor(diffMins / 60);
                              return <span className="text-danger">آخر نشاط قبل {hours} ساعة</span>;
                            } else {
                              const days = Math.floor(diffMins / 1440);
                              return <span className="text-danger">آخر نشاط قبل {days} يوم</span>;
                            }
                          })()
                        ) : (
                          <span className="text-muted">غير محدد</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* معلومات إضافية إن وجدت */}
            {(server.description || server.tags) && (
              <div className="col-12">
                <div className="card border-warning">
                  <div className="card-header bg-warning bg-opacity-10">
                    <h6 className="mb-0">
                      <FaInfoCircle className="me-2 text-warning" />
                      معلومات إضافية
                    </h6>
                  </div>
                  <div className="card-body">
                    {server.description && (
                      <div className="mb-3">
                        <label className="form-label fw-bold">الوصف:</label>
                        <p className="mb-0">{server.description}</p>
                      </div>
                    )}

                    {server.tags && (
                      <div>
                        <label className="form-label fw-bold">العلامات:</label>
                        <div className="d-flex flex-wrap gap-1">
                          {server.tags.split(',').map((tag, index) => (
                            <span key={index} className="badge bg-secondary">
                              {tag.trim()}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Custom Styles */}
      <style>{`
        .bg-gradient-primary {
          background: linear-gradient(135deg, var(--success-color) 0%, var(--secondary-color) 50%, var(--secondary-color) 100%) !important;
        }
        
        .card {
          transition: all 0.3s ease;
        }
        
        .card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 15px rgba(0,0,0,0.1) !important;
        }
      `}</style>
    </div>
  );
};

export default ServerDetails;