import 'package:flutter/material.dart';
import '../config/app_theme.dart';
import '../services/supabase_service.dart';
import '../services/api_service.dart';

/// صفحة الأجهزة - تصميم زجاجي حديث
class DevicesScreen extends StatefulWidget {
  const DevicesScreen({super.key});

  @override
  State<DevicesScreen> createState() => _DevicesScreenState();
}

class _DevicesScreenState extends State<DevicesScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<Map<String, dynamic>> _pendingDevices = [];
  List<Map<String, dynamic>> _agentPendingDevices =
      []; // الأجهزة المعلقة من العملاء
  List<Map<String, dynamic>> _connectedDevices = [];
  List<Map<String, dynamic>> _disconnectedDevices = [];
  List<Map<String, dynamic>> _deniedDevices = [];
  bool _isLoading = true;
  final Set<String> _processingDevices = {};

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _loadDevices();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadDevices() async {
    setState(() => _isLoading = true);

    try {
      // 1. جلب الأجهزة من قاعدة البيانات (تأكد من جلب الجميع من كل السيرفرات)
      List<Map<String, dynamic>> allDevices =
          await SupabaseService.getDevices();
      print(
        '📱 Loaded ${allDevices.length} devices from Supabase directly for global view',
      );

      // 2. جلب إحصائيات Dashboard للحصول على عدد الأجهزة المكتشفة (المعلقة)
      // نفس منطق الموقع - pending_devices = discovered_count
      final dashboardStats = await ApiService.getDashboardStats();
      final int pendingFromDashboard = dashboardStats.pendingDevices;

      // 3. جلب الأجهزة المكتشفة من discovery-summary
      final discoverySummary = await ApiService.getDiscoverySummary();
      final List<Map<String, dynamic>> discoveredDevices =
          (discoverySummary['sample_discovered'] as List?)
              ?.cast<Map<String, dynamic>>() ??
          [];

      // 4. جلب الأجهزة المعلقة من العملاء (جدول معزول)
      final agentPendingDevices = await ApiService.getAgentPendingDevices();
      print('📱 Agent pending devices: ${agentPendingDevices.length}');

      print('📡 Dashboard pending count: $pendingFromDashboard');
      print('📡 Discovered devices: ${discoveredDevices.length}');

      setState(() {
        // إنشاء قائمة بالأرقام التسلسلية للأجهزة المسجلة مسبقاً
        final registeredSerials = allDevices
            .map(
              (d) => (d['serial_number'] ?? d['serialNumber'] ?? '')
                  .toString()
                  .trim(),
            )
            .where((s) => s.isNotEmpty)
            .toSet();

        // الأجهزة التي تم رصدها حالياً (سواء من السيرفر كـ discovered أو من العملاء كـ agent pending)
        final currentlySeenSerials = {
          ...discoveredDevices.map(
            (d) => (d['serial_number'] ?? d['serialNumber'] ?? '')
                .toString()
                .trim(),
          ),
          ...agentPendingDevices.map(
            (d) => (d['serial_number'] ?? d['serialNumber'] ?? '')
                .toString()
                .trim(),
          ),
        }.where((s) => s.isNotEmpty).toSet();

        // حفظ الأجهزة المعلقة من العملاء مع تصفية المسجل منها مسبقاً
        _agentPendingDevices = agentPendingDevices
            .where((d) {
              final s = (d['serial_number'] ?? d['serialNumber'] ?? '')
                  .toString()
                  .trim();
              return !registeredSerials.contains(s);
            })
            .map((d) {
              final isAgent = d['source'] == 'agent';
              return {...d, 'is_agent_pending': isAgent};
            })
            .toList();

        // الأجهزة المرفوضة أو المحظورة (كما هي)
        _deniedDevices = allDevices.where((d) {
          final status = d['status']?.toString().toLowerCase() ?? '';
          return status == 'denied' || status == 'blocked';
        }).toList();

        // الأجهزة المتصلة: المسجلة كـ connected أو أي جهاز مسجل تم رصده حالياً (Seen)
        _connectedDevices = allDevices.where((d) {
          final status = d['status']?.toString().toLowerCase() ?? '';
          final isConnected = d['is_connected'] == true;
          final serial = (d['serial_number'] ?? d['serialNumber'] ?? '')
              .toString()
              .trim();

          // إذا كان الجهاز محظوراً، فلا يظهر كمتصل مهما حدث
          if (status == 'denied' || status == 'blocked') return false;

          // يعتبر متصلاً إذا:
          // 1. حالته connected في القاعدة
          // 2. أو علامة is_connected مفعلة
          // 3. أو تم رصده الآن (بناءً على السيريال) عبر السيرفر الفرعي أو العميل
          return status == 'connected' ||
              isConnected ||
              currentlySeenSerials.contains(serial);
        }).toList();

        // الأجهزة المعلقة: يجب أن تشمل فقط الأجهزة القادمة من جداول (agent_pending و server_pending)
        // يتم جلبها جميعاً عبر ApiService.getAgentPendingDevices() (والذي ينادي endpoint: /devices/pending)

        // إزالة التكرار بناءً على الرقم التسلسلي (Serial Number)
        final Map<String, Map<String, dynamic>> uniquePending = {};

        for (var device in _agentPendingDevices) {
          final serial =
              (device['serial_number'] ?? device['serialNumber'] ?? '')
                  .toString()
                  .trim();
          final vidName =
              (device['vendor_id'] ?? '').toString() +
              (device['product_id'] ?? '').toString();

          final key = serial.isNotEmpty ? serial : vidName;

          if (key.isNotEmpty && !uniquePending.containsKey(key)) {
            uniquePending[key] = device;
          }
        }

        _pendingDevices = uniquePending.values.toList();

        // الأجهزة المنفصلة: مسجلة وليست متصلة وليست مرفوضة وليست ضمن الرصد الحالي
        _disconnectedDevices = allDevices.where((d) {
          final status = d['status']?.toString().toLowerCase() ?? '';
          final isConnected = d['is_connected'] == true;
          final serial = (d['serial_number'] ?? d['serialNumber'] ?? '')
              .toString()
              .trim();

          if (status == 'denied' || status == 'blocked') return false;
          if (status == 'connected' ||
              isConnected ||
              currentlySeenSerials.contains(serial))
            return false;

          return true; // غير متصل وغير مرصود الآن
        }).toList();

        _isLoading = false;
      });

      print(
        '📊 Final counts - Pending: ${_pendingDevices.length} (includes ${_agentPendingDevices.length} from agents), Connected: ${_connectedDevices.length}, Disconnected: ${_disconnectedDevices.length}, Denied: ${_deniedDevices.length}',
      );
    } catch (e) {
      print('❌ Error loading devices: $e');
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('خطأ في تحميل الأجهزة: $e'),
            backgroundColor: AppTheme.dangerColor,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: FloatingActionButton(
          heroTag: 'devices_fab',
          onPressed: _showAddDeviceDialog,
          backgroundColor: AppTheme.primaryColor,
          tooltip: 'إضافة جهاز',
          child: const Icon(Icons.add, color: Colors.white),
        ),
        body: SafeArea(
          top: false,
          child: Padding(
            padding: EdgeInsets.only(
              top: MediaQuery.of(context).padding.top + kToolbarHeight + 10,
            ),
            child: Column(
              children: [
                _buildHeader(),
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

  // Dialog لإضافة جهاز جديد
  void _showAddDeviceDialog() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final dialogBgColor = isDark ? const Color(0xFF1E1E2E) : Colors.white;
    final textColor = isDark ? Colors.white : const Color(0xFF1A2027);

    final nameController = TextEditingController();
    final vendorIdController = TextEditingController();
    final productIdController = TextEditingController();
    final serialController = TextEditingController();
    final manufacturerController = TextEditingController();
    String selectedStatus = 'pending';

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            backgroundColor: dialogBgColor,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20),
            ),
            title: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppTheme.primaryColor.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(Icons.usb, color: AppTheme.primaryColor),
                ),
                const SizedBox(width: 12),
                Text('إضافة جهاز جديد', style: TextStyle(color: textColor)),
              ],
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _buildDialogTextField(
                    nameController,
                    'اسم الجهاز',
                    Icons.devices,
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: _buildDialogTextField(
                          vendorIdController,
                          'Vendor ID',
                          Icons.tag,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _buildDialogTextField(
                          productIdController,
                          'Product ID',
                          Icons.tag,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _buildDialogTextField(
                    serialController,
                    'الرقم التسلسلي',
                    Icons.qr_code,
                  ),
                  const SizedBox(height: 12),
                  _buildDialogTextField(
                    manufacturerController,
                    'الشركة المصنعة',
                    Icons.business,
                  ),
                  const SizedBox(height: 16),
                  // حالة الجهاز
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.05),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'حالة الجهاز',
                          style: TextStyle(color: Colors.white70),
                        ),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          children: [
                            _buildStatusChip(
                              'pending',
                              'معلق',
                              Colors.orange,
                              selectedStatus,
                              (v) => setDialogState(() => selectedStatus = v),
                            ),
                            _buildStatusChip(
                              'connected',
                              'متصل',
                              Colors.green,
                              selectedStatus,
                              (v) => setDialogState(() => selectedStatus = v),
                            ),
                            _buildStatusChip(
                              'blocked',
                              'محظور',
                              Colors.red,
                              selectedStatus,
                              (v) => setDialogState(() => selectedStatus = v),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text(
                  'إلغاء',
                  style: TextStyle(color: Colors.white54),
                ),
              ),
              ElevatedButton(
                onPressed: () async {
                  if (nameController.text.isEmpty) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('يرجى إدخال اسم الجهاز'),
                        backgroundColor: Colors.red,
                      ),
                    );
                    return;
                  }

                  Navigator.pop(context);

                  // إضافة الجهاز لقاعدة البيانات
                  try {
                    await SupabaseService.addDevice({
                      'name': nameController.text,
                      'vendor_id': vendorIdController.text.isNotEmpty
                          ? vendorIdController.text
                          : 'UNKNOWN',
                      'product_id': productIdController.text.isNotEmpty
                          ? productIdController.text
                          : 'UNKNOWN',
                      'serial_number': serialController.text,
                      'manufacturer': manufacturerController.text,
                      'status': selectedStatus,
                      'usb_port': 'Manual-Entry',
                      'connection_time': DateTime.now().toIso8601String(),
                    });

                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('تم إضافة الجهاز بنجاح ✓'),
                        backgroundColor: Colors.green,
                      ),
                    );

                    _loadDevices(); // تحديث البيانات
                  } catch (e) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text('خطأ: $e'),
                        backgroundColor: Colors.red,
                      ),
                    );
                  }
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.primaryColor,
                  foregroundColor: Colors.white,
                ),
                child: const Text('إضافة'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDialogTextField(
    TextEditingController controller,
    String label,
    IconData icon,
  ) {
    return TextField(
      controller: controller,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Colors.white54),
        prefixIcon: Icon(icon, color: Colors.white38, size: 20),
        filled: true,
        fillColor: Colors.white.withValues(alpha: 0.05),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppTheme.primaryColor),
        ),
      ),
    );
  }

  Widget _buildStatusChip(
    String value,
    String label,
    Color color,
    String selected,
    Function(String) onSelect,
  ) {
    final isSelected = selected == value;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (_) => onSelect(value),
      selectedColor: color.withValues(alpha: 0.3),
      backgroundColor: Colors.white.withValues(alpha: 0.1),
      labelStyle: TextStyle(color: isSelected ? color : Colors.white70),
      side: BorderSide(color: isSelected ? color : Colors.transparent),
    );
  }

  Widget _buildHeader() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textColor = isDark ? Colors.white : const Color(0xFF1A2027);
    final textSecondaryColor = isDark
        ? Colors.white.withValues(alpha: 0.7)
        : const Color(0xFF6B7280);

    return Container(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppTheme.primaryColor.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(Icons.usb, color: AppTheme.primaryColor, size: 24),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'إدارة الأجهزة',
                  style: TextStyle(
                    color: textColor,
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  'مراقبة ومراجعة جميع الأجهزة المتصلة',
                  style: TextStyle(color: textSecondaryColor, fontSize: 14),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: _loadDevices,
            icon: Icon(Icons.refresh, color: textSecondaryColor),
          ),
        ],
      ),
    );
  }

  Widget _buildTabBar() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final tabBgColor = isDark ? const Color(0xFF1a2332) : Colors.grey.shade200;
    final borderColor = isDark
        ? Colors.white.withValues(alpha: 0.08)
        : Colors.black.withValues(alpha: 0.08);
    final unselectedColor = isDark
        ? Colors.white.withValues(alpha: 0.5)
        : const Color(0xFF6B7280);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: tabBgColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderColor),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.2),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: TabBar(
        controller: _tabController,
        indicator: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              AppTheme.primaryColor,
              AppTheme.primaryColor.withValues(alpha: 0.7),
            ],
          ),
          borderRadius: BorderRadius.circular(12),
          boxShadow: [
            BoxShadow(
              color: AppTheme.primaryColor.withValues(alpha: 0.4),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        labelColor: Colors.white,
        unselectedLabelColor: unselectedColor,
        dividerColor: Colors.transparent,
        indicatorSize: TabBarIndicatorSize.tab,
        labelPadding: EdgeInsets.zero,
        tabs: [
          _buildTab(
            'الانتظار',
            _pendingDevices.length,
            Icons.hourglass_empty,
            AppTheme.warningColor,
          ),
          _buildTab(
            'متصل',
            _connectedDevices.length,
            Icons.wifi,
            AppTheme.successColor,
          ),
          _buildTab(
            'منفصل',
            _disconnectedDevices.length,
            Icons.wifi_off,
            Colors.grey,
          ),
          _buildTab(
            'مرفوض',
            _deniedDevices.length,
            Icons.block,
            AppTheme.dangerColor,
          ),
        ],
      ),
    );
  }

  Widget _buildTab(String label, int count, IconData icon, Color accentColor) {
    return Tab(
      height: 56,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 16),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    label,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: accentColor.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: accentColor.withValues(alpha: 0.3),
                  width: 1,
                ),
              ),
              child: Text(
                count.toString(),
                style: TextStyle(
                  fontSize: 11,
                  color: accentColor,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLoadingWidget() {
    return Center(
      child: GlassCard(
        child: Container(
          padding: const EdgeInsets.all(40),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 50,
                height: 50,
                child: CircularProgressIndicator(
                  valueColor: AlwaysStoppedAnimation<Color>(
                    AppTheme.primaryColor,
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'جاري تحميل الأجهزة...',
                style: TextStyle(
                  color: Theme.of(context).brightness == Brightness.dark
                      ? Colors.white
                      : const Color(0xFF1A2027),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTabView() {
    return TabBarView(
      controller: _tabController,
      children: [
        _buildDeviceList(_pendingDevices, 'pending'),
        _buildDeviceList(_connectedDevices, 'connected'),
        _buildDeviceList(_disconnectedDevices, 'disconnected'),
        _buildDeviceList(_deniedDevices, 'denied'),
      ],
    );
  }

  Widget _buildDeviceList(List<Map<String, dynamic>> devices, String status) {
    if (devices.isEmpty) {
      return Center(
        child: GlassCard(
          child: Container(
            padding: const EdgeInsets.all(40),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  status == 'pending'
                      ? Icons.pending
                      : status == 'connected'
                      ? Icons.check_circle
                      : status == 'disconnected'
                      ? Icons.link_off
                      : Icons.block,
                  size: 60,
                  color: Theme.of(context).brightness == Brightness.dark
                      ? Colors.white.withValues(alpha: 0.5)
                      : Colors.grey.withValues(alpha: 0.5),
                ),
                const SizedBox(height: 16),
                Text(
                  status == 'pending'
                      ? 'لا توجد أجهزة في الانتظار'
                      : status == 'connected'
                      ? 'لا توجد أجهزة متصلة'
                      : 'لا توجد أجهزة مرفوضة',
                  style: TextStyle(
                    color: Theme.of(context).brightness == Brightness.dark
                        ? Colors.white.withValues(alpha: 0.8)
                        : const Color(0xFF6B7280),
                    fontSize: 16,
                  ),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadDevices,
      color: AppTheme.primaryColor,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: devices.length,
        itemBuilder: (context, index) =>
            _buildDeviceCard(devices[index], status),
      ),
    );
  }

  Widget _buildDeviceCard(Map<String, dynamic> device, String status) {
    final deviceId = device['id']?.toString() ?? '';
    final isAgentPending = device['is_agent_pending'] == true;
    final processingKey = isAgentPending ? 'agent_$deviceId' : deviceId;
    final isProcessing = _processingDevices.contains(processingKey);
    final deviceName =
        device['name'] ?? device['device_name'] ?? 'جهاز غير معروف';
    final deviceType = device['type'] ?? device['device_class'] ?? 'USB';
    final manufacturer =
        device['manufacturer'] ?? device['vendor_name'] ?? 'غير محدد';
    final agentName = device['agent_name'] ?? device['hostname'] ?? '';

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      child: GlassCard(
        child: Container(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: _getStatusColor(status).withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(
                      _getDeviceIcon(deviceType),
                      color: _getStatusColor(status),
                      size: 24,
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                deviceName,
                                style: TextStyle(
                                  color:
                                      Theme.of(context).brightness ==
                                          Brightness.dark
                                      ? Colors.white
                                      : const Color(0xFF1A2027),
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            // شارة "عميل" للأجهزة المعلقة من العملاء
                            if (isAgentPending) ...[
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 6,
                                  vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: AppTheme.primaryColor.withValues(
                                    alpha: 0.2,
                                  ),
                                  borderRadius: BorderRadius.circular(6),
                                  border: Border.all(
                                    color: AppTheme.primaryColor.withValues(
                                      alpha: 0.5,
                                    ),
                                    width: 1,
                                  ),
                                ),
                                child: Text(
                                  'عميل',
                                  style: TextStyle(
                                    color: AppTheme.primaryColor,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          isAgentPending && agentName.isNotEmpty
                              ? '$deviceType • $manufacturer • $agentName'
                              : '$deviceType • $manufacturer',
                          style: TextStyle(
                            color:
                                Theme.of(context).brightness == Brightness.dark
                                ? Colors.white.withValues(alpha: 0.7)
                                : const Color(0xFF6B7280),
                            fontSize: 14,
                          ),
                        ),
                      ],
                    ),
                  ),
                  // زر المزيد من الإجراءات
                  IconButton(
                    onPressed: () => _showDeviceDetails(device),
                    icon: const Icon(Icons.info_outline, color: Colors.white54),
                    tooltip: 'تفاصيل',
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: _getStatusColor(status).withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      _getStatusLabel(status),
                      style: TextStyle(
                        color: _getStatusColor(status),
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),

              // تفاصيل الجهاز
              const SizedBox(height: 16),
              _buildDeviceDetails(device),

              // أزرار الإجراءات للأجهزة المعلقة - تظهر فقط للمسؤولين
              if (status == 'pending') ...[
                const SizedBox(height: 20),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.03),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.08),
                    ),
                  ),
                  child: Row(
                    children: [
                      // زر الموافقة
                      Expanded(
                        child: Material(
                          color: Colors.transparent,
                          child: InkWell(
                            onTap: isProcessing
                                ? null
                                : () => _handleApprove(device),
                            borderRadius: BorderRadius.circular(12),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  colors: isProcessing
                                      ? [
                                          Colors.grey.withValues(alpha: 0.3),
                                          Colors.grey.withValues(alpha: 0.2),
                                        ]
                                      : [
                                          AppTheme.successColor.withValues(
                                            alpha: 0.25,
                                          ),
                                          AppTheme.successColor.withValues(
                                            alpha: 0.15,
                                          ),
                                        ],
                                ),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: isProcessing
                                      ? Colors.grey.withValues(alpha: 0.3)
                                      : AppTheme.successColor.withValues(
                                          alpha: 0.5,
                                        ),
                                  width: 1.5,
                                ),
                                boxShadow: isProcessing
                                    ? []
                                    : [
                                        BoxShadow(
                                          color: AppTheme.successColor
                                              .withValues(alpha: 0.2),
                                          blurRadius: 8,
                                          offset: const Offset(0, 2),
                                        ),
                                      ],
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  if (isProcessing)
                                    SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        valueColor:
                                            AlwaysStoppedAnimation<Color>(
                                              AppTheme.successColor,
                                            ),
                                      ),
                                    )
                                  else
                                    Icon(
                                      Icons.check_circle_outline,
                                      color: AppTheme.successColor,
                                      size: 20,
                                    ),
                                  const SizedBox(width: 8),
                                  Text(
                                    isProcessing ? 'جاري...' : 'موافقة',
                                    style: TextStyle(
                                      color: isProcessing
                                          ? Colors.grey
                                          : AppTheme.successColor,
                                      fontWeight: FontWeight.bold,
                                      fontSize: 14,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      // زر الرفض
                      Expanded(
                        child: Material(
                          color: Colors.transparent,
                          child: InkWell(
                            onTap: isProcessing
                                ? null
                                : () => _handleDeny(device),
                            borderRadius: BorderRadius.circular(12),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  colors: isProcessing
                                      ? [
                                          Colors.grey.withValues(alpha: 0.3),
                                          Colors.grey.withValues(alpha: 0.2),
                                        ]
                                      : [
                                          AppTheme.dangerColor.withValues(
                                            alpha: 0.25,
                                          ),
                                          AppTheme.dangerColor.withValues(
                                            alpha: 0.15,
                                          ),
                                        ],
                                ),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: isProcessing
                                      ? Colors.grey.withValues(alpha: 0.3)
                                      : AppTheme.dangerColor.withValues(
                                          alpha: 0.5,
                                        ),
                                  width: 1.5,
                                ),
                                boxShadow: isProcessing
                                    ? []
                                    : [
                                        BoxShadow(
                                          color: AppTheme.dangerColor
                                              .withValues(alpha: 0.2),
                                          blurRadius: 8,
                                          offset: const Offset(0, 2),
                                        ),
                                      ],
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(
                                    Icons.cancel_outlined,
                                    color: isProcessing
                                        ? Colors.grey
                                        : AppTheme.dangerColor,
                                    size: 20,
                                  ),
                                  const SizedBox(width: 8),
                                  Text(
                                    'رفض',
                                    style: TextStyle(
                                      color: isProcessing
                                          ? Colors.grey
                                          : AppTheme.dangerColor,
                                      fontWeight: FontWeight.bold,
                                      fontSize: 14,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],

              // أزرار الإجراءات للأجهزة المتصلة - إمكانية الحظر
              if (status == 'connected') ...[
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: isProcessing ? null : () => _handleDeny(device),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.dangerColor,
                      side: BorderSide(
                        color: AppTheme.dangerColor.withValues(alpha: 0.5),
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    icon: const Icon(Icons.block, size: 18),
                    label: const Text('حظر الجهاز'),
                  ),
                ),
              ],

              // زر إلغاء الحظر للأجهزة المرفوضة
              if (status == 'denied') ...[
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: isProcessing
                        ? null
                        : () => _handleApprove(device),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.successColor,
                      side: BorderSide(
                        color: AppTheme.successColor.withValues(alpha: 0.5),
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    icon: const Icon(Icons.check_circle, size: 18),
                    label: const Text('إلغاء الحظر'),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDeviceDetails(Map<String, dynamic> device) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bgColor = isDark
        ? Colors.white.withValues(alpha: 0.05)
        : Colors.black.withValues(alpha: 0.03);
    final borderColor = isDark
        ? Colors.white.withValues(alpha: 0.1)
        : Colors.black.withValues(alpha: 0.1);
    final isAgentPending = device['is_agent_pending'] == true;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: borderColor),
      ),
      child: Column(
        children: [
          // المصدر - أول عنصر
          _buildSourceRow(device, isAgentPending),
          _buildDetailRow(
            'المصنّع',
            device['manufacturer'] ?? device['vendor_name'] ?? 'غير معروف',
          ),
          _buildDetailRow(
            'نوع الجهاز',
            device['type'] ?? device['device_class'] ?? 'USB',
          ),
          if (device['serial_number'] != null)
            _buildDetailRow('الرقم التسلسلي', device['serial_number']),
          if (device['vendor_id'] != null)
            _buildDetailRow('معرف المورد', device['vendor_id']),
          if (device['product_id'] != null)
            _buildDetailRow('معرف المنتج', device['product_id']),
          if (device['created_at'] != null || device['discovered_at'] != null)
            _buildDetailRow(
              'تاريخ الاكتشاف',
              _formatDateString(
                device['created_at'] ?? device['discovered_at'],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildSourceRow(Map<String, dynamic> device, bool isAgentPending) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final labelColor = isDark
        ? Colors.white.withValues(alpha: 0.6)
        : const Color(0xFF6B7280);

    // تحديد نوع المصدر واللون والأيقونة
    String sourceType;
    String sourceName;
    Color sourceColor;
    IconData sourceIcon;

    // استخراج معلومات السيرفر المرتبطة بالجهاز في حال الجلب المباشر من قواعد البيانات
    final Map<String, dynamic>? serverInfo = device['servers'];
    final bool isSourceAgent =
        device['source'] == 'agent' ||
        device['server_role'] == 'agent' ||
        (serverInfo?['role'] == 'agent');

    if (isSourceAgent ||
        isAgentPending ||
        device['discovery_method'] == 'electron_agent') {
      // جهاز من عميل فرعي (Agent)
      sourceType = 'عميل فرعي';
      sourceName =
          device['agent_name'] ??
          device['hostname'] ??
          device['agent_hostname'] ??
          serverInfo?['name'] ??
          '';
      sourceColor = AppTheme.warningColor;
      sourceIcon = Icons.desktop_windows;
    } else if (device['server_id'] != null ||
        device['server_name'] != null ||
        serverInfo != null) {
      // جهاز من سيرفر (سواء رئيسي أو فرعي)
      final bool isPrimary =
          device['is_central_server'] == true ||
          device['server_role'] == 'primary' ||
          (serverInfo?['is_central'] == true) ||
          (serverInfo?['role'] == 'primary');

      sourceType = isPrimary ? 'سيرفر رئيسي' : 'سيرفر فرعي';
      sourceName = device['server_name'] ?? serverInfo?['name'] ?? '';
      sourceColor = isPrimary ? AppTheme.primaryColor : AppTheme.infoColor;
      sourceIcon = isPrimary ? Icons.cloud : Icons.dns;
    } else {
      // جهاز محلي / السيرفر المركزي
      sourceType = 'السيرفر المركزي';
      sourceName = '';
      sourceColor = AppTheme.successColor;
      sourceIcon = Icons.home;
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(
              'المصدر',
              style: TextStyle(color: labelColor, fontSize: 12),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Wrap(
              spacing: 6,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: sourceColor.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(
                      color: sourceColor.withValues(alpha: 0.5),
                      width: 1,
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(sourceIcon, color: sourceColor, size: 12),
                      const SizedBox(width: 4),
                      Text(
                        sourceType,
                        style: TextStyle(
                          color: sourceColor,
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                if (sourceName.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: isDark
                          ? Colors.white.withValues(alpha: 0.1)
                          : Colors.black.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      sourceName,
                      style: TextStyle(
                        color: isDark ? Colors.white70 : Colors.black87,
                        fontSize: 10,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailRow(String label, String value) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final labelColor = isDark
        ? Colors.white.withValues(alpha: 0.6)
        : const Color(0xFF6B7280);
    final valueColor = isDark ? Colors.white : const Color(0xFF1A2027);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(
              label,
              style: TextStyle(color: labelColor, fontSize: 12),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                color: valueColor,
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _getStatusColor(String status) {
    switch (status) {
      case 'pending':
        return AppTheme.warningColor;
      case 'connected':
        return AppTheme.successColor;
      case 'denied':
        return AppTheme.dangerColor;
      default:
        return AppTheme.secondaryColor;
    }
  }

  IconData _getDeviceIcon(String type) {
    final lowerType = type.toLowerCase();
    if (lowerType.contains('desktop') || lowerType.contains('computer')) {
      return Icons.computer;
    } else if (lowerType.contains('laptop')) {
      return Icons.laptop;
    } else if (lowerType.contains('mobile') || lowerType.contains('phone')) {
      return Icons.smartphone;
    } else if (lowerType.contains('tablet')) {
      return Icons.tablet;
    } else if (lowerType.contains('storage') ||
        lowerType.contains('flash') ||
        lowerType.contains('usb')) {
      return Icons.usb;
    } else if (lowerType.contains('printer')) {
      return Icons.print;
    } else if (lowerType.contains('camera')) {
      return Icons.camera_alt;
    } else if (lowerType.contains('keyboard')) {
      return Icons.keyboard;
    } else if (lowerType.contains('mouse')) {
      return Icons.mouse;
    }
    return Icons.device_unknown;
  }

  String _getStatusLabel(String status) {
    switch (status) {
      case 'pending':
        return 'في الانتظار';
      case 'connected':
        return 'متصل';
      case 'denied':
        return 'مرفوض';
      default:
        return 'غير معروف';
    }
  }

  String _formatDateString(String dateStr) {
    try {
      final date = DateTime.parse(dateStr);
      final now = DateTime.now();
      final difference = now.difference(date);

      if (difference.inDays > 0) {
        return 'منذ ${difference.inDays} يوم';
      } else if (difference.inHours > 0) {
        return 'منذ ${difference.inHours} ساعة';
      } else if (difference.inMinutes > 0) {
        return 'منذ ${difference.inMinutes} دقيقة';
      } else {
        return 'الآن';
      }
    } catch (e) {
      return dateStr;
    }
  }

  Future<void> _handleApprove(Map<String, dynamic> device) async {
    final deviceId = device['id']?.toString() ?? '';
    final deviceSerial =
        device['serial_number'] ?? device['serialNumber'] ?? '';
    final isAgentPending = device['is_agent_pending'] == true;

    // إنشاء مفتاح فريد للجهاز (للأجهزة المكتشفة التي ليس لها ID)
    final processingKey = isAgentPending
        ? 'agent_$deviceId'
        : (deviceId.isNotEmpty ? deviceId : 'pending_$deviceSerial');

    setState(() {
      _processingDevices.add(processingKey);
    });

    try {
      bool success = false;

      if (isAgentPending) {
        // الجهاز معلق من عميل - استخدم API الموافقة الخاص
        print('📱 Approving agent pending device: ${device['device_name']}');
        final result = await ApiService.approveAgentPendingDevice(deviceId);

        if (result['success'] == true) {
          success = true;
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Row(
                  children: [
                    const Icon(Icons.check_circle, color: Colors.white),
                    const SizedBox(width: 8),
                    Text('تمت الموافقة على جهاز العميل'),
                  ],
                ),
                backgroundColor: AppTheme.successColor,
              ),
            );
          }
        } else {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(result['error'] ?? 'فشلت الموافقة'),
                backgroundColor: AppTheme.dangerColor,
              ),
            );
          }
        }
      } else if (deviceId.isEmpty) {
        // الجهاز مكتشف فقط (ليس له ID) - نحتاج تسجيله أولاً
        print('📱 Registering discovered device: ${device['name']}');
        final result = await ApiService.registerDiscoveredDevice(device);

        if (result['success'] == true) {
          success = true;
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Row(
                  children: [
                    const Icon(Icons.check_circle, color: Colors.white),
                    const SizedBox(width: 8),
                    Text('تم تسجيل الجهاز والموافقة عليه'),
                  ],
                ),
                backgroundColor: AppTheme.successColor,
              ),
            );
          }
        } else {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(result['error'] ?? 'فشل تسجيل الجهاز'),
                backgroundColor: AppTheme.dangerColor,
              ),
            );
          }
        }
      } else {
        // الجهاز موجود في DB - نحتاج تحديث حالته فقط
        success = await SupabaseService.updateDeviceStatus(
          deviceId,
          'connected',
          whitelisted: true,
        );

        if (mounted) {
          if (success) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('تمت الموافقة على الجهاز'),
                backgroundColor: AppTheme.successColor,
              ),
            );
          } else {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('فشلت العملية'),
                backgroundColor: AppTheme.dangerColor,
              ),
            );
          }
        }
      }

      if (success) {
        await _loadDevices();
        // 🆕 الانتقال تلقائياً لتاب "متصل" بعد الموافقة كما طلب المستخدم
        if (mounted) {
          _tabController.animateTo(1);
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('خطأ في العملية: $e'),
            backgroundColor: AppTheme.dangerColor,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _processingDevices.remove(processingKey);
        });
      }
    }
  }

  Future<void> _handleDeny(Map<String, dynamic> device) async {
    final deviceId = device['id']?.toString() ?? '';
    final deviceSerial =
        device['serial_number'] ?? device['serialNumber'] ?? '';
    final deviceName =
        device['name'] ??
        device['device_name'] ??
        device['description'] ??
        'غير معروف';
    final isAgentPending = device['is_agent_pending'] == true;

    // إنشاء مفتاح فريد للجهاز
    final processingKey = isAgentPending
        ? 'agent_$deviceId'
        : (deviceId.isNotEmpty ? deviceId : 'pending_$deviceSerial');

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.grey[900],
        title: const Text('تأكيد الرفض', style: TextStyle(color: Colors.white)),
        content: Text(
          'هل أنت متأكد من رفض جهاز "$deviceName"؟',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('رفض', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    setState(() {
      _processingDevices.add(processingKey);
    });

    try {
      if (isAgentPending) {
        // الجهاز معلق من عميل - استخدم API الرفض الخاص
        print('📱 Rejecting agent pending device: $deviceName');
        final result = await ApiService.rejectAgentPendingDevice(deviceId);

        if (result['success'] == true) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('تم رفض جهاز العميل'),
                backgroundColor: AppTheme.warningColor,
              ),
            );
          }
          _loadDevices();
        } else {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(result['error'] ?? 'فشل رفض الجهاز'),
                backgroundColor: AppTheme.dangerColor,
              ),
            );
          }
        }
      } else if (deviceId.isEmpty) {
        // الجهاز مكتشف فقط - نحذفه من القائمة المحلية فقط
        setState(() {
          _pendingDevices.removeWhere((d) {
            final s = d['serial_number'] ?? d['serialNumber'] ?? '';
            return s == deviceSerial;
          });
        });

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('تم رفض الجهاز'),
              backgroundColor: AppTheme.warningColor,
            ),
          );
        }
      } else {
        // الجهاز موجود في DB - نحتاج تحديث حالته لـ blocked
        final success = await SupabaseService.updateDeviceStatus(
          deviceId,
          'blocked',
          blacklisted: true,
        );

        if (mounted) {
          if (success) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('تم رفض الجهاز'),
                backgroundColor: AppTheme.warningColor,
              ),
            );
            _loadDevices();
            // 🆕 الانتقال تلقائياً لتاب "المرفوضة" بعد الحظر
            if (mounted) {
              _tabController.animateTo(3);
            }
          } else {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('فشلت العملية'),
                backgroundColor: AppTheme.dangerColor,
              ),
            );
          }
        }
      }
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
        setState(() {
          _processingDevices.remove(processingKey);
        });
      }
    }
  }

  // عرض تفاصيل الجهاز الكاملة
  void _showDeviceDetails(Map<String, dynamic> device) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => Container(
        height: MediaQuery.of(context).size.height * 0.75,
        decoration: BoxDecoration(
          color: const Color(0xFF1E1E2E),
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
        ),
        child: Directionality(
          textDirection: TextDirection.rtl,
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
              // Title
              Padding(
                padding: const EdgeInsets.all(20),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppTheme.primaryColor.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(
                        Icons.usb,
                        color: AppTheme.primaryColor,
                        size: 24,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            device['name'] ?? 'جهاز غير معروف',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          Text(
                            device['manufacturer'] ?? 'غير محدد',
                            style: const TextStyle(
                              color: Colors.white60,
                              fontSize: 14,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close, color: Colors.white54),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    children: [
                      _buildModalDetailRow('الاسم', device['name'] ?? '-'),
                      _buildModalDetailRow(
                        'الشركة المصنعة',
                        device['manufacturer'] ?? '-',
                      ),
                      _buildModalDetailRow(
                        'Vendor ID',
                        device['vendor_id'] ?? '-',
                      ),
                      _buildModalDetailRow(
                        'Product ID',
                        device['product_id'] ?? '-',
                      ),
                      _buildModalDetailRow(
                        'الرقم التسلسلي',
                        device['serial_number'] ?? '-',
                      ),
                      _buildModalDetailRow(
                        'النوع',
                        device['device_type'] ?? device['type'] ?? '-',
                      ),
                      _buildModalDetailRow('الحالة', device['status'] ?? '-'),
                      _buildModalDetailRow(
                        'منفذ USB',
                        device['usb_port'] ?? '-',
                      ),
                      _buildModalDetailRow(
                        'وقت الاتصال',
                        device['connection_time'] ?? '-',
                      ),
                      _buildModalDetailRow(
                        'القائمة البيضاء',
                        device['whitelisted'] == true ? 'نعم' : 'لا',
                      ),
                      _buildModalDetailRow(
                        'القائمة السوداء',
                        device['blacklisted'] == true ? 'نعم' : 'لا',
                      ),

                      const SizedBox(height: 24),
                      // إجراءات
                      Row(
                        children: [
                          Expanded(
                            child: ElevatedButton.icon(
                              onPressed: () {
                                Navigator.pop(context);
                                _addToWhitelist(device);
                              },
                              icon: const Icon(Icons.check_circle, size: 18),
                              label: const Text('إضافة للقائمة البيضاء'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: Colors.green,
                                foregroundColor: Colors.white,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: ElevatedButton.icon(
                              onPressed: () {
                                Navigator.pop(context);
                                _addToBlacklist(device);
                              },
                              icon: const Icon(Icons.block, size: 18),
                              label: const Text('إضافة للقائمة السوداء'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: Colors.red,
                                foregroundColor: Colors.white,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () {
                                Navigator.pop(context);
                                _deleteDevice(device);
                              },
                              icon: const Icon(Icons.delete, size: 18),
                              label: const Text('حذف الجهاز'),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: Colors.red,
                                side: const BorderSide(color: Colors.red),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildModalDetailRow(String label, String value) {
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

  Future<void> _addToWhitelist(Map<String, dynamic> device) async {
    final deviceId = device['id']?.toString() ?? '';
    try {
      await SupabaseService.whitelistDevice(deviceId);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('تمت الإضافة للقائمة البيضاء'),
          backgroundColor: Colors.green,
        ),
      );
      _loadDevices();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('خطأ: $e'), backgroundColor: Colors.red),
      );
    }
  }

  Future<void> _addToBlacklist(Map<String, dynamic> device) async {
    final deviceId = device['id']?.toString() ?? '';
    try {
      await SupabaseService.blacklistDevice(deviceId);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('تمت الإضافة للقائمة السوداء'),
          backgroundColor: Colors.orange,
        ),
      );
      _loadDevices();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('خطأ: $e'), backgroundColor: Colors.red),
      );
    }
  }

  Future<void> _deleteDevice(Map<String, dynamic> device) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E2E),
        title: const Text('حذف الجهاز', style: TextStyle(color: Colors.white)),
        content: Text(
          'هل أنت متأكد من حذف ${device['name']}؟',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('حذف', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    final deviceId = device['id']?.toString() ?? '';
    try {
      await SupabaseService.deleteDevice(deviceId);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('تم حذف الجهاز'),
          backgroundColor: Colors.green,
        ),
      );
      _loadDevices();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('خطأ: $e'), backgroundColor: Colors.red),
      );
    }
  }
}
