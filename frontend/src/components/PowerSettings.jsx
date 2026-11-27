import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { toast } from 'react-toastify';
import { updatePowerThresholds, togglePowerMonitoring } from '../utils/api';

const PowerSettings = ({ serverId, currentThresholds = {}, onUpdate }) => {
  const [loading, setLoading] = useState(false);
  const [thresholds, setThresholds] = useState({
    total_threshold: currentThresholds.total_power || 50,
    port_threshold: currentThresholds.port_power || 10,
    idle_threshold: currentThresholds.idle_threshold || 0.1
  });
  const [monitoringEnabled, setMonitoringEnabled] = useState(true);

  useEffect(() => {
    setThresholds({
      total_threshold: currentThresholds.total_power || 50,
      port_threshold: currentThresholds.port_power || 10,
      idle_threshold: currentThresholds.idle_threshold || 0.1
    });
  }, [currentThresholds]);

  const handleThresholdChange = (field, value) => {
    setThresholds(prev => ({
      ...prev,
      [field]: parseFloat(value) || 0
    }));
  };

  const handleSaveThresholds = async () => {
    try {
      setLoading(true);
      await updatePowerThresholds(serverId, thresholds);
      toast.success('تم تحديث عتبات الطاقة بنجاح');
      if (onUpdate) {
        onUpdate(thresholds);
      }
    } catch (error) {
      toast.error('فشل في تحديث عتبات الطاقة');
      console.error('Error updating power thresholds:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleMonitoring = async (enabled) => {
    try {
      setLoading(true);
      const action = enabled ? 'start' : 'stop';
      await togglePowerMonitoring(serverId, action);
      setMonitoringEnabled(enabled);
      toast.success(enabled ? 'تم تشغيل مراقبة الطاقة' : 'تم إيقاف مراقبة الطاقة');
    } catch (error) {
      toast.error('فشل في تغيير حالة المراقبة');
      console.error('Error toggling power monitoring:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="power-settings">
      <div className="card">
        <div className="card-header">
          <h6 className="mb-0">
            <i className="fas fa-cog me-2"></i>
            إعدادات مراقبة الطاقة
          </h6>
        </div>
        <div className="card-body">
          {/* تشغيل/إيقاف المراقبة */}
          <div className="row mb-4">
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="monitoringToggle"
                  checked={monitoringEnabled}
                  onChange={(e) => handleToggleMonitoring(e.target.checked)}
                  disabled={loading}
                />
                <label className="form-check-label" htmlFor="monitoringToggle">
                  مراقبة استهلاك الطاقة
                </label>
                <small className="form-text text-muted d-block">
                  تفعيل المراقبة التلقائية لاستهلاك الطاقة وإرسال التنبيهات
                </small>
              </div>
            </div>
          </div>

          {/* عتبات الطاقة */}
          <div className="row">
            <div className="col-md-4 mb-3">
              <label htmlFor="totalThreshold" className="form-label">
                عتبة إجمالي الطاقة (واط)
              </label>
              <input
                type="number"
                className="form-control"
                id="totalThreshold"
                value={thresholds.total_threshold}
                onChange={(e) => handleThresholdChange('total_threshold', e.target.value)}
                min="0"
                step="0.1"
                disabled={loading}
              />
              <small className="form-text text-muted">
                الحد الأقصى لإجمالي استهلاك الطاقة
              </small>
            </div>

            <div className="col-md-4 mb-3">
              <label htmlFor="portThreshold" className="form-label">
                عتبة الطاقة لكل منفذ (واط)
              </label>
              <input
                type="number"
                className="form-control"
                id="portThreshold"
                value={thresholds.port_threshold}
                onChange={(e) => handleThresholdChange('port_threshold', e.target.value)}
                min="0"
                step="0.1"
                disabled={loading}
              />
              <small className="form-text text-muted">
                الحد الأقصى لاستهلاك الطاقة لكل منفذ
              </small>
            </div>

            <div className="col-md-4 mb-3">
              <label htmlFor="idleThreshold" className="form-label">
                عتبة المنافذ غير المستخدمة (واط)
              </label>
              <input
                type="number"
                className="form-control"
                id="idleThreshold"
                value={thresholds.idle_threshold}
                onChange={(e) => handleThresholdChange('idle_threshold', e.target.value)}
                min="0"
                step="0.01"
                disabled={loading}
              />
              <small className="form-text text-muted">
                الحد الأدنى لاعتبار المنفذ غير مستخدم
              </small>
            </div>
          </div>

          {/* زر الحفظ */}
          <div className="row">
            <div className="col-12">
              <button
                className="btn btn-primary"
                onClick={handleSaveThresholds}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                    جاري الحفظ...
                  </>
                ) : (
                  <>
                    <i className="fas fa-save me-2"></i>
                    حفظ الإعدادات
                  </>
                )}
              </button>
            </div>
          </div>

          {/* معلومات إضافية */}
          <div className="row mt-4">
            <div className="col-12">
              <div className="alert alert-info">
                <h6>
                  <i className="fas fa-info-circle me-2"></i>
                  معلومات حول مراقبة الطاقة
                </h6>
                <ul className="mb-0">
                  <li>يتم فحص استهلاك الطاقة كل 30 ثانية</li>
                  <li>سيتم إرسال تنبيه عند تجاوز العتبات المحددة</li>
                  <li>يمكن تعطيل المنافذ غير المستخدمة تلقائياً لتوفير الطاقة</li>
                  <li>يتم حفظ بيانات الطاقة لمدة أسبوع واحد</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

PowerSettings.propTypes = {
  serverId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  currentThresholds: PropTypes.shape({
    warning_threshold: PropTypes.number,
    critical_threshold: PropTypes.number,
    auto_disable_threshold: PropTypes.number
  }),
  onUpdate: PropTypes.func.isRequired
};

PowerSettings.defaultProps = {
  currentThresholds: {
    warning_threshold: 50,
    critical_threshold: 80,
    auto_disable_threshold: 100
  }
};

export default PowerSettings; 