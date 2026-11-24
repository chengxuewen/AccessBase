import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Reproducible harness for admin-console.html (adjudication 9 = A). Regenerates results.json.
// Each group navigates fresh (file:// reload resets all JS/mock state). Serial single worker
// (see playwright.config.ts) so the module-level results object is shared and written once.
const FILE = 'file://' + path.resolve(__dirname, '../admin-console.html');
const AUTH = 'file://' + path.resolve(__dirname, '../auth-flows.html');
const OUT = path.resolve(__dirname, 'results.json');

// Top-level const in the prototype's classic <script> lives in the global lexical scope —
// accessible as a bare identifier inside page.evaluate, but NOT on window/globalThis.
declare const GROUPS: { roles: string[] }[];

const results: Record<string, unknown> = {
  when: new Date().toISOString().slice(0, 10),
  prototype: 'admin-console.html v0.96 (12 pages incl. Settings; 7 style packs x light/dark)',
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
  const pass = a.statCards === 4 && !a.trendSvg && a.activityItems === 5; // adjudication 19: real has no chart
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
    f.value = 'suspended'; f.dispatchEvent(new Event('input'));
    const rows = [...document.querySelectorAll('#userRows tr')];
    return {
      disabledFilterRows: rows.length,
      allDisabled: rows.every(r => r.textContent!.includes('Suspended')),
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
    && a.editor.granted === '9/26' && a.editor.scope === 'dept' && a.toggle.reversible;
  rec('roles-matrix', pass, a);
  expect(pass, 'roles-matrix').toBe(true);
});

test('roles-edit', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 25 (A): staged matrix draft + Save/Cancel, async save w/ simulated updateError,
  // empty-draft danger confirm, non-mixed scope fan-out onto users:* scopes, mixed Select disabled,
  // async role delete w/ simulated deleteError.
  await page.evaluate(() => { (document.querySelector('[data-page=roles]') as HTMLElement).click(); (document.querySelector('#roleRows tr[data-role="1"]') as HTMLElement).click(); });
  const cell = () => page.evaluate(() => ([...document.querySelectorAll('#matrixRows .perm-cell:not(.na)')].find(c => (c as HTMLElement).dataset.code === 'users:delete') as HTMLButtonElement).click());
  await cell();
  const staged = await page.evaluate(() => ({ bar: document.getElementById('mtxBar')!.style.display === 'flex', committed: eval('ROLES')[1].perms.includes('users:delete'), on: document.querySelectorAll('#matrixRows .perm-cell.on').length }));
  await page.locator('#mtxCancel').click();
  const cancelled = await page.evaluate(() => ({ bar: document.getElementById('mtxBar')!.style.display === 'none', on: document.querySelectorAll('#matrixRows .perm-cell.on').length }));
  await cell();
  await page.locator('#mtxSave').click();
  const saveBusy = await page.evaluate(() => (document.getElementById('mtxSave') as HTMLButtonElement).disabled);
  await page.waitForTimeout(600);
  const saveErr = await page.evaluate(() => document.getElementById('mtxErr')!.style.display === 'flex');
  await page.locator('#mtxErrRetry').click();
  await page.waitForTimeout(600);
  const saved = await page.evaluate(() => ({ committed: eval('ROLES')[1].perms.includes('users:delete'), bar: document.getElementById('mtxBar')!.style.display === 'none' }));
  // scope fan-out on save (non-mixed)
  await page.evaluate(() => { const s = document.getElementById('scopeSelect') as HTMLSelectElement; s.value = 'self'; s.onchange!(new Event('change')); });
  await page.locator('#mtxSave').click();
  await page.waitForTimeout(600);
  await page.locator('#mtxErrRetry').click();
  await page.waitForTimeout(600);
  const fanout = await page.evaluate(() => ({ scopes: eval('ROLES')[1].scopes, scope: eval('ROLES')[1].scope }));
  // mixed role: Select disabled + value mixed + tag
  await page.evaluate(() => { (document.querySelector('#roleRows tr[data-role="3"]') as HTMLElement).click(); });
  const mixed = await page.evaluate(() => ({ disabled: (document.getElementById('scopeSelect') as HTMLSelectElement).disabled, value: (document.getElementById('scopeSelect') as HTMLSelectElement).value, tag: document.getElementById('scopeMixed')!.style.display !== 'none' }));
  // empty draft -> danger confirm on Save, async failure then wipe
  await page.evaluate(() => { (document.querySelector('#roleRows tr[data-role="1"]') as HTMLElement).click(); });
  await page.locator('#clearPermsBtn').click();
  const emptyStaged = await page.evaluate(() => ({ bar: document.getElementById('mtxBar')!.style.display === 'flex', on: document.querySelectorAll('#matrixRows .perm-cell.on').length }));
  await page.locator('#mtxSave').click();
  const emptyConf = await page.evaluate(() => ({ on: document.getElementById('confirmModal')!.classList.contains('on'), verb: document.getElementById('confirmDelete')!.textContent }));
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600);
  const emptyFail = await page.evaluate(() => ({ err: document.getElementById('confirmErr')!.style.display === 'flex', kept: eval('ROLES')[1].perms.length }));
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600);
  const wiped = await page.evaluate(() => ({ perms: eval('ROLES')[1].perms.length, closed: !document.getElementById('confirmModal')!.classList.contains('on') }));
  // async delete w/ simulated failure keeps the row, retry deletes
  const rows0 = await page.evaluate(() => eval('ROLES').length);
  await page.evaluate(() => { (document.querySelector('#roleRows tr[data-role="2"] button[aria-label="Delete"]') as HTMLElement).click(); });
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600);
  const delFail = await page.evaluate(() => ({ err: document.getElementById('confirmErr')!.style.display === 'flex', rows: eval('ROLES').length }));
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600);
  const delOk = await page.evaluate(() => eval('ROLES').length);
  const a = { staged, cancelled, saveBusy, saveErr, saved, fanout, mixed, emptyStaged, emptyConf, emptyFail, wiped, rows0, delFail, delOk };
  const pass = staged.bar && !staged.committed && cancelled.bar && cancelled.on === staged.on - 1
    && saveBusy && saveErr && saved.committed && saved.bar
    && fanout.scopes['users:read'] === 'self' && fanout.scopes['users:write'] === 'self' && fanout.scope === 'self'
    && mixed.disabled && mixed.value === 'mixed' && mixed.tag
    && emptyStaged.bar && emptyStaged.on === 0 && emptyConf.on && emptyConf.verb === 'Save empty'
    && emptyFail.err && emptyFail.kept > 0 && wiped.perms === 0 && wiped.closed
    && delFail.err && delFail.rows === rows0 && delOk === rows0 - 1;
  rec('roles-edit', pass, a);
  expect(pass, 'roles-edit').toBe(true);
});

test('groups-detail', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 26 (A): detail/candidates/add/remove/saveRoles are async with simulated first
  // failures; staged role draft preserved; create/edit carry the isDepartment switch.
  await page.evaluate(() => { (document.querySelector('[data-page=groups]') as HTMLElement).click(); });
  const base = await page.evaluate(() => ({
    groupRows: document.querySelectorAll('#groupRows tr').length,
    deptTags: document.querySelectorAll('#groupRows .kind-dept').length,
    createWired: !document.querySelector('#page-groups [data-create=groups]')!.hasAttribute('disabled'),
  }));
  await page.locator('#groupRows [data-manage="0"]').click();
  const skel = await page.evaluate(() => document.querySelectorAll('#memberList .skel').length);
  await page.waitForTimeout(600);
  const detailErr = await page.evaluate(() => document.getElementById('grpDetailErr')!.style.display === 'flex');
  await page.locator('#grpDetailRetry').click();
  const membersInitial = await page.evaluate(() => document.querySelectorAll('#memberList li').length);
  await page.waitForTimeout(600);
  const candErr = await page.evaluate(() => document.getElementById('grpMemberErr')!.style.display === 'flex');
  await page.locator('#grpMemberRetry').click();
  await page.waitForTimeout(600);
  const pickerCandidates = await page.evaluate(() => (document.getElementById('memberPicker') as HTMLSelectElement).options.length - 1);
  const panel = await page.evaluate(() => ({ name: document.getElementById('panelName')!.textContent, kind: document.getElementById('panelKind')!.textContent }));
  await page.evaluate(() => { const pk = document.getElementById('memberPicker') as HTMLSelectElement; pk.value = pk.options[1].value; });
  await page.locator('#addMemberBtn').click();
  await page.waitForTimeout(600); // simulated add failure
  await page.locator('#addMemberBtn').click();
  await page.waitForTimeout(600);
  const afterAdd = await page.evaluate(() => document.querySelectorAll('#memberList li').length);
  await page.locator('#memberList [data-rm]').first().click();
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600); // simulated remove failure keeps the member
  const remFail = await page.evaluate(() => ({ err: document.getElementById('confirmErr')!.style.display === 'flex', n: document.querySelectorAll('#memberList li').length }));
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600);
  const afterRemove = await page.evaluate(() => document.querySelectorAll('#memberList li').length);
  await page.locator('.tabs [data-tab=roles]').click();
  const checks = await page.evaluate(() => document.querySelectorAll('#roleChecks .role-check').length);
  const committedBefore = await page.evaluate(() => eval('GROUPS')[0].roles.length);
  await page.locator('#roleChecks .role-check').first().click();
  const stagedNotCommitted = await page.evaluate((b) => eval('GROUPS')[0].roles.length === b, committedBefore);
  await page.locator('#saveRolesBtn').click();
  await page.waitForTimeout(600);
  const rolesErr = await page.evaluate(() => document.getElementById('grpRolesErr')!.style.display === 'flex');
  await page.locator('#grpRolesRetry').click();
  await page.waitForTimeout(600);
  const saveCommits = await page.evaluate((b) => eval('GROUPS')[0].roles.length !== b, committedBefore);
  await page.locator('#roleChecks .role-check').first().click();
  await page.locator('#saveRolesBtn').click();
  await page.waitForTimeout(600); // restore (tried flag now true)
  await page.locator('#panelClose').click();
  const panelClose = await page.evaluate(() => document.getElementById('groupPanel')!.style.display === 'none');
  // create form carries the isDepartment checkbox (boolean-control rule); edit maps kind
  await page.locator('[data-create=groups]').click();
  const createForm = await page.evaluate(() => ({ sw: (document.querySelector('#formBody [data-field=isDepartment]') as HTMLInputElement).type, role: document.querySelector('#formBody [data-field=isDepartment]')!.getAttribute('role'), w: getComputedStyle(document.querySelector('#formBody [data-field=isDepartment]')!).width }));
  await page.locator('#formBody [data-field=name]').fill('E2E Group');
  await page.locator('#formBody [data-field=isDepartment]').check();
  await page.locator('#formSave').click();
  await page.waitForTimeout(600); // simulated create failure
  await page.locator('#formSave').click();
  await page.waitForTimeout(600);
  const created = await page.evaluate(() => ({ n: eval('GROUPS').length, kind: eval('GROUPS')[eval('GROUPS').length - 1].kind, closed: !document.getElementById('formModal')!.classList.contains('on') }));
  const a = { base, skel, detailErr, membersInitial, candErr, pickerCandidates, panel, afterAdd, remFail, afterRemove, checks, stagedNotCommitted, rolesErr, saveCommits, panelClose, createForm, created };
  const pass = base.groupRows === 5 && base.deptTags === 2 && base.createWired
    && skel === 3 && detailErr && candErr && pickerCandidates > 0
    && panel.name === 'Engineering' && panel.kind === 'Department'
    && afterAdd === membersInitial + 1 && remFail.err && remFail.n === afterAdd && afterRemove === membersInitial
    && checks === 5 && stagedNotCommitted && rolesErr && saveCommits && panelClose
    && createForm.sw === 'checkbox' && createForm.role === null && createForm.w === '16px'
    && created.n === 6 && created.kind === 'department' && created.closed;
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
    const ts = document.getElementById('tenantSearch') as HTMLInputElement;
    ts.value = 'initech'; ts.dispatchEvent(new Event('input'));
    (tenants as Record<string, unknown>).suspendedFilter = document.querySelectorAll('#tenantRows tr').length;
    ts.value = ''; ts.dispatchEvent(new Event('input'));
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
    click('events');
    const events = { rows: document.querySelectorAll('#eventRows tr').length, familyTags: document.querySelectorAll('#eventRows .tag[class*=fam-]').length };
    setF('eventFamilyFilter', 'user');
    (events as Record<string, unknown>).userFilter = document.querySelectorAll('#eventRows tr').length;
    setF('eventFamilyFilter', '');
    return { tenants, clients, apikeys, webhooks, audit, events };
  });
  // adjudication 18: verify is async (Busy) — first attempt fails with a structured report, retry ok
  await page.locator('[data-page=audit]').click();
  await page.locator('#verifyBtn').click();
  await page.waitForTimeout(700);
  (a.audit as Record<string, unknown>).verifyErrBanner = await page.evaluate(() => document.getElementById('auditErrBanner')!.style.display === 'flex');
  await page.locator('#auditRetry').click();
  await page.waitForTimeout(700);
  (a.audit as Record<string, unknown>).verifyBanner = await page.evaluate(() => document.getElementById('auditVerifyBanner')!.style.display === 'flex');
  const pass = a.tenants.rows === 5 && (a.tenants as Record<string, number>).suspendedFilter === 1
    && a.clients.rows === 4 && a.apikeys.rows === 4 && (a.apikeys as Record<string, number>).revokedFilter === 1
    && a.webhooks.rows === 3 && a.audit.rows === 7 && (a.audit as Record<string, number>).deleteFilter === 1
    && (a.audit as Record<string, boolean>).verifyErrBanner && (a.audit as Record<string, boolean>).verifyBanner && a.events.rows === 8 && (a.events as Record<string, number>).userFilter === 2;
  rec('mgmt-pages', pass, a);
  expect(pass, 'mgmt-pages').toBe(true);
});

test('profile', async ({ page }) => {
  await page.goto(FILE);
  // adjudication 20: verify/name/password/unlink are async w/ Busy + simulated first failure
  await page.evaluate(() => { (document.querySelector('[data-page=profile]') as HTMLElement).click(); });
  const verifyBanner = await page.evaluate(() => document.getElementById('profileVerifyBanner')!.style.display !== 'none');
  await page.locator('#sendVerifyBtn').click();
  await page.waitForTimeout(600);
  await page.locator('#sendVerifyBtn').click();
  await page.waitForTimeout(600);
  const sendVerifyMsg = await page.evaluate(() => document.getElementById('verifyMsg')!.textContent);
  const nameBefore = await page.evaluate(() => document.getElementById('nameCell')!.textContent!.trim());
  await page.locator('#nameEdit').click();
  await page.locator('#nameInput').fill('Jane Admin');
  await page.locator('#nameSave').click();
  await page.waitForTimeout(600);
  await page.locator('#nameSave').click();
  await page.waitForTimeout(600);
  const nameAfter = await page.evaluate(() => document.getElementById('nameCell')!.textContent!.trim());
  const avatar = await page.evaluate(() => document.querySelector('.avatar')!.textContent);
  const a = await page.evaluate(() => {
    // password policy
    const set = (id: string, v: string) => { (document.getElementById(id) as HTMLInputElement).value = v; };
    set('pwdOld', 'old'); set('pwdNew', 'weak'); set('pwdConfirm', 'weak');
    (document.getElementById('pwdSubmit') as HTMLElement).click();
    const weak = document.getElementById('pwdErrorTx')!.textContent;
    set('pwdNew', 'Str0ng!Pass12'); set('pwdConfirm', 'Different!1x');
    (document.getElementById('pwdSubmit') as HTMLElement).click();
    const mismatch = document.getElementById('pwdErrorTx')!.textContent;
    set('pwdConfirm', 'Str0ng!Pass12');
    const oauthInitial = document.querySelectorAll('#oauthList .oauth-row').length;
    return {
      email: document.getElementById('emailCell')!.textContent,
      statusActive: document.getElementById('statusCell')!.textContent!.includes('Active'),
      passwordPolicy: { weak, mismatch, minLength: 12, dims: 5 },
      oauth: { initial: oauthInitial },
    };
  });
  await page.locator('#pwdSubmit').click();
  await page.waitForTimeout(600); // simulated server rejection keeps fields
  await page.locator('#pwdSubmit').click();
  await page.waitForTimeout(600);
  (a.passwordPolicy as Record<string, unknown>).validResetsFields = await page.evaluate(() => (document.getElementById('pwdNew') as HTMLInputElement).value === '');
  await page.locator('#oauthList [data-unlink=github]').click();
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600); // simulated unlink failure keeps the link
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600);
  const afterUnlink = await page.evaluate(() => document.querySelectorAll('#oauthList .oauth-row').length);
  const emptyState = await page.evaluate(() => !!document.querySelector('#oauthList .oauth-empty'));
  await page.locator('#bindGoogle').click();
  const afterBindGoogle = await page.evaluate(() => document.querySelectorAll('#oauthList .oauth-row').length);
  await page.locator('#bindGithub').click();
  const afterBindGithub = await page.evaluate(() => document.querySelectorAll('#oauthList .oauth-row').length);
  Object.assign(a.oauth as Record<string, unknown>, { afterUnlink, emptyState, afterBindGoogle, afterBindGithub });
  Object.assign(a, { verifyBanner, sendVerifyMsg, nameInlineEdit: { before: nameBefore, after: nameAfter, avatarInitials: avatar } });
  const pass = a.verifyBanner && a.nameInlineEdit.after === 'Jane Admin' && a.nameInlineEdit.avatarInitials === 'JA'
    && a.passwordPolicy.weak!.includes('12+') && a.passwordPolicy.mismatch === 'Passwords do not match'
    && a.passwordPolicy.validResetsFields && a.oauth.afterUnlink === 0 && a.oauth.emptyState
    && a.oauth.afterBindGoogle === 1 && a.oauth.afterBindGithub === 2;
  rec('profile', pass, a);
  expect(pass, 'profile').toBe(true);
});

test('profile-async', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 20 (A): verify / name-save / password-change / unlink are async with Busy states and
  // failure branches (simulated first attempt, disclosed); name edit has required validation + cancel.
  await page.evaluate(() => { (document.querySelector('[data-page=profile]') as HTMLElement).click(); });
  await page.locator('#sendVerifyBtn').click();
  const vBusy = await page.evaluate(() => (document.getElementById('sendVerifyBtn') as HTMLButtonElement).disabled);
  await page.waitForTimeout(600);
  const vFail = await page.evaluate(() => ({ msg: document.getElementById('verifyMsg')!.textContent!, err: document.getElementById('verifyMsg')!.className.includes('err') }));
  await page.locator('#sendVerifyBtn').click();
  await page.waitForTimeout(600);
  const vOk = await page.evaluate(() => ({ msg: document.getElementById('verifyMsg')!.textContent!, err: document.getElementById('verifyMsg')!.className.includes('err') }));
  await page.locator('#nameEdit').click();
  await page.locator('#nameInput').fill('');
  await page.locator('#nameSave').click();
  const nReq = await page.evaluate(() => ({ err: document.getElementById('nameErr')!.textContent!, editing: !!document.getElementById('nameInput') }));
  await page.locator('#nameCancel').click();
  const nCancel = await page.evaluate(() => !document.getElementById('nameInput') && document.getElementById('nameCell')!.textContent!.includes('Admin User'));
  await page.locator('#nameEdit').click();
  await page.locator('#nameInput').fill('Async Admin');
  await page.locator('#nameSave').click();
  const nBusy = await page.evaluate(() => (document.getElementById('nameSave') as HTMLButtonElement).disabled);
  await page.waitForTimeout(600);
  const nFail = await page.evaluate(() => document.getElementById('nameErr')!.textContent!.includes('Save failed'));
  await page.locator('#nameSave').click();
  await page.waitForTimeout(600);
  const nOk = await page.evaluate(() => document.getElementById('nameCell')!.textContent!.includes('Async Admin'));
  const set = (id: string, v: string) => page.locator('#' + id).fill(v);
  await set('pwdOld', 'Old!Pass1234'); await set('pwdNew', 'Str0ng!Pass12'); await set('pwdConfirm', 'Str0ng!Pass12');
  await page.locator('#pwdSubmit').click();
  const pBusy = await page.evaluate(() => (document.getElementById('pwdSubmit') as HTMLButtonElement).disabled);
  await page.waitForTimeout(600);
  const pFail = await page.evaluate(() => ({ err: document.getElementById('pwdErrorTx')!.textContent!.includes('rejected by server'), kept: (document.getElementById('pwdNew') as HTMLInputElement).value !== '' }));
  await page.locator('#pwdSubmit').click();
  await page.waitForTimeout(600);
  const pOk = await page.evaluate(() => ({ cleared: (document.getElementById('pwdNew') as HTMLInputElement).value === '', toast: document.getElementById('protoToast')!.textContent }));
  const o0 = await page.evaluate(() => document.querySelectorAll('#oauthList .oauth-row').length);
  await page.locator('#oauthList [data-unlink]').first().click();
  await page.locator('#confirmDelete').click();
  const oBusy = await page.evaluate(() => (document.getElementById('confirmDelete') as HTMLButtonElement).disabled);
  await page.waitForTimeout(600);
  const oFail = await page.evaluate(() => ({ err: document.getElementById('confirmErr')!.textContent!.includes('provider unreachable'), kept: document.querySelectorAll('#oauthList .oauth-row').length }));
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600);
  const oOk = await page.evaluate(() => ({ rows: document.querySelectorAll('#oauthList .oauth-row').length, closed: !document.getElementById('confirmModal')!.classList.contains('on') }));
  const a = { vBusy, vFail, vOk, nReq, nCancel, nBusy, nFail, nOk, pBusy, pFail, pOk, o0, oBusy, oFail, oOk };
  const pass = vBusy && vFail.err && vFail.msg.includes('failed') && !vOk.err && vOk.msg.includes('sent')
    && nReq.err === 'Name is required' && nReq.editing && nCancel && nBusy && nFail && nOk
    && pBusy && pFail.err && pFail.kept && pOk.cleared && pOk.toast.includes('other sessions signed out')
    && oBusy && oFail.err && oFail.kept === o0 && oOk.rows === o0 - 1 && oOk.closed;
  rec('profile-async', pass, a);
  expect(pass, 'profile-async').toBe(true);
});

test('surfaces-contrast', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 21 (A): the contrast lock extends beyond semantic tags to EVERY tint-bearing text
  // surface (banners, verify-msg, activity action tag, meta lines, sys-tag, count-pill) across all
  // 7 packs x light/dark, with alpha-composited backgrounds (tints are translucent).
  const a = await page.evaluate(() => {
    const parse = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); return m.length >= 4 ? m : [m[0], m[1], m[2], 1]; };
    const over = (f: number[], b: number[]) => { const al = f[3]; return [f[0] * al + b[0] * (1 - al), f[1] * al + b[1] * (1 - al), f[2] * al + b[2] * (1 - al), 1]; };
    const res = (el: Element) => { let e: Element | null = el; const stack: number[][] = []; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] === 1) break; e = e.parentElement; } let base = [255, 255, 255, 1]; for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base); return base; };
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (x: number[], y: number[]) => { const l1 = lum(x), l2 = lum(y); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const packs = ['broadsheet', 'geist', 'material', 'fluent', 'ant', 'carbon', 'cupertino'];
    const sets: Record<string, string[]> = {
      users: ['#userRows .tag.ok', '#userRows .tag.danger', '#userRows .count-pill', '#page-users .cbx-opt[aria-selected="true"]'],
      roles: ['#roleRows .sys-tag'],
      audit: ['#auditRows .tag', '#auditVerifyBanner span', '#auditVerifyBanner .hash', '#auditErrBanner span'],
      profile: ['#profileVerifyBanner div', '#verifyMsg', '#statusCell .tag'],
      dashboard: ['#activity .t .tag', '#activity .m'],
      settings: ['#sessionRows .tag', '#optionRows .mono'],
    };
    const fails: string[] = []; let checked = 0; let min = 99;
    for (const p of packs) for (const th of ['light', 'dark']) {
      const s = document.getElementById('styleSelect') as HTMLSelectElement; s.value = p; s.onchange!(new Event('change'));
      document.documentElement.dataset.theme = th;
      for (const pg of Object.keys(sets)) {
        (document.querySelector('[data-page=' + pg + ']') as HTMLElement).click();
        if (pg === 'users') { const cb = document.querySelector('#page-users .toolbar .cbx-btn') as HTMLElement; if (cb) cb.click(); }
        for (const sel of sets[pg]) {
          const el = document.querySelector(sel); if (!el) continue;
          checked++;
          const r = ratio(parse(getComputedStyle(el).color), res(el));
          min = Math.min(min, r);
          if (r < 4.5) fails.push(p + '/' + th + ' ' + sel + ' ' + r.toFixed(2));
        }
      }
    }
    return { checked, min: Number(min.toFixed(2)), fails };
  });
  // Adjudication 34 (A): the lock set must cover the companion's new tint surfaces too.
  await page.goto(AUTH);
  const b = await page.evaluate(() => {
    const parse = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); return m.length >= 4 ? m : [m[0], m[1], m[2], 1]; };
    const over = (f: number[], b2: number[]) => { const al = f[3]; return [f[0] * al + b2[0] * (1 - al), f[1] * al + b2[1] * (1 - al), f[2] * al + b2[2] * (1 - al), 1]; };
    const res = (el: Element) => { let e: Element | null = el; const stack: number[][] = []; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] === 1) break; e = e.parentElement; } let base = [255, 255, 255, 1]; for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base); return base; };
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (x: number[], y: number[]) => { const l1 = lum(x), l2 = lum(y); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    document.querySelectorAll('.flow').forEach(f => f.classList.add('on'));
    (document.getElementById('lgOk') as HTMLElement).style.display = 'flex';
    (document.getElementById('csBody') as HTMLElement).style.display = 'block';
    (document.getElementById('csRedirecting') as HTMLElement).style.display = 'flex';
    (document.getElementById('enRecovery') as HTMLElement).style.display = 'block';
    (document.getElementById('suSteps')!.children[1] as HTMLElement).className = 'st done';
    (document.querySelector('#flow-magic .cbx-btn') as HTMLElement).click();
    const sels = ['#lgOk span', '#csRedirecting span', '#suSteps .st.on', '#suSteps .st.done', '#enUrl', '.auth-nav button.on', '#enRecovery .auth-ok span', '#mkOk span', '#flow-magic .cbx-opt[aria-selected="true"]'];
    const packs = ['broadsheet', 'geist', 'material', 'fluent', 'ant', 'carbon', 'cupertino'];
    const fails: string[] = []; let checked = 0; let min = 99;
    for (const p of packs) for (const th of ['light', 'dark']) {
      const s = document.getElementById('styleSelect') as HTMLSelectElement; s.value = p; s.onchange!(new Event('change'));
      document.documentElement.dataset.theme = th;
      for (const sel of sels) {
        const el = document.querySelector(sel); if (!el) continue;
        checked++;
        const r = ratio(parse(getComputedStyle(el).color), res(el));
        min = Math.min(min, r);
        if (r < 4.5) fails.push(p + '/' + th + ' ' + sel + ' ' + r.toFixed(2));
      }
    }
    return { checked, min: Number(min.toFixed(2)), fails };
  });
  const pass = a.checked >= 190 && a.fails.length === 0 && a.min >= 4.5
    && b.checked >= 110 && b.fails.length === 0 && b.min >= 4.5;
  rec('surfaces-contrast', pass, { admin: a, companion: b });
  expect(pass, 'surfaces-contrast').toBe(true);
});

