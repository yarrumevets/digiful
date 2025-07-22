export const loader = () => {
  console.log("\u2764\uFE0F HEALTH CHECK \u2764\uFE0F");
  return new Response("OK", { status: 200 });
};
