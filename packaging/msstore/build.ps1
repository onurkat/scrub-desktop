param([switch]$TestInstall)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot/../.."
$stage = Join-Path $root '.artifacts/msix-stage'
New-Item -ItemType Directory -Force "$stage/Assets" | Out-Null
Copy-Item "$root/src-tauri/target/release/scrub-desktop.exe" $stage
Copy-Item "$PSScriptRoot/AppxManifest.xml" $stage
Add-Type -AssemblyName System.Drawing
$source = [Drawing.Image]::FromFile("$root/src-tauri/icons/brand-1024.png")
try {
  $assets = @(@('StoreLogo',50),@('Square150x150Logo',150),@('Square44x44Logo',44))
  foreach ($size in @(16,24,32,48,256)) {
    $assets += ,@("Square44x44Logo.targetsize-$size",$size)
    $assets += ,@("Square44x44Logo.targetsize-$size`_altform-unplated",$size)
  }
  foreach ($item in $assets) {
    $size = [int]$item[1]
    $image = [Drawing.Bitmap]::new($size,$size)
    $graphics = [Drawing.Graphics]::FromImage($image)
    try {
      $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($source,0,0,$size,$size)
      $image.Save("$stage/Assets/$($item[0]).png",[Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $image.Dispose() }
  }
} finally { $source.Dispose() }
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}/Windows Kits/10/bin/*/x64/MakeAppx.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (!$sdk) { throw 'Windows SDK MakeAppx not found' }
$unsigned = "$root/.artifacts/Scrub-unsigned.msix"
& $sdk.FullName pack /d $stage /p $unsigned /o
if ($LASTEXITCODE) { throw 'MakeAppx failed' }
if ($TestInstall) {
  [xml]$manifest = Get-Content "$PSScriptRoot/AppxManifest.xml"
  $identity = $manifest.Package.Identity
  $cert = New-SelfSignedCertificate -Type Custom -Subject $identity.Publisher -KeyUsage DigitalSignature -FriendlyName ScrubCITest -CertStoreLocation Cert:\CurrentUser\My -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3','2.5.29.19={text}')
  try {
    Export-Certificate -Cert $cert -FilePath "$root/.artifacts/ci.cer" | Out-Null
    Import-Certificate -FilePath "$root/.artifacts/ci.cer" -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
    Copy-Item $unsigned "$root/.artifacts/Scrub-test.msix"
    & (Join-Path $sdk.Directory 'signtool.exe') sign /fd SHA256 /sha1 $cert.Thumbprint "$root/.artifacts/Scrub-test.msix"
    if ($LASTEXITCODE) { throw 'Test signing failed' }
    Add-AppxPackage "$root/.artifacts/Scrub-test.msix"
    $package = Get-AppxPackage $identity.Name
    $process = Start-Process -FilePath "$($package.InstallLocation)/scrub-desktop.exe" -ArgumentList '--self-test' -Wait -PassThru
    if ($process.ExitCode) { throw 'Installed MSIX self-test failed' }
  } finally {
    Get-AppxPackage $identity.Name | Remove-AppxPackage
    Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -ErrorAction SilentlyContinue
    Remove-Item "Cert:\LocalMachine\TrustedPeople\$($cert.Thumbprint)" -ErrorAction SilentlyContinue
  }
}
