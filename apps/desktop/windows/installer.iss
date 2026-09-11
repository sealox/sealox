#define MyAppName "Sealos"
#define MyAppVersion GetEnv("HELIOS_VERSION")
#define MyAppPublisher "Sealos"
#define MyAppExeName "Sealos.exe"
#define BuildDir GetEnv("HELIOS_WINDOWS_BUILD_DIR")
#define DistDir GetEnv("HELIOS_DIST_DIR")

[Setup]
AppId={{6BB8D6B5-C3A6-445E-91B3-C28AE8C8B083}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Sealos
DefaultGroupName=Sealos
OutputDir={#DistDir}
OutputBaseFilename=Sealos-{#MyAppVersion}-windows-x64
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
SetupIconFile=runner\resources\app_icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
WizardStyle=modern

[Files]
Source: "{#BuildDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Sealos"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\Sealos"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch Sealos"; Flags: nowait postinstall skipifsilent
