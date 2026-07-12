$ErrorActionPreference = 'Stop'
$ruleName = 'LEGO-Rangement-Private'
$privateNetwork = Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Private' -and $_.IPv4Connectivity -ne 'NoTraffic' }
if (-not $privateNetwork) {
  throw 'Le réseau actif doit être défini comme Privé dans les paramètres Windows avant de continuer.'
}
$existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
if ($existing) {
  Remove-NetFirewallRule -Name $ruleName
}
New-NetFirewallRule -Name $ruleName -DisplayName 'LEGO Rangement - réseau privé' -Description 'Autorise le téléphone sur le même réseau privé à joindre LEGO Rangement.' -Enabled True -Profile Private -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -RemoteAddress LocalSubnet | Out-Null
Write-Host 'Accès autorisé uniquement depuis le sous-réseau local, sur le profil Windows Privé.' -ForegroundColor Green
