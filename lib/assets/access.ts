export type AssetAccessFacts = {
  status: "temporary" | "permanent";
  ownerId: string;
  avatarRefCount: number;
  activeCurrentRefCount: number;
  unavailableCurrentRefCount: number;
  revisionRefCount: number;
};

export type AssetViewer = {
  userId: string;
  isAdmin: boolean;
};

export function decideAssetReadAccess(
  asset: AssetAccessFacts,
  viewer: AssetViewer,
): "allow" | "deny" {
  if (asset.status === "temporary") {
    return viewer.isAdmin || asset.ownerId === viewer.userId ? "allow" : "deny";
  }

  if (asset.avatarRefCount > 0 || asset.activeCurrentRefCount > 0) return "allow";

  const protectedHistoricalReference = (
    asset.unavailableCurrentRefCount > 0 || asset.revisionRefCount > 0
  );
  return viewer.isAdmin && protectedHistoricalReference ? "allow" : "deny";
}
