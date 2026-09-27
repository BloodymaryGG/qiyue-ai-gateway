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
  return json({ ok: true, gateway: 'qiyue-ai-gateway', providers: configuredProviders(), timestamp: new Date().toISOString() });
}
