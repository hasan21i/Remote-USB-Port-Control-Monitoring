import 'package:flutter/material.dart';
import 'dart:ui';
import '../config/app_theme.dart';
import '../services/supabase_service.dart';

/// صفحة القوائم - تصميم زجاجي حديث
class BlacklistWhitelistScreen extends StatefulWidget {
  const BlacklistWhitelistScreen({super.key});

  @override
  State<BlacklistWhitelistScreen> createState() =>
      _BlacklistWhitelistScreenState();
}

class _BlacklistWhitelistScreenState extends State<BlacklistWhitelistScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<Map<String, dynamic>> _blacklist = [];
  List<Map<String, dynamic>> _whitelist = [];
  bool _isLoading = true;
  String _searchQuery = '';
  final Set<String> _processingDevices = {};

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadLists();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadLists() async {
    setState(() => _isLoading = true);

    try {
      final client = SupabaseService.client;

      // القائمة السوداء
      final blacklistData = await client
          .from('devices')
          .select('*')
          .or('blacklisted.eq.true,status.eq.blocked,status.eq.denied')
          .order('created_at', ascending: false);

      // القائمة البيضاء
      final whitelistData = await client
          .from('devices')
          .select('*')
          .or('whitelisted.eq.true,status.eq.allowed,status.eq.connected')
          .order('created_at', ascending: false);

      setState(() {
        _blacklist = List<Map<String, dynamic>>.from(blacklistData);
        _whitelist = List<Map<String, dynamic>>.from(whitelistData);
        _isLoading = false;
      });

      print(
        '📋 Loaded ${_blacklist.length} blacklisted, ${_whitelist.length} whitelisted',
      );
    } catch (e) {
      print('❌ Error loading lists: $e');
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('خطأ في تحميل القوائم: $e'),
            backgroundColor: AppTheme.dangerColor,
          ),
        );
      }
    }
  }

  List<Map<String, dynamic>> _filterList(List<Map<String, dynamic>> list) {
    if (_searchQuery.isEmpty) return list;
    return list.where((d) {
      final name = (d['name'] ?? d['device_name'] ?? '')
          .toString()
          .toLowerCase();
      final serial = (d['serial_number'] ?? '').toString().toLowerCase();
      final manufacturer = (d['manufacturer'] ?? '').toString().toLowerCase();
      return name.contains(_searchQuery.toLowerCase()) ||
          serial.contains(_searchQuery.toLowerCase()) ||
          manufacturer.contains(_searchQuery.toLowerCase());
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFF0A0E21), Color(0xFF1A1F38)],
            ),
          ),
          child: SafeArea(
            child: Column(
              children: [
                _buildHeader(),
                _buildSearchBar(),
                _buildStatsBar(),
                _buildTabBar(),
                Expanded(
                  child: _isLoading ? _buildLoadingWidget() : _buildTabView(),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.all(20),
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.pop(context),
            icon: const Icon(Icons.arrow_back_ios, color: Colors.white),
          ),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [AppTheme.primaryColor, AppTheme.secondaryColor],
              ),
              borderRadius: BorderRadius.circular(12),
              boxShadow: [
                BoxShadow(
                  color: AppTheme.primaryColor.withValues(alpha: 0.4),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: const Icon(
              Icons.playlist_add_check,
              color: Colors.white,
              size: 24,
            ),
          ),
          const SizedBox(width: 16),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'القوائم',
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
                Text(
                  'إدارة الأجهزة المسموحة والمحظورة',
                  style: TextStyle(color: Colors.white70, fontSize: 14),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: _loadLists,
            icon: const Icon(Icons.refresh, color: Colors.white),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchBar() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
      ),
      child: TextField(
        style: const TextStyle(color: Colors.white),
        onChanged: (value) => setState(() => _searchQuery = value),
        decoration: InputDecoration(
          hintText: 'بحث بالاسم أو الرقم التسلسلي...',
          hintStyle: TextStyle(color: Colors.white.withValues(alpha: 0.5)),
          border: InputBorder.none,
          icon: Icon(Icons.search, color: Colors.white.withValues(alpha: 0.5)),
        ),
      ),
    );
  }

  Widget _buildStatsBar() {
    return Container(
      margin: const EdgeInsets.all(20),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
      ),
      child: Row(
        children: [
          _buildStatItem(
            'القائمة السوداء',
            _blacklist.length.toString(),
            AppTheme.dangerColor,
            Icons.block,
          ),
          Container(
            width: 1,
            height: 40,
            color: Colors.white.withValues(alpha: 0.1),
          ),
          _buildStatItem(
            'القائمة البيضاء',
            _whitelist.length.toString(),
            AppTheme.successColor,
            Icons.check_circle,
          ),
          Container(
            width: 1,
            height: 40,
            color: Colors.white.withValues(alpha: 0.1),
          ),
          _buildStatItem(
            'المجموع',
            (_blacklist.length + _whitelist.length).toString(),
            AppTheme.primaryColor,
            Icons.devices,
          ),
        ],
      ),
    );
  }

  Widget _buildStatItem(
    String label,
    String value,
    Color color,
    IconData icon,
  ) {
    return Expanded(
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: color, size: 20),
              const SizedBox(width: 8),
              Text(
                value,
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                  color: color,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(color: Colors.white70, fontSize: 12),
          ),
        ],
      ),
    );
  }

  Widget _buildTabBar() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
      ),
      child: TabBar(
        controller: _tabController,
        indicator: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              AppTheme.dangerColor,
              AppTheme.dangerColor.withValues(alpha: 0.7),
            ],
          ),
          borderRadius: BorderRadius.circular(10),
        ),
        dividerColor: Colors.transparent,
        labelColor: Colors.white,
        unselectedLabelColor: Colors.white70,
        labelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
        tabs: [
          Tab(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.block, size: 18),
                const SizedBox(width: 8),
                Text('السوداء (${_blacklist.length})'),
              ],
            ),
          ),
          Tab(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.check_circle, size: 18),
                const SizedBox(width: 8),
                Text('البيضاء (${_whitelist.length})'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLoadingWidget() {
    return Center(
      child: Container(
        padding: const EdgeInsets.all(40),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(color: AppTheme.primaryColor),
            const SizedBox(height: 16),
            Text(
              'جاري تحميل القوائم...',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.7)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTabView() {
    return TabBarView(
      controller: _tabController,
      children: [
        _buildList(_filterList(_blacklist), isBlacklist: true),
        _buildList(_filterList(_whitelist), isBlacklist: false),
      ],
    );
  }

  Widget _buildList(
    List<Map<String, dynamic>> items, {
    required bool isBlacklist,
  }) {
    if (items.isEmpty) {
      return Center(
        child: Container(
          padding: const EdgeInsets.all(40),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color:
                      (isBlacklist
                              ? AppTheme.dangerColor
                              : AppTheme.successColor)
                          .withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  isBlacklist ? Icons.block : Icons.check_circle,
                  size: 64,
                  color:
                      (isBlacklist
                              ? AppTheme.dangerColor
                              : AppTheme.successColor)
                          .withValues(alpha: 0.5),
                ),
              ),
              const SizedBox(height: 24),
              Text(
                isBlacklist ? 'لا توجد أجهزة محظورة' : 'لا توجد أجهزة مسموحة',
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 18,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                isBlacklist
                    ? 'الأجهزة المحظورة ستظهر هنا'
                    : 'الأجهزة المسموحة ستظهر هنا',
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.5),
                  fontSize: 14,
                ),
              ),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadLists,
      color: AppTheme.primaryColor,
      child: ListView.builder(
        padding: const EdgeInsets.all(20),
        itemCount: items.length,
        itemBuilder: (context, index) {
          return _buildDeviceCard(items[index], isBlacklist: isBlacklist);
        },
      ),
    );
  }

  Widget _buildDeviceCard(
    Map<String, dynamic> device, {
    required bool isBlacklist,
  }) {
    final deviceId = device['id']?.toString() ?? '';
    final isProcessing = _processingDevices.contains(deviceId);
    final deviceName =
        device['name'] ?? device['device_name'] ?? 'جهاز غير معروف';
    final serialNumber = device['serial_number'] ?? 'غير محدد';
    final deviceType = device['type'] ?? device['device_type'] ?? 'USB';

    final color = isBlacklist ? AppTheme.dangerColor : AppTheme.successColor;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withValues(alpha: 0.3), width: 1),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: () => _showDeviceDetails(device, isBlacklist),
              borderRadius: BorderRadius.circular(16),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    // أيقونة الجهاز
                    Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: isBlacklist
                              ? [AppTheme.dangerColor, const Color(0xFFE91E63)]
                              : [
                                  AppTheme.successColor,
                                  const Color(0xFF8BC34A),
                                ],
                        ),
                        borderRadius: BorderRadius.circular(14),
                        boxShadow: [
                          BoxShadow(
                            color: color.withValues(alpha: 0.4),
                            blurRadius: 8,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: Icon(
                        isBlacklist ? Icons.block : Icons.verified_user,
                        color: Colors.white,
                        size: 28,
                      ),
                    ),
                    const SizedBox(width: 16),

                    // معلومات الجهاز
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            deviceName,
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 16,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              Icon(
                                Icons.memory,
                                size: 12,
                                color: Colors.white.withValues(alpha: 0.5),
                              ),
                              const SizedBox(width: 4),
                              Expanded(
                                child: Text(
                                  serialNumber,
                                  style: TextStyle(
                                    color: Colors.white.withValues(alpha: 0.7),
                                    fontSize: 12,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: color.withValues(alpha: 0.2),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  isBlacklist ? 'محظور' : 'مسموح',
                                  style: TextStyle(
                                    color: color,
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.white.withValues(alpha: 0.1),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  deviceType,
                                  style: const TextStyle(
                                    color: Colors.white70,
                                    fontSize: 10,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),

                    // أزرار الإجراءات
                    if (isProcessing)
                      const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    else
                      PopupMenuButton<String>(
                        icon: const Icon(
                          Icons.more_vert,
                          color: Colors.white70,
                        ),
                        color: const Color(0xFF1E1E2E),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                        onSelected: (value) =>
                            _handleAction(value, deviceId, isBlacklist),
                        itemBuilder: (context) => [
                          PopupMenuItem(
                            value: 'move',
                            child: Row(
                              children: [
                                Icon(
                                  isBlacklist
                                      ? Icons.check_circle
                                      : Icons.block,
                                  color: isBlacklist
                                      ? AppTheme.successColor
                                      : AppTheme.warningColor,
                                  size: 20,
                                ),
                                const SizedBox(width: 12),
                                Text(
                                  isBlacklist
                                      ? 'نقل للقائمة البيضاء'
                                      : 'نقل للقائمة السوداء',
                                  style: const TextStyle(color: Colors.white),
                                ),
                              ],
                            ),
                          ),
                          const PopupMenuItem(
                            value: 'remove',
                            child: Row(
                              children: [
                                Icon(
                                  Icons.remove_circle_outline,
                                  color: Colors.orange,
                                  size: 20,
                                ),
                                SizedBox(width: 12),
                                Text(
                                  'إزالة من القائمة',
                                  style: TextStyle(color: Colors.white),
                                ),
                              ],
                            ),
                          ),
                          const PopupMenuItem(
                            value: 'delete',
                            child: Row(
                              children: [
                                Icon(Icons.delete, color: Colors.red, size: 20),
                                SizedBox(width: 12),
                                Text(
                                  'حذف نهائي',
                                  style: TextStyle(color: Colors.white),
                                ),
                              ],
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

  void _showDeviceDetails(Map<String, dynamic> device, bool isBlacklist) {
    final color = isBlacklist ? AppTheme.dangerColor : AppTheme.successColor;

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => Container(
        height: MediaQuery.of(context).size.height * 0.7,
        decoration: BoxDecoration(
          color: const Color(0xFF1E1E2E),
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        child: Column(
          children: [
            // Handle
            Container(
              margin: const EdgeInsets.only(top: 12),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),

            // Header
            Container(
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: isBlacklist
                            ? [AppTheme.dangerColor, const Color(0xFFE91E63)]
                            : [AppTheme.successColor, const Color(0xFF8BC34A)],
                      ),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Icon(
                      isBlacklist ? Icons.block : Icons.verified_user,
                      color: Colors.white,
                      size: 32,
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          device['name'] ??
                              device['device_name'] ??
                              'جهاز غير معروف',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        Container(
                          margin: const EdgeInsets.only(top: 8),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: color.withValues(alpha: 0.2),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            isBlacklist ? 'محظور' : 'مسموح',
                            style: TextStyle(
                              color: color,
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // Details
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Column(
                  children: [
                    _buildDetailRow(
                      'الرقم التسلسلي',
                      device['serial_number'] ?? '-',
                    ),
                    _buildDetailRow(
                      'الشركة المصنعة',
                      device['manufacturer'] ?? '-',
                    ),
                    _buildDetailRow(
                      'النوع',
                      device['type'] ?? device['device_type'] ?? '-',
                    ),
                    _buildDetailRow('Vendor ID', device['vendor_id'] ?? '-'),
                    _buildDetailRow('Product ID', device['product_id'] ?? '-'),
                    _buildDetailRow('منفذ USB', device['usb_port'] ?? '-'),
                    _buildDetailRow(
                      'تاريخ الإضافة',
                      _formatDate(device['created_at']),
                    ),
                    _buildDetailRow(
                      'آخر تحديث',
                      _formatDate(device['updated_at']),
                    ),
                    const SizedBox(height: 20),
                  ],
                ),
              ),
            ),

            // Actions
            Container(
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () {
                        Navigator.pop(context);
                        _handleAction(
                          'move',
                          device['id']?.toString() ?? '',
                          isBlacklist,
                        );
                      },
                      style: OutlinedButton.styleFrom(
                        foregroundColor: isBlacklist
                            ? AppTheme.successColor
                            : AppTheme.dangerColor,
                        side: BorderSide(
                          color:
                              (isBlacklist
                                      ? AppTheme.successColor
                                      : AppTheme.dangerColor)
                                  .withValues(alpha: 0.5),
                        ),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      icon: Icon(
                        isBlacklist ? Icons.check_circle : Icons.block,
                        size: 20,
                      ),
                      label: Text(isBlacklist ? 'نقل للبيضاء' : 'نقل للسوداء'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () {
                        Navigator.pop(context);
                        _handleAction(
                          'remove',
                          device['id']?.toString() ?? '',
                          isBlacklist,
                        );
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.orange,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      icon: const Icon(Icons.remove_circle_outline, size: 20),
                      label: const Text('إزالة'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
        ),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 120,
            child: Text(
              label,
              style: const TextStyle(color: Colors.white54, fontSize: 14),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(color: Colors.white, fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }

  String _formatDate(dynamic date) {
    if (date == null) return '-';
    try {
      final dt = DateTime.parse(date.toString());
      return '${dt.day}/${dt.month}/${dt.year} ${dt.hour}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (e) {
      return '-';
    }
  }

  void _handleAction(String action, String deviceId, bool isBlacklist) {
    if (deviceId.isEmpty) return;

    switch (action) {
      case 'move':
        _moveToOtherList(deviceId, isBlacklist);
        break;
      case 'remove':
        _removeFromList(deviceId, isBlacklist);
        break;
      case 'delete':
        _confirmDelete(deviceId);
        break;
    }
  }

  Future<void> _moveToOtherList(String deviceId, bool fromBlacklist) async {
    setState(() => _processingDevices.add(deviceId));

    try {
      if (fromBlacklist) {
        await SupabaseService.whitelistDevice(deviceId);
      } else {
        await SupabaseService.blacklistDevice(deviceId);
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('تم نقل الجهاز بنجاح'),
            backgroundColor: AppTheme.successColor,
          ),
        );
      }

      _loadLists();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('خطأ: $e'),
            backgroundColor: AppTheme.dangerColor,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _processingDevices.remove(deviceId));
      }
    }
  }

  Future<void> _removeFromList(String deviceId, bool isBlacklist) async {
    setState(() => _processingDevices.add(deviceId));

    try {
      await SupabaseService.removeDeviceFromLists(deviceId);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('تم إزالة الجهاز من القائمة'),
            backgroundColor: AppTheme.successColor,
          ),
        );
      }

      _loadLists();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('خطأ في الإزالة: $e'),
            backgroundColor: AppTheme.dangerColor,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _processingDevices.remove(deviceId));
      }
    }
  }

  void _confirmDelete(String deviceId) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E2E),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.warning, color: Colors.red),
            SizedBox(width: 8),
            Text('تأكيد الحذف', style: TextStyle(color: Colors.white)),
          ],
        ),
        content: const Text(
          'هل أنت متأكد من حذف هذا الجهاز نهائياً؟',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('إلغاء'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(context);
              await _deleteDevice(deviceId);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.red,
              foregroundColor: Colors.white,
            ),
            child: const Text('حذف'),
          ),
        ],
      ),
    );
  }

  Future<void> _deleteDevice(String deviceId) async {
    setState(() => _processingDevices.add(deviceId));

    try {
      await SupabaseService.deleteDevice(deviceId);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تم حذف الجهاز'),
            backgroundColor: Colors.green,
          ),
        );
      }

      _loadLists();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('خطأ في الحذف: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _processingDevices.remove(deviceId));
      }
    }
  }
}
