using System.Numerics;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Objects.UObject;
using SharpGLTF.Schema2;

internal static class WorkbenchModelPreview
{
    public static void CorrectEmissive(IEnumerable<UObject> exports, IEnumerable<string> outputPaths)
    {
        // GLB 材质沿用原材质的对象名，同名材质无法仅凭名称区分。
        var originalMaterials = exports
            .SelectMany<UObject, FPackageIndex?>(asset => asset switch
            {
                USkeletalMesh mesh => mesh.SkeletalMaterials.Select(slot => slot.MaterialInterface),
                UStaticMesh mesh => mesh.StaticMaterials.Select(slot => slot.MaterialInterface),
                _ => []
            })
            .OfType<FPackageIndex>().Where(reference => !reference.IsNull).Distinct()
            .GroupBy(reference => reference.Name, StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() == 1)
            .ToDictionary(group => group.Key, group => group.Single(), StringComparer.OrdinalIgnoreCase);

        foreach (var path in outputPaths.Where(path => Path.GetExtension(path) == ".glb"))
        {
            var model = ModelRoot.Load(path);
            var changed = false;
            foreach (var material in model.LogicalMaterials)
            {
                if (material.FindChannel("Emissive") is not { Texture: null } emissive ||
                    emissive.Color == Vector4.UnitW ||
                    !originalMaterials.TryGetValue(material.Name, out var original) ||
                    !IsFullEmissiveDisabled(original)) continue;

                // 缺少自发光贴图时，glTF 会把非零自发光系数应用到整个材质表面。
                emissive.Color = Vector4.UnitW;
                changed = true;
            }
            if (changed) model.SaveGLB(path);
        }
    }

    private static bool IsFullEmissiveDisabled(FPackageIndex reference)
    {
        if (!reference.TryLoad<UMaterialInterface>(out var material)) return false;
        var parameters = new CMaterialParams2();
        material.GetParams(parameters, EMaterialDepth.AllLayersNoRef);
        return parameters.Scalars.TryGetValue("UseFullEmissive", out var enabled) && enabled == 0;
    }
}
