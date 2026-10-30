param([string]$Source, [string]$Preview)
$ErrorActionPreference = "Stop"
Add-Type -Path $Source -ReferencedAssemblies System.Drawing, System.Windows.Forms
Add-Type -ReferencedAssemblies System.Drawing, System.Windows.Forms -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public sealed class MarkerBackdrop : Form {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    public MarkerBackdrop() {
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true;
        BackColor = Color.White; StartPosition = FormStartPosition.Manual;
        Bounds = new Rectangle(300, 220, 240, 140);
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
        get { CreateParams value = base.CreateParams; value.ExStyle |= 0x08000080; return value; }
    }
}
'@

# Opt-in visual integration fixture: no hooks, mouse movement, keys or user-home state.
[void][MarkerBackdrop]::SetProcessDPIAware()
$foreground = [MarkerBackdrop]::GetForegroundWindow()
$backdrop = New-Object MarkerBackdrop
$markerType = [Studio.Activity].GetNestedType("Marker", [System.Reflection.BindingFlags]::NonPublic)
$marker = [System.Activator]::CreateInstance($markerType, $true)
$actual = New-Object System.Drawing.Bitmap($marker.Width, $marker.Height)
$expected = New-Object System.Drawing.Bitmap($marker.Width, $marker.Height)
$graphics = [System.Drawing.Graphics]::FromImage($actual)
$expectedGraphics = [System.Drawing.Graphics]::FromImage($expected)
try {
    $backdrop.Show()
    [System.Windows.Forms.Application]::DoEvents()
    $point = New-Object System.Drawing.Point(360, 260)
    $area = [System.Windows.Forms.Screen]::FromPoint($point).Bounds
    $markerType.GetMethod("Follow").Invoke($marker, @($point, $area)) | Out-Null
    $marker.Show()
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 100
    $graphics.CopyFromScreen($marker.Location, [System.Drawing.Point]::Empty, $actual.Size)
    if ($Preview) { $actual.Save($Preview, [System.Drawing.Imaging.ImageFormat]::Png) }
    $expectedGraphics.Clear([System.Drawing.Color]::White)
    $hotspot = New-Object System.Drawing.Point(($point.X - $marker.Left), ($point.Y - $marker.Top))
    [Studio.Activity]::PaintCursor($expectedGraphics, $hotspot, $expected.Size)
    $arrow = $actual.GetPixel(($hotspot.X + 6), ($hotspot.Y + 8))
    $badge = $actual.GetPixel(($hotspot.X + 16), ($hotspot.Y + 39))
    $arrowExpected = $expected.GetPixel(($hotspot.X + 6), ($hotspot.Y + 8))
    $badgeExpected = $expected.GetPixel(($hotspot.X + 16), ($hotspot.Y + 39))
    [ordered]@{
        visible = $marker.Visible
        arrowComposited = $arrow.ToArgb() -eq $arrowExpected.ToArgb()
        badgeComposited = $badge.ToArgb() -eq $badgeExpected.ToArgb()
        focusPreserved = [MarkerBackdrop]::GetForegroundWindow() -eq $foreground
    } | ConvertTo-Json -Compress
} finally {
    $marker.Dispose(); $backdrop.Dispose()
    $graphics.Dispose(); $expectedGraphics.Dispose(); $actual.Dispose(); $expected.Dispose()
}
