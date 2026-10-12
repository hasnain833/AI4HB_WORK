import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import type { Person } from "./work";

// Session = "<userId>.<expiresAtMs>.<hmac>" in an httpOnly cookie.
export const SESSION_COOKIE = "aw_session";
const MAX_AGE_S = 60 * 60 * 24 * 7;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET is missing or too short (see .env.example)");
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export async function createSession(userId: string) {
  const payload = `${userId}.${Date.now() + MAX_AGE_S * 1000}`;
  (await cookies()).set(SESSION_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<Person | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const [userId, exp, mac] = raw.split(".");
  if (!userId || !exp || !mac) return null;
  const expected = Buffer.from(sign(`${userId}.${exp}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(exp) < Date.now()) return null;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } });
  return u;
}

export async function requireUser(): Promise<Person> {
  const u = await getSessionUser();
  if (!u) throw new Error("Not signed in");
  return u;
}
