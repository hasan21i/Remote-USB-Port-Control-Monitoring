// src/pages/devices/DeviceScan.jsx

import React, { useState, useEffect, useCallback } from 'react';
// eslint-disable-next-line no-unused-vars
import useDevice from '../../hooks/useDevice';
import { formatDateTime } from '../../utils/formatters';

const DeviceScan = () => {
  // استخدام الدوال الجديدة حسب التحديث الأخير
  const {
    scanDevices,
    getDevices,
    controlDevice,
    searchDevicesEnhanced  // إضافة البحث المحسن
  } = useDevice();

  // الحالة العامة
  const [foundDevices, setFoundDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanCompleted, setScanCompleted] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [lastScanTime, setLastScanTime] = useState(() => localStorage.getItem('lastScanTime'));
  const [progress, setProgress] = useState(0);
  const [deviceActions, setDeviceActions] = useState({});
  const [searchQuery, setSearchQuery] = useState('');  // حالة البحث
  const [isSearching, setIsSearching] = useState(false);  // حالة البحث الجاري
  const [searchAllServers, setSearchAllServers] = useState(false);  // البحث في جميع السيرفرات

  // تهيئة الأجهزة: تحويل البيانات للعرض
  const formatDevices = useCallback(response => {
    let devices = [];
    if (Array.isArray(response)) {
      devices = response;
    } else if (response.devices) {
      devices = response.devices;
    } else if (response.added && Array.isArray(response.added)) {
      // من scan-now API - الأجهزة المكتشفة حديثاً
      devices = response.added;
    } else if (response.updated && Array.isArray(response.updated)) {
      // الأجهزة المحدثة (موجودة مسبقاً ومتصلة)
      devices = [...(response.added || []), ...response.updated];
    } else if (response.changes?.added) {
      devices = response.changes.added;
    } else if (response.connectedDevicesList) {
      devices = response.connectedDevicesList;
    }
    return devices.map(d => {
      const meta = typeof d.meta_data === 'string' ? JSON.parse(d.meta_data || '{}') : d.meta_data || d.metadata || {};
      return {
        ...d,
        metadata: meta,
        serial_number: d.serial_number || meta.device_identifier || 'غير متوفر',
        usb_port: d.usb_port || meta.port_number || '-',
        physical_path: d.physical_path || meta.physical_path || '-',
        name: d.name || d.product || 'جهاز غير معروف',
        status: d.status || 'unknown',
        device_type: d.device_type || meta.device_type || d.device_class || 'Unknown',
        device_class: d.device_class || meta.device_class || 'Unknown'
      };
    });
  }, []);

  // عداد المسح المتحرك
  useEffect(() => {
    if (!scanning) return;
    setProgress(0);
    const interval = setInterval(() => {
      setProgress(p => (p < 95 ? p + 5 : p));
    }, 250);
    return () => clearInterval(interval);
  }, [scanning]);

  // حفظ وقت آخر مسح
  useEffect(() => {
    if (lastScanTime) localStorage.setItem('lastScanTime', lastScanTime);
  }, [lastScanTime]);

  // زر مسح الأجهزة
  const handleScan = useCallback(async () => {
    setScanning(true);
    setScanCompleted(false);
    setScanError(null);
    setFoundDevices([]);
    setDeviceActions({});
    setProgress(0);

    try {
      const resp = await scanDevices();
      await new Promise(r => setTimeout(r, 1300));
      const devices = formatDevices(resp);
      setFoundDevices(devices);
      setLastScanTime(new Date().toISOString());
      setScanCompleted(true);
      setProgress(100);
    } catch (err) {
      setScanError(err.message || 'حدث خطأ أثناء المسح');
    } finally {
      setScanning(false);
    }
  }, [scanDevices, formatDevices]);

  // البحث المحسن
  const handleEnhancedSearch = useCallback(async () => {
    if (!searchQuery.trim() && !searchAllServers) return;
    
    setIsSearching(true);
    setScanError(null);
    
    try {
      const response = await searchDevicesEnhanced(searchQuery, searchAllServers);
      const devices = formatDevices(response.data || response);
      setFoundDevices(devices);
      setScanCompleted(true);
    } catch (err) {
      setScanError(err.message || 'حدث خطأ أثناء البحث');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, searchAllServers, searchDevicesEnhanced, formatDevices]);

  // تنفيذ إجراء على الجهاز (إخراج فقط)
  const handleDeviceAction = useCallback(async (deviceId, action) => {
    if (deviceActions[deviceId]) return;
    setDeviceActions(a => ({ ...a, [deviceId]: action }));
    try {
      const dev = foundDevices.find(d => d.id === deviceId);
      if (!dev) throw new Error('الجهاز غير موجود');
      const identifier = dev.serial_number;
      await controlDevice(identifier, { action });
      setFoundDevices(list =>
        list.map(d =>
          d.id === deviceId && action === 'eject'
            ? { ...d, status: 'ejected' }
            : d
        )
      );
    } catch (err) {
      // عرض خطأ صغير هنا (اختياري)
    } finally {
      setDeviceActions(a => { const c = { ...a }; delete c[deviceId]; return c; });
    }
  }, [controlDevice, foundDevices, deviceActions]);

  // جلب الأجهزة عند التهيئة - تشغيل مسح تلقائي للأجهزة الحقيقية
  useEffect(() => {
    (async () => {
      try {
        // تشغيل مسح فوري للكشف عن الأجهزة الحقيقية المتصلة
        const scanResult = await scanDevices();
        if (scanResult) {
          const devices = formatDevices(scanResult);
          setFoundDevices(devices);
          if (devices.length > 0) {
            setScanCompleted(true);
            setProgress(100);
          }
        }
      } catch {
        // في حالة الفشل، حاول جلب الأجهزة المتصلة من قاعدة البيانات
        try {
          const initial = await getDevices({ status: 'connected' });
          if (initial) setFoundDevices(formatDevices(initial));
        } catch {}
      }
    })();
  }, [scanDevices, getDevices, formatDevices]);

  // ترتيب جمالي (Bootstrap grid, card soft shadow, header, ألوان أ clearer)
  return (
    <div className="device-scan-page container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="fw-bold mb-1">
            <i className="fas fa-search me-2 text-primary" />
            فحص أجهزة USB الحقيقية المتصلة
          </h2>
          <span className="text-muted">
            اكتشف الأجهزة USB الحقيقية المتصلة فعلياً، مع استبعاد الأجهزة الداخلية والوهمية.
          </span>
        </div>
        <button
          className="btn btn-lg btn-primary shadow"
          onClick={handleScan}
          disabled={scanning || isSearching}
        >
          {scanning
            ? <><span className="spinner-border spinner-border-sm me-1" /> جاري الفحص…</>
            : <><i className="fas fa-sync-alt me-1" /> بدء الفحص</>}
        </button>
      </div>

      {/* حقل البحث المحسن */}
      <div className="card mb-4 shadow-sm border-0 rounded-4">
        <div className="card-body">
          <h5 className="card-title mb-3 text-primary">
            <i className="fas fa-search-plus me-2" /> بحث محسن
          </h5>
          <div className="row g-3">
            <div className="col-md-8">
              <input
                type="text"
                className="form-control form-control-lg"
                placeholder="ابحث عن أجهزة باستخدام الاسم أو الرقم التسلسلي..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleEnhancedSearch()}
              />
            </div>
            <div className="col-md-4 d-flex align-items-center">
              <div className="form-check form-switch me-3">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="searchAllServers"
                  checked={searchAllServers}
                  onChange={(e) => setSearchAllServers(e.target.checked)}
                />
                <label className="form-check-label" htmlFor="searchAllServers">
                  البحث في جميع السيرفرات
                </label>
              </div>
              <button
                className="btn btn-success"
                onClick={handleEnhancedSearch}
                disabled={isSearching || (!searchQuery.trim() && !searchAllServers)}
              >
                {isSearching ? (
                  <><span className="spinner-border spinner-border-sm me-1" /> جاري البحث...</>
                ) : (
                  <><i className="fas fa-search me-1" /> بحث</>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {scanError && (
        <div className="alert alert-danger rounded-pill px-4 mb-4">
          <i className="fas fa-exclamation-triangle me-2" /> {scanError}
        </div>
      )}

      <div className="card mb-4 shadow-sm border-0 rounded-4">
        <div className="card-body">
          <h5 className="card-title mb-2 text-primary">
            <i className="fas fa-broadcast-tower me-2" />حالة المسح
          </h5>
          <div className="progress mb-2" style={{ height: 20 }}>
            <div
              className="progress-bar progress-bar-striped progress-bar-animated bg-info"
              style={{ width: `${progress}%` }}
              role="progressbar"
            >
              {progress}%
            </div>
          </div>
          <p className="mb-0">
            {scanning
              ? 'جاري الفحص والفلترة...'
              : isSearching
                ? 'جاري البحث المحسن...'
                : scanCompleted
                  ? `اكتمل الفحص: ${foundDevices.length} جهاز USB حقيقي${foundDevices.length > 1 ? '' : ''}`
                  : lastScanTime
                    ? `آخر فحص: ${formatDateTime(lastScanTime)}`
                    : <>اضغط <b>بدء الفحص</b> لاكتشاف الأجهزة USB الحقيقية</>
            }
          </p>
        </div>
      </div>

      {/* البطاقات */}
      {foundDevices.length > 0 ? (
        <>
          <div className="alert alert-info rounded-3">
            <i className="fas fa-usb me-2 text-primary" />
            الأجهزة USB الحقيقية المكتشفة: <b>{foundDevices.length}</b>
            {searchAllServers && (
              <span className="badge bg-success ms-2">بحث في جميع السيرفرات</span>
            )}
            <small className="d-block mt-1 text-muted">
              (تم استبعاد الأجهزة الداخلية والوهمية تلقائياً)
            </small>
          </div>
          <div className="row g-4">
            {foundDevices.map(d => (
              <div key={d.id || d.serial_number} className="col-12 col-md-6 col-lg-4">
                <div className="card h-100 shadow border-0 rounded-4">
                  <div className="card-header bg-white border-0 d-flex justify-content-between align-items-center">
                    <h5 className="card-title mb-0">{d.name}</h5>
                    <span className={`badge fs-6 px-3
                      ${d.status === 'pending' ? 'bg-warning text-dark'
                        : d.status === 'connected' ? 'bg-success'
                        : d.status === 'ejected' ? 'bg-secondary'
                        : 'bg-light text-muted'}
                    `}>
                      {d.status === 'pending' ? 'معلق'
                        : d.status === 'connected' ? 'متصل'
                        : d.status === 'ejected' ? 'مفصول'
                        : d.status}
                    </span>
                  </div>
                  <div className="card-body">
                    <p className="mb-2">
                      <i className="fas fa-hashtag me-1" /> <b>الرقم التسلسلي/المعرف:</b> {d.serial_number}
                    </p>
                    <p className="mb-2">
                      <i className="fas fa-usb me-1" /> <b>رقم البورت:</b> {d.usb_port}
                    </p>
                    <p className="mb-2">
                      <i className="fas fa-link me-1" /> <b>المسار الفيزيائي:</b> {d.physical_path}
                    </p>
                    <p className="mb-2">
                      <i className="fas fa-industry me-1" /> <b>الشركة:</b> {d.manufacturer || 'غير معروف'}
                    </p>
                    <p className="mb-2">
                      <i className="fas fa-th-large me-1" /> <b>النوع:</b> {d.device_type || d.metadata?.device_type || d.device_class || 'غير معروف'}
                    </p>
                    {d.connection_time && (
                      <p className="mb-2">
                        <i className="fas fa-clock me-1" /> <b>وقت الاتصال:</b> {formatDateTime(d.connection_time)}
                      </p>
                    )}
                  </div>
                  <div className="card-footer bg-white border-0 d-flex justify-content-end">
                    <button
                      className="btn btn-outline-danger btn-sm ms-2"
                      onClick={() => handleDeviceAction(d.id, 'eject')}
                      disabled={!!deviceActions[d.id] || d.status === 'ejected'}
                    >
                      {deviceActions[d.id] === 'eject'
                        ? <span className="spinner-border spinner-border-sm me-1" />
                        : <i className="fas fa-eject me-1" />} فصل
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : !scanning && !isSearching && (
        <div className="alert alert-info text-center rounded-3 my-5 py-4">
          <i className="fas fa-info-circle me-2" />
          لم يتم العثور على أي أجهزة USB حقيقية متصلة.
          <br />
          <button className="btn btn-outline-primary mt-2" onClick={handleScan}>
            <i className="fas fa-sync-alt me-1" /> بدء فحص الأجهزة
          </button>
        </div>
      )}
    </div>
  );
};

export default DeviceScan;