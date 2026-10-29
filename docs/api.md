# 新玩法受众重叠分析台 · 后端 API 规格

> 版本：v1.1（玩法列表携带 `game_id`，全链路主键化）
> 对应前端：`index.html` + `js/app.js` + `js/sim.js`（当前为离线模拟实现）
> 变更要点：新增 I0 主数据批量查询；I1 由「名称模糊匹配」改为「列表校验」；I8/I9 入参出参统一使用 `game_id`，且结果必须保序。

---

## 1. 调用链

```text
① 上传列表(CSV/TXT/JSON) → 前端 parseGames()
② POST /games:batch-get          I0  取官方名称/品类/状态
③ POST /game-list:validate       I1  校验（缺失/不存在/重复/非待上架）
④ GET  /games/{id}/gray-summary  I2  ┐ 种子来源 1
   GET  /games/{id}/competitors  I3  ┘ 种子来源 2
⑤ POST /seeds:merge              I4  双源去重 → seed_bitmap
⑥ POST /recall                   I5  90 天池相似召回 → pot_bitmap
⑦ GET  /active-forecast          I6  周期预估活跃（全部分母）
⑧ GET  /occupancy                I7  存量玩法互斥归属
⑨ POST /overlap-jobs             I8  异步重叠计算
   GET  /jobs/{job_id}                 轮询进度
⑩ GET  /analysis/{job_id}/result I9  唯一结果源
   GET  /analysis/{job_id}/export I10 CSV 导出
```

I2、I3 可并行；多玩法时 I2/I3/I5 按 `game_id` 批量或并发调用。

---

## 2. 全局约定

| 项 | 要求 |
|---|---|
| 主键 | 全链路只用 `game_id`（字符串，≤40 字符）；`game_name` 仅用于展示，以 I0 主数据为准 |
| 命名 | JSON 字段一律 `snake_case`；时间用 `YYYY-MM-DD`，时间戳用 RFC3339+08:00 |
| 快照 | I2/I3/I5/I6/I7 必须共用同一 `snapshot_id`（建议 `YYYYMMDD`），I8 入参回传同一值，服务端强校验不一致即报错 |
| 人群载体 | 默认传 Roaring Bitmap 引用 `bm://...`，不传玩家 ID 名单；<50 万人可另开抽样接口 |
| 数量上限 | 单批玩法 ≤ **8** 个（与前端截断一致），超限返回 `TOO_MANY_GAMES` |
| 去重 | 后端按 `game_id` 去重（大小写不敏感），重复返回 `DUPLICATE_GAME_ID` |
| 临时 ID | 前端在缺 ID 时生成的 `tmp_xxxxxxxx` **禁止**进入任何下游接口，I1 必须拒绝空 ID |
| 互斥不变量 | 同一玩家在 `free / live / batch` 三类中只归属一类，且 `free_n + live_n + batch_n = pot_active` |
| `cvr` 口径 | 分子分母均为**去重人头**（`converted_users / exposed_users`），不是人次 |
| 幂等 | I4/I5/I8 需支持幂等键 `request_id`，重放返回同一结果 |

---

## 3. 上传文件契约（前端已实现，后端需对齐）

```csv
game_id,game_name
ng_100231,幻境迷宫
ng_100232,末日方舟
```

前端解析规则（`js/app.js` → `parseGames()`）：

| 规则 | 说明 |
|---|---|
| 分隔符 | `,` `，` `\t` `\|` 任一 |
| 表头 | 首行首列匹配 `game_id/id/玩法id/玩法编号`，或次列匹配 `game_name/name/玩法名` 时自动跳过 |
| 引号 | 字段首尾 `"` `'` 自动清理 |
| 顺序容错 | `名称,ID` 会被自动纠正（次列形如 ID 时交换） |
| 字段键名 | JSON 支持 `id / game_id / gameId / gameid / 玩法id / 玩法ID / 玩法编号` + `name / game_name / gameName / title / 玩法 / 玩法名 / 玩法名称` |
| ID 形态 | `^[A-Za-z0-9_\-.:]{2,40}$` 且至少含一个字母或数字 |
| 去重 | 按 `game_id` 去重，保留首条 |
| 上限 | 8 条，超出截断（后端仍需返回 `TOO_MANY_GAMES`） |
| 缺 ID | 生成 `tmp_` + 名称哈希前 8 位，UI 显示黄色告警，**不可提交后端** |

