import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:helios_desktop/widgets/common.dart';

void main() {
  testWidgets('renders the Helios loading surface', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: BrandLoading()));

    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(find.byType(Image), findsOneWidget);
  });
}
