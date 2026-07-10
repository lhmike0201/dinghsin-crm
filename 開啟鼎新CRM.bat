@echo off
chcp 65001 >nul
title 鼎新 ERP 客戶需求蒐集

cd /d "C:\Users\LHmik\OneDrive\桌面\Claude code\dinghsin_crm"

netstat -an | findstr ":8899 " >nul 2>&1
if %errorlevel% equ 0 (
    echo 伺服器已在運行
) else (
    echo 啟動伺服器中...
    start "鼎新CRM伺服器" /min python -m http.server 8899
    timeout /t 2 /nobreak >nul
)

echo 開啟瀏覽器...
start "" http://localhost:8899
exit
