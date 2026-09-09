import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/app_controller.dart';
import '../core/json.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

class ProjectDetailScreen extends StatefulWidget {
  const ProjectDetailScreen({required this.name, super.key});

  final String name;

  @override
  State<ProjectDetailScreen> createState() => _ProjectDetailScreenState();
}

class _ProjectDetailScreenState extends State<ProjectDetailScreen> {
  JsonMap? detail;
  String? error;
  bool busy = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (detail == null && error == null) _load();
  }

  Future<void> _load() async {
    try {
      final result = await AppScope.of(
        context,
        listen: false,
      ).invoke('getProjectDetail', [widget.name]);
      if (mounted) {
        setState(() {
          detail = jsonMap(result);
          error = null;
        });
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
      ).operate('${action}Project', widget.name);
      if (action != 'delete') await _load();
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _delete() async {
    final data = detail!;
    final confirmed = await confirmAction(
      context,
      title: '删除项目',
      message:
          '将删除「${stringValue(data['displayName'], widget.name)}」（${widget.name}），并带走 ${jsonList(data['apps']).length} 个服务、${jsonList(data['databases']).length} 个数据库和 ${jsonList(data['buckets']).length} 个对象存储。此操作不可恢复。',
      confirmLabel: '删除项目',
      destructive: true,
    );
    if (!confirmed) return;
    await _operate('delete');
    if (mounted) AppScope.of(context, listen: false).closeDetail();
  }

  Future<void> _startConversation() async {
    final data = detail;
    if (data == null) return;
    final apps = jsonList(data['apps']);
    final databases = jsonList(data['databases']);
    final buckets = jsonList(data['buckets']);
    final links = jsonList(data['links']);
    final urls = <String>[];
    for (final app in apps) {
      for (final url in listValue(app['urls'])) {
        final value = stringValue(url);
        if (value.isNotEmpty) urls.add('$value -> ${app['name']}');
      }
    }
    String resources(List<JsonMap> items, String Function(JsonMap) describe) =>
        items.isEmpty ? '无' : items.map(describe).join('；');
    final contextText = [
      '名称=${stringValue(data['displayName'], widget.name)}',
      if (urls.isNotEmpty) '入口=${urls.join('，')}',
      '服务=${resources(apps, (item) => '${item['name']}(${item['kind']}/${item['status']}/${item['readyReplicas']}-${item['replicas']})')}',
      '数据库=${resources(databases, (item) => '${item['name']}(${stringValue(item['engine'], '未知')}/${item['phase']})')}',
      if (buckets.isNotEmpty)
        '存储=${resources(buckets, (item) => '${item['name']}(${stringValue(item['policy'], '未知')})')}',
      if (links.isNotEmpty)
        '依赖=${resources(links, (item) => '${item['app']}->${item['target']}')}',
    ].join('；');
    setState(() => busy = true);
    try {
      final conversation = jsonMap(
        await AppScope.of(
          context,
          listen: false,
        ).invoke('getOrCreateProjectChat', [widget.name, contextText]),
      );
      if (!mounted) return;
      AppScope.of(
        context,
        listen: false,
      ).openChatWithDraft(stringValue(conversation['id']), '');
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  void _openApp(JsonMap item) {
    AppScope.of(context, listen: false).openDetail(
      DetailRoute(
        'app',
        stringValue(item['name']),
        kind: stringValue(item['kind']),
      ),
    );
  }

  void _openDatabase(JsonMap item) {
    AppScope.of(
      context,
      listen: false,
    ).openDetail(DetailRoute('database', stringValue(item['name'])));
  }

  Future<void> _showNetworkDetails(JsonMap item) async {
    final url = stringValue(item['url']);
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Row(
          children: [
            const Icon(Icons.language_outlined, size: 20),
            const SizedBox(width: 9),
            Expanded(
              child: Text(
                stringValue(item['host'], '网络入口'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        content: SizedBox(
          width: 430,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              KeyValue('地址', url, copy: true),
              KeyValue('连接服务', stringValue(item['app'])),
              KeyValue('连通状态', stringValue(item['healthLabel'])),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('关闭'),
          ),
          if (url.isNotEmpty)
            FilledButton.icon(
              onPressed: () {
                Navigator.pop(dialogContext);
                unawaited(
                  AppScope.of(
                    context,
                    listen: false,
                  ).invoke('openExternal', [url]),
                );
              },
              icon: const Icon(Icons.open_in_new, size: 17),
              label: const Text('打开'),
            ),
        ],
      ),
    );
  }

  Future<void> _showBucketDetails(JsonMap item) async {
    final links = jsonList(detail?['links'])
        .where(
          (link) =>
              link['targetKind'] == 'bucket' && link['target'] == item['name'],
        )
        .map((link) => stringValue(link['app']))
        .where((name) => name.isNotEmpty)
        .toList();
    await _showResourceDetails(
      icon: Icons.inventory_2_outlined,
      title: stringValue(item['name']),
      values: [
        ('Bucket', stringValue(item['bucketName'], stringValue(item['name']))),
        ('访问策略', _bucketPolicy(stringValue(item['policy']))),
        ('创建时间', displayDate(item['createdAt'])),
        ('连接服务', links.isEmpty ? '暂无已确认连接' : links.join('、')),
      ],
    );
  }

  Future<void> _showCronJobDetails(JsonMap item) => _showResourceDetails(
    icon: Icons.schedule_outlined,
    title: stringValue(item['name']),
    values: [
      ('调度', stringValue(item['schedule'])),
      ('状态', boolValue(item['suspended']) ? '已暂停' : '运行中'),
      ('最近执行', displayDate(item['lastScheduleAt'])),
    ],
  );

  Future<void> _showOtherDetails(JsonMap item) => _showResourceDetails(
    icon: _otherIcon(stringValue(item['kind'])),
    title: stringValue(item['name']),
    values: [
      ('类型', stringValue(item['kind'])),
      if (stringValue(item['note']).isNotEmpty)
        ('说明', stringValue(item['note'])),
    ],
  );

  Future<void> _showResourceDetails({
    required IconData icon,
    required String title,
    required List<(String, String)> values,
  }) => showDialog<void>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Row(
        children: [
          Icon(icon, size: 20),
          const SizedBox(width: 9),
          Expanded(
            child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
        ],
      ),
      content: SizedBox(
        width: 430,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [for (final value in values) KeyValue(value.$1, value.$2)],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext),
          child: const Text('关闭'),
        ),
      ],
    ),
  );

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
    final apps = jsonList(data['apps']);
    final managedApps = apps
        .where((item) => boolValue(item['launchpad']))
        .toList();
    final databases = jsonList(data['databases']);
    final buckets = jsonList(data['buckets']);
    final cronjobs = jsonList(data['cronjobs']);
    final others = jsonList(data['others']);
    final controllableStatuses = <String>[
      ...managedApps.map((item) => stringValue(item['status'])),
      ...databases.map((item) => _databaseStatus(stringValue(item['phase']))),
    ];
    final canOperate = controllableStatuses.isNotEmpty;
    final allStopped =
        canOperate &&
        controllableStatuses.every((status) => status == 'Stopped');
    final hasTopologyResources =
        apps.isNotEmpty ||
        databases.isNotEmpty ||
        buckets.isNotEmpty ||
        cronjobs.isNotEmpty;

    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 18, 24, 32),
      children: [
        if (error != null) ...[
          ErrorBanner(
            message: error!,
            onClose: () => setState(() => error = null),
          ),
          const SizedBox(height: 14),
        ],
        LayoutBuilder(
          builder: (context, constraints) => _projectHeader(
            data,
            compact: constraints.maxWidth < 760,
            canOperate: canOperate,
            allStopped: allStopped,
          ),
        ),
        const SizedBox(height: 28),
        Row(
          children: [
            Expanded(
              child: Text(
                '资源拓扑',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            _HealthLegend(health: _Health.healthy),
            const SizedBox(width: 13),
            _HealthLegend(health: _Health.warning),
            const SizedBox(width: 13),
            _HealthLegend(health: _Health.error),
            const SizedBox(width: 13),
            _HealthLegend(health: _Health.paused),
          ],
        ),
        const SizedBox(height: 10),
        if (!hasTopologyResources)
          const SizedBox(
            height: 180,
            child: EmptyState(
              icon: Icons.account_tree_outlined,
              title: '项目中暂无资源',
            ),
          )
        else
          ProjectTopology(
            apps: apps,
            databases: databases,
            buckets: buckets,
            cronjobs: cronjobs,
            links: jsonList(data['links']),
            onOpenApp: _openApp,
            onOpenDatabase: _openDatabase,
            onOpenNetwork: _showNetworkDetails,
            onOpenBucket: _showBucketDetails,
            onOpenCronJob: _showCronJobDetails,
          ),
        if (others.isNotEmpty) ...[
          const SizedBox(height: 14),
          _SupportingResources(items: others, onOpen: _showOtherDetails),
        ],
      ],
    );
  }

  Widget _projectHeader(
    JsonMap data, {
    required bool compact,
    required bool canOperate,
    required bool allStopped,
  }) {
    final information = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          stringValue(data['displayName'], widget.name),
          style: Theme.of(context).textTheme.headlineLarge,
        ),
        const SizedBox(height: 6),
        Text(
          '创建于 ${displayDate(data['createdAt'])}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        if (stringValue(data['description']).isNotEmpty) ...[
          const SizedBox(height: 11),
          Text(
            stringValue(data['description']),
            style: Theme.of(context).textTheme.bodyMedium
                ?.copyWith(color: context.helios.muted),
          ),
        ],
      ],
    );
    final actions = Wrap(
      spacing: 8,
      runSpacing: 8,
      alignment: WrapAlignment.end,
      children: [
        FilledButton.icon(
          onPressed: busy ? null : () => unawaited(_startConversation()),
          icon: const Icon(Icons.auto_awesome_outlined, size: 17),
          label: const Text('对话维护'),
        ),
        if (canOperate)
          OutlinedButton.icon(
            onPressed: busy
                ? null
                : () => _operate(allStopped ? 'start' : 'pause'),
            icon: Icon(allStopped ? Icons.play_arrow : Icons.pause, size: 17),
            label: Text(allStopped ? '恢复项目' : '暂停项目'),
          ),
        IconButton(
          tooltip: '删除项目',
          onPressed: busy ? null : _delete,
          icon: Icon(Icons.delete_outline, color: context.helios.red),
        ),
        IconButton(
          tooltip: '刷新拓扑',
          onPressed: busy ? null : _load,
          icon: const Icon(Icons.refresh, size: 19),
        ),
      ],
    );
    if (compact) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          information,
          const SizedBox(height: 14),
          Align(alignment: Alignment.centerLeft, child: actions),
        ],
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: information),
        const SizedBox(width: 20),
        actions,
      ],
    );
  }
}

