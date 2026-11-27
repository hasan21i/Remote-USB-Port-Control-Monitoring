import 'package:flutter/material.dart';
import 'dart:async';
import 'dart:ui';
import '../services/supabase_service.dart';
import '../config/app_theme.dart';

/// شاشة مراقبة السيرفرات
class ServersScreen extends StatefulWidget {
  const ServersScreen({super.key});

  @override
  State<ServersScreen> createState() => _ServersScreenState();
}

class _ServersScreenState extends State<ServersScreen> {
  List<Map<String, dynamic>> _servers = [];
  bool _isLoading = true;
  String _filterStatus = 'all';
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _loadServers();
    _refreshTimer = Timer.periodic(
      const Duration(seconds: 30),
      (_) => _loadServers(),
    );
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadServers() async {
    try {
      final servers = await SupabaseService.getServers();
      if (mounted) {
        setState(() {
          _servers = servers;
          _isLoading = false;
        });
        print('🖥️ Loaded ${servers.length} servers from Supabase');
      }
    } catch (e) {
      print('❌ Error loading servers: $e');
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  List<Map<String, dynamic>> get _filteredServers {
    if (_filterStatus == 'all') return _servers;
    return _servers.where((s) {
      final isOnline = s['is_online'] == true;
      if (_filterStatus == 'online') return isOnline;
      if (_filterStatus == 'offline') return !isOnline;
      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(),
            _buildStatsBar(),
            _buildFilterBar(),
            Expanded(
              child: _isLoading
                  ? const Center(child: CircularProgressIndicator())
                  : _filteredServers.isEmpty
                  ? _buildEmptyState()
                  : _buildServersList(),
            ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        heroTag: 'servers_fab',
        onPressed: _showAddServerDialog,
        backgroundColor: AppTheme.primaryColor,
        child: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.all(20),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.blue.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.dns, color: Colors.blue, size: 28),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'السيرفرات',
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: ThemeColors.textPrimary(context),
                  ),
                ),
                Text(
                  'مراقبة وإدارة الخوادم',
                  style: TextStyle(
                    color: ThemeColors.textSecondary(context),
                    fontSize: 14,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: _loadServers,
            icon: Icon(Icons.refresh, color: ThemeColors.textPrimary(context)),
          ),
        ],
      ),
    );
  }

