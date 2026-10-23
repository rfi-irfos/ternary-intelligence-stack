// Minimal typings for the two node built-ins used by tests/modules.test.ts (no @types/node dependency).
declare module 'node:fs' {
  export function readFileSync(path: URL | string): { buffer: ArrayBufferLike; byteOffset: number; byteLength: number };
}
declare module 'node:child_process' {
  export function spawnSync(
    cmd: string,
    args: string[],
    opts: { encoding: 'utf8' },
  ): { error?: Error; stdout: string; status: number | null };
}
