@echo off
REM ===================================================================
REM Coletor do monitoramento e-SCI.
REM
REM NAO chama mais o esci_login.py aqui. Motivo (incidente 26/08-01/09/2026):
REM o login abre um navegador (Playwright) com o perfil privado\esci_profile,
REM e a tarefa RodriguesESCILogin usa O MESMO perfil. As duas se atrapalhavam
REM e o processo morria em segundos (0xC000013A), sem coletar nada -- ficaram
REM 7 dias sem coleta e o painel seguia mostrando dado velho.
REM
REM Agora a ordem e: 08:25 RodriguesESCILogin renova o cookie ->
REM 08:35 este .bat so LE o cookie e coleta (rapido, sem abrir navegador).
REM ===================================================================
cd /d C:\Users\User\PainelObras
echo ===== %DATE% %TIME% ===== >> privado\coletar_monitor.log
python -u scripts\coletar_monitor.py >> privado\coletar_monitor.log 2>&1
exit /b 0
