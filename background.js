(() => {
  "use strict";

  const API_ENDPOINT = "http://localhost/ad-filter/judge";
  // const API_ENDPOINT = "https://example.com/ad-filter/judge";
  const REQUEST_TIMEOUT_MS = 8000;
  const decisionCache = new Map();

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
