# Qiyue AI Gateway

个人 AI 中转网关。对项目提供一个稳定的 OpenAI-compatible API，服务端保存上游模型密钥。

## Endpoints

- `POST /v1/chat/completions`（通过 Vercel rewrite 转到内部 `/api/v1/chat/completions`）
- `GET /v1/models`
- `GET /v1/health`
- `/api/gemini`：旧 Gemini 代理兼容路径，迁移完成前保留
- `GET /api/admin/usage`：管理员用量 JSON
- `GET /api/admin`：管理员用量页面

## Authentication

新接口使用：

```http
Authorization: Bearer <project-token>
```

项目 Token 通过 `GATEWAY_TOKEN_QIYUE_WEB`、`GATEWAY_TOKEN_TODOAI`、`GATEWAY_TOKEN_IOS` 配置。
不要把这些 Token 写进公开网页 bundle 或 App 源码；浏览器和 App 应通过自己的服务端调用 Gateway。

## Usage analytics

用量统计使用 Neon Postgres。先将 `usage/schema.sql` 执行到数据库，再把 `DATABASE_URL` 和独立的 `GATEWAY_ADMIN_TOKEN` 添加到 Vercel Production 环境。统计页为 `/api/admin`，统计接口为 `/api/admin/usage`，只保存应用、模型、token、耗时和状态，不保存提示词或模型回复。

预计花费由 `lib/pricing.mjs` 的版本化内置价格表计算，不需要把价格全部填入 Vercel。当前内置 `gemini-2.5-flash-lite`、`qwen-plus` 和 `deepseek-flash` 的官方列表价格；如果账户有特殊合同价，可用 `.env.example` 中的 `GATEWAY_*_INPUT_PER_1M` / `GATEWAY_*_OUTPUT_PER_1M` 覆盖。Qwen 和 DeepSeek 的人民币价格会按 `GATEWAY_CNY_TO_USD`（默认 0.14）转换为数据库中的 USD 估算值。DeepSeek 按北京时间工作日 9:00–12:00、14:00–18:00 估算高峰价，法定节假日需手动调整或覆盖价格。

## Models

- `qy-fast`：默认走 `GATEWAY_FAST_PROVIDER`，适合快速任务
- `qy-smart`：默认走 `GATEWAY_SMART_PROVIDER`，适合复杂任务
- `qy-gemini`：明确使用 Gemini
- `qy-qwen`：明确使用 Qwen
- `qy-deepseek`：明确使用 DeepSeek Flash

模型别名可以在不修改各个项目的情况下切换上游模型。

## Domain

不需要注册新域名。部署后可以把现有 Cloudflare DNS 的 `ai.qiyueastro.com` CNAME 到 Vercel 项目域名。
