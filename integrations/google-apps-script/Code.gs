/**
 * Campus+ Drive gateway. Deploy as a web app executing as the Drive owner.
 * This gateway is not an authorization service: only the Campus+ backend may
 * sign requests, after checking the application user's resource permissions.
 */
var CAMPUS_ROOT = 'CAMPUS_STORAGE_ROOT_FOLDER_ID';
var CAMPUS_SECRET = 'CAMPUS_STORAGE_SHARED_SECRET';
var CAMPUS_WINDOW_MS = 5 * 60 * 1000;
var CAMPUS_MAX_BYTES = 3 * 1024 * 1024;
var CAMPUS_FILE_PREFIX = 'campus-upload-v2-';
var CAMPUS_NONCE_PREFIX = 'campus-nonce-v1-';
var CAMPUS_DELETED_PREFIX = 'campus-deleted-v1-';

function campusJson_(result) {
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
function campusError_(code) { return { ok: false, code: code }; }
function campusHex_(bytes) {
  return bytes.map(function (n) { return ('0' + (n & 255).toString(16)).slice(-2); }).join('');
}
function campusEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function campusHash_(bytes) {
  return campusHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
}
function campusRoot_() {
  var id = PropertiesService.getScriptProperties().getProperty(CAMPUS_ROOT);
  if (!id) throw new Error('storage_not_configured');
  var folder = DriveApp.getFolderById(id);
  if (folder.isTrashed()) throw new Error('storage_not_configured');
  return folder;
}
function campusMember_(file, root) {
  var parents = file.getParents();
  while (parents.hasNext()) if (parents.next().getId() === root.getId()) return true;
  return false;
}
function campusFile_(id, root) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{10,200}$/.test(id)) throw new Error('invalid_request');
  var file = DriveApp.getFileById(id);
  if (!campusMember_(file, root) || !/^campus-upload-v2-[a-f0-9-]{36}$/.test(file.getName())) throw new Error('not_found');
  return file;
}
function campusRun_(payload) {
  var root = campusRoot_();
  if (payload.operation === 'health') return { ok: true };
  if (payload.operation === 'upload') {
    if (typeof payload.key !== 'string' || !/^[a-f0-9-]{36}$/.test(payload.key) ||
        typeof payload.name !== 'string' || payload.name.length < 1 || payload.name.length > 180 ||
        typeof payload.mime !== 'string' || ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].indexOf(payload.mime) < 0 ||
        typeof payload.base64 !== 'string' || payload.base64.length > 4 * Math.ceil(CAMPUS_MAX_BYTES / 3) ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.base64) || !/^[a-f0-9]{64}$/.test(payload.checksum || '')) {
      return campusError_('invalid_request');
    }
    var bytes = Utilities.base64Decode(payload.base64);
    if (!bytes.length || bytes.length > CAMPUS_MAX_BYTES || campusHash_(bytes) !== payload.checksum) return campusError_('invalid_request');
    // Name is written in the same Drive create operation as the contents. A
    // retry after a lost response finds that name even if the process died
    // immediately after createFile. Lock serializes gateway-side checks.
    if (PropertiesService.getScriptProperties().getProperty(CAMPUS_DELETED_PREFIX + payload.key)) return campusError_('operation_deleted');
    var storageName = CAMPUS_FILE_PREFIX + payload.key;
    var files = root.getFilesByName(storageName);
    var file = files.hasNext() ? files.next() : null;
    if (files.hasNext()) return campusError_('idempotency_conflict');
    if (!file) file = root.createFile(Utilities.newBlob(bytes, payload.mime, storageName));
    // Do not trust createFile or a prior description marker: read stored bytes.
    if (file.isTrashed() || file.getMimeType() !== payload.mime || file.getSize() !== bytes.length ||
        campusHash_(file.getBlob().getBytes()) !== payload.checksum) return campusError_('idempotency_conflict');
    return { ok: true, id: file.getId(), size: file.getSize(), mime: file.getMimeType(), checksum: payload.checksum };
  }
  // Under the gateway lock, install a durable tombstone before deleting. This
  // blocks delayed upload retries even if deletion or its response fails.
  if (payload.operation === 'delete_key') {
    if (typeof payload.key !== 'string' || !/^[a-f0-9-]{36}$/.test(payload.key)) return campusError_('invalid_request');
    PropertiesService.getScriptProperties().setProperty(CAMPUS_DELETED_PREFIX + payload.key, '1');
    var toDelete = root.getFilesByName(CAMPUS_FILE_PREFIX + payload.key);
    while (toDelete.hasNext()) {
      var doomed = toDelete.next();
      if (!doomed.isTrashed()) doomed.setTrashed(true);
    }
    return { ok: true };
  }
  // Recovery after an upload succeeded but its response was lost. The only
  // searchable name is derived from the backend-generated idempotency key.
  if (payload.operation === 'lookup') {
    if (typeof payload.key !== 'string' || !/^[a-f0-9-]{36}$/.test(payload.key)) return campusError_('invalid_request');
    var matches = root.getFilesByName(CAMPUS_FILE_PREFIX + payload.key);
    if (!matches.hasNext()) return { ok: true, found: false };
    var found = matches.next();
    if (matches.hasNext()) return campusError_('idempotency_conflict');
    if (found.isTrashed()) return { ok: true, found: false };
    if (found.getSize() < 1 || found.getSize() > CAMPUS_MAX_BYTES) return campusError_('too_large');
    var foundBytes = found.getBlob().getBytes();
    return { ok: true, found: true, id: found.getId(), size: foundBytes.length, mime: found.getMimeType(), checksum: campusHash_(foundBytes) };
  }
  if (payload.operation === 'metadata') {
    var metadataFile = campusFile_(payload.id, root);
    if (metadataFile.isTrashed()) return campusError_('not_found');
    if (metadataFile.getSize() > CAMPUS_MAX_BYTES) return campusError_('too_large');
    var metadataBytes = metadataFile.getBlob().getBytes();
    return { ok: true, size: metadataBytes.length, mime: metadataFile.getMimeType(), checksum: campusHash_(metadataBytes) };
  }
  if (payload.operation === 'download') {
    var item = campusFile_(payload.id, root);
    if (item.isTrashed()) return campusError_('not_found');
    if (item.getSize() > CAMPUS_MAX_BYTES) return campusError_('too_large');
    var content = item.getBlob().getBytes();
    return { ok: true, size: content.length, mime: item.getMimeType(), checksum: campusHash_(content), base64: Utilities.base64Encode(content) };
  }
  if (payload.operation === 'delete') {
    var target = campusFile_(payload.id, root);
    if (!target.isTrashed()) target.setTrashed(true);
    return { ok: true };
  }
  return campusError_('invalid_operation');
}

