import 'dart:convert';
import 'dart:async';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../config/supabase_config.dart';
import '../models/user_model.dart';
import '../models/device_model.dart';
import '../models/alert_model.dart';
import '../models/dashboard_stats.dart';
import '../models/server_model.dart';
import 'supabase_service.dart';

/// خدمة الـ API للاتصال بالباك إند
/// تستخدم Supabase مباشرة كـ fallback عند فشل الاتصال بالـ Backend
class ApiService {
  static const FlutterSecureStorage _storage = FlutterSecureStorage();
  static String? _accessToken;

  // الحصول على التوكن
  static Future<String?> get accessToken async {
    _accessToken ??= await _storage.read(key: 'access_token');
    return _accessToken;
  }

  // تعيين التوكن
  static Future<void> setTokens(String access, String refresh) async {
    _accessToken = access;
    await _storage.write(key: 'access_token', value: access);
    await _storage.write(key: 'refresh_token', value: refresh);
  }

  // مسح التوكنات
  static Future<void> clearTokens() async {
    _accessToken = null;
    await _storage.delete(key: 'access_token');
    await _storage.delete(key: 'refresh_token');
  }

  // التحقق من تسجيل الدخول
  static Future<bool> isLoggedIn() async {
    final token = await accessToken;
    return token != null && token.isNotEmpty;
  }

  // الهيدرز الأساسية
  static Future<Map<String, String>> _getHeaders() async {
    final token = await accessToken;
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Server-Id': '1', // مثل الموقع
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  // =============== التسجيل والدخول ===============

  /// تسجيل الدخول (يدعم الإيميل أو اليوزرنيم)
  static Future<Map<String, dynamic>> login(
    String emailOrUsername,
    String password,
  ) async {
    try {
      final url = '${SupabaseConfig.apiBaseUrl}/auth/login';
      print('🚀 Attempting login to: $url');

      // الباك إند يتوقع مفتاح 'identifier' و 'password'
      final loginData = {'identifier': emailOrUsername, 'password': password};

      final response = await http.post(
        Uri.parse(url),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(loginData),
      );

      print('📥 Response Status: ${response.statusCode}');
      print('📥 Response Body: ${response.body}');

      final data = jsonDecode(response.body);

      if (response.statusCode == 200) {
        await setTokens(data['access_token'], data['refresh_token']);
        return {'success': true, 'user': UserModel.fromJson(data['user'])};
      }

      return {
        'success': false,
        'error':
            data['message'] ??
            data['error'] ??
            'فشل تسجيل الدخول - تحقق من البيانات',
      };
    } catch (e) {
      print('❌ Login Error: $e');
      return {
        'success': false,
        'error':
            'فشل الاتصال بالخادم. تأكد من أن السجل يشير إلى الآي بي الصحيح (${SupabaseConfig.apiBaseUrl})',
      };
    }
  }

  /// جلب بيانات المستخدم الحالي
  static Future<UserModel?> getCurrentUser() async {
    try {
      final headers = await _getHeaders();
      final response = await http.get(
        Uri.parse('${SupabaseConfig.apiBaseUrl}/auth/me'),
        headers: headers,
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return UserModel.fromJson(data['user']);
      }

      return null;
    } catch (e) {
      // Return null if authentication check fails
      return null;
    }
  }

  /// تسجيل مستخدم جديد
  static Future<Map<String, dynamic>> register({
    required String name,
    required String email,
    required String password,
    required String username,
  }) async {
    try {
      final response = await http.post(
        Uri.parse('${SupabaseConfig.apiBaseUrl}/auth/register'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'name': name,
          'email': email,
          'password': password,
          'username': username,
        }),
      );

      if (response.statusCode == 201 || response.statusCode == 200) {
        final data = jsonDecode(response.body);
        await setTokens(data['access_token'], data['refresh_token']);
        return {'success': true, 'user': UserModel.fromJson(data['user'])};
      }

      return {'success': false, 'error': 'فشل إنشاء الحساب'};
    } catch (e) {
      // Return error if registration fails
      return {'success': false, 'error': 'فشل إنشاء الحساب'};
    }
  }

  /// تغيير كلمة المرور
  static Future<Map<String, dynamic>> changePassword(
    String oldPassword,
    String newPassword,
  ) async {
    try {
      final headers = await _getHeaders();
      final response = await http.post(
        Uri.parse('${SupabaseConfig.apiBaseUrl}/auth/change-password'),
        headers: headers,
        body: jsonEncode({
          'old_password': oldPassword,
          'new_password': newPassword,
        }),
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return {
          'success': true,
          'message': data['message'] ?? 'تم تغيير كلمة المرور بنجاح',
        };
      }

      return {'success': false, 'error': 'فشل في تغيير كلمة المرور'};
    } catch (e) {
      return {'success': false, 'error': 'فشل في الاتصال بالخادم'};
    }
  }

