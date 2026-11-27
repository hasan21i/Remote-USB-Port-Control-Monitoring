// src/pages/security/Blacklist.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import useDevice from '../../hooks/useDevice';
import { formatDateTime } from '../../utils/formatters';
import { isValidSerialNumber } from '../../utils/validators';
import Modal from '../../components/Modal';

const DEVICE_TYPE_LABELS = {
  storage: 'تخزين',
  keyboard: 'لوحة مفاتيح',
  mouse: 'فأرة',
  camera: 'كاميرا',
  audio: 'صوت',
  printer: 'طابعة',
  scanner: 'ماسح ضوئي',
  other: 'أخرى',
  unknown: 'غير معروف'
};

const RISK_LEVEL_BADGES = {
  high:    { text: 'مرتفع',   className: 'bg-danger' },
  medium:  { text: 'متوسط',   className: 'bg-warning text-dark' },
  low:     { text: 'منخفض',   className: 'bg-success' },
  unknown: { text: 'غير معروف', className: 'bg-secondary' }
};

const Blacklist = () => {
  // الدوال من هوك الأجهزة
  const {
    devices,
    isLoading,
    error,
    fetchDevices,
    addToBlacklist,
    removeFromBlacklist,
    ejectDevice
  } = useDevice();

  const [filtered, setFiltered] = useState([]);
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('blacklisted_at');
  const [sortDir, setSortDir] = useState('desc');

  const [modalState, setModalState] = useState({
    show: false,
    serial: '',
    reason: '',
    fieldError: '',
    busy: false
  });



  // تحميل الأجهزة المحظورة فقط
  const loadDevices = useCallback(async () => {
    await fetchDevices({ blacklisted: true });
  }, [fetchDevices]);

  useEffect(() => {
    loadDevices();
    // eslint-disable-next-line
  }, []);

  // فلترة وترتيب النتائج
  useEffect(() => {
    let list = (devices || []).filter(d => d.blacklisted);

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(d =>
        [d.name, d.serial_number, d.manufacturer, d.product, d.notes]
          .some(field => field?.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const va = a[sortBy] || '';
      const vb = b[sortBy] || '';
      if (sortBy === 'blacklisted_at') {
        return dir * (new Date(va) - new Date(vb));
      }
      return dir * va.toString().localeCompare(vb.toString());
    });

    setFiltered(list);
  }, [devices, search, sortBy, sortDir]);

  // فصل جهاز
  const handleDisconnect = async serial => {
    if (!window.confirm(`هل أنت متأكد من فصل الجهاز ${serial}؟`)) return;
    try {
      await ejectDevice(serial);
      setSuccess(`تم فصل الجهاز ${serial} بنجاح`);
      await loadDevices();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) {
      setSuccess('');
      alert(e.message || 'فشل في فصل الجهاز');
    }
  };



  // المودال
  const openModal = () => setModalState({ show: true, serial: '', reason: '', fieldError: '', busy: false });
  const closeModal = () => setModalState(m => ({ ...m, show: false }));

  // إضافة للقائمة السوداء
  const handleAdd = async () => {
    const { serial } = modalState;
    if (!serial.trim()) {
      setModalState(m => ({ ...m, fieldError: 'الرجاء إدخال الرقم التسلسلي' }));
      return;
    }
    if (!isValidSerialNumber(serial)) {
      setModalState(m => ({ ...m, fieldError: 'الرقم التسلسلي غير صالح' }));
      return;
    }
    setModalState(m => ({ ...m, busy: true, fieldError: '' }));
    try {
      await addToBlacklist(serial);
      setSuccess(`تم حظر الجهاز ${serial} بنجاح`);
      await loadDevices();
      setTimeout(() => setSuccess(''), 3000);
      closeModal();
    } catch (e) {
      setModalState(m => ({ ...m, fieldError: e.message || 'فشل في الحظر' }));
    } finally {
      setModalState(m => ({ ...m, busy: false }));
    }
  };

  // إزالة من القائمة السوداء
  const handleRemove = async serial => {
    if (!window.confirm(`هل أنت متأكد من إزالة ${serial} من القائمة السوداء؟`)) return;
    try {
      await removeFromBlacklist(serial);
      setSuccess(`تمت إزالة ${serial} من القائمة السوداء`);
      await loadDevices();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) {
      setSuccess('');
      alert(e.message || 'فشل في الإزالة');
    }
  };

  return (
    <div className="blacklist-page container py-4">
      {/* العنوان والأزرار */}
      <header className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h1 className="fw-bold text-danger"><i className="fas fa-ban me-2" />الأجهزة المحظورة</h1>
          <p className="text-muted mb-0">جميع الأجهزة الممنوعة من الاتصال بالنظام.</p>
        </div>
        <button className="btn btn-danger btn-lg shadow-sm" onClick={openModal}>
          <i className="fas fa-plus-circle me-1" /> إضافة حظر
        </button>
      </header>

      {/* الرسائل */}
      {error && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          {error}
          <button type="button" className="btn-close" onClick={() => { }} aria-label="Close"></button>
        </div>
      )}
      {success && (
        <div className="alert alert-success alert-dismissible fade show" role="alert">
          {success}
          <button type="button" className="btn-close" onClick={() => setSuccess('')} aria-label="Close"></button>
        </div>
      )}

      {/* الفلاتر - مكبرة ومبعدة */}
      <div
        className="mb-4 d-flex flex-wrap align-items-center gap-4"
        style={{ gap: '1.2rem' }}
      >
        <input
          type="text"
          className="form-control fs-5 py-2 px-4"
          style={{ minWidth: 280, maxWidth: 380, fontSize: 20, borderRadius: '1rem', boxShadow: '0 2px 12px #0001' }}
          placeholder="بحث برقم أو اسم..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="form-select fs-5 py-2 px-4"
          style={{ minWidth: 170, fontSize: 19, borderRadius: '1rem' }}
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
        >
          <option value="blacklisted_at">وقت الحظر</option>
          <option value="name">الاسم</option>
          <option value="manufacturer">الشركة</option>
        </select>
        <select
          className="form-select fs-5 py-2 px-4"
          style={{ minWidth: 140, fontSize: 19, borderRadius: '1rem' }}
          value={sortDir}
          onChange={e => setSortDir(e.target.value)}
        >
          <option value="desc">تنازلي</option>
          <option value="asc">تصاعدي</option>
        </select>
      </div>

      {/* جدول الأجهزة */}
      {isLoading ? (
        <div className="text-center py-5">
          <div className="spinner-border" />
          <p>جاري التحميل…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-5 text-muted">
          <i className="fas fa-ban fa-3x mb-3"></i>
          <p>لا توجد أجهزة محظورة حالياً.</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover align-middle shadow-sm rounded bg-white">
            <thead className="table-light">
              <tr>
                <th>الاسم</th>
                <th>الرقم التسلسلي</th>
                <th>الشركة</th>
                <th>النوع</th>
                <th>المخاطر</th>
                <th>وقت الحظر</th>
                <th>حالة الاتصال</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const dt = DEVICE_TYPE_LABELS[d.device_type] || DEVICE_TYPE_LABELS[d.metadata?.device_type] || DEVICE_TYPE_LABELS.unknown;
                const risk = RISK_LEVEL_BADGES[d.risk_level] || RISK_LEVEL_BADGES.unknown;
                return (
                  <tr key={d.serial_number}>
                    <td>
                      <Link 
                        to={`/devices/details?serial=${d.serial_number}`} 
                        className="fw-bold text-primary text-decoration-none"
                        style={{ cursor: 'pointer' }}
                      >
                        {d.name || '-'}
                      </Link>
                    </td>
                    <td className="font-monospace">{d.serial_number}</td>
                    <td>{d.manufacturer || '-'}</td>
                    <td><span className="badge bg-secondary">{dt}</span></td>
                    <td><span className={`badge ${risk.className}`}>{risk.text}</span></td>
                    <td><span className="small">{formatDateTime(d.blacklisted_at)}</span></td>
                    <td>
                      <span className={`badge ${d.status === 'connected' ? 'bg-success' : 'bg-secondary'}`}>
                        {d.status === 'connected' ? 'متصل' : 'غير متصل'}
                      </span>
                    </td>
                    <td>
                      <div className="d-flex gap-2">
                        <Link
                          to={`/devices/details?serial=${d.serial_number}`}
                          className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1"
                          style={{ minWidth: '75px', fontSize: '12px' }}
                          title="عرض تفاصيل الجهاز"
                        >
                          <i className="fas fa-eye" />
                          <span>تفاصيل</span>
                        </Link>
                        {d.status === 'connected' && (
                          <button
                            className="btn btn-sm btn-outline-warning d-flex align-items-center gap-1"
                            style={{ minWidth: '75px', fontSize: '12px' }}
                            onClick={() => handleDisconnect(d.serial_number)}
                            title="فصل الجهاز"
                          >
                            <i className="fas fa-unlink" />
                            <span>فصل</span>
                          </button>
                        )}
                        <button
                          className="btn btn-sm btn-outline-success d-flex align-items-center gap-1"
                          style={{ minWidth: '85px', fontSize: '12px' }}
                          onClick={() => handleRemove(d.serial_number)}
                          title="إزالة من الحظر"
                        >
                          <i className="fas fa-check-circle" />
                          <span>إزالة الحظر</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* المودال الخاص بالحظر */}
      <Modal show={modalState.show} title="حظر جهاز جديد" onClose={closeModal}>
        <div>
          <p className="mb-2">أدخل الرقم التسلسلي وسبب الحظر:</p>
          {modalState.fieldError && <div className="alert alert-danger py-2">{modalState.fieldError}</div>}
          <div className="mb-3">
            <label className="form-label">الرقم التسلسلي <span className="text-danger">*</span></label>
            <input
              type="text"
              className="form-control"
              value={modalState.serial}
              onChange={e => setModalState(m => ({ ...m, serial: e.target.value }))}
              disabled={modalState.busy}
            />
          </div>
          <div className="mb-3">
            <label className="form-label">سبب الحظر (اختياري)</label>
            <textarea
              className="form-control"
              value={modalState.reason}
              onChange={e => setModalState(m => ({ ...m, reason: e.target.value }))}
              disabled={modalState.busy}
            />
          </div>
          <div className="d-flex justify-content-end">
            <button
              className="btn btn-secondary me-2"
              onClick={closeModal}
              disabled={modalState.busy}
            >
              إلغاء
            </button>
            <button
              className="btn btn-danger"
              onClick={handleAdd}
              disabled={modalState.busy}
            >
              {modalState.busy ? 'جارٍ الحظر…' : 'حظر'}
            </button>
          </div>
        </div>
      </Modal>


    </div>
  );
};

export default Blacklist;
