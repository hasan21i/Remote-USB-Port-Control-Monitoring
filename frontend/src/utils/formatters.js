// src/utils/formatters.js

// ——————————————————————————————————————————————
//  Helpers for caching Intl.Formatters
// ——————————————————————————————————————————————
const dateTimeFormatterCache    = new Map();
const numberFormatterCache      = new Map();
const currencyFormatterCache    = new Map();
const relativeFormatterCache    = new Map();

function getDateTimeFormatter(locale, options) {
  const key = `${locale}-${JSON.stringify(options)}`;
  if (!dateTimeFormatterCache.has(key)) {
    dateTimeFormatterCache.set(key, new Intl.DateTimeFormat(locale, options));
  }
  return dateTimeFormatterCache.get(key);
}

function getNumberFormatter(locale, options) {
  const key = `${locale}-${JSON.stringify(options)}`;
  if (!numberFormatterCache.has(key)) {
    numberFormatterCache.set(key, new Intl.NumberFormat(locale, options));
  }
  return numberFormatterCache.get(key);
}

function getCurrencyFormatter(locale, currency) {
  const key = `${locale}-${currency}`;
  if (!currencyFormatterCache.has(key)) {
    currencyFormatterCache.set(
      key,
      new Intl.NumberFormat(locale, { style: 'currency', currency })
    );
  }
  return currencyFormatterCache.get(key);
}

function getRelativeFormatter(locale, options = {}) {
  const key = `${locale}-${JSON.stringify(options)}`;
  if (!relativeFormatterCache.has(key)) {
    relativeFormatterCache.set(key, new Intl.RelativeTimeFormat(locale, options));
  }
  return relativeFormatterCache.get(key);
}

// ——————————————————————————————————————————————
//  Default locale resolver
// ——————————————————————————————————————————————
function resolveLocale(provided) {
  if (provided) return provided;
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }
  // Default to Iraqi Arabic
  return 'ar-IQ';
}

// ——————————————————————————————————————————————
//  Status, Priority & Event maps (match backend Log.action, Device.status, Alert.priority)
// ——————————————————————————————————————————————
const statusMap = {
  pending:      'معلق',
  approved:     'معتمد',
  blocked:      'محظور',
  denied:       'مرفوض',
  active:       'نشط',
  inactive:     'غير نشط',
  connected:    'متصل',
  disconnected: 'غير متصل',
  unknown:      'غير معروف'
};

const priorityMap = {
  low:      'منخفضة',
  normal:   'عادية',
  medium:   'متوسطة',
  high:     'عالية',
  critical: 'حرجة'
};

