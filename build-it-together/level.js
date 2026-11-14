// Hình ảnh & âm thanh: công trường, cẩu tháp, máy trộn, dụng cụ, khối vật liệu, ô bản vẽ, khu phố nhà đã xây, sfx.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { material } from 'kit/render.js';
import config from './config.js';
import { SLOTS, worldSize } from './blueprint.js';

export const PALETTE = {
  sky: '#ffcf99', fog: '#f6d3a5', dirt: '#c9a46a', dirtDark: '#b38f58', concrete: '#b8bcc2',
  brick: '#c4553a', mortar: '#e9dccb', beam: '#8d949c', slab: '#d0d3d8', roof: '#a63d2a',
  ghost: '#4dabf7', safety: '#ffb703', black: '#212529', wood: '#a47148',
};

// Dốc giàn giáo lên tầng 2 (bên phải nhà)
export const RAMP = { x: 2.7, footZ: 7.4, topZ: 1.4, landingY: 2.8 };

// ------------------------------------------------------------------ texture

function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  return t;
}

let brickTex, slabTex, roofTex, dirtTex;
function textures() {
  if (brickTex) return;
  brickTex = canvasTex(256, 192, (g, w, h) => {
    g.fillStyle = PALETTE.mortar;
    g.fillRect(0, 0, w, h);
    const rows = 6, bw = 64, bh = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let x = -bw; x < w + bw; x += bw) {
        const off = r % 2 ? bw / 2 : 0;
        const shade = 0.85 + Math.random() * 0.25;
        const base = new THREE.Color(PALETTE.brick).multiplyScalar(shade);
        g.fillStyle = `#${base.getHexString()}`;
        g.fillRect(x + off + 3, r * bh + 3, bw - 6, bh - 6);
      }
    }
  });
  slabTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = PALETTE.slab;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 600; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
      g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
    g.strokeStyle = 'rgba(0,0,0,.18)';
    g.lineWidth = 3;
    g.strokeRect(2, 2, w - 4, h - 4);
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  });
  roofTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = PALETTE.roof;
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      g.fillStyle = 'rgba(0,0,0,.22)';
      g.fillRect(0, y + 26, w, 6);
      for (let x = 0; x < w; x += 32) {
        g.fillStyle = 'rgba(255,255,255,.06)';
        g.fillRect(x + ((y / 32) % 2) * 16, y, 14, 24);
      }
    }
  }, [2, 2]);
  dirtTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = PALETTE.dirt;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) {
      const c = Math.random() < 0.5 ? 'rgba(90,60,20,' : 'rgba(255,235,190,';
      g.fillStyle = `${c}${Math.random() * 0.12})`;
      const s = Math.random() * 6 + 1;
      g.fillRect(Math.random() * w, Math.random() * h, s, s);
    }
  }, [16, 16]);
}

// ------------------------------------------------------------------ khối vật liệu


function box(size, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const MATS = {};
function blockMats(kind) {
  if (MATS[kind]) return MATS[kind];
  textures();
  const [sx, sy] = config.blocks[kind].size;
  let m;
  if (kind === 'gach') {
    const tex = brickTex.clone();
    tex.repeat.set(sx / 1.4, sy / 1.0);
    tex.needsUpdate = true;
    m = { body: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }) };
  } else if (kind === 'cot') m = { body: material(PALETTE.beam), rebar: material('#5c3d2e', { roughness: 0.6, metalness: 0.4 }) };
  else if (kind === 'dam') m = { body: material('#7f878f'), end: material('#5f666d') };
  else if (kind === 'san') m = { body: new THREE.MeshStandardMaterial({ map: slabTex, roughness: 0.9 }) };
  else m = { body: new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.85 }), ridge: material('#7d2a1b') };
  return (MATS[kind] = m);
}

