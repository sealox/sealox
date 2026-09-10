import '../core/auto_refresh.dart';

import 'package:flutter/material.dart';

import '../core/app_controller.dart';
import '../core/json.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import '../widgets/detail_widgets.dart';

class DatabaseDetailScreen extends StatefulWidget {
  const DatabaseDetailScreen({required this.name, super.key});

  final String name;

  @override
  State<DatabaseDetailScreen> createState() => _DatabaseDetailScreenState();
}

class _DatabaseDetailScreenState extends State<DatabaseDetailScreen>
    with AutoRefresh<DatabaseDetailScreen> {
  @override
  bool get canAutoRefresh => !busy;
  @override
  Future<void> refreshAutomatically() => _load();

  JsonMap? detail;
  JsonMap? monitor;
  JsonMap? schema;
  String? error;
  bool busy = false;
  final revealed = <String>{};

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (detail == null && error == null) _load();
  }

  bool _loading = false;

  Future<void> _load() async {
    if (_loading) return;
    _loading = true;
    final controller = AppScope.of(context, listen: false);
    try {
      // Database details are the primary page data. Monitoring and schema
      // are supplementary and should not prevent the page from opening.
      final loadedDetail = await controller.invoke('getDatabaseDetail', [
        widget.name,
      ]);
      if (!mounted) return;
      setState(() => detail = jsonMap(loadedDetail));

      try {
        final loadedMonitor = await controller.invoke('getDatabaseMonitor', [
          widget.name,
        ]);
        if (mounted) monitor = jsonMap(loadedMonitor);
      } catch (_) {
        if (mounted) {
          monitor = {
            'available': false,
            'cpu': const <Object?>[],
            'memory': const <Object?>[],
            'disk': const <Object?>[],
          };
        }
      }

      try {
        final loadedSchema = await controller.invoke('getDatabaseSchema', [
          widget.name,
        ]);
        if (mounted) schema = jsonMap(loadedSchema);
      } catch (_) {
        if (mounted) {
          schema = {'supported': false, 'reason': 'error'};
        }
      }
      if (mounted) setState(() {});
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    } finally {
      _loading = false;
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
      ).operate('${action}Database', widget.name);
      if (action != 'delete') await _load();
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
        draft: '我想对 ${widget.name} 数据库进行如下操作：',
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
        title: const Text('删除数据库'),
        content: Text(
          project.isEmpty
              ? '将删除数据库「${widget.name}」。此操作不可恢复。'
              : '该数据库是项目 $project 的一部分。删除可能导致项目中的应用无法连接。',
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
            child: const Text('只删除这个数据库'),
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

  Future<void> _togglePublic(bool value) async {
    setState(() => busy = true);
    try {
      await AppScope.of(context, listen: false).invoke(
        value ? 'enableDatabasePublic' : 'disableDatabasePublic',
        [widget.name],
      );
      await _load();
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = detail;
    if (data == null && error == null) {
      return const BrandLoading();
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
    final stopped = stringValue(data['phase']) == 'Stopped';
    final engine = stringValue(data['engine']);
    final version = stringValue(data['version']);
    final publicConnection = jsonMap(data['publicConnection']);
    if (publicConnection.isEmpty &&
        stringValue(data['publicConnectionRaw']).isNotEmpty) {
      publicConnection['connectionString'] = data['publicConnectionRaw'];
    }
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
                  Text(
                    '$engine $version',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 6),
                  StatusBadge(stringValue(data['phase'])),
                ],
              ),
            ),
            FilledButton.icon(
              onPressed: busy ? null : _openMaintenanceChat,
              icon: const Icon(Icons.forum_outlined, size: 17),
              label: const Text('对话维护'),
            ),
            const SizedBox(width: 8),
            OutlinedButton.icon(
              onPressed: busy
                  ? null
                  : () => _operate(stopped ? 'start' : 'pause'),
              icon: Icon(stopped ? Icons.play_arrow : Icons.pause, size: 17),
              label: Text(stopped ? '启动' : '暂停'),
            ),
            const SizedBox(width: 8),
            OutlinedButton.icon(
              onPressed: busy ? null : () => _operate('restart'),
              icon: const Icon(Icons.restart_alt, size: 17),
              label: const Text('重启'),
            ),
            const SizedBox(width: 8),
            Tooltip(
              message: '删除数据库',
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
        ),
        const SizedBox(height: 16),
        const SectionTitle('连接'),
        _connectionCard('内网', jsonMap(data['connection']), 'internal'),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: Text('公网', style: Theme.of(context).textTheme.titleMedium),
            ),
            Text(
              boolValue(data['publicEnabled']) ? '已开启' : '未开启',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(width: 6),
            Switch(
              value: boolValue(data['publicEnabled']),
              onChanged: busy ? null : _togglePublic,
            ),
          ],
        ),
        if (boolValue(data['publicEnabled']))
          _connectionCard('公网', publicConnection, 'public', showTitle: false),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: [
                KeyValue('引擎', engine, dense: true),
                KeyValue('版本', version, dense: true),
                KeyValue(
                  'CPU',
                  data['cpu'] == null ? '' : '${data['cpu']} vCPU',
                  dense: true,
                ),
                KeyValue(
                  '内存',
                  data['memory'] == null ? '' : '${data['memory']} GiB',
                  dense: true,
                ),
                KeyValue(
                  '存储',
                  data['storage'] == null ? '' : '${data['storage']} GiB',
                  dense: true,
                ),
                KeyValue('副本', stringValue(data['replicas']), dense: true),
                KeyValue('创建时间', displayDate(data['createdAt']), dense: true),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        const SectionTitle('健康 · 近 1 小时'),
        MonitorCharts(monitor: monitor, includeDisk: true),
        const SizedBox(height: 16),
        const SectionTitle('被谁使用'),
        Card(
          child: jsonList(data['usedBy']).isEmpty
              ? const SizedBox(
                  height: 80,
                  child: EmptyState(
                    icon: Icons.link_off,
                    title: '当前没有已证实的应用引用',
                  ),
                )
              : Column(
                  children: [
                    for (final app in jsonList(data['usedBy']))
                      ListTile(
                        dense: true,
                        visualDensity: VisualDensity.compact,
                        leading: const Icon(Icons.grid_view_outlined),
                        title: Text(stringValue(app['name'])),
                        trailing: StatusBadge(stringValue(app['status'])),
                        onTap: () =>
                            AppScope.of(context, listen: false).openDetail(
                              DetailRoute(
                                'app',
                                stringValue(app['name']),
                                kind: stringValue(app['kind']),
                              ),
                            ),
                      ),
                  ],
                ),
        ),
        const SizedBox(height: 16),
        const SectionTitle('结构'),
        _schemaSection(),
        const SizedBox(height: 16),
        const SectionTitle('Pods'),
        PodsSection(pods: jsonList(data['pods'])),
        const SizedBox(height: 16),
        const SectionTitle('日志尾部快照'),
        PodLogsPanel(pods: jsonList(data['pods'])),
        const SizedBox(height: 16),
        const SectionTitle('事件'),
        EventsSection(events: jsonList(data['events'])),
      ],
    );
  }

  Widget _connectionCard(
    String title,
    JsonMap connection,
    String prefix, {
    bool showTitle = true,
  }) {
    if (connection.isEmpty) {
      return const SizedBox(
        height: 80,
        child: EmptyState(icon: Icons.link_off, title: '凭证尚未就绪'),
      );
    }
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (showTitle) ...[
              Text(title, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 4),
            ],
            KeyValue(
              'Host',
              stringValue(connection['host']),
              copy: true,
              dense: true,
            ),
            KeyValue(
              'Port',
              stringValue(connection['port']),
              copy: true,
              dense: true,
            ),
            KeyValue(
              '用户名',
              stringValue(connection['username']),
              copy: true,
              dense: true,
            ),
            _secretValue(
              '$prefix-password',
              '密码',
              stringValue(connection['password']),
            ),
            _secretValue(
              '$prefix-uri',
              '连接串',
              stringValue(connection['connectionString']),
            ),
            if (stringValue(connection['endpoint']).isNotEmpty)
              KeyValue(
                'Endpoint',
                stringValue(connection['endpoint']),
                copy: true,
                dense: true,
              ),
            const Divider(height: 18),
            _secretValue(
              '$prefix-env',
              'DATABASE_URL',
              stringValue(connection['connectionString']),
            ),
          ],
        ),
      ),
    );
  }

  Widget _secretValue(String id, String label, String value) {
    final visible = revealed.contains(id);
    final display = visible ? value : (value.isEmpty ? '-' : '•' * 16);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          SizedBox(
            width: 128,
            child: Text(label, style: Theme.of(context).textTheme.bodySmall),
          ),
          Expanded(
            child: SelectableText(
              display,
              style: const TextStyle(fontFamily: 'monospace'),
            ),
          ),
          IconButton(
            tooltip: visible ? '收起' : '显示',
            visualDensity: VisualDensity.compact,
            onPressed: value.isEmpty
                ? null
                : () => setState(
                    () => visible ? revealed.remove(id) : revealed.add(id),
                  ),
            icon: Icon(
              visible
                  ? Icons.visibility_off_outlined
                  : Icons.visibility_outlined,
              size: 17,
            ),
          ),
          IconButton(
            tooltip: '复制',
            visualDensity: VisualDensity.compact,
            onPressed: value.isEmpty
                ? null
                : () => AppScope.of(
                    context,
                    listen: false,
                  ).invoke('copyText', [value]),
            icon: const Icon(Icons.content_copy, size: 16),
          ),
        ],
      ),
    );
  }

  Widget _schemaSection() {
    final data = schema;
    if (data == null) {
      return const SizedBox(height: 80, child: BrandLoading());
    }
    if (!boolValue(data['supported'])) {
      final reason = switch (stringValue(data['reason'])) {
        'not-running' => '数据库尚未运行，暂时无法读取结构。',
        'unsupported' => '当前引擎暂不支持结构读取。',
        _ => '数据库结构读取失败。',
      };
      return SizedBox(
        height: 80,
        child: EmptyState(icon: Icons.schema_outlined, title: reason),
      );
    }
    final databases = jsonList(data['databases']);
    return Card(
      child: databases.isEmpty
          ? const SizedBox(
              height: 80,
              child: EmptyState(icon: Icons.schema_outlined, title: '暂无逻辑库'),
            )
          : Column(
              children: [
                for (final database in databases)
                  ExpansionTile(
                    dense: true,
                    visualDensity: VisualDensity.compact,
                    leading: const Icon(Icons.schema_outlined),
                    title: Text(stringValue(database['name'])),
                    children: [
                      for (final table in listValue(database['tables']))
                        ListTile(
                          dense: true,
                          visualDensity: VisualDensity.compact,
                          contentPadding: const EdgeInsets.only(
                            left: 58,
                            right: 18,
                          ),
                          leading: const Icon(
                            Icons.table_rows_outlined,
                            size: 17,
                          ),
                          title: Text(stringValue(table)),
                        ),
                    ],
                  ),
              ],
            ),
    );
  }
}
