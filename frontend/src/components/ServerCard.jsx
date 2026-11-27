// src/components/ServerCard.jsx

import React, { useState, useEffect, useCallback, memo } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { fetchServer } from '../utils/api';           // دالة جديدة من api.js
import { enableUsbPort, disableUsbPort } from '../utils/api';
import HeartbeatBadge from './HeartbeatBadge';
import { formatRelativeTime } from '../utils/formatters';
import useAuth from '../hooks/useAuth';
// import useDevice from '../hooks/useDevice'; // لم نعد نستخدمه
import useSocket from '../hooks/useSocket';
import { FaPlug, FaBan, FaBolt } from 'react-icons/fa';

const ServerCard = memo(({ 
  server, 
  onClick 
}) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  // const { devices } = useDevice(); // لم نعد نستخدمه
  useSocket('server:heartbeat', (updated) => {
    if (updated && updated?.server && updated.server.id === server.id) {
      // يمكن هنا تحديث heartbeat أو الحالة فورًا عبر state/context حسب البنية
      // مثال: setHeartbeat(updated.server.last_heartbeat)
    }
  });

  // Set default values for server properties
  const {
    id = '',
    name = '',
    address = '',
    ports = [],
    lastHeartbeat: initialHeartbeat = null,
    status = '',
    is_backup = false,
    system_specs = '',
    connected_devices_count = 0,
    total_power_consumption = 0,
    active_ports_count = 0
  } = server || {};

  // نبقي على آخر وقت تواصل متجدداً عبر API كل 30 ثانية
  const [heartbeat, setHeartbeat] = useState(initialHeartbeat);

  useEffect(() => {
    let isMounted = true;
    const loadHeartbeat = async () => {
      try {
        const resp = await fetchServer(id);
        const updated = resp?.data?.lastHeartbeat || resp?.lastHeartbeat;
        if (isMounted) setHeartbeat(updated);
      } catch (err) {
        // إذا فشل، نحتفظ بالقيمة القديمة
        console.error('خطأ في تحديث نبض الخادم:', err);
      }
    };
    loadHeartbeat();
    const interval = setInterval(loadHeartbeat, 30_000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [id]);

  // الأجهزة المرتبطة بالخادم (لم تعد مستخدمة لأننا نستخدم البيانات من Supabase)
  // const serverDevices = Array.isArray(devices) ? devices.filter(d => d.server_id === id) : [];
  // الطاقة الكلية للخادم - نستخدم البيانات من Supabase الآن
  // const totalPower = 0;
  // حالة الترخيص - استخدام قيمة افتراضية
  const licensed = true;
  // تنبيهات الطاقة - سيتم تحديثها بناءً على البيانات من Supabase
  // const powerAlert = false;

  // RBAC: هل المستخدم Admin أو Manager؟
  const isAdmin = currentUser && (currentUser.role === 'admin' || (Array.isArray(currentUser.roles) && currentUser.roles.includes('admin')));
  const isManager = currentUser && (currentUser.role === 'manager' || (Array.isArray(currentUser.roles) && currentUser.roles.includes('manager')));
  const canControl = isAdmin || isManager;

  // تحكم في المنافذ (تفعيل/تعطيل)
  const [portLoading, setPortLoading] = useState({});
  const handlePortAction = useCallback(async (port, action) => {
    setPortLoading(l => ({ ...l, [port]: true }));
    try {
      if (action === 'enable') {
        await enableUsbPort(id, port);
      } else if (action === 'disable') {
        await disableUsbPort(id, port);
      }
      // الحالة ستتحدث تلقائيًا عبر real-time socket أو إعادة تحميل البيانات
    } catch (e) {
      alert('فشل في تنفيذ العملية: ' + (e.message || e));
    } finally {
      setPortLoading(l => ({ ...l, [port]: false }));
    }
  }, [id]);

  const handleView = useCallback(() => {
    if (typeof onClick === 'function') {
      onClick(id);
    } else {
      navigate(`/servers/${id}`);
    }
  }, [id, navigate, onClick]);

  return (
    <>
  <style>{`
        .server-card {
          background: var(--bg-primary);
          border: 2px solid rgba(0, 123, 255, 0.1);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
          position: relative;
          overflow: hidden;
        }

        .server-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 4px;
          background: linear-gradient(90deg, var(--primary-color) 0%, var(--success-color) 50%, var(--secondary-color) 100%);
          transition: all 0.3s ease;
        }
        
        .server-card:hover {
          transform: translateY(-10px) scale(1.02);
          box-shadow: 0 12px 40px rgba(0, 123, 255, 0.15);
          border-color: rgba(0, 123, 255, 0.4);
        }

        .server-card:hover::before {
          height: 6px;
          box-shadow: 0 0 20px rgba(0, 123, 255, 0.3);
        }
        
        .card-header {
          background: linear-gradient(135deg, var(--primary-color) 0%, #0056b3 100%);
          color: white;
          border-bottom: none;
          padding: 1.5rem;
          position: relative;
          overflow: hidden;
        }

        .card-header::after {
          content: '';
          position: absolute;
          top: -50%;
          right: -50%;
          width: 200%;
          height: 200%;
          background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
          animation: shimmer 3s ease-in-out infinite;
        }

        @keyframes shimmer {
          0%, 100% { transform: translateX(-100%) translateY(-100%) rotate(45deg); }
          50% { transform: translateX(100%) translateY(100%) rotate(45deg); }
        }
        
        .card-header h5 {
          font-weight: 700;
          font-size: 1.3rem;
          text-shadow: 0 2px 4px rgba(0,0,0,0.1);
          position: relative;
          z-index: 2;
        }
        
        .card-header i {
          opacity: 0.9;
          margin-left: 0.5rem;
        }

        .card-body {
          background: var(--bg-primary);
          color: var(--text-primary);
          padding: 1.5rem;
        }
        
        .info-item {
          display: flex;
          align-items: center;
          margin-bottom: 0.75rem;
          padding: 0.5rem;
          border-radius: 8px;
          transition: all 0.2s ease;
        }

        .info-item:hover {
          background: rgba(0, 123, 255, 0.05);
          transform: translateX(5px);
        }
        
        .info-item i {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-left: 0.75rem;
          opacity: 0.8;
          font-size: 1rem;
        }

        .info-item strong {
          color: var(--text-secondary);
          font-weight: 600;
          min-width: 120px;
        }

        .info-item span {
          color: var(--text-primary);
        }
        
        .card-footer {
          border-top: 2px solid rgba(0, 123, 255, 0.1);
          background: var(--bg-secondary);
          padding: 1.25rem 1.5rem;
          position: relative;
        }

        .card-footer::before {
          content: '';
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 60%;
          height: 2px;
          background: linear-gradient(90deg, transparent 0%, var(--primary-color) 50%, transparent 100%);
        }
        
        .btn-primary {
          background: linear-gradient(135deg, var(--primary-color) 0%, #0056b3 100%);
          border: none;
          box-shadow: 0 4px 15px rgba(0,123,255,0.3);
          padding: 0.75rem 1.5rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border-radius: 50px;
          transition: all 0.3s ease;
        }
        
        .btn-primary:hover {
          background: linear-gradient(135deg, #0056b3 0%, #004085 100%);
          transform: translateY(-2px);
          box-shadow: 0 8px 25px rgba(0,123,255,0.4);
        }

        .badge {
          padding: 0.5rem 1rem;
          border-radius: 50px;
          font-weight: 600;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .port-control {
          background: var(--bg-secondary);
          border: 1px solid rgba(0, 123, 255, 0.1);
          border-radius: 12px;
          padding: 1rem;
          margin-top: 1rem;
        }

        .port-control strong {
          color: var(--primary-color);
          font-size: 1rem;
          margin-bottom: 0.75rem;
          display: block;
        }

        .btn-outline-success, .btn-outline-danger {
          border-width: 2px;
          font-weight: 600;
          padding: 0.375rem 0.75rem;
          border-radius: 8px;
          transition: all 0.3s ease;
        }

        .btn-outline-success:hover {
          transform: scale(1.1);
        }

        .btn-outline-danger:hover {
          transform: scale(1.1);
        }

        @media (max-width: 768px) {
          .server-card {
            margin-bottom: 1.5rem;
          }
          
          .card-header {
            padding: 1rem;
          }
          
          .card-body {
            padding: 1rem;
          }
          
          .info-item {
            margin-bottom: 0.5rem;
          }
        }

        /* Accessibility improvements */
        .server-card:focus-within {
          outline: 3px solid rgba(0, 123, 255, 0.5);
          outline-offset: 2px;
        }

        /* Animation for loading states */
        .server-card.loading {
          opacity: 0.7;
          pointer-events: none;
        }

        .server-card.loading::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 40px;
          height: 40px;
          border: 4px solid rgba(0, 123, 255, 0.1);
          border-top: 4px solid var(--primary-color);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          z-index: 10;
        }

        @keyframes spin {
          0% { transform: translate(-50%, -50%) rotate(0deg); }
          100% { transform: translate(-50%, -50%) rotate(360deg); }
        }
      `}</style>
      <div
        className="server-card card mb-4 shadow-lg border-0 rounded-xl overflow-hidden"
        role="region"
        aria-labelledby={`server-title-${id}`}
        onClick={handleView}
      >
        <div className="card-header d-flex justify-content-between align-items-center px-4 py-3">
          <h5 id={`server-title-${id}`} className="m-0 text-lg">
            <i className="fas fa-server me-2"></i>
            {name} 
            {is_backup && <span className="badge bg-warning ms-2">احتياطي</span>}
          </h5>
          <HeartbeatBadge 
            timestamp={heartbeat} 
            serverStatus={status}
            isOnline={status === 'متصل' || status === 'online' || status === 'active'}
          />
        </div>

        <div className="card-body px-4 py-3">
          <div className="row">
            <div className="col-md-6">
              <p className="info-item text-md">
                <i className="fas fa-network-wired text-primary"></i>
                <strong>العنوان:</strong> 
                <span className="text-primary ms-1">{address}</span>
              </p>
              <p className="info-item text-md">
                <i className={`fas fa-circle ${status === 'متصل' || status === 'online' || status === 'active' ? 'text-success' : 'text-warning'}`}></i>
                <strong>الحالة:</strong> 
                <span className={status === 'متصل' || status === 'online' || status === 'active' ? 'text-success' : 'text-warning'}>
                  {status === 'متصل' || status === 'online' || status === 'active' ? 'متصل' : 'غير متاح'}
                </span>
              </p>
              <p className="info-item text-md">
                <i className="fas fa-plug text-info"></i>
                <strong>المنافذ:</strong> 
                <span className="text-info ms-1">{active_ports_count} منفذ نشط</span>
              </p>
            </div>
            <div className="col-md-6">
              <p className="info-item text-md">
                <i className="fas fa-desktop text-secondary"></i>
                <strong>الأجهزة المرتبطة:</strong> 
                <span className="ms-1">{connected_devices_count} جهاز</span>
              </p>
              <p className="info-item text-md">
                <i className="fas fa-bolt text-warning"></i>
                <strong>الطاقة الكلية:</strong> 
                <span className={`${total_power_consumption > 100 ? 'text-danger fw-bold' : ''} ms-1`}>
                  {total_power_consumption} W
                </span> 
                {total_power_consumption > 100 && <FaBolt className="text-danger ms-1" title="تنبيه: استهلاك مرتفع" />}
              </p>
              <p className="info-item text-md">
                <i className="fas fa-certificate text-success"></i>
                <strong>الترخيص:</strong> 
                <span className={`${licensed ? 'text-success' : 'text-danger'} ms-1`}>
                  {licensed ? 'مرخص' : 'غير مرخص'}
                </span>
              </p>
            </div>
          </div>
          {system_specs && (
            <p className="info-item text-md mt-2">
              <i className="fas fa-cogs text-muted"></i>
              <strong>مواصفات النظام:</strong> 
              <span className="text-muted ms-1">{system_specs}</span>
            </p>
          )}
          {heartbeat && (
            <p className="info-item text-sm text-muted mt-2 mb-0" aria-label={`آخر تواصل قبل ${formatRelativeTime(heartbeat)}`}>
              <i className="fas fa-clock"></i>
              آخر تواصل: <time dateTime={heartbeat}>{formatRelativeTime(heartbeat)}</time>
            </p>
          )}
          {/* تحكم في المنافذ */}
          <div className="port-control">
            <strong>تحكم في المنافذ:</strong>
            <div className="d-flex flex-wrap gap-2 mt-1">
              {ports && ports.length > 0 ? ports.map(port => (
                <div key={port} className="d-flex align-items-center ms-2">
                  <span className="badge bg-secondary me-1">{port}</span>
                  {canControl && <>
                    <button className="btn btn-xs btn-outline-success mx-1" title="تفعيل المنفذ" disabled={portLoading[port]} onClick={e => { e.stopPropagation(); handlePortAction(port, 'enable'); }}>{portLoading[port] ? <span className="spinner-border spinner-border-sm" /> : <FaPlug />}</button>
                    <button className="btn btn-xs btn-outline-danger mx-1" title="تعطيل المنفذ" disabled={portLoading[port]} onClick={e => { e.stopPropagation(); handlePortAction(port, 'disable'); }}>{portLoading[port] ? <span className="spinner-border spinner-border-sm" /> : <FaBan />}</button>
                  </>}
                </div>
              )) : <span className="text-muted">لا يوجد منافذ</span>}
            </div>
          </div>
        </div>

        <div className="card-footer d-flex justify-content-end px-4 py-3">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={e => { e.stopPropagation(); handleView(); }}
            aria-label={`عرض تفاصيل الخادم ${name}`}
          >
            <i className="fas fa-eye me-1"></i>
            عرض التفاصيل
          </button>
        </div>
      </div>
    </>
  );
});

ServerCard.displayName = 'ServerCard';

ServerCard.propTypes = {
  server: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    name: PropTypes.string.isRequired,
    address: PropTypes.string.isRequired,
    ports: PropTypes.arrayOf(PropTypes.string),
    lastHeartbeat: PropTypes.string, // ISO timestamp
    status: PropTypes.string,
    is_backup: PropTypes.bool,
    system_specs: PropTypes.string,
    connected_devices_count: PropTypes.number,
    total_power_consumption: PropTypes.number,
    active_ports_count: PropTypes.number,
  }).isRequired,
  onClick: PropTypes.func,
};

export default ServerCard;