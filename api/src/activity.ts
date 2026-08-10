import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './store';

const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');
const MAX_ENTRIES = 2000;

export interface ActivityEntry {
  id: string;
  ts: number;
  type: string;
  actor?: string;
  detail?: string;
  meta?: Record<string, unknown>;
}

let entries: ActivityEntry[] = [];
let loaded = false;
let saveTimeout: NodeJS.Timeout | null = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadActivity() {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(ACTIVITY_FILE)) {
      const data = JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf-8'));
      if (Array.isArray(data)) entries = data.slice(-MAX_ENTRIES);
    }
  } catch (e) {
    console.error('[activity] Falha ao carregar histórico:', e);
  }
}

export function scheduleActivitySave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    try {
      ensureDir();
      fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(entries), 'utf-8');
    } catch (e) {
      console.error('[activity] Falha ao salvar histórico:', e);
    }
  }, 2000);
}

export function recordActivity(
  type: string,
  opts: { actor?: string; detail?: string; meta?: Record<string, unknown> } = {}
) {
  loadActivity();
  entries.push({
    id: Math.random().toString(36).substring(2, 10),
    ts: Date.now(),
    type,
    ...opts,
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  scheduleActivitySave();
}

export function getRecentActivity(limit: number): ActivityEntry[] {
  loadActivity();
  const n = Math.max(1, Math.min(limit, 1000));
  return entries.slice(-n).reverse();
}
