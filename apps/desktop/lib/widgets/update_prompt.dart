import 'dart:async';

import 'package:flutter/material.dart';

import '../core/backend_client.dart';
import '../core/json.dart';
import 'common.dart';

class UpdatePrompt extends StatefulWidget {
  const UpdatePrompt({required this.child, super.key});
  final Widget child;
  @override
  State<UpdatePrompt> createState() => _UpdatePromptState();
}

class _UpdatePromptState extends State<UpdatePrompt> {
  StreamSubscription<BackendEvent>? subscription;
  final seen = <String>{};
  final status = ValueNotifier<JsonMap>({});
  bool showing = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (subscription != null) return;
    final controller = AppScope.of(context, listen: false);
    subscription = controller.backend.events.listen((event) {
      if (event.channel == 'helios:update-event') receive(jsonMap(event.data));
    });
    controller
        .invoke('getUpdateStatus')
        .then((value) => receive(jsonMap(value)))
        .catchError((Object _) {});
  }

  void receive(JsonMap value) {
    if (!mounted) return;
    status.value = value;
    final version = stringValue(value['latestVersion']);
    if (showing ||
        !boolValue(value['available']) ||
        value['phase'] != 'available' ||
        !seen.add(version)) {
      return;
    }
    showing = true;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      final controller = AppScope.of(context, listen: false);
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialog) => ValueListenableBuilder<JsonMap>(
          valueListenable: status,
          builder: (_, data, _) {
            final downloading = data['phase'] == 'downloading';
            final ready = data['phase'] == 'ready';
            return AlertDialog(
              title: Text('发现新版本 ${stringValue(data['latestVersion'])}'),
              titleTextStyle: Theme.of(context).textTheme.titleMedium,
              content: SizedBox(
                width: 460,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('当前版本 ${stringValue(data['currentVersion'])}'),
                      if (stringValue(data['notes']).isNotEmpty) ...[
                        const SizedBox(height: 12),
                        Text(stringValue(data['notes'])),
                      ],
                      const SizedBox(height: 12),
                      Text(
                        ready
                            ? '安装包已打开。macOS 请将 Sealos 拖到「应用程序」替换旧版本；Windows 请按安装向导完成更新。'
                            : '下载完成后会校验并打开安装包，由你完成安装。',
                      ),
                      if (downloading) ...[
                        const SizedBox(height: 12),
                        LinearProgressIndicator(
                          value: doubleValue(data['progress']),
                        ),
                        Text(
                          '下载中 ${(doubleValue(data['progress']) * 100).round()}%',
                        ),
                      ],
                      if (stringValue(data['error']).isNotEmpty) ...[
                        const SizedBox(height: 12),
                        Text(
                          stringValue(data['error']),
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(dialog),
                  child: Text(
                    downloading
                        ? '后台下载'
                        : ready
                        ? '完成'
                        : '稍后提醒',
                  ),
                ),
                FilledButton(
                  onPressed: downloading || boolValue(data['checking'])
                      ? null
                      : () async {
                          try {
                            await controller.invoke('downloadUpdate');
                          } catch (e) {
                            if (mounted) {
                              status.value = {
                                ...status.value,
                                'error': e.toString(),
                              };
                            }
                          }
                        },
                  child: Text(
                    ready
                        ? '重新打开安装包'
                        : downloading
                        ? '下载中…'
                        : '立即更新',
                  ),
                ),
              ],
            );
          },
        ),
      );
      showing = false;
    });
  }

  @override
  void dispose() {
    subscription?.cancel();
    status.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
