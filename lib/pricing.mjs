// Versioned provider list prices used for local cost estimates.
// These are intentionally not fetched at request time: pricing pages are not
// stable APIs, and a documentation outage must never break the gateway.
// Environment variables can override the USD rates for an account-specific
// contract or a future price change.
// Sources checked 2026-09-27:
// https://ai.google.dev/gemini-api/docs/pricing
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
// https://docs.bailian.console.aliyun.com/zh/model-studio/model-pricing

const CNY_TO_USD_DEFAULT = 0.14;

const BUILTIN_PRICING = {
  gemini: {
    currency: 'USD',
    models: {
      'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
      'gemini-2.5-flash': { input: 0.30, output: 2.50 },
    },
  },
  qwen: {
    currency: 'CNY',
    models: {
      // Current gateway requests do not enable Qwen thinking mode and use the
      // <=128K input tier.
      'qwen-plus': { input: 0.80, output: 2.00 },
      'qwen-plus-latest': { input: 0.80, output: 2.00 },
      'qwen-flash': { input: 0.15, output: 1.50 },
    },
    fallback: { input: 0.80, output: 2.00 },
  },
  deepseek: {
    currency: 'CNY',
    models: {
      // DeepSeek Flash: cache-miss rates, selected by Beijing time below.
      'deepseek-flash': {
        offPeak: { input: 1.00, output: 4.00 },
        peak: { input: 2.00, output: 8.00 },
      },
    },
    fallback: { offPeak: { input: 1.00, output: 4.00 }, peak: { input: 2.00, output: 8.00 } },
  },
};

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function envOverride(provider) {
  const prefix = `GATEWAY_${String(provider).toUpperCase()}`;
  const input = finite(process.env[`${prefix}_INPUT_PER_1M`]);
  const output = finite(process.env[`${prefix}_OUTPUT_PER_1M`]);
  return input !== null && output !== null ? { input, output, currency: 'USD', source: 'environment' } : null;
}

function shanghaiTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(values.weekday) ? 'weekday' : 'weekend';
  return { weekday, hour: Number(values.hour) };
}

function isDeepSeekPeak(date) {
  const { weekday, hour } = shanghaiTime(date);
  return weekday === 'weekday' && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));
}

export function getPricing({ provider, model, at = new Date() } = {}) {
  const override = envOverride(provider);
  if (override) return override;

  const family = BUILTIN_PRICING[String(provider || '').toLowerCase()];
  if (!family) return null;
  const configured = family.models?.[model] || family.fallback;
  if (!configured) return null;

  if (provider === 'deepseek') {
    const rates = isDeepSeekPeak(at) ? configured.peak : configured.offPeak;
    return { ...rates, currency: family.currency, source: 'builtin', period: isDeepSeekPeak(at) ? 'peak' : 'off-peak' };
  }
  return { ...configured, currency: family.currency, source: 'builtin' };
}

export function estimateCostUsd({ provider, model, promptTokens = 0, completionTokens = 0, at = new Date() } = {}) {
  const rates = getPricing({ provider, model, at });
  if (!rates) return null;
  const native = (Number(promptTokens || 0) / 1_000_000) * rates.input + (Number(completionTokens || 0) / 1_000_000) * rates.output;
  const conversion = rates.currency === 'CNY' ? finite(process.env.GATEWAY_CNY_TO_USD) ?? CNY_TO_USD_DEFAULT : 1;
  return native * conversion;
}

export function pricingMetadata() {
  return { source: 'builtin', cnyToUsd: finite(process.env.GATEWAY_CNY_TO_USD) ?? CNY_TO_USD_DEFAULT };
}
