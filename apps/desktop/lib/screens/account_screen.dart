import 'dart:async';

import 'package:flutter/material.dart';

import '../core/backend_client.dart';
import '../core/json.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import 'ai_proxy_screen.dart';

class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key});

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  final deepseekKey = TextEditingController();
  StreamSubscription<BackendEvent>? subscription;
  JsonMap? model;
  JsonMap? proxyOverview;
  JsonMap? update;
  List<JsonMap>? executors;
  String version = '';
  String? error;
  bool busy = false;
  bool initialized = false;
  bool revealKey = false;
  bool showingAiProxy = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!initialized) {
      initialized = true;
      subscription = AppScope.of(context, listen: false).backend.events.listen((
        event,
      ) {
        if (event.channel == 'helios:update-event' && mounted) {
          setState(() => update = jsonMap(event.data));
        }
      });
      _load();
    }
  }

  Future<void> _load() async {
    final controller = AppScope.of(context, listen: false);
    try {
      final values = await Future.wait([
        controller.invoke('getModelSettings'),
        controller.invoke('getUpdateStatus'),
        controller.invoke('getAppVersion'),
        controller.invoke('getAgentExecutors'),
      ]);
      JsonMap? proxy;
      try {
        proxy = jsonMap(await controller.invoke('getAiProxyOverview'));
      } catch (_) {
        // The rest of settings stays usable when AI Proxy is unavailable.
      }
      if (mounted) {
        setState(() {
          model = jsonMap(values[0]);
          proxyOverview = proxy;
          update = jsonMap(values[1]);
          version = stringValue(values[2]);
          executors = jsonList(values[3]);
        });
      }
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    }
  }

  Future<void> _saveKey() async {
    final key = deepseekKey.text.trim();
    if (key.isEmpty) return;
    await _run(() async {
      await AppScope.of(
        context,
        listen: false,
      ).invoke('saveDeepseekKey', [key]);
      deepseekKey.clear();
      await _load();
    });
  }

  Future<void> _clearKey() async {
    await _run(() async {
      await AppScope.of(context, listen: false).invoke('clearDeepseekKey');
      await _load();
    });
  }

  Future<void> _setExecutor(String? id) async {
    await _run(() async {
      await AppScope.of(
        context,
        listen: false,
      ).invoke('setAgentExecutor', [id]);
      await _load();
    });
  }

  Future<void> _run(Future<void> Function() task) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await task();
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    subscription?.cancel();
    deepseekKey.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = AppScope.of(context);
    final colors = context.helios;
    final status = controller.status ?? const <String, dynamic>{};
    if (showingAiProxy) return _aiProxyDetail();
    final activeKeys = jsonList(proxyOverview?['keys'])
        .where((key) => boolValue(key['enabled']))
        .take(3)
        .toList();
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        if (error != null) ...[
          ErrorBanner(
            message: error!,
            onClose: () => setState(() => error = null),
          ),
          const SizedBox(height: 14),
        ],
        const SectionTitle('账户'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                KeyValue(
                  '区域',
                  stringValue(
                    status['regionDomain'],
                    stringValue(status['server']),
                  ),
                ),
                KeyValue(
                  'API Server',
                  stringValue(status['server']),
                  copy: true,
                ),
                KeyValue(
                  '工作空间',
                  stringValue(
                    status['workspaceName'],
                    stringValue(status['workspace']),
                  ),
                ),
                KeyValue('命名空间', stringValue(status['namespace'])),
                KeyValue('登录时间', displayDate(status['authenticatedAt'])),
                KeyValue(
                  'kubeconfig',
                  stringValue(status['kubeconfigPath']),
                  copy: true,
                ),
                const Divider(),
                Align(
                  alignment: Alignment.centerRight,
                  child: OutlinedButton.icon(
                    onPressed: busy
                        ? null
                        : () async {
                            if (!await confirmAction(
                              context,
                              title: '退出登录',
                              message: '将停止当前 Agent 并清除 Sealos 登录凭证。',
                              confirmLabel: '退出登录',
                            )) {
                              return;
                            }
                            await _run(controller.logout);
                          },
                    icon: const Icon(Icons.logout, size: 17),
                    label: const Text('退出登录'),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 24),
        const SectionTitle('Agent 配置'),
        Card(
          child: Column(
            children: [
              for (final executor in executors ?? const <JsonMap>[])
                _ExecutorRow(
                  name: stringValue(executor['label']),
                  command: stringValue(executor['command']),
                  version: stringValue(executor['version']),
                  available: boolValue(executor['available']),
                  enabled: boolValue(executor['enabled']),
                  busy: busy,
                  onEnable: () => _setExecutor(stringValue(executor['id'])),
                  onDisable: () => _setExecutor(null),
                ),
              if (executors == null)
                const Padding(
                  padding: EdgeInsets.all(16),
                  child: Center(
                    child: CircularProgressIndicator(strokeWidth: 1.8),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        const SectionTitle('对话模型'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.key_outlined, color: colors.muted, size: 20),
                    const SizedBox(width: 9),
                    Expanded(
                      child: Text(
                        activeKeys.isEmpty ? '暂无正在使用的 Key' : '正在使用的 Key',
                      ),
                    ),
                    TextButton.icon(
                      onPressed: () => setState(() => showingAiProxy = true),
                      icon: const Icon(Icons.arrow_forward, size: 16),
                      label: const Text('查看详情'),
                    ),
                  ],
                ),
                if (proxyOverview == null) ...[
                  const SizedBox(height: 14),
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 1.8),
                  ),
                ] else if (activeKeys.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  for (final key in activeKeys)
                    _ActiveAiKeyRow(
                      name: stringValue(key['name'], '未命名 Key'),
                      requestCount: intValue(key['requestCount']),
                    ),
                ],
                const SizedBox(height: 8),
                ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  childrenPadding: const EdgeInsets.only(bottom: 4),
                  title: const Text('使用自己的 DeepSeek API Key'),
                  subtitle: Text(
                    boolValue(model?['configured'])
                        ? stringValue(model?['hint'], '已配置')
                        : '可选',
                  ),
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: deepseekKey,
                            obscureText: !revealKey,
                            onChanged: (_) => setState(() {}),
                            decoration: InputDecoration(
                              labelText: 'DeepSeek API Key',
                              suffixIcon: IconButton(
                                tooltip: revealKey ? '隐藏' : '显示',
                                onPressed: () =>
                                    setState(() => revealKey = !revealKey),
                                icon: Icon(
                                  revealKey
                                      ? Icons.visibility_off_outlined
                                      : Icons.visibility_outlined,
                                  size: 18,
                                ),
                              ),
                            ),
                          ),
                        ),
                        IconButton(
                          tooltip: '打开 DeepSeek API Keys',
                          onPressed: () =>
                              AppScope.of(context, listen: false).invoke(
                                'openExternal',
                                ['https://platform.deepseek.com/api_keys'],
                              ),
                          icon: const Icon(Icons.open_in_new, size: 18),
                        ),
                        const SizedBox(width: 10),
                        FilledButton.icon(
                          onPressed: busy || deepseekKey.text.trim().isEmpty
                              ? null
                              : _saveKey,
                          icon: const Icon(Icons.save_outlined, size: 17),
                          label: const Text('保存'),
                        ),
                        if (boolValue(model?['configured'])) ...[
                          const SizedBox(width: 8),
                          OutlinedButton(
                            onPressed: busy ? null : _clearKey,
                            child: const Text('恢复 AI Proxy'),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 24),
        const SectionTitle('更新'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.system_update_alt, size: 20),
                    const SizedBox(width: 9),
                    Expanded(child: Text('Helios $version')),
                    if (boolValue(update?['available']))
                      FilledButton.icon(
                        onPressed: busy || update?['phase'] == 'downloading'
                            ? null
                            : () => _run(
                                () async => AppScope.of(
                                  context,
                                  listen: false,
                                ).invoke('downloadUpdate'),
                              ),
                        icon: const Icon(Icons.download, size: 17),
                        label: Text(
                          update?['phase'] == 'downloading'
                              ? '下载中'
                              : '下载 ${stringValue(update?['latestVersion'])}',
                        ),
                      )
                    else
                      Text(
                        '已是最新版本',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                  ],
                ),
                if (update?['phase'] == 'downloading') ...[
                  const SizedBox(height: 14),
                  LinearProgressIndicator(
                    value: doubleValue(update?['progress']),
                  ),
                ],
                if (stringValue(update?['notes']).isNotEmpty) ...[
                  const SizedBox(height: 14),
                  Text(stringValue(update?['notes'])),
                ],
                if (stringValue(update?['error']).isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(
                    stringValue(update?['error']),
                    style: TextStyle(color: colors.red),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _aiProxyDetail() {
    final colors = context.helios;
    return Column(
      children: [
        Container(
          height: 50,
          padding: const EdgeInsets.symmetric(horizontal: 18),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: colors.line)),
          ),
          child: Row(
            children: [
              IconButton(
                tooltip: '返回设置',
                onPressed: () => setState(() => showingAiProxy = false),
                icon: const Icon(Icons.arrow_back, size: 20),
              ),
              const SizedBox(width: 8),
              Text('对话模型', style: Theme.of(context).textTheme.titleMedium),
            ],
          ),
        ),
        const Expanded(child: AiProxyScreen()),
      ],
    );
  }
}

