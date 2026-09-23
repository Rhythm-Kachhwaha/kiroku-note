; ==============================================================================
; Kiroku Note — Windows Inno Setup OCR Add-on Script
; ==============================================================================
; Produces a 64-bit Windows Add-on installer: Kiroku-Note-OCR-Setup-v1.0.1.exe
; Installs standalone KirokuOCR engine and dependencies into {app}\ocr\.
; User data is preserved and never bundled or overwritten.
; ==============================================================================

#define MyAppName "Kiroku Note OCR Add-on"
#define MyAppVersion "1.0.1"
#define MyAppPublisher "Kiroku Note"
#define MyAppExeName "KirokuOCR.exe"
#define MyBaseAppName "Kiroku Note"
#define MyAppId "{{C4318E29-22B4-463F-A238-C6207FB8652A}"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyBaseAppName}
UsePreviousAppDir=yes
AllowNoIcons=yes
OutputDir=..\dist\installer
OutputBaseFilename=Kiroku-Note-OCR-Setup-v{#MyAppVersion}
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
SetupIconFile=..\assets\icon.ico
ShowLanguageDialog=no
ChangesAssociations=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Standalone OCR Component Payload into {app}\ocr
Source: "..\dist\ocr\KirokuOCR\*"; DestDir: "{app}\ocr"; Flags: ignoreversion recursesubdirs createallsubdirs

; NOTE: User data (kiroku.db, media files, logs) is explicitly excluded from installation.
; All persistent user data resides in %LOCALAPPDATA%\KirokuNote\ and is preserved during upgrades and uninstalls.
