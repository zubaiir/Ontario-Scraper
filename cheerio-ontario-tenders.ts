import * as cheerio from "cheerio";

function mergeCookies(oldCookie: string, setCookieHeader: string | null) {
  if (!setCookieHeader) return oldCookie;
  const parts = setCookieHeader.split(",").map((c) => c.split(";")[0]);
  const jar: Record<string, string> = {};
  [...oldCookie.split(";"), ...parts].forEach((c) => {
    const [k, v] = c.split("=").map((x) => x.trim());
    if (k) jar[k] = v;
  });
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export async function scrapeOntario() {
  const base = "https://ontariotenders.app.jaggaer.com";
  let cookies = "";
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

  // 1️⃣ visit /home.html
  let res = await fetch(`${base}/esop/nac-host/public/home.html`, {
    headers: { "User-Agent": ua },
  });
  cookies = mergeCookies(cookies, res.headers.get("set-cookie"));

  // 2️⃣ choose English
  res = await fetch(`${base}/esop/nac-host/public/web/login.html?language=en_CA`, {
    headers: { "User-Agent": ua, cookie: cookies, Referer: `${base}/esop/nac-host/public/home.html` },
  });
  cookies = mergeCookies(cookies, res.headers.get("set-cookie"));

  // 3️⃣ fetch accessible opportunities
  res = await fetch(
    `${base}/esop/toolkit/opportunity/current/list.si?CONTROLS_ACCESSIBLE=true`,
    {
      headers: {
        "User-Agent": ua,
        cookie: cookies,
        Referer: `${base}/esop/nac-host/public/web/login.html?language=en_CA`,
      },
    }
  );

  const html = await res.text();
  const $ = cheerio.load(html);
  const rows = $("table tr");
  const data: any[] = [];

  rows.slice(1).each((_, el) => {
    const tds = $(el).find("td");
    if (tds.length < 7) return;

    const link = $(tds[3]).find("a");
    const href = link.attr("href")
      ? base + link.attr("href")
      : base;
    data.push({
      procurement_route: $(tds[0]).text().trim(),
      buyer_organization: $(tds[1]).text().trim(),
      project_reference: $(tds[2]).text().trim(),
      title: link.text().trim() || $(tds[3]).text().trim(),
      publication_date: $(tds[4]).text().trim(),
      work_category: $(tds[5]).text().trim(),
      listing_expiry_date: $(tds[6]).text().trim(),
      portal_url: href,
    });
  });

  return { source: "OTP/JAGGAER", count: data.length, items: data };
}

(async () => {
  const r = await scrapeOntario();
  console.log(JSON.stringify(r, null, 2));
})();
