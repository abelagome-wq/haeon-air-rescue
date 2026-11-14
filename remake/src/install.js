// Home-screen installation and optional display enhancement. No service worker,
// cache, reload, navigation, storage, or automatic install/fullscreen prompt.
// Call enterPlay()/requestInstall() directly from a click/tap, before awaiting
// game loading. AudioContext.resume() belongs in that same user handler.
export const INSTALL_MANIFEST_URL = new URL('../manifest.webmanifest', import.meta.url).href;

export function createInstallSupport(options = {}) {
  const win = options.window ?? globalThis.window;
  const doc = options.document ?? win?.document;
  const nav = options.navigator ?? win?.navigator;
  const onChange = options.onChange ?? (() => {});
  let deferred = null, disposed = false, installedEvent = false, ownsLock = false;
  const cleanups = [];
  const media = query => win?.matchMedia?.(query);
  const standalone = media('(display-mode: standalone)');
  const portrait = media('(orientation: portrait)');
  const coarse = media('(pointer: coarse)');
  // UA detection is used only for manual menu wording. All API behavior below
  // is feature-detected, including iPad's desktop-style user agent.
  const userAgent = nav?.userAgent ?? '';
  const ios = /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && (nav?.maxTouchPoints ?? 0) > 1);
  const android = /Android/i.test(userAgent);
  const state = {
    installed:false, canPrompt:false, installing:false, instructions:'',
    secure:win?.isSecureContext === true, networkRequired:true,
    portrait:false, touch:false, fullscreen:false, orientationLocked:false,
    orientationHint:'', fullscreenHint:'',
    storageHint:ios ? 'iPhone·iPad에서는 브라우저와 홈 화면 앱의 게임 기록이 따로 저장됩니다.' : '',
    lastOutcome:null,
  };

  function refresh() {
    if (disposed) return state;
    state.installed = installedEvent || !!standalone?.matches || nav?.standalone === true;
    state.canPrompt = !!deferred && !state.installed && !state.installing;
    state.portrait = portrait ? portrait.matches : (win?.innerHeight ?? 0) > (win?.innerWidth ?? 0);
    state.touch = !!coarse?.matches || (nav?.maxTouchPoints ?? 0) > 0;
    state.fullscreen = !!doc?.fullscreenElement;
    state.orientationLocked = ownsLock;
    state.orientationHint = state.touch && state.portrait ? '기기를 가로로 돌려 주세요. 세로 화면 고정이 켜져 있으면 해제해 주세요.' : '';
    if (state.installed) state.instructions = '홈 화면 앱으로 열었습니다. 플레이하려면 인터넷 연결이 필요합니다.';
    else if (!state.secure) state.instructions = '홈 화면에 추가하려면 HTTPS 게임 링크를 열어 주세요. 플레이에는 인터넷 연결이 필요합니다.';
    else if (state.canPrompt) state.instructions = '홈 화면에 설치하면 아이콘으로 바로 열 수 있습니다. 플레이에는 인터넷 연결이 필요합니다.';
    else if (ios) state.instructions = '공유 메뉴에서 ‘홈 화면에 추가’를 선택하세요. 항목이 없으면 Safari에서 이 링크를 열어 주세요. 플레이에는 인터넷 연결이 필요합니다.';
    else if (android) state.instructions = '브라우저 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택하세요. 플레이에는 인터넷 연결이 필요합니다.';
    else state.instructions = '브라우저의 설치 메뉴에서 앱으로 추가할 수 있습니다. 메뉴가 없으면 이 링크로 계속 플레이하세요. 인터넷 연결이 필요합니다.';
    if (ios && !state.installed) state.instructions += ' ' + state.storageHint;
    try { onChange({...state}); } catch { /* A UI callback must not interrupt play. */ }
    return state;
  }

  function listen(target, event, callback) {
    if (!target?.addEventListener) return;
    target.addEventListener(event, callback);
    cleanups.push(() => target.removeEventListener(event, callback));
  }
  listen(win, 'beforeinstallprompt', event => {
    if (typeof event.prompt !== 'function') return;
    event.preventDefault(); deferred = event; refresh();
  });
  listen(win, 'appinstalled', () => {
    installedEvent = true; deferred = null; state.installing = false; refresh();
  });
  listen(standalone, 'change', refresh);
  listen(portrait, 'change', refresh);
  listen(coarse, 'change', refresh);
  listen(win, 'resize', refresh);
  listen(win?.screen?.orientation, 'change', refresh);
  listen(doc, 'fullscreenchange', () => {
    // Browsers can release orientation when leaving fullscreen.
    if (!doc.fullscreenElement && !state.installed) ownsLock = false;
    refresh();
  });

  async function requestInstall() {
    if (disposed) return {outcome:'unavailable', instructions:state.instructions};
    if (state.installed) return {outcome:'already-installed', instructions:state.instructions};
    if (state.installing) return {outcome:'pending', instructions:state.instructions};
    if (!deferred) { refresh(); return {outcome:'manual', instructions:state.instructions}; }
    const event = deferred; deferred = null; state.installing = true; refresh();
    try {
      // Invoke prompt before the first await so the caller's user activation is
      // preserved. A consumed event cannot be reused for a second prompt.
      const response = await event.prompt();
      const choice = event.userChoice ? await event.userChoice : response;
      state.lastOutcome = choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
    } catch {
      state.lastOutcome = 'unavailable';
    } finally {
      state.installing = false; refresh();
    }
    return {outcome:state.lastOutcome, instructions:state.instructions};
  }

  async function enterPlay({fullscreen = false, element = doc?.documentElement} = {}) {
    if (disposed) return {fullscreen:false, orientationLocked:false, orientationHint:state.orientationHint};
    // Standalone already supplies an app window. Regular browser play never
    // requests fullscreen unless the user explicitly chooses the full button.
    state.fullscreenHint = '';
    if (fullscreen && !state.installed && !doc?.fullscreenElement && typeof element?.requestFullscreen === 'function') {
      try { await element.requestFullscreen({navigationUI:'hide'}); } catch { /* Optional display improvement. */ }
    }
    if (fullscreen && !state.installed && !doc?.fullscreenElement) {
      state.fullscreenHint = ios ? '이 브라우저에서는 홈 화면에 추가해 앱 화면으로 열어 주세요.' : '전체 화면을 열 수 없습니다. 전체 화면 버튼을 클릭하거나 터치해 다시 시도할 수 있습니다.';
    }
    if (!disposed && (state.installed || doc?.fullscreenElement) && typeof win?.screen?.orientation?.lock === 'function') {
      try {
        await win.screen.orientation.lock('landscape');
        if (disposed) win.screen.orientation.unlock?.();
        else ownsLock = true;
      }
      catch { ownsLock = false; }
    }
    refresh();
    return {fullscreen:state.fullscreen, orientationLocked:state.orientationLocked, orientationHint:state.orientationHint, fullscreenHint:state.fullscreenHint};
  }

  function leavePlay() {
    if (ownsLock) {
      try { win?.screen?.orientation?.unlock?.(); } catch { /* Unsupported platforms remain usable. */ }
      ownsLock = false;
    }
    refresh();
  }

  function dispose() {
    if (disposed) return;
    leavePlay(); disposed = true; deferred = null;
    for (const cleanup of cleanups.splice(0)) cleanup();
  }

  refresh();
  return {state, requestInstall, enterPlay, leavePlay, refresh, dispose};
}
