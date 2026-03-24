import fs from "node:fs/promises";
import path from "node:path";

import { ContextResolutionError } from "./errors.js";

const DEFAULT_PROJECT_LIST_LIMIT = 200;

function isInsideRoot(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRelativePath(filePath) {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    throw new ContextResolutionError(
      "A relative file path is required.",
      "file_path_missing"
    );
  }

  if (path.isAbsolute(filePath) || filePath.split(/[\\/]/).includes("..")) {
    throw new ContextResolutionError(
      `File path "${filePath}" must stay inside the session project root.`,
      "file_path_invalid",
      { filePath }
    );
  }

  return filePath.replace(/\\/g, "/");
}

function compareByName(left, right) {
  return left.name.localeCompare(right.name, undefined, {
    sensitivity: "base",
    numeric: true
  });
}

export class ProjectContextResolver {
  constructor({ projects = {}, allowedRoots = [] } = {}) {
    this.projects = projects;
    this.allowedRoots = [...new Set(allowedRoots.map((rootPath) => path.resolve(rootPath)))];
  }

  resolveProject({ workspaceRef, projectName, launchMode = "background" }) {
    if (!workspaceRef) {
      throw new ContextResolutionError(
        "The -w flag is required and must point to a configured project alias or allowed project root.",
        "workspace_missing"
      );
    }

    const configuredProject = this.projects[workspaceRef];

    if (configuredProject) {
      return {
        workspaceAlias: workspaceRef,
        projectName:
          projectName ?? configuredProject.projectName ?? configuredProject.alias ?? workspaceRef,
        projectRoot: path.resolve(configuredProject.rootPath),
        defaultFile: configuredProject.defaultFile ?? null,
        launchMode
      };
    }

    const resolvedRoot = path.resolve(workspaceRef);

    if (!this.#isAllowedRoot(resolvedRoot)) {
      throw new ContextResolutionError(
        `Project root "${workspaceRef}" is not inside the allowed project roots.`,
        "workspace_out_of_bounds",
        { workspaceRef }
      );
    }

    return {
      workspaceAlias: null,
      projectName: projectName ?? path.basename(resolvedRoot),
      projectRoot: resolvedRoot,
      defaultFile: null,
      launchMode
    };
  }

  async listProjects({ workspaceRef, limit = DEFAULT_PROJECT_LIST_LIMIT } = {}) {
    const listingRoots = this.#resolveListingRoots(workspaceRef);
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_PROJECT_LIST_LIMIT;
    const configuredProjects = this.#listConfiguredProjects(listingRoots);
    const roots = [];
    let totalProjectCount = 0;

    for (const rootPath of listingRoots) {
      const directories = await this.#readProjectDirectories(rootPath, safeLimit);
      totalProjectCount += directories.length;
      roots.push({
        rootPath,
        directories
      });
    }

    return {
      workspaceRef: workspaceRef ?? null,
      configuredProjects,
      roots,
      totalProjectCount,
      totalRootCount: roots.length
    };
  }

  resolveFileRequest(session, relativePath) {
    const normalizedRelativePath = normalizeRelativePath(relativePath ?? session.defaultFile);
    const absolutePath = path.resolve(session.projectRoot, normalizedRelativePath);

    if (!isInsideRoot(absolutePath, path.resolve(session.projectRoot))) {
      throw new ContextResolutionError(
        `File path "${relativePath}" must stay inside the session project root.`,
        "file_path_out_of_bounds",
        { relativePath }
      );
    }

    return {
      relativePath: normalizedRelativePath,
      absolutePath
    };
  }

  #resolveListingRoots(workspaceRef) {
    if (typeof workspaceRef === "string" && workspaceRef.trim() !== "") {
      const configuredProject = this.projects[workspaceRef.trim()];
      const resolvedRoot = path.resolve(configuredProject?.rootPath ?? workspaceRef.trim());

      if (!this.#isListingRootAllowed(resolvedRoot)) {
        throw new ContextResolutionError(
          `Project root "${workspaceRef}" is not inside the allowed project roots.`,
          "workspace_out_of_bounds",
          { workspaceRef }
        );
      }

      return [resolvedRoot];
    }

    if (this.allowedRoots.length === 0) {
      throw new ContextResolutionError(
        "No allowed project roots are configured for /projects.",
        "workspace_missing"
      );
    }

    return this.allowedRoots;
  }

  async #readProjectDirectories(rootPath, limit) {
    let entries;

    try {
      entries = await fs.readdir(rootPath, { withFileTypes: true });
    } catch (error) {
      throw new ContextResolutionError(
        `Failed to list project root "${rootPath}": ${error.message}`,
        "workspace_list_failed",
        { rootPath }
      );
    }

    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => ({
        name: entry.name,
        projectRoot: path.resolve(rootPath, entry.name)
      }))
      .sort(compareByName)
      .slice(0, limit);
  }

  #listConfiguredProjects(listingRoots) {
    const normalizedRoots = listingRoots.map((rootPath) => path.resolve(rootPath));

    return Object.entries(this.projects)
      .map(([alias, project]) => ({
        alias,
        projectName: project.projectName ?? project.alias ?? alias,
        projectRoot: path.resolve(project.rootPath)
      }))
      .filter((project) =>
        normalizedRoots.some(
          (rootPath) => project.projectRoot === rootPath || isInsideRoot(project.projectRoot, rootPath)
        )
      )
      .sort((left, right) => left.projectName.localeCompare(right.projectName, undefined, {
        sensitivity: "base",
        numeric: true
      }));
  }

  #isConfiguredProjectRoot(targetRoot) {
    return Object.values(this.projects).some(
      (project) => path.resolve(project.rootPath) === targetRoot
    );
  }

  #isListingRootAllowed(targetRoot) {
    return this.#isAllowedRoot(targetRoot) || this.#isConfiguredProjectRoot(targetRoot);
  }

  #isAllowedRoot(targetRoot) {
    return this.allowedRoots.some((rootPath) => isInsideRoot(targetRoot, rootPath));
  }
}

export const WorkspaceContextResolver = ProjectContextResolver;
