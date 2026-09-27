# Validation Results

Latest results for the validation suite in SCIENCE.md §8. Update this file whenever physics code changes.

| ID | Test | Result | Key numbers | Date |
|---|---|---|---|---|
| V1 | Lid-driven cavity | **PASS** | Re 100: max centreline error vs Ghia 0.0059 (64²) and 0.0080 (128²), criterion 0.05·U. Re 400 (info): 0.0246 (64²), 0.0081 (128²) | 2026-09-24 |
| V2 | Poiseuille channel | **PASS** | 64 × 32 cells, Re 20: max error 0.72% of u_max (criterion 2%) | 2026-09-24 |
| V3 | Two-opening network | **PASS** | 4 cases (A1/A2 from 0.2–1.5 m², U_met 0.5–10 m/s); max rel. error 2.1e-16 vs criterion 1e-6 | 2026-09-24 |
| V4 | Cp(β) table | **PASS** | 9 angles; max abs. error 0.0005 vs criterion 0.002 | 2026-09-24 |
| V5 | Fan jet decay (**calibration**) | **PASS** | c_f = 0.2: centreline V_x/V_0 within −21.8% … +12.3% of K·√A₀/x over 2.91–5 m (criterion ±25%) | 2026-09-25 |
| V6 | Closed room conservation | **PASS** | Real 20" box fan (off at 10 s). max\|∇·u\| 1.0e-5 1/s (criterion 1e-4); kinetic energy fell every step after switch-off (0 increases); mean T drift 3.5e-12 K = 9e-11% of the 3.9 K initial spread (criterion 1%) | 2026-09-25 |
| V7 | Stack sign | **PASS** | 80 °F in / 60 °F out, openings at 0.5 m and 2.0 m: +302 CFM in low, −314 CFM out high; reverses when colder inside | 2026-09-24 |
| V8 | Well-mixed sanity | **PASS** | 4 × 4 m room, one inlet, one offset outlet: room-average age 0.76·τ_n (criterion 0.5–1.5) | 2026-09-25 |
| V9 | CONTAM cross-check (manual) | not yet implemented | — | — |

## Supporting tests (non-physics)

| Test | Result | Date |
|---|---|---|
| Unit conversions (`tests/units_test.js`) | PASS (13/13) | 2026-09-24 |
| Constants sanity (`tests/constants_test.js`) | PASS (6/6) | 2026-09-24 |
| Layer A building blocks (`tests/envelope_test.js`) | PASS (21/21) | 2026-09-24 |
| Layer B building blocks (`tests/fluid_test.js`) | PASS (10/10) | 2026-09-27 |
| Layout model and grid (`tests/layout_test.js`) | PASS (17/17) | 2026-09-27 |
| Layer A ↔ B coupling (`tests/coupling_test.js`) | PASS (10/10) | 2026-09-27 |
| Simulation runner / worker loop (`tests/engine_test.js`) | PASS (5/5) | 2026-09-28 |
| Metrics: probes, time to target, comparison (`tests/metrics_test.js`) | PASS (6/6) | 2026-09-28 |
| Presets load and run (`tests/presets_test.js`) | PASS (5/5) | 2026-09-28 |

## Notes

