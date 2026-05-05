import { getRegisteredProject } from "$lib/server/projects.js";
import { projectWatchers } from "$lib/server/runtime.js";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = ({ params }) => {
  const project = getRegisteredProject(params.projectId);
  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  let unsubscribe: (() => void) | null = null;
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const nextUnsubscribe = await projectWatchers.subscribe(project.id, (event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          unsubscribe?.();
          unsubscribe = null;
        }
      });
      if (cancelled) {
        nextUnsubscribe?.();
        return;
      }
      unsubscribe = nextUnsubscribe;

      if (!unsubscribe) {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
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
