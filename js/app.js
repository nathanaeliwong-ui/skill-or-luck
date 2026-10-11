// Skill or Luck — page logic. All analysis happens in this browser tab.
import * as E from "./engine.js";

const $ = (sel) => document.querySelector(sel);
const STORE_TRADES = "sol:trades:v1";
const STORE_PRICES = "sol:prices:v1";
const STORE_KEY = "sol:avkey:v1";

const SHORT = {
  BusEq: "Tech", Money: "Finance", Hlth: "Healthcare", Shops: "Retail", NoDur: "Consumer staples",
  Durbl: "Cars & durables", Manuf: "Manufacturing", Enrgy: "Energy", Chems: "Chemicals",
  Telcm: "Telecom", Utils: "Utilities", Other: "Other", MKT: "Whole market", NONE: "No proxy",
};

// Approximate historical closing prices (split-adjusted), for demonstration only.
const SAMPLE = [
  ["AAPL", "2019-01-02", 39.48, 40, "2020-01-02", 75.09],
  ["MSFT", "2018-06-01", 100.79, 20, "2019-06-03", 119.84],
  ["NVDA", "2019-01-02", 3.40, 300, "2019-09-03", 4.30],
  ["KO", "2018-01-02", 45.54, 30, "2023-01-03", 63.58],
  ["HD", "2019-05-01", 203.30, 10, "2021-11-01", 371.70],
  ["TSLA", "2020-01-02", 28.68, 50, "2020-08-31", 166.11],
  ["JPM", "2020-03-23", 84.53, 20, "2021-03-23", 153.00],
  ["XOM", "2020-10-30", 32.62, 60, "2022-11-01", 111.60],
  ["DIS", "2021-03-08", 197.00, 10, "2023-03-01", 99.10],
  ["INTC", "2021-04-01", 64.62, 25, "2024-08-02", 21.48],
  ["META", "2021-09-07", 382.18, 5, "2022-11-03", 88.91],
  ["PFE", "2021-12-17", 59.00, 30, "2023-10-02", 32.70],
  ["AAPL", "2021-12-01", 164.77, 10, "2022-06-16", 130.06],
  ["AMZN", "2022-01-03", 170.40, 10, "2023-01-03", 85.82],
  ["NVDA", "2022-10-03", 12.50, 80, "2023-05-31", 37.83],
  ["MSFT", "2022-11-03", 214.25, 10, "2023-07-18", 359.49],
  ["VOO", "2022-01-03", 439.00, 10, "", ""],
  ["AAPL", "2023-06-01", 180.09, 15, "", ""],
  ["JPM", "2024-05-01", 191.60, 10, "", ""],
  ["BND", "2023-01-03", 72.50, 40, "", ""],
];

const state = {
  rows: [],
  job: "",
  prices: {}, // ticker -> {points, source, at, splits}
  md: null,
};

