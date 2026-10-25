import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const episodesDirectory = path.join(rootDirectory, "episodes");
const config = JSON.parse(await readFile(path.join(rootDirectory, "site.config.json"), "utf8"));
const cache = JSON.parse(await readFile(path.join(rootDirectory, "data", "episodes-cache.json"), "utf8"));
const episodesBySlug = new Map(cache.episodes.map((episode) => [episode.slug, episode]));
const errors = [];

async function collectHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectHtmlFiles(entryPath));
    } else if (entry.name.endsWith(".html")) {
      files.push(entryPath);
    }
  }

  return files;
}

function expectedCanonical(relativePath) {
  if (relativePath === "index.html") return `${config.siteUrl}/`;
  if (relativePath === "episodes/index.html") return `${config.siteUrl}/episodes`;

  const listingMatch = relativePath.match(/^episodes\/page\/(\d+)\/index\.html$/);
  if (listingMatch) return `${config.siteUrl}/episodes/page/${listingMatch[1]}`;

  const episodeMatch = relativePath.match(/^episodes\/(.+)\.html$/);
  if (episodeMatch) return `${config.siteUrl}/episodes/${episodeMatch[1]}`;

  return "";
}

function requireFields(data, fields, relativePath) {
  fields.forEach((field) => {
    if (!data[field]) errors.push(`${relativePath}: ${field} がありません。`);
  });
}

function scheduleSeries(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 1;

  const jstWeekday = new Date(date.getTime() + 9 * 60 * 60 * 1000).getUTCDay();
  const scheduledDays = [1, 3, 5];
  return scheduledDays.reduce((closest, day) => {
    const closestDistance = Math.min(Math.abs(jstWeekday - closest), 7 - Math.abs(jstWeekday - closest));
    const dayDistance = Math.min(Math.abs(jstWeekday - day), 7 - Math.abs(jstWeekday - day));
    return dayDistance < closestDistance ? day : closest;
  }, scheduledDays[0]);
}

const episodeFiles = await collectHtmlFiles(episodesDirectory);
const htmlFiles = [path.join(rootDirectory, "index.html"), ...episodeFiles].sort();
const canonicalUrls = new Set();
let episodePageCount = 0;
let listingPageCount = 0;

