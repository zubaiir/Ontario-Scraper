const { Actor, Dataset } = require('apify');
const { chromium } = require('playwright');

// https://vaughan.bidsandtenders.ca/Module/Tenders/en -- Main source client is using in his apify

// Import individual scrapers
const { scrapeOntario } = require('./scrapers/ontario');
const { scrapeSamGov } = require('./scrapers/samgov');
const { scrapeMerx } = require('./scrapers/merx');
const { scrapeBostonBids } = require('./scrapers/boston');
const { scrapeBidsAndTenders } = require('./scrapers/bidsandtenders');
const { scrapeGlobalBids } = require('./scrapers/global');

// ==================== MAIN ACTOR ====================
Actor.main(async () => {
  const input = await Actor.getInput();
  
  const { 
    source = 'ontario',
    webhookUrl = '', 
    webhookSecret = '', 
    maxItems = 5,
    debug = false,
    headless = true,
  } = input || {};

  console.log('=== Multi-Portal Scraper Started ===');
  console.log(`Source: ${source}`);
  console.log(`Debug mode: ${debug}`);
  console.log(`Headless mode: ${headless}`);
  console.log(`Max items: ${maxItems || 'all'}`);
  console.log(`Webhook configured: ${webhookUrl ? 'Yes' : 'No (test mode)'}`);
  console.log('=====================================\n');

  try {
    const browser = await chromium.launch({ 
      headless: headless,
    });

    const page = await browser.newPage();

    let results = [];
    let sourceName = '';

    // Route to appropriate scraper based on source
    switch (source) {
      case 'ontario':
        sourceName = 'Ontario Tenders Portal';
        results = await scrapeOntario({ page, maxItems, webhookUrl, webhookSecret });
        break;
        
      case 'samgov':
        sourceName = 'SAM.gov';
        results = await scrapeSamGov({ page, maxItems, webhookUrl, webhookSecret });
        break;
        
      case 'merx':
        sourceName = 'Merx';
        results = await scrapeMerx({ page, maxItems, webhookUrl, webhookSecret });
        break;

      case 'boston':
        sourceName = 'Boston';
        results = await scrapeBostonBids({ page, maxItems, webhookUrl, webhookSecret });
        break;

      case 'bidsandtenders':
        sourceName = 'Bids&Tenders';
        results = await scrapeBidsAndTenders({ page, maxItems, webhookUrl, webhookSecret });
        break;

      case 'global':
        sourceName = 'Global';
        results = await scrapeGlobalBids({ page, maxItems, webhookUrl, webhookSecret });
        break;

      // Easy to add new sources:
      // case 'newsource':
      //   sourceName = 'New Source';
      //   const { scrapeNewSource } = require('./scrapers/newsource');
      //   results = await scrapeNewSource({ page, maxItems, webhookUrl, webhookSecret });
      //   break;
        
      default:
        throw new Error(`Unknown source: ${source}. Supported sources: ontario, samgov`);
    }

    console.log(`\n✅ Successfully processed ${results.length} opportunities from ${sourceName}`);

    // Save to dataset
    await Dataset.pushData(results);
    console.log('Data saved to Apify dataset');

    // Webhook sending
    let batchesSent = 0;
    let totalBatches = 0;
    let successfulBatches = 0;
    let failedBatches = 0;
    
    if (webhookUrl && webhookUrl.trim() !== '') {
      console.log('\n========== WEBHOOK PROCESSING ==========');
      console.log(`Webhook URL: ${webhookUrl}`);
      
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
            source: sourceName,
            timestamp: new Date().toISOString(),
            batchIndex: index,
            totalBatches: totalBatches
          };
          
          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-apify-signature': (webhookSecret || '').trim(),
            },
            body: JSON.stringify(payload),
          });
          
          const responseText = await response.text();
          
          if (!response.ok) {
            console.error(`❌ Webhook error for batch ${index + 1}: ${response.status}`);
            console.error(`Response: ${responseText}`);
            failedBatches++;
          } else {
            console.log(`✅ Batch ${index + 1} sent successfully`);
            successfulBatches++;
          }
          
          batchesSent++;
          
          if (index < batches.length - 1) {
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
    }
    
    const summary = {
      source: sourceName,
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
