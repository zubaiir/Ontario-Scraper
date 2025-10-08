const { Actor, Dataset } = require('apify');
const { chromium } = require('playwright');
const crypto = require('crypto');

Actor.main(async () => {
  const input = await Actor.getInput();
  
  // Make webhook optional for testing
  const { 
    webhookUrl = '', 
    webhookSecret = '', 
    maxItems = 5,  // Default to 5 items for testing
    debug = true   // Default to debug mode for testing
  } = input || {};

  console.log('=== Ontario Tenders Scraper Started ===');
  console.log(`Debug mode: ${debug}`);
  console.log(`Max items: ${maxItems || 'all'}`);
  console.log(`Webhook configured: ${webhookUrl ? 'Yes' : 'No (test mode)'}`);
  console.log('=====================================\n');

  try {
    // Launch browser
    const browser = await chromium.launch({ 
      headless: !debug, 
      slowMo: debug ? 150 : 0 
    });
    
    const page = await browser.newPage();

    console.log('Opening Ontario Tenders Portal...');
    await page.goto('https://ontariotenders.app.jaggaer.com/esop/nac-host/public/home.html', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Step 1: Select English
    const english = page.locator('a:has-text("English")');
    if (await english.isVisible().catch(() => false)) {
      console.log('Selecting English...');
      await english.click();
      await page.waitForLoadState('domcontentloaded');
    }

    // Step 2: Navigate to Current Opportunities
    const currentOpp = page.locator('a:has-text("Current Opportunities")');
    await currentOpp.waitFor({ timeout: 20000 });
    console.log('Navigating to Current Opportunities...');
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      currentOpp.click(),
    ]);

    // Step 3: Switch to accessible mode if needed
    await page.waitForTimeout(4000);
    const accessibleLink = page.locator('a:has-text("Switch To Accessible Controls")');
    if (await accessibleLink.isVisible().catch(() => false)) {
      console.log('Switching to accessible view...');
      await accessibleLink.click();
      await page.waitForLoadState('domcontentloaded');
    }

    // Step 4: Wait for table
    console.log('Waiting for table...');
    await page.waitForSelector('table tr', { timeout: 60000 });

    // Step 5: Extract data
    const items = await page.$$eval('table tr', (rows) => {
      const data = [];
      for (const r of rows.slice(1)) {
        const cells = Array.from(r.querySelectorAll('td')).map((c) =>
          (c.textContent || '').trim()
        );
        if (cells.length < 7) continue;

        const [
          procurementRoute,
          buyerOrganization,
          projectReference,
          projectTitle,
          publicationDate,
          workCategory,
          expiryDate,
        ] = cells;

        const linkEl = r.querySelector('a');
        const href = linkEl ? (linkEl.getAttribute('href') || '') : '';
        const title = linkEl ? (linkEl.textContent || '').trim() : projectTitle;

        data.push({
          procurement_route: procurementRoute,
          buyer_organization: buyerOrganization,
          project_reference: projectReference,
          title,
          publication_date: publicationDate,
          work_category: workCategory,
          listing_expiry_date: expiryDate,
          portal_url: href
            ? href.startsWith('http')
              ? href
              : `https://ontariotenders.app.jaggaer.com${href}`
            : 'https://ontariotenders.app.jaggaer.com/',
        });
      }
      return data;
    });

    // Step 6: Process and format data
    let results = items.map((r) => {
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${r.title}${r.project_reference}${r.listing_expiry_date}`)
        .digest('hex')
        .slice(0, 40);
      
      return {
        id: fingerprint,
        key: r.project_reference || fingerprint,
        ...r,
        region: 'CA-ON',
        portal_source: 'OTP/JAGGAER',
        hash_fingerprint: fingerprint,
      };
    });

    // Apply maxItems limit if specified
    if (maxItems > 0) {
      results = results.slice(0, maxItems);
    }

    console.log(`Scraped ${results.length} opportunities`);
    
    // Log the first few results for debugging
    console.log('\n========== SCRAPED DATA PREVIEW ==========');
    console.log(`Total items found: ${results.length}`);
    
    // Log first 3 items in detail
    const previewCount = Math.min(3, results.length);
    for (let i = 0; i < previewCount; i++) {
      console.log(`\n--- Item ${i + 1} ---`);
      console.log(JSON.stringify(results[i], null, 2));
    }
    
    if (results.length > 3) {
      console.log(`\n... and ${results.length - 3} more items`);
    }
    console.log('\n========================================\n');

    // Save to dataset for backup
    await Dataset.pushData(results);
    
    // Check if webhook is configured
    if (webhookUrl && webhookUrl.trim() !== '') {
      console.log(`Webhook URL configured: ${webhookUrl}`);
      console.log('SKIPPING webhook call for testing - data logged above');
      
      // Uncomment below to enable webhook sending
      /*
      // Send data to webhook in batches
      const BATCH_SIZE = 10;
      const batches = [];
      
      for (let i = 0; i < results.length; i += BATCH_SIZE) {
        batches.push(results.slice(i, i + BATCH_SIZE));
      }

      console.log(`Would send data in ${batches.length} batches of up to ${BATCH_SIZE} items each`);
      
      // Actual webhook sending code here...
      */
    } else {
      console.log('No webhook URL provided - data collection complete');
    }
    
    // Store summary in key-value store
    await Actor.setValue('OUTPUT', {
      scraped: results.length,
      timestamp: new Date().toISOString(),
      webhookUrl,
    });

    await browser.close();
    
  } catch (error) {
    console.error('Scraper error:', error);
    throw error;
  }
});
