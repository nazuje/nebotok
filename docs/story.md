# The placeholder story

This is the Slice B story: four characters, six deliveries and two chapters. It is a placeholder
so the game has something to play while the kids write the real one. Use this page on the story
day as a starting point: keep what they like, throw out the rest.

When the real story arrives, a later save version resets each player's quests and story flags and
keeps their creatures, items and levels (`docs/protocol.md`, "Saves").

## The setting

The player is a new courier for the Sky Post, carrying letters between floating islands. The
first island, Post Island, has the post office, a meadow with tall grass, a small shrine, windy
grass in the south-west and a lookout on the east edge.

## The characters

| Character | Where | What they are like |
| --- | --- | --- |
| **Bavko**, the postmaster | by the post office door | Round, cheerful and a bit forgetful. Gives out the deliveries. |
| **Tobolko**, keeper of bags and treats | by the meadow | Patient and a little dramatic ("Oh dear, oh dear!"). Teaches battles and befriending. |
| **Mehurka**, the shrine keeper | by the shrine | Calm. Speaks in short sentences. Loves bubbles. |
| **Vetrinka**, the weather-watcher | at the east lookout | Sharp-eyed and worried about the winds. |

Names have no č, š or ž so English readers can say them too.

## Chapter 1: Training at the Sky Post

1. **First Round** (from Bavko). Bavko gives the new courier their first creature, then a
   hello note for Tobolko. Tobolko shows the bag of treats. *Teaches walking and talking.*
   Reward: 3 plain treats.
2. **Jumpy Grass** (from Tobolko, after 1). The meadow creatures are jumpy. Win 2 battles in the
   meadow's tall grass, then tell Tobolko. *Teaches battles.* Reward: 20 experience, 2 sun treats.
3. **A Bell for Mehurka** (from Bavko, after 1). The shrine's old bell cracked in a gust. Bring the
   new bell to Mehurka, then rest at the shrine. Mehurka explains that a team that faints wakes up
   at the shrine, safe. *Teaches the shrine.* Reward: 2 rain treats.
4. **A New Teammate** (from Tobolko, after 2). Offer a treat to a wild creature in battle until one
   joins the team, then tell Tobolko. If the courier runs out of treats, Tobolko hands out 3 plain
   ones. *Teaches befriending.* Reward: 20 experience, 3 bloom treats.

## Chapter 2: Quiet Clouds

5. **Wind Readings** (from Bavko, after 3 and 4). Bring Vetrinka a wind gauge. It spins wrong, so
   she asks the courier to win a battle in the windy grass. Back at the lookout she says the mail
   from the outer islands has stopped. Reward: 40 experience, 2 gale treats.
6. **The Grey Letter** (from Bavko, after 5). A soaked grey envelope with no sender came on the
   wind. Vetrinka reads it: "The clouds over the far islands are going quiet. Something out there
   is hungry." She sends the courier to the lookout, where they see a dark cloud with a wide mouth
   swallow a small cloud and vanish (the `storm-glimpse` scene). Vetrinka: "That was no storm.
   Storms don't eat." She sends the letter back to Bavko, who turns it over: it is addressed "To
   the new courier". *To be continued.* Reward: 50 experience, 3 storm treats.

The cloud creature has no name yet. It is spooky, but nothing gets hurt.

## Story flags

- `grey-letter-read`: Vetrinka read the grey letter.
- `storm-seen`: the courier saw the cloud from the lookout. Tobolko and Mehurka notice it after.
- `chapter-1-done`: Bavko found the letter is for the courier. Ends chapter 2.

## Questions for the story day

- Who sent the grey letter, and why to the new courier?
- What is the hungry cloud? What should it be called?
- What is on the outer islands, and who lives there?
- What should Bavko, Tobolko, Mehurka and Vetrinka really be called, and what do they look like?
- Which jobs should a courier do next?

## Where the story lives

- Characters: `content/npcs.json`. What they say: `content/dialogue/<character>.json`.
- Quests: `content/quests.json`. Chapters and flags: `content/story.json`.
- Quest items (hello note, Mehurka's bell, wind gauge, grey letter): `content/items.json`.
- How the files fit together: "The story" in `content/AGENTS.md`.
