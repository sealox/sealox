typedef JsonMap = Map<String, dynamic>;

JsonMap jsonMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return value.map((key, item) => MapEntry(key.toString(), item));
  }
  return <String, dynamic>{};
}

List<JsonMap> jsonList(Object? value) {
  if (value is! List) return const [];
  return value.map(jsonMap).toList(growable: false);
}

String stringValue(Object? value, [String fallback = '']) =>
    value?.toString() ?? fallback;

int intValue(Object? value, [int fallback = 0]) {
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? fallback;
}

double doubleValue(Object? value, [double fallback = 0]) {
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? fallback;
}

bool boolValue(Object? value, [bool fallback = false]) =>
    value is bool ? value : fallback;

List<dynamic> listValue(Object? value) => value is List ? value : const [];
