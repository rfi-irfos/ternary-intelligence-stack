// Minimal typings for the node built-ins used by the tests (no @types/node dependency).
declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
  export function readFileSync(path: URL | string): { buffer: ArrayBufferLike; byteOffset: number; byteLength: number };
  export function existsSync(path: URL | string): boolean;
  export function readdirSync(path: URL | string): string[];
  export function statSync(path: URL | string): { isDirectory(): boolean };
  export function mkdirSync(path: string): void;
  export function mkdtempSync(prefix: string): string;
  export function writeFileSync(path: string, data: string | { length: number }): void;
}
declare module 'node:child_process' {
  export function spawnSync(
    cmd: string,
    args: string[],
    opts: { encoding: 'utf8' },
  ): { error?: Error; stdout: string; status: number | null };
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:path' {
  export function join(...p: string[]): string;
}
