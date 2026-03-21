# Catalog 400-sample benchmark

- Generated: 2026-03-21T19:15:14.200Z
- Sample size: 400
- Overall: **FAIL**

## Failure summary
- promoted_pct: 0%

## Baseline delta
- none (set BENCHMARK_BASELINE_JSON to compare)

## Distributions

### Match type
- unresolved: 369 (92.25%)
- normalized_scientific: 31 (7.75%)

### Relevance class
- non_food: 399 (99.75%)
- weed_or_invasive: 1 (0.25%)

### Catalog status
- excluded: 400 (100%)

## Queue counts
- promoted: 0 (0%)
- needs_review: 0 (0%)
- excluded: 400 (100%)

## Promotion blockers (diagnostic)
- non_core_status: 400 (100%)\n- not_auto_approved: 400 (100%)\n- no_openfarm_support: 399 (99.75%)\n- low_confidence_band: 399 (99.75%)\n- guardrail_blocked: 2 (0.5%)

## Source coverage (diagnostic)
- openfarm_record_present: 399 (99.75%)\n- openfarm_record_matched: 1 (0.25%)\n- unresolved_only: 369 (92.25%)

## Unresolved OpenFarm examples (first 25)
- openfarm:quercus-durata-gabrielensis:leather-oak:74817 | sci=Quercus durata var. gabrielensis | common=leather oak\n- openfarm:melanthera-biflora:sea-daisy:56712 | sci=Melanthera biflora | common=Sea daisy\n- openfarm:sparganium-fluctuans:water-burreed:84306 | sci=Sparganium fluctuans | common=Water burreed\n- openfarm:sambucus-racemosa:red-berried-elder-european-red-elder-sabugueiro-vermelho-europa:79483 | sci=Sambucus racemosa | common=red-berried elder, European red elder, sabugueiro vermelho da Europa\n- openfarm:moraea-debilis:unknown:58899 | sci=Moraea debilis | common=\n- openfarm:chloris:unknown:19573 | sci=Chloris sp. | common=\n- openfarm:isolepis-verrucosula:unknown:48336 | sci=Isolepis verrucosula | common=\n- openfarm:rhynchosia-adenodes:unknown:76542 | sci=Rhynchosia adenodes | common=\n- openfarm:astragalus:milk-vetch:9667 | sci=Astragalus | common=milk vetch\n- openfarm:asarum-caudatum-caudatum:british-columbia-wildginger:8602 | sci=Asarum caudatum var. caudatum | common=British Columbia wildginger\n- openfarm:kotschya-thymodora-thymodora:unknown:49830 | sci=Kotschya thymodora ssp. thymodora | common=\n- openfarm:sechium-edule:machuchu-machiche-xuxu-chuchu-chocho-mirliton-christophine-gayota-cidrayota-cucuzza-spinusa:81338 | sci=Sechium edule | common=machuchu (Brazil), machiche, xuxu, chuchu, chocho, mirliton, christophine, gayota, cidrayota, cucuzza spinusa\n- openfarm:pteris-friesii:unknown:74001 | sci=Pteris friesii | common=\n- openfarm:limonium-linifolium-linifolium:unknown:52762 | sci=Limonium linifolium var. linifolium | common=\n- openfarm:pinnularia-braunii:unknown:69381 | sci=Pinnularia braunii | common=\n- openfarm:barbula-imshaugii:unknown:11398 | sci=Barbula imshaugii | common=\n- openfarm:vanclevea-stylosa:pillar-false-gumweed:92890 | sci=Vanclevea stylosa | common=pillar false gumweed\n- openfarm:ranunculus-hispidus-hispidus:bristly-buttercup:75347 | sci=Ranunculus hispidus var. hispidus | common=bristly buttercup\n- openfarm:cephalophyllum-serrulatum:unknown:17955 | sci=Cephalophyllum serrulatum | common=\n- openfarm:phylica-purpurea-floccosa:unknown:68619 | sci=Phylica purpurea var. floccosa | common=\n- openfarm:lotus-scoparius-brevialatus:western-bird-foot-trefoil:54310 | sci=Lotus scoparius var. brevialatus | common=western bird's-foot trefoil\n- openfarm:envy:unknown:32917 | sci=Envy (apple) | common=\n- openfarm:barbarea-verna:upland-cress-american-cress-land-cress-early-winter-cress-poor-man-cabbage-belle-isle-cress:11358 | sci=Barbarea verna | common=upland cress, American cress, land cress, early winter cress, poor man's cabbage, Belle-Isle cress\n- openfarm:hesperolinon-micranthum:smallflower-dwarf-flax:44983 | sci=Hesperolinon micranthum | common=smallflower dwarf-flax\n- openfarm:closterium-aciculare-aciculare:unknown:21510 | sci=Closterium aciculare var. aciculare | common=

## Unresolved token frequency (top 15)
- acacia: 5\n- prunus: 4\n- erica: 3\n- care: 3\n- hordeum: 3\n- euastrum: 3\n- solanum: 3\n- quercus: 2\n- sambucus: 2\n- astragalus: 2\n- pinnularia: 2\n- ranunculus: 2\n- symphyotrichum: 2\n- salvia: 2\n- penstemon: 2

## Suspicious sample queue
- flagged: 0 (0%)
- file: ..\..\data\catalog\metrics_400_suspicious.jsonl

## Threshold checks
- promoted_pct: 0% -> FAIL
- needs_review_pct: 0% -> PASS
- suspicious_pct: 0% -> PASS
- fuzzy_match_pct: 0% -> PASS
