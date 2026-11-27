import React, { useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAppInfo } from '../context/AppInfoContext';

const Footer = () => {
  const { isDark } = useTheme();
  const { version, companyName, buildTime } = useAppInfo();
  const currentYear = new Date().getFullYear();
  const [showImageModal, setShowImageModal] = useState(false);

  // Format build time in Arabic locale with date and time
  const buildDateFormatted = new Intl.DateTimeFormat('ar-SA', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(new Date(buildTime));

  return (
    <footer className={`footer${isDark ? ' footer--dark' : ''}`} aria-label="تذييل الصفحة">
      <div className="d-flex flex-column flex-lg-row justify-content-between align-items-center py-2 px-3">
        
        {/* Left Side - Team Info */}
        <div className="d-flex align-items-center mb-2 mb-lg-0">
          {/* Social Media Icons */}
          <div className="d-flex flex-column gap-2 me-3">
            <button 
              type="button"
              className="btn p-0 border-0 bg-transparent"
              onClick={() => window.open('https://www.instagram.com/21.lpn?igsh=bDJ6Nnl3NTduaHgz', '_blank')}
              aria-label="Instagram"
            >
              <div style={{
                width: '35px',
                height: '35px',
                background: 'linear-gradient(45deg, #f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(240, 148, 51, 0.3)'
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                </svg>
              </div>
            </button>
            
            <button 
              type="button"
              className="btn p-0 border-0 bg-transparent"
              onClick={() => window.open('https://www.linkedin.com/in/hassan-ali-85b692348?utm_source=share&utm_campaign=share_via&utm_content=profile&utm_medium=android_app', '_blank')}
              aria-label="LinkedIn"
            >
              <div style={{
                width: '35px',
                height: '35px',
                background: 'linear-gradient(135deg, #0077b5 0%, #00a0dc 100%)',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0, 119, 181, 0.3)'
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
              </div>
            </button>
            
            <button 
              type="button"
              className="btn p-0 border-0 bg-transparent"
              onClick={() => window.open('https://t.me/Firmino2003', '_blank')}
              aria-label="Telegram"
            >
              <div style={{
                width: '35px',
                height: '35px',
                background: 'linear-gradient(135deg, #0088cc 0%, #229ed9 100%)',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(34, 158, 217, 0.3)'
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/>
                </svg>
              </div>
            </button>
          </div>

          <div className="d-flex align-items-center">
            <div className="me-3">
              <h4 className="mb-0 fw-bold text-white" style={{ fontSize: '20px' }}>Alpha Team</h4>
              <p className="mb-1" style={{ 
                color: '#a8c8ec', 
                fontSize: '13px',
                fontWeight: '500'
              }}>
                Innovative Solutions
              </p>
              <p className="mb-0" style={{ 
                color: '#87ceeb', 
                fontSize: '11px',
                maxWidth: '280px',
                lineHeight: '1.3'
              }}>
                Building cutting-edge solutions that shape the future of technology and empower developers worldwide.
              </p>
            </div>
            
            {/* Team Logo */}
            <div className="team-logo" style={{
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(231, 76, 60, 0.3)'
            }}>
              <img 
                src="/alpha-team-logo.png" 
                alt="Alpha Team Logo"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
              <div style={{
                width: '100%',
                height: '100%',
                display: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'var(--danger-color)',
                borderRadius: '8px'
              }}>
                <div style={{
                  width: '70%',
                  height: '70%',
                  backgroundColor: 'white',
                  clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)'
                }}></div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side - Developer Info */}
        <div className="d-flex align-items-center">
          <div className="text-end me-3">
            <div className="mb-1">
              <span style={{ 
                color: '#4fc3f7', 
                fontSize: '11px', 
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                SYSTEM DEVELOPER
              </span>
            </div>
            <h5 className="mb-1 fw-bold text-white" style={{ fontSize: '16px' }}>
              Hasan Ali Hasan
            </h5>
            <p className="mb-2" style={{ 
              color: '#ffa726', 
              fontSize: '12px',
              fontWeight: '500'
            }}>
              Alpha Team Developer
            </p>
            <button 
              className="btn d-flex align-items-center gap-1" 
              onClick={() => window.open('https://linktr.ee/Hasan.21', '_blank')}
              style={{
                borderRadius: '15px',
                padding: '4px 12px',
                fontSize: '11px',
                fontWeight: '600',
                background: 'linear-gradient(135deg, #66bb6a 0%, #4caf50 100%)',
                border: 'none',
                color: 'white',
                boxShadow: '0 2px 8px rgba(76, 175, 80, 0.3)',
                marginLeft: 'auto'
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
              </svg>
              Connect
            </button>
          </div>
          
          <div 
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              overflow: 'hidden',
              border: '4px solid #4fc3f7',
              boxShadow: '0 4px 15px rgba(79, 195, 247, 0.5)',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s'
            }}
            onClick={() => setShowImageModal(true)}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.05)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(79, 195, 247, 0.7)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 4px 15px rgba(79, 195, 247, 0.5)';
            }}
            title="اضغط لعرض الصورة"
          >
            <img 
              src="/hasan-profile.jpg" 
              alt="Hasan Ali Hasan"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'flex';
              }}
            />
            <div style={{
              width: '100%',
              height: '100%',
              backgroundColor: 'var(--gray)',
              display: 'none',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '30px'
            }}>
              👤
            </div>
          </div>
        </div>
      </div>

      {/* Image Modal */}
      {showImageModal && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999,
            backdropFilter: 'blur(5px)'
          }}
          onClick={() => setShowImageModal(false)}
        >
          <div 
            style={{
              position: 'relative',
              maxWidth: '400px',
              maxHeight: '500px',
              backgroundColor: isDark ? 'var(--dark-gray)' : 'var(--white)',
              borderRadius: '15px',
              padding: '20px',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
              animation: 'modalFadeIn 0.3s ease-out'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowImageModal(false)}
              style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                background: 'rgba(0, 0, 0, 0.5)',
                border: 'none',
                borderRadius: '50%',
                width: '30px',
                height: '30px',
                color: 'white',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
                zIndex: 1
              }}
              title="إغلاق"
            >
              ×
            </button>
            
            <div style={{
              textAlign: 'center',
              marginBottom: '15px'
            }}>
              <h4 style={{ 
                margin: '0 0 5px 0', 
                color: isDark ? 'var(--white)' : '#333333',
                fontSize: '18px'
              }}>
                Hasan Ali Hasan
              </h4>
              <p style={{ 
                margin: '0 0 10px 0', 
                color: isDark ? '#a8c8ec' : '#var(--gray)',
                fontSize: '14px'
              }}>
                System Developer - Alpha Team
              </p>
            </div>
            
            <div style={{
              width: '250px',
              height: '250px',
              margin: '0 auto',
              borderRadius: '15px',
              overflow: 'hidden',
              border: '3px solid #4fc3f7',
              boxShadow: '0 5px 20px rgba(79, 195, 247, 0.3)'
            }}>
              <img 
                src="/hasan-profile.jpg" 
                alt="Hasan Ali Hasan - كبيرة"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
              <div style={{
                width: '100%',
                height: '100%',
                backgroundColor: 'var(--gray)',
                display: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '60px'
              }}>
                👤
              </div>
            </div>
            
            <div style={{
              textAlign: 'center',
              marginTop: '15px'
            }}>
              <p style={{ 
                margin: '0', 
                color: isDark ? '#87ceeb' : '#888888',
                fontSize: '12px',
                fontStyle: 'italic'
              }}>
                اضغط في أي مكان للإغلاق
              </p>
            </div>
          </div>
        </div>
      )}

  <style>{`
        @keyframes modalFadeIn {
          from {
            opacity: 0;
            transform: scale(0.7);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>

      {/* Bottom Row - Copyright and Links */}
      <div className="d-flex flex-column flex-md-row justify-content-between align-items-center py-1 px-3 border-top" style={{ borderTopColor: isDark ? '#444' : '#var(--mid)' }}>
        <small className="text-muted mb-1 mb-md-0" style={{ fontSize: '10px' }}>
          &copy; {currentYear} {companyName} — جميع الحقوق محفوظة.
        </small>
        <div className="d-flex align-items-center flex-wrap gap-2" style={{ fontSize: '10px' }}>
          <span>
            الإصدار: <strong>{version}</strong>
          </span>
          <span>
            بناء: <strong>{buildDateFormatted}</strong>
          </span>
          <a href="/terms" className="text-secondary" aria-label="شروط الخدمة">
            شروط الخدمة
          </a>
          <a href="/privacy" className="text-secondary" aria-label="سياسة الخصوصية">
            سياسة الخصوصية
          </a>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
