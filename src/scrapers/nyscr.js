// src/scrapers/nyscr.js
const { generateFingerprint } = require('../utils');

const NYSCR_BASE_URL = 'https://www.nyscr.ny.gov';

// 🔑 TESTING CREDENTIALS – hard-coded for now (REMOVE later)
const NYSCR_USERNAME = 'zubaiirahmad@gmail.com';
const NYSCR_PASSWORD = '0Ahmadzubair@00';

/**
 * Log in to NYSCR so we can see "View this ad" links and details.
 * NO networkidle / load waits to avoid timeouts.
 */

async function loginNyscr(page) {
  const username = NYSCR_USERNAME;
  const password = NYSCR_PASSWORD;

  if (!username || !password) {
    throw new Error('[NYSCR] Username/password are required for login.');
  }

  console.log('[NYSCR] Logging in…');

  await page.goto(`${NYSCR_BASE_URL}/Account/Login`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  // 👉 Extra delay to look less "botty"
  await page.waitForTimeout(2500);

  // --- find username / password inputs ---
  const usernameInput =
    (await page.$('input[type="email"]')) ||
    (await page.$('input[name="Username"], input[id="Username"]'));

  if (!usernameInput) {
    throw new Error('[NYSCR] Could not find username/email input on login page.');
  }

  const passwordInput =
    (await page.$('input[type="password"]')) ||
    (await page.$('input[name="Password"], input[id="Password"]'));

  if (!passwordInput) {
    throw new Error('[NYSCR] Could not find password input on login page.');
  }

  // 👉 Human-like typing for username
  await usernameInput.click();
  await usernameInput.fill(''); // clear field
  await usernameInput.type(username, { delay: 120 }); // ~120ms per char

  // small delay between fields
  await page.waitForTimeout(800);

  // 👉 Human-like typing for password
  await passwordInput.click();
  await passwordInput.fill('');
  await passwordInput.type(password, { delay: 120 });

  // one more short pause before submit
  await page.waitForTimeout(800);

  // --- submit the form ---

  const submitButton =
    (await page.$('button[type="submit"]')) ||
    (await page.$('input[type="submit"]'));

  if (!submitButton) {
    throw new Error('[NYSCR] Could not find login submit button.');
  }

  await submitButton.click();

  // Do NOT wait for networkidle / load; just give it a moment
  await page.waitForTimeout(4000);

  const currentUrl = page.url();
  console.log('[NYSCR] Login step finished. Current URL:', currentUrl);

  // Optional: log if we see the robot error text
  const robotError = await page.$('text=Unable to verify that you are not a robot');
  if (robotError) {
    console.warn('[NYSCR] Site is showing "Unable to verify that you are not a robot".');
  }
}

async function scrapeNyscr({ page, maxItems }) {
  // 1) Log in automatically
  await loginNyscr(page);

  console.log('[NYSCR] Opening search page…');
  const searchUrl = `${NYSCR_BASE_URL}/Ads/Search`;

  await page.goto(searchUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  const allItems = [];

  // ---------- PAGINATION LOOP ----------
  while (true) {
    console.log('\n[NYSCR] New page of results');
    await autoScroll(page);

    // Make sure there is at least one title/card
    const hasAny = await page.$(
      '.flex-fill.min-w-0.px-2.py-1.bg-primary.text-light.fs-5.text-lg-truncate'
    );
    if (!hasAny) {
      console.warn('[NYSCR] No result cards found, stopping.');
      break;
    }

    // Extract list-level data: ONE item per card, based off the title element
    const pageItems = await page.$$eval(
      '.flex-fill.min-w-0.px-2.py-1.bg-primary.text-light.fs-5.text-lg-truncate',
      (titleNodes) => {
        const baseUrl = 'https://www.nyscr.ny.gov';

        const getFieldFromCard = (card, labelText) => {
          if (!card) return '';
          const label = labelText.trim();

          const candidates = Array.from(
            card.querySelectorAll('div, span, p, dt, dd, b, strong')
          );

          const el = candidates.find((e) => {
            const t = e.textContent.trim();
            return t.startsWith(label);
          });

          if (!el) return '';

          const raw = el.textContent.trim();
          if (raw.length > label.length) {
            return raw.replace(label, '').replace(/^[:\s]+/, '').trim();
          }

          const next = el.nextElementSibling;
          return next ? next.textContent.trim() : '';
        };

        const items = [];

        for (const titleEl of titleNodes) {
          // ==== FIND A REAL CARD CONTAINER FOR THIS TITLE ====
          const titleText = (titleEl.textContent || '').trim();
          let card = titleEl.parentElement;

          // Walk up until we find the smallest ancestor that contains this title AND a CR#/Issue date label
          while (card && card !== document.body) {
            const text = card.innerText || '';
            if (
              text.includes(titleText) &&
              (text.includes('CR#:') || text.includes('Issue date:'))
            ) {
              break; // this is our card
            }
            card = card.parentElement;
          }

          if (!card || card === document.body) continue;
          // ===================================================

          // ✅ Clean, dynamic title per card
          const fromAttr = titleEl.getAttribute('title') || '';
          const fromText = titleEl.textContent || '';
          const title = (fromAttr || fromText).replace(/\s+/g, ' ').trim();

          const cr = getFieldFromCard(card, 'CR#:');
          const agency = getFieldFromCard(card, 'Agency:');
          const division = getFieldFromCard(card, 'Division:');
          const issueDate = getFieldFromCard(card, 'Issue date:');
          const dueDate = getFieldFromCard(card, 'Due date:');

          // ---- Special-case Location: row with "Location:" label ----
          let location = '';
          const locationRow = Array.from(card.querySelectorAll('.d-flex')).find(
            (row) => {
              const first = row.firstElementChild;
              if (!first) return false;
              return first.textContent.trim().startsWith('Location:');
            }
          );

          if (locationRow) {
            const divs = locationRow.querySelectorAll('div');
            if (divs.length >= 2) {
              location = divs[1].textContent.trim();
            }
          }
          // ---------------------------------------------------------

          const category = getFieldFromCard(card, 'Category:');
          const adType = getFieldFromCard(card, 'Ad type:');

          // Find the primary action link inside THIS card
          const actionLink = Array.from(
            card.querySelectorAll('a.ad-action-link')
          ).find((a) => {
            const txt = a.textContent.toLowerCase();
            return (
              txt.includes('view this ad') ||
              txt.includes('log in or sign up to view this opportunity')
            );
          });

          let portal_url = '';
          let login_required = false;
          const href = actionLink?.getAttribute('href') || '';

          if (href.startsWith('/Ads/Details')) {
            portal_url = baseUrl + href;
          } else if (href.startsWith('/Account/Login')) {
            login_required = true;
          }

          items.push({
            title: title || '',
            project_reference: cr || '',
            agency: agency || '',
            division: division || '',
            created_at: issueDate || '',
            listing_expiry_date: dueDate || '',
            location: location || '',
            city: location || '',
            category: category || '',
            ad_type: adType || '',
            region: 'New York', // NY-only portal
            portal_url,
            portal_source: 'NYSCR',
            login_required,
          });
        }

        return items;
      }
    );

    console.log(`[NYSCR] Found ${pageItems.length} items on this page`);
    if (!pageItems.length) break;

    allItems.push(...pageItems);

    if (maxItems > 0 && allItems.length >= maxItems) {
      console.log(`[NYSCR] Reached maxItems (${maxItems}), stopping pagination.`);
      break;
    }

    // Pagination: Next button
    const nextButton = await page.$('button.Next.btn');

    if (!nextButton) {
      console.log('[NYSCR] No Next button found — last page.');
      break;
    }

    const disabledAttr = await nextButton.getAttribute('disabled');
    if (disabledAttr !== null && disabledAttr !== 'false') {
      console.log('[NYSCR] Next button is disabled — last page.');
      break;
    }

    console.log('[NYSCR] Clicking Next…');
    await Promise.all([
      nextButton.click(),
      page.waitForLoadState('domcontentloaded'),
    ]);
    await page.waitForTimeout(1500);
  }

  console.log(`[NYSCR] Total collected list items: ${allItems.length}`);

  const itemsToProcess = maxItems > 0 ? allItems.slice(0, maxItems) : allItems;
  const results = [];

  // ---------- DETAIL SCRAPE LOOP ----------
  for (let i = 0; i < itemsToProcess.length; i++) {
    const item = itemsToProcess[i];
    console.log(
      `\n[NYSCR] Processing ${i + 1}/${itemsToProcess.length}: "${item.title}"`
    );

    const baseFingerprintString = `${item.title}${item.project_reference || ''}${
      item.listing_expiry_date || ''
    }nyscr`;

    // If there is no public detail URL or it requires login again, keep list-level info
    if (!item.portal_url || item.login_required) {
      const fingerprint = generateFingerprint(baseFingerprintString);
      results.push({
        id: fingerprint,
        ...item,
        detailed_description: item.login_required
          ? 'Login required to view full ad details.'
          : '',
        hash_fingerprint: fingerprint,
      });
      continue;
    }

    try {
      await page.goto(item.portal_url, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });

      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);

      // If we got bounced back to login, treat as login-required
      if (page.url().includes('/Account/Login')) {
        console.warn(
          `[NYSCR] Redirected to login while opening details for "${item.title}".`
        );
        const fingerprint = generateFingerprint(baseFingerprintString);
        results.push({
          id: fingerprint,
          ...item,
          detailed_description: 'Login required to view full ad details.',
          hash_fingerprint: fingerprint,
        });
        continue;
      }

      const detailData = await page.evaluate(() => {
        const getField = (labelText) => {
          const label = labelText.trim().toLowerCase();
          const candidates = Array.from(
            document.querySelectorAll(
              'div, span, p, dt, dd, b, strong, th, td'
            )
          );

          const el = candidates.find((e) => {
            const t = e.textContent.trim().toLowerCase();
            return t.startsWith(label);
          });

          if (!el) return '';

          const raw = el.textContent.trim();
          if (raw.length > label.length) {
            return raw.replace(labelText, '').replace(/^[:\s]+/, '').trim();
          }

          const next = el.nextElementSibling;
          return next ? next.textContent.trim() : '';
        };

        const descriptionEl =
          document.querySelector('.ad-body, .ad-description, #AdText') ||
          document.querySelector('main');

        const detailed_description =
          descriptionEl?.innerText.trim() ||
          document.body.innerText.trim().slice(0, 5000);

        let contact_person = '';
        let contact_phone = '';
        let contact_email = '';

        const textChunks = detailed_description
          .split(/\n+/)
          .map((t) => t.trim())
          .filter(Boolean);

        for (const line of textChunks) {
          if (!contact_email && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(line)) {
            contact_email = line.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)[0];
          }
          if (!contact_phone && /(\+?\d[\d\s\-().]{6,})/.test(line)) {
            contact_phone = line.match(/(\+?\d[\d\s\-().]{6,})/)[0];
          }
          if (!contact_person && /^contact/i.test(line)) {
            contact_person = line.replace(/^contact[:\s-]*/i, '').trim();
          }
        }

        const division_detail = getField('Division:');
        const category_detail = getField('Category:');

        return {
          division_detail,
          category_detail,
          contact_person,
          contact_phone,
          contact_email,
          detailed_description,
        };
      });

      const mergedData = {
        ...item,
        ...detailData,
      };

      if (detailData.division_detail && !mergedData.division) {
        mergedData.division = detailData.division_detail;
      }
      if (detailData.category_detail && !mergedData.category) {
        mergedData.category = detailData.category_detail;
      }

      const fingerprint = generateFingerprint(baseFingerprintString);
      results.push({
        id: fingerprint,
        ...mergedData,
        hash_fingerprint: fingerprint,
      });

      console.log(`[NYSCR] ✅ Details added for: ${item.title}`);
    } catch (err) {
      console.warn(
        `[NYSCR] ⚠️ Failed to scrape details for ${item.title}: ${err.message}`
      );

      const fingerprint = generateFingerprint(baseFingerprintString);
      results.push({
        id: fingerprint,
        ...item,
        hash_fingerprint: fingerprint,
      });
    }

    await page.waitForTimeout(500);
  }

  console.log(`\n✅ NYSCR scrape complete with ${results.length} records`);
  return results;
}

