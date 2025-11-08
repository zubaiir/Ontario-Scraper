const { generateFingerprint } = require('../utils');

/**
 * BC Bid Scraper
 *
 * Typical:
 *   https://new.bcbid.gov.bc.ca/
 */

const BASE_LIST_URL = 'https://new.bcbid.gov.bc.ca/page.aspx/en/bpb/public-bid-opportunities';
const PORTAL_SOURCE = 'BC Bid';

async function scrapeBCBid({ page, maxItems = 80 }) {
  console.log('🔍 Starting BC Bid scrape...');
  const results = [];

  await page.goto(BASE_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(2000);

  await waitForAnySelector(page, [
    'table tbody tr a[href*="/page.aspx/en/bpm/doc"]',
    'table tbody tr'
  ]);

  const listItems = await page.$$eval(
    'table tbody tr',
    (rows, { portalSource }) => {
      const items = [];
      const seen = new Set();
      for (const row of rows) {
        const linkEl = row.querySelector('a[href*="/page.aspx/en/bpm/doc"]') || row.querySelector('a[href]');
        if (!linkEl) continue;
        const href = linkEl.getAttribute('href') || '';
        if (!href) continue;

        const url = href.startsWith('http') ? href : new URL(href, window.location.origin).toString();
        if (seen.has(url)) continue; seen.add(url);

        const title =
          linkEl.textContent.trim() ||
          row.querySelector('td:nth-child(2)')?.textContent.trim() || '';
        if (!title) continue;

        const agency =
          row.querySelector('td[data-title="Organization"]')?.textContent.trim() || '';

        const region = 'British Columbia';

        const created_at =
          row.querySelector('td[data-title="Published"]')?.textContent.trim() || '';

        const listing_expiry_date =
          row.querySelector('td[data-title="Closing Date"]')?.textContent.trim() || '';

        const project_reference =
          row.querySelector('td[data-title="Document Number"]')?.textContent.trim() || '';

        items.push({
          title,
          agency,
          region,
          created_at,
          listing_expiry_date,
          daysLeft: '',
          project_reference,
          portal_url: url,
          portal_source: portalSource
        });
      }
      return items;
    },
    { portalSource: PORTAL_SOURCE }
  );

  if (!listItems.length) {
    console.log('No BC Bid rows detected.');
    return results;
  }

  const sliced = listItems.slice(0, maxItems);

  for (const item of sliced) {
    try {
      console.log(`🔗 BC Bid Detail: ${item.portal_url}`);
      await page.goto(item.portal_url, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(1500);

      await waitForAnySelector(page, [
        '.bpContent', '.content', 'main'
      ]);

      const detailData = await page.evaluate(() => {
        const getByLabel = (labels) => {
          const wanted = Array.isArray(labels) ? labels : [labels];
          const rows = Array.from(document.querySelectorAll('tr, .field-row'));
          for (const row of rows) {
            const lEl = row.querySelector('th, .label') || row.firstElementChild;
            const vEl = row.querySelector('td:last-child, .value') || row.lastElementChild;
            const l = lEl?.textContent?.trim().toLowerCase() || '';
            const v = vEl?.textContent?.trim() || '';
            if (!l || !v) continue;
            if (wanted.some(w => l.includes(w.toLowerCase()))) return v;
          }
          return '';
        };

        const text = Array.from(document.querySelectorAll('.bpContent, .content, main, body'))
          .map(el => el.innerText || '').join('\n');

        let contact_person = '', contact_phone = '', contact_email = '';
        if (text) {
          const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
          const phone = text.match(/(\+?\d[\d\s().-]{7,}\d)/);
          contact_email = email ? email[0] : '';
          contact_phone = phone ? phone[0].trim() : '';
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          const nameLine =
            lines.find(l => /contact/i.test(l) && /\s/.test(l)) ||
            lines.find(l => /^[A-Za-z\s.'-]{5,}$/.test(l));
          if (nameLine) contact_person = nameLine.replace(/contact[:\s]*/i, '').trim();
        }

        const detailed_description =
          document.querySelector('.bpContent, .content, main, body')
            ?.innerText.trim().slice(0, 4000) || '';

        return {
          project_reference_detail:
            getByLabel(['document number', 'solicitation', 'opportunity id']) || '',
          buyer_organization_detail:
            getByLabel(['organization', 'ministry', 'owner']) || '',
          project_type:
            getByLabel(['type', 'procurement category']) || '',
          agreement_type:
            getByLabel(['agreement type', 'contract type']) || '',
          city: getByLabel(['city', 'location']) || '',
          contact_person,
          contact_phone,
          contact_email,
          detailed_description
        };
      });

      const merged = { ...item, ...detailData };
      const fp = generateFingerprint(
        `${merged.title}${merged.project_reference || ''}${merged.listing_expiry_date || ''}BCBid`
      );

      results.push({ id: fp, ...merged, hash_fingerprint: fp });
      await page.waitForTimeout(300);
    } catch (err) {
      console.warn(`⚠️ BC Bid detail failed: ${err.message}`);
      const fp = generateFingerprint(
        `${item.title}${item.project_reference || ''}${item.listing_expiry_date || ''}BCBid`
      );
      results.push({
        id: fp,
        ...item,
        project_reference_detail: item.project_reference || '',
        detailed_description: 'Partial metadata captured.',
        hash_fingerprint: fp
      });
    }
  }

  console.log(`🏁 BC Bid scrape complete with ${results.length} records.`);
  return results;
}

async function waitForAnySelector(page, selectors, timeout) {
  const start = Date.now();
  const limit = timeout || 60000;
  while (Date.now() - start < limit) {
    for (const s of selectors) {
      const el = await page.$(s);
      if (el) return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`None of expected selectors appeared: ${selectors.join(', ')}`);
}

module.exports = { scrapeBCBid };
