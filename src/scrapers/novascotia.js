const { generateFingerprint } = require('../utils');

/**
 * Nova Scotia Procurement Scraper
 *
 * Typical:
 *   https://procurement.novascotia.ca/tender-opportunities.aspx
 */

const BASE_LIST_URL = 'https://procurement.novascotia.ca/tender-opportunities.aspx';
const PORTAL_SOURCE = 'Nova Scotia Procurement';

async function scrapeNovaScotia({ page, maxItems = 80 }) {
  console.log('🔍 Starting Nova Scotia Procurement scrape...');
  const results = [];

  await page.goto(BASE_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(2000);

  await waitForAnySelector(page, [
    'table tbody tr a',
    '.tender-list table tbody tr'
  ]);

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
          row.querySelector('td[data-title="Department"], td[data-title="Agency"]')?.textContent.trim() || '';

        const region = 'Nova Scotia';

        const created_at =
          row.querySelector('td[data-title="Issue Date"], td[data-title="Posted"]')?.textContent.trim() || '';

        const listing_expiry_date =
          row.querySelector('td[data-title="Closing Date"], td[data-title="Close Date"]')?.textContent.trim() || '';

        const project_reference =
          row.querySelector('td[data-title="Tender No."], td[data-title="Reference"]')
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
    console.log('No Nova Scotia tenders detected.');
    return results;
  }

  const sliced = listItems.slice(0, maxItems);

  for (const item of sliced) {
    try {
      console.log(`🔗 NS Detail: ${item.portal_url}`);
      await page.goto(item.portal_url, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(1500);
      await waitForAnySelector(page, ['.content', 'table', 'main']);

      const detailData = await page.evaluate(() => {
        const getByLabel = (labels) => {
          const wanted = Array.isArray(labels) ? labels : [labels];
          const rows = Array.from(document.querySelectorAll('tr, .field-row'));
          for (const row of rows) {
            const labelEl = row.querySelector('th, .label') || row.firstElementChild;
            const valueEl = row.querySelector('td:last-child, .value') || row.lastElementChild;
            const l = labelEl?.textContent?.trim().toLowerCase() || '';
            const v = valueEl?.textContent?.trim() || '';
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
          document.querySelector('.content, main, body')?.innerText.trim().slice(0, 4000) || '';

        return {
          project_reference_detail:
            getByLabel(['tender no', 'reference', 'solicitation']) || '',
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
        `${merged.title}${merged.project_reference || ''}${merged.listing_expiry_date || ''}NovaScotia`
      );

      results.push({ id: fp, ...merged, hash_fingerprint: fp });
      await page.waitForTimeout(300);
    } catch (err) {
      console.warn(`⚠️ NS detail failed: ${err.message}`);
      const fp = generateFingerprint(
        `${item.title}${item.project_reference || ''}${item.listing_expiry_date || ''}NovaScotia`
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

  console.log(`🏁 Nova Scotia scrape complete with ${results.length} records.`);
  return results;
}

async function waitForAnySelector(page, selectors, timeout = 60000) {
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

module.exports = { scrapeNovaScotia };
