import 'package:flutter/material.dart';

import 'app.dart';
import 'core/app_controller.dart';
import 'core/backend_client.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(HeliosApp(controller: AppController(SidecarBackend())));
}