const eventTypeMap = {
  ar: {
    // User events
    user_registered:   'تسجيل مستخدم جديد',
    user_created:      'إنشاء مستخدم',
    user_updated:      'تحديث مستخدم',
    user_deleted:      'حذف مستخدم',
    user_login:        'تسجيل الدخول',
    user_logout:       'تسجيل الخروج',

    // Auth/MFA
    password_reset:    'إعادة تعيين كلمة المرور',
    password_changed:  'تغيير كلمة المرور',
    ai_chat:           'دردشة الذكاء الاصطناعي',

    // Device events
    device_list_viewed:        'عرض قائمة الأجهزة',
    device_status_viewed:      'عرض حالة الجهاز',
    device_search:             'بحث عن جهاز',
    device_added_manually:     'إضافة جهاز يدويًا',
    manual_usb_scan:           'مسح USB يدوي',
    device_discovered:         'اكتشاف جهاز',
    device_connected:          'اتصال جهاز',
    device_disconnected:       'انقطاع جهاز',
    device_approved:           'الموافقة على الجهاز',
    device_denied:             'رفض الجهاز',
    device_blocked:            'حظر جهاز',
    device_auto_blocked:       'حظر جهاز تلقائيًا',
    device_whitelisted:        'إضافة إلى القائمة البيضاء',
    device_removed_from_blacklist: 'إزالة من القائمة السوداء',
    device_blacklisted:        'إضافة إلى القائمة السوداء',



    // Alerts
    alerts_viewed:         'عرض التنبيهات',
    alerts_bulk_resolved:  'حل جماعي للتنبيهات',
    alert_resolved:        'حل التنبيه',
    alert_stats_viewed:    'عرض إحصائيات التنبيهات',

    // Logs & Blockchain
    logs_viewed:           'عرض السجلات',
    logs_cleared:          'مسح السجلات',
    log_stats_viewed:      'عرض إحصائيات السجلات',
    blockchain_logs_viewed: 'عرض سجلات البلوكشين',
    blockchain_stats_viewed:'عرض إحصائيات البلوكشين',
    blockchain_verified:   'التحقق من البلوكشين',

    // Policies
    policies_listed:      'عرض السياسات',
    policies_synced:      'مزامنة السياسات',
    policy_created:       'إنشاء سياسة',
    policy_updated:       'تحديث سياسة',
    policy_viewed:        'عرض سياسة',
    policy_deleted:       'حذف سياسة',
    policy_activated:     'تفعيل السياسة',
    policy_deactivated:   'إلغاء تفعيل السياسة',

    // Reports
    report_run:           'تشغيل التقرير',
    report_scheduled:     'جدولة التقرير',
    report_history_viewed:'عرض سجل التقارير',

    // Servers
    servers_listed:       'عرض الخوادم',
    server_registered:    'تسجيل خادم جديد',
    server_viewed:        'عرض تفاصيل الخادم',

    // USB Transfer
    usb_transfer:         'نقل USB',
    error:                'خطأ'
  },
  en: {
    // User events
    user_registered:   'User Registered',
    user_created:      'User Created',
    user_updated:      'User Updated',
    user_deleted:      'User Deleted',
    user_login:        'User Login',
    user_logout:       'User Logout',

    // Auth/MFA
    password_reset:    'Password Reset',
    password_changed:  'Password Changed',
    ai_chat:           'AI Chat',

    // Device events
    device_list_viewed:        'Device List Viewed',
    device_status_viewed:      'Device Status Viewed',
    device_search:             'Device Search',
    device_added_manually:     'Device Added Manually',
    manual_usb_scan:           'Manual USB Scan',
    device_discovered:         'Device Discovered',
    device_connected:          'Device Connected',
    device_disconnected:       'Device Disconnected',
    device_approved:           'Device Approved',
    device_denied:             'Device Denied',
    device_blocked:            'Device Blocked',
    device_auto_blocked:       'Device Auto Blocked',
    device_whitelisted:        'Device Whitelisted',
    device_removed_from_blacklist: 'Device Removed from Blacklist',
    device_blacklisted:        'Device Blacklisted',



    // Alerts
    alerts_viewed:         'Alerts Viewed',
    alerts_bulk_resolved:  'Alerts Bulk Resolved',
    alert_resolved:        'Alert Resolved',
    alert_stats_viewed:    'Alert Stats Viewed',

    // Logs & Blockchain
    logs_viewed:           'Logs Viewed',
    logs_cleared:          'Logs Cleared',
    log_stats_viewed:      'Log Stats Viewed',
    blockchain_logs_viewed: 'Blockchain Logs Viewed',
    blockchain_stats_viewed:'Blockchain Stats Viewed',
    blockchain_verified:   'Blockchain Verified',

    // Policies
    policies_listed:      'Policies Listed',
    policies_synced:      'Policies Synced',
    policy_created:       'Policy Created',
    policy_updated:       'Policy Updated',
    policy_viewed:        'Policy Viewed',
    policy_deleted:       'Policy Deleted',
    policy_activated:     'Policy Activated',
    policy_deactivated:   'Policy Deactivated',

    // Reports
    report_run:           'Report Run',
    report_scheduled:     'Report Scheduled',
    report_history_viewed:'Report History Viewed',

    // Servers
    servers_listed:       'Servers Listed',
    server_registered:    'Server Registered',
    server_viewed:        'Server Viewed',

    // USB Transfer
    usb_transfer:         'USB Transfer',
    error:                'Error'
  }
};

// Legacy Arabic map for backward compatibility removed to fix initialization error

// ——————————————————————————————————————————————
//  Exported formatting functions
// ——————————————————————————————————————————————

/**
 * تنسيق التاريخ والوقت
 */
export function formatDateTime(date, options = {}, locale) {
  if (!date) return '';
  const dt = new Date(date);
  if (isNaN(dt)) return '';
  
  const fmt = getDateTimeFormatter(
    resolveLocale(locale),
    {
      year:   'numeric',
      month:  'short',
      day:    'numeric',
      hour:   '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      // إزالة timeZone لأن التواريخ من الباكيند بتوقيت بغداد بالفعل
      ...options
    }
  );
  return fmt.format(dt);
}

/**
 * تنسيق التاريخ فقط
 */
export function formatDate(date, locale) {
  return formatDateTime(date,
    { hour: undefined, minute: undefined, second: undefined },
    locale
  );
}

/**
 * تنسيق الوقت فقط
 */
export function formatTime(date, locale) {
  return formatDateTime(date,
    { year: undefined, month: undefined, day: undefined },
    locale
  );
}

