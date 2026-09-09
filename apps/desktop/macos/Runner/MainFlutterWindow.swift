import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
  private var nativeChannel: FlutterMethodChannel?

  // Base standard: native traffic lights share the visual centerline of the
  // Flutter sidebar collapse control (ShellScreen's macOS title-bar control).
  private static let trafficLightSidebarAlignmentOffset: CGFloat = -8

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
    self.title = "Helios"

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
    for buttonType in [
      NSWindow.ButtonType.closeButton,
      .miniaturizeButton,
      .zoomButton
    ] {
      guard let button = standardWindowButton(buttonType) else { continue }
      button.setFrameOrigin(
        NSPoint(
          x: button.frame.origin.x,
          y: button.frame.origin.y + Self.trafficLightSidebarAlignmentOffset
        )
      )
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
