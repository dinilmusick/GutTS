/**
 * Explicit Google Drive adapter. The optional googleapis package is loaded only
 * when this adapter is requested, never as a side effect of importing GutTS.
 */
export type GoogleApisModule = typeof import("googleapis");

export async function loadGoogleApis(): Promise<GoogleApisModule> {
  return import("googleapis");
}

export async function createGoogleDriveClient(options: {auth: unknown}): Promise<unknown> {
  const {google} = await loadGoogleApis();
  return google.drive({version: "v3", auth: options.auth as never});
}
