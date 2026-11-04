# Security

Nebotok is a game for our children, running on the family Mac mini. The one goal that matters most:
**no malicious code should ever reach the Mac mini.** This page explains, first in plain words and
then in technical detail, how the project tries to keep that promise, and where it cannot.

## In plain words

Think of the game as a sealed box on a shelf in the house.

- **What goes into the box** is checked. The game is built from a short list of other people's
  code (libraries). We use exact versions only, wait a week before taking any new version, never let
  a library run its own setup code, and get weekly suggestions for updates that a person reviews.
- **The box is sealed.** The game runs inside a container: a locked room on the Mac with no view of
  your files, no administrator rights, and no way to change its own contents. If someone broke the
  game, they would find themselves in an empty room.
- **There is only one door, and only family has the key.** Nothing about the game is on the open
  internet. Only devices signed in to your family's Tailscale network can open it, and only the
  game's web page. The game itself is not allowed to reach any other device on that network.
- **Only boxes we built ourselves come in.** GitHub builds the game from this repository's code and
  signs a record saying so. The Mac mini checks that signature before running any new version, and
  refuses one it cannot check.
- **The helpers are watched.** AI coding agents help write this code. They cannot read the secret
  settings file, they do not publish or deploy, every change is checked for leaked passwords, and a
  person decides what goes live.

Nothing is perfectly safe. The "Residual risks" section lists what is still possible, honestly.

## The five doors

A door is a way bad code or a stranger could get in. Each one, with what guards it.

### 1. Dependencies (other people's code)

The risk: a library we use, or one of the libraries it uses, is hijacked and a poisoned version is
published. These attacks usually run code the moment a package is installed, or are caught and pulled
within days.

| Measure | Where |
| --- | --- |
| Install scripts never run (`ignore-scripts=true`), locally, in CI and in the image build. | `.npmrc`, `Dockerfile` |
| Only versions at least 7 days old are resolved (`min-release-age=7`). | `.npmrc` |
| No dependencies straight from git repositories (`allow-git=none`). | `.npmrc` |
| Exact versions in every `package.json`, plus the lockfile, installed with `npm ci`. | `.npmrc` (`save-exact`), `package-lock.json` |
| Wrong Node version refuses to install (`engine-strict`). | `.npmrc`, `package.json` `engines` |
| Dependabot proposes updates weekly, grouped, after the same 7-day cooldown. Nothing merges by itself. | `.github/dependabot.yml` |
| The running image holds only the server's production libraries: no game libraries, no build or test tools, no npm cache. | `Dockerfile` |
| The web page may load nothing from outside its own address (Content Security Policy). | `apps/server/src/http.ts` |

Two packages have install scripts and work without them: `msgpackr-extract` (it loads its prebuilt
binary, or Colyseus falls back to plain JavaScript) and `fsevents` (an optional macOS file watcher).
If a future package truly needs its install script, run that one script from a named npm script and
document it here; never turn install scripts back on globally.

### 2. Container escape

The risk: someone finds a bug in the game server, runs code inside it, and tries to get out of the
container onto the Mac.

| Measure | Where |
| --- | --- |
| Runs as the unprivileged `node` user (uid 1000), never root. | `Dockerfile` `USER`, compose `user` |
| Root filesystem read-only; the app's own code is owned by root and cannot be changed. Writable: only `/data` (its volume) and `/tmp` (memory). | compose `read_only`, `tmpfs` |
| Every Linux capability dropped; `no-new-privileges`, so nothing can gain rights later. | compose `cap_drop`, `security_opt` |
| No host folders and no Docker socket mounted into the game. Data lives in a named Docker volume. | `compose.yaml` |
| Limits on memory (512 MB), CPU (1 core) and processes (200). | `compose.yaml` |
| Base image pinned by digest, from Docker's official Node image. | `Dockerfile` |
| Containers run inside OrbStack's Linux virtual machine, not directly on macOS. | OrbStack |
| The Tailscale sidecar also runs with every capability dropped, read-only, in userspace mode (no network device, no admin rights). Its only host folder is `deploy/tailscale`, read-only. | `compose.yaml` |

`npm run verify:container` proves the seal on every run: it builds the image, starts it, and checks
from Docker's side (user, read-only root, capabilities, mounts, port, limits) and from inside (uid is
not 0, writes to `/` and to the code fail, only `/data` and `/tmp` are writable, no Docker socket).

### 3. Network

The risk: a stranger on the internet or the home Wi-Fi reaches the game, or a broken game reaches
other devices.

