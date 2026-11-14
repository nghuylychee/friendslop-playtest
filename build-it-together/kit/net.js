// Mạng P2P qua PeerJS, mô hình host-authoritative (hình sao):
//   - Host mở peer với ID cố định `fsf-<gameId>-<CODE>`.
//   - Client kết nối data channel tới host. Mọi message đi qua host.
//   - Voice là kết nối riêng (lưới), xem voice.js.
//
// Message: { t: type, d: data }

import { Peer } from 'peerjs';
import { Emitter, roomCode } from './util.js';

const PREFIX = 'fsf-';
const OPEN_TIMEOUT = 12000;

export const hostPeerId = (gameId, code) => `${PREFIX}${gameId}-${code}`.toLowerCase();

function openPeer(id, options) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, options) : new Peer(options);
    const timer = setTimeout(() => {
      peer.destroy();
      reject(new Error('Cannot reach the server. Check your connection.'));
    }, OPEN_TIMEOUT);
    peer.once('open', () => {
      clearTimeout(timer);
      resolve(peer);
    });
    peer.once('error', (err) => {
      clearTimeout(timer);
      peer.destroy();
      reject(err);
    });
  });
}

export class Room extends Emitter {
  /**
   * @param {Peer} peer
   * @param {{isHost:boolean, code:string, gameId:string, name:string}} info
   */
  constructor(peer, info) {
    super();
    this.peer = peer;
    this.isHost = info.isHost;
    this.code = info.code;
    this.gameId = info.gameId;
    this.name = info.name;
    this.selfId = peer.id;
    this.hostId = info.isHost ? peer.id : hostPeerId(info.gameId, info.code);
    /** @type {Map<string, import('peerjs').DataConnection>} */
    this.conns = new Map();
    this.closed = false;

    // Mất kết nối signaling không làm rớt data channel đang có; thử nối lại để còn nhận người mới / voice.
    peer.on('disconnected', () => {
      if (!this.closed && !peer.destroyed) setTimeout(() => peer.reconnect(), 1000);
    });
  }

  /** Tạo phòng. Thử vài mã nếu mã bị trùng. */
  static async host({ gameId, name, peerOptions = {} }) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = roomCode();
      try {
        const peer = await openPeer(hostPeerId(gameId, code), { debug: 1, ...peerOptions });
        const room = new Room(peer, { isHost: true, code, gameId, name });
        peer.on('connection', (conn) => room.#accept(conn));
        return room;
      } catch (err) {
        if (err?.type !== 'unavailable-id') throw err;
      }
    }
    throw new Error('Could not create a room. Try again.');
  }

  /** Vào phòng bằng mã. */
  static async join({ gameId, code, name, peerOptions = {} }) {
    const peer = await openPeer(undefined, { debug: 1, ...peerOptions });
    const room = new Room(peer, { isHost: false, code: code.toUpperCase(), gameId, name });
    await new Promise((resolve, reject) => {
      const conn = peer.connect(room.hostId, { reliable: true, serialization: 'json', metadata: { name } });
      const timer = setTimeout(() => reject(new Error('Could not join (timed out).')), OPEN_TIMEOUT);
      const onError = (err) => {
        clearTimeout(timer);
        reject(err?.type === 'peer-unavailable' ? new Error(`Room ${room.code} not found.`) : err);
      };
      peer.once('error', onError);
      conn.once('open', () => {
        clearTimeout(timer);
        peer.off('error', onError);
        room.#wire(conn);
        resolve();
      });
    });
    return room;
  }

  #accept(conn) {
    conn.once('open', () => {
      this.#wire(conn);
      this.emit('peer-join', { id: conn.peer, name: String(conn.metadata?.name ?? 'Player').slice(0, 20) });
    });
  }

  #wire(conn) {
    this.conns.set(conn.peer, conn);
    conn.on('data', (msg) => {
      if (!msg || typeof msg.t !== 'string') return;
      this.emit('message', { from: conn.peer, type: msg.t, data: msg.d });
    });
    const gone = () => {
      if (!this.conns.has(conn.peer)) return;
      this.conns.delete(conn.peer);
      if (this.isHost) this.emit('peer-leave', { id: conn.peer });
      else if (!this.closed) this.emit('host-lost');
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  /** Gửi tới một peer. */
  send(to, type, data) {
    const conn = this.conns.get(to);
    if (conn?.open) conn.send({ t: type, d: data });
  }

  /** Host: gửi tới mọi client (trừ `except`). */
  broadcast(type, data, except) {
    for (const [id, conn] of this.conns) if (id !== except && conn.open) conn.send({ t: type, d: data });
  }

  /** Client: gửi lên host. */
  toHost(type, data) {
    this.send(this.hostId, type, data);
  }

  /** Host: đá một client. */
  kick(id) {
    this.conns.get(id)?.close();
  }

  close() {
    this.closed = true;
    for (const conn of this.conns.values()) conn.close();
    this.peer.destroy();
  }
}
