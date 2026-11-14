// Render 3D low-poly bằng Three.js: scene, camera, ánh sáng, bóng, resize.

import * as THREE from 'three';

export function createRenderer({ canvas, sky = '#9fd3ff', fog = [30, 90], shadows = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sky);
  if (fog) scene.fog = new THREE.Fog(sky, fog[0], fog[1]);

  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 300);
  camera.rotation.order = 'YXZ';
  scene.add(camera); // để gắn đồ vật vào camera nếu cần

  const hemi = new THREE.HemisphereLight('#ffffff', '#6b7b5a', 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  sun.position.set(18, 30, 12);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(2048, 2048);
  const s = 30;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 90 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  function resize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  return { THREE, renderer, scene, camera, sun, hemi, resize };
}

/** Vật liệu low-poly mặc định (flat shading, mờ). */
export function material(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...opts });
}

/** Tạo mesh từ mô tả hình học đơn giản. shape: box | ball | cylinder. */
export function primitiveMesh({ shape = 'box', size = [1, 1, 1], color = '#cccccc', castShadow = true, receiveShadow = true }) {
  let geo;
  if (shape === 'ball') geo = new THREE.IcosahedronGeometry(size[0], 1);
  else if (shape === 'cylinder') geo = new THREE.CylinderGeometry(size[0], size[0], size[1], 10);
  else geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const mesh = new THREE.Mesh(geo, material(color));
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

/** Bảng tên nổi trên đầu, luôn quay về camera. */
export function nameTag(text, color = '#ffffff') {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = 'bold 44px system-ui, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 40;
  c.width = w;
  c.height = 72;
  ctx.font = font;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 72, 20);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set((w / 72) * 0.32, 0.32, 1);
  sprite.renderOrder = 10;
  return sprite;
}
