import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(rootDirectory, "index.html");
const episodesDirectory = path.join(rootDirectory, "episodes");
const cachePath = path.join(rootDirectory, "data", "episodes-cache.json");
const transcriptsDirectory = path.join(rootDirectory, "data", "transcripts");
const sitemapPath = path.join(rootDirectory, "sitemap.xml");
const robotsPath = path.join(rootDirectory, "robots.txt");
const config = JSON.parse(await readFile(path.join(rootDirectory, "site.config.json"), "utf8"));
const pageSize = 50;
const transcriptConcurrency = 6;
const transcriptMaximumCharacters = 8_000;
const refreshTranscripts = process.env.REFRESH_TRANSCRIPTS === "1";
const maximumCacheAgeMilliseconds = 7 * 24 * 60 * 60 * 1000;
const siteDescription = "人文知でマーケティングを学ぶPodcast。人間の可笑しみから、使えるインサイトを掘り起こします。";
const episodeListStart = "<!-- EPISODE_LIST_START -->";
const episodeListEnd = "<!-- EPISODE_LIST_END -->";
const seriesJsonLdStart = "<!-- PODCAST_SERIES_JSONLD_START -->";
const seriesJsonLdEnd = "<!-- PODCAST_SERIES_JSONLD_END -->";

function decodeEntities(value = "") {
  const namedEntities = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  let decoded = value;

  for (let pass = 0; pass < 2; pass += 1) {
    decoded = decoded
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([a-fA-F0-9]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&([a-z]+);/gi, (match, entity) => namedEntities[entity.toLowerCase()] ?? match);
  }

  return decoded;
}

function readTag(block, tagName) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return block.match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i"))?.[1] ?? "";
}

function readTagAttributes(block, tagName) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attributesText = block.match(new RegExp(`<${escapedTag}\\b([^>]*)\/?>`, "i"))?.[1] ?? "";
  return Object.fromEntries([...attributesText.matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/g)]
    .map((match) => [match[1].toLowerCase(), decodeEntities(match[2])]));
}

function stripHtml(value = "") {
  return decodeEntities(value)
    .replace(/<\/?(?:p|div|li|h[1-6])(?:\s[^>]*)?>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function escapeXml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]);
}

function episodeIdentifier(title, guid, link) {
  const episodeNumber = title.match(/#\s*(\d+)/)?.[1];
  if (episodeNumber) return episodeNumber;

  const stableSource = guid || link;
  const stableId = stableSource.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  return `archive-${stableId || "unknown"}`;
}

function episodeUrl(episode) {
  return `${config.siteUrl}/episodes/${episode.slug}`;
}

function listingUrl(pageNumber) {
  return pageNumber === 1 ? `${config.siteUrl}/episodes` : `${config.siteUrl}/episodes/page/${pageNumber}`;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "配信日未設定";

  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "short",
  }).format(date);
}

function formatDuration(duration = "") {
  const parts = duration.split(":").map(Number);
  if (parts.some(Number.isNaN)) return duration;

  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, ...parts];
  return [hours ? `${hours}時間` : "", minutes ? `${minutes}分` : "", seconds ? `${seconds}秒` : ""].filter(Boolean).join("");
}

