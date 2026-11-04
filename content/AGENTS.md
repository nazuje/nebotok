# content

Game content as JSON data. Every file is checked against its schema in `CONTENT_SCHEMAS`
(`packages/core/src/content.ts`); a file without a schema fails `npm run content:validate`. Adding
content follows the `add-content` skill.

- **Both languages, always.** Every text a player reads is `{ "en": "...", "sl": "..." }`.
- **Write for players aged 8 to 16:** short sentences, friendly and clear.
- **Slovenian:** never assume the player's gender. Slovenian past tense and many adjectives show
  gender (`si našel` / `si našla`), so use the present tense or the imperative instead: "Najdeš
  pismo." or "Poišči pismo.", not "Našel si pismo." Address the player with the informal *ti*.
- Use the Slovenian typographic conventions already in `strings.json`: a space before the ellipsis
  (`Povezovanje …`) and lowercase language names (`angleščina`).
- Names are original. Players' and real children's names never appear here.
