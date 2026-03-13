(() => {
  "use strict";

  const STORAGE_KEY = "afSettings";
  const DEFAULT_SETTINGS = {
    enabledGlobal: true,
    enableRequestBlock: true,
    enableTextReplacement: true,
    enableImageReplacement: true,
    enablePopupSuppression: true,
    enableIframeReplacement: true,
    useApiReplaceResponse: false,
    invertOkValue: false,
    textThresholdLength: 20,
    apiEndpoint: "http://localhost/ad-filter/judge",
    apiPrompt: "次の文は映画の話題を含みますか?",
    apiModel: "qwen3.5:4b"
  };

  const form = document.getElementById("settings-form");
  const statusEl = document.getElementById("status");

  function normalize(raw) {
    const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
    const threshold = Number.parseInt(merged.textThresholdLength, 10);

    return {
      enabledGlobal: merged.enabledGlobal !== false,
      enableRequestBlock: merged.enableRequestBlock !== false,
      enableTextReplacement: merged.enableTextReplacement !== false,
      enableImageReplacement: merged.enableImageReplacement !== false,
      enablePopupSuppression: merged.enablePopupSuppression !== false,
      enableIframeReplacement: merged.enableIframeReplacement !== false,
      useApiReplaceResponse: merged.useApiReplaceResponse !== false,
      invertOkValue: merged.invertOkValue === true,
      textThresholdLength: Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_SETTINGS.textThresholdLength,
      apiEndpoint:
        typeof merged.apiEndpoint === "string" && merged.apiEndpoint.trim()
          ? merged.apiEndpoint.trim()
          : DEFAULT_SETTINGS.apiEndpoint,
      apiPrompt:
        typeof merged.apiPrompt === "string" && merged.apiPrompt.trim()
          ? merged.apiPrompt.trim()
          : DEFAULT_SETTINGS.apiPrompt,
      apiModel:
        typeof merged.apiModel === "string" && merged.apiModel.trim()
          ? merged.apiModel.trim()
          : DEFAULT_SETTINGS.apiModel
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
      enableRequestBlock: document.getElementById("enableRequestBlock").checked,
      enableTextReplacement: document.getElementById("enableTextReplacement").checked,
      enableImageReplacement: document.getElementById("enableImageReplacement").checked,
      enablePopupSuppression: document.getElementById("enablePopupSuppression").checked,
      enableIframeReplacement: document.getElementById("enableIframeReplacement").checked,
      useApiReplaceResponse: document.getElementById("useApiReplaceResponse").checked,
      invertOkValue: document.getElementById("invertOkValue").checked,
      textThresholdLength: threshold,
      apiEndpoint: document.getElementById("apiEndpoint").value,
      apiPrompt: document.getElementById("apiPrompt").value,
      apiModel: document.getElementById("apiModel").value
    });
  }

  function writeFormValues(settings) {
    document.getElementById("enableRequestBlock").checked = settings.enableRequestBlock;
    document.getElementById("enableTextReplacement").checked = settings.enableTextReplacement;
    document.getElementById("enableImageReplacement").checked = settings.enableImageReplacement;
    document.getElementById("enablePopupSuppression").checked = settings.enablePopupSuppression;
    document.getElementById("enableIframeReplacement").checked = settings.enableIframeReplacement;
    document.getElementById("useApiReplaceResponse").checked = settings.useApiReplaceResponse;
    document.getElementById("invertOkValue").checked = settings.invertOkValue;
    document.getElementById("textThresholdLength").value = String(settings.textThresholdLength);
    document.getElementById("apiEndpoint").value = settings.apiEndpoint;
    document.getElementById("apiPrompt").value = settings.apiPrompt;
    document.getElementById("apiModel").value = settings.apiModel;
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
    const current = normalize(await getChromeStorageSettings());
    const partial = readFormValues();
    const settings = {
      ...current,
      ...partial,
      enabledGlobal: current.enabledGlobal !== false
    };

    setToLocalStorage(settings);
    const ok = await setChromeStorageSettings(settings);

    chrome.runtime.sendMessage({
      type: "AD_FILTER_SETTINGS_UPDATED",
      settings
    });

    setStatus(ok ? "保存しました。" : "localStorage には保存しましたが拡張ストレージへの保存に失敗しました。", !ok);
  }

  function updateInvertOkValueState() {
    const useApiReplaceResponse = document.getElementById("useApiReplaceResponse").checked;
    const invertOkValueCheckbox = document.getElementById("invertOkValue");

    // 変換モード（useApiReplaceResponse）がONの場合、OK判定反転を無効化
    invertOkValueCheckbox.disabled = useApiReplaceResponse;

    // 無効化されたときはチェックを外す
    if (useApiReplaceResponse) {
      invertOkValueCheckbox.checked = false;
    }
  }

  // 変換モードチェックボックスの変更イベントをリッスン
  document.getElementById("useApiReplaceResponse").addEventListener("change", updateInvertOkValueState);

  form.addEventListener("submit", saveSettings);
  loadSettings().then(() => {
    // 初期ロード時にも状態を更新
    updateInvertOkValueState();
  });
})();
