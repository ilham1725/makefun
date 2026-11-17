# makefun

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ilham1725/makefun/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ilham1725/makefun/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar: 226 pre-token protocols from the DefiLlama snapshot, ranked by an implied value derived from the snapshot's own figures — the median market-cap/TVL multiple of the live-token protocols, concave TVL, seven-day growth, age with no token, and chain breadth — each with a concrete farm plan naming its cost and time.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

The program reads the sealed snapshot, scores every pre-token protocol with the radar-2 model in `lib/model.ts`, writes the ranked board to `board.json` and the dashboard's dataset to `data.js`, and copies `dashboard/` and `screenshots/` beside them with the judge's `dossier.json`. Node 22, standard library only, no network.

---

<sub>Entered on [make.fun](https://make.fun/?ref=hnnqb6dc&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
