#ifndef AppVersion
#define AppVersion "0.0.0"
#endif

[Setup]
AppName=Rino
AppVersion={#AppVersion}
AppPublisher=Rino
DefaultDirName={localappdata}\Rino
DefaultGroupName=Rino
OutputBaseFilename=Rino_{#AppVersion}_Setup
OutputDir=..\release-local\rino-installer
Compression=lzma2/max
SolidCompression=yes
UninstallDisplayIcon={app}\Rino.ico
SetupIconFile=..\apps\desktop\src-tauri\icons\icon.ico
PrivilegesRequired=lowest
AppMutex=Local\Rino.Desktop.InstallationInUse.v1
SetupMutex=Local\Rino.Desktop.SetupInProgress.v1
CloseApplications=yes
RestartApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
DisableDirPage=yes
DisableReadyPage=yes
DisableFinishedPage=yes
DisableWelcomePage=yes

[Messages]
ConfirmUninstall=您确定要完全卸载 Rino 吗？
UninstallAppFullTitle=卸载 Rino
UninstallAppTitle=卸载 Rino
UninstallStatusLabel=正在从您的电脑中安全移除 Rino，请稍候...
ButtonYes=是(&Y)
ButtonNo=否(&N)
ExitSetupMessage=安装尚未完成。如果您现在退出，将不会安装 Rino。#13#10#13#10您确定要退出安装程序吗？
ExitSetupTitle=退出安装

[Files]
Source: "..\release-local\rino-installer\stage\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\apps\desktop\src-tauri\icons\icon.ico"; DestDir: "{app}"; DestName: "Rino.ico"; Flags: ignoreversion
Source: "btn_border.bmp"; Flags: dontcopy

[Icons]
Name: "{group}\Rino"; Filename: "{app}\Rino.exe"; WorkingDir: "{app}"; IconFilename: "{app}\Rino.ico"
Name: "{userdesktop}\Rino"; Filename: "{app}\Rino.exe"; WorkingDir: "{app}"; IconFilename: "{app}\Rino.ico"

[Run]
Filename: "{app}\Rino.exe"; Description: "运行 Rino"; Flags: nowait skipifsilent

[Code]
const
  WM_SYSCOMMAND = $0112;
  AW_BLEND = $00080000;
  AW_ACTIVATE = $00020000;
  AW_HIDE = $00010000;

var
  CloseButtonLabel: TLabel;
  TitleLabel: TLabel;
  DragHandle: TLabel;
  InstallButton: TBitmapImage;
  InstallButtonLabel: TLabel;
  StatusLabel: TLabel;

procedure ReleaseCapture; external 'ReleaseCapture@user32.dll stdcall';
procedure SendMessage(hWnd: HWND; Msg: Longint; wParam: Longint; lParam: Longint); external 'SendMessageW@user32.dll stdcall';
function AnimateWindow(hWnd: HWND; dwTime: Longint; dwFlags: Longint): BOOL; external 'AnimateWindow@user32.dll stdcall';
function CreateRoundRectRgn(nLeftRect, nTopRect, nRightRect, nBottomRect, nWidthEllipse, nHeightEllipse: Integer): LongWord; external 'CreateRoundRectRgn@gdi32.dll stdcall';
function SetWindowRgn(hWnd: HWND; hRgn: LongWord; bRedraw: Boolean): Integer; external 'SetWindowRgn@user32.dll stdcall';

procedure FormMouseDown(Sender: TObject; Button: TMouseButton; Shift: TShiftState; X, Y: Integer);
begin
  if Button = mbLeft then
  begin
    ReleaseCapture;
    SendMessage(WizardForm.Handle, WM_SYSCOMMAND, $F012, 0);
  end;
end;

procedure CloseButtonClick(Sender: TObject);
begin
  AnimateWindow(WizardForm.Handle, 250, AW_BLEND or AW_HIDE);
  WizardForm.Close;
end;

procedure StartInstall(Sender: TObject);
var
  SelectedDirectory: string;
begin
  SelectedDirectory := ExpandConstant('{localappdata}\Rino');
  if BrowseForFolder('请选择 Rino 的安装目标文件夹：', SelectedDirectory, True) then
  begin
    WizardForm.DirEdit.Text := SelectedDirectory;
    InstallButton.Hide;
    InstallButtonLabel.Hide;
    StatusLabel.Caption := '正在写入文件，请稍候...';
    StatusLabel.Show;
    WizardForm.ProgressGauge.Parent := WizardForm;
    WizardForm.ProgressGauge.Left := 80;
    WizardForm.ProgressGauge.Top := 315;
    WizardForm.ProgressGauge.Width := 590;
    WizardForm.ProgressGauge.Height := 5;
    WizardForm.ProgressGauge.Show;
    WizardForm.NextButton.OnClick(WizardForm);
  end;
end;

procedure InitializeWizard;
var
  WindowRegion: LongWord;
  BorderBitmapPath: string;
begin
  WizardForm.BorderStyle := bsNone;
  WizardForm.Width := 750;
  WizardForm.Height := 500;
  WizardForm.Color := $EFF3F6;
  WindowRegion := CreateRoundRectRgn(0, 0, 750, 500, 18, 18);
  SetWindowRgn(WizardForm.Handle, WindowRegion, True);

  WizardForm.BackButton.Hide;
  WizardForm.BackButton.Left := 9999;
  WizardForm.BackButton.Top := 9999;
  WizardForm.NextButton.Hide;
  WizardForm.NextButton.Left := 9999;
  WizardForm.NextButton.Top := 9999;
  WizardForm.CancelButton.Hide;
  WizardForm.CancelButton.Left := 9999;
  WizardForm.CancelButton.Top := 9999;
  WizardForm.Bevel.Hide;
  WizardForm.WelcomeLabel1.Caption := '';
  WizardForm.WelcomeLabel1.Hide;
  WizardForm.WelcomeLabel2.Caption := '';
  WizardForm.WelcomeLabel2.Hide;
  WizardForm.PageNameLabel.Caption := '';
  WizardForm.PageNameLabel.Hide;
  WizardForm.PageDescriptionLabel.Caption := '';
  WizardForm.PageDescriptionLabel.Hide;
  WizardForm.OuterNotebook.Hide;

  DragHandle := TLabel.Create(WizardForm);
  DragHandle.Parent := WizardForm;
  DragHandle.Left := 0;
  DragHandle.Top := 0;
  DragHandle.Width := 750;
  DragHandle.Height := 65;
  DragHandle.Transparent := True;
  DragHandle.Caption := '';
  DragHandle.OnMouseDown := @FormMouseDown;

  CloseButtonLabel := TLabel.Create(WizardForm);
  CloseButtonLabel.Parent := WizardForm;
  CloseButtonLabel.Caption := #215;
  CloseButtonLabel.Font.Name := 'Segoe UI';
  CloseButtonLabel.Font.Size := 12;
  CloseButtonLabel.Font.Color := $6C635F;
  CloseButtonLabel.Left := 715;
  CloseButtonLabel.Top := 20;
  CloseButtonLabel.Cursor := crHand;
  CloseButtonLabel.OnClick := @CloseButtonClick;

  TitleLabel := TLabel.Create(WizardForm);
  TitleLabel.Parent := WizardForm;
  TitleLabel.Caption := 'Rino';
  TitleLabel.Font.Name := 'Segoe UI';
  TitleLabel.Font.Size := 32;
  TitleLabel.Font.Style := [fsBold];
  TitleLabel.Font.Color := $251E1B;
  TitleLabel.Left := 80;
  TitleLabel.Top := 120;
  TitleLabel.Transparent := True;
  TitleLabel.OnMouseDown := @FormMouseDown;

  ExtractTemporaryFile('btn_border.bmp');
  BorderBitmapPath := ExpandConstant('{tmp}\btn_border.bmp');
  InstallButton := TBitmapImage.Create(WizardForm);
  InstallButton.Parent := WizardForm;
  InstallButton.Width := 162;
  InstallButton.Height := 44;
  InstallButton.Left := 80;
  InstallButton.Top := 290;
  InstallButton.Bitmap.LoadFromFile(BorderBitmapPath);
  InstallButton.Cursor := crHand;
  InstallButton.OnClick := @StartInstall;

  InstallButtonLabel := TLabel.Create(WizardForm);
  InstallButtonLabel.Parent := WizardForm;
  InstallButtonLabel.AutoSize := False;
  InstallButtonLabel.Width := 162;
  InstallButtonLabel.Height := 32;
  InstallButtonLabel.Left := 80;
  InstallButtonLabel.Top := 296;
  InstallButtonLabel.Alignment := taCenter;
  InstallButtonLabel.Caption := #31435#21363#23433#35013;
  InstallButtonLabel.Font.Name := 'Microsoft YaHei';
  InstallButtonLabel.Font.Size := 11;
  InstallButtonLabel.Font.Style := [fsBold];
  InstallButtonLabel.Font.Color := $F7FAFC;
  InstallButtonLabel.Transparent := True;
  InstallButtonLabel.Cursor := crHand;
  InstallButtonLabel.OnClick := @StartInstall;

  StatusLabel := TLabel.Create(WizardForm);
  StatusLabel.Parent := WizardForm;
  StatusLabel.Caption := #20934#22791#20013#46#46#46;
  StatusLabel.Font.Name := 'Microsoft YaHei';
  StatusLabel.Font.Size := 9;
  StatusLabel.Font.Color := $5A504B;
  StatusLabel.Left := 80;
  StatusLabel.Top := 285;
  StatusLabel.Transparent := True;
  StatusLabel.Hide;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    StatusLabel.Caption := #23433#35013#23436#25104#65281#21551#21160#20013#46#46#46;
    Sleep(350);
    AnimateWindow(WizardForm.Handle, 300, AW_BLEND or AW_HIDE);
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpWelcome then
    AnimateWindow(WizardForm.Handle, 400, AW_BLEND or AW_ACTIVATE);
end;
