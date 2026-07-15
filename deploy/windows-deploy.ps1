param([string]$HostName="13.124.197.230",[string]$User="ubuntu",[Parameter(Mandatory=$true)][string]$KeyPath)
$ErrorActionPreference="Stop"
$root=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$archive=Join-Path $env:TEMP "market-dominion-deploy.tar.gz"
tar --exclude=node_modules --exclude=.git --exclude=.next --exclude=dist --exclude=.env.production -czf $archive -C $root .
ssh -i $KeyPath "$User@$HostName" "mkdir -p /home/ubuntu/market-dominion"
scp -i $KeyPath $archive "$User@$HostName`:/tmp/market-dominion-deploy.tar.gz"
ssh -i $KeyPath "$User@$HostName" "tar -xzf /tmp/market-dominion-deploy.tar.gz -C /home/ubuntu/market-dominion && chmod +x /home/ubuntu/market-dominion/deploy/*.sh"
Write-Host "Upload complete. Create /home/ubuntu/market-dominion/.env.production, then run deploy/deploy.sh on the server."
