# 猫导 × jianjicode 制作链路契约（v0.3）

状态：**猫导侧 `plan` + `tts` 已实现，未部署**（分支 `feat/production-plan`，
测试 34/34）；**jianjicode 侧 `maodao_plan` + `maodao_tts` + `maodao-production` skill
已写，本机缺 bun/node_modules 未跑 typecheck/test**。v0.3 按实现回填了音色形状、
配额计数与并发细节。
目标链路：`选题 → 脚本/分镜 → 配音 → 字幕 → 粗剪 → 发布包`。

## 0. 边界

`/api/generate` 是用户端点：要登录、走会员/猫粮、返回七字段文案，`shots` 只是段落级分镜，
不是可编排的镜头表。制作链路不复用它。

`services/script.py` 是现成的分场剧本服务，输出 `scenes[{no,shot,visual,line,seconds}]`，
正好是镜头表的原料。制作 API 只做适配和归一化，**提示词仍然只有猫导一份**。

两个关键事实：

- **`script.generate()` 走 DeepSeek**（`DEEPSEEK_COPY_MODEL`），不是 DashScope。
  所以 `plan` 现在就能开发、能联调，**不受百炼欠费影响**。
- **TTS 走 DashScope**。百炼欠费期间 `tts` 端点会失败；声音克隆/合成恢复要等充值，
  与 `plan` 的进度解耦。

## 1. 鉴权、配额与计费

- 新令牌 `PRODUCTION_API_TOKEN`，请求头 `X-Prod-Token`；**不复用 `X-KB-Token`**。
- `PRODUCTION_API_TOKEN` 或 `PRODUCTION_API_USER_ID` 任一为空 → 端点关闭（503）。
  令牌用 `hmac.compare_digest` 比较，不接受 query 参数。
- 请求落在 `PRODUCTION_API_USER_ID` 服务账号上。**token 即授权**：适配层不调
  `membership.deny_body()`，这是刻意绕开会员闸；用量照样记到服务账号。
- 服务账号必须是真实、启用的用户 id；启动时解析不到 → 端点保持 503，并在日志里说清。
- 每日配额（本地时区零点起算）：
  - `PRODUCTION_DAILY_PLANS=50`
  - `PRODUCTION_DAILY_TTS_SEGMENTS=500`
- 配额计数直接用现成的 `usage_logs`，**不建新表**：
  - 每次 `plan`：先 `db.count_usage(uid, "production_plan", day_start)`，成功后
    `db.record_usage(uid, "production_plan", 0)`；DeepSeek 的真实 token 另记
    `db.add_usage(uid, "script", used)`。
  - TTS：每个 segment 记一行 `db.record_usage(uid, "production_tts", 0)`，
    配额用 `count_usage` 数行数。
  - `record_usage` 在 `tokens=0` 时**照样落行**；这里必须用它，不能用 `add_usage`
    （后者 0 值直接 return，额度会静默失效）。
- 并发：单 worker + `asyncio.to_thread`，进程内 `threading.BoundedSemaphore(4)` 保护 plan；
  第 5 个并发立即 429 `busy`，不排队到天荒地老。
  （用线程信号量而不是 `asyncio.Semaphore`：生产只有一个事件循环，但测试里每个
  `asyncio.run()` 都是新循环，asyncio 信号量会绑在第一个循环上。）
- 请求体上限 16 KB（`PRODUCTION_MAX_BODY_BYTES`）；只接受 `application/json`。

## 2. `POST /api/production/plan`

### 2.1 请求

```json
{
  "request_id": "8f2c1e0a-7d4b-4f3a-9c11-2b6e5d0a1f33",
  "topic": "健身房新店开业，想让人来体验",
  "product": "9.9 元私教体验课",
  "platform": "抖音",
  "duration": 40,
  "scenes": 4,
  "style": "剧情",
  "audience": "25-40 岁上班族",
  "must_include": ["门店地址", "9.9 体验"],
  "avoid": ["夸大疗效", "承诺减重斤数"]
}
```

