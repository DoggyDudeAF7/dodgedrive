$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$stateDirectory = Join-Path $projectRoot '.auto-publish'
$logPath = Join-Path $stateDirectory 'auto-publish.log'
$debounceSeconds = 5
$pollMilliseconds = 1200

New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
Set-Location -LiteralPath $projectRoot

function Write-PublishLog([string]$message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $message"
  Add-Content -LiteralPath $logPath -Value $line
  Write-Host $line
}

function Get-WorkingTreeState {
  return (git status --porcelain=v1 --untracked-files=all 2>$null) -join "`n"
}

function Publish-Changes {
  Write-PublishLog 'Validating changes...'
  & node (Join-Path $PSScriptRoot 'validate.mjs')
  if ($LASTEXITCODE -ne 0) {
    Write-PublishLog 'Validation failed; changes were not committed or pushed.'
    return
  }

  git add --all
  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { return }

  $message = "Auto-publish $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  git commit -m $message
  if ($LASTEXITCODE -ne 0) {
    Write-PublishLog 'Commit failed; push skipped.'
    return
  }

  git remote get-url origin *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-PublishLog 'Committed locally. Add a GitHub origin remote to enable automatic pushes.'
    return
  }

  $branch = git branch --show-current
  git push --set-upstream origin $branch
  if ($LASTEXITCODE -eq 0) {
    Write-PublishLog "Pushed $branch; GitHub Pages deployment has started."
  } else {
    Write-PublishLog 'Push failed. Your local commit is safe; check GitHub authentication or remote settings.'
  }
}

Write-PublishLog 'Watcher started. Waiting for saved edits...'
$lastState = Get-WorkingTreeState
$changedAt = if ($lastState) { Get-Date } else { $null }

while ($true) {
  Start-Sleep -Milliseconds $pollMilliseconds
  $state = Get-WorkingTreeState
  if ($state -ne $lastState) {
    $lastState = $state
    $changedAt = if ($state) { Get-Date } else { $null }
    continue
  }
  if ($state -and $changedAt -and ((Get-Date) - $changedAt).TotalSeconds -ge $debounceSeconds) {
    try { Publish-Changes } catch { Write-PublishLog "Publish error: $($_.Exception.Message)" }
    $lastState = Get-WorkingTreeState
    $changedAt = $null
  }
}

