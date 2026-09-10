import '../core/auto_refresh.dart';

import 'package:flutter/material.dart';

import '../core/app_controller.dart';
import '../core/json.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import '../widgets/detail_widgets.dart';

class AppDetailScreen extends StatefulWidget {
  const AppDetailScreen({required this.name, required this.kind, super.key});

  final String name;
  final String kind;

  @override
  State<AppDetailScreen> createState() => _AppDetailScreenState();
}

class _AppDetailScreenState extends State<AppDetailScreen>
    with AutoRefresh<AppDetailScreen> {
  @override
  bool get canAutoRefresh => !busy;
  @override
  Future<void> refreshAutomatically() => _load();

  JsonMap? detail;
  JsonMap? monitor;
  String? error;
  bool busy = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (detail == null && error == null) _load();
  }

  Future<void> _load() async {
    final controller = AppScope.of(context, listen: false);
    try {
      // The workload detail is the primary page data. Monitoring is
      // supplementary and may be unavailable when the monitoring endpoint or
      // kubeconfig is temporarily unreachable, so it must not block the page.
      final loadedDetail = await controller.invoke('getAppDetail', [
        widget.name,
        widget.kind,
      ]);
      if (!mounted) return;
      setState(() {
        detail = jsonMap(loadedDetail);
      });

      try {
        final loadedMonitor = await controller.invoke('getAppMonitor', [
          widget.name,
        ]);
        if (mounted) setState(() => monitor = jsonMap(loadedMonitor));
      } catch (_) {
        if (mounted) {
          setState(
            () => monitor = {
              'available': false,
              'cpu': const <Object?>[],
              'memory': const <Object?>[],
            },
          );
        }
      }
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    }
  }

  Future<void> _operate(String action) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await AppScope.of(
        context,
        listen: false,
      ).operate('${action}App', widget.name);
      await _load();
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _openMaintenanceChat() async {
    final data = detail;
    if (data == null || busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await AppScope.of(context, listen: false).openResourceChat(
        projectName: stringValue(data['project']),
        draft: '我想对 ${widget.name} 容器进行如下操作：',
      );
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _delete() async {
    final project = stringValue(detail?['project']);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('删除应用'),
        content: Text(
          project.isEmpty
              ? '将删除应用「${widget.name}」。此操作不可恢复。'
              : '该应用是项目 $project 的一部分。只删除这个应用，数据库和其它应用保留。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          if (project.isNotEmpty)
            TextButton(
              onPressed: () => Navigator.pop(context, 'project'),
              child: const Text('去项目'),
            ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: context.helios.red,
              foregroundColor: Theme.of(context).colorScheme.onError,
            ),
            onPressed: () => Navigator.pop(context, 'delete'),
            child: const Text('只删除这个应用'),
          ),
        ],
      ),
    );
    if (result == 'project') {
      if (mounted) {
        AppScope.of(
          context,
          listen: false,
        ).openDetail(DetailRoute('project', project));
      }
      return;
    }
    if (result != 'delete') return;
    await _operate('delete');
    if (mounted) AppScope.of(context, listen: false).closeDetail();
  }

  @override
  Widget build(BuildContext context) {
    final data = detail;
    if (data == null && error == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (data == null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: ErrorBanner(
          message: error!,
          onClose: () {
            setState(() => error = null);
            _load();
          },
        ),
      );
    }
    final launchpad = boolValue(data['launchpad']);
    final paused = boolValue(data['paused']) || data['status'] == 'Stopped';
    final pods = jsonList(data['pods']);
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 10, 24, 20),
      children: [
        if (error != null) ...[
          ErrorBanner(
            message: error!,
            onClose: () => setState(() => error = null),
          ),
          const SizedBox(height: 10),
        ],
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            IconButton(
              tooltip: '返回',
              onPressed: AppScope.of(context, listen: false).closeDetail,
              icon: const Icon(Icons.arrow_back, size: 20),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.headlineLarge,
                  ),
                  const SizedBox(height: 4),
                  StatusBadge(stringValue(data['status'])),
                ],
              ),
            ),
            FilledButton.icon(
              onPressed: busy ? null : _openMaintenanceChat,
              icon: const Icon(Icons.forum_outlined, size: 17),
              label: const Text('对话维护'),
            ),
            if (launchpad) ...[
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: busy
                    ? null
                    : () => _operate(paused ? 'start' : 'pause'),
                icon: Icon(paused ? Icons.play_arrow : Icons.pause, size: 17),
                label: Text(paused ? '启动' : '暂停'),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: busy ? null : () => _operate('restart'),
                icon: const Icon(Icons.restart_alt, size: 17),
                label: const Text('重启'),
              ),
              const SizedBox(width: 8),
              Tooltip(
                message: '删除应用',
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: context.helios.red,
                    minimumSize: const Size(34, 34),
                    padding: EdgeInsets.zero,
                  ),
                  onPressed: busy ? null : _delete,
                  child: const Icon(Icons.delete_outline, size: 17),
                ),
              ),
            ],
          ],
        ),
        if (!launchpad) ...[
          const SizedBox(height: 10),
          const ErrorBanner(
            message: '该工作负载不由 App Launchpad 管理，Sealos 仅提供只读信息。',
          ),
        ],
        const SizedBox(height: 16),
        const SectionTitle('网络'),
        _networkSection(jsonList(data['networks'])),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: [
                KeyValue('类型', stringValue(data['kind']), dense: true),
                KeyValue(
                  boolValue(data['privateImage']) ? '镜像（私有仓库）' : '镜像',
                  stringValue(data['image']),
                  copy: true,
                  dense: true,
                ),
                KeyValue(
                  '副本',
                  '${intValue(data['readyReplicas'])}/${intValue(data['replicas'])}',
                  dense: true,
                ),
                KeyValue('CPU', stringValue(data['cpuLimit']), dense: true),
                KeyValue('内存', stringValue(data['memoryLimit']), dense: true),
                if (stringValue(data['gpu']).isNotEmpty)
                  KeyValue('GPU', stringValue(data['gpu']), dense: true),
                KeyValue('创建时间', displayDate(data['createdAt']), dense: true),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        const SectionTitle('健康 · 近 1 小时'),
        MonitorCharts(monitor: monitorForCurrentPods(monitor, pods)),
        const SizedBox(height: 16),
        const SectionTitle('配置'),
        _configSection(data),
        const SizedBox(height: 16),
        const SectionTitle('持久存储'),
        _storesSection(jsonList(data['stores'])),
        const SizedBox(height: 16),
        const SectionTitle('Pods'),
        PodsSection(pods: pods),
        const SizedBox(height: 16),
        const SectionTitle('日志尾部快照'),
        PodLogsPanel(pods: pods),
        const SizedBox(height: 16),
        const SectionTitle('事件'),
        EventsSection(events: jsonList(data['events'])),
      ],
    );
  }

  Widget _networkSection(List<JsonMap> networks) {
    final endpoints = <_NetworkEndpoint>[];
    for (final item in networks) {
      final publicUrl = stringValue(item['publicUrl']);
      final clusterAddress = stringValue(item['clusterAddress']);
      if (publicUrl.isNotEmpty) {
        endpoints.add(
          _NetworkEndpoint(label: '公网', address: publicUrl, isPublic: true),
        );
      }
      if (clusterAddress.isNotEmpty) {
        endpoints.add(
          _NetworkEndpoint(
            label: '内网',
            address: clusterAddress,
            isPublic: false,
          ),
        );
      } else if (publicUrl.isEmpty && intValue(item['nodePort']) > 0) {
        endpoints.add(
          _NetworkEndpoint(
            label: '内网',
            address: '内网地址暂不可用',
            isPublic: false,
            copyable: false,
          ),
        );
      }
    }
    if (endpoints.isEmpty) {
      return const SizedBox(
        height: 80,
        child: EmptyState(icon: Icons.language_outlined, title: '暂无网络入口'),
      );
    }
    return Card(
      child: Column(
        children: [
          for (var index = 0; index < endpoints.length; index++) ...[
            _networkEndpointTile(endpoints[index]),
            if (index < endpoints.length - 1) const Divider(height: 1),
          ],
        ],
      ),
    );
  }

  Widget _networkEndpointTile(_NetworkEndpoint endpoint) {
    final colors = context.helios;
    final labelColor = endpoint.isPublic ? colors.accent : colors.muted;
    return ListTile(
      dense: true,
      visualDensity: VisualDensity.compact,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14),
      minLeadingWidth: 22,
      horizontalTitleGap: 10,
      leading: Icon(
        endpoint.isPublic ? Icons.public_outlined : Icons.lan_outlined,
        size: 18,
        color: labelColor,
      ),
      title: Row(
        children: [
          SizedBox(
            width: 42,
            child: Text(
              endpoint.label,
              style: Theme.of(context).textTheme.bodySmall
                  ?.copyWith(color: labelColor),
            ),
          ),
          Expanded(
            child: SelectableText(
              endpoint.address,
              maxLines: 1,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
        ],
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (endpoint.copyable)
            IconButton(
              tooltip: '复制${endpoint.label}地址',
              visualDensity: VisualDensity.compact,
              onPressed: () => AppScope.of(
                context,
                listen: false,
              ).invoke('copyText', [endpoint.address]),
              icon: const Icon(Icons.copy_outlined, size: 16),
            ),
          if (endpoint.isPublic)
            IconButton(
              tooltip: '打开站点',
              visualDensity: VisualDensity.compact,
              onPressed: () => AppScope.of(
                context,
                listen: false,
              ).invoke('openExternal', [endpoint.address]),
              icon: const Icon(Icons.open_in_new, size: 16),
            ),
        ],
      ),
    );
  }

  Widget _configSection(JsonMap data) {
    final envs = jsonList(data['envs']);
    final configMaps = jsonList(data['configMaps']);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            KeyValue('命令', stringValue(data['command']), copy: true),
            KeyValue('参数', stringValue(data['args']), copy: true),
            if (jsonMap(data['hpa']).isNotEmpty)
              KeyValue(
                '自动伸缩',
                '${jsonMap(data['hpa'])['minReplicas']} - ${jsonMap(data['hpa'])['maxReplicas']} 副本',
              ),
            if (envs.isNotEmpty) ...[
              const Divider(height: 22),
              Text('环境变量', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 7),
              _environmentVariables(envs),
            ],
            if (configMaps.isNotEmpty) ...[
              const Divider(height: 22),
              Text('ConfigMap', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 4),
              for (final item in configMaps)
                KeyValue(
                  stringValue(item['mountPath']),
                  stringValue(item['value']),
                  copy: true,
                ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _environmentVariables(List<JsonMap> envs) {
    final colors = context.helios;
    return Container(
      decoration: BoxDecoration(
        color: colors.panel,
        border: Border.all(color: colors.line),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 5, 12, 4),
            child: Row(
              children: [
                Expanded(
                  flex: 3,
                  child: Text(
                    '变量名',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
                Expanded(
                  flex: 4,
                  child: Text(
                    '值或引用',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: colors.line),
          for (var index = 0; index < envs.length; index++) ...[
            _environmentVariableRow(envs[index]),
            if (index < envs.length - 1) Divider(height: 1, color: colors.line),
          ],
        ],
      ),
    );
  }

  Widget _environmentVariableRow(JsonMap item) {
    final key = stringValue(item['key']);
    final from = stringValue(item['from']);
    final value = stringValue(item['value']);
    final display = from.isNotEmpty ? '引用：$from' : value;
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 3,
            child: SelectableText(
              key.isEmpty ? '-' : key,
              maxLines: 1,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 4,
            child: SelectableText(
              display.isEmpty ? '-' : display,
              maxLines: 1,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }

  Widget _storesSection(List<JsonMap> stores) {
    if (stores.isEmpty) {
      return const SizedBox(
        height: 100,
        child: EmptyState(icon: Icons.save_outlined, title: '无持久存储'),
      );
    }
    return Card(
      child: Column(
        children: [
          for (final store in stores)
            ListTile(
              dense: true,
              visualDensity: VisualDensity.compact,
              leading: const Icon(Icons.save_outlined),
              title: Text(stringValue(store['name'])),
              subtitle: Text(stringValue(store['path'])),
              trailing: Text(stringValue(store['size'])),
            ),
        ],
      ),
    );
  }
}

class _NetworkEndpoint {
  const _NetworkEndpoint({
    required this.label,
    required this.address,
    required this.isPublic,
    this.copyable = true,
  });

  final String label;
  final String address;
  final bool isPublic;
  final bool copyable;
}
