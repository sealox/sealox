import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
  private var nativeChannel: FlutterMethodChannel?

  // ShellScreen.macTitleBarControlTop (9) + half its 30-point toggle height.
  private static let titleBarControlCenterFromTop: CGFloat = 24

  override func update() {
    super.update()
    // AppKit can restore native button frames after resizing, activating or
    // leaving full screen. Reapply an absolute position after its layout.
    alignTrafficLights()
  }

  override func awakeFromNib() {
    styleMask.insert(.fullSizeContentView)
    titlebarAppearsTransparent = true
    titleVisibility = .hidden

    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)
    self.setContentSize(NSSize(width: 1280, height: 800))
    self.minSize = NSSize(width: 1024, height: 680)
    self.title = "Sealos"

    RegisterGeneratedPlugins(registry: flutterViewController)

    nativeChannel = FlutterMethodChannel(
      name: "dev.helios/native",
      binaryMessenger: flutterViewController.engine.binaryMessenger
    )
    nativeChannel?.setMethodCallHandler { [weak self] call, result in
      guard call.method == "pickLocalSource" else {
        result(FlutterMethodNotImplemented)
        return
      }
      self?.pickLocalSource(result: result)
    }

    super.awakeFromNib()

    // AppKit performs another title-bar layout after awakeFromNib. Apply the
    // shared title-bar control baseline on the next run-loop tick so it sticks.
    DispatchQueue.main.async { [weak self] in
      self?.alignTrafficLights()
    }
  }

  private func alignTrafficLights() {
    // Leave the system's full-screen toolbar and its animation to AppKit.
    guard !styleMask.contains(.fullScreen), let contentView = contentView else { return }
    let contentTop = contentView.isFlipped ? contentView.bounds.minY : contentView.bounds.maxY
    let centerInContent = NSPoint(
      x: 0,
      y: contentTop + (contentView.isFlipped ? 1 : -1) * Self.titleBarControlCenterFromTop
    )
    let centerInWindow = contentView.convert(centerInContent, to: nil)
    for buttonType in [
      NSWindow.ButtonType.closeButton,
      .miniaturizeButton,
      .zoomButton
    ] {
      guard let button = standardWindowButton(buttonType), let parent = button.superview else {
        continue
      }
      let center = parent.convert(centerInWindow, from: nil)
      let targetY = center.y - button.frame.height / 2
      // Idempotent: repeated window updates must never accumulate an offset.
      if abs(button.frame.origin.y - targetY) > 0.01 {
        button.setFrameOrigin(NSPoint(x: button.frame.origin.x, y: targetY))
      }
    }
  }

  private func pickLocalSource(result: @escaping FlutterResult) {
    let panel = NSOpenPanel()
    panel.title = "选择本地源代码"
    panel.prompt = "选择"
    panel.message = "选择包含项目源代码的文件夹或文件"
    panel.canChooseFiles = true
    panel.canChooseDirectories = true
    panel.allowsMultipleSelection = false
    panel.canCreateDirectories = false
    panel.resolvesAliases = true
    panel.beginSheetModal(for: self) { response in
      result(response == .OK ? panel.url?.path : nil)
    }
  }
}
