import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path/path.dart' as p;

import 'json.dart';

class BackendEvent {
  const BackendEvent(this.channel, this.data);

  final String channel;
  final Object? data;
}

class BackendException implements Exception {
  const BackendException(this.message, {this.code = 'INVOKE_ERROR'});

  final String code;
  final String message;

  @override
  String toString() => message;
}

abstract class HeliosBackend extends ChangeNotifier {
  Stream<BackendEvent> get events;
  bool get ready;
  String? get fatalError;
  Future<void> start();
  Future<T?> call<T>(String method, [List<Object?> args = const []]);
  Future<List<JsonMap>> pickChatFiles();
  Future<String?> pickLocalSource();
  Future<void> shutdown();
}

class SidecarBackend extends HeliosBackend {
  static const _nativeChannel = MethodChannel('dev.helios/native');

  Process? _process;
  StreamSubscription<String>? _stdoutSubscription;
  StreamSubscription<String>? _stderrSubscription;
  final _events = StreamController<BackendEvent>.broadcast();
  final _pending = <int, Completer<Object?>>{};
  final _stdinWrites = SerialWriteQueue();
  Completer<void>? _started;
  int _nextId = 1;
  bool _ready = false;
  String? _fatalError;
  final _stderrTail = <String>[];
  bool _stopping = false;

  @override
  Stream<BackendEvent> get events => _events.stream;

  @override
  bool get ready => _ready;

  @override
  String? get fatalError => _fatalError;

  @override
  Future<void> start() async {
    if (_ready) return;
    if (_started != null) return _started!.future;
    final started = _started = Completer<void>();
    _stopping = false;
    _fatalError = null;
    _stderrTail.clear();
    try {
      final launch = await _locateLaunch();
      final package = await PackageInfo.fromPlatform();
      _process = await Process.start(
        launch.node,
        [launch.backend],
        workingDirectory: launch.appRoot,
        environment: {
          ...Platform.environment,
          'HELIOS_APP_ROOT': launch.appRoot,
          'HELIOS_RESOURCES': launch.resources,
          'HELIOS_PACKAGED': launch.packaged ? '1' : '0',
          'HELIOS_VERSION': package.version,
          if (launch.bash != null) 'HELIOS_BASH_PATH': launch.bash!,
        },
        runInShell: false,
      );
      _stdoutSubscription = _process!.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen(_handleLine, onError: _handleFatal);
      _stderrSubscription = _process!.stderr
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen((line) {
            if (line.trim().isEmpty) return;
            _stderrTail
              ..add(line)
              ..removeRange(
                0,
                _stderrTail.length > 12 ? _stderrTail.length - 12 : 0,
              );
            debugPrint('[helios-backend] $line');
          });
      unawaited(
        _process!.exitCode.then((code) {
          _process = null;
          if (!_stopping && (!_ready || code != 0)) {
            final detail = _stderrTail.isEmpty
                ? ''
                : ': ${_stderrTail.join(' | ')}';
            _handleFatal('Sealos backend exited with code $code$detail');
          }
        }),
      );
      await started.future.timeout(const Duration(seconds: 30));
    } catch (error) {
      _handleFatal(error);
      if (!started.isCompleted) started.completeError(error);
      rethrow;
    }
  }

  void _handleLine(String line) {
    try {
      final message = jsonMap(jsonDecode(line));
      if (message.containsKey('event')) {
        final event = BackendEvent(
          stringValue(message['event']),
          message['data'],
        );
        if (event.channel == 'helios:ready') {
          _ready = true;
          if (!(_started?.isCompleted ?? true)) _started!.complete();
          notifyListeners();
        }
        if (event.channel == 'helios:backend-error') {
          final data = jsonMap(event.data);
          _fatalError = stringValue(data['message'], '后端后台任务失败');
          notifyListeners();
        }
        _events.add(event);
        return;
      }
      final id = intValue(message['id'], -1);
      final completer = _pending.remove(id);
      if (completer == null) return;
      if (message['error'] != null) {
        final error = jsonMap(message['error']);
        completer.completeError(
          BackendException(
            stringValue(error['message'], '调用失败'),
            code: stringValue(error['code'], 'INVOKE_ERROR'),
          ),
        );
      } else {
        completer.complete(message['result']);
      }
    } catch (error) {
      _handleFatal('后端返回了无效数据：$error');
    }
  }

