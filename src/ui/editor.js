// Floor-plan editor: draws the layout on a canvas and handles the drawing tools.
// All geometry is in metres (layout.js); feet appear only in snapping and labels.

import * as L from '../layout/layout.js';
import { buildGrid, LCELL } from '../layout/grid.js';
import { FAN_PRESETS, DEFAULT_CELL_SIZE, FAN_ACTUATOR_DEPTH_CELLS } from '../constants.js';
import { ftToM } from '../units.js';

export const TOOLS = Object.freeze(['select', 'room', 'wall', 'window', 'door', 'fan', 'erase']);

const SNAP = ftToM(0.5);          // walls, rooms and fans snap to a 6-inch grid
const HIT_PX = 8;                 // how close (in screen pixels) a click must be to hit something
const PAD_PX = 16;                // margin around the plan inside the canvas
const MAX_UNDO = 200;
const FAN_DEPTH = FAN_ACTUATOR_DEPTH_CELLS * DEFAULT_CELL_SIZE; // drawn depth of a fan = its actuator

const snap = (v, step = SNAP) => Math.round(v / step) * step;

/**
 * @param canvas  <canvas> element
 * @param opts.layout     initial layout
 * @param opts.onChange   (layout, grid) after every change (for autosave and the status line)
 * @param opts.onSelect   (selection) when the selection changes
 * @param opts.onMessage  (text) short hints, e.g. "click on a wall"
 */
