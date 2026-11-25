!include "StrFunc.nsh"
!include "WinMessages.nsh"

!ifdef BUILD_UNINSTALLER
  ${UnStrRep}
!else
  ${StrStr}
  ${StrRep}
!endif

!macro customInstall
  StrCpy $4 "$INSTDIR\resources\bin"
  ReadRegStr $3 HKCU "Software\Eido" "CliPathEntryOwner"
  StrCmp $3 "" eido_path_install_check
  StrCmp $3 "$4" eido_path_install_check
  ; A marker for another install root is evidence that Eido owned that old
  ; entry. Retire only that recorded entry before considering the new root.
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCmp $0 "" eido_path_install_clear_stale_owner
  StrCpy $1 ";$0;"
  ${StrRep} $1 "$1" ";$3;" ";"
  StrCpy $1 "$1" "" 1
  StrLen $2 "$1"
  IntOp $2 $2 - 1
  StrCpy $1 "$1" $2
  WriteRegExpandStr HKCU "Environment" "Path" "$1"
eido_path_install_clear_stale_owner:
  DeleteRegValue HKCU "Software\Eido" "CliPathEntryOwner"
  StrCpy $3 ""
eido_path_install_check:
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 ";$0;"
  ${StrStr} $2 "$1" ";$4;"
  StrCmp $2 "" 0 eido_path_install_existing
  StrCmp $0 "" 0 +3
    StrCpy $0 "$4"
    Goto eido_path_install_write
  StrCpy $0 "$0;$4"
eido_path_install_write:
  WriteRegExpandStr HKCU "Environment" "Path" "$0"
  WriteRegStr HKCU "Software\Eido" "CliPathEntryOwner" "$4"
  Goto eido_path_install_broadcast
eido_path_install_existing:
  ; Preserve a matching marker across upgrades. A path entry that predates
  ; Eido remains unowned and must survive uninstall.
  StrCmp $3 "$4" eido_path_install_broadcast
  DeleteRegValue HKCU "Software\Eido" "CliPathEntryOwner"
eido_path_install_broadcast:
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customUnInstall
  StrCpy $4 "$INSTDIR\resources\bin"
  ReadRegStr $3 HKCU "Software\Eido" "CliPathEntryOwner"
  StrCmp $3 "$4" 0 eido_path_uninstall_done
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCmp $0 "" eido_path_uninstall_delete
  StrCpy $1 ";$0;"
  ${UnStrRep} $1 "$1" ";$4;" ";"
  StrCpy $1 "$1" "" 1
  StrLen $2 "$1"
  IntOp $2 $2 - 1
  StrCpy $1 "$1" $2
  WriteRegExpandStr HKCU "Environment" "Path" "$1"
eido_path_uninstall_delete:
  DeleteRegValue HKCU "Software\Eido" "CliPathEntryOwner"
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
eido_path_uninstall_done:
!macroend
