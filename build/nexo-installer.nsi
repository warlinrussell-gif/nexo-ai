; ─────────────────────────────────────────────────────────────
;  Nexo AI — Instalador para Windows (NSIS, Modern UI 2)
;  Compilar:  makensis -DVERSION=1.0.0 -DSRC=<win-unpacked> -DOUTFILE=<salida.exe> nexo-installer.nsi
; ─────────────────────────────────────────────────────────────
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user

!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!ifndef SRC
  !define SRC "..\release\win-unpacked"
!endif
!ifndef OUTFILE
  !define OUTFILE "..\release\NexoAI-Setup-${VERSION}.exe"
!endif

!define APP_NAME "Nexo AI"
!define APP_EXE "NexoAI.exe"
!define APP_ID "ai.nexo.studio"
!define PUBLISHER "Nexo AI"
!define UNINST_EXE "Desinstalar Nexo AI.exe"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

Name "${APP_NAME}"
Caption "Instalar ${APP_NAME} ${VERSION}"
BrandingText "${APP_NAME} ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Nexo AI"
InstallDirRegKey HKCU "Software\${APP_ID}" "InstallDir"
ShowInstDetails nevershow
ShowUninstDetails nevershow

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1034 "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=1034 "FileDescription" "Instalador de ${APP_NAME}"
VIAddVersionKey /LANG=1034 "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=1034 "LegalCopyright" "${PUBLISHER}"
VIAddVersionKey /LANG=1034 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1034 "ProductVersion" "${VERSION}"

; ── Apariencia ──
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "installer-sidebar.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "installer-sidebar.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "installer-header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "installer-header.bmp"
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "¿Seguro que quieres cancelar la instalación de ${APP_NAME}?"
!define MUI_COMPONENTSPAGE_SMALLDESC

; ── Páginas del instalador ──
!define MUI_WELCOMEPAGE_TITLE "Bienvenido a ${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT "Este asistente instalará ${APP_NAME} ${VERSION}: tu estudio de IA con modelos locales y en la nube, agentes con acceso a tu ordenador, MCP, skills, navegador integrado y voz (modo JARVIS).$\r$\n$\r$\nEn el siguiente paso podrás elegir el disco y la carpeta. Los modelos que descargues se guardarán dentro de esa carpeta (en NexoData), así que elige un disco con espacio suficiente (se recomiendan 20 GB o más).$\r$\n$\r$\nPulsa Siguiente para continuar."
!insertmacro MUI_PAGE_WELCOME

!define MUI_DIRECTORYPAGE_TEXT_TOP "Elige dónde instalar ${APP_NAME}. Puedes usar cualquier disco (por ejemplo D:\Nexo AI).$\r$\n$\r$\nImportante: la carpeta de datos (NexoData) con los modelos, motores y voces se creará dentro de esta carpeta. Podrás cambiarla más tarde desde Ajustes → Almacenamiento."
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "Carpeta de instalación"
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirLeave
!insertmacro MUI_PAGE_DIRECTORY

!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TITLE "${APP_NAME} está listo"
!define MUI_FINISHPAGE_TEXT "${APP_NAME} se ha instalado correctamente.$\r$\n$\r$\nAl abrirlo por primera vez, un asistente analizará tu equipo, instalará el motor adecuado para tu GPU y te recomendará los mejores modelos."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir ${APP_NAME} ahora"
!insertmacro MUI_PAGE_FINISH

; ── Páginas del desinstalador ──
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "Spanish"
!insertmacro MUI_LANGUAGE "English"

; ── Comprobación de la carpeta elegida ──
Function DirLeave
  ClearErrors
  CreateDirectory "$INSTDIR"
  FileOpen $0 "$INSTDIR\.nexo-write-test" w
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "No se puede escribir en:$\r$\n$INSTDIR$\r$\n$\r$\nElige otra carpeta (por ejemplo en otro disco o dentro de tu carpeta de usuario) o ejecuta el instalador como administrador."
    Abort
  ${EndIf}
  FileClose $0
  Delete "$INSTDIR\.nexo-write-test"
  ${GetRoot} "$INSTDIR" $1
  ${DriveSpace} "$1\" "/D=F /S=G" $2
  ${If} $2 < 8
    MessageBox MB_YESNO|MB_ICONQUESTION "El disco $1 solo tiene $2 GB libres. Los modelos de IA ocupan entre 1 y 40 GB cada uno.$\r$\n$\r$\n¿Continuar de todas formas?" IDYES +2
    Abort
  ${EndIf}
FunctionEnd

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "${APP_NAME} requiere Windows de 64 bits."
    Abort
  ${EndIf}
FunctionEnd

; ── Secciones ──
Section "${APP_NAME} (requerido)" SecApp
  SectionIn RO
  ; Cerrar la aplicación si está abierta
  nsExec::Exec 'taskkill /IM "${APP_EXE}" /F'
  Sleep 800
  SetOutPath "$INSTDIR"
  ; Quitar restos de una versión anterior (conservando NexoData)
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${SRC}\*.*"
  CreateDirectory "$INSTDIR\NexoData"
  WriteUninstaller "$INSTDIR\${UNINST_EXE}"

  ; Menú Inicio
  CreateShortCut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "${APP_NAME}"

  ; Registro (desinstalación desde Configuración de Windows)
  WriteRegStr HKCU "Software\${APP_ID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\${UNINST_EXE}"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINST_EXE}" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K /G=0" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "Acceso directo en el escritorio" SecDesktop
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "${APP_NAME}"
SectionEnd

Section /o "Iniciar con Windows (en la bandeja, para JARVIS y atajos)" SecStartup
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_NAME}" '"$INSTDIR\${APP_EXE}" --hidden'
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecApp} "Aplicación principal de ${APP_NAME}."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Crea un acceso directo en el escritorio."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStartup} "Abre Nexo minimizado en la bandeja al iniciar sesión (útil para el modo JARVIS y el atajo de voz)."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ── Desinstalación ──
Section "Uninstall"
  nsExec::Exec 'taskkill /IM "${APP_EXE}" /F'
  Sleep 800
  ; Borrar la aplicación conservando NexoData
  FindFirst $0 $1 "$INSTDIR\*.*"
  un_loop:
    StrCmp $1 "" un_done
    StrCmp $1 "." un_next
    StrCmp $1 ".." un_next
    StrCmp $1 "NexoData" un_next
    StrCmp $1 "${UNINST_EXE}" un_next
    IfFileExists "$INSTDIR\$1\*.*" 0 un_file
      RMDir /r "$INSTDIR\$1"
      Goto un_next
    un_file:
      Delete "$INSTDIR\$1"
  un_next:
    FindNext $0 $1
    Goto un_loop
  un_done:
  FindClose $0

  IfFileExists "$INSTDIR\NexoData\*.*" 0 un_nodata
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "¿Eliminar también tus modelos, chats y ajustes guardados en:$\r$\n$INSTDIR\NexoData ?$\r$\n$\r$\nElige 'No' para conservarlos (recomendado si vas a reinstalar)." /SD IDNO IDNO un_nodata
    RMDir /r "$INSTDIR\NexoData"
    RMDir /r "$APPDATA\Nexo AI"
  un_nodata:

  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_NAME}"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APP_ID}"
  Delete "$INSTDIR\${UNINST_EXE}"
  RMDir "$INSTDIR"
SectionEnd
