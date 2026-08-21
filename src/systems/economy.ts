// Money (bible §5.5) and the transactions behind the three doors (§5.7).
// Every number here comes from data/prices.json. The wallet is the only
// holder of roubles; FileMeter.transact and ConfidenceMeter.spend are the
// only reduction paths for the meters — and only this module's callers may
// invoke them, always as an explicit player choice at a counter.
import prices from '../data/prices.json';

export const PRICES = prices;

export interface Address {
  pos: [number, number];
  label: string;
}

export class Wallet {
  value = prices.start;

  canAfford(amount: number): boolean {
    return this.value >= amount;
  }

  /** Returns false (and takes nothing) when short. */
  pay(amount: number): boolean {
    if (!this.canAfford(amount)) return false;
    this.value -= amount;
    return true;
  }

  earn(amount: number): void {
    this.value += amount;
  }
}

/** Courier pay for pick k: base + k steps of payStep (₽55–85 in data). */
export function courierPay(k: number): number {
  const C = prices.courier;
  const step = ((k % C.paySteps) + C.paySteps) % C.paySteps;
  return C.payBase + step * C.payStep;
}

/** The clerk (door one): money in, file out, confidence untouched. */
export function clerkAvailable(file: number, money: number): 'ok' | 'nothing' | 'poor' {
  if (file < prices.clerk.minFile) return 'nothing';
  if (money < prices.clerk.price) return 'poor';
  return 'ok';
}

/** The station (door two): only once the file is heavy enough to trade on. */
export function stationAvailable(file: number): boolean {
  return file > prices.station.overFile;
}
