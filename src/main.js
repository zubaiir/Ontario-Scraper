const { Actor, Dataset } = require('apify');
const { chromium } = require('playwright');

// Import individual scrapers
const { scrapeOntario } = require('./scrapers/ontario');
const { scrapeSamGov } = require('./scrapers/samgov');
const { scrapeMerx } = require('./scrapers/merx');
const { scrapeBostonBids } = require('./scrapers/boston');
const { scrapeBidsAndTenders } = require('./scrapers/bidsandtenders');
const { scrapeAlberta } = require('./scrapers/albertapurchasing');
const { scrapeBCBid } = require('./scrapers/bcbid');
const { scrapeNewBrunswick } = require('./scrapers/newbrunswick');
const { scrapeNovaScotia } = require('./scrapers/novascotia');
const { scrapeSaskTenders } = require('./scrapers/sasktenders');
const { scrapeIonwave } = require('./scrapers/ionwave');
const { scrapeBidNetDirect } = require('./scrapers/bidnetdirect');
const { scrapeBonfire } = require('./scrapers/bonfire');
const { scrapeOpenGov } = require('./scrapers/opengov');
const { scrapePublicPurchase } = require('./scrapers/publicpurchase');
const { scrapeVermontBusinessRegistry } = require('./scrapers/vermontbusinessregistry');
const { scrapeNewfoundland } = require('./scrapers/newfoundland');
const { scrapeCFTA } = require('./scrapers/cfta');
const { scrapeBidscanada } = require('./scrapers/bidscanada');
const { scrapeBidCentral } = require('./scrapers/bidcentral');
const { scrapeAmpQuebec } = require('./scrapers/ampquebec');
const { scrapeCivicInfoBC } = require('./scrapers/civicinfobc');
const { scrapeConstructConnect } = require('./scrapers/constructconnect');

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

  let browser;
  let results = [];
  let sourceName = '';

  try {
    browser = await chromium.launch({ 
      headless: headless,
    });

    const page = await browser.newPage();

    // Route to appropriate scraper based on source
    try {
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

        case 'albertapurchasing':
          sourceName = 'Alberta Purchasing Connection';
          results = await scrapeAlberta({ page, maxItems, webhookUrl, webhookSecret });
          break;

        case 'bcbid':
          sourceName = 'BC Bid';
          results = await scrapeBCBid({ page, maxItems, webhookUrl, webhookSecret });
          break;

        case 'newbrunswick':
          sourceName = 'New Brunswick';
          results = await scrapeNewBrunswick({ page, maxItems, webhookUrl, webhookSecret });
          break;

        case 'novascotia':
          sourceName = 'Nova Scotia';
          results = await scrapeNovaScotia({ page, maxItems, webhookSecret });
          break;

        case 'sasktenders':
          sourceName = 'SaskTenders';
          results = await scrapeSaskTenders({ page, maxItems, webhookUrl, webhookSecret });
          break;

        case 'ionwave':
          sourceName = 'Ionwave';
          results = await scrapeIonwave({ page, maxItems, webhookUrl, webhookSecret });
          break;

        case 'bidnet':
          sourceName = 'BidNet';
          results = await scrapeBidNetDirect({ page, maxItems, webhookUrl, webhookSecret });
          break;

        case 'bonfire':
          sourceName = 'Bonfire';
          results = await scrapeBonfire({ page, maxItems, webhookUrl, webhookSecret });
          break;

        case 'opengov':
          sourceName = 'OpenGov';
          results = await scrapeOpenGov({ page, maxItems, webhookUrl, webhookSecret });
          break;

        case 'publicpurchase':
          sourceName = 'Public Purchase';
          results = await scrapePublicPurchase({ page, maxItems, webhookUrl, webhookSecret });
          break;

        case 'vermont':
          sourceName = 'Vermont Business Registry';
          results = await scrapeVermontBusinessRegistry({ page, maxItems, webhookUrl, webhookSecret });
          break;

        case 'newfoundland':
          sourceName = 'Newfoundland and Labrador';
          results = await scrapeNewfoundland({ page, maxItems, webhookUrl, webhookSecret });
          break;

        case 'cfta':
          sourceName = 'CFTA';
          results = await scrapeCFTA({ page, maxItems, webhookUrl, webhookSecret });
          break;

        case 'bidscanada':
          sourceName = 'Bids Canada';
          results = await scrapeBidscanada({ page, maxItems, webhookUrl, webhookSecret });
          break;

        case 'bidcentral':
          sourceName = 'BidCentral';
          results = await scrapeBidCentral({ page, maxItems, webhookUrl, webhookSecret });
          break;

        case 'ampquebec':
          sourceName = 'AMQ Quebec';
          results = await scrapeAmpQuebec({ page, maxItems, webhookUrl, webhookSecret });
          break;

        case 'civicinfobc':
          sourceName = 'CivicInfo BC';
          results = await scrapeCivicInfoBC({ page, maxItems, webhookUrl, webhookSecret });
          break;

        case 'constructconnect':
          sourceName = 'ConstructConnect';
          results = await scrapeConstructConnect({ page, maxItems, webhookUrl, webhookSecret });
          break;
          
        default:
          throw new Error(`Unknown source: ${source}`);
      }
    } catch (scraperError) {
      console.error(`⚠️ Scraper encountered an issue: ${scraperError.message}`);
      results = results || [];
    }

    console.log(`✅ Scraping completed for ${sourceName}`);

    // Save to dataset (even if empty)
    if (results.length > 0) {
      await Dataset.pushData(results);
      console.log('Data saved to Apify dataset');
    } else {
      console.log('No data to save');
    }

    // Webhook sending
    let batchesSent = 0;
    let totalBatches = 0;
    let successfulBatches = 0;
    let failedBatches = 0;
    
    if (webhookUrl && webhookUrl.trim() !== '' && results.length > 0) {
      console.log('\n========== WEBHOOK PROCESSING ==========');
      console.log(`Webhook URL: ${webhookUrl}`);
      
      const BATCH_SIZE = 10;
      const batches = [];
      
      for (let i = 0; i < results.length; i += BATCH_SIZE) {
        batches.push(results.slice(i, i + BATCH_SIZE));
      }
      
      totalBatches = batches.length;
      console.log(`Splitting data into ${totalBatches} batches`);
      
      for (const [index, batch] of batches.entries()) {
        console.log(`\nSending batch ${index + 1}/${totalBatches}...`);
        
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
      console.log('\n⚠️  No webhook URL provided or no data to send');
    }
    
    const summary = {
      source: sourceName,
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

  } catch (error) {
    console.error('⚠️ Actor error:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});
