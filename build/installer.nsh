!define CLIPCLIP_STARTUP_SHORTCUT "ClipClip.lnk"
!define CLIPCLIP_LEGACY_STARTUP_SHORTCUT "ClipClip Manager.lnk"

!macro customPageAfterChangeDir
  Var ClipClipStartupCheckbox
  Var ClipClipStartupSelected

  Page custom ClipClipStartupPage ClipClipStartupPageLeave

  Function ClipClipStartupPage
    ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} ${isUpdated}
    ${OrIf} $0 != ""
      StrCpy $ClipClipStartupSelected ${BST_UNCHECKED}
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "$(chooseInstallationOptions)" ""
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    StrCpy $0 "Start ClipClip automatically when signing in to Windows"
    ${If} $LANGUAGE == 1049
      StrCpy $0 "Запускать ClipClip автоматически при входе в Windows"
    ${EndIf}

    ${NSD_CreateCheckbox} 0u 10u 100% 20u "$0"
    Pop $ClipClipStartupCheckbox
    ; Set the default when the page first opens so silent installs skip it.
    ${If} $ClipClipStartupSelected == ""
      StrCpy $ClipClipStartupSelected ${BST_CHECKED}
    ${EndIf}
    ${NSD_SetState} $ClipClipStartupCheckbox $ClipClipStartupSelected
    ${NSD_OnClick} $ClipClipStartupCheckbox ClipClipStartupSelectionChanged
    nsDialogs::Show
  FunctionEnd

  Function ClipClipStartupSelectionChanged
    Pop $0
    ${NSD_GetState} $0 $ClipClipStartupSelected
  FunctionEnd

  Function ClipClipStartupPageLeave
    ${NSD_GetState} $ClipClipStartupCheckbox $ClipClipStartupSelected
  FunctionEnd
!macroend

!macro customInstall
  ; Keep the shortcut on updates and refresh its target if the install moved.
  StrCpy $0 "$perUserInstallationFolder"
  ${If} $installMode == "all"
    StrCpy $0 "$perMachineInstallationFolder"
  ${EndIf}

  ${If} ${FileExists} "$SMSTARTUP\${CLIPCLIP_LEGACY_STARTUP_SHORTCUT}"
    ; Windows keys its startup approval by shortcut name.
    CreateShortCut "$SMSTARTUP\${CLIPCLIP_LEGACY_STARTUP_SHORTCUT}" "$appExe" "--hidden"
  ${ElseIf} $ClipClipStartupSelected == ${BST_CHECKED}
    CreateShortCut "$SMSTARTUP\${CLIPCLIP_STARTUP_SHORTCUT}" "$appExe" "--hidden"
  ${ElseIf} ${FileExists} "$SMSTARTUP\${CLIPCLIP_STARTUP_SHORTCUT}"
  ${AndIf} $0 != "$INSTDIR"
    CreateShortCut "$SMSTARTUP\${CLIPCLIP_STARTUP_SHORTCUT}" "$appExe" "--hidden"
  ${EndIf}

  ; A machine-wide install can replace an existing current-user install.
  ${If} $installMode == "all"
  ${AndIf} $perUserInstallationFolder != ""
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $0 == ""
      SetShellVarContext current
      Delete "$SMSTARTUP\${CLIPCLIP_STARTUP_SHORTCUT}"
      Delete "$SMSTARTUP\${CLIPCLIP_LEGACY_STARTUP_SHORTCUT}"
      SetShellVarContext all
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    Delete "$SMSTARTUP\${CLIPCLIP_STARTUP_SHORTCUT}"
    Delete "$SMSTARTUP\${CLIPCLIP_LEGACY_STARTUP_SHORTCUT}"
  ${EndIf}
!macroend
