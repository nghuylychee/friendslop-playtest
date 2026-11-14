// Physics bằng Rapier (WASM).
// Mỗi peer có một world riêng:
//   - Level tĩnh: giống nhau trên mọi peer (dựng trong setup()).
//   - Prop: dynamic trên host (host mô phỏng), kinematic trên client (đặt theo snapshot).
//   - Người chơi: capsule kinematic + character controller.

import RAPIER from 'rapier';

let ready = null;
export function initPhysics() {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}

export { RAPIER };

export function createWorld(gravity = -9.81) {
  return new RAPIER.World({ x: 0, y: gravity, z: 0 });
}

/** Collider theo shape giống primitiveMesh(): box (size = kích thước đầy đủ), ball (size[0] = bán kính), cylinder (size = [bán kính, cao]). */
export function colliderDesc({ shape = 'box', size = [1, 1, 1] }) {
  if (shape === 'ball') return RAPIER.ColliderDesc.ball(size[0]);
  if (shape === 'cylinder') return RAPIER.ColliderDesc.cylinder(size[1] / 2, size[0]);
  return RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2);
}

export function quatFromEuler([x = 0, y = 0, z = 0] = []) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  // thứ tự XYZ, giống THREE.Euler mặc định
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

/** Xoay vector v bởi quaternion q. */
export function rotate(q, v) {
  const { x, y, z, w } = q;
  const ix = w * v.x + y * v.z - z * v.y;
  const iy = w * v.y + z * v.x - x * v.z;
  const iz = w * v.z + x * v.y - y * v.x;
  const iw = -x * v.x - y * v.y - z * v.z;
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}

export function inverseRotate(q, v) {
  return rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
}