// Smooth scrolling helper
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
      }, 400);
    });
  });
}

module.exports = { scrapeNyscr };




// // src/scrapers/nyscr.js
// const { generateFingerprint } = require('../utils');

// const NYSCR_BASE_URL = 'https://www.nyscr.ny.gov';

// // 🔑 TESTING CREDENTIALS – hard-coded for now (REMOVE later)
// const NYSCR_USERNAME = 'zubaiirahmad@gmail.com';
// const NYSCR_PASSWORD = '0Ahmadzubair@00';

// /**
//  * Log in to NYSCR so we can see "View this ad" links and details.
//  * NO networkidle / load waits to avoid timeouts.
//  */

// async function loginNyscr(page) {
//   const username = NYSCR_USERNAME;
//   const password = NYSCR_PASSWORD;

//   if (!username || !password) {
//     throw new Error('[NYSCR] Username/password are required for login.');
//   }

//   console.log('[NYSCR] Logging in…');

//   await page.goto(`${NYSCR_BASE_URL}/Account/Login`, {
//     waitUntil: 'domcontentloaded',
//     timeout: 120000,
//   });

//   // 👉 Extra delay to look less "botty"
//   await page.waitForTimeout(2500);

//   // --- find username / password inputs ---
//   const usernameInput =
//     (await page.$('input[type="email"]')) ||
//     (await page.$('input[name="Username"], input[id="Username"]'));

