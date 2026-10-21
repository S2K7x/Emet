# Roles — Emet

## Assignment
- **Killers** are drawn at random.
- Each **innocent** is offered 2 random roles and secretly keeps 1 (choice within a short time limit).
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

## Innocent roles (v0)
| Role | Power | Weakness / limit |
|---|---|---|
| Teleporter | Teleports 2 random players every X seconds | Random targets, can help a killer |
| Flyer | Flies through the air for a few seconds | Visible to everyone, limited duration |
| Cop | Ties 2 players together until the next meeting | Usable during rounds 1 and 2, blind decision |
| Gambler | One wheel per game: randomly kills 1 player then revives 1 player | Random, everyone sees the wheel spin, not the result |
| DJ | Makes everyone dance for a few seconds, except themselves | Very visible, gives away their position |
| Sacrifice | Sacrifices themselves to revive a **killed** player | Dies permanently, only once |

## Roles to design (ideas to fill the pool)
- Detective: sees the latest movements around a body.
- Medic: protects a player from a kill for X seconds.
- Ghost Radio: briefly talks to ghosts while still alive.
- Mime: copies the power of the last player in range.
- Ball and Chain: slows nearby players but is immune to one ejection.
- Neutral role (jester): wins if ejected by vote.

## Killers
- 1 killer for 5-6 players, 2 for 7-10 (configurable).
- Killers know each other (configurable).
- Short-range kill, 25 s cooldown.
- Each gets **1 random chaotic power**: disguise, fake body, lights out, position swap, etc.

## Interaction rules to decide / test
- Can a player tied by the Cop be killed? Proposal: yes, and the closest tied player becomes a witness to the body.
- Sacrifice and Gambler can both revive: global cap of 2 revivals per game.
- A killer pretending to be the Gambler (the wheel is visible): watch for this in playtests.

## Balancing
- Starting values in `data/roles/` once the project is created.
- Playtest at 4, 6 and 8 players before adding roles.
- Only add a role if it creates a new decision or a new story.
