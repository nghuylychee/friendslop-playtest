// Build It Together — cả đội làm thợ hồ: khiêng vật liệu, trộn vữa, trát, lái cẩu tháp
// để xây căn nhà 2 tầng theo bản vẽ. Xây xong (đủ khối + trát hết) là nghiệm thu,
// căn nhà được giữ lại trong "khu phố" của đội như một thành tựu.

import * as THREE from 'three';
import { startApp, yawTo } from 'kit/app.js';
import { RAPIER } from 'kit/physics.js';
import { keyChips } from 'kit/ui.js';
import config from './config.js';
import { SLOTS } from './blueprint.js';
import {
  buildLevel, buildGhosts, buildTown, blockMesh, cementMesh, trowelMesh, setTrowelLoad, setWelded,
  addHelmet, hookPos, sfx, RAMP,
} from './level.js';

const B = config.blocks;
const isBlock = (pr) => !!B[pr?.data.kind];
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const dist3 = (t, p) => Math.hypot(t.x - p[0], t.y - p[1], t.z - p[2]);
const starsFor = (t) => (t <= config.stars[0] ? 3 : t <= config.stars[1] ? 2 : 1);
const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
const MIX = config.mixer.pos;
const MIX_CENTER = [MIX[0], 1.3, MIX[1]];
const TOWN_KEY = 'bit-town';

// ------------------------------------------------------------------ vật liệu ở bãi

function yardLayout() {
  const list = [];
  for (let i = 0; i < 8; i++) list.push({ kind: 'cot', pos: [-3.2, 0.21, 6.6 + i * 0.55], rot: [0, 0, Math.PI / 2] });
  for (const z of [8.2, 9.4, 10.6, 11.8, 13.0, 14.2]) {
    for (const x of [-1.4, 0.2, 1.8, 3.4]) list.push({ kind: 'gach', pos: [x, 0.16, z], rot: [Math.PI / 2, 0, 0] });
  }
  for (let i = 0; i < 4; i++) list.push({ kind: 'dam', pos: [-5.8 - i * 0.55, 0.16, 10.5], rot: [0, 0, 0] });
  list.push({ kind: 'san', pos: [-6.8, 0.11, 4.0], rot: [0, 0, 0] });
  list.push({ kind: 'mai', pos: [-6.8, 0.11, 14.6], rot: [0, 0, 0] });
  return list;
}

function spawnCement(ctx, i) {
  const [px, pz] = config.cement.pallet;
  const c = config.cement;
  const pos = i == null ? [px + (Math.random() - 0.5) * 0.6, 0.7, pz] : [px - 0.38 + (i % 2) * 0.76, 0.2 + Math.floor(i / 2) * 0.24, pz];
  ctx.spawnProp({ shape: 'box', size: c.size, pos, rot: [0, 0, 0], mass: c.mass, data: { kind: 'cement' } });
}

function spawnMaterials(ctx) {
  for (const id of [...ctx.props.keys()]) ctx.removeProp(id);
  for (const b of yardLayout()) {
    const spec = B[b.kind];
    ctx.spawnProp({ shape: 'box', size: spec.size, pos: b.pos, rot: b.rot, mass: spec.mass, data: { kind: b.kind, slot: null, welded: 0 } });
  }
  for (let i = 0; i < config.cement.supply; i++) spawnCement(ctx, i);
  const t = config.trowel;
  for (let i = 0; i < t.count; i++) {
    ctx.spawnProp({
      shape: 'box', size: [0.2, 0.06, 0.46], pos: [t.table[0] - 0.3 + i * 0.6, 0.9, t.table[1]], rot: [0, 0.3, 0], mass: t.mass,
      tool: true, holdDist: t.holdDist, holdOffset: [0.22, -0.32], grabPoint: [0, 0.04, 0.2], data: { kind: 'trowel', load: 0 },
    });
  }
}

// ------------------------------------------------------------------ ô bản vẽ

/** Map slotId → prop đang nằm trong ô. */
function occupied(ctx) {
  const m = new Map();
  for (const pr of ctx.props.values()) if (pr.data.slot != null) m.set(pr.data.slot, pr);
  return m;
}

/** Ô có chỗ tựa: sát móng, hoặc có khối đã đặt ngay bên dưới. */
function supported(slot, occ) {
  return slot.ground || slot.neighbors.some((n) => occ.has(n) && SLOTS[n].pos[1] < slot.pos[1] - 0.05);
}

/** Host, 10 lần/giây: khối hít vào ô, khối rơi khỏi ô, bao xi măng vào máy trộn, kiểm tra hoàn thành. */
function snapTick(ctx) {
  const s = ctx.shared;
  const occ = occupied(ctx);
  for (const [sid, pr] of occ) {
    if (dist3(pr.body.translation(), SLOTS[sid].pos) > config.score.standDist * 2) {
      ctx.setPropData(pr.id, { slot: null, welded: 0 });
      occ.delete(sid);
    }
  }
  for (const pr of ctx.props.values()) {
    if (!isBlock(pr) || pr.data.slot != null) continue;
    const t = pr.body.translation();
    let best = null;
    let bd = config.snap.dist;
    for (const sl of SLOTS) {
      if (sl.kind !== pr.data.kind || occ.has(sl.id) || !supported(sl, occ)) continue;
      const d = dist3(t, sl.pos);
      if (d < bd) { bd = d; best = sl; }
    }
    if (!best) continue;
    ctx.forceRelease(pr.id);
    if (s.crane?.att === pr.id) setCrane(ctx, { att: null });
    ctx.teleportProp(pr.id, best.pos, best.rot);
    ctx.setPropData(pr.id, { slot: best.id });
    occ.set(best.id, pr);
    ctx.emit('snap', { id: pr.id });
  }

  // Bao xi măng chạm máy trộn → đổ vào
  for (const pr of [...ctx.props.values()]) {
    if (pr.data.kind !== 'cement' || dist3(pr.body.translation(), MIX_CENTER) > config.mixer.feedRadius) continue;
    if (s.crane?.att === pr.id) setCrane(ctx, { att: null });
    ctx.removeProp(pr.id);
    ctx.setShared({ mixer: { ...s.mixer, queue: (s.mixer.queue ?? 0) + 1 } });
    ctx.emit('feed');
  }

  let bonded = 0;
  for (const pr of occ.values()) if (pr.data.welded) bonded++;
  if (occ.size !== s.placed || bonded !== s.bonded) ctx.setShared({ placed: occ.size, bonded });
  if (s.phase === 'build' && occ.size === SLOTS.length && bonded === SLOTS.length) finish(ctx);
}

