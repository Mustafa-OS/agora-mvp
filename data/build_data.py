"""
Agora MVP data pipeline.

Fetches real season-by-season careers from stats.nba.com (nba_api), scores each
season with the Agora valuation model (production x age-runway x availability),
converts value to a share price, and writes site data:

    site/data/players.js   (window.AGORA_DATA = {...})

Run:  .venv/bin/python data/build_data.py     (venv needs nba_api + pandas)

The valuation logic mirrors the TechE_1 engine, adapted to score one season at a
time against fixed league-baseline constants (era-stable approximations of the
per-game mean/SD for NBA rotation players), so careers are comparable across
seasons without needing full league data for every historical year.
"""
import json
import math
import sys
import time
from pathlib import Path

import pandas as pd
from nba_api.stats.endpoints import playercareerstats

OUT = Path(__file__).resolve().parent.parent / "docs" / "data"

# ---------------------------------------------------------------- roster
# (id, name, position, archetype tag, one-line story for the UI)
ROSTER = [
    (2544,    "LeBron James",        "SF", "Blue chip",  "21+ seasons of compounding value — the definition of a blue-chip athlete asset."),
    (201939,  "Stephen Curry",       "PG", "Blue chip",  "Changed the geometry of the sport; a decade of elite production after his first MVP."),
    (201142,  "Kevin Durant",        "SF", "Blue chip",  "Elite scorer whose value survived an Achilles tear — resilience priced in."),
    (203507,  "Giannis Antetokounmpo","PF","Blue chip",  "From anonymous 15th pick to MVP — the single greatest growth story on the board."),
    (203999,  "Nikola Jokic",        "C",  "Blue chip",  "Drafted 41st during a taco ad. Three MVPs later he's the market's most mispriced IPO ever."),
    (203954,  "Joel Embiid",         "C",  "Volatile",   "MVP-level peaks, injury-driven drawdowns — the market's highest-beta large cap."),
    (202695,  "Kawhi Leonard",       "SF", "Volatile",   "Two Finals MVPs; chronic availability risk. Elite mean, brutal variance."),
    (1629029, "Luka Doncic",         "PG", "Growth",     "Teenage phenom to perennial MVP candidate — early investors caught the full curve."),
    (1628983, "Shai Gilgeous-Alexander","PG","Growth",   "Traded as a rookie, re-rated every season since — now the market's top performer."),
    (1628369, "Jayson Tatum",        "SF", "Growth",     "Steady multi-year climb from role player to franchise cornerstone."),
    (1630162, "Anthony Edwards",     "SG", "Growth",     "Face-of-the-league trajectory; the market is pricing the next five years, not the last."),
    (1641705, "Victor Wembanyama",   "C",  "IPO",        "The most anticipated listing in history. Generational upside, thin track record."),
    (1630169, "Tyrese Haliburton",   "PG", "Growth",     "Acquired mid-season in a lopsided trade — the market repriced him within a year."),
    (201565,  "Derrick Rose",        "PG", "Cautionary", "Youngest MVP ever at 22. One ACL later, the steepest de-rating on record."),
    (1629627, "Zion Williamson",     "PF", "Volatile",   "Once-a-generation hype at IPO; availability has capped every rally since."),
    (1627732, "Ben Simmons",         "PG", "Cautionary", "All-NBA at 24, out of the rotation by 27 — why diversification exists."),
    (202322,  "John Wall",           "PG", "Cautionary", "Five straight All-Star seasons, then a max contract met an Achilles tear."),
]

# ---------------------------------------------------------------- model
STAT_WEIGHTS = {
    "PTS": 1.00, "TRB": 0.70, "AST": 0.90, "STL": 0.80,
    "BLK": 0.80, "TOV": -0.70, "TS_PCT": 0.60, "MIN": 0.50,
}
# League baselines (per-game, rotation players; era-stable approximations).
BASE = {
    "PTS": (11.5, 6.0), "TRB": (4.4, 2.6), "AST": (2.6, 2.0),
    "STL": (0.75, 0.35), "BLK": (0.48, 0.45), "TOV": (1.5, 0.75),
    "TS_PCT": (0.565, 0.045), "MIN": (24.0, 6.5),
}
PRIME, DECLINE, YOUTH_BONUS, YOUTH_CAP = 28.0, 0.10, 0.02, 1.15
ELITE_SD_Z = 10.0          # weighted-z at which age resistance saturates
RESISTANCE = 0.5
SEASON_GAMES = {"2011-12": 66, "2019-20": 72, "2020-21": 72}


def season_score(row):
    wz = 0.0
    for stat, w in STAT_WEIGHTS.items():
        mu, sd = BASE[stat]
        wz += w * (row[stat] - mu) / sd
    stats_score = max(5.0, min(99.0, 30.0 + 6.3 * wz))

    age = row["AGE"]
    elite = max(0.0, min(1.0, wz / ELITE_SD_Z))
    eff_decline = DECLINE * (1.0 - RESISTANCE * elite)
    if age <= PRIME:
        age_f = min(1.0 + YOUTH_BONUS * (PRIME - age), YOUTH_CAP)
    else:
        age_f = math.exp(-eff_decline * (age - PRIME))

    games = SEASON_GAMES.get(row["SEASON"], 82)
    avail = min(1.0, row["GP"] / games) ** 0.5

    value = stats_score * age_f * avail
    price = max(8.0, 0.18 * value ** 1.7)
    return round(stats_score, 1), round(age_f, 3), round(avail, 3), round(value, 1), round(price, 2)


