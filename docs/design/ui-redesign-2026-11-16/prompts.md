# 布局图生成提示词

生成方式：内置图像生成工具。

输入参考：项目现有角色头像 `img/bg/娜娜莉.png`。

## 主界面

以下代码块为发送给图像生成工具的完整提示词。

```text
Use case: ui-mockup
Asset type: High-fidelity desktop application layout concept, flat front-on UI screenshot, not a photo or device mockup.
Primary request: Design the new NTEMM / NTE 模组管理器 interface for a Windows desktop mod manager for Neverness to Everness (异环). The user has chosen a strong NTE game-menu visual direction: black and white hard-edged opaque panels, vivid small acid-yellow accents, urban signage, ticket stubs, slightly clipped corners, bold typography. Deliver a professional complete usable layout at approximately 1600 by 1000 landscape, with very crisp well-rendered Simplified Chinese text.
Input image: The provided local PNG is the existing app's clothed Nana character avatar. Use ONLY this clothed head/shoulders artwork as small avatar art in category navigation and selected mod detail thumbnail. Preserve the black outfit, glasses, red hair and black cat hat. No other reference image. This is NOT a request to draw nude figures.
Composition: One large full application window filling the entire canvas, zero surrounding device or environment. Top title bar height 48 px; global header height 64 px; left character navigation 210 px wide; central dense mod library about 900 px; right selected-mod inspector 360 px; bottom activity/status strip 38 px. Content split is clear and structurally useful, using thin opaque dividing rules. No hero banner, no metrics dashboard.
Overall palette: matte near-black #141516, warm paper-white #f0f0e9, charcoal #222426, very small acid yellow #e5ff47 accents. Saturation kept almost entirely in the supplied avatar and yellow active controls. Opaque surfaces; NO transparency, NO glass, NO blur, NO reflections, NO glossy gradients. Mostly rectangular controls, only very small corners. Tiny stencil marks, index numbers, restrained diagonal hatch and bar-code motifs in empty edges. The graphic personality comes from typography, contrast, cropped rings/ticket geometry, not noise.
Top: NTEMM logo wordmark left, small subtitle “异环模组管理器”. Navigation “模组库” active, “运行日志”, “设置”. Far right a compact white “启动游戏 ↗” button, then standard minimize/maximize/close controls in actual titlebar above. A small text state “游戏路径已连接” in muted gray near launch button.
Left sidebar: black opaque surface. Heading “角色分类”, subtle category search field “查找角色”. Row “全部模组” with count 128. Small section label “角色”. Vertical rows with simple square avatars: “娜娜莉 12” active acid-yellow rectangular ticket strip with dark text and a clipped right corner; “九原 9”, “真红 8”, “安魂曲 11”, “薄荷 6”, “法帝娅 7”, “伊洛伊 8”, “早雾 5”, “曳尔沐 10”, “黑羽 9”, plus bottom “其他 14”. Count numbers align flush right. Bottom small utility “背景展示  F9”.
Central: warm off-white page title area, giant confident “娜娜莉” with small N A N A L L Y English secondary type and small 12 个模组 · 4 个已安装 underneath. On right of title aligned toolbar buttons “＋ 导入模组” acid yellow with black type, “打包模组” outlined. Underneath an efficient single row search “搜索当前角色的模组” wide, sort “已安装优先⌄”, rescan icon. Then restrained text filter tabs “全部 12” active, “已安装 4”, “未安装 7”, “失效 1”, with right small “批量选择”. This is a list interface, not a uniform grid of giant cards.
Dense library list below on opaque paper white. Group heading “原皮” with tiny “同组互斥”. Four clean compact mod rows about 70 px high, each with checkbox, small technical package icon, bold name, smaller size/import date, explicit status text and right action buttons. Row 1 “原皮－配色 A” selected, black edge rule and pale yellow selected fill, secondary “32.4 MB · 2026/11/15”, state “✓ 已安装”, button “卸载”, overflow ⋯. Row 2 “原皮－配色 B”, “28.1 MB · 2026/11/14”, state “未安装”, button “安装”. Row 3 “原皮－纹理优化”, “46.8 MB · 2026/11/12”, state “未安装”, button “安装”. Group heading “UI”. Rows “UI－动态觉醒立绘” with “✓ 已安装” and “卸载”; “UI－主题图标” “未安装” “安装”; “UI－旧版立绘” state “⚠ 已失效” in dark amber with outlined “查看”. Use group headings and fine table dividers. A seventh row partly lower permissible but no bottom clipping. Plenty of useful density, well-readable 14–16px equivalent text. Bottom center small outlined dropzone “拖入 ZIP、RAR、7Z 压缩包以导入” with simple package pictogram. Secondary small “布局示意 · 示例数据”.
Right inspector: charcoal near-black opaque panel. At top heading “模组详情” with close/collapse icon. The provided clothed avatar is cropped neatly as a horizontal 2:1 preview with pale yellow background and a small “NANALLY / 01” label. Below bold white “原皮－配色 A”, compact “已安装” status. Subnav “文件” active and “信息”. Text note in a small outlined ticket: “同组互斥” and “安装其他「原皮」模组时，将自动卸载本项。” Wrap neatly. File tree “原皮配色A” expanded and three filenames “Nanally_Color_P.pak”, “Nanally_Color_P.utoc”, “Nanally_Color_P.ucas” with subdued file sizes aligned right. Below a quiet hint “双击文件名可重命名”. Bottom right actions 2x2 compact buttons “重新打包”, “更新／替换”, “打开源目录”, “更多操作”. Primary clear “卸载此模组” across the bottom in opaque off-white with black text. No fake 3D model preview.
Global bottom status bar: dark with tiny green square and text “就绪”, activity “上次操作：模组安装完成”, right shortcut “↓ 切换背景    F9 背景展示    查看日志 ↗”.
Finish: impeccable alignment, a game art director's visual polish combined with a daily-use desktop utility's information density. Strong intentional black-white block composition, acid-yellow not taking over. All text crisp, real useful controls, no placeholder gibberish, no glass, no generic SaaS purple, no giant chart tiles, no unrelated website navigation. This is only a design concept, not a screenshot of functioning code.
```

