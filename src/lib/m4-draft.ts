import draft from '../content/m4-draft.json';
import { APP_ENV } from '../config/flags';
// This design reproduction is authorized exclusively for local editorial review.
// It must never become a production fallback for approved facts or CMS content.
export function draftCopy(block: keyof typeof draft.blocks): Record<string, string> {
  if (APP_ENV !== 'local' || draft.status !== 'draft') {
    throw new Error('La reproducción M4 con copy en revisión solo está disponible en local.');
  }
  return draft.blocks[block];
}
