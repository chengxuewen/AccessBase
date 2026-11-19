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
  const toastShown = await page.evaluate(() => document.getElementById('protoToast')!.style.display === 'block');
  const closedAfterSelect = await page.evaluate(() => !document.getElementById('rowMenu')!.classList.contains('on'));
  const a = { haspopup, expandedBefore, menuOn, expandedAfter, itemCount, roles, dangerItem, firstFocused, closedByEsc, expandedClosed, focusReturned, toastShown, closedAfterSelect };
  const pass = haspopup === 'menu' && expandedBefore === 'false' && menuOn && expandedAfter === 'true'
    && itemCount === 3 && roles && dangerItem === 1 && firstFocused && closedByEsc && expandedClosed === 'false'
    && focusReturned && toastShown && closedAfterSelect;
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
  const toastText = await page.evaluate(() => document.getElementById('protoToast')!.textContent);
  const closedAfter = await page.evaluate(() => !document.getElementById('rowMenu')!.classList.contains('on'));
  const a = { wideExport, wideMore, narrowExport, narrowMore, verifyKept, phWrap, menuOn, exportItem, toastText, closedAfter };
  const pass = wideExport !== 'none' && wideMore === 'none' && narrowExport === 'none' && narrowMore !== 'none'
    && verifyKept !== 'none' && phWrap === 'wrap' && menuOn && exportItem === 1 && toastText === 'Exported' && closedAfter;
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
    const ids = ['tenantFilter', 'statusFilter', 'scopeSelect', 'kindFilter', 'memberPicker', 'tenantStatusFilter', 'apikeyStatusFilter', 'auditActionFilter', 'eventFamilyFilter', 'styleSelect'];
    const theme = document.documentElement.dataset.theme || 'light';
    const rows = ids.map(id => { const s = document.getElementById(id) as HTMLSelectElement; const o = s.querySelector('option')!; const oc = getComputedStyle(o); return { id, scheme: getComputedStyle(s).colorScheme, bg: sum(oc.backgroundColor), fg: sum(oc.color) }; });
    return { theme, rows };
  });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  const dark = await probe();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  const light = await probe();
  // edit-modal dynamic select (users Edit -> status select) in dark
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; (document.querySelector('[data-page=users]') as HTMLElement).click(); });
  await page.locator('#userRows button[aria-label="Edit"]').first().click();
  const editSel = await page.evaluate(() => { const s = document.querySelector('#formBody select') as HTMLSelectElement; const o = s.querySelector('option')!; const oc = getComputedStyle(o); const sum = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); return m[0] + m[1] + m[2]; }; return { scheme: getComputedStyle(s).colorScheme, bg: sum(oc.backgroundColor), fg: sum(oc.color) }; });
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