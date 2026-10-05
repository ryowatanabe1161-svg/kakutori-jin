// 角取り陣 — 接続設定（TURNサーバーを使う場合は iceServers に追加）
window.KJ_CONFIG = {
  peer: {},
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }]
};
