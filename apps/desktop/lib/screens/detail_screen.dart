import 'package:flutter/material.dart';

import '../core/app_controller.dart';
import 'app_detail_screen.dart';
import 'database_detail_screen.dart';
import 'file_storage_screen.dart';
import 'project_detail_screen.dart';

class DetailScreen extends StatelessWidget {
  const DetailScreen({required this.route, super.key});

  final DetailRoute route;

  @override
  Widget build(BuildContext context) {
    final detail = switch (route.type) {
      'project' => ProjectDetailScreen(
        key: ValueKey('project:${route.name}'),
        name: route.name,
      ),
      'storage' => FileStorageScreen(
        key: ValueKey('storage:${route.name}'),
        name: route.name,
      ),
      'database' => DatabaseDetailScreen(
        key: ValueKey('database:${route.name}'),
        name: route.name,
      ),
      _ => AppDetailScreen(
        key: ValueKey('app:${route.name}:${route.kind}'),
        name: route.name,
        kind: route.kind ?? 'Deployment',
      ),
    };
    return detail;
  }
}