function formatPublishedDate(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";

  const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${jstDate.toISOString().slice(0, 19)}+09:00`;
}

function formatIsoDuration(duration = "") {
  const parts = duration.split(":").map(Number);
  if (parts.some(Number.isNaN)) return "";

  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, ...parts];
  const value = [hours ? `${hours}H` : "", minutes ? `${minutes}M` : "", seconds ? `${seconds}S` : ""].filter(Boolean).join("");
  return `PT${value || "0S"}`;
}

function jsonLdMarkup(data) {
  return JSON.stringify(data, null, 2).replace(/</g, "\\u003c");
}

function parseEpisodes(xml) {
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];

  return itemBlocks.map((block) => {
    const title = stripHtml(readTag(block, "title"));
    const link = stripHtml(readTag(block, "link"));
    const guid = stripHtml(readTag(block, "guid"));
    const transcript = readTagAttributes(block, "podcast:transcript");
    const number = episodeIdentifier(title, guid, link);

    return {
      title,
      guid,
      number,
      slug: `episode-${number}`,
      pubDate: stripHtml(readTag(block, "pubDate")),
      duration: stripHtml(readTag(block, "itunes:duration")),
      description: stripHtml(readTag(block, "description") || readTag(block, "itunes:summary")),
      spotifyUrl: link || config.spotifyShowUrl,
      transcriptUrl: transcript.type === "application/x-subrip" ? transcript.url ?? "" : "",
      transcriptType: transcript.type ?? "",
    };
  }).sort((first, second) => new Date(second.pubDate) - new Date(first.pubDate));
}

function normalizeTranscriptSpacing(value) {
  return value
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/(?<=[ぁ-んァ-ヶー一-龠々、。！？「」『』（）・…〜：；]) (?=[ぁ-んァ-ヶー一-龠々、。！？「」『』（）・…〜：；])/g, "")
    .replace(/[ \t\u3000]*([、。！？])[ \t\u3000]*/g, "$1")
    .trim();
}

function normalizeTranscriptCue(value) {
  return normalizeTranscriptSpacing(decodeEntities(value)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim());
}

function transcriptSeparator(previous, current) {
  if (!previous || !current) return "";
  const boundary = normalizeTranscriptSpacing(`${previous.at(-1)} ${current[0]}`);
  return boundary.includes(" ") ? " " : "";
}

function overlappingPrefixLength(previous, current) {
  const maximum = Math.min(previous.length, current.length);
  for (let length = maximum; length >= 8; length -= 1) {
    if (previous.endsWith(current.slice(0, length))) return length;
  }
  return 0;
}

function formatTranscript(srt) {
  const cueTexts = srt
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^\d+$/.test(line) && !line.includes("-->"))
      .join(" "))
    .map(normalizeTranscriptCue)
    .filter(Boolean);

  let text = "";
  for (const cue of cueTexts) {
    const overlap = overlappingPrefixLength(text, cue);
    const addition = cue.slice(overlap);
    text += `${transcriptSeparator(text, addition)}${addition}`;
  }
  text = normalizeTranscriptSpacing(text);

  let truncated = false;
  if ([...text].length > transcriptMaximumCharacters) {
    const candidate = [...text].slice(0, transcriptMaximumCharacters - 1).join("");
    const ending = Math.max(candidate.lastIndexOf("。"), candidate.lastIndexOf("！"), candidate.lastIndexOf("？"));
    text = `${candidate.slice(0, ending >= 0 ? ending + 1 : candidate.length)}…`;
    truncated = true;
  }

  const sentences = text.match(/[^。！？]+[。！？]+|[^。！？]+$/g) ?? [];
  const paragraphs = [];
  let paragraph = "";

  for (const sentence of sentences) {
    paragraph += sentence.trim();
    if ([...paragraph].length >= 200) {
      paragraphs.push(paragraph);
      paragraph = "";
    }
  }
  if (paragraph) paragraphs.push(paragraph);

  if (truncated && paragraphs.length && !paragraphs.at(-1).endsWith("…")) {
    paragraphs[paragraphs.length - 1] += "…";
  }
  return paragraphs;
}

async function fetchTranscript(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "ningen-kokokusha-promo-site/1.0" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
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

async function loadTranscripts(episodes) {
  const candidates = episodes.filter((episode) => episode.guid && episode.transcriptUrl);
  const transcripts = new Map();
  const missing = [];
  await mkdir(transcriptsDirectory, { recursive: true });

  await Promise.all(candidates.map(async (episode) => {
    const transcriptPath = path.join(transcriptsDirectory, `${episode.guid}.json`);
    if (refreshTranscripts) {
      missing.push({ episode, transcriptPath });
      return;
    }
    try {
      const cached = JSON.parse(await readFile(transcriptPath, "utf8"));
      if (cached.guid !== episode.guid || !Array.isArray(cached.paragraphs) || !cached.paragraphs.length) {
        throw new Error("キャッシュ形式が不正です。");
      }
      transcripts.set(episode.guid, cached);
    } catch {
      missing.push({ episode, transcriptPath });
    }
  }));

  let fetchedCount = 0;
  let failedCount = 0;
  await mapConcurrent(missing, transcriptConcurrency, async ({ episode, transcriptPath }) => {
    try {
      const paragraphs = formatTranscript(await fetchTranscript(episode.transcriptUrl));
      if (!paragraphs.length) throw new Error("整形後の本文が空です。");
      const transcript = {
        guid: episode.guid,
        episodeNumber: episode.number,
        fetchedAt: new Date().toISOString(),
        paragraphs,
      };
      await writeFile(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`);
      transcripts.set(episode.guid, transcript);
      fetchedCount += 1;
    } catch (error) {
      failedCount += 1;
      console.warn(`WARN: 文字起こし取得失敗: ${episode.title}（${error.message}）`);
    }
  });

  console.log(`文字起こし: ${transcripts.size}件（キャッシュ${candidates.length - missing.length} / 取得${fetchedCount} / 失敗${failedCount} / 対象${candidates.length}）`);
  return transcripts;
}

