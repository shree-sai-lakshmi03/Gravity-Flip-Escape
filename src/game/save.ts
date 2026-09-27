export interface LevelRecord {
  completed: boolean;
  bestTime: number | null;
  bestDeaths: number | null;
  allCores: boolean;
  noDeath: boolean;
  underTarget: boolean;
}

export interface SaveData {
  levels: Record<number, LevelRecord>;
  settings: { music: boolean; sfx: boolean; shake: boolean };
}

const KEY = "gravity-shift-save-v1";

export const emptyRecord = (): LevelRecord => ({
  completed: false,
  bestTime: null,
  bestDeaths: null,
  allCores: false,
  noDeath: false,
  underTarget: false,
});

export const defaultSave = (): SaveData => ({
  levels: {},
  settings: { music: true, sfx: true, shake: true },
});

export function loadSave(): SaveData {
  if (typeof window === "undefined") return defaultSave();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      levels: parsed.levels ?? {},
      settings: { ...defaultSave().settings, ...(parsed.settings ?? {}) },
    };
  } catch {
    return defaultSave();
  }
}

export function persistSave(data: SaveData) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable */
  }
}

export function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "--:--.--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
