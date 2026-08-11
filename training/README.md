# 人体朝向分类训练

本目录存放人体朝向分类器的训练代码、数据目录约定和训练产物位置。它与 `src/python` 中的生产视觉识别服务分开维护，训练完成并经过人工检查后，才考虑把模型接入正式推理流程。

## 目标

训练一个基于 ConvNeXt-Tiny 的三分类模型，判断人体裁剪图中的主要朝向：

| 类别 | 标注含义 |
| --- | --- |
| `front` | 人体正面，胸口或面部朝向镜头 |
| `back` | 人体背面，背部朝向镜头 |
| `uncertain` | 不是明确正面或背面，例如侧身、遮挡、分辨率过低、姿态异常，或无法可靠判断 |

`uncertain` 不是“随便放”的类别。只有无法明确判断为正面或背面时才使用它；所有侧身和正面/背面证据不足的图片都归入此类。

## 目录结构

```text
training/
|-- README.md
|-- requirements.txt
`-- orientation/
|-- train_orientation.py
|-- dataset/
|-- train/
|-- back/
|-- front/
|-- uncertain/
`-- val/
|-- back/
|-- front/
`-- uncertain/
`-- checkpoints/
```

实际图片应放入对应类别目录，例如：

```text
training/orientation/dataset/train/front/person_0001.jpg
training/orientation/dataset/train/back/person_0002.jpg
training/orientation/dataset/val/uncertain/person_0101.png
```

目录中的 `.gitkeep` 只是为了让空目录保持在版本库中，不是训练图片。训练产生的 `.pt` 和 `history.json` 默认写入 `training/orientation/checkpoints/`，这些文件通常不应提交到 Git。

## 环境准备

项目已有的 `src/python/.venv` 可以直接运行训练脚本。

安装依赖：

```powershell
& .\src\python\.venv\Scripts\python.exe -m pip install -r .\training\requirements.txt
```

验证 PyTorch、TorchVision 和 CUDA 状态：

```powershell
& .\src\python\.venv\Scripts\python.exe -c "import torch, torchvision; print(torch.__version__); print(torchvision.__version__); print(torch.cuda.is_available())"
```

上面的解释器路径按实际环境替换为 `src/python/.venv` 即可。`training/requirements.txt` 当前使用项目已有的 CUDA 版本约束；如果机器只使用 CPU，应按照 PyTorch 官方对应版本调整安装源和版本组合。

## 数据准备

### 图片内容

每张图片应尽量是单个人体的裁剪图，人体在画面中占主要区域。推荐保留少量上下文，但不要把整张大场景作为训练图片。训练数据可以来自 YOLO pose 的人体框裁剪，也可以来自人工整理的截图。

图片应满足：

- 同一个人只保留一个主要人体目标。
- 正面和背面的判定依据保持一致，不要按服装颜色或背景分类。
- 侧身、遮挡、截断、极小目标和严重运动模糊应标为 `uncertain`。
- 可以包含不同分辨率、光照、服装、肤色、背景和姿态。
- 不要把同一张图的轻微裁剪、连续视频帧或同一角色的近重复图片同时放入 train 和 val。

每个 `train/<class>` 和 `val/<class>` 目录都至少需要一张有效图片。`.gitkeep` 只用于保留空目录，不能作为训练样本。脚本支持 `.jpg`、`.jpeg` 和 `.png`；其他扩展名需要先转换。

### 标注规则

`front`：能看到人体正面结构，例如胸口正对镜头，或面部和双肩关系明确地指向镜头。

`back`：背部朝向镜头，头部可能回头，但身体主体仍然是背面。不要仅凭“看不到脸”就标为背面。

`uncertain`：所有不能明确归为正面或背面的图片，包括侧身、只看到局部、被其他物体遮挡、图像过小、姿态异常，或多名标注者无法达成一致的图片。这个类别用于降低生产误判风险。

### 划分建议

建议先按人物、视频片段或场景分组，再划分 train 和 val，而不是逐张随机切分。这样可以避免验证集只是在记忆训练集中的同一人物或同一连续帧。

初始阶段可以使用约 80% train、20% val。三个类别在两个 split 中都必须存在，并且每类尽量保持数量接近。若真实业务中某一类明显更常见，应在验证集保留接近真实分布的副本，同时额外关注少数类的召回率。

## 开始训练

从仓库根目录执行，进行两轮训练。脚本默认读取 `training/orientation/dataset`，默认把结果写到 `training/orientation/checkpoints`：

第一轮：

```powershell
$python = '.\src\python\.venv\Scripts\python.exe'

& $python .\training\orientation\train_orientation.py `
--output .\training\orientation\checkpoints\weighted_head `
--epochs 20 `
--batch-size 128 `
--learning-rate 1e-4 `
--class-weighting `
--device cuda
```

