// Tiện ích dùng chung cho kit.

export const PLAYER_COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b', '#3bc9db', '#f783ac'];

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // bỏ I, O để khỏi nhầm với 1, 0

export function roomCode(length = 5) {
  let s = '';
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Nội suy mượt không phụ thuộc framerate. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export const round = (v, p = 1000) => Math.round(v * p) / p;

export function params() {
  return new URLSearchParams(location.search);
}

export class Emitter {
  #handlers = new Map();
  on(type, fn) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    this.#handlers.get(type)?.delete(fn);
  }
  emit(type, ...args) {
    for (const fn of this.#handlers.get(type) ?? []) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[kit] handler "${type}" lỗi:`, err);
      }
    }
  }
}

/** Gộp sâu cấu hình: default ← override (chỉ object thường). */
export function mergeConfig(base, override = {}) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(override)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object'
      ? mergeConfig(out[k], v)
      : v;
  }
  return out;
}
