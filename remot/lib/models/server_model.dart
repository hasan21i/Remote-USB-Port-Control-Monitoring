/// نموذج السيرفر
class ServerModel {
  final String id; // تغيير من int إلى String
  final String name;
  final String address;
  final int? port; // منفذ واحد بدلاً من قائمة
  final String status; // online, offline, error
  final String? type; // web, database, api, file
  final DateTime? lastCheck;
  final DateTime createdAt;
  final bool isActive;
  final bool isOnline;
  final String? role; // primary, secondary
  final double? cpuUsage;
  final double? memoryUsage;
  final double? diskUsage;
  final int? uptime; // بالثواني
  final String? location;
  final int? createdBy;

  ServerModel({
    required this.id,
    required this.name,
    required this.address,
    this.port,
    required this.status,
    this.type,
    this.lastCheck,
    required this.createdAt,
    required this.isActive,
    required this.isOnline,
    this.role,
    this.cpuUsage,
    this.memoryUsage,
    this.diskUsage,
    this.uptime,
    this.location,
    this.createdBy,
  });

  factory ServerModel.fromJson(Map<String, dynamic> json) {
    return ServerModel(
      id: json['id']?.toString() ?? '',
      name: json['name'] ?? '',
      address: json['address'] ?? json['ip_address'] ?? '',
      port: json['port'] != null ? int.tryParse(json['port'].toString()) : null,
      status:
          json['status'] ?? (json['is_online'] == true ? 'online' : 'offline'),
      type: json['type'],
      lastCheck: json['last_check'] != null
          ? DateTime.tryParse(json['last_check'])
          : json['last_heartbeat'] != null
          ? DateTime.tryParse(json['last_heartbeat'])
          : null,
      createdAt: json['created_at'] != null
          ? DateTime.parse(json['created_at'])
          : DateTime.now(),
      isActive: json['is_active'] ?? false,
      isOnline: json['is_online'] ?? (json['status'] == 'online'),
      role: json['role'],
      cpuUsage: json['cpu_usage']?.toDouble(),
      memoryUsage: json['memory_usage']?.toDouble(),
      diskUsage: json['disk_usage']?.toDouble(),
      uptime: json['uptime'],
      location: json['location'],
      createdBy: json['created_by'],
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'address': address,
    'port': port,
    'status': status,
    'type': type,
    'last_check': lastCheck?.toIso8601String(),
    'created_at': createdAt.toIso8601String(),
    'is_active': isActive,
    'is_online': isOnline,
    'role': role,
    'cpu_usage': cpuUsage,
    'memory_usage': memoryUsage,
    'disk_usage': diskUsage,
    'uptime': uptime,
    'location': location,
    'created_by': createdBy,
  };

  /// حالة السيرفر
  String get statusLabel {
    switch (status) {
      case 'online':
        return 'متصل';
      case 'offline':
        return 'غير متصل';
      case 'error':
        return 'خطأ';
      default:
        return 'غير معروف';
    }
  }

  /// لون حالة السيرفر
  String get statusColor {
    switch (status) {
      case 'online':
        return 'green';
      case 'offline':
        return 'red';
      case 'error':
        return 'orange';
      default:
        return 'grey';
    }
  }

  /// وقت التشغيل بصيغة مقروءة
  String get uptimeFormatted {
    if (uptime == null) return 'غير معروف';
    final duration = Duration(seconds: uptime!);
    final days = duration.inDays;
    final hours = duration.inHours % 24;
    final minutes = duration.inMinutes % 60;

    if (days > 0) {
      return '$days يوم $hours ساعة';
    } else if (hours > 0) {
      return '$hours ساعة $minutes دقيقة';
    } else {
      return '$minutes دقيقة';
    }
  }

  /// آخر فحص بصيغة مقروءة
  String get lastCheckFormatted {
    if (lastCheck == null) return 'لم يتم الفحص';
    final now = DateTime.now();
    final diff = now.difference(lastCheck!);

    if (diff.inSeconds < 60) {
      return 'منذ ${diff.inSeconds} ثانية';
    } else if (diff.inMinutes < 60) {
      return 'منذ ${diff.inMinutes} دقيقة';
    } else if (diff.inHours < 24) {
      return 'منذ ${diff.inHours} ساعة';
    } else {
      return 'منذ ${diff.inDays} يوم';
    }
  }

  /// هل الفحص متأخر (أكثر من 30 ثانية)
  bool get isCheckLate {
    if (lastCheck == null) return true;
    final diff = DateTime.now().difference(lastCheck!);
    return diff.inSeconds > 30;
  }

  /// الدور بالعربية
  String get roleArabic {
    switch (role) {
      case 'primary':
        return 'رئيسي';
      case 'secondary':
        return 'احتياطي';
      default:
        return 'عادي';
    }
  }
}
