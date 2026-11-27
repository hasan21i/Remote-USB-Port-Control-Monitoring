// src/pages/monitoring/Blockchain.jsx

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
// eslint-disable-next-line no-unused-vars
import useSocketEvent from '../../hooks/useSocketEvent';
import {
  fetchBlockchainData,
  verifyBlockchain,
  fetchBlockchainStats,
  addBlockchainRecord,
  clearBlockchainData
} from '../../utils/api';
import { formatDateTime } from '../../utils/formatters';

const PAGE_SIZES = [5, 10, 20, 50];

const Blockchain = () => {
  // Add CSS for animations
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0% { opacity: 0.6; transform: scale(1); }
        50% { opacity: 0.3; transform: scale(1.1); }
        100% { opacity: 0.6; transform: scale(1); }
      }

      /* ---------------------------------
         Official Fintech/Blockchain Cards 
      --------------------------------- */
      .stat-custom-card {
        background: var(--bg-primary);
        border: 1px solid rgba(0, 0, 0, 0.05); /* light theme default */
        box-shadow: 0 4px 20px var(--shadow-color);
        border-radius: 16px;
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
        z-index: 1;
      }
      [data-theme="dark"] .stat-custom-card {
        border: 1px solid rgba(255, 255, 255, 0.05);
      }
      
      .stat-custom-card::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        opacity: 0.04;
        z-index: -1;
        transition: opacity 0.3s ease;
      }
      [data-theme="dark"] .stat-custom-card::before {
        opacity: 0.12;
      }
      
      .stat-custom-card:hover {
        transform: translateY(-8px);
        box-shadow: 0 12px 30px var(--shadow-color);
        border-color: var(--primary-color);
      }
      .stat-custom-card:hover::before {
        opacity: 0.08;
      }
      [data-theme="dark"] .stat-custom-card:hover::before {
        opacity: 0.2;
      }
      
      .stat-custom-card .icon-wrapper {
        width: 64px;
        height: 64px;
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .stat-custom-card:hover .icon-wrapper {
        transform: scale(1.15) rotate(-5deg);
      }

      .stat-custom-card .card-value {
        color: var(--text-primary);
        font-size: 2.2rem;
        letter-spacing: -0.5px;
      }
      .stat-custom-card .card-title-text {
        color: var(--text-secondary);
        font-size: 0.95rem;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      /* Variant: primary */
      .variant-primary::before { background: linear-gradient(135deg, var(--primary-color), var(--primary-dark)); }
      .variant-primary .icon-wrapper { background: rgba(30, 136, 229, 0.1); color: var(--primary-color); }
      [data-theme="dark"] .variant-primary .icon-wrapper { background: rgba(100, 181, 246, 0.15); color: var(--primary-light); }

      /* Variant: success */
      .variant-success::before { background: linear-gradient(135deg, var(--success-color), #2E7D32); }
      .variant-success .icon-wrapper { background: rgba(76, 175, 80, 0.1); color: var(--success-color); }
      [data-theme="dark"] .variant-success .icon-wrapper { background: rgba(76, 175, 80, 0.15); color: #81C784; }

      /* Variant: info */
      .variant-info::before { background: linear-gradient(135deg, var(--info-color), #1565C0); }
      .variant-info .icon-wrapper { background: rgba(33, 150, 243, 0.1); color: var(--info-color); }
      [data-theme="dark"] .variant-info .icon-wrapper { color: #64B5F6; background: rgba(100, 181, 246, 0.15); }

      /* Variant: warning */
      .variant-warning::before { background: linear-gradient(135deg, var(--warning-color), #E65100); }
      .variant-warning .icon-wrapper { background: rgba(255, 152, 0, 0.1); color: var(--warning-color); }
      [data-theme="dark"] .variant-warning .icon-wrapper { background: rgba(255, 152, 0, 0.15); color: #FFB74D; }

      /* Shimmer effect for the official blockchain feel */
      .stat-custom-card::after {
        content: '';
        position: absolute;
        top: 0; left: -150%; right: 0; bottom: 0;
        width: 50%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent);
        transform: skewX(-20deg);
        animation: cardShimmer 5s infinite;
        opacity: 0.3;
        z-index: 2;
        pointer-events: none;
      }
      [data-theme="dark"] .stat-custom-card::after {
         background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
      }
      @keyframes cardShimmer {
        0%, 50% { left: -150%; }
        100% { left: 200%; }
      }

      /* ---------------------------------
         Official Blockchain Records
      --------------------------------- */
      .blockchain-record-card {
        border-bottom: 1px solid var(--border-color);
        transition: background-color 0.3s ease;
      }
      .blockchain-record-card.expanded {
        background-color: var(--bg-secondary);
        border-left: 4px solid var(--primary-color);
      }
      .blockchain-record-card:not(.expanded):hover {
        background-color: rgba(30, 136, 229, 0.03);
      }
      [data-theme="dark"] .blockchain-record-card:not(.expanded):hover {
        background-color: rgba(100, 181, 246, 0.05);
      }
      
      .block-icon-circle {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: bold;
        position: relative;
        z-index: 1;
        background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-dark) 100%);
        color: white;
        box-shadow: 0 4px 10px rgba(0,0,0,0.1);
      }
      [data-theme="dark"] .block-icon-circle {
        background: linear-gradient(135deg, #1E3A5F 0%, #0D47A1 100%);
        box-shadow: 0 4px 10px rgba(0,0,0,0.4);
      }

      .block-content-panel {
        background-color: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        overflow: hidden;
      }
      .block-panel-header {
        padding: 10px 16px;
        font-weight: 600;
        display: flex;
        align-items: center;
        font-size: 0.95rem;
      }
      .panel-header-primary { background-color: rgba(30, 136, 229, 0.1); color: var(--primary-dark); border-bottom: 1px solid rgba(30,136,229,0.2) }
      .panel-header-success { background-color: rgba(76, 175, 80, 0.1); color: #2E7D32; border-bottom: 1px solid rgba(76,175,80,0.2) }
      .panel-header-info { background-color: rgba(33, 150, 243, 0.1); color: #1565C0; border-bottom: 1px solid rgba(33,150,243,0.2) }
      
      [data-theme="dark"] .panel-header-primary { background-color: rgba(100, 181, 246, 0.15); color: #90CAF9; }
      [data-theme="dark"] .panel-header-success { background-color: rgba(76, 175, 80, 0.15); color: #A5D6A7; }
      [data-theme="dark"] .panel-header-info { background-color: rgba(33, 150, 243, 0.15); color: #90CAF9; }

      .block-panel-body {
        padding: 16px;
        background-color: var(--bg-primary);
        color: var(--text-primary);
      }
      .hash-box {
        font-family: monospace;
        font-size: 0.85rem;
        padding: 10px;
        border-radius: 8px;
        background-color: var(--bg-secondary);
        border: 1px solid var(--border-color);
        color: var(--text-primary);
        word-break: break-all;
      }

    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, []);
  const [blocks, setBlocks] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [verifying, setVerifying] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [clearing, setClearing] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Theme state - get from global theme
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return document.documentElement.getAttribute('data-bs-theme') === 'dark';
  });

  // Listen for theme changes from global header
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const currentTheme = document.documentElement.getAttribute('data-bs-theme');
      setIsDarkMode(currentTheme === 'dark');
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-bs-theme']
    });

    return () => observer.disconnect();
  }, []);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(PAGE_SIZES[1]);
  const [total, setTotal] = useState(0);

  const [expandedId, setExpandedId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ action: '', data: '' });
  const [addError, setAddError] = useState('');

  // Theme styles
  const themeStyles = {
    background: isDarkMode ? '#1a1a1a' : 'var(--light)',
    cardBg: isDarkMode ? '#2d2d2d' : 'var(--white)',
    textColor: isDarkMode ? 'var(--white)' : 'var(--black)',
    mutedColor: isDarkMode ? 'var(--gray)' : 'var(--gray)',
    borderColor: isDarkMode ? 'var(--dark-gray)' : 'var(--mid)'
  };

  // Load stats
  const loadStats = useCallback(async () => {
    try {
      const data = await fetchBlockchainStats();
      setStats(data);
    } catch (err) {
      console.error('Stats loading error:', err);
      setError('فشل في جلب إحصائيات البلوكتشين');
    }
  }, []);

  // Load blocks with current filters & pagination
  const loadBlocks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const offset = (page - 1) * limit;
      const params = { limit, offset };
      const res = await fetchBlockchainData(params);
      setBlocks(res.blockchain_logs || []);
      setTotal(res.total || 0);
    } catch (err) {
      console.error('Blocks loading error:', err);
      setError('فشل في جلب سجلات البلوكتشين: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  // Verify chain
  // eslint-disable-next-line no-unused-vars
  const handleVerify = useCallback(async () => {
    setVerifying(true);
    setError(null);
    try {
      const result = await verifyBlockchain();
      setVerifyResult(result);
      await loadStats();
      await loadBlocks();
    } catch (err) {
      console.error('Verification error:', err);
      setError('فشل في التحقق من السلامة: ' + (err.response?.data?.error || err.message));
    } finally {
      setVerifying(false);
    }
  }, [loadStats, loadBlocks]);

  // Clear blockchain data
  // eslint-disable-next-line no-unused-vars
  const handleClearBlockchain = useCallback(async () => {
    if (!window.confirm('⚠️ تحذير: هذا الإجراء سيمسح جميع بيانات البلوك تشين نهائياً!\n\nهل أنت متأكد من المتابعة؟')) {
      return;
    }

    if (!window.confirm('هذا الإجراء لا يمكن التراجع عنه. هل أنت متأكد تماماً؟')) {
      return;
    }

    setClearing(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await clearBlockchainData();
      setSuccess(result.message || 'تم مسح بيانات البلوك تشين بنجاح');

      await loadStats();
      await loadBlocks();

      setTimeout(() => setSuccess(null), 5000);

    } catch (err) {
      console.error('Clear blockchain error:', err);
      setError('فشل في مسح بيانات البلوك تشين: ' + (err.response?.data?.error || err.message));
    } finally {
      setClearing(false);
    }
  }, [loadStats, loadBlocks]);

  // Initial load
  useEffect(() => {
    loadStats();
    loadBlocks();
  }, [loadStats, loadBlocks]);

  // Listen for token refresh events to reload new record
  useEffect(() => {
    const onTokenRefreshed = () => {
      loadStats();
      loadBlocks();
    };
    window.addEventListener('token_refreshed', onTokenRefreshed);
    return () => {
      window.removeEventListener('token_refreshed', onTokenRefreshed);
    };
  }, [loadStats, loadBlocks]);

  // Listen for blockchain events using the shared socket
  useSocketEvent('blockchain:new_record', () => {
    loadBlocks();
    loadStats();
  });

  useSocketEvent('blockchain:updated', () => {
    loadBlocks();
    loadStats();
  });

  const totalPages = useMemo(() => Math.ceil(total / limit), [total, limit]);
  const canPrev = page > 1;
  const canNext = page < totalPages;

  const toggleExpand = id => setExpandedId(prev => prev === id ? null : id);

  return (
    <div className="blockchain-page" style={{ backgroundColor: themeStyles.background, minHeight: '100vh', color: themeStyles.textColor }}>
      <div className="container-fluid py-4">

        {/* Hero Header */}
        <div className="row mb-4">
          <div className="col-12">
            <div className="card border-0 shadow-sm" style={{ 
              backgroundColor: themeStyles.cardBg,
              borderRadius: '12px'
            }}>
              <div className="card-body py-3 px-4">
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <h1 className="h4 mb-0 fw-bold" style={{ color: themeStyles.textColor }}>
                      سجلات البلوك تشين المؤمنة
                    </h1>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Alert Messages */}
        {error && (
          <div className="row mb-4">
            <div className="col-12">
              <div className="alert alert-danger alert-dismissible fade show shadow-sm" role="alert">
                <i className="fas fa-exclamation-triangle me-2"></i>
                {error}
                <button type="button" className="btn-close" onClick={() => setError(null)}></button>
              </div>
            </div>
          </div>
        )}

        {success && (
          <div className="row mb-4">
            <div className="col-12">
              <div className="alert alert-success alert-dismissible fade show shadow-sm" role="alert">
                <i className="fas fa-check-circle me-2"></i>
                {success}
                <button type="button" className="btn-close" onClick={() => setSuccess(null)}></button>
              </div>
            </div>
          </div>
        )}

        {/* Verification Results */}
        {verifyResult && (
          <div className="row mb-4">
            <div className="col-12">
              <div
                className="card shadow-lg border-0 position-relative overflow-hidden"
                style={{
                  background: isDarkMode
                    ? (verifyResult.verified
                      ? 'linear-gradient(135deg, #1a472a 0%, #2d5a3d 50%, #1e3a2a 100%)'
                      : 'linear-gradient(135deg, #4a1c1c 0%, #5d2a2a 50%, #3a1e1e 100%)')
                    : (verifyResult.verified
                      ? 'linear-gradient(135deg, #d4edda 0%, #c3e6cb 50%, #d1ecf1 100%)'
                      : 'linear-gradient(135deg, #f8d7da 0%, #f5c6cb 50%, #ffeaa7 100%)'),
                  border: 'none',
                  borderRadius: '15px',
                  transition: 'all 0.3s ease',
                  transform: 'translateY(0)',
                  cursor: 'pointer'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.1)';
                }}
              >
                {/* Background Pattern */}
                <div
                  className="position-absolute top-0 end-0 opacity-10"
                  style={{
                    width: '150px',
                    height: '150px',
                    background: isDarkMode
                      ? (verifyResult.verified
                        ? 'radial-gradient(circle, var(--success-color) 0%, transparent 70%)'
                        : 'radial-gradient(circle, var(--danger-color) 0%, transparent 70%)')
                      : (verifyResult.verified
                        ? 'radial-gradient(circle, var(--success-color) 0%, transparent 70%)'
                        : 'radial-gradient(circle, var(--danger-color) 0%, transparent 70%)'),
                    borderRadius: '50%',
                    transform: 'translate(30px, -30px)'
                  }}
                ></div>

                {/* Additional decorative elements */}
                <div
                  className="position-absolute bottom-0 start-0 opacity-5"
                  style={{
                    width: '100px',
                    height: '100px',
                    background: isDarkMode
                      ? (verifyResult.verified
                        ? 'radial-gradient(circle, var(--success-color) 0%, transparent 70%)'
                        : 'radial-gradient(circle, var(--danger-color) 0%, transparent 70%)')
                      : (verifyResult.verified
                        ? 'radial-gradient(circle, var(--success-color) 0%, transparent 70%)'
                        : 'radial-gradient(circle, var(--danger-color) 0%, transparent 70%)'),
                    borderRadius: '50%',
                    transform: 'translate(-20px, 20px)'
                  }}
                ></div>

                <div className="card-body p-4">
                  <div className="row align-items-center">
                    <div className="col-auto">
                      <div
                        className="rounded-circle d-flex align-items-center justify-content-center position-relative"
                        style={{
                          width: '70px',
                          height: '70px',
                          background: isDarkMode
                            ? (verifyResult.verified
                              ? 'linear-gradient(135deg, var(--success-color) 0%, #22c55e 100%)'
                              : 'linear-gradient(135deg, var(--danger-color) 0%, #ef4444 100%)')
                            : (verifyResult.verified
                              ? 'linear-gradient(135deg, var(--success-color) 0%, var(--secondary-color) 100%)'
                              : 'linear-gradient(135deg, var(--danger-color) 0%, #fd7e14 100%)'),
                          boxShadow: isDarkMode
                            ? '0 4px 20px rgba(0,0,0,0.4)'
                            : '0 4px 15px rgba(0,0,0,0.2)',
                          border: `3px solid ${isDarkMode ? 'var(--white)20' : 'var(--white)80'}`
                        }}
                      >
                        {verifyResult.verified ? (
                          <i className="fas fa-shield-check text-white" style={{ fontSize: '28px' }}></i>
                        ) : (
                          <i className="fas fa-exclamation-triangle text-white" style={{ fontSize: '28px' }}></i>
                        )}

                        {/* Glow effect */}
                        <div
                          className="position-absolute rounded-circle"
                          style={{
                            width: '100%',
                            height: '100%',
                            background: isDarkMode
                              ? (verifyResult.verified
                                ? 'radial-gradient(circle, var(--success-color)40 0%, transparent 70%)'
                                : 'radial-gradient(circle, var(--danger-color)40 0%, transparent 70%)')
                              : (verifyResult.verified
                                ? 'radial-gradient(circle, var(--success-color)40 0%, transparent 70%)'
                                : 'radial-gradient(circle, var(--danger-color)40 0%, transparent 70%)'),
                            animation: 'pulse 2s infinite'
                          }}
                        ></div>
                      </div>
                    </div>

                    <div className="col">
                      <div className="d-flex flex-column">
                        <h4 className="mb-2 fw-bold" style={{
                          color: isDarkMode
                            ? (verifyResult.verified ? 'var(--success-color)' : 'var(--danger-color)')
                            : (verifyResult.verified ? '#155724' : '#721c24'),
                          fontSize: '1.25rem'
                        }}>
                          {verifyResult.verified ? (
                            <>
                              <i className="fas fa-check-circle me-2"></i>
                              البلوك تشين سليم ومؤمن
                            </>
                          ) : (
                            <>
                              <i className="fas fa-exclamation-triangle me-2"></i>
                              تم اكتشاف مشاكل في البلوك تشين
                            </>
                          )}
                        </h4>

                        <div className="d-flex align-items-center gap-4 flex-wrap">
                          <div className="d-flex align-items-center">
                            <i className="fas fa-cubes me-2" style={{
                              color: isDarkMode
                                ? (verifyResult.verified ? 'var(--success-color)' : 'var(--danger-color)')
                                : (verifyResult.verified ? 'var(--success-color)' : 'var(--danger-color)')
                            }}></i>
                            <span className="fw-semibold" style={{
                              color: isDarkMode
                                ? (verifyResult.verified ? 'var(--success-color)' : 'var(--danger-color)')
                                : (verifyResult.verified ? '#155724' : '#721c24')
                            }}>
                              تم فحص {verifyResult.blocks_checked} كتلة
                            </span>
                          </div>

                          {verifyResult.invalid_blocks > 0 && (
                            <div className="d-flex align-items-center">
                              <i className="fas fa-exclamation-circle me-2" style={{
                                color: isDarkMode ? 'var(--danger-color)' : 'var(--danger-color)'
                              }}></i>
                              <span className="fw-semibold" style={{
                                color: isDarkMode ? 'var(--danger-color)' : 'var(--danger-color)'
                              }}>
                                {verifyResult.invalid_blocks} كتلة معطوبة
                              </span>
                            </div>
                          )}

                          {verifyResult.blocks_checked > 0 && (
                            <div className="d-flex align-items-center">
                              <i className="fas fa-percentage me-2" style={{
                                color: isDarkMode
                                  ? (verifyResult.verified ? 'var(--success-color)' : 'var(--danger-color)')
                                  : (verifyResult.verified ? 'var(--success-color)' : 'var(--danger-color)')
                              }}></i>
                              <span className="fw-semibold" style={{
                                color: isDarkMode
                                  ? (verifyResult.verified ? 'var(--success-color)' : 'var(--danger-color)')
                                  : (verifyResult.verified ? '#155724' : '#721c24')
                              }}>
                                {Math.round(((verifyResult.blocks_checked - (verifyResult.invalid_blocks || 0)) / verifyResult.blocks_checked) * 100)}% صالح
                              </span>
                            </div>
                          )}
                        </div>

                        {verifyResult.message && (
                          <p className="mb-0 mt-2 opacity-75" style={{
                            color: isDarkMode
                              ? (verifyResult.verified ? '#86efac' : '#fca5a5')
                              : (verifyResult.verified ? '#155724' : '#721c24')
                          }}>
                            <i className="fas fa-info-circle me-1"></i>
                            {verifyResult.message}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="col-auto">
                      <div className="text-end">
                        <div className="badge rounded-pill px-3 py-2 position-relative" style={{
                          background: isDarkMode
                            ? (verifyResult.verified
                              ? 'linear-gradient(135deg, var(--success-color) 0%, #22c55e 100%)'
                              : 'linear-gradient(135deg, var(--danger-color) 0%, #ef4444 100%)')
                            : (verifyResult.verified
                              ? 'linear-gradient(135deg, var(--success-color) 0%, var(--secondary-color) 100%)'
                              : 'linear-gradient(135deg, var(--danger-color) 0%, #fd7e14 100%)'),
                          color: 'white',
                          fontSize: '0.875rem',
                          fontWeight: '600',
                          boxShadow: isDarkMode
                            ? '0 2px 10px rgba(0,0,0,0.3)'
                            : '0 2px 8px rgba(0,0,0,0.15)',
                          border: `1px solid ${isDarkMode ? 'var(--white)30' : 'var(--white)60'}`
                        }}>
                          <i className={`fas ${verifyResult.verified ? 'fa-shield-check' : 'fa-tools'} me-1`}></i>
                          {verifyResult.verified ? 'مؤمن' : 'يتطلب إصلاح'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Statistics Cards */}
        {stats && (
          <div
            className="mb-4"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '1.7rem',
              justifyContent: 'center',
            }}
          >
            <StatCard
              title="إجمالي السجلات"
              value={stats.total_records || 0}
              variant="primary"
            />
            <StatCard
              title="أول سجل"
              value={stats.first_timestamp ? formatDateTime(stats.first_timestamp).split(' ')[0] : '—'}
              variant="info"
            />
            <StatCard
              title="آخر سجل"
              value={stats.last_timestamp ? formatDateTime(stats.last_timestamp).split(' ')[0] : '—'}
              variant="success"
            />
            <StatCard
              title="أنواع العمليات"
              value={Object.keys(stats.by_action || {}).length}
              variant="warning"
            />
          </div>
        )}

        {/* Blockchain Records */}
        <div className="row">
          <div className="col-12">
            <div className="card shadow-sm border-0" style={{ backgroundColor: themeStyles.cardBg, borderColor: themeStyles.borderColor }}>
              <div className="card-header border-0 py-3" style={{ backgroundColor: themeStyles.cardBg, borderBottom: `1px solid ${themeStyles.borderColor}` }}>
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
                  <h5 className="mb-0 fw-bold d-flex align-items-center" style={{ color: themeStyles.textColor }}>
                    <i className="fas fa-link me-2" style={{ color: isDarkMode ? '#888' : '#555' }}></i>
                    كتل البلوك تشين المشفرة
                    {loading && <div className="spinner-border spinner-border-sm ms-3 text-secondary" role="status"></div>}
                  </h5>
                  <div className="d-flex align-items-center rounded-pill" style={{ 
                    backgroundColor: isDarkMode ? '#222' : '#f8f9fa',
                    border: `1px solid ${themeStyles.borderColor}`,
                    padding: '4px 8px'
                  }}>
                    <span className="px-3 py-1 fw-bold" style={{ 
                      color: themeStyles.textColor,
                      borderLeft: `1px solid ${themeStyles.borderColor}`,
                      fontSize: '0.85rem'
                    }}>
                      إجمالي: {total}
                    </span>
                    <select
                      className="form-select form-select-sm border-0 shadow-none bg-transparent"
                      style={{
                        width: 'auto',
                        color: themeStyles.textColor,
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        paddingRight: '2rem'
                      }}
                      value={limit}
                      onChange={e => { setLimit(+e.target.value); setPage(1); }}
                    >
                      {PAGE_SIZES.map(n => (
                        <option key={n} value={n} style={{ background: themeStyles.cardBg }}>{n} سجل / صفحة</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="card-body p-0" style={{ backgroundColor: themeStyles.cardBg }}>
                {loading ? (
                  <div className="text-center py-5">
                    <div className="spinner-border text-primary mb-3" role="status" style={{ width: '3rem', height: '3rem' }}></div>
                    <p style={{ color: themeStyles.mutedColor }}>جاري تحميل البيانات المشفرة...</p>
                  </div>
                ) : blocks.length === 0 ? (
                  <div className="text-center py-5">
                    <i className="fas fa-database mb-3" style={{ fontSize: '48px', color: themeStyles.mutedColor }}></i>
                    <p className="mb-0" style={{ color: themeStyles.mutedColor }}>لا توجد سجلات متاحة</p>
                  </div>
                ) : (
                  <div>
                    {blocks.map((block, index) => (
                      <BlockItem
                        key={block.id}
                        block={block}
                        index={index}
                        expanded={expandedId === block.id}
                        onToggle={() => toggleExpand(block.id)}
                        isDarkMode={isDarkMode}
                        themeStyles={themeStyles}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="row mt-4">
            <div className="col-12">
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                canPrev={canPrev}
                canNext={canNext}
                isDarkMode={isDarkMode}
                themeStyles={themeStyles}
              />
            </div>
          </div>
        )}

        {/* Add Record Modal */}
        {showAddModal && (
          <AddRecordModal
            show={showAddModal}
            onHide={() => setShowAddModal(false)}
            addForm={addForm}
            setAddForm={setAddForm}
            addError={addError}
            setAddError={setAddError}
            isDarkMode={isDarkMode}
            themeStyles={themeStyles}
            onSuccess={() => {
              loadBlocks();
              loadStats();
              setError('');
            }}
          />
        )}

      </div>
    </div>
  );
};

// Enhanced StatCard Component
// Dashboard-style StatCard based on image
const StatCard = ({ title, value, variant = 'primary' }) => {
  // Color mappings based on variant
  const colors = {
    primary: '#1e88e5',    // إجمالي الأجهزة (أزرق)
    success: '#2e7d32',    // متصلة (أخضر)
    info: '#00acc1',       // إجمالي الخوادم (أزرق فاتح)
    warning: '#f39c12',    // التنبيهات / معلقة (برتقالي/أصفر)
    danger: '#d32f2f'
  };
  
  const selectedColor = colors[variant] || colors.primary;

  return (
    <div
      className="card dashboard-card shadow-sm text-center text-white"
      style={{
        backgroundColor: selectedColor,
        borderRadius: '1.5rem',
        minWidth: 170,
        minHeight: 145,
        maxWidth: 210,
        margin: '0.3rem 0.4rem',
        boxShadow: '0 3px 22px #0002',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '1.2rem 0.2rem 1.3rem 0.2rem',
        cursor: 'default',
      }}
    >
      <div className="card-body d-flex flex-column justify-content-center align-items-center p-0">
        <h6 className="card-title text-white mb-1" style={{ fontSize: 18, fontWeight: 'bold' }}>{title}</h6>
        <div className="display-5 fw-bold mt-2" style={{ fontSize: 36 }}>{value}</div>
      </div>
    </div>
  );
};

// BlockItem Component - renders a single blockchain block record
const BlockItem = ({ block, index, expanded, onToggle, isDarkMode, themeStyles }) => {
  // Try to decrypt/parse the data field
  let parsedData = null;
  let action = '';
  try {
    if (typeof block.data === 'string') {
      try {
        const parsed = JSON.parse(block.data);
        parsedData = parsed;
        action = parsed.action || '';
      } catch {
        // Data is encrypted or not JSON
        parsedData = null;
        action = '';
      }
    } else if (typeof block.data === 'object') {
      parsedData = block.data;
      action = block.data?.action || '';
    }
  } catch {
    parsedData = null;
  }

  const blockHeight = block.block_height || index + 1;
  const isVerified = block.verified !== false;

  return (
    <div className={`blockchain-record-card ${expanded ? 'expanded' : ''}`}>
      {/* Collapsed Row */}
      <div
        className="d-flex align-items-center p-3 gap-3"
        style={{ cursor: 'pointer' }}
        onClick={onToggle}
      >
        {/* Block Number Circle */}
        <div className="block-icon-circle flex-shrink-0">
          #{blockHeight}
        </div>

        {/* Main Info */}
        <div className="flex-grow-1">
          <div className="d-flex align-items-center gap-2 mb-1">
<span className="fw-bold" style={{ color: themeStyles.textColor, fontSize: '1.05rem' }}>
                {action || (block.data ? 'سجل مشفّر' : 'سجل غير معروف')}
              </span>
            </div>
            
            <div className="d-flex align-items-center justify-content-between mt-1 flex-wrap w-100">
              <div className="d-flex align-items-center gap-3 flex-wrap" style={{ fontSize: '0.85rem', color: themeStyles.mutedColor }}>
                <span>
                  <i className="fas fa-clock me-1"></i>
                  {block.timestamp ? formatDateTime(typeof block.timestamp === 'string' ? block.timestamp : block.timestamp.toISOString?.() || String(block.timestamp)) : '—'}
                </span>
                {block.hash && (
                  <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    <i className="fas fa-fingerprint me-1"></i>
                    {block.hash.substring(0, 16)}...
                  </span>
                )}
                {!isVerified && (
                  <span className="badge bg-danger bg-opacity-10 text-danger ms-2" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                    <i className="fas fa-times-circle me-1"></i>غير موثّق
                  </span>
                )}
              </div>
              
              <div className="d-flex align-items-center mt-2 mt-sm-0" style={{ 
                color: isDarkMode ? '#90CAF9' : '#1976d2',
                fontSize: '0.85rem',
                fontWeight: '600',
                opacity: expanded ? 1 : 0.8,
                transition: 'all 0.2s ease'
              }}>
                <span className="me-2">عرض التفاصيل</span>
                <i className={`fas fa-chevron-${expanded ? 'up' : 'down'}`} style={{ transition: 'transform 0.3s ease' }}></i>
              </div>
            </div>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-3 pb-3" style={{ paddingRight: '76px' }}>
          <div className="row g-3">
            {/* Hash Info */}
            <div className="col-md-6">
              <div className="block-content-panel">
                <div className="block-panel-header panel-header-primary">
                  <i className="fas fa-fingerprint me-2"></i>
                  هاش الكتلة
                </div>
                <div className="block-panel-body">
                  <div className="hash-box">{block.hash || '—'}</div>
                </div>
              </div>
            </div>

            {/* Previous Hash */}
            <div className="col-md-6">
              <div className="block-content-panel">
                <div className="block-panel-header panel-header-info">
                  <i className="fas fa-link me-2"></i>
                  هاش الكتلة السابقة
                </div>
                <div className="block-panel-body">
                  <div className="hash-box">{block.previous_hash || 'Genesis Block (لا يوجد سابق)'}</div>
                </div>
              </div>
            </div>

            {/* Block Data */}
            <div className="col-12">
              <div className="block-content-panel">
                <div className="block-panel-header panel-header-success">
                  <i className="fas fa-database me-2"></i>
                  بيانات الكتلة
                </div>
                <div className="block-panel-body">
                  <div className="hash-box" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {parsedData
                      ? JSON.stringify(parsedData, null, 2)
                      : (block.data || '—')
                    }
                  </div>
                </div>
              </div>
            </div>

            {/* Meta Info Row */}
            <div className="col-12">
              <div className="d-flex gap-4 flex-wrap" style={{ fontSize: '0.85rem', color: themeStyles.mutedColor }}>
                <span><i className="fas fa-layer-group me-1"></i> ارتفاع: {blockHeight}</span>
                <span><i className="fas fa-hashtag me-1"></i> Nonce: {block.nonce ?? '—'}</span>
                <span><i className="fas fa-key me-1"></i> ID: {block.id}</span>
                <span>
                  <i className="fas fa-shield-alt me-1"></i>
                  {isVerified ? 'موثّق ✓' : 'غير موثّق ✗'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// AddRecordModal Component
const AddRecordModal = ({ show, onHide, addForm, setAddForm, addError, setAddError, isDarkMode, themeStyles, onSuccess }) => {
  const handleSubmit = async (e) => {
    e.preventDefault();
    setAddError('');
    try {
      let parsedData;
      try {
        parsedData = JSON.parse(addForm.data);
      } catch {
        setAddError('البيانات يجب أن تكون بصيغة JSON صحيحة');
        return;
      }
      await addBlockchainRecord({ action: addForm.action, data: parsedData });
      setAddForm({ action: '', data: '' });
      onHide();
      onSuccess();
    } catch (err) {
      console.error('Add record error:', err);
      setAddError('فشل إضافة السجل: ' + (err.response?.data?.error || err.message));
    }
  };

  if (!show) return null;

  return (
    <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content shadow-lg border-0" style={{ backgroundColor: themeStyles.cardBg, borderColor: themeStyles.borderColor }}>
          <div className="modal-header bg-primary text-white">
            <h5 className="modal-title fw-bold">
              <i className="fas fa-plus me-2"></i>
              إضافة سجل جديد للبلوك تشين
            </h5>
            <button type="button" className="btn-close btn-close-white" onClick={onHide}></button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="modal-body p-4" style={{ backgroundColor: themeStyles.cardBg }}>
              {addError && (
                <div className="alert alert-danger">
                  <i className="fas fa-exclamation-triangle me-2"></i>
                  {addError}
                </div>
              )}
              <div className="row">
                <div className="col-md-6 mb-3">
                  <label className="form-label fw-bold" style={{ color: themeStyles.textColor }}>نوع العملية</label>
                  <input
                    type="text"
                    className="form-control form-control-lg"
                    style={{ 
                      backgroundColor: isDarkMode ? 'var(--dark-gray)' : 'var(--white)',
                      borderColor: themeStyles.borderColor,
                      color: themeStyles.textColor
                    }}
                    placeholder="مثال: user_login"
                    value={addForm.action}
                    onChange={e => setAddForm(f => ({ ...f, action: e.target.value }))}
                    required
                  />
                </div>
                <div className="col-md-6 mb-3">
                  <label className="form-label fw-bold" style={{ color: themeStyles.textColor }}>البيانات (JSON)</label>
                  <textarea
                    className="form-control"
                    style={{ 
                      backgroundColor: isDarkMode ? 'var(--dark-gray)' : 'var(--white)',
                      borderColor: themeStyles.borderColor,
                      color: themeStyles.textColor,
                      fontFamily: 'monospace'
                    }}
                    rows="8"
                    placeholder='{"user_id": "123", "details": "تفاصيل العملية"}'
                    value={addForm.data}
                    onChange={e => setAddForm(f => ({ ...f, data: e.target.value }))}
                    required
                  />
                  <div className="form-text" style={{ color: themeStyles.mutedColor }}>يجب أن تكون البيانات بصيغة JSON صحيحة</div>
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ backgroundColor: isDarkMode ? '#2a2a2a' : 'var(--light)' }}>
              <button type="button" className="btn btn-outline-secondary" onClick={onHide}>
                إلغاء
              </button>
              <button type="submit" className="btn btn-primary">
                <i className="fas fa-plus me-2"></i>
                إضافة السجل
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

AddRecordModal.propTypes = {
  show: PropTypes.bool.isRequired,
  onHide: PropTypes.func.isRequired,
  addForm: PropTypes.object.isRequired,
  setAddForm: PropTypes.func.isRequired,
  addError: PropTypes.string,
  setAddError: PropTypes.func.isRequired,
  isDarkMode: PropTypes.bool.isRequired,
  themeStyles: PropTypes.object.isRequired,
  onSuccess: PropTypes.func.isRequired,
};

// Professional Pagination Component
const Pagination = ({ page, totalPages, onPageChange, canPrev, canNext, isDarkMode, themeStyles }) => (
  <nav className="mt-4 pt-4 mb-2 d-flex justify-content-center" style={{ borderTop: `1px solid ${isDarkMode ? '#333' : '#eee'}` }}>
    <ul className="pagination pagination-sm shadow-sm m-0 p-0" style={{ listStyleType: 'none', display: 'inline-flex', borderRadius: '4px', overflow: 'hidden' }}>
      <li className={`page-item ${!canPrev ? 'disabled' : ''}`}>
        <button
          className="page-link px-3 py-2 border-0"
          style={{
            backgroundColor: isDarkMode ? '#222' : '#f8f9fa',
            color: !canPrev ? (isDarkMode ? '#555' : '#aaa') : themeStyles.textColor,
            borderRight: `1px solid ${isDarkMode ? '#333' : '#eee'}`
          }}
          onClick={() => onPageChange(1)}
          disabled={!canPrev}
        >
          الأولى
        </button>
      </li>
      <li className={`page-item ${!canPrev ? 'disabled' : ''}`}>
        <button
          className="page-link px-3 py-2 border-0"
          style={{
            backgroundColor: isDarkMode ? '#222' : '#f8f9fa',
            color: !canPrev ? (isDarkMode ? '#555' : '#aaa') : themeStyles.textColor,
            borderRight: `1px solid ${isDarkMode ? '#333' : '#eee'}`
          }}
          onClick={() => onPageChange(page - 1)}
          disabled={!canPrev}
        >
          السابقة
        </button>
      </li>

      {/* Formatted Page numbers */}
      {[...Array(Math.min(5, totalPages))].map((_, i) => {
        // Center the paginator around current page
        let pageNum = page - 2 + i;
        if (page < 3) pageNum = i + 1;
        else if (page > totalPages - 2) pageNum = totalPages - 4 + i;
        
        // Ensure pageNum stays in bounds
        pageNum = Math.max(1, Math.min(totalPages, pageNum));

        // ensure uniqueness (if totalPages < 5)
        if (pageNum > totalPages) return null;
        
        const isActive = page === pageNum;
        return (
          <li key={pageNum} className={`page-item ${isActive ? 'active' : ''}`}>
            <button
              className="page-link px-3 py-2 border-0"
              style={{
                backgroundColor: isActive ? (isDarkMode ? '#333' : '#e9ecef') : (isDarkMode ? '#222' : '#f8f9fa'),
                color: isActive ? (isDarkMode ? '#fff' : '#000') : themeStyles.textColor,
                fontWeight: isActive ? '600' : 'normal',
                borderRight: `1px solid ${isDarkMode ? '#333' : '#eee'}`
              }}
              onClick={() => onPageChange(pageNum)}
            >
              {pageNum}
            </button>
          </li>
        );
      })}

      <li className={`page-item ${!canNext ? 'disabled' : ''}`}>
        <button
          className="page-link px-3 py-2 border-0"
          style={{
            backgroundColor: isDarkMode ? '#222' : '#f8f9fa',
            color: !canNext ? (isDarkMode ? '#555' : '#aaa') : themeStyles.textColor,
            borderRight: `1px solid ${isDarkMode ? '#333' : '#eee'}`
          }}
          onClick={() => onPageChange(page + 1)}
          disabled={!canNext}
        >
          التالية
        </button>
      </li>
      <li className={`page-item ${!canNext ? 'disabled' : ''}`}>
        <button
          className="page-link px-3 py-2 border-0"
          style={{
            backgroundColor: isDarkMode ? '#222' : '#f8f9fa',
            color: !canNext ? (isDarkMode ? '#555' : '#aaa') : themeStyles.textColor
          }}
          onClick={() => onPageChange(totalPages)} 
          disabled={!canNext}
        >
          الأخيرة
        </button>
      </li>
    </ul>
  </nav>
);

// PropTypes
StatCard.propTypes = {
  title: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  icon: PropTypes.string.isRequired,
  variant: PropTypes.string
};

BlockItem.propTypes = {
  block: PropTypes.object.isRequired,
  index: PropTypes.number.isRequired,
  expanded: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
  isDarkMode: PropTypes.bool.isRequired,
  themeStyles: PropTypes.object.isRequired
};

Pagination.propTypes = {
  page: PropTypes.number.isRequired,
  totalPages: PropTypes.number.isRequired,
  onPageChange: PropTypes.func.isRequired,
  canPrev: PropTypes.bool.isRequired,
  canNext: PropTypes.bool.isRequired,
  isDarkMode: PropTypes.bool.isRequired,
  themeStyles: PropTypes.object.isRequired
};

export default Blockchain;

