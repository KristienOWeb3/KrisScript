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
    const address = (walletAddress || user.wallet_address || "").trim();
    if (!address) {
      return Response.json(
        { error: "Please enter your SubScript wallet address (0x...) or complete a SubScript checkout first." },
        { status: 400 }
      );
    }
    await q("UPDATE users SET payg_enabled = 1, wallet_address = $1 WHERE id = $2", [
      address,
      user.id,
    ]);
  } else {
    await q("UPDATE users SET payg_enabled = 0 WHERE id = $1", [user.id]);
  }
  return Response.json({ ok: true });
}