export function createEditor(canvas, { layout, onChange, onSelect, onMessage }) {
  const ctx = canvas.getContext('2d');
  const st = {
    layout,
    grid: buildGrid(layout),
    tool: 'room',
    selection: null,      // { type: 'wall', index } | { type: 'opening'|'fan', id } | null
    hover: null,
    drag: null,           // { kind: 'wall'|'room'|'move', start, end, id, before, offset }
    pointer: null,        // last pointer position (world, m) for the snap marker
    undo: [], redo: [],
    pendingBefore: null,  // layout before a run of live edits (slider drags)
    view: { scale: 1, ox: 0, oy: 0 },
    colors: {},
    tint: document.createElement('canvas'),
    overlay: null,        // (ctx, view, colors, width, height) → drawn on top of the plan (arrows, labels)
    underlay: null,       // (ctx, view, colors, width, height, dpr) → drawn over the indoor tint, under walls
    dpr: 1,
  };

  // ---------------------------------------------------------------------------
  // Layout changes
  // ---------------------------------------------------------------------------

  function setLayoutInternal(next) {
    st.layout = next;
    st.grid = buildGrid(next);
    renderTint();
    // Drop a selection that no longer exists.
    const sel = st.selection;
    if (sel && ((sel.type === 'wall' && !next.walls[sel.index]) || (sel.type !== 'wall' && !L.findItem(next, sel.id)))) {
      select(null);
    }
    onChange?.(st.layout, st.grid);
    draw();
  }

  /** Applies a change and records it for undo. */
  function commit(next, before = st.pendingBefore ?? st.layout) {
    st.pendingBefore = null;
    if (next === before) { if (next !== st.layout) setLayoutInternal(next); return; }
    st.undo.push(before);
    if (st.undo.length > MAX_UNDO) st.undo.shift();
    st.redo = [];
    setLayoutInternal(next);
  }

  /** Applies a change without an undo entry yet (the next commit records one entry for the whole run). */
  function preview(next) {
    if (st.pendingBefore === null) st.pendingBefore = st.layout;
    setLayoutInternal(next);
  }

  function select(selection) {
    st.selection = selection;
    onSelect?.(selection);
    draw();
  }

  // ---------------------------------------------------------------------------
  // View and hit testing
  // ---------------------------------------------------------------------------

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    st.dpr = dpr;
    const cw = canvas.clientWidth;
    const ch = Math.round(cw * (st.layout.height / st.layout.width));
    canvas.style.height = `${ch}px`;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = Math.min((cw - 2 * PAD_PX) / st.layout.width, (ch - 2 * PAD_PX) / st.layout.height);
    st.view = { scale, ox: (cw - st.layout.width * scale) / 2, oy: (ch - st.layout.height * scale) / 2 };
    readColors();
    draw();
  }

  const toScreen = (x, y) => [st.view.ox + x * st.view.scale, st.view.oy + y * st.view.scale];
  function toWorld(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left - st.view.ox) / st.view.scale, y: (ev.clientY - r.top - st.view.oy) / st.view.scale };
  }
  const clampToPlan = (p) => ({
    x: Math.min(Math.max(p.x, 0), st.layout.width), y: Math.min(Math.max(p.y, 0), st.layout.height),
  });

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function openingEnds(o) {
    return o.axis === 'h'
      ? [o.x - o.width / 2, o.y, o.x + o.width / 2, o.y]
      : [o.x, o.y - o.width / 2, o.x, o.y + o.width / 2];
  }

  /** What's under world point p: fans first, then openings, then walls. */
  function hitTest(p) {
    const tol = HIT_PX / st.view.scale;
    for (let k = st.layout.fans.length - 1; k >= 0; k--) {
      const f = st.layout.fans[k];
      const a = (f.angle * Math.PI) / 180, dx = p.x - f.x, dy = p.y - f.y;
      const along = dx * Math.cos(a) + dy * Math.sin(a), across = -dx * Math.sin(a) + dy * Math.cos(a);
      const w = FAN_PRESETS[f.preset].faceWidth;
      if (Math.abs(along) <= FAN_DEPTH / 2 + tol && Math.abs(across) <= w / 2 + tol) return { type: 'fan', id: f.id };
    }
    for (let k = st.layout.openings.length - 1; k >= 0; k--) {
      const o = st.layout.openings[k];
      if (distToSegment(p.x, p.y, ...openingEnds(o)) <= tol + DEFAULT_CELL_SIZE / 2) return { type: 'opening', id: o.id };
    }
    let best = null, bestD = tol + DEFAULT_CELL_SIZE / 2;
    st.layout.walls.forEach((w, index) => {
      const d = distToSegment(p.x, p.y, w.x0, w.y0, w.x1, w.y1);
      if (d <= bestD) { bestD = d; best = { type: 'wall', index }; }
    });
    return best;
  }

  const sameHit = (a, b) => (a && b && a.type === b.type && (a.type === 'wall' ? a.index === b.index : a.id === b.id));

  // ---------------------------------------------------------------------------
  // Pointer and keyboard
  // ---------------------------------------------------------------------------

  function onPointerDown(ev) {
    if (ev.button !== 0) return;
    canvas.setPointerCapture(ev.pointerId);
    const p = toWorld(ev), sp = clampToPlan({ x: snap(p.x), y: snap(p.y) });
    const tool = st.tool;

    if (tool === 'room' || tool === 'wall') {
      st.drag = { kind: tool, start: sp, end: sp };
    } else if (tool === 'window' || tool === 'door') {
      const r = L.placeOpening(st.layout, tool, p.x, p.y, Math.max(0.3, (2 * HIT_PX) / st.view.scale));
      if (!r) { onMessage?.(`Click on a wall to place a ${tool}.`); return; }
      commit(r.layout);
      select({ type: 'opening', id: r.id });
    } else if (tool === 'fan') {
      const fp = clampToPlan({ x: snap(p.x, SNAP / 2), y: snap(p.y, SNAP / 2) });
      const r = L.addFan(st.layout, 'box20', fp.x, fp.y, 0, 'high');
      commit(r.layout);
      select({ type: 'fan', id: r.id });
    } else if (tool === 'erase') {
      const hit = hitTest(p);
      if (!hit) return;
      commit(hit.type === 'wall' ? L.removeWall(st.layout, hit.index) : L.removeItem(st.layout, hit.id));
      st.hover = null;
    } else if (tool === 'select') {
      const hit = hitTest(p);
      select(hit);
      if (hit && hit.type !== 'wall') {
        const item = L.findItem(st.layout, hit.id);
        st.drag = { kind: 'move', id: hit.id, before: st.layout, offset: { x: p.x - item.x, y: p.y - item.y } };
      }
    }
    draw();
  }

  function onPointerMove(ev) {
    const p = toWorld(ev);
    st.pointer = p;
    const d = st.drag;
    if (d && (d.kind === 'room' || d.kind === 'wall')) {
      let e = clampToPlan({ x: snap(p.x), y: snap(p.y) });
      if (d.kind === 'wall') {
        if (Math.abs(e.x - d.start.x) >= Math.abs(e.y - d.start.y)) e = { x: e.x, y: d.start.y };
        else e = { x: d.start.x, y: e.y };
      }
      d.end = e;
    } else if (d && d.kind === 'move') {
      const item = L.findItem(st.layout, d.id);
      const q = { x: p.x - d.offset.x, y: p.y - d.offset.y };
      let next;
      if (st.layout.fans.includes(item)) {
        const fp = clampToPlan({ x: snap(q.x, SNAP / 2), y: snap(q.y, SNAP / 2) });
        next = L.updateItem(st.layout, d.id, fp);
      } else {
        next = L.moveOpening(st.layout, d.id, q.x, q.y, Math.max(0.3, (2 * HIT_PX) / st.view.scale));
      }
      if (next !== st.layout) setLayoutInternal(next);
    } else if (st.tool === 'select' || st.tool === 'erase') {
      const hit = hitTest(p);
      if (!sameHit(hit, st.hover)) st.hover = hit;
    }
    draw();
  }

  function onPointerUp() {
    const d = st.drag;
    st.drag = null;
    if (!d) return;
    if (d.kind === 'room') commit(L.addRoom(st.layout, d.start.x, d.start.y, d.end.x, d.end.y));
    else if (d.kind === 'wall') commit(L.addWall(st.layout, d.start.x, d.start.y, d.end.x, d.end.y));
    else if (d.kind === 'move' && st.layout !== d.before) commit(st.layout, d.before);
    draw();
  }

  function onKeyDown(ev) {
    const tag = ev.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const mod = ev.metaKey || ev.ctrlKey;
    if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
    if (mod && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
    if (mod || ev.altKey) return;
    const keys = { s: 'select', b: 'room', w: 'wall', n: 'window', d: 'door', f: 'fan', e: 'erase' };
    const k = ev.key.toLowerCase();
    if (keys[k]) { setTool(keys[k]); return; }
    if (k === 'r' && st.selection?.type === 'fan') { rotateSelected(ev.shiftKey ? -15 : 15); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSelected(); return; }
    if (ev.key === 'Escape') { st.drag = null; select(null); }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', () => { st.drag = null; draw(); });
  canvas.addEventListener('pointerleave', () => { st.pointer = null; st.hover = null; draw(); });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', resize);
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { readColors(); renderTint(); draw(); });

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    for (const name of ['panel', 'grid', 'grid-major', 'wall', 'window', 'door', 'closed', 'fan', 'fan-off', 'accent', 'warn', 'error',
      'zone-a', 'zone-b', 'zone-c', 'zone-d', 'inlet', 'outlet', 'exchange', 'arrow', 'wind', 'text', 'muted',
      't-cold', 't-mid', 't-hot', 'ov-speed', 'ov-age', 'ov-stagnant']) {
      st.colors[name] = cs.getPropertyValue(`--${name}`).trim() || '#888';
    }
  }

  // Indoor air shaded by zone, drawn once per layout change into an offscreen canvas (one pixel per cell).
  function renderTint() {
    const g = st.grid;
    if (!g.ok) { st.tint.width = 0; return; }
    st.tint.width = g.nx; st.tint.height = g.ny;
    const tctx = st.tint.getContext('2d');
    const img = tctx.createImageData(g.nx, g.ny);
    const palette = ['zone-a', 'zone-b', 'zone-c', 'zone-d'].map((n) => hexToRgb(st.colors[n]));
    for (let c = 0; c < g.cells.length; c++) {
      if (g.cells[c] !== LCELL.FLUID) continue;
      const [r, gr, b] = palette[g.zone[c] % palette.length];
      img.data[4 * c] = r; img.data[4 * c + 1] = gr; img.data[4 * c + 2] = b; img.data[4 * c + 3] = 255;
    }
    tctx.putImageData(img, 0, 0);
  }

  function draw() {
    const { scale } = st.view, c = st.colors;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = c.panel;
    ctx.fillRect(0, 0, cw, ch);

    // Grid: 1 ft minor lines (when they're far enough apart), 5 ft major lines.
    const ft = ftToM(1);
    const [px0, py0] = toScreen(0, 0), [px1, py1] = toScreen(st.layout.width, st.layout.height);
    ctx.lineWidth = 1;
    for (const [step, color, minPx] of [[ft, c.grid, 6], [5 * ft, c['grid-major'], 0]]) {
      if (step * scale < minPx) continue;
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let x = 0; x <= st.layout.width + 1e-9; x += step) { const sx = Math.round(toScreen(x, 0)[0]) + 0.5; ctx.moveTo(sx, py0); ctx.lineTo(sx, py1); }
      for (let y = 0; y <= st.layout.height + 1e-9; y += step) { const sy = Math.round(toScreen(0, y)[1]) + 0.5; ctx.moveTo(px0, sy); ctx.lineTo(px1, sy); }
      ctx.stroke();
    }

    // Indoor air
    const g = st.grid;
    if (g.ok && st.tint.width) {
      const [tx, ty] = toScreen(g.x0, g.y0);
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.55;
      ctx.drawImage(st.tint, tx, ty, g.nx * g.h * scale, g.ny * g.h * scale);
      ctx.globalAlpha = 1;
    }

    // Simulation fields and particle trails
    if (st.underlay) st.underlay(ctx, { toScreen, scale }, { ...c, halo: c.panel }, cw, ch, st.dpr);

    // Walls
    const wallPx = Math.max(3, DEFAULT_CELL_SIZE * scale);
    ctx.lineCap = 'square';
    st.layout.walls.forEach((w, index) => {
      const hl = isSelected({ type: 'wall', index }) || isHovered({ type: 'wall', index });
      ctx.strokeStyle = hl ? c.accent : c.wall;
      ctx.lineWidth = hl ? wallPx + 2 : wallPx;
      ctx.beginPath(); ctx.moveTo(...toScreen(w.x0, w.y0)); ctx.lineTo(...toScreen(w.x1, w.y1)); ctx.stroke();
    });

    // Openings
    const opInfo = new Map(g.ok ? g.openings.map((o) => [o.id, o]) : []);
    for (const o of st.layout.openings) drawOpening(o, opInfo.get(o.id), wallPx);

    // Fans
    for (const f of st.layout.fans) drawFan(f);

    // Simulation (arrows, flows, compass)
    if (st.overlay) st.overlay(ctx, { toScreen, scale }, { ...c, halo: c.panel }, cw, ch);

    // Drag previews
    const d = st.drag;
    if (d && (d.kind === 'room' || d.kind === 'wall')) {
      ctx.strokeStyle = c.accent; ctx.lineWidth = wallPx; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      if (d.kind === 'wall') { ctx.moveTo(...toScreen(d.start.x, d.start.y)); ctx.lineTo(...toScreen(d.end.x, d.end.y)); }
      else {
        const [ax, ay] = toScreen(d.start.x, d.start.y), [bx, by] = toScreen(d.end.x, d.end.y);
        ctx.rect(ax, ay, bx - ax, by - ay);
      }
      ctx.stroke(); ctx.setLineDash([]);
      drawLengthLabel(d);
    }

    // Snap marker for drawing tools
    if (st.pointer && (st.tool === 'room' || st.tool === 'wall') && !d) {
      const sp = clampToPlan({ x: snap(st.pointer.x), y: snap(st.pointer.y) });
      const [sx, sy] = toScreen(sp.x, sp.y);
      ctx.strokeStyle = c.accent; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx - 6, sy); ctx.lineTo(sx + 6, sy); ctx.moveTo(sx, sy - 6); ctx.lineTo(sx, sy + 6); ctx.stroke();
    }
  }

  function drawOpening(o, info, wallPx) {
    const c = st.colors;
    const [ax, ay, bx, by] = openingEnds(o);
    const [sax, say] = toScreen(ax, ay), [sbx, sby] = toScreen(bx, by);
    const hl = isSelected({ type: 'opening', id: o.id }) || isHovered({ type: 'opening', id: o.id });
    const isOpen = o.open && o.openFraction > 0;

    // Gap in the wall, then the opening's symbol.
    ctx.lineCap = 'butt';
    ctx.strokeStyle = c.panel; ctx.lineWidth = wallPx + 1;
    ctx.beginPath(); ctx.moveTo(sax, say); ctx.lineTo(sbx, sby); ctx.stroke();
    if (hl) {
      ctx.strokeStyle = c.accent; ctx.lineWidth = wallPx + 6; ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(sax, say); ctx.lineTo(sbx, sby); ctx.stroke(); ctx.globalAlpha = 1;
    }
    const color = !isOpen ? c.closed : o.type === 'door' ? c.door : c.window;
    ctx.strokeStyle = color;
    if (o.type === 'window') {
      // Two thin parallel lines (the glazing), filled in when closed.
      const off = wallPx / 2 - 1, nxp = o.axis === 'h' ? 0 : off, nyp = o.axis === 'h' ? off : 0;
      ctx.lineWidth = isOpen ? 1.5 : wallPx;
      ctx.beginPath();
      if (isOpen) {
        ctx.moveTo(sax - nxp, say - nyp); ctx.lineTo(sbx - nxp, sby - nyp);
        ctx.moveTo(sax + nxp, say + nyp); ctx.lineTo(sbx + nxp, sby + nyp);
      } else { ctx.moveTo(sax, say); ctx.lineTo(sbx, sby); }
      ctx.stroke();
    } else {
      // Door: the leaf swung open by its open fraction (90° = fully open), hinged at one end.
      const len = Math.hypot(sbx - sax, sby - say);
      // Swing toward the indoor side (screen angles grow clockwise because y points down).
      const inward = info?.kind === 'exterior' ? { up: 1, down: -1, left: -1, right: 1 }[info.normal] : 1;
      const base = o.axis === 'h' ? 0 : Math.PI / 2;
      const swing = (isOpen ? o.openFraction : 0) * (Math.PI / 2) * inward;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sax, say); ctx.lineTo(sax + len * Math.cos(base + swing), say + len * Math.sin(base + swing)); ctx.stroke();
      if (isOpen) {
        ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(sax, say, len, Math.min(base, base + swing), Math.max(base, base + swing)); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // Window fan: arrow across the opening showing in/out.
    if (o.fan && o.fan.speed !== 'off' && info?.kind === 'exterior') {
      const out = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[info.normal];
      const dir = o.fan.direction === 'out' ? out : [-out[0], -out[1]];
      drawArrow((sax + sbx) / 2 - dir[0] * 10, (say + sby) / 2 - dir[1] * 10, dir[0], dir[1], 20, c.fan);
    }
    // Problems: not on a room wall (red), or doesn't cross the 1.1 m slice (orange "!", SCIENCE.md §6.4).
    const mx = (sax + sbx) / 2, my = (say + sby) / 2;
    if (info?.kind === 'invalid') {
      ctx.strokeStyle = c.error; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(sax, sbx) - 5, Math.min(say, sby) - 5, Math.abs(sbx - sax) + 10, Math.abs(sby - say) + 10);
      ctx.setLineDash([]);
    } else if (info && !info.crossesSlice) {
      ctx.fillStyle = c.warn; ctx.beginPath(); ctx.arc(mx + 10, my - 10, 7, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('!', mx + 10, my - 10);
    }
  }

  function drawFan(f) {
    const c = st.colors;
    const preset = FAN_PRESETS[f.preset];
    const a = (f.angle * Math.PI) / 180, s = st.view.scale;
    const [cx, cy] = toScreen(f.x, f.y);
    const w = preset.faceWidth * s, dpx = Math.max(FAN_DEPTH * s, 6);
    const hl = isSelected({ type: 'fan', id: f.id }) || isHovered({ type: 'fan', id: f.id });
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(a);
    ctx.fillStyle = f.speed === 'off' ? c['fan-off'] : c.fan;
    ctx.fillRect(-dpx / 2, -w / 2, dpx, w);
    if (hl) { ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.strokeRect(-dpx / 2 - 3, -w / 2 - 3, dpx + 6, w + 6); }
    ctx.restore();
    if (f.speed !== 'off') {
      const len = { low: 18, medium: 26, high: 34 }[f.speed];
      drawArrow(cx + Math.cos(a) * (dpx / 2 + 2), cy + Math.sin(a) * (dpx / 2 + 2), Math.cos(a), Math.sin(a), len, c.fan);
    }
  }

  function drawArrow(x, y, dx, dy, len, color) {
    const ex = x + dx * len, ey = y + dy * len, hd = 6;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex + dx * hd, ey + dy * hd);
    ctx.lineTo(ex - dy * hd * 0.7, ey + dx * hd * 0.7);
    ctx.lineTo(ex + dy * hd * 0.7, ey - dx * hd * 0.7);
    ctx.closePath(); ctx.fill();
  }

  function drawLengthLabel(d) {
    const ftLen = (m) => (m / ftToM(1)).toFixed(1);
    const dx = Math.abs(d.end.x - d.start.x), dy = Math.abs(d.end.y - d.start.y);
    const text = d.kind === 'room' ? `${ftLen(dx)} × ${ftLen(dy)} ft` : `${ftLen(Math.max(dx, dy))} ft`;
    const [sx, sy] = toScreen(d.end.x, d.end.y);
    ctx.font = '12px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = st.colors.accent;
    ctx.fillText(text, sx + 8, sy - 6);
  }

  const isSelected = (h) => sameHit(h, st.selection);
  const isHovered = (h) => sameHit(h, st.hover);

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function setTool(tool) {
    st.tool = tool;
    st.drag = null;
    st.hover = null;
    canvas.dataset.tool = tool;
    onMessage?.(null);
    draw();
    return tool;
  }

  function undo() {
    if (!st.undo.length) return;
    st.redo.push(st.layout);
    st.pendingBefore = null;
    setLayoutInternal(st.undo.pop());
    onSelect?.(st.selection);
  }

  function redo() {
    if (!st.redo.length) return;
    st.undo.push(st.layout);
    setLayoutInternal(st.redo.pop());
    onSelect?.(st.selection);
  }

  /** Edits the selected opening or fan. live = true for slider drags (one undo entry per run). */
  function updateSelected(patch, live = false) {
    const sel = st.selection;
    if (!sel || sel.type === 'wall') return;
    const next = L.updateItem(st.layout, sel.id, patch);
    if (live) preview(next); else commit(next);
  }

  function rotateSelected(deg) {
    const sel = st.selection;
    if (sel?.type !== 'fan') return;
    const f = L.findItem(st.layout, sel.id);
    updateSelected({ angle: (((f.angle + deg) % 360) + 360) % 360 });
    onSelect?.(st.selection);
  }

  function deleteSelected() {
    const sel = st.selection;
    if (!sel) return;
    commit(sel.type === 'wall' ? L.removeWall(st.layout, sel.index) : L.removeItem(st.layout, sel.id));
    select(null);
  }

  /** Replaces the whole layout (Open file, New). Recorded for undo. */
  function replaceLayout(next) {
    select(null);
    commit(next);
    resize();
  }

  readColors();
  renderTint();
  canvas.dataset.tool = st.tool;
  resize();

  function setOverlay(fn) { st.overlay = fn; draw(); }
  function setUnderlay(fn) { st.underlay = fn; draw(); }
  const getColors = () => ({ ...st.colors, halo: st.colors.panel });

  return {
    setTool, undo, redo, updateSelected, rotateSelected, deleteSelected, replaceLayout, setOverlay, setUnderlay, getColors,
    redraw: draw,
    getLayout: () => st.layout,
    getGrid: () => st.grid,
    getSelection: () => st.selection,
    canUndo: () => st.undo.length > 0,
    canRedo: () => st.redo.length > 0,
  };
}

function hexToRgb(color) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [200, 220, 240];
}
