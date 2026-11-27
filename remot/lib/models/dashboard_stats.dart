/// نموذج إحصائيات لوحة التحكم
class DashboardStats {
  final int totalDevices;
  final int connectedDevices;
  final int pendingDevices;
  final int disconnectedDevices;
  final int deniedDevices;
  final int totalServers;
  final int totalAlerts;
  final int totalLogs;

  DashboardStats({
    this.totalDevices = 0,
    this.connectedDevices = 0,
    this.pendingDevices = 0,
    this.disconnectedDevices = 0,
    this.deniedDevices = 0,
    this.totalServers = 0,
    this.totalAlerts = 0,
    this.totalLogs = 0,
  });

  factory DashboardStats.fromJson(Map<String, dynamic> json) {
    return DashboardStats(
      totalDevices: json['total_devices'] ?? 0,
      connectedDevices: json['connected_devices'] ?? 0,
      pendingDevices: json['pending_devices'] ?? 0,
      disconnectedDevices: json['disconnected_devices'] ?? 0,
      deniedDevices: json['denied_devices'] ?? 0,
      totalServers: json['total_servers'] ?? 0,
      totalAlerts: json['total_alerts'] ?? 0,
      totalLogs: json['total_logs'] ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'total_devices': totalDevices,
      'connected_devices': connectedDevices,
      'pending_devices': pendingDevices,
      'disconnected_devices': disconnectedDevices,
      'denied_devices': deniedDevices,
      'total_servers': totalServers,
      'total_alerts': totalAlerts,
      'total_logs': totalLogs,
    };
  }
}
