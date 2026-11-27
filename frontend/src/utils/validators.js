// src/utils/validators.js

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid      – هل الحقل صالح؟
 * @property {string|null} message – رسالة الخطأ (أو null إذا صالح)
 */

/**
 * يطابق القيمة مع النمط المعطى أو يُرجع رسالة الخطأ.
 * @param {string} value
 * @param {RegExp} pattern
 * @param {string} message
 * @returns {ValidationResult}
 */
const matchPattern = (value, pattern, message) => {
  if (typeof value !== 'string' || !pattern.test(value)) {
    return { valid: false, message };
  }
  return { valid: true, message: null };
};

/**
 * يتحقق من أن الحقل ليس فارغًا.
 * @param {any} value
 * @param {string} [name='هذا الحقل']
 * @returns {ValidationResult}
 */
export const isNotEmpty = (value, name = 'هذا الحقل') => {
  const ok = value !== undefined && value !== null && String(value).trim() !== '';
  return {
    valid: ok,
    message: ok ? null : `${name} مطلوب`
  };
};

/**
 * يتحقق من صحة البريد الإلكتروني.
 * @param {string} email
 * @returns {ValidationResult}
 */
export const isValidEmail = email => {
  if (!email) {
    return { valid: false, message: 'البريد الإلكتروني مطلوب' };
  }
  // نمط بسيط يدعم Unicode
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
  return matchPattern(email, regex, 'البريد الإلكتروني غير صالح');
};

/**
 * يتحقق من أن كلمة المرور تفي بالشروط.
 * @param {string} pwd
 * @param {object} [opts]
 * @param {number} [opts.minLength=8]
 * @param {boolean} [opts.requireUpper=true]
 * @param {boolean} [opts.requireLower=true]
 * @param {boolean} [opts.requireNumber=true]
 * @param {boolean} [opts.requireSpecial=true]
 * @returns {ValidationResult}
 */
export const isValidPassword = (pwd, opts = {}) => {
  const {
    minLength = 8,
    requireUpper = true,
    requireLower = true,
    requireNumber = true,
    requireSpecial = true
  } = opts;

  if (!pwd) {
    return { valid: false, message: 'كلمة المرور مطلوبة' };
  }
  if (pwd.length < minLength) {
    return {
      valid: false,
      message: `يجب أن تكون كلمة المرور ${minLength} أحرف على الأقل`
    };
  }
  if (requireUpper && !/[A-Z]/.test(pwd)) {
    return { valid: false, message: 'يجب أن تحتوي كلمة المرور على حرف كبير واحد على الأقل' };
  }
  if (requireLower && !/[a-z]/.test(pwd)) {
    return { valid: false, message: 'يجب أن تحتوي كلمة المرور على حرف صغير واحد على الأقل' };
  }
  if (requireNumber && !/\d/.test(pwd)) {
    return { valid: false, message: 'يجب أن تحتوي كلمة المرور على رقم واحد على الأقل' };
  }
  if (requireSpecial && !/[!@#$%^&*(),.?":{}|<>]/.test(pwd)) {
    return { valid: false, message: 'يجب أن تحتوي كلمة المرور على رمز خاص واحد على الأقل' };
  }
  return { valid: true, message: null };
};

/**
 * يتحقق من تطابق كلمتي المرور.
 * @param {string} pwd
 * @param {string} confirmPwd
 * @returns {ValidationResult}
 */
export const doPasswordsMatch = (pwd, confirmPwd) => ({
  valid: pwd === confirmPwd,
  message: pwd === confirmPwd ? null : 'كلمتا المرور غير متطابقتين'
});

/**
 * يتحقق من صحة اسم المستخدم (4-20 حرف/رقم/_).
 * @param {string} username
 * @returns {ValidationResult}
 */
export const isValidUsername = username =>
  matchPattern(
    username,
    /^[A-Za-z0-9_]{4,20}$/,
    'اسم المستخدم يجب أن يكون 4-20 حرفًا أو رقمًا أو _'
  );

/**
 * يتحقق من الحقل identifier (بريد أو اسم مستخدم).
 * @param {string} id
 * @returns {ValidationResult}
 */
export const isValidIdentifier = id => {
  if (!id || !id.trim()) {
    return { valid: false, message: 'اسم المستخدم أو البريد الإلكتروني مطلوب' };
  }
  return id.includes('@') ? isValidEmail(id) : isValidUsername(id);
};

/**
 * يتحقق من رقم الهاتف بتنسيق E.164.
 * @param {string} phone
 * @returns {ValidationResult}
 */
export const isValidPhone = phone =>
  matchPattern(
    phone,
    /^\+?[1-9]\d{1,14}$/,
    'رقم الهاتف غير صالح (مثال: +966xxxxxxxxx)'
  );

/**
 * يتحقق من صحة الرقم التسلسلي للجهاز (5-20 حرف/رقم/شرطة).
 * @param {string} serial
 * @returns {ValidationResult}
 */
export const isValidSerial = serial =>
  matchPattern(
    serial,
    /^[A-Za-z0-9-]{5,20}$/,
    'الرقم التسلسلي يجب أن يكون 5-20 حرفًا أو رقمًا أو -'
  );

// لوجود استيراد قديم في عدة مكونات:
export const isValidSerialNumber = isValidSerial;

/**
 * يتحقق من معرّف Hex أو Dec (vendor_id أو product_id).
 * @param {string} id
 * @param {string} fieldName
 * @returns {ValidationResult}
 */
const isHexDec = (id, fieldName) =>
  matchPattern(
    id,
    /^[A-Fa-f0-9]+$/,
    `${fieldName} غير صالح (أحرف A-F أو أرقام)`
  );

export const isValidVendorId = id => (id
  ? isHexDec(id, 'معرّف البائع')
  : { valid: false, message: 'معرّف البائع مطلوب' }
);

export const isValidProductId = id => (id
  ? isHexDec(id, 'معرّف المنتج')
  : { valid: false, message: 'معرّف المنتج مطلوب' }
);

/**
 * يتحقق من اسم الجهاز (1-100 حرف).
 * @param {string} name
 * @returns {ValidationResult}
 */
export const isValidDeviceName = name => {
  if (!name || name.trim().length > 100) {
    return { valid: false, message: 'اسم الجهاز مطلوب (حتى 100 حرف)' };
  }
  return { valid: true, message: null };
};

/**
 * يتحقق من منفذ USB غير فارغ.
 * @param {string} port
 * @returns {ValidationResult}
 */
export const isValidUsbPort = port =>
  isNotEmpty(port, 'منفذ USB');

/**
 * يطبق القواعد على قيمة واحدة ويرجع أول خطأ.
 * @param {any} value
 * @param {Array<Function>} rules
 * @returns {ValidationResult}
 */
export const validateField = (value, rules) => {
  for (const rule of rules) {
    const res = rule(value);
    if (!res.valid) return res;
  }
  return { valid: true, message: null };
};

/**
 * يطبق قواعد على نموذج كامل ويجمّع الأخطاء.
 * @param {Object} data
 * @param {Object.<string, Array<Function>>} schema
 * @returns {{ isValid: boolean, errors: Object.<string,string> }}
 */
export const validateForm = (data, schema) => {
  const errors = {};
  Object.entries(schema).forEach(([key, rules]) => {
    const { valid, message } = validateField(data[key], rules);
    if (!valid) errors[key] = message;
  });
  return { isValid: Object.keys(errors).length === 0, errors };
};