第二轮：

```powershell
& $python .\training\orientation\train_orientation.py `
--output .\training\orientation\checkpoints\weighted_unfrozen `
--epochs 20 `
--batch-size 128 `
--learning-rate 1e-5 `
--class-weighting `
--no-freeze-backbone `
--device cuda
```

常用参数：

| 参数 | 默认值 | 作用 |
| --- | --- | --- |
| `--dataset` | `training/orientation/dataset` | ImageFolder 数据集根目录 |
| `--output` | `training/orientation/checkpoints` | checkpoint 和训练历史输出目录 |
| `--epochs` | `15` | 训练轮数 |
| `--batch-size` | `16` | 每批图片数，显存不足时调小 |
| `--image-size` | `224` | ConvNeXt 输入边长 |
| `--learning-rate` | `0.0001` | AdamW 学习率 |
| `--weight-decay` | `0.0001` | AdamW 权重衰减 |
| `--workers` | `0` | DataLoader 子进程数，Windows 初期建议保持 0 |
| `--device` | `auto` | `auto`、`cuda` 或 `cpu` |
| `--freeze-backbone` | 开启 | 先冻结 ConvNeXt 特征层，只训练分类头 |
| `--no-freeze-backbone` | 关闭 | 解冻整个模型进行微调 |
| `--class-weighting` | 开启 | 按训练集类别数量自动提高少数类损失权重 |
| `--no-class-weighting` | 关闭 | 关闭类别加权，用于对照实验 |
| `--from-scratch` | 关闭 | 不下载或使用 ImageNet 预训练权重 |
| `--classes` | 三个默认类别 | 逗号分隔的类别目录名 |

默认流程使用 ImageNet 预训练的 ConvNeXt-Tiny，第一阶段冻结特征层，并根据训练集各类别数量自动加权交叉熵。数据量足够并且分类头已经稳定后，再使用 `--no-freeze-backbone` 配合较低学习率做微调。第一次没有网络或不希望下载预训练权重时，可以使用 `--from-scratch`，但通常需要更多标注数据和训练轮数。

指定自定义数据和输出路径的例子：

```powershell
& .\src\python\.venv\Scripts\python.exe .\training\orientation\train_orientation.py --dataset D:\datasets\orientation --output D:\models\orientation --epochs 30 --batch-size 32 --image-size 224 --device cuda
```

## 输出文件

每次训练会生成：

- `best.pt`：验证集准确率最高的模型。
- `last.pt`：最后一轮模型。
- `history.json`：每一轮的 train loss、train accuracy、val loss 和 val accuracy。

checkpoint 同时保存类别顺序、输入尺寸、归一化均值/标准差、保存时的 epoch 和验证指标。预测程序从 checkpoint 读取这些信息，因此不要手动修改类别目录名或 checkpoint 内的类别列表。

## 单图预测

使用训练好的 `best.pt` 对一张人体裁剪图进行预测：

```powershell
& .\src\python\.venv\Scripts\python.exe .\training\orientation\train_orientation.py --mode predict --checkpoint .\training\orientation\checkpoints\best.pt --image .\training\orientation\dataset\val\front\example.jpg --device cuda
```

输出为一行 JSON：

```json
{"orientation": "front", "confidence": 0.91}
```

这里的 confidence 是模型在三个类别上的 softmax 最大值，不等于经过校准的真实概率。生产接入前应在独立测试集上检查混淆矩阵、每类 precision/recall、低置信度样本和 `uncertain` 的覆盖情况。

## 评估与迭代建议

当前脚本提供训练/验证 loss 和 accuracy，适合搭建第一版训练流程，但还不是完整评估工具。正式使用前建议补充：

1. 独立测试集，避免只根据 val 结果反复调参。
2. 三分类混淆矩阵，重点检查 `front` 与 `back` 的混淆，以及其他类别是否正确归入 `uncertain`。
3. 每类 precision、recall、F1 和样本数量。
4. 不同置信度阈值下的误判率，必要时把低置信度结果统一降为 `uncertain`。
5. 按人物、场景、服装和画面来源分组的误差统计。

训练前后都应抽查图片和预测结果。若模型只依赖背景、颜色、特定角色或水印，应该增加跨场景数据，而不是单纯增加训练轮数。

## 从当前结果继续

之前四分类训练的最好结果是验证准确率 `54.4%`、验证 loss `0.9816`。这个 checkpoint 包含旧的四分类输出层，不能用于现在的三分类模型；训练必须使用新的输出目录。原来单独归类的侧身图片已经移动到 `uncertain`，表示所有不能明确判断为正面或背面的情况。

之前训练的准确率是 `67.1%`，验证准确率是 `54.4%`，两者相差约 12.7 个百分点。这个结果只能作为旧四分类流程的历史基线，不能直接与新的三分类结果比较。

按下面顺序推进，不要先反复增加 epoch：

### 第一步：保存当前基线

先保留当前 checkpoint 和训练历史，避免后续实验覆盖它：

```powershell
Copy-Item .\training\orientation\checkpoints\best.pt .\training\orientation\checkpoints\baseline_best.pt
Copy-Item .\training\orientation\checkpoints\history.json .\training\orientation\checkpoints\baseline_history.json
```

查看哪一轮验证准确率最高：

```powershell
$history = Get-Content .\training\orientation\checkpoints\history.json -Raw | ConvertFrom-Json
$history | Format-Table epoch, train_accuracy, val_accuracy, train_loss, val_loss
$history | Sort-Object val_accuracy -Descending | Select-Object -First 1
```

当前脚本会在每轮验证准确率提高时覆盖 `best.pt`，因此 `best.pt` 通常比 `last.pt` 更适合后续测试。

### 第二步：检查并重新平衡数据

统计每个目录的有效图片数：

```powershell
$extensions = '.jpg','.jpeg','.png'
Get-ChildItem .\training\orientation\dataset -Directory | ForEach-Object {
$split = $_.Name
Get-ChildItem $_.FullName -Directory | ForEach-Object {
$count = @(Get-ChildItem $_.FullName -File -Recurse |
Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() }).Count
[pscustomobject]@{ Split = $split; Class = $_.Name; Images = $count }
}
} | Sort-Object Split, Class | Format-Table -AutoSize
```

原来的侧身图片现在已经并入 `uncertain`。接下来应优先补充明确的 `front` 和 `back` 图片，并保证 `uncertain` 中确实包含各种非明确正面/背面的情况。建议目标如下：

- 第一阶段：每个类别至少 100 张训练图片、30 张验证图片。
- 较稳定的版本：每个类别至少 300 张训练图片、60 张验证图片。
- `uncertain` 应覆盖侧身、轻微转身、严重遮挡和无法确认的姿态，但不要把明确的正面或背面错误放入其中。
- 不要用同一张图片的复制品填充数量；可以使用不同人物、场景、服装、距离、光照和姿态。
- 同一人物、同一视频连续帧或同一场景的近似图片必须放在同一个 split，不能一部分放 train、一部分放 val。

如果 `uncertain` 在真实使用中确实很常见，可以保留较多样本；但不能让它成为所有难例的混合垃圾桶。每一张 `uncertain` 图片都应有明确原因，例如遮挡、分辨率不足或朝向无法判断。

### 第三步：建立独立测试集

不要把所有图片只分成 train 和 val。数据补充完成后，建议增加独立的 `test` 目录：

```text
training/orientation/dataset/test/back/
training/orientation/dataset/test/front/
training/orientation/dataset/test/uncertain/
```

推荐按人物或场景分组后采用约 `70% train / 15% val / 15% test`。`test` 在训练和调参期间不要查看结果，只在准备比较最终模型时使用。这样才能判断模型面对新人物、新背景和新服装时是否仍然有效。

### 第四步：重新训练分类头

补充并重新划分数据后，先使用冻结骨干的配置建立新的基线。输出到新目录，避免覆盖旧结果：

```powershell
$python = '.\src\python\.venv\Scripts\python.exe'
& $python .\training\orientation\train_orientation.py `
--dataset .\training\orientation\dataset `
--output .\training\orientation\checkpoints\weighted_head `
--epochs 20 `
--batch-size 128 `
--workers 0 `
--device cuda
```

Windows 下数据集较小时 `workers 0` 往往更快；图片数量明显增加后再尝试 `--workers 2`。

这一阶段的判断顺序是：先看验证 loss 是否持续下降，再看验证准确率是否超过多数类基线，最后再看每个类别的指标。类别加权只应用于训练损失，验证 loss 仍使用未加权的交叉熵，便于比较实验。不要只因为训练准确率继续上升就继续增加 epoch。

训练开始时应看到 `Class weighting: True` 和各类别权重。当前数据集数量对应的权重大约是 `back=2.000`、`front=0.587`、`uncertain=1.256`。如果要做不加权的对照实验，显式添加 `--no-class-weighting`。

### 第五步：检查类别级效果

当前 `train_orientation.py` 只输出整体 loss 和 accuracy，还没有自动输出混淆矩阵、precision、recall 和 F1。整体准确率超过基线后，仍需逐类检查：

- `front` 是否被大量误判为 `back` 或 `uncertain`。
- `back` 是否因为看不到脸而被错误归入 `uncertain`。
- `uncertain` 是否覆盖了真正的难例，还是变成了默认类别。
- 低置信度预测是否应该统一转为 `uncertain`。

在类别级评估工具加入前，可以先用单图预测检查每类样本：

```powershell
$python = '.\src\python\.venv\Scripts\python.exe'
& $python .\training\orientation\train_orientation.py `
--mode predict `
--checkpoint .\training\orientation\checkpoints\balanced_head\best.pt `
--image .\training\orientation\dataset\val\front\example.jpg `
--device cuda
```

至少为每个类别抽查 20 张图片，并记录真实标签、预测标签和 confidence。单图预测适合发现明显错误，不足以替代完整的类别级统计。

### 第六步：进行全模型微调

当数据量增加、分类头基线稳定后，再尝试解冻 ConvNeXt 特征层：

```powershell
$python = '.\src\python\.venv\Scripts\python.exe'
& $python .\training\orientation\train_orientation.py `
--dataset .\training\orientation\dataset `
--output .\training\orientation\checkpoints\finetune `
--epochs 10 `
--batch-size 128 `
--learning-rate 0.00001 `
--class-weighting `
--no-freeze-backbone `
--workers 0 `
--device cuda
```

