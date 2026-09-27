// Main-thread side of the simulation engine. Runs the simulation in a Web Worker when the browser
// allows it, otherwise on the main thread (same runner, a slice of each animation frame).
// Either way the page receives snapshots through onSnapshot(snapshot).

import { createRunner } from './runner.js';

const LOCAL_SLICE_MS = 18;   // main-thread fallback: solver time per frame (leaves room to draw)

export function createEngine({ onSnapshot }) {
  let nextId = 0;
  let worker = null;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => onSnapshot(data);
    worker.onerror = (e) => { console.warn('Simulation worker failed; running on the main thread.', e.message); fallBack(); };
  } catch {
    worker = null;
  }

  // --- main-thread fallback ---
  let local = null, lastCommands = [];
  function fallBack() {
    if (worker) { worker.terminate(); worker = null; }
    local = createRunner();
    for (const m of lastCommands) apply(local, m);   // replay the current state into the local runner
    requestAnimationFrame(localFrame);
  }
  function localFrame() {
    local.tick(LOCAL_SLICE_MS);
    onSnapshot(local.snapshot().snapshot);
    requestAnimationFrame(localFrame);
  }
  if (!worker) fallBack();

  function apply(r, m) {
    if (m.type === 'build') r.build(m.layout, m.conditions, m.id);
    else if (m.type === 'conditions') r.setConditions(m.conditions);
    else if (m.type === 'fans') r.setFans(m.fans);
    else if (m.type === 'play') r.setPlaying(m.playing);
    else if (m.type === 'speed') r.setSpeed(m.speed);
  }

  function send(m) {
    // Remember the latest command of each kind (a build resets fans/conditions) for a fallback replay.
    if (m.type === 'build') lastCommands = lastCommands.filter((c) => c.type === 'play' || c.type === 'speed');
    lastCommands = lastCommands.filter((c) => c.type !== m.type || m.type === 'build');
    lastCommands.push(m);
    if (worker) worker.postMessage(m);
    else if (local) apply(local, m);
  }

  return {
    /** Starts a new simulation; returns its id (snapshots carry it as buildId). */
    build(layout, conditions) { const id = ++nextId; send({ type: 'build', layout, conditions, id }); return id; },
    setConditions(conditions) { send({ type: 'conditions', conditions }); },
    setFans(fans) { send({ type: 'fans', fans }); },
    setPlaying(playing) { send({ type: 'play', playing }); },
    setSpeed(speed) { send({ type: 'speed', speed }); },
    get mode() { return worker ? 'worker' : 'main thread'; },
  };
}
