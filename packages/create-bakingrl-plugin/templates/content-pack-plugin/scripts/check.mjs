#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const required = [
  "resources/content.json",
  "resources/badges/blue.svg",
  "resources/badges/orange.svg"
];

for (const path of required) {
  if (!existsSync(resolve(path))) {
    console.error(`Missing required content file: ${path}`);
    process.exit(1);
  }
}

console.log("Content pack resources are present.");
