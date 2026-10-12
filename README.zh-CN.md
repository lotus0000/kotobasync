# KotobaSync

[English](README.md) | 简体中文

自托管日语生词收集与听写：在 ChatGPT 页面划词收藏，离线优先同步到自己的服务器，用 PWA 复习和听写。

## 服务端开发

```bash
cd server
uv sync
uv run pytest
```

## 前端开发（shared + PWA）

```bash
npm install
npm test            # shared + web 单元测试
npm run typecheck
npm run dev -w web  # http://localhost:5173，/api 代理到 127.0.0.1:8900
```

图标由 `python3 -I scripts/make_icons.py` 生成到 `web/public/`。

## 部署

```bash
cp .env.example .env      # 把 KOTOBA_PUBLIC_URL 改成你的域名
mkdir -p data
docker compose up -d --build
docker compose exec kotobasync kotobasync set-passphrase
curl -s http://127.0.0.1:8900/api/health
```

- 服务只监听 `127.0.0.1:8900`。对外建议走反向代理或 Cloudflare Tunnel，并加一层 Cloudflare Access 保护。
  `scripts/cf_access_setup.py` 可以创建 Access 应用和扩展用的 Service Token（用法见脚本开头），**先配好 Access 再对外开放**。
- 忘记口令：再运行一次 `set-passphrase` 即可重设（只存哈希，无法找回）；已登录的设备不受影响。
- 设备管理：`docker compose exec kotobasync kotobasync device add|list|revoke`。
- 外部 agent 批量补全：见 `docs/agent-enrichment.md`。
- 备份：`scripts/backup.sh`（建议 cron 每日一次）。

## Chrome 扩展

```bash
npm install
KOTOBA_SERVER=https://kotoba.example.com npm run build -w extension   # 产物在 extension/dist
```

`KOTOBA_SERVER` 是扩展默认连接的服务器（不设则为 `http://localhost:8900`），也可以之后在设置页修改。

1. Chrome 打开 `chrome://extensions` →「开发者模式」→「加载已解压的扩展程序」→ 选 `extension/dist`。
   扩展 ID 由 manifest 的 `key` 固定，与 `.env.example` 里的 `KOTOBA_EXTENSION_ORIGIN` 一致。
2. 点工具栏的 KotobaSync 图标打开设置：确认服务器地址；如果服务器在 Cloudflare Access 后面，填入 Service Token 的
   Client ID / Secret；用口令登录。
3. 在 chatgpt.com 选中日语 → 点「＋ 收藏」→ 卡片里可直接改 → 回车或「保存」。

预配置版：构建时设 `KOTOBA_PRESET=/path/to/preset.json`（内容为 `{"serverUrl", "cfClientId", "cfClientSecret"}`），
会打包进 `extension/dist`，新电脑只需输口令。**这样的 dist 含密钥，勿外传、勿提交。**
