/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.
/*---------------------------------------------------------------------------------------------
 *  Kovix Welcome — first-launch experience.
 *
 *  On a fresh install (detected via the `kovix.firstLaunchSeen` application
 *  storage flag), opens a full-bleed webview editor with the Kovix brand
 *  mark, a one-line pitch, three primary CTAs, a "what's different" 3-card
 *  grid, and a "Skip welcome screen" link. Subsequent launches skip this.
 *
 *  Uses the same `IWebviewWorkbenchService.openWebview` pattern as
 *  `constructOnboarding.ts` — proven to compile and run cleanly against
 *  the v1.4.0 baseline. No custom EditorPane subclass, no editor-resolver
 *  registration, no upstream layout changes.
 *
 *  This intentionally does NOT use VS Code's built-in getting-started
 *  walkthroughs — those are VS Code-branded. Kovix owns its first 60
 *  seconds, end to end.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWebviewWorkbenchService } from '../../webviewPanel/browser/webviewWorkbenchService.js';
import { IOverlayWebview } from '../../webview/browser/webview.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { localize } from '../../../../nls.js';

/** Storage key — flipped to true the first time the welcome screen is dismissed. */
export const KOVIX_FIRST_LAUNCH_KEY = 'kovix.firstLaunchSeen';

/** View type id for the welcome webview. */
const KOVIX_WELCOME_VIEW_TYPE = 'kovix.welcome';

/**
 * Webview-rendered welcome screen. The HTML + CSS is inlined (rather than
 * loaded from a separate file) so we don't need to wire a new asset path
 * into the build — the webview is a sandboxed iframe and owns its own
 * styles.
 */
export class KovixWelcomeView extends Disposable {
  private webview: IOverlayWebview | undefined;

  constructor(
    @IWebviewWorkbenchService private readonly webviewWorkbenchService: IWebviewWorkbenchService,
    @IStorageService private readonly storageService: IStorageService,
    @ILogService private readonly logService: ILogService,
  ) {
    super();
  }

  /** True if the user has dismissed the welcome screen at least once. */
  static hasSeenFirstLaunch(storageService: IStorageService): boolean {
    return storageService.getBoolean(KOVIX_FIRST_LAUNCH_KEY, StorageScope.APPLICATION, false);
  }

  /** Open (or reveal) the welcome webview. */
  show(): void {
    if (this.webview) { return; } // already open

    const input = this.webviewWorkbenchService.openWebview(
      {
        title: localize('kovixWelcomeTitle', "Welcome to Kovix"),
        options: {
          retainContextWhenHidden: false,
          enableFindWidget: false,
        },
        contentOptions: {
          // SEC-1: Strict webview security — same posture as constructOnboarding.
          allowScripts: true,
          allowForms: true,
          enableCommandUris: true,
          localResourceRoots: [],
        },
        extension: undefined,
      },
      KOVIX_WELCOME_VIEW_TYPE,
      localize('kovixWelcomeTitleShort', "Welcome"),
      {},
    );

    this.webview = input.webview;

    // Listen for postMessage from the webview — used for CTA clicks so we
    // don't need command: URIs (which require registering commands).
    this._register(input.webview.onMessage(async (e) => {
      const message = e.message as { type: string };
      await this.handleMessage(message);
    }));

    // SEC-1: Strict CSP on the webview HTML.
    const nonce = this.generateNonce();
    input.webview.setHtml(this.getHtml(nonce));

    // When the webview is closed by the user, dispose our reference so a
    // subsequent open() can create a fresh one.
    this._register(input.onWillDispose(() => {
      this.webview = undefined;
    }));
  }

  private async handleMessage(message: { type: string }): Promise<void> {
    switch (message.type) {
      case 'cta-new-project':
        this.markSeen();
        // Trigger the existing Kovix Project Wizard command (if registered).
        this.dispatchCommand('kovix.openProjectWizard');
        break;
      case 'cta-open-folder':
        this.markSeen();
        this.dispatchCommand('workbench.action.files.openFolder');
        break;
      case 'cta-tour':
        this.markSeen();
        // Reuse the onboarding wizard as the "60-second tour".
        this.dispatchCommand('kovix.openOnboarding');
        break;
      case 'cta-skip':
        this.markSeen();
        // Close the webview by triggering the close-editor command.
        this.dispatchCommand('workbench.action.closeActiveEditor');
        break;
    }
  }