def wiggle(pid, season_idx, step):
    """Deterministic intra-season texture, +/-2.5% max."""
    x = math.sin(pid * 0.7919 + season_idx * 12.9898 + step * 78.233) * 43758.5453
    return ((x - math.floor(x)) - 0.5) * 0.05


# Fallback career lines for players the endpoint currently returns empty for
# (stats.nba.com data gap). Public career per-game stats, close-approximate.
# (season, team, age, gp, min, pts, reb, ast, stl, blk, tov, ts)
CURATED = {
    2544: [  # LeBron James
        ("2003-04","CLE",19,79,39.5,20.9,5.5,5.9,1.6,0.7,3.5,.488),
        ("2004-05","CLE",20,80,42.4,27.2,7.4,7.2,2.2,0.7,3.3,.554),
        ("2005-06","CLE",21,79,42.5,31.4,7.0,6.6,1.6,0.8,3.3,.568),
        ("2006-07","CLE",22,78,40.9,27.3,6.7,6.0,1.6,0.7,3.2,.552),
        ("2007-08","CLE",23,75,40.4,30.0,7.9,7.2,1.8,1.1,3.4,.568),
        ("2008-09","CLE",24,81,37.7,28.4,7.6,7.2,1.7,1.1,3.0,.591),
        ("2009-10","CLE",25,76,39.0,29.7,7.3,8.6,1.6,1.0,3.4,.604),
        ("2010-11","MIA",26,79,38.8,26.7,7.5,7.0,1.6,0.6,3.6,.594),
        ("2011-12","MIA",27,62,37.5,27.1,7.9,6.2,1.9,0.8,3.4,.605),
        ("2012-13","MIA",28,76,37.9,26.8,8.0,7.3,1.7,0.9,3.0,.640),
        ("2013-14","MIA",29,77,37.7,27.1,6.9,6.3,1.6,0.3,3.5,.649),
        ("2014-15","CLE",30,69,36.1,25.3,6.0,7.4,1.6,0.7,3.9,.577),
        ("2015-16","CLE",31,76,35.6,25.3,7.4,6.8,1.4,0.6,3.3,.588),
        ("2016-17","CLE",32,74,37.8,26.4,8.6,8.7,1.2,0.6,4.1,.619),
        ("2017-18","CLE",33,82,36.9,27.5,8.6,9.1,1.4,0.9,4.2,.621),
        ("2018-19","LAL",34,55,35.2,27.4,8.5,8.3,1.3,0.6,3.6,.588),
        ("2019-20","LAL",35,67,34.6,25.3,7.8,10.2,1.2,0.5,3.9,.577),
        ("2020-21","LAL",36,45,33.4,25.0,7.7,7.8,1.1,0.6,3.7,.602),
        ("2021-22","LAL",37,56,37.2,30.3,8.2,6.2,1.3,1.1,3.5,.619),
        ("2022-23","LAL",38,55,35.5,28.9,8.3,6.8,0.9,0.6,3.2,.583),
        ("2023-24","LAL",39,71,35.3,25.7,7.3,8.3,1.3,0.5,3.5,.630),
        ("2024-25","LAL",40,70,34.9,24.4,7.8,8.2,1.0,0.6,3.7,.601),
        ("2025-26","LAL",41,55,32.0,21.5,6.8,7.4,0.9,0.5,3.0,.580),
    ],
    1629029: [  # Luka Doncic
        ("2018-19","DAL",19,72,32.2,21.2,7.8,6.0,1.1,0.3,3.4,.545),
        ("2019-20","DAL",20,61,33.6,28.8,9.4,8.8,1.0,0.2,4.3,.585),
        ("2020-21","DAL",21,66,34.3,27.7,8.0,8.6,1.0,0.5,4.3,.589),
        ("2021-22","DAL",22,65,35.4,28.4,9.1,8.7,1.2,0.6,4.5,.571),
        ("2022-23","DAL",23,66,36.2,32.4,8.6,8.0,1.4,0.5,3.6,.610),
        ("2023-24","DAL",24,70,37.5,33.9,9.2,9.8,1.4,0.5,4.0,.617),
        ("2024-25","LAL",25,50,35.4,28.2,8.2,7.7,1.8,0.5,3.6,.580),
        ("2025-26","LAL",26,65,35.5,30.5,8.5,8.5,1.5,0.5,3.5,.600),
    ],
}


