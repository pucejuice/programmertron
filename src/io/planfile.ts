import type { Assignments, ColumnMapping, Plan, Settings, Table } from '../types';

export interface PlanFile {
  format: 'job-router-plan';
  version: 1;
  savedAt: string;
  table: Table;
  mapping: ColumnMapping;
  settings: Settings;
  assignments: Assignments;
  dayOrder: Record<number, number[]>;
  plan: Plan | null;
}

export function serializePlanFile(_p: Omit<PlanFile, 'format' | 'version' | 'savedAt'>): string { throw new Error('not implemented'); }

/** Validates format/version and basic shape; throws a readable Error otherwise. */
export function parsePlanFile(_text: string): PlanFile { throw new Error('not implemented'); }
