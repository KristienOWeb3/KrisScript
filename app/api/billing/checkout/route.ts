import { currentUser } from "@/lib/auth";
import { createSubscription } from "@/lib/subscript";

const PLANS: Record<
  string,
  { amountUsdcMicros: string; amountUsdc: string; interval: string; messages: number }
> = {
  pro: { amountUsdcMicros: "2000000", amountUsdc: "2.00", interval: "month", messages: 20 },
  promax: { amountUsdcMicros: "5000000", amountUsdc: "5.00", interval: "month", messages: 50 },
  ultra: { amountUsdcMicros: "20000000", amountUsdc: "20.00", interval: "month", messages: 200 },
};

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const product = (body.product || "").toLowerCase();
  const paymentMethod = body.paymentMethod || "subscript";

  if (paymentMethod !== "subscript") {
    return Response.json({ error: "Only SubScript checkout is supported." }, { status: 400 });
  }

  if (!PLANS[product]) {
    return Response.json({ error: "Unknown product." }, { status: 400 });
  }

  const plan = PLANS[product];

  try {
    const idempotencyKey = `usr_${user.id}_plan_${product}_${Date.now()}`;
    const title = `Kris's Script - ${product.toUpperCase()}`;
    const description = `$${plan.amountUsdc}/month — ${plan.messages} messages per month`;

    const res = await createSubscription({
      title,
      description,
      amountUsdcMicros: plan.amountUsdcMicros,
      interval: plan.interval,
      externalReference: `user:${user.id}:plan:${product}`,
      idempotencyKey,
    });

    return Response.json({
      checkoutUrl: res.subscription.checkoutUrl,
      subscriptionId: res.subscription.id,
      devMode: res.devMode,
    });
  } catch (err: any) {
    return Response.json({ error: err?.message || "Failed to create subscription." }, { status: 500 });
  }
}

