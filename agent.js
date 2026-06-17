const statusEl = document.getElementById("copyStatus");
const resetButton = document.getElementById("resetHint");
const difyUrl = "https://udify.app/chat/719EqByTRKYYG25i";

async function copyPrompt(prompt) {
  if (!statusEl) return;

  try {
    await navigator.clipboard.writeText(prompt);
    statusEl.textContent = "已复制";
  } catch {
    statusEl.textContent = "请手动复制";
  }

  window.setTimeout(() => {
    statusEl.textContent = "点击后复制";
  }, 2200);
}

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    copyPrompt(button.dataset.prompt);
  });
});

if (resetButton) {
  resetButton.addEventListener("click", () => {
    window.open(difyUrl, "_blank", "noopener,noreferrer");
  });
}
