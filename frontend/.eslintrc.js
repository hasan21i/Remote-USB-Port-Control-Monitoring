module.exports = {
  extends: [
    'react-app',
    'react-app/jest'
  ],
  rules: {
    // تحذيرات بدلاً من أخطاء
    'no-console': ['warn', {
      allow: ['warn', 'error']
    }],
    'no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_'
    }],
    'react/prop-types': ['warn', {
      ignore: ['children', 'className', 'style']
    }],
    'react-hooks/exhaustive-deps': 'warn'
  }
}; 