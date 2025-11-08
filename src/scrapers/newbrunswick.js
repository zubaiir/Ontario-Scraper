const { generateFingerprint } = require('../utils');

/**
 * New Brunswick Opportunities Scraper
 *
 * Typical:
 *   https://www2.gnb.ca/ (tenders/opportunities listing)
 */

const BASE_LIST_URL = 'https://www2.gnb.ca/';
const PORTAL_SOURCE = 'New Brunswick Opportunities';

async function scrapeNewBrunswick({ page, maxItems = 40 }) {
  console.log('🔍 Starting New Brunswick Opportunities scrape...');
  const results = [];

  await page.goto(BASE_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(2000);

  await waitForAnySelector(page, ['table tbody tr a', 'table tbody tr']).catch(() => {
    console.log('Listing layout not found; returning empty for dummy coverage.');
  });

  const listItems = await page.$$eval(
    'table tbody tr',
    (rows, { portalSource }) => {
      const items = [];
      const seen = new Set();
      for (const row of rows) {
        const linkEl = row.querySelector('a[href]'); if (!linkEl) continue;
        const href = linkEl.getAttribute('href') || ''; if (!href) continue;
        const url = href.startsWith('http') ? href : new URL(href, window.location.origin).toString();
        if (seen.has(url)) continue; seen.add(url);

        const title =
          linkEl.textContent.trim() ||
          row.querySelector('td:nth-child(1)')?.textContent.trim() || '';
        if (!title) continue;

        const agency =
          row.querySelector('td[data-title="Department"], td[data-title="Agency"]')
            ?.textContent.trim() || '';

        const region = 'New Brunswick';

        const created_at =
          row.querySelector('td[data-title="Issue Date"], td[data-title="Posted"]')
            ?.textContent.trim() || '';

        const listing_expiry_date =
          row.querySelector('td[data-title="Closing Date"], td[data-title="Close Date"]')
            ?.textContent.trim() || '';

        const project_reference =
          row.querySelector('td[data-title="Reference"], td[data-title="Tender #"]')
            ?.textContent.trim() || '';

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
    console.log('No NB tenders detected (safe dummy).');
    return results;
  }

  const sliced = listItems.slice(0, maxItems);

  for (const item of sliced) {
    try {
      console.log(`🔗 NB Detail: ${item.portal_url}`);
      await page.goto(item.portal_url, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(1500);
      await waitForAnySelector(page, ['.content', 'table', 'main']);

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

        const text = Array.from(document.querySelectorAll('.content, main, body'))
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
          document.querySelector('.content, main, body')
            ?.innerText.trim().slice(0, 4000) || '';

        return {
          project_reference_detail:
            getByLabel(['reference', 'tender #', 'solicitation']) || '',
          buyer_organization_detail:
            getByLabel(['department', 'agency', 'organization']) || '',
          project_type:
            getByLabel(['type', 'category']) || '',
          agreement_type:
            getByLabel(['contract type', 'agreement type']) || '',
          city: getByLabel(['city', 'location']) || '',
          contact_person,
          contact_phone,
          contact_email,
          detailed_description
        };
      });

      const merged = { ...item, ...detailData };
      const fp = generateFingerprint(
        `${merged.title}${merged.project_reference || ''}${merged.listing_expiry_date || ''}NB`
      );
      results.push({ id: fp, ...merged, hash_fingerprint: fp });
      await page.waitForTimeout(300);
    } catch (err) {
      console.warn(`⚠️ NB detail failed: ${err.message}`);
      const fp = generateFingerprint(
        `${item.title}${item.project_reference || ''}${item.listing_expiry_date || ''}NB`
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

  console.log(`🏁 New Brunswick scrape complete with ${results.length} records.`);
  return results;
}

async function waitForAnySelector(page, selectors, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const s of selectors) {
      const el = await page.$(s);
      if (el) return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`None of expected selectors appeared: ${selectors.join(', ')}`);
}

module.exports = { scrapeNewBrunswick };
