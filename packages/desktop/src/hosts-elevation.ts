import { dialog, BrowserWindow } from "electron";
import {
  launchElevatedHostsSync,
  getElevatedHostsSyncMessage,
  getElevatedHostsSyncFailureMessage,
  type VhostSyncResult,
  type HostsSyncResult,
} from "@devtent/core";
import { openFolderInShell } from "./open-folder.js";

async function promptForHostsElevation(
  hosts: HostsSyncResult,
  parent: BrowserWindow | null
): Promise<"launch" | "show-script" | "cancel"> {
  const dialogOptions = {
    type: "info" as const,
    title: "Update hosts file",
    message: "Administrator permission required",
    detail:
      "DevTent needs to update your Windows hosts file so local *.test domains work in the browser.\n\n" +
      "Click Continue, then click Yes on the Windows security prompt that appears.",
    buttons: ["Continue", "Show script in Explorer", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  };

  const { response } = parent
    ? await dialog.showMessageBox(parent, dialogOptions)
    : await dialog.showMessageBox(dialogOptions);

  if (response === 1) return "show-script";
  if (response === 2) return "cancel";
  return "launch";
}

export async function completeHostsElevation(
  result: VhostSyncResult,
  getParentWindow: () => BrowserWindow | null
): Promise<VhostSyncResult> {
  const hosts = result.hosts;
  if (!hosts.elevationPending || !hosts.hostsHelperPath) {
    return result;
  }

  const choice = await promptForHostsElevation(hosts, getParentWindow());
  if (choice === "cancel") {
    return {
      ...result,
      hosts: {
        ...hosts,
        elevationPending: false,
        message: "Hosts file was not updated. Use “Update hosts file (Admin)” when you are ready.",
      },
    };
  }

  if (choice === "show-script") {
    await openFolderInShell(hosts.hostsHelperPath);
    return {
      ...result,
      hosts: {
        ...hosts,
        elevationPending: false,
        elevationLaunchFailed: true,
        message: `Right-click ${hosts.hostsHelperPath} and choose Run as administrator.`,
      },
    };
  }

  const launched = await launchElevatedHostsSync(hosts.hostsHelperPath);
  if (launched) {
    return {
      ...result,
      hosts: {
        ...hosts,
        elevationPending: false,
        elevationRequested: true,
        message: getElevatedHostsSyncMessage(hosts.hostsHelperPath),
      },
    };
  }

  await openFolderInShell(hosts.hostsHelperPath);
  return {
    ...result,
    hosts: {
      ...hosts,
      elevationPending: false,
      elevationLaunchFailed: true,
      message: getElevatedHostsSyncFailureMessage(hosts.hostsHelperPath),
    },
  };
}

export async function completeStandaloneHostsElevation(
  hosts: HostsSyncResult,
  getParentWindow: () => BrowserWindow | null
): Promise<HostsSyncResult> {
  const wrapped = await completeHostsElevation({ vhosts: [], hosts }, getParentWindow);
  return wrapped.hosts;
}
