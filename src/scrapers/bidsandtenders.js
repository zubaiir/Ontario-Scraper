const { generateFingerprint } = require('../utils');

/**
 * Bids & Tenders Family Scraper
 *
 * Portals:
 * - https://nlhydro.bidsandtenders.ca/Module/Tenders/
 * - https://mississauga.bidsandtenders.ca/Module/Tenders/
 * - https://rmwb.bidsandtenders.ca/Module/Tenders/en/
 * - https://saskatoon.bidsandtenders.ca/Module/Tenders/
 * - https://stjohns.bidsandtenders.ca/Module/Tenders/
 */

const PORTALS = [
  {
    key: 'nlhydro',
    label: 'Bids&Tenders - NL Hydro',
    listUrl: 'https://nlhydro.bidsandtenders.ca/Module/Tenders/en/',
    regionHint: 'NL',
  },
  {
    key: 'mississauga',
    label: 'Bids&Tenders - Mississauga',
    listUrl: 'https://mississauga.bidsandtenders.ca/Module/Tenders/',
    regionHint: 'ON',
  },
  {
    key: 'rmwb',
    label: 'Bids&Tenders - RMWB',
    listUrl: 'https://rmwb.bidsandtenders.ca/Module/Tenders/en/',
    regionHint: 'AB',
  },
  {
    key: 'saskatoon',
    label: 'Bids&Tenders - Saskatoon',
    listUrl: 'https://saskatoon.bidsandtenders.ca/Module/Tenders/en/',
    regionHint: 'SK',
  },
  {
    key: 'stjohns',
    label: 'Bids&Tenders - St. John's',
    listUrl: 'https://stjohns.bidsandtenders.ca/Module/Tenders/en/',
    regionHint: 'NL',
  },
];

const PER_PORTAL_LIMIT = 5; // Max bids to scrape per Bids&Tenders portal

