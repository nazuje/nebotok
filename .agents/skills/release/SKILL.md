---
name: release
description: Publish main and deploy it to the Mac mini, then confirm the game is healthy.
disable-model-invocation: true
---

# Release

A person asked for this. Agents never push or deploy on their own initiative.

1. Check the tree: `git status` is clean, `main` is checked out, and `npm run verify -- --level 4`
   plus `npm run verify:container` passed at this commit (`.proof/<sha>/summary.json`, no `-dirty`).
   Done when both summaries say every step passed.
2. Show the person the commits that will go out (`git log --oneline origin/main..main`) and push:
   `git push origin main`. A plain push only: if it is refused, stop and report.
3. Watch CI to the end: `gh run watch --exit-status` on the run for this commit
   (`gh run list --branch main --limit 1`). Done when the `verify` and `image` jobs both succeed;
   on failure, report the failing step and stop.
4. Deploy on the Mac mini, in its clone: `scripts/update.sh`. It verifies the image's signed build
   record before anything runs (`docs/deploy.md`). Run it yourself only when your shell is on the
   Mac mini; otherwise give the person the exact command and wait for its output.
5. Confirm health: the script ends only when both containers are healthy. Then the game's address
   on the tailnet answers `/healthz` with `ok: true` and the expected `protocol` and `version`.
   Done when you have seen that answer, or the person has.
6. Report the commit, the CI run, the deployed digest from `deploy/.digests`, and the `/healthz`
   result. If anything is wrong after the deploy, `scripts/rollback.sh` returns to the previous image.