| Measure | Where |
| --- | --- |
| No ports published on the Mac. The only way in is Tailscale, as its own device `tag:nebotok`. | `compose.yaml` |
| Tailscale Serve terminates HTTPS with a real certificate and forwards to the game on `127.0.0.1`. Funnel (public internet) is off. | `deploy/tailscale/serve.json` |
| Tailnet policy: members may reach `tag:nebotok` on TCP 443 only, and no rule lets `tag:nebotok` reach anything. Policy tests make Tailscale refuse edits that break this. | `deploy/tailscale/policy.md` |
| Only admins can assign the tag; the auth key is single-use, tagged, short-lived. | `deploy/tailscale/policy.md` |
| The game listens on `127.0.0.1` only, inside the shared container network; Tailscale's health endpoint likewise. | `compose.yaml` |
| Tailscale's own logging to Tailscale's servers is off (`--no-logs-no-support`). | `compose.yaml` |

### 4. GitHub and CI

The risk: the build itself is tampered with, or the Mac mini is tricked into running an image someone
else built.

| Measure | Where |
| --- | --- |
| Every GitHub Action pinned to a full commit SHA; the build helper images (binfmt, BuildKit) pinned by digest. | `.github/workflows/ci.yml` |
| Workflows get a read-only token by default; only the image job on `main` can write packages. Never `pull_request_target`; checkout keeps no credentials. | `.github/workflows/ci.yml` |
| The image is built and pushed only from `main`, and only after the full level 4 proof passes. | `ci.yml` `image` job, `needs: verify` |
| Each image gets a signed build provenance attestation, stored with the image. | `actions/attest-build-provenance` |
| The Mac mini deploys only by digest, and only after `gh attestation verify` confirms: this repo, `.github/workflows/ci.yml`, `refs/heads/main`, a GitHub-hosted runner. It refuses otherwise. | `scripts/update.sh` |
| Secret scanning (gitleaks, pinned release, checksum verified) over the full history and the working tree on every run. | `scripts/verify.mjs`, `ci.yml` |

### 5. AI agents

The risk: an AI agent working on the code is tricked (for example by text hidden in a web page or a
package) into adding something harmful, leaking a secret, or publishing.

| Measure | Where |
| --- | --- |
| Secrets live only in `.env` on the Mac mini, which git ignores and the agents may not read. | `.gitignore`, `scripts/hooks/guard.mjs` |
| Before every tool call, a shared hook refuses `.env` files, database files, `data/`, deleting Docker volumes, force-pushing, turning on install scripts and piping downloads into a shell. It catches slips and injected instructions, not a determined attacker. | `scripts/hooks/guard.mjs`, `.claude/settings.json`, `.factory/hooks.json`, `.codex/hooks.json` |
| Agents push to `main` only after their checks pass, never force-push, and only a person runs `scripts/update.sh` on the Mac mini. | `AGENTS.md`, skill `release` |
| Each commit is scanned for secrets, database files, `.env` files and big new files; each push runs the level 0 proof. On once per clone with `npm run setup:hooks`. | `.githooks/` |
| Third-party agent skills are reviewed copies, pinned to a commit, with every edit recorded. | `.agents/skills/VENDORED.md` |
| Every change runs the secret scan, lint, tests and the browser proof before it can become an image. | `scripts/verify.mjs`, CI |
| New dependencies follow the checklist below, whoever proposes them. | This page |

## Residual risks

What these measures do not stop, in rough order of importance:

1. **Someone gets into the GitHub account.** They could push to `main`, and CI would build and sign
   their image like any other; `scripts/update.sh` would accept it. Protect the account with a
   passkey or hardware key, and turn on branch protection for `main` (require a pull request and the
   CI check) once the repository exists.
2. **The game can reach the internet and the home network.** Tailscale's policy limits the tailnet
   only. The containers still have ordinary outbound access through OrbStack, so a broken game
   server could talk to the internet, to the router, or to other devices on the home Wi-Fi. A later
   phase can cut this off (for example, an internal Docker network with the game reachable only
   through Tailscale); it is not done yet.
3. **A poisoned library that waits.** The 7-day delay catches attacks that are noticed quickly. One
   that ships normally and stays quiet would still run inside the game's container (with the limits
   above) and inside development and CI.
4. **Development on the Mac mini itself.** `npm test`, `npm run dev` and the build run library code as
   your user, outside any container. If you develop on the Mac mini, that code can see your files.
   Prefer developing on another computer, or treat the Mac mini as a server only.
5. **Container or VM escape.** A bug in Linux, Docker or OrbStack could let code out of the
   container. Escaping lands in OrbStack's Linux VM first, but OrbStack shares the Mac's folders with
   that VM so that bind mounts work, so assume an escape could read your files. Keep OrbStack and
   macOS updated.
