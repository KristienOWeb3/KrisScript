type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

const SYSTEM_PROMPT =
  "You are Kris's Script, a friendly and concise AI assistant. Keep answers helpful and to the point.";

export async function chatCompletion(history: ChatMessage[]): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    const last = history[history.length - 1]?.content ?? "";
    return `(demo mode — set DEEPSEEK_API_KEY in .env.local for real AI replies)\n\nYou said: "${last}". Billing, message caps, and SubScript payment gating are all fully active in this mode.`;
  }

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
      max_tokens: 1024,
    }),
  });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    throw new Error(json?.error?.message || `DeepSeek API error (HTTP ${res.status})`);
  }
  return json.choices?.[0]?.message?.content ?? "(empty response)";
}
