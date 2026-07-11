// ══════════════════════════════════════════════════════════════
//  Firebase 雲端同步設定
// ══════════════════════════════════════════════════════════════
//
//  ⚠️ 貼你的 Firebase 專案 config 到下方（從 Firebase Console 拿的）
//
// ══════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey:            "AIzaSyAnfLPscBy5-2bbhWLqRiP78mYFNEkJW6M",
  authDomain:        "digiwinmikecrm.firebaseapp.com",
  projectId:         "digiwinmikecrm",
  storageBucket:     "digiwinmikecrm.firebasestorage.app",
  messagingSenderId: "1032498736802",
  appId:             "1:1032498736802:web:9ea72989b449469ffab1fb",
};

// ══════════════════════════════════════════════════════════════
//  以下不用改
// ══════════════════════════════════════════════════════════════

const CLIENTS_KEY = 'dinghsin.clients';
let __cloudCache = null;   // null = 尚未初始同步
let __cloudUser  = null;
let __cloudDb    = null;
let __unsubscribe = null;
let __isConfigured = false;

// 保留原生 localStorage 引用（未攔截前）
const __origGetItem    = localStorage.getItem.bind(localStorage);
const __origSetItem    = localStorage.setItem.bind(localStorage);
const __origRemoveItem = localStorage.removeItem.bind(localStorage);

// ── 攔截 localStorage：只針對 clients key 走雲端 ──
localStorage.getItem = function(key) {
  if (key === CLIENTS_KEY && __cloudUser && __cloudCache !== null) {
    return JSON.stringify(__cloudCache);
  }
  return __origGetItem(key);
};

localStorage.setItem = function(key, value) {
  if (key === CLIENTS_KEY && __cloudUser && __cloudDb) {
    try {
      const newClients = JSON.parse(value);
      const oldClients = __cloudCache || {};
      const userRef = __cloudDb.collection('users').doc(__cloudUser.uid);
      const batch = __cloudDb.batch();
      const newIds = new Set(Object.keys(newClients));
      const oldIds = new Set(Object.keys(oldClients));
      let hasChange = false;
      for (const id of newIds) {
        if (JSON.stringify(newClients[id]) !== JSON.stringify(oldClients[id])) {
          batch.set(userRef.collection('clients').doc(id), newClients[id]);
          hasChange = true;
        }
      }
      for (const id of oldIds) {
        if (!newIds.has(id)) {
          batch.delete(userRef.collection('clients').doc(id));
          hasChange = true;
        }
      }
      if (hasChange) batch.commit().catch(err => console.error('Cloud sync failed:', err));
      __cloudCache = newClients;
      return;
    } catch (e) {
      console.error('setItem intercept error:', e);
    }
  }
  return __origSetItem(key, value);
};

// ── 初始化 Firebase ──
function initCloud(onAuthChange) {
  __isConfigured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('PASTE_');
  if (!__isConfigured) {
    console.warn('[Firebase] 尚未設定 config，將以本地儲存模式運作。');
    if (onAuthChange) onAuthChange(null, { configured: false });
    return;
  }
  if (typeof firebase === 'undefined') {
    console.error('[Firebase] SDK 未載入');
    if (onAuthChange) onAuthChange(null, { configured: false, error: 'SDK missing' });
    return;
  }
  try {
    firebase.initializeApp(firebaseConfig);
    __cloudDb = firebase.firestore();
    __cloudDb.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    // 處理 redirect 登入回來的結果
    firebase.auth().getRedirectResult().catch(err => {
      if (err.code) console.warn('[Firebase] redirect result error:', err.code, err.message);
    });
    firebase.auth().onAuthStateChanged(user => {
      __cloudUser = user;
      if (__unsubscribe) { __unsubscribe(); __unsubscribe = null; }
      if (user) {
        __unsubscribe = __cloudDb.collection('users').doc(user.uid).collection('clients')
          .onSnapshot(snap => {
            const map = {};
            snap.forEach(doc => { map[doc.id] = doc.data(); });
            const isFirst = __cloudCache === null;
            __cloudCache = map;
            if (onAuthChange) onAuthChange(user, { configured: true, isFirstSync: isFirst, clients: map });
          }, err => {
            console.error('[Firestore] snapshot error:', err);
          });
      } else {
        __cloudCache = null;
        if (onAuthChange) onAuthChange(null, { configured: true });
      }
    });
  } catch (e) {
    console.error('[Firebase] init failed:', e);
    if (onAuthChange) onAuthChange(null, { configured: false, error: e.message });
  }
}

function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const auth = firebase.auth();
  // 手機／Safari 直接走 redirect flow（popup 一定被擋）
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isMobile || isSafari) {
    return auth.signInWithRedirect(provider);
  }
  // 桌機先嘗試 popup，被擋就 fallback redirect
  return auth.signInWithPopup(provider).catch(err => {
    if (err.code === 'auth/popup-blocked' ||
        err.code === 'auth/popup-closed-by-user' ||
        err.code === 'auth/cancelled-popup-request' ||
        err.code === 'auth/operation-not-supported-in-this-environment' ||
        err.code === 'auth/web-storage-unsupported') {
      return auth.signInWithRedirect(provider);
    }
    throw err;
  });
}

function signOutFromCloud() {
  return firebase.auth().signOut();
}

// 把本地舊資料一次上傳到雲端
async function migrateLocalToCloud() {
  const raw = __origGetItem(CLIENTS_KEY);
  if (!raw || !__cloudUser || !__cloudDb) return { migrated: 0 };
  try {
    const clients = JSON.parse(raw);
    const ids = Object.keys(clients);
    if (!ids.length) return { migrated: 0 };
    const batch = __cloudDb.batch();
    const userRef = __cloudDb.collection('users').doc(__cloudUser.uid);
    ids.forEach(id => batch.set(userRef.collection('clients').doc(id), clients[id]));
    await batch.commit();
    __origRemoveItem(CLIENTS_KEY);
    return { migrated: ids.length };
  } catch (e) {
    console.error('migrate error:', e);
    return { migrated: 0, error: e.message };
  }
}

function isCloudConfigured() { return __isConfigured; }
function getCloudUser() { return __cloudUser; }
function hasLocalDataToMigrate() {
  const raw = __origGetItem(CLIENTS_KEY);
  if (!raw) return 0;
  try { return Object.keys(JSON.parse(raw)).length; }
  catch { return 0; }
}
