import crypto from "crypto";
import path from "path";
import { readJson, writeJson } from "./jsonFile";

// Stored value stays "member" for backward compatibility with existing
// users.json data (no migration needed) -- the UI labels it "Participant".
// Capability tiers: admin (everything, always) > manager (can archive
// projects, moderate/delete any comment, and add participants -- all
// scoped to the projects they themselves can access) > member/"Participant"
// (create cards, comment, reply, delete their own comments).
export type Role = "admin" | "manager" | "member";

export type User = {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
  // Uploaded via /api/upload, then stored here through PATCH /api/auth/me.
  // Undefined -- initials avatar, same as before this feature existed.
  avatarUrl?: string;
  // Which projects this member can see. Undefined means unrestricted (every
  // project) -- both the pre-this-feature default for existing accounts and
  // the default for a freshly created one, so nobody gets silently locked
  // out on deploy or at signup. An admin narrows it via
  // PATCH /api/users/[id]. Ignored entirely for role "admin", who always
  // sees every project regardless of what's stored here.
  projectIds?: string[];
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
): Promise<{ userId: string; username: string; role: Role; projectIds?: string[]; avatarUrl?: string } | null> {
  if (!token) return null;
  const sessions = await readSessions();
  const session = sessions.find((s) => s.id === token);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;

  const users = await readUsers();
  const user = users.find((u) => u.id === session.userId);
  if (!user) return null;
  return {
    userId: user.id,
    username: user.username,
    role: user.role,
    projectIds: user.projectIds,
    avatarUrl: user.avatarUrl,
  };
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

// undefined clears the restriction entirely (back to "sees every project");
// an empty array is a deliberate, different state -- "no projects yet".
export async function updateUserProjects(id: string, projectIds: string[] | undefined): Promise<PublicUser> {
  const users = await readUsers();
  const user = users.find((u) => u.id === id);
  if (!user) throw new Error("Utilisateur introuvable.");
  user.projectIds = projectIds;
  await saveUsers(users);
  return stripHash(user);
}

export async function updateUserAvatar(id: string, avatarUrl: string | undefined): Promise<PublicUser> {
  const users = await readUsers();
  const user = users.find((u) => u.id === id);
  if (!user) throw new Error("Utilisateur introuvable.");
  user.avatarUrl = avatarUrl;
  await saveUsers(users);
  return stripHash(user);
}

// Admin-only, same as creating/deleting a user -- promoting/demoting is not
// something a manager can do to themselves or anyone else.
export async function updateUserRole(id: string, role: Role): Promise<PublicUser> {
  const users = await readUsers();
  const user = users.find((u) => u.id === id);
  if (!user) throw new Error("Utilisateur introuvable.");
  user.role = role;
  await saveUsers(users);
  return stripHash(user);
}

// Self-service: username and/or password, never role. Changing the
// password requires the current one, same as any normal account-settings
// flow -- otherwise a hijacked session could lock the real owner out by
// swapping the password to something only the attacker knows.
export async function updateOwnProfile(
  userId: string,
  changes: { username?: string; newPassword?: string; currentPassword?: string }
): Promise<PublicUser> {
  const users = await readUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error("Utilisateur introuvable.");

  if (changes.username !== undefined) {
    const clean = changes.username.trim();
    if (!clean) throw new Error("Identifiant requis.");
    if (users.some((u) => u.id !== userId && u.username.toLowerCase() === clean.toLowerCase())) {
      throw new Error("Ce nom d'utilisateur existe déjà.");
    }
    user.username = clean;
  }

  if (changes.newPassword !== undefined) {
    if (!changes.currentPassword || !verifyPassword(changes.currentPassword, user.passwordHash)) {
      throw new Error("Mot de passe actuel incorrect.");
    }
    if (changes.newPassword.length < 8) {
      throw new Error("Mot de passe trop court (8 caractères minimum).");
    }
    user.passwordHash = hashPassword(changes.newPassword);
  }

  await saveUsers(users);
  return stripHash(user);
}
