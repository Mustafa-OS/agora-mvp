"""
Agora v3 data pipeline — high school & college athletes only.

Merges the Agora Score intelligence model (six weighted 0-100 dimensions:
production, availability, recruiting, audience, commercial, runway) with the
market pricing layer (score -> suggested fair value via replacement-surplus
convex curve). Shares are represented as tokens; the app records every trade
on a hash-chained ledger client-side.

    python data/build_data.py        (no network needed — curated rosters)

Data policy (mirrors the legal framework):
  * College athletes: real players, approximate public season lines, adults.
  * High school athletes: ENTIRELY FICTIONAL (isDemo) — real minors are never
    listed. Athletes under 18 are analytics-only: no price, no trading.
"""
import json
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "docs" / "data"

# ================================================================ rosters
# College (real players, approx 2025-26 lines, all 18+).
# (name, school, abbrev, state, pos, class, age, gp, min, pts, reb, ast,
#  stl, blk, tov, ts, tpm, natl_rank, rating, followers_k, engagement,
#  growth90, nil_count, momentum, maturity, story)
COLLEGE = [
    ("AJ Dybantsa", "BYU", "BYU", "UT", "SF", "Freshman", 19, 31, 33.0, 21.8, 7.0, 3.8, 1.3, 0.9, 2.7, .590, 1.8,
     1, 0.998, 2100, 6.8, 22, 9, 88, "Premium",
     "Projected No. 1 pick in 2026 — the most valuable listing on the college board."),
    ("Cameron Boozer", "Duke", "DUKE", "NC", "PF", "Freshman", 18, 33, 32.0, 20.5, 9.8, 3.6, 1.2, 1.1, 2.3, .620, 1.1,
     2, 0.997, 1450, 5.9, 15, 7, 82, "Established",
     "Duke legacy, double-double machine — championship pedigree priced early."),
    ("Darryn Peterson", "Kansas", "KU", "KS", "SG", "Freshman", 19, 30, 33.5, 22.4, 4.6, 4.9, 1.5, 0.5, 2.9, .600, 2.6,
     3, 0.997, 980, 5.1, 18, 6, 78, "Established",
     "Shot-making guard fighting Dybantsa for the No. 1 conversation."),
    ("Nate Ament", "Tennessee", "TENN", "TN", "SF", "Freshman", 18, 32, 31.0, 17.9, 6.8, 2.4, 1.0, 1.2, 2.4, .565, 2.0,
     4, 0.994, 620, 4.6, 25, 4, 66, "Active",
     "Wiry two-way wing with a Durant-shaped growth curve."),
    ("Cayden Boozer", "Duke", "DUKE", "NC", "PG", "Freshman", 18, 33, 29.0, 12.8, 3.4, 6.7, 1.1, 0.1, 2.1, .585, 1.4,
     11, 0.989, 830, 4.9, 12, 5, 70, "Active",
     "Elite floor general in the Duke machine — the other half of the Boozer duo."),
    ("Koa Peat", "Arizona", "ZONA", "AZ", "PF", "Freshman", 19, 34, 29.5, 15.6, 7.9, 2.9, 1.1, 0.8, 2.5, .580, 0.4,
     7, 0.991, 410, 4.2, 9, 3, 58, "Active",
     "Physical forward who wins every 50-50 ball — floor-raiser archetype."),
    ("Braden Smith", "Purdue", "PURD", "IN", "PG", "Senior", 22, 34, 34.0, 16.2, 4.8, 9.1, 2.1, 0.2, 2.8, .590, 2.4,
     28, 0.972, 350, 3.8, 6, 5, 62, "Active",
     "The nation's best pure point guard — near-term, established value."),
    ("JT Toppin", "Texas Tech", "TTU", "TX", "PF", "Junior", 22, 33, 31.5, 20.3, 9.4, 2.1, 0.9, 1.2, 2.2, .620, 0.6,
     19, 0.978, 290, 3.5, 8, 4, 60, "Active",
     "Production machine — the college board's most bankable stat line."),
    ("Jayden Quaintance", "Kentucky", "UK", "KY", "C", "Sophomore", 18, 30, 28.0, 14.1, 8.6, 2.3, 1.2, 2.9, 2.0, .600, 0.2,
     9, 0.990, 380, 4.4, 14, 3, 56, "Emerging",
     "Youngest elite rim protector in the country — Kentucky's next big export."),
    ("Mikel Brown Jr", "Louisville", "LOU", "KY", "PG", "Freshman", 19, 33, 32.0, 18.7, 3.9, 5.9, 1.3, 0.2, 2.8, .570, 2.7,
     8, 0.990, 540, 4.7, 16, 4, 64, "Active",
     "Shifty lead guard — the highest-usage freshman offense in the ACC."),
    # Team demo listing: Agora co-founder, listed with consent; stats are demo.
    ("Azan Evans", "NUS", "NUS", "SG", "SG", "Sophomore", 20, 31, 33.5, 19.8, 5.3, 5.9, 1.4, 0.4, 2.0, .588, 2.3,
     9, 0.990, 480, 6.6, 24, 5, 66, "Active",
     "Four-star recruit turned founder — now at NUS, building the market he plays in. Team demo listing."),
]
AZAN_DEMO = {"Azan Evans"}   # real team member, listed with consent, demo stats

