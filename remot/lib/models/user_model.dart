/// نموذج المستخدم
class UserModel {
  final int id;
  final String username;
  final String email;
  final String role;
  final String status;
  final bool mfaEnabled;
  final DateTime? lastLogin;
  final DateTime createdAt;
  final String? phone;
  final String? avatar;
  final String? department;
  final String? position;

  UserModel({
    required this.id,
    required this.username,
    required this.email,
    this.role = 'user',
    this.status = 'active',
    this.mfaEnabled = false,
    this.lastLogin,
    required this.createdAt,
    this.phone,
    this.avatar,
    this.department,
    this.position,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: json['id'] ?? 0,
      username: json['username'] ?? '',
      email: json['email'] ?? '',
      role: json['role'] ?? 'user',
      status: json['status'] ?? 'active',
      mfaEnabled: json['mfa_enabled'] ?? false,
      lastLogin: json['last_login'] != null
          ? DateTime.tryParse(json['last_login'])
          : null,
      createdAt: json['created_at'] != null
          ? DateTime.parse(json['created_at'])
          : DateTime.now(),
      phone: json['phone'],
      avatar: json['avatar'],
      department: json['department'],
      position: json['position'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'username': username,
      'email': email,
      'role': role,
      'status': status,
      'mfa_enabled': mfaEnabled,
      'last_login': lastLogin?.toIso8601String(),
      'created_at': createdAt.toIso8601String(),
      'phone': phone,
      'avatar': avatar,
      'department': department,
      'position': position,
    };
  }

  bool get isAdmin => role == 'admin';
  bool get isManager => role == 'manager' || role == 'admin';
}
