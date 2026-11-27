// src/pages/settings/Activation.jsx

import React, { useState, useEffect } from 'react';
import { formatDateTime } from '../../utils/formatters';
import { fetchActivationInfo, axiosInstance } from '../../utils/api';
import { isValidEmail } from '../../utils/validators';

const Activation = () => {
  // حالة عرض معلومات الترخيص
  const [licenseInfo, setLicenseInfo]       = useState(null);
  const [loadingInfo, setLoadingInfo]       = useState(true);
  const [infoError, setInfoError]           = useState('');

  // نموذج التفعيل
  const [form, setForm]                     = useState({
    key: '',
    organization: '',
    email: '',
    phone: ''
  });
  const [formErrors, setFormErrors]         = useState({});
  const [isActivating, setIsActivating]     = useState(false);
  const [activateError, setActivateError]   = useState('');
  const [activateSuccess, setActivateSuccess] = useState('');

  // جلب معلومات الترخيص عند التركيب
  useEffect(() => {
    (async () => {
      try {
        setLoadingInfo(true);
        const info = await fetchActivationInfo();
        setLicenseInfo(info);
      } catch (err) {
        setInfoError(err.message || 'فشل في جلب معلومات الترخيص');
      } finally {
        setLoadingInfo(false);
      }
    })();
  }, []);

  // التحقق من صحة النموذج
  const validate = () => {
    const errs = {};
    if (!form.key.trim()) errs.key = 'مفتاح الترخيص مطلوب';
    if (!form.organization.trim()) errs.organization = 'اسم المؤسسة مطلوب';
    if (!form.email.trim()) errs.email = 'البريد الإلكتروني مطلوب';
    else if (!isValidEmail(form.email).valid) errs.email = 'تنسيق البريد الإلكتروني غير صحيح';
    if (!form.phone.trim()) errs.phone = 'رقم الهاتف مطلوب';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // إرسال طلب التفعيل
  const handleSubmit = async e => {
    e.preventDefault();
    setActivateError('');
    setActivateSuccess('');
    if (!validate()) return;

    setIsActivating(true);
    try {
      // نستخدم axiosInstance مباشرة لأننا لا نستورد activateSystem
      const info = await axiosInstance.post('/activate', form);
      setLicenseInfo(info);
      setActivateSuccess('تم تفعيل الترخيص بنجاح!');
      setForm({ key: '', organization: '', email: '', phone: '' });
    } catch (err) {
      setActivateError(err.message || 'حدث خطأ أثناء التفعيل');
    } finally {
      setIsActivating(false);
    }
  };

  // حساب الأيام المتبقية
  const remainingDays = () => {
    if (!licenseInfo?.expiry_date) return 0;
    const diff = new Date(licenseInfo.expiry_date) - new Date();
    return Math.max(Math.ceil(diff / (1000 * 60 * 60 * 24)), 0);
  };

  // بادج الحالة
  const renderStatusBadge = () => {
    if (!licenseInfo) return null;
    const { status } = licenseInfo;
    const map = {
      active:  ['نشط', 'success', 'check-circle'],
      trial:   ['تجريبي', 'warning', 'hourglass-half'],
      expired: ['منتهي', 'danger', 'times-circle']
    };
    const [text, cls, icon] = map[status] || ['غير معروف', 'secondary', 'question-circle'];
    return (
      <span className={`badge bg-${cls}`}>
        <i className={`fas fa-${icon} me-1`}/> {text}
      </span>
    );
  };

  return (
    <div className="activation-page container py-4">
      <h1 className="h3 mb-4">تفعيل النظام</h1>

      {/* عرض معلومات الترخيص الحالية */}
      {loadingInfo ? (
        <div className="text-center py-5">
          <div className="spinner-border" role="status"/>
        </div>
      ) : infoError ? (
        <div className="alert alert-danger">
          <i className="fas fa-exclamation-triangle me-2"/> {infoError}
        </div>
      ) : licenseInfo ? (
        <div className="card mb-4 shadow-sm">
          <div className="card-header">
            <h5 className="mb-0">معلومات الترخيص الحالية</h5>
          </div>
          <div className="card-body">
            <div className="row gy-3">
              <div className="col-md-4 text-center">
                <div>الحالة</div>
                <div className="my-2">{renderStatusBadge()}</div>
                {licenseInfo.status === 'active' && (
                  <small className="text-muted">متبقي {remainingDays()} يوم</small>
                )}
              </div>
              <div className="col-md-4 text-center">
                <div>نوع الترخيص</div>
                <div className="h5 my-2">{licenseInfo.typeName}</div>
                <small className="text-muted">{licenseInfo.max_devices} أجهزة</small>
              </div>
              <div className="col-md-4 text-center">
                <div>مسجل باسم</div>
                <div className="h6 mt-2">{licenseInfo.organization}</div>
                <small className="text-muted">{licenseInfo.email}</small>
              </div>
              <div className="col-md-4">
                <strong>مفتاح الترخيص:</strong> <code>{licenseInfo.key}</code>
              </div>
              <div className="col-md-4">
                <strong>تاريخ الإصدار:</strong> {formatDateTime(licenseInfo.issue_date)}
              </div>
              <div className="col-md-4">
                <strong>تاريخ الانتهاء:</strong> {formatDateTime(licenseInfo.expiry_date)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* نموذج تفعيل جديد */}
      <div className="card shadow-sm">
        <div className="card-header">
          <h5 className="mb-0">تفعيل ترخيص جديد</h5>
        </div>
        <div className="card-body">
          {activateError && (
            <div className="alert alert-danger">
              <i className="fas fa-exclamation-triangle me-2"/> {activateError}
            </div>
          )}
          {activateSuccess && (
            <div className="alert alert-success">
              <i className="fas fa-check-circle me-2"/> {activateSuccess}
            </div>
          )}
          <form onSubmit={handleSubmit} noValidate>
            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label">مفتاح الترخيص</label>
                <input
                  type="text"
                  className={`form-control ${formErrors.key ? 'is-invalid' : ''}`}
                  value={form.key}
                  onChange={e => setForm(f => ({ ...f, key: e.target.value }))}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                />
                {formErrors.key && <div className="invalid-feedback">{formErrors.key}</div>}
              </div>
              <div className="col-md-6">
                <label className="form-label">اسم المؤسسة</label>
                <input
                  type="text"
                  className={`form-control ${formErrors.organization ? 'is-invalid' : ''}`}
                  value={form.organization}
                  onChange={e => setForm(f => ({ ...f, organization: e.target.value }))}
                />
                {formErrors.organization && (
                  <div className="invalid-feedback">{formErrors.organization}</div>
                )}
              </div>
              <div className="col-md-6">
                <label className="form-label">البريد الإلكتروني للمسؤول</label>
                <input
                  type="email"
                  className={`form-control ${formErrors.email ? 'is-invalid' : ''}`}
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                />
                {formErrors.email && <div className="invalid-feedback">{formErrors.email}</div>}
              </div>
              <div className="col-md-6">
                <label className="form-label">رقم الهاتف</label>
                <input
                  type="tel"
                  className={`form-control ${formErrors.phone ? 'is-invalid' : ''}`}
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                />
                {formErrors.phone && <div className="invalid-feedback">{formErrors.phone}</div>}
              </div>
            </div>

            <div className="mt-4 text-end">
              <button
                type="submit"
                className="btn btn-primary px-4"
                disabled={isActivating}
              >
                {isActivating ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status" />
                    جاري التفعيل...
                  </>
                ) : (
                  'تفعيل الترخيص'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Activation;
