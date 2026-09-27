import { json, methodNotAllowed } from '../../lib/auth.mjs';
import { readUsage, usageConfigured } from '../../lib/usage.mjs';
import { sendResponse, toWebRequest, getHeader } from '../../lib/vercel.mjs';

function authorized(req) {
  const expected = process.env.GATEWAY_ADMIN_TOKEN;
  const auth = getHeader(req, 'authorization');
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const token = bearer || getHeader(req, 'x-qiyue-admin-token').trim();
  return Boolean(expected && token && token === expected);
}

export default async function handler(req, res) {
  req = await toWebRequest(req);
  const response = await handle(req);
  return sendResponse(res, response);
}

async function handle(req) {
  if (req.method !== 'GET') return methodNotAllowed();
  if (!authorized(req)) return json({ error: { message: 'invalid or missing admin token', code: 'admin_unauthorized' } }, 401);
  if (!usageConfigured()) return json({ error: { message: 'usage database is not configured', code: 'usage_not_configured' } }, 503);
  const url = new URL(req.url);
  try {
    const data = await readUsage({ days: url.searchParams.get('days'), project: url.searchParams.get('project'), limit: url.searchParams.get('limit') });
    return json({ ok: true, ...data });
  } catch (error) {
    console.error('[usage] read failed', error?.message || error);
    return json({ error: { message: 'usage database request failed', code: 'usage_database_error' } }, 500);
  }
}
