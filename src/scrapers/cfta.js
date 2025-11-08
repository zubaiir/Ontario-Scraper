const { generateFingerprint } = require('../utils');

/**
 * CFTA / ALEC Scraper
 *
 * Target:
 *   https://www.cfta-alec.ca/
 */

const BASE_URL = 'https://www.cfta-alec.ca/';
const PORTAL_SOURCE = 'CFTA-ALEC';

async function scrapeCFTA({ page, maxItems = 40 }) {
  console.log('🔍 CFTA-ALEC start');
  const results = [];

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(2000);

  await waitForAny(page, [
    'a[href*="tenders"]',
    'a[href*="procurement"]'
  ], 15000).catch(() => {});

  const listItems = await page.$$eval(
    'a[href*="tenders"], a[href*="procurement"]',
    (links, { portalSource }) => {
      const items = [];
      const seen = new Set();
      for (const linkEl of links) {
        const href = linkEl.getAttribute('href') || '';
        if (!href) continue;
        const url = href.startsWith('http')
          ? href
          : new URL(href, window.location.origin).toString();
        if (seen.has(url)) continue; seen.add(url);

        const title = (linkEl.textContent || '').trim();
        if (!title) continue;

        items.push({
          title,
          agency: '',
          region: '',
          created_at: '',
          listing_expiry_date: '',
          daysLeft: '',
          project_reference: '',
          portal_url: url,
          portal_source: portalSource
        });
      }
      return items.slice(0, 40);
    },
    { portalSource: PORTAL_SOURCE }
  );

  const sliced = listItems.slice(0, maxItems);

  for (const item of sliced) {
    try {
      await page.goto(item.portal_url, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(800);
      const detailData = await page.evaluate(() => {
        const text = document.body.innerText || '';
        return {
          project_reference_detail: '',
          buyer_organization_detail: '',
          project_type: '',
          agreement_type: '',
          city: '',
          contact_person: '',
          contact_phone: '',
          contact_email: '',
          detailed_description: text.slice(0, 4000)
        };
      });
      const merged = { ...item, ...detailData };
      const fp = generateFingerprint(`${merged.title}${merged.portal_url}CFTA`);
      results.push({ id: fp, ...merged, hash_fingerprint: fp });
    } catch (e) {
      console.warn(`⚠️ CFTA detail: ${e.message}`);
    }
  }

  console.log(`🏁 CFTA-ALEC done with ${results.length} records`);
  return results;
}

async function waitForAny(page, selectors, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const s of selectors) {
      const el = await page.$(s);
      if (el) return;
    }
    await page.waitForTimeout(300);
  }
}

module.exports = { scrapeCFTA };