  void _handleFatal(Object error) {
    if (_fatalError == error.toString() && !_ready) return;
    _fatalError = error.toString();
    _ready = false;
    final failure = BackendException(_fatalError!, code: 'BACKEND_UNAVAILABLE');
    for (final completer in _pending.values) {
      if (!completer.isCompleted) completer.completeError(failure);
    }
    _pending.clear();
    if (!(_started?.isCompleted ?? true)) _started!.completeError(failure);
    _started = null;
    notifyListeners();
  }

  @override
  Future<T?> call<T>(String method, [List<Object?> args = const []]) async {
    await start();
    final process = _process;
    if (process == null || !_ready) {
      throw BackendException(_fatalError ?? '后端未就绪');
    }
    final id = _nextId++;
    final completer = Completer<Object?>();
    _pending[id] = completer;
    try {
      await _stdinWrites.enqueue(() async {
        if (_process != process || !_ready) {
          throw BackendException(_fatalError ?? '后端未就绪');
        }
        process.stdin.writeln(
          jsonEncode({'id': id, 'method': method, 'args': args}),
        );
        await process.stdin.flush();
      });
    } catch (_) {
      _pending.remove(id);
      rethrow;
    }
    return (await completer.future) as T?;
  }

  @override
  Future<List<JsonMap>> pickChatFiles() async {
    const group = XTypeGroup(label: '文件');
    final files = await openFiles(acceptedTypeGroups: const [group]);
    final picked = <JsonMap>[];
    for (final file in files.take(8)) {
      final size = await File(file.path).length();
      if (size > 20 * 1024 * 1024) {
        throw BackendException('${p.basename(file.path)} 超过 20 MB');
      }
      picked.add({
        'path': file.path,
        'filename': p.basename(file.path),
        'mediaType': _mediaType(file.path),
        'size': size,
      });
    }
    return picked;
  }

  @override
  Future<String?> pickLocalSource() async {
    if (!Platform.isMacOS && !Platform.isWindows) {
      throw const BackendException('当前平台不支持选择本地源代码');
    }
    return _nativeChannel.invokeMethod<String>('pickLocalSource');
  }

  @override
  Future<void> shutdown() async {
    _stopping = true;
    _ready = false;
    await _stdinWrites.drain();
    await _process?.stdin.close();
    _process?.kill(ProcessSignal.sigterm);
    await _stdoutSubscription?.cancel();
    await _stderrSubscription?.cancel();
    await _events.close();
  }

  @override
  void dispose() {
    unawaited(shutdown());
    super.dispose();
  }

  Future<_Launch> _locateLaunch() async {
    final override = Platform.environment['HELIOS_BACKEND_PATH'];
    final executableDir = p.dirname(Platform.resolvedExecutable);
    final cwd = Directory.current.path;
    final candidates = <String>[
      ?override,
      p.join(cwd, '..', 'desktop-backend', 'dist', 'helios-backend.cjs'),
      p.join(cwd, 'apps', 'desktop-backend', 'dist', 'helios-backend.cjs'),
      if (Platform.isMacOS)
        p.normalize(
          p.join(
            executableDir,
            '..',
            'Resources',
            'helios',
            'helios-backend.cjs',
          ),
        ),
      if (Platform.isWindows)
        p.join(executableDir, 'helios', 'helios-backend.cjs'),
    ];
    final backend = candidates
        .map(p.normalize)
        .firstWhere(
          (path) => File(path).existsSync(),
          orElse: () => throw BackendException(
            '找不到 Sealos backend。先在仓库根目录运行 npm run build:backend。',
            code: 'BACKEND_MISSING',
          ),
        );
    final packaged = !backend.contains(
      '${p.separator}apps${p.separator}desktop-backend',
    );
    final resourceRoot = packaged
        ? p.dirname(backend)
        : p.dirname(p.dirname(backend));
    final nodeOverride = Platform.environment['HELIOS_NODE_PATH'];
    final bundledNode = Platform.isWindows
        ? p.join(resourceRoot, 'node', 'node.exe')
        : p.join(resourceRoot, 'node', 'bin', 'node');
    final repositoryRoot = packaged
        ? null
        : p.dirname(p.dirname(p.dirname(p.dirname(backend))));
    final releaseNode = repositoryRoot == null
        ? null
        : Platform.isWindows
        ? p.join(
            repositoryRoot,
            'apps',
            'desktop',
            'build',
            'windows',
            'x64',
            'runner',
            'Release',
            'helios',
            'node',
            'node.exe',
          )
        : p.join(
            repositoryRoot,
            'apps',
            'desktop',
            'build',
            'macos',
            'Build',
            'Products',
            'Release',
            'Sealos.app',
            'Contents',
            'Resources',
            'helios',
            'node',
            'bin',
            'node',
          );
    final node = await selectSidecarNode([
      if (packaged) bundledNode,
      if (nodeOverride != null && nodeOverride.trim().isNotEmpty) nodeOverride,
      if (!packaged) releaseNode,
      if (!packaged) bundledNode,
      'node',
    ]);
    final bundledBash = p.join(resourceRoot, 'git', 'bin', 'bash.exe');
    return _Launch(
      backend: backend,
      node: node,
      appRoot: packaged ? resourceRoot : p.dirname(p.dirname(backend)),
      resources: resourceRoot,
      packaged: packaged,
      bash: Platform.isWindows && File(bundledBash).existsSync()
          ? bundledBash
          : null,
    );
  }
}

