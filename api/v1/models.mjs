import { authenticate, json, methodNotAllowed, unauthorized } from '../../lib/auth.mjs';
import { configuredProviders } from '../../lib/providers.mjs';
import { sendResponse, toWebRequest } from '../../lib/vercel.mjs';

export default async function handler(req, res) {
  req = await toWebRequest(req);
  return sendResponse(res, handle(req));
}

function handle(req) {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'GET') return methodNotAllowed();
  if (!authenticate(req)) return unauthorized();
  const configured = configuredProviders();
  const data = [
    ['qy-fast', 'general'], ['qy-smart', 'general'],
    ...(configured.gemini ? [['qy-gemini', 'gemini']] : []),
    ...(configured.qwen ? [['qy-qwen', 'qwen']] : []),
    ...(configured.deepseek ? [['qy-deepseek', 'deepseek']] : []),
  ].map(([id, owned_by]) => ({ id, object: 'model', owned_by }));
  return json({ object: 'list', data });
}
