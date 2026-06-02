import type { RouteWorkerRequest, RouteWorkerResponse } from '@domain';
import { planRoutes } from './planner.core';

/**
 * Web Worker entry for the routing engine. Vite bundles this when referenced as
 * `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`.
 *
 * We type the worker scope locally rather than pulling in the `WebWorker` lib,
 * which would clash with the `DOM` lib used everywhere else.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<RouteWorkerRequest>) => void) | null;
  postMessage: (message: RouteWorkerResponse) => void;
}

const ctx = self as unknown as WorkerScope;

ctx.onmessage = (event) => {
  const message = event.data;
  if (message.type !== 'plan') return;
  try {
    const plan = planRoutes(message.request);
    ctx.postMessage({ type: 'result', id: message.id, plan });
  } catch (error) {
    ctx.postMessage({
      type: 'error',
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
