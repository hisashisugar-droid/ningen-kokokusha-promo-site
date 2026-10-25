import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(path.join(rootDirectory, "site.config.json"), "utf8"));
const targetArgument = process.argv[2];
const expectedEpisodeCount = 342;
const expectedListingCount = 7;
const expectedSitemapCount = 350;
const concurrency = 5;
const timeoutMilliseconds = 10_000;

if (!targetArgument) {
  console.error("Usage: node scripts/verify-deploy.mjs https://example.vercel.app");
  process.exit(1);
}

let target;

try {
  target = new URL(targetArgument);
  if (!/^https?:$/.test(target.protocol)) throw new Error("http(s) URLではありません。");
  target.pathname = target.pathname.replace(/\/+$/, "");
  target.search = "";
  target.hash = "";
} catch (error) {
  console.error(`URLが不正です: ${error.message}`);
  process.exit(1);
}

const results = [];
const failedUrls = new Map();
const otherFailures = [];
let routeTotal = 0;
let routeOk = 0;

function targetUrl(pathname) {
  return new URL(pathname, `${target.href}/`);
}

function deployedUrl(sourceUrl) {
  const source = new URL(sourceUrl);
  return targetUrl(`${source.pathname}${source.search}`);
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/g)].map((match) => [match[1].toLowerCase(), match[2]]));
}

function metaContent(html, attributeName, attributeValue) {
  const tag = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((candidate) => attributes(candidate)[attributeName] === attributeValue);
  return tag ? attributes(tag).content ?? "" : "";
}

function canonicalUrl(html) {
  const tag = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((candidate) => attributes(candidate).rel?.toLowerCase() === "canonical");
  return tag ? attributes(tag).href ?? "" : "";
}

function decodeEntities(value) {
  const entities = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' };
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f\d]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match);
}

function addResult(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok && detail) otherFailures.push(`${name}: ${detail}`);
}

function noteRoute(url, ok, detail) {
  routeTotal += 1;
  if (ok) {
    routeOk += 1;
  } else if (!failedUrls.has(url.pathname)) {
    failedUrls.set(url.pathname, detail);
  }
}

async function request(url, { headers = {}, redirect = "follow", retries = 0 } = {}) {
  let lastResult;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMilliseconds);

    try {
      const response = await fetch(url, { headers, redirect, signal: controller.signal });
      const body = Buffer.from(await response.arrayBuffer());
      lastResult = { response, body, error: null };
      if (response.status === 200 || attempt === retries) return lastResult;
    } catch (error) {
      lastResult = { response: null, body: Buffer.alloc(0), error };
      if (attempt === retries) return lastResult;
    } finally {
      clearTimeout(timer);
    }
  }

  return lastResult;
}

