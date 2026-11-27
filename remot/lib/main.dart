import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'config/app_theme.dart';
import 'config/supabase_config.dart';
import 'providers/auth_provider.dart';
import 'providers/theme_provider.dart';
import 'screens/onboarding_screen.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'services/supabase_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // إخفاء رسائل الـ overflow في Debug mode
  FlutterError.onError = (FlutterErrorDetails details) {
    if (details.exception.toString().contains('overflowed')) {
      // تجاهل أخطاء الـ overflow
      return;
    }
    FlutterError.presentError(details);
  };

  // قبل أي شيء: حمل إعدادات backend_config.json إن وُجدت (من الأصول أو مجلد الوثائق)
  await SupabaseService.loadLocalBackendConfig();

  // تهيئة Supabase للاتصال المباشر بقاعدة البيانات
  await SupabaseService.initialize();

  // محاولة جلب الآي بي الديناميكي للخادم كخطة بديلة
  try {
    final activeIp = await SupabaseService.getActiveServerIp();
    if (activeIp != null) {
      SupabaseConfig.updateApiUrl(activeIp);
      print('🌐 Using Dynamic API Host: ${SupabaseConfig.apiBaseUrl}');
    }
  } catch (e) {
    print(
      '⚠️ Using default/API host from config: ${SupabaseConfig.apiBaseUrl}',
    );
  }

  // بدء مراقبة تغيّر عنوان الـ IP للخادم (سيقوم بالتحديث تلقائياً خلال التشغيل)
  SupabaseService.startBackendIpWatcher(intervalSeconds: 60);

  // تعيين اتجاه الشاشة
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // تعيين لون شريط الحالة
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
    ),
  );

  runApp(const RemotAdminApp());
}

/// تطبيق Remot Admin للتحكم بالأجهزة والتنبيهات
class RemotAdminApp extends StatelessWidget {
  const RemotAdminApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => ThemeProvider()),
      ],
      child: Consumer<ThemeProvider>(
        builder: (context, themeProvider, child) {
          return MaterialApp(
            title: 'Remot Admin',
            debugShowCheckedModeBanner: false,
            theme: AppTheme.lightTheme,
            darkTheme: AppTheme.darkTheme,
            themeMode: themeProvider.themeMode,
            // دعم اللغة العربية والإنجليزية - يتبع لغة الجهاز
            localeResolutionCallback: (deviceLocale, supportedLocales) {
              // إذا كانت لغة الجهاز عربية
              if (deviceLocale != null && deviceLocale.languageCode == 'ar') {
                return deviceLocale;
              }
              // إذا كانت لغة الجهاز إنجليزية أو أي لغة أخرى
              if (deviceLocale != null && deviceLocale.languageCode == 'en') {
                return const Locale('en', 'US');
              }
              // الافتراضي: العربية
              return const Locale('ar', 'IQ');
            },
            supportedLocales: const [
              Locale('ar', 'IQ'),
              Locale('ar', 'SA'),
              Locale('en', 'US'),
            ],
            localizationsDelegates: const [
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            builder: (context, child) {
              // تحديد اتجاه النص بناءً على اللغة
              final locale = Localizations.localeOf(context);
              final isArabic = locale.languageCode == 'ar';
              return Directionality(
                textDirection: isArabic ? TextDirection.rtl : TextDirection.ltr,
                child: child!,
              );
            },
            home: const SplashScreen(),
          );
        },
      ),
    );
  }
}

/// شاشة البداية - التحقق من حالة تسجيل الدخول
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();

    _animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    );

    _fadeAnimation = Tween<double>(begin: 0, end: 1).animate(
      CurvedAnimation(
        parent: _animationController,
        curve: const Interval(0, 0.5, curve: Curves.easeIn),
      ),
    );

    _scaleAnimation = Tween<double>(begin: 0.8, end: 1).animate(
      CurvedAnimation(
        parent: _animationController,
        curve: const Interval(0, 0.5, curve: Curves.easeOutBack),
      ),
    );

    _animationController.forward();
    _checkAuthAndNavigate();
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  Future<void> _checkAuthAndNavigate() async {
    if (!mounted) return;

    // التحقق إذا كانت هذه أول مرة يفتح التطبيق
    final prefs = await SharedPreferences.getInstance();
    final hasSeenOnboarding = prefs.getBool('has_seen_onboarding') ?? false;

    if (!mounted) return;

    if (!hasSeenOnboarding) {
      // أول مرة - عرض صفحة الترحيب (لا نعيّن true هنا، بل في صفحة الترحيب عند الانتهاء)
      Navigator.of(context).pushReplacement(
        PageRouteBuilder(
          pageBuilder: (_, __, ___) => const OnboardingScreen(),
          transitionDuration: const Duration(milliseconds: 500),
          transitionsBuilder: (_, animation, __, child) {
            return FadeTransition(opacity: animation, child: child);
          },
        ),
      );
      return;
    }

    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    await authProvider.checkAuthStatus();

    if (!mounted) return;

    // الانتقال للصفحة المناسبة
    Navigator.of(context).pushReplacement(
      PageRouteBuilder(
        pageBuilder: (_, __, ___) => authProvider.isAuthenticated
            ? const HomeScreen()
            : const LoginScreen(),
        transitionDuration: const Duration(milliseconds: 500),
        transitionsBuilder: (_, animation, __, child) {
          return FadeTransition(opacity: animation, child: child);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: AppTheme.primaryGradient),
        child: Center(
          child: AnimatedBuilder(
            animation: _animationController,
            builder: (context, child) {
              return FadeTransition(
                opacity: _fadeAnimation,
                child: ScaleTransition(
                  scale: _scaleAnimation,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // الشعار
                      Container(
                        width: 120,
                        height: 120,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(30),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.2),
                              blurRadius: 20,
                              offset: const Offset(0, 10),
                            ),
                          ],
                        ),
                        child: const Icon(
                          Icons.admin_panel_settings,
                          size: 70,
                          color: AppTheme.primaryColor,
                        ),
                      ),
                      const SizedBox(height: 32),

                      // اسم التطبيق
                      const Text(
                        'Remot Admin',
                        style: TextStyle(
                          fontSize: 32,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                          letterSpacing: 1.5,
                        ),
                      ),
                      const SizedBox(height: 8),

                      // الوصف
                      Text(
                        'لوحة التحكم الإدارية',
                        style: TextStyle(
                          fontSize: 16,
                          color: Colors.white.withValues(alpha: 0.8),
                        ),
                      ),
                      const SizedBox(height: 48),

                      // مؤشر التحميل
                      SizedBox(
                        width: 40,
                        height: 40,
                        child: CircularProgressIndicator(
                          valueColor: AlwaysStoppedAnimation<Color>(
                            Colors.white.withValues(alpha: 0.8),
                          ),
                          strokeWidth: 3,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