//   if (!usernameInput) {
//     throw new Error('[NYSCR] Could not find username/email input on login page.');
//   }

//   const passwordInput =
//     (await page.$('input[type="password"]')) ||
//     (await page.$('input[name="Password"], input[id="Password"]'));

//   if (!passwordInput) {
//     throw new Error('[NYSCR] Could not find password input on login page.');
//   }

//   // 👉 Human-like typing for username
//   await usernameInput.click();
//   await usernameInput.fill('');                // clear field
//   await usernameInput.type(username, { delay: 120 }); // ~120ms per char

//   // small delay between fields
//   await page.waitForTimeout(800);

//   // 👉 Human-like typing for password
//   await passwordInput.click();
//   await passwordInput.fill('');
//   await passwordInput.type(password, { delay: 120 });

//   // one more short pause before submit
//   await page.waitForTimeout(800);

//   // --- submit the form ---

//   const submitButton =
//     (await page.$('button[type="submit"]')) ||
//     (await page.$('input[type="submit"]'));

//   if (!submitButton) {
//     throw new Error('[NYSCR] Could not find login submit button.');
//   }

//   await submitButton.click();

//   // Do NOT wait for networkidle / load; just give it a moment
//   await page.waitForTimeout(4000);

//   const currentUrl = page.url();
//   console.log('[NYSCR] Login step finished. Current URL:', currentUrl);

