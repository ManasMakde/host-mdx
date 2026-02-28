import fs from "fs";
import os from "os";
import net from "net";
import path from "path";
import sirv from "sirv";
import polka from "polka";
import ignore from "ignore";
import chokidar from "chokidar";
import { pathToFileURL } from "url";
import { mdxToHtml } from "./mdx-to-html.js";


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
const TEMP_HTML_DIR = path.join(os.tmpdir(), `${APP_NAME}`);
const DEFAULT_IGNORES = `
${IGNORE_FILE_NAME}
${CONFIG_FILE_NAME}
node_modules
package-lock.json
package.json
.git
.github
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
function createFile(filePath, fileContent = "") {

    // Check if path for file exists
    let fileLocation = path.dirname(filePath)
    if (!fs.existsSync(fileLocation)) {
        fs.mkdirSync(fileLocation, { recursive: true });
    }


    // Create file
    fs.writeFileSync(filePath, fileContent);
}
function crawlDir(dir) {
    const absDir = path.resolve(dir);
    let entries = fs.readdirSync(absDir, { recursive: true });
    return entries.map(file => path.join(absDir, file));
}
async function setupConfigs(configFilePath) {
    if (fs.existsSync(configFilePath)) {
        let cleanConfigFilePath = pathToFileURL(configFilePath).href
        return await import(cleanConfigFilePath);
    }

    return {};
}
async function startServer(hostDir, port, errorCallback) {  // Starts server at given port

    // Make sure host dir path is absolute
    hostDir = path.resolve(hostDir);


    // Start Server
    const assets = sirv(hostDir, { dev: true });
    const newApp = polka({
        onNoMatch: (req, res) => {
            // Set status code to 404
            res.statusCode = 404;


            // Send 404 file if found else not found message
            const errorFile = path.join(hostDir, FILE_404);
            if (fs.existsSync(errorFile)) {
                res.setHeader("Content-Type", "text/html");
                res.end(fs.readFileSync(errorFile));
            } else {
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
export function log(msg, toSkip = false) {
    if (toSkip) {  // Useful for verbose check
        return
    }

    let timestamp = new Date().toLocaleString(undefined, LOG_TIME_OPTIONS)
    console.log(`[${APP_NAME} ${timestamp}] ${msg}`)
}
export function createTempDir() {
    // Create default temp html dir
    fs.mkdirSync(TEMP_HTML_DIR, { recursive: true });


    // Generate time stamp
    const now = new Date()
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1)}-${now.getDate()}T${now.getHours()}_${now.getMinutes()}_${now.getSeconds()}`


    return fs.mkdtempSync(path.join(TEMP_HTML_DIR, `html-${timestamp}-`));
}
export function emptyDir(dirPath) {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
        const fullPath = path.join(dirPath, file);
        fs.rmSync(fullPath, { recursive: true, force: true });
    }
}
export async function getAvailablePort(startPort = DEFAULT_PORT, maxPort = MAX_PORT) {
    let currentPort = startPort;
    while (currentPort <= maxPort) {
        if (await isPortAvailable(currentPort)) {
            return currentPort;
        }

        currentPort++;
    }

    return -1;
}
export async function createSite(inputPath, outputPath, pathsToCreate = [], ignores = undefined, configs = undefined, interruptCondition = async () => false) {

    // Get all paths from `inputPath` if null `pathsToCreate` provided
    if (pathsToCreate == null) {
        pathsToCreate = crawlDir(inputPath);
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
        configs = await setupConfigs(configFilePath);
    }


    // Filter out paths based on ignore
    const filterResults = await Promise.all(pathsToCreate.map(async (currentPath) => {
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
        const toIgnore = await configs?.toIgnore?.(inputPath, outputPath, currentPath);
        if (toIgnore) {
            return false;
        }

        return true;
    }));
    pathsToCreate = pathsToCreate.filter((_, index) => filterResults[index]);


    // Return if no paths remaining to create after filtering for ignores
    if (pathsToCreate.length === 0) {
        log(`Skipping site creation since no paths to create`, !configs?.toBeVerbose);
        return;
    }


    // Modify rebuild paths based on configs
    pathsToCreate = await configs?.modRebuildPaths?.(inputPath, outputPath, pathsToCreate) ?? pathsToCreate;


    // Broadcast site creation started
    log("Creating site...");
    await configs?.onSiteCreateStart?.(inputPath, outputPath);


    // Iterate through all folders & files
    let wasInterrupted = false;
    let i = 0;
    while (i < pathsToCreate.length) {

        // Break all if interrupted
        let currentPath = pathsToCreate[i++];
        wasInterrupted = await interruptCondition(inputPath, outputPath, currentPath);
        if (wasInterrupted) {
            break;
        }


        // Delete if path does not exist
        const relToInput = path.relative(inputPath, currentPath);
        const absToOutput = path.join(outputPath, relToInput);
        if (!fs.existsSync(currentPath)) {
            log(`Deleting ${absToOutput}`, !configs?.toBeVerbose);
            fs.rmSync(absToOutput, { recursive: true });
            continue;
        }


        // Get essentials
        const isDir = fs.statSync(currentPath).isDirectory();
        const isMdx = !isDir && currentPath.endsWith(".mdx");


        // Make corresponding directory
        if (isDir) {
            log(`Creating ${currentPath} ---> ${absToOutput}`, !configs?.toBeVerbose);
            await configs?.onFileCreateStart?.(inputPath, outputPath, currentPath, absToOutput);
            fs.mkdirSync(absToOutput, { recursive: true });
            await configs?.onFileCreateEnd?.(inputPath, outputPath, currentPath, absToOutput, undefined);
        }
        // Make html file from mdx
        else if (!isDir && isMdx) {

            // Broadcast file creation started
            let absHtmlPath = path.format({ ...path.parse(absToOutput), base: "", ext: ".html" });
            log(`Creating ${currentPath} ---> ${absHtmlPath}`, !configs?.toBeVerbose);
            await configs?.onFileCreateStart?.(inputPath, outputPath, currentPath, absHtmlPath);


            // Intercept mdx code
            let mdxCode = fs.readFileSync(currentPath, "utf8");
            log(`Modifying mdx code of ${currentPath}`, !configs?.toBeVerbose || !configs?.modMDXCode);
            mdxCode = await configs?.modMDXCode?.(inputPath, outputPath, currentPath, absHtmlPath, mdxCode) ?? mdxCode;


            // convert mdx code into html & paste into file
            let parentDir = path.dirname(currentPath);
            let globalArgs = { hostmdxCwd: parentDir, hostmdxInputPath: inputPath, hostmdxOutputPath: outputPath };
            globalArgs = await configs?.modGlobalArgs?.(inputPath, outputPath, globalArgs) ?? globalArgs;
            let result = await mdxToHtml(mdxCode, parentDir, globalArgs, async (settings) => { return await configs?.modBundleMDXSettings?.(inputPath, outputPath, settings) ?? settings });
            let htmlCode = result.html;
            createFile(absHtmlPath, `<!DOCTYPE html>${htmlCode}`);


            // Broadcast file creation ended
            await configs?.onFileCreateEnd?.(inputPath, outputPath, currentPath, absHtmlPath, result);
        }
        // Copy paste file
        else if (!isDir) {
            log(`Creating ${currentPath} ---> ${absToOutput}`, !configs.toBeVerbose);
            await configs?.onFileCreateStart?.(inputPath, outputPath, currentPath, absToOutput);
            fs.copyFileSync(currentPath, absToOutput);
            await configs?.onFileCreateEnd?.(inputPath, outputPath, currentPath, absToOutput, undefined);
        }
    }


    // Broadcast site creation ended
    log(wasInterrupted ? `Site creation was interrupted!` : `Created site at ${outputPath}`);
    await configs?.onSiteCreateEnd?.(inputPath, outputPath, wasInterrupted);
}