test('contrast', async ({ page }) => {
  await page.goto(FILE);
  const a = await page.evaluate(() => {
    const lum = (rgb: number[]) => { const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const ratio = (c1: number[], c2: number[]) => { const l1 = lum(c1), l2 = lum(c2); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const parse = (s: string) => { const m = s.match(/rgba?\(([^)]+)\)/)!; const p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; };
    const comp = (rgba: number[]) => { const al = rgba[3]; return [0, 1, 2].map(i => Math.round(al * rgba[i] + (1 - al) * 255)); };
    const probeRaw = (expr: string) => { const e = document.createElement('span'); e.style.color = expr; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return parse(c); };
    const compOn = (rgba: number[], base: number[]) => { const al = rgba[3]; return [0, 1, 2].map(i => Math.round(al * rgba[i] + (1 - al) * base[i])); };
    const probe = (expr: string) => { const e = document.createElement('span'); e.style.color = expr; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return comp(parse(c)); };
    const W = [255, 255, 255];
    const sel = document.getElementById('styleSelect') as HTMLSelectElement;
    const packs: Record<string, unknown> = {};
    let allSemanticAbove45 = true;
    // ruling 1A: tx3-bearing text and the nav-on tint pair are semantic surfaces; lock them in
    // BOTH themes against their real composited backgrounds (surface / sunken / tint-over-surface).
    for (const theme of ['light', 'dark']) {
      document.documentElement.dataset.theme = theme;
      for (const s of ['broadsheet', 'geist', 'material', 'fluent', 'ant', 'carbon', 'cupertino']) {
        sel.value = s; sel.onchange!(new Event('change'));
        const surface = probeRaw('var(--surface)');
        const sunken = probeRaw('var(--sunken)');
        const tintBg = compOn(probeRaw('var(--accent-tint)'), surface);
        const navFg = compOn(probeRaw('var(--accent-text,var(--tx1))'), tintBg);
        const tagBg = (tint: string) => compOn(probeRaw(tint), surface);
        const onTag = (expr: string, tint: string) => { const bg = tagBg(tint); return +ratio(compOn(probeRaw(expr), bg), bg).toFixed(2); };
        const m = {
          warnTag: onTag('var(--warn-text,var(--warn))', 'var(--warn-tint)'),
          okTag: onTag('var(--ok-text,var(--ok))', 'var(--ok-tint)'),
          dangerTag: onTag('var(--danger-text,var(--danger))', 'var(--danger-tint)'),
          accentTag: onTag('var(--accent-text,var(--accent))', 'var(--accent-tint)'),
          tx3: +ratio(compOn(probeRaw('var(--tx3)'), surface), surface).toFixed(2),
          tx3Surface: +ratio(compOn(probeRaw('var(--tx3)'), surface), surface).toFixed(2),
          tx3Sunken: +ratio(compOn(probeRaw('var(--tx3)'), sunken), sunken).toFixed(2),
          navOn: +ratio(navFg, tintBg).toFixed(2),
        };
        packs[s + ':' + theme] = m;
        if (Math.min(m.warnTag, m.okTag, m.dangerTag, m.accentTag, m.tx3Surface, m.tx3Sunken, m.navOn) < 4.5) allSemanticAbove45 = false;
      }
    }
    document.documentElement.dataset.theme = 'light';
    sel.value = 'broadsheet'; sel.onchange!(new Event('change'));
    return { packs, allSemanticAbove45 };
  });
  rec('contrast', a.allSemanticAbove45, a);
  expect(a.allSemanticAbove45, 'contrast: semantic + tx3 + nav-on text >=4.5:1 in all 7 packs x both themes').toBe(true);
});

test('all-pages-high-fidelity', async ({ page }) => {
  await page.goto(FILE);
  const a = await page.evaluate(() => ({
    placeholdersLeft: document.querySelectorAll('.placeholder').length,
    sections: document.querySelectorAll('section.page').length,
  }));
  const pass = a.placeholdersLeft === 0 && a.sections === 12;
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
  await page.waitForTimeout(600); // adjudication 26: detail load async, first attempt simulated failure
  await page.locator('#grpDetailRetry').click();
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

test('tooltip', async ({ page }) => {
  await page.goto(FILE);
  // Post-closure fix: one body-level fixed tooltip replaces the CSS ::after bubble, which was clipped
  // by tbody td{overflow:hidden} and overpainted by later rows' sticky actions cells (z-index:2), and
  // clipped by table/modal scroll containers. Lock the whole class: for hosts in every risky context
  // the bubble must be visible, on top at its own center (elementFromPoint), and inside the viewport.
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); });
  const edit = page.locator('#userRows button[data-tip="Edit"]').first();
  const aria = await edit.getAttribute('aria-label');
  const tip = await edit.getAttribute('data-tip');
  const hiddenOpacity = await page.evaluate(() => getComputedStyle(document.getElementById('floatTip')!).opacity);
  const probe = async (sel: string) => {
    const host = page.locator(sel).first();
    await host.hover();
    await page.waitForTimeout(200);
    return page.evaluate((s) => {
      const h = document.querySelector(s)!;
      const ft = document.getElementById('floatTip')!;
      const r = ft.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      ft.style.pointerEvents = 'auto'; // hit-test probe only; painting order is unchanged
      const topEl = document.elementFromPoint(cx, cy);
      ft.style.pointerEvents = 'none';
      return {
        on: ft.classList.contains('on'),
        text: ft.textContent,
        want: h.getAttribute('data-tip'),
        opacity: getComputedStyle(ft).opacity,
        onTop: topEl === ft,
        inViewport: r.top >= 0 && r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
        described: h.getAttribute('aria-describedby') === 'floatTip',
      };
    }, sel);
  };
  const stickyRow = await probe('#userRows button[data-tip="Edit"]');
  const wrapperEdge = await probe('[data-reload=users]');
  const flipTop = await probe('#themeBtn');
  await page.evaluate(() => { (document.querySelector('[data-page=tenants]') as HTMLElement).click(); });
  const clippedCell = await probe('#tenantRows .copyable button[data-tip="Copy"]');
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); });
  // focus reveal (keyboard parity)
  await page.locator('#userRows button[data-tip="View"]').first().focus();
  await page.waitForTimeout(200);
  const focusTip = await page.evaluate(() => ({ on: document.getElementById('floatTip')!.classList.contains('on'), text: document.getElementById('floatTip')!.textContent }));
  // modal-internal host: bubble must escape the modal scroll container
  await page.evaluate(() => { (document.querySelector('#userRows [data-detail="user"]') as HTMLElement).click(); });
  await page.locator('#detailModal .icon-btn.close').focus();
  await page.waitForTimeout(200);
  const modalTip = await page.evaluate(() => {
    const h = document.querySelector('#detailModal .icon-btn.close')!;
    const ft = document.getElementById('floatTip')!;
    const r = ft.getBoundingClientRect();
    ft.style.pointerEvents = 'auto';
    const topEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    ft.style.pointerEvents = 'none';
    return { on: ft.classList.contains('on'), text: ft.textContent, want: h.getAttribute('data-tip'), opacity: getComputedStyle(ft).opacity, onTop: topEl === ft, inViewport: r.top >= 0 && r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight, described: h.getAttribute('aria-describedby') === 'floatTip' };
  });
  const dStatus = await page.evaluate(() => {
    const b = document.querySelector('#detailBody [data-dstatus]') as HTMLButtonElement;
    const r = b.getBoundingClientRect();
    return { present: !!b, cls: b.className.includes('wswitch'), w: r.width, h: r.height, on: b.className.includes('on'), knob: !!b.querySelector('.knob') };
  });
  await page.locator('#detailBody [data-dstatus]').click();
  await page.waitForTimeout(600);
  const dFail = await page.evaluate(() => document.getElementById('protoToast')!.textContent!.includes('Failed to update status'));
  await page.locator('#detailBody [data-dstatus]').click();
  await page.waitForTimeout(600);
  const dOk = await page.evaluate(() => ({ toast: document.getElementById('protoToast')!.textContent, on: (document.querySelector('#detailBody [data-dstatus]') as HTMLButtonElement).className.includes('on'), row: document.getElementById('userRows')!.textContent!.includes('Suspended') }));
  await page.keyboard.press('Escape');
  // disabled (locked) row action keeps its .tip-wrap host so the hint still shows
  await page.evaluate(() => { (document.querySelector('[data-page=roles]') as HTMLElement).click(); });
  const wrap = page.locator('#roleRows .tip-wrap').first();
  const wrapTip = await wrap.getAttribute('data-tip');
  const btnDisabled = await wrap.locator('button').evaluate(el => (el as HTMLButtonElement).disabled);
  const btnAria = await wrap.locator('button').getAttribute('aria-label');
  await wrap.hover();
  await page.waitForTimeout(200);
  const wrapOn = await page.evaluate(() => document.getElementById('floatTip')!.classList.contains('on') && document.getElementById('floatTip')!.textContent === document.querySelector('#roleRows .tip-wrap')!.getAttribute('data-tip'));
  // leave hides
  await page.mouse.move(5, 5);
  await page.waitForTimeout(200);
  const hiddenAfter = await page.evaluate(() => !document.getElementById('floatTip')!.classList.contains('on'));
  const contexts = [stickyRow, clippedCell, wrapperEdge, flipTop, modalTip];
  const a = { aria, tip, hiddenOpacity, contexts, focusTip, wrapTip, btnDisabled, btnAria, wrapOn, hiddenAfter, dStatus, dFail, dOk };
  const pass = aria === 'Edit' && tip === 'Edit' && hiddenOpacity === '0'
    && contexts.every(c => c.on && c.text === c.want && c.opacity === '1' && c.onTop && c.inViewport && c.described)
    && focusTip.on && focusTip.text === 'View' && btnDisabled && btnAria === wrapTip && wrapOn && hiddenAfter
    && dStatus.present && dStatus.cls && dStatus.w === 34 && dStatus.h === 20 && dStatus.on && dStatus.knob
    && dFail && dOk.toast === 'Status updated' && !dOk.on && dOk.row;
  rec('tooltip', pass, a);
  expect(pass, 'tooltip').toBe(true);
});

test('overflow-menu', async ({ page }) => {
  await page.goto(FILE);
  // R2=A: Users "More" is a real overflow menu (secondary/danger actions), keyboard + Esc.
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); });
  const more = page.locator('#userRows [data-more]').first();
  const haspopup = await more.getAttribute('aria-haspopup');
  const expandedBefore = await more.getAttribute('aria-expanded');
  await more.click();
  const menuOn = await page.evaluate(() => document.getElementById('rowMenu')!.classList.contains('on'));
  const expandedAfter = await more.getAttribute('aria-expanded');
  const itemCount = await page.locator('#rowMenu .menu-item').count();
  const roles = await page.evaluate(() => [...document.querySelectorAll('#rowMenu .menu-item')].every(b => b.getAttribute('role') === 'menuitem'));
  const dangerItem = await page.locator('#rowMenu .menu-item.danger').count();
  const firstFocused = await page.evaluate(() => document.activeElement?.classList.contains('menu-item'));
  await page.keyboard.press('Escape');
  const closedByEsc = await page.evaluate(() => !document.getElementById('rowMenu')!.classList.contains('on'));
  const expandedClosed = await more.getAttribute('aria-expanded');
  const focusReturned = await page.evaluate(() => document.activeElement?.hasAttribute('data-more'));
  await more.click();
  await page.locator('#rowMenu .menu-item').first().click();
  // first item is now Force logout (adjudication 6): confirm-gated, not a toast
  const forceConfirm = await page.evaluate(() => document.getElementById('confirmModal')!.classList.contains('on') && document.getElementById('confirmDelete')!.textContent === 'Force logout');
  await page.locator('#confirmModal [data-close=confirmModal]').first().click();
  const closedAfterSelect = await page.evaluate(() => !document.getElementById('rowMenu')!.classList.contains('on'));
  const a = { haspopup, expandedBefore, menuOn, expandedAfter, itemCount, roles, dangerItem, firstFocused, closedByEsc, expandedClosed, focusReturned, forceConfirm, closedAfterSelect };
  const pass = haspopup === 'menu' && expandedBefore === 'false' && menuOn && expandedAfter === 'true'
    && itemCount === 3 && roles && dangerItem === 1 && firstFocused && closedByEsc && expandedClosed === 'false'
    && focusReturned && forceConfirm && closedAfterSelect;
  rec('overflow-menu', pass, a);
  expect(pass, 'overflow-menu').toBe(true);
});

test('content-detail', async ({ page }) => {
  await page.goto(FILE);
  // R3=A: long Clients cells truncate + click opens a detail modal (extends the Events pattern).
  await page.evaluate(() => { (document.querySelector('[data-page=clients]') as HTMLElement).click(); });
  const uris = page.locator('#clientRows [data-detail="uris"]').first();
  const isButton = await uris.evaluate(el => el.tagName);
  const truncClass = await uris.evaluate(el => getComputedStyle(el).textOverflow);
  await uris.click();
  const modalOn = await page.evaluate(() => document.getElementById('detailModal')!.classList.contains('on'));
  const title = await page.evaluate(() => document.getElementById('detailTitle')!.textContent);
  const bodyHasUri = await page.evaluate(() => document.getElementById('detailBody')!.textContent!.includes('https://app.acme.io/callback'));
  await page.keyboard.press('Escape');
  const closedByEsc = await page.evaluate(() => !document.getElementById('detailModal')!.classList.contains('on'));
  const scope = page.locator('#clientRows [data-detail="scope"]').first();
  await scope.click();
  const scopeTitle = await page.evaluate(() => document.getElementById('detailTitle')!.textContent);
  const scopeTags = await page.evaluate(() => document.querySelectorAll('#detailBody .tag').length);
  const a = { isButton, truncClass, modalOn, title, bodyHasUri, closedByEsc, scopeTitle, scopeTags };
  const pass = isButton === 'BUTTON' && truncClass === 'ellipsis' && modalOn && title!.includes('Redirect URIs')
    && bodyHasUri && closedByEsc && scopeTitle!.includes('Scope') && scopeTags >= 1;
  rec('content-detail', pass, a);
  expect(pass, 'content-detail').toBe(true);
});

test('responsive-table', async ({ page }) => {
  await page.goto(FILE);
  // R4=A: sticky action column (wide) + column priority (mid) + card view (narrow).
  await page.evaluate(() => { (document.querySelector('[data-page=clients]') as HTMLElement).click(); });
  await page.setViewportSize({ width: 1440, height: 900 });
  const stickyPos = await page.evaluate(() => getComputedStyle(document.querySelector('#clientRows tr td:last-child')!).position);
  await page.setViewportSize({ width: 800, height: 900 });
  const prioHidden = await page.evaluate(() => { const th = [...document.querySelectorAll('#page-clients thead th')].find(x => x.textContent === 'Client ID'); return getComputedStyle(th!).display; });
  const prioKept = await page.evaluate(() => { const th = [...document.querySelectorAll('#page-clients thead th')].find(x => x.textContent === 'Name'); return getComputedStyle(th!).display; });
  await page.setViewportSize({ width: 500, height: 900 });
  const cardThead = await page.evaluate(() => getComputedStyle(document.querySelector('#page-clients thead')!).display);
  const tdLabel = await page.evaluate(() => document.querySelector('#clientRows tr td')!.getAttribute('data-label'));
  const tdDisplay = await page.evaluate(() => getComputedStyle(document.querySelector('#clientRows tr td')!).display);
  const prioShownInCard = await page.evaluate(() => { const td = document.querySelector('#clientRows tr td[data-prio]'); return td ? getComputedStyle(td).display : 'none'; });
  // post-seal fix 11: at mid width no tag may overflow under the opaque sticky column and the
  // fixed columns must fit without horizontal overflow; sticky edge carries a shadow cue.
  await page.setViewportSize({ width: 940, height: 600 });
  await page.waitForTimeout(250);
  const mid = await page.evaluate(() => {
    const res: Record<string, unknown> = {};
    for (const pg of ['apikeys', 'users', 'tenants', 'clients', 'webhooks', 'audit', 'events']) {
      (document.querySelector('[data-page=' + pg + ']') as HTMLElement).click();
      const wrap = document.querySelector('#page-' + pg + ' [style*="overflow-x"]') as HTMLElement;
      const table = wrap.querySelector('table')!;
      const tag = table.querySelector('tbody td:has(.tag) .tag') as HTMLElement | null;
      const sticky = table.querySelector('tbody td:last-child') as HTMLElement;
      const tr = tag ? tag.getBoundingClientRect() : null;
      const sr = sticky.getBoundingClientRect();
      const td = tag ? (tag.closest('td') as HTMLElement).getBoundingClientRect() : null;
      res[pg] = { over: wrap.scrollWidth > wrap.clientWidth, tagInCell: tr && td ? tr.right <= td.right + 1 : true, tagClearOfSticky: tr ? tr.right <= sr.left + 1 : true, shadow: getComputedStyle(sticky).boxShadow !== 'none' };
    }
    return res;
  });
  const midOk = Object.values(mid).every((m: any) => !m.over && m.tagInCell && m.tagClearOfSticky && m.shadow);
  const a = { stickyPos, prioHidden, prioKept, cardThead, tdLabel, tdDisplay, prioShownInCard, mid, midOk };
  const pass = stickyPos === 'sticky' && prioHidden === 'none' && prioKept !== 'none'
    && cardThead === 'none' && tdLabel === 'Name' && tdDisplay === 'flex' && prioShownInCard === 'flex' && midOk;
  rec('responsive-table', pass, a);
  expect(pass, 'responsive-table').toBe(true);
});

test('pagehead-overflow', async ({ page }) => {
  await page.goto(FILE);
  // R5=A: page-head stacks on narrow; secondary (Export) collapses into overflow, primary kept.
  await page.evaluate(() => { (document.querySelector('[data-page=audit]') as HTMLElement).click(); });
  await page.setViewportSize({ width: 1440, height: 900 });
  const wideExport = await page.evaluate(() => getComputedStyle(document.getElementById('exportBtn')!).display);
  const wideMore = await page.evaluate(() => getComputedStyle(document.querySelector('#page-audit [data-phmore]')!).display);
  await page.setViewportSize({ width: 500, height: 900 });
  const narrowExport = await page.evaluate(() => getComputedStyle(document.getElementById('exportBtn')!).display);
  const narrowMore = await page.evaluate(() => getComputedStyle(document.querySelector('#page-audit [data-phmore]')!).display);
  const verifyKept = await page.evaluate(() => getComputedStyle(document.getElementById('verifyBtn')!).display);
  const phWrap = await page.evaluate(() => getComputedStyle(document.querySelector('#page-audit .page-head')!).flexWrap);
  await page.locator('#page-audit [data-phmore]').click();
  const menuOn = await page.evaluate(() => document.getElementById('rowMenu')!.classList.contains('on'));
  const exportItem = await page.locator('#rowMenu .menu-item[data-maction="export"]').count();
  await page.locator('#rowMenu .menu-item[data-maction="export"]').click();
  const closedAfter = await page.evaluate(() => !document.getElementById('rowMenu')!.classList.contains('on'));
  // adjudication 18: export is async w/ a simulated first-attempt failure; retry succeeds
  await page.waitForTimeout(600);
  await page.locator('#auditExportRetry').click();
  await page.waitForTimeout(600);
  const toastText = await page.evaluate(() => document.getElementById('protoToast')!.textContent);
  const a = { wideExport, wideMore, narrowExport, narrowMore, verifyKept, phWrap, menuOn, exportItem, toastText, closedAfter };
  const pass = wideExport !== 'none' && wideMore === 'none' && narrowExport === 'none' && narrowMore !== 'none'
    && verifyKept !== 'none' && phWrap === 'wrap' && menuOn && exportItem === 1 && toastText.startsWith('Exported') && closedAfter;
  rec('pagehead-overflow', pass, a);
  expect(pass, 'pagehead-overflow').toBe(true);
});

test('table-fit', async ({ page }) => {
  await page.goto(FILE);
  // R6: at desktop the list tables must fit (no phantom horizontal scrollbar from content min-width).
  await page.setViewportSize({ width: 1440, height: 900 });
  const pages = ['users', 'roles', 'groups', 'tenants', 'clients', 'apikeys', 'webhooks', 'audit', 'events'];
  const over: string[] = [];
  for (const pg of pages) {
    await page.evaluate((p) => { (document.querySelector('[data-page=' + p + ']') as HTMLElement).click(); }, pg);
    const fit = await page.evaluate((p) => {
      const w = document.querySelector('#page-' + p + ' div[style*="overflow-x"]') as HTMLElement;
      return w.scrollWidth <= w.clientWidth;
    }, pg);
    if (!fit) over.push(pg);
  }
  const a = { over };
  const pass = over.length === 0;
  rec('table-fit', pass, a);
  expect(pass, 'table-fit').toBe(true);
});

test('chip-columns', async ({ page }) => {
  await page.goto(FILE);
  // Scopes / Events / Action chip columns: chips stay one line, are not ellipsis-clipped, and sit inline.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { (document.querySelector('[data-page=audit]') as HTMLElement).click(); });
  const auditChip = await page.evaluate(() => {
    const tags = [...document.querySelectorAll('#auditRows .tag')];
    const tallest = Math.max(...tags.map(t => (t as HTMLElement).offsetHeight));
    const clipped = tags.some(t => t.scrollWidth > t.clientWidth);
    return { tallest, clipped };
  });
  await page.evaluate(() => { (document.querySelector('[data-page=webhooks]') as HTMLElement).click(); });
  const whCell = await page.evaluate(() => {
    const td = document.querySelector('#webhookRows tr td:nth-child(2)') as HTMLElement;
    const cs = getComputedStyle(td);
    const chips = [...td.querySelectorAll('.tag')];
    return { overflow: cs.overflow, textOverflow: cs.textOverflow, chipClipped: chips.some(c => c.scrollWidth > c.clientWidth) };
  });
  await page.evaluate(() => { (document.querySelector('[data-page=apikeys]') as HTMLElement).click(); });
  const scopesInline = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('#apikeyRows tr:first-child td:nth-child(3) .tag')] as HTMLElement[];
    return chips.length >= 2 && chips[0].offsetTop === chips[1].offsetTop;
  });
  const a = { auditChip, whCell, scopesInline };
  const pass = auditChip.tallest <= 24 && !auditChip.clipped
    && whCell.overflow === 'visible' && whCell.textOverflow === 'clip' && !whCell.chipClipped
    && scopesInline;
  rec('chip-columns', pass, a);
  expect(pass, 'chip-columns').toBe(true);
});

test('dead-controls', async ({ page }) => {
  await page.goto(FILE);
  // Previously silent-dead controls now respond: users View -> detail; roles/tenants Edit -> disclosure;
  // dashboard Refresh -> toast; View all -> navigates to Audit.
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); });
  await page.locator('#userRows button[data-detail="user"]').first().click();
  const viewModal = await page.evaluate(() => document.getElementById('detailModal')!.classList.contains('on'));
  const viewTitle = await page.evaluate(() => document.getElementById('detailTitle')!.textContent);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { (document.querySelector('[data-page=roles]') as HTMLElement).click(); });
  await page.locator('#roleRows button[aria-label="Edit"]:not([disabled])').first().click();
  const roleEdit = await page.evaluate(() => document.getElementById('formModal')!.classList.contains('on') && document.getElementById('formTitle')!.textContent!.includes('Edit'));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { (document.querySelector('[data-page=tenants]') as HTMLElement).click(); });
  await page.locator('#tenantRows button[aria-label="Edit"]:not([disabled])').first().click();
  const tenantEdit = await page.evaluate(() => document.getElementById('formModal')!.classList.contains('on') && document.getElementById('formTitle')!.textContent!.includes('Edit'));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { (document.querySelector('[data-page=dashboard]') as HTMLElement).click(); });
  await page.locator('#dashRefresh').click();
  await page.waitForTimeout(700); // adjudication 19: async load, first attempt simulated failure
  await page.locator('#dashErrRetry').click();
  await page.waitForTimeout(700);
  const refreshToast = await page.evaluate(() => document.getElementById('protoToast')!.textContent);
  await page.locator('#viewAllBtn').click();
  const jumpedAudit = await page.evaluate(() => document.getElementById('page-audit')!.classList.contains('on'));
  const a = { viewModal, viewTitle, roleEdit, tenantEdit, refreshToast, jumpedAudit };
  const pass = viewModal && viewTitle!.includes('User') && roleEdit && tenantEdit
    && refreshToast === 'Refreshed' && jumpedAudit;
  rec('dead-controls', pass, a);
  expect(pass, 'dead-controls').toBe(true);
});

