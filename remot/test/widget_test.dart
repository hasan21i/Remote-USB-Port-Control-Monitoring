// اختبارات تطبيق ريموت للمشرفين
// Remot Admin App Widget Tests

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:remot/main.dart';
import 'package:remot/providers/auth_provider.dart';

void main() {
  testWidgets('App launches with splash screen', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(
      MultiProvider(
        providers: [ChangeNotifierProvider(create: (_) => AuthProvider())],
        child: const RemotAdminApp(),
      ),
    );

    // Verify that splash screen is shown
    expect(find.text('ريموت'), findsOneWidget);
    expect(find.text('لوحة تحكم المشرفين'), findsOneWidget);
  });

  testWidgets('App shows loading indicator on splash', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MultiProvider(
        providers: [ChangeNotifierProvider(create: (_) => AuthProvider())],
        child: const RemotAdminApp(),
      ),
    );

    // Verify loading indicator is present
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
