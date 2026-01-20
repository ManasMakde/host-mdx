#!/usr/bin/env node

import fs from 'fs'
import os from 'os'
import path from 'path'
import http from 'http'
import ignore from "ignore";
import chokidar from 'chokidar';
import * as readline from 'readline';
import { mdxToHtml } from './mdx-to-html.js'


// To-Set Properties
const APP_NAME = "host-mdx"
const DEFAULT_PORT = 3000
const IGNORE_FILE_NAME = ".hostmdxignore"
const CONFIG_FILE_NAME = "host-mdx.js"
const DEFAULT_IGNORES = `
${IGNORE_FILE_NAME}
${CONFIG_FILE_NAME}
node_modules
package-lock.json
package.json
.git
`


// Flags
const CREATE_FLAG = "--create-only"
const CREATE_SHORT_FLAG = "-c"
const HELP_FLAG = "--help"
const HELP_SHORT_FLAG = "-h"
const INPUT_PATH_FLAG = "--input-path"
const OUTPUT_PATH_FLAG = "--output-path"
const PORT_FLAG = "--port"
const VERBOSE_FLAG = "--verobse"
const VERBOSE_SHORT_FLAG = "-v"
const TRACK_CHANGES_FLAG = "--track-changes"
const TRACK_CHANGES_SHORT_FLAG = "-t"


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
`


// Private Properties
let isCreatingSite = false  // Prevents site from being recreated if creation is already ongoing
let isVerbose = false
let configs
let server
const TEMP_HTML_DIR = path.join(os.tmpdir(), `${APP_NAME}`)
const TIME_OPTIONS = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    fractionalSecondDigits: 3
}
const MIME_TYPE = {  // Maps extensions to mime protocol
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.wav': 'audio/wav',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
}


// Utility Methods
function log(msg, checkVerbose = false) {
    if (checkVerbose && !isVerbose) {
        return
    }

    let timestamp = new Date().toLocaleString(undefined, TIME_OPTIONS)
    console.log(`[${APP_NAME} ${timestamp}] ${msg}`)
}
function createTempDir() {

    // Delete existing temp dir
    if (fs.existsSync(TEMP_HTML_DIR)) {
        fs.rmSync(TEMP_HTML_DIR, { recursive: true, force: true })
    }


    // Create default temp html dir
    fs.mkdirSync(TEMP_HTML_DIR, { recursive: true })


    return fs.mkdtempSync(path.join(TEMP_HTML_DIR, `/html-`));
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
        log("site creation already ongoing!")
        return
    }


    // Set creating status to ongoing
    isCreatingSite = true


    // Get config properties
    let configFilePath = path.join(inputPath, `./${CONFIG_FILE_NAME}`)
    if (fs.existsSync(configFilePath)) {
        configs = await import(configFilePath);
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
    while (stack.length > 0) {
        // Continue if path does not exist
        const currentPath = stack.pop()
        if(!fs.existsSync(currentPath)){
            continue;
        }

        
        // Get essentials
        const relToInput = path.relative(inputPath, currentPath)
        const toIgnore = inputPath != currentPath && ig.ignores(relToInput)
        const absToOutput = path.join(outputPath, relToInput)
        const isDir = fs.statSync(currentPath).isDirectory()
        const isMdx = !isDir && absToOutput.endsWith(".mdx")


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
    log("Created site")
    configs?.onSiteCreateEnd?.(inputPath, outputPath)
}


// Main Methods
async function createSiteSafe(...args) {
    try {
        await createSite(...args);
    }
    catch (err) {
        isCreatingSite = false
        console.log(err);
        log("Failed to create site!");
    }
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
            server.close((e) => { process.exit() })
        }
    });
}
function startServer(htmlDir, port) {  // Starts server at given port
    
    // Broadcast server starting
    configs?.onHostStart?.(port)


    // Start Server
    const newServer = http.createServer((req, res) => {

        // Parse & Sanitize URL
        let parsedUrl = new URL("http://" + req.headers.host + req.url)
        let sanitizedUrl = path.normalize(parsedUrl.pathname).replace(/^(\.\.[\/\\])+/, '')
        let isDirectory = !Boolean(path.parse(sanitizedUrl).ext)
        let relativeFilePath = path.normalize(sanitizedUrl + (isDirectory ? "/index.html" : ""))
        let absoluteFilePath = path.join(path.resolve(htmlDir), relativeFilePath)
        let pathExists = fs.existsSync(absoluteFilePath)

        // Respondes with content of file
        if (pathExists)
            // read file from file system
            fs.readFile(absoluteFilePath, function (err, data) {
                if (err) {
                    res.statusCode = 500
                    res.end(`Error getting the file: ${err}.`)
                }
                else {
                    // Based on the URL path, extract the file extention. e.g. .js, .doc, ...
                    const ext = path.parse(absoluteFilePath).ext
                    res.setHeader('Content-type', MIME_TYPE[ext] || 'text/plain') // if the file is found, set Content-type and send data
                    res.end(data)
                }

            })
        else { // Respondes with 404 if file not found
            res.statusCode = 404
            res.end(`404 Invalid url not found!`)
        }
    })
    newServer.listen(port, () => { log(`Server listening at ${port} ... (Press 'r' to manually reload, Press 'Ctrl+c' to exit)`) })
    newServer.on("close", () => { configs?.onHostEnd?.(port) });
    newServer.on("error", (e) => { log(`Error Starting server ${e.message}`); throw e; });


    return newServer
}
async function Main() {
    // Get all arguments
    const args = process.argv.slice(2)


    // Check if asked for help
    if (args.includes(HELP_FLAG) || args.includes(HELP_SHORT_FLAG)) {
        console.log(HELP_MESSAGE)
        return;
    }


    // Assign to create
    let toCreateOnly = args.includes(CREATE_FLAG) || args.includes(CREATE_SHORT_FLAG)

    // Assign input path
    let inputPath = args.find(val => val.startsWith(INPUT_PATH_FLAG))
    inputPath = inputPath !== undefined ? inputPath.split('=')[1] : process.cwd()

    // Assign output path
    let outputPath = args.find(val => val.startsWith(OUTPUT_PATH_FLAG))
    let outputPathProvided = outputPath !== undefined
    outputPath = outputPathProvided ? outputPath.split('=')[1] : createTempDir()

    // Assign tracking changes
    let toTrackChanges = args.includes(TRACK_CHANGES_FLAG) || args.includes(TRACK_CHANGES_SHORT_FLAG)

    // Assign port
    let port = args.find(val => val.startsWith(PORT_FLAG))
    port = port !== undefined ? Number(port.split('=')[1]) : DEFAULT_PORT

    // Assign verbose
    isVerbose = args.includes(VERBOSE_FLAG) || args.includes(VERBOSE_SHORT_FLAG)


    // Check input path
    if (!fs.existsSync(inputPath) || !fs.lstatSync(inputPath).isDirectory()) {
        log(`Invalid input path "${inputPath}"`)
        return
    }

    // Check output path
    if (!fs.existsSync(outputPath) || !fs.lstatSync(outputPath).isDirectory()) {
        log(`Invalid output path "${outputPath}"`)
        return
    }

    // Check port
    if (!Number.isInteger(port)) {
        log(`Invalid port`)
        return
    }


    // Create site from mdx & return if only needed to create site
    await createSiteSafe(inputPath, outputPath)
    if (toCreateOnly) {
        return;
    }


    // Watch for key presses
    listenForKey(() => createSiteSafe(inputPath, outputPath))


    // Watch for changes
    if (toTrackChanges) {
        chokidar.watch(inputPath, { 
            ignoreInitial: true,
            ignored: (path, stats) => isCreatingSite  // Ignore if site creation is ongoing
        }).on('all', (event, path) => {
            createSiteSafe(inputPath, outputPath)
        });
    }


    // Start server
    server = startServer(outputPath, port)


    // Handle quit
    process.on("exit", () => {
        // Remove html path
        if (!outputPathProvided && fs.existsSync(outputPath)) {
            fs.rmSync(outputPath, { recursive: true, force: true })
        }

        process.exit(0);
    });
}

Main()