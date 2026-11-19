import sys
import json
import base64
import os

def main():
    if len(sys.argv) < 3:
        print("[-] 缺少参数！用法: python AutoFixMorph.py <输入.json> <输出.json>")
        sys.exit(1)
        
    in_file = sys.argv[1]
    out_file = sys.argv[2]
    
    print(f"     -> 正在读取: {os.path.basename(in_file)}")
    
    try:
        with open(in_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"     [-] JSON 读取失败: {e}")
        sys.exit(1)

    # 自动侦测 MorphTarget 类索引
    morph_class_indices = []
    for i, imp in enumerate(data.get('Imports', [])):
        if imp.get('ObjectName') == 'MorphTarget':
            morph_class_indices.append(-(i + 1))
    
    if not morph_class_indices:
        morph_class_indices = [-3]

    count = 0
    for export in data.get('Exports', []):
        if export.get('ClassIndex') in morph_class_indices:
            extras_b64 = export.get('Extras')
            if extras_b64:
                # Base64 解码 -> 塞入 7 个空字节 -> 重新编码
                raw_bytes = bytearray(base64.b64decode(extras_b64))
                raw_bytes.extend(b'\x00' * 7)
                export['Extras'] = base64.b64encode(raw_bytes).decode('utf-8')
                count += 1

    if count > 0:
        with open(out_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"     -> [成功] 完美填充 {count} 个形态键，写入 {os.path.basename(out_file)}")
    else:
        print("     [-] 未找到需要修复的形态键数据。")

if __name__ == '__main__':
    main()