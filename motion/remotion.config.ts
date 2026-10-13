import { Config } from "@remotion/cli/config";

// Fonts and brand files come from the app's own public/ folder.
Config.setPublicDir("../public");
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
Config.setColorSpace("bt709");
Config.setOverwriteOutput(true);
