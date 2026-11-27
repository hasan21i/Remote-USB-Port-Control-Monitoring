import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:ui';
import '../config/app_theme.dart';
import '../providers/theme_provider.dart';

/// شاشة الإعدادات مع تصميم زجاجي
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;

  // إعدادات التطبيق
  bool _darkMode = true;
  bool _notifications = true;
  bool _autoRefresh = true;
  bool _soundEffects = true;
  String _language = 'ar';
  String _refreshInterval = '30';

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

    _loadSettings();
    _animationController.forward();
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _darkMode = prefs.getBool('dark_mode') ?? true;
      _notifications = prefs.getBool('notifications') ?? true;
      _autoRefresh = prefs.getBool('auto_refresh') ?? true;
      _soundEffects = prefs.getBool('sound_effects') ?? true;
      _language = prefs.getString('language') ?? 'ar';
      _refreshInterval = prefs.getString('refresh_interval') ?? '30';
    });
  }

  Future<void> _saveSettings() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('dark_mode', _darkMode);
    await prefs.setBool('notifications', _notifications);
    await prefs.setBool('auto_refresh', _autoRefresh);
    await prefs.setBool('sound_effects', _soundEffects);
    await prefs.setString('language', _language);
    await prefs.setString('refresh_interval', _refreshInterval);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF0F1419), Color(0xFF1A1E29), Color(0xFF0F1419)],
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
                        _buildAppearanceSection(),
                        const SizedBox(height: 24),
                        _buildNotificationSection(),
                        const SizedBox(height: 24),
                        _buildPerformanceSection(),
                        const SizedBox(height: 24),
                        _buildLanguageSection(),
                        const SizedBox(height: 24),
                        _buildAdvancedSection(),
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
    return Container(
      height: height,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.1),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.2),
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
      leading: IconButton(
        onPressed: () => Navigator.pop(context),
        icon: _buildGlassCard(
          child: Container(
            padding: const EdgeInsets.all(8),
            child: const Icon(Icons.arrow_back, color: Colors.white, size: 20),
          ),
        ),
      ),
      title: _buildGlassCard(
        child: Container(
          padding: const EdgeInsets.all(12),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.settings,
                color: Colors.white.withValues(alpha: 0.9),
                size: 20,
              ),
              const SizedBox(width: 8),
              const Text(
                'الإعدادات',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
            ],
          ),
        ),
      ),
      centerTitle: true,
    );
  }

  Widget _buildAppearanceSection() {
    return _buildGlassCard(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSectionHeader('المظهر', Icons.palette, Colors.purple),
            const SizedBox(height: 20),
            Consumer<ThemeProvider>(
              builder: (context, themeProvider, _) {
                return _buildSettingTile(
                  title: 'المظهر المظلم',
                  subtitle: 'استخدام الألوان المظلمة',
                  icon: Icons.dark_mode,
                  trailing: Switch(
                    value: themeProvider.isDarkMode,
                    onChanged: (value) {
                      themeProvider.toggleTheme();
                      setState(() => _darkMode = value);
                      _saveSettings();
                    },
                    activeThumbColor: Colors.purple,
                  ),
                );
              },
            ),
            const SizedBox(height: 12),
            _buildSettingTile(
              title: 'التأثيرات الصوتية',
              subtitle: 'تشغيل أصوات التفاعل',
              icon: Icons.volume_up,
              trailing: Switch(
                value: _soundEffects,
                onChanged: (value) {
                  setState(() => _soundEffects = value);
                  _saveSettings();
                },
                activeThumbColor: Colors.purple,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNotificationSection() {
    return _buildGlassCard(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSectionHeader(
              'الإشعارات',
              Icons.notifications,
              Colors.orange,
            ),
            const SizedBox(height: 20),
            _buildSettingTile(
              title: 'إشعارات التطبيق',
              subtitle: 'استقبال التنبيهات والإشعارات',
              icon: Icons.notifications_active,
              trailing: Switch(
                value: _notifications,
                onChanged: (value) {
                  setState(() => _notifications = value);
                  _saveSettings();
                },
                activeThumbColor: Colors.orange,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPerformanceSection() {
    return _buildGlassCard(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSectionHeader('الأداء', Icons.speed, Colors.green),
            const SizedBox(height: 20),
            _buildSettingTile(
              title: 'التحديث التلقائي',
              subtitle: 'تحديث البيانات تلقائياً',
              icon: Icons.refresh,
              trailing: Switch(
                value: _autoRefresh,
                onChanged: (value) {
                  setState(() => _autoRefresh = value);
                  _saveSettings();
                },
                activeThumbColor: Colors.green,
              ),
            ),
            if (_autoRefresh) ...[
              const SizedBox(height: 12),
              _buildSettingTile(
                title: 'فترة التحديث',
                subtitle: '$_refreshInterval ثانية',
                icon: Icons.timer,
                onTap: _showRefreshIntervalDialog,
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildLanguageSection() {
    return _buildGlassCard(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSectionHeader('اللغة والمنطقة', Icons.language, Colors.blue),
            const SizedBox(height: 20),
            _buildSettingTile(
              title: 'اللغة',
              subtitle: 'العربية',
              icon: Icons.translate,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAdvancedSection() {
    return _buildGlassCard(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSectionHeader('إعدادات متقدمة', Icons.build, Colors.red),
            const SizedBox(height: 20),
            _buildSettingTile(
              title: 'مسح ذاكرة التخزين المؤقت',
              subtitle: 'حذف البيانات المؤقتة',
              icon: Icons.cleaning_services,
              onTap: _showClearCacheDialog,
            ),
            const SizedBox(height: 12),
            _buildSettingTile(
              title: 'إعادة تعيين الإعدادات',
              subtitle: 'استعادة الإعدادات الافتراضية',
              icon: Icons.settings_backup_restore,
              onTap: _showResetSettingsDialog,
            ),
            const SizedBox(height: 12),
            _buildSettingTile(
              title: 'معلومات التطبيق',
              subtitle: 'الإصدار 1.0.0',
              icon: Icons.info,
              onTap: _showAppInfoDialog,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader(String title, IconData icon, Color color) {
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.2),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(icon, color: color, size: 20),
        ),
        const SizedBox(width: 12),
        Text(
          title,
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: Colors.white,
          ),
        ),
      ],
    );
  }

  Widget _buildSettingTile({
    required String title,
    required String subtitle,
    required IconData icon,
    Widget? trailing,
    VoidCallback? onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.03),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white.withValues(alpha: 0.05)),
        ),
        child: Row(
          children: [
            Icon(icon, color: Colors.white.withValues(alpha: 0.8), size: 24),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: 14,
                      color: Colors.white.withValues(alpha: 0.6),
                    ),
                  ),
                ],
              ),
            ),
            if (trailing != null)
              trailing
            else if (onTap != null)
              Icon(
                Icons.chevron_right,
                color: Colors.white.withValues(alpha: 0.5),
              ),
          ],
        ),
      ),
    );
  }

  void _showLanguageDialog() {
    // اللغة العربية هي الافتراضية ولا يمكن تغييرها في هذه النسخة
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E2E),
        title: const Text('اللغة', style: TextStyle(color: Colors.white)),
        content: const Text(
          'اللغة العربية هي الافتراضية ولا يمكن تغييرها في هذه النسخة.',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('حسنًا'),
          ),
        ],
      ),
    );
  }

  Widget _buildLanguageOption(String code, String name, IconData icon) {
    final isSelected = _language == code;
    return InkWell(
      onTap: () {
        setState(() => _language = code);
        _saveSettings();
        Navigator.pop(context);
      },
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isSelected
              ? Colors.blue.withValues(alpha: 0.2)
              : Colors.white.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected
                ? Colors.blue.withValues(alpha: 0.3)
                : Colors.white.withValues(alpha: 0.1),
          ),
        ),
        child: Row(
          children: [
            Icon(icon, color: Colors.white, size: 24),
            const SizedBox(width: 16),
            Text(
              name,
              style: const TextStyle(fontSize: 16, color: Colors.white),
            ),
            const Spacer(),
            if (isSelected) const Icon(Icons.check, color: Colors.blue),
          ],
        ),
      ),
    );
  }

  void _showRefreshIntervalDialog() {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        backgroundColor: Colors.transparent,
        child: _buildGlassCard(
          child: Container(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'فترة التحديث',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 20),
                ...['15', '30', '60', '120'].map((interval) {
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: _buildIntervalOption(interval),
                  );
                }),
                const SizedBox(height: 20),
                Row(
                  children: [
                    Expanded(
                      child: TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: const Text('إلغاء'),
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

  Widget _buildIntervalOption(String interval) {
    final isSelected = _refreshInterval == interval;
    return InkWell(
      onTap: () {
        setState(() => _refreshInterval = interval);
        _saveSettings();
        Navigator.pop(context);
      },
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isSelected
              ? Colors.green.withValues(alpha: 0.2)
              : Colors.white.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected
                ? Colors.green.withValues(alpha: 0.3)
                : Colors.white.withValues(alpha: 0.1),
          ),
        ),
        child: Row(
          children: [
            const Icon(Icons.timer, color: Colors.white, size: 24),
            const SizedBox(width: 16),
            Text(
              '$interval ثانية',
              style: const TextStyle(fontSize: 16, color: Colors.white),
            ),
            const Spacer(),
            if (isSelected) const Icon(Icons.check, color: Colors.green),
          ],
        ),
      ),
    );
  }

  void _showClearCacheDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.grey[900],
        title: const Text(
          'مسح ذاكرة التخزين المؤقت',
          style: TextStyle(color: Colors.white),
        ),
        content: const Text(
          'هل تريد مسح جميع البيانات المؤقتة؟ لن يؤثر هذا على إعداداتك.',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('إلغاء'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('تم مسح ذاكرة التخزين المؤقت'),
                  backgroundColor: Colors.green,
                ),
              );
            },
            child: const Text('مسح', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
  }

  void _showResetSettingsDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.grey[900],
        title: const Text(
          'إعادة تعيين الإعدادات',
          style: TextStyle(color: Colors.white),
        ),
        content: const Text(
          'هل تريد استعادة جميع الإعدادات إلى القيم الافتراضية؟',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('إلغاء'),
          ),
          TextButton(
            onPressed: () async {
              final prefs = await SharedPreferences.getInstance();
              await prefs.clear();
              setState(() {
                _darkMode = true;
                _notifications = true;
                _autoRefresh = true;
                _soundEffects = true;
                _language = 'ar';
                _refreshInterval = '30';
              });
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('تم إعادة تعيين الإعدادات'),
                  backgroundColor: Colors.green,
                ),
              );
            },
            child: const Text(
              'إعادة تعيين',
              style: TextStyle(color: Colors.red),
            ),
          ),
        ],
      ),
    );
  }

  void _showAppInfoDialog() {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        backgroundColor: Colors.transparent,
        child: _buildGlassCard(
          child: Container(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 80,
                  height: 80,
                  decoration: BoxDecoration(
                    color: AppTheme.primaryColor.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Icon(
                    Icons.admin_panel_settings,
                    size: 40,
                    color: AppTheme.primaryColor,
                  ),
                ),
                const SizedBox(height: 16),
                const Text(
                  'Remot Admin',
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'الإصدار 1.0.0',
                  style: TextStyle(fontSize: 16, color: Colors.white70),
                ),
                const SizedBox(height: 16),
                const Text(
                  'تطبيق إدارة ومراقبة الأجهزة والشبكات بتقنيات حديثة وآمنة.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 14, color: Colors.white60),
                ),
                const SizedBox(height: 24),
                ElevatedButton(
                  onPressed: () => Navigator.pop(context),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primaryColor,
                    foregroundColor: Colors.white,
                  ),
                  child: const Text('موافق'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
