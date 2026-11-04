# Nebotok

Nebotok is an original creature-collecting adventure across floating sky islands, made for our
family's kids and played together in one shared world. You are a new courier for the Sky Post,
delivering between islands, befriending creatures with treats you cook, and slowly finding out why
a great storm is swallowing the outer islands. It runs in the browser on iPhones, iPads and laptops,
in English and Slovenian, from a small server at home that only family devices can reach.

**Status:** Phase 0, foundations. There is a floating island and a courier, but no game yet.

## Quick start

You need [Volta](https://volta.sh/), which picks the right Node version (26.13.0) by itself, and
[gitleaks](https://github.com/gitleaks/gitleaks) for the secret scan (`brew install gitleaks`).

```sh
npm ci                           # install exactly what the lockfile says
npm run setup:hooks              # once per clone: secret scan before each commit, checks before each push
npm run dev                      # the game at http://127.0.0.1:5173, nothing opens by itself
npm run verify -- --level 4      # the full proof: tests, build and headless browsers
```

`npm run verify` writes its results and screenshots to `.proof/<commit>/`.

## Read more

- [Design](docs/design.md): what the game is and how it is built.
- [Phases](docs/phases.md): the plan, one playable step at a time.
- [Security](docs/security.md): how the Mac mini is kept safe, in plain words first.
- [Deploy](docs/deploy.md): setting up the Mac mini, updating and rolling back.
- [AGENTS.md](AGENTS.md): the working rules for the AI coding agents that write most of the code.

## Licence

All rights reserved until a licence is chosen. The vendored agent skills in `.agents/skills/` keep
their own MIT licences; see `.agents/skills/VENDORED.md`.
