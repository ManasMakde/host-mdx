#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path'
import sirv from 'sirv';
import polka from 'polka';
import ignore from 'ignore';
import chokidar from 'chokidar';
import * as readline from 'readline';
import { pathToFileURL } from 'url';
import { mdxToHtml } from './mdx-to-html.js';


// To-Set Properties
const APP_NAME = "host-mdx";
const DEFAULT_PORT = 3000;
const MAX_PORT = 3002;
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


// Flags
const CREATE_FLAG = "--create-only";
const CREATE_SHORT_FLAG = "-c";
const HELP_FLAG = "--help";
const HELP_SHORT_FLAG = "-h";
const INPUT_PATH_FLAG = "--input-path";
const OUTPUT_PATH_FLAG = "--output-path";
const PORT_FLAG = "--port";
const VERBOSE_FLAG = "--verbose";
const VERBOSE_SHORT_FLAG = "-v";
const TRACK_CHANGES_FLAG = "--track-changes";
const TRACK_CHANGES_SHORT_FLAG = "-t";


// Messages & Errors
const HELP_MESSAGE = `Usage: host-mdx [options]

Options:
${CREATE_FLAG}, ${CREATE_SHORT_FLAG}     Only create the html website from mdx does not host
${HELP_FLAG}, ${HELP_SHORT_FLAG}            Shows all available options
${INPUT_PATH_FLAG}=...      The path at which all mdx files are stored
${OUTPUT_PATH_FLAG}=...     The path to which all html files will be generated
${PORT_FLAG}=...            Localhost port number on which to host 
${TRACK_CHANGES_FLAG}, ${TRACK_CHANGES_SHORT_FLAG}   Tracks any changes made & auto reloads
${VERBOSE_FLAG}, ${VERBOSE_SHORT_FLAG}         Shows additional log messages
`;


// Private Properties
let isCreatingSite = false;  // Prevents site from being recreated if creation is already ongoing
let isCreateSitePending = false  // Keeps track if files have been modified and site needs to be recreated
let isVerbose = false;
let configs;
let app;
const TEMP_HTML_DIR = path.join(os.tmpdir(), `${APP_NAME}`);
const TIME_OPTIONS = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    fractionalSecondDigits: 3
};


