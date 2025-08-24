# host-mdx

[![Version](https://img.shields.io/npm/v/host-mdx.svg)](https://www.npmjs.com/package/host-mdx )

This creates and serves a [github pages](https://docs.github.com/en/pages) style html directory from a corresponding mdx directory

## Usage
```
deno npm:host-mdx [<mdx-dir>] [<optional-port-number>] [<optional-html-dir>]
```

## Example


```bash
deno npm:host-mdx "/home/username/my-website-template/" 3113 "/home/username/Desktop/my-website/"
```

```
my-website-template/
├─ index.mdx
├─ about/
│  └─ index.mdx
├─ projects/
│  ├─ project1/
│  │  └─ index.mdx
│  └─ project2/
│     └─ index.mdx
└─ static/
   ├─ image1.png
   ├─ image2.jpg
   └─ styles.css
```

```
my-website/
├─ index.html
├─ about/
│  └─ index.html
├─ projects/
│  ├─ project1/
│  │  └─ index.html
│  └─ project2/
│     └─ index.html
└─ static/
   ├─ image1.png
   ├─ image2.jpg
   └─ styles.css
```

The site will now be visible in the browser at `localhost:3113`
