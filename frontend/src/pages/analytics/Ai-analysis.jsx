// src/pages/analytics/AiAnalysis.jsx

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { 
  fetchAIReports,
  analyzeAI,
  analyzeAllAI,
  performAdvancedAIAnalysis,
  listDevices,
  fetchAIStats
} from '../../utils/api';
import { formatDateTime, formatNumber, formatPercent } from '../../utils/formatters';
import { isValidSerialNumber } from '../../utils/validators';
import Modal from '../../components/Modal';

// Analysis types with enhanced descriptions
const ANALYSIS_TYPES = [
  { 
    value: 'security_scan', 
    label: 'فحص الأمان',
    description: 'فحص شامل للكشف عن التهديدات الأمنية والبرمجيات الخبيثة',
    icon: 'fa-shield-alt',
    color: '#e74c3c'
  },
  { 
    value: 'performance_analysis', 
    label: 'تحليل الأداء',
    description: 'تحليل كفاءة الجهاز واستهلاك الموارد والبطء',
    icon: 'fa-tachometer-alt',
    color: '#f39c12'
  },
  { 
    value: 'behavioral_analysis', 
    label: 'تحليل السلوك',
    description: 'مراقبة أنماط الاستخدام واكتشاف السلوك الشاذ',
    icon: 'fa-eye',
    color: 'var(--primary-color)'
  }
];

const RISK_LEVELS = {
  'high': { label: 'مرتفع', color: '#e74c3c', bgColor: '#ffeaea' },
  'مرتفع': { label: 'مرتفع', color: '#e74c3c', bgColor: '#ffeaea' },
  'medium': { label: 'متوسط', color: '#f39c12', bgColor: '#fff4e6' },
  'متوسط': { label: 'متوسط', color: '#f39c12', bgColor: '#fff4e6' },
  'low': { label: 'منخفض', color: '#27ae60', bgColor: '#eafaf1' },
  'منخفض': { label: 'منخفض', color: '#27ae60', bgColor: '#eafaf1' }
};

