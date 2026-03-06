(() => {
  "use strict";

  const CONFIG = {
    ENABLE_TEXT_REVIEW: true,
    MIN_TEXT_LENGTH: 20,
    MASK_CHAR: "#",
    REVIEW_DEBOUNCE_MS: 120,
    ENABLE_IMAGE_BLANKING: true,
    ENABLE_POPUP_DOM_BLOCK: true,
    ENABLE_POPUP_CSS_BLOCK: true,
    ENABLE_WINDOW_OPEN_BLOCK: true
  };

  const POPUP_KEYWORD_RE =
    /(popup|pop-up|modal|overlay|interstitial|lightbox|paywall|subscribe|newsletter|consent|cookie|banner|advert|ad-|ad_|ads|dialog)/i;

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
    return typeof text === "string" && text.trim().length >= CONFIG.MIN_TEXT_LENGTH;
  }

  function maskText(text) {
    return Array.from(text).map(() => CONFIG.MASK_CHAR).join("");
  }

  function queueTextNode(node) {
    if (!CONFIG.ENABLE_TEXT_REVIEW) return;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    if (shouldSkipTextNode(node)) return;
    pendingNodes.add(node);
  }

  function queueTextNodesInRoot(root) {
    if (!root || !CONFIG.ENABLE_TEXT_REVIEW) return;

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
    if (!CONFIG.ENABLE_TEXT_REVIEW) return;
    if (reviewTimer !== null) return;
    reviewTimer = window.setTimeout(flushPendingReviews, CONFIG.REVIEW_DEBOUNCE_MS);
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
    if (!CONFIG.ENABLE_TEXT_REVIEW) return;
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
    if (!CONFIG.ENABLE_IMAGE_BLANKING) return;
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
    if (!CONFIG.ENABLE_IMAGE_BLANKING) return;
    if (!root) return;
    if (root instanceof HTMLImageElement) {
      blankImage(root);
    }

    const images = root.querySelectorAll ? root.querySelectorAll("img") : [];
    for (const img of images) {
      blankImage(img);
    }
  }

  function addPopupBlockCss() {
    if (!CONFIG.ENABLE_POPUP_CSS_BLOCK) return;
    if (document.getElementById("af-popup-style")) return;

    const style = document.createElement("style");
    style.id = "af-popup-style";
    style.textContent = `
      [class*="popup"], [id*="popup"],
      [class*="modal"], [id*="modal"],
      [class*="overlay"], [id*="overlay"],
      [class*="interstitial"], [id*="interstitial"],
      [class*="paywall"], [id*="paywall"],
      [class*="subscribe"], [id*="subscribe"],
      [class*="cookie"], [id*="cookie"],
      [class*="consent"], [id*="consent"] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      html[style*="overflow: hidden"], body[style*="overflow: hidden"] {
        overflow: auto !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function unlockScrollIfLocked() {
    const html = document.documentElement;
    const body = document.body;
    if (html && html.style.overflow === "hidden") {
      html.style.overflow = "auto";
    }
    if (body && body.style.overflow === "hidden") {
      body.style.overflow = "auto";
    }
  }

  function getElementMarker(el) {
    const className = typeof el.className === "string" ? el.className : "";
    return [
      el.tagName,
      el.id || "",
      className,
      el.getAttribute("role") || "",
      el.getAttribute("aria-label") || "",
      el.getAttribute("aria-modal") || "",
      el.getAttribute("data-testid") || "",
      el.getAttribute("src") || ""
    ].join(" ");
  }

  function isLikelyPopup(el) {
    if (!(el instanceof HTMLElement)) return false;

    const marker = getElementMarker(el);
    const byKeyword = POPUP_KEYWORD_RE.test(marker);
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    const viewportWidth = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const viewportHeight = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
    const coversLargeArea =
      rect.width >= viewportWidth * 0.4 &&
      rect.height >= viewportHeight * 0.3;

    const position = style.position;
    const positionedOverlay = position === "fixed" || position === "sticky";

    const zIndex = Number.parseInt(style.zIndex || "0", 10);
    const highZ = Number.isFinite(zIndex) && zIndex >= 1000;

    if (el.tagName === "DIALOG" && el.hasAttribute("open")) {
      return true;
    }

    if (el.tagName === "IFRAME" && byKeyword) {
      return true;
    }

    return byKeyword || (positionedOverlay && highZ && coversLargeArea);
  }

  function suppressPopupElement(el) {
    if (!(el instanceof HTMLElement)) return;
    if (el.dataset.afPopupSuppressed === "1") return;
    if (!isLikelyPopup(el)) return;

    el.dataset.afPopupSuppressed = "1";
    el.style.setProperty("display", "none", "important");
    el.style.setProperty("visibility", "hidden", "important");
    el.style.setProperty("pointer-events", "none", "important");
  }

  function suppressPopupsInRoot(root) {
    if (!CONFIG.ENABLE_POPUP_DOM_BLOCK) return;
    if (!root) return;

    if (root instanceof HTMLElement) {
      suppressPopupElement(root);
    }

    const candidates = root.querySelectorAll
      ? root.querySelectorAll("div,section,aside,dialog,iframe,ins")
      : [];
    for (const el of candidates) {
      suppressPopupElement(el);
    }

    unlockScrollIfLocked();
  }

  function installWindowOpenBlocker() {
    if (!CONFIG.ENABLE_WINDOW_OPEN_BLOCK) return;
    if (!document.documentElement || document.documentElement.dataset.afWindowOpenBlocked === "1") return;

    const script = document.createElement("script");
    script.textContent = `
      (() => {
        if (window.__afWindowOpenBlocked === true) return;
        window.__afWindowOpenBlocked = true;
        const originalOpen = window.open;
        window.open = function(url, target, features) {
          if (target === "_self") {
            return originalOpen.call(window, url, target, features);
          }
          return null;
        };
      })();
    `;

    (document.documentElement || document.head).appendChild(script);
    script.remove();
    document.documentElement.dataset.afWindowOpenBlocked = "1";
  }

  function processNode(root) {
    queueTextNodesInRoot(root);
    blankImages(root);
    suppressPopupsInRoot(root);
    scheduleReviewFlush();
  }

  addPopupBlockCss();
  installWindowOpenBlocker();

  if (document.body) {
    processNode(document.body);
  }

  const observedAttributes = ["src", "srcset", "sizes"];
  if (CONFIG.ENABLE_POPUP_DOM_BLOCK) {
    observedAttributes.push("class", "style", "hidden", "open", "id", "role", "aria-modal");
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
        if (mutation.target instanceof HTMLElement) {
          suppressPopupElement(mutation.target);
        }
        continue;
      }

      if (mutation.target instanceof Element) {
        queueTextNodesInRoot(mutation.target);
        suppressPopupsInRoot(mutation.target);
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
    attributeFilter: observedAttributes
  });
})();
