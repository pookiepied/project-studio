import { runPS } from "../ps-helper.js";

export async function listDisplays(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
Add-Type -AssemblyName System.Windows.Forms
$screens = [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  [PSCustomObject]@{
    device       = $_.DeviceName
    primary      = $_.Primary
    width        = $_.Bounds.Width
    height       = $_.Bounds.Height
    x            = $_.Bounds.X
    y            = $_.Bounds.Y
    bpp          = $_.BitsPerPixel
    working_area = "$($_.WorkingArea.Width)x$($_.WorkingArea.Height)"
  }
}
@($screens) | ConvertTo-Json -AsArray
`);
}

export async function getDisplaySettings(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
$vc = Get-CimInstance Win32_VideoController |
  Select-Object Caption, CurrentHorizontalResolution, CurrentVerticalResolution,
    CurrentRefreshRate, CurrentBitsPerPixel, AdapterCompatibility, DriverVersion
$scaling = try {
  (Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop\\WindowMetrics' -Name AppliedDPI -EA Stop).AppliedDPI
} catch { $null }
[PSCustomObject]@{
  adapters    = @($vc)
  scaling_dpi = $scaling
  scaling_pct = if ($scaling) { [math]::Round($scaling/96*100) } else { $null }
} | ConvertTo-Json -Depth 3
`);
}

export async function setDisplayScaling(args: Record<string, unknown>): Promise<unknown> {
  const percent = args.percent as number; // 100 | 125 | 150 | 175 | 200 | 225 | 250 | 300
  if (!percent) return { error: "percent is required (100, 125, 150, 175, 200, 225, 250, or 300)" };
  const dpi = Math.round((percent / 100) * 96);

  return runPS(`
try {
  # Set AppliedDPI in registry — takes effect on next logon
  Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name LogPixels      -Value ${dpi}   -Type DWord -EA Stop
  Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name Win8DpiScaling -Value 1         -Type DWord -EA Stop
  Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop\\WindowMetrics' -Name AppliedDPI -Value ${dpi} -Type DWord -EA SilentlyContinue
  [PSCustomObject]@{ success=$true; dpi=${dpi}; percent=${percent}; note='Sign out and back in for scaling to take effect' } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function setDisplayOrientation(args: Record<string, unknown>): Promise<unknown> {
  const orientation = (args.orientation as string) || "landscape"; // landscape | portrait | landscape_flipped | portrait_flipped
  const device      = args.device as string | undefined;

  const orientMap: Record<string, number> = {
    landscape: 0, portrait: 1, landscape_flipped: 2, portrait_flipped: 3,
  };
  const orient = orientMap[orientation.toLowerCase()];
  if (orient == null) return { error: "orientation must be: landscape, portrait, landscape_flipped, portrait_flipped" };

  const deviceArg = device ? `"${device.replace(/"/g, "")}"` : "$null";

  return runPS(`
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Explicit, CharSet=CharSet.Ansi)]
public struct DEVMODE2 {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32), FieldOffset(0)]  public string dmDeviceName;
    [FieldOffset(36)] public short dmSize; [FieldOffset(40)] public int dmFields;
    [FieldOffset(52)] public int dmDisplayOrientation;
    [FieldOffset(108)] public int dmPelsWidth; [FieldOffset(112)] public int dmPelsHeight;
    [FieldOffset(116)] public int dmDisplayFlags; [FieldOffset(120)] public int dmDisplayFrequency;
}
public class OrientAPI {
    [DllImport("user32.dll")] public static extern int ChangeDisplaySettingsEx(string dev, ref DEVMODE2 dm, IntPtr h, int flags, IntPtr p);
    [DllImport("user32.dll")] public static extern bool EnumDisplaySettingsEx(string dev, int mode, ref DEVMODE2 dm, int flags);
    public const int ENUM_CURRENT=-1; public const int CDS_UPDATEREGISTRY=1;
    public const int DM_ORIENT=0x00000080;
}
"@
try {
  $dm = New-Object DEVMODE2
  $dm.dmSize = [System.Runtime.InteropServices.Marshal]::SizeOf($dm)
  [OrientAPI]::EnumDisplaySettingsEx(${deviceArg}, [OrientAPI]::ENUM_CURRENT, [ref]$dm, 0) | Out-Null
  $dm.dmDisplayOrientation = ${orient}
  $dm.dmFields = $dm.dmFields -bor [OrientAPI]::DM_ORIENT
  # Swap width/height for portrait modes
  if (${orient} % 2 -eq 1) { $tmp=$dm.dmPelsWidth; $dm.dmPelsWidth=$dm.dmPelsHeight; $dm.dmPelsHeight=$tmp }
  $r = [OrientAPI]::ChangeDisplaySettingsEx(${deviceArg}, [ref]$dm, [IntPtr]::Zero, [OrientAPI]::CDS_UPDATEREGISTRY, [IntPtr]::Zero)
  [PSCustomObject]@{ success=($r -le 1); orientation="${orientation}"; code=$r } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`);
}

