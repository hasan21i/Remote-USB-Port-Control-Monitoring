/// نموذج التنبيه
class AlertModel {
  final int id;
  final String message;
  final String priority;
  final bool resolved;
  final int? resolvedBy;
  final DateTime? resolvedAt;
  final String? targetDevice;
  final DateTime createdAt;
  final Map<String, dynamic>? metadata;

  AlertModel({
    required this.id,
    required this.message,
    this.priority = 'normal',
    this.resolved = false,
    this.resolvedBy,
    this.resolvedAt,
    this.targetDevice,
    required this.createdAt,
    this.metadata,
  });

  factory AlertModel.fromJson(Map<String, dynamic> json) {
    return AlertModel(
      id: json['id'] ?? 0,
      message: json['message'] ?? '',
      priority: json['priority'] ?? 'normal',
      resolved: json['resolved'] ?? false,
      resolvedBy: json['resolved_by'],
      resolvedAt: json['resolved_at'] != null
          ? DateTime.tryParse(json['resolved_at'])
          : null,
      targetDevice: json['target_device'],
      createdAt: json['created_at'] != null
          ? DateTime.parse(json['created_at'])
          : DateTime.now(),
      metadata: json['metadata'] is Map ? json['metadata'] : null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'message': message,
      'priority': priority,
      'resolved': resolved,
      'resolved_by': resolvedBy,
      'resolved_at': resolvedAt?.toIso8601String(),
      'target_device': targetDevice,
      'created_at': createdAt.toIso8601String(),
      'metadata': metadata,
    };
  }

  bool get isHigh => priority == 'high';
  bool get isNormal => priority == 'normal';
  bool get isLow => priority == 'low';

  // إضافة getters للتوافق مع UI
  String get title => message;
  String get description => message;
  String? get deviceName => targetDevice;
  bool get isResolved => resolved;
}
