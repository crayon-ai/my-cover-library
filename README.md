# 个人小红书封面收藏库

自用封面参考库。图片和索引都存在这个仓库里，页面由 GitHub Pages 直接从 `main` 分支根目录发布（无构建步骤）。

- 网页：https://crayon-ai.github.io/my-cover-library/
- 日常操作：在对话里把封面图（或信息流截图 + 说明要哪张）发给 Grok Bot，由它裁图、入库、提交。

## 结构

```
index.html           浏览页面（读取 catalog.json：分类筛选、搜索、大图查看）
catalog.json         索引：categories + covers
covers/<分类>/YYYYMMDD-简短描述.<ext>   封面图片
scripts/manage.py    管理脚本（add / add-category / rename-category / move / note / delete / delete-category / list）
scripts/add_cover.py 快捷入库（= manage.py add）
.nojekyll            关闭 Jekyll 处理
```

`catalog.json` 字段：

```json
{
  "updatedAt": "2026-11-05T20:30:00+08:00",
  "categories": [{ "id": "未分类", "name": "未分类" }],
  "covers": [{
    "id": "c001", "title": "...", "category": "未分类", "note": "...",
    "tags": ["..."], "addedAt": "2026-11-05",
    "path": "covers/未分类/20261105-xxx.jpg", "source": "..."
  }]
}
```

## 入库 / 管理流程

```bash
cd /workspace/my-cover-library && git pull -q
# 新增封面（默认进「未分类」；--create-category 可顺手建新分类）
python3 scripts/manage.py add /path/to/img.jpg --title "标题" --category 未分类 --note "构图/配色要点" --source "来源" --tags "人物,大字"
# 新建 / 重命名 / 删除空分类
python3 scripts/manage.py add-category "AI工具"
python3 scripts/manage.py rename-category "AI工具" "AI教程"
python3 scripts/manage.py delete-category "AI教程"
# 移动封面到别的分类（图片文件会一起移动）
python3 scripts/manage.py move c001 "AI工具"
# 改标题 / 备注 / 来源 / 标签
python3 scripts/manage.py note c001 --note "新备注" --tags "a,b"
# 删除封面、查看列表
python3 scripts/manage.py delete c003
python3 scripts/manage.py list
# 发布
git add -A && git commit -m "add c003" && git push
```

推送后 Pages 约 1 分钟内更新。
