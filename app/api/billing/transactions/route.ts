import { q } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { rows } = await q(
    `SELECT id, product, amount_micros, intent_id, receipt_token, status, created_at
     FROM payments
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [user.id]
  );

  const transactions = rows.map((r) => ({
    id: r.id,
    product: r.product,
    amountMicros: r.amount_micros,
    amountUsdc: (parseFloat(r.amount_micros) / 1000000).toFixed(2),
    intentId: r.intent_id,
    receiptToken: r.receipt_token,
    status: r.status,
    createdAt: r.created_at,
  }));

  return Response.json({ transactions });
}