function finish(ctx) {
  const time = ctx.shared.elapsed;
  const stars = starsFor(time);
  // Nghiệm thu xong: khoá cứng căn nhà, không ai làm đổ được nữa
  for (const pr of ctx.props.values()) if (pr.data.slot != null) pr.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
  setCrane(ctx, { att: null });
  const crew = [...ctx.players.values()].map((p) => p.name);
  ctx.setShared({ phase: 'done', stars });
  ctx.emit('done', { time, stars, crew });
}

/** Host: lưu căn nhà vừa xong vào khu phố (localStorage của host) rồi mở công trình mới. */
function nextJob(ctx) {
  const s = ctx.shared;
  const town = [...(s.town ?? [])];
  town.push({ n: (town.at(-1)?.n ?? 0) + 1, stars: s.stars, time: fmtTime(s.elapsed), crew: [...ctx.players.values()].map((p) => p.name), date: new Date().toISOString().slice(0, 10) });
  const keep = town.slice(-config.town.plots.length);
  try { localStorage.setItem(TOWN_KEY, JSON.stringify(keep)); } catch { /* chế độ riêng tư */ }
  ctx.setShared({ town: keep });
  game.startRound(ctx);
}

// ------------------------------------------------------------------ cẩu tháp (host)

function setCrane(ctx, patch) {
  ctx.setShared({ crane: { ...ctx.shared.crane, ...patch } });
}

function craneStep(ctx, h, dt) {
  const c = config.crane;
  const cr = ctx.shared.crane;
  const st = h.crane;
  const inp = ctx.time - (h.craneIn.t ?? -9) < 0.6 ? h.craneIn : { vx: 0, vz: 0, vy: 0 };
  if (inp.vx || inp.vz || inp.vy) {
    const hp = hookPos(st);
    const sp = Math.hypot(inp.vx, inp.vz);
    const k = sp > c.speed ? c.speed / sp : 1;
    const nx = hp.x + inp.vx * k * dt - c.mast[0];
    const nz = hp.z + inp.vz * k * dt - c.mast[1];
    st.r = Math.min(c.rMax, Math.max(c.rMin, Math.hypot(nx, nz)));
    st.a = Math.atan2(nz, nx);
    st.y = Math.min(c.yMax, Math.max(c.yMin, st.y + Math.sign(inp.vy) * c.hoist * dt));
  }
  // Khối treo: lò xo kéo về dưới móc, bù trọng lực, giảm xoay
  const pr = cr.att && ctx.props.get(cr.att);
  if (pr && pr.body.isDynamic()) {
    const hp = hookPos(st);
    const t = pr.body.translation();
    const v = pr.body.linvel();
    const target = { x: hp.x, y: hp.y - c.hang, z: hp.z };
    let ax = c.stiffness * (target.x - t.x) - c.damping * v.x;
    let ay = c.stiffness * (target.y - t.y) - c.damping * v.y;
    let az = c.stiffness * (target.z - t.z) - c.damping * v.z;
    const a = Math.hypot(ax, ay, az);
    if (a > c.maxAccel) { ax *= c.maxAccel / a; ay *= c.maxAccel / a; az *= c.maxAccel / a; }
    const m = pr.body.mass();
    pr.body.applyImpulse({ x: m * ax * dt, y: m * (ay + ctx.config.physics.gravity) * dt, z: m * az * dt }, true);
    const w = pr.body.angvel();
    pr.body.setAngvel({ x: w.x * 0.9, y: w.y * 0.9, z: w.z * 0.9 }, true);
  }
  h.craneSend += dt;
  if (h.craneSend >= 1 / c.sendHz) {
    h.craneSend = 0;
    const r = (x) => Math.round(x * 1000) / 1000;
    if (r(st.a) !== cr.a || r(st.r) !== cr.r || r(st.y) !== cr.y) setCrane(ctx, { a: r(st.a), r: r(st.r), y: r(st.y) });
  }
}

/** Khối gần móc nhất có thể móc (bỏ qua khối đã trát). */
function hookable(ctx, hook, posOf, only) {
  const c = config.crane;
  let best = null;
  let bd = Infinity;
  for (const pr of ctx.props.values()) {
    if (pr.data.kind === 'trowel' || (pr.data.slot != null && pr.data.welded)) continue;
    if (only && !only(pr)) continue;
    const p = posOf(pr);
    const half = Math.max(...pr.spec.size) / 2;
    const d = Math.hypot(p.x - hook.x, p.y - (hook.y - c.hang), p.z - hook.z) - half * 0.3;
    if (d < c.hookRadius && d < bd) { bd = d; best = pr; }
  }
  return best;
}

// ------------------------------------------------------------------ bot

const RAMP_FOOT = { x: RAMP.x, z: RAMP.footZ + 0.4 };
const RAMP_TOP = { x: RAMP.x, z: RAMP.topZ + 0.3 };
const onRamp = (f) => Math.abs(f.x - RAMP.x) < 0.9 && f.z > RAMP.topZ - 0.2 && f.z < RAMP.footZ + 0.3 && f.y > 0.2;