export async function setDisplayResolution(args: Record<string, unknown>): Promise<unknown> {
  const width   = args.width   as number;
  const height  = args.height  as number;
  const hz      = args.refresh_hz as number | undefined;
  const device  = args.device  as string | undefined;

  if (!width || !height) return { error: "width and height are required" };

  const deviceArg = device ? `"${device.replace(/"/g, "")}"` : "$null";
  const hzField   = hz ? `$dm.dmDisplayFrequency = ${hz}; $dm.dmFields = $dm.dmFields -bor 0x00400000` : "";

  return runPS(`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Explicit, CharSet=CharSet.Ansi)]
public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32), FieldOffset(0)]  public string dmDeviceName;
    [FieldOffset(32)]  public short dmSpecVersion;
    [FieldOffset(34)]  public short dmDriverVersion;
    [FieldOffset(36)]  public short dmSize;
    [FieldOffset(38)]  public short dmDriverExtra;
    [FieldOffset(40)]  public int   dmFields;
    [FieldOffset(44)]  public int   dmPositionX;
    [FieldOffset(48)]  public int   dmPositionY;
    [FieldOffset(52)]  public int   dmDisplayOrientation;
    [FieldOffset(56)]  public int   dmDisplayFixedOutput;
    [FieldOffset(60)]  public short dmColor;
    [FieldOffset(62)]  public short dmDuplex;
    [FieldOffset(64)]  public short dmYResolution;
    [FieldOffset(66)]  public short dmTTOption;
    [FieldOffset(68)]  public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32), FieldOffset(70)] public string dmFormName;
    [FieldOffset(102)] public short dmLogPixels;
    [FieldOffset(104)] public int   dmBitsPerPel;
    [FieldOffset(108)] public int   dmPelsWidth;
    [FieldOffset(112)] public int   dmPelsHeight;
    [FieldOffset(116)] public int   dmDisplayFlags;
    [FieldOffset(120)] public int   dmDisplayFrequency;
}
public class DisplayAPI {
    [DllImport("user32.dll")] public static extern int ChangeDisplaySettingsEx(string dev, ref DEVMODE dm, IntPtr h, int flags, IntPtr p);
    [DllImport("user32.dll")] public static extern bool EnumDisplaySettingsEx(string dev, int mode, ref DEVMODE dm, int flags);
    public const int ENUM_CURRENT = -1;
    public const int CDS_UPDATEREGISTRY = 1;
    public const int DISP_CHANGE_SUCCESSFUL = 0;
    public const int DISP_CHANGE_RESTART = 1;
    public const int DM_PELSWIDTH  = 0x00080000;
    public const int DM_PELSHEIGHT = 0x00100000;
    public const int DM_FREQ       = 0x00400000;
}
"@
try {
  $dm = New-Object DEVMODE
  $dm.dmSize = [System.Runtime.InteropServices.Marshal]::SizeOf($dm)
  [DisplayAPI]::EnumDisplaySettingsEx(${deviceArg}, [DisplayAPI]::ENUM_CURRENT, [ref]$dm, 0) | Out-Null
  $dm.dmPelsWidth  = ${width}
  $dm.dmPelsHeight = ${height}
  $dm.dmFields = $dm.dmFields -bor ([DisplayAPI]::DM_PELSWIDTH -bor [DisplayAPI]::DM_PELSHEIGHT)
  ${hzField}
  $r = [DisplayAPI]::ChangeDisplaySettingsEx(${deviceArg}, [ref]$dm, [IntPtr]::Zero, [DisplayAPI]::CDS_UPDATEREGISTRY, [IntPtr]::Zero)
  $msg = switch($r) {
    0 { 'Success' } 1 { 'Success — restart required to take full effect' }
    default { "Failed (code $r)" }
  }
  [PSCustomObject]@{ success=($r -le 1); code=$r; message=$msg; width=${width}; height=${height} } | ConvertTo-Json
} catch {
  [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json
}
`);
}
