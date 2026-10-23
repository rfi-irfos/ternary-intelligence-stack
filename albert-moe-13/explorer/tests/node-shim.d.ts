// Minimal typings for the node built-ins used by the tests (no @types/node dependency).
declare module 'node:fs' {
  export function readFileSync(path: URL | string): { buffer: ArrayBufferLike; byteOffset: number; byteLength: number };
  export function existsSync(path: URL | string): boolean;
}
declare module 'node:child_process' {
  export function spawnSync(
    cmd: string,
    args: string[],
    opts: { encoding: 'utf8' },
  ): { error?: Error; stdout: string; status: number | null };
}
