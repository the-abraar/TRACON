import { closeSync, fstatSync, openSync, readSync, watch, type FSWatcher } from "node:fs";

/** Reads only the bytes appended since the last call. Opens files read-only and closes them at once (no locks). */
export class Tailer {
  private pos = new Map<string, number>();

  has(path: string): boolean {
    return this.pos.has(path);
  }

  forget(path: string): void {
    this.pos.delete(path);
  }

  read(path: string): string[] {
    let fd: number;
    try {
      fd = openSync(path, "r");
    } catch {
      return [];
    }
    try {
      const size = fstatSync(fd).size;
      let offset = this.pos.get(path) ?? 0;
      if (size < offset) offset = 0; // truncated or replaced
      this.pos.set(path, offset);
      if (size === offset) return [];
      const buf = Buffer.alloc(size - offset);
      const n = readSync(fd, buf, 0, buf.length, offset);
      // stop at the last newline so a half-written line (or UTF-8 char) is read whole next time
      const end = buf.lastIndexOf(10, n - 1);
      if (end < 0) return [];
      this.pos.set(path, offset + end + 1);
      return buf.toString("utf8", 0, end).split("\n").filter(Boolean);
    } finally {
      closeSync(fd);
    }
  }
}

/** fs.watch is FSEvents-backed on macOS (inotify on Linux). Missing dirs are skipped. */
export function watchDirs(dirs: string[], onChange: () => void): FSWatcher[] {
  const watchers: FSWatcher[] = [];
  for (const d of dirs) {
    try {
      watchers.push(watch(d, { recursive: true, persistent: false }, () => onChange()).on("error", () => {}));
    } catch {
      /* dir vanished or unsupported: the poll in server.ts still covers it */
    }
  }
  return watchers;
}