  /// تسجيل الخروج
  static Future<Map<String, dynamic>> logout() async {
    try {
      final headers = await _getHeaders();
      await http.post(
        Uri.parse('${SupabaseConfig.apiBaseUrl}/auth/logout'),
        headers: headers,
      );
    } catch (e) {
      // تجاهل أخطاء تسجيل الخروج
    }

    await clearTokens();
    return {'success': true};
  }

  // =============== الأجهزة ===============

  /// الحصول على الأجهزة من Backend API (مثل الموقع تماماً)
  static Future<List<DeviceModel>> getDevices({
    String? status,
    bool realOnly = true,
  }) async {
    try {
      final headers = await _getHeaders();

      // بناء URL مثل الموقع: /devices/list?real_only=true
      final queryParams = <String, String>{'real_only': realOnly.toString()};
      if (status != null && status != 'all') {
        queryParams['status'] = status;
      }

      final uri = Uri.parse(
        '${SupabaseConfig.apiBaseUrl}/devices/list',
      ).replace(queryParameters: queryParams);

      print('🌐 Fetching devices from API: $uri');

      final response = await http
          .get(uri, headers: headers)
          .timeout(const Duration(seconds: 15));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);

        // معالجة البنية الجديدة (مثل الموقع)
        List<dynamic> devices = [];
        if (data is Map && data['devices'] != null) {
          devices = data['devices'] as List;
          print('📱 API returned ${devices.length} devices');
        } else if (data is List) {
          devices = data;
          print('📱 API returned ${devices.length} devices (legacy format)');
        }

        return devices.map((d) => DeviceModel.fromJson(d)).toList();
      }

