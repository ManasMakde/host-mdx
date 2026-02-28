#!/usr/bin/env node

import fs from "fs";
import path from "path";
import * as readline from "readline";
import { HostMdx, createSite, createTempDir, emptyDir, getAvailablePort, TrackChanges, log } from "./index.js";


// Flags
const CREATE_FLAG = "--create-only";
const CREATE_SHORT_FLAG = "-c";
const HELP_FLAG = "--help";
const HELP_SHORT_FLAG = "-h";
const INPUT_PATH_FLAG = "--input-path";
const OUTPUT_PATH_FLAG = "--output-path";
const PORT_FLAG = "--port";
const TRACK_CHANGES_FLAG = "--track-changes";
const TRACK_CHANGES_SHORT_FLAG = "-t";
const VERBOSE_FLAG = "--verbose";
const VERBOSE_SHORT_FLAG = "-v";


// Messages & Errors
const HELP_MESSAGE = `Usage: host-mdx [options]

Options:
${CREATE_FLAG}, ${CREATE_SHORT_FLAG}     Only create the html website from mdx does not host
${HELP_FLAG}, ${HELP_SHORT_FLAG}            Shows all available options
${INPUT_PATH_FLAG}=...      The path at which all mdx files are stored
${OUTPUT_PATH_FLAG}=...     The path to which all html files will be generated
${PORT_FLAG}=...            Localhost port number on which to host 
${TRACK_CHANGES_FLAG}, ${TRACK_CHANGES_SHORT_FLAG}   Tracks any changes & auto reloads, -t=hard for hard reload
${VERBOSE_FLAG}, ${VERBOSE_SHORT_FLAG}         Shows additional log messages
`;


// Utility Methods
function isPathInside(parentPath, childPath) {

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
function getInputPathFromArgs(rawArgs) {
    // Assign input path
    let inputPath = rawArgs.find(val => val.startsWith(INPUT_PATH_FLAG));
    let inputPathProvided = inputPath !== undefined;
    inputPath = inputPathProvided ? inputPath.split('=')?.[1] : undefined;
    inputPath = inputPath ?? process.cwd();


    // Check input path exists & is a directory
    if (!fs.existsSync(inputPath) || !fs.lstatSync(inputPath).isDirectory()) {
        return null;
    }


    return inputPath !== "" ? path.resolve(inputPath) : inputPath;  // To ensure input path is absolute
}
function getOutputPathFromArgs(rawArgs) {

    // Assign output path
    let outputPath = rawArgs.find(val => val.startsWith(OUTPUT_PATH_FLAG));
    let outputPathProvided = outputPath !== undefined;
    outputPath = outputPathProvided ? outputPath.split('=')?.[1] : undefined;
    outputPath = outputPath ?? createTempDir();


    // Check output path exists & is a directory
    if (!fs.existsSync(outputPath) || !fs.lstatSync(outputPath).isDirectory()) {
        return null;
    }


    return outputPath !== "" ? path.resolve(outputPath) : outputPath;  // To ensure input path is absolute
}
async function getPortFromArgs(rawArgs) {
    let port = rawArgs.find(val => val.startsWith(PORT_FLAG));
    let portProvided = port !== undefined;
    return portProvided ? Number(port.split('=')[1]) : (await getAvailablePort());
}
function getTrackChangesFromArgs(rawArgs) {
    let trackChanges = rawArgs.find(val => (val.startsWith(TRACK_CHANGES_FLAG) || val.startsWith(TRACK_CHANGES_SHORT_FLAG)));
    let trackChangesSplit = trackChanges?.split('=') ?? [];
    if (2 <= trackChangesSplit.length && trackChangesSplit[1] == "hard") {
        return TrackChanges.HARD;
    }

    return TrackChanges.SOFT;
}
function listenForKey(reloadCallback, hardReloadCallback, exitCallback) {
    if (process.stdin.isTTY) {
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
    }

    process.stdin.on("keypress", (chunk, key) => {
        if (key && key.shift && key.name == 'r') {
            hardReloadCallback();
        }
        else if (key && key.name == 'r') {
            reloadCallback();
        }
        else if (key && key.sequence == '\x03') {
            exitCallback();
        }
    });
}


// Main Methods
export async function main() {

    // Get all arguments
    const rawArgs = process.argv.slice(2);


    // Help flag check, Print out help message & return if passed 
    if (rawArgs.includes(HELP_FLAG) || rawArgs.includes(HELP_SHORT_FLAG)) {
        console.log(HELP_MESSAGE)
        return;
    }


    // Assign input path
    let inputPath = getInputPathFromArgs(rawArgs);
    if (inputPath == null) {
        log(`Invalid input path "${inputPath}"`)
        return;
    }


    // Assign output path
    let outputPath = getOutputPathFromArgs(rawArgs);
    if (outputPath == null) {
        log(`Invalid output path "${outputPath}"`)
        return;
    }


    // Check if output path is inside input path (causing infinite loop)
    if (isPathInside(inputPath, outputPath)) {
        log(`Output path "${outputPath}" cannot be inside or same as input path "${inputPath}"`);
        return;
    }


    // Check if input path is inside output path (causing code wipeout)
    if (isPathInside(outputPath, inputPath)) {
        log(`Input path "${inputPath}" cannot be inside or same as output path "${outputPath}"`);
        return;
    }


    // Assign verbose
    let toBeVerbose = rawArgs.includes(VERBOSE_FLAG) || rawArgs.includes(VERBOSE_SHORT_FLAG);


    // Assign to create only, Return if passed
    let toCreateOnly = rawArgs.includes(CREATE_FLAG) || rawArgs.includes(CREATE_SHORT_FLAG);
    if (toCreateOnly) {
        try {
            emptyDir(outputPath)
            await createSite(inputPath, outputPath, null, undefined, undefined, { toBeVerbose });
        }
        catch (err) {
            process.exitCode = 1;  // Exit with error code if not created successfully
        }

        return;
    }


    // Assign port
    let port = await getPortFromArgs(rawArgs);
    if (port === -1) {
        log(`Could not find any available ports, Try manually passing ${PORT_FLAG}=... flag`);
        return;
    }
    else if (!Number.isInteger(port)) {
        log(`Invalid port!`)
        return;
    }


    // Assign tracking changes
    let trackChanges = getTrackChangesFromArgs(rawArgs);


    // Start hosting
    let hostMdx = new HostMdx(inputPath, outputPath, { port, trackChanges, toBeVerbose });
    await hostMdx.start();


    // Assign cleanup function
    const cleanup = async () => {
        process.stdin.setRawMode(false);
        await hostMdx.stop();
        process.exit(0);
    }


    // Watch for key press
    listenForKey(
        async () => await hostMdx?.recreateSite(),
        async () => await hostMdx?.recreateSite(true),
        cleanup
    );


    // Watch for quit
    process.on("exit", cleanup);
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);


    // Log key press instructions
    log(`(Press 'r' to reload, 'Shift + r' to hard reload, 'Ctrl+c' to exit)`);
}


main()
