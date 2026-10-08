interface CmsSessionD1Statement {
  bind(...values: unknown[]): CmsSessionD1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface CmsSessionD1Database {
  prepare(query: string): CmsSessionD1Statement;
}

declare module 'cloudflare:workers' {
  export const env: { DB: CmsSessionD1Database };
}
