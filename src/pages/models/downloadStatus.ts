import type { DownloadRecord, ModelEntity } from "../../api/types";

export const UNFINISHED_DOWNLOAD_STATUSES = ["queued", "active", "paused"];

/** Downloads that still own their target directory. Only one of them may
 * exist per directory (download-duplicate-guard), so these are exactly the
 * ones whose repo or variant must not be offered for download again. */
export function unfinishedDownloads(downloads: DownloadRecord[]): DownloadRecord[] {
  return downloads.filter((download) => UNFINISHED_DOWNLOAD_STATUSES.includes(download.status));
}

// Per-search-result local status (search-results-download-status): an
// unfinished download for the repo wins («скачивается»), else a registered
// model for it means it's downloaded («скачан»), else nothing.
export function resultDownloadStatus(
  downloads: DownloadRecord[],
  models: ModelEntity[],
  repoId: string
): "downloading" | "downloaded" | null {
  if (unfinishedDownloads(downloads).some((d) => d.model_ref === repoId)) return "downloading";
  if (models.some((m) => m.ref === repoId)) return "downloaded";
  return null;
}

/** reference/model_browse + model_search_download — search a provider's
 * catalog, pick a repo, list its variant files with sizes, start downloads.
 * Tasks/libraries/license all collapse into one `tags` filter sent to the
 * plugin (see downloads/api.py); parameter-size buckets are applied
 * client-side over the already-fetched results (HF's API has no structured
 * parameter-count field to filter on server-side). */
