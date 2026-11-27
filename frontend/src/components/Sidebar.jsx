// src/components/Sidebar.jsx

import React, { useState, useRef } from 'react';
import PropTypes from 'prop-types';
import { NavLink } from 'react-router-dom';
import useAuth from '../hooks/useAuth';

const NAV_SECTIONS = [
  // 1. عام
  {
    title: 'عام',
    items: [
      { to: '/dashboard', label: 'لوحة التحكم', icon: 'fa-tachometer-alt' },
      { to: '/settings/profile', label: 'الملف الشخصي', icon: 'fa-user' }
    ]
  },
  // 2. الأجهزة (admin فقط)
  {
    title: 'الأجهزة',
    roles: ['admin'],
    items: [
      { to: '/devices',               label: 'قائمة الأجهزة',    icon: 'fa-usb' },
      { to: '/devices/add',           label: 'إضافة جهاز',       icon: 'fa-plus' },
      { to: '/devices/scan',          label: 'مسح الأجهزة',      icon: 'fa-search' },
      { to: '/devices/compatibility', label: 'فحص التوافق',      icon: 'fa-check-circle' },
      { to: '/devices/details',       label: 'تفاصيل الجهاز',    icon: 'fa-info-circle' }
    ]
  },
  // 3. الأمن (admin أو manager)
  {
    title: 'الأمن',
    roles: ['admin', 'manager'],
    items: [
      { to: '/security/whitelist', label: 'القائمة البيضاء', icon: 'fa-list-check' },
      { to: '/security/blacklist', label: 'القائمة السوداء', icon: 'fa-list' },
      { to: '/security/policies',  label: 'السياسات',       icon: 'fa-shield-alt' }
    ]
  },
  // 4. المراقبة
  {
    title: 'المراقبة',
    items: [
      { to: '/monitoring/logs',       label: 'السجلات',       icon: 'fa-clipboard-list', roles: ['admin'] },
      { to: '/monitoring/alerts',     label: 'التنبيهات',     icon: 'fa-bell' },
      { to: '/monitoring/blockchain', label: 'بلوك تشين',     icon: 'fa-link', roles: ['admin'] },
    ]
  },
  // 5. التحليلات
  {
    title: 'التحليلات',
    items: [
      { to: '/analytics/stats',       label: 'إحصائيات',     icon: 'fa-chart-bar' },
      { to: '/analytics/ai-analysis', label: 'تحليل ذكي',    icon: 'fa-brain', roles: ['admin'] }
    ]
  },
  // 6. التقارير
  {
    title: 'التقارير',
    items: [
      { to: '/analytics/reports',     label: 'التقارير',           icon: 'fa-chart-line' },


    ]
  },
  // 7. الإعدادات (admin فقط)
  {
    title: 'الإعدادات',
    roles: ['admin'],
    items: [
      { to: '/settings/system',     label: 'الإعدادات العامة', icon: 'fa-cog' },
      { to: '/settings/activation', label: 'التفعيل',         icon: 'fa-key' },
      { to: '/settings/users',      label: 'المستخدمون',      icon: 'fa-users' },
      // جديد: إعدادات التوافر العالي
      { to: '/settings/ha',         label: 'توافر عالي (HA)', icon: 'fa-server' }
    ]
  },
  // 8. الخوادم (admin فقط)
  {
    title: 'الخوادم',
    roles: ['admin'],
    items: [
      { to: '/servers',                  label: 'قائمة الخوادم',     icon: 'fa-server' },
      { to: '/servers/details',          label: 'تفاصيل الخادم',     icon: 'fa-search' },
      { to: '/servers/heartbeat',        label: 'نبض الخادم',        icon: 'fa-heartbeat' }
    ]
  }
];