async function scrapeBidsAndTenders({ page, maxItems = 50 }) {
  console.log('=== Bids & Tenders Family Scraper Started ===');
  console.log(`Target portals: ${PORTALS.map(p => p.key).join(', ')}`);
  console.log(`Max items: ${maxItems}`);
  console.log('=============================================');

  const results = [];
  const perPortalLimit = Math.max(
    30,
    PORTALS.length ? Math.floor(maxItems / PORTALS.length) || maxItems : maxItems
  );

  for (const portal of PORTALS) {
    if (results.length >= maxItems) break;

    console.log(`\n➡️  Scraping portal: ${portal.label}`);
    console.log(`URL: ${portal.listUrl}`);

    try {
      await page.goto(portal.listUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });

      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(3000);

      // Special handling for repeater-based portals
      let listItems;
      if (portal.key === 'nlhydro' || portal.key === 'stjohns') {
        await waitForRepeaterRows(page, 60000);
        listItems = await page.$$eval('tbody[data-container="true"] > tr', (rows, { portalLabel }) => {
          const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
          const items = [];
          const origin = window.location.origin;

          for (let i = 0; i < rows.length - 1; i += 2) {
            const dataRow = rows[i];
            const actionRow = rows[i + 1];

            const title = norm(dataRow.querySelector('strong')?.textContent || '');
            if (!title) continue;

            const tds = Array.from(dataRow.querySelectorAll('td'));
            const status = norm(tds[1]?.textContent || '');
            const closing = norm(tds[2]?.textContent || '');
            const daysLeft = norm(tds[3]?.textContent || '');

            const detailsAnchor =
              actionRow.querySelector('a[href*="/Tender/Detail/"]') ||
              actionRow.querySelector('a[href*="Tender/Detail"]');

            const href = detailsAnchor?.getAttribute('href') || '';
            const portal_url = href
              ? (href.startsWith('http') ? href : new URL(href, origin).toString())
              : '';

            let project_reference = '';
            const prefix = title.split('-')[0];
            if (prefix && /\d/.test(prefix)) project_reference = norm(prefix);

            items.push({
              title,
              status,
              agency: '',
              region: '',
              created_at: '',
              listing_expiry_date: closing,
              daysLeft,
              project_reference,
              portal_url,
              portal_source: portalLabel,
            });
          }

          return items;
        }, { portalLabel: portal.label });
      } else {
        // Generic extraction for other portals
        await waitForAnySelector(page, [
          'tbody[data-container="true"] tr',
          'table.table tbody tr',
          'table.tenders-table tbody tr',
          '.tenderTable tbody tr',
          '.tender-list .tender',
          '.search-results .row a[href*="/Tender/Detail/"]',
        ], 60000);

        listItems = await page.$$eval(
          [
            'table tbody tr',
            'table.tenders-table tbody tr',
            '.tenderTable tbody tr',
            '.tender-list .tender',
            '.search-results .row',
          ].join(','),
          (rows, { portalLabel }) => {
            const normalize = (str) => (str || '').replace(/\s+/g, ' ').trim();
            const items = [];
            const seen = new Set();

            for (const row of rows) {
              let linkRow = row;
              let linkEl =
                linkRow.querySelector('a[href*="/Tender/Detail/"]') ||
                linkRow.querySelector('a[href*="Tender/Detail"]');

              if (!linkEl) {
                const next = row.nextElementSibling;
                if (next) {
                  const maybeLink =
                    next.querySelector('a[href*="/Tender/Detail/"]') ||
                    next.querySelector('a[href*="Tender/Detail"]');
                  if (maybeLink) {
                    linkRow = next;
                    linkEl = maybeLink;
                  }
                }
              }

              if (!linkEl) continue;
              const href = linkEl.getAttribute('href') || '';
              if (!href) continue;
              const url = href.startsWith('http')
                ? href
                : new URL(href, window.location.origin).toString();
              if (seen.has(url)) continue;
              seen.add(url);

              const tds = linkRow.previousElementSibling
                ? linkRow.previousElementSibling.querySelectorAll('td')
                : linkRow.querySelectorAll('td');

              const title = normalize(tds[0]?.textContent || linkEl.textContent || '');
              const status = normalize(tds[1]?.textContent || '');
              const listing_expiry_date = normalize(tds[2]?.textContent || '');
              const daysLeft = normalize(tds[3]?.textContent || '');
              const project_reference = '';
              const agency = '';
              const region = '';

              items.push({
                title,
                status,
                agency,
                region,
                created_at: '',
                listing_expiry_date,
                daysLeft,
                project_reference,
                portal_url: url,
                portal_source: portalLabel,
              });
            }
            return items;
          },
          { portalLabel: portal.label }
        );
      }

      console.log(`Found ${listItems.length} rows on ${portal.label}`);

      if (!listItems.length) {
        console.warn(`⚠️  No list items parsed for ${portal.label}, skipping portal.`);
        continue;
      }

      const itemsToProcess = listItems.slice(
        0,
        Math.min(PER_PORTAL_LIMIT, listItems.length, maxItems - results.length)
      );

      for (let i = 0; i < itemsToProcess.length && results.length < maxItems; i++) {
        const item = itemsToProcess[i];

        console.log(
          `\n--- [${portal.key}] ${i + 1}/${itemsToProcess.length}: "${item.title}" ---`
        );
        if (!item.portal_url) {
          console.warn('Missing portal_url, skipping.');
          continue;
        }

        try {
          await page.goto(item.portal_url, {
            waitUntil: 'domcontentloaded',
            timeout: 120000,
          });
          await page.waitForTimeout(2000);

          // Check for "login required" style messages
          const bodyText = (await page.textContent('body').catch(() => '')) || '';
          if (/must login to your account/i.test(bodyText)) {
            console.warn('Login required; saving basic data only.');

            const fingerprint = generateFingerprint(
              `${item.title}${item.project_reference || ''}${
                item.listing_expiry_date || ''
              }${portal.key}`
            );

            results.push({
              id: fingerprint,
              title: item.title,
              agency: item.agency || item.portal_source || portal.label || "Unknown Agency",
              region: item.region || portal.regionHint || '',
              created_at: item.created_at || '',
              listing_expiry_date: item.listing_expiry_date || '',
              daysLeft: item.daysLeft || '',
              project_reference: item.project_reference || '',
              portal_url: item.portal_url,
              portal_source: item.portal_source,
              project_reference_detail: '',
              buyer_organization_detail: item.agency || item.portal_source || portal.label || "Unknown Agency",
              project_type: '',
              agreement_type: '',
              city: '',
              contact_person: '',
              contact_phone: '',
              contact_email: '',
              detailed_description:
                'Login required to view full bid details on this Bids & Tenders portal.',
              hash_fingerprint: fingerprint,
            });

            await safeGoBackToList(page, portal.listUrl);
            continue;
          }

          const detailData = await page.evaluate(() => {
            const normalize = (str) =>
              (str || '').replace(/\s+/g, ' ').trim();

            const findInTable = (labelCandidates) => {
              const rows = Array.from(document.querySelectorAll('table tr'));
              const match = (label, wanted) => {
                const l = label.toLowerCase();
                return wanted.some((w) => l.includes(w));
              };

              for (const row of rows) {
                const th = row.querySelector('th');
                const labelCell =
                  th ||
                  row.querySelector('td.col-label') ||
                  null;

                if (!labelCell) continue;

                const labelText = normalize(labelCell.textContent || '');
                if (!labelText) continue;

                if (!match(labelText, labelCandidates)) continue;

                const valueCell =
                  row.querySelector('td:not(.col-label)') ||
                  row.cells[1] ||
                  null;

                if (!valueCell) return '';
                return normalize(valueCell.textContent || '');
              }

              return '';
            };

            // Contact info heuristics
            let contact_person = '';
            let contact_phone = '';
            let contact_email = '';

            const contactRoots = Array.from(
              document.querySelectorAll(
                '#ContactInformation, #ContactInfo, .contact, .contact-info, .x-panel-body, .col-md-12'
              )
            );

            const textBlocks = contactRoots
              .map((el) => normalize(el.textContent || ''))
              .filter(Boolean);

            for (const text of textBlocks) {
              if (!contact_email) {
                const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
                if (m) contact_email = m[0];
              }

              if (!contact_phone) {
                const m = text.match(/(\+?\d[\d\s().-]{7,}\d)/);
                if (m) contact_phone = m[0];
              }

              if (!contact_person) {
                const line = text
                  .split(/[\r\n]/)
                  .map((l) => l.trim())
                  .find(
                    (l) =>
                      /^[A-Za-z ,.'-]{5,}$/.test(l) &&
                      !l.includes('@') &&
                      !/\d/.test(l)
                  );
                if (line) contact_person = line;
              }

              if (contact_person && contact_phone && contact_email) break;
            }

            const project_reference_detail =
              findInTable([
                'bid number',
                'tender number',
                'reference number',
                'solicitation number',
              ]) || '';

            const buyer_organization_detail =
              findInTable([
                'organization',
                'purchasing organization',
                'buyer',
                'department',
              ]) || '';

            const project_type =
              findInTable([
                'bid type',
                'bid classification',
                'procurement type',
                'tender type',
              ]) || '';

            const agreement_type =
              findInTable(['agreement type', 'trade agreement']) || '';

            const city =
              findInTable(['location', 'address', 'city']) || '';

            const created_at =
              findInTable(['issue date', 'published date']) || '';

            const listing_expiry_date_detail =
              findInTable([
                'closing date',
                'bid closing date',
                'submission deadline',
              ]) || '';

            // Description: prefer dedicated panels if present
            const descEl =
              document.querySelector(
                '#Description, #BidDescription, #ctl00_Content_pnlBidDescription, .bid-description'
              ) ||
              document.querySelector('.x-panel-body');

            const detailed_description = normalize(descEl?.textContent || '');

            return {
              project_reference_detail,
              buyer_organization_detail,
              project_type,
              agreement_type,
              city,
              created_at,
              listing_expiry_date_detail,
              contact_person,
              contact_phone,
              contact_email,
              detailed_description,
            };
          });

          const merged = {
            title: item.title,
            agency:
              detailData.buyer_organization_detail ||
              item.agency ||
              item.portal_source ||
              portal.label ||
              "Unknown Agency",
            region:
              item.region ||
              portal.regionHint ||
              '',
            status: item.status || '',
            created_at:
              detailData.created_at ||
              item.created_at ||
              '',
            listing_expiry_date:
              detailData.listing_expiry_date_detail ||
              item.listing_expiry_date ||
              '',
            daysLeft: item.daysLeft || '',
            project_reference:
              detailData.project_reference_detail ||
              item.project_reference ||
              '',
            portal_url: item.portal_url,
            portal_source: item.portal_source,
            project_reference_detail:
              detailData.project_reference_detail || '',
            buyer_organization_detail:
              detailData.buyer_organization_detail ||
              item.agency ||
              item.portal_source ||
              portal.label ||
              "Unknown Agency",
            project_type: detailData.project_type || '',
            agreement_type: detailData.agreement_type || '',
            city: detailData.city || '',
            contact_person: detailData.contact_person || '',
            contact_phone: detailData.contact_phone || '',
            contact_email: detailData.contact_email || '',
            detailed_description: detailData.detailed_description || '',
          };

          const fingerprint = generateFingerprint(
            `${merged.title}${merged.project_reference || ''}${
              merged.listing_expiry_date || ''
            }${portal.key}`
          );

          results.push({
            id: fingerprint,
            ...merged,
            hash_fingerprint: fingerprint,
          });

          console.log(`✅ Saved: ${merged.title}`);

          await safeGoBackToList(page, portal.listUrl);
        } catch (err) {
          console.warn(
            `⚠️  Failed details for "${item.title}" on ${portal.key}: ${err.message}`
          );

          const fingerprint = generateFingerprint(
            `${item.title}${item.project_reference || ''}${
              item.listing_expiry_date || ''
            }${portal.key}`
          );

          results.push({
            id: fingerprint,
            title: item.title,
            agency: item.agency || item.portal_source || portal.label || "Unknown Agency",
            region: item.region || portal.regionHint || '',
            status: item.status || '',
            created_at: item.created_at || '',
            listing_expiry_date: item.listing_expiry_date || '',
            daysLeft: item.daysLeft || '',
            project_reference: item.project_reference || '',
            portal_url: item.portal_url,
            portal_source: item.portal_source,
            project_reference_detail: '',
            buyer_organization_detail: item.agency || item.portal_source || portal.label || "Unknown Agency",
            project_type: '',
            agreement_type: '',
            city: '',
            contact_person: '',
            contact_phone: '',
            contact_email: '',
            detailed_description: '',
            hash_fingerprint: fingerprint,
          });

          await safeGoBackToList(page, portal.listUrl);
        }
      }
    } catch (error) {
      console.error(`❌ Portal failed: ${portal.label}`, error.message);
    }
  }

  console.log(
    `\n✅ Bids & Tenders family scrape complete with ${results.length} records`
  );
  return results;
}

