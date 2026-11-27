// src/hooks/useAttack.js

import { useContext, useCallback, useMemo } from 'react';
import { AttackContext } from '../context/AttackContext';
import { fetchAttacks as apiFetchAttacks, fetchAttackDetails as apiFetchAttackDetails, confirmAttack as apiConfirmAttack, exportAttacks as apiExportAttacks } from '../utils/api';

/**
 * @typedef {Object} AttackContextValue
 * @property {Array<Object>} attacks                         قائمة أحداث الهجوم
 * @property {boolean}       isLoading                       حالة التحميل
 * @property {string|null}   error                           رسالة الخطأ إن وجدت
 * @property {() => Promise<Array<Object>>}                  fetchAttacks         لجلب قائمة الهجمات
 * @property {(id: number|string) => Promise<Object|null>}   fetchAttackDetails   لجلب تفاصيل هجوم معين
 * @property {(id: number|string) => Promise<Object>}        confirmAttack        لتأكيد هجوم
 */

/**
 * Hook للتعامل مع أحداث الهجوم السيبراني (Intrusion Events).
 *
 * يجب استخدامه داخل مزوّد AttackProvider.
 *
 * @returns {AttackContextValue}
 */
const useAttack = () => {
  const context = useContext(AttackContext);
  if (!context) {
    throw new Error('useAttack must be used within an AttackProvider');
  }

  const {
    attacks,
    isLoading,
    error,
    fetchList,     // من السياق: جلب قائمة الهجمات
    fetchDetail,   // من السياق: جلب تفاصيل هجوم معين
    confirm,       // من السياق: تأكيد الهجوم
    clearError     // من السياق: مسح الخطأ
  } = context;

  // جلب قائمة الهجمات مع الفلترة
  const fetchAttacks = useCallback(
    (params) => apiFetchAttacks(params),
    []
  );

  // جلب تفاصيل هجوم واحد
  const fetchAttackDetails = useCallback(
    (id) => apiFetchAttackDetails(id),
    []
  );

  // تأكيد هجوم
  const confirmAttack = useCallback(
    (id) => apiConfirmAttack(id),
    []
  );

  // تصدير الهجمات
  const exportAttacks = useCallback(
    () => apiExportAttacks(),
    []
  );

  // نجمع القيم والدوال معاً لمنع إعادة الإنشاء غير الضرورية
  return useMemo(() => ({
    attacks,
    isLoading,
    error,
    fetchAttacks,
    fetchAttackDetails,
    confirmAttack,
    exportAttacks,
    clearError
  }), [
    attacks,
    isLoading,
    error,
    fetchAttacks,
    fetchAttackDetails,
    confirmAttack,
    exportAttacks,
    clearError
  ]);
};

export default useAttack;
