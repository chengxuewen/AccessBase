/**
 * @accessbase/admin — Admin UI framework for AccessBase
 *
 * Provides the shell for enterprise admin backends: menu management,
 * theme/brand system, page registry, and a Fastify plugin for serving
 * the SPA with API endpoints.
 */

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  MenuItem,
  MenuState,
  RouteMeta,
  RouteConfig,
  BreadcrumbItem,
  PageRegistryState,
  ThemeMode,
  DesignTokens,
  BrandTokens,
  ThemeConfig,
  UIConfig,
  ThemeConfigOptions,
  LayoutConfig,
  NavigationConfig,
  ResponsiveConfig,
  ApiConfig,
  DevConfig,
  AdminConfig,
  AdminPluginOptions,
  AdminErrorResponse,
} from './types.js';

// ── Managers ─────────────────────────────────────────────────────────────────
export { MenuManager } from './menu.js';
export { ThemeManager } from './theme.js';

// ── Fastify plugin ───────────────────────────────────────────────────────────
export { fastifyAdmin, createAdmin } from './plugin.js';
export type { AdminInstance } from './plugin.js';
export { fastifyAdmin as default } from './plugin.js';
