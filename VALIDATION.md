# Validation Results

Latest results for the validation suite in SCIENCE.md §8. Update this file whenever physics code changes.

| ID | Test | Result | Key numbers | Date |
|---|---|---|---|---|
| V1 | Lid-driven cavity | **PASS** | Re 100: max centreline error vs Ghia 0.0059 (64²) and 0.0080 (128²), criterion 0.05·U. Re 400 (info): 0.0246 (64²), 0.0081 (128²) | 2026-09-24 |
| V2 | Poiseuille channel | **PASS** | 64 × 32 cells, Re 20: max error 0.72% of u_max (criterion 2%) | 2026-09-24 |
| V3 | Two-opening network | **PASS** | 4 cases (A1/A2 from 0.2–1.5 m², U_met 0.5–10 m/s); max rel. error 2.1e-16 vs criterion 1e-6 | 2026-09-24 |
| V4 | Cp(β) table | **PASS** | 9 angles; max abs. error 0.0005 vs criterion 0.002 | 2026-09-24 |
| V5 | Fan jet decay (calibration) | not yet implemented | — | — |
| V6 | Closed room conservation | **PASS** | max\|∇·u\| 1.0e-5 1/s (criterion 1e-4); kinetic energy fell every step after stirring (0 increases); mean T drift 1.8e-12 K = 5e-11% of the 3.9 K initial spread (criterion 1%, tightened 2026-09-24) | 2026-09-24 |
| V7 | Stack sign | **PASS** | 80 °F in / 60 °F out, openings at 0.5 m and 2.0 m: +302 CFM in low, −314 CFM out high; reverses when colder inside | 2026-09-24 |
| V8 | Well-mixed sanity | not yet implemented | — | — |
| V9 | CONTAM cross-check (manual) | not yet implemented | — | — |

## Supporting tests (non-physics)

| Test | Result | Date |
|---|---|---|
| Unit conversions (`tests/units_test.js`) | PASS (13/13) | 2026-09-24 |
| Constants sanity (`tests/constants_test.js`) | PASS (6/6) | 2026-09-24 |
| Layer A building blocks (`tests/envelope_test.js`) | PASS (21/21) | 2026-09-24 |
| Layer B building blocks (`tests/fluid_test.js`) | PASS (10/10) | 2026-09-24 |

## Notes

- **2026-09-24, Phase 2:** the single-opening unit test found that bisecting zone pressure to 1e-6 Pa left ~0.3 CFM of spurious flow in a one-window room (flow ∝ √ΔP). Bisection now runs to floating-point precision; SCIENCE.md §5.5 updated with the reason.
- **2026-09-24, Phase 3, V1:** "within 5%" is read as max |model − Ghia| ≤ 0.05 × lid speed at Ghia's tabulated points. A per-point relative error isn't usable because several reference values are near zero (e.g. u = 0.00332). Interpretation confirmed by Marty 2026-09-24 and recorded in SCIENCE.md §8. Ghia data were checked against a published transcription (links in `tests/v1_cavity.js`); the Re 400 point at x = 0.9063 is a known typo and is skipped. The full V1 run takes about 3.5 minutes (the 128² cases dominate).
- **2026-09-24, Phase 3, V2:** driven by fixed pressures at both ends (the solver's pressure-outlet condition). The 0.72% error is uniform across the channel and shrinks in proportion to Δt (0.72% → 0.41% → 0.25% as Δt halves), leaving a ~0.1% spatial floor. This is the known O(Δt) splitting error of non-incremental projection (Stable Fluids) at no-slip walls. In a real room (ν_eff ≤ 0.05 m²/s, Δt ≤ 0.05 s, H ≈ 3 m) it is ≈ 8·ν·Δt/H² ≈ 0.2%.
- **2026-09-24, Phase 3, V6:** stirring uses a stand-in actuator in the test (the SCIENCE.md §6.6 relaxation rule, 2 m/s, 0.5 m wide) because fans arrive in Phase 4; it will be replaced by `fans.js`. **Temperature drift caveat:** the criterion (0.1% of absolute temperature ≈ 0.29 K) passes, but the 0.138 K drift is 3.5% of the room's initial 4 K spread. Cause: semi-Lagrangian advection (as specified in §6.2) is not exactly conservative. It is a discretization error, not a bug: it falls ~3.3× when the grid is refined from 0.1 m to 0.05 m. **Resolved 2026-09-24 (Marty chose option B):** a heat-conservation correction was added after T advection (SCIENCE.md §6.2), and the V6 criterion was tightened to "drift < 1% of initial spread". Drift went from 0.138 K to 1.8e-12 K. Side effect: during a sharp cool front at an inlet, cells can briefly undershoot the inlet temperature (~0.3 K in a 10 K flush test), which then washes out completely.
