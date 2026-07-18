export const PRODUCTS = {
  signup: {
    kind: "one_time",
    title: "Kris's Script — Account Activation",
    description: "One-time $1 signup fee for Kris's Script",
    amountUsdcMicros: "1000000",
    label: "$1 one-time",
  },
  pro: {
    kind: "subscription",
    interval: "weekly",
    title: "Kris's Script Pro",
    description: "Pro plan: 100 messages/day, billed weekly",
    amountUsdcMicros: "2000000",
    label: "$2 / week",
  },
  promax: {
    kind: "subscription",
    interval: "weekly",
    title: "Kris's Script Pro Max",
    description: "Pro Max plan: unlimited messages, billed weekly",
    amountUsdcMicros: "5000000",
    label: "$5 / week",
  },
} as const;

export type ProductKey = keyof typeof PRODUCTS;

export const FREE_MESSAGE_CAP = 3;
export const PRO_DAILY_CAP = 100;
export const PAYG_PRICE_USDC = "0.10";
// Dev-mode simulated vault balance (USDC) before a 402 is returned
export const DEV_VAULT_COMMIT_USDC = 5.0;
// Access granted per successful subscription charge. SubScript re-charges each
// interval and fires subscription.renewed, which pushes this forward again.
export const PLAN_DURATION_SECONDS = 7 * 86400;
