// src/pages/security/Whitelist.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import useDevice from '../../hooks/useDevice';
import { formatDateTime } from '../../utils/formatters';
import { isValidSerialNumber } from '../../utils/validators';
import Modal from '../../components/Modal';

const SORT_FIELDS = [
  { value: 'connection_time', label: 'وقت الاتصال' },
  { value: 'name', label: 'الاسم' },
  { value: 'manufacturer', label: 'الشركة المصنعة' }
];

const Whitelist = () => {
  const {
    devices,
    isLoading,
    error,
    fetchDevices,
    addToWhitelist,
    removeFromWhitelist,
    ejectDevice
  } = useDevice();

  const [filtered, setFiltered] = useState([]);
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('connection_time');
  const [sortDir, setSortDir] = useState('desc');

  const [modalState, setModalState] = useState({
    show: false,
    serial: '',
    fieldError: '',
    busy: false
  });



  // تحميل الأجهزة المصرح بها فقط
  const loadDevices = useCallback(async () => {
    await fetchDevices({ whitelisted: true });
  }, [fetchDevices]);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  // فلترة وترتيب النتائج
  useEffect(() => {
    let list = (devices || []).filter(d => d.whitelisted);

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(d =>
        [d.name, d.serial_number, d.manufacturer, d.product]
          .some(field => field?.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const va = a[sortBy] || '';
      const vb = b[sortBy] || '';
      if (sortBy === 'connection_time') {
        return dir * (new Date(va) - new Date(vb));
      }
      return dir * va.toString().localeCompare(vb.toString());
    });

    setFiltered(list);
  }, [devices, search, sortBy, sortDir]);

  // المودال
  const openModal = () => setModalState({ show: true, serial: '', fieldError: '', busy: false });
  const closeModal = () => setModalState(m => ({ ...m, show: false }));

  // إضافة للقائمة البيضاء
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
      await addToWhitelist(serial);
      setSuccess(`تمت إضافة الجهاز ${serial} بنجاح`);
      await loadDevices();
      setTimeout(() => setSuccess(''), 3000);
      closeModal();
    } catch (e) {
      setModalState(m => ({ ...m, fieldError: e.message || 'فشل في الإضافة' }));
    } finally {
      setModalState(m => ({ ...m, busy: false }));
    }
  };

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

  // إزالة من القائمة البيضاء
  const handleRemove = async serial => {
    if (!window.confirm(`هل أنت متأكد من إزالة ${serial} من القائمة البيضاء؟`)) return;
    try {
      await removeFromWhitelist(serial);
      setSuccess(`تمت إزالة ${serial} من القائمة البيضاء`);
      await loadDevices();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) {
      setSuccess('');
      alert(e.message || 'فشل في الإزالة');
    }
  };



  return (
    <div className="whitelist-page container py-4">
      {/* العنوان والأزرار */}
      <header className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h1 className="fw-bold text-success">
            <i className="fas fa-check-circle me-2" />
            الأجهزة المصرح بها
          </h1>
          <p className="text-muted mb-0">جميع الأجهزة المسموح لها بالاتصال بالنظام.</p>
        </div>
        <button className="btn btn-success btn-lg shadow-sm" onClick={openModal}>
          <i className="fas fa-plus-circle me-1" /> إضافة تصريح
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
          {SORT_FIELDS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
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
          <i className="fas fa-check-circle fa-3x mb-3"></i>
          <p>لا توجد أجهزة مصرح بها حالياً.</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover align-middle shadow-sm rounded bg-white">
            <thead className="table-light">
              <tr>
                <th>الاسم</th>
                <th>الرقم التسلسلي</th>
                <th>الشركة</th>
                <th>منتج</th>
                <th>وقت الاتصال</th>
                <th>حالة الاتصال</th>
                <th>العمليات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
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
                  <td>{d.product || '-'}</td>
                  <td><span className="small">{formatDateTime(d.connection_time)}</span></td>
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
                        className="btn btn-sm btn-outline-danger d-flex align-items-center gap-1"
                        style={{ minWidth: '75px', fontSize: '12px' }}
                        onClick={() => handleRemove(d.serial_number)}
                        title="إزالة من القائمة البيضاء"
                      >
                        <i className="fas fa-times" />
                        <span>إزالة</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* المودال الخاص بالتصريح */}
      <Modal show={modalState.show} title="إضافة جهاز مصرح" onClose={closeModal}>
        <div>
          <p className="mb-2">أدخل الرقم التسلسلي للجهاز المصرح:</p>
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
          <div className="d-flex justify-content-end">
            <button
              className="btn btn-secondary me-2"
              onClick={closeModal}
              disabled={modalState.busy}
            >
              إلغاء
            </button>
            <button
              className="btn btn-success"
              onClick={handleAdd}
              disabled={modalState.busy}
            >
              {modalState.busy ? 'جارٍ الإضافة…' : 'إضافة'}
            </button>
          </div>
        </div>
      </Modal>


    </div>
  );
};

export default Whitelist;
