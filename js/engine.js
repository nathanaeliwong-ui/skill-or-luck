// Skill or Luck — analysis engine.
// Pure functions only: no DOM access, so everything here can be unit-tested in Node.
// All calculations run in the visitor's browser; nothing is sent to a server.

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;

/** 'YYYY-MM-DD' -> UTC milliseconds (NaN if invalid). */
export function toTime(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || "").trim());
  if (!m) return NaN;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  return d.getUTCMonth() === +m[2] - 1 ? t : NaN;
}

export function fromTime(t) {
  return new Date(t).toISOString().slice(0, 10);
}

export function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Month index = year * 12 + (month - 1). Accepts 'YYYY-MM' or 'YYYY-MM-DD'. */
export function monthIndex(str) {
  const [y, m] = String(str).split("-").map(Number);
  return y * 12 + (m - 1);
}

export function monthLabel(idx) {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function monthStartTime(idx) {
  return Date.UTC(Math.floor(idx / 12), idx % 12, 1);
}

/**
 * Normalise many date spellings to 'YYYY-MM-DD'.
 * Handles 2024-03-05, 2024/03/05, 20240305, 03/05/2024 (US order), 05.03.2024 (EU order),
 * and strings with extra text such as Schwab's "03/05/2024 as of 03/04/2024".
 */
export function normalizeDate(raw, order = "mdy") {
  const s = String(raw ?? "").trim();
  let m;
  const ok = (y, mo, d) => {
    const str = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return Number.isNaN(toTime(str)) ? null : str;
  };
  if ((m = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s))) return ok(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return ok(+m[1], +m[2], +m[3]);
  // 03/05/2024 or 03-05-2024: month first unless the file is known to be day first, or the
  // first number can only be a day (13/05/2024).
  if ((m = /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(s))) {
    let y = +m[3];
    if (y < 100) y += y > 50 ? 1900 : 2000;
    const dayFirst = order === "dmy" || +m[1] > 12;
    return dayFirst ? ok(y, +m[2], +m[1]) : ok(y, +m[1], +m[2]);
  }
  if ((m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s))) return ok(+m[3], +m[2], +m[1]);
  // Spelled-out dates only ("Mar 5, 2024", "5 March 2024"). Anything vaguer, such as "12" or
  // "Mar 5", would be guessed into a wrong year by Date.parse, so it is rejected.
  if (/^[A-Za-z]{3,9}\.?\s+\d{1,2}(st|nd|rd|th)?,?\s+\d{4}\b/.test(s) || /^\d{1,2}(st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}\b/.test(s)) {
    const parsed = Date.parse(s.replace(/(\d)(st|nd|rd|th)\b/, "$1"));
    if (!Number.isNaN(parsed)) {
      const d = new Date(parsed);
      return ok(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
  }
  return null;
}

/** Parse "$1,234.50", "(12.30)", "1 234,5" -> number (NaN if empty/invalid). */
export function parseNumber(raw) {
  if (raw === null || raw === undefined) return NaN;
  if (typeof raw === "number") return raw;
  let s = String(raw).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$€£¥\s]/g, "");
  // Prices often have three decimals (12.345), so a lone dot is always a decimal point.
  // With both separators, the last one is the decimal point. A comma alone is a thousands
  // separator only in the 1,234 / 12,345,678 pattern; otherwise it is a decimal comma (12,5).
  const dot = s.lastIndexOf("."), comma = s.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) {
    s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");   // 1.234,5 | 1,234.5
  } else if (comma >= 0) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");      // 1,234 | 12,5
  } else if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, "");                                                         // 1.234.567
  }
  const n = Number(s);
  return neg ? -n : n;
}

// ---------------------------------------------------------------------------
// Random numbers (seeded, so the same inputs always give the same answer)
// ---------------------------------------------------------------------------

export function rng(seed = 42) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Basic statistics
// ---------------------------------------------------------------------------

export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function stdev(xs) {
  if (xs.length < 2) return NaN;
  const mu = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - mu) ** 2, 0) / (xs.length - 1));
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function correlation(x, y) {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/** P(X >= k) for X ~ Binomial(n, 0.5). */
export function binomialUpperTail(k, n) {
  let logC = 0; // log C(n, 0)
  const terms = [];
  for (let i = 0; i <= n; i++) {
    if (i > 0) logC += Math.log(n - i + 1) - Math.log(i);
    if (i >= k) terms.push(logC + n * Math.log(0.5));
  }
  return Math.min(1, terms.reduce((a, lt) => a + Math.exp(lt), 0));
}

/** Ordinary least squares with an intercept. Returns coefficients, std errors, t-stats, R². */
export function ols(y, Xcols) {
  const n = y.length;
  const k = Xcols.length + 1;
  const X = y.map((_, i) => [1, ...Xcols.map((c) => c[i])]);
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  const inv = invert(XtX);
  if (!inv) return null;
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
  let ssr = 0;
  const my = mean(y);
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const fit = X[i].reduce((s, v, j) => s + v * beta[j], 0);
    ssr += (y[i] - fit) ** 2;
    sst += (y[i] - my) ** 2;
  }
  const s2 = ssr / (n - k);
  const se = inv.map((row, i) => Math.sqrt(Math.max(0, s2 * row[i])));
  return { beta, se, t: beta.map((b, i) => b / se[i]), r2: 1 - ssr / sst, n };
}

function invert(M) {
  const n = M.length;
  const A = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    const pv = A[c][c];
    for (let j = 0; j < 2 * n; j++) A[c][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c];
      if (f) for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((row) => row.slice(n));
}

