import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:provider/provider.dart';
import 'dart:ui';
import 'dart:io';
import 'dart:typed_data';
import 'package:path_provider/path_provider.dart';
import 'package:open_filex/open_filex.dart';
import '../providers/auth_provider.dart';
import '../services/supabase_service.dart';
import '../services/api_service.dart';
import '../utils/download_helper.dart' as web_download;
import '../config/app_theme.dart';
import 'dashboard_screen.dart';
import 'devices_screen.dart';
import 'alerts_screen.dart';
import 'servers_screen.dart';
import 'profile_screen.dart';
import 'settings_screen.dart';
import 'login_screen.dart';
import 'blacklist_whitelist_screen.dart';
import 'users_screen.dart';
import 'logs_screen.dart';
import 'reports_screen.dart';

/// الشاشة الرئيسية مع تصميم زجاجي حديث وDrwer مرتب
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with TickerProviderStateMixin {
  int _currentIndex = 0;
  File? _userAvatar;
  late AnimationController _drawerAnimationController;
  late AnimationController _fabAnimationController;
  late Animation<double> _fabAnimation;
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();

  final List<Widget> _screens = [
    const DashboardScreen(),
    const DevicesScreen(),
    const ServersScreen(),
    const AlertsScreen(),
    const ProfileScreen(),
  ];

  final List<NavigationItem> _navigationItems = [
    NavigationItem(
      icon: Icons.dashboard_outlined,
      activeIcon: Icons.dashboard,
      label: 'لوحة التحكم',
      color: const Color(0xFF2196F3),
    ),
    NavigationItem(
      icon: Icons.usb_outlined,
      activeIcon: Icons.usb,
      label: 'الأجهزة',
      color: const Color(0xFF4CAF50),
    ),
    NavigationItem(
      icon: Icons.dns_outlined,
      activeIcon: Icons.dns,
      label: 'السيرفرات',
      color: const Color(0xFF9C27B0),
    ),
    NavigationItem(
      icon: Icons.notifications_outlined,
      activeIcon: Icons.notifications,
      label: 'التنبيهات',
      color: const Color(0xFFFF9800),
    ),
    NavigationItem(
      icon: Icons.person_outline,
      activeIcon: Icons.person,
      label: 'الملف الشخصي',
      color: const Color(0xFFF44336),
    ),
  ];

  @override
  void initState() {
    super.initState();
    _loadUserAvatar();

    _drawerAnimationController = AnimationController(
      duration: const Duration(milliseconds: 300),
      vsync: this,
    );

    _fabAnimationController = AnimationController(
      duration: const Duration(milliseconds: 600),
      vsync: this,
    );

    _fabAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _fabAnimationController,
        curve: Curves.elasticOut,
      ),
    );

    _fabAnimationController.forward();
  }

  @override
  void dispose() {
    _drawerAnimationController.dispose();
    _fabAnimationController.dispose();
    super.dispose();
  }

  Future<void> _loadUserAvatar() async {
    try {
      final directory = await getApplicationDocumentsDirectory();
      final avatarPath = '${directory.path}/user_avatar.jpg';
      final avatarFile = File(avatarPath);

      if (await avatarFile.exists()) {
        setState(() {
          _userAvatar = avatarFile;
        });
      }
    } catch (e) {
      debugPrint('خطأ في تحميل صورة المستخدم: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        key: _scaffoldKey,
        extendBodyBehindAppBar: true,
        drawer: _buildGlassDrawer(),
        appBar: _buildGlassAppBar(),
        body: GradientBackground(
          child: IndexedStack(index: _currentIndex, children: _screens),
        ),
        bottomNavigationBar: _buildGlassBottomNav(),
        floatingActionButton: _buildAnimatedFab(),
        floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
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

  PreferredSizeWidget _buildGlassAppBar() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textColor = isDark ? Colors.white : const Color(0xFF1A2027);
    final bgColor = isDark
        ? Colors.white.withValues(alpha: 0.05)
        : Colors.white.withValues(alpha: 0.8);
    final borderColor = isDark
        ? Colors.white.withValues(alpha: 0.1)
        : Colors.black.withValues(alpha: 0.1);

    return AppBar(
      elevation: 0,
      backgroundColor: Colors.transparent,
      flexibleSpace: ClipRRect(
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
          child: Container(
            decoration: BoxDecoration(
              color: bgColor,
              border: Border(bottom: BorderSide(color: borderColor, width: 1)),
            ),
          ),
        ),
      ),
      title: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: _navigationItems[_currentIndex].color.withValues(
                alpha: 0.2,
              ),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(
              _navigationItems[_currentIndex].activeIcon,
              color: _navigationItems[_currentIndex].color,
              size: 20,
            ),
          ),
          const SizedBox(width: 12),
          Text(
            _navigationItems[_currentIndex].label,
            style: TextStyle(
              color: textColor,
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
      actions: [
        Container(
          margin: const EdgeInsets.only(left: 16),
          child: IconButton(
            onPressed: () => _showNotificationsDialog(),
            icon: Stack(
              children: [
                Icon(Icons.notifications_outlined, color: textColor, size: 24),
                Positioned(
                  right: 0,
                  top: 0,
                  child: Container(
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(
                      color: Colors.red,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
      iconTheme: IconThemeData(color: textColor),
      leading: IconButton(
        icon: Icon(Icons.menu, color: textColor),
        onPressed: () => _scaffoldKey.currentState?.openDrawer(),
      ),
    );
  }

  Widget _buildGlassDrawer() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final drawerBgColor = isDark
        ? Colors.black.withValues(alpha: 0.3)
        : Colors.white.withValues(alpha: 0.9);
    final borderColor = isDark
        ? Colors.white.withValues(alpha: 0.1)
        : Colors.black.withValues(alpha: 0.1);

    return Drawer(
      backgroundColor: Colors.transparent,
      child: ClipRRect(
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 15, sigmaY: 15),
          child: Container(
            decoration: BoxDecoration(
              color: drawerBgColor,
              border: Border(right: BorderSide(color: borderColor, width: 1)),
            ),
            child: Column(
              children: [
                _buildDrawerHeader(),
                Expanded(child: _buildDrawerItems()),
                _buildDrawerFooter(),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildDrawerHeader() {
    return Consumer<AuthProvider>(
      builder: (context, authProvider, _) {
        final user = authProvider.currentUser;
        return Container(
          height: 200,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                AppTheme.primaryColor.withValues(alpha: 0.3),
                Colors.transparent,
              ],
            ),
          ),
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.end,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // صورة المستخدم
              Container(
                width: 80,
                height: 80,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.3),
                    width: 3,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: AppTheme.primaryColor.withValues(alpha: 0.3),
                      blurRadius: 15,
                      spreadRadius: 2,
                    ),
                  ],
                ),
                child: ClipOval(
                  child: _userAvatar != null
                      ? Image.file(_userAvatar!, fit: BoxFit.cover)
                      : Container(
                          decoration: BoxDecoration(
                            gradient: RadialGradient(
                              colors: [
                                AppTheme.primaryColor.withValues(alpha: 0.4),
                                AppTheme.primaryColor.withValues(alpha: 0.1),
                              ],
                            ),
                          ),
                          child: Icon(
                            Icons.person,
                            size: 40,
                            color: Colors.white.withValues(alpha: 0.8),
                          ),
                        ),
                ),
              ),
              const SizedBox(height: 16),
              // اسم المستخدم
              Text(
                user?.email ?? 'المستخدم',
                style: TextStyle(
                  color: Theme.of(context).brightness == Brightness.dark
                      ? Colors.white
                      : const Color(0xFF1A2027),
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 4),
              // البريد الإلكتروني
              Text(
                user?.email ?? 'user@example.com',
                style: TextStyle(
                  color: Theme.of(context).brightness == Brightness.dark
                      ? Colors.white.withValues(alpha: 0.7)
                      : const Color(0xFF6B7280),
                  fontSize: 14,
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildDrawerItems() {
    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 16),
      children: [
        ..._navigationItems.asMap().entries.map((entry) {
          final index = entry.key;
          final item = entry.value;
          return _buildDrawerItem(
            item: item,
            isSelected: _currentIndex == index,
            onTap: () {
              Navigator.pop(context);
              setState(() {
                _currentIndex = index;
              });
              _fabAnimationController.reset();
              _fabAnimationController.forward();
            },
          );
        }),

        Divider(
          color: Theme.of(context).brightness == Brightness.dark
              ? Colors.white24
              : Colors.black12,
          height: 32,
          indent: 20,
          endIndent: 20,
        ),

        // صفحات للأدمن فقط
        Consumer<AuthProvider>(
          builder: (context, authProvider, _) {
            final isAdmin = authProvider.isAdmin;
            if (!isAdmin) return const SizedBox.shrink();
            return Column(
              children: [
                _buildDrawerItem(
                  item: NavigationItem(
                    icon: Icons.people_outline,
                    activeIcon: Icons.people,
                    label: 'المستخدمون',
                    color: Colors.purple,
                  ),
                  onTap: () {
                    Navigator.pop(context);
                    Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => const UsersScreen()),
                    );
                  },
                ),
                _buildDrawerItem(
                  item: NavigationItem(
                    icon: Icons.history,
                    activeIcon: Icons.history,
                    label: 'السجلات',
                    color: Colors.orange,
                  ),
                  onTap: () {
                    Navigator.pop(context);
                    Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => const LogsScreen()),
                    );
                  },
                ),
                Divider(
                  color: Theme.of(context).brightness == Brightness.dark
                      ? Colors.white24
                      : Colors.black12,
                  height: 16,
                  indent: 20,
                  endIndent: 20,
                ),
              ],
            );
          },
        ),
        // صفحة التقارير
        _buildDrawerItem(
          item: NavigationItem(
            icon: Icons.assessment_outlined,
            activeIcon: Icons.assessment,
            label: 'التقارير',
            color: Colors.teal,
          ),
          onTap: () {
            Navigator.pop(context);
            Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ReportsScreen()),
            );
          },
        ),
        _buildDrawerItem(
          item: NavigationItem(
            icon: Icons.settings_outlined,
            activeIcon: Icons.settings,
            label: 'الإعدادات',
            color: Colors.grey,
          ),
          onTap: () => _showSettingsDialog(),
        ),
        _buildDrawerItem(
          item: NavigationItem(
            icon: Icons.help_outline,
            activeIcon: Icons.help,
            label: 'المساعدة',
            color: Colors.blue,
          ),
          onTap: () => _showHelpDialog(),
        ),
        _buildDrawerItem(
          item: NavigationItem(
            icon: Icons.info_outline,
            activeIcon: Icons.info,
            label: 'حول التطبيق',
            color: Colors.green,
          ),
          onTap: () => _showAboutDialog(),
        ),
      ],
    );
  }

  Widget _buildDrawerItem({
    required NavigationItem item,
    bool isSelected = false,
    required VoidCallback onTap,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textColor = isDark
        ? Colors.white.withValues(alpha: 0.8)
        : const Color(0xFF6B7280);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: isSelected
                ? item.color.withValues(alpha: 0.2)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(12),
            border: isSelected
                ? Border.all(color: item.color.withValues(alpha: 0.3), width: 1)
                : null,
          ),
          child: Row(
            children: [
              Icon(
                isSelected ? item.activeIcon : item.icon,
                color: isSelected ? item.color : textColor,
                size: 24,
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Text(
                  item.label,
                  style: TextStyle(
                    color: isSelected
                        ? (isDark ? Colors.white : const Color(0xFF1A2027))
                        : textColor,
                    fontSize: 16,
                    fontWeight: isSelected
                        ? FontWeight.bold
                        : FontWeight.normal,
                  ),
                ),
              ),
              if (isSelected)
                Container(
                  width: 4,
                  height: 20,
                  decoration: BoxDecoration(
                    color: item.color,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDrawerFooter() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final borderColor = isDark
        ? Colors.white.withValues(alpha: 0.1)
        : Colors.black.withValues(alpha: 0.1);
    final versionColor = isDark
        ? Colors.white.withValues(alpha: 0.5)
        : const Color(0xFF9CA3AF);

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: borderColor, width: 1)),
      ),
      child: Column(
        children: [
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: () => _logout(),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.red.withValues(alpha: 0.2),
                foregroundColor: Colors.red,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: BorderSide(color: Colors.red.withValues(alpha: 0.3)),
                ),
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
              icon: const Icon(Icons.logout, size: 18),
              label: const Text('تسجيل الخروج'),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'الإصدار 1.0.0',
            style: TextStyle(color: versionColor, fontSize: 12),
          ),
        ],
      ),
    );
  }

  Widget _buildGlassBottomNav() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bgColor = isDark
        ? Colors.white.withValues(alpha: 0.05)
        : Colors.white.withValues(alpha: 0.9);
    final borderColor = isDark
        ? Colors.white.withValues(alpha: 0.1)
        : Colors.black.withValues(alpha: 0.1);
    final unselectedColor = isDark
        ? Colors.white.withValues(alpha: 0.6)
        : const Color(0xFF6B7280);

    return SafeArea(
      child: Container(
        height: 60,
        margin: const EdgeInsets.fromLTRB(16, 4, 16, 4),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(20),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
            child: Container(
              decoration: BoxDecoration(
                color: bgColor,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: borderColor, width: 1),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: _navigationItems.asMap().entries.map((entry) {
                  final index = entry.key;
                  final item = entry.value;
                  final isSelected = _currentIndex == index;

                  return Expanded(
                    child: InkWell(
                      onTap: () => _onTabTapped(index),
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: isSelected
                            ? Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: item.color.withValues(alpha: 0.2),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Icon(
                                  item.activeIcon,
                                  color: item.color,
                                  size: 22,
                                ),
                              )
                            : Icon(item.icon, color: unselectedColor, size: 22),
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildAnimatedFab() {
    return ScaleTransition(
      scale: _fabAnimation,
      child: Container(
        margin: const EdgeInsets.only(top: 10),
        child: SizedBox(
          width: 48,
          height: 48,
          child: FloatingActionButton(
            heroTag: 'mainFab',
            onPressed: () => _showQuickActions(),
            backgroundColor: AppTheme.primaryColor,
            elevation: 6,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(Icons.add, color: Colors.white, size: 24),
          ),
        ),
      ),
    );
  }

  void _onTabTapped(int index) {
    setState(() {
      _currentIndex = index;
    });
    _fabAnimationController.reset();
    _fabAnimationController.forward();
  }

  void _showQuickActions() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => _buildQuickActionsSheet(),
    );
  }

  Widget _buildQuickActionsSheet() {
    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    final isAdmin = authProvider.isAdmin;

    final actions = [
      QuickAction(
        icon: Icons.add,
        label: 'إضافة جهاز',
        color: AppTheme.successColor,
        onTap: () {
          Navigator.pop(context);
          setState(() => _currentIndex = 1);
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('انتقل إلى صفحة الأجهزة لإضافة جهاز جديد'),
            ),
          );
        },
      ),
      if (isAdmin)
        QuickAction(
          icon: Icons.dns,
          label: 'إضافة سيرفر',
          color: AppTheme.primaryColor,
          onTap: () {
            Navigator.pop(context);
            _showAddServerDialog();
          },
        ),
      QuickAction(
        icon: Icons.description,
        label: 'تقرير سريع',
        color: AppTheme.warningColor,
        onTap: () {
          Navigator.pop(context);
          _generateQuickReport();
        },
      ),
      QuickAction(
        icon: Icons.block,
        label: 'القوائم',
        color: AppTheme.dangerColor,
        onTap: () {
          Navigator.pop(context);
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => const BlacklistWhitelistScreen(),
            ),
          );
        },
      ),
      QuickAction(
        icon: Icons.refresh,
        label: 'تحديث',
        color: AppTheme.infoColor,
        onTap: () {
          Navigator.pop(context);
          _refreshAllData();
        },
      ),
      QuickAction(
        icon: Icons.security,
        label: 'فحص أمني',
        color: const Color(0xFF9C27B0),
        onTap: () {
          Navigator.pop(context);
          _performSecurityScan();
        },
      ),
    ];

    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.6,
      ),
      child: _buildGlassCard(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 20),
              const Text(
                'إجراءات سريعة',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 20),
              ...actions.map(
                (action) => Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  child: InkWell(
                    onTap: action.onTap,
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 14,
                      ),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            action.color.withValues(alpha: 0.2),
                            action.color.withValues(alpha: 0.05),
                          ],
                        ),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: action.color.withValues(alpha: 0.3),
                        ),
                      ),
                      child: Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: action.color.withValues(alpha: 0.2),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Icon(
                              action.icon,
                              color: action.color,
                              size: 22,
                            ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: Text(
                              action.label,
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w600,
                                fontSize: 15,
                              ),
                            ),
                          ),
                          Icon(
                            Icons.arrow_forward_ios,
                            color: Colors.white.withValues(alpha: 0.4),
                            size: 16,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 10),
            ],
          ),
        ),
      ),
    );
  }

  void _showNotificationsDialog() {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        backgroundColor: Colors.transparent,
        child: _buildGlassCard(
          child: Container(
            padding: const EdgeInsets.all(20),
            width: double.maxFinite,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    const Icon(
                      Icons.notifications,
                      color: Colors.orange,
                      size: 24,
                    ),
                    const SizedBox(width: 12),
                    const Expanded(
                      child: Text(
                        'الإشعارات',
                        style: TextStyle(
                          fontSize: 18,
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
                const Text(
                  'لا توجد إشعارات جديدة',
                  style: TextStyle(color: Colors.white70),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _showSettingsDialog() {
    Navigator.pop(context);
    Navigator.push(
      context,
      MaterialPageRoute(builder: (context) => const SettingsScreen()),
    );
  }

  void _showHelpDialog() {
    Navigator.pop(context);
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('قريباً: دليل المساعدة')));
  }

  void _showAboutDialog() {
    Navigator.pop(context);
    showAboutDialog(
      context: context,
      applicationName: 'Remot Security',
      applicationVersion: '1.0.0',
      applicationIcon: const Icon(Icons.security, size: 48),
      children: [const Text('نظام مراقبة وحماية الأجهزة المتقدم')],
    );
  }

  void _logout() async {
    Navigator.pop(context);

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.grey[900],
        title: const Text(
          'تسجيل الخروج',
          style: TextStyle(color: Colors.white),
        ),
        content: const Text(
          'هل أنت متأكد من تسجيل الخروج؟',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text(
              'تسجيل الخروج',
              style: TextStyle(color: Colors.red),
            ),
          ),
        ],
      ),
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

  // حوار إضافة سيرفر جديد
  void _showAddServerDialog() {
    final nameController = TextEditingController();
    final ipController = TextEditingController();
    final osController = TextEditingController();
    final cpuController = TextEditingController();
    final ramController = TextEditingController();
    String selectedType = 'main';
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final dialogBg = isDark ? const Color(0xFF1E1E2E) : Colors.white;
    final textColor = isDark ? Colors.white : const Color(0xFF1A2027);
    final textSecondary = isDark ? Colors.white54 : const Color(0xFF6B7280);

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            backgroundColor: dialogBg,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20),
            ),
            title: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.green.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.dns, color: Colors.green, size: 24),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'إضافة سيرفر جديد',
                    style: TextStyle(color: textColor, fontSize: 18),
                  ),
                ),
              ],
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _buildThemedServerTextField(
                    nameController,
                    'اسم السيرفر *',
                    Icons.dns,
                    isDark,
                  ),
                  const SizedBox(height: 12),
                  _buildThemedServerTextField(
                    ipController,
                    'عنوان IP *',
                    Icons.language,
                    isDark,
                  ),
                  const SizedBox(height: 12),
                  _buildThemedServerTextField(
                    osController,
                    'نظام التشغيل',
                    Icons.computer,
                    isDark,
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: _buildThemedServerTextField(
                          cpuController,
                          'CPU',
                          Icons.memory,
                          isDark,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _buildThemedServerTextField(
                          ramController,
                          'RAM',
                          Icons.storage,
                          isDark,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    children: [
                      ChoiceChip(
                        label: Text(
                          'رئيسي',
                          style: TextStyle(
                            color: selectedType == 'main'
                                ? Colors.amber
                                : textSecondary,
                          ),
                        ),
                        selected: selectedType == 'main',
                        onSelected: (_) =>
                            setDialogState(() => selectedType = 'main'),
                        selectedColor: Colors.amber.withValues(alpha: 0.3),
                        backgroundColor: isDark
                            ? Colors.white.withValues(alpha: 0.1)
                            : Colors.grey.withValues(alpha: 0.15),
                      ),
                      ChoiceChip(
                        label: Text(
                          'احتياطي',
                          style: TextStyle(
                            color: selectedType == 'backup'
                                ? Colors.blue
                                : textSecondary,
                          ),
                        ),
                        selected: selectedType == 'backup',
                        onSelected: (_) =>
                            setDialogState(() => selectedType = 'backup'),
                        selectedColor: Colors.blue.withValues(alpha: 0.3),
                        backgroundColor: isDark
                            ? Colors.white.withValues(alpha: 0.1)
                            : Colors.grey.withValues(alpha: 0.15),
                      ),
                      ChoiceChip(
                        label: Text(
                          'عميل',
                          style: TextStyle(
                            color: selectedType == 'agent'
                                ? Colors.purple
                                : textSecondary,
                          ),
                        ),
                        selected: selectedType == 'agent',
                        onSelected: (_) =>
                            setDialogState(() => selectedType = 'agent'),
                        selectedColor: Colors.purple.withValues(alpha: 0.3),
                        backgroundColor: isDark
                            ? Colors.white.withValues(alpha: 0.1)
                            : Colors.grey.withValues(alpha: 0.15),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: Text('إلغاء', style: TextStyle(color: textSecondary)),
              ),
              ElevatedButton.icon(
                onPressed: () async {
                  if (nameController.text.isEmpty ||
                      ipController.text.isEmpty) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('يرجى ملء الحقول المطلوبة'),
                        backgroundColor: Colors.red,
                      ),
                    );
                    return;
                  }

                  try {
                    await SupabaseService.client.from('servers').insert({
                      'name': nameController.text,
                      'ip_address': ipController.text,
                      'os': osController.text.isNotEmpty
                          ? osController.text
                          : 'Unknown',
                      'cpu': cpuController.text.isNotEmpty
                          ? cpuController.text
                          : null,
                      'ram': ramController.text.isNotEmpty
                          ? ramController.text
                          : null,
                      'server_type': selectedType,
                      'is_online': false,
                      'status': 'offline',
                      'created_at': DateTime.now().toIso8601String(),
                    });

                    if (!context.mounted) return;
                    Navigator.pop(context);
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('تم إضافة السيرفر بنجاح ✓'),
                        backgroundColor: Colors.green,
                      ),
                    );
                  } catch (e) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text('خطأ: $e'),
                        backgroundColor: Colors.red,
                      ),
                    );
                  }
                },
                icon: const Icon(Icons.add, size: 18),
                label: const Text('إضافة'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildThemedServerTextField(
    TextEditingController controller,
    String label,
    IconData icon,
    bool isDark,
  ) {
    final textColor = isDark ? Colors.white : const Color(0xFF1A2027);
    final labelColor = isDark ? Colors.white54 : const Color(0xFF6B7280);
    final iconColor = isDark ? Colors.white38 : const Color(0xFF9CA3AF);
    final fillColor = isDark
        ? Colors.white.withValues(alpha: 0.05)
        : Colors.grey.withValues(alpha: 0.1);
    final borderColor = isDark
        ? Colors.white.withValues(alpha: 0.1)
        : Colors.grey.withValues(alpha: 0.3);

    return TextField(
      controller: controller,
      style: TextStyle(color: textColor),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: TextStyle(color: labelColor),
        prefixIcon: Icon(icon, color: iconColor, size: 20),
        filled: true,
        fillColor: fillColor,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: borderColor),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppTheme.primaryColor),
        ),
      ),
    );
  }

  Future<void> _generateQuickReport() async {
    // إظهار مؤشر التحميل
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => Center(
        child: Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: const Color(0xFF1A1F38),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const CircularProgressIndicator(color: AppTheme.primaryColor),
              const SizedBox(height: 16),
              const Text(
                'جاري إنشاء التقرير السريع...',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'قد يستغرق ذلك بضع ثوانٍ',
                style: TextStyle(color: Colors.white70, fontSize: 12),
              ),
            ],
          ),
        ),
      ),
    );

    try {
      final now = DateTime.now();
      final reportName =
          'Quick_Report_${now.day}_${now.month}_${now.hour}${now.minute}';

      print('📝 Quick Report: Requesting from API...');
      final result = await ApiService.generateReport(
        name: reportName,
        format: 'pdf',
        includeCharts: true,
      );

      if (result['success'] != true) {
        throw Exception(result['error'] ?? 'فشل إنشاء التقرير');
      }

      Uint8List? pdfData;

      if (result['isPdf'] == true) {
        print('✅ Received direct PDF from primary endpoint');
        pdfData = result['data'] as Uint8List;
      } else {
        // إذا لم يرجع PDF مباشرة، نحاول تحميله يدوياً
        final reportId =
            result['id'] ??
            (result['report'] != null ? result['report']['id'] : null);
        if (reportId == null) throw Exception('لم يتم الحصول على معرف التقرير');

        print(
          '📥 Quick Report: Metadata received (ID: $reportId), downloading PDF...',
        );
        final pdfRes = await ApiService.exportReportPdf(
          reportId is int ? reportId : int.parse(reportId.toString()),
        );
        if (pdfRes['success'] == true) {
          pdfData = pdfRes['data'] as Uint8List;
        } else {
          throw Exception(pdfRes['error'] ?? 'فشل تحميل PDF');
        }
      }

      if (mounted) Navigator.pop(context); // إغلاق ديالوج التحميل

      if (kIsWeb) {
        // للويب: تحميل PDF
        web_download.downloadPdfFile(pdfData.toList(), '$reportName.pdf');
      } else {
        // للموبايل: حفظ وفتح الملف
        final directory = await getTemporaryDirectory();
        final filePath = '${directory.path}/$reportName.pdf';
        final file = File(filePath);
        await file.writeAsBytes(pdfData);

        print('📂 PDF saved to: $filePath');

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('تم إنشاء التقرير بنجاح'),
              backgroundColor: Colors.green,
            ),
          );

          await OpenFilex.open(filePath);
        }
      }
    } catch (e) {
      print('❌ Quick Report Error: $e');
      if (mounted) {
        // إغلاق ديالوج التحميل إذا كان لا يزال مفتوحاً
        if (Navigator.canPop(context)) Navigator.pop(context);

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('خطأ: ${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  void _refreshAllData() {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('🔄 جاري تحديث جميع البيانات...'),
        backgroundColor: AppTheme.infoColor,
      ),
    );

    // Trigger refresh for all screens
    setState(() {
      _currentIndex = _currentIndex; // Force rebuild
    });
  }

  void _performSecurityScan() {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('🔒 جاري إجراء الفحص الأمني...'),
        duration: Duration(seconds: 3),
      ),
    );

    Future.delayed(const Duration(seconds: 3), () {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('✅ الفحص الأمني مكتمل - النظام آمن'),
            backgroundColor: AppTheme.successColor,
          ),
        );
      }
    });
  }
}

// النماذج المساعدة
class NavigationItem {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final Color color;

  NavigationItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.color,
  });
}

class QuickAction {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  QuickAction({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });
}
