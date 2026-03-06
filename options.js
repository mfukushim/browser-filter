(() => {
  "use strict";

  const STORAGE_KEY = "afSettings";
  const DEFAULT_SETTINGS = {
    enabledGlobal: true,
    enableTextReplacement: true,
    enableImageReplacement: true,
    enablePopupSuppression: true,
    enableIframeReplacement: true,
    textThresholdLength: 20,
    apiEndpoint: "http://localhost/ad-filter/judge"
  };

  const form = document.getElementById("settings-form");
  const statusEl = document.getElementById("status");

  function normalize(raw) {
    const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
    const threshold = Number.parseInt(merged.textThresholdLength, 10);

    return {
      enabledGlobal: merged.enabledGlobal !== false,
      enableTextReplacement: merged.enableTextReplacement !== false,
      enableImageReplacement: merged.enableImageReplacement !== false,
      enablePopupSuppression: merged.enablePopupSuppression !== false,
      enableIframeReplacement: merged.enableIframeReplacement !== false,
      textThresholdLength: Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_SETTINGS.textThresholdLength,
      apiEndpoint:
        typeof merged.apiEndpoint === "string" && merged.apiEndpoint.trim()
          ? merged.apiEndpoint.trim()
          : DEFAULT_SETTINGS.apiEndpoint
    };
  }

  function getFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function setToLocalStorage(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#dc2626" : "#0f766e";
  }

  function readFormValues() {
    const threshold = Number.parseInt(document.getElementById("textThresholdLength").value, 10);
    return normalize({
      enabledGlobal: document.getElementById("enabledGlobal").checked,
      enableTextReplacement: document.getElementById("enableTextReplacement").checked,
      enableImageReplacement: document.getElementById("enableImageReplacement").checked,
      enablePopupSuppression: document.getElementById("enablePopupSuppression").checked,
      enableIframeReplacement: document.getElementById("enableIframeReplacement").checked,
      textThresholdLength: threshold,
      apiEndpoint: document.getElementById("apiEndpoint").value
    });
  }

  function writeFormValues(settings) {
    document.getElementById("enabledGlobal").checked = settings.enabledGlobal;
    document.getElementById("enableTextReplacement").checked = settings.enableTextReplacement;
    document.getElementById("enableImageReplacement").checked = settings.enableImageReplacement;
    document.getElementById("enablePopupSuppression").checked = settings.enablePopupSuppression;
    document.getElementById("enableIframeReplacement").checked = settings.enableIframeReplacement;
    document.getElementById("textThresholdLength").value = String(settings.textThresholdLength);
    document.getElementById("apiEndpoint").value = settings.apiEndpoint;
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

  async function loadSettings() {
    const localSettings = normalize(getFromLocalStorage());
    writeFormValues(localSettings);

    const chromeSettings = await getChromeStorageSettings();
    if (chromeSettings) {
      const normalized = normalize(chromeSettings);
      writeFormValues(normalized);
      setToLocalStorage(normalized);
    } else {
      await setChromeStorageSettings(localSettings);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    const settings = readFormValues();
    setToLocalStorage(settings);
    const ok = await setChromeStorageSettings(settings);

    chrome.runtime.sendMessage({
      type: "AD_FILTER_SETTINGS_UPDATED",
      settings
    });

    setStatus(ok ? "保存しました。" : "localStorage には保存しましたが拡張ストレージへの保存に失敗しました。", !ok);
  }

  form.addEventListener("submit", saveSettings);
  loadSettings();
})();
