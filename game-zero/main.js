// Game Zero — "Dọn Nhà": khiêng đồ từ nhà ra xe tải trước khi hết giờ. Đồ va đập thì mất giá.
// Mục đích: kiểm thử toàn bộ kit (mạng, physics, khiêng chung, voice, bot).

import { startApp, yawTo } from 'kit/app.js';
import config from './config.js';

const FURNITURE = [
  ...Array.from({ length: 6 }, (_, i) => ({ name: 'Box', shape: 'box', size: [0.6, 0.6, 0.6], mass: 6, color: '#c8a26b', value: 20, pos: [-4.5 + (i % 3) * 0.7, 0.6 + Math.floor(i / 3) * 0.65, -10.8] })),
  { name: 'Lamp', shape: 'cylinder', size: [0.15, 1.2], mass: 3, color: '#ffe066', value: 80, fragile: true, pos: [4.8, 0.9, -11] },
  { name: 'Lamp', shape: 'cylinder', size: [0.15, 1.2], mass: 3, color: '#ffe066', value: 80, fragile: true, pos: [-5, 0.9, -5] },
  { name: 'TV', shape: 'box', size: [1.1, 0.7, 0.2], mass: 12, color: '#222831', value: 150, fragile: true, pos: [2, 0.6, -11.5] },
  { name: 'Vase', shape: 'ball', size: [0.2], mass: 2, color: '#4dabf7', value: 100, fragile: true, pos: [0, 0.6, -9] },
  { name: 'Chair', shape: 'box', size: [0.5, 0.9, 0.5], mass: 8, color: '#a0522d', value: 30, pos: [-1.5, 0.7, -7] },
  { name: 'Chair', shape: 'box', size: [0.5, 0.9, 0.5], mass: 8, color: '#a0522d', value: 30, pos: [1.5, 0.7, -7] },
  { name: 'Sofa', shape: 'box', size: [2.2, 0.8, 0.9], mass: 70, color: '#e8590c', value: 120, pos: [-3, 0.7, -8] },
  { name: 'Fridge', shape: 'box', size: [0.8, 1.8, 0.8], mass: 60, color: '#f1f3f5', value: 200, pos: [5, 1.2, -6] },
  { name: 'Piano', shape: 'box', size: [1.6, 1.3, 0.7], mass: 110, color: '#343a40', value: 300, pos: [3, 1, -8.5] },
];
const TOTAL = FURNITURE.reduce((s, f) => s + f.value, 0);

const inTruck = (p) => {
  const { min, max } = config.truck;
  return p.x > min[0] && p.x < max[0] && p.y > min[1] && p.y < max[1] && p.z > min[2] && p.z < max[2];
};

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function spawnFurniture(ctx) {
  for (const id of [...ctx.props.keys()]) ctx.removeProp(id);
  for (const f of FURNITURE) {
    ctx.spawnProp({
      shape: f.shape, size: f.size, pos: f.pos, mass: f.mass, color: f.color,
      data: { name: f.name, value: f.value, fragile: !!f.fragile },
    });
  }
}

