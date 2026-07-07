; DevTent portable installer hooks for electron-builder (assisted NSIS).
; Portable folder (e.g. P:\devtent) also holds www/, bin/, data/. Stock NSIS update
; runs "RMDir /r $INSTDIR" which wipes user data and causes busy-file restore loops.

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

Function dtRemoveAppBundle
  Call dtEnsureDevtentPath
  Delete "$INSTDIR\${PRODUCT_FILENAME}.exe"
  Delete "$INSTDIR\Uninstall ${PRODUCT_FILENAME}.exe"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\LICENSE*"
FunctionEnd

Function dtStopDevTentProcesses
  nsExec::ExecToLog `"$SYSDIR\cmd.exe" /c taskkill /F /IM "${PRODUCT_FILENAME}.exe" /FI "USERNAME eq %USERNAME%" 2>nul"`
  Pop $0
  nsExec::ExecToLog `"$SYSDIR\cmd.exe" /c taskkill /F /IM mysqld.exe /IM nginx.exe /IM httpd.exe /IM php-cgi.exe /IM php.exe /FI "USERNAME eq %USERNAME%" 2>nul"`
  Pop $0
  Sleep 1500
FunctionEnd

Function dtWriteInstallLock
  Call dtEnsureDevtentPath
  CreateDirectory "$INSTDIR"
  FileOpen $R9 "$INSTDIR\.devtent-install-in-progress" w
  FileWrite $R9 "1"
  FileClose $R9
FunctionEnd

Function dtClearInstallLock
  Call dtEnsureDevtentPath
  Delete "$INSTDIR\.devtent-install-in-progress"
FunctionEnd

Function dtSkipLegacyUninstaller
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" UninstallString
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" QuietUninstallString
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" UninstallString
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" QuietUninstallString
FunctionEnd

!macro customCheckAppRunning
  Call dtEnsureDevtentPath
  Call dtWriteInstallLock
  Call dtStopDevTentProcesses

  StrCpy $R1 0
  dt_kill_loop:
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    IntCmp $R0 0 0 dt_kill_done
    IntOp $R1 $R1 + 1
    IntCmp $R1 1 0 dt_kill_use_force
      nsExec::ExecToLog `"$SYSDIR\cmd.exe" /c taskkill /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
      Pop $0
      Goto dt_kill_after
    dt_kill_use_force:
      nsExec::ExecToLog `"$SYSDIR\cmd.exe" /c taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
      Pop $0
    dt_kill_after:
    Sleep 1000
    IntCmp $R1 8 dt_kill_done dt_kill_loop dt_kill_done
  dt_kill_done:

  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    ${if} ${isUpdated}
      Sleep 1000
      Goto dt_doStopProcess
    ${endIf}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK dt_doStopProcess
    Quit

    dt_doStopProcess:
    Call dtStopDevTentProcesses
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY dt_doStopProcess
      Quit
    ${endIf}
  ${endIf}

  Call dtSkipLegacyUninstaller
  Call dtRemoveAppBundle
!macroend

!macro customInstall
  Call dtWriteInstallLock
!macroend

Function .onInstSuccess
  Call dtClearInstallLock
FunctionEnd

Function .onInstFailed
  Call dtClearInstallLock
FunctionEnd

!macro customInit
  ReadRegStr $R0 HKCU "Software\${APP_GUID}" InstallLocation
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
  !define MUI_WELCOMEPAGE_TEXT "Install ${PRODUCT_NAME} to one portable folder.$\r$\n$\r$\nDefault location: {drive}:\devtent (e.g. c:\devtent). Projects, runtimes, and databases all live in that folder.$\r$\n$\r$\nQuit DevTent from the system tray before installing. The installer will try to close it automatically.$\r$\n$\r$\nThis build is open source and unsigned. If Windows SmartScreen appears, choose More info, then Run anyway — the app is safe; signing certificates are expensive for indie projects."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "Installation Complete"
  !define MUI_FINISHPAGE_TEXT "${PRODUCT_NAME} is installed.$\r$\n$\r$\nLaunch from the Start Menu or desktop shortcut. Sites use *.localhost by default — no hosts file admin needed.$\r$\n$\r$\nIf SmartScreen warns on first launch: More info, then Run anyway. You can verify releases on GitHub (DubStepMad/devtent)."
  !insertmacro MUI_PAGE_FINISH
!macroend

!else

Function un.dtRemoveAppBundle
  Delete "$INSTDIR\${PRODUCT_FILENAME}.exe"
  Delete "$INSTDIR\Uninstall ${PRODUCT_FILENAME}.exe"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\LICENSE*"
FunctionEnd

Function un.dtStopDevTentProcesses
  nsExec::ExecToLog `"$SYSDIR\cmd.exe" /c taskkill /F /IM "${PRODUCT_FILENAME}.exe" /FI "USERNAME eq %USERNAME%" 2>nul"`
  Pop $0
  nsExec::ExecToLog `"$SYSDIR\cmd.exe" /c taskkill /F /IM mysqld.exe /IM nginx.exe /IM httpd.exe /IM php-cgi.exe /IM php.exe /FI "USERNAME eq %USERNAME%" 2>nul"`
  Pop $0
  Sleep 1500
FunctionEnd

!macro customRemoveFiles
  Call un.dtStopDevTentProcesses
  Call un.dtRemoveAppBundle
!macroend

!endif