//   // Optional: log if we see the robot error text
//   const robotError = await page.$('text=Unable to verify that you are not a robot');
//   if (robotError) {
//     console.warn('[NYSCR] Site is showing "Unable to verify that you are not a robot".');
//   }
// }

// async function scrapeNyscr({ page, maxItems }) {
//   // 1) Log in automatically
//   await loginNyscr(page);

//   console.log('[NYSCR] Opening search page…');
//   const searchUrl = `${NYSCR_BASE_URL}/Ads/Search`;

//   await page.goto(searchUrl, {
//     waitUntil: 'domcontentloaded',
//     timeout: 120000,
//   });

//   await page.setViewportSize({ width: 1920, height: 1080 });
//   await page.waitForLoadState('domcontentloaded');
//   await page.waitForTimeout(2000);

//   const allItems = [];

//   // ---------- PAGINATION LOOP ----------
//   while (true) {
//     console.log('\n[NYSCR] New page of results');
//     await autoScroll(page);

//     // Make sure there is at least one title/card
//     const hasAny = await page.$(
//       '.flex-fill.min-w-0.px-2.py-1.bg-primary.text-light.fs-5.text-lg-truncate'
//     );
//     if (!hasAny) {
//       console.warn('[NYSCR] No result cards found, stopping.');
//       break;
//     }

//     // Extract list-level data: ONE item per card, based off the title element
//     const pageItems = await page.$$eval(
//       '.flex-fill.min-w-0.px-2.py-1.bg-primary.text-light.fs-5.text-lg-truncate',
//       (titleNodes) => {
//         const baseUrl = 'https://www.nyscr.ny.gov';

//         const getFieldFromCard = (card, labelText) => {
//           if (!card) return '';
//           const label = labelText.trim();

//           const candidates = Array.from(
//             card.querySelectorAll('div, span, p, dt, dd, b, strong')
//           );

//           const el = candidates.find((e) => {
//             const t = e.textContent.trim();
//             return t.startsWith(label);
//           });

//           if (!el) return '';

//           const raw = el.textContent.trim();
//           if (raw.length > label.length) {
//             return raw.replace(label, '').replace(/^[:\s]+/, '').trim();
//           }

//           const next = el.nextElementSibling;
//           return next ? next.textContent.trim() : '';
//         };

//         const items = [];

//         for (const titleEl of titleNodes) {
//           // Each title belongs to exactly one card. Use that as our anchor.
//           const card =
//             titleEl.closest('.ad-card') ||
//             titleEl.closest('.row') ||
//             titleEl.closest('.col-12') ||
//             titleEl.closest('div');