function buildLevel(ctx) {
  // Mặt đất
  ctx.addStatic({ size: [80, 1, 80], pos: [0, -0.5, 0], color: '#7cb342' });
  ctx.addStatic({ size: [3.4, 0.02, 9], pos: [0, 0.01, 0.5], color: '#bfae8f', collide: false }); // lối đi

  // Nhà
  ctx.addStatic({ size: [12, 0.2, 8], pos: [0, 0.1, -8], color: '#d9b38c' });
  const wall = '#f4ede1';
  ctx.addStatic({ size: [12.4, 3, 0.2], pos: [0, 1.5, -12.1], color: wall });
  ctx.addStatic({ size: [0.2, 3, 8.2], pos: [-6.1, 1.5, -8], color: wall });
  ctx.addStatic({ size: [0.2, 3, 8.2], pos: [6.1, 1.5, -8], color: wall });
  ctx.addStatic({ size: [4.7, 3, 0.2], pos: [-3.85, 1.5, -3.9], color: wall });
  ctx.addStatic({ size: [4.7, 3, 0.2], pos: [3.85, 1.5, -3.9], color: wall });
  ctx.addStatic({ size: [3, 0.8, 0.2], pos: [0, 2.6, -3.9], color: wall });

  // Xe tải: thùng, vách, cabin, dốc lên
  const red = '#e03131';
  ctx.addStatic({ size: [4.2, 0.3, 5], pos: [0, 0.7, 8.5], color: '#868e96' });
  ctx.addStatic({ size: [0.2, 1.4, 5], pos: [-2.1, 1.55, 8.5], color: red });
  ctx.addStatic({ size: [0.2, 1.4, 5], pos: [2.1, 1.55, 8.5], color: red });
  ctx.addStatic({ size: [4.4, 1.4, 0.2], pos: [0, 1.55, 11.1], color: red });
  ctx.addStatic({ size: [4.2, 2.4, 2], pos: [0, 1.5, 12.3], color: red });
  ctx.addStatic({ size: [3.6, 0.8, 0.1], pos: [0, 2.1, 11.25], color: '#a5d8ff', collide: false });
  ctx.addStatic({ size: [3.4, 0.2, 2.3], pos: [0, 0.4, 4.95], rot: [-0.41, 0, 0], color: '#adb5bd' });
  for (const [x, z] of [[-2.1, 7], [2.1, 7], [-2.1, 11.5], [2.1, 11.5]]) {
    ctx.addStatic({ shape: 'cylinder', size: [0.5, 0.35], pos: [x, 0.5, z], rot: [0, 0, Math.PI / 2], color: '#212529', collide: false });
  }

  // Vài cái cây cho có cảnh
  for (const [x, z] of [[-12, 4], [11, -2], [-9, -16], [14, 10], [-15, 12]]) {
    ctx.addStatic({ shape: 'cylinder', size: [0.25, 2], pos: [x, 1, z], color: '#795548' });
    ctx.addStatic({ shape: 'ball', size: [1.4], pos: [x, 2.8, z], color: '#2f9e44' });
  }
}

// Dẫn đường đơn giản: qua cửa nhà (x≈0, z=-3.9) và lên dốc xe tải (x≈0, z≈4).
const insideHouse = (f) => f.z < -3.9 && Math.abs(f.x) < 6.1;
const DOOR_OUT = { x: 0, z: -2.4 };
const DOOR_IN = { x: 0, z: -5.4 };
function route(feet, goal) {
  if (insideHouse(feet) !== insideHouse(goal)) {
    const inDoorway = Math.abs(feet.x) < 1 && feet.z > -5.6 && feet.z < -2.2;
    if (inDoorway) return insideHouse(feet) ? DOOR_OUT : DOOR_IN;
    return insideHouse(feet) ? DOOR_IN : DOOR_OUT;
  }
  // Lên xe: canh thẳng dốc trước
  if (goal.z > 6 && feet.z < 4.2 && Math.abs(feet.x) > 0.8) return { x: 0, z: 3 };
  return goal;
}

/** Bot: chọn món gần nhất chưa lên xe, đi tới, cầm, mang lên xe, thả. */
function botBrain(ctx, bot, dt) {
  const m = bot.memory;
  const feet = bot.feet();
  const playing = ctx.shared.phase === 'playing';

  // Kẹt thì nhảy
  m.stuckT = (m.stuckT ?? 0) + dt;
  if (m.stuckT > 1.2) {
    m.jump = m.last && Math.hypot(feet.x - m.last.x, feet.z - m.last.z) < 0.3;
    m.last = feet;
    m.stuckT = 0;
  }
  const jump = !!m.jump && Math.random() < 0.1;

  if (!playing) return { yaw: bot.yaw, pitch: 0, release: true };

  if (bot.hold) {
    const pos = ctx.propPosition(bot.hold.id);
    if (!pos || inTruck(pos)) { m.target = null; return { release: true, yaw: bot.yaw, pitch: 0 }; }
    const goal = route(feet, { x: 0, z: 9.5 });
    return { yaw: yawTo(feet, goal), pitch: -0.15, moveZ: 1, jump };
  }

  if (!m.target || !ctx.props.has(m.target) || inTruck(ctx.propPosition(m.target))) {
    let best = null, bestD = Infinity;
    for (const pr of ctx.props.values()) {
      if (pr.spec.mass <= 45 && ctx.holders(pr.id) > 0) continue; // đồ nhẹ người khác đang cầm thì thôi
      if (pr.spec.mass > 45 && ctx.holders(pr.id) === 0 && Math.random() < 0.7) continue; // đồ nặng: ưu tiên phụ người đang khiêng
      const p = ctx.propPosition(pr.id);
      if (inTruck(p)) continue;
      const d = Math.hypot(p.x - feet.x, p.z - feet.z);
      if (d < bestD) { bestD = d; best = pr.id; }
    }
    m.target = best;
  }
  if (!m.target) return { yaw: bot.yaw, pitch: 0 };
  const p = ctx.propPosition(m.target);
  const d = Math.hypot(p.x - feet.x, p.z - feet.z);
  if (d < 1.5) return { yaw: yawTo(feet, p), pitch: -0.5, grab: m.target };
  const next = route(feet, p);
  return { yaw: yawTo(feet, next), pitch: 0, moveZ: 1, sprint: d > 6 && next === p, jump };
}

