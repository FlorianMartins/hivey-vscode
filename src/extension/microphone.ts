import * as vscode from "vscode";
import type { InputDevice } from "../core/dictation/capture.js";
import { t } from "../shared/i18n.js";
import { SECTION } from "./config.js";

/**
 * Ask which microphone to listen to, and remember the answer.
 *
 * One place for it, because it is asked from two: the command in the panel's menu, and the
 * microphone button itself when a recorder that must be told a device finds several and none chosen.
 * Two copies of a picker drift — one offering "the system default" where it cannot mean anything.
 *
 * `allowDefault` is false for DirectShow: it has no device called "default", and offering it is
 * offering the exact failure this picker exists to get past.
 */
export async function pickMicrophone(devices: InputDevice[], allowDefault: boolean): Promise<InputDevice | undefined> {
  const current = vscode.workspace.getConfiguration(SECTION).get<string>("dictation.device", "");
  const items = [
    ...(allowDefault ? [{ label: t("The system default"), id: "", picked: !current }] : []),
    ...devices.map((d) => ({ label: d.label, id: d.id, picked: d.id === current, ...(d.id === current ? { description: t("current") } : {}) })),
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t("Which microphone should dictation listen to?"),
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  if (!picked) return undefined;
  await vscode.workspace.getConfiguration(SECTION).update("dictation.device", picked.id, vscode.ConfigurationTarget.Global);
  void vscode.window.setStatusBarMessage(t("Dictation will listen to {0}.", picked.label), 5000);
  return { id: picked.id, label: picked.label };
}
