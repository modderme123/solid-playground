import type { Tab } from '../../src';

/**
 * This function will convert the tabs of the playground
 * into a ZIP formatted playground that can then be reimported later on
 */
export async function exportToZip(tabs: Tab[]): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  for (const tab of tabs) {
    zip.file(tab.name, tab.source);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);

  const anchor = (<a href={url} target="_blank" rel="noopener" download />) as HTMLElement;
  document.body.prepend(anchor);
  anchor.click();
  anchor.remove();
}
