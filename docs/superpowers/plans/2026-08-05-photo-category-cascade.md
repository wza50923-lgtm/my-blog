# 照片编辑页「母标题 → 子标题」级联选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在相册管理面板的每张照片卡片（及上传弹窗）中，把单一分类下拉改为「母标题（父分类）→ 子标题（子分类）」两级级联选择：母标题无子分类时，下方的子标题选择不显示。

**Architecture:** 复用现有 `makeCatSelect` 自定义下拉组件，新增可选参数 `getOptions` 支持自定义选项列表；在其上层新增 `makeCatPair` 组件（母下拉 + 条件显示的子下拉），对外接口与 `makeCatSelect` 一致（`value()/setValue()/refresh()`），因此照片卡片、上传弹窗、保存读取处只需替换构造调用，取值逻辑不变。

**Tech Stack:** 原生 JS + 内联 CSS，单文件 `source/gallery/index.html`（Hexo 静态站点，无构建测试框架；验证用 `node --check` + `npx hexo generate` + 浏览器手动检查）。

## Global Constraints

- 只修改 `source/gallery/index.html`，不新建其他文件（计划文档除外）。
- 文件保持 UTF-8 无 BOM 编码、CRLF 换行；修改用精确字符串替换并做唯一性断言。
- **不执行 git commit / push / deploy**（用户确认满意后由用户自行执行）。
- 主显示页侧边栏、`+子`、加粗、排序、重命名、删除等现有行为一律不变。
- 照片数据模型不变：`m.cat` 仍是单一字符串（父分类名或子分类名），`catChildren` 结构不变。

---

### Task 1: 扩展 `makeCatSelect` 支持自定义选项列表

**Files:**
- Modify: `source/gallery/index.html` — `makeCatSelect` 函数（约第 835 行起）

**Interfaces:**
- Consumes: 现有全局 `catList`、`isChildCat(c)`、`closeCatSelects()`
- Produces: `makeCatSelect(container, initial, onChange, getOptions)` — 第 4 参 `getOptions` 为可选函数，返回 `[{v:值, label:显示文本, cls:"cs-parent"|"cs-child"|""}]`；不传时保持原有「全部父+子扁平列表」行为。

- [ ] **Step 1: 修改函数签名与 render 逻辑**

把第 835 行 `function makeCatSelect(container,initial,onChange){` 改为 `function makeCatSelect(container,initial,onChange,getOptions){`，并把整个 `render` 函数体替换为：

```js
  function render(){
    btn.textContent=val+" ▾";
    menu.innerHTML="";
    function addItem(label,cls,v){
      var it=document.createElement("div");
      it.className="cat-select-item"+(cls||"")+(v===val?" selected":"");
      it.textContent=label;
      it.addEventListener("click",function(){
        val=v;render();
        closeCatSelects();
        if(onChange)onChange(val);
      });
      menu.appendChild(it);
    }
    var opts=getOptions?getOptions():null;
    if(opts){
      opts.forEach(function(o){addItem(o.label,o.cls,o.v);});
    }else{
      catList.forEach(function(c){
        if(c==="全部")return;
        addItem(c,isChildCat(c)?" cs-child":" cs-parent",c);
      });
    }
  }
```

函数其余部分（btn 事件、appendChild、api 返回）保持不变。

- [ ] **Step 2: 验证语法与默认行为**

运行（提取 script 后做语法检查，注意文件为 CRLF/UTF-8 无 BOM）：

```powershell
$html=[System.IO.File]::ReadAllText('C:/Users/56660/my-blog/source/gallery/index.html')
$js=[regex]::Match($html,'(?s)<script[^>]*>(.*?)</script>').Groups[1].Value
[System.IO.File]::WriteAllText("$env:TEMP\g_chk.js",$js,(New-Object System.Text.UTF8Encoding($false)))
node --check "$env:TEMP\g_chk.js"
```

