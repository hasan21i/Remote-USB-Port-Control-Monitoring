// src/components/StatusBadge.jsx

import React from 'react';
import PropTypes from 'prop-types';

const STATUS_CONFIG = {
  connected: {
    variant: 'success',
    icon: 'fa-plug',
    label: 'متصل'
  },
  disconnected: {
    variant: 'secondary',
    icon: 'fa-unlink',
    label: 'منفصل'
  },
  blocked: {
    variant: 'danger',
    icon: 'fa-ban',
    label: 'محظور'
  },
  disabled: {
    variant: 'warning',
    icon: 'fa-times-circle',
    label: 'معطّل'
  },
  ejected: {
    variant: 'info',
    icon: 'fa-eject',
    label: 'تم إخراجه'
  },
  unknown: {
    variant: 'secondary',
    icon: 'fa-question-circle',
    label: 'غير معروف'
  }
};

const StatusBadge = React.memo(function StatusBadge({
  status = 'unknown',
  tooltip = '',
  className = '',
  size = 'md'
}) {
  const { variant, icon, label } = STATUS_CONFIG[status] || STATUS_CONFIG.unknown;

  // اختر فئات الحجم بما يتوافق مع utilities.css
  const sizeClass =
    size === 'sm'
      ? 'badge-sm'
      : size === 'pill'
      ? 'rounded-pill'
      : ''; // الحجم الافتراضي 'md' لا يحتاج فئة إضافية

  // أنماط مخصصة لاحترافية أعلى
  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3em',
    fontWeight: 600,
    fontSize: size === 'sm' ? '0.87em' : '1em',
    boxShadow: '0 2px 10px #0001',
    border: 'none',
    transition: 'transform 0.12s, box-shadow 0.15s',
    cursor: tooltip ? 'help' : 'default',
    background:
      variant === 'success'
        ? 'linear-gradient(90deg, #4CAF50 60%, #388E3C 100%)'
        : variant === 'danger'
        ? 'linear-gradient(90deg, #e53935 60%, #b71c1c 100%)'
        : variant === 'info'
        ? 'linear-gradient(90deg, #29b6f6 60%, #01579b 100%)'
        : variant === 'warning'
        ? 'linear-gradient(90deg, #ffd600 60%, #ff6f00 100%)'
        : variant === 'secondary'
        ? 'linear-gradient(90deg, #888 60%, #444 100%)'
        : 'linear-gradient(90deg, #ccc 60%, #999 100%)',
    color: 'var(--white)',
    borderRadius: size === 'pill' ? '1em' : '0.4em',
    padding: size === 'sm' ? '0.28em 0.6em' : '0.37em 1em',
    minWidth: '70px'
  };

  // هوفر أكثر احترافية
  const hoverStyle = {
    boxShadow: '0 2px 12px #0002',
    transform: 'scale(1.05)'
  };

  // ريف لهوڤر داخلي بالريأكت فقط (دون css خارجي)
  const [hover, setHover] = React.useState(false);

  return (
    <span
      className={`badge badge-${variant} ${sizeClass} ${className}`.trim()}
      style={hover ? { ...style, ...hoverStyle } : style}
      title={tooltip || label}
      aria-label={label}
      role="status"
      tabIndex={0}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <i className={`fas ${icon} icon-sm me-1`} aria-hidden="true" style={{ filter: 'drop-shadow(0 1px 1px #0002)' }} />
      <span>{label}</span>
    </span>
  );
});

StatusBadge.displayName = 'StatusBadge';

StatusBadge.propTypes = {
  status: PropTypes.oneOf(Object.keys(STATUS_CONFIG)),
  tooltip: PropTypes.string,
  className: PropTypes.string,
  size: PropTypes.oneOf(['sm', 'md', 'pill'])
};

export default StatusBadge;
