#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/cli.ts
var cli_exports = {};
__export(cli_exports, {
  fail: () => fail
});
module.exports = __toCommonJS(cli_exports);
var [, , command, ...rest] = process.argv;
function fail(message, fixup) {
  console.error(`\u2717 ${message}`);
  if (fixup) console.error(`  \u2192 ${fixup}`);
  process.exit(1);
}
var commands = {};
async function main() {
  const handler = command ? commands[command] : void 0;
  if (!handler) fail(`Unknown command: ${command ?? "(none)"}`, "Available: (none yet)");
  await handler(rest);
}
main();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  fail
});
