import { runPS } from "../ps-helper.js";

// Shared C# Core Audio API wrapper embedded once per script
const AUDIO_CS = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    void EnumAudioEndpoints(int flow, int mask, [MarshalAs(UnmanagedType.IUnknown)] out object col);
    void GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev);
    void GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice dev);
    void RegisterCallback(IntPtr c);
    void UnregisterCallback(IntPtr c);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    void Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    void OpenPropertyStore(int access, [MarshalAs(UnmanagedType.IUnknown)] out object store);
    void GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    void GetState(out int state);
}
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    void RegisterControlChangeNotify(IntPtr n);
    void UnregisterControlChangeNotify(IntPtr n);
    void GetChannelCount(out uint n);
    void SetMasterVolumeLevel(float f, IntPtr g);
    void SetMasterVolumeLevelScalar(float f, IntPtr g);
    void GetMasterVolumeLevel(out float f);
    void GetMasterVolumeLevelScalar(out float f);
    void SetChannelVolumeLevel(uint ch, float f, IntPtr g);
    void SetChannelVolumeLevelScalar(uint ch, float f, IntPtr g);
    void GetChannelVolumeLevel(uint ch, out float f);
    void GetChannelVolumeLevelScalar(uint ch, out float f);
    void SetMute([MarshalAs(UnmanagedType.Bool)] bool b, IntPtr g);
    void GetMute([MarshalAs(UnmanagedType.Bool)] out bool b);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDevEnumClass {}
public static class AudioHelper {
    static IAudioEndpointVolume Vol() {
        var e = (IMMDeviceEnumerator)new MMDevEnumClass();
        IMMDevice dev; e.GetDefaultAudioEndpoint(0, 1, out dev);
        var iid = typeof(IAudioEndpointVolume).GUID; object v;
        dev.Activate(ref iid, 1, IntPtr.Zero, out v);
        return (IAudioEndpointVolume)v;
    }
    public static float GetVol()   { float f; Vol().GetMasterVolumeLevelScalar(out f); return (float)Math.Round(f*100,1); }
    public static void  SetVol(float p) { Vol().SetMasterVolumeLevelScalar(Math.Max(0,Math.Min(1,p/100f)),IntPtr.Zero); }
    public static bool  GetMute()  { bool b; Vol().GetMute(out b); return b; }
    public static void  SetMute(bool m) { Vol().SetMute(m, IntPtr.Zero); }
}
"@`;

export async function listAudioDevices(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
${AUDIO_CS}
$devices = Get-CimInstance Win32_SoundDevice -EA SilentlyContinue |
  Select-Object Name, Status, Manufacturer, DeviceID
[void][Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType=WindowsRuntime]
$defRender  = [Windows.Media.Devices.MediaDevice, Windows.Media.Devices, ContentType=WindowsRuntime]::GetDefaultAudioRenderId(0)
$defCapture = [Windows.Media.Devices.MediaDevice, Windows.Media.Devices, ContentType=WindowsRuntime]::GetDefaultAudioCaptureId(0)
$vol        = [AudioHelper]::GetVol()
$muted      = [AudioHelper]::GetMute()
[PSCustomObject]@{
  devices           = @($devices)
  master_volume_pct = $vol
  muted             = $muted
  default_render_id = $defRender
  default_capture_id= $defCapture
} | ConvertTo-Json -Depth 3
`, 20_000);
}

export async function getVolume(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
${AUDIO_CS}
[PSCustomObject]@{ volume_pct=[AudioHelper]::GetVol(); muted=[AudioHelper]::GetMute() } | ConvertTo-Json
`, 15_000);
}

export async function setVolume(args: Record<string, unknown>): Promise<unknown> {
  const level = args.level as number;
  if (level == null || level < 0 || level > 100) return { error: "level must be 0–100" };

  return runPS(`
${AUDIO_CS}
[AudioHelper]::SetVol(${level})
[PSCustomObject]@{ success=$true; volume_pct=[AudioHelper]::GetVol() } | ConvertTo-Json
`, 15_000);
}

