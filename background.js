const RESTRICTED_URL =
  /^(chrome|chrome-extension|edge|about|devtools|chrome-search|chrome-untrusted):/i;

/** 同步缓存：全局快捷键不能先 await 再注入，否则容易丢掉用户手势 */
let cachedActiveTabId = null;
/** 正在出声的标签（多半是正在播视频的页） */
let lastAudibleTabId = null;
/** 上次成功进入画中画的标签：关掉小窗口后再按应优先恢复它 */
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
  if (typeof tabId === "number") cachedActiveTabId = tabId;
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  rememberActiveTab(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (cachedActiveTabId === tabId) cachedActiveTabId = null;
  if (lastAudibleTabId === tabId) lastAudibleTabId = null;
  if (lastPipTabId === tabId) lastPipTabId = null;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.audible === true) {
    lastAudibleTabId = tabId;
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    if (tabs[0]?.id != null) rememberActiveTab(tabs[0].id);
  });
});

chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
  if (tabs[0]?.id != null) rememberActiveTab(tabs[0].id);
});

chrome.tabs.query({ audible: true }, (tabs) => {
  if (tabs[0]?.id != null) lastAudibleTabId = tabs[0].id;
});

/**
 * 注入到页面中执行。不要在 requestPictureInPicture 之前 await。
 * @returns {Promise<string>}
 */
function togglePipInPage() {
  function videoScore(video) {
    let score = 0;
    if (!video.paused && !video.ended) score += 1e9;
    score += (video.readyState || 0) * 1e7;
    const rect = video.getClientRects()[0] || { width: 0, height: 0 };
    score += rect.width * rect.height;
    if (video.currentSrc || video.src) score += 1e5;
    return score;
  }

  function findBestVideo() {
    // 后台标签页里 readyState 常被刷成 0，不能只认 readyState !== 0
    const videos = Array.from(document.querySelectorAll("video")).filter(
      (video) =>
        video.disablePictureInPicture === false &&
        (video.readyState > 0 ||
          !!video.currentSrc ||
          !!video.src ||
          !!video.querySelector("source"))
    );
    if (!videos.length) return null;
    videos.sort((a, b) => videoScore(b) - videoScore(a));
    return videos[0];
  }

  if (document.pictureInPictureElement) {
    return document.exitPictureInPicture().then(() => "exited");
  }

  const video = findBestVideo();
  if (!video) return Promise.resolve("no-video");

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

function probeHasVideo() {
  return Array.from(document.querySelectorAll("video")).some(
    (video) =>
      video.disablePictureInPicture === false &&
      (video.readyState > 0 ||
        !!video.currentSrc ||
        !!video.src ||
        !!video.querySelector("source"))
  );
}

function pickResult(results) {
  if (!results?.length) return "no-video";
  const statuses = results.map((r) => r?.result).filter((v) => v != null);
  if (statuses.includes("entered")) return "entered";
  if (statuses.includes("exited")) return "exited";
  const err = statuses.find((s) => String(s).startsWith("error:"));
  if (err) return err;
  return "no-video";
}

function runInject(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: togglePipInPage,
  });
}

async function wakeTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId != null) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  await chrome.tabs.update(tabId, { active: true });
  if (tab.discarded) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      const onUpdated = (id, info) => {
        if (id === tabId && info.status === "complete") {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  } else {
    await new Promise((r) => setTimeout(r, 120));
  }
}

function uniqueTabIds(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (typeof id !== "number" || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 全局快捷键优先恢复「上次 PiP / 正在出声」的标签，
 * 不要优先用事件里的当前活动标签（常常是无视频的页面 → 显示 NO）。
 */
function candidateTabIdsSync(tabFromEvent, fromCommand) {
  if (fromCommand) {
    return uniqueTabIds([
      lastPipTabId,
      lastAudibleTabId,
      cachedActiveTabId,
      tabFromEvent?.id,
    ]);
  }
  return uniqueTabIds([tabFromEvent?.id, lastPipTabId, lastAudibleTabId, cachedActiveTabId]);
}

async function collectFallbackTabIds(excludeIds) {
  const excluded = new Set(excludeIds);
  const ids = [];

  const push = (id) => {
    if (typeof id === "number" && !excluded.has(id) && !ids.includes(id)) {
      ids.push(id);
    }
  };

  push(lastPipTabId);
  push(lastAudibleTabId);

  const audible = await chrome.tabs.query({ audible: true });
  for (const tab of audible) push(tab.id);

  const httpTabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  // 最近访问的靠前一点
  httpTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  for (const tab of httpTabs.slice(0, 12)) push(tab.id);

  return ids;
}

async function tabLooksPromising(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.id || (tab.url && RESTRICTED_URL.test(tab.url))) return false;
    if (tab.discarded) {
      await wakeTab(tabId);
    }
    const probe = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: probeHasVideo,
    });
    return (probe || []).some((r) => r?.result === true);
  } catch (_) {
    return false;
  }
}

