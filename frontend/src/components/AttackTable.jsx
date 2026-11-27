// src/components/AttackTable.jsx

import React, { useState, useEffect, useCallback } from 'react';
import Modal from './Modal';
import { fetchAttacks, confirmAttack } from '../utils/api';
import { formatRelativeTime, formatEventType } from '../utils/formatters';
import useAuth from '../hooks/useAuth';
import useSocket from '../hooks/useSocket';


const AttackTable = () => {
  const [attacks, setAttacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmingId, setConfirmingId] = useState(null);
  const [modalAttack, setModalAttack] = useState(null);
  const [expanded, setExpanded] = useState({});
  const { currentUser } = useAuth();
  const { subscribe: subscribeSocket, isConnected } = useSocket();

  useEffect(() => {
    if (!isConnected) return;
    const unsubAttack = subscribeSocket('attack:detected', atk => atk && setAttacks(prev => [atk, ...prev]));
    const unsubConfirm = subscribeSocket('attack:confirmed', atk => atk && setAttacks(prev => prev.map(a => a.id === atk.id ? atk : a)));
    return () => {
      unsubAttack?.();
      unsubConfirm?.();
    };
  }, [subscribeSocket, isConnected]);

  // جلب الأحداث من الـ API
  const loadAttacks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetchAttacks();
      setAttacks(resp.data.attacks || []);
    } catch (e) {
      console.error(e);
      setError(e.message || 'فشل في جلب أحداث الهجوم');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAttacks();
  }, [loadAttacks]);

  // فتح نافذة التأكيد
  const openConfirmModal = (attack) => {
    setModalAttack(attack);
  };

  // إغلاق نافذة التأكيد
  const closeModal = () => {
    setModalAttack(null);
  };

  // تأكيد الهجوم فعلياً
  const handleConfirm = async () => {
    if (!modalAttack) return;
    setConfirmingId(modalAttack.id);
    closeModal();
    try {
      await confirmAttack(modalAttack.id);
      await loadAttacks();
    } catch (e) {
      console.error('خطأ أثناء تأكيد الهجوم:', e);
    } finally {
      setConfirmingId(null);
    }
  };

  // RBAC: هل المستخدم Admin أو Manager؟
  const isAdmin = currentUser && (currentUser.role === 'admin' || (Array.isArray(currentUser.roles) && currentUser.roles.includes('admin')));
  const isManager = currentUser && (currentUser.role === 'manager' || (Array.isArray(currentUser.roles) && currentUser.roles.includes('manager')));
  const canConfirm = isAdmin || isManager;

  if (loading) {
    return (
      <div className="d-flex justify-center align-center p-4">
        <span className="spinner-border" role="status" aria-label="جار التحميل" />
        <span className="mr-2">جاري التحميل...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-danger m-3 d-flex align-center">
        <i className="fas fa-exclamation-circle mr-2" aria-hidden="true" />
        {error}
      </div>
    );
  }

  if (!attacks.length) {
    return (
      <div className="text-center text-muted p-4">
        لا توجد أحداث هجوم للعرض
      </div>
    );
  }

  return (
    <>
      <div className="table-responsive attack-table">
        <table className="table table-hover mb-0">
          <thead className="thead-light">
            <tr>
              <th>الوقت</th>
              <th>النوع</th>
              <th>الشدة</th>
              <th>الوصف</th>
              <th>الجهاز</th>
              <th>الحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {attacks.map((atk) => (
              <React.Fragment key={atk.id}>
                <tr className={atk.confirmed ? 'bg-secondary' : ''}>
                  <td>
                    <time dateTime={atk.timestamp} title={atk.timestamp}>
                      {formatRelativeTime(atk.timestamp)}
                    </time>
                  </td>
                  <td>
                    <span className="badge bg-danger">
                      {formatEventType(atk.attack_type)}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${atk.severity === 'critical' ? 'bg-danger' : atk.severity === 'high' ? 'bg-warning' : 'bg-info'}`}>{atk.severity}</span>
                  </td>
                  <td>{atk.description || '—'}</td>
                  <td>{atk.target_device || '—'}</td>
                  <td className={atk.confirmed ? 'text-success' : 'text-warning'}>
                    {atk.confirmed ? 'مؤكد' : 'غير مؤكد'}
                  </td>
                  <td>
                    {canConfirm && !atk.confirmed && (
                      <button
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => openConfirmModal(atk)}
                        disabled={confirmingId === atk.id}
                        aria-label={`تأكيد الهجوم رقم ${atk.id}`}
                      >
                        {confirmingId === atk.id
                          ? <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                          : <><i className="fas fa-check ml-1" /> تأكيد</>
                        }
                      </button>
                    )}
                    <button className="btn btn-sm btn-outline-info ml-2" onClick={() => setExpanded(e => ({ ...e, [atk.id]: !e[atk.id] }))} aria-label="تفاصيل الهجوم">{expanded[atk.id] ? 'إخفاء' : 'تفاصيل'}</button>
                  </td>
                </tr>
                {expanded[atk.id] && (
                  <tr className="bg-light">
                    <td colSpan={7}>
                      <div className="p-2">
                        <div><strong>Vector:</strong> {atk.vector || '—'}</div>
                        <div><strong>Geo:</strong> {atk.geo_location || '—'}</div>
                        <div><strong>Impact:</strong> {atk.impact || '—'}</div>
                        <div><strong>Vulnerability:</strong> {atk.vulnerability || '—'}</div>
                        <div><strong>Exploit:</strong> {atk.exploit || '—'}</div>
                        <div><strong>Timeline:</strong> {atk.timeline ? JSON.stringify(atk.timeline) : '—'}</div>
                        <div><strong>Attacker Profile:</strong> {atk.attacker_profile ? JSON.stringify(atk.attacker_profile) : '—'}</div>
                        <div><strong>AI Analysis:</strong> {atk.analysis ? JSON.stringify(atk.analysis) : '—'}</div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {modalAttack && (
        <Modal
          show={true}
          title="تأكيد حدث الهجوم"
          onClose={closeModal}
          footer={
            <>
              <button className="btn btn-outline-secondary" onClick={closeModal}>إلغاء</button>
              <button className="btn btn-danger" onClick={handleConfirm}>تأكيد</button>
            </>
          }
        >
          <p>
            هل أنت متأكد من رغبتك في تأكيد الحدث رقم <strong>{modalAttack.id}</strong> من نوع <strong>{formatEventType(modalAttack.attack_type)}</strong>؟
          </p>
          {modalAttack.description && (
            <p className="text-muted mt-2">
              <em>"{modalAttack.description}"</em>
            </p>
          )}
        </Modal>
      )}
    </>
  );
};

export default React.memo(AttackTable);
