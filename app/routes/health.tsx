export const loader = () => {
  console.log("\u2764\uFE0F HEALTH CHECK \u2764\uFE0F");
  return new Response("OK", { status: 200 });
};

// This route is being used for health checks performed by AWS ALB (application load balancer).
// path: <domain>/health