/** Mesh cho một khối (spec.data.kind). */
export function blockMesh(spec) {
  const kind = spec.data.kind;
  const [sx, sy, sz] = config.blocks[kind].size;
  const mats = blockMats(kind);
  const g = new THREE.Group();
  const body = box([sx, sy, sz], mats.body);
  if (kind === 'cot') {
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 6), mats.rebar);
      r.position.set(x * (sx / 2 - 0.07), sy / 2 + 0.1, z * (sz / 2 - 0.07));
      g.add(r);
    }
  } else if (kind === 'dam') {
    for (const sgn of [-1, 1]) {
      const e = box([sx + 0.01, sy + 0.01, 0.12], mats.end);
      e.position.z = sgn * (sz / 2 - 0.06);
      g.add(e);
    }
  } else if (kind === 'mai') {
    const ridge = box([sx * 0.98, 0.12, 0.18], mats.ridge);
    ridge.position.y = sy / 2 + 0.05;
    g.add(ridge);
  }
  g.add(body);
  g.userData.body = body;
  return g;
}

/** Bao xi măng: bao giấy xám, băng đỏ, chữ CEMENT. */
let cementMat;
export function cementMesh(spec) {
  const [sx, sy, sz] = spec.size;
  cementMat ??= new THREE.MeshStandardMaterial({ roughness: 0.95, map: canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#d8d2c4';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#c92a2a';
    g.fillRect(0, h * 0.62, w, h * 0.16);
    g.fillStyle = '#343a40';
    g.font = '900 40px "Arial Black", system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('CEMENT', w / 2, h * 0.5);
  }) });
  const g = new THREE.Group();
  const body = box([sx, sy, sz], cementMat);
  body.scale.set(1, 1, 1);
  g.add(body);
  // mép bao phồng
  const puff = new THREE.Mesh(new THREE.CapsuleGeometry(sy / 2, sx - sy, 4, 8), cementMat);
  puff.rotation.z = Math.PI / 2;
  puff.scale.set(1, 1, sz / sy);
  puff.castShadow = true;
  g.add(puff);
  return g;
}

/** Cái bay thợ hồ: cán gỗ + lưỡi thép + cục vữa (hiện khi có vữa). */
export function trowelMesh(spec) {
  const g = new THREE.Group();
  const steel = material('#ced4da', { metalness: 0.7, roughness: 0.3 });
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.012, 3), steel);
  blade.scale.set(0.8, 1, 1.25);
  blade.rotation.y = Math.PI / 2;
  blade.position.set(0, -0.01, -0.06);
  blade.castShadow = true;
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.08), steel);
  neck.position.set(0, 0.02, 0.1);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.16, 8), material(PALETTE.wood));
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0, 0.045, 0.2);
  handle.castShadow = true;
  const blob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), material(PALETTE.mortar, { roughness: 1 }));
  blob.scale.set(1, 0.6, 1.2);
  blob.position.set(0, 0, -0.05);
  g.add(blade, neck, handle, blob);
  g.userData.blob = blob;
  setTrowelLoad(g, spec.data?.load ?? 0);
  return g;
}

export function setTrowelLoad(mesh, load) {
  const b = mesh.userData.blob;
  if (!b) return;
  b.visible = load > 0;
  const k = 0.6 + Math.min(1, load / config.trowel.cap) * 0.6;
  b.scale.set(k, 0.6 * k, 1.2 * k);
}

/** Viền vữa cho khối đã trát. */
export function setWelded(mesh, welded) {
  const body = mesh.userData.body;
  if (welded && !mesh.userData.edges) {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: '#fff4e0' }));
    e.scale.setScalar(1.01);
    body.add(e);
    mesh.userData.edges = e;
  } else if (!welded && mesh.userData.edges) {
    mesh.userData.edges.removeFromParent();
    mesh.userData.edges = null;
  }
}

// ------------------------------------------------------------------ ô bản vẽ (ghost)

/** Ô bản vẽ trong suốt. Trả { list, focus(kind) }: focus làm sáng các ô cùng loại với khối đang cầm. */
export function buildGhosts(scene) {
  const mats = {};
  for (const kind of Object.keys(config.blocks)) {
    mats[kind] = {
      fill: new THREE.MeshBasicMaterial({ color: PALETTE.ghost, transparent: true, opacity: 0.14, depthWrite: false }),
      line: new THREE.LineBasicMaterial({ color: '#8fd0ff', transparent: true, opacity: 0.85 }),
    };
  }
  const list = SLOTS.map((s) => {
    const size = worldSize(s);
    const geo = new THREE.BoxGeometry(...size);
    const m = new THREE.Mesh(geo, mats[s.kind].fill);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), mats[s.kind].line));
    m.position.fromArray(s.pos);
    m.renderOrder = 2;
    scene.add(m);
    return m;
  });
  let current;
  return {
    list,
    focus(kind) {
      if (kind === current) return;
      current = kind;
      for (const [k, m] of Object.entries(mats)) {
        m.fill.opacity = !kind ? 0.14 : k === kind ? 0.34 : 0.04;
        m.line.opacity = !kind ? 0.85 : k === kind ? 1 : 0.2;
      }
    },
  };
}

