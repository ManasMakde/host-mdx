import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";


// Essentials
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../");
const CLI_PATH = "./cli.js";


// Tests
describe("Testing --help flag", () => {

    it("--help prints options & all are in alphabetical order", () => {

        // Run with --help flag
        const child = spawnSync(process.execPath, [CLI_PATH, "--help"], {
            cwd: ROOT_DIR,
            encoding: "utf-8"
        });


        // Check if output is printed out at all
        const output = child.stdout || "";
        if (output === "") {
            assert.fail(`No output printed!`);
        }


        // Extract flags
        const extractedFlags = output
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.startsWith("--"))
            .map(line => line.match(/^(--[a-z-]+)/)?.[1])
            .filter(Boolean);


        // Check if sorted
        const sortedFlags = [...extractedFlags].sort((a, b) => a.localeCompare(b));
        const isAlphabetical = JSON.stringify(extractedFlags) === JSON.stringify(sortedFlags);
        if (!isAlphabetical) {
            assert.fail(`Flags are not alphabetical!\nFound:    ${extractedFlags.join(", ")}\nExpected: ${sortedFlags.join(", ")}`);
        }
    });
});