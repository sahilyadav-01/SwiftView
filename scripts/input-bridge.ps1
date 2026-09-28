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

function Send-VirtualKey {
    param(
        [byte]$VirtualKey,
        [bool]$Extended = $false,
        [bool]$Control = $false,
        [bool]$Shift = $false,
        [bool]$Alt = $false,
        [bool]$Meta = $false
    )

    if ($Control) { [Win32Input]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero) }
    if ($Shift)   { [Win32Input]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero) }
    if ($Alt)     { [Win32Input]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero) }
    if ($Meta)    { [Win32Input]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero) }

    $downFlags = if ($Extended) { [Win32Input]::KEYEVENTF_EXTENDEDKEY } else { 0 }
    [Win32Input]::keybd_event($VirtualKey, 0, $downFlags, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 12
    [Win32Input]::keybd_event($VirtualKey, 0, ($downFlags -bor [Win32Input]::KEYEVENTF_KEYUP), [UIntPtr]::Zero)

    if ($Meta)    { [Win32Input]::keybd_event(0x5B, 0, [Win32Input]::KEYEVENTF_KEYUP, [UIntPtr]::Zero) }
    if ($Alt)     { [Win32Input]::keybd_event(0x12, 0, [Win32Input]::KEYEVENTF_KEYUP, [UIntPtr]::Zero) }
    if ($Shift)   { [Win32Input]::keybd_event(0x10, 0, [Win32Input]::KEYEVENTF_KEYUP, [UIntPtr]::Zero) }
    if ($Control) { [Win32Input]::keybd_event(0x11, 0, [Win32Input]::KEYEVENTF_KEYUP, [UIntPtr]::Zero) }
}

while ($line = [Console]::ReadLine()) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line -eq "QUIT") { break }

    try {
        $msg = $line | ConvertFrom-Json
        $type = $msg.type

        if ($type -eq "mouse") {
            $action = $msg.action
            $normX = if ($msg.x -ne $null) { [Math]::Max(0.0, [Math]::Min(1.0, [double]$msg.x)) } else { $null }
            $normY = if ($msg.y -ne $null) { [Math]::Max(0.0, [Math]::Min(1.0, [double]$msg.y)) } else { $null }

            if ($normX -ne $null -and $normY -ne $null) {
                $targetX = [int][Math]::Round($normX * $screenWidth)
                $targetY = [int][Math]::Round($normY * $screenHeight)
                [void][Win32Input]::SetCursorPos($targetX, $targetY)

                $absX = [uint][Math]::Round($normX * 65535)
                $absY = [uint][Math]::Round($normY * 65535)
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_ABSOLUTE -bor [Win32Input]::MOUSEEVENTF_MOVE, $absX, $absY, 0, [UIntPtr]::Zero)
            }

            if ($action -eq "move") {
                # Already moved above
            }
            elseif ($action -eq "down") {
                $btn = $msg.button
                if ($btn -eq 2 -or $btn -eq "right") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                }
                elseif ($btn -eq 1 -or $btn -eq "middle") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, [UIntPtr]::Zero)
                }
                else {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                }
            }
            elseif ($action -eq "up") {
                $btn = $msg.button
                if ($btn -eq 2 -or $btn -eq "right") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
                }
                elseif ($btn -eq 1 -or $btn -eq "middle") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_MIDDLEUP, 0, 0, 0, [UIntPtr]::Zero)
                }
                else {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
                }
            }
            elseif ($action -eq "click") {
                $btn = $msg.button
                if ($btn -eq 2 -or $btn -eq "right") {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                    Start-Sleep -Milliseconds 25
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
                }
                else {
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                    Start-Sleep -Milliseconds 25
                    [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
                }
            }
            elseif ($action -eq "dblclick") {
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
                Start-Sleep -Milliseconds 50
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
            $ctrl = [bool]$msg.ctrl
            $shift = [bool]$msg.shift
            $alt = [bool]$msg.alt
            $meta = [bool]$msg.meta

            if ($special) {
                switch ($special.ToLower()) {
                    "enter"      { Send-VirtualKey 0x0D $false $ctrl $shift $alt $meta }
                    "backspace"  { Send-VirtualKey 0x08 $false $ctrl $shift $alt $meta }
                    "tab"        { Send-VirtualKey 0x09 $false $ctrl $shift $alt $meta }
                    "escape"     { Send-VirtualKey 0x1B $false $ctrl $shift $alt $meta }
                    "esc"        { Send-VirtualKey 0x1B $false $ctrl $shift $alt $meta }
                    "up"         { Send-VirtualKey 0x26 $true $ctrl $shift $alt $meta }
                    "arrowup"    { Send-VirtualKey 0x26 $true $ctrl $shift $alt $meta }
                    "down"       { Send-VirtualKey 0x28 $true $ctrl $shift $alt $meta }
                    "arrowdown"  { Send-VirtualKey 0x28 $true $ctrl $shift $alt $meta }
                    "left"       { Send-VirtualKey 0x25 $true $ctrl $shift $alt $meta }
                    "arrowleft"  { Send-VirtualKey 0x25 $true $ctrl $shift $alt $meta }
                    "right"      { Send-VirtualKey 0x27 $true $ctrl $shift $alt $meta }
                    "arrowright" { Send-VirtualKey 0x27 $true $ctrl $shift $alt $meta }
                    "ctrl+c"     { Send-VirtualKey 0x43 $false $true $false $false $false }
                    "ctrl+v"     { Send-VirtualKey 0x56 $false $true $false $false $false }
                    "ctrl+a"     { Send-VirtualKey 0x41 $false $true $false $false $false }
                    "ctrl+z"     { Send-VirtualKey 0x5A $false $true $false $false $false }
                    "delete"     { Send-VirtualKey 0x2E $true $ctrl $shift $alt $meta }
                    "insert"     { Send-VirtualKey 0x2D $true $ctrl $shift $alt $meta }
                    "home"       { Send-VirtualKey 0x24 $true $ctrl $shift $alt $meta }
                    "end"        { Send-VirtualKey 0x23 $true $ctrl $shift $alt $meta }
                    "pageup"     { Send-VirtualKey 0x21 $true $ctrl $shift $alt $meta }
                    "pagedown"   { Send-VirtualKey 0x22 $true $ctrl $shift $alt $meta }
                    "win"        { Send-VirtualKey 0x5B $true $false $false $false $false }
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
