# Controlled ground coordination experiments — 2026-11-08

**Status update, 2026-11-10:** the user requested that the new tactical behavior be experimental and disabled by default. `ground.experimentalTactics=false` now selects standard play. The experiment commands below explicitly opt in and preserve the behavior measured in this historical report. See the implementation plan for selective rollback results.

**Finding on 2026-11-08:** reassessment has the largest measured effect on road attrition. Removing it improves Valley Road, but leaves supported Overwatch with more survivors and fewer successes. The support-wait timer reduces exposure without a consistent mission benefit. The initial recommendation to retain the new tactics as defaults is superseded by the November 10 decision.

## Design

6,800 battles, with identical scenario inputs, policies and paired seeds within comparisons. All switches apply symmetrically to both sides. Weapons, casualties, objectives and victory thresholds were fixed. No new truth enters tactical decisions.

- Screening: seeds 1–100; four road scenario/policy cases; all eight gate combinations (3,200 runs), plus a predeclared 120-second support-wait budget with all gates enabled (400).
- Confirmation: seeds 101–300; same four cases; baseline, reassessment disabled, and the 120-second timer (2,400). Reassessment was selected after screening; confirmation seeds were excluded from selection.
- Controls: seeds 1–100; both outposts with no air and their informed bot; baseline versus timer (800). These are screening controls, not independent confirmation.
- 1,600 baseline reruns exactly match saved pre-experiment outcome, friendly/enemy personnel remaining and end tick. Removing the new `drillWaitReason` and null `supportWaitSeconds` state fields also reproduces the old golden replay hash.

Mask order is **support, assembly, reassessment**; 1 enables a gate. Support ablation preserves approach, routes, assignments and personal pinning. Assembly ablation preserves each flanker’s own waypoint. Reassessment ablation combines three changes: no ongoing willingness gate, no active-attack bypass reassessment, and continued generic assault commitment. Initial drill selection and ordinary withdrawal remain. It is a package, so these runs cannot attribute its effect to an individual component or side.

## Confirmation results

Each entry reports **successes / 200; mean friendly personnel remaining**. These are held-out seeds only.

| Case | Current baseline | Reassessment disabled | 120-second support wait |
|---|---:|---:|---:|
| Valley / no air | 13/200; 15.7 | 32/200; 26.4 | 9/200; 15.2 |
| Valley / recon | 61/200; 30.3 | 99/200; 39.6 | 62/200; 30.4 |
| Overwatch / no air | 1/200; 10.8 | 1/200; 21.8 | 1/200; 10.4 |
| Overwatch / cover | 16/200; 22.3 | 6/200; 30.4 | 18/200; 22.5 |

Paired reassessment effects (candidate minus baseline):

| Case | Success change, percentage points | Seeds gaining / losing success | Exact paired p | Personnel change, approximate 95% interval |
|---|---:|---:|---:|---:|
| Valley / no air | +9.5 | 25 / 6 | 0.0009 | +10.66 [+8.65, +12.68] |
| Valley / recon | +19.0 | 62 / 24 | 0.0001 | +9.29 [+7.59, +10.98] |
| Overwatch / no air | +0.0 | 1 / 1 | 1.0000 | +11.10 [+9.09, +13.10] |
| Overwatch / cover | -5.0 | 6 / 16 | 0.0525 | +8.13 [+6.20, +10.06] |

Intervals use the sample variance of paired differences. Exact two-sided McNemar probabilities accompany binary outcomes because very few discordant pairs make normal approximations misleading. No multiplicity correction is applied; screening is exploratory. The Overwatch success drop is an observed adverse signal, not strong standalone statistical evidence (p≈0.0525). Valley improvements and survival changes warrant isolating the reassessment components; they do not justify restoring indefinite assaults.

## Does a timer prevent sitting under fire?

`supportWaitSeconds` counts accumulated time in one attack/contact drill during which missing supporting fire blocks maneuver. It survives brief volleys, role changes, movement progress and target correction. At expiry, the platoon attempts a permitted, terrain-feasible bypass; otherwise it withdraws using existing fallback/recovery rules. A failed attempt never marks the enemy cleared. A bypass may move immediately despite that failure record.

The timer excludes approach, assembly, doctrine refusal, lack of maneuver capacity and waiting for aircraft. Aircraft waiting already has `airWaitSeconds`. It is therefore a specific guard against missing ground support, not a universal inactivity timer. The null default leaves current play unchanged.

Mean **stationary maneuver squad-seconds under recent fire** per battle, baseline → timer:

