
const $=id=>document.getElementById(id);
function toast(msg,kind){const t=$('protoToast');t.className='proto-toast '+(kind||'success');t.textContent=msg;t.style.display='flex';clearTimeout(t.__h);t.__h=setTimeout(()=>{t.style.display='none';},2600);}
function banner(id,msg){const e=$(id);e.setAttribute('role','alert');e.style.display=msg?'flex':'none';if(msg)e.querySelector('span').textContent=msg;}
function ferr(id,msg){const e=$(id);e.style.display=msg?'block':'none';e.textContent=msg||'';}
function busy(b,on,label){if(on){b.dataset.label=b.innerHTML;b.disabled=true;b.innerHTML='<span class="spin"></span> '+(label||'Working…');}else{b.disabled=false;b.innerHTML=b.dataset.label||b.innerHTML;}}
function pwdPolicyError(p){if(p.length<12)return 'Password needs 12+ chars with upper, lower, digit and special';if(!/[A-Z]/.test(p))return 'Password needs an uppercase letter';if(!/[a-z]/.test(p))return 'Password needs a lowercase letter';if(!/[0-9]/.test(p))return 'Password needs a digit';if(!/[^A-Za-z0-9]/.test(p))return 'Password needs a special character';return '';}
const EMAIL_RE=/^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/* safeOidcRedirect mirror — api/oidc.ts:53-63 */
function safeRedirect(r){if(!r)return undefined;let d;try{d=decodeURIComponent(r);}catch(_){return undefined;}if(d.includes('\\')||d.includes('%2F%2F'))return undefined;return /^\/oidc\/(auth|device)\//.test(d)?d:undefined;}
/* flow routing */
let curFlow='login';
function showFlow(f){curFlow=f;document.querySelectorAll('.flow').forEach(s=>s.classList.toggle('on',s.id==='flow-'+f));document.querySelectorAll('.auth-nav button').forEach(b=>b.classList.toggle('on',b.dataset.flow===f));if(f==='consent')consentLoad();if(f==='setup')focusStep();}
document.querySelectorAll('.auth-nav button').forEach(b=>b.onclick=()=>showFlow(b.dataset.flow));
if(location.hash)showFlow(location.hash.slice(1));
/* theme + pack (same mechanism as admin-console: data-style x data-theme) */
(function(){let st=null,th=null;try{st=localStorage.getItem('ab_style');th=localStorage.getItem('ab_theme');}catch(e){}const ss=document.getElementById('styleSelect');const pack=(st&&[...ss.options].some(o=>o.value===st))?st:'ant';document.documentElement.dataset.style=pack;ss.value=pack;if(th==='dark'||th==='light')document.documentElement.dataset.theme=th;})();
$('themeBtn').onclick=()=>{const d=document.documentElement;d.dataset.theme=d.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('ab_theme',d.dataset.theme);}catch(e){}};
$('styleSelect').onchange=()=>{document.documentElement.dataset.style=$('styleSelect').value;try{localStorage.setItem('ab_style',$('styleSelect').value);}catch(e){}};
/* ==== login ==== */
let lgTried=false,ocConsumed=false;
$('lgSubmit').onclick=()=>{ferr('lgEmailErr','');ferr('lgPwdErr','');banner('lgErr','');const em=$('lgEmail').value.trim(),pw=$('lgPwd').value;
 if(!em||!EMAIL_RE.test(em)){ferr('lgEmailErr','A valid email is required');return;}
 if(!pw){ferr('lgPwdErr','Password is required');return;}
 busy($('lgSubmit'),true,'Signing in…');setTimeout(()=>{busy($('lgSubmit'),false);
  if(!lgTried){lgTried=true;banner('lgErr','AUTH_002: invalid credentials (prototype simulation) — retry.');return;}
  $('lgOk').style.display='flex';toast('Signed in');},400);};
