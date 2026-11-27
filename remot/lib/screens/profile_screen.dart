import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'dart:io';
import 'dart:ui';
import '../config/app_theme.dart';
import '../providers/auth_provider.dart';
import '../providers/theme_provider.dart';
import '../services/api_service.dart';
import 'login_screen.dart';

/// صفحة الملف الشخصي - تصميم زجاجي مع المصادقة الثنائية
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen>
    with SingleTickerProviderStateMixin {
  File? _localAvatar;
  final ImagePicker _picker = ImagePicker();
  bool _isUploadingImage = false;
  bool _twoFactorEnabled = false;
  bool _emailNotifications = true;
  bool _pushNotifications = true;
  bool _securityAlerts = true;
  bool _deviceAlerts = true;
  final _storage = const FlutterSecureStorage();
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 800),
      vsync: this,
    );
    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _animationController, curve: Curves.easeInOut),
    );

    _loadLocalAvatar();
    _loadSettings();
    _animationController.forward();
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  /// تحميل الصورة المحلية المحفوظة
  Future<void> _loadLocalAvatar() async {
    try {
      final directory = await getApplicationDocumentsDirectory();
      final avatarPath = '${directory.path}/user_avatar.jpg';
      final avatarFile = File(avatarPath);

      if (await avatarFile.exists()) {
        setState(() {
          _localAvatar = avatarFile;
        });
      }
    } catch (e) {
      debugPrint('خطأ في تحميل الصورة: $e');
    }
  }

  /// تحميل الإعدادات المحفوظة
  Future<void> _loadSettings() async {
    try {
      final prefs = await SharedPreferences.getInstance();

      setState(() {
        _twoFactorEnabled = prefs.getBool('two_factor_enabled') ?? false;
        _emailNotifications = prefs.getBool('email_notifications') ?? true;
        _pushNotifications = prefs.getBool('push_notifications') ?? true;
        _securityAlerts = prefs.getBool('security_alerts') ?? true;
        _deviceAlerts = prefs.getBool('device_alerts') ?? true;
      });
    } catch (e) {
      debugPrint('خطأ في تحميل الإعدادات: $e');
    }
  }

  /// حفظ الإعدادات
  Future<void> _saveSettings() async {
    try {
      final prefs = await SharedPreferences.getInstance();

      await prefs.setBool('two_factor_enabled', _twoFactorEnabled);
      await prefs.setBool('email_notifications', _emailNotifications);
      await prefs.setBool('push_notifications', _pushNotifications);
      await prefs.setBool('security_alerts', _securityAlerts);
      await prefs.setBool('device_alerts', _deviceAlerts);
    } catch (e) {
      debugPrint('خطأ في حفظ الإعدادات: $e');
    }
  }

  /// اختيار صورة من المعرض أو الكاميرا
  Future<void> _pickImage(ImageSource source) async {
    try {
      setState(() {
        _isUploadingImage = true;
      });

      final XFile? image = await _picker.pickImage(
        source: source,
        maxWidth: 800,
        maxHeight: 800,
        imageQuality: 80,
      );

      if (image != null) {
        await _saveImageLocally(File(image.path));
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تم تحديث الصورة بنجاح'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('خطأ في تحديث الصورة: $e'),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      setState(() {
        _isUploadingImage = false;
      });
    }
  }

  /// حفظ الصورة في التخزين المحلي
  Future<void> _saveImageLocally(File imageFile) async {
    try {
      final directory = await getApplicationDocumentsDirectory();
      final avatarPath = '${directory.path}/user_avatar.jpg';

      await imageFile.copy(avatarPath);
      await _loadLocalAvatar();
    } catch (e) {
      throw Exception('فشل في حفظ الصورة محلياً: $e');
    }
  }

  /// تفعيل أو إلغاء المصادقة الثنائية
  Future<void> _toggleTwoFactor(bool value) async {
    if (value) {
      // تفعيل المصادقة الثنائية
      final result = await _showTwoFactorSetupDialog();
      if (result == true) {
        setState(() {
          _twoFactorEnabled = true;
        });
        await _saveSettings();

        // حفظ مفتاح سري وهمي (في التطبيق الحقيقي يأتي من الخادم)
        await _storage.write(
          key: 'two_factor_secret',
          value: 'JBSWY3DPEHPK3PXP',
        );

        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تم تفعيل المصادقة الثنائية بنجاح'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } else {
      // إلغاء المصادقة الثنائية
      final confirmed = await _showConfirmationDialog(
        'إلغاء المصادقة الثنائية',
        'هل أنت متأكد من إلغاء المصادقة الثنائية؟ سيقلل هذا من أمان حسابك.',
      );

      if (confirmed == true) {
        setState(() {
          _twoFactorEnabled = false;
        });
        await _saveSettings();
        await _storage.delete(key: 'two_factor_secret');

        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تم إلغاء المصادقة الثنائية'),
            backgroundColor: Colors.orange,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final gradientColors = isDark
        ? [
            const Color(0xFF0F1419),
            const Color(0xFF1A1E29),
            const Color(0xFF0F1419),
          ]
        : [
            const Color(0xFFF5F7FA),
            const Color(0xFFE8EEF5),
            const Color(0xFFF0F4F8),
          ];

    return Scaffold(
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: gradientColors,
          ),
        ),
        child: SafeArea(
          child: FadeTransition(
            opacity: _fadeAnimation,
            child: CustomScrollView(
              slivers: [
                _buildAppBar(),
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Column(
                      children: [
                        _buildProfileHeader(),
                        const SizedBox(height: 24),
                        _buildSecuritySection(),
                        const SizedBox(height: 24),
                        _buildNotificationSettings(),
                        const SizedBox(height: 24),
                        _buildGeneralSettings(),
                        const SizedBox(height: 24),
                        _buildLogoutButton(),
                        const SizedBox(height: 32),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildGlassCard({required Widget child, double? height}) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bgColor = isDark
        ? Colors.white.withValues(alpha: 0.05)
        : Colors.white;
    final borderColor = isDark
        ? Colors.white.withValues(alpha: 0.1)
        : Colors.black.withValues(alpha: 0.1);
    final shadowColor = isDark
        ? Colors.black.withValues(alpha: 0.2)
        : Colors.black.withValues(alpha: 0.08);

    return Container(
      height: height,
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderColor, width: 1),
        boxShadow: [
          BoxShadow(
            color: shadowColor,
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
          child: child,
        ),
      ),
    );
  }

  Widget _buildAppBar() {
    return SliverAppBar(
      backgroundColor: Colors.transparent,
      elevation: 0,
      floating: true,
      pinned: false,
      flexibleSpace: FlexibleSpaceBar(
        background: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Colors.black.withValues(alpha: 0.5), Colors.transparent],
            ),
          ),
        ),
      ),
      title: Builder(
        builder: (context) {
          final isDark = Theme.of(context).brightness == Brightness.dark;
          final textColor = isDark ? Colors.white : const Color(0xFF1A2027);
          final iconColor = isDark
              ? Colors.white.withValues(alpha: 0.9)
              : const Color(0xFF1A2027);
          return _buildGlassCard(
            child: Container(
              padding: const EdgeInsets.all(12),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.person, color: iconColor, size: 20),
                  const SizedBox(width: 8),
                  Text(
                    'الملف الشخصي',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: textColor,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
      centerTitle: true,
    );
  }

  Widget _buildProfileHeader() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final borderColor = isDark
        ? Colors.white.withValues(alpha: 0.3)
        : Colors.black.withValues(alpha: 0.1);

    return _buildGlassCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Stack(
              children: [
                Container(
                  width: 100,
                  height: 100,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: borderColor, width: 3),
                    boxShadow: [
                      BoxShadow(
                        color: AppTheme.primaryColor.withValues(alpha: 0.3),
                        blurRadius: 20,
                        spreadRadius: 2,
                      ),
                    ],
                  ),
                  child: ClipOval(
                    child: _localAvatar != null
                        ? Image.file(_localAvatar!, fit: BoxFit.cover)
                        : Container(
                            decoration: BoxDecoration(
                              gradient: RadialGradient(
                                colors: [
                                  AppTheme.primaryColor.withValues(alpha: 0.3),
                                  AppTheme.primaryColor.withValues(alpha: 0.1),
                                ],
                              ),
                            ),
                            child: Icon(
                              Icons.person,
                              size: 50,
                              color: Colors.white.withValues(alpha: 0.8),
                            ),
                          ),
                  ),
                ),
                Positioned(
                  right: 0,
                  bottom: 0,
                  child: GestureDetector(
                    onTap: _showImagePickerDialog,
                    child: Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: AppTheme.primaryColor,
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 2),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.3),
                            blurRadius: 8,
                          ),
                        ],
                      ),
                      child: _isUploadingImage
                          ? const Padding(
                              padding: EdgeInsets.all(8),
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(
                              Icons.camera_alt,
                              size: 18,
                              color: Colors.white,
                            ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Consumer<AuthProvider>(
              builder: (context, authProvider, _) {
                final user = authProvider.currentUser;
                return Column(
                  children: [
                    Text(
                      user?.username ?? 'المستخدم',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        color: Theme.of(context).brightness == Brightness.dark
                            ? Colors.white
                            : const Color(0xFF1A2027),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.email_outlined,
                            size: 16,
                            color: Colors.white.withValues(alpha: 0.7),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            user?.email ?? 'user@example.com',
                            style: TextStyle(
                              fontSize: 14,
                              color: Colors.white.withValues(alpha: 0.8),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSecuritySection() {
    return _buildGlassCard(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.red.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.security,
                    color: Colors.red,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  'الأمان',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).brightness == Brightness.dark
                        ? Colors.white
                        : const Color(0xFF1A2027),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            _buildSettingTile(
              title: 'المصادقة الثنائية',
              subtitle: _twoFactorEnabled
                  ? 'مفعّلة - حسابك محمي بطبقة أمان إضافية'
                  : 'غير مفعّلة - نوصي بتفعيلها لحماية أفضل',
              icon: Icons.verified_user,
              trailing: Switch(
                value: _twoFactorEnabled,
                onChanged: _toggleTwoFactor,
                activeThumbColor: Colors.green,
                activeTrackColor: Colors.green.withValues(alpha: 0.3),
              ),
            ),
            Divider(
              color: Theme.of(context).brightness == Brightness.dark
                  ? Colors.white24
                  : Colors.black12,
              height: 32,
            ),
            _buildSettingTile(
              title: 'تغيير كلمة المرور',
              subtitle: 'آخر تغيير منذ 30 يوماً',
              icon: Icons.lock_outline,
              onTap: _showChangePasswordDialog,
            ),
            const SizedBox(height: 12),
            _buildSettingTile(
              title: 'جلسات الدخول النشطة',
              subtitle: '3 أجهزة متصلة',
              icon: Icons.devices,
              onTap: _showActiveSessionsDialog,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNotificationSettings() {
    return _buildGlassCard(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.blue.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.notifications,
                    color: Colors.blue,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  'الإشعارات',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).brightness == Brightness.dark
                        ? Colors.white
                        : const Color(0xFF1A2027),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            _buildSettingTile(
              title: 'إشعارات البريد الإلكتروني',
              subtitle: 'استقبال التحديثات والتقارير',
              icon: Icons.email,
              trailing: Switch(
                value: _emailNotifications,
                onChanged: (value) {
                  setState(() {
                    _emailNotifications = value;
                  });
                  _saveSettings();
                },
                activeThumbColor: Colors.blue,
              ),
            ),
            const SizedBox(height: 12),
            _buildSettingTile(
              title: 'إشعارات التطبيق',
              subtitle: 'إشعارات فورية على الجهاز',
              icon: Icons.phone_android,
              trailing: Switch(
                value: _pushNotifications,
                onChanged: (value) {
                  setState(() {
                    _pushNotifications = value;
                  });
                  _saveSettings();
                },
                activeThumbColor: Colors.blue,
              ),
            ),
            const SizedBox(height: 12),
            _buildSettingTile(
              title: 'تنبيهات الأمان',
              subtitle: 'إشعار عند اكتشاف نشاط مشبوه',
              icon: Icons.warning,
              trailing: Switch(
                value: _securityAlerts,
                onChanged: (value) {
                  setState(() {
                    _securityAlerts = value;
                  });
                  _saveSettings();
                },
                activeThumbColor: Colors.orange,
              ),
            ),
            const SizedBox(height: 12),
            _buildSettingTile(
              title: 'تنبيهات الأجهزة',
              subtitle: 'إشعار عند توصيل أجهزة جديدة',
              icon: Icons.usb,
              trailing: Switch(
                value: _deviceAlerts,
                onChanged: (value) {
                  setState(() {
                    _deviceAlerts = value;
                  });
                  _saveSettings();
                },
                activeThumbColor: Colors.green,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildGeneralSettings() {
    return _buildGlassCard(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.green.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.settings,
                    color: Colors.green,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  'إعدادات عامة',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).brightness == Brightness.dark
                        ? Colors.white
                        : const Color(0xFF1A2027),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            Consumer<ThemeProvider>(
              builder: (context, themeProvider, _) {
                return _buildSettingTile(
                  title: 'المظهر',
                  subtitle: themeProvider.isDarkMode
                      ? 'المظهر المظلم'
                      : 'المظهر الفاتح',
                  icon: themeProvider.isDarkMode
                      ? Icons.dark_mode
                      : Icons.light_mode,
                  trailing: Switch(
                    value: themeProvider.isDarkMode,
                    onChanged: (value) => themeProvider.toggleTheme(),
                    activeThumbColor: Colors.orange,
                  ),
                );
              },
            ),
            const SizedBox(height: 12),
            _buildLanguageSelector(),
            const SizedBox(height: 12),
            _buildSettingTile(
              title: 'حول التطبيق',
              subtitle: 'الإصدار 1.0.0',
              icon: Icons.info,
              onTap: _showAboutDialog,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLogoutButton() {
    return _buildGlassCard(
      child: InkWell(
        onTap: _logout,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(20),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.red.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(Icons.logout, color: Colors.red, size: 20),
              ),
              const SizedBox(width: 12),
              const Text(
                'تسجيل الخروج',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: Colors.red,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSettingTile({
    required String title,
    required String subtitle,
    required IconData icon,
    Widget? trailing,
    VoidCallback? onTap,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textColor = isDark ? Colors.white : const Color(0xFF1A2027);
    final textSecondaryColor = isDark
        ? Colors.white.withValues(alpha: 0.6)
        : const Color(0xFF6B7280);
    final bgColor = isDark
        ? Colors.white.withValues(alpha: 0.03)
        : Colors.black.withValues(alpha: 0.03);
    final borderColor = isDark
        ? Colors.white.withValues(alpha: 0.05)
        : Colors.black.withValues(alpha: 0.05);
    final iconColor = isDark
        ? Colors.white.withValues(alpha: 0.8)
        : const Color(0xFF6B7280);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: borderColor),
        ),
        child: Row(
          children: [
            Icon(icon, color: iconColor, size: 24),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: textColor,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    subtitle,
                    style: TextStyle(fontSize: 14, color: textSecondaryColor),
                  ),
                ],
              ),
            ),
            if (trailing != null)
              trailing
            else if (onTap != null)
              Icon(Icons.chevron_right, color: iconColor),
          ],
        ),
      ),
    );
  }

  // دوال الحوارات
  void _showImagePickerDialog() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => _buildGlassCard(
        child: Container(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'اختر مصدر الصورة',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 20),
              ListTile(
                leading: const Icon(Icons.photo_library, color: Colors.blue),
                title: const Text(
                  'من المعرض',
                  style: TextStyle(color: Colors.white),
                ),
                onTap: () {
                  Navigator.pop(context);
                  _pickImage(ImageSource.gallery);
                },
              ),
              ListTile(
                leading: const Icon(Icons.camera_alt, color: Colors.green),
                title: const Text(
                  'من الكاميرا',
                  style: TextStyle(color: Colors.white),
                ),
                onTap: () {
                  Navigator.pop(context);
                  _pickImage(ImageSource.camera);
                },
              ),
              if (_localAvatar != null)
                ListTile(
                  leading: const Icon(Icons.delete, color: Colors.red),
                  title: const Text(
                    'حذف الصورة',
                    style: TextStyle(color: Colors.white),
                  ),
                  onTap: () {
                    Navigator.pop(context);
                    _removeAvatar();
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }

  Future<bool?> _showTwoFactorSetupDialog() {
    return showDialog<bool>(
      context: context,
      builder: (context) => Dialog(
        backgroundColor: Colors.transparent,
        child: _buildGlassCard(
          child: Container(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.security, size: 64, color: Colors.green),
                const SizedBox(height: 16),
                const Text(
                  'تفعيل المصادقة الثنائية',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  'سيضيف هذا طبقة أمان إضافية لحسابك. ستحتاج لرمز من تطبيق المصادقة عند تسجيل الدخول.',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.8)),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                Row(
                  children: [
                    Expanded(
                      child: TextButton(
                        onPressed: () => Navigator.pop(context, false),
                        child: const Text('إلغاء'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: ElevatedButton(
                        onPressed: () => Navigator.pop(context, true),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.green,
                          foregroundColor: Colors.white,
                        ),
                        child: const Text('تفعيل'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<bool?> _showConfirmationDialog(String title, String message) {
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.grey[900],
        title: Text(title, style: const TextStyle(color: Colors.white)),
        content: Text(message, style: const TextStyle(color: Colors.white70)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('موافق', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
  }

  void _showChangePasswordDialog() {
    // تنفيذ حوار تغيير كلمة المرور
    showDialog(context: context, builder: (context) => _ChangePasswordDialog());
  }

  void _showActiveSessionsDialog() {
    // تنفيذ حوار الجلسات النشطة
    showDialog(context: context, builder: (context) => _ActiveSessionsDialog());
  }

  String _selectedLanguage = 'ar';

  Widget _buildLanguageSelector() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textColor = isDark ? Colors.white : const Color(0xFF1A2027);
    final containerColor = isDark
        ? Colors.white.withValues(alpha: 0.05)
        : Colors.black.withValues(alpha: 0.05);
    final borderColor = isDark
        ? Colors.white.withValues(alpha: 0.1)
        : Colors.black.withValues(alpha: 0.1);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: containerColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.blue.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(Icons.language, color: Colors.blue, size: 20),
              ),
              const SizedBox(width: 12),
              Text(
                'اللغة',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: textColor,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(child: _buildLanguageOption('ar', 'العربية', '🌐')),
              const SizedBox(width: 12),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildLanguageOption(String code, String name, String flag) {
    final isSelected = _selectedLanguage == code;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textColor = isDark ? Colors.white : const Color(0xFF1A2027);
    final secondaryColor = isDark ? Colors.white70 : const Color(0xFF6B7280);
    final unselectedBg = isDark
        ? Colors.white.withValues(alpha: 0.05)
        : Colors.black.withValues(alpha: 0.05);
    final unselectedBorder = isDark
        ? Colors.white.withValues(alpha: 0.1)
        : Colors.black.withValues(alpha: 0.1);

    return InkWell(
      onTap: () async {
        setState(() => _selectedLanguage = code);
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('app_language', code);

        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تم تغيير اللغة إلى العربية'),
            backgroundColor: Colors.green,
          ),
        );
      },
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 12),
        decoration: BoxDecoration(
          color: isSelected
              ? AppTheme.primaryColor.withValues(alpha: 0.3)
              : unselectedBg,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? AppTheme.primaryColor : unselectedBorder,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(flag, style: const TextStyle(fontSize: 20)),
            const SizedBox(width: 8),
            Text(
              name,
              style: TextStyle(
                fontSize: 14,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                color: isSelected ? textColor : secondaryColor,
              ),
            ),
            if (isSelected) ...[
              const SizedBox(width: 8),
              const Icon(Icons.check_circle, color: Colors.green, size: 18),
            ],
          ],
        ),
      ),
    );
  }

  void _showAboutDialog() {
    showAboutDialog(
      context: context,
      applicationName: 'Remot Security',
      applicationVersion: '1.0.0',
      applicationIcon: const Icon(Icons.security, size: 48),
      children: [
        const Text('نظام مراقبة وحماية الأجهزة المتقدم'),
        const SizedBox(height: 8),
        const Text('تم التطوير بواسطة فريق الأمان الرقمي'),
      ],
    );
  }

  Future<void> _removeAvatar() async {
    try {
      final directory = await getApplicationDocumentsDirectory();
      final avatarPath = '${directory.path}/user_avatar.jpg';
      final avatarFile = File(avatarPath);

      if (await avatarFile.exists()) {
        await avatarFile.delete();
        setState(() {
          _localAvatar = null;
        });

        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تم حذف الصورة'),
            backgroundColor: Colors.orange,
          ),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('خطأ في حذف الصورة: $e'),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  void _logout() async {
    final confirmed = await _showConfirmationDialog(
      'تسجيل الخروج',
      'هل أنت متأكد من تسجيل الخروج؟',
    );

    if (confirmed == true) {
      final authProvider = Provider.of<AuthProvider>(context, listen: false);
      await authProvider.logout();

      if (context.mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const LoginScreen()),
        );
      }
    }
  }
}

// حوار تغيير كلمة المرور
class _ChangePasswordDialog extends StatefulWidget {
  @override
  State<_ChangePasswordDialog> createState() => _ChangePasswordDialogState();
}

class _ChangePasswordDialogState extends State<_ChangePasswordDialog> {
  final _formKey = GlobalKey<FormState>();
  final _currentPasswordController = TextEditingController();
  final _newPasswordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _isLoading = false;

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
            child: Container(
              padding: const EdgeInsets.all(24),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text(
                      'تغيير كلمة المرور',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 20),
                    _buildPasswordField(
                      controller: _currentPasswordController,
                      label: 'كلمة المرور الحالية',
                      validator: (value) =>
                          value?.isEmpty == true ? 'مطلوب' : null,
                    ),
                    const SizedBox(height: 16),
                    _buildPasswordField(
                      controller: _newPasswordController,
                      label: 'كلمة المرور الجديدة',
                      validator: (value) {
                        if (value?.isEmpty == true) return 'مطلوب';
                        if (value!.length < 6)
                          return 'يجب أن تكون 6 أحرف على الأقل';
                        return null;
                      },
                    ),
                    const SizedBox(height: 16),
                    _buildPasswordField(
                      controller: _confirmPasswordController,
                      label: 'تأكيد كلمة المرور',
                      validator: (value) {
                        if (value?.isEmpty == true) return 'مطلوب';
                        if (value != _newPasswordController.text) {
                          return 'كلمات المرور غير متطابقة';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 24),
                    Row(
                      children: [
                        Expanded(
                          child: TextButton(
                            onPressed: () => Navigator.pop(context),
                            child: const Text('إلغاء'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: ElevatedButton(
                            onPressed: _isLoading ? null : _changePassword,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppTheme.primaryColor,
                              foregroundColor: Colors.white,
                            ),
                            child: _isLoading
                                ? const CircularProgressIndicator()
                                : const Text('تغيير'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPasswordField({
    required TextEditingController controller,
    required String label,
    String? Function(String?)? validator,
  }) {
    return TextFormField(
      controller: controller,
      validator: validator,
      obscureText: true,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: TextStyle(color: Colors.white.withValues(alpha: 0.7)),
        border: OutlineInputBorder(
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.3)),
        ),
        enabledBorder: OutlineInputBorder(
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.3)),
        ),
        focusedBorder: OutlineInputBorder(
          borderSide: BorderSide(color: AppTheme.primaryColor),
        ),
      ),
    );
  }

  Future<void> _changePassword() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);

    try {
      // تنفيذ تغيير كلمة المرور عبر API
      final result = await ApiService.changePassword(
        _currentPasswordController.text,
        _newPasswordController.text,
      );

      if (result['success'] == true) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(result['message'] ?? 'تم تغيير كلمة المرور بنجاح'),
            backgroundColor: Colors.green,
          ),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(result['error'] ?? 'فشل في تغيير كلمة المرور'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('فشل في تغيير كلمة المرور: $e'),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      setState(() => _isLoading = false);
    }
  }
}

// حوار الجلسات النشطة
class _ActiveSessionsDialog extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final sessions = [
      {
        'device': 'iPhone 12',
        'location': 'بغداد، العراق',
        'time': 'نشط الآن',
        'current': true,
      },
      {
        'device': 'Chrome على Windows',
        'location': 'بغداد، العراق',
        'time': 'منذ ساعتين',
        'current': false,
      },
      {
        'device': 'Safari على iPad',
        'location': 'البصرة، العراق',
        'time': 'منذ يومين',
        'current': false,
      },
    ];

    return Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
            child: Container(
              padding: const EdgeInsets.all(24),
              width: double.maxFinite,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.devices, color: Colors.blue, size: 28),
                      const SizedBox(width: 12),
                      const Expanded(
                        child: Text(
                          'الجلسات النشطة',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                          ),
                        ),
                      ),
                      IconButton(
                        onPressed: () => Navigator.pop(context),
                        icon: const Icon(Icons.close, color: Colors.white),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  ...sessions.map((session) {
                    return Container(
                      margin: const EdgeInsets.only(bottom: 12),
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.05),
                        borderRadius: BorderRadius.circular(12),
                        border: session['current'] as bool
                            ? Border.all(
                                color: Colors.green.withValues(alpha: 0.5),
                              )
                            : null,
                      ),
                      child: Row(
                        children: [
                          Icon(
                            _getDeviceIcon(session['device'] as String),
                            color: session['current'] as bool
                                ? Colors.green
                                : Colors.white.withValues(alpha: 0.7),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Text(
                                      session['device'] as String,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                        color: Colors.white,
                                      ),
                                    ),
                                    if (session['current'] as bool) ...[
                                      const SizedBox(width: 8),
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 6,
                                          vertical: 2,
                                        ),
                                        decoration: BoxDecoration(
                                          color: Colors.green.withValues(
                                            alpha: 0.2,
                                          ),
                                          borderRadius: BorderRadius.circular(
                                            4,
                                          ),
                                        ),
                                        child: const Text(
                                          'الحالي',
                                          style: TextStyle(
                                            fontSize: 10,
                                            color: Colors.green,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                                Text(
                                  '${session['location']} • ${session['time']}',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: Colors.white.withValues(alpha: 0.6),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          if (!(session['current'] as bool))
                            TextButton(
                              onPressed: () {
                                // تنفيذ إنهاء الجلسة
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text('تم إنهاء الجلسة'),
                                  ),
                                );
                              },
                              child: const Text(
                                'إنهاء',
                                style: TextStyle(color: Colors.red),
                              ),
                            ),
                        ],
                      ),
                    );
                  }),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  IconData _getDeviceIcon(String device) {
    if (device.toLowerCase().contains('iphone') ||
        device.toLowerCase().contains('ios')) {
      return Icons.phone_iphone;
    } else if (device.toLowerCase().contains('android')) {
      return Icons.phone_android;
    } else if (device.toLowerCase().contains('ipad')) {
      return Icons.tablet_mac;
    } else if (device.toLowerCase().contains('chrome') ||
        device.toLowerCase().contains('safari')) {
      return Icons.computer;
    }
    return Icons.device_unknown;
  }
}
