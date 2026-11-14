// Mọi tham số tuning của Game Zero. Kit tự gộp với DEFAULT_CONFIG trong kit/app.js.
export default {
  maxPlayers: 4,
  player: { spawn: [0, 0, 1.5] },
  physics: { impactSpeed: 3.5 },
  round: { seconds: 180, quota: 700 },
  damage: { fragileMul: 25, normalMul: 6 }, // tiền mất cho mỗi m/s vượt ngưỡng va chạm
  truck: { min: [-1.9, 0.85, 6.1], max: [1.9, 3, 10.9] },
};
