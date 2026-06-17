const statusEl = document.getElementById("copyStatus");

async function copyPrompt(prompt) {
  try {
    await navigator.clipboard.writeText(prompt);
    statusEl.textContent = "已复制，粘贴到右侧对话框";
  } catch {
    statusEl.textContent = "复制失败，请手动复制按钮文本";
  }
}

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    copyPrompt(button.dataset.prompt);
  });
});
