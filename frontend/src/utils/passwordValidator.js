// src/utils/passwordValidator.js

/** التحقق من قوة كلمة المرور */
export function validatePasswordStrength(password) {
  if (!password) {
    return { valid: false, message: 'كلمة المرور مطلوبة', checks: {} };
  }
  
  const checks = {
    minLen: password.length >= 8,
    hasLower: /[a-z]/.test(password),
    hasUpper: /[A-Z]/.test(password),
    hasNum: /\d/.test(password),
    hasSpec: /[!@#$%^&*(),.?"{}|<>]/.test(password),
  };
  
  const passed = Object.values(checks).filter(Boolean).length;
  
  if (!checks.minLen) {
    return { 
      valid: false, 
      message: 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل', 
      checks 
    };
  }
  
  if (passed < 4) {
    return { 
      valid: false, 
      message: 'كلمة المرور ضعيفة. ينبغي أن تحتوي على أحرف وأرقام ورموز.', 
      checks 
    };
  }
  
  return { 
    valid: true, 
    message: 'كلمة مرور قوية', 
    checks 
  };
}

export default validatePasswordStrength;