预期输出 `SYNTAX OK`（无报错）。现有调用点（`openUpload`、`renderAdminGrid`）不传第 4 参，行为不变。

- [ ] **Step 3: 确认改动范围**

运行：`git -C C:\Users\56660\my-blog diff --stat source/gallery/index.html`
预期：仅 `source/gallery/index.html` 有改动。**不提交。**

---

### Task 2: 新增 `makeCatPair` 级联组件

**Files:**
- Modify: `source/gallery/index.html` — 在 `makeCatSelect` 函数结束 `}` 之后、`// ===== Display =====` 注释之前插入

**Interfaces:**
- Consumes: `makeCatSelect(container,initial,onChange,getOptions)`、`getChildCats(p)`、`isChildCat(c)`、`parentOf(c)`、`catList`
- Produces: `makeCatPair(container, initial, onChange)` → `{root, value(), setValue(v), refresh()}`；`value()` 返回最终分类字符串（选了子分类则返回子分类名，否则返回母分类名）

- [ ] **Step 1: 插入 makeCatPair 函数**

```js
function makeCatPair(container,initial,onChange){
  var pDiv=document.createElement("div");
  pDiv.className="cat-pair-parent";
  var cDiv=document.createElement("div");
  cDiv.className="cat-pair-child";
  cDiv.style.display="none";
  container.appendChild(pDiv);
  container.appendChild(cDiv);
  var childVal="";
  var cSel=null;
  var pSel=makeCatSelect(pDiv,"未分类",function(){
    syncChild();
    if(onChange)onChange(value());
  },function(){
    var opts=[{v:"未分类",label:"未分类",cls:""}];
    catList.forEach(function(c){
      if(c==="全部"||c==="未分类"||isChildCat(c))return;
      opts.push({v:c,label:c,cls:"cs-parent"});
    });
    return opts;
  });
  function childOpts(){
    var p=pSel.value();
    var kids=getChildCats(p);
    if(!kids.length)return null;
    var opts=[{v:"",label:"（不选，归入「"+p+"」）",cls:""}];
    kids.forEach(function(k){opts.push({v:k,label:k,cls:"cs-child"});});
    return opts;
  }
  function syncChild(){
    var kids=getChildCats(pSel.value());
    var show=kids.length>0;
    cDiv.style.display=show?"block":"none";
    if(show){
      if(!cSel){
        cSel=makeCatSelect(cDiv,childVal,function(cv){childVal=cv;if(onChange)onChange(value());},childOpts);
      }else{
        childVal="";
        cSel.setValue("");
        cSel.refresh();
      }
    }else{
      childVal="";
    }
  }
  function value(){
    if(cSel&&cSel.value())return cSel.value();
    return pSel.value();
  }
  function setValue(v){
    if(isChildCat(v)){
      childVal=v;
      pSel.setValue(parentOf(v)||"未分类");
    }else{
      childVal="";
      pSel.setValue(v||"未分类");
    }
    syncChild();
  }
  setValue(initial||"未分类");
  return {root:container,value:value,setValue:setValue,refresh:function(){pSel.refresh();if(cSel)cSel.refresh();}};
}
```

行为规则：
- 母下拉只含「未分类」+ 全部父分类（加粗）；子下拉只在该母分类有子分类时显示。
- 子下拉首项为「（不选，归入「母分类」）」；切换母分类后子选择自动重置为不选。
- 照片原本属于某子分类时：母下拉自动定位到其父分类，子下拉定位到该子分类。
- 母分类「未分类」永远无子下拉。

- [ ] **Step 2: 新增 CSS 间距规则**

在 `</style>` 前插入一行：
```css
.cat-pair-child{margin-top:5px}
```

- [ ] **Step 3: 语法验证**

运行 Task 1 Step 2 的同一段 node 检查命令，预期 `SYNTAX OK`。**不提交。**

---

### Task 3: 照片卡片接入级联选择

**Files:**
- Modify: `source/gallery/index.html` — `renderAdminGrid` 中照片卡片构造处（约第 1070 行）

