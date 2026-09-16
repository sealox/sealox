import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:helios_desktop/core/app_controller.dart';
import 'package:helios_desktop/core/theme.dart';
import 'package:helios_desktop/widgets/common.dart';
import 'package:helios_desktop/widgets/bind_domain_dialog.dart';

import 'app_shell_test.dart' show FakeBackend;

class DomainBackend extends FakeBackend {
  bool fail = true;
  String certificateStatus = 'pending';
  List<Object?>? binding;
  @override
  Future<T?> call<T>(String method, [List<Object?> args = const []]) async {
    if (method == 'getDomainBinding') {
      return {
        'target': 'app.platform.test',
        'certificates': binding == null || fail
            ? []
            : [
                {'domain': 'app.example.com', 'status': certificateStatus},
              ],
      } as T;
    }
    if (method == 'bindDomain') {
      binding = args;
      if (fail) throw Exception('CNAME 尚未生效');
      return {'url': 'https://app.example.com', 'target': 'app.platform.test'}
          as T;
    }
    return super.call<T>(method, args);
  }
}

void main() {
  testWidgets(
    'CNAME instructions, error retry and certificate pending state use real theme',
    (tester) async {
      final backend = DomainBackend();
      final controller = AppController(backend);
      await tester.pumpWidget(
        MaterialApp(
          theme: buildHeliosTheme(),
          home: AppScope(
            controller: controller,
            child: Scaffold(
              body: Builder(
                builder: (context) => TextButton(
                  onPressed: () => showBindDomainDialog(
                    context,
                    'https://app.platform.test',
                  ),
                  child: const Text('打开绑定弹窗'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('打开绑定弹窗'));
      await tester.pumpAndSettle();
      expect(find.text('app.platform.test'), findsOneWidget);
      expect(find.byTooltip('复制 CNAME 目标'), findsOneWidget);
      expect(
        tester.getSize(find.byType(TextField)).height,
        greaterThanOrEqualTo(40),
      );
      await tester.enterText(find.byType(TextField), 'app.example.com');
      await tester.pump();
      await tester.tap(find.text('验证并绑定'));
      await tester.pumpAndSettle();
      expect(find.textContaining('CNAME 尚未生效'), findsOneWidget);
      expect(backend.binding, ['https://app.platform.test', 'app.example.com']);
      backend.fail = false;
      await tester.tap(find.text('验证并绑定'));
      await tester.pumpAndSettle();
      expect(find.text('https://app.example.com'), findsOneWidget);
      expect(find.textContaining('HTTPS 证书申请中'), findsOneWidget);
      backend.certificateStatus = 'ready';
      await tester.tap(find.text('刷新证书状态'));
      await tester.pumpAndSettle();
      expect(find.textContaining('HTTPS 证书已签发'), findsOneWidget);
      backend.certificateStatus = 'unknown';
      await tester.tap(find.text('刷新证书状态'));
      await tester.pumpAndSettle();
      expect(find.textContaining('暂时无法读取证书状态'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      controller.dispose();
    },
  );
}
