const { generateFingerprint } = require('../utils');

/**
 * IonWave / ProcureWare Family Scraper
 * Covers tenants on:
 *   *.ionwave.net, *.procureware.com
 */

const FAMILY_DOMAINS = ['ionwave.net', 'procureware.com'];

function deriveTargetsFromSources(sources = []) {
  const targets = [];
  const seen = new Set();

  for (const s of sources) {
    if (!s || !s.url) continue;
    try {
      const u = new URL(s.url);
      if (!FAMILY_DOMAINS.some(d => u.hostname.endsWith(d))) continue;
      const base = `${u.protocol}//${u.hostname}`;
      if (seen.has(base)) continue;
      seen.add(base);
      targets.push({
        key: `ionwave-${u.hostname.replace(/\./g, '-')}`,
        label: `${u.hostname} - IonWave`,
        listUrl: `${base}/Public?pg=PublicSolicitations`
      });
    } catch {}
  }

  if (!targets.length) {
    targets.push({
      key: 'ionwave-generic',
      label: 'IonWave - Generic',
      listUrl: 'https://demo.ionwave.net/Public?pg=PublicSolicitations'
    });
  }

  return targets;
}

async function scrapeIonwave({ page, sources = [], maxItems = 80 }) {
  console.log('🔍 IonWave: start');
  const targets = deriveTargetsFromSources(sources);
  const results = [];
  const perPortalLimit = Math.max(5, Math.floor(maxItems / targets.length));

  for (const target of targets) {
    if (results.length >= maxItems) break;
    console.log(`➡️ ${target.label}`);

    try {
      await page.goto(target.listUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForTimeout(2000);

      await waitForAnySelector(page, [
        'table tbody tr a[href*="Public?pg="]',
        'table tbody tr'
      ]);

      const listItems = await page.$$eval(
        'table tbody tr',
        (rows, { portalLabel }) => {
          const items = [];
          const seen = new Set();

          for (const row of rows) {
            const linkEl =
              row.querySelector('a[href*="Public?pg="]') ||
              row.querySelector('a[href]');
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
              row.querySelector('td[data-title="Organization"], td[data-title="Agency"]')
                ?.textContent.trim() || '';

            const region =
              row.querySelector('td[data-title="Location"]')
                ?.textContent.trim() || '';

            const created_at =
              row.querySelector('td[data-title="Posted"], td[data-title="Issue Date"]')
                ?.textContent.trim() || '';

            const listing_expiry_date =
              row.querySelector('td[data-title="Close Date"], td[data-title="Closing"]')
                ?.textContent.trim() || '';

            const project_reference =
              row.querySelector('td[data-title="Solicitation"], td[data-title="Number"]')
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

      const sliced = listItems.slice(0, perPortalLimit);

      for (const item of sliced) {
        if (results.length >= maxItems) break;

        try {
          console.log(`🔗 IonWave detail: ${item.portal_url}`);
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
              .map(el => el.innerText || '')
              .join('\n');

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
              if (nameLine) {
                contact_person = nameLine.replace(/contact[:\s]*/i, '').trim();
              }
            }

            const detailed_description =
              document.querySelector('.content, main, body')
                ?.innerText.trim().slice(0, 4000) || '';

            return {
              project_reference_detail:
                getByLabel(['solicitation', 'number', 'reference']) || '',
              buyer_organization_detail:
                getByLabel(['organization', 'agency', 'owner']) || '',
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
        } catch (e) {
          console.warn(`⚠️ IonWave detail error: ${e.message}`);
          const fp = generateFingerprint(
            `${item.title}${item.project_reference || ''}${item.listing_expiry_date || ''}${target.key}`
          );
          results.push({
            id: fp,
            ...item,
            project_reference_detail: item.project_reference || '',
            detailed_description: 'Partial metadata captured from listing.',
            hash_fingerprint: fp
          });
        }
      }
    } catch (e) {
      console.warn(`⚠️ IonWave list error for ${target.label}: ${e.message}`);
    }
  }

  console.log(`🏁 IonWave done with ${results.length} records`);
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
  throw new Error(`No expected selectors: ${selectors.join(', ')}`);
}

module.exports = { scrapeIonwave };
