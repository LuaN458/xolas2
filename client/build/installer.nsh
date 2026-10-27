; Script de Personalização do Instalador NSIS do Xolas
; Aplica tema Obsidian Dark (#08090c / #12141a), Dark Mode nativo do Windows e barra de progresso Índigo (#6366f1)

!macro customInstall
  ${IfNot} ${Silent}
    ; 1. Ativar Dark Mode na barra de título da janela do instalador (Windows 10 Build 19041+ e Windows 11)
    ; DWMWA_USE_IMMERSIVE_DARK_MODE: 20 (Windows 11 / Windows 10 v2004+) e 19 (Windows 10 v1809-1909)
    System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)'
    System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, *i 1, i 4)'

    ; 2. Localizar o diálogo interno do instalador SpiderBanner
    FindWindow $R0 "#32770" "" $HWNDPARENT
    ${If} $R0 != 0
      ; Definir cor de fundo Obsidian Card (0x12141a) e texto branco suave (0xf9fafb)
      GetDlgItem $R1 $R0 1000 ; Texto de status ("Instalando, por favor aguarde...")
      ${If} $R1 != 0
        SetCtlColors $R1 "F9FAFB" "12141A"
      ${EndIf}
      SetCtlColors $R0 "F9FAFB" "12141A"

      ; 3. Barra de progresso: cor Índigo/Púrpura do Xolas (#6366f1) e trilho escuro
      GetDlgItem $R2 $R0 1004 ; msctls_progress32
      ${If} $R2 != 0
        ; PBM_SETBARCOLOR = 0x0409 (BGR: 0x00F16663)
        SendMessage $R2 0x0409 0 0x00F16663
        ; PBM_SETBKCOLOR = 0x2001 (BGR: 0x00130E0D)
        SendMessage $R2 0x2001 0 0x00130E0D
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
