/* 角取り陣 — ルールとCPU（ブラウザ・Node共通）
 * 盤：20×20。色 0=藍(左上) 1=山吹(右上) 2=紅(右下) 3=若竹(左下)。手番は 0→1→2→3。
 * ピース：1〜5マスの21種（自由ポリオミノ全部）＝1色89マス。
 */
(function (root) {
  'use strict';
  var N = 20, NC = 4;
  var CORNERS = [[0, 0], [N - 1, 0], [N - 1, N - 1], [0, N - 1]];
  var SHAPES = [
    ['X'], ['XX'], ['XXX'], ['X.', 'XX'],
    ['XXXX'], ['XX', 'XX'], ['XXX', '.X.'], ['XXX', 'X..'], ['.XX', 'XX.'],
    ['.XX', 'XX.', '.X.'], ['XXXXX'], ['XXXX', 'X...'], ['XX..', '.XXX'], ['XX', 'XX', 'X.'], ['XXX', '.X.', '.X.'],
    ['X.X', 'XXX'], ['X..', 'X..', 'XXX'], ['X..', 'XX.', '.XX'], ['.X.', 'XXX', '.X.'], ['XXXX', '.X..'], ['XX.', '.X.', '.XX']
  ];
  // 置きにくい形ほど早めに使いたい（CPU用の重み）
  var AWK = [0, 0, 0, 0.2, 0.3, 0.6, 0.5, 0.4, 0.6, 1.2, 0.8, 0.7, 0.9, 0.6, 1.0, 1.0, 1.0, 1.2, 1.4, 0.8, 1.2];
  function norm(cells) {
    var mx = Math.min.apply(null, cells.map(function (c) { return c[0]; })), my = Math.min.apply(null, cells.map(function (c) { return c[1]; }));
    return cells.map(function (c) { return [c[0] - mx, c[1] - my]; }).sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
  }
  // 変換 k = r + 4f：f=1なら左右反転してから、時計回りに r 回まわす
  function transform(cells, k) {
    var r = k % 4, f = k >= 4;
    return norm(cells.map(function (c) {
      var x = f ? -c[0] : c[0], y = c[1];
      for (var i = 0; i < r; i++) { var t = x; x = -y; y = t; }
      return [x, y];
    }));
  }
  var PIECES = SHAPES.map(function (rows, id) {
    var base = [];
    rows.forEach(function (row, y) { for (var x = 0; x < row.length; x++) if (row[x] === 'X') base.push([x, y]); });
    var orients = [], keys = {}, kToO = [];
    for (var k = 0; k < 8; k++) {
      var c = transform(base, k), key = JSON.stringify(c);
      if (!(key in keys)) { keys[key] = orients.length; orients.push({ cells: c, w: Math.max.apply(null, c.map(function (q) { return q[0]; })) + 1, h: Math.max.apply(null, c.map(function (q) { return q[1]; })) + 1 }); }
      kToO.push(keys[key]);
    }
    return { id: id, size: base.length, orients: orients, kToO: kToO, awk: AWK[id] };
  });
  var TOTAL = PIECES.reduce(function (s, p) { return s + p.size; }, 0);   // 89
  function rotK(k) { return (k % 4 + 1) % 4 + (k >= 4 ? 4 : 0); }
  function flipK(k) { return (4 - k % 4) % 4 + (k >= 4 ? 0 : 4); }

  function newState() {
    var b = new Int8Array(N * N); b.fill(-1);
    var rem = [], i; for (var c = 0; c < NC; c++) { rem.push([]); for (i = 0; i < PIECES.length; i++) rem[c].push(i); }
    return { board: b, rem: rem, last: [-1, -1, -1, -1], out: [false, false, false, false], turn: 0, moves: [] };
  }
  function clone(S) { return { board: new Int8Array(S.board), rem: S.rem.map(function (r) { return r.slice(); }), last: S.last.slice(), out: S.out.slice(), turn: S.turn, moves: S.moves.slice() }; }
  function inb(x, y) { return x >= 0 && y >= 0 && x < N && y < N; }
  function isFirst(S, c) { return S.rem[c].length === PIECES.length; }
  function cellsOf(p, o, x, y) {
    var cs = PIECES[p].orients[o].cells, out = [];
    for (var i = 0; i < cs.length; i++) { var cx = x + cs[i][0], cy = y + cs[i][1]; if (!inb(cx, cy)) return null; out.push(cy * N + cx); }
    return out;
  }
  function edgeOwn(S, c, idx) {
    var x = idx % N, y = (idx / N) | 0, b = S.board;
    return (x > 0 && b[idx - 1] === c) || (x < N - 1 && b[idx + 1] === c) || (y > 0 && b[idx - N] === c) || (y < N - 1 && b[idx + N] === c);
  }
  function diagOwn(S, c, idx) {
    var x = idx % N, y = (idx / N) | 0, b = S.board;
    return (x > 0 && y > 0 && b[idx - N - 1] === c) || (x < N - 1 && y > 0 && b[idx - N + 1] === c) || (x > 0 && y < N - 1 && b[idx + N - 1] === c) || (x < N - 1 && y < N - 1 && b[idx + N + 1] === c);
  }
  // 理由つきの判定（UI・テスト用）。null なら置ける
  function whyIllegal(S, c, p, o, x, y) {
    if (S.out[c]) return 'out';
    if (S.rem[c].indexOf(p) < 0) return 'used';
    if (!PIECES[p] || !PIECES[p].orients[o]) return 'bad';
    var cells = cellsOf(p, o, x, y); if (!cells) return 'outside';
    var corner = false, touch = false, ci = CORNERS[c][1] * N + CORNERS[c][0], first = isFirst(S, c);
    for (var i = 0; i < cells.length; i++) {
      var k = cells[i];
      if (S.board[k] !== -1) return 'overlap';
      if (edgeOwn(S, c, k)) return 'edge';
      if (k === ci) corner = true;
      if (!first && diagOwn(S, c, k)) touch = true;
    }
    if (first) return corner ? null : 'corner';
    return touch ? null : 'nocorner';
  }
  function isLegal(S, c, p, o, x, y) { return whyIllegal(S, c, p, o, x, y) === null; }
  // 角でつながれるマス（ここをおおうように置く）
  function anchors(S, c) {
    if (S.out[c]) return [];
    if (isFirst(S, c)) { var ci = CORNERS[c][1] * N + CORNERS[c][0]; return S.board[ci] === -1 ? [ci] : []; }
    var out = [];
    for (var k = 0; k < N * N; k++) if (S.board[k] === -1 && diagOwn(S, c, k) && !edgeOwn(S, c, k)) out.push(k);
    return out;
  }
  // 合法手の列挙。opts: {piece, limit}
  function legalMoves(S, c, opts) {
    opts = opts || {};
    var res = [], seen = {}, an = anchors(S, c), pcs = opts.piece != null ? [opts.piece] : S.rem[c];
    if (opts.piece != null && S.rem[c].indexOf(opts.piece) < 0) return res;
    for (var a = 0; a < an.length; a++) {
      var ax = an[a] % N, ay = (an[a] / N) | 0;
      for (var pi = 0; pi < pcs.length; pi++) {
        var p = pcs[pi], P = PIECES[p];
        for (var o = 0; o < P.orients.length; o++) {
          var cs = P.orients[o].cells;
          for (var j = 0; j < cs.length; j++) {
            var x = ax - cs[j][0], y = ay - cs[j][1], key = (p * 8 + o) * 1024 + (y + 5) * 32 + (x + 5);
            if (seen[key]) continue; seen[key] = 1;
            if (fits(S, c, cs, x, y)) { res.push({ p: p, o: o, x: x, y: y }); if (opts.limit && res.length >= opts.limit) return res; }
          }
        }
      }
    }
    return res;
  }
  // anchors 経由で呼ぶので、角の条件は満たされている（重なり・外・辺接触だけ見る）
  function fits(S, c, cs, x, y) {
    for (var i = 0; i < cs.length; i++) {
      var cx = x + cs[i][0], cy = y + cs[i][1];
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) return false;
      var k = cy * N + cx;
      if (S.board[k] !== -1 || edgeOwn(S, c, k)) return false;
    }
    return true;
  }
  function hasMove(S, c) { return legalMoves(S, c, { limit: 1 }).length > 0; }
  function place(S, c, m) {
    var cells = cellsOf(m.p, m.o, m.x, m.y);
    cells.forEach(function (k) { S.board[k] = c; });
    S.rem[c].splice(S.rem[c].indexOf(m.p), 1);
    S.last[c] = m.p;
    S.moves.push({ c: c, p: m.p, o: m.o, x: m.x, y: m.y });
    if (!S.rem[c].length) S.out[c] = true;   // 全部置いたら終わり
    return cells;
  }
  function remSquares(S, c) { return S.rem[c].reduce(function (s, p) { return s + PIECES[p].size; }, 0); }
  // 公式得点：残りマス×−1。全部置いたら +15、最後が1マスなら さらに +5
  function score(S, c) { if (!S.rem[c].length) return 15 + (S.last[c] === 0 ? 5 : 0); return -remSquares(S, c); }
  function gameOver(S) { return S.out.every(Boolean); }
  // 次の手番へ（out の色はとばす）。全員 out なら turn=-1
  function advance(S) {
    if (gameOver(S)) { S.turn = -1; return -1; }
    for (var i = 1; i <= NC; i++) { var c = (S.turn + i) % NC; if (!S.out[c]) { S.turn = c; return c; } }
    S.turn = -1; return -1;
  }
  function pass(S, c) { S.out[c] = true; S.moves.push({ c: c, pass: true }); }

  // ---------------- CPU（ふーさん） ----------------
  var LEVELS = ['weak', 'normal', 'strong', 'ultra'];
  function anchorMask(S, c) { var m = new Uint8Array(N * N); anchors(S, c).forEach(function (k) { m[k] = 1; }); return m; }
  // 1手の静的評価
  function evalMove(S, c, m, ctx, lv) {
    var cells = cellsOf(m.p, m.o, m.x, m.y), P = PIECES[m.p], placed = PIECES.length - S.rem[c].length;
    var set = {}, i, k; for (i = 0; i < cells.length; i++) set[cells[i]] = 1;
    // 自分の角：増えた分 − つぶれた分
    var gain = 0, lost = 0, seen = {};
    for (i = 0; i < cells.length; i++) {
      var x = cells[i] % N, y = (cells[i] / N) | 0;
      for (var d = 0; d < 4; d++) {
        var nx = x + (d & 1 ? 1 : -1), ny = y + (d & 2 ? 1 : -1); if (!inb(nx, ny)) continue;
        k = ny * N + nx; if (seen[k] || set[k] || S.board[k] !== -1) continue; seen[k] = 1;
        if (ctx.own[k]) continue;
        if (edgeOwn(S, c, k) || edgeNew(k, set)) continue;
        gain++;
      }
    }
    for (k in ctx.ownList) { k = ctx.ownList[k]; if (set[k] || edgeNew(k, set)) lost++; }
    var s = P.size * (lv === 'normal' ? 10 : placed < 9 ? 14 : 9) + (gain - lost) * (lv === 'normal' ? 1.5 : 2.2);
    if (lv === 'normal') return s;
    // 相手の角をふさぐ
    var block = 0;
    for (var o = 0; o < NC; o++) { if (o === c || S.out[o]) continue; var w = ctx.oppW[o]; for (i = 0; i < cells.length; i++) if (ctx.opp[o][cells[i]]) block += w; }
    s += block * (lv === 'ultra' ? 4.2 : 3);
    // 序盤は中央へ
    if (placed < 7) { var cx = 0, cy = 0; cells.forEach(function (q) { cx += q % N; cy += (q / N) | 0; }); cx /= cells.length; cy /= cells.length; s -= (Math.abs(cx - 9.5) + Math.abs(cy - 9.5)) * (lv === 'ultra' ? 1.1 : 0.8); }
    s += P.awk * (placed < 12 ? 3 : 1);
    return s;
  }
  function edgeNew(k, set) { var x = k % N; return (x > 0 && set[k - 1]) || (x < N - 1 && set[k + 1]) || set[k - N] || set[k + N]; }
  function mobility(S, c) { return S.out[c] ? 0 : legalMoves(S, c).length; }
  // 「まだ届くマス」の数（合法手がおおえるマスの種類）と、置ける駒の大きさの合計
  function reach(S, c) {
    if (S.out[c]) return { area: 0, big: 0 };
    var ms = legalMoves(S, c), seen = new Uint8Array(N * N), area = 0, ps = {}, big = 0;
    for (var i = 0; i < ms.length; i++) {
      var cells = cellsOf(ms[i].p, ms[i].o, ms[i].x, ms[i].y);
      for (var j = 0; j < cells.length; j++) if (!seen[cells[j]]) { seen[cells[j]] = 1; area++; }
      if (!ps[ms[i].p]) { ps[ms[i].p] = 1; big += PIECES[ms[i].p].size; }
    }
    return { area: area, big: big };
  }
  var UW = { a: 1.0, b: 1.8, g: 0.6, K: 24 };
  function aiMove(S, c, lv, rng, budgetMs) {
    rng = rng || Math.random;
    var moves = legalMoves(S, c);
    if (!moves.length) return null;
    if (lv === 'weak') {
      // ランダムな駒（小さい駒が少し出やすい）→ランダムな置き方
      var byP = {}; moves.forEach(function (m) { (byP[m.p] = byP[m.p] || []).push(m); });
      var ps = Object.keys(byP), wts = ps.map(function (p) { return 1 + (5 - PIECES[p].size) * 0.35; }), sum = wts.reduce(function (a, b) { return a + b; }, 0), r = rng() * sum;
      for (var i = 0; i < ps.length; i++) { r -= wts[i]; if (r <= 0) break; }
      var list = byP[ps[Math.min(i, ps.length - 1)]]; return list[Math.floor(rng() * list.length)];
    }
    var own = anchorMask(S, c), ctx = { own: own, ownList: [], opp: [], oppW: [] };
    for (var k = 0; k < N * N; k++) if (own[k]) ctx.ownList.push(k);
    for (var o = 0; o < NC; o++) {
      ctx.opp.push(o === c ? null : anchorMask(S, o));
      // 得点で上の相手・次の手番の相手ほど強くふさぐ
      ctx.oppW.push(o === c ? 0 : 1 + (o === (c + 1) % NC ? 0.3 : 0) + Math.max(0, remSquares(S, c) - remSquares(S, o)) * 0.01);
    }
    var scored = moves.map(function (m) { return { m: m, s: evalMove(S, c, m, ctx, lv) + rng() * (lv === 'normal' ? 3 : 0.6) }; });
    scored.sort(function (a, b) { return b.s - a.s; });
    if (lv !== 'ultra') return scored[0].m;
    // アストラウルトラ：上位候補を実際に置いてみて、自分と相手の「置ける手の数」で読み比べる
    var t0 = Date.now(), budget = budgetMs || 400, K = Math.min(scored.length, UW.K), best = null;
    var opps = []; for (o = 0; o < NC; o++) if (o !== c && !S.out[o]) opps.push(o);
    var late = PIECES.length - S.rem[c].length > 14;
    for (var j = 0; j < K; j++) {
      if (j >= 4 && Date.now() - t0 > budget) break;
      var T = clone(S); place(T, c, scored[j].m);
      var me = T.out[c] ? { area: 80, big: 0 } : reach(T, c), oppSum = 0;
      opps.forEach(function (q) { var r = reach(T, q); oppSum += (r.area + UW.g * r.big) * ctx.oppW[q]; });
      var v = scored[j].s + UW.a * (me.area + UW.g * me.big) - UW.b * oppSum / Math.max(1, opps.length);
      if (late && T.rem[c].length === 0 && scored[j].m.p === 0) v += 30;   // 最後を1マスで締める
      if (!best || v > best.v) best = { v: v, m: scored[j].m };
    }
    return best.m;
  }
  // テスト用の乱数
  function rngFrom(seed) { var s = seed >>> 0 || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

  var api = { N: N, NC: NC, CORNERS: CORNERS, PIECES: PIECES, TOTAL: TOTAL, LEVELS: LEVELS, rotK: rotK, flipK: flipK, newState: newState, clone: clone, cellsOf: cellsOf, whyIllegal: whyIllegal, isLegal: isLegal,
    anchors: anchors, legalMoves: legalMoves, hasMove: hasMove, place: place, pass: pass, remSquares: remSquares, score: score, gameOver: gameOver, advance: advance, aiMove: aiMove, rngFrom: rngFrom, UW: UW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KJ = api;
})(this);
