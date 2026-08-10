import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './store';

const LOG_FILE = path.join(DATA_DIR, 'admin.log');
const MAX_LINES = 1000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  msg: string;
}

// Ring buffer em memória (fonte de verdade para o tail). Também persiste em
// arquivo (DATA_DIR/admin.log) para sobreviver a restarts.
const buffer: LogEntry[] = [];
let flushedCount = 0;
let flushTimeout: NodeJS.Timeout | null = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function serialize(entry: LogEntry): string {
  return `[${new Date(entry.ts).toISOString()}] [${entry.level.toUpperCase()}] ${entry.msg}`;
}

function trim() {
  if (buffer.length > MAX_LINES) {
    const removed = buffer.length - MAX_LINES;
    buffer.splice(0, removed);
    flushedCount = Math.max(0, flushedCount - removed);
  }
}

function scheduleFlush() {
  if (flushTimeout) return;
  flushTimeout = setTimeout(() => {
    flushTimeout = null;
    try {
      ensureDir();
      const pending = buffer.slice(flushedCount);
      if (pending.length === 0) return;

      fs.appendFileSync(LOG_FILE, pending.map(serialize).join('\n') + '\n');
      flushedCount = buffer.length;

      // Rotação simples: se passou do tamanho máximo, mantém só as últimas linhas.
      try {
        const stat = fs.statSync(LOG_FILE);
        if (stat.size > MAX_FILE_BYTES) {
          const content = fs.readFileSync(LOG_FILE, 'utf-8');
          const lines = content.split('\n');
          fs.writeFileSync(LOG_FILE, lines.slice(-2000).join('\n'), 'utf-8');
        }
      } catch {
        /* ignora falha na rotação */
      }
    } catch {
      /* nunca deixa o logging quebrar o app */
    }
  }, 2000);
}

export function log(level: LogLevel, ...args: unknown[]) {
  const msg = args
    .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
    .filter((s) => s !== undefined && s !== '')
    .join(' ');
  buffer.push({ ts: Date.now(), level, msg });
  trim();
  scheduleFlush();
}

function safeStringify(value: unknown): string {
  try {
    if (value instanceof Error) return value.stack || value.message;
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Captura os console.* existentes (console.log/warn/error) para alimentar o
// buffer sem precisar substituir todas as chamadas no código.
const original = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

console.log = (...args: unknown[]) => {
  original.log(...args);
  log('info', ...args);
};
console.info = (...args: unknown[]) => {
  original.info(...args);
  log('info', ...args);
};
console.warn = (...args: unknown[]) => {
  original.warn(...args);
  log('warn', ...args);
};
console.error = (...args: unknown[]) => {
  original.error(...args);
  log('error', ...args);
};

// Lê as últimas linhas do arquivo para mesclar com o buffer (caso o admin
// peça mais linhas do que cabem no ring buffer atual).
function readFileTail(n: number): LogEntry[] {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const tail = lines.slice(-Math.max(n, 0) - 1);
    const parsed: LogEntry[] = [];
    for (const line of tail) {
      const m = line.match(/^\[([^\]]+)\] \[(INFO|WARN|ERROR)\] (.*)$/);
      if (m) {
        parsed.push({ ts: new Date(m[1]).getTime() || 0, level: m[2].toLowerCase() as LogLevel, msg: m[3] });
      } else {
        parsed.push({ ts: 0, level: 'info', msg: line });
      }
    }
    return parsed;
  } catch {
    return [];
  }
}

export function getRecentLogs(n: number): LogEntry[] {
  const nClamped = Math.max(1, Math.min(n, 5000));
  const fileTail = readFileTail(nClamped);
  const merged = [...fileTail, ...buffer];
  merged.sort((a, b) => a.ts - b.ts);
  return merged.slice(-nClamped);
}
