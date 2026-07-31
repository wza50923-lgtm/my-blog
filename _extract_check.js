
(function(){
"use strict";

// ===== Supabase Config =====
var SUPABASE_URL = 'https://dxfxkflqcjifrjqvgzeh.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4ZnhrZmxxY2ppZnJqcXZnemVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4NzM4MzcsImV4cCI6MjA5NzQ0OTgzN30.yjWjRdLT_qO3NlxqrKHJAxWFfhClDeolH1_CXRXnHRk';
var BUCKET_NAME = 'photos';
var STORAGE_URL = SUPABASE_URL + "/storage/v1";
var MANIFEST_FILE = "manifest.json";
var MANIFEST_URL = STORAGE_URL + "/object/public/" + BUCKET_NAME + "/" + MANIFEST_FILE;

var SD = [
{"id":"s1","title":"0503","date":"2025-05-03","url":"250503.jpg"},
{"id":"s2","title":"BBQ","date":"2025-08-20","url":"250820bbq.jpg"},
{"id":"s3","title":"BBQ2","date":"2025-08-21","url":"250821bbq2.jpg"}
];

var ms = [], ci = 0, deleteTarget = null, previewTarget = -1, pwdCallback = null;
var el = {}, selectedFile = null;
var IS_CLOUD = true;

var ids = ["currentImg","prevImg","nextImg","photoTitle","photoDate","yearLabel","lightLeak","bgLayer","counter","photoFrame","timelineDots","shutterFlash","particleCanvas","navPrev","navNext","mainImage","uploadBtn","manageBtn","fileInput","uploadModal","modalClose","cancelBtn","submitBtn","titleInput","dateInput","uploadArea","adminPanel","adminClose","adminGrid","adminSaveBtn","adminCancelBtn","confirmDialog","confirmCancel","confirmOk","confirmMsg","compressingOverlay","previewOverlay","previewClose","previewImg","previewRotL","previewRotR","previewSave","pwdOverlay","pwdInput","pwdErr","pwdCancel","pwdSubmit"];
ids.forEach(function(id){el[id]=document.getElementById(id);});

// ===== Init =====
function init(){
  IS_CLOUD = (window.location.protocol === "https:" || window.location.protocol === "http:");
  loadMemories(function(){ renderTimeline(); updateDisplay(); });
  bindEvents();
  startParticles();
  document.addEventListener("keydown", function(e){
    if(e.key==="Escape"){closeUpload();closeAdmin();closeConfirm();}
  });
}

// ===== Cloud Data: manifest.json =====
function loadMemories(cb){
  ms = JSON.parse(JSON.stringify(SD));
  if(IS_CLOUD){
    var xhr=new XMLHttpRequest();
    xhr.open("GET",MANIFEST_URL,true);
    xhr.setRequestHeader("Authorization","Bearer "+SUPABASE_KEY);
    xhr.onload=function(){
      if(xhr.status===200){
        try{
          var cloud=JSON.parse(xhr.responseText);
          if(Array.isArray(cloud)&&cloud.length){
            ms=cloud;
            try{localStorage.setItem("memoir_list",xhr.responseText);}catch(e){}
            if(cb) cb(); return;
          }
        }catch(e){}
      }
      loadLocalFallback(cb);
    };
    xhr.onerror=function(){loadLocalFallback(cb);};
    xhr.send();
  }else{
    loadLocalFallback(cb);
  }
}
function loadLocalFallback(cb){
  ms = JSON.parse(JSON.stringify(SD));
  try{
    var saved=localStorage.getItem("memoir_list");
    if(saved){
      var extra=JSON.parse(saved);
      if(Array.isArray(extra)){
        var m={};ms.forEach(function(x){m[x.id]=true;});
        extra.forEach(function(x){if(!m[x.id])ms.push(x);});
      }
    }
  }catch(e){}
  if(cb) cb();
}
function saveManifest(cb){
  cb = cb || function(){};
  var json = JSON.stringify(ms);
  if(!IS_CLOUD){
    try{localStorage.setItem("memoir_list",json);}catch(e){}
    cb(true); return;
  }
  var xhr = new XMLHttpRequest();
  xhr.open("POST", STORAGE_URL+"/object/"+BUCKET_NAME+"/"+MANIFEST_FILE, true);
  xhr.setRequestHeader("Authorization","Bearer "+SUPABASE_KEY);
  xhr.setRequestHeader("Content-Type","application/json");
  xhr.setRequestHeader("x-upsert","true");
  xhr.onload = function(){ cb(xhr.status>=200&&xhr.status<300); };
  xhr.onerror = function(){ cb(false); };
  xhr.send(json);
  try{localStorage.setItem("memoir_list",json);}catch(e){}
}

// ===== Compress Image =====
function compressImage(file, cb){
  var MAX_DIM = 1920;
  var QUALITY = 0.85;
  var reader = new FileReader();
  reader.onload = function(e){
    var img = new Image();
    img.onload = function(){
      var canvas = document.createElement("canvas");
      var w = img.width, h = img.height;
      if(w>MAX_DIM||h>MAX_DIM){
        var r = Math.min(MAX_DIM/w, MAX_DIM/h);
        w*=r; h*=r;
      }
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      (function tryQ(q){
        canvas.toBlob(function(blob){
          if(!blob){ cb("Compression failed"); return; }
          var mb = blob.size/(1024*1024);
          if(mb>2.0&&q>0.4){ tryQ(q-0.1); }
          else {
            var nf = new File([blob], file.name.replace(/\..+$/,".jpg"), {type:"image/jpeg"});
            cb(null, nf, Math.round(mb*10)/10);
          }
        }, "image/jpeg", q);
      })(QUALITY);
    };
    img.src = e.target.result;
  };
  reader.onerror = function(){ cb("Read failed"); };
  reader.readAsDataURL(file);
}

// ===== Upload =====
function uploadToSupabase(file, cb){
  var ext = "jpg";
  var fn = Date.now()+"_"+Math.random().toString(36).slice(2,8)+"."+ext;
  var xhr = new XMLHttpRequest();
  xhr.open("POST", STORAGE_URL+"/object/"+BUCKET_NAME+"/"+fn, true);
  xhr.setRequestHeader("Authorization","Bearer "+SUPABASE_KEY);
  xhr.setRequestHeader("Content-Type","image/jpeg");
  xhr.setRequestHeader("x-upsert","true");
  xhr.onload = function(){
    if(xhr.status>=200&&xhr.status<300) cb(null, STORAGE_URL+"/object/public/"+BUCKET_NAME+"/"+fn);
    else cb("Upload failed: "+xhr.status+" "+xhr.responseText);
  };
  xhr.onerror = function(){ cb("Network error"); };
  xhr.send(file);
}

// ===== Display =====
function updateDisplay(){
  if(!ms.length) return;
  var m=ms[ci], t=ms.length;
  el.counter.innerHTML = (ci+1)+"/"+t;
  el.photoTitle.textContent = m.title;
  el.photoDate.textContent = formatDate(m.date);
  el.yearLabel.textContent = (m.date?new Date(m.date).getFullYear():"").toString().split("").join(" ");
  el.currentImg.src = m.url;
  var rot = m.rotate||0;
  el.currentImg.style.transform = "rotate("+rot+"deg)";
  el.currentImg.style.filter = "sepia(0.15)saturate(0.85)contrast(1.05)";
  if(rot%180===0){
    el.mainImage.style.height="100%";
    el.mainImage.style.width="";
    el.mainImage.style.maxWidth="78%";
    el.photoFrame.style.padding="10px 10px 28px 10px";
  }else{
    el.mainImage.style.height="";
    el.mainImage.style.width="72%";
    el.mainImage.style.maxWidth="1000px";
    el.photoFrame.style.padding="6px 14px 6px 14px";
  }
  var pi=(ci-1+t)%t, ni=(ci+1)%t;
  el.prevImg.src = ms[pi].url;
  el.nextImg.src = ms[ni].url;
  var y=m.date?new Date(m.date).getFullYear():0;
  var fl="sepia(0.15)saturate(0.85)contrast(1.05)";
  if(y&&y<2000) fl="sepia(0.55)saturate(0.6)brightness(0.85)contrast(1.1)";
  else if(y&&y<2010) fl="sepia(0.35)saturate(0.75)brightness(0.9)contrast(1.05)";
  else if(y&&y<2020) fl="sepia(0.2)saturate(0.85)brightness(0.95)contrast(1.05)";
  el.currentImg.style.filter=fl;
  var sh=(ci/Math.max(t-1,1))*30-15;
  el.bgLayer.style.transform="translate("+sh+"px,"+(sh*0.3)+"px) scale(1.1)";
  el.timelineDots.querySelectorAll(".timeline-dot").forEach(function(d,i){d.classList.toggle("active",i===ci);});
}

function renderTimeline(){
  el.timelineDots.innerHTML="";
  ms.forEach(function(m,i){
    var d=document.createElement("div");
    d.className="timeline-dot"+(i===ci?" active":"");
    d.dataset.idx=i;
    var y=m.date?new Date(m.date).getFullYear():"";
    var l=document.createElement("span"); l.className="dot-year"; l.textContent=y;
    d.appendChild(l);
    d.addEventListener("click",function(){goTo(parseInt(this.dataset.idx));});
    el.timelineDots.appendChild(d);
  });
}

function goTo(i){
  if(!ms.length) return;
  i=((i%ms.length)+ms.length)%ms.length;
  if(i===ci) return;
  ci=i;
  var fr=el.photoFrame;
  fr.style.transition="none"; fr.style.transform="scale(1.08)"; fr.style.opacity="0.3"; fr.style.filter="blur(5px)";
  el.currentImg.src=ms[ci].url; void fr.offsetHeight;
  fr.style.transition="transform 0.55s cubic-bezier(0.22,0.61,0.36,1),opacity 0.5s,filter 0.5s";
  fr.style.transform=""; fr.style.opacity=""; fr.style.filter="";
  updateDisplay(); renderTimeline(); randomEffect();
}

function nextImg(){goTo(ci+1);}
function prevImg(){goTo(ci-1);}
function formatDate(d){if(!d)return"";var dt=new Date(d);return dt.getFullYear()+"."+String(dt.getMonth()+1).padStart(2,"0");}

// ===== Upload UI =====

// ===== Password Verification =====
function showPwdModal(cb){
  pwdCallback = cb;
  el.pwdInput.value = "";
  el.pwdErr.textContent = "";
  el.pwdOverlay.classList.add("open");
  setTimeout(function(){ el.pwdInput.focus(); }, 100);
}

function closePwdModal(){ el.pwdOverlay.classList.remove("open"); pwdCallback = null; }

el.pwdSubmit.addEventListener("click", function(){
  if(el.pwdInput.value === "200910"){
    var cb = pwdCallback;
    closePwdModal();
    if(cb) cb();
  } else {
    el.pwdErr.textContent = "密码错误，请重试";
    el.pwdInput.value = "";
    el.pwdInput.focus();
  }
});

el.pwdCancel.addEventListener("click", closePwdModal);
el.pwdOverlay.addEventListener("click", function(e){ if(e.target === e.currentTarget) closePwdModal(); });
el.pwdInput.addEventListener("keydown", function(e){
  if(e.key === "Enter") el.pwdSubmit.click();
  else if(e.key === "Escape") closePwdModal();
});

function openUpload(){
  showPwdModal(function(){
    selectedFile=null; el.titleInput.value="";
    el.dateInput.value=new Date().toISOString().split("T")[0];
    el.uploadArea.textContent="点击选择图片";
    el.uploadArea.style.borderColor="rgba(196,169,125,0.2)";
    el.uploadModal.classList.add("open");
  });
}function closeUpload(){el.uploadModal.classList.remove("open");}

el.uploadBtn.addEventListener("click",openUpload);
el.modalClose.addEventListener("click",closeUpload);
el.cancelBtn.addEventListener("click",closeUpload);
el.uploadModal.addEventListener("click",function(e){if(e.target===e.currentTarget)closeUpload();});
el.uploadArea.addEventListener("click",function(){el.fileInput.click();});
el.fileInput.addEventListener("change",function(e){
  var f=e.target.files[0]; if(!f) return;
  selectedFile=f;
  var mb=Math.round(f.size/1024/1024*10)/10;
  el.uploadArea.textContent=f.name+" ("+mb+"MB -> 自动压缩)";
  el.uploadArea.style.borderColor="rgba(196,169,125,0.5)";
  if(!el.titleInput.value.trim()) el.titleInput.value=f.name.replace(/\..+$/,"");
});

el.submitBtn.addEventListener("click",function(){
  var title=el.titleInput.value.trim()||"未命名";
  var date=el.dateInput.value;
  if(!selectedFile){alert("请先选择一张图片");return;}
  el.submitBtn.textContent="压缩中..."; el.submitBtn.disabled=true;
  el.compressingOverlay.classList.add("show");
  compressImage(selectedFile,function(err,cf,mb){
    if(err){alert(err); el.submitBtn.textContent="确定上传"; el.submitBtn.disabled=false; el.compressingOverlay.classList.remove("show"); return;}
    el.submitBtn.textContent="上传中 ("+mb+"MB)...";
    uploadToSupabase(cf,function(err,url){
      el.compressingOverlay.classList.remove("show");
      if(err){alert(err); el.submitBtn.textContent="确定上传"; el.submitBtn.disabled=false; return;}
      ms.push({id:"m"+Date.now(), title:title, date:date, url:url});
      saveManifest(function(){
        renderTimeline(); goTo(ms.length-1);
        closeUpload(); el.submitBtn.textContent="确定上传"; el.submitBtn.disabled=false;
        selectedFile=null; el.fileInput.value="";
      });
    });
  });
});

// ===== Admin =====
function openAdmin(){showPwdModal(function(){renderAdminGrid();el.adminPanel.classList.add("open");});}
function closeAdmin(){el.adminPanel.classList.remove("open");}

function renderAdminGrid(){
  el.adminGrid.innerHTML="";
  ms.forEach(function(m,i){
    var c=document.createElement("div");
    c.className="admin-card"; c.dataset.idx=i;
    c.innerHTML='<div class="admin-card-thumb"><img src="'+he(m.url)+'"></div>'+
      '<div class="admin-card-fields">'+
      '<input class="at" value="'+he(m.title)+'" placeholder="标题">'+
      '<div style="display:flex;gap:6px"><input class="ad" type="date" value="'+he(m.date||"")+'" style="flex:1">'+
      '<input class="ai" type="number" value="'+(i+1)+'" min="1" max="'+ms.length+'" style="width:50px"></div></div>'+
      '<div class="admin-card-actions"><button class="up-btn" data-i="'+i+'">&#8593;</button>'+
      '<button class="down-btn" data-i="'+i+'">&#8595;</button>'+
      '<button class="rot-l-btn" data-i="'+i+'">&amp;#8630;</button>'+
      '<button class="rot-r-btn" data-i="'+i+'">&amp;#8631;</button>'+
      '<button class="del-btn" data-i="'+i+'">&#10005;</button></div>';
    el.adminGrid.appendChild(c);
  });
  el.adminGrid.querySelectorAll(".up-btn").forEach(function(b){
    b.addEventListener("click",function(){
      var idx=parseInt(this.dataset.i);
      if(idx<=0)return;
      var t=ms[idx];ms[idx]=ms[idx-1];ms[idx-1]=t;
      renderAdminGrid();
    });
  });
  el.adminGrid.querySelectorAll(".down-btn").forEach(function(b){
    b.addEventListener("click",function(){
      var idx=parseInt(this.dataset.i);
      if(idx>=ms.length-1)return;
      var t=ms[idx];ms[idx]=ms[idx+1];ms[idx+1]=t;
      renderAdminGrid();
    });
  });
  el.adminGrid.querySelectorAll(".rot-l-btn").forEach(function(b){b.addEventListener("click",function(){var idx=parseInt(this.dataset.i);ms[idx].rotate=(ms[idx].rotate||0)-90;renderAdminGrid();});});
  el.adminGrid.querySelectorAll(".rot-r-btn").forEach(function(b){b.addEventListener("click",function(){var idx=parseInt(this.dataset.i);ms[idx].rotate=(ms[idx].rotate||0)+90;renderAdminGrid();});});
  el.adminGrid.querySelectorAll(".admin-card-thumb").forEach(function(t){t.addEventListener("click",function(){var idx=parseInt(t.closest(".admin-card").dataset.idx);openPreview(idx);});});
  el.adminGrid.querySelectorAll(".del-btn").forEach(function(b){
    b.addEventListener("click",function(){
      deleteTarget=parseInt(this.dataset.i);
      el.confirmMsg.textContent="确定要删除「"+ms[deleteTarget].title+"」吗？";
      el.confirmDialog.classList.add("open");
    });
  });
}

el.manageBtn.addEventListener("click",openAdmin);
el.adminClose.addEventListener("click",closeAdmin);
el.adminCancelBtn.addEventListener("click",closeAdmin);
el.adminPanel.addEventListener("click",function(e){if(e.target===e.currentTarget)closeAdmin();});


// ===== Preview & Rotate =====
function openPreview(idx){
  previewTarget=idx;
  var m=ms[idx];
  el.previewImg.style.transform="rotate("+(m.rotate||0)+"deg)";
  el.previewImg.src=m.url;
  el.previewOverlay.classList.add("open");
}
el.previewClose.addEventListener("click",function(){el.previewOverlay.classList.remove("open");});
el.previewOverlay.addEventListener("click",function(e){if(e.target===e.currentTarget)el.previewOverlay.classList.remove("open");});
el.previewRotL.addEventListener("click",function(){
  if(previewTarget>=0&&previewTarget<ms.length){
    ms[previewTarget].rotate=(ms[previewTarget].rotate||0)-90;
    el.previewImg.style.transform="rotate("+(ms[previewTarget].rotate||0)+"deg)";
  }
});
el.previewRotR.addEventListener("click",function(){
  if(previewTarget>=0&&previewTarget<ms.length){
    ms[previewTarget].rotate=(ms[previewTarget].rotate||0)+90;
    el.previewImg.style.transform="rotate("+(ms[previewTarget].rotate||0)+"deg)";
  }
});
el.previewSave.addEventListener("click",function(){
  if(previewTarget>=0&&previewTarget<ms.length){
    saveManifest(function(){
      el.previewSave.textContent="已保存";
      setTimeout(function(){el.previewSave.textContent="保存";},1200);
    });
  }
});
el.adminSaveBtn.addEventListener("click",function(){
  var cards=el.adminGrid.querySelectorAll(".admin-card");
  var nm=[];
  cards.forEach(function(c){
    var idx=parseInt(c.dataset.idx);
    var og=ms[idx];
    nm.push({id:og.id||("m"+Date.now()), title:c.querySelector(".at").value.trim()||og.title, date:c.querySelector(".ad").value||og.date, rotate:og.rotate||0, url:og.url});
  });
  if(nm.length){ms=nm;}
  saveManifest(function(){
    renderTimeline();
    if(ci>=ms.length)ci=Math.max(0,ms.length-1);
    updateDisplay();
  });
  closeAdmin();
});

function removeFromSupabase(m){
  if(!m||!m.url) return;
  var p="/object/public/"+BUCKET_NAME+"/", i=m.url.indexOf(p);
  if(i<0) return;
  var fn=m.url.substring(i+p.length).split("?")[0];
  if(!fn) return;
  var xhr=new XMLHttpRequest();
  xhr.open("DELETE",STORAGE_URL+"/object/"+BUCKET_NAME+"/"+fn,true);
  xhr.setRequestHeader("Authorization","Bearer "+SUPABASE_KEY);
  xhr.setRequestHeader("Content-Type","application/json");
  xhr.onload=function(){
    if(xhr.status>=200&&xhr.status<300){
      try{console.log("cloud deleted: "+fn);}catch(e){}
    }else{
      try{alert("记录已删除，但云端图片删除失败("+xhr.status+")，请到 Supabase 控制台手动清理: "+fn);}catch(e){}
    }
  };
  xhr.onerror=function(){
    try{alert("网络异常，云端图片未能自动删除，请到 Supabase 控制台手动清理: "+fn);}catch(e){}
  };
  xhr.send(JSON.stringify([fn]));
}

el.confirmOk.addEventListener("click",function(){
  if(deleteTarget===null)return;
  var removed=ms[deleteTarget];
  ms.splice(deleteTarget,1);
  saveManifest(function(){
    renderAdminGrid();renderTimeline();
    if(ci>=ms.length)ci=Math.max(0,ms.length-1);
    updateDisplay();
  });
  removeFromSupabase(removed);
  closeConfirm();deleteTarget=null;
});
el.confirmCancel.addEventListener("click",closeConfirm);
el.confirmDialog.addEventListener("click",function(e){if(e.target===e.currentTarget)closeConfirm();});
function closeConfirm(){el.confirmDialog.classList.remove("open");deleteTarget=null;}
function he(s){return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}

// ===== Effects =====
function randomEffect(){var fx=[lightLeak,bokehEffect,sparkleEffect,shutterFlash];fx[Math.floor(Math.random()*fx.length)]();}
function lightLeak(){
  var lk=el.lightLeak; var h=15+Math.random()*40,x=10+Math.random()*80,y=20+Math.random()*60;
  lk.style.background="radial-gradient(ellipse at "+x+"% "+y+"%, hsla("+h+",30%,60%,0.3) 0%,transparent 40%)";
  lk.classList.add("active");setTimeout(function(){lk.classList.remove("active");},180);
}
function bokehEffect(){
  for(var i=0;i<6;i++){
    var c=document.createElement("div");
    c.style.cssText="position:fixed;z-index:49;pointer-events:none;border-radius:50%;opacity:0;animation:bokehFade "+(0.6+Math.random()*0.8)+"s ease-out forwards;background:radial-gradient(circle at 30% 30%,hsla("+(30+Math.random()*30)+",40%,70%,0.2),transparent)";
    var sz=20+Math.random()*80;c.style.width=sz+"px";c.style.height=sz+"px";
    c.style.left=(Math.random()*100)+"%";c.style.top=(Math.random()*100)+"%";
    document.body.appendChild(c);
    setTimeout(function(){if(c.parentNode)c.parentNode.removeChild(c);},2000);
  }
}
function sparkleEffect(){
  for(var i=0;i<8;i++){
    var s=document.createElement("div");
    s.style.cssText="position:fixed;z-index:49;pointer-events:none;border-radius:50%;opacity:0;animation:sparkleFade "+(0.5+Math.random()*0.6)+"s ease-out forwards";
    var sz=2+Math.random()*4;s.style.width=sz+"px";s.style.height=sz+"px";
    s.style.left=(Math.random()*100)+"%";s.style.top=(Math.random()*100)+"%";
    s.style.background="hsla("+(35+Math.random()*20)+",60%,80%,0.5)";
    document.body.appendChild(s);
    setTimeout(function(){if(s.parentNode)s.parentNode.removeChild(s);},1500);
  }
}
function shutterFlash(){
  var sf=el.shutterFlash;sf.style.background="rgba(255,255,255,0.03)";sf.style.opacity="1";
  setTimeout(function(){sf.style.opacity="0";},50);
}

// ===== Particles =====
function startParticles(){
  var c=el.particleCanvas;if(!c)return;
  c.width=window.innerWidth;c.height=window.innerHeight;
  var cx=c.getContext("2d");ps=[];
  for(var i=0;i<30;i++)ps.push({x:Math.random()*c.width,y:Math.random()*c.height,sz:Math.random()*2+0.5,sx:(Math.random()-0.5)*0.12,sy:-(Math.random()*0.08+0.02),op:Math.random()*0.2+0.03,hu:30+Math.random()*20});
  (function an(){cx.clearRect(0,0,c.width,c.height);
    ps.forEach(function(p){p.x+=p.sx;p.y+=p.sy;if(p.y<-10){p.y=c.height+10;p.x=Math.random()*c.width;}if(p.x<-10)p.x=c.width+10;if(p.x>c.width+10)p.x=-10;
    cx.beginPath();cx.arc(p.x,p.y,p.sz,0,Math.PI*2);cx.fillStyle="hsla("+p.hu+",40%,70%,"+p.op+")";cx.fill();
    cx.beginPath();cx.arc(p.x,p.y,p.sz*3,0,Math.PI*2);cx.fillStyle="hsla("+p.hu+",40%,70%,"+(p.op*0.1)+")";cx.fill();});
    requestAnimationFrame(an);})();
}

// ===== Events =====
function bindEvents(){
  document.addEventListener("wheel",function(e){e.preventDefault();if(e.deltaY>0)nextImg();else prevImg();},{passive:false});
  document.addEventListener("keydown",function(e){
    if(el.uploadModal.classList.contains("open")||el.adminPanel.classList.contains("open")||el.confirmDialog.classList.contains("open"))return;
    if(e.key==="ArrowLeft"||e.key==="ArrowUp")prevImg();else if(e.key==="ArrowRight"||e.key==="ArrowDown")nextImg();});
  el.navPrev.addEventListener("click",prevImg);el.navNext.addEventListener("click",nextImg);
  window.addEventListener("resize",function(){var c=el.particleCanvas;if(c){c.width=window.innerWidth;c.height=window.innerHeight;}});
  // Touch swipe for mobile
  var tx=0,ty=0;
  document.addEventListener("touchstart",function(e){
    if(el.uploadModal.classList.contains("open")||el.adminPanel.classList.contains("open")||el.confirmDialog.classList.contains("open")||el.editorOverlay.classList.contains("open")||el.compressOverlay.classList.contains("open")){tx=0;return}
    tx=e.changedTouches[0].screenX;ty=e.changedTouches[0].screenY;
  },{passive:true});
  document.addEventListener("touchend",function(e){
    if(tx===0)return;
    var dx=tx-e.changedTouches[0].screenX,dy=ty-e.changedTouches[0].screenY;
    if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>40){if(dx>0)nextImg();else prevImg()}
    tx=0;
  },{passive:true});
}

var as=document.createElement("style");
as.textContent="@keyframes bokehFade{0%{opacity:0;transform:scale(0.3)}30%{opacity:0.6}100%{opacity:0;transform:scale(2.5)}}@keyframes sparkleFade{0%{opacity:0;transform:scale(0)}30%{opacity:0.8;transform:scale(1.2)}100%{opacity:0;transform:scale(0)}}";
document.head.appendChild(as);

document.addEventListener("DOMContentLoaded",init);
})();
