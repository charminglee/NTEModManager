using CUE4Parse.Compression;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion;
using CUE4Parse_Conversion.Options;
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

    var archive = string.IsNullOrEmpty(request.Archive)
        ? archives.Where(v => v.Files.ContainsKey(request.Path)).OrderByDescending(v => v.ReadOrder)
            .ThenByDescending(v => ArchiveId(v.Path), StringComparer.OrdinalIgnoreCase).FirstOrDefault()
            ?? throw new FileNotFoundException("游戏中未找到资源：" + request.Path)
        : archives.Single(v => ArchiveId(v.Path) == request.Archive);
    var file = archive.Files[request.Path];
    string OutputFile(string relative)
    {
        var root = Path.GetFullPath(request.Output) + Path.DirectorySeparatorChar;
        var path = Path.GetFullPath(Path.Combine(root, relative));
        if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("资源路径超出导出目录。");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        return path;
    }
    // 容器内原始数据连同附属数据一并导出。
    if (request.Action == "raw")
    {
        if (file.IsUePackage)
            foreach (var (path, bytes) in provider.SavePackage(file))
                File.WriteAllBytes(OutputFile(path), bytes);
        else File.WriteAllBytes(OutputFile(file.Path), file.Read());
        return 0;
    }
    if (!file.IsUePackage)
    {
        if (request.Action is not ("json" or "auto") || !file.Extension.Equals("json", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("该文件支持原始导出。");
        File.WriteAllBytes(OutputFile(file.Path), file.Read());
        return 0;
    }
    provider.MappingsContainer = new FileUsmapTypeMappingsProvider(request.Mapping);
    var exports = provider.LoadPackage(file).GetExports().ToArray();
    var action = request.Action;
    if (action == "auto")
    {
        action = "json";
        if (exports.Any(obj => obj is USkeletalMesh or UStaticMesh)) action = "model";
        else if (exports.Any(obj => obj is UTexture2D)) action = "texture";
    }
    if (action == "json")
    {
        using var output = File.CreateText(OutputFile(Path.ChangeExtension(file.Path, ".json")));
        JsonSerializer.CreateDefault(new JsonSerializerSettings { Formatting = Formatting.Indented }).Serialize(output, exports);
        return 0;
    }
    var session = new ExportSession();
    foreach (var obj in exports)
        if ((action == "texture" && obj is UTexture2D) ||
            (action == "model" && obj is USkeletalMesh or UStaticMesh))
            session.Add(obj);
    if (!session.HasQueuedItems) throw new InvalidDataException("资源中没有所选类型的对象。");
    var options = new ExportOptions(meshFormat: EMeshFormat.Gltf2, exportMorphTargets: !request.Preview,
        exportMaterials: request.Preview && action == "model", exportHdrTexturesAsHdr: false);
    foreach (var result in await session.RunAsync(request.Output, options))
        if (!result.Success) throw new InvalidDataException(result.ObjectPath, result.Error);
    return 0;
}
catch (Exception error)
{
    Console.Error.WriteLine(error.GetBaseException().Message);
    return 1;
}

record Request(string Action, string Paks, string Key, string Oodle, string Mapping, string Output, string Archive, string Path, bool Preview);
