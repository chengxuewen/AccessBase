import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 940, height: 600 } });
await p.goto('file:///home/ubuntu/Documents/AccessBase/docs/ui/prototypes/admin-console.html');
await p.evaluate(() => { const s = document.getElementById('styleSelect'); s.value = 'ant'; s.onchange(new Event('change')); document.documentElement.dataset.theme = 'light'; });
const probe = () => p.evaluate(() => {
  const out = {};
  for (const pg of ['apikeys', 'users', 'tenants', 'clients', 'webhooks', 'audit', 'events', 'roles']) {
    document.querySelector('[data-page=' + pg + ']').click();
    const wrap = document.querySelector('#page-' + pg + ' [style*="overflow-x"], #page-' + pg + ' .matrix-wrap');
    const table = wrap ? wrap.querySelector('table') : null;
    if (!table) { out[pg] = 'nowrap'; continue; }
    const sticky = [...table.querySelectorAll('th,td')].filter(c => getComputedStyle(c).position === 'sticky');
    const tag = table.querySelector('tbody .tag');
    const lastSticky = sticky.length ? sticky[sticky.length - 1].getBoundingClientRect() : null;
    out[pg] = {
      over: wrap.scrollWidth > wrap.clientWidth, sw: wrap.scrollWidth, cw: wrap.clientWidth,
      stickyN: sticky.length,
      stickyPos: sticky.length ? getComputedStyle(sticky[0]).position + '/' + (getComputedStyle(sticky[0]).right || '') : null,
      stickyBg: sticky.length ? getComputedStyle(sticky[0]).backgroundColor : null,
      stickyShadow: sticky.length ? getComputedStyle(sticky[0]).boxShadow : null,
      tagRight: tag ? Math.round(tag.getBoundingClientRect().right) : null,
      stickyLeft: lastSticky ? Math.round(lastSticky.left) : null,
      occluded: tag && lastSticky ? tag.getBoundingClientRect().right > lastSticky.left : null,
    };
  }
  return out;
});
const at940 = await probe();
await p.setViewportSize({ width: 1100, height: 600 });
await p.waitForTimeout(200);
const at1100 = await probe();
await p.setViewportSize({ width: 700, height: 600 });
await p.waitForTimeout(200);
const at700 = await probe();
console.log(JSON.stringify({ at940, at1100, at700 }, null, 1));
await b.close();