# G League (real players, approximate 2025-26 lines, adults — the pro
# pathway tier between college and the NBA; "rank" = pathway consensus).
# (name, team, abbrev, state, pos, class label, age, gp, min, pts, reb, ast,
#  stl, blk, tov, ts, tpm, rank, rating, followers_k, engagement, growth90,
#  nil_count, momentum, maturity, story)
GLEAGUE = [
    ("Mac McClung", "Osceola Magic", "OSC", "FL", "SG", "4th Year Pro", 27, 30, 34.0, 25.9, 4.6, 6.5, 1.1, 0.2, 2.6, .594, 2.3,
     18, 0.982, 1500, 7.2, 10, 7, 76, "Established",
     "Three-time NBA dunk champion and the G League's biggest draw — proof the pathway builds brands."),
    ("JD Davison", "Maine Celtics", "MNE", "ME", "PG", "3rd Year Pro", 23, 32, 33.5, 21.4, 4.9, 8.2, 1.5, 0.3, 3.0, .565, 1.7,
     24, 0.978, 210, 4.1, 8, 3, 54, "Active",
     "Reigning G League MVP — the call-up candidate every contender is watching."),
    ("Dink Pate", "Mexico City Capitanes", "MEX", "MX", "SG", "3rd Year Pro", 20, 29, 30.0, 15.8, 5.1, 4.3, 1.2, 0.4, 2.4, .548, 1.5,
     14, 0.985, 380, 5.3, 18, 4, 58, "Active",
     "Skipped college entirely — the youngest pro in the pathway, still on the draft radar."),
    ("Oscar Tshiebwe", "Salt Lake City Stars", "SLC", "UT", "C", "3rd Year Pro", 26, 31, 31.0, 17.2, 13.8, 1.3, 1.0, 1.4, 1.9, .612, 0.1,
     30, 0.972, 290, 3.9, 6, 3, 48, "Emerging",
     "National college player of the year turned double-double machine — rebounding is a business model."),
]

