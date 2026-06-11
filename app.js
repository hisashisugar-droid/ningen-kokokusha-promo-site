const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelectorAll(".site-nav a");
const requestForm = document.getElementById("requestForm");
const requestFrame = document.getElementById("requestFrame");
const requestCopyButton = document.getElementById("requestCopyButton");
const requestNote = document.getElementById("requestNote");
const requestName = document.getElementById("requestName");
const requestCategory = document.getElementById("requestCategory");
const requestMessage = document.getElementById("requestMessage");

const googleFormConfig = {
  formResponseUrl:
    "https://docs.google.com/forms/d/e/1FAIpQLSeH4WOG6_KTxEPARHxJrAYVzjn9EBFYpfeE0zbTqgn6TQlrww/formResponse",
  entries: {
    name: "entry.125613912",
    message: "entry.1992023725",
  },
};

let requestSubmitted = false;

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