// ------------------------------------------------------------------ công trường

export function buildLevel(ctx) {
  textures();
  const { scene } = ctx;
  const S = (o) => ctx.addStatic(o);

  // Ánh sáng nắng chiều
  ctx.sun.color.set('#ffd8a8');
  ctx.sun.intensity = 2.6;
  ctx.sun.position.set(-18, 16, 14);
  ctx.hemi.color.set('#fff1dc');
  ctx.hemi.groundColor.set('#9c7a4a');
  ctx.hemi.intensity = 1.4;
  ctx.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  ctx.renderer.toneMappingExposure = 1.05;

  // Mặt đất đất cát có texture
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  ctx.addStatic({ size: [120, 1, 120], pos: [0, -0.5, 0], visible: false });

  // Móng nhà
  S({ size: [4.6, 0.3, 4.6], pos: [0, 0.15, 0], color: PALETTE.concrete });
  S({ size: [4.8, 0.06, 4.8], pos: [0, 0.03, 0], color: '#9ea3a8', collide: false });

  // Dốc giàn giáo + chiếu nghỉ tầng 2
  const len = Math.hypot(RAMP.footZ - RAMP.topZ - 0.5, RAMP.landingY);
  const ang = Math.atan2(RAMP.landingY, RAMP.footZ - RAMP.topZ - 0.5);
  const midZ = (RAMP.footZ + RAMP.topZ + 0.5) / 2;
  S({ size: [1.6, 0.16, len], pos: [RAMP.x, RAMP.landingY / 2 - 0.05, midZ], rot: [ang, 0, 0], color: PALETTE.wood });
  S({ size: [1.6, 0.2, 3.7], pos: [RAMP.x, RAMP.landingY - 0.1, 0.05], color: PALETTE.wood });
  const pole = '#6c757d';
  for (const [x, z] of [[1.95, -1.7], [3.45, -1.7], [1.95, 1.8], [3.45, 1.8], [1.95, 4.4], [3.45, 4.4]]) {
    const h = z > 3 ? RAMP.landingY * 0.5 : RAMP.landingY;
    S({ shape: 'cylinder', size: [0.05, h], pos: [x, h / 2, z], color: pole, collide: false });
  }
  // Lấp kín gầm chiếu nghỉ và gầm dốc (vô hình) để người và vật không chui vào kẹt
  S({ size: [1.6, RAMP.landingY - 0.2, 3.7], pos: [RAMP.x, (RAMP.landingY - 0.2) / 2, 0.05], visible: false });
  const run = RAMP.footZ - RAMP.topZ - 0.5;
  const rampY = (z) => (RAMP.landingY * (RAMP.footZ - z)) / run;
  for (let z0 = RAMP.topZ + 0.5; z0 < RAMP.footZ - 0.6; z0 += 0.6) {
    const hgt = Math.max(0.05, rampY(z0 + 0.6) - 0.2);
    S({ size: [1.6, hgt, 0.6], pos: [RAMP.x, hgt / 2, z0 + 0.3], visible: false });
  }

  // lan can phía ngoài chiếu nghỉ (thanh vàng + vách vô hình chống rơi)
  S({ size: [0.05, 0.05, 3.6], pos: [3.45, RAMP.landingY + 0.9, 0.05], color: PALETTE.safety, collide: false });
  S({ size: [0.06, 0.9, 3.7], pos: [3.47, RAMP.landingY + 0.45, 0.05], visible: false });

  // Rào chắn sọc vàng đen quanh công trường
  const fence = (x1, z1, x2, z2) => {
    const n = Math.round(Math.hypot(x2 - x1, z2 - z1) / 2);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      const along = Math.abs(x2 - x1) > Math.abs(z2 - z1);
      S({ size: along ? [1.96, 1.0, 0.12] : [0.12, 1.0, 1.96], pos: [x, 0.5, z], color: i % 2 ? PALETTE.black : PALETTE.safety });
    }
  };
  fence(-12, -8, 12, -8);
  fence(-12, 18, 12, 18);
  fence(-12, -8, -12, 18);
  fence(12, -8, 12, 18);

  // Biển công trình
  const sign = canvasTex(1024, 320, (g, w, h) => {
    g.fillStyle = '#1d3557';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = PALETTE.safety;
    g.lineWidth = 16;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#fff';
    g.font = '900 96px "Arial Black", system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('BUILD IT TOGETHER', w / 2, 140);
    g.fillStyle = PALETTE.safety;
    g.font = '700 54px system-ui, sans-serif';
    g.fillText('2-STOREY HOUSE · CREW AT WORK', w / 2, 236);
  });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.7 }));
  board.position.set(5.5, 3, -7.85);
  board.castShadow = true;
  scene.add(board);
  for (const x of [3, 8]) S({ shape: 'cylinder', size: [0.08, 3], pos: [x, 1.5, -7.9], color: pole, collide: false });

  // Cẩu tháp vàng lái được (điểm nhận diện) + máy trộn vữa
  const crane = buildCrane(ctx);
  const mixer = buildMixer(ctx);
  const [px, pz] = config.cement.pallet;
  for (const [x, z, w, d] of [[1.2, 11.2, 7, 7.6], [-6.9, 10.5, 2.6, 4.2], [-6.8, 4.0, 4.0, 4.0], [-6.8, 14.6, 4.2, 4.2], [-3.2, 8.5, 2.4, 4.6], [px, pz, 2.2, 1.6]]) {
    S({ size: [w, 0.08, d], pos: [x, 0.04, z], color: PALETTE.wood, collide: false });
  }

  // Giàn giáo trang trí phía sau nhà
  for (const x of [-2.3, 0, 2.3]) S({ shape: 'cylinder', size: [0.05, 6.2], pos: [x, 3.1, -2.35], color: pole, collide: false });
  for (const y of [1.4, 2.9, 4.4, 5.9]) S({ size: [4.7, 0.05, 0.05], pos: [0, y, -2.35], color: pole, collide: false });
  for (const y of [2.85, 5.85]) S({ size: [4.6, 0.05, 0.4], pos: [0, y, -2.55], color: PALETTE.wood, collide: false });

  // Bàn để dụng cụ cạnh máy trộn
  const [tx, tz] = config.trowel.table;
  S({ size: [1.2, 0.08, 0.6], pos: [tx, 0.8, tz], color: PALETTE.wood });
  for (const [dx, dz] of [[-0.5, -0.22], [0.5, -0.22], [-0.5, 0.22], [0.5, 0.22]]) S({ size: [0.06, 0.76, 0.06], pos: [tx + dx, 0.38, tz + dz], color: '#5c3d2e', collide: false });

  return { crane, mixer };
}

