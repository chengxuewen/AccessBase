import type { PackDefinition, PackId } from '../types.js';
import { ant } from './ant.js';
import { broadsheet } from './broadsheet.js';

/**
 * Pack registry — EXACTLY the two shipped packs (ruling P-2=B); the other
 * five (material/fluent/carbon/cupertino/geist) are LEDGERED as additive.
 */
export const PACKS: Record<PackId, PackDefinition> = { ant, broadsheet };

export const PACK_IDS: PackId[] = ['ant', 'broadsheet'];

export function isPackId(v: unknown): v is PackId {
  return v === 'ant' || v === 'broadsheet';
}
