import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/auto_refresh.dart';
import '../core/json.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

class DatabaseDataScreen extends StatefulWidget {
  const DatabaseDataScreen({
    required this.instance,
    required this.database,
    required this.initialTable,
    required this.tables,
    this.project,
    super.key,
  });

  final String instance;
  final String database;
  final String initialTable;
  final List<String> tables;
  final String? project;

  @override
  State<DatabaseDataScreen> createState() => _DatabaseDataScreenState();
}

class _TableTab {
  _TableTab(this.name);
  final String name;
  JsonMap? data;
  JsonMap? filter;
  String? error;
  int page = 1;
  int revision = 0;
  bool loading = false;
}

class _DatabaseDataScreenState extends State<DatabaseDataScreen>
    with AutoRefresh<DatabaseDataScreen> {
  final tabs = <_TableTab>[];
  _TableTab? active;
  bool initialized = false;
  bool openingChat = false;
  String? chatError;

  @override
  bool get canAutoRefresh => active != null && !active!.loading && !openingChat;

  @override
  Future<void> refreshAutomatically() => _load(active!, silent: true);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!initialized) {
      initialized = true;
      _openTable(widget.initialTable);
    }
  }

  void _openTable(String name) {
    final tab =
        tabs.where((tab) => tab.name == name).firstOrNull ?? _TableTab(name);
    setState(() {
      if (!tabs.contains(tab)) tabs.add(tab);
      active = tab;
    });
    if (tab.data == null && !tab.loading) _load(tab);
  }

  void _closeTable(_TableTab tab) {
    final index = tabs.indexOf(tab);
    setState(() {
      tab.revision++;
      tabs.remove(tab);
      if (active == tab) {
        active = tabs.isEmpty ? null : tabs[math.min(index, tabs.length - 1)];
      }
    });
  }

  Future<void> _load(_TableTab tab, {bool silent = false}) async {
    final revision = ++tab.revision;
    setState(() {
      tab.loading = true;
      if (!silent) tab.error = null;
    });
    try {
      final data = jsonMap(
        await AppScope.of(context, listen: false).invoke(
          'getDatabaseTableData',
          [
            {
              'instance': widget.instance,
              'database': widget.database,
              'table': tab.name,
              'page': tab.page,
              'pageSize': 50,
              if (tab.filter != null) 'filter': tab.filter,
            },
          ],
        ),
      );
      if (!mounted || !tabs.contains(tab) || tab.revision != revision) return;
      final lastPage = math.max(1, (intValue(data['total']) / 50).ceil());
      if (tab.page > lastPage) {
        tab.page = lastPage;
        await _load(tab);
        return;
      }
      setState(() {
        tab.data = data;
        tab.error = null;
      });
    } catch (exception) {
      if (mounted && tabs.contains(tab) && tab.revision == revision) {
        setState(() => tab.error = exception.toString());
      }
    } finally {
      if (mounted && tabs.contains(tab) && tab.revision == revision) {
        setState(() => tab.loading = false);
      }
    }
  }

  Future<void> _ask() async {
    final tab = active;
    setState(() {
      openingChat = true;
      chatError = null;
    });
    try {
      await AppScope.of(context, listen: false).openResourceChat(
        projectName: widget.project,
        draft:
            '我想查询数据库中的数据：\n数据库实例：${widget.instance}\n数据库：${widget.database}'
            '${tab == null ? '' : '\n表或集合：${tab.name}'}'
            '${tab?.filter == null ? '' : '\n当前筛选：${tab!.filter}'}'
            '\n请使用当前工作空间的 Kubernetes 内网连接访问数据库，不开启公网。默认只读查询，不修改数据，不输出连接密码。\n我的问题是：',
      );
    } catch (exception) {
      if (mounted) setState(() => chatError = exception.toString());
    } finally {
      if (mounted) setState(() => openingChat = false);
    }
  }

  Future<void> _filter() async {
    final tab = active;
    if (tab == null) return;
    final columns = jsonList(tab.data?['columns']);
    if (columns.isEmpty) return;
    final result = await showDialog<JsonMap>(
      context: context,
      builder: (_) => _FilterDialog(columns: columns, filter: tab.filter),
    );
    if (result == null || !mounted || !tabs.contains(tab)) return;
    setState(() {
      tab.filter = result.isEmpty ? null : result;
      tab.page = 1;
    });
    await _load(tab);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    final tab = active;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: 48,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                IconButton(
                  tooltip: '返回数据库详情',
                  onPressed: AppScope.of(context, listen: false).closeDetail,
                  icon: const Icon(Icons.arrow_back, size: 18),
                ),
                const SizedBox(width: 4),
                SizedBox(
                  width: 156,
                  child: PopupMenuButton<String>(
                    tooltip: '选择数据表',
                    onSelected: _openTable,
                    itemBuilder: (_) => widget.tables
                        .map(
                          (name) => PopupMenuItem(
                            value: name,
                            child: Row(
                              children: [
                                const Icon(Icons.table_rows_outlined, size: 16),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    name,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        )
                        .toList(),
                    child: Row(
                      children: [
                        const Icon(Icons.storage_outlined, size: 17),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            widget.database,
                            style: const TextStyle(fontSize: 14),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const Icon(Icons.expand_more, size: 18),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(children: [for (final item in tabs) _tab(item)]),
                  ),
                ),
                const SizedBox(width: 12),
                FilledButton(
                  onPressed: openingChat ? null : _ask,
                  child: const Text('问数'),
                ),
                const SizedBox(width: 8),
                OutlinedButton.icon(
                  onPressed: tab?.data == null ? null : _filter,
                  icon: const Icon(Icons.filter_list, size: 17),
                  label: Text(tab?.filter == null ? '筛选' : '筛选 · 1'),
                ),
              ],
            ),
          ),
        ),
        Divider(height: 1, color: colors.line),
        if (chatError != null)
          Padding(
            padding: const EdgeInsets.all(12),
            child: ErrorBanner(
              message: chatError!,
              onClose: () => setState(() => chatError = null),
            ),
          ),
        if (tab?.filter != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
            child: Align(
              alignment: Alignment.centerLeft,
              child: InputChip(
                label: Text(
                  '${tab!.filter!['column']} ${_operators[tab.filter!['operator']]} ${tab.filter!['value'] ?? ''}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                onDeleted: () {
                  setState(() {
                    tab.filter = null;
                    tab.page = 1;
                  });
                  _load(tab);
                },
              ),
            ),
          ),
        if (tab?.error != null)
          Padding(
            padding: const EdgeInsets.all(12),
            child: ErrorBanner(message: tab!.error!),
          ),
        Expanded(
          child: tab == null
              ? const EmptyState(
                  icon: Icons.table_rows_outlined,
                  title: '从左上角选择一张表',
                )
              : tab.data == null
              ? tab.loading
                    ? const BrandLoading()
                    : const EmptyState(
                        icon: Icons.cloud_off_outlined,
                        title: '暂时无法读取数据，稍后会自动重试',
                      )
              : _DataGrid(
                  key: ValueKey('${tab.name}:${tab.page}:${tab.filter}'),
                  data: tab.data!,
                ),
        ),
        if (tab?.data != null) _footer(tab!),
      ],
    );
  }

  Widget _tab(_TableTab tab) {
    final selected = tab == active;
    final colors = context.helios;
    return Container(
      height: 36,
      constraints: const BoxConstraints(maxWidth: 210),
      margin: const EdgeInsets.only(right: 4),
      decoration: BoxDecoration(
        color: selected ? colors.surface : null,
        border: Border(
          bottom: BorderSide(
            color: selected ? colors.ink : Colors.transparent,
            width: 2,
          ),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            child: InkWell(
              onTap: () => _openTable(tab.name),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 8,
                ),
                child: Text(
                  tab.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13,
                    color: selected ? colors.ink : colors.muted,
                  ),
                ),
              ),
            ),
          ),
          IconButton(
            tooltip: '关闭 ${tab.name}',
            onPressed: () => _closeTable(tab),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints.tightFor(width: 28, height: 28),
            icon: const Icon(Icons.close, size: 14),
          ),
        ],
      ),
    );
  }

  Widget _footer(_TableTab tab) {
    final total = intValue(tab.data?['total']);
    final pages = math.max(1, (total / 50).ceil());
    return Container(
      height: 44,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: context.helios.line)),
      ),
      child: Row(
        children: [
          Text(
            '共 $total 行 · 每页 50 行',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if (boolValue(tab.data?['truncated']))
            const Padding(
              padding: EdgeInsets.only(left: 12),
              child: Text('部分长内容已截断', style: TextStyle(fontSize: 12)),
            ),
          const Spacer(),
          if (tab.loading)
            const SizedBox(
              width: 50,
              child: LinearProgressIndicator(minHeight: 2),
            ),
          IconButton(
            tooltip: '上一页',
            onPressed: tab.loading || tab.page <= 1
                ? null
                : () {
                    tab.page--;
                    _load(tab);
                  },
            icon: const Icon(Icons.chevron_left, size: 18),
          ),
          Text('${tab.page} / $pages', style: const TextStyle(fontSize: 13)),
          IconButton(
            tooltip: '下一页',
            onPressed: tab.loading || tab.page >= pages
                ? null
                : () {
                    tab.page++;
                    _load(tab);
                  },
            icon: const Icon(Icons.chevron_right, size: 18),
          ),
        ],
      ),
    );
  }
}

