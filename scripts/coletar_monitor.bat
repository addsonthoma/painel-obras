@echo off
REM Coletor do monitoramento e-SCI — rodar a cada 2 dias pelo Agendador do Windows.
REM Precisa do Chrome logado no e-SCI (p/ o cookies.txt) OU rodar como admin.
cd /d C:\Users\User\PainelObras
python scripts\coletar_monitor.py >> privado\coletar_monitor.log 2>&1
exit /b 0
