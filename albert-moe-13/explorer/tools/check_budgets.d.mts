export const BUDGETS: { initialGzip: number; totalDist: number; glb: number };
export function initialAssets(html: string): string[];
export interface Check { name: string; value: number; limit: number; ok: boolean }
export function evaluate(
  m: { initial: number; total: number; glbs: { path: string; bytes: number }[] },
  budgets?: { initialGzip: number; totalDist: number; glb: number },
): { checks: Check[]; ok: boolean };
export function report(r: { checks: Check[]; ok: boolean }): string;
export function measure(dist: string): { initial: number; total: number; glbs: { path: string; bytes: number }[]; initialFiles: string[] };
