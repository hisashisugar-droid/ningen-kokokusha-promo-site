import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const episodesDirectory = path.join(rootDirectory, "episodes");
const transcriptsDirectory = path.join(rootDirectory, "data", "transcripts");
const config = JSON.parse(await readFile(path.join(rootDirectory, "site.config.json"), "utf8"));
const cache = JSON.parse(await readFile(path.join(rootDirectory, "data", "episodes-cache.json"), "utf8"));
const episodesBySlug = new Map(cache.episodes.map((episode) => [episode.slug, episode]));
const errors = [];
const transcriptsByGuid = new Map();

try {
  const transcriptFiles = (await readdir(transcriptsDirectory)).filter((name) => name.endsWith(".json"));
  for (const fileName of transcriptFiles) {
    const relativePath = path.join("data", "transcripts", fileName);
    try {
      const transcript = JSON.parse(await readFile(path.join(transcriptsDirectory, fileName), "utf8"));
      if (!transcript.guid || !transcript.episodeNumber || !transcript.fetchedAt || !Array.isArray(transcript.paragraphs) || !transcript.paragraphs.length) {
        errors.push(`${relativePath}: 必須フィールドまたは本文がありません。`);
        continue;
      }
      transcriptsByGuid.set(transcript.guid, transcript);
    } catch (error) {
      errors.push(`${relativePath}: キャッシュを読み込めません（${error.message}）。`);
    }
  }
} catch (error) {
  errors.push(`data/transcripts: キャッシュディレクトリを読み込めません（${error.message}）。`);
}

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
let transcriptPageCount = 0;
let punctuationAfterSpaceCount = 0;
let punctuationBeforeSpaceCount = 0;
let repeatedSpaceCount = 0;
let japaneseIntercharacterSpaceCount = 0;
const episodeTextLengths = [];
let maximumEpisodeSize = { bytes: 0, relativePath: "" };

function attributeValue(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tag.match(new RegExp(`\\b${escapedName}=["']([^"']+)["']`, "i"))?.[1] ?? "";
}

function decodedText(html) {
  const namedEntities = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, entity) => namedEntities[entity.toLowerCase()] ?? match);
}

function visibleText(html) {
  return decodedText(html)
    .replace(/\s+/g, " ")
    .trim();
}

