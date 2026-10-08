import type { PortableTextBlock } from 'emdash';
export interface BlogPost {
  title: string;
  excerpt?: string;
  author?: string;
  content: PortableTextBlock[];
  synthetic?: boolean;
}