for (const htmlPath of htmlFiles) {
  const relativePath = path.relative(rootDirectory, htmlPath);
  const html = await readFile(htmlPath, "utf8");
  const expected = expectedCanonical(relativePath);
  const canonicalMatches = [...html.matchAll(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["'][^>]*>/gi)];

  if (!expected) {
    errors.push(`${relativePath}: canonicalの期待値を決定できません。`);
  } else if (canonicalMatches.length !== 1) {
    errors.push(`${relativePath}: canonicalは1件必要です（検出: ${canonicalMatches.length}）。`);
  } else {
    const canonical = canonicalMatches[0][1];
    canonicalUrls.add(canonical);

    if (!canonical.startsWith(config.siteUrl)) {
      errors.push(`${relativePath}: canonicalがsiteUrl基準ではありません。`);
    }

    if (canonical !== expected) {
      errors.push(`${relativePath}: canonicalが不一致です（${canonical} / ${expected}）。`);
    }

    if (canonical.endsWith(".html")) {
      errors.push(`${relativePath}: canonicalに.htmlが含まれています。`);
    }
  }

  const blocks = [...html.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  if (blocks.length !== 1) {
    errors.push(`${relativePath}: JSON-LDは1ブロック必要です（検出: ${blocks.length}）。`);
    continue;
  }

  let data;

  try {
    data = JSON.parse(blocks[0][1]);
  } catch (error) {
    errors.push(`${relativePath}: JSON-LDの構文エラー: ${error.message}`);
    continue;
  }

  if (relativePath === "index.html") {
    if (data["@type"] !== "PodcastSeries") errors.push(`${relativePath}: @type が PodcastSeries ではありません。`);
    requireFields(data, ["name", "description", "url", "image", "inLanguage", "webFeed"], relativePath);
    continue;
  }

  if (relativePath.endsWith("/index.html")) {
    listingPageCount += 1;
    if (data["@type"] !== "CollectionPage") errors.push(`${relativePath}: @type が CollectionPage ではありません。`);
    requireFields(data, ["name", "description", "url", "inLanguage", "hasPart"], relativePath);
    continue;
  }

  episodePageCount += 1;
  if (data["@type"] !== "PodcastEpisode") errors.push(`${relativePath}: @type が PodcastEpisode ではありません。`);
  requireFields(data, ["name", "description", "datePublished", "timeRequired", "partOfSeries", "url"], relativePath);

  if (data.datePublished && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(data.datePublished)) {
    errors.push(`${relativePath}: datePublished がJST形式ではありません。`);
  }

  if (data.timeRequired && !/^PT(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?$/.test(data.timeRequired)) {
    errors.push(`${relativePath}: timeRequired がISO 8601形式ではありません。`);
  }

  if (data.partOfSeries?.["@type"] !== "PodcastSeries") {
    errors.push(`${relativePath}: partOfSeries が PodcastSeries ではありません。`);
  }

  const currentSlug = path.basename(relativePath, ".html");
  const currentEpisode = episodesBySlug.get(currentSlug);
  const relatedBlock = html.match(/<section class="related-episodes"[\s\S]*?<\/section>/)?.[0] ?? "";
  const relatedSlugs = [...relatedBlock.matchAll(/href="\/episodes\/([^"]+)"/g)].map((match) => match[1]);

  if (relatedSlugs.length !== 3) {
    errors.push(`${relativePath}: 関連する回は3件必要です（検出: ${relatedSlugs.length}）。`);
  } else if (!currentEpisode) {
    errors.push(`${relativePath}: RSSキャッシュに該当エピソードがありません。`);
  } else {
    for (const relatedSlug of relatedSlugs) {
      const relatedEpisode = episodesBySlug.get(relatedSlug);
      if (!relatedEpisode || scheduleSeries(relatedEpisode.pubDate) !== scheduleSeries(currentEpisode.pubDate)) {
        errors.push(`${relativePath}: 異なる曜日シリーズの関連回があります（${relatedSlug}）。`);
      }
    }
  }
}

const sitemap = await readFile(path.join(rootDirectory, "sitemap.xml"), "utf8");
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const expectedSitemapCount = episodePageCount + listingPageCount + 1;

if (sitemapUrls.length !== expectedSitemapCount) {
  errors.push(`sitemap.xml: URL件数が不一致です（${sitemapUrls.length} / ${expectedSitemapCount}）。`);
}

for (const url of sitemapUrls) {
  if (!url.startsWith(config.siteUrl)) errors.push(`sitemap.xml: siteUrl基準ではないURLがあります（${url}）。`);
  if (url.endsWith(".html")) errors.push(`sitemap.xml: .htmlを含むURLがあります（${url}）。`);
  if (!canonicalUrls.has(url)) errors.push(`sitemap.xml: canonicalに存在しないURLがあります（${url}）。`);
}

for (const canonical of canonicalUrls) {
  if (!sitemapUrls.includes(canonical)) errors.push(`sitemap.xml: canonical URLが欠落しています（${canonical}）。`);
}

const robots = await readFile(path.join(rootDirectory, "robots.txt"), "utf8");
if (!robots.split(/\r?\n/).includes(`Sitemap: ${config.siteUrl}/sitemap.xml`)) {
  errors.push("robots.txt: Sitemap行がありません。");
}

const vercelConfig = JSON.parse(await readFile(path.join(rootDirectory, "vercel.json"), "utf8"));
if (vercelConfig.cleanUrls !== true || vercelConfig.trailingSlash !== false) {
  errors.push("vercel.json: cleanUrls=true / trailingSlash=false ではありません。");
}

const requiredRedirects = [
  ["/episodes/index.html", "/episodes"],
  ["/episodes/page/:page/index.html", "/episodes/page/:page"],
  ["/episodes/:slug.html", "/episodes/:slug"],
];

for (const [source, destination] of requiredRedirects) {
  const redirect = vercelConfig.redirects?.find((candidate) => candidate.source === source);
  if (!redirect || redirect.destination !== destination || redirect.permanent !== true) {
    errors.push(`vercel.json: リダイレクトがありません（${source} → ${destination}）。`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`${htmlFiles.length}件のHTMLでJSON-LDとcanonicalを検証しました。`);
  console.log(`sitemap URL件数: ${sitemapUrls.length}（エピソード${episodePageCount} + 一覧${listingPageCount} + トップ1）。`);
}
