import 'package:flutter/material.dart';

import 'core/app_controller.dart';
import 'core/theme.dart';
import 'screens/login_screen.dart';
import 'screens/shell_screen.dart';
import 'widgets/common.dart';
import 'widgets/update_prompt.dart';

class HeliosApp extends StatefulWidget {
  const HeliosApp({required this.controller, super.key});

  final AppController controller;

  @override
  State<HeliosApp> createState() => _HeliosAppState();
}

class _HeliosAppState extends State<HeliosApp> {
  @override
  void initState() {
    super.initState();
    widget.controller.boot();
  }

  @override
  void dispose() {
    widget.controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Sealos',
      debugShowCheckedModeBanner: false,
      theme: buildHeliosTheme(),
      darkTheme: buildHeliosTheme(brightness: Brightness.dark),
      themeMode: ThemeMode.system,
      home: AppScope(
        controller: widget.controller,
        child: UpdatePrompt(
          child: AnimatedBuilder(
            animation: widget.controller,
            builder: (context, _) {
              if (widget.controller.booting) return const BrandLoading();
              if (!widget.controller.authenticated) return const LoginScreen();
              return const ShellScreen();
            },
          ),
        ),
      ),
    );
  }
}
