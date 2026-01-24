#!/usr/bin/env node

import fs from 'fs'
import os from 'os'
import path from 'path'
import polka from 'polka';
import sirv from 'sirv';
import ignore from "ignore";
import chokidar from 'chokidar';
import * as readline from 'readline';
import { pathToFileURL } from 'url';
import { mdxToHtml } from './mdx-to-html.js'


// To-Set Properties
const APP_NAME = "host-mdx";
const DEFAULT_PORT = 3000;
const IGNORE_FILE_NAME = ".hostmdxignore";
const CONFIG_FILE_NAME = "host-mdx.js";
const NOT_FOUND_404_FILE = "404.html"
const NOT_FOUND_404_MESSAGE = "404"
const DEFAULT_IGNORES = `
${IGNORE_FILE_NAME}
${CONFIG_FILE_NAME}
node_modules
package-lock.json
package.json
.git
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


    // Get config properties
    let configFilePath = path.join(inputPath, `./${CONFIG_FILE_NAME}`)
    if (fs.existsSync(configFilePath)) {

        configs = await import(pathToFileURL(configFilePath).href);
    }


    // Broadcast site creation started
    log("Creating site...")
    configs?.onSiteCreateStart?.(inputPath, outputPath)


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
            configs?.onFileCreateStart?.(currentPath, absToOutput)
            fs.mkdirSync(absToOutput, { recursive: true });
            configs?.onFileCreateEnd?.(currentPath, absToOutput)
        }
        // Make html file from mdx
        else if (!isDir && isMdx) {

            // Broadcast file creation started
            let absHtmlPath = path.format({ ...path.parse(absToOutput), base: '', ext: '.html' })
            log(`${currentPath} ---> ${absHtmlPath}`, true)
            configs?.onFileCreateStart?.(currentPath, absHtmlPath)


            // convert mdx code into html & paste into file
            let mdxCode = fs.readFileSync(currentPath, 'utf8');
            let parentDir = path.dirname(currentPath)
            let htmlCode = await mdxToHtml(mdxCode, parentDir, configs?.modBundleMDXSettings);
            createFile(absHtmlPath, `<!DOCTYPE html>\n${htmlCode}`);


            // Broadcast file creation ended
            configs?.onFileCreateEnd?.(currentPath, absHtmlPath)
        }
        // Copy paste file
        else if (!isDir) {
            log(`${currentPath} ---> ${absToOutput}`, true)
            configs?.onFileCreateStart?.(currentPath, absToOutput)
            fs.copyFileSync(currentPath, absToOutput)
            configs?.onFileCreateEnd?.(currentPath, absToOutput)
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
    log(`Created site at ${outputPath}`)
    configs?.onSiteCreateEnd?.(inputPath, outputPath, isCreateSitePending)


    // Reinvoke creation
    if(isCreateSitePending){
        await createSite(inputPath, outputPath);
    }
}
function filterArgs(rawArgs) {
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


    // Assign port
    let port = rawArgs.find(val => val.startsWith(PORT_FLAG));
    let portProvided = port !== undefined;
    port = portProvided ? Number(port.split('=')[1]) : DEFAULT_PORT;


    // Check port
    if (!Number.isInteger(port)) {
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
        log(`Failed to create site!\n${err}`);
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
            app.server.close((e) => { process.exit() })
        }
    });
}
function startServer(htmlDir, port) {  // Starts server at given port

    // Broadcast server starting
    configs?.onHostStart?.(port)


    // Start Server
    const assets = sirv(htmlDir, { dev: true });
    const newApp = polka({
        onNoMatch: (req, res) => {

            // Set status code to 404
            res.statusCode = 404;


            // Send 404 file if found otherwise default not found message
            const errorFile = path.join(htmlDir, NOT_FOUND_404_FILE);
            if (fs.existsSync(errorFile)) {
                res.setHeader('Content-Type', 'text/html');
                res.end(fs.readFileSync(errorFile));
            } else {
                res.end(NOT_FOUND_404_MESSAGE);
            }
        }
    }).use(assets)

    newApp.listen(port)
    newApp.server.on("close", () => { configs?.onHostEnd?.(port) });
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
    let args = filterArgs(rawArgs);
    if (args === null) {
        return;
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
        chokidar.watch(args.inputPath, {
            ignoreInitial: true
        }).on('all', (event, path) => {
            createSiteSafe(args.inputPath, args.outputPath)
        });
    }


    // Start server
    app = startServer(args.outputPath, args.port);


    // Handle quit
    const cleanup = () => {
        // Remove html path
        if (!args.outputPathProvided && fs.existsSync(args.outputPath)) {
            fs.rmSync(args.outputPath, { recursive: true, force: true })
        }
    }
    process.on("exit", cleanup);
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
}

Main()