/** Toạ độ móc cẩu từ trạng thái {a, r, y}. */
export function hookPos(c) {
  const [mx, mz] = config.crane.mast;
  return { x: mx + Math.cos(c.a) * c.r, y: c.y, z: mz + Math.sin(c.a) * c.r };
}

/**
 * Cẩu tháp: thân + phần quay (cabin, cần, đối trọng, xe con, cáp, móc).
 * Trả { booth, update(state, dt, loadPos) } — booth là bàn điều khiển dưới chân cẩu.
 */
function buildCrane(ctx) {
  const { scene } = ctx;
  const S = (o) => ctx.addStatic({ collide: false, ...o });
  const Y = PALETTE.safety;
  const [x, z] = config.crane.mast;
  const H = config.crane.height;
  ctx.addStatic({ size: [3, 1, 3], pos: [x, 0.5, z], color: '#868e96' });
  for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) S({ size: [0.14, H, 0.14], pos: [x + dx, H / 2 + 1, z + dz], color: Y });
  for (let y = 2; y < H; y += 1.6) {
    S({ size: [1.3, 0.08, 0.08], pos: [x, y, z - 0.6], color: Y });
    S({ size: [1.3, 0.08, 0.08], pos: [x, y, z + 0.6], color: Y });
    S({ size: [0.08, 0.08, 1.3], pos: [x - 0.6, y, z], color: Y });
    S({ size: [0.08, 0.08, 1.3], pos: [x + 0.6, y, z], color: Y });
    S({ size: [1.7, 0.06, 0.06], pos: [x, y + 0.8, z - 0.6], rot: [0, 0, 0.9], color: Y });
  }

  // Phần quay
  const top = new THREE.Group();
  top.position.set(x, 0, z);
  scene.add(top);
  const part = (size, pos, color, shape = 'box') => {
    const m = shape === 'box'
      ? new THREE.Mesh(new THREE.BoxGeometry(...size), material(color))
      : new THREE.Mesh(new THREE.CylinderGeometry(size[0], size[0], size[1], 8), material(color));
    m.position.set(...pos);
    m.castShadow = true;
    top.add(m);
    return m;
  };
  part([1.6, 1.4, 1.6], [0, H + 1.7, 0], '#f8f9fa');
  part([1.0, 0.6, 1.62], [0.31, H + 1.9, 0], '#74c0fc');
  part([22, 0.7, 0.7], [9, H + 2.8, 0], Y);
  part([7, 0.7, 0.7], [-5.5, H + 2.8, 0], Y);
  part([2.2, 1.6, 1.2], [-8, H + 1.9, 0], '#495057');
  part([0.12, 4], [0, H + 5, 0], Y, 'cyl');
  const trolley = part([1, 0.4, 1], [6, H + 2.3, 0], '#343a40');
  const cable = part([0.03, 1], [6, H, 0], '#212529', 'cyl');
  const hook = new THREE.Group();
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.35), material(Y));
  const hk = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 12, Math.PI * 1.4), material('#c92a2a', { metalness: 0.4 }));
  hk.position.y = -0.38;
  hk.rotation.z = Math.PI * 0.8;
  block.castShadow = hk.castShadow = true;
  hook.add(block, hk);
  scene.add(hook);
  // Vòng chỉ điểm dưới đất ngay dưới móc
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 28), new THREE.MeshBasicMaterial({ color: Y, transparent: true, opacity: 0.8, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);
  // Dây treo tới kiện hàng
  const sling = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 5), material('#212529'));
  sling.visible = false;
  scene.add(sling);

  // Bàn điều khiển
  const [bx, bz] = config.crane.booth;
  const booth = new THREE.Group();
  booth.position.set(bx, 0, bz);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.6), material('#343a40'));
  desk.position.y = 0.5;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.08, 0.62), material(Y));
  panel.position.y = 1.04;
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6), material('#212529'));
  stick.position.set(-0.2, 1.22, 0);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), material('#e03131'));
  knob.position.set(-0.2, 1.38, 0);
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10), material('#2f9e44'));
  btn.position.set(0.22, 1.1, 0);
  for (const m of [desk, panel, stick, knob, btn]) { m.castShadow = true; booth.add(m); }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: '#69db7c' }));
  lamp.position.set(0.35, 1.5, 0.2);
  booth.add(lamp);
  scene.add(booth);
  ctx.addStatic({ size: [0.9, 1.1, 0.6], pos: [bx, 0.55, bz], visible: false });

  const cur = { a: config.crane.start[0], r: config.crane.start[1], y: config.crane.start[2] };
  const up = new THREE.Vector3(0, 1, 0);
  const d = new THREE.Vector3();
  return {
    booth,
    hook,
    update(state, dt, loadPos, busy) {
      if (state) {
        const k = 1 - Math.exp(-dt * 10);
        cur.a += (state.a - cur.a) * k;
        cur.r += (state.r - cur.r) * k;
        cur.y += (state.y - cur.y) * k;
      }
      top.rotation.y = -cur.a;
      trolley.position.x = cur.r;
      const len = H + 2.1 - cur.y;
      cable.position.set(cur.r, cur.y + len / 2, 0);
      cable.scale.y = len;
      const h = hookPos(cur);
      hook.position.set(h.x, h.y, h.z);
      hook.rotation.y = -cur.a;
      ring.position.set(h.x, 0.04, h.z);
      lamp.material.color.set(busy ? '#ff922b' : '#69db7c');
      if (loadPos) {
        d.set(loadPos.x - h.x, loadPos.y - (h.y - 0.4), loadPos.z - h.z);
        const l = d.length();
        sling.visible = l > 0.05;
        sling.position.set(h.x + d.x / 2, h.y - 0.4 + d.y / 2, h.z + d.z / 2);
        sling.quaternion.setFromUnitVectors(up, d.normalize());
        sling.scale.y = l;
      } else sling.visible = false;
    },
  };
}