def curated_career(pid):
    rows = CURATED[pid]
    df = pd.DataFrame(rows, columns=["SEASON_ID","TEAM_ABBREVIATION","PLAYER_AGE",
                                     "GP","MIN","PTS","REB","AST","STL","BLK","TOV","TS"])
    # synthesize FGA/FTA so the TS computation reproduces the given TS:
    # set FTA=0, FGA = PTS / (2*TS)
    df["FTA"] = 0.0
    df["FGA"] = df["PTS"] / (2.0 * df["TS"])
    return df


def fetch_career(pid):
    df = playercareerstats.PlayerCareerStats(
        player_id=pid, per_mode36="PerGame", timeout=45
    ).get_data_frames()[0]
    if df.empty:
        return None
    # traded seasons have one row per team + a TOT row; keep TOT when present
    keep = []
    for season, grp in df.groupby("SEASON_ID", sort=False):
        tot = grp[grp["TEAM_ABBREVIATION"] == "TOT"]
        keep.append(tot.iloc[0] if len(tot) else grp.iloc[-1])
    return pd.DataFrame(keep)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    players = []
    for pid, name, pos, tag, story in ROSTER:
        try:
            career = fetch_career(pid)
        except Exception as e:
            print(f"  fetch failed {name}: {e}", file=sys.stderr)
            career = None
        if (career is None or career.empty) and pid in CURATED:
            career = curated_career(pid)
            print(f"  (using curated approx data for {name})")
        if career is None or career.empty:
            print(f"  EMPTY  {name}", file=sys.stderr)
            continue

        seasons, series = [], []
        rows = career.reset_index(drop=True)
        for i, r in rows.iterrows():
            fga, fta, pts = float(r["FGA"]), float(r["FTA"]), float(r["PTS"])
            denom = 2.0 * (fga + 0.44 * fta)
            ts = pts / denom if denom > 0 else 0.0
            row = {
                "SEASON": r["SEASON_ID"], "AGE": float(r["PLAYER_AGE"]),
                "GP": int(r["GP"]), "MIN": float(r["MIN"]), "PTS": pts,
                "TRB": float(r["REB"]), "AST": float(r["AST"]),
                "STL": float(r["STL"]), "BLK": float(r["BLK"]),
                "TOV": float(r["TOV"]), "TS_PCT": round(ts, 3),
            }
            s_score, age_f, avail, value, price = season_score(row)
            seasons.append({
                "season": r["SEASON_ID"], "team": r["TEAM_ABBREVIATION"],
                "age": int(row["AGE"]), "gp": row["GP"], "min": row["MIN"],
                "pts": row["PTS"], "reb": row["TRB"], "ast": row["AST"],
                "stl": row["STL"], "blk": row["BLK"], "tov": row["TOV"],
                "ts": row["TS_PCT"], "score": s_score, "ageF": age_f,
                "avail": avail, "value": value, "price": price,
            })

        # monthly price path: 8 steps/season, eased between season anchors
        for i, s in enumerate(seasons):
            p0 = seasons[i - 1]["price"] if i else s["price"] * 0.82
            p1 = s["price"]
            year = int(s["season"][:4])
            for step in range(8):
                f = (step + 1) / 8.0
                eased = p0 + (p1 - p0) * (f * f * (3 - 2 * f))
                p = eased * (1.0 + wiggle(pid, i, step))
                # t = fractional year, Oct (0.79) .. May (+0.37)
                t = year + 0.79 + f * 0.58
                series.append([round(t, 3), round(max(6.0, p), 2)])
        series[-1][1] = seasons[-1]["price"]  # end exactly on the season price

        last, prev = seasons[-1], seasons[-2] if len(seasons) > 1 else seasons[-1]
        players.append({
            "id": pid, "name": name, "pos": pos, "tag": tag, "story": story,
            "team": last["team"], "price": last["price"],
            "change": round((last["price"] - prev["price"]) / prev["price"] * 100, 1),
            "peak": max(s["price"] for s in seasons),
            "from": seasons[0]["season"], "seasons": seasons, "series": series,
        })
        print(f"  ok {name}: {len(seasons)} seasons, ${last['price']:.0f} "
              f"({'+' if last['price'] >= seasons[0]['price'] else ''}"
              f"{(last['price'] / seasons[0]['price'] - 1) * 100:.0f}% since IPO)")
        time.sleep(0.8)

    # S&P 500 approximate season-aligned index (Oct->Oct total-return-ish, %)
    spx_returns = {
        2003: 26, 2004: 9, 2005: 5, 2006: 14, 2007: 4, 2008: -37, 2009: 26,
        2010: 13, 2011: 1, 2012: 14, 2013: 30, 2014: 12, 2015: -1, 2016: 10,
        2017: 19, 2018: -5, 2019: 29, 2020: 16, 2021: 27, 2022: -19,
        2023: 24, 2024: 23, 2025: 12,
    }
    data = {"generated": "2026-07-02", "players": players, "spx": spx_returns}
    js = "window.AGORA_DATA = " + json.dumps(data, separators=(",", ":")) + ";\n"
    (OUT / "players.js").write_text(js)
    print(f"\nWrote {OUT/'players.js'} ({len(players)} players, {len(js)//1024} KB)")


if __name__ == "__main__":
    main()
