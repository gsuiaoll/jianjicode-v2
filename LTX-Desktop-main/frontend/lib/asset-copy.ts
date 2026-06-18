export async function copyToAssetFolder(srcPath: string, projectId: string): Promise<string> {
  // In browser mode, return the path as-is since we can't copy files
  return srcPath
}
