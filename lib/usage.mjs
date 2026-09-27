import { neon } from '@neondatabase/serverless';

let sqlClient;

function sql() {
  if (!process.env.DATABASE_URL) return null;
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function estimatedCost(provider, promptTokens, completionTokens) {
  const prefix = `GATEWAY_${String(provider).toUpperCase()}`;
  const input = Number(process.env[`${prefix}_INPUT_PER_1M`]);
  const output = Number(process.env[`${prefix}_OUTPUT_PER_1M`]);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return (promptTokens / 1_000_000) * input + (completionTokens / 1_000_000) * output;
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
  const cost = estimatedCost(provider, prompt, completion);
  await db`
    INSERT INTO gateway_usage (project, requested_model, provider, provider_model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, status, status_code, latency_ms, streamed)
    VALUES (${project}, ${requestedModel || null}, ${provider || null}, ${providerModel || null}, ${prompt}, ${completion}, ${total}, ${cost}, ${status}, ${statusCode}, ${Math.max(0, Math.round(latencyMs))}, ${streamed})
  `;
}

export async function readUsage({ days = 30, project = null, limit = 100 } = {}) {
  const db = sql();
  if (!db) throw new Error('DATABASE_URL is not configured');
  const safeDays = Math.min(Math.max(Number(days) || 30, 1), 365);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const summary = await db`
    SELECT project, COUNT(*)::int AS requests, COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
      COALESCE(SUM(prompt_tokens), 0)::int AS prompt_tokens, COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
      COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost_usd, ROUND(AVG(latency_ms))::int AS avg_latency_ms,
      COUNT(*) FILTER (WHERE status <> 'success')::int AS errors
    FROM gateway_usage WHERE created_at >= NOW() - (${safeDays} * INTERVAL '1 day') AND (${project} IS NULL OR project = ${project})
    GROUP BY project ORDER BY total_tokens DESC
  `;
  const recent = await db`
    SELECT created_at, project, requested_model, provider, provider_model, prompt_tokens, completion_tokens, total_tokens,
      estimated_cost_usd, status, status_code, latency_ms, streamed
    FROM gateway_usage WHERE created_at >= NOW() - (${safeDays} * INTERVAL '1 day') AND (${project} IS NULL OR project = ${project})
    ORDER BY created_at DESC LIMIT ${safeLimit}
  `;
  return { days: safeDays, summary, recent };
}
