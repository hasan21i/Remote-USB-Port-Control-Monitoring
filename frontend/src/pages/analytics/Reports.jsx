// src/pages/analytics/Reports.jsx

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  fetchGeneratedReports, 
  fetchReportHistory, 
  generateReportInstance, 
  fetchReportContent, 
  exportReport, 
  deleteReportDefinition,
  bulkDeleteReports,
  resetDownloadCount,
  resetAllDownloadCounts
} from '../../utils/api';
import { formatDateTime, formatNumber } from '../../utils/formatters';
import Modal from '../../components/Modal';

// ─── Report Content Parser & Renderer ────────────────────────────────────────

function parseReportToSections(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const sections = [];
  let pendingHeadings = [];
  let currentRows = [];

  const flush = () => {
    if (pendingHeadings.length > 0 || currentRows.length > 0) {
      sections.push({ headings: [...pendingHeadings], rows: [...currentRows] });
    }
    pendingHeadings = [];
    currentRows = [];
  };

  for (const line of lines) {
    // List items (bullet / numbered) → treat as value rows
    const listMatch = line.match(/^[-•*]\s+(.+)$/) || line.match(/^\d+\.\s+(.+)$/);
    if (listMatch) {
      currentRows.push({ key: '•', value: listMatch[1].replace(/\*\*/g, '') });
      continue;
    }

    const colonIdx = line.indexOf(': ');
    if (colonIdx > 0 && colonIdx < line.length - 2) {
      // Key: Value line
      currentRows.push({
        key: line.substring(0, colonIdx).replace(/\*\*/g, '').trim(),
        value: line.substring(colonIdx + 2).replace(/\*\*/g, '').trim()
      });
    } else {
      // Heading line — flush previous table
      if (currentRows.length > 0) flush();
      // Remove markdown heading markers, bold markers, emoji
      const cleaned = line
        .replace(/^#{1,6}\s+/, '')
        .replace(/\*\*/g, '')
        .replace(/[📊📈🚨🤖🔗🖥️🔥📱⚠️✅❌]/gu, '')
        .trim();
      if (cleaned) pendingHeadings.push(cleaned);
    }
  }
  flush();
  return sections;
}

function getSectionMeta(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('device'))      return { icon: 'fa-desktop',     color: 'var(--primary-color)', bg: 'rgba(13,110,253,0.12)' };
  if (t.includes('user'))        return { icon: 'fa-users',       color: 'var(--success-color)', bg: 'rgba(25,135,84,0.12)' };
  if (t.includes('log'))         return { icon: 'fa-list-alt',    color: '#fd7e14', bg: 'rgba(253,126,20,0.12)' };
  if (t.includes('alert'))       return { icon: 'fa-bell',        color: 'var(--danger-color)', bg: 'rgba(220,53,69,0.12)' };
  if (t.includes('security'))    return { icon: 'fa-shield-alt',  color: 'var(--danger-color)', bg: 'rgba(220,53,69,0.12)' };
  if (t.includes('blockchain'))  return { icon: 'fa-link',        color: '#6f42c1', bg: 'rgba(111,66,193,0.12)' };
  if (t.includes('ai') || t.includes('artificial') || t.includes('intelligence'))
                                 return { icon: 'fa-brain',       color: 'var(--secondary-color)', bg: 'rgba(32,201,151,0.12)' };
  if (t.includes('activity') || t.includes('monitoring'))
                                 return { icon: 'fa-chart-bar',   color: 'var(--warning-color)', bg: 'rgba(255,193,7,0.12)' };
  if (t.includes('server'))      return { icon: 'fa-server',      color: 'var(--text-secondary)', bg: 'rgba(108,117,125,0.12)' };
  if (t.includes('report'))      return { icon: 'fa-file-alt',    color: 'var(--text-secondary)', bg: 'rgba(108,117,125,0.12)' };
  if (t.includes('system') || t.includes('overview'))
                                 return { icon: 'fa-chart-line',  color: 'var(--primary-color)', bg: 'rgba(13,110,253,0.12)' };
  if (t.includes('connection') || t.includes('network'))
                                 return { icon: 'fa-wifi',        color: '#0dcaf0', bg: 'rgba(13,202,240,0.12)' };
  return { icon: 'fa-circle',    color: 'var(--text-secondary)', bg: 'rgba(108,117,125,0.12)' };
}

function formatReportValue(value) {
  if (value === null || value === undefined || value === '' || value === 'N/A' || value === '-') {
    return <span className="text-muted fst-italic">N/A</span>;
  }
  const str = String(value);
  // Percentage
  const pctMatch = str.match(/^([\d.]+)%$/);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    const color = pct >= 80 ? 'var(--success-color)' : pct >= 50 ? 'var(--warning-color)' : 'var(--danger-color)';
    const bg    = pct >= 80 ? 'rgba(25,135,84,0.12)' : pct >= 50 ? 'rgba(255,193,7,0.12)' : 'rgba(220,53,69,0.12)';
    return (
      <span className="badge px-3 py-2 fw-semibold" style={{ backgroundColor: bg, color, fontSize: '13px' }}>
        {str}
      </span>
    );
  }
  // Number + units (e.g. "4 devices", "532 logs")
  const numMatch = str.match(/^([\d,]+)\s+(.+)$/);
  if (numMatch) {
    return (
      <span>
        <strong style={{ fontSize: '15px' }}>{numMatch[1]}</strong>
        <span className="text-muted ms-1" style={{ fontSize: '13px' }}>{numMatch[2]}</span>
      </span>
    );
  }
  // Date string
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return <span className="font-monospace" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{str}</span>;
  }
  return <span>{str}</span>;
}

