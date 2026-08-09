import { currentUser } from "@/lib/auth";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  return Response.json(
    { error: "Kris's Script is now a pure Pay-As-You-Go service. Enable Pay-As-You-Go on the billing page." },
    { status: 400 }
  );
}

