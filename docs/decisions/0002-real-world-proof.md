# Real-world quests are proved by a photo or a grown-up, and a grown-up approves every proof

Status: accepted (2026-11-24, #207)

## Context

The owner wants quests the kids do away from the screen: things to make, find or do together,
which bring rewards into the game. Some players can't read yet, so the quests and every answer to
them must work with pictures and sound. The players are children, so anything they upload is
children's data in a family home, on a public project. The game has a firm rule: no outside
requests and no outside services. The design for players and parents is "Real world" in the
[design](../design.md); the slice is "Slice G: Real world" in [phases.md](../phases.md).

## Decision

Real-world quests are optional bonus content in a mailbox at the Sky Post. The main story never
needs one, and their rewards are special looks, decorations and drawn creatures, never raw power. A
player proves a quest with a photo, from the camera or the photo library, or a grown-up approves it
with "I saw it" and no photo. Each player can have up to 3 proofs waiting.

A grown-up approves every proof. One family grown-up PIN, set with `scripts/admin.sh`, opens a
grown-up screen on any device. Nothing a player uploads counts, or is seen by anyone else, until a
grown-up approves it. Waiting proofs show as a count on the grown-up button, never as an email or
an outside notification. "Not yet" is one of three pictures, and the player can send again.

Photos are working material, not keepsakes. The server turns a drawing into pixel art itself, the
player picks a version, and once a grown-up decides, the original photo is deleted. Only the pixel
item stays. An AI polish of a picture happens only with the owner's OK, picture by picture.

## Security requirements

This is the first time the game takes files from players. The build must meet every one of these,
and the `security-reviewer` subagent (`docs/agents/`) reviews it against this list when it is
built. `docs/security.md` then gets a section that says where each one lives.

- **Upload size limit.** An upload has a fixed, small maximum size, checked as the bytes arrive, so
  a larger one is refused before it is read in full. Every other API request keeps its 1 KB limit.
- **Only images, decoded and re-encoded.** The server decides the type from the file's contents,
  never from its name or the type the browser claims, and accepts image types only. It checks the
  width and height before decoding, decodes the picture and re-encodes it in its own format. What
  was uploaded is never stored or served as it came.
- **Metadata stripped.** Location, camera details and every other piece of metadata are gone from
  everything the server keeps. A check proves it with a test picture that carries them.
- **Stored only in the data volume.** Photos and pixel items live only in the game's data volume
  (`/data`), never in the repository, the image or a log. Test pictures in the repository are
  invented drawings, never photos of real people or places.
- **Served only to the family, from the game's own origin.** Only a request with a valid profile
  session gets a picture, served by the game's own server. A waiting proof is seen only by its
  sender, the players tagged on it and the grown-up screen.
- **Originals deleted after a grown-up's decision.** Once a grown-up approves a proof or says "not
  yet", the original photo is deleted and only the pixel item made from it stays. A grown-up can
  delete any picture or item at any time.
- **The grown-up PIN is guarded like profile PINs.** It is stored only as a scrypt hash with its own
  salt, compared in constant time, and rate-limited the same way: wrong tries lock it for longer and
  longer, and each client address has a limit on tries a minute.
- **The Content-Security-Policy stays unchanged.** Pictures come from the game's own origin, and
  previews use what the policy already allows. No outside service sees any picture.
- **New libraries are checked.** Any library added to decode, re-encode or turn pictures into pixel
  art goes through the dependency checklist in `docs/security.md` first.

## Considered options

- **An AI judges the proof.** Rejected. It would be unreliable, and kids test the edges: a photo of
  a picture of a tree, a sibling's drawing, a half-finished den. A wrong "no" from a machine feels
  unfair to a child, and a wrong "yes" teaches them to game it. A good enough model would also mean
  an outside service or a large model on the Mac mini.
- **Video proof.** Later. Videos are much larger, harder to strip and re-encode safely, and slower
  for a grown-up to check. Photos and "I saw it" cover the first version.
- **Keeping the original photos as an album.** Rejected, for privacy. A growing store of photos of
  children and the inside of the home is exactly what should not sit on a server, even a family
  one. Keeping only the pixel items means a leak would show pixel art, not photos.
- **Outside notifications** (email or phone push) for waiting proofs. Rejected: the game uses no
  outside services. A count on the grown-up button does the job.

## Consequences

- Uploads are a new way in. They get their own limits, checks and review, and `docs/security.md`
  grows a section for them.
- The grown-up PIN is a new secret. Anyone who knows it can approve proofs, write quests, release
  drawn creatures and delete pictures, so it is set only with `scripts/admin.sh` on the Mac mini.
- Mailbox quests, waiting proofs, pixel items, decorations and drawn creatures are new saved data,
  so they come with new save versions and migrations.
- Decoding and re-encoding pictures takes CPU and memory on the Mac mini's one core and 512 MB. The
  width and height check and the limit of 3 waiting proofs per player keep that bounded.
- Backups: if pictures are kept in the database, Litestream's 7 days of history keep a deleted
  original in the backup folder for up to 7 days. The build says where pictures live and how long a
  deleted one can survive in a backup.
- A grown-up must be around for a proof to count. That is on purpose: real-world quests are
  something to share, not to grind.
- Drawn creatures need a fair stats template, so a drawn creature is never stronger than any other
  at its level, and duels stay fair.
