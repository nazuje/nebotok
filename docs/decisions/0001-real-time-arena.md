# Real-time arena battles replace turn battles

Status: accepted (2026-11-17, #116 and #141)

Turn battles felt slow. In the battle-feel prototype (branch `prototype/battle-feel`) the owner and
the kids liked a live duel better than faster "active" turns, and then chose its variant 6,
"Arena" (at 54d1893): creatures that move freely on a round floating island, with
abilities on cooldowns, a dash, a shrinking storm, and a win by knockout or ring-out. So battles
become real-time arena fights. The server runs each fight as a fixed 60 Hz step of whole-number
core rules with a seeded RNG, in its own Colyseus room, `arena`, one per fight. Clients send only a
stick direction and button presses, predict their own creature with the same core step, and smooth
the other. The rules are in [arena.md](../arena.md) and the wire plan in
[protocol.md](../protocol.md) ("Arena fights").

## Considered options

- **Turns with a timer.** Keeps the turn engine and its checks. The prototype's "active turns"
  tried it, and the family liked the live variants better; a timer also adds pressure for a child
  who cannot read.
- **Lockstep, peer to peer.** Each device runs the fight from the other's inputs, and the server
  only relays. It waits for the slowest device on every step, cannot hide a sibling's lag, and
  lets a changed page decide an outcome. The server must stay the one that decides.
- **The fight inside the world room.** No hand-off between rooms, but one room has one fixed step:
  the world steps at 20 Hz and the arena needs 60. The world room's message limit (30 a second
  disconnects) would trip on a 30 Hz input stream, and loosening it weakens a guard for everyone.
  The fight's state would go to every player in every patch, where battles are private today, and
  an error in a fight could stop the world.

## Consequences

- Whole-number maths in `packages/core/src/arena/`: the prototype's floating-point trig is ported to
  direction tables and an integer square root, so a server in Node and an iPad's Safari agree. Its
  feel shifts a little.
- A hand-off between rooms: the world room keeps the seat busy (`inBattle`) and stays the only
  writer of saves; the arena room hands the result back.
- Two save versions: v7 adds loadouts and the turtle setting and keeps `moves` while turns live;
  v8 drops `moves` at the switch-over. Moves forgotten in turn battles come back.
- Two battle systems at once behind the `ARENA_BATTLES` setting, from #150 until the switch-over
  (#160), with both kinds of check running and taking time. The switch-over removes the turn engine,
  screens, messages and checks only after the family has played the arena on an iPad (#159) and the
  owner says go.
- More server load: several 60 Hz fights next to the 20 Hz world on the Mac mini's one CPU and
  512 MB. #149 measures it against a budget.
- A real-time fight is harder to check headless: checks drive it by keys and taps from prepared
  saves against a weak creature, and judge outcomes and layout, never frame timing.
