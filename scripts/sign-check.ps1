$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Check($n) {
  $c = Get-Command $n -ErrorAction SilentlyContinue
  if ($c) { Write-Output "$n : OK" } else { Write-Output "$n : MISSING" }
}
Check 'New-SelfSignedCertificate'
Check 'Set-AuthenticodeSignature'
Check 'Get-AuthenticodeSignature'
Check 'Export-PfxCertificate'
Write-Output ("PSVersion: " + $PSVersionTable.PSVersion.ToString())
