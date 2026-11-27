/// نموذج الجهاز
class DeviceModel {
  final int id;
  final String? serialNumber;
  final String? vendorId;
  final String? productId;
  final String? name;
  final String? manufacturer;
  final String type;
  final String status;
  final bool isWhitelisted;
  final bool isBlacklisted;
  final int? serverId;
  final int? registeredById;
  final DateTime? lastSeen;
  final DateTime createdAt;
  final String? riskLevel;
  final Map<String, dynamic>? metadata;

  DeviceModel({
    required this.id,
    this.serialNumber,
    this.vendorId,
    this.productId,
    this.name,
    this.manufacturer,
    this.type = 'unknown',
    this.status = 'pending',
    this.isWhitelisted = false,
    this.isBlacklisted = false,
    this.serverId,
    this.registeredById,
    this.lastSeen,
    required this.createdAt,
    this.riskLevel,
    this.metadata,
  });

  factory DeviceModel.fromJson(Map<String, dynamic> json) {
    return DeviceModel(
      id: json['id'] ?? 0,
      serialNumber: json['serial_number'],
      vendorId: json['vendor_id'],
      productId: json['product_id'],
      name: json['name'] ?? json['product'],
      manufacturer: json['manufacturer'],
      type: json['type'] ?? 'unknown',
      status: json['status'] ?? 'pending',
      isWhitelisted: json['is_whitelisted'] ?? false,
      isBlacklisted: json['is_blacklisted'] ?? false,
      serverId: json['server_id'],
      registeredById: json['registered_by_id'],
      lastSeen: json['last_seen'] != null
          ? DateTime.tryParse(json['last_seen'])
          : null,
      createdAt: json['created_at'] != null
          ? DateTime.parse(json['created_at'])
          : DateTime.now(),
      riskLevel: json['risk_level'],
      metadata: json['metadata'] is Map ? json['metadata'] : null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'serial_number': serialNumber,
      'vendor_id': vendorId,
      'product_id': productId,
      'name': name,
      'manufacturer': manufacturer,
      'type': type,
      'status': status,
      'is_whitelisted': isWhitelisted,
      'is_blacklisted': isBlacklisted,
      'server_id': serverId,
      'registered_by_id': registeredById,
      'last_seen': lastSeen?.toIso8601String(),
      'created_at': createdAt.toIso8601String(),
      'risk_level': riskLevel,
      'metadata': metadata,
    };
  }

  String get displayName => name ?? serialNumber ?? 'جهاز غير معروف';

  bool get isPending => status == 'pending';
  bool get isConnected => status == 'connected';
  bool get isDenied => status == 'denied';
  bool get isDisconnected => status == 'disconnected';
}
