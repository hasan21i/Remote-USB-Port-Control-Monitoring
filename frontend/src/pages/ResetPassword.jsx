// src/pages/ResetPassword.jsx

import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import  useAuth  from '../hooks/useAuth';
import { useTheme } from '../context/ThemeContext';
import * as authUtils from '../utils/auth';

const ResetPassword = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const { resetUserPassword } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'submitting' | 'success' | 'invalid'
  const [strength, setStrength] = useState({ valid: false, message: '', details: {} });

  // إذا لم يصل الرمز في params
  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      setError('رمز إعادة التعيين غير صالح أو مفقود.');
    }
  }, [token]);

  // تابع تغيّر كلمة المرور للتحقق من القوة
  const handlePasswordChange = (e) => {
    const pwd = e.target.value;
    setPassword(pwd);
    const chk = authUtils.validatePasswordStrength(pwd);
    setStrength(chk);
    if (error) setError('');
  };

  // إرسال النموذج
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (status !== 'idle') return;

    if (!password) {
      setError('الرجاء إدخال كلمة المرور الجديدة.');
      return;
    }
    if (!strength.valid) {
      setError(strength.message);
      return;
    }
    if (password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين.');
      return;
    }

    setStatus('submitting');
    setError('');
    try {
      await resetUserPassword({ token, password });
      setStatus('success');
      // بعد ثانيتين تحويل المستخدم لتسجيل الدخول
      setTimeout(() => {
        navigate('/login', {
          state: { message: 'تمت إعادة تعيين كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.' }
        });
      }, 2000);
    } catch (err) {
      const msg = err.message || 'حدث خطأ أثناء إعادة التعيين.';
      setError(msg);
      // إذا رسالة الخطأ مرتبطة بانتهاء الصلاحية أو عدم الصلاحية
      if (/منتهي الصلاحية|غير صالح/.test(msg)) {
        setStatus('invalid');
      } else {
        setStatus('idle');
      }
    }
  };

  // عرض حالة الرمز غير الصالح
  if (status === 'invalid') {
    return (
      <div className={`auth-container ${isDarkMode ? 'theme-dark' : 'theme-light'}`}>
        <main className="d-flex align-items-center justify-content-center min-vh-100">
          <section
            className="card auth-card p-4 text-center shadow-sm"
            style={{ maxWidth: 400, width: '100%' }}
          >
            <i
              className="fas fa-exclamation-triangle fa-3x text-warning mb-3"
              aria-hidden="true"
            />
            <h5 className="card-title mb-2">رمز غير صالح</h5>
            <p className="text-muted mb-4">
              رمز إعادة تعيين كلمة المرور مفقود أو منتهي الصلاحية.
            </p>
            <Link to="/forgot-password" className="btn btn-primary">
              طلب رمز جديد
            </Link>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className={`auth-container ${isDarkMode ? 'theme-dark' : 'theme-light'}`}>
      <main className="d-flex align-items-center justify-content-center min-vh-100">
        <section
          className="card auth-card p-4 shadow-sm"
          style={{ maxWidth: 400, width: '100%' }}
          aria-labelledby="reset-password-title"
        >
          <h4
            id="reset-password-title"
            className="card-title text-center mb-3"
          >
            إعادة تعيين كلمة المرور
          </h4>
          <p className="text-center text-muted mb-4">
            أدخل كلمة المرور الجديدة ثم أكدها.
          </p>

          {error && (
            <div className="alert alert-danger mb-3" role="alert">
              {error}
            </div>
          )}

          {status === 'success' ? (
            <div className="text-center py-4">
              <i
                className="fas fa-check-circle fa-3x text-success mb-3"
                aria-hidden="true"
              />
              <p className="mb-2">تمت إعادة التعيين بنجاح!</p>
              <p className="text-muted">جاري تحويلك إلى تسجيل الدخول…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              {/* كلمة المرور الجديدة */}
              <div className="mb-3">
                <label htmlFor="password" className="form-label">
                  كلمة المرور الجديدة
                </label>
                <div className="input-group">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    className={`form-control ${error && !strength.valid ? 'is-invalid' : ''}`}
                    value={password}
                    onChange={handlePasswordChange}
                    placeholder="••••••••"
                    disabled={status === 'submitting'}
                    required
                    aria-describedby="passwordHelp"
                  />
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setShowPassword(prev => !prev)}
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  >
                    <i className={`fas fa-eye${showPassword ? '-slash' : ''}`} aria-hidden="true" />
                  </button>
                </div>
                {password && (
                  <small
                    id="passwordHelp"
                    className={`form-text ${strength.valid ? 'text-success' : 'text-danger'}`}
                  >
                    {strength.message}
                  </small>
                )}
                {password && (
                  <div className="progress mt-2" style={{ height: '6px' }}>
                    <div
                      className={`progress-bar ${
                        strength.details.strength >= 4
                          ? 'bg-success'
                          : strength.details.strength >= 3
                            ? 'bg-warning'
                            : 'bg-danger'
                      }`}
                      style={{ width: `${(strength.details.strength || 0) * 20}%` }}
                    />
                  </div>
                )}
              </div>

              {/* تأكيد كلمة المرور */}
              <div className="mb-4">
                <label htmlFor="confirmPassword" className="form-label">
                  تأكيد كلمة المرور
                </label>
                <div className="input-group">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    id="confirmPassword"
                    className={`form-control ${error && password !== confirmPassword ? 'is-invalid' : ''}`}
                    value={confirmPassword}
                    onChange={e => {
                      setConfirmPassword(e.target.value);
                      if (error) setError('');
                    }}
                    placeholder="••••••••"
                    disabled={status === 'submitting'}
                    required
                  />
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setShowConfirm(prev => !prev)}
                    aria-label={showConfirm ? 'إخفاء التأكيد' : 'إظهار التأكيد'}
                  >
                    <i className={`fas fa-eye${showConfirm ? '-slash' : ''}`} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="d-grid">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={status === 'submitting'}
                  aria-busy={status === 'submitting'}
                >
                  {status === 'submitting' ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
                      جاري الإرسال…
                    </>
                  ) : (
                    'إعادة التعيين'
                  )}
                </button>
              </div>
            </form>
          )}

          <div className="text-center mt-4">
            <Link to="/login" className="text-decoration-none">
              &larr; العودة إلى تسجيل الدخول
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
};

export default ResetPassword;