const Sidebar = ({ onCollapse }) => {
  const { currentUser, isLoading, isAuthenticated } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const sidebarRef = useRef(null);
  
  const roles = (currentUser?.roles || [currentUser?.role] || [])
    .filter(Boolean)
    .map(r => r.toLowerCase());
  
  // إعلام الـ parent عند تغيير حالة الطي
  const handleCollapse = (newState) => {
    const nextCollapsed = typeof newState === 'function' ? newState(collapsed) : newState;
    setCollapsed(newState);
    if (onCollapse) {
      onCollapse(nextCollapsed);
    }
  };
  
  // If still loading authentication, show loading state
  if (isLoading) {
    return (
      <aside className="sidebar" style={{ width: 270, minHeight: '100vh', background: 'var(--primary-color)' }}>
        <div className="d-flex align-center justify-center p-3" style={{ height: '100%' }}>
          <div className="text-center">
            <i className="fas fa-spinner fa-spin fa-2x text-white mb-2"></i>
            <div className="text-white">جاري التحقق من الصلاحيات...</div>
          </div>
        </div>
      </aside>
    );
  }

  // If not authenticated, don't render sidebar
  if (!isAuthenticated) {
    return null;
  }

  return (
    <aside
      ref={sidebarRef}
      className={`sidebar ${collapsed ? 'collapsed' : ''}`}
      aria-label="الشريط الجانبي"
      style={{
        transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        width: collapsed ? 64 : 270,
        minHeight: '100vh',
        zIndex: 50
      }}
    >
      {/* رأس الشريط */}
      <div className="sidebar-header d-flex align-center justify-between">
        {!collapsed ? (
          <div className="d-flex align-center" style={{ gap: '12px' }}>
            <div className="sidebar-brand-accent" />
            <h3 className="sidebar-title m-0">
              التحكم في النظام
            </h3>
          </div>
        ) : (
          <div className="d-flex align-center justify-content-center w-100">
            <i className="fas fa-shield-alt sidebar-icon-collapsed" />
          </div>
        )}
        {/* زر الإخفاء/الإظهار بشكل واضح ومرتب */}
        <button
          className="btn sidebar-toggle-btn"
          onClick={() => handleCollapse(c => !c)}
          aria-label={collapsed ? 'توسيع الشريط الجانبي' : 'طي الشريط الجانبي'}
          aria-expanded={!collapsed}
          style={{
            border: '2px solid rgba(255,255,255,0.3)',
            outline: 'none',
            background: 'rgba(255,255,255,0.1)',
            color: 'var(--white)',
            borderRadius: '8px',
            width: 40,
            height: 40,
            marginLeft: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            fontWeight: 'bold',
            transition: 'all 0.3s cubic-bezier(.4,0,.2,1)',
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden'
          }}
          onMouseEnter={(e) => {
            e.target.style.background = 'rgba(255,255,255,0.2)';
            e.target.style.transform = 'scale(1.05)';
            e.target.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
          }}
          onMouseLeave={(e) => {
            e.target.style.background = 'rgba(255,255,255,0.1)';
            e.target.style.transform = 'scale(1)';
            e.target.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
          }}
        >
          <span
            style={{
              transition: 'transform 0.3s ease',
              fontSize: '18px',
              fontWeight: 'bold',
              color: 'var(--white)'
            }}
          >
            {collapsed ? '▶' : '◀'}
          </span>
        </button>
      </div>

      {/* قائمة التنقل */}
      <nav className="sidebar-nav p-3" aria-label="قائمة التنقل">
        {NAV_SECTIONS.map((section, si) => {
          if (section.roles && !section.roles.some(r => roles.includes(r.toLowerCase()))) return null;
          const visibleItems = section.items.filter(item =>
            !item.roles || item.roles.some(r => roles.includes(r.toLowerCase()))
          );
          if (visibleItems.length === 0) return null;
          
          return (
            <div key={si} className="sidebar-section mb-3">
              {!collapsed && (
                <div className="sidebar-heading px-4">
                  {section.title}
                </div>
              )}
              <ul className="list-unstyled p-0 m-0">
                {visibleItems.map((item, ii) => (
                  <li key={ii} className="sidebar-item mb-1">
                    <NavLink
                      to={item.to}
                      end
                      className={({ isActive }) =>
                        `sidebar-link d-flex align-center ${isActive ? 'active' : ''}`
                      }
                    >
                      <i className={`fas ${item.icon} sidebar-icon`} aria-hidden="true" />
                      {!collapsed && <span className="sidebar-label">{item.label}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
};

Sidebar.propTypes = {
  onCollapse: PropTypes.func
};

export default Sidebar;
