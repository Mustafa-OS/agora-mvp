/* Agora v3 — HS & college athlete asset market. Single-file app, no deps. */
(() => {
"use strict";

const DATA = window.AGORA_DATA;
const P = DATA.players;
const LISTED = P.filter(p => p.price != null);
const byId = Object.fromEntries(P.map(p => [p.id, p]));
const W_DEFAULT = DATA.weights;
const DIMS = [
  ["production", "Production"], ["availability", "Availability"],
  ["recruiting", "Recruiting"], ["audience", "Audience"],
  ["commercial", "Commercial"], ["runway", "Runway"],
];
const $ = sel => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/* ---------- formatting ---------- */
const money = v =>
  "$" + v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 0 : v >= 20 ? 1 : 2 });
const compact = v => {
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(0) + "M";
  return "$" + Math.round(v).toLocaleString();
};
const kfmt = k => (k >= 1000 ? (k / 1000).toFixed(1) + "M" : Math.round(k) + "K");
const pct = (v, digits = 1) => (v >= 0 ? "+" : "") + v.toFixed(digits) + "%";
const arrow = v => (Math.abs(v) < 0.05 ? "—" : v >= 0 ? "▲" : "▼");
const initials = name => name.split(" ").map(w => w[0]).slice(0, 2).join("");
const SHARES_OUT = 1e5; // notional float per athlete
const scoreColor = s => (s >= 85 ? "#0062FF" : s >= 70 ? "#22c55e" : s >= 60 ? "#E5B84B" : "#8B93A1");
const scoreLabel = s => (s >= 85 ? "Elite" : s >= 75 ? "Premium" : s >= 65 ? "Strong" : s >= 55 ? "Developing" : "Emerging");

/* ================================================================
   Market layer — the engine SUGGESTS a fair value; the market sets
   the traded price. Deterministic per-athlete sentiment; your trades
   overwrite the last-traded price in this browser.
   ================================================================ */
function sentiment(id) {
  const x = Math.sin(id * 12.9898) * 43758.5453;
  return ((x - Math.floor(x)) - 0.45) * 0.16;
}
const marketStore = {
  read() { try { return JSON.parse(localStorage.getItem("agora_market_v3")) || {}; } catch { return {}; } },
  write(v) { localStorage.setItem("agora_market_v3", JSON.stringify(v)); },
  setLastTrade(key, price) { const m = this.read(); m[key] = +(+price).toFixed(2); this.write(m); },
};
const fairValue = p => p.price;
const lastTrade = p => {
  const m = marketStore.read();
  return m[p.id] ?? +(p.price * (1 + sentiment(p.id))).toFixed(2);
};
const premium = p => (lastTrade(p) / fairValue(p) - 1) * 100;
const premChip = p => {
  const pr = premium(p);
  const cls = Math.abs(pr) < 0.5 ? "" : pr > 0 ? "pos" : "neg";
  const label = Math.abs(pr) < 0.5 ? "at fair value"
    : Math.abs(pr).toFixed(0) + "% " + (pr > 0 ? "above" : "below") + " fair value";
  return el("span", "fv-chip " + cls, label);
};

/* ================================================================
   Token ledger — every trade is a token transfer recorded on a
   hash-chained ledger (real SHA-256 via WebCrypto). Simulated
   settlement layer: same structure as a public-chain deployment.
   ================================================================ */
const ledger = {
  read() { try { return JSON.parse(localStorage.getItem("agora_ledger_v1")) || []; } catch { return []; } },
  write(v) { localStorage.setItem("agora_ledger_v1", JSON.stringify(v)); },
  async hashBlock(b) {
    const payload = JSON.stringify({ i: b.i, ts: b.ts, txs: b.txs, prev: b.prev });
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, "0")).join("");
  },
  async ensureGenesis() {
    let chain = this.read();
    if (!chain.length) {
      const g = { i: 0, ts: Date.now(), prev: "0".repeat(64),
                  txs: [{ type: "GENESIS", note: "Agora settlement ledger initialized" }] };
      g.hash = await this.hashBlock(g);
      chain = [g];
      this.write(chain);
    }
    return chain;
  },
  async record(tx) {
    const chain = await this.ensureGenesis();
    const prev = chain[chain.length - 1];
    const b = { i: prev.i + 1, ts: Date.now(), prev: prev.hash, txs: [tx] };
    b.hash = await this.hashBlock(b);
    chain.push(b);
    this.write(chain);
    return b.hash;
  },
  async verify() {
    const chain = await this.ensureGenesis();
    for (let i = 0; i < chain.length; i++) {
      const b = chain[i];
      if (await this.hashBlock(b) !== b.hash) return { ok: false, at: i, reason: "hash mismatch" };
      if (i > 0 && b.prev !== chain[i - 1].hash) return { ok: false, at: i, reason: "broken link" };
    }
    return { ok: true, blocks: chain.length };
  },
  clear() { localStorage.removeItem("agora_ledger_v1"); },
};
const shortHash = h => h.slice(0, 6) + "…" + h.slice(-4);

/* ---------- baskets ---------- */
const BASKETS = [
  { key: "DUKE", group: "Flagship", name: "By School — Duke Basket",
    desc: "Both Blue Devils, one unit — program equity, literally.", filter: p => p.school === "Duke" },
  { key: "HS27", group: "Flagship", name: "By Class — HS Class of 2027",
    desc: "Every listable senior in the class — own the whole recruiting cycle.", filter: p => p.cls === "HS Class of 2027" },
  { key: "GUARD", group: "Flagship", name: "By Position — Guards Index",
    desc: "Every listed point and shooting guard on the board.", filter: p => p.pos === "PG" || p.pos === "SG" },
  { key: "FRESH", group: "By class", name: "College Freshmen",
    desc: "The 2026 draft board — first-year college stars.", filter: p => p.level === "College" && p.cls === "Freshman" },
  { key: "VETS", group: "By class", name: "Upperclassmen",
    desc: "Juniors and seniors — proven, near-term production.", filter: p => p.cls === "Junior" || p.cls === "Senior" },
  { key: "KYP", group: "By school", name: "Kentucky Pipeline",
    desc: "The commonwealth's board — Lexington and Louisville.", filter: p => p.state === "KY" },
  { key: "FLP", group: "By school", name: "Florida Preps",
    desc: "The nation's deepest prep pipeline, one unit.", filter: p => p.state === "FL" },
  { key: "WING", group: "By position", name: "Wings Index",
    desc: "The forwards — two-way versatility.", filter: p => p.pos === "SF" },
  { key: "BIGS", group: "By position", name: "Bigs Index",
    desc: "Power forwards and centers — interior force.", filter: p => p.pos === "PF" || p.pos === "C" },
  { key: "CIDX", group: "By level", name: "College Index",
    desc: "Every listed college athlete, equal weight.", filter: p => p.level === "College" },
  { key: "HIDX", group: "By level", name: "High School Index",
    desc: "Every listable prep athlete, equal weight.", filter: p => p.level === "High School" },
];
const basketMembers = b => LISTED.filter(b.filter);
const basketPrice = b => { const m = basketMembers(b); return m.reduce((a, p) => a + lastTrade(p), 0) / m.length; };
const basketFair = b => { const m = basketMembers(b); return m.reduce((a, p) => a + fairValue(p), 0) / m.length; };
const byBasket = Object.fromEntries(BASKETS.map(b => [b.key, b]));

