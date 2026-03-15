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
  const interruptProcessingEl = document.getElementById("interruptProcessing");
  const openOptionsEl = document.getElementById("openOptions");
  const statusEl = document.getElementById("status");
  let processingStateTimerId = null;

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

  async function getProcessingState() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "AD_FILTER_GET_PROCESSING_STATE" }, (response) => {
        resolve(response?.isProcessing === true);
      });
    });
  }

  async function requestInterrupt() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "AD_FILTER_INTERRUPT_REQUESTED" }, (response) => {
        resolve(response?.accepted === true);
      });
    });
  }

  function updateInterruptButtonState(isProcessing) {
    interruptProcessingEl.disabled = !isProcessing;
  }

  async function refreshProcessingState() {
    const isProcessing = await getProcessingState();
    updateInterruptButtonState(isProcessing);
  }

  async function onInterruptClicked() {
    const ok = await requestInterrupt();
    if (ok) {
      setStatus("中断を要求しました。");
    } else {
      setStatus("中断要求に失敗しました。", true);
    }
    await refreshProcessingState();
  }

  function startProcessingStatePolling() {
    if (processingStateTimerId !== null) {
      return;
    }
    processingStateTimerId = window.setInterval(() => {
      refreshProcessingState();
    }, 500);
  }

  function stopProcessingStatePolling() {
    if (processingStateTimerId === null) {
      return;
    }
    window.clearInterval(processingStateTimerId);
    processingStateTimerId = null;
  }

  window.addEventListener("unload", () => {
    stopProcessingStatePolling();
  });

  window.addEventListener("focus", () => {
    refreshProcessingState();
  });

  window.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshProcessingState();
    }
  });

  async function initializePopupState() {
    await refreshProcessingState();
    startProcessingStatePolling();
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
  interruptProcessingEl.addEventListener("click", onInterruptClicked);
  openOptionsEl.addEventListener("click", openOptions);

  initializePopupState();
  loadSettings();
})();
