import client from './client';
import type { ApiEnvelope } from './types';

export interface OptionRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

export const listOptions = () => client.get<ApiEnvelope<OptionRow[]>>('/v1/options');
export const setOption = (key: string, value: unknown) =>
  client.put<ApiEnvelope<OptionRow>>('/v1/options', { key, value });
export const deleteOption = (key: string) =>
  client.delete<ApiEnvelope<void>>(`/v1/options/${encodeURIComponent(key)}`);
