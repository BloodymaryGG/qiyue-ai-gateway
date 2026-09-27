import { getHeader, sendResponse, toWebRequest } from '../lib/vercel.mjs';

/* Compatibility endpoint copied from the existing Qiyue proxy.
   Keep this until qiyue-web and TodoAI migrate to /v1/chat/completions. */
export default async function handler(req, res) {
  req = await toWebRequest(req);
  const token = process.env.PROXY_TOKEN;
  if (token && getHeader(req, 'x-qiyue-token') !== token) return sendResponse(res, new Response('forbidden', { status: 403 }));
  const app = String(getHeader(req, 'x-ai-app') || '').trim().toLowerCase();
  const appKeys = { qiyue: process.env.QIYUE_GEMINI_API_KEY, todoai: process.env.TODOAI_GEMINI_API_KEY };
  if (app && !Object.prototype.hasOwnProperty.call(appKeys, app)) return sendResponse(res, new Response('unknown app', { status: 400 }));
  if (app && !appKeys[app]) return sendResponse(res, new Response('app key is not configured', { status: 503 }));
  const url = new URL(req.url); const path = url.pathname.replace(/^\/api\/gemini/, '') || '/';
  const headers = {}; const key = appKeys[app];
  if (key) headers['X-goog-api-key'] = key; else if (getHeader(req, 'x-goog-api-key')) headers['X-goog-api-key'] = getHeader(req, 'x-goog-api-key');
  if (getHeader(req, 'content-type')) headers['Content-Type'] = getHeader(req, 'content-type');
  const upstream = await fetch(`https://generativelanguage.googleapis.com${path}${url.search}`, { method: req.method, headers, body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? await req.arrayBuffer() : undefined });
  return sendResponse(res, new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'text/plain', 'Cache-Control': 'no-store' } }));
}

export const config = { runtime: 'nodejs', regions: ['iad1'] };
