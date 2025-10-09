

// import { chromium } from "playwright";
// import * as crypto from "crypto";
// import * as fs from "fs";

// interface Opportunity {
//   title: string;
//   agency: string;
//   region: string;
//   summary?: string;
//   submission_due?: string;
//   published?: string;
//   portal_source: string;
//   portal_url: string;
//   hash_fingerprint: string;
// }

// // const LIST_URL =
// //   "https://ontariotenders.app.jaggaer.com/esop/toolkit/opportunity/current/list.si?reset=true&resetstored=true&language=en_CA";

// const BASE_URL = "https://ontariotenders.app.jaggaer.com/";

// function parseDMY(text?: string | null): string | undefined {
//   if (!text) return undefined;
//   const m = text.trim().match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
//   if (!m) return undefined;
//   const [, dd, mm, yyyy, hh = "00", mi = "00"] = m;
//   const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi));
//   return isNaN(d.getTime()) ? undefined : d.toISOString();
// }

// function hash(op: Pick<Opportunity, "title" | "agency" | "submission_due" | "portal_url">) {
//   return crypto.createHash("sha256")
//     .update(`${op.title}|${op.agency}|${op.submission_due ?? ""}|${op.portal_url}`)
//     .digest("hex")
//     .slice(0, 40);
// }

// async function clickIfVisible(ctx: any, selector: string) {
//   const loc = ctx.locator(selector);
//   if (await loc.first().isVisible().catch(() => false)) {
//     await loc.first().click({ timeout: 3000 }).catch(() => {});
//   }
// }

// (async () => {
//   // run headful once to debug; switch to true when stable
//   const browser = await chromium.launch({ headless: false, slowMo: 150 });
//   const page = await browser.newPage();

//   console.log("Opening Ontario Tenders Portal (root)...");
//   await page.goto("https://ontariotenders.app.jaggaer.com/", {
//     waitUntil: "domcontentloaded",
//     timeout: 60000,
//   });

//   // Step 1: choose language
//   const langBtn = page.locator('a:has-text("English (Canada)")');
//   if (await langBtn.isVisible().catch(() => false)) {
//     console.log("Selecting English (Canada)...");
//     await Promise.all([
//       page.waitForLoadState("domcontentloaded"),
//       langBtn.click()
//     ]);
//   }

//   // Step 2: click “Current Opportunities”
//   await page.waitForTimeout(4000);
//   const oppLink = page.locator('a:has-text("Current Opportunities")');
//   if (await oppLink.isVisible().catch(() => false)) {
//     console.log("Navigating to Current Opportunities...");
//     await Promise.all([
//       page.waitForLoadState("domcontentloaded"),
//       oppLink.click()
//     ]);
//   } else {
//     console.warn("Could not find 'Current Opportunities' link; staying on current page.");
//   }

//   // Step 3: wait for table to load
//   await page.waitForTimeout(6000);

//   // Handle cookie/consent banners (best-effort)
//   await clickIfVisible(page, 'button:has-text("Accept")');
//   await clickIfVisible(page, 'button:has-text("I Agree")');
//   await clickIfVisible(page, 'button:has-text("Accept All Cookies")');

//   // Make sure we are on “Current Opportunities”
//   await clickIfVisible(page, 'a:has-text("Current Opportunities")');

//   // Some portals hide content behind “Switch To Accessible Controls”
//   await clickIfVisible(page, 'button:has-text("Switch To Accessible Controls")');

//   // Give the grid time to render
//   await page.waitForTimeout(3000);

//   // Try multiple table body selectors commonly used by Jaggaer
//   const rowSelectors = [
//     "table.list-table.fixed-layout tbody.list-tbody tr",
//     "table.list-table tbody.list-tbody tr",
//     "table tbody.async-list-tbody tr",
//     "table tbody tr.table_cnt_body_a",
//     "table tbody tr.table_cnt_body_b",
//     "table tbody tr"
//   ];

//   let rowsCount = 0;
//   let rowsLocator: any = null;

//   for (const sel of rowSelectors) {
//     const loc = page.locator(sel);
//     try {
//       // short wait for each candidate selector
//       await loc.first().waitFor({ timeout: 4000 });
//       rowsCount = await loc.count();
//       if (rowsCount > 0) {
//         rowsLocator = loc;
//         console.log(`Found rows with selector: ${sel} (count=${rowsCount})`);
//         break;
//       }
//     } catch {
//       // try next selector
//     }
//   }

//   // Fallback: dump screenshot + HTML if still nothing
//   if (!rowsLocator || rowsCount === 0) {
//     console.warn("No rows found via locator API. Trying in-page evaluation fallback…");
//     await page.screenshot({ path: "otp_debug.png", fullPage: true }).catch(() => {});
//     const html = await page.content();
//     fs.writeFileSync("otp_debug.html", html, "utf8");

//     // Evaluate directly in the page to bypass locator visibility constraints
//     const items = await page.evaluate(() => {
//       function txt(el?: Element | null) {
//         return (el?.textContent || "").replace(/\s+/g, " ").trim();
//       }
//       const tbodys = Array.from(
//         document.querySelectorAll("tbody.list-tbody, tbody.async-list-tbody, tbody")
//       );
//       const out: any[] = [];
//       for (const tb of tbodys) {
//         const trs = Array.from(tb.querySelectorAll("tr"));
//         for (const tr of trs) {
//           const tds = Array.from(tr.querySelectorAll("td"));
//           if (tds.length < 6) continue;

//           // Try common column positions (with/without leading row-number column)
//           const guess = (i: number) => tds[i] || null;

