// src/pages/intrusions/AttackDetails.jsx

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import useAttack from '../../hooks/useAttack';
import useAuth from '../../hooks/useAuth';
import { formatDateTime } from '../../utils/formatters';
import copy from 'copy-to-clipboard';
import { saveAs } from 'file-saver';

// تصميم CSS محسن
const AttackDetails = () => {
  // إضافة CSS مخصص للتصميم الاحترافي
  React.useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .attack-details-page {
        background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
        min-height: 100vh;
        padding: 20px;
      }
      
      .attack-header {
        background: linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%);
        border-radius: 15px;
        padding: 30px;
        color: white;
        margin-bottom: 30px;
        box-shadow: 0 10px 30px rgba(102, 126, 234, 0.3);
      }
      
      .attack-status-badge {
        padding: 8px 16px;
        border-radius: 20px;
        font-weight: 600;
        font-size: 0.9rem;
        letter-spacing: 0.5px;
      }
      
      .severity-critical {
        background: linear-gradient(45deg, #ff6b6b, #ee5a24);
        color: white;
        animation: pulse 2s infinite;
      }
      
      .severity-high {
        background: linear-gradient(45deg, #ffa726, #ff7043);
        color: white;
      }
      
      .severity-medium {
        background: linear-gradient(45deg, #42a5f5, #1e88e5);
        color: white;
      }
      
      .severity-low {
        background: linear-gradient(45deg, #66bb6a, #4caf50);
        color: white;
      }
      
      .action-buttons {
        gap: 12px;
      }
      
      .btn-modern {
        padding: 12px 24px;
        font-weight: 600;
        border-radius: 10px;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        border: none;
        position: relative;
        overflow: hidden;
      }
      
      .btn-modern:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(0,0,0,0.15);
      }
      
      .btn-confirm {
        background: linear-gradient(45deg, #4caf50, #8bc34a);
        color: white;
      }
      
      .btn-confirm:hover {
        background: linear-gradient(45deg, #45a049, #7cb342);
      }
      
      .btn-copy {
        background: linear-gradient(45deg, #2196f3, #21cbf3);
        color: white;
      }
      
      .btn-export {
        background: linear-gradient(45deg, #ff9800, var(--warning-color));
        color: white;
      }
      
      .btn-back {
        background: linear-gradient(45deg, #607d8b, #90a4ae);
        color: white;
      }
      
      .modern-tabs {
        background: white;
        border-radius: 15px;
        padding: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        margin-bottom: 30px;
      }
      
      .modern-tab {
        padding: 12px 24px;
        border-radius: 10px;
        border: none;
        background: transparent;
        color: #666;
        font-weight: 600;
        transition: all 0.3s ease;
        margin: 0 4px;
      }
      
      .modern-tab.active {
        background: linear-gradient(45deg, var(--primary-color), var(--dark-gray));
        color: white;
        transform: translateY(-2px);
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
      }
      
      .info-card {
        background: white;
        border-radius: 15px;
        padding: 25px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.1);
        margin-bottom: 20px;
        border: none;
        transition: all 0.3s ease;
      }
      
      .info-card:hover {
        transform: translateY(-5px);
        box-shadow: 0 15px 40px rgba(0,0,0,0.15);
      }
      
      .info-section {
        padding: 20px;
        border-radius: 10px;
        margin-bottom: 20px;
        border-left: 4px solid var(--primary-color);
        background: linear-gradient(145deg, #f8f9ff, var(--white));
      }
      
      .info-label {
        font-weight: 700;
        color: #333;
        font-size: 1rem;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
      }
      
      .info-label i {
        margin-left: 8px;
        color: var(--primary-color);
      }
      
      .info-value {
        color: #555;
        font-size: 0.95rem;
        line-height: 1.6;
        padding: 8px 12px;
        background: rgba(102, 126, 234, 0.05);
        border-radius: 8px;
        border: 1px solid rgba(102, 126, 234, 0.1);
      }
      
      .code-block {
        background: linear-gradient(145deg, var(--text-primary), #1a202c);
        color: var(--mid);
        border-radius: 10px;
        padding: 20px;
        font-family: 'Consolas', 'Monaco', monospace;
        font-size: 0.9rem;
        line-height: 1.6;
        overflow-x: auto;
        border: 1px solid var(--gray);
      }
      
      .timeline-item {
        position: relative;
        padding: 15px 0 15px 40px;
        border-left: 3px solid var(--primary-color);
      }
      
      .timeline-item::before {
        content: '';
        position: absolute;
        left: -8px;
        top: 20px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--primary-color);
      }
      
      .recommendation-item {
        background: linear-gradient(145deg, #f0fff4, var(--white));
        border-left: 4px solid #4caf50;
        padding: 15px 20px;
        margin-bottom: 12px;
        border-radius: 8px;
        transition: all 0.3s ease;
      }
      
      .recommendation-item:hover {
        transform: translateX(5px);
        box-shadow: 0 4px 15px rgba(76, 175, 80, 0.2);
      }
      
      .loading-spinner {
        background: white;
        border-radius: 15px;
        padding: 60px;
        text-align: center;
        box-shadow: 0 8px 30px rgba(0,0,0,0.1);
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
      
      .floating-actions {
        position: fixed;
        bottom: 30px;
        left: 30px;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      
      .floating-btn {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        border: none;
        position: relative;
        overflow: hidden;
        cursor: pointer;
      }
      
      .floating-btn:hover {
        transform: scale(1.1) translateY(-2px);
        box-shadow: 0 8px 30px rgba(0,0,0,0.4);
      }
      
      .floating-btn::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: inherit;
        border-radius: inherit;
        filter: blur(8px);
        opacity: 0.3;
        z-index: -1;
      }
      
      .floating-scroll-top {
        background: linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%);
        color: white;
      }
      
      .floating-print {
        background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
        color: white;
      }
      
      .floating-actions-container {
        position: fixed;
        bottom: 30px;
        left: 30px;
        z-index: 1000;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      .floating-trigger {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%);
        color: white;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }
      
      .floating-trigger::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(135deg, rgba(255,255,255,0.2), transparent);
        border-radius: inherit;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      
      .floating-trigger:hover::before {
        opacity: 1;
      }
      
      .floating-trigger:hover {
        transform: scale(1.05) translateY(-2px);
        box-shadow: 0 12px 35px rgba(102, 126, 234, 0.5);
      }
      
      .floating-trigger .fa-cog {
        transition: transform 0.3s ease;
      }
      
      .floating-trigger:hover .fa-cog {
        transform: rotate(90deg);
      }
      
      .floating-actions-container:hover .floating-menu {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
      }
      
      .floating-menu {
        position: absolute;
        bottom: 70px;
        left: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 20px;
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(15px);
        border-radius: 20px;
        border: 1px solid rgba(255, 255, 255, 0.3);
        box-shadow: 0 15px 50px rgba(0, 0, 0, 0.2);
        min-width: 220px;
        opacity: 0;
        visibility: hidden;
        transform: translateY(20px) scale(0.95);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 1001;
      }
      
      .floating-menu::before {
        content: '';
        position: absolute;
        bottom: -8px;
        left: 20px;
        width: 16px;
        height: 16px;
        background: rgba(255, 255, 255, 0.95);
        transform: rotate(45deg);
        border-right: 1px solid rgba(255, 255, 255, 0.3);
        border-bottom: 1px solid rgba(255, 255, 255, 0.3);
      }
      
      .floating-btn-enhanced {
        display: flex;
        align-items: center;
        padding: 12px 18px;
        border-radius: 25px;
        border: none;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        text-decoration: none;
        width: 100%;
        justify-content: flex-start;
        gap: 12px;
        font-weight: 500;
        font-size: 0.9rem;
        position: relative;
        overflow: hidden;
      }
      
      .floating-btn-enhanced::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
        transition: left 0.5s ease;
      }
      
      .floating-btn-enhanced:hover::before {
        left: 100%;
      }
      
      .floating-btn-enhanced:hover {
        transform: translateX(8px) scale(1.02);
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
      }
      
      .floating-btn-enhanced i {
        font-size: 1.1rem;
        width: 20px;
        text-align: center;
        transition: transform 0.3s ease;
      }
      
      .floating-btn-enhanced:hover i {
        transform: scale(1.1);
      }
      
      .menu-header {
        text-align: center;
        margin-bottom: 15px;
        padding-bottom: 10px;
        border-bottom: 2px solid rgba(102, 126, 234, 0.1);
        position: relative;
      }
      
      .menu-header h6 {
        color: var(--primary-color);
        font-weight: 700;
        font-size: 1rem;
        margin: 0;
        letter-spacing: 0.5px;
      }
      
      .success-notification {
        background: linear-gradient(135deg, #d4edda, #c3e6cb);
        border: 1px solid #b3d7d3;
        color: #155724;
        padding: 10px 15px;
        border-radius: 15px;
        font-size: 0.85rem;
        margin-top: 10px;
        animation: slideIn 0.3s ease, fadeOut 0.3s ease 1.7s forwards;
      }
      
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      @keyframes fadeOut {
        to {
          opacity: 0;
          transform: translateY(-10px);
        }
      }
      
      .btn-scroll-top {
        background: linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%);
        color: white;
      }
      
      .btn-scroll-top:hover {
        background: linear-gradient(135deg, #5a67d8 0%, #6b46c1 100%);
        color: white;
      }
      
      .btn-print-page {
        background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
        color: white;
      }
      
      .btn-print-page:hover {
        background: linear-gradient(135deg, #3182ce 0%, #00b4db 100%);
        color: white;
      }
      
      .btn-share-page {
        background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
        color: white;
      }
      
      .btn-share-page:hover {
        background: linear-gradient(135deg, #38a169 0%, #319795 100%);
        color: white;
      }
      
      .btn-bookmark {
        background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
        color: white;
      }
      
      .btn-bookmark:hover {
        background: linear-gradient(135deg, #e53e3e 0%, #dd6b20 100%);
        color: white;
      }
      
      @media (max-width: 768px) {
        .floating-actions-container {
          bottom: 20px;
          left: 20px;
        }
        
        .floating-menu {
          padding: 15px;
        }
        
        .floating-btn-enhanced {
          padding: 10px 15px;
          min-width: 150px;
          font-size: 0.9rem;
        }
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';

  const {
    fetchAttackDetails,
    confirmAttack,
    isLoading,
    error,
    clearError
  } = useAttack();

  const [attack, setAttack] = useState(null);
  const [activeTab, setActiveTab] = useState('overview'); // overview | evidence | recommendations
  const [copySuccess, setCopySuccess] = useState('');

  // جلب بيانات الحدث عند التحميل
  useEffect(() => {
    clearError();
    (async () => {
      try {
        const data = await fetchAttackDetails(id);
        setAttack(data);
      } catch {
        // الخطأ يعرضه الهوك
      }
    })();
  }, [id, fetchAttackDetails, clearError]);

  // تأكيد الحدث
  const handleConfirm = useCallback(async () => {
    if (!window.confirm('هل أنت متأكد من تأكيد هذا الحدث؟')) return;
    try {
      await confirmAttack(id);
      navigate('/intrusions');
    } catch {
      // الخطأ يعرضه الهوك
    }
  }, [confirmAttack, id, navigate]);

  // نسخ المعرف
  const handleCopy = useCallback(() => {
    if (attack?.id) {
      copy(`${attack.id}`);
      setCopySuccess('تم نسخ المعرف!');
      setTimeout(() => setCopySuccess(''), 2000);
    }
  }, [attack]);

  // تصدير تقرير الهجوم كـ JSON
  const handleExportJSON = () => {
    if (attack) {
      const blob = new Blob([JSON.stringify(attack, null, 2)], { type: 'application/json' });
      saveAs(blob, `attack_${attack.id}.json`);
    }
  };
  // تصدير تقرير الهجوم كـ CSV (بسيط)
  const handleExportCSV = () => {
    if (attack) {
      const csv = Object.entries(attack).map(([k, v]) => `${k},"${String(v).replace(/"/g, '""')}"`).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      saveAs(blob, `attack_${attack.id}.csv`);
    }
  };

  if (isLoading || !attack) {
    return (
      <div className="attack-details-page">
        <div className="loading-spinner">
          <div className="spinner-border text-primary mb-3" role="status" style={{ width: '3rem', height: '3rem' }}>
            <span className="visually-hidden">Loading...</span>
          </div>
          <h5 className="text-primary">جاري تحميل تفاصيل الهجمة...</h5>
          <p className="text-muted">يرجى الانتظار بينما نقوم بجلب البيانات</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="attack-details-page">
        <div className="info-card">
          <div className="alert alert-danger border-0" style={{ borderRadius: '15px' }}>
            <div className="d-flex align-items-center">
              <i className="fas fa-exclamation-triangle fs-2 me-3"></i>
              <div>
                <h5 className="mb-1">خطأ في تحميل البيانات</h5>
                <p className="mb-0">{error}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // استخدام البيانات مباشرة من attack object
  const details = attack.details || {};
  const recommendations = attack.recommendations || [];

  return (
    <div className="attack-details-page">
      {/* Header Section المحسن */}
      <div className="attack-header">
        <div className="row align-items-center">
          <div className="col-md-8">
            <div className="d-flex align-items-center mb-3">
              <div className="me-3">
                <i className="fas fa-shield-alt fs-1"></i>
              </div>
              <div>
                <h1 className="mb-1 fw-bold">تفاصيل حدث الهجوم</h1>
                <div className="d-flex align-items-center">
                  <span className="badge bg-light text-dark me-2">#{attack.id}</span>
                  <span className={`attack-status-badge severity-${attack.severity || 'medium'}`}>
                    <i className="fas fa-exclamation-triangle me-1"></i>
                    {attack.severity === 'critical' ? 'حرج' : 
                     attack.severity === 'high' ? 'عالي' : 
                     attack.severity === 'medium' ? 'متوسط' : 'منخفض'}
                  </span>
                  <span className={`attack-status-badge ms-2 ${attack.confirmed ? 'bg-success' : 'bg-warning text-dark'}`}>
                    <i className={`fas ${attack.confirmed ? 'fa-check-circle' : 'fa-clock'} me-1`}></i>
                    {attack.confirmed ? 'مؤكد' : 'قيد المراجعة'}
                  </span>
                </div>
              </div>
            </div>
            <p className="mb-0 opacity-90">
              <i className="fas fa-clock me-2"></i>
              تم اكتشافه في: {formatDateTime(attack.timestamp)}
            </p>
          </div>
          <div className="col-md-4 text-end">
            <div className="action-buttons d-flex flex-wrap justify-content-end">
              {isAdmin && !attack.confirmed && (
                <button className="btn btn-modern btn-confirm mb-2" onClick={handleConfirm}>
                  <i className="fas fa-check me-2"></i>
                  تأكيد الهجمة
                </button>
              )}
              <button
                className="btn btn-modern btn-copy mb-2"
                onClick={handleCopy}
                title="نسخ معرف الهجمة"
              >
                <i className="fas fa-copy me-2"></i>
                نسخ المعرف
              </button>
              <Link to="/intrusions" className="btn btn-modern btn-back mb-2">
                <i className="fas fa-arrow-right me-2"></i>
                العودة للقائمة
              </Link>
            </div>
            {copySuccess && (
              <div className="alert alert-success mt-2 mb-0" style={{ fontSize: '0.9rem' }}>
                <i className="fas fa-check me-1"></i> {copySuccess}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Tabs المحسنة */}
      <div className="modern-tabs">
        <div className="d-flex justify-content-center">
          {[
            { key: 'overview', label: 'نظرة عامة', icon: 'fas fa-eye' },
            { key: 'evidence', label: 'الأدلة والتفاصيل', icon: 'fas fa-search' },
            { key: 'recommendations', label: 'التوصيات والحلول', icon: 'fas fa-lightbulb' }
          ].map(tab => (
            <button
              key={tab.key}
              className={`modern-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <i className={`${tab.icon} me-2`}></i>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content المحسن */}
      {activeTab === 'overview' && (
        <div className="info-card">
          <div className="row">
            {/* المعلومات الأساسية */}
            <div className="col-lg-6 mb-4">
              <div className="info-section">
                <h5 className="info-label">
                  <i className="fas fa-info-circle"></i>
                  معلومات الهجمة الأساسية
                </h5>
                <div className="row g-3">
                  <div className="col-12">
                    <label className="fw-bold text-muted">نوع الهجوم</label>
                    <div className="info-value">
                      <i className="fas fa-bug me-2 text-danger"></i>
                      {attack.attack_type || 'غير محدد'}
                    </div>
                  </div>
                  <div className="col-12">
                    <label className="fw-bold text-muted">الوصف</label>
                    <div className="info-value">
                      {attack.description || 'لا يوجد وصف متاح'}
                    </div>
                  </div>
                  <div className="col-12">
                    <label className="fw-bold text-muted">الهدف المستهدف</label>
                    <div className="info-value">
                      <i className="fas fa-crosshairs me-2 text-warning"></i>
                      {attack.target_device || 'غير محدد'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* معلومات المصدر */}
            <div className="col-lg-6 mb-4">
              <div className="info-section">
                <h5 className="info-label">
                  <i className="fas fa-map-marker-alt"></i>
                  معلومات المصدر
                </h5>
                <div className="row g-3">
                  <div className="col-12">
                    <label className="fw-bold text-muted">عنوان IP</label>
                    <div className="info-value">
                      <i className="fas fa-globe me-2 text-primary"></i>
                      {attack.source_ip || 'غير معروف'}
                    </div>
                  </div>
                  <div className="col-12">
                    <label className="fw-bold text-muted">عنوان MAC</label>
                    <div className="info-value">
                      <i className="fas fa-network-wired me-2 text-info"></i>
                      {attack.source_mac || 'غير معروف'}
                    </div>
                  </div>
                  <div className="col-12">
                    <label className="fw-bold text-muted">الموقع الجغرافي</label>
                    <div className="info-value">
                      <i className="fas fa-map me-2 text-success"></i>
                      {attack.geo_location || 'غير محدد'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* معلومات الشبكة */}
            <div className="col-lg-6 mb-4">
              <div className="info-section">
                <h5 className="info-label">
                  <i className="fas fa-network-wired"></i>
                  تفاصيل الشبكة والخدمة
                </h5>
                <div className="row g-3">
                  <div className="col-6">
                    <label className="fw-bold text-muted">المنفذ</label>
                    <div className="info-value">
                      <i className="fas fa-plug me-2 text-secondary"></i>
                      {attack.port || 'غير محدد'}
                    </div>
                  </div>
                  <div className="col-6">
                    <label className="fw-bold text-muted">الخدمة</label>
                    <div className="info-value">
                      <i className="fas fa-cogs me-2 text-secondary"></i>
                      {attack.service || 'غير محدد'}
                    </div>
                  </div>
                  <div className="col-12">
                    <label className="fw-bold text-muted">الثغرة المستغلة</label>
                    <div className="info-value">
                      <i className="fas fa-shield-alt me-2 text-danger"></i>
                      {attack.vulnerability || 'غير محدد'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* معلومات الاستغلال */}
            <div className="col-lg-6 mb-4">
              <div className="info-section">
                <h5 className="info-label">
                  <i className="fas fa-user-secret"></i>
                  تحليل المهاجم
                </h5>
                <div className="row g-3">
                  <div className="col-12">
                    <label className="fw-bold text-muted">طريقة الاستغلال</label>
                    <div className="info-value">
                      <i className="fas fa-hammer me-2 text-danger"></i>
                      {attack.exploit || 'غير محدد'}
                    </div>
                  </div>
                  <div className="col-12">
                    <label className="fw-bold text-muted">بروفايل المهاجم</label>
                    <div className="code-block" style={{ fontSize: '0.85rem', maxHeight: '100px', overflowY: 'auto' }}>
                      {attack.attacker_profile || 'لا توجد معلومات متاحة عن المهاجم'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* الجدول الزمني */}
            <div className="col-12 mb-4">
              <div className="info-section">
                <h5 className="info-label">
                  <i className="fas fa-clock"></i>
                  الجدول الزمني للهجوم
                </h5>
                <div className="timeline-item">
                  <div className="code-block" style={{ fontSize: '0.9rem' }}>
                    {attack.timeline || 'لا يوجد جدول زمني مفصل'}
                  </div>
                </div>
              </div>
            </div>

            {/* التحليل الجنائي */}
            <div className="col-12 mb-4">
              <div className="info-section">
                <h5 className="info-label">
                  <i className="fas fa-microscope"></i>
                  التحليل الجنائي والذكي
                </h5>
                <div className="code-block">
                  {attack.analysis || 'لا يوجد تحليل مفصل متاح'}
                </div>
              </div>
            </div>

            {/* أزرار الإجراءات */}
            <div className="col-12">
              <div className="d-flex flex-wrap gap-3 justify-content-center">
                <button className="btn btn-modern btn-copy" onClick={handleCopy}>
                  <i className="fas fa-copy me-2"></i>
                  نسخ معرف الهجمة
                </button>
                <button className="btn btn-modern btn-export" onClick={handleExportJSON}>
                  <i className="fas fa-download me-2"></i>
                  تصدير JSON
                </button>
                <button className="btn btn-modern btn-export" onClick={handleExportCSV}>
                  <i className="fas fa-file-csv me-2"></i>
                  تصدير CSV
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'evidence' && (
        <div className="info-card">
          <div className="info-section">
            <h5 className="info-label">
              <i className="fas fa-search"></i>
              الأدلة والتفاصيل التقنية
            </h5>
            {Object.keys(details).length === 0 ? (
              <div className="text-center py-5">
                <div className="mb-3">
                  <i className="fas fa-search fs-1 text-muted opacity-50"></i>
                </div>
                <h6 className="text-muted">لا توجد أدلة مفصلة</h6>
                <p className="text-muted small">
                  لم يتم العثور على أدلة تقنية مفصلة لهذا الحدث الأمني
                </p>
              </div>
            ) : (
              <div>
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <span className="badge bg-info">
                    <i className="fas fa-database me-1"></i>
                    {Object.keys(details).length} عنصر من الأدلة
                  </span>
                  <button 
                    className="btn btn-modern btn-export btn-sm"
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(details, null, 2)], { type: 'application/json' });
                      saveAs(blob, `attack_evidence_${attack.id}.json`);
                    }}
                  >
                    <i className="fas fa-download me-1"></i>
                    تصدير الأدلة
                  </button>
                </div>
                <div className="code-block" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                  {JSON.stringify(details, null, 2)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'recommendations' && (
        <div className="info-card">
          <div className="info-section">
            <h5 className="info-label">
              <i className="fas fa-lightbulb"></i>
              التوصيات والإجراءات المقترحة
            </h5>
            {recommendations.length === 0 ? (
              <div className="text-center py-5">
                <div className="mb-3">
                  <i className="fas fa-lightbulb fs-1 text-muted opacity-50"></i>
                </div>
                <h6 className="text-muted">لا توجد توصيات</h6>
                <p className="text-muted small">
                  لم يتم إنشاء توصيات أمنية لهذا الحدث بعد
                </p>
                <button className="btn btn-modern btn-copy">
                  <i className="fas fa-plus me-2"></i>
                  إضافة توصية جديدة
                </button>
              </div>
            ) : (
              <div>
                <div className="d-flex justify-content-between align-items-center mb-4">
                  <span className="badge bg-success">
                    <i className="fas fa-check-circle me-1"></i>
                    {recommendations.length} توصية متاحة
                  </span>
                  <div className="btn-group">
                    <button className="btn btn-modern btn-export btn-sm">
                      <i className="fas fa-print me-1"></i>
                      طباعة التوصيات
                    </button>
                    <button className="btn btn-modern btn-copy btn-sm">
                      <i className="fas fa-share me-1"></i>
                      مشاركة
                    </button>
                  </div>
                </div>
                <div className="recommendations-list">
                  {recommendations.map((rec, i) => (
                    <div key={i} className="recommendation-item">
                      <div className="d-flex align-items-start">
                        <div className="me-3 mt-1">
                          <div 
                            className="rounded-circle bg-success d-flex align-items-center justify-content-center"
                            style={{ width: '32px', height: '32px', minWidth: '32px' }}
                          >
                            <span className="text-white fw-bold" style={{ fontSize: '0.8rem' }}>
                              {i + 1}
                            </span>
                          </div>
                        </div>
                        <div className="flex-grow-1">
                          <div className="d-flex justify-content-between align-items-start mb-2">
                            <h6 className="mb-0 fw-bold text-success">
                              توصية رقم {i + 1}
                            </h6>
                            <div className="btn-group btn-group-sm">
                              <button 
                                className="btn btn-outline-success btn-sm"
                                onClick={() => {
                                  copy(rec);
                                  setCopySuccess(`تم نسخ التوصية ${i + 1}`);
                                  setTimeout(() => setCopySuccess(''), 2000);
                                }}
                              >
                                <i className="fas fa-copy"></i>
                              </button>
                              <button className="btn btn-outline-primary btn-sm">
                                <i className="fas fa-check"></i>
                              </button>
                            </div>
                          </div>
                          <p className="mb-0 text-dark" style={{ lineHeight: '1.6' }}>
                            {rec}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* إجراءات إضافية */}
                <div className="mt-4 p-4 bg-light rounded-3">
                  <h6 className="fw-bold mb-3">
                    <i className="fas fa-tools me-2"></i>
                    إجراءات سريعة
                  </h6>
                  <div className="row g-2">
                    <div className="col-md-4">
                      <button className="btn btn-modern btn-confirm w-100">
                        <i className="fas fa-shield-alt me-2"></i>
                        تطبيق كافة التوصيات
                      </button>
                    </div>
                    <div className="col-md-4">
                      <button className="btn btn-modern btn-copy w-100">
                        <i className="fas fa-file-alt me-2"></i>
                        إنشاء تقرير مفصل
                      </button>
                    </div>
                    <div className="col-md-4">
                      <button className="btn btn-modern btn-export w-100">
                        <i className="fas fa-bell me-2"></i>
                        إنشاء تنبيه
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* زر الإجراءات السريعة المحسن مع hover */}
      <div className="floating-actions-container">
        {/* الزر الرئيسي */}
        <button className="floating-trigger" title="الإجراءات السريعة">
          <i className="fas fa-cog"></i>
        </button>
        
        {/* القائمة التي تظهر عند hover */}
        <div className="floating-menu">
          <div className="menu-header">
            <h6>الإجراءات السريعة</h6>
          </div>
          
          <button 
            className="floating-btn-enhanced btn-scroll-top"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            title="العودة للأعلى"
          >
            <i className="fas fa-arrow-up"></i>
            <span>العودة للأعلى</span>
          </button>
          
          <button 
            className="floating-btn-enhanced btn-print-page"
            onClick={() => window.print()}
            title="طباعة الصفحة"
          >
            <i className="fas fa-print"></i>
            <span>طباعة الصفحة</span>
          </button>
          
          <button 
            className="floating-btn-enhanced btn-share-page"
            onClick={() => {
              if (navigator.share) {
                navigator.share({
                  title: `تفاصيل الهجمة #${attack.id}`,
                  text: `هجمة من نوع: ${attack.attack_type}`,
                  url: window.location.href
                });
              } else {
                // نسخ الرابط إلى الحافظة
                navigator.clipboard.writeText(window.location.href);
                setCopySuccess('تم نسخ الرابط!');
                setTimeout(() => setCopySuccess(''), 2000);
              }
            }}
            title="مشاركة الصفحة"
          >
            <i className="fas fa-share-alt"></i>
            <span>مشاركة</span>
          </button>
          
          <button 
            className="floating-btn-enhanced btn-bookmark"
            onClick={() => {
              // إضافة إلى المفضلة أو حفظ محلياً
              const bookmarks = JSON.parse(localStorage.getItem('attack_bookmarks') || '[]');
              const bookmark = {
                id: attack.id,
                type: attack.attack_type,
                severity: attack.severity,
                timestamp: attack.timestamp,
                url: window.location.href
              };
              
              if (!bookmarks.find(b => b.id === attack.id)) {
                bookmarks.push(bookmark);
                localStorage.setItem('attack_bookmarks', JSON.stringify(bookmarks));
                setCopySuccess('تم إضافة للمفضلة!');
              } else {
                setCopySuccess('موجود بالفعل في المفضلة!');
              }
              setTimeout(() => setCopySuccess(''), 2000);
            }}
            title="إضافة للمفضلة"
          >
            <i className="fas fa-bookmark"></i>
            <span>حفظ</span>
          </button>
          
          {copySuccess && (
            <div className="success-notification">
              <i className="fas fa-check-circle me-2"></i>
              {copySuccess}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AttackDetails;