/** Annualised money-weighted return (XIRR). flows: [{t: ms, amount}] (negative = money in). */
export function xirr(flows) {
  if (flows.length < 2) return null;
  const t0 = flows.reduce((m, f) => Math.min(m, f.t), Infinity);   // no spread: lists can be huge
  const npv = (r) => flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, (f.t - t0) / (365.25 * DAY_MS)), 0);
  let lo = -0.9999, hi = 10;
  let flo = npv(lo), fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-9) return mid;
    if (fm * flo < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Industry classification
// ---------------------------------------------------------------------------

/** Kenneth French's 12-industry classification, plus a whole-market proxy and "no proxy". */
export const INDUSTRIES = {   // kept short so each name fits its dropdown
  BusEq: "Tech, software & chips",
  Money: "Banks, insurance & payments",
  Hlth: "Healthcare & pharma",
  Shops: "Retail & restaurants",
  NoDur: "Food, drinks & apparel",
  Durbl: "Cars & home goods",
  Manuf: "Manufacturing & aerospace",
  Enrgy: "Oil, gas & coal",
  Chems: "Chemicals",
  Telcm: "Telecom & cable",
  Utils: "Utilities",
  Other: "Transport, media & mining",
  MKT: "Whole market (index funds)",
  NONE: "No proxy (bonds, gold, cash)",
};

export const JOB_INDUSTRIES = {
  BusEq: "Tech, software or electronics",
  Money: "Banking, insurance or finance",
  Hlth: "Healthcare or pharma",
  Shops: "Retail, wholesale or restaurants",
  NoDur: "Food, drinks or apparel",
  Durbl: "Car or appliance industry",
  Manuf: "Manufacturing or defense",
  Enrgy: "Oil, gas or coal",
  Chems: "Chemicals",
  Telcm: "Telecom or cable",
  Utils: "Utilities",
  Other: "Transport, media or mining",
  NONE: "Government, education or other",
};

const TICKER_GROUPS = {
  BusEq: "AAPL MSFT NVDA GOOGL GOOG META AVGO ORCL CRM ADBE AMD INTC CSCO QCOM TXN IBM NOW INTU AMAT MU LRCX KLAC ADI PANW CRWD SNOW PLTR SHOP TSM ASML DELL HPQ HPE SMCI ARM NET DDOG ZS MRVL ANET ADSK WDAY SNPS CDNS FTNT MSTR APP TEAM HUBS MDB OKTA TWLO ZM DOCU U RBLX SAP SONY ON NXPI MCHP STX WDC XLK VGT SMH SOXX ARKK IGV FTEC",
  Money: "JPM BAC WFC C GS MS BRK.B BRK-B BRK.A BRKB V MA PYPL AXP SCHW BLK SPGI MCO COIN HOOD SOFI PGR CB MET AIG USB PNC COF XYZ SQ TRV ALL ICE CME AFRL AMT PLD O SPG EQIX CCI PSA WELL VICI KKR BX APO NU UPST AFRM XLF VFH KRE KBE VNQ XLRE",
  Hlth: "JNJ LLY UNH PFE MRK ABBV TMO ABT DHR BMY AMGN GILD CVS ISRG MDT VRTX REGN NVO ZTS SYK BSX MRNA HCA CI ELV HUM BIIB DXCM IDXX EW BDX AZN GSK SNY NVS XLV VHT IBB XBI",
  Shops: "AMZN WMT COST HD LOW TGT MCD SBUX TJX CMG EBAY BABA DG DLTR ROST ORLY AZO MELI LULU YUM DPZ BBY KR WBA CHWY ETSY JD PDD SE CPNG GPC SYY XLY VCR",
  NoDur: "KO PEP PG PM MO MDLZ CL KHC NKE EL GIS HSY STZ KDP MNST BUD DEO UL HSY K CPB SJM TSN HRL CLX CHD KVUE TAP XLP VDC",
  Durbl: "TSLA F GM RIVN LCID TM HMC STLA NIO LI XPEV WHR HOG RACE",
  Manuf: "BA CAT DE GE GEV HON LMT RTX MMM NOC GD ETN EMR ITW PH CMI PCAR TT ROK AME OTIS CARR JCI KMB IP AXON TDG HWM XLI ITA VIS",
  Enrgy: "XOM CVX COP OXY SLB EOG PSX MPC VLO BP SHEL HAL DVN FANG HES KMI WMB OKE ET EPD BKR CTRA TTE EQNR XLE VDE XOP",
  Chems: "LIN DOW DD APD SHW ECL LYB PPG CTVA MOS CF ALB EMN IFF XLB VAW",
  Telcm: "T VZ TMUS CMCSA CHTR XLC VOX",
  Utils: "NEE DUK SO D AEP EXC SRE XEL PCG ED PEG WEC EIX CEG VST NRG XLU VPU",
  Other: "DIS NFLX UBER ABNB BKNG UPS FDX UNP CSX NSC DAL UAL AAL LUV MAR HLT CCL RCL NCLH WM RSG FCX NEM SCCO SPOT ROKU WBD PARA EA TTWO EXPE LYFT DASH ACN ADP PAYX CTAS FAST URI VMC MLM DHI LEN PHM NVR",
  MKT: "SPY VOO IVV VTI ITOT SCHB SCHX SPLG RSP DIA IWM IWB IWV VB VO VV VUG VTV SCHD VIG DGRO QQQ QQQM VT VXUS VEA VWO EFA IEFA IEMG ACWI SCHF SPYG SPYV MGK FXAIX FSKAX FZROX FNILX SWPPX SWTSX VFIAX VTSAX VTIAX VTWAX",
  NONE: "BND AGG TLT IEF SHY BIL SGOV TIP LQD HYG VCIT VCSH BSV BIV BNDX MUB GLD IAU SLV GLDM BTC ETH BTC-USD ETH-USD IBIT FBTC GBTC BITO ETHA SOL USDC CASH SPAXX VMFXX FDRXX SWVXX",
};

const TICKER_MAP = (() => {
  const map = {};
  for (const [code, list] of Object.entries(TICKER_GROUPS)) {
    for (const t of list.split(/\s+/)) if (t) map[t] = code;
  }
  return map;
})();

/** Best-guess industry proxy for a ticker, or null when unknown. */
export function guessIndustry(ticker) {
  const t = String(ticker || "").trim().toUpperCase();
  if (!t) return null;
  return TICKER_MAP[t] || TICKER_MAP[t.replace(/[.-]/g, "")] || null;
}

// ---------------------------------------------------------------------------
// Market data (Kenneth French monthly returns, bundled as data/french.json)
// ---------------------------------------------------------------------------

/**
 * Daily return table. Returns are stored as integers in hundredths of a percent.
 * A window (s, e] compounds the returns of every trading day after the start date up to
 * and including the end date, i.e. close of the buy day to close of the sell day.
 */
function buildDaily(json) {
  const times = json.dates.map((d) => Date.UTC(Math.floor(d / 10000), Math.floor((d % 10000) / 100) - 1, d % 100));
  const toDec = (arr) => arr.map((v) => (v === null || v === undefined ? 0 : v / 10000));
  const series = {};
  for (const [code, arr] of Object.entries(json.industries)) series[code] = toDec(arr);
  const mkt = json.factors.MktRF, rf = json.factors.RF;
  series.MKT = mkt.map((v, i) => (v === null || rf[i] === null ? 0 : (v + rf[i]) / 10000));
  const first = times[0], last = times[times.length - 1];
  // First index with times[i] > t.
  const after = (t) => {
    let lo = 0, hi = times.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] > t) hi = mid; else lo = mid + 1; }
    return lo;
  };
  return {
    first: json.firstDate, last: json.lastDate, days: times.length, series,
    window(code, s, e) {
      const r = series[code];
      const from = after(s), to = after(e); // days in (s, e]
      let growth = 1;
      for (let i = from; i < to; i++) growth *= 1 + r[i];
      // Calendar span that the data actually covers.
      const covered = Math.max(0, Math.min(e, last) - Math.max(s, first)) / (e - s);
      return { growth, covered };
    },
  };
}

