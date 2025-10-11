# Bid Alert Scraper - Modular Architecture

A scalable, modular Apify actor that scrapes tender/contract opportunities from multiple government portals with clean separation of concerns.

## 🏗️ Architecture

```
src/
├── main.js                      # Main orchestrator (routing, webhooks)
└── scrapers/
    ├── ontario.js               # Ontario Tenders Portal scraper
    ├── samgov.js                # SAM.gov scraper
    ├── _template.js             # Template for new scrapers
    └── [newsource].js           # Add new scrapers here
```

### Why This Architecture?

✅ **Separation of Concerns** - Each scraper is isolated in its own file  
✅ **Easy to Maintain** - Update one source without touching others  
✅ **Scalable** - Add new sources by creating a new file  
✅ **Testable** - Test individual scrapers independently  
✅ **Clean Main** - Main file only handles routing and webhooks  

## 📁 File Structure

### `src/main.js`
The orchestrator that:
- Handles input parameters
- Routes to appropriate scraper
- Manages webhooks and batching
- Saves results to dataset
- Exports utility functions

### `src/scrapers/[source].js`
Individual scraper modules that:
- Contain all source-specific logic
- Export a single scrape function
- Import utilities from main.js
- Return standardized data format

### `src/scrapers/_template.js`
Template for creating new scrapers with:
- Standard structure
- Placeholder comments
- Example implementations
- Best practices

## 🚀 Quick Start

### 1. Upload to Apify

```
your-actor/
├── src/
│   ├── main.js
│   └── scrapers/
│       ├── ontario.js
│       ├── samgov.js
│       └── _template.js
├── .actor/
│   └── input_schema.json
├── package.json
└── README.md
```

### 2. Configure Input

```json
{
  "source": "ontario",
  "webhookUrl": "https://your-webhook-url.com",
  "webhookSecret": "your-secret",
  "maxItems": 5
}
```

### 3. Run

Via Console, API, or Schedule.

## 📝 Input Schema

```json
{
  "source": {
    "type": "string",
    "editor": "select",
    "enum": ["ontario", "samgov"],
    "enumTitles": ["Ontario Tenders Portal", "SAM.gov"]
  },
  "webhookUrl": { "type": "string" },
  "webhookSecret": { "type": "string", "isSecret": true },
  "maxItems": { "type": "integer", "default": 0 },
  "debug": { "type": "boolean", "default": false }
}
```

## ➕ Adding a New Source

### Step 1: Create Scraper File

Copy `_template.js` and rename:

```bash
cp src/scrapers/_template.js src/scrapers/newsource.js
```

### Step 2: Implement Scraper Logic

```javascript
const { formatDateForSupabase, crypto } = require('../main');

async function scrapeNewSource({ page, maxItems, webhookUrl, webhookSecret }) {
  console.log('Opening New Source Portal...');
  
  await page.goto('https://newsource.com', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  // Extract list items
  const items = await page.evaluate(() => {
    // Your extraction logic
    return data;
  });

  // Process details
  const results = [];
  for (const item of items) {
    // Your detail extraction logic
    results.push(processedItem);
  }

  return results;
}

module.exports = { scrapeNewSource };
```

### Step 3: Update Main Router

In `src/main.js`, add to the switch statement:

```javascript
case 'newsource':
  sourceName = 'New Source Portal';
  const { scrapeNewSource } = require('./scrapers/newsource');
  results = await scrapeNewSource({ page, maxItems, webhookUrl, webhookSecret });
  break;
```

### Step 4: Update Input Schema

In `.actor/input_schema.json`:

```json
{
  "enum": ["ontario", "samgov", "newsource"],
  "enumTitles": ["Ontario Tenders Portal", "SAM.gov", "New Source Portal"]
}
```

### Step 5: Test

Run with `source: "newsource"` and verify results.

## 🔧 Utility Functions

Available to all scrapers via `require('../main')`:

### `formatDateForSupabase(dateString)`
Converts various date formats to ISO 8601 for Supabase:

```javascript
const { formatDateForSupabase } = require('../main');

const isoDate = formatDateForSupabase('Oct 11, 2025 3:00 PM EST');
// Returns: "2025-10-11T15:00:00.000Z"
```

### `crypto`
For generating fingerprint hashes:

```javascript
const { crypto } = require('../main');

const fingerprint = crypto
  .createHash('sha256')
  .update(`${title}${ref}${date}`)
  .digest('hex')
  .slice(0, 40);
```

## 📊 Data Format

All scrapers must return an array of objects with this structure:

```javascript
{
  id: "fingerprint-hash",                    // Required
  hash_fingerprint: "fingerprint-hash",      // Required
  title: "Project Title",                    // Required
  agency: "Organization Name",               // Required
  status: "Active",                          // Required
  project_reference: "REF-123",              // Required
  created_at: "2025-10-11T12:00:00.000Z",   // ISO format
  category: "Category",
  listing_expiry_date: "2025-11-16T23:00:00.000Z",
  portal_url: "https://...",                 // Required
  city: "Location",
  portal_source: "Source Name",              // Required
  
  // Additional fields (source-specific)
  detailed_description: "...",
  scope_of_work: "...",
  contact_email: "...",
  // etc.
}
```

## 🔄 Webhook Payload

Data is sent in batches of 10:

```javascript
{
  items: [...],                  // Array of opportunities (max 10)
  source: "Ontario Tenders Portal",
  timestamp: "2025-10-11T12:00:00.000Z",
  batchIndex: 0,
  totalBatches: 5
}
```

## 🧪 Testing Individual Scrapers

You can test scrapers independently by creating a test file:

```javascript
// test-ontario.js
const { chromium } = require('playwright');
const { scrapeOntario } = require('./src/scrapers/ontario');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  const results = await scrapeOntario({
    page,
    maxItems: 3,
    webhookUrl: '',
    webhookSecret: ''
  });
  
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
```

## 📋 Scraper Checklist

When creating a new scraper, ensure:

- [ ] Exports a single async function
- [ ] Accepts `{ page, maxItems, webhookUrl, webhookSecret }`
- [ ] Returns array of standardized objects
- [ ] Uses `formatDateForSupabase()` for dates
- [ ] Generates fingerprint hashes with crypto
- [ ] Handles errors gracefully
- [ ] Logs progress to console
- [ ] Saves basic data even if details fail
- [ ] Goes back to list after each detail page
- [ ] Includes source name in portal_source field

## 🎯 Best Practices

### 1. Keep Scrapers Independent
Don't import from other scrapers. If you need shared logic, add it to main.js utilities.

### 2. Use Consistent Logging
```javascript
console.log('Opening Portal...');
console.log(`Found ${items.length} opportunities`);
console.log(`✅ Successfully processed`);
console.error(`❌ Failed to process:`, error.message);
```

### 3. Always Generate Fingerprints
```javascript
const fingerprint = crypto
  .createHash('sha256')
  .update(`${title}${reference}${expiry}`)
  .digest('hex')
  .slice(0, 40);
```

### 4. Format Dates
```javascript
created_at: formatDateForSupabase(rawDate),
listing_expiry_date: formatDateForSupabase(rawExpiryDate),
```

### 5. Handle Errors
```javascript
try {
  // Extract details
} catch (error) {
  console.error(`❌ Failed:`, error.message);
  // Save basic data anyway
}
```

## 🔍 Debugging

### Enable Debug Mode
```json
{
  "debug": true
}
```

### View Scraper Logs
1. Go to Apify actor run
2. Click "Log" tab
3. Search for your source name

### Test with Small Dataset
```json
{
  "maxItems": 3
}
```

## 📦 Example: Adding UK Government Contracts

### 1. Create scraper
```bash
# src/scrapers/ukgov.js
```

```javascript
const { formatDateForSupabase, crypto } = require('../main');

async function scrapeUKGov({ page, maxItems }) {
  await page.goto('https://www.contractsfinder.service.gov.uk');
  // ... extraction logic
  return results;
}

module.exports = { scrapeUKGov };
```

### 2. Update main.js router
```javascript
case 'ukgov':
  sourceName = 'UK Government Contracts';
  const { scrapeUKGov } = require('./scrapers/ukgov');
  results = await scrapeUKGov({ page, maxItems });
  break;
```

### 3. Update input_schema.json
```json
{
  "enum": ["ontario", "samgov", "ukgov"],
  "enumTitles": ["Ontario", "SAM.gov", "UK Gov"]
}
```

### 4. Deploy and test!

## 🚨 Common Issues

### Import Error
```
Error: Cannot find module './scrapers/newsource'
```
**Solution:** Ensure file exists and path is correct.

### Function Not Exported
```
TypeError: scrapeNewSource is not a function
```
**Solution:** Check `module.exports = { scrapeNewSource };`

### Utility Not Found
```
ReferenceError: formatDateForSupabase is not defined
```
**Solution:** Import from main: `const { formatDateForSupabase } = require('../main');`

## 📈 Scaling

This architecture easily scales to 10+ sources:

```
src/scrapers/
├── ontario.js
├── samgov.js
├── ukgov.js
├── australia.js
├── singapore.js
├── canada.js
├── newzealand.js
├── india.js
├── southafrica.js
└── brazil.js
```

Just keep adding files and updating the router!

## 📄 License

MIT

## 🤝 Contributing

1. Create new scraper from template
2. Test thoroughly
3. Update documentation
4. Submit for review