注意：当前脚本的 `--no-freeze-backbone` 会从 ImageNet 预训练 ConvNeXt-Tiny 开始新的训练，并不会从已有的 `best.pt` 恢复。当前脚本也没有 `--resume` 参数，因此不要把 `--checkpoint` 误认为训练恢复参数；它只在 `--mode predict` 下使用。后续如需从分类头最优结果继续微调，应先实现显式的 `--resume` 功能，并同时恢复模型、optimizer、epoch 和类别配置。

### 第七步：确定是否可以接入生产

模型至少应满足以下检查后，才考虑接入 C++ 背景流程：

1. 独立 test 集的整体结果明显高于多数类基线。
2. `front`、`back`、`uncertain` 都有足够的样本和可接受的 recall，不能用整体 accuracy 掩盖某一个类别完全失效。
3. `front` 与 `back` 的混淆已经人工检查，确认不是因为背景、发色、服装或水印产生的伪特征。
4. 低分辨率、遮挡、多人和半身裁剪都已经测试；无法判断的样本应稳定落入 `uncertain`。
5. 已测量每张图片的推理耗时、显存占用和模型文件大小。
6. 已确定置信度阈值，例如低于某个阈值时不强行返回 `front` 或 `back`，而是转为 `uncertain`。阈值必须通过验证集和独立 test 集选择，不能直接凭感觉设定。
7. 模型文件缺失、加载失败或 CUDA 不可用时，生产服务仍有明确 fallback，不得阻塞背景加载。