**Interfaces:**
- Consumes: `makeCatPair`；卡片内 `.ac` 容器
- Produces: 卡片内 `.ac` 元素持有 `_sel`（makeCatPair 实例），供「保存更改」读取 `value()`（现有代码 `c.querySelector(".ac")._sel.value()` 无需改动）

- [ ] **Step 1: 替换构造调用**

把：
```js
    if(acDiv){acDiv._sel=makeCatSelect(acDiv,m.cat||"未分类",function(v){m.cat=v;renderCatManage();});}
```
改为：
```js
    if(acDiv){acDiv._sel=makeCatPair(acDiv,m.cat||"未分类",function(v){m.cat=v;renderCatManage();});}
```

- [ ] **Step 2: 验证**

运行 Task 1 Step 2 的 node 语法检查；运行 `npx hexo generate`（workdir `C:\Users\56660\my-blog`），预期 81 个文件生成成功、无报错。**不提交。**

---

### Task 4: 上传弹窗接入级联选择

**Files:**
- Modify: `source/gallery/index.html` — `openUpload` 函数（约第 1004 行）

**Interfaces:**
- Consumes: `makeCatPair`；`#catInput` 容器
- Produces: `el.catInput._sel`（makeCatPair 实例）；上传提交处 `el.catInput._sel.value()` 与 `setValue("未分类")/refresh()` 调用保持不变

- [ ] **Step 1: 替换构造调用**

把：
```js
    if(!el.catInput._sel) el.catInput._sel=makeCatSelect(el.catInput,"未分类",function(){});
```
改为：
```js
    if(!el.catInput._sel) el.catInput._sel=makeCatPair(el.catInput,"未分类",function(){});
```

- [ ] **Step 2: 验证**

运行 Task 1 Step 2 的 node 语法检查；运行 `npx hexo generate`，预期成功。**不提交。**

---

### Task 5: 全量验证与手动测试清单

**Files:**
- Modify: 无（仅验证）

- [ ] **Step 1: 构建与本地服务检查**

```powershell
npx hexo generate
$r=Invoke-WebRequest -Uri 'http://localhost:4000/gallery/index.html' -UseBasicParsing -TimeoutSec 10
$b=[System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
$b.Contains('makeCatPair')   # 期望 True
$b.Contains('cat-pair-child') # 期望 True
$b.Contains('makeCatSelect')  # 期望 True（组件仍在）
```

- [ ] **Step 2: 浏览器手动测试**

在 `http://localhost:4000/gallery/` 登录管理后逐项确认：
1. 照片卡片：母下拉显示「未分类」+ 父分类（加粗），不含子分类。
2. 选择有子分类的父分类 → 下方立即出现子下拉（首项「（不选…）」+ 子分类缩进）；选择无子分类的父分类或「未分类」→ 子下拉隐藏。
3. 已有照片属于子分类 → 打开卡片时母下拉显示其父分类、子下拉显示该子分类。
4. 切换母分类 → 子选择重置为「不选」；左侧分类计数实时变化；点「保存更改」后主显示页与云端同步。
5. 上传弹窗同样为级联选择；上传后照片归属正确（点子分类只显示该子分类，点父分类显示父+子全部）。
6. 手机宽度（≤768px）下卡片两行下拉不溢出。

- [ ] **Step 3: 收尾**

`git -C C:\Users\56660\my-blog status --short` 确认仅 `source/gallery/index.html`（和计划文档）有改动；**不提交、不部署**，向用户报告验证结果并等待确认。

## Assumptions

- 级联选择同时应用于照片卡片与上传弹窗（保持一致；如用户只想要卡片，移除 Task 4 即可）。
- 子下拉包含「（不选，归入「母分类」）」选项，便于把照片从子分类改回母分类。
- 「未分类」在母下拉中始终存在且无子下拉。
- 照片数据模型与云端 manifest 格式不变，无需迁移。