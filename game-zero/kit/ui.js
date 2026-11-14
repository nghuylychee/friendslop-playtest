// Giao diện dùng chung: sảnh chờ (tạo/vào phòng), HUD, thông báo, màn kết quả.
// Game có thể thêm HTML riêng vào ui.hud (góc trên phải) hoặc ui.center.

import { params } from './util.js';

const CSS = `
.fsf-root{position:fixed;inset:0;pointer-events:none;font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;z-index:10}
.fsf-root *{box-sizing:border-box}
.fsf-panel{pointer-events:auto;background:rgba(16,17,20,.88);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:24px;backdrop-filter:blur(6px)}
.fsf-lobby{position:absolute;inset:0;display:grid;place-items:center;background:rgba(10,12,16,.55);pointer-events:auto}
.fsf-lobby .fsf-panel{width:min(400px,calc(100vw - 32px))}
.fsf-lobby h1{margin:0 0 4px;font-size:28px}
.fsf-lobby p{margin:0 0 20px;color:#b8bcc6}
.fsf-label{display:block;margin:12px 0 6px;color:#b8bcc6;font-size:13px}
.fsf-input{width:100%;padding:11px 12px;border-radius:9px;border:1px solid #3a3e48;background:#0e0f12;color:#fff;font:inherit}
.fsf-input.code{text-transform:uppercase;letter-spacing:.2em;font-weight:700;text-align:center}
.fsf-row{display:flex;gap:8px;margin-top:8px}
.fsf-btn{flex:1;padding:12px;border:0;border-radius:9px;font:inherit;font-weight:700;cursor:pointer;background:#2b2f38;color:#fff}
.fsf-btn.primary{background:#ffcf3f;color:#1a1400}
.fsf-btn:disabled{opacity:.5;cursor:wait}
.fsf-or{margin:16px 0 4px;text-align:center;color:#6f7480;font-size:13px}
.fsf-error{margin-top:12px;color:#ff8787;min-height:1.4em}
.fsf-hint{margin-top:14px;color:#8a8f9a;font-size:12px}
.fsf-tl{position:absolute;top:12px;left:12px;display:flex;flex-direction:column;gap:8px;max-width:260px}
.fsf-tr{position:absolute;top:12px;right:12px;text-align:right}
.fsf-chip{pointer-events:auto;background:rgba(16,17,20,.75);border-radius:10px;padding:8px 12px}
.fsf-code{font-weight:800;letter-spacing:.15em;font-size:18px}
.fsf-copy{margin-left:8px;padding:3px 8px;font-size:12px;border-radius:6px;border:0;background:#3a3e48;color:#fff;cursor:pointer}
.fsf-players{list-style:none;margin:0;padding:0}
.fsf-players li{display:flex;align-items:center;gap:8px;padding:2px 0}
.fsf-dot{width:10px;height:10px;border-radius:50%}
.fsf-talk{margin-left:auto;opacity:.2}
.fsf-talk.on{opacity:1}
.fsf-cross{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px rgba(0,0,0,.4)}
.fsf-cross.hit{width:14px;height:14px;margin:-7px 0 0 -7px;background:transparent;border:2px solid #ffcf3f}
.fsf-prompt{position:absolute;left:50%;top:calc(50% + 28px);transform:translateX(-50%);background:rgba(0,0,0,.55);padding:5px 10px;border-radius:8px;font-size:14px;font-weight:600;white-space:nowrap}
.fsf-click{position:absolute;inset:0;display:grid;place-items:center;pointer-events:auto;cursor:pointer;background:rgba(0,0,0,.35)}
.fsf-click .fsf-panel{text-align:center}
.fsf-play{font-size:20px;letter-spacing:.02em}
.fsf-kbd{display:inline-block;min-width:1.6em;padding:1px 6px;margin:0 3px;border-radius:5px;background:#fff;color:#111;font:700 12px/1.5 system-ui,sans-serif;text-align:center;box-shadow:0 2px 0 rgba(0,0,0,.45)}
.fsf-toasts{position:absolute;top:70px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px}
.fsf-toast{background:rgba(16,17,20,.85);padding:8px 14px;border-radius:999px;animation:fsf-fade 3.2s forwards}
@keyframes fsf-fade{0%{opacity:0;transform:translateY(-6px)}8%,80%{opacity:1;transform:none}100%{opacity:0}}
.fsf-center{position:absolute;left:50%;top:22%;transform:translateX(-50%);text-align:center;text-shadow:0 2px 8px rgba(0,0,0,.6)}
.fsf-modal{position:absolute;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.5);pointer-events:auto}
.fsf-modal .fsf-panel{min-width:min(360px,calc(100vw - 32px));text-align:center}
.fsf-modal h2{margin:0 0 8px;font-size:26px}
`;

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) e.append(c);
  return e;
}

