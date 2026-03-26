import fs from "node:fs/promises";
import path from "node:path";

import { ContextResolutionError } from "./errors.js";

const DEFAULT_PROJECT_LIST_LIMIT = 200;
const DEFAULT_DIRECTORY_LIST_LIMIT = 200;
const DEFAULT_FIND_LIMIT = 50;
const FIND_SKIP_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  "__pycache__"
]);

function isInsideRoot(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function compareByName(left, right) {
  return left.name.localeCompare(right.name, undefined, {
    sensitivity: "base",
    numeric: true
  });
}

function compareDirectoryEntries(left, right) {
  if (left.type !== right.type) {
    return left.type === "directory" ? -1 : 1;
  }

  return compareByName(left, right);
}

function ensureProjectPathInsideRoot(session, relativePath, absolutePath, errorCode, errorPayload = {}) {
  const projectRoot = path.resolve(session.projectRoot);

  if (!isInsideRoot(absolutePath, projectRoot)) {
    throw new ContextResolutionError(
      `Path "${relativePath}" must stay inside the session project root.`,
      errorCode,
      errorPayload
    );
  }
}

function normalizeStoredRelativePath(relativePath) {
  const normalized = String(relativePath ?? "").trim().replace(/\\/g, "/");

  if (!normalized || normalized === ".") {
    return "";
  }

  const trimmed = normalized.replace(/^\/+|\/+$/g, "");

  if (!trimmed) {
    return "";
  }

  const resolved = path.posix.normalize(trimmed);

  if (!resolved || resolved === ".") {
    return "";
  }

  if (resolved === ".." || resolved.startsWith("../") || resolved.startsWith("/")) {
    throw new ContextResolutionError(
      `Path "${relativePath}" must stay inside the session project root.`,
      "file_path_invalid",
      { relativePath }
    );
  }

  return resolved;
}

function resolveSessionRelativePath(pathRef, {
  baseRelativePath = "",
  defaultRelativePath = "",
  missingMessage = "A relative file path is required."
} = {}) {
  const basePath = normalizeStoredRelativePath(baseRelativePath);
  const fallbackPath = normalizeStoredRelativePath(defaultRelativePath);

  if (pathRef === undefined || pathRef === null || String(pathRef).trim() === "") {
    if (fallbackPath !== "") {
      return fallbackPath;
    }

    if (defaultRelativePath === "") {
      return "";
    }

    throw new ContextResolutionError(missingMessage, "file_path_missing");
  }

  const rawPathRef = String(pathRef).trim();

  if (rawPathRef === "/" || rawPathRef === "\\") {
    return "";
  }

  if (rawPathRef === ".") {
    return basePath;
  }

  if (path.isAbsolute(rawPathRef)) {
    throw new ContextResolutionError(
      `Path "${pathRef}" must stay inside the session project root.`,
      "file_path_invalid",
      { pathRef }
    );
  }

  const normalizedRef = rawPathRef.replace(/\\/g, "/");
  const joinedPath = basePath
    ? path.posix.normalize(path.posix.join(basePath, normalizedRef))
    : path.posix.normalize(normalizedRef);

  if (!joinedPath || joinedPath === ".") {
    return "";
  }

  if (joinedPath === ".." || joinedPath.startsWith("../") || joinedPath.startsWith("/")) {
    throw new ContextResolutionError(
      `Path "${pathRef}" must stay inside the session project root.`,
      "file_path_invalid",
      { pathRef }
    );
  }

  return normalizeStoredRelativePath(joinedPath);
}

function toEntryRecord({ absolutePath, name, relativePath, type, sizeBytes = null }) {
  return {
    name,
    type,
    relativePath,
    absolutePath,
    sizeBytes
  };
}

async function describeDirectoryEntry(absolutePath, relativePath, dirent) {
  const entryAbsolutePath = path.resolve(absolutePath, dirent.name);
  const entryRelativePath = normalizeStoredRelativePath(
    relativePath ? `${relativePath}/${dirent.name}` : dirent.name
  );

  if (dirent.isDirectory()) {
    return toEntryRecord({
      absolutePath: entryAbsolutePath,
      name: dirent.name,
      relativePath: entryRelativePath,
      type: "directory"
    });
  }

  if (dirent.isFile()) {
    let sizeBytes = null;

    try {
      const stat = await fs.stat(entryAbsolutePath);
      sizeBytes = stat.size;
    } catch {
      sizeBytes = null;
    }

    return toEntryRecord({
      absolutePath: entryAbsolutePath,
      name: dirent.name,
      relativePath: entryRelativePath,
      type: "file",
      sizeBytes
    });
  }

  return null;
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

  resolveDirectoryRequest(session, { pathRef = null, baseRelativePath = "" } = {}) {
    const relativePath = resolveSessionRelativePath(pathRef, {
      baseRelativePath,
      defaultRelativePath: baseRelativePath
    });
    const absolutePath = path.resolve(session.projectRoot, relativePath || ".");

    ensureProjectPathInsideRoot(session, relativePath, absolutePath, "directory_path_out_of_bounds", {
      pathRef,
      relativePath
    });

    return {
      relativePath,
      absolutePath,
      parentRelativePath: relativePath
        ? normalizeStoredRelativePath(path.posix.dirname(relativePath))
        : "",
      displayRelativePath: relativePath || "/"
    };
  }

  async listDirectory(session, { pathRef = null, baseRelativePath = "", limit = DEFAULT_DIRECTORY_LIST_LIMIT } = {}) {
    const directory = this.resolveDirectoryRequest(session, {
      pathRef,
      baseRelativePath
    });
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_DIRECTORY_LIST_LIMIT;
    let entries;

    try {
      const stat = await fs.stat(directory.absolutePath);
      if (!stat.isDirectory()) {
        throw new ContextResolutionError(
          `Path "${directory.displayRelativePath}" is not a directory.`,
          "directory_path_invalid",
          { pathRef, relativePath: directory.relativePath }
        );
      }

      entries = await fs.readdir(directory.absolutePath, { withFileTypes: true });
    } catch (error) {
      if (error instanceof ContextResolutionError) {
        throw error;
      }

      throw new ContextResolutionError(
        `Failed to list directory "${directory.displayRelativePath}": ${error.message}`,
        "directory_list_failed",
        { pathRef, relativePath: directory.relativePath }
      );
    }

    const describedEntries = (await Promise.all(
      entries.map((entry) => describeDirectoryEntry(directory.absolutePath, directory.relativePath, entry))
    ))
      .filter(Boolean)
      .sort(compareDirectoryEntries);

    return {
      directory,
      entries: describedEntries.slice(0, safeLimit),
      totalEntryCount: describedEntries.length,
      omittedEntryCount: Math.max(0, describedEntries.length - safeLimit)
    };
  }

  async findEntries(session, {
    query,
    pathRef = null,
    baseRelativePath = "",
    limit = DEFAULT_FIND_LIMIT
  } = {}) {
    const normalizedQuery = String(query ?? "").trim().toLowerCase();

    if (!normalizedQuery) {
      throw new ContextResolutionError(
        "The -q flag is required for /find.",
        "find_query_missing"
      );
    }

    const directory = this.resolveDirectoryRequest(session, {
      pathRef,
      baseRelativePath
    });
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_FIND_LIMIT;
    const matches = [];
    const pending = [{
      absolutePath: directory.absolutePath,
      relativePath: directory.relativePath
    }];
    let limited = false;

    while (pending.length > 0) {
      const current = pending.shift();
      let entries;

      try {
        entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
      } catch (error) {
        throw new ContextResolutionError(
          `Failed to search inside "${current.relativePath || "/"}": ${error.message}`,
          "directory_search_failed",
          { pathRef, relativePath: current.relativePath }
        );
      }

      entries.sort(compareByName);

      for (const entry of entries) {
        const entryAbsolutePath = path.resolve(current.absolutePath, entry.name);
        const entryRelativePath = normalizeStoredRelativePath(
          current.relativePath ? `${current.relativePath}/${entry.name}` : entry.name
        );
        const entryType = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : null;

        if (!entryType) {
          continue;
        }

        if (entry.name.toLowerCase().includes(normalizedQuery)) {
          let sizeBytes = null;

          if (entryType === "file") {
            try {
              const stat = await fs.stat(entryAbsolutePath);
              sizeBytes = stat.size;
            } catch {
              sizeBytes = null;
            }
          }

          matches.push(toEntryRecord({
            absolutePath: entryAbsolutePath,
            name: entry.name,
            relativePath: entryRelativePath,
            type: entryType,
            sizeBytes
          }));

          if (matches.length >= safeLimit) {
            limited = true;
            break;
          }
        }

        if (entryType === "directory" && !FIND_SKIP_DIRECTORY_NAMES.has(entry.name)) {
          pending.push({
            absolutePath: entryAbsolutePath,
            relativePath: entryRelativePath
          });
        }
      }

      if (limited) {
        break;
      }
    }

    matches.sort(compareDirectoryEntries);

    return {
      directory,
      entries: matches,
      totalMatchCount: matches.length,
      limited,
      query: String(query ?? "").trim()
    };
  }

  resolveFileRequest(session, relativePathOrOptions) {
    const options =
      typeof relativePathOrOptions === "object" && relativePathOrOptions !== null
        ? relativePathOrOptions
        : { pathRef: relativePathOrOptions };
    const relativePath = resolveSessionRelativePath(options.pathRef ?? session.defaultFile, {
      baseRelativePath: options.baseRelativePath ?? "",
      defaultRelativePath: session.defaultFile ?? "",
      missingMessage: "A relative file path is required."
    });
    const absolutePath = path.resolve(session.projectRoot, relativePath);

    ensureProjectPathInsideRoot(session, relativePath, absolutePath, "file_path_out_of_bounds", {
      relativePath: options.pathRef ?? session.defaultFile
    });

    return {
      relativePath,
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
