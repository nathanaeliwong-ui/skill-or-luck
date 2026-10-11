# Skill or Luck

A free website that answers one question for individual investors: **did you beat the market through skill, or could it be luck?**

Visitors enter their trades (or import a broker export) and the page runs the tests a fund analyst would:

- **The luck test** compares every trade with its own industry over the exact same dates, then simulates 10,000 investors with no skill to see how often they'd match your results.
- **Trades needed** to rule out luck at your current edge.
- **Your return vs the market**: money-weighted return (XIRR) against the same cash put into the whole market on the same dates.
- **Selling habits**: do you sell winners quickly and sit on losers (the disposition effect)?
- **Factor tilts**: Fama-French market, size and value factors plus momentum.
- **Job risk**: does your portfolio fall at the same time as the industry that pays your salary?
- **Crash tests**: today's mix in the dot-com bust, 2008, COVID and 2022.
- **Charts** of your buys and sells on real price history (TradingView Lightweight Charts).

Everything runs in the visitor's browser. Trades are never uploaded, and there's no server or database to pay for. The page uses system fonts and loads no third-party scripts; the only outside request is the optional Alpha Vantage lookup, and it sends ticker symbols only.

## Data, all free

| Source | Used for | Cost |
|---|---|---|
| [Kenneth French Data Library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html) | 12 industry portfolios and the market, daily since 1926 (trade windows use exact days); Fama-French factors and momentum, monthly (crash tests, factor tilts, job risk) | Free. Downloaded by GitHub's servers at each deploy. Check its terms before commercial use. |
| Price files from Nasdaq.com or Stooq.com | Exact charts, split checks, current prices | Free. The visitor downloads and attaches them. |
| Alpha Vantage free key | Same, fetched automatically | Free (25 requests a day). Each visitor uses their own key. |

## Publish it on GitHub Pages (5 minutes)

1. Create a new repository on GitHub and upload these files (or `git push` them).
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Go to the **Actions** tab. The **Deploy site** workflow runs on every push; if it hasn't started, open it and press **Run workflow**.
4. When it finishes (about a minute), your site is live at `https://<your-username>.github.io/<repo-name>/`.

The workflow also runs on the 3rd of every month, so the market data stays current.

## Run it on your own computer

```bash
python3 scripts/fetch_french_data.py   # downloads data/french.json and data/french-daily.json
python3 -m http.server 8000            # then open http://localhost:8000
node tests/engine.test.mjs             # engine checks (needs data/french.json)
```

## Files

```
index.html                     the page
css/style.css                  styles (light and dark)
vendor/lightweight-charts.js   TradingView charts v5.2.1 (Apache 2.0), self-hosted
js/engine.js                   all statistics, no DOM code, unit-tested
js/app.js                      page logic, charts, import/export
scripts/fetch_french_data.py   builds data/french.json and french-daily.json from the French library
.github/workflows/deploy.yml   fetch data + publish to GitHub Pages
tests/engine.test.mjs          engine checks
sample/trades-template.csv     import template
```

## Limits worth knowing

- Industry data is published about a month behind, so trades in the most recent weeks can't be tested yet.
- Industry proxies stand in for individual stocks unless the visitor attaches real prices, so exposures and crash tests are estimates.
- Trade returns are price changes only; dividends received aren't counted, while industry returns include dividends.
- The ticker-to-industry list covers a few hundred popular stocks and funds. Visitors can change any guess.
- Broker import is tested against Robinhood- and Fidelity-style exports; unusual formats may need the template.

This site reports statistics about a visitor's own records. It is not investment advice.

## License

MIT
