import 'package:flutter/material.dart';
import '../config/app_theme.dart';
import '../services/supabase_service.dart';

/// صفحة التنبيهات - عرض وإدارة التنبيهات بتصميم زجاجي
class AlertsScreen extends StatefulWidget {
  const AlertsScreen({super.key});

  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
  List<Map<String, dynamic>> _alerts = [];
  bool _isLoading = true;
  String _selectedPriority = 'all';
  bool _showResolved = false;
  final Set<String> _processingAlerts = {};
  Map<String, int> _stats = {'high': 0, 'medium': 0, 'low': 0};

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    await Future.wait([_loadAlerts(), _loadStats()]);
  }

  Future<void> _loadAlerts() async {
    if (!mounted) return;
    setState(() => _isLoading = true);

    try {
      // جلب التنبيهات من Supabase مباشرة
      final alerts = await SupabaseService.getAlerts(limit: 100);

      // فلترة حسب الأولوية
      var filteredAlerts = List<Map<String, dynamic>>.from(alerts);
      if (_selectedPriority != 'all') {
        filteredAlerts = filteredAlerts.where((a) {
          final priority = (a['priority'] ?? a['severity'] ?? 'low')
              .toString()
              .toLowerCase();
          return priority == _selectedPriority;
        }).toList();
      }

      // فلترة حسب حالة الحل
      if (!_showResolved) {
        filteredAlerts = filteredAlerts.where((a) {
          return a['resolved'] != true && a['is_resolved'] != true;
        }).toList();
      }

      if (mounted) {
        setState(() {
          _alerts = filteredAlerts;
          _isLoading = false;
        });
      }

      print('📢 Loaded ${_alerts.length} alerts');
    } catch (e) {
      print('❌ Error loading alerts: $e');
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _loadStats() async {
    try {
      final alerts = await SupabaseService.getAlerts(limit: 500);

      int high = 0, medium = 0, low = 0;

      for (final alert in alerts) {
        final priority = (alert['priority'] ?? alert['severity'] ?? 'low')
            .toString()
            .toLowerCase();
        final resolved =
            alert['resolved'] == true || alert['is_resolved'] == true;

        if (!resolved) {
          if (priority == 'high' || priority == 'critical') {
            high++;
          } else if (priority == 'medium' || priority == 'normal') {
            medium++;
          } else {
            low++;
          }
        }
      }

      if (mounted) {
        setState(() => _stats = {'high': high, 'medium': medium, 'low': low});
      }
    } catch (e) {
      print('❌ Error loading stats: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          top: false,
          child: Padding(
            padding: EdgeInsets.only(
              top: MediaQuery.of(context).padding.top + kToolbarHeight + 10,
            ),
            child: Column(
              children: [
                // رأس الصفحة
                _buildHeader(),

                // إحصائيات التنبيهات
                _buildStatsBar(),

                // الفلاتر
                _buildFilters(),

                // قائمة التنبيهات
                Expanded(
                  child: _isLoading
                      ? _buildLoadingWidget()
                      : RefreshIndicator(
                          onRefresh: _loadData,
                          color: AppTheme.primaryColor,
                          child: _alerts.isEmpty
                              ? _buildEmptyState()
                              : ListView.builder(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 16,
                                    vertical: 8,
                                  ),
                                  itemCount: _alerts.length,
                                  itemBuilder: (context, index) {
                                    return _buildAlertCard(_alerts[index]);
                                  },
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

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppTheme.warningColor.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              Icons.notifications_active,
              color: AppTheme.warningColor,
              size: 24,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'التنبيهات',
                  style: TextStyle(
                    color: ThemeColors.textPrimary(context),
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  'إجمالي ${_alerts.length} تنبيه',
                  style: TextStyle(
                    color: ThemeColors.textSecondary(context),
                    fontSize: 14,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: _loadData,
            icon: Icon(
              Icons.refresh,
              color: ThemeColors.textPrimary(context).withValues(alpha: 0.8),
            ),
          ),
        ],
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
              const Text(
                'جاري تحميل التنبيهات...',
                style: TextStyle(color: Colors.white),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatsBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          Expanded(
            child: _buildStatCard(
              'عالية',
              _stats['high'] ?? 0,
              AppTheme.dangerColor,
              Icons.priority_high,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: _buildStatCard(
              'متوسطة',
              _stats['medium'] ?? 0,
              AppTheme.warningColor,
              Icons.warning,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: _buildStatCard(
              'منخفضة',
              _stats['low'] ?? 0,
              AppTheme.infoColor,
              Icons.info,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatCard(String label, int count, Color color, IconData icon) {
    return GlassCard(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
      child: Column(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(height: 4),
          Text(
            count.toString(),
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: ThemeColors.textSecondary(context),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilters() {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 12),
      padding: const EdgeInsets.symmetric(horizontal: 16),
      height: 40,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          _buildFilterChip('الكل', 'all'),
          _buildFilterChip('عالية', 'high'),
          _buildFilterChip('متوسطة', 'medium'),
          _buildFilterChip('منخفضة', 'low'),
          const SizedBox(width: 16),
          _buildResolvedToggle(),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String label, String value) {
    final isSelected = _selectedPriority == value;
    return Padding(
      padding: const EdgeInsets.only(left: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: isSelected,
        onSelected: (selected) {
          if (selected) {
            setState(() => _selectedPriority = value);
            _loadAlerts();
          }
        },
        backgroundColor: ThemeColors.surfaceBackground(context),
        selectedColor: AppTheme.primaryColor.withValues(alpha: 0.3),
        labelStyle: TextStyle(
          color: isSelected
              ? AppTheme.primaryColor
              : ThemeColors.textSecondary(context),
          fontSize: 12,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        side: BorderSide(
          color: isSelected
              ? AppTheme.primaryColor
              : ThemeColors.borderColor(context),
        ),
      ),
    );
  }

  Widget _buildResolvedToggle() {
    return ChoiceChip(
      label: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            _showResolved ? Icons.check_circle : Icons.check_circle_outline,
            size: 16,
            color: _showResolved
                ? Colors.white
                : ThemeColors.textSecondary(context),
          ),
          const SizedBox(width: 4),
          const Text('تم حلها'),
        ],
      ),
      selected: _showResolved,
      onSelected: (selected) {
        setState(() => _showResolved = selected);
        _loadAlerts();
      },
      backgroundColor: ThemeColors.surfaceBackground(context),
      selectedColor: AppTheme.successColor.withValues(alpha: 0.3),
      labelStyle: TextStyle(
        color: _showResolved
            ? Colors.white
            : ThemeColors.textSecondary(context),
        fontSize: 12,
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      side: BorderSide(
        color: _showResolved
            ? AppTheme.successColor
            : ThemeColors.borderColor(context),
      ),
    );
  }

  Widget _buildAlertCard(Map<String, dynamic> alert) {
    final alertId = alert['id']?.toString() ?? '';
    final isProcessing = _processingAlerts.contains(alertId);
    final priority = (alert['priority'] ?? alert['severity'] ?? 'low')
        .toString()
        .toLowerCase();
    final color = _getPriorityColor(priority);
    final isResolved =
        alert['resolved'] == true || alert['is_resolved'] == true;

    final message = alert['message'] ?? alert['title'] ?? 'تنبيه غير معروف';
    final description = alert['description'] ?? alert['details'] ?? '';
    final deviceName =
        alert['device_name'] ?? alert['server_name'] ?? 'غير محدد';
    final createdAt = alert['created_at'] ?? '';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      child: GlassCard(
        child: Container(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  // أيقونة الأولوية
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: 0.15),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      isResolved
                          ? Icons.check_circle
                          : _getPriorityIcon(priority),
                      color: isResolved ? AppTheme.successColor : color,
                      size: 24,
                    ),
                  ),
                  const SizedBox(width: 12),

                  // المحتوى
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          message,
                          style: TextStyle(
                            color: ThemeColors.textPrimary(context),
                            fontWeight: FontWeight.bold,
                            fontSize: 14,
                          ),
                          maxLines: 2,
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
                              ).withValues(alpha: 0.6),
                            ),
                            const SizedBox(width: 4),
                            Text(
                              _formatDate(createdAt),
                              style: TextStyle(
                                color: ThemeColors.textSecondary(context),
                                fontSize: 11,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Icon(
                              Icons.devices,
                              size: 12,
                              color: ThemeColors.textSecondary(
                                context,
                              ).withValues(alpha: 0.6),
                            ),
                            const SizedBox(width: 4),
                            Flexible(
                              child: Text(
                                deviceName,
                                style: TextStyle(
                                  color: ThemeColors.textSecondary(context),
                                  fontSize: 11,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),

                  // شارة الأولوية
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      _getPriorityLabel(priority),
                      style: TextStyle(
                        color: color,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),

              // التفاصيل إذا وجدت
              if (description.toString().isNotEmpty) ...[
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: ThemeColors.surfaceBackground(context),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    description.toString(),
                    style: TextStyle(
                      color: ThemeColors.textSecondary(context),
                      fontSize: 12,
                    ),
                  ),
                ),
              ],

              // أزرار الإجراءات
              if (!isResolved) ...[
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: isProcessing
                            ? null
                            : () => _resolveAlert(alertId),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppTheme.successColor,
                          side: BorderSide(
                            color: AppTheme.successColor.withValues(alpha: 0.5),
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                        icon: isProcessing
                            ? SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: AppTheme.successColor,
                                ),
                              )
                            : const Icon(Icons.check, size: 16),
                        label: Text(isProcessing ? 'جاري...' : 'تم الحل'),
                      ),
                    ),
                  ],
                ),
              ] else ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    Icon(
                      Icons.check_circle,
                      color: AppTheme.successColor,
                      size: 16,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      'تم حل هذا التنبيه',
                      style: TextStyle(
                        color: AppTheme.successColor,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: GlassCard(
        child: Container(
          padding: const EdgeInsets.all(40),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.notifications_off_outlined,
                size: 60,
                color: Colors.white.withValues(alpha: 0.3),
              ),
              const SizedBox(height: 16),
              Text(
                _showResolved
                    ? 'لا توجد تنبيهات محلولة'
                    : 'لا توجد تنبيهات نشطة',
                style: TextStyle(color: Colors.white60, fontSize: 16),
              ),
              const SizedBox(height: 8),
              Text(
                'النظام يعمل بشكل طبيعي',
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.4),
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Color _getPriorityColor(String priority) {
    switch (priority.toLowerCase()) {
      case 'high':
      case 'critical':
        return AppTheme.dangerColor;
      case 'medium':
      case 'normal':
        return AppTheme.warningColor;
      default:
        return AppTheme.infoColor;
    }
  }

  IconData _getPriorityIcon(String priority) {
    switch (priority.toLowerCase()) {
      case 'high':
      case 'critical':
        return Icons.error;
      case 'medium':
      case 'normal':
        return Icons.warning;
      default:
        return Icons.info;
    }
  }

  String _getPriorityLabel(String priority) {
    switch (priority.toLowerCase()) {
      case 'high':
      case 'critical':
        return 'عالية';
      case 'medium':
      case 'normal':
        return 'متوسطة';
      default:
        return 'منخفضة';
    }
  }

  String _formatDate(String dateStr) {
    if (dateStr.isEmpty) return 'غير محدد';

    try {
      final date = DateTime.parse(dateStr);
      final diff = DateTime.now().difference(date);
      if (diff.inDays > 0) return 'منذ ${diff.inDays} يوم';
      if (diff.inHours > 0) return 'منذ ${diff.inHours} ساعة';
      if (diff.inMinutes > 0) return 'منذ ${diff.inMinutes} دقيقة';
      return 'الآن';
    } catch (e) {
      return dateStr;
    }
  }

  Future<void> _resolveAlert(String alertId) async {
    if (alertId.isEmpty) return;

    setState(() => _processingAlerts.add(alertId));

    try {
      await SupabaseService.client
          .from('alerts')
          .update({
            'resolved': true,
            'is_resolved': true,
            'resolved_at': DateTime.now().toIso8601String(),
          })
          .eq('id', alertId);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('تم حل التنبيه بنجاح'),
            backgroundColor: AppTheme.successColor,
          ),
        );
        _loadData();
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
        setState(() => _processingAlerts.remove(alertId));
      }
    }
  }
}
