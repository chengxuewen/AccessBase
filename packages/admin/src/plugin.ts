import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { logger } from '@accessbase/logging';
import type { AdminPluginOptions, AdminConfig, RouteConfig } from './types.js';
import { MenuManager } from './menu.js';
import { ThemeManager } from './theme.js';

// ─── Default config ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AdminConfig = {
  ui: {
    designSystem: 'antd',
    emptyText: 'No data',
    loadingText: 'Loading...',
    confirmText: { ok: 'OK', cancel: 'Cancel', delete: 'Delete' },
    toast: { duration: 3, maxCount: 3 },
    table: { defaultPageSize: 20, pageSizeOptions: [10, 20, 50, 100], defaultSortOrder: 'desc' },
  },
  theme: {
    defaultMode: 'light',
    allowToggle: true,
    persistPreference: true,
    storageKey: 'accessbase:theme',
  },
  layout: {
    type: 'classic',
    sidebar: { collapsible: true, defaultCollapsed: false, width: 256, collapsedWidth: 80 },
    header: {
      fixed: true,
      height: 64,
      showBreadcrumbs: true,
      showSearch: true,
      showNotification: true,
      showThemeToggle: true,
    },
    footer: { show: false },
  },
  navigation: {
    menu: { mode: 'inline', theme: 'light', multipleLevels: true, accordion: true },
    breadcrumbs: { enabled: true, separator: '/', showHome: true },
    tabs: {
      enabled: true,
      closable: true,
      maxTabs: 10,
      persistState: true,
      storageKey: 'accessbase:tabs',
    },
  },
  responsive: {
    enabled: true,
    breakpoints: { xs: 480, sm: 576, md: 768, lg: 992, xl: 1200, xxl: 1600 },
    mobileSidebar: { mode: 'overlay' },
  },
  api: {
    baseURL: '/api',
    timeout: 30000,
    refreshEndpoint: '/auth/refresh',
    tokenStorageKey: 'accessbase:token',
    deduplicateRequests: true,
  },
  dev: { debug: false, showComponentBoundaries: false, strictMode: true },
};

// ─── Decorator type ──────────────────────────────────────────────────────────

export interface AdminInstance {
  config: AdminConfig;
  menuManager: MenuManager;
  themeManager: ThemeManager;
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

const adminPlugin: FastifyPluginAsync<AdminPluginOptions> = async (fastify, opts) => {
  const basePath = opts.path ?? '/admin';
  const normalizedBase = basePath.replace(/\/$/, '');

  // Merge config
  const config: AdminConfig = mergeConfig(DEFAULT_CONFIG, opts.config ?? {});

  // Instantiate managers
  const menuManager = new MenuManager();
  const themeManager = new ThemeManager(opts.theme, config.theme.storageKey);

  // Seed initial items
  if (opts.menuItems) menuManager.register(opts.menuItems);

  // Seed brand
  if (opts.brandTokens) themeManager.setBrand(opts.brandTokens);

  // ── Serve static UI assets ──────────────────────────────────────────────
  const staticDir = opts.staticDir ?? join(process.cwd(), 'apps', 'admin-ui', 'dist');
  if (existsSync(staticDir)) {
    await fastify.register(fastifyStatic, {
      root: staticDir,
      prefix: `${normalizedBase}/`,
      decorateReply: false,
      index: ['index.html'],
    });
    logger.info({ staticDir }, 'Admin static assets registered');
  } else {
    logger.warn({ staticDir }, 'Admin static dir not found — skipping static file serving');
  }

  // ── API endpoints ───────────────────────────────────────────────────────

  /**
   * GET /admin/api/config — Return merged admin config for the SPA shell.
   */
  fastify.get(`${normalizedBase}/api/config`, async (_req, reply) => {
    return reply.send({ success: true, data: config });
  });

  /**
   * GET /admin/api/menu — Return filtered menu for the current user.
   * Expects `request.user.permissions` to be populated by upstream auth hook.
   */
  fastify.get(`${normalizedBase}/api/menu`, async (request, reply) => {
    const q = request.query as { permissions?: string };
    const user = (request as unknown as { user?: { permissions?: string[] } }).user;
    const perms = q.permissions ? q.permissions.split(',') : user?.permissions;
    if (perms) menuManager.setPermissions(perms);

    return reply.send({ success: true, data: menuManager.getFilteredItems() });
  });

  /**
   * GET /admin/api/theme — Return current theme config + brand tokens.
   */
  fastify.get(`${normalizedBase}/api/theme`, async (_req, reply) => {
    return reply.send({
      success: true,
      data: {
        mode: themeManager.getMode(),
        brand: themeManager.getBrand(),
        tokens: themeManager.getDesignTokens(),
      },
    });
  });

  /**
   * GET /admin/api/routes — Return registered route metadata for SPA router.
   */
  fastify.get(`${normalizedBase}/api/routes`, async (_req, reply) => {
    const routes: RouteConfig[] = opts.routes ?? [];
    return reply.send({ success: true, data: routes });
  });

  // ── SPA fallback — serve index.html for all /admin/* routes ─────────────
  fastify.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith(normalizedBase) && existsSync(join(staticDir, 'index.html'))) {
      return reply.type('text/html').sendFile('index.html', staticDir);
    }
    return reply
      .code(404)
      .send({ success: false, error: { code: 'ADMIN_004', message: 'Not found' } });
  });

  // ── Decorate fastify ────────────────────────────────────────────────────
  fastify.decorate('admin', { config, menuManager, themeManager });

  logger.info({ basePath: normalizedBase }, 'Admin plugin registered');
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mergeConfig(base: AdminConfig, override: Partial<AdminConfig>): AdminConfig {
  return {
    ui: { ...base.ui, ...override.ui },
    theme: { ...base.theme, ...override.theme },
    layout: {
      ...base.layout,
      ...override.layout,
      sidebar: { ...base.layout.sidebar, ...override.layout?.sidebar },
      header: { ...base.layout.header, ...override.layout?.header },
      footer: { ...base.layout.footer, ...override.layout?.footer },
    },
    navigation: {
      ...base.navigation,
      ...override.navigation,
      menu: { ...base.navigation.menu, ...override.navigation?.menu },
      breadcrumbs: { ...base.navigation.breadcrumbs, ...override.navigation?.breadcrumbs },
      tabs: { ...base.navigation.tabs, ...override.navigation?.tabs },
    },
    responsive: {
      ...base.responsive,
      ...override.responsive,
      breakpoints: { ...base.responsive.breakpoints, ...override.responsive?.breakpoints },
      mobileSidebar: { ...base.responsive.mobileSidebar, ...override.responsive?.mobileSidebar },
    },
    api: { ...base.api, ...override.api },
    dev: { ...base.dev, ...override.dev },
  };
}

export const fastifyAdmin = fp(adminPlugin, {
  name: '@accessbase/admin',
  fastify: '4.x',
});

/**
 * Factory function — creates and returns the admin Fastify plugin.
 */
export function createAdmin(options?: AdminPluginOptions) {
  const plugin: FastifyPluginAsync<AdminPluginOptions> = async (fastify, opts) => {
    await adminPlugin(fastify, { ...opts, ...options });
  };
  return fp(plugin, { name: '@accessbase/admin', fastify: '4.x' });
}
