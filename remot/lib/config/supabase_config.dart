/// إعدادات Supabase للتطبيق
/// تتوافق مع إعدادات الموقع الرئيسي
class SupabaseConfig {
  // Supabase Project Configuration
  static const String projectRef = 'fnsrzgbuusmyesdeedky';
  static const String supabaseUrl = 'https://$projectRef.supabase.co';
  static const String supabaseAnonKey =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZuc3J6Z2J1dXNteWVzZGVlZGt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYzNjQyOTYsImV4cCI6MjA3MTk0MDI5Nn0.IggzpWm40DQzA1Uirwb7SqZ8BMOT3RgiqmV1oXXkspY';

  // Backend API URL
  // سيتم تحديثه تلقائياً من قاعدة البيانات إذا توفر
  static String apiBaseUrl = 'http://localhost:5000/api';

  /// تحديث عنوان الـ API بشكل ديناميكي (بورت افتراضي 5000)
  static void updateApiUrl(String ip) {
    if (ip.isNotEmpty) {
      apiBaseUrl = 'http://$ip:5000/api';
    }
  }

  /// تعيين عنوان الـ API مع بورت مخصص
  static void updateApiHost(String ip, [int port = 5000]) {
    if (ip.isNotEmpty) {
      apiBaseUrl = 'http://$ip:$port/api';
    }
  }

  // JWT Configuration
  static const int jwtExpirationDays = 7;
  static const int jwtRefreshExpirationDays = 30;

  // App Configuration
  static const String appName = 'Remot Admin';
  static const String appVersion = '1.0.0';

  // Timezone
  static const String timezone = 'Asia/Baghdad';
}
