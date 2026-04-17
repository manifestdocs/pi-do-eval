import { getActiveProject } from "$lib/server/projects.js";
import { projectWatchers } from "$lib/server/runtime.js";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = () => {
  const project = getActiveProject();
  if (!project) {
    return new Response("No active project", { status: 404 });
  }

  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      unsubscribe = projectWatchers.subscribe(project.id, (event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          unsubscribe?.();
          unsubscribe = null;
        }
      });

      if (!unsubscribe) {
        controller.close();
      }
    },
    cancel() {
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
