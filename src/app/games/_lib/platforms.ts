// src/app/games/_lib/platforms.ts
// The PlayStation and Nintendo platforms the collection supports, with their
// IGDB ids, and helpers that work out a platform from text such as
// "PAL Playstation 4" or "Mario Kart World - Nintendo Switch 2".
// Shared by the browser and the API routes.

export type Family = "playstation" | "nintendo";

export interface Platform {
  id: number; // IGDB platform id
  name: string;
  short: string;
  family: Family;
  // Words that name this platform in a product title (checked longest first)
  aliases: string[];
  current?: boolean; // shown first in pickers
}

export const PLATFORMS: Platform[] = [
  { id: 167, name: "PlayStation 5", short: "PS5", family: "playstation", aliases: ["playstation 5", "ps5"], current: true },
  { id: 48, name: "PlayStation 4", short: "PS4", family: "playstation", aliases: ["playstation 4", "ps4"], current: true },
  { id: 9, name: "PlayStation 3", short: "PS3", family: "playstation", aliases: ["playstation 3", "ps3"] },
  { id: 8, name: "PlayStation 2", short: "PS2", family: "playstation", aliases: ["playstation 2", "ps2"] },
  { id: 7, name: "PlayStation", short: "PS1", family: "playstation", aliases: ["playstation 1", "ps1", "psx", "psone", "ps one"] },
  { id: 38, name: "PSP", short: "PSP", family: "playstation", aliases: ["playstation portable", "psp"] },
  { id: 46, name: "PS Vita", short: "Vita", family: "playstation", aliases: ["playstation vita", "ps vita", "psvita", "vita"] },

  { id: 508, name: "Nintendo Switch 2", short: "Switch 2", family: "nintendo", aliases: ["nintendo switch 2", "switch 2", "switch2"], current: true },
  { id: 130, name: "Nintendo Switch", short: "Switch", family: "nintendo", aliases: ["nintendo switch", "switch"], current: true },
  { id: 41, name: "Wii U", short: "Wii U", family: "nintendo", aliases: ["nintendo wii u", "wii u", "wiiu"] },
  { id: 5, name: "Wii", short: "Wii", family: "nintendo", aliases: ["nintendo wii", "wii"] },
  { id: 21, name: "GameCube", short: "GameCube", family: "nintendo", aliases: ["nintendo gamecube", "gamecube", "ngc"] },
  { id: 4, name: "Nintendo 64", short: "N64", family: "nintendo", aliases: ["nintendo 64", "n64"] },
  { id: 19, name: "Super Nintendo", short: "SNES", family: "nintendo", aliases: ["super nintendo", "super nes", "snes", "super famicom"] },
  { id: 18, name: "NES", short: "NES", family: "nintendo", aliases: ["nintendo entertainment system", "nes", "famicom"] },
  { id: 137, name: "New Nintendo 3DS", short: "New 3DS", family: "nintendo", aliases: ["new nintendo 3ds", "new 3ds"] },
  { id: 37, name: "Nintendo 3DS", short: "3DS", family: "nintendo", aliases: ["nintendo 3ds", "3ds"] },
  { id: 20, name: "Nintendo DS", short: "DS", family: "nintendo", aliases: ["nintendo ds", "nds"] },
  { id: 24, name: "Game Boy Advance", short: "GBA", family: "nintendo", aliases: ["game boy advance", "gameboy advance", "gba"] },
  { id: 22, name: "Game Boy Color", short: "GBC", family: "nintendo", aliases: ["game boy color", "gameboy color", "gbc"] },
  { id: 33, name: "Game Boy", short: "Game Boy", family: "nintendo", aliases: ["game boy", "gameboy"] },
];

export const PLATFORM_IDS = PLATFORMS.map((p) => p.id);
const BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]));

export function platformById(id: number | null | undefined): Platform | undefined {
  return id == null ? undefined : BY_ID.get(id);
}

export function familyIds(family: Family | "all"): number[] {
  return family === "all" ? PLATFORM_IDS : PLATFORMS.filter((p) => p.family === family).map((p) => p.id);
}

export const FAMILY_LABEL: Record<Family, string> = { playstation: "PlayStation", nintendo: "Nintendo" };

// Every alias, longest first, so "nintendo switch 2" wins over "switch"
const ALIASES = PLATFORMS.flatMap((p) => p.aliases.map((alias) => ({ alias, id: p.id }))).sort(
  (a, b) => b.alias.length - a.alias.length
);

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ALIAS_PATTERNS = ALIASES.map(({ alias, id }) => ({
  id,
  alias,
  re: new RegExp(`(^|[^a-z0-9])${escapeRegExp(alias)}(?![a-z0-9])`, "i"),
}));

