// Saving and loading layouts: browser autosave (localStorage) and JSON files.
// localStorage can be unavailable (private windows, blocked site data), so every access is wrapped
// in try/catch and the app works without it.

import { parseLayout, serializeLayout } from '../layout/layout.js';

const AUTOSAVE_KEY = 'airflow-sim/layout/v1';

/** The autosaved layout, or null if there isn't a usable one. */
export function loadAutosave() {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    return text ? parseLayout(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

/** Saves the layout in the browser. Returns false if the browser refused. */
export function saveAutosave(layout) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeLayout(layout));
    return true;
  } catch {
    return false;
  }
}

/** Downloads the layout as a .json file. */
export function downloadLayout(layout, filename = 'airflow-layout.json') {
  const blob = new Blob([serializeLayout(layout)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Reads a layout from a File chosen by the user. Rejects with a plain-English message. */
export async function readLayoutFile(file) {
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch {
    throw new Error("This file isn't a layout (it isn't valid JSON).");
  }
  return parseLayout(obj);
}
