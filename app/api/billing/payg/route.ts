import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { isWalletAddress, usageTarget } from "@/lib/subscript";

/**
 * Enable or disable metered pay-as-you-chat, and save the identifier it bills
 * against.
 *
 * Accepts either a vault commit id or an on-chain address and files it in the
 * right column. They used to share one, which is what stopped subscriptions
 * reaching the DM flow: this setup asks for a Commit ID, so the column almost
 * always held `cmt_…`, and the subscribe path had no address to send as
 * `subscriber`. Now a commit id and an address can both be on file at once.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { enabled, walletAddress, commitId } = (await req.json().catch(() => ({}))) as {
    enabled?: boolean;
    /** Either form, from the single legacy input. */
    walletAddress?: string;
    commitId?: string;
  };

  /* Route each supplied value by its own shape rather than by which field it
     arrived in, so the legacy single input keeps working either way. */
  const supplied = [walletAddress, commitId].map((v) => (v || "").trim()).filter(Boolean);
  const address = supplied.find((v) => isWalletAddress(v));
  const commit = supplied.find((v) => !isWalletAddress(v));

  if (address || commit) {
    await q(
      `UPDATE users
          SET wallet_address = COALESCE($1::text, wallet_address),
              commit_id = COALESCE($2::text, commit_id)
        WHERE id = $3`,
      [address ?? null, commit ?? null, user.id]
    );
  }

  /* Only touch the toggle when the caller actually stated one. Saving an
     address without an `enabled` flag must not read as "disable". */
  if (typeof enabled !== "boolean") {
    return Response.json({ ok: true, saved: true });
  }

  if (enabled) {
    /* Gate on what report-usage can actually be called with, which is the same
       helper the chat route bills through — so "enabled" here and "billable"
       there cannot disagree. */
    const target = usageTarget({
      commit_id: commit ?? user.commit_id,
      wallet_address: address ?? user.wallet_address,
    });
    if (!target) {
      return Response.json(
        { error: "Please enter your SubScript Commit ID (cmt_...) or wallet address (0x...)." },
        { status: 400 }
      );
    }
    await q("UPDATE users SET payg_enabled = 1 WHERE id = $1", [user.id]);
  } else {
    await q("UPDATE users SET payg_enabled = 0 WHERE id = $1", [user.id]);
  }
  return Response.json({ ok: true });
}
