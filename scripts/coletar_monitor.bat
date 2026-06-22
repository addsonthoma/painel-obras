@echo off
REM Coletor do monitoramento e-SCI — rodar a cada 2 dias pelo Agendador do Windows.
REM 1) Renova a sessao do e-SCI sozinho (Playwright + perfil salvo em privado\esci_profile).
REM 2) Coleta autos/funcionamento e grava no Supabase (le o esci_cookie.txt renovado).
cd /d C:\Users\User\PainelObras
echo ===== %DATE% %TIME% ===== >> privado\coletar_monitor.log
python privado\esci_login.py >> privado\coletar_monitor.log 2>&1
python scripts\coletar_monitor.py >> privado\coletar_monitor.log 2>&1
exit /b 0