# High school (FICTIONAL — no real minors are ever listed; names invented).
# Age >= 18 -> listable seniors; age < 18 -> analytics-only, never tradable.
HIGHSCHOOL = [
    ("Jordan Harmon",  "Wheeler HS",      "GA", "SF", "HS Class of 2027", 18, 3, 0.996, 26, 24.1, 8.2, 4.1, .565, 1120, 7.4, 31, 6, 74, "Active",
     "Cursor-breaking athleticism and a jumper that travels — the top HS listing."),
    ("Marcus Webb",    "Montverde Acad.", "FL", "PG", "HS Class of 2027", 18, 7, 0.993, 27, 18.8, 3.9, 8.8, .580, 860, 6.1, 24, 4, 68, "Active",
     "Runs a national-championship offense like a 10-year pro."),
    ("Elijah Cross",   "Liberty HS",      "NV", "SG", "HS Class of 2027", 18, 18, 0.985, 25, 21.6, 4.4, 3.2, .572, 640, 5.5, 19, 3, 60, "Emerging",
     "Three-level scorer with the smoothest pull-up in the class."),
    ("Kai Washington", "IMG Academy",     "FL", "PF", "HS Class of 2027", 18, 24, 0.981, 24, 16.9, 9.1, 2.6, .590, 380, 4.8, 12, 2, 52, "Emerging",
     "Motor-first forward — every possession is a fight he usually wins."),
    ("Tyson Mercer",   "Brentwood Acad.", "TN", "PG", "HS Class of 2028", 17, 8, 0.992, 24, 19.4, 4.0, 7.2, .575, 720, 6.6, 28, 0, 55, "Pre-Commercial",
     "Analytics only — a junior with a senior's command of tempo."),
    ("Cameron Reid",   "Cardinal Hayes",  "NY", "PG", "HS Class of 2028", 17, 4, 0.995, 25, 20.2, 3.8, 7.9, .584, 910, 7.1, 35, 0, 58, "Pre-Commercial",
     "Analytics only — the best passing instincts in prep basketball."),
    ("Nathan Cole",    "Riverdale HS",    "FL", "SF", "HS Class of 2028", 17, 11, 0.988, 25, 17.5, 6.8, 3.4, .560, 480, 5.2, 21, 0, 48, "Pre-Commercial",
     "Analytics only — a sophomore wing scouts cross state lines to watch."),
    ("Andre Morrison", "Oak Hill Acad.",  "VA", "SG", "HS Class of 2027", 18, 22, 0.982, 26, 18.1, 4.6, 2.9, .568, 410, 4.9, 15, 2, 50, "Emerging",
     "Catch-and-shoot specialist with a rapidly widening off-the-dribble game."),
]

# ================================================================ Agora Score
# Six dimensions, 0-100 each, weighted composite (weights sum to 1.0).
WEIGHTS = {
    "production":  0.30,   # on-court output, position-adjusted
    "availability": 0.20,  # games played / reliability
    "recruiting":  0.20,   # national rank + composite rating
    "audience":    0.15,   # followers, engagement, growth
    "commercial":  0.10,   # verified NIL activity + momentum
    "runway":      0.05,   # remaining development years
}

def norm(v, lo, hi):
    if v is None:
        return 0.0
    return max(0.0, min(1.0, (v - lo) / (hi - lo)))

def production_score(pos, pts, reb, ast, ts, level):
    # competition scaling: HS numbers discounted, G League premium
    scale = {"college": 1.0, "gleague": 1.10, "hs": 0.88}[level]
    p = norm(pts * scale, 6, 26)
    r = norm(reb * scale, 1, 12)
    a = norm(ast * scale, 0.5, 9)
    e = norm(ts, 0.48, 0.66)
    if pos in ("PG", "SG"):
        s = p * 0.40 + a * 0.30 + r * 0.10 + e * 0.20
    elif pos == "SF":
        s = p * 0.40 + a * 0.18 + r * 0.22 + e * 0.20
    else:
        s = p * 0.38 + a * 0.10 + r * 0.32 + e * 0.20
    return round(s * 100, 1)

def availability_score(gp, games):
    return round(norm(gp / games, 0.60, 1.0) * 100, 1)

def recruiting_score(rank, rating):
    rank_s = norm(151 - rank, 1, 150)          # rank 1 -> 1.0
    rating_s = norm(rating, 0.95, 1.0)
    return round((rank_s * 0.60 + rating_s * 0.40) * 100, 1)

