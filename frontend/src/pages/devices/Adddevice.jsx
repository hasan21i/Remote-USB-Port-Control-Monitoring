// src/pages/devices/AddDevice.jsx

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import useDevice from '../../hooks/useDevice';
import { isValidSerial, isNotEmpty } from '../../utils/validators';

const AddDevice = () => {
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const { createDevice, isLoading } = useDevice();

  const [form, setForm] = useState({
    serial_number: '',
    name: '',
    manufacturer: '',
    model: '',
    description: '',
    type: 'usb',
    status: 'enabled',
    whitelisted: false
  });
  const [errors, setErrors] = useState({});
  const [alert, setAlert] = useState({ type: '', message: '' });

  useEffect(() => {
    if (alert.message && alert.type === 'success') {
      const timer = setTimeout(() => setAlert({ type: '', message: '' }), 2000);
      return () => clearTimeout(timer);
    }
  }, [alert]);

  // التحقق الإجباري هنا
  const validate = () => {
    const errs = {};
    if (!isNotEmpty(form.serial_number)) {
      errs.serial_number = 'الرقم التسلسلي مطلوب';
    } else if (!isValidSerial(form.serial_number)) {
      errs.serial_number = 'الرقم التسلسلي غير صالح';
    }
    if (!isNotEmpty(form.name)) {
      errs.name = 'اسم الجهاز مطلوب';
    }
    return errs;
  };

  const handleChange = e => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    setErrors(prev => ({ ...prev, [name]: null }));
  };

  // دالة الإرسال مع الحماية الإضافية
  const handleSubmit = async (e) => {
    e.preventDefault(); // <=== الأهم: منع التصرف الافتراضي للنموذج دائماً

    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setAlert({ type: '', message: '' });
    try {
      // إضافة usb_port وphysical_path إذا كانت متاحة
      const meta = form.meta_data ? (typeof form.meta_data === 'string' ? JSON.parse(form.meta_data) : form.meta_data) : {};
      const payload = {
        ...form,
        usb_port: form.usb_port || meta.port_number || '-',
        physical_path: form.physical_path || meta.physical_path || '-',
        serial_number: form.serial_number || meta.device_identifier,
      };
      await createDevice(payload);
      setAlert({ type: 'success', message: 'تمت إضافة الجهاز بنجاح' });
      setForm({
        serial_number: '', name: '', manufacturer: '', model: '', description: '', type: 'usb', status: 'enabled', whitelisted: false
      });
      setErrors({});
      setTimeout(() => navigate('/devices'), 1000);
    } catch (err) {
      setAlert({ type: 'danger', message: err.message || 'فشل إضافة الجهاز' });
    }
  };

  return (
    <div className={`page-container ${isDarkMode ? 'theme-dark' : 'theme-light'}`}>
      <div className="page-header mb-4">
        <h1 className="h3">إضافة جهاز جديد</h1>
        <p className="text-muted">أضف جهاز USB يدويًا إلى النظام</p>
      </div>

      {alert.message && (
        <div className={`alert alert-${alert.type}`} role="alert">
          {alert.message}
        </div>
      )}

      <div className="card">
        <div className="card-body">
          <form onSubmit={handleSubmit} noValidate autoComplete="off">
            <div className="row">
              <div className="col-md-6">
                <div className="mb-3">
                  <label htmlFor="serial_number" className="form-label">
                    الرقم التسلسلي <span className="text-danger">*</span>
                  </label>
                  <input
                    id="serial_number"
                    name="serial_number"
                    type="text"
                    className={`form-control ${errors.serial_number ? 'is-invalid' : ''}`}
                    value={form.serial_number}
                    onChange={handleChange}
                    placeholder="مثال: SN-12345-XYZ"
                    disabled={isLoading}
                    autoComplete="off"
                  />
                  {errors.serial_number && (
                    <div className="invalid-feedback">{errors.serial_number}</div>
                  )}
                </div>

                <div className="mb-3">
                  <label htmlFor="name" className="form-label">
                    اسم الجهاز <span className="text-danger">*</span>
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    className={`form-control ${errors.name ? 'is-invalid' : ''}`}
                    value={form.name}
                    onChange={handleChange}
                    placeholder="مثل: فلاش USB شخصي"
                    disabled={isLoading}
                    autoComplete="off"
                  />
                  {errors.name && (
                    <div className="invalid-feedback">{errors.name}</div>
                  )}
                </div>

                <div className="mb-3">
                  <label htmlFor="manufacturer" className="form-label">
                    الشركة المصنعة
                  </label>
                  <input
                    id="manufacturer"
                    name="manufacturer"
                    type="text"
                    className="form-control"
                    value={form.manufacturer}
                    onChange={handleChange}
                    placeholder="مثل: SanDisk"
                    disabled={isLoading}
                  />
                </div>

                <div className="mb-3">
                  <label htmlFor="model" className="form-label">
                    الموديل
                  </label>
                  <input
                    id="model"
                    name="model"
                    type="text"
                    className="form-control"
                    value={form.model}
                    onChange={handleChange}
                    placeholder="مثل: Ultra Flair"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="col-md-6">
                <div className="mb-3">
                  <label htmlFor="type" className="form-label">
                    نوع الجهاز
                  </label>
                  <select
                    id="type"
                    name="type"
                    className="form-control"
                    value={form.type}
                    onChange={handleChange}
                    disabled={isLoading}
                  >
                    <option value="usb">USB</option>
                    <option value="flash">فلاش ميموري</option>
                    <option value="hdd">قرص خارجي</option>
                    <option value="printer">طابعة</option>
                    <option value="scanner">ماسح ضوئي</option>
                    <option value="camera">كاميرا</option>
                    <option value="other">أخرى</option>
                  </select>
                </div>

                <div className="mb-3">
                  <label htmlFor="status" className="form-label">
                    الحالة الأولية
                  </label>
                  <select
                    id="status"
                    name="status"
                    className="form-control"
                    value={form.status}
                    onChange={handleChange}
                    disabled={isLoading}
                  >
                    <option value="enabled">مُفعل</option>
                    <option value="disabled">معطّل</option>
                    <option value="blocked">محظور</option>
                  </select>
                </div>

                <div className="mb-3">
                  <label htmlFor="description" className="form-label">
                    وصف الجهاز
                  </label>
                  <textarea
                    id="description"
                    name="description"
                    className="form-control"
                    rows="4"
                    value={form.description}
                    onChange={handleChange}
                    placeholder="ملاحظات أو وصف اختياري"
                    disabled={isLoading}
                  />
                </div>

                <div className="form-check mb-3">
                  <input
                    id="whitelisted"
                    name="whitelisted"
                    type="checkbox"
                    className="form-check-input"
                    checked={form.whitelisted}
                    onChange={handleChange}
                    disabled={isLoading}
                  />
                  <label htmlFor="whitelisted" className="form-check-label">
                    أضف إلى القائمة البيضاء تلقائيًا
                  </label>
                </div>
              </div>
            </div>

            <div className="d-flex justify-content-end mt-4">
              <button
                type="button"
                className="btn btn-secondary me-2"
                onClick={() => navigate('/devices')}
                disabled={isLoading}
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <span
                      className="spinner-border spinner-border-sm me-2"
                      role="status"
                      aria-hidden="true"
                    />
                    جاري الإضافة…
                  </>
                ) : (
                  <>
                    <i className="fas fa-plus-circle me-2" aria-hidden="true" />
                    إضافة الجهاز
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AddDevice;
