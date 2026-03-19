import fs from "fs";
import os from "os";
import net from "net";
import path from "path";
import sirv from "sirv";
import polka from "polka";
import ignore from "ignore";
import pLimit from 'p-limit';
import chokidar from "chokidar";
import { pathToFileURL } from "url";
import { promises as fsp } from "fs";
import { mdxToHtml } from "./mdx-to-html.js";
import { DependencyGraph, crawlDir } from "./dependency-graph.js";


// Enums
export const TrackChanges = Object.freeze({
    NONE: 0,
    SOFT: 1,
    HARD: 2
});
export const SiteCreationStatus = Object.freeze({
    NONE: 0,
    PENDING_RECREATION: 1,
    ONGOING: 2,
});


// To-Set Properties
const APP_NAME = "host-mdx";
const IGNORE_FILE_NAME = ".hostmdxignore";
const CONFIG_FILE_NAME = "host-mdx.js";
const FILE_404 = "404.html";
const NOT_FOUND_404_MESSAGE = "404";
const DEFAULT_PORT = 3000;
const MAX_PORT = 4000;
const EXCLUDE_HEADER = "# [EXCLUDE]";  // Case insensitive
const TEMP_HTML_DIR = path.join(os.tmpdir(), `${APP_NAME}`);
const DEFAULT_IGNORES = `
${EXCLUDE_HEADER}
${IGNORE_FILE_NAME}
${EXCLUDE_HEADER}
${CONFIG_FILE_NAME}
${EXCLUDE_HEADER}
node_modules
${EXCLUDE_HEADER}
package-lock.json
${EXCLUDE_HEADER}
package.json
${EXCLUDE_HEADER}
.git
${EXCLUDE_HEADER}
.github
${EXCLUDE_HEADER}
.gitignore
`;


// Properties
const LOG_TIME_OPTIONS = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
    fractionalSecondDigits: 3
};
const DEFAULT_CHOKIDAR_OPTIONS = {
    ignoreInitial: true
};
const DEFAULT_CONFIGS = {
    // port: 3000,  // Intentionally kept commented out, otherwise interferes with auto port assigning DO NOT CHANGE
    trackChanges: 0,
    toBeVerbose: false,
    concurrency: 1,
    chokidarOptions: DEFAULT_CHOKIDAR_OPTIONS,
    toIgnore: (inputPath, outputPath, targetPath) => {
        const isGOutputStream = /\.goutputstream-\w+$/.test(targetPath);
        if (isGOutputStream) {
            return null;
        }

        const ignoredDirs = new Set(['node_modules', '.git', '.github']);
        const segments = targetPath.split(path.sep);
        if (segments.some(segment => ignoredDirs.has(segment))) {
            return null;
        }

        return false;
    }
};