//           // Find title: usually an <a> inside project-title column
//           const titleA =
//             tr.querySelector("td a[onclick*='goToDetail']") ||
//             tr.querySelector("td a[href*='opportunityDetail']");
//           const title = txt(titleA);
//           if (!title) continue;

//           const agency =
//             txt(guess(2)) || // with row-number + procurement-route
//             txt(guess(1));   // if row-number not present

//           const published =
//             txt(guess(5)) || // typical
//             txt(guess(4));

//           const category =
//             txt(guess(6)) || // typical
//             txt(guess(5));

//           const expiry =
//             txt(guess(7)) || // typical
//             txt(guess(6));

//           // Build detail URL
//           let portalUrl = "";
//           const onclick = titleA?.getAttribute("onclick") || "";
//           const m = onclick.match(/goToDetail\('(\d+)'/);
//           if (m) {
//             portalUrl = `https://ontariotenders.app.jaggaer.com/esop/toolkit/opportunity/current/opportunityDetail.si?id=${m[1]}`;
//           } else {
//             const href = titleA?.getAttribute("href") || "";
//             portalUrl = href.startsWith("http")
//               ? href
//               : href
//                 ? `https://ontariotenders.app.jaggaer.com${href.startsWith("/") ? "" : "/"}${href}`
//                 : "https://ontariotenders.app.jaggaer.com";
//           }

//           out.push({
//             title,
//             agency,
//             region: "CA-ON",
//             summary: category,
//             submission_due_raw: expiry,
//             published_raw: published,
//             portal_url: portalUrl
//           });
//         }
//       }
//       return out;
//     });

//     // Normalize + hash
//     const normalized: Opportunity[] = items.map((r: any) => {
//       const base: Opportunity = {
//         title: r.title,
//         agency: r.agency || "Ontario (Province)",
//         region: "CA-ON",
//         summary: r.summary || undefined,
//         submission_due: parseDMY(r.submission_due_raw),
//         published: parseDMY(r.published_raw),
//         portal_source: "OTP/JAGGAER",
//         portal_url: r.portal_url,
//         hash_fingerprint: ""
//       };
//       base.hash_fingerprint = crypto
//         .createHash("sha256")
//         .update(`${base.title}|${base.agency}|${base.submission_due ?? ""}|${base.portal_url}`)
//         .digest("hex")
//         .slice(0, 40);
//       return base;
//     });

//     console.log(JSON.stringify({ source: "OTP/JAGGAER", count: normalized.length, items: normalized }, null, 2));
//     await browser.close();
//     console.warn(
//       "If count is 0, open otp_debug.html and otp_debug.png to see what Playwright actually loaded (banner, iframe, etc.)."
//     );
//     return;
//   }

//   // --- Normal path (locator found rows) ---
//   const results: Opportunity[] = [];

//   for (let i = 0; i < Math.min(rowsCount, 200); i++) {
//     const row = rowsLocator.nth(i);
//     const tds = row.locator("td");
//     const tdCount = await tds.count();
//     if (tdCount < 6) continue;

//     // Title link
//     const titleLink =
//       row.locator("td a[onclick*='goToDetail']").first().or(row.locator("td a[href*='opportunityDetail']").first());
//     const title = (await titleLink.innerText().catch(() => "")).trim();
//     if (!title) continue;

//     // Agency (usually 3rd or 2nd TD)
//     const agency =
//       ((await tds.nth(2).innerText().catch(() => "")) ||
//         (await tds.nth(1).innerText().catch(() => ""))).trim();

//     // Published, Category, Expiry (shift indices if a leading row-number column exists)
//     const publishedTxt =
//       ((await tds.nth(5).innerText().catch(() => "")) ||
//         (await tds.nth(4).innerText().catch(() => ""))).trim();

//     const categoryTxt =
//       ((await tds.nth(6).innerText().catch(() => "")) ||
//         (await tds.nth(5).innerText().catch(() => ""))).trim();

//     const expiryTxt =
//       ((await tds.nth(7).innerText().catch(() => "")) ||
//         (await tds.nth(6).innerText().catch(() => ""))).trim();

//     // Detail URL from onclick/href
//     const onclick = (await titleLink.getAttribute("onclick").catch(() => "")) || "";
//     const idMatch = onclick.match(/goToDetail\('(\d+)'/);
//     let portalUrl = "";
//     if (idMatch) {
//       portalUrl = `https://ontariotenders.app.jaggaer.com/esop/toolkit/opportunity/current/opportunityDetail.si?id=${idMatch[1]}`;
//     } else {
//       const href = (await titleLink.getAttribute("href").catch(() => "")) || "";
//       portalUrl = href
//         ? href.startsWith("http")
//           ? href
//           : `https://ontariotenders.app.jaggaer.com${href.startsWith("/") ? "" : "/"}${href}`
//         : BASE_URL;
//     }

//     const item: Opportunity = {
//       title,
//       agency: agency || "Ontario (Province)",
//       region: "CA-ON",
//       summary: categoryTxt || undefined,
//       submission_due: parseDMY(expiryTxt),
//       published: parseDMY(publishedTxt),
//       portal_source: "OTP/JAGGAER",
//       portal_url: portalUrl,
//       hash_fingerprint: ""
//     };
//     item.hash_fingerprint = hash(item);
//     results.push(item);
//   }

//   console.log(JSON.stringify({ source: "OTP/JAGGAER", count: results.length, items: results }, null, 2));

//   // Save a screenshot for your records
//   await page.screenshot({ path: "otp_success.png", fullPage: true }).catch(() => {});
//   await browser.close();
// })();
