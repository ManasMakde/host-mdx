# host-mdx

[![Version](https://img.shields.io/npm/v/host-mdx.svg)](https://www.npmjs.com/package/host-mdx )

A cli tool to create and serve a static html website from a given mdx directory

## 🛠️ Usage

```
host-mdx [options]

Options:
--create-only, -c     Only create the html website from mdx does not host
--help, -h            Shows all available options
--input-path=...      The path at which all mdx files are stored
--output-path=...     The path to which all html files will be generated
--port=...            Localhost port number on which to host 
--track-changes, -t   Tracks any changes made & auto reloads
--verobse, -v         Shows additional log messages
```
  
> If `--input-path` is not provided it will default to `./` i.e. current working directory  
> If `--output-path` is not provided a temp folder will be created automatically & deleted upon exit

Add a file by the name `.hostmdxignore` at the root of your project to filter out which files/folders to skip while generating html
(similar to [.gitignore](https://git-scm.com/docs/gitignore)) 


Add a file by the name `host-mdx.js` at the root of your input folder as a config file with the following:

```js
// Modify
modBundleMDXSettings(settings)


// Hooks
onSiteCreateStart(inputPath, outputPath)
onSiteCreateEnd(inputPath, outputPath, wasInterrupted)
onFileCreateStart(inputFilePath, outputFilePath)
onFileCreateEnd(inputFilePath, outputFilePath)
```
> Note: Any changes made to `host-mdx.js` require complete restart otherwise changes will not reflect

## 📖 Example

Command:
```bash
npx host-mdx --input-path="path/to/my-website-template" --output-path="path/to/my-website" --port=3113 -t
```


Input Directory:
```
my-website-template/
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
export function onSiteCreateStart(inputPath, outputPath) {
   console.log("onSiteCreateStart", inputPath, outputPath)
}
export function onSiteCreateEnd(inputPath, outputPath, wasSuccessful){
   console.log("onSiteCreateEnd", inputPath, outputPath, wasSuccessful)
}
export function onFileCreateStart(inputFilePath, outputFilePath){
   console.log("onFileCreateStart", inputFilePath, outputFilePath)
}
export function onFileCreateEnd(inputFilePath, outputFilePath){
   console.log("onFileCreateEnd", inputFilePath, outputFilePath)
}
export function onHostStart(port){
   console.log("onHostStart", port)
}
export function onHostEnd(port){
   console.log("onHostEnd", port)
}
export function modBundleMDXSettings(settings){
   // Modify settings ...
   return settings
}
```

Output Directory:
```
my-website/
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