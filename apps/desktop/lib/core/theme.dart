import 'dart:io';

import 'package:flutter/material.dart';

/// Stable brand and status colors retained for callers that do not have a
/// BuildContext. UI surfaces should use [HeliosPalette] so they follow the
/// active light or dark theme.
abstract final class HeliosColors {
  static const ink = Color(0xff202124);
  static const muted = Color(0xff6f706f);
  static const subtle = Color(0xff92938f);
  static const canvas = Color(0xfffafaf9);
  static const surface = Color(0xffffffff);
  static const sidebar = Color(0xfff5f5f3);
  static const panel = Color(0xfff7f7f5);
  static const hover = Color(0xffececea);
  static const selected = Color(0xffe3e3e5);
  static const line = Color(0xffe6e3de);
  static const lineStrong = Color(0xffceccc6);
  static const gold = Color(0xff9a6500);
  static const goldSoft = Color(0xfffff7e6);
  static const green = Color(0xff18794e);
  static const red = Color(0xffc43d3d);
  static const blue = Color(0xff2563eb);
}

@immutable
class HeliosPalette extends ThemeExtension<HeliosPalette> {
  const HeliosPalette({
    required this.ink,
    required this.muted,
    required this.subtle,
    required this.canvas,
    required this.surface,
    required this.sidebar,
    required this.panel,
    required this.hover,
    required this.selected,
    required this.line,
    required this.lineStrong,
    required this.accent,
    required this.accentSoft,
    required this.link,
    required this.green,
    required this.greenSoft,
    required this.amber,
    required this.amberSoft,
    required this.red,
    required this.redSoft,
    required this.codeSurface,
    required this.codeInk,
    required this.shadow,
  });

  final Color ink;
  final Color muted;
  final Color subtle;
  final Color canvas;
  final Color surface;
  final Color sidebar;
  final Color panel;
  final Color hover;
  final Color selected;
  final Color line;
  final Color lineStrong;
  final Color accent;
  final Color accentSoft;
  final Color link;
  final Color green;
  final Color greenSoft;
  final Color amber;
  final Color amberSoft;
  final Color red;
  final Color redSoft;
  final Color codeSurface;
  final Color codeInk;
  final Color shadow;

  static const light = HeliosPalette(
    ink: HeliosColors.ink,
    muted: HeliosColors.muted,
    subtle: HeliosColors.subtle,
    canvas: HeliosColors.canvas,
    surface: HeliosColors.surface,
    sidebar: HeliosColors.sidebar,
    panel: HeliosColors.panel,
    hover: HeliosColors.hover,
    selected: HeliosColors.selected,
    line: HeliosColors.line,
    lineStrong: HeliosColors.lineStrong,
    accent: Color(0xff171717),
    accentSoft: HeliosColors.selected,
    link: HeliosColors.blue,
    green: HeliosColors.green,
    greenSoft: Color(0xffeef8f2),
    amber: HeliosColors.gold,
    amberSoft: HeliosColors.goldSoft,
    red: HeliosColors.red,
    redSoft: Color(0xfffff3f2),
    codeSurface: Color(0xff1f201f),
    codeInk: Color(0xffeeeeeb),
    shadow: Color(0x1f000000),
  );

  static const dark = HeliosPalette(
    ink: Color(0xfff0f0ed),
    muted: Color(0xffb1b1ac),
    subtle: Color(0xff858580),
    canvas: Color(0xff171716),
    surface: Color(0xff1b1b1a),
    sidebar: Color(0xff20201f),
    panel: Color(0xff242423),
    hover: Color(0xff2d2d2b),
    selected: Color(0xff333331),
    line: Color(0xff383835),
    lineStrong: Color(0xff555550),
    accent: Color(0xff0f0f0f),
    accentSoft: Color(0xff333331),
    link: Color(0xff7ea6f8),
    green: Color(0xff62bd91),
    greenSoft: Color(0xff1d3429),
    amber: Color(0xffd5a84f),
    amberSoft: Color(0xff3a3020),
    red: Color(0xffef7d78),
    redSoft: Color(0xff3d2524),
    codeSurface: Color(0xff121211),
    codeInk: Color(0xffeeeeeb),
    shadow: Color(0x66000000),
  );

