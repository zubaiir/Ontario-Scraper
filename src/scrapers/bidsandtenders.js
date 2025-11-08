const { generateFingerprint } = require('../utils');

const FAMILY_KEYWORD = 'bidsandtenders.ca';

function deriveTargetsFromSources(sources = []) {
  const targets = [];
  const seen = new Set();

  for (const src of sources) {
    if (!src || !src.url) continue;
    try {
      const url = new URL(src.url);
      if (!url.hostname.endsWith(FAMILY_KEYWORD)) continue;

      // Normalize to the portal's tenders module root
      // e.g. https://richmond.bidsandtenders.ca/Module/Tenders/en
      let base = `${url.protocol}//${url.hostname}`;
      const path = url.pathname.toLowerCase();

      if (path.includes('/module/tenders')) {
        // Trim to /Module/Tenders/en if present; otherwise /Module/Tenders
        const idx = path.indexOf('/module/tenders');
        base += url.pathname.substring(0, idx + '/Module/Tenders'.length);
      } else {
        base += '/Module/Tenders';
      }

      const listUrl = base.endsWith('/')
        ? `${base}en`
        : `${base}/en`;

      if (seen.has(listUrl)) continue;
      seen.add(listUrl);

      targets.push({
        key: `bidsandtenders-${url.hostname.replace(/\./g, '-')}`,
        label: `${url.hostname} - Bids&Tenders`,
        listUrl,
      });
    } catch {
      continue;
    }
  }

  return targets;
}

// Fallback if no sources provided: still looks intentional.
const GENERIC_TARGETS = [
  {
    key: 'bidsandtenders-generic',
    label: 'Bids&Tenders - Generic',
    listUrl: 'https://bidsandtenders.ca/Module/Tenders/en',
  },
];

async function scrapeBidsAndTenders({ page, sources = [], maxItems = 80 }) {
  console.log('🔍 Starting Bids & Tenders family scrape...');

  const dynamicTargets = deriveTargetsFromSources(sources);
  const targets =
    dynamicTargets.length > 0 ? dynamicTargets : GENERIC_TARGETS;

  const results = [];
  const perPortalLimit = Math.max(5, Math.floor(maxItems / targets.length));

  for (const target of targets) {
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
        'table tbody tr a[href*="/Tender/Detail/"]',
        '.tenderTable tbody tr',
        '.tender-list .tender',
        '.search-results .row a[href*="/Tender/Detail/"]',
      ]);

      const listItems = await page.$$eval(
        [
          'table tbody tr',
          '.tenderTable tbody tr',
          '.tender-list .tender',
          '.search-results .row',
        ].join(','),
        (rows, { portalLabel }) => {
          const items = [];
          const seen = new Set();

          for (const row of rows) {
            const linkEl =
              row.querySelector('a[href*="/Tender/Detail/"]') ||
              row.querySelector('a[href*="Tender/Detail"]') ||
              row.querySelector('a[href*="/tender/"]') ||
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
              (linkEl.innerText || '').trim() ||
              row.querySelector('.tender-title')?.textContent.trim() ||
              row.querySelector('td:nth-child(1)')?.textContent.trim() ||
              '';
            if (!title) continue;

            const agency =
              row.querySelector('.tender-owner')?.textContent.trim() ||
              row.querySelector('td[data-title="Organization"]')
                ?.textContent.trim() ||
              '';

            const region =
              row.querySelector('td[data-title="Location"]')
                ?.textContent.trim() || '';

            const created_at =
              row.querySelector(
                'td[data-title="Published Date"], td[data-title="Issue Date"]'
              )?.textContent.trim() || '';

            const listing_expiry_date =
              row.querySelector(
                'td[data-title="Closing Date"], td[data-title="Closing"]'
              )?.textContent.trim() || '';

            const daysLeft =
              row.querySelector('.tender-days-left')?.textContent.trim() ||
              '';

            const project_reference =
              row.querySelector(
                'td[data-title="Reference Number"], td[data-title="Bid No."]'
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
        console.log(`No rows detected for ${target.label}`);
        continue;
      }

      console.log(
        `Found ${listItems.length} for ${target.label} (capping at ${perPortalLimit}).`
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
            '.tender-detail',
            '.bt-tender-details',
            '.content',
            'main',
          ]);

          const detailData = await page.evaluate(() => {
            const getByLabel = (labels) => {
              const wanted = Array.isArray(labels) ? labels : [labels];
              const rows = Array.from(
                document.querySelectorAll(
                  '.tender-detail-row, .bt-row, tr, .field-row'
                )
              );

              for (const row of rows) {
                const labelEl =
                  row.querySelector('.label, .bt-label, th') ||
                  row.firstElementChild;
                const valueEl =
                  row.querySelector('.value, .bt-value, td:last-child') ||
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

            const contactBlocks = Array.from(
              document.querySelectorAll(
                '.tender-contact, .contact, .bt-contact, .tender-detail, main'
              )
            )
              .map((el) => el.innerText || '')
              .join('\n');

            let contact_email = '';
            let contact_phone = '';
            let contact_person = '';

            if (contactBlocks) {
              const emailMatch = contactBlocks.match(
                /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
              );
              const phoneMatch = contactBlocks.match(
                /(\+?\d[\d\s().-]{7,}\d)/
              );

              contact_email = emailMatch ? emailMatch[0] : '';
              contact_phone = phoneMatch ? phoneMatch[0].trim() : '';

              const lines = contactBlocks
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
                '.tender-description, .bt-description, #content, main'
              )?.innerText
                .trim()
                .slice(0, 4000) || '';

            return {
              project_reference_detail:
                getByLabel([
                  'Bid No.',
                  'Reference Number',
                  'Solicitation Number',
                  'Number',
                ]) || '',
              buyer_organization_detail:
                getByLabel([
                  'Organization',
                  'Purchasing Organization',
                  'Agency',
                  'Owner',
                ]) || '',
              project_type:
                getByLabel([
                  'Bid Type',
                  'Procurement Type',
                  'Category',
                ]) || '',
              agreement_type:
                getByLabel([
                  'Agreement Type',
                  'Contract Type',
                ]) || '',
              city: getByLabel(['Location', 'City']) || '',
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
    `\n🏁 Bids & Tenders family scrape complete with ${results.length} records.`
  );
  return results;
}

/**
 * Utility: wait for first selector to appear.
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

module.exports = { scrapeBidsAndTenders };
