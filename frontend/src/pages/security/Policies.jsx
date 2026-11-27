// src/pages/security/Policies.jsx

import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import {
  fetchPolicies,
  createPolicy,
  updatePolicy,
  deletePolicy,
  activatePolicy,
  deactivatePolicy,
} from '../../utils/api';
import { formatDateTime } from '../../utils/formatters';
import Modal from '../../components/Modal';
import { toast, ToastContainer } from 'react-toastify';

// أنواع الأجهزة
const deviceTypes = [
  { id: 'flash', label: 'فلاش ميموري' },
  { id: 'hdd', label: 'قرص صلب خارجي' },
  { id: 'printer', label: 'طابعة' },
  { id: 'scanner', label: 'ماسح ضوئي' },
  { id: 'camera', label: 'كاميرا' },
  { id: 'keyboard', label: 'لوحة مفاتيح' },
  { id: 'mouse', label: 'فأرة' },
  { id: 'audio', label: 'أجهزة صوتية' },
  { id: 'other', label: 'أخرى' }
];

function PolicyForm({ initialData, onCancel, onSubmit }) {
  const [policy, setPolicy] = useState(
    initialData || {
      name: '',
      description: '',
      rules: {
        allow_whitelisted: true,
        block_blacklisted: true,
        default_action: 'prompt',
        require_encryption: false,
        read_only: false,
        max_size_mb: 0,
        allowed_types: []
      },
      is_active: false,
      policy_type: 'usb',
      device_pattern: '*',
    }
  );
  const [errors, setErrors] = useState({});
  const [expanded, setExpanded] = useState(true);

  const handleChange = e => {
    const { name, type, checked, value } = e.target;
    if (name.startsWith('rules.')) {
      const key = name.split('.')[1];
      setPolicy(p => ({
        ...p,
        rules: { ...p.rules, [key]: type === 'checkbox' ? checked : value }
      }));
    } else {
      setPolicy(p => ({
        ...p,
        [name]: type === 'checkbox' ? checked : value
      }));
    }
  };

  const toggleType = typeId => {
    setPolicy(p => {
      const list = [...p.rules.allowed_types];
      const idx = list.indexOf(typeId);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(typeId);
      return { ...p, rules: { ...p.rules, allowed_types: list } };
    });
  };

  const validate = p => {
    const errs = {};
    if (!p.name.trim()) errs.name = 'اسم السياسة مطلوب';
    if (p.rules.max_size_mb < 0) errs.max_size_mb = 'القيمة لا يمكن أن تكون سالبة';
    return { isValid: Object.keys(errs).length === 0, errs };
  };

  const submit = () => {
    const { isValid, errs } = validate(policy);
    if (!isValid) {
      setErrors(errs);
      return;
    }
    // معالجة block_if_after_hours
    let rules = { ...policy.rules };
    if (rules.block_if_after_hours_start !== undefined && rules.block_if_after_hours_end !== undefined && rules.block_if_after_hours_start !== '' && rules.block_if_after_hours_end !== '') {
      rules.block_if_after_hours = [parseInt(rules.block_if_after_hours_start), parseInt(rules.block_if_after_hours_end)];
    } else {
      delete rules.block_if_after_hours;
    }
    // معالجة max_file_size
    if (rules.max_file_size !== undefined && rules.max_file_size !== '' && rules.max_file_size !== null) {
      rules.max_file_size = parseInt(rules.max_file_size);
    } else {
      delete rules.max_file_size;
    }
    // معالجة read_only
    rules.read_only = !!rules.read_only;
    onSubmit({
      ...policy,
      rules,
      policy_type: policy.policy_type,
      device_pattern: policy.device_pattern
    });
  };

  const toggleDetails = () => setExpanded(e => !e);

  return (
    <div className="mx-auto card shadow border-0" style={{ maxWidth: 580 }}>
      <div className="card-header bg-primary text-white d-flex justify-content-between align-items-center">
        <div className="d-flex align-items-center" onClick={toggleDetails} style={{ cursor: 'pointer' }}>
          <i className={`fas fa-chevron-${expanded ? 'up' : 'down'} fs-4 me-2`} />
          <span className="fw-bold fs-5">تفاصيل السياسة</span>
        </div>
        <button 
          className="btn btn-link text-white fs-4 p-0 d-flex align-items-center justify-content-center" 
          onClick={onCancel} 
          aria-label="إغلاق"
          style={{ 
            width: '32px', 
            height: '32px', 
            borderRadius: '50%',
            transition: 'all 0.2s ease',
            textDecoration: 'none'
          }}
          title="إغلاق"
          onMouseEnter={(e) => {
            e.target.style.backgroundColor = 'rgba(255,255,255,0.2)';
            e.target.style.transform = 'scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = 'transparent';
            e.target.style.transform = 'scale(1)';
          }}
        >
          <span style={{ fontSize: '20px', fontWeight: 'bold', lineHeight: '1' }}>×</span>
        </button>
      </div>
      <div style={{
        maxHeight: expanded ? '2000px' : 0,
        overflow: 'hidden',
        transition: 'max-height 0.6s ease'
      }}>
        {expanded && (
          <div className="card-body">
            <div className="mb-3">
              <label className="form-label fw-semibold">اسم السياسة<span className="text-danger">*</span></label>
              <input
                name="name"
                className={`form-control ${errors.name ? 'is-invalid' : ''}`}
                value={policy.name}
                onChange={handleChange}
              />
              {errors.name && <div className="invalid-feedback">{errors.name}</div>}
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold">وصف السياسة</label>
              <textarea
                name="description"
                className="form-control"
                rows="2"
                value={policy.description}
                onChange={handleChange}
              />
            </div>
            <div className="row mb-3">
              <div className="col-md-7 mb-3 mb-md-0">
                <label className="form-label fw-semibold">الإجراء الافتراضي</label>
                <select
                  name="rules.default_action"
                  className="form-select"
                  value={policy.rules.default_action}
                  onChange={handleChange}
                >
                  <option value="allow">السماح</option>
                  <option value="block">الحظر</option>
                  <option value="prompt">استفسار المستخدم</option>
                  <option value="readonly">قراءة فقط</option>
                </select>
              </div>
              <div className="col-md-5">
                <label className="form-label fw-semibold">الحجم الأقصى (MB)</label>
                <input
                  name="rules.max_size_mb"
                  type="number"
                  className={`form-control ${errors.max_size_mb ? 'is-invalid' : ''}`}
                  value={policy.rules.max_size_mb}
                  onChange={handleChange}
                />
                {errors.max_size_mb && <div className="invalid-feedback">{errors.max_size_mb}</div>}
              </div>
            </div>
            <div className="mb-4">
              <div className="fw-semibold mb-2 text-body">قواعد وتقييدات</div>
              <div className="form-check mb-2">
                <input
                  type="checkbox"
                  id="allow_whitelisted"
                  name="rules.allow_whitelisted"
                  className="form-check-input"
                  checked={policy.rules.allow_whitelisted}
                  onChange={handleChange}
                />
                <label className="form-check-label text-body" htmlFor="allow_whitelisted">
                  السماح فقط للأجهزة في القائمة البيضاء
                </label>
              </div>
              <div className="form-check">
                <input
                  type="checkbox"
                  id="block_blacklisted"
                  name="rules.block_blacklisted"
                  className="form-check-input"
                  checked={policy.rules.block_blacklisted}
                  onChange={handleChange}
                />
                <label className="form-check-label text-body" htmlFor="block_blacklisted">
                  منع الأجهزة في القائمة السوداء
                </label>
              </div>
            </div>
            <div className="mb-4">
              <div className="fw-semibold mb-2 text-body">أنواع الأجهزة المسموح بها</div>
              <div className="row">
                {deviceTypes.map(dt => (
                  <div className="col-6 col-md-4 mb-2" key={dt.id}>
                    <div className="form-check">
                      <input
                        id={dt.id}
                        type="checkbox"
                        className="form-check-input"
                        checked={policy.rules.allowed_types.includes(dt.id)}
                        onChange={() => toggleType(dt.id)}
                      />
                      <label className="form-check-label text-body" htmlFor={dt.id}>
                        {dt.label}
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mb-4">
              <div className="fw-semibold mb-2 text-body">خيارات متقدمة للسياسة</div>
              <div className="form-check mb-2">
                <input
                  type="checkbox"
                  id="read_only"
                  name="rules.read_only"
                  className="form-check-input"
                  checked={policy.rules.read_only}
                  onChange={handleChange}
                />
                <label className="form-check-label text-body" htmlFor="read_only">
                  تفعيل وضع القراءة فقط (readonly) لأجهزة التخزين
                </label>
              </div>
              <div className="mb-2">
                <label className="form-label fw-semibold">الحد الأقصى لحجم الملف (MB)</label>
                <input
                  name="rules.max_file_size"
                  type="number"
                  className="form-control"
                  value={policy.rules.max_file_size || ''}
                  onChange={handleChange}
                  min="0"
                  placeholder="اتركه فارغاً لتعطيل الحد"
                />
              </div>
              <div className="mb-2">
                <label className="form-label fw-semibold">حظر الأجهزة خارج أوقات العمل</label>
                <div className="row g-2 align-items-center">
                  <div className="col-auto">
                    <input
                      name="rules.block_if_after_hours_start"
                      type="number"
                      className="form-control"
                      value={policy.rules.block_if_after_hours_start || ''}
                      onChange={e => setPolicy(p => ({
                        ...p,
                        rules: { ...p.rules, block_if_after_hours_start: e.target.value }
                      }))}
                      min="0" max="23"
                      placeholder="ساعة البدء (مثلاً 8)"
                    />
                  </div>
                  <div className="col-auto text-body">إلى</div>
                  <div className="col-auto">
                    <input
                      name="rules.block_if_after_hours_end"
                      type="number"
                      className="form-control"
                      value={policy.rules.block_if_after_hours_end || ''}
                      onChange={e => setPolicy(p => ({
                        ...p,
                        rules: { ...p.rules, block_if_after_hours_end: e.target.value }
                      }))}
                      min="0" max="23"
                      placeholder="ساعة الانتهاء (مثلاً 17)"
                    />
                  </div>
                  <div className="col">
                    <small className="text-body-secondary">لن يُسمح للأجهزة خارج هذه الساعات</small>
                  </div>
                </div>
              </div>
            </div>
            <div className="d-flex justify-content-end mt-4 pt-3 border-top">
              <button className="btn btn-outline-secondary me-2" onClick={onCancel}>
                <i className="fas fa-times me-1"></i>
                إلغاء
              </button>
              <button className="btn btn-primary" onClick={submit}>
                <i className="fas fa-save me-1"></i>
                حفظ
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

PolicyForm.propTypes = {
  initialData: PropTypes.object,
  onCancel: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired
};

function ConfirmationModal({ show, title, message, onCancel, onConfirm }) {
  return (
    <Modal show={show} title={title} onClose={onCancel}>
      <p>{message}</p>
      <div className="d-flex justify-content-end">
        <button className="btn btn-secondary me-2" onClick={onCancel}>إلغاء</button>
        <button className="btn btn-danger" onClick={onConfirm}>حذف</button>
      </div>
    </Modal>
  );
}

ConfirmationModal.propTypes = {
  show: PropTypes.bool.isRequired,
  title: PropTypes.string.isRequired,
  message: PropTypes.string.isRequired,
  onCancel: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired
};

const Policies = () => {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalMode, setModalMode] = useState(null);
  const [selectedPolicy, setSelectedPolicy] = useState(null);

  // جلب السياسات
  const loadPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetchPolicies();
      setPolicies(Array.isArray(resp.data) ? resp.data : []);
      setError('');
    } catch (err) {
      setError(err.message);
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPolicies();
  }, [loadPolicies]);

  const closeModal = () => {
    setModalMode(null);
    setSelectedPolicy(null);
  };

  const handleCreate = async policy => {
    try {
      await createPolicy(policy);
      await loadPolicies();
      closeModal();
      toast.success('تم إنشاء السياسة بنجاح');
    } catch (err) {
      toast.error('تعذر إضافة السياسة: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleUpdate = async policy => {
    try {
      await updatePolicy(policy.id, policy);
      await loadPolicies();
      closeModal();
      toast.success('تم تعديل السياسة بنجاح');
    } catch (err) {
      toast.error('تعذر تعديل السياسة: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDelete = async () => {
    try {
      await deletePolicy(selectedPolicy.id);
      await loadPolicies();
      closeModal();
      toast.success('تم حذف السياسة بنجاح');
    } catch (err) {
      toast.error('تعذر حذف السياسة: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleActivate = async policy => {
    try {
      await activatePolicy(policy.id);
      await loadPolicies();
      toast.success(`تم تفعيل السياسة "${policy.name}" بنجاح`);
    } catch (err) {
      toast.error('تعذر تفعيل السياسة: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDeactivate = async policy => {
    try {
      await deactivatePolicy(policy.id);
      await loadPolicies();
      toast.success(`تم تعطيل السياسة "${policy.name}" بنجاح`);
    } catch (err) {
      toast.error('تعذر تعطيل السياسة: ' + (err.response?.data?.error || err.message));
    }
  };

  if (loading) {
    return (
      <div className="text-center py-5">
        <div className="spinner-border" role="status"></div>
        <p>جاري تحميل السياسات…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-danger text-center" role="alert">
        فشل في جلب السياسات: {error}
      </div>
    );
  }

  return (
    <div className="container py-5">
      <div className="mb-4 d-flex justify-content-between align-items-center">
        <h1>سياسات الأمان</h1>
        <button className="btn btn-primary d-flex align-items-center" onClick={() => setModalMode('create')}>
          <span 
            className="me-2 d-flex align-items-center justify-content-center"
            style={{ 
              width: '20px', 
              height: '20px', 
              fontSize: '16px', 
              fontWeight: 'bold',
              borderRadius: '50%',
              backgroundColor: 'rgba(255,255,255,0.2)'
            }}
          >
            +
          </span>
          سياسة جديدة
        </button>
      </div>

      <table className="table table-hover align-middle">
        <thead>
          <tr>
            <th>الاسم</th>
            <th>الوصف</th>
            <th>الإجراء الافتراضي</th>
            <th>قراءة فقط</th>
            <th>حجم الملف الأقصى</th>
            <th>حظر خارج الدوام</th>
            <th>آخر تعديل</th>
            <th>الحالة</th>
            <th>إجراءات</th>
          </tr>
        </thead>
        <tbody>
          {policies.map(p => (
            <tr key={p.id} className={p.is_active ? 'table-success' : ''}>
              <td>
                <strong>{p.name}</strong>
                {p.is_active && <span className="badge bg-success ms-2">مفعلة</span>}
              </td>
              <td>{p.description || '-'}</td>
              <td>
                <span className={`badge ${
                  p.rules?.default_action === 'allow' ? 'bg-success' :
                  p.rules?.default_action === 'block' ? 'bg-danger' :
                  p.rules?.default_action === 'prompt' ? 'bg-warning' : 'bg-secondary'
                }`}>
                  {p.rules?.default_action === 'allow' ? 'السماح' :
                   p.rules?.default_action === 'block' ? 'الحظر' :
                   p.rules?.default_action === 'prompt' ? 'استفسار' :
                   p.rules?.default_action === 'readonly' ? 'قراءة فقط' : '-'}
                </span>
              </td>
              <td>
                {p.rules?.read_only ? (
                  <span title="تفعيل وضع القراءة فقط"><i className="fas fa-lock text-primary" /></span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td>
                {p.rules?.max_file_size ? (
                  <span title={`الحد الأقصى: ${p.rules.max_file_size}MB`}><i className="fas fa-file-alt text-info" /> {p.rules.max_file_size}MB</span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td>
                {Array.isArray(p.rules?.block_if_after_hours) ? (
                  <span title={`الحظر من ${p.rules.block_if_after_hours[0]} إلى ${p.rules.block_if_after_hours[1]} ساعة`}><i className="fas fa-clock text-warning" /> {p.rules.block_if_after_hours[0]}-{p.rules.block_if_after_hours[1]}</span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td>{formatDateTime(p.modified_at || p.created_at)}</td>
              <td>
                {p.is_active
                  ? <button className="btn btn-sm btn-warning" onClick={() => handleDeactivate(p)}>
                      <i className="fas fa-pause me-1"></i>تعطيل
                    </button>
                  : <button className="btn btn-sm btn-success" onClick={() => handleActivate(p)}>
                      <i className="fas fa-play me-1"></i>تفعيل
                    </button>
                }
              </td>
              <td>
                <button className="btn btn-sm btn-info me-1" onClick={() => { setSelectedPolicy(p); setModalMode('edit'); }}>
                  <i className="fas fa-edit me-1"></i>تعديل
                </button>
                <button 
                  className="btn btn-sm btn-danger" 
                  disabled={p.is_active} 
                  onClick={() => { setSelectedPolicy(p); setModalMode('delete'); }}
                  title={p.is_active ? 'لا يمكن حذف السياسة المفعلة' : 'حذف السياسة'}
                >
                  <i className="fas fa-trash me-1"></i>حذف
                </button>
              </td>
            </tr>
          ))}
          {!policies.length && (
            <tr>
              <td colSpan="9" className="text-center text-muted py-5">
                <i className="fas fa-shield-alt fa-3x mb-3 opacity-50"></i>
                <div>
                  <h5 className="text-muted">لا توجد سياسات أمان</h5>
                  <p className="mb-0">قم بإنشاء سياسة جديدة لبدء إدارة أمان الأجهزة</p>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {modalMode === 'create' && (
        <Modal show title="إنشاء سياسة جديدة" onClose={closeModal} size="lg">
          <PolicyForm initialData={null} onCancel={closeModal} onSubmit={handleCreate} />
        </Modal>
      )}
      {modalMode === 'edit' && selectedPolicy && (
        <Modal show title="تعديل سياسة" onClose={closeModal} size="lg">
          <PolicyForm initialData={selectedPolicy} onCancel={closeModal} onSubmit={handleUpdate} />
        </Modal>
      )}
      {modalMode === 'delete' && selectedPolicy && (
        <ConfirmationModal
          show
          title="حذف سياسة"
          message={`هل أنت متأكد من حذف السياسة "${selectedPolicy.name}"؟ لا يمكن التراجع.`}
          onCancel={closeModal}
          onConfirm={handleDelete}
        />
      )}
      
      <ToastContainer
        position="top-left"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={true}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
    </div>
  );
};

export default Policies;
