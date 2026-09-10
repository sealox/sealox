import 'package:flutter/material.dart';

import '../core/json.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final kubeconfig = TextEditingController();
  List<JsonMap> regions = const [];
  String region = '';
  bool showKubeconfig = false;
  bool loaded = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!loaded) {
      loaded = true;
      _loadRegions();
    }
  }

  Future<void> _loadRegions() async {
    final controller = AppScope.of(context, listen: false);
    try {
      final result = await controller.invoke<List<dynamic>>('getRegions');
      if (!mounted) return;
      setState(() {
        regions = jsonList(result);
        region = regions.isEmpty ? '' : stringValue(regions.first['url']);
      });
    } catch (_) {}
  }

  @override
  void dispose() {
    kubeconfig.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = AppScope.of(context);
    final colors = context.helios;
    final event = controller.loginEvent;
    final authorizing = event != null;
    return Scaffold(
      backgroundColor: colors.surface,
      body: Stack(
        children: [
          Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(28, 72, 28, 28),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 380),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Container(
                        width: 42,
                        height: 42,
                        decoration: BoxDecoration(
                          color: colors.panel,
                          border: Border.all(color: colors.line),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        padding: const EdgeInsets.all(6),
                        child: Image.asset('assets/sealos-logo-black.png'),
                      ),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      authorizing ? '授权登录' : '登录 Sealos',
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                    const SizedBox(height: 22),
                    if (controller.error != null) ...[
                      ErrorBanner(
                        message: controller.error!,
                        onClose: controller.clearError,
                      ),
                      const SizedBox(height: 14),
                    ],
                    if (!authorizing) ...[
                      DropdownButtonFormField<String>(
                        initialValue: region.isEmpty ? null : region,
                        decoration: const InputDecoration(labelText: '区域'),
                        items: regions
                            .map(
                              (item) => DropdownMenuItem(
                                value: stringValue(item['url']),
                                child: Text(stringValue(item['label'])),
                              ),
                            )
                            .toList(),
                        onChanged: (value) =>
                            setState(() => region = value ?? ''),
                      ),
                      const SizedBox(height: 12),
                      FilledButton.icon(
                        onPressed: region.isEmpty
                            ? null
                            : () => controller.startLogin(region),
                        icon: const Icon(Icons.login, size: 17),
                        label: const Text('使用 Sealos 账号登录'),
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Row(
                          children: [
                            const Expanded(child: Divider()),
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                              ),
                              child: Text(
                                '或',
                                style: TextStyle(
                                  color: colors.subtle,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                            const Expanded(child: Divider()),
                          ],
                        ),
                      ),
                      if (showKubeconfig) ...[
                        TextField(
                          controller: kubeconfig,
                          minLines: 6,
                          maxLines: 10,
                          onChanged: (_) => setState(() {}),
                          decoration: const InputDecoration(
                            hintText: '粘贴 kubeconfig',
                          ),
                        ),
                        const SizedBox(height: 10),
                        OutlinedButton.icon(
                          onPressed: kubeconfig.text.trim().isEmpty
                              ? null
                              : () =>
                                    controller.saveKubeconfig(kubeconfig.text),
                          icon: const Icon(Icons.save_outlined, size: 17),
                          label: const Text('保存 kubeconfig'),
                        ),
                      ] else
                        OutlinedButton(
                          onPressed: () =>
                              setState(() => showKubeconfig = true),
                          child: const Text('粘贴 kubeconfig 登录'),
                        ),
                    ] else ...[
                      Container(
                        padding: const EdgeInsets.all(18),
                        decoration: BoxDecoration(
                          color: colors.panel,
                          border: Border.all(color: colors.line),
                          borderRadius: BorderRadius.circular(7),
                        ),
                        child: Column(
                          children: [
                            if (event['type'] == 'device_code') ...[
                              const Text('请在已打开的浏览器中确认授权。'),
                              const SizedBox(height: 16),
                              SelectableText(
                                stringValue(event['userCode']),
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                  fontSize: 24,
                                  fontWeight: FontWeight.w600,
                                  letterSpacing: 0,
                                ),
                              ),
                            ] else
                              const BrandLoading(),
                            const SizedBox(height: 16),
                            Text(
                              event['type'] == 'exchanging'
                                  ? '正在获取工作空间…'
                                  : '等待浏览器授权…',
                              textAlign: TextAlign.center,
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),
                      OutlinedButton(
                        onPressed: controller.cancelLogin,
                        child: const Text('取消'),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
