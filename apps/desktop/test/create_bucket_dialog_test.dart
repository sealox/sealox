import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:helios_desktop/widgets/create_bucket_dialog.dart';
import 'package:helios_desktop/core/theme.dart';

void main() {
  testWidgets('validates names and prevents duplicate creation while pending', (
    tester,
  ) async {
    final pending = Completer<void>();
    final names = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        theme: buildHeliosTheme(),
        home: Scaffold(
          body: CreateBucketDialog(
            create: (name, policy) {
              expect(policy, 'publicRead');
              names.add(name);
              return pending.future;
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final initialField = tester.getRect(find.byType(TextFormField));
    expect(initialField.height, greaterThanOrEqualTo(40));
    expect(
      tester.getRect(find.text('Bucket 名称')).bottom,
      lessThan(initialField.top),
    );
    expect(
      tester.getRect(find.text('3–63 位小写字母、数字或连字符')).top,
      greaterThan(initialField.bottom),
    );
    await tester.enterText(find.byType(TextFormField), 'Invalid_Name');
    await tester.tap(find.text('创建'));
    await tester.pump();
    expect(names, isEmpty);
    expect(find.text('请输入有效名称，首尾须为字母或数字'), findsOneWidget);
    await tester.pumpAndSettle();
    expect(
      tester.getSize(find.byType(TextFormField)).height,
      greaterThan(initialField.height),
    );
    expect(tester.takeException(), isNull);
    await tester.enterText(find.byType(TextFormField), 'my-files');
    expect(
      tester
          .widget<SegmentedButton<String>>(find.byType(SegmentedButton<String>))
          .selected,
      {'private'},
    );
    await tester.tap(find.text('公开'));
    await tester.pump();
    await tester.tap(find.text('创建'));
    await tester.pump();
    expect(names, ['my-files']);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
    expect(
      tester.widget<TextButton>(find.widgetWithText(TextButton, '取消')).onPressed,
      isNull,
    );
    pending.completeError(Exception('同名 Bucket 已存在'));
    await tester.pumpAndSettle();
    expect(find.textContaining('同名 Bucket 已存在'), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNotNull,
    );
  });
}