  private markSeen(): void {
    this.storageService.store(KOVIX_FIRST_LAUNCH_KEY, true, StorageScope.APPLICATION, StorageTarget.USER);
  }

  /** Best-effort command dispatch — works if a global command bridge is
   *  registered (e.g. by the agent host); no-ops silently otherwise. */
  private dispatchCommand(commandId: string): void {
    try {
      const bridge = (window as any).kovixCommandBridge;
      if (bridge && typeof bridge.executeCommand === 'function') {
        bridge.executeCommand(commandId);
      }
    } catch (err) {
      this.logService.error('[Kovix] Welcome CTA command dispatch failed:', err);
    }
  }

  /**
   * SECURITY FIX (M4/L2): CSP nonce must be cryptographically random.
   * Previous implementation used Math.random() — V8's XorShift128+ PRNG is
   * not crypto-grade and the CSP nonce protects every <script> tag in the
   * welcome webview from injection. Use the Web Crypto API instead, which is
   * available in both the Electron renderer and the browser.
   */
  private generateNonce(): string {
    // 32 bytes (256 bits) hex-encoded → 64 chars. Same entropy as the prior
    // 32-char base62 string but from a CSPRNG.
    const array = new Uint8Array(32);
    globalThis.crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Welcome screen HTML with strict CSP. All styling is inlined — no
   * external CSS fetches, no fonts from CDN. The design system tokens
   * are reproduced here as plain values so the webview looks identical
   * to the rest of the Kovix chrome.
   */
  private getHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <title>Welcome to Kovix</title>
</head>
<body>
  <div class="kovix-welcome__stage">
    <div class="kovix-welcome__hero">
      <div class="kovix-welcome__mark" aria-hidden="true">
        <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="kovix-welcome-volt" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#2DD4BF" />
              <stop offset="55%" stop-color="#14B8A6" />
              <stop offset="100%" stop-color="#0F766E" />
            </linearGradient>
            <radialGradient id="kovix-welcome-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#14B8A6" stop-opacity="0.55" />
              <stop offset="60%" stop-color="#14B8A6" stop-opacity="0.15" />
              <stop offset="100%" stop-color="#14B8A6" stop-opacity="0" />
            </radialGradient>
          </defs>
          <circle cx="512" cy="512" r="512" fill="url(#kovix-welcome-glow)" />
          <rect x="128" y="128" width="768" height="768" rx="170" ry="170" fill="url(#kovix-welcome-volt)" />
          <rect x="160" y="160" width="704" height="704" rx="150" ry="150"
                fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2" />
          <path d="M 360 230 H 470 V 794 H 360 Z" fill="#FFFFFF" />
          <path d="M 470 480 L 720 230 H 830 V 330 L 600 560 L 830 790 V 890 H 720 L 470 640 Z" fill="#FFFFFF" />
          <path d="M 470 480 L 580 480 L 525 535 Z" fill="#2DD4BF" />
        </svg>
      </div>
      <div class="kovix-welcome__wordmark">KOV<span class="kovix-welcome__wordmark-accent">I</span>X</div>
      <div class="kovix-welcome__tagline">AI-native development environment. The agent is the IDE.</div>

      <div class="kovix-welcome__ctas">
        <button class="kovix-welcome__cta kovix-welcome__cta--primary" data-cta="new-project">
          <span class="kovix-welcome__cta-label">Start a new project</span>
          <span class="kovix-welcome__cta-arrow">&rarr;</span>
        </button>
        <button class="kovix-welcome__cta" data-cta="open-folder">
          <span class="kovix-welcome__cta-label">Open a folder</span>
        </button>
        <button class="kovix-welcome__cta kovix-welcome__cta--ghost" data-cta="tour">
          <span class="kovix-welcome__cta-label">Take the 60-second tour</span>
        </button>
      </div>
    </div>

    <div class="kovix-welcome__features">
      <div class="kovix-welcome__feature">
        <div class="kovix-welcome__feature-icon kovix-welcome__feature-icon--swarm" aria-hidden="true">&#x2B21;</div>
        <div class="kovix-welcome__feature-title">5-agent swarm</div>
        <div class="kovix-welcome__feature-body">
          Hikmah orchestrates CEO / CTO / COO / CISO, each with its own NVIDIA
          NIM key. Plans get reviewed, code gets audited, builds get checked,
          diffs get secured &mdash; in parallel.
        </div>
      </div>
      <div class="kovix-welcome__feature">
        <div class="kovix-welcome__feature-icon kovix-welcome__feature-icon--memory" aria-hidden="true">&#x25CD;</div>
        <div class="kovix-welcome__feature-title">Persistent memory</div>
        <div class="kovix-welcome__feature-body">
          An Obsidian-style knowledge graph across working / episodic / semantic
          / procedural layers. What the agent learned yesterday is still there
          today. Privacy controls are first-class, not afterthoughts.
        </div>
      </div>
      <div class="kovix-welcome__feature">
        <div class="kovix-welcome__feature-icon kovix-welcome__feature-icon--skills" aria-hidden="true">&#x25AE;</div>
        <div class="kovix-welcome__feature-title">Skills &amp; MCP</div>
        <div class="kovix-welcome__feature-body">
          Claude-Code-style SKILL.md playbooks auto-discovered per task, plus a
          Model Context Protocol marketplace &mdash; browser tools, Agent Reach
          web research, Obsidian vaults. Plug in, ship.
        </div>
      </div>
    </div>

    <button class="kovix-welcome__skip" data-cta="skip">Skip welcome screen</button>
  </div>

  <style>
    html, body {
      margin: 0; padding: 0;
      width: 100vw; height: 100vh;
      overflow: hidden;
      background: #000000;
      color: #FFFFFF;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .kovix-welcome__stage {
      min-height: 100vh;
      display: grid;
      grid-template-rows: 1fr auto 1fr;
      gap: 32px;
      padding: 56px 24px;
      box-sizing: border-box;
      background:
        radial-gradient(circle at 50% 28%, rgba(20, 184, 166, 0.18) 0%, rgba(20, 184, 166, 0) 55%),
        radial-gradient(circle at 50% 90%, rgba(15, 118, 110, 0.06) 0%, rgba(0, 0, 0, 0) 60%),
        #000000;
      position: relative;
    }
    .kovix-welcome__hero {
      grid-row: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      padding-bottom: 24px;
      text-align: center;
    }
    .kovix-welcome__mark {
      width: 128px; height: 128px;
      filter: drop-shadow(0 0 32px rgba(20, 184, 166, 0.55));
      animation: kovix-welcome-pulse 1600ms cubic-bezier(0.4, 0, 0.2, 1) 1 both;
    }
    .kovix-welcome__mark svg { width: 100%; height: 100%; display: block; }
    .kovix-welcome__wordmark {
      font-size: 32px; font-weight: 700;
      letter-spacing: 0.42em;
      color: #FFFFFF; margin-top: 8px;
    }
    .kovix-welcome__wordmark-accent { color: #2DD4BF; }
    .kovix-welcome__tagline {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.55);
      letter-spacing: 0.04em;
      margin-top: 4px;
    }
    .kovix-welcome__ctas {
      display: flex; flex-direction: row; gap: 12px;
      margin-top: 28px; flex-wrap: wrap; justify-content: center;
    }
    .kovix-welcome__cta {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 10px 18px;
      background: rgba(255, 255, 255, 0.04);
      color: #E6EDF3;
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 8px;
      font-family: inherit; font-size: 13px; font-weight: 500;
      cursor: pointer;
      transition: all 180ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .kovix-welcome__cta:hover {
      background: rgba(20, 184, 166, 0.10);
      border-color: rgba(20, 184, 166, 0.40);
      color: #FFFFFF;
    }
    .kovix-welcome__cta--primary {
      background: linear-gradient(135deg, #14B8A6 0%, #0F766E 100%);
      color: #FFFFFF;
      border: 1px solid transparent;
      box-shadow: 0 4px 16px rgba(20, 184, 166, 0.30);
    }
    .kovix-welcome__cta--primary:hover {
      background: linear-gradient(135deg, #2DD4BF 0%, #14B8A6 100%);
      box-shadow: 0 6px 20px rgba(20, 184, 166, 0.45);
      color: #FFFFFF;
    }
    .kovix-welcome__cta--ghost {
      background: transparent;
      color: #9DA7B0;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .kovix-welcome__cta-arrow { font-size: 14px; transition: transform 180ms ease; }
    .kovix-welcome__cta:hover .kovix-welcome__cta-arrow { transform: translateX(2px); }
    .kovix-welcome__features {
      grid-row: 2;
      display: grid;
      grid-template-columns: repeat(3, minmax(220px, 280px));
      gap: 16px; justify-content: center;
      max-width: 1100px; margin: 0 auto; width: 100%;
    }
    .kovix-welcome__feature {
      padding: 20px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      transition: border-color 200ms ease, background 200ms ease;
    }
    .kovix-welcome__feature:hover {
      background: rgba(20, 184, 166, 0.04);
      border-color: rgba(20, 184, 166, 0.20);
    }
    .kovix-welcome__feature-icon {
      width: 32px; height: 32px;
      display: grid; place-items: center;
      font-size: 18px;
      color: #2DD4BF;
      margin-bottom: 12px;
      background: rgba(20, 184, 166, 0.10);
      border-radius: 8px;
    }
    .kovix-welcome__feature-icon--swarm   { color: #2DD4BF; }
    .kovix-welcome__feature-icon--memory  { color: #3FB950; }
    .kovix-welcome__feature-icon--skills  { color: #58A6FF; }
    .kovix-welcome__feature-title {
      font-size: 14px; font-weight: 600;
      color: #FFFFFF; margin-bottom: 6px;
      letter-spacing: 0.02em;
    }
    .kovix-welcome__feature-body {
      font-size: 12px; line-height: 1.5;
      color: #9DA7B0;
    }
    .kovix-welcome__skip {
      position: absolute;
      bottom: 20px; right: 24px;
      background: transparent; border: none;
      color: rgba(255, 255, 255, 0.40);
      font-family: inherit; font-size: 12px;
      cursor: pointer; padding: 4px 8px;
      transition: color 180ms ease;
    }
    .kovix-welcome__skip:hover { color: rgba(255, 255, 255, 0.80); }
    @keyframes kovix-welcome-pulse {
      0%   { transform: scale(0.92); opacity: 0; }
      35%  { transform: scale(1.04); opacity: 1; }
      100% { transform: scale(1.00); opacity: 1; }
    }
    @media (max-width: 760px) {
      .kovix-welcome__features { grid-template-columns: 1fr; }
    }
  </style>

  <script nonce="${nonce}">
    // Wire CTA buttons to postMessage back to the host.
    document.querySelectorAll('[data-cta]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cta = btn.getAttribute('data-cta');
        var messageType = ({
          'new-project': 'cta-new-project',
          'open-folder': 'cta-open-folder',
          'tour':        'cta-tour',
          'skip':        'cta-skip'
        })[cta];
        if (messageType) {
          // The host's webview.onMessage handler picks this up.
          window.parent.postMessage({ type: messageType }, '*');
        }
      });
    });
  </script>
</body>
</html>`;
  }
}

/**
 * Workbench contribution that opens the Kovix welcome webview on first
 * launch. Registered at LifecyclePhase.Restored so the workbench DOM is
 * ready. Also exposes the welcome screen via the `kovix.welcome.open`
 * command so the K-logo in the activity bar can re-open it on demand.
 */
export class KovixWelcomeContribution extends Disposable implements IWorkbenchContribution {
  static readonly ID = 'workbench.contrib.kovixWelcome';

  constructor(
    @IInstantiationService private readonly instantiationService: IInstantiationService,
    @IStorageService private readonly storageService: IStorageService,
    @IConfigurationService private readonly configurationService: IConfigurationService,
    @ILogService private readonly logService: ILogService,
  ) {
    super();

    // Respect a config escape hatch — useful for automation / headless setups.
    const welcomeEnabled = this.configurationService.getValue<boolean>('kovix.welcome.enabled') ?? true;
    if (!welcomeEnabled) { return; }

    const seen = KovixWelcomeView.hasSeenFirstLaunch(this.storageService);
    if (seen) { return; }

    // Defer one tick so the workbench layout has settled and the default
    // editor (if any) has resolved — we want to REPLACE it, not stack.
    setTimeout(() => this.openWelcome(), 350);
  }

  private openWelcome(): void {
    try {
      const view = this.instantiationService.createInstance(KovixWelcomeView);
      view.show();
      this.logService.info('[Kovix] Welcome screen opened for first launch.');
    } catch (err) {
      this.logService.error('[Kovix] Failed to open welcome screen:', err);
    }
  }
}
