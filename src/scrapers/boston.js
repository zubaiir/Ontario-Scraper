const crypto = require('crypto');

/**
 * Boston Bids Scraper
 * Scrapes opportunities from https://procurement.boston.gov/psp/prdsp/SUPPLIER/ERP/h/?tab=DEFAULT
 */
async function scrapeBostonBids({ page, maxItems, webhookUrl, webhookSecret }) {
  console.log('Opening Boston Bids Portal...');
  
  await page.goto('https://procurement.boston.gov/psp/prdsp/SUPPLIER/ERP/h/?tab=DEFAULT', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  console.log('Waiting for opportunities table...');
  await page.waitForSelector('table#tdgbrAUC_MY_AUC_VW\\$0', { timeout: 60000 });
  await page.waitForTimeout(3000);

  // Extract list data from the main table
  const items = await page.evaluate(() => {
    const data = [];
    const rows = document.querySelectorAll('table#tdgbrAUC_MY_AUC_VW\\$0 tr[id^="trAUC_MY_AUC_VW"]');
    
    rows.forEach((row) => {
      try {
        // Extract End Date/Time
        const endDateEl = row.querySelector('[id*="AUC_COUNTER_WRK_AUC_COUNTER_HTML"] span');
        const endDate = endDateEl ? endDateEl.textContent.trim() : '';
        
        // Extract Event ID
        const eventIdEl = row.querySelector('[id*="AUC_MY_AUC_VW_AUC_ID"]');
        const eventId = eventIdEl ? eventIdEl.textContent.trim() : '';
        
        // Extract Event Name (clickable link)
        const nameLink = row.querySelector('a[id*="AUC_NAME"]');
        const eventName = nameLink ? nameLink.textContent.trim() : '';
        
        // Extract Start Date/Time
        const startDateEl = row.querySelector('[id*="AUC_DTTM_TZ_WK_AUC_DTTM_START"]');
        const startDate = startDateEl ? startDateEl.textContent.trim() : '';
        
        // Extract Event Status
        const statusEl = row.querySelector('[id*="AUC_HDR_AUC_STATUS"]');
        const status = statusEl ? statusEl.textContent.trim() : '';
        
        if (eventName && eventId) {
          data.push({
            title: eventName,
            project_reference: eventId,
            created_at: startDate,
            listing_expiry_date: endDate,
            status: status,
          });
        }
      } catch (error) {
        console.error('Error parsing row:', error.message);
      }
    });
    
    return data;
  });

  console.log(`Found ${items.length} opportunities in list`);

  const results = [];
  const itemsToProcess = maxItems > 0 ? items.slice(0, maxItems) : items;

  for (let i = 0; i < itemsToProcess.length; i++) {
    const item = itemsToProcess[i];
    console.log(`\n--- Processing ${i + 1}/${itemsToProcess.length}: "${item.title}" ---`);

    try {
      // Construct detail page URL directly from Event ID
      const detailUrl = `https://procurement.boston.gov/psp/prdsp_2/SUPPLIER/ERP/c/AUC_MANAGE_BIDS.AUC_RESP_INQ_DTL.GBL?Page=AUC_RESP_INQ_DTL&Action=U&AUC_ID=${item.project_reference}&AUC_ROUND=1&AUC_VERSION=1&BIDDER_ID=0000000001&BIDDER_LOC=1&BIDDER_SETID=SHARE&BIDDER_TYPE=B&BUSINESS_UNIT=BOSTN`;
      
      console.log(`Navigating to detail page: ${item.project_reference}`);
      await page.goto(detailUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      
      // Wait for detail page to load
      await page.waitForTimeout(2000);
      
      // The detail page content is inside an iframe - switch to it
      console.log('Switching to iframe context...');
      const iframeElement = await page.waitForSelector('iframe#ptifrmtgtframe', { timeout: 5000 });
      const iframe = await iframeElement.contentFrame();
      
      if (!iframe) {
        console.log('Could not access iframe content');
        throw new Error('Iframe not accessible');
      }
      
      // Wait for content inside iframe
      await iframe.waitForSelector('#AUC_HDR_AUC_NAME', { timeout: 5000 });
      console.log('Detail page loaded successfully inside iframe');
      
      // Store the detail URL (the main page URL, not iframe src)
      const detailPageUrl = detailUrl;

      // Extract detailed information from iframe
      const detailData = await iframe.evaluate(() => {
        const getTextById = (id) => {
          const element = document.getElementById(id);
          return element ? element.textContent.trim() : '';
        };

        const getTextAreaValue = (id) => {
          const element = document.getElementById(id);
          return element ? element.value.trim() : '';
        };

        // Extract lines/scope information from the table if present
        let scopeOfWork = '';
        const lineRows = document.querySelectorAll('table[id*="tdgbrAUC_LINEGRD"] tr[id*="trAUC_LINEGRD"]');
        if (lineRows.length > 0) {
          const lines = [];
          lineRows.forEach((row) => {
            const lineNum = row.querySelector('[id*="AUC_LINE_LINE_NBR"]');
            const desc = row.querySelector('[id*="AUC_LINE_DESCR254_MIXED"]');
            const unit = row.querySelector('[id*="AUC_LINE_UNIT_OF_MEASURE"]');
            const qty = row.querySelector('[id*="AUC_LINE_QTY_AUC"]');
            
            if (lineNum && desc) {
              const lineText = `Line ${lineNum.textContent.trim()}: ${desc.textContent.trim()}`;
              if (unit && qty) {
                lines.push(`${lineText} (${qty.textContent.trim()} ${unit.textContent.trim()})`);
              } else {
                lines.push(lineText);
              }
            }
          });
          if (lines.length > 0) {
            scopeOfWork = lines.join('\n');
          }
        }

        return {
          event_name: getTextById('AUC_HDR_AUC_NAME'),
          event_id_full: getTextById('RESP_AUC_H0B_WK_AUC_ID_BUS_UNIT'),
          event_format: getTextById('RESP_AUC_H0B_WK_AUC_FORMAT_BIDBER'),
          event_type: getTextById('AUC_HDR_AUC_TYPE'),
          event_round: getTextById('AUC_HDR_AUC_ROUND'),
          event_version: getTextById('AUC_HDR_AUC_VERSION'),
          event_start_date: getTextById('AUC_HDR_AUC_DTTM_START'),
          event_end_date: getTextById('AUC_COUNTER_WRK_AUC_COUNTER_HTML'),
          event_description: getTextAreaValue('AUC_HDR_DESCRLONG'),
          contact_person: getTextById('AUC_HDR_NAME1'),
          contact_phone: getTextById('AUC_HDR_PHONE'),
          contact_email: getTextById('RESP_INQ_DL0_WK_EMAILID'),
          payment_terms: getTextById('PYMT_TR_EFF_VW_DESCRSHORT'),
          scope_of_work: scopeOfWork,
        };
      });

      console.log(`Extracted ${Object.keys(detailData).filter(k => detailData[k]).length} detail fields`);

      // Determine status based on end date
      let finalStatus = item.status || 'Posted';
      if (item.listing_expiry_date) {
        try {
          const endDate = new Date(item.listing_expiry_date);
          const now = new Date();
          if (endDate < now) {
            finalStatus = 'Closed';
          } else {
            finalStatus = 'Active';
          }
        } catch (e) {
          // Keep original status if date parsing fails
        }
      }

      // Merge all data
      const mergedData = {
        title: detailData.event_name || item.title,
        agency: 'City of Boston', // Boston is always the agency
        status: finalStatus,
        project_reference: item.project_reference,
        created_at: detailData.event_start_date || item.created_at,
        category: detailData.event_format || detailData.event_type || 'RFx',
        listing_expiry_date: detailData.event_end_date || item.listing_expiry_date,
        portal_url: detailPageUrl,
        city: 'Boston',
        portal_source: 'Boston Bids',
        
        // Additional detail fields
        project_code: detailData.event_id_full || item.project_reference,
        project_reference_detail: item.project_reference,
        project_type: detailData.event_format || '',
        project_categories: detailData.event_type ? [detailData.event_type] : [],
        detailed_description: detailData.event_description || '',
        scope_of_work: detailData.scope_of_work || 'See event details',
        work_category_detail: detailData.event_type || '',
        procurement_route_detail: detailData.event_format || '',
        opportunity_first_publishing_date: detailData.event_start_date || '',
        listing_expiry_date_detail: detailData.event_end_date || '',
        estimated_contract_start_date: '',
        estimated_value_of_contract: '',
        buyer_organization_detail: 'City of Boston',
        contact_person: detailData.contact_person || '',
        contact_email: detailData.contact_email || '',
        contact_phone: detailData.contact_phone || '',
      };

      // Generate fingerprint
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${mergedData.title}${mergedData.project_reference}${mergedData.listing_expiry_date}`)
        .digest('hex')
        .slice(0, 40);

      results.push({
        id: fingerprint,
        ...mergedData,
        hash_fingerprint: fingerprint,
      });

      console.log(`✅ Successfully processed: "${item.title}"`);

      // Go back to list page
      await page.goto('https://procurement.boston.gov/psp/prdsp/SUPPLIER/ERP/h/?tab=DEFAULT', {
        waitUntil: 'domcontentloaded'
      });
      await page.waitForSelector('table#tdgbrAUC_MY_AUC_VW\\$0', { timeout: 15000 });
      await page.waitForTimeout(1000);

    } catch (error) {
      console.error(`❌ Failed to process "${item.title}":`, error.message);
      
      // Save basic data if detail extraction fails
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${item.title}${item.project_reference}${item.listing_expiry_date}`)
        .digest('hex')
        .slice(0, 40);

      results.push({
        id: fingerprint,
        title: item.title,
        agency: 'City of Boston',
        status: item.status || 'Active',
        project_reference: item.project_reference,
        created_at: item.created_at,
        category: '',
        listing_expiry_date: item.listing_expiry_date,
        portal_url: `https://procurement.boston.gov/psp/prdsp_2/SUPPLIER/ERP/c/AUC_MANAGE_BIDS.AUC_RESP_INQ_DTL.GBL?Page=AUC_RESP_INQ_DTL&Action=U&AUC_ID=${item.project_reference}&AUC_ROUND=1&AUC_VERSION=1&BIDDER_ID=0000000001&BIDDER_LOC=1&BIDDER_SETID=SHARE&BIDDER_TYPE=B&BUSINESS_UNIT=BOSTN`,
        city: 'Boston',
        portal_source: 'Boston Bids',
        project_code: item.project_reference,
        hash_fingerprint: fingerprint,
      });

      // Go back to list page
      try {
        await page.goto('https://procurement.boston.gov/psp/prdsp/SUPPLIER/ERP/h/?tab=DEFAULT', {
          waitUntil: 'domcontentloaded'
        });
        await page.waitForSelector('table#tdgbrAUC_MY_AUC_VW\\$0', { timeout: 15000 });
      } catch (e) {
        console.log('Failed to return to list page');
      }
    }
  }

  return results;
}

module.exports = { scrapeBostonBids };
