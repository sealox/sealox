import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:helios_desktop/widgets/common.dart';

void main() {
  testWidgets('renders the Helios loading surface', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: BrandLoading()));

    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(find.byType(Image), findsOneWidget);
  });

  testWidgets('loading animation fits inline and compact data sections', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ListView(
            children: const [
              BrandLoading(),
              SizedBox(height: 80, child: BrandLoading()),
              SizedBox(height: 40, child: BrandLoading(compact: true)),
            ],
          ),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    expect(find.byType(LinearProgressIndicator), findsNWidgets(3));
    expect(find.byType(Image), findsNWidgets(3));
  });
}