//           if (!card) continue;

//           // ✅ Clean, dynamic title per card
//           const fromAttr = titleEl.getAttribute('title') || '';
//           const fromText = titleEl.textContent || '';
//           const title = (fromAttr || fromText).replace(/\s+/g, ' ').trim();

//           const cr = getFieldFromCard(card, 'CR#:');
//           const agency = getFieldFromCard(card, 'Agency:');
//           const division = getFieldFromCard(card, 'Division:');
//           const issueDate = getFieldFromCard(card, 'Issue date:');
//           const dueDate = getFieldFromCard(card, 'Due date:');
//             //   const location = getFieldFromCard(card, 'Location:');
//           let location = '';
//           const locationRow = Array.from(card.querySelectorAll('.d-flex')).find((row) => {
//           const first = row.firstElementChild;
//           if (!first) return false;
//             return first.textContent.trim().startsWith('Location:');
//           });

//           if (locationRow) {
//             const divs = locationRow.querySelectorAll('div');
//             if (divs.length >= 2) {
//               location = divs[1].textContent.trim();
//             }
//           }

//           const category = getFieldFromCard(card, 'Category:');
//           const adType = getFieldFromCard(card, 'Ad type:');

//           // Find the primary action link inside THIS card
//           const actionLink = Array.from(
//             card.querySelectorAll('a.ad-action-link')
//           ).find((a) => {
//             const txt = a.textContent.toLowerCase();
//             return (
//               txt.includes('view this ad') ||
//               txt.includes('log in or sign up to view this opportunity')
//             );
//           });

//           let portal_url = '';
//           let login_required = false;
//           const href = actionLink?.getAttribute('href') || '';

//           if (href.startsWith('/Ads/Details')) {
//             portal_url = baseUrl + href;
//           } else if (href.startsWith('/Account/Login')) {
//             login_required = true;
//           }

//           items.push({
//             title: title || '',
//             project_reference: cr || '',
//             agency: agency || '',
//             division: division || '',
//             created_at: issueDate || '',
//             listing_expiry_date: dueDate || '',
//             location: location || '',
//             city: location || '',
//             category: category || '',
//             ad_type: adType || '',
//             region: 'New York', // NY-only portal
//             portal_url,
//             portal_source: 'NYSCR',
//             login_required,
//           });
//         }

//         return items;
//       }
//     );

//     console.log(`[NYSCR] Found ${pageItems.length} items on this page`);
//     if (!pageItems.length) break;

//     allItems.push(...pageItems);

//     if (maxItems > 0 && allItems.length >= maxItems) {
//       console.log(`[NYSCR] Reached maxItems (${maxItems}), stopping pagination.`);
//       break;
//     }

//     // Pagination: Next button
//     const nextButton = await page.$('button.Next.btn');

//     if (!nextButton) {
//       console.log('[NYSCR] No Next button found — last page.');
//       break;
//     }

//     const disabledAttr = await nextButton.getAttribute('disabled');
//     if (disabledAttr !== null && disabledAttr !== 'false') {
//       console.log('[NYSCR] Next button is disabled — last page.');
//       break;
//     }

//     console.log('[NYSCR] Clicking Next…');
//     await Promise.all([
//       nextButton.click(),
//       page.waitForLoadState('domcontentloaded'),
//     ]);
//     await page.waitForTimeout(1500);
//   }

//   console.log(`[NYSCR] Total collected list items: ${allItems.length}`);

//   const itemsToProcess = maxItems > 0 ? allItems.slice(0, maxItems) : allItems;
//   const results = [];

//   // ---------- DETAIL SCRAPE LOOP ----------
//   for (let i = 0; i < itemsToProcess.length; i++) {
//     const item = itemsToProcess[i];
//     console.log(
//       `\n[NYSCR] Processing ${i + 1}/${itemsToProcess.length}: "${item.title}"`
//     );

//     const baseFingerprintString = `${item.title}${item.project_reference || ''}${
//       item.listing_expiry_date || ''
//     }nyscr`;

//     // If there is no public detail URL or it requires login again, keep list-level info
//     if (!item.portal_url || item.login_required) {
//       const fingerprint = generateFingerprint(baseFingerprintString);
//       results.push({
//         id: fingerprint,
//         ...item,
//         detailed_description: item.login_required
//           ? 'Login required to view full ad details.'
//           : '',
//         hash_fingerprint: fingerprint,
//       });
//       continue;
//     }

