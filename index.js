#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import process from "node:process"
import { pathToFileURL } from "node:url"
import { minify } from 'html-minifier-terser'
import * as runtime from 'react/jsx-runtime'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { evaluate } from '@mdx-js/mdx'
import rehypeHighlight from "rehype-highlight";
import { common } from 'lowlight'
import gdscript from "@exercism/highlightjs-gdscript"
import * as readline from 'node:readline';


// Constants
const DEFAULT_PORT = 3000
const APP_NAME = "host-mdx"
const TEMP_HTML_DIR = path.join(os.tmpdir(), `${APP_NAME}`)
const HELP_MESSAGE = `deno ${APP_NAME} [mdx-path] [<optional-port-number>] [<optional-html-dir>]`
const STARTED_CREATING_SITE = `==== Started creating site ==== `
const FINISHED_CREATING_SITE = `==== Finished creating site ==== `
const INVALID_MDX_DIR_ERROR = `Invalid mdx directory (1st argument) provided!`
const INVALID_PORT_NUMBER_ERROR = `Invalid port number (2nd argument) provided!`
const INVALID_HTML_DIR_ERROR = `Invalid html directory (3rd argument) could not create/find!`
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
let is_creating_site = false  // Prevents site from being recreated if creation is ongoing


// Functions
async function mdx_to_html(mdx_code, base_url) {  // converts mdx code into html code, `base_url` is the path from where all the mdx import path relatively work from

    const jsx = (await evaluate(mdx_code, {
        ...runtime,
        rehypePlugins: [[rehypeHighlight, { languages: { ...common, gdscript } }]],
        baseUrl: base_url
    })).default
    const html_code = renderToString(createElement(jsx))

    return minify(html_code, { minifyCSS: true })

}
async function create_site(create_from_path, create_at_path) {
    // Exit if already creating
    if (is_creating_site) {
        return
    }


    // Set creating status to ongoing
    is_creating_site = true
    console.log(STARTED_CREATING_SITE)


    // Remove html folder if it already exists
    if (fs.existsSync(create_at_path)) {
        fs.rmSync(create_at_path, { recursive: true, force: true });
    }


    // copy paste directory
    fs.cpSync(create_from_path, create_at_path, { recursive: true });


    // Iterate through files
    let files = fs.readdirSync(create_from_path, { withFileTypes: true, recursive: true });

    for (const file of files) {
        const file_path = path.join(file.parentPath, file.name)

        if (file.isFile() && file_path.endsWith(".mdx")) {

            // To ensure file paths work
            process.chdir(file.parentPath);

            let base_url = pathToFileURL(path.normalize(path.join(create_from_path, path.sep))).href  // Converts file into file uri i.e "file:///my/path/"
            let mdx_code = fs.readFileSync(file_path, 'utf8');
            let html_code = await mdx_to_html(mdx_code, base_url);
            let html_file_path = file_path.replace(create_from_path, create_at_path).replace(".mdx", ".html")
            let html_dir_path = path.dirname(html_file_path)


            // Make directory if it doesn't exist
            if (!fs.existsSync(html_dir_path)) {
                fs.mkdirSync(html_dir_path, { recursive: true })
            }


            // write to file
            fs.writeFileSync(html_file_path, html_code);
        }

    }

    is_creating_site = false;
    console.log(FINISHED_CREATING_SITE)
}
async function watch_for_reload(mdx_dir, html_dir) {  // Watches `mdx_dir` files for any code change

    readline.emitKeypressEvents(process.stdin);

    if (process.stdin.isTTY)
        process.stdin.setRawMode(true);

    process.stdin.on('keypress', (chunk, key) => {
        if (key && key.name == 'r') {
            create_site(mdx_dir, html_dir)
        }
        else if (key && key.sequence == '\x03') {
            process.exit();
        }
    });
}
function start_server(html_dir, port) {  // Starts server at given port

    // Start Server
    const server = http.createServer((req, res) => {

        // Parse & Sanitize URL
        let parsed_url = new URL("http://" + req.headers.host + req.url)
        let sanitized_url = path.normalize(parsed_url.pathname).replace(/^(\.\.[\/\\])+/, '')
        let is_directory = !Boolean(path.parse(sanitized_url).ext)
        let relative_file_path = path.normalize(sanitized_url + (is_directory ? "/index.html" : ""))
        let absolute_file_path = path.join(path.resolve(html_dir), relative_file_path)
        let path_exists = fs.existsSync(absolute_file_path)

        // Respondes with content of file
        if (path_exists)
            // read file from file system
            fs.readFile(absolute_file_path, function (err, data) {
                if (err) {
                    res.statusCode = 500
                    res.end(`Error getting the file: ${err}.`)
                }
                else {
                    // Based on the URL path, extract the file extention. e.g. .js, .doc, ...
                    const ext = path.parse(absolute_file_path).ext
                    res.setHeader('Content-type', MIME_TYPE[ext] || 'text/plain') // if the file is found, set Content-type and send data
                    res.end(data)
                }

            })
        else { // Respondes with 404 if file not found
            res.statusCode = 404
            res.end(`404 Invalid url not found!`)
        }
    })

    server.listen(port, () => { console.log(`Server listening at ${port} ... (Press 'r' to reload, Press 'Ctrl+c' to exit)`) })
}
async function main() {

    // Get all arguments
    const args = process.argv.slice(2)


    // Check if asked for help
    if (args[0] === "--help" || args[0] === "-h") {
        console.log(HELP_MESSAGE)
        return;
    }


    // Check if valid mdx folder path
    var mdx_path = args[0];
    if (!fs.existsSync(mdx_path)) {
        console.log(INVALID_MDX_DIR_ERROR)
        return
    }


    // Check if valid port number
    var port = args[1]
    var port_number = DEFAULT_PORT
    if (port != undefined) {
        port_number = Number(port)

        if (!Number.isInteger(port_number)) {
            console.log(INVALID_PORT_NUMBER_ERROR)
            return
        }
    }


    // Check if valid html folder path
    var html_path = args[2];
    if (html_path !== undefined) {

        // Create user given html dir if it does not exist
        try {
            if (!fs.existsSync(html_path)) {
                fs.mkdirSync(html_path, { recursive: true })
            }
        }
        catch {
            console.log(INVALID_HTML_DIR_ERROR)
            return;
        }
    }
    else {

        // Create default temp html dir
        if (!fs.existsSync(TEMP_HTML_DIR)) {
            fs.mkdirSync(TEMP_HTML_DIR, { recursive: true })
        }

        html_path = fs.mkdtempSync(path.join(TEMP_HTML_DIR, `/html-`));
    }


    // Create site given html & mdx locations
    var abs_mdx_path = path.resolve(mdx_path)
    var abs_html_path = path.resolve(html_path)
    create_site(abs_mdx_path, abs_html_path)


    // Start server and watch for changes if flag is passed
    watch_for_reload(abs_mdx_path, abs_html_path)
    start_server(abs_html_path, port_number)


    // Remove temp html directory
    process.on("SIGINT", () => {

        // Remove html path
        if (fs.existsSync(abs_html_path)) {
            fs.rmSync(abs_html_path, { recursive: true, force: true })
        }

        process.exit(0);
    });
}

await main();