export class MarketData {
  /** `daily` (optional) is data/french-daily.json; when present, trade windows use exact days. */
  constructor(json, daily = null) {
    this.raw = json;
    this.first = monthIndex(json.firstMonth);
    this.last = monthIndex(json.lastMonth);
    this.fetchedAt = json.fetchedAt;
    const toDec = (arr) => arr.map((v) => (v === null || v === undefined ? null : v / 100));
    this.series = {};
    for (const [code, arr] of Object.entries(json.industries)) this.series[code] = toDec(arr);
    this.factors = {};
    for (const [code, arr] of Object.entries(json.factors)) this.factors[code] = toDec(arr);
    // Whole market = market excess return + risk-free rate.
    this.series.MKT = this.factors.MktRF.map((v, i) =>
      v === null || this.factors.RF[i] === null ? null : v + this.factors.RF[i]);
    this.daily = daily ? buildDaily(daily) : null;
  }

  /** Monthly return (decimal) for a proxy code at a month index, or null. */
  value(code, idx) {
    const arr = this.series[code] || this.factors[code];
    if (!arr) return null;
    const v = arr[idx - this.first];
    return v === undefined ? null : v;
  }

  /**
   * Growth of $1 in a proxy between two dates, compounding monthly returns and
   * using fractions of a month at both ends. Also reports how much of the window
   * the data covers (recent weeks may not be published yet).
   */
  windowGrowth(code, startStr, endStr) {
    const s = toTime(startStr), e = toTime(endStr);
    if (!(e > s)) return { growth: 1, covered: 1 };
    if (this.daily && this.daily.series[code]) return this.daily.window(code, s, e);
    let growth = 1, coveredMs = 0;
    for (let m = monthIndex(startStr); m <= monthIndex(endStr); m++) {
      const ms = monthStartTime(m), me = monthStartTime(m + 1);
      const overlap = Math.max(0, Math.min(e, me) - Math.max(s, ms));
      if (!overlap) continue;
      const r = this.value(code, m);
      if (r === null) continue;
      growth *= Math.pow(1 + r, overlap / (me - ms));
      coveredMs += overlap;
    }
    return { growth, covered: coveredMs / (e - s) };
  }

  /**
   * Growth of $1 in the whole market without dividends. Trade returns here are price
   * changes only, so this is the like-for-like benchmark. Falls back to the total return
   * when the data file has no dividend series.
   */
  marketPriceGrowth(startStr, endStr) {
    const total = this.windowGrowth("MKT", startStr, endStr);
    const div = this.raw.marketDividend;
    if (!div) return total;
    const s = toTime(startStr), e = toTime(endStr);
    let drag = 0;
    for (let m = monthIndex(startStr); m <= monthIndex(endStr); m++) {
      const ms = monthStartTime(m), me = monthStartTime(m + 1);
      const overlap = Math.max(0, Math.min(e, me) - Math.max(s, ms));
      const d = div[m - this.first];
      if (!overlap || d === null || d === undefined) continue;
      drag += Math.log(1 - d / 100) * (overlap / (me - ms));
    }
    return { growth: total.growth * Math.exp(drag), covered: total.covered };
  }

  /** How much an industry moves with the market (beta), from the last 10 years of months. */
  beta(code) {
    this._betas ||= {};
    if (code in this._betas) return this._betas[code];
    const xs = [], ys = [];
    for (let m = this.last - 119; m <= this.last; m++) {
      const r = this.value(code, m), mk = this.value("MktRF", m), rf = this.value("RF", m);
      if (r === null || mk === null || rf === null) continue;
      xs.push(mk);
      ys.push(r - rf);
    }
    let b = 1;
    if (xs.length >= 36) {
      const mx = mean(xs), my = mean(ys);
      let cov = 0, v = 0;
      for (let i = 0; i < xs.length; i++) { cov += (xs[i] - mx) * (ys[i] - my); v += (xs[i] - mx) ** 2; }
      if (v > 0) b = cov / v;
    }
    return (this._betas[code] = b);
  }
}

// ---------------------------------------------------------------------------
// Price files and Alpha Vantage responses
// ---------------------------------------------------------------------------

/** Minimal RFC-4180 CSV parser (handles quotes, commas/semicolons/tabs). */
export function parseCsv(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || "";
  const delim = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9/]+/g, " ").trim();

/**
 * Daily (or monthly) price history from a CSV — Nasdaq.com, Stooq, Yahoo-style or any
 * file with a date column and a close column. Returns [{d: 'YYYY-MM-DD', c: number}] ascending.
 */
export function parsePriceCsv(text) {
  const rows = parseCsv(text);
  const closeNames = ["adj close", "adjusted close", "adj close**", "close/last", "close", "zamkniecie", "price", "last", "nav"];
  for (let h = 0; h < Math.min(rows.length, 10); h++) {
    const header = rows[h].map(norm);
    const di = header.findIndex((c) => c === "date" || c === "data" || c.startsWith("date"));
    let ci = -1;
    for (const name of closeNames) {
      ci = header.findIndex((c) => c === name || c.replace(/\*/g, "").trim() === name);
      if (ci >= 0) break;
    }
    if (di < 0 || ci < 0) continue;
    const out = [];
    const dayFirst = rows.slice(h + 1).some((r) => { const dm = /^\s*(\d{1,2})[/-]\d{1,2}[/-]\d{2,4}/.exec(String(r[di] ?? "")); return dm && +dm[1] > 12; });
    for (const r of rows.slice(h + 1)) {
      const d = normalizeDate(r[di], dayFirst ? "dmy" : "mdy");
      const c = parseNumber(r[ci]);
      if (d && Number.isFinite(c) && c > 0) out.push({ d, c });
    }
    if (out.length < 2) break;
    out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    return dedupe(out);
  }
  throw new Error("Couldn't find a date column and a closing-price column in that file.");
}

