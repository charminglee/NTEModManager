using CUE4Parse.UE4.Objects.Engine.Animation;
using CUE4Parse.UE4.Assets.Exports.GeometryCollection;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.Animation;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.Compression;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.FileProvider.Objects;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Sound;
using CUE4Parse.UE4.Assets.Exports.Sound.Node;
using CUE4Parse.UE4.Assets.Exports.Wwise;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion;
using CUE4Parse_Conversion.Options;
using CUE4Parse_Conversion.Sounds;
using CUE4Parse_Conversion.Writers.UEFormat.Enums;
using Newtonsoft.Json;

try
{
    Console.InputEncoding = System.Text.Encoding.UTF8;
    Console.OutputEncoding = System.Text.Encoding.UTF8;
    var request = JsonConvert.DeserializeObject<Request>(Console.In.ReadToEnd())
        ?? throw new InvalidDataException("资源请求为空。");
    OodleHelper.Initialize(request.Oodle);
    using var provider = new DefaultFileProvider(request.Paks, SearchOption.TopDirectoryOnly,
        new VersionContainer(EGame.GAME_NevernessToEverness), StringComparer.OrdinalIgnoreCase);
    var content = Directory.GetParent(request.Paks)!.FullName;
    var directories = new[] { request.Paks, Path.Combine(content, "PatchPaks"), Path.Combine(content, "TagPatchPaks") }
        .Where(Directory.Exists).ToArray();
    string ArchiveId(string path) => Path.GetRelativePath(content, path).Replace(Path.DirectorySeparatorChar, '/');
    var files = directories.SelectMany(dir => Directory.EnumerateFiles(dir)
        .Where(f => Path.GetExtension(f).ToLowerInvariant() is ".pak" or ".utoc")).ToList();
    var globals = files.Where(f => Path.GetFileName(f).Equals("global.utoc", StringComparison.OrdinalIgnoreCase)).ToList();
    var selected = files.FirstOrDefault(f => ArchiveId(f) == request.Archive);
    var global = globals.LastOrDefault(f => selected != null && Path.GetDirectoryName(f) == Path.GetDirectoryName(selected))
        ?? globals.LastOrDefault();
    if (global == null) throw new FileNotFoundException("未找到游戏全局容器 global.utoc。");
    provider.RegisterVfs(global);
    foreach (var path in files.Except(globals)) provider.RegisterVfs(path);
    if (!string.IsNullOrWhiteSpace(request.Key))
        provider.SubmitKey(new FGuid(), new FAesKey(request.Key));
    provider.Mount();
    var locked = provider.UnloadedVfs.Where(v => !v.Name.Equals("global.utoc", StringComparison.OrdinalIgnoreCase)).ToList();
    if (locked.Count > 0)
        throw new InvalidDataException("容器挂载失败，请核对 AES 密钥：" + string.Join("、", locked.Select(v => v.Name)));
    var archives = provider.MountedVfs.OrderBy(v => v.Name, StringComparer.OrdinalIgnoreCase).ToList();
    var missing = files.Except(globals).Except(archives.Select(v => v.Path), StringComparer.OrdinalIgnoreCase).ToList();
    if (missing.Count > 0) throw new InvalidDataException("未能读取容器：" + string.Join("、", missing.Select(ArchiveId)));
    if (provider.GlobalData == null) throw new InvalidDataException("无法读取游戏全局脚本数据。");
    if (archives.Count == 0) throw new InvalidDataException("未找到可读取的游戏容器。");
    if (request.Action == "index")
    {
        var assetClasses = WorkbenchAssetClasses.Read(provider);
        var rows = archives.SelectMany(v => v.Files.Values.Where(f => !f.IsUePackagePayload)
            .Select(f => new
            {
                path = f.Path, archive = ArchiveId(v.Path), size = f.Size, encrypted = f.IsEncrypted, order = v.ReadOrder,
                assetClass = f.IsUePackage ? assetClasses.GetValueOrDefault(f.Path) : null
            }));
        using var output = File.CreateText(Path.Combine(request.Output, "index.json"));
        JsonSerializer.CreateDefault(new JsonSerializerSettings { NullValueHandling = NullValueHandling.Ignore }).Serialize(output, rows);
        return 0;
    }

    provider.MappingsContainer = new FileUsmapTypeMappingsProvider(request.Mapping);
    provider.ReadScriptData = request.Action == "blueprint" || request.Items?.Any(item => item.Kind is null or "blueprint") == true;

    var archive = string.IsNullOrEmpty(request.Archive)
        ? archives.Where(v => v.Files.ContainsKey(request.Path)).OrderByDescending(v => v.ReadOrder)
            .ThenByDescending(v => ArchiveId(v.Path), StringComparer.OrdinalIgnoreCase).FirstOrDefault()
            ?? throw new FileNotFoundException("游戏中未找到资源：" + request.Path)
        : archives.Single(v => ArchiveId(v.Path) == request.Archive);

    if (request.Action == "export")
    {
        var items = request.Items ?? throw new InvalidDataException("资源导出请求为空。");
        var failures = new List<string>();
        var exported = 0;
        foreach (var item in items)
        {
            var stage = Path.Combine(request.Output, $".ntemm-{Guid.NewGuid():N}");
            Directory.CreateDirectory(stage);
            try
            {
                await ConvertAsset(archive.Files[item.Path], item.Kind ?? "export-auto", stage, false);
                if (!Directory.EnumerateFiles(stage, "*", SearchOption.AllDirectories).Any())
                    throw new InvalidDataException("解析器未生成文件。");
                var destination = SafeOutputPath(request.Output, item.Path.TrimStart('/'));
                Directory.Move(stage, destination);
                exported++;
            }
            catch (Exception error)
            {
                failures.Add($"{item.Path}：{error.GetBaseException().Message}");
            }
            finally
            {
                if (Directory.Exists(stage)) Directory.Delete(stage, true);
            }
        }
        File.WriteAllText(Path.Combine(request.Output, ".ntemm-export.json"), JsonConvert.SerializeObject(new { exported, failures }));
        return 0;
    }

    await ConvertAsset(archive.Files[request.Path], request.Action, request.Output, request.Preview);

    async Task ConvertAsset(GameFile file, string action, string outputDirectory, bool preview)
    {
        string OutputFile(string path) => SafeOutputPath(outputDirectory, path.TrimStart('/'));
        if (!file.IsUePackage)
        {
            if (action is not ("export-auto" or "audio" or "raw") &&
                !(action is "json" or "auto" && file.Extension.Equals("json", StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException("该文件支持原始导出。");
            File.WriteAllBytes(OutputFile(file.Path), file.Read());
            return;
        }

        var exports = provider.LoadPackage(file).GetExports().ToArray();
        if (action is "auto" or "export-auto")
        {
            if (!preview && exports.Any(WorkbenchBlueprint.IsBlueprint)) action = "blueprint";
            else if (exports.Any(obj => obj is USkeletalMesh or UStaticMesh or UGeometryCollection)) action = "model";
            else if (exports.Any(obj => preview ? obj is UTexture2D : obj is UTexture)) action = "texture";
            else if (action == "export-auto" && exports.Any(IsAnimation)) action = "animation";
            else if (action == "export-auto" && exports.Any(IsAudio)) action = "audio";
            else action = preview ? "json" : "raw";
        }
        if (action == "raw")
        {
            foreach (var (path, bytes) in provider.SavePackage(file)) File.WriteAllBytes(OutputFile(path), bytes);
            return;
        }
        if (action == "json")
        {
            using var output = File.CreateText(OutputFile(Path.ChangeExtension(file.Path, ".json")));
            JsonSerializer.CreateDefault(new JsonSerializerSettings { Formatting = Formatting.Indented }).Serialize(output, exports);
            return;
        }
        if (action == "blueprint")
        {
            var code = WorkbenchBlueprint.Decompile(exports);
            File.WriteAllText(OutputFile(Path.ChangeExtension(file.Path, ".blueprint.txt")), code);
            return;
        }
        if (action == "audio")
        {
            foreach (var obj in exports.Where(IsAudio))
            {
                obj.Decode(false, out var format, out var data);
                if (data is not { Length: > 0 }) continue;
                if (!System.Text.RegularExpressions.Regex.IsMatch(format, "^[a-zA-Z0-9]+$")) format = "bin";
                var path = Path.Combine(Path.GetDirectoryName(file.Path)!, Path.ChangeExtension(obj.Name, format.ToLowerInvariant()));
                File.WriteAllBytes(OutputFile(path), data);
            }
            return;
        }
        var session = new ExportSession();
        foreach (var obj in exports)
            if ((action == "texture" && obj is UTexture) ||
                (action == "model" && obj is USkeletalMesh or UStaticMesh or UGeometryCollection) ||
                (action == "animation" && IsAnimation(obj)))
                session.Add(obj);
        if (!session.HasQueuedItems) throw new InvalidDataException("资源中没有所选类型的对象。");
        var modelPreview = preview && action == "model";
        var options = action == "model" && !preview
            ? new ExportOptions(meshFormat: EMeshFormat.UEFormat, naniteMeshFormat: ENaniteMeshFormat.NaniteOnly,
                meshQuality: EMeshQuality.Highest, compressionFormat: EFileCompressionFormat.None,
                exportMaterials: true, exportMorphTargets: true, materialDepth: EMaterialDepth.TopLayerOnly,
                textureFormat: ETextureFormat.Png, exportHdrTexturesAsHdr: true)
            : new ExportOptions(meshFormat: action == "animation" ? EMeshFormat.UEFormat : EMeshFormat.Gltf2,
                exportMorphTargets: !preview, exportMaterials: modelPreview, exportHdrTexturesAsHdr: false);
        var results = await session.RunAsync(outputDirectory, options);
        foreach (var result in results)
            if (!result.Success) throw new InvalidDataException(result.ObjectPath, result.Error);
        if (modelPreview)
            WorkbenchModelPreview.CorrectEmissive(exports, results.SelectMany(result => result.DiskFilePaths!));
    }
    return 0;
}
catch (Exception error)
{
    Console.Error.WriteLine(error.GetBaseException().Message);
    return 1;
}

static bool IsAnimation(UObject obj) => obj is UAnimationAsset or UPoseAsset;
static bool IsAudio(UObject obj) => obj is USoundWave or USoundNodeWave or UAkMediaAssetData;

static string SafeOutputPath(string directory, string relative)
{
    var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(directory)) + Path.DirectorySeparatorChar;
    var path = Path.GetFullPath(Path.Combine(root, relative));
    if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase))
        throw new InvalidDataException("资源路径超出导出目录。");
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    return path;
}

record ExportItem(string Path, string? Kind);
record Request(string Action, string Paks, string Key, string Oodle, string Mapping, string Output, string Archive, string Path, bool Preview, ExportItem[]? Items);