async function mapConcurrent(items, limit, worker) {
  const output = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

function statusDetail(result) {
  if (result.error) return result.error.name === "AbortError" ? "timeout (10s)" : result.error.message;
  return `HTTP ${result.response.status}`;
}

async function checkRoutes(urls, { retries = 0, label, expectedCount = urls.length }) {
  const statuses = await mapConcurrent(urls, concurrency, async (url) => {
    const result = await request(url, { retries });
    const ok = result.response?.status === 200;
    noteRoute(url, ok, statusDetail(result));
    return { url, ok, detail: statusDetail(result), body: result.body };
  });
  const okCount = statuses.filter((status) => status.ok).length;
  addResult(label, urls.length === expectedCount && okCount === urls.length, `${okCount}/${expectedCount} HTTP 200`);
  return statuses;
}

const topUrl = targetUrl("/");
const topResult = await request(topUrl);
const topStatusOk = topResult.response?.status === 200;
noteRoute(topUrl, topStatusOk, statusDetail(topResult));
addResult("トップ HTTP", topStatusOk, statusDetail(topResult));
const topHtml = topResult.body.toString("utf8");

const ogImage = metaContent(topHtml, "property", "og:image");
addResult("トップ og:image", /^https:\/\//.test(ogImage), ogImage || "未検出");

const topCanonical = canonicalUrl(topHtml);
addResult("トップ canonical", topCanonical === `${config.siteUrl}/`, topCanonical || "未検出");

const apiUrl = targetUrl("/api/episodes");
const apiResult = await request(apiUrl);
const apiStatusOk = apiResult.response?.status === 200;
noteRoute(apiUrl, apiStatusOk, statusDetail(apiResult));
let apiEpisodes = [];
let apiShapeOk = false;

if (apiStatusOk) {
  try {
    const body = JSON.parse(apiResult.body.toString("utf8"));
    apiShapeOk = JSON.stringify(Object.keys(body)) === JSON.stringify(["episodes"])
      && Array.isArray(body.episodes)
      && body.episodes.length >= 1;
    apiEpisodes = Array.isArray(body.episodes) ? body.episodes : [];
  } catch {
    apiShapeOk = false;
  }
}

addResult("API", apiStatusOk && apiShapeOk, apiStatusOk ? `episodes ${apiEpisodes.length}件` : statusDetail(apiResult));

const listingUrls = Array.from({ length: expectedListingCount }, (_, index) => (
  targetUrl(index === 0 ? "/episodes" : `/episodes/page/${index + 1}`)
));
const listingStatuses = await checkRoutes(listingUrls, { label: "エピソード一覧", expectedCount: expectedListingCount });
const firstListingHtml = listingStatuses[0]?.body?.toString("utf8") ?? "";
const staticTitles = [...firstListingHtml.matchAll(/<article\b[^>]*class=["'][^"']*\bepisode-index-card\b[^"']*["'][^>]*>[\s\S]*?<h2\b[^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/gi)]
  .slice(0, 3)
  .map((match) => decodeEntities(match[1].replace(/<[^>]+>/g, "")).trim());
const decodedTopHtml = decodeEntities(topHtml);
const staticTitlesOk = staticTitles.length === 3 && staticTitles.every((title) => decodedTopHtml.includes(title));
addResult("トップ 最新3話", staticTitlesOk, staticTitles.length === 3 ? `${staticTitles.filter((title) => decodedTopHtml.includes(title)).length}/3件` : "一覧から3件取得できません");

const sitemapUrl = targetUrl("/sitemap.xml");
const sitemapResult = await request(sitemapUrl);
const sitemapStatusOk = sitemapResult.response?.status === 200;
noteRoute(sitemapUrl, sitemapStatusOk, statusDetail(sitemapResult));
const sitemapXml = sitemapResult.body.toString("utf8");
const sitemapUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decodeEntities(match[1]));
addResult("sitemap.xml", sitemapStatusOk && sitemapUrls.length === expectedSitemapCount, sitemapStatusOk ? `${sitemapUrls.length} urls (expected ${expectedSitemapCount})` : statusDetail(sitemapResult));

const episodeUrls = sitemapUrls
  .filter((url) => /^\/episodes\/episode-[^/]+$/.test(new URL(url).pathname))
  .map(deployedUrl);
addResult("エピソードURL数", episodeUrls.length === expectedEpisodeCount, `${episodeUrls.length} urls (expected ${expectedEpisodeCount})`);
await checkRoutes(episodeUrls, { retries: 1, label: "全エピソード", expectedCount: expectedEpisodeCount });

const redirectUrl = targetUrl("/episodes/episode-278.html");
const redirectResult = await request(redirectUrl, { redirect: "manual" });
const redirectLocation = redirectResult.response?.headers.get("location") ?? "";
let redirectPath = redirectLocation;
try {
  redirectPath = new URL(redirectLocation, target).pathname;
} catch {
  // 空または不正なLocationは下の判定で失敗にする。
}
const redirectOk = [301, 308].includes(redirectResult.response?.status)
  && redirectPath === "/episodes/episode-278";
noteRoute(redirectUrl, redirectOk, `${statusDetail(redirectResult)}, Location ${redirectLocation || "なし"}`);
addResult("旧URLリダイレクト", redirectOk, `${statusDetail(redirectResult)}, Location ${redirectLocation || "なし"}`);

const episode278Url = targetUrl("/episodes/episode-278");
const episode278Result = await request(episode278Url);
const episode278Html = episode278Result.body.toString("utf8");
const episode278Ok = episode278Result.response?.status === 200
  && canonicalUrl(episode278Html) === `${config.siteUrl}/episodes/episode-278`
  && /^https:\/\//.test(metaContent(episode278Html, "property", "og:image"));
noteRoute(episode278Url, episode278Ok, episode278Result.response?.status === 200 ? "canonicalまたはog:imageが不正" : statusDetail(episode278Result));
addResult("#278ページ", episode278Ok, episode278Result.response?.status === 200 ? `canonical ${canonicalUrl(episode278Html) || "未検出"}` : statusDetail(episode278Result));

const sitemapRouteUrls = sitemapUrls.map(deployedUrl);
await checkRoutes(sitemapRouteUrls, { label: "sitemap全URL", expectedCount: expectedSitemapCount });

const robotsUrl = targetUrl("/robots.txt");
const robotsResult = await request(robotsUrl);
const robotsText = robotsResult.body.toString("utf8");
const robotsOk = robotsResult.response?.status === 200
  && robotsText.split(/\r?\n/).includes(`Sitemap: ${config.siteUrl}/sitemap.xml`);
noteRoute(robotsUrl, robotsOk, robotsResult.response?.status === 200 ? "Sitemap行が不正" : statusDetail(robotsResult));
addResult("robots.txt", robotsOk, robotsOk ? "Sitemap行あり" : statusDetail(robotsResult));

const avifSource = [...topHtml.matchAll(/<source\b[^>]*>/gi)]
  .map((match) => match[0])
  .find((tag) => attributes(tag).type === "image/avif");
const avifSrc = avifSource ? attributes(avifSource).srcset ?? "" : "";
const heroUrl = avifSrc ? new URL(avifSrc, topUrl) : targetUrl("/__missing_avif_source__");
const heroResult = await request(heroUrl, { headers: { accept: "image/avif" } });
const heroContentType = heroResult.response?.headers.get("content-type")?.split(";", 1)[0].trim() ?? "";
const heroOk = heroResult.response?.status === 200
  && heroContentType === "image/avif"
  && heroResult.body.length < 200 * 1024;
noteRoute(heroUrl, heroOk, `${statusDetail(heroResult)}, ${heroContentType || "content-typeなし"}, ${heroResult.body.length} bytes`);
addResult("ヒーローAVIF", heroOk, `${heroContentType || "content-typeなし"}, ${heroResult.body.length} bytes`);

console.log(`\nDeploy verification: ${target.href}`);
console.log("| 検査 | 結果 | 詳細 |");
console.log("|---|---:|---|");
for (const result of results) {
  const detail = String(result.detail).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  console.log(`| ${result.name} | ${result.ok ? "OK" : "FAIL"} | ${detail} |`);
}

const failedResultCount = results.filter((result) => !result.ok).length;
console.log(`\nOK ${routeOk}/${routeTotal} routes  FAIL ${routeTotal - routeOk} routes  CHECK FAIL ${failedResultCount}`);

const failureLines = [
  ...[...failedUrls.entries()].map(([url, detail]) => `${url} ${detail}`),
  ...otherFailures,
];

if (failureLines.length) {
  console.log("\n失敗（最大20件）:");
  failureLines.slice(0, 20).forEach((failure) => console.log(`- ${failure}`));
  if (failureLines.length > 20) console.log(`- ほか${failureLines.length - 20}件`);
  process.exitCode = 1;
}