function dedupe(points) {
  const out = [];
  for (const p of points) {
    if (out.length && out[out.length - 1].d === p.d) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/** Parse an Alpha Vantage TIME_SERIES_* JSON response into [{d, c}] ascending. */
export function parseAlphaVantage(json) {
  if (!json || typeof json !== "object") throw new Error("Empty response from Alpha Vantage.");
  const msg = json["Error Message"] || json.Note || json.Information;
  if (msg) throw new Error(String(msg));
  const key = Object.keys(json).find((k) => /time series/i.test(k));
  if (!key) throw new Error("Unexpected response from Alpha Vantage.");
  const out = [];
  for (const [date, fields] of Object.entries(json[key])) {
    const names = Object.keys(fields);
    const ck = names.find((n) => /adjusted close/i.test(n)) || names.find((n) => /close/i.test(n));
    const c = parseNumber(fields[ck]);
    const d = normalizeDate(date);
    if (d && c > 0) out.push({ d, c });
  }
  out.sort((a, b) => (a.d < b.d ? -1 : 1));
  return out;
}

/**
 * Undo stock splits in an unadjusted daily price file (Nasdaq.com files are unadjusted).
 * A one-day move that matches a common split ratio within 4% is treated as a split, and
 * all earlier prices are divided by that ratio. Returns {points, splits}.
 */
export function adjustSplits(points) {
  const ratios = [2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 8, 1 / 10, 1 / 20];
  const out = points.map((p) => ({ ...p }));
  const splits = [];
  for (let i = out.length - 1; i > 0; i--) {
    const days = (toTime(out[i].d) - toTime(out[i - 1].d)) / DAY_MS;
    if (days > 7) continue; // only meaningful for daily data
    const r = out[i - 1].c / out[i].c;
    if (r < 1.8 && r > 0.55) continue;
    const k = ratios.find((x) => Math.abs(r / x - 1) < 0.04);
    if (!k) continue;
    for (let j = 0; j < i; j++) out[j].c /= k;
    splits.push({ d: out[i].d, ratio: k });
  }
  return { points: out, splits };
}

/** Month-end closes -> Map(monthIndex -> monthly return). */
export function monthlyReturnsFromPrices(points) {
  const lastByMonth = new Map();
  for (const p of points) lastByMonth.set(monthIndex(p.d), p.c);
  const months = [...lastByMonth.keys()].sort((a, b) => a - b);
  const out = new Map();
  for (let i = 1; i < months.length; i++) {
    if (months[i] - months[i - 1] !== 1) continue;
    out.set(months[i], lastByMonth.get(months[i]) / lastByMonth.get(months[i - 1]) - 1);
  }
  return out;
}

/** Price on or just before a date from a sorted history, or null. */
export function priceOnOrBefore(points, dateStr) {
  let lo = 0, hi = points.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].d <= dateStr) { best = points[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Broker exports -> trades (FIFO lot matching)
// ---------------------------------------------------------------------------

const COLS = {
  ticker: ["symbol", "ticker", "instrument", "stock symbol", "security symbol", "code"],
  date: ["trade date", "transaction date", "activity date", "run date", "date", "date acquired", "acquired", "open date", "purchase date", "buy date", "process date", "settlement date", "time", "date/time", "datetime"],
  side: ["action", "side", "trans code", "transaction type", "type", "activity", "buy/sell", "activity type", "transaction"],
  qty: ["quantity", "qty", "shares", "units", "no of shares", "number of shares", "share", "amount of shares"],
  price: ["price", "price per share", "trade price", "unit price", "execution price", "price $", "cost/share", "purchase price", "buy price", "avg price", "average price", "cost per share"],
  sellDate: ["sell date", "date sold", "close date"],
  sellPrice: ["sell price", "sale price", "close price"],
  currentPrice: ["current price", "last price", "market price"],
  industry: ["industry", "proxy"],
};

function findCol(header, names) {
  for (const n of names) {
    const i = header.indexOf(n);
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = header.findIndex((h) => h.startsWith(n + " ") || h.endsWith(" " + n));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Turn a broker CSV into trade rows.
 * - A file with buy/sell actions is treated as a transaction history and matched first-in, first-out.
 * - A file without actions is treated as a list of purchase lots (optionally with sell date/price).
 * Returns {trades, warnings, skipped}.
 */
export function importBrokerCsv(text) {
  const rows = parseCsv(text);
  let h = -1, header = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cand = rows[i].map(norm);
    if (findCol(cand, COLS.ticker) >= 0 && findCol(cand, COLS.qty) >= 0) { h = i; header = cand; break; }
  }
  if (h < 0) throw new Error("Couldn't find symbol and quantity columns. Use the template, or check the file is a trade history export.");

  const ix = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, findCol(header, names)]));
  // 03/05/2024 is March 5 or May 3 depending on the broker. If any date in the file has a first
  // number above 12 it must be day first, so read the whole file that way.
  let order = "mdy";
  for (const r of rows.slice(h + 1)) {
    for (const c of [ix.date, ix.sellDate]) {
      const dm = c >= 0 ? /^\s*(\d{1,2})[/-](\d{1,2})[/-]\d{2,4}/.exec(String(r[c] ?? "")) : null;
      if (dm && +dm[1] > 12) order = "dmy";
    }
  }
  const warnings = [];
  let skipped = 0;
  const events = [];
  const lots = [];
  // No action column and no sell columns, but negative quantities: a signed-quantity history
  // (Interactive Brokers style). Treat positive as buys and negative as sells.
  const signed = ix.side < 0 && ix.sellDate < 0 && rows.slice(h + 1).some((r) => parseNumber(r[ix.qty]) < 0);

  for (const r of rows.slice(h + 1)) {
    const ticker = String(r[ix.ticker] || "").trim().toUpperCase();
    const date = ix.date >= 0 ? normalizeDate(r[ix.date], order) : null;
    let qty = parseNumber(r[ix.qty]);
    const price = ix.price >= 0 ? Math.abs(parseNumber(r[ix.price])) : NaN;
    if (!ticker || !/^[A-Z0-9.\-^=]{1,15}$/.test(ticker) || !date || !Number.isFinite(qty) || qty === 0 || !(price > 0)) {
      skipped++;
      continue;
    }
    if (ix.side >= 0 || signed) {
      const s = ix.side >= 0 ? String(r[ix.side] || "").toLowerCase() : "";
      let side = null;
      if (ix.side < 0) side = qty > 0 ? "buy" : "sell";
      else if (/\b(buy|bought|purchase|bot|reinvest)/.test(s)) side = "buy";
      else if (/\b(sell|sold|sld|sale)/.test(s)) side = "sell";
      else if (!s.trim()) side = qty > 0 ? "buy" : "sell";
      if (!side) { skipped++; continue; }
      events.push({ ticker, date, side, qty: Math.abs(qty), price });
    } else {
      const sellDate = ix.sellDate >= 0 ? normalizeDate(r[ix.sellDate], order) : null;
      const sellPrice = ix.sellPrice >= 0 ? parseNumber(r[ix.sellPrice]) : NaN;
      const currentPrice = ix.currentPrice >= 0 ? parseNumber(r[ix.currentPrice]) : NaN;
      const industry = ix.industry >= 0 ? String(r[ix.industry] || "").trim() : "";
      if (qty < 0) { skipped++; continue; }
      lots.push({
        ticker, buyDate: date, buyPrice: price, qty,
        sellDate: sellDate && sellPrice > 0 ? sellDate : "",
        sellPrice: sellDate && sellPrice > 0 ? sellPrice : "",
        currentPrice: currentPrice > 0 ? currentPrice : "",
        industry: industry in INDUSTRIES ? industry : "",
      });
    }
  }

  if (lots.length) return { trades: lots, warnings, skipped };
  if (!events.length) throw new Error("No buy or sell rows found in that file.");
  const res = fifoMatch(events);
  return { trades: res.trades, warnings: [...warnings, ...res.warnings], skipped };
}

/** First-in, first-out matching of buy/sell events into closed and open trades. */
export function fifoMatch(events) {
  const sorted = [...events].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.side === b.side ? 0 : a.side === "buy" ? -1 : 1);
  const open = {};
  const trades = [];
  const warnings = [];
  const unmatched = {};
  for (const ev of sorted) {
    open[ev.ticker] ||= [];
    if (ev.side === "buy") {
      open[ev.ticker].push({ date: ev.date, price: ev.price, qty: ev.qty });
      continue;
    }
    let left = ev.qty;
    const queue = open[ev.ticker];
    while (left > 1e-9 && queue.length) {
      const lot = queue[0];
      const take = Math.min(left, lot.qty);
      trades.push({ ticker: ev.ticker, buyDate: lot.date, buyPrice: lot.price, qty: round(take), sellDate: ev.date, sellPrice: ev.price, currentPrice: "", industry: "" });
      lot.qty -= take;
      left -= take;
      if (lot.qty <= 1e-9) queue.shift();
    }
    if (left > 1e-6) unmatched[ev.ticker] = (unmatched[ev.ticker] || 0) + left;
  }
  for (const [ticker, queue] of Object.entries(open)) {
    for (const lot of queue) {
      trades.push({ ticker, buyDate: lot.date, buyPrice: lot.price, qty: round(lot.qty), sellDate: "", sellPrice: "", currentPrice: "", industry: "" });
    }
  }
  for (const [t, q] of Object.entries(unmatched)) {
    warnings.push(`${t}: sold ${round(q)} more shares than the file shows being bought (the purchase may be older than the export). Those shares were left out.`);
  }
  trades.sort((a, b) => (a.buyDate < b.buyDate ? -1 : 1));
  return { trades, warnings };
}

