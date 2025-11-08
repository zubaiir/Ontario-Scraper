const { generateFingerprint } = require('../utils');

const PORTAL_FAMILY_TARGETS = [
  {
    key: 'bonfire-generic',
    label: 'Bonfire - Generic',
    urlKeyword: 'bonfirehub',
    listUrl: 'https://bonfirehub.ca/opportunities',
  },
];

async function scrapeBonfire({ page, maxItems = 80 }) {
  console.log('🔍 Starting Bonfire family scrape...');

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
        'table tbody tr a[href*="/opportunities/"]',
        '.opportunity-table tbody tr',
        '.opportunity-list-item',
      ]);

      const listItems = await page.$$eval(
        [
          'table tbody tr',
          '.opportunity-table tbody tr',
          '.opportunity-list-item',
        ].join(','),
        (rows, { portalLabel }) => {
          const items = [];

          for (const row of rows) {
            const linkEl =
              row.querySelector('a[href*="/opportunities/"]') ||
              row.querySelector('a[href*="/portal/opportunities/"]');
            if (!linkEl) continue;

            const href = linkEl.getAttribute('href') || '';
            if (!href) continue;

            const portal_url = href.startsWith('http')
              ? href
              : new URL(href, window.location.origin).toString();

            const title =
              row.querySelector('.opportunity-title, .title, td:nth-child(1)')
                ?.textContent.trim() ||
              linkEl.textContent.trim() ||
              '';

            if (!title) continue;

            const agency =
              row.querySelector(
                '.opportunity-org, .organization, td[data-title="Organization"]'
              )?.textContent.trim() || '';

            const region =
              row.querySelector(
                '.opportunity-location, .location, td[data-title="Location"]'
              )?.textContent.trim() || '';

            const created_at =
              row.querySelector(
                'td[data-title="Open Date"], td[data-title="Posted"], .open-date'
              )?.textContent.trim() || '';

            const listing_expiry_date =
              row.querySelector(
                'td[data-title="Close Date"], td[data-title="Closing"], .close-date'
              )?.textContent.trim() || '';

            const daysLeft =
              row.querySelector('.days-left')?.textContent.trim() || '';

            const project_reference =
              row.querySelector(
                'td[data-title="Reference"], td[data-title="ID"], .reference'
              )?.textContent.trim() || '';

            items.push({
              title,
              agency,
              region,
              created_at,
              listing_expiry_date,
              daysLeft,
              project_reference,
              portal_url,
              portal_source: portalLabel,
            });
          }

          return items;
        },
        { portalLabel: target.label }
      );

      if (!listItems || listItems.length === 0) {
        console.log(`No opportunities found for ${target.label}`);
        continue;
      }

      console.log(
        `Found ${listItems.length} items for ${target.label} (capping at ${perPortalLimit}).`
      );

      const sliced = listItems.slice(0, perPortalLimit);

      for (const item of sliced) {
        if (results.length >= maxItems) break;

        try {
          console.log(`🔗 Opening: ${item.portal_url}`);
          await page.goto(item.portal_url, {
            waitUntil: 'domcontentloaded',
            timeout: 120000,
          });

          await page.waitForTimeout(1500);

          await waitForAnySelector(page, [
            '.opportunity-details',
            '.opportunity-show',
            '.content',
            'main',
          ]);

          const detailData = await page.evaluate(() => {
            const getByLabel = (labels) => {
              const wanted = Array.isArray(labels) ? labels : [labels];
              const rows = Array.from(
                document.querySelectorAll(
                  '.opportunity-details-row, tr, .field-row'
                )
              );

              for (const row of rows) {
                const labelEl =
                  row.querySelector('.label, th') || row.firstElementChild;
                const valueEl =
                  row.querySelector('.value, td:last-child') ||
                  row.lastElementChild;

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
                '.opportunity-details, .content, main'
              )
            )
              .map((el) => el.innerText || '')
              .join('\n');

            let contact_email = '';
            let contact_phone = '';
            let contact_person = '';

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
                lines.find(
                  (l) => /contact/i.test(l) && /\s/.test(l)
                ) ||
                lines.find(
                  (l) => /^[A-Za-z\s.'-]{5,}$/.test(l)
                );

              if (nameLine) {
                contact_person = nameLine
                  .replace(/contact[:\s]*/i, '')
                  .trim();
              }
            }

            const detailed_description =
              document.querySelector(
                '.opportunity-description, .content, main'
              )?.innerText
                .trim()
                .slice(0, 4000) || '';

            return {
              project_reference_detail:
                getByLabel([
                  'Reference',
                  'Solicitation',
                  'Project ID',
                  'Number',
                ]) || '',
              buyer_organization_detail:
                getByLabel([
                  'Organization',
                  'Agency',
                  'Owner',
                  'Department',
                ]) || '',
              project_type:
                getByLabel([
                  'Type',
                  'Procurement Type',
                  'Category',
                ]) || '',
              agreement_type:
                getByLabel([
                  'Agreement Type',
                  'Contract Type',
                ]) || '',
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
            `⚠️ Detail parse failed for ${item.portal_url}: ${detailErr.message}`
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
              'Partial metadata captured from listing. Detailed fields may require login or manual review.',
            hash_fingerprint: fp,
          });
        }
      }
    } catch (err) {
      console.warn(`⚠️ Failed for ${target.label}: ${err.message}`);
      continue;
    }
  }

  console.log(`\n🏁 Bonfire scrape complete with ${results.length} records.`);
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
    `None of expected selectors appeared. Tried: ${selectors.join(', ')}`
  );
}

module.exports = { scrapeBonfire };