      print('❌ API Error: ${response.statusCode}');
      return [];
    } catch (e) {
      print('❌ API Connection Error: $e');
      return [];
    }
  }

  /// الحصول على الأجهزة كـ Map (للتوافق مع DevicesScreen)
  static Future<List<Map<String, dynamic>>> getDevicesAsMap({
    String? status,
    bool realOnly = true,
  }) async {
    try {
      final token = await accessToken;

      // استخدام نفس أسلوب login الذي يعمل
      final url =
          '${SupabaseConfig.apiBaseUrl}/devices/list?real_only=$realOnly${status != null && status != 'all' ? '&status=$status' : ''}';

      print('🌐 Fetching devices (Map) from API: $url');

      final response = await http.get(
        Uri.parse(url),
        headers: {
          'Content-Type': 'application/json',
          'X-Server-Id': '1',
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );

      print('📥 Response Status: ${response.statusCode}');

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);

        List<dynamic> devices = [];
        if (data is Map && data['devices'] != null) {
          devices = data['devices'] as List;
        } else if (data is List) {
          devices = data;
        }

        print('📱 API returned ${devices.length} devices as Map');
        return devices.cast<Map<String, dynamic>>();
      }

      print('❌ API Error: ${response.statusCode}');
      return [];
    } catch (e) {
      print('❌ API Connection Error: $e');
      return [];
    }
  }

  /// جلب ملخص الاكتشاف - الأجهزة المكتشفة غير المسجلة (نفس الموقع)
  static Future<Map<String, dynamic>> getDiscoverySummary() async {
    try {
      final headers = await _getHeaders();
      final response = await http
          .get(
            Uri.parse('${SupabaseConfig.apiBaseUrl}/devices/discovery-summary'),
            headers: headers,
          )
          .timeout(const Duration(seconds: 15));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        print(
          '📡 Discovery Summary: pending=${data['pendingCount']}, matched=${data['matchedCount']}',
        );
        return data;
      }
      return {'pendingCount': 0, 'sample_pending': []};
    } catch (e) {
      print('❌ Discovery Summary Error: $e');
      return {'pendingCount': 0, 'sample_pending': []};
    }
  }

  /// تسجيل جهاز مكتشف جديد في قاعدة البيانات (عند الموافقة)
  static Future<Map<String, dynamic>> registerDiscoveredDevice(
    Map<String, dynamic> deviceData,
  ) async {
    try {
      final headers = await _getHeaders();

      // استخراج البيانات مع قيم افتراضية
      final name =
          deviceData['name'] ?? deviceData['description'] ?? 'جهاز غير معروف';
      final serialNumber =
          deviceData['serial_number'] ??
          deviceData['serialNumber'] ??
          'SN-${DateTime.now().millisecondsSinceEpoch}';
      final vendorId =
          deviceData['vendor_id'] ??
          deviceData['vendorId'] ??
          deviceData['VID'] ??
          '0000';
      final productId =
          deviceData['product_id'] ??
          deviceData['productId'] ??
          deviceData['PID'] ??
          '0000';

      // تجهيز البيانات للإرسال
      final body = jsonEncode({
        'name': name,
        'serial_number': serialNumber,
        'vendor_id': vendorId.toString().isNotEmpty ? vendorId : '0000',
        'product_id': productId.toString().isNotEmpty ? productId : '0000',
        'device_class':
            deviceData['device_class'] ?? deviceData['deviceClass'] ?? 'USB',
        'usb_port':
            deviceData['usb_port'] ?? deviceData['location'] ?? 'غير معروف',
        'status': 'connected',
        'whitelisted': true,
        'blacklisted': false,
      });

      print('📝 Registering discovered device: $name');
      print(
        '📝 Device data: serial=$serialNumber, vid=$vendorId, pid=$productId',
      );

      final response = await http
          .post(
            Uri.parse('${SupabaseConfig.apiBaseUrl}/devices/add'),
            headers: headers,
            body: body,
          )
          .timeout(const Duration(seconds: 15));

      print('📥 Register Device Response: ${response.statusCode}');
      if (response.statusCode != 200 && response.statusCode != 201) {
        print('📥 Response body: ${response.body}');
      }

      if (response.statusCode == 200 || response.statusCode == 201) {
        final data = jsonDecode(response.body);
        return {
          'success': true,
          'device': data['device'],
          'message': 'تم تسجيل الجهاز بنجاح',
        };
      } else if (response.statusCode == 409) {
        return {'success': false, 'error': 'الجهاز مسجل مسبقاً'};
      }

      // محاولة قراءة رسالة الخطأ
      try {
        final errorData = jsonDecode(response.body);
        return {
          'success': false,
          'error':
              errorData['error'] ?? 'فشل تسجيل الجهاز: ${response.statusCode}',
        };
      } catch (_) {
        return {
          'success': false,
          'error': 'فشل تسجيل الجهاز: ${response.statusCode}',
        };
      }
    } catch (e) {
      print('❌ Register Device Error: $e');
      return {'success': false, 'error': 'خطأ في الاتصال: $e'};
    }
  }

  /// موافقة على جهاز
  static Future<Map<String, dynamic>> approveDevice(String deviceId) async {
    try {
      final headers = await _getHeaders();
      final response = await http.post(
        Uri.parse('${SupabaseConfig.apiBaseUrl}/devices/$deviceId/approve'),
        headers: headers,
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200) {
        return {'success': true, 'message': data['message'] ?? 'تمت الموافقة'};
      } else {
        return {'success': false, 'error': data['error'] ?? 'فشلت العملية'};
      }
    } catch (e) {
      return {'success': false, 'error': 'خطأ في الاتصال: $e'};
    }
  }

  /// رفض جهاز
  static Future<Map<String, dynamic>> denyDevice(String deviceId) async {
    try {
      final headers = await _getHeaders();
      final response = await http.post(
        Uri.parse('${SupabaseConfig.apiBaseUrl}/devices/$deviceId/deny'),
        headers: headers,
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200) {
        return {'success': true, 'message': data['message'] ?? 'تم الرفض'};
      } else {
        return {'success': false, 'error': data['error'] ?? 'فشلت العملية'};
      }
    } catch (e) {
      return {'success': false, 'error': 'خطأ في الاتصال: $e'};
    }
  }

  // =============== التنبيهات ===============

  /// الحصول على التنبيهات
  static Future<Map<String, dynamic>> getAlerts({
    String? priority,
    bool? resolved,
    int limit = 50,
    int offset = 0,
  }) async {
    try {
      final headers = await _getHeaders();
      final queryParams = <String, String>{
        'limit': limit.toString(),
        'offset': offset.toString(),
      };
      if (priority != null) queryParams['priority'] = priority;
      if (resolved != null) queryParams['resolved'] = resolved.toString();

      final uri = Uri.parse(
        '${SupabaseConfig.apiBaseUrl}/alerts',
      ).replace(queryParameters: queryParams);

      final response = await http.get(uri, headers: headers);

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        final alerts = data['alerts'] ?? [];
        return {
          'alerts': (alerts as List)
              .map((a) => AlertModel.fromJson(a))
              .toList(),
          'total': data['total'] ?? alerts.length,
        };
      }
      return {'alerts': <AlertModel>[], 'total': 0};
    } catch (e) {
      return {'alerts': <AlertModel>[], 'total': 0};
    }
  }

  /// الحصول على إحصائيات التنبيهات
  static Future<Map<String, dynamic>> getAlertStats() async {
    try {
      final headers = await _getHeaders();
      final response = await http.get(
        Uri.parse('${SupabaseConfig.apiBaseUrl}/alerts/stats'),
        headers: headers,
      );

      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
      return {
        'total': 0,
        'high': 0,
        'medium': 0,
        'low': 0,
        'resolved': 0,
        'logs': 0,
      };
    } catch (e) {
      return {
        'total': 0,
        'high': 0,
        'medium': 0,
        'low': 0,
        'resolved': 0,
        'logs': 0,
      };
    }
  }

  /// حل تنبيه
  static Future<Map<String, dynamic>> resolveAlert(int alertId) async {
    try {
      final headers = await _getHeaders();
      final response = await http.post(
        Uri.parse('${SupabaseConfig.apiBaseUrl}/alerts/$alertId/resolve'),
        headers: headers,
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200) {
        return {'success': true, 'message': data['message'] ?? 'تم الحل'};
      } else {
        return {'success': false, 'error': data['error'] ?? 'فشلت العملية'};
      }
    } catch (e) {
      return {'success': false, 'error': 'خطأ في الاتصال: $e'};
    }
  }

  // =============== السيرفرات ===============

  /// إرسال نبض للسيرفر
  static Future<Map<String, dynamic>> sendHeartbeat() async {
    try {
      final headers = await _getHeaders();
      final response = await http.post(
        Uri.parse('${SupabaseConfig.apiBaseUrl}/heartbeat'),
        headers: headers,
        body: jsonEncode({
          'timestamp': DateTime.now().toIso8601String(),
          'status': 'online',
        }),
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200) {
        return {
          'success': true,
          'message': data['message'] ?? 'تم إرسال النبض',
        };
      } else {
        return {'success': false, 'error': data['error'] ?? 'فشل إرسال النبض'};
      }
    } catch (e) {
      return {'success': false, 'error': 'خطأ في الاتصال: $e'};
    }
  }

  /// الحصول على قائمة السيرفرات
  static Future<List<ServerModel>> getServers() async {
    try {
      final headers = await _getHeaders();
      final response = await http.get(
        Uri.parse('${SupabaseConfig.apiBaseUrl}/servers'),
        headers: headers,
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['success'] == true) {
          return (data['data'] as List)
              .map((item) => ServerModel.fromJson(item))
              .toList();
        }
      }

      // Fallback to empty list
      return [];
    } catch (e) {
      // Return empty list on error
      return [];
    }
  }

  /// إضافة سيرفر جديد
  static Future<Map<String, dynamic>> addServer(
    Map<String, dynamic> serverData,
  ) async {
    try {
      final headers = await _getHeaders();
      final response = await http.post(
        Uri.parse('${SupabaseConfig.apiBaseUrl}/servers'),
        headers: headers,
        body: jsonEncode(serverData),
      );

      if (response.statusCode == 201 || response.statusCode == 200) {
        return jsonDecode(response.body);
      }

      return {'success': false, 'error': 'Failed to add server'};
    } catch (e) {
      // Fallback to Supabase
      try {
        final result = await SupabaseService.addServer(serverData);
        return {'success': true, 'data': result};
      } catch (supabaseError) {
        return {'success': false, 'error': supabaseError.toString()};
      }
    }
  }

  /// تحديث سيرفر
  static Future<Map<String, dynamic>> updateServer(
    String serverId,
    Map<String, dynamic> serverData,
  ) async {
    try {
      final headers = await _getHeaders();
      final response = await http.put(
        Uri.parse('${SupabaseConfig.apiBaseUrl}/servers/$serverId'),
        headers: headers,
        body: jsonEncode(serverData),
      );

      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }

      return {'success': false, 'error': 'Failed to update server'};
    } catch (e) {
      // Fallback to Supabase
      try {
        final result = await SupabaseService.updateServer(serverId, serverData);
        return {'success': true, 'data': result};
      } catch (supabaseError) {
        return {'success': false, 'error': supabaseError.toString()};
      }
    }
  }

  /// حذف سيرفر
  static Future<Map<String, dynamic>> deleteServer(String serverId) async {
    try {
      final headers = await _getHeaders();
      final response = await http.delete(
        Uri.parse('${SupabaseConfig.apiBaseUrl}/servers/$serverId'),
        headers: headers,
      );

      if (response.statusCode == 200 || response.statusCode == 204) {
        return {'success': true};
      }

      return {'success': false, 'error': 'Failed to delete server'};
    } catch (e) {
      // Fallback to Supabase
      try {
        await SupabaseService.deleteServer(serverId);
        return {'success': true};
      } catch (supabaseError) {
        return {'success': false, 'error': supabaseError.toString()};
      }
    }
  }

  /// اختبار اتصال السيرفر
  static Future<Map<String, dynamic>> testServerConnection(
    String serverId,
  ) async {
    try {
      final headers = await _getHeaders();
      final response = await http.post(
        Uri.parse('${SupabaseConfig.apiBaseUrl}/servers/$serverId/test'),
        headers: headers,
      );

      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }

      return {'success': false, 'error': 'Failed to test server connection'};
    } catch (e) {
      return {'success': false, 'error': 'Network error: $e'};
    }
  }

  // =============== لوحة التحكم ===============

  /// الحصول على إحصائيات لوحة التحكم
  // =============== الإحصائيات والتقارير ===============

  /// جلب إحصائيات لوحة التحكم (نفس الموقع بالضبط)
  static Future<DashboardStats> getDashboardStats() async {
    try {
      final headers = await _getHeaders();
      // الموقع يستخدم /dashboard/overview وليس /dashboard/stats
      final response = await http.get(
        Uri.parse('${SupabaseConfig.apiBaseUrl}/dashboard/overview'),
        headers: headers,
      );

      print('📥 Dashboard Stats Response: ${response.statusCode}');

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return DashboardStats.fromJson(data);
      }

      throw Exception('فشل جلب الإحصائيات: ${response.statusCode}');
    } catch (e) {
      print('❌ Dashboard Stats Error: $e');
      // Fallback: جلب البيانات يدوياً من Supabase إذا فشل الـ API
      final devices = await SupabaseService.getDevices();
      final servers = await SupabaseService.getServers();
      final alerts = await SupabaseService.getAlerts();

      return DashboardStats(
        totalDevices: devices.length,
        connectedDevices: devices
            .where((d) => d['status'] == 'connected')
            .length,
        pendingDevices: devices
            .where((d) => d['status'] == 'pending' || d['status'] == 'waiting')
            .length,
        disconnectedDevices: devices
            .where((d) => d['status'] == 'disconnected')
            .length,
        totalServers: servers.length,
        totalAlerts: alerts.length,
      );
    }
  }

  /// إنشاء تقرير جديد (نفس الموقع)
  static Future<Map<String, dynamic>> generateReport({
    String? name,
    String format = 'pdf',
    bool includeCharts = true,
    String type = 'system_overview',
    String language = 'en',
  }) async {
    try {
      final headers = await _getHeaders();
      final bodyMap = {
        if (name != null) 'name': name,
        'format': format,
        'include_charts': includeCharts,
        'type': type,
        'language': language,
      };
      final body = jsonEncode(bodyMap);

      print('📝 Generating report via API...');
      final response = await http
          .post(
            Uri.parse('${SupabaseConfig.apiBaseUrl}/reports/generate'),
            headers: {
              ...headers,
              'Accept': format == 'pdf'
                  ? 'application/pdf,application/json'
                  : 'application/json',
            },
            body: body,
          )
          .timeout(
            const Duration(seconds: 90),
          ); // Increased timeout for AI generation

      print('📥 Generate Report Response: ${response.statusCode}');

      if (response.statusCode == 200 || response.statusCode == 201) {
        // التحقق مما إذا كانت الاستجابة PDF
        if (response.headers['content-type']?.contains('application/pdf') ??
            false) {
          print('✅ PDF report received directly');
          return {
            'success': true,
            'isPdf': true,
            'data': response.bodyBytes,
            'filename': name ?? 'report.pdf',
          };
        }

        final dynamic dataRaw = (response.body.isNotEmpty)
            ? jsonDecode(response.body)
            : null;

        // Normalize to a single `report` object that definitely contains the id when possible
        Map<String, dynamic>? reportObj;
        try {
          if (dataRaw != null) {
            if (dataRaw is Map<String, dynamic>) {
              if (dataRaw['report'] is Map) {
                reportObj = Map<String, dynamic>.from(dataRaw['report']);
              } else if (dataRaw.containsKey('id')) {
                reportObj = Map<String, dynamic>.from(dataRaw);
              } else if (dataRaw.containsKey('report_id')) {
                reportObj = {'id': dataRaw['report_id']};
              } else if (dataRaw['data'] is List &&
                  dataRaw['data'].isNotEmpty) {
                reportObj = Map<String, dynamic>.from(dataRaw['data'][0]);
              }
            } else if (dataRaw is List && dataRaw.isNotEmpty) {
              reportObj = Map<String, dynamic>.from(dataRaw[0]);
            }
          }
        } catch (e) {
          print('⚠️ Warning parsing report metadata: $e');
        }

        // Try extracting id from headers (Location) if body didn't include it
        if ((reportObj == null || reportObj['id'] == null) &&
            (response.headers['location'] != null ||
                response.headers['content-location'] != null)) {
          final loc =
              response.headers['location'] ??
              response.headers['content-location'];
          try {
            final parts = loc?.split('/') ?? [];
            final last = parts.isNotEmpty ? parts.last : null;
            if (last != null) {
              final parsedId = int.tryParse(last);
              if (parsedId != null) {
                reportObj = reportObj ?? {};
                reportObj['id'] = parsedId;
              }
            }
          } catch (_) {}
        }

        // If we still don't have an id, fallback to querying Supabase for a matching recent report
        if (reportObj == null || reportObj['id'] == null) {
          print(
            '⚠️ No report id found in response body/headers. Attempting to resolve via Supabase lookup...',
          );
          try {
            dynamic existing;
            if (name != null && name.trim().isNotEmpty) {
              existing = await SupabaseService.client
                  .from('reports')
                  .select('*')
                  .eq('report_type', type)
                  .eq('name', name)
                  .order('created_at', ascending: false)
                  .limit(1)
                  .maybeSingle();
            } else {
              final fiveMinAgo = DateTime.now()
                  .subtract(const Duration(minutes: 5))
                  .toIso8601String();
              existing = await SupabaseService.client
                  .from('reports')
                  .select('*')
                  .eq('report_type', type)
                  .gte('created_at', fiveMinAgo)
                  .order('created_at', ascending: false)
                  .limit(1)
                  .maybeSingle();
            }

            if (existing != null) {
              reportObj = Map<String, dynamic>.from(existing);
              print(
                '✅ Resolved report via Supabase lookup: id ${reportObj['id']}',
              );
            }
          } catch (e) {
            print('❌ Supabase lookup failed while resolving report id: $e');
          }
        }

        return {'success': true, 'isPdf': false, 'report': reportObj ?? {}};
      }

      // إذا كانت استجابة الخادم 500، نحاول فالباك إلى Supabase مباشرة
      String errorMessage = 'فشل إنشاء التقرير: ${response.statusCode}';
      try {
        final bodyJson = jsonDecode(response.body);
        if (bodyJson is Map && bodyJson['error'] != null) {
          errorMessage = bodyJson['error'].toString();
        }
      } catch (_) {}

      if (response.statusCode == 500) {
        print(
          '⚠️ Server returned 500. Attempting fallback: insert report directly to Supabase...',
        );
        try {
          // تحضير بيانات التقرير كفالباك
          final reportData = {
            'name':
                name ??
                'Comprehensive Report ${DateTime.now().toIso8601String()}',
            'report_type': type,
            'status': 'generating',
            'created_at': DateTime.now().toIso8601String(),
            'created_by': null,
            'params': jsonEncode({
              'language': language,
              'format': format,
              'include_charts': includeCharts,
              'name': name,
            }),
            'language': language,
            'format_type': format,
            'is_comprehensive': true,
          };

          // 1) محاولة البحث عن سجل مطابق حديثًا لتجنب التصادمات
          try {
            dynamic existing;
            if (name != null && name.trim().isNotEmpty) {
              existing = await SupabaseService.client
                  .from('reports')
                  .select('*')
                  .eq('report_type', type)
                  .eq('name', name)
                  .order('created_at', ascending: false)
                  .limit(1)
                  .maybeSingle();
            } else {
              final fiveMinAgo = DateTime.now()
                  .subtract(const Duration(minutes: 5))
                  .toIso8601String();
              existing = await SupabaseService.client
                  .from('reports')
                  .select('*')
                  .eq('report_type', type)
                  .gte('created_at', fiveMinAgo)
                  .order('created_at', ascending: false)
                  .limit(1)
                  .maybeSingle();
            }

            if (existing != null) {
              print(
                '⚠️ Found existing report during fallback: id ${existing['id']}',
              );
              return {'success': true, 'isPdf': false, 'report': existing};
            }
          } catch (e) {
            print(
              '⚠️ Error while searching existing reports during fallback: $e',
            );
            // تابع لإدخال التقرير إذا لم نتمكن من البحث
          }

          // 2) محاولة الإدراج الآمن
          try {
            final inserted = await SupabaseService.client
                .from('reports')
                .insert(reportData)
                .select();

            if (inserted.isNotEmpty) {
              print(
                '✅ Fallback insert succeeded, report id: ${inserted[0]['id']}',
              );
              return {'success': true, 'isPdf': false, 'report': inserted[0]};
            }
          } catch (e) {
            final emsg = e.toString();
            // إذا كان سبب الفشل هو وجود مفتاح مكرر، نحاول جلب السجل الموجود وإرجاعه
            if (emsg.contains('duplicate key') || emsg.contains('23505')) {
              try {
                dynamic existing2;
                if (name != null && name.trim().isNotEmpty) {
                  existing2 = await SupabaseService.client
                      .from('reports')
                      .select('*')
                      .eq('report_type', type)
                      .eq('name', name)
                      .order('created_at', ascending: false)
                      .limit(1)
                      .maybeSingle();
                } else {
                  final fiveMinAgo = DateTime.now()
                      .subtract(const Duration(minutes: 5))
                      .toIso8601String();
                  existing2 = await SupabaseService.client
                      .from('reports')
                      .select('*')
                      .eq('report_type', type)
                      .gte('created_at', fiveMinAgo)
                      .order('created_at', ascending: false)
                      .limit(1)
                      .maybeSingle();
                }

                if (existing2 != null) {
                  print(
                    '✅ Duplicate key handled: returning existing report id ${existing2['id']}',
                  );
                  return {'success': true, 'isPdf': false, 'report': existing2};
                }
              } catch (e2) {
                print('❌ Error while recovering from duplicate key: $e2');
              }
            }

            print('❌ Fallback to Supabase failed (insert error): $e');
          }
        } catch (e) {
          print('❌ Fallback to Supabase failed: $e');
        }
      }

      return {'success': false, 'error': errorMessage};
    } catch (e) {
      print('❌ Generate Report Error: $e');
      return {'success': false, 'error': e.toString()};
    }
  }

  /// تحميل التقرير كـ PDF (نفس الموقع)
  static Future<Map<String, dynamic>> exportReportPdf(int reportId) async {
    try {
      final headers = await _getHeaders();

      print('📥 Downloading PDF for report: $reportId');
      final response = await http
          .get(
            Uri.parse(
              '${SupabaseConfig.apiBaseUrl}/reports/export-pdf/$reportId',
            ),
            headers: {
              ...headers,
              'Accept': 'application/pdf,application/octet-stream,*/*',
            },
          )
          .timeout(const Duration(seconds: 60));

      print('📥 Export PDF Response: ${response.statusCode}');

      if (response.statusCode == 200) {
        return {
          'success': true,
          'data': response.bodyBytes,
          'contentType': response.headers['content-type'],
        };
      }
      return {
        'success': false,
        'error': 'فشل تحميل PDF: ${response.statusCode}',
      };
    } catch (e) {
      print('❌ Export PDF Error: $e');
      return {'success': false, 'error': e.toString()};
    }
  }

  /// جلب تاريخ التقارير
  static Future<List<Map<String, dynamic>>> getReportsHistory() async {
    try {
      final headers = await _getHeaders();
      final response = await http.get(
        Uri.parse('${SupabaseConfig.apiBaseUrl}/reports/history'),
        headers: headers,
      );

      if (response.statusCode == 200) {
        final List<dynamic> data = jsonDecode(response.body);
        return data.cast<Map<String, dynamic>>();
      }
      return [];
    } catch (e) {
      print('❌ Reports History Error: $e');
      return [];
    }
  }

  // ===================== Logs API =====================
  /// جلب السجلات (يحاكي سلوك الويب: يحاول /logs/simple ثم /logs كفالباك)
  // Track whether last fetch used fallback (simple) due to /logs issues
  static bool lastLogsFetchUsedFallback = false;

  static Future<List<Map<String, dynamic>>> fetchLogs({
    int limit = 100,
    int days = 7,
    DateTime? startDate,
    DateTime? endDate,
    String? action,
    String? search,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    lastLogsFetchUsedFallback = false;
    try {
      final headers = await _getHeaders();

      // Prefer paginated /logs endpoint which returns total and supports offset
      final pageLimit = (limit <= 0) ? 100 : (limit > 100 ? 100 : limit);
      int offset = 0;
      final allLogs = <Map<String, dynamic>>[];
      int total = 0;

      String startStr = '';
      String endStr = '';
      if (startDate != null)
        startStr = startDate.toIso8601String().split('T').first;
      if (endDate != null) endStr = endDate.toIso8601String().split('T').first;

      // Safety: don't fetch more than maxRecords to avoid OOM
      const int maxRecords = 10000;
      bool done = false;

      while (!done && allLogs.length < maxRecords) {
        final uri = Uri.parse('${SupabaseConfig.apiBaseUrl}/logs').replace(
          queryParameters: {
            'limit': pageLimit.toString(),
            'offset': offset.toString(),
            if (startStr.isNotEmpty) 'start_date': startStr,
            if (endStr.isNotEmpty) 'end_date': endStr,
            if (action != null && action.isNotEmpty) 'action': action,
            if (search != null && search.isNotEmpty) 'search': search,
          },
        );

        http.Response response;
        try {
          response = await http.get(uri, headers: headers).timeout(timeout);
        } on TimeoutException catch (te) {
          print('❌ /logs request timed out after ${timeout.inSeconds}s: $te');
          lastLogsFetchUsedFallback = true;
          break; // go to fallback
        } catch (e) {
          print('❌ /logs request failed: $e');
          lastLogsFetchUsedFallback = true;
          break;
        }

        if (response.statusCode != 200) {
          // If main endpoint fails, fallback to /simple with days
          print(
            '⚠️ /logs endpoint failed with ${response.statusCode}, falling back to /simple',
          );
          lastLogsFetchUsedFallback = true;
          break;
        }

        final data = jsonDecode(response.body);
        List<dynamic> pageLogs = [];
        try {
          if (data is Map && data['logs'] is List) {
            pageLogs = data['logs'];
            total = data['total'] ?? total;
          } else if (data is List) {
            pageLogs = data;
            total = pageLogs.length;
          }
        } catch (e) {
          print('⚠️ parse /logs response error: $e');
          lastLogsFetchUsedFallback = true;
          break;
        }

        for (var item in pageLogs) {
          if (item is Map) allLogs.add(Map<String, dynamic>.from(item));
          if (allLogs.length >= maxRecords) break;
        }

        // Progress
        if (pageLogs.length < pageLimit) {
          done = true;
        } else {
          offset += pageLimit;
          if (offset >= total && total > 0) done = true;
        }
      }

      if (allLogs.isNotEmpty) return allLogs;

      // Fallback to /simple if paginated /logs didn't return anything or timed out
      try {
        lastLogsFetchUsedFallback = true;
        final adjusted = limit > 100 ? 100 : limit;
        final urlSimple =
            '${SupabaseConfig.apiBaseUrl}/logs/simple?limit=$adjusted&days=$days';
        final responseSimple = await http
            .get(Uri.parse(urlSimple), headers: headers)
            .timeout(const Duration(seconds: 30));
        if (responseSimple.statusCode == 200) {
          final dataS = jsonDecode(responseSimple.body);
          if (dataS is List) return List<Map<String, dynamic>>.from(dataS);
          if (dataS is Map && dataS['logs'] is List)
            return List<Map<String, dynamic>>.from(dataS['logs']);
        }
      } catch (e) {
        print('❌ /simple fallback failed: $e');
      }

      return [];
    } catch (e) {
      print('❌ Fetch logs error: $e');
      return [];
    }
  }

  /// مسح سجلات حسب عدد الأيام
  static Future<bool> clearLogs(int days) async {
    try {
      final headers = await _getHeaders();
      final response = await http
          .post(
            Uri.parse('${SupabaseConfig.apiBaseUrl}/logs/clear'),
            headers: headers,
            body: jsonEncode({'days': days}),
          )
          .timeout(const Duration(seconds: 10));

      return response.statusCode == 200;
    } catch (e) {
      print('❌ Clear logs error: $e');
      return false;
    }
  }

  /// مسح كل السجلات
  static Future<bool> clearAllLogs() async {
    try {
      final headers = await _getHeaders();
      final response = await http
          .delete(
            Uri.parse('${SupabaseConfig.apiBaseUrl}/logs/clear-all'),
            headers: headers,
          )
          .timeout(const Duration(seconds: 10));

      return response.statusCode == 200;
    } catch (e) {
      print('❌ Clear all logs error: $e');
      return false;
    }
  }

  /// جلب إحصائيات السجلات (لتكوين قائمة التصنيفات الديناميكية)
  static Future<Map<String, dynamic>> fetchLogStats({
    Map<String, dynamic>? params,
  }) async {
    try {
      final headers = await _getHeaders();
      final uri = Uri.parse('${SupabaseConfig.apiBaseUrl}/logs/stats').replace(
        queryParameters: params?.map((k, v) => MapEntry(k, v.toString())) ?? {},
      );
      final response = await http
          .get(uri, headers: headers)
          .timeout(const Duration(seconds: 10));
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return Map<String, dynamic>.from(data);
      }
      return {};
    } catch (e) {
      print('❌ Fetch log stats error: $e');
      return {};
    }
  }

  // =============== الأجهزة المعلقة من العملاء ===============

  /// جلب الأجهزة المعلقة من العملاء (من جدول agent_pending_devices المعزول)
  static Future<List<Map<String, dynamic>>> getAgentPendingDevices() async {
    try {
      final headers = await _getHeaders();
      final response = await http
          .get(
            Uri.parse('${SupabaseConfig.apiBaseUrl}/devices/pending'),
            headers: headers,
          )
          .timeout(const Duration(seconds: 15));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        final devices = data['pending_devices'] ?? data['devices'] ?? [];
        print('📱 Agent pending devices: ${(devices as List).length}');
        return (devices).cast<Map<String, dynamic>>();
      }

      print('❌ Get agent pending devices error: ${response.statusCode}');
      return [];
    } catch (e) {
      print('❌ Get agent pending devices error: $e');
      return [];
    }
  }

  /// الموافقة على جهاز معلق من عميل
  static Future<Map<String, dynamic>> approveAgentPendingDevice(
    String pendingId,
  ) async {
    try {
      final headers = await _getHeaders();
      final response = await http
          .post(
            Uri.parse(
              '${SupabaseConfig.apiBaseUrl}/devices/pending/$pendingId/approve',
            ),
            headers: headers,
          )
          .timeout(const Duration(seconds: 15));

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 || response.statusCode == 201) {
        return {
          'success': true,
          'message': data['message'] ?? 'تمت الموافقة على الجهاز',
          'device': data['device'],
        };
      }

      return {
        'success': false,
        'error': data['error'] ?? 'فشلت الموافقة على الجهاز',
      };
    } catch (e) {
      print('❌ Approve agent pending device error: $e');
      return {'success': false, 'error': 'خطأ في الاتصال: $e'};
    }
  }

  /// رفض جهاز معلق من عميل
  static Future<Map<String, dynamic>> rejectAgentPendingDevice(
    String pendingId, {
    String? reason,
  }) async {
    try {
      final headers = await _getHeaders();
      final response = await http
          .post(
            Uri.parse(
              '${SupabaseConfig.apiBaseUrl}/devices/pending/$pendingId/reject',
            ),
            headers: headers,
            body: jsonEncode({'reason': reason ?? 'تم الرفض من المشرف'}),
          )
          .timeout(const Duration(seconds: 15));

      final data = jsonDecode(response.body);

      if (response.statusCode == 200) {
        return {'success': true, 'message': data['message'] ?? 'تم رفض الجهاز'};
      }

      return {'success': false, 'error': data['error'] ?? 'فشل رفض الجهاز'};
    } catch (e) {
      print('❌ Reject agent pending device error: $e');
      return {'success': false, 'error': 'خطأ في الاتصال: $e'};
    }
  }

  /// حذف جهاز معلق من عميل
  static Future<Map<String, dynamic>> deleteAgentPendingDevice(
    String pendingId,
  ) async {
    try {
      final headers = await _getHeaders();
      final response = await http
          .delete(
            Uri.parse(
              '${SupabaseConfig.apiBaseUrl}/devices/pending/$pendingId',
            ),
            headers: headers,
          )
          .timeout(const Duration(seconds: 15));

      final data = jsonDecode(response.body);

      if (response.statusCode == 200) {
        return {'success': true, 'message': data['message'] ?? 'تم حذف الجهاز'};
      }

      return {'success': false, 'error': data['error'] ?? 'فشل حذف الجهاز'};
    } catch (e) {
      print('❌ Delete agent pending device error: $e');
      return {'success': false, 'error': 'خطأ في الاتصال: $e'};
    }
  }
}