const round = (x) => Math.round(x * 1e6) / 1e6;

// ---------------------------------------------------------------------------
// Trade-level metrics
// ---------------------------------------------------------------------------

/**
 * Validate and enrich trades. Each input trade:
 *   {ticker, industry, buyDate, buyPrice, qty, sellDate?, sellPrice?, currentPrice?}
 * `prices` maps ticker -> sorted [{d, c}] history (optional) and fills a missing current price.
 */
export function prepareTrades(rawTrades, asOf, prices = {}) {
  const trades = [];
  const problems = [];
  rawTrades.forEach((r, i) => {
    const ticker = String(r.ticker || "").trim().toUpperCase();
    const buyPrice = parseNumber(r.buyPrice);
    const qty = parseNumber(r.qty);
    const buyDate = normalizeDate(r.buyDate);
    if (!ticker && !r.buyDate && !r.buyPrice) return; // blank row
    if (!ticker || !buyDate || !(buyPrice > 0) || !(qty > 0)) {
      problems.push(`Row ${i + 1}${ticker ? ` (${ticker})` : ""}: needs a ticker, buy date, buy price and number of shares.`);
      return;
    }
    if (buyDate > asOf) {
      problems.push(`Row ${i + 1} (${ticker}): the buy date is in the future.`);
      return;
    }
    const sellDate = r.sellDate ? normalizeDate(r.sellDate) : null;
    const sellPrice = parseNumber(r.sellPrice);
    const closed = !!sellDate && sellPrice > 0;
    if ((r.sellDate || r.sellPrice) && !closed) {
      problems.push(`Row ${i + 1} (${ticker}): a sold position needs both a sell date and a sell price.`);
    }
    if (!(buyPrice * qty < 1e12)) {
      problems.push(`Row ${i + 1} (${ticker}): the amount is too large to be real. Check the price and number of shares.`);
      return;
    }
    if (closed && sellDate < buyDate) {
      problems.push(`Row ${i + 1} (${ticker}): the sell date is before the buy date.`);
      return;
    }
    let current = parseNumber(r.currentPrice);
    let currentSource = current > 0 ? "entered" : null;
    if (!closed && !(current > 0) && prices[ticker]?.length) {
      const last = prices[ticker][prices[ticker].length - 1];
      current = last.c;
      currentSource = `price file (${last.d})`;
    }
    const exitDate = closed ? sellDate : asOf;
    const exitPrice = closed ? sellPrice : current > 0 ? current : null;
    const industry = r.industry && r.industry in INDUSTRIES ? r.industry : guessIndustry(ticker) || "MKT";
    const t = {
      row: i + 1, ticker, industry, buyDate, buyPrice, qty, closed,
      sellDate: closed ? sellDate : null, sellPrice: closed ? sellPrice : null,
      currentPrice: closed ? null : current > 0 ? current : null, currentSource,
      exitDate, exitPrice,
      cost: buyPrice * qty,
      days: Math.max(1, Math.round((toTime(exitDate) - toTime(buyDate)) / DAY_MS)),
    };
    t.exitValue = exitPrice ? exitPrice * qty : null;
    t.logReturn = exitPrice ? Math.log(exitPrice / buyPrice) : null;
    t.simpleReturn = exitPrice ? exitPrice / buyPrice - 1 : null;
    trades.push(t);
  });
  return { trades, problems };
}

// ---------------------------------------------------------------------------
// Analyses
// ---------------------------------------------------------------------------

/** Your money-weighted return vs the same cash flows put into the whole market. */
export function performance(trades, md) {
  const priced = trades.filter((t) => t.exitPrice);
  if (!priced.length) return null;
  const you = [], mkt = [];
  let invested = 0, value = 0, mktValue = 0, minCover = 1;
  for (const t of priced) {
    const g = md.windowGrowth("MKT", t.buyDate, t.exitDate);
    minCover = Math.min(minCover, g.covered);
    you.push({ t: toTime(t.buyDate), amount: -t.cost }, { t: toTime(t.exitDate), amount: t.exitValue });
    mkt.push({ t: toTime(t.buyDate), amount: -t.cost }, { t: toTime(t.exitDate), amount: t.cost * g.growth });
    invested += t.cost;
    value += t.exitValue;
    mktValue += t.cost * g.growth;
  }
  const realized = priced.filter((t) => t.closed).reduce((s, t) => s + t.exitValue - t.cost, 0);
  const unrealized = priced.filter((t) => !t.closed).reduce((s, t) => s + t.exitValue - t.cost, 0);
  return {
    count: priced.length,
    unpriced: trades.length - priced.length,
    invested, value, mktValue, realized, unrealized,
    youIrr: xirr(you),
    mktIrr: xirr(mkt),
    dataCoverage: minCover,
  };
}

