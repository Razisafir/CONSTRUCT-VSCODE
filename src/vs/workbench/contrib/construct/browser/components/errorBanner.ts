/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { Disposable } from '../../../../../base/common/lifecycle.js';

export interface IErrorBannerOptions {
        message: string;
        details?: string;
        toolName?: string;
        canRetry?: boolean;
        canUndo?: boolean;
        onRetry?: () => Promise<void>;
        onUndo?: () => Promise<void>;
        onDismiss?: () => void;
}

/**
 * ErrorBanner — persistent error state UI component for the Construct Agent view.
 *
 * Displays an error message with optional Retry / Undo / Dismiss actions.
 * Follows WCAG 2.1 AA:
 * - role="alert" for screen reader announcement
 * - aria-live="assertive" for immediate announcement
 * - Focus management: receives focus on show(), restores focus on dismiss()
 * - Keyboard accessible: all buttons are focusable and have aria-labels
 *
 * VS Code theme compatible: uses CSS variables for colors so it adapts
 * to light/dark themes automatically.
 */
export class ErrorBanner extends Disposable {
        private container: HTMLElement | null = null;
        private previousFocusElement: HTMLElement | null = null;
        private readonly parentElement: HTMLElement;

        constructor(parentElement: HTMLElement) {
                super();
                this.parentElement = parentElement;
        }

        show(options: IErrorBannerOptions): void {
                // Dismiss any existing banner first
                this.dismiss();

                // Save the currently focused element for restoration on dismiss
                const activeElement = document.activeElement as HTMLElement;
                if (activeElement && activeElement !== document.body) {
                        this.previousFocusElement = activeElement;
                }

                this.container = document.createElement('div');
                this.container.className = 'construct-error-banner';
                this.container.setAttribute('role', 'alert');
                this.container.setAttribute('aria-live', 'assertive');
                this.container.setAttribute('aria-atomic', 'true');
                this.container.tabIndex = -1; // Focusable but not in tab order

                // Message container
                const msgContainer = document.createElement('div');
                msgContainer.className = 'construct-error-banner-message';
                msgContainer.style.cssText = 'display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0;';

                const messageEl = document.createElement('strong');
                messageEl.className = 'construct-error-banner-title';
                messageEl.textContent = options.message;
                messageEl.style.cssText = 'font-size: 13px; font-weight: 600;';
                msgContainer.appendChild(messageEl);

                if (options.details) {
                        const detailsEl = document.createElement('span');
                        detailsEl.className = 'construct-error-banner-details';
                        detailsEl.textContent = options.details;
                        detailsEl.style.cssText = 'font-size: 12px; opacity: 0.85; word-break: break-word;';
                        msgContainer.appendChild(detailsEl);
                }

                // Actions container
                const actionsContainer = document.createElement('div');
                actionsContainer.className = 'construct-error-banner-actions';
                actionsContainer.style.cssText = 'display: flex; gap: 8px; align-items: center; flex-shrink: 0;';

                if (options.canRetry && options.onRetry) {
                        const retryBtn = document.createElement('button');
                        retryBtn.className = 'construct-error-banner-btn construct-error-banner-retry';
                        retryBtn.textContent = 'Retry';
                        retryBtn.setAttribute('aria-label', 'Retry the failed operation');
                        retryBtn.addEventListener('click', async () => {
                                retryBtn.disabled = true;
                                try {
                                        await options.onRetry?.();
                                        this.dismiss();
                                } catch {
                                        retryBtn.disabled = false;
                                }
                        });
                        actionsContainer.appendChild(retryBtn);
                }

                if (options.canUndo && options.onUndo) {
                        const undoBtn = document.createElement('button');
                        undoBtn.className = 'construct-error-banner-btn construct-error-banner-undo';
                        undoBtn.textContent = 'Undo';
                        undoBtn.setAttribute('aria-label', 'Undo the last change');
                        undoBtn.addEventListener('click', async () => {
                                undoBtn.disabled = true;
                                try {
                                        await options.onUndo?.();
                                        this.dismiss();
                                } catch {
                                        undoBtn.disabled = false;
                                }
                        });
                        actionsContainer.appendChild(undoBtn);
                }

                const dismissBtn = document.createElement('button');
                dismissBtn.className = 'construct-error-banner-btn construct-error-banner-dismiss';
                dismissBtn.textContent = 'Dismiss';
                dismissBtn.setAttribute('aria-label', 'Dismiss this error');
                dismissBtn.addEventListener('click', () => {
                        options.onDismiss?.();
                        this.dismiss();
                });
                actionsContainer.appendChild(dismissBtn);

                this.container.appendChild(msgContainer);
                this.container.appendChild(actionsContainer);

                // Inline styles (VS Code theme-compatible)
                this.container.style.cssText = `
                        background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
                        border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
                        border-radius: 4px;
                        padding: 8px 12px;
                        margin: 8px 0;
                        color: var(--vscode-foreground, #cccccc);
                        font-family: var(--vscode-font-family, sans-serif);
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                `;

                // Button styles
                const buttonStyle = `
                        background: var(--vscode-button-background, #0e639c);
                        color: var(--vscode-button-foreground, #ffffff);
                        border: none;
                        border-radius: 3px;
                        padding: 4px 12px;
                        cursor: pointer;
                        font-size: 12px;
                `;

                for (const btn of actionsContainer.querySelectorAll('button')) {
                        (btn as HTMLElement).style.cssText = buttonStyle;
                }

                this.parentElement.prepend(this.container);

                // Focus the banner for keyboard accessibility
                this.container.focus();
        }

        dismiss(): void {
                if (this.container) {
                        this.container.remove();
                        this.container = null;

                        // Restore focus to the previously focused element
                        if (this.previousFocusElement && this.previousFocusElement.isConnected) {
                                this.previousFocusElement.focus();
                        }
                        this.previousFocusElement = null;
                }
        }

        override dispose(): void {
                this.dismiss();
                super.dispose();
        }
}
