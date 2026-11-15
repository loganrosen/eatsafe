import { runScheduledAlerts } from "./alerts.js";
import { handleApi } from "./api.js";
import type { Env } from "./env.js";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, ctx);
      } catch (error) {
        console.error("API error", error);
        return Response.json({ error: "Internal error" }, { status: 500 });
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(runScheduledAlerts(env));
  },
} satisfies ExportedHandler<Env>;