const AiAnalysis = () => {
  // Theme detection
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return document.documentElement.getAttribute('data-bs-theme') === 'dark';
  });

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const currentTheme = document.documentElement.getAttribute('data-bs-theme');
      setIsDarkMode(currentTheme === 'dark');
    });
    
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-bs-theme']
    });
    
    return () => observer.disconnect();
  }, []);

  // Theme styles
  const themeStyles = useMemo(() => ({
    background: isDarkMode ? '#0f141b' : '#f2f4f7',
    cardBg: isDarkMode ? '#161d26' : '#ffffff',
    cardAlt: isDarkMode ? '#1d2733' : '#f7f9fc',
    textColor: isDarkMode ? '#e6ebf1' : '#1f2937',
    mutedColor: isDarkMode ? '#9aa7b8' : '#6b7280',
    borderColor: isDarkMode ? '#2c3a4c' : '#d6dde6',
    headingColor: isDarkMode ? '#f2f5f9' : '#111827',
    accent: isDarkMode ? '#7f96ad' : '#455a73',
    fontFamily: isDarkMode
      ? '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif'
      : '"Noto Kufi Arabic", "Segoe UI", Tahoma, sans-serif'
  }), [isDarkMode]);

  // State management
  const [reports, setReports] = useState([]);
  const [devices, setDevices] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalAnalyzeVisible, setModalAnalyzeVisible] = useState(false);
  const [modalAdvancedVisible, setModalAdvancedVisible] = useState(false);
  const [modalViewVisible, setModalViewVisible] = useState(false);
  const [modalBulkVisible, setModalBulkVisible] = useState(false);
  
  // Form states
  const [serial, setSerial] = useState('');
  const [serialError, setSerialError] = useState('');
  const [analysisType, setAnalysisType] = useState(ANALYSIS_TYPES[0].value);
  // eslint-disable-next-line no-unused-vars
  const [mistralKey] = useState('TtFCHbCf3iM6QT92TPdmvRk3CFbvWots'); // Mistral API key
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selected, setSelected] = useState(null);
  const [loadingLong, setLoadingLong] = useState(false);
  
  // Filters
  const [filters, setFilters] = useState({
    analysisType: '',
    riskLevel: '',
    dateRange: 7,
    showAnomalies: false
  });

  // Load all data
  const loadData = useCallback(async () => {
    // التحقق من المصادقة أولاً
    const token = localStorage.getItem('access_token');
    if (!token) {
      setError('يجب تسجيل الدخول أولاً');
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadingLong(false);
    setError('');
    // eslint-disable-next-line no-console
    console.log('AI loadData: starting fetch with filters', filters);
    let loadTimer = setTimeout(() => setLoadingLong(true), 12000);
    try {
      const [reportsRes, devicesRes, statsRes] = await Promise.all([
        fetchAIReports({ days: filters.dateRange }).catch((e) => { console.error('fetchAIReports failed', e); return { reports: [] }; }),
        listDevices({ real_only: false }).catch((e) => { console.error('listDevices failed', e); return { data: [] }; }),
        fetchAIStats({ days: filters.dateRange }).catch((e) => { console.error('fetchAIStats failed', e); return { data: null }; })
      ]);
      // eslint-disable-next-line no-console
      console.log('AI loadData: fetch completed', devicesRes);

      // حماية إضافية
      let reportsData = (reportsRes && Array.isArray(reportsRes.reports)) ? reportsRes.reports : [];
      // Apply filters
      if (filters.analysisType) {
        reportsData = reportsData.filter(r => r.analysis_type === filters.analysisType);
      }
      if (filters.showAnomalies) {
        reportsData = reportsData.filter(r => r.is_anomaly);
      }

      setReports(reportsData);
      setDevices((devicesRes && devicesRes.data) ? devicesRes.data : []);
      setStats((statsRes && statsRes.data) ? statsRes.data : null);
    } catch (err) {
      console.error('Error loading AI data:', err);
      
      // التحقق من أخطاء المصادقة
      if (err.response?.status === 401) {
        setError('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى');
        // يمكن إضافة إعادة توجيه إلى صفحة تسجيل الدخول هنا
        // window.location.href = '/login';
      } else if (err.response?.status === 403) {
        setError('ليس لديك صلاحية للوصول إلى هذه الخدمة');
      } else {
        setError('فشل في جلب بيانات التحليل');
      }
    } finally {
      clearTimeout(loadTimer);
      setLoadingLong(false);
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Device analysis
  const handleAnalyzeDevice = useCallback(async (isAdvanced = false) => {
    // التحقق من المصادقة أولاً
    const token = localStorage.getItem('access_token');
    if (!token) {
      setSerialError('يجب تسجيل الدخول أولاً');
      return;
    }

    if (!serial.trim()) {
      setSerialError('الرجاء إدخال الرقم التسلسلي');
      return;
    }
    if (!isValidSerialNumber(serial)) {
      setSerialError('الرقم التسلسلي غير صالح');
      return;
    }
    setSerialError('');
    setError('');
    setIsAnalyzing(true);

    try {
      const requestData = {
        serial_number: serial,
        analysis_type: analysisType
      };

      let res;
      if (isAdvanced) {
        requestData.use_openai = false;
        requestData.provider = 'mistral';
        requestData.mistral_api_key = mistralKey;
        res = await performAdvancedAIAnalysis(requestData);
      } else {
        res = await analyzeAI(requestData);
      }

      // Normalize response to obtain report object (support axios response or direct data)
      const payload = (res && (res.report || res.data?.report)) ? (res.report || res.data.report) : res;
      const report = (payload && payload.report) ? payload.report : payload;
      setReports(prev => [report, ...prev]);
      setSelected(report);
      setModalAnalyzeVisible(false);
      setModalAdvancedVisible(false);
      setModalViewVisible(true);
      setSerial('');
      setAnalysisType(ANALYSIS_TYPES[0].value);
      // Refresh reports from server to ensure database is in sync
      await loadData();
    } catch (err) {
      console.error('Analysis error:', err);
      
      // التحقق من أخطاء المصادقة
      if (err.response?.status === 401) {
        setSerialError('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى');
        // يمكن إضافة إعادة توجيه إلى صفحة تسجيل الدخول هنا
        // window.location.href = '/login';
      } else if (err.response?.status === 403) {
        setSerialError('ليس لديك صلاحية للوصول إلى هذه الخدمة');
      } else {
        setSerialError(err.message || 'خطأ أثناء تحليل الجهاز');
      }
    } finally {
      setIsAnalyzing(false);
    }
  }, [serial, analysisType, mistralKey]);

  // Bulk analysis
  const handleAnalyzeAll = useCallback(async () => {
    // التحقق من المصادقة أولاً
    const token = localStorage.getItem('access_token');
    if (!token) {
      alert('يجب تسجيل الدخول أولاً');
      return;
    }

    const connectedCount = devices.filter(d => d.status === 'connected').length;
    if (connectedCount === 0) {
      alert('لا توجد أجهزة متصلة للتحليل');
      return;
    }
    
    if (!window.confirm(`هل تريد تحليل جميع الأجهزة المتصلة (${connectedCount} جهاز)؟`)) return;
    
    setLoading(true);
    setError('');
    try {
      await analyzeAllAI({ analysis_type: analysisType });
      await loadData();
      alert(`بدأ تحليل ${connectedCount} جهاز. النتائج ستظهر عند اكتمالها.`);
      setModalBulkVisible(false);
    } catch (err) {
      console.error('Bulk analysis error:', err);
      
      // التحقق من أخطاء المصادقة
      if (err.response?.status === 401) {
        setError('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى');
        // يمكن إضافة إعادة توجيه إلى صفحة تسجيل الدخول هنا
        // window.location.href = '/login';
      } else if (err.response?.status === 403) {
        setError('ليس لديك صلاحية للوصول إلى هذه الخدمة');
      } else {
        setError(err.message || 'خطأ أثناء تحليل جميع الأجهزة');
      }
    } finally {
      setLoading(false);
    }
  }, [analysisType, devices, loadData]);

  // View report details
  const openReport = useCallback(report => {
    setSelected(report);
    setModalViewVisible(true);
  }, []);

  // Get analysis type info
  const getAnalysisTypeInfo = useCallback((type) => {
    return ANALYSIS_TYPES.find(t => t.value === type) || ANALYSIS_TYPES[0];
  }, []);

  // Risk badge component
  const RiskBadge = ({ report }) => {
    // التحقق من نوع البيانات
    if (!report || typeof report === 'string') {
      return (
        <span className="badge bg-secondary">
          <i className="fas fa-question-circle me-1"></i>
          غير محدد
        </span>
      );
    }

    if (!report.is_anomaly) {
      return (
        <span className="badge bg-success">
          <i className="fas fa-shield-alt me-1"></i>
          آمن
        </span>
      );
    }

    const severity = report.confidence_score > 0.8 ? 'high' : 'medium';
    const riskInfo = RISK_LEVELS[severity];

    return (
      <span
        className="badge text-white"
        style={{ backgroundColor: riskInfo.color }}
      >
        <i className="fas fa-exclamation-triangle me-1"></i>
        {riskInfo.label}
      </span>
    );
  };

  RiskBadge.propTypes = {
    report: PropTypes.oneOfType([
      PropTypes.shape({
        is_anomaly: PropTypes.bool,
        confidence_score: PropTypes.number
      }),
      PropTypes.string
    ])
  };

  const ConfidenceBar = ({ score }) => {
    // التحقق من صحة الـ score
    const validScore = typeof score === 'number' && !isNaN(score) ? Math.max(0, Math.min(1, score)) : 0;

    return (
      <div className="d-flex align-items-center">
        <div className="progress flex-grow-1 me-2" style={{ height: '6px' }}>
          <div
            className={`progress-bar ${validScore > 0.8 ? 'bg-success' : validScore > 0.6 ? 'bg-warning' : 'bg-danger'}`}
            style={{ width: `${validScore * 100}%` }}
          />
        </div>
        <small className="text-muted">{formatPercent(validScore * 100)}</small>
      </div>
    );
  };

  ConfidenceBar.propTypes = {
    score: PropTypes.number
  };

  if (loading && reports.length === 0) {
    return (
      <div className="text-center py-5" style={{ backgroundColor: themeStyles.background, minHeight: '100vh', color: themeStyles.textColor }}>
        <div className="spinner-border text-primary mb-3" role="status" style={{ width: '3rem', height: '3rem' }}>
          <span className="visually-hidden">جاري التحميل...</span>
        </div>
        <h4>جاري تحميل تحليلات الذكاء الاصطناعي...</h4>
        <p style={{ color: themeStyles.mutedColor }}>يرجى الانتظار بينما نجمع البيانات والتقارير</p>
        {loadingLong && (
          <p style={{ color: '#f1c40f' }}>التحميل يتأخر — تأكد من تشغيل الخادم الخلفي أو افتح أدوات المطور لرؤية الأخطاء</p>
        )}
      </div>
    );
  }

  const sectionShellStyle = {
    backgroundColor: themeStyles.cardBg,
    border: `1px solid ${themeStyles.borderColor}`,
    borderRadius: 0,
    boxShadow: 'none'
  };

  return (
    <div className="ai-analysis-page" style={{ backgroundColor: themeStyles.background, minHeight: '100vh', color: themeStyles.textColor, fontFamily: themeStyles.fontFamily }}>
      <style>{`
        .ai-analysis-page .card,
        .ai-analysis-page .btn,
        .ai-analysis-page .form-select,
        .ai-analysis-page .form-control,
        .ai-analysis-page .alert,
        .ai-analysis-page .badge,
        .ai-analysis-page .progress,
        .ai-analysis-page .table,
        .ai-analysis-page .table th,
        .ai-analysis-page .table td {
          border-radius: 0 !important;
        }

        .ai-analysis-page .card {
          box-shadow: none !important;
        }

        .ai-analysis-page .btn-corporate {
          border: 1px solid ${themeStyles.borderColor};
          background: ${themeStyles.cardBg};
          color: ${themeStyles.textColor};
          font-weight: 700;
        }

        .ai-analysis-page .btn-corporate:hover {
          background: ${themeStyles.cardAlt};
          border-color: ${themeStyles.accent};
          color: ${themeStyles.headingColor};
        }
      `}</style>
      <div className="container-fluid py-4">
        
        {/* Hero Header */}
        <div className="row mb-4">
          <div className="col-12">
            <div className="card" style={sectionShellStyle}>
              <div className="card-body py-4" style={{ backgroundColor: themeStyles.cardBg }}>
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
                  <div>
                    <h1 className="h3 mb-2 fw-bold" style={{ color: themeStyles.headingColor }}>
                      مركز التحليل الذكي للأجهزة الطرفية
                    </h1>
                    <p className="mb-0" style={{ color: themeStyles.mutedColor, fontSize: '0.96rem' }}>
                      واجهة متابعة مؤسسية لنتائج الفحص الأمني والسلوكي والأدائي
                    </p>
                  </div>
                  <div className="d-flex gap-2 flex-wrap">
                    <button 
                      className="btn btn-corporate"
                      onClick={() => setModalAdvancedVisible(true)}
                    >
                      تشغيل تحليل متقدم
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Statistics Cards */}
        {stats && (
          <div className="row mb-4 g-3">
            <div className="col-lg-3 col-md-6">
              <div className="p-3 h-100" style={{ ...sectionShellStyle, borderInlineStart: `4px solid ${themeStyles.accent}` }}>
                <div className="small mb-2" style={{ color: themeStyles.mutedColor }}>إجمالي التقارير</div>
                <div className="h4 mb-0 fw-bold" style={{ color: themeStyles.headingColor }}>{formatNumber(stats.total_reports || 0)}</div>
              </div>
            </div>
            <div className="col-lg-3 col-md-6">
              <div className="p-3 h-100" style={{ ...sectionShellStyle, borderInlineStart: '4px solid #8b1e1e' }}>
                <div className="small mb-2" style={{ color: themeStyles.mutedColor }}>شذوذات مكتشفة</div>
                <div className="h4 mb-0 fw-bold" style={{ color: themeStyles.headingColor }}>{formatNumber(stats.anomalies || 0)}</div>
              </div>
            </div>
            <div className="col-lg-3 col-md-6">
              <div className="p-3 h-100" style={{ ...sectionShellStyle, borderInlineStart: '4px solid #1f6f4a' }}>
                <div className="small mb-2" style={{ color: themeStyles.mutedColor }}>أجهزة نشطة</div>
                <div className="h4 mb-0 fw-bold" style={{ color: themeStyles.headingColor }}>{formatNumber(devices.filter(d => d.status === 'connected').length)}</div>
              </div>
            </div>
            <div className="col-lg-3 col-md-6">
              <div className="p-3 h-100" style={{ ...sectionShellStyle, borderInlineStart: '4px solid #9b6c17' }}>
                <div className="small mb-2" style={{ color: themeStyles.mutedColor }}>نشاط حديث</div>
                <div className="h4 mb-0 fw-bold" style={{ color: themeStyles.headingColor }}>{stats.recent_reports ? formatPercent((stats.recent_reports / (stats.total_reports || 1)) * 100) : '0%'}</div>
              </div>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="row mb-4">
            <div className="col-12">
              <div className="alert alert-danger alert-dismissible fade show shadow-sm" role="alert">
                <i className="fas fa-exclamation-triangle me-2"></i>
                {error}
                <button type="button" className="btn-close" onClick={() => setError('')}></button>
              </div>
            </div>
          </div>
        )}

        {/* Analysis Types Overview */}
        <div className="row mb-4">
          <div className="col-12">
            <div className="card" style={sectionShellStyle}>
              <div className="card-header py-3" style={{ backgroundColor: themeStyles.cardBg, borderBottom: `1px solid ${themeStyles.borderColor}` }}>
                <h5 className="mb-0 fw-bold" style={{ color: themeStyles.textColor }}>
                  <i className="fas fa-tasks me-2"></i>
                  أنواع التحليل المتاحة
                </h5>
              </div>
              <div className="card-body" style={{ backgroundColor: themeStyles.cardBg }}>
                <div className="row">
                  {ANALYSIS_TYPES.map((type) => (
                    <div key={type.value} className="col-lg-4 mb-3">
                      <div 
                        className="p-3 h-100 border"
                        style={{ 
                          backgroundColor: themeStyles.cardAlt,
                          borderColor: themeStyles.borderColor 
                        }}
                      >
                        <div className="d-flex align-items-center mb-2">
                          <i 
                            className={`fas ${type.icon} me-2`} 
                            style={{ color: type.color, fontSize: '20px' }}
                          ></i>
                          <h6 className="mb-0 fw-bold" style={{ color: themeStyles.textColor }}>
                            {type.label}
                          </h6>
                        </div>
                        <p className="mb-0 small" style={{ color: themeStyles.mutedColor }}>
                          {type.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Filters and Controls */}
        <div className="row mb-4">
          <div className="col-12">
            <div className="card" style={sectionShellStyle}>
              <div className="card-body" style={{ backgroundColor: themeStyles.cardBg }}>
                <div className="row align-items-center">
                  <div className="col-lg-2 col-md-6 mb-2">
                    <select
                      className="form-select"
                      value={filters.analysisType}
                      onChange={(e) => setFilters(prev => ({ ...prev, analysisType: e.target.value }))}
                    >
                      <option value="">جميع الأنواع</option>
                      {ANALYSIS_TYPES.map(type => (
                        <option key={type.value} value={type.value}>{type.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-lg-2 col-md-6 mb-2">
                    <select
                      className="form-select"
                      value={filters.dateRange}
                      onChange={(e) => setFilters(prev => ({ ...prev, dateRange: parseInt(e.target.value) }))}
                    >
                      <option value={1}>آخر 24 ساعة</option>
                      <option value={7}>آخر أسبوع</option>
                      <option value={30}>آخر شهر</option>
                      <option value={90}>آخر 3 شهور</option>
                    </select>
                  </div>
                  <div className="col-lg-2 col-md-6 mb-2">
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="showAnomalies"
                        checked={filters.showAnomalies}
                        onChange={(e) => setFilters(prev => ({ ...prev, showAnomalies: e.target.checked }))}
                      />
                      <label className="form-check-label" htmlFor="showAnomalies" style={{ color: themeStyles.textColor }}>
                        الشذوذات فقط
                      </label>
                    </div>
                  </div>
                  <div className="col-lg-6 col-md-6 mb-2 text-end">
                    <button 
                      className="btn btn-corporate"
                      onClick={loadData}
                      disabled={loading}
                    >
                      <i className={`fas fa-sync-alt me-2 ${loading ? 'fa-spin' : ''}`}></i>
                      تحديث
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Reports Table */}
        <div className="row">
          <div className="col-12">
            <div className="card" style={sectionShellStyle}>
              <div className="card-header py-3" style={{ backgroundColor: themeStyles.cardBg, borderBottom: `1px solid ${themeStyles.borderColor}` }}>
                <div className="d-flex justify-content-between align-items-center">
                  <h5 className="mb-0 fw-bold" style={{ color: themeStyles.textColor }}>
                    <i className="fas fa-list me-2"></i>
                    تقارير التحليل ({formatNumber(reports.length)})
                  </h5>
                  <div className="d-flex align-items-center gap-2">
                    {filters.showAnomalies && (
                      <span className="badge bg-warning text-dark">
                        <i className="fas fa-filter me-1"></i>
                        الشذوذات فقط
                      </span>
                    )}
                    {loading && (
                      <div className="spinner-border spinner-border-sm text-primary" role="status">
                        <span className="visually-hidden">جاري التحميل...</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="card-body p-0" style={{ backgroundColor: themeStyles.cardBg }}>
                {reports.length === 0 ? (
                  <div className="text-center py-5">
                    <i className="fas fa-robot mb-3" style={{ fontSize: '48px', color: themeStyles.mutedColor }}></i>
                    <h6 style={{ color: themeStyles.textColor }}>لا توجد تقارير تحليل</h6>
                    <p style={{ color: themeStyles.mutedColor }}>ابدأ بتحليل الأجهزة للحصول على تقارير مفصلة</p>
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover mb-0">
                      <thead style={{ backgroundColor: themeStyles.cardAlt }}>
                        <tr>
                          <th style={{ color: themeStyles.textColor, borderColor: themeStyles.borderColor }}>
                            <i className="fas fa-desktop me-1"></i>
                            الجهاز
                          </th>
                          <th style={{ color: themeStyles.textColor, borderColor: themeStyles.borderColor }}>
                            <i className="fas fa-cog me-1"></i>
                            نوع التحليل
                          </th>
                          <th style={{ color: themeStyles.textColor, borderColor: themeStyles.borderColor }}>
                            <i className="fas fa-calendar me-1"></i>
                            التاريخ
                          </th>
                          <th style={{ color: themeStyles.textColor, borderColor: themeStyles.borderColor }}>
                            <i className="fas fa-percentage me-1"></i>
                            الثقة
                          </th>
                          <th style={{ color: themeStyles.textColor, borderColor: themeStyles.borderColor }}>
                            <i className="fas fa-shield-alt me-1"></i>
                            المخاطرة
                          </th>
                          <th style={{ color: themeStyles.textColor, borderColor: themeStyles.borderColor }}>
                            <i className="fas fa-cogs me-1"></i>
                            الإجراءات
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports.map((report, i) => {
                          const device = devices.find(d => d.serial_number === report.related_device);
                          const typeInfo = getAnalysisTypeInfo(report.analysis_type);
                          return (
                            <tr key={report.id || report._id || i} style={{ backgroundColor: themeStyles.cardBg }}>
                              <td style={{ borderColor: themeStyles.borderColor }}>
                                <div>
                                  <div className="fw-bold" style={{ color: themeStyles.textColor }}>
                                    {device?.name || 'جهاز غير معروف'}
                                  </div>
                                  <small style={{ color: themeStyles.mutedColor }}>
                                    {report.related_device}
                                  </small>
                                </div>
                              </td>
                              <td style={{ borderColor: themeStyles.borderColor }}>
                                <span className="px-2 py-1" style={{ border: `1px solid ${typeInfo.color}`, color: typeInfo.color, backgroundColor: 'transparent', fontSize: '0.8rem', fontWeight: 700 }}>
                                  <i className={`fas ${typeInfo.icon} me-1`}></i>
                                  {typeInfo.label}
                                </span>
                              </td>
                              <td style={{ borderColor: themeStyles.borderColor, color: themeStyles.textColor }}>
                                {formatDateTime(report.timestamp)}
                              </td>
                              <td style={{ borderColor: themeStyles.borderColor }}>
                                <ConfidenceBar score={report.confidence_score} />
                              </td>
                              <td style={{ borderColor: themeStyles.borderColor }}>
                                <RiskBadge report={report} />
                              </td>
                              <td style={{ borderColor: themeStyles.borderColor }}>
                                <button 
                                  className="btn btn-corporate btn-sm"
                                  onClick={() => openReport(report)}
                                >
                                  <i className="fas fa-eye me-1"></i>
                                  عرض
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Basic Analysis Modal */}
        <Modal
          show={modalAnalyzeVisible}
          title={
            <div className="d-flex align-items-center">
              <i className="fas fa-search me-2 text-primary"></i>
              تحليل جهاز واحد
            </div>
          }
          onClose={() => {
            setModalAnalyzeVisible(false);
            setSerial('');
            setSerialError('');
            setAnalysisType(ANALYSIS_TYPES[0].value);
          }}
        >
          <div className="mb-3">
            <label className="form-label fw-bold">
              <i className="fas fa-barcode me-1"></i>
              الرقم التسلسلي للجهاز
            </label>
            <input
              className={`form-control ${serialError ? 'is-invalid' : ''}`}
              value={serial}
              onChange={e => { setSerial(e.target.value); setSerialError(''); }}
              placeholder="أدخل الرقم التسلسلي للجهاز"
            />
            {serialError && <div className="invalid-feedback">{serialError}</div>}
          </div>
          <div className="mb-4">
            <label className="form-label fw-bold">
              <i className="fas fa-cog me-1"></i>
              نوع التحليل
            </label>
            <select
              className="form-select"
              value={analysisType}
              onChange={e => setAnalysisType(e.target.value)}
            >
              {ANALYSIS_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
            <div className="form-text">
              {getAnalysisTypeInfo(analysisType).description}
            </div>
          </div>
          <div className="text-end">
            <button 
              className="btn btn-secondary me-2" 
              onClick={() => setModalAnalyzeVisible(false)}
              disabled={isAnalyzing}
            >
              إلغاء
            </button>
            <button 
              className="btn btn-primary" 
              onClick={() => handleAnalyzeDevice(false)}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                  جاري التحليل...
                </>
              ) : (
                <>
                  <i className="fas fa-play me-2"></i>
                  ابدأ التحليل
                </>
              )}
            </button>
          </div>
        </Modal>

        {/* Advanced Analysis Modal */}
        <Modal
          show={modalAdvancedVisible}
          title={
            <div className="d-flex align-items-center">
              <i className="fas fa-magic me-2 text-success"></i>
              تحليل متقدم بالذكاء الاصطناعي
            </div>
          }
          onClose={() => {
            setModalAdvancedVisible(false);
            setSerial('');
            setSerialError('');
            setAnalysisType(ANALYSIS_TYPES[0].value);
          }}
        >
          <div className="alert alert-info">
            <i className="fas fa-info-circle me-2"></i>
            التحليل المتقدم يستخدم Mistral AI لتقديم تحليل أعمق وأكثر دقة
          </div>
          
          {/* قائمة الأجهزة المتاحة للتحليل */}
          <div className="mb-3">
            <label className="form-label fw-bold" style={{ color: themeStyles.textColor }}>
              <i className="fas fa-laptop me-1"></i>
              اختر جهاز للتحليل ({devices.length} جهاز متاح)
            </label>
            {devices.length > 0 ? (
              <div 
                className="row g-3" 
                style={{ 
                  maxHeight: '350px', 
                  overflowY: 'auto',
                  padding: '5px'
                }}
              >
                {devices.map(device => (
                  <div key={device.id || device.serial_number} className="col-12 col-md-6">
                    <div 
                      className={`card h-100 cursor-pointer border-2 transition-all ${serial === device.serial_number ? 'border-primary shadow-sm' : 'border-light'}`}
                      style={{ 
                        cursor: 'pointer',
                        backgroundColor: serial === device.serial_number 
                          ? (isDarkMode ? '#243141' : '#e8eef6') 
                          : themeStyles.cardAlt,
                        borderRadius: '0',
                        borderColor: serial === device.serial_number ? themeStyles.accent : themeStyles.borderColor,
                        boxShadow: 'none'
                      }}
                      onClick={() => { setSerial(device.serial_number); setSerialError(''); }}
                    >
                      <div className="card-body p-3">
                        <div className="d-flex justify-content-between align-items-start mb-2">
                          <div style={{ width: '3px', height: '20px', backgroundColor: device.status === 'connected' ? '#1f6f4a' : (['pending', 'waiting', 'discovered', 'approval_pending'].includes(device.status)) ? '#9b6c17' : '#6b7280' }} />
                          <span style={{
                            border: `1px solid ${device.status === 'connected' ? '#1f6f4a' : (['pending', 'waiting', 'discovered', 'approval_pending'].includes(device.status)) ? '#9b6c17' : '#6b7280'}`,
                            color: device.status === 'connected' ? '#1f6f4a' : (['pending', 'waiting', 'discovered', 'approval_pending'].includes(device.status)) ? '#9b6c17' : '#6b7280',
                            padding: '0.1rem 0.45rem',
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            backgroundColor: 'transparent'
                          }}>
                            {device.status === 'connected' ? 'متصل' : 
                             (['pending', 'waiting', 'discovered', 'approval_pending'].includes(device.status)) ? 'معلق' : 
                             device.status === 'disconnected' ? 'غير متصل' : (device.status || 'غير متصل')}
                          </span>
                        </div>
                        <h6 className="card-title fw-bold mb-1 text-truncate" style={{ color: themeStyles.textColor }}>
                          {device.name || 'جهاز غير معروف'}
                        </h6>
                        <code className="small text-muted d-block mb-0 text-truncate">
                          {device.serial_number}
                        </code>
                      </div>
                      {serial === device.serial_number && (
                        <div className="position-absolute top-0 end-0 m-2">
                          <i className="fas fa-check text-primary"></i>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="alert alert-warning mb-0 border-0 shadow-sm">
                <i className="fas fa-exclamation-triangle me-2"></i>
                لا توجد أجهزة متاحة للتحليل حالياً
              </div>
            )}
            {serialError && <div className="text-danger mt-2 small animate__animated animate__shakeX"><i className="fas fa-exclamation-circle me-1"></i>{serialError}</div>}
          </div>

          {/* عرض الجهاز المختار */}
          {serial && (
            <div className="alert border-0 shadow-sm mb-3 d-flex align-items-center" style={{ backgroundColor: isDarkMode ? '#13261c' : '#e6f3ec', color: isDarkMode ? '#b7d9c8' : '#1d4f36', borderRadius: '0', borderInlineStart: '4px solid #1f6f4a' }}>
              <i className="fas fa-check-circle me-2 fs-5"></i>
              <div>
                <span className="small d-block opacity-75">الجهاز المختار للتحليل:</span>
                <strong>{devices.find(d => d.serial_number === serial)?.name || serial}</strong>
              </div>
            </div>
          )}
          
          <div className="mb-3">
            <label className="form-label fw-bold">
              <i className="fas fa-cog me-1"></i>
              نوع التحليل
            </label>
            <select
              className="form-select"
              value={analysisType}
              onChange={e => setAnalysisType(e.target.value)}
            >
              {ANALYSIS_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>

          <div className="text-end">
            <button 
              className="btn btn-secondary me-2" 
              onClick={() => setModalAdvancedVisible(false)}
              disabled={isAnalyzing}
            >
              إلغاء
            </button>
            <button 
              className="btn btn-success" 
              onClick={() => handleAnalyzeDevice(true)}
              disabled={isAnalyzing || !serial}
            >
              {isAnalyzing ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                  جاري التحليل المتقدم...
                </>
              ) : (
                <>
                  <i className="fas fa-magic me-2"></i>
                  ابدأ التحليل المتقدم
                </>
              )}
            </button>
          </div>
        </Modal>

        {/* Bulk Analysis Modal */}
        <Modal
          show={modalBulkVisible}
          title={
            <div className="d-flex align-items-center">
              <i className="fas fa-layer-group me-2 text-warning"></i>
              تحليل شامل لجميع الأجهزة
            </div>
          }
          onClose={() => setModalBulkVisible(false)}
        >
          <div className="alert alert-warning">
            <i className="fas fa-exclamation-triangle me-2"></i>
            سيتم تحليل جميع الأجهزة المتصلة حالياً ({devices.filter(d => d.status === 'connected').length} جهاز)
          </div>
          
          <div className="mb-4">
            <label className="form-label fw-bold">
              <i className="fas fa-cog me-1"></i>
              نوع التحليل
            </label>
            <select
              className="form-select"
              value={analysisType}
              onChange={e => setAnalysisType(e.target.value)}
            >
              {ANALYSIS_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>

          <div className="text-end">
            <button 
              className="btn btn-secondary me-2" 
              onClick={() => setModalBulkVisible(false)}
            >
              إلغاء
            </button>
            <button 
              className="btn btn-warning" 
              onClick={handleAnalyzeAll}
            >
              <i className="fas fa-play me-2"></i>
              بدء التحليل الشامل
            </button>
          </div>
        </Modal>

        {/* View Report Modal */}
        <Modal
          show={modalViewVisible}
          title={
            <div className="d-flex align-items-center">
              <i className="fas fa-file-alt me-2 text-info"></i>
              تفاصيل تقرير التحليل
            </div>
          }
          onClose={() => setModalViewVisible(false)}
          size="lg"
        >
          {selected && (
            <div>
              {/* Report Header */}
              <div className="row mb-4">
                <div className="col-12">
                  <div className="card border-0" style={{ backgroundColor: isDarkMode ? '#3a3a3a' : '#f8f9fa' }}>
                    <div className="card-body">
                      <div className="d-flex justify-content-between align-items-start">
                        <div>
                          <h5 className="mb-2">
                            {getAnalysisTypeInfo(selected.analysis_type).label}
                          </h5>
                          <p className="mb-0 text-muted">
                            {formatDateTime(selected.timestamp)}
                          </p>
                        </div>
                        <div className="text-end">
                          <RiskBadge report={selected} />
                          <div className="mt-2">
                            <ConfidenceBar score={selected.confidence_score} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Device Information */}
              <div className="row mb-4">
                <div className="col-12">
                  <h6 className="fw-bold mb-3">
                    <i className="fas fa-desktop me-2"></i>
                    معلومات الجهاز
                  </h6>
                  <div className="row">
                    <div className="col-md-6">
                      <div className="list-group list-group-flush">
                        <div className="list-group-item border-0 px-0">
                          <strong>الاسم:</strong> {devices.find(d => d.serial_number === selected.related_device)?.name || 'غير معروف'}
                        </div>
                        <div className="list-group-item border-0 px-0">
                          <strong>الرقم التسلسلي:</strong> {selected.related_device}
                        </div>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="list-group list-group-flush">
                        <div className="list-group-item border-0 px-0">
                          <strong>نوع التحليل:</strong> {getAnalysisTypeInfo(selected.analysis_type).label}
                        </div>
                        <div className="list-group-item border-0 px-0">
                          <strong>درجة الثقة:</strong> {formatPercent(selected.confidence_score * 100)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Analysis Results */}
              <div className="row mb-4">
                <div className="col-12">
                  <h6 className="fw-bold mb-3">
                    <i className="fas fa-search me-2"></i>
                    نتائج التحليل
                  </h6>
                  <div className="card border-0" style={{ backgroundColor: isDarkMode ? '#3a3a3a' : '#f8f9fa' }}>
                    <div className="card-body">
                      <p className="mb-0">{selected.description}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recommendations */}
              <div className="row mb-4">
                <div className="col-12">
                  <h6 className="fw-bold mb-3">
                    <i className="fas fa-lightbulb me-2"></i>
                    التوصيات
                  </h6>
                  <div className="card border-0" style={{ backgroundColor: isDarkMode ? '#3a3a3a' : '#f8f9fa' }}>
                    <div className="card-body">
                      <p className="mb-0">{selected.recommendation}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Enhanced AI Details */}
              {selected.ai_enhanced && (
                <div className="row">
                  <div className="col-12">
                    <div className="alert alert-info">
                      <i className="fas fa-robot me-2"></i>
                      <strong>تحليل معزز بالذكاء الاصطناعي</strong>
                      {selected.openai_model && (
                        <small className="d-block mt-1">
                          النموذج المستخدم: {selected.openai_model}
                        </small>
                      )}
                    </div>
                    
                    {selected.threats && selected.threats.length > 0 && (
                      <div className="mb-3">
                        <h6 className="fw-bold">التهديدات المحددة:</h6>
                        <ul className="list-unstyled">
                          {selected.threats.map((threat, index) => (
                            <li key={index} className="mb-1">
                              <i className="fas fa-exclamation-triangle text-warning me-2"></i>
                              {threat}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {selected.risk_level && (
                      <div className="mb-3">
                        <h6 className="fw-bold">مستوى المخاطرة:</h6>
                        <span 
                          className="badge px-3 py-2"
                          style={{
                            backgroundColor: RISK_LEVELS[selected.risk_level]?.color || '#6c757d',
                            color: 'white'
                          }}
                        >
                          {RISK_LEVELS[selected.risk_level]?.label || selected.risk_level}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>

      </div>
    </div>
  );
};

export default AiAnalysis;
