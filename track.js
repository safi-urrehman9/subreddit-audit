// First-party usage log for the admin dashboard. Sends page views, actions and errors to public.track()
// on Supabase. Never sends report contents: only counts, bands and error codes (see the privacy page).
// Visits from a browser that opened the dashboard are skipped (localStorage "sa_notrack").
(() => {
  const URL = "https://mpalkhuqlmfxypfifitr.supabase.co/rest/v1/rpc/track";
  const KEY = "sb_publishable_oQqX0VkhrQCbIHdtiKU6xA_c1I5sLDx"; // publishable key: can only call track()
  const noop = () => {};
  let off = false;
  try { off = localStorage.getItem("sa_notrack") === "1"; } catch {}
  if (off || /\/admin\/?$/.test(location.pathname)) { window.saTrack = noop; return; }

  let sid;
  try { sid = sessionStorage.getItem("sa_sid"); if (!sid) sessionStorage.setItem("sa_sid", (sid = crypto.randomUUID().slice(0, 18))); }
  catch { sid = Math.random().toString(36).slice(2, 14); }
  const q = new URLSearchParams(location.search);
  let ref = "";
  try { const r = document.referrer && new window.URL(document.referrer); if (r && r.host !== location.host) ref = r.host.replace(/^www\./, ""); } catch {}
  if (!ref && q.get("ref")) ref = q.get("ref");
  const base = {
    sid, path: location.pathname, ref,
    utm_source: q.get("utm_source") || undefined, utm_medium: q.get("utm_medium") || undefined, utm_campaign: q.get("utm_campaign") || undefined,
    sw: Math.round(window.innerWidth), lang: navigator.language,
  };

  function send(type, props = {}) {
    try {
      fetch(URL, {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", apikey: KEY },
        body: JSON.stringify({ p: { ...base, type, props } }),
      }).catch(noop);
    } catch {}
  }
  window.saTrack = send;

  const t0 = performance.now();
  addEventListener("load", () => {
    const nav = performance.getEntriesByType("navigation")[0];
    send("pageview", { load_ms: nav ? Math.round(nav.loadEventStart || nav.domContentLoadedEventEnd) : undefined, title: document.title.slice(0, 80) });
  }, { once: true });

  let errs = 0;
  const err = (msg, src, line, col) => { if (errs++ < 5) send("js_error", { msg: String(msg).slice(0, 300), src: String(src || "").split("/").pop().split("?")[0].slice(0, 60), line, col }); };
  addEventListener("error", (e) => { if (e.message) err(e.message, e.filename, e.lineno, e.colno); });
  addEventListener("unhandledrejection", (e) => err("unhandled: " + (e.reason?.message || e.reason), "", 0, 0));

  let maxScroll = 0;
  addEventListener("scroll", () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    if (h > 0) maxScroll = Math.max(maxScroll, Math.round((scrollY / h) * 100));
  }, { passive: true });
  let left = false;
  const leave = () => { if (left) return; left = true; send("leave", { secs: Math.round((performance.now() - t0) / 1000), scroll: Math.min(maxScroll, 100) }); };
  addEventListener("pagehide", leave);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") leave(); }); // first hide = one leave per page view

  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href]");
    if (!a) return;
    try { const u = new window.URL(a.href); if (u.host !== location.host) send("outbound", { host: u.host.replace(/^www\./, ""), href: u.href.slice(0, 200) }); } catch {}
  });
})();
