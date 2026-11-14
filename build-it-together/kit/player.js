// Nhân vật: hình đại diện (Avatar) và bộ điều khiển di chuyển (Character).

import * as THREE from 'three';
import { RAPIER } from './physics.js';
import { material, nameTag } from './render.js';
import { clamp } from './util.js';

export const BODY = { radius: 0.35, halfHeight: 0.5, eye: 1.55 };
const GLOVE = '#f2c27f';
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

/** Một cánh tay: ống tay (màu áo) nối vai → bàn tay (găng). Đặt bằng setArm(arm, vai, tay). */
function makeArm(color, radius, glove) {
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.85, 1, 8), material(color));
  const hand = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.45, 10, 8), material(glove));
  sleeve.castShadow = hand.castShadow = true;
  return { sleeve, hand, pos: new THREE.Vector3() };
}

function setArm(arm, shoulder, handPos) {
  _d.subVectors(handPos, shoulder);
  const len = Math.max(0.01, _d.length());
  arm.sleeve.position.copy(shoulder).addScaledVector(_d, 0.5);
  arm.sleeve.quaternion.setFromUnitVectors(UP, _d.divideScalar(len));
  arm.sleeve.scale.set(1, len, 1);
  arm.hand.position.copy(handPos);
}

// Tâm capsule cách chân: halfHeight + radius = 0.85

/** Hình người chơi low-poly: thân hạt đậu, mắt, miệng nhép theo giọng, tên trên đầu. */
export class Avatar {
  constructor(scene, { name, color }) {
    this.root = new THREE.Group();
    const bodyMat = material(color);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(BODY.radius, BODY.halfHeight * 2, 4, 10), bodyMat);
    body.castShadow = true;
    body.position.y = BODY.halfHeight + BODY.radius;
    this.root.add(body);

    // Phần đầu xoay theo pitch
    this.head = new THREE.Group();
    this.head.position.y = BODY.eye;
    this.root.add(this.head);
    const white = material('#ffffff');
    const black = material('#111111');
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), white);
      eye.position.set(side * 0.12, 0.02, -0.3);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), black);
      pupil.position.set(0, 0, -0.055);
      eye.add(pupil);
      this.head.add(eye);
    }
    this.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.04), black);
    this.mouth.position.set(0, -0.15, -0.32);
    this.head.add(this.mouth);

    // Hai tay: buông thõng + đánh tay khi đi; khi cầm đồ thì vươn tới đồ
    this.arms = [-1, 1].map((side) => {
      const a = makeArm(color, 0.075, GLOVE);
      a.side = side;
      a.shoulder = new THREE.Vector3(side * 0.37, 1.22, -0.02);
      a.pos.set(side * 0.42, 0.72, 0);
      this.root.add(a.sleeve, a.hand);
      setArm(a, a.shoulder, a.pos);
      return a;
    });
    this.walk = 0;
    this.last = null;

    this.tag = nameTag(name, color);
    this.tag.position.y = 2.15;
    this.root.add(this.tag);

    this.mouthOpen = 0;
    scene.add(this.root);
  }

  /** feet: vị trí chân {x,y,z} */
  set(feet, yaw, pitch) {
    this.root.position.set(feet.x, feet.y, feet.z);
    this.root.rotation.y = yaw;
    this.head.rotation.x = clamp(pitch, -0.9, 0.9);
  }

  /**
   * Cập nhật tay mỗi frame. target: điểm (thế giới) đang cầm, hoặc null.
   * spread: nửa khoảng cách giữa hai tay khi cầm (đồ to thì dang rộng).
   */
  setArms(dt, target, spread = 0.18) {
    const p = this.root.position;
    const moved = this.last ? Math.hypot(p.x - this.last.x, p.z - this.last.z) : 0;
    this.last = { x: p.x, z: p.z };
    const speed = dt > 0 ? moved / dt : 0;
    this.walk += dt * Math.min(speed, 6) * 2.2;
    const swing = Math.min(1, speed / 3);
    let local = null;
    if (target) {
      this.root.updateMatrixWorld();
      local = this.root.worldToLocal(_v.set(target.x, target.y, target.z));
    }
    const k = 1 - Math.exp(-dt * 14);
    for (const a of this.arms) {
      const goal = new THREE.Vector3();
      if (local) {
        goal.set(local.x + a.side * spread, local.y, local.z).sub(a.shoulder);
        goal.setLength(Math.min(goal.length(), 0.66)).add(a.shoulder);
      } else {
        goal.set(a.side * 0.42, 0.74, Math.sin(this.walk + (a.side > 0 ? 0 : Math.PI)) * 0.22 * swing);
      }
      a.pos.lerp(goal, k);
      setArm(a, a.shoulder, a.pos);
    }
  }

  /** level 0..1 âm lượng giọng nói */
  setVoice(level) {
    this.mouthOpen += (level - this.mouthOpen) * 0.4;
    this.mouth.scale.y = 1 + this.mouthOpen * 6;
  }

  setVisible(v) {
    this.root.visible = v;
  }

  dispose() {
    this.root.removeFromParent();
  }
}

/**
 * Bộ điều khiển nhân vật dùng Rapier KinematicCharacterController.
 * Dùng cho người chơi local (input bàn phím) và bot trên host (input từ bot brain).
 */
