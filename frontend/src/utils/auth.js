import { axiosInstance } from './api';
import axios from 'axios'; // Added for the new refreshToken function

// تسجيل الدخول
export const loginUser = async (credentials) => {
  try {
    const response = await axiosInstance.post('/auth/login', credentials);
    const { access_token, refresh_token, user } = response.data;
    
    localStorage.setItem('access_token', access_token);
    localStorage.setItem('refresh_token', refresh_token);
    localStorage.setItem('current_user', JSON.stringify(user));
    
    axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
    
    return { success: true, user, access_token };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Login failed:', error.response?.data || error.message); // مفيد للتصحيح في التطوير
    const errorMessage = error.response?.data?.error || error.response?.data?.message || 'فشل في تسجيل الدخول';
    throw new Error(errorMessage);
  }
};

// تسجيل مستخدم جديد
export const registerUser = async (userData) => {
  try {
    const response = await axiosInstance.post('/auth/register', userData);
    return { success: true, user: response.data.user };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Registration failed:', error.response?.data || error.message); // مفيد للتصحيح في التطوير
    const errorMessage = error.response?.data?.error || error.response?.data?.message || 'فشل في التسجيل';
    throw new Error(errorMessage);
  }
};

// طلب إعادة تعيين كلمة المرور
export async function requestPasswordReset({ email }) {
  const res = await axiosInstance.post('/auth/forgot-password', { email });
  return res.data;
}

// إعادة تعيين كلمة المرور
export async function resetUserPassword({ token, new_password }) {
  const res = await axiosInstance.post('/auth/reset-password', { token, new_password });
  return res.data;
}

// تغيير كلمة المرور (للمستخدم الحالي)
export async function changePassword({ current_password, new_password }) {
  const res = await axiosInstance.post('/auth/change-password', { current_password, new_password });
  return res.data;
}

// التحقق من صلاحية التوكن
let _validatePromise = null;

export const validateUserToken = async () => {
  // If there's already an in-flight validation, return it (dedupe)
  if (_validatePromise) return _validatePromise;

  _validatePromise = (async () => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) {
        _validatePromise = null;
        return { valid: false, user: null };
      }

      // Token validation (logging removed for security)

      const response = await axiosInstance.get('/auth/validate-token');
      _validatePromise = null;
      return { valid: true, user: response.data.user };
    } catch (error) {

      // إذا كان الخطأ 422، فالتوكن غير صالح
      if (error.response?.status === 422) {
        // Token is invalid, clear localStorage
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        _validatePromise = null;
        return { valid: false, user: null, shouldLogin: true };
      }

      // إذا كان الخطأ 401، فالتوكن منتهي الصلاحية
      if (error.response?.status === 401) {
        // Token expired, attempting refresh
        _validatePromise = null;
        // يمكن إضافة منطق تحديث التوكن هنا
        return { valid: false, user: null, shouldRefresh: true };
      }

      _validatePromise = null;
      return { valid: false, user: null };
    }
  })();

  return _validatePromise;
};

// تسجيل الخروج
export async function logoutUser() {
  try {
    // التحقق من وجود token قبل محاولة الخروج
    const token = localStorage.getItem('access_token');
    if (token) {
      await axiosInstance.post('/auth/logout');
    }
  } catch (error) {
    // تجاهل أخطاء الخروج إذا كان المستخدم غير مسجل دخول
    // eslint-disable-next-line no-console
    console.warn('Logout request failed, clearing local storage anyway:', error.message); // تسجيل أخطاء الخروج
  } finally {
    // تنظيف localStorage في جميع الحالات
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('current_user');
    
    // إزالة Authorization header
    delete axiosInstance.defaults.headers.common['Authorization'];
  }
}

// تحديث التوكن
export const refreshToken = async () => {
  const refresh_token = localStorage.getItem('refresh_token');
  
  if (!refresh_token) {
    throw new Error('No refresh token available');
  }

  try {
    // إنشاء instance مؤقت لتجنب استخدام interceptor
    const tempInstance = axios.create({
      baseURL: axiosInstance.defaults.baseURL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${refresh_token}`
      }
    });

    const response = await tempInstance.post('/auth/refresh');
    const { access_token, user } = response.data;
    
    // تحديث التوكن في localStorage
    localStorage.setItem('access_token', access_token);
    
    // تحديث معلومات المستخدم إذا تم إرسالها
    if (user) {
      localStorage.setItem('current_user', JSON.stringify(user));
    }
    
    // تحديث header في axiosInstance
    axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
    
    return access_token;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to refresh token:', error); // تسجيل أخطاء تحديث التوكن
    // إذا فشل التحديث، قم بتسجيل الخروج
    logoutUser();
    throw error;
  }
};

// دالة فحص قوة كلمة المرور (بسيطة)
export function validatePasswordStrength(password) {
  const checks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    digit: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
  const valid = Object.values(checks).every(Boolean);
  let message = '';
  if (!checks.length) message += 'يجب أن تكون كلمة المرور 8 أحرف على الأقل.\n';
  if (!checks.upper) message += 'يجب أن تحتوي على حرف كبير واحد على الأقل.\n';
  if (!checks.lower) message += 'يجب أن تحتوي على حرف صغير واحد على الأقل.\n';
  if (!checks.digit) message += 'يجب أن تحتوي على رقم واحد على الأقل.\n';
  if (!checks.special) message += 'يجب أن تحتوي على رمز خاص واحد على الأقل.\n';
  return { valid, message: message.trim(), checks };
}
