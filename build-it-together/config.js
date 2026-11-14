// Mọi tham số tuning của Build It Together (gộp với DEFAULT_CONFIG của kit).
export default {
  maxPlayers: 4,
  player: { walkSpeed: 4.0, reach: 3.0, spawn: [0, 0, 5], glove: '#f59f00' }, // găng tay vàng thợ hồ
  grab: { maxForce: 450 },
  physics: { solverIterations: 8, weldBreak: 0.05, impactSpeed: 99 }, // impactSpeed cao: game này không tính va đập

  stars: [420, 600], // xong trước 7:00 → ★★★, trước 10:00 → ★★, còn lại ★ (giây)
  snap: { dist: 0.9, hz: 10 }, // khoảng cách hít vào ô (m), tần suất kiểm tra
  score: { standDist: 0.35 }, // khối lệch khỏi ô quá 2× khoảng này thì coi như rơi khỏi ô (m)

  // Trộn vữa: thả bao xi măng vào máy → trộn vài giây → ra vữa
  mixer: { pos: [7.5, 3.5], feedRadius: 1.3, mixSeconds: 4, perBag: 8, max: 24 }, // m, s, lượt trát mỗi bao, tối đa
  cement: { size: [0.7, 0.22, 0.45], mass: 25, supply: 4, pallet: [7.6, 10.5], respawn: 1.5 }, // kg, số bao luôn có sẵn, s
  // Cái bay: múc vữa ở máy trộn, click vào khối đã đặt để trát (mỗi khối 1 lượt)
  trowel: { count: 2, cap: 6, mass: 1.5, table: [9.6, 4.2], holdDist: 0.85 },

  // Cẩu tháp: đứng ở bàn điều khiển để lái; móc được mọi khối
  crane: {
    mast: [-8.5, -4.5], height: 22, booth: [-6.3, -2.2],
    start: [0.49, 6, 9], // góc quay (rad), bán kính xe con (m), độ cao móc (m)
    rMin: 3, rMax: 20, yMin: 0.8, yMax: 13,
    speed: 3.2, hoist: 2.5, // m/s theo phương ngang, m/s lên xuống
    hookRadius: 1.6, hang: 0.9, // tầm bắt khối (m), khối treo dưới móc (m)
    stiffness: 14, damping: 5, maxAccel: 22, sendHz: 12, // lò xo kéo khối theo móc
  },

  // Khu phố: nhà đã xây xong được giữ lại trên các lô quanh công trường [x, z, góc quay]
  town: {
    plots: [[-5, -15, 0], [5, -15, 0], [-15, -15, 0], [15, -15, 0], [-19, 3, Math.PI / 2], [19, 3, -Math.PI / 2], [-19, 12, Math.PI / 2], [19, 12, -Math.PI / 2]],
  },

  // Khối: kích thước (m), khối lượng (kg)
  blocks: {
    cot: { name: 'Column', size: [0.4, 2.0, 0.4], mass: 30 },
    gach: { name: 'Brick wall', size: [1.38, 0.98, 0.3], mass: 18 },
    dam: { name: 'Beam', size: [0.3, 0.3, 3.6], mass: 55 },
    san: { name: 'Slab', size: [3.6, 0.2, 3.6], mass: 75 }, // 2 người khiêng, hoặc dùng cẩu
    mai: { name: 'Roof', size: [3.8, 0.2, 3.8], mass: 75 },
  },
};
