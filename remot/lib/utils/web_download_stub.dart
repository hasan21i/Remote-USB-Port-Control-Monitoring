// Stub implementation for non-web platforms
void downloadFile(String content, String fileName) {
  // No-op on non-web platforms - file sharing is handled differently
  throw UnsupportedError('Web download not supported on this platform');
}

void downloadPdfFile(List<int> bytes, String fileName) {
  // No-op on non-web platforms - file sharing is handled differently
  throw UnsupportedError('Web PDF download not supported on this platform');
}
