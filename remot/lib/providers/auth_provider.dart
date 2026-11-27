import 'package:flutter/material.dart';
import '../models/user_model.dart';
import '../models/permission_model.dart';
import '../services/api_service.dart';

/// مزود المصادقة - يدير حالة تسجيل الدخول والصلاحيات
class AuthProvider extends ChangeNotifier {
  UserModel? _currentUser;
  bool _isLoading = false;
  bool _isAuthenticated = false;
  String? _error;
  UserRole _userRole = UserRole.user;

  UserModel? get currentUser => _currentUser;
  bool get isLoading => _isLoading;
  bool get isAuthenticated => _isAuthenticated;
  String? get error => _error;
  UserRole get userRole => _userRole;

  // صلاحيات سريعة
  bool get isAdmin =>
      _userRole == UserRole.admin || _userRole == UserRole.owner;
  bool get isOwner => _userRole == UserRole.owner;
  bool get isManager => _currentUser?.isManager ?? false;
  bool get canEdit => PermissionManager.canEdit(_userRole);

  /// التحقق من صلاحية معينة
  bool hasPermission(Permission permission) {
    return PermissionManager.hasPermission(_userRole, permission);
  }

  /// التحقق من أي صلاحية
  bool hasAnyPermission(List<Permission> permissions) {
    return PermissionManager.hasAnyPermission(_userRole, permissions);
  }

  /// تسجيل الدخول (يدعم الإيميل أو اليوزرنيم)
  Future<bool> login(String emailOrUsername, String password) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final result = await ApiService.login(emailOrUsername, password);

      if (result['success'] == true) {
        // جلب بيانات المستخدم
        _currentUser = await ApiService.getCurrentUser();
        _isAuthenticated = _currentUser != null;

        // تحديد الدور
        if (_currentUser != null) {
          _userRole = roleFromString(_currentUser!.role);
        }

        _isLoading = false;
        notifyListeners();
        return true;
      } else {
        _error = result['error'] ?? 'فشل تسجيل الدخول';
        _isLoading = false;
        notifyListeners();
        return false;
      }
    } catch (e) {
      _error = 'خطأ في الاتصال: $e';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  /// إنشاء حساب جديد
  Future<bool> register({
    required String name,
    required String email,
    required String username,
    required String password,
  }) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final result = await ApiService.register(
        name: name,
        email: email,
        username: username,
        password: password,
      );

      _isLoading = false;

      if (result['success'] == true) {
        notifyListeners();
        return true;
      } else {
        _error = result['error'] ?? 'فشل إنشاء الحساب';
        notifyListeners();
        return false;
      }
    } catch (e) {
      _error = 'خطأ في الاتصال: $e';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  /// تسجيل الخروج
  Future<void> logout() async {
    _isLoading = true;
    notifyListeners();

    await ApiService.logout();

    _currentUser = null;
    _isAuthenticated = false;
    _userRole = UserRole.user;
    _isLoading = false;
    _error = null;
    notifyListeners();
  }

  /// التحقق من حالة تسجيل الدخول
  Future<void> checkAuthStatus() async {
    _isLoading = true;
    notifyListeners();

    try {
      final isLoggedIn = await ApiService.isLoggedIn();

      if (isLoggedIn) {
        _currentUser = await ApiService.getCurrentUser();
        _isAuthenticated = _currentUser != null;

        if (_currentUser != null) {
          _userRole = roleFromString(_currentUser!.role);
        }
      } else {
        _isAuthenticated = false;
        _currentUser = null;
        _userRole = UserRole.user;
      }
    } catch (e) {
      _isAuthenticated = false;
      _currentUser = null;
      _userRole = UserRole.user;
    }

    _isLoading = false;
    notifyListeners();
  }

  /// اسم الدور بالعربية
  String get roleDisplayName => getRoleDisplayName(_userRole);

  /// مسح الخطأ
  void clearError() {
    _error = null;
    notifyListeners();
  }
}