// ---------------------------------------------------------------------------
// Storage (wrapped: private windows and blocked storage must not break the page)
// ---------------------------------------------------------------------------

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
function remove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
let saveTimer = null;
function saveTradesSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(STORE_TRADES, { rows: state.rows, job: state.job }), 300);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function pct(x, digits = 1, sign = true) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const v = (x * 100).toFixed(digits);
  return (sign && x > 0 ? "+" : "") + v.replace("-", "−") + "%";
}
const pctLog = (x, d = 1) => pct(Math.exp(x) - 1, d);
function money(x) {
  if (!Number.isFinite(x)) return "—";
  const s = Math.abs(x).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return (x < 0 ? "−" : "") + s;
}
const tone = (x) => (x > 0 ? "pos" : x < 0 ? "neg" : "");
function chance(p) {
  if (p < 0.001) return "less than 0.1%";
  return `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
}
function monthName(label) {
  const [y, m] = label.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function download(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------------------------------------------------------------------------
// Trades table
// ---------------------------------------------------------------------------

const blankRow = () => ({ ticker: "", industry: "", buyDate: "", buyPrice: "", qty: "", sellDate: "", sellPrice: "", currentPrice: "" });

function industryOptions(select, row) {
  const guess = E.guessIndustry(row.ticker);
  const auto = !row.industry;
  select.innerHTML = "";
  if (auto && !guess) {
    const o = new Option(row.ticker ? "Choose… (unknown ticker)" : "Auto from ticker", "");
    select.add(o);
  }
  for (const [code, label] of Object.entries(E.INDUSTRIES)) {
    const o = new Option(label, code);
    select.add(o);
  }
  select.value = row.industry || guess || "";
  select.classList.toggle("auto", auto);
  select.title = auto ? (guess ? "Guessed from the ticker. Change it if it's wrong." : "Pick the closest industry.") : "";
}

function renderTable() {
  const body = $("#trades-body");
  body.innerHTML = "";
  const tpl = $("#row-template");
  state.rows.forEach((row, i) => {
    const tr = tpl.content.firstElementChild.cloneNode(true);
    tr.dataset.i = i;
    for (const input of tr.querySelectorAll("[data-f]")) {
      const f = input.dataset.f;
      if (f === "industry") industryOptions(input, row);
      else input.value = row[f] ?? "";
    }
    tr.classList.toggle("closed", !!(row.sellDate || row.sellPrice));
    body.appendChild(tr);
  });
  renderPriceList();
}

function onTableInput(e) {
  const input = e.target.closest("[data-f]");
  if (!input) return;
  const tr = input.closest("tr");
  const row = state.rows[+tr.dataset.i];
  const f = input.dataset.f;
  if (f === "ticker") {
    row.ticker = input.value.trim().toUpperCase();
    industryOptions(tr.querySelector('[data-f="industry"]'), row);
  } else if (f === "industry") {
    row.industry = input.value;
    input.classList.remove("auto");
  } else {
    row[f] = input.value;
  }
  tr.classList.toggle("closed", !!(row.sellDate || row.sellPrice));
  saveTradesSoon();
}

function setRows(rows, job) {
  state.rows = rows.length ? rows : [blankRow()];
  if (job !== undefined) {
    state.job = job;
    $("#job-select").value = job;
  }
  renderTable();
  saveTradesSoon();
}

// ---------------------------------------------------------------------------
// Price data panel
// ---------------------------------------------------------------------------

function tickers() {
  return [...new Set(state.rows.map((r) => r.ticker).filter(Boolean))].sort();
}

function renderPriceList() {
  const list = $("#price-list");
  const ts = tickers();
  if (!ts.length) { list.innerHTML = ""; return; }
  list.innerHTML = ts.map((t) => {
    const p = state.prices[t];
    const status = p
      ? `<span class="src exact">Exact · ${esc(p.source)} · ${p.points.length} prices to ${esc(p.points[p.points.length - 1].d)}${p.splits?.length ? ` · ${p.splits.length} split${p.splits.length > 1 ? "s" : ""} adjusted` : ""}</span>`
      : rowIndustry(t) === "NONE"
        ? `<span class="src">No industry proxy (bonds, gold, crypto, cash)</span>`
        : `<span class="src">Using ${esc(SHORT[rowIndustry(t)])} industry as proxy</span>`;
    const lower = encodeURIComponent(t.toLowerCase());
    return `<li>
      <div><span class="tk">${esc(t)}</span>${status}</div>
      <div class="acts">
        ${p ? `<label data-unattach="${esc(t)}">Remove</label>` : `
        <a href="https://www.nasdaq.com/market-activity/stocks/${lower}/historical" target="_blank" rel="noopener" title="Open Nasdaq historical quotes">Nasdaq</a>
        <a href="https://stooq.com/q/d/?s=${lower}.us" target="_blank" rel="noopener" title="Open Stooq historical data">Stooq</a>
        <label title="Attach a CSV price file">Attach<input type="file" accept=".csv,.txt,text/csv" data-attach="${esc(t)}" hidden></label>`}
      </div>
    </li>`;
  }).join("");
}

function rowIndustry(ticker) {
  const r = state.rows.find((x) => x.ticker === ticker && x.industry);
  return r?.industry || E.guessIndustry(ticker) || "MKT";
}

function setPrices(ticker, points, source) {
  const { points: adjusted, splits } = E.adjustSplits(points);
  state.prices[ticker] = { points: adjusted, source, at: E.todayStr(), splits };
  if (!save(STORE_PRICES, state.prices)) {
    $("#av-status").textContent = "Prices loaded, but this browser couldn't store them for next time.";
  }
}

async function onAttach(e) {
  const input = e.target.closest("[data-attach]");
  if (!input || !input.files?.[0]) return;
  const ticker = input.dataset.attach;
  try {
    const points = E.parsePriceCsv(await input.files[0].text());
    setPrices(ticker, points, "file");
  } catch (err) {
    $("#av-status").textContent = `${ticker}: ${err.message}`;
  }
  renderPriceList();
}

let avBusy = false;
async function fetchAlphaVantage() {
  if (avBusy) return;
  const key = $("#av-key").value.trim();
  const status = $("#av-status");
  if (!key) { status.textContent = "Paste your free API key first."; return; }
  if ($("#av-remember").checked) save(STORE_KEY, key); else remove(STORE_KEY);
  const todo = tickers().filter((t) => !state.prices[t] && rowIndustry(t) !== "NONE");
  if (!todo.length) { status.textContent = "Every ticker already has exact prices (bonds, gold and crypto are skipped)."; return; }
  if (todo.length > 25) status.textContent = `The free key allows 25 requests a day; fetching the first 25 of ${todo.length}.`;
  const batch = todo.slice(0, 25);
  avBusy = true;
  $("#btn-av").disabled = true;
  let done = 0, failures = 0;
  try {
    for (let i = 0; i < batch.length; i++) {
      const t = batch[i];
      if (i > 0) {
        // Free keys allow 5 requests per minute.
        for (let s = 13; s > 0; s--) {
          status.textContent = `Fetched ${done} of ${batch.length}. Next in ${s}s (free keys allow 5 a minute)…`;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      status.textContent = `Fetching ${t} (${i + 1} of ${batch.length})…`;
      const url = `https://www.alphavantage.co/query?function=TIME_SERIES_MONTHLY_ADJUSTED&symbol=${encodeURIComponent(t)}&apikey=${encodeURIComponent(key)}`;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Alpha Vantage answered with HTTP ${res.status}`);
        const json = await res.json().catch(() => { throw new Error("Alpha Vantage sent something unexpected"); });
        const points = E.parseAlphaVantage(json);
        if (points.length < 2) throw new Error("no price history returned");
        setPrices(t, points, "Alpha Vantage, monthly");
        done++;
        failures = 0;
        renderPriceList();
      } catch (err) {
        const msg = String(err.message || err);
        // Three failures in a row means the problem is the connection or the key, not one ticker.
        if (++failures >= 3) {
          status.textContent = `Stopped after 3 failed requests (${msg.slice(0, 100)}). Check your connection and key, then try again.`;
          return;
        }
        if (/rate limit|requests per day|premium|frequency/i.test(msg)) {
          status.textContent = `Stopped: Alpha Vantage says "${msg.slice(0, 160)}"`;
          return;
        }
        status.textContent = `${t}: ${msg.slice(0, 120)}. Continuing…`;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    status.textContent = `Done: exact prices for ${done} of ${batch.length} tickers.`;
  } finally {
    avBusy = false;
    $("#btn-av").disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

const CSV_HEAD = "ticker,buy_date,buy_price,shares,sell_date,sell_price,current_price,industry";
// Quote cells that need it, and defuse spreadsheet formulas (a text cell starting with = + - @).
const csvCell = (v) => {
  let t = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(t) && !Number.isFinite(Number(t))) t = `'${t}`;
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

function exportRows() {
  const lines = [CSV_HEAD, ...state.rows.filter((r) => r.ticker).map((r) =>
    [r.ticker, r.buyDate, r.buyPrice, r.qty, r.sellDate, r.sellPrice, r.currentPrice, r.industry].map(csvCell).join(","))];
  download("my-trades.csv", lines.join("\n"));
}

function downloadTemplate() {
  download("skill-or-luck-template.csv", [
    CSV_HEAD,
    "AAPL,2021-03-15,121.03,10,2023-08-01,195.61,,",
    "VOO,2022-01-03,439.00,5,,,,",
  ].join("\n"));
}

async function onBrokerFile(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  const box = $("#import-msg");
  box.hidden = false;
  try {
    const { trades, warnings, skipped } = E.importBrokerCsv(await file.text());
    const rows = trades.map((t) => ({
      ticker: t.ticker, industry: t.industry || "", buyDate: t.buyDate, buyPrice: String(t.buyPrice), qty: String(t.qty),
      sellDate: t.sellDate || "", sellPrice: t.sellPrice ? String(t.sellPrice) : "", currentPrice: t.currentPrice ? String(t.currentPrice) : "",
    }));
    const existing = state.rows.filter((r) => r.ticker);
    setRows(existing.length ? [...existing, ...rows] : rows);
    const open = rows.filter((r) => !r.sellDate).length;
    box.className = "notice ok";
    box.innerHTML = `Imported ${rows.length} trade${rows.length === 1 ? "" : "s"} from ${esc(file.name)}${skipped ? ` (skipped ${skipped} rows that weren't buys or sells, such as dividends and transfers)` : ""}.`
      + (open ? ` Add <strong>today's price</strong> for the ${open} position${open === 1 ? "" : "s"} you still hold, or attach price files in step 2.` : "")
      + (warnings.length ? `<ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "")
      + (existing.length ? ` <button type="button" class="btn" id="btn-replace">Use only these ${rows.length} trades</button>` : "");
    $("#btn-replace")?.addEventListener("click", () => { setRows(rows); $("#btn-replace").remove(); });
  } catch (err) {
    box.className = "notice warn";
    box.textContent = `Couldn't read ${file.name}: ${err.message}`;
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

async function marketData() {
  if (state.md) return state.md;
  const res = await fetch("data/french.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Daily returns make trade windows exact. If that file is missing we fall back to monthly.
  let daily = null;
  try {
    const dres = await fetch("data/french-daily.json", { cache: "no-cache" });
    if (dres.ok) daily = await dres.json();
  } catch { /* monthly fallback */ }
  state.md = new E.MarketData(await res.json(), daily);
  $("#data-date").textContent = daily
    ? ` (daily data through ${daily.lastDate})`
    : ` (monthly data through ${monthName(state.md.raw.lastMonth)})`;
  return state.md;
}

async function run() {
  const btn = $("#btn-run");
  const msg = $("#run-msg");
  btn.disabled = true;
  msg.textContent = "Crunching…";
  try {
    let md;
    try {
      md = await marketData();
    } catch {
      msg.textContent = "";
      showProblem("The market data file isn't available yet. If you just published this site, wait for the “Deploy site” action on GitHub to finish, then reload.");
      $("#results").hidden = false;
      return;
    }
    const asOf = E.todayStr();
    const pts = Object.fromEntries(Object.entries(state.prices).map(([t, p]) => [t, p.points]));
    const { trades, problems } = E.prepareTrades(state.rows, asOf, pts);
    if (!trades.length) {
      msg.textContent = "Add at least one complete trade first (ticker, buy date, buy price and shares), or try the sample.";
      $("#results").hidden = true;
      if (problems.length) msg.textContent += ` ${problems.join(" ")}`;
      return;
    }
    const notes = [...problems.map(esc), ...sanityChecks(trades, md)];
    const exactMonthly = Object.fromEntries(Object.entries(state.prices).map(([t, p]) => [t, E.monthlyReturnsFromPrices(p.points)]));

    const perf = E.performance(trades, md);
    const luck = E.luckTest(trades, md);
    const hold = E.holdingTest(trades);
    const weights = E.portfolioWeights(trades);
    const mix = E.mixReturns(weights, md, exactMonthly);
    const factors = E.factorExposure(mix, md);
    const stress = E.stressTests(weights, md);
    const job = E.humanCapital(mix, weights, md, state.job);

    $("#results").hidden = false;
    clearCharts();
    renderVerdict(luck, perf);
    renderStats(perf, luck);
    showProblem(notes.length ? `<strong>Check these:</strong><ul>${notes.map((n) => `<li>${n}</li>`).join("")}</ul>` : "");
    renderLuck(luck, md);
    renderHolding(hold);
    renderMix(weights, factors, mix);
    renderJob(job, weights);
    renderStress(stress);
    renderGrowth(mix, weights);
    renderPriceCharts(trades);
    syncTabs();
    msg.textContent = "";
    $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error(err);
    msg.textContent = `Something went wrong: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function sanityChecks(trades, md) {
  const notes = [];
  const unknown = [...new Set(trades.filter((t) => !E.guessIndustry(t.ticker) && !state.rows.find((r) => r.ticker === t.ticker && r.industry)).map((t) => t.ticker))];
  if (unknown.length) notes.push(`Not in the built-in list, so treated as the whole market: <strong>${unknown.map(esc).join(", ")}</strong>. Pick the right industry in the table for better results.`);
  const noPrice = [...new Set(trades.filter((t) => !t.closed && !t.currentPrice).map((t) => t.ticker))];
  if (noPrice.length) notes.push(`No price today for <strong>${noPrice.map(esc).join(", ")}</strong>, so ${noPrice.length === 1 ? "it's" : "they're"} left out of the return figures and the luck test. Type today's price in the table or attach price files.`);
  for (const t of trades) {
    const p = state.prices[t.ticker];
    if (!p) continue;
    const ref = E.priceOnOrBefore(p.points, t.buyDate);
    if (!ref) continue;
    const gapDays = (E.toTime(t.buyDate) - E.toTime(ref.d)) / 86400000;
    const monthly = /monthly/.test(p.source);
    if (gapDays > (monthly ? 35 : 7)) continue;
    const ratio = t.buyPrice / ref.c;
    const lim = monthly ? 1.6 : 1.35;
    if (ratio > lim || ratio < 1 / lim) {
      notes.push(`Row ${t.row} (${esc(t.ticker)}): the buy price ${t.buyPrice.toFixed(2)} is far from the price file's ${ref.c.toFixed(2)} around ${esc(ref.d)}. If the stock split after you bought, enter the split-adjusted price and shares.`);
    }
  }
  const lastDay = md.daily ? md.daily.last : null;
  const lastData = E.monthLabel(md.last);
  if (lastDay ? trades.some((t) => t.exitDate > lastDay) : trades.some((t) => t.exitDate.slice(0, 7) > lastData)) {
    notes.push(`Industry data runs through ${lastDay ? lastDay : monthName(lastData)}, so the most recent weeks aren't part of the industry comparisons yet.`);
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Result tabs: one section at a time, so the page is not one long scroll
// ---------------------------------------------------------------------------

let activeTab = "card-luck";
function selectTab(id) {
  const tabs = [...document.querySelectorAll("#result-tabs [data-tab]")].filter((b) => !b.hidden);
  if (!tabs.some((b) => b.dataset.tab === id)) id = tabs[0]?.dataset.tab;
  activeTab = id;
  for (const b of document.querySelectorAll("#result-tabs [data-tab]")) {
    const on = b.dataset.tab === id;
    b.setAttribute("aria-selected", String(on));
    $(`#${b.dataset.tab}`).classList.toggle("is-off", !on);
    if (on) { const bar = $("#result-tabs"); bar.scrollLeft = b.offsetLeft - (bar.clientWidth - b.offsetWidth) / 2; }
  }
}
function syncTabs() {
  // The price-chart tab only exists when price files were attached.
  const charts = document.querySelector('#result-tabs [data-tab="card-charts"]');
  charts.hidden = $("#card-charts").hidden;
  selectTab(activeTab);
}
function initTabs() {
  $("#result-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) selectTab(b.dataset.tab);
  });
}

function showProblem(html) {
  const box = $("#problems");
  box.hidden = !html;
  box.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Rendering results
// ---------------------------------------------------------------------------

function renderVerdict(L, P) {
  const box = $("#verdict");
  let head, explain, color;
  if (!L.enough) {
    head = "Not enough trades to tell yet";
    color = cssVar("--gold");
    explain = L.n >= 5
      ? `Your ${L.n} trades are really only ${L.clusters} separate bet${L.clusters === 1 ? "" : "s"}. Trades in the same industry held over the same dates, or repeat buys of one stock, share the same luck, so they count once. The luck test needs at least 5 separate bets.`
      : `The luck test needs at least 5 trades with a known end price in stocks it can compare with an industry. It found ${L.n}.`;
    explain += L.tooRecent ? ` ${L.tooRecent} more ${L.tooRecent === 1 ? "is" : "are"} too recent for the industry data.` : "";
  } else {
    const med = pctLog(L.medianExcess);
    if (L.meanExcess <= 0) {
      head = "No sign of skill";
      color = cssVar("--luck");
      explain = `On average your picks trailed their own industry by ${pctLog(L.meanExcess).replace("−", "")} per trade${L.medianExcess > 0 ? `. Your typical trade did beat it (median ${med}), but the losers cost more than the winners made` : ""}. Holding the industry instead would have done better.`;
    } else if (L.pValue < 0.05) {
      head = "Evidence of skill";
      color = cssVar("--skill");
      explain = `Your picks beat their own industry by a median ${med} per trade. An investor with no skill would match that only ${chance(L.pValue)} of the time.`;
    } else if (L.pValue < 0.2) {
      head = "Promising, but could still be luck";
      color = cssVar("--gold");
      explain = `Your picks beat their own industry by a median ${med} per trade, but a no-skill investor would do this well ${chance(L.pValue)} of the time. More trades will tell.`;
    } else {
      head = "Indistinguishable from luck";
      color = cssVar("--gold");
      explain = `Your picks beat their own industry by a median ${med} per trade, but ${chance(L.pValue)} of no-skill investors would do at least as well. That's what luck looks like.`;
    }
  }
  const notes = [];
  if (L.enough) {
    if (P && P.youIrr > P.mktIrr && head !== "Evidence of skill") {
      notes.push("Your overall return did beat the whole market, but that can come from owning industries that did well, which this test doesn't count as stock-picking skill.");
    }
    notes.push("Industry returns include dividends and your trade returns don't, so this comparison leans slightly against you.");
  }
  box.style.setProperty("--tone", color);
  box.innerHTML = `<p class="label">Verdict on ${L.n} trade${L.n === 1 ? "" : "s"}</p><p class="headline">${esc(head)}</p><p class="explain">${explain}</p>${notes.map((n) => `<p class="fine">${n}</p>`).join("")}`;
}

function renderStats(P, L) {
  const cards = [];
  if (P) {
    cards.push(stat("Your annual return", pct(P.youIrr), `money-weighted, ${P.count} trade${P.count === 1 ? "" : "s"} with a known price`, tone(P.youIrr)));
    cards.push(stat("Same money in the whole market", pct(P.mktIrr), "same amounts on the same dates", tone(P.mktIrr)));
    const diff = P.value - P.mktValue;
    cards.push(stat("You vs the market, in dollars", (diff >= 0 ? "+" : "") + money(diff), `${money(P.value)} vs ${money(P.mktValue)} ending value`, tone(diff)));
  }
  if (L.enough) {
    cards.push(stat("Trades that beat their industry", `${L.wins} of ${L.n}`, L.clusters < L.n
      ? `counting overlapping bets once (${L.groupWins} of ${L.clusters}), a coin-flipper does this well ${chance(L.winPValue)} of the time`
      : `a coin-flipper does this well ${chance(L.winPValue)} of the time`));
    cards.push(stat("Trades needed to rule out luck",
      L.tradesNeeded ? (L.tradesNeeded <= L.clusters ? `${L.tradesNeeded} ✓` : `~${L.tradesNeeded.toLocaleString()}`) : "—",
      L.tradesNeeded ? `separate bets at your current edge; you have ${L.clusters}` : "no edge to prove yet"));
  }
  $("#stat-cards").innerHTML = cards.join("");
}
const stat = (k, v, s, cls = "") => `<div class="stat"><p class="k">${esc(k)}</p><p class="v ${cls}">${esc(v)}</p><p class="s">${esc(s)}</p></div>`;

function renderLuck(L, md) {
  const body = $("#luck-body");
  if (!L.enough) {
    body.innerHTML = `<p class="empty">Add more trades with a sell price or today's price to run this test.</p>`;
    return;
  }
  const exclude = [];
  if (L.tooRecent) exclude.push(`${L.tooRecent} too recent for the industry data`);
  if (L.noProxy) exclude.push(`${L.noProxy} in bonds, gold, crypto or cash, which have no industry to compare with`);
  const includesZero = L.ci[0] < 0 && L.ci[1] > 0;
  body.innerHTML = `
    <p>Each of your ${L.n} trades was compared with its own industry over the exact same dates. If you had no stock-picking skill, beating or trailing the industry would be a coin flip. We simulated 10,000 investors with no skill, using your trades' sizes of wins and losses with random signs.${L.clusters < L.n ? ` Your ${L.n} trades overlap enough to count as ${L.clusters} separate bets, and each bet is flipped as a unit.` : ""}</p>
    <div class="legend"><span><i style="background:${cssVar("--market")};opacity:.5"></i>No-skill investors</span><span><i style="background:${cssVar("--gold")}"></i>Did at least as well as you (${chance(L.pValue)})</span><span><i style="background:${cssVar("--ink")}"></i>You</span></div>
    ${histogramSvg(L.histogram)}
    <p>Your average trade ${L.meanExcess >= 0 ? "beat" : "trailed"} its industry by <strong>${pct(Math.abs(Math.exp(L.meanExcess) - 1), 1, false)}</strong> (median ${pctLog(L.medianExcess)}). You did better than <strong>${Math.round(L.percentile * 100)}%</strong> of the no-skill investors.</p>
    <p>The plausible range for your true edge per trade is ${pctLog(L.ci[0])} to ${pctLog(L.ci[1])} (95% bootstrap interval)${includesZero ? ", which includes zero, so luck can't be ruled out" : ""}.</p>
    ${exclude.length ? `<p class="why">Not included: ${exclude.join("; ")}.</p>` : ""}
    <details class="trades-detail"><summary>See every trade</summary>
      <div class="data-scroll"><table class="data">
        <thead><tr><th>Ticker</th><th>Bought</th><th class="num">Days</th><th class="num">You</th><th class="num">Industry</th><th class="num">Difference</th></tr></thead>
        <tbody>${L.trades.map((t) => `<tr>
          <td><strong>${esc(t.ticker)}</strong> <span class="why">${esc(SHORT[t.industry])}</span></td>
          <td>${esc(t.buyDate)}</td><td class="num">${t.days.toLocaleString()}</td>
          <td class="num ${tone(t.logReturn)}">${pctLog(t.logReturn)}</td>
          <td class="num">${pctLog(t.bench)}</td>
          <td class="num ${tone(t.excess)}">${pctLog(t.excess)}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="why">Your figures are price changes; industry figures include dividends.</p>
    </details>`;
}

function histogramSvg(h) {
  // Draw at the container's real width so labels stay readable on phones.
  const W = Math.max(300, Math.min(900, $("#luck-body").clientWidth || 640));
  const H = W < 500 ? 170 : 190, pad = { l: 8, r: 8, t: 22, b: 30 };
  const maxC = Math.max(...h.counts);
  const bw = (W - pad.l - pad.r) / h.counts.length;
  const xOf = (v) => pad.l + ((v - h.lo) / (h.width * h.counts.length)) * (W - pad.l - pad.r);
  const bars = h.counts.map((c, i) => {
    const center = h.lo + (i + 0.5) * h.width;
    const bh = maxC ? (c / maxC) * (H - pad.t - pad.b) : 0;
    return `<rect class="bar${center >= h.observed ? " beyond" : ""}" x="${(pad.l + i * bw + 1).toFixed(1)}" y="${(H - pad.b - bh).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5"/>`;
  }).join("");
  const ox = xOf(h.observed);
  const hi = h.lo + h.width * h.counts.length;
  const ticks = [h.lo, 0, hi].filter((v, i, a) => v >= h.lo && v <= hi && a.indexOf(v) === i);
  const labels = ticks.map((v) => {
    const x = xOf(v);
    const anchor = x < 40 ? "start" : x > W - 40 ? "end" : "middle";
    return `<text x="${x.toFixed(1)}" y="${H - 10}" text-anchor="${anchor}">${pctLog(v)}</text>`;
  }).join("");
  const labelAnchor = ox > W - 90 ? "end" : ox < 90 ? "start" : "middle";
  return `<svg class="histo" viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribution of average results for no-skill investors, with your result marked">
    <line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}"/>
    ${bars}
    <line class="obs" x1="${ox.toFixed(1)}" x2="${ox.toFixed(1)}" y1="${pad.t - 4}" y2="${H - pad.b}"/>
    <text class="obs-label" x="${ox.toFixed(1)}" y="${pad.t - 8}" text-anchor="${labelAnchor}">You: ${pctLog(h.observed)} per trade</text>
    ${labels}
  </svg>`;
}

function renderHolding(H) {
  const body = $("#holding-body");
  if (!H.enough) {
    body.innerHTML = `<p class="empty">Needs at least 3 sold winners and 3 sold losers. You have ${H.winners} sold winner${H.winners === 1 ? "" : "s"} and ${H.losers} sold loser${H.losers === 1 ? "" : "s"}.</p>`;
    return;
  }
  let reading;
  if (H.ratio > 1.2 && H.pValue < 0.1) reading = `This is the <strong>disposition effect</strong>: selling winners quickly to lock in a gain and holding losers hoping to get even. Studies of brokerage accounts find it costs investors returns, because stocks that have been rising tend to keep rising for a while and losers tend to keep lagging.`;
  else if (H.ratio < 0.8) reading = `You cut losers faster than you sell winners, the opposite of the most common investor mistake.`;
  else reading = `No strong pattern: you hold winners and losers for similar lengths of time.`;
  const longOpen = H.longOpenLosers.length
    ? `<p>You're currently holding <strong>${H.longOpenLosers.length}</strong> losing position${H.longOpenLosers.length === 1 ? "" : "s"} for longer than your typical winner: ${[...new Set(H.longOpenLosers.map((t) => esc(t.ticker)))].join(", ")}.</p>` : "";
  const max = Math.max(H.winnerDays, H.loserDays);
  body.innerHTML = `
    <div class="bars">
      ${barRow(`Winners sold (${H.winners})`, H.winnerDays / max, `${Math.round(H.winnerDays)} d`, "pos")}
      ${barRow(`Losers sold (${H.losers})`, H.loserDays / max, `${Math.round(H.loserDays)} d`, "neg")}
    </div>
    <p>Median holding time: <strong>${Math.round(H.loserDays)} days</strong> for losers vs <strong>${Math.round(H.winnerDays)} days</strong> for winners, ${H.ratio.toFixed(1)}× as long. If holding time had nothing to do with winning or losing, a gap this large in that direction would come up ${chance(H.pValue)} of the time.</p>
    <p>${reading}</p>${longOpen}`;
}

const barRow = (name, frac, val, cls = "") => `<div class="bar-row"><span class="name">${name}</span><span class="track"><span class="fill ${cls}" style="width:${Math.max(0, Math.min(1, frac)) * 100}%"></span></span><span class="val">${val}</span></div>`;

const fmtLoading = (x) => (Math.abs(x) < 0.005 ? "0.00" : `${x > 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}`);
function divergingRow(name, v, scale, note, fmt = fmtLoading) {
  const frac = Math.max(-1, Math.min(1, v / scale));
  const left = frac < 0 ? 50 + frac * 50 : 50;
  const width = Math.abs(frac) * 50;
  return `<div class="bar-row"><span class="name">${name}<br><span class="why">${note}</span></span><span class="track"><span class="center-line"></span><span class="fill ${v >= 0 ? "pos" : "neg"}" style="left:${left}%;width:${width}%"></span></span><span class="val">${fmt(v)}</span></div>`;
}

function renderMix(W, F, mix) {
  const body = $("#mix-body");
  const ind = Object.entries(W.byIndustry).sort((a, b) => b[1] - a[1]);
  const maxW = ind[0]?.[1] || 1;
  const hhi = W.positions.reduce((s, p) => s + p.weight ** 2, 0);
  const top = W.positions[0];
  const left = `<div><h3>By industry</h3><div class="bars">${ind.map(([c, w]) => barRow(esc(SHORT[c]), w / maxW, pct(w, 0, false), c === "NONE" ? "alt" : "")).join("")}</div>
    <p class="why">Based on ${esc(W.basis)}. Your largest position, ${esc(top.ticker)}, is ${pct(top.weight, 0, false)} of the total; you effectively hold ${(1 / hhi).toFixed(1)} equal-sized bets.</p></div>`;
  let right;
  if (!F) {
    right = `<div><h3>Factor tilts</h3><p class="empty">Not enough data for this mix.</p></div>`;
  } else {
    const L = F.loadings;
    const lean = (v, pos, neg) => (v > 0.15 ? pos : v < -0.15 ? neg : "Neutral");
    const alphaLine = mix && mix.exactShare >= 0.5
      ? `<p class="why">Return not explained by these factors: ${pct(F.alphaAnnual)} a year (t = ${F.alphaT.toFixed(1)}; below 2 in size means it isn't statistically reliable).</p>`
      : `<p class="why">With industry proxies this describes your mix's tilts. Your stock-picking is judged by the luck test above.</p>`;
    right = `<div><h3>Factor tilts, ${monthName(F.from)}–${monthName(F.to)}</h3><div class="bars">
      ${divergingRow("Market", L.MktRF, 2, `Moves ${L.MktRF.toFixed(2)}× as much as the market`)}
      ${divergingRow("Size", L.SMB, 1, lean(L.SMB, "Leans to smaller companies", "Leans to large companies"))}
      ${divergingRow("Value", L.HML, 1, lean(L.HML, "Leans to cheap (value) stocks", "Leans to pricey (growth) stocks"))}
      ${divergingRow("Momentum", L.Mom, 1, lean(L.Mom, "Leans to recent winners", "Leans to recent losers"))}
    </div>
    <p class="why">These four factors explain ${Math.round(F.r2 * 100)}% of the mix's monthly ups and downs.</p>${alphaLine}</div>`;
  }
  const excluded = mix && mix.excludedWeight > 0.001 ? `<p class="why">${pct(mix.excludedWeight, 0, false)} of the portfolio (bonds, gold, crypto or cash) has no industry proxy and is left out of the tilts, the job check and the crash tests.</p>` : "";
  body.innerHTML = `<div class="two-col">${left}${right}</div>${excluded}`;
}

function renderJob(H, W) {
  const body = $("#job-body");
  if (!state.job) {
    body.innerHTML = `<p class="empty">Pick the industry that pays your salary in step 1 to see this.</p>`;
    return;
  }
  if (state.job === "NONE") {
    body.innerHTML = `<p>Government, education and nonprofit pay tends to move little with the stock market, so there's no industry to compare with. That's good news for diversification: your income and your portfolio are unlikely to fall together.</p>`;
    return;
  }
  if (!H) {
    body.innerHTML = `<p class="empty">Not enough overlapping data for this check.</p>`;
    return;
  }
  const name = E.JOB_INDUSTRIES[state.job].toLowerCase();
  const diff = H.corr - H.corrMkt;
  const compare = diff > 0.05 ? "Your portfolio is <strong>more tied to your paycheck's industry</strong> than a plain index fund would be."
    : diff < -0.05 ? "Your portfolio is <strong>less tied to your paycheck's industry</strong> than a plain index fund, which is a good hedge."
    : "That's about the same as a plain index fund.";
  const direct = H.directWeight > 0.25
    ? `<div class="notice warn"><strong>${pct(H.directWeight, 0, false)}</strong> of your portfolio is in your own industry. If it hits a downturn, your job and a big part of your savings could take the hit at the same time.</div>`
    : `<p><strong>${pct(H.directWeight, 0, false)}</strong> of your portfolio is directly in your own industry.</p>`;
  body.innerHTML = `
    <p>Over ${monthName(H.from)}–${monthName(H.to)}, your mix moved with the ${esc(name)} industry with a correlation of <strong>${H.corr.toFixed(2)}</strong> (1 means in lockstep). A whole-market index fund shows ${H.corrMkt.toFixed(2)}. ${compare}</p>
    <div class="bars">
      ${divergingRow("Your industry", H.worstJob, 0.2, `Average of its worst ${H.worstMonths} months`, (x) => pct(x))}
      ${divergingRow("Your mix", H.worstMix, 0.2, "Same months", (x) => pct(x))}
      ${divergingRow("Whole market", H.worstMkt, 0.2, "Same months", (x) => pct(x))}
    </div>
    ${direct}`;
}

function renderStress(S) {
  const body = $("#stress-body");
  const rows = S.filter((s) => s.mix !== null);
  if (!rows.length) { body.innerHTML = `<p class="empty">No holdings with an industry proxy.</p>`; return; }
  const max = Math.max(...rows.flatMap((s) => [Math.abs(s.mix), Math.abs(s.market)]), 0.01);
  body.innerHTML = `
    <p>How today's mix would have done in past crashes, using industry proxies. Individual stocks often fell further than their industry.</p>
    <div class="data-scroll"><table class="data">
      <thead><tr><th>Event</th><th class="num">Your mix</th><th class="num">Market</th><th style="width:38%"><span class="sr">Chart</span></th></tr></thead>
      <tbody>${rows.map((s) => `<tr>
        <td><strong>${esc(s.name)}</strong><br><span class="why">${monthName(s.from)} – ${monthName(s.to)}</span></td>
        <td class="num ${tone(s.mix)}">${pct(s.mix, 0)}</td>
        <td class="num">${pct(s.market, 0)}</td>
        <td><div class="bar-pair">
          <div class="bar-row pair" style="grid-template-columns:1fr"><span class="track"><span class="fill" style="width:${Math.abs(s.mix) / max * 100}%"></span></span></div>
          <div class="bar-row pair" style="grid-template-columns:1fr"><span class="track"><span class="fill alt" style="width:${Math.abs(s.market) / max * 100}%"></span></span></div>
        </div></td></tr>`).join("")}</tbody>
    </table></div>
    <div class="legend" style="margin-top:8px"><span><i style="background:${cssVar("--ink-2")}"></i>Your mix</span><span><i style="background:${cssVar("--market")}"></i>Whole market</span><span>Bar length = size of the gain or loss</span></div>`;
}

// ---------------------------------------------------------------------------
// Charts (TradingView Lightweight Charts)
// ---------------------------------------------------------------------------

const charts = [];
function clearCharts() {
  while (charts.length) charts.pop().remove();
}

function baseChart(container, logScale = false) {
  const LWC = window.LightweightCharts;
  let locale = "en-US";
  try { new Intl.NumberFormat(navigator.language); locale = navigator.language; } catch { /* unusual browser locale */ }
  const chart = LWC.createChart(container, {
    autoSize: true,
    localization: { locale },
    layout: { background: { color: "transparent" }, textColor: cssVar("--muted"), fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif", attributionLogo: true },
    grid: { vertLines: { color: cssVar("--rule") }, horzLines: { color: cssVar("--rule") } },
    rightPriceScale: { borderColor: cssVar("--rule"), mode: logScale ? LWC.PriceScaleMode.Logarithmic : LWC.PriceScaleMode.Normal },
    timeScale: { borderColor: cssVar("--rule"), minBarSpacing: 0.05 },
    crosshair: { mode: LWC.CrosshairMode.Normal },
    handleScroll: { vertTouchDrag: false },
  });
  charts.push(chart);
  return chart;
}

function renderGrowth(mix, W) {
  const body = $("#growth-body");
  const paths = E.growthPaths(mix);
  if (!paths || !paths.you.length) { body.innerHTML = `<p class="empty">No holdings with an industry proxy.</p>`; return; }
  const endYou = paths.you[paths.you.length - 1].value, endMkt = paths.mkt[paths.mkt.length - 1].value;
  body.innerHTML = `
    <div class="legend"><span><i style="background:${cssVar("--skill")}"></i>Today's mix: $1 → $${endYou.toFixed(2)}</span><span><i style="background:${cssVar("--market")}"></i>Whole market: $1 → $${endMkt.toFixed(2)}</span></div>
    <div class="chart-box" id="growth-chart"></div>
    <p class="why">Simulated: today's mix (${esc(W.basis)}) held for the whole period and rebalanced monthly, using industry proxies${mix.exactShare > 0 ? " and real prices where you supplied them" : ""}. It is not your actual history. Log scale.</p>`;
  if (!window.LightweightCharts) { $("#growth-chart").innerHTML = `<p class="empty">The chart library didn't load. Check your connection and reload.</p>`; return; }
  const LWC = window.LightweightCharts;
  const chart = baseChart($("#growth-chart"), true);
  chart.addSeries(LWC.LineSeries, { color: cssVar("--market"), lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: "Market" }).setData(paths.mkt);
  chart.addSeries(LWC.LineSeries, { color: cssVar("--skill"), lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: "You" }).setData(paths.you);
  chart.timeScale().fitContent();
}

function renderPriceCharts(trades) {
  const card = $("#card-charts");
  const body = $("#charts-body");
  const withPrices = [...new Set(trades.map((t) => t.ticker))].filter((t) => state.prices[t]);
  card.hidden = !withPrices.length;
  if (!withPrices.length || !window.LightweightCharts) return;
  const LWC = window.LightweightCharts;
  body.innerHTML = withPrices.map((t, i) => `
    <div class="chart-title"><strong>${esc(t)}</strong><span class="why">${esc(state.prices[t].source)} · ▲ buy · ▼ sell</span></div>
    <div class="chart-box small" id="pc-${i}"></div>`).join("");
  withPrices.forEach((t, i) => {
    const points = state.prices[t].points;
    const data = points.map((p) => ({ time: p.d, value: p.c }));
    const chart = baseChart($(`#pc-${i}`));
    const series = chart.addSeries(LWC.LineSeries, { color: cssVar("--ink-2"), lineWidth: 2, priceLineVisible: false });
    series.setData(data);
    const snap = (d) => (data.find((p) => p.time >= d) || data[data.length - 1]).time;
    const markers = [];
    for (const tr of trades.filter((x) => x.ticker === t)) {
      if (tr.buyDate >= data[0].time) markers.push({ time: snap(tr.buyDate), position: "belowBar", color: cssVar("--skill"), shape: "arrowUp", text: `Buy ${tr.buyPrice}` });
      if (tr.closed && tr.sellDate >= data[0].time) markers.push({ time: snap(tr.sellDate), position: "aboveBar", color: cssVar("--luck"), shape: "arrowDown", text: `Sell ${tr.sellPrice}` });
    }
    markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    if (markers.length) LWC.createSeriesMarkers(series, markers);
    chart.timeScale().fitContent();
  });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

// Saved data comes from the browser's storage, so treat it as untrusted: a corrupted or
// hand-edited entry must never stop the page from starting.
const ROW_FIELDS = ["ticker", "industry", "buyDate", "buyPrice", "qty", "sellDate", "sellPrice", "currentPrice"];
function cleanRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r === "object" && !Array.isArray(r))
    .slice(0, 20000)
    .map((r) => Object.fromEntries(ROW_FIELDS.map((f) => [f, typeof r[f] === "string" || typeof r[f] === "number" ? String(r[f]) : ""])));
}
function cleanPrices(prices) {
  const out = {};
  if (!prices || typeof prices !== "object" || Array.isArray(prices)) return out;
  for (const [ticker, p] of Object.entries(prices)) {
    if (!p || !Array.isArray(p.points)) continue;
    const points = p.points.filter((x) => x && typeof x.d === "string" && Number.isFinite(x.c) && x.c > 0);
    if (points.length < 2) continue;
    out[ticker] = { ...p, points, source: typeof p.source === "string" ? p.source : "file", splits: Array.isArray(p.splits) ? p.splits : undefined };
  }
  return out;
}

function init() {
  const jobSel = $("#job-select");
  jobSel.add(new Option("Skip this check", ""));
  for (const [code, label] of Object.entries(E.JOB_INDUSTRIES)) jobSel.add(new Option(label, code));

  const saved = load(STORE_TRADES, null);
  state.prices = cleanPrices(load(STORE_PRICES, {}));
  const key = load(STORE_KEY, "");
  if (key && typeof key === "string") { $("#av-key").value = key; $("#av-remember").checked = true; }
  const savedRows = cleanRows(saved?.rows);
  const savedJob = typeof saved?.job === "string" && saved.job in E.JOB_INDUSTRIES ? saved.job : "";
  setRows(savedRows.length ? savedRows : [blankRow(), blankRow(), blankRow()], savedJob);

  $("#trades-body").addEventListener("input", onTableInput);
  $("#trades-body").addEventListener("change", (e) => { onTableInput(e); if (e.target.dataset.f === "ticker") renderPriceList(); });
  $("#trades-body").addEventListener("click", (e) => {
    const btn = e.target.closest(".remove");
    if (!btn) return;
    state.rows.splice(+btn.closest("tr").dataset.i, 1);
    if (!state.rows.length) state.rows.push(blankRow());
    renderTable();
    saveTradesSoon();
  });
  $("#btn-add").addEventListener("click", () => {
    state.rows.push(blankRow());
    renderTable();
    $("#trades-body tr:last-child input")?.focus();
  });
  $("#btn-sample").addEventListener("click", () => {
    const rows = SAMPLE.map(([ticker, buyDate, buyPrice, qty, sellDate, sellPrice]) =>
      ({ ...blankRow(), ticker, buyDate, buyPrice: String(buyPrice), qty: String(qty), sellDate, sellPrice: String(sellPrice) }));
    setRows(rows, "BusEq");
    const box = $("#import-msg");
    box.hidden = false;
    box.className = "notice";
    box.innerHTML = "Loaded 20 sample trades with approximate historical prices. The four positions still held have no price today, so they count toward your mix but not your returns. Press <strong>Run the analysis</strong>.";
  });
  let clearTimer = null;
  $("#btn-clear").addEventListener("click", (ev) => {
    const btn = ev.currentTarget;
    if (!clearTimer) {
      btn.textContent = "Click again to clear everything";
      clearTimer = setTimeout(() => { btn.textContent = "Clear"; clearTimer = null; }, 4000);
      return;
    }
    clearTimeout(clearTimer); clearTimer = null; btn.textContent = "Clear";
    state.prices = {};
    remove(STORE_PRICES);
    setRows([blankRow(), blankRow(), blankRow()], "");
    $("#results").hidden = true;
    $("#import-msg").hidden = true;
  });
  $("#btn-template").addEventListener("click", downloadTemplate);
  $("#btn-export").addEventListener("click", exportRows);
  $("#file-broker").addEventListener("change", onBrokerFile);
  initTabs();
  jobSel.addEventListener("change", () => { state.job = jobSel.value; saveTradesSoon(); });
  $("#price-list").addEventListener("change", onAttach);
  $("#price-list").addEventListener("click", (e) => {
    const t = e.target.closest("[data-unattach]")?.dataset.unattach;
    if (!t) return;
    delete state.prices[t];
    save(STORE_PRICES, state.prices);
    renderPriceList();
  });
  $("#av-remember").addEventListener("change", (e) => { if (!e.target.checked) remove(STORE_KEY); });
  $("#btn-av").addEventListener("click", fetchAlphaVantage);
  $("#btn-run").addEventListener("click", run);

  marketData().catch(() => { /* reported when the user runs the analysis */ });
}

init();
