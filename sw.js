// sw.js - 通用 Service Worker (适配 GitHub Pages 多项目)
// 动态确定当前应用的子目录，隔离缓存，确保离线访问正常

// ---------- 1. 动态路径与缓存名称 ----------
const BASE_PATH = self.location.pathname.replace(/[^/]+$/, '');
// 使用时间戳作为版本号，确保更新后旧缓存自动失效
const APP_VERSION = '3.0';
const CACHE_NAME = `invest-cache${BASE_PATH.replace(/\//g, '-')}v${APP_VERSION}`;

// 预缓存资源列表
const PRECACHE_URLS = [
  BASE_PATH,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.json`,
];

// 静态资源扩展名
const STATIC_EXTENSIONS = ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'woff', 'woff2', 'ttf', 'eot', 'ico'];

// ---------- 2. 工具函数 ----------
function isStaticResource(url) {
  const ext = url.pathname.split('.').pop().toLowerCase();
  return STATIC_EXTENSIONS.includes(ext);
}

function isNavigateRequest(request) {
  return request.mode === 'navigate' || (request.method === 'GET' && request.destination === 'document');
}

// ---------- 3. 安装阶段 ----------
self.addEventListener('install', (event) => {
  console.log('[SW] 安装中, version =', APP_VERSION, 'BASE_PATH =', BASE_PATH);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] 预缓存资源:', PRECACHE_URLS);
        return Promise.allSettled(
          PRECACHE_URLS.map(url => cache.add(url).catch(err => console.warn(`预缓存失败 ${url}:`, err)))
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ---------- 4. 激活阶段（清理旧版本缓存） ----------
self.addEventListener('activate', (event) => {
  console.log('[SW] 激活中...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          // 删除所有不属于当前版本的缓存
          if (cache.startsWith('invest-cache-') && cache !== CACHE_NAME) {
            console.log('[SW] 删除旧缓存:', cache);
            return caches.delete(cache);
          }
          // 也清理旧格式的缓存
          if (cache.startsWith('pwa-cache-')) {
            console.log('[SW] 删除旧格式缓存:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ---------- 5. 请求拦截 ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理同源 GET 请求
  if (url.origin !== location.origin || request.method !== 'GET') {
    return;
  }

  // API请求不缓存
  if (url.hostname.includes('alphavantage.co') || 
      url.hostname.includes('finnhub.io') ||
      url.hostname.includes('twelvedata.com') ||
      url.hostname.includes('open.er-api.com')) {
    return;
  }

  // 导航请求：网络优先
  if (isNavigateRequest(request)) {
    event.respondWith(
      fetch(request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          return new Response(
            '<h1>Offline</h1><p>Please check your network connection.</p>',
            { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }

  // 静态资源：缓存优先
  if (isStaticResource(url)) {
    event.respondWith(
      caches.match(request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
          }
          return networkResponse;
        }).catch(() => {
          return new Response('', { status: 408 });
        });
      })
    );
    return;
  }
});

// ---------- 6. 推送通知 ----------
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || '投资提醒';
  const body = data.body || '您有定期投资计划待执行';
  const icon = data.icon || './manifest.json';
  
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: icon,
      badge: icon,
      vibrate: [100, 50, 100],
      data: data,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(BASE_PATH) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(BASE_PATH);
      }
    })
  );
});
