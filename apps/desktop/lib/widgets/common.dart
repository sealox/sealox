import 'package:flutter/material.dart';

import '../core/app_controller.dart';
import '../core/json.dart';
import '../core/theme.dart';

class AppScope extends InheritedNotifier<AppController> {
  const AppScope({
    required AppController controller,
    required super.child,
    super.key,
  }) : super(notifier: controller);

  static AppController of(BuildContext context, {bool listen = true}) {
    if (!listen) {
      final element = context
          .getElementForInheritedWidgetOfExactType<AppScope>();
      return (element!.widget as AppScope).notifier!;
    }
    return context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;
  }
}

class BrandLoading extends StatelessWidget {
  const BrandLoading({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset('assets/icon.png', width: 44, height: 44),
            const SizedBox(height: 16),
            const SizedBox(
              width: 120,
              child: LinearProgressIndicator(minHeight: 2),
            ),
          ],
        ),
      ),
    );
  }
}

class ErrorBanner extends StatelessWidget {
  const ErrorBanner({required this.message, this.onClose, super.key});

  final String message;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 8, 7, 8),
      decoration: BoxDecoration(
        color: colors.redSoft,
        border: Border.all(color: colors.red.withValues(alpha: 0.28)),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, size: 17, color: colors.red),
          const SizedBox(width: 8),
          Expanded(
            child: SelectableText(message, style: TextStyle(color: colors.red)),
          ),
          if (onClose != null)
            IconButton(
              tooltip: '关闭',
              visualDensity: VisualDensity.compact,
              onPressed: onClose,
              icon: const Icon(Icons.close, size: 17),
            ),
        ],
      ),
    );
  }
}

class WarningBanner extends StatelessWidget {
  const WarningBanner({required this.message, super.key});

  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: colors.amberSoft,
        border: Border.all(color: colors.amber.withValues(alpha: 0.3)),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        children: [
          Icon(Icons.warning_amber, size: 17, color: colors.amber),
          const SizedBox(width: 8),
          Expanded(child: SelectableText(message)),
        ],
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    required this.icon,
    required this.title,
    this.message,
    super.key,
  });

  final IconData icon;
  final String title;
  final String? message;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact =
            constraints.hasBoundedHeight && constraints.maxHeight < 150;
        return Center(
          child: Padding(
            padding: compact
                ? const EdgeInsets.symmetric(horizontal: 20, vertical: 10)
                : const EdgeInsets.all(36),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: compact ? 32 : 40,
                  height: compact ? 32 : 40,
                  decoration: BoxDecoration(
                    color: colors.panel,
                    border: Border.all(color: colors.line),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Icon(
                    icon,
                    size: compact ? 17 : 20,
                    color: colors.muted,
                  ),
                ),
                SizedBox(height: compact ? 7 : 11),
                Text(
                  title,
                  textAlign: TextAlign.center,
                  style: compact
                      ? Theme.of(context).textTheme.bodyMedium
                      : Theme.of(context).textTheme.titleMedium,
                ),
                if (message != null) ...[
                  SizedBox(height: compact ? 4 : 6),
                  Text(
                    message!,
                    maxLines: compact ? 2 : null,
                    overflow: compact ? TextOverflow.ellipsis : null,
                    style: Theme.of(context).textTheme.bodySmall,
                    textAlign: TextAlign.center,
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

class StatusBadge extends StatelessWidget {
  const StatusBadge(this.status, {super.key});

  final String status;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    final color = switch (status.toLowerCase()) {
      'running' || 'ready' => colors.green,
      'failed' || 'abnormal' || 'error' => colors.red,
      'progressing' || 'starting' || 'creating' => colors.amber,
      _ => colors.muted,
    };
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 6,
          height: 6,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 5),
        Flexible(
          child: Text(
            status,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
      ],
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.title, {this.trailing, super.key});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: Row(
        children: [
          Expanded(
            child: Text(title, style: Theme.of(context).textTheme.titleMedium),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

class KeyValue extends StatelessWidget {
  const KeyValue(this.label, this.value, {this.copy = false, super.key});

  final String label;
  final String value;
  final bool copy;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(label, style: Theme.of(context).textTheme.bodySmall),
          ),
          Expanded(child: SelectableText(value.isEmpty ? '-' : value)),
          if (copy && value.isNotEmpty)
            IconButton(
              tooltip: '复制',
              onPressed: () => AppScope.of(
                context,
                listen: false,
              ).invoke('copyText', [value]),
              icon: const Icon(Icons.content_copy, size: 16),
            ),
        ],
      ),
    );
  }
}

class ResourceCard extends StatelessWidget {
  const ResourceCard({
    required this.title,
    required this.icon,
    this.subtitle,
    this.status,
    this.lines = const [],
    this.onTap,
    this.trailing,
    super.key,
  });

  final String title;
  final IconData icon;
  final String? subtitle;
  final String? status;
  final List<String> lines;
  final VoidCallback? onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: onTap,
        child: SizedBox(
          height: 68,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: colors.panel,
                    border: Border.all(color: colors.line),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Icon(icon, size: 17, color: colors.muted),
                ),
                const SizedBox(width: 11),
                Expanded(
                  flex: 4,
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      if (subtitle?.isNotEmpty ?? false)
                        Text(
                          subtitle!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                    ],
                  ),
                ),
                if (lines.isNotEmpty) ...[
                  const SizedBox(width: 16),
                  Expanded(
                    flex: 3,
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (final line in lines.take(2))
                          Text(
                            line,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                      ],
                    ),
                  ),
                ],
                if (status != null) ...[
                  const SizedBox(width: 12),
                  SizedBox(width: 104, child: StatusBadge(status!)),
                ],
                if (trailing != null) ...[const SizedBox(width: 6), trailing!],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

Future<bool> confirmAction(
  BuildContext context, {
  required String title,
  required String message,
  String confirmLabel = '确认',
  bool destructive = false,
}) async {
  final colors = context.helios;
  return await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            FilledButton(
              style: destructive
                  ? FilledButton.styleFrom(
                      backgroundColor: colors.red,
                      foregroundColor: Theme.of(context).colorScheme.onError,
                    )
                  : null,
              onPressed: () => Navigator.pop(context, true),
              child: Text(confirmLabel),
            ),
          ],
        ),
      ) ??
      false;
}

String displayDate(Object? value) {
  final parsed = DateTime.tryParse(stringValue(value));
  if (parsed == null) return '-';
  final local = parsed.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${local.year}-${two(local.month)}-${two(local.day)} ${two(local.hour)}:${two(local.minute)}';
}