function descriptionMarkup(description) {
  const paragraphs = description.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`).join("\n            ");
}

function summary(description, maximumLength = 155) {
  const oneLine = description.replace(/\s+/g, " ").trim();
  return oneLine.length > maximumLength ? `${oneLine.slice(0, maximumLength - 1).trim()}…` : oneLine;
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

function relatedEpisodesFor(episode, episodes) {
  const episodeTime = new Date(episode.pubDate).getTime();
  const series = scheduleSeries(episode.pubDate);

  return episodes
    .filter((candidate) => candidate.slug !== episode.slug && scheduleSeries(candidate.pubDate) === series)
    .sort((first, second) => {
      const firstDistance = Math.abs(new Date(first.pubDate).getTime() - episodeTime);
      const secondDistance = Math.abs(new Date(second.pubDate).getTime() - episodeTime);
      return firstDistance - secondDistance;
    })
    .slice(0, 3);
}

function analyticsMarkup() {
  return `<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>
    <script defer src="/_vercel/insights/script.js"></script>`;
}

function brandHeader() {
  return `<header class="site-header" aria-label="サイトヘッダー">
      <a class="brand" href="/" aria-label="ニンゲン広告社 トップ">
        <img src="/assets/ningen-kokokusha-wordmark-v4-red.png" alt="ニンゲン広告社" width="1774" height="887" decoding="async" />
      </a>
    </header>`;
}

function siteFooter() {
  return `<footer class="site-footer"><img src="/assets/ningen-kokokusha-wordmark-v4-white.png" alt="ニンゲン広告社" width="1774" height="887" loading="lazy" decoding="async" /><div><p>人文知でマーケティングを学ぶPodcast</p><a href="/">サイトトップへ戻る</a></div><p class="copyright">© Ningen Agency 2026</p></footer>`;
}

function relatedEpisodesMarkup(relatedEpisodes) {
  const cards = relatedEpisodes.map((episode) => `<article class="related-episode-card">
              <p>${escapeHtml(formatDate(episode.pubDate))}</p>
              <h3><a href="/episodes/${episode.slug}">${escapeHtml(episode.title)}</a></h3>
            </article>`).join("\n            ");

  return `<section class="related-episodes" aria-labelledby="related-episodes-title">
          <h2 id="related-episodes-title">関連する回</h2>
          <div class="related-episode-list">
            ${cards}
          </div>
        </section>`;
}

function transcriptMarkup(transcript) {
  if (!transcript?.paragraphs?.length) return "";
  const paragraphs = transcript.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n            ");
  return `<details class="transcript">
          <summary>文字起こし（自動生成）を読む</summary>
          <div class="transcript-body">
            ${paragraphs}
          </div>
        </details>
        <p class="transcript-note">この文字起こしはSpotifyの自動生成によるものです。固有名詞の誤変換を含む場合があります。</p>`;
}

function episodePage(episode, previousEpisode, nextEpisode, relatedEpisodes, transcript) {
  const pageUrl = episodeUrl(episode);
  const imageUrl = `${config.siteUrl}/assets/og-cover.png`;
  const description = summary(episode.description);
  const dateTime = formatPublishedDate(episode.pubDate);
  const episodeJsonLd = {
    "@context": "https://schema.org",
    "@type": "PodcastEpisode",
    name: episode.title,
    description: episode.description,
    datePublished: dateTime,
    timeRequired: formatIsoDuration(episode.duration),
    partOfSeries: { "@type": "PodcastSeries", name: config.siteName, url: `${config.siteUrl}/` },
    url: pageUrl,
  };
  const pagination = [
    previousEpisode
      ? `<a href="/episodes/${previousEpisode.slug}"><span>← 前の回</span><strong>${escapeHtml(previousEpisode.title)}</strong></a>`
      : "<span></span>",
    nextEpisode
      ? `<a href="/episodes/${nextEpisode.slug}"><span>次の回 →</span><strong>${escapeHtml(nextEpisode.title)}</strong></a>`
      : "<span></span>",
  ].join("\n          ");

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(episode.title)} | ${escapeHtml(config.siteName)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="theme-color" content="#f2ead9" />
    <meta property="og:title" content="${escapeHtml(episode.title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${pageUrl}" />
    <meta property="og:site_name" content="${escapeHtml(config.siteName)}" />
    <meta property="og:locale" content="ja_JP" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(episode.title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${imageUrl}" />
    <link rel="canonical" href="${pageUrl}" />
    <script type="application/ld+json">
${jsonLdMarkup(episodeJsonLd).split("\n").map((line) => `      ${line}`).join("\n")}
    </script>
    ${analyticsMarkup()}
    <link rel="icon" type="image/png" href="/assets/tab.png" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="episode-page">
    <a class="skip-link" href="#main">本文へ移動</a>
    ${brandHeader()}
    <main id="main" class="episode-main">
      <a class="episode-back" href="/episodes">← エピソード一覧へ戻る</a>
      <article class="episode-article">
        <p class="episode-detail-meta"><time${dateTime ? ` datetime="${dateTime}"` : ""}>${escapeHtml(formatDate(episode.pubDate))}</time> / ${escapeHtml(formatDuration(episode.duration))}</p>
        <h1>${escapeHtml(episode.title)}</h1>
        <div class="episode-description">
            ${descriptionMarkup(episode.description)}
        </div>
        <div class="episode-actions" aria-label="エピソードの次のアクション">
          <a class="button primary" href="${escapeHtml(episode.spotifyUrl)}" target="_blank" rel="noopener" data-track="Spotify click" data-track-location="episode-${escapeHtml(episode.number)}">Spotifyで聴く <span aria-hidden="true">↗</span></a>
          <a class="button request-cta" href="/#request">おたよりを送る <span aria-hidden="true">→</span></a>
        </div>
        <nav class="episode-pagination" aria-label="前後のエピソード">
          ${pagination}
        </nav>
        ${relatedEpisodesMarkup(relatedEpisodes)}
        ${transcriptMarkup(transcript)}
      </article>
    </main>
    ${siteFooter()}
    <script src="/app.js"></script>
  </body>
</html>
`;
}

