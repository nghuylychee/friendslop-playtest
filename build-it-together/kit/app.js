// Lõi của kit: ghép mạng + physics + nhân vật + cầm đồ + voice + bot thành một API cho game.
// Game chỉ cần gọi startApp({...}) với các hook. Xem kit/README.md.

import * as THREE from 'three';
import { Room } from './net.js';
import { createRenderer, primitiveMesh } from './render.js';
import { Input } from './input.js';
import { initPhysics, createWorld, colliderDesc, quatFromEuler, rotate, inverseRotate, RAPIER } from './physics.js';
import { Avatar, Character, proxyBody, BODY, FirstPersonHands } from './player.js';
import { Voice } from './voice.js';
import { UI } from './ui.js';
import { PLAYER_COLORS, mergeConfig, params, lerp, lerpAngle, round, clamp } from './util.js';

export const DEFAULT_CONFIG = {
  maxPlayers: 4,
  // impactSpeed: prop va chạm nhanh hơn ngần này (m/s) thì gọi game.onImpact(ctx, prop, speed)
  // solverIterations: tăng khi xếp chồng nhiều vật / có khớp. weldBreak: khớp lệch quá (m) thì gãy
  physics: { gravity: 9.81, hz: 60, impactSpeed: 3.5, impactCooldown: 0.25, solverIterations: 4, weldBreak: 0.06 },
  player: { walkSpeed: 4, sprintSpeed: 6.5, jumpSpeed: 5.2, reach: 2.8, spawn: [0, 0, 0], spawnSpread: 1.5 },
  // Lực kéo đồ: mỗi người tối đa maxForce (N). Đồ nặng hơn sức một người thì phải khiêng chung.
  // maxAccel giới hạn gia tốc khi cầm để đồ nhẹ không bị giật văng.
  grab: { key: 'KeyE', stiffness: 60, damping: 14, maxForce: 450, maxAccel: 30, holdDist: 1.8, minDist: 1.1, maxDist: 3, breakDist: 2.2, throwImpulse: 7 },
  net: { sendHz: 20, interpDelay: 0.1 },
  voice: { enabled: true, fullVolumeDist: 4, maxDist: 25 },
};

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

/** Bộ đệm nội suy snapshot. */
class Interp {
  constructor() { this.s = []; }
  push(t, v) {
    this.s.push({ t, v });
    if (this.s.length > 40) this.s.shift();
  }
  /** Trả mảng nội suy tại thời điểm t. quatAt: vị trí bắt đầu quaternion (4 số), angleAt: vị trí góc. */
  sample(t, { quatAt = -1, angleAt = [] } = {}) {
    const s = this.s;
    if (!s.length) return null;
    if (t <= s[0].t) return s[0].v;
    let i = s.length - 1;
    while (i > 0 && s[i].t > t) i--;
    const a = s[i], b = s[i + 1];
    if (!b) return a.v;
    const k = (t - a.t) / Math.max(b.t - a.t, 1e-4);
    const out = a.v.map((x, j) => (angleAt.includes(j) ? lerpAngle(x, b.v[j], k) : lerp(x, b.v[j], k)));
    if (quatAt >= 0) {
      _q.fromArray(a.v, quatAt);
      _q2.fromArray(b.v, quatAt);
      _q.slerp(_q2, k).toArray(out, quatAt);
    }
    return out;
  }
}

/** 'KeyE' → 'E', 'Space' → 'Space' (để hiện trong prompt). */
export const keyName = (code) => code.replace(/^Key|^Digit/, '');

