# Game Design Document — Emet

## Pitch
Innocents do quests in a chaotic multiverse while killers take them out live. Every innocent has a fun power. Meetings, votes, useful ghosts: in 8 minutes, everyone is accusing everyone.

## Pillars
1. **Fun and chaos first**: if it isn't fun, it doesn't go in.
2. **Nobody is useless**: every role has a power, the dead stay active.
3. **Short games**: 5 to 10 minutes, never any waiting.
4. **Readable on mobile**: simple controls, communication through emojis/quick phrases.

## Base settings
| Element | Default value | Configurable |
|---|---|---|
| Players | 5 to 10 | yes |
| Game length | ~8 min | yes |
| Killers | 1 (5-6 players), 2 (7-10) | yes |
| Rounds | 3 rounds of 2 min | yes, proportional to game length |
| Meeting | 40 s of discussion + vote | yes |
| Platforms | Mobile + PC | |

## Game loop
1. **Start**: roles are assigned (see `ROLES.md`), 10 s intro.
2. **Round (2 min, real time)**: innocents do quests, killers kill and sabotage. Everyone moves freely around the map.
3. **Meeting**: triggered by a reported body (immediately), the emergency button (1 per player) or at the end of the round. Discussion, then anonymous vote.
4. **Vote**: the most-voted player is ejected and only reveals "innocent" or "killer". Tie = no one ejected. An innocent wrongly ejected is the innocents' loss.
5. Back to the next round, until a win condition is met.

## Win conditions
- **Innocents**: quest bar full **or** all killers eliminated (two possible paths).
- **Killers**: survivor parity (killers >= innocents) **or** time runs out.
- Time running out gives the win to the killers, to push innocents to act.

## Quests
- 5 to 10 s mini-games, tied to the zone you're in.
- No repetitive chore tasks (Among Us's problem).
- Every quest fills the shared bar.
- v1 (one per station): 📡 tune the signal (slider), 🪨 tap drifting moon rocks, 🐟 timed fishing, 🧊 mash to defrost, 💾 Simon on the servers, 🕹️ whack-the-aliens, 🍭 swirl around the lollipop, 🎂 connect the frosting dots.

## Death, ghosts and revival
- A dead player becomes a ghost: ghost-only chat, ghost quests that count toward the bar.
- The more quests a ghost does, the more likely it is to be picked for a revival.
- Revival: Sacrifice (a **killed** player, not one ejected by vote) and Gambler. Cap of 2 revivals per game.
- A player ejected by vote never comes back: votes keep their stakes.

## Communication
- Voice during meetings (optional).
- Emoji and quick-phrase wheel for mobile.
- No free text chat between living and ghosts (ghosts only talk among themselves).

## What makes Emet different from Among Us
- Every role has a power, with visible effects that create clues and chaos.
- Each innocent is offered 2 roles and secretly keeps 1 (choice without a race).
- Killer powers are chaotic and random.
- Multiverse maps: several universes in the same game, with zone rules that change gameplay.
- Useful ghosts and high-stakes revivals.

## Watch-outs (from research)
- Early elimination = boredom: active ghosts are mandatory.
- Too many roles or players = confusion: 6 to 8 roles in play per game, 10 players max.
- Games too short if the killer is seen on the first kill: kill cooldown and concealment powers.
- The game works better with voice: plan for voice chat in meetings.
