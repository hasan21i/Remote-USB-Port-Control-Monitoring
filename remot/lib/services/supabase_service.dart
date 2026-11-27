import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';
import 'dart:async';
import 'dart:io';
import 'package:flutter/services.dart' show rootBundle;
import 'package:path_provider/path_provider.dart';
import '../config/supabase_config.dart';

/// خدمة الاتصال المباشر بـ Supabase
/// تعمل حتى بدون Backend
class SupabaseService {
  static SupabaseClient? _client;
  static SharedPreferences? _prefs;

  // مراقب الآي بي للخادم
  static Timer? _ipWatcherTimer;
  static String? _lastKnownServerIp;

  /// تهيئة الخدمة
  static Future<void> initialize() async {
    await Supabase.initialize(
      url: SupabaseConfig.supabaseUrl,
      anonKey: SupabaseConfig.supabaseAnonKey,
    );
    _client = Supabase.instance.client;
    _prefs = await SharedPreferences.getInstance();
  }

  /// بدء مراقبة عنوان الـ IP للخادم وتحديث `SupabaseConfig.apiBaseUrl` تلقائياً
  static void startBackendIpWatcher({int intervalSeconds = 60}) {
    // إذا كانت المراقبة تعمل، لا نكررها
    if (_ipWatcherTimer != null) return;

    _ipWatcherTimer = Timer.periodic(Duration(seconds: intervalSeconds), (
      _,
    ) async {
      try {
        final activeIp = await getActiveServerIp();
        if (activeIp != null &&
            activeIp.isNotEmpty &&
            activeIp != _lastKnownServerIp) {
          _lastKnownServerIp = activeIp;
          SupabaseConfig.updateApiUrl(activeIp);
          print(
            '🔁 Backend API host updated dynamically: ${SupabaseConfig.apiBaseUrl}',
          );
        }
      } catch (e) {
        // لا نفشل التطبيق إذا تعثر البحث
        print('⚠️ Backend IP watcher error: $e');
      }
    });
  }

  /// إيقاف مراقبة الـ IP
  static void stopBackendIpWatcher() {
    _ipWatcherTimer?.cancel();
    _ipWatcherTimer = null;
  }

  /// تحميل إعدادات `backend_config.json` المحلية (من مجلد الوثائق أو الأصول المعبأة)
  static Future<void> loadLocalBackendConfig() async {
    try {
      // 1) تحقق من مجلد الوثائق أولاً لتسهيل التعديل بعد البناء
      final dir = await getApplicationDocumentsDirectory();
      final file = File('${dir.path}/backend_config.json');

      String? content;

      if (await file.exists()) {
        content = await file.readAsString();
        print('🔧 Loaded backend config from documents dir: ${file.path}');
      } else {
        // 2) فشل، حاول من الأصول المعبأة
        try {
          content = await rootBundle.loadString('assets/backend_config.json');
          print('🔧 Loaded backend config from packaged assets');
        } catch (e) {
          // لا مشكلة إذا لم توجد
        }
      }

      if (content != null && content.isNotEmpty) {
        final data = jsonDecode(content);
        final ip = data['BACKEND_IP'] ?? data['backend_ip'] ?? data['ip'];
        final port = data['BACKEND_PORT'] ?? data['backend_port'] ?? 5000;
        if (ip != null && ip.toString().trim().isNotEmpty) {
          final p = int.tryParse(port.toString()) ?? 5000;
          SupabaseConfig.updateApiHost(ip.toString(), p);
          print(
            '🔧 Backend API host set from config: ${SupabaseConfig.apiBaseUrl}',
          );
        }
      }
    } catch (e) {
      print('⚠️ loadLocalBackendConfig failed: $e');
    }
  }

  /// جلب عنوان الـ IP النشط للخادم الرئيسي
  static Future<String?> getActiveServerIp() async {
    try {
      final response = await client
          .from('servers')
          .select('ip_address')
          .eq('id', 1)
          .maybeSingle();

      if (response != null && response['ip_address'] != null) {
        return response['ip_address'] as String;
      }
    } catch (e) {
      print('Error fetching active server IP: $e');
    }
    return null;
  }

  /// الحصول على الـ Client
  static SupabaseClient get client {
    if (_client == null) {
      throw Exception(
        'SupabaseService not initialized. Call initialize() first.',
      );
    }
    return _client!;
  }

  // =============== التخزين المحلي ===============

