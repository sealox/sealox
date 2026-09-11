import 'dart:async';

import 'package:flutter/foundation.dart';

import 'backend_client.dart';
import 'json.dart';

enum DesktopTab { home, templates, projects, apps, databases, storage, account }

class DetailRoute {
  const DetailRoute(
    this.type,
    this.name, {
    this.kind,
    this.database,
    this.table,
    this.tables = const [],
    this.project,
  });

  final String type;
  final String name;
  final String? kind;
  final String? database;
  final String? table;
  final List<String> tables;
  final String? project;
}

class AppController extends ChangeNotifier {
  AppController(this.backend);

  final HeliosBackend backend;
  StreamSubscription<BackendEvent>? _events;
  Timer? _refreshTimer;
  JsonMap? status;
  JsonMap? snapshot;
  DesktopTab tab = DesktopTab.home;
  final List<DetailRoute> details = [];
  bool booting = true;
  bool refreshing = false;
  String? error;
  JsonMap? loginEvent;
  String? chatDraft;
  String? chatRequestedId;
  int chatNavigationRevision = 0;

  bool get authenticated => boolValue(status?['authenticated']);
  DetailRoute? get detail => details.isEmpty ? null : details.last;

  Future<void> boot() async {
    _events ??= backend.events.listen(_handleEvent);
    try {
      await backend.start();
      status = jsonMap(await backend.call('getStatus'));
      if (authenticated) {
        await refreshResources(silent: true);
        _startRefreshTimer();
      }
    } catch (exception) {
      error = exception.toString();
    } finally {
      booting = false;
      notifyListeners();
    }
  }

  void _handleEvent(BackendEvent event) {
    switch (event.channel) {
      case 'sealos:login-event':
        loginEvent = jsonMap(event.data);
        if (loginEvent?['type'] == 'success') {
          status = jsonMap(loginEvent?['status']);
          loginEvent = null;
          _startRefreshTimer();
          unawaited(refreshResources(silent: true));
        } else if (loginEvent?['type'] == 'error') {
          error = stringValue(loginEvent?['message']);
        }
        notifyListeners();
      case 'helios:agent-status':
      case 'helios:chat-event':
      case 'helios:update-event':
        notifyListeners();
    }
  }

  void selectTab(DesktopTab value) {
    tab = value;
    details.clear();
    error = null;
    notifyListeners();
  }

  void startChatWithDraft(String text) {
    openChatWithDraft(null, text);
  }

  Future<void> openResourceChat({
    required String? projectName,
    required String draft,
  }) async {
    final project = projectName?.trim() ?? '';
    final conversation = jsonMap(
      await invoke<Object?>(
        project.isEmpty ? 'createChat' : 'getOrCreateProjectChat',
        project.isEmpty ? const <Object?>[] : [project],
      ),
    );
    final chatId = stringValue(conversation['id']);
    if (chatId.isEmpty) throw StateError('无法打开关联的对话');
    openChatWithDraft(chatId, draft);
  }

  void openChatWithDraft(String? chatId, String text) {
    chatDraft = text;
    chatRequestedId = chatId;
    chatNavigationRevision++;
    tab = DesktopTab.home;
    details.clear();
    notifyListeners();
  }

  String? takeChatDraft() {
    final value = chatDraft;
    chatDraft = null;
    return value;
  }

  void openDetail(DetailRoute route) {
    details.add(route);
    notifyListeners();
  }

  void closeDetail() {
    if (details.isNotEmpty) details.removeLast();
    notifyListeners();
  }

  Future<void> refreshResources({bool silent = false}) async {
    if (!authenticated || refreshing) return;
    refreshing = true;
    if (!silent) notifyListeners();
    try {
      snapshot = jsonMap(await backend.call('getResources'));
      error = null;
      _pruneDetails();
    } catch (exception) {
      // Periodic and initial resource loads must not interrupt the current
      // workspace with transient network failures.
      if (!silent) error = _displayableError(exception);
    } finally {
      refreshing = false;
      notifyListeners();
    }
  }

  Future<void> startLogin(String region) async {
    error = null;
    loginEvent = {'type': 'polling'};
    notifyListeners();
    try {
      await backend.call('startLogin', [region]);
    } catch (exception) {
      loginEvent = null;
      error = exception.toString();
      notifyListeners();
    }
  }

  Future<void> cancelLogin() async {
    await backend.call('cancelLogin');
    loginEvent = null;
    notifyListeners();
  }

  Future<void> saveKubeconfig(String text) async {
    error = null;
    notifyListeners();
    try {
      status = jsonMap(await backend.call('saveKubeconfig', [text]));
      loginEvent = null;
      _startRefreshTimer();
      await refreshResources();
    } catch (exception) {
      error = exception.toString();
      notifyListeners();
    }
  }

  Future<void> changeWorkspace(String uid) async {
    status = jsonMap(await backend.call('switchWorkspace', [uid]));
    snapshot = null;
    details.clear();
    tab = DesktopTab.home;
    await refreshResources();
  }

  Future<void> logout() async {
    await backend.call('logout');
    _refreshTimer?.cancel();
    status = {'authenticated': false};
    snapshot = null;
    details.clear();
    loginEvent = null;
    error = null;
    notifyListeners();
  }

  Future<T?> invoke<T>(String method, [List<Object?> args = const []]) async {
    error = null;
    try {
      final result = await backend.call<T>(method, args);
      return result;
    } catch (exception) {
      error = exception.toString();
      notifyListeners();
      rethrow;
    }
  }

  Future<void> operate(String method, String name) async {
    await invoke(method, [name]);
    await refreshResources(silent: true);
  }

  void clearError() {
    error = null;
    notifyListeners();
  }

  String _displayableError(Object exception) {
    final message = exception.toString();
    final normalized = message.toLowerCase();
    if (normalized.contains('fetch failed') ||
        normalized.contains('socketexception') ||
        normalized.contains('network is unreachable') ||
        normalized.contains('connection refused') ||
        normalized.contains('connection reset') ||
        normalized.contains('timed out')) {
      return '网络连接失败，请检查网络后重试。';
    }
    return message;
  }

  void _startRefreshTimer() {
    _refreshTimer?.cancel();
    _refreshTimer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => unawaited(refreshResources(silent: true)),
    );
  }

  void _pruneDetails() {
    final data = snapshot;
    if (data == null) return;
    details.removeWhere((route) {
      final list = switch (route.type) {
        'project' => jsonList(data['projects']),
        'database' || 'database-data' => jsonList(data['databases']),
        'storage' => jsonList(data['buckets']),
        _ => jsonList(data['apps']),
      };
      return !list.any((item) => item['name'] == route.name);
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    unawaited(_events?.cancel());
    backend.dispose();
    super.dispose();
  }
}
