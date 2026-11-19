import { defineMiddleware } from 'astro:middleware';
import { onRequest as cmsMiddleware } from 'emdash/internal/middleware/auth';
import { isCmsPath } from '../scope.ts';
import { cmsWriteGuard } from '../write-guard.ts';
// Tras autenticar (locals.user y locals.emdash ya existen), las guardas de slug y de términos del blog.
export const onRequest = defineMiddleware((context, next) =>
  isCmsPath(context.url.pathname) ? cmsMiddleware(context, async (payload) => (await cmsWriteGuard(context)) ?? next(payload)) : next(),
);
