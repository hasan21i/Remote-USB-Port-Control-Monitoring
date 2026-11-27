// src/pages/intrusions/AttackList.jsx

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import useAttack from '../../hooks/useAttack';
import useAuth from '../../hooks/useAuth';
import useSocket from '../../hooks/useSocket';
import { toast } from 'react-toastify';
import { formatDateTime } from '../../utils/formatters';
import { exportAttacks } from '../../utils/api';
import { saveAs } from 'file-saver';

const PAGE_SIZE = 10;

const AttackListComponent = () => {
  // إضافة CSS مخصص للتصميم الاحترافي
  React.useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .attack-list-page {
        background: linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%);
        min-height: 100vh;
        padding: 20px;
        position: relative;
        overflow-x: hidden;
      }
      
      .attack-list-page::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: 
          radial-gradient(circle at 20% 50%, rgba(120, 119, 198, 0.3) 0%, transparent 50%),
          radial-gradient(circle at 80% 20%, rgba(255, 119, 198, 0.3) 0%, transparent 50%),
          radial-gradient(circle at 40% 80%, rgba(120, 219, 255, 0.3) 0%, transparent 50%);
        pointer-events: none;
        z-index: 0;
      }
      
      .attack-list-content {
        position: relative;
        z-index: 1;
      }
      
      .professional-header {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 20px;
        padding: 40px;
        margin-bottom: 30px;
        box-shadow: 
          0 20px 60px rgba(0, 0, 0, 0.1),
          0 8px 25px rgba(0, 0, 0, 0.08),
          inset 0 1px 0 rgba(255, 255, 255, 0.6);
        position: relative;
        overflow: hidden;
      }
      
      .professional-header::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: linear-gradient(90deg, var(--primary-color), var(--dark-gray), #f093fb, #f5576c);
        border-radius: 20px 20px 0 0;
      }
      
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 20px;
        margin-bottom: 30px;
      }
      
      .stat-card {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 15px;
        padding: 25px;
        text-align: center;
        transition: all 0.3s ease;
        position: relative;
        overflow: hidden;
      }
      
      .stat-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: var(--card-color, var(--primary-color));
        border-radius: 15px 15px 0 0;
      }
      
      .stat-card:hover {
        transform: translateY(-5px);
        box-shadow: 0 15px 40px rgba(0, 0, 0, 0.15);
      }
      
      .stat-number {
        font-size: 2.5rem;
        font-weight: 800;
        margin-bottom: 10px;
        background: linear-gradient(135deg, var(--card-color, var(--primary-color)), var(--card-color-light, var(--dark-gray)));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      
      .stat-label {
        color: #666;
        font-weight: 600;
        font-size: 0.9rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      
      .filters-panel {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 20px;
        padding: 30px;
        margin-bottom: 30px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
      }
      
      .modern-input {
        border: 2px solid var(--mid);
        border-radius: 12px;
        padding: 12px 16px;
        font-size: 14px;
        transition: all 0.3s ease;
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(10px);
      }
      
      .modern-input:focus {
        border-color: var(--primary-color);
        box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        outline: none;
        background: white;
      }
      
      .modern-select {
        border: 2px solid var(--mid);
        border-radius: 12px;
        padding: 12px 16px;
        font-size: 14px;
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(10px);
        transition: all 0.3s ease;
      }
      
      .modern-select:focus {
        border-color: var(--primary-color);
        box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        outline: none;
      }
      
      .modern-btn {
        border: none;
        border-radius: 12px;
        padding: 12px 24px;
        font-weight: 600;
        font-size: 14px;
        transition: all 0.3s ease;
        position: relative;
        overflow: hidden;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        cursor: pointer;
        text-decoration: none;
        display: inline-block;
      }
      
      .modern-btn::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
        transition: left 0.5s ease;
      }
      
      .modern-btn:hover::before {
        left: 100%;
      }
      
      .modern-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
        text-decoration: none;
      }
      
      .btn-primary-modern {
        background: linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%);
        color: white;
      }
      
      .btn-success-modern {
        background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
        color: white;
      }
      
      .btn-export-modern {
        background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
        color: white;
      }
      
      .attacks-table-container {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 20px;
        padding: 0;
        margin-bottom: 30px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        overflow: hidden;
      }
      
      .professional-table {
        margin: 0;
        border: none;
        width: 100%;
      }
      
      .professional-table thead th {
        background: linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%);
        color: white;
        border: none;
        padding: 20px 15px;
        font-weight: 700;
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        position: relative;
      }
      
      .professional-table tbody tr {
        transition: all 0.3s ease;
        border: none;
        border-bottom: 1px solid rgba(0, 0, 0, 0.05);
      }
      
      .professional-table tbody tr:hover {
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
        transform: scale(1.01);
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
      }
      
      .professional-table tbody td {
        padding: 20px 15px;
        border: none;
        vertical-align: middle;
        font-size: 0.9rem;
      }
      
      .severity-badge {
        padding: 6px 12px;
        border-radius: 20px;
        font-weight: 700;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border: 2px solid transparent;
        position: relative;
        overflow: hidden;
      }
      
      .severity-critical {
        background: linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%);
        color: white;
        animation: pulse 2s infinite;
      }
      
      .severity-high {
        background: linear-gradient(135deg, #ffa726 0%, #fb8c00 100%);
        color: white;
      }
      
      .severity-medium {
        background: linear-gradient(135deg, #42a5f5 0%, #1e88e5 100%);
        color: white;
      }
      
      .severity-low {
        background: linear-gradient(135deg, #66bb6a 0%, #43a047 100%);
        color: white;
      }
      
      .status-badge {
        padding: 6px 12px;
        border-radius: 20px;
        font-weight: 600;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      
      .status-confirmed {
        background: linear-gradient(135deg, #4caf50 0%, #45a049 100%);
        color: white;
      }
      
      .status-pending {
        background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
        color: white;
      }
      
      .action-btn {
        border: none;
        border-radius: 8px;
        padding: 8px 12px;
        margin: 0 2px;
        font-size: 0.8rem;
        transition: all 0.3s ease;
        position: relative;
        overflow: hidden;
        cursor: pointer;
        text-decoration: none;
        display: inline-block;
      }
      
      .action-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        text-decoration: none;
      }
      
      .btn-view {
        background: linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%);
        color: white;
      }
      
      .btn-confirm {
        background: linear-gradient(135deg, #4caf50 0%, #45a049 100%);
        color: white;
      }
      
      .pagination-modern {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 15px;
        padding: 20px;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 10px;
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
        margin-bottom: 30px;
      }
      
      .page-btn {
        border: 2px solid var(--mid);
        border-radius: 8px;
        padding: 8px 12px;
        margin: 0 2px;
        background: white;
        color: var(--primary-color);
        font-weight: 600;
        transition: all 0.3s ease;
        cursor: pointer;
      }
      
      .page-btn:hover, .page-btn.active {
        background: linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%);
        color: white;
        border-color: var(--primary-color);
        transform: translateY(-2px);
      }
      
      .page-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }
      
      .empty-state {
        text-align: center;
        padding: 60px 20px;
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 20px;
        margin-bottom: 30px;
      }
      
      .empty-icon {
        font-size: 4rem;
        color: var(--primary-color);
        margin-bottom: 20px;
      }
      
      .loading-state {
        text-align: center;
        padding: 60px 20px;
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 20px;
        margin-bottom: 30px;
      }
      
      .loading-spinner {
        width: 50px;
        height: 50px;
        border: 4px solid #f3f3f3;
        border-top: 4px solid var(--primary-color);
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 20px;
      }
      
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
      
      .floating-refresh {
        position: fixed;
        bottom: 30px;
        right: 30px;
        z-index: 1000;
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
        transition: all 0.3s ease;
      }
      
      .floating-refresh:hover {
        transform: scale(1.1) translateY(-2px);
        box-shadow: 0 12px 35px rgba(102, 126, 234, 0.5);
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  const { attacks, isLoading, error, lastUpdate, fetchAttacks, confirmAttack } = useAttack();
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';

  // فلترة وبحث
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | confirmed | unconfirmed
  const [typeFilter, setTypeFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [serverFilter, setServerFilter] = useState('');
  const [portFilter, setPortFilter] = useState('');

  // صفحة حالية
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetchAttacks();
  }, [fetchAttacks]);

  // استقبال أحداث WebSocket
  const { subscribe: subscribeSocket, isConnected } = useSocket();

  useEffect(() => {
    if (!isConnected) return;

    const unsubscribeAttack = subscribeSocket('attack:detected', (data) => {
      if (data && data.port) {
        toast.error(`🚨 هجوم جديد على منفذ ${data.port} (${data.attack_type || ''}) من ${data.source_ip || '-'} | الشدة: ${data.severity || '-'} `, { autoClose: 10000, position: 'top-right' });
      }
    });

    return () => {
      unsubscribeAttack?.();
    };
  }, [subscribeSocket, isConnected]);

  const handleConfirm = useCallback(async (id) => {
    if (!window.confirm('هل أنت متأكد من تأكيد هذا الحدث؟')) return;
    await confirmAttack(id);
    fetchAttacks();
  }, [confirmAttack, fetchAttacks]);

  // حساب الإحصائيات
  const stats = useMemo(() => {
    if (!attacks?.length) return { total: 0, confirmed: 0, critical: 0, pending: 0 };
    
    return {
      total: attacks.length,
      confirmed: attacks.filter(a => a.confirmed).length,
      critical: attacks.filter(a => a.severity === 'critical').length,
      pending: attacks.filter(a => !a.confirmed).length
    };
  }, [attacks]);

  const attackTypes = useMemo(() => {
    return [...new Set((attacks || []).map(a => a.attack_type).filter(Boolean))];
  }, [attacks]);

  const handleExport = useCallback(async () => {
    try {
      const data = await exportAttacks();
      const blob = new Blob([data], { type: 'text/csv;charset=utf-8' });
      saveAs(blob, `attacks-${new Date().toISOString().split('T')[0]}.csv`);
    } catch (err) {
      console.error('Export failed:', err);
      toast.error('فشل في تصدير البيانات');
    }
  }, []);

  const filtered = useMemo(() => {
    let list = attacks || [];
    if (statusFilter === 'confirmed') list = list.filter(a => a.confirmed);
    if (statusFilter === 'unconfirmed') list = list.filter(a => !a.confirmed);
    if (typeFilter) list = list.filter(a => a.attack_type === typeFilter);
    if (severityFilter) list = list.filter(a => a.severity === severityFilter);
    if (serverFilter) list = list.filter(a => (a.target_device || '').toLowerCase().includes(serverFilter.toLowerCase()));
    if (portFilter) list = list.filter(a => (a.port || '').toString().includes(portFilter));
    if (fromDate) list = list.filter(a => new Date(a.timestamp) >= new Date(fromDate));
    if (toDate) list = list.filter(a => new Date(a.timestamp) <= new Date(toDate + ' 23:59:59'));
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter(a => 
        (a.description || '').toLowerCase().includes(term) ||
        (a.attack_type || '').toLowerCase().includes(term) ||
        (a.source_ip || '').toLowerCase().includes(term) ||
        (a.target_device || '').toLowerCase().includes(term)
      );
    }
    return list;
  }, [attacks, statusFilter, typeFilter, severityFilter, serverFilter, portFilter, fromDate, toDate, searchTerm]);

  const pageData = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  if (isLoading) {
    return (
      <div className="attack-list-page">
        <div className="attack-list-content">
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <h3 style={{ color: 'var(--primary-color)', marginBottom: '10px' }}>جاري تحميل أحداث الهجوم</h3>
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>يرجى الانتظار...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="attack-list-page">
        <div className="attack-list-content">
          <div className="alert alert-danger" style={{ borderRadius: '15px', padding: '20px' }}>
            <i className="fas fa-exclamation-triangle me-2"></i> 
            <strong>حدث خطأ:</strong> {error}
          </div>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  return (
    <div className="attack-list-page">
      <div className="attack-list-content">
        {/* Header الاحترافي */}
        <div className="professional-header">
          <div className="row align-items-center">
            <div className="col-md-8">
              <h1 style={{ fontSize: '2.5rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '10px' }}>
                <i className="fas fa-shield-alt me-3" style={{ color: 'var(--primary-color)' }}></i>
                مركز مراقبة الهجمات الأمنية
              </h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', margin: 0 }}>
                <i className="fas fa-clock me-2"></i>
                آخر تحديث: {formatDateTime(lastUpdate)}
              </p>
            </div>
            <div className="col-md-4 text-end">
              <button 
                className="modern-btn btn-success-modern me-2"
                onClick={fetchAttacks}
                title="تحديث البيانات"
              >
                <i className="fas fa-sync-alt me-2"></i>
                تحديث
              </button>
              {isAdmin && (
                <Link to="/intrusions/confirm" className="modern-btn btn-primary-modern">
                  <i className="fas fa-plus me-2"></i>
                  هجوم جديد
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* إحصائيات سريعة */}
        <div className="stats-grid">
          <div className="stat-card" style={{ '--card-color': 'var(--primary-color)', '--card-color-light': 'var(--dark-gray)' }}>
            <div className="stat-number">{stats.total}</div>
            <div className="stat-label">إجمالي الهجمات</div>
          </div>
          <div className="stat-card" style={{ '--card-color': '#4caf50', '--card-color-light': '#45a049' }}>
            <div className="stat-number">{stats.confirmed}</div>
            <div className="stat-label">مؤكدة</div>
          </div>
          <div className="stat-card" style={{ '--card-color': '#ff416c', '--card-color-light': '#ff4b2b' }}>
            <div className="stat-number">{stats.critical}</div>
            <div className="stat-label">حرجة</div>
          </div>
          <div className="stat-card" style={{ '--card-color': '#ffa726', '--card-color-light': '#fb8c00' }}>
            <div className="stat-number">{stats.pending}</div>
            <div className="stat-label">قيد المراجعة</div>
          </div>
        </div>

        {/* لوحة الفلاتر المحسنة */}
        <div className="filters-panel">
          <div className="row g-3">
            <div className="col-lg-3 col-md-6">
              <label style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px', display: 'block' }}>
                <i className="fas fa-search me-2"></i>البحث
              </label>
              <input
                type="text"
                className="modern-input w-100"
                placeholder="البحث في الوصف أو الجهاز..."
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
              />
            </div>
            <div className="col-lg-2 col-md-6">
              <label style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px', display: 'block' }}>
                <i className="fas fa-filter me-2"></i>الحالة
              </label>
              <select
                className="modern-select w-100"
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              >
                <option value="all">الكل</option>
                <option value="confirmed">مؤكد</option>
                <option value="unconfirmed">غير مؤكد</option>
              </select>
            </div>
            <div className="col-lg-2 col-md-6">
              <label style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px', display: 'block' }}>
                <i className="fas fa-bug me-2"></i>نوع الهجوم
              </label>
              <select
                className="modern-select w-100"
                value={typeFilter}
                onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
              >
                <option value="">الكل</option>
                {attackTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div className="col-lg-2 col-md-6">
              <label style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px', display: 'block' }}>
                <i className="fas fa-exclamation-triangle me-2"></i>الشدة
              </label>
              <select className="modern-select w-100" value={severityFilter} onChange={e => { setSeverityFilter(e.target.value); setPage(1); }}>
                <option value="">الكل</option>
                <option value="low">منخفضة</option>
                <option value="medium">متوسطة</option>
                <option value="high">عالية</option>
                <option value="critical">حرجة</option>
              </select>
            </div>
            <div className="col-lg-3 col-md-6">
              <label style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px', display: 'block' }}>
                <i className="fas fa-calendar me-2"></i>التاريخ
              </label>
              <div className="row g-2">
                <div className="col-6">
                  <input type="date" className="modern-input w-100" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1); }} />
                </div>
                <div className="col-6">
                  <input type="date" className="modern-input w-100" value={toDate} onChange={e => { setToDate(e.target.value); setPage(1); }} />
                </div>
              </div>
            </div>
          </div>
          <div className="row g-3 mt-2">
            <div className="col-lg-3 col-md-6">
              <label style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px', display: 'block' }}>
                <i className="fas fa-server me-2"></i>الخادم/الجهاز
              </label>
              <input className="modern-input w-100" value={serverFilter} onChange={e => { setServerFilter(e.target.value); setPage(1); }} placeholder="بحث بالخادم/الجهاز" />
            </div>
            <div className="col-lg-2 col-md-6">
              <label style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px', display: 'block' }}>
                <i className="fas fa-plug me-2"></i>المنفذ
              </label>
              <input className="modern-input w-100" value={portFilter} onChange={e => { setPortFilter(e.target.value); setPage(1); }} placeholder="رقم المنفذ" />
            </div>
            <div className="col-lg-7 col-md-12 d-flex align-items-end">
              <button className="modern-btn btn-export-modern me-2" onClick={handleExport}>
                <i className="fas fa-file-csv me-2"></i> تصدير CSV
              </button>
            </div>
          </div>
        </div>

        {/* المحتوى الرئيسي */}
        {filtered.length === 0 ? (
          <div className="empty-state">
            <i className="fas fa-shield-alt empty-icon"></i>
            <h3 style={{ color: 'var(--primary-color)', marginBottom: '10px' }}>لا توجد هجمات</h3>
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>لا توجد أحداث ضمن المعايير المحددة</p>
          </div>
        ) : (
          <>
            <div className="attacks-table-container">
              <table className="professional-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>التاريخ</th>
                    <th>النوع</th>
                    <th>الشدة</th>
                    <th>المصدر</th>
                    <th>المنفذ</th>
                    <th>الحالة</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {pageData.map((a, idx) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: '700', color: 'var(--primary-color)' }}>
                        #{(page - 1) * PAGE_SIZE + idx + 1}
                      </td>
                      <td>
                        <div style={{ fontSize: '0.9rem' }}>
                          {formatDateTime(a.timestamp)}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                          {a.attack_type}
                        </div>
                      </td>
                      <td>
                        <span className={`severity-badge severity-${a.severity || 'medium'}`}>
                          {a.severity === 'critical' ? 'حرج' : 
                           a.severity === 'high' ? 'عالي' : 
                           a.severity === 'medium' ? 'متوسط' : 'منخفض'}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.9rem' }}>
                          <div style={{ fontWeight: '600' }}>{a.source_ip || '-'}</div>
                          <small style={{ color: 'var(--text-secondary)' }}>{a.geo_location || '-'}</small>
                        </div>
                      </td>
                      <td>
                        <span style={{ 
                          padding: '4px 8px', 
                          background: 'var(--light)', 
                          borderRadius: '6px',
                          fontWeight: '600',
                          color: '#495057'
                        }}>
                          {a.port || '-'}
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${a.confirmed ? 'status-confirmed' : 'status-pending'}`}>
                          {a.confirmed ? 'مؤكد' : 'قيد المراجعة'}
                        </span>
                      </td>
                      <td>
                        <div className="d-flex gap-1">
                          <Link 
                            to={`/intrusions/${a.id}`} 
                            className="action-btn btn-view"
                            title="عرض التفاصيل"
                          >
                            <i className="fas fa-eye"></i>
                          </Link>
                          {isAdmin && !a.confirmed && (
                            <button 
                              className="action-btn btn-confirm"
                              onClick={() => handleConfirm(a.id)}
                              title="تأكيد الهجوم"
                            >
                              <i className="fas fa-check"></i>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ترقيم الصفحات المحسن */}
            <div className="pagination-modern">
              <button
                className={`page-btn ${page === 1 ? 'disabled' : ''}`}
                onClick={() => setPage(p => Math.max(p - 1, 1))}
                disabled={page === 1}
              >
                <i className="fas fa-chevron-right me-2"></i>
                السابق
              </button>
              
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }
                
                return (
                  <button 
                    key={pageNum} 
                    className={`page-btn ${page === pageNum ? 'active' : ''}`}
                    onClick={() => setPage(pageNum)}
                  >
                    {pageNum}
                  </button>
                );
              })}
              
              <button
                className={`page-btn ${page === totalPages ? 'disabled' : ''}`}
                onClick={() => setPage(p => Math.min(p + 1, totalPages))}
                disabled={page === totalPages}
              >
                التالي
                <i className="fas fa-chevron-left ms-2"></i>
              </button>
              
              <div style={{ 
                marginLeft: '20px', 
                color: 'var(--text-secondary)', 
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center'
              }}>
                صفحة {page} من {totalPages} ({filtered.length} نتيجة)
              </div>
            </div>
          </>
        )}
        
        {/* زر التحديث المطول */}
        <button 
          className="floating-refresh"
          onClick={fetchAttacks}
          title="تحديث البيانات"
        >
          <i className="fas fa-sync-alt"></i>
        </button>
      </div>
    </div>
  );
};

// ضبط الاسم ليختفي خطأ react/display-name
export const AttackList = React.memo(AttackListComponent);
AttackList.displayName = 'AttackList';

export default AttackList;
