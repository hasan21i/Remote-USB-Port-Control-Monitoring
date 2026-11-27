import React, { useState, useEffect, useRef, useCallback } from 'react';
import useAuth from '../../hooks/useAuth';
import { changePassword, enableMfa, disableMfa, confirmMfa } from '../../utils/api';
import {
  isValidEmail,
  isValidPassword,
  doPasswordsMatch
} from '../../utils/validators';
import ImageCropper from '../../components/ImageCropper';

const Profile = () => {
  const { currentUser, updateUser } = useAuth();

  const [info, setInfo] = useState({
    name: '',
    email: '',
    phone: '',
    department: '',
    position: '',
    notifications_enabled: true
  });
  const [infoErrors, setInfoErrors] = useState({});
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoSuccess, setInfoSuccess] = useState('');

  const [pass, setPass] = useState({ current: '', new: '', confirm: '' });
  const [passErrors, setPassErrors] = useState({});
  const [passLoading, setPassLoading] = useState(false);
  const [passSuccess, setPassSuccess] = useState('');

  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [showCropper, setShowCropper] = useState(false);
  const [imageToCrop, setImageToCrop] = useState('');
  const fileInputRef = useRef();

  const [mfaEnabled, setMfaEnabled] = useState(currentUser?.mfa_enabled || false);
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaQr, setMfaQr] = useState('');
  const [mfaOtp, setMfaOtp] = useState('');
  const [mfaMsg, setMfaMsg] = useState('');
  const [mfaStep, setMfaStep] = useState('idle'); // idle | show | verify | enabled

  // دالة لحفظ البيانات في localStorage مع timestamp
  const saveToLocalStorage = (key, data) => {
    try {
      const dataWithTimestamp = {
        ...data,
        _lastUpdated: new Date().toISOString(),
        _userId: currentUser?.id || 'default'
      };
      localStorage.setItem(key, JSON.stringify(dataWithTimestamp));
      // Data saved to localStorage
    } catch (error) {
      // Error saving to localStorage
    }
  };

  // دالة لجلب البيانات من localStorage مع التحقق من الصلاحية
  const loadFromLocalStorage = useCallback((key, defaultValue = null) => {
    try {
      const item = localStorage.getItem(key);
      if (!item) return defaultValue;
      
      const parsedData = JSON.parse(item);
      
      // Check if data belongs to current user
      if (parsedData._userId && parsedData._userId !== (currentUser?.id || 'default')) {
        // Data doesn't belong to current user, use default values
        return defaultValue;
      }
      
      // Remove internal fields from returned data
      const { _lastUpdated, _userId, ...cleanData } = parsedData;
      // Data loaded from localStorage
      return cleanData;
    } catch (error) {
      // Error loading from localStorage
      return defaultValue;
    }
  }, [currentUser?.id]);

  // دالة لحفظ الصورة في localStorage
  const saveAvatarToLocalStorage = useCallback((imageData) => {
    try {
      const userId = currentUser?.id || 'default';
      const avatarKey = `user_${userId}_avatar_data`;
      const avatarData = {
        imageData,
        _lastUpdated: new Date().toISOString(),
        _userId: userId
      };
      localStorage.setItem(avatarKey, JSON.stringify(avatarData));
      // Avatar saved to localStorage
    } catch (error) {
      // Error saving avatar to localStorage
    }
  }, [currentUser?.id]);

  // دالة لجلب الصورة من localStorage
  const loadAvatarFromLocalStorage = useCallback(() => {
    try {
      const userId = currentUser?.id || 'default';
      const avatarKey = `user_${userId}_avatar_data`;
      const item = localStorage.getItem(avatarKey);
      
      if (!item) return null;
      
      const parsedData = JSON.parse(item);
      
      // التحقق من أن الصورة تنتمي للمستخدم الحالي
      if (parsedData._userId && parsedData._userId !== userId) {
        return null;
      }
      
      // التحقق من وجود بيانات صورة صالحة
      const imageData = parsedData.imageData;
      if (imageData && typeof imageData === 'string' && imageData.length > 0) {
        return imageData;
      }
      
      return null;
    } catch (error) {
      // حذف البيانات التالفة عند حدوث خطأ
      if (currentUser?.id) {
        localStorage.removeItem(`user_${currentUser.id}_avatar_data`);
      }
      return null;
    }
  }, [currentUser?.id]);

  // دالة لحفظ البيانات تلقائياً عند التغيير مع حذف البيانات القديمة
  const saveProfileData = (newData) => {
    if (currentUser) {
      const userId = currentUser.id || 'default';
      const profileKey = `user_${userId}_profile`;
      
      // حذف البيانات القديمة أولاً
      const oldKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(`user_${userId}_profile`) && key !== profileKey) {
          oldKeys.push(key);
        }
      }
      
      // حذف المفاتيح القديمة
      oldKeys.forEach(key => {
        localStorage.removeItem(key);
      });
      
      // إضافة معلومات إضافية للحفظ
      const dataToSave = {
        ...newData,
        _lastSaved: new Date().toISOString(),
        _autoSaved: true,
        _version: '2.0', // تحديث رقم الإصدار
        _cleanedOld: oldKeys.length // عدد البيانات القديمة المحذوفة
      };
      
      saveToLocalStorage(profileKey, dataToSave);
      
      // حفظ نسخة احتياطية واحدة فقط (حذف النسخ القديمة)
      const backupKey = `user_${userId}_profile_backup`;
      const oldBackups = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('backup') && key.includes(`user_${userId}`) && key !== backupKey) {
          oldBackups.push(key);
        }
      }
      
      // حذف النسخ الاحتياطية القديمة
      oldBackups.forEach(key => {
        localStorage.removeItem(key);
      });
      
      saveToLocalStorage(backupKey, dataToSave);
    }
  };

  // دالة جلب بيانات المستخدم من قاعدة البيانات
  const loadUserFromDatabase = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
          'X-Server-Id': localStorage.getItem('server_id') || '1'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      if (result && result.user) {
        const userData = result.user;
        
        // تحديث بيانات المستخدم في الذاكرة
        updateUser(userData);
        
        // تعبئة الحقول بالبيانات الحقيقية من قاعدة البيانات
        const profileData = {
          name: userData.name || userData.username || '',
          email: userData.email || '',
          phone: userData.phone || '',
          department: userData.department || '',
          position: userData.position || '',
          notifications_enabled: userData.notifications_enabled !== false
        };
        
        setInfo(profileData);
        
        // تحميل الصورة الشخصية - أولوية للـ localStorage، ثم من قاعدة البيانات
        const savedAvatarData = loadAvatarFromLocalStorage();
        if (savedAvatarData && savedAvatarData.length > 0) {
          // التحقق من صلاحية الصورة المحفوظة محلياً
          if (savedAvatarData.startsWith('data:image/') || savedAvatarData.startsWith('blob:') || savedAvatarData.startsWith('/uploads')) {
            setAvatarPreview(savedAvatarData);
          } else {
            // البيانات المحفوظة غير صالحة، استخدم من قاعدة البيانات
            if (userData.avatar_url) {
              const fullAvatarUrl = userData.avatar_url.startsWith('/') ? userData.avatar_url : `/${userData.avatar_url}`;
              setAvatarPreview(fullAvatarUrl);
              saveAvatarToLocalStorage(fullAvatarUrl);
            } else {
              setAvatarPreview('');
            }
          }
        } else if (userData.avatar_url) {
          const fullAvatarUrl = userData.avatar_url.startsWith('/') ? userData.avatar_url : `/${userData.avatar_url}`;
          setAvatarPreview(fullAvatarUrl);
          saveAvatarToLocalStorage(fullAvatarUrl);
        } else {
          setAvatarPreview('');
        }
        
        return { success: true, data: profileData };
      }
      return { success: false, data: null };
    } catch (error) {
      console.error('خطأ في جلب بيانات المستخدم:', error);
      return { success: false, data: null };
    }
  }, [updateUser, saveAvatarToLocalStorage, loadAvatarFromLocalStorage]);

  // تحميل البيانات عند بدء التطبيق
  useEffect(() => {
    if (currentUser) {
      // جلب البيانات من قاعدة البيانات أولاً
      loadUserFromDatabase().then((result) => {
        if (result.success && result.data) {
          // حفظ في localStorage كنسخة احتياطية بعد نجاح التحميل
          saveProfileData(result.data);
        } else {
          // إذا فشل جلب البيانات من القاعدة، استخدام localStorage كبديل
          const userId = currentUser.id || 'default';
          
          const savedProfileData = loadFromLocalStorage(`user_${userId}_profile`, {
            name: currentUser.name || currentUser.username || '',
            email: currentUser.email || '',
            phone: currentUser.phone || '',
            department: currentUser.department || '',
            position: currentUser.position || '',
            notifications_enabled: currentUser.notifications_enabled !== false
          });

          const cleanedData = {
            name: savedProfileData.name || '',
            email: savedProfileData.email || '',
            phone: savedProfileData.phone || '',
            department: savedProfileData.department || '',
            position: savedProfileData.position || '',
            notifications_enabled: savedProfileData.notifications_enabled !== false
          };

          setInfo(cleanedData);
          
          // تحميل الصورة - جرب من localStorage أولاً، ثم من currentUser
          const savedAvatarData = loadAvatarFromLocalStorage();
          if (savedAvatarData && savedAvatarData.length > 0) {
            // التحقق من صلاحية الصورة (base64 أو URL صالح)
            if (savedAvatarData.startsWith('data:image/') || savedAvatarData.startsWith('blob:') || savedAvatarData.startsWith('http')) {
              setAvatarPreview(savedAvatarData);
            } else {
              // إذا كانت البيانات غير صالحة، امحها
              const userId = currentUser.id || 'default';
              localStorage.removeItem(`user_${userId}_avatar_data`);
              setAvatarPreview('');
            }
          } else if (currentUser.avatar_url) {
            const fullAvatarUrl = currentUser.avatar_url.startsWith('/') ? currentUser.avatar_url : `/${currentUser.avatar_url}`;
            setAvatarPreview(fullAvatarUrl);
          } else {
            setAvatarPreview('');
          }
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  // حفظ المعلومات عند التغيير (localStorage + قاعدة بيانات)
  const handleInfoChange = (field, value) => {
    const newInfo = { ...info, [field]: value };
    setInfo(newInfo);
    
    // حفظ التغييرات في localStorage فوراً كنسخة احتياطية
    saveProfileData(newInfo);
    
    // حفظ في قاعدة البيانات تلقائياً (debounced)
    clearTimeout(window.profileSaveTimeout);
    window.profileSaveTimeout = setTimeout(async () => {
      try {
        const data = new FormData();
        data.append('name', newInfo.name);
        data.append('email', newInfo.email);
        data.append('phone', newInfo.phone || '');
        data.append('department', newInfo.department || '');
        data.append('position', newInfo.position || '');
        data.append('notifications_enabled', newInfo.notifications_enabled);
        
        const response = await fetch('/api/auth/profile', {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
            'X-Server-Id': localStorage.getItem('server_id') || '1'
          },
          body: data
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        await response.json();
        
      } catch (error) {
        console.error('⚠️ فشل الحفظ التلقائي:', error.message);
      }
    }, 2000); // حفظ بعد 2 ثواني من آخر تغيير
    
    // مسح خطأ الحقل إذا كان موجوداً
    if (infoErrors[field]) {
      setInfoErrors({ ...infoErrors, [field]: null });
    }
  };

  // تحقق من معلومات المستخدم
  const validateInfo = () => {
    const errs = {};
    if (!info.name.trim()) errs.name = 'الاسم الكامل مطلوب';
    if (!info.email.trim()) errs.email = 'البريد الإلكتروني مطلوب';
    else if (!isValidEmail(info.email)) errs.email = 'البريد الإلكتروني غير صالح';
    return errs;
  };

  // حفظ المعلومات الشخصية
  const handleInfoSubmit = async e => {
    e.preventDefault();
    const errs = validateInfo();
    if (Object.keys(errs).length) {
      setInfoErrors(errs);
      return;
    }
    setInfoLoading(true);
    try {
      // حفظ جميع البيانات في localStorage فوراً قبل الإرسال للخادم
      saveProfileData(info);
      
      // إظهار رسالة نجاح فورية
      setInfoSuccess('جاري حفظ البيانات...');
      
      // محاولة إرسال البيانات للخادم
      try {
        let data = new FormData();
        data.append('name', info.name);
        data.append('email', info.email);
        data.append('phone', info.phone || '');
        data.append('department', info.department || '');
        data.append('position', info.position || '');
        data.append('notifications_enabled', info.notifications_enabled);
        
        if (avatarFile) {
          data.append('avatar', avatarFile);
        }
        
        // استخدام fetch مع proxy
        const response = await fetch('/api/auth/profile', {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
            'X-Server-Id': localStorage.getItem('server_id') || '1'
          },
          body: data
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        updateUser(result.user);
        setInfoSuccess('تم حفظ وتحديث المعلومات بنجاح في قاعدة البيانات');
        
        // تحديث معاينة الصورة وحفظها في localStorage
        if (result.user.avatar_url) {
          const fullAvatarUrl = result.user.avatar_url.startsWith('/') ? result.user.avatar_url : `/${result.user.avatar_url}`;
          setAvatarPreview(fullAvatarUrl);
          saveAvatarToLocalStorage(fullAvatarUrl);
        }
        
        // Clear temporary avatar file
        setAvatarFile(null);
      } catch (serverError) {
        // إذا فشل في الحفظ على الخادم، البيانات محفوظة محلياً
        console.warn('Server update failed, but data saved locally:', serverError);
        setInfoSuccess('تم حفظ البيانات محلياً (الخادم غير متاح حالياً)');
      }
      
      setTimeout(() => setInfoSuccess(''), 3000);
      setInfoErrors({});
      
    } catch (err) {
      // Profile update error
      const errorMessage = err.response?.data?.error || err.message || 'فشل حفظ البيانات';
      setInfoErrors({ submit: errorMessage });
    } finally {
      setInfoLoading(false);
    }
  };

  // تحقق من كلمة المرور
  const validatePass = () => {
    const errs = {};
    if (!pass.current.trim()) errs.current = 'كلمة المرور الحالية مطلوبة';
    if (!pass.new.trim()) errs.new = 'كلمة المرور الجديدة مطلوبة';
    else if (!isValidPassword(pass.new))
      errs.new = 'يجب أن تكون 8 أحرف على الأقل، بحرف كبير وصغير ورقم';
    if (!pass.confirm.trim()) errs.confirm = 'تأكيد كلمة المرور مطلوب';
    else if (!doPasswordsMatch(pass.new, pass.confirm))
      errs.confirm = 'كلمة المرور غير مطابقة';
    return errs;
  };

  // تغيير كلمة المرور
  const handlePassSubmit = async e => {
    e.preventDefault();
    const errs = validatePass();
    if (Object.keys(errs).length) {
      setPassErrors(errs);
      return;
    }
    setPassLoading(true);
    try {
      // استدعاء API بالطريقة الصحيحة
      await changePassword(pass.current, pass.new);
      setPassSuccess('تم تغيير كلمة المرور بنجاح');
      setPass({ current: '', new: '', confirm: '' });
      setPassErrors({});
      setTimeout(() => setPassSuccess(''), 3000);
    } catch (err) {
      const errorMessage = err.response?.data?.error || err.message || 'فشل في تغيير كلمة المرور';
      setPassErrors({ submit: errorMessage });
    } finally {
      setPassLoading(false);
    }
  };

  // معاينة الصورة الجديدة
  const handleAvatarChange = e => {
    const file = e.target.files[0];
    if (!file) return;
    
    // التحقق من نوع الملف
    if (!file.type.startsWith('image/')) {
      alert('يرجى اختيار ملف صورة صالح (JPG, PNG, GIF)');
      return;
    }
    
    // التحقق من حجم الملف (5MB حد أقصى)
    if (file.size > 5 * 1024 * 1024) {
      alert('حجم الصورة كبير جداً. يرجى اختيار صورة أصغر من 5 ميجابايت');
      return;
    }
    
    // قراءة الملف كـ Data URL لحفظه في localStorage
    const reader = new FileReader();
    reader.onload = (event) => {
      const imageDataUrl = event.target.result;
      setImageToCrop(imageDataUrl);
      setShowCropper(true);
    };
    reader.readAsDataURL(file);
  };

  // معالجة نتيجة قص الصورة
  const handleCropComplete = (croppedImage) => {
    // تنظيف Blob URL القديم
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview);
    }
    
    setAvatarFile(croppedImage.blob);
    
    // تحويل الـ blob إلى data URL للحفظ في localStorage
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      setAvatarPreview(dataUrl);
      // حفظ الصورة المقطوعة في localStorage كـ data URL
      saveAvatarToLocalStorage(dataUrl);
    };
    reader.readAsDataURL(croppedImage.blob);
    
    setShowCropper(false);
    setImageToCrop('');
  };

  // إزالة الصورة الشخصية
  const handleRemoveAvatar = () => {
    // مسح الصورة من localStorage
    try {
      const userId = currentUser?.id || 'default';
      const avatarKey = `user_${userId}_avatar_data`;
      localStorage.removeItem(avatarKey);
    } catch (error) {
      console.error('Error removing avatar from localStorage:', error);
    }
    
    // تنظيف المعاينة
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview);
    }
    
    setAvatarPreview('');
    setAvatarFile(null);
    
    // إعادة تعيين input الملف
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // إلغاء قص الصورة
  const handleCropCancel = () => {
    // تنظيف Blob URL
    if (imageToCrop) {
      URL.revokeObjectURL(imageToCrop);
    }
    
    setShowCropper(false);
    setImageToCrop('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // تفعيل MFA
  const handleEnableMfa = async () => {
    setMfaMsg('');
    setMfaStep('show');
    try {
      const response = await enableMfa();
      const data = response.data;
      setMfaSecret(data.secret);
      setMfaQr(data.qr_code);
      setMfaStep('verify');
    } catch (err) {
      setMfaMsg(err.response?.data?.error || 'فشل تفعيل المصادقة الثنائية');
      setMfaStep('idle');
    }
  };

  // تحقق رمز OTP الأول
  const handleVerifyMfa = async e => {
    e.preventDefault();
    setMfaMsg('');
    try {
      const response = await confirmMfa({ otp: mfaOtp });
      if (response.data) {
        setMfaMsg('تم تفعيل المصادقة الثنائية بنجاح!');
        setMfaEnabled(true);
        setMfaStep('enabled');
        // تحديث معلومات المستخدم في السياق
        updateUser({ ...currentUser, mfa_enabled: true });
      }
    } catch (err) {
      setMfaMsg(err.response?.data?.error || 'فشل التحقق من رمز OTP');
    }
  };

  // تعطيل MFA
  const handleDisableMfa = async () => {
    const password = prompt('أدخل كلمة المرور لتأكيد تعطيل المصادقة الثنائية:');
    if (!password) return;
    
    setMfaMsg('');
    try {
      await disableMfa({ password });
      setMfaEnabled(false);
      setMfaStep('idle');
      setMfaSecret('');
      setMfaQr('');
      setMfaOtp('');
      setMfaMsg('تم تعطيل المصادقة الثنائية بنجاح.');
      // تحديث معلومات المستخدم في السياق
      updateUser({ ...currentUser, mfa_enabled: false });
    } catch (err) {
      setMfaMsg(err.response?.data?.error || 'فشل تعطيل المصادقة الثنائية');
    }
  };

  // دالة لحذف البيانات من localStorage
  const _clearLocalStorageData = () => {
    if (currentUser) {
      const userId = currentUser.id || 'default';
      localStorage.removeItem(`user_${userId}_profile`);
      localStorage.removeItem(`user_${userId}_avatar_data`);
      // Data cleared from localStorage
      
      // إعادة تحميل البيانات الافتراضية
      setInfo({
        name: currentUser.name || currentUser.username || '',
        email: currentUser.email || '',
        phone: currentUser.phone || '',
        department: currentUser.department || '',
        position: currentUser.position || '',
        notifications_enabled: currentUser.notifications_enabled !== false
      });
      
      if (currentUser.avatar_url) {
        const fullAvatarUrl = currentUser.avatar_url.startsWith('/') ? currentUser.avatar_url : `/${currentUser.avatar_url}`;
        setAvatarPreview(fullAvatarUrl);
      } else {
        setAvatarPreview('');
      }
    }
  };

  // دالة لعرض معلومات localStorage
  const _showLocalStorageInfo = () => {
    if (currentUser) {
      const userId = currentUser.id || 'default';
      const profileKey = `user_${userId}_profile`;
      const avatarKey = `user_${userId}_avatar_data`;
      
      const profileData = localStorage.getItem(profileKey);
      const avatarData = localStorage.getItem(avatarKey);
      
      // localStorage info displayed
      // Profile Data and Avatar Data information
      
      alert(`معلومات localStorage:
البيانات الشخصية: ${profileData ? 'محفوظة' : 'غير محفوظة'}
الصورة: ${avatarData ? 'محفوظة' : 'غير محفوظة'}

راجع وحدة التحكم للمزيد من التفاصيل.`);
    }
  };

  return (
    <div className="container py-4" dir="rtl">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">
          <i className="fas fa-user-circle me-2 text-primary"></i>
          الملف الشخصي
        </h1>
      </div>

      <div className="row gy-4">
        {/* عمود الصورة */}
        <div className="col-lg-4 text-center">
          <div className="card h-100 shadow-sm">
            <div className="card-body d-flex flex-column align-items-center justify-content-center">
              <div className="mb-3">
                <div className="avatar-preview position-relative mx-auto mb-3">
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt="الصورة الشخصية"
                      className="rounded-circle shadow-sm border border-3 border-primary"
                      style={{ width: 150, height: 150, objectFit: 'cover' }}
                      onError={(_) => {
                        // إذا فشل تحميل الصورة، مسح الـ preview لإظهار الحرف الأول
                        setAvatarPreview('');
                        // مسح الصورة من localStorage لأنها غير صالحة
                        const userId = currentUser?.id || 'default';
                        localStorage.removeItem(`user_${userId}_avatar_data`);
                      }}
                    />
                  ) : (
                    <div
                      className="bg-gradient-primary rounded-circle d-flex align-items-center justify-content-center shadow-sm border border-3 border-primary"
                      style={{ width: 150, height: 150, color: 'white', fontSize: 48 }}
                    >
                      {(info.name || currentUser?.username || 'U').charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                
                {/* أزرار التحكم في الصورة */}
                <div className="d-flex flex-column gap-2">
                  <label className="btn btn-primary btn-sm" htmlFor="avatarInput">
                    <i className="fas fa-camera me-2"></i>
                    {avatarPreview ? 'تغيير الصورة' : 'إضافة صورة'}
                  </label>
                  
                  {avatarPreview && (
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      onClick={handleRemoveAvatar}
                    >
                      <i className="fas fa-trash-alt me-2"></i>
                      إزالة الصورة
                    </button>
                  )}
                </div>
                
                <input
                  type="file"
                  accept="image/*"
                  id="avatarInput"
                  ref={fileInputRef}
                  className="d-none"
                  onChange={handleAvatarChange}
                />
              </div>
              
              <h5 className="card-title text-primary mb-1">
                {info.name || currentUser?.username || 'غير محدد'}
              </h5>
              <p className="text-muted small mb-2">{info.email || 'لا يوجد بريد إلكتروني'}</p>
              <p className="text-muted small">
                <i className="fas fa-building me-1"></i>
                {info.department || 'لم يتم تحديد القسم'}
              </p>
              <p className="text-muted small">
                <i className="fas fa-briefcase me-1"></i>
                {info.position || 'لم يتم تحديد المنصب'}
              </p>
            </div>
          </div>
        </div>

        {/* عمود النماذج */}
        <div className="col-lg-8">
          {/* نموذج المعلومات الشخصية */}
          <div className="card mb-4 shadow-sm">
            <div className="card-header bg-primary text-white">
              <h5 className="mb-0">
                <i className="fas fa-user-edit me-2"></i>
                المعلومات الشخصية
              </h5>
            </div>
            <div className="card-body">
              {infoErrors.submit && (
                <div className="alert alert-danger">
                  <i className="fas fa-exclamation-triangle me-2" />
                  {infoErrors.submit}
                </div>
              )}
              {infoSuccess && (
                <div className="alert alert-success">
                  <i className="fas fa-check-circle me-2" />
                  {infoSuccess}
                </div>
              )}
              <form onSubmit={handleInfoSubmit} noValidate>
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label fw-bold">
                      <i className="fas fa-user me-1"></i>
                      الاسم الكامل
                    </label>
                    <input
                      type="text"
                      name="name"
                      className={`form-control form-control-lg ${infoErrors.name ? 'is-invalid' : ''}`}
                      value={info.name}
                      onChange={e => handleInfoChange('name', e.target.value)}
                    />
                    {infoErrors.name && <div className="invalid-feedback">{infoErrors.name}</div>}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-bold">
                      <i className="fas fa-envelope me-1"></i>
                      البريد الإلكتروني
                    </label>
                    <input
                      type="email"
                      name="email"
                      className={`form-control form-control-lg ${infoErrors.email ? 'is-invalid' : ''}`}
                      value={info.email}
                      onChange={e => handleInfoChange('email', e.target.value)}
                    />
                    {infoErrors.email && <div className="invalid-feedback">{infoErrors.email}</div>}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-bold">
                      <i className="fas fa-phone me-1"></i>
                      رقم الهاتف
                    </label>
                    <input
                      type="text"
                      name="phone"
                      className="form-control form-control-lg"
                      value={info.phone}
                      onChange={e => handleInfoChange('phone', e.target.value)}
                      placeholder="مثال: +966501234567"
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-bold">
                      <i className="fas fa-building me-1"></i>
                      القسم
                    </label>
                    <input
                      type="text"
                      name="department"
                      className="form-control form-control-lg"
                      value={info.department}
                      onChange={e => handleInfoChange('department', e.target.value)}
                      placeholder="مثال: تقنية المعلومات"
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-bold">
                      <i className="fas fa-briefcase me-1"></i>
                      المنصب
                    </label>
                    <input
                      type="text"
                      name="position"
                      className="form-control form-control-lg"
                      value={info.position}
                      onChange={e => handleInfoChange('position', e.target.value)}
                      placeholder="مثال: مدير النظام"
                    />
                  </div>
                  <div className="col-12 mt-3">
                    <div className="form-check form-switch">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="notif"
                        checked={!!info.notifications_enabled}
                        onChange={e => handleInfoChange('notifications_enabled', e.target.checked)}
                      />
                      <label className="form-check-label fw-bold" htmlFor="notif">
                        <i className="fas fa-bell me-1"></i>
                        تفعيل الإشعارات
                      </label>
                    </div>
                  </div>
                </div>
                
                {/* معلومات عن حفظ البيانات */}
                <div className="alert alert-info mt-3">
                  <div className="d-flex align-items-start">
                    <i className="fas fa-database me-2 mt-1"></i>
                    <div>
                      <strong>حفظ البيانات:</strong>
                      <ul className="mb-0 mt-2 small">
                        <li>جميع المعلومات سيتم حفظها في قاعدة البيانات</li>
                        <li>يمكنك تعديل جميع الحقول حسب احتياجاتك</li>
                        <li>اضغط "حفظ المعلومات" لحفظ التغييرات</li>
                        <li>البيانات محمية ومشفرة بالنظام</li>
                      </ul>
                    </div>
                  </div>
                </div>
                
                <div className="mt-4 text-end">
                  <button
                    type="submit"
                    className="btn btn-primary btn-lg px-4"
                    disabled={infoLoading}
                  >
                    {infoLoading
                      ? <>
                          <span className="spinner-border spinner-border-sm me-2" />
                          جاري الحفظ...
                        </>
                      : <>
                          <i className="fas fa-save me-2"></i>
                          حفظ المعلومات
                        </>
                    }
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* نموذج تغيير كلمة المرور */}
          <div className="card mb-4 shadow-sm">
            <div className="card-header bg-danger text-white">
              <h5 className="mb-0">
                <i className="fas fa-lock me-2"></i>
                تغيير كلمة المرور
              </h5>
            </div>
            <div className="card-body">
              {passErrors.submit && (
                <div className="alert alert-danger">
                  <i className="fas fa-exclamation-triangle me-2" />
                  {passErrors.submit}
                </div>
              )}
              {passSuccess && (
                <div className="alert alert-success">
                  <i className="fas fa-check-circle me-2" />
                  {passSuccess}
                </div>
              )}
              <form onSubmit={handlePassSubmit} noValidate>
                <div className="row g-3">
                  <div className="col-md-4">
                    <label className="form-label fw-bold">كلمة المرور الحالية</label>
                    <input
                      type="password"
                      name="current"
                      className={`form-control form-control-lg ${passErrors.current ? 'is-invalid' : ''}`}
                      value={pass.current}
                      onChange={e => {
                        setPass({ ...pass, current: e.target.value });
                        setPassErrors({ ...passErrors, current: null });
                      }}
                    />
                    {passErrors.current && <div className="invalid-feedback">{passErrors.current}</div>}
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-bold">كلمة المرور الجديدة</label>
                    <input
                      type="password"
                      name="new"
                      className={`form-control form-control-lg ${passErrors.new ? 'is-invalid' : ''}`}
                      value={pass.new}
                      onChange={e => {
                        setPass({ ...pass, new: e.target.value });
                        setPassErrors({ ...passErrors, new: null });
                      }}
                    />
                    {passErrors.new && <div className="invalid-feedback">{passErrors.new}</div>}
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-bold">تأكيد كلمة المرور</label>
                    <input
                      type="password"
                      name="confirm"
                      className={`form-control form-control-lg ${passErrors.confirm ? 'is-invalid' : ''}`}
                      value={pass.confirm}
                      onChange={e => {
                        setPass({ ...pass, confirm: e.target.value });
                        setPassErrors({ ...passErrors, confirm: null });
                      }}
                    />
                    {passErrors.confirm && <div className="invalid-feedback">{passErrors.confirm}</div>}
                  </div>
                </div>
                <div className="text-end mt-4">
                  <button
                    type="submit"
                    className="btn btn-danger btn-lg px-4"
                    disabled={passLoading}
                  >
                    {passLoading
                      ? <>
                          <span className="spinner-border spinner-border-sm me-2" />
                          جاري التغيير...
                        </>
                      : <>
                          <i className="fas fa-key me-2"></i>
                          تغيير كلمة المرور
                        </>
                    }
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* قسم المصادقة الثنائية MFA */}
          <div className="card mb-4 shadow-sm">
            <div className="card-header bg-warning text-dark">
              <h5 className="mb-0">
                <i className="fas fa-shield-alt me-2"></i>
                المصادقة الثنائية (التحقق بخطوتين)
              </h5>
            </div>
            <div className="card-body">
              {mfaEnabled ? (
                <>
                  <div className="alert alert-success mb-3">
                    <i className="fas fa-lock me-2"></i>
                    المصادقة الثنائية مفعلة على حسابك. عند تسجيل الدخول سيُطلب منك رمز تحقق من تطبيق المصادقة.
                  </div>
                  <button className="btn btn-danger btn-lg" onClick={handleDisableMfa}>
                    <i className="fas fa-unlock me-2"></i> تعطيل المصادقة الثنائية
                  </button>
                </>
              ) : (
                <>
                  <div className="alert alert-info mb-3">
                    <i className="fas fa-info-circle me-2"></i>
                    يمكنك تفعيل المصادقة الثنائية لحماية حسابك. ستحتاج تطبيق مثل Google Authenticator أو Microsoft Authenticator لمسح الكود.
                    <br />
                    <span className="text-muted small">مثل تيليجرام: لن يتم تفعيلها إلا بعد إدخال رمز التحقق الأول.</span>
                  </div>
                  {mfaStep === 'idle' && (
                    <button className="btn btn-primary btn-lg" onClick={handleEnableMfa}>
                      <i className="fas fa-shield-alt me-2"></i> تفعيل المصادقة الثنائية
                    </button>
                  )}
                  {mfaMsg && mfaStep !== 'verify' && <div className="alert alert-warning mt-3">{mfaMsg}</div>}
                </>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* مكون قص الصورة */}
      {showCropper && (
        <ImageCropper
          src={imageToCrop}
          onCropComplete={handleCropComplete}
          onCancel={handleCropCancel}
        />
      )}

      {/* مودال إعداد المصادقة الثنائية */}
      {mfaStep === 'verify' && (
        <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center mfa-backdrop" 
             style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1055, backdropFilter: 'blur(8px)' }}>
          <div className="bg-body rounded-4 shadow-lg p-4 mfa-modal" style={{ width: '420px', maxWidth: '90vw' }}>
            
            {/* Header */}
            <div className="d-flex justify-content-between align-items-center mb-4">
              <h5 className="mb-0 fw-bold text-body">إعداد المصادقة الثنائية</h5>
              <button 
                type="button" 
                className="btn-close"
                data-bs-theme="auto"
                onClick={() => {
                  setMfaStep('idle');
                  setMfaMsg('');
                  setMfaSecret('');
                  setMfaQr('');
                  setMfaOtp('');
                }}
              ></button>
            </div>

            {/* صورة البروفايل الدائرية */}
            <div className="text-center mb-4">
              <div className="position-relative d-inline-block">
                <div 
                  className="rounded-circle mx-auto mfa-profile-container"
                  style={{ 
                    width: '80px', 
                    height: '80px',
                    overflow: 'hidden'
                  }}
                >
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt="Profile"
                      className="w-100 h-100 rounded-circle"
                      style={{ objectFit: 'cover' }}
                    />
                  ) : (
                    <div 
                      className="w-100 h-100 d-flex align-items-center justify-content-center text-white rounded-circle"
                      style={{ 
                        background: 'linear-gradient(135deg, var(--primary-color) 0%, var(--dark-gray) 100%)',
                        fontSize: '24px'
                      }}
                    >
                      {info.name ? info.name.charAt(0).toUpperCase() : <i className="fas fa-user" />}
                    </div>
                  )}
                </div>
                {/* أيقونة الحماية الصغيرة */}
                <div 
                  className="position-absolute bottom-0 end-0 rounded-circle d-flex align-items-center justify-content-center mfa-shield-badge"
                  style={{ 
                    width: '28px', 
                    height: '28px',
                    background: 'linear-gradient(135deg, var(--success-color) 0%, var(--secondary-color) 100%)',
                    border: '2px solid white',
                    fontSize: '12px',
                    color: 'white',
                    boxShadow: '0 2px 8px rgba(40, 167, 69, 0.4)'
                  }}
                >
                  <i className="fas fa-shield-alt"></i>
                </div>
              </div>
            </div>

            <p className="text-center text-muted mb-4 mfa-description" style={{ fontSize: '14px' }}>
              امسح الكود أو أدخل المفتاح<br />
              Microsoft Authenticator أو Google Authenticator
            </p>

            {/* الخطوة الأولى: تحميل التطبيق */}
            <div className="mb-4">
              <div className="d-flex align-items-start mb-3">
                <div 
                  className="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center me-3 step-number"
                  style={{ width: '24px', height: '24px', fontSize: '12px', flexShrink: 0 }}
                >
                  1
                </div>
                <div>
                  <h6 className="mb-1 fw-semibold text-body">تحميل تطبيق المصادقة</h6>
                  <p className="text-muted mb-0 step-description" style={{ fontSize: '13px' }}>
                    حمّل Google Authenticator أو Microsoft Authenticator من متجر التطبيقات
                  </p>
                </div>
              </div>
            </div>

            {/* الخطوة الثانية: مسح الباركود */}
            <div className="mb-4">
              <div className="d-flex align-items-start mb-3">
                <div 
                  className="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center me-3 step-number"
                  style={{ width: '24px', height: '24px', fontSize: '12px', flexShrink: 0 }}
                >
                  2
                </div>
                <div className="flex-grow-1">
                  <h6 className="mb-2 fw-semibold text-body">امسح الكود أو أدخل المفتاح</h6>
                  
                  {/* QR Code */}
                  {mfaQr && (
                    <div className="text-center mb-3">
                      <div 
                        className="d-inline-block p-2 bg-body-secondary border rounded qr-container"
                        style={{ borderColor: 'var(--bs-border-color)' }}
                      >
                        <img 
                          src={`data:image/png;base64,${mfaQr}`} 
                          alt="QR code MFA" 
                          style={{ width: '140px', height: '140px' }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Manual Entry */}
                  <div className="mb-3">
                    <p className="mb-1 text-muted secret-label" style={{ fontSize: '12px' }}>
                      أو أدخل المفتاح يدوياً:
                    </p>
                    <div 
                      className="p-2 bg-body-tertiary border rounded text-center user-select-all secret-key"
                      style={{ 
                        fontSize: '13px', 
                        fontFamily: 'monospace',
                        letterSpacing: '0.5px',
                        borderColor: 'var(--bs-border-color)',
                        wordBreak: 'keep-all',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: 'white',
                        fontWeight: '600'
                      }}
                    >
                      {mfaSecret}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* الخطوة الثالثة: إدخال الرمز */}
            <div className="mb-4">
              <div className="d-flex align-items-start">
                <div 
                  className="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center me-3 step-number"
                  style={{ width: '24px', height: '24px', fontSize: '12px', flexShrink: 0 }}
                >
                  3
                </div>
                <div className="flex-grow-1">
                  <h6 className="mb-2 fw-semibold text-body">أدخل رمز التحقق</h6>
                  
                  <form onSubmit={handleVerifyMfa}>
                    <div className="mb-3">
                      <input 
                        type="text" 
                        className="form-control text-center py-2 otp-input"
                        style={{ 
                          fontSize: '20px',
                          letterSpacing: '6px',
                          borderRadius: '8px',
                          borderWidth: '2px',
                          borderColor: 'var(--bs-border-color)',
                          backgroundColor: 'var(--bs-body-bg)',
                          color: 'var(--bs-body-color)'
                        }}
                        placeholder="000000"
                        value={mfaOtp} 
                        onChange={e => setMfaOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        maxLength="6"
                        required 
                      />
                      <small className="text-muted mt-1 d-block otp-help" style={{ fontSize: '11px' }}>
                        أدخل الرمز المكون من 6 أرقام
                      </small>
                    </div>

                    {/* Error Message */}
                    {mfaMsg && (
                      <div className="alert alert-danger py-2 mb-3" style={{ fontSize: '12px' }}>
                        <i className="fas fa-exclamation-triangle me-1"></i>
                        {mfaMsg}
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="d-flex gap-2 justify-content-end">
                      <button 
                        type="button" 
                        className="btn btn-outline-secondary px-3 py-2 cancel-btn"
                        style={{ 
                          borderRadius: '20px',
                          fontSize: '13px'
                        }}
                        onClick={() => {
                          setMfaStep('idle');
                          setMfaMsg('');
                          setMfaSecret('');
                          setMfaQr('');
                          setMfaOtp('');
                        }}
                      >
                        إلغاء
                      </button>
                      <button 
                        className="btn btn-primary px-3 py-2 submit-btn"
                        style={{ 
                          borderRadius: '20px',
                          fontSize: '13px'
                        }}
                        type="submit"
                        disabled={mfaOtp.length !== 6}
                      >
                        تحقق
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>

          </div>
          
        </div>
      )}
    </div>
  );
};

export default Profile;