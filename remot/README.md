# Remot Admin - تطبيق الموبايل

تطبيق Flutter للتحكم الإداري في نظام Remot لإدارة أجهزة USB.

## 🚀 المميزات

### الصفحات الرئيسية

1. **شاشة البداية (Splash)** - شاشة تحميل مع التحقق من حالة تسجيل الدخول
2. **تسجيل الدخول** - مصادقة المستخدم باستخدام نفس بيانات الموقع
3. **لوحة التحكم** - عرض الإحصائيات الرئيسية والأجهزة المعلقة وآخر التنبيهات
4. **الأجهزة** - إدارة الأجهزة (المعلقة/المتصلة/المرفوضة) مع إمكانية الموافقة والرفض
5. **التنبيهات** - عرض وإدارة التنبيهات حسب الأولوية
6. **الملف الشخصي** - معلومات المستخدم والإعدادات

### الوظائف الأساسية

- ✅ تسجيل الدخول/الخروج
- ✅ عرض إحصائيات النظام (الأجهزة، الخوادم، التنبيهات)
- ✅ الموافقة/رفض الأجهزة المعلقة
- ✅ عرض وحل التنبيهات
- ✅ فلترة الأجهزة والتنبيهات
- ✅ السحب للتحديث (Pull to Refresh)
- ✅ واجهة عربية RTL
- ✅ دعم الوضع الداكن/الفاتح

## 📦 المكتبات المستخدمة

```yaml
dependencies:
  # Supabase
  supabase_flutter: ^2.8.4
  
  # HTTP
  http: ^1.4.0
  dio: ^5.8.0+1
  
  # إدارة الحالة
  provider: ^6.1.5
  
  # التخزين
  shared_preferences: ^2.5.3
  flutter_secure_storage: ^9.2.4
  
  # الإشعارات
  firebase_core: ^3.12.1
  firebase_messaging: ^15.2.5
  flutter_local_notifications: ^18.0.1
  
  # واجهة المستخدم
  google_fonts: ^6.2.1
  flutter_spinkit: ^5.2.1
  shimmer: ^3.0.0
  pull_to_refresh: ^2.0.0
  badges: ^3.1.2
  fl_chart: ^0.70.2
  
  # أيقونات
  font_awesome_flutter: ^10.8.0
  
  # الوقت
  intl: ^0.20.2
  timeago: ^3.7.0
  
  # الاتصال
  connectivity_plus: ^6.1.4
```

## 🏗️ هيكل المشروع

```
lib/
├── main.dart                 # نقطة الدخول الرئيسية
├── config/
│   ├── supabase_config.dart  # إعدادات Supabase
│   └── app_theme.dart        # الثيم والألوان
├── models/
│   ├── user_model.dart       # نموذج المستخدم
│   ├── device_model.dart     # نموذج الجهاز
│   ├── alert_model.dart      # نموذج التنبيه
│   └── dashboard_stats.dart  # نموذج الإحصائيات
├── providers/
│   └── auth_provider.dart    # مزود المصادقة
├── services/
│   └── api_service.dart      # خدمة API
├── screens/
│   ├── login_screen.dart     # صفحة تسجيل الدخول
│   ├── home_screen.dart      # الصفحة الرئيسية
│   ├── dashboard_screen.dart # لوحة التحكم
│   ├── devices_screen.dart   # إدارة الأجهزة
│   ├── alerts_screen.dart    # التنبيهات
│   └── profile_screen.dart   # الملف الشخصي
└── widgets/
    └── common_widgets.dart   # عناصر مشتركة
```

## ⚙️ التثبيت والتشغيل

### المتطلبات

- Flutter SDK 3.9.2 أو أحدث
- Dart SDK 3.9.2 أو أحدث

### الخطوات

1. **تثبيت المكتبات:**
   ```bash
   cd remot
   flutter pub get
   ```

2. **تحديث إعدادات API:**
   
   افتح `lib/config/supabase_config.dart` وحدث:
   ```dart
   static const String apiBaseUrl = 'http://YOUR_BACKEND_IP:5000/api';
   ```

3. **تشغيل التطبيق:**
   ```bash
   # للتطوير
   flutter run
   
   # لـ Android
   flutter run -d android
   
   # لـ iOS
   flutter run -d ios
   ```

4. **بناء التطبيق للإنتاج:**
   ```bash
   # Android APK
   flutter build apk --release
   
   # Android App Bundle
   flutter build appbundle --release
   
   # iOS
   flutter build ios --release
   ```

## 🔐 المصادقة

التطبيق يستخدم نفس نظام المصادقة الموجود في الموقع:
- JWT tokens للمصادقة
- نفس قاعدة بيانات Supabase
- نفس الـ API endpoints

## 📱 لقطات الشاشة

| شاشة البداية | تسجيل الدخول | لوحة التحكم |
|:---:|:---:|:---:|
| Splash | Login | Dashboard |

| الأجهزة | التنبيهات | الملف الشخصي |
|:---:|:---:|:---:|
| Devices | Alerts | Profile |

## 🔧 التخصيص

### تغيير الألوان

افتح `lib/config/app_theme.dart`:

```dart
static const Color primaryColor = Color(0xFF667EEA);
static const Color secondaryColor = Color(0xFF764BA2);
```

### تغيير عنوان API

افتح `lib/config/supabase_config.dart`:

```dart
static const String apiBaseUrl = 'http://localhost:5000/api';
```

## 📝 ملاحظات

- تأكد من تشغيل الـ Backend قبل استخدام التطبيق
- للاختبار على جهاز حقيقي، استخدم IP الـ Backend بدلاً من localhost
- التطبيق يدعم RTL بشكل كامل للغة العربية