test('row-crud', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication A: Edit prefills formModal and saves in place; Delete confirms then removes the row.
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); });
  await page.locator('#userRows button[aria-label="Edit"]').first().click();
  const editOpen = await page.evaluate(() => document.getElementById('formModal')!.classList.contains('on'));
  const prefilled = await page.evaluate(() => (document.querySelector('#formBody [data-field="name"]') as HTMLInputElement).value);
  await page.locator('#formBody [data-field="name"]').fill('Edited Name');
  await page.locator('#formSave').click();
  const savedClosed = await page.evaluate(() => !document.getElementById('formModal')!.classList.contains('on'));
  const rowUpdated = await page.evaluate(() => document.querySelector('#userRows tr:first-child .u-nm')!.textContent);
  const savedToast = await page.evaluate(() => document.getElementById('protoToast')!.textContent);
  await page.evaluate(() => { (document.querySelector('[data-page=clients]') as HTMLElement).click(); });
  const before = await page.evaluate(() => document.querySelectorAll('#clientRows tr').length);
  await page.locator('#clientRows button[aria-label="Delete"]').first().click();
  const confirmOpen = await page.evaluate(() => document.getElementById('confirmModal')!.classList.contains('on'));
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600); // adjudication 28: clients delete async, simulated first failure
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => document.querySelectorAll('#clientRows tr').length);
  const deletedToast = await page.evaluate(() => document.getElementById('protoToast')!.textContent);
  const a = { editOpen, prefilled, savedClosed, rowUpdated, savedToast, before, confirmOpen, after, deletedToast };
  const pass = editOpen && prefilled === 'Jane Doe' && savedClosed && rowUpdated === 'Edited Name' && savedToast === 'Saved'
    && confirmOpen && after === before - 1 && deletedToast === 'Client deleted';
  rec('row-crud', pass, a);
  expect(pass, 'row-crud').toBe(true);
});

test('combobox-popup', async ({ page }) => {
  await page.goto(FILE);
  // Native combobox popup readability: option colors must follow the theme (color-scheme + explicit
  // option bg/color), in every select incl. the dynamically-built edit-modal select.
  const probe = () => page.evaluate(() => {
    const sum = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); return m[0] + m[1] + m[2]; };
    const ids = ['tenantFilter', 'statusFilter', 'scopeSelect', 'kindFilter', 'memberPicker', 'apikeyStatusFilter', 'auditActionFilter', 'eventFamilyFilter', 'styleSelect'];
    const theme = document.documentElement.dataset.theme || 'light';
    const rows = ids.map(id => { const s = document.getElementById(id) as HTMLSelectElement; const o = s.querySelector('option')!; const oc = getComputedStyle(o); return { id, scheme: getComputedStyle(s).colorScheme, bg: sum(oc.backgroundColor), fg: sum(oc.color) }; });
    return { theme, rows };
  });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  const dark = await probe();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  const light = await probe();
  // dynamically-enhanced select (Settings idle timeout, enhanced via enhanceAllSelects(page-settings)) in dark
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; (document.querySelector('[data-page=settings]') as HTMLElement).click(); });
  const editSel = await page.evaluate(() => { const s = document.getElementById('idleSelect') as HTMLSelectElement; const o = s.querySelector('option')!; const oc = getComputedStyle(o); const sum = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); return m[0] + m[1] + m[2]; }; return { scheme: getComputedStyle(s).colorScheme, bg: sum(oc.backgroundColor), fg: sum(oc.color) }; });
  const darkOk = dark.rows.every(r => r.scheme === 'dark' && r.bg < 200 && r.fg > 400);
  const lightOk = light.rows.every(r => r.scheme === 'light' && r.bg > 400 && r.fg < 200);
  const editOk = editSel.scheme === 'dark' && editSel.bg < 200 && editSel.fg > 400;
  const a = { darkOk, lightOk, editOk, darkSample: dark.rows[0], lightSample: light.rows[0], editSel };
  const pass = darkOk && lightOk && editOk;
  rec('combobox-popup', pass, a);
  expect(pass, 'combobox-popup').toBe(true);
});

test('combobox-themed', async ({ page }) => {
  await page.goto(FILE);
  // The visible combobox must be a design-language custom widget, NOT the native select popup.
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); });
  const base = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('select')];
    const cs = getComputedStyle(document.documentElement);
    return {
      selCount: sels.length,
      cbxCount: sels.filter(s => (s as any)._cbx).length,
      allNativeHidden: sels.every(s => getComputedStyle(s).display === 'none'),
      surface: cs.getPropertyValue('--surface').trim(),
    };
  });
  // open the tenant filter combobox; list must use token surface; picking an option fires change (filters)
  const before = await page.evaluate(() => document.querySelectorAll('#userRows tr').length);
  const opened = await page.evaluate(() => {
    const sel = document.getElementById('tenantFilter') as any;
    sel._cbx.querySelector('.cbx-btn').click();
    const list = sel._cbx.querySelector('.cbx-list');
    const lc = getComputedStyle(list);
    const surf = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
    // compare via a probe element resolved color
    const probe = document.createElement('div'); probe.style.background = surf; document.body.appendChild(probe);
    const want = getComputedStyle(probe).backgroundColor; probe.remove();
    return { open: sel._cbx.classList.contains('open'), listBg: lc.backgroundColor, want, opts: list.querySelectorAll('.cbx-opt').length };
  });
  await page.evaluate(() => {
    const sel = document.getElementById('tenantFilter') as any;
    const opt = [...sel._cbx.querySelectorAll('.cbx-opt')].find((o: any) => o.dataset.value === 'Globex');
    opt.click();
  });
  const after = await page.evaluate(() => {
    const sel = document.getElementById('tenantFilter') as any;
    return { value: sel.value, label: sel._cbx.querySelector('.cbx-val').textContent, rows: document.querySelectorAll('#userRows tr').length, closed: !sel._cbx.classList.contains('open') };
  });
  const a = { base, opened, before, after };
  const pass = base.cbxCount === base.selCount && base.allNativeHidden
    && opened.open && opened.listBg === opened.want && opened.opts >= 2
    && after.value === 'Globex' && after.label === 'Globex' && after.rows < before && after.closed;
  rec('combobox-themed', pass, a);
  expect(pass, 'combobox-themed').toBe(true);
});

test('danger-contrast', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 1 (A): filled danger = deep-red solid + inverse text; ghost danger = surface + danger text.
  // Both must reach WCAG 4.5:1 in every pack x theme.
  const packs = ['broadsheet', 'geist', 'material', 'fluent', 'ant', 'carbon', 'cupertino'];
  const rows: any[] = [];
  for (const pk of packs) {
    for (const th of ['light', 'dark']) {
      const r = await page.evaluate(([pk, th]) => {
        const s = document.getElementById('styleSelect') as HTMLSelectElement; s.value = pk; s.onchange();
        document.documentElement.dataset.theme = th;
        const lum = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
        const ratio = (a: string, b: string) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
        (document.querySelector('[data-page=clients]') as HTMLElement).click();
        (document.querySelector('#clientRows button[aria-label="Delete"]') as HTMLElement).click();
        const fd = document.getElementById('confirmDelete')!; const fc = getComputedStyle(fd);
        const filled = ratio(fc.color, fc.backgroundColor);
        (document.querySelector('[data-close=confirmModal]') as HTMLElement).click();
        (document.querySelector('[data-page=profile]') as HTMLElement).click();
        const gh = document.getElementById('revokeOthersBtn')!; const gc = getComputedStyle(gh);
        const ghost = ratio(gc.color, gc.backgroundColor);
        return { pk, th, filled: +filled.toFixed(2), ghost: +ghost.toFixed(2) };
      }, [pk, th]);
      rows.push(r);
    }
  }
  const bad = rows.filter(r => r.filled < 4.5 || r.ghost < 4.5);
  const a = { bad, sample: rows[0] };
  const pass = bad.length === 0;
  rec('danger-contrast', pass, a);
  expect(pass, 'danger-contrast').toBe(true);
});

test('cbx-disabled', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 2 (A): custom combobox mirrors select.disabled (system-role scope lock restored).
  await page.evaluate(() => { (document.querySelector('[data-page=roles]') as HTMLElement).click(); });
  const locked = await page.evaluate(() => {
    (document.querySelector('#roleRows tr[data-role="0"]') as HTMLElement).click();
    const sel = document.getElementById('scopeSelect') as any;
    const before = sel.value;
    sel._cbx.querySelector('.cbx-btn').click();
    return { disabled: sel.disabled, btnDisabled: sel._cbx.querySelector('.cbx-btn').disabled, aria: sel._cbx.querySelector('.cbx-btn').getAttribute('aria-disabled'), opened: sel._cbx.classList.contains('open'), unchanged: sel.value === before };
  });
  const unlocked = await page.evaluate(async () => {
    (document.querySelector('#roleRows tr[data-role="1"]') as HTMLElement).click();
    await new Promise(r => setTimeout(r, 0)); // let the disabled-attribute MutationObserver sync
    const sel = document.getElementById('scopeSelect') as any;
    sel._cbx.querySelector('.cbx-btn').click();
    const opened = sel._cbx.classList.contains('open');
    sel._cbx.querySelector('.cbx-btn').click();
    return { disabled: sel.disabled, btnDisabled: sel._cbx.querySelector('.cbx-btn').disabled, opened };
  });
  const a = { locked, unlocked };
  const pass = locked.disabled && locked.btnDisabled && locked.aria === 'true' && !locked.opened && locked.unchanged
    && !unlocked.disabled && !unlocked.btnDisabled && unlocked.opened;
  rec('cbx-disabled', pass, a);
  expect(pass, 'cbx-disabled').toBe(true);
});

test('topbar-fidelity', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 3 (A): no fictional global search; tenant identity is a read-only tag (no chevron /
  // no handler); sidebar has no count badges (real AdminLayout has none).
  const a = await page.evaluate(() => {
    const tb = document.querySelector('.topbar')!;
    const tag = tb.querySelector('.tenant-tag') as HTMLElement;
    return {
      globalSearch: !!tb.querySelector('.search input'),
      tagExists: !!tag,
      tagChevron: !!tag.querySelector('svg use[href="#i-chev-r"]'),
      tagReadonlyTitle: (tag.getAttribute('title') || '').includes('read-only'),
      badges: document.querySelectorAll('#nav .badge').length,
    };
  });
  const pass = !a.globalSearch && a.tagExists && !a.tagChevron && a.tagReadonlyTitle && a.badges === 0;
  rec('topbar-fidelity', pass, a);
  expect(pass, 'topbar-fidelity').toBe(true);
});

test('settings', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 4 (A): Settings page grounded in real Settings.tsx (4 tabs, sessions, MFA one-time
  // recovery gate, options masking + JSON validation, template preview, idle timeout, branding).
  await page.evaluate(() => { (document.querySelector('[data-page=settings]') as HTMLElement).click(); });
  const shell = await page.evaluate(() => ({
    on: document.getElementById('page-settings')!.classList.contains('on'),
    tabs: document.querySelectorAll('#settingsTabs button').length,
    title: document.getElementById('crumbPage')!.textContent,
  }));
  await page.evaluate(() => { (document.querySelector('#settingsTabs button[data-tab=ssecurity]') as HTMLElement).click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const b = document.getElementById('sessLoadBanner') as HTMLElement; if (b.style.display !== 'none') { (document.getElementById('sessLoadRetry') as HTMLElement).click(); (document.getElementById('pkLoadRetry') as HTMLElement).click(); } });
  await page.waitForTimeout(600);
  const sec0 = await page.evaluate(() => ({
    paneOn: document.getElementById('pane-ssecurity')!.classList.contains('on'),
    rows: document.querySelectorAll('#sessionRows tr').length,
    current: !!document.querySelector('#sessionRows .tag'),
  }));
  await page.locator('#sessionRows button[data-srev]').first().click();
  const revVerb = await page.evaluate(() => document.getElementById('confirmDelete')!.textContent);
  await page.locator('#confirmDelete').click();
  const sec1 = await page.evaluate(() => document.querySelectorAll('#sessionRows tr').length);
  // MFA setup: bad code rejected; good code -> one-time recovery modal gated by saved-checkbox
  await page.locator('#mfaOpenSetup').click();
  await page.locator('#mfaCode').fill('12');
  await page.locator('#mfaEnable').click();
  const badCode = await page.evaluate(() => document.getElementById('mfaSetupErr')!.style.display === 'flex');
  await page.locator('#mfaCode').fill('123456');
  await page.locator('#mfaEnable').click();
  const rec0 = await page.evaluate(() => ({
    open: document.getElementById('mfaRecoveryModal')!.classList.contains('on'),
    doneDisabled: (document.getElementById('mfaRecoveryDone') as HTMLButtonElement).disabled,
  }));
  await page.keyboard.press('Escape');
  const recEsc = await page.evaluate(() => document.getElementById('mfaRecoveryModal')!.classList.contains('on'));
  await page.locator('#mfaSaved').check();
  const rec1 = await page.evaluate(() => !(document.getElementById('mfaRecoveryDone') as HTMLButtonElement).disabled);
  await page.locator('#mfaRecoveryDone').click();
  const mfaOn = await page.evaluate(() => document.getElementById('mfaBody')!.textContent!.includes('MFA is enabled'));
  // options: sensitive masked; invalid JSON rejected on edit
  await page.evaluate(() => { (document.querySelector('#settingsTabs button[data-tab=soptions]') as HTMLElement).click(); });
  await page.waitForTimeout(600); // adjudication 22: options load is async w/ simulated first failure
  await page.locator('#optLoadRetry').click();
  await page.waitForTimeout(600);
  const masked = await page.evaluate(() => [...document.querySelectorAll('#optionRows tr')].some(tr => tr.textContent!.includes('smtp_password') && tr.textContent!.includes('••••')));
  await page.evaluate(() => { const i = [...document.querySelectorAll('#optionRows tr')].findIndex(tr => tr.textContent!.includes('captcha_enabled')); (document.querySelector('#optionRows tr:nth-child(' + (i + 1) + ') button[data-optedit]') as HTMLElement).click(); });
  await page.locator('#formBody [data-field=value]').fill('not-json');
  await page.locator('#formSave').click();
  const jsonErr = await page.evaluate(() => document.getElementById('formModal')!.classList.contains('on') && document.getElementById('formBody')!.textContent!.includes('valid JSON'));
  await page.keyboard.press('Escape');
  // template preview + idle timeout
  await page.evaluate(() => { (document.querySelector('#settingsTabs button[data-tab=semail]') as HTMLElement).click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const b = document.getElementById('tplLoadBanner') as HTMLElement; if (b.style.display !== 'none') (document.getElementById('tplLoadRetry') as HTMLElement).click(); });
  await page.waitForTimeout(600);
  await page.locator('#templateRows button[data-tplview]').first().click();
  const preview = await page.evaluate(() => document.getElementById('tplDrawer')!.classList.contains('on'));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { (document.querySelector('#settingsTabs button[data-tab=ssecurity]') as HTMLElement).click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const b = document.getElementById('sessLoadBanner') as HTMLElement; if (b.style.display !== 'none') { (document.getElementById('sessLoadRetry') as HTMLElement).click(); (document.getElementById('pkLoadRetry') as HTMLElement).click(); } });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const sel = document.getElementById('idleSelect') as any;
    sel._cbx.querySelector('.cbx-btn').click();
    [...sel._cbx.querySelectorAll('.cbx-opt')].find((o: any) => o.dataset.value === '3600').click();
  });
  await page.waitForTimeout(600); // adjudication 22: idle save async w/ simulated first failure
  await page.locator('#idleErrRetry').click();
  await page.waitForTimeout(600);
  const idleToast = await page.evaluate(() => document.getElementById('protoToast')!.textContent);
  const a = { shell, sec0, revVerb, sec1, badCode, rec0, recEsc, rec1, mfaOn, masked, jsonErr, preview, idleToast };
  const pass = shell.on && shell.tabs === 4 && shell.title === 'Settings'
    && sec0.paneOn && sec0.rows === 3 && sec0.current && revVerb === 'Revoke' && sec1 === 2
    && badCode && rec0.open && rec0.doneDisabled && recEsc && rec1 && mfaOn
    && masked && jsonErr && preview && idleToast === 'Idle timeout saved';
  rec('settings', pass, a);
  expect(pass, 'settings').toBe(true);
});

test('settings-model', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 22 (A): general url validation + localStorage-only + saved feedback; idle 5 real
  // values + options:write gate + Busy + saveError; options options:read gate + load error + key
  // pattern; templates drawer w/ stored-preview locale en/zh + test send; permission perspectives.
  await page.evaluate(() => { (document.querySelector('[data-page=settings]') as HTMLElement).click(); });
  await page.locator('#brandLogo').fill('not-a-url');
  await page.locator('#brandSave').click();
  const gBad = await page.evaluate(() => ({ err: document.getElementById('brandLogoErr')!.style.display === 'block', saved: document.getElementById('brandSaved')!.style.display !== 'none' }));
  await page.locator('#brandLogo').fill('https://x.io/l.svg');
  await page.locator('#brandSave').click();
  const gOk = await page.evaluate(() => ({ saved: document.getElementById('brandSaved')!.style.display !== 'none', ls: (localStorage.getItem('ab-branding') || '').includes('https://x.io/l.svg'), toast: document.getElementById('protoToast')!.textContent }));
  const setPersp = (v: string) => page.evaluate((val) => { const s = document.getElementById('permView') as HTMLSelectElement; s.value = val; s.onchange!(new Event('change')); }, v);
  await setPersp('read');
  const pRead = await page.evaluate(() => ({ idleDisabled: (document.getElementById('idleSelect') as HTMLSelectElement).disabled, hint: document.getElementById('idleHint')!.textContent!.includes('Read-only'), optTab: !(document.querySelector('#settingsTabs button[data-tab=soptions]') as HTMLButtonElement).disabled }));
  await setPersp('none');
  const pNone = await page.evaluate(() => ({ optTab: (document.querySelector('#settingsTabs button[data-tab=soptions]') as HTMLButtonElement).disabled, aria: document.querySelector('#settingsTabs button[data-tab=soptions]')!.getAttribute('aria-disabled'), gate: document.getElementById('optGateBanner')!.style.display === 'flex', wrap: document.getElementById('optTableWrap')!.style.display === 'none' }));
  await setPersp('admin');
  const idleVals = await page.evaluate(() => [...(document.getElementById('idleSelect') as HTMLSelectElement).options].map(o => o.value));
  await page.evaluate(() => { (document.querySelector('#settingsTabs button[data-tab=ssecurity]') as HTMLElement).click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const b = document.getElementById('sessLoadBanner') as HTMLElement; if (b.style.display !== 'none') { (document.getElementById('sessLoadRetry') as HTMLElement).click(); (document.getElementById('pkLoadRetry') as HTMLElement).click(); } });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const sel = document.getElementById('idleSelect') as any; sel._cbx.querySelector('.cbx-btn').click(); [...sel._cbx.querySelectorAll('.cbx-opt')].find((o: any) => o.dataset.value === '604800').click(); });
  const idleBusy = await page.evaluate(() => (document.getElementById('idleSelect') as HTMLSelectElement).disabled);
  await page.waitForTimeout(600);
  const idleErr = await page.evaluate(() => document.getElementById('idleErrBanner')!.style.display === 'flex');
  await page.locator('#idleErrRetry').click();
  await page.waitForTimeout(600);
  const idleOk = await page.evaluate(() => ({ v: eval('OPTIONS').find((o: any) => o.key === 'session.idle_timeout_seconds').value, banner: document.getElementById('idleErrBanner')!.style.display === 'none' }));
  await page.evaluate(() => { (document.querySelector('#settingsTabs button[data-tab=soptions]') as HTMLElement).click(); });
  await page.waitForTimeout(600);
  const optLoadErr = await page.evaluate(() => document.getElementById('optLoadBanner')!.style.display === 'flex');
  await page.locator('#optLoadRetry').click();
  await page.locator('#optionAdd').click();
  await page.locator('#formBody [data-field=key]').fill('Bad Key!');
  await page.locator('#formBody [data-field=value]').fill('true');
  await page.locator('#formSave').click();
  const keyErr = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('lowercase start'));
  await page.locator('#formBody [data-field=key]').fill('feature_flag_e2e');
  await page.locator('#formSave').click();
  const keyOk = await page.evaluate(() => [...document.querySelectorAll('#optionRows tr')].some(tr => tr.textContent!.includes('feature_flag_e2e')));
  await page.evaluate(() => { (document.querySelector('#settingsTabs button[data-tab=semail]') as HTMLElement).click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const b = document.getElementById('tplLoadBanner') as HTMLElement; if (b.style.display !== 'none') (document.getElementById('tplLoadRetry') as HTMLElement).click(); });
  await page.waitForTimeout(600);
  await page.locator('#templateRows button[data-tpledit]').first().click();
  const drawer = await page.evaluate(() => ({ on: document.getElementById('tplDrawer')!.classList.contains('on'), fields: ['tplSubjectEn', 'tplSubjectZh', 'tplHtmlEn', 'tplHtmlZh'].every(id => !!document.getElementById(id)) }));
  await page.locator('#tplPreviewBtn').click();
  const pvBusy = await page.evaluate(() => (document.getElementById('tplPreviewBtn') as HTMLButtonElement).disabled);
  await page.waitForTimeout(600);
  const pvErr = await page.evaluate(() => document.getElementById('tplPreviewErr')!.style.display === 'flex');
  await page.locator('#tplPreviewBtn').click();
  await page.waitForTimeout(600);
  const pvEn = await page.evaluate(() => ({ box: document.getElementById('tplPreviewBox')!.style.display === 'block', txt: document.getElementById('tplPreviewBox')!.textContent! }));
  await page.locator('#tplSubjectEn').fill('UNSAVED SUBJECT');
  await page.evaluate(() => { (document.querySelector('#tplDrawer input[name=tplLocale][value=zh]') as HTMLInputElement).checked = true; });
  await page.locator('#tplPreviewBtn').click();
  await page.waitForTimeout(600);
  const pvZh = await page.evaluate(() => document.getElementById('tplPreviewBox')!.textContent!);
  await page.locator('#tplTestTo').fill('bad');
  await page.locator('#tplTestBtn').click();
  const testBad = await page.evaluate(() => document.getElementById('tplTestErr')!.style.display === 'block');
  await page.locator('#tplTestTo').fill('qa@example.com');
  await page.locator('#tplTestBtn').click();
  await page.waitForTimeout(600);
  const testErr = await page.evaluate(() => document.getElementById('tplTestMsgTx')!.textContent!.includes('SMTP'));
  await page.locator('#tplTestBtn').click();
  await page.waitForTimeout(600);
  const testOk = await page.evaluate(() => document.getElementById('tplTestMsgTx')!.textContent!.includes('Test email sent to qa@example.com'));
  await page.locator('#tplSubjectEn').fill('E2E Subject');
  await page.locator('#tplSave').click();
  const saved = await page.evaluate(() => ({ closed: !document.getElementById('tplDrawer')!.classList.contains('on'), row: document.querySelector('#templateRows tr')!.textContent!.includes('E2E Subject') }));
  await page.locator('#templateRows button[data-tplview]').first().click();
  const ro = await page.evaluate(() => ({ readonly: (document.getElementById('tplSubjectEn') as HTMLInputElement).readOnly, saveHidden: document.getElementById('tplSave')!.style.display === 'none' }));
  const a = { gBad, gOk, pRead, pNone, idleVals, idleBusy, idleErr, idleOk, optLoadErr, keyErr, keyOk, drawer, pvBusy, pvErr, pvEn, pvZh, testBad, testErr, testOk, saved, ro };
  const pass = gBad.err && !gBad.saved && gOk.saved && gOk.ls && gOk.toast.includes('localStorage')
    && pRead.idleDisabled && pRead.hint && pRead.optTab
    && pNone.optTab && pNone.aria === 'true' && pNone.gate && pNone.wrap
    && JSON.stringify(idleVals) === JSON.stringify(['3600', '28800', '86400', '604800', '0'])
    && idleBusy && idleErr && idleOk.v === 604800 && idleOk.banner
    && optLoadErr && keyErr && keyOk
    && drawer.on && drawer.fields && pvBusy && pvErr && pvEn.box && pvEn.txt.includes('Ada') && pvEn.txt.includes('Verify your email')
    && pvZh.includes('验证您的邮箱') && pvZh.includes('Ada') && !pvZh.includes('UNSAVED SUBJECT')
    && testBad && testErr && testOk && saved.closed && saved.row && ro.readonly && ro.saveHidden;
  rec('settings-model', pass, a);
  expect(pass, 'settings-model').toBe(true);
});

