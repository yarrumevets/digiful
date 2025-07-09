export async function loader({ request }) {
  // Possible future uses for this handler:
  // - Log billing completions separately.
  // - Trigger analytics or webhook events.
  // - Store invoice or plan metadata.
  // - Validate plan consistency.
  // - Auto-provision extra features on upgrade.
  return new Response("OK", { status: 200 });
}
