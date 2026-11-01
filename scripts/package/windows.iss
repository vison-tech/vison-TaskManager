; Compile with /DStageDir=<payload> /DReleaseDir=<output> /DAppVersion=<version>.
[Setup]
AppId={{20DEED71-A7F3-4C19-9FDB-7ACBC9741630}
AppName=TaskManager
AppVersion={#AppVersion}
AppPublisher=TaskManager
DefaultDirName=D:\software\TaskManager
DefaultGroupName=TaskManager
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19045
DisableDirPage=no
DisableProgramGroupPage=yes
UsePreviousAppDir=yes
OutputDir={#ReleaseDir}
OutputBaseFilename=TaskManager-{#AppVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=TaskManager
UninstallDisplayIcon={app}\TaskManager.ico
SetupIconFile={#StageDir}\TaskManager.ico
CloseApplications=no
RestartApplications=no
LicenseFile={#StageDir}\licenses\TaskManager-LICENSE
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\TaskManager"; Filename: "{app}\TaskManager.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\TaskManager.ico"
Name: "{group}\Stop TaskManager"; Filename: "{app}\TaskManager.cmd"; Parameters: "stop"; WorkingDir: "{app}"; IconFilename: "{app}\TaskManager.ico"
Name: "{group}\Uninstall TaskManager"; Filename: "{uninstallexe}"
Name: "{autodesktop}\TaskManager"; Filename: "{app}\TaskManager.cmd"; WorkingDir: "{app}"; Tasks: desktopicon; IconFilename: "{app}\TaskManager.ico"

[Run]
Filename: "{app}\TaskManager.cmd"; Description: "Launch TaskManager in your browser"; Flags: postinstall shellexec nowait skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/d /c """"{app}\TaskManager.cmd"" stop"""; Flags: runhidden waituntilterminated; RunOnceId: "StopLauncher"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
  Launcher: String;
begin
  Result := '';
  Launcher := ExpandConstant('{app}\TaskManager.cmd');
  if FileExists(Launcher) then
  begin
    if not Exec(ExpandConstant('{cmd}'), '/d /c ""' + Launcher + '" stop"', '', SW_HIDE,
      ewWaitUntilTerminated, ExitCode) then
      Result := 'Cannot stop TaskManager. Close its launcher window before upgrading.'
    else if ExitCode <> 0 then
      Result := 'TaskManager has not confirmed shutdown. Check its logs before upgrading.';
  end;
end;
