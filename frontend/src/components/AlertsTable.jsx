// src/components/AlertsTable.jsx

import React, { useState, useEffect, useCallback, Fragment } from 'react';
import PropTypes from 'prop-types';
import { formatPriority as formatAlertPriority, formatDateTime } from '../utils/formatters';
import { fetchAlerts, resolveAlert, resolveAllAlerts, deleteAlert } from '../utils/api';
import SearchFilter from './SearchFilter';
import { FaCheck, FaCheckDouble, FaSpinner, FaTrashAlt } from 'react-icons/fa';

const AlertsTable = ({
  initialFilters = {},
  showFilters = true,
  data: controlledData,
  loading: controlledLoading,
  onResolve,
  onDelete,
  pagination
}) => {
  const [alerts, setAlerts] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    limit: 20,
    offset: 0,
    priority: '',
    resolved: '',
    search: '',
    ...initialFilters,
  });
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState([]);

  const isControlled = controlledData != null && controlledLoading != null;
  const list = isControlled ? controlledData : alerts;
  const isLoading = isControlled ? controlledLoading : loading;

  const pageCount = Math.max(
    1,
    Math.ceil((isControlled ? pagination.total : total) / filters.limit)
  );
  const currentPage = Math.floor(filters.offset / filters.limit) + 1;

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { alerts: data, total: count } = await fetchAlerts(filters);
      setAlerts(data);
      setTotal(count);
      setSelected([]);
    } catch (e) {
      console.error(e);
      setError(e.message || 'فشل في جلب التنبيهات');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (!isControlled) loadAlerts();
  }, [loadAlerts, isControlled]);

  const updateFilters = useCallback(updates => {
    if (isControlled) {
      pagination.onPageChange(0);
    } else {
      setFilters(f => ({ ...f, ...updates, offset: 0 }));
    }
  }, [isControlled, pagination]);

  const toggleSelect = useCallback(id => {
    setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  }, []);

  const toggleAll = useCallback(() => {
    setSelected(s =>
      s.length === list.length ? [] : list.map(a => a.id)
    );
  }, [list]);

  const doResolve = useCallback(async ids => {
    if (!ids.length) return;
    setResolving(true);
    setError('');
    try {
      await Promise.all(ids.map(id => resolveAlert(id)));
      if (isControlled && onResolve) onResolve(ids);
      else await loadAlerts();
    } catch (e) {
      console.error(e);
      setError(e.message || 'خطأ أثناء حل التنبيهات');
    } finally {
      setResolving(false);
    }
  }, [isControlled, onResolve, loadAlerts]);

  const doResolveAll = useCallback(async () => {
    setResolving(true);
    setError('');
    try {
      await resolveAllAlerts(filters.priority || undefined);
      if (isControlled && onResolve) onResolve('all');
      else await loadAlerts();
    } catch (e) {
      console.error(e);
      setError(e.message || 'خطأ أثناء حل الكل');
    } finally {
      setResolving(false);
    }
  }, [filters.priority, isControlled, onResolve, loadAlerts]);

  const doDelete = useCallback(async id => {
    if (!window.confirm('هل تريد حذف هذا التنبيه نهائيًا؟ لا يمكن التراجع!')) return;
    setResolving(true);
    setError('');
    try {
      await deleteAlert(id);
      if (!isControlled) await loadAlerts();
      setSelected(s => s.filter(x => x !== id));
      if (isControlled && onDelete) onDelete(id);
    } catch (e) {
      console.error(e);
      setError(e.message || 'خطأ أثناء حذف التنبيه');
    } finally {
      setResolving(false);
    }
  }, [isControlled, onDelete, loadAlerts]);

  const goToPage = useCallback(page => {
    const idx = Math.max(1, Math.min(page, pageCount)) - 1;
    const newOffset = idx * filters.limit;
    if (isControlled) {
      pagination.onPageChange(newOffset);
    } else {
      setFilters(f => ({ ...f, offset: newOffset }));
    }
  }, [isControlled, pagination, pageCount, filters.limit]);

  return (
    <div className="card h-100 d-flex flex-column">
      <div className="d-flex justify-content-between align-items-center p-3 border-bottom">
        <h5 className="m-0">التنبيهات</h5>
        <div className="btn-group">
          <button
            className="btn btn-outline-success"
            disabled={!selected.length || resolving}
            onClick={() => doResolve(selected)}
          >
            <FaCheck /> حل ({selected.length})
          </button>
          <button
            className="btn btn-outline-warning"
            disabled={resolving}
            onClick={doResolveAll}
          >
            <FaCheckDouble /> حل الكل
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="p-3 border-bottom">
          <SearchFilter
            filters={filters}
            onFilterChange={updateFilters}
            onClearFilters={() =>
              updateFilters({ priority: '', resolved: '', search: '', limit: filters.limit })
            }
            options={{
              priority: [
                { value: '', label: 'الكل' },
                { value: 'high', label: 'عالية' },
                { value: 'normal', label: 'متوسطة' },
                { value: 'low', label: 'منخفضة' },
              ],
              resolved: [
                { value: '', label: 'الكل' },
                { value: 'false', label: 'غير محلولة' },
                { value: 'true', label: 'محلولة' },
              ],
              limit: [
                { value: 10, label: '10 / صفحة' },
                { value: 20, label: '20 / صفحة' },
                { value: 50, label: '50 / صفحة' },
                { value: 100, label: '100 / صفحة' },
              ],
            }}
          />
        </div>
      )}

      <div className="flex-fill overflow-auto">
        {isLoading ? (
          <div className="d-flex justify-content-center align-items-center p-4 gap-2">
            <FaSpinner className="spin text-primary" /> جاري التحميل...
          </div>
        ) : error ? (
          <div className="alert alert-danger m-3">{error}</div>
        ) : !list.length ? (
          <div className="text-center text-muted py-4">لا توجد تنبيهات</div>
        ) : (
          <Fragment>
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={selected.length === list.length && list.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>الوقت</th>
                  <th>الأولوية</th>
                  <th>الرسالة</th>
                  <th>الجهاز</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {list.map(a => (
                  <tr key={a.id} className={a.resolved ? 'bg-light' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        disabled={a.resolved}
                        checked={selected.includes(a.id)}
                        onChange={() => toggleSelect(a.id)}
                      />
                    </td>
                    <td>{formatDateTime(a.created_at)}</td>
                    <td>
                      <span className={`badge ${
                        a.priority === 'high'
                          ? 'bg-danger'
                          : a.priority === 'normal'
                            ? 'bg-warning text-dark'
                            : 'bg-success'
                      }`}>
                        {formatAlertPriority(a.priority)}
                      </span>
                    </td>
                    <td>{a.message}</td>
                    <td>{a.target_device || '—'}</td>
                    <td>
                      <span className={a.resolved ? 'text-success' : 'text-danger'}>
                        {a.resolved ? 'محلولة' : 'نشطة'}
                      </span>
                    </td>
                    <td className="d-flex gap-2">
                      {!a.resolved && (
                        <button
                          className="btn btn-sm btn-outline-success"
                          disabled={resolving}
                          onClick={() => doResolve([a.id])}
                        >
                          <FaCheck />
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-outline-danger"
                        disabled={resolving}
                        onClick={() => doDelete(a.id)}
                      >
                        <FaTrashAlt />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="d-flex justify-content-center p-3">
              <div className="btn-group">
                <button
                  className="btn btn-outline-secondary"
                  disabled={currentPage === 1}
                  onClick={() => goToPage(1)}
                >
                  «
                </button>
                <button
                  className="btn btn-outline-secondary"
                  disabled={currentPage === 1}
                  onClick={() => goToPage(currentPage - 1)}
                >
                  ‹
                </button>
                <span className="btn btn-light">
                  {currentPage} / {pageCount}
                </span>
                <button
                  className="btn btn-outline-secondary"
                  disabled={currentPage === pageCount}
                  onClick={() => goToPage(currentPage + 1)}
                >
                  ›
                </button>
                <button
                  className="btn btn-outline-secondary"
                  disabled={currentPage === pageCount}
                  onClick={() => goToPage(pageCount)}
                >
                  »
                </button>
              </div>
            </div>
          </Fragment>
        )}
      </div>
    </div>
  );
};

AlertsTable.propTypes = {
  initialFilters: PropTypes.object,
  showFilters: PropTypes.bool,
  data: PropTypes.array,
  loading: PropTypes.bool,
  onResolve: PropTypes.func,
  onDelete: PropTypes.func,
  pagination: PropTypes.shape({
    total: PropTypes.number.isRequired,
    onPageChange: PropTypes.func.isRequired,
  }),
};

export default AlertsTable;

