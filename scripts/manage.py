#!/usr/bin/env python3
"""封面库管理脚本。在仓库根目录或任意位置运行均可。

子命令:
  add <image> --title T [--category 未分类] [--note N] [--source S] [--tags a,b] [--date YYYY-MM-DD]
  add-category <name>
  rename-category <old> <new>
  move <cover_id> <category>
  note <cover_id> [--title T] [--note N] [--source S] [--tags a,b]
  delete <cover_id>
  delete-category <name>      (仅限空分类)
  list [--category C]
修改后自行 git add -A && git commit && git push。
"""
import argparse, json, os, re, shutil, subprocess, sys
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "catalog.json")
TZ = timezone(timedelta(hours=8))

def load():
    with open(CATALOG, encoding="utf-8") as f:
        return json.load(f)

def save(cat):
    cat["updatedAt"] = datetime.now(TZ).isoformat(timespec="seconds")
    with open(CATALOG, "w", encoding="utf-8") as f:
        json.dump(cat, f, ensure_ascii=False, indent=2)
        f.write("\n")

def die(msg):
    print("错误: " + msg, file=sys.stderr); sys.exit(1)

def safe_name(s, maxlen=40):
    s = re.sub(r'[\\/:*?"<>|#%&{}$!\'@`=+\s]+', "", s).strip(".")
    return s[:maxlen] or "cover"

def find_cover(cat, cid):
    for c in cat["covers"]:
        if c["id"] == cid:
            return c
    die(f"找不到封面 {cid}")

def cat_ids(cat):
    return [c["id"] for c in cat["categories"]]

def next_id(cat):
    nums = [int(c["id"][1:]) for c in cat["covers"] if re.fullmatch(r"c\d+", c["id"])]
    return "c%03d" % ((max(nums) if nums else 0) + 1)

