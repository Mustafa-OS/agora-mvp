# Agora — MVP demo

**The athlete brand alternative-asset market.** Product demo built for the ENGR145
(Stanford Technology Entrepreneurship) OAP I presentation.

**Live:** https://mustafa-os.github.io/agora-mvp/

## What it shows

- **Market** — 17 real NBA careers priced by a transparent valuation engine
  (production × age runway × availability), listed like equities with prices,
  sparklines, and market caps.
- **Athlete pages** — a career as a price history: MVP runs, injuries, and
  aging repriced season by season, with a "why this price" breakdown.
- **Time Machine** — invest $X in any athlete in any past season and see the
  outcome today: total return, CAGR, max drawdown, and an honest S&P 500
  comparison over the identical window.
- **Portfolio** — build a basket across careers; positions persist locally.
- **List with Agora** — the athlete side: illustrative IPO pipeline and the
  valuation methodology, including the roadmap brand-signal layer (OAP I
  hypothesis H2).

## Why these 17 athletes

Deliberately not just winners: blue chips (LeBron, Curry, Jokic), growth
stories (SGA, Edwards, Wembanyama), volatility (Embiid, Kawhi, Zion), and
cautionary tales (Rose, Simmons, Wall). An investment demo that only shows
winners is a betting ad; this one prices risk.

## Architecture

- `data/build_data.py` — pipeline: pulls per-season careers from stats.nba.com
  (nba_api), scores each season with the valuation model, converts value to a
  share price on a convex curve, writes `docs/data/players.js`.
- `docs/` — dependency-free static app (vanilla JS + hand-rolled SVG charts),
  hosted on GitHub Pages.

Disclaimers: educational simulation; prices are model-derived from public
performance data; nothing is a security or investment advice. LeBron James and
Luka Dončić season lines are close approximations (source gap at build time);
S&P 500 comparison uses approximate annual returns.
