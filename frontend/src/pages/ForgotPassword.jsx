// src/pages/ForgotPassword.jsx

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import  useAuth  from '../hooks/useAuth';
import { useTheme } from '../context/ThemeContext';

const ForgotPassword = () => {
  const { isDarkMode } = useTheme();
  const { requestPasswordReset } = useAuth();

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'sending' | 'sent' | 'error'
  const [error, setError] = useState('');

  // نظف الخطأ عند تغيير البريد أو إعادة الحالة إلى 'idle'
  useEffect(() => {
    setError('');
  }, [email, status]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError('الرجاء إدخال البريد الإلكتروني.');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(trimmed)) {
      setError('البريد الإلكتروني غير صالح.');
      return;
    }

    setStatus('sending');
    try {
      await requestPasswordReset(trimmed);
      setStatus('sent');
    } catch (err) {
      console.error('ForgotPassword error:', err);
      setError(err.message || 'حدث خطأ أثناء إرسال رابط إعادة التعيين.');
      setStatus('error');
    }
  };

  return (
    <div className={`auth-container ${isDarkMode ? 'theme-dark' : 'theme-light'}`}>
      <main className="d-flex align-items-center justify-content-center min-vh-100">
        <section
          className="card auth-card p-4 shadow-sm"
          style={{ maxWidth: 400, width: '100%' }}
          aria-labelledby="forgot-password-title"
        >
          <h2
            id="forgot-password-title"
            className="h5 text-center mb-3"
          >
            استعادة كلمة المرور
          </h2>
          <p className="text-center text-muted mb-4">
            أدخل بريدك الإلكتروني لاستلام رابط إعادة التعيين
          </p>

          {error && (
            <div className="alert alert-danger" role="alert" aria-live="assertive">
              {error}
            </div>
          )}

          {status === 'sent' ? (
            <div className="text-center">
              <i
                className="fas fa-envelope-open-text fa-3x text-success mb-3"
                aria-hidden="true"
              />
              <p className="mb-1">
                أرسلنا رابط إعادة التعيين إلى <strong>{email.trim()}</strong>.
              </p>
              <p className="text-muted mb-3">
                يرجى التحقق من صندوق الوارد أو مجلد الرسائل غير المرغوب بها.
              </p>
              <button
                type="button"
                className="btn btn-link mb-3"
                onClick={() => {
                  setStatus('idle');
                  setEmail('');
                }}
                disabled={status === 'sending'}
              >
                إرسال مرة أخرى
              </button>
              <div>
                <Link to="/login" className="btn btn-primary">
                  العودة لتسجيل الدخول
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <div className="mb-3">
                <label htmlFor="email" className="form-label">
                  البريد الإلكتروني
                </label>
                <input
                  id="email"
                  type="email"
                  className={`form-control ${error ? 'is-invalid' : ''}`}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@domain.com"
                  disabled={status === 'sending'}
                  required
                  aria-required="true"
                />
              </div>
              <div className="d-grid">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={status === 'sending'}
                  aria-busy={status === 'sending'}
                >
                  {status === 'sending' ? (
                    <>
                      <span
                        className="spinner-border spinner-border-sm me-2"
                        role="status"
                        aria-hidden="true"
                      />
                      جاري الإرسال...
                    </>
                  ) : (
                    'إرسال رابط إعادة التعيين'
                  )}
                </button>
              </div>
              <p className="text-center mt-3 mb-0">
                تذكرت كلمة المرور؟{' '}
                <Link to="/login">تسجيل الدخول</Link>
              </p>
            </form>
          )}
        </section>
      </main>
    </div>
  );
};

export default ForgotPassword;
