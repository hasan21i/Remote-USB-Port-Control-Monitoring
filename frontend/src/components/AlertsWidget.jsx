// src/components/AlertsWidget.jsx

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchAlerts } from '../utils/api/alerts';
import { formatRelativeTime, formatAlertPriority } from '../utils/formatters';
import {
  FaBell,
  FaClock,
  FaExclamationCircle,
  FaCheckCircle,
  FaSpinner
} from 'react-icons/fa';

const AlertsWidget = ({ limit = 5, refreshInterval = 60000 }) => {
  const [alerts, setAlerts]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { alerts: list = [] } = await fetchAlerts({ limit, resolved: false });
      setAlerts(list);
    } catch (e) {
      setError(e.message || 'فشل في جلب التنبيهات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, refreshInterval);
    return () => clearInterval(iv);
  }, [limit, refreshInterval]);

  const borderClass = pr => {
    if (pr === 'high')   return 'border-start border-danger border-4';
    if (pr === 'normal') return 'border-start border-primary border-4';
    if (pr === 'low')    return 'border-start border-success border-4';
    return 'border-start border-secondary border-4';
  };

  return (
    <div className="card h-100 d-flex flex-column shadow-sm">
      <div className="card-header d-flex justify-content-between align-items-center bg-light py-2 px-3 border-bottom">
        <h6 className="m-0">آخر التنبيهات</h6>
        <Link to="/monitoring/alerts" className="text-decoration-none text-primary small">
          عرض الكل
        </Link>
      </div>
      <div className="card-body flex-fill overflow-auto p-0">
        {loading ? (
          <div className="d-flex justify-content-center align-items-center p-4 gap-2">
            <FaSpinner className="spin text-primary" aria-hidden="true" />
            <span className="text-muted">جاري التحميل...</span>
          </div>
        ) : error ? (
          <div className="alert alert-danger m-3 d-flex align-items-center gap-2">
            <FaExclamationCircle className="text-danger" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : alerts.length === 0 ? (
          <div className="d-flex flex-column justify-content-center align-items-center p-4 text-muted gap-2">
            <FaCheckCircle className="text-success" size={32} aria-hidden="true" />
            <span>لا توجد تنبيهات جديدة</span>
          </div>
        ) : (
          <ul className="list-unstyled m-0 p-0">
            {alerts.map(a => (
              <li
                key={a.id}
                className={`d-flex align-items-start p-3 gap-3 ${borderClass(a.priority)}`}
              >
                <FaBell className="text-secondary mt-1" aria-hidden="true" />
                <div className="flex-fill">
                  <p className="mb-1">{a.message}</p>
                  <div className="d-flex flex-wrap align-items-center gap-3 small text-muted">
                    <span className="d-flex align-items-center gap-1">
                      <FaClock aria-hidden="true" />
                      {formatRelativeTime(a.created_at)}
                    </span>
                    <span className="d-flex align-items-center gap-1">
                      <FaExclamationCircle aria-hidden="true" />
                      {formatAlertPriority(a.priority)}
                    </span>
                    {a.target_device && (
                      <span className="d-flex align-items-center gap-1">
                        <FaBell aria-hidden="true" />
                        {a.target_device}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
);

export default AlertsWidget;

