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

class _AppDetailScreenState extends State<AppDetailScreen> {
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
      final values = await Future.wait([
        controller.invoke('getAppDetail', [widget.name, widget.kind]),
        controller.invoke('getAppMonitor', [widget.name]),
      ]);
      if (!mounted) return;
      setState(() {
        detail = jsonMap(values[0]);
        monitor = jsonMap(values[1]);
      });
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
    final project = stringValue(data['project']);
    final publicUrl = jsonList(data['networks'])
        .map((network) => stringValue(network['publicUrl']))
        .where((url) => url.isNotEmpty)
        .firstOrNull;
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
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.name,
                    style: Theme.of(context).textTheme.headlineLarge,
                  ),
                  const SizedBox(height: 7),
                  StatusBadge(stringValue(data['status'])),
                ],
              ),
            ),
            if (launchpad) ...[
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
              IconButton(
                tooltip: '删除应用',
                onPressed: busy ? null : _delete,
                icon: Icon(Icons.delete_outline, color: context.helios.red),
              ),
            ],
            IconButton(
              tooltip: '刷新详情',
              onPressed: busy ? null : _load,
              icon: const Icon(Icons.refresh, size: 20),
            ),
          ],
        ),
        if (project.isNotEmpty || publicUrl != null) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (project.isNotEmpty)
                TextButton.icon(
                  onPressed: () => AppScope.of(
                    context,
                    listen: false,
                  ).openDetail(DetailRoute('project', project)),
                  icon: const Icon(Icons.layers_outlined, size: 16),
                  label: Text(project),
                ),
              if (publicUrl != null)
                TextButton.icon(
                  onPressed: () => AppScope.of(
                    context,
                    listen: false,
                  ).invoke('openExternal', [publicUrl]),
                  icon: const Icon(Icons.open_in_new, size: 16),
                  label: const Text('打开站点'),
                ),
            ],
          ),
        ],
        if (!launchpad) ...[
          const SizedBox(height: 14),
          const ErrorBanner(
            message: '该工作负载不由 App Launchpad 管理，Helios 仅提供只读信息。',
          ),
        ],
        const SizedBox(height: 22),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              children: [
                KeyValue('类型', stringValue(data['kind'])),
                KeyValue(
                  boolValue(data['privateImage']) ? '镜像（私有仓库）' : '镜像',
                  stringValue(data['image']),
                  copy: true,
                ),
                KeyValue(
                  '副本',
                  '${intValue(data['readyReplicas'])}/${intValue(data['replicas'])}',
                ),
                KeyValue('CPU', stringValue(data['cpuLimit'])),
                KeyValue('内存', stringValue(data['memoryLimit'])),
                if (stringValue(data['gpu']).isNotEmpty)
                  KeyValue('GPU', stringValue(data['gpu'])),
                if (stringValue(data['project']).isNotEmpty)
                  KeyValue('项目', stringValue(data['project'])),
                KeyValue('创建时间', displayDate(data['createdAt'])),
              ],
            ),
          ),
        ),
        const SizedBox(height: 24),
        const SectionTitle('健康 · 近 1 小时'),
        MonitorCharts(monitor: monitorForCurrentPods(monitor, pods)),
        const SizedBox(height: 24),
        const SectionTitle('网络'),
        _networkSection(jsonList(data['networks'])),
        const SizedBox(height: 24),
        const SectionTitle('配置'),
        _configSection(data),
        const SizedBox(height: 24),
        const SectionTitle('持久存储'),
        _storesSection(jsonList(data['stores'])),
        const SizedBox(height: 24),
        const SectionTitle('Pods'),
        PodsSection(pods: pods),
        const SizedBox(height: 24),
        const SectionTitle('日志尾部快照'),
        PodLogsPanel(pods: pods),
        const SizedBox(height: 24),
        const SectionTitle('事件'),
        EventsSection(events: jsonList(data['events'])),
      ],
    );
  }

  Widget _networkSection(List<JsonMap> networks) {
    if (networks.isEmpty) {
      return const SizedBox(
        height: 100,
        child: EmptyState(icon: Icons.language_outlined, title: '暂无网络入口'),
      );
    }
    return Card(
      child: Column(
        children: [
          for (final item in networks)
            ListTile(
              leading: const Icon(Icons.language_outlined),
              title: Text(
                '${intValue(item['port'])}/${stringValue(item['appProtocol'], stringValue(item['protocol']))}',
              ),
              subtitle: Text(stringValue(item['clusterAddress'])),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (stringValue(item['clusterAddress']).isNotEmpty)
                    IconButton(
                      tooltip: '复制集群内地址',
                      onPressed: () => AppScope.of(
                        context,
                        listen: false,
                      ).invoke('copyText', [item['clusterAddress']]),
                      icon: const Icon(Icons.content_copy, size: 16),
                    ),
                  if (stringValue(item['publicUrl']).isNotEmpty)
                    TextButton.icon(
                      onPressed: () => AppScope.of(
                        context,
                        listen: false,
                      ).invoke('openExternal', [item['publicUrl']]),
                      icon: const Icon(Icons.open_in_new, size: 16),
                      label: Text(
                        boolValue(item['customDomain']) ? '自定义域名' : '公网',
                      ),
                    )
                  else if (intValue(item['nodePort']) > 0)
                    Text(
                      'NodePort ${intValue(item['nodePort'])}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                ],
              ),
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
        padding: const EdgeInsets.all(18),
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
              const Divider(),
              Text('环境变量', style: Theme.of(context).textTheme.titleMedium),
              for (final item in envs)
                KeyValue(
                  stringValue(item['key']),
                  stringValue(item['from'], stringValue(item['value'])),
                ),
            ],
            if (configMaps.isNotEmpty) ...[
              const Divider(),
              Text('ConfigMap', style: Theme.of(context).textTheme.titleMedium),
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
