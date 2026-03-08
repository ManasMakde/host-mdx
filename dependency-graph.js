import fs from "fs";
import path from "path";
import resolve from 'resolve';
import precinct from 'precinct';
import * as mdx from '@mdx-js/mdx';


// Properties
const DEPENDENTS_KEY = "dependents";
const DEPENDENCIES_KEY = "dependencies";


// Methods
export async function crawlDir(dir, ignoreCheck = async (p) => false) {

    // Make sure dir is absolute
    dir = path.resolve(dir);


    // Iterate through all files in dir
    let results = [];
    const list = fs.readdirSync(dir);
    for (let targetPath of list) {

        // get absolute path
        const absPath = path.join(dir, targetPath);


        // Skip if to ignore
        if (await ignoreCheck(absPath)) {
            continue;
        }


        // If directory, Recurse into it
        const stat = fs.statSync(absPath);
        if (stat && stat.isDirectory()) {
            results = results.concat(await crawlDir(absPath, ignoreCheck));
            continue;
        }


        // If file, Add to list
        results.push(absPath);
    }

    return results;
}
export function resolveAlias(targetPath, aliases) {
    for (const [alias, aliasPath] of Object.entries(aliases)) {

        // Check if import is the alias or starts with alias + system separator
        const isExact = targetPath === alias;
        const isSubPath = targetPath.startsWith(`${alias}${path.sep}`) || targetPath.startsWith(`${alias}/`);

        if (isExact || isSubPath) {
            targetPath = targetPath.replace(alias, aliasPath);
            targetPath = path.normalize(targetPath);
            break;
        }
    }

    return targetPath;
}
export function ensureRelativePath(rootPath, filePath) {
    const absoluteTarget = path.resolve(rootPath, filePath);
    const absoluteRoot = path.resolve(rootPath);
    return path.relative(absoluteRoot, absoluteTarget);
}
export async function calcDependencies(filePath, aliases = {}) {

    // Return if given path has already been traversed or is a node_modules
    const absolutePath = path.resolve(filePath);
    if (absolutePath.includes('node_modules')) {
        return new Set();
    }


    // Compile mdx if passed
    let foundImports = [];
    if (absolutePath.endsWith('.mdx')) {
        let content = fs.readFileSync(absolutePath, 'utf8');
        const compiled = await mdx.compile(content);
        content = String(compiled?.value ?? "");
        foundImports = precinct(content);
    }
    else {
        foundImports = precinct.paperwork(absolutePath);
    }


    // Get & iterate through all imports
    let filteredImports = [];
    for (let i of foundImports) {

        // Resolve aliases
        i = resolveAlias(i, aliases);


        // Skip if not a local file
        const isLocal = i.startsWith('.') || i.startsWith('/');
        if (!isLocal) {
            continue;
        }


        // Resolve the found import
        let resolvedPath = "";
        try {
            resolvedPath = resolve.sync(i, { basedir: path.dirname(absolutePath) }); // extensions: ['.js', '.jsx', '.mdx', '.json', '.tsx', '.ts']
        }
        catch (err) {
            continue;
        }


        // Skip if the resolved path is within node_modules
        if (resolvedPath.includes('node_modules')) {
            continue;
        }


        // Add path as a dependency
        filteredImports.push(resolvedPath);
    }


    return new Set(filteredImports);
}


// Classes
export class DependencyGraph {

    // Private Properties
    #graph = {};  // Format { "path/to/file" : { dependents: Set(...), dependencies : Set(...) }, ... }
    #aliases = {};  // Format { '@' : "path/to/dir" }
    #rootFolder = "";
    #ignoreCheck = async (checkPath) => false;


