import type { PortableTextBlock } from 'emdash';
export interface BlogPost {
  slug: string;
  title: string;
  excerpt?: string;
  content: PortableTextBlock[];
  synthetic?: boolean;
}
