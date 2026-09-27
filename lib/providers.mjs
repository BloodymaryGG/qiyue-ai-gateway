const ALIASES = {
  'qy-fast': () => process.env.GATEWAY_FAST_PROVIDER || 'qwen',
  'qy-smart': () => process.env.GATEWAY_SMART_PROVIDER || 'deepseek',
  'qy-gemini': () => 'gemini',
  'qy-qwen': () => 'qwen',
  'qy-deepseek': () => 'deepseek',
};

const KNOWN_PROVIDERS = ['gemini', 'qwen', 'deepseek', 'openai'];

function projectOrder(project) {
  const key = String(project || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const configured = key ? process.env[`GATEWAY_${key}_ORDER`] : '';
  if (configured) return configured;
  /* 所有项目默认 Gemini 优先；项目变量可覆盖这个顺序。 */
  return 'gemini,qwen,deepseek';
}

function normalizeOrder(raw) {
  return [...new Set(String(raw || '').split(',').map((value) => value.trim().toLowerCase()).filter((value) => KNOWN_PROVIDERS.includes(value)))];
}

export function resolveModels(requested, project = '') {
  const model = String(requested || 'qy-fast').trim().toLowerCase();
  const explicitProvider = ALIASES[model]?.() || (KNOWN_PROVIDERS.includes(model) ? model : null);
  if (!explicitProvider) return [];
  const configuredOrder = (model === 'qy-fast' || model === 'qy-smart') ? normalizeOrder(projectOrder(project)) : [];
  const order = configuredOrder.length
    ? configuredOrder
    : [explicitProvider];
  return order.map((provider) => ({ requested: model, provider, model: providerModel(provider, model) }));
}

export function resolveModel(requested, project = '') {
  return resolveModels(requested, project)[0] || null;
}

function providerModel(provider, requested) {
  if (requested === 'qy-gemini' || provider === 'gemini') return process.env.GATEWAY_GEMINI_MODEL || 'gemini-2.5-flash';
  if (requested === 'qy-qwen' || provider === 'qwen') return process.env.GATEWAY_QWEN_MODEL || 'qwen-plus';
  if (requested === 'qy-deepseek' || provider === 'deepseek') return process.env.GATEWAY_DEEPSEEK_MODEL || 'deepseek-flash';
  return requested;
}

export function configuredProviders() {
  return { gemini: Boolean(geminiKey()), qwen: Boolean(qwenKey()), deepseek: Boolean(deepseekKey()), openai: Boolean(process.env.OPENAI_API_KEY) };
}

export async function createCompletion({ requested, provider, model, messages, temperature, maxTokens, stream, responseFormat }) {
  if (provider === 'gemini') return gemini({ model, messages, temperature, maxTokens, stream, responseFormat });
  const apiKey = provider === 'qwen' ? qwenKey() : provider === 'deepseek' ? deepseekKey() : process.env.OPENAI_API_KEY;
  if (!apiKey) throw new GatewayError(`${provider} is not configured`, 503, 'provider_not_configured');
  const base = provider === 'qwen' ? (process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1') : provider === 'deepseek' ? (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com') : (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
  const upstream = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream, ...(responseFormat ? { response_format: responseFormat } : {}), ...(stream ? { stream_options: { include_usage: true } } : {}) }) });
  return { upstream, provider, model, requested };
}

async function gemini({ model, messages, temperature, maxTokens, stream, responseFormat }) {
  const key = geminiKey();
  if (!key) throw new GatewayError('gemini is not configured', 503, 'provider_not_configured');
  const system = messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n');
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: geminiParts(m.content) }));
  const body = { contents, generationConfig: { temperature, maxOutputTokens: maxTokens } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (responseFormat?.type === 'json_object') body.generationConfig.responseMimeType = 'application/json';
  const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
  const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key }, body: JSON.stringify(body) });
  return { upstream, provider: 'gemini', model };
}

function geminiParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  if (!Array.isArray(content)) return [{ text: textOf(content) }];
  return content.flatMap((part) => {
    if (typeof part === 'string') return [{ text: part }];
    if (part?.text) return [{ text: part.text }];
    const url = part?.image_url?.url;
    if (typeof url === 'string' && url.startsWith('data:')) {
      const match = url.match(/^data:([^;]+);base64,(.+)$/s);
      if (match) return [{ inlineData: { mimeType: match[1], data: match[2] } }];
    }
    return [];
  });
}

function geminiKey() { return process.env.GEMINI_API_KEY || process.env.QIYUE_GEMINI_API_KEY || process.env.TODOAI_GEMINI_API_KEY; }
function qwenKey() { return process.env.QWEN_API_KEY || process.env.TODOAI_QWEN_API_KEY; }
function deepseekKey() { return process.env.DEEPSEEK_API_KEY || process.env.TODOAI_DEEPSEEK_API_KEY; }

export function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === 'string' ? part : part?.text || '').join('');
  return String(content ?? '');
}

export class GatewayError extends Error {
  constructor(message, status = 502, code = 'provider_error') { super(message); this.status = status; this.code = code; }
}
