import db from "@/lib/db";
import { currentUser } from "@/lib/auth";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { enabled, walletAddress } = (await req.json().catch(() => ({}))) as {
    enabled?: boolean;
    walletAddress?: string;
  };

  if (enabled) {
    if (typeof walletAddress !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return Response.json(
        { error: "Enter a valid Arc wallet address (0x + 40 hex characters)." },
        { status: 400 }
      );
    }
    db.prepare("UPDATE users SET payg_enabled = 1, wallet_address = ? WHERE id = ?").run(
      walletAddress,
      user.id
    );
  } else {
    db.prepare("UPDATE users SET payg_enabled = 0 WHERE id = ?").run(user.id);
  }
  return Response.json({ ok: true });
}
