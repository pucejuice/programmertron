// Promise wrapper around the routing worker.
import type { Plan, PlanInput, Progress } from '../types';
import type { FromWorker, ToWorker } from './protocol';

export class RouteCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'RouteCancelled';
  }
}

export interface RouteRun {
  promise: Promise<Plan>;
  cancel(): void;
}

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL('./router.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

export function startRoute(input: PlanInput, onProgress: (p: Progress) => void): RouteRun {
  const w = getWorker();
  const id = nextId++;
  let settle: { resolve: (p: Plan) => void; reject: (e: Error) => void };
  let killTimer: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<Plan>((resolve, reject) => {
    settle = { resolve, reject };
  });

  const cleanup = () => {
    w.removeEventListener('message', onMessage);
    w.removeEventListener('error', onError);
    if (killTimer) clearTimeout(killTimer);
  };
  const onMessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.id !== id) return;
    if (m.type === 'progress') onProgress(m.progress);
    else if (m.type === 'done') {
      cleanup();
      settle.resolve(m.plan);
    } else if (m.type === 'cancelled') {
      cleanup();
      settle.reject(new RouteCancelled());
    } else if (m.type === 'error') {
      cleanup();
      settle.reject(new Error(m.message));
    }
  };
  const onError = (e: ErrorEvent) => {
    cleanup();
    worker = null;
    settle.reject(new Error(e.message || 'The routing worker crashed'));
  };
  w.addEventListener('message', onMessage);
  w.addEventListener('error', onError);
  w.postMessage({ type: 'plan', id, input } satisfies ToWorker);

  return {
    promise,
    cancel() {
      w.postMessage({ type: 'cancel', id } satisfies ToWorker);
      // A worker in the middle of a long synchronous step cannot read the message,
      // so give it a moment and then start over with a fresh worker.
      killTimer = setTimeout(() => {
        cleanup();
        w.terminate();
        if (worker === w) worker = null;
        settle.reject(new RouteCancelled());
      }, 1500);
    },
  };
}
