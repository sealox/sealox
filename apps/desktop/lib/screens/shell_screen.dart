import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../core/app_controller.dart';
import '../core/backend_client.dart';
import '../core/json.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import 'account_screen.dart';
import 'chat_screen.dart';
import 'detail_screen.dart';
import 'resource_list_screen.dart';
import 'templates_screen.dart';
import 'workspace_dialog.dart';

enum _RecentView { chats, projects }

class ShellScreen extends StatefulWidget {
  const ShellScreen({super.key});

  // Base standard shared with the macOS host traffic lights.
  static const macTitleBarControlTop = 9.0;

  static const tabs = <(DesktopTab, IconData, String)>[
    (DesktopTab.home, Icons.add_comment_outlined, '新对话'),
    (DesktopTab.projects, Icons.layers_outlined, '项目'),
  ];

  static const resourceTabs = <(DesktopTab, String)>[
    (DesktopTab.apps, '应用'),
    (DesktopTab.databases, '数据库'),
    (DesktopTab.storage, '文件存储'),
  ];

  @override
  State<ShellScreen> createState() => _ShellScreenState();
}

class _ShellScreenState extends State<ShellScreen> {
  bool collapsed = false;
  bool resourcesExpanded = false;
  _RecentView recentView = _RecentView.chats;
  List<JsonMap>? recentChats;
  StreamSubscription<BackendEvent>? chatEvents;
  String? workspaceId;
  String? requestedChatId;
  int chatRevision = 0;
  int observedChatNavigationRevision = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final controller = AppScope.of(context);
    chatEvents ??= controller.backend.events.listen(_onBackendEvent);
    final nextWorkspace = stringValue(
      controller.status?['workspace'],
      stringValue(controller.status?['namespace']),
    );
    if (nextWorkspace != workspaceId) {
      workspaceId = nextWorkspace;
      recentChats = null;
      requestedChatId = null;
      chatRevision++;
      unawaited(_loadRecentChats(controller, nextWorkspace));
    }
    if (controller.chatNavigationRevision != observedChatNavigationRevision) {
      observedChatNavigationRevision = controller.chatNavigationRevision;
      requestedChatId = controller.chatRequestedId;
      chatRevision++;
    }
  }

  Future<void> _loadRecentChats(
    AppController controller,
    String requestedWorkspace,
  ) async {
    try {
      final result = await controller.backend.call<List<dynamic>>('listChats');
      if (!mounted || workspaceId != requestedWorkspace) return;
      setState(() => recentChats = _sortedChats(jsonList(result)));
    } catch (_) {
      if (mounted && workspaceId == requestedWorkspace) {
        setState(() => recentChats = const []);
      }
    }
  }

  void _onBackendEvent(BackendEvent event) {
    if (!mounted || event.channel != 'helios:chat-event') return;
    final payload = jsonMap(event.data);
    if (payload['type'] != 'index' || payload['workspaceId'] != workspaceId) {
      return;
    }
    setState(() => recentChats = _sortedChats(jsonList(payload['items'])));
  }

  List<JsonMap> _sortedChats(List<JsonMap> items) {
    return [...items]..sort(
      (a, b) =>
          stringValue(b['updatedAt']).compareTo(stringValue(a['updatedAt'])),
    );
  }

  void _startNewChat() {
    setState(() {
      requestedChatId = null;
      chatRevision++;
    });
    AppScope.of(context, listen: false).selectTab(DesktopTab.home);
  }

  void _openRecentChat(String id) {
    setState(() {
      requestedChatId = id;
      chatRevision++;
    });
    AppScope.of(context, listen: false).selectTab(DesktopTab.home);
  }

  Future<void> _archiveRecentChat(String id) async {
    final controller = AppScope.of(context, listen: false);
    await controller.invoke('archiveChat', [id]);
    await _loadRecentChats(controller, workspaceId ?? '');
  }

  @override
  void dispose() {
    unawaited(chatEvents?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = AppScope.of(context);
    final colors = context.helios;
    final isMacOS = defaultTargetPlatform == TargetPlatform.macOS;
    final warnings = _showsResourceStatus(controller.tab)
        ? listValue(controller.snapshot?['warnings'])
              .map((value) => stringValue(value))
              .where((message) => message.isNotEmpty)
              .toList()
        : const <String>[];
    return Scaffold(
      backgroundColor: colors.surface,
      body: Stack(
        children: [
          Row(
            children: [
              if (!collapsed)
                _ExpandedSidebar(
                  controller: controller,
                  onCollapse: () => setState(() => collapsed = true),
                  resourcesExpanded: resourcesExpanded,
                  onResourcesExpandedChanged: (value) =>
                      setState(() => resourcesExpanded = value),
                  recentView: recentView,
                  recentChats: recentChats,
                  selectedChatId: requestedChatId,
                  onRecentViewChanged: (value) =>
                      setState(() => recentView = value),
                  onNewChat: _startNewChat,
                  onOpenChat: _openRecentChat,
                  onArchiveChat: _archiveRecentChat,
                ),
              Expanded(
                child: Padding(
                  // macOS keeps the collapse control floating over the page.
                  // Reserve its width so every page header remains clickable.
                  padding: EdgeInsets.only(
                    // The floating macOS toggle starts at x=70. Keep the
                    // entire control and a title gutter outside every page.
                    left: collapsed && isMacOS ? 112 : 0,
                  ),
                  child: Column(
                    children: [
                      if (controller.error != null)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(20, 10, 20, 0),
                          child: ErrorBanner(
                            message: controller.error!,
                            onClose: controller.clearError,
                          ),
                        ),
                      for (final warning in warnings)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(20, 10, 20, 0),
                          child: WarningBanner(message: warning),
                        ),
                      Expanded(
                        child: controller.detail == null
                            ? switch (controller.tab) {
                                DesktopTab.home => ChatScreen(
                                  key: ValueKey(
                                    'chat-$chatRevision-${requestedChatId ?? 'new'}',
                                  ),
                                  initialChatId: requestedChatId,
                                ),
                                DesktopTab.templates => const TemplatesScreen(),
                                DesktopTab.projects => const ResourceListScreen(
                                  key: ValueKey('projects'),
                                  type: ResourceType.projects,
                                ),
                                DesktopTab.apps => const ResourceListScreen(
                                  key: ValueKey('apps'),
                                  type: ResourceType.apps,
                                ),
                                DesktopTab.databases =>
                                  const ResourceListScreen(
                                    key: ValueKey('databases'),
                                    type: ResourceType.databases,
                                  ),
                                DesktopTab.storage => const ResourceListScreen(
                                  key: ValueKey('storage'),
                                  type: ResourceType.storage,
                                ),
                                DesktopTab.account => const AccountScreen(),
                              }
                            : DetailScreen(route: controller.detail!),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          if (isMacOS)
            Positioned(
              top: ShellScreen.macTitleBarControlTop,
              left: 70,
              child: _SidebarToggleButton(
                tooltip: collapsed ? '展开侧边栏' : '收起侧边栏',
                onPressed: () => setState(() => collapsed = !collapsed),
                icon: const _SidebarGlyph(),
              ),
            ),
        ],
      ),
    );
  }

  bool _showsResourceStatus(DesktopTab tab) => switch (tab) {
    DesktopTab.projects ||
    DesktopTab.apps ||
    DesktopTab.databases ||
    DesktopTab.storage => true,
    _ => false,
  };
}

class _ExpandedSidebar extends StatelessWidget {
  const _ExpandedSidebar({
    required this.controller,
    required this.onCollapse,
    required this.resourcesExpanded,
    required this.onResourcesExpandedChanged,
    required this.recentView,
    required this.recentChats,
    required this.selectedChatId,
    required this.onRecentViewChanged,
    required this.onNewChat,
    required this.onOpenChat,
    required this.onArchiveChat,
  });

  final AppController controller;
  final VoidCallback onCollapse;
  final bool resourcesExpanded;
  final ValueChanged<bool> onResourcesExpandedChanged;
  final _RecentView recentView;
  final List<JsonMap>? recentChats;
  final String? selectedChatId;
  final ValueChanged<_RecentView> onRecentViewChanged;
  final VoidCallback onNewChat;
  final ValueChanged<String> onOpenChat;
  final ValueChanged<String> onArchiveChat;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    final isMacOS = defaultTargetPlatform == TargetPlatform.macOS;
    final projects = [...jsonList(controller.snapshot?['projects'])]
      ..sort(
        (a, b) =>
            stringValue(b['createdAt']).compareTo(stringValue(a['createdAt'])),
      );
    final recentProjects = projects.take(10).toList();
    final quota = jsonList(controller.snapshot?['quota']);
    return Material(
      color: colors.sidebar,
      child: SizedBox(
        width: 224,
        child: Column(
          children: [
            if (isMacOS)
              Container(
                height: 36,
                decoration: BoxDecoration(
                  border: Border(right: BorderSide(color: colors.line)),
                ),
              ),
            Container(
              height: 44,
              padding: const EdgeInsets.fromLTRB(14, 6, 10, 6),
              decoration: BoxDecoration(
                border: Border(right: BorderSide(color: colors.line)),
              ),
              child: Row(
                children: [
                  Image.asset(
                    'assets/sealos-logo-black.png',
                    width: 25,
                    height: 25,
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Text(
                      'Sealos',
                      style: TextStyle(
                        color: colors.ink,
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  if (!isMacOS)
                    _SidebarToggleButton(
                      tooltip: '收起侧边栏',
                      onPressed: onCollapse,
                      icon: const Icon(Icons.first_page, size: 19),
                    ),
                ],
              ),
            ),
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  border: Border(right: BorderSide(color: colors.line)),
                ),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(8, 4, 8, 10),
                  children: [
                    for (final item in ShellScreen.tabs)
                      _NavItem(
                        item: item,
                        selected: controller.tab == item.$1,
                        onTap: item.$1 == DesktopTab.home ? onNewChat : null,
                      ),
                    _ResourceNavGroup(
                      expanded: resourcesExpanded,
                      selectedTab: controller.tab,
                      onExpandedChanged: onResourcesExpandedChanged,
                      onSelected: controller.selectTab,
                    ),
                    _RecentTabs(
                      value: recentView,
                      onChanged: onRecentViewChanged,
                    ),
                    if (recentView == _RecentView.chats)
                      ..._chatItems(context)
                    else
                      ..._projectItems(recentProjects),
                  ],
                ),
              ),
            ),
            Container(
              decoration: BoxDecoration(
                color: colors.sidebar,
                border: Border(
                  top: BorderSide(color: colors.line),
                  right: BorderSide(color: colors.line),
                ),
              ),
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 8),
              child: Column(
                children: [
                  _WorkspaceButton(
                    status: controller.status ?? const {},
                    quota: quota,
                  ),
                  _NavItem(
                    item: const (
                      DesktopTab.account,
                      Icons.settings_outlined,
                      '设置',
                    ),
                    selected: controller.tab == DesktopTab.account,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _chatItems(BuildContext context) {
    final colors = context.helios;
    final chats = recentChats;
    if (chats == null) {
      return const [
        Padding(
          padding: EdgeInsets.symmetric(vertical: 12),
          child: Center(child: BrandLoading(compact: true)),
        ),
      ];
    }
    if (chats.isEmpty) {
      return const [_RecentEmpty('暂无最近对话')];
    }
    return [
      for (final chat in chats.take(12))
        _RecentChatTile(
          chat: chat,
          selected: chat['id'] == selectedChatId,
          colors: colors,
          onArchive: () => onArchiveChat(stringValue(chat['id'])),
          onTap: () => onOpenChat(stringValue(chat['id'])),
        ),
    ];
  }

  List<Widget> _projectItems(List<JsonMap> projects) {
    if (projects.isEmpty) {
      return const [_RecentEmpty('暂无最近项目')];
    }
    return [
      for (final project in projects)
        ListTile(
          minTileHeight: 36,
          contentPadding: const EdgeInsets.only(left: 14, right: 9),
          title: Text(
            stringValue(project['displayName'], stringValue(project['name'])),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12),
          ),
          onTap: () {
            controller.selectTab(DesktopTab.projects);
            controller.openDetail(
              DetailRoute('project', stringValue(project['name'])),
            );
          },
        ),
    ];
  }
}

class _SidebarToggleButton extends StatelessWidget {
  const _SidebarToggleButton({
    required this.tooltip,
    required this.onPressed,
    required this.icon,
  });

  final String tooltip;
  final VoidCallback onPressed;
  final Widget icon;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      style: IconButton.styleFrom(
        foregroundColor: colors.muted,
        minimumSize: const Size(30, 30),
        padding: EdgeInsets.zero,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
      icon: icon,
    );
  }
}

class _SidebarGlyph extends StatelessWidget {
  const _SidebarGlyph();

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: const Size.square(16),
      painter: _SidebarGlyphPainter(context.helios.muted),
    );
  }
}

class _SidebarGlyphPainter extends CustomPainter {
  const _SidebarGlyphPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.25
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final frame = RRect.fromRectAndRadius(
      const Rect.fromLTWH(1, 2, 14, 12),
      const Radius.circular(2.5),
    );
    canvas.drawRRect(frame, paint);
    canvas.drawLine(const Offset(6.5, 2), const Offset(6.5, 14), paint);
  }

  @override
  bool shouldRepaint(covariant _SidebarGlyphPainter oldDelegate) =>
      oldDelegate.color != color;
}

class _ResourceNavGroup extends StatefulWidget {
  const _ResourceNavGroup({
    required this.expanded,
    required this.selectedTab,
    required this.onExpandedChanged,
    required this.onSelected,
  });

  final bool expanded;
  final DesktopTab selectedTab;
  final ValueChanged<bool> onExpandedChanged;
  final ValueChanged<DesktopTab> onSelected;

  @override
  State<_ResourceNavGroup> createState() => _ResourceNavGroupState();
}

class _ResourceNavGroupState extends State<_ResourceNavGroup> {
  bool hovered = false;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    final active = ShellScreen.resourceTabs.any(
      (item) => item.$1 == widget.selectedTab,
    );
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 2),
          child: MouseRegion(
            onEnter: (_) => setState(() => hovered = true),
            onExit: (_) => setState(() => hovered = false),
            child: Material(
              color: hovered || (active && !widget.expanded)
                  ? colors.selected
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(6),
              child: InkWell(
                borderRadius: BorderRadius.circular(6),
                onTap: () => widget.onExpandedChanged(!widget.expanded),
                child: SizedBox(
                  height: 36,
                  child: Row(
                    children: [
                      const SizedBox(width: 10),
                      SizedBox(
                        width: 17,
                        height: 17,
                        child: Icon(
                          hovered
                              ? widget.expanded
                                    ? Icons.expand_more
                                    : Icons.chevron_right
                              : Icons.dashboard_customize_outlined,
                          key: ValueKey((hovered, widget.expanded)),
                          size: 17,
                          color: active || hovered ? colors.ink : colors.muted,
                        ),
                      ),
                      const SizedBox(width: 9),
                      Text(
                        '资源',
                        style: TextStyle(
                          color: colors.ink,
                          fontSize: 13,
                          fontWeight: active
                              ? FontWeight.w600
                              : FontWeight.w400,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
        if (widget.expanded)
          Container(
            margin: const EdgeInsets.only(left: 18, bottom: 2),
            decoration: BoxDecoration(
              border: Border(left: BorderSide(color: colors.line)),
            ),
            clipBehavior: Clip.hardEdge,
            child: Column(
              children: [
                for (final item in ShellScreen.resourceTabs)
                  _ResourceNavItem(
                    label: item.$2,
                    selected: item.$1 == widget.selectedTab,
                    onTap: () => widget.onSelected(item.$1),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

class _ResourceNavItem extends StatelessWidget {
  const _ResourceNavItem({
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
    return Padding(
      padding: const EdgeInsets.only(left: 4, right: 4, bottom: 1),
      child: Material(
        color: selected ? colors.selected : Colors.transparent,
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          borderRadius: BorderRadius.circular(6),
          onTap: onTap,
          child: SizedBox(
            height: 32,
            width: double.infinity,
            child: Padding(
              padding: const EdgeInsets.only(left: 13),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  label,
                  style: TextStyle(
                    color: selected ? colors.ink : colors.muted,
                    fontSize: 13,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _RecentChatTile extends StatefulWidget {
  const _RecentChatTile({
    required this.chat,
    required this.selected,
    required this.colors,
    required this.onArchive,
    required this.onTap,
  });

  final JsonMap chat;
  final bool selected;
  final HeliosPalette colors;
  final VoidCallback onArchive;
  final VoidCallback onTap;

  @override
  State<_RecentChatTile> createState() => _RecentChatTileState();
}

class _RecentChatTileState extends State<_RecentChatTile> {
  bool hovered = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      onEnter: (_) => setState(() => hovered = true),
      onExit: (_) => setState(() => hovered = false),
      child: ListTile(
        minTileHeight: 36,
        selected: widget.selected,
        contentPadding: const EdgeInsets.only(left: 14, right: 2),
        title: Text(
          stringValue(widget.chat['title'], '新对话'),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: widget.selected ? widget.colors.ink : widget.colors.muted,
            fontSize: 12,
          ),
        ),
        trailing: AnimatedOpacity(
          opacity: hovered ? 1 : 0,
          duration: const Duration(milliseconds: 100),
          child: IconButton(
            tooltip: '归档会话',
            onPressed: hovered ? widget.onArchive : null,
            icon: const Icon(Icons.archive_outlined, size: 15),
          ),
        ),
        onTap: widget.onTap,
      ),
    );
  }
}

class _RecentTabs extends StatelessWidget {
  const _RecentTabs({required this.value, required this.onChanged});

  final _RecentView value;
  final ValueChanged<_RecentView> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 13, 2, 6),
      child: Row(
        children: [
          Expanded(
            child: _RecentTab(
              label: '最近对话',
              selected: value == _RecentView.chats,
              onTap: () => onChanged(_RecentView.chats),
            ),
          ),
          Expanded(
            child: _RecentTab(
              label: '最近项目',
              selected: value == _RecentView.projects,
              onTap: () => onChanged(_RecentView.projects),
            ),
          ),
        ],
      ),
    );
  }
}

class _RecentTab extends StatelessWidget {
  const _RecentTab({
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
          height: 31,
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
              fontSize: 11,
              fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        ),
      ),
    );
  }
}

class _RecentEmpty extends StatelessWidget {
  const _RecentEmpty(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 7, 10, 10),
      child: Text(
        text,
        style: TextStyle(color: context.helios.subtle, fontSize: 12),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({required this.item, required this.selected, this.onTap});

  final (DesktopTab, IconData, String) item;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Material(
        color: selected ? colors.selected : Colors.transparent,
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          borderRadius: BorderRadius.circular(6),
          onTap:
              onTap ??
              () => AppScope.of(context, listen: false).selectTab(item.$1),
          child: SizedBox(
            height: 36,
            child: Row(
              children: [
                const SizedBox(width: 10),
                Icon(
                  item.$2,
                  size: 17,
                  color: selected ? colors.ink : colors.muted,
                ),
                const SizedBox(width: 9),
                Text(
                  item.$3,
                  style: TextStyle(
                    color: colors.ink,
                    fontSize: 13,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _WorkspaceButton extends StatelessWidget {
  const _WorkspaceButton({required this.status, required this.quota});

  final JsonMap status;
  final List<JsonMap> quota;

  @override
  Widget build(BuildContext context) {
    final colors = context.helios;
    final name = stringValue(
      status['workspaceName'],
      stringValue(status['workspace'], '工作空间'),
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 5),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          borderRadius: BorderRadius.circular(6),
          onTap: () => showDialog<void>(
            context: context,
            builder: (_) => WorkspaceDialog(
              controller: AppScope.of(context, listen: false),
              quota: quota,
            ),
          ),
          child: SizedBox(
            height: 40,
            child: Row(
              children: [
                const SizedBox(width: 8),
                Icon(Icons.workspaces_outline, color: colors.muted, size: 17),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: colors.ink,
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
                Icon(Icons.unfold_more, color: colors.subtle, size: 16),
                const SizedBox(width: 7),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