/** Máy trộn vữa: thân + thùng quay. Trả { group, drum, update(mixing, dt) }. */
function buildMixer(ctx) {
  const { scene } = ctx;
  const [x, z] = config.mixer.pos;
  ctx.addStatic({ size: [1.4, 0.5, 1.0], pos: [x, 0.45, z], color: '#495057' });
  ctx.addStatic({ size: [1.3, 1.2, 1.0], pos: [x, 1.2, z], visible: false });
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const tilt = new THREE.Group();
  tilt.position.y = 1.25;
  tilt.rotation.z = 0.6;
  group.add(tilt);
  const drum = new THREE.Group();
  tilt.add(drum);
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 1.1, 14), material('#f76707'));
  const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.45, 0.25, 14, 1, true), material('#d9480f', { side: THREE.DoubleSide }));
  mouth.position.y = 0.67;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.12, 14), material('#212529'));
  stripe.position.y = -0.1;
  const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.12, 0.3), material('#212529'));
  paddle.position.x = 0.5;
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 14), material(PALETTE.mortar, { roughness: 1 }));
  fill.position.y = 0.55;
  for (const m of [shell, mouth, stripe, paddle]) { m.castShadow = true; drum.add(m); }
  tilt.add(fill);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.0), material('#495057'));
  base.position.y = 0.45;
  group.add(base);
  for (const sgn of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.12, 12), material('#212529'));
    w.rotation.x = Math.PI / 2;
    w.position.set(0, 0.25, sgn * 0.55);
    group.add(w);
  }
  scene.add(group);
  return {
    group,
    update(state, dt) {
      if (state?.mixing > 0) drum.rotation.y += dt * 5;
      const level = Math.min(1, (state?.mortar ?? 0) / config.mixer.max);
      fill.visible = level > 0;
      fill.position.y = 0.1 + level * 0.45;
    },
  };
}