class ProjectTopology extends StatefulWidget {
  const ProjectTopology({
    required this.apps,
    required this.databases,
    required this.buckets,
    required this.cronjobs,
    required this.links,
    required this.onOpenApp,
    required this.onOpenDatabase,
    required this.onOpenNetwork,
    required this.onOpenBucket,
    required this.onOpenCronJob,
    super.key,
  });

  final List<JsonMap> apps;
  final List<JsonMap> databases;
  final List<JsonMap> buckets;
  final List<JsonMap> cronjobs;
  final List<JsonMap> links;
  final ValueChanged<JsonMap> onOpenApp;
  final ValueChanged<JsonMap> onOpenDatabase;
  final ValueChanged<JsonMap> onOpenNetwork;
  final ValueChanged<JsonMap> onOpenBucket;
  final ValueChanged<JsonMap> onOpenCronJob;

  @override
  State<ProjectTopology> createState() => _ProjectTopologyState();
}

class _ProjectTopologyState extends State<ProjectTopology> {
  String? hoveredId;

  @override
  Widget build(BuildContext context) {
    final networkNodes = <_TopologyNode>[];
    final serviceNodes = <_TopologyNode>[];
    final dataNodes = <_TopologyNode>[];
    final edges = <_TopologyEdge>[];

    for (final app in widget.apps) {
      final name = stringValue(app['name']);
      final health = _appHealth(app);
      final serviceId = 'service:$name';
      serviceNodes.add(
        _TopologyNode(
          id: serviceId,
          type: _NodeType.service,
          title: name,
          subtitle:
              '容器 · ${stringValue(app['kind'])} · ${intValue(app['readyReplicas'])}/${intValue(app['replicas'])}',
          health: health,
          item: app,
          pressure: _pressureLabel(jsonMap(app['usage'])),
        ),
      );
      for (final rawUrl in listValue(app['urls'])) {
        final url = stringValue(rawUrl);
        if (url.isEmpty) continue;
        final uri = Uri.tryParse(url);
        final networkId = 'network:$name:$url';
        final networkHealth = switch (health) {
          _Health.healthy => _Health.healthy,
          _Health.warning => _Health.warning,
          _Health.paused || _Health.error => _Health.error,
          _ => _Health.unknown,
        };
        final networkItem = <String, Object?>{
          'url': url,
          'host': uri?.host ?? url,
          'app': name,
          'healthLabel': _healthLabel(networkHealth, _NodeType.network),
        };
        networkNodes.add(
          _TopologyNode(
            id: networkId,
            type: _NodeType.network,
            title: uri?.host ?? url,
            subtitle: '${uri?.scheme.toUpperCase() ?? '网络'} · $name',
            health: networkHealth,
            item: networkItem,
          ),
        );
        edges.add(_TopologyEdge(networkId, serviceId, '入口'));
      }
    }

    for (final cronjob in widget.cronjobs) {
      final name = stringValue(cronjob['name']);
      serviceNodes.add(
        _TopologyNode(
          id: 'cronjob:$name',
          type: _NodeType.cronjob,
          title: name,
          subtitle: '定时任务 · ${stringValue(cronjob['schedule'])}',
          health: boolValue(cronjob['suspended'])
              ? _Health.paused
              : _Health.healthy,
          item: cronjob,
        ),
      );
    }

    for (final database in widget.databases) {
      final name = stringValue(database['name']);
      dataNodes.add(
        _TopologyNode(
          id: 'database:$name',
          type: _NodeType.database,
          title: name,
          subtitle:
              '${stringValue(database['engine'], '数据库')} ${stringValue(database['version'])}',
          health: _databaseHealth(database),
          item: database,
          pressure: _pressureLabel(jsonMap(database['usage'])),
        ),
      );
    }
    for (final bucket in widget.buckets) {
      final name = stringValue(bucket['name']);
      dataNodes.add(
        _TopologyNode(
          id: 'bucket:$name',
          type: _NodeType.bucket,
          title: name,
          subtitle: '对象存储 · ${_bucketPolicy(stringValue(bucket['policy']))}',
          health: stringValue(bucket['bucketName']).isEmpty
              ? _Health.warning
              : _Health.healthy,
          item: bucket,
        ),
      );
    }

    final nodeIds = {
      for (final node in [...serviceNodes, ...dataNodes]) node.id,
    };
    for (final link in widget.links) {
      final from = 'service:${stringValue(link['app'])}';
      final kind = stringValue(link['targetKind']);
      final target = '$kind:${stringValue(link['target'])}';
      if (!nodeIds.contains(from) || !nodeIds.contains(target)) continue;
      edges.add(
        _TopologyEdge(from, target, switch (kind) {
          'service' => '调用',
          'bucket' => 'S3',
          _ => '连接',
        }),
      );
    }

    final layers = [
      _TopologyLayer('网络接入层', 'Ingress', networkNodes),
      _TopologyLayer('服务层', 'Workloads', serviceNodes),
      _TopologyLayer('数据层', 'Data', dataNodes),
    ];
    final related = _relatedNodes(edges, hoveredId);

    return LayoutBuilder(
      builder: (context, constraints) {
        final geometry = _TopologyGeometry.calculate(
          constraints.maxWidth,
          layers,
        );
        return SizedBox(
          height: geometry.height,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Positioned.fill(
                child: CustomPaint(
                  painter: _TopologyPainter(
                    bands: geometry.bands,
                    nodes: geometry.nodes,
                    edges: edges,
                    hoveredId: hoveredId,
                    palette: context.helios,
                  ),
                ),
              ),
              for (var i = 0; i < layers.length; i++)
                Positioned(
                  left: 14,
                  top: geometry.bands[i].top + 17,
                  width: _TopologyGeometry.labelWidth - 26,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        layers[i].title,
                        style: Theme.of(context).textTheme.labelLarge,
                      ),
                      const SizedBox(height: 3),
                      Text(
                        layers[i].nodes.isEmpty ? '暂无资源' : layers[i].subtitle,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              for (final layer in layers)
                for (final node in layer.nodes)
                  Positioned.fromRect(
                    rect: geometry.nodes[node.id]!,
                    child: _TopologyNodeView(
                      node: node,
                      dimmed: hoveredId != null && !related.contains(node.id),
                      onEnter: () => setState(() => hoveredId = node.id),
                      onExit: () {
                        if (hoveredId == node.id) {
                          setState(() => hoveredId = null);
                        }
                      },
                      onTap: () => _openNode(node),
                    ),
                  ),
            ],
          ),
        );
      },
    );
  }

  void _openNode(_TopologyNode node) {
    switch (node.type) {
      case _NodeType.network:
        widget.onOpenNetwork(node.item);
      case _NodeType.service:
        widget.onOpenApp(node.item);
      case _NodeType.database:
        widget.onOpenDatabase(node.item);
      case _NodeType.bucket:
        widget.onOpenBucket(node.item);
      case _NodeType.cronjob:
        widget.onOpenCronJob(node.item);
    }
  }
}

