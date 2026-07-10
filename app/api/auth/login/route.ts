import { one } from "@/lib/db";
import { verifyPassword, createSession, type User } from "@/lib/auth";

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || typeof password !== "string") {
    return Response.json({ error: "Email and password are required." }, { status: 400 });
  }
  const user = await one<User>("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }
  await createSession(user.id);
  return Response.json({ ok: true, activated: !!user.activated });
}