@visibleForTesting
int? parseNodeMajor(String version) {
  final match = RegExp(r'^v?(\d+)(?:\.|$)').firstMatch(version.trim());
  return match == null ? null : int.tryParse(match.group(1)!);
}

@visibleForTesting
Future<String> selectSidecarNode(
  Iterable<String?> candidates, {
  Future<ProcessResult> Function(String executable)? probe,
}) async {
  final runProbe =
      probe ??
      (executable) =>
          Process.run(executable, const ['--version'], runInShell: false);
  final seen = <String>{};
  final detected = <String>[];

  for (final candidate in candidates) {
    if (candidate == null || candidate.trim().isEmpty) continue;
    final executable = candidate.trim();
    if (!seen.add(executable)) continue;
    if (probe == null &&
        executable != 'node' &&
        !File(executable).existsSync()) {
      continue;
    }
    try {
      final result = await runProbe(executable);
      if (result.exitCode != 0) continue;
      final version = '${result.stdout}'.trim();
      final major = parseNodeMajor(version);
      detected.add('$version ($executable)');
      if (major == 24) return executable;
    } on ProcessException {
      // Try the next candidate. The final error lists every detected runtime.
    }
  }

  final detail = detected.isEmpty ? '未找到可执行的 Node.js' : detected.join('、');
  throw BackendException(
    'Sealos 桌面后端需要 Node 24.x；检测结果：$detail。'
    '请通过 npm run dev 启动，或将 HELIOS_NODE_PATH 指向 Node 24 可执行文件。',
    code: 'BACKEND_NODE_INCOMPATIBLE',
  );
}

@visibleForTesting
class SerialWriteQueue {
  Future<void> _tail = Future<void>.value();

  Future<void> enqueue(Future<void> Function() operation) {
    final next = _tail.then<void>((_) => operation());
    _tail = next.then<void>((_) {}, onError: (_, _) {});
    return next;
  }

  Future<void> drain() => _tail;
}

class _Launch {
  const _Launch({
    required this.backend,
    required this.node,
    required this.appRoot,
    required this.resources,
    required this.packaged,
    required this.bash,
  });

  final String backend;
  final String node;
  final String appRoot;
  final String resources;
  final bool packaged;
  final String? bash;
}

String _mediaType(String path) {
  return switch (p.extension(path).toLowerCase()) {
    '.txt' || '.log' => 'text/plain',
    '.md' || '.markdown' => 'text/markdown',
    '.json' => 'application/json',
    '.csv' => 'text/csv',
    '.yml' || '.yaml' => 'text/yaml',
    '.xml' => 'application/xml',
    '.html' => 'text/html',
    '.css' => 'text/css',
    '.js' => 'text/javascript',
    '.ts' || '.tsx' || '.jsx' || '.go' || '.rs' => 'text/plain',
    '.py' => 'text/x-python',
    '.sh' => 'text/x-sh',
    '.toml' => 'text/plain',
    '.png' => 'image/png',
    '.jpg' || '.jpeg' => 'image/jpeg',
    '.gif' => 'image/gif',
    '.webp' => 'image/webp',
    '.svg' => 'image/svg+xml',
    '.pdf' => 'application/pdf',
    '.zip' => 'application/zip',
    _ => 'application/octet-stream',
  };
}
