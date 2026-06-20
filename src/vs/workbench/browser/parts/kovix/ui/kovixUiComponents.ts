// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Kovix shared UI component library.
 *
 *  Built in Prompt 3 (Phase F) per KOVIX_DESIGN_SYSTEM_FOUNDATION.md.
 *  Consumed by Prompt 4's agent surfaces — every agent panel, plan-approval
 *  UI, milestone status, memory browser, and error state must import from
 *  here rather than rolling its own one-off styles.
 *
 *  Ponytail discipline: only components Prompt 4 will actually consume.
 *  Skipping for now: Tooltip, Modal, Toast (VS Code already provides these
 *  via IHoverService, IDialogService, INotificationService — reusing them
 *  is one line of code, not a custom component).
 *
 *  Every component:
 *    1. Uses CSS classes (not inline styles) so they pick up --kovix-* tokens
 *    2. Lives in kovixUiComponents.css (single stylesheet, loaded once)
 *    3. Has ARIA attributes for accessibility (F-008 fix)
 *    4. Respects prefers-reduced-motion via the --kovix-motion-* tokens
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';

// ─────────────────────────────────────────────────────────────────────────
// Button — primary / secondary / ghost / destructive variants
// ─────────────────────────────────────────────────────────────────────────

export type KovixButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

export interface IKovixButtonOptions {
  /** Button label text. */
  label: string;
  /** Visual variant. Default: 'secondary'. */
  variant?: KovixButtonVariant;
  /** Optional title attribute (tooltip). */
  title?: string;
  /** Optional aria-label (defaults to label if not provided). */
  ariaLabel?: string;
  /** Disabled state. */
  disabled?: boolean;
  /** Click handler. */
  onClick?: () => void;
}

export function createButton(opts: IKovixButtonOptions): HTMLButtonElement {
  const btn = dom.$('button.kovix-btn') as HTMLButtonElement;
  btn.type = 'button';
  btn.className = `kovix-btn kovix-btn--${opts.variant ?? 'secondary'}`;
  btn.textContent = opts.label;
  btn.title = opts.title ?? '';
  btn.setAttribute('aria-label', opts.ariaLabel ?? opts.label);
  if (opts.disabled) {
    btn.disabled = true;
    btn.classList.add('is-disabled');
  }
  if (opts.onClick) {
    btn.addEventListener('click', () => {
      if (!btn.disabled) { opts.onClick!(); }
    });
  }
  return btn;
}

// ─────────────────────────────────────────────────────────────────────────
// Input — text input field
// ─────────────────────────────────────────────────────────────────────────

export interface IKovixInputOptions {
  /** Placeholder text. */
  placeholder?: string;
  /** Initial value. */
  value?: string;
  /** Optional aria-label. */
  ariaLabel?: string;
  /** Disabled state. */
  disabled?: boolean;
  /** Input event handler. */
  onInput?: (value: string) => void;
}

export function createInput(opts: IKovixInputOptions = {}): HTMLInputElement {
  const input = dom.$('input.kovix-input') as HTMLInputElement;
  input.type = 'text';
  if (opts.placeholder) { input.placeholder = opts.placeholder; }
  if (opts.value !== undefined) { input.value = opts.value; }
  if (opts.ariaLabel) { input.setAttribute('aria-label', opts.ariaLabel); }
  if (opts.disabled) { input.disabled = true; }
  if (opts.onInput) {
    input.addEventListener('input', () => opts.onInput!(input.value));
  }
  return input;
}

// ─────────────────────────────────────────────────────────────────────────
// Checkbox — specifically for plan-approval per-task checkboxes
// States: unchecked, checked, indeterminate, disabled
// ─────────────────────────────────────────────────────────────────────────

export interface IKovixCheckboxOptions {
  /** Label text next to the checkbox. */
  label: string;
  /** Initial checked state. */
  checked?: boolean;
  /** Indeterminate state (shows a dash). */
  indeterminate?: boolean;
  /** Disabled state. */
  disabled?: boolean;
  /** Optional aria-label for the input element (accessibility). */
  ariaLabel?: string;
  /** Change handler. */
  onChange?: (checked: boolean) => void;
}