| 字段 | 必填 | 规则 |
|---|---|---|
| `request_id` | 否 | ≤64 字符；同 id 10 分钟内返回同一结果（幂等） |
| `topic` | 是 | 1–200 字 |
| `product` | 是 | 1–100 字 |
| `platform` | 否 | 默认「抖音」，≤20 字 |
| `duration` | 否 | 15–120 秒，默认 40；必须满足 `3*scenes ≤ duration ≤ 30*scenes` |
| `scenes` | 否 | **2–8**，默认 4（与 `script.MIN/MAX/DEFAULT_SCENES` 一致） |
| `style` | 否 | v1 **只支持「剧情」**；传「口播」→ 400 `unsupported_style`，不静默降级 |
| `audience` | 否 | ≤100 字；映射到 `targetCustomer` |
| `must_include` | 否 | ≤5 条，每条 ≤50 字；拼进 `styleNotes` |
| `avoid` | 否 | ≤5 条，每条 ≤50 字；拼进 `styleNotes` |

口播形态（`/api/generate` 的七字段）是 P1，不在 v1 的 `plan` 里假装支持。

### 2.2 响应（200）

```json
{
  "ok": true,
  "version": "prod-plan-v1",
  "trace_id": "a1b2c3d4e5f6",
  "request_id": "8f2c1e0a-7d4b-4f3a-9c11-2b6e5d0a1f33",
  "title": "开业第一天，我只让 20 个人进门",
  "logline": "新店老板用一场限流体验课，把路过的人变成进门的人",
  "analysis": "借「反常识限流」的势，戳上班族怕被推销的心",
  "hook": "开业第一天，我只让 20 个人进门。",
  "duration": 40,
  "platform": "抖音",
  "aspect": "9:16",
  "shots": [
    {
      "no": 1,
      "seconds": 10,
      "shot_size": "近景",
      "visual": "教练站在店门口，背后是还没开门的健身房，镜头缓慢推近",
      "voiceover": "开业第一天，我只让 20 个人进门。",
      "caption": "开业第一天，我只让 20 个人进门",
      "material_query": "",
      "transition": "cut"
    }
  ],
  "plain_text": "开业第一天，我只让 20 个人进门\n新店老板用……",
  "warnings": []
}
```

字段规则：

- `shots` 顺序即时间线顺序；`seconds` 为 **3–30** 的整数，`duration` **等于各镜头之和**，
  不采信模型自报。`script.generate` 已经按各场求和并截断，适配层再校验一次。
- `shot_size` 可能为空字符串（`script._scenes_of` 明确不补默认值）。**客户端不许替它编
  「中景」**；空就显示「未标注」，画面照样用 `visual`。
- `voiceover` 为空 = 这一镜没有旁白；客户端不要拿 `visual` 去念。
- `caption` 默认等于 `voiceover`，不截断；断句/分行是 jianjicode 字幕工具的活。
- `material_query` v1 **固定为空**，不硬编关键词。jianjicode 回退用 `visual` 检索；
  等 `script` 提示词支持该字段再填（P1）。
- `transition` v1 固定 `cut`。
- `aspect` v1 固定 `9:16`。
- `hook` = 第一条非空 `voiceover` 的第一句（到第一个句号/问号/感叹号），最长 40 字；
  没有旁白则用 `title`。
- `plain_text` 直接取 `script.generate` 的 `text`，供导出/人工校对，不参与编排。
- `warnings` 来自 `script` 的 `warn`，外加适配层自己的（场次被截断、时长偏差等）。
- **不返回**：prompt、token 用量、内部用户 id、会员信息、模型名、`raw`。

### 2.3 时长归一化

1. `scenes`、`duration` 通过区间校验后，算 `sceneSeconds = round(duration / scenes)`，
   clamp 到 3–30。
2. 传给 `script.generate` 的 body：`scenes`、`sceneSeconds`、`topic`、`product`、`platform`、
   `targetCustomer`、`styleNotes`、`form="video"`、`content_type="短视频"`。
3. 模型返回后，`duration = sum(shot.seconds)`；若与请求值偏差 >20%，追加 warning
   「模型给出的总时长与请求不一致，已按镜头实际秒数求和」。
