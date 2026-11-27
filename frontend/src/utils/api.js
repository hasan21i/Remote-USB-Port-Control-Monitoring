// src/utils/api.js
/* eslint-disable no-console */

import axios from 'axios';
import { refreshToken, logoutUser } from './auth';
import backendConfig from '../backend_config.json';

// استخراج الآي بي والمنفذ من الإعدادات المولدة ديناميكياً
const backendIp = backendConfig?.BACKEND_IP || 'localhost';
const backendPort = backendConfig?.BACKEND_PORT || 5000;

const backendUrl = backendConfig?.BACKEND_IP
  ? `http://${backendIp}:${backendPort}/api`
  : (process.env.REACT_APP_API_URL || 'http://localhost:5000/api');

console.log('🌐 Using Backend URL:', backendUrl);

// إنشاء instance للـ axios
const axiosInstance = axios.create({
  baseURL: backendUrl,
  timeout: 45000,
  withCredentials: true, // مهم جداً للـ CORS والـ Credentials
  headers: {
    'Content-Type': 'application/json',
  }
});

// إضافة interceptor للطلبات
axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // إضافة Server ID header
    const serverId = localStorage.getItem('server_id') || '1';
    config.headers['X-Server-Id'] = serverId;

    // ضمان Content-Type صحيح لجميع POST/PUT/PATCH requests
    if (config.method === 'post' || config.method === 'put' || config.method === 'patch') {
      // تأكد من وجود data قبل تعيين Content-Type
      if (config.data !== undefined && config.responseType !== 'blob') {
        // إذا كانت البيانات string، فهي JSON مسلسل بالفعل
        if (typeof config.data === 'string') {
          config.headers['Content-Type'] = 'application/json';
        }
        // إذا كانت البيانات object، قم بتسلسلها
        else if (typeof config.data === 'object' && config.data !== null) {
          config.data = JSON.stringify(config.data);
          config.headers['Content-Type'] = 'application/json';
        }
      } else if (!config.headers['Content-Type'] && config.responseType !== 'blob') {
        config.headers['Content-Type'] = 'application/json';
      }
    }

    // إضافة Content-Type للـ blob إذا لم يكن موجوداً
    if (config.responseType === 'blob' && !config.headers['Content-Type']) {
      config.headers['Content-Type'] = 'application/octet-stream';
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// متغير لتتبع ما إذا كنا نحاول تحديث التوكن
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });

  failedQueue = [];
};

