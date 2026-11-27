// src/pages/devices/DeviceDetails.jsx

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useDevice from '../../hooks/useDevice';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import {
  FaHdd, FaKeyboard, FaMouse, FaCamera, FaHeadphones, FaNetworkWired,
  FaMobileAlt, FaPrint, FaUsb, FaSpinner, FaArrowRight, FaEdit, FaSearch, FaTimes
} from 'react-icons/fa';
import { FaClock } from 'react-icons/fa';
import { formatDateTime } from '../../utils/formatters';
import { toast } from 'react-toastify';

const iconsMap = {
  storage: <FaHdd className="text-primary" size={24} />,
  keyboard: <FaKeyboard className="text-info" size={24} />,
  mouse: <FaMouse className="text-secondary" size={24} />,
  camera: <FaCamera className="text-warning" size={24} />,
  audio: <FaHeadphones className="text-success" size={24} />,
  network: <FaNetworkWired className="text-dark" size={24} />,
  phone: <FaMobileAlt className="text-muted" size={24} />,
  printer: <FaPrint className="text-purple" size={24} />,
  unknown: <FaUsb className="text-muted" size={24} />
};

const DeviceDetails = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // هوك الأجهزة
  const {
    fetchDevice,
    controlDevice,
    updateDevice
  } = useDevice();

  // الحالة
  const [device, setDevice] = useState(null);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState(searchParams.get('serial') || '');
  const [searching, setSearching] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({
    custom_name: '', notes: '', manufacturer: '', product: ''
  });
  const [modal, setModal] = useState({ show: false, action: '' });
  const [actionLoading, setActionLoading] = useState(false);

  // دالة البحث عن الجهاز (محسّنة لدعم المعاملات)
  const handleSearch = useCallback(async (queryOverride = null) => {
    const searchTerm = queryOverride || searchQuery.trim();
    
    // التحقق من صحة المعامل
    if (!searchTerm || typeof searchTerm !== 'string') {
      setError('يرجى إدخال الرقم التسلسلي أو اسم الجهاز');
      return;
    }

    setSearching(true);
    setError('');
    setDevice(null);

    try {
      // console.log('handleSearch: Searching for device:', searchTerm);
      const deviceData = await fetchDevice(searchTerm);
      
      if (deviceData) {
        setDevice(deviceData);
        setFormData({
          custom_name: deviceData.custom_name || '',
          notes: deviceData.notes || '',
          manufacturer: deviceData.manufacturer || '',
          product: deviceData.product || ''
        });
        
        // تحديث URL بالرقم التسلسلي إذا لم يكن موجوداً
        if (!searchParams.get('serial') || searchParams.get('serial') !== searchTerm) {
          const newUrl = new URL(window.location);
          newUrl.searchParams.set('serial', searchTerm);
          window.history.replaceState({}, '', newUrl);
        }
      } else {
        setError('لم يتم العثور على الجهاز. تحقق من الرقم التسلسلي أو اسم الجهاز.');
      }
    } catch (err) {
      console.error('Error fetching device:', err);
      
      // تحسين رسائل الخطأ بناءً على نوع المشكلة
      let errorMessage = 'حدث خطأ أثناء البحث عن الجهاز.';
      
      if (err.response?.status === 404) {
        errorMessage = 'الجهاز غير موجود. تأكد من صحة الرقم التسلسلي.';
      } else if (err.response?.status === 403) {
        errorMessage = 'ليس لديك صلاحية للوصول إلى تفاصيل هذا الجهاز.';
      } else if (err.response?.status >= 500) {
        errorMessage = 'خطأ في الخادم. يرجى المحاولة لاحقاً.';
      } else if (err.code === 'NETWORK_ERROR') {
        errorMessage = 'مشكلة في الاتصال بالشبكة. تحقق من اتصالك بالإنترنت.';
      }
      
      setError(errorMessage);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, fetchDevice, searchParams]);

  // البحث التلقائي عند وجود رقم تسلسلي في URL
  useEffect(() => {
    const serialFromUrl = searchParams.get('serial');
    if (serialFromUrl && serialFromUrl.trim()) {
      setSearchQuery(serialFromUrl);
      // تأخير قصير للسماح للمكون بالتحميل بالكامل
      setTimeout(() => {
        handleSearch(serialFromUrl.trim());
      }, 100);
    }
  }, [searchParams, handleSearch]);

  // تحديد ما إذا كان يجب إخفاء واجهة البحث
  const shouldHideSearchInterface = device && searchParams.get('serial');

  // دالة مسح البحث
  const handleClearSearch = () => {
    setSearchQuery('');
    setDevice(null);
    setError('');
    setEditMode(false);
  };

  // دالة الضغط على Enter للبحث
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // استخراج meta_data
  const _meta = useMemo(() => {
    if (device && typeof device.meta_data === 'string') {
      try { return JSON.parse(device.meta_data || '{}'); } catch { return {}; }
    }
    return device?.meta_data || device?.metadata || {};
  }, [device]);

  // أيقونة الجهاز
  const deviceType = device?.device_type || device?.metadata?.device_type || _meta?.device_type || 'unknown';
  const DeviceIcon = iconsMap[deviceType] || iconsMap.unknown;

  // مودال تنفيذ إجراء
  const openModal = action => setModal({ show: true, action });
  const closeModal = () => setModal({ show: false, action: '' });

  // تنفيذ الإجراء من المودال
  const handleAction = async () => {
    if (!device) return;
    
    setActionLoading(true);
    try {
      await controlDevice(device.serial_number, { action: modal.action });
      closeModal();
      // إعادة جلب البيانات بعد التحديث
      await handleSearch();
    } catch (err) {
      setError(err.message || 'فشل تنفيذ الإجراء');
    } finally {
      setActionLoading(false);
    }
  };

  // حفظ التعديل
  const saveChanges = async () => {
    if (!device) return;
    
    setActionLoading(true);
    try {
      await updateDevice(device.serial_number, formData);
      setEditMode(false);
      // إعادة جلب البيانات بعد التحديث
      await handleSearch();
    } catch (err) {
      setError(err.message || 'فشل حفظ التغييرات');
    } finally {
      setActionLoading(false);
    }
  };

  // تحديث فورم التعديل
  const handleChange = e => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // محتوى المودال
  const getModalContent = () => {
    const name = device?.custom_name || device?.name || 'الجهاز';
    const msgs = {
      enable: ['تمكين الجهاز', `هل تريد تمكين "${name}"؟`],
      disable: ['تعطيل الجهاز', `هل تريد تعطيل "${name}"؟`],
      eject: ['إخراج وسائط التخزين', `هل تريد إخراج "${name}" بأمان؟`],
      whitelist: ['إضافة للقائمة البيضاء', `هل تريد إضافة "${name}" للقائمة البيضاء؟`],
      blacklist: ['إضافة للقائمة السوداء', `هل تريد إضافة "${name}" للقائمة السوداء؟`],
      block: ['حظر الجهاز', `هل تريد حظر "${name}"؟`]
    };
    return msgs[modal.action] || ['تأكيد الإجراء', 'هل أنت متأكد؟'];
  };
  const [modalTitle, modalMessage] = getModalContent();

  return (
    <div className="container py-4" dir="rtl">
      {/* رأس الصفحة مع شريط البحث */}
      <div className="row mb-4">
        <div className="col-12">
          <div className="d-flex align-items-center justify-content-between mb-3">
            <div className="d-flex align-items-center">
              <button 
                className="btn btn-outline-secondary me-3"
                onClick={() => navigate('/devices')}
              >
                <FaArrowRight className="me-1" />
                العودة لقائمة الأجهزة
              </button>
              <h2 className="mb-0 fw-bold">
                {device ? `تفاصيل الجهاز: ${device.name || device.serial_number}` : 'البحث عن تفاصيل الجهاز'}
              </h2>
            </div>
            {!shouldHideSearchInterface && (
              <button
                className="btn btn-outline-info"
                onClick={() => setSearchQuery('')}
              >
                <FaSearch className="me-1" />
                بحث جديد
              </button>
            )}
          </div>

          {/* شريط البحث - يظهر فقط عند عدم وجود جهاز محمل من URL */}
          {!shouldHideSearchInterface && (
            <div className="card shadow-sm border-0 mb-4">
              <div className="card-header bg-primary text-white">
                <h5 className="mb-0">
                  <FaSearch className="me-2" />
                  البحث عن الجهاز
                </h5>
              </div>
              <div className="card-body">
                <div className="row align-items-center">
                  <div className="col-md-8">
                    <div className="input-group">
                      <span className="input-group-text">
                        <FaUsb />
                      </span>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="أدخل الرقم التسلسلي أو اسم الجهاز..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyPress={handleKeyPress}
                        disabled={searching}
                      />
                      {searchQuery && (
                        <button
                          className="btn btn-outline-secondary"
                          type="button"
                          onClick={handleClearSearch}
                          disabled={searching}
                        >
                          <FaTimes />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="col-md-4">
                    <button
                      className="btn btn-primary w-100"
                      onClick={handleSearch}
                      disabled={searching || !searchQuery.trim()}
                    >
                      {searching ? (
                        <>
                          <FaSpinner className="fa-spin me-2" />
                          جاري البحث...
                        </>
                      ) : (
                        <>
                          <FaSearch className="me-2" />
                          بحث
                        </>
                      )}
                    </button>
                  </div>
                </div>
                
                {error && (
                  <div className="alert alert-danger mt-3 mb-0">
                    <i className="fas fa-exclamation-triangle me-2"></i>
                    {error}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* بطاقة نتائج البحث */}
      <div className="row">
        <div className="col-12">
          {/* عرض حالة التحميل أثناء البحث التلقائي */}
          {searching && (
            <div className="text-center py-5">
              <FaSpinner className="fa-spin fa-3x text-primary mb-3" />
              <h4>جاري تحميل تفاصيل الجهاز...</h4>
              <p className="text-muted">الرقم التسلسلي: {searchQuery}</p>
            </div>
          )}
          
          {/* عرض الخطأ إذا كان هناك خطأ ولا يوجد جهاز */}
          {error && !device && !searching && (
            <div className="alert alert-danger">
              <i className="fas fa-exclamation-triangle me-2"></i>
              {error}
              {searchParams.get('serial') && (
                <div className="mt-2">
                  <button
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => {
                      setError('');
                      setDevice(null);
                      const newUrl = new URL(window.location);
                      newUrl.searchParams.delete('serial');
                      window.history.replaceState({}, '', newUrl);
                      setSearchQuery('');
                    }}
                  >
                    <FaSearch className="me-1" />
                    بحث عن جهاز آخر
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="card shadow-sm border-0">
            <div className="card-header bg-light">
              <div className="d-flex justify-content-between align-items-center">
                <h5 className="mb-0">
                  <FaUsb className="me-2 text-primary" />
                  {device ? `تفاصيل ${device.name || 'الجهاز'}` : 'تفاصيل الجهاز'}
                </h5>
                {device && (
                  <div className="btn-group">
                    <button
                      className="btn btn-outline-primary btn-sm"
                      onClick={() => setEditMode(!editMode)}
                    >
                      <FaEdit className="me-1" />
                      {editMode ? 'إلغاء التعديل' : 'تعديل البيانات'}
                    </button>
                    {shouldHideSearchInterface && (
                      <button
                        className="btn btn-outline-info btn-sm"
                        onClick={() => {
                          const newUrl = new URL(window.location);
                          newUrl.searchParams.delete('serial');
                          window.history.replaceState({}, '', newUrl);
                          setSearchQuery('');
                          setDevice(null);
                          setError('');
                        }}
                      >
                        <FaSearch className="me-1" />
                        بحث جديد
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="card-body">
              {!device ? (
                /* حالة عدم وجود جهاز */
                <div className="row">
                  {/* القسم الأول: الحقول الفارغة */}
                  <div className="col-md-6">
                    <h6 className="text-muted mb-3">
                      <i className="fas fa-edit me-2"></i>
                      معلومات ستظهر عند البحث
                    </h6>
                    <div className="border rounded p-3 bg-light">
                      <div className="mb-3">
                        <label className="form-label text-muted">اسم الجهاز:</label>
                        <div className="form-control bg-white" style={{height: '38px', color: 'var(--text-secondary)'}}>
                          سيظهر اسم الجهاز هنا
                        </div>
                      </div>
                      <div className="mb-3">
                        <label className="form-label text-muted">الرقم التسلسلي:</label>
                        <div className="form-control bg-white" style={{height: '38px', color: 'var(--text-secondary)'}}>
                          سيظهر الرقم التسلسلي هنا
                        </div>
                      </div>
                      <div className="mb-3">
                        <label className="form-label text-muted">المصنع:</label>
                        <div className="form-control bg-white" style={{height: '38px', color: 'var(--text-secondary)'}}>
                          سيظهر اسم المصنع هنا
                        </div>
                      </div>
                      <div className="mb-3">
                        <label className="form-label text-muted">المنتج:</label>
                        <div className="form-control bg-white" style={{height: '38px', color: 'var(--text-secondary)'}}>
                          سيظهر نوع المنتج هنا
                        </div>
                      </div>
                      <div className="mb-3">
                        <label className="form-label text-muted">الحالة:</label>
                        <div className="form-control bg-white" style={{height: '38px', color: 'var(--text-secondary)'}}>
                          ستظهر حالة الجهاز هنا
                        </div>
                      </div>
                      <div className="mb-0">
                        <label className="form-label text-muted">استهلاك الطاقة:</label>
                        <div className="form-control bg-white" style={{height: '38px', color: 'var(--text-secondary)'}}>
                          سيظهر استهلاك الطاقة بالواط هنا
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* القسم الثاني: المعلومات التي ستُجلب */}
                  <div className="col-md-6">
                    <h6 className="text-success mb-3">
                      <i className="fas fa-info-circle me-2"></i>
                      معلومات تقنية ستُجلب من النظام
                    </h6>
                    <div className="border rounded p-3 bg-success bg-opacity-10">
                      <div className="d-flex align-items-center mb-3">
                        <FaUsb className="text-success me-2" size={20} />
                        <div>
                          <strong>معرف الجهاز (Vendor ID & Product ID)</strong>
                          <br />
                          <small className="text-muted">المعرفات الفريدة للجهاز</small>
                        </div>
                      </div>
                      <div className="d-flex align-items-center mb-3">
                        <FaNetworkWired className="text-info me-2" size={20} />
                        <div>
                          <strong>منفذ USB ومسار الاتصال</strong>
                          <br />
                          <small className="text-muted">موقع الجهاز في النظام</small>
                        </div>
                      </div>
                      <div className="d-flex align-items-center mb-3">
                        <FaHdd className="text-warning me-2" size={20} />
                        <div>
                          <strong>معلومات التخزين والسعة</strong>
                          <br />
                          <small className="text-muted">حجم البيانات المنقولة</small>
                        </div>
                      </div>
                      <div className="d-flex align-items-center mb-3">
                        <FaSpinner className="text-primary me-2" size={20} />
                        <div>
                          <strong>حالة الجهاز والأمان</strong>
                          <br />
                          <small className="text-muted">متصل، منفصل، محظور، مسموح</small>
                        </div>
                      </div>
                      <div className="d-flex align-items-center mb-3">
                        <FaClock className="text-secondary me-2" size={20} />
                        <div>
                          <strong>أوقات الاتصال والنشاط</strong>
                          <br />
                          <small className="text-muted">متى تم توصيله وآخر نشاط</small>
                        </div>
                      </div>
                      <div className="d-flex align-items-center mb-0">
                        <i className="fas fa-bolt text-warning me-2" style={{fontSize: '20px'}}></i>
                        <div>
                          <strong>استهلاك الطاقة والكفاءة</strong>
                          <br />
                          <small className="text-muted">مقدار الطاقة المستهلكة بالواط ومستوى الكفاءة</small>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* حالة وجود جهاز */
                <div className="row">
                  <div className="col-md-6">
                    {/* معلومات أساسية */}
                    <div className="d-flex align-items-center mb-4">
                      {DeviceIcon}
                      <div className="ms-3">
                        <h4 className="mb-1">{device.custom_name || device.name || 'جهاز غير معروف'}</h4>
                        <StatusBadge status={device.status} />
                      </div>
                    </div>

                    {editMode ? (
                      /* وضع التعديل */
                      <div>
                        <div className="mb-3">
                          <label className="form-label">الاسم المخصص</label>
                          <input
                            type="text"
                            className="form-control"
                            name="custom_name"
                            value={formData.custom_name}
                            onChange={handleChange}
                          />
                        </div>
                        <div className="mb-3">
                          <label className="form-label">المصنع</label>
                          <input
                            type="text"
                            className="form-control"
                            name="manufacturer"
                            value={formData.manufacturer}
                            onChange={handleChange}
                          />
                        </div>
                        <div className="mb-3">
                          <label className="form-label">المنتج</label>
                          <input
                            type="text"
                            className="form-control"
                            name="product"
                            value={formData.product}
                            onChange={handleChange}
                          />
                        </div>
                        <div className="mb-3">
                          <label className="form-label">ملاحظات</label>
                          <textarea
                            className="form-control"
                            name="notes"
                            rows="3"
                            value={formData.notes}
                            onChange={handleChange}
                          />
                        </div>
                        
                        {/* معلومات الطاقة - للقراءة فقط */}
                        <div className="mb-3">
                          <label className="form-label">استهلاك الطاقة</label>
                          <div className="input-group">
                            <input
                              type="text"
                              className="form-control"
                              value={`${device.power_consumption || '0'} واط`}
                              readOnly
                              style={{
                                backgroundColor: (device.power_consumption || 0) > 2.5 ? '#ffe6e6' : '#e6f7e6',
                                color: (device.power_consumption || 0) > 2.5 ? '#d32f2f' : '#2e7d32'
                              }}
                            />
                            <span className="input-group-text">
                              {(device.power_consumption || 0) > 2.5 ? (
                                <i className="fas fa-exclamation-triangle text-danger"></i>
                              ) : (
                                <i className="fas fa-check-circle text-success"></i>
                              )}
                            </span>
                          </div>
                          <small className="text-muted">
                            الكفاءة: {(device.power_consumption || 0) <= 1.0 ? 'ممتازة' : 
                                    (device.power_consumption || 0) <= 2.5 ? 'جيدة' : 'ضعيفة'}
                          </small>
                        </div>
                        <div className="d-flex gap-2">
                          <button
                            className="btn btn-success"
                            onClick={saveChanges}
                            disabled={actionLoading}
                          >
                            {actionLoading ? <FaSpinner className="fa-spin me-1" /> : null}
                            حفظ التغييرات
                          </button>
                          <button
                            className="btn btn-secondary"
                            onClick={() => setEditMode(false)}
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* وضع العرض */
                      <div>
                        <div className="mb-3">
                          <strong>الرقم التسلسلي:</strong>
                          <span className="ms-2">{device.serial_number || '-'}</span>
                          {device.serial_number && (
                            <button 
                              className="btn btn-link btn-sm p-0 text-muted ms-2"
                              title="نسخ الرقم التسلسلي"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(device.serial_number)
                                  .then(() => toast.success('تم نسخ الرقم التسلسلي بنجاح'))
                                  .catch(() => toast.error('فشل في نسخ الرقم التسلسلي'));
                              }}
                            >
                              <i className="fas fa-copy" style={{fontSize: '14px'}}></i>
                            </button>
                          )}
                        </div>
                        <div className="mb-3">
                          <strong>المصنع:</strong>
                          <span className="ms-2">{device.manufacturer || '-'}</span>
                        </div>
                        <div className="mb-3">
                          <strong>المنتج:</strong>
                          <span className="ms-2">{device.product || '-'}</span>
                        </div>
                        <div className="mb-3">
                          <strong>منفذ USB:</strong>
                          <span className="ms-2">{device.usb_port || '-'}</span>
                        </div>
                        <div className="mb-3">
                          <strong>وقت الاتصال:</strong>
                          <span className="ms-2">
                            {device.connection_time ? formatDateTime(device.connection_time) : '-'}
                          </span>
                        </div>
                        <div className="mb-3">
                          <strong>استهلاك الطاقة:</strong>
                          <span className={`ms-2 ${(device.power_consumption || 0) > 2.5 ? 'text-danger fw-bold' : 'text-success'}`}>
                            {device.power_consumption || '0'} واط
                          </span>
                          {(device.power_consumption || 0) > 2.5 && (
                            <small className="text-danger ms-2">
                              <i className="fas fa-exclamation-triangle me-1"></i>
                              استهلاك مرتفع
                            </small>
                          )}
                        </div>
                        {device.notes && (
                          <div className="mb-3">
                            <strong>ملاحظات:</strong>
                            <div className="mt-1 p-2 bg-light rounded">
                              {device.notes}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="col-md-6">
                    {/* معلومات تقنية */}
                    <h6 className="text-primary mb-3">معلومات تقنية</h6>
                    <div className="bg-light p-3 rounded">
                      <div className="row g-3">
                        <div className="col-6">
                          <small className="text-muted">Vendor ID</small>
                          <div>{device.vendor_id || '-'}</div>
                        </div>
                        <div className="col-6">
                          <small className="text-muted">Product ID</small>
                          <div>{device.product_id || '-'}</div>
                        </div>
                        <div className="col-6">
                          <small className="text-muted">فئة الجهاز</small>
                          <div>{device.device_class || '-'}</div>
                        </div>
                        <div className="col-6">
                          <small className="text-muted">سرعة النقل</small>
                          <div>{device.speed_class || '-'}</div>
                        </div>
                        <div className="col-6">
                          <small className="text-muted">استهلاك الطاقة</small>
                          <div className={`${(device.power_consumption || 0) > 2.5 ? 'text-danger fw-bold' : ''}`}>
                            {device.power_consumption || '0'} W
                          </div>
                        </div>
                        <div className="col-6">
                          <small className="text-muted">كفاءة الطاقة</small>
                          <div>
                            {(device.power_consumption || 0) <= 1.0 ? (
                              <span className="text-success">ممتازة</span>
                            ) : (device.power_consumption || 0) <= 2.5 ? (
                              <span className="text-warning">جيدة</span>
                            ) : (
                              <span className="text-danger">ضعيفة</span>
                            )}
                          </div>
                        </div>
                        <div className="col-12">
                          <small className="text-muted">المسار الفيزيائي</small>
                          <div className="font-monospace small">
                            {device.physical_path || '-'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* أزرار التحكم */}
                    <div className="mt-4">
                      <h6 className="text-primary mb-3">إجراءات التحكم</h6>
                      <div className="row g-2">
                        <div className="col-6">
                          <button
                            className="btn btn-success btn-sm w-100"
                            onClick={() => openModal('enable')}
                          >
                            تمكين الجهاز
                          </button>
                        </div>
                        <div className="col-6">
                          <button
                            className="btn btn-warning btn-sm w-100"
                            onClick={() => openModal('disable')}
                          >
                            تعطيل الجهاز
                          </button>
                        </div>
                        <div className="col-6">
                          <button
                            className="btn btn-info btn-sm w-100"
                            onClick={() => openModal('eject')}
                          >
                            إخراج بأمان
                          </button>
                        </div>
                        <div className="col-6">
                          <button
                            className="btn btn-danger btn-sm w-100"
                            onClick={() => openModal('block')}
                          >
                            حظر الجهاز
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* مودال تأكيد الإجراء */}
      <Modal show={modal.show} onClose={closeModal} title={modalTitle}>
        <p>{modalMessage}</p>
        <div className="d-flex justify-content-end gap-2">
          <button className="btn btn-secondary" onClick={closeModal}>
            إلغاء
          </button>
          <button
            className="btn btn-primary"
            onClick={handleAction}
            disabled={actionLoading}
          >
            {actionLoading ? <FaSpinner className="fa-spin me-1" /> : null}
            تأكيد
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default DeviceDetails;