6. **Trust in the tools.** Tailscale, OrbStack, Docker's official Node image, GitHub and Sigstore (the
   signing service behind attestations) are all trusted. Their images and actions are pinned, but a
   compromise at the source before pinning would carry through.
7. **Pinned helper images age.** Dependabot updates GitHub Actions, the Dockerfile base image and the
   Tailscale image, but not the binfmt and BuildKit images pinned inside `ci.yml`. Update those by
   hand now and then.
8. **The tailnet name becomes public.** HTTPS certificates are logged publicly, so the game's device
   name and your tailnet name are visible to anyone who looks. Nothing can connect without being on
   the tailnet.
9. **Known advisories in build tools.** See below.

## Known advisories

`npm audit` reports nothing in production dependencies. It reports 10 advisories (2 low, 8 moderate)
in development dependencies, all pulled in by `vite-plugin-pwa` through `workbox-build`, which
generates the service worker at build time:

| Package (version) | Advisory | Why it stays for now |
| --- | --- | --- |
| `glob` 11.1.0 | GHSA-3g3m-2fjr-6pw4, moderate: AbortSignal cancellation bypass | Fixed only in 14.0.2+. `workbox-build` 7.4.1 (latest) asks for `^11`. |
| `minimatch` 10.2.6, 5.1.9 | GHSA-g3hv-75wg-m249, moderate: slow matching on crafted patterns | Fixed only in 11.0.1+; `glob` 11 and `filelist` 1 ask for older majors. |
| `deepmerge` 4.3.1 | GHSA-gcqx-w48m-w2h4, low: prototype poisoning | No fixed version exists. |
| `ejs` 3.1.10, `jake` 10.9.4, `filelist` 1.0.6 | moderate, through `minimatch` | Fixed releases are new majors that `@trickfilm400/rollup-plugin-off-main-thread` 3.0.0-pre1 does not accept. |
| `@rollup/plugin-node-resolve` 16.0.3, `@trickfilm400/rollup-plugin-off-main-thread` 3.0.0-pre1, `workbox-build` 7.4.1, `vite-plugin-pwa` 2.0.0 | low/moderate, only because they depend on the above | Already the latest releases. |

npm's only offered fix (`npm audit fix --force`) downgrades to `workbox-build` 7.3.0 and
`vite-plugin-pwa` 1.1.0, a breaking change that brings back older code. Forcing newer majors with
`overrides` would run these libraries against versions they were not written for. Neither is worth
it: these tools only run during `npm run build`, on our own files, and none of them is in the image.
Recheck when `workbox-build` or `vite-plugin-pwa` releases a new version; Dependabot will propose it.

## Checklist: adding a dependency

Before `npm install <package>`:

1. **Do we need it?** Could 20 lines of our own code do the job? Fewer packages, fewer doors.
2. **Who maintains it?** Look at the npm page and the repository: several active maintainers, a
   history of releases, issues answered. Be wary of a recent change of owner.
3. **Is it widely used?** Weekly downloads in the many thousands, used by projects you recognise.
4. **What does it pull in?** `npm view <package> dependencies` and, after installing, `npm ls`.
   Prefer packages with few dependencies.
5. **Does it have install scripts?** `npm view <package> scripts`. Look for `preinstall`, `install`
   or `postinstall`. They will not run here; check that the package works without them.
6. **Is the version at least 7 days old?** `.npmrc` enforces this; do not override it.
7. **Production or development?** Only what the server needs at runtime goes in
   `apps/server/package.json` `dependencies`. Everything else is a dev dependency and stays out of
   the image.
8. **Run the proof:** `npm run verify -- --level 4`, and `npm run verify:container` if the server's
   dependencies changed. Check `npm audit`.

## Technical notes

- `.npmrc` settings apply to every npm command run in this repo, including `npm ci` in CI and in
  the Dockerfile (both copy `.npmrc` first).
- The Docker build runs `npm ci --ignore-scripts` explicitly as well, in case `.npmrc` is ever missing.
- The production image digest lives in `.env` as `NEBOTOK_DIGEST`; compose refuses to start without
  it, so the Mac mini cannot fall back to an unverified tag.
- `scripts/update.sh` resolves the digest with `docker buildx imagetools inspect`, which reads the
  registry without downloading the image, and verifies before `docker compose pull`.
- Provenance verification checks the multi-platform index digest; each platform's image is addressed
  by its own digest inside that index, so the chain of hashes covers what is pulled.
