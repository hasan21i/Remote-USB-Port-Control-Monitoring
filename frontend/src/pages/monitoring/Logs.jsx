import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchLogStats, clearLogs, clearAllLogs, sendUsbTransferLog } from '../../utils/api';
import LogTable from '../../components/LogTable';
import Modal from '../../components/Modal';

const LOG_CLEAR_CHOICES = [30, 90, 180, 365];

const Logs = () => {
  const [stats, setStats]               = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [error, setError]               = useState(null);
  const [isDarkMode, setIsDarkMode]     = useState(false);

  const [showClearModal, setShowClearModal]       = useState(false);
  const [clearDays, setClearDays]                 = useState(LOG_CLEAR_CHOICES[0]);
  const [clearLoading, setClearLoading]           = useState(false);
  const [clearMessage, setClearMessage]           = useState('');

  const [showClearAllModal, setShowClearAllModal] = useState(false);
  const [clearAllLoading, setClearAllLoading]     = useState(false);
  const [clearAllMessage, setClearAllMessage]     = useState('');

  // نموذج إرسال سجل نقل بيانات USB يدوي
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [transferForm, setTransferForm] = useState({ serial_number: '', user_id: '', transfer_size: '', transfer_type: 'read', filename: '', geo_location: null });
  const [transferMsg, setTransferMsg] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);
  const [geoStatus, setGeoStatus] = useState('');
  const handleTransferChange = e => setTransferForm(f => ({ ...f, [e.target.name]: e.target.value }));
  const handleSendTransfer = async e => {
    e.preventDefault();
    setTransferLoading(true);
    setTransferMsg('');
    try {
      await sendUsbTransferLog({
        serial_number: transferForm.serial_number,
        user_id: transferForm.user_id,
        transfer_size: parseInt(transferForm.transfer_size),
        transfer_type: transferForm.transfer_type,
        filename: transferForm.filename,
        geo_location: transferForm.geo_location
      });
      setTransferMsg('تم إرسال سجل النقل بنجاح');
      setTransferForm({ serial_number: '', user_id: '', transfer_size: '', transfer_type: 'read', filename: '', geo_location: null });
      setTimeout(() => setShowTransferForm(false), 1200);
    } catch (err) {
      setTransferMsg('فشل في إرسال السجل: ' + (err.message || 'خطأ غير معروف'));
    } finally {
      setTransferLoading(false);
    }
  };
  // جلب الموقع الجغرافي من المتصفح
  const handleGetLocation = () => {
    setGeoStatus('جاري تحديد الموقع...');
    if (!navigator.geolocation) {
      setGeoStatus('المتصفح لا يدعم تحديد الموقع');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setTransferForm(f => ({ ...f, geo_location: { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy } }));
        setGeoStatus('تم تحديد الموقع بنجاح');
      },
      err => {
        setGeoStatus('تعذر تحديد الموقع: ' + err.message);
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  };

  // Load stats from server
  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    setError(null);
    try {
      const resp = await fetchLogStats();
      setStats({
        total:         resp.total_logs ?? 0,
        recent:        resp.recent_logs ?? 0,
        security:      resp.top_actions?.reduce(
                          (sum, a) =>
                            /block|denied|error|warning/.test(a.action)
                              ? sum + a.count
                              : sum,
                          0
                        ) ?? 0,
        topUsers:      resp.top_users ?? [],
        topDevices:    resp.top_devices ?? [],
        topActions:    resp.top_actions ?? [],
        days:          resp.period_days ?? 7
      });
    } catch {
      setError('فشل في جلب إحصائيات السجلات');
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    const iv = setInterval(loadStats, 60_000);
    return () => clearInterval(iv);
  }, [loadStats]);

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

  // Clear older logs
  const handleClearLogs = async () => {
    setClearLoading(true);
    setClearMessage('');
    try {
      const res = await clearLogs(clearDays);
      setClearMessage(res.message ?? `تم حذف ${res.logs_deleted ?? 0} سجل`);
      await loadStats();
      setTimeout(() => setShowClearModal(false), 1500);
    } catch {
      setError('فشل في مسح السجلات');
    } finally {
      setClearLoading(false);
    }
  };

  // Clear all logs
  const handleClearAll = async () => {
    setClearAllLoading(true);
    setClearAllMessage('');
    try {
      const res = await clearAllLogs();
      setClearAllMessage(res.message ?? 'تم حذف جميع السجلات');
      await loadStats();
      setTimeout(() => setShowClearAllModal(false), 1500);
    } catch {
      setError('فشل في مسح جميع السجلات');
    } finally {
      setClearAllLoading(false);
    }
  };

  // Statistics cards
  const statCards = useMemo(() => [
    { color: 'primary', icon: 'fas fa-database', label: 'إجمالي السجلات',            value: stats?.total  ?? '--', loading: loadingStats },
    { color: 'info',    icon: 'fas fa-clock',    label: `سجلات آخر ${stats?.days} يوم`, value: stats?.recent ?? '--', loading: loadingStats },
    { color: 'warning', icon: 'fas fa-shield-alt',label: 'أحداث أمنية',             value: stats?.security ?? '--', loading: loadingStats }
  ], [stats, loadingStats]);

  return (
    <div className="logs-page container my-5">
      <header className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
        <div>
          <h1 className="fw-bold mb-1">
            <i className="fas fa-clipboard-list me-2 text-primary" /> سجلات النشاط
          </h1>
          <p className="text-muted mb-0">عرض وتحليل نشاطات النظام بتفصيل متقدم</p>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <button className="btn btn-primary" onClick={() => setShowTransferForm(f => !f)}>
            <i className="fas fa-plus me-1" /> إضافة سجل نقل USB يدوي
          </button>
          <button className="btn btn-danger" onClick={() => setShowClearModal(true)}>
            <i className="fas fa-trash-alt me-1" /> مسح القديم
          </button>
          <button className="btn btn-outline-danger" onClick={() => setShowClearAllModal(true)}>
            <i className="fas fa-trash me-1" /> مسح الكل
          </button>
        </div>
      </header>

      {error && (
        <div className="alert alert-danger mb-3" role="alert">
          <i className="fas fa-exclamation-triangle me-1" /> {error}
        </div>
      )}

      {showTransferForm && (
        <div className="card card-body mb-4 border-primary shadow-sm">
          <form className="row g-2 align-items-end" onSubmit={handleSendTransfer}>
            <div className="col-md-2">
              <label className="form-label">Serial Number</label>
              <input name="serial_number" className="form-control" value={transferForm.serial_number} onChange={handleTransferChange} required />
            </div>
            <div className="col-md-2">
              <label className="form-label">User ID</label>
              <input name="user_id" className="form-control" value={transferForm.user_id} onChange={handleTransferChange} required />
            </div>
            <div className="col-md-2">
              <label className="form-label">حجم النقل (bytes)</label>
              <input name="transfer_size" type="number" className="form-control" value={transferForm.transfer_size} onChange={handleTransferChange} required min="1" />
            </div>
            <div className="col-md-2">
              <label className="form-label">نوع النقل</label>
              <select name="transfer_type" className="form-select" value={transferForm.transfer_type} onChange={handleTransferChange} required>
                <option value="read">قراءة</option>
                <option value="write">كتابة</option>
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label">اسم الملف (اختياري)</label>
              <input name="filename" className="form-control" value={transferForm.filename} onChange={handleTransferChange} />
            </div>
            <div className="col-md-2 d-flex align-items-end gap-2">
              <button className="btn btn-outline-info w-100" type="button" onClick={handleGetLocation}>
                <i className="fas fa-map-marker-alt me-1" /> تحديد موقعي
              </button>
            </div>
            {transferForm.geo_location && (
              <div className="col-md-3 d-flex align-items-end">
                <span className="badge bg-success">
                  {`Lat: ${transferForm.geo_location.lat}, Lon: ${transferForm.geo_location.lon}`}
                </span>
              </div>
            )}
            {geoStatus && (
              <div className="col-12">
                <small className="text-info">{geoStatus}</small>
              </div>
            )}
            <div className="col-md-2 d-flex align-items-end">
              <button className="btn btn-success w-100" type="submit" disabled={transferLoading}>
                {transferLoading ? 'جاري الإرسال…' : 'إرسال السجل'}
              </button>
            </div>
          </form>
          {transferMsg && <div className={`alert mt-3 ${transferMsg.startsWith('تم') ? 'alert-success' : 'alert-danger'}`}>{transferMsg}</div>}
        </div>
      )}

      <div className="d-flex flex-wrap justify-content-center gap-3 mb-4">
        {statCards.map((c, i) => {
          const gradients = isDarkMode ? [
            'linear-gradient(135deg, #4a5568 0%, #2d3748 100%)',
            'linear-gradient(135deg, #553c9a 0%, #44337a 100%)',
            'linear-gradient(135deg, #2c5282 0%, #2a4365 100%)'
          ] : [
            'linear-gradient(135deg, #e2e8f0 0%, #cbd5e0 100%)',
            'linear-gradient(135deg, #d6bcfa 0%, #b794f4 100%)',
            'linear-gradient(135deg, #bee3f8 0%, #90cdf4 100%)'
          ];
          return (
            <div key={i} className="flex-shrink-0">
              <div className="card border-0 shadow-sm" style={{
                background: gradients[i % gradients.length],
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
                  {c.loading
                    ? <div className="spinner-border spinner-border-sm" role="status" style={{ color: isDarkMode ? 'white' : 'black' }} />
                    : <h2 className="fw-bold mb-0" style={{ color: isDarkMode ? 'white' : 'black', fontSize: '32px' }}>{c.value}</h2>
                  }
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card mb-4 shadow-sm">
        <div className="card-header d-flex justify-content-between align-items-center bg-gradient">
          <h5 className="mb-0"><i className="fas fa-list me-2" /> قائمة السجلات</h5>
        </div>
        <div className="card-body p-0">
          <LogTable readOnly={false} />
        </div>
      </div>

      {/* Clear Old Modal */}
      <Modal show={showClearModal} title="مسح السجلات القديمة" onClose={() => setShowClearModal(false)}>
        {clearMessage && <div className="alert alert-success">{clearMessage}</div>}
        <p>حذف السجلات الأقدم من:</p>
        <select className="form-select mb-3" value={clearDays} onChange={e => setClearDays(+e.target.value)}>
          {LOG_CLEAR_CHOICES.map(d => <option key={d} value={d}>{d} يوم</option>)}
        </select>
        <div className="alert alert-warning"><i className="fas fa-exclamation-triangle me-1" /> لا يمكن التراجع بعد المسح.</div>
        <div className="d-flex justify-content-end mt-4">
          <button className="btn btn-secondary me-2" disabled={clearLoading} onClick={() => setShowClearModal(false)}>إلغاء</button>
          <button className="btn btn-danger" onClick={handleClearLogs} disabled={clearLoading}>
            {clearLoading ? 'جاري المسح…' : 'مسح الآن'}
          </button>
        </div>
      </Modal>

      {/* Clear All Modal */}
      <Modal show={showClearAllModal} title="مسح جميع السجلات" onClose={() => setShowClearAllModal(false)}>
        {clearAllMessage && <div className="alert alert-success">{clearAllMessage}</div>}
        <p className="text-danger mb-3 fw-semibold">هذا الإجراء لا يمكن التراجع عنه. هل أنت متأكد؟</p>
        <div className="d-flex justify-content-end mt-4">
          <button className="btn btn-secondary me-2" disabled={clearAllLoading} onClick={() => setShowClearAllModal(false)}>إلغاء</button>
          <button className="btn btn-danger" onClick={handleClearAll} disabled={clearAllLoading}>
            {clearAllLoading ? 'جاري المسح…' : 'مسح الكل'}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default Logs;