/** "[E] Pick up · [Click] Use" → các node với phím dạng <kbd>. */
export function keyChips(text) {
  return String(text).split(/(\[[^\]]+\])/).filter(Boolean)
    .map((part) => (part.startsWith('[') ? el('kbd', { class: 'fsf-kbd', text: part.slice(1, -1) }) : document.createTextNode(part)));
}

export class UI {
  constructor({ title, subtitle = '' }) {
    this.title = title;
    this.subtitle = subtitle;
    document.head.append(el('style', { text: CSS }));
    this.root = el('div', { class: 'fsf-root' });
    document.body.append(this.root);
  }

  /** Hiện sảnh chờ, trả về { mode: 'host'|'join', name, code }. onSubmit(choice) phải trả Promise; lỗi sẽ hiện lên. */
  lobby(onSubmit) {
    const q = params();
    const savedName = localStorage.getItem('fsf-name') || '';
    const name = el('input', { class: 'fsf-input', maxlength: 16, placeholder: 'Your name', value: q.get('name') || savedName });
    const code = el('input', { class: 'fsf-input code', maxlength: 5, placeholder: 'ROOM CODE', value: q.get('room') || '' });
    const error = el('div', { class: 'fsf-error' });
    const hostBtn = el('button', { class: 'fsf-btn', text: 'Create room' });
    const joinBtn = el('button', { class: 'fsf-btn primary', text: 'Join' });
    if (!q.get('room')) { hostBtn.className = 'fsf-btn primary'; joinBtn.className = 'fsf-btn'; }

    const panel = el('div', { class: 'fsf-panel' }, [
      el('h1', { text: this.title }),
      this.subtitle ? el('p', { text: this.subtitle }) : null,
      name,
      el('div', { class: 'fsf-row' }, [hostBtn]),
      el('div', { class: 'fsf-or', text: 'or' }),
      code,
      el('div', { class: 'fsf-row' }, [joinBtn]),
      error,
      el('div', { class: 'fsf-hint', text: '🎧 Mic + headphones' }),
    ]);
    const wrap = el('div', { class: 'fsf-lobby' }, panel);
    this.root.append(wrap);

    return new Promise((resolve) => {
      const submit = async (mode) => {
        const n = name.value.trim() || `Player ${Math.floor(Math.random() * 90 + 10)}`;
        const c = code.value.trim().toUpperCase();
        if (mode === 'join' && c.length < 4) { error.textContent = 'Enter a room code'; return; }
        localStorage.setItem('fsf-name', n);
        hostBtn.disabled = joinBtn.disabled = true;
        error.textContent = mode === 'host' ? 'Creating…' : 'Joining…';
        try {
          const result = await onSubmit({ mode, name: n, code: c });
          wrap.remove();
          resolve(result);
        } catch (err) {
          console.error(err);
          error.textContent = err?.message || String(err);
          hostBtn.disabled = joinBtn.disabled = false;
        }
      };
      hostBtn.onclick = () => submit('host');
      joinBtn.onclick = () => submit('join');
      code.addEventListener('keydown', (e) => e.key === 'Enter' && submit('join'));
      // Chế độ tự động (bot headless / test): ?auto=host hoặc ?room=CODE&auto=join
      const auto = q.get('auto');
      if (auto === 'host' || auto === 'join') setTimeout(() => submit(auto), 50);
    });
  }

