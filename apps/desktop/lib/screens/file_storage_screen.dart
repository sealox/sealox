import '../core/auto_refresh.dart';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import '../core/json.dart';
import '../widgets/common.dart';

class FileStorageScreen extends StatefulWidget {
  const FileStorageScreen({required this.name, super.key});
  final String name;
  @override
  State<FileStorageScreen> createState() => _FileStorageScreenState();
}

class _FileStorageScreenState extends State<FileStorageScreen>
    with AutoRefresh<FileStorageScreen> {
  @override
  bool get canAutoRefresh => !busy;
  @override
  Future<void> refreshAutomatically() => _load(silent: true);

  List<JsonMap> objects = [];
  JsonMap info = {};
  final selected = <String>{};
  String prefix = '', query = '';
  String? error, activity;
  bool loading = true;
  bool get busy => loading || activity != null;
  int revision = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool silent = false}) async {
    final ticket = ++revision;
    final controller = AppScope.of(context, listen: false);
    setState(() {
      if (!silent) loading = true;
      error = null;
    });
    try {
      final results = await Future.wait([
        controller.invoke('getStorageInfo', [widget.name]),
        controller.invoke('listStorageObjects', [widget.name, prefix]),
      ]);
      if (!mounted || ticket != revision) return;
      setState(() {
        info = jsonMap(results[0]);
        objects = jsonList(results[1])
            .where(
              (o) =>
                  stringValue(o['name']) != prefix &&
                  stringValue(o['name']).isNotEmpty,
            )
            .toList();
        objects.sort((a, b) {
          final x = stringValue(a['name']), y = stringValue(b['name']);
          if (x.endsWith('/') != y.endsWith('/')) {
            return x.endsWith('/') ? -1 : 1;
          }
          return x.compareTo(y);
        });
        selected.removeWhere((key) => !objects.any((o) => o['name'] == key));
      });
    } catch (e) {
      if (mounted && ticket == revision) setState(() => error = e.toString());
    } finally {
      if (mounted && ticket == revision) setState(() => loading = false);
    }
  }

  Future<bool> _confirm(String title, String message) async =>
      await showDialog<bool>(
        context: context,
        builder: (dialog) => AlertDialog(
          title: Text(title),
          content: Text(message),
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
      ) ??
      false;

  Future<void> _run(String label, Future<void> Function() action) async {
    if (busy) return;
    setState(() {
      activity = label;
      error = null;
    });
    try {
      await action();
      if (mounted) await _load();
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => activity = null);
    }
  }

  Future<void> _upload() async {
    final controller = AppScope.of(context, listen: false);
    await _run('选择上传文件…', () async {
      final files = await openFiles();
      if (!mounted) return;
      for (var i = 0; i < files.length; i++) {
        final file = files[i];
        final key = '$prefix${file.name}';
        if (objects.any((o) => o['name'] == key)) {
          if (!await _confirm('覆盖文件', '${file.name} 已存在，是否覆盖？')) continue;
        }
        if (!mounted) return;
        setState(() => activity = '上传 ${i + 1}/${files.length}：${file.name}');
        await controller.invoke('uploadStorageFile', [
          widget.name,
          key,
          file.path,
        ]);
      }
    });
  }

  Future<void> _download(String key) async {
    final controller = AppScope.of(context, listen: false);
    await _run('下载文件…', () async {
      final location = await getSaveLocation(
        suggestedName: key.split('/').last,
      );
      if (location != null) {
        await controller.invoke('downloadStorageFile', [
          widget.name,
          key,
          location.path,
        ]);
      }
    });
  }

  Future<void> _folder() async {
    var folderName = '';
    final name = await showDialog<String>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('新建文件夹'),
        content: TextField(
          onChanged: (value) => folderName = value,
          autofocus: true,
          decoration: const InputDecoration(hintText: '文件夹名称'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialog),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () {
              final value = folderName.trim();
              if (value.isNotEmpty &&
                  !value.contains('/') &&
                  value != '.' &&
                  value != '..') {
                Navigator.pop(dialog, value);
              }
            },
            child: const Text('创建'),
          ),
        ],
      ),
    );
    if (!mounted || name == null) return;
    final controller = AppScope.of(context, listen: false);
    await _run('创建文件夹…', () async {
      await controller.invoke('createStorageFolder', [
        widget.name,
        '$prefix$name',
      ]);
    });
  }

  Future<void> _delete(List<String> keys) async {
    final controller = AppScope.of(context, listen: false);
    if (!await _confirm(
      '删除 ${keys.length} 项',
      '将永久删除所选文件；文件夹及其全部内容也会删除。此操作无法撤销。',
    )) {
      return;
    }
    if (!mounted) return;
    await _run('删除中…', () async {
      for (final key in keys) {
        await controller.invoke('deleteStorageObject', [widget.name, key]);
      }
    });
  }

  void _navigate(String path) {
    if (busy) return;
    setState(() {
      prefix = path;
      query = '';
    });
    _load();
  }

  String _size(int n) => n >= 1048576
      ? '${(n / 1048576).toStringAsFixed(1)} MB'
      : n >= 1024
      ? '${(n / 1024).toStringAsFixed(1)} KB'
      : '$n B';

  void _details(JsonMap object) {
    showDialog<void>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('文件详情'),
        content: SizedBox(
          width: 480,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SelectableText('路径：${object['name']}'),
              const SizedBox(height: 8),
              SelectableText('大小：${_size(intValue(object['size']))}'),
              const SizedBox(height: 8),
              SelectableText(
                '更新时间：${stringValue(object['lastModified'], '—')}',
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
  }

  @override
  Widget build(BuildContext context) {
    final visible = objects
        .where(
          (o) =>
              stringValue(o['name'])
                  .substring(prefix.length)
                  .toLowerCase()
                  .contains(query.toLowerCase()),
        )
        .toList();
    final parts = prefix.split('/').where((p) => p.isNotEmpty).toList();
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 10),
          child: Row(
            children: [
              IconButton(
                tooltip: '返回文件存储',
                onPressed: activity != null
                    ? null
                    : () => AppScope.of(context, listen: false).closeDetail(),
                icon: const Icon(Icons.arrow_back, size: 19),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  widget.name,
                  style: Theme.of(context).textTheme.titleLarge,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              TextButton.icon(
                onPressed: busy ? null : _folder,
                icon: const Icon(Icons.create_new_folder_outlined, size: 18),
                label: const Text('新建文件夹'),
              ),
              const SizedBox(width: 8),
              FilledButton.icon(
                onPressed: busy ? null : _upload,
                icon: const Icon(Icons.upload_file_outlined, size: 18),
                label: const Text('上传文件'),
              ),

            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Wrap(
              spacing: 24,
              runSpacing: 6,
              children: [
                SelectableText(
                  'Bucket：${stringValue(info['bucketName'], widget.name)}',
                ),
                Text(
                  '访问策略：${info['policy'] == 'private' ? '私有' : stringValue(info['policy'], '—')}',
                ),
                Text('创建时间：${stringValue(info['createdAt'], '—')}'),
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 8),
          child: Row(
            children: [
              Expanded(
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      TextButton(
                        onPressed: busy ? null : () => _navigate(''),
                        child: const Text('全部文件'),
                      ),
                      for (var i = 0; i < parts.length; i++) ...[
                        const Text('/'),
                        TextButton(
                          onPressed: busy
                              ? null
                              : () => _navigate(
                                  '${parts.take(i + 1).join('/')}/',
                                ),
                          child: Text(parts[i]),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              SizedBox(
                width: 220,
                child: TextField(
                  onChanged: (value) => setState(() => query = value),
                  decoration: const InputDecoration(
                    hintText: '搜索当前目录',
                    prefixIcon: Icon(Icons.search, size: 18),
                  ),
                ),
              ),
              if (selected.isNotEmpty)
                TextButton(
                  onPressed: busy ? null : () => _delete(selected.toList()),
                  child: Text('删除 ${selected.length} 项'),
                ),
            ],
          ),
        ),
        if (activity != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Row(
              children: [
                const SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                const SizedBox(width: 8),
                Expanded(child: Text(activity!)),
              ],
            ),
          ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.all(12),
            child: ErrorBanner(
              message: error!,
              onClose: () => setState(() => error = null),
            ),
          ),
        Expanded(
          child: loading
              ? const BrandLoading()
              : visible.isEmpty
              ? EmptyState(
                  icon: Icons.folder_open_outlined,
                  title: query.isEmpty ? '此目录暂无文件' : '没有匹配的文件',
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(24, 4, 24, 24),
                  itemCount: visible.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (context, i) {
                    final o = visible[i];
                    final key = stringValue(o['name']);
                    final folder = key.endsWith('/');
                    return SizedBox(
                      height: 44,
                      child: Row(
                        children: [
                          Checkbox(
                            value: selected.contains(key),
                            onChanged: busy
                                ? null
                                : (value) => setState(() {
                                    value == true
                                        ? selected.add(key)
                                        : selected.remove(key);
                                  }),
                          ),
                          Icon(
                            folder
                                ? Icons.folder_outlined
                                : Icons.insert_drive_file_outlined,
                            size: 18,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: InkWell(
                              onTap: busy
                                  ? null
                                  : () => folder ? _navigate(key) : _details(o),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 10,
                                ),
                                child: Text(
                                  key.substring(prefix.length),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ),
                          ),
                          SizedBox(
                            width: 90,
                            child: Text(
                              folder ? '文件夹' : _size(intValue(o['size'])),
                            ),
                          ),
                          if (!folder)
                            IconButton(
                              tooltip: '下载',
                              onPressed: busy ? null : () => _download(key),
                              icon: const Icon(
                                Icons.download_outlined,
                                size: 18,
                              ),
                            ),
                          IconButton(
                            tooltip: '删除',
                            onPressed: busy ? null : () => _delete([key]),
                            icon: const Icon(Icons.delete_outline, size: 18),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
