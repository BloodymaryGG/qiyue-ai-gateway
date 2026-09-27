import { authenticate, corsHeaders, json, methodNotAllowed, unauthorized } from '../../../lib/auth.mjs';
import { createCompletion, GatewayError, resolveModels } from '../../../lib/providers.mjs';
import { recordUsage } from '../../../lib/usage.mjs';
import { waitUntil } from '@vercel/functions';
import { sendResponse, toWebRequest } from '../../../lib/vercel.mjs';

export default async function handler(req, res) {
  req = await toWebRequest(req);
  const response = await handle(req);
  return sendResponse(res, response);
}

async function handle(req) {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return methodNotAllowed();
  const identity = authenticate(req);
  if (!identity) return unauthorized();
  const startedAt = Date.now();

  try {
    const body = await req.json();
    if (!Array.isArray(body?.messages) || body.messages.length === 0) return json({ error: { message: 'messages is required', type: 'invalid_request_error', code: 'invalid_messages' } }, 400);
    const candidates = resolveModels(body.model, identity.project);
    if (!candidates.length) return json({ error: { message: `unsupported model: ${body.model}`, type: 'invalid_request_error', code: 'unsupported_model' } }, 400);
    let result = null;
    let lastGatewayError = null;
    for (const selected of candidates) {
      try {
        const candidate = await createCompletion({
          requested: selected.requested,
          provider: selected.provider,
          model: selected.model,
          messages: body.messages,
          temperature: typeof body.temperature === 'number' ? body.temperature : 0.4,
          maxTokens: Number.isInteger(body.max_tokens) ? body.max_tokens : 2048,
          stream: Boolean(body.stream),
          responseFormat: body.response_format,
        });
        result = candidate;
        if (candidate.upstream.ok || !shouldFailover(candidate.upstream.status) || selected === candidates[candidates.length - 1]) break;
        await candidate.upstream.text().catch(() => '');
      } catch (error) {
        lastGatewayError = error;
        if (!(error instanceof GatewayError) || selected === candidates[candidates.length - 1]) throw error;
      }
    }
    if (!result) throw lastGatewayError || new GatewayError('no provider available', 503, 'provider_not_configured');
    if (!result.upstream.ok) {
      const response = await providerError(result.upstream);
      saveUsage({ project: identity.project, requestedModel: result.requested, provider: result.provider, providerModel: result.model, status: 'provider_error', statusCode: response.status, latencyMs: Date.now() - startedAt, streamed: Boolean(body.stream) });
      return response;
    }
    if (body.stream) return streamResponse(result, identity.project, startedAt);
    const data = await result.upstream.json();
    const usage = data?.usage || data?.usageMetadata || {};
    saveUsage({ project: identity.project, requestedModel: result.requested, provider: result.provider, providerModel: result.model, promptTokens: usage.prompt_tokens || usage.promptTokenCount, completionTokens: usage.completion_tokens || usage.candidatesTokenCount, totalTokens: usage.total_tokens || usage.totalTokenCount, latencyMs: Date.now() - startedAt });
    return new Response(JSON.stringify(normalizeResponse(data, result)), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders() } });
  } catch (error) {
    if (error instanceof GatewayError) return json({ error: { message: error.message, type: 'gateway_error', code: error.code } }, error.status);
    console.warn('[gateway] request failed', error?.message || error);
    return json({ error: { message: 'gateway request failed', type: 'gateway_error', code: 'gateway_request_failed' } }, 502);
  }
}

function shouldFailover(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function saveUsage(payload) {
  waitUntil(recordUsage(payload).catch((error) => console.error('[usage] write failed', error?.message || error)));
}

async function providerError(upstream) {
  const detail = await upstream.text().catch(() => '');
  return json({ error: { message: 'upstream provider request failed', type: 'provider_error', code: `upstream_${upstream.status}`, status: upstream.status, detail: detail.slice(0, 500) } }, upstream.status >= 500 ? 502 : upstream.status);
}

function normalizeResponse(data, result) {
  if (data?.choices) return { ...data, model: result.requested || result.model };
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  return { id: `qy-${Date.now()}`, object: 'chat.completion', model: result.requested || result.model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: data?.candidates?.[0]?.finishReason?.toLowerCase() || 'stop' }], usage: data?.usageMetadata ? { prompt_tokens: data.usageMetadata.promptTokenCount || 0, completion_tokens: data.usageMetadata.candidatesTokenCount || 0, total_tokens: data.usageMetadata.totalTokenCount || 0 } : undefined };
}

function streamResponse(result, project, startedAt) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = result.upstream.body.getReader();
  let buffer = '';
  let usage = {};
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (payload) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      try {
        emit({ id: `qy-${Date.now()}`, object: 'chat.completion.chunk', model: result.model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim(); if (!raw || raw === '[DONE]') continue;
            const data = JSON.parse(raw);
            if (data.usage) usage = data.usage;
            const text = result.provider === 'gemini' ? data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '' : data.choices?.[0]?.delta?.content || '';
            const finish = result.provider === 'gemini' ? data.candidates?.[0]?.finishReason?.toLowerCase() || null : data.choices?.[0]?.finish_reason || null;
            if (text || finish) emit({ id: `qy-${Date.now()}`, object: 'chat.completion.chunk', model: result.model, choices: [{ index: 0, delta: text ? { content: text } : {}, finish_reason: finish }] });
          }
        }
        saveUsage({ project, requestedModel: result.requested, provider: result.provider, providerModel: result.model, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens, latencyMs: Date.now() - startedAt, streamed: true });
        controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close();
      } catch (error) {
        saveUsage({ project, requestedModel: result.requested, provider: result.provider, providerModel: result.model, status: 'stream_error', statusCode: 502, latencyMs: Date.now() - startedAt, streamed: true });
        controller.error(error);
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Qiyue-Project': project, ...corsHeaders() } });
}