// Utility Methods
function getIgnore(ignoreFilePath) {
    const ig = ignore();
    let ignoreContent = DEFAULT_IGNORES;
    if (fs.existsSync(ignoreFilePath)) {
        ignoreContent += `\n${fs.readFileSync(ignoreFilePath, "utf8")}`;
    }
    ig.add(ignoreContent);
    return ig;
}
function getExclude(ignoreFilePath) {

    // Read .ignore file
    const ig = ignore();
    let rawContent = DEFAULT_IGNORES;
    if (fs.existsSync(ignoreFilePath)) {
        rawContent += "\n" + fs.readFileSync(ignoreFilePath, "utf8");
    }


    // Only get lines which have "# [EXCLUDE]" comment on top
    let filteredLines = [];
    let hasExclude = false;
    const lines = rawContent.split(/\r?\n/);
    const excludeComment = EXCLUDE_HEADER.toLowerCase();
    for (const line of lines) {
        const trimmed = line.trim();

        // Check for the header tag
        if (trimmed.toLowerCase() === excludeComment) {
            hasExclude = true;
            continue;
        }

        // Reset if empty line found 
        if (trimmed === "") {
            hasExclude = false;
            continue;
        }

        // Add line if has exclude otherwise continue
        if (hasExclude) {
            filteredLines.push(trimmed);
        }
    }


    // Add to ignore
    ig.add(filteredLines.join("\n"));
    return ig;
}
async function createFile(filePath, fileContent = "") {
    let fileLocation = path.dirname(filePath)
    await fsp.mkdir(fileLocation, { recursive: true });
    await fsp.writeFile(filePath, fileContent);
}
async function startServer(hostDir, port, errorCallback) {  // Starts server at given port

    // Make sure host dir path is absolute
    hostDir = path.resolve(hostDir);


    // Start Server
    const assets = sirv(hostDir, { dev: true });
    const newApp = polka({
        onNoMatch: async (req, res) => {  // Send 404 file if found else not found message
            const file404 = path.join(hostDir, FILE_404);
            if (fs.existsSync(file404)) {
                const content = await fsp.readFile(file404);
                res.writeHead(404, {
                    'Content-Type': 'text/html',
                    'Content-Length': content.length
                });
                res.end(content);
            } else {
                res.statusCode = 404;
                res.end(NOT_FOUND_404_MESSAGE);
            }
        }
    }).use((req, res, next) => {  // Add trailing slash
        if (1 < req.path.length && !req.path.endsWith('/') && !path.extname(req.path)) {
            res.writeHead(301, { Location: req.path + '/' });
            return res.end();
        }
        next();
    }).use(assets)


    // Start listening
    newApp.listen(port)
    newApp.server.on("error", errorCallback);


    return newApp
}
async function isPortAvailable(port) {
    const server = net.createServer();
    server.unref();

    return new Promise((resolve) => {
        server.once("error", () => {
            server.close();
            resolve(false);
        });

        server.once("listening", () => {
            server.close(() => resolve(true));
        });

        server.listen(port);
    });
}
async function getAvailablePort(startPort = DEFAULT_PORT, maxPort = MAX_PORT) {
    let currentPort = startPort;
    while (currentPort <= maxPort) {
        if (await isPortAvailable(currentPort)) {
            return currentPort;
        }

        currentPort++;
    }

    return -1;
}
export function log(msg, toSkip = false) {
    if (toSkip) {  // Useful for verbose check
        return
    }

    let timestamp = new Date().toLocaleString(undefined, LOG_TIME_OPTIONS)
    console.log(`[${APP_NAME} ${timestamp}] ${msg}`)
}
export function isPathInside(parentPath, childPath) {

    // Make sure both are absolute paths
    parentPath = parentPath !== "" ? path.resolve(parentPath) : "";
    childPath = childPath !== "" ? path.resolve(childPath) : "";


    // Check if parent & child are same
    if (parentPath === childPath) {
        return true;
    }


    const relation = path.relative(parentPath, childPath);
    return Boolean(
        relation &&
        relation !== '..' &&
        !relation.startsWith(`..${path.sep}`) &&
        relation !== path.resolve(childPath)
    );
}
export async function setupConfigs(inputPath) {
    let configFilePath = path.join(inputPath, CONFIG_FILE_NAME);
    let configs = { ...DEFAULT_CONFIGS };
    if (fs.existsSync(configFilePath)) {
        let cleanConfigFilePath = pathToFileURL(configFilePath).href;
        configs = { ...configs, ...(await import(cleanConfigFilePath)) };
    }

    return configs;
}
export function createTempDir() {
    // Create default temp html dir
    fs.mkdirSync(TEMP_HTML_DIR, { recursive: true });


    // Generate time stamp
    const now = new Date()
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1)}-${now.getDate()}T${now.getHours()}_${now.getMinutes()}_${now.getSeconds()}`


    return fs.mkdtempSync(path.join(TEMP_HTML_DIR, `html-${timestamp}-`));
}
export async function emptyDir(dirPath) {
    const files = await fsp.readdir(dirPath);
    for (const file of files) {
        const fullPath = path.join(dirPath, file);
        await fsp.rm(fullPath, { recursive: true, force: true });
    }
}
export async function createSite(inputPath = "", outputPath = "", pathsToCreate = [], ignores = undefined, configs = undefined, interruptCondition = undefined) {

    // Check `inputPath`
    inputPath = inputPath !== "" ? inputPath : process.cwd();


    // Check `outputPath`
    outputPath = outputPath !== "" ? outputPath : createTempDir();


    // Get input path
    if (!fs.existsSync(inputPath) || !fs.lstatSync(inputPath)?.isDirectory()) {
        throw new Error(`Invalid input path "${inputPath}"`);
    }


    // Get output path exists & is a directory
    if (!fs.existsSync(outputPath) || !fs.lstatSync(outputPath).isDirectory()) {
        throw new Error(`Invalid output path "${outputPath}"`);
    }


    // Check if `outputPath` is inside `inputPath` (causing infinite loop)
    if (isPathInside(inputPath, outputPath)) {
        throw new Error(`Output path "${outputPath}" cannot be inside or same as input path "${inputPath}"`);
    }


    // Check if `inputPath` is inside `outputPath` (causing code wipeout)
    if (isPathInside(outputPath, inputPath)) {
        throw new Error(`Input path "${inputPath}" cannot be inside or same as output path "${outputPath}"`);
    }


    // Check for verbose
    const toBeVerbose = configs?.toBeVerbose === true;


    // Check `interruptCondition` provided
    if (typeof interruptCondition !== 'function') {
        interruptCondition = async () => false;
    }


    // Hard reload, clear output path & Get all paths from `inputPath`
    let isHardReloading = pathsToCreate == null;
    if (isHardReloading) {
        await emptyDir(outputPath)
        pathsToCreate = await crawlDir(inputPath);
    }


    // Setup .ignore file 
    if (ignores === undefined) {
        let ignoreFilePath = path.join(inputPath, IGNORE_FILE_NAME);
        ignores = getIgnore(ignoreFilePath)
    }


    // Setup configs
    if (configs === undefined) {
        let configFilePath = path.join(inputPath, `./${CONFIG_FILE_NAME}`);
        let doesConfigFileExists = fs.existsSync(configFilePath);
        log(`Importing config file ${configFilePath}`, !doesConfigFileExists);
        configs = await setupConfigs(inputPath);
    }


    // Setup concurrency limit
    const concurrency = configs?.concurrency ?? 1;
    log(`Setting concurrency to ${concurrency}`, !toBeVerbose);
    const limit = pLimit(concurrency);


    // Filter out paths based on ignore
    const filterResults = await Promise.all(pathsToCreate.map(async (currentPath) => limit(async () => {
        // Filter out input path itself if passed
        if (inputPath === currentPath) {
            return false;
        }


        // Filter based on .ignore file
        const relToInput = path.relative(inputPath, currentPath);
        if (ignores.ignores(relToInput)) {
            return false;
        }


        // Filter based on toIgnore() in configs
        const toBeIgnored = await configs?.toIgnore?.(inputPath, outputPath, currentPath);
        if (toBeIgnored === true || toBeIgnored === null) {
            return false;
        }

        return true;
    })));
    pathsToCreate = pathsToCreate.filter((_, index) => filterResults[index]);


    // Return if no paths remaining to create after filtering for ignores
    if (pathsToCreate.length === 0) {
        log(`Skipping site creation since no paths to create`, !toBeVerbose);
        return;
    }


    // Modify rebuild paths based on configs
    pathsToCreate = await configs?.modRebuildPaths?.(inputPath, outputPath, pathsToCreate) ?? pathsToCreate;


    // Broadcast site creation started
    log(`Starting site creation at ${outputPath} ...`);
    await configs?.onSiteCreateStart?.(inputPath, outputPath, !isHardReloading);


    // Iterate & build all files
    let wasInterrupted = false;
    await Promise.all(pathsToCreate.map((currentPath) => limit(async () => {

        // Check for interruption & return
        wasInterrupted = wasInterrupted || await interruptCondition(inputPath, outputPath, currentPath);
        if (wasInterrupted) {
            return;
        }


        // Essentials
        const pathExists = fs.existsSync(currentPath);
        const relToInput = path.relative(inputPath, currentPath);
        const absToOutput = path.join(outputPath, relToInput);
        const isDir = pathExists ? fs.statSync(currentPath).isDirectory() : false;
        const isMdx = currentPath.endsWith(".mdx");
        const absHtmlPath = isMdx ? path.format({ ...path.parse(absToOutput), base: "", ext: ".html" }) : "";


        // Delete if path does not exist
        if (!pathExists) {
            let pathToDelete = isMdx ? absHtmlPath : absToOutput;
            log(`Deleting ${pathToDelete}`, !toBeVerbose);
            await configs?.onFileChangeStart?.(inputPath, outputPath, currentPath, pathToDelete, true);
            await fsp.rm(pathToDelete, { recursive: true, force: true });
            await configs?.onFileChangeEnd?.(inputPath, outputPath, currentPath, pathToDelete, true, undefined);
        }
        // Make corresponding directory
        else if (isDir) {
            log(`Creating ${currentPath} ---> ${absToOutput}`, !toBeVerbose);
            await configs?.onFileChangeStart?.(inputPath, outputPath, currentPath, absToOutput, false);
            await fsp.mkdir(absToOutput, { recursive: true });
            await configs?.onFileChangeEnd?.(inputPath, outputPath, currentPath, absToOutput, false, undefined);
        }
        // Make html file from mdx
        else if (isMdx) {

            // Broadcast file creation started
            log(`Creating ${currentPath} ---> ${absHtmlPath}`, !toBeVerbose);
            await configs?.onFileChangeStart?.(inputPath, outputPath, currentPath, absHtmlPath, false);


            // Intercept mdx code
            let mdxCode = await fsp.readFile(currentPath, "utf8");
            log(`Modifying mdx code of ${currentPath}`, !toBeVerbose || !configs?.modMDXCode);
            mdxCode = await configs?.modMDXCode?.(inputPath, outputPath, currentPath, absHtmlPath, mdxCode) ?? mdxCode;


            // convert mdx code into html & paste into file
            let parentDir = path.dirname(currentPath);
            let globalArgs = { hostmdxCwd: parentDir, hostmdxInputPath: inputPath, hostmdxOutputPath: outputPath };
            globalArgs = await configs?.modGlobalArgs?.(inputPath, outputPath, globalArgs) ?? globalArgs;
            let result = await mdxToHtml(mdxCode, parentDir, globalArgs, async (settings) => { return await configs?.modBundleMDXSettings?.(inputPath, outputPath, settings) ?? settings });
            let htmlCode = result.html;
            await createFile(absHtmlPath, `<!DOCTYPE html>${htmlCode}`);


            // Broadcast file creation ended
            await configs?.onFileChangeEnd?.(inputPath, outputPath, currentPath, absHtmlPath, false, result);
        }
        // Copy paste file
        else {
            log(`Creating ${currentPath} ---> ${absToOutput}`, !toBeVerbose);
            await configs?.onFileChangeStart?.(inputPath, outputPath, currentPath, absToOutput, false);
            await fsp.mkdir(path.dirname(absToOutput), { recursive: true });
            await fsp.copyFile(currentPath, absToOutput);
            await configs?.onFileChangeEnd?.(inputPath, outputPath, currentPath, absToOutput, false, undefined);
        }
    })));


    // Broadcast site creation ended
    log(wasInterrupted ? `Site creation was interrupted!` : `Completed site creation at ${outputPath}`);
    await configs?.onSiteCreateEnd?.(inputPath, outputPath, !isHardReloading, wasInterrupted);


    // Throw error on interruption, This was done to make sure `alteredPaths` retains old values
    if (wasInterrupted) {
        throw new Error(`Site creation interrupted!`);
    }
}


// Classes
export class HostMdx {

    // Private Properties
    #inputPathProvided = true;
    #outputPathProvided = true;
    #siteCreationStatus = SiteCreationStatus.NONE;
    #pendingHardSiteCreation = false;
    #alteredPaths = [];
    #app = null;
    #watcher = null;
    #ignores = null;
    #excludes = null;
    #depGraph = new DependencyGraph();


    // Constructors
    constructor(inputPath = "", outputPath = "", configs = {}) {
        this.inputPath = inputPath;
        this.outputPath = outputPath;
        this.configs = configs;
    }


    // Private Methods
    async #watchForChanges(event, targetPath) {

        // Skip reload if `toIgnore` gives null
        let ignoreStat = await this.configs?.toIgnore?.(this.inputPath, this.outputPath, targetPath);
        if (ignoreStat === null) {
            return;
        }


        // Skip reload if has # [EXCLUDE] header in .ignore file
        let relTargetPath = path.relative(this.inputPath, targetPath);
        let excludeStat = this.#excludes?.ignores(relTargetPath);
        if (excludeStat) {
            return;
        }


        // Update dependency graph
        if (event === "unlink") {
            this.#depGraph.removeEntry(targetPath);
        }
        else {
            this.#depGraph.addEntry(targetPath);
        }


        // Add changed path
        let dependencies = this.#depGraph.getDeepDependents(targetPath);
        this.#alteredPaths = this.#alteredPaths.concat([...dependencies, targetPath]);


        // Reflect changes immediately
        if (this.configs?.trackChanges !== undefined && this.configs?.trackChanges != TrackChanges.NONE) {
            let toHardReload = this.configs?.trackChanges == TrackChanges.HARD;
            log(`${toHardReload ? "Hard recreating" : "Recreating"} site, Event: ${event}, Path: ${targetPath}`, !this.configs?.toBeVerbose);
            await this.recreateSite(toHardReload);
        }
    }


    // Getter Methods
    getSiteCreationStatus() {
        return this.#siteCreationStatus;
    }


    // Public Methods
    async start() {

        // Make sure hosting has stopped before starting again
        await this.stop();


        // Assign all
        this.#inputPathProvided = this.inputPath !== "";
        this.#outputPathProvided = this.outputPath !== "";
        this.inputPath = this.#inputPathProvided ? this.inputPath : process.cwd();
        this.outputPath = this.#outputPathProvided ? this.outputPath : createTempDir();


        // Get configs
        let configFilePath = path.join(this.inputPath, `./${CONFIG_FILE_NAME}`);
        let doesConfigFileExists = fs.existsSync(configFilePath);
        log(`Importing config file ${configFilePath}`, !doesConfigFileExists);
        this.configs = { ...(await setupConfigs(this.inputPath)), ...this.configs };


        // Get port
        let port = this.configs?.port ?? await getAvailablePort();
        if (port === -1) {
            log(`Could not find any available ports`);
            return false;
        }
        else if (!Number.isInteger(port)) {
            log(`Invalid port`)
            return false;
        }


        // Get ignores
        let ignoreFilePath = path.join(this.inputPath, IGNORE_FILE_NAME);
        this.#ignores = getIgnore(ignoreFilePath);


        // Get excludes
        this.#excludes = getExclude(ignoreFilePath);


        // Broadcast hosting about to start
        await this.configs?.onHostStarting?.(this.inputPath, this.outputPath, port);


        // Delete old files & Create site
        await this.recreateSite(true);


        // Create dependency graph 
        let defaultMdxSettings = { esbuildOptions: () => ({}) };
        let modMdxSettings = await this.configs?.modBundleMDXSettings?.(this.inputPath, this.outputPath, defaultMdxSettings);
        let aliases = modMdxSettings?.esbuildOptions?.({})?.alias ?? {};
        this.#depGraph.setAlias(aliases);
        await this.#depGraph.createGraph(this.inputPath, async (targetPath) => (await this.configs?.toIgnore?.(this.inputPath, this.outputPath, targetPath)) === null || this.#excludes?.ignores(path.relative(this.inputPath, targetPath)));


        // Start server to host site
        this.#app = await startServer(this.outputPath, port, (e) => { log(`Failed to start server: ${e.message}`); });
        this.#app?.server?.on("close", async () => { await this.configs?.onHostEnded?.(this.inputPath, this.outputPath, port); });


        // Watch for changes
        let chokidarOptions = { ...DEFAULT_CHOKIDAR_OPTIONS, ...(this.configs?.chokidarOptions ?? {}) };
        this.#watcher = chokidar.watch(this.inputPath, chokidarOptions).on("all", async (event, targetPath) => { await this.#watchForChanges(event, targetPath) });


        // Broadcast hosting started
        await this.configs?.onHostStarted?.(this.inputPath, this.outputPath, port);


        // Load as started
        log(`Server listening at ${port} ...`);


        return true;
    }
    async recreateSite(hardReload = false) {

        // Return if no changes made and no requested hard reload
        if (this.#alteredPaths.length == 0 && !hardReload) {
            log(`No changes made which require reloading, Try hard reloading instead`)
            return;
        }


        // Return & add to pending if already creating
        if (this.#siteCreationStatus == SiteCreationStatus.ONGOING) {
            log("Site creation already ongoing! Added to pending")
            this.#siteCreationStatus = SiteCreationStatus.PENDING_RECREATION;
            this.#pendingHardSiteCreation = this.#pendingHardSiteCreation || hardReload;
            return;
        }


        // Set creating status to ongoing
        this.#siteCreationStatus = SiteCreationStatus.ONGOING;


        // Actual site creation
        let pathsToCreate = hardReload ? null : [...new Set(this.#alteredPaths)];
        try {
            this.#alteredPaths = [];
            await createSite(this.inputPath, this.outputPath, pathsToCreate, this.#ignores, this.configs, () => this.#siteCreationStatus != SiteCreationStatus.ONGOING);
        }
        catch (err) {
            this.#alteredPaths = hardReload ? this.#alteredPaths : [...new Set([...pathsToCreate, ...this.#alteredPaths])];  // Readd incase of failure
            log(`Failed to create site!\n${err.stack}`);
        }


        // If recreate was triggered while site creation was ongoing
        const wasPending = this.#siteCreationStatus === SiteCreationStatus.PENDING_RECREATION;
        this.#siteCreationStatus = SiteCreationStatus.NONE;
        if (wasPending) {
            log("Recreating previously pending")
            const wasHard = this.#pendingHardSiteCreation;
            this.#pendingHardSiteCreation = false;
            await this.recreateSite(wasHard);
        }
    }
    async abortSiteCreation() {
        this.#siteCreationStatus = SiteCreationStatus.NONE;
        this.#pendingHardSiteCreation = false;
    }
    async stop() {

        // Abort site creation if ongoing
        await this.abortSiteCreation()


        // Remove temp dir html path
        if (!this.#outputPathProvided && fs.existsSync(this.outputPath)) {
            fs.rmSync(this.outputPath, { recursive: true });
        }


        // Stop server       
        this.#app?.server?.close?.(); //(e) => { process.exit(); });


        // Stop watching for changes
        await this.#watcher?.close?.();
    }
}