async function fallbackToggle(triedIds) {
  const candidates = await collectFallbackTabIds(triedIds);
  for (const tabId of candidates) {
    const ok = await tabLooksPromising(tabId);
    if (!ok) continue;
    try {
      // 后台页视频可能还没就绪：先唤醒再切换
      await wakeTab(tabId);
      const results = await runInject(tabId);
      const status = pickResult(results);
      if (status === "no-video") continue;
      handleInjectResults(tabId, results);
      return;
    } catch (error) {
      console.warn("fallback inject failed:", tabId, error);
    }
  }
  flashBadge("NO", "#f9ab00");
}

function handleInjectResults(tabId, results, options = {}) {
  const status = pickResult(results);
  const nextCandidates = options.nextCandidates || [];
  const triedIds = options.triedIds || [tabId];

  if (status === "entered") {
    lastPipTabId = tabId;
    lastAudibleTabId = tabId;
    flashBadge("OK", "#0d904f");
    return;
  }
  if (status === "exited") {
    // 保留 lastPipTabId，方便关掉小窗口后再次恢复
    flashBadge("OFF", "#5f6368");
    return;
  }
  if (status === "no-video") {
    if (nextCandidates.length) {
      injectToggle(nextCandidates[0], nextCandidates.slice(1), triedIds);
      return;
    }
    if (options.allowFallback !== false) {
      fallbackToggle(triedIds);
      return;
    }
    flashBadge("NO", "#f9ab00");
    return;
  }
  console.warn("PiP failed:", status);
  // NotAllowedError 等：先唤醒同一标签再试一次；仍失败则换其它候选标签
  if (options.allowWakeRetry !== false) {
    (async () => {
      try {
        await wakeTab(tabId);
        const results2 = await runInject(tabId);
        const status2 = pickResult(results2);
        if (status2 === "entered" || status2 === "exited") {
          handleInjectResults(tabId, results2, {
            allowFallback: false,
            allowWakeRetry: false,
          });
          return;
        }
        if (nextCandidates.length) {
          injectToggle(nextCandidates[0], nextCandidates.slice(1), triedIds);
          return;
        }
        await fallbackToggle(triedIds);
      } catch (error) {
        console.warn("wake retry failed:", error);
        if (nextCandidates.length) {
          injectToggle(nextCandidates[0], nextCandidates.slice(1), triedIds);
          return;
        }
        await fallbackToggle(triedIds);
      }
    })();
    return;
  }
  flashBadge("X", "#d93025");
}

/**
 * 同步立刻注入（保留手势）。若该标签没有视频，继续试下一个候选，再全局扫描。
 */
function injectToggle(tabId, nextCandidates = [], previouslyTried = []) {
  const triedIds = uniqueTabIds([...previouslyTried, tabId]);
  const pending = runInject(tabId);
  pending
    .then((results) =>
      handleInjectResults(tabId, results, {
        allowFallback: true,
        allowWakeRetry: true,
        triedIds,
        nextCandidates,
      })
    )
    .catch(async (error) => {
      console.warn("inject failed, wake and retry:", error);
      try {
        await wakeTab(tabId);
        const results = await runInject(tabId);
        handleInjectResults(tabId, results, {
          allowFallback: true,
          allowWakeRetry: false,
          triedIds,
          nextCandidates,
        });
      } catch (retryError) {
        console.warn("PiP retry failed:", retryError);
        if (nextCandidates.length) {
          injectToggle(nextCandidates[0], nextCandidates.slice(1), triedIds);
          return;
        }
        fallbackToggle(triedIds);
      }
    });
}

function togglePictureInPicture(tabFromEvent, fromCommand) {
  const candidates = candidateTabIdsSync(tabFromEvent, fromCommand);
  if (candidates.length) {
    injectToggle(candidates[0], candidates.slice(1));
    return;
  }

  (async () => {
    const audible = await chrome.tabs.query({ audible: true });
    if (audible[0]?.id) {
      injectToggle(audible[0].id);
      return;
    }
    const lastFocused = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (lastFocused[0]?.id) {
      injectToggle(lastFocused[0].id);
      return;
    }
    flashBadge("?", "#d93025");
  })();
}

chrome.action.onClicked.addListener((tab) => {
  if (tab?.id) rememberActiveTab(tab.id);
  togglePictureInPicture(tab, false);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "toggle-pip") return;
  // 不能在此 await；必须同步进入首次 inject
  togglePictureInPicture(tab, true);
});
