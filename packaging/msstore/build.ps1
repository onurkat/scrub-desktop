param([switch]$TestInstall)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot/../.."
$stage = Join-Path $root '.artifacts/msix-stage'
New-Item -ItemType Directory -Force "$stage/Assets" | Out-Null
Copy-Item "$root/src-tauri/target/release/scrub-desktop.exe" $stage
Copy-Item "$PSScriptRoot/AppxManifest.xml" $stage
Add-Type -AssemblyName System.Drawing
foreach ($item in @(@('StoreLogo',50),@('Square150x150Logo',150),@('Square44x44Logo',44))) {
  $source = [Drawing.Image]::FromFile("$root/src-tauri/icons/icon.png")
  $image = [Drawing.Bitmap]::new($source,[int]$item[1],[int]$item[1])
  $image.Save("$stage/Assets/$($item[0]).png",[Drawing.Imaging.ImageFormat]::Png)
  $image.Dispose(); $source.Dispose()
}
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}/Windows Kits/10/bin/*/x64/MakeAppx.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (!$sdk) { throw 'Windows SDK MakeAppx not found' }
$unsigned = "$root/.artifacts/Scrub-unsigned.msix"
& $sdk.FullName pack /d $stage /p $unsigned /o
if ($LASTEXITCODE) { throw 'MakeAppx failed' }
if ($TestInstall) {
  $cert = New-SelfSignedCertificate -Type Custom -Subject 'CN=Onur Kat' -KeyUsage DigitalSignature -FriendlyName ScrubCITest -CertStoreLocation Cert:\CurrentUser\My -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3','2.5.29.19={text}')
  try {
    Export-Certificate -Cert $cert -FilePath "$root/.artifacts/ci.cer" | Out-Null
    Import-Certificate -FilePath "$root/.artifacts/ci.cer" -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
    Copy-Item $unsigned "$root/.artifacts/Scrub-test.msix"
    & (Join-Path $sdk.Directory 'signtool.exe') sign /fd SHA256 /sha1 $cert.Thumbprint "$root/.artifacts/Scrub-test.msix"
    if ($LASTEXITCODE) { throw 'Test signing failed' }
    Add-AppxPackage "$root/.artifacts/Scrub-test.msix"
    $package = Get-AppxPackage OnurKat.Scrub
    $process = Start-Process -FilePath "$($package.InstallLocation)/scrub-desktop.exe" -ArgumentList '--self-test' -Wait -PassThru
    if ($process.ExitCode) { throw 'Installed MSIX self-test failed' }
  } finally {
    Get-AppxPackage OnurKat.Scrub | Remove-AppxPackage
    Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -ErrorAction SilentlyContinue
    Remove-Item "Cert:\LocalMachine\TrustedPeople\$($cert.Thumbprint)" -ErrorAction SilentlyContinue
  }
}
