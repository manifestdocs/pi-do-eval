import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = () =>
  new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "public, max-age=86400",
    },
  });
