import crypto from "crypto";
import path from "path";
import { readJson, writeJson } from "./jsonFile";

export type Role = "admin" | "member";

export type User = {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
};

export type PublicUser = Omit<User, "passwordHash">;

type SessionRecord = {
  id: string;
  userId: string;
  expiresAt: string;
};

const DATA_DIR = path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (check.length !== expected.length) return false;
  return crypto.timingSafeEqual(check, expected);
}

function stripHash(user: User): PublicUser {
  const { passwordHash: _unused, ...rest } = user;
  void _unused;
  return rest;
}

async function readUsers(): Promise<User[]> {
  const users = await readJson<User[]>(USERS_FILE, []);
  if (users.length > 0) return users;

  // Bootstrap: create the first admin account so the app is never
  // permanently locked out. Prefer explicit env credentials; otherwise
  // generate a random password and log it once.
  const bootstrapUser = process.env.BOOTSTRAP_ADMIN_USER?.trim() || "admin";
  const generated = !process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const bootstrapPass = process.env.BOOTSTRAP_ADMIN_PASSWORD || crypto.randomBytes(6).toString("hex");
  const admin: User = {
    id: crypto.randomUUID(),
    username: bootstrapUser,
    passwordHash: hashPassword(bootstrapPass),
    role: "admin",
    createdAt: new Date().toISOString(),
  };
  await writeJson(USERS_FILE, [admin]);
  if (generated) {
    // eslint-disable-next-line no-console
    console.warn(
      `[board] Compte admin créé automatiquement — identifiant: "${bootstrapUser}" / mot de passe: "${bootstrapPass}". ` +
        `Connecte-toi puis change-le, ou définis BOOTSTRAP_ADMIN_PASSWORD dans .env.local.`
    );
  }
  return [admin];
}

async function saveUsers(users: User[]): Promise<void> {
  await writeJson(USERS_FILE, users);
}

async function readSessions(): Promise<SessionRecord[]> {
  return readJson<SessionRecord[]>(SESSIONS_FILE, []);
}

async function saveSessions(sessions: SessionRecord[]): Promise<void> {
  await writeJson(SESSIONS_FILE, sessions);
}

export async function login(
  username: string,
  password: string
): Promise<{ token: string; user: PublicUser } | null> {
  const users = await readUsers();
  const user = users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) return null;

  const token = crypto.randomBytes(32).toString("hex");
  const sessions = await readSessions();
  sessions.push({
    id: token,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  });
  await saveSessions(sessions);
  return { token, user: stripHash(user) };
}

export async function logout(token: string): Promise<void> {
  const sessions = await readSessions();
  await saveSessions(sessions.filter((s) => s.id !== token));
}

export async function getSession(
  token: string | undefined
): Promise<{ userId: string; username: string; role: Role } | null> {
  if (!token) return null;
  const sessions = await readSessions();
  const session = sessions.find((s) => s.id === token);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;

  const users = await readUsers();
  const user = users.find((u) => u.id === session.userId);
  if (!user) return null;
  return { userId: user.id, username: user.username, role: user.role };
}

export async function listUsers(): Promise<PublicUser[]> {
  const users = await readUsers();
  return users.map(stripHash);
}

export async function createUser(username: string, password: string, role: Role): Promise<PublicUser> {
  const users = await readUsers();
  const clean = username.trim();
  if (!clean) throw new Error("Identifiant requis.");
  if (users.some((u) => u.username.toLowerCase() === clean.toLowerCase())) {
    throw new Error("Ce nom d'utilisateur existe déjà.");
  }
  const user: User = {
    id: crypto.randomUUID(),
    username: clean,
    passwordHash: hashPassword(password),
    role,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  await saveUsers(users);
  return stripHash(user);
}

export async function deleteUser(id: string): Promise<void> {
  const users = await readUsers();
  await saveUsers(users.filter((u) => u.id !== id));
}
