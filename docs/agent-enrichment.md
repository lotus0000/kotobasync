# 用 Codex / Claude 批量补全 KotobaSync 词汇

适用于：PWA 设置里 `enrich_mode` 设为 `external`（本地模型不跑），或想用更强的模型批量重写例句。

## 准备

1. 在服务器上为 agent 创建专用设备 token（明文只显示一次）：
   ```bash
   docker compose exec kotobasync kotobasync device add "codex-agent"
   ```
2. 公网访问需要 Cloudflare Access Service Token，凭据见 `scripts/cf_access_setup.py` 的输出文件。在服务器本机可直接访问 `http://127.0.0.1:8900`，不需要 Access 头。
3. 用完后吊销：`docker compose exec kotobasync kotobasync device revoke <device_id>`。

所有请求带：`Authorization: Bearer <设备 token>`；经公网时再加 `CF-Access-Client-Id` / `CF-Access-Client-Secret`。

## 流程

1. 取待补全词：`GET /api/enrich/pending?limit=50&include_failed=true`
   返回 `[{id, surface, reading, meaning_zh, sentence, user_edited, enrich_status}]`。
2. 对每个词写回：`PUT /api/words/{id}/enrichment`
   ```json
   {"surface": "食べる", "reading": "たべる", "meaning_zh": "吃；进食",
    "example_ja": "毎朝パンを食べる。", "example_zh": "每天早上吃面包。", "overwrite": false}
   ```
   - 字段都可省略；默认只填空字段，`overwrite: true` 时覆盖非用户手改字段。
   - `user_edited` 里列出的字段**永远不会被修改**，不必为它们生成内容。
   - 响应的 `canonical_id` 若与请求 id 不同，说明该词与已有词重复并已合并，属正常情况。
3. 循环直到 `pending` 返回空数组。

## 内容规范

- `surface`：结合 `sentence` 判断完整词语；活用形还原为辞书形（食べた → 食べる）。只有确定原选区不完整时才提供。
- `reading`：只能是平假名和长音「ー」，外来语也写平假名（コーヒー → こーひー）。否则返回 422。
- `meaning_zh`：简体中文，简洁；多个义项用「；」分隔，最常用义项放前面，不超过 40 字。
- `example_ja`：一个自然、日常、N3–N2 难度的短句（≤ 30 字），包含该词。
- `example_zh`：`example_ja` 的中文翻译。