  Widget _buildStatsBar() {
    final online = _servers.where((s) => s['is_online'] == true).length;
    final offline = _servers.length - online;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: ThemeColors.surfaceBackground(context),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: ThemeColors.borderColor(context)),
      ),
      child: Row(
        children: [
          _buildStatItem('المجموع', _servers.length.toString(), Colors.blue),
          _buildStatItem('متصل', online.toString(), Colors.green),
          _buildStatItem('منفصل', offline.toString(), Colors.red),
        ],
      ),
    );
  }

  Widget _buildStatItem(String label, String value, Color color) {
    return Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: TextStyle(
              color: ThemeColors.textSecondary(context),
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterBar() {
    return Container(
      margin: const EdgeInsets.all(20),
      child: Row(
        children: [
          _buildFilterChip('الكل', 'all'),
          const SizedBox(width: 8),
          _buildFilterChip('متصل', 'online'),
          const SizedBox(width: 8),
          _buildFilterChip('منفصل', 'offline'),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String label, String value) {
    final isSelected = _filterStatus == value;
    return GestureDetector(
      onTap: () => setState(() => _filterStatus = value),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected
              ? AppTheme.primaryColor
              : ThemeColors.surfaceBackground(context),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: ThemeColors.borderColor(context)),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected
                ? Colors.white
                : ThemeColors.textSecondary(context),
            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.dns_outlined,
            size: 80,
            color: Colors.white.withValues(alpha: 0.3),
          ),
          const SizedBox(height: 16),
          Text(
            'لا توجد سيرفرات',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.7),
              fontSize: 18,
            ),
          ),
          const SizedBox(height: 8),
          ElevatedButton.icon(
            onPressed: _showAddServerDialog,
            icon: const Icon(Icons.add),
            label: const Text('إضافة سيرفر'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.primaryColor,
              foregroundColor: Colors.white,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildServersList() {
    return RefreshIndicator(
      onRefresh: _loadServers,
      child: ListView.builder(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        itemCount: _filteredServers.length,
        itemBuilder: (context, index) {
          return _buildServerCard(_filteredServers[index]);
        },
      ),
    );
  }

  Widget _buildServerCard(Map<String, dynamic> server) {
    final isOnline = server['is_online'] == true;
    final status = isOnline ? 'متصل' : 'منفصل';
    final statusColor = isOnline ? Colors.green : Colors.red;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: statusColor.withValues(alpha: 0.3), width: 1),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
          child: InkWell(
            onTap: () => _showServerDetails(server),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: statusColor.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Icon(Icons.dns, color: statusColor, size: 24),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              server['name'] ?? 'سيرفر غير معروف',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: ThemeColors.textPrimary(context),
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              server['ip_address'] ?? 'N/A',
                              style: TextStyle(
                                color: ThemeColors.textSecondary(context),
                                fontSize: 13,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: statusColor.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              width: 8,
                              height: 8,
                              decoration: BoxDecoration(
                                color: statusColor,
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Text(
                              status,
                              style: TextStyle(
                                color: statusColor,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ),
                      PopupMenuButton<String>(
                        icon: Icon(
                          Icons.more_vert,
                          color: ThemeColors.textSecondary(context),
                        ),
                        color: ThemeColors.dialogBackground(context),
                        onSelected: (value) =>
                            _handleServerAction(value, server),
                        itemBuilder: (context) => [
                          PopupMenuItem(
                            value: 'ping',
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.network_ping,
                                  color: Colors.blue,
                                  size: 20,
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  'إرسال نبض',
                                  style: TextStyle(
                                    color: ThemeColors.textPrimary(context),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          PopupMenuItem(
                            value: 'edit',
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.edit,
                                  color: Colors.orange,
                                  size: 20,
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  'تعديل',
                                  style: TextStyle(
                                    color: ThemeColors.textPrimary(context),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          PopupMenuItem(
                            value: 'delete',
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.delete,
                                  color: Colors.red,
                                  size: 20,
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  'حذف',
                                  style: TextStyle(
                                    color: ThemeColors.textPrimary(context),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: _buildInfoItem(
                          Icons.computer,
                          'النظام',
                          server['os'] ?? 'غير محدد',
                        ),
                      ),
                      Expanded(
                        child: _buildInfoItem(
                          Icons.memory,
                          'CPU',
                          _formatCpuInfo(server['cpu']),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: _buildInfoItem(
                          Icons.storage,
                          'RAM',
                          _formatRamInfo(server['ram']),
                        ),
                      ),
                      Expanded(
                        child: _buildInfoItem(
                          Icons.access_time,
                          'آخر اتصال',
                          _formatLastHeartbeat(server['last_heartbeat']),
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
    );
  }

  Widget _buildInfoItem(IconData icon, String label, String value) {
    return Row(
      children: [
        Icon(
          icon,
          size: 16,
          color: ThemeColors.textSecondary(context).withValues(alpha: 0.6),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  color: ThemeColors.textSecondary(
                    context,
                  ).withValues(alpha: 0.5),
                  fontSize: 10,
                ),
              ),
              Text(
                value,
                style: TextStyle(
                  color: ThemeColors.textPrimary(context),
                  fontSize: 12,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ],
    );
  }

  String _formatCpuInfo(dynamic cpu) {
    if (cpu == null) return 'غير متوفر';
    String cpuStr = cpu.toString();
    if (cpuStr.contains('Intel')) {
      final match = RegExp(
        r'Intel\(R\) Core\(TM\) (i\d-\d+\w*)',
      ).firstMatch(cpuStr);
      if (match != null) return 'Intel ${match.group(1)}';
    }
    if (cpuStr.contains('AMD')) {
      return 'AMD Processor';
    }
    if (cpuStr.length > 20) {
      return '${cpuStr.substring(0, 20)}...';
    }
    return cpuStr;
  }

  String _formatRamInfo(dynamic ram) {
    if (ram == null) return 'غير متوفر';
    String ramStr = ram.toString();
    final match = RegExp(
      r'(\d+\.?\d*)\s*(GB|MB|TB)',
      caseSensitive: false,
    ).firstMatch(ramStr);
    if (match != null) {
      return '${match.group(1)} ${match.group(2)}';
    }
    if (ramStr.length > 15) {
      return '${ramStr.substring(0, 15)}...';
    }
    return ramStr;
  }

  String _formatLastHeartbeat(dynamic lastHeartbeat) {
    if (lastHeartbeat == null) return 'غير متوفر';
    try {
      final dt = DateTime.parse(lastHeartbeat.toString());
      final now = DateTime.now();
      final diff = now.difference(dt);

      if (diff.inMinutes < 1) return 'الآن';
      if (diff.inMinutes < 60) return 'منذ ${diff.inMinutes} دقيقة';
      if (diff.inHours < 24) return 'منذ ${diff.inHours} ساعة';
      return 'منذ ${diff.inDays} يوم';
    } catch (e) {
      return 'غير متوفر';
    }
  }

  void _handleServerAction(String action, Map<String, dynamic> server) {
    switch (action) {
      case 'ping':
        _sendPing(server);
        break;
      case 'edit':
        _showEditServerDialog(server);
        break;
      case 'delete':
        _confirmDeleteServer(server);
        break;
    }
  }

  Future<void> _sendPing(Map<String, dynamic> server) async {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E2E),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 16),
            Text(
              'جاري إرسال نبض إلى ${server['name']}...',
              style: const TextStyle(color: Colors.white),
            ),
          ],
        ),
      ),
    );

    await Future.delayed(const Duration(seconds: 2));

    if (!mounted) return;
    Navigator.pop(context);

    final isOnline = server['is_online'] == true;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(
              isOnline ? Icons.check_circle : Icons.error,
              color: Colors.white,
            ),
            const SizedBox(width: 8),
            Text(
              isOnline
                  ? 'السيرفر ${server['name']} يستجيب بنجاح!'
                  : 'السيرفر ${server['name']} لا يستجيب',
            ),
          ],
        ),
        backgroundColor: isOnline ? Colors.green : Colors.red,
      ),
    );
  }

  void _showServerDetails(Map<String, dynamic> server) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => Container(
        height: MediaQuery.of(context).size.height * 0.7,
        decoration: BoxDecoration(
          color: const Color(0xFF1E1E2E),
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
        ),
        child: Column(
          children: [
            Container(
              margin: const EdgeInsets.only(top: 12),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color:
                          (server['is_online'] == true
                                  ? Colors.green
                                  : Colors.red)
                              .withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(
                      Icons.dns,
                      color: server['is_online'] == true
                          ? Colors.green
                          : Colors.red,
                      size: 28,
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          server['name'] ?? 'سيرفر',
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                          ),
                        ),
                        Text(
                          server['ip_address'] ?? 'N/A',
                          style: const TextStyle(color: Colors.white70),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close, color: Colors.white70),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                children: [
                  _buildDetailCard('معلومات السيرفر', [
                    _buildDetailRow('الاسم', server['name'] ?? 'غير محدد'),
                    _buildDetailRow('IP', server['ip_address'] ?? 'غير محدد'),
                    _buildDetailRow(
                      'الحالة',
                      server['is_online'] == true ? 'متصل' : 'منفصل',
                    ),
                    _buildDetailRow('النظام', server['os'] ?? 'غير محدد'),
                  ]),
                  const SizedBox(height: 16),
                  _buildDetailCard('المواصفات', [
                    _buildDetailRow('المعالج', server['cpu'] ?? 'غير محدد'),
                    _buildDetailRow('الذاكرة', server['ram'] ?? 'غير محدد'),
                    _buildDetailRow('القرص', server['disk'] ?? 'غير محدد'),
                  ]),
                  const SizedBox(height: 16),
                  _buildDetailCard('الاتصال', [
                    _buildDetailRow(
                      'آخر نبض',
                      _formatLastHeartbeat(server['last_heartbeat']),
                    ),
                    _buildDetailRow(
                      'تاريخ الإضافة',
                      _formatDate(server['created_at']),
                    ),
                  ]),
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: () {
                            Navigator.pop(context);
                            _sendPing(server);
                          },
                          icon: const Icon(Icons.network_ping),
                          label: const Text('إرسال نبض'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.blue,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: () {
                            Navigator.pop(context);
                            _showEditServerDialog(server);
                          },
                          icon: const Icon(Icons.edit),
                          label: const Text('تعديل'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.orange,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDetailCard(String title, List<Widget> children) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: Colors.white,
            ),
          ),
          const Divider(color: Colors.white24),
          ...children,
        ],
      ),
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(
              label,
              style: TextStyle(color: Colors.white.withValues(alpha: 0.7)),
            ),
          ),
          Expanded(
            child: Text(value, style: const TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  String _formatDate(dynamic date) {
    if (date == null) return 'غير متوفر';
    try {
      final dt = DateTime.parse(date.toString());
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (e) {
      return 'غير متوفر';
    }
  }

  void _showAddServerDialog() {
    final nameController = TextEditingController();
    final ipController = TextEditingController();
    final osController = TextEditingController();
    final cpuController = TextEditingController();
    final ramController = TextEditingController();
    String selectedType = 'main';
    String selectedRole = 'primary';

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            backgroundColor: const Color(0xFF1E1E2E),
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
                const Expanded(
                  child: Text(
                    'إضافة سيرفر جديد',
                    style: TextStyle(color: Colors.white, fontSize: 18),
                  ),
                ),
              ],
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // المعلومات الأساسية
                  _buildSectionTitle('المعلومات الأساسية'),
                  const SizedBox(height: 12),
                  _buildDialogTextField(
                    nameController,
                    'اسم السيرفر *',
                    Icons.dns,
                  ),
                  const SizedBox(height: 12),
                  _buildDialogTextField(
                    ipController,
                    'عنوان IP *',
                    Icons.language,
                  ),
                  const SizedBox(height: 12),
                  _buildDialogTextField(
                    osController,
                    'نظام التشغيل',
                    Icons.computer,
                  ),

                  const SizedBox(height: 20),
                  _buildSectionTitle('مواصفات الأجهزة'),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: _buildDialogTextField(
                          cpuController,
                          'المعالج (CPU)',
                          Icons.memory,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _buildDialogTextField(
                          ramController,
                          'الذاكرة (RAM)',
                          Icons.storage,
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 20),
                  _buildSectionTitle('نوع السيرفر'),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _buildTypeChip(
                        'main',
                        'رئيسي',
                        Icons.star,
                        Colors.amber,
                        selectedType,
                        (v) => setDialogState(() => selectedType = v),
                      ),
                      _buildTypeChip(
                        'backup',
                        'احتياطي',
                        Icons.backup,
                        Colors.blue,
                        selectedType,
                        (v) => setDialogState(() => selectedType = v),
                      ),
                      _buildTypeChip(
                        'agent',
                        'عميل',
                        Icons.computer,
                        Colors.purple,
                        selectedType,
                        (v) => setDialogState(() => selectedType = v),
                      ),
                    ],
                  ),

                  const SizedBox(height: 20),
                  _buildSectionTitle('الدور'),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _buildTypeChip(
                        'primary',
                        'أساسي',
                        Icons.looks_one,
                        Colors.green,
                        selectedRole,
                        (v) => setDialogState(() => selectedRole = v),
                      ),
                      _buildTypeChip(
                        'secondary',
                        'ثانوي',
                        Icons.looks_two,
                        Colors.orange,
                        selectedRole,
                        (v) => setDialogState(() => selectedRole = v),
                      ),
                      _buildTypeChip(
                        'standby',
                        'استعداد',
                        Icons.pause_circle,
                        Colors.grey,
                        selectedRole,
                        (v) => setDialogState(() => selectedRole = v),
                      ),
                    ],
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
              ElevatedButton.icon(
                onPressed: () async {
                  if (nameController.text.isEmpty ||
                      ipController.text.isEmpty) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text(
                          'يرجى ملء الحقول المطلوبة (الاسم وعنوان IP)',
                        ),
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
                      'role': selectedRole,
                      'is_online': false,
                      'status': 'offline',
                      'created_at': DateTime.now().toIso8601String(),
                    });

                    if (!context.mounted) return;
                    Navigator.pop(context);
                    _loadServers();
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Row(
                          children: [
                            Icon(Icons.check_circle, color: Colors.white),
                            SizedBox(width: 8),
                            Text('تم إضافة السيرفر بنجاح'),
                          ],
                        ),
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
                label: const Text('إضافة السيرفر'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 20,
                    vertical: 12,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Text(
      title,
      style: TextStyle(
        color: Colors.white.withValues(alpha: 0.7),
        fontSize: 13,
        fontWeight: FontWeight.w600,
      ),
    );
  }

  Widget _buildTypeChip(
    String value,
    String label,
    IconData icon,
    Color color,
    String selected,
    Function(String) onSelect,
  ) {
    final isSelected = selected == value;
    return InkWell(
      onTap: () => onSelect(value),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected
              ? color.withValues(alpha: 0.3)
              : Colors.white.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? color : Colors.white.withValues(alpha: 0.1),
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: isSelected ? color : Colors.white54, size: 16),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                color: isSelected ? color : Colors.white70,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showEditServerDialog(Map<String, dynamic> server) {
    final nameController = TextEditingController(text: server['name'] ?? '');
    final ipController = TextEditingController(
      text: server['ip_address'] ?? '',
    );
    final osController = TextEditingController(text: server['os'] ?? '');

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E2E),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.edit, color: Colors.orange),
            SizedBox(width: 8),
            Text('تعديل السيرفر', style: TextStyle(color: Colors.white)),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _buildDialogTextField(nameController, 'اسم السيرفر', Icons.dns),
              const SizedBox(height: 16),
              _buildDialogTextField(ipController, 'عنوان IP', Icons.language),
              const SizedBox(height: 16),
              _buildDialogTextField(
                osController,
                'نظام التشغيل',
                Icons.computer,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('إلغاء'),
          ),
          ElevatedButton(
            onPressed: () async {
              try {
                await SupabaseService.client
                    .from('servers')
                    .update({
                      'name': nameController.text,
                      'ip_address': ipController.text,
                      'os': osController.text,
                    })
                    .eq('id', server['id']);

                if (!context.mounted) return;
                Navigator.pop(context);
                _loadServers();
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('تم تحديث السيرفر بنجاح'),
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
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.orange,
              foregroundColor: Colors.white,
            ),
            child: const Text('حفظ'),
          ),
        ],
      ),
    );
  }

  void _confirmDeleteServer(Map<String, dynamic> server) {
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
        content: Text(
          'هل أنت متأكد من حذف السيرفر "${server['name']}"؟',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('إلغاء'),
          ),
          ElevatedButton(
            onPressed: () async {
              try {
                await SupabaseService.client
                    .from('servers')
                    .delete()
                    .eq('id', server['id']);

                if (!context.mounted) return;
                Navigator.pop(context);
                _loadServers();
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('تم حذف السيرفر بنجاح'),
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
        labelStyle: const TextStyle(color: Colors.white70),
        prefixIcon: Icon(icon, color: Colors.white54),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.3)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.3)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppTheme.primaryColor),
        ),
        filled: true,
        fillColor: Colors.white.withValues(alpha: 0.05),
      ),
    );
  }
}
