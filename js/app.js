/* 受众重叠分析台 - 交互层 */
(function () {
  const $ = function (s) { return document.querySelector(s); };
  const $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  const Sim = window.Sim;
  const SAMPLE = ['ng_100231,幻境迷宫', 'ng_100232,末日方舟', 'ng_100233,旅人酒馆', 'ng_100234,云端农场'];
  const STEP_TITLES = [
    ['上传目标玩法列表', '种子玩家与相似召回'],
    ['选择目标宣推周期', '周期内预估活跃人群'],
    ['开始重叠度匹配', '潜在受众 × 周期活跃'],
    ['结果看板', '重叠结构与转化预估']
  ];

  const A = {
    step: 1, maxStep: 1, games: [], seedsReady: false, activeReady: false,
    matched: false, days: 7, start: null, end: null, result: null, open: 0, running: false,
    core: [], coreTouched: false, targetRate: 0.95, advice: null
  };

  /* 核心玩法达标率可选档位 */
  const RATE_OPTS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1];

  const fmtNum = function (n) { return Math.round(n * Sim.SCALE).toLocaleString('zh-CN'); };
  const fmtPct = function (x, d) { const v = (x * 100); return v.toFixed(d === undefined ? 1 : d) + '%'; };
  const fmtRate = function (x) { return (x * 100).toFixed(2) + '%'; };
  const esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  const addDays = function (d, n) { return new Date(d.getTime() + n * 86400000); };
  const ymd = function (d) { return d.toISOString().slice(0, 10); };
  const cnDate = function (d) { return (d.getMonth() + 1) + '月' + d.getDate() + '日'; };
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._tm); t._tm = setTimeout(function () { t.classList.remove('show'); }, 2000);
  }

  function renderNav() {
    $('#stepNav').innerHTML = STEP_TITLES.map(function (t, i) {
      const n = i + 1;
      const cls = n === A.step ? 'is-active' : (n < A.step ? 'done' : '');
      return '<button class="step-item ' + cls + '" data-goto="' + n + '">' +
        '<span class="step-idx">' + (n < A.step ? '✓' : n) + '</span>' +
        '<span class="step-copy"><b>' + t[0] + '</b><i>' + t[1] + '</i></span></button>';
    }).join('');
  }

  function goto(step) {
    if (step > A.maxStep) { toast('请先完成当前步骤'); return; }
    A.step = step;
    if (step === 3 && !A.matched) renderStep3();
    $$('.step').forEach(function (s) { s.classList.toggle('is-active', s.id === 'step-' + step); });
    renderNav();
    $('#crumb').textContent = '第 ' + step + ' 步 / 共 4 步';
    $('#pageTitle').textContent = STEP_TITLES[step - 1][0];
    syncBottom();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function syncBottom() {
    const next = $('#btnNext'), prev = $('#btnPrev');
    prev.disabled = A.step === 1;
    let ok = true, txt = '下一步';
    if (A.step === 1) { ok = A.seedsReady; txt = '下一步：选择宣推周期'; }
    else if (A.step === 2) { ok = A.activeReady; txt = '下一步：重叠度匹配'; }
    else if (A.step === 3) { ok = A.matched; txt = '查看分析结果'; }
    else { ok = false; txt = '已完成分析'; }
    next.disabled = !ok;
    next.textContent = txt;
    if (A.step === 4) prev.disabled = false;
  }

  /* ================= 步骤 1 ================= */
  function renderStep1() {
    $('#step-1').innerHTML = [
      '<div class="step-head"><h2>上传目标玩法列表</h2>',
      '<p>上传后系统自动拉取：① 每个玩法灰度期间转化的玩家名单 ② 已上线竞品玩法近 30 天参与玩家，合并为种子人群；再从大盘近 90 天活跃玩家中召回相似玩家，作为该玩法的潜在受众。</p></div>',
      '<div class="grid-2">',
      '  <div class="card">',
      '    <div class="card-head"><h2>1.1 目标玩法列表</h2><span class="hint">CSV / TXT / JSON · 每行「玩法ID,玩法名」· 最多 8 个</span></div>',
      '    <label class="dropzone" id="dropzone">',
      '      <input type="file" id="fileInput" accept=".csv,.txt,.json" hidden />',
      '      <div class="dz-ico">↑</div>',
      '      <div class="dz-title">点击或拖拽文件到此处上传</div>',
      '      <div class="dz-sub">UTF-8 编码 csv / txt / json，首行可为表头（game_id,game_name）</div>',
      '    </label>',
      '    <div class="or">或直接粘贴 / 编辑</div>',
      '    <textarea id="gameInput" rows="5" spellcheck="false" placeholder="ng_100231,幻境迷宫&#10;ng_100232,末日方舟"></textarea>',
      '    <div class="parse-hint" id="parseHint"></div>',
      '    <div class="row between" style="margin-top:10px">',
      '      <button class="btn ghost sm" id="loadSample">载入示例玩法</button>',
      '      <button class="btn primary" id="btnPull">拉取种子玩家并召回</button>',
      '    </div>',
      '  </div>',
      '  <div class="card">',
      '    <div class="card-head"><h2>1.2 种子玩家自动拉取</h2><span class="tag" id="seedStatus">待拉取</span></div>',
      '    <div id="seedBody"><div class="empty">上传玩法列表后自动拉取灰度转化名单与竞品参与名单…</div></div>',
      '  </div>',
      '</div>',
      '<div class="card">',
      '  <div class="card-head"><h2>1.3 近 90 天活跃池相似召回</h2><span class="hint">特征向量：品类偏好 / 时长结构 / 付费档位 / 社交行为 / 设备与时段</span></div>',
      '  <div id="recallBody"><div class="empty">等待种子人群就绪…</div></div>',
      '</div>'
    ].join('');
    $('#gameInput').value = SAMPLE.join('\n');
    updateParseHint();
    bindStep1();
  }

  /* ---------- 玩法列表解析：支持「玩法ID,玩法名」 ---------- */
  const ID_KEYS = ['id', 'game_id', 'gameId', 'gameid', '玩法id', '玩法ID', '玩法编号'];
  const NAME_KEYS = ['name', 'game', 'game_name', 'gameName', 'title', '玩法', '玩法名', '玩法名称'];

  function clean(s) { return String(s == null ? '' : s).replace(/^[\s"']+|[\s"']+$/g, ''); }
  function looksId(s) { return /^[A-Za-z0-9_\-.:]{2,40}$/.test(s) && /[0-9A-Za-z]/.test(s); }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).slice(0, 8);
  }
  function pickField(obj, keys) {
    const lower = {};
    Object.keys(obj).forEach(function (k) { lower[k.toLowerCase()] = obj[k]; });
    for (let i = 0; i < keys.length; i++) {
      const v = obj[keys[i]] !== undefined ? obj[keys[i]] : lower[keys[i].toLowerCase()];
      if (v !== undefined && v !== null && String(v).trim()) return clean(v);
    }
    return '';
  }
  function parseLine(line) {
    const s = clean(line);
    if (!s) return null;
    const m = s.match(/^([^,，\t|]+)[,，\t|](.+)$/);
    if (m) {
      const a = clean(m[1]), b = clean(m[2]);
      if (a && b && looksId(a)) return { id: a, name: b };
      if (a && b && looksId(b)) return { id: b, name: a }; // 兼容「名称,ID」顺序
    }
    return { id: '', name: s };
  }
  function isHeader(line) {
    const m = clean(line).match(/^([^,，\t|]+)[,，\t|](.+)$/);
    if (!m) return false;
    const a = clean(m[1]).toLowerCase(), b = clean(m[2]).toLowerCase();
    return /^(game_?id|id|玩法id|玩法编号)$/.test(a) || /^(game_?name|name|玩法|玩法名|玩法名称)$/.test(b);
  }

  function parseGames(text) {
    const t = String(text || '').trim();
    if (!t) return [];
    let raw = [];
    if (t[0] === '[' || t[0] === '{') {
      try {
        const j = JSON.parse(t);
        const arr = Array.isArray(j) ? j : (j.games || j.list || j.data || []);
        raw = arr.map(function (x) {
          if (typeof x === 'string') return parseLine(x);
          if (x && typeof x === 'object') return { id: pickField(x, ID_KEYS), name: pickField(x, NAME_KEYS) };
          return null;
        }).filter(Boolean);
      } catch (e) { raw = []; }
    }
    if (!raw.length) {
      const lines = t.split(/[\r\n;；]+/).map(function (s) { return clean(s); }).filter(Boolean);
      if (lines.length && isHeader(lines[0])) lines.shift();
      raw = lines.map(parseLine).filter(Boolean);
    }
    const seen = {};
    const out = [];
    raw.forEach(function (x) {
      let id = clean(x.id), name = clean(x.name);
      if (!name && id) { name = id; id = ''; }   // 只给了 ID 时降级用 ID 当名称
      if (!name || name.length > 40) return;
      const missing = !id;
      if (missing) id = 'tmp_' + hashStr(name);
      const key = id.toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ id: id, name: name, idMissing: missing });
    });
    return out.slice(0, 8);
  }

  function updateParseHint() {
    const list = parseGames($('#gameInput').value);
    const miss = list.filter(function (x) { return x.idMissing; }).length;
    if (!list.length) {
      $('#parseHint').innerHTML = '未识别到有效玩法，请按「玩法ID,玩法名」每行一个填写';
      return list;
    }
    $('#parseHint').innerHTML =
      '已识别 <b>' + list.length + '</b> 个玩法：' +
      list.map(function (x) { return esc(x.name) + '<span class="pid">' + esc(x.id) + '</span>'; }).join('、') +
      (miss ? '<div class="warn-line">其中 ' + miss + ' 个未提供玩法ID，已按名称生成临时 ID（tmp_xxx），仅用于演示</div>' : '');
    return list;
  }

  function bindStep1() {
    const dz = $('#dropzone'), fi = $('#fileInput');
    dz.addEventListener('click', function () { fi.click(); });
    fi.addEventListener('change', function () { if (fi.files[0]) readFile(fi.files[0]); });
    ['dragover', 'dragenter'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
    });
    $('#gameInput').addEventListener('input', updateParseHint);
    $('#loadSample').addEventListener('click', function () {
      $('#gameInput').value = SAMPLE.join('\n'); updateParseHint();
    });
    $('#btnPull').addEventListener('click', pullSeeds);
  }

  function readFile(file) {
    const r = new FileReader();
    r.onload = function () {
      $('#gameInput').value = String(r.result).slice(0, 2000);
      const list = updateParseHint();
      toast('已读取 ' + file.name + '，自动开始拉取种子玩家');
      if (list.length) setTimeout(pullSeeds, 260);
    };
    r.readAsText(file, 'utf-8');
  }

  function pullSeeds() {
    if (A.running) return;
    const list = updateParseHint();
    if (!list.length) { toast('请先上传或粘贴至少 1 个玩法'); return; }
    A.running = true;
    A.matched = false; A.result = null;
    A.maxStep = A.activeReady ? 3 : 2;
    // 保证模板分散
    const used = new Set();
    A.games = list.map(function (x, i) { return Sim.makeGame(x, i, used); });
    A.core = []; A.coreTouched = false;   // 玩法列表变了，核心标记与建议需重算
    $('#seedStatus').className = 'tag run'; $('#seedStatus').textContent = '拉取中…';
    $('#seedBody').innerHTML = '<div class="seed-row">' + A.games.map(function (g) {
      return '<div class="skel" style="height:38px"></div>';
    }).join('') + '</div>';
    $('#recallBody').innerHTML = '<div class="empty">正在从近 90 天活跃池召回…</div>';

    setTimeout(function () {
      Sim.recall(A.games);            // 先完成召回，种子合计/竞品来源才有值
      $('#seedBody').innerHTML =
        '<div class="seed-item" style="background:transparent;border:none;padding:0 11px 2px">' +
        '<span class="th">玩法</span><span class="th r">灰度转化玩家</span><span class="th r">竞品近30天参与</span>' +
        '<span class="th r">种子合计</span><span class="th r">灰度转化率</span></div>' +
        A.games.map(function (g) {
          return '<div class="seed-item"><div class="nm">' + esc(g.name) +
            '<div class="sub"><span class="pid">' + esc(g.id) + '</span>' + esc(g.genre) + ' · 竞品：' + esc(g.compNames.join(' / ')) + '</div></div>' +
            '<div class="num" style="text-align:right">' + Sim.raw(g.grayConverted).toLocaleString('zh-CN') + '</div>' +
            '<div class="num" style="text-align:right">' + Sim.raw(g.seedFromComp).toLocaleString('zh-CN') + '</div>' +
            '<div class="num" style="text-align:right;color:#fff">' + Sim.raw(g.seedInternal).toLocaleString('zh-CN') + '</div>' +
            '<div class="num" style="text-align:right">' + fmtRate(g.cvr) + '</div></div>';
        }).join('');
      $('#seedStatus').className = 'tag ok'; $('#seedStatus').textContent = '已拉取 ' + A.games.length + ' 个玩法';

      const poolN = Sim.N;
      $('#recallBody').innerHTML = '<div class="recall-grid">' + A.games.map(function (g, i) {
        return '<div class="recall-item"><div class="recall-top"><span class="recall-name">' + esc(g.name) +
          '<span class="pid">' + esc(g.id) + '</span></span>' +
          '<span class="recall-val" data-count="' + g.potentialInternal + '">0</span></div>' +
          '<div class="bar"><i data-w="' + (g.potentialInternal / poolN * 100).toFixed(1) + '"></i></div>' +
          '<div class="meta-line"><span>潜在受众 / 近90天活跃池</span><span>' + fmtPct(g.potentialInternal / poolN) + '</span></div>' +
          '<div class="meta-line" style="margin-top:4px"><span>种子 ' + Sim.raw(g.seedInternal).toLocaleString('zh-CN') + ' 人</span><span>相似度阈值 0.72</span></div></div>';
      }).join('') + '</div>' +
        '<div class="note">召回逻辑：以种子玩家的品类偏好、活跃时段、付费档位等特征向量在大盘近 90 天活跃玩家中做近似最近邻召回，按相似度阈值 0.72 截断，并剔除已流失 90 天以上玩家。</div>';

      $$('#recallBody [data-count]').forEach(function (el) {
        const target = +el.getAttribute('data-count') * Sim.SCALE;
        animNum(el, target);
      });
      $$('#recallBody .bar > i').forEach(function (el, i) {
        setTimeout(function () { el.style.width = el.getAttribute('data-w') + '%'; }, 60 + i * 60);
      });

      A.seedsReady = true; A.running = false;
      A.maxStep = Math.max(A.maxStep, 2);
      $('#statusBar').textContent = '已为 ' + A.games.length + ' 个玩法完成种子拉取与相似召回';
      syncBottom();
      toast('种子玩家与潜在受众召回完成');
    }, 750);
  }

  function animNum(el, to) {
    const t0 = performance.now(), dur = 800;
    function tick(t) {
      const p = Math.max(0, Math.min(1, (t - t0) / dur));  // 防止首帧时间戳早于 t0 出现负值
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * e).toLocaleString('zh-CN');
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    setTimeout(function () { el.textContent = Math.round(to).toLocaleString('zh-CN'); }, dur + 120); // rAF 被挂起时兜底
  }

  /* ================= 步骤 2 ================= */
  function invalidatePeriod() {
    A.activeReady = false; A.matched = false; A.result = null;
    A.maxStep = Math.min(A.maxStep, 3);
    const st = $('#activeStatus'), body = $('#activeBody');
    if (st) { st.className = 'tag'; st.textContent = '待拉取'; }
    if (body) body.innerHTML = '<div class="empty">周期已变更，请重新拉取。</div>';
    syncBottom();
  }

  function renderStep2() {
    const start = addDays(new Date(), 1);
    A.start = start; A.end = addDays(start, A.days - 1);
    $('#step-2').innerHTML = [
      '<div class="step-head"><h2>选择目标宣推周期</h2>',
      '<p>用于估算周期内的日活人数与去重活跃玩家规模，后续重叠度均以「周期内至少活跃 1 次」的玩家为分母。</p></div>',
      '<div class="grid-2">',
      '  <div class="card">',
      '    <div class="card-head"><h2>2.1 宣推周期</h2><span class="hint">默认从明日开始</span></div>',
      '    <div class="chips" id="periodChips">',
      '      <button class="chip is-active" data-days="7">未来 7 天</button>',
      '      <button class="chip" data-days="14">未来 14 天</button>',
      '      <button class="chip" data-days="30">未来 30 天</button>',
      '    </div>',
      '    <div class="date-row">',
      '      <label>开始日期<input type="date" id="dateStart" /></label>',
      '      <label>结束日期<input type="date" id="dateEnd" /></label>',
      '    </div>',
      '    <button class="btn primary" id="btnActive">拉取周期内预估活跃玩家</button>',
      '    <div class="parse-hint" id="activeNote"></div>',
      '  </div>',
      '  <div class="card">',
      '    <div class="card-head"><h2>2.2 周期内预估活跃人群</h2><span class="tag" id="activeStatus">待拉取</span></div>',
      '    <div id="activeBody"><div class="empty">选择周期后拉取预估活跃玩家名单…</div></div>',
      '  </div>',
      '</div>'
    ].join('');
    $('#dateStart').value = ymd(A.start);
    $('#dateEnd').value = ymd(A.end);
    $$('#periodChips .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        $$('#periodChips .chip').forEach(function (x) { x.classList.remove('is-active'); });
        c.classList.add('is-active');
        A.days = +c.getAttribute('data-days');
        A.start = addDays(new Date(), 1);
        A.end = addDays(A.start, A.days - 1);
        $('#dateStart').value = ymd(A.start);
        $('#dateEnd').value = ymd(A.end);
        invalidatePeriod();
      });
    });
    ['#dateStart', '#dateEnd'].forEach(function (sel) {
      $(sel).addEventListener('change', function () {
        const s = new Date($('#dateStart').value), e = new Date($('#dateEnd').value);
        if (!isNaN(s) && !isNaN(e) && e >= s) {
          A.start = s; A.end = e;
          A.days = Math.max(1, Math.round((e - s) / 86400000) + 1);
          invalidatePeriod();
        }
      });
    });
    $('#btnActive').addEventListener('click', pullActive);
  }

  function pullActive() {
    $('#activeStatus').className = 'tag run'; $('#activeStatus').textContent = '拉取中…';
    $('#activeBody').innerHTML = '<div class="skel" style="height:90px;border-radius:10px"></div>';
    setTimeout(function () {
      Sim.buildActive(A.days);
      const r = Sim.S;
      const total = r.activeTotal;
      const rows = Sim.LVL_NAME.map(function (nm, i) {
        const n = r.activeByLvl[i];
        const share = n / total;
        return '<div class="kpi-mini" style="margin-bottom:8px"><div class="km"><span>' + nm +
          '</span><b>' + fmtNum(n) + ' <span class="muted" style="font-size:11px">' + fmtPct(share) + '</span></b></div></div>' +
          '<div class="bar" style="margin:-2px 0 10px"><i style="width:' + (share * 100).toFixed(1) + '%"></i></div>';
      });
      $('#activeBody').innerHTML =
        '<div class="k-label muted">目标周期预计活跃玩家（去重）</div>' +
        '<div class="big-num" id="activeBig">0</div>' +
        '<div class="muted" style="margin:2px 0 14px">' + cnDate(A.start) + ' – ' + cnDate(A.end) + ' · 共 ' + A.days + ' 天 · 大盘近 90 天活跃池 ' + Sim.raw(Sim.N).toLocaleString('zh-CN') + ' 人</div>' +
        rows.join('') +
        '<div class="note">活跃概率按玩家近 90 天活跃频次分层采样：高频 7 日活跃率 90%、中频 62%、低频 30%，周期越长去重活跃人数越多。</div>';
      animNum($('#activeBig'), total * Sim.SCALE);
      $('#activeStatus').className = 'tag ok'; $('#activeStatus').textContent = '已就绪';
      $('#activeNote').innerHTML = '口径：' + ymd(A.start) + ' 至 ' + ymd(A.end) + '，预计活跃 <b>' +
        fmtNum(total) + '</b> 人（占 90 天活跃池 ' + fmtPct(total / Sim.N) + '）';
      A.activeReady = true; A.matched = false;
      A.maxStep = Math.max(A.maxStep, 3);
      $('#statusBar').textContent = '已拉取 ' + A.days + ' 天内预估活跃玩家 ' + fmtNum(total) + ' 人';
      syncBottom();
      toast('周期活跃人群拉取完成');
    }, 700);
  }
  /* ================= 步骤 3 ================= */
  const PIPE = [
    ['计算潜在受众与周期活跃的重叠', '逐玩法求交集 |P ∩ A|，得到理想情况下的总重叠'],
    ['扣除被存量已上架玩法占据的玩家', '按主占用玩法归属，输出各存量玩法明细'],
    ['扣除同批次新玩法之间的重叠', '同批次潜在受众两两求交，去重后归属'],
    ['汇总分人群转化预估', '四类人群 × 灰度转化率系数，加权汇总']
  ];

  function renderStep3() {
    $('#step-3').innerHTML = [
      '<div class="step-head"><h2>开始重叠度匹配</h2>',
      '<p>将每个玩法的潜在受众集合与目标周期活跃集合求交，再扣除被存量玩法、同批次新玩法分流的玩家，得到三类互斥人群并做转化预估。</p></div>',
      '<div class="card">',
      '  <div class="card-head"><h2>3.1 匹配流水线</h2><span class="tag" id="matchStatus">待运行</span></div>',
      '  <div class="pipeline" id="pipeline">' + PIPE.map(function (p, i) {
        return '<div class="pipe" data-i="' + i + '"><span class="dot"></span>' +
          '<span class="pcopy"><b>' + p[0] + '</b><i>' + p[1] + '</i></span>' +
          '<span class="pstate">待运行</span></div>';
      }).join('') + '</div>',
      '  <div class="row between">',
      '    <span class="muted">' + A.games.length + ' 个玩法 × ' + fmtNum(Sim.S.activeTotal || 0) + ' 名周期活跃玩家</span>',
      '    <button class="btn primary" id="btnMatch">开始重叠度匹配</button>',
      '  </div>',
      '  <div class="console" id="console">等待运行…</div>',
      '</div>'
    ].join('');
    $('#btnMatch').addEventListener('click', runMatch);
  }

  function log(line) {
    const c = $('#console');
    if (c.textContent === '等待运行…') c.textContent = '';
    const row = document.createElement('div');
    row.innerHTML = line;
    c.appendChild(row);
    c.scrollTop = c.scrollHeight;
  }

  function runMatch() {
    if (A.running || !A.activeReady) return;
    A.running = true;
    $('#btnMatch').disabled = true;
    $('#matchStatus').className = 'tag run'; $('#matchStatus').textContent = '运行中';
    const pipes = $$('#pipeline .pipe');
    const labels = ['计算交集', '归属判定', '两两求交', '加权汇总'];
    let i = 0;
    function step() {
      if (i > 0) {
        const prev = pipes[i - 1];
        prev.className = 'pipe done';
        prev.querySelector('.pstate').textContent = '完成';
      }
      if (i >= pipes.length) return finish();
      const p = pipes[i];
      p.className = 'pipe run';
      p.querySelector('.pstate').textContent = '运行中…';
      log('[' + new Date().toLocaleTimeString('zh-CN') + '] ' + labels[i] + ' …');
      setTimeout(function () { i++; step(); }, 620);
    }
    function finish() {
      A.result = Sim.analyze(A.days, cnDate(A.start) + ' – ' + cnDate(A.end));
      log('<span class="ok">✓</span> 匹配完成：周期活跃 ' + fmtNum(A.result.activeTotal) + ' 人，' +
        '潜在受众去重 ' + fmtNum(A.result.unionPotentialActive) + ' 人');
      log('<span class="em">→</span> 已生成各玩法重叠结构与转化预估');
      $('#matchStatus').className = 'tag ok'; $('#matchStatus').textContent = '已完成';
      A.matched = true; A.running = false;
      A.maxStep = Math.max(A.maxStep, 4);
      $('#statusBar').textContent = '重叠度匹配完成，可查看结果看板';
      renderStep4();
      syncBottom();
      toast('匹配完成，正在打开结果看板');
      setTimeout(function () { goto(4); }, 420);
    }
    step();
  }

  /* ================= 步骤 4 ================= */
  function renderStep4() {
    const res = A.result;
    if (!res) return;
    const sumPot = res.games.reduce(function (a, g) { return a + g.potActive; }, 0);
    const sumConv = res.games.reduce(function (a, g) { return a + g.convTotal; }, 0);
    const kpis = [
      ['目标周期预计活跃玩家', fmtNum(res.activeTotal), '占 90 天活跃池 ' + fmtPct(res.activeTotal / Sim.N), true],
      ['新玩法潜在受众（去重）', fmtNum(res.unionPotentialActive), '占周期活跃 ' + fmtPct(res.unionPotentialActive / res.activeTotal)],
      ['各玩法潜在受众加总', fmtNum(sumPot), '含跨玩法重复标记'],
      ['被同批次多玩法共同标记', fmtNum(res.multiTagged), '占潜在受众 ' + fmtPct(res.multiTagged / Math.max(1, res.unionPotentialActive))],
      ['预计可转化新进玩家', fmtNum(sumConv), '全玩法合计 · 加权转化率 ' + fmtRate(sumConv / res.activeTotal)]
    ];

    $('#step-4').innerHTML = [
      '<div class="step-head"><h2>结果看板</h2><p>宣推周期 ' + res.periodLabel + '（' + res.days + ' 天）· ' +
      A.games.length + ' 个待上架玩法 · 重叠人群按「存量占据 &gt; 同批次重叠 &gt; 其他」优先级互斥归属，保证各人群加总等于总重叠。</p></div>',
      '<div class="kpis">' + kpis.map(function (k) {
        return '<div class="kpi ' + (k[3] ? 'hl' : '') + '"><div class="k-label">' + k[0] + '</div>' +
          '<div class="k-val">' + k[1] + '</div><div class="k-sub">' + k[2] + '</div></div>';
      }).join('') + '</div>',

      '<div id="adviceBox"></div>',

      '<div class="card">',
      '  <div class="card-head"><h2>各玩法受众重叠与转化预估</h2>',
      '    <div class="legend"><span><em style="background:var(--free)"></em>未被占据</span>' +
      '<span><em style="background:var(--live)"></em>被存量玩法占据</span>' +
      '<span><em style="background:var(--batch)"></em>同批次新玩法重叠</span></div></div>',
      '  <div class="game-list" id="gameList">' + res.games.map(renderGame).join('') + '</div>',
      '  <div class="note">展开任一玩法可查看：① 存量玩法占用明细 ② 同批次其他玩法重叠明细 ③ 分人群转化预估明细。</div>',
      '</div>',

      '<div class="grid-2">',
      '  <div class="card"><div class="card-head"><h2>同批次新玩法 × 潜在受众重叠</h2><span class="hint">数值为周期内活跃的重叠玩家数</span></div>',
      '    <div id="matrix"></div>',
      '    <div class="note">单元格下方百分比 = 该重叠人数 ÷ 行玩法在周期内的活跃潜在受众。右侧明细为去重前的原始交集，可能被多个玩法同时命中。</div></div>',
      '  <div class="card"><div class="card-head"><h2>存量玩法对新玩法受众的占用</h2><span class="hint">占新玩法受众去重总量</span></div>',
      '    <div id="existingOcc"></div>',
      '    <div class="note">占用判定：玩家当前主玩的存量玩法（按与其受众模型的匹配强度取最大者），同一玩家只归属 1 个存量玩法。</div></div>',
      '</div>',

      '<div class="card"><div class="card-head"><h2>口径与预估公式说明</h2></div>',
      '  <div class="grid-3" style="gap:12px">',
      '    <div><div class="hint" style="margin-bottom:4px">重叠度</div>',
      '      <div class="formula">总重叠 = |P ∩ A|<br />自由可触达 = 总重叠 − 存量占据 − 同批次重叠<br />占活跃比 = 人数 ÷ 周期活跃玩家</div></div>',
      '    <div><div class="hint" style="margin-bottom:4px">转化预估（r = 灰度期转化率）</div>',
      '      <div class="formula">自由可触达 × 2.0r<br />存量占据 × 0.8r<br />同批次重叠 × 0.6r<br />其他活跃玩家 × 0.2r</div></div>',
      '    <div><div class="hint" style="margin-bottom:4px">冲突归属优先级</div>',
      '      <div class="formula">1. 已被存量玩法占据<br />2. 同批次其他新玩法潜在受众<br />3. 以上皆无 → 自由可触达</div></div>',
      '  </div>',
      '  <div class="note">灰度转化率 = 灰度期间转化玩家 ÷ 灰度曝光玩家；各人群转化人数按上表系数折算后求和，总转化率 = 总转化人数 ÷ 周期活跃玩家。本页数据为演示模拟值，不代表真实业务结论。</div>',
      '</div>'
    ].join('');

    renderMatrix();
    renderExisting();
    bindGames();
    if (!A.core.length && !A.coreTouched && res.games.length) {
      // 默认把预估新进最高的玩法设为核心，便于直接给出建议
      let mi = 0;
      res.games.forEach(function (g, i) { if (g.convTotal > res.games[mi].convTotal) mi = i; });
      A.core = [mi];
    }
    refreshAdvice();
    if (A.open !== null) toggleGame(A.open, true);
  }

  /* ================= 上架建议 ================= */
  const fmtW = function (n) {
    const v = Math.round(n * Sim.SCALE);
    return v >= 10000 ? (v / 10000).toFixed(1) + ' 万' : v.toLocaleString('zh-CN');
  };

  function refreshAdvice() {
    const res = A.result, box = $('#adviceBox');
    if (!res || !box) return;
    const adv = Sim.advise(A.core, A.targetRate);
    A.advice = adv;
    box.innerHTML = adviceHTML(adv);
    bindAdvice();
  }

  function adviceHTML(adv) {
    const res = A.result, K = adv.K;
    const nameOf = function (i) { return res.games[i].name; };
    const idleName = function (i) {
      return '<b>' + esc(res.games[i].name) + '</b><span class="pid">' + esc(res.games[i].id) + '</span>';
    };

    const coreChips = res.games.map(function (g, i) {
      const on = A.core.indexOf(i) >= 0;
      return '<button class="chip' + (on ? ' is-active' : '') + '" data-core="' + i + '">' +
        (on ? '★ ' : '') + esc(g.name) + '</button>';
    }).join('');

    const rateChips = RATE_OPTS.map(function (r) {
      const on = Math.abs(A.targetRate - r) < 1e-9;
      return '<button class="chip' + (on ? ' is-active' : '') + '" data-rate="' + r + '">≥ ' + Math.round(r * 100) + '%</button>';
    }).join('');

    // 结论一：最多上架几个
    const maxN = adv.maxSet ? adv.maxSet.size : 0;
    const fullCoreRate = Math.min.apply(null, adv.fullRows
      .filter(function (r) { return adv.coreMask & (1 << r.idx); })
      .map(function (r) { return r.conv / Math.max(1, adv.solo[r.idx]); }).concat([1]));
    let capVal, capSub;
    if (!adv.coreCount) {
      capVal = K + ' 个';
      capSub = '未标记核心玩法，当前无达标约束；标记核心后可按「核心新进达标」反推上限';
    } else if (!adv.feasible) {
      capVal = '— 无解';
      capSub = '核心玩法之间互相挤占，连只上核心都达不到目标的 ' + fmtPct(adv.targetRate, 0) +
        '（最高仅 ' + fmtPct(adv.fallback ? adv.fallback.minRate : 0) + '），需错峰上架或减少核心';
    } else if (maxN >= K) {
      capVal = '全部 ' + K + ' 个';
      capSub = '全量上架时核心最低达成 ' + fmtPct(fullCoreRate) + '，仍满足目标，无需削减';
    } else {
      capVal = maxN + ' 个';
      capSub = '再增加 1 个玩法，核心「' + nameOf(adv.coreList[0]) + '」等的新进就会低于目标的 ' +
        fmtPct(adv.targetRate, 0) + '；全量 ' + K + ' 个上架时核心最低仅 ' + fmtPct(fullCoreRate);
    }

    // 结论二：推荐组合
    const best = adv.best;
    const bestRows = best.rows.slice().sort(function (a, b) {
      const ca = (adv.coreMask & (1 << a.idx)) ? 1 : 0, cb = (adv.coreMask & (1 << b.idx)) ? 1 : 0;
      if (ca !== cb) return cb - ca;
      return b.conv - a.conv;
    });
    const bestTotal = bestRows.reduce(function (a, r) { return a + r.conv; }, 0);

    let recVal, recSub;
    if (!adv.feasible) {
      recVal = '无达标组合';
      recSub = '核心玩法之间重叠过多，任何组合都无法同时让全部核心达标，见下方冲突提示';
    } else {
      recVal = best.size + ' 个玩法';
      recSub = (adv.coreCount ? '核心最低达成 ' + fmtPct(best.minRate) + ' · ' : '') +
        '组合总新进 ' + fmtW(bestTotal) +
        (adv.coreCount && adv.coreCount < best.size
          ? ' · 含 ' + adv.coreCount + ' 个核心 + ' + (best.size - adv.coreCount) + ' 个搭配' : '');
    }

    const bodyRows = bestRows.map(function (r) {
      const g = res.games[r.idx];
      const isCore = !!(adv.coreMask & (1 << r.idx));
      const rate = r.conv / Math.max(1, adv.solo[r.idx]);
      const ov = isCore ? null : adv.overlapOf(r.idx);
      return '<tr' + (isCore ? ' class="is-core"' : '') + '>' +
        '<td class="k">' + esc(g.name) + '</td>' +
        '<td class="mono">' + esc(g.id) + '</td>' +
        '<td>' + (isCore ? '<span class="tag ok">核心</span>' : '<span class="tag">' + (adv.coreCount ? '搭配' : '候选') + '</span>') + '</td>' +
        '<td class="r">' + fmtNum(g.potActive) + '</td>' +
        '<td class="r"><b>' + fmtNum(r.conv) + '</b></td>' +
        '<td class="r"' + (isCore && rate < A.targetRate - 1e-9 ? ' style="color:var(--live)"' : '') + '>' +
        fmtPct(rate) + '</td>' +
        '<td class="r">' + (isCore ? '—' : (ov > 0 ? fmtNum(ov) : '0')) + '</td></tr>';
    }).join('');

    const alts = adv.top.filter(function (t) { return !best || t.mask !== best.mask; }).slice(0, 2)
      .map(function (t) {
        const names = t.rows.slice().sort(function (a, b) { return b.conv - a.conv; })
          .map(function (r) { return res.games[r.idx].name; }).join('、');
        return '<div class="alt"><b>' + t.size + ' 个</b><span>核心最低 ' + fmtPct(t.minRate) +
          ' · 总新进 ' + fmtW(t.sum) + '</span><i>' + esc(names) + '</i></div>';
      }).join('');

    // 冲突提示
    let warn = '';
    if (!adv.feasible && adv.conflicts.length) {
      const c = adv.conflicts[0];
      warn = '<div class="adv-warn"><b>核心玩法互相挤占</b>：' + idleName(c.i) + ' 与 ' + idleName(c.j) +
        ' 的周期活跃潜在受众重叠 <b>' + fmtNum(c.overlapI) + '</b> 人，同批上架会让前者的新进降到单独上架时的 ' +
        fmtPct(c.rateI) + '（后者 ' + fmtPct(c.rateJ) + '）。建议错峰上架，或只保留一个作为核心；' +
        '下方给出的是最接近目标的方案。</div>';
    } else if (adv.coreCount && maxN < K) {
      warn = '<div class="adv-warn"><b>不宜全量铺开</b>：' + K + ' 个玩法同时上架时核心最低达成仅 ' +
        fmtPct(fullCoreRate) + '。建议按推荐组合分批上架，先保核心玩法的新进目标。</div>';
    }

    const coreTip = adv.coreCount === 0
      ? '<div class="adv-warn">未标记核心玩法：当前建议按「总新进最大」给出。点击上方玩法标签可设为核心（可多选），将改为在核心达标前提下的组合建议。</div>'
      : '';

    return [
      '<div class="card">',
      '  <div class="card-head"><h2>上架建议</h2><span class="hint">根据各玩法周期预估新进，反推最多上架数量与最优组合</span></div>',
      '  <div class="adv-row"><span class="adv-label">核心玩法</span><div class="chips" id="coreChips">' + coreChips + '</div></div>',
      '  <div class="adv-row"><span class="adv-label">达标要求</span><div class="chips" id="rateChips">' + rateChips +
      '</div><span class="hint">核心玩法周期新进 ≥ 单独上架时的该比例</span></div>',
      coreTip,
      '  <div class="adv-grid">',
      '    <div class="adv-verdict"><div class="av-label">① 最多可同时上架</div><div class="av-val">' + capVal +
      '</div><div class="av-sub">' + capSub + '</div></div>',
      '    <div class="adv-verdict hl"><div class="av-label">② 推荐上架组合</div><div class="av-val">' + recVal +
      '</div><div class="av-sub">' + recSub + '</div></div>',
      '  </div>',
      !adv.feasible ? '<div class="adv-warn" style="margin:0 0 8px">下表为<b>最接近目标</b>的方案（核心最低 ' +
        fmtPct(best.minRate) + '，未达标），可据此调整上架数量或错峰时间。</div>' : '',
      '  <div class="mini-table"><table><thead><tr><th>玩法</th><th>玩法ID</th><th>角色</th>' +
      '<th class="r">周期潜在受众</th><th class="r">预估新进</th><th class="r">相对单独上架</th>' +
      '<th class="r">与核心重叠</th></tr></thead><tbody>' + bodyRows + '</tbody></table></div>',
      alts ? '<div class="adv-alt"><span class="adv-label" style="min-width:auto">备选组合</span>' + alts + '</div>' : '',
      warn,
      '  <div class="note">算法口径：对每个候选子集，把各玩法的周期活跃潜在受众重新拆成「被存量占据 / 与本次上架的其他玩法重叠 / 自由可触达」三类，再按 2r、0.8r、0.6r、0.2r 加权求新进；' +
      '「单独上架」= 该玩法独占全部自由人群时的理论上限，作为核心达标基准。共枚举 ' +
      Math.pow(2, K) + ' 种组合（要求包含全部核心玩法）。</div>',
      '</div>'
    ].join('');
  }

  function bindAdvice() {
    const cc = $('#coreChips');
    if (cc) {
      cc.addEventListener('click', function (e) {
        const b = e.target.closest('[data-core]');
        if (!b) return;
        const i = +b.getAttribute('data-core');
        const k = A.core.indexOf(i);
        if (k >= 0) A.core.splice(k, 1); else A.core.push(i);
        A.coreTouched = true;
        refreshAdvice();
      });
    }
    const rc = $('#rateChips');
    if (rc) {
      rc.addEventListener('click', function (e) {
        const b = e.target.closest('[data-rate]');
        if (!b) return;
        A.targetRate = +b.getAttribute('data-rate');
        refreshAdvice();
      });
    }
  }

  function renderGame(g, idx) {
    const pa = Math.max(1, g.potActive);
    const pFree = g.freeN / pa * 100, pLive = g.liveN / pa * 100, pBatch = g.batchN / pa * 100;
    const liveCnt = g.liveDetail.filter(function (x) { return x > 0; }).length;
    const batchCnt = g.batchDetail.filter(function (x) { return x > 0; }).length;
    return [
      '<div class="game" data-idx="' + idx + '">',
      '  <div class="game-head">',
      '    <div class="game-title"><b>' + esc(g.name) + '</b><span><span class="pid">' + esc(g.id) + '</span>' + esc(g.genre) + ' · 灰度转化率 ' + fmtRate(g.cvr) + ' · 潜在受众 ' + fmtNum(g.potTotal) + '</span></div>',
      '    <div class="gmetric"><i>周期内潜在受众</i><b>' + fmtNum(g.potActive) + '</b></div>',
      '    <div class="gmetric"><i>占周期活跃</i><b>' + fmtPct(g.potActive / Sim.S.activeTotal) + '</b></div>',
      '    <div class="gmetric"><i>预计新进转化</i><b style="color:#b9b2ff">' + fmtNum(g.convTotal) + '</b></div>',
      '    <div class="caret">▶</div>',
      '  </div>',
      '  <div class="game-body">',
      '    <div class="stack">',
      '      <i class="s-free" style="width:' + pFree + '%"></i>',
      '      <i class="s-live" style="width:' + pLive + '%"></i>',
      '      <i class="s-batch" style="width:' + pBatch + '%"></i>',
      '    </div>',
      '    <div class="buckets">',
      '      <div class="bucket free"><div class="b-top"><span class="b-name"><em style="background:var(--free)"></em>未被占据的潜在玩家</span><span class="tag ok">自由可触达</span></div>',
      '        <div class="b-val">' + fmtNum(g.freeN) + '</div><div class="b-share">占周期活跃 ' + fmtPct(g.freeN / Sim.S.activeTotal) + ' · 占本玩法受众 ' + fmtPct(g.freeN / pa) + '</div>',
      '        <div class="b-sub">总重叠 ' + fmtNum(g.potActive) + ' 人，扣除存量分流与同批次分流后的剩余人群</div></div>',
      '      <div class="bucket live"><div class="b-top"><span class="b-name"><em style="background:var(--live)"></em>被已上架玩法占据</span><span class="tag warn">' + liveCnt + ' 个存量玩法</span></div>',
      '        <div class="b-val">' + fmtNum(g.liveN) + '</div><div class="b-share">占周期活跃 ' + fmtPct(g.liveN / Sim.S.activeTotal) + ' · 占本玩法受众 ' + fmtPct(g.liveN / pa) + '</div>',
      '        <div class="b-sub">明细见下方「存量玩法占用明细」</div></div>',
      '      <div class="bucket batch"><div class="b-top"><span class="b-name"><em style="background:var(--batch)"></em>同批次新玩法重叠</span><span class="tag run">' + batchCnt + ' 个待上架玩法</span></div>',
      '        <div class="b-val">' + fmtNum(g.batchN) + '</div><div class="b-share">占周期活跃 ' + fmtPct(g.batchN / Sim.S.activeTotal) + ' · 占本玩法受众 ' + fmtPct(g.batchN / pa) + '</div>',
      '        <div class="b-sub">明细为去重前交集，同一玩家可能与多个新玩法重叠</div></div>',
      '    </div>',
      renderLiveTable(g),
      renderBatchTable(g, idx),
      renderConvTable(g),
      '    <div class="note">总重叠 = 三类人群之和 = <b>' + fmtNum(g.potActive) + '</b> 人（占周期活跃 ' + fmtPct(g.potActive / Sim.S.activeTotal) + '）。' +
      '被存量占据的玩家优先计入存量分流，因此不再重复计入同批次重叠。</div>',
      '  </div>',
      '</div>'
    ].join('');
  }
  function renderLiveTable(g) {
    const rows = Sim.EXISTING.map(function (e, i) {
      return { name: e.name, genre: e.genre, n: g.liveDetail[i] };
    }).filter(function (r) { return r.n > 0; }).sort(function (a, b) { return b.n - a.n; });
    const total = g.liveN || 1;
    return [
      '<div class="detail-block"><h4>存量玩法占用明细 <span class="tag">互斥归属 · 合计 ' + fmtNum(g.liveN) + ' 人</span></h4>',
      '<div class="mini-table"><table><thead><tr><th>存量玩法</th><th>品类</th><th class="r">占据人数</th><th class="r">占被占据</th><th class="r">占本玩法受众</th></tr></thead><tbody>',
      rows.length ? rows.map(function (r) {
        return '<tr><td class="k">' + esc(r.name) + '</td><td>' + esc(r.genre) + '</td>' +
          '<td class="r">' + fmtNum(r.n) + '</td><td class="r">' + fmtPct(r.n / total) + '</td>' +
          '<td class="r">' + fmtPct(r.n / Math.max(1, g.potActive)) + '</td></tr>';
      }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--txt-3)">无被占据玩家</td></tr>',
      '<tr class="total"><td>汇总</td><td>' + rows.length + ' 个玩法</td><td class="r">' + fmtNum(g.liveN) + '</td><td class="r">100.0%</td><td class="r">' + fmtPct(g.liveN / Math.max(1, g.potActive)) + '</td></tr>',
      '</tbody></table></div></div>'
    ].join('');
  }

  function renderBatchTable(g, idx) {
    const others = A.result.games.map(function (o, j) {
      return { name: o.name, id: o.id, n: g.batchDetail[j], pot: o.potActive, j: j };
    }).filter(function (r) { return r.n > 0 && r.j !== idx; }).sort(function (a, b) { return b.n - a.n; });
    return [
      '<div class="detail-block"><h4>同批次其他待上架玩法重叠明细 <span class="tag">非互斥 · 去重后 ' + fmtNum(g.batchN) + ' 人</span></h4>',
      '<div class="mini-table"><table><thead><tr><th>待上架玩法</th><th>玩法ID</th><th>与本玩法潜在受众重叠</th><th class="r">重叠人数</th><th class="r">占本玩法受众</th><th class="r">占该玩法受众</th></tr></thead><tbody>',
      others.length ? others.map(function (r) {
        const w = Math.min(100, r.n / Math.max(1, g.potActive) * 100);
        return '<tr><td class="k">' + esc(r.name) + '</td><td class="mono">' + esc(r.id) + '</td>' +
          '<td><div class="bar" style="margin:0;height:5px"><i style="width:' + w + '%"></i></div></td>' +
          '<td class="r">' + fmtNum(r.n) + '</td><td class="r">' + fmtPct(r.n / Math.max(1, g.potActive)) + '</td>' +
          '<td class="r">' + fmtPct(r.n / Math.max(1, r.pot)) + '</td></tr>';
      }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--txt-3)">同批次无重叠</td></tr>',
      '</tbody></table></div>' +
      '<div class="note">同批次重叠人群按 0.6r 预估转化；若该玩家同时被存量玩法占据，则已计入存量分流，不在此重复计算。</div></div>'
    ].join('');
  }

  function renderConvTable(g) {
    return [
      '<div class="detail-block"><h4>分人群转化预估 <span class="tag">灰度转化率 r = ' + fmtRate(g.cvr) + '</span></h4>',
      '<div class="mini-table"><table><thead><tr><th>人群</th><th class="r">人数</th><th class="r">占周期活跃</th><th class="r">系数</th><th class="r">预估转化率</th><th class="r">预估转化人数</th></tr></thead><tbody>',
      g.convRows.map(function (r) {
        return '<tr><td class="k"><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:' + r.color + ';margin-right:6px"></span>' + r.name + '</td>' +
          '<td class="r">' + fmtNum(r.n) + '</td><td class="r">' + fmtPct(r.shareOfActive) + '</td>' +
          '<td class="r">' + r.mult.toFixed(1) + '×</td><td class="r">' + fmtRate(r.rate) + '</td>' +
          '<td class="r">' + fmtNum(r.conv) + '</td></tr>';
      }).join(''),
      '<tr class="total"><td>合计</td><td class="r">' + fmtNum(Sim.S.activeTotal) + '</td><td class="r">100.0%</td>' +
      '<td class="r">—</td><td class="r">' + fmtRate(g.convRate) + '</td><td class="r">' + fmtNum(g.convTotal) + '</td></tr>',
      '</tbody></table></div>',
      '<div class="note">自由可触达按 <b>2.0r</b>、被存量占据按 <b>0.8r</b>、同批次重叠按 <b>0.6r</b>、其他活跃玩家按 <b>0.2r</b> 折算；' +
      '各人群转化人数直接相加得到总转化人数，总转化率 = 总转化人数 ÷ 周期活跃玩家。</div></div>'
    ].join('');
  }

  function renderMatrix() {
    const res = A.result, gs = res.games;
    let html = '<table class="matrix"><thead><tr><th></th>' +
      gs.map(function (g) { return '<th>' + esc(g.name.length > 6 ? g.name.slice(0, 6) : g.name) + '</th>'; }).join('') + '</tr></thead><tbody>';
    gs.forEach(function (g, i) {
      html += '<tr><th class="rh">' + esc(g.name) + '</th>';
      gs.forEach(function (o, j) {
        if (i === j) { html += '<td class="self">—</td>'; return; }
        const v = res.matrix[i][j];
        const ratio = v / Math.max(1, g.potActive);
        const a = Math.min(0.6, 0.08 + ratio * 1.65);
        html += '<td style="background:rgba(91,140,255,' + a.toFixed(2) + ')"><b>' + fmtNum(v) + '</b><i>' + fmtPct(ratio) + '</i></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>' +
      '<div class="note">同批次 ' + gs.length + ' 个玩法两两重叠合计（去重前）' + fmtNum(res.matrix.reduce(function (a, row, i) {
        return a + row.reduce(function (b, v, j) { return i === j ? b : b + v; }, 0);
      }, 0) / 2) + ' 人次，其中被 2 个及以上新玩法同时标记的活跃玩家 ' + fmtNum(res.multiTagged) + ' 人。</div>';
    $('#matrix').innerHTML = html;
  }

  function renderExisting() {
    const res = A.result;
    const base = Math.max(1, res.unionPotentialActive);
    const rows = res.existingOcc.slice().sort(function (a, b) { return b.n - a.n; });
    $('#existingOcc').innerHTML =
      '<div class="kpi-mini" style="margin-bottom:12px"><div class="km"><span>新玩法潜在受众（周期内活跃 · 去重）</span><b>' + fmtNum(base) + '</b></div></div>' +
      rows.map(function (r) {
        return '<div class="occ-row"><span class="nm">' + esc(r.name) + '</span>' +
          '<span class="track"><i style="width:' + Math.min(100, r.n / base * 100).toFixed(1) + '%"></i></span>' +
          '<span class="v">' + fmtNum(r.n) + '</span><span class="p">' + fmtPct(r.n / base) + '</span></div>';
      }).join('') +
      '<div class="occ-row" style="margin-top:4px"><span class="nm" style="color:var(--free)">无存量占用</span>' +
      '<span class="track"><i style="width:' + Math.min(100, (base - rows.reduce(function (a, r) { return a + r.n; }, 0)) / base * 100).toFixed(1) + '%;background:linear-gradient(90deg,#2fbf83,var(--free))"></i></span>' +
      '<span class="v">' + fmtNum(base - rows.reduce(function (a, r) { return a + r.n; }, 0)) + '</span>' +
      '<span class="p">' + fmtPct((base - rows.reduce(function (a, r) { return a + r.n; }, 0)) / base) + '</span></div>';
  }

  function bindGames() {
    $$('#gameList .game-head').forEach(function (h) {
      h.addEventListener('click', function () {
        const box = h.parentNode;
        const idx = +box.getAttribute('data-idx');
        toggleGame(idx, !box.classList.contains('open'));
      });
    });
    const head = $('#step-4 .step-head');
    const btn = document.createElement('button');
    btn.className = 'btn ghost sm';
    btn.textContent = '导出分析结果 CSV';
    btn.style.marginTop = '10px';
    btn.addEventListener('click', exportCSV);
    head.appendChild(btn);
  }

  function toggleGame(idx, open) {
    $$('#gameList .game').forEach(function (el) {
      const on = +el.getAttribute('data-idx') === idx && open;
      el.classList.toggle('open', on);
      if (on) A.open = idx;
    });
  }

  function exportCSV() {
    const res = A.result;
    if (!res) return;
    const lines = [];
    const cell = function (v) {
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const row = function (arr) { return arr.map(cell).join(','); };
    lines.push(row(['玩法ID', '玩法', '品类', '灰度曝光玩家', '灰度转化玩家', '灰度转化率',
      '潜在受众', '周期内活跃潜在受众', '占周期活跃', '未被占据', '未被占据占活跃',
      '被存量占据', '被存量占据占活跃', '同批次重叠', '同批次重叠占活跃',
      '预估转化人数', '总转化率']));
    res.games.forEach(function (g) {
      const at = Math.max(1, Sim.S.activeTotal);
      lines.push(row([g.id, g.name, g.genre, Sim.raw(g.grayEval), Sim.raw(g.grayConverted), (g.cvr * 100).toFixed(2) + '%',
        Sim.raw(g.potTotal), Sim.raw(g.potActive), (g.potActive / at * 100).toFixed(2) + '%',
        Sim.raw(g.freeN), (g.freeN / at * 100).toFixed(2) + '%',
        Sim.raw(g.liveN), (g.liveN / at * 100).toFixed(2) + '%',
        Sim.raw(g.batchN), (g.batchN / at * 100).toFixed(2) + '%',
        Sim.raw(g.convTotal), (g.convRate * 100).toFixed(2) + '%']));
    });
    lines.push('');
    lines.push(row(['周期', res.periodLabel + '（' + res.days + '天）']));
    lines.push(row(['周期活跃玩家', Sim.raw(res.activeTotal)]));
    lines.push(row(['潜在受众去重', Sim.raw(res.unionPotentialActive)]));
    lines.push(row(['被多玩法共同标记', Sim.raw(res.multiTagged)]));
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '新玩法受众重叠分析_' + ymd(new Date()) + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    toast('已导出 CSV');
  }

  /* ================= 初始化 ================= */
  function init() {
    renderNav();
    renderStep1();
    renderStep2();
    renderStep3();
    $('#stepNav').addEventListener('click', function (e) {
      const b = e.target.closest('.step-item');
      if (b) goto(+b.getAttribute('data-goto'));
    });
    $('#btnNext').addEventListener('click', function () {
      if (A.step < 4) goto(A.step + 1);
    });
    $('#btnPrev').addEventListener('click', function () {
      if (A.step > 1) goto(A.step - 1);
    });
    $('#btnReset').addEventListener('click', function () { location.reload(); });
    syncBottom();
    $('#statusBar').textContent = '示例玩法已预填，点击「拉取种子玩家并召回」开始';
  }

  init();


})();
