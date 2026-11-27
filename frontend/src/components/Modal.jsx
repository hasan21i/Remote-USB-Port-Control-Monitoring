// src/components/Modal.jsx

import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import PropTypes from 'prop-types';
import { useTheme } from '../context/ThemeContext';

const Modal = ({
  show,
  title,
  children,
  footer,
  onClose,
  size = 'md',
  centered = true,
  expandable = false,      // جديد: خيار لتفعيل خاصية السهم للتمدد/الطي
  defaultExpanded = true   // جديد: هل يبدأ مفتوحًا أم مغلقًا
}) => {
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const lastActiveElement = useRef(null);
  const { isDark } = useTheme();

  // للتحكم بتمدد/طي المحتوى
  const [expanded, setExpanded] = useState(defaultExpanded);

  // استعادة وضع expand إذا تغير show (يفتح المودال من جديد)
  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [show, defaultExpanded]);

  useEffect(() => {
    if (!show) return;
    lastActiveElement.current = document.activeElement;
    document.body.style.overflow = 'hidden';

    const timer = setTimeout(() => {
      const focusable = dialogRef.current?.querySelector(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      focusable?.focus();
    }, 10);

    const handleKeyDown = e => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const elems = dialogRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!elems.length) return;
        const first = elems[0];
        const last = elems[elems.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      lastActiveElement.current?.focus();
    };
  }, [show, onClose]);

  if (!show) return null;

  // حجم المودال مخصص حسب المتغير size
  const modalSizeClass = {
    sm: 'modal-sm',
    md: 'modal-md',
    lg: 'modal-lg',
    xl: 'modal-xl'
  }[size] || 'modal-md';

  // أقصى ارتفاع للمودال (مع تمرير داخلي للمحتوى)
  const maxBodyHeight = size === 'sm' ? 300 : size === 'lg' ? 480 : 400;

  return ReactDOM.createPortal(
    <div className="modal-container" role="presentation" style={{ zIndex: 2000 }}>
      <div
        ref={backdropRef}
        className="modal-backdrop"
        onClick={e => {
          if (e.target === backdropRef.current) onClose();
        }}
      />
      <div
        ref={dialogRef}
        className={`modal-dialog ${modalSizeClass} ${centered ? 'modal-centered' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        style={{
          minWidth: 340,
          width: size === 'xl' ? 640 : size === 'lg' ? 540 : size === 'sm' ? 340 : 420,
          maxWidth: '95vw'
        }}
      >
        <div className="modal-content shadow-lg" style={{
          borderRadius: 16, 
          overflow: 'hidden',
          backgroundColor: isDark ? '#1a1d21' : 'var(--white)',
          border: isDark ? '1px solid #2d3238' : '1px solid var(--mid)',
          color: isDark ? '#var(--mid)' : 'var(--black)'
        }}>
          {/* Header ثابت مع سهم وأسهم إغلاق */}
          <div
            className="modal-header d-flex justify-between align-items-center px-4"
            style={{ 
              background: isDark ? 'var(--black)' : '#f5f7fa', 
              borderBottom: isDark ? '1px solid #2d3238' : '1px solid #e6e9ef', 
              minHeight: 62 
            }}
          >
            <div className="d-flex align-items-center" style={{ gap: 10 }}>
              {/* سهم للتمدد/الطي إذا كان expandable */}
              {expandable && (
                <button
                  type="button"
                  className={isDark ? "btn btn-dark btn-sm rounded-circle" : "btn btn-light btn-sm rounded-circle"}
                  style={{
                    border: 'none',
                    width: 36,
                    height: 36,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background 0.1s',
                    backgroundColor: isDark ? '#2d3238' : 'var(--white)'
                  }}
                  aria-label={expanded ? 'إخفاء التفاصيل' : 'إظهار التفاصيل'}
                  onClick={() => setExpanded(e => !e)}
                  tabIndex={0}
                >
                  <i className={`fas fa-chevron-${expanded ? 'up' : 'down'} fs-5`} />
                </button>
              )}
              <h5
                id="modal-title"
                className="modal-title fw-bold mb-0"
                style={{ fontSize: 22, color: isDark ? 'var(--white)' : '#1a1a2e' }}
              >
                {title}
              </h5>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              style={{ 
                fontSize: 16, 
                backgroundColor: 'transparent',
                borderRadius: 0,
                width: 46,
                height: 34,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                color: isDark ? 'var(--gray)' : 'var(--gray)',
                transition: 'background-color 0.15s, color 0.15s',
                cursor: 'pointer',
                marginRight: -16,
                marginTop: -4,
              }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#e81123'; e.currentTarget.style.color = 'var(--white)'; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = isDark ? 'var(--gray)' : 'var(--gray)'; }}
            >
              <i className="fas fa-times" aria-hidden="true" />
            </button>
          </div>

          {/* جسم المودال القابل للتمدد/الطي مع تمرير داخلي */}
          {(!expandable || expanded) && (
            <div
              className="modal-body p-4"
              style={{
                maxHeight: maxBodyHeight,
                overflowY: 'auto',
                background: isDark ? '#1a1d21' : 'var(--white)'
              }}
            >
              {children}
            </div>
          )}

          {/* فوتر اختياري */}
          {footer && (
            <div className="modal-footer d-flex justify-end gap-2 p-3" style={{ 
              background: isDark ? 'var(--black)' : "#f9f9fc",
              borderTop: isDark ? '1px solid #2d3238' : '1px solid #e6e9ef'
            }}>
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.getElementById('modal-root')
  );
};

Modal.propTypes = {
  show:     PropTypes.bool.isRequired,
  title:    PropTypes.node,
  children: PropTypes.node,
  footer:   PropTypes.node,
  onClose:  PropTypes.func.isRequired,
  size:     PropTypes.oneOf(['sm', 'md', 'lg', 'xl']),
  centered: PropTypes.bool,
  expandable: PropTypes.bool,
  defaultExpanded: PropTypes.bool
};

export default Modal;