---

## 4. 错误码总表

| HTTP | code | 含义 | 前端处理 |
|---|---|---|---|
| 400 | `GAME_ID_REQUIRED` | 未提供玩法 ID | 阻断，标红该行 |
| 404 | `GAME_ID_NOT_FOUND` | ID 不存在 | 阻断，标红该行 |
| 409 | `DUPLICATE_GAME_ID` | 同批重复 ID | 自动去重 + toast |
| 409 | `GAME_ALREADY_ONLINE` | 玩法已上线，不适用本工具 | 阻断（可由配置降为 warning） |
| 422 | `NOT_BATCH_CANDIDATE` | 不在本批次名单 | 警告，允许继续 |
| 200 | `NAME_MISMATCH` | 名称与主数据不一致 | 警告，按主数据静默更正 |
| 422 | `TOO_MANY_GAMES` | 超过 8 个 | 阻断 |
| 409 | `SNAPSHOT_MISMATCH` | 快照不一致 | 阻断，提示刷新快照 |
| 422 | `INVARIANT_BROKEN` | 三类人群之和 ≠ 总重叠 | 阻断，服务端告警 |
| 404 | `JOB_NOT_FOUND` | 任务不存在/已过期 | 回到匹配步骤 |
| 500 | `BITMAP_UNAVAILABLE` | 位图引用失效 | 重试 / 重新召回 |

统一错误响应体：

```json
{ "code": "GAME_ID_NOT_FOUND", "message": "玩法ID不存在",
  "details": [{ "row_no": 2, "game_id": "ng_9999" }], "trace_id": "..." }
```

---

## 5. 接口定义

### I0 玩法主数据批量查询

`POST /api/v1/games:batch-get`

```json
// 入参
{
  "game_ids": ["ng_100231", "ng_100232"],
  "fields": ["game_name", "genre", "status", "launch_plan_date"]
}
```

