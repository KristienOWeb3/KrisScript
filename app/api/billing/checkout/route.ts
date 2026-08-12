export async function POST() {
  return Response.json(
    { error: "Subscription plans are currently disabled." },
    { status: 400 }
  );
}
