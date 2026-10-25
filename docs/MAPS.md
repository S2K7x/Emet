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
- Each zone has 1 door to the Nexus and 1 door to each of its 2 neighboring zones.
- Portals (`portals` in `map.json`): 2 pairs linking opposite zones diagonally, Moon ↔ Candy (purple) and Ice ↔ Neon (teal), in the outer corners. Stand still on one for 1 s to warp to its pair (8 s cooldown). Each pad is labeled with where it leads and shows on the minimap.
- Meeting place: the round table in the Nexus. During a meeting the living sit around it (one fixed seat each) and leave from there.
- Walls and obstacles block movement **and line of sight**: no killing or reporting through a wall.
- Zone rules are active (`rule` on each zone in `map.json`, see `DECISIONS.md`): Moon = low gravity (floaty, harder to grab), Ice = slippery (sliding, killers can slip and miss), Neon = dark (non-killers see little), Candy = sugar rush (x1.3 speed). The Nexus has no rule. When zones overlap, the last one listed wins (the Nexus is listed last).
- Visual style: one light source (top left), every wall and obstacle casts the same drop shadow; wall tops are tinted with their zone's color. Doors between zones (`doors` in `map.json`) are drawn as shimmering portal thresholds.
- Decor (`decor` in `map.json`) never collides, so it stays flat (footprints, puddles, cables, donuts) or smaller than a player (rocks, penguins, plants, gumdrops): anything big must be a real obstacle. Decor doubles as landmarks for meeting callouts ("by the penguins", "near the NO EXIT sign").
- Ambient motion per zone (twinkling stars, snowfall, neon motes, candy bubbles), purely cosmetic.
- Automated check: `npm run test:map` (free spawns, all zones reachable, walls that block).

## To do
- Test for real whether 2000 × 1400 is too big or too small for 5-10 players.
- ~~Meeting locations~~ → everyone returns to the Nexus.
