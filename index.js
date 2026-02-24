#!/usr/bin/env node

import fs from "fs";
import os from "os";
import net from "net";
import path from "path"
import sirv from "sirv";
import polka from "polka";
import ignore from "ignore";
import chokidar from "chokidar";
import { pathToFileURL } from "url";
import * as readline from "readline";
import { mdxToHtml } from "./mdx-to-html.js";


// To-Set Properties
export const DEFAULT_PORT = 3000;
export const MAX_PORT = 4000;
const APP_NAME = "host-mdx";
const IGNORE_FILE_NAME = ".hostmdxignore";
const CONFIG_FILE_NAME = "host-mdx.js";
const FILE_404 = "404.html";
const NOT_FOUND_404_MESSAGE = "404";
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


// Private Properties
let isCreatingSite = false;  // Prevents site from being recreated if creation is already ongoing
let isCreateSitePending = false  // Keeps track if files have been modified and site needs to be recreated
let configs;
let app;
const TEMP_HTML_DIR = path.join(os.tmpdir(), `${APP_NAME}`);
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
const DEFAULT_HOST_OPTIONS = {
    port: undefined,
    toTrackChanges: false,
    toBeVerbose: false
};


// Utility Methods
export function log(msg, toSkip = false) {
    if (toSkip) {  // Useful for verbose check
        return
    }

    let timestamp = new Date().toLocaleString(undefined, LOG_TIME_OPTIONS)
    console.log(`[${APP_NAME} ${timestamp}] ${msg}`)
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
function getIgnore(ignoreFilePath) {
    const ig = ignore();
    let ignoreContent = DEFAULT_IGNORES

    if (fs.existsSync(ignoreFilePath)) {
        ignoreContent += `\n${fs.readFileSync(ignoreFilePath, "utf8")}`
    }

    ig.add(ignoreContent);

    return ig
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
async function createSite(inputPath, outputPath, toBeVerbose = false) {
    // Exit if already creating
    if (isCreatingSite) {
        log("Site creation already ongoing! Added to pending")
        isCreateSitePending = true
        return
    }


    // Set creating status to ongoing
    isCreatingSite = true
    isCreateSitePending = false


    // Broadcast site creation started
    log("Creating site...")
    await configs?.onSiteCreateStart?.(inputPath, outputPath)


    // Remove html folder if it already exists
    if (fs.existsSync(outputPath)) {
        fs.rmSync(outputPath, { recursive: true, force: true });
    }


    // Setup ignore
    let ignoreFilePath = path.join(inputPath, IGNORE_FILE_NAME)
    let ig = getIgnore(ignoreFilePath)


    // Iterate through all folders & files
    const stack = [inputPath];
    while (stack.length > 0 && !isCreateSitePending) {
        // Continue if path does not exist
        const currentPath = stack.pop()
        if (!fs.existsSync(currentPath)) {
            continue;
        }


        // Get essentials
        const relToInput = path.relative(inputPath, currentPath)
        const toIgnore = inputPath != currentPath && ig.ignores(relToInput)
        const absToOutput = path.join(outputPath, relToInput)
        const isDir = fs.statSync(currentPath).isDirectory()
        const isMdx = !isDir && currentPath.endsWith(".mdx")


        // Skip if to ignore this path
        if (toIgnore) {
            continue
        }


        // Make dir
        if (isDir) {
            log(`${currentPath} ---> ${absToOutput}`, !toBeVerbose)
            await configs?.onFileCreateStart?.(inputPath, outputPath, currentPath, absToOutput)
            fs.mkdirSync(absToOutput, { recursive: true });
            await configs?.onFileCreateEnd?.(inputPath, outputPath, currentPath, absToOutput, undefined)
        }
        // Make html file from mdx
        else if (!isDir && isMdx) {

            // Broadcast file creation started
            let absHtmlPath = path.format({ ...path.parse(absToOutput), base: "", ext: ".html" })
            log(`${currentPath} ---> ${absHtmlPath}`, !toBeVerbose)
            await configs?.onFileCreateStart?.(inputPath, outputPath, currentPath, absHtmlPath)


            // Intercept mdx code
            let mdxCode = fs.readFileSync(currentPath, "utf8");
            if (typeof configs?.modMDXCode === "function") {
                log(`Modifying mdx code of ${currentPath}`, !toBeVerbose);
                mdxCode = await configs?.modMDXCode(inputPath, outputPath, currentPath, absHtmlPath, mdxCode);
            }


            // convert mdx code into html & paste into file
            let parentDir = path.dirname(currentPath);
            let globalArgs = {
                hostmdxCwd: parentDir,
                hostmdxInputPath: inputPath,
                hostmdxOutputPath: outputPath
            };
            globalArgs = await configs?.modGlobalArgs?.(inputPath, outputPath, globalArgs) ?? globalArgs;
            let result = await mdxToHtml(mdxCode, parentDir, globalArgs, async (settings) => { return await configs?.modBundleMDXSettings?.(inputPath, outputPath, settings) ?? settings });
            let htmlCode = result.html;
            createFile(absHtmlPath, `<!DOCTYPE html>${htmlCode}`);


            // Broadcast file creation ended
            await configs?.onFileCreateEnd?.(inputPath, outputPath, currentPath, absHtmlPath, result)
        }
        // Copy paste file
        else if (!isDir) {
            log(`${currentPath} ---> ${absToOutput}`, !toBeVerbose)
            await configs?.onFileCreateStart?.(inputPath, outputPath, currentPath, absToOutput)
            fs.copyFileSync(currentPath, absToOutput)
            await configs?.onFileCreateEnd?.(inputPath, outputPath, currentPath, absToOutput, undefined)
        }


        // Skip if current path is a file or a directory to ignore
        if (!isDir) {
            continue
        }


        // Add to stack if current path is dir
        const files = fs.readdirSync(currentPath);
        for (const file of files) {
            stack.push(path.join(currentPath, file));
        }
    }


    // Unset creating status & Notify
    isCreatingSite = false;


    // Broadcast site creation ended
    if (isCreateSitePending) {
        log(`Restarting site creation...`)
    }
    else {
        log(`Created site at ${outputPath}`)
    }
    await configs?.onSiteCreateEnd?.(inputPath, outputPath, isCreateSitePending)


    // Reinvoke creation
    if (isCreateSitePending) {
        await createSite(inputPath, outputPath);
    }
}
export function createTempDir() {
    // Create default temp html dir
    fs.mkdirSync(TEMP_HTML_DIR, { recursive: true });


    // Generate time stamp
    const now = new Date()
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1)}-${now.getDate()}T${now.getHours()}_${now.getMinutes()}_${now.getSeconds()}`


    return fs.mkdtempSync(path.join(TEMP_HTML_DIR, `html-${timestamp}-`));
}


// Main Methods
export async function createSiteSafe(...args) {

    let success = true;
    try {
        await createSite(...args);
    }
    catch (err) {
        success = false;
        isCreatingSite = false;
        log(`Failed to create site!\n${err.stack}`);
    }

    return success;
}
async function listenForKey(createSiteCallback) {

    readline.emitKeypressEvents(process.stdin);

    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }

    process.stdin.on("keypress", (chunk, key) => {
        if (key && key.name == 'r') {
            createSiteCallback();
        }
        else if (key && key.sequence == '\x03') {
            app?.server?.close((e) => { process.exit() })
        }
    });
}
async function watchForChanges(pathTowatch, callback) {
    chokidar.watch(pathTowatch, {
        ignoreInitial: true
    }).on("all", callback);
}
async function startServer(htmlDir, port) {  // Starts server at given port

    // Broadcast server starting
    await configs?.onHostStart?.(port)


    // Start Server
    const assets = sirv(htmlDir, { dev: true });
    const newApp = polka({
        onNoMatch: (req, res) => {
            // Set status code to 404
            res.statusCode = 404;


            // Send 404 file if found else not found message
            const errorFile = path.join(htmlDir, FILE_404);
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
    newApp.server.on("close", async () => { await configs?.onHostEnd?.(port) });
    newApp.server.on("error", (e) => { log(`Failed to start server: ${e.message}`); throw e; });
    log(`Server listening at ${port} ... (Press 'r' to manually reload, Press 'Ctrl+c' to exit)`)


    return newApp
}
export async function host(inputPath, outputPath = "", options = DEFAULT_HOST_OPTIONS) {

    // Fill in for missing options
    options = { ...DEFAULT_HOST_OPTIONS, ...options };


    // Create temp dir if no output path provided
    let outputPathProvided = outputPath !== "";
    if (!outputPathProvided) {
        outputPath = createTempDir();
    }


    // Auto Calculate port if no port provided
    if (options.port === undefined) {
        options.port = await getAvailablePort();
    }


    // Get config
    let configFilePath = path.join(inputPath, `./${CONFIG_FILE_NAME}`)
    if (fs.existsSync(configFilePath)) {
        log(`Importing config file ${CONFIG_FILE_NAME}`);
        configs = await import(pathToFileURL(configFilePath).href);
    }


    // Create site from mdx & return if only needed to create site
    let wasCreated = await createSiteSafe(inputPath, outputPath, options.toBeVerbose);
    if (options.toCreateOnly) {
        process.exitCode = !wasCreated ? 1 : 0;  // Exit with error code if not created successfully
        return;
    }


    // Watch for key presses
    listenForKey(() => createSiteSafe(inputPath, outputPath, options.toBeVerbose));


    // Watch for changes
    if (options.toTrackChanges) {
        watchForChanges(inputPath, async (event, path) => {
            if (typeof configs?.toTriggerRecreate === 'function' && !(await configs?.toTriggerRecreate(event, path))) {
                return;
            }

            log(`Recreating site, Event: ${event}, Path: ${path}`, true)
            createSiteSafe(inputPath, outputPath, options.toBeVerbose)
        });
    }


    // Start server
    app = await startServer(outputPath, options.port);


    // Handle quit
    const cleanup = () => {
        // Remove html path
        if (!outputPathProvided && fs.existsSync(outputPath)) {
            fs.rmSync(outputPath, { recursive: true, force: true })
        }

        process.stdin.setRawMode(false);
    }
    process.on("exit", cleanup);
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
}