// Proximity voice chat: WebRTC audio (lưới, mỗi cặp người chơi một cuộc gọi)
// + Web Audio PannerNode để tiếng to/nhỏ và có hướng theo vị trí trong game.
//
// Không có micro (từ chối quyền / không có thiết bị) vẫn nghe được người khác.

import { Emitter } from './util.js';

export class Voice extends Emitter {
  /**
   * @param {import('peerjs').Peer} peer
   * @param {{fullVolumeDist:number, maxDist:number, enabled:boolean}} config
   */
  constructor(peer, config) {
    super();
    this.peer = peer;
    this.config = config;
    this.audio = new AudioContext();
    this.local = null; // MediaStream micro
    this.localLevel = 0;
    this.muted = false;
    this.hasMic = false;
    /** @type {Map<string, {call:any, panner:PannerNode, analyser:AnalyserNode, el:HTMLAudioElement, level:number}>} */
    this.remotes = new Map();
    this.#buf = new Uint8Array(256);

    // Cuộc gọi đến trước khi micro sẵn sàng thì chờ, để bên kia nghe được mình.
    this.pending = [];
    peer.on('call', (call) => {
      if (!this.local) return this.pending.push(call);
      call.answer(this.local);
      this.#wire(call);
    });
  }

  #buf;
  /** Mọi cuộc gọi đang mở (kể cả chưa nhận được luồng) */
  #calls = new Set();
  #localAnalyser = null;

  async start() {
    // Không chờ resume(): khi chưa có thao tác người dùng, promise này treo mãi và chặn luôn micro.
    // AudioContext sẽ được resume lại ở lần click "Click để chơi".
    this.audio.resume().catch(() => {});

    // Kết nối ngay bằng luồng im lặng: người chơi nghe được người khác kể cả khi chưa (hoặc không) cấp quyền micro.
    this.local = this.audio.createMediaStreamDestination().stream;
    for (const call of this.pending.splice(0)) {
      call.answer(this.local);
      this.#wire(call);
    }
    this.emit('ready', { hasMic: false });

    // Xin micro ở nền; có micro thì thay track trong mọi cuộc gọi đang mở.
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const track = mic.getAudioTracks()[0];
      track.enabled = !this.muted;
      this.local = mic;
      this.hasMic = true;
      for (const call of this.#calls) this.#replaceTrack(call, track);
      const src = this.audio.createMediaStreamSource(mic);
      this.#localAnalyser = this.audio.createAnalyser();
      this.#localAnalyser.fftSize = 256;
      src.connect(this.#localAnalyser);
      this.emit('mic', { ok: true });
    } catch (err) {
      console.warn('[voice] Không dùng được micro:', err?.message);
      this.emit('mic', { ok: false, error: err?.message });
    }
  }

  #replaceTrack(call, track) {
    const sender = call.peerConnection?.getSenders().find((s) => s.track?.kind === 'audio' || s.track === null);
    sender?.replaceTrack(track).catch((e) => console.warn('[voice] replaceTrack lỗi:', e?.message));
  }

  /** Gọi cho các peer chưa kết nối. Peer có ID nhỏ hơn chủ động gọi, tránh gọi trùng. */
  connectTo(peerIds) {
    if (!this.local) return;
    for (const id of peerIds) {
      if (id === this.peer.id || this.remotes.has(id) || this.peer.id > id) continue;
      const call = this.peer.call(id, this.local);
      if (call) this.#wire(call);
    }
  }

  drop(peerId) {
    const r = this.remotes.get(peerId);
    if (!r) return;
    r.call.close();
    r.el.srcObject = null;
    r.panner.disconnect();
    this.remotes.delete(peerId);
  }

  #wire(call) {
    this.#calls.add(call);
    call.on('close', () => this.#calls.delete(call));
    call.on('stream', (stream) => {
      if (this.remotes.has(call.peer)) this.drop(call.peer);
      // Chrome chỉ phát luồng WebRTC qua Web Audio khi luồng cũng gắn vào một thẻ <audio>
      const el = new Audio();
      el.srcObject = stream;
      el.muted = true;
      el.play().catch(() => {});

      const src = this.audio.createMediaStreamSource(stream);
      const analyser = this.audio.createAnalyser();
      analyser.fftSize = 256;
      const panner = this.audio.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'linear';
      panner.refDistance = this.config.fullVolumeDist;
      panner.maxDistance = this.config.maxDist;
      panner.rolloffFactor = 1;
      src.connect(analyser);
      src.connect(panner).connect(this.audio.destination);
      this.remotes.set(call.peer, { call, panner, analyser, el, level: 0 });
      this.emit('connected', call.peer);
    });
    call.on('close', () => this.remotes.get(call.peer)?.call === call && this.drop(call.peer));
    call.on('error', () => this.remotes.get(call.peer)?.call === call && this.drop(call.peer));
  }

  setMuted(m) {
    this.muted = m;
    for (const t of this.local?.getAudioTracks() ?? []) t.enabled = !m;
  }

  /** Cập nhật vị trí người nghe (camera). */
  setListener(pos, forward) {
    const l = this.audio.listener;
    const t = this.audio.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.05);
      l.positionY.setTargetAtTime(pos.y, t, 0.05);
      l.positionZ.setTargetAtTime(pos.z, t, 0.05);
      l.forwardX.setTargetAtTime(forward.x, t, 0.05);
      l.forwardY.setTargetAtTime(forward.y, t, 0.05);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.05);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  /** Cập nhật vị trí miệng của một người chơi khác. */
  setSource(peerId, pos) {
    const r = this.remotes.get(peerId);
    if (!r) return;
    const t = this.audio.currentTime;
    r.panner.positionX.setTargetAtTime(pos.x, t, 0.05);
    r.panner.positionY.setTargetAtTime(pos.y, t, 0.05);
    r.panner.positionZ.setTargetAtTime(pos.z, t, 0.05);
  }

  /** Âm lượng 0..1 (để nhép miệng). peerId = null → micro của mình. */
  level(peerId = null) {
    const analyser = peerId ? this.remotes.get(peerId)?.analyser : this.#localAnalyser;
    if (!analyser || (peerId === null && this.muted)) return 0;
    analyser.getByteTimeDomainData(this.#buf);
    let sum = 0;
    for (let i = 0; i < this.#buf.length; i++) {
      const v = (this.#buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / this.#buf.length) * 4);
  }

  dispose() {
    for (const id of [...this.remotes.keys()]) this.drop(id);
    for (const t of this.local?.getTracks() ?? []) t.stop();
    this.audio.close();
  }
}
