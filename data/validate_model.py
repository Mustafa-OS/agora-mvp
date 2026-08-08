"""
Agora v3 model harness. Run AFTER build_data.py:

    python data/validate_model.py

Asserts the board's shape AND the legal invariants (fictional HS data,
minors never priced or tokenized). Any FAIL blocks shipping.
"""
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "docs" / "data" / "players.js"


def main():
    raw = DATA.read_text()
    d = json.loads(raw.replace("window.AGORA_DATA = ", "").rstrip(";\n"))
    P = d["players"]
    by = {p["name"]: p for p in P}
    listed = [p for p in P if p["price"]]
    minors = [p for p in P if p["minor"]]
    hs = [p for p in P if p["level"] == "High School"]
    college = [p for p in P if p["level"] == "College"]
    checks, fails = [], []

    def check(name, ok, detail=""):
        checks.append((name, ok, detail))
        if not ok:
            fails.append(name)

    # ---- legal invariants (non-negotiable)
    check("every minor is unpriced", all(p["price"] is None for p in minors),
          f"{sum(1 for p in minors if p['price'])} priced minors")
    check("every minor is untokenized", all(p["token"] is None for p in minors))
    check("every HS athlete is fictional (demo)", all(p["demo"] for p in hs))
    check("no college athlete is a minor", all(not p["minor"] for p in college))

    # ---- board shape
    check("18 athletes total", len(P) == 18, str(len(P)))
    check("15 listed / 3 analytics-only", (len(listed), len(minors)) == (15, 3),
          f"{len(listed)}/{len(minors)}")
    check("weights sum to 1.0", abs(sum(d["weights"].values()) - 1.0) < 1e-9)
    check("all six sub-scores on every athlete",
          all(set(p["subs"]) == {"production", "availability", "recruiting",
                                 "audience", "commercial", "runway"} for p in P))
    check("scores in 0-100", all(0 <= p["score"] <= 100 for p in P))

    # ---- pricing sanity
    top = max(listed, key=lambda p: p["price"])
    check("top of board is college (HS discount active)", top["level"] == "College",
          f"top={top['name']}")
    check("Dybantsa & Cameron Boozer are the top two",
          {p["name"] for p in sorted(listed, key=lambda x: -x["price"])[:2]}
          == {"AJ Dybantsa", "Cameron Boozer"})
    lo = min(listed, key=lambda p: p["price"])
    check("board differentiates (top/bottom >= 3x)", top["price"] / lo["price"] >= 3,
          f"{top['price']:.0f}/{lo['price']:.0f}")
    check("every listed athlete has token + series",
          all(p["token"] and p["series"] for p in listed))

    # ---- the safeguard story: a minor can out-SCORE listed athletes
    reid = by["Cameron Reid"]
    check("Reid (minor) out-scores some listed athletes yet has no price",
          reid["price"] is None and any(reid["score"] > p["score"] for p in listed))

    print(f"{'':2}{'CHECK':58} RESULT")
    for name, ok, detail in checks:
        print(f"  {name:58} {'PASS' if ok else 'FAIL':4}  {detail}")
    print(f"\n{len(checks) - len(fails)}/{len(checks)} passed")
    if fails:
        sys.exit(1)


if __name__ == "__main__":
    main()
