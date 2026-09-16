import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:helios_desktop/core/app_controller.dart';
import 'package:helios_desktop/core/backend_client.dart';
import 'package:helios_desktop/core/json.dart';
import 'package:helios_desktop/widgets/billing.dart';
import 'package:helios_desktop/widgets/common.dart';

class BillingBackend extends HeliosBackend {
  final stream = StreamController<BackendEvent>.broadcast();
  final opened = <String>[];
  Completer<Object?>? pending;
  @override
  Stream<BackendEvent> get events => stream.stream;
  @override
  bool get ready => true;
  @override
  String? get fatalError => null;
  @override
  Future<void> start() async {}
  @override
  Future<void> shutdown() async {}
  @override
  Future<List<JsonMap>> pickChatFiles() async => [];
  @override
  Future<String?> pickLocalSource() async => null;
  @override
  Future<T?> call<T>(String method, [List<Object?> args = const []]) async {
    if (method == 'openExternal') opened.add(args.first as String);
    if (method == 'getBillingStatus') return (await pending?.future) as T?;
    if (method == 'switchWorkspace') {
      return {'authenticated': true, 'namespace': args.first} as T;
    }
    return null;
  }

  @override
  void dispose() {
    unawaited(stream.close());
    super.dispose();
  }
}

void main() {
  JsonMap data({bool? debt, bool? owner}) => {
    'cashMicroUnits': 8500000,
    'currency': 'cny',
    'workspaceDebt': debt,
    'isOwner': owner,
    'topUpUrl':
        'https://region.example/?openapp=system-costcenter%3Fmode%3Dtopup',
  };
  Future<AppController> mount(
    WidgetTester tester,
    BillingBackend backend,
    JsonMap billing,
  ) async {
    final controller = AppController(backend)
      ..status = {'authenticated': true, 'namespace': 'ns-one'}
      ..billing = billing;
    await tester.pumpWidget(
      MaterialApp(
        home: AppScope(
          controller: controller,
          child: const BillingReminder(
            child: Scaffold(body: AccountBalanceCard()),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    addTearDown(controller.dispose);
    return controller;
  }

  testWidgets(
    'shows cash and opens recharge; a negative cash balance alone is not debt',
    (tester) async {
      final backend = BillingBackend();
      await mount(tester, backend, {...data(), 'cashMicroUnits': -8500000});
      expect(find.text('-8.50 CNY'), findsOneWidget);
      expect(find.byType(AlertDialog), findsNothing);
      await tester.tap(find.text('充值'));
      await tester.pump();
      expect(backend.opened.single, contains('mode%3Dtopup'));
    },
  );

  testWidgets(
    'dismissed debt stays quiet through unknown reads and rearms after recovery',
    (tester) async {
      final controller = await mount(
        tester,
        BillingBackend(),
        data(debt: true, owner: true),
      );
      expect(find.text('工作空间因欠费受限'), findsOneWidget);
      await tester.tap(find.text('稍后处理'));
      await tester.pumpAndSettle();
      for (final debt in [null, true]) {
        controller.billing = data(debt: debt, owner: true);
        controller.clearError();
        await tester.pumpAndSettle();
        expect(find.byType(AlertDialog), findsNothing);
      }
      controller.billing = data(debt: false);
      controller.clearError();
      await tester.pumpAndSettle();
      controller.billing = data(debt: true, owner: true);
      controller.clearError();
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);
      await tester.tap(find.text('稍后处理'));
      await tester.pumpAndSettle();
    },
  );

  testWidgets(
    'members are directed to the owner and context switch closes stale notice',
    (tester) async {
      final controller = await mount(
        tester,
        BillingBackend(),
        data(debt: true, owner: false),
      );
      expect(find.text('工作空间所有者的账户欠费，请联系所有者充值。'), findsOneWidget);
      expect(find.text('前往充值'), findsNothing);
      controller.status = {'authenticated': true, 'namespace': 'ns-two'};
      controller.billing = null;
      controller.clearError();
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  test('workspace change ignores late balance from previous context', () async {
    final backend = BillingBackend()..pending = Completer<Object?>();
    final controller = AppController(backend)
      ..status = {'authenticated': true, 'namespace': 'ns-one'};
    final old = backend.pending!;
    final request = controller.refreshBilling();
    backend.pending = Completer<Object?>();
    await controller.changeWorkspace('ns-two');
    old.complete(data(debt: true));
    await request;
    expect(controller.billing, isNull);
    backend.pending!.complete(data(debt: false));
    await Future<void>.delayed(Duration.zero);
    expect(controller.billing?['workspaceDebt'], false);
    controller.dispose();
  });
}
