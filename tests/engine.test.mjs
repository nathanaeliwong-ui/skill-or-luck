import fs from "fs";
import * as E from "../js/engine.js";
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exitCode = 1; } else console.log("ok -", m); };
const md = new E.MarketData(JSON.parse(fs.readFileSync(new URL("../data/french.json", import.meta.url))));
const dailyJson = JSON.parse(fs.readFileSync(new URL("../data/french-daily.json", import.meta.url)));
const mdd = new E.MarketData(JSON.parse(fs.readFileSync(new URL("../data/french.json", import.meta.url))), dailyJson);

// dates & numbers
assert(E.normalizeDate("03/05/2024") === "2024-03-05", "US date");
assert(E.normalizeDate("2024-3-5") === "2024-03-05", "ISO short");
assert(E.normalizeDate("05.03.2024") === "2024-03-05", "EU date");
assert(E.normalizeDate("03/05/2024 as of 03/04/2024") === "2024-03-05", "Schwab date");
assert(E.normalizeDate("Mar 5, 2024") === "2024-03-05", "text date");
assert(E.normalizeDate("2024-02-30") === null, "invalid date");
assert(E.parseNumber("$1,234.50") === 1234.5, "money");
assert(E.parseNumber("(12.30)") === -12.3, "parens negative");
assert(E.parseNumber("1.234,5") === 1234.5, "EU number");

// XIRR: -100 then +110 after exactly one year ≈ 10%
const t0 = E.toTime("2020-01-01");
const r = E.xirr([{t: t0, amount: -100}, {t: t0 + 365.25*86400000, amount: 110}]);
assert(Math.abs(r - 0.10) < 1e-6, "xirr 10% -> " + r);

// OLS recovers known coefficients
const rand = E.rng(3); const x1 = [], x2 = [], y = [];
for (let i = 0; i < 500; i++) { const a = rand(), b = rand(); x1.push(a); x2.push(b); y.push(0.5 + 2*a - 1*b + (rand()-0.5)*0.01); }
const fit = E.ols(y, [x1, x2]);
assert(Math.abs(fit.beta[1]-2) < 0.01 && Math.abs(fit.beta[2]+1) < 0.01 && fit.r2 > 0.99, "ols");

// binomial tail
assert(Math.abs(E.binomialUpperTail(8, 10) - 56/1024) < 1e-12, "binomial tail");

// window growth: full single month equals that month's return
const idx = E.monthIndex("2020-03");
const g = md.windowGrowth("BusEq", "2020-03-01", "2020-04-01");
assert(Math.abs(g.growth - (1 + md.value("BusEq", idx))) < 1e-12 && g.covered === 1, "window growth 1 month");
const g2 = md.windowGrowth("BusEq", "2026-07-01", "2026-10-10");
assert(g2.covered < 0.65 && g2.covered > 0.55, "coverage beyond data end " + g2.covered.toFixed(2));

// daily windows: whole calendar months compound to French's monthly return (to within rounding)
for (const [code, a, b, ma, mb] of [
  ["BusEq", "2020-02-29", "2020-03-31", "2020-03-01", "2020-04-01"],
  ["MKT", "2008-09-30", "2008-10-31", "2008-10-01", "2008-11-01"],
  ["Hlth", "1999-12-31", "2000-12-29", "2000-01-01", "2001-01-01"],
]) {
  const dg = mdd.windowGrowth(code, a, b).growth, mg = md.windowGrowth(code, ma, mb).growth;
  assert(Math.abs(dg - mg) < 0.01, `daily vs monthly ${code} ${a}..${b}: ${dg.toFixed(4)} vs ${mg.toFixed(4)}`);
}
// close-to-close: the buy day's own return is excluded, the sell day's is included
const i0 = dailyJson.dates.indexOf(20200303);
const day = (code, i) => dailyJson.industries[code][i] / 10000;
const one = mdd.windowGrowth("BusEq", "2020-03-02", "2020-03-03");
assert(Math.abs(one.growth - (1 + day("BusEq", i0))) < 1e-12, "one trading day window = that day's return");
const wknd = mdd.windowGrowth("BusEq", "2020-03-06", "2020-03-09"); // Fri -> Mon
assert(Math.abs(wknd.growth - (1 + day("BusEq", dailyJson.dates.indexOf(20200309)))) < 1e-12, "Friday to Monday = Monday's return");
assert(mdd.windowGrowth("BusEq", "2020-03-03", "2020-03-03").growth === 1, "same-day window is flat");
const past = mdd.windowGrowth("MKT", "2026-06-01", "2026-12-31");
assert(past.covered > 0.4 && past.covered < 0.5, "daily coverage beyond data end " + past.covered.toFixed(2));


