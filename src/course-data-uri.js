import { Gunzip, gzipSync } from 'fflate';

export const MAX_DATA_COURSE_URI_LENGTH = 64 * 1024;
export const MAX_DATA_COURSE_BYTES = 2 * 1024 * 1024;

const LIASCRIPT_GZIP_DATA_URI_RE =
  /^data:text\/plain;charset=utf-8;Content-Encoding=gzip;base64,([A-Za-z\d+/]+={0,2})$/;
function hasCanonicalBase64Encoding(payload) {
  try {
    return btoa(atob(payload)) === payload;
  } catch {
    return false;
  }
}

export function encodedLiaScriptGzipPayload(value) {
  if (typeof value !== 'string' || value.length > MAX_DATA_COURSE_URI_LENGTH) return null;
  const match = value.match(LIASCRIPT_GZIP_DATA_URI_RE);
  if (!match || match[1].length % 4 !== 0 ||
      !hasCanonicalBase64Encoding(match[1])) return null;
  return match[1];
}

export function isLiaScriptGzipDataCourseUri(value) {
  return encodedLiaScriptGzipPayload(value) !== null;
}

function decodeBase64(value) {
  let binary;
  try { binary = atob(value); }
  catch { throw new Error('Die komprimierte LiaScript-Kursquelle ist nicht gültig kodiert.'); }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function gunzipBounded(compressed) {
  const chunks = [];
  let total = 0;
  let members = 1;
  let complete = false;
  let limitExceeded = false;
  let multipleMembers = false;
  const gunzip = new Gunzip((chunk, final) => {
    total += chunk.byteLength;
    if (total > MAX_DATA_COURSE_BYTES) {
      limitExceeded = true;
      throw new Error('limit');
    }
    if (chunk.byteLength) chunks.push(chunk.slice());
    if (final) complete = true;
  });
  gunzip.onmember = () => {
    members++;
    if (members > 1) {
      multipleMembers = true;
      throw new Error('members');
    }
  };
  try {
    // Small compressed chunks bound every transient inflate result and expose
    // a following member before finalization. Never trust forgeable ISIZE.
    for (let offset = 0; offset < compressed.length; offset += 16) {
      const end = Math.min(offset + 16, compressed.length);
      gunzip.push(compressed.subarray(offset, end), end === compressed.length);
    }
  } catch {
    if (limitExceeded) throw new Error('Die komprimierte LiaScript-Kursquelle ist zu groß.');
    if (multipleMembers) throw new Error('Die LiaScript-Kursquelle darf nur einen gzip-Datenblock enthalten.');
    throw new Error('Die komprimierte LiaScript-Kursquelle konnte nicht entpackt werden.');
  }
  if (!complete || members !== 1) {
    throw new Error('Die komprimierte LiaScript-Kursquelle konnte nicht vollständig entpackt werden.');
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function isCanonicalCourseGzip(compressed, markdown) {
  const canonical = gzipSync(markdown, { level: 6, mem: 8, mtime: 0 });
  if (canonical.byteLength !== compressed.byteLength) return false;
  for (let i = 0; i < canonical.byteLength; i++) {
    if (canonical[i] !== compressed[i]) return false;
  }
  return true;
}

export function decodeLiaScriptGzipDataCourse(uri) {
  const payload = encodedLiaScriptGzipPayload(uri);
  if (!payload) throw new Error('Die LiaScript-Data-URI verwendet kein unterstütztes Kursformat.');
  const compressed = decodeBase64(payload);
  if (compressed.length < 18 || compressed[0] !== 0x1f ||
      compressed[1] !== 0x8b || compressed[2] !== 8) {
    throw new Error('Die komprimierte LiaScript-Kursquelle enthält keine gültigen gzip-Daten.');
  }
  const view = new DataView(
    compressed.buffer, compressed.byteOffset, compressed.byteLength);
  const declaredSize = view.getUint32(compressed.byteLength - 4, true);
  if (declaredSize === 0 || declaredSize > MAX_DATA_COURSE_BYTES) {
    throw new Error('Die komprimierte LiaScript-Kursquelle ist zu groß.');
  }
  const markdown = gunzipBounded(compressed);
  if (markdown.byteLength !== declaredSize ||
      markdown.byteLength > MAX_DATA_COURSE_BYTES) {
    throw new Error('Die entpackte LiaScript-Kursquelle hat eine ungültige Größe.');
  }
  if (crc32(markdown) !== view.getUint32(compressed.byteLength - 8, true)) {
    throw new Error('Die komprimierte LiaScript-Kursquelle hat eine ungültige Prüfsumme.');
  }
  if (!isCanonicalCourseGzip(compressed, markdown)) {
    throw new Error('Die komprimierte LiaScript-Kursquelle verwendet keine kanonischen gzip-Daten.');
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(markdown); }
  catch { throw new Error('Die LiaScript-Kursquelle enthält keinen gültigen UTF-8-Text.'); }
}
