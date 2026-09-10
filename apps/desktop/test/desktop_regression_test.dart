import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:helios_desktop/app.dart';
import 'package:helios_desktop/core/app_controller.dart';
import 'package:helios_desktop/core/backend_client.dart';
import 'package:helios_desktop/core/json.dart';
import 'package:helios_desktop/widgets/detail_widgets.dart';

class RegressionBackend extends HeliosBackend {
  final eventsController = StreamController<BackendEvent>.broadcast();
  final calls = <String>[];

  static const longName =
      'helios-desktop-regression-workload-with-a-near-kubernetes-limit';

  @override
  Stream<BackendEvent> get events => eventsController.stream;

  @override
  String? get fatalError => null;

  @override
  bool get ready => true;

  @override
  Future<void> start() async {}

  @override
  Future<T?> call<T>(String method, [List<Object?> args = const []]) async {
    calls.add(method);
    final Object? result = switch (method) {
      'getStatus' => {
        'authenticated': true,
        'workspace': 'ns-regression',
        'workspaceName': '桌面回归测试空间',
      },
      'getResources' => {
        'fetchedAt': '2026-09-02T06:00:00.000Z',
        'projects': <Object?>[
          {
            'name': longName,
            'displayName': '一个用于验证最小桌面窗口布局的超长项目显示名称',
            'template': 'WordPress',
          },
        ],
        'apps': <Object?>[
          {
            'name': longName,
            'kind': 'Deployment',
            'status': 'Running',
            'readyReplicas': 1,
            'replicas': 1,
            'launchpad': true,
            'project': longName,
          },
        ],
        'databases': <Object?>[
          {
            'name': 'regression-db',
            'engine': 'postgresql',
            'version': '16',
            'phase': 'Stopped',
            'project': longName,
          },
        ],
        'buckets': <Object?>[
          {
            'name': 'regression-bucket',
            'policy': 'private',
            'project': longName,
          },
        ],
        'quota': <Object?>[],
        'warnings': <Object?>[],
      },
      'listChats' => <Object?>[],
      'getOrCreateProjectChat' => {
        'id': '11111111-1111-4111-8111-111111111111',
        'title': '维护 $longName',
        'workspaceId': 'ns-regression',
        'eveSessionId': null,
        'streamIndex': 0,
        'projectName': longName,
        'messages': <Object?>[],
        'createdAt': '2026-09-02T06:00:00.000Z',
        'updatedAt': '2026-09-02T06:00:00.000Z',
      },
      'createChat' => {
        'id': '22222222-2222-4222-8222-222222222222',
        'title': '新对话',
        'workspaceId': 'ns-regression',
        'eveSessionId': null,
        'streamIndex': 0,
        'messages': <Object?>[],
        'createdAt': '2026-09-02T06:00:00.000Z',
        'updatedAt': '2026-09-02T06:00:00.000Z',
      },
      'getChat' => {
        'id': '11111111-1111-4111-8111-111111111111',
        'title': '维护 $longName',
        'workspaceId': 'ns-regression',
        'eveSessionId': null,
        'streamIndex': 0,
        'projectName': longName,
        'messages': <Object?>[],
        'createdAt': '2026-09-02T06:00:00.000Z',
        'updatedAt': '2026-09-02T06:00:00.000Z',
      },
      'getAgentStatus' => {'state': 'ready'},
      'getProjectDetail' => {
        'name': longName,
        'displayName': '一个用于验证最小桌面窗口布局的超长项目显示名称',
        'template': 'WordPress',
        'author': 'Sealos',
        'description': '回归测试项目',
        'apps': <Object?>[
          {
            'name': longName,
            'kind': 'Deployment',
            'status': 'Running',
            'launchpad': true,
            'readyReplicas': 1,
            'replicas': 1,
            'urls': <Object?>['https://example.com'],
            'usage': {'cpuPercent': 28, 'memoryPercent': 91},
          },
          {
            'name': 'regression-worker',
            'kind': 'Deployment',
            'status': 'Running',
            'launchpad': true,
            'readyReplicas': 1,
            'replicas': 1,
            'urls': <Object?>[],
          },
        ],
        'databases': <Object?>[
          {'name': 'regression-db', 'engine': 'postgresql', 'phase': 'Stopped'},
        ],
        'buckets': <Object?>[
          {'name': 'regression-bucket', 'policy': 'private'},
        ],
        'cronjobs': <Object?>[],
        'others': <Object?>[],
        'links': <Object?>[
          {
            'app': longName,
            'targetKind': 'service',
            'target': 'regression-worker',
          },
          {
            'app': longName,
            'targetKind': 'database',
            'target': 'regression-db',
          },
          {
            'app': longName,
            'targetKind': 'bucket',
            'target': 'regression-bucket',
          },
        ],
      },
      'getAppDetail' => {
        'name': longName,
        'kind': 'Deployment',
        'status': 'Running',
        'launchpad': true,
        'readyReplicas': 1,
        'replicas': 1,
        'image': 'ghcr.io/sealos-apps/helios:latest',
        'cpuLimit': '1',
        'memoryLimit': '1Gi',
        'project': longName,
        'networks': <Object?>[
          {
            'port': 8080,
            'protocol': 'TCP',
            'appProtocol': 'HTTP',
            'clusterAddress':
                'regression-worker.default.svc.cluster.local:8080',
            'publicUrl': 'https://regression.example.com',
            'customDomain': false,
          },
        ],
        'envs': <Object?>[
          {'key': 'PORT', 'value': '8080'},
          {'key': 'DATABASE_URL', 'from': 'secret/regression.database-url'},
        ],
        'configMaps': <Object?>[],
        'stores': <Object?>[],
        'pods': <Object?>[
          {
            'name': '$longName-live',
            'phase': 'Running',
            'restarts': 0,
            'containers': <Object?>[
              {'name': 'app', 'image': 'helios:latest', 'state': 'running'},
            ],
          },
        ],
        'events': <Object?>[],
      },
      'getAppMonitor' => {
        'available': true,
        'cpu': <Object?>[],
        'memory': <Object?>[],
      },
      'getDatabaseDetail' => {
        'name': longName,
        'engine': 'postgresql',
        'version': '16.4.0',
        'phase': 'Running',
        'project': longName,
        'connection': <String, Object?>{
          'host': 'regression-db.default.svc.cluster.local',
          'port': '5432',
          'username': 'postgres',
          'password': 'internal-password',
          'connectionString': 'postgresql://postgres@regression-db:5432/app',
        },
        'publicConnection': <String, Object?>{
          'host': 'db.example.com',
          'port': '5432',
          'username': 'postgres',
          'password': 'public-password',
          'connectionString': 'postgresql://postgres@db.example.com:5432/app',
        },
        'publicEnabled': true,
        'usedBy': <Object?>[],
        'pods': <Object?>[],
        'events': <Object?>[],
      },
      'getDatabaseMonitor' => {
        'available': true,
        'cpu': <Object?>[],
        'memory': <Object?>[],
        'disk': <Object?>[],
      },
      'getDatabaseSchema' => {'supported': true, 'databases': <Object?>[]},
      'getTemplates' => {
        'templates': <Object?>[
          {
            'name': '一个名称很长但仍应完整适配卡片宽度的模板',
            'templateName': 'regression-template',
            'description':
                '这是一段用于验证模板卡片固定高度的较长说明。'
                '即使说明文字需要显示三行，底部的分类、错误和部署按钮也不能溢出。'
                '模板截图、标题和操作区都应保持稳定尺寸。',
            'category': 'Development Tools',
            'tags': <Object?>[],
            'icon': '',
            'screenshot': '',
            'detailUrl': 'https://sealos.io',
            'deployCount': 42,
          },
        ],
      },
      'getTemplateDetail' => {
        'args': <String, Object?>{},
        'quota': {'cpu': 1, 'memory': 1, 'storage': 1},
      },
      'deployTemplate' => {'instanceName': longName},
      _ => null,
    };
    return result as T?;
  }