  /** Dựng HUD sau khi vào phòng. */
  hud({ code, link, isHost }) {
    this.cross = el('div', { class: 'fsf-cross' });
    this.prompt = el('div', { class: 'fsf-prompt' });
    this.prompt.style.display = 'none';
    this.playerList = el('ul', { class: 'fsf-players' });
    this.mic = el('span', { text: '🎙️' });
    const copy = el('button', { class: 'fsf-copy', text: 'Copy link' });
    copy.onclick = () => {
      navigator.clipboard?.writeText(link);
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy link'), 1500);
    };
    this.tl = el('div', { class: 'fsf-tl' }, [
      el('div', { class: 'fsf-chip' }, [el('span', { class: 'fsf-code', text: code }), copy]),
      el('div', { class: 'fsf-chip' }, [this.playerList]),
    ]);
    this.hudBox = el('div', { class: 'fsf-tr' });
    this.center = el('div', { class: 'fsf-center' });
    this.toasts = el('div', { class: 'fsf-toasts' });
    this.clickLayer = el('div', { class: 'fsf-click' }, el('div', { class: 'fsf-panel' }, [
      el('strong', { class: 'fsf-play', text: '▶  Click to play' }),
    ]));
    this.root.append(this.cross, this.prompt, this.tl, this.hudBox, this.center, this.toasts, this.clickLayer);
  }

  setLocked(locked) {
    if (this.clickLayer) this.clickLayer.style.display = locked ? 'none' : 'grid';
  }

  /** players: [{id, name, color, talking, isBot, isSelf}] */
  setPlayers(players) {
    this.playerList.replaceChildren(...players.map((p) => el('li', {}, [
      el('span', { class: 'fsf-dot', style: `background:${p.color}` }),
      el('span', { text: `${p.name}${p.isSelf ? ' (you)' : ''}${p.isBot ? ' 🤖' : ''}` }),
      el('span', { class: `fsf-talk${p.talking ? ' on' : ''}`, text: p.muted ? '🔇' : '🔊' }),
    ])));
  }

  setCrosshair(hit, promptText = '') {
    this.cross.className = `fsf-cross${hit ? ' hit' : ''}`;
    this.prompt.style.display = promptText ? 'block' : 'none';
    if (promptText !== this.promptText) {
      this.promptText = promptText;
      this.prompt.replaceChildren(...keyChips(promptText));
    }
  }

  /** Dòng chữ lớn giữa trên màn hình; hỗ trợ phím dạng "[G] Start". */
  setCenter(text, css = '') {
    if (text === this.centerText && css === this.centerCss) return;
    this.centerText = text;
    this.centerCss = css;
    this.center.replaceChildren(...keyChips(text));
    this.center.style.cssText = css;
  }

  toast(text) {
    const t = el('div', { class: 'fsf-toast' }, keyChips(text));
    this.toasts.append(t);
    setTimeout(() => t.remove(), 3300);
  }

  /** Hộp thoại giữa màn hình. buttons: [{text, primary, onClick}] */
  modal({ title, body = '', buttons = [] }) {
    this.closeModal();
    const panel = el('div', { class: 'fsf-panel' }, [
      el('h2', { text: title }),
      typeof body === 'string' ? el('p', { text: body }) : body,
      el('div', { class: 'fsf-row' }, buttons.map((b) => el('button', {
        class: `fsf-btn${b.primary ? ' primary' : ''}`, text: b.text, onclick: () => { this.closeModal(); b.onClick?.(); },
      }))),
    ]);
    this.modalEl = el('div', { class: 'fsf-modal' }, panel);
    this.root.append(this.modalEl);
    document.exitPointerLock?.();
  }

  closeModal() {
    this.modalEl?.remove();
    this.modalEl = null;
  }

  fatal(message) {
    this.modal({ title: 'Disconnected', body: message, buttons: [{ text: 'Back', primary: true, onClick: () => location.assign(location.pathname) }] });
  }
}
