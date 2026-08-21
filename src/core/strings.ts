// String keys from day one (CLAUDE.md): every player-facing sentence lives
// in src/data/strings.<lang>.json and is looked up here. A missing key
// returns the key itself — visible in play, greppable, never a crash.
import en from '../data/strings.en.json';

const TABLE: Record<string, string> = en;

export function str(key: string, vars?: Record<string, string | number>): string {
  let s = TABLE[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  }
  return s;
}
