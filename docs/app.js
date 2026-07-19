/* Agora MVP — single-file app. No dependencies, no network. */
(() => {
"use strict";

const DATA = window.AGORA_DATA;
const P = DATA.players;
const byId = Object.fromEntries(P.map(p => [p.id, p]));
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
const pct = (v, digits = 1) => (v >= 0 ? "+" : "") + v.toFixed(digits) + "%";
const arrow = v => (Math.abs(v) < 0.05 ? "—" : v >= 0 ? "▲" : "▼");
const initials = name => name.split(" ").map(w => w[0]).slice(0, 2).join("");
const SHARES_OUT = 1e6; // fictional float per athlete, for market-cap texture

/* ---------- S&P index ---------- */
const SHOW_SPX = false;   // benchmark hidden for now — flip to true to restore
const spxLevel = (() => {
  const lv = { 2003: 100 };
  for (let y = 2003; y <= 2026; y++) {
    const r = DATA.spx[y] ?? 8;
    lv[y + 1] = lv[y] * (1 + r / 100);
  }
  return t => {
    const y = Math.floor(t);
    const f = t - y;
    const a = lv[Math.min(2027, Math.max(2003, y))] ?? 100;
    const b = lv[Math.min(2027, Math.max(2003, y + 1))] ?? a;
    return a + (b - a) * f;
  };
})();

/* ================================================================
   Market layer — the engine SUGGESTS a fair value; the MARKET sets
   the traded price. Each athlete gets a deterministic sentiment
   premium/discount vs fair value; any trade you make becomes the
   new last-traded price (stored in this browser).
   ================================================================ */
function sentiment(id) {
  const x = Math.sin(id * 12.9898) * 43758.5453;
  return ((x - Math.floor(x)) - 0.45) * 0.16;   // ≈ −7% … +9%
}
const marketStore = {
  read() { try { return JSON.parse(localStorage.getItem("agora_market")) || {}; } catch { return {}; } },
  write(v) { localStorage.setItem("agora_market", JSON.stringify(v)); },
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
  const s = el("span", "fv-chip " + cls, label);
  return s;
};

/* ---------- index baskets (ETF-style) ---------- */
const BASKETS = [
  { key: "AGX17", name: "Agora 17 Index", desc: "Every listed athlete, equal weight — own the whole board in one click.", filter: () => true },
  { key: "BLUE", name: "Blue Chip Basket", desc: "Proven superstars only. Lower beta, championship pedigree.", filter: p => p.tag === "Blue chip" },
  { key: "GRWTH", name: "Growth Basket", desc: "Rising stars and recent IPOs — the upside sleeve.", filter: p => p.tag === "Growth" || p.tag === "IPO" },
];
const basketMembers = b => P.filter(b.filter);
const basketPrice = b => {
  const m = basketMembers(b);
  return m.reduce((a, p) => a + lastTrade(p), 0) / m.length;
};
const basketFair = b => {
  const m = basketMembers(b);
  return m.reduce((a, p) => a + fairValue(p), 0) / m.length;
};
const basketChange = b => {
  const m = basketMembers(b);
  return m.reduce((a, p) => a + p.change, 0) / m.length;
};
const byBasket = Object.fromEntries(BASKETS.map(b => [b.key, b]));

/* ---------- portfolio store (trade ledger, avg-cost) ---------- */
const store = {
  read() {
    try {
      const v2 = JSON.parse(localStorage.getItem("agora_portfolio_v2"));
      if (v2 && Array.isArray(v2.trades)) return v2;
    } catch { /* fall through */ }
    // migrate v1 entries ({pid, season, amt}) into buy trades at entry price
    let trades = [];
    try {
      const v1 = JSON.parse(localStorage.getItem("agora_portfolio")) || [];
      trades = v1.map(it => {
        const p = byId[it.pid];
        if (!p) return null;
        const entry = priceAtOrAfter(p, it.season);
        return { kind: "buy", type: "ath", id: it.pid, shares: +(it.amt / entry).toFixed(4),
                 price: entry, season: it.season };
      }).filter(Boolean);
    } catch { trades = []; }
    return { trades };
  },
  write(v) { localStorage.setItem("agora_portfolio_v2", JSON.stringify(v)); refreshBadge(); },
  trade(t) { const v = this.read(); v.trades.push(t); this.write(v); },
  clear() { this.write({ trades: [] }); },
  positions() {
    const pos = {};
    let realized = 0;
    this.read().trades.forEach(t => {
      const key = t.type + ":" + t.id;
      const p = pos[key] || (pos[key] = { type: t.type, id: t.id, shares: 0, cost: 0, season: t.season });
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
    const list = Object.values(pos).filter(p => p.shares > 1e-6);
    return { list, realized };
  },
  owned(type, id) {
    const hit = this.positions().list.find(p => p.type === type && p.id === id);
    return hit || { shares: 0, cost: 0 };
  },
};
function refreshBadge() {
  const n = store.positions().list.length;
  const b = $("#portfolioCount");
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
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ================================================================
   SVG chart builder
   series: [{name, color, pts: [[t, value], ...]}]  (shared-ish x domains)
   opts: {height, yFmt, legend, endLabels, annotatePeak, tooltipRows(t) }
   ================================================================ */
function buildChart(container, series, opts = {}) {
  const W = 960, H = opts.height || 300;
  const M = { l: 56, r: opts.endLabels ? 86 : 20, t: 14, b: 30 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;

  const allPts = series.flatMap(s => s.pts);
  const x0 = Math.min(...allPts.map(p => p[0])), x1 = Math.max(...allPts.map(p => p[0]));
  let y1 = Math.max(...allPts.map(p => p[1])) * 1.06;
  let y0 = opts.zeroBase ? 0 : Math.min(...allPts.map(p => p[1])) * 0.92;
  if (y1 - y0 < 1e-9) { y1 += 1; }
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

  // y gridlines + ticks (nice steps)
  const span = y1 - y0;
  const rawStep = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= 5.5) || 10 * mag;
  const yFmt = opts.yFmt || (v => "$" + Math.round(v).toLocaleString());
  for (let v = Math.ceil(y0 / step) * step; v <= y1 + 1e-9; v += step) {
    add(svg, "line", { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v), stroke: "#262b31", "stroke-width": 1 });
    const t = add(svg, "text", { x: M.l - 8, y: Y(v) + 4, "text-anchor": "end", fill: "#737c86", "font-size": 11 });
    t.textContent = yFmt(v);
    t.style.fontVariantNumeric = "tabular-nums";
  }
  // x ticks: years
  const yearSpan = x1 - x0;
  const yearStep = yearSpan > 16 ? 4 : yearSpan > 8 ? 2 : 1;
  for (let y = Math.ceil(x0); y <= Math.floor(x1); y++) {
    if ((y - Math.ceil(x0)) % yearStep !== 0) continue;
    const t = add(svg, "text", { x: X(y), y: H - 8, "text-anchor": "middle", fill: "#737c86", "font-size": 11 });
    t.textContent = String(y);
  }
  add(svg, "line", { x1: M.l, x2: W - M.r, y1: Y(y0), y2: Y(y0), stroke: "#3a4048", "stroke-width": 1 });

  // series (areas under lines only for the first / primary series)
  series.forEach((s, si) => {
    const d = s.pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join(" ");
    if (si === 0 && opts.area !== false) {
      const last = s.pts[s.pts.length - 1], first = s.pts[0];
      add(svg, "path", {
        d: d + ` L ${X(last[0]).toFixed(1)} ${Y(y0)} L ${X(first[0]).toFixed(1)} ${Y(y0)} Z`,
        fill: s.color, opacity: 0.1,
      });
    }
    add(svg, "path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" });
    const last = s.pts[s.pts.length - 1];
    add(svg, "circle", { cx: X(last[0]), cy: Y(last[1]), r: 4.5, fill: s.color, stroke: "#14171c", "stroke-width": 2 });
  });

  // peak annotation (selective direct label, primary series only)
  if (opts.annotatePeak) {
    const s = series[0];
    const peak = s.pts.reduce((a, b) => (b[1] > a[1] ? b : a));
    add(svg, "circle", { cx: X(peak[0]), cy: Y(peak[1]), r: 3.5, fill: s.color, stroke: "#14171c", "stroke-width": 2 });
    const above = Y(peak[1]) > 26;
    const t = add(svg, "text", {
      x: Math.min(Math.max(X(peak[0]), M.l + 30), W - M.r - 30),
      y: above ? Y(peak[1]) - 10 : Y(peak[1]) + 18,
      "text-anchor": "middle", fill: "#a9b1ba", "font-size": 11, "font-weight": 600,
    });
    t.textContent = "peak " + yFmt(peak[1]);
  }

  // end labels for multi-series (with collision nudge)
  if (opts.endLabels && series.length > 1) {
    const ends = series.map(s => ({ name: s.name, color: s.color, y: Y(s.pts[s.pts.length - 1][1]) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++)
      if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
    ends.forEach(e => {
      const t = add(svg, "text", { x: W - M.r + 10, y: e.y + 4, fill: "#a9b1ba", "font-size": 11.5, "font-weight": 600 });
      t.textContent = e.name;
    });
  }

  // crosshair + hover layer (snaps to nearest x of primary series)
  const cross = add(svg, "line", { y1: M.t, y2: M.t + ih, stroke: "#3a4048", "stroke-width": 1, opacity: 0 });
  const dots = series.map(s => add(svg, "circle", { r: 4, fill: s.color, stroke: "#14171c", "stroke-width": 2, opacity: 0 }));
  const hit = add(svg, "rect", { x: M.l, y: M.t, width: iw, height: ih, fill: "transparent" });
  const prim = series[0].pts;
  const tooltip = $("#tooltip");

  function showAt(idx, clientX, clientY) {
    const t = prim[idx][0];
    cross.setAttribute("x1", X(t)); cross.setAttribute("x2", X(t));
    cross.setAttribute("opacity", 1);
    series.forEach((s, si) => {
      let best = 0, bd = Infinity;
      s.pts.forEach((p, i) => { const d = Math.abs(p[0] - t); if (d < bd) { bd = d; best = i; } });
      dots[si].setAttribute("cx", X(s.pts[best][0]));
      dots[si].setAttribute("cy", Y(s.pts[best][1]));
      dots[si].setAttribute("opacity", 1);
      s._hoverVal = s.pts[best][1];
    });
    tooltip.replaceChildren();
    const rows = opts.tooltipRows ? opts.tooltipRows(t) : null;
    if (rows && rows.title) tooltip.appendChild(el("div", "tt-title", rows.title));
    series.forEach(s => {
      const r = el("div", "tt-row");
      const key = el("i"); key.style.borderTopColor = s.color;
      r.appendChild(key);
      r.appendChild(el("span", "tt-val", yFmt(s._hoverVal)));
      r.appendChild(el("span", null, s.name));
      tooltip.appendChild(r);
    });
    if (rows && rows.extra) rows.extra.forEach(line => tooltip.appendChild(el("div", null, line)));
    tooltip.hidden = false;
    const pad = 14, tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let tx = clientX + pad, ty = clientY - th - pad;
    if (tx + tw > innerWidth - 8) tx = clientX - tw - pad;
    if (ty < 8) ty = clientY + pad;
    tooltip.style.left = tx + "px";
    tooltip.style.top = ty + "px";
  }
  function hide() {
    cross.setAttribute("opacity", 0);
    dots.forEach(d => d.setAttribute("opacity", 0));
    tooltip.hidden = true;
  }
  hit.addEventListener("pointermove", e => {
    const r = svg.getBoundingClientRect();
    const t = x0 + ((e.clientX - r.left) / r.width * W - M.l) / iw * (x1 - x0);
    let best = 0, bd = Infinity;
    prim.forEach((p, i) => { const d = Math.abs(p[0] - t); if (d < bd) { bd = d; best = i; } });
    showAt(best, e.clientX, e.clientY);
  });
  hit.addEventListener("pointerleave", hide);

  // keyboard parity
  const box = el("div", "chart-box");
  box.tabIndex = 0;
  box.setAttribute("aria-label", (opts.ariaLabel || "Chart") + " — use left and right arrow keys to read values");
  let kIdx = prim.length - 1;
  box.addEventListener("keydown", e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    kIdx = Math.max(0, Math.min(prim.length - 1, kIdx + (e.key === "ArrowRight" ? 1 : -1)));
    const r = svg.getBoundingClientRect();
    const cx = r.left + (X(prim[kIdx][0]) / W) * r.width;
    showAt(kIdx, cx, r.top + r.height / 2);
  });
  box.addEventListener("blur", hide);

  if (opts.legend && series.length > 1) {
    const lg = el("div", "chart-legend");
    series.forEach(s => {
      const k = el("span", "lg-key");
      const sw = el("i"); sw.style.borderTopColor = s.color;
      k.appendChild(sw);
      k.appendChild(document.createTextNode(s.name));
      lg.appendChild(k);
    });
    container.appendChild(lg);
  }
  box.appendChild(svg);
  container.appendChild(box);
}

/* ---------- sparkline ---------- */
function sparkline(seasons) {
  const pts = seasons.slice(-8).map(s => s.price);
  const W = 110, H = 34, pad = 4;
  const min = Math.min(...pts), max = Math.max(...pts);
  const X = i => pad + (i / (pts.length - 1 || 1)) * (W - 2 * pad);
  const Y = v => H - pad - ((v - min) / (max - min || 1)) * (H - 2 * pad);
  const d = pts.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(" ");
  const up = pts[pts.length - 1] >= pts[pts.length - 2];
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", W); svg.setAttribute("height", H);
  svg.setAttribute("class", "spark"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d); path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#566068"); path.setAttribute("stroke-width", 1.5);
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  const dot = document.createElementNS(ns, "circle");
  dot.setAttribute("cx", X(pts.length - 1)); dot.setAttribute("cy", Y(pts[pts.length - 1]));
  dot.setAttribute("r", 3); dot.setAttribute("fill", up ? "#4ade80" : "#f87171");
  dot.setAttribute("stroke", "#14171c"); dot.setAttribute("stroke-width", 1.5);
  svg.appendChild(dot);
  return svg;
}

/* ---------- ticker ---------- */
function buildTicker() {
  const track = $("#tickerTrack");
  track.replaceChildren();
  const items = [...P, ...P]; // duplicated for seamless loop
  items.forEach(p => {
    const s = el("span", "tick-item");
    const b = el("b", null, tickerSym(p.name));
    s.appendChild(b);
    s.appendChild(document.createTextNode(money(lastTrade(p)) + " "));
    const d = el("span", "delta " + (p.change >= 0 ? "pos" : "neg"), arrow(p.change) + " " + pct(p.change));
    s.appendChild(d);
    track.appendChild(s);
  });
}
const tickerSym = name => name.split(" ").pop().slice(0, 4).toUpperCase();

/* ================================================================ views */
const app = $("#app");

function heroTiles() {
  const totalCap = P.reduce((a, p) => a + lastTrade(p) * SHARES_OUT, 0);
  // best 5-season runner
  let best = null;
  P.forEach(p => {
    const s = p.seasons;
    if (s.length < 6) return;
    const r = (s[s.length - 1].price / s[s.length - 6].price - 1) * 100;
    if (!best || r > best.r) best = { p, r };
  });
  const winners = P.filter(p => p.change >= 0).length;
  return [
    { label: "Market cap (listed athletes)", value: compact(totalCap) },
    { label: "Athletes listed", value: String(P.length) },
    { label: "Best 5-season return", value: pct(best.r, 0), sub: best.p.name, pos: best.r >= 0 },
    { label: "Advancing / declining", value: winners + " / " + (P.length - winners) },
  ];
}

function viewMarket() {
  document.title = "Agora — Market";
  app.replaceChildren();

  const hero = el("section", "hero");
  const h1 = el("h1");
  h1.append("Tomorrow's greatest athletes, ", (() => { const e = el("em", null, "today."); return e; })());
  hero.appendChild(h1);
  hero.appendChild(el("p", null,
    "An emerging asset class: shares in an athlete's future lifetime earnings. Our engine suggests a transparent fair value for 17 real careers — then the market trades around it, just like any exchange. Robinhood opened stocks. Coinbase opened crypto. Agora opens athletes."));
  const tiles = el("div", "tiles");
  heroTiles().forEach(t => {
    const tile = el("div", "tile");
    tile.appendChild(el("div", "t-label", t.label));
    tile.appendChild(el("div", "t-value", t.value));
    if (t.sub) {
      const d = el("div", "t-delta");
      const s = el("span", t.pos ? "pos" : "neg", t.sub);
      d.appendChild(s);
      tile.appendChild(d);
    }
    tiles.appendChild(tile);
  });
  hero.appendChild(tiles);
  app.appendChild(hero);

  // index baskets (ETF-style)
  const bkSection = el("section");
  const bkHead = el("div", "view-head bk-head");
  bkHead.appendChild(el("h2", null, "Index baskets"));
  bkHead.appendChild(el("p", "sub", "Don't want to pick one athlete? Own a slice of many — diversifies single-athlete injury risk."));
  bkSection.appendChild(bkHead);
  const bkRow = el("div", "baskets");
  BASKETS.forEach(b => {
    const card = el("div", "basket panel");
    const top = el("div", "bk-top");
    top.appendChild(el("span", "tag", b.key));
    top.appendChild(el("span", "sub", basketMembers(b).length + " athletes"));
    card.appendChild(top);
    card.appendChild(el("h3", null, b.name));
    card.appendChild(el("p", "sub", b.desc));
    const priceRow = el("div", "bk-price");
    priceRow.appendChild(el("b", null, money(basketPrice(b))));
    const ch = basketChange(b);
    priceRow.appendChild(el("span", "delta " + (ch >= 0 ? "pos" : "neg"), arrow(ch) + " " + pct(ch)));
    card.appendChild(priceRow);
    card.appendChild(el("div", "sub", "Fair value " + money(basketFair(b)) + " per unit"));
    const btn = el("button", "btn small", "Buy 1 unit · " + money(basketPrice(b)));
    btn.addEventListener("click", e => {
      e.stopPropagation();
      store.trade({ kind: "buy", type: "basket", id: b.key, shares: 1, price: basketPrice(b) });
      toast("Bought 1 unit of " + b.name + " at " + money(basketPrice(b)));
    });
    const br = el("div", "btn-row");
    br.appendChild(btn);
    card.appendChild(br);
    bkRow.appendChild(card);
  });
  bkSection.appendChild(bkRow);
  app.appendChild(bkSection);

  // controls
  const controls = el("div", "controls");
  const chips = el("div", "chips");
  const tags = ["All", "Blue chip", "Growth", "Volatile", "Cautionary", "IPO"];
  let activeTag = state.marketTag || "All";
  tags.forEach(tag => {
    const c = el("button", "chip" + (tag === activeTag ? " on" : ""), tag);
    c.addEventListener("click", () => { state.marketTag = tag; viewMarket(); });
    chips.appendChild(c);
  });
  controls.appendChild(chips);
  controls.appendChild(el("span", "spacer"));
  const search = el("input", "search");
  search.type = "search"; search.placeholder = "Search athletes…";
  search.value = state.marketQuery || "";
  search.setAttribute("aria-label", "Search athletes");
  controls.appendChild(search);
  const sort = el("select", "select");
  sort.setAttribute("aria-label", "Sort by");
  [["price", "Last trade"], ["change", "Change"], ["peak", "Career peak"], ["name", "Name"]].forEach(([v, l]) => {
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
      (activeTag === "All" || p.tag === activeTag) &&
      (!q || p.name.toLowerCase().includes(q)));
    const key = state.marketSort || "price";
    rows = rows.slice().sort((a, b) =>
      key === "name" ? a.name.localeCompare(b.name)
      : key === "price" ? lastTrade(b) - lastTrade(a)
      : b[key] - a[key]);

    tableWrap.replaceChildren();
    const table = el("table", "market-table");
    const thead = el("thead");
    const hr = el("tr");
    [["", "hide-sm"], ["Athlete", ""], ["", "hide-sm"], ["Last trade", "num"], ["Fair value", "num hide-sm"],
     ["Vs fair", "num hide-sm"], ["1-season", "num"], ["Trend", "num hide-sm"], ["Mkt cap", "num hide-sm"]].forEach(([t, cls]) => {
      const th = el("th", cls || null, t); hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el("tbody");
    rows.forEach((p, i) => {
      const tr = el("tr");
      tr.tabIndex = 0;
      tr.setAttribute("aria-label", p.name + " " + money(p.price));
      const open = () => { location.hash = "#/athlete/" + p.id; };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", e => { if (e.key === "Enter") open(); });

      tr.appendChild(el("td", "num hide-sm", String(i + 1)));
      const who = el("td");
      const w = el("div", "who");
      w.appendChild(el("span", "avatar", initials(p.name)));
      const nm = el("div");
      nm.appendChild(el("div", "nm", p.name));
      nm.appendChild(el("div", "sub", p.pos + " · " + p.team + (p.approx ? " · approx data" : "")));
      w.appendChild(nm);
      who.appendChild(w);
      tr.appendChild(who);
      const tagTd = el("td", "hide-sm");
      tagTd.appendChild(el("span", "tag", p.tag));
      tr.appendChild(tagTd);
      const lt = el("td", "num");
      lt.appendChild(el("b", null, money(lastTrade(p))));
      tr.appendChild(lt);
      tr.appendChild(el("td", "num hide-sm", money(fairValue(p))));
      const pr = el("td", "num hide-sm");
      pr.appendChild(premChip(p));
      tr.appendChild(pr);
      const d = el("td", "num");
      d.appendChild(el("span", "delta " + (p.change >= 0 ? "pos" : "neg"), arrow(p.change) + " " + pct(p.change)));
      tr.appendChild(d);
      const sp = el("td", "num hide-sm");
      sp.appendChild(sparkline(p.seasons));
      tr.appendChild(sp);
      tr.appendChild(el("td", "num hide-sm", compact(lastTrade(p) * SHARES_OUT)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }
  search.addEventListener("input", () => { state.marketQuery = search.value; renderTable(); });
  sort.addEventListener("change", () => { state.marketSort = sort.value; renderTable(); });
  renderTable();
}

function viewAthlete(id) {
  const p = byId[id];
  if (!p) { location.hash = "#/market"; return; }
  document.title = "Agora — " + p.name;
  app.replaceChildren();

  const back = el("a", "back", "← Back to market");
  back.href = "#/market";
  app.appendChild(back);

  const head = el("div", "ath-head");
  head.appendChild(el("span", "avatar", initials(p.name)));
  const nameBox = el("div");
  const h1 = el("h1", null, p.name);
  nameBox.appendChild(h1);
  const meta = el("div", "ath-meta");
  [p.pos + " · " + p.team, p.tag, "Listed " + p.from].forEach(t => meta.appendChild(el("span", "tag", t)));
  if (p.approx) meta.appendChild(el("span", "tag", "approx season data"));
  nameBox.appendChild(meta);
  head.appendChild(nameBox);
  const priceBox = el("div", "ath-price");
  priceBox.appendChild(el("div", "p", money(lastTrade(p))));
  priceBox.appendChild(el("div", "d sub", "last traded price"));
  const fvLine = el("div", "d fv-line");
  fvLine.appendChild(document.createTextNode("Agora fair value " + money(fairValue(p)) + " · "));
  fvLine.appendChild(premChip(p));
  priceBox.appendChild(fvLine);
  priceBox.appendChild(el("div", "d delta " + (p.change >= 0 ? "pos" : "neg"),
    arrow(p.change) + " " + pct(p.change) + " fair value vs last season"));
  head.appendChild(priceBox);
  app.appendChild(head);

  app.appendChild(el("blockquote", "story", "“" + p.story + "”"));

  // price chart
  const chartPanel = el("section", "panel");
  chartPanel.appendChild(el("h2", null, "Career fair-value history"));
  chartPanel.appendChild(el("p", "sub", "The engine's suggested fair value, season by season · " + p.from + " – " + p.seasons[p.seasons.length - 1].season + " · hover or focus + arrow keys to inspect"));
  buildChart(chartPanel, [{ name: p.name, color: "#16a34a", pts: p.series }], {
    height: 320,
    annotatePeak: true,
    ariaLabel: p.name + " career price history",
    tooltipRows: t => {
      const season = p.seasons.reduce((a, s) => Math.abs(parseInt(s.season) + 1 - t) < Math.abs(parseInt(a.season) + 1 - t) ? s : a);
      return {
        title: season.season + " · " + season.team + " · age " + season.age,
        extra: [
          season.pts.toFixed(1) + " pts · " + season.reb.toFixed(1) + " reb · " + season.ast.toFixed(1) + " ast",
          season.gp + " games · valuation score " + season.score.toFixed(0),
        ],
      };
    },
  });
  app.appendChild(chartPanel);

  // valuation breakdown
  const last = p.seasons[p.seasons.length - 1];
  const bd = el("section", "panel");
  bd.appendChild(el("h2", null, "Why this fair value — the engine's suggested price"));
  bd.appendChild(el("p", "sub", "Latest season (" + last.season + ") through the engine: production × age runway × availability → " + money(last.price) + ". Agora suggests the fair value; buyers and sellers set the traded price."));
  const grid = el("div", "breakdown");
  [
    ["Production score", last.score, 100, last.score.toFixed(0) + " / 100"],
    ["Age runway ×" + last.ageF.toFixed(2), last.ageF, 1.06, "age " + last.age],
    ["Availability ×" + last.avail.toFixed(2), last.avail, 1, last.gp + " games played"],
  ].forEach(([label, v, max, note]) => {
    const row = el("div", "meter-row");
    const lab = el("div", "m-label");
    lab.appendChild(el("span", null, label));
    lab.appendChild(el("b", null, note));
    row.appendChild(lab);
    const m = el("div", "meter");
    const fill = el("i");
    fill.style.width = Math.min(100, (v / max) * 100).toFixed(1) + "%";
    m.appendChild(fill);
    row.appendChild(m);
    grid.appendChild(row);
  });
  bd.appendChild(grid);
  const btnRow = el("div", "btn-row");
  const tmBtn = el("button", "btn ghost", "▸ Open in Time Machine");
  tmBtn.addEventListener("click", () => {
    location.hash = "#/machine?id=" + p.id + "&season=" + encodeURIComponent(p.seasons[0].season) + "&amt=1000";
  });
  btnRow.appendChild(tmBtn);
  bd.appendChild(btnRow);
  app.appendChild(bd);

  // trade panel — buy/sell at ANY price, like a real market
  const tp = el("section", "panel");
  tp.appendChild(el("h2", null, "Trade"));
  tp.appendChild(el("p", "sub", "Set your own price — the market, not the model, decides what " + p.name.split(" ").pop() + " is worth. Your trade becomes the new last-traded price."));
  const tc = el("div", "tm-controls");
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
      ? "You own " + own.shares.toFixed(1) + " shares · avg cost " + money(own.cost / own.shares)
      : "You own no shares yet.";
  };
  const buyBtn = el("button", "btn", "Buy");
  const sellBtn = el("button", "btn ghost", "Sell");
  const doTrade = kind => {
    const q = Number(qtyIn.value) || 0, pr = Number(priceIn.value) || 0;
    if (q <= 0 || pr <= 0) { toast("Enter a price and quantity"); return; }
    if (kind === "sell" && store.owned("ath", p.id).shares < q - 1e-9) {
      toast("You only own " + store.owned("ath", p.id).shares.toFixed(1) + " shares"); return;
    }
    store.trade({ kind, type: "ath", id: p.id, shares: q, price: pr });
    marketStore.setLastTrade(p.id, pr);
    buildTicker();
    toast((kind === "buy" ? "Bought " : "Sold ") + q + " shares of " + p.name + " at " + money(pr));
    viewAthlete(p.id);
  };
  buyBtn.addEventListener("click", () => doTrade("buy"));
  sellBtn.addEventListener("click", () => doTrade("sell"));
  priceIn.addEventListener("input", updateMeta);
  qtyIn.addEventListener("input", updateMeta);
  tc.appendChild(mkF("Your price ($)", priceIn));
  tc.appendChild(mkF("Shares", qtyIn));
  tc.appendChild(totalOut);
  tc.appendChild(buyBtn);
  tc.appendChild(sellBtn);
  tp.appendChild(tc);
  tp.appendChild(holding);
  updateMeta();
  app.appendChild(tp);

  // seasons table
  const st = el("section", "panel");
  st.appendChild(el("h2", null, "Season by season"));
  st.appendChild(el("p", "sub", "Real per-game statistics" + (p.approx ? " (approximated for this athlete)" : " from stats.nba.com") + " — the table behind every chart value."));
  const wrap = el("div", "season-wrap");
  const table = el("table", "seasons");
  const thead = el("thead");
  const hr = el("tr");
  ["Season", "Team", "Age", "GP", "MIN", "PTS", "REB", "AST", "STL", "BLK", "TOV", "TS%", "Score", "Price"].forEach(h => hr.appendChild(el("th", null, h)));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tb = el("tbody");
  p.seasons.slice().reverse().forEach(s => {
    const tr = el("tr");
    [s.season, s.team, s.age, s.gp, s.min.toFixed(1), s.pts.toFixed(1), s.reb.toFixed(1),
     s.ast.toFixed(1), s.stl.toFixed(1), s.blk.toFixed(1), s.tov.toFixed(1),
     (s.ts * 100).toFixed(1), s.score.toFixed(0), money(s.price)].forEach(v => tr.appendChild(el("td", null, String(v))));
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  wrap.appendChild(table);
  st.appendChild(wrap);
  app.appendChild(st);
}

/* ---------- time machine ---------- */
function simulate(p, seasonLabel, amt) {
  const idx = p.seasons.findIndex(s => s.season === seasonLabel);
  if (idx < 0) return null;
  const entry = p.seasons[idx];
  const shares = amt / entry.price;
  const tEntry = parseInt(entry.season) + 0.85;
  const path = p.series.filter(pt => pt[0] >= tEntry - 0.02);
  const value = path.map(pt => [pt[0], shares * pt[1]]);
  const spx0 = spxLevel(tEntry);
  const spx = path.map(pt => [pt[0], amt * spxLevel(pt[0]) / spx0]);
  const exit = value[value.length - 1][1];
  const years = Math.max(0.5, value[value.length - 1][0] - tEntry);
  const cagr = (Math.pow(exit / amt, 1 / years) - 1) * 100;
  let peakV = -Infinity, dd = 0, peakT = tEntry;
  value.forEach(([t, v]) => {
    if (v > peakV) { peakV = v; peakT = t; }
    dd = Math.min(dd, (v - peakV) / peakV * 100);
  });
  const peakSeason = p.seasons.reduce((a, s) => Math.abs(parseInt(s.season) + 1 - peakT) < Math.abs(parseInt(a.season) + 1 - peakT) ? s : a);
  return { entry, shares, value, spx, exit, years, cagr, dd, peakV, peakSeason,
           total: (exit / amt - 1) * 100, spxEnd: spx[spx.length - 1][1] };
}

function narrative(p, sim, amt) {
  const e = sim.entry;
  const bought = `You bought ${money(amt)} of ${p.name} in ${e.season} — age ${e.age}, ` +
    `${e.pts.toFixed(1)} points a game, priced at ${money(e.price)} a share.`;
  if (sim.total >= 60)
    return bought + ` The market re-rated him season after season; your stake peaked at ${money(sim.peakV)} around ${sim.peakSeason.season} and is worth ${money(sim.exit)} today. Early conviction in people compounds.`;
  if (sim.total >= 0)
    return bought + ` A respectable hold: peaks near ${money(sim.peakV)} in ${sim.peakSeason.season}, some drawdowns, and ${money(sim.exit)} today. Athlete assets reward timing the age curve, not just the name.`;
  return bought + ` It peaked at ${money(sim.peakV)} in ${sim.peakSeason.season} — then age and availability repriced the asset to ${money(sim.exit)}. This is why the age curve and injury risk are priced into every Agora valuation, and why diversified athlete baskets exist.`;
}

function viewMachine(params) {
  document.title = "Agora — Time Machine";
  app.replaceChildren();
  const head = el("div", "view-head");
  head.appendChild(el("h1", null, "Time Machine"));
  head.appendChild(el("p", null, "Pick an athlete, a season, and a stake — see what the market would have done to your money." + (SHOW_SPX ? " Benchmarked against the S&P 500 over the identical window." : "")));
  app.appendChild(head);

  const panel = el("section", "panel");
  const controls = el("div", "tm-controls");

  const mkField = (labelText, control) => {
    const f = el("div", "field");
    const lb = el("label", null, labelText);
    f.appendChild(lb);
    f.appendChild(control);
    return f;
  };

  const selAth = el("select", "select");
  P.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
    const o = el("option", null, p.name); o.value = p.id; selAth.appendChild(o);
  });
  const selSeason = el("select", "select");
  const amtIn = el("input", "amount");
  amtIn.type = "number"; amtIn.min = 100; amtIn.step = 100; amtIn.value = params.get("amt") || 1000;
  const goBtn = el("button", "btn", "Run simulation");

  controls.appendChild(mkField("Athlete", selAth));
  controls.appendChild(mkField("Buy in season", selSeason));
  controls.appendChild(mkField("Amount ($)", amtIn));
  controls.appendChild(goBtn);
  panel.appendChild(controls);
  app.appendChild(panel);

  const result = el("section", "panel");
  app.appendChild(result);

  function fillSeasons(p, keep) {
    selSeason.replaceChildren();
    p.seasons.slice(0, -1).forEach(s => {
      const o = el("option", null, s.season + " · age " + s.age + " · " + money(s.price));
      o.value = s.season;
      selSeason.appendChild(o);
    });
    if (keep && [...selSeason.options].some(o => o.value === keep)) selSeason.value = keep;
  }

  function run() {
    const p = byId[selAth.value];
    const amt = Math.max(100, Number(amtIn.value) || 1000);
    const sim = simulate(p, selSeason.value, amt);
    if (!sim) return;
    result.replaceChildren();

    result.appendChild(el("p", "sub", money(amt) + " invested in " + p.name + " · " + sim.entry.season + " → today"));
    result.appendChild(el("div", "hero-num", money(sim.exit)));
    const sub = el("p", "hero-sub");
    const tot = el("span", sim.total >= 0 ? "pos" : "neg", arrow(sim.total) + " " + pct(sim.total, 0));
    sub.appendChild(tot);
    sub.appendChild(document.createTextNode(" total return over " + sim.years.toFixed(1) + " years"));
    result.appendChild(sub);

    const ms = el("div", "mini-stats");
    [
      ["CAGR", pct(sim.cagr, 1)],
      ["Peak value", money(sim.peakV)],
      ["Max drawdown", sim.dd.toFixed(0) + "%"],
      ...(SHOW_SPX ? [["Same $ in S&P 500", money(sim.spxEnd)]] : []),
      ["Shares held", sim.shares.toFixed(1)],
    ].forEach(([l, v]) => {
      const d = el("div", "ms", l);
      d.prepend(el("b", null, v));
      ms.appendChild(d);
    });
    result.appendChild(ms);
    result.appendChild(el("hr")).style.cssText = "border:none;border-top:1px solid var(--hairline);margin:18px 0";

    buildChart(result, [
      { name: p.name + " stake", color: "#16a34a", pts: sim.value },
      ...(SHOW_SPX ? [{ name: "S&P 500", color: "#3987e5", pts: sim.spx }] : []),
    ], {
      height: 300, legend: SHOW_SPX, endLabels: SHOW_SPX, zeroBase: true,
      ariaLabel: SHOW_SPX ? "Investment value versus S&P 500" : "Investment value over time",
      tooltipRows: t => ({ title: (Math.floor(t)) + "–" + (Math.floor(t) + 1 + "").slice(2) + " season window" }),
    });

    result.appendChild(el("p", "narrative", narrative(p, sim, amt)));

    const btnRow = el("div", "btn-row");
    const add = el("button", "btn ghost", "+ Add this trade to portfolio");
    add.addEventListener("click", () => {
      store.trade({ kind: "buy", type: "ath", id: p.id, shares: +sim.shares.toFixed(4),
                    price: sim.entry.price, season: sim.entry.season });
      toast("Added: " + money(amt) + " of " + p.name + " @ " + sim.entry.season);
    });
    btnRow.appendChild(add);
    result.appendChild(btnRow);
  }

  selAth.addEventListener("change", () => { fillSeasons(byId[selAth.value]); run(); });
  selSeason.addEventListener("change", run);
  amtIn.addEventListener("change", run);
  goBtn.addEventListener("click", run);

  // defaults: deep link or the Jokic story
  const initId = params.get("id") || 203999;
  selAth.value = String(byId[initId] ? initId : P[0].id);
  fillSeasons(byId[selAth.value], params.get("season") || "2015-16");
  run();
}

/* ---------- portfolio ---------- */
function priceAtOrAfter(p, seasonLabel) {
  const i = p.seasons.findIndex(s => s.season === seasonLabel);
  return i >= 0 ? p.seasons[i].price : p.seasons[0].price;
}
function viewPortfolio() {
  document.title = "Agora — Portfolio";
  app.replaceChildren();
  const head = el("div", "view-head");
  head.appendChild(el("h1", null, "Your portfolio"));
  head.appendChild(el("p", null, "A ledger of your trades, marked to the last traded price. Returns come two ways: the value of your shares as the brand grows, and — on the roadmap — dividend-style payouts from the athlete's actual brand income."));
  app.appendChild(head);

  const { list, realized } = store.positions();
  if (!list.length) {
    const emp = el("div", "empty");
    emp.appendChild(el("p", null, "No positions yet. Buy an athlete at any price you like, or grab an index basket on the market page."));
    const b = el("button", "btn", "Open the market");
    b.addEventListener("click", () => { location.hash = "#/market"; });
    const b2 = el("button", "btn ghost", "Open the Time Machine");
    b2.addEventListener("click", () => { location.hash = "#/machine"; });
    const row = el("div", "btn-row");
    row.appendChild(b); row.appendChild(b2);
    emp.appendChild(row);
    app.appendChild(emp);
    return;
  }

  const rows = list.map(pos => {
    const isBasket = pos.type === "basket";
    const asset = isBasket ? byBasket[pos.id] : byId[pos.id];
    const mark = isBasket ? basketPrice(asset) : lastTrade(asset);
    const value = pos.shares * mark;
    const avg = pos.cost / pos.shares;
    return { pos, isBasket, asset, mark, value, avg };
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

  const panel = el("section", "panel");
  const table = el("table", "pos-table");
  const thead = el("thead");
  const hr = el("tr");
  ["Asset", "Shares", "Avg cost", "Last trade", "Value", "P/L", ""].forEach(h => hr.appendChild(el("th", null, h)));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tb = el("tbody");
  rows.forEach(r => {
    const tr = el("tr");
    const nameTd = el("td");
    if (r.isBasket) {
      const w = el("div");
      w.appendChild(el("b", null, r.asset.name));
      w.appendChild(el("div", "sub", "index basket · " + basketMembers(r.asset).length + " athletes"));
      nameTd.appendChild(w);
    } else {
      const a = el("a", null, r.asset.name);
      a.href = "#/athlete/" + r.asset.id;
      a.style.color = "var(--ink)";
      a.style.fontWeight = "600";
      nameTd.appendChild(a);
    }
    tr.appendChild(nameTd);
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
        store.trade({ kind: "sell", type: "basket", id: r.asset.key, shares: Math.min(1, r.pos.shares), price: basketPrice(r.asset) });
        toast("Sold 1 unit of " + r.asset.name + " at " + money(basketPrice(r.asset)));
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
  const cb = el("button", "btn ghost", "Clear portfolio");
  cb.addEventListener("click", () => { store.clear(); viewPortfolio(); });
  clr.appendChild(cb);
  panel.appendChild(clr);
  app.appendChild(panel);
}

/* ---------- list with agora ---------- */
function viewList() {
  document.title = "Agora — List with Agora";
  app.replaceChildren();
  const head = el("div", "view-head");
  head.appendChild(el("h1", null, "List with Agora"));
  head.appendChild(el("p", null, "Athletes sell a regulated minority share of their commercial brand entity — never themselves — for capital that funds coaching, travel, and content when it matters most."));
  app.appendChild(head);

  const grid = el("div", "grid-2");

  const left = el("section", "panel");
  left.appendChild(el("h2", null, "IPO pipeline"));
  left.appendChild(el("p", "sub", "Illustrative examples of the athlete side of the market (not real listings)"));
  const pros = el("div", "prospects");
  [
    ["NIL · Basketball", "Point guard, Pac-12 sophomore", "Projected lottery pick. Raising against future brand income to fund elite training staff.", "$120K for 8%"],
    ["NIL · Football", "QB, SEC freshman phenom", "Top-3 jersey sales in conference. Capital for family relocation and media team.", "$250K for 6%"],
    ["Pro · Tennis", "ATP #214, age 19", "Two challenger titles. Funding a full travel season — the gap Agora exists to close.", "$60K for 10%"],
  ].forEach(([tag, name, blurb, ask]) => {
    const c = el("div", "prospect");
    c.appendChild(el("div", "p-tag", tag));
    c.appendChild(el("h3", null, name));
    c.appendChild(el("p", null, blurb));
    const a = el("div", "p-ask");
    a.appendChild(document.createTextNode("Seeking "));
    a.appendChild(el("b", null, ask));
    c.appendChild(a);
    pros.appendChild(c);
  });
  left.appendChild(pros);

  const form = el("form");
  form.style.marginTop = "18px";
  form.appendChild(el("h2", null, "Apply to list"));
  form.appendChild(el("p", "sub", "Demo form — nothing is stored or sent"));
  const fg = el("div", "form-grid");
  const mk = (ph, full, type = "text") => {
    const i = el("input", "search" + (full ? " full" : ""));
    i.placeholder = ph; i.type = type; i.required = true;
    i.setAttribute("aria-label", ph);
    fg.appendChild(i);
    return i;
  };
  mk("Full name");
  mk("Sport & position");
  mk("School / team", false);
  mk("Social following (total)", false, "number");
  mk("What would the capital unlock?", true);
  form.appendChild(fg);
  const fr = el("div", "btn-row");
  const sub = el("button", "btn", "Submit application");
  sub.type = "submit";
  fr.appendChild(sub);
  form.appendChild(fr);
  form.addEventListener("submit", e => {
    e.preventDefault();
    toast("Application received — an Agora analyst will reach out (demo)");
    form.reset();
  });
  left.appendChild(form);
  grid.appendChild(left);

  const right = el("section", "panel");
  right.appendChild(el("h2", null, "How the valuation engine works"));
  right.appendChild(el("p", "sub", "The same transparent model prices every athlete on the market page"));
  const formula = el("div", "formula");
  ["Production", "×", "Age runway", "×", "Availability"].forEach((t, i) => {
    formula.appendChild(el("span", i % 2 ? "f-op" : "f-chip", t));
  });
  right.appendChild(formula);
  const ml = el("ul", "method-list");
  [
    "Production — per-game output (including made threes) scored against the athlete's own position (75%) blended with the league (25%), so a guard's profile competes fairly with a center's. Efficiency counts more at higher scoring volume; no single stat can dominate a score; turnovers subtract.",
    "Age runway — a small premium for prospects under 25, full value through the 25–30 prime, then a gentle decline that elite current production slows by up to 65% (sustained greatness is rewarded, reputation is not). The factor never drops below 0.75 — proven stars stay investable.",
    "Availability — games played remembered across three seasons with a fast-recovery clause, discounting the price once. A short injured season is a drawdown, never a delisting: talent is carried forward through small samples, because an ACL doesn't make you worse at basketball.",
    "Track record — first-, second- and third-year valuations are shrunk toward a league-average prior, so one hot rookie season can't out-price a proven MVP.",
    "Fair value — only production above a replacement-level player has market value (the VORP idea), mapped to a suggested price on a convex curve. Stars separate sharply; early conviction gets paid — rookie Curry cost $78, peak Curry hit $341.",
    "Market price — the engine only SUGGESTS fair value. Buyers and sellers trade at any price they choose, and the last trade is the market price. The model is the anchor, never a decree.",
    "Why invest — two return paths: equity appreciation as the brand grows, and (roadmap) dividend-style payouts from the athlete's actual NIL and endorsement income.",
    "Roadmap — a brand-signal layer (NIL deal comps, social reach, search interest) multiplies on top for off-court equity: the H2 hypothesis from our OAP I deck.",
  ].forEach(t => ml.appendChild(el("li", null, t)));
  right.appendChild(ml);
  const cta = el("div", "btn-row");
  const b1 = el("button", "btn", "See it price a career");
  b1.addEventListener("click", () => { location.hash = "#/athlete/203999"; });
  cta.appendChild(b1);
  right.appendChild(cta);
  grid.appendChild(right);

  app.appendChild(grid);
}

/* ---------- router ---------- */
const state = {};
function route() {
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
  if (seg[0] === "machine") return viewMachine(params);
  if (seg[0] === "portfolio") return viewPortfolio();
  if (seg[0] === "list") return viewList();
  return viewMarket();
}
addEventListener("hashchange", route);
buildTicker();
refreshBadge();
route();
})();
