// src/scrapers/merx-govnl.js
const { generateFingerprint } = require('../utils');

const MERX_BASE_URL = 'https://www.merx.com';

/**
 * Merx GovNL Scraper
 * Scrapes open solicitations from https://www.merx.com/govnl
 */
async function scrapeMerxGovNL({ page, maxItems }) {
  const startUrl = `${MERX_BASE_URL}/govnl`;

  console.log('[MerxGovNL] Opening portal…');
  await page.goto(startUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(2000);

  console.log('[MerxGovNL] Waiting for listing table rows…');

  // This matches the structure in merx-govnl.html: <tbody><tr class="mets-table-row"><td class="mainCol">…
  await page.waitForSelector('tbody tr.mets-table-row td.mainCol', {
    timeout: 60000,
  });

  console.log('[MerxGovNL] Extracting solicitation list…');

  const listItems = await page.$$eval('tbody tr.mets-table-row', (rows) => {
    const baseUrl = 'https://www.merx.com';

    return rows.map((row) => {
      const mainCol = row.querySelector('td.mainCol');

      if (!mainCol) return null;

      const titleLink = mainCol.querySelector('.sol-title a');
      const titleText = titleLink?.innerText.trim() || '';
      const href = titleLink?.getAttribute('href') || '';

      const buyer =
        mainCol.querySelector('.sol-buyer-name')?.innerText.trim() || '';

      const regionText =
        mainCol.querySelector('.sol-region .sol-region-item')?.innerText.trim() ||
        '';

      const publicationText =
        mainCol.querySelector('.sol-publication-date')?.innerText
          .replace(/\s+/g, ' ')
          .trim() || '';

      const closingText =
        mainCol.querySelector('.sol-closing-date')?.innerText
          .replace(/\s+/g, ' ')
          .trim() || '';

      return {
        title: titleText,
        project_reference: '', // not present in list; will try to get in details
        agency: buyer,
        region: regionText,
        created_at: publicationText,
        listing_expiry_date: closingText,
        portal_url: href ? `${baseUrl}${href}` : '',
        portal_source: 'MerxGovNL',
      };
    }).filter(Boolean);
  });

  console.log(`[MerxGovNL] Found ${listItems.length} opportunities`);

  if (!listItems.length) {
    console.warn('[MerxGovNL] No rows parsed – check selectors or page structure.');
    return [];
  }

  const itemsToProcess = maxItems > 0 ? listItems.slice(0, maxItems) : listItems;
  const results = [];

  // ---------- DETAIL SCRAPE LOOP ----------
  for (let i = 0; i < itemsToProcess.length; i++) {
    const item = itemsToProcess[i];
    console.log(
      `[MerxGovNL] Processing ${i + 1}/${itemsToProcess.length}: ${item.title}`
    );

    const baseFingerprintString = `${item.title}${item.project_reference || ''}${
      item.listing_expiry_date || ''
    }MerxGovNL`;

    if (!item.portal_url) {
      const fingerprint = generateFingerprint(baseFingerprintString);
      results.push({
        id: fingerprint,
        ...item,
        detailed_description: '',
        hash_fingerprint: fingerprint,
      });
      continue;
    }

    try {
      await page.goto(item.portal_url, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });

      await page.waitForTimeout(1500);

      // If there is some logged-in-only dialog, skip details but keep base data
      const loginDialog = await page
        .locator('.mets-dialog-title, :text("Login Required")')
        .first();
      if (await loginDialog.isVisible().catch(() => false)) {
        console.warn(
          `[MerxGovNL] Login/subscription required for details of "${item.title}"`
        );
        const fingerprint = generateFingerprint(baseFingerprintString);
        results.push({
          id: fingerprint,
          ...item,
          detailed_description:
            'Login or subscription required to access this solicitation.',
          hash_fingerprint: fingerprint,
        });
        continue;
      }

      // Wait for Basic Information fields
      await page.waitForSelector('.mets-field-label', { timeout: 30000 });

      const detailData = await page.evaluate(() => {
        const getField = (labelText) => {
          const label = Array.from(
            document.querySelectorAll('.mets-field-label')
          ).find((el) => el.textContent.trim() === labelText);

          if (!label) return '';

          const body = label
            .closest('.mets-field')
            ?.querySelector('.mets-field-body p');

          return body?.innerText.trim() || '';
        };

        const referenceNumber = getField('Reference Number');
        const issuingOrg = getField('Issuing Organization');
        const sourceId = getField('Source ID');
        const titleDetail = getField('Title');

        const description =
          document.querySelector('#descriptionText')?.innerText.trim() || '';

        return {
          project_reference: referenceNumber || '',
          agency: issuingOrg || '',
          source_id: sourceId || '',
          title_detail: titleDetail || '',
          detailed_description: description,
        };
      });

      const merged = {
        ...item,
        ...detailData,
      };

      // Prefer detailed title if present
      if (merged.title_detail) {
        merged.title = merged.title_detail;
      }

      const fingerprint = generateFingerprint(
        `${merged.title}${merged.project_reference || ''}${
          merged.listing_expiry_date || ''
        }MerxGovNL`
      );

      results.push({
        id: fingerprint,
        ...merged,
        hash_fingerprint: fingerprint,
      });

      console.log(`[MerxGovNL] ✅ Details added for: ${merged.title}`);
    } catch (err) {
      console.warn(
        `[MerxGovNL] ⚠️ Failed to scrape details for "${item.title}": ${err.message}`
      );
      const fingerprint = generateFingerprint(baseFingerprintString);
      results.push({
        id: fingerprint,
        ...item,
        detailed_description: '',
        hash_fingerprint: fingerprint,
      });
    }

    await page.waitForTimeout(500);
  }

  console.log(
    `\n✅ Merx GovNL scrape complete with ${results.length} records (from ${listItems.length} list rows)`
  );
  return results;
}

module.exports = { scrapeMerxGovNL };
