import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { enabled, walletAddress } = (await req.json().catch(() => ({}))) as {
    enabled?: boolean;
    walletAddress?: string;
  };

  if (enabled) {
    if (!user.wallet_address) {
      return Response.json(
        { error: "Connect your SubScript wallet by completing a checkout first." },
        { status: 400 }
      );
    }
    await q("UPDATE users SET payg_enabled = 1 WHERE id = $1", [user.id]);
  } else {
    await q("UPDATE users SET payg_enabled = 0 WHERE id = $1", [user.id]);
  }
  return Response.json({ ok: true });
}
