// src/components/Header.jsx

import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import useAuth from '../hooks/useAuth';
import { useTheme } from '../context/ThemeContext';

const LOGO_SRC = "/usb_monitor_logo.png"; // ضع الصورة في public/

const Header = () => {
  const { currentUser, logout, isAuthenticated, isLoading } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [logoModalOpen, setLogoModalOpen] = useState(false); // متغير لعرض/إخفاء الصورة المكبرة
  const [avatarModalOpen, setAvatarModalOpen] = useState(false); // متغير لعرض/إخفاء صورة المستخدم
  const [userAvatar, setUserAvatar] = useState(null); // حالة محلية للصورة
  const [dropdownPosition, setDropdownPosition] = useState('right'); // موضع البطاقة المنسدلة
  const dropdownRef = useRef(null);

  // تصفير البيانات عند بدء التشغيل إذا لم يكن مسجل دخول
  useEffect(() => {
    // انتظار انتهاء التحقق من التصريح
    if (isLoading) return;
    
    if (!isAuthenticated || !currentUser) {
      setUserAvatar(null);
      setDropdownOpen(false);
      setAvatarModalOpen(false);
      setLogoModalOpen(false);
    }
  }, [isAuthenticated, currentUser, isLoading]);

  // إغلاق القائمة عند الضغط خارجها
  useEffect(() => {
    const onClick = e => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // حساب موضع البطاقة المنسدلة
  const calculateDropdownPosition = () => {
    if (dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      const dropdownWidth = 200; // عرض البطاقة المنسدلة
      const dropdownHeight = 300; // ارتفاع تقريبي للبطاقة المنسدلة
      
      // التحقق من المساحة على اليمين
      const hasSpaceOnRight = rect.right + dropdownWidth <= windowWidth;
      
      // التحقق من المساحة في الأسفل
      const hasSpaceBelow = rect.bottom + dropdownHeight <= windowHeight;
      
      // تحديد الموضع الأمثل
      if (hasSpaceOnRight && hasSpaceBelow) {
        setDropdownPosition('right');
      } else if (!hasSpaceOnRight && hasSpaceBelow) {
        setDropdownPosition('left');
      } else if (hasSpaceOnRight && !hasSpaceBelow) {
        setDropdownPosition('right-top');
      } else {
        setDropdownPosition('left-top');
      }
    }
  };

  // تحديث موضع البطاقة عند فتحها
  useEffect(() => {
    if (dropdownOpen) {
      // تأخير قليل للتأكد من أن البطاقة قد تم عرضها
      setTimeout(() => {
        calculateDropdownPosition();
      }, 10);
    }
  }, [dropdownOpen]);

  // مراقبة تغيير حجم النافذة
  useEffect(() => {
    const handleResize = () => {
      if (dropdownOpen) {
        calculateDropdownPosition();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [dropdownOpen]);

  // تحديث صورة المستخدم عند تغيير البيانات
  useEffect(() => {
    // انتظار انتهاء التحقق من التصريح
    if (isLoading) return;
    
    // إذا لم يكن المستخدم مسجل دخول، قم بتصفير الصورة
    if (!isAuthenticated) {
      setUserAvatar(null);
      return;
    }

    const updateAvatarFromUser = (user) => {
      if (user?.avatar_url) {
        const fullAvatarUrl = user.avatar_url.startsWith('http') 
          ? user.avatar_url 
          : `http://localhost:5000${user.avatar_url}`;

        setUserAvatar(fullAvatarUrl);
        return true;
      }
      return false;
    };

    // محاولة من currentUser أولاً
    if (!updateAvatarFromUser(currentUser)) {
      // التحقق من localStorage كـ fallback فقط إذا كان مسجل دخول
      if (isAuthenticated) {
        const storedUser = localStorage.getItem('current_user');
        if (storedUser) {
          try {
            const parsed = JSON.parse(storedUser);
            if (!updateAvatarFromUser(parsed)) {
              setUserAvatar(null);
            }
          } catch (e) {
            console.error('خطأ في تحليل بيانات المستخدم من localStorage:', e);
            setUserAvatar(null);
          }
        } else {
          setUserAvatar(null);
        }
      }
    }
  }, [currentUser, isAuthenticated, isLoading]);

  // مراقبة تغييرات localStorage
  useEffect(() => {
    const handleStorageChange = () => {
      // فقط إذا كان المستخدم مسجل دخول
      if (!isAuthenticated) {
        setUserAvatar(null);
        return;
      }

      const storedUser = localStorage.getItem('current_user');
      if (storedUser) {
        try {
          const parsed = JSON.parse(storedUser);
          if (parsed?.avatar_url && (!currentUser || parsed.avatar_url !== currentUser.avatar_url)) {
            const fullAvatarUrl = parsed.avatar_url.startsWith('http') 
              ? parsed.avatar_url 
              : `http://localhost:5000${parsed.avatar_url}`;

            setUserAvatar(fullAvatarUrl);
          }
        } catch (e) {
          console.error('خطأ في معالجة تغيير localStorage:', e);
        }
      } else {
        setUserAvatar(null);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [currentUser, isAuthenticated]);

  // تهيئة واجهة المستخدم بعد تسجيل الخروج
  const handleLogout = async () => {
    try {
      // إخفاء القوائم المنسدلة أولاً
      setDropdownOpen(false);
      setAvatarModalOpen(false);
      setLogoModalOpen(false);
      setUserAvatar(null);
      
      // تنفيذ logout
      await logout();
      
      // التأكد من تصفير جميع البيانات المحلية
      localStorage.removeItem('current_user');
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      
      // الانتقال لصفحة الهوم
      navigate('/', { replace: true });
      
      // إعادة تحميل الصفحة لضمان تصفير الواجهة بالكامل
      window.location.reload();
      
    } catch (error) {
      console.error('Logout error:', error);
      
      // تنظيف localStorage يدوياً في حالة الفشل
      localStorage.removeItem('current_user');
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      
      // الانتقال لصفحة الهوم
      navigate('/', { replace: true });
      
      // إعادة تحميل الصفحة
      window.location.reload();
    }
  };

  return (
    <>
      <nav className="navbar d-flex align-center justify-between px-4 py-2 shadow-sm" aria-label="الرأس" style={{ minHeight: '70px' }}>
        {/* Brand + Logo */}
        <div
          className="navbar-brand d-flex align-center"
          aria-label="الصفحة الرئيسية"
          style={{ gap: '0.8rem', cursor: 'pointer' }}
          onClick={() => setLogoModalOpen(true)}
          tabIndex={0}
          role="button"
        >
          <img
            src={LOGO_SRC}
            alt="USB Device Monitoring Logo"
            style={{
              height: 42,
              width: 42,
              objectFit: 'contain',
              borderRadius: '15px',
              boxShadow: '0 0 12px 0 #2227, 0 4px 16px 0 #0005',
              background: '#111',
              padding: 2,
              marginLeft: 3,
              transition: 'transform 0.2s',
              border: '2.5px solid #38a3a5',
            }}
            className="header-logo"
          />
          <span className="fw-bold" style={{ fontSize: '1.23rem', letterSpacing: '.5px' }}>نظام مراقبة USB</span>
        </div>

        {/* Actions */}
        <ul className="d-flex align-center m-0 p-0 list-unstyled" style={{ marginRight: 'auto', gap: '12px' }}>
          {/* Theme toggle */}
          <li>
            <button
              className="btn btn-ghost p-2"
              onClick={toggleTheme}
              aria-label={isDark ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'}
              style={{
                border: 'none',
                background: isDark
                  ? 'linear-gradient(135deg, #ffd700 0%, #ffa500 100%)'
                  : 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                borderRadius: '50%',
                width: 38,
                height: 38,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: isDark
                  ? '0 3px 8px rgba(255, 215, 0, 0.2)'
                  : '0 3px 8px rgba(30, 41, 59, 0.15)',
                transition: 'all 0.3s ease'
              }}
            >
              <span
                style={{
                  color: isDark ? '#ffc107' : '#6c757d',
                  fontSize: 18,
                  fontWeight: 'bold'
                }}
                aria-hidden="true"
              >
                {isDark ? '☀️' : '🌙'}
              </span>
            </button>
          </li>

          {/* User dropdown - يظهر فقط عند تسجيل الدخول */}
          {isAuthenticated && currentUser ? (
            <li
              ref={dropdownRef}
              className={`dropdown position-relative ${dropdownOpen ? 'active' : ''}`}
            >
              <button
                className="btn btn-ghost d-flex align-center p-2"
                style={{ gap: '0.5rem' }}
                onClick={() => setDropdownOpen(open => !open)}
                aria-haspopup="true"
                aria-expanded={dropdownOpen}
                aria-label="قائمة المستخدم"
              >
                {userAvatar ? (
                  <img
                    src={userAvatar}
                    alt="صورة المستخدم"
                    className="rounded-circle"
                    style={{ width: 36, height: 36, objectFit: 'cover', cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAvatarModalOpen(true);
                    }}
                    onError={(_e) => {
                      console.warn('فشل تحميل صورة المستخدم:', userAvatar);
                      setUserAvatar(null); // إزالة الصورة المعطلة
                    }}
                  />
                ) : (
                  <div 
                    className="avatar-circle bg-secondary text-white" 
                    aria-hidden="true"
                    style={{ display: 'flex' }}
                  >
                    {currentUser?.username?.[0]?.toUpperCase() || 'U'}
                  </div>
                )}
                <span style={{ 
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '200px',
                  fontWeight: '500',
                  fontSize: '14px'
                }}>
                  {currentUser?.username || 'مستخدم'}
                </span>
              </button>
            <ul
              className={`dropdown-menu ${
                dropdownPosition === 'right' || dropdownPosition === 'right-top' 
                  ? 'dropdown-menu-end' 
                  : 'dropdown-menu-start'
              }`}
              style={{ 
                minWidth: '200px', 
                padding: '0.5rem 0',
                right: (dropdownPosition === 'right' || dropdownPosition === 'right-top') ? '0' : 'auto',
                left: (dropdownPosition === 'left' || dropdownPosition === 'left-top') ? '0' : 'auto',
                transform: 'translateX(0)',
                maxWidth: '90vw',
                zIndex: 1050,
                position: 'absolute',
                top: (dropdownPosition === 'right-top' || dropdownPosition === 'left-top') ? 'auto' : '100%',
                bottom: (dropdownPosition === 'right-top' || dropdownPosition === 'left-top') ? '100%' : 'auto',
                marginTop: (dropdownPosition === 'right-top' || dropdownPosition === 'left-top') ? 'auto' : '0.5rem',
                marginBottom: (dropdownPosition === 'right-top' || dropdownPosition === 'left-top') ? '0.5rem' : 'auto',
                boxShadow: isDark 
                  ? '0 4px 12px rgba(0,0,0,0.3)' 
                  : '0 4px 12px rgba(0,0,0,0.15)',
                border: isDark 
                  ? '1px solid rgba(255,255,255,0.1)' 
                  : '1px solid rgba(0,0,0,0.1)',
                borderRadius: '8px',
                backgroundColor: isDark ? '#2d3748' : 'white',
                color: isDark ? '#e2e8f0' : '#333',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)'
              }}
              role="menu"
            >
              {isAuthenticated && currentUser && currentUser.username ? (
                // قائمة للمستخدمين المسجلين
                <>
                                      <li>
                      <NavLink 
                        to="/settings/profile" 
                        className="dropdown-item d-flex align-center" 
                        style={{ gap: '0.5rem' }}
                        onClick={() => setDropdownOpen(false)}
                      >
                        <i className="fas fa-user-circle icon icon-sm" aria-hidden="true" />
                        الملف الشخصي
                      </NavLink>
                    </li>
                    <li>
                      <NavLink 
                        to="/settings/system" 
                        className="dropdown-item d-flex align-center" 
                        style={{ gap: '0.5rem' }}
                        onClick={() => setDropdownOpen(false)}
                      >
                        <i className="fas fa-cog icon icon-sm" aria-hidden="true" />
                        الإعدادات
                      </NavLink>
                    </li>
                  <li><hr className="dropdown-divider" /></li>
                  <li>
                    <button
                      onClick={handleLogout}
                      className="dropdown-item text-danger d-flex align-center"
                      style={{ gap: '0.5rem' }}
                    >
                      <i className="fas fa-sign-out-alt icon icon-sm" aria-hidden="true" />
                      تسجيل الخروج
                    </button>
                  </li>
                </>
              ) : (
                // قائمة للضيوف (غير المسجلين)
                <>
                  <li>
                    <div className="dropdown-item-text text-center" style={{ padding: '0.75rem 1rem' }}>
                      <div style={{ color: '#28a745', fontSize: '16px', fontWeight: '700', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '18px' }}>👋</span> مرحباً بك!
                      </div>
                      <div style={{ color: '#6c757d', fontSize: '12px', lineHeight: '1.3' }}>
                        سجل الدخول للوصول<br />لجميع الميزات
                      </div>
                    </div>
                  </li>
                  <li><hr className="dropdown-divider" /></li>
                  <li>
                    <NavLink 
                      to="/login"
                      className="dropdown-item d-flex align-center justify-content-center text-primary"
                      style={{ 
                        gap: '0.5rem', 
                        fontWeight: '600',
                        padding: '0.6rem 1rem',
                        background: 'rgba(0, 123, 255, 0.1)',
                        borderRadius: '4px',
                        margin: '0 0.5rem',
                        border: '1px solid rgba(0, 123, 255, 0.2)',
                        textDecoration: 'none'
                      }}
                      onClick={(_e) => {
                        try {
                          setDropdownOpen(false);
                          // التحقق من أن المسار صحيح
                          if (location.pathname !== '/login') {
                            // الانتقال للصفحة
                          }
                        } catch (error) {
                          console.error('خطأ في الانتقال لصفحة تسجيل الدخول:', error);
                          _e.preventDefault();
                          navigate('/login');
                        }
                      }}
                    >
                      <i className="fas fa-sign-in-alt icon icon-sm" aria-hidden="true" />
                      🔐 تسجيل الدخول
                    </NavLink>
                  </li>
                  <li style={{ marginTop: '0.5rem' }}>
                    <NavLink 
                      to="/register" 
                      className="dropdown-item d-flex align-center justify-content-center text-success"
                      style={{ 
                        gap: '0.5rem', 
                        fontWeight: '500',
                        padding: '0.6rem 1rem',
                        background: 'rgba(40, 167, 69, 0.1)',
                        borderRadius: '4px',
                        margin: '0 0.5rem',
                        border: '1px solid rgba(40, 167, 69, 0.2)',
                        textDecoration: 'none'
                      }}
                      onClick={(_e) => {
                        try {
                          setDropdownOpen(false);
                          // التحقق من أن المسار صحيح
                          if (location.pathname !== '/register') {
                            // الانتقال للصفحة
                          }
                        } catch (error) {
                          console.error('خطأ في الانتقال لصفحة التسجيل:', error);
                          _e.preventDefault();
                          navigate('/register');
                        }
                      }}
                    >
                      <i className="fas fa-user-plus icon icon-sm" aria-hidden="true" />
                      ✨ إنشاء حساب جديد
                    </NavLink>
                  </li>
                </>
              )}
            </ul>
            </li>
          ) : (
            // زر تسجيل الدخول للمستخدمين غير المسجلين
            <li>
              <NavLink 
                to="/login"
                className="btn btn-primary d-flex align-items-center"
                style={{ 
                  gap: '0.5rem',
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                <i className="fas fa-sign-in-alt" aria-hidden="true" />
                تسجيل الدخول
              </NavLink>
            </li>
          )}
        </ul>
      </nav>

      {/* شعار مكبر عند الضغط */}
      {logoModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.87)',
            zIndex: 3000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
          }}
          onClick={() => setLogoModalOpen(false)}
        >
          <div
            style={{
              background: 'transparent',
              borderRadius: 18,
              position: 'relative',
              boxShadow: '0 4px 32px #0009',
              padding: 0,
              maxWidth: '95vw',
              maxHeight: '90vh',
              outline: '2px solid #38a3a5'
            }}
            onClick={e => e.stopPropagation()} // لا تغلق عند الضغط على الصورة نفسها
          >
            <button
              onClick={() => setLogoModalOpen(false)}
              style={{
                position: 'absolute',
                top: 12,
                left: 12,
                background: 'rgba(24,30,40,0.92)',
                color: '#fff',
                border: 'none',
                borderRadius: '50%',
                width: 36,
                height: 36,
                fontSize: 22,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                zIndex: 1
              }}
              aria-label="إغلاق"
            >
              &times;
            </button>
            <img
              src={LOGO_SRC}
              alt="USB Device Monitoring Logo"
              style={{
                width: 'min(380px, 90vw)',
                height: 'min(380px, 80vh)',
                objectFit: 'contain',
                display: 'block',
                borderRadius: 16,
                background: '#161c22',
                boxShadow: '0 0 32px #38a3a599'
              }}
            />
          </div>
        </div>
      )}

      {/* صورة المستخدم مكبرة عند الضغط */}
      {avatarModalOpen && userAvatar && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.87)',
            zIndex: 3000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
          }}
          onClick={() => setAvatarModalOpen(false)}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 18,
              position: 'relative',
              boxShadow: '0 4px 32px #0009',
              padding: 20,
              maxWidth: '95vw',
              maxHeight: '90vh',
              outline: '2px solid #38a3a5'
            }}
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setAvatarModalOpen(false)}
              style={{
                position: 'absolute',
                top: 12,
                left: 12,
                background: 'rgba(24,30,40,0.92)',
                color: '#fff',
                border: 'none',
                borderRadius: '50%',
                width: 36,
                height: 36,
                fontSize: 22,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                zIndex: 1
              }}
              aria-label="إغلاق"
            >
              &times;
            </button>
            <img
              src={userAvatar}
              alt="صورة المستخدم"
              style={{
                width: 'min(400px, 90vw)',
                height: 'min(400px, 80vh)',
                objectFit: 'cover',
                display: 'block',
                borderRadius: 16,
                boxShadow: '0 0 32px #38a3a599'
              }}
              onError={() => {
                console.warn('فشل تحميل الصورة في المودال:', userAvatar);
                setAvatarModalOpen(false);
                setUserAvatar(null);
              }}
            />
            <div style={{
              textAlign: 'center',
              marginTop: 15,
              color: '#333',
              fontSize: 18,
              fontWeight: 600
            }}>
              {currentUser.username || 'المستخدم'}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Header;
