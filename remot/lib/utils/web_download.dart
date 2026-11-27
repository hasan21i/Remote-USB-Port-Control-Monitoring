// ignore_for_file: avoid_web_libraries_in_flutter
import 'dart:convert';
// ignore: deprecated_member_use
import 'dart:html' as html;
import 'dart:typed_data';

void downloadFile(String content, String fileName) {
  try {
    final bytes = utf8.encode(content);
    final blob = html.Blob([bytes], 'text/plain;charset=utf-8');
    final url = html.Url.createObjectUrlFromBlob(blob);
    final anchor = html.AnchorElement()
      ..href = url
      ..style.display = 'none'
      ..download = fileName;

    html.document.body?.children.add(anchor);
    anchor.click();

    // تنظيف بعد التحميل
    Future.delayed(const Duration(milliseconds: 100), () {
      anchor.remove();
      html.Url.revokeObjectUrl(url);
    });

    print('✅ Download initiated: $fileName');
  } catch (e) {
    print('❌ Download error: $e');
    // fallback: فتح في نافذة جديدة
    try {
      final dataUrl =
          'data:text/plain;charset=utf-8,${Uri.encodeComponent(content)}';
      html.window.open(dataUrl, '_blank');
    } catch (e2) {
      print('❌ Fallback also failed: $e2');
    }
  }
}

/// تحميل ملف PDF
void downloadPdfFile(List<int> bytes, String fileName) {
  try {
    final uint8List = Uint8List.fromList(bytes);
    final blob = html.Blob([uint8List], 'application/pdf');
    final url = html.Url.createObjectUrlFromBlob(blob);
    final anchor = html.AnchorElement()
      ..href = url
      ..style.display = 'none'
      ..download = fileName;

    html.document.body?.children.add(anchor);
    anchor.click();

    // تنظيف بعد التحميل
    Future.delayed(const Duration(milliseconds: 100), () {
      anchor.remove();
      html.Url.revokeObjectUrl(url);
    });

    print('✅ PDF Download initiated: $fileName');
  } catch (e) {
    print('❌ PDF Download error: $e');
    rethrow;
  }
}