  @override
  HeliosPalette copyWith({
    Color? ink,
    Color? muted,
    Color? subtle,
    Color? canvas,
    Color? surface,
    Color? sidebar,
    Color? panel,
    Color? hover,
    Color? selected,
    Color? line,
    Color? lineStrong,
    Color? accent,
    Color? accentSoft,
    Color? link,
    Color? green,
    Color? greenSoft,
    Color? amber,
    Color? amberSoft,
    Color? red,
    Color? redSoft,
    Color? codeSurface,
    Color? codeInk,
    Color? shadow,
  }) {
    return HeliosPalette(
      ink: ink ?? this.ink,
      muted: muted ?? this.muted,
      subtle: subtle ?? this.subtle,
      canvas: canvas ?? this.canvas,
      surface: surface ?? this.surface,
      sidebar: sidebar ?? this.sidebar,
      panel: panel ?? this.panel,
      hover: hover ?? this.hover,
      selected: selected ?? this.selected,
      line: line ?? this.line,
      lineStrong: lineStrong ?? this.lineStrong,
      accent: accent ?? this.accent,
      accentSoft: accentSoft ?? this.accentSoft,
      link: link ?? this.link,
      green: green ?? this.green,
      greenSoft: greenSoft ?? this.greenSoft,
      amber: amber ?? this.amber,
      amberSoft: amberSoft ?? this.amberSoft,
      red: red ?? this.red,
      redSoft: redSoft ?? this.redSoft,
      codeSurface: codeSurface ?? this.codeSurface,
      codeInk: codeInk ?? this.codeInk,
      shadow: shadow ?? this.shadow,
    );
  }

