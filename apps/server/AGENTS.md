# apps/server

The authoritative Colyseus 0.18 server. Read the `colyseus` skill before changing rooms, state or
messages.

- **Every message is validated.** Register handlers as `validate(<zod schema>, handler)` from
  `@colyseus/core`, with `z.strictObject` and bounded numbers, strings and arrays. Identify the
  player by the `client` argument, never by an id in the payload. The server decides every outcome;
  a client message is a request.
- **Config only from the environment**, read once by `readConfig` in `src/config.ts` through its zod
  schema. A new setting gets a default there and a line in `.env.example` (placeholder value only).
- **Logs** are JSON lines through `src/log.ts` (`log.info(message, fields)`), never `console.log`.
  Log ids and counts; never names, PINs or other player data.
- **Tests.** Room tests in `test/world-room.test.ts` boot the real server with `@colyseus/testing`
  and join through the SDK: test a room change there (`npx vitest run --project server`). The bot
  run (`node scripts/bot-run.mjs`) starts the real process with four bots and a reconnect. Both run
  at verify level 3.
- **Wire changes.** A message or state shape the client relies on changes `PROTOCOL_VERSION` in
  `packages/core/src/protocol.ts`, so old clients get a clear refusal instead of a broken game.
