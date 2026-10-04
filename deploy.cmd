@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 출산가방 체크리스트 배포 ===
git rev-parse --is-inside-work-tree >nul 2>&1 || (echo [오류] git 저장소가 아닙니다. & pause & exit /b 1)
git add -A
git diff --cached --quiet && (echo 변경 사항이 없습니다. 이미 최신 상태입니다. & pause & exit /b 0)
for /f "tokens=1-3 delims=/.- " %%a in ("%date%") do set D=%%a-%%b-%%c
set T=%time:~0,5%
set T=%T: =0%
git commit -m "업데이트 %D% %T%" || (echo [오류] 커밋에 실패했습니다. & pause & exit /b 1)
git push origin main || (echo [오류] push에 실패했습니다. 인터넷 연결이나 GitHub 로그인 상태를 확인하세요. & pause & exit /b 1)
echo.
echo 완료! 1~2분 뒤 아래 주소에서 확인하세요. (이전 화면이 보이면 Ctrl+Shift+R)
echo https://kkkkkijun.github.io/luckybbu/
pause
