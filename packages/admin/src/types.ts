/**
 * @accessbase/admin — Type definitions
 *
 * Core interfaces for the admin UI framework: menu, theme, brand, page registry, config.
 */

// ─── Menu ────────────────────────────────────────────────────────────────────

export interface MenuItem {
  /** Unique key */
  key: string;
  /** Display label (supports i18n key) */
  label: string;
  /** Route path */
  path?: string;
  /** Child menu items */
  children?: MenuItem[];
  /** Required permission — hidden if user lacks it */
  permission?: string;
  /** Badge count */
  badge?: number;
  /** Hidden from menu (route still active) */
  hidden?: boolean;
  /** Sort weight — lower = higher */
  order?: number;
  /** Group identifier */
  group?: string;
}

export interface MenuState {
  /** Filtered + sorted items visible to current user */
  items: MenuItem[];
  /** Currently selected menu key */
  selectedKeys: string[];
  /** Currently expanded submenu keys */
  openKeys: string[];
  /** Sidebar collapsed state */
  collapsed: boolean;
}

// ─── Page Registry ───────────────────────────────────────────────────────────

export interface RouteMeta {
  /** Page title (i18n key) */
  title: string;
  /** Required permission */
  permission?: string;
  /** Hidden from menu */
  hideInMenu?: boolean;
  /** Show in breadcrumbs (default true) */
  breadcrumb?: boolean;
  /** Cache page (default false) */
  keepAlive?: boolean;
  /** Layout type */
  layout?: 'default' | 'blank' | 'fullscreen';
}

export interface RouteConfig {
  /** Route path */
  path: string;
  /** Component loader — lazy or direct */
  component: () => Promise<{ default: unknown }>;
  /** Route metadata */
  meta: RouteMeta;
  /** Nested routes */
  children?: RouteConfig[];
}

export interface BreadcrumbItem {
  title: string;
  path: string;
}

export interface PageRegistryState {
  routes: RouteConfig[];
}

// ─── Theme & Brand ───────────────────────────────────────────────────────────

export type ThemeMode = 'light' | 'dark';

export interface DesignTokens {
  colors: {
    primary: string;
    secondary: string;
    success: string;
    warning: string;
    error: string;
    info: string;
    text: {
      primary: string;
      secondary: string;
      disabled: string;
    };
    background: {
      default: string;
      paper: string;
      elevated: string;
    };
    border: {
      default: string;
      strong: string;
    };
  };
  typography: {
    fontFamily: string;
    fontSize: { xs: string; sm: string; md: string; lg: string; xl: string };
    fontWeight: { light: number; regular: number; medium: number; bold: number };
    lineHeight: { tight: number; normal: number; relaxed: number };
  };
  spacing: { xs: string; sm: string; md: string; lg: string; xl: string };
  borderRadius: { none: string; sm: string; md: string; lg: string; full: string };
  shadows: { none: string; sm: string; md: string; lg: string };
  transitions: {
    duration: { fast: string; normal: string; slow: string };
    easing: { easeIn: string; easeOut: string; easeInOut: string };
  };
}

export interface BrandTokens {
  primaryColor: string;
  secondaryColor: string;
  logo: string | null;
  logoCollapsed: string | null;
  brandName: string;
  brandTagline?: string;
  fontFamily?: string;
}

export interface ThemeConfig {
  mode: ThemeMode;
  brand?: Partial<BrandTokens>;
  custom?: Partial<DesignTokens>;
}

// ─── Admin Config ────────────────────────────────────────────────────────────

export interface UIConfig {
  designSystem: 'antd';
  emptyText: string;
  loadingText: string;
  confirmText: { ok: string; cancel: string; delete: string };
  toast: { duration: number; maxCount: number };
  table: {
    defaultPageSize: number;
    pageSizeOptions: number[];
    defaultSortOrder: 'asc' | 'desc';
  };
}

export interface ThemeConfigOptions {
  defaultMode: ThemeMode;
  allowToggle: boolean;
  persistPreference: boolean;
  storageKey: string;
}

export interface LayoutConfig {
  type: 'classic' | 'modern' | 'fullscreen';
  sidebar: {
    collapsible: boolean;
    defaultCollapsed: boolean;
    width: number;
    collapsedWidth: number;
  };
  header: {
    fixed: boolean;
    height: number;
    showBreadcrumbs: boolean;
    showSearch: boolean;
    showNotification: boolean;
    showThemeToggle: boolean;
  };
  footer: { show: boolean; text?: string };
}

export interface NavigationConfig {
  menu: {
    mode: 'inline' | 'vertical' | 'horizontal';
    theme: 'light' | 'dark';
    multipleLevels: boolean;
    accordion: boolean;
  };
  breadcrumbs: {
    enabled: boolean;
    separator: string;
    showHome: boolean;
  };
  tabs: {
    enabled: boolean;
    closable: boolean;
    maxTabs: number;
    persistState: boolean;
    storageKey: string;
  };
}

export interface ResponsiveConfig {
  enabled: boolean;
  breakpoints: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  mobileSidebar: { mode: 'overlay' | 'push' | 'hidden' };
}

export interface ApiConfig {
  baseURL: string;
  timeout: number;
  refreshEndpoint: string;
  tokenStorageKey: string;
  deduplicateRequests: boolean;
  customHeaders?: Record<string, string>;
}

export interface DevConfig {
  debug: boolean;
  showComponentBoundaries: boolean;
  strictMode: boolean;
}

export interface AdminConfig {
  ui: UIConfig;
  theme: ThemeConfigOptions;
  layout: LayoutConfig;
  navigation: NavigationConfig;
  responsive: ResponsiveConfig;
  api: ApiConfig;
  dev: DevConfig;
}

// ─── Plugin Options ──────────────────────────────────────────────────────────

export interface AdminPluginOptions {
  /** Base path for admin static assets (default: /admin) */
  path?: string;
  /** Path to the built admin-ui dist directory */
  staticDir?: string;
  /** Initial menu items */
  menuItems?: MenuItem[];
  /** Initial route configs */
  routes?: RouteConfig[];
  /** Brand tokens for white-labeling */
  brandTokens?: Partial<BrandTokens>;
  /** Theme configuration */
  theme?: Partial<ThemeConfig>;
  /** Full admin config (merged with defaults) */
  config?: Partial<AdminConfig>;
}

// ─── Error Response ──────────────────────────────────────────────────────────

export interface AdminErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, string>;
    requestId?: string;
    timestamp?: string;
  };
}
