# Backlog

Feedback and ideas collected along the way, so nothing gets lost.

- **Small UI / quality-of-life items** get folded into the next phase, or into Phase 9 (polish).
- **Anything that changes physics** is scheduled on purpose: SCIENCE.md is updated first (with sources), then the code (CLAUDE.md rule 1).

## Open

### Ceiling fans (requested by Marty, 2026-09-27)
Place a ceiling fan in a room, as a type in the fan dropdown.

- **Physics catch:** a ceiling fan's airflow is mostly vertical (down to the floor, out along it, up the walls). The plan-view slice can't represent that, and SCIENCE.md §1/§6.6 lists ceiling fans as out of scope for v1.
- **Proposed approach (option B, to confirm with Marty):** add it in Phase 8 alongside comfort probes, as a clearly labelled simplified model. It raises occupant-level air speed under and around the fan (from published ceiling-fan data, to be researched and cited) and increases room mixing. No arrows or pathlines are drawn for it. Needs a SCIENCE.md section and Marty's OK before building.
- **Alternatives:** wait for the v2 side-section view (most accurate, far off), or add a placeholder dropdown entry now (not recommended: it would do nothing).

## Done
