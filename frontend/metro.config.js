const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.blockList = [/\/_legacy\/.*/];
config.resolver.sourceExts.push("sql"); // drizzle migrations

module.exports = config;
