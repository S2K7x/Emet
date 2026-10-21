# Emet — project context for Claude Code

Real-time multiplayer social deduction game (Among Us / Werewolf style), funny and chaotic, with a **multiverse** theme. Mobile + PC, 5 to 10 players, 5 to 10 minute games.

## Reference documents (read before coding)
- `docs/GDD.md`: full game design (game loop, win conditions, pacing)
- `docs/ROLES.md`: innocent roles, killers, powers, balancing rules
- `docs/MAPS.md`: multiverse maps and zones with special rules
- `docs/ARCHITECTURE.md`: technical choices and network architecture
- `docs/ROADMAP.md`: development stages
- `docs/DECISIONS.md`: decision log and open questions

## Working rules
- The server is **authoritative**: the client only sends intents, never a result.
- Roles, powers, durations and numbers are **data** (JSON/Resource), not hardcoded. Everything must be changeable in the game settings.
- A design decision changes? Update `docs/DECISIONS.md` before coding.
- Never send the client information it must not know (other players' roles, who the killers are).
- Start small: a playable prototype with 4 players and 3 roles before adding content.

## Collaboration style (Shai)
- Short answers, code before explanation, concrete example before theory.
- Suggest alternatives and flag risks without waiting to be asked.
