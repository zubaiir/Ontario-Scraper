# 📁 Folder Structure

```
your-apify-actor/
│
├── 📄 .actor/
│   └── input_schema.json        # Input configuration (dropdown for sources)
│
├── 📂 src/
│   ├── main.js                  # 🎯 Main orchestrator
│   │                              - Routes to scrapers
│   │                              - Handles webhooks
│   │                              - Exports utilities
│   │
│   └── 📂 scrapers/
│       ├── ontario.js           # 🍁 Ontario Tenders Portal scraper
│       ├── samgov.js            # 🇺🇸 SAM.gov scraper
│       ├── _template.js         # 📋 Template for new scrapers
│       │
│       └── [add more here]      # 🚀 Your future scrapers:
│           ├── ukgov.js         #    - UK Government
│           ├── australia.js     #    - Australia
│           ├── singapore.js     #    - Singapore
│           └── ...              #    - etc.
│
├── 📄 package.json              # Dependencies (apify, playwright, etc.)
├── 📄 package-lock.json
├── 📄 Dockerfile                # (optional) Custom build
└── 📄 README.md                 # This documentation
```

## 🔄 Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Apify Actor Starts                        │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────┐     │
│  │                    main.js                          │     │
│  │  1. Get input: { source: "ontario", ... }         │     │
│  │  2. Launch browser                                  │     │
│  │  3. Route based on source ────────────────────┐    │     │
│  └──────────────────────────────────────────────┘    │     │
│                                                       │     │
│  ┌──────────────────────────────────────────────────▼─────┐│
│  │               Scraper Selection                         ││
│  │                                                          ││
│  │  if source === "ontario"  ──▶  scrapers/ontario.js     ││
│  │  if source === "samgov"   ──▶  scrapers/samgov.js      ││
│  │  if source === "ukgov"    ──▶  scrapers/ukgov.js       ││
│  │  ...                                                     ││
│  └──────────────────────────────────────────────────────────┘│
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────┐     │
│  │          Individual Scraper (e.g., ontario.js)     │     │
│  │  1. Navigate to portal                             │     │
│  │  2. Extract list items                             │     │
│  │  3. Visit each detail page                         │     │
│  │  4. Return standardized results []                 │     │
│  └────────────────────────────────────────────────────┘     │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────┐     │
│  │                Back to main.js                      │     │
│  │  1. Receive results from scraper                   │     │
│  │  2. Save to Apify dataset                          │     │
│  │  3. Send to webhook in batches                     │     │
│  │  4. Generate summary report                        │     │
│  └────────────────────────────────────────────────────┘     │
│                          ▼                                   │
│                    Actor Complete                            │
└─────────────────────────────────────────────────────────────┘
```

## 🎯 Quick Reference: Adding a New Source

### ⚡ 3-Minute Setup

1️⃣ **Copy template:**
```bash
cp src/scrapers/_template.js src/scrapers/mynewsource.js
```

2️⃣ **Fill in placeholders:**
```javascript
// src/scrapers/mynewsource.js
async function scrapeMyNewSource({ page, maxItems }) {
  await page.goto('https://mynewportal.com');
  // ... your logic
  return results;
}
module.exports = { scrapeMyNewSource };
```

3️⃣ **Add to main.js router:**
```javascript
// src/main.js
case 'mynewsource':
  const { scrapeMyNewSource } = require('./scrapers/mynewsource');
  results = await scrapeMyNewSource({ page, maxItems });
  break;
```

4️⃣ **Update input schema:**
```json
{
  "enum": ["ontario", "samgov", "mynewsource"],
  "enumTitles": ["Ontario", "SAM.gov", "My New Source"]
}
```

✅ **Done!** Deploy and test with `source: "mynewsource"`

## 📊 Module Responsibilities

| Module | Responsibility | Touches |
|--------|---------------|---------|
| **main.js** | Routing, webhooks, orchestration | All scrapers |
| **ontario.js** | Ontario-specific scraping | Only Ontario portal |
| **samgov.js** | SAM.gov-specific scraping | Only SAM.gov portal |
| **_template.js** | Reference/starter for new scrapers | Nothing (template) |

## 🔧 Shared Utilities (from main.js)

All scrapers can import:

```javascript
const { formatDateForSupabase, crypto } = require('../main');

