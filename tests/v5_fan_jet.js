// V5 — Fan jet decay. SCIENCE.md §8. THIS IS A CALIBRATION, not independent validation:
// the floor/ceiling drag coefficient c_f (constants.js C_F_DRAG) was chosen with this test.
// 20" box fan on high in an empty 10 × 10 m room, 1 m from the west wall, blowing east.
// Pass: time-averaged centreline velocity follows V_x/V_0 = K·sqrt(A_0)/x (K = 5.7) within ±25%
// from x = K·sqrt(A_0) (≈ 2.9 m) to 5 m, x measured from the fan face (range per SCIENCE.md §8).
// Production settings: turbulence, drag and mixing floor on, free-slip walls.
import { check, finish } from './lib.js';
import { makeBox } from './_fluid_setup.js';
import { step, computeDt, sampleU, setFans } from '../src/physics/fluid.js';
import { fanFromPreset, fanOutletVelocity } from '../src/physics/fans.js';
import { FAN_PRESETS, FAN_SPEED_FRACTIONS, C_F_DRAG } from '../src/constants.js';

const N = 100, h = 0.1;
const K = 5.7;                      // compact-jet centreline constant (ASHRAE / AIVC), SCIENCE.md §8
const T_SPINUP = 60, T_END = 240;   // average over 60–240 s: the 2D jet wanders, so use a long mean

const s = makeBox(N, N, { h });
const yc = h + 5.05, xc = h + 1.0;  // fan centred on a cell-centre row, 1 m from the west wall
const fan = fanFromPreset(FAN_PRESETS.box20, FAN_SPEED_FRACTIONS.high, xc, yc, 0);
setFans(s, [fan]);
const U0 = fanOutletVelocity(fan);
const xFace = xc + h;               // downstream edge of the 2-cell actuator
const x0 = K * Math.sqrt(fan.faceArea);
const X = [x0, 3.5, 4.0, 4.5, 5.0];
const acc = new Float64Array(X.length);
let n = 0;
while (s.time < T_END) {
  step(s, computeDt(s));
  if (s.time > T_SPINUP) { X.forEach((x, k) => { acc[k] += sampleU(s, xFace + x, yc); }); n++; }
}

console.log(`  c_f = ${C_F_DRAG}, U_0 = ${U0.toFixed(2)} m/s, A_0 = ${fan.faceArea.toFixed(4)} m², K·sqrt(A_0) = ${x0.toFixed(2)} m`);
console.log('  x (m)    V_x/V_0 model   formula   error');
let worst = 0;
X.forEach((x, k) => {
  const model = acc[k] / n / U0, ref = (K * Math.sqrt(fan.faceArea)) / x, err = model / ref - 1;
  worst = Math.max(worst, Math.abs(err));
  console.log(`  ${x.toFixed(2)}     ${model.toFixed(3)}          ${ref.toFixed(3)}     ${(100 * err).toFixed(1)}%`);
});

check('centreline decay within ±25% of K·sqrt(A_0)/x from K·sqrt(A_0) to 5 m', () => {
  if (!(worst <= 0.25)) throw new Error(`worst error ${(100 * worst).toFixed(1)}%`);
});

finish();
