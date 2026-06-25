# Kovix Security Tools

Opt-in security scanning tools (nmap, Ghidra, Nuclei) for the Kovix agent.

## Status: DISABLED BY DEFAULT

This extension is **dormant** on a fresh install of Kovix. The three security
tools (`nmap_scan`, `ghidra_decompile`, `nuclei_scan`) are **NOT** registered
with the agent loop and the LLM is never offered them, unless the user takes
**two** explicit opt-in actions:

1. **Enable this extension** (it ships built-in but inactive).
2. **Set `kovix.enableSecurityTools = true`** in settings, OR run the
   `Kovix: Enable Security Tools` command from the command palette.

When both conditions hold, the extension activates and calls the internal
`_kovix.toolRegistry.registerSecurityTools` command, which registers the
three tools with the core `ConstructToolRegistryService`. The agent loop
will then offer them to the LLM on subsequent rounds.

## Why opt-in?

- **Antivirus / EDR**: enterprise security software (CrowdStrike, SentinelOne,
  Windows Defender ASR) often flags software that builds `nmap ...` shell
  commands. Default-off means Kovix's core installer has zero references
  to nmap/nuclei in its active code path.
- **Legal posture**: security scanning tools can be misused to scan
  unauthorized targets. Two-step opt-in shifts the user from "passive
  recipient" to "active installer" — the same model Kali Linux uses.
- **Enterprise IT**: corporate policy often blocks software that integrates
  nmap/nuclei. Default-off lets IT install Kovix core without triggering
  policy blocks.

## Safety guards (always on, regardless of extension state)

These guards live in the core `ConstructToolRegistryService` and are NOT
affected by whether this extension is installed or enabled:

- **nmap / nuclei external-target guard**: refuses to scan non-loopback,
  non-RFC1918 targets unless `kovix.security.allowExternalTargets = true`
  is explicitly set (application-scoped, so malicious workspaces can't
  enable it without the user's consent).
- **ghidra workspace-local binary guard**: `assertWithinWorkspace()` enforces
  that `binary_path` is inside the current workspace root. Cannot decompile
  arbitrary system binaries.

## Tools provided

### nmap_scan

Runs `nmap <flags> -oX - <target>` and returns XML output. Requires nmap
installed on the system (`apt install nmap`, `brew install nmap`, etc.).

### ghidra_decompile

Runs `docker run --rm -v <binary_path>:<binary_path> ghidra/ghidra <binary_path>`
to decompile a binary using Ghidra headless analysis in Docker isolation.
Requires Docker installed and the `ghidra/ghidra` image pulled
(`docker pull ghidra/ghidra`).

### nuclei_scan

Runs `nuclei -u <target> -json` to perform template-based vulnerability
scanning. Requires nuclei installed
(`go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest`).

## Commands

- `Kovix: Enable Security Tools` — sets `kovix.enableSecurityTools = true`.
- `Kovix: Disable Security Tools` — sets `kovix.enableSecurityTools = false`.
- `Kovix: Show Security Tools Status` — shows current registration state.

## License

Proprietary — see `LICENSE.txt` in the Kovix repository root.

The bundled integration code invokes the user-installed nmap, Ghidra, and
Nuclei binaries at runtime. The tools themselves are NOT redistributed with
Kovix. License details for each tool:

| Tool   | License    | Source                                                |
|--------|------------|-------------------------------------------------------|
| nmap   | GPL-2.0    | https://nmap.org/npsl/                                |
| Ghidra | Apache-2.0 | https://github.com/NationalSecurityAgency/ghidra      |
| Nuclei | MIT        | https://github.com/projectdiscovery/nuclei            |
