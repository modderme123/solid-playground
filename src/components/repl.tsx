import { Show, For, createSignal, createEffect, batch, onMount, Match, Switch, onCleanup } from 'solid-js';
import { Icon } from 'solid-heroicons';
import { refresh } from 'solid-heroicons/outline';
import { unwrap } from 'solid-js/store';
import { TabItem, TabList } from './tabs';
import { GridResizer } from './gridResizer';
import { debounce, throttle } from '@solid-primitives/scheduled';
import { FileSystemTree, load } from '@webcontainer/api';
import { useZoom } from '../hooks/useZoom';
import { once } from '../utils/cache';
import { createMediaQuery } from '@solid-primitives/media';
import { editor, Uri } from 'monaco-editor';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

import MonacoTabs from './editor/monacoTabs';
import Editor from './editor';

import type { Repl as ReplProps } from 'solid-repl/lib/repl';

const compileMode = {
  SSR: { generate: 'ssr', hydratable: true },
  DOM: { generate: 'dom', hydratable: false },
  HYDRATABLE: { generate: 'dom', hydratable: true },
} as const;

const Repl: ReplProps = (props) => {
  const { compiler, formatter } = props;
  let now: number;

  const tabRefs = new Map<string, HTMLSpanElement>();

  const [compiled, setCompiled] = createSignal('');
  const [mode, setMode] = createSignal<typeof compileMode[keyof typeof compileMode]>(compileMode.DOM);

  function setCurrentTab(current: string) {
    const idx = props.tabs.findIndex((tab) => tab.name === current);
    if (idx < 0) return;
    props.setCurrent(current);
  }
  function setCurrentName(newName: string) {
    const tabs = props.tabs;
    tabs.find((tab) => tab.name === props.current).name = newName;
    batch(() => {
      props.setTabs([...tabs]);
      props.setCurrent(newName);
    });
  }
  function removeTab(name: string) {
    const tabs = props.tabs;
    const idx = tabs.findIndex((tab) => tab.name === name);
    const tab = tabs[idx];

    if (!tab) return;

    const confirmDeletion = confirm(`Are you sure you want to delete ${tab.name}?`);
    if (!confirmDeletion) return;

    batch(() => {
      props.setTabs([...tabs.slice(0, idx), ...tabs.slice(idx + 1)]);
      // We want to redirect to another tab if we are deleting the current one
      if (props.current === name) {
        props.setCurrent(tabs[idx - 1].name);
      }
    });
  }
  function addTab() {
    const newTab = {
      name: `tab${props.tabs.length}.tsx`,
      source: '',
    };
    batch(() => {
      props.setTabs(props.tabs.concat(newTab));
      props.setCurrent(newTab.name);
    });
  }

  let terminal = new Terminal({ convertEol: true });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  let debouncedFit = debounce(() => fitAddon.fit(), 17);
  let observer = new ResizeObserver(() => debouncedFit());
  onCleanup(() => {
    observer.disconnect();
    fitAddon.dispose();
    terminal.dispose();
  });

  const [magicURL, setMagicURL] = createSignal(
    'data:text/html,<p style="color:gray;font-family:sans-serif">Booting webcontainer</p>',
    { equals: false },
  );

  let webcontainer = once('webcontainer', () => load().then((x) => x.boot()));

  let treePromise: Promise<void>;
  onMount(async () => {
    terminal.write('Booting webcontainer... \n');
    let container = await webcontainer;

    container.on('server-ready', (_, url) => {
      setMagicURL(url);
      setOutputTab(0);
    });

    await treePromise;

    setOutputTab(2);

    terminal.write('\x1bc');
    terminal.write('> npm i\n');
    let result = await container.run(
      {
        command: 'npm',
        args: ['i'],
      },
      {
        output: (data) => {
          terminal.write(data);
        },
      },
    );
    await result.onExit;

    terminal.write('\n> npm run start\n');
    result = await container.run(
      {
        command: 'npm',
        args: ['run', 'start'],
      },
      {
        output: (data) => {
          terminal.write(data);
        },
      },
    );
    await result.onExit;
  });

  const loadTree = () => {
    let tree = {} as FileSystemTree;
    for (const tab of props.tabs) {
      const pieces = tab.name.split('/');
      let segment = tree;
      for (let i = 0; i < pieces.length - 1; i++) {
        const piece = pieces[i];
        if (!segment[piece]) {
          const x = { directory: {} };
          segment[piece] = x;
          segment = x.directory;
        }
      }
      segment[pieces[pieces.length - 1]] = {
        file: { contents: tab.source },
      };
    }
    treePromise = webcontainer.then((x) => x.loadFiles(tree));
  };
  createEffect(loadTree);

  const [edit, setEdit] = createSignal(-1);
  const [outputTab, setOutputTab] = createSignal(2);

  let model: editor.ITextModel;
  createEffect(() => {
    const uri = Uri.parse(`file:///${props.id}/output_dont_import.tsx`);
    model = editor.createModel('', 'typescript', uri);
    onCleanup(() => model.dispose());
  });
  compiler.addEventListener('message', ({ data }) => {
    const { compiled } = data;

    setCompiled(compiled || '/* not available */');

    console.log(`Compilation took: ${performance.now() - now}ms`);
  });

  /**
   * We need to debounce a bit the compilation because
   * it takes ~15ms to compile with the web worker...
   * Also, real time feedback can be stressful
   */
  const applyCompilation = throttle((message: any) => {
    now = performance.now();

    compiler.postMessage(message);
  }, 250);

  const compile = () => {
    if (outputTab() != 1) return;
    applyCompilation({
      event: 'BABEL',
      tab: unwrap(props.tabs.find((tab) => tab.name == props.current)),
      compileOpts: mode(),
    });
  };

  /**
   * The heart of the playground. This recompile on
   * every tab source changes.
   */
  createEffect(() => {
    if (!props.tabs.length) return;
    compile();
  });

  const clampPercentage = (percentage: number, lowerBound: number, upperBound: number) => {
    return Math.min(Math.max(percentage, lowerBound), upperBound);
  };

  let grid!: HTMLDivElement;
  let resizer!: HTMLDivElement;
  const [left, setLeft] = createSignal(1.25);

  const isLarge = createMediaQuery('(min-width: 768px)');
  const isHorizontal = () => props.isHorizontal || !isLarge();

  const changeLeft = (clientX: number, clientY: number) => {
    let position: number;
    let size: number;

    const rect = grid.getBoundingClientRect();

    if (isHorizontal()) {
      position = clientY - rect.top - resizer.offsetHeight / 2;
      size = grid.offsetHeight - resizer.offsetHeight;
    } else {
      position = clientX - rect.left - resizer.offsetWidth / 2;
      size = grid.offsetWidth - resizer.offsetWidth;
    }
    const percentage = position / size;
    const percentageAdjusted = clampPercentage(percentage * 2, 0.5, 1.5);

    setLeft(percentageAdjusted);
  };

  const [displayErrors, setDisplayErrors] = createSignal(true);

  const { zoomState } = useZoom();
  const styleScale = () => {
    if (zoomState.scale === 100 || !zoomState.scaleIframe) return '';
    return `width: ${zoomState.scale}%; height: ${zoomState.scale}%; transform: scale(${
      zoomState.zoom / 100
    }); transform-origin: 0 0;`;
  };

  return (
    <div
      ref={grid}
      class="grid h-full min-h-0 bg-white dark:bg-solid-darkbg dark:text-white text-black font-sans"
      classList={{
        'wrapper--forced': props.isHorizontal,
        'wrapper': !props.isHorizontal,
        'dark': props.dark,
      }}
      style={{
        '--left': `${left()}fr`,
        '--right': `${2 - left()}fr`,
      }}
    >
      <div class="h-full flex flex-col">
        <TabList>
          <For each={props.tabs}>
            {(tab, index) => (
              <TabItem active={props.current === tab.name} class="mr-2">
                <div
                  ref={(el) => tabRefs.set(tab.name, el)}
                  class="cursor-pointer select-none py-2 px-3 border border-solid border-transparent rounded transition focus:border-blue-600 focus:outline-none"
                  contentEditable={edit() == index()}
                  onBlur={(e) => {
                    setEdit(-1);
                    setCurrentName(e.currentTarget.textContent!);
                  }}
                  onKeyDown={(e) => {
                    if (e.code === 'Space') e.preventDefault();
                    if (e.code !== 'Enter') return;
                    setEdit(-1);
                    setCurrentName(e.currentTarget.textContent!);
                  }}
                  onClick={() => setCurrentTab(tab.name)}
                  onDblClick={(e) => {
                    e.preventDefault();
                    setEdit(index());
                    tabRefs.get(tab.name)?.focus();
                  }}
                >
                  {tab.name}
                </div>

                <Show when={index() > 0}>
                  <button
                    type="button"
                    class="cursor-pointer"
                    onClick={() => {
                      removeTab(tab.name);
                    }}
                  >
                    <span class="sr-only">Delete this tab</span>
                    <svg style="stroke: currentColor; fill: none;" class="h-4 opacity-60" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </Show>
              </TabItem>
            )}
          </For>

          <li class="inline-flex items-center m-0 border-b-2 border-transparent">
            <button type="button" onClick={addTab} title="Add a new tab">
              <span class="sr-only">Add a new tab</span>
              <svg
                viewBox="0 0 24 24"
                style="stroke: currentColor; fill: none;"
                class="h-5 text-brand-default dark:text-slate-50"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </button>
          </li>
          <TabItem class="ml-auto justify-self-end">
            <label for="display-errors" class="space-x-2 px-3 py-2 cursor-pointer">
              <input
                type="checkbox"
                id="display-errors"
                name="display-errors"
                checked={displayErrors()}
                onChange={(event) => setDisplayErrors(event.currentTarget.checked)}
              />
              <span>Display Errors</span>
            </label>
          </TabItem>
        </TabList>

        <MonacoTabs tabs={props.tabs} folder={props.id} />

        <Show when={props.current}>
          <Editor
            url={`file:///${props.id}/${props.current}`}
            onDocChange={() => compile()}
            formatter={formatter}
            isDark={props.dark}
            withMinimap={false}
            onEditorReady={props.onEditorReady}
            displayErrors={displayErrors()}
          />
        </Show>
      </div>

      <GridResizer ref={resizer} isHorizontal={isHorizontal()} onResize={changeLeft} />

      <div class="h-full flex flex-col">
        <TabList>
          <TabItem>
            <button
              type="button"
              title="Refresh the page"
              class="py-2 px-3 disabled:cursor-not-allowed disabled:opacity-25 active:animate-spin"
              onClick={() => setMagicURL(magicURL())}
              disabled={outputTab() != 0}
            >
              <span class="sr-only">Refresh the page</span>
              <Icon path={refresh} class="h-5" />
            </button>
          </TabItem>
          <TabItem class="flex-1" active={outputTab() == 0}>
            <button type="button" class="w-full -mb-0.5 py-2" onClick={[setOutputTab, 0]}>
              Result
            </button>
          </TabItem>
          <TabItem class="flex-1" active={outputTab() == 1}>
            <button type="button" class="w-full -mb-0.5 py-2" onClick={[setOutputTab, 1]}>
              Output
            </button>
          </TabItem>
          <TabItem class="flex-1" active={outputTab() == 2}>
            <button type="button" class="w-full -mb-0.5 py-2" onClick={[setOutputTab, 2]}>
              Terminal
            </button>
          </TabItem>
        </TabList>

        <Switch>
          <Match when={outputTab() == 0}>
            <iframe class="w-full h-full" allow="cross-origin-isolated" src={magicURL()} style={styleScale()} />
          </Match>
          <Match when={outputTab() == 2}>
            <div
              class="h-full w-full overflow-hidden"
              ref={(el) => {
                terminal.open(el);
                fitAddon.fit();
                observer.observe(el);
                onCleanup(() => observer.unobserve(el));
              }}
            />
          </Match>
          <Match when={outputTab() == 1}>
            <section class="h-full flex flex-col relative divide-y-2 divide-slate-200 dark:divide-neutral-800">
              <Editor
                url={`file:///${props.id}/output_dont_import.tsx`}
                isDark={props.dark}
                disabled
                withMinimap={false}
              />

              <div class="p-5">
                <label class="font-semibold text-sm uppercase">Compile mode</label>

                <div class="mt-1 space-y-1 text-sm">
                  <label class="block mr-auto cursor-pointer space-x-2">
                    <input
                      checked={mode() === compileMode.DOM}
                      value="DOM"
                      class="text-brand-default"
                      onChange={[setMode, compileMode.DOM]}
                      type="radio"
                      name="dom"
                      id="dom"
                    />
                    <span>Client side rendering</span>
                  </label>

                  <label class="block mr-auto cursor-pointer space-x-2">
                    <input
                      checked={mode() === compileMode.SSR}
                      value="SSR"
                      class="text-brand-default"
                      onChange={[setMode, compileMode.SSR]}
                      type="radio"
                      name="dom"
                      id="dom"
                    />
                    <span>Server side rendering</span>
                  </label>

                  <label class="block mr-auto cursor-pointer space-x-2">
                    <input
                      checked={mode() === compileMode.HYDRATABLE}
                      value="HYDRATABLE"
                      class="text-brand-default"
                      onChange={[setMode, compileMode.HYDRATABLE]}
                      type="radio"
                      name="dom"
                      id="dom"
                    />
                    <span>Client side rendering with hydration</span>
                  </label>
                </div>
              </div>
            </section>
          </Match>
        </Switch>
      </div>
    </div>
  );
};

export default Repl;