// eslint-disable-next-line react/prop-types
function ReportContentRenderer({ content, isDarkMode }) {
  const sections = parseReportToSections(content);
  const cardBg   = isDarkMode ? '#2d2d2d' : 'var(--white)';
  const headerBg = isDarkMode ? 'var(--dark-gray)' : 'var(--light)';
  const textColor = isDarkMode ? 'var(--white)' : '#1a1a1a';
  const mutedColor = isDarkMode ? 'var(--gray)' : 'var(--gray)';
  const borderColor = isDarkMode ? 'var(--dark-gray)' : '#var(--mid)';
  const stripeBg = isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';

  if (!sections.length) {
    return <p className="text-muted text-center py-4">لا يوجد محتوى للتقرير</p>;
  }

  return (
    <div style={{ direction: 'ltr', textAlign: 'left' }}>
      {sections.map((section, idx) => {
        const mainTitle = section.headings[section.headings.length - 1] || '';
        const categoryBadges = section.headings.slice(0, -1);
        const meta = getSectionMeta(mainTitle || categoryBadges[categoryBadges.length - 1] || '');

        // Pure heading with no data rows → separator divider
        if (section.rows.length === 0) {
          return (
            <div key={idx} className="d-flex align-items-center my-4">
              <div style={{ flex: 1, height: '1px', backgroundColor: borderColor }} />
              <span className="px-3 fw-bold" style={{ color: meta.color, fontSize: '13px', whiteSpace: 'nowrap' }}>
                <i className={`fas ${meta.icon} me-2`} />
                {mainTitle}
              </span>
              <div style={{ flex: 1, height: '1px', backgroundColor: borderColor }} />
            </div>
          );
        }

        return (
          <div key={idx} className="mb-4">
            {/* Category breadcrumb badges */}
            {categoryBadges.length > 0 && (
              <div className="mb-2 d-flex flex-wrap gap-1">
                {categoryBadges.map((h, i) => (
                  <span key={i} className="badge rounded-pill px-3 py-1"
                    style={{ backgroundColor: meta.bg, color: meta.color, fontSize: '11px', fontWeight: '600' }}>
                    {h}
                  </span>
                ))}
              </div>
            )}

            <div className="card border-0 shadow-sm overflow-hidden" style={{ backgroundColor: cardBg }}>
              {/* Card header */}
              {mainTitle && (
                <div className="card-header py-3 px-4"
                  style={{ backgroundColor: headerBg, borderBottom: `2px solid ${meta.color}30`, border: 'none' }}>
                  <h6 className="mb-0 fw-bold d-flex align-items-center gap-2" style={{ color: meta.color }}>
                    <span className="rounded-circle d-inline-flex align-items-center justify-content-center"
                      style={{ width: 28, height: 28, backgroundColor: meta.bg }}>
                      <i className={`fas ${meta.icon}`} style={{ fontSize: '13px' }} />
                    </span>
                    {mainTitle}
                  </h6>
                </div>
              )}

              {/* Data rows as a clean table */}
              <div className="card-body p-0">
                <table className="table table-borderless mb-0 align-middle">
                  <tbody>
                    {section.rows.map((row, ri) => (
                      row.key === '•' ? (
                        <tr key={ri} style={{ backgroundColor: ri % 2 !== 0 ? stripeBg : 'transparent' }}>
                          <td colSpan={2} className="py-2 px-4"
                            style={{ color: textColor, fontSize: '13.5px',
                              borderBottom: `1px solid ${borderColor}` }}>
                            <span style={{ color: mutedColor, marginRight: 8 }}>•</span>
                            {row.value}
                          </td>
                        </tr>
                      ) : (
                        <tr key={ri} style={{ backgroundColor: ri % 2 !== 0 ? stripeBg : 'transparent' }}>
                          <td className="py-2 px-4"
                            style={{ color: mutedColor, width: '50%', fontWeight: '500', fontSize: '13.5px',
                              borderBottom: `1px solid ${borderColor}` }}>
                            {row.key}
                          </td>
                          <td className="py-2 px-4"
                            style={{ color: textColor, fontWeight: '600', fontSize: '14px',
                              borderBottom: `1px solid ${borderColor}` }}>
                            {formatReportValue(row.value)}
                          </td>
                        </tr>
                      )
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Constants
const LANGUAGES = [
  { value: 'ar', label: 'العربية', flag: '🇸🇦' },
  { value: 'en', label: 'English', flag: '🇺🇸' }
];

const REPORT_FORMATS = [
  { value: 'pdf', label: 'PDF', icon: 'fa-file-pdf' },
  { value: 'html', label: 'HTML', icon: 'fa-file-code' },
  { value: 'txt', label: 'Text', icon: 'fa-file-alt' }
];


const Reports = () => {
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
  const [success, setSuccess] = useState('');
  const [reports, setReports] = useState([]);
  const [stats, setStats] = useState(null);
  const [modalGenerateVisible, setModalGenerateVisible] = useState(false);
  const [modalViewVisible, setModalViewVisible] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [reportContent, setReportContent] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [currentLanguage] = useState('ar');
  
  // Delete states
  const [selectedReports, setSelectedReports] = useState([]);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [reportToDelete, setReportToDelete] = useState(null);
  
  // Form states
  const [form, setForm] = useState({
    type: 'system_overview',
    language: 'en', // Always use English
    format: REPORT_FORMATS[0].value,
    includeCharts: true,
    name: ''
  });

  const [creating, setCreating] = useState(false);

  // Load data - Memoized to prevent unnecessary re-renders
  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    
    try {
      const [reportsRes, statsRes] = await Promise.all([
        fetchGeneratedReports().catch(() => []),
        fetchReportHistory().catch(() => {})
      ]);
      
      setReports(Array.isArray(reportsRes) ? reportsRes : []);
      setStats(statsRes || {});
    } catch (err) {
      // console.error('Error loading reports:', err);
      setError('فشل في جلب البيانات');
      setReports([]);
      setStats({});
    } finally {
      setLoading(false);
    }
  }, []); // Empty dependency array to prevent re-creation

  // تم حذف loadStats لأنه غير مستخدم

  useEffect(() => {
    // Load data only once on component mount
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array

  // Handle form changes - Fixed to prevent re-rendering issues
  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    setForm(prevForm => ({ 
      ...prevForm, 
      [name]: type === 'checkbox' ? checked : value 
    }));
  }, []);

  // Generate report
  const handleGenerate = useCallback(async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!form.name.trim()) {
      setError('اسم التقرير مطلوب');
      return;
    }

    setCreating(true);
    try {
      await generateReportInstance({
        type: 'system_overview', // Always use system overview for comprehensive report
        language: 'en', // Always use English
        format: form.format,
        include_charts: form.includeCharts,
        name: form.name
      });
      
      setSuccess('تم إنشاء التقرير بنجاح');
      
      // Reset form first
      setForm({
        type: 'system_overview',
        language: 'en', // Always use English
        format: REPORT_FORMATS[0].value,
        includeCharts: true,
        name: ''
      });
      
      // Close modal
      setModalGenerateVisible(false);
      
      // Reload data after a short delay
      setTimeout(() => {
        loadData();
      }, 100);
      
    } catch (err) {
      // console.error('Error generating report:', err);
      setError(err.message || 'فشل في إنشاء التقرير');
    } finally {
      setCreating(false);
    }
  }, [form, loadData]);

  // Delete single report
  const handleDeleteSingle = useCallback(async (report) => {
    setReportToDelete(report);
    setDeleteConfirmVisible(true);
  }, []);

  // Confirm single delete
  const confirmDelete = useCallback(async () => {
    if (!reportToDelete) return;
    
    setDeleting(true);
    setError('');
    setSuccess('');
    try {
      await deleteReportDefinition(reportToDelete.id);
      
      setSuccess('تم حذف التقرير بنجاح');
      
      // Remove from local state
      setReports(prev => prev.filter(r => r.id !== reportToDelete.id));
      setSelectedReports(prev => prev.filter(id => id !== reportToDelete.id));
      
      // Reload data after a short delay
      setTimeout(() => {
        loadData();
      }, 100);
      
    } catch (err) {
      // console.error('Error deleting report:', err);
      setError(err.message || 'فشل في حذف التقرير');
    } finally {
      setDeleting(false);
      setDeleteConfirmVisible(false);
      setReportToDelete(null);
    }
  }, [reportToDelete, loadData]);

  // Bulk delete reports
  const handleBulkDelete = useCallback(async () => {
    if (selectedReports.length === 0) {
      setError('يرجى تحديد تقارير للحذف');
      return;
    }
    
    if (!window.confirm(`هل أنت متأكد من حذف ${selectedReports.length} تقرير؟`)) {
      return;
    }
    
    setDeleting(true);
    setError('');
    setSuccess('');
    try {
      await bulkDeleteReports(selectedReports);
      
      setSuccess(`تم حذف ${selectedReports.length} تقرير بنجاح`);
      
      // Remove from local state
      setReports(prev => prev.filter(r => !selectedReports.includes(r.id)));
      setSelectedReports([]);
      
      // Reload data after a short delay
      setTimeout(() => {
        loadData();
      }, 100);
      
    } catch (err) {
      // console.error('Error bulk deleting reports:', err);
      setError(err.message || 'فشل في حذف التقارير');
    } finally {
      setDeleting(false);
    }
  }, [selectedReports, loadData]);

  // Reset download count for a single report
  const handleResetDownloadCount = useCallback(async (reportId) => {
    if (!window.confirm('هل أنت متأكد من إعادة تعيين عداد التحميلات لهذا التقرير؟')) {
      return;
    }
    
    setDeleting(true);
    setError('');
    setSuccess('');
    try {
      const result = await resetDownloadCount(reportId);
      setSuccess(result.message || 'تم إعادة تعيين عداد التحميلات بنجاح');
      loadData();
    } catch (err) {
      // console.error('Reset download count error:', err);
      const errorMessage = err.response?.data?.error || err.message || 'فشل في إعادة تعيين عداد التحميلات';
      setError(errorMessage);
    } finally {
      setDeleting(false);
    }
  }, [loadData]);

  // Reset download count for all reports
  const handleResetAllDownloadCounts = useCallback(async () => {
    if (!window.confirm('هل أنت متأكد من إعادة تعيين عداد التحميلات لجميع التقارير؟')) {
      return;
    }
    
    setDeleting(true);
    setError('');
    setSuccess('');
    try {
      const result = await resetAllDownloadCounts();
      setSuccess(result.message || 'تم إعادة تعيين عداد التحميلات لجميع التقارير بنجاح');
      loadData();
    } catch (err) {
      // console.error('Reset all download counts error:', err);
      const errorMessage = err.response?.data?.error || err.message || 'فشل في إعادة تعيين عداد التحميلات';
      setError(errorMessage);
    } finally {
      setDeleting(false);
    }
  }, [loadData]);

  // Toggle report selection
  const toggleReportSelection = useCallback((reportId) => {
    setSelectedReports(prev => 
      prev.includes(reportId) 
        ? prev.filter(id => id !== reportId)
        : [...prev, reportId]
    );
  }, []);

  // Select all reports
  const selectAllReports = useCallback((checked) => {
    if (checked) {
      setSelectedReports(reports.map(r => r.id));
    } else {
      setSelectedReports([]);
    }
  }, [reports]);

  // View report
  const handleView = useCallback(async (report) => {
    setSelectedReport(report);
    setModalViewVisible(true);
    setLoadingContent(true);
    try {
      const content = await fetchReportContent(report.id);
      setReportContent(content || 'لا يوجد محتوى للتقرير');
    } catch (err) {
      // console.error('Error fetching report content:', err);
      setReportContent('فشل في جلب محتوى التقرير');
    } finally {
      setLoadingContent(false);
    }
  }, []); // Empty dependency array

  // Download report
  const handleDownload = useCallback(async (report, format = 'pdf') => {
    try {
      // التحقق من وجود التقرير
      if (!report || !report.id) {
        setError('التقرير غير صالح');
        return;
      }
      
      // التحقق من وجود token
      const token = localStorage.getItem('access_token');
      if (!token) {
        setError('يجب تسجيل الدخول أولاً');
        return;
      }
      
      // التحقق من وجود محتوى للتقرير أولاً
      if (!report.content && report.id) {
        try {
          const content = await fetchReportContent(report.id);
          if (!content || content === 'لا يوجد محتوى للتقرير') {
            setError('لا يوجد محتوى للتقرير للتحميل');
            return;
          }
        } catch (contentErr) {
          setError('فشل في جلب محتوى التقرير');
          return;
        }
      }
      
      const blob = await exportReport(report.id, format);
      
      // التحقق من أن الـ blob صالح
      if (!blob || blob.size === 0) {
        setError('The generated file is empty');
        return;
      }
      
      // طباعة معلومات الـ blob للتشخيص (معلق للتطوير)
      // console.log('Blob type:', blob.type);
      // console.log('Blob size:', blob.size);
      
      // التحقق من أن الملف كبير بما يكفي
      if (blob.size < 100) {
        setError('Generated file is too small - may be corrupted');
        return;
      }
      
      // إنشاء blob جديد مع نوع MIME صحيح
      const pdfBlob = new Blob([blob], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.name || 'system_report'}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      // إظهار رسالة نجاح
      setError(null);
      // يمكن إضافة toast notification هنا
    } catch (err) {
      // console.error('Error downloading report:', err);
      if (err.response?.status === 401) {
        setError('Session expired - please login again');
      } else if (err.response?.status === 403) {
        setError('You do not have permission to download this report');
      } else if (err.response?.status === 404) {
        setError('Report not found');
      } else if (err.response?.status === 500) {
        setError('Server error while generating file');
      } else if (err.message?.includes('Network Error')) {
        setError('Network error - make sure server is running on port 5000');
      } else if (err.message?.includes('timeout')) {
        setError('Request timeout - try again');
      } else if (err.message?.includes('Empty blob')) {
        setError('Generated file is empty - check report content');
      } else if (err.response?.data?.error) {
        setError(err.response.data.error);
      } else if (err.response?.status === 0) {
        setError('Failed to connect to server - make sure server is running');
      } else if (err.response?.status === 404) {
        setError('Report not found or export endpoint not available');
      } else if (err.response?.status === 500) {
        setError('Server error - check server logs for details');
      } else {
        setError(`Failed to download report: ${err.message || 'Unknown error'}`);
      }
    }
  }, []); // Empty dependency array

  // Print report
  const handlePrint = useCallback(async (report) => {
    try {
      // جلب محتوى التقرير أولاً
      const content = await fetchReportContent(report.id);
      
      const printWindow = window.open('', '_blank');
      printWindow.document.write(`
        <html>
          <head>
            <title>${report.name || 'Report'}</title>
            <style>
              body { 
                font-family: Arial, Tahoma, sans-serif; 
                margin: 20px; 
                direction: rtl; 
                text-align: right;
                line-height: 1.6;
              }
              .header { 
                text-align: center; 
                margin-bottom: 30px; 
                border-bottom: 2px solid #333;
                padding-bottom: 10px;
              }
              .content { 
                line-height: 1.6; 
                font-size: 14px;
              }
              pre {
                white-space: pre-wrap; 
                word-wrap: break-word;
                font-family: Arial, Tahoma, sans-serif;
                direction: rtl;
                text-align: right;
                margin: 0;
                padding: 10px;
                background-color: #f9f9f9;
                border-radius: 5px;
              }
              @media print {
                body { font-size: 12px; }
                .header h1 { font-size: 18px; }
                pre { background-color: white; }
              }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>${report.name || 'تقرير شامل عن النظام'}</h1>
              <p>تاريخ الإنشاء: ${new Date().toLocaleDateString('ar-SA')}</p>
            </div>
            <div class="content">
              <pre>${content || 'لا يوجد محتوى للتقرير'}</pre>
            </div>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    } catch (err) {
      // console.error('Error printing report:', err);
      setError('فشل في طباعة التقرير');
    }
  }, []); // Empty dependency array

  // Share report
  const handleShare = useCallback(async (report) => {
    try {
      // جلب محتوى التقرير أولاً
      const content = await fetchReportContent(report.id);
      const contentPreview = content ? content.substring(0, 100) + '...' : 'لا يوجد محتوى للتقرير';
      
      if (navigator.share) {
        await navigator.share({
          title: report.name || 'تقرير شامل عن النظام',
          text: `${report.name || 'تقرير شامل عن النظام'}\n\n${contentPreview}\n\nتاريخ الإنشاء: ${new Date().toLocaleDateString('ar-SA')}`,
          url: window.location.href
        });
      } else {
        // Fallback: copy to clipboard
        const text = `${report.name || 'تقرير شامل عن النظام'}\n\n${contentPreview}\n\n${window.location.href}`;
        await navigator.clipboard.writeText(text);
        alert('تم نسخ رابط التقرير إلى الحافظة');
      }
    } catch (err) {
      // console.error('Error sharing report:', err);
      setError('فشل في مشاركة التقرير');
    }
  }, []); // Empty dependency array

  // احذف دالة getReportTypeInfo بالكامل

  // Get current language labels - Memoized to prevent re-renders
  const getCurrentLabels = useCallback(() => {
    return currentLanguage === 'en' ? {
      title: 'Reports System',
      subtitle: 'Create and manage comprehensive system reports',
      createReport: 'Create Report',
      generateReport: 'Generate Report',
      reportName: 'Report Name',
      reportType: 'Report Type',
      language: 'Language',
      format: 'Format',
      includeCharts: 'Include Charts',
      cancel: 'Cancel',
      loading: 'Loading...',
      noReports: 'No reports generated',
      startCreating: 'Start creating a new report to display here',
      actions: 'Actions',
      view: 'View',
      download: 'Download',
      print: 'Print',
      share: 'Share',
      delete: 'Delete',
      totalReports: 'Total Reports',
      scheduledReports: 'Scheduled Reports',
      downloads: 'Downloads',
      thisMonth: 'This Month'
    } : {
      title: 'نظام التقارير',
      subtitle: 'إنشاء وإدارة التقارير الشاملة للنظام',
      createReport: 'إنشاء تقرير',
      generateReport: 'إنشاء التقرير',
      reportName: 'اسم التقرير',
      reportType: 'نوع التقرير',
      language: 'اللغة',
      format: 'التنسيق',
      includeCharts: 'تضمين الرسوم البيانية',
      cancel: 'إلغاء',
      loading: 'جاري التحميل...',
      noReports: 'لا توجد تقارير مولدة',
      startCreating: 'ابدأ بإنشاء تقرير جديد لعرضه هنا',
      actions: 'الإجراءات',
      view: 'عرض',
      download: 'تحميل',
      print: 'طباعة',
      share: 'مشاركة',
      delete: 'حذف',
      totalReports: 'إجمالي التقارير',
      scheduledReports: 'تقارير مجدولة',
      downloads: 'التحميلات',
      thisMonth: 'هذا الشهر'
    };
  }, [currentLanguage]);

  const labels = getCurrentLabels();

  if (loading) {
    return (
              <div className="text-center py-5" style={{ backgroundColor: themeStyles.background, minHeight: '100vh', color: themeStyles.textColor }}>
          <div className="spinner-border text-primary mb-3" role="status" style={{ width: '3rem', height: '3rem' }}>
            <span className="visually-hidden">{labels.loading}</span>
          </div>
          <h4>{labels.loading}</h4>
          <p style={{ color: themeStyles.mutedColor }}>يرجى الانتظار بينما نجمع البيانات</p>
        </div>
    );
  }

      return (
      <div className="reports-page" style={{ backgroundColor: themeStyles.background, minHeight: '100vh', color: themeStyles.textColor }}>
      <div className="container-fluid py-4">
        
        {/* Hero Header */}
        <div className="row mb-4">
          <div className="col-12">
            <div className="card border-0 shadow-lg" style={{ 
              background: isDarkMode 
                ? 'linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%)' 
                : 'linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%)', 
              color: 'white' 
            }}>
              <div className="card-body py-4">
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
                  <div>
                    <h1 className="h2 mb-2 fw-bold d-flex align-items-center">
                      <i className="fas fa-file-alt me-3" style={{ fontSize: '32px' }}></i>
                      نظام التقارير الشاملة
                    </h1>
                    <p className="mb-0 opacity-90" style={{ fontSize: '1.1rem' }}>
                      <i className="fas fa-chart-line me-2"></i>
                      إنشاء وإدارة التقارير الشاملة عن النظام
                    </p>
                  </div>
                  <div className="d-flex gap-2 flex-wrap">
                    <button 
                      className="btn btn-light btn-lg shadow-sm"
                      onClick={() => setModalGenerateVisible(true)}
                    >
                      <i className="fas fa-plus me-2"></i>
                      إنشاء تقرير شامل
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Statistics Cards */}
        {stats && (
          <div className="d-flex flex-wrap justify-content-center gap-3 mb-4">
            <div className="flex-shrink-0">
              <div className="card border-0 shadow-sm" style={{
                background: isDarkMode
                  ? 'linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)'
                  : 'linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)',
                borderRadius: '1.5rem',
                minWidth: 170,
                minHeight: 145,
                maxWidth: 210,
                margin: '0.3rem 0.4rem'
              }}>
                <div className="card-body p-4 d-flex flex-column justify-content-between text-center">
                  <div className="d-flex justify-content-center align-items-center mb-3">
                    <div className="rounded-circle p-2" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                      <i className="fas fa-file-alt" style={{ fontSize: '18px', color: 'white' }}></i>
                    </div>
                  </div>
                  <p className="mb-2" style={{ color: 'rgba(255,255,255,0.9)', fontSize: '14px', fontWeight: '500' }}>
                    إجمالي التقارير
                  </p>
                  <h2 className="fw-bold mb-0" style={{ color: 'white', fontSize: '32px' }}>
                    {formatNumber(stats.total_reports || 0)}
                  </h2>
                </div>
              </div>
            </div>
            <div className="flex-shrink-0">
              <div className="card border-0 shadow-sm" style={{
                background: isDarkMode
                  ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                  : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                borderRadius: '1.5rem',
                minWidth: 170,
                minHeight: 145,
                maxWidth: 210,
                margin: '0.3rem 0.4rem'
              }}>
                <div className="card-body p-4 d-flex flex-column justify-content-between text-center">
                  <div className="d-flex justify-content-center align-items-center mb-3">
                    <div className="rounded-circle p-2" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                      <i className="fas fa-check-circle" style={{ fontSize: '18px', color: 'white' }}></i>
                    </div>
                  </div>
                  <p className="mb-2" style={{ color: 'rgba(255,255,255,0.9)', fontSize: '14px', fontWeight: '500' }}>
                    التقارير المكتملة
                  </p>
                  <h2 className="fw-bold mb-0" style={{ color: 'white', fontSize: '32px' }}>
                    {formatNumber(stats.completed_reports || 0)}
                  </h2>
                </div>
              </div>
            </div>
            <div className="flex-shrink-0">
              <div className="card border-0 shadow-sm" style={{
                background: isDarkMode
                  ? 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)'
                  : 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
                borderRadius: '1.5rem',
                minWidth: 170,
                minHeight: 145,
                maxWidth: 210,
                margin: '0.3rem 0.4rem'
              }}>
                <div className="card-body p-4 d-flex flex-column justify-content-between text-center">
                  <div className="d-flex justify-content-center align-items-center mb-3">
                    <div className="rounded-circle p-2" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                      <i className="fas fa-download" style={{ fontSize: '18px', color: 'white' }}></i>
                    </div>
                  </div>
                  <p className="mb-2" style={{ color: 'rgba(255,255,255,0.9)', fontSize: '14px', fontWeight: '500' }}>
                    إجمالي التحميلات
                  </p>
                  <h2 className="fw-bold mb-0" style={{ color: 'white', fontSize: '32px' }}>
                    {formatNumber(stats.total_downloads || 0)}
                  </h2>
                </div>
              </div>
            </div>
            <div className="flex-shrink-0">
              <div className="card border-0 shadow-sm" style={{
                background: isDarkMode
                  ? 'linear-gradient(135deg, #00c6fb 0%, #005bea 100%)'
                  : 'linear-gradient(135deg, #00c6fb 0%, #005bea 100%)',
                borderRadius: '1.5rem',
                minWidth: 170,
                minHeight: 145,
                maxWidth: 210,
                margin: '0.3rem 0.4rem'
              }}>
                <div className="card-body p-4 d-flex flex-column justify-content-between text-center">
                  <div className="d-flex justify-content-center align-items-center mb-3">
                    <div className="rounded-circle p-2" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                      <i className="fas fa-calendar-alt" style={{ fontSize: '18px', color: 'white' }}></i>
                    </div>
                  </div>
                  <p className="mb-2" style={{ color: 'rgba(255,255,255,0.9)', fontSize: '14px', fontWeight: '500' }}>
                    هذا الشهر
                  </p>
                  <h2 className="fw-bold mb-0" style={{ color: 'white', fontSize: '32px' }}>
                    {formatNumber(stats.this_month || 0)}
                  </h2>
                </div>
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

        {/* Success Alert */}
        {success && (
          <div className="row mb-4">
            <div className="col-12">
              <div className="alert alert-success alert-dismissible fade show shadow-sm" role="alert">
                <i className="fas fa-check-circle me-2"></i>
                {success}
                <button type="button" className="btn-close" onClick={() => setSuccess('')}></button>
              </div>
            </div>
          </div>
        )}

        {/* Reports Table */}
        <div className="row">
          <div className="col-12">
            <div className="card border-0 shadow-sm" style={{ backgroundColor: themeStyles.cardBg }}>
              <div className="card-header border-0 py-3" style={{ backgroundColor: themeStyles.cardBg }}>
                <div className="d-flex justify-content-between align-items-center">
                  <h5 className="mb-0 fw-bold" style={{ color: themeStyles.textColor }}>
                    <i className="fas fa-table me-2"></i>
                    التقارير الشاملة المولدة ({formatNumber(Array.isArray(reports) ? reports.length : 0)})
                  </h5>
                  <div className="d-flex align-items-center gap-3">
                    {loading && (
                      <div className="spinner-border spinner-border-sm text-primary" role="status">
                        <span className="visually-hidden">{labels.loading}</span>
                      </div>
                    )}
                    <button 
                      className="btn btn-outline-primary btn-sm"
                      onClick={loadData}
                      disabled={loading}
                    >
                      <i className="fas fa-sync-alt me-1"></i>
                      {currentLanguage === 'en' ? 'Refresh' : 'تحديث'}
                    </button>
                    <button 
                      className="btn btn-outline-warning btn-sm"
                      onClick={handleResetAllDownloadCounts}
                      disabled={deleting}
                      title="مسح جميع عدادات التحميلات"
                    >
                      {deleting ? (
                        <>
                          <i className="fas fa-spinner fa-spin me-1"></i>
                          جارٍ...
                        </>
                      ) : (
                        <>
                          <i className="fas fa-undo me-1"></i>
                          مسح العدادات
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <div className="card-body p-0" style={{ backgroundColor: themeStyles.cardBg }}>
                {(!reports || reports.length === 0) ? (
                  <div className="text-center py-5">
                    <i className="fas fa-file-alt mb-3" style={{ fontSize: '48px', color: themeStyles.mutedColor }}></i>
                    <h6 style={{ color: themeStyles.textColor }}>لا توجد تقارير شاملة مولدة</h6>
                    <p style={{ color: themeStyles.mutedColor }}>ابدأ بإنشاء تقرير شامل جديد لعرضه هنا</p>
                  </div>
                ) : (
                  <>
                    {/* شريط أدوات الحذف الجماعي */}
                    {selectedReports.length > 0 && (
                      <div className="p-3 border-bottom" style={{ backgroundColor: themeStyles.cardBg, borderColor: themeStyles.borderColor }}>
                        <div className="d-flex justify-content-between align-items-center">
                          <span style={{ color: themeStyles.textColor }}>
                            <i className="fas fa-check-square me-1"></i>
                            تم تحديد {selectedReports.length} تقرير
                          </span>
                          <div className="d-flex gap-2">
                            <button
                              className="btn btn-outline-secondary btn-sm"
                              onClick={() => setSelectedReports([])}
                              disabled={deleting}
                            >
                              <i className="fas fa-times me-1"></i>
                              إلغاء التحديد
                            </button>
                            <button
                              className="btn btn-outline-danger btn-sm"
                              onClick={handleBulkDelete}
                              disabled={deleting}
                            >
                              {deleting ? (
                                <>
                                  <i className="fas fa-spinner fa-spin me-1"></i>
                                  جارٍ الحذف...
                                </>
                              ) : (
                                <>
                                  <i className="fas fa-trash me-1"></i>
                                  حذف المحدد
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="table-responsive">
                    <table className="table table-hover mb-0">
                      <thead style={{ backgroundColor: isDarkMode ? 'var(--dark-gray)' : 'var(--light)' }}>
                        <tr>
                          <th style={{ color: themeStyles.textColor, border: 'none', width: '40px' }}>
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={selectedReports.length === reports.length && reports.length > 0}
                              onChange={(e) => selectAllReports(e.target.checked)}
                            />
                          </th>
                          <th style={{ color: themeStyles.textColor, border: 'none' }}>
                            <i className="fas fa-file-alt me-1"></i>
                            اسم التقرير
                          </th>
                          <th style={{ color: themeStyles.textColor, border: 'none' }}>
                            <i className="fas fa-tag me-1"></i>
                            النوع
                          </th>
                          <th style={{ color: themeStyles.textColor, border: 'none' }}>
                            <i className="fas fa-language me-1"></i>
                            اللغة
                          </th>
                          <th style={{ color: themeStyles.textColor, border: 'none' }}>
                            <i className="fas fa-calendar me-1"></i>
                            تاريخ الإنشاء
                          </th>
                          <th style={{ color: themeStyles.textColor, border: 'none' }}>
                            <i className="fas fa-weight me-1"></i>
                            الحجم
                          </th>
                          <th style={{ color: themeStyles.textColor, border: 'none' }}>
                            <i className="fas fa-download me-1"></i>
                            التحميلات
                          </th>
                          <th style={{ color: themeStyles.textColor, border: 'none' }}>
                            <i className="fas fa-cogs me-1"></i>
                            الإجراءات
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.isArray(reports) && reports.map((report, i) => {
                          // تم حذف typeInfo لأنه غير مستخدم
                          return (
                            <tr key={report.id || i} style={{ backgroundColor: themeStyles.cardBg }}>
                              <td style={{ borderColor: themeStyles.borderColor, width: '40px' }}>
                                <input
                                  type="checkbox"
                                  className="form-check-input"
                                  checked={selectedReports.includes(report.id)}
                                  onChange={() => toggleReportSelection(report.id)}
                                />
                              </td>
                              <td style={{ borderColor: themeStyles.borderColor }}>
                                <div>
                                  <div className="fw-bold" style={{ color: themeStyles.textColor }}>
                                    {report.name || `تقرير شامل ${i + 1}`}
                                  </div>
                                  <small style={{ color: themeStyles.mutedColor }}>
                                    {report.description || 'تقرير شامل عن النظام'}
                                  </small>
                                </div>
                              </td>
                              <td style={{ borderColor: themeStyles.borderColor }}>
                                <span className="badge text-white px-3 py-2" style={{ backgroundColor: 'var(--primary-color)' }}>
                                  <i className="fas fa-chart-line me-1"></i>
                                  تقرير شامل
                                </span>
                              </td>
                              <td style={{ borderColor: themeStyles.borderColor }}>
                                <span className="badge bg-light text-dark px-2 py-1">
                                  <span className="me-1">
                                    {LANGUAGES.find(l => l.value === (report.language || 'ar'))?.flag}
                                  </span>
                                  <span style={{ color: themeStyles.textColor }}>
                                    {LANGUAGES.find(l => l.value === (report.language || 'ar'))?.label}
                                  </span>
                                </span>
                              </td>
                              <td style={{ borderColor: themeStyles.borderColor, color: themeStyles.textColor }}>
                                {formatDateTime(report.created_at || report.timestamp)}
                              </td>
                              <td style={{ borderColor: themeStyles.borderColor, color: themeStyles.textColor }}>
                                {report.file_size ? `${(report.file_size / 1024).toFixed(1)} KB` : 'غير محدد'}
                              </td>
                              <td style={{ borderColor: themeStyles.borderColor, color: themeStyles.textColor }}>
                                <span className="badge bg-info text-white">
                                  {report.download_count || 0}
                                </span>
                              </td>
                              <td style={{ borderColor: themeStyles.borderColor }}>
                                <div className="d-flex flex-column gap-2">
                                  {/* الصف الأول: أزرار العرض والتحميل */}
                                  <div className="d-flex gap-2 justify-content-center">
                                    <button 
                                      className="btn btn-primary btn-sm"
                                      onClick={() => handleView(report)}
                                      title="عرض التقرير"
                                    >
                                      <i className="fas fa-eye me-1"></i>
                                      عرض
                                    </button>
                                    <button 
                                      className="btn btn-success btn-sm"
                                      onClick={() => handleDownload(report, 'pdf')}
                                      title="تحميل PDF"
                                    >
                                      <i className="fas fa-download me-1"></i>
                                      تحميل
                                    </button>
                                  </div>
                                  
                                  {/* الصف الثاني: أزرار الطباعة والمشاركة */}
                                  <div className="d-flex gap-2 justify-content-center">
                                    <button 
                                      className="btn btn-info btn-sm"
                                      onClick={() => handlePrint(report)}
                                      title="طباعة التقرير"
                                    >
                                      <i className="fas fa-print me-1"></i>
                                      طباعة
                                    </button>
                                    <button 
                                      className="btn btn-warning btn-sm"
                                      onClick={() => handleShare(report)}
                                      title="مشاركة التقرير"
                                    >
                                      <i className="fas fa-share-alt me-1"></i>
                                      مشاركة
                                    </button>
                                  </div>
                                  
                                  {/* الصف الثالث: أزرار الإدارة */}
                                  <div className="d-flex gap-2 justify-content-center">
                                    <button 
                                      className="btn btn-secondary btn-sm"
                                      onClick={() => handleResetDownloadCount(report.id)}
                                      title="مسح عداد التحميلات"
                                    >
                                      <i className="fas fa-undo me-1"></i>
                                      مسح العداد
                                    </button>
                                    <button 
                                      className="btn btn-danger btn-sm"
                                      onClick={() => handleDeleteSingle(report)}
                                      title="حذف التقرير"
                                    >
                                      <i className="fas fa-trash me-1"></i>
                                      حذف
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Generate Report Modal */}
        <Modal
          show={modalGenerateVisible}
          title={
            <div className="d-flex align-items-center">
              <i className="fas fa-plus me-2 text-primary"></i>
              إنشاء تقرير شامل جديد
            </div>
          }
          onClose={() => {
            setModalGenerateVisible(false);
            setForm({
              type: 'system_overview',
              language: 'en', // Always use English
              format: REPORT_FORMATS[0].value,
              includeCharts: true,
              name: ''
            });
          }}
          size="lg"
        >
          <form onSubmit={handleGenerate}>
            <div className="row">
              <div className="col-md-12 mb-3">
                <label className="form-label fw-bold">
                  <i className="fas fa-tag me-1"></i>
                  {labels.reportName}
                </label>
                <input
                  type="text"
                  className="form-control"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  placeholder={currentLanguage === 'en' ? 'Enter report name' : 'أدخل اسم التقرير'}
                  required
                />
              </div>
            </div>

            <div className="row">
              <div className="col-md-6 mb-3">
                <label className="form-label fw-bold">
                  <i className="fas fa-file-export me-1"></i>
                  {labels.format}
                </label>
                <select
                  className="form-select"
                  name="format"
                  value={form.format}
                  onChange={handleChange}
                >
                  {REPORT_FORMATS.map(format => (
                    <option key={format.value} value={format.value}>{format.label}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-6 mb-3">
                <label className="form-label fw-bold">
                  <i className="fas fa-language me-1"></i>
                  {labels.language}
                </label>
                <input
                  type="text"
                  className="form-control"
                  value="English (الإنجليزية)"
                  disabled
                  style={{ 
                    backgroundColor: isDarkMode ? '#2d3238' : 'var(--light)',
                    color: isDarkMode ? '#var(--mid)' : 'var(--black)',
                    border: isDarkMode ? '1px solid #3d444d' : '1px solid var(--mid)'
                  }}
                />
              </div>
            </div>

            <div className="mb-4">
              <div className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  name="includeCharts"
                  checked={form.includeCharts}
                  onChange={handleChange}
                  id="includeCharts"
                />
                <label className="form-check-label" htmlFor="includeCharts">
                  <i className="fas fa-chart-pie me-1"></i>
                  تضمين الرسوم البيانية
                </label>
              </div>
            </div>

            <div className="d-flex justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setModalGenerateVisible(false)}
                disabled={creating}
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={creating}
              >
                {creating ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" />
                    جاري الإنشاء...
                  </>
                ) : (
                  <>
                    <i className="fas fa-plus me-1"></i>
                    إنشاء التقرير
                  </>
                )}
              </button>
            </div>
          </form>
        </Modal>

        {/* View Report Modal */}
        <Modal
          show={modalViewVisible}
          title={
            <div className="d-flex align-items-center">
              <i className="fas fa-eye me-2 text-info"></i>
              عرض التقرير الشامل
            </div>
          }
          onClose={() => setModalViewVisible(false)}
          size="xl"
        >
          {selectedReport && (
            <div>
              <div className="row mb-4">
                <div className="col-12">
                  <div className="card border-0" style={{ backgroundColor: isDarkMode ? 'var(--dark-gray)' : 'var(--light)' }}>
                    <div className="card-body">
                      <div className="d-flex justify-content-between align-items-start">
                        <div>
                          <h5 className="mb-2">{selectedReport.name || 'تقرير شامل بدون عنوان'}</h5>
                          <p className="mb-0 text-muted">
                            {formatDateTime(selectedReport.created_at || selectedReport.timestamp)}
                          </p>
                        </div>
                        <div className="text-end">
                          <span className="badge bg-primary me-2">
                            {selectedReport.format?.toUpperCase() || 'PDF'}
                          </span>
                          <button 
                            className="btn btn-outline-primary btn-sm me-2"
                            onClick={() => handleDownload(selectedReport, selectedReport.format || 'pdf')}
                          >
                            <i className="fas fa-download me-1"></i>
                            تحميل
                          </button>
                          <button 
                            className="btn btn-outline-info btn-sm me-2"
                            onClick={() => handlePrint(selectedReport)}
                          >
                            <i className="fas fa-print me-1"></i>
                            طباعة
                          </button>
                          <button 
                            className="btn btn-outline-warning btn-sm"
                            onClick={() => handleShare(selectedReport)}
                          >
                            <i className="fas fa-share-alt me-1"></i>
                            مشاركة
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="row">
                <div className="col-12">
                  {loadingContent ? (
                    <div className="text-center py-5">
                      <div className="spinner-border text-primary" role="status">
                        <span className="visually-hidden">{labels.loading}</span>
                      </div>
                      <p className="mt-2">جاري تحميل محتوى التقرير...</p>
                    </div>
                  ) : (
                    <ReportContentRenderer
                      content={typeof reportContent === 'string' ? reportContent : ''}
                      isDarkMode={isDarkMode}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </Modal>

        {/* Delete Confirmation Modal */}
        <Modal
          show={deleteConfirmVisible}
          title={
            <div className="d-flex align-items-center">
              <i className="fas fa-exclamation-triangle me-2 text-danger"></i>
              تأكيد حذف التقرير
            </div>
          }
          onClose={() => setDeleteConfirmVisible(false)}
          footer={
            <div className="d-flex gap-2 justify-content-end">
              <button
                className="btn btn-secondary"
                onClick={() => setDeleteConfirmVisible(false)}
                disabled={deleting}
              >
                إلغاء
              </button>
              <button
                className="btn btn-danger"
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <>
                    <i className="fas fa-spinner fa-spin me-1"></i>
                    جارٍ الحذف...
                  </>
                ) : (
                  <>
                    <i className="fas fa-trash me-1"></i>
                    حذف نهائياً
                  </>
                )}
              </button>
            </div>
          }
        >
          <div className="text-center py-3">
            <i className="fas fa-file-alt mb-3" style={{ fontSize: '48px', color: 'var(--danger-color)' }}></i>
            <h5 className="mb-3">هل أنت متأكد من حذف هذا التقرير؟</h5>
            {reportToDelete && (
              <p className="text-muted">
                <strong>{reportToDelete.name || 'تقرير شامل'}</strong>
                <br />
                <small>سيتم حذف التقرير نهائياً ولن يمكن استرداده</small>
              </p>
            )}
          </div>
        </Modal>

      </div>
    </div>
  );
};

export default Reports;
