import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:helios_desktop/app.dart';
import 'package:helios_desktop/core/app_controller.dart';
import 'package:helios_desktop/core/backend_client.dart';
import 'package:helios_desktop/core/json.dart';
import 'package:helios_desktop/core/theme.dart';

class FakeBackend extends HeliosBackend {
  FakeBackend({
    this.authenticated = true,
    this.resourceError = false,
    this.pendingTrace = false,
    this.assistantText,
  });

  final bool authenticated;
  final bool resourceError;
  final bool pendingTrace;
  final String? assistantText;
  final controller = StreamController<BackendEvent>.broadcast();
  final calls = <String>[];

  @override
  Stream<BackendEvent> get events => controller.stream;

  @override
  String? get fatalError => null;

  @override
  bool get ready => true;

  @override
  Future<void> start() async {}

  @override
  Future<T?> call<T>(String method, [List<Object?> args = const []]) async {
    calls.add(method);
    if (method == 'getResources' && resourceError) {
      throw const BackendException('fetch failed');
    }
    final Object? result = switch (method) {
      'getStatus' => {
        'authenticated': authenticated,
        'workspace': 'ns-test',
        'workspaceName': '测试空间',
      },
      'getRegions' => <Object?>[
        {'label': '北京', 'url': 'https://bja.sealos.run'},
      ],
      'getResources' => {
        'projects': <Object?>[
          {
            'name': 'storefront-project',
            'displayName': '商城项目',
            'createdAt': '2026-09-07T08:00:00.000Z',
          },
        ],
        'apps': <Object?>[],
        'databases': <Object?>[],
        'buckets': <Object?>[],
        'quota': <Object?>[
          {
            'type': 'cpu',
            'used': 1,
            'limit': 8,
            'usedText': '1',
            'limitText': '8',
            'unit': 'vCPU',
          },
          {
            'type': 'memory',
            'used': 2,
            'limit': 16,
            'usedText': '2',
            'limitText': '16',
            'unit': 'GiB',
          },
          {
            'type': 'storage',
            'used': 10,
            'limit': 100,
            'usedText': '10',
            'limitText': '100',
            'unit': 'GiB',
          },
          {
            'type': 'gpu',
            'used': 0,
            'limit': 2,
            'usedText': '0',
            'limitText': '2',
            'unit': 'GPU',
          },
        ],
        'warnings': <Object?>[],
      },
      'listWorkspaces' => <Object?>[
        {
          'uid': 'workspace-test',
          'id': 'ns-test',
          'teamName': '测试空间',
          'roleLabel': '拥有者',
          'current': true,
        },
      ],
      'getWorkspaceDetails' => {
        'uid': 'workspace-test',
        'teamName': '测试空间',
        'myRoleLabel': '拥有者',
        'canRename': true,
        'canInvite': true,
        'members': <Object?>[],
      },
      'listChats' => <Object?>[
        {
          'id': 'chat-1',
          'title': '部署博客',
          'updatedAt': '2026-09-07T09:00:00.000Z',
        },
      ],
      'getChat' => {
        'id': 'chat-1',
        'title': '部署博客',
        'workspaceId': 'ns-test',
        'eveSessionId': null,
        'streamIndex': 0,
        'createdAt': '2026-09-07T09:00:00.000Z',
        'updatedAt': '2026-09-07T09:00:00.000Z',
        'messages': <Object?>[
          {'id': 'message-1', 'role': 'user', 'text': '帮我部署博客'},
          if (pendingTrace)
            {
              'id': 'message-2',
              'role': 'assistant',
              'text': '',
              'pending': true,
              'trace': <Object?>[
                {
                  'type': 'activity',
                  'id': 'codex-turn',
                  'label': 'Codex',
                  'detail': '正在连接本地执行器',
                  'status': 'running',
                },
              ],
            },
          if (assistantText != null)
            {
              'id': 'message-3',
              'role': 'assistant',
              'text': assistantText,
              'pending': false,
            },
        ],
      },
      'getAgentStatus' => {'state': 'ready'},
      'getAiProxyOverview' => {
        'endpoint': 'https://aiproxy.example.com',
        'keys': <Object?>[
          {
            'id': 1,
            'name': 'Helios Agent',
            'enabled': true,
            'requestCount': 42,
          },
          {'id': 2, 'name': 'Development', 'enabled': true, 'requestCount': 8},
        ],
        'usage': <String, Object?>{},
        'models': <Object?>[],
      },
      'getTemplates' => {
        'templates': <Object?>[
          {
            'name': '测试模板',
            'templateName': 'test-template',
            'description': '用于交互测试',
            'category': '开发工具',
            'tags': <Object?>[],
            'icon': '',
            'detailUrl': 'https://example.com',
          },
        ],
      },
      'getTemplateDetail' => {
        'args': {
          'PASSWORD': {'required': true, 'default': '', 'description': '必填参数'},
        },
        'quota': <String, Object?>{},
      },
      _ => null,
    };
    return result as T?;
  }