export function createCheckbox(opts: IKovixCheckboxOptions): { container: HTMLElement; input: HTMLInputElement; setChecked: (checked: boolean) => void; setIndeterminate: (indeterminate: boolean) => void } {
  const container = dom.$('.kovix-checkbox');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'kovix-checkbox__input';
  input.checked = !!opts.checked;
  input.indeterminate = !!opts.indeterminate;
  if (opts.disabled) { input.disabled = true; }
  if (opts.ariaLabel) { input.setAttribute('aria-label', opts.ariaLabel); }

  const label = dom.$('label.kovix-checkbox__label');
  label.textContent = opts.label;
  // Make label click toggle the checkbox
  label.addEventListener('click', () => {
    if (!input.disabled) {
      input.checked = !input.checked;
      input.indeterminate = false;
      opts.onChange?.(input.checked);
    }
  });

  container.appendChild(input);
  container.appendChild(label);

  if (opts.onChange) {
    input.addEventListener('change', () => opts.onChange!(input.checked));
  }

  return {
    container,
    input,
    setChecked: (checked: boolean) => { input.checked = checked; },
    setIndeterminate: (indeterminate: boolean) => { input.indeterminate = indeterminate; },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Badge / Tag — small status indicators
// ─────────────────────────────────────────────────────────────────────────

export type KovixBadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'accent';

export interface IKovixBadgeOptions {
  /** Badge text. */
  label: string;
  /** Visual variant. Default: 'default'. */
  variant?: KovixBadgeVariant;
  /** Optional title (tooltip). */
  title?: string;
}

export function createBadge(opts: IKovixBadgeOptions): HTMLElement {
  const badge = dom.$('.kovix-badge');
  badge.className = `kovix-badge kovix-badge--${opts.variant ?? 'default'}`;
  badge.textContent = opts.label;
  badge.title = opts.title ?? '';
  return badge;
}

// ─────────────────────────────────────────────────────────────────────────
// EmptyState — for empty file explorer, no project, agent idle, no memories
// ─────────────────────────────────────────────────────────────────────────

export interface IKovixEmptyStateOptions {
  /** Headline (e.g. "No memories yet"). */
  headline: string;
  /** Body text explaining what will appear here. */
  body?: string;
  /** Optional CTA button label. */
  ctaLabel?: string;
  /** Optional CTA click handler. */
  onCta?: () => void;
}

export function createEmptyState(opts: IKovixEmptyStateOptions): HTMLElement {
  const container = dom.$('.kovix-empty-state');
  const headline = dom.$('.kovix-empty-state__headline');
  headline.textContent = opts.headline;
  container.appendChild(headline);

  if (opts.body) {
    const body = dom.$('.kovix-empty-state__body');
    body.textContent = opts.body;
    container.appendChild(body);
  }

  if (opts.ctaLabel && opts.onCta) {
    const cta = createButton({
      label: opts.ctaLabel,
      variant: 'primary',
      onClick: opts.onCta,
    });
    cta.classList.add('kovix-empty-state__cta');
    container.appendChild(cta);
  }

  return container;
}

// ─────────────────────────────────────────────────────────────────────────
// Skeleton — loading placeholder that reserves space (no layout shift)
// ─────────────────────────────────────────────────────────────────────────

export interface IKovixSkeletonOptions {
  /** Width in px, or '100%' by default. */
  width?: string;
  /** Height in px, or 14px by default. */
  height?: string;
  /** Border radius, or 'sm' by default. */
  radius?: 'sharp' | 'sm' | 'md' | 'lg' | 'pill';
}

export function createSkeleton(opts: IKovixSkeletonOptions = {}): HTMLElement {
  const skeleton = dom.$('.kovix-skeleton');
  skeleton.style.width = opts.width ?? '100%';
  skeleton.style.height = opts.height ?? '14px';
  const radiusMap: Record<string, string> = {
    sharp: 'var(--kovix-radius-sharp)',
    sm: 'var(--kovix-radius-sm)',
    md: 'var(--kovix-radius-md)',
    lg: 'var(--kovix-radius-lg)',
    pill: 'var(--kovix-radius-pill)',
  };
  skeleton.style.borderRadius = radiusMap[opts.radius ?? 'sm'];
  return skeleton;
}

// ─────────────────────────────────────────────────────────────────────────
// ErrorState — for agent failures, API errors, network issues
// Per anti-pattern: must show what failed, what was attempted, what user can do
// ─────────────────────────────────────────────────────────────────────────

export interface IKovixErrorStateOptions {
  /** What failed (e.g. "API key invalid"). */
  title: string;
  /** What was attempted (e.g. "Tried to call NVIDIA NIM with the stored key"). */
  detail?: string;
  /** What the user can do (e.g. "Open Settings → API Keys to update"). */
  recovery?: string;
  /** Optional retry button. */
  onRetry?: () => void;
  /** Optional dismiss handler. */
  onDismiss?: () => void;
}

export function createErrorState(opts: IKovixErrorStateOptions): HTMLElement {
  const container = dom.$('.kovix-error-state');
  container.setAttribute('role', 'alert');
  container.setAttribute('aria-live', 'assertive');

  const title = dom.$('.kovix-error-state__title');
  title.textContent = opts.title;
  container.appendChild(title);

  if (opts.detail) {
    const detail = dom.$('.kovix-error-state__detail');
    detail.textContent = opts.detail;
    container.appendChild(detail);
  }

  if (opts.recovery) {
    const recovery = dom.$('.kovix-error-state__recovery');
    recovery.textContent = opts.recovery;
    container.appendChild(recovery);
  }

  if (opts.onRetry || opts.onDismiss) {
    const actions = dom.$('.kovix-error-state__actions');
    if (opts.onRetry) {
      const retryBtn = createButton({
        label: 'Retry',
        variant: 'primary',
        onClick: opts.onRetry,
      });
      actions.appendChild(retryBtn);
    }
    if (opts.onDismiss) {
      const dismissBtn = createButton({
        label: 'Dismiss',
        variant: 'ghost',
        onClick: opts.onDismiss,
      });
      actions.appendChild(dismissBtn);
    }
    container.appendChild(actions);
  }

  return container;
}
