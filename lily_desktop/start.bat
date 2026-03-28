@echo off
chcp 65001 >nul

curl -s http://localhost:50021/version >nul 2>&1
if not errorlevel 1 (
    echo VOICEVOX は既に起動しています
) else (
    echo VOICEVOX を起動中...
    start "" "C:\Users\aku_s\AppData\Local\Programs\VOICEVOX\VOICEVOX.exe"
    echo VOICEVOX の起動を待機中...
    :wait_loop
    timeout /t 2 /nobreak >nul
    curl -s http://localhost:50021/version >nul 2>&1
    if errorlevel 1 goto wait_loop
    echo VOICEVOX 起動完了
)

echo リリィデスクトップを起動中...
cd /d "%~dp0"
python main.py
