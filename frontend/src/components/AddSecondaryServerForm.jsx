import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { getSystemInfo } from '../utils/api';

const AddSecondaryServerForm = ({ onSubmit, loading, onCancel }) => {
  const [formData, setFormData] = useState({
    name: '',
    ip_address: '',
    os: '',
    cpu: '',
    ram: '',
    capabilities: {},
    config: {}
  });
  const [systemInfo, setSystemInfo] = useState({});
  const [autoFill, setAutoFill] = useState(false);

  // جلب معلومات النظام الحالي
  useEffect(() => {
    const loadSystemInfo = async () => {
      try {
        const info = await getSystemInfo();
        setSystemInfo(info);
      } catch (error) {
        console.error('Error loading system info:', error);
      }
    };
    loadSystemInfo();
  }, []);

  // ملء تلقائي من معلومات النظام الحالي
  useEffect(() => {
    if (autoFill && systemInfo) {
      setFormData(prev => ({
        ...prev,
        os: systemInfo.os_name || systemInfo.system || '',
        cpu: systemInfo.cpu_model || systemInfo.processor || '',
        ram: systemInfo.total_memory || '',
        capabilities: {
          usb_monitoring: true,
          power_monitoring: true,
          real_time_alerts: true,
          system: systemInfo.system || 'unknown'
        },
        config: {
          auto_scan_interval: 30,
          power_threshold: 2.5,
          alert_enabled: true
        }
      }));
    }
  }, [autoFill, systemInfo]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name || !formData.ip_address) {
      alert('يرجى ملء الحقول المطلوبة');
      return;
    }
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="row">
        {/* معلومات أساسية */}
        <div className="col-md-6">
          <h6 className="text-primary mb-3">
            <i className="fas fa-info-circle me-2"></i>
            المعلومات الأساسية
          </h6>
          
          <div className="mb-3">
            <label className="form-label">اسم الخادم *</label>
            <input
              type="text"
              className="form-control"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="مثال: خادم-فرعي-01"
              required
            />
          </div>

          <div className="mb-3">
            <label className="form-label">عنوان IP *</label>
            <input
              type="text"
              className="form-control"
              name="ip_address"
              value={formData.ip_address}
              onChange={handleChange}
              placeholder="مثال: 192.168.1.100"
              required
            />
          </div>

          <div className="mb-3">
            <label className="form-label">نظام التشغيل</label>
            <input
              type="text"
              className="form-control"
              name="os"
              value={formData.os}
              onChange={handleChange}
              placeholder="مثال: Windows 10, Ubuntu 20.04"
            />
          </div>
        </div>

        {/* معلومات النظام */}
        <div className="col-md-6">
          <h6 className="text-success mb-3">
            <i className="fas fa-desktop me-2"></i>
            معلومات النظام
          </h6>
          
          <div className="mb-3">
            <label className="form-label">المعالج</label>
            <input
              type="text"
              className="form-control"
              name="cpu"
              value={formData.cpu}
              onChange={handleChange}
              placeholder="مثال: Intel Core i7"
            />
          </div>

          <div className="mb-3">
            <label className="form-label">الذاكرة</label>
            <input
              type="text"
              className="form-control"
              name="ram"
              value={formData.ram}
              onChange={handleChange}
              placeholder="مثال: 16 GB"
            />
          </div>

          <div className="mb-3">
            <div className="form-check">
              <input
                className="form-check-input"
                type="checkbox"
                id="autoFill"
                checked={autoFill}
                onChange={(e) => setAutoFill(e.target.checked)}
              />
              <label className="form-check-label" htmlFor="autoFill">
                ملء تلقائي من معلومات النظام الحالي
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* معلومات النظام الحالي */}
      {systemInfo && Object.keys(systemInfo).length > 0 && (
        <div className="row mt-3">
          <div className="col-12">
            <div className="card bg-light">
              <div className="card-header">
                <h6 className="mb-0">
                  <i className="fas fa-info-circle me-2"></i>
                  معلومات النظام الحالي (للإشارة)
                </h6>
              </div>
              <div className="card-body">
                <div className="row">
                  <div className="col-md-4">
                    <strong>النظام:</strong> {systemInfo.os_name || systemInfo.system || 'غير محدد'}
                  </div>
                  <div className="col-md-4">
                    <strong>المعالج:</strong> {systemInfo.cpu_model || systemInfo.processor || 'غير محدد'}
                  </div>
                  <div className="col-md-4">
                    <strong>الذاكرة:</strong> {systemInfo.total_memory || 'غير محدد'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* أزرار الإجراءات */}
      <div className="row mt-4">
        <div className="col-12">
          <div className="d-flex justify-content-end gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onCancel}
              disabled={loading}
            >
              <i className="fas fa-times me-2"></i>
              إلغاء
            </button>
            <button
              type="submit"
              className="btn btn-success"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2"></span>
                  جاري الإضافة...
                </>
              ) : (
                <>
                  <i className="fas fa-plus me-2"></i>
                  إضافة الخادم الفرعي
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
};

AddSecondaryServerForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  loading: PropTypes.bool,
  onCancel: PropTypes.func.isRequired,
};

AddSecondaryServerForm.defaultProps = {
  loading: false,
};

export default AddSecondaryServerForm; 