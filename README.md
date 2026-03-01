# host-mdx

[![Version](https://img.shields.io/npm/v/host-mdx.svg)](https://www.npmjs.com/package/host-mdx)\
A cli tool to create and serve a static html website from a given mdx directory

## 🛠️ Usage

### With npx:
```bash
npx host-mdx --input-path="path/to/input" --output-path="path/to/output"
```

List of all available options:
```
Usage: host-mdx [options]

Options:
--concurrency=<num>       Limit number of files to concurrently process (Optional, default: 1)
--create-only, -c         Only creates the html website from mdx does not host
--help, -h                Shows all available options
--input-path=<path>       The path at which all mdx files are stored
--output-path=<path>      The path to which all html files will be generated
--port=<num>              Localhost port number on which to host 
--track-changes, -t       Tracks any changes & auto reloads, -t=hard for hard reload
--verbose, -v             Shows additional log messages
```

> If `--input-path` is not provided it will default to `./` i.e. current working directory\
> If `--output-path` is not provided a temp folder will be created automatically & deleted upon exit



### With import/require:

```js
import { HostMdx } from "host-mdx";
// const { HostMdx } = require("host-mdx");

const inputPath = "/home/mrm/Desktop/website-mdx"
const outputPath = "/home/mrm/Desktop/website-html"
const configs = {
   toBeVerbose: true, 
   port:3000, 
   trackChanges:1
}
const hostMdx = new HostMdx(inputPath, outputPath, configs);
hostMdx.start();
```


### Additional:

You can add a file by the name `.hostmdxignore` at the root of your project to filter out which files/folders to skip while generating html
(similar to [.gitignore](https://git-scm.com/docs/gitignore))

You can also add a file by the name `host-mdx.js` at the root of your input folder as a config file (Look at the example below for all available options)


> **Note:**  
> 1. Any config properties passed from npx or import e.g. `port`, `toBeVerbose`, `trackChanges`, etc will override `host-mdx.js` export values
> 1. Any changes made to `host-mdx.js` or any new package added requires complete restart otherwise changes will not reflect due to [this bug](https://github.com/nodejs/node/issues/49442)

<br/>

Default global variables you can use inside any .mdx files:  
```
hostmdxCwd 
hostmdxInputPath 
hostmdxOutputPath
```


## 📖 Example

Command:

```bash
npx host-mdx --input-path="path/to/my-website-template" --output-path="path/to/my-website" --port=3113 -t
```

Input Directory:

```
my-website-template/
├─ 404.mdx
├─ index.mdx
├─ .hostmdxignore
├─ host-mdx.js
├─ about/
│  ├─ index.mdx
│  └─ custom_component.jsx
├─ blog/
│  ├─ page1/
│  │  └─ index.mdx
│  └─ page2/
│     ├─ extras.png
│     └─ index.mdx
└─ static/
   ├─ image1.png
   ├─ image2.jpg
   ├─ temp.jpg
   ├─ sample.jsx
   └─ styles.css
```

`.hostmdxignore` file content:

```sh
*.jsx
blog/page2/
static/temp.jpg
!static/sample.jsx
```

`host-mdx.js` file content:

```js
export async function onHostStarting(inputPath, outputPath, port) {
   console.log("onHostStarting");
}
export async function onHostStarted(inputPath, outputPath, port) {
   console.log("onHostStarted");
}
export async function onHostEnded(inputPath, outputPath, port) {
   console.log("onHostEnded");
}
export async function onSiteCreateStart(inputPath, outputPath) {
   console.log("onSiteCreateStart");
}
export async function onSiteCreateEnd(inputPath, outputPath, wasInterrupted) {
   console.log("onSiteCreateEnd");
}
export async function onFileCreateStart(inputFilePath, outputFilePath, inFilePath, outFilePath) {
   console.log("onFileCreateStart");
}
export async function onFileCreateEnd(inputFilePath, outputFilePath, inFilePath, outFilePath, result) {
   // `result = undefined` if file is not .mdx
   // `result.html` contains stringified HTML
   // `result.exports` contains exports from mdx
   console.log("onFileCreateEnd");
}
export async function toIgnore(inputPath, outputPath, path) {
   const isGOutputStream = /\.goutputstream-\w+$/.test(path);
   if (isGOutputStream) {
      return true;
   }
   
   return false;
}
export async function modMDXCode(inputPath, outputPath, inFilePath, outFilePath, code){
   // Modify code ...
   return code;
}
export async function modGlobalArgs(inputPath, outputPath, globalArgs){
   // Modify globalArgs ...
   return globalArgs;
}
export async function modBundleMDXSettings(inputPath, outputPath, settings) {
   // Modify settings ...
   return settings;
}
export async function modRebuildPaths(inputPath, outputPath, rebuildPaths) {
   // Modify rebuildPaths ...
   return rebuildPaths;
}
export const chokidarOptions = {
   awaitWriteFinish: true
}
export const port = 3000;
export const trackChanges = 1;  // 0=no-tracking, 1=soft-reload, 2=hard-reload
export const toBeVerbose = true;
export const concurrency = 10;  // Lowest possible value: 1
```

Output Directory:

```
my-website/
├─ 404.html
├─ index.html
├─ about/
│  └─ index.html
├─ blog/
│  └─ page1/
│     └─ index.html
└─ static/
   ├─ image1.png
   ├─ image2.jpg
   ├─ sample.jsx
   └─ styles.css
```

The site will now be visible in the browser at `localhost:3113`


## 🔑 License

MIT © [Manas Ravindra Makde](https://manasmakde.github.io/)