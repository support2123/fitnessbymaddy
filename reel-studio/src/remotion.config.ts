// FBM pipeline defaults. --gl=angle is REQUIRED for any 3D (ThreeCanvas) comp on this Mac:
// the default backend fails with "Error creating WebGL context".
import { Config } from "@remotion/cli/config";
Config.setChromiumOpenGlRenderer("angle");
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