/** Điểm đi tiếp theo: lên/xuống tầng 2 qua dốc giàn giáo, tránh sườn dốc khi đi dưới đất. */
function route(feet, goal, goalY) {
  const up = feet.y > 1.5;
  // Đang ở trong nhà tầng 1 mà đích ở ngoài → ra bằng mặt tiền (mặt trước để trống)
  const inside = (p) => Math.abs(p.x) < 1.45 && p.z > -1.45 && p.z < 1.45;
  const atHouse = Math.abs(goal.x) < 2.3 && Math.abs(goal.z) < 2.3 && goalY < 3.0; // ô tầng 1 nằm sát tường
  if (!up && inside(feet) && !atHouse) return { x: Math.max(-0.9, Math.min(0.9, feet.x)), z: 2.9 };
  const wantUp = goalY > 3.0; // sàn tầng 1 (tâm 2.7 m) đặt được từ dưới đất; ô tầng 2 thì phải lên dốc
  if (wantUp && !up) {
    if (onRamp(feet)) return RAMP_TOP;
    return Math.hypot(feet.x - RAMP_FOOT.x, feet.z - RAMP_FOOT.z) < 0.8 ? RAMP_TOP : RAMP_FOOT;
  }
  if (!wantUp && up) {
    if (onRamp(feet)) return RAMP_FOOT;
    return Math.hypot(feet.x - RAMP_TOP.x, feet.z - RAMP_TOP.z) < 0.8 ? RAMP_FOOT : RAMP_TOP;
  }
  if (!wantUp && onRamp(feet) && feet.y > 0.6) return RAMP_FOOT;
  if (!up && goal.x < 1.9 && feet.x > 1.75 && feet.x < RAMP.x && feet.z > RAMP.topZ && feet.z < RAMP.footZ + 0.3) return { x: 1.1, z: feet.z - 0.8 };
  const left = (x) => x < RAMP.x;
  if (!up && left(feet.x) !== left(goal.x) && Math.min(feet.z, goal.z) < RAMP.footZ + 0.6) {
    const around = RAMP.footZ + 1.3;
    if (feet.z < around - 0.4) return { x: feet.x, z: around };
    if (goal.z < around - 0.4 && Math.abs(feet.x - goal.x) > 1.2) return { x: goal.x, z: around };
  }
  return goal;
}

const CRANE_KINDS = new Set(['san', 'mai']); // tấm lớn: bot dùng cẩu thay vì khiêng

function nextSlot(ctx, bot, occ, kind, skipCrane = false) {
  const claims = (s) => [...ctx.players.values()].filter((o) => o !== bot && o.memory?.slot === s.id).length;
  for (const s of SLOTS) {
    if (occ.has(s.id) || !supported(s, occ) || (kind && s.kind !== kind)) continue;
    if (skipCrane && CRANE_KINDS.has(s.kind)) continue;
    const heavy = B[s.kind].mass > 45;
    if (claims(s) >= (heavy ? 3 : 1)) continue;
    return s;
  }
  return null;
}

function pickBlock(ctx, bot, occ) {
  const slot = nextSlot(ctx, bot, occ, null, true);
  if (!slot) return null;
  const heavy = B[slot.kind].mass > 45;
  const feet = bot.feet();
  const taken = new Set([...ctx.players.values()].filter((o) => o !== bot).map((o) => o.memory?.target));
  let best = null;
  let bd = Infinity;
  for (const pr of ctx.props.values()) {
    if (pr.data.kind !== slot.kind || pr.data.slot != null || ctx.shared.crane?.att === pr.id) continue;
    if (!heavy && (taken.has(pr.id) || ctx.holders(pr.id) > 0)) continue;
    const p = ctx.propPosition(pr.id);
    const d = Math.hypot(p.x - feet.x, p.z - feet.z) - (heavy && taken.has(pr.id) ? 5 : 0);
    if (d < bd) { bd = d; best = pr; }
  }
  bot.memory.slot = best ? slot.id : null;
  return best?.id ?? null;
}

/** Đi tới đồ rồi nhặt. */
function fetch(ctx, bot, id, mv) {
  const feet = bot.feet();
  const p = ctx.propPosition(id);
  const d = Math.hypot(p.x - feet.x, p.z - feet.z);
  const size = ctx.props.get(id).spec.size;
  const reach = Math.min(ctx.config.player.reach - 0.3, 1.1 + Math.max(...size) / 2);
  if (d < reach && Math.abs(p.y - feet.y) < 2.2) return { yaw: yawTo(feet, p), pitch: -0.6, grab: id };
  const next = route(feet, p, p.y);
  return { yaw: yawTo(feet, next), pitch: 0, moveZ: 1, ...mv, sprint: d > 6 && next === p };
}

function goTo(feet, goal, goalY, near, mv) {
  const next = route(feet, goal, goalY);
  const d = Math.hypot(goal.x - feet.x, goal.z - feet.z);
  if (next === goal && d < near) return null;
  return { yaw: yawTo(feet, next), pitch: 0, moveZ: 1, ...mv };
}

function nearestProp(ctx, feet, test) {
  let best = null;
  let bd = Infinity;
  for (const pr of ctx.props.values()) {
    if (!test(pr)) continue;
    const p = ctx.propPosition(pr.id);
    const d = Math.hypot(p.x - feet.x, p.z - feet.z) + Math.abs(p.y - feet.y);
    if (d < bd) { bd = d; best = pr; }
  }
  return best;
}

