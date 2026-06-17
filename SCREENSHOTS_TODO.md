# Tier 1, item 1.8 — README Screenshots and Demo Video

The audit doc (§7.1, item 1.8) calls for:
- 4-6 screenshots in the README
- One 90-second demo video linked from the README
- Remove "Coming soon" placeholder from README

## Required Screenshots

1. **Agent panel with active task** — shows the plan/act loop in progress
2. **Multi-file diff review** — shows the pending changes UI
3. **Memory panel** — shows indexed workspace memories
4. **Onboarding wizard** — shows the provider setup flow
5. **Security tool approval gate** — shows nmap_scan approval dialog
6. **MCP marketplace** — shows the (Tier 2.7) marketplace UI

## Demo Video Script (90 seconds)

0:00-0:10 — Title card: "Kovix — AI-native IDE for privacy-first developers"
0:10-0:25 — Demo 1: KOVIX running fully offline with Ollama on a laptop with no internet
0:25-0:45 — Demo 2: KOVIX running Claude via API key, code never leaving the machine except for the API call
0:45-0:75 — Demo 3: KOVIX running nmap + Nuclei against a deliberately vulnerable target, agent summarizing findings
0:75-0:90 — Outro: GitHub URL + "Free + BYO key. No subscription. No telemetry."

## Status

BLOCKED — Cannot produce real screenshots or video without a running KOVIX
instance. The maintainer should:
1. Build KOVIX locally: `npm install && NODE_OPTIONS="--max-old-space-size=8192" npm run compile`
2. Launch: `./scripts/code.sh` (Linux/macOS) or `.\scripts\code.bat` (Windows)
3. Capture screenshots using the OS screen capture tool
4. Record the demo video using OBS Studio or similar
5. Place images in `docs/screenshots/` and link from README.md
6. Upload video to YouTube and link from README.md

Once screenshots are available, replace the "Coming soon" section in
README.md (currently around line 70) with the actual image embeds.
