import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'dart:ui';
import 'dart:io';
import 'dart:typed_data';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:open_filex/open_filex.dart';
import '../config/app_theme.dart';
import '../services/supabase_service.dart';
import '../services/api_service.dart';
import '../utils/download_helper.dart' as web_download;

/// صفحة التقارير - عرض وإدارة جميع التقارير
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;

  List<Map<String, dynamic>> _reports = [];
  bool _isLoading = true;
  bool _isGenerating = false;

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

    _loadReports();
    _animationController.forward();
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  Future<void> _loadReports() async {
    setState(() => _isLoading = true);

    try {
      // جلب التقارير من Supabase
      final reports = await SupabaseService.getReports();
      setState(() {
        _reports = List<Map<String, dynamic>>.from(reports);
        _isLoading = false;
      });
    } catch (e) {
      print('❌ Error loading reports: $e');
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('خطأ في تحميل التقارير: $e'),
            backgroundColor: AppTheme.dangerColor,
          ),
        );
      }
    }
  }

  String _formatDate(String? dateStr) {
    if (dateStr == null) return 'غير محدد';
    try {
      final date = DateTime.parse(dateStr);
      return '${date.day}/${date.month}/${date.year} - ${date.hour}:${date.minute.toString().padLeft(2, '0')}';
    } catch (e) {
      return dateStr;
    }
  }

  Future<void> _generateNewReport() async {
    setState(() => _isGenerating = true);

    try {
      final now = DateTime.now();
      final reportName = 'تقرير النظام - ${now.day}/${now.month}/${now.year}';

      final result = await ApiService.generateReport(
        name: reportName,
        format: 'pdf',
        includeCharts: true,
      );

      if (result['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تم إنشاء التقرير بنجاح ✓'),
            backgroundColor: Colors.green,
          ),
        );
        _loadReports(); // تحديث القائمة
      } else {
        throw Exception(result['error'] ?? 'فشل إنشاء التقرير');
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('خطأ في إنشاء التقرير: $e'),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      setState(() => _isGenerating = false);
    }
  }

  Future<void> _downloadReport(Map<String, dynamic> report) async {
    final reportId = report['id'];
    if (reportId == null) return;

    try {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('جاري تحميل التقرير...'),
          behavior: SnackBarBehavior.floating,
        ),
      );

      final result = await ApiService.exportReportPdf(
        reportId is int ? reportId : int.parse(reportId.toString()),
      );

      if (result['success'] == true) {
        final pdfBytes = result['data'] as List<int>;
        final fileName = 'Remot_Report_$reportId.pdf';

        if (kIsWeb) {
          web_download.downloadPdfFile(pdfBytes, fileName);
        } else {
          final directory = await getApplicationDocumentsDirectory();
          final filePath = '${directory.path}/$fileName';
          final file = File(filePath);
          await file.writeAsBytes(pdfBytes);

          // عرض خيارات للمستخدم
          _showDownloadOptions(
            filePath,
            fileName,
            Uint8List.fromList(pdfBytes),
          );
        }
      } else {
        throw Exception(result['error'] ?? 'فشل تحميل التقرير');
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('خطأ في تحميل التقرير: $e'),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  void _showDownloadOptions(
    String filePath,
    String fileName,
    Uint8List pdfBytes,
  ) {
    final isDark = ThemeColors.isDark(context);
    final dialogBg = ThemeColors.dialogBackground(context);
    final textColor = isDark ? Colors.white : AppTheme.textPrimary;
    final textSecondary = isDark ? Colors.white70 : AppTheme.textSecondary;

    showModalBottomSheet(
      context: context,
      backgroundColor: dialogBg,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => Directionality(
        textDirection: TextDirection.rtl,
        child: Container(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: textSecondary.withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 20),
              Text(
                'تم حفظ التقرير',
                style: TextStyle(
                  color: textColor,
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                fileName,
                style: TextStyle(color: textSecondary, fontSize: 14),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () {
                        Navigator.pop(context);
                        OpenFilex.open(filePath);
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.primaryColor,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                      ),
                      icon: const Icon(Icons.open_in_new, size: 18),
                      label: const Text('فتح'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () async {
                        Navigator.pop(context);
                        await Share.shareXFiles([
                          XFile(filePath),
                        ], text: 'تقرير Remot');
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.successColor,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                      ),
                      icon: const Icon(Icons.share, size: 18),
                      label: const Text('مشاركة'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _deleteReport(Map<String, dynamic> report) async {
    final reportId = report['id'];
    if (reportId == null) return;

    final isDark = ThemeColors.isDark(context);
    final dialogBg = ThemeColors.dialogBackground(context);
    final textColor = isDark ? Colors.white : AppTheme.textPrimary;
    final textSecondary = isDark ? Colors.white70 : AppTheme.textSecondary;

    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          backgroundColor: dialogBg,
          title: Text('حذف التقرير', style: TextStyle(color: textColor)),
          content: Text(
            'هل أنت متأكد من حذف هذا التقرير؟',
            style: TextStyle(color: textSecondary),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text('إلغاء', style: TextStyle(color: textSecondary)),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(context, true),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.red,
                foregroundColor: Colors.white,
              ),
              child: const Text('حذف'),
            ),
          ],
        ),
      ),
    );

    if (confirm == true) {
      try {
        await SupabaseService.deleteReport(reportId);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تم حذف التقرير ✓'),
            backgroundColor: Colors.green,
          ),
        );
        _loadReports();
      } catch (e) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('خطأ في حذف التقرير: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final gradientColors = ThemeColors.gradientColors(context);
    final isDark = ThemeColors.isDark(context);

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
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
              child: Column(
                children: [
                  _buildAppBar(isDark),
                  Expanded(
                    child: _isLoading
                        ? _buildLoadingWidget(isDark)
                        : _buildReportsList(isDark),
                  ),
                ],
              ),
            ),
          ),
        ),
        floatingActionButton: FloatingActionButton.extended(
          heroTag: 'reports_fab',
          onPressed: _isGenerating ? null : _generateNewReport,
          backgroundColor: AppTheme.primaryColor,
          icon: _isGenerating
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                  ),
                )
              : const Icon(Icons.add, color: Colors.white),
          label: Text(
            _isGenerating ? 'جاري الإنشاء...' : 'تقرير جديد',
            style: const TextStyle(color: Colors.white),
          ),
        ),
      ),
    );
  }

  Widget _buildAppBar(bool isDark) {
    final textColor = isDark ? Colors.white : AppTheme.textPrimary;
    final textSecondary = isDark ? Colors.white70 : AppTheme.textSecondary;

    return Container(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.pop(context),
            icon: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: (isDark ? Colors.white : Colors.black).withValues(
                  alpha: 0.1,
                ),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(Icons.arrow_back, color: textColor, size: 20),
            ),
          ),
          const SizedBox(width: 12),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppTheme.primaryColor.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              Icons.assessment,
              color: AppTheme.primaryColor,
              size: 24,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'التقارير',
                  style: TextStyle(
                    color: textColor,
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  '${_reports.length} تقرير',
                  style: TextStyle(color: textSecondary, fontSize: 14),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: _loadReports,
            icon: Icon(Icons.refresh, color: textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _buildLoadingWidget(bool isDark) {
    final textSecondary = isDark ? Colors.white70 : AppTheme.textSecondary;

    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          CircularProgressIndicator(
            valueColor: AlwaysStoppedAnimation<Color>(AppTheme.primaryColor),
          ),
          const SizedBox(height: 16),
          Text(
            'جاري تحميل التقارير...',
            style: TextStyle(color: textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _buildReportsList(bool isDark) {
    final textSecondary = isDark ? Colors.white70 : AppTheme.textSecondary;

    if (_reports.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.folder_off,
              size: 80,
              color: textSecondary.withValues(alpha: 0.5),
            ),
            const SizedBox(height: 16),
            Text(
              'لا توجد تقارير',
              style: TextStyle(color: textSecondary, fontSize: 18),
            ),
            const SizedBox(height: 8),
            Text(
              'اضغط على "تقرير جديد" لإنشاء تقرير',
              style: TextStyle(
                color: textSecondary.withValues(alpha: 0.7),
                fontSize: 14,
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadReports,
      color: AppTheme.primaryColor,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _reports.length,
        itemBuilder: (context, index) =>
            _buildReportCard(_reports[index], isDark),
      ),
    );
  }

  Widget _buildReportCard(Map<String, dynamic> report, bool isDark) {
    final textColor = isDark ? Colors.white : AppTheme.textPrimary;
    final textSecondary = isDark ? Colors.white70 : AppTheme.textSecondary;
    final cardBg = isDark
        ? Colors.white.withValues(alpha: 0.05)
        : Colors.black.withValues(alpha: 0.03);
    final borderColor = isDark
        ? Colors.white.withValues(alpha: 0.1)
        : Colors.black.withValues(alpha: 0.08);

    final reportName = report['name'] ?? 'تقرير #${report['id']}';
    final createdAt = _formatDate(report['created_at']);
    final format = (report['format'] ?? 'pdf').toString().toUpperCase();

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderColor),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 5, sigmaY: 5),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppTheme.primaryColor.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    format == 'PDF' ? Icons.picture_as_pdf : Icons.description,
                    color: AppTheme.primaryColor,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        reportName,
                        style: TextStyle(
                          color: textColor,
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          Icon(
                            Icons.access_time,
                            size: 12,
                            color: textSecondary,
                          ),
                          const SizedBox(width: 4),
                          Flexible(
                            child: Text(
                              createdAt,
                              style: TextStyle(
                                color: textSecondary,
                                fontSize: 11,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 5,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: AppTheme.successColor.withValues(
                                alpha: 0.2,
                              ),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              format,
                              style: TextStyle(
                                color: AppTheme.successColor,
                                fontSize: 9,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => _downloadReport(report),
                  icon: const Icon(
                    Icons.download,
                    color: AppTheme.primaryColor,
                    size: 20,
                  ),
                  tooltip: 'تحميل',
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(
                    minWidth: 36,
                    minHeight: 36,
                  ),
                ),
                IconButton(
                  onPressed: () => _deleteReport(report),
                  icon: Icon(
                    Icons.delete_outline,
                    color: Colors.red.withValues(alpha: 0.7),
                    size: 20,
                  ),
                  tooltip: 'حذف',
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(
                    minWidth: 36,
                    minHeight: 36,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
