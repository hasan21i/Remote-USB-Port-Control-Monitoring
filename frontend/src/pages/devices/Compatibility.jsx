// src/pages/devices/Compatibility.jsx

import React, { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { checkCompatibility, fetchPolicies } from '../../utils/api';
import { isValidSerialNumber } from '../../utils/validators';
import useDevice from '../../hooks/useDevice';

// تجنب استيراد useTheme في الوقت الحالي لحل مشكلة initialization
// import { useTheme } from '../../context/ThemeContext';

const deviceFields = [
  { key: 'serial_number', label: 'الرقم التسلسلي' },
  { key: 'name',          label: 'الاسم' },
  { key: 'manufacturer',  label: 'الشركة المصنعة' },
  { key: 'product',       label: 'المنتج' },
  { key: 'vendor_id',     label: 'معرف البائع' },
  { key: 'product_id',    label: 'معرف المنتج' },
  { key: 'device_type',   label: 'نوع الجهاز' }
];

const statusMap = {
  low:    { text: 'متوافق تمامًا', color: 'success', icon: 'check-circle' },
  medium: { text: 'متوافق جزئيًا', color: 'warning', icon: 'exclamation-circle' },
  high:   { text: 'غير متوافق',    color: 'danger',  icon: 'times-circle' },
};

const policyTypeLabels = {
  usb: 'USB',
  storage: 'التخزين',
  security: 'الأمان',
  network: 'الشبكة'
};

const Compatibility = () => {
  // const { isDarkMode } = useTheme();
  const isDarkMode = false; // مؤقت لحل المشكلة
  const { fetchDevice } = useDevice();

  const [serial, setSerial]     = useState('');
  const [error, setError]       = useState('');
  const [result, setResult]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [policies, setPolicies] = useState([]);
  const [policiesLoading, setPoliciesLoading] = useState(true);

  // تحميل السياسات النشطة عند تحميل الصفحة
  useEffect(() => {
    const loadPolicies = async () => {
      try {
        const response = await fetchPolicies();
        const activePolicies = Array.isArray(response.data) 
          ? response.data.filter(policy => policy.is_active)
          : [];
        setPolicies(activePolicies);
      } catch (err) {
        console.error('Failed to load policies:', err);
        setPolicies([]);
      } finally {
        setPoliciesLoading(false);
      }
    };
    
    loadPolicies();
  }, []);

  const handleSubmit = useCallback(async e => {
    e.preventDefault();
    setError('');
    setResult(null);

    if (!serial.trim()) {
      return setError('الرجاء إدخال الرقم التسلسلي');
    }
    if (!isValidSerialNumber(serial)) {
      return setError('الرقم التسلسلي غير صالح');
    }

    setLoading(true);
    try {
      // البحث عن الجهاز أولاً باستخدام الرقم التسلسلي
      let deviceData = null;
      try {
        deviceData = await fetchDevice(serial);
      } catch (deviceErr) {
        console.warn('Device not found, creating mock data for compatibility check');
        // إنشاء بيانات افتراضية للفحص
        deviceData = {
          serial_number: serial,
          name: 'جهاز غير معروف',
          manufacturer: 'غير معروف',
          product: 'غير معروف',
          vendor_id: 'unknown',
          product_id: 'unknown',
          device_type: 'unknown'
        };
      }

      // فحص التوافق
      const compatibilityResp = await checkCompatibility(serial);
      
      // دمج البيانات
      setResult({
        device: deviceData,
        compatibility: compatibilityResp.data || compatibilityResp,
        policies_checked: policies.length
      });
    } catch (err) {
      setError(err?.message || 'فشل أثناء فحص التوافق');
    } finally {
      setLoading(false);
    }
  }, [serial, fetchDevice, policies.length]);

  const renderStatus = () => {
    if (!result?.compatibility) return null;
    const { risk_level, security_score, max_score, compatible } = result.compatibility;
    const pct = max_score > 0 ? Math.round((security_score / max_score) * 100) : (compatible ? 100 : 0);
    
    // تحديد الحالة بناءً على النتائج
    let status = 'medium';
    if (compatible && pct >= 80) status = 'low';
    else if (!compatible || pct < 40) status = 'high';
    
    const cfg = statusMap[risk_level] || statusMap[status] || {
      text: 'غير معروف',
      color: 'secondary',
      icon: 'question-circle'
    };
    
    return (
      <div className="text-center mb-4">
        <i className={`fas fa-${cfg.icon} fa-3x text-${cfg.color}`} aria-hidden="true" />
        <h3 className={`mt-2 fw-bold text-${cfg.color}`}>
          {cfg.text} — {pct}%
        </h3>
        <small className="text-muted">
          تم فحص {result.policies_checked || 0} سياسة نشطة
        </small>
      </div>
    );
  };

  return (
    <div className={`compatibility-page py-5 min-vh-100 ${isDarkMode ? 'theme-dark bg-dark text-white' : 'theme-light bg-light'}`}>
      <div className="container" style={{ maxWidth: 780 }}>
        <div className="page-header mb-5 text-center">
          <h1 className="display-5 mb-2 fw-bold" style={{ letterSpacing: '.05em' }}>
            <i className="fas fa-plug text-primary me-2" /> فحص توافق جهاز USB
          </h1>
          <p className="text-muted fs-5">
            أدخل الرقم التسلسلي لأي جهاز USB لمعرفة مدى توافقه مع سياسات الأمان الحالية
          </p>
          {!policiesLoading && (
            <div className="mt-3">
              <span className="badge bg-info px-3 py-2">
                <i className="fas fa-shield-alt me-1" />
                {policies.length} سياسة نشطة جاهزة للفحص
              </span>
              {policies.length > 0 && (
                <Link to="/security/policies" className="btn btn-outline-primary btn-sm ms-2">
                  <i className="fas fa-cog me-1" />
                  إدارة السياسات
                </Link>
              )}
            </div>
          )}
        </div>

        <div className="card shadow-lg rounded-4 border-0 mb-4" style={{ overflow: 'hidden' }}>
          <div className="card-body py-4">
            <form onSubmit={handleSubmit} noValidate>
              <div className="input-group mb-3">
                <input
                  type="text"
                  className={`form-control form-control-lg ${error ? 'is-invalid' : ''}`}
                  placeholder="الرقم التسلسلي (مثال: SN-12345-XYZ)"
                  value={serial}
                  onChange={e => { setSerial(e.target.value); setError(''); }}
                  aria-label="Serial Number"
                  autoFocus
                />
                <button
                  className="btn btn-primary btn-lg px-4"
                  type="submit"
                  disabled={loading}
                  aria-busy={loading}
                >
                  {loading
                    ? <span className="spinner-border spinner-border-sm" role="status" />
                    : <><i className="fas fa-search me-1" aria-hidden="true" /> فحص</>}
                </button>
                {error && <div className="invalid-feedback d-block">{error}</div>}
              </div>
            </form>

            {result && (
              <div className="animated fadeIn">
                {renderStatus()}

                <h5 className="mb-3 text-primary">معلومات الجهاز</h5>
                <div className="table-responsive mb-4">
                  <table className="table table-bordered rounded-3 overflow-hidden">
                    <tbody>
                      {deviceFields.map(({ key, label }) => (
                        <tr key={key}>
                          <th className="bg-light text-end w-50">{label}</th>
                          <td>{result.device?.[key] ?? '—'}</td>
                        </tr>
                      ))}
                      <tr>
                        <th className="bg-light text-end">درجة الأمان</th>
                        <td>
                          {result.compatibility.security_score !== undefined ? (
                            <div className="progress" style={{ height: '22px', fontWeight: 'bold' }}>
                              <div
                                className={`progress-bar
                                  ${result.compatibility.security_score / (result.compatibility.max_score || 100) > 0.7
                                  ? 'bg-success'
                                  : result.compatibility.security_score / (result.compatibility.max_score || 100) > 0.4
                                  ? 'bg-warning'
                                  : 'bg-danger'
                                }`}
                                role="progressbar"
                                style={{ width: `${(result.compatibility.security_score / (result.compatibility.max_score || 100)) * 100}%` }}
                              >
                                {result.compatibility.security_score} / {result.compatibility.max_score || 100}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted">غير متاح</span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <th className="bg-light text-end">التوافق مع السياسات</th>
                        <td>
                          {result.compatibility.compatible
                            ? <span className="badge bg-success px-3 py-2 fs-6"><i className="fas fa-check me-1" /> نعم</span>
                            : <span className="badge bg-danger px-3 py-2 fs-6"><i className="fas fa-times me-1" /> لا</span>
                          }
                        </td>
                      </tr>
                      <tr>
                        <th className="bg-light text-end">موثوق من الشركة المصنعة</th>
                        <td>
                          {result.compatibility.trusted
                            ? <span className="badge bg-success px-3 py-2 fs-6"><i className="fas fa-check me-1" /> نعم</span>
                            : <span className="badge bg-danger px-3 py-2 fs-6"><i className="fas fa-times me-1" /> لا</span>
                          }
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <h5 className="mt-4 mb-3 text-info">
                  <i className="fas fa-shield-alt me-2" />
                  نتائج فحص السياسات ({policies.length} سياسة)
                </h5>
                
                {/* عرض السياسات المطبقة */}
                {result.compatibility.policies_matched?.length > 0 ? (
                  <div className="mb-3">
                    <h6 className="text-success mb-2">
                      <i className="fas fa-check-circle me-1" />
                      السياسات المطبقة على هذا الجهاز:
                    </h6>
                    <div className="row">
                      {result.compatibility.policies_matched.map((policy, i) => (
                        <div key={i} className="col-md-6 mb-2">
                          <div className="card border-success">
                            <div className="card-body py-2">
                              <h6 className="card-title mb-1 text-success">{policy.policy_name}</h6>
                              <small className="text-muted">
                                النوع: {policyTypeLabels[policy.policy_type] || policy.policy_type}
                              </small>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="alert alert-warning">
                    <i className="fas fa-exclamation-triangle me-2" />
                    لا توجد سياسات محددة تنطبق على هذا الجهاز
                  </div>
                )}
                
                {/* عرض التحذيرات إن وجدت */}
                {result.compatibility.warnings?.length > 0 && (
                  <div className="mb-3">
                    <h6 className="text-warning mb-2">
                      <i className="fas fa-exclamation-triangle me-1" />
                      تحذيرات السياسات:
                    </h6>
                    <ul className="list-group">
                      {result.compatibility.warnings.map((warning, i) => (
                        <li key={i} className="list-group-item list-group-item-warning">
                          <i className="fas fa-exclamation-circle me-2" />
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {/* عرض الأخطاء إن وجدت */}
                {result.compatibility.errors?.length > 0 && (
                  <div className="mb-3">
                    <h6 className="text-danger mb-2">
                      <i className="fas fa-times-circle me-1" />
                      مخالفات السياسات:
                    </h6>
                    <ul className="list-group">
                      {result.compatibility.errors.map((error, i) => (
                        <li key={i} className="list-group-item list-group-item-danger">
                          <i className="fas fa-times-circle me-2" />
                          {error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <h5 className="mt-4 mb-2 text-info">التوصيات الأمنية</h5>
                {result.compatibility.recommendations?.length > 0 ? (
                  <ul className="list-group rounded-3">
                    {result.compatibility.recommendations.map((rec, i) => (
                      <li key={i} className="list-group-item bg-light">
                        <i className="fas fa-lightbulb text-warning me-2" aria-hidden="true" />
                        {rec}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="alert alert-info">
                    <i className="fas fa-info-circle me-2" />
                    {result.compatibility.compatible 
                      ? 'الجهاز متوافق مع جميع السياسات الحالية. لا توجد توصيات إضافية.'
                      : 'يُنصح بمراجعة السياسات أو إضافة الجهاز للقائمة البيضاء إذا كان آمناً.'}
                  </div>
                )}
              </div>
            )}
          </div>

          {result && (
            <div className="card-footer text-end bg-white border-0">
              <button
                className="btn btn-outline-secondary"
                onClick={() => { setSerial(''); setResult(null); setError(''); }}
              >
                <i className="fas fa-undo me-1" aria-hidden="true" /> فحص آخر
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Compatibility;