// --- stress-test regressions ---
// Signed-quantity history (Interactive Brokers style): negative quantity is a sell, not silently dropped.
const ibkr = E.importBrokerCsv('Symbol,Date/Time,Quantity,T. Price\nAAPL,"2024-03-05, 10:30:00",10,170.5\nAAPL,"2024-06-05, 11:00:00",-4,195').trades;
assert(ibkr.length === 2 && ibkr[0].sellDate === "2024-06-05" && ibkr[0].qty === 4, "signed-quantity history is matched FIFO");
assert(E.prepareTrades([{ ticker: "D", buyDate: "2024-01-02", buyPrice: "1e308", qty: 1e308 }], "2026-10-11").trades.length === 0, "absurd amounts rejected");

// Overlapping same-industry trades (and DCA lots sold together) are one bet; sequential trades are not.
const mkT = (ticker, industry, buyDate, exitDate) => ({ ticker, industry, buyDate, exitDate });
const grp = E.clusterTrades([
  mkT("NVDA", "BusEq", "2023-01-02", "2023-12-29"), mkT("AMD", "BusEq", "2023-01-20", "2023-12-15"),
  mkT("AAPL", "BusEq", "2023-02-01", "2023-11-30"), mkT("XOM", "Enrgy", "2023-01-02", "2023-12-29"),
  mkT("AMD", "BusEq", "2015-01-02", "2015-03-01"), mkT("AMD", "BusEq", "2015-01-20", "2015-04-01"),
]);
assert(grp[0] === grp[1] && grp[1] === grp[2], "same industry, overlapping dates -> one group");
assert(grp[3] !== grp[0], "different industry -> separate group");
const seqG = E.clusterTrades([mkT("MSFT", "BusEq", "2020-01-02", "2020-02-03"), mkT("MSFT", "BusEq", "2020-02-10", "2020-03-20"), mkT("MSFT", "BusEq", "2020-04-01", "2020-05-01")]);
assert(new Set(seqG).size === 3, "back-to-back trades in one stock stay separate bets");
assert(grp[4] === grp[5] && grp[4] !== grp[0], "overlapping lots of one stock group together");
const clustered = E.luckTest(mk6(), mdd, { sims: 500 });
function mk6() { // 30 trades, all one industry and the same dates: one bet, so no verdict
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({ ticker: "T" + i, industry: "BusEq", buyDate: "2020-01-02", buyPrice: 100, qty: 1, sellDate: "2021-01-04", sellPrice: 150 });
  return E.prepareTrades(rows, "2026-10-11").trades;
}
assert(!clustered.enough && clustered.clusters === 1 && clustered.n === 30, "30 identical-window trades count as one bet");

// FIFO
const fifo = E.fifoMatch([
  {ticker:"AAA", date:"2020-01-02", side:"buy", qty:10, price:10},
  {ticker:"AAA", date:"2020-06-02", side:"buy", qty:5, price:12},
  {ticker:"AAA", date:"2021-01-04", side:"sell", qty:12, price:15},
  {ticker:"BBB", date:"2021-01-04", side:"sell", qty:3, price:15},
]);
const closed = fifo.trades.filter(t => t.sellDate);
assert(closed.length === 2 && closed[0].qty === 10 && closed[1].qty === 2 && closed[1].buyPrice === 12, "fifo closed lots");
assert(fifo.trades.find(t => !t.sellDate).qty === 3, "fifo remaining lot");
assert(fifo.warnings.length === 1, "fifo unmatched warning");

