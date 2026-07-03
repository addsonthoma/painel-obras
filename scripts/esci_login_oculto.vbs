' Renova a sessao do e-SCI (login automatico via Playwright) SEM janela visivel.
' Usado pela tarefa diaria RodriguesESCILogin (08:25), logo antes do drill de leads (08:30).
' Atualiza os DOIS cookies: privado\esci_cookie.txt (obras) e o cookies.txt do drill de leads.
Dim sh, fso, log
log = "C:\Users\User\PainelObras\privado\esci_login.log"
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

' rotaciona o log se passar de ~200 KB (guarda 1 geracao em .old)
If fso.FileExists(log) Then
  If fso.GetFile(log).Size > 200000 Then
    If fso.FileExists(log & ".old") Then fso.DeleteFile log & ".old"
    fso.MoveFile log, log & ".old"
  End If
End If

' cabecalho com data/hora + saida do login no mesmo log
sh.Run "cmd /c (echo ===== %DATE% %TIME% ===== & python ""C:\Users\User\PainelObras\privado\esci_login.py"") >> """ & log & """ 2>&1", 0, True
