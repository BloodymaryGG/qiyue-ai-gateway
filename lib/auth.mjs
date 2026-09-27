const PROJECTS = [
  ['qiyue-web', 'GATEWAY_TOKEN_QIYUE_WEB'],
  ['todoai', 'GATEWAY_TOKEN_TODOAI'],
  ['ios', 'GATEWAY_TOKEN_IOS'],
];

export function authenticate(req) {
  const authorization = getHeader(req, 'authorization');
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const token = bearer || getHeader(req, 'x-qiyue-token').trim();
  if (!token) return null;
  for (const [project, envName] of PROJECTS) {
    if (process.env[envName] && process.env[envName] === token) return { project, token };
  }
  return null;
}

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': process.env.GATEWAY_ALLOWED_ORIGIN || 'https://qiyueastro.com',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Qiyue-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(), ...extra } });
}

export function unauthorized() {
  return json({ error: { message: 'invalid or missing gateway token', type: 'authentication_error', code: 'invalid_api_key' } }, 401);
}

export function methodNotAllowed() {
  return json({ error: { message: 'method not allowed', type: 'invalid_request_error', code: 'method_not_allowed' } }, 405);
}
import { getHeader } from './vercel.mjs';
