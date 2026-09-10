import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:helios_desktop/core/app_controller.dart';
import 'package:helios_desktop/screens/file_storage_screen.dart';
import 'package:helios_desktop/screens/resource_list_screen.dart';
import 'package:helios_desktop/widgets/common.dart';

import 'app_shell_test.dart' show FakeBackend;

class StorageBackend extends FakeBackend {
  int listings = 0;
  List<Object?>? policyArgs;
  @override
  Future<T?> call<T>(String method, [List<Object?> args = const []]) async {
    if (method == 'setStoragePolicy') {
      policyArgs = args;
      return null;
    }
    if (method == 'listStorageObjects') listings++;
    if (method == 'getWorkspaceStorageCredentials') {
      return {
        'accessKey': 'test-access',
        'secretKey': 'test-secret',
        'url': 'https://example.test',
      } as T;
    }
    if (method == 'getResources') {
      return {
        'buckets': [
          {'name': 'bucket'},
        ],
      } as T;
    }
    if (method == 'getStorageInfo') {
      return {'bucketName': 'actual-bucket', 'policy': 'private'} as T;
    }
    if (method == 'listStorageObjects') {
      return (args[1] == ''
              ? [
                  {'name': 'docs/'},
                  {'name': 'hello.txt', 'size': 42},
                ]
              : [
                  {'name': 'docs/nested.txt', 'size': 8},
                ])
          as T;
    }
    return super.call<T>(method, args);
  }
}

void main() {
  testWidgets(
    'bucket policy changes require confirmation and send read-only public policy',
    (tester) async {
      tester.view.physicalSize = const Size(1400, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final backend = StorageBackend();
      final controller = AppController(backend);
      controller.snapshot = {
        'buckets': [
          {'name': 'bucket', 'policy': 'private'},
        ],
      };
      await tester.pumpWidget(
        AppScope(
          controller: controller,
          child: const MaterialApp(
            home: Scaffold(
              body: ResourceListScreen(type: ResourceType.storage),
            ),
          ),
        ),
      );
      await tester.tap(find.byTooltip('访问权限'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Set public'));
      await tester.pumpAndSettle();
      expect(backend.policyArgs, isNull);
      await tester.tap(find.text('取消'));
      await tester.pumpAndSettle();
      expect(backend.policyArgs, isNull);
      await tester.tap(find.byTooltip('访问权限'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Set public'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('确认'));
      await tester.pumpAndSettle();
      expect(backend.policyArgs, ['bucket', 'publicRead']);
      controller.snapshot = {
        'buckets': [
          {'name': 'bucket', 'policy': 'publicRead'},
        ],
      };
      controller.openDetail(const DetailRoute('storage', 'bucket'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('访问权限'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Set private'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('确认'));
      await tester.pumpAndSettle();
      expect(backend.policyArgs, ['bucket', 'private']);
      controller.dispose();
    },
  );

  testWidgets('workspace credentials are available on an empty bucket list', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = AppController(StorageBackend());
    controller.snapshot = {'buckets': []};
    await tester.pumpWidget(
      AppScope(
        controller: controller,
        child: const MaterialApp(
          home: Scaffold(body: ResourceListScreen(type: ResourceType.storage)),
        ),
      ),
    );
    await tester.tap(find.text('获取密钥'));
    await tester.pumpAndSettle();
    expect(find.text('工作空间 OSS 访问密钥'), findsOneWidget);
    expect(find.text('test-access'), findsOneWidget);
    expect(find.text('test-secret'), findsOneWidget);
    expect(find.text('https://example.test'), findsOneWidget);
    await tester.tap(find.text('关闭'));
    await tester.pumpAndSettle();
    controller.dispose();
  });

  test(
    'resource refresh retains bucket detail and removes deleted bucket only',
    () async {
      final controller = AppController(StorageBackend());
      controller.status = {'authenticated': true};
      controller.openDetail(const DetailRoute('storage', 'bucket'));
      await controller.refreshResources();
      expect(controller.detail?.name, 'bucket');
      controller.dispose();
    },
  );
  testWidgets(
    'bucket metadata, folder navigation, file details and download are reachable',
    (tester) async {
      tester.view.physicalSize = const Size(1400, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final backend = StorageBackend();
      final controller = AppController(backend);
      await tester.pumpWidget(
        AppScope(
          controller: controller,
          child: const MaterialApp(
            home: Scaffold(body: FileStorageScreen(name: 'bucket')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('actual-bucket'), findsOneWidget);
      expect(find.byTooltip('下载'), findsOneWidget);
      expect(find.text('获取密钥'), findsNothing);
      final before = backend.listings;
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(backend.listings, greaterThan(before));
      await tester.tap(find.text('hello.txt'));
      await tester.pumpAndSettle();
      expect(find.text('文件详情'), findsOneWidget);
      await tester.tap(find.text('关闭'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('docs/'));
      await tester.pumpAndSettle();
      expect(find.text('nested.txt'), findsOneWidget);
      await tester.tap(find.text('全部文件'));
      await tester.pumpAndSettle();
      expect(find.text('hello.txt'), findsOneWidget);
      controller.dispose();
    },
  );
}