```json
// 出参
{
  "games": [
    {
      "game_id": "ng_100231",
      "game_name": "幻境迷宫",
      "genre": "派对竞技",
      "sub_genre": "休闲竞速",
      "status": "pre_launch",
      "launch_plan_date": "2026-11-20",
      "is_batch_candidate": true,
      "icon_url": "https://cdn.example.com/icon/ng_100231.png"
    }
  ],
  "missing": ["ng_999999"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `status` | enum | 是 | `pre_launch` / `gray` / `online` / `offline`；仅 `pre_launch`、`gray` 可通过 I1 |
| `genre` | string | 是 | 前端「品类」列、卡片副标题 |
| `is_batch_candidate` | bool | 否 | 是否属当前同批次，用于 I1 警告 |

---

### I1 上传列表校验

`POST /api/v1/game-list:validate`

```json
// 入参
{
  "items": [
    { "row_no": 1, "game_id": "ng_100231", "game_name": "幻境迷宫" },
    { "row_no": 2, "game_id": "",          "game_name": "无ID玩法" }
  ],
  "max_games": 8,
  "require_pre_launch": true,
  "match_name": true
}
```

```json
// 出参
{
  "can_proceed": false,
  "valid_count": 1,
  "valid": [
    { "row_no": 1, "game_id": "ng_100231", "game_name": "幻境迷宫",
      "genre": "派对竞技", "status": "pre_launch" }
  ],
  "invalid": [
    { "row_no": 2, "game_id": "", "game_name": "无ID玩法",
      "code": "GAME_ID_REQUIRED", "message": "缺少玩法ID，无法定位玩法" }
  ],
  "warnings": [
    { "row_no": 1, "code": "NAME_MISMATCH", "message": "名称与主数据不一致，已更正",
      "input_name": "幻境迷宫(旧)", "official_name": "幻境迷宫" }
  ],
  "normalized": [
    { "game_id": "ng_100231", "game_name": "幻境迷宫", "genre": "派对竞技" }
  ]
}
```

- `normalized` 顺序 = 入参 `row_no` 顺序，前端据此覆盖 `A.games`。
- `can_proceed=false` 时前端必须阻断「拉取种子玩家」。
- `valid_count` 为去重后的有效玩法数。

---

### I2 单玩法灰度复盘（种子来源 1）

`GET /api/v1/games/{game_id}/gray-summary?gray_start=&gray_end=&snapshot_id=`

```json
{
  "game_id": "ng_100231",
  "game_name": "幻境迷宫",
  "genre": "派对竞技",
  "gray_start": "2026-09-20",
  "gray_end": "2026-10-20",
  "exposed_users": 128400,
  "converted_users": 14260,
  "cvr": 0.1111,
  "converted_bitmap_ref": "bm://gray/conv/ng_100231@20261020",
  "cvr_confidence": 0.93,
  "by_level": [
    { "level": "high", "exposed": 32000, "converted": 5100, "cvr": 0.1594 }
  ],
  "data_version": "v3"
}
```

对应 UI：种子表「灰度转化玩家」「灰度转化率」，以及全部转化预估的 `r`。

---

### I3 竞品玩法与近 30 天参与（种子来源 2）

`GET /api/v1/games/{game_id}/competitors?window_days=30&snapshot_id=`

```json
{
  "game_id": "ng_100231",
  "competitors": [
    { "game_id": "ng_20001", "game_name": "江湖剑影", "genre": "MMORPG",
      "relation": "same_genre", "similarity": 0.81,
      "participants_30d": 402100,
      "participants_bitmap_ref": "bm://play/ng_20001/30d@20261020" }
  ],
  "competitor_union_users": 651300
}
```

对应 UI：种子表「竞品：江湖剑影 / 王城争霸」「竞品近30天参与」。

---

### I4 种子合并去重

`POST /api/v1/seeds:merge`

```json
// 入参
{
  "game_id": "ng_100231",
  "gray_conv_ref": "bm://gray/conv/ng_100231@20261020",
  "competitor_refs": ["bm://play/ng_20001/30d@20261020"],
  "dedup": true,
  "sample_limit": 5000,
  "request_id": "seed-ng_100231-20261020"
}
```

```json
// 出参
{
  "game_id": "ng_100231",
  "seed_total": 72340,
  "from_gray_n": 14260,
  "from_competitor_n": 62300,
  "overlap_n": 4220,
  "seed_bitmap_ref": "bm://seed/ng_100231@20261020",
  "seed_sample": ["uid_1", "uid_2"],
  "profile": {
    "top_genres": ["派对竞技", "MMORPG"],
    "avg_play_minutes": 46,
    "pay_rate": 0.031,
    "active_hours": "20-24"
  }
}
```

对应 UI：种子表「种子合计」、召回卡「种子 N 人」。需满足 `from_gray_n + from_competitor_n - overlap_n = seed_total`。

---

### I5 潜在受众召回

`POST /api/v1/recall`（量大走异步，返回 `job_id` 轮询 I8 同款任务结构）

```json
// 入参
{
  "game_id": "ng_100231",
  "seed_bitmap_ref": "bm://seed/ng_100231@20261020",
  "pool": "active_90d",
  "snapshot_id": "20261020",
  "threshold": 0.72,
  "top_k": 0,
  "model": "user_vec_v5",
  "exclude_churned_days": 90
}
```

```json
// 出参
{
  "game_id": "ng_100231",
  "pot_total": 1562000,
  "pot_bitmap_ref": "bm://pot/ng_100231@20261020",
  "threshold": 0.72,
  "pool_90d_n": 5240000,
  "score_hist": [{ "bucket": "0.9-1.0", "n": 210000 }],
  "recall_by_source": [
    { "source": "gray", "pot_n": 320000 },
    { "source": "competitor", "pot_n": 1242000 }
  ],
  "model_version": "user_vec_v5",
  "cost_ms": 1840
}
```

对应 UI：召回卡「潜在受众 / 近 90 天活跃池」「相似度阈值 0.72」。`threshold` 由后端下发，前端不再写死。

---

### I6 目标周期预估活跃

`GET /api/v1/active-forecast?start_date=&end_date=&snapshot_id=`

```json
{
  "start_date": "2026-10-30",
  "end_date": "2026-11-05",
  "days": 7,
  "active_total": 2673060,
  "active_bitmap_ref": "bm://active/20261030_20261105",
  "pool_90d_n": 5240000,
  "by_level": [
    { "level": "high", "label": "高频活跃", "n": 402000,  "share": 0.1504, "active_prob": 0.90 },
    { "level": "mid",  "label": "中频活跃", "n": 1020000, "share": 0.3816, "active_prob": 0.62 },
    { "level": "low",  "label": "低频活跃", "n": 1251060, "share": 0.4680, "active_prob": 0.30 }
  ],
  "daily": [{ "dt": "2026-10-30", "dau": 1420000 }],
  "model_version": "dau_forecast_v7",
  "updated_at": "2026-10-29T03:00:00+08:00"
}
```

对应 UI：步骤 2 大数字与三层活跃结构；`active_total` 是步骤 4 所有占比的分母。`Σ by_level[].n` 必须等于 `active_total`。

---

### I7 存量玩法占用归属

`GET /api/v1/occupancy?game_ids=ng_100231,ng_100232&snapshot_id=`

```json
{
  "existing_games": [
    { "game_id": "ng_20001", "game_name": "江湖剑影", "genre": "MMORPG",
      "occupied_bitmap_ref": "bm://occ/ng_20001@20261020" }
  ],
  "assignment_rule": "primary_game_by_playtime_desc_then_pay_desc",
  "player_assignment_ref": "bm://occ/assign@20261020",
  "summary_in_pot_union": [
    { "game_id": "ng_20001", "game_name": "江湖剑影", "n": 486000, "share": 0.2457 }
  ]
}
```

关键约束：**一名玩家只能归属 1 个存量玩法**（`player_assignment_ref` 必须是一对一映射），否则三类人群无法互斥。

---

### I8 重叠度计算任务

`POST /api/v1/overlap-jobs`

```json
// 入参
{
  "snapshot_id": "20261020",
  "period": { "start": "2026-10-30", "end": "2026-11-05", "days": 7 },
  "active_ref": "bm://active/20261030_20261105",
  "active_total": 2673060,
  "game_ids": ["ng_100231", "ng_100232", "ng_100233", "ng_100234"],
  "games": [
    { "game_id": "ng_100231", "pot_ref": "bm://pot/ng_100231@20261020", "cvr": 0.1111 }
  ],
  "existing_refs": ["bm://occ/ng_20001@20261020"],
  "assignment_ref": "bm://occ/assign@20261020",
  "attribution": "priority_live_gt_batch_gt_free",
  "conv_multipliers": { "free": 2.0, "live": 0.8, "batch": 0.6, "other": 0.2 },
  "request_id": "overlap-20261020-001"
}
```

```json
// 出参
{ "job_id": "job_20261029_0001", "status": "queued", "result_ready": false }
```

`GET /api/v1/jobs/{job_id}`

```json
{
  "job_id": "job_20261029_0001",
  "status": "running",
  "progress": 0.55,
  "stages": [
    { "key": "intersect", "name": "计算潜在受众与周期活跃的重叠", "status": "done",    "cost_ms": 780 },
    { "key": "occupancy", "name": "扣除被存量已上架玩法占据的玩家", "status": "running" },
    { "key": "batch",     "name": "扣除同批次新玩法之间的重叠",   "status": "pending" },
    { "key": "forecast",  "name": "汇总分人群转化预估",           "status": "pending" }
  ],
  "logs": [{ "ts": "2026-10-29T10:01:02+08:00", "level": "info", "msg": "intersect done, 4 games" }],
  "result_ready": false,
  "result_ref": null
}
```

`stages[].key` 必须与前端流水线四阶段一致：`intersect → occupancy → batch → forecast`。

---

### I9 分析结果（前端唯一数据源）

`GET /api/v1/analysis/{job_id}/result`

```json
{
  "job_id": "job_20261029_0001",
  "snapshot_id": "20261020",
  "period": { "start": "2026-10-30", "end": "2026-11-05", "days": 7,
              "label": "10月30日 – 11月5日" },
  "active_total": 2673060,
  "pool_90d_n": 5240000,
  "union_potential_active": 1979280,
  "multi_tagged_n": 893740,
  "other_active_n": 693780,
  "existing_occ": [
    { "game_id": "ng_20001", "game_name": "江湖剑影", "genre": "MMORPG",
      "n": 486000, "share": 0.2457 }
  ],
  "games": [
    {
      "game_id": "ng_100231",
      "game_name": "幻境迷宫",
      "genre": "派对竞技",
      "cvr": 0.1111,
      "pot_total": 1562000,
      "pot_active": 663040,
      "pot_active_share": 0.2480,
      "free_n": 147800,  "free_share_of_active": 0.0553,
      "live_n": 346300,  "live_share_of_active": 0.1295,
      "batch_n": 168940, "batch_share_of_active": 0.0632,
      "live_detail": [
        { "game_id": "ng_20001", "game_name": "江湖剑影", "genre": "MMORPG",
          "n": 210400, "share_of_live": 0.6076, "share_of_pot": 0.3173 }
      ],
      "batch_detail": [
        { "game_id": "ng_100232", "game_name": "末日方舟",
          "n": 96400, "share_of_pot": 0.1454, "share_of_other_pot": 0.1394 }
      ],
      "conv_rows": [
        { "key": "free",  "name": "未被其他玩法占据",    "n": 147800, "mult": 2.0, "rate": 0.2222, "conv": 32844, "share_of_active": 0.0553 },
        { "key": "live",  "name": "被已上架玩法占据",    "n": 346300, "mult": 0.8, "rate": 0.0889, "conv": 30786, "share_of_active": 0.1295 },
        { "key": "batch", "name": "与同批次新玩法重叠",  "n": 168940, "mult": 0.6, "rate": 0.0667, "conv": 11262, "share_of_active": 0.0632 },
        { "key": "other", "name": "其他活跃玩家（长尾）", "n": 693780, "mult": 0.2, "rate": 0.0222, "conv": 15418, "share_of_active": 0.2595 }
      ],
      "conv_total": 90310,
      "conv_rate": 0.0338
    }
  ],
  "matrix": [[0, 96400, 51200, 0]],
  "matrix_games": ["ng_100231", "ng_100232", "ng_100233", "ng_100234"],
  "formula_version": "conv_v1",
  "computed_at": "2026-10-29T10:02:00+08:00"
}
```

**两条硬约束**

1. `games[]` 顺序 **必须等于** I8 入参 `game_ids[]` 顺序；`matrix[i][j]` 与 `matrix_games[]` 同序。前端按下标渲染卡片、矩阵行列与 `batch_detail` 索引，乱序会导致明细错位。
2. `games[]` 每项必须回传 `game_id`（CSV 导出与明细表「玩法ID」列直接取此值），不得只给名称。

**内部勾稽关系**

| 关系 | 校验 |
|---|---|
| `Σ games[].pot_active_share` 的去重值为 `union_potential_active` | 允许 `union < Σ`（存在跨玩法重复） |
| `free_n + live_n + batch_n = pot_active` | 强校验，违反即 `INVARIANT_BROKEN` |
| `Σ live_detail[].n = live_n`，`Σ batch_detail[].n` 去重后 = `batch_n` | 强校验 |
| `Σ conv_rows[].conv = conv_total`，`conv_total / active_total = conv_rate` | 强校验 |
| `other_active_n = active_total − union_potential_active` | 强校验 |

---

### I10 CSV 导出

`GET /api/v1/analysis/{job_id}/export?format=csv&scope=summary|detail|all`

列顺序必须与前端一致：

```text
玩法ID,玩法,品类,灰度曝光玩家,灰度转化玩家,灰度转化率,潜在受众,周期内活跃潜在受众,占周期活跃,
未被占据,未被占据占活跃,被存量占据,被存量占据占活跃,同批次重叠,同批次重叠占活跃,预估转化人数,总转化率
```

底部追加汇总行：`周期`、`周期活跃玩家`、`潜在受众去重`、`被多玩法共同标记`。文件带 UTF-8 BOM（Excel 中文兼容）。

---

### I11 转化预估（可选）

`POST /api/v1/conversion-forecast`：入参 `{ "active_total": ..., "rows": [{ "key": "free", "n": ..., "mult": 2.0, "cvr": 0.1111 }] }`，出参同 `conv_rows`。建议前端计算，方便调参演示。

---

### I12 元数据（可选）

`GET /api/v1/meta`

```json
{
  "genre_dict": ["派对竞技", "MMORPG", "开放世界RPG"],
  "level_dict": [{ "level": "high", "label": "高频活跃" }],
  "status_dict": ["pre_launch", "gray", "online", "offline"],
  "conv_multipliers": { "free": 2.0, "live": 0.8, "batch": 0.6, "other": 0.2 },
  "similarity_threshold": 0.72,
  "max_games": 8,
  "formula_version": "conv_v1",
  "snapshot_id": "20261020"
}
```

---

## 6. 前端字段映射

| 前端位置 | 来源字段 |
|---|---|
| 输入框 ID 徽标 | I1 `normalized[].game_id` |
| 种子表：玩法名 / 品类 | I1 / I0 `game_name`、`genre` |
| 种子表：灰度转化玩家 / 转化率 | I2 `converted_users`、`cvr` |
| 种子表：竞品近 30 天参与 | I3 `competitor_union_users` |
| 种子表：种子合计 | I4 `seed_total` |
| 召回卡：潜在受众 | I5 `pot_total` |
| 召回卡：占近 90 天活跃池 | I5 `pot_total / pool_90d_n` |
| 步骤 2：周期活跃 | I6 `active_total` |
| 步骤 2：三层结构 | I6 `by_level[]` |
| 步骤 4：KPI 与分母 | I9 `active_total` |
| 卡片：周期内潜在受众 | I9 `pot_active` |
| 卡片：三色堆叠条 | I9 `free_n / live_n / batch_n` |
| 卡片（展开①） | I9 `live_detail[]` |
| 卡片（展开②） | I9 `batch_detail[]` |
| 卡片（转化表） | I9 `conv_rows[]` |
| 热力矩阵 | I9 `matrix[][]` + `matrix_games[]` |
| 存量占用分布 | I9 `existing_occ[]` |
| CSV 导出 | I10 |

---

## 7. 验收断言（联调必测）

1. 上传含不存在 ID：`can_proceed=false`，`invalid[].code=GAME_ID_NOT_FOUND`，前端阻断拉取。
2. 上传 `名称,ID` 反序与首行表头：I1 收到的 `items[]` 已正确归一，`row_no` 连续。
3. 重复 ID 两行：只返回 1 条 `valid`，另 1 条 `DUPLICATE_GAME_ID`。
4. 结果勾稽：对每个玩法 `free_n + live_n + batch_n === pot_active`。
5. 顺序一致：打乱 `game_ids[]` 后再请求，`games[].game_id` 顺序随请求变化，明细不错位。
6. 快照不一致：I8 回传旧 `snapshot_id` 返回 `SNAPSHOT_MISMATCH`，任务不启动。

---

## 8. 从 demo 切后端的最小改造

| 文件/函数 | 改造内容 |
|---|---|
| `js/app.js` → `pullSeeds()` | 调用前插入 I1；`can_proceed=false` 时按 `row_no` 高亮并阻断；通过后用 `normalized` 覆盖 `A.games` |
| `js/sim.js` → `makeGame()` | 改为直接接收 I1/I0 返回对象，`id/name/genre` 不再哈希推导 |
| `js/sim.js` → `recall()` / `buildActive()` / `analyze()` | 分别替换为 I4+I5 / I6 / I8 轮询 + I9 |
| `js/app.js` → `Sim.raw()/Sim.fmt()` | 去掉 ×20 展示外扩 |
| `js/app.js` → 写死常量 | `L7` 活跃概率、`0.72` 阈值、`2/0.8/0.6/0.2` 系数改由 I12 / I6 / I8 下发 |
| 新增 `js/api.js` | 统一封装 fetch、错误码映射、任务轮询，mock 与真实环境一个开关切换 |
