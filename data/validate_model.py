"""
Model sanity harness. Run AFTER build_data.py:

    .venv/bin/python data/validate_model.py

Loads docs/data/players.js and asserts career shapes AND investor ROI match
basketball reality. Any FAIL means the model needs tuning before shipping.
"""
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "docs" / "data" / "players.js"


def load():
    raw = DATA.read_text()
    return json.loads(raw.replace("window.AGORA_DATA = ", "").rstrip(";\n"))


def season_price(p, season):
    for s in p["seasons"]:
        if s["season"] == season:
            return s["price"]
    return None


def peak_season(p):
    return max(p["seasons"], key=lambda s: s["price"])


def roi(p):
    """Rookie IPO -> career peak multiple."""
    return peak_season(p)["price"] / p["seasons"][0]["price"]


def main():
    data = load()
    P = {p["name"]: p for p in data["players"]}
    checks, failures = [], []

    def check(name, ok, detail):
        checks.append((name, ok, detail))
        if not ok:
            failures.append(name)

    cur, leb, jok = P["Stephen Curry"], P["LeBron James"], P["Nikola Jokic"]
    wem, rose, sga = P["Victor Wembanyama"], P["Derrick Rose"], P["Shai Gilgeous-Alexander"]
    gia = P["Giannis Antetokounmpo"]

    # --- ROI: the product has to make early conviction pay
    check("Curry rookie IPO is cheap (<= $85)",
          cur["seasons"][0]["price"] <= 85, f"${cur['seasons'][0]['price']}")
    check("Curry rookie->peak ROI >= 4x",
          roi(cur) >= 4.0, f"{roi(cur):.1f}x (${cur['seasons'][0]['price']} -> ${peak_season(cur)['price']})")
    check("Giannis rookie->peak ROI >= 8x (the growth story)",
          roi(gia) >= 8.0, f"{roi(gia):.1f}x")
    check("SGA rookie->peak ROI >= 4x",
          roi(sga) >= 4.0, f"{roi(sga):.1f}x")

    # --- Curry career shape
    check("Curry peak is unanimous-MVP 2015-16",
          peak_season(cur)["season"] == "2015-16",
          f"peak={peak_season(cur)['season']} ${peak_season(cur)['price']}")
    check("Curry peak >= $250",
          peak_season(cur)["price"] >= 250, f"${peak_season(cur)['price']}")
    check("Curry scoring-title season (2020-21, age 33) >= $130",
          (season_price(cur, "2020-21") or 0) >= 130,
          f"${season_price(cur, '2020-21')}")
    check("Curry broken-hand year (2019-20) softened: >= $60",
          (season_price(cur, "2019-20") or 0) >= 60,
          f"${season_price(cur, '2019-20')}")
    check("...but still a real drawdown vs 2018-19 (<= 65%)",
          season_price(cur, "2019-20") <= season_price(cur, "2018-19") * 0.65,
          f"${season_price(cur, '2019-20')} vs ${season_price(cur, '2018-19')}")

    # --- Old greats stay investable
    check("LeBron peak is in his 2007-2013 prime window",
          peak_season(leb)["season"] in
          {"2007-08", "2008-09", "2009-10", "2010-11", "2011-12", "2012-13"},
          f"peak={peak_season(leb)['season']}")
    check("LeBron age-40 season (2024-25) >= $70",
          (season_price(leb, "2024-25") or 0) >= 70,
          f"${season_price(leb, '2024-25')}")
    check("LeBron today >= $40",
          leb["price"] >= 40, f"${leb['price']}")
    check("LeBron rookie <= half his peak (ROI exists for the GOAT too)",
          season_price(leb, "2003-04") <= peak_season(leb)["price"] * 0.5,
          f"rookie ${season_price(leb, '2003-04')} vs peak ${peak_season(leb)['price']}")

    # --- Rookie inflation stays fixed
    check("Wemby rookie season (2023-24) < $250 (thin track record)",
          (season_price(wem, "2023-24") or 999) < 250,
          f"${season_price(wem, '2023-24')}")
    check("Wemby today <= SGA today (proven MVP outranks prospect)",
          wem["price"] <= sga["price"] * 1.05,
          f"Wemby ${wem['price']} vs SGA ${sga['price']}")

    # --- Guards vs bigs
    check("Curry MVP peak within 25% of Jokic MVP peak",
          peak_season(cur)["price"] >= peak_season(jok)["price"] * 0.75,
          f"Curry ${peak_season(cur)['price']} vs Jokic ${peak_season(jok)['price']}")

    # --- Cautionary tales still crater
    check("Rose peak is MVP 2010-11",
          peak_season(rose)["season"] == "2010-11",
          f"peak={peak_season(rose)['season']}")
    check("Rose post-injury trough < 35% of peak",
          min(s["price"] for s in rose["seasons"]) < peak_season(rose)["price"] * 0.35,
          f"trough ${min(s['price'] for s in rose['seasons'])} vs peak ${peak_season(rose)['price']}")
    check("Busts end cheap: Simmons/Rose/Wall < $30 today",
          all(P[n]["price"] < 30 for n in ("Ben Simmons", "Derrick Rose", "John Wall")),
          ", ".join(f"{n} ${P[n]['price']}" for n in ("Ben Simmons", "Derrick Rose", "John Wall")))

    # --- Board-level sanity
    top = sorted(data["players"], key=lambda p: -p["price"])[:5]
    check("Top-5 board today contains SGA and Jokic",
          {"Shai Gilgeous-Alexander", "Nikola Jokic"} <= {p["name"] for p in top},
          ", ".join(f"{p['name']} ${p['price']}" for p in top))

    # --- College prospects
    college = [p for p in data["players"] if p.get("league") == "NCAA"]
    check("College board has 8+ prospects", len(college) >= 8, f"{len(college)} listed")
    check("College prospects price as cheap IPOs (all < $60)",
          all(p["price"] < 60 for p in college),
          ", ".join(f"{p['name']} ${p['price']}" for p in sorted(college, key=lambda p: -p['price'])[:3]))
    check("No college prospect out-prices the NBA top-5",
          all(p["league"] == "NBA" for p in top), "top-5 all NBA")
    check("Every player carries school/draft/league fields",
          all("league" in p and "draft" in p and "school" in p for p in data["players"]), "ok")

    print(f"{'':2}{'CHECK':70} RESULT")
    for name, ok, detail in checks:
        print(f"  {name:70} {'PASS' if ok else 'FAIL':4}  {detail}")
    print(f"\n{len(checks) - len(failures)}/{len(checks)} passed")
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
