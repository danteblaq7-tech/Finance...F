# Run from the project root (the folder that contains mobile\). Removes the old per-role route folders and tab icon
# that the new single (app) group replaces. If you skip this, the router sees two /tickets, /queue... and refuses to start.
$paths = 'mobile/src/app/(student)', 'mobile/src/app/(staff)', 'mobile/src/app/(lecturer)', 'mobile/src/components/TabIcon.tsx'
foreach ($p in $paths) { if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force } }
Write-Host 'Old mobile routes removed.'
