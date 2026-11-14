// Bản vẽ căn nhà ống 2 tầng: danh sách ô (slot) theo thứ tự xây + bảng hàng xóm để trát vữa.
// Toạ độ là tâm khối. Nhà đặt trên móng có mặt trên ở y = BASE.

import config from './config.js';

export const BASE = 0.3; // mặt trên móng
const HALF = 1.6; // khoảng cách từ tâm nhà tới tâm cột / tâm tường
const Q = Math.PI / 2;

const B = config.blocks;
const h = (kind) => B[kind].size[1];

/** Một tầng bắt đầu ở cao độ `y0` (mặt sàn). Trả các ô theo thứ tự xây. */
function storey(floor, y0, topKind) {
  const slots = [];
  const add = (kind, pos, yaw = 0) => slots.push({ kind, floor, pos, rot: [0, yaw, 0] });

  // 4 cột ở góc
  for (const [x, z] of [[-HALF, HALF], [HALF, HALF], [-HALF, -HALF], [HALF, -HALF]]) add('cot', [x, y0 + h('cot') / 2, z]);

  // Tường 3 mặt (sau, trái, phải) × 2 hàng × 2 khối. Mặt trước để trống (mặt tiền nhà ống).
  const w = B.gach.size[0];
  for (let row = 0; row < 2; row++) {
    const y = y0 + 0.5 + row * 1.0;
    for (const s of [-1, 1]) {
      add('gach', [s * (w / 2 + 0.01), y, -HALF]); // tường sau
      add('gach', [-HALF, y, s * (w / 2 + 0.01)], Q); // tường trái
      add('gach', [HALF, y, s * (w / 2 + 0.01)], Q); // tường phải
    }
  }

  // 2 dầm dọc hai bên, đặt trên đầu cột
  const beamY = y0 + h('cot') + h('dam') / 2;
  add('dam', [-HALF, beamY, 0]); // dầm dài theo trục z, không cần xoay
  add('dam', [HALF, beamY, 0]);

  // Sàn (tầng 1) hoặc mái (tầng 2) đặt trên dầm
  add(topKind, [0, beamY + h('dam') / 2 + h(topKind) / 2, 0]);
  return slots;
}

const floor1 = storey(1, BASE, 'san');
const slabTop1 = floor1.at(-1).pos[1] + h('san') / 2;
const floor2 = storey(2, slabTop1, 'mai');

export const SLOTS = [...floor1, ...floor2].map((s, i) => ({ ...s, id: i }));
export const FLOOR2_Y = slabTop1;

/** Kích thước theo trục thế giới (đổi x/z khi xoay 90°). */
export function worldSize(slot) {
  const [x, y, z] = B[slot.kind].size;
  return Math.abs(slot.rot[1]) > 0.1 ? [z, y, x] : [x, y, z];
}

// Hàng xóm: hai ô có hộp bao chạm nhau (nới 0.06 m)
const pad = 0.06;
function touch(a, b) {
  const sa = worldSize(a), sb = worldSize(b);
  for (let k = 0; k < 3; k++) {
    if (Math.abs(a.pos[k] - b.pos[k]) > (sa[k] + sb[k]) / 2 + pad) return false;
  }
  return true;
}
for (const s of SLOTS) {
  s.neighbors = SLOTS.filter((o) => o !== s && touch(s, o)).map((o) => o.id);
  s.ground = s.pos[1] - worldSize(s)[1] / 2 < BASE + 0.05; // sát móng → trát được xuống đất
}

