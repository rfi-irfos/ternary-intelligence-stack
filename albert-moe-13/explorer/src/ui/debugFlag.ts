/** The `?debug=1` switch of the performance overlay. Kept apart from the overlay so main.ts can test it without loading the overlay. */
export const DEBUG_PARAM = 'debug';

/** True for a query string that contains `debug=1` (nothing else counts). */
export function debugRequested(search: string): boolean {
  return new URLSearchParams(search).get(DEBUG_PARAM) === '1';
}
