/**
 * Серверный прокси денежного API Strapi.
 *
 * Браузер → /api/wallet/<путь> → Strapi /api/wallets/<путь>.
 * JWT пользователя проверяется в Strapi; в ответ 401 добавляется понятное
 * сообщение. Вся денежная логика и защита от двойного списания — на бэкенде.
 *
 * Разрешены только известные операции (whitelist) и тела до MAX_BODY_BYTES.
 */

import { NextRequest, NextResponse } from 'next/server';

const STRAPI_URL =
  process.env.STRAPI_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_STRAPI_URL ||
  'http://127.0.0.1:1337';

const MAX_BODY_BYTES = 8 * 1024;

/** Разрешённые операции: метод + сегменты пути после /wallets. */
const ALLOWED_ROUTES: Record<string, readonly string[]> = {
  GET: ['me', 'library'],
  POST: ['deposit', 'withdraw', 'purchase', 'reverse'],
};

type Ctx = { params: Promise<{ path?: string[] }> };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: { message, status } }, { status });
}

function getToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return req.cookies.get('jwt')?.value ?? null;
}

/**
 * Убирает повторный префикс и проверяет путь по whitelist.
 * Допускается необязательный префикс ресурса: /api/wallet/wallets/deposit.
 */
function resolvePath(method: string, segments: string[]): string[] | null {
  const path = segments[0] === 'wallets' ? segments.slice(1) : segments;
  return path.length ? path : null;
}

function isAllowed(method: string, path: string[]): boolean {
  const allowed = ALLOWED_ROUTES[method];
  if (!allowed || path.length !== 1) return false;
  return allowed.includes(path[0]);
}

async function proxy(req: NextRequest, ctx: Ctx) {
  const method = req.method.toUpperCase();
  const { path = [] } = await ctx.params;

  const resourcePath = resolvePath(method, path);
  if (!resourcePath) return errorResponse('Операция не поддерживается', 404);
  if (!isAllowed(method, resourcePath)) return errorResponse('Операция не поддерживается', 403);

  const token = getToken(req);
  if (!token) return errorResponse('Требуется авторизация', 401);

  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const declared = Number(req.headers.get('content-length') || 0);
    if (declared > MAX_BODY_BYTES) return errorResponse('Слишком большой запрос', 413);

    body = await req.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return errorResponse('Слишком большой запрос', 413);
    }
  }

  const target = `${STRAPI_URL}/api/wallets/${resourcePath.join('/')}`;

  try {
    const res = await fetch(target, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body || undefined,
      cache: 'no-store',
    });

    if (res.status === 401) return errorResponse('Сессия истекла, войдите заново', 401);

    const json = await res.json().catch(() => null);
    if (json === null) return errorResponse('Некорректный ответ сервера', 502);

    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    console.error('[wallet-proxy]', err);
    return errorResponse('Сервис временно недоступен, повторите позже', 502);
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx);
}
