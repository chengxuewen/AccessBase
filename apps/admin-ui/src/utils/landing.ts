// Where a freshly authenticated user should land, based on their permission codes.
// Keeps users without stats:read off /dashboard (which would 403) — they go to /profile.
export function landingPath(permissions: string[] | undefined): '/' | '/profile' {
  // undefined permissions = legacy backend → keep '/' (mirrors PrivateRoute pass-through)
  if (permissions === undefined) return '/';
  return permissions.includes('stats:read') ? '/' : '/profile';
}
