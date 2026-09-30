// Reddit Ads test calculator: is one subreddit's result a signal or noise?
// If the subreddit were exactly at target, conversions ~ Poisson(spend / target).
(() => {
  function poissonCdf(k, lam) {
    let term = Math.exp(-lam), sum = term;
    for (let i = 1; i <= k; i++) { term *= lam / i; sum += term; }
    return Math.min(sum, 1);
  }
  // Smallest lambda with P(X <= k) <= 0.1  (k=0 -> 2.303, 1 -> 3.890, 2 -> 5.322 ...)
  function cutMultiple(k) {
    let lo = 0, hi = 100;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (poissonCdf(k, m) > 0.1) lo = m; else hi = m; }
    return hi;
  }
  function judge(target, spend, conv) {
    const lam = spend / target;
    if (poissonCdf(conv, lam) <= 0.1) return "cut";
    if (conv > 0 && 1 - poissonCdf(conv - 1, lam) <= 0.1) return "scale";
    return "test";
  }
  const api = { poissonCdf, cutMultiple, judge };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    if (require.main === module) {
      const assert = require("assert");
      [2.303, 3.89, 5.322, 6.681, 7.994, 9.275].forEach((v, k) => assert(Math.abs(cutMultiple(k) - v) < 0.002, k)); // scipy values
      assert.strictEqual(judge(80, 185, 0), "cut");
      assert.strictEqual(judge(80, 180, 0), "test");
      assert.strictEqual(judge(80, 400, 12), "scale");
      console.log("calc.js self-check OK");
    }
    return;
  }

  const $ = (id) => document.getElementById(id);
  const money = (v) => "$" + (v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(0));
  function update() {
    const target = parseFloat($("c-target").value), spend = parseFloat($("c-spend").value), conv = parseInt($("c-conv").value, 10);
    const out = $("c-verdict"), why = $("c-why"), next = $("c-next");
    if (!(target > 0) || !(spend >= 0) || !(conv >= 0)) {
      out.textContent = "Fill in all three"; out.className = "verdict test"; why.textContent = ""; next.textContent = ""; return;
    }
    const v = judge(target, spend, conv);
    const expected = spend / target;
    const cutAt = cutMultiple(conv) * target;
    out.className = "verdict " + v;
    out.textContent = { cut: "Cut it", scale: "Spend more", test: "Keep testing" }[v];
    why.textContent = `At your ${money(target)} target, ${money(spend)} of spend should have produced about ${expected.toFixed(1)} conversions. You have ${conv}.`;
    next.textContent = v === "cut"
      ? `There's less than a 10% chance this subreddit is really hitting ${money(target)} per conversion.`
      : v === "scale"
        ? `There's less than a 10% chance a subreddit only at target would do this well. Give it more budget.`
        : spend < cutAt
          ? `If it reaches ${money(cutAt)} of spend with ${conv === 0 ? "still no conversions" : `still only ${conv} conversion${conv === 1 ? "" : "s"}`}, cut it.`
          : `Not clear either way yet. Check again after another ${money(target)} of spend.`;
  }
  document.addEventListener("DOMContentLoaded", () => {
    ["c-target", "c-spend", "c-conv"].forEach((id) => $(id).addEventListener("input", update));
    let used = false; // one usage event per page view for the admin dashboard
    ["c-target", "c-spend", "c-conv"].forEach((id) => $(id).addEventListener("change", () => { if (!used) { used = true; window.saTrack?.("calc_used"); } }));
    update();
  });
})();
