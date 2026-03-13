(() => {
  "use strict";

  const STORAGE_KEY = "afSettings";
  const DEFAULT_SETTINGS = {
    enabledGlobal: true,
    enableTextReplacement: true,
    enableImageReplacement: true,
    enablePopupSuppression: true,
    enableIframeReplacement: true,
    useApiReplaceResponse: true,
    textThresholdLength: 20,
    apiEndpoint: "http://localhost/ad-filter/judge"
  };

  const enabledGlobalEl = document.getElementById("enabledGlobal");
  const openOptionsEl = document.getElementById("openOptions");
  const statusEl = document.getElementById("status");

  function normalize(raw) {
    const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
    return {
      ...merged,
      enabledGlobal: merged.enabledGlobal !== false
    };
  }

  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#dc2626" : "#0f766e";
  }

  function getChromeStorageSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(result?.[STORAGE_KEY] || null);
      });
    });
  }

  function setChromeStorageSettings(settings) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: settings }, () => {
        resolve(!chrome.runtime.lastError);
      });
    });
  }

  async function notifySettingsUpdated(settings) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "AD_FILTER_SETTINGS_UPDATED",
          settings
        },
        () => {
          resolve(true);
        }
      );
    });
  }

  async function loadSettings() {
    const stored = await getChromeStorageSettings();
    const settings = normalize(stored);
    enabledGlobalEl.checked = settings.enabledGlobal;

    if (!stored) {
      await setChromeStorageSettings(settings);
      await notifySettingsUpdated(settings);
    }
  }

  async function onToggleChanged() {
    const stored = normalize(await getChromeStorageSettings());
    const settings = {
      ...stored,
      enabledGlobal: enabledGlobalEl.checked
    };

    const ok = await setChromeStorageSettings(settings);
    await notifySettingsUpdated(settings);
    setStatus(ok ? "保存しました。" : "保存に失敗しました。", !ok);
  }

  function openOptions() {
    chrome.runtime.openOptionsPage();
  }

  enabledGlobalEl.addEventListener("change", onToggleChanged);
  openOptionsEl.addEventListener("click", openOptions);

  loadSettings();
})();
