import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

if (existsSync('.env')) process.loadEnvFile('.env');
const root = resolve(process.env.CONTENT_REGISTRY_DIR || 'content');
const facts = parse(readFileSync(resolve(root, 'facts.yaml'), 'utf8'));
const approvers = parse(readFileSync(resolve(root, 'approvers.yaml'), 'utf8'));
const editorialReview = JSON.parse(readFileSync('config/editorial-review.json', 'utf8'));
mkdirSync('.emdash', { recursive: true });
writeFileSync('.emdash/content-registry.json', JSON.stringify({ facts, approvers, editorialReview }));
