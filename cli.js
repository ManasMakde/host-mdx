import fs from "fs";
import path from "path";
import { log, host, createSiteSafe, createTempDir, getAvailablePort } from "./index.js";


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
${TRACK_CHANGES_FLAG}, ${TRACK_CHANGES_SHORT_FLAG}   Tracks any changes made & auto reloads
${VERBOSE_FLAG}, ${VERBOSE_SHORT_FLAG}         Shows additional log messages
`;


// Utility Methods
function stripTrailingSep(thePath) {
    if (thePath[thePath.length - 1] === path.sep) {
        return thePath.slice(0, -1);
    }
    return thePath;
}
async function hostOptionsFromArgs(rawArgs) {

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
    outputPath = outputPathProvided ? outputPath.split('=')[1] : "";


    // Check output path
    if (outputPathProvided && (!fs.existsSync(outputPath) || !fs.lstatSync(outputPath).isDirectory())) {
        log(`Invalid output path "${outputPath}"`)
        return null;
    }
    else if (outputPathProvided) {
        outputPath = path.resolve(outputPath);  // To ensure output path is absolute, Intentionally not passing "" to resolve() otherwise it resolves to root DO NOT CHANGE
    }


    // Check if output path is inside input path (causing infinite loop)
    if (isSubPath(inputPath, outputPath)) {
        log(`Output path "${outputPath}" cannot be inside or same as input path "${inputPath}"`);
        return null;
    }


    // Assign port
    let port = rawArgs.find(val => val.startsWith(PORT_FLAG));
    let portProvided = port !== undefined;
    port = portProvided ? Number(port.split('=')[1]) : (await getAvailablePort());


    // Check port
    if (port === -1) {
        log(`Could not find any available ports between ${DEFAULT_PORT} to ${MAX_PORT}, Try manually passing ${PORT_FLAG}=... flag`);
        return null;
    }
    else if (!Number.isInteger(port)) {
        log(`Invalid port`)
        return null;
    }


    // Assign verbose
    let toBeVerbose = rawArgs.includes(VERBOSE_FLAG) || rawArgs.includes(VERBOSE_SHORT_FLAG);


    // Assign tracking changes
    let toTrackChanges = rawArgs.includes(TRACK_CHANGES_FLAG) || rawArgs.includes(TRACK_CHANGES_SHORT_FLAG);


    return { inputPath, outputPath, port, toBeVerbose, toTrackChanges };
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


// Main Methods
export async function Main() {

    // Get all arguments
    const rawArgs = process.argv.slice(2);


    // Print out help messages & return if "help" flag was passed 
    if (rawArgs.includes(HELP_FLAG) || rawArgs.includes(HELP_SHORT_FLAG)) {
        console.log(HELP_MESSAGE)
        return;
    }


    // Check if to be verbose
    let toBeVerbose = rawArgs.includes(VERBOSE_FLAG) || rawArgs.includes(VERBOSE_SHORT_FLAG);


    // Get host options from arguments & return if invalid
    let hostOptions = await hostOptionsFromArgs(rawArgs);
    if (hostOptions === null) {
        return;
    }


    // Create site and return if "create only" flag was passed
    let toCreateOnly = rawArgs.includes(CREATE_FLAG) || rawArgs.includes(CREATE_SHORT_FLAG);
    if (toCreateOnly) {
        let outputPathProvided = hostOptions.outputPath !== "";
        let outputPath = outputPathProvided ? hostOptions.outputPath : createTempDir();
        await createSiteSafe(hostOptions.inputPath, outputPath, toBeVerbose);
        return;
    }


    // Start hosting
    host(hostOptions.inputPath, hostOptions.outputPath, hostOptions);
}


Main()
