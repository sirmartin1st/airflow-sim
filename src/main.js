// Entry point: wires the UI, sim loop and renderer.
// Phase 1: draws an empty 1-ft reference grid to confirm the page and modules load.

import { ftToM } from './units.js';
import { DEFAULT_CELL_SIZE } from './constants.js';

const canvas = document.getElementById('sim-canvas');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');

const PIXELS_PER_METER = 40; // display scale only, not physics

function drawEmptyGrid() {
  const styles = getComputedStyle(document.documentElement);
  ctx.fillStyle = styles.getPropertyValue('--panel');
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const step = ftToM(1) * PIXELS_PER_METER; // one line per foot
  ctx.strokeStyle = styles.getPropertyValue('--grid');
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= canvas.width; x += step) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, canvas.height);
  }
  for (let y = 0; y <= canvas.height; y += step) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(canvas.width, Math.round(y) + 0.5);
  }
  ctx.stroke();
}

drawEmptyGrid();
status.textContent = `Phase 1 skeleton loaded · grid lines every 1 ft · solver cell size ${DEFAULT_CELL_SIZE} m`;
