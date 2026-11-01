param([string]$ToolsDirectory)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Get-OfficialFile([string]$Uri, [string]$Destination) {
  & curl.exe --fail --location --retry 2 --connect-timeout 15 --max-time 180 --ssl-revoke-best-effort --silent --show-error $Uri --output $Destination
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $Uri" }
}
$settings = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'windows.config.json') -Raw | ConvertFrom-Json
if (-not $ToolsDirectory) { $ToolsDirectory = $settings.toolsDirectory }
$ToolsDirectory = [System.IO.Path]::GetFullPath($ToolsDirectory)
New-Item -ItemType Directory -Path $ToolsDirectory -Force | Out-Null
$downloads = Join-Path $ToolsDirectory 'downloads'
New-Item -ItemType Directory -Path $downloads -Force | Out-Null
$version = $settings.nodeVersion
$archiveName = "node-v$version-win-x64.zip"
$archive = Join-Path $downloads $archiveName
$sums = Join-Path $downloads "node-v$version-SHASUMS256.txt"
$release = "https://nodejs.org/dist/v$version"
Write-Output 'Fetching official Node checksums...'
Get-OfficialFile "$release/SHASUMS256.txt" $sums
$line = Get-Content -LiteralPath $sums | Where-Object { $_ -match "  $([regex]::Escape($archiveName))$" }
if (-not $line) { throw 'Official Node ZIP checksum is missing.' }
$expected = ($line -split '\s+')[0]
if (-not (Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) {
  Write-Output "Downloading $archiveName..."
  Get-OfficialFile "$release/$archiveName" $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) { throw 'Node ZIP checksum mismatch.' }
$runtime = Join-Path $ToolsDirectory "node-v$version-win-x64"
if (-not (Test-Path -LiteralPath $runtime)) { Expand-Archive -LiteralPath $archive -DestinationPath $ToolsDirectory }
& (Join-Path $runtime 'node.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'Cannot run downloaded Node.' }

$compiler = Join-Path $ToolsDirectory 'InnoSetup\ISCC.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
  $installer = Join-Path $downloads 'innosetup.exe'
  Write-Output 'Downloading the signed Inno Setup compiler installer...'
  if (-not (Test-Path -LiteralPath $installer) -or (Get-Item -LiteralPath $installer).Length -lt 1000000) {
    Get-OfficialFile $settings.innoDownloadUrl $installer
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $installer
  # Publisher documented at https://jrsoftware.org/isdl-verify.php.
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Pyrsys B\.V\.(?:,|$)') {
    throw "Unexpected Inno Setup signature: $($signature.Status) $($signature.SignerCertificate.Subject)"
  }
  $target = Join-Path $ToolsDirectory 'InnoSetup'
  $setup = Start-Process -FilePath $installer -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', '/NOICONS', "/DIR=`"$target`"") -WindowStyle Hidden -Wait -PassThru
  if ($setup.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $compiler)) { throw "Inno Setup install failed: $($setup.ExitCode)" }
}
Write-Output "Node runtime: $runtime"
Write-Output "Inno compiler: $compiler"
Write-Output 'Tools are ready. Run npm run package:win from the repository.'