function listingPage(episodes, pageNumber, pageCount) {
  const canonicalUrl = listingUrl(pageNumber);
  const pageEpisodes = episodes.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
  const pageTitle = pageNumber === 1 ? "エピソード一覧" : `エピソード一覧 ${pageNumber}ページ目`;
  const imageUrl = `${config.siteUrl}/assets/og-cover.png`;
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${pageTitle} | ${config.siteName}`,
    description: siteDescription,
    url: canonicalUrl,
    inLanguage: "ja",
    hasPart: pageEpisodes.map((episode) => ({ "@type": "PodcastEpisode", name: episode.title, url: episodeUrl(episode) })),
  };
  const cards = pageEpisodes.map((episode) => `<article class="episode-index-card">
          <p class="episode-meta">${escapeHtml(formatDate(episode.pubDate))} / ${escapeHtml(formatDuration(episode.duration))}</p>
          <h2><a href="/episodes/${episode.slug}">${escapeHtml(episode.title)}</a></h2>
          <p>${escapeHtml(summary(episode.description, 120))}</p>
        </article>`).join("\n        ");
  const previousLink = pageNumber > 1
    ? `<a href="${pageNumber === 2 ? "/episodes" : `/episodes/page/${pageNumber - 1}`}">← 前のページ</a>`
    : "<span></span>";
  const nextLink = pageNumber < pageCount ? `<a href="/episodes/page/${pageNumber + 1}">次のページ →</a>` : "<span></span>";

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(pageTitle)} | ${escapeHtml(config.siteName)}</title>
    <meta name="description" content="${escapeHtml(siteDescription)}" />
    <meta name="theme-color" content="#f2ead9" />
    <meta property="og:title" content="${escapeHtml(pageTitle)} | ${escapeHtml(config.siteName)}" />
    <meta property="og:description" content="${escapeHtml(siteDescription)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:site_name" content="${escapeHtml(config.siteName)}" />
    <meta property="og:locale" content="ja_JP" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(pageTitle)} | ${escapeHtml(config.siteName)}" />
    <meta name="twitter:description" content="${escapeHtml(siteDescription)}" />
    <meta name="twitter:image" content="${imageUrl}" />
    <link rel="canonical" href="${canonicalUrl}" />
    <script type="application/ld+json">
${jsonLdMarkup(collectionJsonLd).split("\n").map((line) => `      ${line}`).join("\n")}
    </script>
    ${analyticsMarkup()}
    <link rel="icon" type="image/png" href="/assets/tab.png" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="episode-page">
    <a class="skip-link" href="#main">本文へ移動</a>
    ${brandHeader()}
    <main id="main" class="episode-index-main">
      <a class="episode-back" href="/">← サイトトップへ戻る</a>
      <header class="episode-index-heading">
        <p class="eyebrow">全エピソード</p>
        <h1>エピソード一覧</h1>
        <p>${pageNumber} / ${pageCount} ページ</p>
      </header>
      <div class="episode-index-list">
        ${cards}
      </div>
      <nav class="episode-index-pagination" aria-label="エピソード一覧のページ送り">
        ${previousLink}
        ${nextLink}
      </nav>
    </main>
    ${siteFooter()}
  </body>
</html>
`;
}

