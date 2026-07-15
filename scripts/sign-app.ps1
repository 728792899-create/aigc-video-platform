# AIGC Video Studio - development code-signing helper (self-signed cert)
# Usage:
#   gencert: powershell -File sign-app.ps1 -Action gencert
#   sign:    powershell -File sign-app.ps1 -Action sign -File "path\xxx.exe"
#   verify:  powershell -File sign-app.ps1 -Action verify -File "path\xxx.exe"
param(
  [ValidateSet('gencert','sign','verify')]
  [string]$Action = 'verify',
  [string]$File = '',
  [string]$Subject = 'CN=AIGC Video Studio Development, O=AIGC Video Studio, C=CN',
  [string]$PfxPath = 'build\codesign\aigc-video-studio-dev.pfx',
  [string]$Password = $env:WINDOWS_PFX_PASSWORD
)
$ErrorActionPreference = 'Stop'
$tsUrl = 'http://timestamp.digicert.com'

function Resolve-Pfx { Join-Path (Get-Location) $PfxPath }
function Require-Password {
  if (-not $Password) { throw 'Set WINDOWS_PFX_PASSWORD or pass -Password. Never store the password in source control.' }
}

function Do-GenCert {
  Require-Password
  $pfx = Resolve-Pfx
  $dir = Split-Path $pfx -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Write-Output "[1/3] Generating self-signed code-signing certificate ..."
  $cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $Subject `
    -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -NotAfter (Get-Date).AddYears(5)
  Write-Output ("      Thumbprint: " + $cert.Thumbprint)
  Write-Output ("      Subject:    " + $cert.Subject)
  Write-Output ("      NotAfter:   " + $cert.NotAfter.ToString('yyyy-MM-dd'))
  Write-Output "[2/3] Exporting PFX (with private key) ..."
  $sec = ConvertTo-SecureString -String $Password -Force -AsPlainText
  Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $sec | Out-Null
  Write-Output ("      PFX: " + $pfx)
  Write-Output "[3/3] Exporting public CER (for users to trust) ..."
  $cer = [System.IO.Path]::ChangeExtension($pfx, '.cer')
  Export-Certificate -Cert $cert -FilePath $cer | Out-Null
  Write-Output ("      CER: " + $cer)
  Write-Output "DONE gencert"
}

function Do-Sign {
  Require-Password
  if (-not $File -or -not (Test-Path $File)) { throw "Need -File pointing to an existing file: '$File'" }
  $pfx = Resolve-Pfx
  if (-not (Test-Path $pfx)) { throw "Cert not found $pfx, run -Action gencert first" }
  $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 `
            -ArgumentList $pfx, $Password, 'Exportable,PersistKeySet'
  Write-Output ("[sign] file: " + $File)
  Write-Output ("       cert: " + $cert.Subject)
  $r = Set-AuthenticodeSignature -FilePath $File -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $tsUrl -ErrorAction Stop
  Write-Output ("       status: " + $r.Status + " / " + $r.StatusMessage)
  if ($r.Status -ne 'Valid') {
    Write-Output "       NOTE: self-signed cert not in system root trust; UnknownError is expected."
    Write-Output "             Import the .cer into Trusted Root to make it Valid."
  }
  Write-Output "DONE sign"
}

function Do-Verify {
  if (-not $File -or -not (Test-Path $File)) { throw "Need -File pointing to an existing file: '$File'" }
  $s = Get-AuthenticodeSignature -FilePath $File
  Write-Output ("[verify] file:    " + $File)
  Write-Output ("         status:  " + $s.Status)
  if ($s.SignerCertificate) {
    Write-Output ("         signer:  " + $s.SignerCertificate.Subject)
    Write-Output ("         thumb:   " + $s.SignerCertificate.Thumbprint)
  } else { Write-Output "         signer:  (none)" }
  if ($s.TimeStamperCertificate) {
    Write-Output ("         tsa:     " + $s.TimeStamperCertificate.Subject)
  }
  Write-Output "DONE verify"
}

switch ($Action) {
  'gencert' { Do-GenCert }
  'sign'    { Do-Sign }
  'verify'  { Do-Verify }
}
