$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$stateDirectory = Join-Path $projectRoot '.auto-publish'
$logPath = Join-Path $stateDirectory 'auto-publish.log'
$debounceSeconds = 5

New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
Set-Location -LiteralPath $projectRoot

function Write-PublishLog([string]$message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $message"
  Add-Content -LiteralPath $logPath -Value $line
  Write-Host $line
}

function Get-WorkingTreeState {
  return (& git -c "safe.directory=$projectRoot" status --porcelain=v1 --untracked-files=all 2>$null) -join "`n"
}

function Publish-Changes {
  Write-PublishLog 'Validating changes...'
  & node (Join-Path $PSScriptRoot 'validate.mjs')
  if ($LASTEXITCODE -ne 0) {
    Write-PublishLog 'Validation failed; changes were not committed or pushed.'
    return
  }

  & git -c "safe.directory=$projectRoot" add --all
  & git -c "safe.directory=$projectRoot" diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { return }

  $message = "Auto-publish $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  & git -c "safe.directory=$projectRoot" commit -m $message
  if ($LASTEXITCODE -ne 0) {
    Write-PublishLog 'Commit failed; push skipped.'
    return
  }

  & git -c "safe.directory=$projectRoot" remote get-url origin *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-PublishLog 'Committed locally. Add a GitHub origin remote to enable automatic pushes.'
    return
  }

  $branch = & git -c "safe.directory=$projectRoot" branch --show-current
  & git -c "safe.directory=$projectRoot" push --set-upstream origin $branch
  if ($LASTEXITCODE -eq 0) {
    Write-PublishLog "Pushed $branch; GitHub Pages deployment has started."
  } else {
    Write-PublishLog 'Push failed. Your local commit is safe; check GitHub authentication or remote settings.'
  }
}

Write-PublishLog 'Event-based watcher started. Waiting for saved edits...'
$initialState = Get-WorkingTreeState
if ($initialState) {
  Write-PublishLog 'Unsaved repository changes found at startup; publishing after validation.'
  Start-Sleep -Seconds $debounceSeconds
  try { Publish-Changes } catch { Write-PublishLog "Initial publish error: $($_.Exception.Message)" }
}
$watcher = [System.IO.FileSystemWatcher]::new($projectRoot, '*')
$watcher.IncludeSubdirectories = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, DirectoryName, LastWrite, Size'
$watcher.EnableRaisingEvents = $true
$subscriptions = @(
  Register-ObjectEvent $watcher Changed -SourceIdentifier 'DodgeDrive.Changed'
  Register-ObjectEvent $watcher Created -SourceIdentifier 'DodgeDrive.Created'
  Register-ObjectEvent $watcher Deleted -SourceIdentifier 'DodgeDrive.Deleted'
  Register-ObjectEvent $watcher Renamed -SourceIdentifier 'DodgeDrive.Renamed'
)
$changedAt = $null

try {
  while ($true) {
    $event = Wait-Event -Timeout 1
    if ($event) {
      $events = @($event) + @(Get-Event | Where-Object EventIdentifier -ne $event.EventIdentifier)
      $relevant = $false
      foreach ($item in $events) {
        $path = $item.SourceEventArgs.FullPath
        if ($path -and $path -notmatch '[\\/]\.git([\\/]|$)' -and $path -notmatch '[\\/]\.auto-publish([\\/]|$)') { $relevant = $true }
        Remove-Event -EventIdentifier $item.EventIdentifier -ErrorAction SilentlyContinue
      }
      if ($relevant) { $changedAt = Get-Date }
    }
    if ($changedAt -and ((Get-Date) - $changedAt).TotalSeconds -ge $debounceSeconds) {
      try { Publish-Changes } catch { Write-PublishLog "Publish error: $($_.Exception.Message)" }
      $changedAt = $null
    }
  }
} finally {
  foreach ($subscription in $subscriptions) { Unregister-Event -SubscriptionId $subscription.Id -ErrorAction SilentlyContinue }
  $watcher.Dispose()
}
