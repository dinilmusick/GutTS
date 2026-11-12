/**
 * Legacy aggregate storage entrypoint.
 * Prefer the isolated ./storage/s3 and ./storage/google-drive subpaths so each
 * optional provider is loaded only by applications that use it.
 */
export * from "./s3.js";
export {loadGoogleApis, createGoogleDriveClient} from "./google-drive.js";
