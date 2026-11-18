import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Reproducible harness for admin-console.html (adjudication 9 = A). Regenerates results.json.
// Each group navigates fresh (file:// reload resets all JS/mock state). Serial single worker
// (see playwright.config.ts) so the module-level results object is shared and written once.
const FILE = 'file://' + path.resolve(__dirname, '../admin-console.html');
const OUT = path.resolve(__dirname, 'results.json');

// Top-level const in the prototype's classic <script> lives in the global lexical scope —
// accessible as a bare identifier inside page.evaluate, but NOT on window/globalThis.
declare const GROUPS: { roles: string[] }[];

const results: Record<string, unknown> = {
  when: new Date().toISOString().slice(0, 10),
  prototype: 'admin-console.html v0.9 (ALL 11 pages high-fidelity; 7 style packs x light/dark)',
  runner: 'playwright (reproducible suite; .harness/prototype.spec.ts)',
  fail: 0,
  results: {} as Record<string, { pass: boolean; assertions: unknown }>,
};
const R = results.results as Record<string, { pass: boolean; assertions: unknown }>;
function rec(name: string, pass: boolean, assertions: unknown) {
  R[name] = { pass, assertions };
  if (!pass) (results.fail as number)++;
}

test.afterAll(() => {
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
});

test('de-ai-slop', async ({ page }) => {
  await page.goto(FILE);
  const a = await page.evaluate(() => {
    const logo = document.querySelector('.logo') as HTMLElement;
    return {
      symbolDefs: document.querySelectorAll('symbol').length,
      svgIcons: document.querySelectorAll('svg.ic').length,
      emojiInUI: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u.test(document.body.innerText),
      logoGradient: getComputedStyle(logo).backgroundImage,
    };
  });
  const pass = a.svgIcons > 100 && !a.emojiInUI && a.logoGradient === 'none';
  rec('de-ai-slop', pass, a);
  expect(pass, 'de-ai-slop').toBe(true);
});

test('dashboard-render', async ({ page }) => {
  await page.goto(FILE);
  const a = await page.evaluate(() => ({
    statCards: document.querySelectorAll('#page-dashboard .stat').length,
    trendSvg: !!document.querySelector('#trend'),
    activityItems: document.querySelectorAll('#activity li').length,
  }));
  const pass = a.statCards === 4 && a.trendSvg && a.activityItems === 5;
  rec('dashboard-render', pass, a);
  expect(pass, 'dashboard-render').toBe(true);
});

test('theme', async ({ page }) => {
  await page.goto(FILE);
  const a = await page.evaluate(() => {
    const initial = document.documentElement.dataset.theme;
    (document.getElementById('themeBtn') as HTMLElement).click();
    const afterToggle = document.documentElement.dataset.theme;
    let persisted = false;
    try { persisted = localStorage.getItem('ab_theme') === afterToggle; } catch { /* file:// */ }
    return { initial, afterToggle, persisted };
  });
  const pass = a.initial === 'light' && a.afterToggle === 'dark';
  rec('theme', pass, a);
  expect(pass, 'theme').toBe(true);
});

test('nav-switch', async ({ page }) => {
  await page.goto(FILE);
  const a = await page.evaluate(() => {
    (document.querySelector('[data-page=users]') as HTMLElement).click();
    return {
      usersPageVisible: document.getElementById('page-users')!.classList.contains('on'),
      crumb: document.getElementById('crumbPage')!.textContent,
    };
  });
  const pass = a.usersPageVisible && a.crumb === 'Users';
  rec('nav-switch', pass, a);
  expect(pass, 'nav-switch').toBe(true);
});

test('users-table', async ({ page }) => {
  await page.goto(FILE);
  const a = await page.evaluate(() => ({
    initialRows: document.querySelectorAll('#userRows tr').length,
    pageSize: 8,
  }));
  const pass = a.initialRows === 8;
  rec('users-table', pass, a);
  expect(pass, 'users-table').toBe(true);
});