  @override
  Future<List<JsonMap>> pickChatFiles() async => [];

  @override
  Future<String?> pickLocalSource() async => '/tmp/helios-local-source';

  @override
  Future<void> shutdown() async {
    if (!eventsController.isClosed) await eventsController.close();
  }
}

Future<(AppController, RegressionBackend)> pumpDesktop(
  WidgetTester tester,
) async {
  tester.view.physicalSize = const Size(940, 620);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final backend = RegressionBackend();
  final controller = AppController(backend);
  await tester.pumpWidget(HeliosApp(controller: controller));
  await tester.pumpAndSettle();
  return (controller, backend);
}

void main() {
  test('monitor data excludes destroyed pods', () {
    final filtered = monitorForCurrentPods(
      {
        'available': true,
        'cpu': <Object?>[
          {'name': 'live', 'points': <Object?>[]},
          {'name': 'destroyed', 'points': <Object?>[]},
        ],
        'memory': <Object?>[
          {'name': 'destroyed', 'points': <Object?>[]},
        ],
      },
      <JsonMap>[
        {'name': 'live'},
      ],
    );

    expect(jsonList(filtered?['cpu']).map((item) => item['name']), ['live']);
    expect(jsonList(filtered?['memory']), isEmpty);
  });

  testWidgets('minimum desktop window renders the new conversation starter', (
    tester,
  ) async {
    final (_, backend) = await pumpDesktop(tester);
    final inputField = find.byType(TextField).first;
    expect(tester.getSize(inputField).height, greaterThanOrEqualTo(90));
    await tester.enterText(inputField, '第一行\n第二行\n第三行\n第四行\n第五行\n第六行');
    await tester.pumpAndSettle();
    expect(tester.getSize(inputField).height, greaterThanOrEqualTo(125));
    expect(tester.takeException(), isNull);
    await tester.enterText(inputField, '');
    await tester.pumpAndSettle();

    for (final scenario in ['部署 GitHub 项目', '部署本地源代码', '从应用商店部署', '启动一个数据库']) {
      expect(find.text(scenario), findsOneWidget);
    }
    expect(find.text('部署 Docker 镜像'), findsNothing);
    expect(find.text('全部'), findsOneWidget);
    expect(find.text('一个名称很长但仍应完整适配卡片宽度的模板'), findsOneWidget);
    expect(find.byIcon(Icons.history), findsNothing);
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('部署 GitHub 项目'));
    await tester.pump();
    final composer = tester.widget<TextField>(find.byType(TextField).first);
    expect(composer.controller?.text, contains('GitHub'));

    await tester.tap(find.text('部署本地源代码'));
    await tester.pumpAndSettle();
    expect(composer.controller?.text, contains('部署到 Sealos'));
    expect(composer.controller?.text, contains('/tmp/helios-local-source'));
    expect(backend.calls, isNot(contains('sendChatMessage')));

    await tester.tap(find.text('一个名称很长但仍应完整适配卡片宽度的模板'));
    await tester.pump();
    expect(composer.controller?.text, contains('应用商店部署'));

    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'project detail shows header actions and horizontal resource topology',
    (tester) async {
      final (controller, backend) = await pumpDesktop(tester);
      controller.openDetail(
        const DetailRoute('project', RegressionBackend.longName),
      );
      await tester.pumpAndSettle();

      for (final layer in ['网络接入层', '服务层', '数据层']) {
        expect(find.text(layer), findsNothing);
      }
      expect(find.text('example.com'), findsOneWidget);
      expect(find.textContaining('容器 · Deployment'), findsNWidgets(2));
      expect(find.text('regression-worker'), findsOneWidget);
      expect(find.text('regression-db'), findsOneWidget);
      expect(find.text('regression-bucket'), findsOneWidget);
      expect(find.byTooltip('Warning · 内存 91%'), findsOneWidget);
      expect(find.text('91%'), findsOneWidget);
      expect(find.text('WordPress'), findsNothing);
      expect(find.text('Sealos'), findsOneWidget);
      expect(
        find.textContaining('${RegressionBackend.longName}  ·  创建于'),
        findsNothing,
      );
      expect(find.textContaining('创建于'), findsOneWidget);
      expect(find.text('对话维护'), findsOneWidget);
      expect(find.text('暂停'), findsOneWidget);
      expect(find.text('重启'), findsOneWidget);
      expect(find.text('删除'), findsOneWidget);
      expect(find.byTooltip('放大'), findsOneWidget);
      final before = tester
          .widget<InteractiveViewer>(find.byType(InteractiveViewer))
          .transformationController!
          .value
          .storage[0];
      await tester.tap(find.byTooltip('放大'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<InteractiveViewer>(find.byType(InteractiveViewer))
            .transformationController!
            .value
            .storage[0],
        greaterThan(before),
      );
      await tester.tap(find.byTooltip('适应画布'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      await tester.tap(find.text('对话维护'));
      await tester.pumpAndSettle();
      final composer = tester.widget<TextField>(find.byType(TextField).first);
      expect(composer.controller?.text, isEmpty);
      expect(find.text('可创建容器、数据库，调整网络、扩缩容或查看运行状态…'), findsOneWidget);
      expect(find.byTooltip('打开关联 Project'), findsOneWidget);
      final projectButton = find.byTooltip('打开关联 Project');
      for (final width in [940.0, 1600.0]) {
        tester.view.physicalSize = Size(width, 620);
        await tester.pumpAndSettle();
        expect(tester.getRect(projectButton).right, closeTo(width - 13, 1));
      }
      expect(
        find.descendant(
          of: projectButton,
          matching: find.byIcon(Icons.layers_outlined),
        ),
        findsOneWidget,
      );
      expect(
        backend.calls.where((method) => method == 'getOrCreateProjectChat'),
        hasLength(1),
      );

      await tester.tap(find.byTooltip('打开关联 Project'));
      await tester.pumpAndSettle();
      expect(find.text('资源拓扑'), findsOneWidget);
    },
  );

  testWidgets(
    'minimum desktop window renders detail headers without overflow',
    (tester) async {
      final (controller, _) = await pumpDesktop(tester);

      for (final route in const [
        DetailRoute('project', RegressionBackend.longName),
        DetailRoute('app', RegressionBackend.longName, kind: 'Deployment'),
        DetailRoute('database', RegressionBackend.longName),
      ]) {
        controller.openDetail(route);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        controller.closeDetail();
        await tester.pumpAndSettle();
      }
    },
  );

  testWidgets('container detail keeps network and maintenance actions clear', (
    tester,
  ) async {
    final (controller, backend) = await pumpDesktop(tester);
    controller.openDetail(
      const DetailRoute('app', RegressionBackend.longName, kind: 'Deployment'),
    );
    await tester.pumpAndSettle();

    expect(find.text('对话维护'), findsOneWidget);
    expect(find.text('公网'), findsOneWidget);
    expect(find.text('内网'), findsOneWidget);
    expect(find.textContaining('HTTP'), findsNothing);
    expect(find.textContaining('端口'), findsNothing);
    expect(find.byTooltip('刷新详情'), findsNothing);
    expect(find.text('打开站点'), findsNothing);
    expect(find.byTooltip('打开站点'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.dragUntilVisible(
      find.text('变量名'),
      find.byType(ListView).last,
      const Offset(0, -300),
    );
    expect(find.text('变量名'), findsOneWidget);
    expect(find.text('值或引用'), findsOneWidget);
    expect(find.byTooltip('复制环境变量'), findsNothing);

    await tester.dragUntilVisible(
      find.text('对话维护'),
      find.byType(ListView).last,
      const Offset(0, 300),
    );
    await tester.tap(find.text('对话维护'));
    await tester.pumpAndSettle();
    final composer = tester.widget<TextField>(find.byType(TextField).first);
    expect(
      composer.controller?.text,
      '我想对 ${RegressionBackend.longName} 容器进行如下操作：',
    );
    expect(find.text('你想完成什么？'), findsNothing);
    expect(find.text('维护 ${RegressionBackend.longName}'), findsOneWidget);
    expect(
      backend.calls.where((method) => method == 'getOrCreateProjectChat'),
      hasLength(1),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('database detail follows compact resource detail conventions', (
    tester,
  ) async {
    final (controller, backend) = await pumpDesktop(tester);
    controller.openDetail(
      const DetailRoute('database', RegressionBackend.longName),
    );
    await tester.pumpAndSettle();

    expect(find.text('对话维护'), findsOneWidget);
    expect(find.text('内网'), findsOneWidget);
    expect(find.text('公网'), findsOneWidget);
    expect(find.text('刷新详情'), findsNothing);
    expect(find.text('问 Sealos'), findsNothing);
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('对话维护'));
    await tester.pumpAndSettle();
    final composer = tester.widget<TextField>(find.byType(TextField).first);
    expect(
      composer.controller?.text,
      '我想对 ${RegressionBackend.longName} 数据库进行如下操作：',
    );
    expect(find.text('你想完成什么？'), findsNothing);
    expect(find.text('维护 ${RegressionBackend.longName}'), findsOneWidget);
    expect(
      backend.calls.where((method) => method == 'getOrCreateProjectChat'),
      hasLength(1),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('resource selections do not leak between project and app lists', (
    tester,
  ) async {
    final (controller, _) = await pumpDesktop(tester);
    controller.selectTab(DesktopTab.projects);
    await tester.pumpAndSettle();

    await tester.tap(find.byType(Checkbox).first);
    await tester.pump();
    expect(find.text('已选 1 项'), findsOneWidget);

    controller.selectTab(DesktopTab.apps);
    await tester.pumpAndSettle();
    expect(find.text('已选 1 项'), findsNothing);
  });

  testWidgets('unreported quota does not block a template deployment', (
    tester,
  ) async {
    final (controller, backend) = await pumpDesktop(tester);
    controller.selectTab(DesktopTab.templates);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    await tester.tap(find.widgetWithText(FilledButton, '部署'));
    await tester.pumpAndSettle();
    expect(backend.calls, contains('deployTemplate'));
    expect(tester.takeException(), isNull);
  });

  testWidgets('pod logs show an explicit empty state', (tester) async {
    final (controller, _) = await pumpDesktop(tester);
    controller.openDetail(
      const DetailRoute('database', RegressionBackend.longName),
    );
    await tester.pumpAndSettle();

    await tester.dragUntilVisible(
      find.text('暂无 Pod 可加载日志'),
      find.byType(ListView).last,
      const Offset(0, -300),
    );
    expect(find.text('暂无 Pod 可加载日志'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
