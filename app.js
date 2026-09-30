// Home page: CSV intake, results ledger, scroll story.
(() => {
  const WAITLIST_URL = ""; // e.g. a Tally or Google Form link; the button stays hidden until set
  const PLAN_URL = "https://mpalkhuqlmfxypfifitr.supabase.co/functions/v1/explain";
  const BILLING_URL = "https://mpalkhuqlmfxypfifitr.supabase.co/functions/v1/billing";
  const ROOT = "/subreddit-audit/"; // matches build.py
  const KEY_RE = /^sa_live_[0-9a-f]{32}$/;
  const PLAN_CREDITS = 10; // one plan costs 10 credits (contract 3.2)
  const PLAN_ERRORS = {
    ip_limit: "That's 5 plans this hour. Try again in an hour.",
    daily_limit: "Today's free plans have all been used. Try again tomorrow.",
    bad_input: "These results couldn't be read. Subreddit names need to look like r/name.",
  };
  const store = { // localStorage can throw (private windows, blocked storage); the site works without it
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };
  const planCache = new Map(); // same results + same product text in this tab => no second request
  const A = window.SubredditAudit;
  const $ = (id) => document.getElementById(id);
  const money = (v) => !isFinite(v) ? "unknown" : "$" + (v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(v < 100 ? 2 : 0));
  const LABEL = { cut: "Cut", scale: "Spend more", "keep testing": "Keep testing", "no clicks": "No clicks" };
  const KLASS = { cut: "cut", scale: "scale", "keep testing": "test", "no clicks": "test" };

  const SAMPLE = `Community,Amount Spent (USD),Impressions,Clicks,Conversions
r/SaaS,"$1,500.50",110000,1000,5
r/marketing,$700.00,61000,520,4
r/freelance,$820.00,58000,540,19
r/accounting,$610.00,41000,380,3
r/startups,$450.00,30000,300,15
r/smallbusiness,$375.00,25000,250,9
r/sidehustle,$290.00,24000,210,2
r/Bookkeeping,$180.00,12000,110,6
r/webdev,$140.00,11000,95,0
r/consulting,$95.00,6000,60,2
r/digitalnomad,$45.00,3100,30,0
r/Entrepreneur,$6.00,500,4,0`;

  let parsed = null, cols = null, last = null, autoCols = true, targetLogged = false;
  const showError = (msg) => { $("error").textContent = msg || ""; };
  const logEvent = (name) => window.goatcounter?.count?.({ path: name, event: true }); // GoatCounter event; no report data sent
  // First-party log for the admin dashboard (track.js): counts, bands and error codes, never subreddit names, amounts or the file.
  const track = (type, props) => window.saTrack?.(type, props);
  const spendBand = (v) => (v < 1000 ? "<1k" : v < 10000 ? "1k-10k" : v < 100000 ? "10k-100k" : "100k+");
  const auditProps = (source, ms) => {
    const n = (v) => last.rows.filter((r) => r.verdict === v).length;
    return { source, subs: last.rows.length, rows: parsed.rows.length, cut: n("cut"), scale: n("scale"),
      test: last.rows.length - n("cut") - n("scale"), warn: last.warnings.length, target: !!$("target").value,
      auto_cols: autoCols, ms: Math.round(ms), spend_band: spendBand(last.spend) };
  };

  function load(text, source) {
    showError("");
    const t = performance.now();
    parsed = A.parseCSV(text);
    $("cols").hidden = true;
    $("results").hidden = true;
    autoCols = true; targetLogged = false;
    if (!parsed.headers.length || !parsed.rows.length) {
      track("audit_error", { stage: "empty", source, headers: parsed.headers.length });
      return showError("That file looks empty. Export the report again from Reddit Ads Manager and check it has rows.");
    }
    cols = A.detectColumns(parsed.headers);
    renderColumnPicker();
    const ok = run(source);
    if (ok) {
      logEvent(source === "sample" ? "audit-sample" : "audit-own-file");
      track("audit_run", auditProps(source, performance.now() - t));
    }
    return ok;
  }

  function renderColumnPicker() {
    const names = { subreddit: "Subreddit", spend: "Spend", clicks: "Clicks", conversions: "Conversions" };
    const grid = $("cols-grid");
    grid.innerHTML = "";
    for (const key of Object.keys(names)) {
      const lab = document.createElement("label");
      lab.append(names[key]);
      const sel = document.createElement("select");
      sel.add(new Option("Choose a column", ""));
      parsed.headers.forEach((h) => sel.add(new Option(h, h, false, h === cols[key])));
      sel.addEventListener("change", () => { cols[key] = sel.value || null; autoCols = false; track("col_change", { field: key }); updateSummary(); run(); });
      lab.appendChild(sel);
      grid.appendChild(lab);
    }
    $("cols").hidden = false;
    updateSummary();
  }

  function updateSummary() {
    const missing = Object.entries(cols).filter(([, v]) => !v).map(([k]) => k);
    $("cols-summary").textContent = missing.length
      ? `Pick the ${missing.join(" and ")} column${missing.length > 1 ? "s" : ""}`
      : `Reading ${cols.subreddit}, ${cols.spend}, ${cols.clicks}, ${cols.conversions}. Change`;
    if (missing.length) $("cols").open = true;
  }

  function run(source) {
    const missing = Object.entries(cols).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
      $("results").hidden = true;
      // Column names (not values) help improve auto-detection for new export formats.
      if (source) track("audit_error", { stage: "missing_columns", source, missing, headers: parsed.headers.slice(0, 20).map((h) => String(h).slice(0, 40)) });
      showError(`Couldn't find a ${missing.join(" or ")} column in this file. Choose it from the column list above.`);
      return false;
    }
    try {
      const t = parseFloat($("target").value);
      last = A.audit(A.aggregate(parsed, cols), { targetCpa: t > 0 ? t : null });
      showError("");
      render(last);
      return true;
    } catch (e) {
      $("results").hidden = true;
      track("audit_error", { stage: "model", source: source || "rerun", msg: String(e.message).slice(0, 200) });
      showError(e.message);
      return false;
    }
  }

  function render(res) {
    const { rows, target } = res;
    const cut = rows.filter((r) => r.verdict === "cut");
    const scale = rows.filter((r) => r.verdict === "scale");
    const test = rows.length - cut.length - scale.length;
    const cutSpend = cut.reduce((s, r) => s + r.spend, 0);
    const excess = cut.reduce((s, r) => s + r.excess, 0);
    const tNote = $("target").value ? `your ${money(target)} target` : `your ${money(target)} account average`;
    const s = (n, one, many) => (n === 1 ? one : many);

    $("headline").textContent = cut.length
      ? `Cut ${cut.length} ${s(cut.length, "subreddit", "subreddits")}. ${s(cut.length, "It", "They")} took ${money(cutSpend)}, about ${money(excess)} more than ${tNote} allows.`
      : scale.length
        ? `Nothing to cut yet. ${scale.length} ${s(scale.length, "subreddit is", "subreddits are")} clearly beating ${tNote}.`
        : "Nothing is clearly failing or winning yet. Let these run longer before judging.";
    $("subline").textContent = `${rows.length} subreddits, ${money(res.spend)} total spend. Target: ${money(target)} per conversion.`;
    $("counts").innerHTML = `<span class="pill cut">${cut.length} to cut</span><span class="pill scale">${scale.length} to spend more on</span><span class="pill test">${test} need more data</span>`;
    $("warnings").innerHTML = "";
    res.warnings.forEach((w) => { const p = document.createElement("p"); p.className = "warn"; p.textContent = w; $("warnings").appendChild(p); });

    // One log-scale axis shared by every row
    const vals = [target];
    rows.forEach((r) => { if (r.cpaLo) vals.push(r.cpaLo, r.cpaHi); if (isFinite(r.rawCpa)) vals.push(r.rawCpa); });
    const lo = Math.min(...vals) * 0.85, hi = Math.min(Math.max(...vals) * 1.15, target * 25);
    const x = (v) => (Math.min(Math.max((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)), 0), 1) * 100).toFixed(2) + "%";
    const tx = x(target);

    const L = $("ledger");
    L.innerHTML = `<div class="row head"><span>Subreddit</span><span class="n">Spend</span><span class="n">Clicks</span><span class="n">Conv.</span><span>Cost per conversion</span><span>Call</span></div>
      <div class="row head axis-row"><span></span><span></span><span></span><span></span><div class="axis"><span style="left:0;transform:none">${money(lo)}</span><span class="t" style="left:${tx}">${money(target)}</span><span style="left:auto;right:0;transform:none">${money(hi)}</span></div><span></span></div>`;
    for (const r of rows) {
      const row = document.createElement("div");
      row.className = "row " + KLASS[r.verdict];
      const rawTxt = isFinite(r.rawCpa) ? money(r.rawCpa) : "no conversions yet";
      const rawX = isFinite(r.rawCpa) ? x(r.rawCpa) : "100%";
      let track = `<div class="track" role="img"><div class="target" style="left:${tx}"></div>`;
      if (r.cpa) {
        track += `<div class="band" style="left:${x(r.cpaLo)};width:calc(${x(r.cpaHi)} - ${x(r.cpaLo)})"></div>`;
        track += `<div class="raw${isFinite(r.rawCpa) ? "" : " inf"}" style="left:${rawX}"></div><div class="dot" style="left:${x(r.cpa)}"></div>`;
      }
      track += "</div>";
      const recent = r.recentCpa !== undefined ? `, recent ${money(r.recentCpa)}` : ""; // only when rates fell across the report
      row.innerHTML = `<span class="name"></span><span class="n">${money(r.spend)}</span><span class="n">${r.clicks.toLocaleString()}</span><span class="n">${r.conversions}</span>
        <span class="stats">${money(r.spend)} spend, ${r.clicks.toLocaleString()} clicks, ${r.conversions} conv. Dashboard says ${rawTxt}; likely ${r.cpa ? money(r.cpa) : "n/a"}${recent}.</span>
        ${track}
        <span class="tag">${LABEL[r.verdict]}${r.verdict === "cut" ? `<small>~${money(r.excess)} over target</small>` : r.cpa ? `<small>likely ${money(r.cpa)}${recent}</small>` : ""}</span>`;
      row.querySelector(".name").textContent = r.subreddit;
      row.querySelector(".track").setAttribute("aria-label", r.cpa ? `Dashboard: ${rawTxt}. Likely ${money(r.cpaLo)} to ${money(r.cpaHi)}, best estimate ${money(r.cpa)}${recent}.` : "No clicks.");
      L.appendChild(row);
    }
    if (WAITLIST_URL) { $("waitlist").href = WAITLIST_URL; $("waitlist").hidden = false; }
    $("plan-out").replaceChildren();
    $("results").hidden = false;
  }

  function planPayload() {
    const f = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
    return {
      target: f(last.target),
      product: $("plan-product").value.trim().slice(0, 140),
      rows: last.rows.slice(0, 150).map((r) => ({ s: r.subreddit, spend: f(r.spend), clicks: r.clicks, conv: r.conversions,
        raw: f(r.rawCpa), likely: f(r.cpa), lo: f(r.cpaLo), hi: f(r.cpaHi), call: r.verdict, excess: f(r.excess) })),
    };
  }

  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function renderPlan(plan) {
    const out = $("plan-out");
    out.replaceChildren();
    if (plan.summary) out.append(el("p", plan.summary, "plan-summary"));
    if (plan.actions?.length) {
      out.append(el("h3", "What to do this week"));
      const ol = el("ol", null, "plan-actions");
      plan.actions.forEach((a) => { const li = el("li"); li.append(el("strong", a.do), el("span", a.why)); ol.append(li); });
      out.append(ol);
    }
    if (plan.try_next?.length) {
      out.append(el("h3", "Subreddits to test next"));
      const ul = el("ul", null, "plan-next");
      plan.try_next.forEach((t) => {
        const li = el("li");
        const a = el("a", t.subreddit);
        a.href = `https://www.reddit.com/${t.subreddit}/`; a.target = "_blank"; a.rel = "noopener nofollow";
        li.append(a, el("span", t.why));
        ul.append(li);
      });
      out.append(ul, el("p", "Suggestions come from a language model. Check each community before you spend on it.", "plan-fine"));
    }
    const st = statusLine(plan);
    if (st) out.append(st);
  }

  // Small line under a finished plan: what is left on the free tier or on the key.
  function statusLine(d) {
    const p = el("p", null, "plan-status");
    const s = (n, one, many) => (n === 1 ? one : many);
    if (d.credits != null) {
      const plans = Math.floor(d.credits / PLAN_CREDITS);
      p.textContent = `${d.credits.toLocaleString("en-US")} credits left (${plans.toLocaleString("en-US")} ${s(plans, "plan", "plans")}). `;
      p.append(Object.assign(el("a", "Manage key"), { href: ROOT + "account/" }));
    } else if (d.free_left != null) {
      p.textContent = `${d.free_left} free ${s(d.free_left, "plan", "plans")} left. `;
      p.append(Object.assign(el("a", d.free_left ? "Pricing" : "Get more plans"), { href: ROOT + "pricing/" }));
    } else return null;
    return p;
  }

  const money0 = (v) => "$" + (+v % 1 ? (+v).toFixed(2) : String(+v));

  // Inline paywall card. Says why, offers packs and a key box. Never a modal or alert.
  function renderPaywall(reason, d) {
    const savedKey = store.get("sa_key");
    const why = {
      free_limit: `You've used your ${d.limit || 3} free plans for this month. The audit above stays free.`,
      no_credits: `This key has ${(d.credits || 0).toLocaleString("en-US")} credits left. A plan costs ${PLAN_CREDITS}.`,
      bad_key: "That key wasn't recognised. Check it for typos, or remove it to use the free plans.",
      budget: "Today's free plans have all been used up. They reset at midnight UTC.",
    }[reason];
    const card = el("div", null, "paywall");
    card.append(el("h3", "Get more plans"), el("p", why, "paywall-why"));
    const packs = el("div", null, "paywall-packs");
    packs.append(el("p", "Loading prices…", "plan-fine"));
    card.append(packs);

    const keybox = el("form", null, "keybox");
    const lab = el("label", "Have a key?");
    const input = el("input");
    input.type = "text"; input.placeholder = "sa_live_…"; input.autocomplete = "off"; input.spellcheck = false;
    input.setAttribute("aria-label", "Paste your key"); input.setAttribute("autocapitalize", "off");
    if (savedKey && reason === "bad_key") input.value = savedKey;
    const save = el("button", "Save key and retry"); save.type = "submit";
    const msg = el("p", null, "keybox-msg"); msg.setAttribute("role", "status");
    lab.append(input);
    keybox.append(lab, save);
    if (savedKey && reason === "bad_key") {
      const rm = el("button", "Remove key", "lnk"); rm.type = "button";
      rm.addEventListener("click", () => { store.set("sa_key", null); input.value = ""; msg.textContent = "Key removed. Your free plans apply again."; });
      keybox.append(rm);
    }
    keybox.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!KEY_RE.test(v)) { msg.textContent = "That doesn't look like a key. Keys start with sa_live_ and are 40 characters long."; return; }
      store.set("sa_key", v);
      track("key_saved", { via: "paywall" });
      writePlan();
    });
    card.append(keybox, msg);
    $("plan-out").replaceChildren(card);
    track("paywall_shown", { reason });

    fetch(BILLING_URL + "/packs", { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((b) => fillPacks(packs, b), () => packs.replaceChildren(el("p", "Couldn't load prices right now. See the pricing page, or paste a key below.", "plan-fine")));
  }

  function fillPacks(host, b) {
    const m = b.methods || {};
    const list = b.packs || [];
    if (!list.length || (!m.card && !m.crypto)) {
      host.replaceChildren(el("p", "Paid plans open soon. If you already have a key, paste it below.", "plan-fine"));
      return;
    }
    const err = el("p", null, "keybox-msg"); err.setAttribute("role", "alert");
    const wrap = el("div", null, "pack-list");
    for (const pk of list) {
      const box = el("div", null, "pack");
      box.append(el("b", pk.name), el("span", money0(pk.price_usd), "pack-price"),
        el("span", `${pk.credits.toLocaleString("en-US")} credits, ${Math.floor(pk.credits / PLAN_CREDITS)} plans`, "pack-sub"));
      const btns = el("div", null, "pay-btns");
      const add = (method, label, primary) => {
        const b = el("button", label, primary ? "primary" : ""); b.type = "button";
        b.addEventListener("click", () => checkout(pk.code, method, b, err));
        btns.append(b);
      };
      if (m.card) add("card", "Pay by card", true);
      if (m.crypto) add("crypto", "Pay with crypto", !m.card);
      box.append(btns);
      wrap.append(box);
    }
    host.replaceChildren(wrap, err, el("p", "Card payments go through Dodo Payments, crypto through NOWPayments. One key works on the site and in the API.", "plan-fine"));
  }

  async function checkout(pack, method, btn, err) {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "Opening checkout…"; err.textContent = "";
    track("checkout_start", { pack, method });
    try {
      const r = await fetch(BILLING_URL + "/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pack, method }), signal: AbortSignal.timeout(20000) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 503 || d.error === "payments_not_configured") throw new Error("That payment method isn't open yet. Try the other one, or check back soon.");
      if (!r.ok || !d.checkout_url || !d.claim_token) throw new Error("Couldn't start checkout. Nothing was charged. Try again in a moment.");
      store.set("sa_claim", d.claim_token); // account page collects the key with this after payment
      location.href = d.checkout_url;
    } catch (e) {
      err.textContent = e.name === "TypeError" || e.name === "TimeoutError" ? "Couldn't reach checkout. Check your connection and try again." : e.message;
      btn.disabled = false; btn.textContent = label;
    }
  }

  async function writePlan() {
    if (!last) return;
    const key = store.get("sa_key");
    const body = JSON.stringify({ ...planPayload(), ...(key ? { key } : {}) });
    const hasProduct = !!$("plan-product").value.trim();
    if (planCache.has(body)) { track("plan_request", { outcome: "tab_cache", has_product: hasProduct }); return renderPlan(planCache.get(body)); }
    const t = performance.now();
    const btn = $("plan-go");
    btn.disabled = true; btn.textContent = "Writing your plan…";
    $("plan-out").replaceChildren(el("p", "Reading your numbers. This takes a few seconds.", "plan-fine"));
    try {
      const r = await fetch(PLAN_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(60000) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        track("plan_request", { outcome: d.error || `http_${r.status}`, ms: Math.round(performance.now() - t), has_product: hasProduct });
        if (["free_limit", "no_credits", "bad_key", "budget"].includes(d.error)) { renderPaywall(d.error, d); return; }
        throw Object.assign(new Error(PLAN_ERRORS[d.error] || "The plan writer isn't available right now. Your audit above is unaffected."), { logged: true });
      }
      planCache.set(body, d);
      logEvent("plan-written");
      track("plan_request", { outcome: d.cached ? "cached" : "ok", ms: Math.round(performance.now() - t), has_product: hasProduct,
        actions: d.actions?.length || 0, try_next: d.try_next?.length || 0 });
      renderPlan(d);
    } catch (e) {
      const net = e.name === "TimeoutError" || e.name === "TypeError";
      if (!e.logged) track("plan_request", { outcome: net ? (e.name === "TimeoutError" ? "timeout" : "network") : "client_error", ms: Math.round(performance.now() - t), has_product: hasProduct });
      const msg = net ? "Couldn't reach the plan writer. Check your connection and try again." : e.message;
      $("plan-out").replaceChildren(el("p", msg, "error"));
    } finally {
      btn.disabled = false; btn.textContent = "Write my plan";
    }
  }

  function download() {
    if (!last) return;
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const f = (v) => (v == null || !isFinite(v) ? "" : v.toFixed(2));
    const lines = ["subreddit,spend,clicks,conversions,dashboard_cpa,likely_cpa,likely_cpa_low,likely_cpa_high,prob_over_target,call,excess_over_target"];
    for (const r of last.rows) lines.push([esc(r.subreddit), f(r.spend), r.clicks, r.conversions, f(r.rawCpa), f(r.cpa), f(r.cpaLo), f(r.cpaHi), r.pOver != null ? r.pOver.toFixed(3) : "", LABEL[r.verdict], f(r.excess)].join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "subreddit-audit.csv";
    logEvent("results-downloaded");
    track("download", { subs: last.rows.length });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function readFile(f) {
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") {
      track("audit_error", { stage: "not_csv", ext: (f.name.split(".").pop() || "").slice(0, 8).toLowerCase(), kb: Math.round(f.size / 1024) });
      return showError(`"${f.name}" isn't a CSV. In Reddit Ads Manager, use Export on the Reporting page to get one.`);
    }
    const fr = new FileReader();
    fr.onload = () => { if (load(fr.result, "file")) $("results").scrollIntoView({ behavior: "smooth", block: "start" }); };
    fr.onerror = () => { track("audit_error", { stage: "read_fail" }); showError("Couldn't read that file. Try exporting it again."); };
    fr.readAsText(f);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("file").addEventListener("change", (e) => readFile(e.target.files[0]));
    const drop = $("drop");
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); readFile(e.dataTransfer.files[0]); });
    $("sample").addEventListener("click", () => { if (load(SAMPLE, "sample")) $("results").scrollIntoView({ behavior: "smooth", block: "start" }); });
    let typing; // the model takes 0.1-1 s, so re-run once typing pauses rather than on every keystroke
    $("target").addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(() => {
      if (!parsed) return;
      if (!targetLogged) { targetLogged = true; track("target_change"); }
      run();
    }, 300); });
    $("download").addEventListener("click", download);
    $("plan-go").addEventListener("click", writePlan);
    $("story-cta").addEventListener("click", (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); $("file").focus({ preventScroll: true }); });

    // Scroll story: each step that reaches mid-screen switches the sheet to that state.
    const story = $("why");
    const steps = [...story.querySelectorAll(".story-step")];
    let storyDone = false;
    const set = (n) => {
      for (let i = 2; i <= 4; i++) story.classList.toggle("s" + i, n >= i);
      if (n === 4 && !storyDone) { storyDone = true; track("story_complete"); }
    };
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) set(+e.target.dataset.step); });
    }, { rootMargin: "-45% 0px -45% 0px" });
    steps.forEach((s) => io.observe(s));
  });
})();
