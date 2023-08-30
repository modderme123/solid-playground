import { Component, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { useZoom } from '../hooks/useZoom';
import { GridResizer } from './gridResizer';

const useDevtoolsSrc = () => {
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <meta charset="utf-8">
  <title>DevTools</title>
  <style>
    @media (prefers-color-scheme: dark) {
      body {
        background-color: rgb(41 42 45);
      }
    }
  </style>
  <meta name="referrer" content="no-referrer">
  <script src="https://unpkg.com/@ungap/custom-elements/es.js"></script>
  <script type="module" src="https://cdn.jsdelivr.net/npm/chii@1.8.0/public/front_end/entrypoints/chii_app/chii_app.js"></script>
  <body class="undocked" id="-blink-dev-tools">`;
  const devtoolsRawUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  onCleanup(() => URL.revokeObjectURL(devtoolsRawUrl));
  return `${devtoolsRawUrl}#?embedded=${encodeURIComponent(location.origin)}`;
};

export const Preview: Component<Props> = (props) => {
  const { zoomState } = useZoom();

  let iframe!: HTMLIFrameElement;
  let devtoolsIframe!: HTMLIFrameElement;
  let resizer!: HTMLDivElement;
  let outerContainer!: HTMLDivElement;

  let devtoolsLoaded = false;
  let isIframeReady = false;

  createEffect(() => {
    const dark = props.isDark;

    if (!isIframeReady) return;

    iframe.contentWindow!.postMessage({ event: 'DARK', value: dark }, '*');
  });

  let firstRun = true;
  createEffect(() => {
    props.reloadSignal;
    props.importMap;
    firstRun = false;
    if (!firstRun) {
      isIframeReady = false;
      iframe.src = props.iframeSrcUrl;
    }
  });

  createEffect(() => {
    const code = props.code;

    if (!isIframeReady) return;

    iframe.contentWindow!.postMessage({ event: 'CODE_UPDATE', value: code }, '*');
  });

  const devtoolsSrc = useDevtoolsSrc();

  const messageListener = (event: MessageEvent) => {
    if (event.source === iframe.contentWindow) {
      devtoolsIframe.contentWindow!.postMessage(event.data, '*');
    }
    if (event.source === devtoolsIframe.contentWindow) {
      iframe.contentWindow!.postMessage({ event: 'DEV', data: event.data }, '*');
    }
  };
  window.addEventListener('message', messageListener);
  onCleanup(() => window.removeEventListener('message', messageListener));

  const styleScale = () => {
    if (zoomState.scale === 100 || !zoomState.scaleIframe) return '';

    return `width: ${zoomState.scale}%; height: ${zoomState.scale}%; transform: scale(${
      zoomState.zoom / 100
    }); transform-origin: 0 0;`;
  };

  const [iframeHeight, setIframeHeight] = createSignal<number>(0.625);

  const changeIframeHeight = (clientY: number) => {
    let position: number;
    let size: number;

    const rect = outerContainer.getBoundingClientRect();

    position = clientY - rect.top - resizer.offsetHeight / 2;
    size = outerContainer.offsetHeight - resizer.offsetHeight;
    const percentage = position / size;

    setIframeHeight(percentage);
  };

  createEffect(() => {
    localStorage.setItem('uiTheme', props.isDark ? '"dark"' : '"default"');
    devtoolsIframe.contentWindow!.location.reload();
  });
  return (
    <div class="flex min-h-0 flex-1 flex-col" ref={outerContainer} classList={props.classList}>
      <iframe
        title="Solid REPL"
        class="dark:bg-other block min-h-0 min-w-0 overflow-scroll bg-white p-0"
        style={styleScale() + `flex: ${props.devtools ? iframeHeight() : 1};`}
        ref={iframe}
        src={props.iframeSrcUrl}
        onload={() => {
          isIframeReady = true;

          if (devtoolsLoaded) iframe.contentWindow!.postMessage({ event: 'LOADED' }, '*');
          iframe.contentWindow!.postMessage({ event: 'IMPORT_MAP', value: props.importMap }, '*');
          if (props.code) iframe.contentWindow!.postMessage({ event: 'CODE_UPDATE', value: props.code }, '*');
          iframe.contentWindow!.postMessage({ event: 'DARK', value: props.isDark }, '*');
        }}
      />
      <Show when={props.devtools}>
        <GridResizer
          ref={resizer}
          isHorizontal={true}
          onResize={(_, y) => {
            changeIframeHeight(y);
          }}
        />
      </Show>
      <iframe
        title="Devtools"
        class="min-h-0 min-w-0"
        style={`flex: ${1 - iframeHeight()};`}
        ref={devtoolsIframe}
        src={devtoolsSrc}
        onload={() => (devtoolsLoaded = true)}
        classList={{ block: props.devtools, hidden: !props.devtools }}
      />
    </div>
  );
};

type Props = {
  importMap: Record<string, string>;
  iframeSrcUrl: string;
  classList?: {
    [k: string]: boolean | undefined;
  };
  code: Record<string, string>;
  reloadSignal: boolean;
  devtools: boolean;
  isDark: boolean;
};
