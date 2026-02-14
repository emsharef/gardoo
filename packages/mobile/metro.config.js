const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

// Find the monorepo root (two levels up from packages/mobile)
const monorepoRoot = path.resolve(__dirname, "../..");

const config = getDefaultConfig(__dirname);

// 1. Watch all files in the monorepo
config.watchFolders = [monorepoRoot];

// 2. Let Metro know where to resolve packages from — both the mobile
//    node_modules and the monorepo root node_modules (for hoisted deps)
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

module.exports = config;