  /// حفظ البيانات محلياً
  static Future<void> _cacheData(String key, dynamic data) async {
    _prefs ??= await SharedPreferences.getInstance();
    await _prefs!.setString(key, jsonEncode(data));
    await _prefs!.setString(
      '${key}_timestamp',
      DateTime.now().toIso8601String(),
    );
  }

  /// جلب البيانات المحفوظة محلياً
  static Future<dynamic> _getCachedData(String key) async {
    _prefs ??= await SharedPreferences.getInstance();
    final cached = _prefs!.getString(key);
    if (cached != null) {
      return jsonDecode(cached);
    }
    return null;
  }

  /// التحقق من صلاحية البيانات المحفوظة (أقل من ساعة)
  static Future<bool> _isCacheValid(String key, {int maxMinutes = 60}) async {
    _prefs ??= await SharedPreferences.getInstance();
    final timestamp = _prefs!.getString('${key}_timestamp');
    if (timestamp == null) return false;

    final cachedTime = DateTime.parse(timestamp);
    final diff = DateTime.now().difference(cachedTime);
    return diff.inMinutes < maxMinutes;
  }

  // =============== الأجهزة ===============

  /// جلب جميع الأجهزة
  static Future<List<Map<String, dynamic>>> getDevices({
    bool forceRefresh = false,
  }) async {
    const cacheKey = 'devices_cache';

    // محاولة جلب من Supabase - الجدول الصحيح هو 'devices'
    try {
      final response = await client
          .from('devices')
          .select('*, servers!devices_server_id_fkey(*)')
          .order('created_at', ascending: false);

      // حفظ محلياً
      await _cacheData(cacheKey, response);
      return List<Map<String, dynamic>>.from(response);
    } catch (e) {
      print('❌ Error fetching devices: $e');
      // إذا فشل الاتصال، جلب من التخزين المحلي
      final cached = await _getCachedData(cacheKey);
      if (cached != null) {
        return List<Map<String, dynamic>>.from(cached);
      }
      return [];
    }
  }

  /// جلب إحصائيات الأجهزة
  static Future<Map<String, dynamic>> getDeviceStats() async {
    const cacheKey = 'device_stats_cache';

    try {
      final devices = await getDevices();

      int total = devices.length;
      int connected = devices.where((d) => d['status'] == 'connected').length;
      int pending = devices.where((d) => d['status'] == 'pending').length;
      int blocked = devices
          .where((d) => d['blacklisted'] == true || d['status'] == 'blocked')
          .length;
      int allowed = devices
          .where((d) => d['whitelisted'] == true || d['status'] == 'allowed')
          .length;
      int disconnected = devices
          .where((d) => d['status'] == 'disconnected')
          .length;

      final stats = {
        'total': total,
        'connected': connected,
        'pending': pending,
        'blocked': blocked,
        'allowed': allowed,
        'disconnected': disconnected,
      };

      await _cacheData(cacheKey, stats);
      return stats;
    } catch (e) {
      final cached = await _getCachedData(cacheKey);
      if (cached != null) {
        return Map<String, dynamic>.from(cached);
      }
      return {
        'total': 0,
        'connected': 0,
        'pending': 0,
        'blocked': 0,
        'allowed': 0,
        'disconnected': 0,
      };
    }
  }

  /// تحديث حالة الجهاز
  static Future<bool> updateDeviceStatus(
    String deviceId,
    String status, {
    bool? whitelisted,
    bool? blacklisted,
  }) async {
    try {
      final updateData = <String, dynamic>{
        'status': status,
        'updated_at': DateTime.now().toIso8601String(),
      };

      if (whitelisted != null) {
        updateData['whitelisted'] = whitelisted;
        if (whitelisted) updateData['blacklisted'] = false;
      }

      if (blacklisted != null) {
        updateData['blacklisted'] = blacklisted;
        if (blacklisted) updateData['whitelisted'] = false;
      }

      await client.from('devices').update(updateData).eq('id', deviceId);

      print('✅ Device $deviceId status updated to $status');
      return true;
    } catch (e) {
      print('❌ Error updating device status: $e');
      return false;
    }
  }

  /// إضافة جهاز للقائمة السوداء
  static Future<bool> blacklistDevice(String deviceId) async {
    return await updateDeviceStatus(deviceId, 'blocked', blacklisted: true);
  }

  /// إضافة جهاز للقائمة البيضاء
  static Future<bool> whitelistDevice(String deviceId) async {
    return await updateDeviceStatus(deviceId, 'allowed', whitelisted: true);
  }

