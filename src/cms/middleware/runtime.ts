import { defineMiddleware } from 'astro:middleware';
import { onRequest as cmsMiddleware } from 'emdash/middleware';
import { isCmsPath, isContentPath } from '../scope.ts';
export const onRequest = defineMiddleware((context, next) =>
  isCmsPath(context.url.pathname) || isContentPath(context.url.pathname) ? cmsMiddleware(context, next) : next(),
);
