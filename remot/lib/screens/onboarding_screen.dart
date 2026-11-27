import 'package:flutter/material.dart';
import 'dart:ui';
import 'package:shared_preferences/shared_preferences.dart';
import '../config/app_theme.dart';
import 'login_screen.dart';
import 'register_screen.dart';

/// صفحة الترحيب والتعريف بالنظام
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen>
    with SingleTickerProviderStateMixin {
  final PageController _pageController = PageController();
  int _currentPage = 0;
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;

  final List<OnboardingItem> _items = [
    OnboardingItem(
      icon: Icons.security,
      title: 'حماية متقدمة',
      description:
          'نظام متكامل لمراقبة وإدارة أجهزة USB في مؤسستك مع حماية فائقة ضد التهديدات الأمنية',
      color: const Color(0xFF1E88E5),
    ),
    OnboardingItem(
      icon: Icons.devices,
      title: 'مراقبة الأجهزة',
      description:
          'تتبع جميع أجهزة USB المتصلة في الوقت الفعلي مع تنبيهات فورية عند اكتشاف أي نشاط مشبوه',
      color: const Color(0xFF00BCD4),
    ),
    OnboardingItem(
      icon: Icons.policy,
      title: 'سياسات مرنة',
      description:
          'إنشاء وتطبيق سياسات أمان مخصصة للتحكم الكامل في صلاحيات الوصول للأجهزة',
      color: const Color(0xFF4CAF50),
    ),
    OnboardingItem(
      icon: Icons.analytics,
      title: 'تقارير شاملة',
      description:
          'احصل على تقارير مفصلة وإحصائيات دقيقة حول استخدام الأجهزة والأنشطة المسجلة',
      color: const Color(0xFFFF9800),
    ),
    OnboardingItem(
      icon: Icons.notifications_active,
      title: 'تنبيهات ذكية',
      description:
          'نظام تنبيهات متطور يعلمك فوراً بأي محاولات وصول غير مصرح بها أو تهديدات محتملة',
      color: const Color(0xFFF44336),
    ),
  ];

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );
    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _animationController, curve: Curves.easeOut),
    );
    _animationController.forward();
  }

  @override
  void dispose() {
    _pageController.dispose();
    _animationController.dispose();
    super.dispose();
  }

  void _nextPage() {
    if (_currentPage < _items.length - 1) {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 400),
        curve: Curves.easeInOut,
      );
    }
  }

  Future<void> _markOnboardingComplete() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('has_seen_onboarding', true);
  }

  void _goToLogin() async {
    await _markOnboardingComplete();
    if (mounted) {
      Navigator.of(
        context,
      ).pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen()));
    }
  }

  void _goToRegister() async {
    await _markOnboardingComplete();
    if (mounted) {
      Navigator.of(
        context,
      ).push(MaterialPageRoute(builder: (_) => const RegisterScreen()));
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        body: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: isDark
                  ? [
                      const Color(0xFF0A1929),
                      const Color(0xFF0D47A1),
                      const Color(0xFF0A1929),
                    ]
                  : [
                      const Color(0xFF1E88E5),
                      const Color(0xFF0D47A1),
                      const Color(0xFF1565C0),
                    ],
            ),
          ),
          child: SafeArea(
            child: FadeTransition(
              opacity: _fadeAnimation,
              child: Column(
                children: [
                  // زر التخطي
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        // الشعار
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: const Icon(
                                Icons.usb,
                                color: AppTheme.primaryColor,
                                size: 24,
                              ),
                            ),
                            const SizedBox(width: 12),
                            const Text(
                              'USB Monitor',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                        // زر التخطي
                        TextButton(
                          onPressed: _goToLogin,
                          child: const Text(
                            'تخطي',
                            style: TextStyle(
                              color: Colors.white70,
                              fontSize: 16,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),

                  // المحتوى
                  Expanded(
                    child: PageView.builder(
                      controller: _pageController,
                      onPageChanged: (index) {
                        setState(() => _currentPage = index);
                      },
                      itemCount: _items.length,
                      itemBuilder: (context, index) {
                        return _buildPage(_items[index]);
                      },
                    ),
                  ),

                  // المؤشرات
                  _buildIndicators(),

                  // أزرار التحكم
                  _buildBottomButtons(isDark),

                  const SizedBox(height: 20),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPage(OnboardingItem item) {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          // الأيقونة
          Container(
            width: 140,
            height: 140,
            decoration: BoxDecoration(
              color: item.color.withValues(alpha: 0.2),
              shape: BoxShape.circle,
              border: Border.all(
                color: item.color.withValues(alpha: 0.5),
                width: 3,
              ),
              boxShadow: [
                BoxShadow(
                  color: item.color.withValues(alpha: 0.3),
                  blurRadius: 30,
                  spreadRadius: 5,
                ),
              ],
            ),
            child: Icon(item.icon, size: 70, color: Colors.white),
          ),
          const SizedBox(height: 48),

          // العنوان
          Text(
            item.title,
            style: const TextStyle(
              fontSize: 32,
              fontWeight: FontWeight.bold,
              color: Colors.white,
              letterSpacing: 1,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 20),

          // الوصف
          Text(
            item.description,
            style: TextStyle(
              fontSize: 17,
              color: Colors.white.withValues(alpha: 0.8),
              height: 1.6,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildIndicators() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: List.generate(_items.length, (index) {
          final isActive = index == _currentPage;
          return AnimatedContainer(
            duration: const Duration(milliseconds: 300),
            margin: const EdgeInsets.symmetric(horizontal: 4),
            width: isActive ? 32 : 10,
            height: 10,
            decoration: BoxDecoration(
              color: isActive
                  ? Colors.white
                  : Colors.white.withValues(alpha: 0.3),
              borderRadius: BorderRadius.circular(5),
            ),
          );
        }),
      ),
    );
  }

  Widget _buildBottomButtons(bool isDark) {
    final isLastPage = _currentPage == _items.length - 1;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Column(
        children: [
          // زر البدء / التالي
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
              child: Container(
                width: double.infinity,
                height: 56,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.2),
                      blurRadius: 15,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: isLastPage ? _goToLogin : _nextPage,
                    borderRadius: BorderRadius.circular(16),
                    child: Center(
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            isLastPage ? 'تسجيل الدخول' : 'التالي',
                            style: const TextStyle(
                              color: AppTheme.primaryDark,
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Icon(
                            isLastPage ? Icons.login : Icons.arrow_back,
                            color: AppTheme.primaryDark,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),

          // زر إنشاء حساب
          if (isLastPage)
            ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                child: Container(
                  width: double.infinity,
                  height: 56,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.3),
                      width: 1.5,
                    ),
                  ),
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: _goToRegister,
                      borderRadius: BorderRadius.circular(16),
                      child: const Center(
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.person_add, color: Colors.white),
                            SizedBox(width: 8),
                            Text(
                              'إنشاء حساب جديد',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 18,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// نموذج عنصر الترحيب
class OnboardingItem {
  final IconData icon;
  final String title;
  final String description;
  final Color color;

  OnboardingItem({
    required this.icon,
    required this.title,
    required this.description,
    required this.color,
  });
}
