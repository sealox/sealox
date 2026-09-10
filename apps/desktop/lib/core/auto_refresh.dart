import 'dart:async';

import 'package:flutter/widgets.dart';

/// Poll visible pages without overlapping requests or keeping disposed pages alive.
mixin AutoRefresh<T extends StatefulWidget> on State<T> {
  Timer? _poll;
  bool _polling = false;
  bool get canAutoRefresh => true;
  Future<void> refreshAutomatically();

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(const Duration(seconds: 5), (_) async {
      if (!mounted ||
          _polling ||
          !canAutoRefresh ||
          WidgetsBinding.instance.lifecycleState == AppLifecycleState.paused) {
        return;
      }
      _polling = true;
      try {
        await refreshAutomatically();
      } finally {
        _polling = false;
      }
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }
}