test('apikeys-model', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 5 (A): API keys are immutable / revoke-only; create shows one-time ab_ plaintext;
  // no Edit/Delete; revoke requires confirmation; create form has no scopes input.
  await page.evaluate(() => { (document.querySelector('[data-page=apikeys]') as HTMLElement).click(); });
  const noCrud = await page.evaluate(() => !document.querySelector('#apikeyRows button[aria-label="Edit"]') && !document.querySelector('#apikeyRows button[aria-label="Delete"]'));
  await page.locator('#apikeyRows button[data-revoke]:not([disabled])').first().click();
  const conf = await page.evaluate(() => ({ on: document.getElementById('confirmModal')!.classList.contains('on'), verb: document.getElementById('confirmDelete')!.textContent }));
  await page.locator('#confirmModal [data-close=confirmModal]').first().click();
  const notRevoked = await page.evaluate(() => document.querySelectorAll('#apikeyRows .tag.danger').length);
  await page.locator('#apikeyRows button[data-revoke]:not([disabled])').first().click();
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600); // adjudication 24: revoke async, simulated first failure keeps the key
  const revFail = await page.evaluate(() => ({ err: document.getElementById('confirmErr')!.style.display === 'flex', kept: document.querySelectorAll('#apikeyRows .tag.danger').length }));
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600);
  const revoked = await page.evaluate(() => document.querySelectorAll('#apikeyRows .tag.danger').length);
  await page.locator('[data-create=apikeys]').click();
  const form = await page.evaluate(() => ({
    name: !!document.querySelector('#formBody [data-field=name]'),
    expires: !!document.querySelector('#formBody [data-field=expires]'),
    scopes: !!document.querySelector('#formBody [data-field=scopes]'),
    dateType: (document.querySelector('#formBody [data-field=expires]') as HTMLInputElement).type,
    min: (document.querySelector('#formBody [data-field=expires]') as HTMLInputElement).min,
    note: document.getElementById('formBody')!.textContent!.includes('["*"]'),
  }));
  await page.locator('#formBody [data-field=name]').fill('e2e-key');
  await page.locator('#formBody [data-field=expires]').fill('2020-01-01');
  await page.locator('#formSave').click();
  const pastErr = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('not in the past'));
  await page.locator('#formBody [data-field=expires]').fill('');
  await page.locator('#formSave').click();
  const createBusy = await page.evaluate(() => (document.getElementById('formSave') as HTMLButtonElement).disabled);
  await page.waitForTimeout(600); // simulated createError keeps the form open
  const createFail = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('Create failed'));
  await page.locator('#formSave').click();
  await page.waitForTimeout(600);
  const reveal = await page.evaluate(() => ({
    on: document.getElementById('revealModal')!.classList.contains('on'),
    val: (document.getElementById('revealValue') as HTMLInputElement).value,
    meta: document.getElementById('revealMeta')!.textContent,
  }));
  const createdScopes = await page.evaluate(() => eval('APIKEYS')[eval('APIKEYS').length - 1].scopes);
  // copy: clipboard rejection + execCommand failure must surface copyFailed, never a false success
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
  });
  await page.locator('#revealCopy').click();
  await page.waitForTimeout(50); // clipboard rejection -> fallback runs in a microtask
  const copyFail = await page.evaluate(() => document.getElementById('protoToast')!.textContent!.includes('Copy failed'));
  await page.evaluate(() => { Object.defineProperty(document, 'execCommand', { configurable: true, value: () => true }); });
  await page.locator('#revealCopy').click();
  const copyOk = await page.evaluate(() => document.getElementById('protoToast')!.textContent === 'Copied to clipboard');
  const a = { noCrud, conf, notRevoked, revFail, revoked, form, pastErr, createBusy, createFail, createdScopes, copyFail, copyOk, reveal: { on: reveal.on, prefix: reveal.val.slice(0, 3), len: reveal.val.length, once: reveal.meta.includes('never shown again') } };
  const pass = noCrud && conf.on && conf.verb === 'Revoke' && revFail.err && revFail.kept === notRevoked && revoked === notRevoked + 1
    && form.name && form.expires && !form.scopes && form.dateType === 'date' && !!form.min && form.note
    && pastErr && createBusy && createFail && JSON.stringify(createdScopes) === JSON.stringify(['*'])
    && copyFail && copyOk
    && reveal.on && reveal.val.startsWith('ab_') && reveal.val.length === 35 && reveal.meta.includes('never shown again');
  rec('apikeys-model', pass, a);
  expect(pass, 'apikeys-model').toBe(true);
});

test('users-model', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 6 (A): edit = name + roles only (email/tenant read-only, no status); status is a
  // confirm-gated switch with suspended vocab; menu has Force logout; overflow Export CSV downloads;
  // Name/Created headers sort.
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); });
  await page.locator('#userRows button[aria-label="Edit"]').first().click();
  const edit = await page.evaluate(() => ({
    name: !!document.querySelector('#formBody [data-field=name]'),
    roles: document.querySelectorAll('#formBody select[data-field=roles] option').length,
    emailRo: (document.querySelector('#formBody [data-field=email]') as HTMLInputElement).disabled,
    tenantRo: (document.querySelector('#formBody [data-field=tenant]') as HTMLInputElement).disabled,
    statusField: !!document.querySelector('#formBody [data-field=status]'),
  }));
  await page.keyboard.press('Escape');
  const vocab = await page.evaluate(() => document.getElementById('userRows')!.textContent!.includes('Suspended') && !document.getElementById('userRows')!.textContent!.includes('Disabled'));
  await page.locator('#userRows button[data-ustatus]').first().click();
  const susConf = await page.evaluate(() => document.getElementById('confirmDelete')!.textContent);
  await page.locator('#confirmDelete').click();
  const susToast = await page.evaluate(() => document.getElementById('protoToast')!.textContent);
  await page.locator('#userRows button[data-more]').first().click();
  const menuHasForce = await page.evaluate(() => !!document.querySelector('#rowMenu [data-maction=force]'));
  await page.locator('#rowMenu [data-maction=force]').click();
  const forceVerb = await page.evaluate(() => document.getElementById('confirmDelete')!.textContent);
  await page.locator('#confirmModal [data-close=confirmModal]').first().click();
  await page.setViewportSize({ width: 700, height: 900 }); // page-head overflow menu appears <=760px (R5)
  await page.locator('[data-phmore=users]').click();
  const exportItem = await page.evaluate(() => !!document.querySelector('#rowMenu [data-maction=export-users]'));
  const dl = page.waitForEvent('download');
  await page.locator('#rowMenu [data-maction=export-users]').click();
  const download = await dl;
  const first0 = await page.evaluate(() => document.querySelector('#userRows .u-nm')!.textContent);
  await page.locator('[data-usort=name]').click();
  await page.locator('[data-usort=name]').click();
  const sorted = await page.evaluate(() => ({ first: document.querySelector('#userRows .u-nm')!.textContent, ic: document.querySelector('[data-usort=name] .sort-ic')!.textContent }));
  const a = { edit, vocab, susConf, susToast, menuHasForce, forceVerb, exportItem, file: download.suggestedFilename(), first0, sorted };
  const pass = edit.name && edit.roles >= 2 && edit.emailRo && edit.tenantRo && !edit.statusField
    && vocab && susConf === 'Suspend' && susToast === 'Status updated'
    && menuHasForce && forceVerb === 'Force logout' && exportItem && download.suggestedFilename() === 'users.csv'
    && sorted.first !== first0 && sorted.ic === '▼';
  rec('users-model', pass, a);
  expect(pass, 'users-model').toBe(true);
});

test('roles-model', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 7 (A): platform-only codes locked for tenant roles; sample data inside the partition;
  // parent hierarchy in edit; scope editor only with users:*; clear-all is confirm-gated; matrix is a
  // concept view annotated as mapping to AntD Transfer.
  await page.evaluate(() => { (document.querySelector('[data-page=roles]') as HTMLElement).click(); (document.querySelector('#roleRows tr[data-role="1"]') as HTMLElement).click(); });
  const lock = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#matrixRows .perm-cell.locked')] as HTMLButtonElement[];
    const n0 = document.querySelectorAll('#matrixRows .perm-cell.on').length;
    cells.forEach(c => c.click());
    const n1 = document.querySelectorAll('#matrixRows .perm-cell.on').length;
    return { locked: cells.length, allDisabled: cells.every(c => c.disabled), unchanged: n0 === n1 };
  });
  const partition = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#roleRows tr')];
    // editor (Acme) must not show any platform-only granted cell
    const codes = [...document.querySelectorAll('#matrixRows .perm-cell.on')].map(c => (c as HTMLElement).dataset.code);
    const plat = ['tenants:', 'options:', 'clients:', 'apikeys:', 'permissions:write', 'permissions:delete'];
    return { editorClean: codes.every(c => !plat.some(pp => c!.startsWith(pp))), granted: codes.length };
  });
  const scopeVis = await page.evaluate(() => getComputedStyle(document.querySelector('.scope-box')!).display !== 'none');
  await page.locator('#roleRows tr[data-role="1"] button[aria-label="Edit"]').click();
  const parentSel = await page.evaluate(() => { const s = document.querySelector('#formBody [data-field=parent]') as HTMLSelectElement; return { exists: !!s, opts: s ? s.options.length : 0 }; });
  await page.keyboard.press('Escape');
  const note = await page.evaluate(() => document.querySelector('.matrix-legend')!.textContent!.includes('AntD Transfer') && document.querySelector('.matrix-legend')!.textContent!.includes('platform-only'));
  await page.locator('#clearPermsBtn').click(); // adjudication 25: stages an empty draft
  await page.locator('#mtxSave').click(); // saving empty raises the danger confirm
  const clearVerb = await page.evaluate(() => document.getElementById('confirmDelete')!.textContent);
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600); // simulated save failure keeps the draft
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600);
  const cleared = await page.evaluate(() => ({ on: document.querySelectorAll('#matrixRows .perm-cell.on').length, scopeHidden: getComputedStyle(document.querySelector('.scope-box')!).display === 'none' }));
  const a = { lock, partition, scopeVis, parentSel, note, clearVerb, cleared };
  const pass = lock.locked > 0 && lock.allDisabled && lock.unchanged
    && partition.editorClean && partition.granted === 9 && scopeVis
    && parentSel.exists && parentSel.opts >= 6 && note
    && clearVerb === 'Save empty' && cleared.on === 0 && cleared.scopeHidden;
  rec('roles-model', pass, a);
  expect(pass, 'roles-model').toBe(true);
});

test('tenants-model', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 8 (A): Init-admin bootstrap (policy + EMAIL_EXISTS + alreadyBootstrapped), soft delete
  // keeping the row suspended, suspend/activate confirm, slug required+pattern, no status filter.
  await page.evaluate(() => { (document.querySelector('[data-page=tenants]') as HTMLElement).click(); });
  const noFilter = await page.evaluate(() => !document.getElementById('tenantStatusFilter'));
  await page.locator('#tenantRows button[data-tinit]').nth(2).click(); // Globex, not bootstrapped
  const initOpen = await page.evaluate(() => ({ on: document.getElementById('initAdminModal')!.classList.contains('on'), form: document.getElementById('initForm')!.style.display !== 'none' }));
  await page.locator('#initEmail').fill('newadmin@globex.example');
  await page.locator('#initName').fill('Globex Admin');
  await page.locator('#initPwd').fill('short');
  await page.locator('#initSubmit').click();
  const pwdErr = await page.evaluate(() => document.getElementById('initPwdErr')!.textContent!.includes('12+')); // adjudication 27: shared policy, field-level
  await page.locator('#initEmail').fill('jane.doe@globex.com'); // existing user -> EMAIL_EXISTS
  await page.locator('#initPwd').fill('Passw0rd123!');
  await page.locator('#initSubmit').click();
  const existsErr = await page.evaluate(() => document.getElementById('initEmailErr')!.textContent!.includes('EMAIL_EXISTS')); // adjudication 27: 409 highlights the field
  await page.locator('#initEmail').fill('newadmin@globex.example');
  await page.locator('#initSubmit').click();
  await page.waitForTimeout(600); // adjudication 27: simulated TENANT_PROTECTED server error
  const initSrvErr = await page.evaluate(() => document.getElementById('initErr')!.textContent!.includes('TENANT_PROTECTED'));
  await page.locator('#initSubmit').click();
  await page.waitForTimeout(600);
  const created = await page.evaluate(() => !document.getElementById('initAdminModal')!.classList.contains('on') && document.getElementById('protoToast')!.textContent === 'Initial admin created');
  await page.locator('#tenantRows button[data-tinit]').nth(2).click();
  const bootstrapped = await page.evaluate(() => document.getElementById('initDone')!.style.display === 'flex' && document.getElementById('initForm')!.style.display === 'none');
  await page.keyboard.press('Escape');
  await page.locator('#tenantRows button[data-tinit]').nth(1).click(); // Acme already bootstrapped
  const acmeDone = await page.evaluate(() => document.getElementById('initDone')!.style.display === 'flex');
  await page.keyboard.press('Escape');
  await page.locator('#tenantRows button[data-tstatus]').nth(2).click();
  const susVerb = await page.evaluate(() => document.getElementById('confirmDelete')!.textContent);
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600); // adjudication 27: simulated statusError, confirm acts as Retry
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600);
  const suspended = await page.evaluate(() => document.querySelectorAll('#tenantRows tr')[2].textContent!.includes('Suspended'));
  await page.locator('#tenantRows tr').nth(4).locator('button[aria-label="Delete"]').click();
  const softMsg = await page.evaluate(() => document.getElementById('confirmMsg')!.textContent!.includes('soft delete'));
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600); // adjudication 27: simulated deleteError keeps the row
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600);
  const softKept = await page.evaluate(() => ({ rows: document.querySelectorAll('#tenantRows tr').length, kept: document.querySelectorAll('#tenantRows tr')[4].textContent!.includes('Umbrella') && document.querySelectorAll('#tenantRows tr')[4].textContent!.includes('Suspended') }));
  await page.locator('[data-create=tenants]').click();
  await page.locator('#formBody [data-field=name]').fill('Test Co');
  await page.locator('#formBody [data-field=slug]').fill('Bad_Slug');
  await page.locator('#formSave').click();
  const slugErr = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('lowercase letters/digits'));
  await page.locator('#formBody [data-field=slug]').fill('');
  await page.locator('#formSave').click();
  const slugReq = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('Slug is required'));
  // create: async w/ simulated createError then success
  await page.locator('#formBody [data-field=slug]').fill('test-co');
  await page.locator('#formSave').click();
  await page.waitForTimeout(600);
  const createErr = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('Create failed'));
  await page.locator('#formSave').click();
  await page.waitForTimeout(600);
  const createdRow = await page.evaluate(() => ({ rows: document.querySelectorAll('#tenantRows tr').length, closed: !document.getElementById('formModal')!.classList.contains('on') }));
  // post-closure fix 7: copy icons give feedback (were silent); clipboard-reject falls back to
  // execCommand; both-fail reports an error toast; the locked default row explains its disabled icons
  // via the tip-wrap hint; under zh every tenants row action still responds (en-original delegates).
  const copyOk = await page.evaluate(async () => {
    const b = document.querySelector('#tenantRows tr:nth-child(2) [data-copy]') as HTMLButtonElement;
    b.click();
    await new Promise(r => setTimeout(r, 100));
    return { toast: document.getElementById('protoToast')!.textContent, glyph: b.querySelector('use')!.getAttribute('href'), cls: b.classList.contains('copied') };
  });
  await page.waitForTimeout(1300);
  const copyRevert = await page.evaluate(() => {
    const b = document.querySelector('#tenantRows tr:nth-child(2) [data-copy]') as HTMLButtonElement;
    return { glyph: b.querySelector('use')!.getAttribute('href'), cls: b.classList.contains('copied') };
  });
  const copyFallback = await page.evaluate(async () => {
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
    (navigator.clipboard as any).writeText = () => Promise.reject(new Error('denied'));
    const ec = document.execCommand.bind(document);
    (document as any).execCommand = (cmd: string) => cmd === 'copy' ? true : ec(cmd);
    const b = document.querySelector('#tenantRows tr:nth-child(3) [data-copy]') as HTMLButtonElement;
    b.click();
    await new Promise(r => setTimeout(r, 100));
    const t = document.getElementById('protoToast')!.textContent;
    (navigator.clipboard as any).writeText = orig; (document as any).execCommand = ec;
    return t;
  });
  const copyFail = await page.evaluate(async () => {
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
    (navigator.clipboard as any).writeText = () => Promise.reject(new Error('denied'));
    const ec = document.execCommand.bind(document);
    (document as any).execCommand = () => false;
    const b = document.querySelector('#tenantRows tr:nth-child(4) [data-copy]') as HTMLButtonElement;
    b.click();
    await new Promise(r => setTimeout(r, 100));
    const t = document.getElementById('protoToast')!.textContent;
    const kind = document.getElementById('protoToast')!.className;
    (navigator.clipboard as any).writeText = orig; (document as any).execCommand = ec;
    return { t, kind };
  });
  const lockedHint = await page.evaluate(() => {
    const w = document.querySelector('#tenantRows tr:first-child .row-actions .tip-wrap') as HTMLElement;
    return { tip: w.getAttribute('data-tip'), dis: (w.querySelector('button') as HTMLButtonElement).disabled };
  });
  await page.locator('#tenantRows tr:first-child .row-actions .tip-wrap').first().hover();
  await page.waitForTimeout(200);
  const lockedTipOn = await page.evaluate(() => document.getElementById('floatTip')!.classList.contains('on') && document.getElementById('floatTip')!.textContent!.includes('Locked'));
  await page.evaluate(() => { (document.getElementById('langBtn') as HTMLElement).click(); });
  const zhTr = '#tenantRows tr:nth-child(2)';
  await page.locator(zhTr + ' button[aria-label="编辑"]').click();
  const zhEdit = await page.evaluate(() => document.getElementById('formModal')!.classList.contains('on'));
  await page.keyboard.press('Escape');
  await page.locator(zhTr + ' [data-tstatus]').click();
  const zhStatus = await page.evaluate(() => document.getElementById('confirmModal')!.classList.contains('on'));
  await page.keyboard.press('Escape');
  await page.locator(zhTr + ' [data-tinit]').click();
  const zhInit = await page.evaluate(() => document.getElementById('initAdminModal')!.classList.contains('on'));
  await page.keyboard.press('Escape');
  await page.locator(zhTr + ' button[aria-label="删除"]').click();
  const zhDel = await page.evaluate(() => document.getElementById('confirmModal')!.classList.contains('on'));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { (document.getElementById('langBtn') as HTMLElement).click(); });
  const a = { noFilter, initOpen, pwdErr, existsErr, initSrvErr, created, bootstrapped, acmeDone, susVerb, suspended, softMsg, softKept, slugErr, slugReq, createErr, createdRow, copyOk, copyRevert, copyFallback, copyFail, lockedHint, lockedTipOn, zhEdit, zhStatus, zhInit, zhDel };
  const pass = noFilter && initOpen.on && initOpen.form && pwdErr && existsErr && initSrvErr && created && bootstrapped && acmeDone
    && createErr && createdRow.rows === 6 && createdRow.closed
    && susVerb === 'Suspend' && suspended && softMsg && softKept.rows === 5 && softKept.kept && slugErr && slugReq
    && copyOk.toast === 'Copied' && copyOk.glyph === '#i-check' && copyOk.cls
    && copyRevert.glyph === '#i-copy' && !copyRevert.cls
    && copyFallback === 'Copied' && copyFail.t === 'Copy failed' && copyFail.kind.includes('error')
    && lockedHint.tip === 'Locked (default tenant)' && lockedHint.dis && lockedTipOn
    && zhEdit && zhStatus && zhInit && zhDel;
  rec('tenants-model', pass, a);
  expect(pass, 'tenants-model').toBe(true);
});

test('users-erasure', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 9 (A): delete confirm carries the RTBF branch (eraseAudit + required legalBasis),
  // LAST_ADMIN_GUARD refusal, ERASE_LOCK_BUSY retryable 409, and a one-time erasure receipt.
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); });
  const openDel = async (n: number) => {
    await page.locator('#userRows button[data-more]').nth(n).click();
    await page.locator('#rowMenu [data-maction=delete]').click();
  };
  await openDel(1); // Alice = only active owner -> last-admin guard
  const secShown = await page.evaluate(() => document.getElementById('eraseSection')!.style.display === 'block');
  await page.locator('#eraseAudit').check();
  const basisShown = await page.evaluate(() => document.getElementById('legalBasisWrap')!.style.display === 'block');
  await page.locator('#confirmDelete').click();
  const err400 = await page.evaluate(() => ({ on: document.getElementById('confirmModal')!.classList.contains('on'), msg: document.getElementById('confirmErr')!.textContent!.includes('legalBasis is required') }));
  await page.locator('#legalBasis').fill('GDPR Art. 17 request #1');
  await page.locator('#confirmDelete').click();
  const guard = await page.evaluate(() => ({ on: document.getElementById('confirmModal')!.classList.contains('on'), msg: document.getElementById('confirmErr')!.textContent!.includes('LAST_ADMIN_GUARD') }));
  await page.locator('#confirmCancel').click();
  const rows0 = await page.evaluate(() => eval('USERS.length'));
  await openDel(0); // Jane, not admin
  await page.locator('#eraseAudit').check();
  await page.locator('#legalBasis').fill('GDPR Art. 17 request #2');
  await page.locator('#confirmDelete').click();
  const busy = await page.evaluate(() => ({ msg: document.getElementById('confirmErr')!.textContent!.includes('ERASE_LOCK_BUSY'), retry: document.getElementById('confirmRetry')!.style.display !== 'none' }));
  await page.locator('#confirmRetry').click();
  const receipt = await page.evaluate(() => ({
    shown: document.getElementById('confirmReceipt')!.style.display === 'block',
    hash: /receiptHash: [0-9a-f]{16}/.test(document.getElementById('confirmReceipt')!.textContent!),
    rows: document.getElementById('confirmReceipt')!.textContent!.includes('rowsAffected'),
    delHidden: document.getElementById('confirmDelete')!.style.display === 'none',
    closeLabel: document.getElementById('confirmCancel')!.textContent === 'Close',
  }));
  await page.locator('#confirmCancel').click();
  const rows1 = await page.evaluate(() => eval('USERS.length'));
  await openDel(1); // Bob, plain delete (no erase)
  const eraseOff = await page.evaluate(() => !document.getElementById('eraseAudit')!.checked);
  await page.locator('#confirmDelete').click();
  const plain = await page.evaluate(() => ({ rows: eval('USERS.length'), toast: document.getElementById('protoToast')!.textContent }));
  const a = { secShown, basisShown, err400, guard, busy, receipt, rows0, rows1, eraseOff, plain };
  const pass = secShown && basisShown && err400.on && err400.msg && guard.on && guard.msg
    && busy.msg && busy.retry && receipt.shown && receipt.hash && receipt.rows && receipt.delHidden && receipt.closeLabel
    && rows1 === rows0 - 1 && eraseOff && plain.rows === rows1 - 1 && plain.toast === 'Deleted';
  rec('users-erasure', pass, a);
  expect(pass, 'users-erasure').toBe(true);
});

test('webhooks-model', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 10 (A): Enabled is a Switch (not a counter); delivery vocab pending/delivered/dead;
  // form has description + per-event '*'|resource.action validation + presets; url http(s) required.
  await page.evaluate(() => { (document.querySelector('[data-page=webhooks]') as HTMLElement).click(); });
  const sw0 = await page.evaluate(() => ({ n: document.querySelectorAll('#webhookRows [role=switch]').length, on: document.querySelector('#webhookRows [role=switch]')!.getAttribute('aria-checked') }));
  await page.locator('#webhookRows [data-wenabled]').first().click();
  await page.waitForTimeout(600); // adjudication 23: toggle async, first attempt simulated failure
  const swErr = await page.evaluate(() => ({ on: document.querySelector('#webhookRows [role=switch]')!.getAttribute('aria-checked'), toast: document.getElementById('protoToast')!.textContent }));
  await page.locator('#webhookRows [data-wenabled]').first().click();
  await page.waitForTimeout(600);
  const sw1 = await page.evaluate(() => ({ on: document.querySelector('#webhookRows [role=switch]')!.getAttribute('aria-checked'), toast: document.getElementById('protoToast')!.textContent }));
  await page.locator('#webhookRows [data-wenabled]').first().click();
  await page.waitForTimeout(600); // restore
  // ping QUEUES a pending webhook.test delivery (real pingQueued), first attempt simulated failure
  const pend0 = await page.evaluate(() => eval('WEBHOOKS')[0].pending);
  await page.locator('#webhookRows [data-ping]').first().click();
  const pingBusy = await page.evaluate(() => (document.querySelector('#webhookRows [data-ping]') as HTMLButtonElement).disabled);
  await page.waitForTimeout(600);
  const pingErr = await page.evaluate(() => document.getElementById('protoToast')!.textContent!.includes('Ping failed'));
  await page.locator('#webhookRows [data-ping]').first().click();
  await page.waitForTimeout(600);
  const pingOk = await page.evaluate(() => ({ toast: document.getElementById('protoToast')!.textContent, pend: eval('WEBHOOKS')[0].pending, first: eval('WEBHOOKS')[0].deliveries[0] }));
  // rotate: Busy + simulated failure then reveal-once
  await page.locator('#webhookRows [data-rotate-wh]').first().click();
  await page.waitForTimeout(600);
  const rotErr = await page.evaluate(() => document.getElementById('protoToast')!.textContent!.includes('Rotate failed'));
  await page.locator('#webhookRows [data-rotate-wh]').first().click();
  await page.waitForTimeout(600);
  const rotOk = await page.evaluate(() => ({ reveal: document.getElementById('revealModal')!.classList.contains('on'), toast: document.getElementById('protoToast')!.textContent }));
  await page.keyboard.press('Escape');
  // deliveries: skeleton loading + loadError + retry
  await page.locator('#webhookRows [data-deliv]').first().click();
  const delivSkel = await page.evaluate(() => document.querySelectorAll('#delivRows .skel').length);
  await page.waitForTimeout(600);
  const delivErr = await page.evaluate(() => document.getElementById('delivErr')!.style.display === 'flex');
  await page.locator('#delivRetry').click();
  await page.waitForTimeout(600);
  const vocab = await page.evaluate(() => {
    const txt = document.getElementById('delivRows')!.textContent!;
    return { ok: /delivered/.test(txt), bad: /success|failed/.test(txt), pend: /pending/.test(txt) };
  });
  await page.keyboard.press('Escape');
  // write gate via the demo perspective switch (read-only keeps deliveries available)
  await page.evaluate(() => { const s = document.getElementById('whPermView') as HTMLSelectElement; s.value = 'read'; s.onchange!(new Event('change')); });
  const gate = await page.evaluate(() => ({ sw: (document.querySelector('#webhookRows [data-wenabled]') as HTMLButtonElement).disabled, ping: (document.querySelector('#webhookRows [data-ping]') as HTMLButtonElement).disabled, create: (document.querySelector('[data-create=webhooks]') as HTMLButtonElement).disabled, deliv: !(document.querySelector('#webhookRows [data-deliv]') as HTMLButtonElement).disabled }));
  await page.evaluate(() => { const s = document.getElementById('whPermView') as HTMLSelectElement; s.value = 'write'; s.onchange!(new Event('change')); });
  await page.locator('[data-create=webhooks]').click();
  const form = await page.evaluate(() => ({
    url: !!document.querySelector('#formBody [data-field=url]'),
    events: !!document.querySelector('#formBody [data-field=events]'),
    desc: !!document.querySelector('#formBody [data-field=description]'),
    presets: document.querySelectorAll('#formBody [data-evpreset]').length,
  }));
  await page.locator('#formBody [data-field=url]').fill('notaurl');
  await page.locator('#formSave').click();
  const urlErr = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('http(s)'));
  await page.locator('#formBody [data-field=url]').fill('https://e2e.example/hook');
  await page.locator('#formBody [data-field=events]').fill('Bad_Event');
  await page.locator('#formSave').click();
  const evErr = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('resource.action'));
  await page.locator('#formBody [data-evpreset="*"]').click();
  const chipVal = await page.evaluate(() => (document.querySelector('#formBody [data-field=events]') as HTMLInputElement).value);
  await page.locator('#formBody [data-field=events]').fill('*');
  await page.locator('#formBody [data-field=description]').fill('E2E sink');
  await page.locator('#formSave').click();
  const created = await page.evaluate(() => ({
    reveal: document.getElementById('revealModal')!.classList.contains('on'),
    rows: document.querySelectorAll('#webhookRows tr').length,
    desc: document.getElementById('webhookRows')!.textContent!.includes('E2E sink'),
  }));
  const a = { sw0, swErr, sw1, pend0, pingBusy, pingErr, pingOk, rotErr, rotOk, delivSkel, delivErr, vocab, gate, form, urlErr, evErr, chipVal, created };
  const pass = sw0.n === 3 && sw0.on === 'true'
    && swErr.on === 'true' && swErr.toast.includes('Update failed') && sw1.on === 'false' && sw1.toast === 'Endpoint updated'
    && pingBusy && pingErr && pingOk.toast === 'Ping queued (webhook.test)' && pingOk.pend === pend0 + 1
    && pingOk.first.status === 'pending' && pingOk.first.response === null
    && rotErr && rotOk.reveal && rotOk.toast === 'Secret rotated'
    && delivSkel === 3 && delivErr && vocab.ok && vocab.pend && !vocab.bad
    && gate.sw && gate.ping && gate.create && gate.deliv
    && form.url && form.events && form.desc && form.presets === 5
    && urlErr && evErr && chipVal.includes('*') && created.reveal && created.rows === 4 && created.desc;
  rec('webhooks-model', pass, a);
  expect(pass, 'webhooks-model').toBe(true);
});

