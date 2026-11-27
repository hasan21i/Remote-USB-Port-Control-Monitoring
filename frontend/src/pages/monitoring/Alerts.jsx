// src/pages/monitoring/Alerts.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { 
  fetchAlerts, 
  fetchAlertStats, 
  resolveAlert, 
  resolveAllAlerts, 
  deleteAlert, 
  clearAllAlerts, 
  clearResolvedAlerts, 
  clearOldAlerts
} from '../../utils/api';
import AlertsTable from '../../components/AlertsTable';
import {
  FaClipboardList,
  FaCheckCircle,
  FaCheckDouble,
  FaSyncAlt,
  FaExclamationTriangle,
  FaFilter,
  FaShieldAlt,
  FaExclamationCircle,
  FaInfoCircle,
  FaTachometerAlt,
  FaChartLine,
  FaCog,
  FaDatabase
} from 'react-icons/fa';

const Alerts = () => {
  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState({ high: 0, normal: 0, low: 0 });
  const [summary, setSummary] = useState({ total: 0, resolved: 0, unresolved: 0 });
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [resolvingAll, setResolvingAll] = useState(false);

  const [filters, setFilters] = useState({
    priority: '',
    resolved: '',
    search: '',
    limit: 20,
    offset: 0,
    periodDays: 7,
  });

  const [refreshKey, setRefreshKey] = useState(0);
  const [escalations] = useState([]);
  const [escalationMsg, setEscalationMsg] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(false);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        priority: filters.priority || undefined,
        resolved: filters.resolved === '' ? undefined : filters.resolved === 'true',
        search: filters.search || undefined,
        limit: filters.limit,
        offset: filters.offset
      };
      const { alerts: list, total } = await fetchAlerts(params);
      setAlerts(list);
      setSummary(s => ({ ...s, total }));
    } catch (e) {
      console.error(e);
      setError('فشل في جلب قائمة التنبيهات');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setError(null);
    try {
      const res = await fetchAlertStats({ periodDays: filters.periodDays });
      
      setStats({
        high: res.by_priority?.high ?? 0,
        normal: res.by_priority?.normal ?? 0,
        low: res.by_priority?.low ?? 0
      });
      setSummary(s => ({
        ...s,
        resolved: res.resolved ?? 0,
        unresolved: res.unresolved ?? 0
      }));
    } catch (e) {
      setError('فشل في جلب إحصائيات التنبيهات');
    } finally {
      setStatsLoading(false);
    }
  }, [filters.periodDays]);

  useEffect(() => {
    loadStats();
    loadAlerts();
  }, [loadStats, loadAlerts, refreshKey]);

  useEffect(() => {
    const checkTheme = () => {
      const isDark = document.body.classList.contains('dark-mode') ||
                     document.documentElement.getAttribute('data-theme') === 'dark' ||
                     window.matchMedia('(prefers-color-scheme: dark)').matches;
      setIsDarkMode(isDark);
    };
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', checkTheme);
    return () => {
      observer.disconnect();
      window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', checkTheme);
    };
  }, []);

  // إخفاء الرسائل تلقائياً
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError(null);
        setSuccess(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  // استقبال broadcast التصعيدات (تم تعطيله مؤقتاً لحل مشكلة WebSocket)
  // useSocket('incident:escalation', data => {
  //   setEscalationMsg(`🚨 تصعيد أمني: ${data.message}`);
  //   setEscalations(escalations => [data, ...escalations]);
  //   setTimeout(() => setEscalationMsg(''), 15000);
  // });

  const updateFilter = (key, value) => {
    setFilters(f => ({ ...f, [key]: value, offset: 0 }));
  };

  const onResolve = async id => {
    if (!window.confirm('هل تريد حل هذا التنبيه؟')) return;
    try {
      await resolveAlert(id);
      setSuccess('تم حل التنبيه بنجاح');
      setRefreshKey(k => k + 1);
    } catch (err) {
      setError('فشل في حل التنبيه: ' + (err.response?.data?.error || err.message));
    }
  };

  const onResolveAll = async priority => {
    const label = priority ? 
      `ذات الأولوية ${priority === 'high' ? 'العالية' : priority === 'normal' ? 'المتوسطة' : 'المنخفضة'}` : 
      'جميع';
    if (!window.confirm(`هل تريد حل ${label} التنبيهات؟`)) return;
    setResolvingAll(true);
    try {
      const result = await resolveAllAlerts(priority || null);
      setSuccess(result.message || 'تم حل التنبيهات بنجاح');
      setRefreshKey(k => k + 1);
    } catch (err) {
      setError('فشل في حل التنبيهات: ' + (err.response?.data?.error || err.message));
    } finally {
      setResolvingAll(false);
    }
  };

  const onDelete = async id => {
    if (!window.confirm('هل تريد حذف هذا التنبيه نهائيًا؟')) return;
    setDeletingId(id);
    try {
      await deleteAlert(id);
      setSuccess('تم حذف التنبيه بنجاح');
      setRefreshKey(k => k + 1);
    } catch (err) {
      setError('فشل في حذف التنبيه: ' + (err.response?.data?.error || err.message));
    } finally {
      setDeletingId(null);
    }
  };

  const onClearAll = async () => {
    if (!window.confirm('هل تريد حذف جميع التنبيهات نهائيًا من قاعدة البيانات؟ لا يمكن التراجع عن هذا الإجراء.')) return;
    setLoading(true);
    try {
      const result = await clearAllAlerts();
      setSuccess(result.message || 'تم حذف جميع التنبيهات بنجاح');
      setRefreshKey(k => k + 1);
    } catch (err) {
      setError('فشل في حذف التنبيهات: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const onClearResolved = async () => {
    if (!window.confirm('هل تريد حذف جميع التنبيهات المحلولة نهائيًا من قاعدة البيانات؟')) return;
    setLoading(true);
    try {
      const result = await clearResolvedAlerts();
      setSuccess(result.message || 'تم حذف التنبيهات المحلولة بنجاح');
      setRefreshKey(k => k + 1);
    } catch (err) {
      setError('فشل في حذف التنبيهات المحلولة: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const onClearOld = async () => {
    if (!window.confirm('هل تريد حذف التنبيهات القديمة (أكثر من 30 يوم) نهائيًا من قاعدة البيانات؟')) return;
    setLoading(true);
    try {
      const result = await clearOldAlerts();
      setSuccess(result.message || 'تم حذف التنبيهات القديمة بنجاح');
      setRefreshKey(k => k + 1);
    } catch (err) {
      setError('فشل في حذف التنبيهات القديمة: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };



  const safeStats = { high: 0, normal: 0, low: 0, ...stats };

  return (
    <div className="container-fluid my-4">
      {/* Hero Header */}
      <div className="row mb-4">
        <div className="col-12">
          <div className="card bg-gradient-primary text-white border-0 shadow-lg">
            <div className="card-body py-4">
              <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
                <div>
                  <h1 className="h2 mb-2 fw-bold d-flex align-items-center">
                    <FaShieldAlt className="me-3" size={32} />
                    مركز التحكم في التنبيهات الأمنية
                  </h1>
                  <p className="mb-0 opacity-90" style={{ fontSize: '1.1rem' }}>
                    <FaTachometerAlt className="me-2" />
                    مراقبة وإدارة تنبيهات النظام في الوقت الفعلي
                  </p>
                </div>
                <div className="d-flex gap-2 flex-wrap">
                  <button
                    className="btn btn-light btn-lg shadow-sm"
                    onClick={() => setRefreshKey(k => k + 1)}
                    disabled={loading || deletingId !== null || resolvingAll}
                  >
                    <FaSyncAlt className="me-2" /> تحديث البيانات
                  </button>
                  <button
                    className="btn btn-success btn-lg shadow-sm"
                    onClick={() => onResolveAll()}
                    disabled={loading || deletingId !== null || resolvingAll || summary.unresolved === 0}
                  >
                    {resolvingAll ? (
                      <>
                        <div className="spinner-border spinner-border-sm me-2" role="status" />
                        جاري الحل...
                      </>
                    ) : (
                      <>
                        <FaCheckDouble className="me-2" /> حل جميع التنبيهات
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Database Management Cards */}
      <div className="d-flex flex-wrap justify-content-center gap-3 mb-4">
        {[
          { icon: 'fas fa-check-circle', label: 'مسح المحلولة', action: onClearResolved, disabled: loading },
          { icon: 'fas fa-calendar-alt', label: 'مسح القديمة (+30 يوم)', action: onClearOld, disabled: loading },
          { icon: 'fas fa-trash-alt', label: 'مسح الكل نهائياً', action: onClearAll, disabled: loading || summary.total === 0 }
        ].map((c, i) => {
          const gradients = isDarkMode ? [
            'linear-gradient(135deg, #4a5568 0%, #2d3748 100%)',
            'linear-gradient(135deg, #553c9a 0%, #44337a 100%)',
            'linear-gradient(135deg, #742a2a 0%, #553c9a 100%)'
          ] : [
            'linear-gradient(135deg, #e2e8f0 0%, #cbd5e0 100%)',
            'linear-gradient(135deg, #d6bcfa 0%, #b794f4 100%)',
            'linear-gradient(135deg, #fed7d7 0%, #feb2b2 100%)'
          ];
          return (
            <div key={i} className="flex-shrink-0">
              <div
                className="card border-0 shadow-sm"
                style={{
                  background: gradients[i],
                  borderRadius: '1.5rem',
                  minWidth: 170,
                  minHeight: 145,
                  maxWidth: 210,
                  margin: '0.3rem 0.4rem',
                  cursor: c.disabled ? 'not-allowed' : 'pointer'
                }}
                onClick={c.disabled ? undefined : c.action}
              >
                <div className="card-body p-4 d-flex flex-column justify-content-between text-center">
                  <div className="d-flex justify-content-center align-items-center mb-3">
                    <div className="rounded-circle p-2" style={{ backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
                      <i className={c.icon} style={{ fontSize: '18px', color: isDarkMode ? 'white' : 'black' }}></i>
                    </div>
                  </div>
                  <p className="mb-0" style={{ color: isDarkMode ? 'white' : 'black', fontSize: '14px', fontWeight: '500' }}>
                    {c.label}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Status Messages */}
      {(error || success || escalationMsg) && (
        <div className="row mb-4">
          <div className="col-12">
            {error && (
              <div className="alert alert-danger alert-dismissible fade show border-0 shadow-sm" role="alert">
                <FaExclamationTriangle className="me-2" />
                <strong>خطأ:</strong> {error}
                <button type="button" className="btn-close" onClick={() => setError(null)} />
              </div>
            )}
            {success && (
              <div className="alert alert-success alert-dismissible fade show border-0 shadow-sm" role="alert">
                <FaCheckCircle className="me-2" />
                <strong>نجح:</strong> {success}
                <button type="button" className="btn-close" onClick={() => setSuccess(null)} />
              </div>
            )}
            {escalationMsg && (
              <div className="alert alert-danger alert-dismissible fade show border-0 shadow-lg" role="alert">
                <FaShieldAlt className="me-2" />
                <strong>{escalationMsg}</strong>
                <button type="button" className="btn-close" onClick={() => setEscalationMsg('')} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* سجل التصعيدات المحسن */}
      {escalations.length > 0 && (
        <div className="row mb-4">
          <div className="col-12">
            <div className="card border-0 shadow-lg">
              <div className="card-header bg-danger text-white border-0">
                <div className="d-flex align-items-center justify-content-between">
                  <div>
                    <h5 className="mb-0 fw-bold">
                      <FaShieldAlt className="me-2" />
                      سجل التصعيدات الأمنية العاجلة
                    </h5>
                  </div>
                  <span className="badge bg-light text-danger fw-bold">{escalations.length}</span>
                </div>
              </div>
              <div className="card-body">
                <div className="list-group list-group-flush">
                  {escalations.slice(0, 3).map((e, i) => (
                    <div key={i} className="list-group-item border-0 px-0 py-3">
                      <div className="d-flex justify-content-between align-items-start">
                        <div className="flex-grow-1">
                          <h6 className="mb-2 text-danger fw-bold">
                            <FaExclamationCircle className="me-2" />
                            {e.message}
                          </h6>
                          <small className="text-muted">
                            <FaCog className="me-1" />
                            {new Date(e.timestamp).toLocaleString('ar-SA')}
                          </small>
                        </div>
                        <span className="badge bg-danger-subtle text-danger">عاجل</span>
                      </div>
                      {e.metadata && Object.keys(e.metadata).length > 0 && (
                        <div className="mt-3">
                          <button 
                            className="btn btn-outline-secondary btn-sm" 
                            type="button" 
                            data-bs-toggle="collapse" 
                            data-bs-target={`#metadata-${i}`}
                          >
                            <FaInfoCircle className="me-1" />
                            عرض التفاصيل التقنية
                          </button>
                          <div className="collapse mt-2" id={`metadata-${i}`}>
                            <div className="card card-body bg-light border-0">
                              <pre className="mb-0 small text-muted">{JSON.stringify(e.metadata, null, 2)}</pre>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {escalations.length > 3 && (
                  <div className="text-center mt-3 pt-3 border-top">
                    <small className="text-muted">
                      <FaDatabase className="me-1" />
                      و {escalations.length - 3} تصعيدات أخرى مسجلة
                    </small>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Statistics Cards */}
      <div className="d-flex flex-wrap justify-content-center gap-3 mb-4">
        {[
          { icon: 'fas fa-bell', label: 'إجمالي التنبيهات', value: summary.total },
          { icon: 'fas fa-check-circle', label: 'تنبيهات محلولة', value: summary.resolved },
          { icon: 'fas fa-exclamation-triangle', label: 'تنبيهات معلقة', value: summary.unresolved },
          { icon: 'fas fa-shield-alt', label: 'عالية الأولوية', value: safeStats.high },
          { icon: 'fas fa-exclamation-circle', label: 'متوسطة الأولوية', value: safeStats.normal },
          { icon: 'fas fa-info-circle', label: 'منخفضة الأولوية', value: safeStats.low }
        ].map((c, i) => {
          const gradients = isDarkMode ? [
            'linear-gradient(135deg, #4a5568 0%, #2d3748 100%)',
            'linear-gradient(135deg, #553c9a 0%, #44337a 100%)',
            'linear-gradient(135deg, #2c5282 0%, #2a4365 100%)',
            'linear-gradient(135deg, #744210 0%, #553c9a 100%)',
            'linear-gradient(135deg, #276749 0%, #2c5282 100%)',
            'linear-gradient(135deg, #2d3748 0%, #4a5568 100%)'
          ] : [
            'linear-gradient(135deg, #e2e8f0 0%, #cbd5e0 100%)',
            'linear-gradient(135deg, #d6bcfa 0%, #b794f4 100%)',
            'linear-gradient(135deg, #bee3f8 0%, #90cdf4 100%)',
            'linear-gradient(135deg, #fefcbf 0%, #faf089 100%)',
            'linear-gradient(135deg, #c6f6d5 0%, #9ae6b4 100%)',
            'linear-gradient(135deg, #fed7d7 0%, #feb2b2 100%)'
          ];
          return (
            <div key={i} className="flex-shrink-0">
              <div className="card border-0 shadow-sm" style={{
                background: gradients[i],
                borderRadius: '1.5rem',
                minWidth: 170,
                minHeight: 145,
                maxWidth: 210,
                margin: '0.3rem 0.4rem'
              }}>
                <div className="card-body p-4 d-flex flex-column justify-content-between text-center">
                  <div className="d-flex justify-content-center align-items-center mb-3">
                    <div className="rounded-circle p-2" style={{ backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
                      <i className={c.icon} style={{ fontSize: '18px', color: isDarkMode ? 'white' : 'black' }}></i>
                    </div>
                  </div>
                  <p className="mb-2" style={{ color: isDarkMode ? 'white' : 'black', fontSize: '14px', fontWeight: '500' }}>
                    {c.label}
                  </p>
                  {statsLoading
                    ? <div className="spinner-border spinner-border-sm" role="status" style={{ color: isDarkMode ? 'white' : 'black' }} />
                    : <h2 className="fw-bold mb-0" style={{ color: isDarkMode ? 'white' : 'black', fontSize: '32px' }}>{c.value}</h2>
                  }
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Advanced Filters Panel */}
      <div className="row mb-4">
        <div className="col-12">
          <div className="card border-0 shadow-lg">
            <div className="card-header bg-light border-0">
              <div className="d-flex align-items-center justify-content-between">
                <h6 className="mb-0 fw-bold text-secondary">
                  <FaFilter className="me-2" />
                  لوحة التحكم في الفلاتر والبحث المتقدم
                </h6>
                <FaChartLine className="text-muted" />
              </div>
            </div>
            <div className="card-body bg-light bg-opacity-50">
              <div className="row g-3 align-items-end">
                <div className="col-lg-2 col-md-3 col-sm-6">
                  <label className="form-label small fw-bold text-dark">
                    <FaCog className="me-1" />
                    فترة العرض (أيام)
                  </label>
                  <input
                    type="number" 
                    min="1" 
                    max="365" 
                    className="form-control form-control-lg shadow-sm"
                    value={filters.periodDays}
                    onChange={e => updateFilter('periodDays', +e.target.value)}
                    disabled={loading || deletingId !== null}
                  />
                </div>
                <div className="col-lg-2 col-md-3 col-sm-6">
                  <label className="form-label small fw-bold text-dark">
                    <FaExclamationTriangle className="me-1" />
                    مستوى الأولوية
                  </label>
                  <select
                    className="form-select form-select-lg shadow-sm"
                    value={filters.priority}
                    onChange={e => updateFilter('priority', e.target.value)}
                    disabled={loading || deletingId !== null}
                  >
                    <option value="">جميع المستويات</option>
                    <option value="high">🔴 عالية</option>
                    <option value="normal">🟡 متوسطة</option>
                    <option value="low">🔵 منخفضة</option>
                  </select>
                </div>
                <div className="col-lg-2 col-md-3 col-sm-6">
                  <label className="form-label small fw-bold text-dark">
                    <FaCheckCircle className="me-1" />
                    حالة التنبيه
                  </label>
                  <select
                    className="form-select form-select-lg shadow-sm"
                    value={filters.resolved}
                    onChange={e => updateFilter('resolved', e.target.value)}
                    disabled={loading || deletingId !== null}
                  >
                    <option value="">جميع الحالات</option>
                    <option value="false">⏸️ غير محلولة</option>
                    <option value="true">✅ محلولة</option>
                  </select>
                </div>
                <div className="col-lg-4 col-md-3 col-sm-6">
                  <label className="form-label small fw-bold text-dark">
                    <FaDatabase className="me-1" />
                    البحث النصي المتقدم
                  </label>
                  <input
                    type="text" 
                    className="form-control form-control-lg shadow-sm"
                    value={filters.search}
                    onChange={e => updateFilter('search', e.target.value)}
                    disabled={loading || deletingId !== null}
                    placeholder="🔍 ابحث في رسائل التنبيهات، الأجهزة، أو المعرفات..."
                  />
                </div>
                <div className="col-lg-2 col-md-12">
                  <button
                    className="btn btn-outline-secondary btn-lg w-100 shadow-sm"
                    onClick={() => setFilters({
                      priority: '',
                      resolved: '',
                      search: '',
                      limit: 20,
                      offset: 0,
                      periodDays: 7,
                    })}
                    disabled={loading}
                  >
                    <FaSyncAlt className="me-2" />
                    إعادة تعيين
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Enhanced Alerts Table */}
      <div className="row">
        <div className="col-12">
          <div className="card border-0 shadow-lg">
            <div className="card-header bg-white border-0 py-3">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <h5 className="mb-1 fw-bold text-dark">
                    <FaClipboardList className="me-2 text-primary" />
                    جدول التنبيهات التفصيلي
                  </h5>
                  <small className="text-muted">
                    <FaDatabase className="me-1" />
                    إجمالي النتائج: <span className="fw-bold text-primary">{summary.total}</span> تنبيه
                  </small>
                </div>
                {loading && (
                  <div className="d-flex align-items-center">
                    <div className="spinner-border spinner-border-sm text-primary me-2" role="status" />
                    <small className="text-muted">جاري التحديث...</small>
                  </div>
                )}
              </div>
            </div>
            <div className="card-body p-0">
              <AlertsTable
                data={alerts}
                loading={loading}
                onResolve={onResolve}
                onDelete={onDelete}
                deletingId={deletingId}
                pagination={{
                  limit: filters.limit,
                  offset: filters.offset,
                  total: summary.total,
                  onPageChange: newOffset => updateFilter('offset', newOffset)
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Alerts;

