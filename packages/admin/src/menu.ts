import type { MenuItem, MenuState } from './types.js';

type Listener = (state: MenuState) => void;

/**
 * MenuManager — role-based menu filtering, registration, and state.
 *
 * Usage:
 *   const menu = new MenuManager();
 *   menu.register(items);
 *   menu.setPermissions(user.permissions);
 *   const visible = menu.getFilteredItems();
 */
export class MenuManager {
  private items: MenuItem[] = [];
  private permissions: Set<string> = new Set();
  private selectedKeys: string[] = [];
  private openKeys: string[] = [];
  private collapsed = false;
  private listeners: Set<Listener> = new Set();

  /**
   * Register menu items (incremental — appends, replaces by key).
   */
  register(items: MenuItem[]): void {
    for (const item of items) {
      const idx = this.items.findIndex((i) => i.key === item.key);
      if (idx >= 0) {
        this.items[idx] = item;
      } else {
        this.items.push(item);
      }
    }
    this.emit();
  }

  /**
   * Remove menu items by key (recursive).
   */
  unregister(keys: string[]): void {
    const keySet = new Set(keys);
    this.items = this.removeByKey(this.items, keySet);
    this.emit();
  }

  /**
   * Merge-patch a single menu item by key.
   */
  update(key: string, patch: Partial<MenuItem>): void {
    this.items = this.updateByKey(this.items, key, patch);
    this.emit();
  }

  /**
   * Set the current user's permission list (replaces previous set).
   * Call this after login or permission refresh.
   */
  setPermissions(permissions: string[]): void {
    this.permissions = new Set(permissions);
    this.emit();
  }

  /**
   * Get menu items filtered by current permissions, sorted by order.
   */
  getFilteredItems(): MenuItem[] {
    return this.sortItems(this.filterTree(this.items));
  }

  setSelectedKeys(keys: string[]): void {
    this.selectedKeys = keys;
    this.emit();
  }

  setOpenKeys(keys: string[]): void {
    this.openKeys = keys;
    this.emit();
  }

  toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.emit();
  }

  /**
   * Subscribe to menu state changes.
   * Returns an unsubscribe function.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Get current state snapshot.
   */
  getState(): MenuState {
    return {
      items: this.getFilteredItems(),
      selectedKeys: [...this.selectedKeys],
      openKeys: [...this.openKeys],
      collapsed: this.collapsed,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  /**
   * Recursive permission filter.
   * - No `permission` field → always visible.
   * - Has `permission` and user lacks it → hide item + all children.
   * - Parent hidden → children never evaluated.
   */
  private filterTree(items: MenuItem[]): MenuItem[] {
    const result: MenuItem[] = [];
    for (const item of items) {
      if (item.hidden) continue;

      if (item.permission && !this.permissions.has(item.permission)) {
        continue;
      }

      const filtered: MenuItem = { ...item };
      if (item.children && item.children.length > 0) {
        filtered.children = this.filterTree(item.children);
      }
      result.push(filtered);
    }
    return result;
  }

  private sortItems(items: MenuItem[]): MenuItem[] {
    return [...items]
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
      .map((item) => (item.children ? { ...item, children: this.sortItems(item.children) } : item));
  }

  private removeByKey(items: MenuItem[], keys: Set<string>): MenuItem[] {
    return items
      .filter((i) => !keys.has(i.key))
      .map((i) => (i.children ? { ...i, children: this.removeByKey(i.children, keys) } : i));
  }

  private updateByKey(items: MenuItem[], key: string, patch: Partial<MenuItem>): MenuItem[] {
    return items.map((item) => {
      if (item.key === key) {
        return { ...item, ...patch };
      }
      if (item.children) {
        return { ...item, children: this.updateByKey(item.children, key, patch) };
      }
      return item;
    });
  }
}
