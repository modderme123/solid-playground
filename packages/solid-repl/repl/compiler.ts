import type { Tab } from 'solid-repl';

import { transform } from '@babel/standalone';
// @ts-ignore
import babelPresetSolid from 'babel-preset-solid';

import dd from 'dedent';

function uid(str: string) {
  return Array.from(str)
    .reduce((s, c) => (Math.imul(31, s) + c.charCodeAt(0)) | 0, 0)
    .toString();
}

function babelTransform(filename: string, code: string) {
  let { code: transformedCode } = transform(code, {
    presets: [
      [babelPresetSolid, { generate: 'dom', hydratable: false }],
      ['typescript', { onlyRemoveTypeImports: true }],
    ],
    filename: filename + '.tsx',
  });

  return transformedCode!.replace('render(', 'window.dispose = render(');
}

// Returns new import URL
function transformImportee(fileName: string, contents: string) {
  if (fileName.endsWith('.css')) {
    const id = uid(fileName);
    return dd`
    (() => {
      let stylesheet = document.getElementById('${id}');
      if (!stylesheet) {
        stylesheet = document.createElement('style')
        stylesheet.setAttribute('id', ${id})
        document.head.appendChild(stylesheet)
      }
      const styles = document.createTextNode(\`${contents}\`)
      stylesheet.innerHTML = ''
      stylesheet.appendChild(styles)
    })()
  `;
  } else {
    return babelTransform(fileName, contents);
  }
}

function compile(tabs: Tab[], event: string) {
  const tabsRecord: Record<string, string> = {};
  for (const tab of tabs) {
    tabsRecord[`./${tab.name.replace(/.(tsx|jsx)$/, '')}`] = transformImportee(tab.name, tab.source);
  }
  return { event, compiled: tabsRecord };
}

function babel(tab: Tab, compileOpts: any) {
  const { code } = transform(tab.source, {
    presets: [
      [babelPresetSolid, compileOpts],
      ['typescript', { onlyRemoveTypeImports: true }],
    ],
    filename: tab.name,
  });
  return { event: 'BABEL', compiled: code };
}

self.addEventListener('message', ({ data }) => {
  const { event, tabs, tab, compileOpts } = data;

  try {
    if (event === 'BABEL') {
      self.postMessage(babel(tab, compileOpts));
    } else if (event === 'ROLLUP') {
      self.postMessage(compile(tabs, event));
    }
  } catch (e) {
    self.postMessage({ event: 'ERROR', error: e });
  }
});

export {};
