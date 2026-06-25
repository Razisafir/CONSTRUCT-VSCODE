# Changelog

All notable changes to the Kovix Security Tools extension are documented here.

## 0.1.0 — 2026-06-25 (Phase 5)

### Added

- Initial extraction of the three security tool definitions (nmap, Ghidra,
  Nuclei) from the core `ConstructToolRegistryService` into a separate
  built-in extension.
- The extension is disabled by default on a fresh install of Kovix. The
  LLM is never offered `nmap_scan`, `ghidra_decompile`, or `nuclei_scan`
  unless the user explicitly enables the extension AND sets
  `kovix.enableSecurityTools = true`.
- User-facing commands: `Kovix: Enable Security Tools`,
  `Kovix: Disable Security Tools`, `Kovix: Show Security Tools Status`.
- Configuration contribution:
  `kovix-security-tools.sandboxedTargetsOnly` (informational; the actual
  external-target guard lives in core).

### Changed

- The `kovix.enableSecurityTools` setting default flipped from `true` to
  `false`. Previously, the core registry auto-registered the security tools
  on every Kovix startup. Phase 5 removed that auto-registration; the
  tools are now registered on-demand by this extension's `activate()`
  function when the setting is `true`.

### Security posture

- Two-step opt-in: extension must be enabled AND setting must be true.
- nmap/nuclei external-target guard (RFC1918/loopback only by default)
  remains in core and is not bypassable from the extension.
- ghidra workspace-local binary guard (`assertWithinWorkspace`) remains
  in core and is not bypassable from the extension.

### Why

Antivirus/EDR flagging risk, enterprise IT policy blocks, and legal
liability exposure from default-on security tool integration. See the
Phase 5 entry in `PROGRESS_LOG.md` for the full tradeoff analysis that
led to this extraction.
