import { runPS } from "../ps-helper.js";

export async function getSystemStats(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
$cpu  = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$os   = Get-CimInstance Win32_OperatingSystem
$disk = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' |
  Select-Object DeviceID,
    @{N='size_gb'; E={[math]::Round($_.Size/1GB,2)}},
    @{N='free_gb'; E={[math]::Round($_.FreeSpace/1GB,2)}},
    @{N='used_pct';E={[math]::Round(($_.Size-$_.FreeSpace)/$_.Size*100,1)}}
$gpu = Get-CimInstance Win32_VideoController |
  Select-Object Name, @{N='vram_mb';E={[math]::Round($_.AdapterRAM/1MB,0)}}

[PSCustomObject]@{
  cpu_pct   = [math]::Round($cpu,1)
  memory    = [PSCustomObject]@{
    total_mb = [math]::Round($os.TotalVisibleMemorySize/1024,0)
    free_mb  = [math]::Round($os.FreePhysicalMemory/1024,0)
    used_pct = [math]::Round(($os.TotalVisibleMemorySize-$os.FreePhysicalMemory)/$os.TotalVisibleMemorySize*100,1)
  }
  disks     = @($disk)
  gpu       = @($gpu)
  os        = $os.Caption
  uptime_h  = [math]::Round((New-TimeSpan -Start $os.LastBootUpTime).TotalHours,1)
} | ConvertTo-Json -Depth 4
`);
}

export async function getCpuDetails(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
$procs = Get-CimInstance Win32_Processor
$cores = try {
  (Get-Counter '\\Processor(*)\\% Processor Time' -SampleInterval 1 -MaxSamples 1 -EA Stop).CounterSamples |
    Where-Object InstanceName -ne '_total' |
    Sort-Object {[int]$_.InstanceName} |
    Select-Object @{N='core';E={[int]$_.InstanceName}}, @{N='pct';E={[math]::Round($_.CookedValue,1)}}
} catch { @() }
$temp = try {
  $t = (Get-CimInstance MSAcpi_ThermalZoneTemperature -Namespace root/wmi -EA Stop | Select-Object -First 1).CurrentTemperature
  [math]::Round($t/10 - 273.15, 1)
} catch { $null }

[PSCustomObject]@{
  name              = ($procs | Select-Object -First 1).Name
  cores_physical    = ($procs | Select-Object -First 1).NumberOfCores
  cores_logical     = ($procs | Select-Object -First 1).NumberOfLogicalProcessors
  max_ghz           = [math]::Round(($procs | Select-Object -First 1).MaxClockSpeed/1000,2)
  current_ghz       = [math]::Round(($procs | Select-Object -First 1).CurrentClockSpeed/1000,2)
  temperature_c     = $temp
  process_count     = (Get-Process).Count
  thread_count      = (Get-Process | Measure-Object Threads -Sum).Sum
  per_core_pct      = @($cores)
} | ConvertTo-Json -Depth 3
`, 20_000);
}

export async function getDiskIo(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
try {
  $samples = (Get-Counter '\\PhysicalDisk(*)\\Disk Read Bytes/sec','\\PhysicalDisk(*)\\Disk Write Bytes/sec' -SampleInterval 1 -MaxSamples 1 -EA Stop).CounterSamples |
    Where-Object InstanceName -ne '_total' |
    Group-Object InstanceName |
    ForEach-Object {
      $r = ($_.Group | Where-Object Path -like '*Read*').CookedValue
      $w = ($_.Group | Where-Object Path -like '*Write*').CookedValue
      [PSCustomObject]@{ disk=$_.Name; read_kb_s=[math]::Round($r/1KB,1); write_kb_s=[math]::Round($w/1KB,1) }
    }
  @($samples) | ConvertTo-Json -AsArray
} catch {
  [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json
}
`, 20_000);
}

export async function getGpuStats(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
$nv = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($nv) {
  $out = & nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits 2>$null
  if ($out) {
    $results = $out.Trim().Split("\`n") | Where-Object {$_.Trim()} | ForEach-Object {
      $p = $_.Split(',') | ForEach-Object {$_.Trim()}
      [PSCustomObject]@{
        name=$p[0]; load_pct=[int]$p[1]; vram_used_mb=[int]$p[2]; vram_total_mb=[int]$p[3]
        temperature_c=[int]$p[4]; power_w=if($p[5] -match '\\d'){[float]$p[5]}else{$null}; source='nvidia-smi'
      }
    }
    @($results) | ConvertTo-Json -AsArray
    return
  }
}
Get-CimInstance Win32_VideoController |
  Select-Object Name,
    @{N='vram_mb';E={[math]::Round($_.AdapterRAM/1MB,0)}},
    @{N='load_pct'; E={$null}},
    @{N='temperature_c';E={$null}},
    VideoModeDescription, DriverVersion,
    @{N='source';E={'wmi'}} |
  ConvertTo-Json -AsArray
`);
}