// معالجة الاستجابات والأخطاء
axiosInstance.interceptors.response.use(
  response => {
    // معالجة خاصة للـ blob responses
    if (response.config.responseType === 'blob') {
      // التحقق من أن الـ blob صالح
      if (response.data && response.data.size > 0) {
        return response;
      } else {
        return Promise.reject(new Error('Empty blob received'));
      }
    }
    return response;
  },
  async error => {
    const originalRequest = error.config;

    // إذا كان الخطأ 401 وليس من طلب التحديث نفسه
    if (error.response?.status === 401 && !originalRequest._retry && !originalRequest.url.includes('/auth/refresh')) {
      // التحقق من وجود refresh token قبل المحاولة
      const refreshTokenExists = localStorage.getItem('refresh_token');

      if (!refreshTokenExists) {
        // لا يوجد refresh token، قم بتسجيل الخروج مباشرة
        logoutUser();
        window.location.href = '/login';
        return Promise.reject(new Error('Session expired, please login again'));
      }

      if (isRefreshing) {
        // إذا كنا نحدث التوكن بالفعل، انتظر حتى ينتهي
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return axiosInstance(originalRequest);
        }).catch(err => {
          return Promise.reject(err);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const newToken = await refreshToken();
        processQueue(null, newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return axiosInstance(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        logoutUser();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // معالجة أخطاء أخرى
    if (error.response?.status === 403) {
      console.error('Access denied - insufficient permissions');
    }

    return Promise.reject(error);
  }
);

// Dashboard API calls
export const fetchDashboardOverview = async () => {
  try {
    const response = await axiosInstance.get('/dashboard/overview');
    return response.data;
  } catch (error) {
    console.warn('Dashboard overview error:', error.response?.status, error.response?.data);
    return {};
  }
};

export const fetchDashboardServers = async () => {
  try {
    const response = await axiosInstance.get('/dashboard/servers');
    return response.data;
  } catch (error) {
    console.warn('Dashboard servers error:', error.response?.status, error.response?.data);
    return [];
  }
};

export const fetchDashboardDevices = async () => {
  try {
    const response = await axiosInstance.get('/dashboard/devices');
    return response.data;
  } catch (error) {
    console.warn('Dashboard devices error:', error.response?.status, error.response?.data);
    return [];
  }
};

export const fetchDashboardActivity = async () => {
  try {
    const response = await axiosInstance.get('/dashboard/activity');
    return response.data;
  } catch (error) {
    console.warn('Dashboard activity error:', error.response?.status, error.response?.data);
    return [];
  }
};

export const fetchDashboardAlerts = async () => {
  try {
    const response = await axiosInstance.get('/dashboard/alerts');
    return response.data;
  } catch (error) {
    console.warn('Dashboard alerts error:', error.response?.status, error.response?.data);
    return [];
  }
};

// Devices API calls
export const listDevices = async (params = {}) => {
  try {
    // إعداد المعاملات مع دعم الفلاتر المحسّنة
    const queryParams = new URLSearchParams();

    if (params.status) {
      queryParams.append('status', params.status);
    }

    if (params.real_only !== undefined) {
      queryParams.append('real_only', params.real_only);
    }

    if (params.all_servers !== undefined) {
      queryParams.append('all_servers', params.all_servers);
    }

    if (params.server_id) {
      queryParams.append('server_id', params.server_id);
    }

    const url = '/devices/list' + (queryParams.toString() ? '?' + queryParams.toString() : '');
    const response = await axiosInstance.get(url);

    // التعامل مع البنية الجديدة للاستجابة
    if (response.data) {
      // إذا كانت الاستجابة تحتوي على البنية المحسّنة الجديدة
      if (response.data.devices && response.data.summary) {
        return {
          data: response.data.devices,
          summary: response.data.summary,
          filters_applied: response.data.filters_applied
        };
      }
      // إذا كانت الاستجابة مجرد مصفوفة (التنسيق القديم)
      else if (Array.isArray(response.data)) {
        return {
          data: response.data,
          summary: {
            total_devices: response.data.length,
            real_devices: response.data.filter(d => d.is_real_device !== false).length,
            fake_devices_filtered: 0,
            legacy_format: true
          }
        };
      }
    }

    return {
      data: [],
      summary: {
        total_devices: 0,
        real_devices: 0,
        fake_devices_filtered: 0,
        error_occurred: true
      }
    };
  } catch (error) {
    console.warn('List devices error:', error.response?.status, error.response?.data);
    return {
      data: [],
      summary: {
        total_devices: 0,
        real_devices: 0,
        fake_devices_filtered: 0,
        error_occurred: true,
        error_message: error.message
      }
    };
  }
};

export const getDevice = async (id) => {
  try {
    return await axiosInstance.get(`/devices/${id}`);
  } catch (error) {
    console.error('Get device error:', error);
    throw error;
  }
};

export const addDevice = async (deviceData) => {
  try {
    const response = await axiosInstance.post('/devices/add', deviceData);
    return response.data;
  } catch (error) {
    console.error('Add device error:', error);
    throw error;
  }
};

export const approveDevice = async (identifier) => {
  try {
    const response = await axiosInstance.post(
      `/devices/${identifier}/approve`,
      { notes: '' }  // Let axios interceptor handle JSON serialization
    );
    return response.data;
  } catch (error) {
    console.error('Approve device error:', error);
    throw error;
  }
};

export const denyDevice = async (identifier) => {
  try {
    const response = await axiosInstance.post(
      `/devices/${identifier}/deny`,
      {
        reason: '',
        block: false
      }  // Let axios interceptor handle JSON serialization
    );
    return response.data;
  } catch (error) {
    console.error('Deny device error:', error);
    throw error;
  }
};

export const ejectDevice = async (identifier) => {
  try {
    const response = await axiosInstance.post(
      `/devices/${identifier}/eject`,
      {}  // Empty body, let axios interceptor handle serialization
    );
    return response.data;
  } catch (error) {
    console.error('Eject device error:', error);
    throw error;
  }
};

export const reconnectDevice = async (identifier) => {
  try {
    const response = await axiosInstance.post(
      `/devices/${identifier}/control`,
      { action: 'reconnect' }
    );
    return response.data;
  } catch (error) {
    console.error('Reconnect device error:', error);
    throw error;
  }
};

export const scanDevices = async () => {
  try {
    const response = await axiosInstance.post(
      '/devices/scan-now',
      {}  // Empty body, let axios interceptor handle serialization
    );
    return response.data;
  } catch (error) {
    console.error('Scan devices error:', error);
    throw error;
  }
};

// Device Control API calls
export const controlDevice = async (deviceId, actionOrData) => {
  try {
    // Handle both old format controlDevice(deviceId, action) and new format controlDevice(deviceId, { action })
    let requestData;
    if (typeof actionOrData === 'string') {
      requestData = { action: actionOrData };
    } else if (actionOrData && typeof actionOrData === 'object' && actionOrData.action) {
      requestData = { action: actionOrData.action };
    } else {
      throw new Error('Invalid action parameter');
    }

    const response = await axiosInstance.post(
      `/devices/${deviceId}/control`,
      requestData  // Let axios interceptor handle JSON serialization
    );
    return response.data;
  } catch (error) {
    console.error('Control device error:', error);
    throw error;
  }
};

export const addToWhitelist = async (deviceId) => {
  try {
    const response = await axiosInstance.post(
      `/devices/${deviceId}/whitelist`,
      {}  // Empty body
    );
    return response.data;
  } catch (error) {
    console.error('Add to whitelist error:', error);
    throw error;
  }
};

export const addToBlacklist = async (deviceId) => {
  try {
    const response = await axiosInstance.post(
      `/devices/${deviceId}/blacklist`,
      {}  // Empty body
    );
    return response.data;
  } catch (error) {
    console.error('Add to blacklist error:', error);
    throw error;
  }
};

export const removeFromWhitelist = async (deviceId) => {
  try {
    const response = await axiosInstance.delete(`/devices/${deviceId}/whitelist`);
    return response.data;
  } catch (error) {
    console.error('Remove from whitelist error:', error);
    throw error;
  }
};

export const removeFromBlacklist = async (deviceId) => {
  try {
    const response = await axiosInstance.delete(`/devices/${deviceId}/blacklist`);
    return response.data;
  } catch (error) {
    console.error('Remove from blacklist error:', error);
    throw error;
  }
};

export const getDeviceStatus = async (deviceId) => {
  try {
    const response = await axiosInstance.get(`/devices/${deviceId}/status`);
    return response.data;
  } catch (error) {
    console.error('Get device status error:', error);
    throw error;
  }
};

export const getDeviceDetails = async (deviceId) => {
  try {
    // التحقق من صحة المعامل
    if (!deviceId || typeof deviceId !== 'string') {
      throw new Error(`Invalid device identifier: ${deviceId}`);
    }

    const cleanDeviceId = deviceId.trim();
    if (!cleanDeviceId) {
      throw new Error('Device identifier is empty');
    }

    console.debug && console.debug('API: Getting device details for:', cleanDeviceId);
    const response = await axiosInstance.get(`/devices/${encodeURIComponent(cleanDeviceId)}`);
    console.debug && console.debug('API: Full response from backend:', response);
    console.debug && console.debug('API: Response data:', response.data);
    return response.data;
  } catch (error) {
    console.error('Get device details error:', error);

    // تحسين رسائل الخطأ
    if (error.response?.status === 404) {
      error.message = 'الجهاز غير موجود. تأكد من صحة الرقم التسلسلي.';
    } else if (error.response?.status === 403) {
      error.message = 'ليس لديك صلاحية للوصول إلى تفاصيل هذا الجهاز.';
    } else if (error.response?.status >= 500) {
      error.message = 'خطأ في الخادم. يرجى المحاولة لاحقاً.';
    }

    throw error;
  }
};

export const updateDevice = async (deviceId, data) => {
  try {
    const response = await axiosInstance.put(`/devices/${deviceId}`, data);
    return response.data;
  } catch (error) {
    console.error('Update device error:', error);
    throw error;
  }
};

export const scanNow = async () => {
  try {
    const response = await axiosInstance.post('/devices/scan-now');
    return response.data;
  } catch (error) {
    console.error('Scan now error:', error);
    throw error;
  }
};

export const searchDevices = async (query) => {
  try {
    const response = await axiosInstance.get(`/devices/search?q=${encodeURIComponent(query)}`);
    return response.data;
  } catch (error) {
    console.error('Search devices error:', error);
    throw error;
  }
};

// البحث المحسن في جميع السيرفرات
export const searchDevicesEnhanced = async (query = '', allServers = false) => {
  try {
    // إعداد المعاملات للبحث
    const params = new URLSearchParams();

    if (query) {
      params.append('q', query);
    }

    // إذا تم تحديد البحث في جميع السيرفرات
    if (allServers) {
      params.append('all_servers', 'true');
    }

    const url = `/devices/search` + (params.toString() ? '?' + params.toString() : '');
    const response = await axiosInstance.get(url);
    return response.data;
  } catch (error) {
    console.error('Enhanced search devices error:', error);
    throw error;
  }
};

export const getSystemStats = async () => {
  try {
    const response = await axiosInstance.get('/system/stats');
    return response.data;
  } catch (error) {
    console.error('Get system stats error:', error);
    throw error;
  }
};

export const syncPolicies = async () => {
  try {
    const response = await axiosInstance.post('/devices/sync-policies');
    return response.data;
  } catch (error) {
    console.error('Sync policies error:', error);
    throw error;
  }
};

export const checkCompatibility = async (deviceIdentifier) => {
  try {
    // If deviceIdentifier is a simple string (serial number), use it directly
    const requestData = typeof deviceIdentifier === 'string'
      ? { serial_number: deviceIdentifier }
      : deviceIdentifier;

    const response = await axiosInstance.post('/devices/check-compatibility', requestData);
    return response.data;
  } catch (error) {
    console.error('Check compatibility error:', error);
    throw error;
  }
};

// Alerts API calls
export const getAlerts = async () => {
  try {
    const response = await axiosInstance.get('/alerts');
    return response.data;
  } catch (error) {
    console.warn('Get alerts error:', error.response?.status, error.response?.data || error.message);
    return [];
  }
};

export const fetchAlerts = async (params = {}) => {
  try {
    const response = await axiosInstance.get('/alerts', { params });
    return {
      alerts: response.data.alerts || response.data || [],
      total: response.data.total || (response.data.alerts ? response.data.alerts.length : (Array.isArray(response.data) ? response.data.length : 0))
    };
  } catch (error) {
    console.warn('Fetch alerts error:', error.response?.status, error.response?.data || error.message);
    return {
      alerts: [],
      total: 0
    };
  }
};

export const resolveAlert = async (alertId) => {
  try {
    const response = await axiosInstance.post(`/alerts/${alertId}/resolve`);
    return response.data;
  } catch (error) {
    console.error('Resolve alert error:', error);
    throw error;
  }
};

export const resolveAllAlerts = async (priority = null) => {
  try {
    const response = await axiosInstance.post('/alerts/resolve-all', {
      priority: priority
    });
    return response.data;
  } catch (error) {
    console.error('Resolve all alerts error:', error);
    throw error;
  }
};

export const deleteAlert = async (alertId) => {
  try {
    const response = await axiosInstance.delete(`/alerts/delete/${alertId}`);
    return response.data;
  } catch (error) {
    console.error('Delete alert error:', error);
    throw error;
  }
};

export const clearAllAlerts = async () => {
  try {
    const response = await axiosInstance.delete('/alerts/clear-all');
    return response.data;
  } catch (error) {
    console.error('Clear all alerts error:', error);
    throw error;
  }
};

export const clearResolvedAlerts = async () => {
  try {
    const response = await axiosInstance.delete('/alerts/clear-resolved');
    return response.data;
  } catch (error) {
    console.error('Clear resolved alerts error:', error);
    throw error;
  }
};

export const clearOldAlerts = async () => {
  try {
    const response = await axiosInstance.delete('/alerts/clear-old');
    return response.data;
  } catch (error) {
    console.error('Clear old alerts error:', error);
    throw error;
  }
};

export const bulkDeleteAlerts = async (alertIds) => {
  try {
    const response = await axiosInstance.post('/alerts/bulk-delete', {
      alert_ids: alertIds
    });
    return response.data;
  } catch (error) {
    console.error('Bulk delete alerts error:', error);
    throw error;
  }
};



export const fetchAlertStats = async (params = {}) => {
  try {
    const response = await axiosInstance.get('/alerts/stats', { params });
    return response.data;
  } catch (error) {
    console.error('Fetch alert stats error:', error);
    return {
      by_priority: { high: 0, normal: 0, low: 0 },
      resolved: 0,
      unresolved: 0,
      total_alerts: 0
    };
  }
};

// Logs API calls
export const getLogs = async (params = {}) => {
  try {
    const queryString = new URLSearchParams(params).toString();
    const url = `/logs${queryString ? `?${queryString}` : ''}`;
    const response = await axiosInstance.get(url);
    return response.data;
  } catch (error) {
    console.warn('Get logs error:', error.response?.status, error.response?.data || error.message);
    return [];
  }
};

// إنشاء axios instance منفصل للـ logs بدون X-Server-Id
const createLogsAxios = () => {
  const instance = axios.create({
    baseURL: process.env.REACT_APP_API_URL || 'http://localhost:5000/api',
    // Increase timeout for logs requests because logs queries may be slower
    timeout: 60000,
  });

  instance.interceptors.request.use(
    (config) => {
      const token = localStorage.getItem('access_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      // لا نضيف X-Server-Id هنا لتجنب مشكلة CORS
      return config;
    },
    (error) => Promise.reject(error)
  );

  return instance;
};

const logsAxios = createLogsAxios();

export const fetchLogs = async (limit = 100) => {
  // Cap the requested number of logs to avoid long-running queries
  const adjustedLimit = Math.min(limit, 50);
  try {
    // Try the simple endpoint first (faster/simple projection)
    const response = await logsAxios.get(`/logs/simple?limit=${adjustedLimit}`);
    return { logs: response.data || [] };
  } catch (error) {
    // If the request timed out, return an empty set instead of throwing
    if (error?.code === 'ECONNABORTED' || (error?.message && error.message.toLowerCase().includes('timeout'))) {
      // Timeout occurred
      console.warn('Fetch logs timed out, returning empty logs');
      return { logs: [] };
    }

    // Log fallback and attempt the full endpoint with a smaller limit
    console.warn('Simple logs endpoint failed, attempting fallback:', error?.message || error);
    try {
      const fallbackLimit = Math.min(adjustedLimit, 20);
      const response = await logsAxios.get(`/logs?limit=${fallbackLimit}`);
      return { logs: response.data?.logs || [] };
    } catch (fallbackError) {
      if (fallbackError?.code === 'ECONNABORTED' || (fallbackError?.message && fallbackError.message.toLowerCase().includes('timeout'))) {
        console.warn('Fallback logs request timed out, returning empty logs');
        return { logs: [] };
      }
      console.error('Both logs endpoints failed:', fallbackError);
      // Return empty logs to keep UI responsive rather than throwing
      return { logs: [] };
    }
  }
};

export const clearLogs = async (days) => {
  try {
    const response = await axiosInstance.post('/logs/clear', { days });
    return response.data;
  } catch (error) {
    console.error('Clear logs error:', error);
    throw error;
  }
};

export const clearAllLogs = async () => {
  try {
    const response = await axiosInstance.delete('/logs/clear-all');
    return response.data;
  } catch (error) {
    console.error('Clear all logs error:', error);
    throw error;
  }
};

export const fetchLogStats = async (params = {}) => {
  try {
    const response = await axiosInstance.get('/logs/stats', { params });
    return response.data;
  } catch (error) {
    console.error('Fetch log stats error:', error);
    return {
      data: {
        total_logs: 0,
        by_action: {},
        daily_activity: [],
        recent_actions: []
      }
    };
  }
};

export const sendUsbTransferLog = async (logData) => {
  try {
    const response = await axiosInstance.post('/logs/usb-transfer', logData);
    return response.data;
  } catch (error) {
    console.error('Send USB transfer log error:', error);
    throw error;
  }
};

// Reports API calls
export const generateReport = async (reportType, params = {}) => {
  try {
    const response = await axiosInstance.post('/reports/generate', {
      type: reportType,
      ...params
    });
    return response.data;
  } catch (error) {
    console.error('Generate report error:', error);
    throw error;
  }
};

export const scheduleReport = async (reportData) => {
  try {
    const response = await axiosInstance.post('/reports/schedule', reportData);
    return response.data;
  } catch (error) {
    console.error('Schedule report error:', error);
    throw error;
  }
};

export const runReport = async (reportId) => {
  try {
    const response = await axiosInstance.post(`/reports/run/${reportId}`);
    return response.data;
  } catch (error) {
    console.error('Run report error:', error);
    throw error;
  }
};

export const fetchReportHistory = async () => {
  try {
    const response = await axiosInstance.get('/reports/history');
    return response.data;
  } catch (error) {
    // console.error('Fetch report history error:', error);
    return {
      total_reports: 0,
      completed_reports: 0,
      failed_reports: 0,
      this_month: 0,
      total_downloads: 0,
      arabic_reports: 0,
      english_reports: 0,
      success_rate: 0
    };
  }
};

export const fetchGeneratedReports = async () => {
  try {
    const response = await axiosInstance.get('/reports/generated');
    return response.data;
  } catch (error) {
    // console.error('Fetch generated reports error:', error);
    return [];
  }
};

export const generateReportInstance = async (reportData) => {
  try {
    const response = await axiosInstance.post('/reports/generate', reportData);
    return response.data;
  } catch (error) {
    // console.error('Generate report instance error:', error);
    throw error;
  }
};

export const deleteReportDefinition = async (reportId) => {
  try {
    const response = await axiosInstance.delete(`/reports/delete/${reportId}`);
    return response.data;
  } catch (error) {
    // console.error('Delete report definition error:', error);
    throw error;
  }
};

export const bulkDeleteReports = async (reportIds) => {
  try {
    const response = await axiosInstance.post('/reports/bulk-delete', { report_ids: reportIds });
    return response.data;
  } catch (error) {
    // console.error('Bulk delete reports error:', error);
    throw error;
  }
};

export const resetDownloadCount = async (reportId) => {
  try {
    const response = await axiosInstance.post(`/reports/reset-download-count/${reportId}`);
    return response.data;
  } catch (error) {
    // console.error('Reset download count error:', error);
    if (error.response?.status === 404) {
      throw new Error('التقرير غير موجود');
    } else if (error.response?.data?.error) {
      throw new Error(error.response.data.error);
    } else {
      throw new Error('فشل في إعادة تعيين عداد التحميلات');
    }
  }
};

export const resetAllDownloadCounts = async () => {
  try {
    const response = await axiosInstance.post('/reports/reset-all-download-counts');
    return response.data;
  } catch (error) {
    // console.error('Reset all download counts error:', error);
    if (error.response?.data?.error) {
      throw new Error(error.response.data.error);
    } else {
      throw new Error('فشل في إعادة تعيين جميع عدادات التحميلات');
    }
  }
};

export const fetchReportContent = async (reportId) => {
  try {
    const response = await axiosInstance.get(`/reports/content/${reportId}`);
    return response.data.content || 'لا يوجد محتوى للتقرير';
  } catch (error) {
    // console.error('Fetch report content error:', error);
    throw error;
  }
};

export const exportReport = async (reportId, format = 'pdf') => {
  try {
    let url;
    if (format === 'pdf') {
      url = `/reports/export-pdf/${reportId}`;
    } else {
      url = `/reports/export`;
    }

    // استخدام axiosInstance مع responseType blob
    const response = await axiosInstance.get(url, {
      params: format !== 'pdf' ? { report_id: reportId, format } : {},
      responseType: 'blob',
      timeout: 30000, // 30 ثانية timeout
      headers: {
        'Accept': 'application/pdf,application/octet-stream,*/*'
      }
    });

    // التحقق من أن الاستجابة صحيحة
    if (!response.data || response.data.size === 0) {
      throw new Error('Empty blob received');
    }

    // طباعة معلومات الاستجابة للتشخيص
    // console.log('Response status:', response.status);
    // console.log('Response headers:', response.headers);
    // console.log('Response data type:', typeof response.data);
    // console.log('Response data size:', response.data.size);

    return response.data;
  } catch (error) {
    console.error('Export report error:', error);

    // إذا كان الخطأ يحتوي على بيانات JSON، حاول قراءتها
    if (error.response && error.response.data && error.response.data.type === 'application/json') {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const errorData = JSON.parse(reader.result);
          console.error('Server error:', errorData);
        } catch (e) {
          console.error('Failed to parse error response');
        }
      };
      reader.readAsText(error.response.data);
    }

    throw error;
  }
};

// Settings API calls
export const getSettings = async () => {
  try {
    const response = await axiosInstance.get('/settings');
    return response.data;
  } catch (error) {
    console.warn('Get settings error:', error.response?.status, error.response?.data || error.message);
    return {};
  }
};

export const updateSettings = async (settings) => {
  try {
    const response = await axiosInstance.post('/settings', { settings });
    return response;
  } catch (error) {
    console.error('Update settings error:', error);
    throw error;
  }
};

export const fetchSettings = async () => {
  try {
    const response = await axiosInstance.get('/settings');
    return response.data;
  } catch (error) {
    console.error('Fetch settings error:', error);
    throw error;
  }
};

export const updateSetting = async (key, value) => {
  try {
    const response = await axiosInstance.put(`/settings/${key}`, { value });
    return response;
  } catch (error) {
    console.error('Update setting error:', error);
    throw error;
  }
};

export const resetSystemSettings = async () => {
  try {
    const response = await axiosInstance.post('/system/settings/reset');
    return response;
  } catch (error) {
    console.error('Reset system settings error:', error);
    throw error;
  }
};

export const scanSystem = async () => {
  try {
    const response = await axiosInstance.post('/system/scan');
    return response.data;
  } catch (error) {
    console.error('Scan system error:', error);
    throw error;
  }
};

export const fetchSystemDetails = async () => {
  try {
    const response = await axiosInstance.get('/system/details');
    return { data: response.data };
  } catch (error) {
    console.error('Fetch system details error:', error);
    throw error;
  }
};

// Users API calls
export const fetchUsers = async () => {
  try {
    const response = await axiosInstance.get('/auth/users');
    return response.data;
  } catch (error) {
    console.error('Fetch users error:', error);
    throw error;
  }
};

export const updateUser = async (userId, userData) => {
  try {
    const response = await axiosInstance.put(`/auth/users/${userId}`, userData);
    return response.data;
  } catch (error) {
    console.error('Update user error:', error);
    throw error;
  }
};

export const createUser = async (userData) => {
  try {
    const response = await axiosInstance.post('/auth/users', userData);
    return response.data;
  } catch (error) {
    console.error('Create user error:', error);
    throw error;
  }
};

export const deleteUser = async (userId) => {
  try {
    const response = await axiosInstance.delete(`/auth/users/${userId}`);
    return response.data;
  } catch (error) {
    console.error('Delete user error:', error);
    throw error;
  }
};

export const promoteUser = async (userId, role) => {
  try {
    const response = await axiosInstance.post(`/auth/users/${userId}/promote`, { role });
    return response.data;
  } catch (error) {
    console.error('Promote user error:', error);
    throw error;
  }
};

export const changePassword = async (currentPassword, newPassword) => {
  try {
    const response = await axiosInstance.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword
    });
    return response.data;
  } catch (error) {
    console.error('Change password error:', error);
    throw error;
  }
};

// MFA functions moved to end of file

// Roles API calls
export const fetchRoles = async () => {
  try {
    const response = await axiosInstance.get('/auth/roles');
    return response.data;
  } catch (error) {
    console.error('Fetch roles error:', error);
    throw error;
  }
};

export const fetchRole = async (roleId) => {
  try {
    const response = await axiosInstance.get(`/auth/roles/${roleId}`);
    return response.data;
  } catch (error) {
    console.error('Fetch role error:', error);
    throw error;
  }
};

export const createRole = async (roleData) => {
  try {
    const response = await axiosInstance.post('/auth/roles', roleData);
    return response.data;
  } catch (error) {
    console.error('Create role error:', error);
    throw error;
  }
};

export const updateRole = async (roleId, roleData) => {
  try {
    const response = await axiosInstance.put(`/auth/roles/${roleId}`, roleData);
    return response.data;
  } catch (error) {
    console.error('Update role error:', error);
    throw error;
  }
};

export const deleteRole = async (roleId) => {
  try {
    const response = await axiosInstance.delete(`/auth/roles/${roleId}`);
    return response.data;
  } catch (error) {
    console.error('Delete role error:', error);
    throw error;
  }
};

// Servers API calls
export const fetchServers = async () => {
  try {
    const response = await axiosInstance.get('/servers');
    return response.data || { servers: [] };
  } catch (error) {
    console.error('Fetch servers error:', error);
    // إرجاع بيانات افتراضية في حالة الخطأ
    return { servers: [] };
  }
};

export const fetchServer = async (serverId) => {
  console.log('fetchServer: serverId =', serverId);
  // التحقق من صحة serverId
  if (!serverId || serverId === 'undefined' || serverId === 'null') {
    throw new Error('معرف الخادم غير صحيح');
  }

  try {
    const response = await axiosInstance.get(`/servers/${serverId}`);
    return response.data;
  } catch (error) {
    console.error('Fetch server error:', error);
    throw error;
  }
};

export const registerServer = async (serverData) => {
  try {
    const response = await axiosInstance.post('/servers/register', serverData);
    return response.data;
  } catch (error) {
    console.error('Register server error:', error);
    throw error;
  }
};

export const serverHeartbeat = async (serverId) => {
  try {
    const response = await axiosInstance.post(`/servers/${serverId}/heartbeat`);
    return response.data;
  } catch (error) {
    console.error('Server heartbeat error:', error);
    throw error;
  }
};

export const serverSync = async (serverId, apiKey = null) => {
  try {
    // استخدام GET بدلاً من POST لتجنب مشكلة 405
    const params = apiKey ? { api_key: apiKey } : {};
    const response = await axiosInstance.get(`/servers/${serverId}/sync`, { params });
    return response.data;
  } catch (error) {
    console.error('Server sync error:', error);
    throw error;
  }
};

export const enableUsbPort = async (serverId, portId) => {
  try {
    const response = await axiosInstance.post(`/devices/port/${portId}/enable`, {
      server_id: serverId
    });
    return response.data;
  } catch (error) {
    console.error('Enable USB port error:', error);
    throw error;
  }
};

export const disableUsbPort = async (serverId, portId) => {
  try {
    const response = await axiosInstance.post(`/devices/port/${portId}/disable`, {
      server_id: serverId
    });
    return response.data;
  } catch (error) {
    console.error('Disable USB port error:', error);
    throw error;
  }
};

/**
 * تفعيل جميع أجهزة USB الطرفية فعلياً (حقيقي - PowerShell)
 * يستثني الأجهزة الداخلية تلقائياً
 */
export const bulkEnableAllUsbPorts = async () => {
  try {
    const response = await axiosInstance.post('/devices/ports/bulk-enable');
    return response.data;
  } catch (error) {
    console.error('Bulk enable USB ports error:', error);
    throw error;
  }
};

/**
 * تعطيل جميع أجهزة USB الطرفية فعلياً (حقيقي - PowerShell)
 * يستثني الأجهزة الداخلية تلقائياً
 */
export const bulkDisableAllUsbPorts = async () => {
  try {
    const response = await axiosInstance.post('/devices/ports/bulk-disable');
    return response.data;
  } catch (error) {
    console.error('Bulk disable USB ports error:', error);
    throw error;
  }
};

export const fetchServerUsbPorts = async (serverId) => {
  try {
    const response = await axiosInstance.get(`/servers/${serverId}/usb-ports`);
    return response.data;
  } catch (error) {
    console.error('Fetch server USB ports error:', error);
    throw error;
  }
};

export const fetchAllServersUsbPorts = async () => {
  try {
    const response = await axiosInstance.get('/servers/all-usb-ports');
    return response.data;
  } catch (error) {
    console.error('Fetch all servers USB ports error:', error);
    throw error;
  }
};

export const fetchRemoteServersUsbPorts = async () => {
  try {
    const response = await axiosInstance.get('/dashboard/remote-servers-usb-ports');
    return response.data;
  } catch (error) {
    console.error('Fetch remote servers USB ports error:', error);
    throw error;
  }
};

export const fetchDevicesPortsStats = async () => {
  try {
    const response = await axiosInstance.get('/devices/ports-stats');
    return response.data;
  } catch (error) {
    console.error('Fetch devices ports stats error:', error);
    throw error;
  }
};

export const fetchLocation = async () => {
  try {
    const response = await axiosInstance.get('/location');
    return response.data;
  } catch (error) {
    console.error('Fetch location error:', error);
    // إرجاع موقع افتراضي في حالة فشل الجلب
    return {
      city: 'بغداد',
      region: 'بغداد',
      country: 'العراق',
      latitude: 33.3152,
      longitude: 44.3661,
      ip: '127.0.0.1'
    };
  }
};



// AI Analysis API calls
export const fetchAIReports = async (params = {}) => {
  try {
    const response = await axiosInstance.get('/ai_monitoring/reports', { params });
    // إذا كانت البيانات عبارة عن مصفوفة مباشرة
    if (Array.isArray(response.data)) {
      return { reports: response.data };
    }
    // إذا كانت البيانات كائن ويحتوي على reports
    if (response.data && Array.isArray(response.data.reports)) {
      return { reports: response.data.reports };
    }
    // fallback: إذا كانت البيانات كائن
    return { reports: response.data ? [response.data] : [] };
  } catch (error) {
    console.error('Fetch AI reports error:', error);
    return { reports: [] };
  }
};

export const analyzeAI = async (data) => {
  try {
    const response = await axiosInstance.post('/ai_monitoring/analyze', data);
    return response.data;
  } catch (error) {
    console.error('Analyze AI error:', error);
    throw error;
  }
};

export const analyzeAllAI = async (data = {}) => {
  try {
    const response = await axiosInstance.post('/ai_monitoring/analyze-all', data);
    return response.data;
  } catch (error) {
    console.error('Analyze all AI error:', error);
    throw error;
  }
};

// Advanced AI Analysis with OpenAI
export const performAdvancedAIAnalysis = async (data) => {
  try {
    const response = await axiosInstance.post('/ai_monitoring/advanced-analyze', data);
    return response.data;
  } catch (error) {
    console.error('Advanced AI analysis error:', error);
    throw error;
  }
};

// إنشاء axios instance منفصل للسياسات بدون X-Server-Id
const createPoliciesAxios = () => {
  const instance = axios.create({
    baseURL: process.env.REACT_APP_API_URL || 'http://localhost:5000/api',
    timeout: 30000,
  });

  // إضافة interceptor للـ token فقط
  instance.interceptors.request.use(
    (config) => {
      const token = localStorage.getItem('access_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  return instance;
};

const policiesAxios = createPoliciesAxios();

// Policies API calls
export const fetchPolicies = async () => {
  try {
    const response = await policiesAxios.get('/policies/list');
    return { data: response.data };
  } catch (error) {
    console.error('Fetch policies error:', error);
    throw error;
  }
};

export const createPolicy = async (policyData) => {
  try {
    const response = await policiesAxios.post('/policies/create', policyData);
    return { data: response.data };
  } catch (error) {
    console.error('Create policy error:', error);
    throw error;
  }
};

export const updatePolicy = async (policyId, policyData) => {
  try {
    const response = await policiesAxios.put(`/policies/${policyId}`, policyData);
    return response.data;
  } catch (error) {
    console.error('Update policy error:', error);
    throw error;
  }
};

export const deletePolicy = async (policyId) => {
  try {
    const response = await policiesAxios.delete(`/policies/${policyId}`);
    return response.data;
  } catch (error) {
    console.error('Delete policy error:', error);
    throw error;
  }
};

export const activatePolicy = async (policyId) => {
  try {
    const response = await policiesAxios.post(`/policies/${policyId}/activate`);
    return response.data;
  } catch (error) {
    console.error('Activate policy error:', error);
    throw error;
  }
};

export const deactivatePolicy = async (policyId) => {
  try {
    const response = await policiesAxios.post(`/policies/${policyId}/deactivate`);
    return response.data;
  } catch (error) {
    console.error('Deactivate policy error:', error);
    throw error;
  }
};

// Blockchain API calls
export const fetchBlockchainStats = async () => {
  try {
    const response = await axiosInstance.get('/blockchain/stats');
    return response.data;
  } catch (error) {
    console.error('Fetch blockchain stats error:', error);
    // إرجاع بيانات افتراضية في حالة الخطأ
    return {
      total_records: 0,
      first_timestamp: null,
      last_timestamp: null,
      by_action: {}
    };
  }
};

export const fetchBlockchainData = async (params = {}) => {
  try {
    const response = await axiosInstance.get('/blockchain/', { params });
    return response.data;
  } catch (error) {
    console.error('Fetch blockchain data error:', error);
    // إرجاع بيانات افتراضية في حالة الخطأ
    return {
      blockchain_logs: [],
      total: 0,
      limit: params.limit || 50,
      offset: params.offset || 0
    };
  }
};

export const verifyBlockchain = async () => {
  try {
    const response = await axiosInstance.post('/blockchain/verify');
    return response.data;
  } catch (error) {
    console.error('Verify blockchain error:', error);
    // إرجاع نتيجة خطأ في التحقق
    return {
      verified: false,
      message: error.response?.data?.error || 'فشل في التحقق من البلوك تشين',
      blocks_checked: 0,
      results: []
    };
  }
};

export const addBlockchainRecord = async (recordData) => {
  try {
    const response = await axiosInstance.post('/blockchain/add', recordData);
    return response.data;
  } catch (error) {
    console.error('Add blockchain record error:', error);
    throw error;
  }
};

export const fetchUserBlockchainLogs = async (userId) => {
  try {
    const response = await axiosInstance.get(`/blockchain/user-logs/${userId}`);
    return response.data;
  } catch (error) {
    console.error('Fetch user blockchain logs error:', error);
    throw error;
  }
};

export const clearBlockchainData = async () => {
  try {
    const response = await axiosInstance.post('/blockchain/clear');
    return response.data;
  } catch (error) {
    console.error('Clear blockchain data error:', error);
    throw error;
  }
};

// User Stats API
export const fetchUserStats = async (params = {}) => {
  try {
    const response = await axiosInstance.get('/auth/users/stats', { params });
    return response.data;
  } catch (error) {
    console.error('Fetch user stats error:', error);
    throw error;
  }
};

// AI Monitoring Stats API  
export const fetchAIStats = async (params = {}) => {
  try {
    const response = await axiosInstance.get('/ai_monitoring/stats', { params });
    return response.data;
  } catch (error) {
    console.error('Fetch AI stats error:', error);
    return { data: null };
  }
};

// Activation API calls
export const fetchActivationInfo = async () => {
  try {
    const response = await axiosInstance.get('/status');
    return response.data;
  } catch (error) {
    console.error('Fetch activation info error:', error);
    throw error;
  }
};

// --- High Availability API Functions ---

export const changeServerRole = async (serverId, newRole) => {
  try {
    const response = await axiosInstance.post('/servers/ha/change-role', {
      server_id: serverId,
      role: newRole
    });
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to change server role');
  }
};

export const promoteSecondaryServer = async () => {
  try {
    const response = await axiosInstance.post('/servers/ha/promote-secondary');
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to promote secondary server');
  }
};

export const getHAStatus = async () => {
  try {
    const response = await axiosInstance.get('/servers/ha/status');
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to get HA status');
  }
};

export const getHAHistory = async () => {
  try {
    const response = await axiosInstance.get('/servers/ha/history');
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to get HA history');
  }
};

export const forceFailover = async () => {
  try {
    const response = await axiosInstance.post('/servers/ha/force-failover');
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to force failover');
  }
};

export const addServer = async (serverData) => {
  try {
    const response = await axiosInstance.post('/servers/register', serverData);
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to add server');
  }
};

export const updateServer = async (serverId, serverData) => {
  try {
    const response = await axiosInstance.put(`/servers/${serverId}`, serverData);
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to update server');
  }
};

export const deleteServer = async (serverId) => {
  try {
    const response = await axiosInstance.delete(`/servers/${serverId}`);
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to delete server');
  }
};

// =============================================================================
// DATA CLEARING FUNCTIONS - دوال مسح البيانات
// =============================================================================

// مسح الأجهزة
export const clearAllDevices = async () => {
  const response = await axiosInstance.delete('/devices/clear-all');
  return response.data;
};

export const clearDisconnectedDevices = async () => {
  const response = await axiosInstance.delete('/devices/clear-disconnected');
  return response.data;
};

export const clearPendingDevices = async () => {
  const response = await axiosInstance.delete('/devices/clear-pending');
  return response.data;
};

// مسح السجلات - تم نقل clearAllLogs إلى الأعلى
export const clearOldLogs = async () => {
  const response = await axiosInstance.delete('/logs/clear-old');
  return response.data;
};

export const clearLogsByType = async (type) => {
  const response = await axiosInstance.delete('/logs/clear-by-type', { data: { type } });
  return response.data;
};

// مسح شامل لجميع البيانات
export const clearAllDashboardData = async () => {
  try {
    const results = await Promise.allSettled([
      clearAllDevices(),
      clearAllAlerts(),
      clearAllLogs()
    ]);

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    return {
      success: true,
      message: `تم مسح البيانات بنجاح: ${successful} عملية نجحت، ${failed} عملية فشلت`,
      results
    };
  } catch (error) {
    throw new Error(`خطأ في المسح الشامل: ${error.message}`);
  }
};

// MFA functions
export const enableMfa = async () => {
  const response = await axiosInstance.post('/auth/mfa/enable');
  return response;
};

export const confirmMfa = async (data) => {
  const response = await axiosInstance.post('/auth/mfa/confirm', data);
  return response;
};

export const disableMfa = async (data) => {
  const response = await axiosInstance.post('/auth/mfa/disable', data);
  return response;
};

// Export axios instance for other uses
export { axiosInstance };

// دالة للحصول على معلومات WebSocket
export const getWebSocketStatus = async () => {
  try {
    const response = await axiosInstance.get('/servers/websocket-status');
    return response.data;
  } catch (error) {
    console.error('WebSocket status error:', error);
    // إرجاع إعدادات افتراضية في حالة فشل الطلب
    return {
      websocket_status: 'fallback',
      websocket_url: 'ws://localhost:5000/socket.io/',
      namespaces: ['/servers', '/devices', '/logs']
    };
  }
};

// =====================================================
// Device Blocker API - نظام حظر الأجهزة الفعلي
// =====================================================

/**
 * جلب حالة نظام حظر الأجهزة
 */
export const fetchBlockerStatus = async () => {
  try {
    const response = await axiosInstance.get('/devices/blocker/status');
    return response.data;
  } catch (error) {
    console.error('Fetch blocker status error:', error);
    return { blocked_count: 0, approved_count: 0, current_peripherals: [] };
  }
};

/**
 * جلب الأجهزة المحظورة فعلياً (التي تم تعطيلها عبر Disable-PnpDevice)
 */
export const fetchBlockedDevices = async () => {
  try {
    const response = await axiosInstance.get('/devices/blocker/blocked');
    return response.data;
  } catch (error) {
    console.error('Fetch blocked devices error:', error);
    return { blocked_devices: [], count: 0 };
  }
};

/**
 * الموافقة على جهاز محظور وتفعيله فعلياً (Enable-PnpDevice)
 * @param {string} deviceId - PnP InstanceId للجهاز
 */
export const approveBlockedDevice = async (deviceId) => {
  try {
    const response = await axiosInstance.post('/devices/blocker/approve', {
      device_id: deviceId
    });
    return response.data;
  } catch (error) {
    console.error('Approve blocked device error:', error);
    throw error;
  }
};

/**
 * سحب الموافقة وإعادة حظر الجهاز
 * @param {string} deviceId - PnP InstanceId للجهاز
 */
export const revokeBlockedDevice = async (deviceId) => {
  try {
    const response = await axiosInstance.post('/devices/blocker/revoke', {
      device_id: deviceId
    });
    return response.data;
  } catch (error) {
    console.error('Revoke blocked device error:', error);
    throw error;
  }
};

// =====================================================
// دوال الأجهزة المعلقة من العملاء (جدول معزول)
// =====================================================

/**
 * جلب الأجهزة المعلقة من العملاء (Agent Pending Devices)
 * @param {Object} params - معاملات الفلترة (status, agent_id, limit, offset)
 * @returns {Promise<Object>} - قائمة الأجهزة المعلقة
 */
export const fetchAgentPendingDevices = async (params = {}) => {
  try {
    const response = await axiosInstance.get('/devices/pending', { params });
    return response.data;
  } catch (error) {
    console.error('Fetch agent pending devices error:', error);
    return {
      success: false,
      devices: [],
      total: 0,
      error: error.message
    };
  }
};

/**
 * الموافقة على جهاز معلق من العملاء ونقله للجدول الرئيسي
 * @param {number} pendingId - معرف الجهاز المعلق
 * @returns {Promise<Object>} - نتيجة الموافقة
 */
export const approveAgentPendingDevice = async (pendingId) => {
  try {
    const response = await axiosInstance.post(`/devices/pending/${pendingId}/approve`);
    return response.data;
  } catch (error) {
    console.error('Approve agent pending device error:', error);
    throw error;
  }
};

/**
 * رفض جهاز معلق من العملاء
 * @param {number} pendingId - معرف الجهاز المعلق
 * @param {string} reason - سبب الرفض (اختياري)
 * @returns {Promise<Object>} - نتيجة الرفض
 */
export const rejectAgentPendingDevice = async (pendingId, reason = '') => {
  try {
    const response = await axiosInstance.post(`/devices/pending/${pendingId}/reject`, { reason });
    return response.data;
  } catch (error) {
    console.error('Reject agent pending device error:', error);
    throw error;
  }
};

/**
 * حذف جهاز معلق من العملاء نهائياً
 * @param {number} pendingId - معرف الجهاز المعلق
 * @returns {Promise<Object>} - نتيجة الحذف
 */
export const deleteAgentPendingDevice = async (pendingId) => {
  try {
    const response = await axiosInstance.delete(`/devices/pending/${pendingId}`);
    return response.data;
  } catch (error) {
    console.error('Delete agent pending device error:', error);
    throw error;
  }
};
