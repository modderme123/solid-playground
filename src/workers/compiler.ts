import type { Tab } from 'solid-repl';
// @ts-ignore
import babelPresetSolid from 'babel-preset-solid';
import { transform } from '@babel/standalone';

async function babel(tab: Tab, compileOpts: any) {
  const { code } = await transform(tab.source, {
    presets: [
      [babelPresetSolid, compileOpts],
      ['typescript', { onlyRemoveTypeImports: true }],
    ],
    filename: tab.name,
  });
  return { event: 'BABEL', compiled: code };
}

self.addEventListener('message', async ({ data }) => {
  const { event, tab, compileOpts } = data;

  try {
    if (event === 'BABEL') {
      self.postMessage(await babel(tab, compileOpts));
    }
  } catch (e) {
    self.postMessage({ event: 'ERROR', error: (e as Error).message });
  }
});

export {};