/** Góc yaw để nhìn từ `from` tới `to` (forward = -Z). */
export function yawTo(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

export function lookDir(yaw, pitch) {
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
}

/** Bot mặc định: đi lang thang quanh điểm spawn. */
function wanderBrain(ctx, bot, dt) {
  const m = bot.memory;
  m.t = (m.t ?? 0) - dt;
  const feet = bot.feet();
  if (m.t <= 0 || !m.target) {
    const [sx, , sz] = ctx.config.player.spawn;
    m.target = { x: sx + (Math.random() - 0.5) * 16, z: sz + (Math.random() - 0.5) * 16 };
    m.t = 3 + Math.random() * 3;
  }
  const dist = Math.hypot(m.target.x - feet.x, m.target.z - feet.z);
  return { yaw: yawTo(feet, m.target), pitch: 0, moveZ: dist > 0.8 ? 1 : 0, jump: Math.random() < 0.005 };
}

export async function startApp(game) {
  const ctx = new GameContext(game);
  await ctx.init();
  window.fsf = ctx; // để debug & test headless
  return ctx;
}

export class GameContext {
  constructor(game) {
    this.game = game;
    this.config = mergeConfig(DEFAULT_CONFIG, game.config);
    this.THREE = THREE;
    this.q = params();
    this.autobot = this.q.get('bot') === '1';
    this.noRender = this.q.get('norender') === '1'; // test headless: bỏ vẽ cho nhẹ CPU
    this.shot = this.q.get('shot') === '1'; // chế độ chụp thumbnail: ẩn UI, camera cố định theo game.thumbnail
    /** @type {Map<string, any>} */
    this.players = new Map();
    /** @type {Map<string, any>} */
    this.props = new Map();
    this.shared = {};
    this.time = 0;
    this.isHost = false;
    this.started = false;
    this.#colliderToProp = new Map();
    this.#nextProp = 1;
    this.#nextBot = 1;
  }

  #colliderToProp;
  #nextProp;
  #nextBot;
  #sendAcc = 0;
  #listAcc = 0;
  #impactAt = new Map();
  /** Khớp hàn (chỉ trên host): [{ joint, a, b, anchor }] */
  #welds = [];
  #worldBody = null;
  /** propId → thời điểm hết chặn cầm (sau forceRelease) */
  #noHoldUntil = new Map();
  /** propId → Set handle collider của những người đang cầm (để tắt va chạm giữa đồ và người cầm nó) */
  #heldBy = new Map();
  #hooks = {
    filterContactPair: (c1, c2) => {
      const pid = this.#colliderToProp.get(c1) ?? this.#colliderToProp.get(c2);
      if (pid) {
        const other = this.#colliderToProp.has(c1) ? c2 : c1;
        if (this.#heldBy.get(pid)?.has(other)) return null;
      }
      return RAPIER.SolverFlags.COMPUTE_IMPULSE;
    },
    filterIntersectionPair: () => true,
  };

  // ------------------------------------------------------------------ khởi động

  async init() {
    const canvas = document.querySelector('canvas#game') ?? document.body.appendChild(Object.assign(document.createElement('canvas'), { id: 'game' }));
    Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', display: 'block' });
    Object.assign(this, createRenderer({ canvas, ...(this.game.render ?? {}) }));
    this.canvas = canvas;
    this.input = new Input(canvas);
    this.ui = new UI({ title: this.game.title, subtitle: this.game.subtitle });

    await initPhysics();
    this.world = createWorld(-this.config.physics.gravity);
    const ip = this.world.integrationParameters;
    if (ip && 'numSolverIterations' in ip) ip.numSolverIterations = this.config.physics.solverIterations;
    this.events = new RAPIER.EventQueue(true);

    // Level tĩnh (mọi peer dựng giống nhau)
    await this.game.setup?.(this);
    this.camera.position.set(8, 6, 12);
    this.camera.lookAt(0, 1, 0);
    if (!this.noRender) this.renderer.setAnimationLoop(() => this.renderer.render(this.scene, this.camera)); // nền sau sảnh

    await this.ui.lobby((choice) => this.#connect(choice));
    this.#enterGame();
  }

  async #connect({ mode, name, code }) {
    const gameId = this.game.id;
    this.selfName = name;
    if (mode === 'host') {
      this.room = await Room.host({ gameId, name });
      this.isHost = true;
      this.selfId = this.room.selfId;
      return;
    }
    this.room = await Room.join({ gameId, code, name });
    this.selfId = this.room.selfId;
    // Chờ host chào
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Host not responding.')), 10000);
      const off = this.room.on('message', ({ type, data }) => {
        if (type === '$reject') { clearTimeout(timer); off(); this.room.close(); reject(new Error(data.reason)); }
        if (type === '$welcome') { clearTimeout(timer); off(); this.#applyWelcome(data); resolve(); }
      });
    });
  }

  #enterGame() {
    const room = this.room;
    const link = `${location.origin}${location.pathname}?room=${room.code}`;
    history.replaceState(null, '', `?room=${room.code}`);
    this.ui.hud({ code: room.code, link, isHost: this.isHost });
    if (this.shot) this.ui.root.style.display = 'none';
    this.ui.setLocked(this.autobot);
    this.ui.clickLayer.addEventListener('click', () => {
      this.input.lock();
      this.voice?.audio.resume();
    });
    document.addEventListener('pointerlockchange', () => this.ui.setLocked(this.input.locked || this.autobot));

    room.on('message', (m) => this.#onMessage(m));
    if (this.isHost) {
      room.on('peer-join', (p) => this.#hostJoin(p));
      room.on('peer-leave', (p) => this.#hostLeave(p.id));
      this.#addPlayer({ id: this.selfId, name: this.selfName, color: PLAYER_COLORS[0], isBot: false });
      this.game.start?.(this);
      const bots = Number(this.q.get('bots') || 0);
      for (let i = 0; i < bots; i++) this.addBot();
    } else {
      room.on('host-lost', () => this.ui.fatal('The host left.'));
    }

    // Voice
    if (this.config.voice.enabled && this.q.get('novoice') !== '1') {
      this.voice = new Voice(room.peer, this.config.voice);
      this.voice.on('ready', () => this.voice.connectTo(this.#humanPeerIds()));
      this.voice.on('mic', ({ ok }) => {
        if (!ok) this.ui.toast('🎙️ No mic: listen only');
      });
      this.voice.start();
    }

    this.started = true;
    this.#refreshList();
    this.ui.toast(`Room ${room.code}`);

    // Mô phỏng chạy theo nhịp của Worker (không bị dừng khi tab ẩn, khác với requestAnimationFrame),
    // để chủ phòng chuyển sang tab khác thì phòng vẫn chạy. rAF chỉ lo vẽ.
    let last = performance.now();
    let acc = 0;
    const fixed = 1 / this.config.physics.hz;
    this.ticks = { worker: 0, raf: 0, timer: 0, steps: 0, stepMs: 0, frameMs: 0, workerError: null };
    const tick = () => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      acc += dt;
      let steps = 0;
      while (acc >= fixed && steps < 15) {
        this.ticks.steps++;
        acc -= fixed;
        steps++;
        const t0 = performance.now();
        try {
          this.#fixedStep(fixed);
          this.ticks.stepMs += performance.now() - t0;
        } catch (err) {
          // Một bước lỗi không được làm chết cả vòng lặp
          this.lastError = `${err?.message}\n${err?.stack ?? ''}`;
          if ((this.errorCount = (this.errorCount ?? 0) + 1) <= 3) console.error('[kit] fixedStep lỗi:', err);
        }
      }
      if (steps === 15) acc = 0;
    };
    // Giữ tham chiếu trên ctx để worker không bị thu gom
    this.worker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 8)'], { type: 'text/javascript' })));
    this.worker.onmessage = () => { this.ticks.worker++; tick(); };
    this.worker.onerror = (e) => { this.ticks.workerError = e.message || 'error'; };
    // Dự phòng thứ ba: timer luồng chính (bị giới hạn khi tab ẩn, nhưng không phụ thuộc vẽ hình)
    setInterval(() => { this.ticks.timer++; tick(); }, 16);
    let lastFrame = performance.now();
    this.renderer.setAnimationLoop((now) => {
      this.ticks.raf++;
      tick();
      const dt = Math.min((now - lastFrame) / 1000, 0.1);
      lastFrame = now;
      const f0 = performance.now();
      try {
        this.#frame(dt);
        this.ticks.frameMs += performance.now() - f0;
      } catch (err) {
        this.lastError = `${err?.message}\n${err?.stack ?? ''}`;
        if ((this.errorCount = (this.errorCount ?? 0) + 1) <= 3) console.error('[kit] frame lỗi:', err);
      }
    });
  }

  // ------------------------------------------------------------------ người chơi

  #spawnPoint(index) {
    const [x, y, z] = this.config.player.spawn;
    const a = index * 2.1;
    const r = index === 0 ? 0 : this.config.player.spawnSpread;
    return { x: x + Math.cos(a) * r, y, z: z + Math.sin(a) * r };
  }

  #addPlayer({ id, name, color, isBot }) {
    if (this.players.has(id)) return this.players.get(id);
    const isSelf = id === this.selfId;
    const index = this.players.size;
    const feet = this.#spawnPoint(index);
    const p = {
      id, name, color, isBot, isSelf,
      yaw: 0, pitch: 0,
      pose: [feet.x, feet.y, feet.z, 0, 0],
      hold: null, // { id, lp:{x,y,z}, dist } — chỉ có ở peer điều khiển người này
      remoteHold: null, // host: hold do client gửi lên { id, lp, tp }
      memory: {},
      buf: new Interp(),
      avatar: new Avatar(this.scene, { name, color }),
    };
    const controlledHere = isSelf || (isBot && this.isHost);
    if (controlledHere) {
      p.character = new Character(this.world, feet, this.config);
      p.feet = () => p.character.feet();
      p.eye = () => p.character.eye();
    } else {
      p.proxy = proxyBody(this.world, feet);
      p.feet = () => ({ x: p.pose[0], y: p.pose[1], z: p.pose[2] });
      p.eye = () => ({ x: p.pose[0], y: p.pose[1] + BODY.eye, z: p.pose[2] });
    }
    if (isSelf && !this.shot) {
      p.avatar.setVisible(false);
      if (!this.autobot) this.hands = new FirstPersonHands(this.camera, color, this.config.player.glove);
    }
    if (this.shot) p.avatar.tag.visible = false;
    this.players.set(id, p);
    this.#refreshList();
    return p;
  }

  #removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.avatar.dispose();
    p.character?.dispose();
    p.proxy?.dispose();
    this.players.delete(id);
    this.voice?.drop(id);
    this.#refreshList();
  }

  #roster() {
    return [...this.players.values()].map(({ id, name, color, isBot }) => ({ id, name, color, isBot }));
  }

  #humanPeerIds() {
    return [...this.players.values()].filter((p) => !p.isBot && !p.isSelf).map((p) => p.id);
  }

  #nextColor() {
    const used = new Set([...this.players.values()].map((p) => p.color));
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[this.players.size % PLAYER_COLORS.length];
  }

  #hostJoin({ id, name }) {
    if (this.players.size >= this.config.maxPlayers) {
      this.room.send(id, '$reject', { reason: 'Room is full.' });
      setTimeout(() => this.room.kick(id), 300);
      return;
    }
    const p = this.#addPlayer({ id, name, color: this.#nextColor(), isBot: false });
    this.room.send(id, '$welcome', {
      roster: this.#roster(),
      props: [...this.props.values()].map((pr) => this.#propSnapshotSpec(pr)),
      shared: this.shared,
    });
    this.room.broadcast('$roster', this.#roster(), id);
    this.ui.toast(`${name} joined`);
    this.game.onPlayerJoin?.(this, p);
  }

  #hostLeave(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.#removePlayer(id);
    this.room.broadcast('$roster', this.#roster());
    this.ui.toast(`${p.name} left`);
    this.game.onPlayerLeave?.(this, p);
  }

  #syncRoster(roster) {
    const ids = new Set(roster.map((r) => r.id));
    for (const id of [...this.players.keys()]) {
      if (!ids.has(id)) {
        const name = this.players.get(id).name;
        this.#removePlayer(id);
        this.ui.toast(`${name} left`);
      }
    }
    for (const r of roster) {
      if (!this.players.has(r.id)) {
        this.#addPlayer(r);
        if (this.started && r.id !== this.selfId) this.ui.toast(`${r.name} joined`);
      }
    }
    this.voice?.connectTo(this.#humanPeerIds());
  }

  #applyWelcome({ roster, props, shared }) {
    this.shared = shared ?? {};
    // Người chơi được tạo theo thứ tự host gửi để vị trí spawn khớp
    for (const r of roster) this.#addPlayer(r);
    for (const spec of props) this.#createProp(spec);
  }

  /** Host: thêm bot (chạy trên host, bộ não là game.botBrain hoặc đi lang thang). */
  addBot(name) {
    if (!this.isHost) return null;
    const id = `bot-${this.#nextBot++}`;
    const p = this.#addPlayer({ id, name: name ?? `Bot ${this.#nextBot - 1}`, color: this.#nextColor(), isBot: true });
    this.room.broadcast('$roster', this.#roster());
    return p;
  }

  removeBot(id) {
    if (!this.isHost || !this.players.get(id)?.isBot) return;
    this.#removePlayer(id);
    this.room.broadcast('$roster', this.#roster());
  }

  get self() {
    return this.players.get(this.selfId);
  }

  // ------------------------------------------------------------------ level & prop

  /** Thêm vật tĩnh (mọi peer). shape: box | ball | cylinder. */
  addStatic({ shape = 'box', size = [1, 1, 1], pos = [0, 0, 0], rot = [0, 0, 0], color = '#cccccc', visible = true, collide = true, friction = 0.9 }) {
    let mesh = null;
    if (visible) {
      mesh = primitiveMesh({ shape, size, color });
      mesh.position.fromArray(pos);
      mesh.rotation.set(rot[0], rot[1], rot[2]);
      this.scene.add(mesh);
    }
    if (collide) {
      const q = quatFromEuler(rot);
      this.world.createCollider(colliderDesc({ shape, size }).setTranslation(pos[0], pos[1], pos[2]).setRotation(q).setFriction(friction));
    }
    return mesh;
  }

  /**
   * Host: tạo vật có physics, đồng bộ cho mọi người.
   * spec: { shape, size, pos, rot, mass, color, data: {...tuỳ game} }
   */
  spawnProp(spec) {
    if (!this.isHost) throw new Error('spawnProp chỉ gọi trên host');
    const full = { id: `p${this.#nextProp++}`, shape: 'box', size: [0.6, 0.6, 0.6], pos: [0, 2, 0], rot: [0, 0, 0], mass: 5, color: '#c8a26b', data: {}, ...spec };
    const q = quatFromEuler(full.rot);
    full.q = [q.x, q.y, q.z, q.w];
    this.#createProp(full);
    this.room?.broadcast('$spawn', full);
    return full.id;
  }

  removeProp(id) {
    if (!this.isHost) return;
    this.#destroyProp(id);
    this.room.broadcast('$despawn', id);
  }

  setPropData(id, patch) {
    const pr = this.props.get(id);
    if (!pr || !this.isHost) return;
    Object.assign(pr.data, patch);
    this.room.broadcast('$pdata', { id, patch });
    this.game.onPropData?.(this, pr, patch);
  }

  /** Host: dịch chuyển prop tức thì. */
  teleportProp(id, pos, rot) {
    const pr = this.props.get(id);
    if (!pr || !this.isHost) return;
    pr.body.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
    if (rot) pr.body.setRotation(quatFromEuler(rot), true);
    pr.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    pr.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Vị trí prop theo dữ liệu mô phỏng (không phụ thuộc việc tab có đang vẽ hay không). */
  propPosition(id) {
    const pr = this.props.get(id);
    if (!pr) return null;
    if (this.isHost) return pr.body.translation();
    const s = pr.sampled;
    return s ? { x: s[0], y: s[1], z: s[2] } : { x: pr.spec.pos[0], y: pr.spec.pos[1], z: pr.spec.pos[2] };
  }

  #createProp(spec) {
    if (this.props.has(spec.id)) return;
    const q = spec.q ? { x: spec.q[0], y: spec.q[1], z: spec.q[2], w: spec.q[3] } : quatFromEuler(spec.rot);
    const desc = this.isHost ? RAPIER.RigidBodyDesc.dynamic().setLinearDamping(0.1).setAngularDamping(0.3) : RAPIER.RigidBodyDesc.kinematicPositionBased();
    const body = this.world.createRigidBody(desc.setTranslation(spec.pos[0], spec.pos[1], spec.pos[2]).setRotation(q).setCcdEnabled(true));
    const cd = colliderDesc(spec).setMass(spec.mass).setFriction(0.8).setRestitution(0.1);
    if (this.isHost) cd.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    const collider = this.world.createCollider(cd, body);
    const mesh = this.game.propMesh?.(spec, this) ?? primitiveMesh(spec);
    mesh.position.fromArray(spec.pos);
    mesh.quaternion.set(q.x, q.y, q.z, q.w);
    mesh.userData.propId = spec.id;
    this.scene.add(mesh);
    const pr = { id: spec.id, spec, data: structuredClone(spec.data ?? {}), body, collider, mesh, buf: new Interp() };
    this.props.set(spec.id, pr);
    this.#colliderToProp.set(collider.handle, spec.id);
    this.game.onPropSpawn?.(this, pr);
  }

  #destroyProp(id) {
    const pr = this.props.get(id);
    if (!pr) return;
    for (const p of this.players.values()) if (p.hold?.id === id) this.#release(p);
    this.#colliderToProp.delete(pr.collider.handle);
    this.#welds = this.#welds.filter((w) => w.a !== id && w.b !== id); // Rapier tự gỡ khớp khi xoá body
    this.world.removeRigidBody(pr.body);
    pr.mesh.removeFromParent();
    this.props.delete(id);
  }

  #propSnapshotSpec(pr) {
    const t = pr.body.translation();
    const r = pr.body.rotation();
    return { ...pr.spec, data: pr.data, pos: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] };
  }

  // ------------------------------------------------------------------ cầm đồ

  /** Bắt đầu cầm prop. point: điểm cầm (toạ độ thế giới), mặc định tâm vật. */
  grab(player, propId, point) {
    const pr = this.props.get(propId);
    if (!pr) return;
    if (this.isHost && (this.#noHoldUntil.get(propId) ?? 0) > this.time) return;
    const pos = pr.mesh.position;
    const gp = pr.spec.grabPoint;
    const lp = gp ? { x: gp[0], y: gp[1], z: gp[2] }
      : point ? inverseRotate(pr.mesh.quaternion, { x: point.x - pos.x, y: point.y - pos.y, z: point.z - pos.z }) : { x: 0, y: 0, z: 0 };
    const eye = player.eye();
    const dist = pr.spec.holdDist ?? clamp(Math.hypot(pos.x - eye.x, pos.y - eye.y, pos.z - eye.z), this.config.grab.minDist, this.config.grab.maxDist);
    player.hold = { id: propId, lp, dist };
    if (player.character) player.character.ignoreCollider = pr.collider;
  }

  #release(player) {
    player.hold = null;
    if (player.character) player.character.ignoreCollider = null;
  }

  release(player) {
    this.#release(player);
  }

  /**
   * Host: hàn cứng prop `a` vào prop `b` (hoặc vào mặt đất nếu b = null) ở tư thế hiện tại.
   * Khớp tự gãy khi hai điểm neo lệch quá physics.weldBreak (m) → game.onWeldBreak(ctx, a, b).
   */
  weld(aId, bId = null) {
    if (!this.isHost) return false;
    const a = this.props.get(aId);
    const b = bId ? this.props.get(bId) : null;
    if (!a || (bId && !b)) return false;
    if (this.#welds.some((w) => (w.a === aId && w.b === bId) || (w.a === bId && w.b === aId))) return false;
    this.#worldBody ??= this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const ta = a.body.translation(), qa = a.body.rotation();
    const tb = b ? b.body.translation() : { x: 0, y: 0, z: 0 };
    const qb = b ? b.body.rotation() : { x: 0, y: 0, z: 0, w: 1 };
    const anchor = inverseRotate(qb, { x: ta.x - tb.x, y: ta.y - tb.y, z: ta.z - tb.z });
    // khung khớp trong b = conj(qb) * qa
    const cx = -qb.x, cy = -qb.y, cz = -qb.z, cw = qb.w;
    const frame = {
      w: cw * qa.w - cx * qa.x - cy * qa.y - cz * qa.z,
      x: cw * qa.x + cx * qa.w + cy * qa.z - cz * qa.y,
      y: cw * qa.y - cx * qa.z + cy * qa.w + cz * qa.x,
      z: cw * qa.z + cx * qa.y - cy * qa.x + cz * qa.w,
    };
    const data = RAPIER.JointData.fixed({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, anchor, frame);
    const joint = this.world.createImpulseJoint(data, a.body, b ? b.body : this.#worldBody, true);
    this.#welds.push({ joint, a: aId, b: bId, anchor });
    return true;
  }

  /** Host: gỡ mọi khớp của prop (hoặc chỉ khớp a–b). */
  unweld(aId, bId) {
    if (!this.isHost) return;
    this.#welds = this.#welds.filter((w) => {
      const hit = bId === undefined ? (w.a === aId || w.b === aId) : (w.a === aId && w.b === bId) || (w.a === bId && w.b === aId);
      if (hit && this.world.impulseJoints.contains?.(w.joint.handle) !== false) this.world.removeImpulseJoint(w.joint, true);
      return !hit;
    });
  }

  /** Số khớp đang giữ prop (host). */
  weldCount(id) {
    return this.#welds.filter((w) => w.a === id || w.b === id).length;
  }

  #checkWelds() {
    const limit = this.config.physics.weldBreak;
    const broken = [];
    for (const w of this.#welds) {
      const a = this.props.get(w.a);
      const b = w.b ? this.props.get(w.b) : null;
      if (!a) continue;
      const ta = a.body.translation();
      let pb = w.anchor;
      if (b) {
        const tb = b.body.translation();
        const r = rotate(b.body.rotation(), w.anchor);
        pb = { x: tb.x + r.x, y: tb.y + r.y, z: tb.z + r.z };
      }
      if (Math.hypot(ta.x - pb.x, ta.y - pb.y, ta.z - pb.z) > limit) broken.push(w);
    }
    for (const w of broken) {
      this.world.removeImpulseJoint(w.joint, true);
      this.#welds.splice(this.#welds.indexOf(w), 1);
      this.game.onWeldBreak?.(this, w.a, w.b);
    }
  }

  /** Host: bắt mọi người đang cầm prop này thả ra (vd khi vật đã vào vị trí). */
  forceRelease(propId, seconds = 0.6) {
    if (!this.isHost) return;
    this.#noHoldUntil.set(propId, this.time + seconds);
    for (const p of this.players.values()) {
      if (p.hold?.id === propId) this.#release(p);
      if (p.remoteHold?.id === propId) p.remoteHold = null;
    }
    this.room.broadcast('$release', { id: propId });
  }

  /** Số người đang cầm một prop (chính xác trên host; trên client chỉ biết mình). */
  holders(propId) {
    let n = 0;
    for (const p of this.players.values()) if (p.hold?.id === propId || p.remoteHold?.id === propId) n++;
    return n;
  }

  /** Những người đang cầm prop (host: đầy đủ; client: theo snapshot). */
  holdersOf(propId) {
    return [...this.players.values()].filter((p) => (p.hold?.id ?? p.remoteHold?.id ?? p.holding) === propId);
  }

  throwHeld(player) {
    const h = player.hold;
    if (!h) return;
    const dir = lookDir(player.yaw, player.pitch);
    this.#release(player);
    if (this.isHost) this.#applyThrow(h.id, dir);
    else this.room.toHost('$throw', { id: h.id, dir });
  }

  #applyThrow(id, dir) {
    const pr = this.props.get(id);
    if (!pr) return;
    const m = pr.body.mass();
    const imp = this.config.grab.throwImpulse * Math.min(m, 15);
    pr.body.applyImpulse({ x: dir.x * imp, y: dir.y * imp + imp * 0.2, z: dir.z * imp }, true);
  }

  #holdTarget(player) {
    const e = player.eye();
    const d = lookDir(player.yaw, player.pitch);
    const dist = player.hold.dist;
    // spec.holdOffset [phải, lên] (m): cầm lệch sang tay phải như dụng cụ
    const off = this.props.get(player.hold.id)?.spec.holdOffset;
    const ox = off ? Math.cos(player.yaw) * off[0] : 0;
    const oz = off ? -Math.sin(player.yaw) * off[0] : 0;
    const oy = off ? off[1] : 0;
    return { x: e.x + d.x * dist + ox, y: e.y + d.y * dist + oy, z: e.z + d.z * dist + oz };
  }

  /** Host: kéo prop về điểm mục tiêu bằng lò xo, giới hạn lực mỗi người. */
  #applyHold(propId, lp, tp, dt) {
    const pr = this.props.get(propId);
    if (!pr) return;
    const g = this.config.grab;
    const body = pr.body;
    const t = body.translation();
    const r = rotate(body.rotation(), lp);
    const wp = { x: t.x + r.x, y: t.y + r.y, z: t.z + r.z };
    const lv = body.linvel();
    const av = body.angvel();
    // vận tốc tại điểm cầm = v + ω × r
    const pv = { x: lv.x + av.y * r.z - av.z * r.y, y: lv.y + av.z * r.x - av.x * r.z, z: lv.z + av.x * r.y - av.y * r.x };
    const m = body.mass();
    let fx = (g.stiffness * (tp.x - wp.x) - g.damping * pv.x) * m;
    let fy = (g.stiffness * (tp.y - wp.y) - g.damping * pv.y) * m + m * this.config.physics.gravity * 0.5;
    let fz = (g.stiffness * (tp.z - wp.z) - g.damping * pv.z) * m;
    const f = Math.hypot(fx, fy, fz);
    const fMax = Math.min(g.maxForce, m * g.maxAccel);
    if (f > fMax) { const k = fMax / f; fx *= k; fy *= k; fz *= k; }
    body.applyImpulseAtPoint({ x: fx * dt, y: fy * dt, z: fz * dt }, wp, true);
    body.setAngvel({ x: av.x * 0.92, y: av.y * 0.92, z: av.z * 0.92 }, true);
  }

  // ------------------------------------------------------------------ trạng thái chung & sự kiện

  /** Host: cập nhật trạng thái chung (điểm, thời gian, giai đoạn…). Mọi người đọc qua ctx.shared. */
  setShared(patch) {
    if (!this.isHost) return;
    Object.assign(this.shared, patch);
    this.room.broadcast('$shared', patch);
    this.game.onShared?.(this, patch);
  }

  /** Host: phát sự kiện tới mọi người (kể cả chính host). */
  emit(type, data = {}) {
    if (!this.isHost) return;
    this.room.broadcast('$evt', { type, data });
    this.game.onEvent?.(this, type, data);
  }

  /** Gửi yêu cầu lên host (host gọi thì xử lý luôn). */
  request(type, data = {}) {
    if (this.isHost) this.game.onRequest?.(this, this.selfId, type, data);
    else this.room.toHost('$req', { type, data });
  }

  #onMessage({ from, type, data }) {
    if (this.isHost) {
      const p = this.players.get(from);
      if (!p) return;
      if (type === '$pose') {
        p.pose = [data.f[0], data.f[1], data.f[2], data.y, data.p];
        p.remoteHold = data.h ? { id: data.h[0], lp: { x: data.h[1], y: data.h[2], z: data.h[3] }, tp: { x: data.h[4], y: data.h[5], z: data.h[6] } } : null;
        if (p.remoteHold && (this.#noHoldUntil.get(p.remoteHold.id) ?? 0) > this.time) p.remoteHold = null;
        p.buf.push(performance.now() / 1000, p.pose);
      } else if (type === '$throw') this.#applyThrow(data.id, data.dir);
      else if (type === '$req') this.game.onRequest?.(this, from, data.type, data.data);
      return;
    }
    // Client
    const now = performance.now() / 1000;
    switch (type) {
      case '$snap':
        // Độ trễ ước lượng (chính xác khi cùng máy; khác máy có lệch đồng hồ)
        if (data.ts) this.netLag = this.netLag == null ? Date.now() - data.ts : this.netLag * 0.9 + (Date.now() - data.ts) * 0.1;
        for (const [id, pose] of Object.entries(data.p)) {
          const p = this.players.get(id);
          if (p && !p.isSelf) { p.buf.push(now, pose); p.pose = pose; p.holding = data.h?.[id] ?? null; }
        }
        for (const [id, tr] of Object.entries(data.e)) this.props.get(id)?.buf.push(now, tr);
        break;
      case '$roster': this.#syncRoster(data); break;
      case '$spawn': this.#createProp(data); break;
      case '$despawn': this.#destroyProp(data); break;
      case '$pdata': {
        const pr = this.props.get(data.id);
        if (pr) { Object.assign(pr.data, data.patch); this.game.onPropData?.(this, pr, data.patch); }
        break;
      }
      case '$shared': Object.assign(this.shared, data); this.game.onShared?.(this, data); break;
      case '$release': if (this.self?.hold?.id === data.id) this.#release(this.self); break;
      case '$evt': this.game.onEvent?.(this, data.type, data.data); break;
    }
  }

  // ------------------------------------------------------------------ vòng lặp

  #localInput() {
    const self = this.self;
    if (this.autobot) return (this.game.botBrain ?? wanderBrain)(this, self, 1 / this.config.physics.hz) ?? {};
    const i = this.input;
    if (!i.locked || self.lockMove) return { yaw: self.yaw, pitch: self.pitch };
    return {
      moveX: (i.down('KeyD') ? 1 : 0) - (i.down('KeyA') ? 1 : 0),
      moveZ: (i.down('KeyW') ? 1 : 0) - (i.down('KeyS') ? 1 : 0),
      jump: i.down('Space'),
      sprint: i.down('ShiftLeft') || i.down('ShiftRight'),
      yaw: self.yaw,
      pitch: self.pitch,
    };
  }

  /** Áp dụng input (cho người local và bot): nhìn, di chuyển, cầm/thả. */
  #drive(p, input, dt) {
    p.yaw = input.yaw ?? p.yaw;
    p.pitch = input.pitch ?? p.pitch;
    if (input.release && p.hold) this.#release(p);
    // Bot: đồ bị kẹt quá xa điểm cầm một lúc lâu thì tự buông (như người chơi)
    if (p.isBot && p.hold) {
      const pr = this.props.get(p.hold.id);
      const t = pr && pr.body.translation();
      const tp = this.#holdTarget(p);
      const far = !t || Math.hypot(t.x - tp.x, t.y - tp.y, t.z - tp.z) > this.config.grab.breakDist + 0.8;
      p.strain = far ? (p.strain ?? 0) + dt : 0;
      if (p.strain > 2) { p.strain = 0; this.#release(p); }
    }
    if (input.grab && !p.hold && this.props.has(input.grab)) this.grab(p, input.grab);
    if (input.throw && p.hold) this.throwHeld(p);
    p.character.step(dt, { ...input, yaw: p.yaw, pitch: p.pitch });
    const f = p.character.feet();
    p.pose = [f.x, f.y, f.z, p.yaw, p.pitch];
  }

  #fixedStep(dt) {
    this.time += dt;
    const now = performance.now() / 1000;
    const self = this.self;
    if (self) this.#drive(self, this.#localInput(), dt);

    if (this.isHost) {
      for (const p of this.players.values()) {
        if (p.isBot && p.character) this.#drive(p, (this.game.botBrain ?? wanderBrain)(this, p, dt) ?? {}, dt);
        if (p.proxy) {
          const s = p.buf.sample(now - 0.05, { angleAt: [3] }) ?? p.pose;
          p.proxy.set({ x: s[0], y: s[1], z: s[2] });
        }
      }
      for (const p of this.players.values()) {
        if (p.hold && p.character) this.#applyHold(p.hold.id, p.hold.lp, this.#holdTarget(p), dt);
        else if (p.remoteHold) this.#applyHold(p.remoteHold.id, p.remoteHold.lp, p.remoteHold.tp, dt);
      }
    } else {
      const t = now - this.config.net.interpDelay;
      for (const pr of this.props.values()) {
        const s = pr.buf.sample(t, { quatAt: 3 });
        if (!s) continue;
        pr.body.setNextKinematicTranslation({ x: s[0], y: s[1], z: s[2] });
        pr.body.setNextKinematicRotation({ x: s[3], y: s[4], z: s[5], w: s[6] });
        pr.sampled = s;
      }
      for (const p of this.players.values()) {
        if (!p.proxy) continue;
        const s = p.buf.sample(t, { angleAt: [3] });
        if (s) { p.proxy.set({ x: s[0], y: s[1], z: s[2] }); p.sampled = s; }
      }
    }

    // Lưu vận tốc trước bước mô phỏng để biết tốc độ lúc va chạm
    if (this.isHost) for (const pr of this.props.values()) pr.prevVel = pr.body.linvel();

    if (this.isHost) {
      this.#heldBy.clear();
      for (const p of this.players.values()) {
        const id = p.hold?.id ?? p.remoteHold?.id;
        const col = p.character?.collider ?? p.proxy?.collider;
        if (!id || !col) continue;
        if (!this.#heldBy.has(id)) this.#heldBy.set(id, new Set());
        this.#heldBy.get(id).add(col.handle);
      }
    }
    this.world.step(this.events, this.isHost ? this.#hooks : undefined);

    if (this.isHost) {
      // Va chạm mới bắt đầu → gọi onImpact với tốc độ va chạm (tương đối nếu cả hai là prop)
      this.events.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const a = this.props.get(this.#colliderToProp.get(h1));
        const b = this.props.get(this.#colliderToProp.get(h2));
        for (const [pr, other] of [[a, b], [b, a]]) {
          if (!pr?.prevVel) continue;
          const o = other?.prevVel ?? { x: 0, y: 0, z: 0 };
          const speed = Math.hypot(pr.prevVel.x - o.x, pr.prevVel.y - o.y, pr.prevVel.z - o.z);
          if (speed < this.config.physics.impactSpeed) continue;
          const last = this.#impactAt.get(pr.id) ?? -1;
          if (this.time - last < this.config.physics.impactCooldown) continue;
          this.#impactAt.set(pr.id, this.time);
          this.game.onImpact?.(this, pr, speed);
        }
      });
      this.events.clear();
      if (this.#welds.length) this.#checkWelds();
      this.game.hostUpdate?.(this, dt);
    } else {
      this.events.clear();
    }

    this.#sendAcc += dt;
    if (this.#sendAcc >= 1 / this.config.net.sendHz) {
      this.#sendAcc = 0;
      this.#send();
    }
  }

  #send() {
    if (this.isHost) {
      const p = {};
      for (const pl of this.players.values()) p[pl.id] = pl.pose.map((v) => round(v));
      const e = {};
      for (const pr of this.props.values()) {
        const t = pr.body.translation();
        const r = pr.body.rotation();
        e[pr.id] = [round(t.x), round(t.y), round(t.z), round(r.x, 1e4), round(r.y, 1e4), round(r.z, 1e4), round(r.w, 1e4)];
      }
      const h = {};
      for (const pl of this.players.values()) {
        const id = pl.hold?.id ?? pl.remoteHold?.id;
        if (id) h[pl.id] = id;
      }
      this.room.broadcast('$snap', { p, e, h, ts: Date.now() });
    } else {
      const self = this.self;
      if (!self) return;
      let h = null;
      if (self.hold) {
        const tp = this.#holdTarget(self);
        h = [self.hold.id, round(self.hold.lp.x), round(self.hold.lp.y), round(self.hold.lp.z), round(tp.x), round(tp.y), round(tp.z)];
      }
      this.room.toHost('$pose', { f: self.pose.slice(0, 3).map((v) => round(v)), y: round(self.yaw), p: round(self.pitch), h });
    }
  }

  #frame(dt) {
    const self = this.self;
    const input = this.input;

    // Nhìn (theo frame để mượt)
    if (self && !this.autobot) {
      const [dx, dy] = input.consumeLook();
      self.yaw -= dx;
      self.pitch = clamp(self.pitch - dy, -1.45, 1.45);
    }

    // Camera
    if (this.shot) {
      const t = this.game.thumbnail ?? {};
      const [cx, cy, cz] = t.camera ?? [10, 7, 12];
      const [tx, ty, tz] = t.target ?? this.config.player.spawn;
      this.camera.position.set(cx, cy, cz);
      this.camera.lookAt(tx, ty, tz);
      if (t.fov && this.camera.fov !== t.fov) { this.camera.fov = t.fov; this.camera.updateProjectionMatrix(); }
    } else if (self) {
      const e = self.eye();
      this.camera.position.set(e.x, e.y, e.z);
      this.camera.rotation.set(self.pitch, self.yaw, 0);
    }

    // Prop
    for (const pr of this.props.values()) {
      if (this.isHost) {
        const t = pr.body.translation();
        const r = pr.body.rotation();
        pr.mesh.position.set(t.x, t.y, t.z);
        pr.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      } else if (pr.sampled) {
        const s = pr.sampled;
        pr.mesh.position.set(s[0], s[1], s[2]);
        pr.mesh.quaternion.set(s[3], s[4], s[5], s[6]);
      }
    }

    // Avatar
    for (const p of this.players.values()) {
      if (p.isSelf) continue;
      const s = p.character ? p.pose : (this.isHost ? p.buf.sample(performance.now() / 1000 - 0.05, { angleAt: [3] }) : p.sampled) ?? p.pose;
      p.avatar.set({ x: s[0], y: s[1], z: s[2] }, s[3], s[4]);
      p.avatar.setArms(dt, this.#armTarget(p), this.#armSpread(p));
    }
    if (this.hands && self) {
      const pr = self.hold && this.props.get(self.hold.id);
      let target = null;
      if (pr) {
        const r = rotate(pr.mesh.quaternion, self.hold.lp);
        target = { x: pr.mesh.position.x + r.x, y: pr.mesh.position.y + r.y, z: pr.mesh.position.z + r.z };
      }
      const f = self.feet();
      const moved = this.#lastFeet ? Math.hypot(f.x - this.#lastFeet.x, f.z - this.#lastFeet.z) / Math.max(dt, 1e-3) : 0;
      this.#lastFeet = f;
      this.hands.update(dt, { target, moving: Math.min(1, moved / 4), tool: !!pr?.spec.tool, spread: this.#armSpread(self) * 0.8 });
    }

    // Cầm đồ (người chơi local)
    if (self && (input.locked || this.autobot)) this.#localInteract();
    else this.ui.setCrosshair(false);

    // Voice
    if (this.voice && self) {
      const e = self.eye();
      this.voice.setListener(e, lookDir(self.yaw, self.pitch));
      for (const p of this.players.values()) {
        if (p.isSelf || p.isBot) continue;
        const pe = p.eye();
        this.voice.setSource(p.id, pe);
        p.talking = this.voice.level(p.id);
        p.avatar.setVoice(p.talking);
      }
      self.talking = this.voice.level(null);
      if (input.pressed('KeyM')) {
        this.voice.setMuted(!this.voice.muted);
        this.ui.toast(this.voice.muted ? '🔇 Muted' : '🎙️ Mic on');
      }
    }

    this.#listAcc += dt;
    if (this.#listAcc > 0.25) { this.#listAcc = 0; this.#refreshList(); }

    this.game.update?.(this, dt);
    if (!this.noRender) this.renderer.render(this.scene, this.camera);
    input.endFrame();
  }

  #raycaster = new THREE.Raycaster();
  #lastFeet = null;

  /** Điểm tay của người chơi p vươn tới (đồ đang cầm), hoặc null. */
  #armTarget(p) {
    if (p.hold && p.character) return this.#holdTarget(p);
    if (p.remoteHold) return p.remoteHold.tp;
    const pr = p.holding && this.props.get(p.holding);
    return pr ? pr.mesh.position : null;
  }

  #armSpread(p) {
    const pr = this.props.get(p.hold?.id ?? p.remoteHold?.id ?? p.holding);
    if (!pr) return 0.18;
    if (pr.spec.tool) return 0.05;
    const sz = pr.spec.size ?? [0.4];
    return Math.min(0.3, Math.max(0.12, Math.max(...sz) * 0.25));
  }

  /** Tìm prop dưới tâm màn hình trong tầm với. */
  aimedProp() {
    const held = this.self?.hold?.id;
    const meshes = [...this.props.values()].filter((p) => p.id !== held).map((p) => p.mesh);
    this.#raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    this.#raycaster.far = this.config.player.reach;
    const hit = this.#raycaster.intersectObjects(meshes, true)[0];
    if (!hit) return null;
    let o = hit.object;
    while (o && !o.userData.propId) o = o.parent;
    return o ? { prop: this.props.get(o.userData.propId), point: hit.point } : null;
  }

  #localInteract() {
    const self = this.self;
    const input = this.input;
    const g = this.config.grab;
    const key = g.key;
    const human = !this.autobot;
    // Game được ưu tiên xử lý phím tương tác (vd. vào/ra trạm điều khiển)
    if (human && input.pressed(key) && this.game.interact?.(this) === true) input.consume(key);
    if (self.hold) {
      const pr = this.props.get(self.hold.id);
      if (!pr) { this.#release(self); return; }
      // Tự thả khi bị kéo quá xa (vật kẹt hoặc quá nặng)
      const tp = this.#holdTarget(self);
      const r = rotate(pr.mesh.quaternion, self.hold.lp);
      const wp = pr.mesh.position;
      if (Math.hypot(wp.x + r.x - tp.x, wp.y + r.y - tp.y, wp.z + r.z - tp.z) > g.breakDist) this.#release(self);
      const aim = this.aimedProp();
      if (human) {
        if (input.mouse.wheel && pr.spec.holdDist == null) self.hold.dist = clamp(self.hold.dist - input.mouse.wheel * 0.2, g.minDist, g.maxDist);
        if (input.pressed(key)) { this.#release(self); input.consume(key); }
        else if (input.mouse.rightPressed) this.throwHeld(self);
        else if (input.mouse.leftPressed) this.game.use?.(this, pr, aim);
      }
      this.ui.setCrosshair(true, this.game.holdPrompt?.(this, pr, aim) ?? `[${keyName(key)}] Drop`);
      return;
    }
    const aim = this.aimedProp();
    this.ui.setCrosshair(!!aim, aim ? (this.game.aimPrompt?.(this, aim.prop) ?? `[${keyName(key)}] Pick up`) : '');
    if (!human) return;
    if (aim && input.pressed(key) && this.game.canGrab?.(this, aim.prop) !== false) { this.grab(self, aim.prop.id, aim.point); input.consume(key); }
    else if (input.mouse.leftPressed) this.game.use?.(this, null, aim);
  }

  #refreshList() {
    if (!this.ui.playerList) return;
    this.ui.setPlayers([...this.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color, isBot: p.isBot, isSelf: p.isSelf,
      talking: (p.talking ?? 0) > 0.08, muted: p.isSelf && this.voice?.muted,
    })));
  }
}
