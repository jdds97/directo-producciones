import { readFileSync } from 'node:fs';
import { createServer, request as requestHttp } from 'node:http';
import { siteLinks } from '../src/lib/site-navigation.ts';

const GATEWAY_HOST = '127.0.0.1';
const GATEWAY_PORT = 4396;
const UPSTREAM_HOST = '127.0.0.1';
const UPSTREAM_PORT = 4394;
const UPSTREAM_ORIGIN = 'http://localhost:4394';
const COMMON_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
});
const ASTRO_STATIC_EXTENSIONS = new Set([
  'css', 'gif', 'ico', 'jpeg', 'jpg', 'js', 'mjs', 'otf', 'png', 'svg',
  'ttf', 'avif', 'webm', 'webp', 'woff', 'woff2', 'mp4',
]);

function isSafePath(path) {
  if (typeof path !== 'string' || path.length > 2048 || !path.startsWith('/') ||
      path.startsWith('//') || path.includes('//') || /[%?#\\\u0000-\u0020\u007f]/.test(path) ||
      !/^\/[A-Za-z0-9._/-]*$/.test(path)) return false;
  let segmentStart = 1;
  for (let index = 1; index <= path.length; index++) {
    if (index < path.length && path.charCodeAt(index) !== 47) continue;
    if (path.charCodeAt(segmentStart) === 46) return false;
    segmentStart = index + 1;
  }
  return true;
}

const pagePaths = new Set(['/preguntas-frecuentes/', '/cookies/', '/privacidad/', '/aviso-legal/', '/condiciones/']);
function addPagePath(path) {
  if (!isSafePath(path)) throw new Error(`Ruta de navegación insegura: ${path}`);
  pagePaths.add(path);
}
for (const link of siteLinks) {
  addPagePath(link.href);
  for (const relatedPath of link.relatedPaths ?? []) addPagePath(relatedPath);
}

const assetRegistry = JSON.parse(readFileSync(new URL('../config/m4-assets.json', import.meta.url), 'utf8'));
if (!assetRegistry || typeof assetRegistry !== 'object' || Array.isArray(assetRegistry)) {
  throw new Error('El registro de assets M4 no tiene el formato esperado.');
}
const registeredAssets = new Set(Object.keys(assetRegistry));
for (const assetPath of registeredAssets) {
  if (!assetPath.startsWith('/assets/m4/') || !isSafePath(assetPath)) {
    throw new Error(`Ruta de asset fuera del registro M4 permitido: ${assetPath}`);
  }
}

function isAstroStaticAsset(path) {
  if (!path.startsWith('/_astro/')) return false;
  const relativePath = path.slice('/_astro/'.length);
  if (!relativePath || relativePath.endsWith('/')) return false;
  const extension = relativePath.slice(relativePath.lastIndexOf('.') + 1).toLowerCase();
  return ASTRO_STATIC_EXTENSIONS.has(extension);
}

function isAllowedPath(path) {
  if (pagePaths.has(path) || registeredAssets.has(path) || isAstroStaticAsset(path)) return true;
  return /^\/blog\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\/+$/.test(path);
}

function sendText(response, status, message, extraHeaders = {}) {
  const body = `${message}\n`;
  response.writeHead(status, {
    ...COMMON_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  response.end(body);
}

function safeRedirect(location) {
  if (typeof location !== 'string' || location.length > 2048 || /[\u0000-\u001f\u007f]/.test(location)) return null;
  try {
    const destination = new URL(location, UPSTREAM_ORIGIN);
    if (destination.origin !== UPSTREAM_ORIGIN || destination.search ||
        !isSafePath(destination.pathname) || !isAllowedPath(destination.pathname)) return null;
    return destination.pathname;
  } catch {
    return null;
  }
}

function publicHeaders(upstreamHeaders, method) {
  const headers = { ...COMMON_HEADERS };
  for (const name of [
    'content-type', 'content-length', 'content-range', 'accept-ranges',
    'content-encoding', 'content-security-policy',
  ]) {
    const value = upstreamHeaders[name];
    if (typeof value === 'string') headers[name] = value;
  }
  if (method === 'HEAD' && headers['content-length'] === undefined) headers['content-length'] = '0';
  return headers;
}

const server = createServer((request, response) => {
  request.resume();
  const path = request.url;
  if (!isSafePath(path) || !isAllowedPath(path)) {
    sendText(response, 404, 'No encontrado');
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, 405, 'Método no permitido', { Allow: 'GET, HEAD' });
    return;
  }
  if ((request.headers['content-length'] && request.headers['content-length'] !== '0') || request.headers['transfer-encoding']) {
    sendText(response, 400, 'Solicitud no permitida');
    return;
  }

  const range = request.headers.range;
  if (range && (!registeredAssets.has(path) && !isAstroStaticAsset(path) ||
      range.length > 128 || !/^bytes=(?:\d+-\d*|-\d+)$/i.test(range))) {
    sendText(response, 400, 'Rango no permitido');
    return;
  }

  // Build upstream headers from scratch: never forward caller cookies, credentials,
  // Host, Origin, Forwarded, or X-Forwarded-* values to the local app gate.
  const upstreamHeaders = {
    host: 'localhost:4394',
    accept: '*/*',
    'accept-encoding': 'identity',
  };
  if (range) upstreamHeaders.range = range;

  const upstream = requestHttp({
    hostname: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    method: request.method,
    path,
    headers: upstreamHeaders,
  }, upstreamResponse => {
    const status = upstreamResponse.statusCode ?? 502;
    const headers = publicHeaders(upstreamResponse.headers, request.method);
    if (status >= 500) {
      upstreamResponse.resume();
      sendText(response, 502, 'Servicio local no disponible');
      return;
    }
    if (status >= 300 && status < 400 && upstreamResponse.headers.location) {
      const location = safeRedirect(upstreamResponse.headers.location);
      if (!location) {
        upstreamResponse.resume();
        sendText(response, 404, 'No encontrado');
        return;
      }
      headers.Location = location;
    }
    response.writeHead(status, headers);
    if (request.method === 'HEAD') {
      upstreamResponse.resume();
      response.end();
      return;
    }
    upstreamResponse.on('error', () => response.destroy());
    upstreamResponse.pipe(response);
  });

  upstream.on('error', () => {
    if (!response.headersSent) sendText(response, 502, 'Servicio local no disponible');
    else response.destroy();
  });
  request.once('aborted', () => upstream.destroy());
  response.once('close', () => {
    if (!response.writableEnded) upstream.destroy();
  });
  upstream.end();
});

server.on('connect', (_request, socket) => {
  socket.end('HTTP/1.1 405 Method Not Allowed\r\nAllow: GET, HEAD\r\nCache-Control: no-store\r\nX-Robots-Tag: noindex, nofollow\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
});

server.listen(GATEWAY_PORT, GATEWAY_HOST, () => {
  console.log(`Gateway de revisión limitado en http://${GATEWAY_HOST}:${GATEWAY_PORT} → http://${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
});
