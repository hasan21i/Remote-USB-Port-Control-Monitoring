import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// مزود السمة - يدير وضع الليل والنهار
class ThemeProvider extends ChangeNotifier {
  static const String _themeKey = 'theme_mode';
  final FlutterSecureStorage _storage = const FlutterSecureStorage();

  ThemeMode _themeMode = ThemeMode.system;
  bool _isInitialized = false;

  ThemeMode get themeMode => _themeMode;
  bool get isInitialized => _isInitialized;
  bool get isDarkMode => _themeMode == ThemeMode.dark;
  bool get isLightMode => _themeMode == ThemeMode.light;
  bool get isSystemMode => _themeMode == ThemeMode.system;

  ThemeProvider() {
    _loadTheme();
  }

  /// تحميل السمة المحفوظة
  Future<void> _loadTheme() async {
    try {
      final savedTheme = await _storage.read(key: _themeKey);
      if (savedTheme != null) {
        switch (savedTheme) {
          case 'dark':
            _themeMode = ThemeMode.dark;
            break;
          case 'light':
            _themeMode = ThemeMode.light;
            break;
          default:
            _themeMode = ThemeMode.system;
        }
      }
    } catch (e) {
      _themeMode = ThemeMode.system;
    }
    _isInitialized = true;
    notifyListeners();
  }

  /// تعيين الوضع الليلي
  Future<void> setDarkMode() async {
    _themeMode = ThemeMode.dark;
    await _storage.write(key: _themeKey, value: 'dark');
    notifyListeners();
  }

  /// تعيين الوضع النهاري
  Future<void> setLightMode() async {
    _themeMode = ThemeMode.light;
    await _storage.write(key: _themeKey, value: 'light');
    notifyListeners();
  }

  /// تعيين وضع النظام
  Future<void> setSystemMode() async {
    _themeMode = ThemeMode.system;
    await _storage.write(key: _themeKey, value: 'system');
    notifyListeners();
  }

  /// تبديل السمة
  Future<void> toggleTheme() async {
    if (_themeMode == ThemeMode.dark) {
      await setLightMode();
    } else {
      await setDarkMode();
    }
  }

  /// تعيين وضع السمة
  Future<void> setThemeMode(ThemeMode mode) async {
    _themeMode = mode;
    String value;
    switch (mode) {
      case ThemeMode.dark:
        value = 'dark';
        break;
      case ThemeMode.light:
        value = 'light';
        break;
      default:
        value = 'system';
    }
    await _storage.write(key: _themeKey, value: value);
    notifyListeners();
  }
}