test('events-model', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 11 (A): event catalog matches identity events.ts (no role.updated / audit.appended);
  // families = user/role/tenant/apikey/group/webhook/auth (no audit); date-range filter works.
  await page.evaluate(() => { (document.querySelector('[data-page=events]') as HTMLElement).click(); });
  const base = await page.evaluate(() => {
    const types = eval('EVENTS').map((e: any) => e.type);
    const catalog = ['user.created', 'user.updated', 'user.deleted', 'user.suspended', 'role.changed', 'tenant.created', 'tenant.updated', 'tenant.suspended', 'tenant.deleted', 'apikey.revoked', 'group.changed', 'webhook.test', 'auth.login', 'auth.logout', 'auth.backchannel_logout'];
    const fams = [...document.querySelectorAll('#eventFamilyFilter option')].map(o => o.value).filter(Boolean);
    return { allReal: types.every((t: string) => catalog.includes(t)), noFiction: !types.includes('role.updated') && !types.includes('audit.appended'), fams, rows: document.querySelectorAll('#eventRows tr').length };
  });
  await page.evaluate(() => { const f = document.getElementById('eventFrom') as HTMLInputElement; f.value = '2026-11-18'; f.dispatchEvent(new Event('input')); });
  const fromRows = await page.evaluate(() => document.querySelectorAll('#eventRows tr').length);
  await page.evaluate(() => { const f = document.getElementById('eventTo') as HTMLInputElement; f.value = '2026-11-17'; f.dispatchEvent(new Event('input')); const fr = document.getElementById('eventFrom') as HTMLInputElement; fr.value = '2026-11-17'; fr.dispatchEvent(new Event('input')); });
  const dayRows = await page.evaluate(() => document.querySelectorAll('#eventRows tr').length);
  await page.evaluate(() => { const fr = document.getElementById('eventFrom') as HTMLInputElement; fr.value = ''; fr.dispatchEvent(new Event('input')); const ft = document.getElementById('eventTo') as HTMLInputElement; ft.value = ''; ft.dispatchEvent(new Event('input')); const ff = document.getElementById('eventFamilyFilter') as HTMLSelectElement; ff.value = 'group'; ff.dispatchEvent(new Event('input')); });
  const groupRows = await page.evaluate(() => ({ n: document.querySelectorAll('#eventRows tr').length, tag: document.querySelector('#eventRows .tag')!.textContent }));
  const a = { base, fromRows, dayRows, groupRows };
  const pass = base.allReal && base.noFiction && base.rows === 8
    && JSON.stringify(base.fams) === JSON.stringify(['user', 'role', 'tenant', 'apikey', 'group', 'webhook', 'auth'])
    && fromRows === 7 && dayRows === 1 && groupRows.n === 1 && groupRows.tag === 'group.changed';
  rec('events-model', pass, a);
  expect(pass, 'events-model').toBe(true);
});

test('events-load', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 29 (A): reload/Search async skeleton + simulated loadError Alert + Retry;
  // Search primary button + reset-filters icon (Tooltip/aria-label) clearing filters and reloading.
  await page.evaluate(() => { (document.querySelector('[data-page=events]') as HTMLElement).click(); });
  const toolbar = await page.evaluate(() => ({
    search: (document.getElementById('eventSearchBtn') as HTMLButtonElement).textContent,
    resetAria: document.getElementById('eventResetBtn')!.getAttribute('aria-label'),
    resetTip: document.getElementById('eventResetBtn')!.getAttribute('data-tip'),
    note: document.querySelector('#page-events .range-note')!.textContent!.includes('startDate/endDate'),
  }));
  await page.locator('#page-events .icon-btn[data-reload=events]').click();
  const skel = await page.evaluate(() => document.querySelectorAll('#eventRows .skel').length);
  await page.waitForTimeout(600);
  const loadErr = await page.evaluate(() => ({ banner: document.getElementById('evLoadBanner')!.style.display === 'flex', rows: document.querySelectorAll('#eventRows tr').length }));
  await page.locator('#evLoadRetry').click();
  await page.waitForTimeout(600);
  const retryOk = await page.evaluate(() => ({ banner: document.getElementById('evLoadBanner')!.style.display === 'none', rows: document.querySelectorAll('#eventRows tr').length }));
  await page.locator('#eventSearchBtn').click();
  const searchSkel = await page.evaluate(() => document.querySelectorAll('#eventRows .skel').length);
  await page.waitForTimeout(600);
  const searchOk = await page.evaluate(() => document.querySelectorAll('#eventRows tr').length);
  await page.evaluate(() => { const f = document.getElementById('eventFamilyFilter') as HTMLSelectElement; f.value = 'user'; f.dispatchEvent(new Event('input')); });
  const narrowed = await page.evaluate(() => document.querySelectorAll('#eventRows tr').length);
  await page.locator('#eventResetBtn').click();
  await page.waitForTimeout(600);
  const reset = await page.evaluate(() => ({ fam: (document.getElementById('eventFamilyFilter') as HTMLSelectElement).value, rows: document.querySelectorAll('#eventRows tr').length }));
  const a = { toolbar, skel, loadErr, retryOk, searchSkel, searchOk, narrowed, reset };
  const pass = toolbar.search === 'Search' && toolbar.resetAria === 'Reset filters' && toolbar.resetTip === 'Reset filters' && toolbar.note
    && skel === 24 && loadErr.banner && loadErr.rows === 0
    && retryOk.banner && retryOk.rows === 8 && searchSkel === 24 && searchOk === 8
    && narrowed < 8 && reset.fam === '' && reset.rows === 8;
  rec('events-load', pass, a);
  expect(pass, 'events-load').toBe(true);
});

test('reduced-motion', async ({ page }) => {
  // Adjudication 30 (A): under prefers-reduced-motion the shimmer/spinner stop, knob/chev/tooltip
  // transitions collapse and scrolling is instant; normal mode keeps the motion (no over-kill).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(FILE);
  const reduced = await page.evaluate(() => {
    const sk = document.createElement('div'); sk.className = 'skel'; document.body.appendChild(sk);
    const knob = document.querySelector('.wswitch .knob')!;
    const chev = document.querySelector('.cbx-chev')!;
    const r = {
      matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      skel: getComputedStyle(sk).animationName,
      knob: getComputedStyle(knob).transitionDuration,
      chev: getComputedStyle(chev).transitionDuration,
      tip: getComputedStyle(document.getElementById('floatTip')!).transitionDuration,
      scroll: getComputedStyle(document.documentElement).scrollBehavior,
    };
    sk.remove();
    return r;
  });
  const page2 = await page.context().newPage();
  await page2.goto(FILE);
  const normal = await page2.evaluate(() => {
    const sk = document.createElement('div'); sk.className = 'skel'; document.body.appendChild(sk);
    const r = {
      skel: getComputedStyle(sk).animationName,
      knob: getComputedStyle(document.querySelector('.wswitch .knob')!).transitionDuration,
      tip: getComputedStyle(document.getElementById('floatTip')!).transitionDuration,
    };
    sk.remove();
    return r;
  });
  await page.goto(AUTH);
  const reducedAuth = await page.evaluate(() => {
    const sp = document.createElement('span'); sp.className = 'spin'; document.body.appendChild(sp);
    const r = { spin: getComputedStyle(sp).animationName, tip: getComputedStyle(document.getElementById('floatTip')!).transitionDuration };
    sp.remove(); return r;
  });
  await page2.goto(AUTH);
  const normalAuth = await page2.evaluate(() => {
    const sp = document.createElement('span'); sp.className = 'spin'; document.body.appendChild(sp);
    const r = { spin: getComputedStyle(sp).animationName };
    sp.remove(); return r;
  });
  await page2.close();
  const a = { reduced, normal, reducedAuth, normalAuth };
  const pass = reduced.matches && reduced.skel === 'none' && reduced.knob === '0s' && reduced.chev === '0s'
    && reduced.tip === '0s'
    && reduced.scroll === 'auto'
    && normal.skel === 'skel' && normal.knob !== '0s' && normal.tip !== '0s'
    && reducedAuth.spin === 'none' && reducedAuth.tip === '0s' && normalAuth.spin === 'cbxrot';
  rec('reduced-motion', pass, a);
  expect(pass, 'reduced-motion').toBe(true);
});

test('i18n', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 31 (A): topbar 中文/EN toggle (stored+probe, aria-label), zh chrome translation incl.
  // locale-aware relative times, data values untouched, exact en restore, dictionary parity/coverage.
  const en0 = await page.evaluate(() => ({ btn: document.getElementById('langBtn')!.textContent, aria: document.getElementById('langBtn')!.getAttribute('aria-label'), nav: document.querySelector('[data-page=users] .lbl')!.textContent }));
  await page.locator('#langBtn').click();
  const zhUsers = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    btn: document.getElementById('langBtn')!.textContent,
    nav: document.querySelector('[data-page=users] .lbl')!.textContent,
    h1: document.querySelector('#page-users h1')!.textContent,
    tag: document.querySelector('#userRows .tag')!.textContent!.trim(),
    search: (document.getElementById('userSearch') as HTMLInputElement).placeholder,
    stored: localStorage.getItem('ab-lang'),
  }));
  await page.evaluate(() => { const s = document.getElementById('userSearch') as HTMLInputElement; s.value = 'zzzz'; s.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(80); // translation observer debounce
  const zhEmpty = await page.evaluate(() => document.querySelector('#page-users .empty, #userRows')!.textContent!);
  await page.evaluate(() => { const s = document.getElementById('userSearch') as HTMLInputElement; s.value = ''; s.dispatchEvent(new Event('input')); (document.querySelector('[data-page=tenants]') as HTMLElement).click(); });
  const zhTenants = await page.evaluate(() => ({ created: document.querySelectorAll('#tenantRows tr')[1].textContent!.includes('个月前'), head: document.querySelector('#page-tenants h1')!.textContent, name0: document.querySelectorAll('#tenantRows tr')[0].textContent!.includes('Default') }));
  await page.locator('#tenantRows [data-tstatus]:not([disabled])').first().click();
  await page.waitForTimeout(80);
  const zhVerb = await page.evaluate(() => document.getElementById('confirmDelete')!.textContent);
  await page.locator('#confirmCancel').click();
  await page.evaluate(() => { (document.querySelector('[data-page=groups]') as HTMLElement).click(); });
  const zhData = await page.evaluate(() => ({ sec: [...document.querySelectorAll('#groupRows tr')].some(tr => tr.textContent!.includes('Security')), email: true }));
  await page.evaluate(() => { (document.querySelector('[data-page=settings]') as HTMLElement).click(); });
  const zhTab = await page.evaluate(() => [...document.querySelectorAll('#settingsTabs button')].map(b => b.textContent!.trim()));
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); });
  await page.locator('#userRows tr:first-child .row-actions button:nth-child(2)').click();
  const zhEdit = await page.evaluate(() => document.getElementById('formModal')!.classList.contains('on'));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { (document.querySelector('[data-page=settings]') as HTMLElement).click(); });
  const dict = await page.evaluate(() => {
    const vals = Object.values(eval('I18N_ZH')) as string[];
    const keys = Object.keys(eval('I18N_ZH'));
    const coverage = ['Users', 'Roles', 'Settings', 'Active', 'Suspended', 'Delete', 'Cancel', 'Retry', 'Clear filters', 'No results match the current filters', 'Copied to clipboard', 'Save empty', 'Created', 'Status', 'General', 'Security', 'Options', 'Email templates'];
    return { n: keys.length, allNonEmpty: vals.every(v => typeof v === 'string' && v.trim().length > 0), coverage: coverage.every(k => keys.includes(k)) };
  });
  await page.locator('#langBtn').click();
  const enBack = await page.evaluate(() => ({
    btn: document.getElementById('langBtn')!.textContent,
    nav: document.querySelector('[data-page=users] .lbl')!.textContent,
    tab: [...document.querySelectorAll('#settingsTabs button')].map(b => b.textContent!.trim()).includes('Security'),
    stored: localStorage.getItem('ab-lang'),
  }));
  await page.evaluate(() => { (document.querySelector('[data-page=tenants]') as HTMLElement).click(); });
  const enCreated = await page.evaluate(() => document.querySelectorAll('#tenantRows tr')[1].textContent!.includes('months ago'));
  // stored preference survives reload
  await page.locator('#langBtn').click();
  await page.reload();
  const persisted = await page.evaluate(() => ({ lang: document.documentElement.lang, nav: document.querySelector('[data-page=users] .lbl')!.textContent }));
  // Adjudication 34 (A): companion dictionary parity/coverage + zh chrome + exact en restore.
  await page.goto(AUTH);
  const zhAuth = await page.evaluate(() => ({
    nav: document.querySelector('[data-flow=login]')!.textContent,
    h1: document.querySelector('#flow-login h1')!.textContent,
    approve: (document.getElementById('csApprove') as HTMLButtonElement).textContent,
  }));
  const dictAuth = await page.evaluate(() => {
    const vals = Object.values(eval('I18N_ZH')) as string[];
    const keys = Object.keys(eval('I18N_ZH'));
    const coverage = ['Sign in', 'Register', 'Approve', 'Deny', 'Continue', 'Next', 'Back', 'Finish', 'Retry', 'Copied to clipboard', 'Copy failed', 'Passwords do not match'];
    return { n: keys.length, allNonEmpty: vals.every(v => typeof v === 'string' && v.trim().length > 0), coverage: coverage.every(k => keys.includes(k)) };
  });
  await page.locator('#langBtn').click();
  const enAuth = await page.evaluate(() => ({
    nav: document.querySelector('[data-flow=login]')!.textContent,
    h1: document.querySelector('#flow-login h1')!.textContent,
    client: document.getElementById('csClient')!.textContent!.includes('Web App'),
  }));
  const a = { en0, zhUsers, zhEmpty: zhEmpty.includes('没有符合当前过滤条件的结果'), zhTenants, zhVerb, zhData, zhTab, zhEdit, dict, enBack, enCreated, persisted, zhAuth, dictAuth, enAuth };
  const pass = en0.btn === '中文' && en0.aria === 'Language' && en0.nav === 'Users'
    && zhUsers.lang === 'zh-CN' && zhUsers.btn === 'EN' && zhUsers.nav === '用户' && zhUsers.h1 === '用户'
    && zhUsers.tag === '活跃' && zhUsers.search === '按姓名或邮箱搜索…' && zhUsers.stored === 'zh'
    && a.zhEmpty && zhTenants.created && zhTenants.head === '租户' && zhTenants.name0 && zhVerb === '暂停'
    && zhData.sec && zhTab.includes('安全') && zhTab.includes('邮件模板')
    && dict.n > 200 && dict.allNonEmpty && dict.coverage
    && enBack.btn === '中文' && enBack.nav === 'Users' && enBack.tab && enBack.stored === 'en' && enCreated
    && persisted.lang === 'zh-CN' && persisted.nav === '用户'
    && zhAuth.nav === '登录' && zhAuth.h1 === '登录' && zhAuth.approve === '同意'
    && dictAuth.n > 100 && dictAuth.allNonEmpty && dictAuth.coverage
    && enAuth.nav === 'Login' && enAuth.h1 === 'Sign in' && enAuth.client && zhEdit;
  rec('i18n', pass, a);
  expect(pass, 'i18n').toBe(true);
});

test('i18n-dynamic', async ({ page }) => {
  // ruling 7A: every dynamic toast/busy/formError literal in BOTH prototypes must translate under
  // zh (dictionary key or rule). Source-literal scan replaces the old 18-key existence tautology.
  await page.goto(FILE);
  const src = fs.readFileSync(path.resolve(__dirname, '../admin-console.html'), 'utf8');
  const srcB = fs.readFileSync(path.resolve(__dirname, '../auth-flows.html'), 'utf8');
  const un = (s: string) => s.replace(/\\'/g, "'").replace(/\\"/g, '"');
  const lits = (t: string) => {
    const out: string[] = [];
    for (const m of t.matchAll(/(?:toast|formError)\('((?:[^'\\]|\\.)*)'(?:,[^)]*)?\)/g)) out.push(un(m[1]));
    for (const m of t.matchAll(/btnBusy\([^,]+,\s*(?:true|false)\s*,\s*'((?:[^'\\]|\\.)*)'\)/g)) out.push(un(m[1]));
    return [...new Set(out)].filter(Boolean);
  };
  const PREFIX: Record<string, string> = {
    'Exported ': 'Exported 3 rows',
    'Slug "': 'Slug "x" already exists',
    'Each event must be * or resource.action (lowercase): ': 'Each event must be * or resource.action (lowercase): bad',
  };
  await page.evaluate(() => { if (!document.documentElement.lang.startsWith('zh')) (document.getElementById('langBtn') as HTMLElement).click(); });
  const adminMissing = await page.evaluate((args: { lits: string[]; prefix: Record<string, string> }) => {
    const bad: string[] = [];
    for (const L of args.lits) { const sample = args.prefix[L] || L; if (tr(sample) === sample) bad.push(L); }
    return bad;
  }, { lits: lits(src), prefix: PREFIX });
  await page.goto(AUTH);
  await page.evaluate(() => { if (!document.documentElement.lang.startsWith('zh')) (document.getElementById('langBtn') as HTMLElement).click(); });
  const companionMissing = await page.evaluate((ls: string[]) => ls.filter(L => tr(L) === L), lits(srcB));
  const a = { adminMissing, companionMissing, n: lits(src).length };
  const pass = adminMissing.length === 0 && companionMissing.length === 0 && a.n > 50;
  rec('i18n-dynamic', pass, a);
  expect(pass, 'i18n-dynamic: every dynamic literal translates under zh').toBe(true);
});

test('security-states', async ({ page }) => {
  // post-closure panel execution (rulings 6A/8B): security tab three-state loads + tplSave
  // validation + sessions-others fail-closed, all disclosed in the README simulation index.
  await page.goto(FILE);
  await page.evaluate(() => { (document.querySelector('[data-page=settings]') as HTMLElement).click(); });
  await page.locator('#settingsTabs button[data-tab=ssecurity]').click();
  await page.waitForTimeout(600);
  const secLoad = await page.evaluate(() => ({ sess: document.getElementById('sessLoadBanner')!.style.display, sessRows: document.querySelectorAll('#sessionRows tr').length, pk: document.getElementById('pkLoadBanner')!.style.display }));
  await page.locator('#sessLoadRetry').click();
  await page.locator('#pkLoadRetry').click();
  await page.waitForTimeout(600);
  const secOk = await page.evaluate(() => ({ sess: document.getElementById('sessLoadBanner')!.style.display, sessRows: document.querySelectorAll('#sessionRows tr').length, pkRows: document.querySelectorAll('#passkeyRows tr').length }));
  await page.locator('#settingsTabs button[data-tab=semail]').click();
  await page.waitForTimeout(600);
  const tplLoad = await page.evaluate(() => document.getElementById('tplLoadBanner')!.style.display);
  await page.locator('#tplLoadRetry').click();
  await page.waitForTimeout(600);
  const tplOk = await page.evaluate(() => ({ banner: document.getElementById('tplLoadBanner')!.style.display, rows: document.querySelectorAll('#templateRows tr').length }));
  await page.locator('#templateRows [data-tpledit]').first().click();
  await page.locator('#tplSubjectEn').fill('');
  await page.locator('#tplSave').click();
  const tplGuard = await page.evaluate(() => ({ toast: document.getElementById('protoToast')!.textContent, open: document.getElementById('tplDrawer')!.classList.contains('on') }));
  await page.keyboard.press('Escape');
  const sessBefore = await page.evaluate(() => document.querySelectorAll('#sessionRows tr').length);
  await page.locator('#settingsTabs button[data-tab=ssecurity]').click();
  await page.waitForTimeout(600);
  await page.locator('#revokeOthersBtn2').click();
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(300);
  const revFail = await page.evaluate(() => ({ toast: document.getElementById('protoToast')!.textContent, rows: document.querySelectorAll('#sessionRows tr').length }));
  await page.locator('#revokeOthersBtn2').click();
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(300);
  const revOk = await page.evaluate(() => document.querySelectorAll('#sessionRows tr').length);
  const sec = { secLoad, secOk, tplLoad, tplOk, tplGuard, revFail, revOk, sessBefore };
  const secPass = secLoad.sess === 'flex' && secLoad.sessRows === 0 && secLoad.pk === 'flex'
    && secOk.sess === 'none' && secOk.sessRows > 0 && secOk.pkRows > 0
    && tplLoad === 'flex' && tplOk.banner === 'none' && tplOk.rows > 0
    && tplGuard.toast.includes('required in both en and zh') && tplGuard.open
    && revFail.toast.includes('sessions kept') && revFail.rows === sessBefore && revOk < sessBefore;

  rec('security-states', secPass, sec);
  expect(secPass, 'security-states').toBe(true);
});

test('a11y-env', async ({ page }) => {
  // Verification-deepening batch (panel NOT-COVERED subset): reflow at ~200% zoom, narrow-viewport
  // modal/drawer fit + focus trap + background inert, forced-colors state visibility.
  await page.goto(FILE);
  await page.setViewportSize({ width: 640, height: 400 });
  const reflow: Record<string, boolean> = {};
  for (const pg of ['users', 'tenants', 'settings', 'audit', 'roles']) {
    await page.evaluate(k => document.querySelector('[data-page=' + k + ']')!.click(), pg);
    await page.waitForTimeout(150);
    reflow[pg] = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  }
  await page.evaluate(() => document.querySelector('[data-page=users]')!.click());
  await page.evaluate(() => document.querySelector('[data-create=users]')!.click());
  await page.waitForTimeout(150);
  const modal = await page.evaluate(() => { const r = document.querySelector('#formModal .modal')!.getBoundingClientRect(); return { fits: r.width <= window.innerWidth && r.left >= 0, inert: (document.querySelector('#app > .main') as HTMLElement).inert === true }; });
  const trap = await page.evaluate(async () => {
    const m = document.querySelector('#formModal .modal')!;
    const f = [...m.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(el => !(el as HTMLButtonElement).disabled && (el as HTMLElement).offsetParent !== null);
    (f[f.length - 1] as HTMLElement).focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 30));
    return m.contains(document.activeElement) && ev.defaultPrevented;
  });
  await page.keyboard.press('Escape');
  const inertOff = await page.evaluate(() => (document.querySelector('#app > .main') as HTMLElement).inert === false);
  await page.emulateMedia({ forcedColors: 'active' });
  await page.evaluate(() => document.querySelector('[data-page=groups]')!.click());
  await page.evaluate(() => (document.querySelector('#groupRows tr:first-child .row-actions button:nth-child(2)') as HTMLElement).click());
  await page.waitForTimeout(150);
  const ckForced = await page.evaluate(() => {
    const ck = document.querySelector('#formBody [data-field=isDepartment]') as HTMLInputElement;
    return getComputedStyle(ck).appearance === 'auto' && getComputedStyle(ck, '::after').content === 'none';
  });
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('[data-page=webhooks]')!.click());
  const swForced = await page.evaluate(() => {
    const sw = document.querySelector('#webhookRows .wswitch') as HTMLElement;
    const on = getComputedStyle(sw).backgroundColor; sw.classList.remove('on');
    const off = getComputedStyle(sw).backgroundColor; sw.classList.add('on');
    return on !== off;
  });
  await page.emulateMedia({ forcedColors: 'none' });
  const a = { reflow, modal, trap, inertOff, ckForced, swForced };
  const pass = Object.values(reflow).every(Boolean) && modal.fits && modal.inert && trap && inertOff && ckForced && swForced;
  rec('a11y-env', pass, a);
  expect(pass, 'a11y-env: reflow@200% + modal fit/trap/inert + forced-colors states').toBe(true);
});

