import { LEVELS, TILE, WORLD_H, WORLD_W, type LevelDef } from "./levels";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HudState {
  time: number;
  cores: number;
  totalCores: number;
  deaths: number;
  gravity: 1 | -1;
}

export interface LevelResult {
  levelId: number;
  time: number;
  deaths: number;
  cores: number;
  totalCores: number;
}

interface Box extends Rect {
  vy: number;
}
interface Platform extends Rect {
  kind: "h" | "v" | "timed";
  origin: number;
  range: number;
  speed: number;
  phase: number;
  dx: number;
  dy: number;
  active: boolean;
}
interface Core extends Rect {
  taken: boolean;
  seed: number;
}
interface Emitter {
  x: number;
  y: number;
  dir: [number, number];
  blink: boolean;
  on: boolean;
  beam: Rect | null;
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

const SOLID = new Set(["#", "E"]);
const DEADLY_TILE = new Set(["x", "~", "E"]);
const PLAYER_W = 20;
const PLAYER_H = 26;
const MOVE_SPEED = 200;
const GRAVITY = 1500;
const MAX_FALL = 700;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export interface EngineCallbacks {
  onHud: (hud: HudState) => void;
  onComplete: (result: LevelResult) => void;
  onSfx: (kind: "flip" | "core" | "death" | "win" | "switch") => void;
}

export class GravityGame {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private hudTick = 0;

  private grid: string[][] = [];
  private level: LevelDef = LEVELS[0];
  private player = { x: 0, y: 0, vx: 0, vy: 0, grav: 1 as 1 | -1, onGround: false };
  private spawn = { x: 0, y: 0 };
  private boxes: Box[] = [];
  private boxSpawns: Box[] = [];
  private platforms: Platform[] = [];
  private cores: Core[] = [];
  private switches: Rect[] = [];
  private gates: Rect[] = [];
  private emitters: Emitter[] = [];
  private exit: Rect = { x: 0, y: 0, w: TILE, h: TILE };

  private keys = new Set<string>();
  private particles: Particle[] = [];
  private cam = { x: 0, y: 0 };
  private shake = 0;
  private t = 0;
  private elapsed = 0;
  private deaths = 0;
  private respawnIn = 0;
  private finished = false;
  private gatesOpen = false;
  paused = false;
  shakeEnabled = true;

  readonly viewW: number;
  readonly viewH: number;

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: EngineCallbacks,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
    this.viewW = canvas.width;
    this.viewH = canvas.height;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    if (this.keys.has(k)) return;
    this.keys.add(k);
    if (!this.paused && !this.finished && this.respawnIn <= 0) {
      if (k === "arrowup" || k === "w" || k === " ") this.flip();
      if (k === "r") this.kill();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private flip() {
    this.player.grav = this.player.grav === 1 ? -1 : 1;
    this.player.vy = this.player.grav * 60;
    this.player.onGround = false;
    this.cb.onSfx("flip");
    this.burst(this.player.x + PLAYER_W / 2, this.player.y + PLAYER_H / 2, 14, "var(--flip)");
    this.addShake(4);
  }

  loadLevel(id: number) {
    const level = LEVELS[id] ?? LEVELS[0];
    this.level = level;
    this.grid = level.rows.map((r) => r.split(""));
    this.boxes = [];
    this.boxSpawns = [];
    this.platforms = [];
    this.cores = [];
    this.switches = [];
    this.gates = [];
    this.emitters = [];
    this.particles = [];
    this.elapsed = 0;
    this.deaths = 0;
    this.finished = false;
    this.respawnIn = 0;
    this.paused = false;

    this.grid.forEach((row, ty) => {
      row.forEach((c, tx) => {
        const x = tx * TILE;
        const y = ty * TILE;
        switch (c) {
          case "P":
            this.spawn = { x: x + (TILE - PLAYER_W) / 2, y: y + TILE - PLAYER_H };
            break;
          case "D":
            this.exit = { x: x + 2, y: y + 2, w: TILE - 4, h: TILE - 4 };
            break;
          case "C":
            this.cores.push({ x: x + 8, y: y + 8, w: 16, h: 16, taken: false, seed: tx + ty });
            break;
          case "B":
            this.boxSpawns.push({ x: x + 2, y: y + 2, w: TILE - 4, h: TILE - 4, vy: 0 });
            break;
          case "S":
            this.switches.push({ x: x + 4, y: y + TILE - 8, w: TILE - 8, h: 8 });
            break;
          case "G":
            this.gates.push({ x, y, w: TILE, h: TILE });
            break;
          case "M":
          case "N":
            this.platforms.push({
              x,
              y: y + 8,
              w: TILE * 2,
              h: 12,
              kind: c === "M" ? "h" : "v",
              origin: c === "M" ? x : y + 8,
              range: c === "M" ? TILE * 3 : TILE * 4,
              speed: 1.1,
              phase: (tx + ty) * 0.6,
              dx: 0,
              dy: 0,
              active: true,
            });
            break;
          case "T":
            this.platforms.push({
              x,
              y: y + 10,
              w: TILE,
              h: 10,
              kind: "timed",
              origin: 0,
              range: 0,
              speed: 0,
              phase: (ty % 3) * 0.7,
              dx: 0,
              dy: 0,
              active: true,
            });
            break;
          case "r":
          case "l":
          case "u":
          case "d":
          case "R":
          case "L":
          case "U":
          case "V": {
            const map: Record<string, [number, number]> = {
              r: [1, 0],
              l: [-1, 0],
              u: [0, -1],
              d: [0, 1],
              R: [1, 0],
              L: [-1, 0],
              U: [0, -1],
              V: [0, 1],
            };
            this.emitters.push({
              x,
              y,
              dir: map[c],
              blink: c === c.toUpperCase(),
              on: true,
              beam: null,
            });
            break;
          }
        }
      });
    });

    this.resetPlayer();
    this.cam = { x: 0, y: 0 };
    this.updateCamera(true);
    this.emitHud();
    this.start();
  }

  private resetPlayer() {
    this.player = { x: this.spawn.x, y: this.spawn.y, vx: 0, vy: 0, grav: 1, onGround: false };
    this.boxes = this.boxSpawns.map((b) => ({ ...b }));
  }

  private start() {
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    this.acc = 0;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (!this.paused) {
        this.acc += dt;
        while (this.acc >= 1 / 120) {
          this.step(1 / 120);
          this.acc -= 1 / 120;
        }
      }
      this.render();
    };
    this.raf = requestAnimationFrame(loop);
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (!p) this.last = performance.now();
  }