function doPost(e) {
  var lock;
  try {
    var raw = e && e.postData && e.postData.contents;
    if (typeof raw !== 'string' || raw.length > 4 * Math.ceil(CAMPUS_MAX_BYTES / 3) + 8192) return campusJson_(campusError_('invalid_request'));
    var envelope = JSON.parse(raw);
    var secret = PropertiesService.getScriptProperties().getProperty(CAMPUS_SECRET);
    if (!secret || secret.length < 32) return campusJson_(campusError_('storage_not_configured'));
    if (!envelope || !Number.isSafeInteger(envelope.timestamp) || Math.abs(Date.now() - envelope.timestamp) > CAMPUS_WINDOW_MS ||
        typeof envelope.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(envelope.nonce) ||
        typeof envelope.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(envelope.requestId) ||
        typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.signature)) {
      return campusJson_(campusError_('unauthorized'));
    }
    var signed = String(envelope.timestamp) + '\n' + envelope.nonce + '\n' + envelope.requestId + '\n' + envelope.payload;
    var expected = campusHex_(Utilities.computeHmacSha256Signature(signed, secret, Utilities.Charset.UTF_8));
    if (!campusEqual_(expected, envelope.signature)) return campusJson_(campusError_('unauthorized'));
    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return campusJson_(campusError_('busy'));
    // Script Properties are durable (unlike CacheService). Lock protects the
    // check/write. Keep entries until even a future-dated valid request expires.
    // Storage/quota errors fail closed, before the operation runs.
    var properties = PropertiesService.getScriptProperties();
    var nonceKey = CAMPUS_NONCE_PREFIX + envelope.nonce;
    if (properties.getProperty(nonceKey)) return campusJson_(campusError_('replay'));
    var existing = properties.getProperties();
    Object.keys(existing).forEach(function (key) {
      if (key.indexOf(CAMPUS_NONCE_PREFIX) === 0 && Number(existing[key]) < Date.now()) properties.deleteProperty(key);
    });
    properties.setProperty(nonceKey, String(envelope.timestamp + CAMPUS_WINDOW_MS + 1000));
    var payload = JSON.parse(envelope.payload);
    return campusJson_(campusRun_(payload));
  } catch (error) {
    // Never log request data, exception text, file content or secrets.
    console.error('Campus storage gateway failed');
    return campusJson_(campusError_('gateway_error'));
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

/** Run once in the editor as the Drive owner; never prints the folder ID. */
function setupCampusStorage() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(CAMPUS_ROOT);
  if (id) {
    campusRoot_();
  } else {
    // Refuse ambiguous matches rather than accidentally use a different folder.
    var found = DriveApp.getFoldersByName('Campus+ Uploads');
    var folder = found.hasNext() ? found.next() : DriveApp.createFolder('Campus+ Uploads');
    if (found.hasNext()) throw new Error('Multiple folders named Campus+ Uploads; choose one manually in Script Properties.');
    props.setProperty(CAMPUS_ROOT, folder.getId());
    campusRoot_();
  }
  console.log('Campus+ storage folder is accessible. Configure the shared secret separately.');
}
