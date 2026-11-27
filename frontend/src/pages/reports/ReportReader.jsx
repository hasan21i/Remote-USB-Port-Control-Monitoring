import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchReportContent, exportReport } from '../../utils/api';
import Spinner from '../../components/Spinner';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';

const LANGS = [
  { code: 'ar', label: 'العربية' },
  { code: 'en', label: 'English' }
];

const SECTION_LABELS = {
  timeline: { ar: 'التسلسل الزمني', en: 'Timeline' },
  vulnerability: { ar: 'الثغرات', en: 'Vulnerabilities' },
  impact: { ar: 'تقييم الأثر', en: 'Impact Analysis' },
  analysis: { ar: 'التحليل الجنائي', en: 'Forensic Analysis' },
  ai_summary: { ar: 'ملخص الذكاء الاصطناعي', en: 'AI Summary' }
};

function splitSections(content) {
  // ابحث عن رؤوس الأقسام (## timeline ...)
  const regex = /##\s*(timeline|vulnerability|impact|analysis|ai_summary)\s*:?/gi;
  let result = [];
  let lastIndex = 0;
  let match;
  let lastKey = null;
  while ((match = regex.exec(content))) {
    if (lastKey) {
      result.push({
        key: lastKey,
        text: content.slice(lastIndex, match.index).trim()
      });
    }
    lastKey = match[1].toLowerCase();
    lastIndex = match.index + match[0].length;
  }
  if (lastKey) {
    result.push({ key: lastKey, text: content.slice(lastIndex).trim() });
  }
  // إذا لم يوجد تقسيم، أعد النص كله
  if (result.length === 0) return null;
  return result;
}

export default function ReportReader() {
  const { id } = useParams();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lang, setLang] = useState('ar');
  const { t, i18n } = useTranslation();

  useEffect(() => {
    setLoading(true);
    fetchReportContent(id)
      .then(setContent)
      .catch(() => setError('لم يتم العثور على التقرير أو حدث خطأ'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleLangChange = (e) => {
    setLang(e.target.value);
    i18n.changeLanguage(e.target.value);
  };

  const handleExport = async (format) => {
    try {
      const blob = await exportReport(format, id);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_${id}.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('فشل تحميل التقرير');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
  };

  let sections = splitSections(content);

  if (loading) return <Spinner />;
  if (error) return <div className="alert alert-danger mt-4">{error}</div>;

  return (
    <div className={`container py-4 ${lang === 'ar' ? 'text-end' : 'text-start'}`} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h3 className="fw-bold">
          <i className="fas fa-file-alt me-2" />
          {t('تفاصيل التقرير الجنائي')}
        </h3>
        <div>
          <select value={lang} onChange={handleLangChange} className="form-select d-inline w-auto me-2">
            {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <button className="btn btn-outline-success me-1" onClick={() => handleExport('pdf')}>
            <i className="fas fa-file-pdf me-1" /> PDF
          </button>
          <button className="btn btn-outline-secondary me-1" onClick={() => handleExport('csv')}>
            <i className="fas fa-file-csv me-1" /> CSV
          </button>
          <button className="btn btn-outline-info me-1" onClick={handlePrint}>
            <i className="fas fa-print me-1" /> {t('طباعة')}
          </button>
          <button className="btn btn-outline-dark" onClick={handleCopyLink}>
            <i className="fas fa-link me-1" /> {t('نسخ الرابط')}
          </button>
        </div>
      </div>
      <div className="card shadow-sm p-4 mb-4">
        {sections ? (
          <>
            {sections.map(sec => (
              <div key={sec.key} className="mb-4">
                <h5 className="fw-bold border-bottom pb-1 mb-2 text-primary">
                  {SECTION_LABELS[sec.key] ? SECTION_LABELS[sec.key][lang] : sec.key}
                </h5>
                <div className="markdown-body">
                  <ReactMarkdown>{sec.text}</ReactMarkdown>
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className="markdown-body">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
} 