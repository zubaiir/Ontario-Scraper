# 🎉 Modular Multi-Portal Scraper - Complete Package

## ✅ What You Got

A fully modular Apify actor that supports multiple tender/contract portals with clean separation of concerns.

### 📦 Package Contents

```
modular/
├── main.js                  ✨ Main orchestrator (200 lines)
├── scrapers/
│   ├── ontario.js          🍁 Ontario Tenders Portal
│   ├── samgov.js           🇺🇸 SAM.gov
│   └── _template.js        📋 Template for new sources
├── README.md               📖 Full documentation
└── STRUCTURE.md            📁 Architecture guide
```

Plus from earlier:
```
../
└── input_schema.json       ⚙️ Input configuration
```

## 🚀 How to Deploy to Apify

### Method 1: Via Apify Console (Recommended)

1. **Create New Actor**
   - Go to [Apify Console](https://console.apify.com)
   - Click "Actors" → "Create new"
   - Name it: `multi-portal-scraper`

2. **Upload Files**
   ```
   your-actor/
   ├── .actor/
   │   └── input_schema.json    ← Upload this
   └── src/
       ├── main.js               ← Upload this
       └── scrapers/
           ├── ontario.js        ← Upload this
           ├── samgov.js         ← Upload this
           └── _template.js      ← Upload this (optional)
   ```

3. **Set package.json Dependencies**
   ```json
   {
     "name": "multi-portal-scraper",
     "version": "1.0.0",
     "dependencies": {
       "apify": "^3.0.0",
       "playwright": "^1.40.0"
     }
   }
   ```

4. **Build & Test**
   - Click "Build"
   - Wait for build to complete
   - Click "Try it"
   - Select source: "Ontario Tenders Portal"
   - Set maxItems: 3
   - Add webhook URL
   - Click "Start"

### Method 2: Via Apify CLI

```bash
# Install CLI
npm install -g apify-cli

# Login
apify login

# Create actor
apify create multi-portal-scraper

# Replace files
cp modular/main.js multi-portal-scraper/src/
cp -r modular/scrapers multi-portal-scraper/src/
cp input_schema.json multi-portal-scraper/.actor/

# Deploy
cd multi-portal-scraper
apify push
```

## 🎯 Usage Examples

### Example 1: Scrape Ontario (5 items)
```json
{
  "source": "ontario",
  "webhookUrl": "https://xyz.supabase.co/functions/v1/webhook",
  "webhookSecret": "your-secret",
  "maxItems": 5
}
```

### Example 2: Scrape SAM.gov (all items)
```json
{
  "source": "samgov",
  "webhookUrl": "https://xyz.supabase.co/functions/v1/webhook",
  "webhookSecret": "your-secret",
  "maxItems": 0
}
```

### Example 3: Test Mode (no webhook)
```json
{
  "source": "ontario",
  "webhookUrl": "",
  "webhookSecret": "",
  "maxItems": 3
}
```

## 📅 Schedule Setup

Create separate schedules for each source:

**Schedule 1: Ontario Daily**
- Name: "Ontario Tenders - Daily"
- Cron: `0 9 * * *` (9 AM daily)
- Input:
  ```json
  {
    "source": "ontario",
    "webhookUrl": "...",
    "webhookSecret": "...",
    "maxItems": 0
  }
  ```

**Schedule 2: SAM.gov Daily**
- Name: "SAM.gov - Daily"
- Cron: `0 10 * * *` (10 AM daily)
- Input:
  ```json
  {
    "source": "samgov",
    "webhookUrl": "...",
    "webhookSecret": "...",
    "maxItems": 0
  }
  ```

## ➕ Adding Your Third Source

Let's say you want to add UK Government contracts:

### Step 1: Create Scraper (5 minutes)

```bash
# Copy template
cp scrapers/_template.js scrapers/ukgov.js
```

Edit `scrapers/ukgov.js`:
```javascript
const { formatDateForSupabase, crypto } = require('../main');

async function scrapeUKGov({ page, maxItems }) {
  console.log('Opening UK Government Contracts Portal...');
  
  await page.goto('https://www.contractsfinder.service.gov.uk/Search', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  // Wait for results
  await page.waitForSelector('.search-result');

  // Extract list
  const items = await page.evaluate(() => {
    const data = [];
    const results = document.querySelectorAll('.search-result');
    
    results.forEach(result => {
      const titleEl = result.querySelector('h2 a');
      const title = titleEl?.textContent.trim() || '';
      const detailUrl = titleEl?.getAttribute('href') || '';
      
      if (title && detailUrl) {
        data.push({
          title,
          detailUrl,
          portal_url: 'https://www.contractsfinder.service.gov.uk',
          portal_source: 'UK Government Contracts',
          city: 'United Kingdom',
          // ... extract other fields
        });
      }
    });
    
    return data;
  });

  console.log(`Found ${items.length} opportunities`);

  // Process details
  const results = [];
  const itemsToProcess = maxItems > 0 ? items.slice(0, maxItems) : items;

  for (let i = 0; i < itemsToProcess.length; i++) {
    const item = itemsToProcess[i];
    console.log(`Processing ${i + 1}/${itemsToProcess.length}: "${item.title}"`);

    try {
      // Navigate to detail page
      await page.goto(`https://www.contractsfinder.service.gov.uk${item.detailUrl}`);
      
      // Extract details
      const detailData = await page.evaluate(() => {
        // Your extraction logic
        return { /* extracted fields */ };
      });

      // Merge data
      const mergedData = {
        ...item,
        ...detailData,
        created_at: formatDateForSupabase(detailData.published_date),
        listing_expiry_date: formatDateForSupabase(detailData.expiry_date),
      };

      // Generate fingerprint
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${mergedData.title}${mergedData.project_reference}`)
        .digest('hex')
        .slice(0, 40);

      results.push({
        id: fingerprint,
        ...mergedData,
        hash_fingerprint: fingerprint,
      });

      console.log('✅ Success');
      
    } catch (error) {
      console.error('❌ Failed:', error.message);
    }
  }

  return results;
}

module.exports = { scrapeUKGov };
```

### Step 2: Update main.js Router (1 minute)

In `main.js`, add to the switch statement:

```javascript
case 'ukgov':
  sourceName = 'UK Government Contracts';
  const { scrapeUKGov } = require('./scrapers/ukgov');
  results = await scrapeUKGov({ page, maxItems, webhookUrl, webhookSecret });
  break;
```

### Step 3: Update input_schema.json (1 minute)

```json
{
  "source": {
    "enum": ["ontario", "samgov", "ukgov"],
    "enumTitles": [
      "Ontario Tenders Portal",
      "SAM.gov",
      "UK Government Contracts"
    ]
  }
}
```

### Step 4: Deploy & Test (2 minutes)

```bash
# Push to Apify
apify push

# Or upload files via console
```

Test with:
```json
{
  "source": "ukgov",
  "maxItems": 3
}
```

**Total time: ~10 minutes!** 🎉

## 🎨 Architecture Benefits

### Before (Single File)
```
❌ 5 sources = 1 file with 5,000 lines
❌ Hard to debug
❌ One bug affects everything
❌ Scary to modify
❌ Takes hours to add new source
```

### After (Modular)
```
✅ 5 sources = 5 files with 500 lines each
✅ Easy to debug (isolate issues)
✅ One bug affects only that scraper
✅ Safe to modify individual scrapers
✅ Takes 10 minutes to add new source
```

## 📊 Comparison Table

| Aspect | Single File | Modular Architecture |
|--------|-------------|----------------------|
| **Lines per file** | 5,000+ | 200-500 |
| **Add new source** | 2-4 hours | 10-15 minutes |
| **Debug issue** | Search entire file | Go to specific scraper |
| **Test individual** | Run everything | Test one scraper |
| **Merge conflicts** | Frequent | Rare |
| **Code review** | Difficult | Easy |
| **Maintainability** | ⭐ | ⭐⭐⭐⭐⭐ |

## 🔧 Maintenance

### Update One Scraper
```bash
# Only edit the affected file
vim src/scrapers/ontario.js

# Deploy
apify push

# Test
# Only Ontario scraper is affected!
```

### Fix Bug in Webhook
```bash
# Only edit main.js
vim src/main.js

# All scrapers benefit from the fix
```

### Add Utility Function
```bash
# Add to main.js
vim src/main.js

# Export it
module.exports.yourUtility = yourUtility;

# Use in any scraper
const { yourUtility } = require('../main');
```

## 📈 Scaling Plan

**Month 1:** Ontario + SAM.gov (2 sources)  
**Month 2:** Add UK + Australia (4 sources)  
**Month 3:** Add Singapore + Canada (6 sources)  
**Month 4:** Add 4 more sources (10 sources)  
**Month 5:** Add 5 more sources (15 sources)  
**Month 6:** Add 5 more sources (20 sources)

**Result:** 20 different portals, all maintainable, all in separate files! 🚀

## 🎓 Learning Resources

1. **Start Here:**
   - Read `STRUCTURE.md` for architecture overview
   - Read `README.md` for detailed guide

2. **Learn by Example:**
   - Study `scrapers/ontario.js` for Playwright usage
   - Study `scrapers/samgov.js` for complex extraction

3. **Use Template:**
   - Copy `scrapers/_template.js`
   - Fill in the blanks
   - Deploy and test

4. **External Resources:**
   - [Apify Documentation](https://docs.apify.com)
   - [Playwright Documentation](https://playwright.dev)
   - [Supabase Edge Functions](https://supabase.com/docs/guides/functions)

## ✅ Pre-Deployment Checklist

Before going to production:

- [ ] All scrapers tested with `maxItems: 3`
- [ ] Date formatting works (ISO 8601)
- [ ] Fingerprints generated correctly
- [ ] Error handling in place
- [ ] Logging statements added
- [ ] Webhook tested with real endpoint
- [ ] Input schema includes all sources
- [ ] README updated with new sources
- [ ] Environment variables secured
- [ ] Schedules configured
- [ ] Monitoring alerts set up

## 🎯 Next Steps

1. **Deploy to Apify** (15 minutes)
   - Upload files
   - Configure input schema
   - Test with small dataset

2. **Set Up Webhooks** (10 minutes)
   - Create Supabase Edge Function
   - Test webhook endpoint
   - Verify data insertion

3. **Create Schedules** (5 minutes)
   - Schedule Ontario (daily)
   - Schedule SAM.gov (daily)

4. **Monitor First Runs** (1 day)
   - Check logs
   - Verify data quality
   - Fix any issues

5. **Add Third Source** (1 hour)
   - Copy template
   - Implement scraper
   - Test and deploy

6. **Scale Up** (ongoing)
   - Add new sources monthly
   - Refine existing scrapers
   - Optimize performance

## 💪 You're Ready!

You now have:
- ✅ Clean, modular architecture
- ✅ Two working scrapers (Ontario, SAM.gov)
- ✅ Template for adding more
- ✅ Complete documentation
- ✅ Deployment instructions
- ✅ Scaling plan

**Go build something amazing! 🚀**

---

## 📞 Support

- **Architecture Questions:** Read `STRUCTURE.md`
- **Implementation Help:** Check `README.md`
- **Code Examples:** See `ontario.js` or `samgov.js`
- **New Scraper:** Use `_template.js`

**Happy Scraping! 🎉**
