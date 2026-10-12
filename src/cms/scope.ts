export function isCmsPath(path: string): boolean {
  return path === '/interno/m3/blog' || path.startsWith('/interno/m3/blog/') || path === '/blog' || path.startsWith('/blog/') || path === '/_emdash' || path.startsWith('/_emdash/');
}