生产接入前应保留当前 YOLO pose 的人体框裁剪逻辑作为输入预处理基线，并确认训练图片和生产裁剪图片的比例、padding、背景和分辨率一致。训练集使用的人工裁剪如果与生产实际裁剪差异很大，验证准确率不能代表上线效果。

### 推荐的实验记录

每次训练使用独立输出目录，并记录以下内容：

```text
实验名称：balanced_head_2026-08-10
数据版本：orientation_dataset_v2
train/val/test 划分：按人物分组，70/15/15
模型：ConvNeXt-Tiny + ImageNet pretrained
冻结骨干：是
image-size：224
batch-size：64
learning-rate：0.0001
best epoch：填写 history.json 中的结果
best val accuracy：填写实际结果
test accuracy：填写独立测试结果
主要错误：填写混淆矩阵和人工抽查结论
```

只有在数据版本、参数、checkpoint 和评估结果都能对应起来时，才比较不同实验。不要用被反复查看和调参的 `val` 结果冒充最终 test 结果。

## 与生产模块的边界

`training/orientation/train_orientation.py` 负责训练和单图检查。当前生产程序使用 `weighted_unfrozen/best.pt` 作为 ConvNeXt-Tiny 朝向模型；CMake 会把它复制为发布目录中的 `python/orientation-model/best.pt`，由 `src/python/visual_region_detector.py` 为每个人体框分类 `front`、`back` 或 `uncertain`。低于 `0.50` 的正面/背面置信度会转为 `uncertain`。生产服务仍使用 YOLO pose 生成胸部和胯部区域，并根据朝向选择外框优先区域。

只有在独立测试集表现稳定、类别定义经过确认、推理耗时可接受后，才应设计生产接入。接入时还需要明确：人体框裁剪方式、多人选择策略、置信度阈值、模型文件部署位置和模型不可用时的 fallback 行为。
