// src/pages/Login.jsx

import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import useAuth from '../hooks/useAuth';
import { useTheme } from '../context/ThemeContext';

const Login = () => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword]     = useState('');
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [redirectMsg, setRedirectMsg] = useState('');
  const [otp, setOtp] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [isCardOpen, setIsCardOpen] = useState(false);

  // Use login and ensure we're logged out when this page mounts
  const { login, logout } = useAuth();
  const { isDarkMode }    = useTheme();
  const navigate          = useNavigate();
  const location          = useLocation();

  // on mount: clear any existing session
  useEffect(() => {
    // تنظيف شامل للجلسة
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('current_user');
    
    // استدعاء logout لتنظيف الحالة
    logout();
  }, [logout]);

  // read optional redirect message from query
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const msg = params.get('message');
    if (msg) {
      if (msg === 'account_created') {
        setRedirectMsg('تم إنشاء الحساب بنجاح! يرجى تسجيل الدخول الآن.');
      } else {
        setRedirectMsg(msg);
      }
    }
  }, [location.search]);

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setMfaRequired(false);

    if (!identifier.trim() || !password) {
      setError('الرجاء إدخال اسم المستخدم/البريد وكلمة المرور');
      return;
    }

    setLoading(true);
    try {
      const credentials = { identifier, password };
      if (otp) credentials.otp = otp;
      
      await login(credentials);
      // بعد تسجيل الدخول: توجه إلى redirectTo إن وجد وإلا لوحة التحكم
      const params = new URLSearchParams(location.search);
      const to     = params.get('redirectTo');
      let target   = to || '/dashboard';
      navigate(target, { replace: true });
    } catch (err) {
      if (err && err.mfaRequired) {
        setMfaRequired(true);
        setError('يرجى إدخال رمز التحقق (OTP) من تطبيق المصادقة');
      } else {
        setError(err.message || 'فشل في تسجيل الدخول');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`auth-container ${isDarkMode ? 'theme-dark' : 'theme-light'}`}>
      <style>{`
        .card-hover-effect {
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          transform-style: preserve-3d;
          overflow: hidden;
          position: relative;
          cursor: pointer;
        }

        .card-hover-effect:not(.card-open) {
          max-height: 80px;
          transform: rotateX(-10deg) rotateY(5deg);
          box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
        }

        .card-hover-effect.card-open {
          max-height: 800px;
          transform: rotateX(0deg) rotateY(0deg) scale(1.02);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
        }

        .card-content {
          transition: opacity 0.3s ease, transform 0.3s ease;
        }

        .card-hover-effect:not(.card-open) .card-content {
          opacity: 0;
          transform: translateY(-20px);
          pointer-events: none;
        }

        .card-hover-effect.card-open .card-content {
          opacity: 1;
          transform: translateY(0);
          pointer-events: auto;
        }

        .card-header-preview {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 80px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, var(--primary-color) 0%, #177fda 100%);
          color: white;
          font-weight: bold;
          font-size: 1.2rem;
          transition: opacity 0.3s ease;
          z-index: 1;
        }

        .card-hover-effect.card-open .card-header-preview {
          opacity: 0;
          pointer-events: none;
        }

        .card-hover-effect:not(.card-open) .card-header-preview {
          opacity: 1;
        }

        .theme-dark .card-header-preview {
          background: linear-gradient(135deg, var(--gray) 0%, var(--text-primary) 100%);
        }

        .card-body {
          position: relative;
          z-index: 2;
          background: inherit;
        }

        .auth-container {
          perspective: 1000px;
          perspective-origin: center center;
        }

        @media (max-width: 768px) {
          .card-hover-effect:not(.card-open) {
            transform: rotateX(-5deg);
          }
          
          .card-hover-effect.card-open {
            transform: scale(1);
          }
        }
      `}</style>

      <div 
        className={`card auth-card mx-auto card-hover-effect ${isCardOpen ? 'card-open' : ''}`}
        onMouseEnter={() => setIsCardOpen(true)}
        onMouseLeave={() => setIsCardOpen(false)}
      >
        <div className="card-header-preview">
          <div>
            <i className="fas fa-lock me-2"></i>
            تسجيل الدخول
          </div>
        </div>

        <div className="card-body card-content">
          <h2 className="card-title text-center mb-4">تسجيل الدخول</h2>
          <p className="text-center text-muted mb-4">
            أدخل بيانات حسابك للمتابعة
          </p>

          {redirectMsg && (
            <div className="alert alert-success" role="alert">
              {redirectMsg}
            </div>
          )}

          {error && (
            <div className="alert alert-danger" role="alert" aria-live="assertive">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-3">
              <label htmlFor="identifier" className="form-label">
                البريد الإلكتروني أو اسم المستخدم
              </label>
              <input
                type="text"
                id="identifier"
                className="form-control"
                placeholder="البريد الإلكتروني (مُفضل) أو اسم المستخدم"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                disabled={loading}
                required
                aria-required="true"
                aria-invalid={!!error}
              />
            </div>

            <div className="mb-3">
              <div className="d-flex justify-content-between align-items-center">
                <label htmlFor="password" className="form-label">
                  كلمة المرور
                </label>
                <Link to="/forgot-password" className="small">
                  نسيت كلمة المرور؟
                </Link>
              </div>
              <input
                type="password"
                id="password"
                className="form-control"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
                required
                aria-required="true"
                aria-invalid={!!error}
              />
            </div>

            {mfaRequired && (
              <div className="mb-3">
                <label htmlFor="otp" className="form-label">
                  رمز التحقق (OTP) من تطبيق المصادقة
                </label>
                <input
                  type="text"
                  id="otp"
                  className="form-control"
                  placeholder="رمز لمرة واحدة من تطبيق Google Authenticator"
                  value={otp}
                  onChange={e => setOtp(e.target.value)}
                  disabled={loading}
                  required
                  aria-required="true"
                  aria-invalid={!!error}
                  autoFocus
                />
              </div>
            )}

            <div className="d-grid mb-3">
              <button
                type="submit"
                className="btn btn-primary btn-lg"
                disabled={loading}
                aria-busy={loading}
              >
                {loading && (
                  <span
                    className="spinner-border spinner-border-sm me-2"
                    role="status"
                    aria-hidden="true"
                  />
                )}
                {loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
              </button>
            </div>

            <p className="text-center mb-0">
              لا تملك حسابًا؟ <Link to="/register">إنشاء حساب جديد</Link>
            </p>
          </form>
        </div>
      </div>

      <footer className="mt-4 text-center text-muted small">
        © {new Date().getFullYear()} Smart Zero-Trust Peripheral Security — جميع الحقوق محفوظة
      </footer>
    </div>
  );
};

export default Login;