def audience_score(followers_k, engagement, growth90):
    f = norm(followers_k, 0, 2000)
    e = norm(engagement, 0, 10)
    g = norm(growth90, 0, 40)
    return round((f * 0.50 + e * 0.30 + g * 0.20) * 100, 1)

def commercial_score(nil_count, momentum):
    n = norm(nil_count, 0, 10)
    return round((n * 0.45 + (momentum / 100.0) * 0.55) * 100, 1)

def runway_score(age, level):
    years_left = max(0, {"college": 23, "gleague": 27, "hs": 24}[level] - age)
    return round(norm(years_left, 0, 6) * 100, 1)

def agora_score(subs, weights=WEIGHTS):
    total = sum(subs[k] * w for k, w in weights.items())
    return round(total, 1)

# ---- price: replacement-surplus convex curve on the Agora Score ----
V_REPLACEMENT, PRICE_K, PRICE_EXP, PRICE_FLOOR = 28.0, 0.55, 1.62, 5.0
HS_DISCOUNT = 0.65   # development-risk haircut: prep production is unproven

def price_from(score, avail_sub, level="college"):
    surplus = max(0.0, score - V_REPLACEMENT)
    avail_f = 0.75 + 0.25 * (avail_sub / 100.0)
    p = PRICE_K * surplus ** PRICE_EXP * avail_f
    if level == "hs":
        p *= HS_DISCOUNT
    return max(PRICE_FLOOR, p)

def wiggle(seed, i):
    x = math.sin(seed * 0.7919 + i * 12.9898) * 43758.5453
    return ((x - math.floor(x)) - 0.5) * 0.045


# ---- realistic market microstructure (deterministic per athlete) ----------
# Daily closes over the season: low-vol geometric walk (sigma ~0.8%/day) with
# mean reversion toward the fair-value anchor, plus a handful of NEWS EVENTS
# that gap the price (draft buzz, injuries, signature games). One trading day
# never moves more than ~2% without a labeled event attached.
SEASON_DAYS = 178          # Nov 1 -> late Apr
DAILY_SIGMA = 0.008
REVERT = 0.015
INTRADAY_HOURS = 24
INTRADAY_SIGMA = 0.0028

EVENT_LIBRARY = [
    ("Signature game — statement win",        +0.049),
    ("National TV breakout performance",      +0.062),
    ("Draft stock rising — mock lottery",     +0.078),
    ("Minor ankle sprain in practice",        -0.054),
    ("Named conference player of the week",   +0.036),
    ("Cold stretch — three quiet games",      -0.031),
    ("Viral highlight — audience spike",      +0.042),
    ("Flu game DNP",                          -0.026),
    ("Rivalry-week double-double",            +0.033),
    ("Declared for the 2026 Draft",           +0.088),
]

def rng(seed):
    state = [seed * 2654435761 % 2**32]
    def nxt():
        state[0] = (1103515245 * state[0] + 12345) % 2**31
        return state[0] / 2**31
    return nxt

