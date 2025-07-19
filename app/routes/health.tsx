export const loader = () => {
  console.log("health check");
  return new Response("OK", { status: 200 });
};

// This route is being used for health checks performed by AWS ALB (application load balancer).
// path: <domain>/health
