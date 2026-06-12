const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelectorAll(".site-nav a");
const requestForm = document.getElementById("requestForm");
const requestFrame = document.getElementById("requestFrame");
const requestCopyButton = document.getElementById("requestCopyButton");
const requestNote = document.getElementById("requestNote");
const requestName = document.getElementById("requestName");
const requestCategory = document.getElementById("requestCategory");
const requestMessage = document.getElementById("requestMessage");
const episodeList = document.getElementById("episodeList");

const googleFormConfig = {
  formResponseUrl:
    "https://docs.google.com/forms/d/e/1FAIpQLSeH4WOG6_KTxEPARHxJrAYVzjn9EBFYpfeE0zbTqgn6TQlrww/formResponse",
  entries: {
    name: "entry.125613912",
    message: "entry.1992023725",
  },
};

let requestSubmitted = false;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character];
  });
}

function formatEpisodeDate(dateString) {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function truncateText(value = "", maxLength = 120) {
  if (value.length <= maxLength) return value;

  return `${value.slice(0, maxLength).trim()}...`;
}

function renderEpisodes(episodes) {
  if (!episodeList) return;

  if (!episodes.length) {
    episodeList.innerHTML =
      '<p class="episode-loading">最新エピソードを読み込めませんでした。Spotifyからご確認ください。</p>';
    return;
  }

  episodeList.innerHTML = episodes
    .map((episode) => {
      const title = escapeHtml(episode.title || "タイトル未設定");
      const date = formatEpisodeDate(episode.pubDate);
      const duration = escapeHtml(episode.duration || "");
      const meta = [date, duration].filter(Boolean).join(" / ");
      const description = escapeHtml(truncateText(episode.description || "番組ページで詳細をご確認ください。"));
      const link = episode.link || "https://open.spotify.com/show/0hQ9393s1c4rJ1iu0iF4d3";

      return `
        <article class="episode-card">
          <p class="episode-meta">${escapeHtml(meta)}</p>
          <h4>${title}</h4>
          <p>${description}</p>
          <a href="${escapeHtml(link)}" target="_blank" rel="noopener">エピソードを開く</a>
        </article>
      `;
    })
    .join("");
}

async function loadEpisodes() {
  if (!episodeList) return;

  try {
    const response = await fetch("/api/episodes");

    if (!response.ok) {
      throw new Error("Episode request failed.");
    }

    const data = await response.json();
    renderEpisodes(Array.isArray(data.episodes) ? data.episodes : []);
  } catch (error) {
    renderEpisodes([]);
  }
}

if (navToggle) {
  navToggle.addEventListener("click", () => {
    const isOpen = document.body.classList.toggle("nav-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });
}

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    document.body.classList.remove("nav-open");
    navToggle?.setAttribute("aria-expanded", "false");
  });
});

function buildRequestText() {
  const name = requestName.value.trim() || "匿名";
  const category = requestCategory.value;
  const message = requestMessage.value.trim();

  return [
    "番組へのリクエスト",
    `【種別】${category}`,
    `【名前】${name}`,
    `【内容】${message}`,
  ].join("\n");
}

function validateRequestMessage() {
  if (!requestMessage.value.trim()) {
    requestMessage.focus();
    requestNote.textContent = "リクエスト内容を入力してください。";
    return false;
  }

  return true;
}

if (requestForm) {
  requestForm.action = googleFormConfig.formResponseUrl;
  requestName.name = googleFormConfig.entries.name;
  requestMessage.name = googleFormConfig.entries.message;

  requestForm.addEventListener("submit", (event) => {
    if (!validateRequestMessage()) {
      event.preventDefault();
      return;
    }

    requestSubmitted = true;

    if (!requestName.value.trim()) {
      requestName.value = "匿名";
    }

    requestMessage.value = [
      `【種別】${requestCategory.value}`,
      `【内容】${requestMessage.value.trim()}`,
    ].join("\n");
    requestNote.textContent = "送信中です。少しお待ちください。";
  });
}

if (requestFrame) {
  requestFrame.addEventListener("load", () => {
    if (!requestSubmitted) return;

    requestSubmitted = false;
    requestForm.reset();
    requestNote.textContent = "送信しました。リクエストありがとうございます。";
  });
}

if (requestCopyButton) {
  requestCopyButton.addEventListener("click", async () => {
    if (!validateRequestMessage()) return;

    try {
      await navigator.clipboard.writeText(buildRequestText());
      requestNote.textContent = "入力内容をコピーしました。控えとして保存できます。";
    } catch (error) {
      requestNote.textContent = "コピーできませんでした。本文を選択して手動でコピーしてください。";
    }
  });
}

loadEpisodes();