test('shape-scale', async ({ page }) => {
  // Design backlog rulings 1-3 (A/A/A): icon tiers {12,14,16,28}, single pop radius, label-family
  // radius token (cupertino pill kept but intra-family consistent). Control geometry (knob/checkbox/
  // swatch/scrollbar) stays px by design.
  await page.goto(FILE);
  const res: Record<string, unknown> = {};
  let ok = true;
  for (const pack of ['ant', 'cupertino', 'fluent']) {
    await page.evaluate(p => { const s = document.getElementById('styleSelect') as HTMLSelectElement; s.value = p; s.onchange!(new Event('change')); }, pack);
    await page.evaluate(() => document.querySelector('[data-page=users]')!.click());
    await page.evaluate(() => document.querySelector('[data-create=users]')!.click());
    await page.waitForTimeout(150);
    const m = await page.evaluate(() => {
      const ics = [...document.querySelectorAll('.ic')].filter(e => (e as HTMLElement).getBoundingClientRect().width > 0).map(e => Math.round((e as HTMLElement).getBoundingClientRect().width));
      const pop = ['#floatTip', '#formModal .cbx-list', '#rowMenu', '#formModal .modal', '#protoToast'].map(sel => { const e = document.querySelector(sel); return e ? getComputedStyle(e).borderTopLeftRadius : null; }).filter(Boolean);
      const tag = ['.tag', '.cbx-chip', '.sys-tag'].map(sel => { const e = document.querySelector(sel); return e ? getComputedStyle(e).borderTopLeftRadius : null; }).filter(Boolean);
      return { ics: [...new Set(ics)], pop: [...new Set(pop)], tag: [...new Set(tag)] };
    });
    res[pack] = m;
    const tiers = [12, 14, 16, 28];
    if (!(m as any).ics.every((w: number) => tiers.includes(w))) ok = false;
    if ((m as any).pop.length !== 1) ok = false;
    if ((m as any).tag.length !== 1) ok = false;
    await page.keyboard.press('Escape');
  }
  // post-seal fix 12: icon-button families share one scale (row ghost 28/16 gap 8, bordered 32/16,
  // inline copy 20/14, pagination 32) and the sticky last cell follows row hover (no opaque patch).
  await page.evaluate(() => { const s = document.getElementById('styleSelect') as HTMLSelectElement; s.value = 'ant'; s.onchange!(new Event('change')); document.documentElement.dataset.theme = 'light'; (document.querySelector('[data-page=users]') as HTMLElement).click(); });
  await page.waitForTimeout(200);
  const ib = await page.evaluate(() => {
    const tr = document.querySelector('#userRows tr') as HTMLElement;
    const ra = tr.querySelector('.row-actions') as HTMLElement;
    const b = ra.querySelector('button') as HTMLElement;
    const ic = b.querySelector('.ic') as HTMLElement;
    const ibtn = document.querySelector('#page-users .icon-btn') as HTMLElement;
    const iic = ibtn.querySelector('.ic') as HTMLElement;
    const pg = document.querySelector('#page-users .pagination .pages button') as HTMLElement;
    return { rowW: b.getBoundingClientRect().width, rowH: b.getBoundingClientRect().height, rowIc: ic.getBoundingClientRect().width, gap: getComputedStyle(ra).gap, ibW: ibtn.getBoundingClientRect().width, ibIc: iic.getBoundingClientRect().width, pgW: pg.getBoundingClientRect().width, pgH: pg.getBoundingClientRect().height };
  });
  const cpIc = await page.evaluate(() => {
    (document.querySelector('[data-page=tenants]') as HTMLElement).click();
    const cp = document.querySelector('#tenantRows .copyable button .ic') as HTMLElement;
    return cp.getBoundingClientRect().width;
  });
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); });
  await page.waitForTimeout(150);
  await page.locator('#userRows tr:first-child').hover();
  await page.waitForTimeout(120);
  const hoverSync = await page.evaluate(() => {
    const tr = document.querySelector('#userRows tr') as HTMLElement;
    const last = tr.querySelector('td:last-child') as HTMLElement;
    return getComputedStyle(last).backgroundColor === getComputedStyle(tr).backgroundColor;
  });
  const ibOk = ib.rowW === 28 && ib.rowH === 28 && ib.rowIc === 16 && ib.gap === '8px' && ib.ibW === 32 && ib.ibIc === 16 && cpIc === 14 && ib.pgW === 32 && ib.pgH === 32 && hoverSync;
  const cup = (res.cupertino as any).tag[0];
  const ant = (res.ant as any).tag[0];
  const pass = ok && cup !== ant && parseFloat(cup) > 100 && ibOk;
  rec('shape-scale', pass, Object.assign({}, res, { ib, cpIc, hoverSync, ibOk }));
  expect(pass, 'shape-scale: icon tiers + single pop radius + label-family radius per pack').toBe(true);
});

test('narrow-nav', async ({ page }) => {
  // Post-seal fix 8: the <=760px breakpoint must apply the SAME icon-only semantics as manual
  // collapse (group labels hidden, trigger hidden) and icon-only nav keeps accessible names + tips.
  await page.goto(FILE);
  await page.setViewportSize({ width: 565, height: 800 });
  await page.waitForTimeout(250);
  const narrow = await page.evaluate(() => {
    const g = document.querySelector('.nav .group') as HTMLElement;
    const sb = document.querySelector('.sidebar') as HTMLElement;
    const a = document.querySelector('.nav a[data-page=users]') as HTMLElement;
    const nv = document.querySelector('.nav') as HTMLElement;
    return { groupVis: getComputedStyle(g).visibility, groupH: g.getBoundingClientRect().height, foot: getComputedStyle(document.querySelector('.side-foot')!).display, sbOver: sb.scrollWidth > sb.clientWidth, navOver: nv.scrollWidth > nv.clientWidth, navOx: getComputedStyle(nv).overflowX, aria: a.getAttribute('aria-label'), tip: a.getAttribute('data-tip'), docOver: document.documentElement.scrollWidth > window.innerWidth };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(250);
  const wide = await page.evaluate(() => {
    const a = document.querySelector('.nav a[data-page=users]') as HTMLElement;
    return { groupVis: getComputedStyle(document.querySelector('.nav .group')!).visibility, foot: getComputedStyle(document.querySelector('.side-foot')!).display, aria: a.getAttribute('aria-label'), tip: a.getAttribute('data-tip') };
  });
  await page.evaluate(() => (document.getElementById('collapseBtn') as HTMLElement).click());
  await page.waitForTimeout(150);
  const collapsed = await page.evaluate(() => {
    const a = document.querySelector('.nav a[data-page=users]') as HTMLElement;
    return { groupVis: getComputedStyle(document.querySelector('.nav .group')!).visibility, tip: a.getAttribute('data-tip'), lbl: (document.getElementById('collapseLbl') as HTMLElement).textContent };
  });
  const a = { narrow, wide, collapsed };
  const pass = narrow.groupVis === 'hidden' && narrow.groupH <= 6 && narrow.foot === 'none' && !narrow.sbOver && !narrow.navOver && narrow.navOx === 'hidden' && !narrow.docOver
    && !!narrow.aria && narrow.tip === narrow.aria
    && wide.groupVis === 'visible' && wide.foot !== 'none' && wide.aria === 'Users' && wide.tip === null
    && collapsed.groupVis === 'hidden' && collapsed.tip === 'Users' && collapsed.lbl === '';
  rec('narrow-nav', pass, a);
  expect(pass, 'narrow-nav: breakpoint collapse semantics + icon-only nav names/tips').toBe(true);
});

test('script-health', async ({ page }) => {
  // lesson-review upgrade (PIT-102): a top-level TDZ abort kills every later statement while
  // node --check stays green. Load both prototypes and require zero runtime errors plus the
  // presence of the handlers whose absence would mean a silent partial script.
  const errs: string[] = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(FILE);
  await page.waitForTimeout(500);
  const admin = await page.evaluate(() => ({
    fns: ['syncNavTips', 'syncInert', 'copyFeedback', 'tr', 'cbxOpen', 'openModal', 'closeModal'].every(n => typeof (window as any)[n] === 'function' || typeof eval(n) === 'function'),
    navNames: document.querySelectorAll('.nav a[aria-label]').length,
    rows: document.querySelectorAll('#userRows tr').length,
  }));
  const adminErrs = errs.slice();
  errs.length = 0;
  await page.goto(AUTH);
  await page.waitForTimeout(500);
  const auth = await page.evaluate(() => ({
    fns: ['tr', 'cbxOpen', 'enhanceSelect'].every(n => typeof eval(n) === 'function'),
    flows: document.querySelectorAll('[data-flow]').length,
  }));
  const a = { adminErrs, authErrs: errs.slice(), admin, auth };
  const pass = adminErrs.length === 0 && a.authErrs.length === 0 && admin.fns && admin.navNames >= 12 && admin.rows > 0 && auth.fns && auth.flows >= 9;
  rec('script-health', pass, a);
  expect(pass, 'script-health: zero runtime errors + handlers alive in both prototypes').toBe(true);
});

test('control-heights', async ({ page }) => {
  // post-seal fix 13: two-tier control height scale (--ctl-h 32 / --ctl-h-sm 24); every control
  // inside one container family shares one tier (toolbar/page-head/modal-foot/form = 32,
  // topbar/card-head/banner-retry = 24). Ragged padding-derived heights are gone.
  await page.goto(FILE);
  const heights = (sel: string) => page.evaluate((s) => {
    const els = [...document.querySelectorAll(s)] as HTMLElement[];
    return [...new Set(els.filter(e => e.getBoundingClientRect().height > 0).map(e => Math.round(e.getBoundingClientRect().height)))];
  }, sel);
  const res: Record<string, unknown> = {};
  let ok = true;
  for (const pg of ['users', 'events', 'audit', 'apikeys', 'tenants']) {
    await page.evaluate(k => (document.querySelector('[data-page=' + k + ']') as HTMLElement).click(), pg);
    await page.waitForTimeout(150);
    const h = await heights('#page-' + pg + ' .toolbar input, #page-' + pg + ' .toolbar select, #page-' + pg + ' .toolbar button, #page-' + pg + ' .toolbar .cbx-btn');
    res[pg + 'Toolbar'] = h;
    if (h.length !== 1 || h[0] !== 32) ok = false;
  }
  const top = await heights('.top-actions button, .top-actions select, .top-actions .avatar, .top-actions .cbx-btn');
  res.topbar = top;
  if (top.length !== 1 || top[0] !== 24) ok = false;
  await page.evaluate(() => (document.querySelector('[data-page=users]') as HTMLElement).click());
  await page.waitForTimeout(150);
  const ph = await heights('#page-users .page-head button');
  res.pageHead = ph;
  if (ph.length !== 1 || ph[0] !== 32) ok = false;
  await page.evaluate(() => (document.querySelector('[data-create=users]') as HTMLElement).click());
  await page.waitForTimeout(150);
  const foot = await heights('#formModal .modal-foot button');
  const form = await heights('#formBody input:not([type=checkbox]), #formBody select, #formBody .cbx-btn');
  res.modalFoot = foot; res.form = form;
  if (foot.length !== 1 || foot[0] !== 32 || form.length !== 1 || form[0] !== 32) ok = false;
  await page.keyboard.press('Escape');
  await page.evaluate(() => (document.querySelector('[data-page=dashboard]') as HTMLElement).click());
  await page.waitForTimeout(150);
  const ch = await heights('#page-dashboard .card-head button');
  res.cardHead = ch;
  if (ch.length !== 1 || ch[0] !== 32) ok = false;
  // post-seal fix 17: actions (banner/card-head/row unlink/bind/template) are default tier;
  // compact 24 remains only for topbar chrome and error-retry buttons.
  await page.evaluate(() => (document.querySelector('[data-page=profile]') as HTMLElement).click());
  await page.waitForTimeout(200);
  const prof = await heights('#sendVerifyBtn, #revokeOthersBtn2, #pwdSubmit, #bindGithub, #bindGoogle, #page-profile [data-unlink]');
  res.profileActions = prof;
  if (prof.length !== 1 || prof[0] !== 32) ok = false;
  const retries = await page.evaluate(() => [...new Set(['dashErrRetry', 'sessLoadRetry', 'pkLoadRetry', 'optLoadRetry', 'tplLoadRetry', 'delivRetry', 'confirmRetry', 'auditRetry'].map(id => getComputedStyle(document.getElementById(id)).height))]);
  res.retriesCompact = retries;
  if (retries.length !== 1 || retries[0] !== '24px') ok = false;
  await page.evaluate(() => (document.querySelector('[data-page=roles]') as HTMLElement).click());
  await page.waitForTimeout(150);
  await page.evaluate(() => { const b = document.querySelector('#roleRows [data-perms]') as HTMLElement; if (b) b.click(); });
  await page.waitForTimeout(250);
  const panel = await heights('.scope-box .cbx-btn, #mtxSave, #mtxCancel, #clearPermsBtn');
  res.panelEditing = panel;
  if (panel.length !== 1 || panel[0] !== 32) ok = false;
  // post-seal fix 15: fixed-height buttons must never wrap or shrink (page-head at mid width).
  await page.setViewportSize({ width: 830, height: 600 });
  await page.evaluate(() => (document.querySelector('[data-page=users]') as HTMLElement).click());
  await page.waitForTimeout(200);
  const phNarrow = await page.evaluate(() => {
    const bs = [...document.querySelectorAll('#page-users .page-head button')] as HTMLElement[];
    const vis = bs.filter(b => b.getBoundingClientRect().height > 0);
    return { heights: [...new Set(vis.map(b => Math.round(b.getBoundingClientRect().height)))], wrapped: vis.some(b => b.scrollHeight > b.clientHeight + 1), over: document.documentElement.scrollWidth > window.innerWidth };
  });
  res.pageHeadNarrow = phNarrow;
  if (phNarrow.heights.length !== 1 || phNarrow.heights[0] !== 32 || phNarrow.wrapped || phNarrow.over) ok = false;
  await page.setViewportSize({ width: 1280, height: 720 });
  rec('control-heights', ok, res);
  expect(ok, 'control-heights: one height tier per container family').toBe(true);
});

test('states', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 12 (A): loading skeleton via reload; unified EmptyState (clear-filters / create CTA);
  // error banner + retry on verify failure; toast variants w/ aria-live; full-page 403/404/error via hash.
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); });
  await page.locator('[data-reload=users]').click();
  const loading = await page.evaluate(() => ({ skel: document.querySelectorAll('#userRows .skel').length, rows: document.querySelectorAll('#userRows .u-nm').length }));
  await page.waitForTimeout(700);
  const loaded = await page.evaluate(() => document.querySelectorAll('#userRows .u-nm').length);
  await page.locator('#userSearch').fill('zzz-no-match');
  const emptyFiltered = await page.evaluate(() => ({ state: !!document.querySelector('#userRows .empty-state'), clear: !!document.querySelector('#userRows [data-empty-clear=users]') }));
  await page.locator('#userRows [data-empty-clear=users]').click();
  const cleared = await page.evaluate(() => document.querySelectorAll('#userRows .u-nm').length);
  await page.evaluate(() => { eval('OPTIONS.length=0'); eval('renderOptions()'); (document.querySelector('[data-page=settings]') as HTMLElement).click(); (document.querySelector('#settingsTabs button[data-tab=soptions]') as HTMLElement).click(); });
  await page.waitForTimeout(600); // adjudication 22: async options load, first attempt simulated failure
  await page.locator('#optLoadRetry').click();
  await page.waitForTimeout(600);
  const emptyTrue = await page.evaluate(() => ({ state: !!document.querySelector('#optionRows .empty-state'), cta: !!document.querySelector('#optionRows [data-create=options]') }));
  await page.evaluate(() => { (document.querySelector('[data-page=audit]') as HTMLElement).click(); });
  await page.locator('#verifyBtn').click();
  await page.waitForTimeout(700); // adjudication 18: verify Busy is async
  const errState = await page.evaluate(() => ({ banner: document.getElementById('auditErrBanner')!.style.display === 'flex', retry: !!document.getElementById('auditRetry'), toastRole: document.getElementById('protoToast')!.getAttribute('role'), toastCls: document.getElementById('protoToast')!.className }));
  await page.locator('#auditRetry').click();
  await page.waitForTimeout(700);
  const okState = await page.evaluate(() => ({ banner: document.getElementById('auditVerifyBanner')!.style.display === 'flex', errGone: document.getElementById('auditErrBanner')!.style.display === 'none', toastRole: document.getElementById('protoToast')!.getAttribute('role'), live: document.getElementById('protoToast')!.getAttribute('aria-live') }));
  await page.goto(FILE + '#/403');
  const s403 = await page.evaluate(() => ({ on: document.getElementById('state-403')!.classList.contains('on'), crumb: document.getElementById('crumbPage')!.textContent, pages: document.querySelectorAll('.page.on').length }));
  await page.locator('#state-403 [data-state-back]').click();
  await page.waitForTimeout(80); // hashchange is async
  const back403 = await page.evaluate(() => document.querySelectorAll('.state-page.on').length === 0 && document.querySelectorAll('.page.on').length === 1);
  await page.goto(FILE + '#/404');
  const s404 = await page.evaluate(() => document.getElementById('state-404')!.classList.contains('on'));
  await page.goto(FILE + '#/error');
  const sErr = await page.evaluate(() => document.getElementById('state-error')!.classList.contains('on'));
  await page.locator('#state-error [data-state-retry]').click();
  await page.waitForTimeout(80); // hashchange is async
  const retryBack = await page.evaluate(() => ({ dash: document.querySelectorAll('.state-page.on').length === 0 && document.querySelectorAll('.page.on').length === 1, toast: document.getElementById('protoToast')!.className }));
  const a = { loading, loaded, emptyFiltered, cleared, emptyTrue, errState, okState, s403, back403, s404, sErr, retryBack };
  const pass = loading.skel > 0 && loading.rows === 0 && loaded > 0
    && emptyFiltered.state && emptyFiltered.clear && cleared > 0
    && emptyTrue.state && emptyTrue.cta
    && errState.banner && errState.retry && errState.toastRole === 'alert' && errState.toastCls.includes('error')
    && okState.banner && okState.errGone && okState.toastRole === 'status' && okState.live === 'polite'
    && s403.on && s403.crumb === 'Forbidden' && s403.pages === 0 && back403 && s404 && sErr
    && retryBack.dash && retryBack.toast.includes('info');
  rec('states', pass, a);
  expect(pass, 'states').toBe(true);
});

test('confirm-uniform', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 13 (A): every destructive action is confirm-gated — group member remove, OAuth
  // unlink, log-out-other-devices. Cancel must not execute; confirm must.
  await page.evaluate(() => { (document.querySelector('[data-page=groups]') as HTMLElement).click(); (document.querySelector('#groupRows [data-manage]') as HTMLElement).click(); });
  await page.waitForTimeout(600); // adjudication 26: async detail load
  await page.locator('#grpDetailRetry').click();
  const m0 = await page.evaluate(() => document.querySelectorAll('#memberList li').length);
  await page.locator('#memberList [data-rm]').first().click();
  const mConf = await page.evaluate(() => ({ on: document.getElementById('confirmModal')!.classList.contains('on'), verb: document.getElementById('confirmDelete')!.textContent, msg: document.getElementById('confirmMsg')!.textContent!.includes('inherited') }));
  await page.locator('#confirmCancel').click();
  const m1 = await page.evaluate(() => document.querySelectorAll('#memberList li').length);
  await page.locator('#memberList [data-rm]').first().click();
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600); // adjudication 26: simulated remove failure, confirm acts as Retry
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600);
  const m2 = await page.evaluate(() => document.querySelectorAll('#memberList li').length);
  await page.evaluate(() => { (document.querySelector('[data-page=profile]') as HTMLElement).click(); });
  const o0 = await page.evaluate(() => document.querySelectorAll('#oauthList [data-unlink]').length);
  await page.locator('#oauthList [data-unlink]').first().click();
  const oConf = await page.evaluate(() => ({ on: document.getElementById('confirmModal')!.classList.contains('on'), verb: document.getElementById('confirmDelete')!.textContent, msg: document.getElementById('confirmMsg')!.textContent!.includes('linked again') }));
  await page.locator('#confirmCancel').click();
  const o1 = await page.evaluate(() => document.querySelectorAll('#oauthList [data-unlink]').length);
  await page.locator('#oauthList [data-unlink]').first().click();
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600); // adjudication 20: simulated unlink failure, confirm acts as Retry
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600);
  const o2 = await page.evaluate(() => document.querySelectorAll('#oauthList [data-unlink]').length);
  const s0 = await page.evaluate(() => document.querySelectorAll('#sessionRows tr').length);
  await page.locator('#revokeOthersBtn').click();
  const sConf = await page.evaluate(() => ({ on: document.getElementById('confirmModal')!.classList.contains('on'), verb: document.getElementById('confirmDelete')!.textContent, msg: document.getElementById('confirmMsg')!.textContent!.includes('fail-closed') }));
  await page.locator('#confirmCancel').click();
  const s1 = await page.evaluate(() => document.querySelectorAll('#sessionRows tr').length);
  await page.locator('#revokeOthersBtn').click();
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(300); // fail-closed first attempt keeps sessions (disclosed)
  const s2fail = await page.evaluate(() => document.querySelectorAll('#sessionRows tr').length);
  await page.locator('#revokeOthersBtn').click();
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(300);
  const s2 = await page.evaluate(() => document.querySelectorAll('#sessionRows tr').length);
  const a = { m0, mConf, m1, m2, o0, oConf, o1, o2, s0, sConf, s1, s2fail, s2 };
  const pass = mConf.on && mConf.verb === 'Remove' && mConf.msg && m1 === m0 && m2 === m0 - 1
    && oConf.on && oConf.verb === 'Unlink' && oConf.msg && o1 === o0 && o2 === o0 - 1
    && sConf.on && sConf.verb === 'Sign out' && sConf.msg && s1 === s0 && s2fail === s0 && s2 === 1;
  rec('confirm-uniform', pass, a);
  expect(pass, 'confirm-uniform').toBe(true);
});

test('clients-model', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 14 (A): clients immutable (no Edit); create carries grantTypes/tokenAuthMethod/
  // backchannelLogoutUri; CLIENT_002 non-empty redirectUris, CLIENT_003 https/localhost, scope
  // whitelist, B5 none+self-asserting grant refusal; valid M2M registers with one-time secret.
  await page.evaluate(() => { (document.querySelector('[data-page=clients]') as HTMLElement).click(); });
  const noEdit = await page.evaluate(() => !document.querySelector('#clientRows button[aria-label="Edit"]'));
  await page.locator('[data-create=clients]').click();
  const form = await page.evaluate(() => ({
    grants: document.querySelectorAll('#formBody [data-field=grantTypes] input[type=checkbox]').length,
    tam: (document.querySelector('#formBody [data-field=tokenAuthMethod]') as HTMLSelectElement).options.length,
    bc: !!document.querySelector('#formBody [data-field=backchannelLogoutUri]'),
  }));
  await page.locator('#formBody [data-field=name]').fill('E2E M2M');
  await page.locator('#formSave').click();
  const e002 = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('CLIENT_002'));
  await page.locator('#formBody [data-field=redirectUris]').fill('http://evil.example/cb');
  await page.locator('#formSave').click();
  const e003 = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('CLIENT_003'));
  await page.locator('#formBody [data-field=redirectUris]').fill('https://svc.e2e.io/cb');
  await page.locator('#formBody [data-field=grantTypes] input[value=client_credentials]').check();
  await page.locator('#formBody [data-field=scope]').fill('openid'); // adjudication 28: scope required precedes B5
  await page.evaluate(() => { (document.querySelector('#formBody [data-field=tokenAuthMethod]') as HTMLSelectElement).value = 'none'; });
  await page.locator('#formSave').click();
  const eB5 = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('B5'));
  await page.evaluate(() => { (document.querySelector('#formBody [data-field=tokenAuthMethod]') as HTMLSelectElement).value = 'client_secret_basic'; });
  await page.locator('#formBody [data-field=scope]').fill('foo');
  await page.locator('#formSave').click();
  const eScope = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('offline_access'));
  await page.locator('#formBody [data-field=scope]').fill('');
  await page.locator('#formSave').click();
  const eScopeReq = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('scope is required')); // adjudication 28: no silent default
  await page.locator('#formBody [data-field=scope]').fill('openid');
  const rows0 = await page.evaluate(() => document.querySelectorAll('#clientRows tr').length);
  await page.locator('#formSave').click();
  const createBusy = await page.evaluate(() => (document.getElementById('formSave') as HTMLButtonElement).disabled);
  await page.waitForTimeout(600); // adjudication 28: simulated createError keeps the form
  const createErr = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('Create failed'));
  await page.locator('#formSave').click();
  await page.waitForTimeout(600);
  const created = await page.evaluate(() => ({ reveal: document.getElementById('revealModal')!.classList.contains('on'), rows: document.querySelectorAll('#clientRows tr').length }));
  await page.keyboard.press('Escape');
  // rotate: Busy + simulated rotateError then reveal-once
  await page.locator('#clientRows [data-rotate-client]').first().click();
  await page.waitForTimeout(600);
  const rotErr = await page.evaluate(() => document.getElementById('protoToast')!.textContent!.includes('Rotate failed'));
  await page.locator('#clientRows [data-rotate-client]').first().click();
  await page.waitForTimeout(600);
  const rotOk = await page.evaluate(() => document.getElementById('revealModal')!.classList.contains('on'));
  await page.keyboard.press('Escape');
  // delete: confirm run hook, simulated deleteError keeps the row, retry deletes
  await page.locator('#clientRows button[aria-label="Delete"]').first().click();
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600);
  const delFail = await page.evaluate(() => ({ err: document.getElementById('confirmErr')!.style.display === 'flex', rows: document.querySelectorAll('#clientRows tr').length }));
  await page.locator('#confirmDelete').click();
  await page.waitForTimeout(600);
  const delOk = await page.evaluate(() => document.querySelectorAll('#clientRows tr').length);
  const a = { noEdit, form, e002, e003, eB5, eScope, eScopeReq, rows0, createBusy, createErr, created, rotErr, rotOk, delFail, delOk };
  const pass = noEdit && form.grants === 2 && form.tam === 3 && form.bc
    && e002 && e003 && eB5 && eScope && eScopeReq && createBusy && createErr
    && created.reveal && created.rows === rows0 + 1
    && rotErr && rotOk && delFail.err && delFail.rows === created.rows && delOk === created.rows - 1;
  rec('clients-model', pass, a);
  expect(pass, 'clients-model').toBe(true);
});

