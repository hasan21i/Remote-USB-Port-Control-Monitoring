// src/components/ReportCard.jsx

import React, { useMemo, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { runReport } from '../utils/api';
import StatusBadge from './StatusBadge';
import { formatDateTime, formatRelativeTime } from '../utils/formatters';

const ReportCard = React.memo(({ report }) => {
  const {
    id,
    name,
    description,
    report_type,
    schedule,
    is_active,
    last_run,
    next_run
  } = report;

  const [running, setRunning] = useState(false);

  // تجهيز نصوص التواريخ للعرض
  const { lastRunLabel, nextRunLabel } = useMemo(() => ({
    lastRunLabel: last_run
      ? `${formatDateTime(last_run)} (${formatRelativeTime(last_run)})`
      : 'لم يُشغّل بعد',
    nextRunLabel: next_run
      ? `${formatDateTime(next_run)} (${formatRelativeTime(next_run)})`
      : 'غير مخطط'
  }), [last_run, next_run]);

  // عند الضغط على زر "تشغيل الآن"
  const handleRun = useCallback(async () => {
    setRunning(true);
    try {
      await runReport(id);
      // هنا يمكن إعادة جلب بيانات التقرير أو إعلام المستخدم
    } catch (err) {
      console.error('خطأ في تشغيل التقرير:', err);
      // يمكن إضافة إشعار خطأ للمستخدم
    } finally {
      setRunning(false);
    }
  }, [id]);

  return (
    <div
      className="card mb-4 shadow-sm rounded-lg"
      style={{ transition: 'transform var(--transition-fast)' }}
      onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-4px)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
      aria-labelledby={`report-title-${id}`}
    >
      <div className="card-header d-flex justify-content-between align-items-center px-4 py-3">
        <h5 id={`report-title-${id}`} className="m-0 text-lg">{name}</h5>
        <StatusBadge
          status={is_active ? 'connected' : 'disabled'}
          tooltip={is_active ? 'التقرير مفعل للتشغيل الآلي' : 'التقرير معطّل'}
          size="pill"
        />
      </div>

      <div className="card-body px-4 py-3">
        {description && (
          <p className="mb-3 text-md text-muted">{description}</p>
        )}

        <div className="row mb-3">
          <div className="col-6">
            <dl>
              <dt className="text-secondary mb-1">النوع</dt>
              <dd className="mb-2">{report_type}</dd>

              <dt className="text-secondary mb-1">الجدول</dt>
              <dd className="mb-2" title={schedule || ''}>
                {schedule || 'غير محدد'}
              </dd>
            </dl>
          </div>
          <div className="col-6">
            <dl>
              <dt className="text-secondary mb-1">آخر تشغيل</dt>
              <dd className="mb-2" title={last_run || ''}>
                {lastRunLabel}
              </dd>

              <dt className="text-secondary mb-1">التشغيل التالي</dt>
              <dd title={next_run || ''}>{nextRunLabel}</dd>
            </dl>
          </div>
        </div>

        <div className="d-flex justify-content-between">
          <button
            type="button"
            className="btn btn-sm btn-primary d-flex align-items-center"
            onClick={handleRun}
            disabled={running || !is_active}
            aria-label={`تشغيل التقرير ${name} الآن`}
          >
            <i className={`fas fa-play-circle ml-2 ${running ? 'spin' : ''}`} />
            {running ? 'جاري التشغيل...' : 'تشغيل الآن'}
          </button>

          <Link
            to={`/reports/history/${id}`}
            className="btn btn-sm btn-outline-secondary d-flex align-items-center"
            aria-label={`عرض سجل التشغيل للتقرير ${name}`}
          >
            <i className="fas fa-history ml-2" />
            سجل التشغيل
          </Link>
        </div>
      </div>
    </div>
  );
});

ReportCard.propTypes = {
  report: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
    name: PropTypes.string.isRequired,
    description: PropTypes.string,
    report_type: PropTypes.string.isRequired,
    schedule: PropTypes.string,
    is_active: PropTypes.bool,
    last_run: PropTypes.string,
    next_run: PropTypes.string,
  }).isRequired,
};

ReportCard.defaultProps = {
  report: {
    schedule: '',
    description: '',
    is_active: false,
    last_run: '',
    next_run: '',
  },
};

export default ReportCard;