/* ---------- portfolio store (trade ledger, avg-cost) ---------- */
const store = {
  read() {
    try {
      const v = JSON.parse(localStorage.getItem("agora_portfolio_v3"));
      if (v && Array.isArray(v.trades)) return v;
    } catch { /* fresh */ }
    return { trades: [] };
  },
  write(v) { localStorage.setItem("agora_portfolio_v3", JSON.stringify(v)); refreshBadge(); },
  trade(t) { const v = this.read(); v.trades.push(t); this.write(v); },
  clear() { this.write({ trades: [] }); },
  positions() {
    const pos = {};
    let realized = 0;
    this.read().trades.forEach(t => {
      const key = t.type + ":" + t.id;
      const p = pos[key] || (pos[key] = { type: t.type, id: t.id, shares: 0, cost: 0 });
      if (t.kind === "buy") { p.shares += t.shares; p.cost += t.shares * t.price; }
      else {
        const q = Math.min(t.shares, p.shares);
        if (p.shares > 0) {
          const avg = p.cost / p.shares;
          realized += (t.price - avg) * q;
          p.cost -= avg * q; p.shares -= q;
        }
      }
    });
    return { list: Object.values(pos).filter(p => p.shares > 1e-6), realized };
  },
  owned(type, id) {
    return this.positions().list.find(p => p.type === type && p.id === id) || { shares: 0, cost: 0 };
  },
};
function refreshBadge() {
  const n = store.positions().list.length;
  const b = $("#portfolioCount");
  if (!b) return;
  b.hidden = n === 0;
  b.textContent = n;
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ================================================================
   SVG chart builder (line/area with crosshair + tooltip)
   ================================================================ */
function buildChart(container, series, opts = {}) {
  const W = 960, H = opts.height || 300;
  const M = { l: 56, r: 20, t: 14, b: 30 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const allPts = series.flatMap(s => s.pts);
  const x0 = Math.min(...allPts.map(p => p[0])), x1 = Math.max(...allPts.map(p => p[0]));
  let y1 = Math.max(...allPts.map(p => p[1])) * 1.06;
  let y0 = opts.zeroBase ? 0 : Math.min(...allPts.map(p => p[1])) * 0.92;
  if (y1 - y0 < 1e-9) y1 += 1;
  const X = t => M.l + ((t - x0) / (x1 - x0 || 1)) * iw;
  const Y = v => M.t + ih - ((v - y0) / (y1 - y0)) * ih;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", opts.ariaLabel || "Price chart");
  const add = (parent, tag, attrs) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    parent.appendChild(n);
    return n;
  };
  const span = y1 - y0;
  const mag = Math.pow(10, Math.floor(Math.log10(span / 4)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= 5.5) || 10 * mag;
  const yFmt = opts.yFmt || (v => "$" + Math.round(v).toLocaleString());
  for (let v = Math.ceil(y0 / step) * step; v <= y1 + 1e-9; v += step) {
    add(svg, "line", { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v), stroke: "#E7EAF1", "stroke-width": 1 });
    const t = add(svg, "text", { x: M.l - 8, y: Y(v) + 4, "text-anchor": "end", fill: "#8A94A2", "font-size": 11 });
    t.textContent = yFmt(v);
    t.style.fontVariantNumeric = "tabular-nums";
  }
  add(svg, "line", { x1: M.l, x2: W - M.r, y1: Y(y0), y2: Y(y0), stroke: "#C9CFDA", "stroke-width": 1 });
  series.forEach((s, si) => {
    const d = s.pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join(" ");
    if (si === 0 && opts.area !== false) {
      const last = s.pts[s.pts.length - 1], first = s.pts[0];
      add(svg, "path", { d: d + ` L ${X(last[0]).toFixed(1)} ${Y(y0)} L ${X(first[0]).toFixed(1)} ${Y(y0)} Z`, fill: s.color, opacity: 0.1 });
    }
    add(svg, "path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" });
    const last = s.pts[s.pts.length - 1];
    add(svg, "circle", { cx: X(last[0]), cy: Y(last[1]), r: 4.5, fill: s.color, stroke: "#FFFFFF", "stroke-width": 2 });
  });
  // news-event markers (violet diamonds on the primary series)
  const anns = (opts.annotations || []).map(a => {
    const pt = series[0].pts.reduce((b, p) => Math.abs(p[0] - a.x) < Math.abs(b[0] - a.x) ? p : b);
    return { ...a, px: X(pt[0]), py: Y(pt[1]) };
  });
  anns.forEach(a => {
    add(svg, "rect", { x: a.px - 4.5, y: a.py - 4.5, width: 9, height: 9,
      transform: `rotate(45 ${a.px} ${a.py})`, fill: "#7C3AED", stroke: "#FFFFFF", "stroke-width": 1.5 });
  });
  const cross = add(svg, "line", { y1: M.t, y2: M.t + ih, stroke: "#C9CFDA", "stroke-width": 1, opacity: 0 });
  const dots = series.map(s => add(svg, "circle", { r: 4, fill: s.color, stroke: "#FFFFFF", "stroke-width": 2, opacity: 0 }));
  const hit = add(svg, "rect", { x: M.l, y: M.t, width: iw, height: ih, fill: "transparent" });
  const prim = series[0].pts;
  const tooltip = $("#tooltip");
  function showAt(idx, cx, cy) {
    const t = prim[idx][0];
    cross.setAttribute("x1", X(t)); cross.setAttribute("x2", X(t));
    cross.setAttribute("opacity", 1);
    series.forEach((s, si) => {
      let best = 0, bd = Infinity;
      s.pts.forEach((p, i) => { const d = Math.abs(p[0] - t); if (d < bd) { bd = d; best = i; } });
      dots[si].setAttribute("cx", X(s.pts[best][0]));
      dots[si].setAttribute("cy", Y(s.pts[best][1]));
      dots[si].setAttribute("opacity", 1);
      s._hv = s.pts[best][1];
    });
    tooltip.replaceChildren();
    if (opts.tooltipTitle) tooltip.appendChild(el("div", "tt-title", opts.tooltipTitle));
    series.forEach(s => {
      const r = el("div", "tt-row");
      const key = el("i"); key.style.borderTopColor = s.color;
      r.appendChild(key);
      r.appendChild(el("span", "tt-val", yFmt(s._hv)));
      r.appendChild(el("span", null, s.name));
      tooltip.appendChild(r);
    });
    const near = (opts.annotations || []).find(a => Math.abs(a.x - t) <= (x1 - x0) / 90);
    if (near) tooltip.appendChild(el("div", "tt-news", "📰 " + near.label));
    tooltip.hidden = false;
    const pad = 14, tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let tx = cx + pad, ty = cy - th - pad;
    if (tx + tw > innerWidth - 8) tx = cx - tw - pad;
    if (ty < 8) ty = cy + pad;
    tooltip.style.left = tx + "px";
    tooltip.style.top = ty + "px";
  }
  const hide = () => {
    cross.setAttribute("opacity", 0);
    dots.forEach(d => d.setAttribute("opacity", 0));
    tooltip.hidden = true;
  };
  hit.addEventListener("pointermove", e => {
    const r = svg.getBoundingClientRect();
    const t = x0 + ((e.clientX - r.left) / r.width * W - M.l) / iw * (x1 - x0);
    let best = 0, bd = Infinity;
    prim.forEach((p, i) => { const d = Math.abs(p[0] - t); if (d < bd) { bd = d; best = i; } });
    showAt(best, e.clientX, e.clientY);
  });
  hit.addEventListener("pointerleave", hide);
  const box = el("div", "chart-box");
  box.appendChild(svg);
  container.appendChild(box);
}

/* ---------- score orb + radar + bars ---------- */
function scoreOrb(score, size = 120) {
  const c = scoreColor(score);
  const wrap = el("div", "orb");
  wrap.style.width = wrap.style.height = size + "px";
  wrap.style.setProperty("--orb-c", c);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  const track = document.createElementNS(ns, "circle");
  track.setAttribute("cx", 60); track.setAttribute("cy", 60); track.setAttribute("r", 52);
  track.setAttribute("fill", "none"); track.setAttribute("stroke", "rgba(12,18,32,.10)");
  track.setAttribute("stroke-width", 7);
  svg.appendChild(track);
  const arc = document.createElementNS(ns, "circle");
  const circ = 2 * Math.PI * 52;
  arc.setAttribute("cx", 60); arc.setAttribute("cy", 60); arc.setAttribute("r", 52);
  arc.setAttribute("fill", "none"); arc.setAttribute("stroke", c);
  arc.setAttribute("stroke-width", 7); arc.setAttribute("stroke-linecap", "round");
  arc.setAttribute("stroke-dasharray", (circ * score / 100).toFixed(1) + " " + circ.toFixed(1));
  arc.setAttribute("transform", "rotate(-90 60 60)");
  svg.appendChild(arc);
  wrap.appendChild(svg);
  const inner = el("div", "orb-inner");
  inner.appendChild(el("b", null, score.toFixed(0)));
  inner.appendChild(el("span", null, scoreLabel(score)));
  wrap.appendChild(inner);
  return wrap;
}

function radar(container, entries, size = 320) {
  // entries: [{name, color, subs}]
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 340 320");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Six-dimension score radar");
  const cx = 170, cy = 160, R = 110;
  const angle = i => -Math.PI / 2 + i * Math.PI / 3;
  const pt = (i, r) => [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r];
  const add = attrs => {
    const n = document.createElementNS(ns, attrs.tag);
    for (const k in attrs) if (k !== "tag") n.setAttribute(k, attrs[k]);
    svg.appendChild(n);
    return n;
  };
  [0.33, 0.66, 1].forEach(f => {
    const d = DIMS.map((_, i) => pt(i, R * f)).map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ") + " Z";
    add({ tag: "path", d, fill: "none", stroke: "#E7EAF1", "stroke-width": 1 });
  });
  DIMS.forEach((dim, i) => {
    const [x, y] = pt(i, R);
    add({ tag: "line", x1: cx, y1: cy, x2: x, y2: y, stroke: "#E7EAF1", "stroke-width": 1 });
    const [lx, ly] = pt(i, R + 22);
    const t = add({ tag: "text", x: lx, y: ly + 4, "text-anchor": "middle", fill: "#5A6472", "font-size": 11.5, "font-weight": 600 });
    t.textContent = dim[1];
  });
  entries.forEach(e => {
    const d = DIMS.map(([k], i) => pt(i, R * (e.subs[k] / 100)))
      .map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ") + " Z";
    add({ tag: "path", d, fill: e.color, opacity: 0.14 });
    add({ tag: "path", d, fill: "none", stroke: e.color, "stroke-width": 2, "stroke-linejoin": "round" });
  });
  const box = el("div", "radar-box");
  box.appendChild(svg);
  container.appendChild(box);
}

