import json
import base64
import os

def main():
    print("[*] 正在准备手术台...")
    if not os.path.exists('Raw.json'):
        print("[-] 致命错误：找不到 Raw.json！请先用 UAssetGUI 导出。")
        os.system('pause')
        return

    with open('Raw.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    # 寻找 MorphTarget
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
                raw_bytes = bytearray(base64.b64decode(extras_b64))
                raw_bytes.extend(b'\x00' * 7) # 填入 7 字节脂肪
                export['Extras'] = base64.b64encode(raw_bytes).decode('utf-8')
                count += 1

    if count > 0:
        with open('Fixed.json', 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"[+] 史诗级胜利！完美填充了 {count} 个形态键！")
        print(f"[+] 已经生成 Fixed.json，请去 UAssetGUI 导入吧！")
    else:
        print("[-] 没有找到形态键数据。")

    os.system('pause')

if __name__ == '__main__':
    main()