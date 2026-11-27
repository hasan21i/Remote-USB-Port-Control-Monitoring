import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { 
  fetchLogStats, 
  listDevices,
  fetchBlockchainStats,
  fetchAlertStats,
  fetchDashboardOverview,
  fetchUserStats,
  fetchAIStats
} from '../../utils/api';
import { formatNumber, formatPercent } from '../../utils/formatters';

const DEVICE_TYPE_LABELS = {
  usb: 'USB عام',
  flash: 'فلاش ميموري', 
  hdd: 'قرص خارجي',
  printer: 'طابعة',
  scanner: 'ماسح',
  camera: 'كاميرا',
  keyboard: 'لوحة مفاتيح',
  mouse: 'فأرة',
  audio: 'صوتي',
  unknown: 'غير معروف',
  other: 'أخرى'
};

const ACTION_LABELS = {
  device_connected: 'اتصالات الأجهزة',
  device_disconnected: 'انفصالات الأجهزة', 
  device_blocked: 'حظر الأجهزة',
  device_authorized: 'تفويض الأجهزة',
  user_login: 'تسجيلات الدخول',
  user_logout: 'تسجيلات الخروج',
  policy_applied: 'تطبيق السياسات',
  alert_created: 'إنشاء التنبيهات'
};

const DATE_OPTIONS = [
  { value: 1, label: 'آخر 24 ساعة' },
  { value: 7, label: 'آخر أسبوع' },
  { value: 30, label: 'آخر شهر' },
  { value: 90, label: 'آخر 3 شهور' },
  { value: 365, label: 'آخر سنة' }
];