$('lgMagicBtn').onclick=()=>{const p=$('lgMagicPanel');p.style.display=p.style.display==='none'?'block':'none';};
let mgTried=false;
$('mgSend').onclick=()=>{const em=$('mgEmail').value.trim();if(!em||!EMAIL_RE.test(em)){toast('A valid email is required','error');return;}busy($('mgSend'),true,'Sending…');setTimeout(()=>{busy($('mgSend'),false);if(!mgTried){mgTried=true;toast('Send failed: upstream timeout (prototype simulation) — retry','error');return;}$('mgMsg').style.display='flex';},400);};
$('ocConsume').onclick=()=>{const m=$('ocMsg');if(ocConsumed){m.textContent='401: code consumed — a second POST fails and the refresh-interceptor would log out (Login.tsx:92-98).';m.style.color='var(--danger-text,var(--danger))';return;}ocConsumed=true;m.textContent='Code consumed once — session established (demo).';m.style.color='var(--ok-text,var(--ok))';};
$('rdCheck').onclick=()=>{const ok=safeRedirect($('rdInput').value);const m=$('rdMsg');m.textContent=ok?('Allowed redirect: '+ok):'Rejected: only /oidc/auth/… or /oidc/device/… without backslash or %2F%2F.';m.style.color=ok?'var(--ok-text,var(--ok))':'var(--danger-text,var(--danger))';};
/* ==== magic consumption ==== */
$('mkConsume').onclick=()=>{banner('mkErr','');$('mkOk').style.display='none';$('mkSpin').style.display='inline-block';setTimeout(()=>{$('mkSpin').style.display='none';const s=$('mkState').value;if(s==='valid'){$('mkOk').style.display='flex';}else if(s==='suspended'){banner('mkErr','AUTH_004: account suspended — contact an administrator.');}else{banner('mkErr','Magic link invalid or already consumed.');}},500);};
/* ==== register ==== */
let rgTried=false;
$('rgSubmit').onclick=()=>{['rgNameErr','rgEmailErr','rgPwdErr','rgConfirmErr'].forEach(i=>ferr(i,''));banner('rgErr','');
 const nm=$('rgName').value.trim(),em=$('rgEmail').value.trim(),pw=$('rgPwd').value,cf=$('rgConfirm').value;
 if(!nm){ferr('rgNameErr','Name is required');return;}
 if(!em||!EMAIL_RE.test(em)){ferr('rgEmailErr','A valid email is required');return;}
 const pe=pwdPolicyError(pw);if(pe){ferr('rgPwdErr',pe);return;}
 if(cf!==pw){ferr('rgConfirmErr','Passwords do not match');return;}
 busy($('rgSubmit'),true,'Creating…');setTimeout(()=>{busy($('rgSubmit'),false);if(!rgTried){rgTried=true;banner('rgErr','Create failed: upstream timeout (prototype simulation) — retry.');return;}$('rgOk').style.display='flex';},400);};
/* ==== forgot ==== */
let fgTried=false;
$('fgSubmit').onclick=()=>{ferr('fgEmailErr','');banner('fgErr','');const em=$('fgEmail').value.trim();if(!em||!EMAIL_RE.test(em)){ferr('fgEmailErr','A valid email is required');return;}busy($('fgSubmit'),true,'Sending…');setTimeout(()=>{busy($('fgSubmit'),false);if(!fgTried){fgTried=true;banner('fgErr','Send failed: upstream timeout (prototype simulation) — retry.');return;}$('fgSent').style.display='flex';},400);};
/* ==== reset ==== */
let rsTried=false;
$('rsSubmit').onclick=()=>{ferr('rsPwdErr','');ferr('rsConfirmErr','');banner('rsErr','');const pw=$('rsPwd').value,cf=$('rsConfirm').value;const pe=pwdPolicyError(pw);if(pe){ferr('rsPwdErr',pe);return;}if(cf!==pw){ferr('rsConfirmErr','Passwords do not match');return;}busy($('rsSubmit'),true,'Updating…');setTimeout(()=>{busy($('rsSubmit'),false);if(!rsTried){rsTried=true;banner('rsErr','Reset failed: token service timeout (prototype simulation) — retry.');return;}$('rsOk').style.display='flex';$('rsToken').textContent='Reset token consumed (demo).';},400);};
/* ==== verify ==== */
$('vfRun').onclick=()=>{banner('vfErr','');$('vfOk').style.display='none';$('vfSpin').style.display='inline-block';setTimeout(()=>{$('vfSpin').style.display='none';if($('vfState').value==='valid'){$('vfOk').style.display='flex';}else{banner('vfErr','Verification link expired or already consumed — request a new one.');}},500);};
$('vfResend').onclick=()=>toast('Verification email resent');
/* ==== enroll ==== */
let enTried=false;
$('enCopy').onclick=async()=>{const txt=$('enUrl').textContent;try{await navigator.clipboard.writeText(txt);toast('Copied to clipboard');}catch(_){const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();const ok=document.execCommand&&document.execCommand('copy');ta.remove();if(ok)toast('Copied to clipboard');else toast('Copy failed','error');}};
$('enDeadBtn').onclick=()=>{$('enDead').style.display='flex';$('enBody').style.display='none';};
$('enConfirm').onclick=()=>{ferr('enErr','');const c=$('enCode').value.trim();if(!/^\d{6}$/.test(c)){ferr('enErr','Enter the 6-digit code from your authenticator');return;}busy($('enConfirm'),true,'Confirming…');setTimeout(()=>{busy($('enConfirm'),false);if(c!=='123456'){ferr('enErr','Wrong code — try again (token burns only at the attempt limit).');return;}if(!enTried){enTried=true;ferr('enErr','Confirm failed: upstream timeout (prototype simulation) — retry.');return;}$('enBody').style.display='none';$('enCodes').innerHTML=Array.from({length:8},(_,i)=>'<span>RC-'+(1000+i*137)+'</span>').join('');$('enRecovery').style.display='block';},400);};
$('enSaved').onchange=()=>{$('enContinue').disabled=!$('enSaved').checked;};
$('enContinue').onclick=()=>{toast('MFA enrolled');location.href='admin-console.html';};
/* ==== consent ==== */
let csLoaded=false,csLoadTried=false,csTried=false;
function consentLoad(){if(csLoaded)return;$('csBody').style.display='none';banner('csLoadErr','');setTimeout(()=>{if(!csLoadTried){csLoadTried=true;$('csLoadErr').style.display='flex';return;}csLoaded=true;$('csBody').style.display='block';},400);}
$('csLoadRetry').onclick=()=>{consentLoad();};
function decide(kind){banner('csErr','');$('csRedirecting').style.display='none';
 if(kind==='approve'){const rd=safeRedirect($('csRedirect').value);if(!rd){banner('csErr','Redirect not allowed — only /oidc/auth/… or /oidc/device/… (open-redirect hygiene).');return;}}
 const b=kind==='approve'?$('csApprove'):$('csDeny');busy(b,true,kind==='approve'?'Approving…':'Denying…');
 setTimeout(()=>{busy(b,false);if(!csTried){csTried=true;banner('csErr','Decision failed: upstream timeout (prototype simulation) — retry.');return;}$('csRedirecting').style.display='flex';toast(kind==='approve'?'Consent approved':'Consent denied');},400);}
