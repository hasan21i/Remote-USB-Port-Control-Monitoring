// src/context/DeviceContext.jsx

import React, {
  createContext,
  useReducer,
  useCallback,
  useEffect,
  useMemo
} from 'react';
import PropTypes from 'prop-types';
import {
  listDevices,
  getDeviceDetails,
  updateDevice,
  addDevice,
  controlDevice,
  scanNow,
  approveDevice,
  denyDevice,
  ejectDevice,
  searchDevices,
  searchDevicesEnhanced,
  getSystemStats,
  syncPolicies,
  checkCompatibility,
  addToWhitelist,
  addToBlacklist,
  removeFromWhitelist,
  removeFromBlacklist,
} from '../utils/api';

// الحالة الابتدائية
const initialState = {
  devices: [],
  isLoading: false,
  error: null,
  lastUpdate: null
};

// الريديُوسر
function reducer(state, { type, payload }) {
  switch (type) {
    case 'FETCH_START':
      return { ...state, isLoading: true, error: null };
    case 'FETCH_SUCCESS':
      return {
        ...state,
        isLoading: false,
        devices: payload,
        lastUpdate: Date.now()
      };
    case 'FETCH_FAILURE':
      return { ...state, isLoading: false, error: payload };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

// الــ Context مع القيم الافتراضية
export const DeviceContext = createContext({
  ...initialState,
  fetchDevices: async () => [],
  fetchDevice: async () => null,
  createDevice: async () => [],
  controlDevice: async () => [],
  scanDevices: async () => [],
  approveDevice: async () => [],
  denyDevice: async () => [],
  ejectDevice: async () => [],
  searchDevices: async () => [],
  searchDevicesEnhanced: async () => [],
  getSystemStats: async () => {},
  syncPolicies: async () => {},
  checkCompatibility: async () => {},
  clearError: () => {}
});

// الموفّر
export const DeviceProvider = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  // جلب قائمة الأجهزة مع دعم الفلاتر المحسّنة
  const fetchDevices = useCallback(async (params = {}) => {
    dispatch({ type: 'FETCH_START' });
    try {
      const response = await listDevices(params);
      
      // التعامل مع البنية الجديدة
      if (response && response.data) {
        const devices = Array.isArray(response.data) ? response.data : [];
        dispatch({ type: 'FETCH_SUCCESS', payload: devices });
        
        // إرجاع الاستجابة الكاملة مع الملخص
        return {
          devices,
          summary: response.summary,
          filters_applied: response.filters_applied
        };
      } else if (Array.isArray(response)) {
        // دعم البنية القديمة
        dispatch({ type: 'FETCH_SUCCESS', payload: response });
        return {
          devices: response,
          summary: {
            total_devices: response.length,
            real_devices: response.filter(d => d.is_real_device !== false).length,
            legacy_format: true
          }
        };
      }
      
      // في حالة عدم وجود بيانات
      dispatch({ type: 'FETCH_SUCCESS', payload: [] });
      return {
        devices: [],
        summary: {
          total_devices: 0,
          real_devices: 0,
          error_occurred: true
        }
      };
    } catch (err) {
      console.warn('Failed to fetch devices:', err);
      const msg = err.message || 'فشل في جلب الأجهزة';
      dispatch({ type: 'FETCH_FAILURE', payload: msg });
      
      // لا نرمي الاستثناء، نعيد مصفوفة فارغة مع معلومات الخطأ
      return {
        devices: [],
        summary: {
          total_devices: 0,
          real_devices: 0,
          error_occurred: true,
          error_message: msg
        }
      };
    }
  }, []);

  // جلب تفاصيل جهاز واحد
  const fetchDevice = useCallback(async (serial) => {
    // التحقق من صحة المعامل المرسل
    if (!serial || typeof serial !== 'string') {
      console.error('fetchDevice: Invalid serial parameter:', serial);
      throw new Error('رقم تسلسلي غير صالح');
    }
    
    // تنظيف المعامل من المسافات الزائدة
    const cleanSerial = serial.trim();
    if (!cleanSerial) {
      throw new Error('رقم تسلسلي فارغ');
    }
    
    // دعم device_identifier إذا لم يوجد serial_number
    const res = await getDeviceDetails(cleanSerial);
    
    // Handle the response structure - sometimes data is nested, sometimes it's direct
    if (res && typeof res === 'object') {
      // If res has a .data property, use it; otherwise use res directly
      const deviceData = res.data || res;
      return deviceData;
    }
    
    throw new Error('استجابة غير صالحة من الخادم');
  }, []);

  // تحديث جهاز
  const updateDeviceAction = useCallback(async (serial, data) => {
    const res = await updateDevice(serial, data);
    return res.data;
  }, []);

  // إضافة جهاز جديد
  const createDevice = useCallback(
    async (deviceData) => {
      // تمرير usb_port وphysical_path إذا كانت متاحة
      await addDevice({
        ...deviceData,
        usb_port: deviceData.usb_port,
        physical_path: deviceData.physical_path,
        serial_number: deviceData.serial_number || (deviceData.meta_data && deviceData.meta_data.device_identifier),
      });
      return await fetchDevices();
    },
    [fetchDevices]
  );

  // تحكم عام بالجهاز (تنفيذ عملية مع بيانات)
  const controlDeviceAction = useCallback(
    async (serial, action) => {
      // دعم device_identifier إذا لم يوجد serial_number
      await controlDevice(serial, action);
      return await fetchDevices();
    },
    [fetchDevices]
  );

  // الموافقة على جهاز
  const handleApproveDevice = useCallback(
    async (id) => {
      await approveDevice(id);
      return await fetchDevices();
    },
    [fetchDevices]
  );

  // رفض جهاز
  const handleDenyDevice = useCallback(
    async (id) => {
      await denyDevice(id);
      return await fetchDevices();
    },
    [fetchDevices]
  );

  // إخراج جهاز
  const handleEjectDevice = useCallback(
    async (serial) => {
      await ejectDevice(serial);
      return await fetchDevices();
    },
    [fetchDevices]
  );

  // إضافة إلى القائمة البيضاء
  const handleAddToWhitelist = useCallback(
    async (deviceId) => {
      await addToWhitelist(deviceId);
      return await fetchDevices();
    },
    [fetchDevices]
  );

  // إضافة إلى القائمة السوداء
  const handleAddToBlacklist = useCallback(
    async (deviceId) => {
      await addToBlacklist(deviceId);
      return await fetchDevices();
    },
    [fetchDevices]
  );

  // إزالة من القائمة البيضاء
  const handleRemoveFromWhitelist = useCallback(
    async (deviceId) => {
      await removeFromWhitelist(deviceId);
      return await fetchDevices();
    },
    [fetchDevices]
  );

  // إزالة من القائمة السوداء
  const handleRemoveFromBlacklist = useCallback(
    async (deviceId) => {
      await removeFromBlacklist(deviceId);
      return await fetchDevices();
    },
    [fetchDevices]
  );

  // فحص/مسح جديد للأجهزة - أعد نتيجة المسح من الخادم مباشرة
  const scanDevices = useCallback(async () => {
    const result = await scanNow();
    // حدّث القائمة في الخلفية دون التأثير على نتيجة المسح المعادة
    fetchDevices();
    return result;
  }, [fetchDevices]);



  // البحث عن أجهزة
  const handleSearchDevices = useCallback(async (params) => {
    const res = await searchDevices(params);
    return res.data;
  }, []);

  // جلب إحصائيات النظام
  const handleGetSystemStats = useCallback(async () => {
    const res = await getSystemStats();
    return res.data;
  }, []);

  // مزامنة السياسات
  const handleSyncPolicies = useCallback(async () => {
    const res = await syncPolicies();
    return res.data;
  }, []);

  // التحقق من التوافقية
  const handleCheckCompatibility = useCallback(async (params) => {
    const res = await checkCompatibility(params);
    return res.data;
  }, []);

  // مسح رسالة الخطأ
  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  // جلب الأجهزة عند التهيئة
  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  // قيمة الــ Context
  const contextValue = useMemo(
    () => ({
      devices:      state.devices,
      isLoading:    state.isLoading,
      error:        state.error,
      lastUpdate:   state.lastUpdate,
      fetchDevices,
      fetchDevice,
      updateDevice: updateDeviceAction,
      createDevice,
      controlDevice: controlDeviceAction,
      scanDevices,
      approveDevice: handleApproveDevice,
      denyDevice:    handleDenyDevice,
      ejectDevice:   handleEjectDevice,
      addToWhitelist: handleAddToWhitelist,
      addToBlacklist: handleAddToBlacklist,
      removeFromWhitelist: handleRemoveFromWhitelist,
      removeFromBlacklist: handleRemoveFromBlacklist,
      searchDevices: handleSearchDevices,
      searchDevicesEnhanced,
      getSystemStats: handleGetSystemStats,
      syncPolicies:   handleSyncPolicies,
      checkCompatibility: handleCheckCompatibility,
      clearError
    }),
    [
      state.devices,
      state.isLoading,
      state.error,
      state.lastUpdate,
      fetchDevices,
      fetchDevice,
      updateDeviceAction,
      createDevice,
      controlDeviceAction,
      scanDevices,
      handleApproveDevice,
      handleDenyDevice,
      handleEjectDevice,
      handleAddToWhitelist,
      handleAddToBlacklist,
      handleRemoveFromWhitelist,
      handleRemoveFromBlacklist,
      handleSearchDevices,
      handleGetSystemStats,
      handleSyncPolicies,
      handleCheckCompatibility,
      clearError
    ]
  );

  return (
    <DeviceContext.Provider value={contextValue}>
      {children}
    </DeviceContext.Provider>
  );
};

DeviceProvider.propTypes = {
  children: PropTypes.node.isRequired
};
