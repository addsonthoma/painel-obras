' Lanca o coletor do monitoramento SEM janela e DESTACADO do console da tarefa.
' Motivo (incidente 26/08-01/09/2026): rodando o .bat direto pela tarefa, o
' processo morria com 0xC000013A (STATUS_CONTROL_C_EXIT) logo apos iniciar --
' ficaram 7 dias sem coleta e o painel seguia mostrando dado velho.
' Mesmo tratamento que ja resolveu isso no drill de leads (drill_oculto.vbs).
Dim sh, here
Set sh = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.Run """" & here & "coletar_monitor.bat""", 0, False
