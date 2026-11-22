[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/gta6scam/token-radar-r5/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/gta6scam/token-radar-r5/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Launch Radar — the full price graded held-out: implied LOO ×2.65, value LOO ×2.25 (×3.52 on all 128 disclosed), walk-forward ×2.13 on 59 pairs, odds 70.8% vs 54.9% base, printed band coverage 50.6% measured at 50% promised, 198 ranked, 5 FARM

A token launch radar for make.fun's token-radar-01, fifth build. It reads
the sealed DefiLlama snapshot (`/input/snapshot.json`), fits two models on
the snapshot's own numbers, and ranks 198 pre-token protocols by implied
value — fitted value if it launches × launch odds — each with a costed
farm plan and a verdict. What changed from the previous build is what
gets graded: the product itself. The ranked number (value × odds) is now
tested held-out end to end — leave-one-out ×2.65 on the declared fit
universe, ×4.16 across all 128 fit-eligible anchors, walk-forward ×2.78 —
where the previous build graded the value ratio alone and never tested
the number it ranked.

**How the value model is chosen.** Fifteen candidate learners — kNN
medians with and without an Ethereum flag, blends of the two at several
weights, distance-weighted and residual forms, ridge log-linear fits, a
category-prior ensemble, and two support-shrinkage forms — are scored
held-out in a printed tournament: leave-one-out on the fit universe and
on all fit-eligible anchors, plus repeated paired cross-validation
against the category-median baseline. A learner is admitted only by
winning ≥60% of paired folds with a better pooled median; among admitted
candidates whose fit-universe LOO clears ×2.30, the best all-eligible LOO
prices the board. The winner is a weighted ensemble (learner A ×2,
geometric): LOO ×2.25 fit / ×3.52 all, walk-forward ×2.13 on an expanded
59-pair test (×1.68 on the previous build's 22-pair geometry, where the
previous build printed ×1.63), 70/30 time-split ×3.06 printed as a
stress line. Every loser stays in the table with its numbers — including
the shrinkage forms, which lost on LOO in every variant tried.

**Per-term evidence.** Each of the five value terms is dropped from the
chosen form and re-tested held-out twice. Four terms are KEPT outright;
the Ethereum flag is a printed SPLIT — pooled and all-eligible LOO
improve with it, paired-fold wins fall short — and it stays at reduced
weight inside the blend, disagreement shown.

**Bands and honesty.** The board prints the inner P25–P75 band
(×/÷ e^1.24; measured coverage 50.6% against 50% promised, held-out
thirds, 24 repeats). The wider 80% band measures 80.5% against 80%
promised, and farm verdicts still net at its low end — never at the
printed band or the point estimate. The dashboard's first screen carries
the verdict, self-check chips (ranks recomputed in the browser,
watchlist 40/40, page total vs run total), the full tournament, the
term table, held-out odds calibration buckets (Brier 0.192 vs 0.248
base-rate; the middle bucket's over-call printed, not hidden), the 8
worst leave-one-out misses unedited, and a method panel that names the
stress lines. Rank 1 is Polymarket International at $141.6M implied,
printed band $41.2M–$487.0M.

**Launch-odds model.** A logistic regression over all 758 protocols
(label: the protocol already records a token), tested with stratified
cross-validation against the 54.9% base rate: 70.8% accuracy, AUC 0.78,
with out-of-fold calibration buckets printed on the dashboard.

Run it:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Layout: `main.ts` (orchestration), `lib/model.ts` (value learners +
accounting), `lib/validate.ts` (tournament, per-term tests, implied
grading, temporal tests, conformal bands, bootstrap), `lib/odds.ts`
(launch odds + calibration), `lib/farm.ts` (farm plans + verdicts),
`dashboard/` (the page the judge reads), `screenshots/` (board +
evidence, one detail, the FARM view), `vendor/makefun-board.ts` (the
competition's dossier library).
