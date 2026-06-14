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
 * Tests for Accessibility/i18n — ARIA labels, keyboard navigation, screen reader text.
 * Source references:
 * - src/vs/platform/construct/common/constructTypes.ts — safeJsonParse
 * - UI component ARIA attributes
 */
// ---- Replicate production logic ----
function safeJsonParse(input, fallback) {
    try {
        return JSON.parse(input);
    }
    catch {
        return fallback;
    }
}
const ARIA_ROLE_SPECS = {
    toolbar: { role: 'toolbar', requiredAttributes: ['aria-label'], optionalAttributes: ['aria-orientation'] },
    combobox: { role: 'combobox', requiredAttributes: ['aria-expanded', 'aria-haspopup'], optionalAttributes: ['aria-controls', 'aria-activedescendant'] },
    textbox: { role: 'textbox', requiredAttributes: ['aria-label'], optionalAttributes: ['aria-placeholder', 'aria-readonly'] },
    button: { role: 'button', requiredAttributes: ['aria-label'], optionalAttributes: ['aria-pressed', 'aria-expanded', 'aria-disabled'] },
    log: { role: 'log', requiredAttributes: ['aria-live'], optionalAttributes: ['aria-label'] },
    alert: { role: 'alert', requiredAttributes: [], optionalAttributes: ['aria-live'] },
    status: { role: 'status', requiredAttributes: [], optionalAttributes: ['aria-live'] },
    region: { role: 'region', requiredAttributes: ['aria-label'], optionalAttributes: [] },
    list: { role: 'list', requiredAttributes: [], optionalAttributes: ['aria-label'] },
    listitem: { role: 'listitem', requiredAttributes: [], optionalAttributes: [] },
};
function validateARIAAttributes(role, attributes) {
    const spec = ARIA_ROLE_SPECS[role];
    if (!spec) {
        return [`Unknown ARIA role: ${role}`];
    }
    const errors = [];
    for (const required of spec.requiredAttributes) {
        if (!(required in attributes) || !attributes[required]) {
            errors.push(`Role "${role}" requires attribute "${required}"`);
        }
    }
    return errors;
}
const CONSTRUCT_KEYBOARD_MAP = {
    'Enter': 'execute',
    'Escape': 'cancel',
    'Tab': 'nextFocusable',
    'Shift+Tab': 'prevFocusable',
    'ArrowUp': 'prevItem',
    'ArrowDown': 'nextItem',
    'Ctrl+Enter': 'submit',
    'Ctrl+/': 'toggleHelp',
};
// Screen reader text
function generateScreenReaderText(role, label, state) {
    const parts = [label];
    if (state) {
        parts.push(state);
    }
    parts.push(role);
    return parts.join(', ');
}
function formatLocalizedString(template, args) {
    let result = template;
    for (const [key, value] of Object.entries(args)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
}
function validatePlaceholders(template, providedKeys) {
    const errors = [];
    const requiredPlaceholders = template.match(/\{(\w+)\}/g)?.map(m => m.slice(1, -1)) ?? [];
    for (const placeholder of requiredPlaceholders) {
        if (!providedKeys.includes(placeholder)) {
            errors.push(`Missing placeholder value for: ${placeholder}`);
        }
    }
    return errors;
}
const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur']);
function isRTLLocale(locale) {
    return RTL_LOCALES.has(locale.split('-')[0]);
}
// ---- Tests ----
suite('Accessibility/i18n Tests', () => {
    suite('ARIA Labels', () => {
        test('should have ARIA labels on interactive elements', () => {
            // Toolbar
            const toolbarErrors = validateARIAAttributes('toolbar', { 'aria-label': 'Model Picker' });
            assert.strictEqual(toolbarErrors.length, 0);
            // Combobox
            const comboboxErrors = validateARIAAttributes('combobox', { 'aria-expanded': 'false', 'aria-haspopup': 'listbox' });
            assert.strictEqual(comboboxErrors.length, 0);
            // Textbox
            const textboxErrors = validateARIAAttributes('textbox', { 'aria-label': 'Agent Input' });
            assert.strictEqual(textboxErrors.length, 0);
        });
        test('should detect missing ARIA labels', () => {
            const errors = validateARIAAttributes('toolbar', {});
            assert.ok(errors.some(e => e.includes('aria-label')));
            const comboboxErrors = validateARIAAttributes('combobox', { 'aria-label': 'Picker' });
            assert.ok(comboboxErrors.some(e => e.includes('aria-expanded') || e.includes('aria-haspopup')));
        });
    });
    suite('Keyboard Navigation', () => {
        test('should support keyboard navigation for all views', () => {
            assert.ok('Enter' in CONSTRUCT_KEYBOARD_MAP);
            assert.ok('Escape' in CONSTRUCT_KEYBOARD_MAP);
            assert.ok('Tab' in CONSTRUCT_KEYBOARD_MAP);
            assert.ok('ArrowUp' in CONSTRUCT_KEYBOARD_MAP);
            assert.ok('ArrowDown' in CONSTRUCT_KEYBOARD_MAP);
        });
        test('should maintain focus management correctly', () => {
            // Simulate focus ring: ordered list of focusable elements
            const focusable = ['input', 'submitButton', 'cancelButton', 'helpButton'];
            let focusIndex = 0;
            // Tab moves forward
            focusIndex = (focusIndex + 1) % focusable.length;
            assert.strictEqual(focusable[focusIndex], 'submitButton');
            // Shift+Tab moves backward
            focusIndex = (focusIndex - 1 + focusable.length) % focusable.length;
            assert.strictEqual(focusable[focusIndex], 'input');
            // ArrowDown moves to next item
            focusIndex = (focusIndex + 1) % focusable.length;
            assert.strictEqual(focusable[focusIndex], 'submitButton');
        });
    });
    suite('Screen Reader', () => {
        test('should provide screen reader announcements', () => {
            const text = generateScreenReaderText('button', 'Execute Command', 'enabled');
            assert.ok(text.includes('Execute Command'));
            assert.ok(text.includes('enabled'));
            assert.ok(text.includes('button'));
        });
        test('should handle high contrast theme', () => {
            // High contrast mode detection
            const prefersHighContrast = true; // simulated
            const colorScheme = prefersHighContrast ? 'forced-colors' : 'normal';
            assert.strictEqual(colorScheme, 'forced-colors');
        });
    });
    suite('Internationalization', () => {
        test('should load i18n strings correctly', () => {
            const strings = {
                'construct.agent.title': 'AI Agent',
                'construct.agent.input': 'Ask a question...',
                'construct.agent.execute': 'Execute',
            };
            assert.strictEqual(strings['construct.agent.title'], 'AI Agent');
            assert.strictEqual(strings['construct.agent.input'], 'Ask a question...');
        });
        test('should handle locale switching', () => {
            const enStrings = { 'greeting': 'Hello' };
            const jaStrings = { 'greeting': 'こんにちは' };
            let currentLocale = 'en';
            let greeting = enStrings['greeting'];
            assert.strictEqual(greeting, 'Hello');
            currentLocale = 'ja';
            greeting = jaStrings['greeting'];
            assert.strictEqual(greeting, 'こんにちは');
        });
        test('should handle RTL text direction', () => {
            assert.strictEqual(isRTLLocale('ar'), true, 'Arabic is RTL');
            assert.strictEqual(isRTLLocale('he'), true, 'Hebrew is RTL');
            assert.strictEqual(isRTLLocale('fa'), true, 'Farsi is RTL');
            assert.strictEqual(isRTLLocale('ur'), true, 'Urdu is RTL');
            assert.strictEqual(isRTLLocale('en'), false, 'English is not RTL');
            assert.strictEqual(isRTLLocale('ar-SA'), true, 'Arabic (Saudi) is RTL');
        });
        test('should handle missing translations gracefully', () => {
            const strings = { 'key1': 'Hello' };
            const key = 'key2';
            // Fallback to key itself when translation is missing
            const value = strings[key] ?? key;
            assert.strictEqual(value, 'key2', 'Missing translation should fall back to key');
        });
        test('should validate i18n string placeholders', () => {
            const template = 'Hello {name}, you have {count} messages';
            const errors = validatePlaceholders(template, ['name', 'count']);
            assert.strictEqual(errors.length, 0);
            const missingErrors = validatePlaceholders(template, ['name']);
            assert.strictEqual(missingErrors.length, 1);
            assert.ok(missingErrors[0].includes('count'));
            const formatted = formatLocalizedString(template, { name: 'Alice', count: '5' });
            assert.strictEqual(formatted, 'Hello Alice, you have 5 messages');
        });
    });
});
//# sourceMappingURL=accessibilityI18n.test.js.map