$('csApprove').onclick=()=>decide('approve');
$('csDeny').onclick=()=>decide('deny');
/* ==== setup wizard ==== */
let suStep=0,suTried=false;
function focusStep(){const h=$('suHead');if(h)h.focus();}
function paintSteps(){[...$('suSteps').children].forEach((el,i)=>{el.className='st'+(i===suStep?' on':(i<suStep?' done':''));});for(let i=0;i<4;i++)$('su'+i).style.display=i===suStep?'block':'none';$('suPrev').disabled=suStep===0;$('suNext').textContent=suStep===3?'Finish':'Next';focusStep();}
$('suPrev').onclick=()=>{if(suStep>0){suStep--;paintSteps();}};
$('suNext').onclick=()=>{
 if(suStep===1){ferr('suNameErr','');ferr('suEmailErr','');ferr('suPwdErr','');banner('suErr','');
  const nm=$('suName').value.trim(),em=$('suEmail').value.trim(),pw=$('suPwd').value;
  if(!nm){ferr('suNameErr','Name is required');return;}
  if(!em||!EMAIL_RE.test(em)){ferr('suEmailErr','A valid email is required');return;}
  if(pw.length<8){ferr('suPwdErr','Password must be at least 8 characters (setup bootstrap policy)');return;}
  busy($('suNext'),true,'Creating…');setTimeout(()=>{busy($('suNext'),false);if(!suTried){suTried=true;banner('suErr','Create failed: upstream timeout (prototype simulation) — retry.');return;}suStep=2;paintSteps();},400);return;}
 if(suStep===2){ferr('cfSiteNameErr','');if(!$('cfSiteName').value.trim()){ferr('cfSiteNameErr','Site name is required');return;}}
 if(suStep===3){toast('Setup complete');location.href='admin-console.html';return;}
 suStep++;paintSteps();};