4. 不改写单镜秒数——那是模型根据台词长度定的，硬缩放会让配音对不上。

### 2.4 错误语义

所有失败统一：

```json
{
  "ok": false,
  "error": { "code": "invalid_request", "message": "请先写「这条视频想讲什么」" },
  "trace_id": "a1b2c3d4e5f6"
}
```

| code | HTTP | 场景 |
|---|---|---|
| `endpoint_disabled` | 503 | 令牌/服务账号未配置 |
| `unauthorized` | 401 | 令牌错误或缺失 |
| `invalid_request` | 400 | 字段缺失/超长/区间不合法 |
| `unsupported_style` | 400 | `style` 不是「剧情」 |
| `request_id_conflict` | 409 | 同 `request_id` 换了请求体 |
| `quota_exceeded` | 429 | 当日 plan 配额用尽 |
| `busy` | 429 | 并发闸满 |
| `model_failed` | 200 | 模型没答好（原 `ok:false`） |
| `model_unstructured` | 200 | 模型答了散文，没拆成场次 |
| `internal_error` | 200 | 适配层异常（记日志，不回堆栈） |

**HTTP 状态码只表达「请求合不合法 / 有没有权限 / 有没有额度」**；模型今天状态不好
一律 200 + `ok:false`，与 `routes/script.py` 的既有口径一致。

`model_unstructured` 时**不返回半套 shots**：`script.generate` 的 `structured:false`
直接翻成失败，客户端重新生成。

### 2.5 幂等与超时

- `request_id` 存在时，进程内 `OrderedDict` 缓存 10 分钟、最多 100 条；命中直接回原响应
  （同 `trace_id`）。同 id 不同 body → 409。
- **只缓存成功响应**；模型失败/格式不对不缓存，重试会重新调模型。
- 缓存不落盘，重启即失效；宁可多花一次模型调用，不引入跨进程状态。
- 服务端预算沿用 `script.BUDGET_SEC=150s`；jianjicode 客户端超时设 **170s**。
- 日志只记 `trace_id/request_id/ok/code/耗时/字数`，**不记 topic、product 全文**。

## 3. `POST /api/production/tts`

### 3.1 请求

```json
{
  "voice": "Cherry",
  "segments": [
    { "id": "s1", "text": "开业第一天，我只让 20 个人进门。" },
    { "id": "s2", "text": "不是饥饿营销，是我想把每个人服务好。" }
  ]
}
```

- `segments` 1–20 条；每条 1–600 字；总计 ≤3000 字；`id` 匹配 `^[A-Za-z0-9_-]{1,32}$`。
- `voice` 可选；不传用服务端默认（`TTS_DEFAULT_VOICE`）。值必须在 `/voices` 列表里，
  否则 400 `invalid_request`。
- 同一次请求里 `id` 重复 → 400。

### 3.2 响应

```json
{
  "ok": true,
  "voice": "Cherry",
  "trace_id": "b2c3d4e5f6a1",
  "segments": [
    { "id": "s1", "chars": 17, "urls": ["https://wenan.onecat.xin/static/tts/xxx.mp3"] }
  ]
}
```

- 返回顺序与请求一致；`urls` 可能多段（长文本切分），客户端按顺序拼接。
- **全有或全无**：任一段失败 → `ok:false` + `error.code="tts_failed"` + `failed_ids`，
  不返回半套音频。避免成片某一镜静音却看起来成功。
- URL 只保证短期可下载（OSS 约 24h / 本地 mp3 约 7 天）；客户端拿到后**立即下载**。
- 配额记账：**成功合成的段才记** `production_tts`。整单因某段失败而返回错误时，
  已经合成成功的那几段仍然记额度（钱已经花了），失败段不记。

### 3.3 `GET /api/production/tts/voices`

```json
{
  "ok": true,
  "default": "Cherry",
  "trace_id": "b2c3d4e5f6a1",
  "voices": [
    { "name": "Cherry", "desc": "Cherry · 甜美女声" },
    { "name": "Ethan", "desc": "Ethan · 磁性男声" }
  ]
}
```

