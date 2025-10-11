const { formatDateForSupabase, crypto } = require('../main');

/**
 * [SOURCE NAME] Scraper
 * Scrapes opportunities from [SOURCE URL]
 * 
 * @param {Object} params - Scraper parameters
 * @param {Object} params.page - Playwright page object
 * @param {number} params.maxItems - Maximum items to scrape (0 for all)
 * @param {string} params.webhookUrl - Webhook URL (optional)
 * @param {string} params.webhookSecret - Webhook secret (optional)
 * @returns {Promise<Array>} Array of scraped opportunities
 */
async function scrapeNewSource({ page, maxItems, webhookUrl, webhookSecret }) {
  console.log('Opening [SOURCE NAME] Portal...');
  
  // Step 1: Navigate to the portal
  await page.goto('[SOURCE_URL]', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  // Step 2: Perform any necessary navigation (login, language selection, etc.)
  // Example:
  // const loginButton = page.locator('a:has-text("Login")');
  // await loginButton.click();

  // Step 3: Wait for and extract list items
  console.log('Waiting for opportunities list...');
  await page.waitForSelector('[LIST_SELECTOR]', { timeout: 60000 });

  // Extract basic data from list
  const items = await page.evaluate(() => {
    const data = [];
    const resultElements = document.querySelectorAll('[ITEM_SELECTOR]');
    
    resultElements.forEach((result) => {
      // Extract fields from list item
      const title = result.querySelector('[TITLE_SELECTOR]')?.textContent.trim() || '';
      const agency = result.querySelector('[AGENCY_SELECTOR]')?.textContent.trim() || '';
      const detailUrl = result.querySelector('a')?.getAttribute('href') || '';
      
      // Add more fields as needed
      
      if (title && detailUrl) {
        data.push({
          title,
          agency,
          status: 'Active', // or extract from page
          project_reference: '', // extract reference number
          created_at: '', // extract publication date
          category: '', // extract category
          listing_expiry_date: '', // extract expiry date
          detailUrl,
          portal_url: '[PORTAL_BASE_URL]',
          city: '[DEFAULT_CITY]',
          portal_source: '[SOURCE_NAME]',
        });
      }
    });
    
    return data;
  });

  console.log(`Found ${items.length} opportunities in list`);

  // Step 4: Process each opportunity detail page
  const results = [];
  const itemsToProcess = maxItems > 0 ? items.slice(0, maxItems) : items;

  for (let i = 0; i < itemsToProcess.length; i++) {
    const item = itemsToProcess[i];
    console.log(`\n--- Processing ${i + 1}/${itemsToProcess.length}: "${item.title}" ---`);

    try {
      // Navigate to detail page
      const fullDetailUrl = `[BASE_URL]${item.detailUrl}`;
      console.log(`Navigating to detail page...`);
      
      await page.goto(fullDetailUrl, {
        waitUntil: 'networkidle',
        timeout: 60000,
      });

      await page.waitForTimeout(3000);

      // Extract detailed information
      const detailData = await page.evaluate(() => {
        // Helper function to find field by label
        const getFieldByLabel = (labelText) => {
          const labels = document.querySelectorAll('[LABEL_SELECTOR]');
          for (const label of labels) {
            if (label.textContent.includes(labelText)) {
              // Find value element (adjust selector as needed)
              const value = label.nextElementSibling?.textContent.trim();
              return value || '';
            }
          }
          return '';
        };

        return {
          // Extract all detail fields
          project_code: getFieldByLabel('Project Code'),
          project_reference_detail: getFieldByLabel('Project Reference'),
          project_type: getFieldByLabel('Project Type'),
          detailed_description: getFieldByLabel('Description'),
          scope_of_work: getFieldByLabel('Scope of Work'),
          contact_person: getFieldByLabel('Contact Person'),
          contact_email: getFieldByLabel('Email'),
          contact_phone: getFieldByLabel('Phone'),
          // Add more fields as needed
        };
      });

      console.log(`Extracted ${Object.keys(detailData).filter(k => detailData[k]).length} detail fields`);

      // Merge basic and detailed data
      const mergedData = {
        title: item.title,
        agency: detailData.buyer_organization || item.agency,
        status: detailData.status || item.status,
        project_reference: detailData.project_reference_detail || item.project_reference,
        created_at: formatDateForSupabase(detailData.published_date || item.created_at),
        category: detailData.category || item.category,
        listing_expiry_date: formatDateForSupabase(detailData.expiry_date || item.listing_expiry_date),
        portal_url: fullDetailUrl,
        city: detailData.location || item.city,
        portal_source: '[SOURCE_NAME]',
        
        // Additional fields
        ...detailData,
      };

      // Generate fingerprint
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${mergedData.title}${mergedData.project_reference}${mergedData.listing_expiry_date || ''}`)
        .digest('hex')
        .slice(0, 40);

      results.push({
        id: fingerprint,
        ...mergedData,
        hash_fingerprint: fingerprint,
      });

      console.log(`✅ Successfully processed`);

      // Go back to list
      await page.goBack();
      await page.waitForSelector('[LIST_SELECTOR]', { timeout: 30000 });
      await page.waitForTimeout(2000);

    } catch (error) {
      console.error(`❌ Failed to process "${item.title}":`, error.message);
      
      // Save basic data if detail extraction fails
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${item.title}${item.project_reference}${item.listing_expiry_date || ''}`)
        .digest('hex')
        .slice(0, 40);

      results.push({
        id: fingerprint,
        ...item,
        created_at: formatDateForSupabase(item.created_at),
        listing_expiry_date: formatDateForSupabase(item.listing_expiry_date),
        portal_url: fullDetailUrl,
        hash_fingerprint: fingerprint,
      });

      // Try to go back to list
      try {
        await page.goBack();
        await page.waitForSelector('[LIST_SELECTOR]', { timeout: 30000 });
      } catch (e) {
        // Reload list page if going back fails
        await page.goto('[LIST_PAGE_URL]', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[LIST_SELECTOR]', { timeout: 30000 });
      }
    }
  }

  return results;
}

module.exports = { scrapeNewSource };
