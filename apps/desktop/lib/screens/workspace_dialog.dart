import 'package:flutter/material.dart';

import '../core/app_controller.dart';
import '../core/json.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

class WorkspaceDialog extends StatefulWidget {
  const WorkspaceDialog({
    required this.controller,
    this.quota = const [],
    super.key,
  });

  final AppController controller;
  final List<JsonMap> quota;

  @override
  State<WorkspaceDialog> createState() => _WorkspaceDialogState();
}

class _WorkspaceDialogState extends State<WorkspaceDialog> {
  List<JsonMap>? items;
  JsonMap? details;
  String? selectedUid;
  String? error;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final result = await widget.controller.invoke<List<dynamic>>(
        'listWorkspaces',
      );
      final list = jsonList(result);
      final current = list
          .where((item) => boolValue(item['current']))
          .firstOrNull;
      if (!mounted) return;
      setState(() {
        items = list;
        if (!list.any((item) => item['uid'] == selectedUid)) {
          selectedUid = stringValue(
            current?['uid'],
            list.isEmpty ? '' : stringValue(list.first['uid']),
          );
        }
      });
      await _loadDetails();
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    }
  }

  Future<void> _loadDetails() async {
    final requestedUid = selectedUid;
    if (requestedUid?.isEmpty ?? true) return;
    try {
      final result = await widget.controller.invoke<JsonMap>(
        'getWorkspaceDetails',
        [requestedUid],
      );
      if (mounted && selectedUid == requestedUid) {
        setState(() => details = jsonMap(result));
      }
    } catch (exception) {
      if (mounted && selectedUid == requestedUid) {
        // Details are supplementary. Keep the selected workspace actionable
        // when an older Sealos region does not expose the details endpoint.
        final selected = items
            ?.where((item) => item['uid'] == requestedUid)
            .firstOrNull;
        setState(() {
          details = {
            'uid': requestedUid,
            'teamName': stringValue(selected?['teamName'], requestedUid ?? ''),
            'members': const <dynamic>[],
            'canRename': false,
            'canInvite': false,
          };
          error = exception.toString();
        });
      }
    }
  }

  Future<void> _create() async {
    final name = await _textDialog('新建工作空间', '工作空间名称');
    if (name == null) return;
    await _run(() => widget.controller.invoke('createWorkspace', [name]));
    await _load();
  }

  Future<void> _rename() async {
    final name = await _textDialog(
      '重命名工作空间',
      '新名称',
      initial: stringValue(details?['teamName']),
    );
    if (name == null) return;
    await _run(
      () => widget.controller.invoke('renameWorkspace', [selectedUid, name]),
    );
    await _load();
  }

  Future<void> _invite(String role) async {
    final link = await _run<String>(
      () => widget.controller.invoke<String>('getInviteLink', [
        selectedUid,
        role,
      ]),
    );
    if (link == null || !mounted) return;
    await widget.controller.invoke('copyText', [link]);
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('邀请链接已复制')));
    }
  }

  Future<T?> _run<T>(Future<T?> Function() task) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      return await task();
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
      return null;
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<String?> _textDialog(
    String title,
    String label, {
    String initial = '',
  }) async {
    final input = TextEditingController(text: initial);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: input,
          autofocus: true,
          decoration: InputDecoration(labelText: label),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, input.text.trim()),
            child: const Text('确认'),
          ),
        ],
      ),
    );
    input.dispose();
    return result?.isEmpty ?? true ? null : result;
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      child: SizedBox(
        width: 780,
        height: 560,
        child: Column(
          children: [
            SizedBox(
              height: 48,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '工作空间',
                        style: Theme.of(context).textTheme.bodyLarge,
                      ),
                    ),
                    IconButton(
                      tooltip: '新建工作空间',
                      style: IconButton.styleFrom(
                        fixedSize: const Size(32, 32),
                        minimumSize: const Size(32, 32),
                        padding: EdgeInsets.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        foregroundColor: context.helios.muted,
                      ),
                      onPressed: busy ? null : _create,
                      icon: const Icon(Icons.add, size: 18),
                    ),
                    const SizedBox(width: 8),
                    IconButton(
                      tooltip: '关闭',
                      style: IconButton.styleFrom(
                        fixedSize: const Size(32, 32),
                        minimumSize: const Size(32, 32),
                        padding: EdgeInsets.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        foregroundColor: context.helios.muted,
                      ),
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close, size: 18),
                    ),
                  ],
                ),
              ),
            ),
            const Divider(height: 1),
            if (error != null)
              Padding(
                padding: const EdgeInsets.all(12),
                child: ErrorBanner(
                  message: error!,
                  onClose: () => setState(() => error = null),
                ),
              ),
            Expanded(
              child: items == null
                  ? const BrandLoading()
                  : Row(
                      children: [
                        SizedBox(
                          width: 270,
                          child: ListView.builder(
                            padding: const EdgeInsets.all(10),
                            itemCount: items!.length,
                            itemBuilder: (context, index) {
                              final item = items![index];
                              final uid = stringValue(item['uid']);
                              return ListTile(
                                selected: uid == selectedUid,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                leading: const Icon(Icons.group_work_outlined),
                                title: Text(
                                  stringValue(
                                    item['teamName'],
                                    stringValue(item['id']),
                                  ),
                                ),
                                subtitle: Text(
                                  stringValue(
                                    item['roleLabel'],
                                    boolValue(item['isPrivate']) ? '个人' : '团队',
                                  ),
                                ),
                                trailing: boolValue(item['current'])
                                    ? const Icon(Icons.check, size: 18)
                                    : null,
                                onTap: () {
                                  setState(() {
                                    selectedUid = uid;
                                    details = null;
                                  });
                                  _loadDetails();
                                },
                              );
                            },
                          ),
                        ),
                        const VerticalDivider(width: 1),
                        Expanded(child: _detailsPane()),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _detailsPane() {
    final data = details;
    if (data == null) return const BrandLoading();
    final members = jsonList(data['members']);
    final isCurrentWorkspace =
        items?.any(
          (item) => item['uid'] == selectedUid && boolValue(item['current']),
        ) ??
        false;
    final quota = isCurrentWorkspace
        ? widget.quota.where((item) => !_isCudaQuota(item)).toList()
        : const <JsonMap>[];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(22, 16, 22, 0),
          child: FilledButton(
            onPressed: busy || selectedUid == null
                ? null
                : () async {
                    final switched = await _run<bool>(() async {
                      await widget.controller.changeWorkspace(selectedUid!);
                      return true;
                    });
                    if (switched == true && mounted) Navigator.pop(context);
                  },
            child: Text(
              items?.any(
                        (item) =>
                            item['uid'] == selectedUid &&
                            boolValue(item['current']),
                      ) ??
                      false
                  ? '当前工作空间'
                  : '切换到此工作空间',
            ),
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(22),
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      stringValue(data['teamName'], selectedUid ?? ''),
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                  ),
                  if (boolValue(data['canRename']))
                    IconButton(
                      tooltip: '重命名',
                      onPressed: busy ? null : _rename,
                      icon: const Icon(Icons.edit_outlined, size: 19),
                    ),
                ],
              ),
              const SizedBox(height: 5),
              Text(
                stringValue(data['myRoleLabel']),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 18),
              if (boolValue(data['canInvite']))
                Wrap(
                  spacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: busy ? null : () => _invite('developer'),
                      icon: const Icon(Icons.person_add_alt, size: 17),
                      label: const Text('邀请开发者'),
                    ),
                    OutlinedButton.icon(
                      onPressed: busy ? null : () => _invite('manager'),
                      icon: const Icon(
                        Icons.manage_accounts_outlined,
                        size: 17,
                      ),
                      label: const Text('邀请管理员'),
                    ),
                  ],
                ),
              if (isCurrentWorkspace) ...[
                const SizedBox(height: 24),
                const SectionTitle('资源配额'),
                if (quota.isEmpty)
                  Text(
                    '暂未获取到配额信息',
                    style: Theme.of(context).textTheme.bodySmall,
                  )
                else
                  for (final item in quota) _QuotaRow(item: item),
              ],
              const SizedBox(height: 24),
              const SectionTitle('成员'),
              for (final member in members)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: CircleAvatar(
                    child: Text(
                      stringValue(
                        member['nickname'],
                        '?',
                      ).characters.first.toUpperCase(),
                    ),
                  ),
                  title: Text(stringValue(member['nickname'])),
                  subtitle: Text(stringValue(member['roleLabel'])),
                ),
              const SizedBox(height: 24),
              const SizedBox(height: 10),
              TextButton.icon(
                onPressed: () => widget.controller.invoke('openExternal', [
                  'https://${stringValue(widget.controller.status?['regionDomain'], 'os.sealos.io')}/?openapp=system-costcenter',
                ]),
                icon: const Icon(Icons.bolt_outlined, size: 17),
                label: const Text('打开 Sealos 费用中心'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

String _quotaLabel(JsonMap item) {
  return switch (stringValue(item['type']).toLowerCase()) {
    'cpu' => 'CPU',
    'memory' => '内存',
    'storage' => '存储',
    final type when type.isNotEmpty => type,
    _ => '资源',
  };
}

bool _isCudaQuota(JsonMap item) {
  final resource = '${stringValue(item['type'])} ${stringValue(item['unit'])}'
      .toLowerCase();
  return resource.contains('gpu') ||
      resource.contains('cuda') ||
      resource.contains('nvidia');
}

IconData _quotaIcon(JsonMap item) => switch (_quotaLabel(item)) {
  'CPU' => Icons.developer_board_outlined,
  '内存' => Icons.memory_outlined,
  '存储' => Icons.storage_outlined,
  _ => Icons.speed_outlined,
};

class _QuotaRow extends StatelessWidget {
  const _QuotaRow({required this.item});

  final JsonMap item;

  @override
  Widget build(BuildContext context) {
    final unit = stringValue(item['unit']);
    final amount = [
      '${stringValue(item['usedText'])} / ${stringValue(item['limitText'])}',
      unit,
    ].where((part) => part.trim().isNotEmpty).join(' ');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(_quotaIcon(item), size: 17, color: context.helios.muted),
          const SizedBox(width: 9),
          Text(_quotaLabel(item), style: const TextStyle(fontSize: 13)),
          const Spacer(),
          Flexible(
            child: Text(
              amount,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall
                  ?.copyWith(color: context.helios.muted),
            ),
          ),
        ],
      ),
    );
  }
}
