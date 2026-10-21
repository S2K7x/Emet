# Maps and multiverse — Emet

## Principle
A game is played on a map made of **4 zones**, each in a different universe. Each zone has a rule that changes gameplay (not just the look).

## Zones (starting ideas)
| Universe | Zone rule | Effect on the game |
|---|---|---|
| Moon / low gravity | Very high jumps | Easy escapes, unpredictable movement |
| Ice | Slippery floor | Hard-to-control movement, missed kills |
| Neon / cyberpunk | Dark zone | Reduced visibility, good for killers |
| Candy / cartoon | Speed x1.3 | Makes the zone dangerous and chaotic |

## Rules
- Player skins are **cosmetic only**, to avoid confusion about roles.
- Each zone has themed quests.
- Zones are linked by portals (travel time to be tested).
- Eventually plan several maps, with 4 random zones from a pool.

## Current map: Nexus (`data/map.json`)
- 2000 × 1400 px. Full crossing ≈ 9 s at base speed.
- **Nexus** in the center: spawn point and return point after meetings, round table with the future emergency button.
- 4 zones around it: Moon (top left), Ice (top right), Neon (bottom left), Candy (bottom right).
- Each zone has 1 door to the Nexus and 1 door to each of its 2 neighboring zones (simple doors for now; portals come in Phase 4).
- Walls and obstacles block movement **and line of sight**: no killing or reporting through a wall.
- Zone rules (ice, gravity, etc.) are not active yet: Phase 1 only does the scenery.
- Automated check: `npm run test:map` (free spawns, all zones reachable, walls that block).

## To do
- Test for real whether 2000 × 1400 is too big or too small for 5-10 players.
- ~~Meeting locations~~ → everyone returns to the Nexus.