  /// إزالة جهاز من القوائم
  static Future<bool> removeDeviceFromLists(String deviceId) async {
    try {
      await client
          .from('devices')
          .update({
            'whitelisted': false,
            'blacklisted': false,
            'status': 'pending',
            'updated_at': DateTime.now().toIso8601String(),
          })
          .eq('id', deviceId);
      return true;
    } catch (e) {
      print('❌ Error removing device from lists: $e');
      return false;
    }
  }

  /// إضافة جهاز جديد
  static Future<bool> addDevice(Map<String, dynamic> deviceData) async {
    try {
      await client.from('devices').insert(deviceData);
      print('✅ Device added successfully');
      return true;
    } catch (e) {
      print('❌ Error adding device: $e');
      rethrow;
    }
  }

  /// حذف جهاز
  static Future<bool> deleteDevice(String deviceId) async {
    try {
      await client.from('devices').delete().eq('id', deviceId);
      print('✅ Device $deviceId deleted');
      return true;
    } catch (e) {
      print('❌ Error deleting device: $e');
      return false;
    }
  }

  // =============== التنبيهات ===============

  /// جلب التنبيهات
  static Future<List<Map<String, dynamic>>> getAlerts({int limit = 50}) async {
    const cacheKey = 'alerts_cache';

    try {
      final response = await client
          .from('alerts')
          .select('*')
          .order('created_at', ascending: false)
          .limit(limit);

      await _cacheData(cacheKey, response);
      return List<Map<String, dynamic>>.from(response);
    } catch (e) {
      final cached = await _getCachedData(cacheKey);
      if (cached != null) {
        return List<Map<String, dynamic>>.from(cached);
      }
      return [];
    }
  }

  /// جلب عدد التنبيهات غير المقروءة
  static Future<int> getUnreadAlertsCount() async {
    try {
      final response = await client
          .from('alerts')
          .select('id')
          .eq('is_read', false);

      return response.length;
    } catch (e) {
      return 0;
    }
  }

  // =============== السجلات ===============

  /// جلب السجلات
  static Future<List<Map<String, dynamic>>> getLogs({int limit = 100}) async {
    const cacheKey = 'logs_cache';

    try {
      final response = await client
          .from('usb_logs')
          .select('*')
          .order('timestamp', ascending: false)
          .limit(limit);

      await _cacheData(cacheKey, response);
      return List<Map<String, dynamic>>.from(response);
    } catch (e) {
      final cached = await _getCachedData(cacheKey);
      if (cached != null) {
        return List<Map<String, dynamic>>.from(cached);
      }
      return [];
    }
  }

  // =============== المستخدمين ===============

  /// جلب المستخدمين
  static Future<List<Map<String, dynamic>>> getUsers() async {
    const cacheKey = 'users_cache';

    try {
      final response = await client
          .from('users')
          .select(
            'id, username, email, full_name, role, is_active, created_at, last_login, profile_image',
          )
          .order('created_at', ascending: false);

      await _cacheData(cacheKey, response);
      return List<Map<String, dynamic>>.from(response);
    } catch (e) {
      final cached = await _getCachedData(cacheKey);
      if (cached != null) {
        return List<Map<String, dynamic>>.from(cached);
      }
      return [];
    }
  }

  // =============== لوحة التحكم ===============

  /// جلب إحصائيات لوحة التحكم
  static Future<Map<String, dynamic>> getDashboardStats() async {
    const cacheKey = 'dashboard_stats_cache';

    try {
      // جلب البيانات بالتوازي
      final results = await Future.wait([
        getDevices(),
        getAlerts(limit: 100),
        getLogs(limit: 100),
      ]);

      final devices = results[0];
      final alerts = results[1];
      final logs = results[2];

      final stats = {
        'total_devices': devices.length,
        'connected_devices': devices
            .where(
              (d) => d['status'] == 'connected' || d['is_connected'] == true,
            )
            .length,
        'blocked_devices': devices
            .where((d) => d['status'] == 'blocked' || d['is_blocked'] == true)
            .length,
        'total_alerts': alerts.length,
        'unread_alerts': alerts.where((a) => a['is_read'] == false).length,
        'critical_alerts': alerts
            .where(
              (a) => a['severity'] == 'critical' || a['level'] == 'critical',
            )
            .length,
        'total_logs': logs.length,
        'last_updated': DateTime.now().toIso8601String(),
      };

      await _cacheData(cacheKey, stats);
      return stats;
    } catch (e) {
      final cached = await _getCachedData(cacheKey);
      if (cached != null) {
        return Map<String, dynamic>.from(cached);
      }
      return {
        'total_devices': 0,
        'connected_devices': 0,
        'blocked_devices': 0,
        'total_alerts': 0,
        'unread_alerts': 0,
        'critical_alerts': 0,
        'total_logs': 0,
      };
    }
  }