def market_series(seed, anchor):
    """Returns (daily [[day, px]], intraday [[hour, px]], events [{d,label,pct}])."""
    r = rng(seed)
    n_events = 3 + int(r() * 3)                       # 3-5 events per season
    event_days = sorted({12 + int(r() * (SEASON_DAYS - 30)) for _ in range(n_events)})
    events = []
    picks = set()
    for d in event_days:
        k = int(r() * len(EVENT_LIBRARY))
        while k in picks:
            k = (k + 1) % len(EVENT_LIBRARY)
        picks.add(k)
        events.append({"d": d, "label": EVENT_LIBRARY[k][0], "pct": EVENT_LIBRARY[k][1]})

    total_jump = sum(e["pct"] for e in events)
    start = anchor / ((1 + total_jump) * 1.04)        # walk ends near the anchor
    px, daily = start, []
    for d in range(SEASON_DAYS + 1):
        shock = (r() - 0.5) * 2 * DAILY_SIGMA
        px *= 1 + shock
        px += (anchor / (1 + sum(e["pct"] for e in events if e["d"] > d)) - px) * REVERT
        for e in events:
            if e["d"] == d:
                px *= 1 + e["pct"]
        daily.append([d, max(2.0, px)])
    # glide the final stretch onto the anchor (no artificial last-day jump)
    K = 20
    end_val = daily[-1][1]
    ratio = anchor / end_val
    for i in range(len(daily) - K, len(daily)):
        f = (i - (len(daily) - K) + 1) / K
        daily[i][1] = daily[i][1] * (ratio ** f)
    daily = [[d, round(v, 2)] for d, v in daily]
    daily[-1][1] = round(anchor, 2)

    intraday, ipx = [], daily[-2][1]
    for h in range(INTRADAY_HOURS + 1):
        ipx *= 1 + (r() - 0.5) * 2 * INTRADAY_SIGMA
        ipx += (anchor - ipx) * 0.08
        intraday.append([h, max(2.0, ipx)])
    iratio = anchor / intraday[-1][1]
    for i in range(len(intraday) - 6, len(intraday)):
        f = (i - (len(intraday) - 6) + 1) / 6
        intraday[i][1] = intraday[i][1] * (iratio ** f)
    intraday = [[h, round(v, 2)] for h, v in intraday]
    intraday[-1][1] = round(anchor, 2)
    return daily, intraday, events

def token_symbol(name, used):
    if name == "Azan Evans":
        used.add("$AZAN")
        return "$AZAN"
    last = name.split(" ")[-1] if not name.endswith("Jr") else name.split(" ")[-2]
    for cand in (last[:3], last[:4], (name.split(" ")[0][0] + last[:3])):
        s = "$" + cand.upper()
        if s not in used:
            used.add(s)
            return s
    s = "$" + last[:2].upper() + str(len(used))
    used.add(s)
    return s

def price_series(seed, anchor, n_seasons=1):
    """Eased monthly path ending exactly at the anchor price."""
    pts = []
    p0 = anchor * 0.78
    for i in range(10):
        f = (i + 1) / 10.0
        eased = p0 + (anchor - p0) * (f * f * (3 - 2 * f))
        t = 2025.79 + f * 0.58
        pts.append([round(t, 3), round(max(3.0, eased * (1 + wiggle(seed, i))), 2)])
    pts[-1][1] = round(anchor, 2)
    return pts