function median(values) {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

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
  episodeTextLengths.push([...visibleText(html)].length);
  const htmlBytes = Buffer.byteLength(html);
  if (htmlBytes > maximumEpisodeSize.bytes) maximumEpisodeSize = { bytes: htmlBytes, relativePath };
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

  const transcriptBlocks = [...html.matchAll(/<details\s+class=["'][^"']*\btranscript\b[^"']*["'][^>]*>([\s\S]*?)<\/details>/gi)];
  const expectedTranscript = currentEpisode?.guid ? transcriptsByGuid.get(currentEpisode.guid) : undefined;

  if (expectedTranscript && transcriptBlocks.length !== 1) {
    errors.push(`${relativePath}: キャッシュ済み文字起こしは1ブロック必要です（検出: ${transcriptBlocks.length}）。`);
  } else if (!expectedTranscript && transcriptBlocks.length !== 0) {
    errors.push(`${relativePath}: キャッシュのない回に文字起こしブロックがあります。`);
  }

  for (const transcriptBlock of transcriptBlocks) {
    transcriptPageCount += 1;
    const transcriptBody = transcriptBlock[1].match(/<div\s+class=["'][^"']*\btranscript-body\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
    const paragraphTexts = [...transcriptBody.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((match) => decodedText(match[1]).trim());
    const transcriptText = paragraphTexts.join("\n");
    if (!transcriptText) errors.push(`${relativePath}: 文字起こし本文が空です。`);
    const punctuationAfterSpaces = transcriptText.match(/[、。！？][ \u3000]/g) ?? [];
    const punctuationBeforeSpaces = transcriptText.match(/[ \u3000][、。！？]/g) ?? [];
    const repeatedSpaces = transcriptText.match(/[ \u3000]{2,}/g) ?? [];
    const japaneseIntercharacterSpaces = transcriptText.match(/[ぁ-んァ-ヶー] [ぁ-んァ-ヶー]/g) ?? [];
    punctuationAfterSpaceCount += punctuationAfterSpaces.length;
    punctuationBeforeSpaceCount += punctuationBeforeSpaces.length;
    repeatedSpaceCount += repeatedSpaces.length;
    japaneseIntercharacterSpaceCount += japaneseIntercharacterSpaces.length;
    if (punctuationAfterSpaces.length) errors.push(`${relativePath}: 句読点直後に空白があります。`);
    if (punctuationBeforeSpaces.length) errors.push(`${relativePath}: 句読点直前に空白があります。`);
    if (repeatedSpaces.length) errors.push(`${relativePath}: 連続空白があります。`);
    if (japaneseIntercharacterSpaces.length) {
      errors.push(`${relativePath}: 文字起こしに日本語の文字間スペースが残っています。`);
    }
  }
}

if (transcriptPageCount !== transcriptsByGuid.size) {
  errors.push(`文字起こしブロック数がキャッシュ件数と一致しません（${transcriptPageCount} / ${transcriptsByGuid.size}）。`);
}

const medianEpisodeTextLength = median(episodeTextLengths);
if (medianEpisodeTextLength < 3_000) {
  errors.push(`エピソードページ本文文字数の中央値が3,000字未満です（${medianEpisodeTextLength}字）。`);
}

if (maximumEpisodeSize.bytes > 60 * 1024) {
  errors.push(`${maximumEpisodeSize.relativePath}: HTMLサイズが60KBを超えています（${maximumEpisodeSize.bytes} bytes）。`);
}

const indexHtml = await readFile(path.join(rootDirectory, "index.html"), "utf8");
const heroPicture = [...indexHtml.matchAll(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi)]
  .map((match) => match[0])
  .find((picture) => /<img\b[^>]*class=["'][^"']*\bhero-scene\b[^"']*["']/i.test(picture));

if (!heroPicture) {
  errors.push("index.html: hero-sceneを含むpicture要素がありません。");
} else {
  const sources = [...heroPicture.matchAll(/<source\b[^>]*>/gi)].map((match) => match[0]);
  const sourceTypes = sources.map((source) => attributeValue(source, "type"));
  if (sourceTypes[0] !== "image/avif" || sourceTypes[1] !== "image/webp") {
    errors.push("index.html: ヒーロー画像のsourceはimage/avif、image/webpの順で必要です。");
  }

  const imageTag = heroPicture.match(/<img\b[^>]*class=["'][^"']*\bhero-scene\b[^"']*["'][^>]*>/i)?.[0] ?? "";
  if (attributeValue(imageTag, "src") !== "./assets/hero-recording-kirie-v4-canonical-faces.png") {
    errors.push("index.html: ヒーロー画像のimgが元のPNGを参照していません。");
  }
  if (!/^\d+$/.test(attributeValue(imageTag, "width")) || !/^\d+$/.test(attributeValue(imageTag, "height"))) {
    errors.push("index.html: ヒーロー画像のimgにwidthとheightが必要です。");
  }
  if (attributeValue(imageTag, "fetchpriority") !== "high") {
    errors.push('index.html: ヒーロー画像のimgにfetchpriority="high"が必要です。');
  }
  if (attributeValue(imageTag, "decoding") !== "async") {
    errors.push('index.html: ヒーロー画像のimgにdecoding="async"が必要です。');
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
  ["/episodes/index", "/episodes"],
  ["/episodes/page/:page/index", "/episodes/page/:page"],
];

for (const [source, destination] of requiredRedirects) {
  const redirect = vercelConfig.redirects?.find((candidate) => candidate.source === source);
  if (!redirect || redirect.destination !== destination || redirect.permanent !== true) {
    errors.push(`vercel.json: リダイレクトがありません（${source} → ${destination}）。`);
  }
}

if (vercelConfig.cleanUrls === true && vercelConfig.redirects?.some((redirect) => redirect.source.includes(".html") || redirect.destination.includes(".html"))) {
  errors.push("vercel.json: cleanUrls=trueのredirectに.htmlを含めることはできません。");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`${htmlFiles.length}件のHTMLでJSON-LDとcanonicalを検証しました。`);
  console.log(`sitemap URL件数: ${sitemapUrls.length}（エピソード${episodePageCount} + 一覧${listingPageCount} + トップ1）。`);
  console.log(`文字起こし: ${transcriptPageCount}ページ / キャッシュ${transcriptsByGuid.size}件（空本文0件）。`);
  console.log(`文字起こし空白: 句読点後${punctuationAfterSpaceCount}件 / 句読点前${punctuationBeforeSpaceCount}件 / 連続空白${repeatedSpaceCount}件 / 日本語文字間${japaneseIntercharacterSpaceCount}件。`);
  console.log(`エピソード本文文字数中央値: ${medianEpisodeTextLength}字。`);
  console.log(`最大エピソードHTML: ${maximumEpisodeSize.bytes} bytes（${maximumEpisodeSize.relativePath}）。`);
}
