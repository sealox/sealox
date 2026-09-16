import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:helios_desktop/core/app_controller.dart';
import 'package:helios_desktop/core/backend_client.dart';
import 'package:helios_desktop/core/theme.dart';
import 'package:helios_desktop/widgets/common.dart';
import 'package:helios_desktop/widgets/update_prompt.dart';

import 'app_shell_test.dart' show FakeBackend;

class UpdateBackend extends FakeBackend {
  Map<String, Object?> update = {
    'currentVersion': '0.8.3',
    'available': true,
    'latestVersion': '0.8.4',
    'phase': 'available',
    'notes': '更新说明',
  };
  void emitUpdate() =>
      controller.add(BackendEvent('helios:update-event', update));
  @override
  Future<T?> call<T>(String method, [List<Object?> args = const []]) async {
    if (method == 'getUpdateStatus') return update as T;
    if (method == 'downloadUpdate') {
      calls.add(method);
      update = {...update, 'phase': 'ready', 'progress': 1};
      emitUpdate();
      return null;
    }
    return super.call<T>(method, args);
  }
}

void main() {
  testWidgets('prompts once per version and follows installation state', (
    tester,
  ) async {
    final backend = UpdateBackend();
    final controller = AppController(backend);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildHeliosTheme(),
        home: AppScope(
          controller: controller,
          child: const UpdatePrompt(child: Scaffold(body: Text('首页'))),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('发现新版本 0.8.4'), findsOneWidget);
    await tester.tap(find.text('立即更新'));
    await tester.pumpAndSettle();
    expect(backend.calls, contains('downloadUpdate'));
    expect(find.textContaining('安装包已打开'), findsOneWidget);
    await tester.tap(find.text('完成'));
    await tester.pumpAndSettle();
    backend.update = {...backend.update, 'phase': 'available'};
    backend.emitUpdate();
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
}