function dimensionBars(container, subs, weights = W_DEFAULT) {
  const grid = el("div", "breakdown");
  DIMS.forEach(([k, label]) => {
    const row = el("div", "meter-row");
    const lab = el("div", "m-label");
    lab.appendChild(el("span", null, label + " · " + Math.round(weights[k] * 100) + "%"));
    lab.appendChild(el("b", null, subs[k].toFixed(0) + " / 100"));
    row.appendChild(lab);
    const m = el("div", "meter");
    const fill = el("i");
    fill.style.width = subs[k].toFixed(1) + "%";
    fill.style.background = scoreColor(subs[k]);
    m.appendChild(fill);
    row.appendChild(m);
    grid.appendChild(row);
  });
  container.appendChild(grid);
}

/* ---------- sparkline ---------- */
function sparkline(series) {
  const pts = series.map(p => p[1]);
  if (pts.length < 2) return el("span", "sub", "—");
  const W = 110, H = 34, pad = 4;
  const min = Math.min(...pts), max = Math.max(...pts);
  const X = i => pad + (i / (pts.length - 1)) * (W - 2 * pad);
  const Y = v => H - pad - ((v - min) / (max - min || 1)) * (H - 2 * pad);
  const d = pts.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(" ");
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", W); svg.setAttribute("height", H);
  svg.setAttribute("class", "spark"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d); path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#B6BECC"); path.setAttribute("stroke-width", 1.5);
  svg.appendChild(path);
  const dot = document.createElementNS(ns, "circle");
  dot.setAttribute("cx", X(pts.length - 1)); dot.setAttribute("cy", Y(pts[pts.length - 1]));
  dot.setAttribute("r", 3); dot.setAttribute("fill", pts[pts.length - 1] >= pts[0] ? "#059669" : "#DC2626");
  dot.setAttribute("stroke", "#FFFFFF"); dot.setAttribute("stroke-width", 1.5);
  svg.appendChild(dot);
  return svg;
}

/* ---------- badges ---------- */
const minorBadge = () => el("span", "badge-minor", "Analytics Only · Under 18");
const demoBadge = () => el("span", "badge-demo", "Fictional demo athlete");

/* ---------- ticker ---------- */
function buildTicker() {
  const track = $("#tickerTrack");
  track.replaceChildren();
  [...LISTED, ...LISTED].forEach(p => {
    const s = el("span", "tick-item");
    s.appendChild(el("b", null, p.token));
    s.appendChild(document.createTextNode(money(lastTrade(p)) + " "));
    const ch = p.change1d ?? 0;
    s.appendChild(el("span", "delta " + (ch >= 0 ? "pos" : "neg"), arrow(ch) + " " + pct(ch) + " 1D"));
    track.appendChild(s);
  });
}

/* ================================================================ views */
const app = $("#app");