let hud;

startApp({
  id: 'game-zero',
  title: 'Moving Day',
  subtitle: 'Load the truck. Don’t break stuff.',
  config,
  botBrain,
  // Góc chụp ảnh bìa: từ sân nhìn về cửa nhà, thấy cả xe tải
  thumbnail: { camera: [-9, 5, 6], target: [1.5, 0.8, -3], fov: 55 },

  setup(ctx) {
    buildLevel(ctx);
  },

  // Host: bắt đầu ở sảnh, đồ đã bày sẵn để nghịch thử
  start(ctx) {
    ctx.setShared({ phase: 'lobby', timeLeft: config.round.seconds, truck: 0, quota: config.round.quota });
    spawnFurniture(ctx);
  },

  hostUpdate(ctx, dt) {
    const s = ctx.shared;
    ctx.$acc = (ctx.$acc ?? 0) + dt;
    if (ctx.$acc < 0.5) return;
    ctx.$acc = 0;
    let truck = 0;
    for (const pr of ctx.props.values()) if (inTruck(pr.body.translation())) truck += pr.data.value;
    const patch = {};
    if (truck !== s.truck) patch.truck = truck;
    if (s.phase === 'playing') {
      patch.timeLeft = Math.max(0, s.timeLeft - 0.5);
      if (patch.timeLeft === 0) {
        patch.phase = 'end';
        ctx.setShared(patch);
        ctx.emit('end', { truck, quota: s.quota, win: truck >= s.quota });
        return;
      }
    }
    if (Object.keys(patch).length) ctx.setShared(patch);
  },

  onImpact(ctx, prop, speed) {
    if (ctx.shared.phase !== 'playing' || prop.data.value <= 0) return;
    const excess = speed - ctx.config.physics.impactSpeed;
    const dmg = Math.round(excess * (prop.data.fragile ? config.damage.fragileMul : config.damage.normalMul));
    if (dmg < 2) return;
    const value = Math.max(0, prop.data.value - dmg);
    ctx.setPropData(prop.id, { value });
    ctx.emit('damage', { name: prop.data.name, dmg: prop.data.value - value, broken: value === 0 });
  },

  onPropData(ctx, prop) {
    if (prop.data.value === 0) prop.mesh.material.color.set('#495057');
  },

  onEvent(ctx, type, data) {
    if (type === 'damage') ctx.ui.toast(data.broken ? `💥 ${data.name} broke!` : `${data.name} −${data.dmg}$`);
    if (type === 'end') {
      ctx.ui.modal({
        title: data.win ? '🎉 Quota met!' : '📦 Fired!',
        body: `🚚 ${data.truck}$ / ${data.quota}$`,
        buttons: [{ text: 'OK', primary: true }],
      });
    }
    if (type === 'start') ctx.ui.toast('Go! Load the truck!');
  },

  aimPrompt(ctx, prop) {
    const heavy = prop.spec.mass > 100 ? ' 👥👥' : prop.spec.mass > 45 ? ' 👥' : '';
    return `[E] ${prop.data.name} · ${prop.data.value}$${heavy}`;
  },

  update(ctx) {
    if (!ctx.ui.hudBox) return;
    if (!hud) {
      hud = document.createElement('div');
      hud.className = 'fsf-chip';
      hud.style.cssText = 'font-size:18px;font-weight:700;line-height:1.5';
      ctx.ui.hudBox.append(hud);
    }
    const s = ctx.shared;
    hud.innerHTML = `⏱ ${fmtTime(s.timeLeft ?? 0)}<br>🚚 ${s.truck ?? 0}$ / ${s.quota ?? 0}$`;

    const msg = s.phase === 'playing' ? '' : ctx.isHost ? '[G] Start   [B] +Bot' : 'Waiting for host…';
    ctx.ui.setCenter(msg, 'font-size:18px;font-weight:700');

    if (ctx.isHost && s.phase !== 'playing' && ctx.input.pressed('KeyG')) this.startRound(ctx);
    if (ctx.isHost && ctx.input.pressed('KeyB')) ctx.addBot();
  },

  // Host
  startRound(ctx) {
    spawnFurniture(ctx);
    ctx.setShared({ phase: 'playing', timeLeft: config.round.seconds, truck: 0 });
    ctx.emit('start');
  },
});
