; ==============================================================================
; Kiroku Note — Windows Inno Setup Script (V1.0.0)
; ==============================================================================
; Produces a 64-bit per-user Windows installer: Kiroku-Note-Setup-v1.0.0.exe
; Installs standalone backend executable and unpacked Chromium MV3 extension.
; User data is isolated in %LOCALAPPDATA%\KirokuNote and never bundled or overwritten.
; ==============================================================================

#define MyAppName "Kiroku Note"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Kiroku Note"
#define MyAppExeName "KirokuNote.exe"
#define MyAppId "{{8B84B425-4521-4E65-A6FB-1EE08C36A780}"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=..\dist\installer
OutputBaseFilename=Kiroku-Note-Setup-v{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
DisableDirPage=auto
CloseApplications=force
CloseApplicationsFilter={#MyAppExeName}
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=..\assets\icon.ico
ShowLanguageDialog=no
ChangesAssociations=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Backend Standalone Executable
Source: "..\dist\backend\KirokuNote\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; Chromium MV3 Extension Runtime
Source: "..\dist\extension\unpacked\*"; DestDir: "{app}\extension"; Flags: ignoreversion recursesubdirs createallsubdirs

; Post-install Browser Extension Setup Documentation
Source: "extension_instructions.txt"; DestDir: "{app}"; Flags: ignoreversion

; NOTE: User data (kiroku.db, media files, logs) is explicitly excluded from installation.
; All persistent user data resides in %LOCALAPPDATA%\KirokuNote\ and is preserved during upgrades and uninstalls.

[Dirs]
Name: "{localappdata}\KirokuNote\data"
Name: "{localappdata}\KirokuNote\media"
Name: "{localappdata}\KirokuNote\logs"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Extension Setup Instructions"; Filename: "{app}\extension_instructions.txt"
Name: "{group}\Open Extension Folder"; Filename: "{app}\extension"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
Filename: "{app}\extension_instructions.txt"; Description: "View Browser Extension setup instructions"; Flags: shellexec postinstall skipifsilent unchecked
