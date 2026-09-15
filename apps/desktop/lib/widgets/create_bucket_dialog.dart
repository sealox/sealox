import 'package:flutter/material.dart';

class CreateBucketDialog extends StatefulWidget {
  const CreateBucketDialog({required this.create, super.key});
  final Future<void> Function(String name, String policy) create;

  @override
  State<CreateBucketDialog> createState() => _CreateBucketDialogState();
}

class _CreateBucketDialogState extends State<CreateBucketDialog> {
  final name = TextEditingController();
  final form = GlobalKey<FormState>();
  bool saving = false;
  String policy = 'private';
  String? error;

  @override
  void dispose() {
    name.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (saving || !form.currentState!.validate()) return;
    setState(() {
      saving = true;
      error = null;
    });
    try {
      await widget.create(name.text.trim(), policy);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() {
          saving = false;
          error = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !saving,
    child: AlertDialog(
      title: const Text('新建 Bucket'),
      titleTextStyle: Theme.of(context).textTheme.titleMedium
          ?.copyWith(fontSize: 16, fontWeight: FontWeight.normal),
      content: SizedBox(
        width: 420,
        child: Form(
          key: form,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Bucket 名称'),
              const SizedBox(height: 8),
              TextFormField(
                controller: name,
                autofocus: true,
                enabled: !saving,
                decoration: const InputDecoration(
                  hintText: '例如 my-files',
                  // The global 36px search-field constraint cannot fit errors.
                  constraints: BoxConstraints(minHeight: 40),
                  contentPadding: EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  errorMaxLines: 2,
                ),
                validator: (value) =>
                    RegExp(r'^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$')
                        .hasMatch((value ?? '').trim())
                    ? null
                    : '请输入有效名称，首尾须为字母或数字',
                onFieldSubmitted: (_) => submit(),
              ),
              const SizedBox(height: 6),
              Text(
                '3–63 位小写字母、数字或连字符',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 12),
              const Text('访问权限'),
              const SizedBox(height: 8),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'private', label: Text('私密')),
                  ButtonSegment(value: 'publicRead', label: Text('公开')),
                ],
                selected: {policy},
                onSelectionChanged: saving
                    ? null
                    : (values) => setState(() => policy = values.first),
              ),
              const SizedBox(height: 6),
              Text(
                policy == 'private'
                    ? '仅授权用户可访问，创建后可修改。'
                    : '任何人可通过链接读取文件，写入仍需授权。',
                style: Theme.of(context).textTheme.bodySmall,
              ),
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
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: saving ? null : submit,
          child: Text(saving ? '创建中…' : '创建'),
        ),
      ],
    ),
  );
}
