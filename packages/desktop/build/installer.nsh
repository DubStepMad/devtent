; DevTent portable installer hooks for electron-builder (assisted NSIS).

!ifndef BUILD_UNINSTALLER

Function dtEnsureDevtentPath
  StrLen $R1 "\${APP_FILENAME}"
  StrLen $R2 $INSTDIR
  IntOp $R3 $R2 - $R1
  IntCmp $R3 0 dt_path_drive 0 0
  StrCpy $R0 $INSTDIR $R1 $R3
  StrCmp $R0 "\${APP_FILENAME}" 0 dt_path_drive
    StrCpy $INSTDIR $INSTDIR $R3
    StrCpy $R0 $INSTDIR 1 -1
    StrCmp $R0 "\" 0 +2
      StrCpy $INSTDIR $INSTDIR -1
  dt_path_drive:
  StrLen $R1 $INSTDIR
  IntCmp $R1 2 dt_use_letter 0 dt_path_done
  IntCmp $R1 3 0 dt_path_done
  StrCpy $R2 $INSTDIR 1 -1
  StrCmp $R2 "\" dt_use_letter dt_path_done
  dt_use_letter:
    StrCpy $R0 $INSTDIR 1
    StrCpy $INSTDIR "$R0:\devtent"
  dt_path_done:
FunctionEnd

Function dtCloseForInstall
  Call dtEnsureDevtentPath
  StrCpy $R8 "$INSTDIR"
  StrCpy $R8 "$R8\DevTent.exe"
  IfFileExists $R8 0 dt_skip_quit
    DetailPrint "Requesting ${PRODUCT_NAME} to quit..."
    ExecWait '$R8 --quit' $0
    Sleep 2000
  dt_skip_quit:
  nsExec::ExecToLog `"$SYSDIR\cmd.exe" /c taskkill /F /IM DevTent.exe /FI "USERNAME eq %USERNAME%"`
  Pop $0
  Sleep 1000
FunctionEnd

!macro customCheckAppRunning
  Call dtCloseForInstall
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK dt_kill_retry
    Quit
    dt_kill_retry:
    Call dtCloseForInstall
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY dt_kill_retry
      Quit
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInit
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R0 != ""
    StrCpy $INSTDIR $R0
  ${Else}
    ReadEnvStr $R0 SystemDrive
    StrCpy $INSTDIR "$R0\devtent"
  ${EndIf}
  Call dtEnsureDevtentPath
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Install ${PRODUCT_NAME}"
  !define MUI_WELCOMEPAGE_TEXT "Install ${PRODUCT_NAME} to one portable folder.$\r$\n$\r$\nDefault location: {drive}:\devtent (e.g. c:\devtent). Projects, runtimes, and databases all live in that folder.$\r$\n$\r$\nThe installer will try to close DevTent automatically. If prompted, end DevTent.exe in Task Manager (Details tab), then Retry.$\r$\n$\r$\nSmartScreen (unsigned): More info, then Run again."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "Installation Complete"
  !define MUI_FINISHPAGE_TEXT "${PRODUCT_NAME} is installed.$\r$\n$\r$\nLaunch from the Start Menu or desktop shortcut.$\r$\n$\r$\nSmartScreen on first launch: More info, then Run anyway."
  !insertmacro MUI_PAGE_FINISH
!macroend

!endif
