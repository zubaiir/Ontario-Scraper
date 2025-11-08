const { generateFingerprint } = require('../utils');

const PORTAL_FAMILY_TARGETS = [
  {
    key: 'bidnetdirect-open-bids',
    label: 'BidNet Direct - Open Bids',
    urlKeyword: 'bidnetdirect.com/solicitations/open-bids',
    listUrl: 'https://www.bidnetdirect.com/solicitations/open-bids',
  },
  // Region / state-level entry points from your CSV; harmless if layout shifts.
  {
    key: 'bidnetdirect-connecticut',
    label: 'BidNet Direct - Connecticut',
    urlKeyword: 'bidnetdirect.com/connecticut',
    listUrl: 'https://www.bidnetdirect.com/connecticut',
  },
  {
    key: 'bidnetdirect-maine',
    label: 'BidNet Direct - Maine',
    urlKeyword: 'bidnetdirect.com/maine',
    listUrl: 'https://www.bidnetdirect.com/maine',
  },
  {
    key: 'bidnetdirect-new-hampshire',
    label: 'BidNet Direct - New Hampshire',
    urlKeyword: 'bidnetdirect.com/new-hampshire',
    listUrl: 'https://www.bidnetdirect.com/new-hampshire',
  },
  {
    key: 'bidnetdirect-vermont',
    label: 'BidNet Direct - Vermont',
    urlKeyword: 'bidnetdirect.com/vermont',
    listUrl: 'https://www.bidnetdirect.com/vermont',
  },
];

async function scrapeBidNetDirect({ page, maxItems = 80 }) {
  console.log('🔍 Starting BidNet Direct family scrape...');

  const results = [];
  const perPortalLimit = Math.max(5, Math.floor(maxItems / PORTAL_FAMILY_TARGETS.length));

  for (const target of PORTAL_FAMILY_TARGETS) {
    if (results.length >= maxItems) break;
    console.log(`\n➡️ Scraping: ${target.label}`);

    try {
      await page.goto(target.listUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });

      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForTimeout(2000);

      await waitForAnySelector(page, [
        'table tbody tr a[href*="/public/solicitations/"]',
        'a[href*="/public/solicitations/"][data-automation]',
        '.solicitations-table tbody tr',
        '.search-results table tbody tr',
      ]);

      const listItems = await page.$$eval(
        [
          '.solicitations-table tbody tr',
          '.search-results table tbody tr',
          'table tbody tr',
        ].join(','),
        (rows, { portalLabel }) => {
          const items = [];
          const seen = new Set();

          for (const row of rows) {
            const linkEl =
              row.querySelector('a[href*="/public/solicitations/"]') ||
              row.querySelector('a[href*="/solicitations/"]');
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
              row.querySelector('.solicitation-title, td:nth-child(1)')
                ?.textContent.trim() ||
              '';
            if (!title) continue;

            const agency =
              row.querySelector(
                '.solicitation-agency, td[data-title="Agency"], td[data-title="Organization"]'
              )?.textContent.trim() || '';

            const region =
              row.querySelector(
                '.solicitation-region, td[data-title="Location"]'
              )?.textContent.trim() || '';

            const created_at =
              row.querySelector(
                'td[data-title="Publication Date"], td[data-title="Posted"], .posted-date'
              )?.textContent.trim() || '';

            const listing_expiry_date =
              row.querySelector(
                'td[data-title="Bid Due Date"], td[data-title="Due Date"], .due-date'
              )?.textContent.trim() || '';

            const daysLeft =
              row.querySelector('.days-left')?.textContent.trim() || '';

            const project_reference =
              row.querySelector(
                'td[data-title="Bid Number"], td[data-title="Reference"], .solicitation-number'
              )?.textContent.trim() || '';

            items.push({
              title,
              agency,
              region,
              created_at,
              listing_expiry_date,
              daysLeft,
              project_reference,
              portal_url: url,
              portal_source: portalLabel,
            });
          }

          return items;
        },
        { portalLabel: target.label }
      );

      if (!listItems.length) {
        console.log(`No rows found for ${target.label}`);
        continue;
      }

      console.log(
        `Found ${listItems.length} items for ${target.label} (capping at ${perPortalLimit}).`
      );

      const sliced = listItems.slice(0, perPortalLimit);

      for (const item of sliced) {
        if (results.length >= maxItems) break;
        try {
          console.log(`🔗 Detail: ${item.portal_url}`);
          await page.goto(item.portal_url, {
            waitUntil: 'domcontentloaded',
            timeout: 120000,
          });

          await page.waitForTimeout(1500);

          await waitForAnySelector(page, [
            '.solicitation-details',
            '.content',
            'main',
          ]);

          const detailData = await page.evaluate(() => {
            const getByLabel = (labels) => {
              const wanted = Array.isArray(labels) ? labels : [labels];
              const rows = Array.from(
                document.querySelectorAll(
                  '.solicitation-details tr, tr, .field-row'
                )
              );
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
              document.querySelectorAll(
                '.solicitation-details, .content, main'
              )
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
              document.querySelector(
                '.solicitation-description, .content, main'
              )?.innerText
                .trim()
                .slice(0, 4000) || '';

            return {
              project_reference_detail:
                getByLabel([
                  'Bid Number',
                  'Solicitation Number',
                  'Reference',
                  'RFP Number',
                ]) || '',
              buyer_organization_detail:
                getByLabel([
                  'Agency',
                  'Organization',
                  'Owner',
                  'Department',
                ]) || '',
              project_type:
                getByLabel(['Type', 'Category', 'Procurement Type']) ||
                '',
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
            }${target.key}`
          );

          results.push({
            id: fp,
            ...merged,
            hash_fingerprint: fp,
          });

          console.log(`✅ Captured: ${merged.title}`);
          await page.waitForTimeout(400);
        } catch (detailErr) {
          console.warn(
            `⚠️ Detail failed for ${item.portal_url}: ${detailErr.message}`
          );
          const fp = generateFingerprint(
            `${item.title}${item.project_reference || ''}${
              item.listing_expiry_date || ''
            }${target.key}`
          );
          results.push({
            id: fp,
            ...item,
            project_reference_detail: item.project_reference || '',
            detailed_description:
              'Partial metadata captured from listing. Some information may require login or manual review.',
            hash_fingerprint: fp,
          });
        }
      }
    } catch (err) {
      console.warn(`⚠️ Failed for ${target.label}: ${err.message}`);
      continue;
    }
  }

  console.log(
    `\n🏁 BidNet Direct scrape complete with ${results.length} records.`
  );
  return results;
}

/**
 * Wait for first matching selector across multiple options.
 */
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
    `None of the expected selectors appeared: ${selectors.join(', ')}`
  );
}

module.exports = { scrapeBidNetDirect };
