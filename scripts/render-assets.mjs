import sharp from "sharp";
import { readFile } from "node:fs/promises";
const icon = await readFile("assets/icon.svg");
const splash = await readFile("assets/splash.svg");
await sharp(icon, { density: 384 }).resize(1024, 1024).png().toFile("assets/icon.png");
await sharp(icon, { density: 384 }).resize(1024, 1024).flatten({ background: "#0c1014" }).png().toFile("assets/icon-foreground.png");
await sharp(splash, { density: 200 }).resize(2732, 2732).png().toFile("assets/splash.png");
await sharp(splash, { density: 200 }).resize(2732, 2732).png().toFile("assets/splash-dark.png");
console.log("rendered icon.png (1024) + splash.png/splash-dark.png (2732)");