    // Public Methods
    getGraph() {
        return structuredClone(this.#graph);
    }
    async createGraph(newRootFolder, newIgnoreCheck = async (checkPath) => false) {
        this.#graph = {};
        this.#rootFolder = path.resolve(newRootFolder);
        this.#ignoreCheck = newIgnoreCheck;


        // Get all files inside directory
        const allFiles = await crawlDir(this.#rootFolder, this.#ignoreCheck);


        // Assign all dependencies
        for (const file of allFiles) {
            await this.addEntry(file);
        }
    }
    async addEntry(filePath) {

        // Get relative path
        let relFilePath = ensureRelativePath(this.#rootFolder, filePath);


        // Remove previous relations
        this.removeEntry(filePath);


        // Get all dependencies
        const absFilePath = path.resolve(this.#rootFolder, relFilePath);
        const dependencies = await calcDependencies(absFilePath, this.#aliases);
        const relDependencies = new Set();
        dependencies.forEach(p => {
            relDependencies.add(path.relative(this.#rootFolder, p));
        })


        // Skip if no dependencies
        if (dependencies.size === 0) {
            return;
        }


        // Add dependencies
        this.#graph[relFilePath] = {
            [DEPENDENCIES_KEY]: relDependencies,
            [DEPENDENTS_KEY]: new Set()
        };


        // Add dependents
        const depList = this.#graph[relFilePath][DEPENDENCIES_KEY];
        depList.forEach(dep => {
            if (this.#graph[dep] === undefined) {
                this.#graph[dep] = {
                    [DEPENDENCIES_KEY]: new Set(),
                    [DEPENDENTS_KEY]: new Set()
                }
            }

            this.#graph[dep][DEPENDENTS_KEY].add(relFilePath);
        });
    }
    removeEntry(filePath) {

        // Get relative path
        let relFilePath = ensureRelativePath(this.#rootFolder, filePath);


        // Return if entry does not exist
        if (this.#graph[relFilePath] === undefined) {
            return;
        }


        // Remove from dependents
        const depList = this.#graph[relFilePath][DEPENDENCIES_KEY];
        depList.forEach(dep => {
            this.#graph?.[dep]?.[DEPENDENTS_KEY]?.delete(relFilePath);
        });


        // Remove from dependencies
        const depOf = this.#graph[relFilePath][DEPENDENTS_KEY];
        depOf.forEach(dependent => {
            this.#graph[dependent]?.[DEPENDENCIES_KEY]?.delete(relFilePath);
        });


        // Remove entry
        delete this.#graph[relFilePath];
    }
    hasEntry(filePath) {
        let relFilePath = ensureRelativePath(this.#rootFolder, filePath);
        return this.#graph[relFilePath] !== undefined;
    }
    getEntry(filePath) {
        let relFilePath = ensureRelativePath(this.#rootFolder, filePath);
        return this.#graph[relFilePath];
    }
    getDependencies(filePath) {
        let relFilePath = ensureRelativePath(this.#rootFolder, filePath);
        let absDeps = new Set();
        let deps = this.#graph?.[relFilePath]?.[DEPENDENCIES_KEY] ?? new Set();
        for (const dep of deps) {
            absDeps.add(path.resolve(this.#rootFolder, dep));
        }

        return absDeps;
    }
    getDeepDependencies(filePath) {

        // Get relative path
        let relFilePath = ensureRelativePath(this.#rootFolder, filePath);


        // Return empty set if entry does not exist
        if (!this.hasEntry(relFilePath)) {
            return new Set();
        }


        // Recursively get dependencies
        const deepDeps = new Set();
        const walk = (currentPath) => {

            // Skip if not in graph
            const deps = this.getDependencies(currentPath);
            if (!deps) {
                return;
            }

            // Iterate over all dependencies
            deps.forEach(dep => {
                if (deepDeps.has(dep)) {
                    return;
                }

                // Add to list and continue walking
                deepDeps.add(dep);
                walk(dep);
            });
        };
        walk(relFilePath);

        return deepDeps;
    }
    getDependents(filePath) {
        let relFilePath = ensureRelativePath(this.#rootFolder, filePath);
        let absDeps = new Set();
        let deps = this.#graph?.[relFilePath]?.[DEPENDENTS_KEY] ?? new Set();
        for (const dep of deps) {
            absDeps.add(path.resolve(this.#rootFolder, dep));
        }

        return absDeps;
    }
    getDeepDependents(filePath) {

        // Get relative path
        let relFilePath = ensureRelativePath(this.#rootFolder, filePath);


        // Return empty set if entry does not exist
        if (!this.hasEntry(relFilePath)) {
            return new Set();
        }


        // Recursively get dependents
        const deepDependents = new Set();
        const walk = (currentPath) => {

            // Skip if not in graph
            const dependents = this.getDependents(currentPath);
            if (!dependents) {
                return;
            }

            // Iterate over all dependencies
            dependents.forEach(dependent => {
                if (deepDependents.has(dependent)) {
                    return;
                }

                // Add to list and continue walking
                deepDependents.add(dependent);
                walk(dependent);
            });
        };
        walk(relFilePath);
        

        return deepDependents;
    }
    addAlias(symbol, toPath) {
        this.#aliases[symbol] = toPath;
    }
    removeAlias(symbol) {
        delete this.#aliases[symbol];
    }
    setAlias(newAliases) {
        this.#aliases = newAliases;
    }
}