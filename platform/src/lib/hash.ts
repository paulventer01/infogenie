import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "../config/env.js";

/** Normalise then one-way hash a contact address for suppression matching. */
export function addressHash(raw: string): string {
  const normalised = raw.trim().toLowerCase();
  return createHash("sha256").update(`${config.hashPepper}:${normalised}`).digest("hex");
}

/** Hash an opaque token (session/service credential) for at-rest storage. */
export function tokenHash(token: string): string {
  return createHash("sha256").update(`${config.hashPepper}:${token}`).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Password hashing with scrypt. Format: scrypt$<saltHex>$<hashHex>. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  const derived = scryptSync(password, salt, expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