  restart() {
    this.loadLevel(this.level.id);
  }

  private solidRects(): Rect[] {
    const rects: Rect[] = [];
    for (const p of this.platforms) if (p.active) rects.push(p);
    if (!this.gatesOpen) for (const g of this.gates) rects.push(g);
    return rects;
  }

  private tileAt(x: number, y: number): string {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    return this.grid[ty]?.[tx] ?? "#";
  }

  private tileRectsAround(r: Rect): { rect: Rect; c: string }[] {
    const out: { rect: Rect; c: string }[] = [];
    const x0 = Math.floor((r.x - 2) / TILE);
    const x1 = Math.floor((r.x + r.w + 2) / TILE);
    const y0 = Math.floor((r.y - 2) / TILE);
    const y1 = Math.floor((r.y + r.h + 2) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const c = this.grid[ty]?.[tx] ?? "#";
        out.push({ rect: { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE }, c });
      }
    }
    return out;
  }

  private collidersFor(r: Rect): Rect[] {
    const list = this.tileRectsAround(r)
      .filter((t) => SOLID.has(t.c))
      .map((t) => t.rect);
    return list.concat(this.solidRects());
  }

  private step(dt: number) {
    this.t += dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 26);
    this.updateParticles(dt);

    if (this.finished) return;

    if (this.respawnIn > 0) {
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) this.resetPlayer();
      return;
    }

    this.elapsed += dt;
    this.updatePlatforms(dt);
    this.updateEmitters();

    // switch state
    const pRect = this.playerRect();
    const pressed = this.switches.some(
      (s) => overlaps(pRect, s) || this.boxes.some((b) => overlaps(b, s)),
    );
    if (pressed !== this.gatesOpen) {
      this.gatesOpen = pressed;
      this.cb.onSfx("switch");
    }

    this.updateBoxes(dt);
    this.updatePlayer(dt);
    this.checkPickups();
    this.checkHazards();
    this.updateCamera(false);

    this.hudTick += dt;
    if (this.hudTick > 0.08) {
      this.hudTick = 0;
      this.emitHud();
    }
  }

  private playerRect(): Rect {
    return { x: this.player.x, y: this.player.y, w: PLAYER_W, h: PLAYER_H };
  }

  private updatePlatforms(dt: number) {
    for (const p of this.platforms) {
      p.dx = 0;
      p.dy = 0;
      if (p.kind === "timed") {
        const cycle = (this.t * 0.55 + p.phase) % 2;
        p.active = cycle < 1.2;
        continue;
      }
      const offset = Math.sin(this.t * p.speed + p.phase) * (p.range / 2);
      if (p.kind === "h") {
        const nx = p.origin + p.range / 2 + offset;
        p.dx = nx - p.x;
        p.x = nx;
      } else {
        const ny = p.origin + p.range / 2 + offset;
        p.dy = ny - p.y;
        p.y = ny;
      }
      void dt;
    }
  }

  private updateEmitters() {
    for (const e of this.emitters) {
      e.on = !e.blink || (this.t + e.x * 0.01) % 2.6 < 1.4;
      if (!e.on) {
        e.beam = null;
        continue;
      }
      const [dx, dy] = e.dir;
      let cx = e.x + TILE / 2 + dx * TILE;
      let cy = e.y + TILE / 2 + dy * TILE;
      let len = 0;
      while (len < TILE * 40) {
        const c = this.tileAt(cx, cy);
        if (SOLID.has(c)) break;
        cx += dx * 4;
        cy += dy * 4;
        len += 4;
      }
      const sx = e.x + TILE / 2 + dx * (TILE / 2);
      const sy = e.y + TILE / 2 + dy * (TILE / 2);
      const x = Math.min(sx, cx);
      const y = Math.min(sy, cy);
      const w = Math.max(4, Math.abs(cx - sx));
      const h = Math.max(4, Math.abs(cy - sy));
      e.beam = { x: dx ? x : x - 2, y: dy ? y : y - 2, w, h };
    }
  }

  private moveRectX(r: Rect, dx: number, colliders: Rect[]) {
    r.x += dx;
    for (const c of colliders) {
      if (!overlaps(r, c)) continue;
      if (dx > 0) r.x = c.x - r.w;
      else if (dx < 0) r.x = c.x + c.w;
    }
  }

  private moveRectY(r: Rect, dy: number, colliders: Rect[]): boolean {
    r.y += dy;
    let hit = false;
    for (const c of colliders) {
      if (!overlaps(r, c)) continue;
      hit = true;
      if (dy > 0) r.y = c.y - r.h;
      else if (dy < 0) r.y = c.y + c.h;
    }
    return hit;
  }

  private updateBoxes(dt: number) {
    for (const b of this.boxes) {
      b.vy = Math.min(MAX_FALL, b.vy + GRAVITY * dt);
      const colliders = this.collidersFor(b).concat(this.boxes.filter((o) => o !== b));
      const landed = this.moveRectY(b, b.vy * dt, colliders);
      if (landed) b.vy = 0;
    }
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    const left = this.keys.has("arrowleft") || this.keys.has("a");
    const right = this.keys.has("arrowright") || this.keys.has("d");
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    p.vx = dir * MOVE_SPEED;

    // carried by platforms
    const rect = this.playerRect();
    for (const pl of this.platforms) {
      if (!pl.active) continue;
      const probe = { ...rect, y: rect.y + (p.grav === 1 ? 3 : -3) };
      if (overlaps(probe, pl)) {
        p.x += pl.dx;
        p.y += pl.dy;
      }
    }

    const r = this.playerRect();
    const others = this.collidersFor(r);

    // horizontal with box pushing
    const dx = p.vx * dt;
    if (dx !== 0) {
      for (const b of this.boxes) {
        const probe = { ...r, x: r.x + dx };
        if (overlaps(probe, b)) {
          const boxCol = this.collidersFor(b).concat(this.boxes.filter((o) => o !== b));
          const before = b.x;
          this.moveRectX(b, dx, boxCol);
          if (Math.abs(b.x - before) < Math.abs(dx) - 0.01) {
            // box blocked -> block player
            others.push(b);
          }
        }
      }
    }
    this.moveRectX(r, dx, others.concat(this.boxes));
    p.x = r.x;

    // vertical
    p.vy += GRAVITY * p.grav * dt;
    p.vy = Math.max(-MAX_FALL, Math.min(MAX_FALL, p.vy));
    const vCol = this.collidersFor(r).concat(this.boxes);
    const hit = this.moveRectY(r, p.vy * dt, vCol);
    p.y = r.y;
    if (hit) {
      if ((p.grav === 1 && p.vy > 0) || (p.grav === -1 && p.vy < 0)) p.onGround = true;
      p.vy = 0;
    } else {
      p.onGround = false;
    }

    if (p.x < 0 || p.x > WORLD_W || p.y < -80 || p.y > WORLD_H + 80) this.kill();
  }

  private checkPickups() {
    const r = this.playerRect();
    for (const c of this.cores) {
      if (c.taken || !overlaps(r, c)) continue;
      c.taken = true;
      this.cb.onSfx("core");
      this.burst(c.x + 8, c.y + 8, 16, "var(--core)");
      this.emitHud();
    }
    const remaining = this.cores.filter((c) => !c.taken).length;
    if (remaining === 0 && overlaps(r, this.exit) && !this.finished) {
      this.finished = true;
      this.cb.onSfx("win");
      this.addShake(6);
      this.burst(this.exit.x + TILE / 2, this.exit.y + TILE / 2, 40, "var(--exit)");
      this.cb.onComplete({
        levelId: this.level.id,
        time: this.elapsed,
        deaths: this.deaths,
        cores: this.cores.length,
        totalCores: this.cores.length,
      });
    }
  }

  private checkHazards() {
    const r = this.playerRect();
    const inner = { x: r.x + 3, y: r.y + 3, w: r.w - 6, h: r.h - 6 };
    for (const t of this.tileRectsAround(inner)) {
      if (DEADLY_TILE.has(t.c) && overlaps(inner, t.rect)) return this.kill();
    }
    for (const e of this.emitters) {
      if (e.on && e.beam && overlaps(inner, e.beam)) return this.kill();
    }
  }

  private kill() {
    if (this.respawnIn > 0 || this.finished) return;
    this.deaths++;
    this.respawnIn = 0.55;
    this.cb.onSfx("death");
    this.addShake(12);
    this.burst(this.player.x + PLAYER_W / 2, this.player.y + PLAYER_H / 2, 30, "var(--danger)");
    this.emitHud();
  }

  private addShake(n: number) {
    if (this.shakeEnabled) this.shake = Math.min(16, this.shake + n);
  }

  private burst(x: number, y: number, count: number, color: string) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 180;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.4,
        max: 0.9,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  private updateParticles(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 260 * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private updateCamera(snap: boolean) {
    const tx = Math.max(
      0,
      Math.min(WORLD_W - this.viewW, this.player.x + PLAYER_W / 2 - this.viewW / 2),
    );
    const ty = Math.max(
      0,
      Math.min(WORLD_H - this.viewH, this.player.y + PLAYER_H / 2 - this.viewH / 2),
    );
    if (snap) {
      this.cam = { x: tx, y: ty };
    } else {
      this.cam.x += (tx - this.cam.x) * 0.09;
      this.cam.y += (ty - this.cam.y) * 0.09;
    }
  }

  private emitHud() {
    this.cb.onHud({
      time: this.elapsed,
      cores: this.cores.filter((c) => c.taken).length,
      totalCores: this.cores.length,
      deaths: this.deaths,
      gravity: this.player.grav,
    });
  }

  /* ---------------- rendering ---------------- */

  private css(name: string) {
    const v = getComputedStyle(this.canvas).getPropertyValue(name).trim();
    return v || "#7dd3fc";
  }

  private render() {
    const ctx = this.ctx;
    const c = {
      wall: this.css("--g-wall"),
      wallTop: this.css("--g-wall-top"),
      bg: this.css("--g-bg"),
      grid: this.css("--g-grid"),
      player: this.css("--g-player"),
      core: this.css("--g-core"),
      danger: this.css("--g-danger"),
      exit: this.css("--g-exit"),
      plat: this.css("--g-plat"),
      box: this.css("--g-box"),
      beam: this.css("--g-beam"),
    };
    ctx.save();
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    ctx.translate(-Math.round(this.cam.x) + sx, -Math.round(this.cam.y) + sy);

    // parallax grid
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= WORLD_W; x += TILE * 2) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD_H);
    }
    for (let y = 0; y <= WORLD_H; y += TILE * 2) {
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD_W, y);
    }
    ctx.stroke();

    // tiles
    this.grid.forEach((row, ty) => {
      row.forEach((ch, tx) => {
        const x = tx * TILE;
        const y = ty * TILE;
        if (ch === "#") {
          ctx.fillStyle = c.wall;
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = c.wallTop;
          ctx.fillRect(x, y, TILE, 3);
          ctx.fillRect(x, y, 3, TILE);
        } else if (ch === "E") {
          const f = 0.6 + Math.sin(this.t * 8 + tx) * 0.4;
          ctx.fillStyle = c.beam;
          ctx.globalAlpha = f;
          ctx.fillRect(x, y, TILE, TILE);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = c.beam;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        } else if (ch === "x") {
          ctx.fillStyle = c.danger;
          for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(x + i * 8, y + TILE);
            ctx.lineTo(x + i * 8 + 4, y + TILE - 14);
            ctx.lineTo(x + i * 8 + 8, y + TILE);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(x + i * 8, y);
            ctx.lineTo(x + i * 8 + 4, y + 14);
            ctx.lineTo(x + i * 8 + 8, y);
            ctx.closePath();
            ctx.fill();
          }
        } else if (ch === "~") {
          const g = ctx.createLinearGradient(x, y, x, y + TILE);
          g.addColorStop(0, "rgba(120,60,220,0.55)");
          g.addColorStop(1, "rgba(10,4,25,0)");
          ctx.fillStyle = g;
          ctx.fillRect(x, y, TILE, TILE);
        } else if (ch === "S") {
          ctx.fillStyle = this.gatesOpen ? c.core : c.plat;
          ctx.fillRect(x + 4, y + TILE - 8, TILE - 8, 6);
        } else if ("rludRLUV".includes(ch)) {
          ctx.fillStyle = c.wall;
          ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
          ctx.fillStyle = c.danger;
          ctx.fillRect(x + 10, y + 10, TILE - 20, TILE - 20);
        }
      });
    });

    // gates
    if (!this.gatesOpen) {
      ctx.fillStyle = c.plat;
      for (const g of this.gates) {
        ctx.fillRect(g.x + 2, g.y, g.w - 4, g.h);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(g.x + 2, g.y + 14, g.w - 4, 4);
        ctx.fillStyle = c.plat;
      }
    }

    // platforms
    for (const p of this.platforms) {
      if (!p.active) {
        ctx.globalAlpha = 0.18;
      }
      ctx.fillStyle = c.plat;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = c.wallTop;
      ctx.fillRect(p.x, p.y, p.w, 2);
      ctx.globalAlpha = 1;
    }

    // boxes
    for (const b of this.boxes) {
      ctx.fillStyle = c.box;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.strokeRect(b.x + 4.5, b.y + 4.5, b.w - 9, b.h - 9);
    }

    // laser beams
    ctx.shadowBlur = 12;
    ctx.shadowColor = c.danger;
    for (const e of this.emitters) {
      if (!e.on || !e.beam) continue;
      ctx.fillStyle = c.danger;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(e.beam.x, e.beam.y, e.beam.w, e.beam.h);
      ctx.globalAlpha = 1;
    }
    ctx.shadowBlur = 0;

    // exit
    const remaining = this.cores.filter((x) => !x.taken).length;
    ctx.fillStyle = remaining === 0 ? c.exit : "rgba(120,130,160,0.5)";
    ctx.shadowBlur = remaining === 0 ? 18 : 0;
    ctx.shadowColor = c.exit;
    ctx.fillRect(this.exit.x, this.exit.y, this.exit.w, this.exit.h);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(this.exit.x + 6, this.exit.y + 8, this.exit.w - 12, this.exit.h - 8);

    // cores
    ctx.shadowBlur = 14;
    ctx.shadowColor = c.core;
    for (const core of this.cores) {
      if (core.taken) continue;
      const bob = Math.sin(this.t * 3 + core.seed) * 3;
      ctx.fillStyle = c.core;
      ctx.save();
      ctx.translate(core.x + 8, core.y + 8 + bob);
      ctx.rotate(this.t * 1.6);
      ctx.fillRect(-6, -6, 12, 12);
      ctx.restore();
    }
    ctx.shadowBlur = 0;

    // player
    if (this.respawnIn <= 0) {
      const p = this.player;
      ctx.shadowBlur = 16;
      ctx.shadowColor = c.player;
      ctx.fillStyle = c.player;
      ctx.fillRect(p.x, p.y, PLAYER_W, PLAYER_H);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(6,10,22,0.9)";
      const eyeY = p.grav === 1 ? p.y + 7 : p.y + PLAYER_H - 13;
      ctx.fillRect(p.x + 3, eyeY, 5, 6);
      ctx.fillRect(p.x + 12, eyeY, 5, 6);
      ctx.fillStyle = c.core;
      const thrY = p.grav === 1 ? p.y + PLAYER_H : p.y - 4;
      ctx.globalAlpha = 0.5 + Math.sin(this.t * 20) * 0.2;
      ctx.fillRect(p.x + 5, thrY, PLAYER_W - 10, 4);
      ctx.globalAlpha = 1;
    }

    // particles
    for (const pt of this.particles) {
      const colorMap: Record<string, string> = {
        "var(--flip)": c.player,
        "var(--core)": c.core,
        "var(--danger)": c.danger,
        "var(--exit)": c.exit,
      };
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = colorMap[pt.color] ?? c.core;
      ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    // gravity direction indicator arrows on edges
    ctx.restore();
  }
}