  @override
  HeliosPalette lerp(ThemeExtension<HeliosPalette>? other, double t) {
    if (other is! HeliosPalette) return this;
    return HeliosPalette(
      ink: Color.lerp(ink, other.ink, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      subtle: Color.lerp(subtle, other.subtle, t)!,
      canvas: Color.lerp(canvas, other.canvas, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      sidebar: Color.lerp(sidebar, other.sidebar, t)!,
      panel: Color.lerp(panel, other.panel, t)!,
      hover: Color.lerp(hover, other.hover, t)!,
      selected: Color.lerp(selected, other.selected, t)!,
      line: Color.lerp(line, other.line, t)!,
      lineStrong: Color.lerp(lineStrong, other.lineStrong, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      accentSoft: Color.lerp(accentSoft, other.accentSoft, t)!,
      link: Color.lerp(link, other.link, t)!,
      green: Color.lerp(green, other.green, t)!,
      greenSoft: Color.lerp(greenSoft, other.greenSoft, t)!,
      amber: Color.lerp(amber, other.amber, t)!,
      amberSoft: Color.lerp(amberSoft, other.amberSoft, t)!,
      red: Color.lerp(red, other.red, t)!,
      redSoft: Color.lerp(redSoft, other.redSoft, t)!,
      codeSurface: Color.lerp(codeSurface, other.codeSurface, t)!,
      codeInk: Color.lerp(codeInk, other.codeInk, t)!,
      shadow: Color.lerp(shadow, other.shadow, t)!,
    );
  }
}

extension HeliosThemeContext on BuildContext {
  HeliosPalette get helios =>
      Theme.of(this).extension<HeliosPalette>() ?? HeliosPalette.light;
}

ThemeData buildHeliosTheme({Brightness brightness = Brightness.light}) {
  final colors = brightness == Brightness.dark
      ? HeliosPalette.dark
      : HeliosPalette.light;
  final dark = brightness == Brightness.dark;
  final scheme =
      ColorScheme.fromSeed(
        seedColor: colors.accent,
        brightness: brightness,
      ).copyWith(
        primary: colors.accent,
        onPrimary: Colors.white,
        primaryContainer: colors.accentSoft,
        onPrimaryContainer: colors.ink,
        secondary: colors.muted,
        onSecondary: colors.surface,
        surface: colors.surface,
        onSurface: colors.ink,
        surfaceContainerLowest: colors.surface,
        surfaceContainerLow: colors.canvas,
        surfaceContainer: colors.panel,
        surfaceContainerHigh: colors.hover,
        surfaceContainerHighest: dark
            ? const Color(0xff343432)
            : const Color(0xffe4e4e1),
        outline: colors.lineStrong,
        outlineVariant: colors.line,
        error: colors.red,
        onError: dark ? const Color(0xff35100e) : Colors.white,
        errorContainer: colors.redSoft,
        onErrorContainer: colors.red,
      );
  const radius = BorderRadius.all(Radius.circular(6));
  final inputBorder = OutlineInputBorder(
    borderRadius: radius,
    borderSide: BorderSide(color: colors.lineStrong),
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    extensions: [colors],
    scaffoldBackgroundColor: colors.canvas,
    canvasColor: colors.surface,
    fontFamily: Platform.isMacOS ? '.AppleSystemUIFont' : 'Segoe UI',
    visualDensity: const VisualDensity(horizontal: -1, vertical: -1),
    dividerColor: colors.line,
    hoverColor: colors.hover,
    focusColor: colors.hover,
    splashColor: colors.ink.withValues(alpha: 0.07),
    textSelectionTheme: TextSelectionThemeData(
      cursorColor: colors.ink,
      selectionColor: colors.ink.withValues(alpha: dark ? 0.28 : 0.14),
      selectionHandleColor: colors.ink,
    ),
    textTheme: TextTheme(
      headlineLarge: TextStyle(
        fontSize: 22,
        height: 1.3,
        fontWeight: FontWeight.w600,
        letterSpacing: 0,
        color: colors.ink,
      ),
      headlineMedium: TextStyle(
        fontSize: 18,
        height: 1.35,
        fontWeight: FontWeight.w600,
        letterSpacing: 0,
        color: colors.ink,
      ),
      titleLarge: TextStyle(
        fontSize: 16,
        height: 1.4,
        fontWeight: FontWeight.w600,
        letterSpacing: 0,
        color: colors.ink,
      ),
      titleMedium: TextStyle(
        fontSize: 14,
        height: 1.4,
        fontWeight: FontWeight.w600,
        letterSpacing: 0,
        color: colors.ink,
      ),
      bodyLarge: TextStyle(
        fontSize: 14,
        height: 1.5,
        letterSpacing: 0,
        color: colors.ink,
      ),
      bodyMedium: TextStyle(
        fontSize: 13,
        height: 1.5,
        letterSpacing: 0,
        color: colors.ink,
      ),
      bodySmall: TextStyle(
        fontSize: 12,
        height: 1.5,
        letterSpacing: 0,
        color: colors.muted,
      ),
      labelLarge: TextStyle(
        fontSize: 13,
        height: 1.35,
        fontWeight: FontWeight.w500,
        letterSpacing: 0,
        color: colors.ink,
      ),
      labelMedium: TextStyle(
        fontSize: 12,
        height: 1.35,
        letterSpacing: 0,
        color: colors.muted,
      ),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: colors.surface,
      surfaceTintColor: Colors.transparent,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: radius,
        side: BorderSide(color: colors.line),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colors.surface,
      isDense: true,
      hintStyle: TextStyle(color: colors.subtle, fontSize: 13),
      labelStyle: TextStyle(color: colors.muted, fontSize: 13),
      floatingLabelStyle: TextStyle(color: colors.ink, fontSize: 13),
      prefixIconColor: colors.muted,
      suffixIconColor: colors.muted,
      border: inputBorder,
      enabledBorder: inputBorder,
      focusedBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: colors.ink, width: 1.5),
      ),
      disabledBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: colors.line),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 34),
        backgroundColor: colors.accent,
        foregroundColor: Colors.white,
        iconColor: Colors.white,
        disabledBackgroundColor: colors.hover,
        disabledForegroundColor: colors.subtle,
        disabledIconColor: colors.subtle,
        elevation: 0,
        shape: const RoundedRectangleBorder(borderRadius: radius),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        textStyle: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w500,
          letterSpacing: 0,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 34),
        foregroundColor: colors.ink,
        backgroundColor: Colors.transparent,
        disabledForegroundColor: colors.subtle,
        shape: const RoundedRectangleBorder(borderRadius: radius),
        side: BorderSide(color: colors.lineStrong),
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
        textStyle: const TextStyle(fontSize: 13, letterSpacing: 0),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: const Size(0, 32),
        foregroundColor: colors.ink,
        shape: const RoundedRectangleBorder(borderRadius: radius),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        textStyle: const TextStyle(fontSize: 13, letterSpacing: 0),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        minimumSize: const Size(32, 32),
        maximumSize: const Size(32, 32),
        foregroundColor: colors.muted,
        disabledForegroundColor: colors.subtle,
        shape: const RoundedRectangleBorder(borderRadius: radius),
        padding: const EdgeInsets.all(7),
      ),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: colors.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 6,
      shadowColor: colors.shadow,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        side: BorderSide(color: colors.line),
      ),
      textStyle: TextStyle(fontSize: 13, color: colors.ink),
    ),
    menuTheme: MenuThemeData(
      style: MenuStyle(
        backgroundColor: WidgetStatePropertyAll(colors.surface),
        surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
        shadowColor: WidgetStatePropertyAll(colors.shadow),
        elevation: const WidgetStatePropertyAll(6),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
            side: BorderSide(color: colors.line),
          ),
        ),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: colors.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 10,
      shadowColor: colors.shadow,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        side: BorderSide(color: colors.line),
      ),
      titleTextStyle: TextStyle(
        color: colors.ink,
        fontSize: 16,
        height: 1.4,
        fontWeight: FontWeight.w600,
        letterSpacing: 0,
      ),
      contentTextStyle: TextStyle(
        color: colors.ink,
        fontSize: 13,
        height: 1.5,
        letterSpacing: 0,
      ),
    ),
    tooltipTheme: TooltipThemeData(
      waitDuration: const Duration(milliseconds: 500),
      decoration: BoxDecoration(
        color: dark ? const Color(0xffeeeeeb) : const Color(0xff30302e),
        borderRadius: BorderRadius.circular(5),
      ),
      textStyle: TextStyle(
        fontSize: 12,
        color: dark ? const Color(0xff252523) : Colors.white,
        letterSpacing: 0,
      ),
    ),
    dividerTheme: DividerThemeData(color: colors.line, thickness: 1, space: 1),
    listTileTheme: ListTileThemeData(
      dense: true,
      minTileHeight: 36,
      iconColor: colors.muted,
      textColor: colors.ink,
      selectedColor: colors.ink,
      selectedTileColor: colors.selected,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12),
      shape: const RoundedRectangleBorder(borderRadius: radius),
      titleTextStyle: TextStyle(
        color: colors.ink,
        fontSize: 13,
        height: 1.4,
        letterSpacing: 0,
      ),
      subtitleTextStyle: TextStyle(
        color: colors.muted,
        fontSize: 12,
        height: 1.4,
        letterSpacing: 0,
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: colors.panel,
      selectedColor: colors.selected,
      disabledColor: colors.panel,
      side: BorderSide(color: colors.line),
      shape: const RoundedRectangleBorder(borderRadius: radius),
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
      labelStyle: TextStyle(fontSize: 12, color: colors.ink, letterSpacing: 0),
      secondaryLabelStyle: TextStyle(
        fontSize: 12,
        color: colors.ink,
        letterSpacing: 0,
      ),
    ),
    checkboxTheme: CheckboxThemeData(
      visualDensity: VisualDensity.compact,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
      side: BorderSide(color: colors.lineStrong),
      fillColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? colors.ink
            : Colors.transparent,
      ),
      checkColor: WidgetStatePropertyAll(colors.surface),
    ),
    switchTheme: SwitchThemeData(
      trackColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? colors.ink
            : colors.lineStrong,
      ),
      thumbColor: WidgetStatePropertyAll(
        dark ? const Color(0xffeeeeeb) : Colors.white,
      ),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: colors.ink,
      linearTrackColor: colors.line,
    ),
    scrollbarTheme: ScrollbarThemeData(
      thickness: const WidgetStatePropertyAll(6),
      radius: const Radius.circular(3),
      thumbColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.hovered)
            ? colors.subtle
            : colors.lineStrong,
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: dark ? const Color(0xffeeeeeb) : const Color(0xff30302e),
      contentTextStyle: TextStyle(
        color: dark ? const Color(0xff252523) : Colors.white,
        fontSize: 13,
        letterSpacing: 0,
      ),
      behavior: SnackBarBehavior.floating,
      elevation: 6,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(6)),
      ),
    ),
  );
}
