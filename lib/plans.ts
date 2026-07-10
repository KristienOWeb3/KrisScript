export const PRODUCTS = {
  signup: {
    title: "Kris's Script — Account Activation",
    description: "One-time $1 signup fee for Kris's Script",
    amountUsdcMicros: "1000000",
    label: "$1 one-time",
  },
  pro: {
    title: "Kris's Script Pro — 1 Week",
    description: "Pro plan: 100 messages/day for 7 days",
    amountUsdcMicros: "2000000",
    label: "$2 / week",
  },
  promax: {
    title: "Kris's Script Pro Max — 1 Week",
    description: "Pro Max plan: unlimited messages for 7 days",
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
export const PLAN_DURATION_SECONDS = 7 * 86400;
