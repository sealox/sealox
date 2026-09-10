import '../core/auto_refresh.dart';

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../core/json.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

class AiProxyScreen extends StatefulWidget {
  const AiProxyScreen({super.key});

  @override
  State<AiProxyScreen> createState() => _AiProxyScreenState();
}

class _AiProxyScreenState extends State<AiProxyScreen>
    with AutoRefresh<AiProxyScreen> {
  @override
  bool get canAutoRefresh => !busy;
  @override
  Future<void> refreshAutomatically() => _load();

  JsonMap? overview;
  String? error;
  bool busy = false;
  bool loaded = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!loaded) {
      loaded = true;
      _load();
    }
  }

  Future<void> _load() async {
    try {
      final result = await AppScope.of(
        context,
        listen: false,
      ).invoke('getAiProxyOverview');
      if (mounted) setState(() => overview = jsonMap(result));
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    }
  }

  Future<void> _createKey() async {
    final input = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('创建 API Key'),
        content: TextField(
          controller: input,
          autofocus: true,
          decoration: const InputDecoration(labelText: '名称'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, input.text.trim()),
            child: const Text('创建'),
          ),
        ],
      ),
    );
    input.dispose();
    if (name?.isEmpty ?? true) return;
    await _run(() async {
      final created = jsonMap(
        await AppScope.of(context, listen: false).invoke('createAiKey', [name]),
      );
      if (!mounted) return;
      final fullKey =
          'sk-${stringValue(created['key']).replaceFirst(RegExp(r'^sk-'), '')}';
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (context) => AlertDialog(
          title: const Text('API Key 已创建'),
          content: SizedBox(
            width: 480,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('该密钥只会完整显示这一次。'),
                const SizedBox(height: 12),
                SelectableText(
                  fullKey,
                  style: const TextStyle(fontFamily: 'monospace'),
                ),
              ],
            ),
          ),
          actions: [
            OutlinedButton.icon(
              onPressed: () => AppScope.of(
                context,
                listen: false,
              ).invoke('copyText', [fullKey]),
              icon: const Icon(Icons.content_copy, size: 16),
              label: const Text('复制'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('我已保存'),
            ),
          ],
        ),
      );
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
  Widget build(BuildContext context) {
    final data = overview;
    if (data == null && error == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (data == null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: ErrorBanner(message: error!, onClose: _load),
      );
    }
    final endpoint = stringValue(data['endpoint']);
    final usage = jsonMap(data['usage']);
    final keys = jsonList(data['keys']);
    final models = jsonList(data['models']);
    final points = jsonList(usage['points']);
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
      children: [
        if (error != null) ...[
          ErrorBanner(
            message: error!,
            onClose: () => setState(() => error = null),
          ),
          const SizedBox(height: 14),
        ],
        SectionTitle('接入', trailing: const SizedBox.shrink()),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              children: [
                KeyValue('端点', endpoint, copy: true),
                const Divider(),
                KeyValue(
                  'curl',
                  "curl $endpoint/chat/completions -H 'Authorization: Bearer sk-...'",
                  copy: true,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 22),
        const SectionTitle('近 7 天用量'),
        SizedBox(
          height: 210,
          child: Card(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 18, 24, 12),
              child: points.isEmpty
                  ? const EmptyState(icon: Icons.show_chart, title: '暂无用量')
                  : LineChart(
                      LineChartData(
                        gridData: const FlGridData(
                          show: true,
                          drawVerticalLine: false,
                        ),
                        titlesData: const FlTitlesData(
                          topTitles: AxisTitles(),
                          rightTitles: AxisTitles(),
                          bottomTitles: AxisTitles(
                            sideTitles: SideTitles(showTitles: false),
                          ),
                          leftTitles: AxisTitles(
                            sideTitles: SideTitles(
                              showTitles: true,
                              reservedSize: 42,
                            ),
                          ),
                        ),
                        borderData: FlBorderData(show: false),
                        lineBarsData: [
                          LineChartBarData(
                            spots: [
                              for (var i = 0; i < points.length; i++)
                                FlSpot(
                                  i.toDouble(),
                                  doubleValue(points[i]['requests']),
                                ),
                            ],
                            color: context.helios.amber,
                            barWidth: 2.5,
                            dotData: const FlDotData(show: false),
                            belowBarData: BarAreaData(
                              show: true,
                              color: context.helios.amberSoft,
                            ),
                          ),
                        ],
                      ),
                    ),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 24,
          children: [
            Text('${intValue(usage['requests'])} 请求'),
            Text(
              '${intValue(usage['inputTokens']) + intValue(usage['outputTokens'])} tokens',
            ),
            Text(
              '${doubleValue(usage['amount']).toStringAsFixed(4)} ${stringValue(data['currency'])}',
            ),
          ],
        ),
        const SizedBox(height: 26),
        SectionTitle(
          'API Keys',
          trailing: FilledButton.icon(
            onPressed: busy ? null : _createKey,
            icon: const Icon(Icons.add, size: 17),
            label: const Text('创建 Key'),
          ),
        ),
        Card(
          child: keys.isEmpty
              ? const SizedBox(
                  height: 120,
                  child: EmptyState(icon: Icons.key_outlined, title: '暂无 Key'),
                )
              : Column(children: [for (final key in keys) _keyRow(key)]),
        ),
        const SizedBox(height: 26),
        SectionTitle('可用模型 (${models.length})'),
        Card(
          child: Column(
            children: [
              for (final model in models)
                ListTile(
                  title: Text(stringValue(model['model'])),
                  subtitle: Text(
                    '${stringValue(model['owner'])}  ·  ${intValue(model['rpm'])} RPM',
                  ),
                  trailing: Wrap(
                    spacing: 6,
                    children: [
                      if (boolValue(model['vision']))
                        const Chip(label: Text('视觉')),
                      if (boolValue(model['toolChoice']))
                        const Chip(label: Text('工具')),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _keyRow(JsonMap key) {
    final raw = stringValue(key['key']);
    final masked = raw.length > 8
        ? 'sk-${raw.substring(0, 4)}••••${raw.substring(raw.length - 4)}'
        : 'sk-••••';
    final enabled = boolValue(key['enabled']);
    return ListTile(
      leading: const Icon(Icons.key_outlined),
      title: Text(stringValue(key['name'])),
      subtitle: Text('$masked  ·  ${intValue(key['requestCount'])} 请求'),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Switch(
            value: enabled,
            onChanged: busy
                ? null
                : (value) => _run(() async {
                    await AppScope.of(
                      context,
                      listen: false,
                    ).invoke('setAiKeyEnabled', [key['id'], value]);
                    await _load();
                  }),
          ),
          IconButton(
            tooltip: '删除',
            onPressed: busy
                ? null
                : () async {
                    if (!await confirmAction(
                      context,
                      title: '删除 API Key',
                      message: '删除后使用该 Key 的应用将无法继续访问 AI Proxy。',
                      confirmLabel: '删除',
                      destructive: true,
                    )) {
                      return;
                    }
                    await _run(() async {
                      await AppScope.of(
                        context,
                        listen: false,
                      ).invoke('deleteAiKey', [key['id']]);
                      await _load();
                    });
                  },
            icon: const Icon(Icons.delete_outline, size: 18),
          ),
        ],
      ),
    );
  }
}
