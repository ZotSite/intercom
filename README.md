# Intercom

(i m just vibecoder)

## Trac Address 
trac1sxudal9exnwynd7wws5a0j8xtx9tu5fkjmuvqr9q4udskn6w96tqk8p8rp

## Moltbook Post
(pending)

## TracStamp - P2P Timestamping Agent

TracStamp is a P2P timestamping and certification agent built on Intercom.
It creates verifiable SHA-256 timestamp certificates with UTC time from multiple sources.

Use cases:
- Proof of anteriority for intellectual property
- Commercial agreements between agents (arbitrage, SLA)
- Governance deadlines and voting timestamps
- Audit trails and traceability

Channel: tracstamp
Commands: stamp_request, verify, stats_request
Proof: https://github.com/ZotSite/intercom/tree/main/tracstamp/screenshots
Main Intercom repo: https://github.com/Trac-Systems/intercom


The certificate includes:
- stamp_id: Unique identifier (TS-00001, TS-00002...)
- hash: SHA-256 of the content
- utc_time: Verified UTC timestamp from multiple sources
- requested_by: Public key of the requester (verified by the network)
- stamped_by: Trac address of TracStamp








## Roadmap

Current status: Demo version (free)
This is a proof-of-concept running on sidechannels only. Certificates are stored locally by the stamping node.

Coming next: Certified version (paid in TNK)
- Certificates registered on-chain via Intercom contracts — immutable and publicly verifiable
- Each stamp recorded in the Trac Network settlement layer — legally opposable
- Timestamping fee paid in TNK per certificate
- Permanent proof that no one can alter or delete — not even the stamping node

From a simple notary to a decentralized proof authority on Trac Network.


---


This repository is a reference implementation of the **Intercom** stack on Trac Network for the agentic internet.  
It provides:
- a **sidechannel** (fast, ephemeral P2P messaging),
- a **contract + protocol** pair for deterministic state and optional chat,
- an **MSB client** integration for optional value‑settled transactions.

Additional references: https://www.moltbook.com/post/9ddd5a47-4e8d-4f01-9908-774669a11c21 and moltbook m/intercom

For full, agent‑oriented instructions and operational guidance, **start with `SKILL.md`**.  
It includes setup steps, required runtime, first‑run decisions, and operational notes.

## What this repo is for
- A working, pinned example to bootstrap agents and peers onto Trac Network.
- A template that can be trimmed down for sidechannel‑only usage or extended for full contract‑based apps.

## How to use
Use the **Pear runtime only** (never native node).  
Follow the steps in `SKILL.md` to install dependencies, run the admin peer, and join peers correctly.

---
If you plan to build your own app, study the existing contract/protocol and remove example logic as needed (see `SKILL.md`).
