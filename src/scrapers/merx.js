const { generateFingerprint } = require('../utils');

/**
 * Merx Scraper
 * Scrapes open solicitations from https://www.merx.com/public/solicitations/open
 */
async function scrapeMerx({ page, maxItems, webhookUrl, webhookSecret }) {
  console.log('Opening Merx Portal...');
  const merxUrl = 'https://www.merx.com/public/solicitations/open';

  await page.goto(merxUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(5000); // Give client time

  console.log('Page loaded. Current URL:', page.url());

  // Handle possible redirects (language/login)
  if (page.url().includes('language') || page.url().includes('signin')) {
    console.warn('Redirected to another page, navigating again...');
    await page.goto(merxUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
  }

  // ---- COLLECT LISTINGS ACROSS ALL PAGES ----
  console.log('Collecting listing items across pages...');
  const allItems = [];

  while (true) {
    console.log('Scrolling to load listings on current page...');
    await autoScroll(page);

    // Ensure listing markup is present
    const found = await page.$('.simpleSolResultsItemInfo');
    if (!found) {
      console.warn('⚠️ No .simpleSolResultsItemInfo found on this page, trying fallback selector...');
      await page.waitForSelector('.simpleSolResultsItemInfo, .solResultsItem, .mainCol', {
        timeout: 180000,
      });
    }

    console.log('Extracting solicitation list for this page...');
    const pageItems = await page.$$eval('.simpleSolResultsItemInfo', (nodes) =>
      nodes.map((el) => {
        const mainCol = el.closest('.mainCol');
        const link = mainCol?.querySelector('.solicitation-link.mets-command-link');
        const href = link ? link.getAttribute('href') : '';

        return {
          title: el.querySelector('.rowTitle')?.innerText.trim() || '',
          agency: el.querySelector('.buyer-name')?.innerText.trim() || '',
          region: el.querySelector('.location')?.innerText.trim() || '',
          created_at:
            el.querySelector('.publicationDate .dateValue')?.innerText.trim() || '',
          listing_expiry_date:
            el.querySelector('.closingDate .dateValue')?.innerText.trim() || '',
          daysLeft: el.querySelector('.timeRemaining')?.innerText.trim() || '',
          project_reference:
            el.querySelector('.accessibility-hidden')?.innerText.trim() || '',
          portal_url: href ? `https://www.merx.com${href}` : '',
          portal_source: 'Merx',
        };
      })
    );

    console.log(`Found ${pageItems.length} opportunities on this page`);
    allItems.push(...pageItems);

    // Stop if we hit maxItems
    if (maxItems > 0 && allItems.length >= maxItems) {
      console.log(`Reached maxItems limit (${maxItems}), stopping pagination.`);
      break;
    }

    // Try to find "Next" button
    const nextButton = await page.$('.mets-page-navigation-next a.next');

    if (!nextButton) {
      console.log('No Next button found — reached last page.');
      break;
    }

    const isDisabled = await nextButton.getAttribute('aria-disabled');
    if (isDisabled === 'true') {
      console.log('Next button disabled — reached last page.');
      break;
    }

    console.log('Going to next page of Merx results...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 }),
      nextButton.click(),
    ]);

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
  }

  console.log(`Total collected opportunities from all pages: ${allItems.length}`);

  const itemsToProcess =
    maxItems > 0 ? allItems.slice(0, maxItems) : allItems;

  // ---- DETAIL SCRAPING (unchanged except using itemsToProcess) ----
  const results = [];

  for (let i = 0; i < itemsToProcess.length; i++) {
    const item = itemsToProcess[i];
    console.log(`\n--- Processing ${i + 1}/${itemsToProcess.length}: "${item.title}" ---`);

    if (!item.portal_url) continue;

    try {
      await page.goto(item.portal_url, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });

      // detect login popup
      const loginPopup = await page
        .locator('.mets-dialog-title, :text("Login Required")')
        .first();
      if (await loginPopup.isVisible()) {
        console.warn(`⚠️ Login required for ${item.title}`);
        results.push({
          ...item,
          detailed_description:
            'Login or subscription required to access this solicitation.',
        });
        continue;
      }

      await page.waitForSelector('.mets-field-label', { timeout: 30000 });

      const detailData = await page.evaluate(() => {
        const getField = (label) => {
          const el = Array.from(document.querySelectorAll('.mets-field-label')).find(
            (e) => e.textContent.trim() === label
          );
          return el
            ? el
                .closest('.mets-field')
                ?.querySelector('.mets-field-body p')
                ?.innerText.trim() || ''
            : '';
        };

        let contact_person = '';
        let contact_phone = '';
        let contact_email = '';

        const contactPs = Array.from(
          document.querySelectorAll('.twoColFields .no-label .mets-field-body > p')
        )
          .map((p) => p.innerText.trim())
          .filter(Boolean);

        for (const text of contactPs) {
          if (!contact_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
            contact_email = text;
          } else if (!contact_phone && /\b\d{3}-\d{3}-\d{4}\b/.test(text)) {
            contact_phone = text.match(/\b\d{3}-\d{3}-\d{4}\b/)[0];
          } else if (!contact_person && /^[A-Za-z\s.'-]+$/.test(text)) {
            contact_person = text;
          }
        }

        return {
          project_reference_detail: getField('Solicitation Number'),
          buyer_organization_detail: getField('Issuing Organization'),
          project_type: getField('Solicitation Type'),
          agreement_type: getField('Agreement Type'),
          city: getField('Location'),
          contact_person,
          contact_phone,
          contact_email,
          detailed_description:
            document.querySelector('#descriptionText')?.innerText.trim() || '',
        };
      });

      const mergedData = {
        ...item,
        ...detailData,
      };

      const fingerprint = generateFingerprint(
        `${mergedData.title}${mergedData.project_reference}${
          mergedData.listing_expiry_date || ''
        }`
      );

      results.push({
        id: fingerprint,
        ...mergedData,
        hash_fingerprint: fingerprint,
      });

      console.log(`✅ Details added for: ${item.title}`);
    } catch (err) {
      console.warn(`⚠️ Failed to scrape details for ${item.title}: ${err.message}`);

      const fingerprint = generateFingerprint(
        `${item.title}${item.project_reference}${item.listing_expiry_date || ''}`
      );

      results.push({
        id: fingerprint,
        ...item,
        hash_fingerprint: fingerprint,
      });
    }

    await page.waitForTimeout(1000);
  }

  console.log(`\n✅ Merx scrape complete with ${results.length} records`);
  return results;
}

// Smooth scrolling helper (unchanged)
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

module.exports = { scrapeMerx };


// const { generateFingerprint } = require('../utils');

// /**
//  * Merx Scraper
//  * Scrapes open solicitations from https://www.merx.com/public/solicitations/open
//  */
// async function scrapeMerx({ page, maxItems, webhookUrl, webhookSecret }) {
//   console.log('Opening Merx Portal...');
//   const merxUrl = 'https://www.merx.com/public/solicitations/open';

//   await page.goto(merxUrl, {
//     // waitUntil: 'networkidle',
//     waitUntil: 'domcontentloaded',
//     timeout: 120000,
//   });

//   await page.setViewportSize({ width: 1920, height: 1080 });
//   await page.waitForLoadState('networkidle');
//   await page.waitForTimeout(5000); // Give React client time
//   // console.log('Post-load DOM check:', await page.content().length);

//   console.log('Page loaded. Current URL:', page.url());

//   // Handle possible redirects (language/login)
//   if (page.url().includes('language') || page.url().includes('signin')) {
//     console.warn('Redirected to another page, navigating again...');
//     await page.goto('https://www.merx.com/public/solicitations/open', {
//       waitUntil: 'domcontentloaded',
//       timeout: 120000,
//     });
//   }

//   console.log('Scrolling to load all listings...');
//   await autoScroll(page);

//   const html = await page.content();
//   if (!html.includes('solResults')) {
//     console.warn('⚠️ No listing markup found — site likely blocked headless or JS not loaded');
//   }

//   console.log('Waiting for listings...');
//   const found = await page.$('.simpleSolResultsItemInfo');
//   if (!found) {
//     console.warn('⚠️ Fallback: trying alternative selector...');
//     await page.waitForSelector('.simpleSolResultsItemInfo, .solResultsItem, .mainCol', {
//       timeout: 180000,
//     });
//   }

//   // await page.waitForSelector('.simpleSolResultsItemInfo', { timeout: 120000 });

//   // === Extract list items ===
//   console.log('Extracting solicitation list...');
//   const items = await page.$$eval('.simpleSolResultsItemInfo', (nodes) =>
//     nodes.map((el) => {
//       const mainCol = el.closest('.mainCol');
//       const link = mainCol?.querySelector('.solicitation-link.mets-command-link');
//       const href = link ? link.getAttribute('href') : '';

//       return {
//         title: el.querySelector('.rowTitle')?.innerText.trim() || '',
//         agency: el.querySelector('.buyer-name')?.innerText.trim() || '',
//         region: el.querySelector('.location')?.innerText.trim() || '',
//         created_at:
//           el.querySelector('.publicationDate .dateValue')?.innerText.trim() || '',
//         listing_expiry_date:
//           el.querySelector('.closingDate .dateValue')?.innerText.trim() || '',
//         daysLeft: el.querySelector('.timeRemaining')?.innerText.trim() || '',
//         project_reference: el.querySelector('.accessibility-hidden')?.innerText.trim() || '',
//         portal_url: href ? `https://www.merx.com${href}` : '',
//         portal_source: 'Merx',
//       };
//     })
//   );

//   console.log(`Found ${items.length} opportunities`);
//   const results = [];

//   const itemsToProcess = maxItems > 0 ? items.slice(0, maxItems) : items;

//   for (let i = 0; i < itemsToProcess.length; i++) {
//     const item = itemsToProcess[i];
//     console.log(`\n--- Processing ${i + 1}/${itemsToProcess.length}: "${item.title}" ---`);

//     if (!item.portal_url) continue;

//     try {
//       await page.goto(item.portal_url, { waitUntil: 'domcontentloaded', timeout: 120000 });

//       // detect login popup
//       const loginPopup = await page.locator('.mets-dialog-title, :text("Login Required")').first();
//       if (await loginPopup.isVisible()) {
//         console.warn(`⚠️ Login required for ${item.title}`);
//         results.push({
//           ...item,
//           detailed_description:
//             'Login or subscription required to access this solicitation.',
//         });
//         continue;
//       }

//       await page.waitForSelector('.mets-field-label', { timeout: 30000 });

//       const detailData = await page.evaluate(() => {
//         const getField = (label) => {
//           const el = Array.from(document.querySelectorAll('.mets-field-label'))
//             .find((e) => e.textContent.trim() === label);
//           return el
//             ? el.closest('.mets-field')?.querySelector('.mets-field-body p')?.innerText.trim() || ''
//             : '';
//         };

//         let contact_person = '';
//         let contact_phone = '';
//         let contact_email = '';

//         const contactPs = Array.from(
//           document.querySelectorAll('.twoColFields .no-label .mets-field-body > p')
//         )
//           .map((p) => p.innerText.trim())
//           .filter(Boolean);

//         for (const text of contactPs) {
//           if (!contact_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
//             contact_email = text;
//           } else if (!contact_phone && /\b\d{3}-\d{3}-\d{4}\b/.test(text)) {
//             contact_phone = text.match(/\b\d{3}-\d{3}-\d{4}\b/)[0];
//           } else if (!contact_person && /^[A-Za-z\s.'-]+$/.test(text)) {
//             contact_person = text;
//           }
//         }

//         return {
//           project_reference_detail: getField('Solicitation Number'),
//           buyer_organization_detail: getField('Issuing Organization'),
//           project_type: getField('Solicitation Type'),
//           agreement_type: getField('Agreement Type'),
//           city: getField('Location'),
//           contact_person,
//           contact_phone,
//           contact_email,
//           detailed_description: document.querySelector('#descriptionText')?.innerText.trim() || '',
//         };
//       });

//       const mergedData = {
//         ...item,
//         ...detailData,
//       };

//       const fingerprint = generateFingerprint(
//         `${mergedData.title}${mergedData.project_reference}${mergedData.listing_expiry_date || ''}`
//       );

//       results.push({
//         id: fingerprint,
//         ...mergedData,
//         hash_fingerprint: fingerprint,
//       });

//       console.log(`✅ Details added for: ${item.title}`);
//     } catch (err) {
//       console.warn(`⚠️ Failed to scrape details for ${item.title}: ${err.message}`);

//       const fingerprint = generateFingerprint(
//         `${item.title}${item.project_reference}${item.listing_expiry_date || ''}`
//       );

//       results.push({
//         id: fingerprint,
//         ...item,
//         hash_fingerprint: fingerprint,
//       });
//     }

//     await page.waitForTimeout(1000);
//   }

//   console.log(`\n✅ Merx scrape complete with ${results.length} records`);
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
//       }, 500);
//     });
//   });
// }

// module.exports = { scrapeMerx };