/** Thợ trát: chở xi măng vào máy trộn, múc vữa, trát các khối đã đặt. */
function masonBrain(ctx, bot, dt, mv) {
  const m = bot.memory;
  const feet = bot.feet();
  const mx = ctx.shared.mixer ?? {};
  const mixer = { x: MIX[0], z: MIX[1] };
  const stocked = (mx.mortar ?? 0) > 0 || (mx.queue ?? 0) > 0 || mx.mixing;
  const held = bot.hold && ctx.props.get(bot.hold.id);
  const kind = held?.data.kind;
  const idle = { yaw: bot.yaw, pitch: 0 };
  m.cd = (m.cd ?? 0) - dt;

  if (held && kind !== 'trowel' && kind !== 'cement') return { ...idle, release: true };

  if (kind === 'cement') {
    bot.hold.dist = 1.2; // ôm bao sát người, cao ngang ngực để qua được thân máy
    const go = goTo(feet, mixer, 0, 1.6, mv);
    if (go) return { ...go, pitch: 0.15 };
    const eye = bot.eye();
    const horiz = Math.hypot(mixer.x - feet.x, mixer.z - feet.z);
    return { yaw: yawTo(feet, mixer), pitch: Math.atan2(MIX_CENTER[1] + 0.2 - eye.y, Math.max(0.3, horiz)), moveZ: horiz > 1.3 ? 0.5 : 0 };
  }

  if (kind === 'trowel') {
    const load = held.data.load ?? 0;
    const todo = (pr) => isBlock(pr) && pr.data.slot != null && !pr.data.welded
      && ![...ctx.players.values()].some((o) => o !== bot && o.memory?.bondTarget === pr.id);
    const keep = ctx.props.get(m.bondTarget);
    const stillTodo = keep && isBlock(keep) && keep.data.slot != null && !keep.data.welded;
    const target = load > 0 ? (stillTodo ? keep : nearestProp(ctx, feet, todo)) : null;
    if (!target) {
      if (load >= config.trowel.cap || (load > 0 && !nearestProp(ctx, feet, (pr) => isBlock(pr) && pr.data.slot == null))) return idle;
      if (!stocked && load === 0) return { ...idle, release: true }; // hết vữa: bỏ bay, đi chở xi măng
      const go = goTo(feet, mixer, 0, 1.9, mv);
      if (go) return go;
      if ((mx.mortar ?? 0) > 0 && m.cd <= 0) { ctx.request('scoop', { tool: held.id }); m.cd = 0.5; }
      return { yaw: yawTo(feet, mixer), pitch: -0.2 };
    }
    m.bondTarget = target.id;
    const slot = SLOTS[target.data.slot];
    const p = ctx.propPosition(target.id);
    const upstairs = slot.pos[1] > 3.0;
    const go = goTo(feet, p, slot.pos[1], 2.2, mv);
    if (go) return go;
    if (upstairs !== feet.y > 1.5) return { yaw: yawTo(feet, p), pitch: 0, moveZ: 1, ...mv };
    if (m.cd <= 0) { ctx.request('bond', { id: target.id, tool: held.id }); m.cd = 0.4; }
    return { yaw: yawTo(feet, p), pitch: -0.3 };
  }

  // Tay không
  m.bondTarget = null;
  if (!stocked) {
    const bag = nearestProp(ctx, feet, (pr) => pr.data.kind === 'cement' && ctx.holders(pr.id) === 0);
    if (bag) return fetch(ctx, bot, bag.id, mv);
    return idle;
  }
  const tool = nearestProp(ctx, feet, (pr) => pr.data.kind === 'trowel' && ctx.holders(pr.id) === 0);
  return tool ? fetch(ctx, bot, tool.id, mv) : idle;
}

/** Ô sàn/mái tiếp theo cần cẩu (đã có chỗ tựa), kèm tấm vật liệu tương ứng. */
function craneJob(ctx, bot, occ) {
  const others = [...ctx.players.values()].filter((o) => o !== bot);
  const claimed = new Set(others.map((o) => o.memory?.slot));
  const targeted = new Set(others.map((o) => o.memory?.target));
  // Sàn/mái, và mọi ô tầng 2 (khiêng qua dốc rất chậm) → cẩu
  const slot = SLOTS.find((s) => (CRANE_KINDS.has(s.kind) || s.floor === 2) && !occ.has(s.id) && supported(s, occ)
    && (CRANE_KINDS.has(s.kind) || !claimed.has(s.id)));
  if (!slot) return null;
  const att = ctx.shared.crane?.att && ctx.props.get(ctx.shared.crane.att);
  const piece = att?.data.kind === slot.kind ? att
    : nearestProp(ctx, { x: -4, y: 0, z: 8 }, (pr) => pr.data.kind === slot.kind && pr.data.slot == null
      && ctx.holders(pr.id) === 0 && !targeted.has(pr.id));
  if (!piece) return null;
  bot.memory.slot = slot.id;
  return { slot, piece };
}

/** Bot lái cẩu: đi tới bàn điều khiển, móc tấm, nhấc qua tường, hạ vào ô (ô tự hít). */
function craneBrain(ctx, bot, dt, mv, job) {
  const c = config.crane;
  const s = ctx.shared;
  const feet = bot.feet();
  const booth = { x: c.booth[0], z: c.booth[1] + 0.9 };
  if (bot.hold) return { release: true, yaw: bot.yaw, pitch: 0 };
  if (s.crane.op !== bot.id) {
    const go = goTo(feet, booth, 0, 0.6, mv);
    if (go) return go;
    if (s.crane.op && ctx.players.has(s.crane.op)) return { yaw: bot.yaw, pitch: 0 }; // người khác đang lái
    setCrane(ctx, { op: bot.id });
  }
  const h = ctx.$h;
  if (!h) return { yaw: bot.yaw, pitch: 0 };
  const hook = hookPos(h.crane);
  const cur = s.crane.att && ctx.props.get(s.crane.att);
  if (cur && cur.data.kind !== job.slot.kind) { setCrane(ctx, { att: null }); ctx.emit('unhook'); } // móc nhầm loại → thả
  const hung = !!cur && cur.id === job.piece.id;
  const goal = hung ? { x: job.slot.pos[0], z: job.slot.pos[2] } : ctx.propPosition(job.piece.id);
  const clearY = (hung ? job.slot.pos[1] : 3) + c.hang + 1.6; // độ cao an toàn khi di chuyển ngang
  const dx = goal.x - hook.x;
  const dz = goal.z - hook.z;
  const flat = Math.hypot(dx, dz);
  let vy = 0;
  let vx = 0;
  let vz = 0;
  if (flat > 0.15) {
    if (hook.y < clearY - 0.2) vy = 1; // nhấc lên trước rồi mới đi ngang
    else { const k = Math.min(1, flat) / flat; vx = dx * k * c.speed; vz = dz * k * c.speed; }
  } else {
    const wantY = hung ? job.slot.pos[1] + c.hang - 0.05 : ctx.propPosition(job.piece.id).y + c.hang;
    vy = hook.y > wantY + 0.1 ? -1 : 0;
    if (!hung && vy === 0) {
      const pr = hookable(ctx, hook, (p) => p.body.translation(), (p) => p.data.kind === job.slot.kind && p.data.slot == null);
      if (pr) { setCrane(ctx, { att: pr.id }); ctx.emit('hook'); }
    }
  }
  h.craneIn = { vx, vz, vy, t: ctx.time };
  const hp = hookPos(h.crane);
  return { yaw: yawTo(feet, hp), pitch: Math.atan2(hp.y - bot.eye().y, Math.max(1, Math.hypot(hp.x - feet.x, hp.z - feet.z))) };
}

