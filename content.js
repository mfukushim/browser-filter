(() => {
  "use strict";

  const MIN_TEXT_LENGTH = 20;
  const MASK_CHAR = "#";
  const REVIEW_DEBOUNCE_MS = 120;

  const SKIP_TEXT_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEXTAREA",
    "INPUT",
    "OPTION"
  ]);

  let requestSequence = 0;
  let reviewTimer = null;
  const pendingNodes = new Set();
  const nodeStates = new WeakMap();
  const requestToNode = new Map();

  function shouldSkipTextNode(node) {
    const parentTag = node?.parentElement?.tagName;
    return Boolean(parentTag && SKIP_TEXT_TAGS.has(parentTag));
  }

  function isEligibleText(text) {
    return typeof text === "string" && text.trim().length >= MIN_TEXT_LENGTH;
  }

  function maskText(text) {
    return Array.from(text).map(() => MASK_CHAR).join("");
  }

  function queueTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    if (shouldSkipTextNode(node)) return;
    pendingNodes.add(node);
  }

  function queueTextNodesInRoot(root) {
    if (!root) return;

    if (root.nodeType === Node.TEXT_NODE) {
      queueTextNode(root);
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      queueTextNode(current);
      current = walker.nextNode();
    }
  }

  function scheduleReviewFlush() {
    if (reviewTimer !== null) return;
    reviewTimer = window.setTimeout(flushPendingReviews, REVIEW_DEBOUNCE_MS);
  }

  function buildRequestId() {
    requestSequence += 1;
    return `${Date.now()}-${requestSequence}`;
  }

  function applyDecisionToNode(node, requestId, ok) {
    const state = nodeStates.get(node);
    if (!state || state.requestId !== requestId) {
      requestToNode.delete(requestId);
      return;
    }

    if (ok) {
      if (node.isConnected && node.nodeValue === state.maskedText) {
        node.nodeValue = state.originalText;
      }
      nodeStates.delete(node);
      requestToNode.delete(requestId);
      return;
    }

    state.status = "rejected";
    if (node.isConnected && node.nodeValue !== state.maskedText) {
      node.nodeValue = state.maskedText;
    }
    requestToNode.delete(requestId);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "AD_FILTER_CHECK_RESULT") return;

    const requestId = message.requestId;
    const ok = message.ok === true;
    if (typeof requestId !== "string") return;

    const node = requestToNode.get(requestId);
    if (node) {
      applyDecisionToNode(node, requestId, ok);
    }
  });

  function prepareReview(node) {
    if (!node.isConnected) return null;

    const text = node.nodeValue || "";
    if (!isEligibleText(text)) {
      nodeStates.delete(node);
      return null;
    }

    const prev = nodeStates.get(node);
    if (prev && prev.originalText === text && prev.status === "pending") {
      return null;
    }
    if (prev && prev.status === "pending" && text === prev.maskedText) {
      return null;
    }
    if (prev && prev.status === "rejected" && text === prev.maskedText) {
      return null;
    }

    const requestId = buildRequestId();
    const maskedText = maskText(text);
    nodeStates.set(node, {
      requestId,
      originalText: text,
      maskedText,
      status: "pending"
    });
    requestToNode.set(requestId, node);
    node.nodeValue = maskedText;

    return { requestId, text };
  }

  function flushPendingReviews() {
    reviewTimer = null;
    if (pendingNodes.size === 0) return;

    const nodes = Array.from(pendingNodes);
    pendingNodes.clear();

    const requests = [];
    for (const node of nodes) {
      const req = prepareReview(node);
      if (req) requests.push(req);
    }

    if (requests.length === 0) return;

    chrome.runtime.sendMessage(
      {
        type: "AD_FILTER_BATCH_CHECK",
        items: requests
      },
      () => {
        if (chrome.runtime.lastError) {
          // 通信失敗時はマスク維持（NG相当）
        }
      }
    );
  }

  function createBlankSvgDataUrl(width, height) {
    const w = Math.max(1, Math.floor(width || 1));
    const h = Math.max(1, Math.floor(height || 1));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="white"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function blankImage(img) {
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset.afBlanked === "1") return;

    const width =
      img.clientWidth ||
      img.width ||
      Number.parseInt(img.getAttribute("width") || "0", 10) ||
      1;
    const height =
      img.clientHeight ||
      img.height ||
      Number.parseInt(img.getAttribute("height") || "0", 10) ||
      1;

    img.dataset.afBlanked = "1";
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
    img.src = createBlankSvgDataUrl(width, height);
    img.style.objectFit = img.style.objectFit || "cover";
  }

  function blankImages(root) {
    if (!root) return;
    if (root instanceof HTMLImageElement) {
      blankImage(root);
    }

    const images = root.querySelectorAll ? root.querySelectorAll("img") : [];
    for (const img of images) {
      blankImage(img);
    }
  }

  function processNode(root) {
    queueTextNodesInRoot(root);
    blankImages(root);
    scheduleReviewFlush();
  }

  if (document.body) {
    processNode(document.body);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        queueTextNode(mutation.target);
        continue;
      }

      if (mutation.type === "attributes") {
        if (mutation.target instanceof HTMLImageElement) {
          blankImage(mutation.target);
        }
        continue;
      }

      if (mutation.target instanceof Element) {
        queueTextNodesInRoot(mutation.target);
      }

      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          queueTextNode(node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          processNode(node);
        }
      }
    }

    scheduleReviewFlush();
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["src", "srcset", "sizes"]
  });
})();
