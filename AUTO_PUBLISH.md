# Automatic publishing

This project validates, commits, and pushes saved edits automatically. GitHub Pages then deploys every push to `main`.

## One-time connection

Create an empty GitHub repository, then run this in the project terminal:

```powershell
git remote add origin https://github.com/YOUR-NAME/YOUR-REPOSITORY.git
git push -u origin main
```

In the repository's GitHub settings, open **Pages** and choose **GitHub Actions** as the source.

## How it works

- Opening this trusted VS Code folder starts `scripts/auto-publish.ps1`.
- It waits five seconds after edits stop.
- `scripts/validate.mjs` checks the game module and essential assets.
- Valid changes are committed and pushed; invalid JavaScript remains local.
- Deployment runs from `.github/workflows/pages.yml`.

The watcher log is stored at `.auto-publish/auto-publish.log`.