test('cbx-capabilities', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 15 (A): cbx parity with AntD Select — allowClear, typeahead + Home/End +
  // aria-activedescendant, multiple (chips + aria-multiselectable + chip remove), loading state.
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); });
  await page.evaluate(() => { const s = document.getElementById('statusFilter') as HTMLSelectElement; s.value = 'active'; s.dispatchEvent(new Event('input')); });
  const clearVis = await page.evaluate(() => getComputedStyle(document.getElementById('statusFilter')!._cbx.querySelector('.cbx-clear')).display !== 'none');
  await page.evaluate(() => { (document.getElementById('statusFilter') as any)._cbx.querySelector('.cbx-clear').click(); });
  const cleared = await page.evaluate(() => ({ v: (document.getElementById('statusFilter') as HTMLSelectElement).value, rows: document.querySelectorAll('#userRows .u-nm').length }));
  // typeahead + activedescendant + Home/End on the style combobox
  await page.evaluate(() => { (document.getElementById('styleSelect') as any)._cbx.querySelector('.cbx-btn').focus(); });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('c');
  const typeahead = await page.evaluate(() => {
    const w = (document.getElementById('styleSelect') as any)._cbx;
    const act = w.querySelector('.cbx-opt.active');
    return { ch: act ? act.textContent.trim()[0].toLowerCase() : null, aria: w.querySelector('.cbx-btn').getAttribute('aria-activedescendant') === (act ? act.id : null) };
  });
  await page.keyboard.press('End');
  const endActive = await page.evaluate(() => { const w = (document.getElementById('styleSelect') as any)._cbx; const o = [...w.querySelectorAll('.cbx-opt')]; return o[o.length - 1].classList.contains('active'); });
  await page.keyboard.press('Home');
  const homeActive = await page.evaluate(() => { const w = (document.getElementById('styleSelect') as any)._cbx; return w.querySelector('.cbx-opt').classList.contains('active'); });
  await page.keyboard.press('Escape');
  // multiple + loading on users edit roles
  await page.locator('#userRows button[aria-label="Edit"]').first().click();
  const load0 = await page.evaluate(() => (document.querySelector('#formBody [data-field=roles]') as any)._cbx.classList.contains('cbx-loading'));
  await page.waitForTimeout(600);
  const load1 = await page.evaluate(() => (document.querySelector('#formBody [data-field=roles]') as any)._cbx.classList.contains('cbx-loading'));
  const multi = await page.evaluate(() => {
    const sel = document.querySelector('#formBody [data-field=roles]') as HTMLSelectElement;
    const w = sel._cbx;
    w.querySelector('.cbx-btn').click();
    const listMulti = w.querySelector('.cbx-list').getAttribute('aria-multiselectable');
    w.querySelector('.cbx-clear').click(); // start from empty so toggles are additive
    const opts = [...w.querySelectorAll('.cbx-opt')];
    opts[0].click(); opts[1].click();
    const chips = w.querySelectorAll('.cbx-chip').length;
    const open = w.classList.contains('open');
    w.querySelector('.cbx-chip [data-cbxrm]').click();
    const chipsAfterRm = w.querySelectorAll('.cbx-chip').length;
    w.querySelector('.cbx-clear').click();
    const chipsAfterClear = w.querySelectorAll('.cbx-chip').length;
    return { listMulti, chips, open, chipsAfterRm, chipsAfterClear, selCount: sel.selectedOptions.length };
  });
  await page.locator('#formSave').click();
  const savedRoles = await page.evaluate(() => eval('USERS')[0][5].length);
  const a = { clearVis, cleared, typeahead, endActive, homeActive, load0, load1, multi, savedRoles };
  const pass = clearVis && cleared.v === '' && cleared.rows > 0
    && typeahead.ch === 'c' && typeahead.aria && endActive && homeActive
    && load0 && !load1
    && multi.listMulti === 'true' && multi.chips === 2 && multi.open && multi.chipsAfterRm === 1 && multi.chipsAfterClear === 0 && multi.selCount === 0
    && savedRoles === 0;
  rec('cbx-capabilities', pass, a);
  expect(pass, 'cbx-capabilities').toBe(true);
});

test('cbx-option-list', async ({ page }) => {
  await page.goto(FILE);
  // Post-closure fix 2: form-built selects are themed comboboxes (were native size=4 listboxes);
  // option rows carry AntD-like 32px metrics, tinted selected state with a reserved check column
  // (no layout shift), and the list is fixed-positioned so modal/toolbar clipping cannot cut it.
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); (document.querySelector('[data-create=users]') as HTMLElement).click(); });
  const themed = await page.evaluate(() => {
    const sel = document.querySelector('#formBody select[data-field=roles]') as HTMLSelectElement;
    return { hidden: getComputedStyle(sel).display === 'none', wrapped: !!sel._cbx, multi: sel.multiple };
  });
  await page.evaluate(() => { (document.querySelector('#formBody select[data-field=roles]')._cbx.querySelector('.cbx-btn') as HTMLElement).click(); });
  const metrics = await page.evaluate(() => {
    const opt = document.querySelector('#formBody .cbx-opt') as HTMLElement;
    const list = document.querySelector('#formBody .cbx-list') as HTMLElement;
    const cs = getComputedStyle(opt);
    const r = list.getBoundingClientRect();
    const or = opt.getBoundingClientRect();
    const topEl = document.elementFromPoint(or.left + or.width / 2, or.top + or.height / 2);
    return { minH: cs.minHeight, pad: cs.padding, lh: cs.lineHeight, pos: getComputedStyle(list).position,
      inVp: r.top >= 0 && r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      onTop: topEl === opt || opt.contains(topEl!), w: opt.offsetWidth };
  });
  await page.evaluate(() => { (document.querySelectorAll('#formBody .cbx-opt')[1] as HTMLElement).click(); });
  const selected = await page.evaluate(() => {
    const opt = document.querySelectorAll('#formBody .cbx-opt')[1] as HTMLElement;
    const cs = getComputedStyle(opt);
    return { aria: opt.getAttribute('aria-selected'), bg: cs.backgroundColor, tinted: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent', w: opt.offsetWidth, check: getComputedStyle(opt, '::after').color };
  });
  const noShift = selected.w === metrics.w;
  await page.keyboard.press('Escape');
  // single-select form control themed too (clients auth method)
  await page.evaluate(() => { (document.querySelector('[data-page=clients]') as HTMLElement).click(); (document.querySelector('[data-create=clients]') as HTMLElement).click(); });
  const single = await page.evaluate(() => {
    const sel = document.querySelector('#formBody select[data-field=tokenAuthMethod]') as HTMLSelectElement;
    return { hidden: getComputedStyle(sel).display === 'none', wrapped: !!sel._cbx };
  });
  await page.keyboard.press('Escape');
  // flip-up near viewport bottom + clamp inside viewport
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); (document.querySelector('[data-create=users]') as HTMLElement).click(); (document.querySelector('#formBody select[data-field=roles]')._cbx.querySelector('.cbx-btn') as HTMLElement).click(); });
  const flip = await page.evaluate(() => {
    const list = document.querySelector('#formBody .cbx-list') as HTMLElement;
    const btn = document.querySelector('#formBody select[data-field=roles]')._cbx.querySelector('.cbx-btn') as HTMLElement;
    const r = list.getBoundingClientRect(), br = btn.getBoundingClientRect();
    return { above: r.bottom <= br.top + 1, inVp: r.top >= 0 && r.bottom <= window.innerHeight };
  });
  // companion selects themed with same metrics
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(AUTH);
  const comp = await page.evaluate(() => {
    const sel = document.getElementById('mkState') as HTMLSelectElement;
    (sel._cbx.querySelector('.cbx-btn') as HTMLElement).click();
    const opt = document.querySelector('#flow-magic .cbx-opt') as HTMLElement;
    const cs = getComputedStyle(opt);
    return { wrapped: !!sel._cbx, minH: cs.minHeight, pad: cs.padding };
  });
  // post-closure fix 3: the allowClear cross lives INSIDE the control (was a sibling after the
  // full-width button, wrapping onto a blank line below); hidden when empty/disabled; clicking it
  // clears without opening the list; same geometry in toolbar filters and companion.
  await page.goto(FILE);
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); (document.querySelector('[data-create=users]') as HTMLElement).click(); });
  await page.evaluate(() => { const sel = document.querySelector('#formBody select[data-field=roles]') as HTMLSelectElement; sel.options[1].selected = true; sel.options[2].selected = true; sel.dispatchEvent(new Event('change', { bubbles: true })); });
  const clearGeom = await page.evaluate(() => {
    const sel = document.querySelector('#formBody select[data-field=roles]') as HTMLSelectElement;
    const w = sel._cbx; const btn = w.querySelector('.cbx-btn'); const cl = w.querySelector('.cbx-clear');
    const br = btn.getBoundingClientRect(), cr = cl.getBoundingClientRect();
    return { sibling: !btn.contains(cl) && w.contains(cl), abs: getComputedStyle(cl).position === 'absolute', shown: getComputedStyle(cl).display !== 'none',
      inBtn: cr.top >= br.top - 1 && cr.bottom <= br.bottom + 1 && cr.right <= br.right + 1,
      wrapH: w.getBoundingClientRect().height <= br.height + 2 };
  });
  await page.evaluate(() => { (document.querySelector('#formBody select[data-field=roles]')._cbx.querySelector('.cbx-clear') as HTMLElement).click(); });
  const clearAct = await page.evaluate(() => {
    const sel = document.querySelector('#formBody select[data-field=roles]') as HTMLSelectElement;
    const w = sel._cbx;
    return { n: sel.selectedOptions.length, open: w.classList.contains('open'), hidden: getComputedStyle(w.querySelector('.cbx-clear')).display === 'none' };
  });
  await page.evaluate(() => { const sel = document.querySelector('#formBody select[data-field=roles]') as HTMLSelectElement; sel.options[1].selected = true; sel.dispatchEvent(new Event('change', { bubbles: true })); sel.disabled = true; });
  const clearDisabled = await page.evaluate(() => {
    const sel = document.querySelector('#formBody select[data-field=roles]') as HTMLSelectElement;
    const cl = sel._cbx.querySelector('.cbx-clear') as HTMLElement;
    const before = sel.selectedOptions.length; cl.click();
    return { hidden: getComputedStyle(cl).display === 'none', unchanged: sel.selectedOptions.length === before };
  });
  await page.evaluate(() => { const sel = document.querySelector('#formBody select[data-field=roles]') as HTMLSelectElement; sel.disabled = false; });
  await page.keyboard.press('Escape');
  const toolbarClear = await page.evaluate(() => {
    (document.querySelector('[data-page=users]') as HTMLElement).click();
    const f = document.getElementById('tenantFilter') as HTMLSelectElement;
    f.value = 'Acme Corp'; f.dispatchEvent(new Event('change', { bubbles: true }));
    const w = f._cbx; const btn = w.querySelector('.cbx-btn'); const cl = w.querySelector('.cbx-clear');
    const br = btn.getBoundingClientRect(), cr = cl.getBoundingClientRect();
    const ok = !btn.contains(cl) && getComputedStyle(cl).position === 'absolute' && cr.top >= br.top - 1 && cr.bottom <= br.bottom + 1 && cr.right <= br.right + 1;
    f.value = ''; f.dispatchEvent(new Event('change', { bubbles: true }));
    return ok;
  });
  await page.goto(AUTH);
  const compClear = await page.evaluate(() => {
    const sel = document.getElementById('mkState') as HTMLSelectElement;
    const btn = sel._cbx.querySelector('.cbx-btn'); const cl = sel._cbx.querySelector('.cbx-clear');
    return !btn.contains(cl) && getComputedStyle(cl).position === 'absolute';
  });
  const a = { themed, metrics, selected, noShift, single, flip, comp, clearGeom, clearAct, clearDisabled, toolbarClear, compClear };
  const pass = themed.hidden && themed.wrapped && themed.multi
    && metrics.minH === '32px' && metrics.pad === '5px 12px' && metrics.lh === '22px' && metrics.pos === 'fixed' && metrics.inVp && metrics.onTop
    && selected.aria === 'true' && selected.tinted && noShift && selected.check !== 'rgba(0, 0, 0, 0)'
    && single.hidden && single.wrapped && flip.above && flip.inVp
    && comp.wrapped && comp.minH === '32px' && comp.pad === '5px 12px'
    && clearGeom.sibling && clearGeom.abs && clearGeom.shown && clearGeom.inBtn && clearGeom.wrapH
    && clearAct.n === 0 && !clearAct.open && clearAct.hidden
    && clearDisabled.hidden && clearDisabled.unchanged && toolbarClear && compClear;
  rec('cbx-option-list', pass, a);
  expect(pass, 'cbx-option-list').toBe(true);
});

test('modal-a11y', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 16 (A): initial focus into dialog, Tab/Shift+Tab trap, focus return on close,
  // aria-labelledby wired to the head title (AntD Modal / rc-dialog parity).
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); });
  await page.locator('#userRows button[aria-label="Edit"]').first().click();
  await page.waitForTimeout(60);
  const init = await page.evaluate(() => ({
    inside: document.querySelector('#formModal .modal')!.contains(document.activeElement),
    labelledby: document.querySelector('#formModal .modal')!.getAttribute('aria-labelledby'),
  }));
  const trap = await page.evaluate(() => {
    const m = document.querySelector('#formModal .modal') as HTMLElement;
    const f = (window as any).modalFocusables(m) as HTMLElement[];
    f[f.length - 1].focus();
    return { n: f.length, lastFocused: document.activeElement === f[f.length - 1] };
  });
  await page.keyboard.press('Tab');
  const wrapFwd = await page.evaluate(() => {
    const m = document.querySelector('#formModal .modal') as HTMLElement;
    const f = (window as any).modalFocusables(m) as HTMLElement[];
    return document.activeElement === f[0];
  });
  await page.keyboard.press('Shift+Tab');
  const wrapBack = await page.evaluate(() => {
    const m = document.querySelector('#formModal .modal') as HTMLElement;
    const f = (window as any).modalFocusables(m) as HTMLElement[];
    return document.activeElement === f[f.length - 1];
  });
  await page.keyboard.press('Escape');
  const retEdit = await page.evaluate(() => ({
    off: !document.getElementById('formModal')!.classList.contains('on'),
    back: document.activeElement!.getAttribute('aria-label') === 'Edit' && !!document.activeElement!.closest('#userRows'),
  }));
  await page.locator('#userRows button[aria-label="View"]').first().click();
  await page.waitForTimeout(60);
  const detail = await page.evaluate(() => ({
    inside: document.querySelector('#detailModal .modal')!.contains(document.activeElement),
    labelledby: document.querySelector('#detailModal .modal')!.getAttribute('aria-labelledby'),
  }));
  await page.mouse.click(5, 5); // overlay click closes
  const retView = await page.evaluate(() => ({
    off: !document.getElementById('detailModal')!.classList.contains('on'),
    back: document.activeElement!.getAttribute('aria-label') === 'View' && !!document.activeElement!.closest('#userRows'),
  }));
  const a = { init, trap, wrapFwd, wrapBack, retEdit, detail, retView };
  const pass = init.inside && init.labelledby === 'formTitle'
    && trap.n > 2 && trap.lastFocused && wrapFwd && wrapBack
    && retEdit.off && retEdit.back
    && detail.inside && detail.labelledby === 'detailTitle'
    && retView.off && retView.back;
  rec('modal-a11y', pass, a);
  expect(pass, 'modal-a11y').toBe(true);
});

test('tabs-a11y', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 17 (A): WAI-ARIA tabs pattern (tablist/tab/aria-selected/aria-controls + tabpanel
  // labelledby + Left/Right/Home/End roving focus, AntD Tabs parity) and keyboard-selectable Roles rows.
  await page.evaluate(() => { (document.querySelector('[data-page=settings]') as HTMLElement).click(); });
  const sem = await page.evaluate(() => ({
    list: document.getElementById('settingsTabs')!.getAttribute('role'),
    tabs: document.querySelectorAll('#settingsTabs [role=tab]').length,
    sel: document.getElementById('tab-sgeneral')!.getAttribute('aria-selected'),
    roving: [...document.querySelectorAll('#settingsTabs [role=tab]')].map(b => b.tabIndex),
    pane: document.getElementById('pane-sgeneral')!.getAttribute('role'),
    labelled: document.getElementById('pane-sgeneral')!.getAttribute('aria-labelledby'),
  }));
  await page.locator('#tab-sgeneral').focus();
  await page.keyboard.press('ArrowRight');
  const right = await page.evaluate(() => ({ sel: document.getElementById('tab-ssecurity')!.getAttribute('aria-selected'), focused: document.activeElement!.id, paneOn: document.getElementById('pane-ssecurity')!.classList.contains('on') }));
  await page.keyboard.press('End');
  const end = await page.evaluate(() => ({ sel: document.getElementById('tab-semail')!.getAttribute('aria-selected'), focused: document.activeElement!.id }));
  await page.keyboard.press('Home');
  const home = await page.evaluate(() => ({ sel: document.getElementById('tab-sgeneral')!.getAttribute('aria-selected'), focused: document.activeElement!.id }));
  await page.keyboard.press('ArrowLeft');
  const leftWrap = await page.evaluate(() => document.activeElement!.id);
  // groups tablist
  await page.evaluate(() => { (document.querySelector('[data-page=groups]') as HTMLElement).click(); (document.querySelector('#groupRows [data-manage]') as HTMLElement).click(); });
  await page.locator('#tab-members').focus();
  await page.keyboard.press('ArrowRight');
  const gRight = await page.evaluate(() => ({ sel: document.getElementById('tab-roles')!.getAttribute('aria-selected'), paneOn: document.getElementById('pane-roles')!.classList.contains('on'), labelled: document.getElementById('pane-roles')!.getAttribute('aria-labelledby') }));
  // roles rows keyboard path
  await page.evaluate(() => { (document.querySelector('[data-page=roles]') as HTMLElement).click(); });
  const rowSem = await page.evaluate(() => ({ tab: document.querySelector('#roleRows tr')!.getAttribute('tabindex'), aria: document.querySelector('#roleRows tr')!.getAttribute('aria-selected') }));
  await page.evaluate(() => { (document.querySelectorAll('#roleRows tr')[2] as HTMLElement).focus(); });
  await page.keyboard.press('Enter');
  const enterSel = await page.evaluate(() => ({ sel: eval('selRole'), aria: document.querySelectorAll('#roleRows tr')[2].getAttribute('aria-selected'), focused: document.activeElement!.getAttribute('data-role') }));
  await page.evaluate(() => { (document.querySelectorAll('#roleRows tr')[1] as HTMLElement).focus(); });
  await page.keyboard.press(' ');
  const spaceSel = await page.evaluate(() => ({ sel: eval('selRole'), aria: document.querySelectorAll('#roleRows tr')[1].getAttribute('aria-selected') }));
  const a = { sem, right, end, home, leftWrap, gRight, rowSem, enterSel, spaceSel };
  const pass = sem.list === 'tablist' && sem.tabs === 4 && sem.sel === 'true'
    && JSON.stringify(sem.roving) === JSON.stringify([0, -1, -1, -1])
    && sem.pane === 'tabpanel' && sem.labelled === 'tab-sgeneral'
    && right.sel === 'true' && right.focused === 'tab-ssecurity' && right.paneOn
    && end.sel === 'true' && end.focused === 'tab-semail'
    && home.sel === 'true' && home.focused === 'tab-sgeneral' && leftWrap === 'tab-semail'
    && gRight.sel === 'true' && gRight.paneOn && gRight.labelled === 'tab-roles'
    && rowSem.tab === '0' && rowSem.aria === 'true'
    && enterSel.sel === 2 && enterSel.aria === 'true' && enterSel.focused === '2'
    && spaceSel.sel === 1 && spaceSel.aria === 'true';
  rec('tabs-a11y', pass, a);
  expect(pass, 'tabs-a11y').toBe(true);
});

test('audit-model', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 18 (A): structured verify report (rowsChecked/anchorsChecked or firstFailure
  // {kind,day,seq}), Busy states, load/export/verify error alerts, date-range filter, filter-respecting
  // full export, numeric status or '-'.
  await page.evaluate(() => { (document.querySelector('[data-page=audit]') as HTMLElement).click(); });
  const status = await page.evaluate(() => {
    const txt = document.getElementById('auditRows')!.textContent!;
    return { num: txt.includes('204') && txt.includes('401'), dash: txt.includes('-'), noVocab: !txt.includes('success') };
  });
  await page.evaluate(() => { const f = document.getElementById('auditFrom') as HTMLInputElement; f.value = '2026-11-18'; f.dispatchEvent(new Event('input')); });
  const fromRows = await page.evaluate(() => document.querySelectorAll('#auditRows tr').length);
  await page.evaluate(() => { const f = document.getElementById('auditFrom') as HTMLInputElement; f.value = '2026-11-17'; f.dispatchEvent(new Event('input')); const t = document.getElementById('auditTo') as HTMLInputElement; t.value = '2026-11-17'; t.dispatchEvent(new Event('input')); });
  const dayRows = await page.evaluate(() => document.querySelectorAll('#auditRows tr').length);
  await page.evaluate(() => { ['auditFrom', 'auditTo'].forEach(id => { const f = document.getElementById(id) as HTMLInputElement; f.value = ''; f.dispatchEvent(new Event('input')); }); });
  await page.locator('#verifyBtn').click();
  const busy = await page.evaluate(() => (document.getElementById('verifyBtn') as HTMLButtonElement).disabled);
  await page.waitForTimeout(700);
  const failRep = await page.evaluate(() => {
    const m = document.getElementById('auditErrMsg')!.textContent!;
    return { kind: m.includes('anchor_mismatch'), day: m.includes('2026-11-17'), seq: m.includes('seq 4'), banner: document.getElementById('auditErrBanner')!.style.display === 'flex' };
  });
  await page.locator('#auditRetry').click();
  await page.waitForTimeout(700);
  const okRep = await page.evaluate(() => ({ meta: document.getElementById('verifyMeta')!.textContent!, banner: document.getElementById('auditVerifyBanner')!.style.display === 'flex' }));
  // export respects filters: DELETE -> 1 matching row; first attempt errors, retry downloads
  await page.evaluate(() => { const f = document.getElementById('auditActionFilter') as HTMLSelectElement; f.value = 'DELETE'; f.dispatchEvent(new Event('input')); });
  await page.locator('#exportBtn').click();
  await page.waitForTimeout(600);
  const expErr = await page.evaluate(() => document.getElementById('auditExportBanner')!.style.display === 'flex');
  const dl = page.waitForEvent('download');
  await page.locator('#auditExportRetry').click();
  const download = await dl;
  const csv = fs.readFileSync(await download.path(), 'utf8');
  const expRows = csv.trim().split('\n').length;
  // load failure on first audit reload, retry restores
  await page.evaluate(() => { const f = document.getElementById('auditActionFilter') as HTMLSelectElement; f.value = ''; f.dispatchEvent(new Event('input')); });
  await page.locator('[data-reload=audit]').click();
  await page.waitForTimeout(700);
  const loadErr = await page.evaluate(() => ({ banner: document.getElementById('auditLoadBanner')!.style.display === 'flex', rows: document.querySelectorAll('#auditRows tr').length }));
  await page.locator('#auditLoadRetry').click();
  const loadOk = await page.evaluate(() => ({ banner: document.getElementById('auditLoadBanner')!.style.display === 'none', rows: document.querySelectorAll('#auditRows tr').length }));
  const a = { status, fromRows, dayRows, busy, failRep, okRep, expErr, expRows, file: download.suggestedFilename(), loadErr, loadOk };
  const pass = status.num && status.dash && status.noVocab && fromRows === 5 && dayRows === 2
    && busy && failRep.kind && failRep.day && failRep.seq && failRep.banner
    && okRep.banner && okRep.meta.includes('rowsChecked: 7') && okRep.meta.includes('anchorsChecked: 2')
    && expErr && expRows === 2 && download.suggestedFilename() === 'audit.csv'
    && loadErr.banner && loadErr.rows === 0 && loadOk.banner && loadOk.rows === 7;
  rec('audit-model', pass, a);
  expect(pass, 'audit-model').toBe(true);
});

