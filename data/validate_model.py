"""
Model sanity harness. Run AFTER build_data.py:

    .venv/bin/python data/validate_model.py

Loads docs/data/players.js and asserts the career shapes match basketball
reality. Any FAIL means the model constants need tuning before shipping.
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

    # --- Curry: the user's diagnostic case
    check("Curry peak is unanimous-MVP 2015-16",
          peak_season(cur)["season"] == "2015-16",
          f"peak={peak_season(cur)['season']} ${peak_season(cur)['price']}")
    check("Curry scoring-title season (2020-21, age 33) >= $120",
          (season_price(cur, "2020-21") or 0) >= 120,
          f"${season_price(cur, '2020-21')}")
    check("Curry today >= $55 (not scrap value)",
          cur["price"] >= 55, f"${cur['price']}")
    check("Curry broken-hand year (2019-20) is a drawdown, not delisting (> $40)",
          (season_price(cur, "2019-20") or 0) > 40,
          f"${season_price(cur, '2019-20')}")

    # --- LeBron: age curve + longevity
    check("LeBron peak is in his 2008-2013 prime window",
          peak_season(leb)["season"] in
          {"2008-09", "2009-10", "2010-11", "2011-12", "2012-13"},
          f"peak={peak_season(leb)['season']}")
    check("LeBron age-40 season (2024-25) >= $90",
          (season_price(leb, "2024-25") or 0) >= 90,
          f"${season_price(leb, '2024-25')}")
    check("LeBron today >= 2.5x price floor",
          leb["price"] >= 20, f"${leb['price']}")
    check("LeBron rookie season < his peak by 2x+",
          season_price(leb, "2003-04") * 2 < peak_season(leb)["price"],
          f"rookie ${season_price(leb, '2003-04')} vs peak ${peak_season(leb)['price']}")

    # --- Rookie inflation
    check("Wemby rookie season (2023-24) < $250 (thin track record)",
          (season_price(wem, "2023-24") or 999) < 250,
          f"${season_price(wem, '2023-24')}")
    check("Wemby today <= SGA today (proven MVP outranks prospect)",
          wem["price"] <= sga["price"] * 1.05,
          f"Wemby ${wem['price']} vs SGA ${sga['price']}")

    # --- Guards vs bigs after position adjustment
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

    # --- Board-level sanity
    top = sorted(data["players"], key=lambda p: -p["price"])[:5]
    check("Top-5 board today contains SGA and Jokic",
          {"Shai Gilgeous-Alexander", "Nikola Jokic"} <= {p["name"] for p in top},
          ", ".join(f"{p['name']} ${p['price']}" for p in top))
    floor_men = [p["name"] for p in data["players"] if p["price"] <= 12]
    check("Simmons/Rose/Wall near the floor",
          {"Ben Simmons", "Derrick Rose"} <= set(floor_men) or
          all(P[n]["price"] < 30 for n in ("Ben Simmons", "Derrick Rose", "John Wall")),
          f"floor: {floor_men}")

    print(f"{'':2}{'CHECK':66} RESULT")
    for name, ok, detail in checks:
        print(f"  {name:66} {'PASS' if ok else 'FAIL':4}  {detail}")
    print(f"\n{len(checks) - len(failures)}/{len(checks)} passed")
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
