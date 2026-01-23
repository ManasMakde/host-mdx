import * as Preact from "preact";
import * as PreactDOM from "preact/compat";
import * as _jsx_runtime from 'preact/jsx-runtime';
import { renderToString } from 'preact-render-to-string';
import { common } from 'lowlight';
import { bundleMDX } from 'mdx-bundler';
import { createRequire } from 'module';
import rehypeHighlight from "rehype-highlight";


// Constants
const nativeRequire = createRequire(import.meta.url);
const jsxBundlerConfig = {
  jsxLib: {
    varName: 'Preact',
    package: 'preact',
  },
  jsxDom: {
    varName: 'PreactDom',
    package: 'preact/compat',
  },
  jsxRuntime: {
    varName: '_jsx_runtime',
    package: 'preact/jsx-runtime',
  },
}


// Methods
function getMDXComponent(code, globals) {
  const fn = new Function(...Object.keys(globals), code);
  const mdxExport = fn(...Object.values(globals));
  return mdxExport.default;
}
export async function mdxToHtml(mdxCode, baseUrl, modSettingsCallback = undefined) {

  // Assign default settings
  let settings = {
    source: mdxCode,
    jsxConfig: jsxBundlerConfig,
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
  if (modSettingsCallback !== undefined) {
    settings = modSettingsCallback(settings)
  }


  // Generate html
  const { code } = await bundleMDX(settings);
  const Component = getMDXComponent(code, { Preact, PreactDOM, _jsx_runtime, require: nativeRequire, cwd: baseUrl })


  return renderToString(Preact.h(Component, {}));
}