/* 受众重叠分析 - 离线模拟引擎
 * 用 26 万虚拟玩家在内存中真实构建集合，再做交集运算，
 * 展示时统一 ×20 外扩到 520 万大盘口径，保证占比精确、人数接近真实量级。
 */
window.Sim = (function () {
  const SCALE = 20;
  const N = 260000;
  const DAY = 86400000;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0);
  }

  const CLUSTERS = ['硬核动作', '策略布局', '休闲合成', '社交竞技', '二次元', '开放探索',
    '模拟养成', '塔防防线', '解谜烧脑', '射击对抗', '剧情沉浸', '派对轻娱乐'];

  const EXISTING = [
    { id: 0, name: '江湖剑影', genre: 'MMORPG', share: 0.205, w: [1.6, 0.6, 0.3, 1.3, 0.5, 1.2, 0.4, 0.3, 0.4, 0.9, 1.1, 0.5] },
    { id: 1, name: '星域远征', genre: 'SLG 策略', share: 0.142, w: [0.7, 1.8, 0.5, 0.8, 0.6, 1.0, 0.4, 1.6, 0.6, 0.9, 0.7, 0.3] },
    { id: 2, name: '萌宠餐厅', genre: '模拟经营', share: 0.178, w: [0.3, 0.9, 1.7, 0.5, 0.7, 0.6, 1.8, 0.8, 1.1, 0.2, 0.6, 1.3] },
    { id: 3, name: '极速狂飙', genre: '竞速', share: 0.098, w: [0.8, 0.4, 0.6, 1.5, 0.4, 1.1, 0.3, 0.6, 0.5, 1.4, 0.5, 0.9] },
    { id: 4, name: '王城争霸', genre: '国战策略', share: 0.121, w: [1.2, 1.5, 0.4, 1.4, 0.3, 0.9, 0.4, 1.3, 0.4, 1.1, 0.8, 0.5] }
  ];

  const TEMPLATES = [
    { genre: '开放世界 RPG', w: [1.2, 0.7, 0.5, 1.1, 0.8, 1.8, 0.5, 0.5, 1.2, 0.9, 1.5, 0.6], cvr: 0.118, comp: [0, 4], recallRate: 0.30 },
    { genre: '策略经营', w: [0.6, 1.7, 0.7, 1.0, 0.4, 0.8, 1.2, 1.5, 0.6, 0.8, 0.7, 0.4], cvr: 0.092, comp: [1, 4], recallRate: 0.26 },
    { genre: '休闲合成', w: [0.3, 0.8, 1.8, 0.6, 0.5, 0.5, 1.5, 0.7, 1.4, 0.2, 0.5, 1.5], cvr: 0.156, comp: [2], recallRate: 0.335 },
    { genre: '二次元卡牌', w: [0.9, 0.6, 0.5, 0.9, 1.9, 1.1, 0.6, 0.4, 0.8, 0.7, 1.4, 0.8], cvr: 0.104, comp: [0], recallRate: 0.285 },
    { genre: '派对竞技', w: [0.7, 0.5, 0.9, 1.8, 0.6, 0.7, 0.5, 0.5, 0.7, 1.6, 0.5, 1.6], cvr: 0.131, comp: [3, 0], recallRate: 0.30 },
    { genre: '解谜叙事', w: [0.5, 0.9, 1.2, 0.5, 0.6, 0.9, 1.0, 0.6, 1.8, 0.3, 1.7, 1.0], cvr: 0.112, comp: [2], recallRate: 0.245 }
  ];

  const L7 = [0.90, 0.62, 0.30]; // 高活/中活/低活 7 日活跃概率
  const LVL_NAME = ['高频活跃', '中频活跃', '低频活跃'];

  const S = {
    built: false,
    lvl: null, c1: null, c2: null, c3: null, noise: null,
    occIdx: null, occQ: null,
    active: null, activeTotal: 0, activeByLvl: [0, 0, 0],
    games: [], seeds: [], result: null, period: null
  };

  function buildUniverse() {
    if (S.built) return;
    const rnd = mulberry32(20261029);
    S.lvl = new Uint8Array(N); S.c1 = new Uint8Array(N);
    S.c2 = new Uint8Array(N); S.c3 = new Uint8Array(N);
    S.noise = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const r = rnd();
      S.lvl[i] = r < 0.16 ? 0 : r < 0.53 ? 1 : 2;
      S.c1[i] = (rnd() * 12) | 0;
      S.c2[i] = (rnd() * 12) | 0;
      S.c3[i] = (rnd() * 12) | 0;
      S.noise[i] = rnd();
    }
    buildOccupancy();
    S.built = true;
  }

  function score(arrs, i, w) {
    const a = S.c1[i], b = S.c2[i], c = S.c3[i];
    let s = w[a] * 1.0;
    if (b !== a) s += w[b] * 0.62;
    if (c !== a && c !== b) s += w[c] * 0.34;
    return s + S.noise[i] * 0.55;
  }

  function topThreshold(w, k) {
    const sc = new Float32Array(N);
    for (let i = 0; i < N; i++) sc[i] = score(null, i, w);
    const sorted = Float32Array.from(sc).sort();
    const th = sorted[Math.max(0, N - k)];
    return { sc, th };
  }

  function buildOccupancy() {
    S.occIdx = new Int8Array(N);   // 0 = 未被存量占据；1..k = 主占用玩法序号
    S.occQ = new Float32Array(N);
    EXISTING.forEach((g, gi) => {
      const k = Math.round(N * g.share);
      const { sc, th } = topThreshold(g.w, k);
      for (let i = 0; i < N; i++) {
        if (sc[i] < th) continue;
        const q = sc[i] / th;           // 相对强度，>1 视为被该玩法占据
        if (q > S.occQ[i]) { S.occQ[i] = q; S.occIdx[i] = gi + 1; }
      }
    });
  }

  /* 新玩法画像：优先用玩法 ID（主键）哈希，缺失时回退到名称 */
  function makeGame(game, idx, usedTpl) {
    const name = typeof game === 'string' ? game : String((game && game.name) || '');
    const gid = (game && typeof game === 'object' && game.id) ? String(game.id) : '';
    const h = hash(gid || name);
    let t = h % TEMPLATES.length;
    let guard = 0;
    while (usedTpl.has(t) && guard++ < TEMPLATES.length) t = (t + 1) % TEMPLATES.length;
    usedTpl.add(t);
    const tpl = TEMPLATES[t];
    const grayEval = 2200 + (h % 5200);
    const cvr = +(tpl.cvr + ((h >> 5) % 21 - 10) / 1000).toFixed(4);
    const seedExt = 1200 + ((h >> 9) % 1800);
    return {
      key: gid || ('g' + idx), id: gid, name, genre: tpl.genre, w: tpl.w, comp: tpl.comp,
      compNames: tpl.comp.map(function (id) { return EXISTING[id].name; }),
      grayEval, grayConverted: Math.round(grayEval * cvr), cvr, seedExt,
      recallRate: tpl.recallRate, potentialInternal: 0, seedInternal: 0,
      seedFromGray: 0, seedFromComp: 0
    };
  }

  function pickSample(pool, k, rnd) {
    if (k <= 0 || pool.length === 0) return [];
    if (pool.length <= k) return pool.slice();
    const out = []; const step = pool.length / k; let p = rnd() * step;
    for (let j = 0; j < k; j++) { out.push(pool[Math.min(pool.length - 1, Math.floor(p))]); p += step; }
    return out;
  }

  /* 第二步：种子玩家 → 90 天活跃池相似召回 */
  function recall(games) {
    buildUniverse();
    S.pmask = new Uint8Array(N);
    games.forEach((g, gi) => {
      const bit = 1 << gi;
      const k = Math.round(N * g.recallRate);
      const { sc, th } = topThreshold(g.w, k);
      const cand = [];
      for (let i = 0; i < N; i++) if (sc[i] >= th) cand.push(i);

      const compPool = [];
      for (let i = 0; i < N; i++) {
        if (S.occIdx[i] > 0 && g.comp.indexOf(S.occIdx[i] - 1) >= 0) compPool.push(i);
      }
      const seedComp = pickSample(compPool, g.seedExt, mulberry32(hash(g.name)));
      const seedGray = pickSample(cand, g.grayConverted, mulberry32(hash(g.name) + 7));
      const seedSet = new Set(seedComp.concat(seedGray));

      for (let j = 0; j < cand.length; j++) S.pmask[cand[j]] |= bit;
      seedSet.forEach(function (i) { S.pmask[i] |= bit; });

      let pot = 0;
      for (let i = 0; i < N; i++) if (S.pmask[i] & bit) pot++;

      g.potentialInternal = pot;
      g.seedInternal = seedSet.size;
      g.seedFromComp = seedSet.size - seedGray.length;
      g.seedFromGray = seedGray.length;
      g.compNames = g.comp.map(function (id) { return EXISTING[id].name; });
    });
    S.games = games;
  }

  /* 第三步：拉取目标周期内预估活跃玩家 */
  function buildActive(days) {
    const rnd = mulberry32(9000 + days * 31);
    S.active = new Uint8Array(N);
    S.activeTotal = 0; S.activeByLvl = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const p7 = L7[S.lvl[i]];
      const p = 1 - Math.pow(1 - p7, days / 7);
      if (rnd() < p) { S.active[i] = 1; S.activeTotal++; S.activeByLvl[S.lvl[i]]++; }
    }
  }

  /* 第四步：重叠度匹配 + 转化预估 */
  function analyze(days, periodLabel) {
    const K = S.games.length;
    const potUnion = new Uint8Array(N);
    let potUnionN = 0;
    const res = {
      days: days, periodLabel: periodLabel,
      activeTotal: S.activeTotal, activeByLvl: S.activeByLvl.slice(),
      universe: N, games: [], matrix: [], existingOcc: [],
      unionPotentialActive: 0, multiTagged: 0, overlapNewPair: 0
    };

    S.games.forEach(function (g, gi) {
      const bit = 1 << gi;
      const liveDetail = new Array(EXISTING.length).fill(0);
      const batchDetail = new Array(K).fill(0);
      const row = new Array(K).fill(0);
      let potTotal = 0, potActive = 0, freeN = 0, liveN = 0, batchN = 0;

      for (let i = 0; i < N; i++) {
        if (!(S.pmask[i] & bit)) continue;
        potTotal++;
        if (!S.active[i]) continue;
        potActive++;
        if (!potUnion[i]) { potUnion[i] = 1; potUnionN++; }
        const other = S.pmask[i] & ~bit;
        if (S.occIdx[i] > 0) { liveN++; liveDetail[S.occIdx[i] - 1]++; }
        else if (other) { batchN++; }
        else freeN++;
        for (let j = 0; j < K; j++) if (other & (1 << j)) { batchDetail[j]++; row[j]++; }
      }

      g.potTotal = potTotal;
      g.potActive = potActive;
      g.freeN = freeN; g.liveN = liveN; g.batchN = batchN;
      g.liveDetail = liveDetail; g.batchDetail = batchDetail;
      res.matrix.push(row);
      res.games.push(g);
    });

    // 新增口径：同一玩家被多个新玩法标记
    for (let i = 0; i < N; i++) {
      if (!S.active[i]) continue;
      const m = S.pmask[i];
      if (m && (m & (m - 1))) res.multiTagged++;
    }

    res.unionPotentialActive = potUnionN;
    res.otherActive = S.activeTotal - potUnionN;

    // 存量玩法占用分布（仅统计新玩法潜在人群内）
    res.existingOcc = EXISTING.map(function (e, ei) {
      let n = 0;
      for (let i = 0; i < N; i++) {
        if (S.active[i] && potUnion[i] && S.occIdx[i] === ei + 1) n++;
      }
      return { name: e.name, genre: e.genre, n: n };
    });

    // 转化预估
    res.games.forEach(function (g) {
      const rows = [
        { key: 'free', name: '未被其他玩法占据', n: g.freeN, mult: 2.0, color: 'var(--free)' },
        { key: 'live', name: '被已上架玩法占据', n: g.liveN, mult: 0.8, color: 'var(--live)' },
        { key: 'batch', name: '与同批次新玩法重叠', n: g.batchN, mult: 0.6, color: 'var(--batch)' },
        { key: 'other', name: '其他活跃玩家（长尾）', n: res.otherActive, mult: 0.2, color: 'var(--long)' }
      ];
      let conv = 0;
      rows.forEach(function (r) {
        r.rate = Math.min(0.9, g.cvr * r.mult);
        r.conv = r.n * r.rate;
        r.shareOfActive = r.n / S.activeTotal;
        conv += r.conv;
      });
      g.convRows = rows;
      g.convTotal = conv;
      g.convRate = conv / S.activeTotal;
    });

    S.result = res;
    return res;
  }

  return {
    SCALE, N, CLUSTERS, EXISTING, LVL_NAME, S, TEMPLATES,
    buildUniverse, score, topThreshold, makeGame, recall, buildActive, analyze,
    fmt: function (n) { return (n * SCALE).toLocaleString('zh-CN'); },
    raw: function (n) { return Math.round(n * SCALE); }
  };
})();