paintSteps();
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cbxSeq=0;let openCbx=null;
function cbxBuildList(sel){const w=sel._cbx;if(!w)return;const list=w.querySelector('.cbx-list');list.innerHTML='';list.setAttribute('aria-multiselectable',sel.multiple?'true':'false');[...sel.options].forEach((o,oi)=>{const d=document.createElement('div');d.className='cbx-opt';d.setAttribute('role','option');d.id=list.id+'-opt-'+oi;d.dataset.value=o.value;d.setAttribute('aria-selected',o.selected?'true':'false');d.textContent=o.textContent;d.onclick=e=>{e.stopPropagation();if(sel.multiple){o.selected=!o.selected;sel.dispatchEvent(new Event('input',{bubbles:true}));sel.dispatchEvent(new Event('change',{bubbles:true}));cbxRefresh(sel);}else{sel.value=o.value;sel.dispatchEvent(new Event('input',{bubbles:true}));sel.dispatchEvent(new Event('change',{bubbles:true}));cbxClose();}};list.appendChild(d);});}
function cbxRefresh(sel){const w=sel._cbx;if(!w)return;const val=w.querySelector('.cbx-val');if(sel.multiple){const selOpts=[...sel.selectedOptions];val.innerHTML=selOpts.length?selOpts.map(o=>'<span class="cbx-chip">'+esc(o.textContent)+'<button type="button" data-cbxrm="'+esc(o.value)+'" aria-label="Remove '+esc(o.textContent)+'" tabindex="0"><svg class="ic"><use href="#i-x"/></svg></button></span>').join(''):'<span style="color:var(--tx3)">Select…</span>';}else{const o=sel.options[sel.selectedIndex];val.textContent=o?o.textContent:'';}const cl=w.querySelector('.cbx-clear');const showCl=!sel.disabled&&sel.hasAttribute('data-clearable')&&(sel.multiple?sel.selectedOptions.length:sel.value!=='');if(cl)cl.style.display=showCl?'inline-flex':'none';w.classList.toggle('cbx-has-clear',!!showCl);if(w.classList.contains('open'))cbxBuildList(sel);}
function cbxPlace(w){const list=w.querySelector('.cbx-list');const br=w.querySelector('.cbx-btn').getBoundingClientRect();list.style.minWidth=br.width+'px';list.style.visibility='hidden';const lw=list.offsetWidth,lh=list.offsetHeight;let top=br.bottom+4;if(top+lh>window.innerHeight-4)top=Math.max(4,br.top-4-lh);const left=Math.max(4,Math.min(br.left,window.innerWidth-lw-4));list.style.top=top+'px';list.style.left=left+'px';list.style.visibility='';}
function cbxClose(){if(openCbx){openCbx.classList.remove('open');const bb=openCbx.querySelector('.cbx-btn');bb.setAttribute('aria-expanded','false');bb.removeAttribute('aria-activedescendant');openCbx=null;}}
function cbxSyncDisabled(sel){const w=sel._cbx;if(!w)return;const b=w.querySelector('.cbx-btn');b.disabled=sel.disabled;b.tabIndex=sel.disabled?-1:0;b.setAttribute('aria-disabled',sel.disabled?'true':'false');w.classList.toggle('cbx-disabled',sel.disabled);if(sel.disabled)cbxClose();}
function cbxSetActive(w,opts,ai){opts.forEach(o=>o.classList.remove('active'));if(ai>=0&&opts[ai]){opts[ai].classList.add('active');opts[ai].scrollIntoView({block:'nearest'});w.querySelector('.cbx-btn').setAttribute('aria-activedescendant',opts[ai].id);}else{w.querySelector('.cbx-btn').removeAttribute('aria-activedescendant');}}
function cbxOpen(sel){const w=sel._cbx;if(sel.disabled||w.classList.contains('cbx-loading'))return;cbxClose();cbxBuildList(sel);w.classList.add('open');cbxPlace(w);w.querySelector('.cbx-btn').setAttribute('aria-expanded','true');openCbx=w;const opts=[...w.querySelectorAll('.cbx-opt')];const si=opts.findIndex(o=>o.getAttribute('aria-selected')==='true');cbxSetActive(w,opts,si>=0?si:0);}
function enhanceSelect(sel){if(sel._cbx)return;const w=document.createElement('span');w.className='cbx';const id='cbx-list-'+(++cbxSeq);if(sel.multiple)w.setAttribute('data-multi','');w.innerHTML='<div class="cbx-btn" role="combobox" tabindex="0" aria-haspopup="listbox" aria-expanded="false" aria-controls="'+id+'"><span class="cbx-val"></span><span class="cbx-load"><svg class="ic"><use href="#i-refresh"/></svg></span><svg class="ic cbx-chev"><use href="#i-chev-r"/></svg></div><button type="button" class="cbx-clear" aria-label="Clear" tabindex="0"><svg class="ic"><use href="#i-x"/></svg></button><div class="cbx-list" role="listbox" id="'+id+'"></div>';sel.parentNode.insertBefore(w,sel);sel.classList.add('cbx-src');w.appendChild(sel);sel._cbx=w;const btn=w.querySelector('.cbx-btn');cbxSyncDisabled(sel);w.querySelector('.cbx-clear').onclick=e=>{e.stopPropagation();if(sel.disabled)return;if(sel.multiple){[...sel.options].forEach(o=>o.selected=false);}else{sel.value='';}sel.dispatchEvent(new Event('input',{bubbles:true}));sel.dispatchEvent(new Event('change',{bubbles:true}));cbxRefresh(sel);};w.addEventListener('click',e=>{const rm=e.target.closest('[data-cbxrm]');if(!rm)return;e.stopPropagation();const o=[...sel.options].find(x=>x.value===rm.dataset.cbxrm);if(o)o.selected=false;sel.dispatchEvent(new Event('input',{bubbles:true}));sel.dispatchEvent(new Event('change',{bubbles:true}));cbxRefresh(sel);});sel._cbxSetLoading=on=>{w.classList.toggle('cbx-loading',!!on);if(on)cbxClose();};btn.onclick=e=>{if(sel.disabled)return;if(e.target.closest('[data-cbxrm]'))return;e.stopPropagation();if(sel.disabled)return;if(openCbx===w){cbxClose();}else{cbxOpen(sel);}};btn.onkeydown=e=>{if(sel.disabled)return;const opts=[...w.querySelectorAll('.cbx-opt')];let ai=opts.findIndex(o=>o.classList.contains('active'));if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(openCbx!==w){cbxOpen(sel);return;}ai=ai<0?0:(ai+(e.key==='ArrowDown'?1:-1)+opts.length)%opts.length;cbxSetActive(w,opts,ai);}else if(e.key==='Home'||e.key==='End'){e.preventDefault();if(openCbx!==w)cbxOpen(sel);const o2=[...w.querySelectorAll('.cbx-opt')];cbxSetActive(w,o2,e.key==='Home'?0:o2.length-1);}else if(e.key==='Enter'||e.key===' '){e.preventDefault();if(openCbx!==w){cbxOpen(sel);}else if(ai>=0){opts[ai].click();if(sel.multiple)cbxSetActive(w,[...w.querySelectorAll('.cbx-opt')],ai);}}else if(e.key==='Escape'){e.stopPropagation();cbxClose();}else if(e.key==='Tab'){cbxClose();}else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();if(openCbx!==w)cbxOpen(sel);const o2=[...w.querySelectorAll('.cbx-opt')];const ch=e.key.toLowerCase();let start=ai+1;for(let k=0;k<o2.length;k++){const idx=(start+k)%o2.length;if(o2[idx].textContent.trim().toLowerCase().startsWith(ch)){cbxSetActive(w,o2,idx);break;}}}};sel.addEventListener('change',()=>cbxRefresh(sel));sel.addEventListener('input',()=>cbxRefresh(sel));new MutationObserver(()=>{cbxSyncDisabled(sel);cbxBuildList(sel);cbxRefresh(sel);}).observe(sel,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled']});const desc=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');Object.defineProperty(sel,'value',{configurable:true,get(){return desc.get.call(this);},set(v){desc.set.call(this,v);cbxRefresh(this);}});cbxRefresh(sel);}
function enhanceAllSelects(root){(root||document).querySelectorAll('select').forEach(enhanceSelect);}
document.addEventListener('click',e=>{if(openCbx&&!e.target.closest('.cbx'))cbxClose();});
document.addEventListener('scroll',e=>{if(openCbx&&openCbx.contains(e.target))return;cbxClose();},true);
window.addEventListener('resize',()=>cbxClose());
enhanceAllSelects();
/* ==== i18n (mechanism reused from admin-console adjudication 31) ==== */
const I18N_ZH={
'Language':'语言','Style pack':'样式包','Toggle theme':'切换主题','Login':'登录','Magic link':'魔法链接','Register':'注册','Forgot':'忘记密码','Reset':'重置密码','Verify email':'验证邮箱','Enroll MFA':'绑定 MFA','Consent':'授权同意','Setup':'初始化向导',
'Sign in':'登录','Password sign-in · magic link · OIDC code consumption':'密码登录 · 魔法链接 · OIDC code 消费','Email':'邮箱','Password':'密码','Email me a magic link':'发送魔法链接','Create account':'创建账户','Forgot password?':'忘记密码？','Magic link email':'魔法链接邮箱','Send link':'发送链接','Magic link sent — check your inbox.':'魔法链接已发送 — 请查收邮件。','OIDC oauthCode (one-time)':'OIDC oauthCode（一次性）','Consume':'消费','redirect parameter (allowlist)':'redirect 参数（白名单）','Check':'校验','Signed in — continue to the console.':'已登录 — 继续进入控制台。','Open console':'打开控制台','Signed in':'已登录',
'Magic sign-in':'魔法链接登录','/login/magic — consumes the emailed token once':'/login/magic — 一次性消费邮件 token','Demo token state':'演示 token 状态','valid':'有效','suspended (AUTH_004)':'已暂停（AUTH_004）','invalid / consumed':'无效 / 已消费','Open magic link':'打开魔法链接','Signed in via magic link.':'已通过魔法链接登录。',
'Create account':'创建账户','Self-service registration · admin approval happens in Users, not here':'自助注册 · 管理员审批在 Users 面而非此处','Name':'姓名','Confirm password':'确认密码','Register':'注册','Back to sign in':'返回登录','Account created — verify your email.':'账户已创建 — 请验证邮箱。','Verify now':'立即验证','Policy: shared 12+ chars with upper, lower, digit and special (UserCreate precedent).':'策略：共享 12+ 字符，含大写、小写、数字与特殊字符（UserCreate 先例）。',
'Reset your password':'重置密码','Requests a reset link by email':'通过邮件请求重置链接','Send reset link':'发送重置链接','If the address exists, a reset link is on its way.':'若该地址存在，重置链接已在途中。',
'Choose a new password':'设置新密码','/reset-password?token= — the link token is consumed once':'/reset-password?token= — 链接 token 一次性消费','New password':'新密码','Update password':'更新密码','Password updated — sign in with the new password.':'密码已更新 — 用新密码登录。','Reset token present (demo).':'重置 token 存在（演示）。','Reset token consumed (demo).':'重置 token 已消费（演示）。',
'Verify your email':'验证邮箱','Consumes the verification token from the email link':'消费邮件链接中的验证 token','expired / consumed':'过期 / 已消费','Open verification link':'打开验证链接','Resend verification email':'重发验证邮件','Email verified.':'邮箱已验证。','Verification email resent':'验证邮件已重发',
'Set up two-factor authentication':'设置双因素认证','Enrollment token from the admin invite · TOTP':'来自管理员邀请的 enroll token · TOTP','otpauth URL (copyable)':'otpauth URL（可复制）','Copy URL':'复制 URL','Simulate dead token':'模拟失效 token','6-digit code':'6 位代码','Confirm':'确认','MFA enabled — recovery codes shown once.':'MFA 已启用 — 恢复码仅展示一次。','I have saved these recovery codes':'我已保存这些恢复码','Continue':'继续','MFA enrolled':'MFA 已绑定','Copied to clipboard':'已复制到剪贴板','Copy failed':'复制失败',
'Authorize client':'授权客户端','OIDC interaction consent · scopes are explicit choices':'OIDC 交互同意 · scope 为显式选择','Client:':'客户端：','redirect (allowlist)':'redirect（白名单）','Approve':'同意','Deny':'拒绝','Decision recorded — redirecting…':'决定已记录 — 跳转中…','Consent approved':'已同意授权','Consent denied':'已拒绝授权','Failed to load the interaction.':'加载交互失败。','Retry':'重试',
'First-run setup':'首次初始化','Four-step bootstrap wizard · guarded until complete':'四步引导向导 · 完成前持续守卫','1 Welcome':'1 欢迎','2 Administrator':'2 管理员','3 Configuration':'3 配置','4 Complete':'4 完成','Admin name':'管理员姓名','Admin email':'管理员邮箱','Site name':'站点名称','Site URL':'站点 URL','SMTP host (advanced)':'SMTP 主机（高级）','SMTP port (advanced)':'SMTP 端口（高级）','Back':'上一步','Next':'下一步','Finish':'完成','Setup complete — sign in with the administrator you created.':'初始化完成 — 用你创建的管理员登录。','Go to sign in':'去登录','Setup complete':'初始化完成',
'A valid email is required':'需要有效邮箱','Password is required':'密码必填','Name is required':'名称必填','Passwords do not match':'两次密码不一致','Site name is required':'站点名称必填','Working…':'处理中…','Signing in…':'登录中…','Sending…':'发送中…','Creating…':'创建中…','Updating…':'更新中…','Confirming…':'确认中…','Approving…':'同意中…','Denying…':'拒绝中…',
'AUTH_002: invalid credentials (prototype simulation) — retry.':'AUTH_002：凭据无效（原型模拟）— 重试。','Send failed: upstream timeout (prototype simulation) — retry':'发送失败：上游超时（原型模拟）— 重试','Create failed: upstream timeout (prototype simulation) — retry.':'创建失败：上游超时（原型模拟）— 重试。','Reset failed: token service timeout (prototype simulation) — retry.':'重置失败：token 服务超时（原型模拟）— 重试。','Confirm failed: upstream timeout (prototype simulation) — retry.':'确认失败：上游超时（原型模拟）— 重试。','Decision failed: upstream timeout (prototype simulation) — retry.':'决定失败：上游超时（原型模拟）— 重试。',
'AUTH_004: account suspended — contact an administrator.':'AUTH_004：账户已暂停 — 联系管理员。','Magic link invalid or already consumed.':'魔法链接无效或已消费。','Verification link expired or already consumed — request a new one.':'验证链接过期或已消费 — 请重新请求。','Enrollment link is dead — ask an administrator to re-issue it.':'Enroll 链接已失效 — 请管理员重发。','Enter the 6-digit code from your authenticator':'输入认证器中的 6 位代码','Wrong code — try again (token burns only at the attempt limit).':'代码错误 — 重试（token 仅在次数上限时烧毁）。','Redirect not allowed — only /oidc/auth/… or /oidc/device/… (open-redirect hygiene).':'redirect 不被允许 — 仅 /oidc/auth/… 或 /oidc/device/…（开放重定向 hygiene）。',
'Password needs 12+ chars with upper, lower, digit and special':'密码需 12+ 字符，含大写、小写、数字与特殊字符','Password needs an uppercase letter':'密码需大写字母','Password needs a lowercase letter':'密码需小写字母','Password needs a digit':'密码需数字','Password needs a special character':'密码需特殊字符','Password must be at least 8 characters (setup bootstrap policy)':'密码至少 8 字符（初始化 bootstrap 策略）',
'Welcome — this wizard creates the first administrator and base configuration. Nothing is stored until each step succeeds.':'欢迎 — 本向导创建首个管理员与基础配置。每步成功前不存储任何内容。',
'Setup bootstrap uses min 8 chars (real AdminStep.tsx:90) — deliberately different from console user-create 12+. The password is consumed by the API call and never stored in the wizard state.':'初始化 bootstrap 使用 min 8 字符（真实 AdminStep.tsx:90）— 与 console 创建用户 12+ 刻意不同。密码被 API 调用消费，绝不存入向导状态。',
'Wrong codes burn the enrollment token only at the attempt limit (real EnrollMfa.tsx:68); the demo keeps the token alive on wrong codes and offers an explicit dead-token branch.':'错误代码仅在次数上限时烧毁 enroll token（真实 EnrollMfa.tsx:68）；演示在错码时保留 token 并提供显式失效分支。',
'Only allowlisted /oidc/auth/… or /oidc/device/… redirects are honored (open-redirect hygiene, J13).':'仅白名单 /oidc/auth/… 或 /oidc/device/… 的 redirect 会被接受（开放重定向 hygiene，J13）。',
'A code is consumed once; a second POST 401s (code consumed) — the real refresh-interceptor logout pitfall (Login.tsx:92-98).':'code 一次性消费；二次 POST 401（code consumed）— 真实 refresh-interceptor 登出坑（Login.tsx:92-98）。',
'safeOidcRedirect accepts only /oidc/auth/… or /oidc/device/… and rejects backslash / %2F%2F (api/oidc.ts:53-63).':'safeOidcRedirect 仅接受 /oidc/auth/… 或 /oidc/device/…，拒绝反斜杠 / %2F%2F（api/oidc.ts:53-63）。',
};
const I18N_RULES=[
 [/^(\d+) users$/,'$1 个用户'],[/^(\d+) roles$/,'$1 个角色'],[/^(\d+) tenants$/,'$1 个租户'],[/^(\d+) groups$/,'$1 个用户组'],[/^(\d+) clients$/,'$1 个客户端'],[/^(\d+) keys$/,'$1 个密钥'],[/^(\d+) endpoints$/,'$1 个端点'],[/^(\d+) events$/,'$1 个事件'],[/^(\d+) entries$/,'$1 条记录'],[/^(\d+) perms$/,'$1 个权限'],
 [/^(\d+) perms · system$/,'$1 个权限 · 系统'],[/^(\d+) \/ 26 granted$/,'已授予 $1 / 26'],[/^(\d+)–(\d+) of (\d+)$/,'第 $1–$2 条，共 $3 条'],
 [/^(\d+) (m|h|d|w|mo) ago$/,function(m){return m[1]+' '+({m:'分钟',h:'小时',d:'天',w:'周',mo:'个月'})[m[2]]+'前';}],
 [/^(\d+) (minutes|hours|days|weeks|months) ago$/,function(m){return m[1]+' '+({minutes:'分钟',hours:'小时',days:'天',weeks:'周',months:'个月'})[m[2]]+'前';}],
 [/^from (.+)\? They lose every role and permission inherited from this group\.$/,'从 $1 移除？其将失去从该组继承的所有角色与权限。'],
 [/^Deliveries · (.+)$/,'投递记录 · $1'],[/^Edit template · (.+)$/,'编辑模板 · $1'],
];
let LANG='en';try{const st=localStorage.getItem('ab-lang');LANG=(st==='zh'||st==='en')?st:(navigator.language||'en').startsWith('zh')?'zh':'en';}catch(_){}
function tr(s){if(LANG!=='zh')return s;const hit=I18N_ZH[s];if(hit)return hit;for(const[re,rep]of I18N_RULES){const m=s.match(re);if(m)return typeof rep==='function'?rep(m):s.replace(re,rep);}return s;}
const I18N_ATTRS=['placeholder','aria-label','data-tip','title'];
function translateNode(root){
 if(!root)return;
 if(root.nodeType===3){const raw=root.textContent;const s=raw.trim();if(!s)return;const z=tr(s);if(LANG==='zh'){if(root.__i18nEn===undefined)root.__i18nEn=raw;if(z!==s)root.textContent=raw.replace(s,z);}else if(root.__i18nEn!==undefined){root.textContent=root.__i18nEn;delete root.__i18nEn;}return;}
 if(root.nodeType!==1&&root.nodeType!==9)return;
 if(root.nodeType===1){
  if(root.hasAttribute&&root.hasAttribute('data-i18n-skip'))return;
  if(root.__i18nEnAttrs===undefined&&LANG==='zh'){root.__i18nEnAttrs={};I18N_ATTRS.forEach(a=>{if(root.hasAttribute(a))root.__i18nEnAttrs[a]=root.getAttribute(a);});}
  I18N_ATTRS.forEach(a=>{if(!root.hasAttribute(a))return;const src=LANG==='zh'?(root.__i18nEnAttrs&&root.__i18nEnAttrs[a]!==undefined?root.__i18nEnAttrs[a]:root.getAttribute(a)):root.getAttribute(a);const z=tr(src);if(LANG==='zh'){if(z!==src)root.setAttribute(a,z);}else if(root.__i18nEnAttrs&&root.__i18nEnAttrs[a]!==undefined){root.setAttribute(a,root.__i18nEnAttrs[a]);}});
  if(LANG==='en'&&root.__i18nEnAttrs)delete root.__i18nEnAttrs;
 }
 for(const child of Array.from(root.childNodes))translateNode(child);
}
function updateLangBtn(){const b=$('langBtn');if(!b)return;b.textContent=LANG==='zh'?'EN':'中文';const lab=LANG==='zh'?'语言':'Language';b.setAttribute('aria-label',lab);b.setAttribute('data-tip',lab);b.__i18nEnAttrs={'aria-label':'Language','data-tip':'Language'};}
let i18nTimer=null;
new MutationObserver(()=>{if(LANG!=='zh')return;clearTimeout(i18nTimer);i18nTimer=setTimeout(()=>translateNode(document.body),30);}).observe(document.body,{childList:true,subtree:true,characterData:true});
function initLang(){document.documentElement.lang=LANG==='zh'?'zh-CN':'en';updateLangBtn();if(LANG==='zh')translateNode(document.body);}
$('langBtn').onclick=()=>{LANG=LANG==='zh'?'en':'zh';try{localStorage.setItem('ab-lang',LANG);}catch(_){}document.documentElement.lang=LANG==='zh'?'zh-CN':'en';updateLangBtn();translateNode(document.body);};
/* ==== body-level floating tooltip (post-closure fix) ====
   One fixed element outside every overflow/stacking ancestor; shown on hover AND focus of any
   [data-tip] host (disabled buttons keep their .tip-wrap host). Reads the attribute at show time so
   the zh pass applies. Flips below near the viewport top, clamps horizontally, hides on scroll/resize/
   Escape/leave/blur. aria-describedby links host -> tooltip while visible. */
