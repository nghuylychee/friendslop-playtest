// Input bàn phím + chuột với pointer lock.
//
//   input.down('KeyW')       đang giữ phím?
//   input.pressed('KeyE')    vừa nhấn trong frame này?
//   input.consume('KeyE')    đánh dấu đã xử lý (code chạy sau không thấy nữa)
//   input.mouse.left / right / leftPressed / rightPressed
//   input.consumeLook()      → [dx, dy] chuột từ frame trước

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.justPressed = new Set();
    this.mouse = { left: false, right: false, leftPressed: false, rightPressed: false, wheel: 0 };
    this.look = [0, 0];
    this.locked = false;
    this.enabled = true;
    this.sensitivity = 0.0022;

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.look[0] += e.movementX;
      this.look[1] += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.keys.clear();
    });
  }

  lock() {
    if (!this.locked) this.canvas.requestPointerLock?.()?.catch?.(() => {});
  }

  down(code) {
    return this.enabled && this.keys.has(code);
  }

  pressed(code) {
    return this.enabled && this.justPressed.has(code);
  }

  /** Đánh dấu phím đã được xử lý trong frame này (pressed() trả false cho phần code chạy sau). */
  consume(code) {
    this.justPressed.delete(code);
  }

  consumeLook() {
    const l = this.look;
    this.look = [0, 0];
    return this.enabled ? [l[0] * this.sensitivity, l[1] * this.sensitivity] : [0, 0];
  }

  /** Gọi cuối mỗi frame. */
  endFrame() {
    this.justPressed.clear();
    this.mouse.leftPressed = false;
    this.mouse.rightPressed = false;
    this.mouse.wheel = 0;
  }
}