  // =============== السياسات ===============

  /// جلب السياسات
  static Future<List<Map<String, dynamic>>> getPolicies() async {
    const cacheKey = 'policies_cache';

    try {
      final response = await client
          .from('policies')
          .select('*')
          .order('created_at', ascending: false);

      await _cacheData(cacheKey, response);
      return List<Map<String, dynamic>>.from(response);
    } catch (e) {
      final cached = await _getCachedData(cacheKey);
      if (cached != null) {
        return List<Map<String, dynamic>>.from(cached);
      }
      return [];
    }
  }

  // =============== الخوادم ===============

  /// جلب الخوادم
  static Future<List<Map<String, dynamic>>> getServers() async {
    const cacheKey = 'servers_cache';

    try {
      final response = await client
          .from('servers')
          .select('*')
          .order('last_heartbeat', ascending: false);

      await _cacheData(cacheKey, response);
      return List<Map<String, dynamic>>.from(response);
    } catch (e) {
      final cached = await _getCachedData(cacheKey);
      if (cached != null) {
        return List<Map<String, dynamic>>.from(cached);
      }
      return [];
    }
  }

  // =============== إدارة السيرفرات ===============

  /// إضافة سيرفر جديد
  static Future<Map<String, dynamic>> addServer(
    Map<String, dynamic> serverData,
  ) async {
    try {
      final response = await client
          .from('servers')
          .insert({
            ...serverData,
            'created_at': DateTime.now().toIso8601String(),
            'status': 'offline',
            'last_check': DateTime.now().toIso8601String(),
          })
          .select()
          .single();

      return response;
    } catch (e) {
      throw Exception('فشل في إضافة السيرفر: $e');
    }
  }

  /// تحديث بيانات سيرفر
  static Future<Map<String, dynamic>> updateServer(
    String serverId,
    Map<String, dynamic> serverData,
  ) async {
    try {
      final response = await client
          .from('servers')
          .update({
            ...serverData,
            'updated_at': DateTime.now().toIso8601String(),
          })
          .eq('id', serverId)
          .select()
          .single();

      return response;
    } catch (e) {
      throw Exception('فشل في تحديث السيرفر: $e');
    }
  }

  /// حذف سيرفر
  static Future<void> deleteServer(String serverId) async {
    try {
      await client.from('servers').delete().eq('id', serverId);
    } catch (e) {
      throw Exception('فشل في حذف السيرفر: $e');
    }
  }

  /// تحديث حالة السيرفر
  static Future<void> updateServerStatus(String serverId, String status) async {
    try {
      await client
          .from('servers')
          .update({
            'status': status,
            'last_check': DateTime.now().toIso8601String(),
          })
          .eq('id', serverId);
    } catch (e) {
      throw Exception('فشل في تحديث حالة السيرفر: $e');
    }
  }

  // =============== مسح التخزين المحلي ===============

  /// مسح جميع البيانات المحفوظة
  static Future<void> clearCache() async {
    _prefs ??= await SharedPreferences.getInstance();
    final keys = _prefs!.getKeys().where(
      (k) => k.endsWith('_cache') || k.endsWith('_timestamp'),
    );
    for (final key in keys) {
      await _prefs!.remove(key);
    }
  }

  // =============== التقارير ===============

  /// جلب قائمة التقارير المحفوظة
  static Future<List<Map<String, dynamic>>> getReports({int limit = 50}) async {
    try {
      final response = await client
          .from('reports')
          .select('*')
          .order('created_at', ascending: false)
          .limit(limit);

      return List<Map<String, dynamic>>.from(response);
    } catch (e) {
      print('⚠️ Error fetching reports: $e');
      return [];
    }
  }

  /// حذف تقرير
  static Future<void> deleteReport(int reportId) async {
    try {
      await client.from('reports').delete().eq('id', reportId);
    } catch (e) {
      throw Exception('فشل في حذف التقرير: $e');
    }
  }
}
