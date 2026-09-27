# Qiyue AI Gateway 使用说明

这份文档是以后新项目接入 Qiyue 个人 AI Gateway 的唯一入口。网关统一保存上游模型 API Key，各应用只持有自己的项目 Token。

## 1. 线上地址

生产 Base URL：

```text
https://ai.qiyueastro.com/v1
```

Vercel 默认域名：

```text
https://qiyue-ai-gateway-omega.vercel.app/v1
```

标准接口实际由 Vercel rewrite 转到内部 `/api/v1/*`。客户端统一使用上面的 `/v1` 地址，不要把 `/api/v1` 写进客户端 Base URL。

## 2. 鉴权

推荐使用 OpenAI 兼容的请求头：

```http
Authorization: Bearer <该应用自己的 Gateway Token>
```

也兼容：

```http
X-Qiyue-Token: <该应用自己的 Gateway Token>
```

每个应用必须使用独立 Token。不要把 Gemini、Qwen、DeepSeek 的上游 API Key 放进 App、浏览器 Bundle、公开仓库或请求体。

## 3. 可用模型别名

客户端只依赖这些稳定别名，不要把上游模型名写死在每个项目里：

| 请求模型 | 默认上游 | 用途 |
|---|---|---|
| `qy-fast` | Gemini → Qwen → DeepSeek | 日常快速任务 |
| `qy-smart` | Gemini → Qwen → DeepSeek | 复杂任务 |
| `qy-gemini` | Gemini | 明确使用 Gemini |
| `qy-qwen` | Qwen | 明确使用 Qwen |
| `qy-deepseek` | DeepSeek Flash | 明确使用 DeepSeek |

当前建议的 Vercel Production 配置：

```env
GATEWAY_FAST_PROVIDER=gemini
GATEWAY_SMART_PROVIDER=gemini
GATEWAY_GEMINI_MODEL=gemini-2.5-flash
GATEWAY_QWEN_MODEL=qwen-plus
GATEWAY_DEEPSEEK_MODEL=deepseek-flash

# 每个项目自己的优先级。请求 qy-fast / qy-smart 时按对应项目 Token 选择。
# 发生 408、409、425、429 或 5xx 时自动尝试下一个供应商。
GATEWAY_QIYUE_WEB_ORDER=gemini,qwen,deepseek
GATEWAY_TODOAI_ORDER=gemini,qwen,deepseek
GATEWAY_IOS_ORDER=gemini,qwen,deepseek
```

项目级顺序优先于 `GATEWAY_FAST_PROVIDER` / `GATEWAY_SMART_PROVIDER`。客户端不能在请求中自行改顺序；网关根据 Token 识别项目，避免应用绕过既定成本和供应商策略。网关后台的用量记录会同时保存请求别名、实际供应商和实际模型，因此可以看到 `qy-fast` 最终实际落到了哪一个模型。

换模型时只改 Vercel 环境变量并重新部署，客户端不需要改代码。

## 4. 最小调用示例

非流式：

```bash
curl https://ai.qiyueastro.com/v1/chat/completions \
  -H "Authorization: Bearer <APP_GATEWAY_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qy-fast",
    "messages": [{"role": "user", "content": "你好"}],
    "temperature": 0.4,
    "max_tokens": 2048
  }'
```

流式：

```bash
curl -N https://ai.qiyueastro.com/v1/chat/completions \
  -H "Authorization: Bearer <APP_GATEWAY_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qy-fast",
    "stream": true,
    "messages": [{"role": "user", "content": "用一句话介绍栖月"}]
  }'
```

查看可用别名：

```bash
curl https://ai.qiyueastro.com/v1/models \
  -H "Authorization: Bearer <APP_GATEWAY_TOKEN>"
```

健康检查也需要应用 Token：

```bash
curl https://ai.qiyueastro.com/v1/health \
  -H "Authorization: Bearer <APP_GATEWAY_TOKEN>"
```

