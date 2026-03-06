(() => {
  "use strict";

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

  const API_ENDPOINT = "http://localhost/ad-filter/judge";
  // const API_ENDPOINT = "https://example.com/ad-filter/judge";
  const REQUEST_TIMEOUT_MS = 8000;
  const decisionCache = new Map();

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

  chrome.runtime.onInstalled.addListener(() => {
    syncRequestBlockRules();
  });

  chrome.runtime.onStartup.addListener(() => {
    syncRequestBlockRules();
  });

  async function fetchDecisionFromApi(text) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(API_ENDPOINT, {
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
})();
