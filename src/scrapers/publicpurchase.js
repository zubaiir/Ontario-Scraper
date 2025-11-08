const { generateFingerprint } = require('../utils');

/**
 * PublicPurchase Family Scraper
 *
 * Handles:
 *   https://www.publicpurchase.com/gems/{tenant}/.../bids
 */

function deriveTargetsFromSources(sources = []) {
  const targets = [];
  const seen = new Set();

  for (const s of sources) {
    if (!s || !s.url) continue;
    try {
      const u = new URL(s.url);
      if (!u.hostname.endsWith('publicpurchase.com')) continue;
      const m = u.pathname.match(/\/gems\/([^/]+)/i);
      if (!m) continue;
      const tenant = m[1];
      const base = `${u.protocol}//${u.hostname}/gems/${tenant}`;
      if (seen.has(base)) continue;
      seen.add(base);
      targets.push({
        key: `publicpurchase-${tenant}`,
        label: `PublicPurchase - ${tenant}`,
        listUrl: `${base}/public/bids`
      });
    } catch {}
  }

  if (!targets.length) {
    targets.push({
      key: 'publicpurchase-generic',
      label: 'PublicPurchase - Generic',
      listUrl: 'https://www.publicpurchase.com/gems/register/public/bids'
    });
  }

  return targets;
}

async function scrapePublicPurchase({ page, sources = [], maxItems = 80 }) {
  console.log('🔍 Starting PublicPurchase family scrape...');
  const targets = deriveTargetsFromSources(sources);
  const results = [];
  const perPortalLimit = Math.max(5, Math.floor(maxItems / targets.length));

  for (const target of targets) {
    if (results.length >= maxItems) break;
    console.log(`➡️ PublicPurchase tenant: ${target.label}`);

    try {
      await page.goto(target.listUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForTimeout(2000);

      await waitForAnySelector(page, ['table tbody tr', 'table tbody tr a']);

      const listItems = await page.$$eval(
        'table tbody tr',
        (rows, { portalLabel }) => {
          const items = [];
          const seen = new Set();
          for (const row of rows) {
            const linkEl = row.querySelector('a[href]');
            if (!linkEl) continue;
            const href = linkEl.getAttribute('href') || '';
            if (!href) continue;
            const url = href.startsWith('http')
              ? href
              : new URL(href, window.location.origin).toString();
            if (seen.has(url)) continue; seen.add(url);

            const title =
              linkEl.textContent.trim() ||
              row.querySelector('td:nth-child(2)')?.textContent.trim() || '';
            if (!title) continue;

            const agency =
              row.querySelector('td:nth-child(1)')?.textContent.trim() || '';

            const region =
              row.querySelector('td[data-title="Location"]')
                ?.textContent.trim() || '';

            const created_at =
              row.querySelector('td[data-title="Release Date"], td[data-title="Posted"]')
                ?.textContent.trim() || '';

            const listing_expiry_date =
              row.querySelector('td[data-title="Due Date"], td[data-title="Closing"]')
                ?.textContent.trim() || '';

            const project_reference =
              row.querySelector('td[data-title="Bid #"], td[data-title="Number"]')
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
              portal_source: portalLabel
            });
          }
          return items;
        },
        { portalLabel: target.label }
      );

      if (!listItems.length) {
        console.log(`No PublicPurchase rows for ${target.label}`);
        continue;
      }

      const sliced = listItems.slice(0, perPortalLimit);

      for (const item of sliced) {
        if (results.length >= maxItems) break;
        try {
          console.log(`🔗 PublicPurchase Detail: ${item.portal_url}`);
          await page.goto(item.portal_url, { waitUntil: 'domcontentloaded', timeout: 120000 });
          await page.waitForTimeout(1500);
          await waitForAnySelector(page, ['.content', 'table', 'main', 'body']);

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
                getByLabel(['bid #', 'solicitation', 'number', 'reference']) || '',
              buyer_organization_detail:
                getByLabel(['agency', 'organization', 'buyer']) || '',
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
            `${merged.title}${merged.project_reference || ''}${merged.listing_expiry_date || ''}${target.key}`
          );
          results.push({ id: fp, ...merged, hash_fingerprint: fp });
          await page.waitForTimeout(300);
        } catch (err) {
          console.warn(`⚠️ PublicPurchase detail failed: ${err.message}`);
          const fp = generateFingerprint(
            `${item.title}${item.project_reference || ''}${item.listing_expiry_date || ''}${target.key}`
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
    } catch (err) {
      console.warn(`⚠️ PublicPurchase list failed for ${target.label}: ${err.message}`);
    }
  }

  console.log(`🏁 PublicPurchase scrape complete with ${results.length} records.`);
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

module.exports = { scrapePublicPurchase };
