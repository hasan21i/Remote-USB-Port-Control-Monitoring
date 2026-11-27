// src/components/LogTable.jsx

import React, { useState, useEffect, useCallback, memo, Fragment, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import { fetchLogs, clearLogs } from '../utils/api';
import { formatDateTime, formatEventType } from '../utils/formatters';
import { CSVLink } from 'react-csv';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import Spinner from './Spinner';
import { toast } from 'react-toastify';

// تسجيل مكونات Chart.js
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

// --- Error banner ---
const ErrorAlert = ({ message }) => (
  <div className="alert alert-danger" role="alert" aria-live="assertive">
    <i className="fas fa-exclamation-triangle me-2" aria-hidden="true" />
    {message}
  </div>
);
ErrorAlert.displayName = 'ErrorAlert';
ErrorAlert.propTypes = { message: PropTypes.string.isRequired };

// --- Print Styles ---
const printStyles = `
@media print {
  .no-print { display: none !important; }
  .print-only { display: block !important; }
  
  body { 
    font-family: Arial, sans-serif !important;
    font-size: 12px !important;
    color: var(--black) !important;
    background: white !important;
  }
  
  .table {
    border-collapse: collapse !important;
    width: 100% !important;
    margin: 0 !important;
  }
  
  .table th, .table td {
    border: 1px solid var(--black) !important;
    padding: 4px !important;
    font-size: 10px !important;
    text-align: right !important;
  }
  
  .table th {
    background-color: #f0f0f0 !important;
    font-weight: bold !important;
  }
  
  .badge {
    color: var(--black) !important;
    background: #f0f0f0 !important;
    border: 1px solid var(--black) !important;
    padding: 2px 4px !important;
    border-radius: 0 !important;
  }
  
  .page-break { page-break-before: always; }
  
  .print-header {
    text-align: center;
    margin-bottom: 20px;
    border-bottom: 2px solid var(--black);
    padding-bottom: 10px;
  }
  
  .print-header h1 {
    font-size: 18px !important;
    margin: 0 !important;
  }
  
  .print-header p {
    font-size: 12px !important;
    margin: 5px 0 !important;
  }
}
`;

// --- Chart Component with proper cleanup ---
const LogChart = memo(({ eventStats, language }) => {
  const chartRef = useRef(null);

  const chartData = useMemo(() => {
    const labels = Object.keys(eventStats).map(action => formatEventType(action, language));
    const data = Object.values(eventStats);
    
    return {
      labels,
      datasets: [{ 
        label: language === 'ar' ? 'عدد الأحداث' : 'Event Count',
        data,
        backgroundColor: [
          'rgba(54, 162, 235, 0.7)',
          'rgba(255, 99, 132, 0.7)',
          'rgba(255, 205, 86, 0.7)',
          'rgba(75, 192, 192, 0.7)',
          'rgba(153, 102, 255, 0.7)',
          'rgba(255, 159, 64, 0.7)',
        ],
        borderColor: [
          'rgba(54, 162, 235, 1)',
          'rgba(255, 99, 132, 1)',
          'rgba(255, 205, 86, 1)',
          'rgba(75, 192, 192, 1)',
          'rgba(153, 102, 255, 1)',
          'rgba(255, 159, 64, 1)',
        ],
        borderWidth: 1
      }],
    };
  }, [eventStats, language]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      title: {
        display: true,
        text: language === 'ar' ? 'إحصائيات الأحداث' : 'Event Statistics',
        font: {
          size: 16,
          weight: 'bold'
        }
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          stepSize: 1
        }
      }
    }
  }), [language]);

  // تنظيف Chart عند unmount
  useEffect(() => {
    const currentChart = chartRef.current;
    return () => {
      if (currentChart && currentChart.chartInstance) {
        currentChart.chartInstance.destroy();
      }
    };
  }, []);

  if (Object.keys(eventStats).length === 0) {
    return null;
  }

  return (
    <div className="mb-4 no-print px-4 pt-4">
      <div className="card shadow-sm border-0 bg-light bg-opacity-10" style={{ backgroundColor: 'var(--bs-body-bg)' }}>
        <div className="card-body">
          <div style={{ height: '300px' }}>
            <Bar ref={chartRef} data={chartData} options={chartOptions} />
          </div>
        </div>
      </div>
    </div>
  );
});
LogChart.displayName = 'LogChart';
LogChart.propTypes = {
  eventStats: PropTypes.object.isRequired,
  language: PropTypes.string.isRequired
};

