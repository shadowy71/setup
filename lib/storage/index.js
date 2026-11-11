import 'server-only';
import { createAppsScriptProvider } from './google-apps-script.js';

// Storage providers are intentionally selected on the server only. This layer
// does not authenticate a user or authorize a parent resource; a future route
// must do both before calling any provider operation.
function provider() {
  return createAppsScriptProvider({ url: process.env.GOOGLE_APPS_SCRIPT_URL, secret: process.env.GOOGLE_APPS_SCRIPT_SHARED_SECRET });
}
export async function getStorageHealth() { return provider().health(); }
export async function uploadFile(file) { return provider().upload(file); }
export async function findFileByUploadKey(key) { return provider().lookup(key); }
export async function getFileMetadata(id) { return provider().metadata(id); }
export async function downloadFile(id, metadata) { return provider().download(id, metadata); }
export async function deleteFile(id) { return provider().delete(id); }

export async function deleteFileByUploadKey(key) { return provider().deleteByKey(key); }

export async function uploadFileV3(file) { return provider().uploadV3(file); }
export async function deleteFileByUploadKeyV3(key) { return provider().deleteByKeyV3(key); }
