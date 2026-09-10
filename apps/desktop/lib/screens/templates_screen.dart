import 'package:flutter/material.dart';

import '../core/json.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import '../core/app_controller.dart';

class TemplatesScreen extends StatefulWidget {
  const TemplatesScreen({super.key});

  @override
  State<TemplatesScreen> createState() => _TemplatesScreenState();
}

class _TemplatesScreenState extends State<TemplatesScreen> {
  List<JsonMap>? templates;
  final search = TextEditingController();
  String category = '全部';
  String sort = 'deploys';
  String? error;
  bool loadStarted = false;
  final deploying = <String>{};
  final cardErrors = <String, String>{};

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (loadStarted) return;
    loadStarted = true;
    _load();
  }

  Future<void> _load() async {
    try {
      final catalog = jsonMap(
        await AppScope.of(
          context,
          listen: false,
        ).invoke('getTemplates').timeout(const Duration(seconds: 12)),
      );
      if (mounted) setState(() => templates = jsonList(catalog['templates']));
    } catch (exception) {
      if (mounted) {
        setState(() {
          templates = const [];
          error = exception.toString();
        });
      }
    }
  }

  void _retry() {
    setState(() {
      templates = null;
      error = null;
    });
    _load();
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final all = templates;
    if (all == null) {
      return const Center(child: CircularProgressIndicator());
    }
    final categories = {
      '全部',
      ...all
          .map((item) => stringValue(item['category']))
          .where((item) => item.isNotEmpty),
    }.toList();
    final query = search.text.trim().toLowerCase();
    final shown =
        all.where((item) {
          final matchesCategory =
              category == '全部' || item['category'] == category;
          final haystack =
              '${item['name']} ${item['description']} ${listValue(item['tags']).join(' ')}'
                  .toLowerCase();
          return matchesCategory && (query.isEmpty || haystack.contains(query));
        }).toList()..sort((a, b) {
          if (sort == 'deploys') {
            final byDeploys = intValue(b['deployCount'])
                .compareTo(intValue(a['deployCount']));
            if (byDeploys != 0) return byDeploys;
          }
          return stringValue(a['name'])
              .toLowerCase()
              .compareTo(stringValue(b['name']).toLowerCase());
        });
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 10),
          child: Row(
            children: [
              SizedBox(
                width: 260,
                child: TextField(
                  controller: search,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.search, size: 19),
                    hintText: '搜索模板',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              SizedBox(
                width: 150,
                child: DropdownButtonFormField<String>(
                  initialValue: category,
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.tune, size: 17),
                  ),
                  isExpanded: true,
                  items: categories
                      .map(
                        (value) => DropdownMenuItem(
                          value: value,
                          child: Text(
                            value,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: (value) =>
                      setState(() => category = value ?? '全部'),
                ),
              ),
              const SizedBox(width: 10),
              SizedBox(
                width: 138,
                child: Tooltip(
                  message: '排序',
                  child: DropdownButtonFormField<String>(
                    initialValue: sort,
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.sort, size: 17),
                    ),
                    isExpanded: true,
                    items: const [
                      DropdownMenuItem(value: 'deploys', child: Text('最多部署')),
                      DropdownMenuItem(value: 'name', child: Text('名称 A-Z')),
                    ],
                    onChanged: (value) =>
                        setState(() => sort = value ?? 'deploys'),
                  ),
                ),
              ),
            ],
          ),
        ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 10),
            child: ErrorBanner(
              message: error!,
              onClose: () => setState(() => error = null),
            ),
          ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 10),
            child: Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: _retry,
                icon: const Icon(Icons.refresh, size: 17),
                label: const Text('重试'),
              ),
            ),
          ),
        Expanded(
          child: shown.isEmpty
              ? const EmptyState(
                  icon: Icons.dashboard_customize_outlined,
                  title: '没有匹配的模板',
                )
              : GridView.builder(
                  padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
                  gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                    maxCrossAxisExtent: 350,
                    mainAxisExtent: 286,
                    mainAxisSpacing: 10,
                    crossAxisSpacing: 10,
                  ),
                  itemCount: shown.length,
                  itemBuilder: (context, index) => _TemplateCard(
                    template: shown[index],
                    busy: deploying.contains(shown[index]['templateName']),
                    error:
                        cardErrors[stringValue(shown[index]['templateName'])],
                    onDeploy: () => _deploy(shown[index]),
                  ),
                ),
        ),
      ],
    );
  }

  Future<void> _deploy(JsonMap template) async {
    final controller = AppScope.of(context, listen: false);
    final name = stringValue(template['templateName']);
    setState(() {
      deploying.add(name);
      cardErrors.remove(name);
    });
    try {
      final detail = jsonMap(
        await controller.invoke('getTemplateDetail', [name]),
      );
      final args = jsonMap(detail['args']);
      final required = args.entries
          .where((entry) => boolValue(jsonMap(entry.value)['required']))
          .toList();
      final values = <String, String>{};
      if (required.isNotEmpty) {
        if (!mounted) return;
        final entered = await showDialog<Map<String, String>>(
          context: context,
          builder: (context) =>
              _TemplateArgsDialog(template: template, definitions: args),
        );
        if (entered == null) return;
        values.addAll(entered);
      }
      _checkQuota(controller.snapshot, jsonMap(detail['quota']));
      final result = jsonMap(
        await controller.invoke('deployTemplate', [name, values]),
      );
      final instance = stringValue(result['instanceName']);
      await controller.refreshResources(silent: true);
      if (instance.isNotEmpty) {
        controller.openDetail(DetailRoute('project', instance));
      }
    } catch (exception) {
      if (mounted) setState(() => cardErrors[name] = exception.toString());
    } finally {
      if (mounted) setState(() => deploying.remove(name));
    }
  }

  void _checkQuota(JsonMap? snapshot, JsonMap required) {
    if (snapshot == null) return;
    final quota = {
      for (final item in jsonList(snapshot['quota']))
        stringValue(item['type']): item,
    };
    for (final resource in ['cpu', 'memory', 'storage']) {
      final item = quota[resource];
      if (item == null || doubleValue(item['limit']) <= 0) continue;
      final need = doubleValue(required[resource]);
      final available = doubleValue(item['limit']) - doubleValue(item['used']);
      if (need > 0 && available < need) {
        throw Exception('$resource 配额不足：需要 $need，可用 $available');
      }
    }
  }
}

