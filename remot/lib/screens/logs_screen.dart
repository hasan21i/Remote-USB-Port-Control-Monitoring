import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'dart:ui';
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../utils/download_helper.dart' as web_download;
import '../services/supabase_service.dart';
import '../services/api_service.dart';
import '../config/supabase_config.dart';
import '../config/app_theme.dart';

/// شاشة السجلات - للأدمن فقط
class LogsScreen extends StatefulWidget {
  const LogsScreen({super.key});

  @override
  State<LogsScreen> createState() => _LogsScreenState();
}

class _LogsScreenState extends State<LogsScreen> {
  List<Map<String, dynamic>> _logs = [];
  bool _isLoading = true;
  String _filterAction = 'all';
  String _searchQuery = '';
  // افتراضي: عرض آخر 7 أيام
  DateTime? _startDate = DateTime.now().subtract(const Duration(days: 7));
  DateTime? _endDate = DateTime.now();

  final List<String> _actionTypes = [
    'all',
    'login',
    'logout',
    'device_connect',
    'device_disconnect',
    'device_block',
    'device_approve',
    'server_add',
    'server_delete',
    'user_create',
    'user_delete',
    'settings_change',
  ];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
    });

    // تحديث عنوان الـ API إذا تغير
    try {
      final activeIp = await SupabaseService.getActiveServerIp();
      if (activeIp != null) SupabaseConfig.updateApiUrl(activeIp);
    } catch (_) {}

    // جلب إحصائيات السجلات أولاً لبناء قائمة التصنيفات (نمرر فلتر الأيام)
    try {
      final days = _computeDaysRange();
      final stats = await ApiService.fetchLogStats(
        params: {'days': days.toString()},
      );
      final byActionRaw = stats['by_action'] ?? {};

      List<String> actions = [];
      try {
        if (byActionRaw is Map) {
          actions = byActionRaw.keys.map((k) => k.toString()).toList();
        } else if (byActionRaw is List) {
          for (var item in byActionRaw) {
            if (item is Map && item['action'] != null) {
              actions.add(item['action'].toString());
            } else {
              actions.add(item.toString());
            }
          }
        } else if (byActionRaw is String) {
          actions = byActionRaw
              .toString()
              .split(',')
              .map((s) => s.trim())
              .where((s) => s.isNotEmpty)
              .toList();
        }
      } catch (e) {
        print('⚠️ by_action parsing error: $e');
      }

      setState(() {
        _actionTypes.clear();
        _actionTypes.add('all');
        _actionTypes.addAll(actions);
      });
    } catch (e) {
      print('⚠️ Could not fetch log stats for actions: $e');
    }

    // جلب السجلات (فلتر الأيام مضمن في _loadLogs)
    await _loadLogs();
  }

  Future<void> _loadLogs() async {
    try {
      final days = _computeDaysRange();
      final start = _startDate;
      final end = _endDate;
      final logs = await ApiService.fetchLogs(
        limit: 1000,
        startDate: start,
        endDate: end,
        days: days,
        timeout: const Duration(seconds: 30),
      );

      // Notify user if fallback was used due to /logs timeout or errors
      if (ApiService.lastLogsFetchUsedFallback && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'تم استخدام فالباك لاسترجاع السجلات (الخادم لم يستجب بسرعة).',
            ),
            duration: Duration(seconds: 4),
          ),
        );
      }
      if (mounted) {
        setState(() {
          _logs = List<Map<String, dynamic>>.from(logs);
          _isLoading = false;
        });
        print('📋 Loaded ${_logs.length} logs (API, last $days days)');
      }
    } catch (e) {
      print('❌ Error loading logs from API: $e');
      // Fallback to Supabase direct query if API fails
      try {
        final fiveMinQuery = SupabaseService.client
            .from('logs')
            .select('*, users(name, username)')
            .order('timestamp', ascending: false)
            .limit(500);
        final response = await fiveMinQuery;
        if (mounted) {
          setState(() {
            _logs = List<Map<String, dynamic>>.from(response);
            _isLoading = false;
          });
          print('📋 Loaded ${_logs.length} logs (Supabase fallback)');
        }
      } catch (e2) {
        print('❌ Supabase fallback also failed: $e2');
        if (mounted) setState(() => _isLoading = false);
      }
    }
  }

  List<Map<String, dynamic>> get _filteredLogs {
    var filtered = _logs;

    if (_filterAction != 'all') {
      filtered = filtered.where((l) => l['action'] == _filterAction).toList();
    }

    if (_searchQuery.isNotEmpty) {
      filtered = filtered.where((l) {
        final action = (l['action'] ?? '').toString().toLowerCase();
        final details = (l['details'] ?? '').toString().toLowerCase();
        final ip = (l['ip_address'] ?? '').toString().toLowerCase();
        final target = (l['target_device'] ?? '').toString().toLowerCase();
        return action.contains(_searchQuery.toLowerCase()) ||
            details.contains(_searchQuery.toLowerCase()) ||
            ip.contains(_searchQuery.toLowerCase()) ||
            target.contains(_searchQuery.toLowerCase());
      }).toList();
    }

    if (_startDate != null) {
      filtered = filtered.where((l) {
        try {
          final logDate = DateTime.parse(l['timestamp'].toString());
          return logDate.isAfter(_startDate!);
        } catch (e) {
          return true;
        }
      }).toList();
    }

    if (_endDate != null) {
      filtered = filtered.where((l) {
        try {
          final logDate = DateTime.parse(l['timestamp'].toString());
          return logDate.isBefore(_endDate!.add(const Duration(days: 1)));
        } catch (e) {
          return true;
        }
      }).toList();
    }

    return filtered;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: ThemeColors.gradientColors(context),
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              _buildHeader(),
              _buildSearchBar(),
              const SizedBox(height: 12),
              _buildStatsBar(),
              _buildFilterBar(),
              Expanded(
                child: _isLoading
                    ? const Center(child: CircularProgressIndicator())
                    : _filteredLogs.isEmpty
                    ? _buildEmptyState()
                    : _buildLogsList(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.pop(context),
            icon: Icon(
              Icons.arrow_back_ios,
              color: ThemeColors.textPrimary(context),
            ),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.orange.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.history, color: Colors.orange, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'السجلات',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: ThemeColors.textPrimary(context),
                  ),
                ),
                Text(
                  'سجل الأنشطة',
                  style: TextStyle(
                    color: ThemeColors.textSecondary(context),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: _showExportDialog,
            icon: Icon(
              Icons.download,
              color: ThemeColors.textPrimary(context),
              size: 22,
            ),
            tooltip: 'تصدير',
            padding: const EdgeInsets.all(8),
          ),
          IconButton(
            onPressed: _showClearOptions,
            icon: Icon(
              Icons.delete_forever,
              color: ThemeColors.textPrimary(context),
              size: 22,
            ),
            tooltip: 'مسح',
            padding: const EdgeInsets.all(8),
          ),
          IconButton(
            onPressed: _loadData,
            icon: Icon(
              Icons.refresh,
              color: ThemeColors.textPrimary(context),
              size: 22,
            ),
            padding: const EdgeInsets.all(8),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchBar() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: ThemeColors.surfaceBackground(context),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: ThemeColors.borderColor(context)),
      ),
      child: Row(
        children: [
          Icon(
            Icons.search,
            color: ThemeColors.textSecondary(context).withValues(alpha: 0.5),
            size: 20,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              style: TextStyle(
                color: ThemeColors.textPrimary(context),
                fontSize: 14,
              ),
              onChanged: (value) => setState(() => _searchQuery = value),
              decoration: InputDecoration(
                hintText: 'بحث...',
                hintStyle: TextStyle(
                  color: ThemeColors.textSecondary(
                    context,
                  ).withValues(alpha: 0.5),
                  fontSize: 14,
                ),
                border: InputBorder.none,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
          IconButton(
            onPressed: _showDateFilter,
            icon: Icon(
              Icons.date_range,
              size: 20,
              color: (_startDate != null || _endDate != null)
                  ? AppTheme.primaryColor
                  : ThemeColors.textSecondary(context).withValues(alpha: 0.5),
            ),
            padding: const EdgeInsets.all(8),
            constraints: const BoxConstraints(),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterBar() {
    return Container(
      height: 42,
      margin: const EdgeInsets.symmetric(vertical: 8),
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: _actionTypes.length,
        itemBuilder: (context, index) {
          final action = _actionTypes[index];
          final isSelected = _filterAction == action;
          return Padding(
            padding: const EdgeInsets.only(right: 6),
            child: FilterChip(
              selected: isSelected,
              label: Text(_getActionLabel(action)),
              labelStyle: TextStyle(
                color: isSelected
                    ? Colors.white
                    : ThemeColors.textSecondary(context),
                fontSize: 11,
              ),
              backgroundColor: ThemeColors.surfaceBackground(context),
              selectedColor: AppTheme.primaryColor,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              onSelected: (_) => setState(() => _filterAction = action),
            ),
          );
        },
      ),
    );
  }

  Widget _buildStatsBar() {
    final today = _logs.where((l) {
      try {
        final logDate = DateTime.parse(l['timestamp'].toString());
        final now = DateTime.now();
        return logDate.day == now.day &&
            logDate.month == now.month &&
            logDate.year == now.year;
      } catch (e) {
        return false;
      }
    }).length;

    final errors = _logs.where((l) => l['success'] == false).length;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: ThemeColors.surfaceBackground(context),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: ThemeColors.borderColor(context)),
      ),
      child: Row(
        children: [
          _buildStatItem('المجموع', _logs.length.toString(), Colors.blue),
          _buildStatItem('اليوم', today.toString(), Colors.green),
          _buildStatItem('الأخطاء', errors.toString(), Colors.red),
          _buildStatItem(
            'النتائج',
            _filteredLogs.length.toString(),
            Colors.orange,
          ),
        ],
      ),
    );
  }

  Widget _buildStatItem(String label, String value, Color color) {
    return Expanded(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            value,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(
              color: ThemeColors.textSecondary(context),
              fontSize: 10,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.history,
            size: 80,
            color: ThemeColors.textSecondary(context).withValues(alpha: 0.3),
          ),
          const SizedBox(height: 16),
          Text(
            'لا توجد سجلات',
            style: TextStyle(
              color: ThemeColors.textSecondary(context).withValues(alpha: 0.7),
              fontSize: 18,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLogsList() {
    return RefreshIndicator(
      onRefresh: _loadLogs,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        itemCount: _filteredLogs.length,
        itemBuilder: (context, index) {
          return _buildLogCard(_filteredLogs[index]);
        },
      ),
    );
  }

  Widget _buildLogCard(Map<String, dynamic> log) {
    final action = log['action'] ?? 'unknown';
    final success = log['success'] != false;
    final actionColor = _getActionColor(action);
    final actionIcon = _getActionIcon(action);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: ThemeColors.cardBackground(context),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: success
              ? ThemeColors.borderColor(context)
              : Colors.red.withValues(alpha: 0.3),
        ),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 5, sigmaY: 5),
          child: InkWell(
            onTap: () => _showLogDetails(log),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: actionColor.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(actionIcon, color: actionColor, size: 20),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                _getActionLabel(action),
                                style: TextStyle(
                                  color: ThemeColors.textPrimary(context),
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                            if (!success)
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 6,
                                  vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.red.withValues(alpha: 0.2),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: const Text(
                                  'فشل',
                                  style: TextStyle(
                                    color: Colors.red,
                                    fontSize: 10,
                                  ),
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        if (log['details'] != null)
                          Text(
                            log['details'].toString(),
                            style: TextStyle(
                              color: ThemeColors.textSecondary(context),
                              fontSize: 12,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            Icon(
                              Icons.access_time,
                              size: 12,
                              color: ThemeColors.textSecondary(
                                context,
                              ).withValues(alpha: 0.5),
                            ),
                            const SizedBox(width: 4),
                            Text(
                              _formatDateTime(log['timestamp']),
                              style: TextStyle(
                                color: ThemeColors.textSecondary(
                                  context,
                                ).withValues(alpha: 0.5),
                                fontSize: 11,
                              ),
                            ),
                            if (log['ip_address'] != null) ...[
                              const SizedBox(width: 12),
                              Icon(
                                Icons.language,
                                size: 12,
                                color: ThemeColors.textSecondary(
                                  context,
                                ).withValues(alpha: 0.5),
                              ),
                              const SizedBox(width: 4),
                              Text(
                                log['ip_address'].toString(),
                                style: TextStyle(
                                  color: ThemeColors.textSecondary(
                                    context,
                                  ).withValues(alpha: 0.5),
                                  fontSize: 11,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    Icons.chevron_right,
                    color: ThemeColors.textSecondary(
                      context,
                    ).withValues(alpha: 0.5),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _showLogDetails(Map<String, dynamic> log) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => Container(
        height: MediaQuery.of(context).size.height * 0.6,
        decoration: BoxDecoration(
          color: ThemeColors.dialogBackground(context),
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          border: Border.all(color: ThemeColors.borderColor(context)),
        ),
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: ThemeColors.textSecondary(
                    context,
                  ).withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: _getActionColor(
                      log['action'],
                    ).withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    _getActionIcon(log['action']),
                    color: _getActionColor(log['action']),
                    size: 28,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Text(
                    _getActionLabel(log['action'] ?? 'unknown'),
                    style: TextStyle(
                      color: ThemeColors.textPrimary(context),
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            Expanded(
              child: ListView(
                children: [
                  _buildDetailRow(
                    'الحالة',
                    log['success'] != false ? 'نجاح' : 'فشل',
                  ),
                  _buildDetailRow(
                    'التاريخ والوقت',
                    _formatDateTime(log['timestamp']),
                  ),
                  _buildDetailRow('عنوان IP', log['ip_address'] ?? 'غير متوفر'),
                  _buildDetailRow(
                    'الجهاز المستهدف',
                    log['target_device'] ?? 'غير محدد',
                  ),
                  _buildDetailRow(
                    'التفاصيل',
                    log['details'] ?? 'لا توجد تفاصيل',
                  ),
                  if (log['users'] != null)
                    _buildDetailRow(
                      'المستخدم',
                      log['users']['name'] ??
                          log['users']['username'] ??
                          'غير معروف',
                    ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close),
                label: const Text('إغلاق'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: ThemeColors.surfaceBackground(context),
                  foregroundColor: ThemeColors.textPrimary(context),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            ),
          ],
        ),
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
            width: 120,
            child: Text(
              label,
              style: TextStyle(color: ThemeColors.textSecondary(context)),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(color: ThemeColors.textPrimary(context)),
            ),
          ),
        ],
      ),
    );
  }

  void _showDateFilter() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: ThemeColors.dialogBackground(context),
        title: Text(
          'تصفية حسب التاريخ',
          style: TextStyle(color: ThemeColors.textPrimary(context)),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: Text(
                'من تاريخ',
                style: TextStyle(color: ThemeColors.textSecondary(context)),
              ),
              subtitle: Text(
                _startDate != null
                    ? '${_startDate!.day}/${_startDate!.month}/${_startDate!.year}'
                    : 'غير محدد',
                style: TextStyle(color: ThemeColors.textPrimary(context)),
              ),
              trailing: Icon(
                Icons.calendar_today,
                color: ThemeColors.textSecondary(
                  context,
                ).withValues(alpha: 0.5),
              ),
              onTap: () async {
                final date = await showDatePicker(
                  context: context,
                  initialDate: _startDate ?? DateTime.now(),
                  firstDate: DateTime(2020),
                  lastDate: DateTime.now(),
                );
                if (date != null) {
                  setState(() => _startDate = date);
                  if (context.mounted) Navigator.pop(context);
                  _showDateFilter();
                }
              },
            ),
            ListTile(
              title: Text(
                'إلى تاريخ',
                style: TextStyle(color: ThemeColors.textSecondary(context)),
              ),
              subtitle: Text(
                _endDate != null
                    ? '${_endDate!.day}/${_endDate!.month}/${_endDate!.year}'
                    : 'غير محدد',
                style: TextStyle(color: ThemeColors.textPrimary(context)),
              ),
              trailing: Icon(
                Icons.calendar_today,
                color: ThemeColors.textSecondary(
                  context,
                ).withValues(alpha: 0.5),
              ),
              onTap: () async {
                final date = await showDatePicker(
                  context: context,
                  initialDate: _endDate ?? DateTime.now(),
                  firstDate: DateTime(2020),
                  lastDate: DateTime.now(),
                );
                if (date != null) {
                  setState(() => _endDate = date);
                  if (context.mounted) Navigator.pop(context);
                  _showDateFilter();
                }
              },
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              setState(() {
                _startDate = DateTime.now().subtract(const Duration(days: 7));
                _endDate = DateTime.now();
              });
              Navigator.pop(context);
              _loadData();
            },
            child: const Text('مسح الفلتر (الرجوع لآخر 7 أيام)'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              _loadData();
            },
            child: const Text('تطبيق'),
          ),
        ],
      ),
    );
  }

  void _showClearOptions() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: ThemeColors.dialogBackground(context),
        title: Row(
          children: [
            const Icon(Icons.delete_forever, color: Colors.red),
            const SizedBox(width: 8),
            Text(
              'مسح السجلات',
              style: TextStyle(color: ThemeColors.textPrimary(context)),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: Colors.orange),
              onPressed: () async {
                Navigator.pop(context);
                final ok = await _confirmClearDays(7);
                if (ok) await _clearLogs(7);
              },
              child: const Text('مسح سجلات آخر 7 أيام'),
            ),
            const SizedBox(height: 8),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: Colors.orange),
              onPressed: () async {
                Navigator.pop(context);
                final ok = await _confirmClearDays(30);
                if (ok) await _clearLogs(30);
              },
              child: const Text('مسح سجلات آخر 30 يوم'),
            ),
            const SizedBox(height: 8),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
              onPressed: () async {
                Navigator.pop(context);
                final ok = await _confirmClearAll();
                if (ok) await _clearAllLogs();
              },
              child: const Text('مسح كل السجلات (خطير)'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('إلغاء'),
          ),
        ],
      ),
    );
  }

  Future<bool> _confirmClearDays(int days) async {
    return await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            backgroundColor: ThemeColors.dialogBackground(context),
            title: Text(
              'تأكيد',
              style: TextStyle(color: ThemeColors.textPrimary(context)),
            ),
            content: Text(
              'هل أنت متأكد من مسح سجلات آخر $days يوم؟',
              style: TextStyle(color: ThemeColors.textSecondary(context)),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('إلغاء'),
              ),
              ElevatedButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('موافق'),
              ),
            ],
          ),
        ) ??
        false;
  }

  Future<bool> _confirmClearAll() async {
    return await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            backgroundColor: ThemeColors.dialogBackground(context),
            title: Text(
              'تأكيد مسح كل السجلات',
              style: TextStyle(color: ThemeColors.textPrimary(context)),
            ),
            content: Text(
              'هذا الإجراء سيحذف كل السجلات من النظام. هل تريد المتابعة؟',
              style: TextStyle(color: ThemeColors.textSecondary(context)),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('إلغاء'),
              ),
              ElevatedButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('موافق'),
              ),
            ],
          ),
        ) ??
        false;
  }

  Future<void> _clearLogs(int days) async {
    final success = await ApiService.clearLogs(days);
    if (success) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('تم مسح السجلات')));
      await _loadData();
    } else {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('فشل في مسح السجلات')));
    }
  }

  Future<void> _clearAllLogs() async {
    final success = await ApiService.clearAllLogs();
    if (success) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('تم مسح كل السجلات')));
      await _loadData();
    } else {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('فشل في مسح كل السجلات')));
    }
  }

  void _showExportDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E2E),
        title: const Row(
          children: [
            Icon(Icons.download, color: Colors.green),
            SizedBox(width: 8),
            Text('تصدير السجلات', style: TextStyle(color: Colors.white)),
          ],
        ),
        content: Text(
          'سيتم تصدير ${_filteredLogs.length} سجل بصيغة CSV',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('إلغاء'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              _exportLogs();
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.green,
              foregroundColor: Colors.white,
            ),
            child: const Text('تصدير'),
          ),
        ],
      ),
    );
  }

  Future<void> _exportLogs() async {
    if (_filteredLogs.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('لا توجد سجلات للتصدير')));
      return;
    }

    try {
      // إنشاء محتوى CSV
      StringBuffer csv = StringBuffer();
      csv.write('\uFEFF'); // UTF-8 BOM
      csv.writeln('التاريخ والوقت,النوع,التفاصيل,IP,الجهاز المستهدف,الحالة');

      for (var log in _filteredLogs) {
        final date = _formatDateTime(log['timestamp']);
        final type = _getActionLabel(log['action'] ?? '');
        final details = (log['details'] ?? '')
            .toString()
            .replaceAll(',', ' ')
            .replaceAll('\n', ' ');
        final ip = log['ip_address'] ?? '';
        final target = log['target_device'] ?? '';
        final status = (log['success'] != false) ? 'نجاح' : 'فشل';

        csv.writeln('$date,$type,$details,$ip,$target,$status');
      }

      final fileName =
          'Remot_Logs_${DateTime.now().millisecondsSinceEpoch}.csv';

      if (kIsWeb) {
        // للويب: تحميل مباشر
        web_download.downloadFile(csv.toString(), fileName);

        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('تم تحميل: $fileName'),
            backgroundColor: Colors.green,
          ),
        );
      } else {
        // للموبايل
        final directory = await getTemporaryDirectory();
        final filePath = '${directory.path}/$fileName';
        final file = File(filePath);
        await file.writeAsString(csv.toString());

        if (!mounted) return;
        await Share.shareXFiles([XFile(filePath)], text: 'سجلات نظام Remot');
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('خطأ في التصدير: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  String _formatDateTime(dynamic timestamp) {
    if (timestamp == null) return 'غير متوفر';
    try {
      final dt = DateTime.parse(timestamp.toString());
      return '${dt.day}/${dt.month}/${dt.year} ${dt.hour}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (e) {
      return 'غير متوفر';
    }
  }

  String _getActionLabel(String action) {
    final labels = {
      'all': 'الكل',
      'login': 'تسجيل دخول',
      'logout': 'تسجيل خروج',
      'device_connect': 'اتصال جهاز',
      'device_disconnect': 'انفصال جهاز',
      'device_block': 'حظر جهاز',
      'device_approve': 'موافقة على جهاز',
      'server_add': 'إضافة سيرفر',
      'server_delete': 'حذف سيرفر',
      'user_create': 'إنشاء مستخدم',
      'user_delete': 'حذف مستخدم',
      'settings_change': 'تغيير إعدادات',
    };
    return labels[action] ?? action;
  }

  int _computeDaysRange() {
    final end = _endDate ?? DateTime.now();
    final start = _startDate ?? end.subtract(const Duration(days: 7));
    final diff = end.difference(start).inDays;
    return (diff <= 0) ? 1 : diff + 1; // include both endpoints
  }

  Color _getActionColor(String? action) {
    final colors = {
      'login': Colors.green,
      'logout': Colors.orange,
      'device_connect': Colors.blue,
      'device_disconnect': Colors.grey,
      'device_block': Colors.red,
      'device_approve': Colors.green,
      'server_add': Colors.purple,
      'server_delete': Colors.red,
      'user_create': Colors.teal,
      'user_delete': Colors.red,
      'settings_change': Colors.amber,
    };
    return colors[action] ?? Colors.grey;
  }

  IconData _getActionIcon(String? action) {
    final icons = {
      'login': Icons.login,
      'logout': Icons.logout,
      'device_connect': Icons.usb,
      'device_disconnect': Icons.usb_off,
      'device_block': Icons.block,
      'device_approve': Icons.check_circle,
      'server_add': Icons.dns,
      'server_delete': Icons.delete,
      'user_create': Icons.person_add,
      'user_delete': Icons.person_remove,
      'settings_change': Icons.settings,
    };
    return icons[action] ?? Icons.info;
  }
}