// Classes
export class HostMdx {

    // Private Properties
    #inputPathProvided = false;
    #outputPathProvided = false;
    #siteCreationStatus = SiteCreationStatus.NONE;
    #pendingHardSiteCreation = false;
    #alteredPaths = [];


    // Constructors
    constructor(inputPath = "", outputPath = "", configs = {}) {
        this.#inputPathProvided = inputPath !== "";
        this.#outputPathProvided = outputPath !== "";
        this.inputPath = this.#inputPathProvided ? inputPath : process.cwd();
        this.outputPath = this.#outputPathProvided ? outputPath : createTempDir();
        this.app = null;
        this.watcher = null;
        this.ignores = null;
        this.configs = configs;
    }


    // Private Methods
    async #watchForChanges(event, path) {
        // Add changed path
        this.#alteredPaths.push(path);


        // Reflect changes immediately
        if (this.configs?.trackChanges !== undefined && this.configs?.trackChanges != TrackChanges.NONE) {
            let toHardReload = this.configs?.trackChanges == TrackChanges.HARD;
            log(`${toHardReload ? "Hard recreating" : "Recreating"} site, Event: ${event}, Path: ${path}`, !this.configs?.toBeVerbose);
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


        // Get port
        let port = this.configs?.port == undefined ? await getAvailablePort() : this.configs?.port;


        // Get configs
        let configFilePath = path.join(this.inputPath, `./${CONFIG_FILE_NAME}`);
        let doesConfigFileExists = fs.existsSync(configFilePath);
        log(`Importing config file ${configFilePath}`, !doesConfigFileExists);
        this.configs = { ...(await setupConfigs(configFilePath)), ...this.configs };


        // Get ignores
        let ignoreFilePath = path.join(this.inputPath, IGNORE_FILE_NAME);
        this.ignores = getIgnore(ignoreFilePath);


        // Broadcast hosting about to start
        await this.configs?.onHostStarting?.(this.inputPath, this.outputPath, port);


        // Watch for changes
        let chokidarOptions = { ...DEFAULT_CHOKIDAR_OPTIONS, ...(this.configs?.chokidarOptions ?? {}) };
        this.watcher = chokidar.watch(this.inputPath, chokidarOptions).on("all", (event, path) => this.#watchForChanges(event, path));


        // Delete old files & Create site
        emptyDir(this.outputPath);
        await this.recreateSite(true);


        // Start server to host site
        this.app = await startServer(this.outputPath, port, (e) => { log(`Failed to start server: ${e.message}`); throw e; });
        this.app?.server?.on("close", async () => { await this.configs?.onHostEnded?.(port); });


        // Broadcast hosting started
        await this.configs?.onHostStarted?.(this.inputPath, this.outputPath, port);


        // Load as started
        log(`Server listening at ${port} ...`);
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
            this.#pendingHardSiteCreation = hardReload;
            return;
        }


        // Set creating status to ongoing
        this.#siteCreationStatus = SiteCreationStatus.ONGOING;


        // Actual site creation
        try {
            let pathsToCreate = hardReload ? null : [...this.#alteredPaths];
            this.#alteredPaths = [];
            await createSite(this.inputPath, this.outputPath, pathsToCreate, this.ignores, this.configs, () => this.#siteCreationStatus != SiteCreationStatus.ONGOING);
        }
        catch (err) {
            log(`Failed to create site!\n${err.stack}`);
        }


        // If recreate was triggered while site creation was ongoing
        const wasPending = this.#siteCreationStatus === SiteCreationStatus.PENDING_RECREATION;
        this.#siteCreationStatus = SiteCreationStatus.NONE;
        if (wasPending) {
            await this.recreateSite(this.#pendingHardSiteCreation);
        }
    }
    async abortSiteCreation() {
        this.#siteCreationStatus = SiteCreationStatus.NONE;
    }
    async stop() {
        // Remove temp dir html path
        if (!this.#outputPathProvided && fs.existsSync(this.outputPath)) {
            fs.rmSync(this.outputPath, { recursive: true, force: true });
        }


        // Stop server       
        this.app?.server?.closeAllConnections?.(); //(e) => { process.exit(); });


        // Stop watching for changes
        this.watcher?.close?.();
    }
}