## 5. 新增应用的完整流程

新增应用不是只在 Vercel 添加一个变量，还要完成应用身份注册。

### 第一步：生成独立 Token

本地生成随机 Token，不要使用应用名、生日或连续数字：

```bash
openssl rand -hex 32
```

### 第二步：在 Vercel 添加变量

例如新应用叫 `study`：

```env
GATEWAY_TOKEN_STUDY=<刚生成的随机值>
```

环境选择 Production；如果要测试 Preview，再单独勾选 Preview。保存后重新部署。

### 第三步：注册应用身份

编辑 `lib/auth.mjs` 的 `PROJECTS`：

```js
const PROJECTS = [
  ['qiyue-web', 'GATEWAY_TOKEN_QIYUE_WEB'],
  ['todoai', 'GATEWAY_TOKEN_TODOAI'],
  ['ios', 'GATEWAY_TOKEN_IOS'],
  ['study', 'GATEWAY_TOKEN_STUDY'],
];
```

然后提交并推送 `main`，等待 Vercel 自动部署。这里的项目 ID 会写入用量数据库，之后不要随意改名，否则历史统计会被分成两个项目。

### 第四步：更新后台筛选项

如果希望在后台的“应用”下拉框中单独筛选，还要在 `api/admin/index.mjs` 增加：

```html
<option value="study">Study</option>
```

这一步不影响统计写入，只影响后台快捷筛选。

### 第五步：发一条真实请求验证

用新 Token 请求 `qy-fast`，然后打开管理员页面刷新。应该能看到应用名、模型、Token 数量和预计费用。

## 6. 上游 API Key 和区域配置

这些变量只放在 Vercel Production，不放到客户端：

```env
GEMINI_API_KEY=...
QWEN_API_KEY=...
DEEPSEEK_API_KEY=...
```

Qwen 当前使用北京区：

```env
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

Qwen 的 API Key 和 Base URL 必须属于同一个区域。更换美国、新加坡或其他区域时，必须同时更换对应区域的 Key 和 Base URL，不能混用。

DeepSeek：

```env
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

## 7. 费用统计和价格表

费用统计只记录请求元数据，不保存提示词和模型回复。数据库表是 `gateway_usage`。

价格默认来自代码内置的版本化表：

```text
lib/pricing.mjs
```

当前内置：

- `gemini-2.5-flash-lite`
- `gemini-2.5-flash`
- `qwen-plus`
- `qwen-flash`
- `deepseek-flash`

因此，新增应用但继续使用已有模型时，不需要新增价格变量。系统按实际供应商和上游模型自动套用价格。

如果新增没有内置的新模型，可以用环境变量覆盖该供应商的价格：

```env
GATEWAY_QWEN_INPUT_PER_1M=...
GATEWAY_QWEN_OUTPUT_PER_1M=...
GATEWAY_DEEPSEEK_INPUT_PER_1M=...
GATEWAY_DEEPSEEK_OUTPUT_PER_1M=...
GATEWAY_GEMINI_INPUT_PER_1M=...
GATEWAY_GEMINI_OUTPUT_PER_1M=...
```

这些覆盖值统一按 **USD / 每百万 Token** 填写。不要把人民币价格直接填入这些变量。

Qwen 和 DeepSeek 的内置人民币价格会按：

```env
GATEWAY_CNY_TO_USD=0.14
```

换算成数据库里的 `estimated_cost_usd`。这是成本估算，不是供应商账单；如果需要严格对账，应以各供应商控制台账单为准。

DeepSeek 的内置估算按北京时间工作日高峰时段处理；法定节假日、缓存命中、Batch 折扣等情况可能与估算不同。

价格来源和核对日期记录在 `lib/pricing.mjs` 顶部。不要让线上请求运行时抓取官方网页；网页不是稳定 API，抓取失败不能影响模型调用。

## 8. 用量后台

管理员页面：

