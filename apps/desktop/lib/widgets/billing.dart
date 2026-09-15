import 'dart:async';

import 'package:flutter/material.dart';

import '../core/app_controller.dart';
import '../core/json.dart';
import 'common.dart';

String balanceLabel(JsonMap? billing) {
  final amount = billing?['cashMicroUnits'];
  if (amount is! num) return '—';
  final currency = switch (billing?['currency']) {
    'usd' => 'USD',
    'cny' => 'CNY',
    'shellCoin' => '贝壳',
    _ => '（币种暂不可用）',
  };
  return '${(amount / 1000000).toStringAsFixed(2)} $currency';
}

class AccountBalanceCard extends StatelessWidget {
  const AccountBalanceCard({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = AppScope.of(context);
    final billing = controller.billing;
    final url = stringValue(billing?['topUpUrl']);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('账户余额', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            Text(
              balanceLabel(billing),
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Text(
              stringValue(
                billing?['balanceError'],
                billing == null ? '正在获取余额…' : '当前登录账户的现金余额，不含赠送和套餐额度',
              ),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: [
                FilledButton.tonal(
                  onPressed: url.isEmpty
                      ? null
                      : () => _openCostCenter(context, controller, url),
                  child: const Text('充值'),
                ),
                TextButton.icon(
                  onPressed: controller.billingRefreshing
                      ? null
                      : controller.refreshBilling,
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text('刷新余额'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> _openCostCenter(
  BuildContext context,
  AppController controller,
  String url,
) async {
  try {
    await controller.backend.call('openExternal', [url]);
  } catch (_) {
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('无法打开费用中心，请稍后重试')));
    }
  }
}

/// Debt is deduplicated for each active login context until a confirmed recovery.
/// A failed refresh never counts as recovery and never retriggers a dismissed dialog.
class BillingReminder extends StatefulWidget {
  const BillingReminder({required this.child, super.key});
  final Widget child;

  @override
  State<BillingReminder> createState() => _BillingReminderState();
}

class _BillingReminderState extends State<BillingReminder>
    with WidgetsBindingObserver {
  String? _contextKey;
  bool _notified = false;
  DialogRoute<void>? _route;
  AppController? _controller;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _controller = AppScope.of(context);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _sync();
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_controller?.refreshBilling());
    }
  }

  void _sync() {
    final controller = _controller!;
    final key =
        '${controller.status?['server']}|${controller.status?['namespace']}|${controller.status?['authenticatedAt']}';
    final debt = controller.billing?['workspaceDebt'];
    if (_contextKey != key || debt == false) {
      _contextKey = key;
      _notified = false;
      final route = _route;
      _route = null;
      if (route != null && route.isActive) route.navigator?.removeRoute(route);
    }
    if (debt != true || _notified) return;
    _notified = true;
    final billing = controller.billing!;
    final member = billing['isOwner'] == false;
    final url = stringValue(billing['topUpUrl']);
    final route = DialogRoute<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('工作空间因欠费受限'),
        content: Text(
          member ? '工作空间所有者的账户欠费，请联系所有者充值。' : '平台已确认当前工作空间因欠费受限。请前往费用中心查看并处理。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('稍后处理'),
          ),
          if (url.isNotEmpty && !member)
            FilledButton(
              onPressed: () {
                Navigator.pop(dialogContext);
                unawaited(_openCostCenter(context, controller, url));
              },
              child: Text(billing['isOwner'] == true ? '前往充值' : '查看费用中心'),
            ),
        ],
      ),
    );
    _route = route;
    unawaited(
      Navigator.of(context).push(route).whenComplete(() {
        if (identical(_route, route)) _route = null;
      }),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    final route = _route;
    if (route != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (route.isActive) route.navigator?.removeRoute(route);
      });
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
