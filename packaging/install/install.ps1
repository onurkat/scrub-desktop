# Windows CLI installer. The Store desktop app is installed separately with winget.
param(
  [string]$Version = $(if ($env:SCRUB_VERSION) { $env:SCRUB_VERSION } else { '1.0.4' }),
  [switch]$CliOnly, [switch]$WithClaudeCode, [switch]$Uninstall,
  [switch]$DryRun, [switch]$Help
)
& {
$ErrorActionPreference = 'Stop'
if ($Help) { Write-Output 'Scrub CLI: -Version X.Y.Z|latest -CliOnly -WithClaudeCode -Uninstall -DryRun -Help'; return }
if ($Version -notmatch '^(latest|[0-9]+\.[0-9]+\.[0-9]+)$') { throw 'Invalid version' }
$root = Join-Path $env:LOCALAPPDATA 'ScrubCLI'
$binary = Join-Path $root 'scrub.exe'
$manifest = Join-Path $root 'install-manifest'
$owned = @()
if (Test-Path $manifest) {
  $owned = @(Get-Content $manifest)
  foreach ($entry in $owned) { if ($entry -notin @($binary, 'hook:claude-code')) { throw 'Invalid install manifest' } }
}
if ($Uninstall) {
  foreach ($entry in @('hook:claude-code', $binary)) {
    if ($entry -notin $owned) { continue }
    Write-Output "Remove $entry"
    if (!$DryRun) {
      if ($entry -eq 'hook:claude-code') { & $binary hook uninstall claude-code --user; if ($LASTEXITCODE) { throw 'Hook removal failed' } }
      elseif (Test-Path $entry) { Remove-Item -LiteralPath $entry -Force }
    }
  }
  if (!$DryRun -and (Test-Path $manifest)) { Remove-Item -LiteralPath $manifest }
  Write-Output 'Scrub CLI uninstalled; settings and mappings preserved.'
  return
}
$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($arch -notin @('x64','arm64')) { throw 'Unsupported architecture. See https://github.com/onurkat/scrub-desktop#install' }
$base = $env:SCRUB_BASE_URL
if (!$base) { $base = if ($Version -eq 'latest') { 'https://github.com/onurkat/scrub-desktop/releases/latest/download' } else { "https://github.com/onurkat/scrub-desktop/releases/download/v$Version" } }
$uri = [Uri]$base
if (!(($uri.Scheme -eq 'https' -and $uri.Host -eq 'github.com' -and $uri.AbsolutePath.StartsWith('/onurkat/scrub-desktop/releases/')) -or ($env:SCRUB_BASE_URL -and $uri.Scheme -eq 'http' -and $uri.IsLoopback))) { throw 'Only GitHub releases or explicit loopback test servers supported' }
$asset = "scrub-cli-win32-$arch.zip"
Write-Output "Download and verify $base/$asset against SHA256SUMS"
Write-Output "Install $binary; record $manifest"
if ($WithClaudeCode) { Write-Output 'Run scrub hook install claude-code --user' }
if ($DryRun) { return }
if ((Test-Path $binary) -and $binary -notin $owned) { throw "Unmanaged destination exists: $binary" }
New-Item -ItemType Directory -Force $root | Out-Null
$stage = Join-Path $root ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory $stage | Out-Null
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest "$base/SHA256SUMS" -OutFile "$stage/SHA256SUMS"
  Invoke-WebRequest "$base/$asset" -OutFile "$stage/$asset"
  $lines = @(Get-Content "$stage/SHA256SUMS" | Where-Object { $_ -match ('^[a-fA-F0-9]{64}\s+\*?' + [Regex]::Escape($asset) + '$') })
  if ($lines.Count -ne 1) { throw 'Missing or duplicate checksum' }
  if ((Get-FileHash "$stage/$asset" -Algorithm SHA256).Hash -ne ($lines[0] -split '\s+')[0]) { throw 'Checksum mismatch; nothing installed' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead("$stage/$asset")
  try { if ($zip.Entries.Count -ne 1 -or $zip.Entries[0].FullName -ne 'scrub.exe') { throw 'Invalid CLI archive' } } finally { $zip.Dispose() }
  Expand-Archive "$stage/$asset" "$stage/unpacked"
  $actual = & "$stage/unpacked/scrub.exe" --version
  if ($LASTEXITCODE -or ($Version -ne 'latest' -and $actual -ne $Version)) { throw 'CLI version mismatch' }
  @($owned + $binary | Select-Object -Unique) | Set-Content $manifest
  Copy-Item "$stage/unpacked/scrub.exe" $binary -Force
  if ($WithClaudeCode) {
    $hookResult = & $binary hook install claude-code --user
    if ($LASTEXITCODE) { throw 'Hook installation failed' }
    Write-Output $hookResult
    if ($hookResult -notmatch 'already installed') { Add-Content $manifest 'hook:claude-code' }
  }
  Write-Output "Scrub $actual is installed"
  Write-Output "Add $root to your user PATH to run scrub from any terminal."
  Write-Output 'Desktop: winget install --id 9PJ0NKMT45S4 --source msstore'
} finally { Remove-Item -LiteralPath $stage -Recurse -Force }
}