音色形状直接复用站点现有的 `config.TTS_VOICES`（`name/desc`），不做 `id/label` 翻译层。

音色清单以现有 TTS 服务能力为准，不在契约里写死；`Cherry` 只是示例。

### 3.4 超时与降级

- 单次 TTS 请求服务端预算 180s；客户端 200s。
- 百炼欠费/不可用 → `tts_failed`，`message` 用中文说「配音服务暂时不可用」；
  不把供应商错误原文透给最终用户。
- TTS 不可用时，jianjicode 仍应能产出**无配音的分镜表/占位视频**，并明确标注
  「本轮没有配音」，不能假装有声。

## 4. `POST /api/production/publish-pack`（P1，先不做）

请求：

```json
{
  "title": "开业第一天，我只让 20 个人进门",
  "script": "完整旁白/台词",
  "platform": "抖音",
  "cover_text": "开业只让 20 人进门"
}
```

响应：

```json
{
  "ok": true,
  "titles": ["...", "...", "..."],
  "hashtags": ["#健身房", "#新店开业", "#体验课"],
  "cover": { "text": "开业只让 20 人进门", "prompt": "" },
  "checks": [{ "level": "warn", "message": "标题超过 20 字，列表页可能截断" }],
  "specs": { "aspect": "9:16", "resolution": "1080x1920", "fps": 30, "video": "H.264", "audio": "AAC" }
}
```

`cover.prompt` 为空时 jianjicode 只排文字封面，不调出图；出图是单独开关，避免默认烧钱。
发布包**不直接发布**，只产出可复制的文案与检查结果。

## 5. jianjicode 工具

### 5.1 配置

- `MAODAO_PROD_URL`（默认回退 `MAODAO_KB_URL`）
- `MAODAO_PROD_TOKEN`（**必须单独配**，不复用 `MAODAO_KB_TOKEN`）
- `MAODAO_PROD_TIMEOUT_MS`（plan 默认 170000，tts 默认 200000）
- `config.json` 可写 `maodaoProduction: { url, token, timeoutMs }`；环境变量优先。

### 5.2 `maodao_plan`

```
maodao_plan(topic, product, platform?, duration?, scenes?, style?, audience?, must_include?, avoid?)
```

- 调 `POST /api/production/plan`，`request_id` 由工具每次生成 UUID；
  一次工具调用内不自动重试，重试由模型/用户发起新的调用（服务端幂等仍然有效）。