def git_mv(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    r = subprocess.run(["git", "-C", ROOT, "mv", src, dst], capture_output=True)
    if r.returncode != 0:
        shutil.move(src, dst)

def unique_path(rel):
    base, ext = os.path.splitext(rel); i = 2
    while os.path.exists(os.path.join(ROOT, rel)):
        rel = f"{base}-{i}{ext}"; i += 1
    return rel

def cmd_add(a):
    cat = load()
    if not os.path.isfile(a.image): die(f"图片不存在: {a.image}")
    if a.category not in cat_ids(cat):
        if a.create_category:
            cat["categories"].append({"id": a.category, "name": a.category})
        else:
            die(f"分类「{a.category}」不存在（加 --create-category 自动新建）。现有: {', '.join(cat_ids(cat))}")
    date = a.date or datetime.now(TZ).strftime("%Y-%m-%d")
    ext = os.path.splitext(a.image)[1].lower() or ".jpg"
    if ext == ".jpeg": ext = ".jpg"
    rel = unique_path(f"covers/{safe_name(a.category)}/{date.replace('-','')}-{safe_name(a.title)}{ext}")
    os.makedirs(os.path.dirname(os.path.join(ROOT, rel)), exist_ok=True)
    shutil.copyfile(a.image, os.path.join(ROOT, rel))
    cid = next_id(cat)
    cat["covers"].append({
        "id": cid, "title": a.title, "category": a.category, "note": a.note or "",
        "tags": [t.strip() for t in (a.tags or "").split(",") if t.strip()],
        "addedAt": date, "path": rel, "source": a.source or "",
    })
    save(cat); print(f"已入库 {cid}: {rel}")

def cmd_add_category(a):
    cat = load()
    if a.name in cat_ids(cat): die(f"分类「{a.name}」已存在")
    cat["categories"].append({"id": a.name, "name": a.name})
    save(cat); print(f"已新建分类「{a.name}」")

def cmd_rename_category(a):
    cat = load()
    if a.old not in cat_ids(cat): die(f"分类「{a.old}」不存在")
    if a.new in cat_ids(cat): die(f"分类「{a.new}」已存在")
    for c in cat["categories"]:
        if c["id"] == a.old: c["id"] = c["name"] = a.new
    for c in cat["covers"]:
        if c["category"] == a.old:
            c["category"] = a.new
            new = unique_path(f"covers/{safe_name(a.new)}/{os.path.basename(c['path'])}")
            git_mv(os.path.join(ROOT, c["path"]), os.path.join(ROOT, new)); c["path"] = new
    save(cat); print(f"分类「{a.old}」→「{a.new}」")

def cmd_move(a):
    cat = load(); c = find_cover(cat, a.id)
    if a.category not in cat_ids(cat):
        if a.create_category: cat["categories"].append({"id": a.category, "name": a.category})
        else: die(f"分类「{a.category}」不存在（加 --create-category 自动新建）")
    new = unique_path(f"covers/{safe_name(a.category)}/{os.path.basename(c['path'])}")
    git_mv(os.path.join(ROOT, c["path"]), os.path.join(ROOT, new))
    c["path"], c["category"] = new, a.category
    save(cat); print(f"{a.id} → 「{a.category}」 ({new})")

def cmd_note(a):
    cat = load(); c = find_cover(cat, a.id)
    if a.title is not None: c["title"] = a.title
    if a.note is not None: c["note"] = a.note
    if a.source is not None: c["source"] = a.source
    if a.tags is not None: c["tags"] = [t.strip() for t in a.tags.split(",") if t.strip()]
    save(cat); print(f"已更新 {a.id}")

def cmd_delete(a):
    cat = load(); c = find_cover(cat, a.id)
    p = os.path.join(ROOT, c["path"])
    if os.path.exists(p):
        if subprocess.run(["git", "-C", ROOT, "rm", "-q", p], capture_output=True).returncode != 0:
            os.remove(p)
    cat["covers"] = [x for x in cat["covers"] if x["id"] != a.id]
    save(cat); print(f"已删除 {a.id}")

def cmd_delete_category(a):
    cat = load()
    if a.name not in cat_ids(cat): die(f"分类「{a.name}」不存在")
    n = sum(1 for c in cat["covers"] if c["category"] == a.name)
    if n: die(f"分类「{a.name}」里还有 {n} 张封面，先 move 走")
    cat["categories"] = [c for c in cat["categories"] if c["id"] != a.name]
    save(cat); print(f"已删除分类「{a.name}」")

def cmd_list(a):
    cat = load()
    for k in cat["categories"]:
        print(f"[{k['id']}] {sum(1 for c in cat['covers'] if c['category']==k['id'])} 张")
    for c in cat["covers"]:
        if a.category and c["category"] != a.category: continue
        print(f"  {c['id']}  {c['addedAt']}  [{c['category']}]  {c['title']}  — {c['note'][:40]}")

def main():
    p = argparse.ArgumentParser(description="封面库管理"); s = p.add_subparsers(dest="cmd", required=True)
    x = s.add_parser("add"); x.add_argument("image"); x.add_argument("--title", required=True)
    x.add_argument("--category", default="未分类"); x.add_argument("--note"); x.add_argument("--source")
    x.add_argument("--tags"); x.add_argument("--date"); x.add_argument("--create-category", action="store_true")
    x.set_defaults(f=cmd_add)
    x = s.add_parser("add-category"); x.add_argument("name"); x.set_defaults(f=cmd_add_category)
    x = s.add_parser("rename-category"); x.add_argument("old"); x.add_argument("new"); x.set_defaults(f=cmd_rename_category)
    x = s.add_parser("move"); x.add_argument("id"); x.add_argument("category")
    x.add_argument("--create-category", action="store_true"); x.set_defaults(f=cmd_move)
    x = s.add_parser("note"); x.add_argument("id"); x.add_argument("--title"); x.add_argument("--note")
    x.add_argument("--source"); x.add_argument("--tags"); x.set_defaults(f=cmd_note)
    x = s.add_parser("delete"); x.add_argument("id"); x.set_defaults(f=cmd_delete)
    x = s.add_parser("delete-category"); x.add_argument("name"); x.set_defaults(f=cmd_delete_category)
    x = s.add_parser("list"); x.add_argument("--category"); x.set_defaults(f=cmd_list)
    a = p.parse_args(); a.f(a)

if __name__ == "__main__":
    main()
