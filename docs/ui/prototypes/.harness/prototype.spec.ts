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
    (document.getElementById('confirmDelete') as HTMLElement).click(); // adjudication 13: confirm-gated
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
      users: ['#userRows .tag.ok', '#userRows .tag.danger', '#userRows .count-pill'],
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
  const pass = a.checked >= 190 && a.fails.length === 0 && a.min >= 4.5;
  rec('surfaces-contrast', pass, a);
  expect(pass, 'surfaces-contrast').toBe(true);
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
  // R1=B: themed CSS tooltip on icon actions (data-tip + aria-label), hover + focus reveal.
  await page.evaluate(() => { (document.querySelector('[data-page=users]') as HTMLElement).click(); });
  const edit = page.locator('#userRows button[data-tip="Edit"]').first();
  const aria = await edit.getAttribute('aria-label');
  const tip = await edit.getAttribute('data-tip');
  const hiddenOpacity = await edit.evaluate(el => getComputedStyle(el, '::after').opacity);
  await edit.hover();
  await page.waitForTimeout(250); // let the .12s opacity transition finish
  const hoverOpacity = await edit.evaluate(el => getComputedStyle(el, '::after').opacity);
  const hoverContent = await edit.evaluate(el => getComputedStyle(el, '::after').content);
  // keyboard/programmatic focus also reveals the tooltip
  const view = page.locator('#userRows button[data-tip="View"]').first();
  await view.focus();
  await page.waitForTimeout(250);
  const focusOpacity = await view.evaluate(el => getComputedStyle(el, '::after').opacity);
  // disabled (locked) row action is wrapped in .tip-wrap so its hint still shows on hover
  await page.evaluate(() => { (document.querySelector('[data-page=roles]') as HTMLElement).click(); });
  const wrap = page.locator('#roleRows .tip-wrap').first();
  const wrapTip = await wrap.getAttribute('data-tip');
  const btnDisabled = await wrap.locator('button').evaluate(el => (el as HTMLButtonElement).disabled);
  const btnAria = await wrap.locator('button').getAttribute('aria-label');
  await wrap.hover();
  await page.waitForTimeout(250);
  const wrapHoverOpacity = await wrap.evaluate(el => getComputedStyle(el, '::after').opacity);
  const a = { aria, tip, hiddenOpacity, hoverOpacity, hoverContent, focusOpacity, wrapTip, btnDisabled, btnAria, wrapHoverOpacity };
  const pass = aria === 'Edit' && tip === 'Edit' && hiddenOpacity === '0' && hoverOpacity === '1'
    && hoverContent === '"Edit"' && focusOpacity === '1' && btnDisabled && btnAria === wrapTip && wrapHoverOpacity === '1';
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
  const a = { stickyPos, prioHidden, prioKept, cardThead, tdLabel, tdDisplay, prioShownInCard };
  const pass = stickyPos === 'sticky' && prioHidden === 'none' && prioKept !== 'none'
    && cardThead === 'none' && tdLabel === 'Name' && tdDisplay === 'flex' && prioShownInCard === 'flex';
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
  const after = await page.evaluate(() => document.querySelectorAll('#clientRows tr').length);
  const deletedToast = await page.evaluate(() => document.getElementById('protoToast')!.textContent);
  const a = { editOpen, prefilled, savedClosed, rowUpdated, savedToast, before, confirmOpen, after, deletedToast };
  const pass = editOpen && prefilled === 'Jane Doe' && savedClosed && rowUpdated === 'Edited Name' && savedToast === 'Saved'
    && confirmOpen && after === before - 1 && deletedToast === 'Deleted';
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
  const masked = await page.evaluate(() => [...document.querySelectorAll('#optionRows tr')].some(tr => tr.textContent!.includes('smtp_password') && tr.textContent!.includes('••••')));
  await page.evaluate(() => { const i = [...document.querySelectorAll('#optionRows tr')].findIndex(tr => tr.textContent!.includes('captcha_enabled')); (document.querySelector('#optionRows tr:nth-child(' + (i + 1) + ') button[data-optedit]') as HTMLElement).click(); });
  await page.locator('#formBody [data-field=value]').fill('not-json');
  await page.locator('#formSave').click();
  const jsonErr = await page.evaluate(() => document.getElementById('formModal')!.classList.contains('on') && document.getElementById('formBody')!.textContent!.includes('valid JSON'));
  await page.keyboard.press('Escape');
  // template preview + idle timeout
  await page.evaluate(() => { (document.querySelector('#settingsTabs button[data-tab=semail]') as HTMLElement).click(); });
  await page.locator('#templateRows button[data-tplview]').first().click();
  const preview = await page.evaluate(() => document.getElementById('detailModal')!.classList.contains('on'));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { (document.querySelector('#settingsTabs button[data-tab=ssecurity]') as HTMLElement).click(); });
  await page.evaluate(() => {
    const sel = document.getElementById('idleSelect') as any;
    sel._cbx.querySelector('.cbx-btn').click();
    [...sel._cbx.querySelectorAll('.cbx-opt')].find((o: any) => o.dataset.value === '3600').click();
  });
  const idleToast = await page.evaluate(() => document.getElementById('protoToast')!.textContent);
  const a = { shell, sec0, revVerb, sec1, badCode, rec0, recEsc, rec1, mfaOn, masked, jsonErr, preview, idleToast };
  const pass = shell.on && shell.tabs === 4 && shell.title === 'Settings'
    && sec0.paneOn && sec0.rows === 3 && sec0.current && revVerb === 'Revoke' && sec1 === 2
    && badCode && rec0.open && rec0.doneDisabled && recEsc && rec1 && mfaOn
    && masked && jsonErr && preview && idleToast === 'Idle timeout saved';
  rec('settings', pass, a);
  expect(pass, 'settings').toBe(true);
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
  const revoked = await page.evaluate(() => document.querySelectorAll('#apikeyRows .tag.danger').length);
  await page.locator('[data-create=apikeys]').click();
  const form = await page.evaluate(() => ({
    name: !!document.querySelector('#formBody [data-field=name]'),
    expires: !!document.querySelector('#formBody [data-field=expires]'),
    scopes: !!document.querySelector('#formBody [data-field=scopes]'),
  }));
  await page.locator('#formBody [data-field=name]').fill('e2e-key');
  await page.locator('#formSave').click();
  const reveal = await page.evaluate(() => ({
    on: document.getElementById('revealModal')!.classList.contains('on'),
    val: (document.getElementById('revealValue') as HTMLInputElement).value,
    meta: document.getElementById('revealMeta')!.textContent,
  }));
  const a = { noCrud, conf, notRevoked, revoked, form, reveal: { on: reveal.on, prefix: reveal.val.slice(0, 3), len: reveal.val.length, once: reveal.meta.includes('never shown again') } };
  const pass = noCrud && conf.on && conf.verb === 'Revoke' && revoked === notRevoked + 1
    && form.name && form.expires && !form.scopes
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
  await page.locator('#clearPermsBtn').click();
  const clearVerb = await page.evaluate(() => document.getElementById('confirmDelete')!.textContent);
  await page.locator('#confirmDelete').click();
  const cleared = await page.evaluate(() => ({ on: document.querySelectorAll('#matrixRows .perm-cell.on').length, scopeHidden: getComputedStyle(document.querySelector('.scope-box')!).display === 'none' }));
  const a = { lock, partition, scopeVis, parentSel, note, clearVerb, cleared };
  const pass = lock.locked > 0 && lock.allDisabled && lock.unchanged
    && partition.editorClean && partition.granted === 9 && scopeVis
    && parentSel.exists && parentSel.opts >= 6 && note
    && clearVerb === 'Clear' && cleared.on === 0 && cleared.scopeHidden;
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
  const pwdErr = await page.evaluate(() => document.getElementById('initErr')!.textContent!.includes('8+ chars'));
  await page.locator('#initEmail').fill('jane.doe@globex.com'); // existing user -> EMAIL_EXISTS
  await page.locator('#initPwd').fill('Passw0rd12');
  await page.locator('#initSubmit').click();
  const existsErr = await page.evaluate(() => document.getElementById('initErr')!.textContent!.includes('EMAIL_EXISTS'));
  await page.locator('#initEmail').fill('newadmin@globex.example');
  await page.locator('#initSubmit').click();
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
  const suspended = await page.evaluate(() => document.querySelectorAll('#tenantRows tr')[2].textContent!.includes('Suspended'));
  await page.locator('#tenantRows tr').nth(4).locator('button[aria-label="Delete"]').click();
  const softMsg = await page.evaluate(() => document.getElementById('confirmMsg')!.textContent!.includes('soft delete'));
  await page.locator('#confirmDelete').click();
  const softKept = await page.evaluate(() => ({ rows: document.querySelectorAll('#tenantRows tr').length, kept: document.querySelectorAll('#tenantRows tr')[4].textContent!.includes('Umbrella') && document.querySelectorAll('#tenantRows tr')[4].textContent!.includes('Suspended') }));
  await page.locator('[data-create=tenants]').click();
  await page.locator('#formBody [data-field=name]').fill('Test Co');
  await page.locator('#formBody [data-field=slug]').fill('Bad_Slug');
  await page.locator('#formSave').click();
  const slugErr = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('lowercase letters/digits'));
  await page.locator('#formBody [data-field=slug]').fill('');
  await page.locator('#formSave').click();
  const slugReq = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('Slug is required'));
  const a = { noFilter, initOpen, pwdErr, existsErr, created, bootstrapped, acmeDone, susVerb, suspended, softMsg, softKept, slugErr, slugReq };
  const pass = noFilter && initOpen.on && initOpen.form && pwdErr && existsErr && created && bootstrapped && acmeDone
    && susVerb === 'Suspend' && suspended && softMsg && softKept.rows === 5 && softKept.kept && slugErr && slugReq;
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
  const sw1 = await page.evaluate(() => ({ on: document.querySelector('#webhookRows [role=switch]')!.getAttribute('aria-checked'), toast: document.getElementById('protoToast')!.textContent }));
  await page.locator('#webhookRows [data-wenabled]').first().click();
  await page.locator('#webhookRows [data-deliv]').first().click();
  const vocab = await page.evaluate(() => {
    const txt = document.getElementById('delivRows')!.textContent!;
    return { ok: /delivered/.test(txt), bad: /success|failed/.test(txt) };
  });
  await page.keyboard.press('Escape');
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
  const a = { sw0, sw1, vocab, form, urlErr, evErr, chipVal, created };
  const pass = sw0.n === 3 && sw0.on === 'true' && sw1.on === 'false' && sw1.toast === 'Endpoint disabled'
    && vocab.ok && !vocab.bad && form.url && form.events && form.desc && form.presets === 5
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
  const m0 = await page.evaluate(() => document.querySelectorAll('#memberList li').length);
  await page.locator('#memberList [data-rm]').first().click();
  const mConf = await page.evaluate(() => ({ on: document.getElementById('confirmModal')!.classList.contains('on'), verb: document.getElementById('confirmDelete')!.textContent, msg: document.getElementById('confirmMsg')!.textContent!.includes('inherited') }));
  await page.locator('#confirmCancel').click();
  const m1 = await page.evaluate(() => document.querySelectorAll('#memberList li').length);
  await page.locator('#memberList [data-rm]').first().click();
  await page.locator('#confirmDelete').click();
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
  const s2 = await page.evaluate(() => document.querySelectorAll('#sessionRows tr').length);
  const a = { m0, mConf, m1, m2, o0, oConf, o1, o2, s0, sConf, s1, s2 };
  const pass = mConf.on && mConf.verb === 'Remove' && mConf.msg && m1 === m0 && m2 === m0 - 1
    && oConf.on && oConf.verb === 'Unlink' && oConf.msg && o1 === o0 && o2 === o0 - 1
    && sConf.on && sConf.verb === 'Sign out' && sConf.msg && s1 === s0 && s2 === 1;
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
    grants: document.querySelectorAll('#formBody [data-grant]').length,
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
  await page.locator('#formBody [data-grant="client_credentials"]').click();
  await page.evaluate(() => { (document.querySelector('#formBody [data-field=tokenAuthMethod]') as HTMLSelectElement).value = 'none'; });
  await page.locator('#formSave').click();
  const eB5 = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('B5'));
  await page.evaluate(() => { (document.querySelector('#formBody [data-field=tokenAuthMethod]') as HTMLSelectElement).value = 'client_secret_basic'; });
  await page.locator('#formBody [data-field=scope]').fill('foo');
  await page.locator('#formSave').click();
  const eScope = await page.evaluate(() => document.getElementById('formBody')!.textContent!.includes('offline_access'));
  await page.locator('#formBody [data-field=scope]').fill('openid');
  const rows0 = await page.evaluate(() => document.querySelectorAll('#clientRows tr').length);
  await page.locator('#formSave').click();
  const created = await page.evaluate(() => ({ reveal: document.getElementById('revealModal')!.classList.contains('on'), rows: document.querySelectorAll('#clientRows tr').length }));
  const a = { noEdit, form, e002, e003, eB5, eScope, rows0, created };
  const pass = noEdit && form.grants === 3 && form.tam === 4 && form.bc
    && e002 && e003 && eB5 && eScope && created.reveal && created.rows === rows0 + 1;
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
    && form.on && form.usersPage && JSON.stringify(form.fields) === JSON.stringify(['name', 'email', 'password', 'roles']) && form.pwdType === 'password'
    && dup && policy && created.users === users0 + 1 && created.stat === (users0 + 1).toLocaleString()
    && created.actFirst === 'user.created' && created.closed && navAudit;
  rec('dashboard-model', pass, a);
  expect(pass, 'dashboard-model').toBe(true);
});