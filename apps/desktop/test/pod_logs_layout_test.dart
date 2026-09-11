import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:helios_desktop/widgets/detail_widgets.dart';

void main() {
  testWidgets('long Pod and container names fit the log selectors', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 600,
            child: PodLogsPanel(
              pods: [
                {
                  'name':
                      'affine-yterfvju-redis-redis-sentinel-0-with-a-long-name',
                  'containers': [
                    {'name': 'redis-container-with-a-very-long-name'},
                  ],
                },
              ],
            ),
          ),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
