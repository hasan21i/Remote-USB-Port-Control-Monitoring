import React, { useState, useEffect, useCallback } from 'react';
import { 
  fetchSystemDetails, 
  scanSystem
} from '../../utils/api';
import { formatDateTime } from '../../utils/formatters';
import Modal from '../../components/Modal';

const System = () => {
  const [info, setInfo] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(true);

  const [scanModal, setScanModal] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [scanResults, setScanResults] = useState(null);



  const [alert, setAlert] = useState({ type: '', message: '' });

  // حالة آخر تحديث للنظام
  const [lastSystemUpdate, setLastSystemUpdate] = useState(new Date());

  // دالة لتحويل التاريخ إلى توقيت بغداد
  const getBaghdadTime = (date) => {
    return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Baghdad' }));
  };

  // دالة لتنسيق التاريخ بالعربية بتوقيت بغداد
  const formatArabicDate = useCallback((date) => {
    const months = [
      'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
    ];
    
    // تحويل التاريخ إلى توقيت بغداد
    const baghdadDate = getBaghdadTime(date);
    
    const day = baghdadDate.getDate();
    const month = months[baghdadDate.getMonth()];
    const year = baghdadDate.getFullYear();
    const time = baghdadDate.toLocaleTimeString('ar-IQ', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Baghdad'
    });
    
    return `${day} ${month} ${year} - ${time}`;
  }, []);

  // دالة لتحديث وقت آخر تحديث
  const updateLastSystemUpdate = useCallback(() => {
    // إنشاء تاريخ بتوقيت بغداد
    const now = new Date();
    const baghdadTime = getBaghdadTime(now);
    setLastSystemUpdate(baghdadTime);
    
    // حفظ آخر تحديث في localStorage
    localStorage.setItem('lastSystemUpdate', baghdadTime.toISOString());
    
    // إرسال تحديث إلى الخادم (اختياري)
    // console.log('تم تحديث النظام في:', baghdadTime.toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad' }));
    
    // إظهار رسالة نجاح
    setAlert({ 
      type: 'success', 
      message: `تم تحديث وقت النظام بنجاح في ${formatArabicDate(baghdadTime)}` 
    });
    
    // إخفاء الرسالة بعد 3 ثواني
    setTimeout(() => {
      setAlert({ type: '', message: '' });
    }, 3000);
  }, [formatArabicDate]);

  // تحميل آخر تحديث من localStorage
  useEffect(() => {
    const savedUpdate = localStorage.getItem('lastSystemUpdate');
    if (savedUpdate) {
      const savedDate = new Date(savedUpdate);
      // تحويل التاريخ المحفوظ إلى توقيت بغداد
      const baghdadTime = getBaghdadTime(savedDate);
      setLastSystemUpdate(baghdadTime);
    }
  }, []);

  // جلب معلومات النظام
  const loadInfo = useCallback(async () => {
    setLoadingInfo(true);
    try {
      const resp = await fetchSystemDetails();
      setInfo(resp.data);
      updateLastSystemUpdate(); // تحديث وقت آخر تحديث
    } catch (err) {
      setAlert({ type: 'danger', message: err.message || 'فشل في جلب معلومات النظام' });
    } finally {
      setLoadingInfo(false);
    }
  }, [updateLastSystemUpdate]);



  // تحميل البيانات عند التشغيل
  useEffect(() => {
    const initializeData = async () => {
      try {
        await loadInfo();
        // تحديث آخر تحديث عند تحميل الصفحة
        updateLastSystemUpdate();
      } catch (error) {
        console.error('Error initializing data:', error);
        setAlert({ 
          type: 'warning', 
          message: 'تم تحميل بعض البيانات بنجاح، قد تكون هناك مشاكل في الاتصال بالخادم.' 
        });
      }
    };
    
    initializeData();
  }, [loadInfo, updateLastSystemUpdate]);

  // بدء فحص النظام
  const doScan = async () => {
    setScanLoading(true);
    setAlert({ type: '', message: '' });
    try {
      const response = await scanSystem();
      setScanResults(response.data);
      setScanModal(false);
      updateLastSystemUpdate(); // تحديث وقت آخر تحديث
      const issuesCount = response.data?.performance_scan?.issues_found?.length || 0;
      setAlert({ type: 'success', message: 'تم فحص النظام بنجاح. تم العثور على ' + issuesCount + ' مشكلة.' });
      setTimeout(loadInfo, 3000);
    } catch (err) {
      setAlert({ type: 'danger', message: err.message || 'فشل في فحص النظام' });
    } finally {
      setScanLoading(false);
    }
  };





  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3">لوحة إعدادات النظام</h1>
        <button className="btn btn-primary" onClick={() => setScanModal(true)}>
          <i className="fas fa-sync-alt me-1" /> فحص النظام
        </button>
      </div>

      {alert.message && (
        <div className={`alert alert-${alert.type} mb-4`} role="alert">
          {alert.message}
        </div>
      )}

      <div className="row gy-4">
        {/* بطاقة معلومات النظام */}
        <div className="col-lg-12">
          <div className="card shadow-sm">
            <div className="card-header d-flex justify-content-between align-items-center">
              <h5 className="mb-0">معلومات النظام</h5>
              <div>
                <button 
                  className="btn btn-success me-2" 
                  onClick={(e) => {
                    // تأثير النقر
                    e.target.style.transform = 'scale(0.95)';
                    setTimeout(() => {
                      e.target.style.transform = 'scale(1)';
                    }, 150);
                    updateLastSystemUpdate();
                  }}
                  title="تحديث وقت آخر تحديث للنظام"
                  style={{
                    fontWeight: 'bold',
                    fontSize: '0.9rem',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    border: '2px solid var(--success-color)',
                    transition: 'all 0.3s ease',
                    position: 'relative',
                    overflow: 'hidden',
                    background: 'linear-gradient(135deg, var(--success-color) 0%, var(--secondary-color) 100%)',
                    color: 'white',
                    textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.transform = 'translateY(-2px)';
                    e.target.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
                    e.target.style.background = 'linear-gradient(135deg, var(--secondary-color) 0%, var(--secondary-color) 100%)';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.transform = 'translateY(0)';
                    e.target.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
                    e.target.style.background = 'linear-gradient(135deg, var(--success-color) 0%, var(--secondary-color) 100%)';
                  }}
                >
                  <i className="fas fa-clock me-2" style={{ fontSize: '1.1rem' }} />
                  تحديث الوقت الآن
                </button>
                <button 
                  className="btn btn-sm btn-outline-primary" 
                  onClick={loadInfo}
                  disabled={loadingInfo}
                >
                  <i className="fas fa-sync-alt me-1" />
                  تحديث
                </button>
              </div>
            </div>
            <div className="card-body">
              {loadingInfo ? (
                <div className="text-center py-5">
                  <span className="spinner-border" />
                </div>
              ) : info ? (
                <div className="row">
                  {/* معلومات أساسية */}
                  <div className="col-md-6">
                    <h6 className="text-primary mb-3">
                      <i className="fas fa-info-circle me-2"></i>
                      المعلومات الأساسية
                    </h6>
                    <dl className="row small">
                      <dt className="col-5">اسم النظام:</dt>
                      <dd className="col-7">{info.name || 'Smart Zero-Trust Peripheral Security'}</dd>
                      <dt className="col-5">الإصدار:</dt>
                      <dd className="col-7">
                        <span className="badge bg-primary">{info.version}</span>
                      </dd>
                      <dt className="col-5">مسار التثبيت:</dt>
                      <dd className="col-7 text-truncate" title={info.installPath}>
                        <code className="small">{info.installPath}</code>
                      </dd>
                      <dt className="col-5">وقت التشغيل:</dt>
                      <dd className="col-7">
                        <small className="text-muted">{formatDateTime(info.uptimeTimestamp)}</small>
                      </dd>
                      <dt className="col-5">مدة التشغيل:</dt>
                      <dd className="col-7">
                        <span className="badge bg-success">{info.system?.uptime_hours} ساعة</span>
                      </dd>
                      <dt className="col-5">آخر فحص:</dt>
                      <dd className="col-7">
                        <small className="text-muted">{formatDateTime(info.lastScan)}</small>
                      </dd>
                      <dt className="col-5">آخر تحديث للنظام:</dt>
                      <dd className="col-7">
                        <span className="badge bg-success">
                          {formatArabicDate(lastSystemUpdate)}
                        </span>
                        <br />
                        <small className="text-muted">توقيت بغداد (GMT+3)</small>
                      </dd>
                    </dl>
                  </div>

                  {/* معلومات النظام */}
                  <div className="col-md-6">
                    <h6 className="text-primary mb-3">
                      <i className="fas fa-desktop me-2"></i>
                      نظام التشغيل
                    </h6>
                    <dl className="row small">
                      <dt className="col-5">النظام:</dt>
                      <dd className="col-7">{info.system?.os}</dd>
                      <dt className="col-5">الإصدار:</dt>
                      <dd className="col-7">{info.system?.os_release}</dd>
                      <dt className="col-5">المعمارية:</dt>
                      <dd className="col-7">{info.system?.architecture}</dd>
                      <dt className="col-5">المعالج:</dt>
                      <dd className="col-7 text-truncate" title={info.system?.processor}>
                        {info.system?.processor || 'غير محدد'}
                      </dd>
                      <dt className="col-5">اسم الجهاز:</dt>
                      <dd className="col-7">{info.system?.hostname}</dd>
                      <dt className="col-5">IP المحلي:</dt>
                      <dd className="col-7">{info.system?.local_ip}</dd>
                    </dl>
                  </div>

                  {/* موارد النظام */}
                  <div className="col-12 mt-4">
                    <h6 className="text-primary mb-3">
                      <i className="fas fa-chart-line me-2"></i>
                      موارد النظام
                    </h6>
                    <div className="row">
                      {/* المعالج */}
                      <div className="col-md-4">
                        <div className="card bg-light">
                          <div className="card-body p-3">
                            <h6 className="card-title">
                              <i className="fas fa-microchip text-info me-2"></i>
                              المعالج
                            </h6>
                            <div className="progress mb-2" style={{height: '8px'}}>
                              <div 
                                className="progress-bar bg-info" 
                                style={{width: `${info.resources?.cpu?.usage_percent || 0}%`}}
                              ></div>
                            </div>
                            <small>الاستخدام: {info.resources?.cpu?.usage_percent || 0}%</small><br/>
                            <small>الأنوية: {info.resources?.cpu?.core_count || 0}</small><br/>
                            <small>التردد: {info.resources?.cpu?.frequency_mhz || 0} MHz</small>
                          </div>
                        </div>
                      </div>

                      {/* الذاكرة */}
                      <div className="col-md-4">
                        <div className="card bg-light">
                          <div className="card-body p-3">
                            <h6 className="card-title">
                              <i className="fas fa-memory text-warning me-2"></i>
                              الذاكرة
                            </h6>
                            <div className="progress mb-2" style={{height: '8px'}}>
                              <div 
                                className="progress-bar bg-warning" 
                                style={{width: `${info.resources?.memory?.usage_percent || 0}%`}}
                              ></div>
                            </div>
                            <small>الاستخدام: {info.resources?.memory?.usage_percent || 0}%</small><br/>
                            <small>المستخدم: {info.resources?.memory?.used_gb || 0} GB</small><br/>
                            <small>الإجمالي: {info.resources?.memory?.total_gb || 0} GB</small>
                          </div>
                        </div>
                      </div>

                      {/* القرص الصلب */}
                      <div className="col-md-4">
                        <div className="card bg-light">
                          <div className="card-body p-3">
                            <h6 className="card-title">
                              <i className="fas fa-hdd text-success me-2"></i>
                              القرص الصلب
                            </h6>
                            <div className="progress mb-2" style={{height: '8px'}}>
                              <div 
                                className="progress-bar bg-success" 
                                style={{width: `${info.resources?.disk?.usage_percent || 0}%`}}
                              ></div>
                            </div>
                            <small>الاستخدام: {info.resources?.disk?.usage_percent || 0}%</small><br/>
                            <small>المستخدم: {info.resources?.disk?.used_gb || 0} GB</small><br/>
                            <small>الإجمالي: {info.resources?.disk?.total_gb || 0} GB</small>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* خدمات النظام */}
                  <div className="col-12 mt-4">
                    <h6 className="text-primary mb-3">
                      <i className="fas fa-cogs me-2"></i>
                      حالة الخدمات
                    </h6>
                    <div className="row">
                      {info.services && Object.entries(info.services).map(([service, status]) => (
                        <div key={service} className="col-md-3 mb-2">
                          <span className={`badge ${status === 'active' || status === 'running' || status === 'connected' ? 'bg-success' : 'bg-danger'} w-100`}>
                            <i className={`fas ${status === 'active' || status === 'running' || status === 'connected' ? 'fa-check-circle' : 'fa-times-circle'} me-1`}></i>
                            {service}: {status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* معلومات الترخيص والأمان */}
                  <div className="col-12 mt-4">
                    <h6 className="text-primary mb-3">
                      <i className="fas fa-shield-alt me-2"></i>
                      الترخيص والأمان
                    </h6>
                    <div className="row">
                      {/* الترخيص */}
                      <div className="col-md-6">
                        <div className="card border-success">
                          <div className="card-body p-3">
                            <h6 className="card-title text-success">
                              <i className="fas fa-certificate me-2"></i>
                              حالة الترخيص
                            </h6>
                            <div className="d-flex justify-content-between align-items-center">
                              <span>
                                <span className="badge bg-success">
                                  {info.license?.type || 'OWNER_PREMIUM'}
                                </span>
                                <br />
                                <small className="text-muted">
                                  {info.license?.status === 'active' ? 'مفعل دائماً' : 'غير مفعل'}
                                </small>
                              </span>
                              <i className="fas fa-check-circle text-success fa-2x"></i>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* الأمان */}
                      <div className="col-md-6">
                        <div className="card border-info">
                          <div className="card-body p-3">
                            <h6 className="card-title text-info">
                              <i className="fas fa-lock me-2"></i>
                              حالة الأمان
                            </h6>
                            <div className="d-flex justify-content-between align-items-center">
                              <span>
                                <span className={`badge ${info.security?.threat_level === 'low' ? 'bg-success' : 'bg-warning'}`}>
                                  {info.security?.threat_level === 'low' ? 'مستوى آمن' : 'تحت المراقبة'}
                                </span>
                                <br />
                                <small className="text-muted">
                                  جدار الحماية: {info.security?.firewall_enabled ? 'مفعل' : 'معطل'}
                                </small>
                              </span>
                              <i className={`fas ${info.security?.threat_level === 'low' ? 'fa-shield-alt text-success' : 'fa-exclamation-triangle text-warning'} fa-2x`}></i>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* معلومات التحديثات */}
                  <div className="col-12 mt-4">
                    <h6 className="text-primary mb-3">
                      <i className="fas fa-history me-2"></i>
                      سجل التحديثات
                    </h6>
                    <div className="row">
                      <div className="col-md-6">
                        <div className="card bg-light">
                          <div className="card-body p-3">
                            <h6 className="card-title text-success">
                              <i className="fas fa-clock me-2"></i>
                              آخر تحديث للنظام
                            </h6>
                                                          <div className="d-flex justify-content-between align-items-center">
                                <div>
                                  <span className="h5 mb-0 text-success">
                                    {formatArabicDate(lastSystemUpdate)}
                                  </span>
                                  <br />
                                  <small className="text-muted">توقيت بغداد (GMT+3)</small>
                                </div>
                              <button 
                                className="btn btn-success"
                                onClick={(e) => {
                                  // تأثير النقر
                                  e.target.style.transform = 'scale(0.95)';
                                  setTimeout(() => {
                                    e.target.style.transform = 'scale(1)';
                                  }, 150);
                                  updateLastSystemUpdate();
                                }}
                                title="تحديث الوقت الآن"
                                style={{
                                  fontWeight: 'bold',
                                  padding: '6px 12px',
                                  borderRadius: '6px',
                                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                  border: '2px solid var(--success-color)',
                                  transition: 'all 0.3s ease',
                                  fontSize: '0.85rem',
                                  position: 'relative',
                                  overflow: 'hidden',
                                  background: 'linear-gradient(135deg, var(--success-color) 0%, var(--secondary-color) 100%)',
                                  color: 'white',
                                  textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                                }}
                                onMouseEnter={(e) => {
                                  e.target.style.transform = 'scale(1.05)';
                                  e.target.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
                                  e.target.style.background = 'linear-gradient(135deg, var(--secondary-color) 0%, var(--secondary-color) 100%)';
                                }}
                                onMouseLeave={(e) => {
                                  e.target.style.transform = 'scale(1)';
                                  e.target.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
                                  e.target.style.background = 'linear-gradient(135deg, var(--success-color) 0%, var(--secondary-color) 100%)';
                                }}
                              >
                                <i className="fas fa-sync-alt me-1"></i>
                                تحديث
                              </button>
                            </div>
                            <small className="text-muted">
                              يتم تحديث هذا الوقت تلقائياً عند إجراء أي تغيير في النظام
                            </small>
                          </div>
                        </div>
                      </div>
                      <div className="col-md-6">
                        <div className="card bg-light">
                          <div className="card-body p-3">
                            <h6 className="card-title text-info">
                              <i className="fas fa-calendar me-2"></i>
                              معلومات التحديث
                            </h6>
                            <dl className="row small mb-0">
                              <dt className="col-6">التاريخ:</dt>
                              <dd className="col-6">{getBaghdadTime(lastSystemUpdate).toLocaleDateString('ar-IQ', { timeZone: 'Asia/Baghdad' })}</dd>
                              <dt className="col-6">الوقت:</dt>
                              <dd className="col-6">{getBaghdadTime(lastSystemUpdate).toLocaleTimeString('ar-IQ', { timeZone: 'Asia/Baghdad' })}</dd>
                              <dt className="col-6">اليوم:</dt>
                              <dd className="col-6">{getBaghdadTime(lastSystemUpdate).toLocaleDateString('ar-IQ', { weekday: 'long', timeZone: 'Asia/Baghdad' })}</dd>
                              <dt className="col-6">المنطقة الزمنية:</dt>
                              <dd className="col-6">توقيت بغداد (GMT+3)</dd>
                            </dl>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* معلومات تقنية إضافية */}
                  <div className="col-12 mt-4">
                    <h6 className="text-primary mb-3">
                      <i className="fas fa-code me-2"></i>
                      المعلومات التقنية
                    </h6>
                    <div className="row">
                      <div className="col-md-6">
                        <dl className="row small">
                          <dt className="col-5">Python:</dt>
                          <dd className="col-7">
                            <code>{info.system?.python_version}</code>
                          </dd>
                          <dt className="col-5">MAC Address:</dt>
                          <dd className="col-7">
                            <code className="small">{info.system?.mac_address}</code>
                          </dd>
                          <dt className="col-5">Machine Type:</dt>
                          <dd className="col-7">{info.system?.machine}</dd>
                        </dl>
                      </div>
                      <div className="col-md-6">
                        <dl className="row small">
                          <dt className="col-5">USB Monitoring:</dt>
                          <dd className="col-7">
                            <span className={`badge ${info.usb_monitoring?.status === 'active' ? 'bg-success' : 'bg-danger'}`}>
                              {info.usb_monitoring?.status === 'active' ? 'نشط' : 'متوقف'}
                            </span>
                          </dd>
                          <dt className="col-5">Scan Interval:</dt>
                          <dd className="col-7">{info.usb_monitoring?.auto_scan_interval || '30 ثانية'}</dd>
                          <dt className="col-5">Active Policies:</dt>
                          <dd className="col-7">
                            <span className="badge bg-info">{info.statistics?.active_policies || 0}</span>
                          </dd>
                        </dl>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-center text-muted">لا توجد بيانات.</p>
              )}
            </div>
          </div>
        </div>

        {/* بطاقة معلومات البرنامج والمطور */}
        <div className="col-lg-12">
          <div className="card shadow-sm">
            <div className="card-header">
              <h5 className="mb-0 d-flex align-items-center">
                <i className="fas fa-code me-3"></i>
                <span>معلومات البرنامج والمطور</span>
              </h5>
            </div>
            <div className="card-body">
              <div className="row">
                <div className="col-md-6">
                  <h6 className="text-primary mb-3">
                    <i className="fas fa-laptop-code me-2"></i>
                    تفاصيل البرنامج
                  </h6>
                  <dl className="row small">
                    <dt className="col-5">اسم البرنامج:</dt>
                    <dd className="col-7">
                      <strong>Smart Zero-Trust Peripheral Security</strong>
                    </dd>
                    <dt className="col-5">النوع:</dt>
                    <dd className="col-7">
                      <span className="badge bg-primary">نظام أمان وإدارة</span>
                    </dd>
                    <dt className="col-5">التصنيف:</dt>
                    <dd className="col-7">نظام مراقبة ومنع التسريب</dd>
                    <dt className="col-5">الترخيص:</dt>
                    <dd className="col-7">
                      <span className="badge bg-success">مملوك بالكامل - لا قيود</span>
                    </dd>
                    <dt className="col-5">تاريخ الإنشاء:</dt>
                    <dd className="col-7">ديسمبر 2024</dd>
                    <dt className="col-5">آخر تحديث:</dt>
                    <dd className="col-7">
                      <span className="badge bg-info">
                        {formatArabicDate(lastSystemUpdate)}
                      </span>
                      <br />
                      <small className="text-muted">توقيت بغداد</small>
                    </dd>
                  </dl>
                </div>

                <div className="col-md-6">
                  <h6 className="text-primary mb-3">
                    <i className="fas fa-user-tie me-2"></i>
                    معلومات المطور
                  </h6>
                  <dl className="row small">
                    <dt className="col-5">المطور:</dt>
                    <dd className="col-7">
                      <strong>Hasan Ali Hasan</strong>
                    </dd>
                    <dt className="col-5">الفريق:</dt>
                    <dd className="col-7">
                      <span className="badge bg-primary">فريق Alpha</span>
                    </dd>
                    <dt className="col-5">القسم:</dt>
                    <dd className="col-7">قسم المطورين</dd>
                    <dt className="col-5">التخصص:</dt>
                    <dd className="col-7">مطور أنظمة أمنية</dd>
                    <dt className="col-5">الخبرة:</dt>
                    <dd className="col-7">أنظمة أمان وحماية البيانات</dd>
                    <dt className="col-5">التقنيات:</dt>
                    <dd className="col-7">
                      <span className="badge bg-warning text-dark me-1">Python</span>
                      <span className="badge bg-info me-1">React</span>
                      <span className="badge bg-success me-1">Flask</span>
                    </dd>
                    <dt className="col-5">GitHub:</dt>
                    <dd className="col-7">
                      <a href="https://github.com/hasan21i" target="_blank" rel="noopener noreferrer" className="text-decoration-none">
                        <i className="fab fa-github me-1"></i>hasan21i
                      </a>
                    </dd>
                  </dl>
                </div>

                <div className="col-12 mt-4">
                  <h6 className="text-primary mb-3">
                    <i className="fas fa-tools me-2"></i>
                    التقنيات المستخدمة
                  </h6>
                  <div className="row g-3">
                    {/* Backend */}
                    <div className="col-md-4">
                      <div className="card border-primary h-100">
                        <div className="card-body p-3 text-center">
                          <i className="fab fa-python text-warning fa-3x mb-3"></i>
                          <h6 className="text-primary fw-bold mb-3">Backend</h6>
                          <div className="mb-3">
                            <span className="badge bg-warning text-dark me-1 mb-1">Python 3.11+</span>
                            <span className="badge bg-success me-1 mb-1">Flask</span>
                            <span className="badge bg-info me-1 mb-1">JWT</span>
                            <span className="badge bg-primary me-1 mb-1">Supabase</span>
                          </div>
                          <small className="text-muted">
                            Flask Framework مع JWT Authentication<br/>
                            Supabase PostgreSQL + Real-time APIs<br/>
                            معالجة أخطاء متقدمة وأمان عالي
                          </small>
                        </div>
                      </div>
                    </div>

                    {/* Frontend */}
                    <div className="col-md-4">
                      <div className="card border-info h-100">
                        <div className="card-body p-3 text-center">
                          <i className="fab fa-react text-info fa-3x mb-3"></i>
                          <h6 className="text-info fw-bold mb-3">Frontend</h6>
                          <div className="mb-3">
                            <span className="badge bg-info me-1 mb-1">React 18</span>
                            <span className="badge bg-primary me-1 mb-1">Bootstrap 5</span>
                            <span className="badge bg-success me-1 mb-1">Axios</span>
                            <span className="badge bg-warning text-dark me-1 mb-1">WebSocket</span>
                          </div>
                          <small className="text-muted">
                            React Hooks مع Bootstrap UI<br/>
                            Responsive Design مع Real-time Updates<br/>
                            واجهة مستخدم حديثة وتفاعلية
                          </small>
                        </div>
                      </div>
                    </div>

                    {/* Database */}
                    <div className="col-md-4">
                      <div className="card border-success h-100">
                        <div className="card-body p-3 text-center">
                          <i className="fas fa-database text-success fa-3x mb-3"></i>
                          <h6 className="text-success fw-bold mb-3">Database</h6>
                          <div className="mb-3">
                            <span className="badge bg-success me-1 mb-1">Supabase</span>
                            <span className="badge bg-warning text-dark me-1 mb-1">PostgreSQL</span>
                            <span className="badge bg-info me-1 mb-1">Real-time</span>
                          </div>
                          <small className="text-muted">
                            Supabase PostgreSQL مع Real-time<br/>
                            Authentication & Storage APIs
                          </small>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* التقنيات الإضافية */}
                  <div className="row g-3 mt-2">
                    <div className="col-md-6">
                      <div className="card border-warning h-100">
                        <div className="card-body p-3">
                          <h6 className="text-warning fw-bold mb-2">
                            <i className="fas fa-shield-alt me-2"></i>
                            الأمان والمصادقة
                          </h6>
                          <div className="mb-2">
                            <span className="badge bg-warning text-dark me-1">JWT Tokens</span>
                            <span className="badge bg-danger me-1">Role-based Access</span>
                            <span className="badge bg-success me-1">Secure APIs</span>
                          </div>
                          <small className="text-muted">
                            نظام مصادقة متقدم مع JWT tokens<br/>
                            تحكم في الصلاحيات وإدارة الجلسات الآمنة
                          </small>
                        </div>
                      </div>
                    </div>

                    <div className="col-md-6">
                      <div className="card border-primary h-100">
                        <div className="card-body p-3">
                          <h6 className="text-primary fw-bold mb-2">
                            <i className="fas fa-bolt me-2"></i>
                            التحديثات الزمنية الحية
                          </h6>
                          <div className="mb-2">
                            <span className="badge bg-primary me-1">WebSocket</span>
                            <span className="badge bg-info me-1">Real-time Sync</span>
                            <span className="badge bg-success me-1">Live Updates</span>
                          </div>
                          <small className="text-muted">
                            تحديثات فورية لأجهزة USB<br/>
                            مراقبة مستمرة وإشعارات فورية
                          </small>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* معلومات إضافية */}
                  <div className="row g-3 mt-2">
                    <div className="col-12">
                      <div className="card border-primary">
                        <div className="card-body p-3">
                          <h6 className="text-primary fw-bold mb-2">
                            <i className="fas fa-star me-2"></i>
                            مميزات النظام
                          </h6>
                          <div className="row">
                            <div className="col-md-4">
                              <small className="d-block mb-1 text-muted">
                                <i className="fas fa-check-circle me-1 text-success"></i>
                                مراقبة USB في الوقت الفعلي
                              </small>
                              <small className="d-block mb-1 text-muted">
                                <i className="fas fa-check-circle me-1 text-success"></i>
                                منع التسريب الأمني
                              </small>
                              <small className="d-block mb-1 text-muted">
                                <i className="fas fa-check-circle me-1 text-success"></i>
                                تقارير مفصلة وإحصائيات
                              </small>
                            </div>
                            <div className="col-md-4">
                              <small className="d-block mb-1 text-muted">
                                <i className="fas fa-check-circle me-1 text-success"></i>
                                واجهة مستخدم حديثة
                              </small>
                              <small className="d-block mb-1 text-muted">
                                <i className="fas fa-check-circle me-1 text-success"></i>
                                دعم اللغة العربية
                              </small>
                              <small className="d-block mb-1 text-muted">
                                <i className="fas fa-check-circle me-1 text-success"></i>
                                تصميم متجاوب
                              </small>
                            </div>
                            <div className="col-md-4">
                              <small className="d-block mb-1 text-muted">
                                <i className="fas fa-check-circle me-1 text-success"></i>
                                أمان متقدم
                              </small>
                              <small className="d-block mb-1 text-muted">
                                <i className="fas fa-check-circle me-1 text-success"></i>
                                أداء عالي
                              </small>
                              <small className="d-block mb-1 text-muted">
                                <i className="fas fa-check-circle me-1 text-success"></i>
                                سهولة الاستخدام
                              </small>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="col-12 mt-3">
                  <div className="alert alert-success d-flex align-items-start">
                    <i className="fas fa-info-circle me-3 fa-lg mt-1"></i>
                    <div>
                      <strong className="text-success">نظام متقدم لمراقبة أجهزة USB:</strong>
                      <ul className="mb-2 mt-2">
                        <li>مراقبة شاملة لجميع أجهزة USB المتصلة بالنظام</li>
                        <li>حماية متقدمة من التسريب الأمني والتجسس</li>
                        <li>تقارير مفصلة وإحصائيات شاملة للأنشطة</li>
                        <li>واجهة مستخدم حديثة وسهلة الاستخدام</li>
                        <li>دعم كامل للغة العربية مع تصميم متجاوب</li>
                        <li>تحديثات زمنية حية وإشعارات فورية</li>
                      </ul>
                      <strong className="text-primary">الترخيص:</strong> النظام مملوك بالكامل - لا توجد قيود استخدام أو انتهاء صلاحية.
                      <br />
                      <small className="text-muted">
                        <i className="fas fa-code me-1"></i>
                        تم تطوير النظام باستخدام أحدث التقنيات والمعايير الأمنية العالمية
                      </small>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>


      </div>

      {/* مودال تأكيد الفحص */}
      <Modal
        show={scanModal}
        title="تأكيد فحص النظام"
        onClose={() => setScanModal(false)}
      >
        <p>هل أنت متأكد من رغبتك في بدء فحص شامل للنظام؟</p>
        <div className="d-flex justify-content-end">
          <button
            className="btn btn-secondary me-2"
            onClick={() => setScanModal(false)}
            disabled={scanLoading}
          >إلغاء</button>
          <button
            className="btn btn-primary"
            onClick={doScan}
            disabled={scanLoading}
          >
            {scanLoading
              ? (<><span className="spinner-border spinner-border-sm me-2" />جاري الفحص...</>)
              : 'ابدأ الفحص'}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default System;
