import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:helios_desktop/core/backend_client.dart';

void main() {
  test('parses the Node major version', () {
    expect(parseNodeMajor('v24.10.0'), 24);
    expect(parseNodeMajor('22.19.1'), 22);
    expect(parseNodeMajor('not node'), isNull);
  });

  test('skips Node 22 and selects Node 24 for the sidecar', () async {
    final selected = await selectSidecarNode(
      const ['node-22', 'node-24'],
      probe: (executable) async {
        final version = executable == 'node-24' ? 'v24.10.0' : 'v22.8.0';
        return ProcessResult(1, 0, version, '');
      },
    );

    expect(selected, 'node-24');
  });

  test(
    'serializes concurrent sidecar writes and recovers after failure',
    () async {
      final queue = SerialWriteQueue();
      final order = <int>[];
      var active = 0;
      var maxActive = 0;

      Future<void> write(int value) async {
        active++;
        maxActive = active > maxActive ? active : maxActive;
        await Future<void>.delayed(const Duration(milliseconds: 1));
        order.add(value);
        active--;
      }

      await Future.wait([
        queue.enqueue(() => write(1)),
        queue.enqueue(() => write(2)),
        queue.enqueue(() => write(3)),
      ]);

      expect(order, [1, 2, 3]);
      expect(maxActive, 1);

      await expectLater(
        queue.enqueue(() async => throw StateError('write failed')),
        throwsStateError,
      );
      await queue.enqueue(() => write(4));
      expect(order, [1, 2, 3, 4]);
    },
  );
}
