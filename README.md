# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/joyxgit-tech/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/joyxgit-tech/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Autonomous pre-token protocol valuation model, ranking radar, and actionable farming playbook generator built for [make.fun](https://make.fun)'s **Build the best token launch radar** (`token-radar-01`) bounty ($1,325 USDC prize pool).

## Overview
- **Deterministic Valuation Model (`radar-2.0`)**: Computes implied token valuations from DefiLlama protocol snapshots using base TVL multiples, seven-day momentum curves, and operational maturity factors.
- **Pre-Token Discovery Engine**: Ranks 200+ protocols, guaranteeing 100% coverage of all watchlist targets and discovering high-potential early opportunities below the watchlist floor.
- **Actionable Farming Playbooks**: Generates 6-step actionable strategies for each protocol specifying required capital, hold durations, gas estimations, and risk management.
- **Offline Interactive Dashboard**: Modern, accessible zero-network web interface providing instant multi-column sorting, live token comparables, and real-time filtering.

## Running Locally
```bash
# Evaluate protocol snapshot and compile output assets
node --experimental-strip-types main.ts --input=/path/to/snapshot.json --output=out
```