/**
 * Group trades that share the same luck. A trade joins an existing group when it is in the
 * same industry and its holding window overlaps the group's first trade by at least half of
 * the shorter window. That puts ten chip stocks bought the same week, or monthly purchases
 * of one stock sold together, into one group, while trades that happen one after another
 * stay separate. The luck test treats a group, not a trade, as one independent bet.
 * Returns an array of group ids, one per trade.
 */
export function clusterTrades(trades) {
  const s = trades.map((t) => toTime(t.buyDate)), e = trades.map((t) => toTime(t.exitDate));
  const order = trades.map((_, i) => i).sort((a, b) => s[a] - s[b]);
  const anchors = []; // trade index that opened each group
  const group = new Array(trades.length);
  for (const i of order) {
    let found = -1;
    for (let g = 0; g < anchors.length; g++) {
      const a = anchors[g];
      if (trades[a].industry !== trades[i].industry) continue;
      const overlap = Math.min(e[a], e[i]) - Math.max(s[a], s[i]);
      if (overlap > 0 && overlap >= 0.5 * Math.min(e[a] - s[a], e[i] - s[i])) { found = g; break; }
    }
    if (found < 0) { anchors.push(i); found = anchors.length - 1; }
    group[i] = found;
  }
  return group;
}

/**
 * 95% interval from a bootstrap: the estimate plus or minus a Student-t multiple of the
 * bootstrap standard error. Plain percentile intervals are too narrow with few bets
 * (about 87% coverage with 10 bets), so the error is scaled up for the number of groups.
 */
function bootstrapInterval(estimate, boots, groups) {
  const se = stdev(Array.from(boots)) * Math.sqrt(groups / (groups - 1));
  const z = 1.95996, df = groups - 1;
  const t = z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df);
  return [estimate - t * se, estimate + t * se];
}

/**
 * The luck test. Each trade's return is compared with its own industry over the exact
 * same holding window. If you had no stock-picking edge, beating or trailing the industry
 * by a given amount would be equally likely, so we flip the sign of each trade's excess
 * return at random 10,000 times and see where your real average lands.
 */
export function luckTest(trades, md, { sims = 10000, seed = 42 } = {}) {
  const usable = [], tooRecent = [], noProxy = [];
  for (const t of trades) {
    if (!t.exitPrice) continue;
    if (t.industry === "NONE") { noProxy.push(t); continue; }
    const g = md.windowGrowth(t.industry, t.buyDate, t.exitDate);
    if (g.covered < 0.75) { tooRecent.push(t); continue; }
    const m = md.windowGrowth("MKT", t.buyDate, t.exitDate);
    usable.push({ ...t, bench: Math.log(g.growth), excess: t.logReturn - Math.log(g.growth), excessMkt: t.logReturn - Math.log(m.growth) });
  }
  const n = usable.length;
  const group = clusterTrades(usable);
  const clusters = new Set(group).size;
  const base = { n, clusters, tooRecent: tooRecent.length, noProxy: noProxy.length, trades: usable };
  if (n < 5 || clusters < 5) return { ...base, enough: false };

  const ex = usable.map((t) => t.excess);
  const obs = mean(ex);
  const sd = stdev(ex);
  const rand = rng(seed);

  // Per-group sums and means of excess return. Under "no skill" each group is as likely to
  // have beaten its industry as trailed it, so we flip whole groups, not single trades.
  const gSums = new Float64Array(clusters), gCounts = new Float64Array(clusters);
  usable.forEach((t, i) => { gSums[group[i]] += ex[i]; gCounts[group[i]]++; });
  const gMeans = Array.from(gSums, (v, g) => v / gCounts[g]);

  const nullMeans = new Float64Array(sims);
  for (let s = 0; s < sims; s++) {
    let sum = 0;
    for (let g = 0; g < clusters; g++) sum += rand() < 0.5 ? gSums[g] : -gSums[g];
    nullMeans[s] = sum / n;
  }
  let atLeast = 0, below = 0;
  for (const v of nullMeans) {
    if (v >= obs - 1e-12) atLeast++;
    if (v < obs - 1e-12) below++;
  }
  const pValue = (atLeast + 1) / (sims + 1);
  const percentile = below / sims;

  // Bootstrap 95% interval for the average excess return per trade, resampling whole groups.
  const boots = new Float64Array(4000);
  for (let b = 0; b < boots.length; b++) {
    let sum = 0, cnt = 0;
    for (let g = 0; g < clusters; g++) { const k = Math.floor(rand() * clusters); sum += gSums[k]; cnt += gCounts[k]; }
    boots[b] = sum / cnt;
  }
  const sortedBoots = Array.from(boots).sort((a, b) => a - b);

  const wins = ex.filter((e) => e > 0).length;
  const winsMkt = usable.filter((t) => t.excessMkt > 0).length;
  const groupWins = gMeans.filter((m) => m > 0).length;
  const z = 1.6449; // one-sided 5% significance
  const gObs = mean(gMeans), gSd = stdev(gMeans);
  const tradesNeeded = gObs > 0 && gSd > 0 ? Math.ceil((z * gSd / gObs) ** 2) : null;

  // Histogram of the "no skill" averages, for the chart.
  const sortedNull = Array.from(nullMeans).sort((a, b) => a - b);
  const lo = Math.min(sortedNull[0], obs), hi = Math.max(sortedNull[sims - 1], obs);
  const bins = 31, width = (hi - lo) / bins || 1e-9;
  const counts = new Array(bins).fill(0);
  for (const v of sortedNull) counts[Math.min(bins - 1, Math.floor((v - lo) / width))]++;

  return {
    ...base,
    enough: true,
    meanExcess: obs,
    medianExcess: median(ex),
    sdExcess: sd,
    pValue,
    percentile,
    ci: bootstrapInterval(obs, boots, clusters),
    wins, winsMkt,
    groupWins,
    winPValue: binomialUpperTail(groupWins, clusters),
    tradesNeeded,
    histogram: { lo, width, counts, observed: obs },
  };
}

/**
 * Skill level, from 5 labels. `confidence` is the share of no-skill investors (same bets,
 * random signs) who ended up below you. The top label needs 95%, so about 5 in 100 traders
 * with no skill still reach it by luck, and about 15 in 100 more reach "leaning".
 */
export function skillLabel(edge, confidence) {
  if (edge > 0 && confidence >= 0.95) return "likely";
  if (edge > 0 && confidence >= 0.8) return "leaning";
  if (edge <= 0 && confidence <= 0.05) return "trailing";
  if (edge <= 0 && confidence <= 0.2) return "unlucky";
  return "unclear";
}