// Utility Methods
function log(msg, checkVerbose = false) {
    if (checkVerbose && !isVerbose) {
        return
    }

    let timestamp = new Date().toLocaleString(undefined, TIME_OPTIONS)
    console.log(`[${APP_NAME} ${timestamp}] ${msg}`)
}
function createTempDir() {
    // Create default temp html dir
    fs.mkdirSync(TEMP_HTML_DIR, { recursive: true });


    // Generate time stamp
    const now = new Date()
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1)}-${now.getDate()}T${now.getHours()}_${now.getMinutes()}_${now.getSeconds()}`


    return fs.mkdtempSync(path.join(TEMP_HTML_DIR, `html-${timestamp}-`));
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
async function createSite(inputPath, outputPath) {
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
            log(`${currentPath} ---> ${absToOutput}`, true)
            await configs?.onFileCreateStart?.(inputPath, outputPath, currentPath, absToOutput)
            fs.mkdirSync(absToOutput, { recursive: true });
            await configs?.onFileCreateEnd?.(inputPath, outputPath, currentPath, absToOutput, undefined)
        }
        // Make html file from mdx
        else if (!isDir && isMdx) {

            // Broadcast file creation started
            let absHtmlPath = path.format({ ...path.parse(absToOutput), base: '', ext: '.html' })
            log(`${currentPath} ---> ${absHtmlPath}`, true)
            await configs?.onFileCreateStart?.(inputPath, outputPath, currentPath, absHtmlPath, undefined)


            // convert mdx code into html & paste into file
            let mdxCode = fs.readFileSync(currentPath, 'utf8');
            let parentDir = path.dirname(currentPath)
            let globalArgs = {
                hostmdxCwd: parentDir,
                hostmdxInputPath: inputPath,
                hostmdxOutputPath: outputPath
            };
            let result = await mdxToHtml(mdxCode, parentDir, globalArgs, async (settings) => { return await configs?.modBundleMDXSettings?.(inputPath, outputPath, settings) ?? settings });
            let htmlCode = result.html;
            createFile(absHtmlPath, `<!DOCTYPE html>\n${htmlCode}`);


            // Broadcast file creation ended
            await configs?.onFileCreateEnd?.(inputPath, outputPath, currentPath, absHtmlPath, result)
        }
        // Copy paste file
        else if (!isDir) {
            log(`${currentPath} ---> ${absToOutput}`, true)
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
async function isPortAvailable(port) {
    const server = net.createServer();
    server.unref();

    return new Promise((resolve) => {
        server.once('error', () => {
            server.close();
            resolve(false);
        });

        server.once('listening', () => {
            server.close(() => resolve(true));
        });

        server.listen(port);
    });
}
async function getAvailablePort(startPort, maxPort) {
    let currentPort = startPort;
    while (currentPort <= maxPort) {
        if (await isPortAvailable(currentPort)) {
            return currentPort;
        }

        currentPort++;
    }

    return -1;
}
function stripTrailingSep(thePath) {
    if (thePath[thePath.length - 1] === path.sep) {
        return thePath.slice(0, -1);
    }
    return thePath;
}
function isSubPath(potentialParent, thePath) {
    // For inside-directory checking, we want to allow trailing slashes, so normalize.
    thePath = stripTrailingSep(thePath);
    potentialParent = stripTrailingSep(potentialParent);


    // Node treats only Windows as case-insensitive in its path module; we follow those conventions.
    if (process.platform === "win32") {
        thePath = thePath.toLowerCase();
        potentialParent = potentialParent.toLowerCase();
    }


    return thePath.lastIndexOf(potentialParent, 0) === 0 &&
        (
            thePath[potentialParent.length] === path.sep ||
            thePath[potentialParent.length] === undefined
        );
}
async function filterArgs(rawArgs) {
    // Assign to create
    let toCreateOnly = rawArgs.includes(CREATE_FLAG) || rawArgs.includes(CREATE_SHORT_FLAG)


    // Assign input path
    let inputPath = rawArgs.find(val => val.startsWith(INPUT_PATH_FLAG));
    let inputPathProvided = inputPath !== undefined;
    inputPath = inputPathProvided ? inputPath.split('=')[1] : process.cwd();


    // Check input path
    if (!fs.existsSync(inputPath) || !fs.lstatSync(inputPath).isDirectory()) {
        log(`Invalid input path "${inputPath}"`)
        return null;
    }
    else {
        inputPath = inputPath !== "" ? path.resolve(inputPath) : inputPath;  // To ensure input path is absolute
    }


    // Assign output path
    let outputPath = rawArgs.find(val => val.startsWith(OUTPUT_PATH_FLAG));
    let outputPathProvided = outputPath !== undefined;
    outputPath = outputPathProvided ? outputPath.split('=')[1] : createTempDir();


    // Check output path
    if (!fs.existsSync(outputPath) || !fs.lstatSync(outputPath).isDirectory()) {
        log(`Invalid output path "${outputPath}"`)
        return null;
    }
    else {
        outputPath = outputPath !== "" ? path.resolve(outputPath) : outputPath;  // To ensure output path is absolute
    }


    // Check if output path is inside input path (causing infinite loop)
    if (isSubPath(inputPath, outputPath)) {
        log(`Output path "${outputPath}" cannot be inside or same as input path "${inputPath}"`);
        return null;
    }


    // Assign port
    let port = rawArgs.find(val => val.startsWith(PORT_FLAG));
    let portProvided = port !== undefined;
    port = portProvided ? Number(port.split('=')[1]) : (await getAvailablePort(DEFAULT_PORT, MAX_PORT));


    // Check port
    if (port === -1) {
        log(`Could not find any available ports between ${DEFAULT_PORT} to ${MAX_PORT}, Try manually passing ${PORT_FLAG}=... flag`);
        return null;
    }
    else if (!Number.isInteger(port)) {
        log(`Invalid port`)
        return null;
    }


    // Assign tracking changes
    let toTrackChanges = rawArgs.includes(TRACK_CHANGES_FLAG) || rawArgs.includes(TRACK_CHANGES_SHORT_FLAG);


    return { toCreateOnly, inputPath, inputPathProvided, outputPath, outputPathProvided, toTrackChanges, port, portProvided, };
}


// Main Methods
async function createSiteSafe(...args) {

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

    process.stdin.on('keypress', (chunk, key) => {
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
    }).on('all', callback);
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
                res.setHeader('Content-Type', 'text/html');
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
async function Main() {

    // Get all arguments
    const rawArgs = process.argv.slice(2);


    // Check if verbose
    isVerbose = rawArgs.includes(VERBOSE_FLAG) || rawArgs.includes(VERBOSE_SHORT_FLAG);


    // Check if asked for help
    if (rawArgs.includes(HELP_FLAG) || rawArgs.includes(HELP_SHORT_FLAG)) {
        console.log(HELP_MESSAGE)
        return;
    }


    // Filter arguments
    let args = await filterArgs(rawArgs);
    if (args === null) {
        return;
    }


    // Get config
    let configFilePath = path.join(args.inputPath, `./${CONFIG_FILE_NAME}`)
    if (fs.existsSync(configFilePath)) {
        log(`Importing config file ${CONFIG_FILE_NAME}`);
        configs = await import(pathToFileURL(configFilePath).href);
    }


    // Create site from mdx & return if only needed to create site
    let wasCreated = await createSiteSafe(args.inputPath, args.outputPath);
    if (args.toCreateOnly) {
        process.exitCode = !wasCreated ? 1 : 0;  // Exit with error code if not created successfully
        return;
    }


    // Watch for key presses
    listenForKey(() => createSiteSafe(args.inputPath, args.outputPath));


    // Watch for changes
    if (args.toTrackChanges) {
        watchForChanges(args.inputPath, async (event, path) => {
            if (typeof configs.toTriggerRecreate === 'function' && !(await configs?.toTriggerRecreate(event, path))) {
                return;
            }

            log(`Recreating site, Event: ${event}, Path: ${path}`, true)
            createSiteSafe(args.inputPath, args.outputPath)
        });
    }


    // Start server
    app = await startServer(args.outputPath, args.port);


    // Handle quit
    const cleanup = () => {
        // Remove html path
        if (!args.outputPathProvided && fs.existsSync(args.outputPath)) {
            fs.rmSync(args.outputPath, { recursive: true, force: true })
        }

        process.stdin.setRawMode(false);
    }
    process.on("exit", cleanup);
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
}

Main()