/**
 * Wait for any of the given selectors to appear.
 */
async function waitForAnySelector(page, selectors, timeout = 60000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) return;
      } catch {
        // ignore
      }
    }
    await page.waitForTimeout(500);
  }

  throw new Error(
    `None of the selectors appeared within ${timeout}ms: ${selectors.join(', ')}`
  );
}

/**
 * Safely navigate back to the list page for the current portal.
 */
async function safeGoBackToList(page, listUrl) {
  try {
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  } catch {
    try {
      await page.goto(listUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });
      await page.waitForTimeout(2000);
    } catch (e) {
      console.warn('⚠️  Failed to return to list page:', e.message);
    }
  }
}

async function waitForRepeaterRows(page, timeout = 60000) {
  const start = Date.now();
  console.log('⏳ Waiting for repeater rows to render…');

  // Wait for full hydration (network requests to settle)
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);

  // Try forcing Vue/React render via small scrolls & events
  while (Date.now() - start < timeout) {
    const count = await page
      .$$eval('tbody[data-container="true"] > tr', els => els.length)
      .catch(() => 0);

    if (count >= 2) {
      console.log(`✅ Repeater rows detected (${count})`);
      return;
    }

    // trigger Vue hydration by interacting slightly
    await page.mouse.wheel(0, 500);
    await page.mouse.move(300, 400);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
    });

    await page.waitForTimeout(1200);
  }

  // Final diagnostic: dump visible body text snippet
  const snippet = (await page.textContent('body').catch(() => '') || '').slice(0, 300);
  console.warn('⚠️ Timeout: no repeater rows. Body starts with:\n', snippet);
  throw new Error('Repeater rows did not appear (tbody[data-container="true"] > tr)');
}

module.exports = { scrapeBidsAndTenders };
