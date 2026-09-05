#define AppName GetEnv("RINO_INSTALLER_APP_NAME")
#define AppVersion GetEnv("RINO_INSTALLER_APP_VERSION")
#define AppId GetEnv("RINO_INSTALLER_APP_ID")
#define AppPublisher GetEnv("RINO_INSTALLER_APP_PUBLISHER")
#define PayloadRoot GetEnv("RINO_INSTALLER_PAYLOAD_ROOT")
#define AppExecutable GetEnv("RINO_INSTALLER_EXECUTABLE")
#define OutputRoot GetEnv("RINO_INSTALLER_OUTPUT_ROOT")
#define OutputName GetEnv("RINO_INSTALLER_OUTPUT_NAME")

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
OutputDir={#OutputRoot}
OutputBaseFilename={#OutputName}
Compression=lzma2/max
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
CloseApplications=yes
RestartApplications=no
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExecutable}
WizardStyle=modern

[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Files]
Source: "{#PayloadRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "ChineseSimplified.LICENSE.txt"; DestDir: "{app}\licenses"; DestName: "Inno-Setup-Chinese-Simplified-Translation.LICENSE.txt"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExecutable}"; WorkingDir: "{app}"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\{#AppExecutable}"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Run]
Filename: "{app}\{#AppExecutable}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
