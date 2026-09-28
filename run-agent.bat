@echo off
setlocal
title SwiftView Native Agent

set "EXE_PATH=%~dp0agent\target\release\swiftview-agent.exe"

if not exist "%EXE_PATH%" (
    echo [SwiftView] Building native Windows binary...
    pushd "%~dp0agent"
    cargo build --release
    popd
)

if exist "%EXE_PATH%" (
    echo [SwiftView] Running SwiftView Agent...
    "%EXE_PATH%" %*
) else (
    echo [Error] Failed to locate or build swiftview-agent.exe
    pause
)
