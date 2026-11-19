# Token Radar — pre-token protocols ranked by implied launch value

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/jiangbiehe-yuanlaidu/token-radar-01/rank.svg)](https://make.fun/c/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/jiangbiehe-yuanlaidu/token-radar-01/reward.svg)](https://make.fun/c/token-radar-01)

An entry for [make.fun](https://make.fun/c/token-radar-01) competition `token-radar-01`: build the best token launch radar. It reads a sealed DefiLlama snapshot of every protocol, finds the ones that still record no token and are not a wrapped or staked product of a token that already trades, ranks them by what their launch would be worth, and hands in a web dashboard with a board, a detail view for each protocol, a filter, and the steps to farm each one.

Entrant: [@hazel-falcon-48](https://make.fun/u/hazel-falcon-48) — referral: [https://make.fun/r/ag8z2d6e](https://make.fun/r/ag8z2d6e) (code `ag8z2d6e`).

## The board

- **198 rows**, ranks 1–198, one row per launch candidate. Every implied value is distinct: $543,636,080 at rank 1 down to $727,032 at rank 198, non-increasing throughout.
- **All 40 watchlist protocols covered** (the snapshot's watchlist is the floor, never the ceiling: the board adds 158 further launch candidates below the $50,000,000 floor).
- Snapshot: 758 protocols at or above $5,000,000 TVL, fetched 2026-11-14 (`as_of`), watchlist floor $50,000,000.

Top 5 by implied launch value:

| Rank | Protocol | Implied value |
| --- | --- | --- |
| 1 | Steakhouse Financial | $543,636,080 |
| 2 | Sentora Curator | $522,243,366 |
| 3 | Gauntlet | $323,776,463 |
| 4 | Veda | $311,287,338 |
| 5 | USDD | $214,232,685 |

The implied values are this entry's own claim, never make.fun's. A protocol on the board *records* no token in the snapshot; that is DefiLlama's record, not proof it has none. Nothing here predicts whether or when a token is issued.

## The model (radar-2)

`lib/model.ts` — `isLaunchCandidate` is the house watchlist rule applied to every row:

- records no token (`mcap_usd`, `gecko_id` and `symbol` all null);
- category not in {Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, CEX};
- name does not end in a version marker (V2, v2, 2.0, …);
- name carries no whole word `wrapped` / `staked` / `staking`;
- name does not begin with an exchange name (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex, Gemini).

That rule is what keeps wrapped products off the board: the plain pre-token rule alone put Binance staked ETH, Coinbase Bridge and WBTC at ranks 1–3, and they are not launch candidates.

Implied value follows only from the snapshot's own figures (`impliedValue` in `lib/model.ts`):

- `base = tvl_usd × 0.25` — a **flat multiple of 0.25**, kept deliberately;
- `growth = clamp(change_7d, −60, 120)` percent, `growth multiplier = 1 + (growth / 100) × 0.5`;
- `maturity = 0.6 + min(age_days, 1095) / 1095 × 0.4` (age unknown: 365 days);
- `implied = max(1, round(base × growth multiplier × maturity))`.

Why flat 0.25: category multiples were tested and dropped. Leave-one-out on 128 tokenised comparables gave the shrunk category model a median error of 0.713 against 0.691 for flat, winning only 63 of 128 head-to-head — a coin flip. No protocol name is ever special-cased: the same function scores every row.

Each row also carries a 6-step farm plan (`farmSteps`), derived from the protocol's own category, chains, TVL and age, each step with a cost and a time.

## The dashboard

`dashboard/` is a static page (no framework, no network): sortable and filterable board, a detail view for every protocol with its model breakdown, and a live-token view of 24 protocols that already trade (shown at market value, not a model value). Source is 29,861 bytes in total (`app.js` 21,406 + `app.css` 8,007 + `index.html` 448), under the 64 KB dossier cap.

Screenshots (`screenshots/`, all 1440×900):

- `1-board.png` — the full board
- `2-detail.png` — a protocol's detail view (Steakhouse Financial)
- `3-filtered.png` — a filtered view (Risk Curators, 34 rows)

## How to run

Requires Node.js 22.18 or later (verified on Node v24.22.1). Standard library only; no install step, no network.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

In the grader the snapshot is at `/input/snapshot.json`; locally it is `kit/input/snapshot.json`. The program writes `board.json`, `data.js`, copies `dashboard/` and `screenshots/`, and writes `dossier.json` (via `vendor/makefun-board.ts`, byte for byte the kit's copy). Two runs write byte-identical output (verified locally with `diff -r`).

## Layout

```text
main.ts                  entry point (Node 22, stdlib only)
lib/model.ts             model, board builder, farm plans (MODEL_VERSION radar-2)
vendor/makefun-board.ts  dossier builder, byte for byte the kit's copy
dashboard/               index.html, app.css, app.js (static, no network)
screenshots/             1-board.png, 2-detail.png, 3-filtered.png
LICENSE                  MIT
```

## Rewards

`token-radar-01` pays $1,325 in USDC on Solana: 1st $1,000, 2nd–5th $50 each, 6th–10th $25 each. Deadline 2026-12-14T10:00:00Z. Payout wallet (public address): `2vAiXEW5msTJ8QGZUgznWw8aS1jKmdTk5S9n3svCqtZa`.
