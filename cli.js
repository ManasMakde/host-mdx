#!/usr/bin/env node

import path from "path";
import * as readline from "readline";
import { HostMdx, createSite, TrackChanges, log } from "./index.js";


// Flags
const CONCURRENCY_FLAG = "--concurrency"
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


// Properties
const SOFT_RELOAD_ARG = "soft"
const HARD_RELOAD_ARG = "hard"
const HELP_MESSAGE = `Usage: host-mdx [options]

Options:
${CONCURRENCY_FLAG}=<num>       Limit number of files to concurrently process (Optional, default: 1)
${CREATE_FLAG}, ${CREATE_SHORT_FLAG}         Only creates the html website from mdx does not host
${HELP_FLAG}, ${HELP_SHORT_FLAG}                Shows all available options
${INPUT_PATH_FLAG}=<path>       The path at which all mdx files are stored
${OUTPUT_PATH_FLAG}=<path>      The path to which all html files will be generated
${PORT_FLAG}=<num>              Localhost port number on which to host 
${TRACK_CHANGES_FLAG}, ${TRACK_CHANGES_SHORT_FLAG}       Tracks any changes & auto reloads, ${TRACK_CHANGES_SHORT_FLAG}=${HARD_RELOAD_ARG} for hard reload
${VERBOSE_FLAG}, ${VERBOSE_SHORT_FLAG}             Shows additional log messages
`;


// Utility Methods
function getInputPathFromArgs(rawArgs) {
    let inputPath = rawArgs.find(val => val.startsWith(INPUT_PATH_FLAG));
    let inputPathProvided = inputPath !== undefined;
    inputPath = inputPathProvided ? inputPath.split('=')?.[1] : "";
    return inputPath !== "" ? path.resolve(inputPath) : inputPath;  // To ensure input path is absolute
}
function getOutputPathFromArgs(rawArgs) {
    let outputPath = rawArgs.find(val => val.startsWith(OUTPUT_PATH_FLAG));
    let outputPathProvided = outputPath !== undefined;
    outputPath = outputPathProvided ? outputPath.split('=')?.[1] : "";
    return outputPath !== "" ? path.resolve(outputPath) : outputPath;  // To ensure input path is absolute
}
function getPortFromArgs(rawArgs) {
    let port = rawArgs.find(val => val.startsWith(PORT_FLAG));
    let portProvided = port !== undefined;
    return portProvided ? Number(port.split('=')[1]) : undefined;
}
function getTrackChangesFromArgs(rawArgs) {
    // If flag not passed do not track changes
    let trackChanges = rawArgs.find(val => (val.startsWith(TRACK_CHANGES_FLAG) || val.startsWith(TRACK_CHANGES_SHORT_FLAG)));
    if (trackChanges == undefined) {
        return undefined;
    }


    // Check for argument passed (if any) 
    let trackChangesSplit = trackChanges?.split('=') ?? [];
    let arg = trackChangesSplit?.[1];
    if (arg === HARD_RELOAD_ARG) {
        return TrackChanges.HARD;
    }
    else if (arg === SOFT_RELOAD_ARG) {
        return TrackChanges.SOFT;
    }


    return TrackChanges.SOFT;
}
function getConcurrencyFromArgs(rawArgs) {
    let concurrency = rawArgs.find(val => val.startsWith(CONCURRENCY_FLAG));
    let concurrencyProvided = concurrency !== undefined;
    return concurrencyProvided ? Number(concurrency.split('=')[1]) : undefined;
}
function listenForKey(reloadCallback, hardReloadCallback, exitCallback) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
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


    // Assign output path
    let outputPath = getOutputPathFromArgs(rawArgs);


    // Assign verbose
    let toBeVerbose = rawArgs.includes(VERBOSE_FLAG) || rawArgs.includes(VERBOSE_SHORT_FLAG);


    // Assign concurrency
    let concurrency = getConcurrencyFromArgs(rawArgs);


    // Assign to create only, Return if passed
    let toCreateOnly = rawArgs.includes(CREATE_FLAG) || rawArgs.includes(CREATE_SHORT_FLAG);
    if (toCreateOnly) {
        try {
            await createSite(inputPath, outputPath, null, undefined, { toBeVerbose });
        }
        catch (err) {
            process.exitCode = 1;  // Exit with error code if not created successfully
            log(`Failed to create site!\n${err?.stack}`);
        }

        return;
    }


    // Assign port
    let port = getPortFromArgs(rawArgs);


    // Assign tracking changes
    let trackChanges = getTrackChangesFromArgs(rawArgs);


    // Start hosting
    let configs = {
        ...(port !== undefined && { port }),
        ...(concurrency !== undefined && { concurrency }),
        ...(trackChanges !== undefined && { trackChanges }),
        ...(toBeVerbose && { toBeVerbose }),
    }
    let hostMdx = new HostMdx(inputPath, outputPath, configs);
    let hasHostingStarted = await hostMdx.start();
    if (!hasHostingStarted) {
        return;
    }


    // Assign cleanup function
    const cleanup = async () => {
        process.stdin.setRawMode(false);
        await hostMdx.stop();
        process.exit(0);  // Without this 'Ctrl + c' does not work DO NOT REMOVE
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
