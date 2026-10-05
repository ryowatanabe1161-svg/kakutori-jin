/* 角取り陣 オンライン版
 * 構成：WebRTC（PeerJS）による P2P。ホストのブラウザが唯一の正（authoritative）で、合法手チェック・ふーさん🐻の手もホストが行います。
 * 盤面は全員に公開の情報なので、全員に同じ盤面を送ります（自分の色の判定は各端末でも計算してハイライトに使います）。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var L = window.KJ, N = L.N;
  var Q = new URLSearchParams(location.search);
  var CFG = window.KJ_CONFIG || {};
  var ICE = (CFG.iceServers && CFG.iceServers.length) ? CFG.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }];
  if (Q.get('ice')) ICE = Q.get('ice').split(',').map(function (u) { return { urls: u }; });   // テスト・独自環境用
  var PEER_OPTS = Object.assign({ debug: 1, config: { iceServers: ICE } }, CFG.peer || {});
  var ID_PREFIX = 'kakutori-jin-v1-', CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var TURBO = Q.has('turbo');
  var T = TURBO ? { cpu: [120, 260], autoPass: 1500, offPass: 1500, awaken: 3000 } : { cpu: [650, 1300], autoPass: 25000, offPass: 6000, awaken: 3100 };
  var MAX_HUMANS = 4, HB_MS = 3000, LOST_MS = 10000;
  var COL = [
    { n: '藍', f: '#2f6fd6', d: '#1b4594', l: '#79a6f2' },
    { n: '山吹', f: '#f2b705', d: '#b07f00', l: '#ffd85e' },
    { n: '紅', f: '#d93a3a', d: '#962121', l: '#f27b7b' },
    { n: '若竹', f: '#2fa35a', d: '#1c6e3b', l: '#6fd197' }
  ];
  var LV = { weak: '弱い', normal: '普通', strong: '強い', ultra: 'アストラウルトラ😎' };
  var LV_KEYS = ['weak', 'normal', 'strong', 'ultra'];
  var BEAR = '🐻', CPU_BASE = 'ふーさん' + BEAR;
  var CPU_LINES = {
    weak: ['えいっ、ここにするクマ！', 'どこに置こうかな〜クマ', 'なんとなく ここクマ♪'],
    normal: ['大きいのから置くクマ！', 'ここは いい角クマね', 'じわじわ広げるクマ〜'],
    strong: ['その角、いただきクマ！', 'ここをふさいでおくクマ', 'まんなかを取るクマ！'],
    ultra: ['フッ…読み通りだクマ😎', 'その未来、すでに見えているクマ', '角は すべて ふーさんのものクマ', '逃げ道は ないクマ…😎'],
    pass: ['もう置けないクマ…パスするクマ', 'ここまでクマ〜']
  };
  var LS_ID = 'kj-client-id', LS_NAME = 'kj-name', LS_HOST = 'kj-host-room', SS_CLIENT = 'kj-joined';
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {} }
  function load(k, json) { try { var v = localStorage.getItem(k); return json ? JSON.parse(v) : v; } catch (e) { return null; } }
  function sstore(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function sload(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } }
  function rid(n) { var s = ''; for (var i = 0; i < n; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]; return s; }
  var myId = load(LS_ID) || (function () { var v = rid(16); store(LS_ID, v); return v; })();
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function rand(a) { return a[0] + Math.random() * (a[1] - a[0]); }
  function cleanName(n) { return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 8); }
  function genCode() { var c = ''; for (var i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return c; }
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1').slice(0, 4); }
  function inviteUrl(code) { var u = location.origin + location.pathname + '?room=' + code; if (Q.get('ice')) u += '&ice=' + encodeURIComponent(Q.get('ice')); return u; }
  function colorOf(i) { return COLORS[i % COLORS.length]; }

  // ---------- 汎用UI ----------
  function show(id) { ['title', 'lobby', 'game', 'end'].forEach(function (s) { $(s).classList.toggle('active', s === id); }); }
  function overlay(id, on) { $(id).classList.toggle('active', on); }
  var toastT;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 3000); }
  function banner(msg) { var b = $('banner'); b.textContent = msg || ''; b.classList.toggle('show', !!msg); }
  function confirmBox(title, text, yes, cb) {
    $('cfTitle').textContent = title; $('cfText').textContent = text; $('cfYes').textContent = yes; $('cfNo').style.display = '';
    overlay('confirmModal', true);
    $('cfYes').onclick = function () { overlay('confirmModal', false); cb(); };
    $('cfNo').onclick = function () { overlay('confirmModal', false); };
  }
  function alertBox(msg) { confirmBox('お知らせ', msg, 'OK', function () {}); $('cfNo').style.display = 'none'; }
  function connecting(on, title, text, onCancel) {
    overlay('connecting', on);
    if (on) { $('connTitle').textContent = title || '接続中…'; $('connText').textContent = text || ''; $('connCancel').onclick = onCancel || function () { location.href = location.pathname; }; }
  }
  $('rulesBtn1').onclick = $('rulesBtn2').onclick = function () { overlay('rulesModal', true); };
  $('rulesClose').onclick = function () { overlay('rulesModal', false); };
  ['rulesModal', 'menuModal'].forEach(function (id) { $(id).addEventListener('click', function (e) { if (e.target === this) overlay(id, false); }); });

  // =====================================================================
  //  ホスト（authoritative）
  // =====================================================================
  var host = null;
  function hostId(code) { return ID_PREFIX + code; }
  function newRoom(name) {
    return { code: genCode(), phase: 'lobby', opts: { lv: ['normal', 'normal', 'normal', 'normal'], two: false }, nextSid: 2, gameNo: 0,
      seats: [{ sid: 1, name: name, kind: 'host', clientId: myId, connected: true }], G: null, notice: null, lobbyReq: null };
  }
  function startHost(name, resumeRoom) {
    document.body.classList.add('is-host');
    if (resumeRoom && resumeRoom.G) resumeRoom.G.S.board = Int8Array.from(resumeRoom.G.S.board);
    host = { room: resumeRoom || newRoom(name), conns: {}, lastSeen: {}, tries: 0, opened: false };
    if (resumeRoom) host.room.seats.forEach(function (s) { if (s.kind === 'remote') s.connected = false; });
    connecting(true, resumeRoom ? '部屋を再開しています…' : '部屋を作っています…', 'シグナリングサーバーに接続中', function () { location.href = location.pathname; });
    openHostPeer();
    setInterval(hostHeartbeat, 2000);
    setInterval(hostTick, TURBO ? 40 : 100);
  }
  // 色の担当：人間は参加順に 藍→山吹→紅→若竹。空いた色は ふーさん。2人で「1人2色」なら 藍+紅 / 山吹+若竹
  function planOwners(seats, opts) {
    var two = opts.two && seats.length === 2, out = [], c;
    for (c = 0; c < 4; c++) { var h = two ? seats[c % 2] : seats[c]; out.push(h ? { kind: 'human', sid: h.sid, name: h.name } : { kind: 'cpu', lv: opts.lv[c], name: '' }); }
    var cpus = out.filter(function (o) { return o.kind === 'cpu'; });
    cpus.forEach(function (o, i) { o.name = cpus.length > 1 ? CPU_BASE + (i + 1) : CPU_BASE; });
    return out;
  }
  function hostStartGame() {
    var R = host.room;
    if (!R.seats.length) return;
    R.gameNo++; R.lobbyReq = null;
    var owners = planOwners(R.seats, R.opts), ultra = owners.some(function (o) { return o.kind === 'cpu' && o.lv === 'ultra'; });
    R.G = { S: L.newState(), owners: owners, two: R.opts.two && R.seats.length === 2, ultra: ultra, startAt: Date.now() + (ultra ? T.awaken : 500), cpuAt: 0, started: false, last: null, log: [], logId: 0, turnAt: Date.now(), noMove: false };
    R.phase = 'game'; prepTurn();
    hostBroadcast();
  }
  function log(c, text) { var G = host.room.G; G.log.push({ id: ++G.logId, c: c, text: text }); if (G.log.length > 3) G.log.shift(); }
  // 手番の準備：ふーさんが置けなければ自動でパスして次へ
  function prepTurn() {
    var R = host.room, G = R.G, S = G.S;
    for (var guard = 0; guard < 8; guard++) {
      var c = S.turn;
      if (c < 0 || L.gameOver(S)) { R.phase = 'end'; S.turn = -1; return; }
      G.turnAt = Date.now(); G.cpuAt = 0; G.noMove = !L.hasMove(S, c);
      if (G.noMove && G.owners[c].kind === 'cpu') { L.pass(S, c); log(c, pick(CPU_LINES.pass)); L.advance(S); continue; }
      return;
    }
  }
  function applyMove(c, m) {
    var G = host.room.G, S = G.S, o = G.owners[c];
    var cells = L.place(S, c, m);
    G.last = { c: c, cells: cells };
    if (o.kind === 'cpu' && Math.random() < (o.lv === 'ultra' ? 0.45 : 0.3)) log(c, pick(CPU_LINES[o.lv]));
    if (!S.rem[c].length) log(c, '21個 ぜんぶ置いた！' + (m.p === 0 ? ' 最後は1マスで +20点！' : ' +15点！'));
    L.advance(S); prepTurn(); hostBroadcast();
  }
  function doPass(c, auto) {
    var G = host.room.G, S = G.S;
    L.pass(S, c); log(c, (auto ? '時間切れで' : '') + 'パス（もう置けません）');
    L.advance(S); prepTurn(); hostBroadcast();
  }
  function hostAction(sid, m) {
    var R = host.room, G = R.G; if (!G || R.phase !== 'game') return null;
    var S = G.S, c = S.turn, o = G.owners[c];
    if (c < 0 || !o || o.kind !== 'human' || o.sid !== sid) return 'あなたの番ではありません';
    if (Date.now() < G.startAt) return null;
    if (m.t === 'place') {
      var p = m.p | 0, oi = m.o | 0, x = m.x | 0, y = m.y | 0, why = L.whyIllegal(S, c, p, oi, x, y);
      if (why) return { edge: '自分の色と辺がくっついています', nocorner: '自分の色と角でつながっていません', corner: '最初はスタートの角をおおってね', overlap: 'ほかのピースと重なっています', outside: '盤からはみ出しています', used: 'そのピースはもう使いました' }[why] || '置けません';
      applyMove(c, { p: p, o: oi, x: x, y: y }); return null;
    }
    if (m.t === 'pass') { if (L.hasMove(S, c)) return 'まだ置ける場所があります'; doPass(c); return null; }
    return null;
  }
  function hostTick() {
    if (!host || !host.opened) return;
    var R = host.room, G = R.G, now = Date.now();
    if (R.phase !== 'game' || !G) return;
    var S = G.S, c = S.turn; if (c < 0) return;
    // 代打ちしていた ふーさん → 本人が戻ったら返す
    G.owners.forEach(function (o) { if (o.subFor) { var s = seatBySid(o.subFor); if (s && s.connected) { o.kind = 'human'; o.sid = o.subFor; o.name = s.name; delete o.subFor; delete o.lv; toastAll(s.name + 'が戻ってきました'); hostBroadcast(); } } });
    var o = G.owners[c];
    if (now < G.startAt) return;
    if (!G.started) { G.started = true; hostBroadcast(); }
    if (o.kind === 'human' && G.noMove && now - (G.tickAt || 0) > 1000) { G.tickAt = now; hostBroadcast(); }   // 自動パスまでの秒数を更新
    if (o.kind === 'cpu') {
      if (!G.cpuAt) G.cpuAt = now + rand(T.cpu);
      if (now >= G.cpuAt) { var m = L.aiMove(S, c, o.lv, Math.random, o.lv === 'ultra' ? (TURBO ? 150 : 650) : 0); if (m) applyMove(c, m); else doPass(c); }
    } else if (G.noMove) {
      var seat = seatBySid(o.sid);
      if (now - G.turnAt > T.autoPass || (seat && !seat.connected && now - G.turnAt > T.offPass)) doPass(c, true);
    }
  }
  function hostSubstitute() {   // 切断中の人の色を ふーさんが代打ち
    var G = host.room.G, c = G.S.turn, o = G.owners[c]; if (!o || o.kind !== 'human') return;
    var s = seatBySid(o.sid); if (!s || s.connected) return;
    o.subFor = o.sid; o.kind = 'cpu'; o.lv = 'normal'; o.name = s.name + '（代打ち' + BEAR + '）'; G.cpuAt = 0;
    toastAll(BEAR + ' ふーさんが ' + s.name + ' の代わりに打ちます'); hostBroadcast();
  }
  function boardStr(b) { var s = ''; for (var i = 0; i < b.length; i++) s += b[i] < 0 ? '.' : b[i]; return s; }
  function viewFor(sid) {
    var R = host.room, G = R.G, now = Date.now(), you = -1;
    R.seats.forEach(function (s, i) { if (s.sid === sid) you = i; });
    var v = { t: 'state', phase: R.phase, code: R.code, you: you, sid: sid, gameNo: R.gameNo, opts: { lv: R.opts.lv.slice(), two: R.opts.two },
      seats: R.seats.map(function (s) { return { sid: s.sid, name: s.name, kind: s.kind, connected: s.kind !== 'remote' || s.connected }; }), notice: R.notice };
    if (sid === 1 && R.lobbyReq && R.phase !== 'lobby') v.lobbyReq = R.lobbyReq;
    if (R.phase === 'lobby' || !G) return v;
    var S = G.S, cur = S.turn >= 0 ? G.owners[S.turn] : null, curSeat = cur && cur.kind === 'human' ? seatBySid(cur.sid) : null;
    v.g = { board: boardStr(S.board), rem: S.rem, out: S.out, turn: S.turn, n: S.moves.length, last: G.last, log: G.log, ultra: G.ultra, two: G.two,
      owners: G.owners.map(function (o) { var s = o.kind === 'human' ? seatBySid(o.sid) : null; return { kind: o.kind, sid: o.sid, name: o.name, lv: o.lv, sub: !!o.subFor, connected: !s || s.connected }; }),
      scores: [0, 1, 2, 3].map(function (c) { return L.score(S, c); }), remSq: [0, 1, 2, 3].map(function (c) { return L.remSquares(S, c); }), lastP: S.last,
      noMove: G.noMove, passLeft: cur && cur.kind === 'human' && G.noMove ? Math.max(0, T.autoPass - (now - G.turnAt)) : null,
      wait: Math.max(0, G.startAt - now), curOff: !!(curSeat && !curSeat.connected) };
    return v;
  }
  function openHostPeer() {
    var R = host.room, peer = new Peer(hostId(R.code), PEER_OPTS);
    host.peer = peer;
    peer.on('open', function () { host.opened = true; host.tries = 0; connecting(false); banner(''); hostRender(); saveHost(); });
    peer.on('connection', function (conn) {
      conn.on('data', function (msg) { hostOnMessage(conn, msg); });
      conn.on('close', function () { hostConnClosed(conn); });
      conn.on('error', function () { hostConnClosed(conn); });
    });
    peer.on('disconnected', function () { if (!peer.destroyed) setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000); });
    peer.on('error', function (e) {
      if (e.type === 'unavailable-id') {
        try { peer.destroy(); } catch (x) {}
        if (!host.opened && R.phase === 'lobby' && !host.resuming) { R.code = genCode(); openHostPeer(); return; }
        if (++host.tries > 25) { connecting(false); toast('部屋を再開できませんでした'); return; }
        connecting(true, '部屋を再開しています…', '少し時間がかかることがあります（' + host.tries + '）');
        setTimeout(openHostPeer, 3000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(e.type) >= 0) {
        if (!host.opened) { connecting(true, 'サーバーに接続できません', '通信環境を確認してください。再試行しています…'); setTimeout(function () { try { peer.destroy(); } catch (x) {} openHostPeer(); }, 4000); }
        else banner('シグナリングサーバーとの接続が不安定です（ゲームは続行できます）');
      } else if (e.type === 'browser-incompatible') connecting(true, 'このブラウザは対応していません', 'Chrome / Safari の最新版でお試しください');
    });
  }
  function seatByClient(cid) { return host.room.seats.filter(function (s) { return s.clientId === cid; })[0]; }
  function seatBySid(sid) { return host.room.seats.filter(function (s) { return s.sid === sid; })[0]; }
  function hostOnMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    var R = host.room;
    if (msg.t === 'join') return hostJoin(conn, msg);
    var seat = conn.clientId && seatByClient(conn.clientId);
    if (!seat || host.conns[conn.clientId] !== conn) return;
    host.lastSeen[conn.clientId] = Date.now();
    if (msg.t === 'ping') return;
    if (msg.t === 'lobbyReq') return hostLobbyReq(seat);
    if (msg.t === 'leave') {
      if (R.phase === 'lobby') R.seats.splice(R.seats.indexOf(seat), 1); else { seat.connected = false; seat.left = true; seat.lostAt = Date.now(); }
      delete host.conns[conn.clientId]; try { conn.close(); } catch (e) {}
      if (R.phase !== 'lobby') toastAll(seat.name + 'が退出しました');
      hostBroadcast(); return;
    }
    if (R.phase !== 'game' || msg.g !== R.gameNo || msg.n !== R.G.S.moves.length) return;
    var err = hostAction(seat.sid, msg);
    if (err) { try { conn.send({ t: 'error', msg: err }); conn.send(viewFor(seat.sid)); } catch (e) {} }
  }
  function hostJoin(conn, msg) {
    var R = host.room, name = cleanName(msg.name), cid = String(msg.clientId || '').slice(0, 40);
    function reject(text) { conn.send({ t: 'reject', msg: text }); setTimeout(function () { try { conn.close(); } catch (e) {} }, 500); }
    if (!name || !cid) return reject('ニックネームを入力してください');
    if (cid === myId) return reject('ホストと同じ端末・ブラウザからは参加できません');
    var seat = seatByClient(cid);
    if (!seat) { seat = R.seats.filter(function (s) { return s.name === name && s.kind === 'remote' && !s.connected; })[0]; if (seat) seat.clientId = cid; }
    if (seat) {
      if (seat.kind !== 'remote') return reject('この名前は使えません');
      var old = host.conns[cid]; if (old && old !== conn) { try { old.close(); } catch (e) {} }
      seat.connected = true; seat.left = false;
    } else {
      if (R.phase !== 'lobby') return reject('この部屋はゲーム中です。前に参加していた人は、同じニックネームで入ると元の席に戻れます。');
      if (R.seats.length >= MAX_HUMANS) return reject('満員です（最大' + MAX_HUMANS + '人）');
      if (R.seats.some(function (s) { return s.name === name; }) || /^ふーさん/.test(name)) return reject('その名前は使えません。別のニックネームにしてください。');
      seat = { sid: R.nextSid++, name: name, kind: 'remote', clientId: cid, connected: true };
      R.seats.push(seat);
    }
    conn.clientId = cid; host.conns[cid] = conn; host.lastSeen[cid] = Date.now();
    conn.send({ t: 'welcome', code: R.code, sid: seat.sid });
    hostBroadcast();
  }
  function hostConnClosed(conn) {
    if (!conn.clientId || host.conns[conn.clientId] !== conn) return;
    delete host.conns[conn.clientId];
    var seat = seatByClient(conn.clientId);
    if (seat && seat.connected) { seat.connected = false; seat.lostAt = Date.now(); hostBroadcast(); }
  }
  function hostHeartbeat() {
    if (!host) return;
    var now = Date.now();
    Object.keys(host.conns).forEach(function (cid) {
      var c = host.conns[cid];
      try { c.send({ t: 'hb' }); } catch (e) {}
      if (now - (host.lastSeen[cid] || 0) > LOST_MS) { try { c.close(); } catch (e) {} hostConnClosed(c); }
    });
  }
  function toastAll(msg) { var R = host.room; R.notice = { id: (R.notice ? R.notice.id : 0) + 1, msg: msg, toast: true }; }
  function hostToLobby(msg) {
    var R = host.room;
    R.phase = 'lobby'; R.G = null; R.lobbyReq = null;
    R.seats = R.seats.filter(function (s) { if (s.kind === 'remote') { s.left = false; return !!s.connected; } return true; });
    R.notice = { id: (R.notice ? R.notice.id : 0) + 1, msg: msg };
    hostBroadcast();
  }
  function hostLobbyReq(seat) {
    var R = host.room;
    if (seat.kind !== 'remote' || R.phase === 'lobby') return;
    if (R.lobbyReq && R.lobbyReq.sid === seat.sid && Date.now() - R.lobbyReq.at < 5000) return;
    R.lobbyReq = { sid: seat.sid, name: seat.name, at: Date.now() };
    hostBroadcast();
  }
  function hostBroadcast() {
    var R = host.room;
    R.seats.forEach(function (s) { if (s.kind !== 'remote') return; var c = host.conns[s.clientId]; if (c && c.open) { try { c.send(viewFor(s.sid)); } catch (e) {} } });
    hostRender(); saveHost();
  }
  function hostRender() { render(viewFor(1)); }
  function saveHost() { try { localStorage.setItem(LS_HOST, JSON.stringify({ room: host.room, saved: Date.now() }, function (k, v) { return v instanceof Int8Array ? Array.from(v) : v; })); } catch (e) {} }

  // ---- ホストのロビー操作 ----
  $('seatList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-sid]'); if (!b || !host) return;
    var R = host.room, seat = seatBySid(+b.dataset.sid);
    if (!seat || seat.kind !== 'remote' || R.phase !== 'lobby') return;
    var doRemove = function () {
      var c = host.conns[seat.clientId]; if (c) { try { c.send({ t: 'kicked' }); } catch (x) {} setTimeout(function () { try { c.close(); } catch (x) {} }, 300); delete host.conns[seat.clientId]; }
      R.seats.splice(R.seats.indexOf(seat), 1); hostBroadcast();
    };
    if (seat.connected) confirmBox(seat.name + 'を外しますか？', '部屋から退出させます。', '外す', doRemove); else doRemove();
  });
  $('colorList').addEventListener('change', function (e) {
    var s = e.target.closest('select[data-c]'); if (!s || !host || host.room.phase !== 'lobby') return;
    if (LV_KEYS.indexOf(s.value) >= 0) { host.room.opts.lv[+s.dataset.c] = s.value; hostBroadcast(); }
  });
  $('lvAllSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-v]'); if (!b || !host || host.room.phase !== 'lobby') return;
    host.room.opts.lv = [b.dataset.v, b.dataset.v, b.dataset.v, b.dataset.v]; hostBroadcast();
  });
  $('twoSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-v]'); if (!b || !host || host.room.phase !== 'lobby') return;
    host.room.opts.two = b.dataset.v === '1'; hostBroadcast();
  });
  $('startBtn').onclick = function () { if (host) hostStartGame(); };
  $('againBtn').onclick = function () { if (host && host.room.phase === 'end') hostStartGame(); };
  $('toLobbyBtn').onclick = function () { if (host && host.room.phase === 'end') hostToLobby('ロビーに戻りました'); };
  function copyUrl() {
    var u = $('inviteUrl').textContent;
    function legacy() { try { var ta = document.createElement('textarea'); ta.value = u; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, u.length); var ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e) { return false; } }
    var p = navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(u) : Promise.reject();
    p.then(function () { toast('招待URLをコピーしました'); }, function () { toast(legacy() ? '招待URLをコピーしました' : 'URLを長押ししてコピーしてください'); });
  }
  $('copyBtn').onclick = copyUrl;
  $('shareBtn').onclick = function () {
    var data = { title: '角取り陣', text: 'いっしょに「角取り陣」で遊ぼう！ 部屋コード ' + $('codeBig').textContent, url: $('inviteUrl').textContent };
    if (!navigator.share || (navigator.canShare && !navigator.canShare(data))) return copyUrl();
    try { navigator.share(data).catch(function (e) { if (!e || e.name !== 'AbortError') copyUrl(); }); } catch (e) { copyUrl(); }
  };

  var client = null;
  function startClient(code, name) {
    document.body.classList.remove('is-host');
    client = { code: code, name: name, joined: false, lastMsg: Date.now(), everJoined: false };
    connecting(true, '部屋 ' + code + ' に接続中…', 'しばらくお待ちください', function () { leaveClient(true); });
    var peer = new Peer(PEER_OPTS);
    client.peer = peer;
    peer.on('open', function () { clientConnect(); });
    peer.on('disconnected', function () { if (!peer.destroyed) setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000); });
    peer.on('error', function (e) {
      if (e.type === 'peer-unavailable') { if (!client.everJoined) { connecting(false); toast('部屋が見つかりません。コードを確認してください。'); leaveClient(false); } else clientLost(); }
      else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(e.type) >= 0) { if (!client.everJoined) connecting(true, 'サーバーに接続できません', '通信環境を確認してください。再試行しています…'); }
      else if (e.type === 'browser-incompatible') connecting(true, 'このブラウザは対応していません', 'Chrome / Safari の最新版でお試しください');
    });
    clearInterval(client.hbTimer); client.hbTimer = setInterval(clientHeartbeat, HB_MS);
    setTimeout(function () { if (client && !client.everJoined && $('connecting').classList.contains('active')) $('connText').textContent = 'つながりにくいようです。コードが正しいか、ホストが部屋を開いているか確認してください。（通信環境によっては接続できない場合があります）'; }, 15000);
  }
  function clientConnect() {
    if (!client || !client.peer || client.peer.destroyed) return;
    if (client.conn) { try { client.conn.close(); } catch (e) {} }
    var conn = client.peer.connect(hostId(client.code), { reliable: true });
    client.conn = conn;
    conn.on('open', function () { conn.send({ t: 'join', name: client.name, clientId: myId }); });
    conn.on('data', function (m) { if (client && client.conn === conn) clientOnMessage(m); });
    conn.on('close', function () { if (client && client.conn === conn) clientLost(); });
    conn.on('error', function () { if (client && client.conn === conn) clientLost(); });
  }
  function clientOnMessage(m) {
    if (!m || typeof m !== 'object') return;
    client.lastMsg = Date.now();
    if (m.t === 'welcome') { client.joined = true; client.everJoined = true; connecting(false); banner(''); sstore(SS_CLIENT, { code: client.code, name: client.name }); }
    else if (m.t === 'state') { pending = ''; render(m); }
    else if (m.t === 'reject') { connecting(false); leaveClient(false); alertBox(m.msg); }
    else if (m.t === 'kicked') { sstore(SS_CLIENT, null); leaveClient(false); alertBox('ホストによって部屋から外されました。'); }
    else if (m.t === 'closed') { sstore(SS_CLIENT, null); leaveClient(false); alertBox('ホストが部屋を閉じました。'); }
    else if (m.t === 'error') { pending = ''; toast(m.msg); stageKey = ''; if (lastView) render(lastView); }
  }
  function clientHeartbeat() {
    if (!client) return;
    if (client.conn && client.conn.open) { try { client.conn.send({ t: 'ping' }); } catch (e) {} }
    if (client.everJoined && Date.now() - client.lastMsg > LOST_MS) clientLost();
  }
  function clientLost() {
    if (!client || !client.everJoined) return;
    client.joined = false; banner('ホストとの接続が切れました。再接続しています…');
    clearTimeout(client.retryT);
    client.retryT = setTimeout(function () {
      if (!client) return; client.lastMsg = Date.now();
      if (client.peer.disconnected && !client.peer.destroyed) { try { client.peer.reconnect(); } catch (e) {} }
      clientConnect();
    }, 3000);
  }
  function leaveClient(sendLeave) {
    if (!client) return;
    if (sendLeave && client.conn && client.conn.open) { try { client.conn.send({ t: 'leave' }); } catch (e) {} }
    clearInterval(client.hbTimer); clearTimeout(client.retryT);
    var p = client.peer; client = null;
    setTimeout(function () { try { p.destroy(); } catch (e) {} }, 300);
    banner(''); connecting(false); show('title'); renderTitle();
  }
  function send(m) { if (client && client.conn && client.conn.open) { client.conn.send(m); return true; } toast('接続が切れています'); return false; }

  // ---- 操作（ホストも参加者も同じ入口） ----
  var lastView = null, pending = '', stageKey = '';
  function act(m) {
    var v = lastView; if (!v || v.phase !== 'game') return;
    m.g = v.gameNo; m.n = v.g.n;
    if (host) { var err = hostAction(1, m); if (err) toast(err); return; }
    var key = m.t + ':' + m.n;
    if (pending === key) return;
    if (send(m)) pending = key;
  }
  function leaveRoom() {
    if (host) {
      confirmBox('部屋を閉じますか？', '参加者全員の接続が切れ、ゲームは終了します。', '部屋を閉じる', function () {
        Object.keys(host.conns).forEach(function (cid) { try { host.conns[cid].send({ t: 'closed' }); } catch (e) {} });
        store(LS_HOST, null);
        setTimeout(function () { try { host.peer.destroy(); } catch (e) {} location.href = location.pathname; }, 400);
      });
    } else confirmBox('部屋を出ますか？', 'ゲーム中に出た場合も、同じニックネームで入り直せば元の席に戻れます。', '部屋を出る', function () { sstore(SS_CLIENT, null); leaveClient(true); });
  }
  $('leaveBtn1').onclick = $('leaveBtn2').onclick = leaveRoom;
  $('menuBtn').onclick = function () { overlay('menuModal', true); };
  function confirmAbort() {
    confirmBox('中断してロビーに戻りますか？', 'いまのゲームを終了して、全員をこの部屋のロビーに戻します。部屋コード・参加者・設定はそのままです。', '中断してロビーへ', function () {
      if (host && host.room.phase !== 'lobby') hostToLobby('⏸️ ホストがゲームを中断しました');
    });
  }
  $('menuAbort').onclick = function () { overlay('menuModal', false); confirmAbort(); };
  $('menuReq').onclick = function () { overlay('menuModal', false); send({ t: 'lobbyReq' }); toast('ホストに「ロビーに戻りたい」と伝えました'); };
  $('menuLeave').onclick = function () { overlay('menuModal', false); leaveRoom(); };
  $('menuRules').onclick = function () { overlay('menuModal', false); overlay('rulesModal', true); };
  $('menuClose').onclick = function () { overlay('menuModal', false); };
  $('lobbyReqBar').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-lr]'); if (!b || !host) return;
    if (b.dataset.lr === 'no') { host.room.lobbyReq = null; hostBroadcast(); } else confirmAbort();
  });
  var seenNotice = null;
  function noticeUi(v) {
    if (seenNotice === null) seenNotice = v.notice ? v.notice.id : 0;
    else if (v.notice && v.notice.id !== seenNotice) { seenNotice = v.notice.id; if (v.notice.toast || !host) toast(v.notice.msg + (!v.notice.toast && v.phase === 'lobby' ? '。ロビーで次のゲームを待っています' : '')); }
    if (v.phase === 'lobby') overlay('menuModal', false);
    var bar = $('lobbyReqBar'), key = host && v.lobbyReq && v.phase !== 'lobby' ? v.lobbyReq.sid + ':' + v.lobbyReq.at : '';
    if (bar.dataset.key !== key) {
      bar.dataset.key = key;
      bar.innerHTML = key ? '<span>🙋 ' + esc(v.lobbyReq.name) + '「ロビーに戻りたい」</span><button data-lr="abort">中断してロビーへ</button><button data-lr="no" class="ghost">とじる</button>' : '';
      bar.classList.toggle('show', !!key);
    }
  }

  // =====================================================================
  //  盤・トレイの操作（各端末）
  // =====================================================================
  var ui = { sel: null, k: {}, ghost: null, zoom: 1, n: -1, mv: null, mvKey: '', S: null, trayColor: 0, myTurn: false, ptr: 'touch' };
  function myColors(v) { var out = []; v.g.owners.forEach(function (o, c) { if (o.kind === 'human' && o.sid === v.sid) out.push(c); }); return out; }
  function curO(p) { return L.PIECES[p].kToO[ui.k[p] || 0]; }
  function covers(m, cell) { return L.cellsOf(m.p, m.o, m.x, m.y).indexOf(cell) >= 0; }
  // タップしたマスをおおう置き方にスナップ（同じ向き優先 → ほかの向き）。cycle=true で次の候補へ
  function snap(cell, mode) {
    var p = ui.sel; if (p == null) return;
    var o = curO(p), moves = (ui.mv && ui.mv.byP[p]) || [];
    var same = moves.filter(function (m) { return m.o === o && covers(m, cell); });
    var list = mode === 'keepO' ? same : same.concat(moves.filter(function (m) { return m.o !== o && covers(m, cell); }));
    var g = ui.ghost;
    if (list.length) {
      var idx = 0;
      if (mode === 'cycle' && g && g.cell === cell && g.p === p && g.legal) { var cur = -1; list.forEach(function (m, i) { if (m.o === g.o && m.x === g.x && m.y === g.y) cur = i; }); idx = (cur + 1) % list.length; }
      var m = list[idx]; if (m.o !== o) ui.k[p] = L.PIECES[p].kToO.indexOf(m.o);
      ui.ghost = { p: p, o: m.o, x: m.x, y: m.y, legal: ui.myTurn, cell: cell };
    } else {
      var oc = L.PIECES[p].orients[o], rc = oc.cells[Math.floor(oc.cells.length / 2)];
      var x = Math.max(0, Math.min(N - oc.w, cell % N - rc[0])), y = Math.max(0, Math.min(N - oc.h, ((cell / N) | 0) - rc[1]));
      ui.ghost = { p: p, o: o, x: x, y: y, legal: false, cell: cell };
    }
  }
  function placeGhost() {
    var g = ui.ghost; if (!g || !g.legal || !ui.myTurn) return;
    act({ t: 'place', p: g.p, o: g.o, x: g.x, y: g.y });
  }
  function cellFromEvent(e) { var r = $('board').getBoundingClientRect(), cs = r.width / N; var x = Math.floor((e.clientX - r.left) / cs), y = Math.floor((e.clientY - r.top) / cs); return x >= 0 && y >= 0 && x < N && y < N ? y * N + x : -1; }
  $('board').addEventListener('pointerdown', function (e) { ui.ptr = e.pointerType || 'touch'; unlockAudio(); });
  $('board').addEventListener('click', function (e) {
    var v = lastView; if (!v || v.phase !== 'game') return;
    var cell = cellFromEvent(e); if (cell < 0) return;
    if (ui.sel == null) { if (ui.myTurn) toast('下のトレイからピースを選んでね'); return; }
    if (ui.ptr === 'mouse') { if (ui.ghost && ui.ghost.cell === cell && ui.ghost.legal) return placeGhost(); snap(cell); if (ui.ghost.legal) return placeGhost(); }
    else snap(cell, 'cycle');
    if (ui.ghost && !ui.ghost.legal && ui.myTurn) toast(ui.mv && ui.mv.byP[ui.sel] && ui.mv.byP[ui.sel].length ? 'そこには置けません（光っているマスをタップ）' : 'このピースは置ける場所がありません');
    paint();
  });
  $('board').addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse' || ui.sel == null || !lastView || lastView.phase !== 'game') return;
    var cell = cellFromEvent(e); if (cell < 0 || (ui.ghost && ui.ghost.cell === cell && ui.ghost.p === ui.sel)) return;
    snap(cell, 'keepO'); paint();
  });
  function rotate(flip) {
    if (ui.sel == null) return toast('先にピースを選んでね');
    ui.k[ui.sel] = flip ? L.flipK(ui.k[ui.sel] || 0) : L.rotK(ui.k[ui.sel] || 0);
    if (ui.ghost) snap(ui.ghost.cell, 'keepO');
    paint();
  }
  $('rotBtn').onclick = function () { rotate(false); };
  $('flipBtn').onclick = function () { rotate(true); };
  $('placeBtn').onclick = placeGhost;
  $('passBtn').onclick = function () { act({ t: 'pass' }); };
  document.addEventListener('keydown', function (e) {
    if (!lastView || lastView.phase !== 'game' || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'r' || e.key === 'R') rotate(false); else if (e.key === 'f' || e.key === 'F') rotate(true); else if (e.key === 'Enter') placeGhost(); else if (e.key === 'Escape') { ui.ghost = null; paint(); }
  });
  $('tray').addEventListener('click', function (e) {
    var b = e.target.closest('.pz[data-p]'); if (!b) return;
    var p = +b.dataset.p;
    if (ui.sel === p) { ui.sel = null; ui.ghost = null; }
    else { ui.sel = p; if (ui.ghost) snap(ui.ghost.cell, 'keepO'); if (ui.ghost && !ui.ghost.legal) ui.ghost = null; }
    paint();
  });
  // ズーム（ボタン・ピンチ）
  function setZoom(z, fx, fy) {
    var w = $('boardWrap'); z = Math.max(1, Math.min(3.2, z));
    var old = ui.zoom, cw = w.clientWidth; fx = fx == null ? cw / 2 : fx; fy = fy == null ? cw / 2 : fy;
    var cx = (w.scrollLeft + fx) / (cw * old), cy = (w.scrollTop + fy) / (cw * old);
    ui.zoom = z; paint();
    w.scrollLeft = cx * cw * z - fx; w.scrollTop = cy * cw * z - fy;
  }
  $('zoomIn').onclick = function () { setZoom(ui.zoom < 1.5 ? 1.7 : 2.5); };
  $('zoomOut').onclick = function () { setZoom(ui.zoom > 2 ? 1.7 : 1); };
  var pinch = null;
  $('boardWrap').addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) { var a = e.touches[0], b = e.touches[1], r = this.getBoundingClientRect(); pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: ui.zoom, fx: (a.clientX + b.clientX) / 2 - r.left, fy: (a.clientY + b.clientY) / 2 - r.top }; }
  }, { passive: true });
  $('boardWrap').addEventListener('touchmove', function (e) {
    if (pinch && e.touches.length === 2) { e.preventDefault(); var a = e.touches[0], b = e.touches[1]; setZoom(pinch.z * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d, pinch.fx, pinch.fy); }
  }, { passive: false });
  $('boardWrap').addEventListener('touchend', function (e) { if (e.touches.length < 2) pinch = null; });
  window.addEventListener('resize', function () { if (lastView && lastView.phase === 'game') paint(); });

  // ---- 盤の描画（canvas）----
  function tile(ctx, x, y, s, col, alpha) {
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    var g = Math.max(1, s * 0.07);
    ctx.fillStyle = col.d; ctx.fillRect(x + 0.5, y + 0.5, s - 1, s - 1);
    ctx.fillStyle = col.f; ctx.fillRect(x + g, y + g, s - g * 2 - 0.5, s - g * 2 - 0.5);
    ctx.fillStyle = col.l; ctx.fillRect(x + g, y + g, s - g * 2 - 0.5, g * 1.1); ctx.fillRect(x + g, y + g, g * 1.1, s - g * 2 - 0.5);
    ctx.globalAlpha = 1;
  }
  function drawBoard(cv, cssSize, board, o) {
    o = o || {};
    var dpr = Math.min(2, window.devicePixelRatio || 1), s = cssSize / N, px = Math.round(cssSize * dpr);
    if (cv.width !== px) { cv.width = px; cv.height = px; }
    cv.style.width = cv.style.height = cssSize + 'px';
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#efe3c7'; ctx.fillRect(0, 0, cssSize, cssSize);
    ctx.strokeStyle = 'rgba(120,90,40,.28)'; ctx.lineWidth = 1; ctx.beginPath();
    for (var i = 1; i < N; i++) { ctx.moveTo(i * s + 0.5, 0); ctx.lineTo(i * s + 0.5, cssSize); ctx.moveTo(0, i * s + 0.5); ctx.lineTo(cssSize, i * s + 0.5); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,90,40,.5)'; ctx.lineWidth = 1.5; ctx.strokeRect(10 * s, 0, 0, cssSize); ctx.strokeRect(0, 10 * s, cssSize, 0);
    L.CORNERS.forEach(function (cr, c) { var k = cr[1] * N + cr[0]; if (board[k] < 0) { ctx.fillStyle = COL[c].f; ctx.globalAlpha = 0.28; ctx.fillRect(cr[0] * s, cr[1] * s, s, s); ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(cr[0] * s + s / 2, cr[1] * s + s / 2, s * 0.22, 0, 7); ctx.fillStyle = COL[c].f; ctx.fill(); } });
    for (var k = 0; k < N * N; k++) if (board[k] >= 0) tile(ctx, (k % N) * s, ((k / N) | 0) * s, s, COL[board[k]]);
    if (o.last) { ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.5, s * 0.12); ctx.shadowColor = 'rgba(255,255,255,.9)'; ctx.shadowBlur = 6; o.last.cells.forEach(function (k) { ctx.strokeRect((k % N) * s + s * 0.18, ((k / N) | 0) * s + s * 0.18, s * 0.64, s * 0.64); }); ctx.shadowBlur = 0; }
    if (o.hint) { ctx.fillStyle = COL[o.color].f; for (k = 0; k < N * N; k++) if (o.hint[k]) { ctx.globalAlpha = 0.22; ctx.fillRect((k % N) * s + 1, ((k / N) | 0) * s + 1, s - 2, s - 2); ctx.globalAlpha = 1; } }
    if (o.anchors) { ctx.fillStyle = COL[o.color].d; o.anchors.forEach(function (k) { var cx = (k % N) * s + s / 2, cy = ((k / N) | 0) * s + s / 2, r = s * 0.2; ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); ctx.fill(); }); }
    if (o.ghost) {
      var gc = L.cellsOf(o.ghost.p, o.ghost.o, o.ghost.x, o.ghost.y) || [];
      gc.forEach(function (k) { tile(ctx, (k % N) * s, ((k / N) | 0) * s, s, COL[o.color], 0.78); });
      ctx.lineWidth = Math.max(2, s * 0.13); ctx.strokeStyle = o.ghost.legal ? '#16c172' : (o.ghostWait ? '#555' : '#ff3b30'); ctx.setLineDash(o.ghost.legal ? [] : [s * 0.25, s * 0.18]);
      gc.forEach(function (k) { ctx.strokeRect((k % N) * s + 1.5, ((k / N) | 0) * s + 1.5, s - 3, s - 3); }); ctx.setLineDash([]);
    }
  }
  function pieceSvg(p, o, col) {
    var oc = L.PIECES[p].orients[o], ox = (5 - oc.w) / 2, oy = (5 - oc.h) / 2;
    return '<svg viewBox="-0.2 -0.2 5.4 5.4">' + oc.cells.map(function (c) { return '<rect x="' + (c[0] + ox + 0.05) + '" y="' + (c[1] + oy + 0.05) + '" width=".9" height=".9" rx=".14" fill="' + col.f + '" stroke="' + col.d + '" stroke-width=".1"/>'; }).join('') + '</svg>';
  }
  function paintStatus() {
    var v = lastView, g = v.g, mine = myColors(v), cur = g.turn;
    var st = '', cls = '';
    if (g.wait > 0) st = g.ultra ? '…' : 'まもなく開始…';
    else if (ui.myTurn && g.noMove) { st = '置けるピースがありません。パスしてください' + (g.passLeft != null ? '（' + Math.ceil(g.passLeft / 1000) + '秒後に自動パス）' : ''); cls = 'mine'; }
    else if (ui.myTurn) { cls = 'mine'; st = g.rem[cur].length === 21 ? '最初は' + COL[cur].n + 'の角（' + ['左上', '右上', '右下', '左下'][cur] + '）をおおうように置こう' : ui.sel == null ? 'ピースを選んでね（◆＝角でつながれるマス）' : !ui.ghost ? '盤をタップ（色がついたマスに置けます）' : ui.ghost.legal ? '「✔ 置く」で決定（同じマスをもう一度タップで別の置き方）' : 'そこには置けません'; }
    else if (cur >= 0) { var o = g.owners[cur]; st = o.kind === 'cpu' ? BEAR + ' ' + esc(o.name) + '（' + COL[cur].n + '）が考え中…' : esc(o.name) + '（' + COL[cur].n + '）の番です' + (g.curOff ? '（切断中）' : ''); if (mine.length && mine.every(function (c) { return g.out[c]; })) st = 'あなたの色はもう置けません。最後まで見守ろう ／ ' + st; }
    $('status').innerHTML = st + (host && g.curOff && g.owners[cur].kind === 'human' ? ' <button class="ib" id="subBtn" style="background:var(--pink)">🐻 ふーさんに代打ちしてもらう</button>' : '');
    $('status').className = 'status ' + cls;
    if ($('subBtn')) $('subBtn').onclick = hostSubstitute;
  }
  var trayKey = '';
  // 盤・トレイ・ボタンを ui の状態から描き直す（ネットワークを待たずに即時反映）
  function paint() {
    var v = lastView; if (!v || v.phase !== 'game') return;
    var g = v.g, c = ui.trayColor, S = ui.S, mineTurn = ui.myTurn;
    var hint = null, anchorsL = null;
    if (ui.mv && !g.out[c]) {
      if (ui.sel != null) { hint = new Uint8Array(N * N); var o = curO(ui.sel); (ui.mv.byP[ui.sel] || []).forEach(function (m) { if (m.o === o) L.cellsOf(m.p, m.o, m.x, m.y).forEach(function (k) { hint[k] = 1; }); }); }
      else if (mineTurn) anchorsL = L.anchors(S, c);
    }
    var wrap = $('boardWrap');
    drawBoard($('board'), Math.floor(wrap.clientWidth * ui.zoom), S.board, { last: g.last, hint: hint, anchors: anchorsL, ghost: ui.ghost, ghostWait: !mineTurn, color: c });
    // トレイ
    var rem = g.rem[c], key = [c, rem.join(','), ui.sel, JSON.stringify(ui.k), ui.mv ? Object.keys(ui.mv.byP).join(',') : ''].join('|');
    if (key !== trayKey) {
      trayKey = key;
      $('tray').innerHTML = L.PIECES.map(function (P, p) {
        var used = rem.indexOf(p) < 0, nofit = !used && ui.mv && !g.out[c] && !(ui.mv.byP[p] && ui.mv.byP[p].length);
        return '<button class="pz' + (used ? ' used' : '') + (nofit ? ' nofit' : '') + (ui.sel === p ? ' sel' : '') + '" data-p="' + p + '" aria-label="' + P.size + 'マスのピース">' + pieceSvg(p, curO(p), COL[c]) + '</button>';
      }).join('');
    }
    $('placeBtn').disabled = !(mineTurn && ui.ghost && ui.ghost.legal && !pending);
    $('rotBtn').disabled = $('flipBtn').disabled = ui.sel == null;
    paintStatus();
  }

  // =====================================================================
  //  描画（ホスト・参加者で共通。受け取ったビューだけを使う）
  // =====================================================================
  function render(v) {
    lastView = v; window.__kj.view = v;
    noticeUi(v);
    if (v.phase === 'lobby') { show('lobby'); renderLobby(v); ui.n = -1; return; }
    if (v.phase === 'end') { show('end'); renderEnd(v); return; }
    show('game'); renderGame(v);
  }
  function lvSelect(c, lv) { return '<select data-c="' + c + '" class="' + (lv === 'ultra' ? 'ultra' : '') + '" aria-label="ふーさんの強さ">' + LV_KEYS.map(function (k) { return '<option value="' + k + '"' + (k === lv ? ' selected' : '') + '>' + LV[k] + '</option>'; }).join('') + '</select>'; }
  function renderLobby(v) {
    var isHost = !!host, n = v.seats.length;
    $('codeBig').textContent = v.code;
    var url = inviteUrl(v.code);
    $('inviteUrl').textContent = url;
    if ($('qr').dataset.url !== url) { try { var qr = qrcode(0, 'M'); qr.addData(url); qr.make(); $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { $('qr').textContent = ''; } $('qr').dataset.url = url; }
    $('seatCount').textContent = n + ' / ' + MAX_HUMANS + '人';
    $('seatList').innerHTML = v.seats.map(function (s, i) {
      var tags = (s.kind === 'host' ? '<span class="tagx host">ホスト</span>' : '') + (i === v.you ? '<span class="tagx you">あなた</span>' : '') + (s.kind === 'remote' && !s.connected ? '<span class="tagx off">切断</span>' : '');
      return '<div class="seat' + (s.connected ? '' : ' offline') + '"><span class="av" style="background:#6b5a4a">' + (i + 1) + '</span><span class="nm">' + esc(s.name) + '</span>' + tags + (isHost && s.kind === 'remote' ? '<button class="xbtn" data-sid="' + s.sid + '" aria-label="外す">×</button>' : '') + '</div>';
    }).join('');
    var owners = planOwners(v.seats, v.opts);
    $('colorList').innerHTML = owners.map(function (o, c) {
      return '<div class="crow"><span class="sw" style="background:' + COL[c].f + '"></span><span class="cn">' + COL[c].n + '</span><span class="nm">' + esc(o.name) + (o.kind === 'human' && o.sid === v.sid ? '（あなた）' : '') + '</span>' +
        (o.kind === 'cpu' ? (isHost ? lvSelect(c, o.lv) : '<span class="lv ' + o.lv + '">' + LV[o.lv] + '</span>') : '') + '</div>';
    }).join('');
    $('twoBox').style.display = n === 2 ? '' : 'none';
    $('twoSeg').innerHTML = [['0', 'ふーさん2人と4人戦'], ['1', '1人2色（公式2人ルール）']].map(function (o) { return '<button data-v="' + o[0] + '" class="' + ((v.opts.two ? '1' : '0') === o[0] ? 'on' : '') + '"' + (isHost ? '' : ' disabled') + '>' + o[1] + '</button>'; }).join('');
    $('twoSeg').classList.toggle('ro', !isHost);
    $('lvAllSeg').innerHTML = LV_KEYS.map(function (k) { return '<button data-v="' + k + '">' + (k === 'ultra' ? 'アストラ<br>ウルトラ😎' : LV[k]) + '</button>'; }).join('');
    var cpuN = owners.filter(function (o) { return o.kind === 'cpu'; }).length;
    $('lvAllSeg').parentNode.style.display = cpuN ? '' : 'none';
    $('seatHint').textContent = n >= MAX_HUMANS ? '満員です（4色すべて人間）' : '1〜4人で遊べます。空いた色は ふーさん🐻 が担当します';
    $('startBtn').disabled = n < 1;
  }
  function nameOf(v, c) { return v.g.owners[c].name; }
  var lastAwaken = '';
  function renderGame(v) {
    var g = v.g, mine = myColors(v);
    if (g.ultra && g.n === 0 && g.wait > 400 && lastAwaken !== v.code + ':' + v.gameNo) { lastAwaken = v.code + ':' + v.gameNo; awaken(); }
    if (ui.n !== g.n || ui.gameKey !== v.code + ':' + v.gameNo) {
      ui.n = g.n; ui.gameKey = v.code + ':' + v.gameNo;
      var b = new Int8Array(N * N); for (var i = 0; i < N * N; i++) b[i] = g.board[i] === '.' ? -1 : +g.board[i];
      ui.S = { board: b, rem: g.rem, out: g.out, turn: g.turn };
      ui.ghost = null; ui.mvKey = '';
    }
    ui.myTurn = g.turn >= 0 && mine.indexOf(g.turn) >= 0 && g.wait <= 0;
    var tc = g.turn >= 0 && mine.indexOf(g.turn) >= 0 ? g.turn : (mine.filter(function (c) { return !g.out[c]; }).sort(function (a, b) { return ((a - g.turn + 4) % 4) - ((b - g.turn + 4) % 4); })[0]);
    if (tc == null) tc = mine.length ? mine[0] : Math.max(0, g.turn);
    if (tc !== ui.trayColor) { ui.trayColor = tc; ui.ghost = null; ui.mvKey = ''; }
    if (ui.sel != null && g.rem[tc].indexOf(ui.sel) < 0) { ui.sel = null; ui.ghost = null; }
    var mk = g.n + ':' + tc;
    if (ui.mvKey !== mk) {
      ui.mvKey = mk; var ms = g.out[tc] ? [] : L.legalMoves(ui.S, tc), byP = {};
      ms.forEach(function (m) { (byP[m.p] = byP[m.p] || []).push(m); });
      ui.mv = { moves: ms, byP: byP };
    }
    // 上のバー
    var cur = g.turn;
    $('phLabel').innerHTML = cur < 0 ? '終了' : '<span class="turnDot" style="background:' + COL[cur].f + '"></span>' + (ui.myTurn ? 'あなたの番！（' + COL[cur].n + '）' : esc(COL[cur].n + '：' + nameOf(v, cur)) + ' の番');
    var my = mine.reduce(function (s, c) { return s + g.scores[c]; }, 0);
    $('scoreChip').textContent = mine.length ? '⭐ ' + my + '点' : '観戦';
    $('players').innerHTML = g.owners.map(function (o, c) {
      var done = g.rem[c].length === 0;
      return '<div class="pc' + (c === cur ? ' cur' : '') + (g.out[c] ? ' out' : '') + (o.connected ? '' : ' off') + '" style="--cc:' + COL[c].f + '"><span class="sw" style="background:' + COL[c].f + '"></span><span class="nm">' + esc(o.kind === 'cpu' && !o.sub ? o.name.replace('ふーさん', '') + (o.lv === 'ultra' ? '😎' : '') : o.name) + '</span>' +
        '<span class="sc">' + g.scores[c] + '点</span><span class="rm">' + (done ? '🎉' : g.out[c] ? '🏳️' : '残' + g.rem[c].length) + '</span></div>';
    }).join('');
    paintStatus();
    $('passBtn').style.display = ui.myTurn && g.noMove ? '' : 'none';
    $('placeBtn').style.display = ui.myTurn && g.noMove ? 'none' : '';
    $('trayHead').innerHTML = '<span class="sw" style="background:' + COL[tc].f + '"></span>' + COL[tc].n + 'のピース（のこり' + g.rem[tc].length + '個・' + g.remSq[tc] + 'マス）' + (g.out[tc] ? ' — もう置けません' : '');
    $('lines').innerHTML = g.log.slice(-2).map(function (l) { var o = g.owners[l.c]; return '<div class="line"><span class="sw" style="background:' + COL[l.c].f + ';width:10px;height:10px"></span> ' + esc(o ? o.name : '') + '「' + esc(l.text) + '」</div>'; }).join('');
    paint();
  }
  function renderEnd(v) {
    var g = v.g, rows = [];
    function detail(c) { return g.rem[c].length === 0 ? (g.lastP[c] === 0 ? '全部置いた！最後が1マス +20' : '全部置いた！ +15') : '残り' + g.remSq[c] + 'マス（' + g.rem[c].length + '個）'; }
    if (g.two) {
      var hs = {}; g.owners.forEach(function (o, c) { var k = o.sid != null ? o.sid : 'c' + c; (hs[k] = hs[k] || { name: o.name, cs: [], sc: 0 }); hs[k].cs.push(c); hs[k].sc += g.scores[c]; });
      Object.keys(hs).forEach(function (k) { rows.push(hs[k]); });
    } else g.owners.forEach(function (o, c) { rows.push({ name: o.name, cs: [c], sc: g.scores[c], cpu: o.kind === 'cpu', lv: o.lv }); });
    rows.sort(function (a, b) { return b.sc - a.sc; });
    var rank = 0; $('rankList').innerHTML = rows.map(function (r, i) {
      if (i === 0 || r.sc < rows[i - 1].sc) rank = i + 1;
      return '<div class="rk' + (rank === 1 ? ' first' : '') + '"><span class="md">' + (['🥇', '🥈', '🥉'][rank - 1] || rank) + '</span>' + r.cs.map(function (c) { return '<span class="sw" style="background:' + COL[c].f + ';width:20px;height:20px"></span>'; }).join('') +
        '<span class="nm">' + esc(r.name) + (r.cpu ? ' <span class="lv ' + r.lv + '" style="font-size:10px;padding:1px 6px;border-radius:99px;background:#f2ead8">' + LV[r.lv] + '</span>' : '') + '<small>' + r.cs.map(detail).join(' ／ ') + '</small></span><span class="sc">' + r.sc + '</span></div>';
    }).join('') + (rows[0].cpu && rows.length > 1 && rows[1].sc < rows[0].sc ? '<p class="mid">' + BEAR + (rows[0].lv === 'ultra' ? '「計算どおりだクマ😎」' : '「ふーさんの勝ちクマ〜！」') + '</p>' : '');
    var b = new Int8Array(N * N); for (var i = 0; i < N * N; i++) b[i] = g.board[i] === '.' ? -1 : +g.board[i];
    drawBoard($('endBoard'), Math.min(320, $('endBoard').parentNode.clientWidth - 28 || 300), b, {});
    $('leaveBtn2').textContent = host ? '🚪 部屋を閉じる' : '🚪 部屋を出る';
  }

  // ---- ふーさん覚醒（アストラウルトラ）----
  var audioCtx = null, awT;
  function unlockAudio() { try { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; audioCtx = audioCtx || new AC(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) {} }
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  function awaken() {
    var el = $('awaken'); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(awT); awT = setTimeout(function () { el.classList.remove('on'); }, 2950);
    el.onclick = function () { el.classList.remove('on'); };
    try { sfx(); } catch (e) {}
  }
  function sfx() {
    unlockAudio(); var a = audioCtx; if (!a || a.state !== 'running') return;
    var t = a.currentTime + 0.02, out = a.createGain(); out.gain.value = 0.45; out.connect(a.destination);
    var len = Math.floor(a.sampleRate * 1.2), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0); for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var ns = a.createBufferSource(); ns.buffer = buf; var bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(260, t); bp.frequency.exponentialRampToValueAtTime(3800, t + 1.0);
    var ng = a.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.55, t + 0.95); ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.12);
    ns.connect(bp); bp.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + 1.2);
    var o = a.createOscillator(), og = a.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(130, t + 1.05); o.frequency.exponentialRampToValueAtTime(30, t + 1.9);
    og.gain.setValueAtTime(0.0001, t + 1.04); og.gain.exponentialRampToValueAtTime(0.95, t + 1.07); og.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(og); og.connect(out); o.start(t + 1.04); o.stop(t + 2.3);
    [1318.5, 1760, 2637].forEach(function (f, j) { var s = a.createOscillator(), sg = a.createGain(), st = t + 1.22 + j * 0.07; s.type = 'triangle'; s.frequency.value = f; sg.gain.setValueAtTime(0.0001, st); sg.gain.exponentialRampToValueAtTime(0.1, st + 0.02); sg.gain.exponentialRampToValueAtTime(0.0001, st + 0.7); s.connect(sg); sg.connect(out); s.start(st); s.stop(st + 0.75); });
  }
  function renderTitle() {
    if (!$('nameIn').value) $('nameIn').value = load(LS_NAME) || '';
    var inv = normCode(Q.get('room'));
    $('inviteJoinBox').style.display = inv.length === 4 ? '' : 'none';
    $('invCode').textContent = inv;
    if (inv.length === 4) $('codeIn').value = inv;
    var saved = load(LS_HOST, true), ok = saved && saved.room && Date.now() - saved.saved < 12 * 3600 * 1000;
    $('resumeBtn').style.display = ok ? '' : 'none';
    if (ok) $('resumeBtn').textContent = '前回の部屋（' + saved.room.code + '）を再開する';
    var joined = sload(SS_CLIENT);
    $('rejoinBtn').style.display = joined ? '' : 'none';
    if (joined) $('rejoinBtn').textContent = '部屋 ' + joined.code + ' に戻る（' + joined.name + '）';
  }
  function getName() {
    var n = cleanName($('nameIn').value);
    if (!n) { toast('ニックネームを入力してください'); $('nameIn').focus(); return null; }
    store(LS_NAME, n); return n;
  }
  $('createBtn').onclick = function () { var n = getName(); if (n) { store(LS_HOST, null); startHost(n, null); } };
  $('resumeBtn').onclick = function () { var saved = load(LS_HOST, true); if (!saved) return; startHost(saved.room.seats[0].name, saved.room); host.resuming = true; };
  function join(code) {
    var n = getName(); if (!n) return;
    code = normCode(code);
    if (code.length !== 4) { toast('4文字の部屋コードを入力してください'); return; }
    startClient(code, n);
  }
  $('joinBtn').onclick = function () { join($('codeIn').value); };
  $('joinInvitedBtn').onclick = function () { join(Q.get('room')); };
  $('rejoinBtn').onclick = function () { var j = sload(SS_CLIENT); if (j) { $('nameIn').value = j.name; startClient(j.code, j.name); } };
  $('codeIn').addEventListener('input', function () { this.value = normCode(this.value); });
  if (location.protocol === 'file:') setTimeout(function () { toast('ファイルを直接開いています。招待URLは公開URL（https）でのみ使えます。'); }, 500);

  // テスト用：自動で打つ（window.__kj.autoplay = true）
  setInterval(function () {
    if (!window.__kj.autoplay || !lastView || lastView.phase !== 'game' || !ui.myTurn || pending || !ui.mv) return;
    if (lastView.g.noMove) return act({ t: 'pass' });
    var ms = ui.mv.moves; if (!ms.length) return; var m = ms[Math.floor(Math.random() * ms.length)]; act({ t: 'place', p: m.p, o: m.o, x: m.x, y: m.y });
  }, 60);
  // テスト・デバッグ用
  window.__kj = { view: null, autoplay: false, ui: ui, act: function (m) { act(m); }, awaken: function () { awaken(); }, role: function () { return host ? 'host' : client ? 'client' : 'none'; }, hostRoom: function () { return host ? host.room : null; } };
  renderTitle();
})();
