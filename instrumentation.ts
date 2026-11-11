/**
 * Boot-time configuration check for production (`next start`).
 *
 * Every rule here describes a deployment that would boot, look healthy, and
 * then lose money or data on the first real customer — so the server refuses
 * to start instead. Nothing runs in development or during `next build`.
 */
export async function register() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;

  const env = process.env;
  const problems: string[] = [];

  if (!env.DATABASE_URL) problems.push("DATABASE_URL is not set.");

  const auth = env.AUTH_SECRET ?? "";
  if (auth.length < 32 || auth === "change-me-to-a-long-random-string") {
    problems.push("AUTH_SECRET must be a random string of 32+ characters.");
  }

  if (!env.APP_URL?.startsWith("https://")) {
    problems.push("APP_URL must be the public https:// URL (SubScript redirects and webhooks need it).");
  }

  const key = env.SUBSCRIPT_SECRET_KEY ?? "";
  if (!key) {
    // Blank key = dev mode, whose simulated checkout grants access for free.
    problems.push("SUBSCRIPT_SECRET_KEY is not set (blank means simulated dev-mode checkout).");
  } else if (!key.startsWith("sk_live_") && env.ALLOW_TEST_KEY_IN_PRODUCTION !== "1") {
    problems.push(
      "SUBSCRIPT_SECRET_KEY is not an sk_live_ key. Set ALLOW_TEST_KEY_IN_PRODUCTION=1 to run a sandbox deployment deliberately."
    );
  }
  if (!env.SUBSCRIPT_WEBHOOK_SECRET) {
    problems.push("SUBSCRIPT_WEBHOOK_SECRET is not set, so no payment can ever be fulfilled.");
  }

  if (!env.DEEPSEEK_API_KEY) {
    // Without it, users are billed real USDC for canned demo replies.
    problems.push("DEEPSEEK_API_KEY is not set (chat would charge for demo-mode stub replies).");
  }

  if (problems.length) {
    const msg = ["Refusing to start — production configuration is incomplete:", ...problems.map((p) => `  - ${p}`)].join("\n");
    console.error(msg);
    // Throwing alone is not enough: Next logs "Failed to prepare server" and
    // keeps the process alive, so systemd would report a healthy service.
    process.exit(1);
  }
}
