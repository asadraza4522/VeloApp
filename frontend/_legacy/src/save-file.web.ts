// Web: no filesystem access — trigger a normal browser download instead.
export async function saveFileToDevice(
  url: string,
  filename: string,
  _onProgress: (pct: number) => void,
): Promise<string> {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return url;
}
