// src/context/AuthContext.jsx

import React, {
  createContext,
  useReducer,
  useCallback,
  useEffect,
  useRef
} from 'react';
import PropTypes from 'prop-types';
// import { axiosInstance } from '../utils/api';
import {
  loginUser,
  registerUser,
  requestPasswordReset,
  resetUserPassword,
  validateUserToken,
  refreshToken,
  logoutUser
} from '../utils/auth';

const initialState = {
  currentUser: null, // لا نقرأ من localStorage مباشرة
  isAuthenticated: false, // نبدأ بحالة غير مسجل
  isLoading: true, // نضع loading أثناء التحقق
  error: null
};

function reducer(state, action) {
  switch (action.type) {
    case 'START':
      return { ...state, isLoading: true, error: null };
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        isLoading: false,
        isAuthenticated: true,
        currentUser: action.payload,
        error: null
      };
    case 'LOGOUT':
      // تنظيف localStorage عند logout
      localStorage.removeItem('current_user');
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      return {
        currentUser: null,
        isAuthenticated: false,
        isLoading: false,
        error: null
      };
    case 'FAILURE':
      return { ...state, isLoading: false, error: action.payload };
    case 'UPDATE_USER':
      return { ...state, currentUser: action.payload };
    case 'REGISTER_SUCCESS':
      return {
        ...state,
        isLoading: false,
        isAuthenticated: true,
        currentUser: action.payload,
        error: null
      };
    case 'SUCCESS':
      return { ...state, isLoading: false, error: null };
    case 'SET_INITIAL_AUTH':
      return {
        ...state,
        currentUser: action.payload.user,
        isAuthenticated: action.payload.isAuthenticated,
        isLoading: false,
        error: null
      };
    default:
      return state;
  }
}

export const AuthContext = createContext({
  currentUser: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  login: async () => {},
  register: async () => {},
  logout: () => {},
  requestPasswordReset: async () => {},
  resetUserPassword: async () => {},
  updateUser: () => {},
  checkAuthStatus: async () => {}
});

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const refreshTimerRef = useRef(null);

  // دالة لحساب وقت التحديث التلقائي
  const scheduleTokenRefresh = useCallback(() => {
    // إلغاء أي مؤقت سابق
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    const token = localStorage.getItem('access_token');
    const refreshTokenExists = localStorage.getItem('refresh_token');
    
    if (!token || !refreshTokenExists || !state.isAuthenticated) return;

    try {
      // فك تشفير التوكن للحصول على وقت الانتهاء
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiryTime = payload.exp * 1000; // تحويل إلى milliseconds
      const currentTime = Date.now();
      
      // تحديث التوكن قبل يوم واحد من انتهاء صلاحيته
      const refreshTime = expiryTime - currentTime - (24 * 60 * 60 * 1000);
      
      if (refreshTime > 0) {
        refreshTimerRef.current = setTimeout(async () => {
          try {
            await refreshToken();
            // جدولة التحديث التالي
            scheduleTokenRefresh();
          } catch (error) {
            // console.error('Failed to auto-refresh token:', error);
             dispatch({ type: 'LOGOUT' });
          }
        }, refreshTime);
      }
    } catch (error) {
      // console.error('Error scheduling token refresh:', error);
    }
  }, [state.isAuthenticated]);

  const checkAuthStatus = useCallback(async () => {
    dispatch({ type: 'START' });
    try {
      const token = localStorage.getItem('access_token');
      const refreshTokenExists = localStorage.getItem('refresh_token');
      
      if (!token) {
        dispatch({ type: 'LOGOUT' });
        return;
      }

      // التحقق من وجود refresh token أيضاً
      if (!refreshTokenExists) {
        console.warn('No refresh token found, logging out');
        dispatch({ type: 'LOGOUT' });
        return;
      }

      const result = await validateUserToken();
      if (result.valid && result.user) {
        dispatch({ type: 'LOGIN_SUCCESS', payload: result.user });
        // جدولة تحديث التوكن
        scheduleTokenRefresh();
      } else {
        dispatch({ type: 'LOGOUT' });
      }
    } catch (err) {
      console.warn('Auth check failed:', err);
      dispatch({ type: 'LOGOUT' });
    }
  }, [scheduleTokenRefresh]);

  const login = useCallback(async (credentials) => {
    dispatch({ type: 'START' });
    try {
      const result = await loginUser(credentials);
      if (result.success) {
        dispatch({ type: 'LOGIN_SUCCESS', payload: result.user });
        localStorage.setItem('current_user', JSON.stringify(result.user));
        // جدولة تحديث التوكن
        scheduleTokenRefresh();
      } else {
        throw new Error('فشل في تسجيل الدخول');
      }
    } catch (err) {
      dispatch({ type: 'FAILURE', payload: err.message });
      throw err;
    }
  }, [scheduleTokenRefresh]);

  const register = useCallback(async (userData) => {
    dispatch({ type: 'START' });
    try {
      const result = await registerUser(userData);
      if (result.success) {
        dispatch({ type: 'REGISTER_SUCCESS', payload: result.user });
        return result;
      } else {
        throw new Error(result.message || 'فشل في إنشاء الحساب');
      }
    } catch (err) {
      dispatch({ type: 'FAILURE', payload: err.message });
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutUser();
    } catch (error) {
      // console.error('Logout error:', error);
    } finally {
      // إلغاء مؤقت التحديث
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      dispatch({ type: 'LOGOUT' });
    }
  }, []);

  const forgotPassword = useCallback(async (email) => {
    dispatch({ type: 'START' });
    try {
      const result = await requestPasswordReset(email);
      dispatch({ type: 'SUCCESS' });
      return result;
    } catch (err) {
      dispatch({ type: 'FAILURE', payload: err.message });
      throw err;
    }
  }, []);

  const resetPassword = useCallback(async (token, newPassword) => {
    try {
      const result = await resetUserPassword(token, newPassword);
      dispatch({ type: 'SUCCESS' });
      return result;
    } catch (err) {
      dispatch({ type: 'FAILURE', payload: err.message });
      throw err;
    }
  }, []);

  const updateUser = useCallback(
    updates => {
      const updated = { ...state.currentUser, ...updates };
      dispatch({ type: 'UPDATE_USER', payload: updated });
      localStorage.setItem('current_user', JSON.stringify(updated));
    },
    [state.currentUser]
  );

  // On mount, verify authentication
  useEffect(() => {
    const initializeAuth = async () => {
      const token = localStorage.getItem('access_token');
      
      if (!token) {
        // لا يوجد توكن، المستخدم غير مسجل
        dispatch({ 
          type: 'SET_INITIAL_AUTH', 
          payload: { user: null, isAuthenticated: false } 
        });
        return;
      }

      try {
        // التحقق من صحة التوكن
        await checkAuthStatus();
      } catch (error) {
        console.warn('Initial auth check failed:', error);
        dispatch({ 
          type: 'SET_INITIAL_AUTH', 
          payload: { user: null, isAuthenticated: false } 
        });
      }
    };

    initializeAuth();
  }, [checkAuthStatus]);

  // جدولة تحديث التوكن عند تسجيل الدخول
  useEffect(() => {
    if (state.isAuthenticated) {
      scheduleTokenRefresh();
    }

    // تنظيف المؤقت عند الخروج
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [state.isAuthenticated, scheduleTokenRefresh]);

  const value = {
    currentUser: state.currentUser,
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading,
    error: state.error,
    login,
    register,
    logout,
    checkAuthStatus,
    forgotPassword,
    resetPassword,
    updateUser
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired
};

// Hook to use auth context
export const useAuth = () => {
  const context = React.useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

