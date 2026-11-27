// src/hooks/useApi.js

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from './useAuth';

/**
 * خطأ مخصّص لطلبات الـ API يحوي رسالة وكود حالة HTTP إن وُجد.
 */
export class ApiError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * هوك عام لإجراء طلبات HTTP عبر fetch، مع:
 *  - إدارة إلغاء الطلبات عند تفكيك المكوّن
 *  - مهلة timeout
 *  - محاولات retry عند أخطاء الشبكة أو 5xx
 *  - دمج توكين المصادقة (Bearer) من localStorage
 *  - تجديد المصادقة في حالة 401 أوتوماتيكياً عبر useAuth.checkAuthStatus()
 *  - إدارة حالات التحميل والأخطاء
 *
 * @param {string} [baseURL] — عنوان السيرفر، يُمكن ضبطه عبر REACT_APP_API_BASE_URL
 */
const useApi = (
  baseURL = process.env.REACT_APP_API_BASE_URL?.replace(/\/+$/, '') ||
            'http://localhost:5000/api'
) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const { checkAuthStatus } = useAuth();
  // مجموعة AbortController لإلغاء كل الطلبات عند التفكيك
  const controllers = useRef(new Set());

  // عند تفكيك المكوّن، نُلغي كل الطلبات المعلقة
  useEffect(() => {
    const currentControllers = controllers.current;
    return () => {
      currentControllers.forEach(ctrl => ctrl.abort());
      currentControllers.clear();
    };
  }, []);

  const clearError = () => setError(null);

  /**
   * دالة داخلية لإجراء طلب HTTP واحد مع retries و timeout
   * @param {string} endpoint — مسار الـ API (مثلاً "/alerts")
   * @param {object} opts
   */
  const fetchData = useCallback(
    async (
      endpoint,
      {
        method = 'GET',
        headers = {},
        params = {},
        body = null,
        timeout = 30000,
        retries = 1,
        retryDelay = 1000,
        skipAuthRefresh = false,
      } = {}
    ) => {
      setIsLoading(true);
      setError(null);

      // بناء URL مع Query Params
      const esc = encodeURIComponent;
      const query = Object.entries(params)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${esc(k)}=${esc(v)}`)
        .join('&');
      let url = `${baseURL}${endpoint}${query ? `?${query}` : ''}`;

      // تجهيز الهيدرز مع Authorization
      const token = localStorage.getItem('authToken');
      const combinedHeaders = {
        // إذا body ليس FormData نضيف الـ JSON header
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      };

      // تحويل الجسم إلى JSON إن لزم
      let payload = body;
      if (
        body != null &&
        !(body instanceof FormData) &&
        combinedHeaders['Content-Type']?.includes('application/json')
      ) {
        payload = JSON.stringify(body);
      }

      // تنفيذ محاولة طلب وحيد
      const attemptRequest = async signal => {
        const response = await fetch(url, {
          method,
          headers: combinedHeaders,
          body: payload,
          signal,
        });
        if (!response.ok) {
          // حاول قراءة رسالة الخطأ من JSON
          let msg = `HTTP ${response.status}`;
          try {
            const data = await response.json();
            msg = data.error || data.message || msg;
          } catch {}
          // إذا 401 وجرب تجديد المصادقة
          if (response.status === 401 && !skipAuthRefresh) {
            await checkAuthStatus();
          }
          throw new ApiError(msg, response.status);
        }
        // اقرأ النص ــ إذا لم يكن فارغاً فكّ الـ JSON
        const text = await response.text();
        return text ? JSON.parse(text) : {};
      };

      let lastError = null;
      // حلقة retry
      for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        controllers.current.add(controller);
        const { signal } = controller;

        // مهلة إلغاء الطلب
        let timer = null;
        if (timeout > 0) {
          timer = setTimeout(() => controller.abort(), timeout);
        }

        try {
          const result = await attemptRequest(signal);
          return result;
        } catch (err) {
          lastError = err;
          // إذا انتهت المهلة أو ألغيت يوقف الكل
          if (err.name === 'AbortError') {
            setError('تم إلغاء الطلب أو انتهت المهلة');
            throw err;
          }
          // في حالات 5xx أو مشكلة شبكة نجرب retry
          const status = err.status || 0;
          if (attempt < retries && (status >= 500 || status === 0)) {
            await new Promise(r => setTimeout(r, retryDelay * 2 ** attempt));
            continue;
          }
          // أخطاء أخرى نرفعها
          setError(err.message || 'خطأ غير متوقع');
          throw err;
        } finally {
          clearTimeout(timer);
          controllers.current.delete(controller);
          setIsLoading(false);
        }
      }
      // إذا فشلت كل المحاولات
      throw lastError;
    },
    [baseURL, checkAuthStatus]
  );

  // واجهات قصيرة للطرق المختلفة
  const get   = useCallback((ep, opts) => fetchData(ep, { method: 'GET',    ...opts }), [fetchData]);
  const post  = useCallback((ep, opts) => fetchData(ep, { method: 'POST',   ...opts }), [fetchData]);
  const put   = useCallback((ep, opts) => fetchData(ep, { method: 'PUT',    ...opts }), [fetchData]);
  const patch = useCallback((ep, opts) => fetchData(ep, { method: 'PATCH',  ...opts }), [fetchData]);
  const del   = useCallback((ep, opts) => fetchData(ep, { method: 'DELETE', ...opts }), [fetchData]);

  return {
    isLoading,
    error,
    clearError,
    get,
    post,
    put,
    patch,
    del
  };
};

export default useApi;