// --- Single log row ---
const LogRow = memo(({ log, readOnly, language = 'ar' }) => {
  const badgeClass = (() => {
    switch (log.action) {
      case 'device_connected':
      case 'device_authorized':
        return 'bg-success text-white';
      case 'device_disconnected':
      case 'device_blocked':
        return 'bg-warning text-dark';
      case 'error':
        return 'bg-danger text-white';
      case 'device_discovered':
      case 'logs_viewed':
        return 'bg-info text-white';
      case 'logs_cleared':
      case 'password_reset':
        return 'bg-primary text-white';
      case 'usb_transfer':
        return 'bg-secondary text-white';
      default:
        return 'bg-secondary text-white';
    }
  })();

  // استخراج تفاصيل النقل إذا كان السجل من نوع usb_transfer
  let transferType = null, transferSize = null, filename = null, geo = null;
  if (log.action === 'usb_transfer' && log.details) {
    try {
      const d = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
      transferType = d.transfer_type;
      transferSize = d.transfer_size;
      filename = d.filename;
      geo = d.geo_location;
    } catch {}
  }
  // استخراج الموقع الجغرافي من أي سجل آخر أيضاً
  if (!geo && log.details) {
    try {
      const d = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
      geo = d.geo_location;
    } catch {}
  }
  // بناء نص الموقع الجغرافي
  let geoText = '—', geoTooltip = '';
  if (geo) {
    geoText = language === 'ar' 
      ? `${geo.country || ''}${geo.city ? ' - ' + geo.city : ''}`
      : `${geo.city || ''}${geo.country ? ', ' + geo.country : ''}`;
    geoTooltip = language === 'ar'
      ? `الدولة: ${geo.country || ''}\nالمدينة: ${geo.city || ''}\nالمنطقة: ${geo.region || ''}\nمزود الخدمة: ${geo.org || ''}\nIP: ${geo.ip || ''}\nإحداثيات: ${geo.lat},${geo.lon}`
      : `Country: ${geo.country || ''}\nCity: ${geo.city || ''}\nRegion: ${geo.region || ''}\nISP: ${geo.org || ''}\nIP: ${geo.ip || ''}\nCoordinates: ${geo.lat},${geo.lon}`;
  }

  const labels = language === 'ar' 
    ? { read: 'قراءة', write: 'كتابة' }
    : { read: 'Read', write: 'Write' };

  return (
    <tr className="align-middle transition-all hover-shadow-sm">
      <td className="text-nowrap">{formatDateTime(log.timestamp)}</td>
      <td className="text-nowrap">
        <span className={`badge ${badgeClass} px-3 py-2 rounded-pill shadow-sm`}>
          {formatEventType(log.action, language)}
        </span>
      </td>
      <td className="text-nowrap fw-medium">{log.target_device || '—'}</td>
      <td className="text-nowrap">{log.username || '—'}</td>
      <td className="text-truncate" style={{ maxWidth: '300px' }} title={log._detailsFull}>
        {log._detailsShort}
      </td>
      {/* عمود الموقع الجغرافي */}
      <td className="text-nowrap">
        {geo && geo.lat && geo.lon ? (
          <span title={geoTooltip} style={{ cursor: 'pointer' }} className="badge bg-light text-dark border shadow-sm">
            <i className="fas fa-map-marker-alt text-danger me-1" />
            {geoText}
          </span>
        ) : (
          <span title={geoTooltip} className="text-muted">{geoText}</span>
        )}
      </td>
      <td className="text-nowrap font-monospace text-muted">{log.ip_address || '—'}</td>
      {!readOnly && (
        <td className="no-print text-nowrap">
          <div className="d-flex justify-content-center gap-2">
            <button
              className="btn btn-sm btn-primary shadow-sm"
              title={language === 'ar' ? "عرض التفاصيل" : "View Details"}
              onClick={() => alert(JSON.stringify(log, null, 2))}
              type="button"
            >
              <i className="fas fa-eye me-1" /> {language === 'ar' ? 'تفاصيل' : 'Details'}
            </button>
            <button
              className="btn btn-sm btn-success shadow-sm"
              title={language === 'ar' ? "تصدير السجل" : "Export Log"}
              onClick={() => {
                const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement('a');
                a.href     = url;
                a.download = `log_${log.id}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              type="button"
            >
              <i className="fas fa-file-export me-1" /> {language === 'ar' ? 'تصدير' : 'Export'}
            </button>
          </div>
        </td>
      )}
    </tr>
  );
});
LogRow.displayName = 'LogRow';
LogRow.propTypes = {
  log: PropTypes.shape({
    id:            PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    timestamp:     PropTypes.string.isRequired,
    action:        PropTypes.string.isRequired,
    target_device: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    username:      PropTypes.string,
    ip_address:    PropTypes.string,
    details:       PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
    _detailsFull:  PropTypes.string.isRequired,
    _detailsShort: PropTypes.string.isRequired,
  }).isRequired,
  readOnly: PropTypes.bool.isRequired,
  language: PropTypes.string
};

// --- Main table component ---
const LogTable = ({ readOnly = false }) => {
  const [logs, setLogs]           = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]         = useState(null);
  const [filters, setFilters]     = useState({ action: '', user: '', device: '', from: '', to: '' });
  const [language, setLanguage]   = useState('ar');

  // Fetch and normalize logs
  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { logs: fetched = [] } = await fetchLogs();
      const processed = fetched.map(l => {
        const raw = l.details ?? l.message ?? '';
        const full = typeof raw === 'object' ? JSON.stringify(raw) : raw;
        const short = full.length > 80 ? full.slice(0, 80) + '…' : full;
        return { ...l, _detailsFull: full, _detailsShort: short };
      });
      setLogs(processed);
    } catch (e) {
      setError(e.message || 'حدث خطأ أثناء جلب السجلات');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  // فلترة السجلات
  const filteredLogs = useMemo(() => logs.filter(l => {
    if (filters.action && l.action !== filters.action) return false;
    if (filters.user && l.username !== filters.user) return false;
    if (filters.device && l.target_device !== filters.device) return false;
    if (filters.from && new Date(l.timestamp) < new Date(filters.from)) return false;
    if (filters.to && new Date(l.timestamp) > new Date(filters.to)) return false;
    // فلاتر النقل
    if (filters.transfer_type && l.action === 'usb_transfer') {
      let t = null; try { t = typeof l.details === 'string' ? JSON.parse(l.details).transfer_type : l.details.transfer_type; } catch {}
      if (t !== filters.transfer_type) return false;
    }
    if (filters.transfer_size && l.action === 'usb_transfer') {
      let s = null; try { s = typeof l.details === 'string' ? JSON.parse(l.details).transfer_size : l.details.transfer_size; } catch {}
      if (parseInt(s) !== parseInt(filters.transfer_size)) return false;
    }
    return true;
  }), [logs, filters]);

  // إحصائيات الأحداث
  const eventStats = useMemo(() => {
    const stats = {};
    filteredLogs.forEach(l => { stats[l.action] = (stats[l.action] || 0) + 1; });
    return stats;
  }, [filteredLogs]);

  // Clear logs older than 30 days
  const handleClear = async () => {
    const message = language === 'ar' 
      ? 'مسح السجلات الأقدم من 30 يوم؟' 
      : 'Clear logs older than 30 days?';
    
    if (!window.confirm(message)) return;
    try {
      await clearLogs();
      await loadLogs();
      toast.success(language === 'ar' ? 'تم مسح السجلات بنجاح' : 'Logs cleared successfully');
    } catch {
      toast.error(language === 'ar' ? 'فشل في مسح السجلات' : 'Failed to clear logs');
    }
  };

  // Print functionality
  const handlePrint = () => {
    // إضافة أنماط الطباعة
    if (!document.getElementById('print-styles')) {
      const style = document.createElement('style');
      style.id = 'print-styles';
      style.textContent = printStyles;
      document.head.appendChild(style);
    }

    // إنشاء نافذة طباعة
    const printWindow = window.open('', '_blank');
    const printContent = `
      <!DOCTYPE html>
      <html dir="${language === 'ar' ? 'rtl' : 'ltr'}" lang="${language}">
      <head>
        <meta charset="UTF-8">
        <title>${language === 'ar' ? 'تقرير السجلات' : 'Logs Report'}</title>
        <style>${printStyles}</style>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body>
        <div class="print-header">
          <h1>${language === 'ar' ? 'تقرير سجلات النشاط' : 'Activity Logs Report'}</h1>
          <p>${language === 'ar' ? 'تاريخ الطباعة: ' : 'Print Date: '}${new Date().toLocaleString(language === 'ar' ? 'ar-SA' : 'en-US')}</p>
          <p>${language === 'ar' ? `إجمالي السجلات: ${filteredLogs.length}` : `Total Logs: ${filteredLogs.length}`}</p>
        </div>
        <div class="table-responsive">
          ${document.querySelector('.log-table-container .table-responsive')?.innerHTML || ''}
        </div>
      </body>
      </html>
    `;
    
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();
    
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 500);
  };

  // CSV Export with language support
  const csvHeaders = useMemo(() => {
    const headers = language === 'ar' 
      ? [
          { label: 'التوقيت', key: 'timestamp' },
          { label: 'الحدث', key: 'action' },
          { label: 'الجهاز', key: 'target_device' },
          { label: 'المستخدم', key: 'username' },
          { label: 'التفاصيل', key: '_detailsFull' },
          { label: 'عنوان IP', key: 'ip_address' }
        ]
      : [
          { label: 'Timestamp', key: 'timestamp' },
          { label: 'Event', key: 'action' },
          { label: 'Device', key: 'target_device' },
          { label: 'User', key: 'username' },
          { label: 'Details', key: '_detailsFull' },
          { label: 'IP Address', key: 'ip_address' }
        ];
    return headers;
  }, [language]);

  const csvData = useMemo(() => {
    return filteredLogs.map(log => ({
      ...log,
      action: formatEventType(log.action, language),
      timestamp: formatDateTime(log.timestamp)
    }));
  }, [filteredLogs, language]);

  const labels = language === 'ar' 
    ? {
        title: 'سجلات النشاط',
        clear30: 'مسح الأقدم من 30 يوم',
        exportCsv: 'تصدير CSV',
        print: 'طباعة',
        language: 'اللغة',
        arabic: 'عربي',
        english: 'English',
        filters: {
          from: 'من تاريخ',
          to: 'إلى تاريخ',
          user: 'المستخدم',
          device: 'الجهاز',
          action: 'نوع الحدث',
          transferType: 'نوع النقل (read/write)',
          transferSize: 'حجم النقل (bytes)'
        },
        table: {
          timestamp: 'التوقيت',
          event: 'الحدث',
          device: 'الجهاز',
          user: 'المستخدم',
          details: 'التفاصيل',
          transferType: 'نوع النقل',
          transferSize: 'حجم النقل',
          filename: 'اسم الملف',
          location: 'الموقع الجغرافي',
          ip: 'IP',
          actions: 'إجراءات'
        },
        noLogs: 'لا توجد سجلات للعرض'
      }
    : {
        title: 'Activity Logs',
        clear30: 'Clear older than 30 days',
        exportCsv: 'Export CSV',
        print: 'Print',
        language: 'Language',
        arabic: 'عربي',
        english: 'English',
        filters: {
          from: 'From Date',
          to: 'To Date',
          user: 'User',
          device: 'Device',
          action: 'Event Type',
          transferType: 'Transfer Type (read/write)',
          transferSize: 'Transfer Size (bytes)'
        },
        table: {
          timestamp: 'Timestamp',
          event: 'Event',
          device: 'Device',
          user: 'User',
          details: 'Details',
          transferType: 'Transfer Type',
          transferSize: 'Transfer Size',
          filename: 'Filename',
          location: 'Location',
          ip: 'IP',
          actions: 'Actions'
        },
        noLogs: 'No logs to display'
      };

  return (
    <div className="log-table-container">
      {!readOnly && (
        <div className="p-4 border-bottom bg-light bg-opacity-10 shadow-sm" style={{ backgroundColor: 'var(--bs-body-bg)' }}>
          <div className="d-flex flex-wrap align-items-center justify-content-between mb-3 gap-3">
            <h6 className="mb-0 fw-bold d-flex align-items-center">
              <i className="fas fa-filter text-primary me-2 fs-5" />
              {language === 'ar' ? 'أدوات التصفية والتحكم' : 'Filters & Controls'}
            </h6>
            <div className="d-flex gap-2 flex-wrap">
              <button className="btn btn-outline-danger btn-sm px-3 shadow-sm" onClick={handleClear} title={labels.clear30}>
                <i className="fas fa-trash-alt me-1" /> {labels.clear30}
              </button>
              <CSVLink 
                data={csvData} 
                headers={csvHeaders}
                filename={`logs_${new Date().toISOString().split('T')[0]}.csv`}
                className="btn btn-outline-success btn-sm px-3 shadow-sm"
              >
                <i className="fas fa-file-csv me-1" /> {labels.exportCsv}
              </CSVLink>
              <button className="btn btn-outline-primary btn-sm px-3 shadow-sm" onClick={handlePrint}>
                <i className="fas fa-print me-1" /> {labels.print}
              </button>
              <select 
                className="form-select form-select-sm shadow-sm" 
                style={{ width: '120px' }}
                value={language} 
                onChange={e => setLanguage(e.target.value)}
              >
                <option value="ar">{labels.arabic}</option>
                <option value="en">{labels.english}</option>
              </select>
            </div>
          </div>
          
          <div className="row g-3">
            <div className="col-12 col-sm-6 col-md-3 col-lg-2">
              <label className="form-label small text-muted mb-1">{labels.filters.from}</label>
              <input 
                type="date" 
                className="form-control form-control-sm shadow-sm" 
                value={filters.from} 
                onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} 
              />
            </div>
            <div className="col-12 col-sm-6 col-md-3 col-lg-2">
              <label className="form-label small text-muted mb-1">{labels.filters.to}</label>
              <input 
                type="date" 
                className="form-control form-control-sm shadow-sm" 
                value={filters.to} 
                onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} 
              />
            </div>
            <div className="col-12 col-sm-6 col-md-3 col-lg-2">
              <label className="form-label small text-muted mb-1">{labels.filters.user}</label>
              <div className="input-group input-group-sm shadow-sm">
                <span className="input-group-text bg-transparent"><i className="fas fa-user text-muted" /></span>
                <input 
                  type="text" 
                  className="form-control" 
                  value={filters.user} 
                  onChange={e => setFilters(f => ({ ...f, user: e.target.value }))} 
                  placeholder={labels.filters.user} 
                />
              </div>
            </div>
            <div className="col-12 col-sm-6 col-md-3 col-lg-2">
              <label className="form-label small text-muted mb-1">{labels.filters.device}</label>
              <div className="input-group input-group-sm shadow-sm">
                <span className="input-group-text bg-transparent"><i className="fas fa-laptop text-muted" /></span>
                <input 
                  type="text" 
                  className="form-control" 
                  value={filters.device} 
                  onChange={e => setFilters(f => ({ ...f, device: e.target.value }))} 
                  placeholder={labels.filters.device} 
                />
              </div>
            </div>
            <div className="col-12 col-sm-6 col-md-4 col-lg-2">
              <label className="form-label small text-muted mb-1">{labels.filters.action}</label>
              <div className="input-group input-group-sm shadow-sm">
                <span className="input-group-text bg-transparent"><i className="fas fa-bolt text-muted" /></span>
                <input 
                  type="text" 
                  className="form-control" 
                  value={filters.action} 
                  onChange={e => setFilters(f => ({ ...f, action: e.target.value }))} 
                  placeholder={labels.filters.action} 
                />
              </div>
            </div>
            <div className="col-12 col-sm-6 col-md-4 col-lg-2">
              <label className="form-label small text-muted mb-1">{labels.filters.transferType}</label>
              <div className="input-group input-group-sm shadow-sm">
                <span className="input-group-text bg-transparent"><i className="fas fa-exchange-alt text-muted" /></span>
                <select 
                  className="form-select" 
                  value={filters.transfer_type || ''} 
                  onChange={e => setFilters(f => ({ ...f, transfer_type: e.target.value }))}
                >
                  <option value="">{language === 'ar' ? 'الكل' : 'All'}</option>
                  <option value="read">{language === 'ar' ? 'قراءة (Read)' : 'Read'}</option>
                  <option value="write">{language === 'ar' ? 'كتابة (Write)' : 'Write'}</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* رسم بياني للإحصائيات */}
      <LogChart eventStats={eventStats} language={language} />

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorAlert message={error} />
      ) : filteredLogs.length === 0 ? (
        <div className="text-center py-4 text-muted">
          <i className="fas fa-inbox fa-3x mb-3 opacity-50"></i>
          <div>{labels.noLogs}</div>
        </div>
      ) : (
        <Fragment>
          <div className="table-responsive" style={{ maxHeight: '600px', overflowY: 'auto' }}>
            <table className="table table-hover table-bordered mb-0 align-middle">
              <thead className="table-dark sticky-top shadow-sm" style={{ zIndex: 1 }}>
                <tr className="text-center text-nowrap">
                  <th className="fw-semibold py-3">{labels.table.timestamp}</th>
                  <th className="fw-semibold py-3">{labels.table.event}</th>
                  <th className="fw-semibold py-3">{labels.table.device}</th>
                  <th className="fw-semibold py-3">{labels.table.user}</th>
                  <th className="fw-semibold py-3">{labels.table.details}</th>
                  <th className="fw-semibold py-3">{labels.table.location}</th>
                  <th className="fw-semibold py-3">{labels.table.ip}</th>
                  {!readOnly && <th className="fw-semibold py-3 no-print">{labels.table.actions}</th>}
                </tr>
              </thead>
              <tbody className="text-center">
                {filteredLogs.map(log => (
                  <LogRow key={log.id} log={log} readOnly={readOnly} language={language} />
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="mt-3 text-muted small text-center">
            {language === 'ar' 
              ? `عرض ${filteredLogs.length} من ${logs.length} سجل`
              : `Showing ${filteredLogs.length} of ${logs.length} logs`
            }
          </div>
        </Fragment>
      )}
    </div>
  );
};
LogTable.displayName = 'LogTable';
LogTable.propTypes = { readOnly: PropTypes.bool };

export default LogTable;