function topEpisodeCard(episode) {
  return `<article class="episode-card">
  <p class="episode-meta">${escapeHtml(formatDate(episode.pubDate))} / ${escapeHtml(formatDuration(episode.duration))}</p>
  <h4>${escapeHtml(episode.title)}</h4>
  <p>${escapeHtml(summary(episode.description, 120))}</p>
  <a href="/episodes/${episode.slug}">エピソードを開く</a>
</article>`;
}

function replaceEpisodeList(indexHtml, episodes) {
  const startIndex = indexHtml.indexOf(episodeListStart);
  const endIndex = indexHtml.indexOf(episodeListEnd);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) throw new Error("index.html のエピソード生成マーカーが見つかりません。");

  const cards = episodes.slice(0, 3).map(topEpisodeCard).join("\n");
  const replacement = `${episodeListStart}\n${cards || '<p class="episode-loading">最新エピソードを読み込めませんでした。Spotifyからご確認ください。</p>'}\n${episodeListEnd}`;
  return `${indexHtml.slice(0, startIndex)}${replacement}${indexHtml.slice(endIndex + episodeListEnd.length)}`;
}

function replacePodcastSeriesJsonLd(indexHtml) {
  const startIndex = indexHtml.indexOf(seriesJsonLdStart);
  const endIndex = indexHtml.indexOf(seriesJsonLdEnd);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) throw new Error("index.html の構造化データ生成マーカーが見つかりません。");

  const seriesJsonLd = {
    "@context": "https://schema.org",
    "@type": "PodcastSeries",
    name: config.siteName,
    description: siteDescription,
    url: `${config.siteUrl}/`,
    image: `${config.siteUrl}/assets/og-cover.png`,
    inLanguage: "ja",
    webFeed: config.rssUrl,
  };
  const indentedJson = jsonLdMarkup(seriesJsonLd).split("\n").map((line) => `      ${line}`).join("\n");
  const replacement = `${seriesJsonLdStart}\n    <script type="application/ld+json">\n${indentedJson}\n    </script>\n    ${seriesJsonLdEnd}`;
  return `${indexHtml.slice(0, startIndex)}${replacement}${indexHtml.slice(endIndex + seriesJsonLdEnd.length)}`;
}