/** Thợ xây: khiêng khối tới ô trống theo thứ tự bản vẽ (đồ nặng chờ người phụ). */
function builderBrain(ctx, bot, dt, mv, occ) {
  const m = bot.memory;
  const feet = bot.feet();
  if (bot.hold) {
    const pr = ctx.props.get(bot.hold.id);
    if (!pr || !isBlock(pr) || pr.data.slot != null) { m.target = null; m.slot = null; return { release: true, yaw: bot.yaw, pitch: 0 }; }
    let slot = m.slot != null ? SLOTS[m.slot] : null;
    if (!slot || occ.has(slot.id) || slot.kind !== pr.data.kind || !supported(slot, occ)) slot = nextSlot(ctx, bot, occ, pr.data.kind, true);
    if (!slot) return { release: true, yaw: bot.yaw, pitch: 0 };
    m.slot = slot.id;
    const need = Math.ceil((pr.spec.mass * ctx.config.physics.gravity) / ctx.config.grab.maxForce);
    m.waitT = ctx.holders(pr.id) < need ? (m.waitT ?? 0) + dt : 0;
    if (m.waitT > 0 && m.waitT < 12) {
      const p = ctx.propPosition(pr.id);
      return { yaw: yawTo(feet, p), pitch: 0.2, moveZ: 0 };
    }
    {
      const bp = ctx.propPosition(pr.id);
      const eye = bot.eye();
      const lag = Math.hypot(bp.x - eye.x, bp.y - eye.y, bp.z - eye.z) - bot.hold.dist;
      if (lag > 0.9) {
        const flat = Math.max(0.5, Math.hypot(bp.x - feet.x, bp.z - feet.z));
        return { yaw: yawTo(feet, bp), pitch: Math.atan2(bp.y + 1.2 - eye.y, flat), moveZ: 0, ...mv };
      }
    }
    m.carryT = (m.carryT ?? 0) + dt;
    if (m.carryT > 40) { m.carryT = 0; m.target = null; return { release: true, yaw: bot.yaw, pitch: 0 }; }
    const goal = { x: slot.pos[0], z: slot.pos[2] };
    const next = route(feet, goal, slot.pos[1]);
    if (next !== goal) return { yaw: yawTo(feet, next), pitch: -0.1, moveZ: 1, ...mv };
    const eye = bot.eye();
    const horiz = Math.hypot(goal.x - feet.x, goal.z - feet.z);
    const pitch = Math.atan2(slot.pos[1] + 0.4 - eye.y, Math.max(horiz, 0.5));
    const reach = bot.hold.dist * Math.cos(pitch);
    const moveZ = horiz > reach + 0.15 ? 1 : horiz < reach - 0.5 ? -1 : 0;
    return { yaw: yawTo(feet, goal), pitch, moveZ, ...mv };
  }
  m.carryT = 0;
  const tp = m.target && ctx.props.get(m.target);
  const stale = !tp || tp.data.slot != null || m.slot == null || occ.has(m.slot) || SLOTS[m.slot].kind !== tp.data.kind;
  if (stale) m.target = pickBlock(ctx, bot, occ);
  if (!m.target) return { yaw: bot.yaw, pitch: 0 };
  return fetch(ctx, bot, m.target, mv);
}

function botBrain(ctx, bot, dt) {
  const m = bot.memory;
  const feet = bot.feet();
  m.stuckT = (m.stuckT ?? 0) + dt;
  if (m.stuckT > 1.2) {
    m.stuck = m.last && Math.hypot(feet.x - m.last.x, feet.z - m.last.z) < 0.25;
    m.wiggle = m.stuck ? (Math.random() < 0.5 ? -1 : 1) : 0;
    m.last = feet;
    m.stuckT = 0;
  }
  const mv = { moveX: m.wiggle ?? 0, jump: !!m.stuck && Math.random() < 0.08 };

  if (ctx.shared.phase !== 'build') {
    m.target = null;
    m.slot = null;
    return { yaw: bot.yaw, pitch: 0, release: !!bot.hold };
  }
  const occ = occupied(ctx);
  // Vai trò: bot đầu tiên làm thợ trát; nếu chỉ có 1 bot thì đổi vai theo việc tồn đọng
  const bots = [...ctx.players.values()].filter((p) => p.isBot);
  let loose = 0;
  for (const pr of occ.values()) if (!pr.data.welded) loose++;
  if (bots.length > 1) m.role = bots[0] === bot ? 'mason' : 'builder';
  else if (m.role !== 'mason' && (loose >= 6 || (loose > 0 && !nextSlot(ctx, bot, occ)))) m.role = 'mason';
  else if (m.role === 'mason' && loose === 0 && !bot.hold) m.role = 'builder';
  if (m.role === 'mason') return masonBrain(ctx, bot, dt, mv);
  // Thợ xây đầu tiên kiêm lái cẩu khi tới lượt sàn/mái
  const builders = bots.filter((b) => b.memory.role !== 'mason');
  const job = builders[0] === bot ? craneJob(ctx, bot, occ) : null;
  if (job) return craneBrain(ctx, bot, dt, mv, job);
  if (ctx.shared.crane?.op === bot.id) setCrane(ctx, { op: null });
  return builderBrain(ctx, bot, dt, mv, occ);
}

// ------------------------------------------------------------------ client: trạm, HUD, hiệu ứng

let hud;
let opBar;
let ghosts;
let stations;
let town;
let confetti = null;
const ray = new THREE.Raycaster();

