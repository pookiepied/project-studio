import { runPS, runPSMTA } from "../ps-helper.js";

// ── screenshot_region ────────────────────────────────────────────────────────

export async function screenshotRegion(args: Record<string, unknown>): Promise<unknown> {
  const x        = args.x        as number;
  const y        = args.y        as number;
  const width    = args.width    as number;
  const height   = args.height   as number;
  const savePath = (args.save_path as string | undefined)?.replace(/"/g, "'") ?? "";

  if (x == null || y == null || width == null || height == null)
    return { error: "x, y, width, height are required" };

  return runPS(`
Add-Type -AssemblyName System.Drawing
try {
  $bmp = New-Object System.Drawing.Bitmap(${width}, ${height})
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen(${x}, ${y}, 0, 0, (New-Object System.Drawing.Size(${width}, ${height})))
  $ts   = Get-Date -Format 'yyyyMMdd-HHmmss'
  $path = if ('${savePath}') { '${savePath}' } else { "$env:TEMP\\studio-region-$ts.png" }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  [PSCustomObject]@{ success=$true; path=$path; x=${x}; y=${y}; width=${width}; height=${height} } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

// ── annotated_snapshot ───────────────────────────────────────────────────────

export async function annotatedSnapshot(args: Record<string, unknown>): Promise<unknown> {
  const savePath = (args.save_path as string | undefined)?.replace(/"/g, "'") ?? "";

  return runPS(`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
try {
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen
  $bmp = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen(0, 0, 0, 0, $screen.Bounds.Size)

  $root  = [System.Windows.Automation.AutomationElement]::RootElement
  $enabled = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsEnabledProperty, $true)
  $ctypes = @(
    [System.Windows.Automation.ControlType]::Button,
    [System.Windows.Automation.ControlType]::CheckBox,
    [System.Windows.Automation.ControlType]::ComboBox,
    [System.Windows.Automation.ControlType]::Edit,
    [System.Windows.Automation.ControlType]::Hyperlink,
    [System.Windows.Automation.ControlType]::ListItem,
    [System.Windows.Automation.ControlType]::MenuItem,
    [System.Windows.Automation.ControlType]::RadioButton,
    [System.Windows.Automation.ControlType]::TabItem
  )
  $elements = [System.Collections.Generic.List[object]]::new()
  foreach ($ct in $ctypes) {
    $tc  = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ct)
    $and = New-Object System.Windows.Automation.AndCondition($enabled, $tc)
    try {
      $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $and)
      foreach ($el in $found) {
        $r = $el.Current.BoundingRectangle
        if ($r.Width -gt 0 -and $r.Height -gt 0 -and $r.X -ge 0 -and $r.Y -ge 0 \`
            -and $r.Right -le $screen.Bounds.Width -and $r.Bottom -le $screen.Bounds.Height) {
          $elements.Add([PSCustomObject]@{
            id   = $elements.Count + 1
            name = $el.Current.Name
            type = $el.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
            x=[int]$r.X; y=[int]$r.Y; width=[int]$r.Width; height=[int]$r.Height
            cx=[int]($r.X+$r.Width/2); cy=[int]($r.Y+$r.Height/2)
          }) | Out-Null
        }
      }
    } catch {}
  }

  $font  = New-Object System.Drawing.Font('Arial', 9, [System.Drawing.FontStyle]::Bold)
  $bg    = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(210, 0, 120, 212))
  $fg    = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  foreach ($el in $elements) {
    $lbl = $el.id.ToString()
    $sz  = $g.MeasureString($lbl, $font)
    $rx  = [int]($el.cx - $sz.Width/2 - 2); $ry = [int]($el.cy - $sz.Height/2 - 2)
    $g.FillRectangle($bg, $rx, $ry, $sz.Width+4, $sz.Height+4)
    $g.DrawString($lbl, $font, $fg, [float]($rx+2), [float]($ry+2))
  }
  $font.Dispose(); $bg.Dispose(); $fg.Dispose()

  $ts   = Get-Date -Format 'yyyyMMdd-HHmmss'
  $path = if ('${savePath}') { '${savePath}' } else { "$env:TEMP\\studio-annotated-$ts.png" }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()

  [PSCustomObject]@{ success=$true; path=$path; element_count=$elements.Count; elements=@($elements) } | ConvertTo-Json -Depth 4
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`, 45_000);
}

// ── ocr_screen ───────────────────────────────────────────────────────────────

export async function ocrScreen(args: Record<string, unknown>): Promise<unknown> {
  const x        = args.x        as number | undefined;
  const y        = args.y        as number | undefined;
  const width    = args.width    as number | undefined;
  const height   = args.height   as number | undefined;
  const language = (args.language as string | undefined)?.replace(/['"]/g, "");

  const regionScript = (x != null && y != null && width != null && height != null)
    ? `$capX=${x}; $capY=${y}; $capW=${width}; $capH=${height}`
    : `$capX=0; $capY=0; Add-Type -AssemblyName System.Windows.Forms; $sc=[System.Windows.Forms.Screen]::PrimaryScreen; $capW=$sc.Bounds.Width; $capH=$sc.Bounds.Height`;

  const langScript = language
    ? `$lang = [Windows.Globalization.Language, Windows.Foundation, ContentType=WindowsRuntime]::new('${language}'); $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)`
    : `$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()`;

  return runPSMTA(`
Add-Type -AssemblyName System.Drawing
[Windows.Media.Ocr.OcrEngine,         Windows.Foundation,  ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile,          Windows.Storage,     ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.FileAccessMode,       Windows.Storage,     ContentType=WindowsRuntime] | Out-Null
try {
  ${regionScript}
  $bmp = New-Object System.Drawing.Bitmap($capW, $capH)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($capX, $capY, 0, 0, (New-Object System.Drawing.Size($capW, $capH)))
  $g.Dispose()
  $tmp = "$env:TEMP\\studio-ocr-$([datetime]::Now.Ticks).png"
  $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

  ${langScript}
  if (-not $engine) { throw "OCR engine unavailable — install a Windows language pack" }

  $file    = [Windows.Storage.StorageFile]::GetFileFromPathAsync($tmp).GetAwaiter().GetResult()
  $stream  = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read).GetAwaiter().GetResult()
  $decoder = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream).GetAwaiter().GetResult()
  $softBmp = $decoder.GetSoftwareBitmapAsync().GetAwaiter().GetResult()
  $result  = $engine.RecognizeAsync($softBmp).GetAwaiter().GetResult()
  $stream.Dispose()

  $lines    = $result.Lines | ForEach-Object { [PSCustomObject]@{ text=$_.Text } }
  $fullText = ($result.Lines | ForEach-Object {$_.Text}) -join "\`n"
  [PSCustomObject]@{ success=$true; text=$fullText; lines=@($lines); language=$result.DetectedLanguage.LanguageTag } | ConvertTo-Json -Depth 3
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
finally { if ($tmp -and (Test-Path $tmp)) { Remove-Item $tmp -EA SilentlyContinue } }
`, 30_000);
}
