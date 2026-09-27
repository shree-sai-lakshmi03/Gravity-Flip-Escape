import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GravityGame, type HudState, type LevelResult } from "@/game/engine";
import { LEVELS } from "@/game/levels";
import { AudioManager } from "@/game/audio";
import {
  emptyRecord,
  formatTime,
  loadSave,
  persistSave,
  defaultSave,
  type SaveData,
} from "@/game/save";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gravity Shift — Flip-Gravity Puzzle Platformer" },
      {
        name: "description",
        content:
          "Flip gravity, dodge lasers and collect energy cores across 8 levels of a failing space station. Play Gravity Shift free in your browser.",
      },
      { property: "og:title", content: "Gravity Shift — Flip-Gravity Puzzle Platformer" },
      {
        property: "og:description",
        content:
          "A pixel-art puzzle platformer: invert gravity, solve switch and laser puzzles, and beat your best time.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GravityShift,
});

type Screen = "menu" | "levels" | "settings" | "playing";

const VIEW_W = 800;
const VIEW_H = 480;

function GravityShift() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<GravityGame | null>(null);
  const audioRef = useRef<AudioManager | null>(null);

  const [screen, setScreen] = useState<Screen>("menu");
  const [levelId, setLevelId] = useState(0);
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<LevelResult | null>(null);
  const [save, setSave] = useState<SaveData>(defaultSave);
  const [hud, setHud] = useState<HudState>({
    time: 0,
    cores: 0,
    totalCores: 0,
    deaths: 0,
    gravity: 1,
  });

  useEffect(() => {
    setSave(loadSave());
  }, []);

  useEffect(() => {
    const a = new AudioManager();
    audioRef.current = a;
    return () => a.destroy();
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.setSfx(save.settings.sfx);
    a.musicOn = save.settings.music;
    if (save.settings.music && screen === "playing" && !paused) a.startMusic();
    else a.stopMusic();
    if (gameRef.current) gameRef.current.shakeEnabled = save.settings.shake;
  }, [save.settings, screen, paused]);

  const recordFor = useCallback(
    (id: number) => save.levels[id] ?? emptyRecord(),
    [save.levels],
  );

  const handleComplete = useCallback((r: LevelResult) => {
    setResult(r);
    setSave((prev) => {
      const rec = prev.levels[r.levelId] ?? emptyRecord();
      const level = LEVELS[r.levelId];
      const next: SaveData = {
        ...prev,
        levels: {
          ...prev.levels,
          [r.levelId]: {
            completed: true,
            bestTime: rec.bestTime === null ? r.time : Math.min(rec.bestTime, r.time),
            bestDeaths: rec.bestDeaths === null ? r.deaths : Math.min(rec.bestDeaths, r.deaths),
            allCores: true,
            noDeath: rec.noDeath || r.deaths === 0,
            underTarget: rec.underTarget || r.time <= level.targetTime,
          },
        },
      };
      persistSave(next);
      return next;
    });
  }, []);

  const startLevel = useCallback(
    (id: number) => {
      audioRef.current?.unlock();
      setLevelId(id);
      setResult(null);
      setPaused(false);
      setScreen("playing");
    },
    [],
  );

  // create/destroy engine when entering the playing screen
  useEffect(() => {
    if (screen !== "playing" || !canvasRef.current) return;
    const game = new GravityGame(canvasRef.current, {
      onHud: setHud,
      onComplete: handleComplete,
      onSfx: (k) => audioRef.current?.play(k),
    });
    game.shakeEnabled = save.settings.shake;
    gameRef.current = game;
    game.loadLevel(levelId);
    return () => {
      game.destroy();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, levelId, handleComplete]);

  useEffect(() => {
    gameRef.current?.setPaused(paused || result !== null);
  }, [paused, result]);

  useEffect(() => {
    if (screen !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPaused((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  const unlockedUpTo = useMemo(() => {
    let i = 0;
    while (i < LEVELS.length && save.levels[i]?.completed) i++;
    return Math.min(i, LEVELS.length - 1);
  }, [save.levels]);

  const totalStars = useMemo(
    () =>
      Object.values(save.levels).reduce(
        (n, r) => n + (r.allCores ? 1 : 0) + (r.noDeath ? 1 : 0) + (r.underTarget ? 1 : 0),
        0,
      ),
    [save.levels],
  );

  const level = LEVELS[levelId];
  const rec = recordFor(levelId);

  const toggle = (key: "music" | "sfx" | "shake") =>
    setSave((prev) => {
      const next = { ...prev, settings: { ...prev.settings, [key]: !prev.settings[key] } };
      persistSave(next);
      return next;
    });

  return (
    <main className="min-h-screen w-full px-4 py-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-6">
        <header className="text-center">
          <h1 className="font-pixel text-2xl text-primary drop-shadow-[0_0_16px_rgba(94,234,212,0.35)] sm:text-4xl">
            GRAVITY SHIFT
          </h1>
          <p className="mt-3 text-sm tracking-widest text-muted-foreground uppercase">
            Station Kepler-9 is failing. Invert gravity. Escape.
          </p>
        </header>

        {screen === "menu" && (
          <section className="panel scanline relative w-full max-w-xl overflow-hidden p-8 text-center">
            <p className="text-muted-foreground">
              A small maintenance robot can&apos;t jump — but it can flip the station&apos;s
              gravity field. Collect every energy core, dodge the hazards, reach the exit.
            </p>
            <div className="mt-8 flex flex-col gap-3">
              <button className="btn-game btn-game-primary" onClick={() => startLevel(unlockedUpTo)}>
                {save.levels[0]?.completed ? "Continue" : "Start Game"}
              </button>
              <button className="btn-game" onClick={() => setScreen("levels")}>
                Level Select
              </button>
              <button className="btn-game" onClick={() => setScreen("settings")}>
                Settings
              </button>
            </div>
            <dl className="mt-8 grid grid-cols-3 gap-2 text-xs">
              <Stat label="Levels" value={`${Object.values(save.levels).filter((l) => l.completed).length}/${LEVELS.length}`} />
              <Stat label="Stars" value={`${totalStars}/${LEVELS.length * 3}`} />
              <Stat
                label="Deaths"
                value={String(
                  Object.values(save.levels).reduce((n, r) => n + (r.bestDeaths ?? 0), 0),
                )}
              />
            </dl>
          </section>
        )}

        {screen === "levels" && (
          <section className="panel w-full max-w-3xl p-6">
            <h2 className="font-pixel text-sm text-accent">SELECT SECTOR</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {LEVELS.map((l, i) => {
                const r = recordFor(i);
                const locked = i > unlockedUpTo;
                return (
                  <button
                    key={l.id}
                    disabled={locked}
                    onClick={() => startLevel(i)}
                    className="panel flex items-center justify-between gap-3 p-4 text-left transition-colors hover:border-primary disabled:opacity-40"
                  >
                    <span>
                      <span className="font-pixel text-[0.65rem] text-primary">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="ml-3 font-semibold">{l.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {locked ? "Locked" : `Best ${formatTime(r.bestTime)}`}
                      </span>
                    </span>
                    <span className="text-sm tracking-widest">
                      <span className={r.allCores ? "" : "opacity-25"}>⭐</span>
                      <span className={r.underTarget ? "" : "opacity-25"}>⚡</span>
                      <span className={r.noDeath ? "" : "opacity-25"}>💀</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <button className="btn-game mt-6" onClick={() => setScreen("menu")}>
              Back
            </button>
          </section>
        )}

        {screen === "settings" && (
          <section className="panel w-full max-w-xl p-6">
            <h2 className="font-pixel text-sm text-accent">SETTINGS</h2>
            <div className="mt-5 flex flex-col gap-3">
              <Toggle label="Music" on={save.settings.music} onClick={() => toggle("music")} />
              <Toggle label="Sound effects" on={save.settings.sfx} onClick={() => toggle("sfx")} />
              <Toggle label="Screen shake" on={save.settings.shake} onClick={() => toggle("shake")} />
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button className="btn-game" onClick={() => setScreen("menu")}>
                Back
              </button>
              <button
                className="btn-game"
                onClick={() => {
                  const fresh = { ...defaultSave(), settings: save.settings };
                  persistSave(fresh);
                  setSave(fresh);
                }}
              >
                Erase Progress
              </button>
            </div>
          </section>
        )}

        {screen === "playing" && (
          <section className="w-full">
            <div className="panel mx-auto flex max-w-[800px] flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
              <span className="font-pixel text-[0.6rem] text-primary">
                {String(levelId + 1).padStart(2, "0")} {level.name}
              </span>
              <span className="flex gap-4 font-semibold tracking-wider">
                <span>⏳ {formatTime(hud.time)}</span>
                <span className="text-accent">
                  ⭐ {hud.cores}/{hud.totalCores}
                </span>
                <span className="text-destructive">💀 {hud.deaths}</span>
                <span>{hud.gravity === 1 ? "⬇ GRAV" : "⬆ GRAV"}</span>
              </span>
              <span className="text-muted-foreground">Best {formatTime(rec.bestTime)}</span>
            </div>

            <div className="relative mx-auto mt-3 w-full max-w-[800px]">
              <canvas
                ref={canvasRef}
                width={VIEW_W}
                height={VIEW_H}
                className="w-full rounded-md border border-border shadow-[0_0_60px_-15px_rgba(94,234,212,0.45)]"
                style={{ imageRendering: "pixelated", aspectRatio: `${VIEW_W}/${VIEW_H}` }}
              />

              {paused && !result && (
                <Overlay title="PAUSED">
                  <button className="btn-game btn-game-primary" onClick={() => setPaused(false)}>
                    Resume
                  </button>
                  <button
                    className="btn-game"
                    onClick={() => {
                      gameRef.current?.restart();
                      setPaused(false);
                    }}
                  >
                    Restart
                  </button>
                  <button className="btn-game" onClick={() => setScreen("levels")}>
                    Level Select
                  </button>
                  <button className="btn-game" onClick={() => setScreen("menu")}>
                    Main Menu
                  </button>
                </Overlay>
              )}

              {result && (
                <Overlay title="SECTOR CLEAR">
                  <p className="text-sm text-muted-foreground">
                    Time {formatTime(result.time)} · Deaths {result.deaths} · Target{" "}
                    {formatTime(level.targetTime)}
                  </p>
                  <p className="text-lg tracking-[0.4em]">
                    <span>⭐</span>
                    <span className={result.time <= level.targetTime ? "" : "opacity-25"}>⚡</span>
                    <span className={result.deaths === 0 ? "" : "opacity-25"}>💀</span>
                  </p>
                  {levelId + 1 < LEVELS.length ? (
                    <button
                      className="btn-game btn-game-primary"
                      onClick={() => startLevel(levelId + 1)}
                    >
                      Next Sector
                    </button>
                  ) : (
                    <p className="font-pixel text-[0.7rem] text-accent">YOU ESCAPED THE STATION</p>
                  )}
                  <button
                    className="btn-game"
                    onClick={() => {
                      setResult(null);
                      gameRef.current?.restart();
                    }}
                  >
                    Retry
                  </button>
                  <button className="btn-game" onClick={() => setScreen("levels")}>
                    Level Select
                  </button>
                </Overlay>
              )}
            </div>

            <div className="panel mx-auto mt-3 flex max-w-[800px] flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-muted-foreground">
              <span>{level.hint}</span>
              <span>← → move · ↑ flip gravity · R restart · ESC pause</span>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-3">
      <dt className="text-[0.6rem] tracking-widest text-muted-foreground uppercase">{label}</dt>
      <dd className="font-pixel mt-1 text-[0.7rem] text-accent">{value}</dd>
    </div>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="panel flex items-center justify-between p-4 transition-colors hover:border-primary"
    >
      <span>{label}</span>
      <span
        className={`font-pixel text-[0.6rem] ${on ? "text-primary" : "text-muted-foreground"}`}
      >
        {on ? "ON" : "OFF"}
      </span>
    </button>
  );
}

function Overlay({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-md bg-background/85 p-6 backdrop-blur-sm">
      <h3 className="font-pixel text-sm text-primary">{title}</h3>
      {children}
    </div>
  );
}
