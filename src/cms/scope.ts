export function isCmsPath(path: string): boolean {
  return path === '/blog' || path.startsWith('/blog/') || path === '/_emdash' || path.startsWith('/_emdash/');
}
