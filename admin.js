// Admin dashboard: one call to public.admin_dash() (key-gated) returns every aggregate and the raw logs.
// Everything in the logs came from a public endpoint, so every value is escaped before it touches the DOM.
(() => {
  const RPC = "https://mpalkhuqlmfxypfifitr.supabase.co/rest/v1/rpc/admin_dash";
  const PK = "sb_publishable_oQqX0VkhrQCbIHdtiKU6xA_c1I5sLDx";
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };
  const nf = new Intl.NumberFormat("en-US");
  const n = (v) => nf.format(Math.round(+v || 0));
  const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(a / b < 0.1 ? 1 : 0)}%` : "–");
  const usd = (v) => { v = +v || 0; return v === 0 ? "$0" : v < 0.01 ? `$${v.toFixed(5)}` : v < 1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`; };
  const ms = (v) => (v == null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

  let key = store.get("sa_admin_key") || sessionStorage.getItem("sa_admin_key") || "";
  let days = +(store.get("sa_admin_days") || 7);
  let data = null, timer = null, logPage = 0, sidFilter = "";
  const PAGE = 100;

  const tzs = (() => { try { return Intl.supportedValuesOf("timeZone"); } catch { return ["UTC"]; } })();
  let tz = store.get("sa_admin_tz") || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const fmtTime = (t, withDate = true) => new Date(t).toLocaleString("en-GB", { timeZone: tz, ...(withDate ? { day: "2-digit", month: "short" } : {}), hour: "2-digit", minute: "2-digit", second: withDate ? undefined : "2-digit" });
  const fmtFull = (t) => new Date(t).toLocaleString("en-GB", { timeZone: tz, year: "numeric", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

  async function fetchDash() {
    const r = await fetch(RPC, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: PK },
      body: JSON.stringify({ p_key: key, p_days: days, p_bots: $("bots").checked, p_tz: tz }),
    });
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error("Wrong key."), { auth: true });
    if (!r.ok) throw new Error(`Dashboard query failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }

  async function load() {
    $("app-sub").textContent = "Loading…";
    try {
      data = await fetchDash();
      render();
    } catch (e) {
      if (e.auth) return lock(e.message);
      $("app-sub").textContent = e.message;
    }
  }

  // ---------- small renderers ----------
  function table(el, rows, cols, opts = {}) {
    if (!rows?.length) { $(el).innerHTML = `<p class="empty">${esc(opts.empty || "Nothing yet in this range.")}</p>`; return; }
    const max = Math.max(...rows.map((r) => +r[cols[1].k] || 0), 1);
    const head = `<tr>${cols.map((c, i) => `<th class="${i ? "n" : ""}">${esc(c.l)}</th>`).join("")}</tr>`;
    const body = rows.slice(0, opts.limit || 25).map((r) => `<tr>${cols.map((c, i) => {
      const v = c.f ? c.f(r[c.k], r) : r[c.k];
      if (i === 0) return `<td class="barcell"><i style="width:${(100 * (+r[cols[1].k] || 0)) / max}%"></i><span>${esc(v)}</span></td>`;
      return `<td class="n">${esc(v)}</td>`;
    }).join("")}</tr>`).join("");
    $(el).innerHTML = `<div class="scroll"><table>${head}${body}</table></div>`;
  }

  function tip(host) {
    let t = host.querySelector(".tip");
    if (!t) { t = document.createElement("div"); t.className = "tip"; host.appendChild(t); }
    return t;
  }

  // Line chart, one shared y-axis (all series are counts). Crosshair + tooltip on hover.
  function lineChart(el, points, series, labelFn) {
    const host = $(el);
    const W = Math.max(host.clientWidth, 300), H = 240, L = 40, R = 16, T = 12, B = 28;
    if (!points.length) { host.innerHTML = '<p class="empty">No data.</p>'; return; }
    const max = Math.max(1, ...points.flatMap((p) => series.map((s) => +p[s.k] || 0)));
    const nice = niceMax(max);
    const x = (i) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
    const y = (v) => T + (H - T - B) * (1 - v / nice);
    const ticks = [0, nice / 2, nice];
    const every = Math.ceil(points.length / Math.max(2, Math.floor((W - L - R) / 70)));
    let svg = `<svg width="${W}" height="${H}" role="img" aria-label="${esc(series.map((s) => s.l).join(" and "))} over time">`;
    ticks.forEach((t) => { svg += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${esc(n(t))}</text>`; });
    points.forEach((p, i) => { if (i % every === 0) svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(labelFn(p.t))}</text>`; });
    series.forEach((s) => {
      const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(+p[s.k] || 0).toFixed(1)}`).join("");
      svg += `<path d="${d}" fill="none" stroke="var(${s.c})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      const last = points.length - 1;
      svg += `<circle cx="${x(last)}" cy="${y(+points[last][s.k] || 0)}" r="4" fill="var(${s.c})" stroke="var(--sheet)" stroke-width="2"/>`;
    });
    svg += `<line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/>`;
    svg += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/></svg>`;
    host.innerHTML = `<div class="legend">${series.map((s) => `<span><b style="background:var(${s.c})"></b>${esc(s.l)}: ${esc(n(points.reduce((a, p) => a + (+p[s.k] || 0), 0)))}</span>`).join("")}</div>` + svg;
    const sv = host.querySelector("svg"), xh = sv.querySelector(".xh"), tt = tip(host);
    sv.addEventListener("mousemove", (ev) => {
      const b = sv.getBoundingClientRect();
      const px = ev.clientX - b.left;
      const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - L) / (W - L - R)) * (points.length - 1))));
      xh.setAttribute("x1", x(i)); xh.setAttribute("x2", x(i)); xh.setAttribute("visibility", "visible");
      tt.innerHTML = `<strong>${esc(labelFn(points[i].t, true))}</strong><br>${series.map((s) => `${esc(s.l)}: ${esc(n(points[i][s.k]))}`).join("<br>")}`;
      tt.style.display = "block"; tt.style.left = `${x(i)}px`; tt.style.top = `${T + 30 + host.querySelector(".legend").offsetHeight}px`;
    });
    sv.addEventListener("mouseleave", () => { xh.setAttribute("visibility", "hidden"); tt.style.display = "none"; });
  }

  // Vertical bars with per-bar hover.
  function barChart(el, items, fmt = n, color = "--s1") {
    const host = $(el);
    const W = Math.max(host.clientWidth, 280), H = 190, L = 44, R = 8, T = 10, B = 26;
    if (!items.length || items.every((d) => !+d.v)) { host.innerHTML = '<p class="empty">Nothing yet in this range.</p>'; return; }
    const max = niceMax(Math.max(...items.map((d) => +d.v || 0)));
    const bw = (W - L - R) / items.length;
    const every = Math.ceil(items.length / Math.max(2, Math.floor((W - L - R) / 42)));
    let svg = `<svg width="${W}" height="${H}" role="img" aria-label="bar chart">`;
    [0, max / 2, max].forEach((t) => { const yy = T + (H - T - B) * (1 - t / max); svg += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="var(--line)"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end">${esc(fmt(t))}</text>`; });
    items.forEach((d, i) => {
      const h = ((H - T - B) * (+d.v || 0)) / max, xx = L + i * bw + 1, w = Math.max(bw - 2, 1), yy = H - B - h;
      const r = Math.min(4, w / 2, h);
      svg += h > 0 ? `<path d="M${xx},${H - B}V${yy + r}Q${xx},${yy} ${xx + r},${yy}H${xx + w - r}Q${xx + w},${yy} ${xx + w},${yy + r}V${H - B}Z" fill="var(${color})"/>` : "";
      svg += `<rect class="hit" data-i="${i}" x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent"/>`;
      if (i % every === 0) svg += `<text x="${xx + w / 2}" y="${H - 8}" text-anchor="middle">${esc(d.k)}</text>`;
    });
    host.innerHTML = svg + "</svg>";
    const tt = tip(host);
    host.querySelectorAll(".hit").forEach((r) => {
      r.addEventListener("mouseenter", () => {
        const d = items[+r.dataset.i];
        tt.innerHTML = `<strong>${esc(d.label || d.k)}</strong><br>${esc(fmt(d.v))}${d.extra ? `<br>${esc(d.extra)}` : ""}`;
        tt.style.display = "block"; tt.style.left = `${+r.getAttribute("x") + bw / 2}px`; tt.style.top = `${T + 34}px`;
      });
      r.addEventListener("mouseleave", () => { tt.style.display = "none"; });
    });
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v)), m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }

  const bucketLabel = (t, long) => {
    const d = new Date(t);
    if (data.bucket === "hour") return d.toLocaleString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", ...(long ? { day: "2-digit", month: "short" } : {}) });
    return d.toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "short", ...(long ? { weekday: "short" } : {}) });
  };

  // ---------- sections ----------
  function render() {
    const d = data, k = d.kpi, p = d.kpi_prev;
    const rangeName = { 1: "last 24 hours", 7: "last 7 days", 30: "last 30 days", 90: "last 90 days", 365: "last year" }[d.days] || `last ${d.days} days`;
    $("app-sub").textContent = `${rangeName[0].toUpperCase()}${rangeName.slice(1)}, compared with the ${rangeName.replace("last ", "previous ")}. Times in ${d.tz}. Updated ${fmtTime(d.generated_at, false)}.`;
    const delta = (a, b, inv) => {
      if (!b && !a) return `<span class="d">no change</span>`;
      if (!b) return `<span class="d ${inv ? "inv " : ""}up">new</span>`;
      const ch = ((a - b) / b) * 100;
      return `<span class="d ${inv ? "inv " : ""}${ch > 0 ? "up" : ch < 0 ? "down" : ""}">${ch > 0 ? "▲" : ch < 0 ? "▼" : ""} ${Math.abs(ch).toFixed(0)}% vs ${esc(n(b))}</span>`;
    };
    const tiles = [
      ["Visitors", k.visitors, p.visitors], ["Sessions", k.sessions, p.sessions], ["Page views", k.pageviews, p.pageviews],
      ["Audits on own file", k.audits_own, p.audits_own], ["Sample audits", k.audits_sample, p.audits_sample],
      ["Session → audit", pct(k.sessions_audit, k.sessions), null, `${n(k.sessions_audit)} of ${n(k.sessions)} sessions`],
      ["Plans written", k.plans, p.plans], ["Downloads", k.downloads, p.downloads], ["Calculator uses", k.calc_uses, p.calc_uses],
      ["Errors", k.errors, p.errors, null, true], ["AI spend", usd(k.ai_cost), null, `prev ${usd(p.ai_cost)}`], ["Bot hits filtered", k.bots, p.bots, null, true],
    ];
    $("kpis").innerHTML = tiles.map(([l, v, prev, note, inv]) => `<div class="card kpi"><div class="l">${esc(l)}</div><div class="v">${esc(typeof v === "number" ? n(v) : v)}</div>${prev != null ? delta(+v, +prev, inv) : `<span class="d">${esc(note || "")}</span>`}</div>`).join("");

    // Health checks
    const f = d.funnel, ai = d.ai, al = [];
    const errSess = f.sessions ? f.with_error / f.sessions : 0;
    al.push(errSess > 0.05 ? ["bad", "✕", `${pct(f.with_error, f.sessions)} of sessions hit an error. See Errors below.`] : ["ok", "✓", `Error rate ${pct(f.with_error, f.sessions)} of sessions.`]);
    const q = ai.quota_day_used / ai.quota_day_max;
    al.push(q >= 0.8 ? ["bad", "✕", `Plan writer used ${n(ai.quota_day_used)} of ${ai.quota_day_max} daily model calls.`] : q >= 0.5 ? ["warn", "!", `Plan writer at ${n(ai.quota_day_used)} of ${ai.quota_day_max} daily calls.`] : ["ok", "✓", `Plan writer quota: ${n(ai.quota_day_used)} of ${ai.quota_day_max} calls in the last 24 h.`]);
    const oc = Object.fromEntries((ai.outcomes || []).map((o) => [o.k, o.n]));
    if (oc.no_balance) al.push(["bad", "✕", `DeepSeek balance ran out ${n(oc.no_balance)} time(s). Top up the account.`]);
    const modelErr = (oc.model_error || 0) + (oc.unavailable || 0);
    if (modelErr) al.push(["warn", "!", `${n(modelErr)} plan request(s) failed on the model or database side.`]);
    if (oc.ip_limit || oc.daily_limit) al.push(["warn", "!", `Rate limits turned away ${n((oc.ip_limit || 0) + (oc.daily_limit || 0))} plan request(s).`]);
    const js = d.js_errors.reduce((a, e) => a + e.n, 0);
    if (js) al.push(["warn", "!", `${n(js)} JavaScript error(s) in ${n(d.js_errors.length)} distinct message(s).`]);
    if (d.audit.cols_not_auto) al.push(["warn", "!", `${n(d.audit.cols_not_auto)} audit(s) needed columns picked by hand. Check the header sets under Errors.`]);
    const proj = (ai.cost_7d / 7) * 30;
    al.push(["ok", "$", `AI spend: ${usd(ai.cost_7d)} in the last 7 days, about ${usd(proj)} per 30 days at that rate. All time ${usd(d.totals_all_time.ai_cost)}.`]);
    if (!d.totals_all_time.events) al.push(["warn", "!", "No events logged yet. Visit the site in a normal browser tab to check tracking works."]);
    $("alerts").innerHTML = al.map(([c, i, t]) => `<div class="alert ${c}"><span class="ic" aria-label="${c}">${esc(i)}</span><span>${esc(t)}</span></div>`).join("");

    // Funnel
    const steps = [["Sessions", f.sessions], ["Saw the home page", f.home], ["Ran any audit", f.ran], ["Audited own file", f.own], ["Wrote a plan", f.plan], ["Downloaded results", f.download]];
    $("funnel").innerHTML = `<table>${steps.map(([l, v], i) => `<tr><td class="barcell" style="width:55%"><i style="width:${f.sessions ? (100 * v) / f.sessions : 0}%"></i><span>${esc(l)}</span></td><td class="n">${esc(n(v))}</td><td class="n">${i ? esc(pct(v, steps[i - 1][1])) + " of prev" : ""}</td><td class="n">${esc(pct(v, f.sessions))}</td></tr>`).join("")}</table>`;

    lineChart("c-traffic", d.series, [{ k: "visitors", l: "Visitors", c: "--s1" }, { k: "audits", l: "Audits", c: "--s2" }, { k: "plans", l: "Plans", c: "--s3" }], bucketLabel);
    barChart("c-hours", d.hours.map((h) => ({ k: String(h.h).padStart(2, "0"), label: `${String(h.h).padStart(2, "0")}:00–${String(h.h).padStart(2, "0")}:59`, v: h.pageviews, extra: `${n(h.audits)} audits` })));
    const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    barChart("c-week", d.weekdays.map((w) => ({ k: wd[w.d - 1], v: w.pageviews, extra: `${n(w.audits)} audits` })));

    // Acquisition
    table("t-ref", d.referrers, [{ k: "k", l: "Referrer" }, { k: "n", l: "Sessions", f: n }]);
    table("t-utm", d.utm, [{ k: "k", l: "Campaign" }, { k: "n", l: "Sessions", f: n }, { k: "audits", l: "With audit", f: n }], { empty: "No tagged links yet." });
    table("t-pages", d.pages, [{ k: "k", l: "Page" }, { k: "pageviews", l: "Views", f: n }, { k: "visitors", l: "Visitors", f: n }]);
    table("t-land", d.landing, [{ k: "k", l: "Landing page" }, { k: "n", l: "Sessions", f: n }]);
    table("t-eng", d.engagement, [{ k: "k", l: "Page" }, { k: "n", l: "Exits", f: n }, { k: "median_secs", l: "Median time", f: (v) => (v == null ? "–" : `${v} s`) }, { k: "avg_scroll", l: "Avg scroll", f: (v) => (v == null ? "–" : `${v}%`) }]);
    table("t-country", d.countries, [{ k: "k", l: "Country" }, { k: "n", l: "Visitors", f: n }]);
    table("t-dev", d.devices, [{ k: "k", l: "Device" }, { k: "n", l: "Visitors", f: n }]);
    table("t-br", d.browsers, [{ k: "k", l: "Browser" }, { k: "n", l: "Visitors", f: n }]);
    table("t-os", d.oses, [{ k: "k", l: "OS" }, { k: "n", l: "Visitors", f: n }]);
    table("t-lang", d.langs, [{ k: "k", l: "Language" }, { k: "n", l: "Visitors", f: n }]);
    table("t-out", d.outbound, [{ k: "k", l: "Host" }, { k: "n", l: "Clicks", f: n }]);
    table("t-types", d.event_types, [{ k: "k", l: "Event" }, { k: "n", l: "Count", f: n }, { k: "sessions", l: "Sessions", f: n }], { limit: 40 });

    // Product
    const a = d.audit, tot = a.cut + a.scale + a.test;
    $("verdicts").innerHTML = tot ? `<div class="stack100" role="img" aria-label="verdict mix">
        <div style="flex:${a.cut};background:var(--red)" title="Cut"></div><div style="flex:${a.scale};background:var(--blue)" title="Spend more"></div><div style="flex:${a.test};background:var(--wait)" title="Keep testing"></div></div>
        <div class="legend"><span><b style="background:var(--red)"></b>Cut ${esc(n(a.cut))} (${esc(pct(a.cut, tot))})</span><span><b style="background:var(--blue)"></b>Spend more ${esc(n(a.scale))} (${esc(pct(a.scale, tot))})</span><span><b style="background:var(--wait)"></b>Keep testing ${esc(n(a.test))} (${esc(pct(a.test, tot))})</span></div>
        <p class="note">${esc(n(a.subreddits_total))} subreddits across ${esc(n(a.runs))} audits of real files.</p>` : '<p class="empty">No audits of real files yet.</p>';
    $("auditstats").innerHTML = `<table>
      <tr><td>Audits of real files</td><td class="n">${esc(n(a.runs))}</td></tr>
      <tr><td>Median / p95 compute time</td><td class="n">${esc(ms(a.ms_p50))} / ${esc(ms(a.ms_p95))}</td></tr>
      <tr><td>Set their own target</td><td class="n">${esc(n(a.with_target))} (${esc(pct(a.with_target, a.runs))})</td></tr>
      <tr><td>Showed a data warning</td><td class="n">${esc(n(a.with_warnings))} (${esc(pct(a.with_warnings, a.runs))})</td></tr>
      <tr><td>Needed a column picked by hand</td><td class="n">${esc(n(a.cols_not_auto))} (${esc(pct(a.cols_not_auto, a.runs))})</td></tr>
      <tr><td>Sample audits</td><td class="n">${esc(n(k.audits_sample))}</td></tr></table>`;
    barChart("c-subs", d.subs_hist.map((x) => ({ k: x.k, v: x.n, label: `${x.k} subreddits` })));
    barChart("c-spend", d.spend_bands.map((x) => ({ k: x.k, v: x.n, label: `$${x.k} in the file` })), n, "--s2");
    table("t-cols", d.col_changes, [{ k: "k", l: "Column" }, { k: "n", l: "Times", f: n }], { empty: "Auto-detection hasn't missed yet." });

    // AI
    $("ai-bucket").textContent = d.bucket;
    const cacheRate = ai.requests ? pct(ai.cache_hits, ai.model_calls + ai.cache_hits) : "–";
    $("ai-kpis").innerHTML = [
      ["Requests", n(ai.requests)], ["Model calls", n(ai.model_calls)], ["Cache hit rate", cacheRate], ["Latency p50 / p95", `${ms(ai.ms_p50)} / ${ms(ai.ms_p95)}`],
      ["Spend in range", usd(ai.cost)], ["Cost per model call", ai.model_calls ? usd(ai.cost / ai.model_calls) : "–"],
      ["Tokens in (cached / new)", `${n(ai.hit_tokens)} / ${n(ai.miss_tokens)}`], ["Tokens out", n(ai.out_tokens)],
      ["With product text", `${n(ai.with_product)} (${pct(ai.with_product, ai.requests)})`], ["Answer cache", `${n(ai.cache_rows)} saved, ${n(ai.cache_served)} served`],
    ].map(([l, v]) => `<div class="card kpi"><div class="l">${esc(l)}</div><div class="v" style="font-size:22px">${esc(v)}</div></div>`).join("");
    barChart("c-cost", d.series.map((s) => ({ k: bucketLabel(s.t), label: bucketLabel(s.t, true), v: s.ai_cost, extra: `${n(s.ai_calls)} model calls, ${n(s.plans)} plans` })), usd, "--s3");
    table("t-ai-out", ai.outcomes, [{ k: "k", l: "Outcome" }, { k: "n", l: "Requests", f: n }]);

    renderBilling(d.billing);

    // Errors
    table("t-aerr", d.audit_errors, [{ k: "k", l: "Stage" }, { k: "n", l: "Count", f: n }, { k: "sessions", l: "Sessions", f: n }, { k: "last", l: "Last", f: (v) => fmtTime(v) }], { empty: "No audit errors." });
    if (d.audit_errors.length) {
      $("t-aerr").insertAdjacentHTML("beforeend", d.audit_errors.map((e) => `<p class="note"><strong>${esc(e.k)}</strong>, latest payload:</p><pre>${esc(JSON.stringify(e.example, null, 1))}</pre>`).join(""));
    }
    table("t-jserr", d.js_errors, [{ k: "k", l: "Message" }, { k: "n", l: "Count", f: n }, { k: "sessions", l: "Sessions", f: n }, { k: "at", l: "Where", f: (v, r) => `${v || "?"} ${r.path || ""}` }, { k: "last", l: "Last", f: (v) => fmtTime(v) }], { empty: "No JavaScript errors." });

    // Logs
    const types = [...new Set(d.log_events.map((e) => e.type))].sort();
    const sel = $("lf-type"), cur = sel.value;
    sel.innerHTML = `<option value="">All types (${esc(n(d.log_events.length))})</option>` + types.map((t) => `<option ${t === cur ? "selected" : ""}>${esc(t)}</option>`).join("");
    const outs = [...new Set(d.log_ai.map((e) => e.outcome))].sort(), aSel = $("af-out"), aCur = aSel.value;
    aSel.innerHTML = `<option value="">All outcomes (${esc(n(d.log_ai.length))})</option>` + outs.map((t) => `<option ${t === aCur ? "selected" : ""}>${esc(t)}</option>`).join("");
    renderLog(); renderAiLog();
    $("foot").textContent = `All time: ${n(d.totals_all_time.events)} events since ${d.totals_all_time.first_event ? fmtFull(d.totals_all_time.first_event) : "–"}, ${n(d.totals_all_time.ai_requests)} AI requests. Visitor IDs are daily hashes; the same person on two days counts twice.`;
  }

  const typeTag = (t) => {
    const cls = /error/.test(t) ? "err" : /audit_run|plan_request|download|calc_used/.test(t) ? "good" : /pageview|leave/.test(t) ? "" : "act";
    return `<span class="tag ${cls}">${esc(t)}</span>`;
  };
  const summary = (e) => {
    const p = e.props || {};
    switch (e.type) {
      case "pageview": return `${p.title || ""}${p.load_ms ? ` · ${p.load_ms} ms load` : ""}`;
      case "audit_run": return `${p.source} · ${p.subs} subs · cut ${p.cut} / more ${p.scale} / test ${p.test} · ${p.spend_band || ""} · ${p.ms} ms${p.auto_cols === false ? " · manual cols" : ""}`;
      case "audit_error": return `${p.stage}${p.missing ? ` · missing ${p.missing.join(", ")}` : ""}${p.msg ? ` · ${p.msg}` : ""}${p.ext ? ` · .${p.ext}` : ""}`;
      case "plan_request": return `${p.outcome}${p.ms ? ` · ${p.ms} ms` : ""}${p.has_product ? " · with product" : ""}`;
      case "js_error": return `${p.msg} (${p.src}:${p.line})`;
      case "leave": return `${p.secs} s · ${p.scroll}% scrolled`;
      case "outbound": return p.href || p.host;
      default: return Object.keys(p).length ? JSON.stringify(p) : "";
    }
  };

  function filteredLog() {
    const t = $("lf-type").value, q = $("lf-q").value.trim().toLowerCase();
    return data.log_events.filter((e) => (!t || e.type === t) && (!sidFilter || e.sid === sidFilter) &&
      (!q || [e.path, e.ref, e.sid, e.vid, e.country, e.browser, e.os, e.utm_source, e.utm_campaign, JSON.stringify(e.props)].join(" ").toLowerCase().includes(q)));
  }

  // Revenue & credits. data.billing is missing until the backend migration is deployed, so guard everything.
  function renderBilling(b) {
    $("rev-none").hidden = !!b; $("rev-body").hidden = !b;
    if (!b || typeof b !== "object") return;
    const money = (v) => `$${(+v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    $("rev-kpis").innerHTML = [
      ["Revenue", money(b.revenue_usd)], ["Paid orders", n(b.orders_paid)], ["Pending orders", n(b.orders_pending)], ["Active keys", n(b.keys_active)],
      ["Credits sold", n(b.credits_sold)], ["Credits used", n(b.credits_used)], ["Paid plans", n(b.paid_plans)], ["API calls", n(b.api_calls)],
    ].map(([l, v]) => `<div class="card kpi"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div></div>`).join("");
    const used = +b.free_budget_today_usd || 0, lim = +b.free_budget_limit_usd || 0;
    const ratio = lim > 0 ? used / lim : 0, w = Math.min(100, ratio * 100);
    const cls = ratio >= 1 ? "full" : ratio >= 0.8 ? "hot" : "";
    $("rev-meter").innerHTML = `<div class="meter ${cls}" role="meter" aria-valuemin="0" aria-valuemax="${esc(lim)}" aria-valuenow="${esc(used)}" aria-label="Free budget used today"><i style="width:${w.toFixed(1)}%"></i></div>
      <p class="note" style="margin:0"><strong>${esc(usd(used))} of ${esc(usd(lim))}</strong> used (${esc(lim > 0 ? Math.round(ratio * 100) : 0)}%), ${esc(n(b.free_plans_today))} free ${b.free_plans_today === 1 ? "plan" : "plans"} today.${ratio >= 1 ? " Free plans are paused until midnight UTC." : ""}</p>`;
    const orders = b.recent_orders || [];
    $("t-orders").innerHTML = orders.length ? `<div class="scroll"><table><tr><th>When</th><th>Pack</th><th>Via</th><th class="n">USD</th><th class="n">Credits</th><th>Status</th></tr>${orders.map((o) => `<tr>
      <td>${esc(o.created_at ? fmtTime(o.created_at) : "")}</td><td>${esc(o.pack)}</td><td>${esc(o.provider)}</td><td class="n">${esc(o.amount_usd == null ? "–" : money(o.amount_usd))}</td><td class="n">${esc(n(o.credits))}</td>
      <td><span class="st ${esc(/^(paid|failed|refunded|pending)$/.test(o.status) ? o.status : "")}">${esc(o.status)}</span></td></tr>`).join("")}</table></div>` : `<p class="empty">No orders yet.</p>`;
    table("t-apikeys", b.api_by_key, [{ k: "prefix", l: "Key" }, { k: "calls", l: "Calls", f: n }, { k: "credits", l: "Credits", f: n }], { empty: "No API calls in this range." });
  }

  function renderLog() {
    const rows = filteredLog();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    logPage = Math.min(logPage, pages - 1);
    const view = rows.slice(logPage * PAGE, logPage * PAGE + PAGE);
    $("lf-sid").innerHTML = sidFilter ? `Session <code>${esc(sidFilter)}</code> <button class="lnk" id="lf-sid-x">Clear</button>` : "";
    if (sidFilter) $("lf-sid-x").onclick = () => { sidFilter = ""; logPage = 0; renderLog(); };
    $("t-log").innerHTML = `<tr><th>Time</th><th>Event</th><th>Page</th><th>Details</th><th>Session</th><th>From</th><th>Where</th><th>Device</th></tr>` +
      (view.length ? view.map((e, i) => `<tr class="ev" data-i="${logPage * PAGE + i}"><td class="mono" style="white-space:nowrap">${esc(fmtTime(e.ts))}</td><td>${typeTag(e.type)}${e.bot ? ' <span class="tag">bot</span>' : ""}</td>
        <td class="mono">${esc((e.path || "").replace("/subreddit-audit", "") || "/")}</td><td>${esc(summary(e).slice(0, 160))}</td>
        <td><button class="lnk mono sidbtn" data-sid="${esc(e.sid || "")}" style="padding:2px 6px">${esc((e.sid || "–").slice(0, 8))}</button></td>
        <td>${esc(e.ref || e.utm_source || "")}</td><td>${esc(e.country || "")}</td><td>${esc([e.device, e.browser, e.os].filter(Boolean).join(" · "))}</td></tr>`).join("")
        : `<tr><td colspan="8" class="empty">No events match.</td></tr>`);
    $("lp-info").textContent = `${n(rows.length)} events · page ${logPage + 1} of ${pages}`;
    $("lp-prev").disabled = logPage === 0; $("lp-next").disabled = logPage >= pages - 1;
    $("t-log").querySelectorAll(".sidbtn").forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); if (b.dataset.sid) showSession(b.dataset.sid); }));
    $("t-log").querySelectorAll("tr.ev").forEach((tr) => tr.addEventListener("click", () => {
      const e = rows[+tr.dataset.i];
      openDlg(`<h3>${typeTag(e.type)} ${esc(fmtFull(e.ts))}</h3><pre>${esc(JSON.stringify(e, null, 2))}</pre>`);
    }));
  }

  function showSession(sid) {
    const ev = data.log_events.filter((e) => e.sid === sid).sort((a, b) => new Date(a.ts) - new Date(b.ts));
    const first = ev[0], lastE = ev[ev.length - 1];
    const dur = first ? Math.round((new Date(lastE.ts) - new Date(first.ts)) / 1000) : 0;
    openDlg(`<h3>Session <code>${esc(sid)}</code></h3>
      <p class="note">${esc(n(ev.length))} events over ${esc(dur)} s · ${esc([first?.country, first?.device, first?.browser, first?.os].filter(Boolean).join(" · "))} · from ${esc(first?.ref || first?.utm_source || "direct")}</p>
      <div class="scroll"><table><tr><th>Time</th><th>+s</th><th>Event</th><th>Page</th><th>Details</th></tr>${ev.map((e) => `<tr><td class="mono">${esc(fmtTime(e.ts, false))}</td><td class="n">${esc(Math.round((new Date(e.ts) - new Date(first.ts)) / 1000))}</td><td>${typeTag(e.type)}</td><td class="mono">${esc((e.path || "").replace("/subreddit-audit", "") || "/")}</td><td>${esc(summary(e))}</td></tr>`).join("")}</table></div>
      <p style="margin-top:10px"><button class="lnk" id="dlg-filter">Filter the log to this session</button></p>`);
    $("dlg-filter").onclick = () => { sidFilter = sid; logPage = 0; $("dlg").close(); renderLog(); $("s-logs").scrollIntoView(); };
  }

  function renderAiLog() {
    const o = $("af-out").value;
    const rows = data.log_ai.filter((e) => !o || e.outcome === o).slice(0, 300);
    const cls = (x) => (x === "ok" || x === "cache_hit" ? "good" : /limit|bad_input|too_large|origin/.test(x) ? "" : "err");
    $("t-ailog").innerHTML = `<tr><th>Time</th><th>Outcome</th><th class="n">HTTP</th><th class="n">Latency</th><th class="n">Subs</th><th class="n">Tokens in (cached/new)</th><th class="n">Out</th><th class="n">Cost</th><th>Visitor</th><th>Error</th></tr>` +
      (rows.length ? rows.map((e) => `<tr><td class="mono" style="white-space:nowrap">${esc(fmtTime(e.ts))}</td><td><span class="tag ${cls(e.outcome)}">${esc(e.outcome)}</span>${e.has_product ? ' <span class="tag act">product</span>' : ""}</td>
        <td class="n">${esc(e.http ?? "")}</td><td class="n">${esc(ms(e.ms))}</td><td class="n">${esc(e.rows ?? "")}</td>
        <td class="n">${e.hit_tokens != null ? esc(`${n(e.hit_tokens)} / ${n(e.miss_tokens)}`) : ""}</td><td class="n">${e.out_tokens != null ? esc(n(e.out_tokens)) : ""}</td>
        <td class="n">${e.cost_usd != null ? esc(usd(e.cost_usd)) : ""}</td><td class="mono">${esc((e.vid || "").slice(0, 8))}</td><td>${esc(e.error || "")}</td></tr>`).join("")
        : `<tr><td colspan="10" class="empty">No AI requests in this range.</td></tr>`);
  }

  function csv(rows, cols) {
    const q = (v) => { const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n");
  }
  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function openDlg(html) { $("dlg-body").innerHTML = html; $("dlg").showModal(); }

  function lock(msg) {
    key = ""; store.set("sa_admin_key", null); sessionStorage.removeItem("sa_admin_key");
    clearInterval(timer);
    $("app").hidden = true; $("gate").hidden = false;
    $("gate-err").textContent = msg || "";
  }

  function start() {
    $("gate").hidden = true; $("app").hidden = false;
    // Anyone holding the key is the owner: stop counting this browser's visits unless they turn it back on.
    if (store.get("sa_notrack") == null) store.set("sa_notrack", "1");
    $("notrack").checked = store.get("sa_notrack") === "1";
    document.querySelectorAll("#range button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.d === days)));
    load();
    clearInterval(timer);
    timer = setInterval(() => { if ($("auto").checked && !document.hidden) load(); }, 60000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const tzSel = $("tz");
    const list = tzs.includes(tz) ? tzs : [tz, ...tzs];
    tzSel.innerHTML = list.map((z) => `<option ${z === tz ? "selected" : ""}>${esc(z)}</option>`).join("");
    tzSel.addEventListener("change", () => { tz = tzSel.value; store.set("sa_admin_tz", tz); load(); });
    $("gate-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      key = $("gate-key").value.trim();
      $("gate-err").textContent = "Checking…";
      try {
        data = await fetchDash();
        if ($("gate-remember").checked) store.set("sa_admin_key", key); else sessionStorage.setItem("sa_admin_key", key);
        $("gate-key").value = ""; $("gate-err").textContent = "";
        start();
      } catch (err) { lock(err.auth ? "That key doesn't work." : err.message); }
    });
    document.querySelectorAll("#range button").forEach((b) => b.addEventListener("click", () => {
      days = +b.dataset.d; store.set("sa_admin_days", String(days));
      document.querySelectorAll("#range button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      logPage = 0; load();
    }));
    $("bots").addEventListener("change", load);
    $("refresh").addEventListener("click", load);
    $("logout").addEventListener("click", () => lock("Locked."));
    $("notrack").addEventListener("change", (e) => store.set("sa_notrack", e.target.checked ? "1" : "0"));
    $("lf-type").addEventListener("change", () => { logPage = 0; renderLog(); });
    let qt; $("lf-q").addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(() => { logPage = 0; renderLog(); }, 200); });
    $("lp-prev").addEventListener("click", () => { logPage--; renderLog(); });
    $("lp-next").addEventListener("click", () => { logPage++; renderLog(); });
    $("af-out").addEventListener("change", renderAiLog);
    $("lf-csv").addEventListener("click", () => download(`events-${days}d.csv`, csv(filteredLog(), ["ts", "type", "path", "ref", "utm_source", "utm_medium", "utm_campaign", "sid", "vid", "country", "device", "browser", "os", "lang", "sw", "bot", "props"])));
    $("af-csv").addEventListener("click", () => download(`ai-log-${days}d.csv`, csv(data.log_ai, ["ts", "outcome", "http", "ms", "rows", "has_product", "hit_tokens", "miss_tokens", "out_tokens", "cost_usd", "model", "prompt_version", "vid", "error"])));
    $("dlg-close").addEventListener("click", () => $("dlg").close());
    let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (data && !$("app").hidden) render(); }, 200); });
    if (key) start(); else lock();
  });
})();
