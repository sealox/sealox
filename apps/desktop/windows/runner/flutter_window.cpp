#include "flutter_window.h"

#include <shobjidl.h>

#include <optional>
#include <string>
#include <utility>

#include "flutter/generated_plugin_registrant.h"
#include "utils.h"

namespace {

std::optional<std::string> PickLocalSource(HWND owner) {
  const int kind = ::MessageBoxW(
      owner,
      L"Select Yes for a source folder or No for a source file.",
      L"Select local source", MB_YESNOCANCEL | MB_ICONQUESTION);
  if (kind == IDCANCEL) {
    return std::nullopt;
  }

  IFileOpenDialog* dialog = nullptr;
  HRESULT result = ::CoCreateInstance(CLSID_FileOpenDialog, nullptr,
                                      CLSCTX_INPROC_SERVER,
                                      IID_PPV_ARGS(&dialog));
  if (FAILED(result) || dialog == nullptr) {
    return std::nullopt;
  }

  DWORD options = 0;
  dialog->GetOptions(&options);
  options |= FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST;
  if (kind == IDYES) {
    options |= FOS_PICKFOLDERS;
    dialog->SetTitle(L"Select local source folder");
  } else {
    options |= FOS_FILEMUSTEXIST;
    dialog->SetTitle(L"Select local source file");
  }
  dialog->SetOptions(options);

  result = dialog->Show(owner);
  if (FAILED(result)) {
    dialog->Release();
    return std::nullopt;
  }

  IShellItem* item = nullptr;
  result = dialog->GetResult(&item);
  dialog->Release();
  if (FAILED(result) || item == nullptr) {
    return std::nullopt;
  }

  PWSTR wide_path = nullptr;
  result = item->GetDisplayName(SIGDN_FILESYSPATH, &wide_path);
  item->Release();
  if (FAILED(result) || wide_path == nullptr) {
    return std::nullopt;
  }

  std::string path = Utf8FromUtf16(wide_path);
  ::CoTaskMemFree(wide_path);
  return path.empty() ? std::nullopt
                      : std::optional<std::string>(std::move(path));
}

}  // namespace

FlutterWindow::FlutterWindow(const flutter::DartProject& project)
    : project_(project) {}

FlutterWindow::~FlutterWindow() {}

bool FlutterWindow::OnCreate() {
  if (!Win32Window::OnCreate()) {
    return false;
  }

  RECT frame = GetClientArea();

  // The size here must match the window dimensions to avoid unnecessary surface
  // creation / destruction in the startup path.
  flutter_controller_ = std::make_unique<flutter::FlutterViewController>(
      frame.right - frame.left, frame.bottom - frame.top, project_);
  // Ensure that basic setup of the controller was successful.
  if (!flutter_controller_->engine() || !flutter_controller_->view()) {
    return false;
  }
  RegisterPlugins(flutter_controller_->engine());

  native_channel_ =
      std::make_unique<flutter::MethodChannel<flutter::EncodableValue>>(
          flutter_controller_->engine()->messenger(), "dev.helios/native",
          &flutter::StandardMethodCodec::GetInstance());
  native_channel_->SetMethodCallHandler(
      [this](const auto& call, auto result) {
        if (call.method_name() != "pickLocalSource") {
          result->NotImplemented();
          return;
        }
        const auto path = PickLocalSource(GetHandle());
        if (path.has_value()) {
          result->Success(flutter::EncodableValue(path.value()));
        } else {
          result->Success();
        }
      });
  SetChildContent(flutter_controller_->view()->GetNativeWindow());

  flutter_controller_->engine()->SetNextFrameCallback([&]() {
    this->Show();
  });

  // Flutter can complete the first frame before the "show window" callback is
  // registered. The following call ensures a frame is pending to ensure the
  // window is shown. It is a no-op if the first frame hasn't completed yet.
  flutter_controller_->ForceRedraw();

  return true;
}

void FlutterWindow::OnDestroy() {
  native_channel_.reset();
  if (flutter_controller_) {
    flutter_controller_ = nullptr;
  }

  Win32Window::OnDestroy();
}

LRESULT
FlutterWindow::MessageHandler(HWND hwnd, UINT const message,
                              WPARAM const wparam,
                              LPARAM const lparam) noexcept {
  // Give Flutter, including plugins, an opportunity to handle window messages.
  if (flutter_controller_) {
    std::optional<LRESULT> result =
        flutter_controller_->HandleTopLevelWindowProc(hwnd, message, wparam,
                                                      lparam);
    if (result) {
      return *result;
    }
  }

  switch (message) {
    case WM_FONTCHANGE:
      flutter_controller_->engine()->ReloadSystemFonts();
      break;
  }

  return Win32Window::MessageHandler(hwnd, message, wparam, lparam);
}
