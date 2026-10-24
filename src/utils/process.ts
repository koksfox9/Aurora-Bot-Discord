import { spawn, type ChildProcess, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

export interface RunResult {
  stdout: string;
  stderr: string;
}

export type SpawnedProcess = ChildProcessByStdio<Writable | null, Readable, Readable>;

export function spawnProcess(command: string, args: string[], timeoutMs?: number, pipeInput = false): SpawnedProcess {
  const child = spawn(command, args, {
    windowsHide: true,
    stdio: [pipeInput ? "pipe" : "ignore", "pipe", "pipe"]
  }) as SpawnedProcess;

  if (timeoutMs) {
    const timer = setTimeout(() => {
      terminateProcessTree(child);
    }, timeoutMs);
    child.once("close", () => clearTimeout(timer));
  }

  return child;
}

export async function runBuffered(command: string, args: string[], timeoutMs = 30000): Promise<RunResult> {
  const child = spawnProcess(command, args);
  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      terminateProcessTree(child);
      finish(() => reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)} seconds.`)));
    }, timeoutMs);

    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => {
      finish(() => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`${command} exited with ${code}: ${stderr || stdout}`));
        }
      });
    });
  });
}

function terminateProcessTree(child: ChildProcess) {
  if (child.exitCode !== null || child.killed) return;
  if (process.platform !== "win32" || !child.pid) {
    child.kill("SIGKILL");
    return;
  }

  const taskkill = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore"
  });
  taskkill.once("error", () => child.kill("SIGKILL"));
}
