export function extractKeys(srcDir: string): Map<string, { plural: boolean; one?: string }>;
export function placeholders(s: string): string;
export function checkLocale(keys: Map<string, { plural: boolean; one?: string }>, dict: Record<string, unknown>, code: string): string[];