/**
 * The headline test: did your money beat the market? Every trade's ending value is compared with
 * the same money in the whole market (without dividends, like your price-only returns) over its
 * own dates. Edge per year = the extra return per year held, with each trade weighted by its share
 * of the portfolio when it was placed, so a big long bet counts for more than a small quick one. As in the luck test, overlapping trades in one industry are
 * flipped together when simulating no-skill investors.
 * A second figure adjusts for risk: each trade is compared with the market scaled by its
 * industry's beta, so a portfolio of high-risk stocks gets less credit for a rising market.
 */
export function marketTest(trades, md, { sims = 10000, seed = 13 } = {}) {
  const usable = [];
  let tooRecent = 0;
  for (const t of trades) {
    if (!t.exitPrice) continue;
    const m = md.marketPriceGrowth(t.buyDate, t.exitDate);
    if (m.covered < 0.75) { tooRecent++; continue; }
    const rf = md.windowGrowth("RF", t.buyDate, t.exitDate).growth;
    const beta = t.industry === "NONE" || t.industry === "MKT" ? 1 : md.beta(t.industry);
    const lm = Math.log(m.growth), lf = Math.log(rf);
    // Simple (dollar) returns, not log returns: a +400% winner must outweigh a -70% loser
    // the way it does in your account.
    const grew = 1 + t.simpleReturn;
    usable.push({ ...t, years: t.days / 365.25, excess: grew - m.growth, excessRisk: grew - Math.exp(lf + beta * (lm - lf)), beta });
  }
  const n = usable.length;
  const group = clusterTrades(usable);
  const clusters = new Set(group).size;
  const base = { n, clusters, tooRecent };
  if (n < 5 || clusters < 5) return { ...base, enough: false };

  // Weight each trade by its share of the portfolio when it was placed, not by its dollar size.
  // Portfolios grow with savings (and funds with client money), so dollar weights would let the
  // latest, biggest years drown out the rest. This is the time-weighted idea fund managers are
  // judged by: a 10% position counts the same in year one as in year ten.
  const events = [];
  usable.forEach((t, i) => {
    events.push([toTime(t.buyDate), 1, i], [toTime(t.exitDate), 0, i]);   // exits sort before buys on a day
  });
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const share = new Float64Array(n);
  let open = 0;
  for (let k = 0; k < events.length;) {
    const day = events[k][0];
    let j = k;
    for (; j < events.length && events[j][0] === day && events[j][1] === 0; j++) open -= usable[events[j][2]].cost;
    const buys = [];
    for (; j < events.length && events[j][0] === day; j++) { open += usable[events[j][2]].cost; buys.push(events[j][2]); }
    for (const i of buys) share[i] = usable[i].cost / Math.max(open, usable[i].cost);
    k = j;
  }

  const rand = rng(seed);
  const measure = (key) => {
    const g = new Float64Array(clusters), d = new Float64Array(clusters);
    usable.forEach((t, i) => { g[group[i]] += share[i] * t[key]; d[group[i]] += share[i] * t.years; });
    const D = d.reduce((a, b) => a + b, 0);
    const edge = g.reduce((a, b) => a + b, 0) / D;          // extra return per year, portfolio-weighted
    const nulls = new Float64Array(sims);
    let below = 0;
    for (let s = 0; s < sims; s++) {
      let sum = 0;
      for (let k = 0; k < clusters; k++) sum += rand() < 0.5 ? g[k] : -g[k];
      nulls[s] = sum / D;
      if (nulls[s] < edge - 1e-12) below++;
    }
    const boots = new Float64Array(4000);
    for (let b = 0; b < boots.length; b++) {
      let gs = 0, ds = 0;
      for (let k = 0; k < clusters; k++) { const j = Math.floor(rand() * clusters); gs += g[j]; ds += d[j]; }
      boots[b] = gs / ds;
    }
    return { edge, confidence: below / sims, se: stdev(Array.from(nulls)), ci: bootstrapInterval(edge, boots, clusters) };
  };
  const main = measure("excess");
  const risk = measure("excessRisk");

  const first = usable.reduce((m, t) => Math.min(m, toTime(t.buyDate)), Infinity);
  const last = usable.reduce((m, t) => Math.max(m, toTime(t.exitDate)), -Infinity);
  const span = Math.max(1 / 12, (last - first) / (365.25 * DAY_MS));
  // At today's edge and spread, how much longer a record like this one would need to be
  // for the top label (one-sided 95%). Null when there's no positive edge to confirm.
  const k = main.edge > 0 ? (1.645 * main.se / main.edge) ** 2 : null;
  const moreYears = k === null ? null : Math.max(0, span * (k - 1));

  return {
    ...base,
    enough: true,
    edge: main.edge, confidence: main.confidence, ci: main.ci,
    risk: { edge: risk.edge, confidence: risk.confidence, label: skillLabel(risk.edge, risk.confidence) },
    label: skillLabel(main.edge, main.confidence),
    span, moreYears,
    avgBeta: usable.reduce((a, t, i) => a + share[i] * t.beta, 0) / share.reduce((a, b) => a + b, 0),
  };
}

/** Do you sell winners quickly and sit on losers? (closed trades only) */
export function holdingTest(trades, { sims = 10000, seed = 7 } = {}) {
  const closed = trades.filter((t) => t.closed);
  const winners = closed.filter((t) => t.logReturn > 0);
  const losers = closed.filter((t) => t.logReturn < 0);
  const openLosers = trades.filter((t) => !t.closed && t.logReturn !== null && t.logReturn < 0);
  const base = { closed: closed.length, winners: winners.length, losers: losers.length, openLosers };
  if (winners.length < 3 || losers.length < 3) return { ...base, enough: false };

  const lw = winners.map((t) => Math.log(t.days));
  const ll = losers.map((t) => Math.log(t.days));
  const obs = mean(ll) - mean(lw);
  const all = [...lw, ...ll];
  // Each simulation shuffles every sold trade; keep very large imports (fund holdings) responsive.
  sims = Math.min(sims, Math.max(500, Math.floor(2e7 / all.length)));
  const rand = rng(seed);
  let atLeast = 0;
  for (let s = 0; s < sims; s++) {
    const shuffled = [...all];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const d = mean(shuffled.slice(lw.length)) - mean(shuffled.slice(0, lw.length));
    if (d >= obs - 1e-12) atLeast++;
  }
  const winnerDays = median(winners.map((t) => t.days));
  const loserDays = median(losers.map((t) => t.days));
  const longOpenLosers = openLosers.filter((t) => t.days > winnerDays);
  return {
    ...base,
    enough: true,
    winnerDays, loserDays,
    ratio: loserDays / winnerDays,
    pValue: (atLeast + 1) / (sims + 1),
    longOpenLosers,
  };
}

