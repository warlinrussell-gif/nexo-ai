; Nexo AI — personalización del instalador NSIS
; Conserva la carpeta de datos (modelos, chats, ajustes) al actualizar o desinstalar.

!macro customRemoveFiles
  FindFirst $0 $1 "$INSTDIR\*.*"
  nexo_rm_loop:
    StrCmp $1 "" nexo_rm_done
    StrCmp $1 "." nexo_rm_next
    StrCmp $1 ".." nexo_rm_next
    StrCmp $1 "NexoData" nexo_rm_next
    IfFileExists "$INSTDIR\$1\*.*" 0 nexo_rm_file
      RMDir /r "$INSTDIR\$1"
      Goto nexo_rm_next
    nexo_rm_file:
      Delete "$INSTDIR\$1"
  nexo_rm_next:
    FindNext $0 $1
    Goto nexo_rm_loop
  nexo_rm_done:
  FindClose $0
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    IfFileExists "$INSTDIR\NexoData\*.*" 0 nexo_skip_data
      MessageBox MB_YESNO|MB_ICONQUESTION "¿Eliminar también tus modelos, chats y ajustes guardados en:$\r$\n$INSTDIR\NexoData ?$\r$\n$\r$\nElige 'No' para conservarlos (recomendado si vas a reinstalar)." /SD IDNO IDNO nexo_skip_data
      RMDir /r "$INSTDIR\NexoData"
    nexo_skip_data:
    RMDir "$INSTDIR"
  ${endIf}
!macroend