test('filter-narrows', async ({ page }) => {
  await page.goto(FILE);
  const a = await page.evaluate(() => {
    const f = document.getElementById('statusFilter') as HTMLSelectElement;
    f.value = 'disabled'; f.dispatchEvent(new Event('input'));
    const rows = [...document.querySelectorAll('#userRows tr')];
    return {
      disabledFilterRows: rows.length,
      allDisabled: rows.every(r => r.textContent!.includes('Disabled')),
    };
  });
  const pass = a.disabledFilterRows === 3 && a.allDisabled;
  rec('filter-narrows', pass, a);
  expect(pass, 'filter-narrows').toBe(true);
});

test('search', async ({ page }) => {
  await page.goto(FILE);
  const a = await page.evaluate(() => {
    const s = document.getElementById('userSearch') as HTMLInputElement;
    s.value = 'alice'; s.dispatchEvent(new Event('input'));
    const rows = [...document.querySelectorAll('#userRows tr')];
    return { query: 'alice', rows: rows.length, hit: rows[0]?.textContent?.includes('Alice Chen') ?? false };
  });
  const pass = a.rows === 1 && a.hit;
  rec('search', pass, a);
  expect(pass, 'search').toBe(true);
});

test('style-packs', async ({ page }) => {
  await page.goto(FILE);
  const a = await page.evaluate(() => {
    const sel = document.getElementById('styleSelect') as HTMLSelectElement;
    const cs = () => getComputedStyle(document.documentElement);
    const packs: Record<string, unknown> = {};
    const accents: string[] = [];
    for (const s of ['broadsheet', 'geist', 'material', 'fluent', 'ant', 'carbon', 'cupertino']) {
      sel.value = s; sel.onchange!(new Event('change'));
      const accent = cs().getPropertyValue('--accent').trim();
      accents.push(accent);
      packs[s] = { accent, r6: cs().getPropertyValue('--r6').trim(), sans: cs().getPropertyValue('--sans').trim().split(',')[0].replace(/"/g, '') };
    }
    const optionValues = [...sel.options].map(o => o.value);
    // theme orthogonal: switching theme keeps the active pack accent axis
    sel.value = 'ant'; sel.onchange!(new Event('change'));
    document.documentElement.dataset.theme = 'dark';
    const darkAccent = cs().getPropertyValue('--accent').trim();
    document.documentElement.dataset.theme = 'light';
    sel.value = 'broadsheet'; sel.onchange!(new Event('change'));
    return { ...packs, optionValues, themeOrthogonal: darkAccent !== (packs.ant as { accent: string }).accent, antDarkAccent: darkAccent } as Record<string, unknown>;
  });
  const accents = ['broadsheet', 'geist', 'material', 'fluent', 'ant', 'carbon', 'cupertino'].map(p => (a[p] as { accent: string }).accent);
  const pass = new Set(accents).size === 7 && (a.optionValues as string[]).length === 7;
  rec('style-packs', pass, a);
  expect(pass, 'style-packs').toBe(true);
});

test('roles-matrix', async ({ page }) => {
  await page.goto(FILE);
  const a = await page.evaluate(() => {
    (document.querySelector('[data-page=roles]') as HTMLElement).click();
    const roleRows = document.querySelectorAll('#roleRows tr').length;
    const rows = [...document.querySelectorAll('#roleRows tr.clickable')] as HTMLElement[];
    rows[0].click(); // admin (system)
    const cells = document.querySelectorAll('#matrixRows .perm-cell').length;
    const adminOn = document.querySelectorAll('#matrixRows .perm-cell.on').length;
    const na = document.querySelectorAll('#matrixRows .perm-cell.na').length;
    const resourceRows = document.querySelectorAll('#matrixRows tr').length;
    const scope = document.getElementById('scopeSelect') as HTMLSelectElement;
    const systemLock = { matrixDisabled: (document.querySelector('#matrixRows .perm-cell') as HTMLButtonElement).disabled, scopeDisabled: scope.disabled };
    rows[1].click(); // editor
    const editorOn = document.querySelectorAll('#matrixRows .perm-cell.on').length;
    const editorScope = scope.value;
    const editorScopeEnabled = !scope.disabled;
    // toggle a real cell (users:delete) reversible
    const target = [...document.querySelectorAll('#matrixRows .perm-cell:not(.na)')].find(c => (c as HTMLElement).dataset.code === 'users:delete') as HTMLButtonElement;
    const before = document.querySelectorAll('#matrixRows .perm-cell.on').length;
    target.click();
    const after = document.querySelectorAll('#matrixRows .perm-cell.on').length;
    target.click();
    const restored = document.querySelectorAll('#matrixRows .perm-cell.on').length;
    return {
      roleRows, resourceRows, totalCells: cells, realPermissions: 26, naCells: na,
      adminGranted: `${adminOn}/26`, systemLock,
      editor: { granted: `${editorOn}/26`, scope: editorScope, scopeEnabled: editorScopeEnabled },
      toggle: { code: 'users:delete', delta: after - before, reversible: restored === before },
    };
  });
  const pass = a.roleRows === 5 && a.resourceRows === 11 && a.totalCells === 33 && a.naCells === 7
    && a.adminGranted === '26/26' && a.systemLock.matrixDisabled && a.systemLock.scopeDisabled
    && a.editor.granted === '13/26' && a.editor.scope === 'dept' && a.toggle.reversible;
  rec('roles-matrix', pass, a);
  expect(pass, 'roles-matrix').toBe(true);
});

test('groups-detail', async ({ page }) => {
  await page.goto(FILE);
  const a = await page.evaluate(() => {
    (document.querySelector('[data-page=groups]') as HTMLElement).click();
    const groupRows = document.querySelectorAll('#groupRows tr').length;
    const deptTags = document.querySelectorAll('#groupRows .kind-dept').length;
    (document.querySelector('#groupRows [data-manage="0"]') as HTMLElement).click();
    const panel = document.getElementById('panelName')!.textContent;
    const kind = document.getElementById('panelKind')!.textContent;
    const membersInitial = document.querySelectorAll('#memberList li').length;
    const pickerCandidates = (document.getElementById('memberPicker') as HTMLSelectElement).options.length - 1;
    // add then remove a member
    const picker = document.getElementById('memberPicker') as HTMLSelectElement;
    picker.value = picker.options[1].value;
    (document.getElementById('addMemberBtn') as HTMLElement).click();
    const afterAdd = document.querySelectorAll('#memberList li').length;
    (document.querySelector('#memberList [data-rm]') as HTMLElement).click();
    const afterRemove = document.querySelectorAll('#memberList li').length;
    // staged role save (adjudication 5): toggle edits draft, save commits, close discards
    (document.querySelector('.tabs [data-tab=roles]') as HTMLElement).click();
    const checks = document.querySelectorAll('#roleChecks .role-check').length;
    const bound = document.querySelectorAll('#roleChecks .role-check.on').length;
    const committedBefore = GROUPS[0].roles.length;
    (document.querySelector('#roleChecks .role-check') as HTMLElement).click();
    const stagedNotCommitted = GROUPS[0].roles.length === committedBefore;
    (document.getElementById('saveRolesBtn') as HTMLElement).click();
    const saveCommits = GROUPS[0].roles.length !== committedBefore;
    (document.querySelector('#roleChecks .role-check') as HTMLElement).click();
    (document.getElementById('saveRolesBtn') as HTMLElement).click(); // restore
    (document.getElementById('panelClose') as HTMLElement).click();
    const panelClose = document.getElementById('groupPanel')!.style.display === 'none';
    return {
      groupRows, deptTags, panel, kind,
      members: { initial: membersInitial, afterAdd, afterRemove, pickerCandidates },
      rolesTab: { checks, bound, stagedNotCommitted, saveCommits }, panelClose,
    };
  });
  const pass = a.groupRows === 5 && a.deptTags === 2 && a.members.afterAdd === a.members.initial + 1
    && a.members.afterRemove === a.members.initial && a.rolesTab.checks === 5
    && a.rolesTab.stagedNotCommitted && a.rolesTab.saveCommits && a.panelClose;
  rec('groups-detail', pass, a);
  expect(pass, 'groups-detail').toBe(true);
});

test('mgmt-pages', async ({ page }) => {
  await page.goto(FILE);
  const a = await page.evaluate(() => {
    const click = (p: string) => (document.querySelector(`[data-page=${p}]`) as HTMLElement).click();
    const setF = (id: string, v: string) => { const f = document.getElementById(id) as HTMLSelectElement; f.value = v; f.dispatchEvent(new Event('input')); };
    click('tenants');
    const tenants = { rows: document.querySelectorAll('#tenantRows tr').length };
    setF('tenantStatusFilter', 'suspended');
    (tenants as Record<string, unknown>).suspendedFilter = document.querySelectorAll('#tenantRows tr').length;
    setF('tenantStatusFilter', '');
    click('clients');
    const clients = { rows: document.querySelectorAll('#clientRows tr').length, grantTags: document.querySelectorAll('#clientRows .tag').length };
    click('apikeys');
    const apikeys = { rows: document.querySelectorAll('#apikeyRows tr').length, neverExpires: document.getElementById('apikeyRows')!.textContent!.includes('Never') };
    setF('apikeyStatusFilter', 'revoked');
    (apikeys as Record<string, unknown>).revokedFilter = document.querySelectorAll('#apikeyRows tr').length;
    setF('apikeyStatusFilter', '');
    click('webhooks');
    const webhooks = { rows: document.querySelectorAll('#webhookRows tr').length, deadPills: document.querySelectorAll('#webhookRows .count-pill.dead').length };
    click('audit');
    const audit = { rows: document.querySelectorAll('#auditRows tr').length, methodTags: document.querySelectorAll('#auditRows .tag[class*=m-]').length };
    setF('auditActionFilter', 'DELETE');
    (audit as Record<string, unknown>).deleteFilter = document.querySelectorAll('#auditRows tr').length;
    setF('auditActionFilter', '');
    (document.getElementById('verifyBtn') as HTMLElement).click();
    (audit as Record<string, unknown>).verifyBanner = document.getElementById('auditVerifyBanner')!.style.display === 'flex';
    click('events');
    const events = { rows: document.querySelectorAll('#eventRows tr').length, familyTags: document.querySelectorAll('#eventRows .tag[class*=fam-]').length };
    setF('eventFamilyFilter', 'user');
    (events as Record<string, unknown>).userFilter = document.querySelectorAll('#eventRows tr').length;
    setF('eventFamilyFilter', '');
    return { tenants, clients, apikeys, webhooks, audit, events };
  });
  const pass = a.tenants.rows === 5 && (a.tenants as Record<string, number>).suspendedFilter === 1
    && a.clients.rows === 4 && a.apikeys.rows === 4 && (a.apikeys as Record<string, number>).revokedFilter === 1
    && a.webhooks.rows === 3 && a.audit.rows === 7 && (a.audit as Record<string, number>).deleteFilter === 1
    && (a.audit as Record<string, boolean>).verifyBanner && a.events.rows === 6 && (a.events as Record<string, number>).userFilter === 2;
  rec('mgmt-pages', pass, a);
  expect(pass, 'mgmt-pages').toBe(true);
});

test('profile', async ({ page }) => {
  await page.goto(FILE);
  const a = await page.evaluate(() => {
    (document.querySelector('[data-page=profile]') as HTMLElement).click();
    const verifyBanner = document.getElementById('profileVerifyBanner')!.style.display !== 'none';
    (document.getElementById('sendVerifyBtn') as HTMLElement).click();
    const sendVerifyMsg = document.getElementById('verifyMsg')!.textContent;
    const nameBefore = document.getElementById('nameCell')!.textContent!.trim();
    (document.getElementById('nameEdit') as HTMLElement).click();
    (document.getElementById('nameInput') as HTMLInputElement).value = 'Jane Admin';
    (document.getElementById('nameSave') as HTMLElement).click();
    const nameAfter = document.getElementById('nameCell')!.textContent!.trim();
    const avatar = document.querySelector('.avatar')!.textContent;
    // password policy
    const set = (id: string, v: string) => { (document.getElementById(id) as HTMLInputElement).value = v; };
    set('pwdOld', 'old'); set('pwdNew', 'weak'); set('pwdConfirm', 'weak');
    (document.getElementById('pwdSubmit') as HTMLElement).click();
    const weak = document.getElementById('pwdErrorTx')!.textContent;
    set('pwdNew', 'Str0ng!Pass12'); set('pwdConfirm', 'Different!1x');
    (document.getElementById('pwdSubmit') as HTMLElement).click();
    const mismatch = document.getElementById('pwdErrorTx')!.textContent;
    set('pwdConfirm', 'Str0ng!Pass12');
    (document.getElementById('pwdSubmit') as HTMLElement).click();
    const validResetsFields = (document.getElementById('pwdNew') as HTMLInputElement).value === '';
    // oauth
    const oauthInitial = document.querySelectorAll('#oauthList .oauth-row').length;
    (document.querySelector('#oauthList [data-unlink=github]') as HTMLElement).click();
    const afterUnlink = document.querySelectorAll('#oauthList .oauth-row').length;
    const emptyState = !!document.querySelector('#oauthList .oauth-empty');
    (document.getElementById('bindGoogle') as HTMLElement).click();
    const afterBindGoogle = document.querySelectorAll('#oauthList .oauth-row').length;
    (document.getElementById('bindGithub') as HTMLElement).click();
    const afterBindGithub = document.querySelectorAll('#oauthList .oauth-row').length;
    return {
      verifyBanner, sendVerifyMsg,
      nameInlineEdit: { before: nameBefore, after: nameAfter, avatarInitials: avatar },
      email: document.getElementById('emailCell')!.textContent,
      statusActive: document.getElementById('statusCell')!.textContent!.includes('Active'),
      passwordPolicy: { weak, mismatch, validResetsFields, minLength: 12, dims: 5 },
      oauth: { initial: oauthInitial, afterUnlink, emptyState, afterBindGoogle, afterBindGithub },
    };
  });
  const pass = a.verifyBanner && a.nameInlineEdit.after === 'Jane Admin' && a.nameInlineEdit.avatarInitials === 'JA'
    && a.passwordPolicy.weak!.includes('12+') && a.passwordPolicy.mismatch === 'Passwords do not match'
    && a.passwordPolicy.validResetsFields && a.oauth.afterUnlink === 0 && a.oauth.emptyState
    && a.oauth.afterBindGoogle === 1 && a.oauth.afterBindGithub === 2;
  rec('profile', pass, a);
  expect(pass, 'profile').toBe(true);
});

test('contrast', async ({ page }) => {
  await page.goto(FILE);
  const a = await page.evaluate(() => {
    const lum = (rgb: number[]) => { const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const ratio = (c1: number[], c2: number[]) => { const l1 = lum(c1), l2 = lum(c2); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const parse = (s: string) => { const m = s.match(/rgba?\(([^)]+)\)/)!; const p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; };
    const comp = (rgba: number[]) => { const al = rgba[3]; return [0, 1, 2].map(i => Math.round(al * rgba[i] + (1 - al) * 255)); };
    const probe = (expr: string) => { const e = document.createElement('span'); e.style.color = expr; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return comp(parse(c)); };
    const W = [255, 255, 255];
    const sel = document.getElementById('styleSelect') as HTMLSelectElement;
    document.documentElement.dataset.theme = 'light';
    const packs: Record<string, unknown> = {};
    let allSemanticAbove45 = true;
    for (const s of ['broadsheet', 'geist', 'material', 'fluent', 'ant', 'carbon', 'cupertino']) {
      sel.value = s; sel.onchange!(new Event('change'));
      const m = {
        warnTag: +ratio(probe('var(--warn-text,var(--warn))'), W).toFixed(2),
        okTag: +ratio(probe('var(--ok-text,var(--ok))'), W).toFixed(2),
        dangerTag: +ratio(probe('var(--danger-text,var(--danger))'), W).toFixed(2),
        accentTag: +ratio(probe('var(--accent-text,var(--accent))'), W).toFixed(2),
        tx3: +ratio(probe('var(--tx3)'), W).toFixed(2),
      };
      packs[s] = m;
      if (Math.min(m.warnTag, m.okTag, m.dangerTag, m.accentTag) < 4.5) allSemanticAbove45 = false;
    }
    sel.value = 'broadsheet'; sel.onchange!(new Event('change'));
    return { packs, allSemanticAbove45 };
  });
  rec('contrast', a.allSemanticAbove45, a);
  expect(a.allSemanticAbove45, 'contrast: semantic tag text >=4.5:1 in all 7 packs').toBe(true);
});

test('all-pages-high-fidelity', async ({ page }) => {
  await page.goto(FILE);
  const a = await page.evaluate(() => ({
    placeholdersLeft: document.querySelectorAll('.placeholder').length,
    sections: document.querySelectorAll('section.page').length,
  }));
  const pass = a.placeholdersLeft === 0 && a.sections === 11;
  rec('all-pages-high-fidelity', pass, a);
  expect(pass, 'all-pages-high-fidelity').toBe(true);
});

test('a11y-keyboard', async ({ page }) => {
  await page.goto(FILE);
  // role-check is a keyboard-operable checkbox (adjudication 10 = B)
  await page.evaluate(() => {
    (document.querySelector('[data-page=groups]') as HTMLElement).click();
    (document.querySelector('#groupRows [data-manage="0"]') as HTMLElement).click();
    (document.querySelector('.tabs [data-tab=roles]') as HTMLElement).click();
  });
  const rc = page.locator('#roleChecks .role-check').first();
  const tag = await rc.evaluate(el => el.tagName);
  const role = await rc.getAttribute('role');
  const ariaBefore = await rc.getAttribute('aria-checked');
  await rc.focus();
  await page.keyboard.press('Enter');
  const ariaAfter = await page.locator('#roleChecks .role-check').first().getAttribute('aria-checked');
  const keyboardToggles = ariaBefore !== ariaAfter;
  // modal: dialog role + Escape closes + close button has accessible name
  await page.evaluate(() => {
    (document.querySelector('[data-page=tenants]') as HTMLElement).click();
    (document.querySelector('[data-create=tenants]') as HTMLElement).click();
  });
  const modalOpenBefore = await page.evaluate(() => document.getElementById('formModal')!.classList.contains('on'));
  await page.keyboard.press('Escape');
  const modalClosedByEscape = await page.evaluate(() => !document.getElementById('formModal')!.classList.contains('on'));
  const closeName = await page.evaluate(() => document.querySelector('#formModal .icon-btn.close')!.getAttribute('aria-label'));
  const dialogRole = await page.evaluate(() => document.querySelector('#formModal .modal')!.getAttribute('role'));
  // global :focus-visible ring (keyboard modality active after Tab)
  await page.keyboard.press('Tab');
  const focusRing = await page.evaluate(() => {
    const b = document.querySelector('#page-tenants .btn') as HTMLElement;
    b.focus();
    const cs = getComputedStyle(b);
    return cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px';
  });
  const a = { roleCheckTag: tag, roleCheckRole: role, keyboardToggles, modalOpenBefore, modalClosedByEscape, closeName, dialogRole, focusRing };
  const pass = tag === 'BUTTON' && role === 'checkbox' && keyboardToggles && modalOpenBefore
    && modalClosedByEscape && closeName === 'Close' && dialogRole === 'dialog' && focusRing;
  rec('a11y-keyboard', pass, a);
  expect(pass, 'a11y-keyboard').toBe(true);
});