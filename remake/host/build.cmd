@echo off
setlocal
set "cc=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%cc%" set "cc=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
"%cc%" /nologo /optimize+ /target:winexe /reference:System.Windows.Forms.dll /out:"%~dp0..\SimCopterFlight.exe" "%~dp0SimCopterHost.cs"
exit /b %errorlevel%
