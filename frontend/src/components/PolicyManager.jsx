import React, { useState, useMemo } from 'react';
import PropTypes from 'prop-types';
import { FaEdit, FaTrash, FaCheck, FaTimes, FaPlay, FaPause, FaPlus } from 'react-icons/fa';
import useAuth from '../hooks/useAuth';
import useSocket from '../hooks/useSocket';
import {
  createPolicy,
  updatePolicy,
  activatePolicy,
  deactivatePolicy,
  deletePolicy
} from '../utils/api';

const PolicyManager = ({ policies, isAdmin, onChange }) => {
  const { currentUser } = useAuth();
  useSocket('policy:created', () => {});
  useSocket('policy:updated', () => {});
  useSocket('policy:activated', () => {});
  useSocket('policy:deactivated', () => {});
  useSocket('policy:deleted', () => {});

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canEdit = isAdmin || (currentUser && (currentUser.role === 'manager' || (Array.isArray(currentUser.roles) && currentUser.roles.includes('manager'))));

  const handleEdit = (policy) => {
    setEditing(policy.id);
    setForm({ ...policy });
  };
  const handleCancel = () => {
    setEditing(null);
    setForm({});
  };
  const handleChange = (e) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  };
  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      let payload = { ...form };
      // تأكد من أن rules كائن وليس نص
      if (typeof payload.rules === 'string') {
        try {
          payload.rules = JSON.parse(payload.rules);
        } catch {
          setError('صيغة القواعد الذكية (rules) غير صحيحة. يجب أن تكون JSON.');
          setLoading(false);
          return;
        }
      }
      if (editing === 'new') {
        await createPolicy(payload);
      } else {
        await updatePolicy(editing, payload);
      }
      setEditing(null);
      setForm({});
      if (onChange) onChange();
    } catch (e) {
      setError('فشل الحفظ: تحقق من صحة البيانات');
    } finally {
      setLoading(false);
    }
  };
  const handleActivate = async (id) => { setLoading(true); await activatePolicy(id); setLoading(false); if (onChange) onChange(); };
  const handleDeactivate = async (id) => { setLoading(true); await deactivatePolicy(id); setLoading(false); if (onChange) onChange(); };
  const handleDelete = async (id) => { if (window.confirm('تأكيد حذف السياسة؟')) { setLoading(true); await deletePolicy(id); setLoading(false); if (onChange) onChange(); } };
  const handleAdd = () => { setEditing('new'); setForm({ name: '', policy_type: '', device_pattern: '', is_active: true, auto_apply: false, schedule: '', rules: '{}' }); };

  const sortedPolicies = useMemo(() => (Array.isArray(policies) ? [...policies].sort((a, b) => b.id - a.id) : []), [policies]);

  return (
    <div className="card shadow-sm mb-3">
      <div className="card-header d-flex justify-content-between align-items-center">
        <strong>جميع السياسات الأمنية</strong>
        {canEdit && <button className="btn btn-sm btn-success" onClick={handleAdd}><FaPlus /> إضافة سياسة</button>}
      </div>
      <div className="card-body p-0">
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="table-responsive">
          <table className="table table-bordered table-striped mb-0">
            <thead className="thead-light">
              <tr>
                <th>الاسم</th>
                <th>النوع</th>
                <th>النمط</th>
                <th>مفعلة</th>
                <th>تلقائي</th>
                <th>جدولة</th>
                <th>القواعد الذكية</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {editing === 'new' && (
                <tr>
                  <td><input name="name" value={form.name} onChange={handleChange} className="form-control form-control-sm" /></td>
                  <td><input name="policy_type" value={form.policy_type} onChange={handleChange} className="form-control form-control-sm" /></td>
                  <td><input name="device_pattern" value={form.device_pattern} onChange={handleChange} className="form-control form-control-sm" /></td>
                  <td><input type="checkbox" name="is_active" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} /></td>
                  <td><input type="checkbox" name="auto_apply" checked={form.auto_apply} onChange={e => setForm(f => ({ ...f, auto_apply: e.target.checked }))} /></td>
                  <td><input name="schedule" value={form.schedule} onChange={handleChange} className="form-control form-control-sm" /></td>
                  <td><input name="rules" value={form.rules} onChange={handleChange} className="form-control form-control-sm" placeholder="{ &quot;read_only&quot;: true }" /></td>
                  <td>
                    <button className="btn btn-sm btn-success mr-1" onClick={handleSave} disabled={loading}><FaCheck /></button>
                    <button className="btn btn-sm btn-secondary" onClick={handleCancel}><FaTimes /></button>
                  </td>
                </tr>
              )}
              {sortedPolicies.map(policy => {
                // دعم تحويل rules من نص إلى كائن عند العرض
                let rulesObj = policy.rules;
                if (typeof rulesObj === 'string') {
                  try { rulesObj = JSON.parse(rulesObj); } catch { rulesObj = {}; }
                }
                return editing === policy.id ? (
                  <tr key={policy.id}>
                    <td><input name="name" value={form.name} onChange={handleChange} className="form-control form-control-sm" /></td>
                    <td><input name="policy_type" value={form.policy_type} onChange={handleChange} className="form-control form-control-sm" /></td>
                    <td><input name="device_pattern" value={form.device_pattern} onChange={handleChange} className="form-control form-control-sm" /></td>
                    <td><input type="checkbox" name="is_active" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} /></td>
                    <td><input type="checkbox" name="auto_apply" checked={form.auto_apply} onChange={e => setForm(f => ({ ...f, auto_apply: e.target.checked }))} /></td>
                    <td><input name="schedule" value={form.schedule} onChange={handleChange} className="form-control form-control-sm" /></td>
                    <td><input name="rules" value={form.rules} onChange={handleChange} className="form-control form-control-sm" placeholder="{ &quot;read_only&quot;: true }" /></td>
                    <td>
                      <button className="btn btn-sm btn-success mr-1" onClick={handleSave} disabled={loading}><FaCheck /></button>
                      <button className="btn btn-sm btn-secondary" onClick={handleCancel}><FaTimes /></button>
                    </td>
                  </tr>
                ) : (
                  <tr key={policy.id}>
                    <td>{policy.name}</td>
                    <td>{policy.policy_type}</td>
                    <td>{policy.device_pattern}</td>
                    <td>{policy.is_active ? <FaCheck className="text-success" /> : <FaTimes className="text-danger" />}</td>
                    <td>{policy.auto_apply ? <FaCheck className="text-success" /> : <FaTimes className="text-danger" />}</td>
                    <td>{policy.schedule || '—'}</td>
                    <td>
                      {rulesObj && typeof rulesObj === 'object' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {rulesObj.read_only && (
                            <span title="تفعيل وضع القراءة فقط"><i className="fas fa-lock text-primary" /> قراءة فقط</span>
                          )}
                          {rulesObj.max_file_size && (
                            <span title={`الحد الأقصى لحجم الملف: ${rulesObj.max_file_size}MB`}><i className="fas fa-file-alt text-info" /> {rulesObj.max_file_size}MB</span>
                          )}
                          {Array.isArray(rulesObj.block_if_after_hours) && (
                            <span title={`الحظر من ${rulesObj.block_if_after_hours[0]} إلى ${rulesObj.block_if_after_hours[1]} ساعة`}><i className="fas fa-clock text-warning" /> {rulesObj.block_if_after_hours[0]}-{rulesObj.block_if_after_hours[1]}</span>
                          )}
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{Object.keys(rulesObj).filter(k => !['read_only','max_file_size','block_if_after_hours'].includes(k)).length > 0 ? JSON.stringify(Object.fromEntries(Object.entries(rulesObj).filter(([k]) => !['read_only','max_file_size','block_if_after_hours'].includes(k))) : ''}</span>
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {canEdit && <>
                        <button className="btn btn-xs btn-outline-primary mr-1" onClick={() => handleEdit(policy)} title="تعديل"><FaEdit /></button>
                        {policy.is_active ? (
                          <button className="btn btn-xs btn-outline-warning mr-1" onClick={() => handleDeactivate(policy.id)} title="تعطيل"><FaPause /></button>
                        ) : (
                          <button className="btn btn-xs btn-outline-success mr-1" onClick={() => handleActivate(policy.id)} title="تفعيل"><FaPlay /></button>
                        )}
                        <button className="btn btn-xs btn-outline-danger" onClick={() => handleDelete(policy.id)} title="حذف"><FaTrash /></button>
                      </>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

PolicyManager.propTypes = {
  policies: PropTypes.array,
  isAdmin: PropTypes.bool,
  onChange: PropTypes.func,
};

export default PolicyManager; 