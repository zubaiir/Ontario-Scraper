import { chromium } from "playwright";
import * as crypto from "crypto";

interface Opportunity {
  procurement_route: string;
  buyer_organization: string;
  project_reference: string;
  title: string;
  publication_date: string;
  work_category: string;
  listing_expiry_date: string;
  portal_url: string;
  region: string;
  portal_source: string;
  hash_fingerprint: string;
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 150 });
  const page = await browser.newPage();

  console.log("Opening Ontario Tenders Portal (root)...");
  await page.goto("https://ontariotenders.app.jaggaer.com/esop/nac-host/public/home.html", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // Step 1: click English
  const english = page.locator('a:has-text("English")');
  if (await english.isVisible().catch(() => false)) {
    console.log("Selecting English...");
    await english.click();
    await page.waitForLoadState("domcontentloaded");
  }

  // Step 2: click "Current Opportunities"
  const currentOpp = page.locator('a:has-text("Current Opportunities")');
  await currentOpp.waitFor({ timeout: 20000 });
  console.log("Navigating to Current Opportunities...");
  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    currentOpp.click(),
  ]);

  // Step 3: ensure we are in accessible mode
  await page.waitForTimeout(4000);
  const accessibleLink = page.locator('a:has-text("Switch To Accessible Controls")');
  if (await accessibleLink.isVisible().catch(() => false)) {
    console.log("Switching to accessible view...");
    await accessibleLink.click();
    await page.waitForLoadState("domcontentloaded");
  }

  // Step 4: Wait for accessible table
  console.log("Waiting for table...");
  await page.waitForSelector("table tr", { timeout: 60000 });

  // Step 5: Extract rows correctly (matching table headers)
  const items = await page.$$eval("table tr", (rows) => {
    const data: any[] = [];
    for (const r of rows.slice(1)) {
      const cells = Array.from(r.querySelectorAll("td")).map((c) =>
        (c.textContent || "").trim()
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

      const linkEl = r.querySelector("a");
      const href = linkEl ? (linkEl.getAttribute("href") || "") : "";
      const title = linkEl ? (linkEl.textContent || "").trim() : projectTitle;

      data.push({
        procurement_route: procurementRoute,
        buyer_organization: buyerOrganization,
        project_reference: projectReference,
        title,
        publication_date: publicationDate,
        work_category: workCategory,
        listing_expiry_date: expiryDate,
        portal_url: href
          ? href.startsWith("http")
            ? href
            : `https://ontariotenders.app.jaggaer.com${href}`
          : "https://ontariotenders.app.jaggaer.com/",
      });
    }
    return data;
  });

  // Step 6: Normalize + hash + add metadata
  const results: Opportunity[] = items.map((r) => ({
    ...r,
    region: "CA-ON",
    portal_source: "OTP/JAGGAER",
    hash_fingerprint: crypto
      .createHash("sha256")
      .update(`${r.title}${r.project_reference}${r.listing_expiry_date}`)
      .digest("hex")
      .slice(0, 40),
  }));

  console.log(
    JSON.stringify({ source: "OTP/JAGGAER", count: results.length, items: results }, null, 2)
  );

  await browser.close();
})();