// broker CSVs
const robin = `"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"
"1/5/2023","1/5/2023","1/9/2023","AAPL","Apple","Buy","10","$125.00","($1,250.00)"
"2/1/2023","2/1/2023","2/3/2023","AAPL","Apple","CDIV","","",""
"6/1/2024","6/1/2024","6/3/2024","AAPL","Apple","Sell","4","$192.00","$768.00"`;
const imp = E.importBrokerCsv(robin);
assert(imp.trades.length === 2 && imp.trades.some(t => t.sellPrice === 192 && t.qty === 4), "robinhood import");
const fidelity = `Brokerage

Run Date,Action,Symbol,Description,Type,Quantity,Price ($),Commission ($),Amount ($),Settlement Date
03/04/2024,YOU BOUGHT MICROSOFT CORP (MSFT) (Cash),MSFT,MICROSOFT CORP,Cash,5,410.5,,-2052.5,03/06/2024
05/01/2024,DIVIDEND RECEIVED MICROSOFT CORP (MSFT) (Cash),MSFT,MICROSOFT CORP,Cash,0,,,3.75,
08/01/2024,YOU SOLD MICROSOFT CORP (MSFT) (Cash),MSFT,MICROSOFT CORP,Cash,-5,420,,2100,08/03/2024`;
const fi = E.importBrokerCsv(fidelity);
assert(fi.trades.length === 1 && fi.trades[0].buyPrice === 410.5 && fi.trades[0].sellPrice === 420, "fidelity import");
const lots = `ticker,buy_date,buy_price,shares,sell_date,sell_price,current_price,industry
NVDA,2022-01-03,300,2,,,,BusEq
KO,2021-05-01,55,10,2023-05-01,63,,`;
const li = E.importBrokerCsv(lots);
assert(li.trades.length === 2 && li.trades[1].sellPrice === 63 && li.trades[0].industry === "BusEq", "template import");

// price files
const nasdaq = `Date,Close/Last,Volume,Open,High,Low
10/08/2026,$228.02,100,$1,$1,$1
10/07/2026,$225.00,100,$1,$1,$1
09/30/2026,$220.00,100,$1,$1,$1`;
const pn = E.parsePriceCsv(nasdaq);
assert(pn.length === 3 && pn[0].d === "2026-09-30" && pn[2].c === 228.02, "nasdaq price file");
const stooq = `Date,Open,High,Low,Close,Volume
2026-08-29,1,1,1,100,5
2026-09-30,1,1,1,110,5`;
const ps = E.parsePriceCsv(stooq);
const mr = E.monthlyReturnsFromPrices(ps);
assert(Math.abs(mr.get(E.monthIndex("2026-09")) - 0.1) < 1e-12, "monthly returns from prices");
const av = {"Meta Data":{}, "Monthly Adjusted Time Series": {"2026-09-30": {"4. close":"110","5. adjusted close":"109"}, "2026-08-29": {"4. close":"100","5. adjusted close":"99"}}};
assert(E.parseAlphaVantage(av)[1].c === 109, "alpha vantage parse");
let threw = false; try { E.parseAlphaVantage({Information: "rate limit"}); } catch (e) { threw = /rate/.test(e.message); }
assert(threw, "alpha vantage error message");

// Luck test sanity: trades whose returns equal their industry -> p near 0.5; strong skill -> p small
function mkTrades(edge, n, seed) {
  const rr = E.rng(seed); const out = [];
  for (let i = 0; i < n; i++) {
    const y = 2005 + Math.floor(rr()*18), mo = 1 + Math.floor(rr()*12);
    const buy = `${y}-${String(mo).padStart(2,"0")}-10`;
    const sell = `${y+1}-${String(mo).padStart(2,"0")}-10`;
    const bench = md.windowGrowth("BusEq", buy, sell).growth;
    const noise = Math.exp((rr()-0.5)*0.4 + edge);
    out.push({ticker:"MSFT", industry:"BusEq", buyDate:buy, buyPrice:100, qty:1, sellDate:sell, sellPrice:100*bench*noise});
  }
  return out;
}
const asOf = "2026-10-10";
const noSkill = E.prepareTrades(mkTrades(0, 40, 9), asOf).trades;
const skilled = E.prepareTrades(mkTrades(0.12, 40, 9), asOf).trades;
const L0 = E.luckTest(noSkill, md), L1 = E.luckTest(skilled, md);
console.log("  no-skill p:", L0.pValue.toFixed(3), " skilled p:", L1.pValue.toFixed(4), " trades needed (skilled):", L1.tradesNeeded);
assert(L0.pValue > 0.05 && L1.pValue < 0.01, "luck test separates skill from none");

