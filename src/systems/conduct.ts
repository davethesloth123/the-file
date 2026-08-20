// THE conduct table — the single source of suspicion (bible §5.1, pillar I).
// One exported function: world state in, the active conduct out, or null.
// Rules come from src/data/conduct.json, are evaluated in array order, and
// the FIRST match wins and reports its own label — only one conduct is ever
// active, because the player can only be told one thing at once.
//
// Presence is free. Walking, standing (under the loitering threshold),
// simply being seen — none of it matches a rule, so none of it is priced.
import conductJson from '../data/conduct.json';

interface RuleDef {
  id: string;
  rate: number;
  label: string;
  after?: number;
}

const RULES = (conductJson as { rules: RuleDef[] }).rules;
export const MULTIPLIERS = (conductJson as { multipliers: Record<string, number> }).multipliers;

export interface ConductState {
  /** hold-to-act on a drop is in progress */
  servicing: boolean;
  talkingToFlagged: boolean;
  afterCurfew: boolean;
  /** inside a restricted zone: its label, else null */
  restrictedLabel: string | null;
  hurrying: boolean;
  moving: boolean;
  /** seconds since the player last moved */
  stillSeconds: number;
  /** queues and benches exempt the loitering rule */
  atBench: boolean;
  offDistrict: boolean;
}

export interface ActiveConduct {
  id: string;
  rate: number;
  label: string;
}

const PREDICATES: Record<string, (s: ConductState, rule: RuleDef) => boolean> = {
  service: (s) => s.servicing,
  flagged: (s) => s.talkingToFlagged,
  curfew: (s) => s.afterCurfew,
  threshold: (s) => s.restrictedLabel !== null,
  running: (s) => s.hurrying && s.moving,
  offDistrict: (s) => s.offDistrict,
  loitering: (s, rule) => !s.atBench && s.stillSeconds > (rule.after ?? Infinity),
};

export function evaluateConduct(s: ConductState): ActiveConduct | null {
  for (const rule of RULES) {
    const predicate = PREDICATES[rule.id];
    if (predicate && predicate(s, rule)) {
      return {
        id: rule.id,
        rate: rule.rate,
        label: rule.label.replace('{place}', s.restrictedLabel ?? ''),
      };
    }
  }
  return null;
}