const BARE_WORD_NEEDS: Record<string, RegExp> = {
  switch: /nintendo/i,
  vita: /playstation|sony/i,
  nes: /nintendo/i,
};

/** The platform named in a piece of text, if any. */
export function detectPlatform(text: string | null | undefined): number | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const { re, id, alias } of ALIAS_PATTERNS) {
    if (!re.test(lower)) continue;
    // A bare "switch" or "vita" could be part of a title, so it needs the maker named too
    const needs = BARE_WORD_NEEDS[alias];
    if (needs && !needs.test(lower)) continue;
    return id;
  }
  return null;
}

/** Text with every platform name removed, e.g. for searching IGDB with a product title. */
export function stripPlatformWords(text: string): string {
  let out = ` ${text} `;
  for (const { re } of ALIAS_PATTERNS) out = out.replace(new RegExp(re.source, "gi"), "$1 ");
  return out.replace(/\b(sony|nintendo)\b/gi, " ").replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------
// Codes printed on the box
// ------------------------------------------------------------

export type CodeKind = "barcode" | "product";

// Product code prefixes and the platform they belong to. These are hints only:
// the code itself is matched through people's confirmed answers.
const PRODUCT_PREFIXES: { re: RegExp; platform: number }[] = [
  { re: /^(CUSA|PLAS|PCAS|PLJS|PLJM|PCJS|PCKS)-/, platform: 48 }, // PS4
  { re: /^(PPSA|ECAS|ELAS|ELJS|ELJM|ECJS)-/, platform: 167 }, // PS5
  { re: /^(BLUS|BLES|BCUS|BCES|BLJM|BCJS|BLAS|BCAS|NPUB|NPEB)-/, platform: 9 }, // PS3
  { re: /^(SLUS|SCUS|SLES|SCES|SLPS|SLPM|SCPS)-/, platform: 8 }, // PS2 (PS1 shares these; corrected by the user)
  { re: /^(PCSA|PCSE|PCSB|PCSF|PCSG|PCSH|VLJS|VLJM)-/, platform: 46 }, // Vita
  { re: /^(ULUS|UCUS|ULES|UCES|ULJS|ULJM|UCJS)-/, platform: 38 }, // PSP
  { re: /^BEE-/, platform: 508 }, // Switch 2
  { re: /^HAC-/, platform: 130 }, // Switch
  { re: /^WUP-/, platform: 41 }, // Wii U
  { re: /^RVL-/, platform: 5 }, // Wii
  { re: /^DOL-/, platform: 21 }, // GameCube
  { re: /^NUS-/, platform: 4 }, // N64
  { re: /^CTR-/, platform: 37 }, // 3DS
  { re: /^KTR-/, platform: 137 }, // New 3DS
  { re: /^NTR-/, platform: 20 }, // DS
  { re: /^AGB-/, platform: 24 }, // GBA
  { re: /^CGB-/, platform: 22 }, // GBC
  { re: /^DMG-/, platform: 33 }, // Game Boy
];

/** GS1 check digit for EAN-8 / UPC-A / EAN-13 / GTIN-14 digits. */
export function validGtin(digits: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits)) return false;
  const nums = digits.split("").map(Number);
  const check = nums.pop()!;
  let sum = 0;
  // Weights 3,1,3,1... from the right, excluding the check digit
  for (let i = nums.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += nums[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}

export interface ParsedCode {
  kind: CodeKind;
  code: string; // stored form
  platformHint: number | null;
}

/**
 * Cleans up a scanned or typed code. Barcodes become 13 digits (a 12-digit UPC-A
 * gets a leading 0) so US and European forms match. Product codes become
 * upper-case with a dash after the prefix: "cusa07408" -> "CUSA-07408".
 * Returns null for anything that isn't a valid code.
 */
export function parseCode(raw: string): ParsedCode | null {
  const text = raw.trim().toUpperCase();
  const digits = text.replace(/[\s-]/g, "");

  if (/^\d+$/.test(digits)) {
    if (!validGtin(digits)) return null;
    const code = digits.length === 12 ? `0${digits}` : digits;
    return { kind: "barcode", code, platformHint: null };
  }

  const compact = text.replace(/\s+/g, "");
  const m = /^([A-Z]{3,4})-?([0-9A-Z][0-9A-Z-]{3,11})$/.exec(compact);
  if (!m) return null;
  const code = `${m[1]}-${m[2]}`.replace(/-+/g, "-");
  if (code.length > 20 || code.endsWith("-")) return null;
  const hint = PRODUCT_PREFIXES.find((p) => p.re.test(code))?.platform ?? null;
  return { kind: "product", code, platformHint: hint };
}

/** A UPC-A form of a 13-digit barcode starting with 0, for databases that only know UPC. */
export function upcForm(code: string): string {
  return code.length === 13 && code.startsWith("0") ? code.slice(1) : code;
}
