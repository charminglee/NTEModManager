using System.Text;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Kismet;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse.UE4.Objects.UObject.BlueprintDecompiler;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

static class WorkbenchBlueprint
{
    public static bool IsBlueprint(UObject obj) => obj is UClass && obj.ExportType.EndsWith("BlueprintGeneratedClass", StringComparison.Ordinal);

    public static string Decompile(UObject[] exports)
    {
        var classes = exports.Where(IsBlueprint).Cast<UClass>().ToArray();
        if (classes.Length == 0) throw new InvalidDataException("资源中没有已编译的蓝图类。");

        var code = new StringBuilder();
        var serializer = JsonSerializer.CreateDefault();
        foreach (var type in classes)
        {
            BlueprintDecompilerUtils.Mappings = type.Owner?.Mappings;
            code.Append("class ").Append(BlueprintDecompilerUtils.GetClassWithPrefix(type));
            if (type.SuperStruct.ResolvedObject is { } parent)
            {
                var access = type.Flags.HasFlag(EObjectFlags.RF_Public) ? "public" : "private";
                var parentName = type.SuperStruct.Load<UStruct>() is { } parentType
                    ? BlueprintDecompilerUtils.GetClassWithPrefix(parentType) : parent.Name.Text;
                code.Append(" : ").Append(access).Append(' ').Append(parentName);
            }
            code.AppendLine().AppendLine("{");
            var defaults = type.ClassDefaultObject.Load();
            var renderedFields = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in type.Properties.Concat(defaults?.Properties ?? [])
                         .Concat(defaults?.SerializedSparseClassData?.Properties ?? []))
            {
                if (!renderedFields.Add(property.Name.Text)) continue;
                if (property.Tag is not null && BlueprintDecompilerUtils.GetPropertyTagVariable(property, out var fieldType, out var value))
                    code.Append("    ").Append(fieldType).Append(' ').Append(property.Name.Text).Append(" = ").Append(value).AppendLine(";");
                else
                    code.Append("    ").Append(property.PropertyType).Append(' ').Append(property.Name.Text).AppendLine(";");
            }
            foreach (var property in (type.ChildProperties ?? []).OfType<FProperty>())
            {
                if (!renderedFields.Add(property.Name.Text)) continue;
                var (_, fieldType) = BlueprintDecompilerUtils.GetPropertyType(property);
                code.Append("    ").Append(string.IsNullOrWhiteSpace(fieldType) ? property.GetType().Name : fieldType)
                    .Append(' ').Append(property.Name.Text).AppendLine(";");
            }

            foreach (var function in exports.OfType<UFunction>().Where(function => function.Outer?.Name.Text == type.Name))
            {
                code.Append("    function ").Append(function.Name).AppendLine("()");
                if (function.ScriptBytecode is null)
                {
                    code.AppendLine("    ;");
                    continue;
                }
                if (function.ScriptBytecode.LastOrDefault()?.Token != EExprToken.EX_EndOfScript)
                    throw new InvalidDataException($"蓝图函数 {function.Name} 的字节码未完整解析。");
                code.AppendLine("    {");
                foreach (var expression in function.ScriptBytecode)
                {
                    if (expression.Token == EExprToken.EX_EndOfScript) break;
                    code.Append($"      L_{expression.StatementIndex:X4}: ")
                        .Append(Format(JObject.FromObject(expression, serializer))).AppendLine(";");
                }
                code.AppendLine("    }");
            }
            code.AppendLine("}");
        }
        return code.ToString();
    }

    private static string Format(JToken? operand)
    {
        if (operand is JArray array) return string.Join(", ", array.Select(Format));
        if (operand is not JObject node || node.Value<string>("Token") is not { } token)
            return operand is JObject reference && reference.Value<string>("ObjectName") is { } name
                ? name : operand?.ToString(Formatting.None) ?? "null";

        string Get(string property) => Format(node[property]);
        return token switch
        {
            "EX_Return" => node["Expression"]?.Value<string>("Token") == "EX_Nothing" ? "return" : $"return {Get("Expression")}",
            "EX_Jump" => $"goto L_{node.Value<uint>("CodeOffset"):X4}",
            "EX_JumpIfNot" => $"if (!{Get("BooleanExpression")}) goto L_{node.Value<uint>("CodeOffset"):X4}",
            "EX_FinalFunction" or "EX_LocalFinalFunction" or "EX_CallMath" => $"{Get("Function")}({Get("Parameters")})",
            "EX_VirtualFunction" or "EX_LocalVirtualFunction" => $"{Get("VirtualFunctionName")}({Get("Parameters")})",
            "EX_Let" or "EX_LetBool" or "EX_LetObj" or "EX_LetWeakObjPtr" or "EX_LetDelegate" or "EX_LetMulticastDelegate"
                => $"{Get("Variable")} = {Get("Expression")}",
            "EX_True" => "true",
            "EX_False" => "false",
            "EX_Self" => "self",
            "EX_NoObject" => "null",
            "EX_IntZero" => "0",
            "EX_IntOne" => "1",
            _ when token.EndsWith("Const", StringComparison.Ordinal) && node["Value"] is not null => Get("Value"),
            _ => $"{token}({string.Join(", ", node.Properties().Where(field => field.Name is not ("Token" or "StatementIndex"))
                .Select(field => $"{field.Name}: {Format(field.Value)}"))})"
        };
    }
}