# ================================================================ build
def build():
    players, used_syms = [], set()
    pid = 100

    for row in COLLEGE:
        (name, school, ab, state, pos, cls, age, gp, mins, pts, reb, ast, stl, blk,
         tov, ts, tpm, rank, rating, fol, eng, gro, nil_n, mom, mat, story) = row
        subs = {
            "production": production_score(pos, pts, reb, ast, ts, "college"),
            "availability": availability_score(gp, 34),
            "recruiting": recruiting_score(rank, rating),
            "audience": audience_score(fol, eng, gro),
            "commercial": commercial_score(nil_n, mom),
            "runway": runway_score(age, "college"),
        }
        score = agora_score(subs)
        pr = price_from(score, subs["availability"], "college")
        players.append({
            "id": pid, "name": name, "level": "College", "school": school,
            "team": ab, "state": state, "pos": pos, "cls": cls, "age": age,
            "minor": age < 18, "demo": name in AZAN_DEMO, "token": token_symbol(name, used_syms),
            "rank": rank, "rating": rating, "gp": gp, "min": mins, "pts": pts,
            "reb": reb, "ast": ast, "stl": stl, "blk": blk, "tov": tov,
            "ts": ts, "tpm": tpm,
            "followersK": fol, "engagement": eng, "growth90": gro,
            "nil": nil_n, "momentum": mom, "maturity": mat,
            "subs": subs, "score": score,
            "price": round(pr, 2),
            "story": story,
        })
        pid += 1

    for row in GLEAGUE:
        (name, teamname, ab, state, pos, cls, age, gp, mins, pts, reb, ast, stl, blk,
         tov, ts, tpm, rank, rating, fol, eng, gro, nil_n, mom, mat, story) = row
        subs = {
            "production": production_score(pos, pts, reb, ast, ts, "gleague"),
            "availability": availability_score(gp, 34),
            "recruiting": recruiting_score(rank, rating),
            "audience": audience_score(fol, eng, gro),
            "commercial": commercial_score(nil_n, mom),
            "runway": runway_score(age, "gleague"),
        }
        score = agora_score(subs)
        pr = price_from(score, subs["availability"], "gleague")
        players.append({
            "id": pid, "name": name, "level": "G League", "school": teamname,
            "team": ab, "state": state, "pos": pos, "cls": cls, "age": age,
            "minor": False, "demo": False, "token": token_symbol(name, used_syms),
            "rank": rank, "rating": rating, "gp": gp, "min": mins, "pts": pts,
            "reb": reb, "ast": ast, "stl": stl, "blk": blk, "tov": tov,
            "ts": ts, "tpm": tpm,
            "followersK": fol, "engagement": eng, "growth90": gro,
            "nil": nil_n, "momentum": mom, "maturity": mat,
            "subs": subs, "score": score,
            "price": round(pr, 2),
            "story": story,
        })
        pid += 1

    for row in HIGHSCHOOL:
        (name, schoolname, state, pos, cls, age, rank, rating, gp, pts, reb, ast,
         ts, fol, eng, gro, nil_n, mom, mat, story) = row
        subs = {
            "production": production_score(pos, pts, reb, ast, ts, "hs"),
            "availability": availability_score(gp, 28),
            "recruiting": recruiting_score(rank, rating),
            "audience": audience_score(fol, eng, gro),
            "commercial": commercial_score(nil_n, mom),
            "runway": runway_score(age, "hs"),
        }
        score = agora_score(subs)
        minor = age < 18
        pr = None if minor else round(price_from(score, subs["availability"], "hs"), 2)
        players.append({
            "id": pid, "name": name, "level": "High School", "school": schoolname,
            "team": state, "state": state, "pos": pos, "cls": cls, "age": age,
            "minor": minor, "demo": True, "token": None if minor else token_symbol(name, used_syms),
            "rank": rank, "rating": rating, "gp": gp, "min": None, "pts": pts,
            "reb": reb, "ast": ast, "stl": None, "blk": None, "tov": None,
            "ts": ts, "tpm": None,
            "followersK": fol, "engagement": eng, "growth90": gro,
            "nil": nil_n, "momentum": mom, "maturity": mat,
            "subs": subs, "score": score,
            "price": pr,
            "story": story,
        })
        pid += 1

    for p in players:
        if p["price"]:
            daily, intraday, events = market_series(p["id"], p["price"])
            p["daily"], p["intraday"], p["events"] = daily, intraday, events
            p["change1d"] = round((daily[-1][1] / daily[-2][1] - 1) * 100, 2)
            p["change1w"] = round((daily[-1][1] / daily[-8][1] - 1) * 100, 2)
        else:
            p["daily"], p["intraday"], p["events"] = [], [], []
            p["change1d"] = p["change1w"] = None

    data = {
        "generated": "2026-07-22", "model": "v3.1-market",
        "weights": WEIGHTS, "players": players,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    js = "window.AGORA_DATA = " + json.dumps(data, separators=(",", ":")) + ";\n"
    (OUT / "players.js").write_text(js)
    listed = [p for p in players if p["price"]]
    print(f"wrote players.js — {len(players)} athletes "
          f"({len(listed)} listed, {len(players) - len(listed)} analytics-only minors)")
    for p in sorted(players, key=lambda x: -(x["price"] or 0)):
        tag = p["token"] or "analytics-only"
        print(f"  {p['name']:20s} {p['level']:12s} score {p['score']:5.1f}  "
              f"{('$' + format(p['price'], '.2f')) if p['price'] else '—':>9s}  {tag}")


if __name__ == "__main__":
    build()
