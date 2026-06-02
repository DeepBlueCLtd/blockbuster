import type {
  RoutePlan,
  RoutePlanner,
  RouteRequest,
  RouteWorkerRequest,
  RouteWorkerResponse,
} from '@domain';
import { planRoutes } from './planner.core';

export interface RoutePlannerOptions {
  /** Run planning in a Web Worker (default) or synchronously on the main thread. */
  useWorker?: boolean;
}

/**
 * ROUTING MODULE entry. Produces a {@link RoutePlanner} that offloads work to a
 * Web Worker so the heavy search never blocks the UI. The worker calls the same
 * `planRoutes` core, which the routing team implements.
 */
export function createRoutePlanner(options: RoutePlannerOptions = {}): RoutePlanner {
  const useWorker = options.useWorker ?? true;

  if (!useWorker) {
    return { plan: (request: RouteRequest) => Promise.resolve(planRoutes(request)) };
  }

  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (plan: RoutePlan) => void; reject: (error: Error) => void }>();

  const ensureWorker = (): Worker => {
    if (worker) return worker;
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<RouteWorkerResponse>) => {
      const message = event.data;
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.type === 'result') entry.resolve(message.plan);
      else entry.reject(new Error(message.message));
    };
    return worker;
  };

  return {
    plan: (request: RouteRequest) =>
      new Promise<RoutePlan>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        const message: RouteWorkerRequest = { type: 'plan', id, request };
        ensureWorker().postMessage(message);
      }),
    dispose: () => {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}
