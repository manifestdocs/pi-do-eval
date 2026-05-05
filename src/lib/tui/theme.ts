import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

interface ThemeJson {
  fg: Record<string, string>;
  bg: Record<string, string>;
}

const themePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "theme.json");
const themeData: ThemeJson = JSON.parse(fs.readFileSync(themePath, "utf-8"));

function hexToAnsi(hex: string, layer: "fg" | "bg"): string {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m?.[1] || !m[2] || !m[3]) return "";
  const r = Number.parseInt(m[1], 16);
  const g = Number.parseInt(m[2], 16);
  const b = Number.parseInt(m[3], 16);
  return layer === "fg" ? `\x1b[38;2;${r};${g};${b}m` : `\x1b[48;2;${r};${g};${b}m`;
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function wrap(open: string, text: string): string {
  return `${open}${text}${RESET}`;
}

export const theme = {
  fg(key: keyof ThemeJson["fg"] | string, text: string): string {
    const hex = themeData.fg[key];
    if (!hex) return text;
    return wrap(hexToAnsi(hex, "fg"), text);
  },
  bg(key: keyof ThemeJson["bg"] | string, text: string): string {
    const hex = themeData.bg[key];
    if (!hex) return text;
    return wrap(hexToAnsi(hex, "bg"), text);
  },
  bold(text: string): string {
    return wrap(BOLD, text);
  },
  dim(text: string): string {
    return wrap(DIM, text);
  },
};

export type ThemeFg = keyof ThemeJson["fg"];
export type ThemeBg = keyof ThemeJson["bg"];
