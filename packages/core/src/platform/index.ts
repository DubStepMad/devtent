export {
  binaryName,
  binPath,
  currentPlatform,
  isUnix,
  isWindows,
  npmLauncher,
  redisConfigPath,
  type DevTentPlatform,
} from "./binary.js";

export {
  requestElevatedHostsSyncUnix,
  getUnixHostsSyncInstructions,
  launchUnixElevated,
} from "./hosts-elevate-unix.js";