export class Character {
  /**
   * @param {RAPIER.World} world
   * @param {{x:number,y:number,z:number}} feet vị trí chân ban đầu
   */
  constructor(world, feet, config) {
    this.world = world;
    this.config = config;
    const center = { x: feet.x, y: feet.y + BODY.halfHeight + BODY.radius, z: feet.z };
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(center.x, center.y, center.z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(BODY.halfHeight, BODY.radius), this.body);
    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.35, 0.2, true);
    this.controller.enableSnapToGround(0.3);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(70);
    this.yaw = 0;
    this.pitch = 0;
    this.vy = 0;
    this.grounded = false;
    this.ignoreCollider = null; // collider không va chạm (vd: đồ đang cầm)
  }

  /**
   * input: { moveX, moveZ (-1..1, theo hướng nhìn), jump, sprint, yaw, pitch }
   */
  step(dt, input) {
    const cfg = this.config.player;
    this.yaw = input.yaw;
    this.pitch = clamp(input.pitch, -1.45, 1.45);

    let mx = input.moveX ?? 0;
    let mz = input.moveZ ?? 0;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const speed = input.sprint ? cfg.sprintSpeed : cfg.walkSpeed;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward = -Z khi yaw = 0
    const dx = (mx * cos + mz * -sin) * speed;
    const dz = (mx * -sin + mz * -cos) * speed;

    if (this.grounded && input.jump) this.vy = cfg.jumpSpeed;
    this.vy -= this.config.physics.gravity * dt;
    if (this.vy < -30) this.vy = -30;

    const desired = { x: dx * dt, y: this.vy * dt, z: dz * dt };
    const ignore = this.ignoreCollider;
    this.controller.computeColliderMovement(this.collider, desired, undefined, undefined,
      ignore ? (c) => c.handle !== ignore.handle : undefined);
    const move = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = 0;
    // Đụng trần thì rơi xuống
    if (desired.y > 0 && move.y < desired.y * 0.5) this.vy = Math.min(this.vy, 0);

    const t = this.body.translation();
    const next = { x: t.x + move.x, y: t.y + move.y, z: t.z + move.z };
    // Rơi khỏi map → hồi về điểm cao
    if (next.y < -30) { next.y = 5; this.vy = 0; }
    this.body.setNextKinematicTranslation(next);
    this.position = next;
  }

  /** Vị trí chân hiện tại */
  feet() {
    const t = this.position ?? this.body.translation();
    return { x: t.x, y: t.y - BODY.halfHeight - BODY.radius, z: t.z };
  }

  eye() {
    const f = this.feet();
    return { x: f.x, y: f.y + BODY.eye, z: f.z };
  }

  teleport(feet) {
    const c = { x: feet.x, y: feet.y + BODY.halfHeight + BODY.radius, z: feet.z };
    this.body.setTranslation(c, true);
    this.position = c;
    this.vy = 0;
  }

  dispose() {
    this.world.removeCollider(this.collider, false);
    this.world.removeRigidBody(this.body);
    this.world.removeCharacterController(this.controller);
  }
}

/** Capsule kinematic cho người chơi khác (vị trí đặt theo mạng), để chặn và đẩy vật thể. */
export function proxyBody(world, feet) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(feet.x, feet.y + BODY.halfHeight + BODY.radius, feet.z));
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(BODY.halfHeight, BODY.radius), body);
  return {
    body,
    collider,
    set(f) {
      body.setNextKinematicTranslation({ x: f.x, y: f.y + BODY.halfHeight + BODY.radius, z: f.z });
    },
    dispose() {
      world.removeRigidBody(body);
    },
  };
}

/**
 * Tay góc nhìn thứ nhất, gắn vào camera. Khi cầm đồ: hai tay vươn tới điểm cầm
 * (dụng cụ `tool` thì chỉ tay phải cầm); khi đi thì nhún nhẹ.
 */
export class FirstPersonHands {
  constructor(camera, color, glove = GLOVE) {
    this.camera = camera;
    this.group = new THREE.Group();
    camera.add(this.group);
    this.arms = [-1, 1].map((side) => {
      const a = makeArm(color, 0.045, glove);
      a.side = side;
      a.shoulder = new THREE.Vector3(side * 0.34, -0.5, 0.1);
      a.pos.set(side * 0.3, -0.36, -0.42);
      for (const m of [a.sleeve, a.hand]) { m.castShadow = false; m.renderOrder = 10; this.group.add(m); }
      return a;
    });
    this.t = 0;
  }

  /** target: điểm cầm (thế giới) hoặc null. moving 0..1. tool: chỉ dùng tay phải. */
  update(dt, { target = null, moving = 0, tool = false, spread = 0.16 } = {}) {
    this.t += dt * (4 + moving * 6);
    const bob = Math.sin(this.t) * 0.012 * (0.3 + moving);
    let local = null;
    if (target) {
      this.camera.updateMatrixWorld();
      local = this.camera.worldToLocal(_v.set(target.x, target.y, target.z));
    }
    const k = 1 - Math.exp(-dt * 16);
    for (const a of this.arms) {
      const goal = new THREE.Vector3();
      const reach = local && (!tool || a.side > 0);
      if (reach) {
        goal.set(local.x + (tool ? 0 : a.side * spread), local.y, local.z);
        // Kéo điểm cầm về trong tầm tay (giữ hướng nhìn tới đồ)
        const len = goal.length();
        if (len > 0.95) goal.multiplyScalar(0.95 / len);
        goal.x = Math.max(-0.6, Math.min(0.6, goal.x));
        goal.y = Math.max(-0.55, Math.min(0.15, goal.y));
        goal.z = Math.max(-1.0, Math.min(-0.35, goal.z));
      } else {
        goal.set(a.side * 0.3, -0.4 + bob, -0.4);
      }
      a.pos.lerp(goal, k);
      setArm(a, a.shoulder, a.pos);
    }
  }

  setVisible(v) {
    this.group.visible = v;
  }
}
