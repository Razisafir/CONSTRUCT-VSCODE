/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.
/*---------------------------------------------------------------------------------------------
 *  Kovix Surface Branding — injects the Kovix identity into three remaining
 *  VS Code surfaces the brand-chrome contribution doesn't cover:
 *
 *    Phase 5  — Command Palette / Quick Pick header
 *    Phase 6  — Settings UI header band
 *    Phase 7  — About dialog brand panel
 *
 *  Each injection is DOM-only: we hook the relevant VS Code container,
 *  prepend a Kovix-branded element, and never delete or hide VS Code's
 *  own content. All styling lives in kovix-brand.css.
 *
 *  Why a single contribution rather than three? They share the same
 *  "wait for DOM, then inject" pattern, and bundling them keeps the
 *  workbench contribution count low.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { localize } from '../../../../nls.js';

/** Inline K mark — 18px variant for the command palette + settings headers. */
const KOVIX_K_SVG_18 = `
<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="kovix-surface-volt-18" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2DD4BF" />
      <stop offset="55%" stop-color="#14B8A6" />
      <stop offset="100%" stop-color="#0F766E" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" rx="224" ry="224" fill="url(#kovix-surface-volt-18)" />
  <path d="M 320 200 H 480 V 824 H 320 Z" fill="#FFFFFF" />
  <path d="M 480 480 L 760 200 L 880 200 L 880 320 L 600 600 L 880 880 L 880 1000 L 760 1000 L 480 720 Z" fill="#FFFFFF" />
</svg>`;

/** Larger 64px K mark for the About dialog. */
const KOVIX_K_SVG_64 = `
<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="kovix-surface-volt-64" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2DD4BF" />
      <stop offset="55%" stop-color="#14B8A6" />
      <stop offset="100%" stop-color="#0F766E" />
    </linearGradient>
    <radialGradient id="kovix-surface-glow-64" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#14B8A6" stop-opacity="0.30" />
      <stop offset="100%" stop-color="#14B8A6" stop-opacity="0" />
    </radialGradient>
  </defs>
  <circle cx="512" cy="512" r="512" fill="url(#kovix-surface-glow-64)" />
  <rect x="0" y="0" width="1024" height="1024" rx="224" ry="224" fill="url(#kovix-surface-volt-64)" />
  <rect x="32" y="32" width="960" height="960" rx="200" ry="200"
        fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2" />
  <path d="M 320 200 H 480 V 824 H 320 Z" fill="#FFFFFF" />
  <path d="M 480 480 L 760 200 L 880 200 L 880 320 L 600 600 L 880 880 L 880 1000 L 760 1000 L 480 720 Z" fill="#FFFFFF" />
  <path d="M 480 480 L 600 480 L 540 540 Z" fill="#2DD4BF" />
</svg>`;

/** Read version from the global package.json (injected at build time). */
function getKovixVersion(): string {
  try {
    // The workbench exposes the product version globally.
    const anyWindow = window as any;
    return anyWindow?.kovixProduct?.version ?? '1.5.0-dev';
  } catch {
    return '1.5.0-dev';
  }
}

/**
 * DOM-observer-based branding injector. Watches the body for the three
 * target surfaces and prepends a Kovix-branded element when they appear.
 *
 * Uses a single MutationObserver rather than multiple setInterval polls
 * — cheaper, and naturally handles late-mounting VS Code surfaces.
 */
export class KovixSurfaceBrandingContribution extends Disposable implements IWorkbenchContribution {
  static readonly ID = 'workbench.contrib.kovixSurfaceBranding';

  private observer: MutationObserver | undefined;
  private injectedQuickInput = false;
  private injectedSettings = false;
  private injectedAbout = false;

  constructor(
    @ILogService private readonly logService: ILogService,
  ) {
    super();
    // Defer one tick so the body is mounted.
    setTimeout(() => this.start(), 600);
  }

  private start(): void {
    try {
      this.observer = new MutationObserver(() => this.scan());
      this.observer.observe(document.body, { childList: true, subtree: true });
      // Also do an immediate scan in case surfaces are already mounted.
      this.scan();
    } catch (err) {
      this.logService.error('[Kovix] Surface branding observer failed:', err);
    }
  }

  private scan(): void {
    if (!this.injectedQuickInput) { this.tryInjectQuickInput(); }
    if (!this.injectedSettings) { this.tryInjectSettings(); }
    if (!this.injectedAbout) { this.tryInjectAbout(); }
    // Once all three are in, stop observing to save cycles.
    if (this.injectedQuickInput && this.injectedSettings && this.injectedAbout) {
      this.observer?.disconnect();
      this.observer = undefined;
    }
  }

