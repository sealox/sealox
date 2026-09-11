import 'dart:math' as math;

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../core/json.dart';
import '../core/theme.dart';
import 'common.dart';

JsonMap? monitorForCurrentPods(JsonMap? monitor, List<JsonMap> pods) {
  if (monitor == null || !boolValue(monitor['available'])) return monitor;
  final names = pods.map((pod) => stringValue(pod['name'])).toSet();

  List<JsonMap> currentSeries(Object? value) =>
      jsonList(value)
          .where((series) => names.contains(stringValue(series['name'])))
          .toList();

  return {
    ...monitor,
    'cpu': currentSeries(monitor['cpu']),
    'memory': currentSeries(monitor['memory']),
  };
}

class MonitorCharts extends StatelessWidget {
  const MonitorCharts({
    required this.monitor,
    this.includeDisk = false,
    super.key,
  });

  final JsonMap? monitor;
  final bool includeDisk;

  @override
  Widget build(BuildContext context) {
    final data = monitor;
    if (data == null) {
      return const SizedBox(height: 150, child: BrandLoading());
    }
    if (!boolValue(data['available'])) {
      return SizedBox(
        height: 120,
        child: EmptyState(
          icon: Icons.monitor_heart_outlined,
          title: '监控暂不可用',
          message: stringValue(data['reason']),
        ),
      );
    }
    final metrics = <(String, List<JsonMap>)>[
      ('CPU', jsonList(data['cpu'])),
      ('内存', jsonList(data['memory'])),
      if (includeDisk) ('磁盘', jsonList(data['disk'])),
    ];
    return Column(
      children: [
        if (boolValue(data['diskOverflow'])) ...[
          const ErrorBanner(message: '数据库磁盘使用率过高，请尽快处理。'),
          const SizedBox(height: 12),
        ],
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final metric in metrics)
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(right: 10),
                  child: _MetricChart(title: metric.$1, series: metric.$2),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _MetricChart extends StatelessWidget {
  const _MetricChart({required this.title, required this.series});

  final String title;
  final List<JsonMap> series;

  @override
  Widget build(BuildContext context) {
    final palette = context.helios;
    final seriesColors = [
      palette.ink,
      palette.green,
      palette.amber,
      palette.red,
    ];
    final bars = <LineChartBarData>[];
    var maxY = 100.0;
    for (var index = 0; index < series.length; index++) {
      final points = listValue(series[index]['points']);
      final spots = <FlSpot>[];
      for (final raw in points) {
        final pair = listValue(raw);
        if (pair.length < 2) continue;
        final y = doubleValue(pair[1]);
        maxY = math.max(maxY, y);
        spots.add(FlSpot(doubleValue(pair[0]), y));
      }
      bars.add(
        LineChartBarData(
          spots: spots,
          color: seriesColors[index % seriesColors.length],
          barWidth: 2,
          dotData: const FlDotData(show: false),
        ),
      );
    }
    return SizedBox(
      height: 210,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 14, 16, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('$title %', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 12),
              Expanded(
                child: bars.every((bar) => bar.spots.isEmpty)
                    ? const Center(child: Text('暂无数据'))
                    : LineChart(
                        LineChartData(
                          minY: 0,
                          maxY: maxY,
                          gridData: const FlGridData(drawVerticalLine: false),
                          borderData: FlBorderData(show: false),
                          titlesData: const FlTitlesData(
                            topTitles: AxisTitles(),
                            rightTitles: AxisTitles(),
                            bottomTitles: AxisTitles(
                              sideTitles: SideTitles(showTitles: false),
                            ),
                            leftTitles: AxisTitles(
                              sideTitles: SideTitles(
                                showTitles: true,
                                reservedSize: 32,
                              ),
                            ),
                          ),
                          lineBarsData: bars,
                        ),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class PodsSection extends StatelessWidget {
  const PodsSection({
    required this.pods,
    this.showCopyButtons = true,
    super.key,
  });

  final List<JsonMap> pods;
  final bool showCopyButtons;

  @override
  Widget build(BuildContext context) {
    if (pods.isEmpty) {
      return const SizedBox(
        height: 100,
        child: EmptyState(icon: Icons.dns_outlined, title: '暂无 Pod'),
      );
    }
    return Card(
      child: Column(
        children: [
          for (final pod in pods)
            ExpansionTile(
              leading: const Icon(Icons.dns_outlined),
              title: Text(stringValue(pod['name'])),
              subtitle: Text(
                '${stringValue(pod['phase'])}  ·  ${intValue(pod['restarts'])} 次重启',
              ),
              trailing: StatusBadge(
                stringValue(pod['reason'], stringValue(pod['phase'])),
              ),
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
                  child: Column(
                    children: [
                      KeyValue('节点', stringValue(pod['node'])),
                      KeyValue(
                        'IP',
                        stringValue(pod['ip']),
                        copy: showCopyButtons,
                      ),
                      KeyValue('创建时间', displayDate(pod['createdAt'])),
                      for (final container in jsonList(pod['containers']))
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(
                            Icons.view_in_ar_outlined,
                            size: 18,
                          ),
                          title: Text(stringValue(container['name'])),
                          subtitle: Text(stringValue(container['image'])),
                          trailing: StatusBadge(
                            stringValue(
                              container['reason'],
                              stringValue(container['state']),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class PodLogsPanel extends StatefulWidget {
  const PodLogsPanel({required this.pods, super.key});

  final List<JsonMap> pods;

  @override
  State<PodLogsPanel> createState() => _PodLogsPanelState();
}

class _PodLogsPanelState extends State<PodLogsPanel> {
  String? selectedPod;
  String? selectedContainer;
  bool previousLogs = false;
  String? logs;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    _reconcileSelection();
  }

  @override
  void didUpdateWidget(covariant PodLogsPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    _reconcileSelection();
  }

  void _reconcileSelection() {
    final pods = widget.pods;
    final nextPod = pods.any((pod) => pod['name'] == selectedPod)
        ? selectedPod
        : pods.isEmpty
        ? null
        : stringValue(pods.first['name']);
    final pod = pods.where((item) => item['name'] == nextPod).firstOrNull;
    final containers = jsonList(pod?['containers']);
    final nextContainer =
        containers.any((container) => container['name'] == selectedContainer)
        ? selectedContainer
        : containers.isEmpty
        ? null
        : stringValue(containers.first['name']);
    if (nextPod != selectedPod || nextContainer != selectedContainer) {
      logs = null;
    }
    selectedPod = nextPod;
    selectedContainer = nextContainer;
  }

  Future<void> _load() async {
    if (selectedPod == null) return;
    setState(() {
      busy = true;
      logs = null;
    });
    try {
      final text = await AppScope.of(context, listen: false).invoke<String>(
        'getPodLogs',
        [selectedPod, selectedContainer, previousLogs],
      );
      if (mounted) setState(() => logs = text ?? '');
    } catch (exception) {
      if (mounted) setState(() => logs = exception.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.pods.isEmpty) {
      return const SizedBox(
        height: 120,
        child: EmptyState(icon: Icons.subject_outlined, title: '暂无 Pod 可加载日志'),
      );
    }
    final selectedPodData = widget.pods
        .where((pod) => pod['name'] == selectedPod)
        .firstOrNull;
    final containers = jsonList(selectedPodData?['containers']);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    isExpanded: true,
                    key: ValueKey('pod-$selectedPod-${widget.pods.length}'),
                    initialValue: selectedPod,
                    decoration: const InputDecoration(labelText: 'Pod'),
                    items: widget.pods
                        .map(
                          (pod) => DropdownMenuItem(
                            value: stringValue(pod['name']),
                            child: Text(
                              stringValue(pod['name']),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (value) => setState(() {
                      selectedPod = value;
                      final found = widget.pods
                          .where((pod) => pod['name'] == value)
                          .firstOrNull;
                      final list = jsonList(found?['containers']);
                      selectedContainer = list.isEmpty
                          ? null
                          : stringValue(list.first['name']);
                      logs = null;
                    }),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    isExpanded: true,
                    key: ValueKey(
                      'container-$selectedPod-$selectedContainer-${containers.length}',
                    ),
                    initialValue: selectedContainer,
                    decoration: const InputDecoration(labelText: '容器'),
                    items: containers
                        .map(
                          (container) => DropdownMenuItem(
                            value: stringValue(container['name']),
                            child: Text(
                              stringValue(container['name']),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (value) => setState(() {
                      selectedContainer = value;
                      logs = null;
                    }),
                  ),
                ),
                const SizedBox(width: 10),
                FilterChip(
                  selected: previousLogs,
                  onSelected: (value) => setState(() {
                    previousLogs = value;
                    logs = null;
                  }),
                  label: const Text('崩溃前'),
                ),
                const SizedBox(width: 10),
                FilledButton.icon(
                  onPressed: busy || selectedPod == null ? null : _load,
                  icon: const Icon(Icons.subject, size: 17),
                  label: const Text('加载'),
                ),
              ],
            ),
            if (busy)
              const Padding(padding: EdgeInsets.all(20), child: BrandLoading()),
            if (logs != null)
              Container(
                width: double.infinity,
                constraints: const BoxConstraints(maxHeight: 360),
                margin: const EdgeInsets.only(top: 12),
                padding: const EdgeInsets.all(14),
                color: context.helios.codeSurface,
                child: SingleChildScrollView(
                  child: SelectableText(
                    logs!,
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: context.helios.codeInk,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class EventsSection extends StatelessWidget {
  const EventsSection({required this.events, super.key});

  final List<JsonMap> events;

  @override
  Widget build(BuildContext context) {
    if (events.isEmpty) {
      return const SizedBox(
        height: 100,
        child: EmptyState(icon: Icons.event_note_outlined, title: '暂无事件'),
      );
    }
    return Card(
      child: Column(
        children: [
          for (final event in events)
            ListTile(
              leading: Icon(
                event['type'] == 'Warning'
                    ? Icons.warning_amber
                    : Icons.info_outline,
                color: event['type'] == 'Warning'
                    ? context.helios.red
                    : context.helios.ink,
                size: 19,
              ),
              title: Text(
                '${stringValue(event['reason'])}  ${stringValue(event['object'])}',
              ),
              subtitle: Text(stringValue(event['message'])),
              trailing: Text(
                '${intValue(event['count'])} · ${displayDate(event['lastAt'])}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
        ],
      ),
    );
  }
}
