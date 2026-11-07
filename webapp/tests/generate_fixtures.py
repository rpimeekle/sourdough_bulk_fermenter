"""Generate parity fixtures from the Home Assistant integration's calc.py.

The web app's model.js is a port of calc.py. This script evaluates the Python
model across a grid of inputs and writes the results to fixtures.json, which
model.test.mjs compares against. Run it after changing either model:

    python3 webapp/tests/generate_fixtures.py

CI regenerates the file and fails if it differs from the committed copy, so
the two implementations can't drift apart silently.
"""

from __future__ import annotations

import importlib.util
import itertools
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # keep __pycache__ out of the integration folder

ROOT = Path(__file__).resolve().parents[2]
CALC = ROOT / "custom_components" / "sourdough_ferment" / "calc.py"
OUT = Path(__file__).resolve().parent / "fixtures.json"

# calc.py has no Home Assistant imports, so load it directly by path without
# importing the package (whose __init__ needs Home Assistant).
spec = importlib.util.spec_from_file_location("sourdough_calc", CALC)
calc = importlib.util.module_from_spec(spec)
sys.modules["sourdough_calc"] = calc
spec.loader.exec_module(calc)

PARAM_SETS = [
    {},
    {"q10": 2.5, "ref_temp": 26.0, "base_hours": 6.0},
    {"q10": 1.8, "ref_temp": 21.0, "base_hours": 4.0},
]
TEMPS = [4.0, 18.0, 21.5, 24.0, 27.0, 32.0]
RATIOS = [0.05, 0.10, 0.20, 0.35]
HUMIDITY = [None, 30.0, 95.0]
HYDRATION = [None, 62.0, 110.0]  # 110% exercises the hydration clamp
PROTEIN = [None, 9.0, 15.0]

JS_KEYS = {"q10": "q10", "ref_temp": "refTemp", "base_hours": "baseHours"}


def main() -> None:
    rows = []
    for (pi, overrides), temp, ratio, hum, hyd, prot in itertools.product(
        enumerate(PARAM_SETS), TEMPS, RATIOS, HUMIDITY, HYDRATION, PROTEIN
    ):
        p = calc.ModelParams(**overrides)
        hours = calc.bulk_hours(
            temp, ratio, p, humidity_pct=hum, hydration_pct=hyd, protein_pct=prot
        )
        rows.append([pi, temp, ratio, hum, hyd, prot, round(hours, 10)])
    doc = {
        "source": "custom_components/sourdough_ferment/calc.py",
        "paramSets": [{JS_KEYS[k]: v for k, v in o.items()} for o in PARAM_SETS],
        "columns": ["paramSet", "tempC", "starterRatio", "humidityPct", "hydrationPct", "proteinPct", "hours"],
        "rows": rows,
    }
    body = ",\n".join(json.dumps(r) for r in rows)
    head = json.dumps({k: v for k, v in doc.items() if k != "rows"})[:-1]
    OUT.write_text(f'{head}, "rows": [\n{body}\n]}}\n')
    print(f"Wrote {len(rows)} cases to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