// holding test: losers held much longer
const hold = [];
for (let i = 0; i < 6; i++) hold.push({ticker:"X", industry:"BusEq", buyDate:"2020-01-01", buyPrice:100, qty:1, sellDate:`2020-0${2+i%3}-01`, sellPrice:120});
for (let i = 0; i < 6; i++) hold.push({ticker:"Y", industry:"BusEq", buyDate:"2020-01-01", buyPrice:100, qty:1, sellDate:`2022-0${2+i%3}-01`, sellPrice:80});
const H = E.holdingTest(E.prepareTrades(hold, asOf).trades);
assert(H.enough && H.ratio > 10 && H.pValue < 0.01, `holding test ratio ${H.ratio.toFixed(1)} p ${H.pValue.toFixed(4)}`);

// portfolio pieces
const pf = E.prepareTrades([
  {ticker:"AAPL", buyDate:"2019-01-02", buyPrice:39, qty:50, currentPrice:230},
  {ticker:"JPM", buyDate:"2020-03-20", buyPrice:90, qty:20, currentPrice:250},
  {ticker:"BND", buyDate:"2021-01-04", buyPrice:88, qty:30, currentPrice:73},
  {ticker:"KO", buyDate:"2018-01-02", buyPrice:45, qty:40, sellDate:"2023-01-03", sellPrice:63},
], asOf).trades;
const W = E.portfolioWeights(pf);
assert(Math.abs(Object.values(W.byIndustry).reduce((a,b)=>a+b,0) - 1) < 1e-9 && W.byIndustry.NONE > 0, "weights sum to 1");
const mix = E.mixReturns(W, md);
assert(mix.series.length > 200 && mix.excludedWeight > 0, "mix returns length " + mix.series.length);
const F = E.factorExposure(mix, md);
assert(F && F.months === 120 && F.r2 > 0.3, `factor regression r2 ${F.r2.toFixed(2)} mkt ${F.loadings.MktRF.toFixed(2)}`);
const S = E.stressTests(W, md);
assert(S.length === 6 && S.every(s => s.mix !== null), "stress tests");
const HC = E.humanCapital(mix, W, md, "BusEq");
assert(HC && HC.corr > 0 && HC.worstMonths >= 6, `human capital corr ${HC.corr.toFixed(2)} vs mkt ${HC.corrMkt.toFixed(2)}`);
const P = E.performance(pf, md);
assert(P.youIrr !== null && P.mktIrr !== null, `performance you ${(P.youIrr*100).toFixed(1)}% mkt ${(P.mktIrr*100).toFixed(1)}%`);
assert(E.growthPaths(mix).you.length === mix.series.length, "growth paths");
assert(E.guessIndustry("brk.b") === "Money" && E.guessIndustry("VOO") === "MKT" && E.guessIndustry("ZZZZ") === null, "ticker guesses");
const sp = E.adjustSplits([{d:"2020-08-27",c:400},{d:"2020-08-28",c:500},{d:"2020-08-31",c:126},{d:"2020-09-01",c:130}]);
assert(sp.splits.length === 1 && sp.splits[0].ratio === 4 && Math.abs(sp.points[1].c - 125) < 1e-9, "split adjustment");
const nosplit = E.adjustSplits([{d:"2020-01-31",c:100},{d:"2020-02-28",c:50}]);
assert(nosplit.splits.length === 0, "monthly drop not treated as split");
