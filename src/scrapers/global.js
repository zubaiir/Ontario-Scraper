const fs = require('fs');
const csv = require('csv-parser');
const puppeteer = require('puppeteer');

/**
 * Global Scraper - Reads from CSV and attempts to crawl multiple sources
 * CSV Expected columns: source_name, url, city, state, scraper_type, notes
 */

// Map scraper types to their functions
const SCRAPER_MAP = {
};

/**
 * Read CSV file and return array of sources
 */
async function readSourcesFromCSV(csvPath) {
  return new Promise((resolve, reject) => {
    const sources = [];
    
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (row) => {
        sources.push({
          sourceName: row.source_name || row.name || '',
          url: row.url || '',
          city: row.city || '',
          state: row.state || '',
          scraperType: row.scraper_type || row.type || '',
          notes: row.notes || '',
          // Add any other columns you need
        });
      })
      .on('end', () => {
        console.log(`✅ Loaded ${sources.length} sources from CSV`);
        resolve(sources);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

/**
 * Attempt to scrape a single source
 */
async function scrapeSource(source, page, options = {}) {
  const { maxItems = 10, webhookUrl = '', webhookSecret = '' } = options;
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🎯 Starting scrape: ${source.sourceName}`);
  console.log(`   URL: ${source.url}`);
  console.log(`   City: ${source.city}, State: ${source.state}`);
  console.log(`   Scraper Type: ${source.scraperType}`);
  console.log(`${'='.repeat(80)}\n`);

  try {
    // Check if we have a specific scraper for this type
    const scraperFunction = SCRAPER_MAP[source.scraperType.toLowerCase()];
    
    if (scraperFunction) {
      console.log(`✅ Found specific scraper for type: ${source.scraperType}`);
      
      const results = await scraperFunction({
        page,
        maxItems,
        webhookUrl,
        webhookSecret
      });
      
      console.log(`✅ Successfully scraped ${results.length} items from ${source.sourceName}`);
      
      return {
        success: true,
        source: source.sourceName,
        url: source.url,
        city: source.city,
        state: source.state,
        itemsFound: results.length,
        data: results,
        error: null
      };
      
    } else {
      // Placeholder logic - Generic scraping attempt
      console.log(`⚠️  No specific scraper found for type: ${source.scraperType}`);
      console.log(`📝 Using placeholder/generic scraping logic...`);
      
      // Navigate to the URL
      await page.goto(source.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      
      // Wait a bit for content to load
      await page.waitForTimeout(2000);
      
      // Placeholder: Try to extract some basic information
      const pageInfo = await page.evaluate(() => {
        return {
          title: document.title,
          url: window.location.href,
          hasTable: document.querySelector('table') !== null,
          hasForms: document.querySelector('form') !== null,
          linkCount: document.querySelectorAll('a').length,
          textContent: document.body.innerText.substring(0, 500) // First 500 chars
        };
      });
      
      console.log(`📄 Page Info:`, pageInfo);
      
      return {
        success: true,
        source: source.sourceName,
        url: source.url,
        city: source.city,
        state: source.state,
        itemsFound: 0,
        data: [],
        pageInfo: pageInfo,
        error: null,
        note: 'Placeholder scraping - specific scraper not implemented yet'
      };
    }
    
  } catch (error) {
    console.error(`❌ Error scraping ${source.sourceName}:`, error.message);
    
    return {
      success: false,
      source: source.sourceName,
      url: source.url,
      city: source.city,
      state: source.state,
      itemsFound: 0,
      data: [],
      error: error.message
    };
  }
}

/**
 * Main function to scrape all sources from CSV
 */
async function scrapeGlobalBids(options = {}) {
  const {
    csvPath = './input.csv',
    maxItems = 10,
    maxSources = 0, // 0 = all sources
    webhookUrl = '',
    webhookSecret = '',
    headless = true,
    outputPath = './results.json'
  } = options;

  console.log(`\n${'*'.repeat(80)}`);
  console.log(`🌍 GLOBAL BIDS SCRAPER - Starting`);
  console.log(`${'*'.repeat(80)}\n`);
  console.log(`📋 CSV Path: ${csvPath}`);
  console.log(`📊 Max Items per Source: ${maxItems}`);
  console.log(`🎯 Max Sources: ${maxSources === 0 ? 'ALL' : maxSources}`);
  console.log(`🌐 Headless Mode: ${headless}`);
  console.log(`💾 Output Path: ${outputPath}\n`);

  let browser;
  const startTime = Date.now();
  const allResults = [];

  try {
    // Read sources from CSV
    const sources = await readSourcesFromCSV(csvPath);
    
    if (sources.length === 0) {
      console.log('⚠️  No sources found in CSV file');
      return { success: false, results: [] };
    }

    // Limit sources if specified
    const sourcesToProcess = maxSources > 0 ? sources.slice(0, maxSources) : sources;
    console.log(`📌 Processing ${sourcesToProcess.length} sources...\n`);

    // Launch browser
    browser = await puppeteer.launch({
      headless: headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Process each source
    for (let i = 0; i < sourcesToProcess.length; i++) {
      const source = sourcesToProcess[i];
      
      console.log(`\n[${i + 1}/${sourcesToProcess.length}] Processing: ${source.sourceName}`);
      
      const result = await scrapeSource(source, page, {
        maxItems,
        webhookUrl,
        webhookSecret
      });
      
      allResults.push(result);
      
      // Small delay between sources
      await page.waitForTimeout(1000);
    }

    // Close browser
    await browser.close();

    // Generate summary
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    const successCount = allResults.filter(r => r.success).length;
    const totalItems = allResults.reduce((sum, r) => sum + r.itemsFound, 0);

    const summary = {
      totalSources: sourcesToProcess.length,
      successfulSources: successCount,
      failedSources: sourcesToProcess.length - successCount,
      totalItemsScraped: totalItems,
      durationSeconds: duration,
      timestamp: new Date().toISOString(),
      results: allResults
    };

    // Save results to file
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));

    // Print summary
    console.log(`\n${'*'.repeat(80)}`);
    console.log(`📊 SCRAPING SUMMARY`);
    console.log(`${'*'.repeat(80)}`);
    console.log(`✅ Successful: ${successCount}/${sourcesToProcess.length} sources`);
    console.log(`❌ Failed: ${sourcesToProcess.length - successCount}/${sourcesToProcess.length} sources`);
    console.log(`📦 Total Items: ${totalItems}`);
    console.log(`⏱️  Duration: ${duration}s`);
    console.log(`💾 Results saved to: ${outputPath}`);
    console.log(`${'*'.repeat(80)}\n`);

    return summary;

  } catch (error) {
    console.error('❌ Fatal error in global scraper:', error);
    
    if (browser) {
      await browser.close();
    }
    
    throw error;
  }
}

/**
 * Example usage
 */
if (require.main === module) {
  // Run the scraper when this file is executed directly
  scrapeGlobalBids({
    csvPath: './sources.csv',
    maxItems: 5, // Limit items per source for testing
    maxSources: 3, // Limit to first 3 sources for testing
    headless: false, // Set to true for production
    outputPath: './scraping_results.json'
  })
    .then(() => {
      console.log('✅ Global scraping completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Global scraping failed:', error);
      process.exit(1);
    });
}

module.exports = { scrapeGlobalBids, readSourcesFromCSV, scrapeSource };
