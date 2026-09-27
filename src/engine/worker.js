// Web Worker entry: runs the simulation off the main thread so it can use a whole CPU core and the
// page stays smooth. Receives commands from engine/client.js; posts snapshots ~30 times a second.

import { createRunner } from './runner.js';

const SLICE_MS = 30;          // solver time between checks for new messages
const POST_INTERVAL_MS = 33;  // snapshot rate (~30 per second)
const IDLE_MS = 16;           // wait between loops when there's nothing to compute

const runner = createRunner();
let lastPost = 0, dirty = true;

self.onmessage = ({ data: m }) => {
  if (m.type === 'build') runner.build(m.layout, m.conditions, m.id);
  else if (m.type === 'conditions') runner.setConditions(m.conditions);
  else if (m.type === 'fans') runner.setFans(m.fans);
  else if (m.type === 'play') runner.setPlaying(m.playing);
  else if (m.type === 'speed') runner.setSpeed(m.speed);
  dirty = true;
};

function loop() {
  runner.tick(SLICE_MS);
  const now = performance.now();
  if (dirty || now - lastPost >= POST_INTERVAL_MS) {
    const { snapshot, transfer } = runner.snapshot();
    self.postMessage(snapshot, transfer);
    lastPost = now;
    dirty = false;
  }
  setTimeout(loop, runner.hasWork() ? 0 : IDLE_MS);
}
loop();
