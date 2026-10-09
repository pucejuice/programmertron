// Routing runs here so the UI never freezes. Only src/core and src/net are used.
import { buildPlan, CancelledError } from '../core/plan';
import { osrmProvider } from '../net/osrm';
import type { FromWorker, ToWorker } from './protocol';

const ctx = self as unknown as {
  postMessage(m: FromWorker): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

let cancelledId = -1;

ctx.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    cancelledId = msg.id;
    return;
  }
  const { id, input } = msg;
  cancelledId = -1;
  try {
    const s = input.settings;
    const roadTable = s.roadServerUrl && s.roadServerConfirmed ? osrmProvider(s.roadServerUrl, fetch.bind(globalThis)) : undefined;
    const plan = await buildPlan(input, {
      onProgress: (progress) => ctx.postMessage({ type: 'progress', id, progress }),
      isCancelled: () => cancelledId === id,
      roadTable,
    });
    ctx.postMessage({ type: 'done', id, plan });
  } catch (err) {
    if (err instanceof CancelledError || (err as Error)?.name === 'CancelledError') ctx.postMessage({ type: 'cancelled', id });
    else ctx.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
};