const _operators = {
  'contains': '包含',
  'eq': '等于',
  'ne': '不等于',
  'isNull': '为空',
  'notNull': '不为空',
};

class _FilterDialog extends StatefulWidget {
  const _FilterDialog({required this.columns, this.filter});
  final List<JsonMap> columns;
  final JsonMap? filter;
  @override
  State<_FilterDialog> createState() => _FilterDialogState();
}

class _FilterDialogState extends State<_FilterDialog> {
  late String column;
  late String operator;
  late TextEditingController value;
  @override
  void initState() {
    super.initState();
    column = stringValue(
      widget.filter?['column'],
      stringValue(widget.columns.first['name']),
    );
    if (!widget.columns.any((c) => c['name'] == column)) {
      column = stringValue(widget.columns.first['name']);
    }
    operator = stringValue(widget.filter?['operator'], 'contains');
    value = TextEditingController(text: stringValue(widget.filter?['value']));
  }

  @override
  void dispose() {
    value.dispose();
    super.dispose();
  }

  void _apply() => Navigator.pop(context, {
    'column': column,
    'operator': operator,
    'value': value.text,
  });
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text(
      '筛选数据',
      style: TextStyle(fontSize: 16, fontWeight: FontWeight.normal),
    ),
    content: SizedBox(
      width: 380,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          DropdownButtonFormField<String>(
            initialValue: column,
            isExpanded: true,
            decoration: const InputDecoration(labelText: '字段'),
            items: widget.columns
                .map(
                  (c) => DropdownMenuItem(
                    value: stringValue(c['name']),
                    child: Text(
                      stringValue(c['name']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                )
                .toList(),
            onChanged: (v) => setState(() => column = v!),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: operator,
            isExpanded: true,
            decoration: const InputDecoration(labelText: '条件'),
            items: _operators.entries
                .map(
                  (e) => DropdownMenuItem(value: e.key, child: Text(e.value)),
                )
                .toList(),
            onChanged: (v) => setState(() => operator = v!),
          ),
          if (!['isNull', 'notNull'].contains(operator)) ...[
            const SizedBox(height: 12),
            TextField(
              controller: value,
              autofocus: true,
              maxLength: 1000,
              decoration: const InputDecoration(
                labelText: '值',
                counterText: '',
              ),
              onSubmitted: (_) => _apply(),
            ),
          ],
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context, <String, dynamic>{}),
        child: const Text('清除'),
      ),
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('取消'),
      ),
      FilledButton(onPressed: _apply, child: const Text('应用')),
    ],
  );
}

