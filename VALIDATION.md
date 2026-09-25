# Validation Results

Latest results for the validation suite in SCIENCE.md §8. Update this file whenever physics code changes.

| ID | Test | Result | Key numbers | Date |
|---|---|---|---|---|
| V1 | Lid-driven cavity | not yet implemented | — | — |
| V2 | Poiseuille channel | not yet implemented | — | — |
| V3 | Two-opening network | **PASS** | 4 cases (A1/A2 from 0.2–1.5 m², U_met 0.5–10 m/s); max rel. error 2.1e-16 vs criterion 1e-6 | 2026-09-24 |
| V4 | Cp(β) table | **PASS** | 9 angles; max abs. error 0.0005 vs criterion 0.002 | 2026-09-24 |
| V5 | Fan jet decay (calibration) | not yet implemented | — | — |
| V6 | Closed room conservation | not yet implemented | — | — |
| V7 | Stack sign | **PASS** | 80 °F in / 60 °F out, openings at 0.5 m and 2.0 m: +302 CFM in low, −314 CFM out high; reverses when colder inside | 2026-09-24 |
| V8 | Well-mixed sanity | not yet implemented | — | — |
| V9 | CONTAM cross-check (manual) | not yet implemented | — | — |

## Supporting tests (non-physics)

| Test | Result | Date |
|---|---|---|
| Unit conversions (`tests/units_test.js`) | PASS (13/13) | 2026-09-24 |
| Constants sanity (`tests/constants_test.js`) | PASS (6/6) | 2026-09-24 |
| Layer A building blocks (`tests/envelope_test.js`) | PASS (21/21) | 2026-09-24 |

## Notes

- **2026-09-24, Phase 2:** the single-opening unit test found that bisecting zone pressure to 1e-6 Pa left ~0.3 CFM of spurious flow in a one-window room (flow ∝ √ΔP). Bisection now runs to floating-point precision; SCIENCE.md §5.5 updated with the reason.
