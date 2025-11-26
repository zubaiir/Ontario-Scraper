// merx-govnl.js
const { generateFingerprint } = require('../utils');

/**
 * Merx GovNL Scraper
 * Scrapes open solicitations from https://www.merx.com/govnl
 */
async function scrapeMerxGovNL({ page, maxItems, webhookUrl, webhookSecret }) {
  console.log('Opening Merx GovNL Portal...');
  const govnlUrl = 'https://www.merx.com/govnl';

  await page.goto(govnlUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(5000);

  console.log('GovNL initial URL:', page.url());

  // ---- COLLECT LISTINGS ACROSS ALL PAGES VIA "NEXT" ----
  const allItems = [];

  while (true) {
    console.log('\n[GovNL] Scrolling and extracting listings on current page...');
    await autoScroll(page);

    // ensure rows exist
    const hasRow = await page.$('tr.mets-table-row');
    if (!hasRow) {
      console.warn('[GovNL] No .mets-table-row found on this page.');
      break;
    }

    const pageItems = await page.$$eval('tr.mets-table-row', (rows) =>
      rows
        .map((row) => {
          const infoCol = row.querySelector('.sol-info-container .sol-info-col');
          if (!infoCol) return null;

          const link = infoCol.querySelector(
            '.sol-title .solicitation-link.mets-command-link, .sol-title .solicitation-link'
          );
          const href = link ? link.getAttribute('href') : '';

          const title = link?.innerText.trim() || '';

          const agency =
            infoCol.querySelector('.sol-buyer-name')?.innerText.trim() || '';

          const region =
            infoCol
              .querySelector('.sol-region .sol-region-item')
              ?.innerText.trim() || '';

          const created_at =
            row
              .querySelector('.sol-publication-date .date-value')
              ?.innerText.trim() || '';

          const listing_expiry_date =
            row
              .querySelector('.sol-closing-date .date-value')
              ?.innerText.trim() || '';

          return {
            title,
            agency,
            region,
            created_at,
            listing_expiry_date,
            daysLeft: '',
            project_reference: '',
            portal_url: href ? `https://www.merx.com${href}` : '',
            portal_source: 'Merx GovNL',
          };
        })
        .filter(Boolean)
    );

    console.log(`[GovNL] Found ${pageItems.length} items on this page`);
    if (!pageItems.length) break;

    allItems.push(...pageItems);

    if (maxItems > 0 && allItems.length >= maxItems) {
      console.log(`[GovNL] Reached maxItems (${maxItems}), stopping pagination.`);
      break;
    }

    // find "Next" button in Merx-style pagination
    const nextButton = await page.$('.mets-page-navigation-next a.next');

    if (!nextButton) {
      console.log('[GovNL] No Next button found — last page reached.');
      break;
    }

    const isDisabled = await nextButton.getAttribute('aria-disabled');
    if (isDisabled === 'true') {
      console.log('[GovNL] Next button disabled — last page reached.');
      break;
    }

    console.log('[GovNL] Going to next page...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 }),
      nextButton.click(),
    ]);

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
  }

  console.log(`[GovNL] Total collected list items: ${allItems.length}`);

  const itemsToProcess =
    maxItems > 0 ? allItems.slice(0, maxItems) : allItems;

  // ---- DETAIL SCRAPING (GovNL detail page) ----
  const results = [];

  for (let i = 0; i < itemsToProcess.length; i++) {
    const item = itemsToProcess[i];
    console.log(
      `\n[GovNL] Processing ${i + 1}/${itemsToProcess.length}: "${item.title}"`
    );

    if (!item.portal_url) continue;

    try {
      await page.goto(item.portal_url, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });

      const loginPopup = await page
        .locator('.mets-dialog-title, :text("Login Required")')
        .first();
      if (await loginPopup.isVisible()) {
        console.warn(`[GovNL] Login required for ${item.title}`);
        const fingerprint = generateFingerprint(
          `${item.title}${item.project_reference || ''}${
            item.listing_expiry_date || ''
          }`
        );
        results.push({
          id: fingerprint,
          ...item,
          detailed_description:
            'Login or subscription required to access this solicitation.',
          hash_fingerprint: fingerprint,
        });
        continue;
      }

      await page.waitForSelector('.mets-field-label', { timeout: 30000 });

      const detailData = await page.evaluate(() => {
        const getField = (label) => {
          const target = label.trim().toLowerCase();
          const el = Array.from(
            document.querySelectorAll('.mets-field-label')
          ).find(
            (e) => e.textContent.trim().toLowerCase() === target
          );
          if (!el) return '';
          const body = el
            .closest('.mets-field')
            ?.querySelector('.mets-field-body');
          const p = body?.querySelector('p');
          return p ? p.innerText.trim() : body?.innerText.trim() || '';
        };

        let contact_person = '';
        let contact_phone = '';
        let contact_email = '';

        const contactPs = Array.from(
          document.querySelectorAll(
            '.twoColFields .no-label .mets-field-body > p'
          )
        )
          .map((p) => p.innerText.trim())
          .filter(Boolean);

        for (const text of contactPs) {
          if (!contact_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
            contact_email = text;
          } else if (
            !contact_phone &&
            /(\+?\d[\d\s\-().]{6,})/.test(text)
          ) {
            contact_phone = text.match(/(\+?\d[\d\s\-().]{6,})/)[0];
          } else if (!contact_person && /^[A-Za-z\s.'-]+$/.test(text)) {
            contact_person = text;
          }
        }

        const description =
          document.querySelector('#descriptionText')?.innerText.trim() ||
          document.querySelector('#solicitationForm')?.innerText.trim() ||
          '';

        const reference_number = getField('Reference Number');
        const solicitation_number = getField('Solicitation Number');

        return {
          reference_number,
          solicitation_number,
          project_reference_detail: solicitation_number || reference_number || '',
          buyer_organization_detail: getField('Issuing Organization'),
          owner_organization_detail: getField('Owner Organization'),
          project_type: getField('Solicitation Type'),
          agreement_type: getField('Agreement Types'),
          city: getField('Location'),
          contact_person,
          contact_phone,
          contact_email,
          detailed_description: description,
        };
      });

      const mergedData = {
        ...item,
        ...detailData,
      };

      if (!mergedData.project_reference) {
        mergedData.project_reference =
          mergedData.project_reference_detail ||
          mergedData.solicitation_number ||
          mergedData.reference_number ||
          '';
      }

      const fingerprint = generateFingerprint(
        `${mergedData.title}${mergedData.project_reference || ''}${
          mergedData.listing_expiry_date || ''
        }`
      );

      results.push({
        id: fingerprint,
        ...mergedData,
        hash_fingerprint: fingerprint,
      });

      console.log(`[GovNL] ✅ Details added for: ${item.title}`);
    } catch (err) {
      console.warn(
        `[GovNL] ⚠️ Failed to scrape details for ${item.title}: ${err.message}`
      );
      const fingerprint = generateFingerprint(
        `${item.title}${item.project_reference || ''}${
          item.listing_expiry_date || ''
        }`
      );
      results.push({
        id: fingerprint,
        ...item,
        hash_fingerprint: fingerprint,
      });
    }

    await page.waitForTimeout(1000);
  }

  console.log(
    `\n✅ Merx GovNL scrape complete with ${results.length} records`
  );
  return results;
}

// same scroll helper as Merx
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 500);
    });
  });
}

module.exports = { scrapeMerxGovNL };
