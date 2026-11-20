using CUE4Parse.FileProvider;
using CUE4Parse.UE4.AssetRegistry;
using CUE4Parse.UE4.VirtualFileSystem;

static class WorkbenchAssetClasses
{
    public static Dictionary<string, string> Read(DefaultFileProvider provider)
    {
        var classes = new Dictionary<string, string>(provider.PathComparer);
        var registries = provider.Files.Values.OfType<VfsEntry>()
            .Where(file => file.Path.EndsWith("/AssetRegistry.bin", StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(file => file.Vfs.ReadOrder)
            .ThenByDescending(file => file.Vfs.Path, provider.PathComparer)
            .DistinctBy(file => file.Path, provider.PathComparer).ToArray();
        if (registries.Length == 0) return classes;

        provider.LoadVirtualPaths();
        foreach (var registry in registries)
        {
            using var reader = registry.CreateReader();
            foreach (var asset in new FPartialAssetRegistryState(reader).PreallocatedAssetDataBuffers)
            {
                var packageName = asset.PackageName.Text;
                var packageLeaf = packageName.AsSpan(packageName.LastIndexOf('/') + 1);
                var assetName = asset.AssetName.Text.AsSpan();
                var assetClass = asset.AssetClass.Text;
                if (assetClass.EndsWith("GeneratedClass", StringComparison.Ordinal) && assetName.EndsWith("_C", StringComparison.Ordinal))
                    assetName = assetName[..^2];
                if (!assetName.Equals(packageLeaf, StringComparison.OrdinalIgnoreCase) || asset.AssetClass.IsNone) continue;

                var path = provider.FixPath(packageName);
                classes.TryAdd(assetClass == "World" ? Path.ChangeExtension(path, ".umap") : path, assetClass);
            }
        }
        return classes;
    }
}
