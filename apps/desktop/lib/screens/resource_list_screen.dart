import 'package:flutter/material.dart';

import '../core/app_controller.dart';
import '../core/json.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import '../widgets/create_bucket_dialog.dart';

enum ResourceType { projects, apps, databases, storage }

class ResourceListScreen extends StatefulWidget {
  const ResourceListScreen({required this.type, super.key});

  final ResourceType type;

  @override
  State<ResourceListScreen> createState() => _ResourceListScreenState();
}

class _ResourceListScreenState extends State<ResourceListScreen> {
  final selected = <String>{};
  final search = TextEditingController();
  bool busy = false;

  Future<void> _createBucket() async {
    if (busy) return;
    final controller = AppScope.of(context, listen: false);
    setState(() => busy = true);
    try {
      final created = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (_) => CreateBucketDialog(
          create: (name, policy) async {
            await controller.invoke('createStorageBucket', [name, policy]);
          },
        ),
      );
      if (created != true || !mounted) return;
      search.clear();
      selected.clear();
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Bucket 已创建，存储服务正在准备中')));
      await controller.refreshResources(silent: true);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _credentials() async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final data = jsonMap(
        await AppScope.of(
          context,
          listen: false,
        ).invoke('getWorkspaceStorageCredentials'),
      );
      if (!mounted) return;

      await showDialog<void>(
        context: context,
        builder: (dialog) => AlertDialog(
          title: const Text('工作空间 OSS 访问密钥'),
          content: SizedBox(
            width: 560,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final entry in {
                  'Access Key': 'accessKey',
                  'Secret Key': 'secretKey',
                  'URL': 'url',
                }.entries)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(entry.key),
                        const SizedBox(height: 4),
                        SelectableText(stringValue(data[entry.value])),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialog),
              child: const Text('关闭'),
            ),
          ],
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = AppScope.of(context);
    final snapshot = controller.snapshot;
    if (snapshot == null) return const BrandLoading();
    final items = _items(snapshot).where((item) {
      final query = search.text.trim().toLowerCase();
      return query.isEmpty || _title(item).toLowerCase().contains(query);
    }).toList();
    selected.removeWhere((name) => !items.any((item) => item['name'] == name));
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 10),
          child: Row(
            children: [
              Text(_label, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(width: 16),
              SizedBox(
                width: 260,
                child: TextField(
                  controller: search,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.search, size: 19),
                    hintText: '搜索',
                  ),
                ),
              ),
              const Spacer(),
              Text(
                '${items.length} 项',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(width: 6),
              if (widget.type == ResourceType.storage)
                TextButton.icon(
                  onPressed: busy ? null : _credentials,
                  icon: const Icon(Icons.key_outlined, size: 19),
                  label: const Text('获取密钥'),
                ),
              if (widget.type == ResourceType.storage) ...[
                const SizedBox(width: 8),
                FilledButton.icon(
                  onPressed: busy ? null : _createBucket,
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('新建 Bucket'),
                ),
              ],
            ],
          ),
        ),
        if (selected.isNotEmpty) _bulkBar(controller, items),
        Expanded(
          child: items.isEmpty
              ? EmptyState(icon: _icon, title: '暂无$_label')
              : Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 1100),
                    child: ListView.separated(
                      padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
                      itemCount: items.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 7),
                      itemBuilder: (context, index) =>
                          _card(controller, snapshot, items[index]),
                    ),
                  ),
                ),
        ),
      ],
    );
  }

  Widget _card(AppController controller, JsonMap snapshot, JsonMap item) {
    final name = stringValue(item['name']);
    final canSelect =
        widget.type == ResourceType.projects ||
        (widget.type == ResourceType.apps && boolValue(item['launchpad']));
    final status = _status(item, snapshot);
    final lines = switch (widget.type) {
      ResourceType.projects => [
        stringValue(item['template'], '自定义项目'),
        _projectCounts(name, snapshot),
      ],
      ResourceType.apps => [
        '${intValue(item['readyReplicas'])}/${intValue(item['replicas'])} 副本',
        if (stringValue(item['project']).isNotEmpty) '项目 ${item['project']}',
      ],
      ResourceType.databases => [
        [
          stringValue(item['engine']),
          stringValue(item['version']),
        ].where((part) => part.isNotEmpty).join(' '),
        if (stringValue(item['project']).isNotEmpty) '项目 ${item['project']}',
      ],
      ResourceType.storage => [
        stringValue(item['policy'], '私有'),
        if (stringValue(item['project']).isNotEmpty) '项目 ${item['project']}',
      ],
    };
    final menu = _menu(controller, snapshot, item);
    return ResourceCard(
      title: _title(item),
      subtitle: _title(item) == name ? null : name,
      icon: _icon,
      status: status,
      lines: lines,
      onTap: switch (widget.type) {
        ResourceType.projects => () => controller.openDetail(
          DetailRoute('project', name),
        ),
        ResourceType.apps => () => controller.openDetail(
          DetailRoute('app', name, kind: stringValue(item['kind'])),
        ),
        ResourceType.databases => () => controller.openDetail(
          DetailRoute('database', name),
        ),
        ResourceType.storage => () => controller.openDetail(
          DetailRoute('storage', name),
        ),
      },
      trailing: canSelect || menu != null
          ? Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (canSelect)
                  Checkbox(
                    value: selected.contains(name),
                    onChanged: busy
                        ? null
                        : (_) => setState(
                            () => selected.contains(name)
                                ? selected.remove(name)
                                : selected.add(name),
                          ),
                    visualDensity: VisualDensity.compact,
                  ),
                ?menu,
              ],
            )
          : null,
    );
  }

  Future<void> _setPolicy(
    AppController controller,
    JsonMap item,
    String policy,
  ) async {
    final name = stringValue(item['name']);
    final isPublic = policy == 'publicRead';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: Text(isPublic ? 'Set public' : 'Set private'),
        content: Text(
          isPublic
              ? '将 $name 设置为公开只读，任何持有文件 URL 的人都可读取文件。写入仍需要密钥。'
              : '将 $name 设置为私有，匿名访问将被禁止。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialog, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialog, true),
            child: const Text('确认'),
          ),
        ],
      ),
    );
    if (!mounted || confirmed != true) return;
    setState(() => busy = true);
    try {
      await controller.invoke('setStoragePolicy', [name, policy]);
      await controller.refreshResources();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('访问策略已提交，正在同步生效')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget? _menu(AppController controller, JsonMap snapshot, JsonMap item) {
    if (widget.type == ResourceType.storage) {
      return PopupMenuButton<String>(
        tooltip: '访问权限',
        enabled: !busy,
        icon: const Icon(Icons.more_horiz, size: 19),
        onSelected: (policy) => _setPolicy(controller, item, policy),
        itemBuilder: (_) => [
          PopupMenuItem(
            value: 'publicRead',
            enabled: item['policy'] != 'publicRead',
            child: const Text('Set public'),
          ),
          PopupMenuItem(
            value: 'private',
            enabled: item['policy'] != 'private',
            child: const Text('Set private'),
          ),
        ],
      );
    }
    if (widget.type == ResourceType.databases) {
      return null;
    }
    if (widget.type == ResourceType.apps && !boolValue(item['launchpad'])) {
      return null;
    }
    final paused = _status(item, snapshot) == 'Stopped';
    return PopupMenuButton<String>(
      tooltip: '更多操作',
      enabled: !busy,
      icon: const Icon(Icons.more_horiz, size: 19),
      onSelected: (action) => _singleAction(controller, snapshot, item, action),
      itemBuilder: (context) => [
        PopupMenuItem(
          value: paused ? 'start' : 'pause',
          child: Text(paused ? '启动' : '暂停'),
        ),
        const PopupMenuItem(value: 'restart', child: Text('重启')),
        const PopupMenuDivider(),
        PopupMenuItem(
          value: 'delete',
          child: Text('删除', style: TextStyle(color: context.helios.red)),
        ),
      ],
    );
  }

  Widget _bulkBar(AppController controller, List<JsonMap> items) {
    final colors = context.helios;
    final selectable = items
        .where(
          (item) =>
              widget.type == ResourceType.projects ||
              boolValue(item['launchpad']),
        )
        .toList();
    final selectedItems = selectable
        .where((item) => selected.contains(item['name']))
        .toList();
    final hasPaused = selectedItems.any(
      (item) => _status(item, controller.snapshot!) == 'Stopped',
    );
    final hasActive = selectedItems.any(
      (item) => _status(item, controller.snapshot!) != 'Stopped',
    );
    return Container(
      margin: const EdgeInsets.fromLTRB(20, 0, 20, 8),
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border.all(color: colors.line),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        children: [
          Checkbox(
            value: selected.length == selectable.length,
            tristate:
                selected.isNotEmpty && selected.length != selectable.length,
            onChanged: busy
                ? null
                : (_) => setState(() {
                    if (selected.length == selectable.length) {
                      selected.clear();
                    } else {
                      selected.addAll(
                        selectable.map((item) => stringValue(item['name'])),
                      );
                    }
                  }),
          ),
          Text('已选 ${selected.length} 项'),
          const Spacer(),
          if (hasActive)
            TextButton.icon(
              onPressed: busy
                  ? null
                  : () => _bulkAction(controller, selectedItems, 'pause'),
              icon: const Icon(Icons.pause, size: 17),
              label: const Text('暂停'),
            ),
          if (hasPaused)
            TextButton.icon(
              onPressed: busy
                  ? null
                  : () => _bulkAction(controller, selectedItems, 'start'),
              icon: const Icon(Icons.play_arrow, size: 17),
              label: const Text('启动'),
            ),
          TextButton.icon(
            onPressed: busy
                ? null
                : () => _bulkAction(controller, selectedItems, 'restart'),
            icon: const Icon(Icons.restart_alt, size: 17),
            label: const Text('重启'),
          ),
          TextButton.icon(
            onPressed: busy
                ? null
                : () => _bulkAction(controller, selectedItems, 'delete'),
            icon: Icon(Icons.delete_outline, size: 17, color: colors.red),
            label: Text('删除', style: TextStyle(color: colors.red)),
          ),
        ],
      ),
    );
  }

  Future<void> _singleAction(
    AppController controller,
    JsonMap snapshot,
    JsonMap item,
    String action,
  ) async {
    final name = stringValue(item['name']);
    if (action == 'delete') {
      final confirmed = await confirmAction(
        context,
        title: '删除${widget.type == ResourceType.projects ? '项目' : '应用'}',
        message: widget.type == ResourceType.projects
            ? '将删除「${_title(item)}」及名下所有应用、数据库和存储。此操作不可恢复。'
            : stringValue(item['project']).isEmpty
            ? '将删除应用「$name」。此操作不可恢复。'
            : '该应用属于项目 ${item['project']}。只删除这个应用，其它资源保留。',
        confirmLabel: widget.type == ResourceType.projects ? '删除项目' : '删除应用',
        destructive: true,
      );
      if (!confirmed) return;
    }
    await _run(() => controller.operate(_method(action), name));
  }

  Future<void> _bulkAction(
    AppController controller,
    List<JsonMap> items,
    String action,
  ) async {
    var targets = items;
    if (action == 'pause') {
      targets = items
          .where((item) => _status(item, controller.snapshot!) != 'Stopped')
          .toList();
    }
    if (action == 'start') {
      targets = items
          .where((item) => _status(item, controller.snapshot!) == 'Stopped')
          .toList();
    }
    if (action == 'delete') {
      final projectDelete = widget.type == ResourceType.projects;
      final targetNames = targets
          .map((item) => stringValue(item['name']))
          .toSet();
      final snapshot = controller.snapshot!;
      final projectLabels = targets
          .map((item) => _title(item))
          .take(5)
          .join('、');
      final extraProjects = targets.length > 5
          ? ' 等 ${targets.length} 个项目'
          : '';
      final appCount = jsonList(snapshot['apps'])
          .where((item) => targetNames.contains(item['project']))
          .length;
      final databaseCount = jsonList(snapshot['databases'])
          .where((item) => targetNames.contains(item['project']))
          .length;
      final bucketCount = jsonList(snapshot['buckets'])
          .where((item) => targetNames.contains(item['project']))
          .length;
      final inProject = targets
          .where((item) => stringValue(item['project']).isNotEmpty)
          .length;
      final confirmed = await confirmAction(
        context,
        title: '批量删除',
        message: projectDelete
            ? '将删除 $projectLabels$extraProjects，并合计带走 $appCount 个应用、$databaseCount 个数据库和 $bucketCount 个存储桶。此操作不可恢复。'
            : '将删除 ${targets.length} 个应用。${inProject > 0 ? '其中 $inProject 个属于项目，只删除应用，不删除项目中的其它资源。' : ''}此操作不可恢复。',
        confirmLabel: '删除 ${targets.length} 个${projectDelete ? '项目' : '应用'}',
        destructive: true,
      );
      if (!confirmed) return;
    }
    final failed = <String>{};
    await _run(() async {
      for (final item in targets) {
        try {
          await controller.invoke(_method(action), [item['name']]);
        } catch (_) {
          failed.add(stringValue(item['name']));
        }
      }
      await controller.refreshResources(silent: true);
    });
    if (mounted) {
      setState(() {
        selected
          ..clear()
          ..addAll(failed);
      });
    }
  }

  Future<void> _run(Future<void> Function() task) async {
    setState(() => busy = true);
    try {
      await task();
    } catch (_) {
      // AppController 已把业务错误展示在全局错误横幅中。
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  String _method(String action) {
    final noun = widget.type == ResourceType.projects ? 'Project' : 'App';
    return '$action$noun';
  }

  List<JsonMap> _items(JsonMap snapshot) => switch (widget.type) {
    ResourceType.projects => jsonList(snapshot['projects']),
    ResourceType.apps => jsonList(snapshot['apps']),
    ResourceType.databases => jsonList(snapshot['databases']),
    ResourceType.storage => jsonList(snapshot['buckets']),
  };

  String _title(JsonMap item) =>
      stringValue(item['displayName'], stringValue(item['name']));

  String _status(JsonMap item, JsonMap snapshot) {
    if (widget.type == ResourceType.projects) {
      final name = item['name'];
      final statuses = <String>[
        ...jsonList(snapshot['apps'])
            .where((app) => app['project'] == name)
            .map((app) => stringValue(app['status'])),
        ...jsonList(snapshot['databases'])
            .where((db) => db['project'] == name)
            .map((db) => _databaseStatus(stringValue(db['phase']))),
      ];
      if (statuses.contains('Failed')) return 'Failed';
      if (statuses.contains('Progressing')) return 'Progressing';
      if (statuses.contains('Running')) return 'Running';
      return statuses.isEmpty ? 'Stopped' : 'Stopped';
    }
    if (widget.type == ResourceType.databases) {
      return _databaseStatus(stringValue(item['phase']));
    }
    if (widget.type == ResourceType.storage) {
      return stringValue(item['policy'], 'private');
    }
    return stringValue(item['status'], 'Stopped');
  }

  String _databaseStatus(String phase) => switch (phase) {
    'Running' => 'Running',
    'Stopped' => 'Stopped',
    'Failed' || 'Abnormal' => 'Failed',
    _ => 'Progressing',
  };

  String _projectCounts(String name, JsonMap snapshot) {
    final apps = jsonList(snapshot['apps'])
        .where((item) => item['project'] == name)
        .length;
    final databases = jsonList(snapshot['databases'])
        .where((item) => item['project'] == name)
        .length;
    final buckets = jsonList(snapshot['buckets'])
        .where((item) => item['project'] == name)
        .length;
    return '$apps 应用  $databases 数据库  $buckets 文件存储';
  }

  IconData get _icon => switch (widget.type) {
    ResourceType.projects => Icons.layers_outlined,
    ResourceType.apps => Icons.grid_view_outlined,
    ResourceType.databases => Icons.storage_outlined,
    ResourceType.storage => Icons.inventory_2_outlined,
  };

  String get _label => switch (widget.type) {
    ResourceType.projects => '项目',
    ResourceType.apps => '应用',
    ResourceType.databases => '数据库',
    ResourceType.storage => '文件存储',
  };
}
