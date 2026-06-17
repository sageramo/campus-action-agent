const appShell = document.getElementById("appShell");
const statusEl = document.getElementById("copyStatus");
const resetButton = document.getElementById("resetHint");
const sidebarToggle = document.getElementById("sidebarToggle");
const difyUrl = "https://udify.app/chat/719EqByTRKYYG25i";

function setSidebarCollapsed(collapsed) {
  if (!appShell || !sidebarToggle) return;

  appShell.classList.toggle("sidebar-collapsed", collapsed);
  sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  sidebarToggle.setAttribute("aria-label", collapsed ? "expand sidebar" : "collapse sidebar");
  localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0");
}

async function copyPrompt(prompt) {
  if (!statusEl) return;

  try {
    await navigator.clipboard.writeText(prompt);
    statusEl.textContent = "Copied";
  } catch {
    statusEl.textContent = "Copy manually";
  }

  window.setTimeout(() => {
    statusEl.textContent = "Click to copy";
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

if (sidebarToggle && appShell) {
  const savedState = localStorage.getItem("sidebarCollapsed");
  setSidebarCollapsed(savedState === null ? true : savedState === "1");

  sidebarToggle.addEventListener("click", () => {
    setSidebarCollapsed(!appShell.classList.contains("sidebar-collapsed"));
  });
}
