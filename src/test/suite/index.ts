import * as vscode from "vscode";
import { runAll } from "./tiny.js";
import "./extension.test.js";

export async function run(): Promise<void> {
  // The suggested next request is an extra request after every answer, and the stub servers count
  // requests: off for the suite, on in the one test that is about it.
  await vscode.workspace.getConfiguration("hiveyCode").update("chat.suggestNext", false, vscode.ConfigurationTarget.Global);
  return runAll();
}