export async function setDefaultAudioDevice(args: Record<string, unknown>): Promise<unknown> {
  const deviceId = (args.device_id as string || "").replace(/'/g, "''");
  const role     = (args.role      as string) || "all"; // render | capture | all
  if (!deviceId) return { error: "device_id is required — get it from list_audio_devices" };

  // Uses undocumented IPolicyConfig COM interface, works on Win10/11
  return runPS(`
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public enum ERole { eConsole=0, eMultimedia=1, eCommunications=2, ERole_enum_count=3 }
[Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPolicyConfig {
    void NotImpl1(); void NotImpl2(); void NotImpl3(); void NotImpl4();
    void NotImpl5(); void NotImpl6(); void NotImpl7(); void NotImpl8();
    void NotImpl9(); void NotImpl10();
    void SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string devId, ERole role);
    void NotImpl12();
}
[ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
class CPolicyConfigClient {}
"@
try {
  $pc = [IPolicyConfig][CPolicyConfigClient]::new()
  $roles = @([ERole]::eConsole, [ERole]::eMultimedia, [ERole]::eCommunications)
  foreach ($r in $roles) {
    if ('${role}' -eq 'capture' -and $r -eq [ERole]::eConsole)       { continue }
    if ('${role}' -eq 'render'  -and $r -eq [ERole]::eCommunications) { continue }
    $pc.SetDefaultEndpoint('${deviceId}', $r)
  }
  [PSCustomObject]@{ success=$true; device_id='${deviceId}'; role='${role}' } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`, 15_000);
}

export async function setAppVolume(args: Record<string, unknown>): Promise<unknown> {
  const processName = (args.process_name as string || "").replace(/['"]/g, "");
  const level       = args.level as number; // 0–100
  if (!processName) return { error: "process_name is required" };
  if (level == null || level < 0 || level > 100) return { error: "level must be 0–100" };

  return runPS(`
${AUDIO_CS}
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
[Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 {
    void GetState(out int state);
    void GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr ctx);
    void GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    void SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr ctx);
    void GetGroupingParam(out Guid guid);
    void SetGroupingParam(ref Guid guid, IntPtr ctx);
    void RegisterAudioSessionNotification(IntPtr notify);
    void UnregisterAudioSessionNotification(IntPtr notify);
    void GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    void GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    void GetProcessId(out uint pid);
    void IsSystemSoundsSession();
    void SetDuckingPreference(bool optOut);
}
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 {
    void GetAudioSessionControl(ref Guid audioSessionGuid, uint streamFlags, [MarshalAs(UnmanagedType.IUnknown)] out object session);
    void GetSimpleAudioVolume(ref Guid audioSessionGuid, uint streamFlags, [MarshalAs(UnmanagedType.IUnknown)] out object vol);
    void GetSessionEnumerator([MarshalAs(UnmanagedType.IUnknown)] out object sessionList);
}
[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume {
    void SetMasterVolume(float level, IntPtr ctx);
    void GetMasterVolume(out float level);
    void SetMute(bool mute, IntPtr ctx);
    void GetMute(out bool mute);
}
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator {
    void GetCount(out int count);
    void GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);
}
"@
try {
  $e   = [IMMDeviceEnumerator](New-Object MMDevEnumClass)
  $dev = $null; $e.GetDefaultAudioEndpoint(0, 1, [ref]$dev)
  $iid = [IAudioSessionManager2].GUID; $obj = $null
  $dev.Activate([ref]$iid, 1, [IntPtr]::Zero, [ref]$obj)
  $mgr = [IAudioSessionManager2]$obj
  $enumObj = $null; $mgr.GetSessionEnumerator([ref]$enumObj)
  $enum = [IAudioSessionEnumerator]$enumObj
  $count = 0; $enum.GetCount([ref]$count)
  $changed = 0
  $targetPid = (Get-Process -Name "${processName}" -EA SilentlyContinue | Select-Object -First 1).Id
  for ($i = 0; $i -lt $count; $i++) {
    $sessObj = $null; $enum.GetSession($i, [ref]$sessObj)
    $ctrl = [IAudioSessionControl2]$sessObj
    $pid2 = [uint32]0; $ctrl.GetProcessId([ref]$pid2)
    if ($pid2 -eq $targetPid) {
      ([ISimpleAudioVolume]$sessObj).SetMasterVolume([float](${level}/100), [IntPtr]::Zero)
      $changed++
    }
  }
  if ($changed -eq 0) { throw "Process '${processName}' not found or has no audio session" }
  [PSCustomObject]@{ success=$true; process="${processName}"; level=${level}; sessions_changed=$changed } | ConvertTo-Json
} catch { [PSCustomObject]@{ success=$false; error=$_.Exception.Message } | ConvertTo-Json }
`, 20_000);
}

export async function toggleMute(args: Record<string, unknown>): Promise<unknown> {
  const force = args.mute as boolean | undefined;

  return runPS(`
${AUDIO_CS}
$current = [AudioHelper]::GetMute()
$target  = if ($null -ne [System.Convert]::ToString('${force ?? ""}') -and '${force ?? ""}' -ne '') { [System.Convert]::ToBoolean('${force ?? ""}') } else { -not $current }
[AudioHelper]::SetMute($target)
[PSCustomObject]@{ success=$true; muted=$target } | ConvertTo-Json
`, 15_000);
}