class _TopologyNodeView extends StatelessWidget {
  const _TopologyNodeView({
    required this.node,
    required this.dimmed,
    required this.onEnter,
    required this.onExit,
    required this.onTap,
  });

  final _TopologyNode node;
  final bool dimmed;
  final VoidCallback onEnter;
  final VoidCallback onExit;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    final color = _healthColor(node.health, colors);
    return AnimatedOpacity(
      duration: const Duration(milliseconds: 140),
      opacity: dimmed ? 0.32 : 1,
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        onEnter: (_) => onEnter(),
        onExit: (_) => onExit(),
        child: Material(
          color: colors.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(6),
            side: BorderSide(color: color.withValues(alpha: 0.38)),
          ),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(6),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(11, 9, 10, 8),
              child: Row(
                children: [
                  Container(
                    width: 30,
                    height: 30,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: 0.09),
                      borderRadius: BorderRadius.circular(5),
                    ),
                    child: Icon(_nodeIcon(node.type), size: 17, color: color),
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          node.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.labelLarge,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          node.subtitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        const SizedBox(height: 3),
                        Row(
                          children: [
                            Container(
                              width: 6,
                              height: 6,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: color,
                              ),
                            ),
                            const SizedBox(width: 5),
                            Expanded(
                              child: Text(
                                node.pressure ??
                                    _healthLabel(node.health, node.type),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context).textTheme.bodySmall
                                    ?.copyWith(color: color),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  Icon(Icons.chevron_right, size: 16, color: colors.subtle),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SupportingResources extends StatelessWidget {
  const _SupportingResources({required this.items, required this.onOpen});

  final List<JsonMap> items;
  final ValueChanged<JsonMap> onOpen;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: context.helios.line)),
      ),
      child: ExpansionTile(
        tilePadding: EdgeInsets.zero,
        childrenPadding: const EdgeInsets.only(bottom: 6),
        title: Text(
          '配套资源 ${items.length}',
          style: Theme.of(context).textTheme.labelLarge,
        ),
        subtitle: const Text('配置、凭证、服务账号和 Kubernetes 配套对象'),
        children: [
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: [
              for (final item in items)
                ActionChip(
                  avatar: Icon(_otherIcon(stringValue(item['kind'])), size: 15),
                  label: Text(
                    '${stringValue(item['kind'])} · ${stringValue(item['name'])}',
                  ),
                  onPressed: () => onOpen(item),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _HealthLegend extends StatelessWidget {
  const _HealthLegend({required this.health});

  final _Health health;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 6,
          height: 6,
          decoration: BoxDecoration(
            color: _healthColor(health, context.helios),
            shape: BoxShape.circle,
          ),
        ),
        const SizedBox(width: 5),
        Text(switch (health) {
          _Health.healthy => '正常',
          _Health.warning => 'Warning',
          _Health.error => 'Error',
          _Health.paused => '已暂停',
          _ => '未知',
        }, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

enum _NodeType { network, service, database, bucket, cronjob }

enum _Health { healthy, warning, error, paused, unknown }

class _TopologyNode {
  const _TopologyNode({
    required this.id,
    required this.type,
    required this.title,
    required this.subtitle,
    required this.health,
    required this.item,
    this.pressure,
  });

  final String id;
  final _NodeType type;
  final String title;
  final String subtitle;
  final _Health health;
  final JsonMap item;
  final String? pressure;
}

class _TopologyEdge {
  const _TopologyEdge(this.from, this.to, this.label);

  final String from;
  final String to;
  final String label;
}

class _TopologyLayer {
  const _TopologyLayer(this.title, this.subtitle, this.nodes);

  final String title;
  final String subtitle;
  final List<_TopologyNode> nodes;
}

class _TopologyGeometry {
  const _TopologyGeometry({
    required this.height,
    required this.bands,
    required this.nodes,
  });

  static const labelWidth = 112.0;
  static const nodeHeight = 78.0;
  static const gap = 12.0;
  static const bandGap = 16.0;

  final double height;
  final List<Rect> bands;
  final Map<String, Rect> nodes;

  static _TopologyGeometry calculate(
    double width,
    List<_TopologyLayer> layers,
  ) {
    final bands = <Rect>[];
    final nodes = <String, Rect>{};
    var top = 0.0;
    final contentWidth = math.max(120.0, width - labelWidth - 16);
    final columns = math.max(
      1,
      math.min(4, ((contentWidth + gap) / (168 + gap)).floor()),
    );
    final nodeWidth = math.min(
      214.0,
      (contentWidth - gap * (columns - 1)) / columns,
    );

    for (final layer in layers) {
      final rows = math.max(1, (layer.nodes.length / columns).ceil());
      final bandHeight = math.max(
        94.0,
        16 + rows * nodeHeight + math.max(0, rows - 1) * gap + 16,
      );
      bands.add(Rect.fromLTWH(0, top, width, bandHeight));
      for (var row = 0; row < rows; row++) {
        final rowStart = row * columns;
        final count = math.min(columns, layer.nodes.length - rowStart);
        if (count <= 0) continue;
        final used = count * nodeWidth + math.max(0, count - 1) * gap;
        final start = labelWidth + math.max(0, (contentWidth - used) / 2);
        for (var column = 0; column < count; column++) {
          final node = layer.nodes[rowStart + column];
          nodes[node.id] = Rect.fromLTWH(
            start + column * (nodeWidth + gap),
            top + 16 + row * (nodeHeight + gap),
            nodeWidth,
            nodeHeight,
          );
        }
      }
      top += bandHeight + bandGap;
    }
    return _TopologyGeometry(
      height: math.max(0, top - bandGap),
      bands: bands,
      nodes: nodes,
    );
  }
}

class _TopologyPainter extends CustomPainter {
  const _TopologyPainter({
    required this.bands,
    required this.nodes,
    required this.edges,
    required this.hoveredId,
    required this.palette,
  });

  final List<Rect> bands;
  final Map<String, Rect> nodes;
  final List<_TopologyEdge> edges;
  final String? hoveredId;
  final HeliosPalette palette;

  @override
  void paint(Canvas canvas, Size size) {
    final bandPaint = Paint()..color = palette.panel;
    final borderPaint = Paint()
      ..color = palette.line
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    for (final band in bands) {
      final shape = RRect.fromRectAndRadius(band, const Radius.circular(6));
      canvas.drawRRect(shape, bandPaint);
      canvas.drawRRect(shape, borderPaint);
      canvas.drawLine(
        Offset(_TopologyGeometry.labelWidth, band.top + 12),
        Offset(_TopologyGeometry.labelWidth, band.bottom - 12),
        borderPaint,
      );
    }

    for (final edge in edges) {
      final from = nodes[edge.from];
      final to = nodes[edge.to];
      if (from == null || to == null) continue;
      final active =
          hoveredId == null || hoveredId == edge.from || hoveredId == edge.to;
      final highlighted =
          hoveredId != null && (hoveredId == edge.from || hoveredId == edge.to);
      final color = highlighted
          ? palette.ink
          : active
          ? palette.lineStrong
          : palette.lineStrong.withValues(alpha: 0.18);
      final paint = Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = highlighted ? 2.2 : 1.35;
      final sameLayer = (from.top - to.top).abs() < 1;
      final start = sameLayer
          ? Offset(from.center.dx, from.top)
          : Offset(from.center.dx, from.bottom);
      final end = Offset(to.center.dx, to.top);
      final path = Path()..moveTo(start.dx, start.dy);
      if (sameLayer) {
        final routeY = math.max(2.0, math.min(from.top, to.top) - 9);
        path
          ..cubicTo(start.dx, routeY, start.dx, routeY, start.dx, routeY)
          ..lineTo(end.dx, routeY)
          ..cubicTo(end.dx, routeY, end.dx, routeY, end.dx, end.dy);
      } else {
        final middle = (start.dy + end.dy) / 2;
        path.cubicTo(start.dx, middle, end.dx, middle, end.dx, end.dy);
      }
      canvas.drawPath(path, paint);
      final arrow = Path()
        ..moveTo(end.dx - 4, end.dy - 6)
        ..lineTo(end.dx, end.dy)
        ..lineTo(end.dx + 4, end.dy - 6);
      canvas.drawPath(arrow, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _TopologyPainter oldDelegate) =>
      oldDelegate.hoveredId != hoveredId ||
      oldDelegate.edges != edges ||
      oldDelegate.nodes != nodes ||
      oldDelegate.palette != palette;
}

Set<String> _relatedNodes(List<_TopologyEdge> edges, String? hoveredId) {
  if (hoveredId == null) {
    return {
      for (final edge in edges) ...[edge.from, edge.to],
    };
  }
  final related = <String>{hoveredId};
  for (final edge in edges) {
    if (edge.from == hoveredId || edge.to == hoveredId) {
      related
        ..add(edge.from)
        ..add(edge.to);
    }
  }
  return related;
}

_Health _appHealth(JsonMap item) {
  final status = stringValue(item['status']);
  if (status == 'Failed') return _Health.error;
  if (status == 'Stopped') return _Health.paused;
  if (status == 'Progressing') return _Health.warning;
  if (intValue(item['replicas']) > 0 &&
      intValue(item['readyReplicas']) < intValue(item['replicas'])) {
    return _Health.warning;
  }
  if (_isPressured(jsonMap(item['usage']))) return _Health.warning;
  return status == 'Running' ? _Health.healthy : _Health.unknown;
}

_Health _databaseHealth(JsonMap item) {
  final status = _databaseStatus(stringValue(item['phase']));
  if (status == 'Failed') return _Health.error;
  if (status == 'Stopped') return _Health.paused;
  if (status == 'Progressing' || _isPressured(jsonMap(item['usage']))) {
    return _Health.warning;
  }
  return status == 'Running' ? _Health.healthy : _Health.unknown;
}

bool _isPressured(JsonMap usage) => [
  usage['cpuPercent'],
  usage['memoryPercent'],
  usage['storagePercent'],
].whereType<num>().any((value) => value >= 85);

String? _pressureLabel(JsonMap usage) {
  final values = <(String, num)>[
    if (usage['cpuPercent'] is num) ('CPU', usage['cpuPercent'] as num),
    if (usage['memoryPercent'] is num) ('内存', usage['memoryPercent'] as num),
    if (usage['storagePercent'] is num) ('存储', usage['storagePercent'] as num),
  ]..sort((a, b) => b.$2.compareTo(a.$2));
  if (values.isEmpty || values.first.$2 < 85) return null;
  return 'Warning · ${values.first.$1} ${values.first.$2.round()}%';
}

String _healthLabel(_Health health, _NodeType type) => switch ((health, type)) {
  (_Health.healthy, _NodeType.network) => '已连通',
  (_Health.error, _NodeType.network) => '不可用',
  (_Health.warning, _NodeType.network) => '连接不稳定',
  (_Health.healthy, _NodeType.cronjob) => '运行中',
  (_Health.paused, _NodeType.cronjob) => '已暂停',
  (_Health.healthy, _) => '运行中',
  (_Health.warning, _) => 'Warning',
  (_Health.error, _) => 'Error',
  (_Health.paused, _) => '已暂停',
  _ => '状态未知',
};

Color _healthColor(_Health health, HeliosPalette colors) => switch (health) {
  _Health.healthy => colors.green,
  _Health.warning => colors.amber,
  _Health.error => colors.red,
  _Health.paused => colors.muted,
  _Health.unknown => colors.subtle,
};

IconData _nodeIcon(_NodeType type) => switch (type) {
  _NodeType.network => Icons.language_outlined,
  _NodeType.service => Icons.dns_outlined,
  _NodeType.database => Icons.storage_outlined,
  _NodeType.bucket => Icons.inventory_2_outlined,
  _NodeType.cronjob => Icons.schedule_outlined,
};

IconData _otherIcon(String kind) => switch (kind) {
  'Secret' => Icons.key_outlined,
  'ConfigMap' => Icons.description_outlined,
  'Service' => Icons.hub_outlined,
  'PVC' => Icons.save_outlined,
  'Certificate' || 'Issuer' => Icons.verified_user_outlined,
  'ServiceAccount' ||
  'Role' ||
  'RoleBinding' => Icons.admin_panel_settings_outlined,
  'Job' => Icons.task_alt_outlined,
  _ => Icons.widgets_outlined,
};

String _bucketPolicy(String policy) => switch (policy) {
  'private' => '私有',
  'publicRead' => '公开读取',
  'publicReadwrite' => '公开读写',
  _ => policy.isEmpty ? '策略未知' : policy,
};

String _databaseStatus(String phase) => switch (phase) {
  'Running' => 'Running',
  'Stopped' => 'Stopped',
  'Failed' || 'Abnormal' => 'Failed',
  _ => 'Progressing',
};