  @override
  Future<List<JsonMap>> pickChatFiles() async => [];

  @override
  Future<String?> pickLocalSource() async => null;

  @override
  Future<void> shutdown() async => controller.close();
}

void main() {
  test('light and dark themes expose the neutral desktop design tokens', () {
    final light = buildHeliosTheme();
    final dark = buildHeliosTheme(brightness: Brightness.dark);
    final lightColors = light.extension<HeliosPalette>()!;
    final darkColors = dark.extension<HeliosPalette>()!;

    expect(lightColors.canvas, const Color(0xfffafaf9));
    expect(lightColors.line, const Color(0xffe6e3de));
    expect(darkColors.canvas, const Color(0xff171716));
    expect(darkColors.surface, const Color(0xff1b1b1a));
    expect(darkColors.sidebar, const Color(0xff20201f));
    expect(light.textTheme.bodyMedium?.fontSize, 13);
    expect(light.textTheme.bodySmall?.fontSize, 12);
    expect(light.textTheme.titleMedium?.fontSize, 14);
    expect(light.cardTheme.elevation, 0);
    expect(light.colorScheme.primary, lightColors.accent);
    expect(dark.colorScheme.primary, darkColors.accent);
    expect(lightColors.accent, const Color(0xff171717));
    expect(darkColors.accent, const Color(0xff0f0f0f));
    expect(lightColors.link, HeliosColors.blue);
    expect(
      light.filledButtonTheme.style?.backgroundColor?.resolve({}),
      lightColors.accent,
    );
    expect(
      light.filledButtonTheme.style?.foregroundColor?.resolve({}),
      Colors.white,
    );
    expect(light.filledButtonTheme.style?.iconColor?.resolve({}), Colors.white);
    expect(
      light.textButtonTheme.style?.foregroundColor?.resolve({}),
      lightColors.ink,
    );
  });

  testWidgets('authenticated users get the complete desktop navigation', (
    tester,
  ) async {
    final app = HeliosApp(controller: AppController(FakeBackend()));
    await tester.pumpWidget(app);
    await tester.pumpAndSettle();

    for (final label in ['新对话', '项目', '资源', '设置']) {
      expect(find.text(label), findsWidgets);
    }
    for (final label in ['应用', '数据库', '存储']) {
      expect(find.text(label), findsNothing);
    }
    await tester.tap(find.text('资源'));
    await tester.pump();
    for (final label in ['应用', '数据库', '存储']) {
      expect(find.text(label), findsOneWidget);
    }
    expect(find.text('测试空间'), findsOneWidget);
    expect(find.byIcon(Icons.workspaces_outline), findsOneWidget);
    expect(find.byIcon(Icons.group_work_outlined), findsNothing);
    final workspaceMaterial = tester.widget<Material>(
      find
          .ancestor(
            of: find.byIcon(Icons.workspaces_outline),
            matching: find.byType(Material),
          )
          .first,
    );
    expect(workspaceMaterial.color, Colors.transparent);
    expect(workspaceMaterial.shape, isNull);
    expect(find.text('最近对话'), findsOneWidget);
    expect(find.text('最近项目'), findsOneWidget);
    expect(find.text('部署博客'), findsOneWidget);
    expect(find.text('商城项目'), findsNothing);
    expect(find.byIcon(Icons.history), findsNothing);
    expect(find.text('资源配额'), findsNothing);
    expect(find.text('1 / 8 vCPU'), findsNothing);
    expect(find.text('2 / 16 GiB'), findsNothing);
    expect(find.text('10 / 100 GiB'), findsNothing);
    expect(find.text('CUDA'), findsNothing);
    expect(find.text('0 / 2 GPU'), findsNothing);

    for (final scenario in ['部署 GitHub 项目', '部署本地源代码', '从应用商店部署', '启动一个数据库']) {
      expect(find.text(scenario), findsOneWidget);
    }
    expect(find.text('部署 Docker 镜像'), findsNothing);
    expect(find.text('全部'), findsOneWidget);
    expect(find.text('开发工具'), findsWidgets);
    expect(find.text('测试模板'), findsOneWidget);
    expect(find.text('详情'), findsOneWidget);

    await tester.tap(find.text('最近项目'));
    await tester.pump();
    expect(find.text('商城项目'), findsOneWidget);

    await tester.tap(find.text('开发工具').first);
    await tester.pump();
    expect(find.text('测试模板'), findsOneWidget);

    expect(find.text('AI Proxy'), findsNothing);
    await tester.tap(find.text('设置').first);
    await tester.pumpAndSettle();
    expect(find.text('对话模型'), findsOneWidget);
    expect(find.text('Helios Agent'), findsOneWidget);
    expect(find.text('Development'), findsOneWidget);
    expect(find.text('查看详情'), findsOneWidget);
    expect(find.text('API Keys'), findsNothing);

    await tester.tap(find.text('查看详情'));
    await tester.pumpAndSettle();
    expect(find.text('接入'), findsOneWidget);
    await tester.drag(find.byType(ListView).last, const Offset(0, -700));
    await tester.pumpAndSettle();
    expect(find.text('API Keys'), findsOneWidget);

    await tester.tap(find.text('测试空间').first);
    await tester.pumpAndSettle();
    final workspaceDialog = find.byType(Dialog);
    for (final text in [
      '资源配额',
      'CPU',
      '1 / 8 vCPU',
      '内存',
      '2 / 16 GiB',
      '存储',
      '10 / 100 GiB',
    ]) {
      expect(
        find.descendant(of: workspaceDialog, matching: find.text(text)),
        findsOneWidget,
      );
    }
    expect(
      find.descendant(of: workspaceDialog, matching: find.text('CUDA')),
      findsNothing,
    );
    expect(
      find.descendant(of: workspaceDialog, matching: find.text('0 / 2 GPU')),
      findsNothing,
    );
  });

  testWidgets('a background resource fetch failure does not show globally', (
    tester,
  ) async {
    final app = HeliosApp(
      controller: AppController(FakeBackend(resourceError: true)),
    );
    await tester.pumpWidget(app);
    await tester.pumpAndSettle();

    expect(find.text('fetch failed'), findsNothing);
    expect(find.text('网络连接失败，请检查网络后重试。'), findsNothing);
  });

  testWidgets('an existing chat shows its title and concise action menu', (
    tester,
  ) async {
    final app = HeliosApp(controller: AppController(FakeBackend()));
    await tester.pumpWidget(app);
    await tester.pumpAndSettle();

    await tester.tap(find.text('部署博客').first);
    await tester.pumpAndSettle();
    expect(find.text('部署博客'), findsNWidgets(2));

    await tester.tap(find.byType(PopupMenuButton<String>));
    await tester.pumpAndSettle();
    expect(find.text('重命名对话'), findsOneWidget);
    expect(find.text('归档对话'), findsOneWidget);
    expect(find.text('删除对话'), findsNothing);
  });

  testWidgets('a running Codex trace is expanded and visible', (tester) async {
    final app = HeliosApp(
      controller: AppController(FakeBackend(pendingTrace: true)),
    );
    await tester.pumpWidget(app);
    await tester.pumpAndSettle();

    await tester.tap(find.text('部署博客').first);
    await tester.pumpAndSettle();

    expect(find.text('正在执行'), findsOneWidget);
    expect(find.text('正在连接本地执行器'), findsOneWidget);
    expect(find.byType(SelectionArea), findsWidgets);
  });

  testWidgets('assistant HTTP links are blue and open in the system browser', (
    tester,
  ) async {
    final backend = FakeBackend(assistantText: '访问 https://example.com 查看应用。');
    final app = HeliosApp(controller: AppController(backend));
    await tester.pumpWidget(app);
    await tester.pumpAndSettle();

    await tester.tap(find.text('部署博客').first);
    await tester.pumpAndSettle();

    final richTextFinder = find.byWidgetPredicate(
      (widget) =>
          widget is SelectableText &&
          widget.textSpan?.toPlainText().contains('https://example.com') ==
              true,
    );
    expect(richTextFinder, findsOneWidget);
    final text = tester.widget<SelectableText>(richTextFinder).textSpan!;
    final linkSpan = _findLinkSpan(text, 'https://example.com');
    expect(linkSpan, isNotNull);
    final resolvedLink = linkSpan!;
    expect(resolvedLink.style?.color, HeliosColors.blue);
    expect(resolvedLink.style?.decoration, TextDecoration.underline);

    final recognizer = resolvedLink.recognizer! as TapGestureRecognizer;
    recognizer.onTap!();
    await tester.pump();
    expect(backend.calls, contains('openExternal'));
  });

  testWidgets('kubeconfig login enables save after text is entered', (
    tester,
  ) async {
    final app = HeliosApp(
      controller: AppController(FakeBackend(authenticated: false)),
    );
    await tester.pumpWidget(app);
    await tester.pumpAndSettle();

    await tester.tap(find.text('粘贴 kubeconfig 登录'));
    await tester.pump();
    final saveFinder = find.widgetWithText(OutlinedButton, '保存 kubeconfig');
    expect(tester.widget<OutlinedButton>(saveFinder).onPressed, isNull);

    await tester.enterText(find.byType(TextField), 'apiVersion: v1');
    await tester.pump();
    expect(tester.widget<OutlinedButton>(saveFinder).onPressed, isNotNull);
  });
}

TextSpan? _findLinkSpan(InlineSpan span, String href) {
  if (span is! TextSpan) return null;
  if (span.text == href && span.recognizer is TapGestureRecognizer) return span;
  for (final child in span.children ?? const <InlineSpan>[]) {
    final match = _findLinkSpan(child, href);
    if (match != null) return match;
  }
  return null;
}