// ------------------------------------------------------------------ khu phố: nhà đã xây xong

let houseParts;
/** Gộp cả căn nhà thành vài mesh (mỗi vật liệu một mesh) để vẽ nhiều nhà vẫn nhẹ. */
function houseTemplate() {
  if (houseParts) return houseParts;
  const groups = new Map();
  const tmp = new THREE.Group();
  for (const s of SLOTS) {
    const m = blockMesh({ data: { kind: s.kind } });
    m.position.fromArray(s.pos);
    m.rotation.set(...s.rot);
    tmp.add(m);
  }
  const base = box([4.6, 0.3, 4.6], material(PALETTE.concrete));
  base.position.y = 0.15;
  tmp.add(base);
  // cửa + cửa sổ mặt tiền
  const door = box([0.9, 1.6, 0.06], material('#6b4226'));
  door.position.set(0.3, 1.1, 1.65);
  const win = box([1.2, 0.8, 0.06], material('#a5d8ff', { roughness: 0.2 }));
  win.position.set(0, 4.3, 1.65);
  tmp.add(door, win);
  tmp.updateMatrixWorld(true);
  tmp.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const list = groups.get(o.material) ?? [];
    list.push(g.index ? g.toNonIndexed() : g);
    groups.set(o.material, list);
  });
  houseParts = [...groups].map(([mat, list]) => ({ mat, geo: mergeGeometries(list) }));
  return houseParts;
}

const ROOFS = ['#a63d2a', '#2b6cb0', '#2f855a', '#6b46c1', '#c05621', '#1f2937'];

