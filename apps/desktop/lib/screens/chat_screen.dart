import '../core/auto_refresh.dart';

import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

import '../core/app_controller.dart';
import '../core/backend_client.dart';
import '../core/json.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

const _templateLoadTimeout = Duration(seconds: 12);
const _starterTemplateBatchSize = 6;

class ChatScreen extends StatefulWidget {
  const ChatScreen({this.initialChatId, super.key});

  final String? initialChatId;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> with AutoRefresh<ChatScreen> {
  @override
  Future<void> refreshAutomatically() => _loadStarterTemplates(silent: true);
  final input = TextEditingController();
  final scroll = ScrollController();
  StreamSubscription<BackendEvent>? subscription;
  JsonMap? conversation;
  JsonMap agent = {'state': 'stopped'};
  List<JsonMap> attachments = [];
  String? selectedId;
  String? error;
  bool busy = false;
  bool initialized = false;
  List<JsonMap>? starterTemplates;
  String? starterTemplateError;
  String starterTemplateCategory = '全部';
  int shownStarterTemplateCount = 0;
  Timer? starterTemplateReveal;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!initialized) {
      initialized = true;
      final controller = AppScope.of(context, listen: false);
      subscription = controller.backend.events.listen(_onEvent);
      _loadInitial();
      _loadStarterTemplates();
      final draft = controller.takeChatDraft();
      if (widget.initialChatId != null) {
        _openChat(widget.initialChatId!, draft: draft);
      } else if (draft != null) {
        _newChat();
        _setInput(draft);
      }
    }
  }

  Future<void> _loadInitial() async {
    final controller = AppScope.of(context, listen: false);
    try {
      final value = await controller.invoke('getAgentStatus');
      if (mounted) {
        setState(() => agent = jsonMap(value));
      }
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    }
  }

  Future<void> _loadStarterTemplates({bool silent = false}) async {
    if (mounted) {
      setState(() {
        if (!silent) starterTemplates = null;
        starterTemplateError = null;
      });
    }
    try {
      final catalog = jsonMap(
        await AppScope.of(
          context,
          listen: false,
        ).invoke('getTemplates').timeout(_templateLoadTimeout),
      );
      final templates = jsonList(catalog['templates'])
        ..sort(
          (a, b) =>
              intValue(b['deployCount']).compareTo(intValue(a['deployCount'])),
        );
      if (mounted) {
        setState(() {
          starterTemplates = templates;
          if (!silent) {
            shownStarterTemplateCount = min(
            _starterTemplateBatchSize,
            templates.length,
          );
          }
          if (!_starterTemplateCategories(templates)
              .contains(starterTemplateCategory)) {
            starterTemplateCategory = '全部';
          }
        });
        if (!silent) _revealStarterTemplates();
      }
    } catch (exception) {
      if (mounted) {
        setState(() {
          starterTemplates = const [];
          starterTemplateError = exception is TimeoutException
              ? '模板加载超时'
              : '模板暂时不可用';
        });
      }
    }
  }

  List<String> _starterTemplateCategories(List<JsonMap> templates) {
    final categories =
        templates
            .map((template) => stringValue(template['category']))
            .where((category) => category.isNotEmpty)
            .toSet()
            .toList()
          ..sort();
    return ['全部', ...categories];
  }

  List<JsonMap> _filteredStarterTemplates() {
    final templates = starterTemplates ?? const <JsonMap>[];
    if (starterTemplateCategory == '全部') return templates;
    return templates
        .where(
          (template) =>
              stringValue(template['category']) == starterTemplateCategory,
        )
        .toList();
  }

  void _revealStarterTemplates() {
    starterTemplateReveal?.cancel();
    starterTemplateReveal = Timer.periodic(const Duration(milliseconds: 90), (
      timer,
    ) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      final total = _filteredStarterTemplates().length;
      if (shownStarterTemplateCount >= total) {
        timer.cancel();
        return;
      }
      setState(() {
        shownStarterTemplateCount = min(
          shownStarterTemplateCount + _starterTemplateBatchSize,
          total,
        );
      });
    });
  }

  void _selectStarterTemplateCategory(String category) {
    if (category == starterTemplateCategory) return;
    final total = (starterTemplates ?? const <JsonMap>[])
        .where(
          (template) =>
              category == '全部' || stringValue(template['category']) == category,
        )
        .length;
    setState(() {
      starterTemplateCategory = category;
      shownStarterTemplateCount = min(_starterTemplateBatchSize, total);
    });
    _revealStarterTemplates();
  }

  void _onEvent(BackendEvent event) {
    if (!mounted) return;
    if (event.channel == 'helios:agent-status') {
      setState(() => agent = jsonMap(event.data));
      return;
    }
    if (event.channel != 'helios:chat-event') return;
    final payload = jsonMap(event.data);
    final type = stringValue(payload['type']);
    if (type == 'index') return;
    final eventId = type == 'snapshot'
        ? stringValue(jsonMap(payload['conversation'])['id'])
        : stringValue(payload['conversationId']);
    if (type == 'deleted' && eventId == selectedId) {
      _newChat();
      return;
    }
    if (type == 'archived' && eventId == selectedId) {
      _newChat();
      return;
    }
    if (eventId != selectedId) return;
    setState(() {
      if (type == 'snapshot') {
        conversation = jsonMap(payload['conversation']);
        busy =
            boolValue(
              jsonList(conversation?['messages']).lastOrNull?['pending'],
            ) &&
            jsonList(conversation?['questions']).isEmpty;
      } else if (type == 'delta') {
        _patchAssistant(text: stringValue(payload['text']), pending: true);
      } else if (type == 'trace') {
        _patchAssistant(trace: jsonList(payload['items']), pending: true);
      } else if (type == 'question') {
        conversation = {...?conversation, 'questions': payload['questions']};
        busy = false;
      } else if (type == 'error') {
        _patchAssistant(
          pending: false,
          messageError: stringValue(payload['message']),
        );
        busy = false;
      } else if (type == 'waiting' || type == 'done' || type == 'cancelled') {
        _patchAssistant(pending: false);
        busy = false;
      }
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (scroll.hasClients) {
        scroll.animateTo(
          scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _patchAssistant({
    String? text,
    List<JsonMap>? trace,
    bool? pending,
    String? messageError,
  }) {
    final current = conversation;
    if (current == null) return;
    final messages = jsonList(current['messages'])
        .map((item) => {...item})
        .toList();
    for (var i = messages.length - 1; i >= 0; i--) {
      if (messages[i]['role'] != 'assistant') continue;
      if (text != null) messages[i]['text'] = text;
      if (trace != null) messages[i]['trace'] = trace;
      if (pending != null) messages[i]['pending'] = pending;
      if (messageError != null) messages[i]['error'] = messageError;
      break;
    }
    conversation = {...current, 'messages': messages};
  }

  Future<void> _openChat(String id, {String? draft}) async {
    setState(() {
      selectedId = id;
      conversation = null;
      if (draft != null) {
        input.text = draft;
        input.selection = TextSelection.collapsed(offset: input.text.length);
      }
    });
    try {
      final result = await AppScope.of(
        context,
        listen: false,
      ).invoke('getChat', [id]);
      if (mounted) setState(() => conversation = jsonMap(result));
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    }
  }

  void _newChat() {
    if (!mounted) return;
    setState(() {
      selectedId = null;
      conversation = null;
      attachments = [];
      busy = false;
      error = null;
      input.clear();
    });
  }

  Future<void> _send() async {
    final text = input.text.trim();
    if (!_canSend || text.isEmpty && attachments.isEmpty) return;
    final id = selectedId ?? _uuid();
    setState(() {
      selectedId = id;
      busy = true;
      input.clear();
    });
    final files = attachments;
    attachments = [];
    try {
      await AppScope.of(
        context,
        listen: false,
      ).invoke('sendChatMessage', [id, text, files]);
    } catch (exception) {
      if (mounted) {
        setState(() {
          busy = false;
          error = exception.toString();
        });
      }
    }
  }

  Future<void> _attach() async {
    try {
      final picked = await AppScope.of(
        context,
        listen: false,
      ).backend.pickChatFiles();
      if (!mounted) return;
      setState(() {
        final paths = attachments.map((item) => item['path']).toSet();
        for (final file in picked) {
          if (attachments.length >= 8 || paths.contains(file['path'])) continue;
          attachments.add(file);
          paths.add(file['path']);
        }
      });
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    }
  }

  Future<void> _pickLocalSource() async {
    try {
      final path = await AppScope.of(
        context,
        listen: false,
      ).backend.pickLocalSource();
      if (!mounted || path == null || path.trim().isEmpty) return;
      _setInput(
        [
          '请将以下本地源代码部署到 Sealos。',
          '本地路径：${path.trim()}',
          '请先分析项目结构、构建方式、启动命令和所需环境变量；如果存在不确定项，先向我确认，再开始部署。',
        ].join('\n'),
      );
    } catch (exception) {
      if (mounted) setState(() => error = '无法选择本地源代码：$exception');
    }
  }

  Future<void> _renameChat() async {
    final id = selectedId;
    if (id == null) return;
    final title = TextEditingController(
      text: stringValue(conversation?['title'], '新对话'),
    );
    final nextTitle = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('重命名对话'),
        content: TextField(
          controller: title,
          autofocus: true,
          maxLength: 42,
          textInputAction: TextInputAction.done,
          onSubmitted: (value) => Navigator.of(dialogContext).pop(value),
          decoration: const InputDecoration(hintText: '输入对话标题'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(title.text),
            child: const Text('保存'),
          ),
        ],
      ),
    );
    title.dispose();
    if (nextTitle == null || nextTitle.trim().isEmpty || !mounted) return;
    try {
      await AppScope.of(
        context,
        listen: false,
      ).invoke('renameChat', [id, nextTitle]);
      if (mounted && selectedId == id) {
        setState(
          () => conversation = {...?conversation, 'title': nextTitle.trim()},
        );
      }
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    }
  }

  Future<void> _archiveChat() async {
    final id = selectedId;
    if (id == null) return;
    try {
      await AppScope.of(context, listen: false).invoke('archiveChat', [id]);
      if (mounted && selectedId == id) _newChat();
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    }
  }

  bool get _generating {
    final messages = jsonList(conversation?['messages']);
    return messages.isNotEmpty &&
        messages.last['role'] == 'assistant' &&
        boolValue(messages.last['pending']);
  }

  bool get _canSend =>
      (stringValue(agent['state']) == 'ready' ||
          boolValue(agent['localExecutor'])) &&
      !busy &&
      !_generating &&
      jsonList(conversation?['questions']).isEmpty;

  @override
  void dispose() {
    starterTemplateReveal?.cancel();
    subscription?.cancel();
    input.dispose();
    scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final messages = jsonList(conversation?['messages']);
    final chatting = messages.isNotEmpty || selectedId != null;
    return Material(
      color: context.helios.surface,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final inset = max(24.0, (constraints.maxWidth - 820) / 2);
          if (!chatting) return _starterView(constraints);
          return Column(
            children: [
              _chatHeader(inset),
              Expanded(
                child: ListView.builder(
                  controller: scroll,
                  padding: EdgeInsets.fromLTRB(inset, 30, inset, 24),
                  itemCount:
                      messages.length +
                      jsonList(conversation?['questions']).length,
                  itemBuilder: (context, index) {
                    if (index < messages.length) {
                      return _message(messages[index]);
                    }
                    return _question(
                      jsonList(conversation?['questions'])[index -
                          messages.length],
                    );
                  },
                ),
              ),
              if (error != null)
                Padding(
                  padding: EdgeInsets.fromLTRB(inset, 0, inset, 9),
                  child: ErrorBanner(
                    message: error!,
                    onClose: () => setState(() => error = null),
                  ),
                ),
              if (agent['state'] != 'ready' &&
                  !boolValue(agent['localExecutor']))
                Padding(
                  padding: EdgeInsets.fromLTRB(inset, 0, inset, 8),
                  child: _agentNotice(),
                ),
              _composer(true, inset),
              const SizedBox(height: 18),
            ],
          );
        },
      ),
    );
  }

  Widget _chatHeader(double inset) {
    final colors = context.helios;
    final title = stringValue(conversation?['title'], '新对话');
    final isMacOS = defaultTargetPlatform == TargetPlatform.macOS;
    final header = Container(
      height: 56,
      // Keep the conversation title at the main content edge, like the
      // surrounding page headers. The message column can remain centered.
      padding: const EdgeInsets.fromLTRB(24, 0, 5, 0),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: colors.line)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Row(
              children: [
                Flexible(
                  fit: FlexFit.loose,
                  child: Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ),
                const SizedBox(width: 8),
                PopupMenuButton<String>(
                  tooltip: '对话操作',
                  icon: const Icon(Icons.more_horiz, size: 20),
                  onSelected: (value) {
                    if (value == 'rename') {
                      unawaited(_renameChat());
                    } else if (value == 'archive') {
                      unawaited(_archiveChat());
                    }
                  },
                  itemBuilder: (context) => const [
                    PopupMenuItem(
                      value: 'rename',
                      child: ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(Icons.edit_outlined, size: 19),
                        title: Text('重命名对话'),
                      ),
                    ),
                    PopupMenuItem(
                      value: 'archive',
                      child: ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(Icons.archive_outlined, size: 19),
                        title: Text('归档对话'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (stringValue(conversation?['projectName']).isNotEmpty)
            IconButton(
              tooltip: '打开关联 Project',
              onPressed: () => AppScope.of(context, listen: false).openDetail(
                DetailRoute(
                  'project',
                  stringValue(conversation?['projectName']),
                ),
              ),
              icon: const Icon(Icons.layers_outlined, size: 20),
            ),
        ],
      ),
    );
    if (!isMacOS) return header;

    return SizedBox(
      height: 54,
      child: OverflowBox(
        minHeight: 56,
        maxHeight: 56,
        alignment: Alignment.topCenter,
        child: Transform.translate(offset: const Offset(0, -4), child: header),
      ),
    );
  }

  Widget _starterView(BoxConstraints constraints) {
    final width = min(720.0, max(0.0, constraints.maxWidth - 40));
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
        child: SizedBox(
          width: width,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('你想完成什么？', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 12),
              _starterScenarios(),
              const SizedBox(height: 18),
              if (error != null) ...[
                ErrorBanner(
                  message: error!,
                  onClose: () => setState(() => error = null),
                ),
                const SizedBox(height: 9),
              ],
              if (agent['state'] != 'ready' &&
                  !boolValue(agent['localExecutor'])) ...[
                _agentNotice(),
                const SizedBox(height: 8),
              ],
              _composer(false, 0),
              const SizedBox(height: 13),
              _starterCatalog(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _starterScenarios() {
    const scenarios = <(IconData, String, String, String)>[
      (
        Icons.code_outlined,
        '部署 GitHub 项目',
        '从仓库地址开始',
        '帮我部署一个 GitHub 项目，请先向我确认仓库地址',
      ),
      (Icons.folder_open_outlined, '部署本地源代码', '选择文件夹或文件', ''),
      (
        Icons.storefront_outlined,
        '从应用商店部署',
        '选择模板快速启动',
        '帮我从 Sealos 应用商店部署一个应用',
      ),
      (
        Icons.storage_outlined,
        '启动一个数据库',
        'PostgreSQL、MySQL、Redis',
        '帮我启动一个数据库',
      ),
    ];
    return Column(
      children: [
        for (final scenario in scenarios) ...[
          _StarterScenario(
            icon: scenario.$1,
            title: scenario.$2,
            subtitle: scenario.$3,
            onTap: scenario.$2 == '部署本地源代码'
                ? () => unawaited(_pickLocalSource())
                : () => _setInput(scenario.$4),
          ),
          if (scenario != scenarios.last) const Divider(height: 1),
        ],
      ],
    );
  }

  Widget _starterCatalog() {
    final templates = starterTemplates;
    final categories = templates == null
        ? const ['全部']
        : _starterTemplateCategories(templates);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: 30,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: categories.length,
            separatorBuilder: (_, _) => const SizedBox(width: 16),
            itemBuilder: (context, index) {
              final category = categories[index];
              return _StarterCategoryTab(
                label: category,
                selected: starterTemplateCategory == category,
                onTap: () => _selectStarterTemplateCategory(category),
              );
            },
          ),
        ),
        const SizedBox(height: 8),
        _starterTemplateCards(),
      ],
    );
  }

  Widget _starterTemplateCards() {
    final templates = starterTemplates;
    if (templates == null) {
      return const SizedBox(
        height: 108,
        child: Center(
          child: SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 1.8),
          ),
        ),
      );
    }
    if (templates.isEmpty) {
      return Row(
        children: [
          Expanded(
            child: Text(
              starterTemplateError ?? '暂无可用模板',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          const SizedBox.shrink(),
        ],
      );
    }
    final filtered = _filteredStarterTemplates();
    final shown = filtered.take(shownStarterTemplateCount).toList();
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 620 ? 3 : 2;
        final width = (constraints.maxWidth - (columns - 1) * 8) / columns;
        return Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final template in shown)
              SizedBox(
                width: width,
                child: _StarterTemplateCard(
                  template: template,
                  onTap: () => _setInput(
                    '帮我从应用商店部署 ${stringValue(template['name'])} 模板',
                  ),
                  onOpenDetail: stringValue(template['detailUrl']).isEmpty
                      ? null
                      : () => AppScope.of(
                          context,
                          listen: false,
                        ).invoke('openExternal', [template['detailUrl']]),
                ),
              ),
            if (shown.length < filtered.length)
              SizedBox(
                width: width,
                height: 154,
                child: const Center(
                  child: SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 1.8),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }

  Widget _agentNotice() {
    final colors = context.helios;
    final failed = agent['state'] == 'error';
    return Row(
      children: [
        Icon(
          failed ? Icons.error_outline : Icons.hourglass_top,
          size: 15,
          color: failed ? colors.red : colors.muted,
        ),
        const SizedBox(width: 7),
        Expanded(
          child: SelectableText(
            stringValue(agent['detail'], failed ? 'AI 服务不可用' : '正在启动 AI 服务…'),
            style: Theme.of(context).textTheme.bodySmall
                ?.copyWith(color: failed ? colors.red : colors.muted),
          ),
        ),
      ],
    );
  }

  void _setInput(String value) {
    setState(() {
      input.text = value;
      input.selection = TextSelection.collapsed(offset: value.length);
    });
  }

  Future<void> _openChatLink(String? href) async {
    final uri = href == null ? null : Uri.tryParse(href);
    if (uri == null || (uri.scheme != 'http' && uri.scheme != 'https')) return;
    try {
      await AppScope.of(
        context,
        listen: false,
      ).invoke('openExternal', [uri.toString()]);
    } catch (exception) {
      if (mounted) setState(() => error = '无法打开链接：$exception');
    }
  }

  Widget _message(JsonMap message) {
    final colors = context.helios;
    final assistant = message['role'] == 'assistant';
    return Align(
      alignment: assistant ? Alignment.centerLeft : Alignment.centerRight,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 760),
        margin: const EdgeInsets.only(bottom: 20),
        padding: assistant
            ? EdgeInsets.zero
            : const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: assistant
            ? null
            : BoxDecoration(
                color: colors.panel,
                border: Border.all(color: colors.line),
                borderRadius: BorderRadius.circular(6),
              ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (assistant) _trace(message),
            if (!assistant && jsonList(message['attachments']).isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final file in jsonList(message['attachments']))
                      Chip(
                        avatar: const Icon(
                          Icons.insert_drive_file_outlined,
                          size: 15,
                        ),
                        label: Text(
                          '${file['filename']}  ${_formatSize(intValue(file['size']))}',
                        ),
                      ),
                  ],
                ),
              ),
            if (stringValue(message['error']).isNotEmpty)
              Text(
                stringValue(message['error']),
                style: TextStyle(color: colors.red),
              )
            else if (assistant)
              MarkdownBody(
                data: stringValue(
                  message['text'],
                  boolValue(message['pending']) ? '正在思考…' : '',
                ),
                selectable: true,
                styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context))
                    .copyWith(
                      a: TextStyle(
                        color: colors.link,
                        decoration: TextDecoration.underline,
                        decorationColor: colors.link,
                      ),
                    ),
                onTapLink: (_, href, _) => unawaited(_openChatLink(href)),
              )
            else
              SelectableText(stringValue(message['text'])),
            if (assistant &&
                !boolValue(message['pending']) &&
                stringValue(message['text']).isNotEmpty)
              Align(
                alignment: Alignment.centerRight,
                child: IconButton(
                  tooltip: '复制原文',
                  onPressed: () => AppScope.of(
                    context,
                    listen: false,
                  ).invoke('copyText', [message['text']]),
                  icon: const Icon(Icons.content_copy, size: 15),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _trace(JsonMap message) {
    final trace = jsonList(message['trace']);
    if (trace.isEmpty) return const SizedBox.shrink();
    return ExpansionTile(
      key: ValueKey(
        'trace-${stringValue(message['id'])}-${boolValue(message['pending'])}',
      ),
      initiallyExpanded: boolValue(message['pending']),
      maintainState: true,
      tilePadding: EdgeInsets.zero,
      childrenPadding: const EdgeInsets.only(bottom: 10),
      title: Text(
        boolValue(message['pending']) ? '正在执行' : '执行过程',
        style: Theme.of(context).textTheme.bodySmall,
      ),
      children: [
        SelectionArea(
          child: Column(
            children: [
              for (final item in trace)
                ListTile(
                  dense: true,
                  contentPadding: const EdgeInsets.only(left: 8),
                  leading: Icon(
                    item['type'] == 'thinking'
                        ? Icons.psychology_outlined
                        : Icons.terminal,
                    size: 17,
                  ),
                  title: Text(
                    stringValue(item['text'], stringValue(item['label'])),
                  ),
                  subtitle: stringValue(item['detail']).isEmpty
                      ? null
                      : Text(
                          stringValue(item['detail']),
                          maxLines: 6,
                          overflow: TextOverflow.ellipsis,
                        ),
                  trailing: item['status'] == null
                      ? null
                      : StatusBadge(stringValue(item['status'])),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _question(JsonMap question) {
    return _QuestionCard(
      key: ValueKey('question-${question['requestId']}'),
      question: question,
      busy: busy,
      onOption: (optionId) => _respond(question, optionId: optionId),
      onText: (text) => _respond(question, text: text),
    );
  }

  Future<void> _respond(
    JsonMap question, {
    String? optionId,
    String? text,
  }) async {
    if (selectedId == null || text != null && text.isEmpty) return;
    setState(() => busy = true);
    try {
      await AppScope.of(context, listen: false).invoke('respondChat', [
        selectedId,
        [
          {
            'requestId': question['requestId'],
            'optionId': ?optionId,
            'text': ?text,
          },
        ],
      ]);
    } catch (exception) {
      if (mounted) {
        setState(() {
          busy = false;
          error = exception.toString();
        });
      }
    }
  }

  Widget _composer(bool chatting, double inset) {
    final colors = context.helios;
    final projectChat = stringValue(conversation?['projectName']).isNotEmpty;
    return Container(
      constraints: const BoxConstraints(maxWidth: 780),
      margin: EdgeInsets.symmetric(horizontal: inset),
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border.all(color: colors.lineStrong),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        children: [
          if (attachments.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 10, 10, 0),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final file in attachments)
                      InputChip(
                        label: Text(stringValue(file['filename'])),
                        onDeleted: () =>
                            setState(() => attachments.remove(file)),
                      ),
                  ],
                ),
              ),
            ),
          TextField(
            controller: input,
            minLines: chatting ? 1 : 4,
            maxLines: 6,
            textInputAction: TextInputAction.newline,
            decoration: InputDecoration(
              // The shared search-field theme caps height at 36px.
              // Let the multiline composer size itself from its line count.
              constraints: const BoxConstraints(),
              hintText: projectChat
                  ? '可创建容器、数据库，调整网络、扩缩容或查看运行状态…'
                  : chatting
                  ? '继续说…'
                  : '描述任务，或粘贴 Git 仓库地址…',
              border: InputBorder.none,
              enabledBorder: InputBorder.none,
              focusedBorder: InputBorder.none,
              filled: false,
              contentPadding: const EdgeInsets.fromLTRB(14, 13, 14, 8),
            ),
            onChanged: (_) => setState(() {}),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 0, 8, 7),
            child: Row(
              children: [
                IconButton(
                  tooltip: '添加文件',
                  onPressed: _canSend && attachments.length < 8
                      ? _attach
                      : null,
                  icon: const Icon(Icons.attach_file, size: 19),
                ),
                const Spacer(),
                if (_generating)
                  IconButton.filled(
                    tooltip: '停止生成',
                    style: IconButton.styleFrom(
                      backgroundColor: colors.accent,
                      foregroundColor: Colors.white,
                      disabledBackgroundColor: colors.hover,
                      disabledForegroundColor: colors.subtle,
                    ),
                    onPressed: selectedId == null
                        ? null
                        : () => AppScope.of(
                            context,
                            listen: false,
                          ).invoke('cancelChat', [selectedId]),
                    icon: const Icon(Icons.stop, size: 18),
                  )
                else
                  IconButton.filled(
                    tooltip: '发送',
                    style: IconButton.styleFrom(
                      backgroundColor: colors.accent,
                      foregroundColor: Colors.white,
                      disabledBackgroundColor: colors.hover,
                      disabledForegroundColor: colors.subtle,
                    ),
                    onPressed:
                        _canSend &&
                            (input.text.trim().isNotEmpty ||
                                attachments.isNotEmpty)
                        ? _send
                        : null,
                    icon: const Icon(Icons.arrow_upward, size: 18),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StarterScenario extends StatelessWidget {
  const _StarterScenario({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          height: 46,
          child: Padding(
            padding: const EdgeInsets.only(left: 5, right: 2),
            child: Row(
              children: [
                Icon(icon, size: 17, color: colors.muted),
                const SizedBox(width: 11),
                Expanded(
                  child: Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(width: 6),
                IconButton(
                  tooltip: '开始',
                  onPressed: onTap,
                  icon: const Icon(Icons.arrow_forward, size: 17),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _StarterTemplateCard extends StatelessWidget {
  const _StarterTemplateCard({
    required this.template,
    required this.onTap,
    this.onOpenDetail,
  });

  final JsonMap template;
  final VoidCallback onTap;
  final VoidCallback? onOpenDetail;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    final screenshot = stringValue(template['screenshot']);
    final icon = stringValue(template['icon']);
    return Material(
      color: colors.panel,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(6),
        side: BorderSide(color: colors.line),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: onTap,
        child: SizedBox(
          height: 154,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: double.infinity,
                height: 58,
                child: ClipRRect(
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(6),
                  ),
                  child: screenshot.isEmpty
                      ? Container(
                          color: colors.canvas,
                          child: Icon(
                            Icons.dashboard_customize_outlined,
                            size: 18,
                            color: colors.muted,
                          ),
                        )
                      : Image.network(
                          screenshot,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => Container(
                            color: colors.canvas,
                            child: Icon(
                              Icons.dashboard_customize_outlined,
                              size: 18,
                              color: colors.muted,
                            ),
                          ),
                        ),
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(9, 7, 9, 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: icon.isEmpty
                                ? Container(
                                    width: 20,
                                    height: 20,
                                    color: colors.surface,
                                    child: Icon(
                                      Icons.apps,
                                      size: 13,
                                      color: colors.muted,
                                    ),
                                  )
                                : Image.network(
                                    icon,
                                    width: 20,
                                    height: 20,
                                    fit: BoxFit.cover,
                                    errorBuilder: (_, _, _) => const SizedBox(
                                      width: 20,
                                      height: 20,
                                      child: Icon(Icons.apps, size: 13),
                                    ),
                                  ),
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              stringValue(template['name']),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.labelLarge,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 5),
                      Text(
                        stringValue(template['description']),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const Spacer(),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              stringValue(template['category']),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.bodySmall
                                  ?.copyWith(color: colors.subtle),
                            ),
                          ),
                          if (onOpenDetail != null)
                            TextButton(
                              onPressed: onOpenDetail,
                              style: TextButton.styleFrom(
                                foregroundColor: colors.muted,
                                minimumSize: Size.zero,
                                padding: EdgeInsets.zero,
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                visualDensity: VisualDensity.compact,
                              ),
                              child: const Text('详情'),
                            ),
                        ],
                      ),
                    ],
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

class _StarterCategoryTab extends StatelessWidget {
  const _StarterCategoryTab({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Container(
          height: 28,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: selected ? colors.ink : colors.line,
                width: selected ? 2 : 1,
              ),
            ),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? colors.ink : colors.muted,
              fontSize: 12,
              fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        ),
      ),
    );
  }
}

class _QuestionCard extends StatefulWidget {
  const _QuestionCard({
    required this.question,
    required this.busy,
    required this.onOption,
    required this.onText,
    super.key,
  });

  final JsonMap question;
  final bool busy;
  final ValueChanged<String> onOption;
  final ValueChanged<String> onText;

  @override
  State<_QuestionCard> createState() => _QuestionCardState();
}

class _QuestionCardState extends State<_QuestionCard> {
  final freeform = TextEditingController();

  @override
  void dispose() {
    freeform.dispose();
    super.dispose();
  }

  void _submit() {
    final value = freeform.text.trim();
    if (!widget.busy && value.isNotEmpty) widget.onText(value);
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              stringValue(widget.question['prompt']),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final option in jsonList(widget.question['options']))
                  OutlinedButton(
                    onPressed: widget.busy
                        ? null
                        : () => widget.onOption(stringValue(option['id'])),
                    child: Text(stringValue(option['label'])),
                  ),
              ],
            ),
            if (boolValue(widget.question['allowFreeform']) ||
                jsonList(widget.question['options']).isEmpty) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: freeform,
                      enabled: !widget.busy,
                      onChanged: (_) => setState(() {}),
                      onSubmitted: (_) => _submit(),
                      decoration: const InputDecoration(hintText: '输入回复…'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: widget.busy || freeform.text.trim().isEmpty
                        ? null
                        : _submit,
                    child: const Text('发送'),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

String _uuid() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = bytes[6] & 0x0f | 0x40;
  bytes[8] = bytes[8] & 0x3f | 0x80;
  final hex = bytes
      .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

String _formatSize(int size) {
  if (size >= 1024 * 1024) {
    return '${(size / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
  if (size >= 1024) return '${(size / 1024).toStringAsFixed(1)} KB';
  return '$size B';
}