//     try {
//       await page.goto(item.portal_url, {
//         waitUntil: 'domcontentloaded',
//         timeout: 120000,
//       });

//       await page.waitForLoadState('domcontentloaded');
//       await page.waitForTimeout(1000);

//       // If we got bounced back to login, treat as login-required
//       if (page.url().includes('/Account/Login')) {
//         console.warn(
//           `[NYSCR] Redirected to login while opening details for "${item.title}".`
//         );
//         const fingerprint = generateFingerprint(baseFingerprintString);
//         results.push({
//           id: fingerprint,
//           ...item,
//           detailed_description: 'Login required to view full ad details.',
//           hash_fingerprint: fingerprint,
//         });
//         continue;
//       }

//       const detailData = await page.evaluate(() => {
//         const getField = (labelText) => {
//           const label = labelText.trim().toLowerCase();
//           const candidates = Array.from(
//             document.querySelectorAll(
//               'div, span, p, dt, dd, b, strong, th, td'
//             )
//           );

//           const el = candidates.find((e) => {
//             const t = e.textContent.trim().toLowerCase();
//             return t.startsWith(label);
//           });

//           if (!el) return '';

//           const raw = el.textContent.trim();
//           if (raw.length > label.length) {
//             return raw.replace(labelText, '').replace(/^[:\s]+/, '').trim();
//           }

//           const next = el.nextElementSibling;
//           return next ? next.textContent.trim() : '';
//         };

//         const descriptionEl =
//           document.querySelector('.ad-body, .ad-description, #AdText') ||
//           document.querySelector('main');

//         const detailed_description =
//           descriptionEl?.innerText.trim() ||
//           document.body.innerText.trim().slice(0, 5000);

//         let contact_person = '';
//         let contact_phone = '';
//         let contact_email = '';

//         const textChunks = detailed_description
//           .split(/\n+/)
//           .map((t) => t.trim())
//           .filter(Boolean);

//         for (const line of textChunks) {
//           if (!contact_email && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(line)) {
//             contact_email = line.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)[0];
//           }
//           if (!contact_phone && /(\+?\d[\d\s\-().]{6,})/.test(line)) {
//             contact_phone = line.match(/(\+?\d[\d\s\-().]{6,})/)[0];
//           }
//           if (!contact_person && /^contact/i.test(line)) {
//             contact_person = line.replace(/^contact[:\s-]*/i, '').trim();
//           }
//         }

//         const division_detail = getField('Division:');
//         const category_detail = getField('Category:');

//         return {
//           division_detail,
//           category_detail,
//           contact_person,
//           contact_phone,
//           contact_email,
//           detailed_description,
//         };
//       });

//       const mergedData = {
//         ...item,
//         ...detailData,
//       };

//       if (detailData.division_detail && !mergedData.division) {
//         mergedData.division = detailData.division_detail;
//       }
//       if (detailData.category_detail && !mergedData.category) {
//         mergedData.category = detailData.category_detail;
//       }

//       const fingerprint = generateFingerprint(baseFingerprintString);
//       results.push({
//         id: fingerprint,
//         ...mergedData,
//         hash_fingerprint: fingerprint,
//       });

//       console.log(`[NYSCR] ✅ Details added for: ${item.title}`);
//     } catch (err) {
//       console.warn(
//         `[NYSCR] ⚠️ Failed to scrape details for ${item.title}: ${err.message}`
//       );

//       const fingerprint = generateFingerprint(baseFingerprintString);
//       results.push({
//         id: fingerprint,
//         ...item,
//         hash_fingerprint: fingerprint,
//       });
//     }

//     await page.waitForTimeout(500);
//   }

//   console.log(`\n✅ NYSCR scrape complete with ${results.length} records`);
//   return results;
// }

// // Smooth scrolling helper
// async function autoScroll(page) {
//   await page.evaluate(async () => {
//     await new Promise((resolve) => {
//       let totalHeight = 0;
//       const distance = 400;
//       const timer = setInterval(() => {
//         const scrollHeight = document.body.scrollHeight;
//         window.scrollBy(0, distance);
//         totalHeight += distance;
//         if (totalHeight >= scrollHeight - window.innerHeight) {
//           clearInterval(timer);
//           resolve();
//         }
//       }, 400);
//     });
//   });
// }

// module.exports = { scrapeNyscr };