export async function getMemoryDetails(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
$os  = Get-CimInstance Win32_OperatingSystem
$perf= Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -EA SilentlyContinue
[PSCustomObject]@{
  total_mb         = [math]::Round($os.TotalVisibleMemorySize/1024,0)
  free_mb          = [math]::Round($os.FreePhysicalMemory/1024,0)
  used_mb          = [math]::Round(($os.TotalVisibleMemorySize-$os.FreePhysicalMemory)/1024,0)
  used_pct         = [math]::Round(($os.TotalVisibleMemorySize-$os.FreePhysicalMemory)/$os.TotalVisibleMemorySize*100,1)
  virtual_total_mb = [math]::Round($os.TotalVirtualMemorySize/1024,0)
  virtual_free_mb  = [math]::Round($os.FreeVirtualMemory/1024,0)
  page_file_mb     = [math]::Round(($os.TotalVirtualMemorySize - $os.TotalVisibleMemorySize)/1024,0)
  commit_limit_mb  = if($perf){[math]::Round($perf.CommitLimit/1MB,0)}else{$null}
  committed_mb     = if($perf){[math]::Round($perf.CommittedBytes/1MB,0)}else{$null}
  pool_nonpaged_mb = if($perf){[math]::Round($perf.PoolNonpagedBytes/1MB,1)}else{$null}
  pool_paged_mb    = if($perf){[math]::Round($perf.PoolPagedBytes/1MB,1)}else{$null}
  cache_mb         = if($perf){[math]::Round($perf.CacheBytes/1MB,1)}else{$null}
  page_faults_s    = if($perf){$perf.PageFaultsPersec}else{$null}
} | ConvertTo-Json
`);
}

export async function getStorageInfo(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
$volumes = Get-Volume -EA SilentlyContinue |
  Select-Object DriveLetter, FriendlyName, FileSystemType, DriveType,
    @{N='total_gb';  E={[math]::Round($_.Size/1GB,2)}},
    @{N='free_gb';   E={[math]::Round($_.SizeRemaining/1GB,2)}},
    @{N='used_pct';  E={if($_.Size){[math]::Round(($_.Size-$_.SizeRemaining)/$_.Size*100,1)}else{0}}},
    HealthStatus, OperationalStatus
$disks = Get-PhysicalDisk -EA SilentlyContinue |
  Select-Object FriendlyName, MediaType, BusType, OperationalStatus,
    @{N='size_gb';E={[math]::Round($_.Size/1GB,2)}},
    @{N='health'; E={$_.HealthStatus}}
[PSCustomObject]@{ volumes=@($volumes); physical_disks=@($disks) } | ConvertTo-Json -Depth 3
`);
}

export async function getSystemInfo(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
$cs  = Get-CimInstance Win32_ComputerSystem
$mb  = Get-CimInstance Win32_BaseBoard -EA SilentlyContinue
$bios= Get-CimInstance Win32_BIOS      -EA SilentlyContinue
$os  = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$ram = Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum
[PSCustomObject]@{
  computer_name = $cs.Name
  manufacturer  = $cs.Manufacturer
  model         = $cs.Model
  cpu           = $cpu.Name
  cpu_cores     = $cpu.NumberOfCores
  ram_gb        = [math]::Round($ram.Sum/1GB,1)
  os            = $os.Caption
  os_version    = $os.Version
  os_build      = $os.BuildNumber
  os_arch       = $os.OSArchitecture
  install_date  = $os.InstallDate.ToString('yyyy-MM-dd')
  bios_vendor   = $bios.Manufacturer
  bios_version  = $bios.SMBIOSBIOSVersion
  bios_date     = if($bios.ReleaseDate){$bios.ReleaseDate.ToString('yyyy-MM-dd')}else{''}
  motherboard   = "$($mb.Manufacturer) $($mb.Product)"
  serial_number = $bios.SerialNumber
  domain        = $cs.Domain
  workgroup     = if($cs.Workgroup){$cs.Workgroup}else{''}
} | ConvertTo-Json
`);
}

export async function getDrivers(args: Record<string, unknown>): Promise<unknown> {
  const filter    = args.filter     as string | undefined; // signed | unsigned | all
  const nameFilter= args.name_filter as string | undefined;
  const limit     = (args.limit as number) || 100;

  const signedFilter = filter === "unsigned"
    ? "| Where-Object IsSigned -eq $false"
    : filter === "signed" ? "| Where-Object IsSigned -eq $true" : "";
  const nameArg = nameFilter
    ? `| Where-Object {$_.FriendlyName -like '*${nameFilter.replace(/['"]/g, "")}*' -or $_.DriverName -like '*${nameFilter.replace(/['"]/g, "")}*'}`
    : "";

  return runPS(`
Get-WindowsDriver -Online -All -EA SilentlyContinue ${signedFilter} ${nameArg} |
  Select-Object -First ${limit} FriendlyName, ProviderName, Version, Date, DriverName, ClassDescription, BootCritical, OriginalFileName, IsSigned |
  ConvertTo-Json -AsArray
`, 30_000);
}

export async function getBatteryInfo(_args: Record<string, unknown>): Promise<unknown> {
  return runPS(`
$bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
if (-not $bat) {
  [PSCustomObject]@{ present=$false; note='No battery detected — likely a desktop or battery not exposed via WMI' } | ConvertTo-Json
  return
}
$statusMap = @{1='Other';2='Unknown';3='Fully Charged';4='Low';5='Critical';6='Charging';7='Charging/High';8='Charging/Low';9='Charging/Critical';10='Undefined';11='Partially Charged'}
@($bat | Select-Object Name,
  @{N='level_pct';E={$_.EstimatedChargeRemaining}},
  @{N='status';E={$statusMap[[int]$_.BatteryStatus]}},
  @{N='est_minutes_remaining';E={if($_.EstimatedRunTime -lt 71582){$_.EstimatedRunTime}else{$null}}},
  @{N='health_pct';E={if($_.DesignCapacity -and $_.DesignCapacity -gt 0){[math]::Round($_.FullChargeCapacity/$_.DesignCapacity*100,1)}else{$null}}},
  @{N='present';E={$true}}
) | ConvertTo-Json -AsArray
`);
}