const floatTip=document.createElement('div');floatTip.id='floatTip';floatTip.setAttribute('role','tooltip');document.body.appendChild(floatTip);
let tipHost=null;
function tipShow(host){const txt=host.getAttribute('data-tip');if(!txt)return;if(tipHost&&tipHost!==host)tipHost.removeAttribute('aria-describedby');tipHost=host;floatTip.textContent=txt;floatTip.classList.add('on');host.setAttribute('aria-describedby','floatTip');
 const r=host.getBoundingClientRect();const tw=floatTip.offsetWidth,th=floatTip.offsetHeight;
 let top=r.top-th-6;if(top<4)top=r.bottom+6;
 let left=r.left+r.width/2-tw/2;left=Math.max(4,Math.min(left,window.innerWidth-tw-4));
 floatTip.style.top=top+'px';floatTip.style.left=left+'px';}
function tipHide(){if(tipHost){tipHost.removeAttribute('aria-describedby');tipHost=null;}floatTip.classList.remove('on');}
document.addEventListener('mouseover',e=>{const h=e.target.closest('[data-tip]');if(h&&h!==tipHost)tipShow(h);});
document.addEventListener('mouseout',e=>{const h=e.target.closest('[data-tip]');if(h&&(!e.relatedTarget||!h.contains(e.relatedTarget))){if(document.activeElement===tipHost)return;tipHide();}});
document.addEventListener('focusin',e=>{const h=e.target.closest('[data-tip]');if(h)tipShow(h);});
document.addEventListener('focusout',e=>{const h=e.target.closest('[data-tip]');if(h)setTimeout(()=>{if(!document.activeElement||!document.activeElement.closest||!document.activeElement.closest('[data-tip]'))tipHide();},0);});
document.addEventListener('scroll',()=>{if(tipHost&&document.activeElement===tipHost)return;tipHide();},true);
window.addEventListener('resize',()=>tipHide());
document.addEventListener('keydown',e=>{if(e.key==='Escape')tipHide();});
enhanceAllSelects();
initLang();