/**
 * تنسيق العملة (افتراضياً: دينار عراقي)
 */
export function formatCurrency(amount, currency = 'IQD', locale) {
  if (amount == null) return '';
  try {
    const fmt = getCurrencyFormatter(resolveLocale(locale), currency);
    return fmt.format(amount);
  } catch {
    return '';
  }
}

/**
 * تنسيق رقم عادي
 */
export function formatNumber(number, options = {}, locale) {
  if (number == null) return '';
  try {
    const fmt = getNumberFormatter(resolveLocale(locale), options);
    return fmt.format(number);
  } catch {
    return '';
  }
}

/**
 * تنسيق نسبة مئوية
 */
export function formatPercent(value, locale) {
  return formatNumber(value,
    { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 2 },
    locale
  );
}

/**
 * تنسيق حجم الملف
 */
export function formatFileSize(bytes) {
  if (bytes == null || bytes < 0) return '';
  if (bytes === 0) return '0 بايت';
  const units = ['بايت','كيلوبايت','ميجابايت','جيجابايت','تيرابايت'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/**
 * تنسيق مدة (ثوانٍ) إلى نص
 */
export function formatDuration(seconds) {
  if (seconds == null || seconds < 0) return '';
  if (seconds < 60) return `${seconds} ثانية`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} دقيقة`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h} ساعة و ${rm} دقيقة` : `${h} ساعة`;
}

/**
 * تنسيق الوقت النسبي
 */
export function formatRelativeTime(date, locale) {
  if (!date) return '';
  const dt = new Date(date);
  if (isNaN(dt)) return '';
  const now = Date.now();
  const diffSeconds = Math.floor((dt - now) / 1000);
  const units = [
    { unit: 'year',   secs: 365*24*3600 },
    { unit: 'month',  secs: 30*24*3600 },
    { unit: 'day',    secs: 24*3600 },
    { unit: 'hour',   secs: 3600 },
    { unit: 'minute', secs: 60 },
    { unit: 'second', secs: 1 }
  ];
  for (const {unit, secs} of units) {
    const v = Math.floor(diffSeconds / secs);
    if (Math.abs(v) >= 1) {
      const fmt = getRelativeFormatter(resolveLocale(locale), { numeric: 'auto' });
      return fmt.format(v, unit);
    }
  }
  return 'الآن';
}

/**
 * تنسيق حالة الجهاز / التطبيق
 */
export function formatStatus(status) {
  return statusMap[status] || status;
}

/**
 * تنسيق أولوية التنبيه
 */
export function formatPriority(priority) {
  return priorityMap[priority] || priority;
}

/**
 * تنسيق نوع الحدث (Log.action)
 */
export function formatEventType(type, language = 'ar') {
  const langMap = eventTypeMap[language] || eventTypeMap.ar;
  return langMap[type] || type;
}

/**
 * اقتطاع نص طويل
 */
export function truncateText(text, maxLength = 50) {
  if (!text) return '';
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

/**
 * تنسيق للتاريخ مناسب لحقل <input type="date">
 */
export function formatDateForInput(date) {
  if (!date) return '';
  const dt = new Date(date);
  if (isNaN(dt)) return '';
  const year  = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day   = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * تحديد ما إذا كان الخادم متصل أم لا
 * @param {Object} server - كائن الخادم
 * @returns {boolean} - true إذا كان متصل، false إذا كان غير متصل
 */
export const isServerOnline = (server) => {
  if (!server) return false;
  // السيرفر الرئيسي متصل دائماً — إذا وصلت البيانات للمتصفح فهذا يعني أن الباكند شغال
  if (server.role === 'primary' || server.id === 1) {
    return true;
  }
  // السيرفرات الفرعية: نقرأ is_online من قاعدة البيانات مباشرة
  return server.is_online === true;
};

/**
 * الحصول على نص حالة الخادم
 * @param {Object} server - كائن الخادم
 * @returns {string} - نص الحالة
 */
export const getServerStatusText = (server) => {
  if (!server) return 'غير معروف';
  if (isServerOnline(server)) return 'متصل';
  return 'غير متصل';
};

/**
 * الحصول على لون حالة الخادم
 * @param {Object} server - كائن الخادم
 * @returns {string} - لون الحالة
 */
export const getServerStatusColor = (server) => {
  if (!server) return 'warning';
  if (isServerOnline(server)) return 'success';
  return 'danger';
};

// ——————————————————————————————————————————————
// Legacy / Aliases
// ——————————————————————————————————————————————

/**
 * باسم formatAlertPriority لدعم الاستيراد القديم في بعض المكونات
 */
export const formatAlertPriority = formatPriority;