## 配套页面与操作状态

参考图为本轮生成的主界面布局图 `01-main.png`。

```text
用途：ui-mockup。
交付物：NTEMM 异环模组管理器的配套页面与操作状态布局设计板。横向高分辨率，建议 2400 × 1800，完整清晰，不要设备外框，不要现实环境。
参考图：提供的第一张图为本轮已设计的主界面，严格延续它的黑白硬边、荧光黄少量强调、炭黑与纸白不透明实底、都市票据切角、编号、细线框以及粗黑中文字体。角色插画只作参考，不增加新角色。
设计板顶部标题「NTEMM／配套页面与操作状态」，右侧小字「布局评审稿 · 示例数据」。整张板为纸白底，四个清晰对齐的独立区块，两行两列，细边框与舒适间隔。每个区块都应有足够阅读空间，中文准确。不要出现液态玻璃、毛玻璃、透明面板、模糊或折射。
左上区块「01／设置页」：展示一张完整设置工作区，而非弹窗。黑色顶栏包含 NTEMM、模组库、运行日志、设置，设置用荧光黄标记，右侧启动游戏。左侧窄黑栏为设置分组「路径」「操作偏好」「背景展示」「高级」，「路径」选中。主工作区纸白，标题「路径设置」，说明「配置游戏与模组的存放位置」。四行可读表单「游戏安装目录」「模组备份目录」「背景图片目录」「打包器目录」，每行一个路径输入框与「浏览」按钮，示例路径 E:/Neverness To Everness、E:/NteMod/Backups、F:/Pictures、E:/Tools/Packager。下方一条小提示「保存后生效」。底部固定操作栏，右侧灰白「取消」与荧光黄「保存设置」。保留合理留白，不塞玻璃开关，不新增无关功能。
右上区块「02／运行日志」：完整日志工作区，延续相同黑色全局顶栏，运行日志选中。纸白标题区域「运行日志」，副标题「查看导入、安装与打包结果」。工具栏搜索框「查找日志」，级别选择「全部级别」，开关「跟随滚动」已开启。主体黑色日志表格，表头「时间」「级别」「来源」「内容」，每列严格对齐，时间与日志用清晰等宽字体。示例行「15:32:08」「信息」「模组」「开始安装：娜娜莉－原皮－配色 A」；「15:32:09」「信息」「文件」「复制完成，3 个文件」；「15:32:09」「成功」「模组」「安装完成」；「15:35:20」「警告」「导入」「1 个压缩包无法读取」；「15:35:20」「错误」「导入」「文件已损坏，请重新选择压缩包」。级别同时有文字和小图标。底部状态条「共 286 条」与「已跟随最新日志」。长内容可以换行，正文高对比，彩色只用在级别。
左下区块「03／导入与失败反馈」：用票据式大型导入对话框展示导入中的布局，占大部分区块面积；背景为安静的实底黑色，避免模糊。对话框不透明纸白，顶栏黑色标题「导入模组」，右上关闭按钮。说明「正在导入 3 个压缩包」。三个逐行任务「娜娜莉－原皮－配色 A.zip」「九原－UI－图标.7z」「真红－原皮－配色 B.rar」，第一行状态「✓ 已完成」，第二行「导入中」带荧光黄平直进度条约 65％，第三行「⚠ 读取失败」带明确原因「压缩包损坏」及边框小按钮「重试」。底部小文本「完成后可逐个重命名」，右下「取消剩余任务」描边按钮与「完成」暂不可用的灰色按钮。下侧窄注释条「逐项展示结果，失败原因与重试入口留在原处」。不要将示例进度画成真实监测仪表盘。
右下区块「04／批量操作与互斥确认」：展示中央列表的局部布局与下方固定操作栏，标题「娜娜莉」，三行模组及复选框，其中两行荧光黄选中「原皮－配色 A」「UI－动态觉醒立绘」，一行未选中「原皮－配色 B」。底部操作栏黑底白字，左「已选 2 项」「取消选择」，右侧清晰按钮「安装」「卸载」「标记失效」「删除」，删除仅用小红色文字提示，安装荧光黄。下半区再用一个精炼确认对话框表示互斥反馈，标题「将替换同组模组」，正文「安装「原皮－配色 B」前，将卸载同组的「原皮－配色 A」。」双列列表「将安装／原皮－配色 B」「将卸载／原皮－配色 A」，底部「取消」和荧光黄「确认安装」。两个状态是分开的示意组件，不能让用户误以为同时弹出。每个局部有小标题「多选状态」和「安装确认」。
整体要求：专业游戏 UI 设计交付板，功能导向，整齐严谨，有与参考一致的黑白都市图形个性。字必须清晰，主要字号足够大，所有控件易于识别。不要装饰性大角色海报，不要巨大的数据统计卡，不要彩色渐变。无官网水印，无网址，无额外英文标语。
```
