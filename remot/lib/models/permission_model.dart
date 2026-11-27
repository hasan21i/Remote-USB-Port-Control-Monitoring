/// نظام الصلاحيات والأدوار
///
/// الأدوار المتاحة:
/// - owner: المالك - صلاحيات كاملة
/// - admin: المدير - صلاحيات إدارية
/// - user: المستخدم - صلاحيات القراءة فقط
library;

/// أنواع الأدوار
enum UserRole { owner, admin, user }

/// تحويل النص إلى دور
UserRole roleFromString(String? role) {
  switch (role?.toLowerCase()) {
    case 'owner':
      return UserRole.owner;
    case 'admin':
      return UserRole.admin;
    case 'user':
    default:
      return UserRole.user;
  }
}

/// تحويل الدور إلى نص
String roleToString(UserRole role) {
  switch (role) {
    case UserRole.owner:
      return 'owner';
    case UserRole.admin:
      return 'admin';
    case UserRole.user:
      return 'user';
  }
}

/// الحصول على اسم الدور بالعربية
String getRoleDisplayName(UserRole role) {
  switch (role) {
    case UserRole.owner:
      return 'المالك';
    case UserRole.admin:
      return 'مدير';
    case UserRole.user:
      return 'مستخدم';
  }
}

/// أنواع الصلاحيات
enum Permission {
  // صلاحيات الأجهزة
  viewDevices,
  manageDevices,
  blockDevices,

  // صلاحيات السياسات
  viewPolicies,
  createPolicies,
  editPolicies,
  deletePolicies,

  // صلاحيات التنبيهات
  viewAlerts,
  manageAlerts,
  deleteAlerts,

  // صلاحيات السجلات
  viewLogs,
  exportLogs,
  deleteLogs,

  // صلاحيات التقارير
  viewReports,
  createReports,
  exportReports,

  // صلاحيات الخوادم
  viewServers,
  manageServers,

  // صلاحيات المستخدمين
  viewUsers,
  manageUsers,
  deleteUsers,

  // صلاحيات الإعدادات
  viewSettings,
  manageSettings,

  // صلاحيات خاصة
  accessDashboard,
  accessAnalytics,
  systemAdmin,
}

/// مدير الصلاحيات
class PermissionManager {
  /// صلاحيات المالك (كاملة)
  static const Set<Permission> ownerPermissions = {...Permission.values};

  /// صلاحيات المدير
  static const Set<Permission> adminPermissions = {
    // الأجهزة
    Permission.viewDevices,
    Permission.manageDevices,
    Permission.blockDevices,

    // السياسات
    Permission.viewPolicies,
    Permission.createPolicies,
    Permission.editPolicies,
    Permission.deletePolicies,

    // التنبيهات
    Permission.viewAlerts,
    Permission.manageAlerts,
    Permission.deleteAlerts,

    // السجلات
    Permission.viewLogs,
    Permission.exportLogs,

    // التقارير
    Permission.viewReports,
    Permission.createReports,
    Permission.exportReports,

    // الخوادم
    Permission.viewServers,
    Permission.manageServers,

    // المستخدمين
    Permission.viewUsers,

    // الإعدادات
    Permission.viewSettings,

    // خاصة
    Permission.accessDashboard,
    Permission.accessAnalytics,
  };

  /// صلاحيات المستخدم العادي (قراءة فقط)
  static const Set<Permission> userPermissions = {
    // الأجهزة - قراءة فقط
    Permission.viewDevices,

    // السياسات - قراءة فقط
    Permission.viewPolicies,

    // التنبيهات - قراءة فقط
    Permission.viewAlerts,

    // السجلات - قراءة فقط
    Permission.viewLogs,

    // التقارير - قراءة فقط
    Permission.viewReports,

    // الخوادم - قراءة فقط
    Permission.viewServers,

    // خاصة
    Permission.accessDashboard,
  };

  /// الحصول على صلاحيات الدور
  static Set<Permission> getPermissionsForRole(UserRole role) {
    switch (role) {
      case UserRole.owner:
        return Set.from(Permission.values);
      case UserRole.admin:
        return adminPermissions;
      case UserRole.user:
        return userPermissions;
    }
  }

  /// التحقق من وجود صلاحية
  static bool hasPermission(UserRole role, Permission permission) {
    final permissions = getPermissionsForRole(role);
    return permissions.contains(permission);
  }

  /// التحقق من وجود أي صلاحية من مجموعة
  static bool hasAnyPermission(UserRole role, List<Permission> permissions) {
    final userPermissions = getPermissionsForRole(role);
    return permissions.any((p) => userPermissions.contains(p));
  }

  /// التحقق من وجود جميع الصلاحيات
  static bool hasAllPermissions(UserRole role, List<Permission> permissions) {
    final userPermissions = getPermissionsForRole(role);
    return permissions.every((p) => userPermissions.contains(p));
  }

  /// هل يمكنه التعديل (admin أو owner)
  static bool canEdit(UserRole role) {
    return role == UserRole.owner || role == UserRole.admin;
  }

  /// هل هو مالك
  static bool isOwner(UserRole role) {
    return role == UserRole.owner;
  }

  /// هل هو مدير أو أعلى
  static bool isAdminOrHigher(UserRole role) {
    return role == UserRole.owner || role == UserRole.admin;
  }
}

/// نموذج المستخدم مع الصلاحيات
class UserWithPermissions {
  final String id;
  final String username;
  final String name;
  final String email;
  final UserRole role;
  final String? avatar;
  final DateTime? lastLogin;
  final bool isActive;

  UserWithPermissions({
    required this.id,
    required this.username,
    required this.name,
    required this.email,
    required this.role,
    this.avatar,
    this.lastLogin,
    this.isActive = true,
  });

  /// التحقق من صلاحية
  bool hasPermission(Permission permission) {
    return PermissionManager.hasPermission(role, permission);
  }

  /// هل يمكنه التعديل
  bool get canEdit => PermissionManager.canEdit(role);

  /// هل هو مالك
  bool get isOwner => PermissionManager.isOwner(role);

  /// هل هو مدير أو أعلى
  bool get isAdminOrHigher => PermissionManager.isAdminOrHigher(role);

  /// اسم الدور بالعربية
  String get roleDisplayName => getRoleDisplayName(role);

  /// إنشاء من JSON
  factory UserWithPermissions.fromJson(Map<String, dynamic> json) {
    return UserWithPermissions(
      id: json['id']?.toString() ?? '',
      username: json['username'] ?? '',
      name: json['name'] ?? json['full_name'] ?? '',
      email: json['email'] ?? '',
      role: roleFromString(json['role']),
      avatar: json['avatar'] ?? json['profile_image'],
      lastLogin: json['last_login'] != null
          ? DateTime.tryParse(json['last_login'])
          : null,
      isActive: json['is_active'] ?? true,
    );
  }

  /// تحويل إلى JSON
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'username': username,
      'name': name,
      'email': email,
      'role': roleToString(role),
      'avatar': avatar,
      'last_login': lastLogin?.toIso8601String(),
      'is_active': isActive,
    };
  }
}
