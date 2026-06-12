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
const memberButtons = document.querySelectorAll("[data-member]");
const memberDialog = document.getElementById("memberDialog");
const memberDialogClose = document.querySelector(".member-dialog-close");
const memberDialogNumber = document.getElementById("memberDialogNumber");
const memberDialogRole = document.getElementById("memberDialogRole");
const memberDialogName = document.getElementById("memberDialogName");
const memberDialogBody = document.getElementById("memberDialogBody");

const googleFormConfig = {
  formResponseUrl:
    "https://docs.google.com/forms/d/e/1FAIpQLSeH4WOG6_KTxEPARHxJrAYVzjn9EBFYpfeE0zbTqgn6TQlrww/formResponse",
  entries: {
    name: "entry.125613912",
    message: "entry.1992023725",
  },
};

let requestSubmitted = false;
let activeMemberButton = null;

const memberProfiles = {
  hayami: {
    number: "01",
    name: "ハヤミ",
    role: "現場感のある語り部",
    body:
      "代理店から独立して日々どさ回りをしている、ニンゲン広告社の現場派。机上の理論だけでは拾いきれない違和感や肌ざわりを、マーケティングの問いに変えて持ち帰ります。",
  },
  nagako: {
    number: "02",
    name: "ナガコ",
    role: "知的好奇心の営業",
    body:
      "MBAホルダーで知的好奇心の塊のような営業。理論と実務、まじめさと脱線を行き来しながら、散らかった話題をぐっと立体的にしてくれる存在です。",
  },
  setchan: {
    number: "03",
    name: "せっちゃん",
    role: "マーケティング論客",
    body:
      "史上最強のマーケティング論客。空気に流されず、論点をばしっと置き直す係。番組にほどよい緊張感と、考える楽しさを持ち込んでくれます。",
  },
  motchan: {
    number: "04",
    name: "モッちゃん",
    role: "Z世代のクイズマスター",
    body:
      "クイズマスターで唯一のZ世代。若い感覚と切れ味のある問いで、いつもの議論に新しい入口を作ります。知らないことを面白がる力が強い社員です。",
  },
  hisashi: {
    number: "05",
    name: "ヒサシ",
    role: "企画と言葉の設計者",
    body:
      "プランニングディレクターでシナリオライター。広告、物語、社会の空気をつなぎながら、番組全体の問いを設計します。たまに話が遠くへ行くのも味です。",
  },
  hiroshi: {
    number: "06",
    name: "ヒロシ",
    role: "ヒサシの亡霊",
    body:
      "ヒサシの亡霊でヒサシの分身。存在しているようでしていない、していないようでしている社員。Web限定コンテンツの気配をそっと濃くしています。",
  },
};

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

function closeMemberDialog() {
  if (!memberDialog) return;

  if (memberDialog.open && typeof memberDialog.close === "function") {
    memberDialog.close();
  } else {
    memberDialog.removeAttribute("open");
  }

  activeMemberButton?.focus();
  activeMemberButton = null;
}

function openMemberDialog(memberId, trigger) {
  const profile = memberProfiles[memberId];

  if (!profile || !memberDialog) return;

  activeMemberButton = trigger;
  memberDialog.dataset.currentMember = memberId;
  memberDialogNumber.textContent = profile.number;
  memberDialogRole.textContent = profile.role;
  memberDialogName.textContent = profile.name;
  memberDialogBody.textContent = profile.body;

  if (typeof memberDialog.showModal === "function") {
    memberDialog.showModal();
  } else {
    memberDialog.setAttribute("open", "");
  }
}

memberButtons.forEach((button) => {
  button.addEventListener("click", () => {
    openMemberDialog(button.dataset.member, button);
  });
});

if (memberDialog) {
  memberDialog.addEventListener("click", (event) => {
    if (event.target === memberDialog) {
      closeMemberDialog();
    }
  });

  memberDialog.addEventListener("cancel", () => {
    activeMemberButton = null;
  });
}

if (memberDialogClose) {
  memberDialogClose.addEventListener("click", closeMemberDialog);
}

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
