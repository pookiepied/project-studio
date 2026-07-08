#Requires -Version 5.1
<#
.SYNOPSIS
  Generates NSIS BMP artwork for STUDIO.

.OUTPUTS
  src-tauri/installer-assets/sidebar.bmp  - 164 x 314 px
  src-tauri/installer-assets/header.bmp   - 150 x  57 px
#>

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$scriptDir = $PSScriptRoot
$root = Join-Path $scriptDir ".."
$assetsDir = Join-Path $root "src-tauri\installer-assets"
$confPath = Join-Path $root "src-tauri\tauri.conf.json"

if (-not (Test-Path $assetsDir)) {
    New-Item -ItemType Directory -Path $assetsDir | Out-Null
}

$white = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
$charcoal = [System.Drawing.Color]::FromArgb(255, 17, 24, 39)
$divider = [System.Drawing.Color]::FromArgb(255, 245, 245, 245)

function New-RoundedRectPath {
    param(
        [float]$X,
        [float]$Y,
        [float]$W,
        [float]$H,
        [float]$R
    )

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $R * 2
    $path.AddArc($X, $Y, $d, $d, 180, 90)
    $path.AddArc(($X + $W - $d), $Y, $d, $d, 270, 90)
    $path.AddArc(($X + $W - $d), ($Y + $H - $d), $d, $d, 0, 90)
    $path.AddArc($X, ($Y + $H - $d), $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function Fill-RoundedRect {
    param(
        [System.Drawing.Graphics]$Graphics,
        [System.Drawing.Brush]$Brush,
        [float]$X,
        [float]$Y,
        [float]$W,
        [float]$H,
        [float]$R
    )

    $path = New-RoundedRectPath -X $X -Y $Y -W $W -H $H -R $R
    $Graphics.FillPath($Brush, $path)
    $path.Dispose()
}

function Draw-StudioMark {
    param(
        [System.Drawing.Graphics]$Graphics,
        [System.Drawing.Brush]$Brush,
        [float]$OriginX,
        [float]$OriginY,
        [float]$Scale
    )

    $tiles = @(
        @(25, 8),
        @(47, 30),
        @(25, 52),
        @(47, 74),
        @(25, 96)
    )

    foreach ($tile in $tiles) {
        $x = $OriginX + ([float]$tile[0] * $Scale)
        $y = $OriginY + ([float]$tile[1] * $Scale)
        $size = 25 * $Scale
        $radius = 5.5 * $Scale
        Fill-RoundedRect -Graphics $Graphics -Brush $Brush -X $x -Y $y -W $size -H $size -R $radius
    }
}

function New-Canvas {
    param([int]$Width, [int]$Height)

    $bmp = New-Object System.Drawing.Bitmap $Width, $Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear($white)
    return @{ Bitmap = $bmp; Graphics = $g }
}

Write-Host "Generating sidebar.bmp (164 x 314)..."
$sidebar = New-Canvas -Width 164 -Height 314
$g = $sidebar.Graphics
$markBrush = New-Object System.Drawing.SolidBrush($charcoal)
$dividerBrush = New-Object System.Drawing.SolidBrush($divider)

$g.FillRectangle($dividerBrush, 163, 0, 1, 314)
Draw-StudioMark -Graphics $g -Brush $markBrush -OriginX 45.8 -OriginY 98.7 -Scale 0.78

$sidebarPath = Join-Path $assetsDir "sidebar.bmp"
$sidebar.Bitmap.Save($sidebarPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose()
$sidebar.Bitmap.Dispose()

Write-Host "  -> $sidebarPath"

Write-Host "Generating header.bmp (150 x 57)..."
$header = New-Canvas -Width 150 -Height 57
$g = $header.Graphics
$g.FillRectangle($dividerBrush, 0, 56, 150, 1)
Draw-StudioMark -Graphics $g -Brush $markBrush -OriginX 62.7 -OriginY 8.9 -Scale 0.31

$headerPath = Join-Path $assetsDir "header.bmp"
$header.Bitmap.Save($headerPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose()
$header.Bitmap.Dispose()

$markBrush.Dispose()
$dividerBrush.Dispose()

Write-Host "  -> $headerPath"
Write-Host "Done."
