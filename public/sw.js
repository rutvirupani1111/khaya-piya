// KhayaPiya service worker, hand-written (no build step).
// - The Counter, Table and Shelf open offline: their pages are cached, and one /bill shell serves every draft id
//   (the page reads the id from the address bar and the draft from IndexedDB).
// - Built JS, CSS and fonts are cache-first; they are content-hashed, so a cached copy is never stale.
// - The OCR scripts and data from jsDelivr are cached after the first scan, so scanning works offline next time.
// - A photo shared into the app (Android share sheet) is caught here and handed to the Counter. It never leaves the phone.
// - API calls are never cached: room ops wait in the page's IndexedDB queue instead.
const SHELL = "kp-shell-v3";
const STATIC = "kp-static-v2";
const OCR = "kp-ocr-v1";
const SHARE = "kp-share";
const PAGES = ["/", "/demo", "/offline", "/bill/_", "/bill/_/masala"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      const assets = new Set(["/icon.svg", "/manifest.webmanifest"]);
      for (const path of PAGES) {
        try {
          const res = await fetch(path, { cache: "no-store" });
          if (!res.ok) continue;
          await shell.put(path, res.clone());
          const html = await res.text();
          for (const m of html.matchAll(/\/_next\/static\/[^"'\s)\\]+/g)) assets.add(m[0]);
        } catch {}
      }
      const stat = await caches.open(STATIC);
      await Promise.all([...assets].map((a) => stat.add(a).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [SHELL, STATIC, OCR, SHARE];
      for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") (await caches.open(name)).put(req, res.clone()).catch(() => {});
  return res;
}

function shellFor(path) {
  if (/^\/bill\/[^/]+\/masala\/?$/.test(path)) return "/bill/_/masala";
  if (/^\/bill\/[^/]+\/?$/.test(path)) return "/bill/_";
  if (path === "/demo") return "/demo";
  if (path === "/" || path === "") return "/";
  return null;
}

async function page(req) {
  const url = new URL(req.url);
  const shell = shellFor(url.pathname);
  try {
    const res = await fetch(req);
    // keep the offline copies of the Counter and demo fresh
    if (res.ok && (url.pathname === "/" || url.pathname === "/demo") && !url.search) (await caches.open(SHELL)).put(url.pathname, res.clone()).catch(() => {});
    return res;
  } catch {
    const c = await caches.open(SHELL);
    return (shell && (await c.match(shell))) || (await c.match("/offline")) || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

async function share(req) {
  try {
    const form = await req.formData();
    const file = form.get("bill");
    if (file && typeof file !== "string") {
      await (await caches.open(SHARE)).put("/__shared-bill", new Response(file, { headers: { "Content-Type": file.type || "image/jpeg" } }));
      return Response.redirect("/?shared=1", 303);
    }
  } catch {}
  return Response.redirect("/?shared=0", 303);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    if (req.method === "GET" && url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("tesseract")) event.respondWith(cacheFirst(req, OCR));
    return;
  }
  if (req.method === "POST" && url.pathname === "/share-target") return event.respondWith(share(req));
  if (req.method !== "GET" || url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg" || url.pathname === "/manifest.webmanifest") return event.respondWith(cacheFirst(req, STATIC));
  if (req.mode === "navigate") return event.respondWith(page(req));
});
