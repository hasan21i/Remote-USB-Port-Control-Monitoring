// src/hooks/useDevice.js

import { useContext, useMemo } from 'react';
import { DeviceContext } from '../context/DeviceContext';

const useDevice = () => {
  const context = useContext(DeviceContext);

  if (!context) {
    throw new Error('⚠️ useDevice must be used within a DeviceProvider');
  }

  const {
    devices = [],
    isLoading,
    error,
    lastUpdate,
    fetchDevices,        // جلب جميع الأجهزة
    fetchDevice,         // جلب جهاز واحد
    createDevice,        // إضافة جهاز جديد
    controlDevice,       // تحكم بجهاز
    scanDevices,         // إعادة مسح الأجهزة
    approveDevice,       // الموافقة على جهاز
    denyDevice,          // رفض جهاز
    ejectDevice,         // إخراج جهاز
    addToWhitelist,      // إضافة إلى القائمة البيضاء
    addToBlacklist,      // إضافة إلى القائمة السوداء
    removeFromWhitelist, // إزالة من القائمة البيضاء
    removeFromBlacklist, // إزالة من القائمة السوداء
    getDeviceStatus,     // حالة الجهاز
    searchDevices,       // البحث عن أجهزة
    searchDevicesEnhanced, // البحث المحسن في جميع السيرفرات
    getSystemStats,      // إحصائيات النظام
    syncPolicies,        // مزامنة السياسات
    checkCompatibility,  // التحقق من التوافقية
    clearError,          // مسح الأخطاء
  } = context;

  return useMemo(() => ({
    devices,
    isLoading,
    error,
    lastUpdate,
    fetchDevices,
    fetchDevice,
    createDevice,
    controlDevice,
    scanDevices,
    approveDevice,
    denyDevice,
    ejectDevice,
    addToWhitelist,
    addToBlacklist,
    removeFromWhitelist,
    removeFromBlacklist,
    getDeviceStatus,
    searchDevices,
    searchDevicesEnhanced,
    getSystemStats,
    syncPolicies,
    checkCompatibility,
    clearError,
  }), [
    devices,
    isLoading,
    error,
    lastUpdate,
    fetchDevices,
    fetchDevice,
    createDevice,
    controlDevice,
    scanDevices,
    approveDevice,
    denyDevice,
    ejectDevice,
    addToWhitelist,
    addToBlacklist,
    removeFromWhitelist,
    removeFromBlacklist,
    getDeviceStatus,
    searchDevices,
    searchDevicesEnhanced,
    getSystemStats,
    syncPolicies,
    checkCompatibility,
    clearError,
  ]);
};

export default useDevice;
