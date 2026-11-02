const RESTRICTED_URL =
  /^(chrome|chrome-extension|edge|about|devtools|chrome-search|chrome-untrusted):/i;

/** 同步可用的缓存：全局快捷键不能先 await 再注入，否则会丢掉用户手势 */
let cachedActiveTabId = null;
/** 上次成功进入画中画的标签：关掉小窗口后再按，应优先恢复它 */
let lastPipTabId = null;

async function flashBadge(text, color = "#1a73e8") {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    chrome.alarms.create("clear-badge", { when: Date.now() + 1600 });
  } catch (_) {
    // ignore
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "clear-badge") {
    chrome.action.setBadgeText({ text: "" });
  }
});

function rememberActiveTab(tabId) {
  if (typeof tabId === "number") {
    cachedActiveTabId = tabId;
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  rememberActiveTab(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (cachedActiveTabId === tabId) cachedActiveTabId = null;
  if (lastPipTabId === tabId) lastPipTabId = null;
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    if (tabs[0]?.id != null) rememberActiveTab(tabs[0].id);
  });
});

// 启动时预热缓存
chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
  if (tabs[0]?.id != null) rememberActiveTab(tabs[0].id);
});

/**
 * 在页面里同步发起 PiP（此函数会被注入；await 之前绝不能丢掉手势）
 * @returns {Promise<string>}
 */
function togglePipInPage() {
  function findLargestVideo() {
    return Array.from(document.querySelectorAll("video"))
      .filter((video) => video.readyState !== 0)
      .filter((video) => video.disablePictureInPicture === false)
      .sort((v1, v2) => {
        const a = v1.getClientRects()[0] || { width: 0, height: 0 };
        const b = v2.getClientRects()[0] || { width: 0, height: 0 };
        return b.width * b.height - a.width * a.height;
      })[0];
  }

  // 已在画中画：再按则关闭
  if (document.pictureInPictureElement) {
    return document.exitPictureInPicture().then(() => "exited");
  }

  const video = findLargestVideo();
  if (!video) {
    return Promise.resolve("no-video");
  }

  // 不要在 requestPictureInPicture 之前 await play()，否则用户手势会失效
  if (video.paused) {
    video.play().catch(() => {});
  }

  return video
    .requestPictureInPicture()
    .then(() => {
      video.setAttribute("__pip__", "true");
      video.addEventListener(
        "leavepictureinpicture",
        () => video.removeAttribute("__pip__"),
        { once: true }
      );
      return "entered";
    })
    .catch((error) => `error:${error.name}:${error.message}`);
}

function pickResult(results) {
  if (!results?.length) return "no-video";
  const statuses = results.map((r) => r?.result).filter(Boolean);
  if (statuses.includes("entered")) return "entered";
  if (statuses.includes("exited")) return "exited";
  const err = statuses.find((s) => String(s).startsWith("error:"));
  if (err) return err;
  return "no-video";
}

function handleInjectResults(tabId, results) {
  const status = pickResult(results);
  if (status === "entered") {
    lastPipTabId = tabId;
    flashBadge("OK", "#0d904f");
    return;
  }
  if (status === "exited") {
    flashBadge("OFF", "#5f6368");
    return;
  }
  if (status === "no-video") {
    flashBadge("NO", "#f9ab00");
    return;
  }
  console.warn("PiP failed:", status);
  flashBadge("X", "#d93025");
}

/**
 * 关键：listener 里先 await 再 executeScript，全局快捷键下 PiP 会因丢失手势而失败。
 */
function injectToggle(tabId) {
  const pending = chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: togglePipInPage,
  });

  pending
    .then((results) => handleInjectResults(tabId, results))
    .catch(async (error) => {
      console.warn("inject failed, retry after focus:", error);
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.windowId != null) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        await chrome.tabs.update(tabId, { active: true });
        const results = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: togglePipInPage,
        });
        handleInjectResults(tabId, results);
      } catch (retryError) {
        console.warn("PiP retry failed:", retryError);
        flashBadge("X", "#d93025");
      }
    });
}

function resolveTabIdSync(tabFromEvent) {
  // 1) 事件自带 tab（「在 Chrome 中」时常见）
  // 2) 上次成功 PiP 的标签（关掉小窗口后按快捷键应恢复）
  // 3) 缓存的当前活动标签
  return tabFromEvent?.id ?? lastPipTabId ?? cachedActiveTabId;
}

async function resolveTabIdAsync() {
  if (lastPipTabId) {
    try {
      const tab = await chrome.tabs.get(lastPipTabId);
      if (tab?.id && (!tab.url || !RESTRICTED_URL.test(tab.url))) {
        return tab.id;
      }
    } catch (_) {
      lastPipTabId = null;
    }
  }

  const lastFocused = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  for (const tab of lastFocused) {
    if (tab?.id && tab.url && !RESTRICTED_URL.test(tab.url)) {
      return tab.id;
    }
  }

  const windows = await chrome.windows.getAll({ populate: true });
  for (const win of windows) {
    if (win.type && win.type !== "normal") continue;
    const active = (win.tabs || []).find((t) => t.active);
    if (active?.id && active.url && !RESTRICTED_URL.test(active.url)) {
      return active.id;
    }
  }
  return null;
}

function togglePictureInPicture(tabFromEvent) {
  const syncId = resolveTabIdSync(tabFromEvent);
  if (syncId) {
    // 同步路径：立刻注入，保留全局快捷键用户手势
    injectToggle(syncId);
    return;
  }

  // 仅在没有缓存时才异步查找（可能仍会因手势丢失而失败，失败后会聚焦重试）
  resolveTabIdAsync().then((tabId) => {
    if (!tabId) {
      flashBadge("?", "#d93025");
      return;
    }
    rememberActiveTab(tabId);
    injectToggle(tabId);
  });
}

chrome.action.onClicked.addListener((tab) => {
  if (tab?.id) rememberActiveTab(tab.id);
  togglePictureInPicture(tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "toggle-pip") return;
  // 这里不能做任何 await，必须同步进入 injectToggle
  togglePictureInPicture(tab);
});
