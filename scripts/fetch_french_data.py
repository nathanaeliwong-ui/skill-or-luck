#!/usr/bin/env python3
"""Download Kenneth French's free data library files and bundle them for the site.

Writes data/french.json with monthly returns (in percent) for:
  - the 12 value-weighted industry portfolios
  - the Fama-French 3 factors (Mkt-RF, SMB, HML, RF)
  - the momentum factor (Mom)

and data/french-daily.json (next to it) with the daily returns for the 12
industries plus Mkt-RF and RF, so trades can be compared over their exact dates.
Daily returns are stored as integers in hundredths of a percent (1.45% -> 145).

Source: https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html
The library is free to download; check its terms before commercial use.

Usage:  python3 scripts/fetch_french_data.py [output_path]
Only the Python standard library is needed.
"""

import io
import json
import sys
import time
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/"
FILES = {
    "industries": "12_Industry_Portfolios_CSV.zip",
    "factors": "F-F_Research_Data_Factors_CSV.zip",
    "momentum": "F-F_Momentum_Factor_CSV.zip",
    "industries_exdiv": "12_Industry_Portfolios_Wout_Div_CSV.zip",
    "industries_daily": "12_Industry_Portfolios_daily_CSV.zip",
    "factors_daily": "F-F_Research_Data_Factors_daily_CSV.zip",
}
INDUSTRY_CODES = ["NoDur", "Durbl", "Manuf", "Enrgy", "Chems", "BusEq",
                  "Telcm", "Utils", "Shops", "Hlth", "Money", "Other"]


def download(name: str) -> str:
    """Download one zip and return the text of the single CSV inside it."""
    url = BASE + name
    last_error = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "skill-or-luck-data-fetch"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                blob = resp.read()
            with zipfile.ZipFile(io.BytesIO(blob)) as zf:
                inner = [n for n in zf.namelist() if n.lower().endswith(".csv")][0]
                return zf.read(inner).decode("latin-1")
        except Exception as exc:  # network hiccups: retry a couple of times
            last_error = exc
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Could not download {url}: {last_error}")


def first_monthly_table(text: str, required_cols: list[str], key_len: int = 6, returns: bool = True) -> dict[str, dict[str, float]]:
    """Parse the first table whose header has the required columns.

    The French CSVs stack several tables (monthly, annual, equal-weighted...)
    separated by title lines. The first matching table is the monthly,
    value-weighted one. Rows look like '192607,   1.45,  ...' (percent), or with
    key_len=8 like '19260701,   0.45,  ...' for the daily files.
    Returns {column: {key: value}} where key is 'YYYY-MM' (monthly) or 'YYYYMMDD' (daily).
    """
    lines = text.splitlines()
    out: dict[str, dict[str, float]] = {}
    i = 0
    while i < len(lines):
        cells = [c.strip() for c in lines[i].split(",")]
        if all(col in cells for col in required_cols):
            header = cells
            out = {col: {} for col in required_cols}
            j = i + 1
            while j < len(lines):
                row = [c.strip() for c in lines[j].split(",")]
                key = row[0] if row else ""
                if not (len(key) == key_len and key.isdigit()):
                    break
                month = f"{key[:4]}-{key[4:]}" if key_len == 6 else key
                for col in required_cols:
                    raw = row[header.index(col)]
                    try:
                        val = float(raw)
                    except ValueError:
                        continue
                    if val <= -99.99 or (returns and val >= 999):  # French's missing-value markers
                        continue
                    out[col][month] = val
                j += 1
            if any(out[c] for c in required_cols):
                return out
        i += 1
    raise ValueError(f"No monthly table with columns {required_cols} found")