class _DataGrid extends StatefulWidget {
  const _DataGrid({required this.data, super.key});
  final JsonMap data;
  @override
  State<_DataGrid> createState() => _DataGridState();
}

class _DataGridState extends State<_DataGrid> {
  final horizontal = ScrollController();
  final vertical = ScrollController();
  @override
  void dispose() {
    horizontal.dispose();
    vertical.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final columns = jsonList(widget.data['columns']);
    final rows = listValue(widget.data['rows']);
    if (columns.isEmpty) {
      return const EmptyState(
        icon: Icons.table_rows_outlined,
        title: '暂无字段和记录',
      );
    }
    final colors = context.helios;
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = math.max(
          constraints.maxWidth - 48,
          columns.length * 180.0,
        );
        final cellWidth = width / columns.length;
        return Scrollbar(
          controller: horizontal,
          thumbVisibility: true,
          notificationPredicate: (n) => n.metrics.axis == Axis.horizontal,
          child: SingleChildScrollView(
            controller: horizontal,
            scrollDirection: Axis.horizontal,
            child: SizedBox(
              width: width + 48,
              height: constraints.maxHeight,
              child: Column(
                children: [
                  Container(
                    height: 42,
                    decoration: BoxDecoration(
                      color: colors.surface,
                      border: Border(bottom: BorderSide(color: colors.line)),
                    ),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 48,
                          child: Center(
                            child: Text(
                              '#',
                              style: TextStyle(
                                color: colors.muted,
                                fontSize: 12,
                              ),
                            ),
                          ),
                        ),
                        for (final column in columns)
                          SizedBox(
                            width: cellWidth,
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                              ),
                              child: Tooltip(
                                message:
                                    '${column['name']} · ${column['type']}',
                                child: Text(
                                  stringValue(column['name']),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 13),
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: rows.isEmpty
                        ? const Center(
                            child: Text(
                              '没有符合条件的数据',
                              style: TextStyle(fontSize: 13),
                            ),
                          )
                        : Scrollbar(
                            controller: vertical,
                            thumbVisibility: true,
                            child: ListView.builder(
                              controller: vertical,
                              itemCount: rows.length,
                              itemExtent: 36,
                              itemBuilder: (context, index) {
                                final values = listValue(rows[index]);
                                return DecoratedBox(
                                  decoration: BoxDecoration(
                                    border: Border(
                                      bottom: BorderSide(
                                        color: colors.line.withValues(
                                          alpha: 0.6,
                                        ),
                                      ),
                                    ),
                                  ),
                                  child: Row(
                                    children: [
                                      SizedBox(
                                        width: 48,
                                        child: Center(
                                          child: Text(
                                            '${(intValue(widget.data['page']) - 1) * intValue(widget.data['pageSize']) + index + 1}',
                                            style: TextStyle(
                                              fontSize: 12,
                                              color: colors.muted,
                                            ),
                                          ),
                                        ),
                                      ),
                                      for (var i = 0; i < columns.length; i++)
                                        SizedBox(
                                          width: cellWidth,
                                          child: Padding(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 12,
                                            ),
                                            child: ClipRect(
                                              child: SelectableText(
                                                i < values.length &&
                                                        values[i] != null
                                                    ? stringValue(values[i])
                                                    : 'NULL',
                                                maxLines: 1,
                                                style: TextStyle(
                                                  fontSize: 13,
                                                  color:
                                                      i < values.length &&
                                                          values[i] != null
                                                      ? colors.ink
                                                      : colors.subtle,
                                                ),
                                              ),
                                            ),
                                          ),
                                        ),
                                    ],
                                  ),
                                );
                              },
                            ),
                          ),
                  ),
                  const SizedBox(height: 10),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
