import type { Plan, PlanInput, Progress } from '../types';

export type ToWorker =
  | { type: 'plan'; id: number; input: PlanInput }
  | { type: 'cancel'; id: number };

export type FromWorker =
  | { type: 'progress'; id: number; progress: Progress }
  | { type: 'done'; id: number; plan: Plan }
  | { type: 'cancelled'; id: number }
  | { type: 'error'; id: number; message: string };
