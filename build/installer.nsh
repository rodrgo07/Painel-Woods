; Ao desinstalar, oferece apagar os dados do usuário.
; Em atualização (instalar por cima) ou no modo silencioso (/S), os dados ficam.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Sem isto, $APPDATA pode apontar para C:\ProgramData e a pasta do usuário não é apagada
    SetShellVarContext current
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Apagar também os dados do Painel Woods?$\r$\n$\r$\nIsso remove as configurações, as conversas e a cópia do WOODS em $APPDATA\PainelWoods, incluindo leads que ainda não foram publicados." /SD IDNO IDNO manterDados
      RMDir /r "$APPDATA\PainelWoods"
    manterDados:
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endIf}
  ${endIf}
!macroend