// Use utilities
const isoDate = formatDateForSupabase('Oct 11, 2025');
const hash = crypto.createHash('sha256').update(data).digest('hex');
```

## 🎨 Code Organization Benefits

### ❌ Before (Everything in one file)
```javascript
// main.js (3000+ lines) 😱
- Ontario scraping logic (500 lines)
- SAM.gov scraping logic (600 lines)
- UK Gov scraping logic (550 lines)
- Australia scraping logic (500 lines)
- Routing logic (100 lines)
- Webhook logic (200 lines)
- Utilities (100 lines)
- ... impossible to maintain!
```

### ✅ After (Modular)
```javascript
// main.js (200 lines) ✨
- Routing (50 lines)
- Webhook handling (100 lines)
- Utilities (50 lines)

// scrapers/ontario.js (500 lines) 📁
- Only Ontario logic

// scrapers/samgov.js (600 lines) 📁
- Only SAM.gov logic

// scrapers/ukgov.js (550 lines) 📁
- Only UK Gov logic
```

**Result:** Each file is focused, maintainable, and testable!

## 🧪 Testing Individual Modules

```javascript
// test-ontario.js
const { chromium } = require('playwright');
const { scrapeOntario } = require('./src/scrapers/ontario');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  const results = await scrapeOntario({
    page,
    maxItems: 2,
    webhookUrl: '',
    webhookSecret: ''
  });
  
  console.log('Results:', results.length);
  console.log('First item:', results[0]);
  
  await browser.close();
})();
```

Run: `node test-ontario.js`

## 📝 Scraper Function Signature

Every scraper MUST follow this signature:

```javascript
/**
 * @param {Object} params
 * @param {Page} params.page - Playwright page object
 * @param {number} params.maxItems - Max items to scrape (0 = all)
 * @param {string} params.webhookUrl - Optional webhook URL
 * @param {string} params.webhookSecret - Optional webhook secret
 * @returns {Promise<Array>} Array of opportunity objects
 */
async function scrapeSomething({ page, maxItems, webhookUrl, webhookSecret }) {
  // Your implementation
  return results;
}
```

## 🎯 Standard Return Format

Every scraper MUST return:

```javascript
[
  {
    id: "abc123...",              // SHA256 hash (40 chars)
    hash_fingerprint: "abc123...", // Same as id
    title: "Project Title",        // Required
    agency: "Organization",        // Required
    status: "Active",             // Required
    project_reference: "REF-001",  // Required
    created_at: "2025-10-11T00:00:00.000Z", // ISO 8601
    category: "Construction",
    listing_expiry_date: "2025-11-16T00:00:00.000Z", // ISO 8601
    portal_url: "https://...",    // Required
    city: "Location",
    portal_source: "Source Name",  // Required
    
    // ... additional source-specific fields
  },
  // ... more items
]
```

## 🚀 Deployment Checklist

Before deploying:

- [ ] All scrapers in `src/scrapers/` folder
- [ ] Each scraper exports its function
- [ ] Main.js imports and routes correctly
- [ ] Input schema updated with new sources
- [ ] Tested locally with `maxItems: 2`
- [ ] Error handling in place
- [ ] Logging statements added
- [ ] README.md updated
- [ ] No hardcoded credentials

## 💡 Pro Tips

1. **Start with template** - Always copy `_template.js`
2. **Test small first** - Use `maxItems: 3` for initial testing
3. **Log everything** - Console.log is your friend
4. **Handle errors** - Always save basic data even if details fail
5. **Use formatDateForSupabase** - For all date fields
6. **Generate fingerprints** - For deduplication
7. **Keep scrapers independent** - No cross-imports between scrapers
8. **Document selectors** - Comment your CSS selectors
9. **Version control** - Git commit after each new scraper
10. **Test in production** - Apify console first, then schedule

## 🎓 Learning Path

1. ✅ Understand the architecture (you're here!)
2. 📖 Read ontario.js or samgov.js for examples
3. 🧪 Test an existing scraper locally
4. 📋 Copy _template.js for your new source
5. 🎨 Customize the template
6. 🧪 Test your scraper
7. 🔗 Integrate into main.js
8. 🚀 Deploy to Apify
9. 📅 Schedule regular runs
10. 🎉 Celebrate!

## 📞 Need Help?

Check:
1. README.md (this file)
2. _template.js (starter code)
3. ontario.js or samgov.js (working examples)
4. Apify logs (debugging)
5. Playwright docs (selectors)

---

**Remember:** This modular architecture means you can have 20+ sources without a messy codebase. Each scraper is independent and maintainable! 🎉