| Case | Exposed waiting | Personnel lost during support waiting | Friendly timeouts per battle |
|---|---:|---:|---:|
| Valley / no air | 25.9 → 12.3 | 0.025 → 0.010 | 0.115 |
| Valley / recon | 10.4 → 7.5 | 0.015 → 0.010 | 0.025 |
| Overwatch / no air | 13.7 → 8.4 | 0.015 → 0.000 | 0.100 |
| Overwatch / cover | 26.2 → 17.0 | 0.050 → 0.045 | 0.160 |

Exposure falls by 28–53%, but baseline losses inside this narrowly defined waiting state are only 0.015–0.050 people per battle. That is too small to support the hypothesis that these waits directly account for the large attrition regression. Indirect route/timing effects remain possible. The timer changes only four, one, zero and two success/failure pairs respectively in the held-out cases; none gives a reliable general outcome improvement.

A squad-second counts a squad, not its personnel. “Stationary” means a hold/wait or engage-without-movement intent; “under fire” means its last recorded hit/fire event was within 15 seconds. Personnel lost counts reductions in available personnel, including wounded, not just deaths. Losses are associated with the current phase, not causally assigned to it. Firing diagnostics count squad-ticks containing an actual volley, not continuous firing duration. Phase and reason counters are observer outputs, absent from `UnitSelf`.

## Outpost controls

Successes / 100; mean friendly personnel remaining.

| Case | Baseline | Timer |
|---|---:|---:|
| outpost-under-pressure / none | 26/100; 74.85 | 24/100; 75.32 |
| outpost-under-pressure / informed | 85/100; 84.15 | 85/100; 84.38 |
| outpost-night / none | 30/100; 65.16 | 26/100; 65.59 |
| outpost-night / informedLit | 61/100; 72.58 | 67/100; 73.01 |

The timer also affects attacking enemies. These mixed results are another reason not to treat a global timer as a demonstrated balance fix.

## Full factorial screen

Successes / 100. The JSON report also contains all phase counters, paired differences, main effects and interactions.

| Mask | Valley / no air | Valley / recon | Overwatch / no air | Overwatch / cover |
|---|---:|---:|---:|---:|
| 000 | 16 | 51 | 1 | 0 |
| 001 | 1 | 37 | 2 | 4 |
| 010 | 17 | 52 | 0 | 2 |
| 011 | 2 | 37 | 3 | 5 |
| 100 | 16 | 51 | 1 | 3 |
| 101 | 5 | 37 | 2 | 7 |
| 110 | 14 | 47 | 1 | 1 |
| 111 | 5 | 38 | 1 | 7 |

Averaged across the other gates, enabling support changes success by −1.0 to +1.75 percentage points and assembly by −0.5 to +0.25 points across these cases. Reassessment changes success by −13.0 to +4.25 points and friendly survivors by −12.55 to −6.28. Interactions are retained in the JSON rather than assuming the effects add independently. The road formations mostly have only one maneuver element; these maps are a weak test of waiting for several flankers.

## Interpretation and next experiment

The results support investigating how commitment and reassessment interact with route completion. They do not establish that cautious units are always worse or that support gates are universally harmless. Disabling reassessment increases casualties inflicted as well as friendly survival, but also prolongs battles. In supported Overwatch, more survivors coexist with lower completion. This is consistent with a progress/commitment tradeoff and needs direct arrival/progress measurements.

Next split the reassessment package into its three components, retaining ordinary withdrawal and knowledge boundaries. Measure objective arrivals, interrupted advances, time in each tactic, wounded-related holds and remaining personnel. Keep the support timer available for targeted encounter playtests; choosing 120 seconds was a test condition, not a calibrated doctrine value.

## Reproduce

Run from the repository root. Each suite uses at most six worker processes and writes raw seed results under the gitignored `reports/ground-experiments/` directory. Clear or archive results from different code revisions before mixing batches.

```sh
node --import tsx src/cli/ground-experiment-suite.ts screen
node --import tsx src/cli/ground-experiment-suite.ts confirm 110
node --import tsx src/cli/ground-experiment-suite.ts controls
node --import tsx src/cli/ground-experiment-report.ts
```

A single independently reproducible job:

```sh
node --import tsx src/cli/ground-experiments.ts valley-road routeRecon 111 101 200 120 /tmp/valley-timer.json
```

Arguments are scenario, policy, gate mask, first seed, count, support budget (`null` disables it), output file, and optional mode (`experimental` by default, or `standard`). Gate overrides and wait budgets do not enable experimental tactics in standard mode. Keep standard-mode results in a separate output directory from the historical factorial report. Overrides affect the loaded doctrine on both sides; authored scenario files are unchanged by the runner. The report rejects duplicate or unmatched paired seeds.

Local artifacts: [aggregate JSON](../reports/ground-experiments/summary.json) and [raw run directory](../reports/ground-experiments/). This Markdown preserves the findings even when local reports are not retained.
