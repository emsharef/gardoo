import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const SALT_ROUNDS = 10;

function getJwtSecret(): string {
  return process.env.JWT_SECRET || "dev-jwt-secret-do-not-use-in-production";
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hashed: string,
): Promise<boolean> {
  return bcrypt.compare(password, hashed);
}

export function createToken(userId: string): string {
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: "30d" });
}

export function verifyToken(token: string): { userId: string } {
  const payload = jwt.verify(token, getJwtSecret()) as { userId: string };
  return { userId: payload.userId };
}
