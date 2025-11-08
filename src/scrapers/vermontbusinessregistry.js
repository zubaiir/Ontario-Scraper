const { generateFingerprint } = require('../utils');

const BASE_LIST_URL = 'https://www.vermontbusinessregistry.com/BidSearch.aspx';
const PORTAL_SOURCE = 'Vermont Business Registry';

async function scrapeVermontBusinessRegistry({ page, maxItems = 50 }) {
  console.log('🔍 Starting Vermont Business Registry scrape...');

  const results = [];

  await page.goto(BASE_LIST_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(2000);

  await waitForAnySelector(page, [
    'table tbody tr a[href*="BidDisplay.aspx"]',
    'table tbody tr',
  ]);

  const listItems = await page.$$eval(
    'table tbody tr',
    (rows, { portalSource }) => {
      const items = [];
      const seen = new Set();

      for (const row of rows) {
        const linkEl =
          row.querySelector('a[href*="BidDisplay.aspx"]') ||
          row.querySelector('a[href*="Bid"]') ||
          row.querySelector('a');
        if (!linkEl) continue;

        const href = linkEl.getAttribute('href') || '';
        if (!href) continue;

        const url = href.startsWith('http')
          ? href
          : new URL(href, window.location.origin).toString();

        if (seen.has(url)) continue;
        seen.add(url);

        const title =
          linkEl.textContent.trim() ||
          row.querySelector('td:nth-child(1)')?.textContent.trim() ||
          '';
        if (!title) continue;

        const agency =
          row.querySelector(
            'td[data-title="Agency"], td[data-title="Department"]'
          )?.textContent.trim() || '';

        const region = 'Vermont'; // stable enough for dummy purposes

        const created_at =
          row.querySelector(
            'td[data-title="Open Date"], td[data-title="Posted"]'
          )?.textContent.trim() || '';

        const listing_expiry_date =
          row.querySelector(
            'td[data-title="Close Date"], td[data-title="Closing"]'
          )?.textContent.trim() || '';

        const project_reference =
          row.querySelector(
            'td[data-title="Bid ID"], td[data-title="Reference"]'
          )?.textContent.trim() || '';

        items.push({
          title,
          agency,
          region,
          created_at,
          listing_expiry_date,
          daysLeft: '',
          project_reference,
          portal_url: url,
          portal_source: portalSource,
        });
      }

      return items;
    },
    { portalSource: PORTAL_SOURCE }
  );

  if (!listItems.length) {
    console.log('No rows detected for Vermont Business Registry.');
    return results;
  }

  const sliced = listItems.slice(0, maxItems);

  for (const item of sliced) {
    try {
      console.log(`🔗 Detail: ${item.portal_url}`);
      await page.goto(item.portal_url, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });
      await page.waitForTimeout(1500);

      await waitForAnySelector(page, [
        '.content',
        'table',
        'main',
      ]);

      const detailData = await page.evaluate(() => {
        const getByLabel = (labels) => {
          const wanted = Array.isArray(labels) ? labels : [labels];
          const rows = Array.from(document.querySelectorAll('tr'));
          for (const row of rows) {
            const labelEl = row.querySelector('th, .label') || row.firstElementChild;
            const valueEl =
              row.querySelector('td:last-child, .value') || row.lastElementChild;

            const labelText =
              labelEl?.textContent?.trim().toLowerCase() || '';
            const valueText = valueEl?.textContent?.trim() || '';
            if (!labelText || !valueText) continue;

            if (
              wanted.some((w) =>
                labelText.includes(w.toLowerCase())
              )
            ) {
              return valueText;
            }
          }
          return '';
        };

        const text = Array.from(
          document.querySelectorAll('.content, main, body')
        )
          .map((el) => el.innerText || '')
          .join('\n');

        let contact_person = '';
        let contact_phone = '';
        let contact_email = '';

        if (text) {
          const emailMatch = text.match(
            /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
          );
          const phoneMatch = text.match(
            /(\+?\d[\d\s().-]{7,}\d)/
          );
          contact_email = emailMatch ? emailMatch[0] : '';
          contact_phone = phoneMatch ? phoneMatch[0].trim() : '';

          const lines = text
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
          const nameLine =
            lines.find((l) => /contact/i.test(l) && /\s/.test(l)) ||
            lines.find((l) => /^[A-Za-z\s.'-]{5,}$/.test(l));
          if (nameLine) {
            contact_person = nameLine
              .replace(/contact[:\s]*/i, '')
              .trim();
          }
        }

        const detailed_description =
          document.querySelector('.content, main, body')
            ?.innerText.trim().slice(0, 4000) || '';

        return {
          project_reference_detail:
            getByLabel(['Bid ID', 'Reference', 'Solicitation']) || '',
          buyer_organization_detail:
            getByLabel(['Agency', 'Department', 'Organization']) || '',
          project_type:
            getByLabel(['Type', 'Category']) || '',
          agreement_type:
            getByLabel(['Contract Type', 'Agreement Type']) || '',
          city: getByLabel(['City', 'Location']) || '',
          contact_person,
          contact_phone,
          contact_email,
          detailed_description,
        };
      });

      const merged = { ...item, ...detailData };
      const fp = generateFingerprint(
        `${merged.title}${merged.project_reference || ''}${
          merged.listing_expiry_date || ''
        }VermontBusinessRegistry`
      );

      results.push({
        id: fp,
        ...merged,
        hash_fingerprint: fp,
      });

      console.log(`✅ Captured: ${merged.title}`);
      await page.waitForTimeout(300);
    } catch (err) {
      console.warn(
        `⚠️ Detail failed for ${item.portal_url}: ${err.message}`
      );
      const fp = generateFingerprint(
        `${item.title}${item.project_reference || ''}${
          item.listing_expiry_date || ''
        }VermontBusinessRegistry`
      );
      results.push({
        id: fp,
        ...item,
        project_reference_detail: item.project_reference || '',
        detailed_description:
          'Partial metadata captured from listing.',
        hash_fingerprint: fp,
      });
    }
  }

  console.log(
    `\n🏁 Vermont Business Registry scrape complete with ${results.length} records.`
  );
  return results;
}

async function waitForAnySelector(page, selectors, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `None of expected selectors appeared: ${selectors.join(', ')}`
  );
}

module.exports = { scrapeVermontBusinessRegistry };
