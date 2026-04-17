import type { Handle } from "@sveltejs/kit";
import { registerShutdownHandlers } from "$lib/server/shutdown.js";

registerShutdownHandlers();

export const handle: Handle = async ({ event, resolve }) => resolve(event);
