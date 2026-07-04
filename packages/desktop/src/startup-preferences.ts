export interface StartupPreferences {
  launchAtLogin: boolean;
  autoStartServices: boolean;
}

export function readStartupPreferences(settings: {
  launchAtLogin?: boolean;
  autoStartServices?: boolean;
}): StartupPreferences {
  return {
    launchAtLogin: settings.launchAtLogin === true,
    autoStartServices: settings.autoStartServices === true,
  };
}
