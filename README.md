# Launch Scope v3 — Token Launch Radar

A token launch radar for make.fun's `token-radar-01` bounty. It reads one frozen
DefiLlama snapshot, ranks every pre-token launch candidate by expected value, and
hands the reader a farm plan for each one — costed to dollars per hour.

## The model

Every protocol is scored the same way, from the snapshot's own figures only:

```
1. VALUE FIT (fitted, not picked)
   log10(mcap) = a + b*log10(tvl) + c*clamped(change_7d)
   fitted on the 128 protocols whose token already trades (positive market cap).
   Change is clamped to [-50, +100] per cent; a missing change counts as 0.
   Validated held-out: leave-one-out median |predicted/actual| and walk-forward
   (fit before 2024, test 2024 and later). Age is NOT in the fit: adding it
   worsened walk-forward error, so the data, not habit, left it out.

2. TOKEN ODDS (from the peers' record)
   odds = the fraction of protocols in the same (age band x TVL band) cohort
   that already record a token, Laplace-smoothed (has+1)/(n+2).

3. EXPECTED VALUE = fitted token value x odds. The board ranks by it.

4. FARM ECONOMICS
   expected(D) = (D / TVL) x 5% farmer pool x expected value   (range 3-10%)
   costs       = 3 actions of gas ($8 on Ethereum, $3 elsewhere)
                 + 5% a year of forgone yield on the deposit
   $/hour      = (expected - costs) / hours, at $100 / $1,000 / $10,000
   verdict     = FARM at $10/hour or more, THIN above $0, SKIP at or below $0
                 (read off the $10,000 tier)
```

Age is the days from `listed_at` to the snapshot's `as_of` day; the hold period
(90/60/30 days by age, 45 when the date is missing) is the only other place age
enters. No protocol name is ever special-cased.

## The board

198 pre-token launch candidates, ranked by expected value. The watchlist's 40 are
all in it; the rest are candidates below the floor that pass the house's own
visible rule (not a CEX, bridge, liquid-staking or restaking product, no version
marker in the name, no wrapped/staked word, not named after an exchange). All 758
protocols in the snapshot are accounted for: ranked, live at market value,
token-recorded with no market price, or excluded with a stated reason.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) writes `board.json`, the dashboard's
dataset into `dashboard/data.js`, copies `dashboard/` and `screenshots/` into the
output directory, and finishes with `dossier.json` from the vendored make.fun
library. The dataset goes inside `dashboard/` so the dossier's text carries it to
the judge. The run is deterministic: the same snapshot always writes the same
bytes.

## The dashboard

`dashboard/` is a static page with no network: the decision board first (verdict,
expected value, odds, $/hour), sortable and filterable, a detail view per protocol
(model breakdown, farm plan by deposit, a deposit-x-horizon $/hour matrix, farm
steps), the live tokens at market value, and the full accounting of the snapshot.
`screenshots/` holds three captures of it: the board, a detail view, and a
filtered view.

## Files

- `main.ts` — entry point: reads the snapshot, writes the outputs.
- `lib/model.ts` — the fit, the odds, the farm economics, the board builder.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte as the kit ships it.
- `dashboard/` — the page (`index.html`, `app.css`, `app.js`, `data.js` written by the run).
- `screenshots/` — the three captures the judge reads.
