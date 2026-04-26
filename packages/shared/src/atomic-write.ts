import { renameSync, writeFileSync, openSync, fsyncSync, closeSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Write a file atomically: write to a tmp sibling, fsync it, then rename over the target.
 * Prevents the file from being observed half-written if the process crashes mid-write,
 * which is the failure mode that turns a regular `agents.json` write into total data loss.
 */
export function atomicWriteFileSync(targetPath: string, contents: string | Buffer): void {
  const dir = dirname(targetPath);
  const base = basename(targetPath);
  const tmp = join(dir, `.${base}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);

  writeFileSync(tmp, contents);
  // fsync the file so the rename is durable
  const fd = openSync(tmp, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, targetPath);
}