/** Trạm đang nhắm (máy trộn / bàn điều khiển cẩu) trong tầm với. */
function aimStation(ctx) {
  ray.setFromCamera({ x: 0, y: 0 }, ctx.camera);
  ray.far = ctx.config.player.reach;
  const hits = ray.intersectObjects([stations.mixer.group, stations.crane.booth], true);
  if (!hits[0]) return null;
  let o = hits[0].object;
  while (o && o !== stations.mixer.group && o !== stations.crane.booth) o = o.parent;
  return { name: o === stations.mixer.group ? 'mixer' : 'booth', dist: hits[0].distance };
}

function aimDist(ctx, aim) {
  return aim ? ctx.camera.position.distanceTo(aim.point) : Infinity;
}

const operating = (ctx) => ctx.shared.crane?.op === ctx.selfId;

function spawnConfetti(scene) {
  const colors = ['#ffd43b', '#ff6b6b', '#4dabf7', '#69db7c', '#f783ac', '#ffffff'];
  const geo = new THREE.PlaneGeometry(0.12, 0.08);
  const parts = [];
  for (let i = 0; i < 220; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide }));
    m.position.set((Math.random() - 0.5) * 2, 7 + Math.random(), (Math.random() - 0.5) * 2);
    m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 7, 4 + Math.random() * 5, (Math.random() - 0.5) * 7);
    m.userData.w = new THREE.Vector3(Math.random() * 8, Math.random() * 8, 0);
    scene.add(m);
    parts.push(m);
  }
  return { parts, t: 0 };
}

function updateConfetti(dt) {
  if (!confetti) return;
  confetti.t += dt;
  for (const m of confetti.parts) {
    const v = m.userData.v;
    v.y -= 6 * dt;
    v.multiplyScalar(0.985);
    m.position.addScaledVector(v, dt);
    m.rotation.x += m.userData.w.x * dt;
    m.rotation.y += m.userData.w.y * dt;
  }
  if (confetti.t > 6) {
    for (const m of confetti.parts) { m.removeFromParent(); m.material.dispose(); }
    confetti = null;
  }
}

// ------------------------------------------------------------------ game

