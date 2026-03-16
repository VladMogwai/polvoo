'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let settingsPath = null;
let cache = null;

const DEFAULTS = {
  preferredTerminal: null,
  customTerminals: [],
  // customTerminals items: { id, name, appPath, extraPath, openCommand? }
};

function getPath() {
  if (!settingsPath) {
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
  }
  return settingsPath;
}

function load() {
  try {
    if (fs.existsSync(getPath())) {
      cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(getPath(), 'utf8')) };
    } else {
      cache = { ...DEFAULTS };
    }
  } catch {
    cache = { ...DEFAULTS };
  }
  if (!Array.isArray(cache.customTerminals)) cache.customTerminals = [];
  return cache;
}

function get() {
  if (!cache) load();
  return cache;
}

function set(updates) {
  cache = { ...get(), ...updates };
  try {
    fs.writeFileSync(getPath(), JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save settings:', e.message);
  }
  return cache;
}

function addCustomTerminal(terminal) {
  const current = get();
  const existing = (current.customTerminals || []).findIndex((t) => t.id === terminal.id);
  let updated;
  if (existing >= 0) {
    updated = current.customTerminals.map((t) => (t.id === terminal.id ? terminal : t));
  } else {
    updated = [...(current.customTerminals || []), terminal];
  }
  return set({ customTerminals: updated });
}

function removeCustomTerminal(id) {
  const current = get();
  return set({ customTerminals: (current.customTerminals || []).filter((t) => t.id !== id) });
}

module.exports = { get, set, load, addCustomTerminal, removeCustomTerminal };
