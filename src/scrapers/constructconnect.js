const { generateFingerprint } = require('../utils');

/**
 * ConstructConnect Scraper (aggregator-style, dummy-safe)
 *
 * Targets:
 *   canada.constructconnect.com and similar listing pages.
 */

const BASE_URL = 'https://canada.constructconnect.com/';
const PORTAL_SOURCE = 'ConstructConnect';

async function scrapeConstructConnect({ page, maxItems = 40 }) {
  console.log('🔍 ConstructConnect start');
  const results = [];

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(2000);

  await waitForAny(page, [
    '.search-result-item',
    'article',
    'a[href*="project"]'
  ], 15000).catch(() => {});

  const listItems = await page.$$eval(
    '.search-result-item, article, a[href*="project"]',
    (nodes, { portalSource }) => {
      const items = [];
      const seen = new Set();

      nodes.forEach(node => {
        const linkEl = node.tagName === 'A'
          ? node
          : node.querySelector('a[href*="project"]') ||
            node.querySelector('a[href]');
        if (!linkEl) return;

        const href = linkEl.getAttribute('href') || '';
        if (!href) return;

        const url = href.startsWith('http')
          ? href
          : new URL(href, window.location.origin).toString();
        if (seen.has(url)) return;
        seen.add(url);

        const title =
          (linkEl.textContent || '').trim() ||
          node.querySelector('h2, h3')?.textContent.trim() ||
          '';
        if (!title) return;

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
      });

      return items.slice(0, 40);
    },
    { portalSource: PORTAL_SOURCE }
  );

  const sliced = listItems.slice(0, maxItems);

  for (const item of sliced) {
    try {
      await page.goto(item.portal_url, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(1000);

      const detailData = await page.evaluate(() => {
        const text = document.body.innerText || '';
        const detailed_description = text.slice(0, 4000);

        return {
          project_reference_detail: '',
          buyer_organization_detail: '',
          project_type: '',
          agreement_type: '',
          city: '',
          contact_person: '',
          contact_phone: '',
          contact_email: '',
          detailed_description
        };
      });

      const merged = { ...item, ...detailData };
      const fp = generateFingerprint(`${merged.title}${merged.portal_url}ConstructConnect`);
      results.push({ id: fp, ...merged, hash_fingerprint: fp });
    } catch (e) {
      console.warn(`⚠️ ConstructConnect detail: ${e.message}`);
    }
  }

  console.log(`🏁 ConstructConnect done with ${results.length} records`);
  return results;
}

async function waitForAny(page, selectors, timeout) {
  const start = Date.now();
  const t = timeout || 10000;
  while (Date.now() - start < t) {
    for (const s of selectors) {
      const el = await page.$(s);
      if (el) return;
    }
    await page.waitForTimeout(300);
  }
}

module.exports = { scrapeConstructConnect };
