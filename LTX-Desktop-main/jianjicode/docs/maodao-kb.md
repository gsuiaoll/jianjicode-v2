# 猫导知识库接入（maodao_kb）

把猫导的语料知识库以**只读 HTTP API** 接进 jianjicode：判断层（方法论）和知识层（原文片段）仍留在猫导后端，客户端只拿渲染好的短文本，不复制 embedding / 检索逻辑。

## 为什么不是整库搬进客户端

- 知识层线上约 1.6 万块 × 1024 维 float32，纯向量就 ~64MB；还要带 embedding 模型、RRF 融合、`SEM_MIN=0.66` 的实测闸门。
- 查询本身仍要算 embedding，整库不等于离线；换模型/换库还要重新标定。
- 猫导自己的原则是「同一件事只准有一个实现」，搬一份进 TypeScript 必然漂移。

## 猫导侧配置

在猫导网页后端（`jinqiang-web`）的 `.env` 里加：

```bash
KB_API_TOKEN=<随机长串>
```

不配置 = API 关闭（返回 503），站内聊天不受影响。令牌只读、可随时轮换。

三个端点（均需 `X-KB-Token` 头）：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/kb/health` | 开关、索引是否就绪、版本、条数、闸门 |
| GET | `/api/kb/methods` | 判断层全量快照（客户端启动缓存用） |
| POST | `/api/kb/search` | 按问句取方法论 + 知识块 |

`POST /api/kb/search` 请求：

```json
{ "q": "怎么写开头", "k": 4, "domains": ["短视频文案"] }
```

响应（200）：

```json
{
  "ok": true,
  "version": "271:2026-11-10 ...:16293:...",
  "enabled": true,
  "index_ready": true,
  "gate": 0.66,
  "method_text": "【你自己的方法论 · ...】...",
  "knowledge_text": "【知识库 · ...】...",
  "method_chars": 2100,
  "knowledge_chars": 900,
  "reason": "",
  "trace_id": "..."
}
```

`reason` 取值：`""`（有内容）、`empty`（两层都空）、`method_empty`、`knowledge_empty`、`disabled`。
检索异常回 **200 + `ok:false`**，客户端按「这一轮不带知识」降级，不阻断剪辑。

## jianjicode 侧配置

环境变量优先，其次 `config.json` 的 `maodaoKb` 段：

```bash
MAODAO_KB_URL=https://wenan.onecat.xin
MAODAO_KB_TOKEN=<与猫导 KB_API_TOKEN 相同>
MAODAO_KB_TIMEOUT_MS=12000
```

本机最省事的配法：在仓库根目录建 `.env`（已被 gitignore），Bun 启动时会自动加载，**不要把令牌写进进仓的 `config.json`**：

```bash
# jianjicode/.env
MAODAO_KB_URL=https://wenan.onecat.xin
MAODAO_KB_TOKEN=<与猫导 KB_API_TOKEN 相同>
```

`config.json` 默认段：

```json
"maodaoKb": {
  "url": "https://wenan.onecat.xin",
  "token": "",
  "timeoutMs": 12000
}
```

令牌为空时工具直接返回「未配置」，不发网络请求。

## 工具行为

- 名字：`maodao_kb`；注册在 `src/registry/tool_registry.ts`（和 `video_rag_search` 同一层）。
- 与 `video_rag_search` 的分工写在工具描述里：前者查**当前视频内容**，后者查**领域方法论**。
- 输出直接使用猫导返回的 `method_text` / `knowledge_text`，并追加一句「别照背、别提课程、对不上就丢掉」。
- 失败/超时/未配置都返回 `metadata.error=true`，输出里明确写「这一轮不要引用知识库」，避免模型假装查过。
- 5 分钟内存缓存（同 query/k/domains），避免一轮对话里重复调用。

## 建议：装一个触发用 Skill

仓库里带了一份可复制的种子：`skills/maodao-knowledge/SKILL.md`。

```bash
mkdir -p ~/.jianjicode/skills/maodao-knowledge
cp skills/maodao-knowledge/SKILL.md ~/.jianjicode/skills/maodao-knowledge/SKILL.md
```

Skill 只负责「什么时候该调」；真正的知识仍在猫导侧。

## 验证

猫导侧：

```bash
curl -s -X POST http://127.0.0.1:8001/api/kb/search \
  -H "X-KB-Token: $KB_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"q":"怎么给健身房写开头","k":4}'
```

jianjicode 侧：启动后看 `/api/jianjicode/tools` 是否列出 `maodao_kb`，再在聊天里问一句「帮我写个健身房口播开头」，确认工具卡片有输出。
