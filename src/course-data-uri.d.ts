export const MAX_DATA_COURSE_URI_LENGTH: number;
export const MAX_DATA_COURSE_BYTES: number;
export function encodedLiaScriptGzipPayload(value: unknown): string | null;
export function isLiaScriptGzipDataCourseUri(value: unknown): value is string;
export function decodeLiaScriptGzipDataCourse(uri: string): string;