```text
https://ai.qiyueastro.com/api/admin
```

管理员 JSON 接口：

```text
https://ai.qiyueastro.com/api/admin/usage
```

需要单独的管理员 Token：

```env
GATEWAY_ADMIN_TOKEN=<独立生成，不要复用应用 Token>
```

管理 Token 通过页面输入，不要写入前端代码。后台可以按时间、应用和请求模型查看：

- 请求数；
- 总 Token、输入 Token、输出 Token；
- 错误数；
- 应用请求占比和 Token 占比；
- 模型用量；
- 预计费用；
- 最近请求延迟和状态。

只有经过新接口 `/v1/chat/completions` 的请求会写入 `gateway_usage`。旧的独立代理路径不要作为新项目接入入口；迁移项目时统一改为标准 `/v1/chat/completions`。

## 9. 部署和域名

代码仓库：

```text
https://github.com/BloodymaryGG/qiyue-ai-gateway
```

推送到 `main` 后由 Vercel 自动部署。部署后依次检查：

```bash
curl -i https://ai.qiyueastro.com/v1/health
curl -i https://ai.qiyueastro.com/api/admin
```

没有 Token 访问 `/v1/health` 返回 401 是正常的；这说明路由和鉴权存在，不代表上游模型调用已经成功。

`ai.qiyueastro.com` 通过 Cloudflare DNS CNAME 指向 Vercel 提供的目标，并在 Cloudflare 中保持“仅 DNS”状态，避免代理层干扰验证。Vercel SSL 证书生成完成后再测试 HTTPS。

## 10. 常见错误

### 401 `invalid_api_key`

- Token 没有放在 `Authorization: Bearer ...` 或 `X-Qiyue-Token`；
- Token 值与 Vercel Production 环境变量不一致；
- 新应用只添加了环境变量，没有注册到 `lib/auth.mjs`；
- 修改变量后没有重新部署。

### 404 `NOT_FOUND`

- 客户端 Base URL 写成了错误域名；
- 使用了旧的 `/api/v1` 或错误路径；
- 部署尚未完成。

标准地址是：

```text
https://ai.qiyueastro.com/v1/chat/completions
```

### 503 `provider_not_configured`

- 对应的上游 API Key 未添加；
- 变量只添加到了 Preview，没有添加到 Production；
- 修改变量后没有重新部署。

### 401 / 403 来自 Qwen

通常是 API Key 和 Base URL 区域不匹配。北京 Key 配北京 URL，美国 Key 配美国 URL。

### 后台没有用量

- 请求没有经过 `/v1/chat/completions`；
- Token 无效，请求在上游调用前就被拒绝；
- `DATABASE_URL` 没有配置；
- `gateway_usage` 表尚未执行 `usage/schema.sql`；
- Neon 数据库连接或权限失败。

### 预计费用显示为空

- 上游模型不在 `lib/pricing.mjs`；
- 新模型没有价格覆盖；
- 这是旧请求，价格逻辑更新不会回填历史记录。

## 11. 安全底线

- 不要把任何 API Key 或 Gateway Token 提交到 Git；
- 不要把 `GATEWAY_ADMIN_TOKEN` 发给普通应用；
- 每个应用使用不同 Token；
- Token 泄露后立即在 Vercel 轮换，并重新部署；
- 轮换应用 Token 不会影响上游 API Key；
- 轮换上游 API Key 后要确认新 Key 与区域、Base URL 和模型匹配；
- 不在日志中打印 Authorization、API Key、提示词或模型回复；
- 费用页面只保存请求元数据。

## 12. 给新项目的最短交接话术

以后让其他项目接入时，可以直接说：

> 使用 Qiyue AI Gateway。阅读仓库 `docs/GATEWAY_USAGE.md`，使用生产 Base URL `https://ai.qiyueastro.com/v1`，为该项目创建独立 Gateway Token，默认模型使用 `qy-fast`，不要接触或复制任何上游 API Key。
