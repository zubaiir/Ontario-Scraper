const { Actor, Dataset } = require('apify');
const { chromium } = require('playwright');
const crypto = require('crypto');

Actor.main(async () => {
  const input = await Actor.getInput();
  
  const { 
    webhookUrl = '', 
    webhookSecret = '', 
    maxItems = 5,
    debug = false
  } = input || {};

  console.log('=== Ontario Tenders Scraper Started ===');
  console.log(`Debug mode: ${debug}`);
  console.log(`Max items: ${maxItems || 'all'}`);
  console.log(`Webhook configured: ${webhookUrl ? 'Yes' : 'No (test mode)'}`);
  console.log('=====================================\n');

  try {
    const browser = await chromium.launch({ 
      headless: true
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

    // Step 4: Wait for table and extract basic data
    console.log('Waiting for table...');
    await page.waitForSelector('table tr', { timeout: 60000 });

    // Step 5: Extract basic data
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
          title,
          agency: buyerOrganization,
          status: procurementRoute,
          project_reference: projectReference,
          created_at: publicationDate,
          category: workCategory,
          listing_expiry_date: expiryDate,
          // portal_url: href && href !== '#fh'
          //   ? (href.startsWith('http') ? href : `https://ontariotenders.app.jaggaer.com${href}`)
          //   : 'https://ontariotenders.app.jaggaer.com/esop/toolkit/opportunity/current/list.si',
          portal_url: "https://ontariotenders.app.jaggaer.com/esop/nac-host/public/home.html",
          city: 'Ontario',
          portal_source: 'Ontario Tenders Portal',
        });
      }
      return data;
    });

    console.log(`Found ${items.length} opportunities in table`);

    // Step 5b: Now get details for each opportunity
    const results = [];
    const itemsToProcess = maxItems > 0 ? items.slice(0, maxItems) : items;
    // const itemsToProcess = items.slice(0, 5);

    for (let i = 0; i < itemsToProcess.length; i++) {
      const item = itemsToProcess[i];
      console.log(`\n--- Processing ${i + 1}/${itemsToProcess.length}: "${item.title}" ---`);

      try {
        // Wait for table to be fully loaded first
        await page.waitForSelector('table tr', { timeout: 15000 });
        
        // Get ALL rows and find the correct one
        const allRows = await page.$$('table tr');
        
        // Use index-based approach (more reliable) - skip header row
        const targetRowIndex = i + 1;
        
        if (targetRowIndex >= allRows.length) {
          console.log('Row index out of bounds, skipping');
          
          // If we can't find by index, save basic data and continue
          const fingerprint = crypto
            .createHash('sha256')
            .update(`${item.title}${item.project_reference}${item.listing_expiry_date}`)
            .digest('hex')
            .slice(0, 40);

          results.push({
            id: fingerprint,
            ...item,
            hash_fingerprint: fingerprint,
          });
          continue;
        }

        let row = allRows[targetRowIndex];
        let rowTitle = '';
        
        // Try to get the title from the row to verify it's correct
        try {
          rowTitle = await row.$eval('a', link => link.textContent.trim());
        } catch (e) {
          console.log('Could not extract title from row, using index-based approach');
        }

        // Verify this is roughly the correct row using fuzzy matching
        const expectedTitle = item.title;
        const isMatch = rowTitle && (
          rowTitle.includes(expectedTitle.substring(0, 30)) || 
          expectedTitle.includes(rowTitle.substring(0, 30)) ||
          rowTitle.length > 10 // If we have some title, assume it's correct
        );
        
        if (!isMatch && rowTitle) {
          console.log(`Title mismatch: expected "${expectedTitle.substring(0, 50)}...", found "${rowTitle.substring(0, 50)}..."`);
          console.log('Trying to find correct row by scanning all rows...');
          
          // Fallback: scan all rows for matching title
          let foundRow = null;
          for (let j = 1; j < allRows.length; j++) {
            try {
              const currentRow = allRows[j];
              const currentTitle = await currentRow.$eval('a', link => link.textContent.trim());
              
              if (currentTitle && (
                currentTitle.includes(expectedTitle.substring(0, 30)) || 
                expectedTitle.includes(currentTitle.substring(0, 30))
              )) {
                foundRow = currentRow;
                console.log(`Found matching row at index ${j}`);
                break;
              }
            } catch (e) {
              // Skip rows that can't be read
              continue;
            }
          }
          
          if (foundRow) {
            row = foundRow;
          } else {
            console.log('Could not find matching row by scanning, using index-based row');
          }
        }

        // Click the link
        const link = await row.$('a');
        if (!link) {
          console.log('No link found in row, saving basic data only');
          const fingerprint = crypto
            .createHash('sha256')
            .update(`${item.title}${item.project_reference}${item.listing_expiry_date}`)
            .digest('hex')
            .slice(0, 40);

          results.push({
            id: fingerprint,
            ...item,
            hash_fingerprint: fingerprint,
          });
          continue;
        }

        console.log(`Clicking on: "${rowTitle || 'link'}"`);
        await link.click();
        
        // Wait for detail page to load with better timeout handling
        await page.waitForTimeout(4000);
        
        // Try multiple selectors for detail content
        const detailSelectors = [
          '.formRead',
          '.form_container',
          '.opportunity-details',
          'form',
          'table',
          '.form_question_label', // More specific selector
          '.form_answer'
        ];

        let detailContentFound = false;
        for (const selector of detailSelectors) {
          const element = await page.$(selector);
          if (element) {
            detailContentFound = true;
            console.log(`Found detail content using selector: ${selector}`);
            break;
          }
        }

        if (!detailContentFound) {
          console.log('No detail content found, using basic data only');
          const fingerprint = crypto
            .createHash('sha256')
            .update(`${item.title}${item.project_reference}${item.listing_expiry_date}`)
            .digest('hex')
            .slice(0, 40);

          results.push({
            id: fingerprint,
            ...item,
            hash_fingerprint: fingerprint,
          });
          
          // Try to go back to list
          try {
            await page.goBack();
            await page.waitForSelector('table tr', { timeout: 15000 });
            await page.waitForTimeout(1000);
          } catch (backError) {
            console.log('Failed to go back, reloading list page...');
            await page.goto('https://ontariotenders.app.jaggaer.com/esop/toolkit/opportunity/current/list.si', {
              waitUntil: 'domcontentloaded'
            });
            await page.waitForSelector('table tr', { timeout: 15000 });
          }
          continue;
        }

        // Extract detailed information
        const detailData = await page.evaluate(() => {
          // Function to find value by label text
          const findValueByLabel = (labelText) => {
            // Get all elements that might be labels
            const allElements = Array.from(document.querySelectorAll('*'));
            
            for (const element of allElements) {
              if (element.textContent?.trim() === labelText) {
                // Look for the value in different possible locations
                const parent = element.parentElement;
                const row = element.closest('tr');
                const listItem = element.closest('li');
                
                // Check different containers
                const containers = [row, listItem, parent].filter(Boolean);
                
                for (const container of containers) {
                  // Look for value elements with common class names
                  const valueSelectors = [
                    '.form_answer',
                    '.answer',
                    '.value',
                    '.data',
                    'td:last-child',
                    'span',
                    'div'
                  ];
                  
                  for (const selector of valueSelectors) {
                    const valueElement = container.querySelector(selector);
                    if (valueElement && valueElement !== element) {
                      const text = valueElement.textContent?.trim();
                      if (text && text !== labelText) {
                        return text;
                      }
                    }
                  }
                  
                  // If no specific selector works, try to find any element that's not the label
                  const allChildren = Array.from(container.children);
                  for (const child of allChildren) {
                    if (child !== element && child.textContent?.trim() && child.textContent.trim() !== labelText) {
                      return child.textContent.trim();
                    }
                  }
                }
              }
            }
            return '';
          };

          // Function to find multiple values (for categories, etc.)
          const findMultipleValues = (labelText) => {
            const values = [];
            const allElements = Array.from(document.querySelectorAll('*'));
            
            for (const element of allElements) {
              if (element.textContent?.trim() === labelText) {
                const container = element.closest('tr, li, div');
                if (container) {
                  const valueElements = container.querySelectorAll('div, span, li');
                  valueElements.forEach(el => {
                    const text = el.textContent?.trim();
                    if (text && text !== labelText && !values.includes(text)) {
                      values.push(text);
                    }
                  });
                }
              }
            }
            return values;
          };

          return {
            project_code: findValueByLabel('Project Code'),
            project_reference_detail: findValueByLabel('Project Reference'),
            project_type: findValueByLabel('Project Type'),
            project_categories: findMultipleValues('Project Categories'),
            detailed_description: findValueByLabel('Detailed Description'),
            scope_of_work: findValueByLabel('Scope of Work'),
            work_category_detail: findValueByLabel('Work Category'),
            procurement_route_detail: findValueByLabel('Procurement Route'),
            opportunity_first_publishing_date: findValueByLabel('Opportunity First Publishing Date'),
            listing_expiry_date_detail: findValueByLabel('Listing Expiry Date'),
            estimated_contract_start_date: findValueByLabel('Estimated Contract Start Date'),
            estimated_value_of_contract: findValueByLabel('Estimated Value of Contract'),
            buyer_organization_detail: findValueByLabel('Buyer Organization'),
            contact_person: findValueByLabel('Contact'),
            contact_email: findValueByLabel('Email'),
            contact_phone: findValueByLabel('Contact Phone Number'),
          };
        });

        console.log(`Extracted ${Object.keys(detailData).filter(k => detailData[k]).length} detail fields`);

        // Merge basic and detailed data
        const mergedData = {
          ...item,
          ...detailData
        };

        // Generate fingerprint
        const fingerprint = crypto
          .createHash('sha256')
          .update(`${mergedData.title}${mergedData.project_reference}${mergedData.listing_expiry_date}`)
          .digest('hex')
          .slice(0, 40);

        const finalData = {
          id: fingerprint,
          ...mergedData,
          hash_fingerprint: fingerprint,
        };

        results.push(finalData);
        console.log(`✅ Successfully processed: "${item.title}"`);

        // Go back to list
        await page.goBack();
        await page.waitForSelector('table tr', { timeout: 15000 });
        await page.waitForTimeout(1000);

      } catch (error) {
        console.error(`❌ Failed to process "${item.title}":`, error.message);
        
        // If detail extraction fails, still save the basic data
        const fingerprint = crypto
          .createHash('sha256')
          .update(`${item.title}${item.project_reference}${item.listing_expiry_date}`)
          .digest('hex')
          .slice(0, 40);

        results.push({
          id: fingerprint,
          ...item,
          hash_fingerprint: fingerprint,
        });

        // Try to go back to list
        try {
          await page.goBack();
          await page.waitForSelector('table tr', { timeout: 15000 });
        } catch (e) {
          // If navigation fails, reload the page
          await page.goto('https://ontariotenders.app.jaggaer.com/esop/toolkit/opportunity/current/list.si', {
            waitUntil: 'domcontentloaded'
          });
        }
      }
    }

    console.log(`\n✅ Successfully processed ${results.length} opportunities`);

    // Save to dataset for backup
    await Dataset.pushData(results);
    console.log('Data saved to Apify dataset');

    // ========== WEBHOOK SENDING (ADDING BACK THE MISSING PART) ==========
    let batchesSent = 0;
    let totalBatches = 0;
    let successfulBatches = 0;
    let failedBatches = 0;
    
    if (webhookUrl && webhookUrl.trim() !== '') {
      console.log('\n========== WEBHOOK PROCESSING ==========');
      console.log(`Webhook URL: ${webhookUrl}`);
      
      // Send data to webhook in batches
      const BATCH_SIZE = 10;
      const batches = [];
      
      for (let i = 0; i < results.length; i += BATCH_SIZE) {
        batches.push(results.slice(i, i + BATCH_SIZE));
      }
      
      totalBatches = batches.length;
      console.log(`Splitting data into ${totalBatches} batches of up to ${BATCH_SIZE} items each`);
      
      for (const [index, batch] of batches.entries()) {
        console.log(`\nSending batch ${index + 1}/${totalBatches} (${batch.length} items)...`);
        
        try {
          const payload = {
            items: batch,
            source: 'OTP/JAGGAER',
            timestamp: new Date().toISOString(),
            batchIndex: index,
            totalBatches: totalBatches
          };
          
          console.log(`Payload size: ${JSON.stringify(payload).length} bytes`);
          
          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-apify-signature': (webhookSecret || '').trim(),
            },
            body: JSON.stringify(payload),
          });
          
          const responseText = await response.text();
          console.log(`Response status: ${response.status}`);
          
          if (!response.ok) {
            console.error(`❌ Webhook error for batch ${index + 1}: ${response.status}`);
            console.error(`Response: ${responseText.substring(0, 500)}`);
            failedBatches++;
          } else {
            console.log(`✅ Batch ${index + 1} sent successfully`);
            if (responseText) {
              try {
                const responseJson = JSON.parse(responseText);
                console.log(`Response: ${JSON.stringify(responseJson).substring(0, 200)}`);
              } catch {
                console.log(`Response (text): ${responseText.substring(0, 200)}`);
              }
            }
            successfulBatches++;
          }
          
          batchesSent++;
          
          // Small delay between batches to avoid overwhelming the webhook
          if (index < batches.length - 1) {
            console.log('Waiting 1 second before next batch...');
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          console.error(`❌ Error sending batch ${index + 1}:`, error.message);
          failedBatches++;
        }
      }
      
      console.log('\n========== WEBHOOK SUMMARY ==========');
      console.log(`Total batches: ${totalBatches}`);
      console.log(`Successful: ${successfulBatches}`);
      console.log(`Failed: ${failedBatches}`);
      console.log('=====================================\n');
      
    } else {
      console.log('\n⚠️  No webhook URL provided - data collection complete');
      console.log('Data is saved in the Apify dataset for retrieval\n');
    }
    
    // Store summary in key-value store
    const summary = {
      scraped: results.length,
      batchesSent: batchesSent,
      totalBatches: totalBatches,
      successfulBatches: successfulBatches,
      failedBatches: failedBatches,
      timestamp: new Date().toISOString(),
      webhookUrl: webhookUrl || 'Not configured'
    };
    
    await Actor.setValue('OUTPUT', summary);
    
    console.log('\n========== RUN COMPLETE ==========');
    console.log(JSON.stringify(summary, null, 2));
    console.log('==================================\n');
   
    await browser.close();

  } catch (error) {
    console.error('❌ Scraper error:', error);
    console.error('Stack trace:', error.stack);
    throw error;
  }
});

