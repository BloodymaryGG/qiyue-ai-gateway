import { Readable } from 'node:stream';

export function getHeader(req, name) {
  if (req?.headers?.get) return req.headers.get(name) || '';
  const value = req?.headers?.[name.toLowerCase()] ?? req?.headers?.[name];
  return Array.isArray(value) ? value.join(', ') : String(value || '');
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function toWebRequest(req) {
  if (req?.headers?.get && typeof req.json === 'function') return req;
  const protocol = getHeader(req, 'x-forwarded-proto') || 'https';
  const host = getHeader(req, 'host') || 'localhost';
  const url = new URL(req.url || '/', `${protocol}://${host}`).toString();
  const headers = new Headers(req.headers || {});
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
  return new Request(url, { method: req.method, headers, body, duplex: 'half' });
}

export async function sendResponse(res, response) {
  if (!res) return response;
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) return res.end();
  Readable.fromWeb(response.body).pipe(res);
}
