# Roles — Emet

## Assignment
- **Killers** are drawn at random.
- Each **innocent** is offered 2 random roles and secretly keeps 1 (choice within a short time limit). *Prototype: 1 random role, no choice yet.*
- Total pool of about 16 roles, **6 to 8 in play per game**. Players don't know which ones.
- No role without a power. Each power has 1-2 uses or a long cooldown.
- Effects are visible to everyone; the user stays hidden unless they're in line of sight.
- Everything is data (one JSON/Resource file per role), never hardcoded.

## Role data schema
```json
{
  "id": "teleporter",
  "team": "innocent",
  "name": "Teleporter",
  "power": "Teleports 2 random players",
  "uses": -1,
  "cooldown_s": 45,
  "visible_effect": true,
  "reveals_user": false,
  "weakness": "Doesn't choose the targets",
  "enabled": true
}
```

## Implemented roles (data/powers.json)
Each player gets one special role on top of their team. Numbers (cooldown, uses, durations, ranges) are in `data/powers.json`; behavior is one handler per id in `server/src/powers.ts`. Set `"enabled": false` to take a role out of the pool.

### Innocent
| Role | Power | Weakness / limit |
|---|---|---|
| 🎧 DJ | Everyone else dances on the spot (can't move) for 4 s | Banner for everyone + headphones over the DJ |
| 🌀 Teleporter | Swaps 2 random players (maybe yourself) | Random, can help a killer |
| 🩹 Medic | Bubble on the closest player: blocks one kill (wasted kill + cooldown) | Bubble visible to all, 20 s |
| 🍌 Prankster | Drops a banana (max 3). Anyone stepping on it slides out of control | Killers can use it to flee |
| 🎰 Gambler | Once: wheel spins, a random player dies, then a random killed player revives | Totally random, banner for everyone |
| 🕯️ Sacrifice | Next to a body: you die, they revive. On a fake body you die for nothing | Once, permanent |
| 🍁 Canadian | Passive: your body reports itself 2.5 s after you die | You have to die first |

### Neutral (max 1 per game, `neutralChance`, from `neutralMinPlayers`)
| Role | Win | Power |
|---|---|---|
| 🤡 Jester | Wins alone if voted out | Prank call: one emergency meeting from anywhere |
| 🦅 Vulture | Wins alone after eating 3 bodies | Eats a body in range (destroys evidence) |

### Killer powers (each killer gets one)
| Role | Power |
|---|---|
| 🌑 Blackout | Lights out 8 s: innocents/neutrals only see 170 px around them (filtered server-side) |
| 🎭 Shapeshifter | Takes the look and name of a random player for 15 s (killer teammates see through it) |
| 🔄 Swapper | Swaps position with a random innocent |
| 🎈 Prop Master | Drops a fake body of a random living player (2 uses). Reporting it calls a real meeting |

### Rules
- Revivals (Gambler, Sacrifice): only killed players with a body, never ejected ones, global cap `reviveCap` = 2.
- Meetings cancel dances, slips, disguises and lights out. Bodies and bananas are cleared after a meeting.
- A Jester ejection ends the game immediately; a Vulture reaching its goal too.
- Neutrals count as non-killers for parity. Innocents win when all killers are gone, even if a neutral is alive.
- Everyone's special role is revealed on the end screen.
- Ideas from Goose Goose Duck (Canadian, Vulture, Dodo/Jester) and Among Us mods (Medic, Swapper, Morphling, Jester).

## Not built yet (ideas)
- Flyer, Cop (tether), Detective, Ghost Radio, Mime, Ball and Chain (from the original list).
- Party Duck: gives players a squeaky voice in meetings (needs voice chat).
- Mortician: sees how long a body has been dead.
- Politician: wins vote ties.

## Interaction rules to decide / test
- Can a player tied by the Cop be killed? Proposal: yes, and the closest tied player becomes a witness to the body.
- Sacrifice and Gambler can both revive: global cap of 2 revivals per game.
- A killer pretending to be the Gambler (the wheel is visible): watch for this in playtests.

## Balancing
- Starting values in `data/roles/` once the project is created.
- Playtest at 4, 6 and 8 players before adding roles.
- Only add a role if it creates a new decision or a new story.
