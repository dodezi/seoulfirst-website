@echo off
chcp 65001 >nul
title [실제 운영] seoulfirst-ba9d4 배포
echo.
echo ############################################################
echo #                                                          #
echo #   !! 실제 운영(REAL) 배포 !!   프로젝트: seoulfirst-ba9d4  #
echo #   환자/직원이 실제로 사용하는 시스템입니다.              #
echo #                                                          #
echo ############################################################
echo.
echo  * 홈페이지/화면(HTML,CSS,JS)은 배포 불필요 - git push 하면 자동 반영됩니다.
echo  * 이 스크립트는 functions / firestore 규칙 변경 시에만 사용하세요.
echo.
set /p name=" 정말 운영에 배포하려면 프로젝트명을 정확히 입력하세요: "
if not "%name%"=="seoulfirst-ba9d4" ( echo. & echo  [취소됨] 입력이 일치하지 않습니다. & pause & exit /b )
echo.
echo  무엇을 배포할까요?
echo    1 = functions (서버 기능: 알림톡/리마인더 등)
echo    2 = firestore 규칙 (권한 규칙)
echo    3 = functions + firestore 규칙 (둘 다)
set /p sel=" 번호 입력: "
if "%sel%"=="1" set ONLY=functions
if "%sel%"=="2" set ONLY=firestore:rules
if "%sel%"=="3" set ONLY=functions,firestore:rules
if "%ONLY%"=="" ( echo  [취소됨] 잘못된 선택. & pause & exit /b )
echo.
echo  최신 코드 받는 중...
call git pull
echo.
echo  운영 배포 중 (%ONLY%) ...
call firebase deploy --only %ONLY% --project seoulfirst-ba9d4
echo.
echo  완료.
pause
