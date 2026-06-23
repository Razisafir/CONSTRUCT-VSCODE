/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See LICENSE.txt for proprietary license terms.

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IKovixProject, IProjectCreationInput, IProjectSummary, ProjectStatus } from './constructProjectTypes.js';

export const IConstructProjectService = createDecorator<IConstructProjectService>('kovix.projectService');

/**
 * Service for managing KOVIX projects in the Construct agent system.
 * Handles CRUD for projects, scaffolding from templates, and global project registry.
 */
export interface IConstructProjectService {
	readonly _serviceBrand: undefined;

	/** Event fired when a project is created. */
	readonly onDidCreateProject: Event<IKovixProject>;
	/** Event fired when a project is deleted. */
	readonly onDidDeleteProject: Event<string>;
	/** Event fired when a project's status changes. */
	readonly onDidChangeProjectStatus: Event<{ id: string; status: ProjectStatus }>;

	/** The currently active project, if any. */
	readonly activeProject: IKovixProject | null;

	/** All projects in the global registry. */
	readonly projects: ReadonlyArray<IProjectSummary>;

	/**
	 * Create a new project from the given input.
	 * Scaffolds the workspace directory structure based on the template,
	 * writes a `.construct/project.json` manifest, and registers the project.
	 */
	createProject(input: IProjectCreationInput): Promise<IKovixProject>;

	/**
	 * Delete a project by ID.
	 * Optionally removes the workspace files.
	 */
	deleteProject(id: string, removeFiles?: boolean): Promise<void>;

	/**
	 * Load an existing project into the active session.
	 */
	loadProject(id: string): Promise<IKovixProject>;

	/**
	 * Update a project's status.
	 */
	updateProjectStatus(id: string, status: ProjectStatus): Promise<void>;

	/**
	 * Get a project by its ID.
	 */
	getProject(id: string): IKovixProject | undefined;

	/**
	 * Set the active project for the current workspace.
	 */
	setActiveProject(id: string): void;

	/**
	 * Detect if the current workspace has a .construct/project.json
	 * and auto-load it as the active project.
	 */
	detectAndLoadProject(workspaceRoot: string): Promise<IKovixProject | null>;
}
