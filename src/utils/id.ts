import crypto from "node:crypto";

export function stableId(input: string, prefix = "id") {
  return `${prefix}_${crypto.createHash("sha1").update(input).digest("hex").slice(0, 16)}`;
}

export function nonce(prefix = "n") {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}
