import * as cli from "@asset-studio/cli";

/**
 * The CLI library calls the studio makes. The studio reads and changes the
 * work folder and the settings only through these (S7, DEC-839); tests swap
 * in spies.
 */
export type Library = Pick<
  typeof cli,
  | "approve"
  | "reject"
  | "loadJob"
  | "readIndex"
  | "readNotes"
  | "workPaths"
  | "resolveWorkFolder"
  | "savedWorkFolder"
  | "setWorkFolder"
>;

export const realLibrary: Library = {
  approve: cli.approve,
  reject: cli.reject,
  loadJob: cli.loadJob,
  readIndex: cli.readIndex,
  readNotes: cli.readNotes,
  workPaths: cli.workPaths,
  resolveWorkFolder: cli.resolveWorkFolder,
  savedWorkFolder: cli.savedWorkFolder,
  setWorkFolder: cli.setWorkFolder,
};

export {
  type AssetKey,
  assetKeys,
  CliError,
  profileKey,
} from "@asset-studio/cli";
