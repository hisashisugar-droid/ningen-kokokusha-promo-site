import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(path.join(rootDirectory, "site.config.json"), "utf8"));
const keyFileName = "03ed34607048e8795f93ff68674a458d.txt";
const key = (await readFile(path.join(rootDirectory, keyFileName), "utf8")).trim();
const sitemap = await readFile(path.join(rootDirectory, "sitemap.xml"), "utf8");
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'"));
const siteUrl = new URL(config.siteUrl);

if (!/^[a-f0-9]{32}$/.test(key)) throw new Error("IndexNow keyは32桁の16進数である必要があります。");
if (!urlList.length) throw new Error("sitemap.xmlに送信対象URLがありません。");
if (urlList.some((url) => new URL(url).hostname !== siteUrl.hostname)) {
  throw new Error("sitemap.xmlにsiteUrl以外のホストが含まれています。");
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30_000);
let response;

try {
  response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "user-agent": "ningen-kokokusha-indexnow/1.0",
    },
    body: JSON.stringify({
      host: siteUrl.hostname,
      key,
      keyLocation: `${config.siteUrl}/${keyFileName}`,
      urlList,
    }),
    signal: controller.signal,
  });
} finally {
  clearTimeout(timeout);
}

console.log(`IndexNow status: ${response.status}`);
console.log(`送信URL数: ${urlList.length}`);

if (![200, 202].includes(response.status)) {
  const responseBody = (await response.text()).trim();
  if (responseBody) console.error(responseBody.slice(0, 1_000));
  process.exitCode = 1;
}
