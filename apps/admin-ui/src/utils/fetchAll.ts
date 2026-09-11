import { listPermissions } from '../api/roles';
import type { Permission } from '../api/roles';

const HARD_CAP = 1000;
const PAGE = 100;

export async function fetchAllPermissions(): Promise<Permission[]> {
  const out: Permission[] = [];
  let page = 1;
  for (;;) {
    const res = await listPermissions({ page, pageSize: PAGE });
    out.push(...res.data);
    if (out.length >= res.total) break;
    if (out.length >= HARD_CAP) break; // ponytail: hard cap; raise when permission counts approach 1000
    page += 1;
  }
  return out;
}
