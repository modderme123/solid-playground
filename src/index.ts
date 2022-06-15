import './assets/main.css';
import 'virtual:windi.css';

import type { Tab } from 'solid-repl';

import indexTSX from './defaultFiles/src/index.tsx?raw';
import indexHTML from './defaultFiles/index.html?raw';
import tsConfig from './defaultFiles/tsconfig.json?raw';
import packageJSON from './defaultFiles/package.json?raw';
import viteConfigFile from './defaultFiles/vite.config.ts?raw';

export const defaultTabs: Tab[] = [
  {
    name: 'src/index.tsx',
    source: indexTSX,
  },
  {
    name: 'tsconfig.json',
    source: tsConfig,
  },
  {
    name: 'package.json',
    source: packageJSON,
  },
  {
    name: 'vite.config.ts',
    source: viteConfigFile,
  },
  {
    name: 'index.html',
    source: indexHTML,
  },
];