class _TemplateCard extends StatelessWidget {
  const _TemplateCard({
    required this.template,
    required this.busy,
    required this.onDeploy,
    this.error,
  });

  final JsonMap template;
  final bool busy;
  final String? error;
  final VoidCallback onDeploy;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(13),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: double.infinity,
              height: 80,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(5),
                child: stringValue(template['screenshot']).isEmpty
                    ? Container(
                        color: colors.canvas,
                        child: Icon(
                          Icons.dashboard_customize_outlined,
                          color: colors.muted,
                        ),
                      )
                    : Image.network(
                        stringValue(template['screenshot']),
                        fit: BoxFit.cover,
                        errorBuilder: (_, _, _) => Container(
                          color: colors.canvas,
                          child: Icon(
                            Icons.dashboard_customize_outlined,
                            color: colors.muted,
                          ),
                        ),
                      ),
              ),
            ),
            const SizedBox(height: 11),
            Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: stringValue(template['icon']).isEmpty
                      ? Container(
                          width: 36,
                          height: 36,
                          color: colors.panel,
                          child: Icon(
                            Icons.apps,
                            size: 18,
                            color: colors.muted,
                          ),
                        )
                      : Image.network(
                          stringValue(template['icon']),
                          width: 36,
                          height: 36,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => const SizedBox(
                            width: 36,
                            height: 36,
                            child: Icon(Icons.apps, size: 18),
                          ),
                        ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    stringValue(template['name']),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                IconButton(
                  tooltip: '打开详情',
                  onPressed: () => AppScope.of(
                    context,
                    listen: false,
                  ).invoke('openExternal', [template['detailUrl']]),
                  icon: const Icon(Icons.open_in_new, size: 18),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              stringValue(template['description']),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const Spacer(),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  error!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 12, color: colors.red),
                ),
              ),
            Row(
              children: [
                Expanded(
                  child: Text(
                    stringValue(template['category']),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
                FilledButton.icon(
                  onPressed: busy ? null : onDeploy,
                  icon: busy
                      ? const SizedBox(
                          width: 15,
                          height: 15,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.rocket_launch_outlined, size: 17),
                  label: Text(busy ? '提交中' : '部署'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _TemplateArgsDialog extends StatefulWidget {
  const _TemplateArgsDialog({
    required this.template,
    required this.definitions,
  });

  final JsonMap template;
  final JsonMap definitions;

  @override
  State<_TemplateArgsDialog> createState() => _TemplateArgsDialogState();
}

class _TemplateArgsDialogState extends State<_TemplateArgsDialog> {
  late final Map<String, TextEditingController> controllers = {
    for (final entry in widget.definitions.entries)
      if (boolValue(jsonMap(entry.value)['required']) &&
          stringValue(jsonMap(entry.value)['default']).trim().isEmpty)
        entry.key: TextEditingController(text: ''),
  };

  @override
  void dispose() {
    for (final controller in controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('部署 ${widget.template['name']}'),
      content: SizedBox(
        width: 440,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final entry in controllers.entries)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: TextField(
                  controller: entry.value,
                  onChanged: (_) => setState(() {}),
                  obscureText:
                      stringValue(
                            jsonMap(widget.definitions[entry.key])['type'],
                          ).toLowerCase() ==
                          'password' ||
                      RegExp(
                        r'(key|token|secret|password)',
                        caseSensitive: false,
                      ).hasMatch(entry.key),
                  decoration: InputDecoration(
                    labelText: entry.key,
                    helperText: stringValue(
                      jsonMap(widget.definitions[entry.key])['description'],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed:
              controllers.values.any(
                (controller) => controller.text.trim().isEmpty,
              )
              ? null
              : () => Navigator.pop(context, {
                  for (final entry in controllers.entries)
                    entry.key: entry.value.text,
                }),
          child: const Text('部署'),
        ),
      ],
    );
  }
}