/**
 * Weights of the portfolio being analysed. Uses open positions at current value
 * (cost if no current price); if everything is sold, uses all trades at cost.
 */
export function portfolioWeights(trades) {
  const openTrades = trades.filter((t) => !t.closed);
  const basis = openTrades.length ? openTrades : trades;
  const byTicker = new Map();
  for (const t of basis) {
    const v = !t.closed && t.currentPrice ? t.currentPrice * t.qty : t.cost;
    const cur = byTicker.get(t.ticker) || { ticker: t.ticker, industry: t.industry, value: 0 };
    cur.value += v;
    byTicker.set(t.ticker, cur);
  }
  const positions = [...byTicker.values()];
  const total = positions.reduce((s, p) => s + p.value, 0);
  positions.forEach((p) => (p.weight = p.value / total));
  positions.sort((a, b) => b.value - a.value);
  const byIndustry = {};
  for (const p of positions) byIndustry[p.industry] = (byIndustry[p.industry] || 0) + p.weight;
  return { positions, total, byIndustry, basis: openTrades.length ? "current holdings" : "all past trades (everything is sold)" };
}

/**
 * Monthly return history of today's mix, using each holding's real monthly returns where
 * a price history was supplied and its industry proxy otherwise. Holdings with no proxy
 * (bonds, crypto...) are left out and the rest re-weighted.
 */
export function mixReturns(weights, md, exactMonthly = {}, months = 240) {
  const usable = weights.positions.filter((p) => p.industry !== "NONE");
  const total = usable.reduce((s, p) => s + p.weight, 0);
  if (!usable.length || total <= 0) return null;
  const start = Math.max(md.first, md.last - months + 1);
  const out = [];
  let exactWeightMonths = 0;
  for (let m = start; m <= md.last; m++) {
    let r = 0, ok = true, exactW = 0;
    for (const p of usable) {
      const ex = exactMonthly[p.ticker]?.get(m);
      let v;
      if (ex !== undefined) { v = ex; exactW += p.weight / total; } else v = md.value(p.industry, m);
      if (v === null || v === undefined) { ok = false; break; }
      r += (p.weight / total) * v;
    }
    const mk = md.value("MKT", m), rf = md.value("RF", m);
    if (!ok || mk === null || rf === null) continue;
    out.push({ m, r, mkt: mk, rf });
    exactWeightMonths += exactW;
  }
  return {
    series: out,
    excludedWeight: 1 - total,
    exactShare: out.length ? exactWeightMonths / out.length : 0,
  };
}

/** Fama-French 3 factors + momentum regression of the mix over the last `months` months. */
export function factorExposure(mix, md, months = 120) {
  if (!mix) return null;
  const rows = mix.series.slice(-months).filter((p) =>
    ["MktRF", "SMB", "HML", "Mom"].every((f) => md.value(f, p.m) !== null));
  if (rows.length < 36) return null;
  const y = rows.map((p) => p.r - p.rf);
  const X = ["MktRF", "SMB", "HML", "Mom"].map((f) => rows.map((p) => md.value(f, p.m)));
  const fit = ols(y, X);
  if (!fit) return null;
  const [alpha, mkt, smb, hml, mom] = fit.beta;
  return {
    months: rows.length,
    from: monthLabel(rows[0].m), to: monthLabel(rows[rows.length - 1].m),
    alphaAnnual: alpha * 12,
    alphaT: fit.t[0],
    loadings: { MktRF: mkt, SMB: smb, HML: hml, Mom: mom },
    t: { MktRF: fit.t[1], SMB: fit.t[2], HML: fit.t[3], Mom: fit.t[4] },
    r2: fit.r2,
  };
}

export const STRESS_EVENTS = [
  { name: "Black Monday", from: "1987-10", to: "1987-11" },
  { name: "Dot-com bust", from: "2000-04", to: "2002-09" },
  { name: "Financial crisis", from: "2007-11", to: "2009-02" },
  { name: "2011 euro scare", from: "2011-05", to: "2011-09" },
  { name: "COVID crash", from: "2020-02", to: "2020-03" },
  { name: "2022 bear market", from: "2022-01", to: "2022-09" },
];

/** How today's mix would have done in past crashes (industry proxies). */
export function stressTests(weights, md) {
  const usable = weights.positions.filter((p) => p.industry !== "NONE");
  const total = usable.reduce((s, p) => s + p.weight, 0);
  if (!usable.length) return [];
  return STRESS_EVENTS.map((ev) => {
    let g = 1, gm = 1, ok = true;
    for (let m = monthIndex(ev.from); m <= monthIndex(ev.to); m++) {
      let r = 0;
      for (const p of usable) {
        const v = md.value(p.industry, m);
        if (v === null) { ok = false; break; }
        r += (p.weight / total) * v;
      }
      const mk = md.value("MKT", m);
      if (!ok || mk === null) { ok = false; break; }
      g *= 1 + r;
      gm *= 1 + mk;
    }
    return ok ? { ...ev, mix: g - 1, market: gm - 1 } : { ...ev, mix: null, market: null };
  });
}

/** Does your portfolio fall at the same time your paycheck is most at risk? */
export function humanCapital(mix, weights, md, job) {
  if (!mix || !job || job === "NONE") return null;
  const rows = mix.series.filter((p) => md.value(job, p.m) !== null);
  if (rows.length < 60) return null;
  const jobR = rows.map((p) => md.value(job, p.m));
  const mixR = rows.map((p) => p.r);
  const mktR = rows.map((p) => p.mkt);
  const corr = correlation(mixR, jobR);
  const corrMkt = correlation(mktR, jobR);
  const fit = ols(mixR, [jobR]);
  // The worst 10% of months for your industry.
  const order = jobR.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const worst = order.slice(0, Math.max(6, Math.round(rows.length * 0.1))).map(([, i]) => i);
  return {
    months: rows.length,
    from: monthLabel(rows[0].m), to: monthLabel(rows[rows.length - 1].m),
    corr, corrMkt,
    beta: fit ? fit.beta[1] : null,
    directWeight: weights.byIndustry[job] || 0,
    worstMonths: worst.length,
    worstJob: mean(worst.map((i) => jobR[i])),
    worstMix: mean(worst.map((i) => mixR[i])),
    worstMkt: mean(worst.map((i) => mktR[i])),
  };
}

/** Growth of $1 for the mix and the market over the analysed window (for the chart). */
export function growthPaths(mix) {
  if (!mix) return null;
  let g = 1, gm = 1;
  const you = [], mkt = [];
  for (const p of mix.series) {
    g *= 1 + p.r;
    gm *= 1 + p.mkt;
    const time = `${monthLabel(p.m)}-28`;
    you.push({ time, value: g });
    mkt.push({ time, value: gm });
  }
  return { you, mkt };
}
