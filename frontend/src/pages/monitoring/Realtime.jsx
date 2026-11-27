// src/pages/monitoring/Realtime.jsx

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import  useSocket  from '../../hooks/useSocket';
import { formatDateTime } from '../../utils/formatters';
import StatusBadge from '../../components/StatusBadge';

const EVENT_TYPES = [
  { value: 'all', label: 'جميع الأحداث' },
  { value: 'device_pending_approval', label: 'انتظار الموافقة' },
  { value: 'device_connected', label: 'اتصال جهاز' },
  { value: 'device_disconnected', label: 'فصل جهاز' },
  { value: 'device_blocked', label: 'محاولة حظر' },
];

const EVENT_STYLE_MAP = {
  device_pending_approval: { color: 'warning', icon: 'hourglass-half', text: 'بانتظار الموافقة' },
  device_connected:        { color: 'success', icon: 'plug',             text: 'تم الاتصال' },
  device_disconnected:     { color: 'warning', icon: 'unlink',           text: 'تم الفصل' },
  device_blocked:          { color: 'danger',  icon: 'ban',              text: 'محظور' },
};

const Realtime = () => {
  const [events, setEvents] = useState([]);
  const [activeDevices, setActiveDevices] = useState([]);
  const [stats, setStats] = useState({
    connectionsToday: 0,
    disconnectionsToday: 0,
    blockedAttemptsToday: 0,
    activeDevicesCount: 0,
  });
  const [monitoring, setMonitoring] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('all');
  const endRef = useRef(null);

  const { isConnected, error, connect, disconnect, on, off } = useSocket();

  // Toggle monitoring
  useEffect(() => {
    if (monitoring) connect();
    else disconnect();
    return () => disconnect();
  }, [monitoring, connect, disconnect]);

  // Update stats per event
  const updateStats = useCallback(evt => {
    setStats(s => {
      const next = { ...s };
      switch (evt.event_type) {
        case 'device_connected':     next.connectionsToday++;     break;
        case 'device_disconnected':  next.disconnectionsToday++;  break;
        case 'device_blocked':       next.blockedAttemptsToday++; break;
        default: break;
      }
      return next;
    });
  }, []);

  // Handle incoming events
  const handleEvent = useCallback(data => {
    setEvents(evs => [data, ...evs].slice(0, 100));
    updateStats(data);
  }, [updateStats]);

  // Handle active-devices update
  const handleDevices = useCallback(({ devices = [] }) => {
    setActiveDevices(devices);
    setStats(s => ({ ...s, activeDevicesCount: devices.length }));
  }, []);

  // Handle overall stats update
  const handleStats = useCallback(data => {
    setStats(s => ({ ...s, ...data }));
  }, []);

  // Subscribe to socket channels
  useEffect(() => {
    if (!isConnected) return;
    on('device_pending_approval', handleEvent);
    on('device_connected',         handleEvent);
    on('device_disconnected',      handleEvent);
    on('device_blocked',           handleEvent);
    on('active_devices_update',    handleDevices);
    on('stats_update',             handleStats);
    return () => {
      off('device_pending_approval', handleEvent);
      off('device_connected',         handleEvent);
      off('device_disconnected',      handleEvent);
      off('device_blocked',           handleEvent);
      off('active_devices_update',    handleDevices);
      off('stats_update',             handleStats);
    };
  }, [isConnected, on, off, handleEvent, handleDevices, handleStats]);

  // Auto-scroll on new events
  useEffect(() => {
    if (autoScroll && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events, autoScroll]);

  // Filtered events
  const filtered = useMemo(() => {
    return filter === 'all'
      ? events
      : events.filter(e => e.event_type === filter);
  }, [events, filter]);

  return (
    <div className="realtime-page">
      <header className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h1>المراقبة المباشرة</h1>
          <p className="text-muted">نشاط الأجهزة في الوقت الفعلي</p>
        </div>
        <div className="form-check form-switch">
          <input
            id="monitorToggle"
            className="form-check-input"
            type="checkbox"
            checked={monitoring}
            onChange={() => setMonitoring(m => !m)}
          />
          <label className="form-check-label" htmlFor="monitorToggle">
            {monitoring ? 'متصل' : 'موقوف'}
          </label>
        </div>
      </header>

      {monitoring && !isConnected && (
        <div className="alert alert-warning">
          <i className="fas fa-sync fa-spin me-2" />
          جارٍ الاتصال...
        </div>
      )}
      {error && (
        <div className="alert alert-danger">
          <i className="fas fa-exclamation-triangle me-2" />
          خطأ: {error}
        </div>
      )}

      {/* Stats cards */}
      <div className="row mb-4">
        {[
          { label: 'أجهزة نشطة',         value: stats.activeDevicesCount,   icon: 'hdd',    color: 'primary' },
          { label: 'اتصالات اليوم',      value: stats.connectionsToday,     icon: 'plug',   color: 'success' },
          { label: 'انفصالات اليوم',     value: stats.disconnectionsToday,  icon: 'unlink', color: 'warning' },
          { label: 'محاولات محظورة',    value: stats.blockedAttemptsToday, icon: 'ban',    color: 'danger' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="col-md-3 mb-3">
            <div className={`card h-100 border-${color}`}>
              <div className="card-body d-flex justify-content-between align-items-center">
                <div>
                  <h6 className={`text-${color}`}>{label}</h6>
                  <p className={`display-4 text-${color}`}>{value}</p>
                </div>
                <i className={`fas fa-${icon} fa-3x text-${color} opacity-25`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row">
        {/* Events log */}
        <div className="col-lg-8 mb-4">
          <div className="card h-100">
            <div className="card-header d-flex justify-content-between align-items-center">
              <h5>سجل الأحداث</h5>
              <div className="d-flex align-items-center">
                <div className="form-check me-3">
                  <input
                    id="autoScroll"
                    className="form-check-input"
                    type="checkbox"
                    checked={autoScroll}
                    onChange={() => setAutoScroll(a => !a)}
                  />
                  <label className="form-check-label" htmlFor="autoScroll">
                    تمرير تلقائي
                  </label>
                </div>
                <select
                  className="form-select form-select-sm"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                >
                  {EVENT_TYPES.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="card-body p-0" style={{ maxHeight: '500px', overflowY: 'auto' }}>
              {filtered.length === 0 ? (
                <div className="text-center py-5 text-muted">
                  <i className="fas fa-stream fa-3x mb-3" />
                  <p>لا توجد أحداث</p>
                </div>
              ) : (
                filtered.map((evt, idx) => {
                  const style = EVENT_STYLE_MAP[evt.event_type] || { color: 'secondary', icon: 'info-circle' };
                  return (
                    <div key={idx} className={`d-flex align-items-center p-2 border-bottom border-${style.color}`}>
                      <div className="me-3 text-muted small">{formatDateTime(evt.timestamp)}</div>
                      <div className="me-3">
                        <i className={`fas fa-${style.icon} text-${style.color}`} />
                      </div>
                      <div>
                        <strong>{style.text}</strong> — {evt.message}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={endRef} />
            </div>
          </div>
        </div>

        {/* Active devices */}
        <div className="col-lg-4 mb-4">
          <div className="card h-100">
            <div className="card-header">
              <h5>أجهزة نشطة ({activeDevices.length})</h5>
            </div>
            <div className="card-body p-0" style={{ maxHeight: '500px', overflowY: 'auto' }}>
              {activeDevices.length === 0 ? (
                <div className="text-center py-5 text-muted">
                  <i className="fas fa-usb fa-3x mb-3" />
                  <p>لا توجد أجهزة نشطة</p>
                </div>
              ) : (
                <ul className="list-group list-group-flush">
                  {activeDevices.map(dev => (
                    <li key={dev.serial_number} className="list-group-item">
                      <div className="d-flex justify-content-between align-items-center">
                        <div>
                          <div><strong>{dev.name || 'جهاز غير معروف'}</strong></div>
                          <small className="text-muted">{dev.serial_number}</small>
                        </div>
                        <StatusBadge status={dev.status} />
                      </div>
                      <small className="text-muted d-block mt-1">
                        <i className="fas fa-clock me-1" />
                        منذ {formatDateTime(dev.connected_at)}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="alert alert-info">
          هذه الواجهة تعرض النشاط في الوقت الفعلي وتعطيك رؤية فورية للأجهزة والأحداث.
        </div>
      </div>
    </div>
  );
};

export default Realtime;
