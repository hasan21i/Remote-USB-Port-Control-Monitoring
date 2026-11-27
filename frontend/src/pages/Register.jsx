// src/pages/Register.jsx

import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import useAuth from '../hooks/useAuth';
import { useTheme } from '../context/ThemeContext';
import * as authUtils from '../utils/auth';

const Register = () => {
  const { register, login, logout } = useAuth();
  const { isDarkMode } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    department: '',
    phone: ''
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [passwordStrength, setPasswordStrength] = useState({
    valid: false,
    message: '',
    checks: {}
  });
  const [loading, setLoading] = useState(false);
  const [isCardOpen, setIsCardOpen] = useState(false);

  // عند تركيب المكون، نخرج أي جلسة سابقة
  useEffect(() => {
    logout();
  }, [logout]);

  // قراءة رسالة إعادة التوجيه إن وجدت
  useEffect(() => {
    const msg = new URLSearchParams(location.search).get('message');
    if (msg) setFormError(msg);
  }, [location.search]);

  const handleChange = e => {
    const { name, value } = e.target;
    setFormData(fd => ({ ...fd, [name]: value }));

    if (name === 'password') {
      const strength = authUtils.validatePasswordStrength(value);
      setPasswordStrength({
        valid: strength.valid,
        message: strength.message,
        checks: strength.checks || {}
      });
    }

    if (fieldErrors[name]) {
      setFieldErrors(fe => ({ ...fe, [name]: '' }));
    }
  };

  const validate = () => {
    const errs = {};

    if (!formData.username.trim()) {
      errs.username = 'اسم المستخدم مطلوب';
    } else if (formData.username.trim().length < 3) {
      errs.username = 'يجب أن يكون 3 أحرف على الأقل';
    }
    // لا تتحقق من تكرار الاسم في الواجهة الأمامية

    if (!formData.email.trim()) {
      errs.email = 'البريد الإلكتروني مطلوب';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      errs.email = 'البريد الإلكتروني غير صالح';
    }

    if (!formData.password) {
      errs.password = 'كلمة المرور مطلوبة';
    } else if (!passwordStrength.valid) {
      errs.password = passwordStrength.message;
    }

    if (formData.password !== formData.confirmPassword) {
      errs.confirmPassword = 'كلمتا المرور غير متطابقتين';
    }

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setFormError('');

    if (!validate()) return;

    setLoading(true);
    try {
      // تسجيل حساب جديد - أرسل فقط الحقول المطلوبة للباك إند
      const result = await register({
        username: formData.username,
        email: formData.email,
        password: formData.password
      });
      
      if (result.success) {
        // تسجيل الدخول تلقائياً بعد التسجيل
        await login({
          identifier: formData.email,
          password: formData.password
        });
        
        navigate('/dashboard', { replace: true });
      }
    } catch (err) {
      setFormError(err.message || 'فشل في إنشاء الحساب');
    } finally {
      setLoading(false);
    }
  };

  // حساب نسبة قوة كلمة المرور
  const strengthCount = Object.values(passwordStrength.checks).filter(Boolean).length;
  const strengthPercent = (strengthCount / 5) * 100;

  return (
    <div className={`auth-container ${isDarkMode ? 'theme-dark' : 'theme-light'}`}>


      <div 
        className={`card auth-card mx-auto card-hover-effect ${isCardOpen ? 'card-open' : ''}`}
        onMouseEnter={() => setIsCardOpen(true)}
        onMouseLeave={() => setIsCardOpen(false)}
      >
        <div className="card-header-preview">
          <div>
            <i className="fas fa-user-plus me-2"></i>
            إنشاء حساب جديد
          </div>
        </div>

        <div className="card-body card-content">
          <h2 className="card-title text-center mb-4">إنشاء حساب جديد</h2>
          <p className="text-center text-muted mb-4">
            سجّل الآن للانضمام إلى منصة مراقبة USB
          </p>

          {formError && (
            <div className="alert alert-danger" role="alert" aria-live="assertive">
              {formError}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="row g-3">
              {/* Username */}
              <div className="col-md-6">
                <label htmlFor="username" className="form-label">اسم المستخدم*</label>
                <input
                  type="text"
                  id="username"
                  name="username"
                  className={`form-control ${fieldErrors.username ? 'is-invalid' : ''}`}
                  value={formData.username}
                  onChange={handleChange}
                  placeholder="مثال: mohamed123"
                  disabled={loading}
                  required
                />
                {fieldErrors.username && (
                  <div className="invalid-feedback">{fieldErrors.username}</div>
                )}
              </div>

              {/* Email */}
              <div className="col-md-6">
                <label htmlFor="email" className="form-label">البريد الإلكتروني*</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  className={`form-control ${fieldErrors.email ? 'is-invalid' : ''}`}
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="مثال: you@example.com"
                  disabled={loading}
                  required
                />
                {fieldErrors.email && (
                  <div className="invalid-feedback">{fieldErrors.email}</div>
                )}
              </div>

              {/* Password */}
              <div className="col-md-6">
                <label htmlFor="password" className="form-label">كلمة المرور*</label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  className={`form-control ${fieldErrors.password ? 'is-invalid' : ''}`}
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="••••••••"
                  disabled={loading}
                  required
                />
                {fieldErrors.password && (
                  <div className="invalid-feedback">{fieldErrors.password}</div>
                )}
                {formData.password && (
                  <div className="mt-2">
                    <div
                      className="progress"
                      role="progressbar"
                      aria-valuenow={strengthPercent}
                      aria-valuemin="0"
                      aria-valuemax="100"
                    >
                      <div
                        className={`progress-bar ${
                          strengthCount >= 4 ? 'bg-success' :
                          strengthCount >= 3 ? 'bg-warning' :
                          'bg-danger'
                        }`}
                        style={{ width: `${strengthPercent}%` }}
                      />
                    </div>
                    <small className={passwordStrength.valid ? 'text-success' : 'text-danger'}>
                      {passwordStrength.message}
                    </small>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div className="col-md-6">
                <label htmlFor="confirmPassword" className="form-label">تأكيد كلمة المرور*</label>
                <input
                  type="password"
                  id="confirmPassword"
                  name="confirmPassword"
                  className={`form-control ${fieldErrors.confirmPassword ? 'is-invalid' : ''}`}
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  placeholder="أعد إدخال كلمة المرور"
                  disabled={loading}
                  required
                />
                {fieldErrors.confirmPassword && (
                  <div className="invalid-feedback">{fieldErrors.confirmPassword}</div>
                )}
              </div>

              {/* Department */}
              <div className="col-md-6">
                <label htmlFor="department" className="form-label">القسم</label>
                <input
                  type="text"
                  id="department"
                  name="department"
                  className="form-control"
                  value={formData.department}
                  onChange={handleChange}
                  placeholder="اختياري"
                  disabled={loading}
                />
              </div>

              {/* Phone */}
              <div className="col-md-6">
                <label htmlFor="phone" className="form-label">رقم الهاتف</label>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  className="form-control"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="اختياري"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="d-grid mt-4">
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
                {loading ? 'جاري إنشاء الحساب...' : 'إنشاء حساب'}
              </button>
            </div>

            <p className="text-center mt-3 mb-0">
              لديك حساب؟ <Link to="/login">تسجيل الدخول</Link>
            </p>
          </form>
        </div>
      </div>

      <footer className="mt-4 text-center text-muted small">
        &copy; {new Date().getFullYear()} Smart Zero-Trust Peripheral Security — جميع الحقوق محفوظة
      </footer>
    </div>
  );
};

export default Register;