function replaceSiteUrls(indexHtml) {
  return indexHtml
    .replace(/(<meta property="og:url" content=")[^"]*(" \/>)/, `$1${config.siteUrl}/$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(" \/>)/, `$1${config.siteUrl}/assets/og-cover.png$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(" \/>)/, `$1${config.siteUrl}/assets/og-cover.png$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(" \/>)/, `$1${config.siteUrl}/$2`);
}

function sitemapXml(episodes, pageCount) {
  const latestDate = formatPublishedDate(episodes[0].pubDate);
  const entries = [
    { url: `${config.siteUrl}/`, lastmod: latestDate },
    ...Array.from({ length: pageCount }, (_, index) => ({ url: listingUrl(index + 1), lastmod: latestDate })),
    ...episodes.map((episode) => ({ url: episodeUrl(episode), lastmod: formatPublishedDate(episode.pubDate) })),
  ];
  const expectedCount = episodes.length + pageCount + 1;
  if (entries.length !== expectedCount) throw new Error(`sitemap URL件数が不正です: ${entries.length} / ${expectedCount}`);

  const body = entries.map((entry) => `  <url>\n    <loc>${escapeXml(entry.url)}</loc>\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>\n  </url>`).join("\n");
  return {
    content: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
    count: entries.length,
    expectedCount,
  };
}

async function fetchRss() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(config.rssUrl, {
      headers: { "user-agent": "ningen-kokokusha-promo-site/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`RSS request failed: ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadEpisodes() {
  try {
    const episodes = parseEpisodes(await fetchRss());
    if (!episodes.length) throw new Error("RSSにエピソードがありません。");

    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, `${JSON.stringify({ fetchedAt: new Date().toISOString(), episodes }, null, 2)}\n`);
    return episodes;
  } catch (rssError) {
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8"));
      const episodes = Array.isArray(cached.episodes) ? cached.episodes : [];
      if (!episodes.length) throw new Error("キャッシュにエピソードがありません。");

      const fetchedAt = new Date(cached.fetchedAt ?? "");
      const cacheAgeMilliseconds = Number.isNaN(fetchedAt.getTime())
        ? null
        : Math.max(0, Date.now() - fetchedAt.getTime());
      const cacheAge = cacheAgeMilliseconds === null
        ? "unknown"
        : `${Math.floor(cacheAgeMilliseconds / (24 * 60 * 60 * 1000))}d`;

      console.warn(`WARN: RSS取得に失敗。cache age ${cacheAge} のキャッシュから${episodes.length}件を生成`);

      if (cacheAgeMilliseconds !== null && cacheAgeMilliseconds > maximumCacheAgeMilliseconds) {
        console.error(`ERROR: キャッシュが${Math.ceil(cacheAgeMilliseconds / (24 * 60 * 60 * 1000))}日経過しています（上限7日）`);
        process.exitCode = 1;
        return [];
      }

      return episodes.sort((first, second) => new Date(second.pubDate) - new Date(first.pubDate));
    } catch (cacheError) {
      console.warn(`WARN: RSS取得に失敗。利用可能なキャッシュなし（${rssError.message} / ${cacheError.message}）`);
      return [];
    }
  }
}

async function build() {
  const episodes = await loadEpisodes();
  if (!episodes.length) return;
  const transcripts = await loadTranscripts(episodes);

  const pageCount = Math.ceil(episodes.length / pageSize);
  await rm(episodesDirectory, { recursive: true, force: true });
  await mkdir(episodesDirectory, { recursive: true });

  await Promise.all(episodes.map((episode, index) => writeFile(
    path.join(episodesDirectory, `${episode.slug}.html`),
    episodePage(episode, episodes[index + 1], episodes[index - 1], relatedEpisodesFor(episode, episodes), transcripts.get(episode.guid)),
  )));

  await writeFile(path.join(episodesDirectory, "index.html"), listingPage(episodes, 1, pageCount));
  for (let pageNumber = 2; pageNumber <= pageCount; pageNumber += 1) {
    const pageDirectory = path.join(episodesDirectory, "page", String(pageNumber));
    await mkdir(pageDirectory, { recursive: true });
    await writeFile(path.join(pageDirectory, "index.html"), listingPage(episodes, pageNumber, pageCount));
  }

  const sitemap = sitemapXml(episodes, pageCount);
  await writeFile(sitemapPath, sitemap.content);
  await writeFile(robotsPath, `Sitemap: ${config.siteUrl}/sitemap.xml\n`);

  const currentIndex = await readFile(indexPath, "utf8");
  await writeFile(indexPath, replacePodcastSeriesJsonLd(replaceSiteUrls(replaceEpisodeList(currentIndex, episodes))));

  console.log(`${episodes.length}件のエピソードページ、${pageCount}件の一覧ページ、最新3話を生成しました。`);
  console.log(`sitemap URL件数: ${sitemap.count}（エピソード${episodes.length} + 一覧${pageCount} + トップ1 = ${sitemap.expectedCount}）`);
}

await build();