function viewMarket() {
  document.title = "Agora — Market";
  app.replaceChildren();

  const hero = el("section", "hero");
  const h1 = el("h1");
  h1.append("Own the upside of ", (() => el("em", null, "tomorrow's athletes."))());
  hero.appendChild(h1);
  hero.appendChild(el("p", null,
    "Scored transparently. Traded as tokens. Settled on a verifiable ledger."));
  const totalCap = LISTED.reduce((a, p) => a + lastTrade(p) * SHARES_OUT, 0);
  const topScore = P.reduce((a, p) => (p.score > a.score ? p : a));
  const tiles = el("div", "tiles");
  [["Board market cap", compact(totalCap)],
   ["Athletes tracked", String(P.length)],
   ["Listed for trading", String(LISTED.length)],
   ["Top Agora Score", topScore.score.toFixed(0), topScore.name]].forEach(([l, v, sub]) => {
    const t = el("div", "tile");
    t.appendChild(el("div", "t-label", l));
    t.appendChild(el("div", "t-value", v));
    if (sub) { const d = el("div", "t-delta"); d.appendChild(el("span", "pos", sub)); t.appendChild(d); }
    tiles.appendChild(t);
  });
  hero.appendChild(tiles);
  app.appendChild(hero);

  const promo = el("section", "panel bk-promo");
  const pLeft = el("div");
  pLeft.appendChild(el("h2", null, "Index baskets"));
  pLeft.appendChild(el("p", "sub", "One unit, many athletes — by school, class, or position."));
  promo.appendChild(pLeft);
  const pBtn = el("button", "btn", "Explore baskets →");
  pBtn.addEventListener("click", () => { location.hash = "#/baskets"; });
  promo.appendChild(pBtn);
  app.appendChild(promo);

  const controls = el("div", "controls");
  const chips = el("div", "chips");
  const tags = ["All", "College", "High School", "Analytics only"];
  let active = state.marketTag || "All";
  tags.forEach(tag => {
    const c = el("button", "chip" + (tag === active ? " on" : ""), tag);
    c.addEventListener("click", () => { state.marketTag = tag; viewMarket(); });
    chips.appendChild(c);
  });
  controls.appendChild(chips);
  controls.appendChild(el("span", "spacer"));
  const search = el("input", "search");
  search.type = "search"; search.placeholder = "Search athletes or schools…";
  search.value = state.marketQuery || "";
  search.setAttribute("aria-label", "Search athletes");
  controls.appendChild(search);
  const sort = el("select", "select");
  sort.setAttribute("aria-label", "Sort by");
  [["price", "Last trade"], ["score", "Agora Score"], ["rank", "Recruiting rank"], ["name", "Name"]].forEach(([v, l]) => {
    const o = el("option", null, "Sort: " + l); o.value = v; sort.appendChild(o);
  });
  sort.value = state.marketSort || "price";
  controls.appendChild(sort);
  app.appendChild(controls);

  const tableWrap = el("div", "panel table-scroll");
  app.appendChild(tableWrap);

  function renderTable() {
    const q = (state.marketQuery || "").toLowerCase();
    let rows = P.filter(p =>
      (active === "All" || (active === "Analytics only" ? p.minor
        : active === "College" ? p.level === "College" : p.level === "High School" && !p.minor)) &&
      (!q || p.name.toLowerCase().includes(q) || p.school.toLowerCase().includes(q)));
    const key = state.marketSort || "price";
    rows = rows.slice().sort((a, b) =>
      key === "name" ? a.name.localeCompare(b.name)
      : key === "rank" ? a.rank - b.rank
      : key === "score" ? b.score - a.score
      : (b.price ? lastTrade(b) : 0) - (a.price ? lastTrade(a) : 0));
    tableWrap.replaceChildren();
    const table = el("table", "market-table");
    const thead = el("thead");
    const hr = el("tr");
    [["", "hide-sm"], ["Athlete", ""], ["Token", "hide-sm"], ["Score", "num"], ["Last trade", "num"],
     ["1D", "num"], ["Fair value", "num hide-sm"], ["Vs fair", "num hide-sm"], ["Trend", "num hide-sm"]].forEach(([t, cls]) => {
      hr.appendChild(el("th", cls || null, t));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el("tbody");
    rows.forEach((p, i) => {
      const tr = el("tr");
      tr.tabIndex = 0;
      tr.setAttribute("aria-label", p.name);
      const open = () => { location.hash = "#/athlete/" + p.id; };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
      tr.appendChild(el("td", "num hide-sm", String(i + 1)));
      const who = el("td");
      const w = el("div", "who");
      const av = el("span", "avatar", initials(p.name));
      av.style.borderColor = scoreColor(p.score);
      w.appendChild(av);
      const nm = el("div");
      const nmRow = el("div", "nm");
      nmRow.textContent = p.name;
      if (p.minor) nmRow.appendChild(minorBadge());
      nm.appendChild(nmRow);
      nm.appendChild(el("div", "sub", p.pos + " · " + p.school + " · " + p.cls));
      w.appendChild(nm);
      who.appendChild(w);
      tr.appendChild(who);
      tr.appendChild(el("td", "num hide-sm", p.token || "—"));
      const sc = el("td", "num");
      const scChip = el("b", "score-chip", p.score.toFixed(0));
      scChip.style.color = scoreColor(p.score);
      sc.appendChild(scChip);
      tr.appendChild(sc);
      if (p.minor) {
        const cell = el("td", "num");
        cell.colSpan = 5;
        cell.appendChild(el("span", "sub", "Analytics only — not listed"));
        tr.appendChild(cell);
      } else {
        const lt = el("td", "num");
        lt.appendChild(el("b", null, money(lastTrade(p))));
        tr.appendChild(lt);
        const d1 = el("td", "num");
        const ch = p.change1d ?? 0;
        d1.appendChild(el("span", "delta " + (ch >= 0 ? "pos" : "neg"), arrow(ch) + " " + pct(ch)));
        tr.appendChild(d1);
        tr.appendChild(el("td", "num hide-sm", money(fairValue(p))));
        const pr = el("td", "num hide-sm");
        pr.appendChild(premChip(p));
        tr.appendChild(pr);
        const sp = el("td", "num hide-sm");
        sp.appendChild(sparkline(p.daily.slice(-30)));
        tr.appendChild(sp);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }
  search.addEventListener("input", () => { state.marketQuery = search.value; renderTable(); });
  sort.addEventListener("change", () => { state.marketSort = sort.value; renderTable(); });
  renderTable();
}

/* ---------- athlete profile ---------- */
function viewAthlete(id) {
  const p = byId[id];
  if (!p) { location.hash = "#/market"; return; }
  document.title = "Agora — " + p.name;
  app.replaceChildren();

  const back = el("a", "back", "← Back to market");
  back.href = "#/market";
  app.appendChild(back);

  const head = el("div", "ath-head");
  const av = el("span", "avatar big", initials(p.name));
  av.style.borderColor = scoreColor(p.score);
  head.appendChild(av);
  const nameBox = el("div");
  nameBox.appendChild(el("h1", null, p.name));
  const meta = el("div", "ath-meta");
  [p.pos + " · " + p.school, p.cls, p.level, "Rank #" + p.rank].forEach(t => meta.appendChild(el("span", "tag", t)));
  if (p.token) meta.appendChild(el("span", "tag token-tag", p.token));
  if (p.minor) meta.appendChild(minorBadge());
  if (p.demo) meta.appendChild(demoBadge());
  nameBox.appendChild(meta);
  head.appendChild(nameBox);
  const priceBox = el("div", "ath-price");
  if (p.minor) {
    priceBox.appendChild(el("div", "p analytics", "Not listed"));
    priceBox.appendChild(el("div", "d sub", "Under-18 safeguard: analytics only, no trading, no price."));
  } else {
    priceBox.appendChild(el("div", "p", money(lastTrade(p))));
    priceBox.appendChild(el("div", "d sub", "last traded price"));
    const fv = el("div", "d fv-line");
    fv.appendChild(document.createTextNode("Agora fair value " + money(fairValue(p)) + " · "));
    fv.appendChild(premChip(p));
    priceBox.appendChild(fv);
  }
  head.appendChild(priceBox);
  app.appendChild(head);

  app.appendChild(el("blockquote", "story", "“" + p.story + "”"));

  // score panel: orb + radar + bars
  const scoreGrid = el("div", "score-grid");
  const orbPanel = el("section", "panel glass center");
  orbPanel.appendChild(el("h2", null, "Agora Score"));
  orbPanel.appendChild(scoreOrb(p.score, 150));
  orbPanel.appendChild(el("p", "sub center-text", "Six weighted dimensions, 0–100. The score drives the suggested fair value."));
  scoreGrid.appendChild(orbPanel);
  const radarPanel = el("section", "panel glass");
  radarPanel.appendChild(el("h2", null, "Dimension radar"));
  radar(radarPanel, [{ name: p.name, color: scoreColor(p.score), subs: p.subs }]);
  scoreGrid.appendChild(radarPanel);
  const barsPanel = el("section", "panel glass");
  barsPanel.appendChild(el("h2", null, "Score breakdown"));
  dimensionBars(barsPanel, p.subs);
  scoreGrid.appendChild(barsPanel);
  app.appendChild(scoreGrid);

  // stats + audience + commercial
  const statGrid = el("div", "grid-2");
  const stats = el("section", "panel");
  stats.appendChild(el("h2", null, "Season line"));
  stats.appendChild(el("p", "sub", (p.level === "College" ? "Approximate public per-game statistics, 2025-26." : "Fictional demo statistics — no real minor's data is used.")));
  const ms = el("div", "mini-stats");
  [["PTS", p.pts], ["REB", p.reb], ["AST", p.ast], ["TS%", (p.ts * 100).toFixed(1)], ["Games", p.gp]].forEach(([l, v]) => {
    if (v == null) return;
    const d = el("div", "ms", l);
    d.prepend(el("b", null, String(v)));
    ms.appendChild(d);
  });
  stats.appendChild(ms);
  statGrid.appendChild(stats);
  const aud = el("section", "panel");
  aud.appendChild(el("h2", null, "Audience & commercial"));
  const ms2 = el("div", "mini-stats");
  [["Followers", kfmt(p.followersK)], ["Engagement", p.engagement + "%"], ["90-day growth", "+" + p.growth90 + "%"],
   ["NIL deals", String(p.nil)], ["Momentum", p.momentum + " / 100"]].forEach(([l, v]) => {
    const d = el("div", "ms", l);
    d.prepend(el("b", null, v));
    ms2.appendChild(d);
  });
  aud.appendChild(ms2);
  aud.appendChild(el("p", "sub", "Commercial maturity: " + p.maturity + ". Commercial values are 0–100 indexes — never dollar valuations."));
  statGrid.appendChild(aud);
  app.appendChild(statGrid);

  // price chart + ticket (listed only)
  if (!p.minor) {
    const grid = el("div", "ath-grid");
    const chartPanel = el("section", "panel");
    const chartHead = el("div", "chart-head");
    chartHead.appendChild(el("h2", null, "Price history"));
    const ranges = el("div", "range-chips");
    chartHead.appendChild(ranges);
    chartPanel.appendChild(chartHead);
    const chartSub = el("p", "sub");
    chartPanel.appendChild(chartSub);
    const chartBox = el("div");
    chartPanel.appendChild(chartBox);

    const RANGES = [["1D", "intraday"], ["1W", "week"], ["1M", "month"], ["Season", "all"]];
    state.range = state.range || "all";
    function seriesFor(key) {
      if (key === "intraday") return { pts: p.intraday, x: h => h + ":00", title: "today" };
      if (key === "week") return { pts: p.daily.slice(-8), x: d => "day " + d, title: "last 7 days" };
      if (key === "month") return { pts: p.daily.slice(-31), x: d => "day " + d, title: "last 30 days" };
      return { pts: p.daily, x: d => "day " + d, title: "2025-26 season" };
    }
    function renderChart() {
      chartBox.replaceChildren();
      const { pts, title } = seriesFor(state.range);
      const first = pts[0][1], last = pts[pts.length - 1][1];
      const ch = (last / first - 1) * 100;
      chartSub.replaceChildren();
      chartSub.appendChild(el("span", "delta " + (ch >= 0 ? "pos" : "neg"), arrow(ch) + " " + pct(ch)));
      chartSub.appendChild(document.createTextNode(
        " · " + title));
      const evd = state.range === "all" ? p.events : [];
      buildChart(chartBox, [{ name: p.name, color: "#0062FF", pts }], {
        height: 300, ariaLabel: p.name + " price history " + title,
        tooltipTitle: title,
        annotations: evd.map(e => ({ x: e.d, label: e.label + " (" + (e.pct > 0 ? "+" : "") + (e.pct * 100).toFixed(1) + "%)" })),
      });
    }
    RANGES.forEach(([label, key]) => {
      const c = el("button", "chip" + (state.range === key ? " on" : ""), label);
      c.addEventListener("click", () => {
        state.range = key;
        [...ranges.children].forEach(b => b.classList.toggle("on", b === c));
        renderChart();
      });
      ranges.appendChild(c);
    });
    renderChart();
    grid.appendChild(chartPanel);

    const tp = el("section", "panel trade-ticket");
    tp.appendChild(el("h2", null, "Trade " + p.token));
    tp.appendChild(el("p", "sub", "Shares are tokens. Set any price — your trade becomes the new last trade and is recorded on the verifiable ledger."));
    const quote = el("div", "ticket-quote");
    quote.appendChild(el("b", null, money(lastTrade(p))));
    quote.appendChild(el("span", "sub", "last trade · fair value " + money(fairValue(p))));
    tp.appendChild(quote);
    const tForm = el("div", "trade-form");
    const mkF = (labelText, control) => {
      const f = el("div", "field");
      f.appendChild(el("label", null, labelText));
      f.appendChild(control);
      return f;
    };
    const priceIn = el("input", "amount");
    priceIn.type = "number"; priceIn.min = 1; priceIn.step = 0.5;
    priceIn.value = lastTrade(p).toFixed(2);
    const qtyIn = el("input", "amount");
    qtyIn.type = "number"; qtyIn.min = 0.5; qtyIn.step = 0.5; qtyIn.value = 5;
    const totalOut = el("div", "trade-total");
    const holding = el("p", "sub");
    const updateMeta = () => {
      const q = Math.max(0, Number(qtyIn.value) || 0), pr = Math.max(0, Number(priceIn.value) || 0);
      totalOut.textContent = "Total " + money(q * pr);
      const own = store.owned("ath", p.id);
      holding.textContent = own.shares > 0
        ? "You hold " + own.shares.toFixed(1) + " " + p.token + " · avg cost " + money(own.cost / own.shares)
        : "You hold no " + p.token + " yet.";
    };
    const buyBtn = el("button", "btn big buy", "Buy");
    const sellBtn = el("button", "btn big sell", "Sell");
    const doTrade = kind => {
      const q = Number(qtyIn.value) || 0, pr = Number(priceIn.value) || 0;
      if (q <= 0 || pr <= 0) { toast("Enter a price and quantity"); return; }
      if (kind === "sell" && store.owned("ath", p.id).shares < q - 1e-9) {
        toast("You only hold " + store.owned("ath", p.id).shares.toFixed(1) + " " + p.token); return;
      }
      store.trade({ kind, type: "ath", id: p.id, shares: q, price: pr });
      marketStore.setLastTrade(p.id, pr);
      ledger.record({ type: kind.toUpperCase(), token: p.token, athlete: p.name, qty: q, price: pr })
        .then(h => toast((kind === "buy" ? "Bought " : "Sold ") + q + " " + p.token + " at " + money(pr) + " · tx " + shortHash(h) + " ✓"));
      buildTicker();
      viewAthlete(p.id);
    };
    buyBtn.addEventListener("click", () => doTrade("buy"));
    sellBtn.addEventListener("click", () => doTrade("sell"));
    priceIn.addEventListener("input", updateMeta);
    qtyIn.addEventListener("input", updateMeta);
    tForm.appendChild(mkF("Your price ($)", priceIn));
    tForm.appendChild(mkF("Tokens", qtyIn));
    tForm.appendChild(totalOut);
    const actions = el("div", "trade-actions");
    actions.appendChild(buyBtn);
    actions.appendChild(sellBtn);
    tForm.appendChild(actions);
    tp.appendChild(tForm);
    tp.appendChild(holding);
    updateMeta();
    grid.appendChild(tp);
    app.appendChild(grid);
  } else {
    const safe = el("section", "panel safeguard");
    safe.appendChild(el("h2", null, "Minor athlete safeguard"));
    safe.appendChild(el("p", null,
      "This athlete is under 18. Agora displays analytics only: no price, no token, no trading interface. " +
      "Listings open automatically at 18 with guardian and compliance review. All high-school data on this demo is fictional."));
    app.appendChild(safe);
  }

  // projections
  const proj = el("section", "panel");
  proj.appendChild(el("h2", null, "Momentum projections"));
  proj.appendChild(el("p", "sub", "Scenario change in the 0–100 momentum index over 12 months — illustrative model estimates, never dollar predictions."));
  const base = (0.30 * p.subs.audience + 0.25 * p.subs.production + 0.20 * p.subs.availability +
                0.15 * p.subs.recruiting + 0.10 * p.subs.runway) / 100 * 22;
  const drivers = DIMS.slice().sort((a, b) => p.subs[b[0]] - p.subs[a[0]]).slice(0, 2).map(d => d[1]);
  const projGrid = el("div", "proj-grid");
  [["Conservative", base * 0.5, "Slower development"], ["Base", base, "Modeled trajectory"],
   ["High-Growth", base * 1.8, "Accelerated path"]].forEach(([name, g, note]) => {
    const c = el("div", "proj-card" + (name === "Base" ? " focus" : ""));
    c.appendChild(el("div", "p-tag", name));
    c.appendChild(el("b", null, "+" + g.toFixed(1) + " pts"));
    c.appendChild(el("p", "sub", note + " · key drivers: " + drivers.join(", ")));
    projGrid.appendChild(c);
  });
  proj.appendChild(projGrid);
  proj.appendChild(el("p", "sub fine", "Projections are illustrative model estimates. They do not represent guaranteed returns, financial valuations, or predictions of any specific outcome. Not financial advice."));
  app.appendChild(proj);

  // comparables
  const comps = P.filter(x => x.id !== p.id && x.pos === p.pos)
    .sort((a, b) => Math.abs(a.rank - p.rank) - Math.abs(b.rank - p.rank)).slice(0, 3);
  if (comps.length) {
    const cp = el("section", "panel");
    cp.appendChild(el("h2", null, "Comparable athletes"));
    const row = el("div", "comp-row");
    comps.forEach(c => {
      const card = el("a", "comp-card");
      card.href = "#/athlete/" + c.id;
      const top = el("div", "bk-top");
      const chip = el("b", "score-chip", c.score.toFixed(0));
      chip.style.color = scoreColor(c.score);
      top.appendChild(chip);
      top.appendChild(el("span", "sub", c.minor ? "analytics only" : money(lastTrade(c))));
      card.appendChild(top);
      card.appendChild(el("b", null, c.name));
      card.appendChild(el("div", "sub", c.pos + " · " + c.school + " · " + c.cls));
      row.appendChild(card);
    });
    cp.appendChild(row);
    const cta = el("div", "btn-row");
    const b = el("button", "btn ghost", "Compare side-by-side →");
    b.addEventListener("click", () => {
      location.hash = "#/compare?ids=" + [p.id, ...comps.slice(0, 2).map(c => c.id)].join(",");
    });
    cta.appendChild(b);
    cp.appendChild(cta);
    app.appendChild(cp);
  }
}

/* ---------- compare ---------- */
const CMP_COLORS = ["#7C3AED", "#9085e9", "#34d399", "#eda100"];
function viewCompare(params) {
  document.title = "Agora — Compare";
  app.replaceChildren();
  const head = el("div", "view-head");
  head.appendChild(el("h1", null, "Compare athletes"));
  head.appendChild(el("p", null, "Up to four athletes across all six Agora Score dimensions. Analytics-only minors can be compared — never traded."));
  app.appendChild(head);

  let ids = (params.get("ids") || "").split(",").map(Number).filter(n => byId[n]).slice(0, 4);
  if (!ids.length) ids = [P[0].id, P[1].id];

  const picker = el("section", "panel");
  picker.appendChild(el("h2", null, "Selection"));
  const chipRow = el("div", "chips wrap");
  P.forEach(p => {
    const on = ids.includes(p.id);
    const c = el("button", "chip" + (on ? " on" : ""), p.name);
    if (on) {
      const idx = ids.indexOf(p.id);
      c.style.borderColor = CMP_COLORS[idx];
      c.style.color = CMP_COLORS[idx];
    }
    c.addEventListener("click", () => {
      const next = on ? ids.filter(x => x !== p.id) : [...ids, p.id].slice(-4);
      location.hash = "#/compare?ids=" + next.join(",");
    });
    chipRow.appendChild(c);
  });
  picker.appendChild(chipRow);
  app.appendChild(picker);

  const sel = ids.map(id => byId[id]);
  const grid = el("div", "grid-2");
  const radarPanel = el("section", "panel glass");
  radarPanel.appendChild(el("h2", null, "Dimension radar"));
  radar(radarPanel, sel.map((p, i) => ({ name: p.name, color: CMP_COLORS[i], subs: p.subs })));
  const legend = el("div", "chart-legend");
  sel.forEach((p, i) => {
    const k = el("span", "lg-key");
    const sw = el("i"); sw.style.borderTopColor = CMP_COLORS[i];
    k.appendChild(sw);
    k.appendChild(document.createTextNode(p.name));
    legend.appendChild(k);
  });
  radarPanel.appendChild(legend);
  grid.appendChild(radarPanel);

  const tablePanel = el("section", "panel table-scroll");
  tablePanel.appendChild(el("h2", null, "Metric by metric"));
  const table = el("table", "cmp-table");
  const thead = el("thead");
  const hr = el("tr");
  hr.appendChild(el("th", null, ""));
  sel.forEach((p, i) => {
    const th = el("th", "num");
    const b = el("b", null, p.name.split(" ").pop());
    b.style.color = CMP_COLORS[i];
    th.appendChild(b);
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);
  const tb = el("tbody");
  const rows = [
    ["Agora Score", p => p.score, v => v.toFixed(1), false],
    ...DIMS.map(([k, label]) => [label, p => p.subs[k], v => v.toFixed(0), false]),
    ["Recruiting rank", p => p.rank, v => "#" + v, true],
    ["Followers", p => p.followersK, v => kfmt(v), false],
    ["Last trade", p => (p.minor ? null : lastTrade(p)), v => (v == null ? "analytics only" : money(v)), false],
  ];
  rows.forEach(([label, get, fmt, lowerBetter]) => {
    const tr = el("tr");
    tr.appendChild(el("td", null, label));
    const vals = sel.map(get);
    const valid = vals.filter(v => v != null);
    const best = valid.length ? (lowerBetter ? Math.min(...valid) : Math.max(...valid)) : null;
    vals.forEach((v, i) => {
      const td = el("td", "num");
      const isBest = v != null && v === best && valid.length > 1;
      const span = el("span", isBest ? "best" : null, fmt(v) + (isBest ? " ▲" : ""));
      if (isBest) span.style.color = CMP_COLORS[i];
      td.appendChild(span);
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  tablePanel.appendChild(table);
  tablePanel.appendChild(el("p", "sub fine", "Comparison metrics are illustrative estimates. Not financial advice."));
  grid.appendChild(tablePanel);
  app.appendChild(grid);
}

/* ---------- methodology ---------- */
function viewMethodology() {
  document.title = "Agora — Methodology";
  app.replaceChildren();
  const head = el("div", "view-head");
  head.appendChild(el("h1", null, "How the Agora Score works"));
  head.appendChild(el("p", null,
    "Six dimensions, each scored 0–100 from observable data, combined with fixed, published weights — " +
    "the same for every athlete and every user. The score feeds the fair-value curve: only score above " +
    "replacement level earns a price, convexly. One methodology, applied to everyone. That is the product."));
  app.appendChild(head);

  const DESCS = {
    production: "Per-game output normalized within position archetypes. HS stats are discounted for level of competition.",
    availability: "Games played as a share of the season — reliability is investable.",
    recruiting: "National composite rank and rating — the market consensus prior.",
    audience: "Followers, engagement rate, and 90-day growth — commercial reach.",
    commercial: "Verified NIL activity count and a 0–100 momentum index. Never dollar amounts.",
    runway: "Development years remaining before peak — youth is optionality.",
  };
  const panel = el("section", "panel glass");
  panel.appendChild(el("h2", null, "The fixed weights"));
  panel.appendChild(el("p", "sub",
    "Locked platform-wide. If the methodology ever changes, it changes for everyone at a published version number — fair value only means something when nobody can tilt it."));
  const rows = el("div", "wsliders");
  DIMS.forEach(([k, label]) => {
    const row = el("div", "wslider");
    const lab = el("div", "m-label");
    lab.appendChild(el("span", null, label));
    lab.appendChild(el("b", null, Math.round(W_DEFAULT[k] * 100) + "%"));
    row.appendChild(lab);
    const bar = el("div", "meter grow");
    const fill = el("i");
    fill.style.width = (W_DEFAULT[k] * 100 / 0.6).toFixed(1) + "%";
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(el("p", "sub", DESCS[k]));
    rows.appendChild(row);
  });
  panel.appendChild(rows);
  app.appendChild(panel);

  const price = el("section", "panel");
  price.appendChild(el("h2", null, "From score to suggested fair value"));
  const steps = el("ol", "method-steps");
  ["Score above the replacement level (28) is the only part with market value — bench-level output prices near the floor.",
   "The surplus maps through a convex curve (exponent 1.62), so elite scores separate sharply from good ones.",
   "An availability factor discounts fragile seasons once — injuries are drawdowns, not skill judgments.",
   "The result is a suggested fair value. The market — buyers and sellers — sets the traded price around it.",
   "Prices move daily on normal flow (under ~2%) and gap only on labeled news: draft moves, injuries, signature games."]
    .forEach(t => steps.appendChild(el("li", null, t)));
  price.appendChild(steps);
  app.appendChild(price);

  const board = el("section", "panel");
  board.appendChild(el("h2", null, "The board under the published weights"));
  const list = el("div");
  P.slice().sort((a, b) => b.score - a.score).slice(0, 10).forEach((p, i) => {
    const row = el("div", "sim-row");
    row.appendChild(el("span", "sub", "#" + (i + 1)));
    row.appendChild(el("b", null, p.name));
    const bar = el("div", "meter grow");
    const fill = el("i");
    fill.style.width = p.score.toFixed(1) + "%";
    fill.style.background = scoreColor(p.score);
    bar.appendChild(fill);
    row.appendChild(bar);
    const chip = el("b", "score-chip", p.score.toFixed(1));
    chip.style.color = scoreColor(p.score);
    row.appendChild(chip);
    row.appendChild(el("span", "sub delta-note", p.minor ? "analytics only" : money(p.price)));
    list.appendChild(row);
  });
  board.appendChild(list);
  app.appendChild(board);
}

/* ---------- baskets ---------- */
function viewBaskets() {
  document.title = "Agora — Baskets";
  app.replaceChildren();
  const head = el("div", "view-head");
  head.appendChild(el("h1", null, "Baskets"));
  head.appendChild(el("p", null,
    "ETF-style units priced off member last trades. One injury never sinks the basket."));
  app.appendChild(head);
  const groups = [...new Set(BASKETS.map(b => b.group))];
  groups.forEach(g => {
    const section = el("section");
    const gh = el("div", "view-head bk-head");
    gh.appendChild(el("h2", null, g));
    section.appendChild(gh);
    const row = el("div", "baskets");
    BASKETS.filter(b => b.group === g && basketMembers(b).length >= 2).forEach(b => {
      const members = basketMembers(b);
      const card = el("div", "basket panel glass");
      const top = el("div", "bk-top");
      top.appendChild(el("span", "tag", b.key));
      top.appendChild(el("span", "sub", members.length + " athletes"));
      card.appendChild(top);
      card.appendChild(el("h3", null, b.name));
      card.appendChild(el("p", "sub", b.desc));
      const priceRow = el("div", "bk-price");
      priceRow.appendChild(el("b", null, money(basketPrice(b))));
      const pr = (basketPrice(b) / basketFair(b) - 1) * 100;
      priceRow.appendChild(el("span", "delta " + (pr >= 0 ? "pos" : "neg"), arrow(pr) + " " + pct(pr) + " vs fair"));
      card.appendChild(priceRow);
      const names = members.map(p => p.name.split(" ").pop());
      card.appendChild(el("p", "sub bk-members",
        names.slice(0, 6).join(" · ") + (names.length > 6 ? " · +" + (names.length - 6) + " more" : "")));
      const own = store.owned("basket", b.key);
      const ownLine = el("p", "sub bk-owned");
      if (own.shares > 0) ownLine.textContent = "You hold " + own.shares.toFixed(1) + " units · avg cost " + money(own.cost / own.shares);
      card.appendChild(ownLine);
      const br = el("div", "btn-row");
      const buy = el("button", "btn small", "Buy 1 unit · " + money(basketPrice(b)));
      buy.addEventListener("click", () => {
        const pr2 = basketPrice(b);
        store.trade({ kind: "buy", type: "basket", id: b.key, shares: 1, price: pr2 });
        ledger.record({ type: "BUY", token: "BSK:" + b.key, athlete: b.name, qty: 1, price: +pr2.toFixed(2) })
          .then(h => toast("Bought 1 " + b.name + " unit · tx " + shortHash(h) + " ✓"));
        viewBaskets();
      });
      br.appendChild(buy);
      if (own.shares > 0) {
        const sell = el("button", "btn small ghost", "Sell 1");
        sell.addEventListener("click", () => {
          const pr2 = basketPrice(b);
          store.trade({ kind: "sell", type: "basket", id: b.key, shares: Math.min(1, own.shares), price: pr2 });
          ledger.record({ type: "SELL", token: "BSK:" + b.key, athlete: b.name, qty: 1, price: +pr2.toFixed(2) })
            .then(h => toast("Sold 1 " + b.name + " unit · tx " + shortHash(h) + " ✓"));
          viewBaskets();
        });
        br.appendChild(sell);
      }
      card.appendChild(br);
      row.appendChild(card);
    });
    section.appendChild(row);
    app.appendChild(section);
  });
}

/* ---------- portfolio ---------- */
function viewPortfolio() {
  document.title = "Agora — Portfolio";
  app.replaceChildren();
  const head = el("div", "view-head");
  head.appendChild(el("h1", null, "Your portfolio"));
  head.appendChild(el("p", null, "Token holdings marked to the last traded price. Every entry settles on the verifiable ledger."));
  app.appendChild(head);
  const { list, realized } = store.positions();
  if (!list.length) {
    const emp = el("div", "empty");
    emp.appendChild(el("p", null, "No holdings yet. Buy an athlete's token at any price, or grab an index basket."));
    const row = el("div", "btn-row");
    const b = el("button", "btn", "Open the market");
    b.addEventListener("click", () => { location.hash = "#/market"; });
    row.appendChild(b);
    emp.appendChild(row);
    app.appendChild(emp);
    return;
  }
  const rows = list.map(pos => {
    const isBasket = pos.type === "basket";
    const asset = isBasket ? byBasket[pos.id] : byId[pos.id];
    const mark = isBasket ? basketPrice(asset) : lastTrade(asset);
    return { pos, isBasket, asset, mark, value: pos.shares * mark, avg: pos.cost / pos.shares };
  }).filter(r => r.asset);
  const totalIn = rows.reduce((a, r) => a + r.pos.cost, 0);
  const totalNow = rows.reduce((a, r) => a + r.value, 0);
  const tiles = el("div", "tiles");
  [["Cost basis", compact(totalIn)], ["Value now", compact(totalNow)],
   ["Unrealized P/L", pct(totalIn ? (totalNow / totalIn - 1) * 100 : 0, 1)],
   ["Realized P/L", (realized >= 0 ? "+" : "−") + money(Math.abs(realized))]].forEach(([l, v], i) => {
    const t = el("div", "tile");
    t.appendChild(el("div", "t-label", l));
    const val = el("div", "t-value", v);
    if (i === 2) val.style.color = totalNow >= totalIn ? "var(--up)" : "var(--down)";
    if (i === 3) val.style.color = realized >= 0 ? "var(--up)" : "var(--down)";
    t.appendChild(val);
    tiles.appendChild(t);
  });
  app.appendChild(tiles);
  const panel = el("section", "panel table-scroll");
  const table = el("table", "pos-table");
  const thead = el("thead");
  const hr = el("tr");
  ["Asset", "Token", "Held", "Avg cost", "Last trade", "Value", "P/L", ""].forEach(h => hr.appendChild(el("th", null, h)));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tb = el("tbody");
  rows.forEach(r => {
    const tr = el("tr");
    const nameTd = el("td");
    if (r.isBasket) {
      nameTd.appendChild(el("b", null, r.asset.name));
      nameTd.appendChild(el("div", "sub", "index basket · " + basketMembers(r.asset).length + " athletes"));
    } else {
      const a = el("a", null, r.asset.name);
      a.href = "#/athlete/" + r.asset.id;
      a.style.color = "var(--ink)";
      a.style.fontWeight = "600";
      nameTd.appendChild(a);
    }
    tr.appendChild(nameTd);
    tr.appendChild(el("td", null, r.isBasket ? "BSK:" + r.asset.key : r.asset.token));
    tr.appendChild(el("td", null, r.pos.shares.toFixed(1)));
    tr.appendChild(el("td", null, money(r.avg)));
    tr.appendChild(el("td", null, money(r.mark)));
    tr.appendChild(el("td", null, money(r.value)));
    const pl = (r.mark / r.avg - 1) * 100;
    const plTd = el("td");
    plTd.appendChild(el("span", "delta " + (pl >= 0 ? "pos" : "neg"), arrow(pl) + " " + pct(pl, 0)));
    tr.appendChild(plTd);
    const actTd = el("td");
    if (r.isBasket) {
      const sell = el("button", "x-btn", "Sell 1");
      sell.addEventListener("click", () => {
        const pr2 = basketPrice(r.asset);
        store.trade({ kind: "sell", type: "basket", id: r.asset.key, shares: Math.min(1, r.pos.shares), price: pr2 });
        ledger.record({ type: "SELL", token: "BSK:" + r.asset.key, athlete: r.asset.name, qty: 1, price: +pr2.toFixed(2) })
          .then(h => toast("Sold 1 unit · tx " + shortHash(h) + " ✓"));
        viewPortfolio();
      });
      actTd.appendChild(sell);
    } else {
      const trade = el("a", "x-btn", "Trade");
      trade.href = "#/athlete/" + r.asset.id;
      actTd.appendChild(trade);
    }
    tr.appendChild(actTd);
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  panel.appendChild(table);
  const clr = el("div", "btn-row");
  const lg = el("button", "btn ghost", "View settlement ledger");
  lg.addEventListener("click", () => { location.hash = "#/ledger"; });
  const cb = el("button", "btn ghost", "Clear portfolio");
  cb.addEventListener("click", () => { store.clear(); viewPortfolio(); });
  clr.appendChild(lg);
  clr.appendChild(cb);
  panel.appendChild(clr);
  app.appendChild(panel);
}

/* ---------- ledger ---------- */
function viewLedger() {
  document.title = "Agora — Ledger";
  app.replaceChildren();
  const head = el("div", "view-head");
  head.appendChild(el("h1", null, "Settlement ledger"));
  head.appendChild(el("p", null,
    "Every trade is a token transfer appended to a hash-chained ledger: each block carries the SHA-256 of the previous, " +
    "so any tampering breaks the chain. This demo runs the ledger locally in your browser; the production architecture " +
    "settles the same structure on a public network."));
  app.appendChild(head);

  const panel = el("section", "panel glass");
  const statRow = el("div", "mini-stats");
  panel.appendChild(statRow);
  const btnRow = el("div", "btn-row");
  const verifyBtn = el("button", "btn", "Verify chain integrity");
  const status = el("span", "verify-status");
  btnRow.appendChild(verifyBtn);
  btnRow.appendChild(status);
  panel.appendChild(btnRow);
  app.appendChild(panel);

  const blocksPanel = el("section", "panel");
  blocksPanel.appendChild(el("h2", null, "Blocks"));
  const blockList = el("div");
  blocksPanel.appendChild(blockList);
  app.appendChild(blocksPanel);

  async function render() {
    const chain = await ledger.ensureGenesis();
    const txCount = chain.reduce((a, b) => a + b.txs.filter(t => t.type !== "GENESIS").length, 0);
    statRow.replaceChildren();
    [["Blocks", String(chain.length)], ["Transactions", String(txCount)],
     ["Hash", "SHA-256"], ["Chain head", shortHash(chain[chain.length - 1].hash)]].forEach(([l, v]) => {
      const d = el("div", "ms", l);
      d.prepend(el("b", null, v));
      statRow.appendChild(d);
    });
    blockList.replaceChildren();
    chain.slice().reverse().forEach(b => {
      const card = el("div", "block-card");
      const top = el("div", "bk-top");
      top.appendChild(el("b", null, "Block " + b.i));
      top.appendChild(el("span", "sub mono", shortHash(b.hash)));
      card.appendChild(top);
      card.appendChild(el("div", "sub mono", "prev " + shortHash(b.prev)));
      b.txs.forEach(t => {
        if (t.type === "GENESIS") {
          card.appendChild(el("p", "sub", "⛓ " + t.note));
        } else {
          const line = el("p", "tx-line");
          const side = el("b", t.type === "BUY" ? "pos" : "neg", t.type);
          line.appendChild(side);
          line.appendChild(document.createTextNode(" " + t.qty + " × " + t.token + " (" + t.athlete + ") @ " + money(t.price)));
          card.appendChild(line);
        }
      });
      card.appendChild(el("div", "sub fine", new Date(b.ts).toLocaleString()));
      blockList.appendChild(card);
    });
  }
  verifyBtn.addEventListener("click", async () => {
    status.textContent = "verifying…";
    status.className = "verify-status";
    const t0 = performance.now();
    const res = await ledger.verify();
    const ms = (performance.now() - t0).toFixed(0);
    if (res.ok) {
      status.textContent = "✓ chain valid — " + res.blocks + " blocks re-hashed in " + ms + "ms";
      status.className = "verify-status ok";
    } else {
      status.textContent = "✗ chain broken at block " + res.at + " (" + res.reason + ")";
      status.className = "verify-status bad";
    }
  });
  render();
}

/* ---------- welcome splash (filming / onboarding) ---------- */
function viewWelcome() {
  document.title = "Agora — Join today";
  document.body.classList.add("splash-mode");
  app.replaceChildren();
  const wrap = el("div", "welcome");
  const logo = new Image();
  logo.src = "logo.png";
  logo.alt = "Agora";
  logo.className = "welcome-logo";
  wrap.appendChild(logo);
  wrap.appendChild(el("div", "welcome-word", "AGORA"));
  wrap.appendChild(el("p", "welcome-tag", "Own the upside of tomorrow's athletes."));
  const btn = el("button", "btn welcome-btn", "JOIN TODAY");
  btn.addEventListener("click", () => {
    location.hash = "#/live";
  });
  wrap.appendChild(btn);
  wrap.appendChild(el("p", "welcome-fine", "Simulated demo · not a securities offering"));
  app.appendChild(wrap);
}

/* ---------- live game interstitial (filming flow) ---------- */
let liveTimers = [];
function viewLive() {
  document.title = "Agora — $AZAN live";
  document.body.classList.add("splash-mode");
  app.replaceChildren();
  const az = P.find(x => x.name === "Azan Evans");
  const START = az ? lastTrade(az) : 197.24;
  const EVENTS = [
    ["Pull-up three ✓", "Q1 04:12", 2.40],
    ["And-one finish ✓", "Q1 01:45", 1.90],
    ["Corner three ✓", "Q2 05:02", 2.80],
    ["Chase-down block", "Q2 00:41", 2.20],
    ["14 PTS at the half", "market re-rating", 3.60],
    ["Steal → dunk", "Q3 07:19", 3.40],
    ["Step-back three ✓", "Q4 06:24", 3.80],
    ["Game-winner ✓✓", "Q4 00:02 · 26 PTS", 6.20],
  ];

  const wrap = el("div", "live-view");
  const head = el("div", "live-head");
  const brand = el("div", "live-brand");
  const lg = new Image(); lg.src = "logo.png"; lg.alt = "";
  brand.appendChild(lg);
  brand.appendChild(el("span", "live-dot"));
  brand.appendChild(el("span", "live-label", "LIVE"));
  head.appendChild(brand);
  head.appendChild(el("span", "tag token-tag", "$AZAN"));
  wrap.appendChild(head);

  wrap.appendChild(el("h1", "live-name", "Azan Evans"));
  wrap.appendChild(el("p", "sub live-sub", "SG · NUS · Sophomore"));

  const priceRow = el("div", "live-price-row");
  const priceEl = el("div", "live-price", money(START));
  const deltaEl = el("div", "delta pos live-delta", "▲ +0.0%");
  priceRow.appendChild(priceEl);
  priceRow.appendChild(deltaEl);
  wrap.appendChild(priceRow);

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 360 120");
  svg.setAttribute("class", "live-chart");
  svg.setAttribute("aria-label", "live price");
  wrap.appendChild(svg);

  const feed = el("div", "live-feed");
  wrap.appendChild(feed);

  const cta = el("button", "btn live-cta", "View $AZAN profile →");
  cta.addEventListener("click", () => {
    location.hash = az ? "#/athlete/" + az.id : "#/market";
  });
  wrap.appendChild(cta);
  app.appendChild(wrap);

  let price = START, target = START, pts = [[0, START]], i = 0, anim = null;
  function draw() {
    svg.replaceChildren();
    const W = 360, H = 120, pad = 6;
    const x1 = Math.max(8, pts.length - 1);
    const ys = pts.map(p => p[1]);
    const lo = Math.min(...ys) * 0.997, hi = Math.max(...ys) * 1.003;
    const X = x => pad + x / x1 * (W - 2 * pad);
    const Y = y => H - pad - (y - lo) / (hi - lo || 1) * (H - 2 * pad);
    const mk = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); svg.appendChild(n); return n; };
    const d = pts.map((p, j) => (j ? "L" : "M") + X(j).toFixed(1) + " " + Y(p[1]).toFixed(1)).join(" ");
    mk("path", { d: d + ` L ${X(pts.length - 1)} ${H - pad} L ${X(0)} ${H - pad} Z`, fill: "rgba(0,98,255,.10)" });
    mk("path", { d, fill: "none", stroke: "#0062FF", "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round" });
    mk("circle", { cx: X(pts.length - 1), cy: Y(pts[pts.length - 1][1]), r: 5, fill: "#0062FF", stroke: "#fff", "stroke-width": 2 });
  }
  function animateTo(t) {
    if (anim) clearInterval(anim);
    const from = price, t0 = performance.now(), ms = 900;
    anim = setInterval(() => {
      const f = Math.min(1, (performance.now() - t0) / ms);
      const o = 1.6;
      const eased = f < 1 ? 1 + (o + 1) * Math.pow(f - 1, 3) + o * Math.pow(f - 1, 2) : 1;
      price = from + (t - from) * eased;
      priceEl.textContent = money(price);
      const d = (price / START - 1) * 100;
      deltaEl.textContent = "▲ +" + d.toFixed(1) + "%";
      pts[pts.length - 1][1] = price;
      draw();
      if (f >= 1) { clearInterval(anim); anim = null; price = t; }
    }, 16);
    liveTimers.push(anim);
  }
  function fire() {
    if (i >= EVENTS.length) return;
    const [label, sub, delta] = EVENTS[i];
    i += 1;
    const card = el("div", "live-event");
    const line = el("span", null, label);
    line.appendChild(el("b", "live-gain", "+$" + delta.toFixed(2)));
    card.appendChild(line);
    card.appendChild(el("small", null, sub));
    feed.prepend(card);
    requestAnimationFrame(() => card.classList.add("show"));
    while (feed.children.length > 3) feed.lastChild.remove();
    priceEl.classList.remove("bump");
    void priceEl.offsetWidth;
    priceEl.classList.add("bump");
    pts.push([pts.length, price]);
    target += delta;
    animateTo(target);
  }
  draw();
  liveTimers.push(setTimeout(fire, 900));
  const loop = setInterval(() => { fire(); if (i >= EVENTS.length) clearInterval(loop); }, 2800);
  liveTimers.push(loop);
}

/* ---------- join (live room demo) ---------- */
function viewJoin() {
  document.title = "Agora — Join the live demo";
  app.replaceChildren();
  const head = el("div", "view-head");
  head.appendChild(el("h1", null, "Trade it yourself — right now"));
  head.appendChild(el("p", null,
    "Scan to open your own market sandbox — your trades, your prices, your ledger. Simulated dollars."));
  app.appendChild(head);

  const grid = el("div", "grid-2 join-grid");
  const qrPanel = el("section", "panel glass center");
  const qrWrap = el("div", "qr-wrap");
  const img = new Image();
  img.src = "qr.png";
  img.alt = "QR code linking to mustafa-os.github.io/agora-mvp";
  qrWrap.appendChild(img);
  qrPanel.appendChild(qrWrap);
  qrPanel.appendChild(el("p", "sub center-text mono", "mustafa-os.github.io/agora-mvp"));
  grid.appendChild(qrPanel);

  const steps = el("section", "panel");
  steps.appendChild(el("h2", null, "60-second tour"));
  [["1", "Open the Market — the board is live. Tap any athlete."],
   ["2", "Buy a few tokens at any price you want — you set the price, the market remembers it."],
   ["3", "Watch the ticker and your Portfolio update. That price move was you."],
   ["4", "Open the Ledger and hit Verify — your trade is a hash-chained block."],
   ["5", "Try Baskets (own a whole school) or Methodology (re-weight the score and re-rank the board)."]].forEach(([n, t]) => {
    const row = el("div", "join-step");
    row.appendChild(el("b", "join-num", n));
    row.appendChild(el("p", null, t));
    steps.appendChild(row);
  });
  const btnRow = el("div", "btn-row");
  const reset = el("button", "btn ghost", "Reset this device's sandbox");
  reset.addEventListener("click", () => {
    localStorage.clear();
    toast("Sandbox reset — fresh market, fresh ledger");
    buildTicker();
    refreshBadge();
  });
  btnRow.appendChild(reset);
  steps.appendChild(btnRow);
  grid.appendChild(steps);
  app.appendChild(grid);
}

/* ---------- disclosures ---------- */
function viewDisclosures() {
  document.title = "Agora — Disclosures";
  app.replaceChildren();
  const head = el("div", "view-head");
  head.appendChild(el("h1", null, "Disclosures"));
  app.appendChild(head);
  const panel = el("section", "panel");
  [["Educational simulation", "Agora is a student project demo. Nothing here is a security, an offer, an investment product, or investment advice. All trading is simulated with fictional dollars in your browser."],
   ["No athlete ownership", "No user owns any athlete, their income, or their name, image, and likeness. Tokens on this demo represent simulated units only."],
   ["High-school data is fictional", "Every high-school athlete on this platform is invented. No real minor's identity, statistics, or commercial data appears anywhere."],
   ["Minor safeguards", "Athletes under 18 are analytics-only: no price, no token, no trading interface — enforced in the data model, not just the UI."],
   ["College data", "College athletes are real public figures shown with approximate public season statistics for demonstration."],
   ["Commercial values", "All commercial and NIL figures are 0–100 indexes, never dollar valuations."],
   ["Ledger", "The settlement ledger is a local, browser-side simulation using real SHA-256 hash chaining. It is not a public blockchain deployment."],
   ["Attorney review", "All legal, securities, COPPA, and NIL-compliance language requires qualified attorney review before any production launch."]].forEach(([t, body]) => {
    panel.appendChild(el("h2", null, t));
    panel.appendChild(el("p", "sub disc", body));
  });
  app.appendChild(panel);
}

/* ---------- router ---------- */
const state = {};
function route() {
  document.body.classList.remove("splash-mode");
  liveTimers.forEach(t => { clearInterval(t); clearTimeout(t); });
  liveTimers = [];
  const hash = location.hash || "#/market";
  const [path, query] = hash.slice(2).split("?");
  const params = new URLSearchParams(query || "");
  const seg = path.split("/");
  document.querySelectorAll(".nav a").forEach(a => {
    a.classList.toggle("active", a.dataset.nav === (seg[0] || "market"));
  });
  $("#tooltip").hidden = true;
  window.scrollTo(0, 0);
  if (seg[0] === "athlete" && seg[1]) return viewAthlete(Number(seg[1]));
  if (seg[0] === "compare") return viewCompare(params);
  if (seg[0] === "methodology") return viewMethodology();
  if (seg[0] === "baskets") return viewBaskets();
  if (seg[0] === "portfolio") return viewPortfolio();
  if (seg[0] === "ledger") return viewLedger();
  if (seg[0] === "welcome") return viewWelcome();
  if (seg[0] === "live") return viewLive();
  if (seg[0] === "join") return viewJoin();
  if (seg[0] === "disclosures") return viewDisclosures();
  return viewMarket();
}
addEventListener("hashchange", route);
buildTicker();
refreshBadge();
ledger.ensureGenesis();
route();
})();
