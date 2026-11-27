import React, { useState, useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import { formatRelativeTime } from '../utils/formatters'; // دالة تعرض وقت نسبي باللغة العربية

/**
 * شارة تعرض حالة نبض حياة الخادم بناءً على آخر طابع زمني.
 * - أخضر إذا كان ضمن threshold صحي.
 * - أصفر إذا كان متأخراً.
 * - أحمر إذا انقطع تماماً.
 */
const HeartbeatBadge = ({ 
  timestamp = null, 
  serverStatus: _serverStatus = '', // إضافة _ لتجنب تحذير ESLint
  isOnline = false,
  healthyThresholdSec = 60, 
  warningThresholdSec = 300 
}) => {
  const [currentTime, setCurrentTime] = useState(Date.now());
  
  // تحديث الوقت الحالي كل 10 ثواني
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 10000); // 10 ثواني
    
    return () => clearInterval(interval);
  }, []);
  
  const last = timestamp ? new Date(timestamp).getTime() : null;

  // حساب الحالة والمتغيرات مرة واحدة فقط عند تغيير timestamp أو thresholds
  const { variant, icon, label, timeAgo, formattedTime } = useMemo(() => {
    let stateKey = 'stale';
    let timeAgoStr = timestamp ? formatRelativeTime(timestamp) : 'غير متوفر';
    let formattedStr = timestamp
      ? new Intl.DateTimeFormat('ar-EG', {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(new Date(timestamp))
      : 'غير متوفر';

    // إعطاء الأولوية لحالة الخادم الفعلية
    if (isOnline) {
      stateKey = 'healthy';
    } else if (last !== null) {
      const diffSec = (currentTime - last) / 1000;
      if (diffSec <= healthyThresholdSec) stateKey = 'healthy';
      else if (diffSec <= warningThresholdSec) stateKey = 'warning';
      else stateKey = 'stale';
    }

    const CONFIG = {
      healthy: { variant: 'success', icon: 'fa-heartbeat', label: 'متصل' },
      warning: { variant: 'warning',  icon: 'fa-heart',      label: 'متأخر' },
      stale:   { variant: 'secondary', icon: 'fa-heart',     label: 'غير متاح' },
    };

    const cfg = CONFIG[stateKey];
    return {
      variant: cfg.variant,
      icon:    cfg.icon,
      label:   cfg.label,
      timeAgo: timeAgoStr,
      formattedTime: formattedStr
    };
  }, [timestamp, healthyThresholdSec, warningThresholdSec, last, currentTime, isOnline]);

  return (
    <span
      className={`badge badge-${variant} heartbeat-badge`}
      title={`${label} • آخر نبضة: ${formattedTime}`}
      aria-label={`${label}، ${timeAgo}`}
      role="status"
      aria-live="polite"
    >
      <i className={`fas ${icon} ml-1`} aria-hidden="true" />
      <span>{label}</span>
      {/* عرض الوقت النسبي بشكل ثانوي على الشاشات الكبيرة */}
      {timestamp && (
        <small className="ml-2 d-none d-md-inline text-light">
          ({timeAgo})
        </small>
      )}
    </span>
  );
};

HeartbeatBadge.propTypes = {
  /** طابع زمني ISO لآخر نبضة */
  timestamp: PropTypes.string,
  /** حالة الخادم الفعلية */
  serverStatus: PropTypes.string,
  /** هل الخادم متصل حالياً */
  isOnline: PropTypes.bool,
  /** حد الثواني للحالة الصحية (أخضر) */
  healthyThresholdSec: PropTypes.number,
  /** حد الثواني للحالة التحذيرية (أصفر) */
  warningThresholdSec: PropTypes.number,
};

export default HeartbeatBadge;
