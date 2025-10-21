const { crypto, generateFingerprint } = require('../utils');

/**
 * SAM.gov Scraper
 * Scrapes government contract opportunities from https://sam.gov
 */
async function scrapeSamGov({ page, maxItems, webhookUrl, webhookSecret }) {
  console.log('Opening SAM.gov Portal...');
  const samGovUrl = 'https://sam.gov/search/?page=1&pageSize=25&sort=-modifiedDate&sfm%5BsimpleSearch%5D%5BkeywordRadio%5D=ALL&sfm%5BsimpleSearch%5D%5BkeywordTags%5D%5B0%5D%5Bkey%5D=contract&sfm%5BsimpleSearch%5D%5BkeywordTags%5D%5B0%5D%5Bvalue%5D=contract&sfm%5Bstatus%5D%5Bis_active%5D=true';
  
  await page.goto(samGovUrl, {
    waitUntil: 'networkidle',
    timeout: 90000,
  });

  console.log('Waiting for search results to load...');
  await page.waitForSelector('app-opportunity-result', { timeout: 60000 });
  await page.waitForTimeout(5000);

  // Extract basic data from list
  const items = await page.evaluate(() => {
    const data = [];
    const resultElements = document.querySelectorAll('app-opportunity-result');
    
    resultElements.forEach((result) => {
      const titleElement = result.querySelector('h3.margin-y-0 a.usa-link');
      const title = titleElement ? titleElement.textContent.trim() : '';
      const href = titleElement ? titleElement.getAttribute('href') : '';
      
      const noticeElement = result.querySelector('h3.font-sans-xs.margin-bottom-1');
      const noticeId = noticeElement ? noticeElement.textContent.replace('Notice ID:', '').trim() : '';
      
      const descElement = result.querySelector('.sds-field.sds-field--stacked p span');
      const description = descElement ? descElement.textContent.trim() : '';
      
      let agency = '';
      let noticeType = '';
      let responseDate = '';
      let publishedDate = '';
      
      const fields = result.querySelectorAll('.sds-field.sds-field--stacked');
      fields.forEach(field => {
        const nameEl = field.querySelector('.sds-field__name');
        const valueEl = field.querySelector('.sds-field__value');
        
        if (!nameEl) return;
        
        const fieldName = nameEl.textContent.trim();
        const fieldValue = valueEl ? valueEl.textContent.trim() : '';
        
        if (fieldName.includes('Department') || fieldName.includes('Ind.Agency')) {
          agency = fieldValue;
        } else if (fieldName === 'Notice Type') {
          noticeType = fieldValue;
        } else if (fieldName.includes('Current Response Date') || fieldName.includes('Current Date Offers Due')) {
          responseDate = fieldValue;
        } else if (fieldName === 'Published Date') {
          publishedDate = fieldValue;
        }
      });
      
      const categoryElement = result.querySelector('.sds-tag');
      const category = categoryElement ? categoryElement.textContent.trim() : '';
      
      if (title && href) {
        data.push({
          title,
          agency,
          status: noticeType,
          project_reference: noticeId,
          created_at: publishedDate,
          category: category,
          listing_expiry_date: responseDate,
          detailUrl: href,
          portal_url: 'https://sam.gov/search/',
          city: 'United States',
          portal_source: 'SAM.gov',
        });
      }
    });
    
    return data;
  });

  console.log(`Found ${items.length} opportunities in list`);

  // Process each opportunity detail page
  const results = [];
  const itemsToProcess = maxItems > 0 ? items.slice(0, maxItems) : items;

  for (let i = 0; i < itemsToProcess.length; i++) {
    const item = itemsToProcess[i];
    console.log(`\n--- Processing ${i + 1}/${itemsToProcess.length}: "${item.title.substring(0, 60)}..." ---`);

    try {
      const fullDetailUrl = `https://sam.gov${item.detailUrl}`;
      console.log(`Navigating to detail page...`);
      
      await page.goto(fullDetailUrl, {
        waitUntil: 'networkidle',
        timeout: 60000,
      });

      await page.waitForTimeout(3000);

      const detailData = await page.evaluate(() => {
        const getText = (selector) => {
          const el = document.querySelector(selector);
          return el ? el.textContent.trim() : '';
        };

        const getFieldByLabel = (labelText) => {
          const fields = Array.from(document.querySelectorAll('.sds-field'));
          for (const field of fields) {
            const label = field.textContent.trim();
            if (label === labelText || label.includes(labelText)) {
              const parent = field.closest('.grid-row');
              if (parent) {
                const valueEl = parent.querySelector('.sds-field__value h5, .sds-field__value h6');
                if (valueEl) return valueEl.textContent.trim();
              }
              const nextRow = field.closest('.grid-row')?.nextElementSibling;
              if (nextRow) {
                const valueEl = nextRow.querySelector('.sds-field__value h5, .sds-field__value h6');
                if (valueEl) return valueEl.textContent.trim();
              }
            }
          }
          return '';
        };

        const getResponseDate = () => {
          const selectors = [
            '[aria-describedby="date-offers-date"]',
            '[aria-describedby="response-date"]',
            '.sds-field__value h5.value-new-line',
          ];
          
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.textContent.trim()) {
              const text = el.textContent.trim();
              if (text.match(/\d{4}/) || text.includes('202')) {
                return text;
              }
            }
          }
          
          return getFieldByLabel('Response Date') || 
                 getFieldByLabel('Date Offers Due') || 
                 getFieldByLabel('Current Response Date') ||
                 getFieldByLabel('Current Date Offers Due') ||
                 '';
        };

        const statusTag = document.querySelector('.sds-tag.sds-tag--status');
        let status = 'Active';
        if (statusTag) {
          const statusText = statusTag.textContent.trim();
          status = statusText.includes('Active') ? 'Active' : 'Inactive';
        }

        const noticeId = getFieldByLabel('Notice ID');
        const relatedNotice = getFieldByLabel('Related Notice');
        const contractType = getFieldByLabel('Contract Opportunity Type');
        const contractLineNumber = getFieldByLabel('Contract Line Item Number');
        
        const inactiveDates = getFieldByLabel('Inactive Dates');
        const inactivePolicy = getFieldByLabel('Inactive Policy');
        const responseDate = getResponseDate();
        const publishedDate = getFieldByLabel('Published Date');

        const department = getFieldByLabel('Department/Ind. Agency');
        const subtier = getFieldByLabel('Sub-tier');
        const office = getFieldByLabel('Office');

        const setAside = getFieldByLabel('Original Set Aside');
        const psc = getFieldByLabel('Product Service Code');
        const naics = getFieldByLabel('NAICS Code');
        const placeOfPerformance = getFieldByLabel('Place of Performance');
        const initiative = getFieldByLabel('Initiative');

        const descEl = document.querySelector('#desc .value-new-line p, #desc .value-new-line');
        const description = descEl ? descEl.textContent.trim() : '';

        const primaryContactEl = document.querySelector('#primary-poc ~ .grid-row .contact-title-2');
        const primaryContact = primaryContactEl ? primaryContactEl.textContent.trim() : '';
        
        const primaryEmailEl = document.querySelector('#primary-poc ~ .grid-row #email ~ .sds-field__value h6');
        const primaryEmail = primaryEmailEl ? primaryEmailEl.textContent.trim() : '';
        
        const primaryPhoneEl = document.querySelector('#primary-poc ~ .grid-row #phone ~ .sds-field__value h6');
        const primaryPhone = primaryPhoneEl ? primaryPhoneEl.textContent.trim() : '';

        const altContactEl = document.querySelector('#alt-poc ~ .grid-row .contact-title-2');
        const altContact = altContactEl ? altContactEl.textContent.trim() : '';
        
        const altEmailEl = document.querySelector('#alt-poc ~ .grid-row #email ~ .sds-field__value h6');
        const altEmail = altEmailEl ? altEmailEl.textContent.trim() : '';
        
        const altPhoneEl = document.querySelector('#alt-poc ~ .grid-row #phone ~ .sds-field__value h6');
        const altPhone = altPhoneEl ? altPhoneEl.textContent.trim() : '';

        const addressElements = document.querySelectorAll('#contract-office ~ .ng-star-inserted h6');
        const address = Array.from(addressElements).map(el => el.textContent.trim()).join(', ');

        return {
          status,
          noticeId,
          relatedNotice,
          contractType,
          contractLineNumber,
          inactiveDates,
          inactivePolicy,
          responseDate,
          publishedDate,
          department,
          subtier,
          office,
          setAside,
          psc,
          naics,
          placeOfPerformance,
          initiative,
          description,
          primaryContact,
          primaryEmail,
          primaryPhone,
          altContact,
          altEmail,
          altPhone,
          address
        };
      });

      console.log(`Extracted ${Object.keys(detailData).filter(k => detailData[k]).length} detail fields`);

      const mergedData = {
        title: item.title,
        agency: detailData.department || detailData.subtier || item.agency,
        status: detailData.status,
        project_reference: detailData.noticeId || item.project_reference,
        created_at: detailData.publishedDate || item.created_at,
        category: detailData.contractType || item.category,
        listing_expiry_date: detailData.responseDate,
        portal_url: `https://sam.gov${item.detailUrl}`,
        city: 'United States',
        portal_source: 'SAM.gov',
        
        project_code: `samgov_${detailData.noticeId || item.project_reference}`,
        project_reference_detail: detailData.noticeId || item.project_reference,
        project_type: detailData.psc || 'Services',
        project_categories: detailData.naics ? [detailData.naics] : [],
        detailed_description: detailData.description,
        scope_of_work: detailData.psc || detailData.contractType || '',
        work_category_detail: detailData.contractType,
        procurement_route_detail: detailData.setAside || 'N/A',
        opportunity_first_publishing_date: detailData.publishedDate,
        listing_expiry_date_detail: detailData.responseDate,
        estimated_contract_start_date: null,
        estimated_value_of_contract: null,
        buyer_organization_detail: detailData.department,
        contact_person: detailData.primaryContact,
        contact_email: detailData.primaryEmail,
        contact_phone: detailData.primaryPhone,
        
        region: 'US',
        office: detailData.office,
        subtier: detailData.subtier,
        psc_code: detailData.psc,
        naics_code: detailData.naics,
        place_of_performance: detailData.placeOfPerformance,
        contracting_office_address: detailData.address,
        alternative_contact_name: detailData.altContact,
        alternative_contact_email: detailData.altEmail,
        alternative_contact_phone: detailData.altPhone,
        related_notice: detailData.relatedNotice,
        contract_line_number: detailData.contractLineNumber,
        inactive_policy: detailData.inactivePolicy,
        inactive_dates: detailData.inactiveDates,
        initiative: detailData.initiative,
        response_date: detailData.responseDate
      };

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

      await page.goBack();
      await page.waitForSelector('app-opportunity-result', { timeout: 30000 });
      await page.waitForTimeout(2000);

    } catch (error) {
      console.error(`❌ Failed to process:`, error.message);
      
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${item.title}${item.project_reference}${item.listing_expiry_date || ''}`)
        .digest('hex')
        .slice(0, 40);

      results.push({
        id: fingerprint,
        ...item,
        created_at: item.created_at,
        listing_expiry_date: item.listing_expiry_date,
        portal_url: `https://sam.gov${item.detailUrl}`,
        hash_fingerprint: fingerprint,
      });

      try {
        await page.goBack();
        await page.waitForSelector('app-opportunity-result', { timeout: 30000 });
      } catch (e) {
        await page.goto(samGovUrl, { waitUntil: 'networkidle' });
        await page.waitForSelector('app-opportunity-result', { timeout: 30000 });
      }
    }
  }

  return results;
}

module.exports = { scrapeSamGov };
