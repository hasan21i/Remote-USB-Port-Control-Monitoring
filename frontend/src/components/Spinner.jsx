// src/components/Spinner.jsx

import React from 'react';
import PropTypes from 'prop-types';

const Spinner = ({ size = 'md', text = 'جاري التحميل…', className = '' }) => {
  const sizeClass = size === 'sm' ? 'spinner-border-sm' : '';
  
  return (
    <div className={`text-center py-4 ${className}`} role="status" aria-live="polite" aria-busy="true">
      <div className={`spinner-border ${sizeClass}`} aria-hidden="true" />
      {text && <p className="mt-2 mb-0">{text}</p>}
    </div>
  );
};

Spinner.propTypes = {
  size: PropTypes.oneOf(['sm', 'md']),
  text: PropTypes.string,
  className: PropTypes.string
};

Spinner.displayName = 'Spinner';

export default Spinner;