const game = {
  id: 'build-it-together',
  title: 'Build It Together',
  subtitle: 'Build a house. Keep it forever.',
  config,
  botBrain,
  render: { sky: '#ffcf99', fog: [40, 120] },
  thumbnail: { camera: [-7.5, 5.5, 9], target: [0.5, 1.8, 0], fov: 55 },

  setup(ctx) {
    stations = buildLevel(ctx);
    ghosts = buildGhosts(ctx.scene);
    town = buildTown(ctx.scene);
  },

  start(ctx) {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(TOWN_KEY) ?? '[]'); } catch { saved = []; }
    const [a, r, y] = config.crane.start;
    ctx.setShared({
      phase: 'lobby', elapsed: 0, placed: 0, bonded: 0, stars: 0, town: saved,
      mixer: { mortar: 0, queue: 0, mixing: 0 }, crane: { op: null, att: null, a, r, y },
    });
    spawnMaterials(ctx);
  },

  // Host
  startRound(ctx) {
    ctx.$h = null;
    spawnMaterials(ctx);
    const [a, r, y] = config.crane.start;
    ctx.setShared({
      phase: 'build', elapsed: 0, placed: 0, bonded: 0, stars: 0,
      mixer: { mortar: 0, queue: 0, mixing: 0 }, crane: { ...ctx.shared.crane, att: null, a, r, y },
    });
    ctx.emit('start');
  },

  hostUpdate(ctx, dt) {
    const s = ctx.shared;
    const h = (ctx.$h ??= { acc: 0, snapAcc: 0, mixT: 0, cementT: 0, craneSend: 0, craneIn: {}, crane: { a: s.crane.a, r: s.crane.r, y: s.crane.y } });
    h.snapAcc += dt;
    if (h.snapAcc >= 1 / config.snap.hz) { h.snapAcc = 0; snapTick(ctx); }
    if (s.phase === 'build') {
      h.acc += dt;
      if (h.acc >= 0.5) { h.acc = 0; ctx.setShared({ elapsed: s.elapsed + 0.5 }); }
    }

    // Máy trộn
    const mx = s.mixer;
    if (h.mixT > 0) {
      h.mixT -= dt;
      if (h.mixT <= 0) {
        ctx.setShared({ mixer: { ...mx, mixing: 0, mortar: Math.min(config.mixer.max, mx.mortar + config.mixer.perBag) } });
        ctx.emit('mixed');
      }
    } else if (mx.queue > 0) {
      h.mixT = config.mixer.mixSeconds;
      ctx.setShared({ mixer: { ...mx, queue: mx.queue - 1, mixing: 1 } });
      ctx.emit('mix', { seconds: config.mixer.mixSeconds });
    }

    // Luôn có sẵn bao xi măng ở pallet
    let bags = 0;
    for (const pr of ctx.props.values()) if (pr.data.kind === 'cement') bags++;
    if (bags < config.cement.supply) {
      h.cementT += dt;
      if (h.cementT >= config.cement.respawn) { h.cementT = 0; spawnCement(ctx); }
    }

    // Cái bay đang cầm: giữ thẳng theo hướng người cầm
    for (const pr of ctx.props.values()) {
      if (pr.data.kind !== 'trowel') continue;
      const holder = ctx.holdersOf(pr.id)[0];
      if (!holder) continue;
      const yaw = holder.pose[3];
      pr.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
      pr.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    craneStep(ctx, h, dt);
  },

  onRequest(ctx, from, type, data) {
    const s = ctx.shared;
    const h = ctx.$h;
    if (type === 'craneEnter') {
      if (!s.crane.op || !ctx.players.has(s.crane.op)) { setCrane(ctx, { op: from }); ctx.emit('crane', { by: from, on: true }); }
      return;
    }
    if (type === 'craneExit') {
      if (s.crane.op === from) { setCrane(ctx, { op: null }); if (h) h.craneIn = {}; }
      return;
    }
    if (type === 'crane') {
      if (s.crane.op === from && h) h.craneIn = { vx: +data.vx || 0, vz: +data.vz || 0, vy: +data.vy || 0, t: ctx.time };
      return;
    }
    if (type === 'craneHook') {
      if (s.crane.op !== from || !h) return;
      if (s.crane.att) { setCrane(ctx, { att: null }); ctx.emit('unhook'); return; }
      const pr = hookable(ctx, hookPos(h.crane), (p) => p.body.translation());
      if (!pr) return;
      if (pr.data.slot != null) ctx.setPropData(pr.id, { slot: null });
      setCrane(ctx, { att: pr.id });
      ctx.emit('hook');
      return;
    }
    if (type === 'scoop') {
      const tool = ctx.props.get(data.tool);
      if (!tool || tool.data.kind !== 'trowel') return;
      const room = config.trowel.cap - (tool.data.load ?? 0);
      const take = Math.min(room, s.mixer.mortar);
      if (take <= 0) { if (!s.mixer.mortar) ctx.emit('nomortar', { to: from }); return; }
      ctx.setShared({ mixer: { ...s.mixer, mortar: s.mixer.mortar - take } });
      ctx.setPropData(tool.id, { load: (tool.data.load ?? 0) + take });
      ctx.emit('scoop', { by: from });
      return;
    }
    if (type === 'bond') {
      const pr = ctx.props.get(data.id);
      const tool = ctx.props.get(data.tool);
      if (!pr || !tool || tool.data.kind !== 'trowel' || pr.data.slot == null || pr.data.welded) return;
      if (!(tool.data.load > 0)) { ctx.emit('nomortar', { to: from }); return; }
      const slot = SLOTS[pr.data.slot];
      const occ = occupied(ctx);
      for (const n of slot.neighbors) {
        const q = occ.get(n);
        if (q) ctx.weld(pr.id, q.id);
      }
      if (slot.ground) ctx.weld(pr.id, null);
      ctx.setPropData(pr.id, { welded: 1 });
      ctx.setPropData(tool.id, { load: tool.data.load - 1 });
      ctx.emit('bond', { id: pr.id, by: from });
    }
  },

  onPlayerLeave(ctx, p) {
    if (ctx.shared.crane?.op === p.id) setCrane(ctx, { op: null });
  },

  onWeldBreak(ctx, a, b) {
    ctx.emit('crack', { id: a });
    for (const id of [a, b]) if (id && ctx.weldCount(id) === 0 && ctx.props.get(id)?.data.welded) ctx.setPropData(id, { welded: 0 });
  },

  propMesh(spec) {
    if (spec.data.kind === 'cement') return cementMesh(spec);
    if (spec.data.kind === 'trowel') return trowelMesh(spec);
    return blockMesh(spec);
  },
  onPropSpawn(ctx, pr) { if (isBlock(pr)) setWelded(pr.mesh, pr.data.welded > 0); },
  onPropData(ctx, pr, patch) {
    if ('welded' in patch && isBlock(pr)) setWelded(pr.mesh, patch.welded > 0);
    if ('load' in patch) setTrowelLoad(pr.mesh, patch.load);
  },

  // ---- tương tác (người chơi local)

  canGrab(ctx, pr) {
    if (operating(ctx)) return false;
    return !(isBlock(pr) && pr.data.slot != null && (pr.data.welded || ctx.shared.phase === 'done'));
  },

  /** Phím E: vào/ra cẩu. Trả true nếu đã xử lý. */
  interact(ctx) {
    if (operating(ctx)) { ctx.request('craneExit'); return true; }
    if (!ctx.self?.hold && ctx.$station?.name === 'booth' && ctx.$station.dist < aimDist(ctx, ctx.aimedProp())) {
      ctx.request('craneEnter');
      return true;
    }
    return false;
  },

  /** Click chuột trái: móc/thả cẩu, múc vữa, trát. */
  use(ctx, held, aim) {
    if (operating(ctx)) { ctx.request('craneHook'); return; }
    if (held?.data.kind !== 'trowel') return;
    const st = ctx.$station;
    if (st?.name === 'mixer' && st.dist < aimDist(ctx, aim)) { ctx.request('scoop', { tool: held.id }); return; }
    const pr = aim?.prop;
    if (isBlock(pr) && pr.data.slot != null && !pr.data.welded) ctx.request('bond', { id: pr.id, tool: held.id });
  },

  aimPrompt(ctx, pr) {
    if (operating(ctx)) return '';
    const k = pr.data.kind;
    if (k === 'cement') return '[E] Cement';
    if (k === 'trowel') return '[E] Trowel';
    const b = B[k];
    if (pr.data.slot != null) return pr.data.welded || ctx.shared.phase === 'done' ? '✔' : '🪣 Needs mortar';
    return `[E] ${b.name}${b.mass > 45 ? ' 👥' : ''}${CRANE_KINDS.has(k) ? ' · 🏗️' : ''}`;
  },

  holdPrompt(ctx, pr, aim) {
    const k = pr.data.kind;
    if (k === 'cement') return '➜ Mixer   [E] Drop';
    if (k !== 'trowel') return '[E] Drop';
    const load = pr.data.load ?? 0;
    const st = ctx.$station;
    if (st?.name === 'mixer' && st.dist < aimDist(ctx, aim)) return (ctx.shared.mixer?.mortar ?? 0) > 0 ? '[Click] Scoop' : '🌀 Empty · add cement';
    const t = aim?.prop;
    if (isBlock(t) && t.data.slot != null && !t.data.welded) return load > 0 ? '[Click] Mortar' : '🪣 0 · ➜ Mixer';
    return `🪣 ${load}/${config.trowel.cap}`;
  },

  onEvent(ctx, type, data) {
    const me = data?.to === ctx.selfId || data?.by === ctx.selfId;
    if (type === 'start') { sfx.whistle(); ctx.ui.toast('🔨 Build!'); ctx.ui.closeModal(); }
    if (type === 'snap') sfx.snap();
    if (type === 'bond') sfx.weld();
    if (type === 'scoop') sfx.scoop();
    if (type === 'feed') sfx.clank();
    if (type === 'mix') sfx.mix(data.seconds);
    if (type === 'mixed') sfx.snap();
    if (type === 'hook' || type === 'unhook') sfx.clank();
    if (type === 'crack') sfx.crack();
    if (type === 'nomortar' && me) ctx.ui.toast('🪣 Empty');
    if (type === 'done') {
      sfx.fanfare();
      confetti = spawnConfetti(ctx.scene);
      const body = document.createElement('div');
      body.style.cssText = 'margin:4px 0 18px';
      body.innerHTML = `<div style="font-size:44px;color:#ffd43b;letter-spacing:4px">${starText(data.stars)}</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px">⏱ ${fmtTime(data.time)}</div>
        <div style="color:#b8bcc6;margin-top:6px">🏘️ +1 house</div>`;
      ctx.ui.modal({ title: '🏆 Job done!', body, buttons: [{ text: 'OK', primary: true }] });
    }
  },

  update(ctx, dt) {
    const s = ctx.shared;
    for (const p of ctx.players.values()) if (!p.$helmet) { addHelmet(p.avatar); p.$helmet = true; }

    // Ô bản vẽ: ẩn ô đã có khối; làm sáng ô cùng loại với khối đang cầm / đang treo trên cẩu
    const occ = new Set();
    for (const pr of ctx.props.values()) if (pr.data.slot != null) occ.add(pr.data.slot);
    ghosts.list.forEach((g, i) => { g.visible = !occ.has(i) && s.phase !== 'done'; });
    const held = ctx.self?.hold && ctx.props.get(ctx.self.hold.id);
    const hung = s.crane?.att && ctx.props.get(s.crane.att);
    ghosts.focus(isBlock(held) ? held.data.kind : isBlock(hung) ? hung.data.kind : null);

    // Cẩu, máy trộn, khu phố, pháo giấy
    stations.crane.update(s.crane, dt, hung ? hung.mesh.position : null, !!s.crane?.op);
    stations.mixer.update(s.mixer, dt);
    town.sync(s.town);
    updateConfetti(dt);

    if (!ctx.self) return;
    const op = operating(ctx);
    ctx.self.lockMove = op;
    ctx.$station = ctx.input.locked && !op ? aimStation(ctx) : null;

    // Lái cẩu: WASD theo hướng nhìn, Space lên, Shift xuống
    if (op && ctx.input.locked) {
      const i = ctx.input;
      const f = (i.down('KeyW') ? 1 : 0) - (i.down('KeyS') ? 1 : 0);
      const r = (i.down('KeyD') ? 1 : 0) - (i.down('KeyA') ? 1 : 0);
      const y = ctx.self.yaw;
      const sp = config.crane.speed;
      const v = {
        vx: Math.round((-Math.sin(y) * f + Math.cos(y) * r) * sp * 100) / 100,
        vz: Math.round((-Math.cos(y) * f - Math.sin(y) * r) * sp * 100) / 100,
        vy: (i.down('Space') ? 1 : 0) - (i.down('ShiftLeft') || i.down('ShiftRight') ? 1 : 0),
      };
      const moving = v.vx || v.vz || v.vy;
      const key = `${v.vx},${v.vz},${v.vy}`;
      ctx.$craneT = (ctx.$craneT ?? 0) + dt;
      if (key !== ctx.$craneKey || (moving && ctx.$craneT > 0.25)) {
        ctx.$craneKey = key;
        ctx.$craneT = 0;
        ctx.request('crane', v);
      }
      const hp = stations.crane.hook.position;
      const near = !s.crane.att && hookable(ctx, { x: hp.x, y: hp.y, z: hp.z }, (p) => p.mesh.position);
      ctx.ui.setCrosshair(!!(s.crane.att || near), s.crane.att ? '[Click] Release' : near ? `[Click] Hook ${B[near.data.kind]?.name ?? ''}` : '');
    } else if (ctx.$station && !ctx.self.hold) {
      const st = ctx.$station;
      if (st.dist < aimDist(ctx, ctx.aimedProp())) {
        const text = st.name === 'booth'
          ? (s.crane?.op ? '🏗️ Busy' : '[E] Crane')
          : `🌀 Mixer · 🪣 ${s.mixer?.mortar ?? 0}${s.mixer?.mixing ? ' · mixing…' : ''}`;
        ctx.ui.setCrosshair(true, text);
      }
    }

    // HUD
    if (!ctx.ui.hudBox) return;
    if (!hud) {
      hud = document.createElement('div');
      hud.className = 'fsf-chip';
      hud.style.cssText = 'font-size:18px;font-weight:800;line-height:1.6;min-width:140px';
      ctx.ui.hudBox.append(hud);
      opBar = document.createElement('div');
      opBar.style.cssText = 'position:absolute;left:50%;bottom:28px;transform:translateX(-50%);background:rgba(16,17,20,.8);padding:8px 14px;border-radius:12px;font-weight:600;white-space:nowrap';
      opBar.append(...keyChips('🏗️  [WASD] Move  [Space] Up  [Shift] Down  [Click] Hook  [E] Exit'));
      ctx.ui.root.append(opBar);
    }
    opBar.style.display = op ? 'block' : 'none';
    const t = s.elapsed ?? 0;
    const live = s.phase === 'done' ? s.stars : starsFor(t);
    const html = `⏱ ${fmtTime(t)} <span style="color:#ffd43b">${starText(live)}</span><br>🧱 ${s.placed ?? 0}/${SLOTS.length}<br>🪣 ${s.bonded ?? 0}/${SLOTS.length}`;
    if (hud.$html !== html) { hud.innerHTML = html; hud.$html = html; }

    const msg = {
      lobby: ctx.isHost ? '[G] Start   [B] +Bot' : 'Waiting for host…',
      done: ctx.isHost ? '[G] Next job' : '',
    }[s.phase] ?? '';
    ctx.ui.setCenter(msg, 'font-size:18px;font-weight:700');

    if (ctx.isHost && ctx.input.pressed('KeyG')) {
      if (s.phase === 'lobby') this.startRound(ctx);
      else if (s.phase === 'done') nextJob(ctx);
    }
    if (ctx.isHost && ctx.input.pressed('KeyB')) ctx.addBot();
  },
};

startApp(game);
