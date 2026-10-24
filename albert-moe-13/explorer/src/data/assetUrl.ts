/** The one place that builds URLs of shipped files (data, assets), so a non-root Vite base works. */
export function assetUrl(path: string, base: string = import.meta.env?.BASE_URL ?? '/'): string {
  const b = base.endsWith('/') ? base : `${base}/`;
  return `${b}${path.replace(/^\/+/, '')}`;
}
