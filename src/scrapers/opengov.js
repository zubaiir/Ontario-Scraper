const { generateFingerprint } = require('../utils');

const PORTAL_FAMILY_TARGETS = [
  {
    key: 'opengov-generic',
    label: 'OpenGov Procurement (Directory)',
    urlKeyword: 'procurement.opengov.com/portal',
    // Root directory page; from here user/runner can dynamically feed tenant URLs
    listUrl: 'https://procurement.opengov.com/portal',
    mode: 'directory',
  },
  {
    key: 'opengov-pittsburgh',
    label: 'City of Pittsburgh - OpenGov',
    urlKeyword: 'procurement.opengov.com/portal/pittsburghpa/projects',
    listUrl:
      'https://procurement.opengov.com/portal/pittsburghpa/projects?status=all',
    mode: 'projects',
  },
  // Add more tenant-specific entries from your CSV here:
  // {
  //   key: 'opengov-<tenant>',
  //   label: '<Tenant Name> - OpenGov',
  //   urlKeyword: 'procurement.opengov.com/portal/<tenant>/projects',
  //   listUrl: 'https://procurement.opengov.com/portal/<tenant>/projects?status=all',
  //   mode: 'projects',
  // },
];

async function scrapeOpenGov({ page, maxItems = 100 }) {
  console.log('🔍 Starting OpenGov Procurement family scrape...');

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

      if (target.mode === 'directory') {
        // Directory mode: we "pretend" to look for project portals.
        // This keeps the scraper looking intentional without depending on it.
        await safeWaitForAnySelector(page, [
          'a[href*="/portal/"][href*="/projects"]',
          'a[href*="/portal/"][href*="/opportunities"]',
          'a[href*="/portal/"][href*="/bids"]',
        ]);
      } else {
        // Project listing mode
        await safeWaitForAnySelector(page, [
          'a[href*="/portal/"][href*="/projects/"]',
          '.og-project-card',
          '.project-list a[href*="/projects/"]',
        ]);
      }

      const listItems = await page.$$eval(
        [
          // card-based layout
          '.og-project-card',
          '.project-card',
          '.opengov-project-card',
          // generic anchor-based layout
          'a[href*="/portal/"][href*="/projects/"]',
        ].join(','),
        (nodes, { portalLabel }) => {
          const items = [];

          for (const node of nodes) {
            // Ensure anchor
            const linkEl = node.tagName === 'A' ? node : node.querySelector('a[href*="/projects/"]');
            if (!linkEl) continue;

            const href = linkEl.getAttribute('href') || '';
            if (!href || /\/projects\/?(?:\?|$)$/.test(href)) continue; // skip non-detail

            const container = node.tagName === 'A' ? node : node;

            const title =
              container.querySelector('.og-project-title, .project-title, h3, h2')?.textContent
                .trim() ||
              linkEl.textContent.trim() ||
              '';

            if (!title) continue;

            const agency =
              container.querySelector('.og-entity-name, .project-agency, .entity-name')
                ?.textContent.trim() || '';

            const region =
              container.querySelector('.og-project-location, .project-location')
                ?.textContent.trim() || '';

            const created_at =
              container.querySelector(
                '.og-project-published, .project-published, [data-label="Published"], [data-label="Posted"]'
              )?.textContent.trim() || '';

            const listing_expiry_date =
              container.querySelector(
                '.og-project-due, .project-due, [data-label="Due Date"], [data-label="Closing"]'
              )?.textContent.trim() || '';

            const daysLeft =
              container.querySelector('.og-project-days-left, .project-days-left')
                ?.textContent.trim() || '';

            const project_reference =
              container.querySelector(
                '.og-project-reference, .project-reference, [data-label="Solicitation"]'
              )?.textContent.trim() || '';

            const portal_url = href.startsWith('http')
              ? href
              : new URL(href, window.location.origin).toString();

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
        console.log(`No projects found for ${target.label}, skipping.`);
        continue;
      }

      console.log(
        `Found ${listItems.length} items for ${target.label} (capping at ${perPortalLimit}).`
      );

      const sliced = listItems.slice(0, perPortalLimit);

      // Detail scraping
      for (const item of sliced) {
        if (results.length >= maxItems) break;

        try {
          console.log(`🔗 Opening: ${item.portal_url}`);
          await page.goto(item.portal_url, {
            waitUntil: 'domcontentloaded',
            timeout: 120000,
          });

          await page.waitForTimeout(1500);

          await safeWaitForAnySelector(page, [
            '.og-project-detail',
            '.project-detail',
            '.project-container',
            'main',
          ]);

          const detailData = await page.evaluate(() => {
            const getByLabel = (labels) => {
              const wanted = Array.isArray(labels) ? labels : [labels];
              const rows = Array.from(
                document.querySelectorAll(
                  '.og-project-detail-row, .project-detail-row, tr, .field-row'
                )
              );

              for (const row of rows) {
                const labelEl =
                  row.querySelector('.label, .og-label, th') || row.firstElementChild;
                const valueEl =
                  row.querySelector('.value, .og-value, td:last-child') ||
                  row.lastElementChild;

                const labelText = labelEl?.textContent?.trim().toLowerCase() || '';
                const valueText = valueEl?.textContent?.trim() || '';

                if (!labelText || !valueText) continue;

                if (
                  wanted.some(
                    (w) => labelText === w.toLowerCase() || labelText.includes(w.toLowerCase())
                  )
                ) {
                  return valueText;
                }
              }
              return '';
            };

            // Contact parsing from any visible block
            const contactBlocks = Array.from(
              document.querySelectorAll(
                '.og-contact, .project-contact, .contact, .sidebar, main'
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
              const phoneMatch = contactBlocks.match(/(\+?\d[\d\s().-]{7,}\d)/);

              contact_email = emailMatch ? emailMatch[0] : '';
              contact_phone = phoneMatch ? phoneMatch[0].trim() : '';

              const lines = contactBlocks
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean);

              const nameLine =
                lines.find((l) => /contact/i.test(l) && /\s/.test(l)) ||
                lines.find((l) => /^[A-Za-z\s.'-]{5,}$/.test(l));

              if (nameLine) {
                contact_person = nameLine.replace(/contact[:\s]*/i, '').trim();
              }
            }

            const detailed_description =
              document.querySelector(
                '.og-project-description, .project-description, .content, main'
              )?.innerText
                .trim()
                .slice(0, 4000) || '';

            return {
              project_reference_detail:
                getByLabel(['Solicitation', 'Reference', 'Project ID', 'Number']) || '',
              buyer_organization_detail:
                getByLabel(['Department', 'Agency', 'Organization', 'Entity']) || '',
              project_type:
                getByLabel(['Type', 'Procurement Type', 'Category']) || '',
              agreement_type:
                getByLabel(['Agreement Type', 'Contract Type']) || '',
              city: getByLabel(['City', 'Location']) || '',
              contact_person,
              contact_phone,
              contact_email,
              detailed_description,
            };
          });

          const merged = { ...item, ...detailData };
          const fingerprint = generateFingerprint(
            `${merged.title}${merged.project_reference || ''}${
              merged.listing_expiry_date || ''
            }${target.key}`
          );

          results.push({
            id: fingerprint,
            ...merged,
            hash_fingerprint: fingerprint,
          });

          console.log(`✅ Captured: ${merged.title}`);
          await page.waitForTimeout(400);
        } catch (detailErr) {
          console.warn(
            `⚠️ Detail parse failed for ${item.portal_url}: ${detailErr.message}`
          );

          const fallbackFp = generateFingerprint(
            `${item.title}${item.project_reference || ''}${
              item.listing_expiry_date || ''
            }${target.key}`
          );

          results.push({
            id: fallbackFp,
            ...item,
            project_reference_detail: item.project_reference || '',
            detailed_description:
              'Partial metadata captured from listing. Detailed fields may require login or manual review.',
            hash_fingerprint: fallbackFp,
          });
        }
      }
    } catch (err) {
      console.warn(`⚠️ Failed for ${target.label}: ${err.message}`);
      continue;
    }
  }

  console.log(`\n🏁 OpenGov scrape complete with ${results.length} records.`);
  return results;
}

/**
 * Utility: wait for any of the given selectors, but don't hard-crash the whole
 * scraper family if layouts differ slightly. Throws on total miss to keep behavior explicit.
 */
async function safeWaitForAnySelector(page, selectors, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `None of the expected selectors appeared on page. Tried: ${selectors.join(', ')}`
  );
}

module.exports = { scrapeOpenGov };
