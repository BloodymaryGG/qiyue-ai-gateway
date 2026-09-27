import { neon } from '@neondatabase/serverless';
import { estimateCostUsd } from './pricing.mjs';

let sqlClient;

function sql() {
  if (!process.env.DATABASE_URL) return null;
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function usageConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export async function recordUsage({ project, requestedModel, provider, providerModel, promptTokens = 0, completionTokens = 0, totalTokens = 0, status = 'success', statusCode = 200, latencyMs = 0, streamed = false }) {
  const db = sql();
  if (!db) return;
  const prompt = number(promptTokens);
  const completion = number(completionTokens);
  const total = number(totalTokens) || prompt + completion;
  const cost = estimateCostUsd({ provider, model: providerModel, promptTokens: prompt, completionTokens: completion });
  await db`
    INSERT INTO gateway_usage (project, requested_model, provider, provider_model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, status, status_code, latency_ms, streamed)
    VALUES (${project}, ${requestedModel || null}, ${provider || null}, ${providerModel || null}, ${prompt}, ${completion}, ${total}, ${cost}, ${status}, ${statusCode}, ${Math.max(0, Math.round(latencyMs))}, ${streamed})
  `;
}

export async function readUsage({ days = 30, project = null, model = null, limit = 100 } = {}) {
  const db = sql();
  if (!db) throw new Error('DATABASE_URL is not configured');
  const safeDays = Math.min(Math.max(Number(days) || 30, 1), 365);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const summary = await db`
    SELECT project, COUNT(*)::int AS requests, COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
      COALESCE(SUM(prompt_tokens), 0)::int AS prompt_tokens, COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
      COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost_usd, ROUND(AVG(latency_ms))::int AS avg_latency_ms,
      COUNT(*) FILTER (WHERE status <> 'success')::int AS errors
    FROM gateway_usage WHERE created_at >= NOW() - (${safeDays} * INTERVAL '1 day') AND (${project}::text IS NULL OR project = ${project}::text) AND (${model}::text IS NULL OR requested_model = ${model}::text)
    GROUP BY project ORDER BY total_tokens DESC
  `;
  const recent = await db`
    SELECT created_at, project, requested_model, provider, provider_model, prompt_tokens, completion_tokens, total_tokens,
      estimated_cost_usd, status, status_code, latency_ms, streamed
    FROM gateway_usage WHERE created_at >= NOW() - (${safeDays} * INTERVAL '1 day') AND (${project}::text IS NULL OR project = ${project}::text) AND (${model}::text IS NULL OR requested_model = ${model}::text)
    ORDER BY created_at DESC LIMIT ${safeLimit}
  `;
  const daily = await db`
    SELECT TO_CHAR(DATE(created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS requests,
      COALESCE(SUM(total_tokens), 0)::int AS total_tokens, COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost_usd,
      COUNT(*) FILTER (WHERE status <> 'success')::int AS errors
    FROM gateway_usage WHERE created_at >= NOW() - (${safeDays} * INTERVAL '1 day') AND (${project}::text IS NULL OR project = ${project}::text) AND (${model}::text IS NULL OR requested_model = ${model}::text)
    GROUP BY DATE(created_at) ORDER BY DATE(created_at)
  `;
  const byModel = await db`
    SELECT requested_model, provider, provider_model, COUNT(*)::int AS requests,
      COALESCE(SUM(prompt_tokens), 0)::int AS prompt_tokens, COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
      COALESCE(SUM(total_tokens), 0)::int AS total_tokens, COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost_usd
    FROM gateway_usage WHERE created_at >= NOW() - (${safeDays} * INTERVAL '1 day') AND (${project}::text IS NULL OR project = ${project}::text) AND (${model}::text IS NULL OR requested_model = ${model}::text)
    GROUP BY requested_model, provider, provider_model ORDER BY total_tokens DESC
  `;
  const totalRequests = summary.reduce((sum, item) => sum + Number(item.requests || 0), 0);
  const totalTokens = summary.reduce((sum, item) => sum + Number(item.total_tokens || 0), 0);
  const summaryWithShares = summary.map((item) => ({
    ...item,
    request_share_percent: totalRequests ? Number(((Number(item.requests || 0) / totalRequests) * 100).toFixed(2)) : 0,
    token_share_percent: totalTokens ? Number(((Number(item.total_tokens || 0) / totalTokens) * 100).toFixed(2)) : 0,
  }));
  return { days: safeDays, project, model, summary: summaryWithShares, daily, byModel, recent };
}
