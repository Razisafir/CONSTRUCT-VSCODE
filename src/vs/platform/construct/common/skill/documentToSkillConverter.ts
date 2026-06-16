// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See KOVIX_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { IDocumentToSkillInput, IDocumentToSkillResult, ISkillManifest } from './skillTypes.js';

/**
 * Service decorator for the document-to-skill converter.
 *
 * Resolves to DocumentToSkillConverterService in the browser layer
 * (it uses IConstructAIService to call the LLM).
 */
export const IDocumentToSkillConverter = createDecorator<IDocumentToSkillConverter>('construct.documentToSkillConverter');

/**
 * Document-to-skill converter — takes a Markdown document and uses the
 * LLM to extract a structured skill manifest (name, description, system
 * prompt, allowed tools, triggers, examples).
 *
 * Audit reference: KOVIX-Audit-Report.pdf Section 6.6 — this feature was
 * entirely absent from the codebase before this PR. The audit confirmed
 * zero matches for any of: "skill converter", "document to skill",
 * "skillManifest", "convertDocumentToSkill".
 */
export interface IDocumentToSkillConverter {
        readonly _serviceBrand: undefined;

        /**
         * Convert a document into a skill manifest.
         *
         * @param input The document content + source path + optional name hint.
         * @returns The conversion result (manifest + warnings).
         * @throws Error if the LLM is unavailable or returns unparseable output.
         */
        convert(input: IDocumentToSkillInput): Promise<IDocumentToSkillResult>;

        /**
         * Save a skill manifest to disk at
         * `<workspace>/.kovix/skills/<name>.json`.
         *
         * Creates the `.kovix/skills` directory if it doesn't exist.
         * Validates the manifest before writing.
         *
         * @param manifest The manifest to save.
         * @param workspaceRoot The workspace root path.
         * @returns The absolute path the manifest was written to.
         * @throws Error if validation fails or the file cannot be written.
         */
        saveSkill(manifest: ISkillManifest, workspaceRoot: string): Promise<string>;

        /**
         * List all skill manifests currently saved in
         * `<workspace>/.kovix/skills/*.json`.
         *
         * @param workspaceRoot The workspace root path.
         * @returns Array of parsed manifests. Empty if the directory
         *          doesn't exist or contains no valid JSON files.
         */
        listSkills(workspaceRoot: string): Promise<ISkillManifest[]>;
}