test('dashboard-model', async ({ page }) => {
  await page.goto(FILE);
  // Adjudication 19 (A): 4 live Statistics (users/roles/sessions/audits, no deltas), no trend chart,
  // activity = action+resourceType Tags + userId·relTime, refresh on activity head w/ error Alert +
  // Spin-like loading, quick actions wired (create user opens the real-shaped create form).
  const base = await page.evaluate(() => ({
    stats: ['statUsers', 'statRoles', 'statSessions', 'statAudits'].map(id => document.getElementById(id)!.textContent),
    live: [eval('USERS.length'), eval('ROLES.length'), eval('SESSIONS.length'), eval('AUDIT.length')].map(n => n.toLocaleString()),
    noDelta: !document.querySelector('#page-dashboard .delta'),
    noTrend: !document.querySelector('#trend'),
    actTags: document.querySelectorAll('#activity li .t .tag').length,
    actDesc: document.querySelector('#activity li .m')!.textContent!.includes('·'),
    refreshInHead: !!document.querySelector('#page-dashboard .card-head #dashRefresh'),
    inert: document.querySelectorAll('#page-dashboard .proto-inert').length,
  }));
  await page.locator('#dashRefresh').click();
  const spin = await page.evaluate(() => document.querySelectorAll('#activity .skel').length);
  await page.waitForTimeout(700);
  const err = await page.evaluate(() => document.getElementById('dashErrBanner')!.style.display === 'flex');
  await page.locator('#dashErrRetry').click();
  await page.waitForTimeout(700);
  const ok = await page.evaluate(() => ({ banner: document.getElementById('dashErrBanner')!.style.display === 'none', items: document.querySelectorAll('#activity li').length }));
  await page.locator('#qaManageRoles').click();
  const navRoles = await page.evaluate(() => document.getElementById('page-roles')!.classList.contains('on'));
  await page.evaluate(() => { (document.querySelector('[data-page=dashboard]') as HTMLElement).click(); });
  await page.locator('#qaCreateUser').click();
  const form = await page.evaluate(() => ({
    on: document.getElementById('formModal')!.classList.contains('on'),
    usersPage: document.getElementById('page-users')!.classList.contains('on'),
    fields: [...document.querySelectorAll('#formBody [data-field]')].map(el => el.getAttribute('data-field')),
    activeChecked: (document.querySelector('#formBody [data-field=isActive]') as HTMLInputElement).checked,
    pwdType: (document.querySelector('#formBody [data-field=password]') as HTMLInputElement).type,
  }));
  await page.locator('#formBody [data-field=name]').fill('E2E User');
  await page.locator('#formBody [data-field=email]').fill('jane.doe@globex.com');
  await page.locator('#formBody [data-field=password]').fill('Str0ng!Pass12');
  await page.locator('#formSave').click();
  const dup = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('EMAIL_EXISTS'));
  await page.locator('#formBody [data-field=email]').fill('e2e.user@acme.io');
  await page.locator('#formBody [data-field=password]').fill('weak');
  await page.locator('#formSave').click();
  const policy = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('12+'));
  await page.locator('#formBody [data-field=password]').fill('Str0ng!Pass12');
  const users0 = await page.evaluate(() => eval('USERS.length'));
  await page.locator('#formSave').click();
  const created = await page.evaluate(() => ({
    users: eval('USERS.length'),
    stat: document.getElementById('statUsers')!.textContent,
    actFirst: document.querySelector('#activity li .t .tag')!.textContent,
    closed: !document.getElementById('formModal')!.classList.contains('on'),
  }));
  await page.evaluate(() => { (document.querySelector('[data-page=dashboard]') as HTMLElement).click(); });
  await page.locator('#viewAllBtn').click();
  const navAudit = await page.evaluate(() => document.getElementById('page-audit')!.classList.contains('on'));
  const a = { base, spin, err, ok, navRoles, form, dup, policy, users0, created, navAudit };
  const pass = JSON.stringify(base.stats) === JSON.stringify(base.live) && base.noDelta && base.noTrend
    && base.actTags === 10 && base.actDesc && base.refreshInHead && base.inert === 0
    && spin === 8 && err && ok.banner && ok.items === 5 && navRoles
    && form.on && form.usersPage && JSON.stringify(form.fields) === JSON.stringify(['name', 'email', 'password', 'isActive', 'roles']) && form.pwdType === 'password' && form.activeChecked
    && dup && policy && created.users === users0 + 1 && created.stat === (users0 + 1).toLocaleString()
    && created.actFirst === 'user.created' && created.closed && navAudit;
  rec('dashboard-model', pass, a);
  expect(pass, 'dashboard-model').toBe(true);
});
test('boolean-controls', async ({ page }) => {
  await page.goto(FILE);
  // Boolean-control rule (post-closure unification; mirrors real Groups.tsx / UserCreate.tsx):
  // Switch (.wswitch button) = immediate-effect binary toggles ONLY; Checkbox = form-submitted binary
  // marking (groups isDepartment, users isActive), multi-select and attestation gates. Form checkboxes
  // are themed 16px squares with inline labels and no role=switch; the blanket-width defect stays fixed.
  await page.evaluate(() => { (document.querySelector('[data-page=groups]') as HTMLElement).click(); });
  await page.locator('#groupRows tr:first-child .row-actions button:nth-child(2)').click();
  const editCk = await page.evaluate(() => {
    const inp = document.querySelector('#formBody [data-field=isDepartment]') as HTMLInputElement;
    const cs = getComputedStyle(inp); const r = inp.getBoundingClientRect();
    const sp = inp.nextElementSibling!.getBoundingClientRect();
    return { type: inp.type, role: inp.getAttribute('role'), w: cs.width, app: cs.appearance,
      checked: inp.checked, centerDiff: Math.abs((r.top + r.height / 2) - (sp.top + sp.height / 2)),
      label: inp.parentElement!.className, dist: Math.round(sp.left - r.right) };
  });
  await page.keyboard.press('Escape');
  await page.locator('[data-create=groups]').click();
  const createCk = await page.evaluate(() => {
    const inp = document.querySelector('#formBody [data-field=isDepartment]') as HTMLInputElement;
    return { w: getComputedStyle(inp).width, checked: inp.checked, role: inp.getAttribute('role') };
  });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); (document.querySelector('[data-create=users]') as HTMLElement).click(); });
  const activeCk = await page.evaluate(() => {
    const inp = document.querySelector('#formBody [data-field=isActive]') as HTMLInputElement;
    return { present: !!inp, w: getComputedStyle(inp).width, checked: inp.checked, role: inp.getAttribute('role'), label: inp.nextElementSibling!.textContent, dist: Math.round(inp.nextElementSibling!.getBoundingClientRect().left - inp.getBoundingClientRect().right) };
  });
  await page.locator('#formBody [data-field=isActive]').uncheck();
  const unchecked = await page.evaluate(() => !(document.querySelector('#formBody [data-field=isActive]') as HTMLInputElement).checked);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { (document.querySelector('[data-page=clients]') as HTMLElement).click(); (document.querySelector('[data-create=clients]') as HTMLElement).click(); });
  const grantsCk = await page.evaluate(() => {
    const ins = [...document.querySelectorAll('#formBody [data-field=grantTypes] input')] as HTMLInputElement[];
    return { n: ins.length, allCk: ins.every(i => i.type === 'checkbox' && getComputedStyle(i).width === '16px' && !i.getAttribute('role')), labels: ins.map(i => i.nextElementSibling!.textContent), dists: ins.map(i => Math.round(i.nextElementSibling!.getBoundingClientRect().left - i.getBoundingClientRect().right)) };
  });
  await page.keyboard.press('Escape');
  // immediate domain stays Switch: webhooks row toggle is a .wswitch button with a knob
  await page.evaluate(() => { (document.querySelector('[data-page=webhooks]') as HTMLElement).click(); });
  const imm = await page.evaluate(() => {
    const b = document.querySelector('#webhookRows [data-wenabled]') as HTMLButtonElement;
    const k = b.querySelector('.knob') as HTMLElement;
    const r = b.getBoundingClientRect();
    return { tag: b.tagName, cls: b.className.includes('wswitch'), w: r.width, h: r.height, knob: !!k, on: b.className.includes('on') };
  });
  const gates = await page.evaluate(() => {
    const a = document.getElementById('mfaSaved') as HTMLInputElement;
    const b = document.getElementById('eraseAudit') as HTMLInputElement;
    return { mfaW: getComputedStyle(a).width, mfaApp: getComputedStyle(a).appearance,
      eraseW: getComputedStyle(b).width, eraseApp: getComputedStyle(b).appearance };
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const rm = await page.evaluate(() => {
    const knob = document.querySelector('#webhookRows .wswitch .knob') as HTMLElement;
    const inp = document.createElement('input'); inp.type = 'checkbox'; document.body.appendChild(inp);
    const r = { knob: getComputedStyle(knob).transitionDuration, ck: getComputedStyle(inp).transitionDuration };
    inp.remove(); return r;
  });
  await page.emulateMedia({ reducedMotion: null });
  await page.goto(AUTH);
  await page.evaluate(() => { (document.querySelector('[data-flow=enroll]') as HTMLElement).click(); });
  const enSaved = await page.evaluate(() => {
    const inp = document.getElementById('enSaved') as HTMLInputElement;
    const cs = getComputedStyle(inp);
    return { w: cs.width, app: cs.appearance, labelAlign: getComputedStyle(inp.parentElement!).alignItems, disp: getComputedStyle(inp.parentElement!).display, gap: getComputedStyle(inp.parentElement!).gap, dir: getComputedStyle(inp.parentElement!).flexDirection };
  });
  await page.evaluate(() => { (document.querySelector('[data-flow=consent]') as HTMLElement).click(); });
  await page.waitForTimeout(600);
  await page.locator('#csLoadRetry').click();
  await page.waitForTimeout(600);
  const scopes = await page.evaluate(() => {
    const inp = document.querySelector('#csScopes input') as HTMLInputElement;
    const cs = getComputedStyle(inp); const r = inp.getBoundingClientRect();
    const sp = inp.nextElementSibling!.getBoundingClientRect();
    return { w: r.width, app: cs.appearance, checked: inp.checked,
      tinted: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent',
      centerDiff: Math.abs((r.top + r.height / 2) - (sp.top + sp.height / 2)), dist: Math.round(sp.left - r.right) };
  });
  const a = { editCk, createCk, activeCk, unchecked, grantsCk, imm, gates, rm, enSaved, scopes };
  const pass = editCk.type === 'checkbox' && editCk.role === null && editCk.w === '16px' && editCk.app === 'none'
    && editCk.checked && editCk.centerDiff < 2 && editCk.label === 'ck-field' && editCk.dist === 8
    && createCk.w === '16px' && !createCk.checked && createCk.role === null
    && activeCk.present && activeCk.w === '16px' && activeCk.checked && activeCk.role === null && activeCk.label === 'Active' && activeCk.dist === 8 && unchecked
    && grantsCk.n === 2 && grantsCk.allCk && JSON.stringify(grantsCk.labels) === JSON.stringify(['authorization_code', 'client_credentials']) && grantsCk.dists.every((d: number) => d === 8)
    && imm.tag === 'BUTTON' && imm.cls && imm.w === 34 && imm.h === 20 && imm.knob && imm.on
    && gates.mfaW === '16px' && gates.mfaApp === 'none' && gates.eraseW === '16px' && gates.eraseApp === 'none'
    && rm.knob === '0s' && rm.ck === '0s'
    && enSaved.w === '16px' && enSaved.app === 'none' && enSaved.labelAlign === 'center' && enSaved.disp === 'flex' && enSaved.gap === '8px' && enSaved.dir === 'row'
    && scopes.w === 16 && scopes.app === 'none' && scopes.checked && scopes.tinted && scopes.centerDiff < 2 && scopes.dist === 8;
  rec('boolean-controls', pass, a);
  expect(pass, 'boolean-controls').toBe(true);
});

test('auth-login', async ({ page }) => {
  await page.goto(AUTH);
  // Adjudication 33 (A): login required inline + simulated AUTH_002 then success; magic request;
  // oauthCode one-time consumption (second POST 401); safeOidcRedirect allowlist; magic branches.
  await page.locator('#lgSubmit').click();
  const req = await page.evaluate(() => document.getElementById('lgEmailErr')!.style.display === 'block');
  await page.locator('#lgEmail').fill('admin@acme.io');
  await page.locator('#lgPwd').fill('whatever');
  await page.locator('#lgSubmit').click();
  await page.waitForTimeout(600);
  const authErr = await page.evaluate(() => document.getElementById('lgErr')!.textContent!.includes('AUTH_002'));
  await page.locator('#lgSubmit').click();
  await page.waitForTimeout(600);
  const ok = await page.evaluate(() => document.getElementById('lgOk')!.style.display === 'flex');
  await page.locator('#lgMagicBtn').click();
  const magicOpen = await page.evaluate(() => document.getElementById('lgMagicPanel')!.style.display === 'block');
  await page.locator('#mgEmail').fill('admin@acme.io');
  await page.locator('#mgSend').click();
  await page.waitForTimeout(600);
  await page.locator('#mgSend').click();
  await page.waitForTimeout(600);
  const magicSent = await page.evaluate(() => document.getElementById('mgMsg')!.style.display === 'flex');
  await page.locator('#ocConsume').click();
  const oc1 = await page.evaluate(() => document.getElementById('ocMsg')!.textContent!.includes('consumed once'));
  await page.locator('#ocConsume').click();
  const oc2 = await page.evaluate(() => document.getElementById('ocMsg')!.textContent!.includes('401'));
  const rd = await page.evaluate(() => {
    const inp = document.getElementById('rdInput') as HTMLInputElement;
    const btn = document.getElementById('rdCheck') as HTMLButtonElement;
    const out: string[] = [];
    for (const v of ['/oidc/auth/abc', '/oidc/device/x', 'https://evil.example', '/oidc/auth/%252F%252Fevil', '/oidc/auth/a\\b']) {
      inp.value = v; btn.click();
      out.push(document.getElementById('rdMsg')!.textContent!.startsWith('Allowed') ? 'ok' : 'no');
    }
    return out;
  });
  await page.evaluate(() => { (document.querySelector('[data-flow=magic]') as HTMLElement).click(); });
  const branches: string[] = [];
  for (const st of ['suspended', 'invalid', 'valid']) {
    await page.evaluate((s) => { (document.getElementById('mkState') as HTMLSelectElement).value = s; }, st);
    await page.locator('#mkConsume').click();
    await page.waitForTimeout(600);
    branches.push(await page.evaluate(() => document.getElementById('mkOk')!.style.display === 'flex' ? 'ok' : (document.getElementById('mkErr')!.textContent!.includes('AUTH_004') ? 'suspended' : 'invalid')));
  }
  const a = { req, authErr, ok, magicOpen, magicSent, oc1, oc2, rd, branches };
  const pass = req && authErr && ok && magicOpen && magicSent && oc1 && oc2
    && JSON.stringify(rd) === JSON.stringify(['ok', 'ok', 'no', 'no', 'no'])
    && JSON.stringify(branches) === JSON.stringify(['suspended', 'invalid', 'ok']);
  rec('auth-login', pass, a);
  expect(pass, 'auth-login').toBe(true);
});

test('auth-register-reset', async ({ page }) => {
  await page.goto(AUTH);
  // Adjudication 33 (A): register confirm-match + shared 12+ policy + async; forgot sent; reset
  // token consumed + confirm; verify spin -> ok/expired branches.
  await page.evaluate(() => { (document.querySelector('[data-flow=register]') as HTMLElement).click(); });
  await page.locator('#rgSubmit').click();
  const nameErr = await page.evaluate(() => document.getElementById('rgNameErr')!.style.display === 'block');
  await page.locator('#rgName').fill('New User');
  await page.locator('#rgEmail').fill('new@acme.io');
  await page.locator('#rgPwd').fill('short');
  await page.locator('#rgConfirm').fill('short');
  await page.locator('#rgSubmit').click();
  const polErr = await page.evaluate(() => document.getElementById('rgPwdErr')!.textContent!.includes('12+'));
  await page.locator('#rgPwd').fill('Str0ng!Passw');
  await page.locator('#rgConfirm').fill('Str0ng!PasswX');
  await page.locator('#rgSubmit').click();
  const matchErr = await page.evaluate(() => document.getElementById('rgConfirmErr')!.textContent!.includes('do not match'));
  await page.locator('#rgConfirm').fill('Str0ng!Passw');
  await page.locator('#rgSubmit').click();
  await page.waitForTimeout(600);
  const rgFail = await page.evaluate(() => document.getElementById('rgErr')!.style.display === 'flex');
  await page.locator('#rgSubmit').click();
  await page.waitForTimeout(600);
  const rgOk = await page.evaluate(() => document.getElementById('rgOk')!.style.display === 'flex');
  await page.evaluate(() => { (document.querySelector('[data-flow=forgot]') as HTMLElement).click(); });
  await page.locator('#fgSubmit').click();
  const fgReq = await page.evaluate(() => document.getElementById('fgEmailErr')!.style.display === 'block');
  await page.locator('#fgEmail').fill('new@acme.io');
  await page.locator('#fgSubmit').click();
  await page.waitForTimeout(600);
  await page.locator('#fgSubmit').click();
  await page.waitForTimeout(600);
  const fgSent = await page.evaluate(() => document.getElementById('fgSent')!.style.display === 'flex');
  await page.evaluate(() => { (document.querySelector('[data-flow=reset]') as HTMLElement).click(); });
  await page.locator('#rsPwd').fill('Str0ng!Passw');
  await page.locator('#rsConfirm').fill('nope');
  await page.locator('#rsSubmit').click();
  const rsMatch = await page.evaluate(() => document.getElementById('rsConfirmErr')!.style.display === 'block');
  await page.locator('#rsConfirm').fill('Str0ng!Passw');
  await page.locator('#rsSubmit').click();
  await page.waitForTimeout(600);
  await page.locator('#rsSubmit').click();
  await page.waitForTimeout(600);
  const rsOk = await page.evaluate(() => ({ ok: document.getElementById('rsOk')!.style.display === 'flex', consumed: document.getElementById('rsToken')!.textContent!.includes('consumed') }));
  await page.evaluate(() => { (document.querySelector('[data-flow=verify]') as HTMLElement).click(); });
  await page.evaluate(() => { (document.getElementById('vfState') as HTMLSelectElement).value = 'expired'; });
  await page.locator('#vfRun').click();
  await page.waitForTimeout(600);
  const vfExp = await page.evaluate(() => document.getElementById('vfErr')!.style.display === 'flex');
  await page.evaluate(() => { (document.getElementById('vfState') as HTMLSelectElement).value = 'valid'; });
  await page.locator('#vfRun').click();
  await page.waitForTimeout(600);
  const vfOk = await page.evaluate(() => document.getElementById('vfOk')!.style.display === 'flex');
  const a = { nameErr, polErr, matchErr, rgFail, rgOk, fgReq, fgSent, rsMatch, rsOk, vfExp, vfOk };
  const pass = nameErr && polErr && matchErr && rgFail && rgOk && fgReq && fgSent && rsMatch && rsOk.ok && rsOk.consumed && vfExp && vfOk;
  rec('auth-register-reset', pass, a);
  expect(pass, 'auth-register-reset').toBe(true);
});

test('auth-enroll-consent', async ({ page }) => {
  await page.goto(AUTH);
  // Adjudication 33 (A): enroll otpauth copy fallback + wrong-code + dead-token + recovery-once gate;
  // consent load error + scopes checkboxes + approve/deny async + redirect allowlist.
  await page.evaluate(() => { (document.querySelector('[data-flow=enroll]') as HTMLElement).click(); });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
  });
  await page.locator('#enCopy').click();
  await page.waitForTimeout(60);
  const copyFail = await page.evaluate(() => document.getElementById('protoToast')!.textContent!.includes('Copy failed'));
  await page.evaluate(() => { Object.defineProperty(document, 'execCommand', { configurable: true, value: () => true }); });
  await page.locator('#enCopy').click();
  await page.waitForTimeout(60);
  const copyOk = await page.evaluate(() => document.getElementById('protoToast')!.textContent === 'Copied to clipboard');
  await page.locator('#enCode').fill('000000');
  await page.locator('#enConfirm').click();
  await page.waitForTimeout(600);
  const wrong = await page.evaluate(() => document.getElementById('enErr')!.textContent!.includes('Wrong code'));
  await page.locator('#enCode').fill('123456');
  await page.locator('#enConfirm').click();
  await page.waitForTimeout(600);
  const enFail = await page.evaluate(() => document.getElementById('enErr')!.textContent!.includes('Confirm failed'));
  await page.locator('#enConfirm').click();
  await page.waitForTimeout(600);
  const rec1 = await page.evaluate(() => ({ shown: document.getElementById('enRecovery')!.style.display === 'block', codes: document.querySelectorAll('#enCodes span').length, gated: (document.getElementById('enContinue') as HTMLButtonElement).disabled }));
  await page.locator('#enSaved').check();
  const ungated = await page.evaluate(() => !(document.getElementById('enContinue') as HTMLButtonElement).disabled);
  await page.reload();
  await page.evaluate(() => { (document.querySelector('[data-flow=enroll]') as HTMLElement).click(); });
  await page.locator('#enDeadBtn').click();
  const dead = await page.evaluate(() => ({ dead: document.getElementById('enDead')!.style.display === 'flex', body: document.getElementById('enBody')!.style.display === 'none' }));
  await page.evaluate(() => { (document.querySelector('[data-flow=consent]') as HTMLElement).click(); });
  await page.waitForTimeout(600);
  const csLoadErr = await page.evaluate(() => document.getElementById('csLoadErr')!.style.display === 'flex');
  await page.locator('#csLoadRetry').click();
  await page.waitForTimeout(600);
  const csBody = await page.evaluate(() => ({ shown: document.getElementById('csBody')!.style.display === 'block', scopes: document.querySelectorAll('#csScopes input').length }));
  await page.locator('#csRedirect').fill('https://evil.example');
  await page.locator('#csApprove').click();
  const rdRefuse = await page.evaluate(() => document.getElementById('csErr')!.textContent!.includes('Redirect not allowed'));
  await page.locator('#csRedirect').fill('/oidc/auth/abc');
  await page.locator('#csApprove').click();
  await page.waitForTimeout(600);
  const csFail = await page.evaluate(() => document.getElementById('csErr')!.textContent!.includes('Decision failed'));
  await page.locator('#csApprove').click();
  await page.waitForTimeout(600);
  const csOk = await page.evaluate(() => document.getElementById('csRedirecting')!.style.display === 'flex');
  await page.locator('#csDeny').click();
  await page.waitForTimeout(600);
  const csDeny = await page.evaluate(() => document.getElementById('protoToast')!.textContent === 'Consent denied');
  const a = { copyFail, copyOk, wrong, enFail, rec1, ungated, dead, csLoadErr, csBody, rdRefuse, csFail, csOk, csDeny };
  const pass = copyFail && copyOk && wrong && enFail && rec1.shown && rec1.codes === 8 && rec1.gated && ungated
    && dead.dead && dead.body && csLoadErr && csBody.shown && csBody.scopes === 3 && rdRefuse && csFail && csOk && csDeny;
  rec('auth-enroll-consent', pass, a);
  expect(pass, 'auth-enroll-consent').toBe(true);
});

test('auth-setup', async ({ page }) => {
  await page.goto(AUTH);
  // Adjudication 33 (A): four-step wizard, step focus, admin min-8 policy (differs from console 12+),
  // password-not-stored disclosure, config required siteName, complete -> console.
  await page.evaluate(() => { (document.querySelector('[data-flow=setup]') as HTMLElement).click(); });
  const steps0 = await page.evaluate(() => ({ n: document.querySelectorAll('#suSteps .st').length, on: document.querySelectorAll('#suSteps .st.on').length, focus: document.activeElement!.id }));
  await page.locator('#suNext').click();
  const step1 = await page.evaluate(() => document.getElementById('su1')!.style.display === 'block');
  await page.locator('#suNext').click();
  const suNameErr = await page.evaluate(() => document.getElementById('suNameErr')!.style.display === 'block');
  await page.locator('#suName').fill('Root Admin');
  await page.locator('#suEmail').fill('root@acme.io');
  await page.locator('#suPwd').fill('short');
  await page.locator('#suNext').click();
  const min8 = await page.evaluate(() => document.getElementById('suPwdErr')!.textContent!.includes('8 characters'));
  const note = await page.evaluate(() => document.getElementById('flow-setup')!.textContent!.includes('never stored'));
  await page.locator('#suPwd').fill('Abcdefg1');
  await page.locator('#suNext').click();
  const suBusy = await page.evaluate(() => (document.getElementById('suNext') as HTMLButtonElement).disabled);
  await page.waitForTimeout(600);
  const suFail = await page.evaluate(() => document.getElementById('suErr')!.style.display === 'flex');
  await page.locator('#suNext').click();
  await page.waitForTimeout(600);
  const step2 = await page.evaluate(() => ({ shown: document.getElementById('su2')!.style.display === 'block', focus: document.activeElement!.id }));
  await page.locator('#cfSiteName').fill('');
  await page.locator('#suNext').click();
  const cfReq = await page.evaluate(() => document.getElementById('cfSiteNameErr')!.style.display === 'block');
  await page.locator('#cfSiteName').fill('AccessBase');
  await page.locator('#suNext').click();
  const step3 = await page.evaluate(() => document.getElementById('su3')!.style.display === 'block');
  await page.locator('#suPrev').click();
  const back = await page.evaluate(() => document.getElementById('su2')!.style.display === 'block');
  await page.locator('#suNext').click();
  await page.locator('#suNext').click();
  await page.waitForURL(/admin-console\.html$/);
  const a = { steps0, step1, suNameErr, min8, note, suBusy, suFail, step2, cfReq, step3, back };
  const pass = steps0.n === 4 && steps0.on === 1 && steps0.focus === 'suHead' && step1 && suNameErr && min8 && note
    && suBusy && suFail && step2.shown && step2.focus === 'suHead' && cfReq && step3 && back;
  rec('auth-setup', pass, a);
  expect(pass, 'auth-setup').toBe(true);
});
