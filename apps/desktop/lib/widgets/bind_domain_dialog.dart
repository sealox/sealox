import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/json.dart';
import 'common.dart';

Future<void> showBindDomainDialog(
  BuildContext context,
  String publicUrl,
) async {
  await showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (_) => BindDomainDialog(publicUrl: publicUrl),
  );
}

class BindDomainDialog extends StatefulWidget {
  const BindDomainDialog({required this.publicUrl, super.key});
  final String publicUrl;
  @override
  State<BindDomainDialog> createState() => _BindDomainDialogState();
}

class _BindDomainDialogState extends State<BindDomainDialog> {
  final name = TextEditingController();
  String? target, error, boundUrl;
  List<String> domains = [];
  bool loading = true, saving = false, started = false;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!started) {
      started = true;
      _load();
    }
  }

  @override
  void dispose() {
    name.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final data = jsonMap(
        await AppScope.of(
          context,
          listen: false,
        ).invoke('getDomainBinding', [widget.publicUrl]),
      );
      if (mounted) {
        setState(() {
          target = stringValue(data['target']);
          domains = (data['domains'] as List? ?? [])
              .map((e) => e.toString())
              .toList();
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _bind() async {
    if (saving || name.text.trim().isEmpty) return;
    setState(() {
      saving = true;
      error = null;
    });
    final controller = AppScope.of(context, listen: false);
    try {
      final result = jsonMap(
        await controller.invoke('bindDomain', [
          widget.publicUrl,
          name.text.trim(),
        ]),
      );
      if (mounted) setState(() => boundUrl = stringValue(result['url']));
      await controller.refreshResources(silent: true);
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !saving,
    child: AlertDialog(
      title: const Text('绑定域名'),
      titleTextStyle: Theme.of(context).textTheme.titleMedium
          ?.copyWith(fontSize: 16, fontWeight: FontWeight.normal),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (loading)
                const SizedBox(height: 120, child: BrandLoading())
              else if (boundUrl != null) ...[
                SelectableText(boundUrl!),
                const SizedBox(height: 12),
                const Text('域名路由已绑定，HTTPS 证书正在申请，请稍后访问。'),
              ] else if (target != null) ...[
                const Text('自定义域名'),
                const SizedBox(height: 8),
                TextField(
                  controller: name,
                  enabled: !saving,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    hintText: 'app.example.com',
                    constraints: BoxConstraints(minHeight: 40),
                  ),
                ),
                const SizedBox(height: 12),
                const Text('在域名的 DNS 服务商处添加以下记录：'),
                const SizedBox(height: 8),
                const Text('类型：CNAME'),
                SelectableText(
                  '记录域名：${name.text.trim().isEmpty ? 'app.example.com' : name.text.trim()}',
                ),
                Row(
                  children: [
                    const Text('目标：'),
                    Expanded(child: SelectableText(target!)),
                    IconButton(
                      tooltip: '复制 CNAME 目标',
                      onPressed: () =>
                          Clipboard.setData(ClipboardData(text: target!)),
                      icon: const Icon(Icons.copy_outlined, size: 16),
                    ),
                  ],
                ),
                Text(
                  'TTL 使用默认值。主机记录填写对应子域名，DNS 生效后点击「验证并绑定」。',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                if (domains.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(
                    '已绑定：${domains.join('、')}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ],
              if (error != null) ...[
                const SizedBox(height: 12),
                Text(
                  error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: saving ? null : () => Navigator.pop(context),
          child: Text(boundUrl == null ? '取消' : '完成'),
        ),
        if (!loading && target == null)
          TextButton(onPressed: _load, child: const Text('重试')),
        if (target != null && boundUrl == null)
          FilledButton(
            onPressed: saving || name.text.trim().isEmpty ? null : _bind,
            child: Text(saving ? '验证并绑定中…' : '验证并绑定'),
          ),
      ],
    ),
  );
}
