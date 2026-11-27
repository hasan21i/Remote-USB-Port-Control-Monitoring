// src/pages/admin/Users.jsx

import React, { useState, useEffect } from 'react';
import {
  fetchUsers,
  createUser,
  updateUser,
  deleteUser,
  fetchUserStats,
} from '../../utils/api';
import { isValidEmail, isValidPassword } from '../../utils/validators';
import Modal from '../../components/Modal';

const Users = () => {
  const [users, setUsers] = useState([]);
  const [userStats, setUserStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState({ open: false, userId: null });
  const [formUser, setFormUser] = useState({
    id: null,
    username: '',
    email: '',
    password: '',
    role: 'user',
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // جلب المستخدمين والإحصائيات
  useEffect(() => {
    loadUsers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadUsers = async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
      setError('');
    }
    
    try {
      if (showLoading) {
        // console.log('جاري جلب بيانات المستخدمين...');
      }
      
      // جلب المستخدمين أولاً
      const usersResponse = await fetchUsers();
      // console.log('Users response:', usersResponse);
      
      // معالجة بيانات المستخدمين
      const usersData = usersResponse.users || [];
      if (showLoading) {
        // console.log('Processed users data:', usersData);
      }
      setUsers(usersData);
      
      // جلب الإحصائيات فقط عند التحميل الأول
      if (showLoading) {
        try {
          const statsResponse = await fetchUserStats();
          // console.log('Stats response:', statsResponse);
          setUserStats(statsResponse);
        } catch (statsErr) {
          // console.warn('Error loading stats:', statsErr);
          // لا نعرض خطأ للإحصائيات لأنها غير ضرورية
          setUserStats({});
        }
      }
      
      // إذا لم توجد مستخدمين، عرض رسالة مفيدة فقط عند التحميل الأول
      if (usersData.length === 0 && showLoading && !message.text) {
        setMessage({ 
          type: 'info', 
          text: 'لا يوجد مستخدمين في النظام. يمكنك إضافة مستخدم جديد باستخدام الزر أعلاه.' 
        });
      }
    } catch (err) {
      // console.error('Error loading users:', err);
      // console.error('Error details:', {
      //   message: err.message,
      //   status: err.response?.status,
      //   data: err.response?.data,
      //   config: err.config
      // });
      
      // رسالة أكثر تفصيلاً للأخطاء فقط عند التحميل الأول
      if (showLoading) {
        if (err.response?.status === 403) {
          setError('ليس لديك صلاحية لعرض المستخدمين. تأكد من أن لديك دور مدير.');
        } else if (err.response?.status === 401) {
          setError('جلسة منتهية الصلاحية. يرجى تسجيل الدخول مرة أخرى.');
        } else if (err.response?.status === 500) {
          setError('خطأ في الخادم. تأكد من أن قاعدة البيانات تعمل بشكل صحيح.');
        } else if (err.response?.status === 404) {
          setError('المسار غير موجود. تأكد من أن الخادم يعمل بشكل صحيح.');
        } else if (!err.response) {
          setError('لا يمكن الاتصال بالخادم. تأكد من أن الخادم يعمل على المنفذ الصحيح.');
        } else {
          setError(`خطأ في الاتصال: ${err.response?.data?.error || err.message}`);
        }
      }
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  const filtered = users.filter(u =>
    [u.username, u.email, u.role, u.name]
      .some(field => field?.toLowerCase().includes(search.toLowerCase()))
  );

  // التعامل مع الحقول
  const onChange = e => {
    const { name, value, type, checked } = e.target;
    setFormUser(f => ({
      ...f,
      [name]: type === 'checkbox' ? checked : value
    }));
    setErrors(err => ({ ...err, [name]: null }));
  };

  // التحقق من الصحة
  const validate = (data, isEdit) => {
    const err = {};
    if (!data.username.trim()) err.username = 'مطلوب';
    if (!data.email.trim() || !isValidEmail(data.email)) err.email = 'بريد غير صالح';
    if (!isEdit && (!data.password || !isValidPassword(data.password)))
      err.password = '8+ أحرف، حرف كبير، صغير ورقم';
    return { valid: Object.keys(err).length === 0, err };
  };

  // إضافة أو تعديل
  const onSubmit = async e => {
    e.preventDefault();
    setSubmitting(true);
    setMessage({ type: '', text: '' });
    
    const isEdit = !!formUser.id;
    const { valid, err } = validate(formUser, isEdit);
    if (!valid) {
      setErrors(err);
      setSubmitting(false);
      return;
    }
    
    try {
      // console.log('جاري حفظ المستخدم:', { isEdit, formUser });
      
      if (isEdit) {
        const payload = { ...formUser };
        if (!payload.password) delete payload.password;
        const result = await updateUser(formUser.id, payload);
        // console.log('Update result:', result);
        setMessage({ type: 'success', text: 'تم تحديث المستخدم بنجاح' });
        
        // تحديث البيانات المحلية مباشرة مع البيانات المحدثة من الخادم
        if (result && result.user) {
          setUsers(prevUsers => 
            prevUsers.map(user => 
              user.id === formUser.id 
                ? {
                    ...user,
                    username: result.user.username,
                    name: result.user.name,
                    email: result.user.email,
                    role: result.user.role,
                    status: result.user.status
                  }
                : user
            )
          );
        } else {
          // إذا لم يتم إرجاع بيانات محدثة، إعادة تحميل كاملة
          await loadUsers(false);
        }
      } else {
        const payload = { ...formUser };
        const result = await createUser(payload);
        // console.log('Create result:', result);
        setMessage({ type: 'success', text: 'تم إضافة المستخدم بنجاح' });
        
        // إضافة المستخدم الجديد للقائمة المحلية
        if (result && result.user) {
          setUsers(prevUsers => [...prevUsers, result.user]);
        } else {
          // إذا لم يتم إرجاع بيانات المستخدم الجديد، إعادة تحميل كاملة
          await loadUsers(false);
        }
      }
      
      setShowAdd(false);
      setShowEdit(false);
    } catch (err) {
      // console.error('Error saving user:', err);
      // console.error('Error details:', {
      //   message: err.message,
      //   status: err.response?.status,
      //   data: err.response?.data
      // });
      
      let errorMessage = 'حدث خطأ أثناء العملية';
      
      if (err.response?.status === 400) {
        errorMessage = err.response.data.error || 'بيانات غير صحيحة';
      } else if (err.response?.status === 409) {
        errorMessage = 'المستخدم موجود بالفعل';
      } else if (err.response?.status === 403) {
        errorMessage = 'ليس لديك صلاحية لإجراء هذه العملية';
      } else if (err.response?.status === 401) {
        errorMessage = 'جلسة منتهية الصلاحية';
      } else if (err.response?.data?.error) {
        errorMessage = err.response.data.error;
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setMessage({ type: 'danger', text: errorMessage });
    } finally {
      setSubmitting(false);
    }
  };

  // تأكيد الحذف
  const confirmRemove = id => setConfirmDelete({ open: true, userId: id });

  const doDelete = async () => {
    setSubmitting(true);
    setMessage({ type: '', text: '' });
    
    try {
      // console.log('جاري حذف المستخدم:', confirmDelete.userId);
      const _result = await deleteUser(confirmDelete.userId);
      // console.log('Delete result:', _result);
      setMessage({ type: 'success', text: 'تم حذف المستخدم بنجاح' });
      
      // إزالة المستخدم من القائمة المحلية مباشرة
      setUsers(prevUsers => prevUsers.filter(user => user.id !== confirmDelete.userId));
    } catch (err) {
      // console.error('Error deleting user:', err);
      // console.error('Error details:', {
      //   message: err.message,
      //   status: err.response?.status,
      //   data: err.response?.data
      // });
      
      let errorMessage = 'حدث خطأ أثناء الحذف';
      
      if (err.response?.status === 404) {
        errorMessage = 'المستخدم غير موجود';
      } else if (err.response?.status === 403) {
        errorMessage = 'ليس لديك صلاحية لحذف هذا المستخدم';
      } else if (err.response?.status === 400) {
        errorMessage = err.response.data.error || 'لا يمكن حذف المستخدم';
      } else if (err.response?.data?.error) {
        errorMessage = err.response.data.error;
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setMessage({ type: 'danger', text: errorMessage });
    } finally {
      setSubmitting(false);
      setConfirmDelete({ open: false, userId: null });
    }
  };



  // إخفاء الرسائل بعد 5 ثواني
  useEffect(() => {
    if (message.text) {
      const timer = setTimeout(() => {
        setMessage({ type: '', text: '' });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // إخفاء الأخطاء بعد 8 ثواني
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError('');
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  return (
    <div className="container-fluid py-4 users-page">
      {/* Header */}
      <div className="users-header fade-in">
        <div className="d-flex justify-content-between align-items-center">
          <div>
            <h1 className="h3 mb-0 text-primary fw-bold">
              <i className="fas fa-users me-2"></i>
              إدارة المستخدمين
            </h1>
            <p className="text-muted mb-0">إدارة حسابات المستخدمين والصلاحيات</p>
          </div>
          <button 
            className="btn btn-primary btn-lg shadow-sm" 
            onClick={() => {
              setFormUser({
                id: null, username: '', email: '', password: '', role: 'user'
              });
              setShowAdd(true);
            }}
          >
            <i className="fas fa-plus me-2"></i>
            مستخدم جديد
          </button>
        </div>
      </div>

      {/* رسائل النظام */}
      {error && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          <i className="fas fa-exclamation-triangle me-2"></i>
          {error}
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      {message.text && (
        <div className={`alert alert-${message.type} alert-dismissible fade show`} role="alert">
          <i className={`fas fa-${message.type === 'success' ? 'check-circle' : 'exclamation-triangle'} me-2`}></i>
          {message.text}
          <button type="button" className="btn-close" onClick={() => setMessage({ type: '', text: '' })}></button>
        </div>
      )}

      {/* إحصائيات المستخدمين */}
      {userStats && Object.keys(userStats).length > 0 && (
        <div 
          className="dashboard-cards-grid mb-4 fade-in"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.7rem',
            justifyContent: 'center',
            marginBottom: '2.2rem',
          }}
        >
          {/* البطاقة الأولى - إجمالي المستخدمين */}
          <div
            className="card dashboard-card shadow-sm text-center bg-primary text-white"
            style={{
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
              <i className="fas fa-users fa-2x mb-2" style={{ opacity: 0.92 }} />
              <h6 className="card-title text-white mb-1" style={{ fontSize: 17 }}>إجمالي المستخدمين</h6>
              <div className="display-5 fw-bold" style={{ fontSize: 33 }}>{userStats.total_users || 0}</div>
            </div>
          </div>

          {/* البطاقة الثانية - المستخدمين النشطين */}
          <div
            className="card dashboard-card shadow-sm text-center bg-success text-white"
            style={{
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
              <i className="fas fa-user-check fa-2x mb-2" style={{ opacity: 0.92 }} />
              <h6 className="card-title text-white mb-1" style={{ fontSize: 17 }}>المستخدمين النشطين</h6>
              <div className="display-5 fw-bold" style={{ fontSize: 33 }}>{userStats.active_users || 0}</div>
            </div>
          </div>

          {/* البطاقة الثالثة - المستخدمين الجدد */}
          <div
            className="card dashboard-card shadow-sm text-center bg-info text-white"
            style={{
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
              <i className="fas fa-user-plus fa-2x mb-2" style={{ opacity: 0.92 }} />
              <h6 className="card-title text-white mb-1" style={{ fontSize: 17 }}>المستخدمين الجدد</h6>
              <div className="display-5 fw-bold" style={{ fontSize: 33 }}>{userStats.new_users || 0}</div>
            </div>
          </div>
        </div>
      )}

      {/* رسالة عندما لا توجد إحصائيات */}
      {(!userStats || Object.keys(userStats).length === 0) && !loading && (
        <div className="alert alert-info mb-4">
          <i className="fas fa-info-circle me-2"></i>
          لا توجد إحصائيات متاحة حالياً. ستظهر الإحصائيات بعد إضافة المستخدمين.
        </div>
      )}

      {/* جدول المستخدمين */}
      <div className="card users-table-card border-0 shadow-sm slide-in">
        <div className="card-header bg-white border-0 py-3">
          <div className="d-flex justify-content-between align-items-center">
            <h5 className="mb-0 fw-bold text-primary">
              <i className="fas fa-list me-2"></i>
              قائمة المستخدمين
            </h5>
            <div className="d-flex align-items-center">
              <div className="search-box">
                <i className="fas fa-search search-icon"></i>
                <input
                  type="text"
                  className="form-control"
                  placeholder="بحث في المستخدمين..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="card-body p-0">
          {loading ? (
            <div className="text-center py-5">
              <div className="loading-spinner" role="status">
                <span className="visually-hidden">جاري التحميل...</span>
              </div>
              <p className="mt-3 text-muted">جاري تحميل بيانات المستخدمين...</p>
            </div>
          ) : !filtered.length ? (
            <div className="empty-state">
              {users.length === 0 ? (
                <>
                  <i className="fas fa-users"></i>
                  <h5>لا يوجد مستخدمين</h5>
                  <p>لم يتم العثور على أي مستخدمين في النظام</p>
                  <button 
                    className="btn btn-primary mt-3"
                    onClick={() => {
                      setFormUser({
                        id: null, username: '', email: '', password: '', role: 'user'
                      });
                      setShowAdd(true);
                    }}
                  >
                    <i className="fas fa-plus me-2"></i>
                    إضافة أول مستخدم
                  </button>
                </>
              ) : (
                <>
                  <i className="fas fa-search"></i>
                  <h5>لا توجد نتائج</h5>
                  <p>جرب تغيير كلمات البحث</p>
                </>
              )}
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table users-table table-hover mb-0">
                <thead>
                  <tr>
                    <th>
                      <i className="fas fa-user me-2"></i>
                      اسم المستخدم
                    </th>
                    <th>
                      <i className="fas fa-envelope me-2"></i>
                      البريد الإلكتروني
                    </th>
                    <th>
                      <i className="fas fa-user-tag me-2"></i>
                      الدور
                    </th>
                    <th className="text-center">
                      <i className="fas fa-cogs me-2"></i>
                      الإجراءات
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(u => (
                    <tr key={u.id}>
                      <td>
                        <div className="d-flex align-items-center">
                          <div className="user-avatar me-3">
                            <i className="fas fa-user"></i>
                          </div>
                          <div>
                            <h6 className="mb-0 fw-semibold">{u.username || u.name}</h6>
                            <small className="text-muted">ID: {u.id}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="d-flex align-items-center">
                          <i className="fas fa-envelope text-muted me-2"></i>
                          <span className="text-break">{u.email || 'غير محدد'}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`role-badge ${u.role || 'user'}`}>
                          <i className={`fas fa-${
                            (u.role || 'user') === 'admin' ? 'crown' : 
                            (u.role || 'user') === 'manager' ? 'user-tie' : 
                            (u.role || 'user') === 'user' ? 'user' : 
                            (u.role || 'user') === 'readonly' ? 'eye' : 'user-shield'
                          } me-1`}></i>
                          {(u.role || 'user') === 'admin' ? 'مدير' : 
                           (u.role || 'user') === 'manager' ? 'مشرف' : 
                           (u.role || 'user') === 'user' ? 'مستخدم' : 
                           (u.role || 'user') === 'readonly' ? 'قراءة فقط' : (u.role || 'user')}
                        </span>
                      </td>
                      <td className="text-center align-middle">
                        <div className="action-buttons">
                          <button
                            className="action-btn edit"
                            title="تعديل بيانات المستخدم"
                            onClick={() => {
                              setFormUser({ ...u, password: '' });
                              setShowEdit(true);
                            }}
                          >
                            <i className="fas fa-edit me-1"></i>
                            تعديل
                          </button>

                          <button
                            className="action-btn delete"
                            title="حذف المستخدم نهائياً"
                            disabled={submitting}
                            onClick={() => confirmRemove(u.id)}
                          >
                            <i className="fas fa-trash me-1"></i>
                            حذف
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal إضافة / تعديل */}
      <Modal
        show={showAdd || showEdit}
        title={
          <div className="d-flex align-items-center">
            <i className={`fas fa-${showEdit ? 'edit' : 'plus'} me-2`}></i>
            {showEdit ? 'تعديل مستخدم' : 'مستخدم جديد'}
          </div>
        }
        onClose={() => { 
          setShowAdd(false); 
          setShowEdit(false); 
          setErrors({}); 
          setMessage({}); 
        }}
        size="lg"
      >
        <form onSubmit={onSubmit} className="needs-validation users-modal" noValidate>
          {errors.submit && (
            <div className="alert alert-danger">
              <i className="fas fa-exclamation-triangle me-2"></i>
              {errors.submit}
            </div>
          )}

          <div className="mb-3">
            <label className="form-label fw-semibold">
              <i className="fas fa-user me-2 text-primary"></i>
              اسم المستخدم *
            </label>
            <input
              name="username"
              className={`form-control form-control-lg ${errors.username ? 'is-invalid' : ''}`}
              value={formUser.username}
              onChange={onChange}
              disabled={showEdit}
              placeholder="أدخل اسم المستخدم"
            />
            {errors.username && (
              <div className="invalid-feedback">
                <i className="fas fa-exclamation-circle me-1"></i>
                {errors.username}
              </div>
            )}
          </div>

          <div className="mb-3">
            <label className="form-label fw-semibold">
              <i className="fas fa-envelope me-2 text-primary"></i>
              البريد الإلكتروني *
            </label>
            <input
              name="email"
              type="email"
              className={`form-control form-control-lg ${errors.email ? 'is-invalid' : ''}`}
              value={formUser.email}
              onChange={onChange}
              placeholder="أدخل البريد الإلكتروني"
            />
            {errors.email && (
              <div className="invalid-feedback">
                <i className="fas fa-exclamation-circle me-1"></i>
                {errors.email}
              </div>
            )}
          </div>

          {!showEdit && (
            <div className="mb-3">
              <label className="form-label fw-semibold">
                <i className="fas fa-lock me-2 text-primary"></i>
                كلمة المرور *
              </label>
              <input
                name="password"
                type="password"
                className={`form-control form-control-lg ${errors.password ? 'is-invalid' : ''}`}
                value={formUser.password}
                onChange={onChange}
                placeholder="أدخل كلمة المرور"
              />
              {errors.password && (
                <div className="invalid-feedback">
                  <i className="fas fa-exclamation-circle me-1"></i>
                  {errors.password}
                </div>
              )}
              <div className="form-text">
                <i className="fas fa-info-circle me-1"></i>
                يجب أن تحتوي على 8 أحرف على الأقل، حرف كبير، حرف صغير ورقم
              </div>
            </div>
          )}

          <div className="mb-4">
            <label className="form-label fw-semibold">
              <i className="fas fa-user-tag me-2 text-primary"></i>
              الدور
            </label>
            <select
              name="role"
              className="form-select form-select-lg"
              value={formUser.role}
              onChange={onChange}
            >
              <option value="admin">👑 مدير - صلاحيات كاملة</option>
              <option value="manager">👔 مشرف - صلاحيات إدارية محدودة</option>
              <option value="user">👤 مستخدم - صلاحيات أساسية</option>
              <option value="readonly">👁️ قراءة فقط - لا يمكن التعديل</option>
            </select>
          </div>

          <div className="d-flex justify-content-end gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-lg"
              onClick={() => { 
                setShowAdd(false); 
                setShowEdit(false); 
                setErrors({}); 
              }}
              disabled={submitting}
            >
              <i className="fas fa-times me-2"></i>
              إلغاء
            </button>
            <button 
              type="submit" 
              className="btn btn-primary btn-lg" 
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                  {showEdit ? 'جاري الحفظ...' : 'جاري الإضافة...'}
                </>
              ) : (
                <>
                  <i className={`fas fa-${showEdit ? 'save' : 'plus'} me-2`}></i>
                  {showEdit ? 'حفظ التغييرات' : 'إضافة المستخدم'}
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal تأكيد الحذف */}
      <Modal
        show={confirmDelete.open}
        title={
          <div className="d-flex align-items-center text-danger">
            <i className="fas fa-exclamation-triangle me-2"></i>
            تأكيد الحذف
          </div>
        }
        onClose={() => setConfirmDelete({ open: false, userId: null })}
        size="md"
      >
        <div className="text-center py-3">
          <i className="fas fa-trash fa-3x text-danger mb-3"></i>
          <h5 className="mb-3">هل أنت متأكد من حذف هذا المستخدم؟</h5>
          <p className="text-muted mb-4">لا يمكن التراجع عن هذا الإجراء بعد التنفيذ</p>
        </div>
        <div className="d-flex justify-content-center gap-2">
          <button
            className="btn btn-secondary btn-lg"
            onClick={() => setConfirmDelete({ open: false, userId: null })}
            disabled={submitting}
          >
            <i className="fas fa-times me-2"></i>
            إلغاء
          </button>
          <button 
            className="btn btn-danger btn-lg" 
            onClick={doDelete} 
            disabled={submitting}
          >
            {submitting ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                جاري الحذف...
              </>
            ) : (
              <>
                <i className="fas fa-trash me-2"></i>
                تأكيد الحذف
              </>
            )}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default Users;
