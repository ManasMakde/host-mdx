import React from 'react';
import rehypeHighlight from "rehype-highlight";
import * as _jsx_runtime from 'react/jsx-runtime';
import { common } from 'lowlight';
import { bundleMDX } from 'mdx-bundler';
import { getMDXComponent } from 'mdx-bundler/client/index.js'
import { renderToString } from 'react-dom/server';
import { createRequire } from 'module';

const nativeRequire = createRequire(import.meta.url);

export async function mdxToHtml(mdxCode, baseUrl, modSettingsCallback = undefined) {
  
  // Assign default settings
  let settings = {
    source: mdxCode,
    cwd: baseUrl,
    esbuildOptions: (options) => {
      options.platform = 'node'
      return options;
    },
    mdxOptions(options) {
      options.rehypePlugins = [
        ...(options.rehypePlugins ?? []),
        [rehypeHighlight, { languages: { ...common } }]
      ];
      return options;
    }
  }


  // Modify settings
  if(modSettingsCallback !== undefined){
    settings = modSettingsCallback(settings)
  }


  // Generate html
  const { code } = await bundleMDX(settings);
  const Component = getMDXComponent(code, { require: nativeRequire, cwd: baseUrl })
  return renderToString(React.createElement(Component));
}