const Stats = () => {
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
    background: isDarkMode ? '#1a1a1a' : 'var(--light)',
    cardBg: isDarkMode ? '#2d2d2d' : 'var(--white)',
    textColor: isDarkMode ? 'var(--white)' : 'var(--black)',
    mutedColor: isDarkMode ? 'var(--gray)' : 'var(--gray)',
    borderColor: isDarkMode ? 'var(--dark-gray)' : 'var(--mid)'
  }), [isDarkMode]);

  // State management
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState(30);

  // Data states
  const [dashboardData, setDashboardData] = useState(null);
  const [logStats, setLogStats] = useState(null);
  const [alertStats, setAlertStats] = useState(null);
  const [blockchainStats, setBlockchainStats] = useState(null);
  const [userStats, setUserStats] = useState(null);
  const [aiStats, setAIStats] = useState(null);
  const [deviceTypes, setDeviceTypes] = useState([]);

  // Load all statistics
  const loadAllStats = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError('');

    try {
      const promises = [
        fetchDashboardOverview().catch(() => null),
        fetchLogStats({ days: dateRange }).catch(() => null),
        fetchAlertStats({ periodDays: dateRange }).catch(() => null),
        fetchBlockchainStats().catch(() => null),
        fetchUserStats().catch(() => null),
        fetchAIStats({ days: dateRange }).catch(() => null),
        listDevices().catch(() => ({ data: [] }))
      ];

      const [
        dashRes,
        logsRes,
        alertsRes,
        blockchainRes,
        usersRes,
        aiRes,
        devicesRes
      ] = await Promise.all(promises);

      // Process dashboard data
      if (dashRes) {
        setDashboardData(dashRes);
      }

      // Process log stats 
      if (logsRes) {
        setLogStats(logsRes);
      }

      // Process alert stats
      if (alertsRes) {
        setAlertStats(alertsRes);
      }

      // Process blockchain stats
      if (blockchainRes) {
        setBlockchainStats(blockchainRes);
      }

      // Process user stats
      if (usersRes) {
        setUserStats(usersRes);
      }

      // Process AI stats
      if (aiRes) {
        setAIStats(aiRes);
      }

      // Process device types
      if (devicesRes) {
        const devices = Array.isArray(devicesRes) ? devicesRes : (devicesRes.data || []);
        const totalDevices = devices.length;

        if (totalDevices > 0) {
          const byType = devices.reduce((acc, device) => {
              const rawType = device.device_type || device.device_class || 'unknown';
              let type = rawType.toLowerCase();
              if (type === 'unknown' || type === 'none' || type === '') {
                type = 'unknown'; // This matches with 'غير معروف' in translation map
              }
              acc[type] = (acc[type] || 0) + 1;
              return acc;
            }, {});

            const typeStats = Object.entries(byType)
              .map(([type, count]) => ({
                type,
                count,
                percent: (count / totalDevices) * 100 // Multiplying by 100 for progress bar scale
              }))
              .sort((a, b) => b.count - a.count);

          setDeviceTypes(typeStats);
        }
      }

    } catch (err) {
      console.error('Error loading stats:', err);
      setError('فشل في جلب الإحصائيات: ' + (err.message || 'خطأ غير معروف'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateRange]);

  // Initial load
  useEffect(() => {
    loadAllStats();
  }, [loadAllStats]);

  // Handle refresh
  const handleRefresh = useCallback(() => {
    loadAllStats(true);
  }, [loadAllStats]);

  // Handle date range change
  const handleDateRangeChange = useCallback((newRange) => {
    setDateRange(newRange);
  }, []);

  // Utility functions
  const translateType = useCallback((type) => DEVICE_TYPE_LABELS[type] || type, []);

  if (loading) {
    return (
      <div className="text-center py-5" style={{ backgroundColor: themeStyles.background, minHeight: '100vh', color: themeStyles.textColor }}>
        <div className="spinner-border text-primary mb-3" role="status" style={{ width: '3rem', height: '3rem' }}>
          <span className="visually-hidden">جاري التحميل...</span>
        </div>
        <h4>جاري تحميل الإحصائيات...</h4>
        <p style={{ color: themeStyles.mutedColor }}>يرجى الانتظار بينما نجمع البيانات من جميع الأنظمة</p>
      </div>
    );
  }

  return (
    <div className="stats-page" style={{ backgroundColor: themeStyles.background, minHeight: '100vh', color: themeStyles.textColor }}>
      <div className="container-fluid py-4">
        
        {/* Hero Header */}
        <div className="row mb-5 mt-2">
          <div className="col-12">
            <div className="card shadow-sm border-0" style={{ 
              backgroundColor: themeStyles.cardBg, 
              borderRadius: '16px',
              borderLeft: `5px solid ${isDarkMode ? '#2980B9' : '#1C3B70'}`, // Official institutional accent line
              borderRight: `5px solid ${isDarkMode ? '#2980B9' : '#1C3B70'}` // Mirrored for RTL support
            }}>
              <div className="card-body p-4 p-md-5">
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-4">
                  <div className="d-flex align-items-center">
                    <div>
                      <h2 className="mb-2 fw-bold d-flex align-items-center" style={{ color: themeStyles.textColor, letterSpacing: '-0.5px' }}>
                        <i className="fas fa-chart-pie ms-3" style={{ fontSize: '32px', color: isDarkMode ? '#64B5F6' : '#1C3B70' }}></i>
                        الإحصائيات الشاملة
                      </h2>
                      <p className="mb-0" style={{ fontSize: '1.1rem', color: themeStyles.mutedColor, fontWeight: '500' }}>
                        نظرة شاملة على جميع أنشطة وبيانات النظام
                      </p>
                    </div>
                  </div>
                  <div className="d-flex gap-3 flex-wrap align-items-center">
                    <div className="d-flex align-items-center px-3 py-2 rounded" style={{ backgroundColor: isDarkMode ? '#333' : '#F8F9FA', border: `1px solid ${themeStyles.borderColor}` }}>
                      <i className="fas fa-calendar-alt ms-2" style={{ color: themeStyles.mutedColor }}></i>
                      <select
                        className="form-select border-0 bg-transparent fw-bold shadow-none p-0 pe-4"
                        style={{ width: 'auto', minWidth: '140px', color: themeStyles.textColor, cursor: 'pointer' }}
                        value={dateRange}
                        onChange={(e) => handleDateRangeChange(parseInt(e.target.value))}
                      >
                        {DATE_OPTIONS.map(option => (
                          <option key={option.value} value={option.value} style={{ color: isDarkMode ? '#000' : '#000' }}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    <button
                      className="btn fw-bold px-4 py-2 d-flex align-items-center shadow-sm"
                      style={{
                        backgroundColor: isDarkMode ? '#2980B9' : '#1C3B70',
                        color: '#fff',
                        borderRadius: '8px',
                        border: 'none',
                        height: '46px'
                      }}
                      onClick={handleRefresh}
                      disabled={refreshing}
                      onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                      onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                    >
                      <i className={`fas fa-sync-alt ms-2 ${refreshing ? 'fa-spin' : ''}`}></i>
                      تحديث البيانات
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

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

        {/* Consolidated Main & Device Overview Cards */}
        <div
          className="dashboard-cards-grid mb-5"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.7rem',
            justifyContent: 'center',
            marginBottom: '2.2rem',
          }}
        >
          <StatCard
            title="إجمالي الأجهزة"
            value={deviceTypes.reduce((total, type) => total + type.count, 0)}
            icon="fas fa-hdd"
            gradient="#1C3B70"
            themeStyles={themeStyles}
          />
          
          <StatCard
            title="الأجهزة النشطة"
            value={dashboardData?.connected_devices || 0}
            icon="fas fa-plug"
            gradient="#2E7D32"
            themeStyles={themeStyles}
          />
          
          <StatCard
            title="إجمالي التنبيهات"
            value={alertStats?.total_alerts || 0}
            icon="fas fa-exclamation-triangle"
            gradient="#E67E22"
            themeStyles={themeStyles}
          />
          
          <StatCard
            title="إجمالي السجلات"
            value={logStats?.total_logs || 0}
            icon="fas fa-file-alt"
            gradient="#293A4C"
            themeStyles={themeStyles}
          />

          {dashboardData && (
            <>
              <StatCard
                title="في الانتظار"
                value={dashboardData.pending_devices || 0}
                icon="fas fa-clock"
                gradient="#d35400"
                themeStyles={themeStyles}
              />
              <StatCard
                title="منفصلة"
                value={dashboardData.disconnected_devices || 0}
                icon="fas fa-unlink"
                gradient="#546e7a"
                themeStyles={themeStyles}
              />
              <StatCard
                title="محظورة"
                value={dashboardData.denied_devices || 0}
                icon="fas fa-ban"
                gradient="#C0392B"
                themeStyles={themeStyles}
              />
              <StatCard
                title="إجمالي الخوادم"
                value={dashboardData.total_servers || 0}
                icon="fas fa-server"
                gradient="#00838f"
                themeStyles={themeStyles}
              />
            </>
          )}
        </div>

        {/* Detailed Metrics Sections */}
        {/* 1. Alerts & AI Stats */}
        {(alertStats || aiStats) && (
          <div className="mt-5">
            <h5 className="fw-bold mb-4 d-flex align-items-center" style={{ color: themeStyles.textColor, borderBottom: `2px solid ${isDarkMode ? '#333' : '#e0e0e0'}`, paddingBottom: '10px' }}>
              <i className="fas fa-shield-alt me-2" style={{ color: '#E67E22' }}></i>
              نظام التنبيهات والذكاء الاصطناعي
            </h5>
            <div className="dashboard-cards-grid mb-4" style={{ display: 'flex', flexWrap: 'wrap', gap: '1.7rem', justifyContent: 'center' }}>
              {alertStats && (
                <>
                  <StatCard title="عالية الأولوية" value={alertStats.by_priority?.high || 0} icon="fas fa-exclamation-circle" gradient="#C0392B" themeStyles={themeStyles} />
                  <StatCard title="متوسطة وكبيرة" value={(alertStats.by_priority?.normal || 0) + (alertStats.by_priority?.low || 0)} icon="fas fa-exclamation" gradient="#D35400" themeStyles={themeStyles} />
                  <StatCard title="محلولة" value={alertStats.resolved || 0} icon="fas fa-check-circle" gradient="#27AE60" themeStyles={themeStyles} />
                  <StatCard title="غير محلولة" value={alertStats.unresolved || 0} icon="fas fa-times-circle" gradient="#c0392b" themeStyles={themeStyles} />
                </>
              )}
              {aiStats && (
                <>
                  <StatCard title="تقارير الذكاء" value={aiStats.total_reports || 0} icon="fas fa-brain" gradient="#2980B9" themeStyles={themeStyles} />
                  <StatCard title="شذوذ مكتشف" value={aiStats.anomalies || 0} icon="fas fa-radar" gradient="#8E44AD" themeStyles={themeStyles} />
                </>
              )}
            </div>
          </div>
        )}

        {/* 2. System Activity & Blockchain */}
        {(logStats || blockchainStats) && (
          <div className="mt-5">
            <h5 className="fw-bold mb-4 d-flex align-items-center" style={{ color: themeStyles.textColor, borderBottom: `2px solid ${isDarkMode ? '#333' : '#e0e0e0'}`, paddingBottom: '10px' }}>
              <i className="fas fa-network-wired me-2" style={{ color: '#2980B9' }}></i>
              نشاط النظام وسجلات البلوك تشين
            </h5>
            <div className="dashboard-cards-grid mb-4" style={{ display: 'flex', flexWrap: 'wrap', gap: '1.7rem', justifyContent: 'center' }}>
              {logStats && (
                <>
                  <StatCard title="إجمالي السجلات" value={logStats.total_logs || 0} icon="fas fa-database" gradient="#34495E" themeStyles={themeStyles} />
                  <StatCard title="سجلات حديثة" value={logStats.recent_logs || 0} icon="fas fa-clock" gradient="#16A085" themeStyles={themeStyles} />
                </>
              )}
              {blockchainStats && (
                <>
                  <StatCard title="إجمالي الكتل" value={blockchainStats.total_records || 0} icon="fas fa-cubes" gradient="#2C3E50" themeStyles={themeStyles} />
                  <StatCard title="أنواع العمليات" value={Object.keys(blockchainStats.by_action || {}).length} icon="fas fa-project-diagram" gradient="#2980B9" themeStyles={themeStyles} />
                </>
              )}
            </div>
          </div>
        )}

        {/* Institutional Reports Section */}
        <div className="row mt-5">
          {/* System Activity List */}
          {logStats?.top_actions && logStats.top_actions.length > 0 && (
            <div className="col-lg-6 mb-4">
              <div className="card shadow-sm border-0 h-100" style={{ backgroundColor: themeStyles.cardBg, borderRadius: '12px' }}>
                <div className="card-header border-0 py-3" style={{ backgroundColor: themeStyles.cardBg, borderBottom: `1px solid ${themeStyles.borderColor}` }}>
                  <h6 className="mb-0 fw-bold d-flex align-items-center" style={{ color: themeStyles.textColor }}>
                    <i className="fas fa-history me-2" style={{ color: isDarkMode ? '#aaa' : '#555' }}></i>
                    سجل المهام وأكثر الأنشطة
                  </h6>
                </div>
                <div className="card-body p-4" style={{ backgroundColor: themeStyles.cardBg }}>
                  {logStats.top_actions.slice(0, 5).map((item, index) => {
                    const total = logStats.total_logs || 1;
                    const percent = (item.count / total) * 100;
                    return (
                      <div key={index} className="mb-4">
                        <div className="d-flex justify-content-between mb-2">
                          <span className="fw-semibold" style={{ color: themeStyles.textColor }}>
                            {ACTION_LABELS[item.action] || item.action}
                          </span>
                          <span className="fw-bold" style={{ color: isDarkMode ? '#90CAF9' : '#1565C0' }}>
                            {formatNumber(item.count)} <small className="fw-normal" style={{ color: themeStyles.mutedColor }}>({formatPercent(percent / 100)})</small>
                          </span>
                        </div>
                        <div className="progress rounded-pill" style={{ height: '8px', backgroundColor: isDarkMode ? '#333' : '#e9ecef' }}>
                          <div
                            className="progress-bar rounded-pill"
                            style={{ 
                              width: `${percent}%`,
                              backgroundColor: '#2980B9' // Official solid blue
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Device Types Distribution List */}
          <div className="col-lg-6 mb-4">
            <div className="card shadow-sm border-0 h-100" style={{ backgroundColor: themeStyles.cardBg, borderRadius: '12px' }}>
              <div className="card-header border-0 py-3" style={{ backgroundColor: themeStyles.cardBg, borderBottom: `1px solid ${themeStyles.borderColor}` }}>
                <h6 className="mb-0 fw-bold d-flex align-items-center" style={{ color: themeStyles.textColor }}>
                  <i className="fas fa-chart-bar me-2" style={{ color: isDarkMode ? '#aaa' : '#555' }}></i>
                  التوزيع المؤسسي للأجهزة
                </h6>
              </div>
              <div className="card-body p-4" style={{ backgroundColor: themeStyles.cardBg }}>
                {deviceTypes.length === 0 ? (
                  <div className="text-center py-5">
                    <i className="fas fa-chart-pie mb-3 opacity-50" style={{ fontSize: '48px', color: themeStyles.mutedColor }}></i>
                    <p style={{ color: themeStyles.mutedColor }}>لا توجد إحصائيات لعرضها</p>
                  </div>
                ) : (
                  deviceTypes.slice(0, 6).map((item, index) => (
                    <div key={index} className="mb-4">
                      <div className="d-flex justify-content-between mb-2">
                        <span className="fw-semibold d-flex align-items-center" style={{ color: themeStyles.textColor }}>
                          <i className="fas fa-square me-2" style={{ fontSize: '10px', color: '#34495E' }} />
                          {translateType(item.type)}
                        </span>
                        <span className="fw-bold" style={{ color: isDarkMode ? '#90CAF9' : '#1565C0' }}>
                          {formatNumber(item.count)} <small className="fw-normal" style={{ color: themeStyles.mutedColor }}>({formatPercent(item.percent / 100)})</small>
                        </span>
                      </div>
                      <div className="progress rounded-pill" style={{ height: '8px', backgroundColor: isDarkMode ? '#333' : '#e9ecef' }}>
                        <div
                          className="progress-bar rounded-pill"
                          style={{ width: `${item.percent}%`, backgroundColor: '#34495E' }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Institutional Reports Section - User Statistics */}
        {userStats && (
          <div className="mt-5 mb-5">
            <h5 className="fw-bold mb-4 d-flex align-items-center" style={{ color: themeStyles.textColor, borderBottom: `2px solid ${isDarkMode ? '#333' : '#e0e0e0'}`, paddingBottom: '10px' }}>
              <i className="fas fa-users me-2" style={{ color: '#27AE60' }}></i>
              إحصائيات المستخدمين والنظام
            </h5>
            
            <div className="dashboard-cards-grid mb-4" style={{ display: 'flex', flexWrap: 'wrap', gap: '1.7rem', justifyContent: 'center' }}>
              <StatCard title="إجمالي المستخدمين" value={userStats.total_users || 0} icon="fas fa-users" gradient="#2C3E50" themeStyles={themeStyles} />
              <StatCard title="نشطين" value={userStats.active_users || 0} icon="fas fa-user-check" gradient="#27AE60" themeStyles={themeStyles} />
              <StatCard title="تسجيلات حديثة" value={userStats.recent_logins || 0} icon="fas fa-sign-in-alt" gradient="#2980B9" themeStyles={themeStyles} />
              <StatCard title="مستخدمين جدد" value={userStats.new_users || 0} icon="fas fa-user-plus" gradient="#16A085" themeStyles={themeStyles} />
              <StatCard title="تفعيل MFA" value={userStats.mfa_enabled || 0} icon="fas fa-shield-alt" gradient="#8E44AD" themeStyles={themeStyles} />
              <StatCard title="معدل النشاط" value={formatPercent(userStats.activity_rate || 0)} icon="fas fa-chart-line" gradient="#E67E22" themeStyles={themeStyles} />
            </div>

            {(userStats.by_role || userStats.by_status) && (
              <div className="row mt-4">
                {userStats.by_role && Object.keys(userStats.by_role).length > 0 && (
                  <div className="col-lg-6 mb-4">
                    <div className="card shadow-sm border-0 h-100" style={{ backgroundColor: themeStyles.cardBg, borderRadius: '12px' }}>
                      <div className="card-header border-0 py-3" style={{ backgroundColor: themeStyles.cardBg, borderBottom: `1px solid ${themeStyles.borderColor}` }}>
                        <h6 className="mb-0 fw-bold d-flex align-items-center" style={{ color: themeStyles.textColor }}>
                          <i className="fas fa-id-badge me-2" style={{ color: isDarkMode ? '#aaa' : '#555' }}></i>
                          توزيع المستخدمين حسب الأدوار
                        </h6>
                      </div>
                      <div className="card-body p-4" style={{ backgroundColor: themeStyles.cardBg }}>
                        {Object.entries(userStats.by_role).map(([role, count]) => {
                          const total = userStats.total_users || 1;
                          const percent = (count / total) * 100;
                          return (
                            <div key={role} className="mb-4">
                              <div className="d-flex justify-content-between mb-2">
                                <span className="fw-semibold" style={{ color: themeStyles.textColor }}>{role}</span>
                                <span className="fw-bold" style={{ color: isDarkMode ? '#90CAF9' : '#1565C0' }}>
                                  {formatNumber(count)} <small className="fw-normal" style={{ color: themeStyles.mutedColor }}>({formatPercent(percent / 100)})</small>
                                </span>
                              </div>
                              <div className="progress rounded-pill" style={{ height: '8px', backgroundColor: isDarkMode ? '#333' : '#e9ecef' }}>
                                <div className="progress-bar rounded-pill" style={{ width: `${percent}%`, backgroundColor: '#2C3E50' }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {userStats.by_status && Object.keys(userStats.by_status).length > 0 && (
                  <div className="col-lg-6 mb-4">
                    <div className="card shadow-sm border-0 h-100" style={{ backgroundColor: themeStyles.cardBg, borderRadius: '12px' }}>
                      <div className="card-header border-0 py-3" style={{ backgroundColor: themeStyles.cardBg, borderBottom: `1px solid ${themeStyles.borderColor}` }}>
                        <h6 className="mb-0 fw-bold d-flex align-items-center" style={{ color: themeStyles.textColor }}>
                          <i className="fas fa-toggle-on me-2" style={{ color: isDarkMode ? '#aaa' : '#555' }}></i>
                          توزيع المستخدمين حسب الحالة
                        </h6>
                      </div>
                      <div className="card-body p-4" style={{ backgroundColor: themeStyles.cardBg }}>
                        {Object.entries(userStats.by_status).map(([status, count]) => {
                          const total = userStats.total_users || 1;
                          const percent = (count / total) * 100;
                          const barColor = status === 'active' ? '#27AE60' : status === 'inactive' ? '#F39C12' : '#7F8C8D';
                          return (
                            <div key={status} className="mb-4">
                              <div className="d-flex justify-content-between mb-2">
                                <span className="fw-semibold" style={{ color: themeStyles.textColor }}>
                                  {status === 'active' ? 'نشط' : status === 'inactive' ? 'غير نشط' : status}
                                </span>
                                <span className="fw-bold" style={{ color: isDarkMode ? '#90CAF9' : '#1565C0' }}>
                                  {formatNumber(count)} <small className="fw-normal" style={{ color: themeStyles.mutedColor }}>({formatPercent(percent / 100)})</small>
                                </span>
                              </div>
                              <div className="progress rounded-pill" style={{ height: '8px', backgroundColor: isDarkMode ? '#333' : '#e9ecef' }}>
                                <div className="progress-bar rounded-pill" style={{ width: `${percent}%`, backgroundColor: barColor }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

// Professional StatCard Component (Horizontal layout matching Dashboard/Blockchain)
const StatCard = ({ title, value, icon, gradient }) => (
  <div
    className="card dashboard-card shadow-sm text-center text-white"
    style={{
      background: gradient, // Using gradient string directly as background
      borderRadius: '1.5rem',
      minWidth: 170,
      minHeight: 145,
      maxWidth: 210,
      margin: '0.3rem 0.4rem',
      boxShadow: '0 3px 22px #0002',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '1.2rem 0.2rem 1.3rem 0.2rem',
      cursor: 'default',
    }}
  >
    <div className="card-body d-flex flex-column justify-content-center align-items-center p-0">
      <i className={`${icon} mb-2`} style={{ fontSize: '28px', opacity: 0.9 }}></i>
      <h6 className="card-title text-white mb-1" style={{ fontSize: 17, fontWeight: 'bold' }}>{title}</h6>
      <div className="display-5 fw-bold mt-1" style={{ fontSize: 34 }}>{typeof value === 'number' ? formatNumber(value) : value}</div>
    </div>
  </div>
);

StatCard.propTypes = {
  title: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  icon: PropTypes.string.isRequired,
  gradient: PropTypes.string.isRequired,
  subtitle: PropTypes.string
};

export default Stats;