- **2026-09-24, Phase 2:** the single-opening unit test found that bisecting zone pressure to 1e-6 Pa left ~0.3 CFM of spurious flow in a one-window room (flow ∝ √ΔP). Bisection now runs to floating-point precision; SCIENCE.md §5.5 updated with the reason.
- **2026-09-24, Phase 3, V1:** "within 5%" is read as max |model − Ghia| ≤ 0.05 × lid speed at Ghia's tabulated points. A per-point relative error isn't usable because several reference values are near zero (e.g. u = 0.00332). Interpretation confirmed by Marty 2026-09-24 and recorded in SCIENCE.md §8. Ghia data were checked against a published transcription (links in `tests/v1_cavity.js`); the Re 400 point at x = 0.9063 is a known typo and is skipped. The full V1 run takes about 3.5 minutes (the 128² cases dominate).
- **2026-09-24, Phase 3, V2:** driven by fixed pressures at both ends (the solver's pressure-outlet condition). The 0.72% error is uniform across the channel and shrinks in proportion to Δt (0.72% → 0.41% → 0.25% as Δt halves), leaving a ~0.1% spatial floor. This is the known O(Δt) splitting error of non-incremental projection (Stable Fluids) at no-slip walls. In a real room (ν_eff ≤ 0.05 m²/s, Δt ≤ 0.05 s, H ≈ 3 m) it is ≈ 8·ν·Δt/H² ≈ 0.2%.
- **2026-09-24, Phase 3, V6:** stirring uses a stand-in actuator in the test (the SCIENCE.md §6.6 relaxation rule, 2 m/s, 0.5 m wide) because fans arrive in Phase 4; it will be replaced by `fans.js`. **Temperature drift caveat:** the criterion (0.1% of absolute temperature ≈ 0.29 K) passes, but the 0.138 K drift is 3.5% of the room's initial 4 K spread. Cause: semi-Lagrangian advection (as specified in §6.2) is not exactly conservative. It is a discretization error, not a bug: it falls ~3.3× when the grid is refined from 0.1 m to 0.05 m. **Resolved 2026-09-24 (Marty chose option B):** a heat-conservation correction was added after T advection (SCIENCE.md §6.2), and the V6 criterion was tightened to "drift < 1% of initial spread". Drift went from 0.138 K to 1.8e-12 K. Side effect: during a sharp cool front at an inlet, cells can briefly undershoot the inlet temperature (~0.3 K in a 10 K flush test), which then washes out completely.
- **2026-09-25, Phase 4, fans:** the SCIENCE.md relaxation actuator delivered only 50% of a fan's rated flow (projection partly undid it each step). Fans are now fixed-flow actuators (face velocity held at U_cur·n̂, spin-up τ = 0.1 s), approved by Marty; SCIENCE.md §6.6 updated.
- **2026-09-25, Phase 4, V8 / mixing floor:** without it, V8 failed (age 4.5·τ_n and rising): 2D recirculation eddies stayed sealed because Smagorinsky gives only ~1.7e-4 m²/s. A scalar mixing floor from Cheng et al. (2011), K_min = (0.52·ACH + 0.31 h⁻¹)·V^(2/3)/3600, brings it to 0.76·τ_n. **Caveat:** V8's room runs at ~100 ACH on the solver's basis, far beyond Cheng's measured 0.2–5.4 ACH, so the relation is extrapolated. At 5 ACH mixing, V8 would still fail (≈ 2.7·τ_n). Approved by Marty; SCIENCE.md §6.5 updated.
- **2026-09-25, Phase 4, V5 calibration:** V5 is a calibration, not independent validation. The comparison range was changed from 1–5 m to K·√A₀ (≈ 2.9 m)–5 m with Marty's OK, because the main-zone formula predicts V_x > V_0 inside ~2.9 m. c_f sweep (worst error over the range): 0.004–0.12 → 40–76% (the 2D jet wanders, so its time-averaged centreline speed is low); 0.14 → 15% on a 60–240 s average but 27% on 60–420 s (regime boundary, rejected as not robust); 0.16 → 23%; **0.2 → 22% on both averaging windows (chosen)**; 0.25 → 27%; 0.3 → 32%; 0.4 → 40%. The model's decay is shallower than 1/x (−22% at 2.9 m, +12% at 5 m). c_f = 0.2 is ~50× a physical wall-friction value: it stands in for the 3D spreading a plan-view jet lacks. V5 takes ~3.5 minutes; the full suite now takes ~7.5 minutes.
- **Open item for Phase 6 (coupling):** in plan view, an inlet of width w carries u_n·w per unit depth, which corresponds to Q_j·(H_room / h_opening) in 3D. Layer B's ACH (used for age of air and the mixing floor) is therefore ~H_room/h_opening (≈ 2× for a typical window) higher than Layer A's authoritative ACH. To decide when coupling the two layers.
- **2026-09-27, Phase 6, coupling:** the slice air-budget problem (open item above) was resolved with option A (approved by Marty, SCIENCE.md §6.7). True inflow speeds are kept, the zone-mean temperature follows Layer A's well-mixed heat balance, and the age clock runs at the slice factor r_z (≈ 4 for a half-open 0.9 × 1.2 m window in a 2.44 m room). `tests/coupling_test.js` checks: wind direction flips inlets/outlets (the Phase 6 done-criterion), orientation, r_z, zone heat balance, age rate, single-window exchange, unbalanced window fans and fan mapping. Opening flows under 1e-6 m³/s count as zero (floating-point floor ~1e-8).
- **2026-09-27, performance (to address in Phase 7):** in Node, a 16 × 14 ft bedroom runs at ~4× real time, a 30 × 25 ft apartment ~0.9×, a 48 × 38 ft house ~0.3×. Profile (apartment): pressure solve ~48%, advection ~27%, scalar diffusion ~13%.
- **2026-09-28, Phase 7, speed:** numerical tolerances loosened (PCG_TOL_FRACTION 0.1 → 0.5, DIFFUSION_REL_TOL 1e-8 → 1e-6; reasons in constants.js). All validation tests re-run and pass; the V6 max|∇·u| rose from 1.0e-5 to 5.0e-5 (criterion 1e-4). Temperature and age now share one back-trace per step (identical results). A multigrid preconditioner was tried and dropped (+8% on a house-sized grid; see BACKLOG.md). The solver now runs in a Web Worker (engine/), which gives it a full core instead of ~55% of each frame. Benchmarks (Node, full core): apartment 30 × 25 ft ~1.5× real time, house 48 × 38 ft ~0.5×.
- **2026-09-28, Phase 8, metrics:** time to target is estimated from Layer A's heat balance (SCIENCE.md §7.3) and matches the exponential solution exactly in `tests/metrics_test.js`. End-to-end check: a 20" box fan 1.5 m from a person gives 178 ft/min at the person when pointed at them vs 110 ft/min when pointed away, so the comparison flags "better". Time to target is unchanged by the free-standing fan (to 0.1%, time-step noise), as the physics says it should be. **Caveat:** the "pointed away" value is high because in a flat slice a fan's intake and return currents are overstated (air can only come from the sides, not from above and below). The About panel says so.
