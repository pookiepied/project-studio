# Starts Studio as software.
#
# One command, in order: build the harness bundle if it is missing or stale,
# then start the desktop app. The app's Tauri supervisor owns the harness
# process from there - it spawns `STUDIO HARNESS/dist/server.mjs`, mints the
# admission credential, and attaches it to every request in Rust.
#
# So there is no credential to mint by hand and no second window to start.
# Running the harness separately and pointing a browser at the Vite dev server
# is a different thing: it needs `VITE_HARNESS_BASE_URL` and
# `VITE_HARNESS_TOKEN`, and it is not what "start Studio" means.
#
# The frontend has the same shape of trap. The desktop window loads it from
# the Vite dev server, so a source change is seen there at once - but the
# listener behind "open on other devices" serves the bundle embedded in the
# binary, which is whatever `STUDIO/dist` held when Rust last compiled. A
# phone was once served a two-day-old frontend that predated the pairing
# screen, and showed "the harness is not running" for a machine that was
# fine. So the frontend is built by the same rule as the harness, and Rust
# recompiles because every embedded file is one it tracks.
#
#   .\start.ps1              build if needed, then start Studio
#   .\start.ps1 -Rebuild     always rebuild both bundles first
#   .\start.ps1 -Release     start the release build instead of dev

[CmdletBinding()]
param(
    [switch]$Rebuild,
    [switch]$Release
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$harness = Join-Path $root "STUDIO HARNESS"
$studio = Join-Path $root "STUDIO"
$bundle = Join-Path $harness "dist\server.mjs"
$frontend = Join-Path $studio "dist\index.html"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Error "pnpm is not on PATH. Install it, then run this again."
}

# The supervisor spawns the built bundle, not the TypeScript sources, so a
# source change that was never built is a change the running app never sees.
# Comparing against the newest source is what makes that impossible to forget.
$needsBuild = $Rebuild -or -not (Test-Path $bundle)
if (-not $needsBuild) {
    $built = (Get-Item $bundle).LastWriteTimeUtc
    $newest = Get-ChildItem (Join-Path $harness "src") -Recurse -File -Include *.ts, *.tsx |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if ($null -ne $newest -and $newest.LastWriteTimeUtc -gt $built) {
        Write-Host "Harness sources are newer than the bundle. Rebuilding." -ForegroundColor Yellow
        $needsBuild = $true
    }
}

if ($needsBuild) {
    Write-Host "Building the harness bundle..." -ForegroundColor Cyan
    pnpm --dir $harness build
    if ($LASTEXITCODE -ne 0) { Write-Error "The harness build failed. Studio was not started." }
}

# Only for the dev path: `tauri build` runs `pnpm build` itself.
if (-not $Release) {
    $needsFrontend = $Rebuild -or -not (Test-Path $frontend)
    if (-not $needsFrontend) {
        $built = (Get-Item $frontend).LastWriteTimeUtc
        $newest = Get-ChildItem (Join-Path $studio "src") -Recurse -File |
            Sort-Object LastWriteTimeUtc -Descending |
            Select-Object -First 1
        if ($null -ne $newest -and $newest.LastWriteTimeUtc -gt $built) {
            Write-Host "Frontend sources are newer than the bundle other devices are served. Rebuilding." -ForegroundColor Yellow
            $needsFrontend = $true
        }
    }
    if ($needsFrontend) {
        Write-Host "Building the frontend bundle..." -ForegroundColor Cyan
        pnpm --dir $studio build
        if ($LASTEXITCODE -ne 0) { Write-Error "The frontend build failed. Studio was not started." }
    }
}

Write-Host "Starting Studio. The app starts the harness itself." -ForegroundColor Cyan
if ($Release) {
    pnpm --dir $studio tauri build
} else {
    pnpm --dir $studio tauri dev
}
