import { defineMiddleware } from 'astro:middleware';
import { onRequest as cmsMiddleware } from 'emdash/internal/middleware/setup';
import { isCmsPath } from '../scope.ts';
export const onRequest = defineMiddleware((context, next) =>
  isCmsPath(context.url.pathname) ? cmsMiddleware(context, next) : next(),
);
