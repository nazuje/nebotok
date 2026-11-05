---
name: release
description: Publish main and deploy it to the Mac mini, then confirm the game is healthy.
disable-model-invocation: true
---

# Release

A person asked for this. Agents merge to `main` through pull requests (`AGENTS.md`, "Working on a
ticket"), but never deploy to the Mac mini on their own initiative.

1. Check the tree: `git status` is clean, `main` is checked out and equal to `origin/main` after
   `git pull`, and `npm run verify:container` passed at this commit (`.proof/<sha>/summary.json`
   says `"run": "L4-container"` and `"ok": true`, no `-dirty`). Done when it says every step passed.
2. Show the person the latest commits on `main` (`git log --oneline -10`), which is what will go
   out. Anything still unmerged goes through a pull request first; `main` refuses a direct push.
3. Watch CI to the end: `gh run watch --exit-status` on the run for this commit
   (`gh run list --branch main --limit 1`). Done when the `verify` and `image` jobs both succeed;
   on failure, report the failing step and stop.
4. Deploy on the Mac mini, in its clone: `scripts/update.sh`. It verifies the image's signed build
   record before anything runs (`docs/deploy.md`). Run it yourself only when your shell is on the
   Mac mini; otherwise give the person the exact command and wait for its output.
5. Confirm health: the script ends only when the game and Tailscale are healthy and Litestream (the
   backup) is running. Then the game's address
   on the tailnet answers `/healthz` with `ok: true` and the expected `protocol` and `version`.
   Done when you have seen that answer, or the person has.
6. Report the commit, the CI run, the deployed digest from `deploy/.digests`, and the `/healthz`
   result. If anything is wrong after the deploy, `scripts/rollback.sh` returns to the previous image.
