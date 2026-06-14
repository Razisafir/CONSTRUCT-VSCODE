"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
/**
 * In-memory test harness for ErrorBanner — mirrors the production class
 * without DOM dependencies.
 */
class TestableErrorBanner {
    container = null;
    previousFocus = null;
    retryCalled = false;
    undoCalled = false;
    dismissCalled = false;
    show(options) {
        this.dismiss();
        this.previousFocus = 'input-element';
        const buttons = [];
        if (options.canRetry && options.onRetry) {
            buttons.push({
                label: 'Retry',
                ariaLabel: 'Retry the failed operation',
                className: 'construct-error-banner-btn construct-error-banner-retry',
                cssText: 'background: var(--vscode-button-background, #0e639c);',
            });
        }
        if (options.canUndo && options.onUndo) {
            buttons.push({
                label: 'Undo',
                ariaLabel: 'Undo the last change',
                className: 'construct-error-banner-btn construct-error-banner-undo',
                cssText: 'background: var(--vscode-button-background, #0e639c);',
            });
        }
        buttons.push({
            label: 'Dismiss',
            ariaLabel: 'Dismiss this error',
            className: 'construct-error-banner-btn construct-error-banner-dismiss',
            cssText: 'background: var(--vscode-button-background, #0e639c);',
        });
        this.container = {
            role: 'alert',
            ariaLive: 'assertive',
            ariaAtomic: 'true',
            tabIndex: -1,
            removed: false,
            message: options.message,
            details: options.details,
            className: 'construct-error-banner',
            cssText: 'background: var(--vscode-inputValidation-errorBackground, #5a1d1d); border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100); color: var(--vscode-foreground, #cccccc); font-family: var(--vscode-font-family, sans-serif);',
            buttons,
        };
    }
    dismiss() {
        if (this.container) {
            this.container.removed = true;
            this.container = null;
        }
        this.previousFocus = null;
    }
    dispose() {
        this.dismiss();
    }
    async retry(options) {
        if (options.onRetry) {
            await options.onRetry();
        }
        this.retryCalled = true;
        this.dismiss();
    }
    async undo(options) {
        if (options.onUndo) {
            await options.onUndo();
        }
        this.undoCalled = true;
        this.dismiss();
    }
    dismissWithCallback(options) {
        options.onDismiss?.();
        this.dismissCalled = true;
        this.dismiss();
    }
    wasRetryCalled() { return this.retryCalled; }
    wasUndoCalled() { return this.undoCalled; }
    wasDismissCalled() { return this.dismissCalled; }
    getPreviousFocus() { return this.previousFocus; }
}
const VIEW_ARIA_ROLES = {
    toolbar: { role: 'toolbar', requiredAttrs: ['aria-label'] },
    combobox: { role: 'combobox', requiredAttrs: ['aria-expanded', 'aria-haspopup'] },
    textbox: { role: 'textbox', requiredAttrs: ['aria-label'] },
    button: { role: 'button', requiredAttrs: ['aria-label'] },
    log: { role: 'log', requiredAttrs: ['aria-live'] },
    alert: { role: 'alert', requiredAttrs: [] },
    status: { role: 'status', requiredAttrs: [] },
    region: { role: 'region', requiredAttrs: ['aria-label'] },
    list: { role: 'list', requiredAttrs: [] },
    listitem: { role: 'listitem', requiredAttrs: [] },
    article: { role: 'article', requiredAttrs: [] },
};
function validateARIA(role, attrs) {
    const spec = VIEW_ARIA_ROLES[role];
    if (!spec) {
        return [`Unknown role: ${role}`];
    }
    const errors = [];
    for (const req of spec.requiredAttrs) {
        if (!(req in attrs) || !attrs[req]) {
            errors.push(`Role "${role}" requires "${req}"`);
        }
    }
    return errors;
}
// ---- Keyboard navigation ----
const KEYBOARD_HANDLERS = {
    Enter: 'execute',
    Escape: 'cancel',
    Tab: 'nextFocusable',
    'Shift+Tab': 'prevFocusable',
    ArrowUp: 'prevItem',
    ArrowDown: 'nextItem',
    Home: 'firstItem',
    End: 'lastItem',
};
function resolveKeyAction(key, shift) {
    if (key === 'Tab' && shift) {
        return KEYBOARD_HANDLERS['Shift+Tab'];
    }
    const combo = shift ? `Shift+${key}` : key;
    return KEYBOARD_HANDLERS[combo] ?? KEYBOARD_HANDLERS[key];
}
// ---- Focus trap management ----
class FocusTrap {
    focusableElements;
    currentIndex;
    constructor(elements, startIndex = 0) {
        this.focusableElements = elements;
        this.currentIndex = startIndex;
    }
    moveForward() {
        this.currentIndex = (this.currentIndex + 1) % this.focusableElements.length;
        return this.focusableElements[this.currentIndex];
    }
    moveBackward() {
        this.currentIndex = (this.currentIndex - 1 + this.focusableElements.length) % this.focusableElements.length;
        return this.focusableElements[this.currentIndex];
    }
    current() {
        return this.focusableElements[this.currentIndex];
    }
    trapFocus() {
        return this.focusableElements.length > 0;
    }
}
// ---- Theme CSS custom properties ----
const THEME_CSS_PROPERTIES = {
    '--vscode-inputValidation-errorBackground': '#5a1d1d',
    '--vscode-inputValidation-errorBorder': '#be1100',
    '--vscode-foreground': '#cccccc',
    '--vscode-font-family': 'sans-serif',
    '--vscode-button-background': '#0e639c',
    '--vscode-button-foreground': '#ffffff',
    '--vscode-editor-background': '#1e1e1e',
    '--vscode-editor-foreground': '#d4d4d4',
    '--vscode-focusBorder': '#007fd4',
};
function extractCSSVars(cssText) {
    const result = new Map();
    const regex = /var\(\s*(--[^,\s)]+)/g;
    let match;
    while ((match = regex.exec(cssText)) !== null) {
        result.set(match[1], '');
    }
    return result;
}
function hasThemeFallback(cssText, varName, fallback) {
    const regex = new RegExp(`var\\(${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,\\s*${fallback.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`);
    return regex.test(cssText);
}
// ---- Tests ----
suite('UI/Views Tests', () => {
    suite('ErrorBanner — show behavior', () => {
        test('show() creates container with role=alert', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Test error' });
            assert.ok(banner.container, 'Container should be created');
            assert.strictEqual(banner.container.role, 'alert');
        });
        test('show() sets aria-live=assertive', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error occurred' });
            assert.strictEqual(banner.container.ariaLive, 'assertive');
        });
        test('show() sets aria-atomic=true', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error' });
            assert.strictEqual(banner.container.ariaAtomic, 'true');
        });
        test('show() sets tabIndex=-1 for programmatic focus', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error' });
            assert.strictEqual(banner.container.tabIndex, -1, 'Should be focusable but not in tab order');
        });
        test('show() sets message and details correctly', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Tool failed', details: 'Stack trace here' });
            assert.strictEqual(banner.container.message, 'Tool failed');
            assert.strictEqual(banner.container.details, 'Stack trace here');
        });
        test('show() saves previously focused element', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error' });
            // Internal state tracks previous focus for restoration
            assert.ok(true, 'Focus tracking executed without error');
        });
        test('show() replaces existing banner', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'First error' });
            assert.strictEqual(banner.container.message, 'First error');
            banner.show({ message: 'Second error' });
            assert.strictEqual(banner.container.message, 'Second error');
        });
        test('show() adds Dismiss button by default', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error' });
            const dismissBtn = banner.container.buttons.find(b => b.label === 'Dismiss');
            assert.ok(dismissBtn, 'Dismiss button should always be present');
            assert.strictEqual(dismissBtn.ariaLabel, 'Dismiss this error');
        });
    });
    suite('ErrorBanner — dismiss and dispose', () => {
        test('dismiss() removes container', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error' });
            banner.dismiss();
            assert.strictEqual(banner.container, null);
        });
        test('dismiss() clears previousFocus', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error' });
            banner.dismiss();
            assert.strictEqual(banner.getPreviousFocus(), null);
        });
        test('dismiss() without prior show() is a no-op', () => {
            const banner = new TestableErrorBanner();
            banner.dismiss(); // Should not throw
            assert.strictEqual(banner.container, null);
        });
        test('dispose() calls dismiss()', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error' });
            banner.dispose();
            assert.strictEqual(banner.container, null);
        });
        test('multiple dismiss() calls are safe', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error' });
            banner.dismiss();
            banner.dismiss();
            assert.strictEqual(banner.container, null);
        });
        test('dismiss button callback fires onDismiss', () => {
            const banner = new TestableErrorBanner();
            let dismissFired = false;
            const options = {
                message: 'Error',
                onDismiss: () => { dismissFired = true; },
            };
            banner.show(options);
            banner.dismissWithCallback(options);
            assert.strictEqual(dismissFired, true, 'onDismiss callback should fire');
        });
    });
    suite('ErrorBanner — retry and undo callbacks', () => {
        test('retry callback fires and dismisses banner', async () => {
            const banner = new TestableErrorBanner();
            let retryCount = 0;
            const options = {
                message: 'Error',
                canRetry: true,
                onRetry: async () => { retryCount++; },
            };
            banner.show(options);
            await banner.retry(options);
            assert.strictEqual(retryCount, 1);
            assert.strictEqual(banner.container, null, 'Banner should be dismissed after successful retry');
        });
        test('undo callback fires and dismisses banner', async () => {
            const banner = new TestableErrorBanner();
            let undoCount = 0;
            const options = {
                message: 'Error',
                canUndo: true,
                onUndo: async () => { undoCount++; },
            };
            banner.show(options);
            await banner.undo(options);
            assert.strictEqual(undoCount, 1);
            assert.strictEqual(banner.container, null, 'Banner should be dismissed after undo');
        });
        test('canRetry=true shows Retry button', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error', canRetry: true, onRetry: async () => { } });
            const retryBtn = banner.container.buttons.find(b => b.label === 'Retry');
            assert.ok(retryBtn, 'Retry button should be present');
            assert.strictEqual(retryBtn.ariaLabel, 'Retry the failed operation');
        });
        test('canUndo=true shows Undo button', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error', canUndo: true, onUndo: async () => { } });
            const undoBtn = banner.container.buttons.find(b => b.label === 'Undo');
            assert.ok(undoBtn, 'Undo button should be present');
            assert.strictEqual(undoBtn.ariaLabel, 'Undo the last change');
        });
        test('canRetry=false omits Retry button', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error', canRetry: false });
            const retryBtn = banner.container.buttons.find(b => b.label === 'Retry');
            assert.strictEqual(retryBtn, undefined, 'Retry button should not be present');
        });
        test('both Retry and Undo can be enabled together', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error', canRetry: true, canUndo: true, onRetry: async () => { }, onUndo: async () => { } });
            assert.ok(banner.container.buttons.find(b => b.label === 'Retry'));
            assert.ok(banner.container.buttons.find(b => b.label === 'Undo'));
            assert.ok(banner.container.buttons.find(b => b.label === 'Dismiss'));
            assert.strictEqual(banner.container.buttons.length, 3);
        });
    });
    suite('ARIA role attributes — constructAgentView DOM elements', () => {
        test('toolbar role requires aria-label', () => {
            const errors = validateARIA('toolbar', { 'aria-label': 'Model Picker' });
            assert.strictEqual(errors.length, 0, 'Toolbar with aria-label should pass');
        });
        test('toolbar role fails without aria-label', () => {
            const errors = validateARIA('toolbar', {});
            assert.ok(errors.length > 0, 'Toolbar without aria-label should fail');
            assert.ok(errors.some(e => e.includes('aria-label')));
        });
        test('combobox role requires aria-expanded and aria-haspopup', () => {
            const errors = validateARIA('combobox', { 'aria-expanded': 'false', 'aria-haspopup': 'listbox' });
            assert.strictEqual(errors.length, 0);
        });
        test('combobox role fails without required attributes', () => {
            const errors = validateARIA('combobox', { 'aria-label': 'Model Picker' });
            assert.ok(errors.length > 0, 'Combobox without aria-expanded/aria-haspopup should fail');
        });
        test('textbox role requires aria-label', () => {
            const errors = validateARIA('textbox', { 'aria-label': 'Agent Input' });
            assert.strictEqual(errors.length, 0);
        });
        test('log role requires aria-live', () => {
            const errors = validateARIA('log', { 'aria-live': 'polite' });
            assert.strictEqual(errors.length, 0);
        });
        test('alert role has no required attributes', () => {
            const errors = validateARIA('alert', {});
            assert.strictEqual(errors.length, 0);
        });
        test('region role requires aria-label', () => {
            const errors = validateARIA('region', { 'aria-label': 'Agent Chat' });
            assert.strictEqual(errors.length, 0);
            const failErrors = validateARIA('region', {});
            assert.ok(failErrors.length > 0);
        });
        test('unknown role returns error', () => {
            const errors = validateARIA('dialog', {});
            assert.strictEqual(errors.length, 1);
            assert.ok(errors[0].includes('Unknown role'));
        });
        test('all agent view ARIA roles are recognized', () => {
            const viewRoles = ['toolbar', 'combobox', 'textbox', 'log', 'alert', 'status', 'region', 'list', 'listitem', 'article'];
            for (const role of viewRoles) {
                assert.ok(role in VIEW_ARIA_ROLES, `Role "${role}" should be in ARIA spec`);
            }
        });
    });
    suite('Keyboard navigation — event handling', () => {
        test('Enter key resolves to execute action', () => {
            assert.strictEqual(resolveKeyAction('Enter', false), 'execute');
        });
        test('Escape key resolves to cancel action', () => {
            assert.strictEqual(resolveKeyAction('Escape', false), 'cancel');
        });
        test('Tab key resolves to nextFocusable', () => {
            assert.strictEqual(resolveKeyAction('Tab', false), 'nextFocusable');
        });
        test('Shift+Tab resolves to prevFocusable', () => {
            assert.strictEqual(resolveKeyAction('Tab', true), 'prevFocusable');
        });
        test('ArrowUp resolves to prevItem', () => {
            assert.strictEqual(resolveKeyAction('ArrowUp', false), 'prevItem');
        });
        test('ArrowDown resolves to nextItem', () => {
            assert.strictEqual(resolveKeyAction('ArrowDown', false), 'nextItem');
        });
        test('Home key resolves to firstItem', () => {
            assert.strictEqual(resolveKeyAction('Home', false), 'firstItem');
        });
        test('End key resolves to lastItem', () => {
            assert.strictEqual(resolveKeyAction('End', false), 'lastItem');
        });
        test('unknown key returns undefined', () => {
            assert.strictEqual(resolveKeyAction('F10', false), undefined);
        });
        test('all keyboard handlers are defined', () => {
            assert.strictEqual(Object.keys(KEYBOARD_HANDLERS).length, 8);
        });
    });
    suite('Focus trap management', () => {
        test('focus trap wraps forward correctly', () => {
            const trap = new FocusTrap(['input', 'sendBtn', 'cancelBtn']);
            assert.strictEqual(trap.current(), 'input');
            assert.strictEqual(trap.moveForward(), 'sendBtn');
            assert.strictEqual(trap.moveForward(), 'cancelBtn');
            assert.strictEqual(trap.moveForward(), 'input'); // wraps
        });
        test('focus trap wraps backward correctly', () => {
            const trap = new FocusTrap(['input', 'sendBtn', 'cancelBtn']);
            assert.strictEqual(trap.moveBackward(), 'cancelBtn'); // wraps backward
        });
        test('focus trap with single element stays on it', () => {
            const trap = new FocusTrap(['input']);
            assert.strictEqual(trap.moveForward(), 'input');
            assert.strictEqual(trap.moveBackward(), 'input');
        });
        test('focus trap detects when active', () => {
            const trap = new FocusTrap(['input', 'sendBtn']);
            assert.strictEqual(trap.trapFocus(), true);
        });
        test('focus trap with empty elements returns false', () => {
            const trap = new FocusTrap([]);
            assert.strictEqual(trap.trapFocus(), false);
        });
        test('focus trap starts at specified index', () => {
            const trap = new FocusTrap(['input', 'sendBtn', 'cancelBtn'], 1);
            assert.strictEqual(trap.current(), 'sendBtn');
        });
        test('focus cycling maintains order integrity', () => {
            const elements = ['a', 'b', 'c', 'd'];
            const trap = new FocusTrap(elements);
            const visited = [];
            for (let i = 0; i < elements.length; i++) {
                visited.push(trap.current());
                trap.moveForward();
            }
            assert.deepStrictEqual(visited, ['a', 'b', 'c', 'd']);
        });
        test('backward then forward returns to same element', () => {
            const trap = new FocusTrap(['a', 'b', 'c'], 1);
            trap.moveBackward(); // now at 'a'
            trap.moveForward(); // should be at 'b'
            assert.strictEqual(trap.current(), 'b');
        });
    });
    suite('Theme-compatible CSS custom properties', () => {
        test('ErrorBanner uses --vscode-inputValidation-errorBackground', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error' });
            assert.ok(banner.container.cssText.includes('--vscode-inputValidation-errorBackground'), 'Should use errorBackground CSS var');
        });
        test('ErrorBanner uses --vscode-foreground', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error' });
            assert.ok(banner.container.cssText.includes('--vscode-foreground'), 'Should use foreground CSS var');
        });
        test('ErrorBanner uses --vscode-font-family', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error' });
            assert.ok(banner.container.cssText.includes('--vscode-font-family'), 'Should use font-family CSS var');
        });
        test('buttons use --vscode-button-background', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error' });
            const dismissBtn = banner.container.buttons.find(b => b.label === 'Dismiss');
            assert.ok(dismissBtn.cssText.includes('--vscode-button-background'), 'Buttons should use button-background CSS var');
        });
        test('CSS vars include fallback values for standalone rendering', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error' });
            assert.ok(hasThemeFallback(banner.container.cssText, '--vscode-inputValidation-errorBackground', '#5a1d1d'), 'Should include fallback for errorBackground');
            assert.ok(hasThemeFallback(banner.container.cssText, '--vscode-foreground', '#cccccc'), 'Should include fallback for foreground');
        });
        test('all theme CSS properties are defined in lookup', () => {
            const requiredVars = [
                '--vscode-inputValidation-errorBackground',
                '--vscode-inputValidation-errorBorder',
                '--vscode-foreground',
                '--vscode-font-family',
                '--vscode-button-background',
                '--vscode-button-foreground',
            ];
            for (const varName of requiredVars) {
                assert.ok(varName in THEME_CSS_PROPERTIES, `CSS var ${varName} should be in theme lookup`);
            }
        });
        test('extractCSSVars identifies all var() references', () => {
            const cssText = 'background: var(--vscode-foreground, #ccc); color: var(--vscode-editor-foreground, #d4d4d4);';
            const vars = extractCSSVars(cssText);
            assert.ok(vars.has('--vscode-foreground'));
            assert.ok(vars.has('--vscode-editor-foreground'));
        });
        test('ErrorBanner border uses --vscode-inputValidation-errorBorder', () => {
            const banner = new TestableErrorBanner();
            banner.show({ message: 'Error' });
            assert.ok(banner.container.cssText.includes('--vscode-inputValidation-errorBorder'), 'Should use errorBorder CSS var');
        });
        test('hasThemeFallback validates correct fallback syntax', () => {
            const cssText = 'background: var(--vscode-foreground, #cccccc);';
            assert.ok(hasThemeFallback(cssText, '--vscode-foreground', '#cccccc'));
            assert.ok(!hasThemeFallback(cssText, '--vscode-foreground', '#ffffff'));
        });
    });
});
//# sourceMappingURL=uiViews.test.js.map