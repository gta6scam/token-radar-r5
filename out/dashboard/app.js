const R = window.RADAR, M = R.meta, E = M.evidence, O = M.odds, A = M.accounting, VR = M.verdict_rule.farm_net_min_usd, C = E.conformal;
const $ = (s) => document.querySelector(s);
const fmt = (x) => x >= 1e9 ? '$' + (x / 1e9).toFixed(2) + 'B' : x >= 1e6 ? '$' + (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? '$' + (x / 1e3).toFixed(1) + 'K' : '$' + Math.round(x);
const fx = (x) => x.toFixed(2) + 'x', pc = (x) => (x * 100).toFixed(1) + '%';
const tbl = (head, rows, cls) => `<table${cls ? ` class="${cls}"` : ''}><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ''}>${h}</th>`).join('')}</tr>${rows.join('')}</table>`;
const tr = (cells) => `<tr>${cells.map((c, i) => `<td${i ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`;
$('#prov').textContent = `DefiLlama snapshot ${M.as_of} · ${A.scanned} read · refit by this run · no network`;
{ const f = M.farm_rows;
$('#verdict').innerHTML = `<span class="big">${f.farm} of ${f.total} pre-token protocols pay for their own farm at the pessimistic end of a calibrated band. The other ${f.total - f.farm} are priced, tested — and told no.</span>` +
`<span class="nums"><span>full price <b>${fx(E.implied_loo_fit_universe)}</b></span><span>held-out miss <b>${fx(E.loo_fit_universe)}</b></span><span>odds <b>${pc(O.cv_accuracy)}</b> vs ${pc(O.base_rate)} base</span><span>coverage <b>${pc(C.measuredCoverage)}</b></span></span>`; }
{ const rows = R.rows;
const checks = [
[rows.every((r, i) => r.rank === i + 1), `ranks 1–${rows.length} in order, recomputed here`],
[rows.filter((r) => r.segment === 'watchlist').length === A.watchlist, `watchlist ${A.watchlist}/${A.watchlist} on the board`],
[rows.reduce((s, r) => s + r.implied_value_usd, 0) === M.totals.implied_sum_usd, `Σ implied ${fmt(M.totals.implied_sum_usd)} = run total`]];
$('#audit').innerHTML = checks.map(([ok, t]) => `<span class="${ok ? '' : 'bad'}">${ok ? '✓' : '✗'} ${t}</span>`).join(''); }
{ const segN = (s) => R.rows.filter((r) => r.segment === s).length;
const excl = A.rankExcluded.reduce((s, r) => s + r.count, 0);
const parts = [['#2f9e6e', `Ranked — watchlist ${segN('watchlist')}`], ['#4da3ff', `Ranked — early, below the floor ${segN('below-floor')}`],
['#7ee2a0', `Ranked — off-list ${segN('off-list')}`], ...A.rankExcluded.map((r) => ['#8a6d2f', `Not ranked — ${r.label} ${r.count}`]),

['#39465c', `Already record a token ${A.scanned - A.ranked - excl}`]];
$('#acctbar').innerHTML = `<div class="bar">${parts.map(([c, t]) => `<i style="background:${c};width:${(parseInt(t.match(/\d+$/)[0]) / A.scanned * 100).toFixed(2)}%"></i>`).join('')}</div>` +
`<div class="leg">${A.scanned} scanned · ${A.tradedAnchors} traded anchors (${A.fitEligible} fit-eligible) · ${A.ranked} ranked · watchlist ${A.watchlist}/${A.watchlist} · ${parts.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join(' · ')}</div>`; }
function evidenceHTML() {
const cal = O.calibration;
const kpi = [
[fx(E.loo_fit_universe), 'Held-out miss — declared universe', `leave-one-out on ${A.fitUniverse} fit anchors`],
[fx(E.implied_loo_fit_universe), 'Full price, graded end-to-end', `value × odds, LOO · all-${A.fitEligible} ${fx(E.implied_loo_all_eligible)}`],
[fx(E.walk_forward), 'Walk-forward by listed_at', `${E.walk_forward_pairs} pairs, 5 origins · implied ${fx(E.implied_walk_forward)}`],
[pc(O.cv_accuracy), 'Odds called held-out', `vs base ${pc(O.base_rate)} · AUC ${O.cv_auc.toFixed(2)} · ${O.folds} folds`],
[pc(C.measuredCoverage), 'Band coverage, measured', `${pc(C.nominal)} promised · ×/÷ e^${C.halfWidth.toFixed(2)}`],
[`${M.farm_rows.farm} FARM`, 'Rows clearing full cost', `of ${M.farm_rows.total} at the low band · THIN ${M.farm_rows.thin} · SKIP ${M.farm_rows.skip}`],
].map(([b, s, e]) => `<div class="kpi"><b>${b}</b><span>${s}</span><em>${e}</em></div>`).join('');
const cand = tbl(['Learner', 'LOO fit', 'LOO all', 'Folds', 'Pooled', 'Verdict'],
E.candidates.map((x) => tr([x.name, fx(x.looFitU), fx(x.looAll), x.winRate === null ? '—' : pc(x.winRate) + ' wins', x.pooledCand === null ? '—' : `${fx(x.pooledCand)} vs ${fx(x.pooledBase)}`, x.verdict])), 'sm');
const terms = tbl(['Term (drop-one)', 'LOO fit', 'LOO all', 'Full wins', 'Pooled', 'Verdict'],
E.terms.map((x) => tr([x.label, fx(x.looFitUDropped), fx(x.looAllDropped), x.winRate === null ? '—' : pc(x.winRate), x.pooledFull === null ? '—' : `${fx(x.pooledFull)} vs ${fx(x.pooledDropped)}`, x.verdict])), 'sm');
const split = E.terms.filter((x) => x.verdict === 'SPLIT').map((x) => x.label.split(' (')[0]);
const calib = tbl(['Odds bucket', 'n', 'Predicted', 'Launched'],
cal.buckets.filter((b) => b.n > 0).map((b) => tr([`${b.lo.toFixed(1)}–${b.hi.toFixed(1)}`, b.n, pc(b.predicted), pc(b.actual)])), 'sm');
const miss = tbl(['Protocol', 'Category', 'Predicted', 'Actual cap', 'Fold'],
E.misses.map((m) => tr([m.name, m.category || '—', fmt(m.pred), fmt(m.actual), fx(m.fold)])));
return kpi + `<div class="panel wide"><h3>Candidate tournament — every learner scored held-out, losers printed</h3>${cand}
<p class="note">Production model: <b>${E.chosen_model}</b>. Chosen by rule, not by hand: ${E.selection_rule}.</p></div>
<div class="three">
<div class="panel"><h3>Every value term, tested held-out twice</h3>${terms}
<p class="note">Drop-one from the chosen form; KEPT needs ≥60% fold wins + a better pooled median.${split.length ? ` Split: ${split.join(', ')} — pooled and all-eligible LOO improve with it, fold wins fall short; kept at reduced weight, disagreement printed.` : ''}</p></div>
<div class="panel"><h3>Odds calibration — held-out buckets</h3>${calib}
<p class="note">Out-of-fold probabilities, all ${A.scanned}. Brier ${cal.brier.toFixed(3)} vs base-rate ${cal.brierBase.toFixed(3)}. The middle bucket over-calls (50% promised, 42% occurred) — printed, not hidden.</p></div>
<div class="panel"><h3>The 8 worst leave-one-out misses — unedited</h3>${miss}</div>
</div>
<div class="two">
<div class="panel"><h3>Method and stress lines</h3>
<p class="note">Value: ${E.chosen_model} — kNN-5 over log cap/TVL (momentum, age, size, chain reach; learner B adds an Ethereum flag), category penalty 0.75, on the declared ${A.fitUniverse}-anchor universe. Odds: logistic regression on all ${A.scanned}. Implied = value × odds, and the product itself is graded above (the previous build graded the ratio alone). Within-2x: fit ${pc(E.within2_fit_universe)}, all ${pc(E.within2_all)}, full price ${pc(E.implied_within2_fit_universe)}. Stress line: 70/30 time-split (newest cohort) ${fx(E.time_split)}; walk-forward is the headline temporal test. Bootstrap 200 refits: median rank-range width ${E.bootstrap_median_rank_width.toFixed(0)}. Momentum winsorised at the anchors' 5–95% band, prediction time only.</p></div>
<div class="panel"><h3>Is the printed band honest?</h3>
<p class="note">The board prints P25–P75 (×/÷ e^${C.innerHalfWidth.toFixed(2)}): measured coverage ${pc(C.innerMeasuredCoverage)} against ${pc(C.innerNominal)} promised, held-out thirds, 24 repeats. The wider 80% band (×/÷ e^${C.halfWidth.toFixed(2)}) measures ${pc(C.measuredCoverage)} against ${pc(C.nominal)}. Farm verdicts still net at the 80% band's low end.</p></div>
</div>`;
}
function farmPanelHTML() {
const farms = R.rows.filter((r) => r.verdict === 'FARM').sort((a, b) => b.net_usd - a.net_usd);
const book = farms.map((r) => `<tr><td><span class="pname">${r.name}</span><br><span class="pcat">${r.category || ''} · ${r.chains.slice(0, 2).join(', ')}</span></td><td class="num">${fmt(r.band_low_usd)}</td><td class="num">${fmt(r.capture_usd)}</td><td class="num">${fmt(r.farm_cost_usd)}</td><td class="num">${r.farm_days}d</td><td class="num pos">${fmt(r.net_usd)}</td></tr>`).join('');
return `<div class="panel wide" style="margin-top:10px"><h3>The farm book — every FARM row, costed (combined net ${fmt(farms.reduce((s, r) => s + r.net_usd, 0))})</h3>
<table><tr><th>Protocol</th><th class="n">Low band</th><th class="n">Capture</th><th class="n">Cost</th><th class="n">Days</th><th class="n">Net</th></tr>${book}</table>
<p class="note">Verdicts net at the 80% band's low end, never the point estimate: FARM needs net ≥ $${VR} there. THIN rows (${M.farm_rows.thin}) fall short of it; SKIP rows (${M.farm_rows.skip}) lose money at the low band outright.</p></div>`;
}
let sortKey = 'rank', sortDir = 1, view = 'board';
function rowHTML(r) {
const chg = r.change_7d === null ? '—' : `<span class="${r.change_7d >= 0 ? 'pos' : 'neg'}">${r.change_7d >= 0 ? '+' : ''}${r.change_7d.toFixed(1)}%</span>`;
return `<tr data-slug="${r.slug}"><td class="num">${r.rank}<span class="sub">refits ${r.rank_range[0]}–${r.rank_range[1]}</span></td>` +
`<td><span class="pname">${r.name}</span> <span class="seg">${r.segment}</span><br><span class="pcat">${r.category || 'uncategorised'} · ${r.chains.slice(0, 3).join(', ')}</span></td>` +
`<td class="num">${fmt(r.tvl_usd)}</td><td class="num">${chg}</td><td class="num">${fmt(r.value_if_launches_usd)}</td>` +
`<td class="num">${r.launch_odds_pct.toFixed(0)}%</td>` +
`<td class="num"><b>${fmt(r.implied_value_usd)}</b></td><td class="num">${fmt(r.band25_low_usd)} – ${fmt(r.band25_high_usd)}</td>` +
`<td><span class="v${r.verdict}">${r.verdict}</span><span class="sub ${r.net_usd >= 0 ? 'pos' : 'neg'}">net ${fmt(r.net_usd)}</span></td></tr>`;
}
function renderBoard() {
const q = $('#q').value.toLowerCase(), seg = $('#seg').value, verd = $('#verd').value || (view === 'farm' ? 'FARM' : '');
let rows = R.rows.filter((r) => (!seg || r.segment === seg) && (!verd || r.verdict === verd) && (!q || (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().includes(q)));
rows = [...rows].sort((a, b) => { const x = a[sortKey], y = b[sortKey]; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sortDir; });
if (view === 'farm' && sortKey === 'rank') rows.sort((a, b) => b.net_usd - a.net_usd);
$('#board tbody').innerHTML = rows.map(rowHTML).join('');
$('#rowcount').textContent = `${rows.length} of ${R.rows.length} rows shown. Click a row for its derivation and farm plan.`;
$('#farmpanel').innerHTML = view === 'farm' ? farmPanelHTML() : '';
document.querySelectorAll('#board tbody tr').forEach((t) => t.addEventListener('click', () => showDetail(t.dataset.slug)));
}
document.querySelectorAll('#board th[data-k]').forEach((th) => th.addEventListener('click', () => {
const k = th.dataset.k; if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = k === 'name' || k === 'verdict' ? 1 : -1; } renderBoard();
}));
['q', 'seg', 'verd'].forEach((id) => $('#' + id).addEventListener('input', renderBoard));
function showDetail(slug) {
const r = R.rows.find((x) => x.slug === slug);
if (!r) return;
$('#boardwrap').hidden = true; $('#evidence').style.display = 'none';
const d = $('#detail'); d.hidden = false;
const margin = r.verdict === 'FARM' ? `clears the $${VR} line by ${fmt(r.net_usd - VR)}` : r.verdict === 'THIN' ? `falls ${fmt(VR - r.net_usd)} short of the $${VR} line` : 'is under water at the low band outright';
const peers = (r.peers || []).map((p) => `<tr><td>${p.name}${p.kin === 'overall' ? ' <span class="pcat">(nearest overall)</span>' : ''}</td><td class="n">${fmt(p.tvl_usd)}</td><td class="n">${fmt(p.mcap_usd)}</td><td class="n">${fmt(p.model_cap_usd)}</td><td class="n">${(p.mcap_usd / p.model_cap_usd).toFixed(2)}x</td></tr>`).join('');
d.innerHTML = `<button class="back" onclick="backToBoard()">← back to board</button>
<div class="dhead"><div><h2>#${r.rank} ${r.name} <span class="seg">${r.segment}</span> <span class="v${r.verdict}">${r.verdict}</span></h2>
<p class="note">${r.category || 'uncategorised'} · ${r.chains.join(', ')} · TVL ${fmt(r.tvl_usd)} · 7d change ${r.change_7d === null ? 'not reported' : r.change_7d.toFixed(1) + '%'} · rank range ${r.rank_range[0]}–${r.rank_range[1]} across 200 refits</p></div>
<div class="big"><span class="note">implied value — a model estimate</span><b>${fmt(r.implied_value_usd)}</b><span class="note">value if it launches ${fmt(r.value_if_launches_usd)} · odds ${r.launch_odds_pct.toFixed(1)}%</span></div></div>
<h3>How this price is built</h3>
<table class="steps"><tr><th>Step</th><th class="n">Factor</th><th class="n">Running value</th><th>Where the number comes from</th></tr>
<tr><td>TVL, DefiLlama snapshot ${M.as_of}</td><td class="n">—</td><td class="n">${fmt(r.tvl_usd)}</td><td>The snapshot's own figure.</td></tr>
<tr><td>× fitted cap/TVL ratio</td><td class="n">${(r.value_if_launches_usd / r.tvl_usd).toFixed(4)}</td><td class="n">${fmt(r.value_if_launches_usd)}</td><td>${E.chosen_model} — the blend the tournament chose; read off the anchors nearest this row.</td></tr>
<tr><td>× launch odds</td><td class="n">${(r.launch_odds_pct / 100).toFixed(3)}</td><td class="n">${fmt(r.implied_value_usd)}</td><td>Logistic fit on all ${A.scanned}; held-out ${pc(O.cv_accuracy)} vs ${pc(O.base_rate)} base, calibration on page 1.</td></tr>
<tr><td>Printed band P25–P75</td><td class="n">×/÷ e^${C.innerHalfWidth.toFixed(2)}</td><td class="n">${fmt(r.band25_low_usd)} – ${fmt(r.band25_high_usd)}</td><td>Split-conformal; measured coverage ${pc(C.innerMeasuredCoverage)} at ${pc(C.innerNominal)} promised.</td></tr>
<tr class="tot"><td>80% band</td><td class="n">×/÷ e^${C.halfWidth.toFixed(2)}</td><td class="n">${fmt(r.band_low_usd)} – ${fmt(r.band_high_usd)}</td><td>Measured coverage ${pc(C.measuredCoverage)} at ${pc(C.nominal)} promised. Farm verdicts net at this low end.</td></tr></table>
<h3>The traded company it keeps</h3>
<table class="steps"><tr><th>Traded anchor</th><th class="n">TVL</th><th class="n">Real cap</th><th class="n">This model prices it at</th><th class="n">Real ÷ model</th></tr>${peers}</table>
<p class="note">Same-category anchors first; fills marked (nearest overall).</p>
<h3>Farm verdict — cost from category + chain + chase surcharge</h3>
<div class="arith">capture <b>${fmt(r.capture_usd)}</b> at the low band − full cost <b>${fmt(r.farm_cost_usd)}</b> over ~${r.farm_days} days = net <b>${fmt(r.net_usd)}</b> → <b>${r.verdict}</b> — ${margin}.</div>
<ol class="steps">${r.farm_steps.map((s) => `<li>${s}</li>`).join('')}</ol>`;
window.scrollTo(0, 0);
}
function backToBoard() { $('#detail').hidden = true; $('#boardwrap').hidden = false; $('#evidence').style.display = ''; window.scrollTo(0, 0); }
function setView(v) {
view = v;
document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
$('#evidence').innerHTML = v === 'board' ? evidenceHTML() : '';
$('#evidence').style.display = v === 'board' ? '' : 'none';
backToBoard();
if (v !== 'board') { $('#detail').hidden = true; $('#boardwrap').hidden = false; }
renderBoard();
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
$('#foot').textContent = `Snapshot: ${M.source}. Implied values are fitted claims, not predictions; the chips re-check this page against the run.`;
setView('board');
const h = location.hash;
if (h === '#farm') setView('farm');
else if (h.startsWith('#detail-')) showDetail(h.slice(8));