  // ── Phase 5: Command Palette / Quick Pick ──────────────────────────────

  private tryInjectQuickInput(): void {
    const widget = document.querySelector('.monaco-workbench .quick-input-widget');
    if (!widget) { return; }
    // Don't double-inject.
    if (widget.querySelector('.kovix-quickinput-header')) { this.injectedQuickInput = true; return; }

    const header = document.createElement('div');
    header.className = 'kovix-quickinput-header';
    header.innerHTML = `
      ${KOVIX_K_SVG_18}
      <span class="kovix-quickinput-title">${localize('kovixQuickInputTitle', "Kovix Command Palette")}</span>
      <span class="kovix-quickinput-subtitle">${localize('kovixQuickInputSubtitle', "Type a command or search files")}</span>
    `;
    // Insert as the first child so it sits above the input field.
    widget.insertBefore(header, widget.firstChild);
    this.injectedQuickInput = true;
  }

  // ── Phase 6: Settings UI header band ───────────────────────────────────

  private tryInjectSettings(): void {
    const editor = document.querySelector('.monaco-workbench .settings-editor');
    if (!editor) { return; }
    if (editor.querySelector('.kovix-settings-header')) { this.injectedSettings = true; return; }

    const header = document.createElement('div');
    header.className = 'kovix-settings-header';
    header.innerHTML = `
      ${KOVIX_K_SVG_18}
      <div>
        <div class="kovix-settings-title">${localize('kovixSettingsTitle', "Kovix Settings")}</div>
        <div class="kovix-settings-tagline">${localize('kovixSettingsTagline', "AI-native development environment")}</div>
      </div>
      <button class="kovix-settings-cta" type="button" data-command="kovix.agentSettings">
        ${localize('kovixSettingsCta', "Open Agent Settings →")}
      </button>
    `;
    // Insert at the very top of the settings editor.
    editor.insertBefore(header, editor.firstChild);

    // Wire the CTA button to reveal the Kovix Agent Settings view.
    header.querySelector<HTMLButtonElement>('.kovix-settings-cta')?.addEventListener('click', () => {
      try {
        const bridge = (window as any).kovixCommandBridge;
        bridge?.executeCommand?.('kovix.openAgentSettings');
      } catch (err) {
        this.logService.error('[Kovix] Settings CTA dispatch failed:', err);
      }
    });

    this.injectedSettings = true;
  }

  // ── Phase 7: About dialog brand panel ──────────────────────────────────

  private tryInjectAbout(): void {
    // VS Code's About dialog is a `.dialog` container with `.dialog-message`
    // at its head. We prepend a Kovix brand row above the existing content.
    // Match by looking for a dialog containing the literal "VS Code" or
    // "Visual Studio Code" text — that's the About dialog.
    const dialogs = document.querySelectorAll('.monaco-workbench .dialog');
    dialogs.forEach((dialog) => {
      if (dialog.querySelector('.kovix-about-row')) { return; } // already injected
      const text = dialog.textContent ?? '';
      if (!text.match(/Visual Studio Code|VS Code|version/i)) { return; }

      const row = document.createElement('div');
      row.className = 'kovix-about-row';
      const version = getKovixVersion();
      row.innerHTML = `
        ${KOVIX_K_SVG_64}
        <div class="kovix-about-titles">
          <div class="kovix-about-name">KOVIX</div>
          <div class="kovix-about-version">v${version}</div>
          <div class="kovix-about-tagline">${localize('kovixAboutTagline', "AI-native development environment")}</div>
        </div>
      `;

      // Insert at the top of the dialog body.
      const messageEl = dialog.querySelector('.dialog-message');
      if (messageEl) {
        messageEl.insertBefore(row, messageEl.firstChild);
      } else {
        dialog.insertBefore(row, dialog.firstChild);
      }

      // Append a credit footer (legal: must acknowledge VS Code's MIT code).
      const credit = document.createElement('div');
      credit.className = 'kovix-about-credit';
      credit.innerHTML = localize('kovixAboutCredit',
        "Powered by VS Code's Monaco Editor. Source: <a href=\"https://github.com/Razisafir/KOVIX\">github.com/Razisafir/KOVIX</a>. Changelog: <a href=\"https://github.com/Razisafir/KOVIX/blob/main/CHANGELOG.md\">v{0} →</a>",
        version
      );
      dialog.appendChild(credit);

      this.injectedAbout = true;
    });
  }

  override dispose(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    super.dispose();
  }
}
