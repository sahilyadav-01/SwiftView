# SwiftView Native Windows Input Bridge
# Reads JSON lines from STDIN and synthesizes OS-level mouse and keyboard events

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$csharp = @"
using System;
using System.Runtime.InteropServices;

public class Win32Input {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    // Mouse event flags
    public const uint MOUSEEVENTF_MOVE = 0x0001;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

    // Keyboard flags
    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    public const uint KEYEVENTF_KEYUP = 0x0002;
}
"@

Add-Type -TypeDefinition $csharp -ErrorAction SilentlyContinue

$screenWidth = [Win32Input]::GetSystemMetrics(0)
$screenHeight = [Win32Input]::GetSystemMetrics(1)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::WriteLine("READY width=$screenWidth height=$screenHeight")

while ($line = [Console]::ReadLine()) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line -eq "QUIT") { break }

    try {
        $msg = $line | ConvertFrom-Json
        $type = $msg.type

        if ($type -eq "mouse") {
            $action = $msg.action
            if ($action -eq "move") {
                $targetX = [int][Math]::Round($msg.x * $screenWidth)
                $targetY = [int][Math]::Round($msg.y * $screenHeight)
                [void][Win32Input]::SetCursorPos($targetX, $targetY)
            }
            elseif ($action -eq "down") {
                $btn = $msg.button
                if ($msg.x -ne $null -and $msg.y -ne $null) {
                    $targetX = [int][Math]::Round($msg.x * $screenWidth)
                    $targetY = [int][Math]::Round($msg.y * $screenHeight)
                    [void][Win32Input]::SetCursorPos($targetX, $targetY)
                }
                if ($btn -eq 0 -or $btn -eq "left") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                }
                elseif ($btn -eq 2 -or $btn -eq "right") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                }
                elseif ($btn -eq 1 -or $btn -eq "middle") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, [UIntPtr]::Zero)
                }
            }
            elseif ($action -eq "up") {
                $btn = $msg.button
                if ($btn -eq 0 -or $btn -eq "left") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
                }
                elseif ($btn -eq 2 -or $btn -eq "right") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
                }
                elseif ($btn -eq 1 -or $btn -eq "middle") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_MIDDLEUP, 0, 0, 0, [UIntPtr]::Zero)
                }
            }
            elseif ($action -eq "click") {
                if ($msg.x -ne $null -and $msg.y -ne $null) {
                    $targetX = [int][Math]::Round($msg.x * $screenWidth)
                    $targetY = [int][Math]::Round($msg.y * $screenHeight)
                    [void][Win32Input]::SetCursorPos($targetX, $targetY)
                }
                if ($btn -eq 2 -or $btn -eq "right") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                    Start-Sleep -Milliseconds 15
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
                }
                else {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                    Start-Sleep -Milliseconds 15
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
                }
            }
            elseif ($action -eq "dblclick") {
                if ($msg.x -ne $null -and $msg.y -ne $null) {
                    $targetX = [int][Math]::Round($msg.x * $screenWidth)
                    $targetY = [int][Math]::Round($msg.y * $screenHeight)
                    [void][Win32Input]::SetCursorPos($targetX, $targetY)
                }
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
                Start-Sleep -Milliseconds 40
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
            }
        }
        elseif ($type -eq "wheel") {
            $deltaY = [int]$msg.dy
            # Windows wheel delta: 120 per notch, negative dy in web = scroll down
            $wheelAmount = [int](-$deltaY * 2)
            if ($wheelAmount -eq 0) { $wheelAmount = if ($deltaY -gt 0) { -120 } else { 120 } }
            [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_WHEEL, 0, 0, [uint]$wheelAmount, [UIntPtr]::Zero)
        }
        elseif ($type -eq "key") {
            $key = $msg.key
            $text = $msg.text
            $special = $msg.special

            if ($special) {
                switch ($special.ToLower()) {
                    "enter"     { [System.Windows.Forms.SendKeys]::SendWait("{ENTER}") }
                    "backspace" { [System.Windows.Forms.SendKeys]::SendWait("{BACKSPACE}") }
                    "tab"       { [System.Windows.Forms.SendKeys]::SendWait("{TAB}") }
                    "escape"    { [System.Windows.Forms.SendKeys]::SendWait("{ESC}") }
                    "esc"       { [System.Windows.Forms.SendKeys]::SendWait("{ESC}") }
                    "up"        { [System.Windows.Forms.SendKeys]::SendWait("{UP}") }
                    "down"      { [System.Windows.Forms.SendKeys]::SendWait("{DOWN}") }
                    "left"      { [System.Windows.Forms.SendKeys]::SendWait("{LEFT}") }
                    "right"     { [System.Windows.Forms.SendKeys]::SendWait("{RIGHT}") }
                    "ctrl+c"    { [System.Windows.Forms.SendKeys]::SendWait("^c") }
                    "ctrl+v"    { [System.Windows.Forms.SendKeys]::SendWait("^v") }
                    "ctrl+a"    { [System.Windows.Forms.SendKeys]::SendWait("^a") }
                    "ctrl+z"    { [System.Windows.Forms.SendKeys]::SendWait("^z") }
                    "delete"    { [System.Windows.Forms.SendKeys]::SendWait("{DEL}") }
                    "home"      { [System.Windows.Forms.SendKeys]::SendWait("{HOME}") }
                    "end"       { [System.Windows.Forms.SendKeys]::SendWait("{END}") }
                    "win"       { [Win32Input]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 20; [Win32Input]::keybd_event(0x5B, 0, [Win32Input]::KEYEVENTF_KEYUP, [UIntPtr]::Zero) }
                }
            }
            elseif ($text) {
                # Escape SendKeys special characters: + ^ % ~ ( ) { } [ ]
                $escaped = [System.Text.RegularExpressions.Regex]::Replace($text, "([+^%~(){}[\]])", "{$1}")
                [System.Windows.Forms.SendKeys]::SendWait($escaped)
            }
            elseif ($key) {
                if ($key.Length -eq 1) {
                    $escaped = [System.Text.RegularExpressions.Regex]::Replace($key, "([+^%~(){}[\]])", "{$1}")
                    [System.Windows.Forms.SendKeys]::SendWait($escaped)
                }
                elseif ($key -eq "Enter") { [System.Windows.Forms.SendKeys]::SendWait("{ENTER}") }
                elseif ($key -eq "Backspace") { [System.Windows.Forms.SendKeys]::SendWait("{BACKSPACE}") }
                elseif ($key -eq "Tab") { [System.Windows.Forms.SendKeys]::SendWait("{TAB}") }
                elseif ($key -eq "Escape") { [System.Windows.Forms.SendKeys]::SendWait("{ESC}") }
                elseif ($key -eq "ArrowUp") { [System.Windows.Forms.SendKeys]::SendWait("{UP}") }
                elseif ($key -eq "ArrowDown") { [System.Windows.Forms.SendKeys]::SendWait("{DOWN}") }
                elseif ($key -eq "ArrowLeft") { [System.Windows.Forms.SendKeys]::SendWait("{LEFT}") }
                elseif ($key -eq "ArrowRight") { [System.Windows.Forms.SendKeys]::SendWait("{RIGHT}") }
            }
        }
        [Console]::WriteLine("OK")
    }
    catch {
        [Console]::WriteLine("ERR " + $_.Exception.Message)
    }
}
