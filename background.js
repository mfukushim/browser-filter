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

  let currentSettings = { ...DEFAULT_SETTINGS };

  const REQUEST_BLOCK_CONFIG = {
    ENABLE_REQUEST_BLOCK: true
  };

  const REQUEST_BLOCK_RULE_ID_BASE = 900000;
  const REQUEST_BLOCK_RULES = [
    { id: REQUEST_BLOCK_RULE_ID_BASE + 1, filter: "||doubleclick.net^" },
    { id: REQUEST_BLOCK_RULE_ID_BASE + 2, filter: "||googlesyndication.com^" },
    { id: REQUEST_BLOCK_RULE_ID_BASE + 3, filter: "||adservice.google.com^" },
    { id: REQUEST_BLOCK_RULE_ID_BASE + 4, filter: "||googleadservices.com^" },
    { id: REQUEST_BLOCK_RULE_ID_BASE + 5, filter: "||adnxs.com^" },
    { id: REQUEST_BLOCK_RULE_ID_BASE + 6, filter: "||taboola.com^" },
    { id: REQUEST_BLOCK_RULE_ID_BASE + 7, filter: "||outbrain.com^" },
    { id: REQUEST_BLOCK_RULE_ID_BASE + 8, filter: "||popads.net^" }
  ].map((rule) => ({
    id: rule.id,
    priority: 1,
    action: { type: "block" },
    condition: {
      urlFilter: rule.filter,
      resourceTypes: [
        "main_frame",
        "sub_frame",
        "script",
        "image",
        "xmlhttprequest",
        "media"
      ]
    }
  }));

  const REQUEST_TIMEOUT_MS = 8000;
  const decisionCache = new Map();

  function normalizeSettings(raw) {
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

  function applySettings(raw) {
    currentSettings = normalizeSettings(raw);
    REQUEST_BLOCK_CONFIG.ENABLE_REQUEST_BLOCK = currentSettings.enabledGlobal;
  }

  function getStoredSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          resolve({ ...DEFAULT_SETTINGS });
          return;
        }
        resolve(normalizeSettings(result?.[STORAGE_KEY]));
      });
    });
  }

  function saveStoredSettings(settings) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: settings }, () => {
        resolve(!chrome.runtime.lastError);
      });
    });
  }

  function syncRequestBlockRules() {
    chrome.declarativeNetRequest.getDynamicRules((currentRules) => {
      const managedRuleIds = (currentRules || [])
        .map((rule) => rule.id)
        .filter((id) => id >= REQUEST_BLOCK_RULE_ID_BASE && id < REQUEST_BLOCK_RULE_ID_BASE + 1000);

      chrome.declarativeNetRequest.updateDynamicRules(
        {
          removeRuleIds: managedRuleIds,
          addRules: REQUEST_BLOCK_CONFIG.ENABLE_REQUEST_BLOCK ? REQUEST_BLOCK_RULES : []
        },
        () => {
          if (chrome.runtime.lastError) {
            console.warn("Failed to update request-block rules:", chrome.runtime.lastError.message);
          }
        }
      );
    });
  }

  chrome.runtime.onInstalled.addListener(async () => {
    const settings = await getStoredSettings();
    applySettings(settings);
    await saveStoredSettings(settings);
    syncRequestBlockRules();
  });

  chrome.runtime.onStartup.addListener(async () => {
    const settings = await getStoredSettings();
    applySettings(settings);
    syncRequestBlockRules();
  });

  async function fetchDecisionFromApi(text) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(currentSettings.apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text }),
        signal: controller.signal
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      return data?.ok === true;
    } catch (error) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function getDecision(text) {
    if (decisionCache.has(text)) {
      return decisionCache.get(text);
    }

    const decision = await fetchDecisionFromApi(text);
    decisionCache.set(text, decision);
    return decision;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "AD_FILTER_SETTINGS_UPDATED") {
      applySettings(message.settings);
      decisionCache.clear();
      syncRequestBlockRules();
      sendResponse({ accepted: true });
      return;
    }

    if (message?.type !== "AD_FILTER_BATCH_CHECK") {
      return;
    }

    const tabId = sender.tab?.id;
    const frameId = sender.frameId;
    const items = Array.isArray(message.items) ? message.items : [];

    (async () => {
      if (typeof tabId !== "number") {
        sendResponse({ accepted: false });
        return;
      }

      if (!currentSettings.enabledGlobal || !currentSettings.enableTextReplacement) {
        await Promise.all(
          items.map(async (item) => {
            const requestId = item?.requestId;
            if (typeof requestId !== "string") return;
            chrome.tabs.sendMessage(
              tabId,
              {
                type: "AD_FILTER_CHECK_RESULT",
                requestId,
                ok: true
              },
              { frameId }
            );
          })
        );
        sendResponse({ accepted: true });
        return;
      }

      await Promise.all(
        items.map(async (item) => {
          const requestId = item?.requestId;
          const text = item?.text;
          if (typeof requestId !== "string" || typeof text !== "string") {
            return;
          }

          const ok = await getDecision(text);
          chrome.tabs.sendMessage(
            tabId,
            {
              type: "AD_FILTER_CHECK_RESULT",
              requestId,
              ok
            },
            { frameId }
          );
        })
      );

      sendResponse({ accepted: true });
    })();

    return true;
  });

  (async () => {
    const settings = await getStoredSettings();
    applySettings(settings);
    syncRequestBlockRules();
  })();
})();
