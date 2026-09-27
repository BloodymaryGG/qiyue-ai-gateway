import { authenticate, json, methodNotAllowed, unauthorized } from '../../lib/auth.mjs';
import { configuredProviders } from '../../lib/providers.mjs';

export default function handler(req) {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'GET') return methodNotAllowed();
  if (!authenticate(req)) return unauthorized();
  return json({ ok: true, gateway: 'qiyue-ai-gateway', providers: configuredProviders(), timestamp: new Date().toISOString() });
}
