import 'package:flutter/material.dart';

import '../core/app_controller.dart';
import '../widgets/common.dart';
import 'app_detail_screen.dart';
import 'database_detail_screen.dart';
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
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
          child: Row(
            children: [
              IconButton(
                tooltip: '返回',
                onPressed: AppScope.of(context, listen: false).closeDetail,
                icon: const Icon(Icons.arrow_back, size: 19),
              ),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  route.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
              ),
            ],
          ),
        ),
        Expanded(child: detail),
      ],
    );
  }
}
