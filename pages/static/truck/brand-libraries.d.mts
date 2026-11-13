// Types for the Worker, which limits AI output to these libraries (same file the merchant page uses for hover help).
export interface LibraryEntry { readonly id: string; readonly label: string; readonly definition: string; readonly example: string }
export interface BaselineEntry { readonly id: string; readonly label: string; readonly typical: string; readonly method: "ai" | "data" }
export declare const TONES: readonly LibraryEntry[];
export declare const AUDIENCES: readonly LibraryEntry[];
export declare const BASELINE: readonly BaselineEntry[];
export declare function toneByLabel(label: string): LibraryEntry | null;
export declare function audienceByLabel(label: string): LibraryEntry | null;