class _ActiveAiKeyRow extends StatelessWidget {
  const _ActiveAiKeyRow({required this.name, required this.requestCount});

  final String name;
  final int requestCount;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Icon(Icons.key_outlined, size: 16, color: colors.muted),
          const SizedBox(width: 8),
          Expanded(
            child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          Text(
            '$requestCount 请求',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

class _ExecutorRow extends StatelessWidget {
  const _ExecutorRow({
    required this.name,
    required this.command,
    required this.version,
    required this.available,
    required this.enabled,
    required this.busy,
    required this.onEnable,
    required this.onDisable,
  });

  final String name;
  final String command;
  final String version;
  final bool available;
  final bool enabled;
  final bool busy;
  final VoidCallback onEnable;
  final VoidCallback onDisable;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 3),
      leading: Icon(
        enabled ? Icons.bolt_outlined : Icons.terminal_outlined,
        color: enabled ? colors.ink : colors.muted,
      ),
      title: Text(name),
      subtitle: Text(
        available ? (version.isEmpty ? command : version) : '未检测到 $command',
        style: Theme.of(context).textTheme.bodySmall,
      ),
      trailing: enabled
          ? OutlinedButton(
              onPressed: busy ? null : onDisable,
              child: const Text('已启用'),
            )
          : available
          ? FilledButton(
              onPressed: busy ? null : onEnable,
              child: const Text('启用'),
            )
          : Text('未安装', style: TextStyle(color: colors.muted)),
    );
  }
}