- 输出：一段人可读的镜头表 + 一个 ```json 代码块（完整响应）；`metadata` 带
  `{ success, traceId, requestId, duration, shotCount, warnings, error? }`。
- 未配令牌 → 不发网络请求，直接失败，并写明「未配置猫导制作令牌」。
- HTTP 错误/超时/`ok:false` → `metadata.error=true`，输出明确写
  「这一轮不要自己编分镜，先修配置或重试」。
- 不缓存；幂等交给服务端 `request_id`。

### 5.3 `maodao_tts`

```
maodao_tts(segments: [{id, text}], voice?)
```

- 调 `POST /api/production/tts`；成功后把音频下载到项目目录：
  `.maodao/tts/<trace_id>/<segment_id>.mp3`。
- `segment_id` 只允许 `[A-Za-z0-9_-]`；下载前先校验，防路径穿越。
- 先写 `.part` 再原子改名；任一段失败 → 清掉本次目录，不返回半套文件。
- 用 ffprobe 读每段时长，返回 `{ id, path, seconds }`；读不到时长 → 该段失败。
- `metadata`: `{ success, traceId, voice, dir, totalSeconds, files, error? }`。
- 上限：一次 20 段、单段 600 字、总计 3000 字，工具在发请求前先挡。
- 服务端对长文本可能返回多个 `urls`：逐个下载后用 ffmpeg concat 合成一个
  `<id>.mp3`，再探时长。
- 只接受 `https:` 音频地址；下载超时 120s/段。

### 5.4 `maodao_publish`（P1）

```
maodao_publish(title, script, platform, cover_text?, cover_frame?)
```

只产出发布包（标题备选、话题、封面文字、检查项、编码参数），不直接发布。

### 5.5 编排 skill：`maodao-production`

1. `maodao_plan` 拿镜头表；缺 topic/product 先问，不猜；`style` 只走「剧情」。
2. 用户素材优先；没有素材的镜头用占位卡（纯色 + 大字 `visual` 摘要），
   不自动生成视频，除非用户明确要求。
3. `maodao_tts` 逐镜配音；`voiceover` 为空的镜头跳过。
4. 时间线：每镜时长 = 音频时长；无音频用 `seconds`；字幕用 `caption`；转场按 `transition`。
5. 导出 1080×1920 / H.264 / AAC / 30fps。
6. 报告：输出路径、每镜素材来源、缺失素材、未配音镜头、`warnings`。
7. （P1）`maodao_publish` 出发布包。

## 6. `script.generate` → 契约字段映射

| 契约字段 | 来源 | 规则 |
|---|---|---|
| `topic` / `product` | 请求 | 原样 |
| `platform` | 请求 | 默认「抖音」 |
| `scenes` / `sceneSeconds` | `duration` / `scenes` | `sceneSeconds=round(duration/scenes)`；区间校验保证落在 3–30 |
| `audience` | 请求 | 写进 `targetCustomer` |
| `must_include` / `avoid` | 请求 | 拼进 `styleNotes`：「必须包含：…；避免：…」 |
| `style` | 请求 | v1 固定「剧情」，不传给模型 |
| `title` / `logline` / `analysis` | 模型 | 原样，分别截 120/300/300 字 |
| `hook` | 模型 | 第一条非空 `line` 的第一句，≤40 字 |
| `duration` | 模型 | `sum(scenes.seconds)` |
| `shot_size` | `scene.shot` | 原样，可为空；不补默认值 |
| `visual` / `voiceover` | `scene.visual` / `scene.line` | 原样 |
| `caption` | `scene.line` | 原样，不截断 |
| `material_query` | — | v1 固定 `""` |
| `transition` | — | v1 固定 `cut` |
| `plain_text` | `text` | 原样 |
| `warnings` | `warn` | 有值则放进数组，再追加适配层 warning |

适配层必须走 `form_inp()` + `script.generate()`，**不重抄提示词**；
`script.generate` 返回 `ok:false` 或 `structured:false` 都要翻成契约失败。

## 7. 代码落点

猫导（分支 `feat/production-plan`，基于最新 `origin/main` `088155e`）——**已实现**：

- `routes/production.py`：鉴权、参数校验、配额、`asyncio.to_thread`、TTS 批量封装、并发闸
- `services/production.py`：`validate()` / `plan()` 适配器 + 字段归一化 + 幂等缓存 + TTS 校验
- `config.py`：`PRODUCTION_API_TOKEN`、`PRODUCTION_API_USER_ID`、
  `PRODUCTION_DAILY_PLANS`、`PRODUCTION_DAILY_TTS_SEGMENTS`、`PRODUCTION_MAX_BODY_BYTES`
- `main.py`：注册路由
- `tests/test_production_api.py`：34 条断言，假 `script.generate` / 假 TTS，不打真模型

jianjicode ——**部分完成**：

- ✅ `src/tool/maodao_http.ts`：配置读取、令牌请求、超时/取消/网络错误归一化
- ✅ `src/tool/maodao_plan.ts`：UUID、镜头表渲染、失败态
- ✅ `src/tool/maodao_tts.ts`：参数校验、整单落盘、多 url 拼接、ffprobe 时长
- ✅ `src/registry/tool_registry.ts`：注册 `maodao_plan` / `maodao_tts`
- ✅ `skills/maodao-production/SKILL.md`：plan → 镜头表 → 配音 → 询问下一步
- ✅ `config.json` 的 `maodaoProduction`（token 留空，部署时填）
- ⏳ `src/tool/maodao_publish.ts`（P1）
- ⏳ `maodao_kb` 尚未改用 `maodao_http.ts`（它有自己的 KB 配置段，改动需回归）

## 8. 验收

猫导自动化：

- 503（未配令牌/服务账号）、401（错令牌）、400（缺 topic/product、超长、区间非法）
- `style=口播` → 400 `unsupported_style`
- 成功：`duration == sum(shots.seconds)`、无内部字段、`trace_id` 存在于响应与日志
- `structured:false` → 200 + `ok:false` `model_unstructured`，无 shots
- KB 令牌不能调 production；production 令牌不能调 KB（后者等 KB 分支合进来再补）
- 配额：第 N+1 次 429；失败调用不占配额；`record_usage` 真的落行
- 幂等：同 `request_id` 同 body 返回同一 `trace_id`；不同 body → 409
- 并发 4 以上 → `busy`，不 500

**当前结果（2026-11-10）**：`test_production_api.py` 34/34；回归 `test_script.py`
70/70、`test_api_json_errors.py` 11/11；CI 同款 ruff 规则通过。

jianjicode：

- 未配令牌 → 零网络请求
- 成功 → 输出含镜头表；`metadata.shotCount` 正确
- 401/500/超时/`ok:false` → 明确失败态，不编分镜
- TTS 下载失败 → 本次目录被清理，不返回半套文件
- segment id `../x` 之类 → 工具拒绝
- TTS 不可用 → 仍能出无配音时间线，并明确标注

**当前结果（2026-11-10）**：代码已写，但本机既无 `bun` 也无 `node_modules`，
`bun test` / `tsc --noEmit` **未执行**；需在装有依赖的环境补跑后再算验收通过。

## 9. 上线顺序

0. ✅ **前置**：猫导分支 `feat/production-plan` 基于最新 `origin/main` `088155e` 新建
   （没有碰落后 184 个提交的旧分支）。`plan` 不依赖 DashScope。
1. ✅ 猫导 `POST /api/production/plan` + 鉴权/配额/幂等/测试（34/34）。
   `tts` 端点代码同分支已落，但真联调要等百炼充值。
2. 🟡 jianjicode `maodao_plan` + skill 已写；待装依赖后跑 typecheck/test，
   再联调「给主题 → 出镜头表」（猫导生产 API 尚未部署，当前只能打本地）。
3. 🟡 jianjicode `maodao_tts` 已写；百炼充值后联调「镜头表 → 配音 → 粗剪」。
4. ⏳ 最后上发布包。

不做生产热补丁；走正常分支 + 发版，避免再出现「生产改了、git 里没有」。

## 10. 待拍板

- 服务账号（推荐，先跑通）还是 jianjicode 用户绑定猫导账号？
- 这条链路对最终用户免费、记服务账号成本，还是扣猫粮？
- 默认音色用哪个（以 `/voices` 为准，先定一个默认）？
- 分镜语言先用 `services/script.py` 的「景别/画面/台词」（便宜），还是加一轮
  `drama.breakdown` 的「机位/运动/动作」（更细，多一次 LLM）？

## 11. 联调样例

服务端 `.env`（不要写进仓库）：

```bash
PRODUCTION_API_TOKEN=<随机串>
PRODUCTION_API_USER_ID=<真实用户 id>
PRODUCTION_DAILY_PLANS=50
PRODUCTION_DAILY_TTS_SEGMENTS=500
```

先在本机 8001 验，不要直接打公网：

```bash
curl -sS http://127.0.0.1:8001/api/production/plan \
  -H "X-Prod-Token: $PRODUCTION_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "manual-1",
    "topic": "健身房新店开业，想让人来体验",
    "product": "9.9 元私教体验课",
    "duration": 40,
    "scenes": 4
  }' | python -m json.tool
```

期望：`ok:true`、`shots` 非空、`duration == sum(shots[].seconds)`、
`trace_id` 与日志里那条一致。同一 `request_id` 再打一次应返回同一 `trace_id`，
且服务端不再调模型。

TTS 在百炼充值后再验：

```bash
curl -sS http://127.0.0.1:8001/api/production/tts \
  -H "X-Prod-Token: $PRODUCTION_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"segments":[{"id":"s1","text":"开业第一天，我只让 20 个人进门。"}]}' \
  | python -m json.tool
```