def titled_monthly_table(text: str, title: str, required_cols: list[str]) -> dict[str, dict[str, float]]:
    """Parse the monthly table that follows a title line, e.g. 'Average Firm Size'."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.strip().startswith(title):
            # Firm counts and sizes are levels, not returns, so large values are real.
            return first_monthly_table("\n".join(lines[i + 1:]), required_cols, returns=False)
    raise ValueError(f"No table titled {title!r} found")


def market_dividend_yield(ind_text: str, exdiv_text: str) -> dict[str, float]:
    """Monthly dividend part of the whole market's return, in percent.

    Each industry's dividend part is its return with dividends minus its return without.
    Industries are weighted by market value (number of firms x average firm size), which
    is how French builds the value-weighted portfolios. Subtracting this from the market's
    total return gives a price-only market to compare with price-only trade returns.
    """
    with_div = first_monthly_table(ind_text, INDUSTRY_CODES)
    ex_div = first_monthly_table(exdiv_text, INDUSTRY_CODES)
    firms = titled_monthly_table(ind_text, "Number of Firms in Portfolios", INDUSTRY_CODES)
    size = titled_monthly_table(ind_text, "Average Firm Size", INDUSTRY_CODES)
    out = {}
    for month in with_div[INDUSTRY_CODES[0]]:
        total_w = part = 0.0
        for code in INDUSTRY_CODES:
            w_n, w_s = firms[code].get(month), size[code].get(month)
            r, rx = with_div[code].get(month), ex_div[code].get(month)
            if None in (w_n, w_s, r, rx):
                continue
            w = w_n * w_s
            total_w += w
            part += w * (r - rx)
        if total_w > 0:
            out[month] = round(part / total_w, 4)
    return out


def month_range(first: str, last: str) -> list[str]:
    y, m = map(int, first.split("-"))
    ly, lm = map(int, last.split("-"))
    months = []
    while (y, m) <= (ly, lm):
        months.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return months


def build_daily() -> dict:
    """Daily industry returns plus Mkt-RF and RF, as ints in hundredths of a percent."""
    ind = first_monthly_table(download(FILES["industries_daily"]), INDUSTRY_CODES, key_len=8)
    fac = first_monthly_table(download(FILES["factors_daily"]), ["Mkt-RF", "RF"], key_len=8)
    dates = sorted(set().union(*(col.keys() for col in ind.values()), *(col.keys() for col in fac.values())))

    def series(col: dict[str, float]) -> list:
        return [None if col.get(d) is None else round(col[d] * 100) for d in dates]

    payload = {
        "source": "Kenneth R. French Data Library (Tuck School of Business, Dartmouth)",
        "units": "daily returns in hundredths of a percent (145 = 1.45%)",
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "firstDate": f"{dates[0][:4]}-{dates[0][4:6]}-{dates[0][6:]}",
        "lastDate": f"{dates[-1][:4]}-{dates[-1][4:6]}-{dates[-1][6:]}",
        "dates": [int(d) for d in dates],
        "industries": {code: series(ind[code]) for code in INDUSTRY_CODES},
        "factors": {"MktRF": series(fac["Mkt-RF"]), "RF": series(fac["RF"])},
    }
    if len(dates) < 20000:
        raise ValueError(f"Only {len(dates)} trading days parsed; the source format may have changed")
    for code in INDUSTRY_CODES:
        if sum(v is not None for v in payload["industries"][code][-60:]) < 55:
            raise ValueError(f"Industry {code} is missing recent daily data")
    return payload


def main() -> None:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data" / "french.json"

    ind_text = download(FILES["industries"])
    ind = first_monthly_table(ind_text, INDUSTRY_CODES)
    div_yield = market_dividend_yield(ind_text, download(FILES["industries_exdiv"]))
    fac = first_monthly_table(download(FILES["factors"]), ["Mkt-RF", "SMB", "HML", "RF"])
    mom_text = download(FILES["momentum"])
    mom = first_monthly_table(mom_text, ["Mom"])

    all_months = set()
    for table in (ind, fac):
        for col in table.values():
            all_months.update(col.keys())
    months = month_range(min(all_months), max(all_months))

    def series(col: dict[str, float]) -> list:
        return [col.get(mo) for mo in months]

    payload = {
        "source": "Kenneth R. French Data Library (Tuck School of Business, Dartmouth)",
        "sourceUrl": "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html",
        "units": "monthly returns in percent",
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "firstMonth": months[0],
        "lastMonth": months[-1],
        "industries": {code: series(ind[code]) for code in INDUSTRY_CODES},
        "factors": {
            "MktRF": series(fac["Mkt-RF"]),
            "SMB": series(fac["SMB"]),
            "HML": series(fac["HML"]),
            "RF": series(fac["RF"]),
            "Mom": series(mom["Mom"]),
        },
        # Dividend part of the market's monthly return (percent); market minus this is price-only.
        "marketDividend": series(div_yield),
    }

    # Sanity checks so a format change on the source site fails loudly.
    if len(months) < 1000:
        raise ValueError(f"Only {len(months)} months parsed; the source format may have changed")
    for code in INDUSTRY_CODES:
        if sum(v is not None for v in payload["industries"][code][-24:]) < 20:
            raise ValueError(f"Industry {code} is missing recent data")
    recent = [v for v in payload["marketDividend"][-120:] if v is not None]
    yearly = sum(recent) / len(recent) * 12 if recent else 0
    if not 0.5 < yearly < 5:
        raise ValueError(f"Market dividend yield looks wrong ({yearly:.2f}% a year)")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"Wrote {out_path} ({len(months)} months, {months[0]} to {months[-1]})")

    daily = build_daily()
    daily_path = out_path.with_name("french-daily.json")
    daily_path.write_text(json.dumps(daily, separators=(",", ":")))
    print(f"Wrote {daily_path} ({len(daily['dates'])} days, {daily['firstDate']} to {daily['lastDate']})")


if __name__ == "__main__":
    main()