/** Biển nhỏ trước nhà: sao + thời gian + tên đội. */
function plaque(rec) {
  const tex = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#1d3557';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = PALETTE.safety;
    g.lineWidth = 10;
    g.strokeRect(5, 5, w - 10, h - 10);
    g.textAlign = 'center';
    g.fillStyle = PALETTE.safety;
    g.font = '900 72px system-ui, sans-serif';
    g.fillText('★'.repeat(rec.stars) + '☆'.repeat(3 - rec.stars), w / 2, 92);
    g.fillStyle = '#fff';
    g.font = '800 44px system-ui, sans-serif';
    g.fillText(`#${rec.n}  ·  ${rec.time}`, w / 2, 152);
    g.font = '600 30px system-ui, sans-serif';
    g.fillStyle = '#ced4da';
    g.fillText(rec.crew.join(', ').slice(0, 30), w / 2, 210);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  return m;
}

/** Vẽ các nhà đã xây (shared.town) lên các lô quanh công trường. */
export function buildTown(scene) {
  const root = new THREE.Group();
  scene.add(root);
  let key = '';
  return {
    sync(town = []) {
      const k = town.map((r) => r.n).join(',');
      if (k === key) return;
      key = k;
      root.clear();
      const parts = houseTemplate();
      town.slice(-config.town.plots.length).forEach((rec, i) => {
        const [x, z, yaw] = config.town.plots[i];
        const house = new THREE.Group();
        house.position.set(x, 0, z);
        house.rotation.y = yaw;
        const roofColor = ROOFS[rec.n % ROOFS.length];
        for (const { mat, geo } of parts) {
          let m = mat;
          if (mat === MATS.mai?.body) m = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.8 });
          const mesh = new THREE.Mesh(geo, m);
          mesh.castShadow = mesh.receiveShadow = true;
          house.add(mesh);
        }
        const sign = plaque(rec);
        sign.position.set(-1.2, 1.1, 2.75);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), material('#6c757d'));
        post.position.set(-1.2, 0.35, 2.72);
        house.add(sign, post);
        root.add(house);
      });
    },
  };
}

// ------------------------------------------------------------------ mũ bảo hộ

export function addHelmet(avatar) {
  const helmet = new THREE.Group();
  const mat = material(PALETTE.safety, { roughness: 0.4 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.035, 18), mat);
  brim.position.set(0, 0.01, -0.06);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.55), mat);
  ridge.position.y = 0.28;
  for (const m of [dome, brim, ridge]) { m.castShadow = true; helmet.add(m); }
  helmet.position.y = 0.12;
  avatar.head.add(helmet);
}

// ------------------------------------------------------------------ âm thanh tổng hợp

let ac;
function audio() {
  ac ??= new AudioContext();
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}
addEventListener('pointerdown', () => audio(), { once: true });

function noise(seconds, filterFreq, q, gain, type = 'bandpass') {
  const a = audio();
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * seconds), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = filterFreq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
  return { src, g };
}

export const sfx = {
  snap() { noise(0.12, 1800, 4, 0.5); },
  weld() { noise(0.35, 600, 1.2, 0.35, 'lowpass'); },
  crack() { noise(0.25, 3200, 2, 0.6); noise(0.4, 300, 1, 0.4, 'lowpass'); },
  scoop() { noise(0.25, 450, 1.5, 0.4, 'lowpass'); },
  clank() { noise(0.18, 2600, 6, 0.5); noise(0.3, 700, 3, 0.3); },
  mix(seconds) {
    const a = audio();
    const { g } = noise(seconds, 160, 1.2, 0.0, 'lowpass');
    g.gain.linearRampToValueAtTime(0.5, a.currentTime + 0.4);
    g.gain.setValueAtTime(0.5, a.currentTime + seconds - 0.4);
    g.gain.linearRampToValueAtTime(0, a.currentTime + seconds);
  },
  fanfare() {
    const a = audio();
    [523, 659, 784, 1047].forEach((f, i) => {
      const o = a.createOscillator();
      const g = a.createGain();
      const t = a.currentTime + i * 0.13;
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (i === 3 ? 0.9 : 0.25));
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + 1);
    });
  },
  whistle() {
    const a = audio();
    const o = a.createOscillator();
    const g = a.createGain();
    o.frequency.setValueAtTime(1800, a.currentTime);
    o.frequency.linearRampToValueAtTime(2300, a.currentTime + 0.5);
    g.gain.setValueAtTime(0.0001, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, a.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.9);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + 1);
  },
};
