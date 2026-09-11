import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:helios_desktop/core/app_controller.dart';
import 'package:helios_desktop/core/json.dart';
import 'package:helios_desktop/core/theme.dart';
import 'package:helios_desktop/screens/database_data_screen.dart';
import 'package:helios_desktop/screens/detail_screen.dart';
import 'package:helios_desktop/widgets/common.dart';

import 'desktop_regression_test.dart' show RegressionBackend;

class DataBackend extends RegressionBackend {
  final queries = <JsonMap>[];
  Completer<JsonMap>? pending;

  @override
  Future<T?> call<T>(String method, [List<Object?> args = const []]) async {
    if (method == 'getDatabaseTableData') {
      final request = jsonMap(args.first);
      queries.add(request);
      if (pending != null) return await pending!.future as T;
      final result = <String, dynamic>{
        'columns': [
          {'name': 'id', 'type': 'integer'},
          {'name': 'name', 'type': 'text'},
        ],
        'rows': [
          [request['page'].toString(), '${request['table']}-row'],
        ],
        'total': request['filter'] == null ? 101 : 1,
        'page': request['page'],
        'pageSize': 50,
        'truncated': false,
      };
      return result as T;
    }
    if (method == 'getDatabaseSchema') {
      return {
        'supported': true,
        'databases': [
          {
            'name': 'affine',
            'tables': ['public.users', 'public.workspaces'],
          },
        ],
      } as T;
    }
    return super.call<T>(method, args);
  }
}

Future<AppController> mount(
  WidgetTester tester,
  DataBackend backend, {
  bool detail = false,
}) async {
  await tester.binding.setSurfaceSize(const Size(760, 600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final controller = AppController(backend);
  await tester.pumpWidget(
    MaterialApp(
      theme: buildHeliosTheme(),
      home: AppScope(
        controller: controller,
        child: Scaffold(
          body: detail
              ? const DetailScreen(
                  route: DetailRoute('database', 'regression-db'),
                )
              : const DatabaseDataScreen(
                  instance: 'regression-db',
                  database: 'affine',
                  initialTable: 'public.users',
                  tables: ['public.users', 'public.workspaces'],
                  project: RegressionBackend.longName,
                ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  addTearDown(controller.dispose);
  return controller;
}

void main() {
  testWidgets(
    'table entry opens data route with database and all sibling tables',
    (tester) async {
      final backend = DataBackend();
      final controller = await mount(tester, backend, detail: true);
      await tester.scrollUntilVisible(
        find.text('affine'),
        250,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text('affine'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('public.users'));
      await tester.tap(find.text('public.users'));
      expect(controller.detail?.type, 'database-data');
      expect(controller.detail?.database, 'affine');
      expect(controller.detail?.tables, ['public.users', 'public.workspaces']);
      controller.snapshot = {
        'databases': [
          {'name': 'regression-db'},
        ],
      };
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'opens deduplicated tabs, closes active tab and supports closing all tabs',
    (tester) async {
      final backend = DataBackend();
      await mount(tester, backend);
      expect(find.text('public.users-row'), findsOneWidget);
      await tester.tap(find.byTooltip('选择数据表'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('public.workspaces').last);
      await tester.pumpAndSettle();
      expect(find.text('public.workspaces-row'), findsOneWidget);
      await tester.tap(find.text('public.users').first);
      await tester.pumpAndSettle();
      expect(find.text('public.users-row'), findsOneWidget);
      expect(backend.queries.length, 2);
      await tester.tap(find.byTooltip('关闭 public.users'));
      await tester.pumpAndSettle();
      expect(find.text('public.workspaces-row'), findsOneWidget);
      await tester.tap(find.byTooltip('关闭 public.workspaces'));
      await tester.pumpAndSettle();
      expect(find.text('从左上角选择一张表'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'pagination and filters send bounded queries and preserve them during refresh',
    (tester) async {
      final backend = DataBackend();
      await mount(tester, backend);
      await tester.tap(find.byTooltip('下一页'));
      await tester.pumpAndSettle();
      expect(backend.queries.last['page'], 2);
      await tester.tap(find.text('筛选'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'literal_%');
      await tester.tap(find.text('应用'));
      await tester.pumpAndSettle();
      expect(backend.queries.last['page'], 1);
      expect(jsonMap(backend.queries.last['filter'])['value'], 'literal_%');
      expect(find.text('1 / 1'), findsOneWidget);
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(jsonMap(backend.queries.last['filter'])['value'], 'literal_%');
      await tester.tap(find.text('筛选 · 1'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('清除'));
      await tester.pumpAndSettle();
      expect(backend.queries.last.containsKey('filter'), isFalse);
      expect(find.text('1 / 3'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'ask opens associated chat with instance database and table context',
    (tester) async {
      final backend = DataBackend();
      final controller = await mount(tester, backend);
      await tester.tap(find.text('问数'));
      await tester.pumpAndSettle();
      expect(backend.calls, contains('getOrCreateProjectChat'));
      expect(controller.chatRequestedId, isNotEmpty);
      expect(controller.chatDraft, contains('regression-db'));
      expect(controller.chatDraft, contains('affine'));
      expect(controller.chatDraft, contains('public.users'));
      expect(controller.chatDraft, contains('只读查询'));
    },
  );

  testWidgets('late response cannot reopen a closed table', (tester) async {
    final backend = DataBackend();
    await mount(tester, backend);
    backend.pending = Completer<JsonMap>();
    await tester.tap(find.byTooltip('下一页'));
    await tester.pump();
    await tester.tap(find.byTooltip('关闭 public.users'));
    await tester.pump();
    backend.pending!.complete({'columns': [], 'rows': [], 'total': 0});
    await tester.pumpAndSettle();
    expect(find.text('从左上角选择一张表'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
