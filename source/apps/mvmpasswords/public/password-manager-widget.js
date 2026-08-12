(function(){
  if(window.MvmPasswordManagerWidget)return;
  var API='/pub/mvmpasswords';
  function t(k,v){return(window.t||function(x){return x})(k,v)}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function exportText(key){var bg=window.mvmOS&&window.mvmOS.lang==='bg';var strings={
    backup:bg?'Изнеси mvmPasswords backup':'Export mvmPasswords backup',
    csv:bg?'Изнеси CSV за друг мениджър':'Export CSV for another manager',
    backupConfirm:bg?'Backup файлът не е криптиран и съдържа пароли и passkeys. Пази го лично и го изтрий след внасянето. Продължи ли?':'The backup is unencrypted and contains passwords and passkeys. Keep it private and delete it after import. Continue?',
    csvConfirm:bg?'CSV файлът не е криптиран и съдържа пароли. Passkeys, папки и правила за съвпадение не могат да се пренесат в общ CSV. Продължи ли?':'The CSV is unencrypted and contains passwords. Passkeys, folders and matching rules cannot be carried by a generic CSV. Continue?'};return strings[key]}
  function b64(bytes){var s='';new Uint8Array(bytes).forEach(function(x){s+=String.fromCharCode(x)});return btoa(s)}
  function bytes(s){var bin=atob(s),out=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
  function host(url){try{return new URL(url.indexOf('://')<0?'https://'+url:url).hostname.replace(/^www\./,'').toLowerCase()}catch(_){return ''}}
  // One login often lives at several addresses — a production database and its
  // copy on localhost, a service and its admin panel. They share the password,
  // so they are one entry with a list of addresses rather than duplicates that
  // then drift apart when the password is changed on only one of them.
  //
  // The list is stored in the same `website` string, one address per line, so
  // an entry written before this existed is simply a list of one and no vault
  // needs converting. Every read goes through here.
  function websites(item){return String((item&&item.website)||'').split('\n').map(function(v){return v.trim()}).filter(Boolean)}
  function sameHost(current,item){var a=String(current||'').replace(/^www\./,'');return websites(item).some(function(site){var b=host(site);return b&&(a===b||a.endsWith('.'+b))})}
  function normalUrl(value){try{var u=new URL(String(value).indexOf('://')<0?'https://'+value:value),path=u.pathname.replace(/\/$/,'')||'/';return u.protocol.toLowerCase()+'//'+u.hostname.replace(/^www\./,'').toLowerCase()+path}catch(_){return ''}}
  // passkey-page.js wraps every ArrayBuffer in the WebAuthn options as
  // {__buf:'<base64url>'} so it survives postMessage. Nothing unwrapped it here,
  // so the challenge reached the credential builder as an object and atob threw
  // before a key was ever generated.
  function unwrapBufs(value){if(value==null||typeof value!=='object')return value;if(typeof value.__buf==='string')return value.__buf;if(Array.isArray(value))return value.map(unwrapBufs);var out={};Object.keys(value).forEach(function(k){out[k]=unwrapBufs(value[k])});return out}
  // ---- import: reading another manager's export ----------------------------
  // Every manager exports the same five fields under its own column names, so
  // the parser recognises columns by synonym rather than by product. That is
  // what lets a file from a manager nobody thought of still import cleanly.
  // Minimum length for a *new* master password. Only the creation screen
  // consults it; see unlockScreen for why unlocking must not.
  var MIN_MASTER=10;
  var IMPORT_FIELDS={
    name:['name','title','account','item','entry','display name','account name','login name'],
    website:['url','uri','website','site','login_uri','login uri','urls','web site','hostname','host','link','address','web address','login_url'],
    username:['username','user','login','login_username','login username','user name','email','e-mail','email address','account','user_name','userid','user id'],
    password:['password','pass','login_password','login password','pwd','passwd','secret'],
    notes:['notes','note','comment','comments','extra','description','memo','free text']
  };
  // The importer must never mistake a header for data, so a file whose first
  // row is not recognisable as a header is treated as unreadable rather than
  // imported with a password in the name column.
  function csvRows(text){
    var rows=[],row=[],field='',quoted=false,i=0;
    text=String(text).replace(/^﻿/,'');
    // A hand-written scanner, because splitting on commas corrupts any entry
    // whose notes contain a comma or a line break — which real exports do.
    for(;i<text.length;i++){
      var c=text[i];
      if(quoted){
        if(c==='"'){ if(text[i+1]==='"'){field+='"';i++} else quoted=false }
        else field+=c;
      } else if(c==='"'){ quoted=true }
      else if(c===','||c===';'||c==='\t'){ row.push(field);field='' }
      else if(c==='\n'||c==='\r'){
        if(c==='\r'&&text[i+1]==='\n')i++;
        row.push(field);field='';
        if(row.length>1||row[0]!=='')rows.push(row);
        row=[];
      } else field+=c;
    }
    row.push(field);
    if(row.length>1||row[0]!=='')rows.push(row);
    return rows;
  }
  function headerMap(header){
    var map={},used={};
    header.forEach(function(raw,index){
      var name=String(raw||'').trim().toLowerCase().replace(/^"|"$/g,'');
      Object.keys(IMPORT_FIELDS).forEach(function(field){
        if(map[field]!==undefined||used[index])return;
        if(IMPORT_FIELDS[field].indexOf(name)>=0){map[field]=index;used[index]=true}
      });
    });
    return map;
  }
  function pickUrl(value){
    // Bitwarden and Chrome can both list several addresses for one login; the
    // vault stores one, and the first is the one the user actually signs in on.
    if(Array.isArray(value))return pickUrl(value[0]);
    if(value&&typeof value==='object')return String(value.uri||value.url||value.href||'');
    return String(value==null?'':value).split(/[\n,]/)[0].trim();
  }
  function fromCsv(text){
    var rows=csvRows(text);
    if(rows.length<2)return null;
    var map=headerMap(rows[0]);
    // A password column alone is not enough: without something to identify the
    // login by, an imported vault is a list of anonymous secrets.
    if(map.password===undefined||(map.name===undefined&&map.website===undefined&&map.username===undefined))return null;
    return rows.slice(1).map(function(row){
      function at(field){return map[field]===undefined?'':String(row[map[field]]==null?'':row[map[field]]).trim()}
      return {name:at('name'),website:pickUrl(at('website')),username:at('username'),password:at('password'),notes:at('notes')};
    });
  }
  function fromJson(text){
    var data;
    try{data=JSON.parse(text)}catch(_){return null}
    // This is our own portable vault format. It is deliberately plaintext: the
    // receiving vault encrypts every record with its own master password.
    if(data&&data.format==='mvmpasswords-backup'&&data.version===1&&Array.isArray(data.entries)){
      var backupFolders=Array.isArray(data.folders)?data.folders.map(function(folder){
        return folder&&typeof folder.id==='string'&&typeof folder.name==='string'?
          {id:folder.id,name:folder.name}:null;
      }).filter(Boolean):[];
      var backupEntries=data.entries.map(function(item){
        if(!item||typeof item!=='object')return null;
        var entry=Object.assign({},item);
        // An mvm2factor account belongs to a different app and profile. Never
        // carry that opaque reference into another vault.
        delete entry.id;delete entry.totp_id;
        entry.name=String(entry.name||'').trim();
        entry.website=String(entry.website||'');
        entry.username=String(entry.username||'');
        entry.password=String(entry.password||'');
        entry.notes=String(entry.notes||'');
        if(['default','domain','exact','regex'].indexOf(entry.match_mode)<0)entry.match_mode='default';
        if(typeof entry.folder_id!=='string')delete entry.folder_id;
        return entry;
      }).filter(function(entry){return entry&&entry.name&&(entry.password||entry.username||entry.passkey)});
      return {kind:'mvmpasswords-backup',folders:backupFolders,entries:backupEntries};
    }
    // A Bitwarden export made with a password is itself ciphertext; importing
    // it would silently store unusable rows, so it is reported, not parsed.
    if(data&&data.encrypted===true)return 'encrypted';
    var items=Array.isArray(data)?data:(data&&(data.items||data.logins||data.entries||data.accounts));
    if(!Array.isArray(items))return null;
    var out=items.map(function(item){
      if(!item||typeof item!=='object')return null;
      var login=(item.login&&typeof item.login==='object')?item.login:item;
      function pick(field){
        var names=IMPORT_FIELDS[field];
        for(var source=0;source<2;source++){
          var target=source?item:login;
          for(var i=0;i<names.length;i++){
            var keys=Object.keys(target);
            for(var k=0;k<keys.length;k++){
              if(keys[k].toLowerCase().replace(/_/g,' ')===names[i]){
                var value=target[keys[k]];
                if(value!=null&&value!=='')return value;
              }
            }
          }
        }
        return '';
      }
      var website=pickUrl(login.uris||login.uri||pick('website'));
      return {name:String(item.name||pick('name')||'').trim(),website:website,
        username:String(pick('username')||'').trim(),password:String(pick('password')||''),
        notes:String(item.notes||pick('notes')||'')};
    }).filter(Boolean);
    return out.length?out:null;
  }
  function parseImport(text,filename){
    var trimmed=String(text||'').trim();
    if(!trimmed)return null;
    var json=/\.json$/i.test(filename||'')||trimmed[0]==='{'||trimmed[0]==='[';
    // Extension and content can disagree — a .txt holding JSON, a .json that is
    // really CSV — so a failed first guess falls through to the other parser.
    var parsed=json?fromJson(trimmed):fromCsv(trimmed);
    if(parsed==='encrypted')return 'encrypted';
    if(!parsed)parsed=json?fromCsv(trimmed):fromJson(trimmed);
    if(parsed==='encrypted')return 'encrypted';
    if(!parsed)return null;
    // A row with no password and no username carries nothing worth storing;
    // secure notes and folder markers in an export land here.
    if(parsed.kind==='mvmpasswords-backup')return parsed;
    return parsed.filter(function(x){return x&&(x.password||x.username)});
  }
  window.MvmPasswordManagerImport={parse:parseImport,csvRows:csvRows};

  var styled=false;
  // Note for editors: this is one single-quoted string, so no comment or line
  // break may go inside it — put the reasoning here instead.
  //
  // Two rules in it exist because the popup is a fixed-height window that the
  // dialog can outgrow now that an entry holds an unbounded list of addresses:
  // .pm-dialog .pm-actions is sticky, so Save/Cancel/Delete stay reachable
  // instead of being pushed off the bottom, and .pm-web-list scrolls on its own
  // so the fields under it stay visible. .pm is position:relative because the
  // overlay is absolute and would otherwise anchor to an ancestor outside the
  // widget, which is what let the dialog overflow the popup in the first place.
  function style(){if(styled)return;styled=true;var s=document.createElement('style');s.textContent='.pm,.pm *,.pm-overlay,.pm-overlay *{box-sizing:border-box}.pm{height:100%;display:flex;flex-direction:column;position:relative;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);font-family:system-ui,sans-serif;overflow:hidden}.pm-bar{display:flex;gap:.5rem;align-items:center;padding:.7rem .8rem;border-bottom:1px solid var(--pub-border,#45475a);flex-wrap:wrap}.pm-bar-head{width:100%;display:flex;align-items:center;gap:.5rem;min-width:0}.pm-bar-tools{width:100%;display:flex;align-items:center;gap:.4rem;min-width:0}.pm-title{font-weight:700;font-size:.9rem}.pm-search{flex:1;min-width:8rem}.pm-list{overflow:auto;flex:1;min-height:0;padding:.75rem}.pm-card{border:1px solid var(--pub-border,#45475a);background:var(--pub-surface2,#313244);border-radius:.65rem;padding:.75rem;margin-bottom:.55rem}.pm-head{display:flex;gap:.6rem;align-items:center}.pm-avatar{width:2rem;height:2rem;border-radius:.5rem;display:grid;place-items:center;background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);font-weight:800}.pm-name{font-weight:700}.pm-sub{font-size:.76rem;color:var(--pub-dim,#a6adc8);margin-top:.1rem;overflow-wrap:anywhere}.pm-actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.8rem}.pm-card .pm-actions{gap:.35rem;flex-wrap:nowrap}.pm-icon-btn{flex:0 0 auto;padding:.42rem 0;width:2.35rem;min-width:2.35rem;font-size:1rem;line-height:1.15;text-align:center}.pm-card .pm-actions .pm-icon-btn{flex:1 1 0;min-width:0}.pm-icon-btn.pm-danger:hover{border-color:var(--pub-red,#f38ba8)}.pm-icon-btn.pm-copied{border-color:var(--pub-green,#a6e3a1)}.pm-bar-tools .pm-search{flex:1 1 auto;min-width:0}.pm-bar-tools button{flex:0 0 auto;padding:.42rem 0;width:2.35rem;min-width:2.35rem;font-size:1rem;line-height:1.15;text-align:center}.pm button,.pm-btn,.pm-overlay button{border:0;border-radius:.45rem;padding:.48rem .75rem;cursor:pointer;font:inherit;font-size:.8rem;font-weight:600;background:var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4);transition:filter .15s,transform .15s}.pm button:hover,.pm-overlay button:hover{filter:brightness(1.12)}.pm button:active,.pm-overlay button:active{transform:translateY(1px)}.pm .primary,.pm-overlay .primary{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e)}.pm input,.pm textarea,.pm select,.pm-overlay input,.pm-overlay textarea,.pm-overlay select{width:100%;background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);border-radius:.45rem;color:var(--pub-fg,#cdd6f4);padding:.6rem .7rem;font:inherit;outline:none;transition:border-color .15s,box-shadow .15s}.pm input:focus,.pm textarea:focus,.pm select:focus,.pm-overlay input:focus,.pm-overlay textarea:focus,.pm-overlay select:focus{border-color:var(--pub-accent,#89b4fa);box-shadow:0 0 0 3px color-mix(in srgb,var(--pub-accent,#89b4fa) 18%,transparent)}.pm-duration{margin:.3rem 0 .25rem}.pm-duration-hint{font-size:.72rem;opacity:.75;margin:0 0 .7rem;line-height:1.35}.pm-empty,.pm-unlock{display:flex;flex:1;align-items:center;justify-content:center;text-align:center;padding:1.5rem;color:var(--pub-fg2,#a6adc8)}.pm-unlock>div{width:100%;max-width:23rem;background:var(--pub-surface2,#313244);padding:1.25rem;border-radius:.7rem}.pm-unlock h2{font-size:1.05rem;color:var(--pub-fg,#cdd6f4)}.pm-unlock p{font-size:.82rem;line-height:1.45}.pm-unlock input{margin:.35rem 0}.pm-error{min-height:1.3rem;color:var(--pub-red,#f38ba8);font-size:.8rem}.pm-overlay{position:absolute;inset:0;background:rgba(0,0,0,.64);z-index:5;display:flex;align-items:center;justify-content:center;padding:1rem;overflow:auto;color:var(--pub-fg,#cdd6f4);font-family:system-ui,sans-serif}.pm-dialog{width:100%;max-width:27rem;max-height:100%;min-height:0;overflow:auto;flex:0 1 auto;background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);border-radius:.75rem;padding:1.2rem;box-shadow:0 1.2rem 3rem rgba(0,0,0,.45)}.pm-dialog .pm-actions{position:sticky;bottom:calc(-1.2rem - 1px);margin:.8rem -1.2rem -1.2rem;padding:.8rem 1.2rem;background:var(--pub-bg,#1e1e2e);border-top:1px solid var(--pub-border,#45475a)}.pm-dialog h3{margin:0 0 .35rem;font-size:1.05rem;color:var(--pub-fg,#cdd6f4)}.pm-dialog label{display:block;font-size:.76rem;font-weight:700;color:var(--pub-fg2,#a6adc8);margin:.72rem 0 .28rem}.pm-dialog textarea{resize:vertical;min-height:5.25rem}.pm-context{font-size:.72rem;color:var(--pub-dim,#a6adc8);width:100%}.pm-match-badge{display:inline-flex;align-items:center;gap:.25rem;margin-left:.4rem;padding:.12rem .36rem;border-radius:.6rem;background:color-mix(in srgb,var(--pub-accent,#89b4fa) 20%,transparent);color:var(--pub-accent,#89b4fa);font-size:.65rem;vertical-align:middle}.pm-match-badge img{width:.78rem;height:.78rem;border-radius:.18rem}.pm-passkey-badge{display:inline-flex;align-items:center;gap:.2rem;margin-left:.4rem;padding:.12rem .36rem;border-radius:.6rem;background:color-mix(in srgb,var(--pub-green,#a6e3a1) 22%,transparent);color:var(--pub-green,#a6e3a1);font-size:.65rem;white-space:nowrap;vertical-align:middle}.pm-passkey-row{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}.pm-passkey-info{flex:1;min-width:8rem;font-size:.8rem;overflow-wrap:anywhere}.pm-show-all{width:100%;margin:.15rem 0 .8rem}.pm-import-info{font-size:.8rem;opacity:.85;margin:.1rem 0 .7rem;line-height:1.45}.pm-import-drop{text-align:center;padding:.9rem;border:1px dashed var(--pub-border,#45475a);border-radius:.5rem;margin-bottom:.6rem}.pm-import-formats{font-size:.72rem;opacity:.7;margin-top:.45rem}.pm-import-status{font-size:.82rem;margin-bottom:.5rem}.pm-import-note{opacity:.8;font-size:.76rem;margin-top:.2rem}.pm-import-bulk{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem}.pm-import-bulk button{padding:.3rem .55rem;font-size:.74rem}.pm-import-list{max-height:min(46vh,20rem);overflow:auto;margin-bottom:.5rem}.pm-import-row{display:flex;flex-wrap:wrap;align-items:center;gap:.45rem;padding:.35rem .2rem;border-bottom:1px solid var(--pub-border,#45475a);font-size:.8rem}.pm-import-row input{flex:0 0 auto;margin:0}.pm-import-name{flex:1;min-width:6rem;overflow-wrap:anywhere}.pm-import-sub{opacity:.7;font-size:.74rem;overflow-wrap:anywhere}.pm-import-dupe{flex:0 0 auto;white-space:nowrap;font-size:.68rem;padding:.1rem .4rem;border-radius:.6rem;background:var(--pub-border,#45475a);opacity:.9}.pm-menu{position:absolute;top:3.4rem;right:.8rem;z-index:6;display:flex;flex-direction:column;gap:.3rem;background:var(--pub-surface2,#313244);border:1px solid var(--pub-border,#45475a);border-radius:.6rem;padding:.4rem;box-shadow:0 .6rem 1.6rem rgba(0,0,0,.35);min-width:9rem}.pm-menu[hidden]{display:none}.pm-menu button{text-align:left;width:100%}.pm-head-click{cursor:pointer}.pm-icon-spacer{visibility:hidden;pointer-events:none}.pm-list-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:.55rem;align-content:start}.pm-list-grid .pm-card{margin-bottom:0}.pm-list-grid .pm-show-all,.pm-list-grid .pm-folder-clear,.pm-list-grid .pm-folder-others{grid-column:1/-1}.pm-view-value{background:var(--pub-surface2,#313244);border:1px solid var(--pub-border,#45475a);border-radius:.45rem;padding:.6rem .7rem;font-size:.85rem;overflow-wrap:anywhere;min-height:1.3rem;color:var(--pub-fg,#cdd6f4)}.pm-view-notes{white-space:pre-wrap}.pm-dialog .pm-actions .pm-danger{background:var(--pub-red,#f38ba8);color:var(--pub-bg,#1e1e2e);margin-left:auto}.pm-web-row{display:flex;gap:.4rem;align-items:center;margin-bottom:.35rem}.pm-web-row .f-web{flex:1;min-width:0}.pm-web-del{flex:0 0 auto;padding:.5rem .6rem;line-height:1}.pm-web-del:hover{border-color:var(--pub-red,#f38ba8);color:var(--pub-red,#f38ba8)}.pm-web-add{width:100%;margin-top:.1rem}.pm-web-list{max-height:11rem;overflow-y:auto}.pm-password-field{display:flex;gap:.45rem;align-items:center}.pm-password-field>:first-child{flex:1;min-width:0}.pm-password-field .f-toggle,.pm-password-field .f-genpass,.pm-password-field .g-reroll{flex:0 0 auto;width:2.35rem;height:2.35rem;padding:0;font-size:1rem;display:inline-flex;align-items:center;justify-content:center;line-height:1}.pm-password-field .g-reroll:disabled{opacity:.5;cursor:default}.pm-gen-check{display:flex!important;align-items:center;gap:.45rem;font-weight:400!important;color:var(--pub-fg,#cdd6f4)!important;cursor:pointer}.pm-gen-check input{width:auto!important;flex:0 0 auto}.pm-view-value+.pm-view-value{margin-top:.3rem}.pm-folders{width:100%;display:flex;align-items:center;gap:.3rem;min-width:0;position:relative}.pm-folders[hidden]{display:none}.pm-folder-row{display:flex;gap:.3rem;overflow:hidden;flex:1 1 auto;min-width:0}.pm .pm-folder-tab{flex:0 0 auto;padding:.3rem .62rem;font-size:.74rem;border-radius:.9rem;background:var(--pub-surface2,#313244);border:1px solid var(--pub-border,#45475a);white-space:nowrap;max-width:11rem;overflow:hidden;text-overflow:ellipsis}.pm-folder-tab[hidden]{display:none}.pm .pm-folder-tab.active{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);border-color:var(--pub-accent,#89b4fa)}.pm .pm-folder-more{flex:0 0 auto;padding:.3rem .5rem;font-size:.74rem;border-radius:.9rem;background:var(--pub-surface2,#313244);border:1px solid var(--pub-border,#45475a)}.pm-folder-more[hidden]{display:none}.pm-folder-menu{position:absolute;top:calc(100% + .3rem);right:0;z-index:7;display:flex;flex-direction:column;gap:.25rem;background:var(--pub-surface2,#313244);border:1px solid var(--pub-border,#45475a);border-radius:.6rem;padding:.35rem;box-shadow:0 .6rem 1.6rem rgba(0,0,0,.35);min-width:9rem;max-width:14rem;max-height:14rem;overflow:auto}.pm-folder-menu[hidden]{display:none}.pm .pm-folder-menu button{width:100%;max-width:none;text-align:left;border-radius:.45rem;overflow:hidden;text-overflow:ellipsis}.pm-folder-edit{display:flex;gap:.4rem;align-items:center;margin-bottom:.45rem}.pm-folder-edit input{flex:1;min-width:0}.pm-folder-edit button{flex:0 0 auto;padding:.5rem .6rem;line-height:1}.pm-folder-edit .pm-danger:hover{border-color:var(--pub-red,#f38ba8);color:var(--pub-red,#f38ba8)}.pm-folder-list{max-height:min(40vh,16rem);overflow:auto}.pm-folder-empty{font-size:.8rem;opacity:.75;padding:.3rem 0 .5rem}.pm-folder-clear,.pm-folder-others{width:100%;margin:.15rem 0 .8rem}.pm-audit-h{font-size:.8rem;margin:.9rem 0 .4rem;color:var(--pub-fg2,#a6adc8)}.pm-audit-h:first-child{margin-top:0}.pm-audit-group{display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.5rem;padding:.5rem;border:1px solid var(--pub-red,#f38ba8);border-radius:.5rem}.pm-audit-chip{font-size:.76rem;padding:.15rem .5rem;border-radius:.8rem;background:var(--pub-surface2,#313244)}.pm-audit-row{display:flex;justify-content:space-between;align-items:center;padding:.4rem 0;border-bottom:1px solid var(--pub-border,#45475a);font-size:.82rem}.pm-audit-badge{font-size:.68rem;padding:.12rem .5rem;border-radius:.7rem;font-weight:700}.pm-audit-weak{background:color-mix(in srgb,var(--pub-red,#f38ba8) 25%,transparent);color:var(--pub-red,#f38ba8)}.pm-audit-fair{background:color-mix(in srgb,#f9e2af 25%,transparent);color:#f9e2af}.pm-audit-strong{background:color-mix(in srgb,var(--pub-green,#a6e3a1) 25%,transparent);color:var(--pub-green,#a6e3a1)}.pm-audit-ok{font-size:.85rem;line-height:1.5;text-align:center;padding:.5rem 0}';document.head.appendChild(s)}
  function mount(root,opts){
    opts=opts||{};style();var token=localStorage.getItem('apphub_token');if(!token){root.innerHTML='<div class="pm-empty">'+esc(t('pm_login'))+'</div>';if(opts.onNeedLogin)opts.onNeedLogin();return{destroy:function(){}}}
    var SESSION_KEY='mvm_pm_vault_session',DURATION_KEY='mvm_pm_unlock_duration';
    var key=null,entries=[],folders=[],context=null,extensionSettings={},showAll=false,otherFolders=false,parentOrigin='',destroyed=false,autoLockTimer=0,APP_ID='mvmpasswords',passkeyBusy=false,outsideClickHandler=null,folderObserver=null;
    // Which folder the tabs are filtering by, remembered across reloads because
    // it is a place in the vault rather than a transient view: someone who works
    // out of "Work" all morning should not have to pick it again after every
    // refresh. '' is the All tab and UNFILED the pseudo-folder for entries that
    // belong to none — a sentinel rather than a real id, so it can never collide
    // with one. FOLDER_ORDER_KEY holds the tab order, most recently used first;
    // see folderTabs() for why that is what keeps the useful ones on screen.
    var FOLDER_KEY='mvm_pm_folder',FOLDER_ORDER_KEY='mvm_pm_folder_order',UNFILED='~none';
    var folder=localStorage.getItem(FOLDER_KEY)||'';
    // Whether this server offers the 2FA integration — one flag, answered by the
    // server and never decided here. It is on only when the administrator has
    // enabled it in the app's settings *and* the installation is licensed, and
    // those are both facts about the machine, not about whoever is looking at
    // the vault. A visitor cannot turn it on, and flipping this in a console
    // unlocks nothing: an unlicensed install was never sent the code that talks
    // to mvm2factor, so the routes simply answer that it is unavailable.
    // `totpAccounts` is the account list, fetched lazily when a picker opens.
    var totpOn=false,totpAccounts=null,auditOn=false;
    function totpReady(){return totpOn}
    // The password check has no such flag on purpose. Whether its button is
    // drawn is a question about the surface, not the licence — see renderShell
    // — and whether it runs is answered by GET /audit.js at the moment of the
    // click, which either carries the code or 404s.
    // The dialog overlay is absolutely positioned against this element, so its
    // height is the only thing standing between a dialog and the visible area.
    // A host that sizes the mount by content — an extension popup, an embed —
    // would otherwise let root grow past the window, and inset:0 would stretch
    // the overlay along with it, putting the action buttons below the fold with
    // no viewport left to scroll them back. Pinning it to the host's own height
    // here makes that impossible regardless of the page's stylesheet.
    root.style.position='relative';

    function api(path,options){options=options||{};var h=Object.assign({'X-Pub-Token':token,'Content-Type':'application/json'},options.headers||{});return fetch(API+path,Object.assign({},options,{headers:h})).then(async function(r){var d=await r.json().catch(function(){return{}});if(r.status===401&&opts.onNeedLogin)opts.onNeedLogin();if(!r.ok)throw new Error(d.error||'error');return d})}
    async function derive(password,salt,iterations){var raw=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(salt),iterations:iterations,hash:'SHA-256'},raw,{name:'AES-GCM',length:256},true,['encrypt','decrypt'])}
    async function importKey(raw){return crypto.subtle.importKey('raw',bytes(raw),{name:'AES-GCM'},true,['encrypt','decrypt'])}
    function minutesOf(value){return value==='session'?0:Number(value)||0}
    function expiry(minutes){return minutes?Date.now()+minutes*60000:0}
    function scheduleAutoLock(expires){clearTimeout(autoLockTimer);if(!expires)return;var remaining=expires-Date.now();if(remaining<=0){lockNow();return}autoLockTimer=setTimeout(lockNow,remaining)}
    // A chosen number of hours is meant to outlive the page being closed — that
    // is the entire point of picking 24 hours on a phone, where a home-screen
    // shortcut starts a brand new session on every launch and sessionStorage is
    // empty before the first frame. So a timed unlock goes to localStorage, and
    // only "until the session closes" stays in sessionStorage, where shutting
    // the tab is what ends it.
    //
    // The cost is stated plainly rather than hidden: the raw key then sits in
    // the browser profile until it expires, so anyone holding the unlocked
    // device can read it. That is what every "keep me unlocked" switch means,
    // and why the choice is the user's and defaults to the shortest one.
    function sessionStore(minutes){return minutes?localStorage:sessionStorage}
    function saveSession(saved){
      if(parentOrigin){window.parent.postMessage({source:'mvmos-public-app',appId:APP_ID,action:'vault-session-save',session:saved},parentOrigin);return}
      // Written to one store and cleared from the other, so switching duration
      // can never leave a second, longer-lived copy of the key behind.
      sessionStorage.removeItem(SESSION_KEY);localStorage.removeItem(SESSION_KEY);
      try{sessionStore(saved.minutes).setItem(SESSION_KEY,JSON.stringify(saved))}catch(_){}
    }
    // Opening the vault pushes the deadline out again. Used daily it never asks
    // for the master password; forgotten for longer than the chosen span it
    // locks itself exactly as before. The span travels with the key because it
    // is what the clock is restarted from.
    function renewSession(saved){if(!saved||!saved.minutes)return saved;saved.expires=expiry(saved.minutes);saveSession(saved);return saved}
    async function cacheKey(value){var minutes=minutesOf(value),saved={key:b64(await crypto.subtle.exportKey('raw',key)),expires:expiry(minutes),minutes:minutes};scheduleAutoLock(saved.expires);localStorage.setItem(DURATION_KEY,value);saveSession(saved)}
    function readSession(){
      var found=null;
      [localStorage,sessionStorage].forEach(function(where){
        if(found)return;
        var raw=null;
        try{raw=JSON.parse(where.getItem(SESSION_KEY)||'null')}catch(_){}
        if(raw&&(!raw.expires||raw.expires>Date.now()))found=raw;else if(raw)where.removeItem(SESSION_KEY);
      });
      return found;
    }
    async function restoreLocalKey(){var saved=readSession();if(!saved)return false;try{key=await importKey(saved.key);scheduleAutoLock(renewSession(saved).expires);return true}catch(_){sessionStorage.removeItem(SESSION_KEY);localStorage.removeItem(SESSION_KEY);return false}}
    // Returning to a page that was left in the background counts as opening it.
    // A home-screen app on iOS is resumed rather than reloaded, so the renewal in
    // restoreLocalKey() would never run again and a vault opened every day would
    // still lock itself mid-week. Inside the extension this finds nothing and
    // does nothing — there the key lives in the extension's own storage and the
    // popup is a new document on every open, which renews it anyway.
    function onVisible(){if(document.hidden||!key)return;var saved=readSession();if(saved)scheduleAutoLock(renewSession(saved).expires)}
    function clearCachedKey(){sessionStorage.removeItem(SESSION_KEY);localStorage.removeItem(SESSION_KEY);if(parentOrigin)window.parent.postMessage({source:'mvmos-public-app',appId:APP_ID,action:'vault-session-clear'},parentOrigin)}
    function lockNow(){clearTimeout(autoLockTimer);autoLockTimer=0;key=null;entries=[];folders=[];clearCachedKey();load()}
    async function encrypt(value){var iv=crypto.getRandomValues(new Uint8Array(12));var data=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},key,new TextEncoder().encode(JSON.stringify(value)));return{iv:b64(iv),ciphertext:b64(data)}}
    async function decrypt(row){var out=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(row.iv)},key,bytes(row.ciphertext));var item=JSON.parse(new TextDecoder().decode(out));item.id=row.id;return item}
    function withoutId(item){var out=Object.assign({},item);delete out.id;return out}
    // Both calls below reach mvm2factor through the Apps Hub app-to-app API, and
    // both are triggered by a click and nothing else. Fetching a code while the
    // list renders would add a cross-app round trip to every vault open and hand
    // out digits that expire within seconds of being drawn; the account list is
    // cheaper but just as pointless until a picker is actually on screen.
    async function totpFetchAccounts(){if(totpAccounts)return totpAccounts;
      var data=await api('/totp/accounts');totpAccounts=data.accounts||[];return totpAccounts}
    async function totpFetchCode(accountId){return api('/totp/code/'+encodeURIComponent(accountId))}
    async function loadEntries(){var data=await api('/vault');var out=[];for(var i=0;i<(data.entries||[]).length;i++)out.push(await decrypt(data.entries[i]));entries=out;return out}
    async function saveEntry(id,value){var encrypted=await encrypt(value);return id?api('/entries/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify(encrypted)}):api('/entries',{method:'POST',body:JSON.stringify(encrypted)})}

    // ---- folders ----------------------------------------------------------
    // A folder is a name and nothing else, encrypted with the same key as the
    // logins — the server stores it as one more opaque blob and can no more read
    // "Banking" than it can read what is inside it. Which folder an entry is in
    // travels inside that entry's own ciphertext as `folder_id`, so the server
    // cannot even count the members of a folder, and an existing vault needs no
    // conversion: an entry written before folders existed simply has no field.
    async function saveFolder(id,name){var encrypted=await encrypt({name:name});return id?api('/folders/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify(encrypted)}):api('/folders',{method:'POST',body:JSON.stringify(encrypted)})}
    function download(filename,text,type){var blob=new Blob([text],{type:type}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url)},0)}
    function backupEntry(item){var out=withoutId(item);delete out.totp_id;return out}
    function exportBackup(){
      if(!confirm(exportText('backupConfirm')))return;
      download('mvmpasswords-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({format:'mvmpasswords-backup',version:1,exported_at:new Date().toISOString(),folders:folders.map(function(folder){return{id:folder.id,name:folder.name}}),entries:entries.map(backupEntry)},null,2),'application/json');
    }
    function csvValue(value){return '"'+String(value==null?'':value).replace(/"/g,'""')+'"'}
    function exportCsv(){
      if(!confirm(exportText('csvConfirm')))return;
      var lines=['name,url,username,password,notes'];
      entries.forEach(function(item){lines.push([item.name,item.website,item.username,item.password,item.notes].map(csvValue).join(','))});
      download('mvmpasswords-export-'+new Date().toISOString().slice(0,10)+'.csv',lines.join('\r\n')+'\r\n','text/csv;charset=utf-8');
    }
    function folderName(id){var found=folders.find(function(x){return x.id===id});return found?found.name:''}
    // The folder an entry counts as being in. A `folder_id` pointing at a folder
    // that is gone reads as unfiled rather than as a filter nothing can select,
    // so a delete interrupted halfway leaves the vault untidy, never unusable.
    function entryFolder(x){var id=x&&x.folder_id;return id&&folders.some(function(f){return f.id===id})?id:''}
    function folderOrder(){try{var saved=JSON.parse(localStorage.getItem(FOLDER_ORDER_KEY)||'[]');return Array.isArray(saved)?saved:[]}catch(_){return[]}}
    // Using a folder moves it to the front of the row. That is what makes the
    // overflow safe to hide: the tabs that fall off the end are by definition the
    // ones this profile reaches for least, and picking one out of the ⋯ menu
    // brings it back into view for next time.
    function touchFolder(id){if(!id||id===UNFILED)return;var order=folderOrder().filter(function(x){return x!==id});order.unshift(id);localStorage.setItem(FOLDER_ORDER_KEY,JSON.stringify(order.slice(0,60)))}
    function forgetFolder(id){localStorage.setItem(FOLDER_ORDER_KEY,JSON.stringify(folderOrder().filter(function(x){return x!==id})))}
    // All is pinned first and never rotates — it is the way back, and a way back
    // that moves is not one. "No folder" is pinned last for the mirror-image
    // reason: it is the leftovers, not a folder anyone organised anything into,
    // so rotating it to the front would push a real folder out of view to make
    // room for the pile the folders exist to empty. Only the real folders in
    // between are ordered by last use, with the never-used ones keeping their
    // alphabetical order behind those that were.
    function folderTabs(){
      var order=folderOrder();
      var items=folders.map(function(f){return{id:f.id,name:f.name}});
      items.sort(function(a,b){var ia=order.indexOf(a.id),ib=order.indexOf(b.id);
        if(ia<0&&ib<0)return 0;
        if(ia<0)return 1;
        if(ib<0)return -1;
        return ia-ib});
      // Only worth a tab once something is actually outside every folder.
      if(entries.some(function(x){return !entryFolder(x)}))items.push({id:UNFILED,name:t('pm_folder_none')});
      return[{id:'',name:t('pm_folder_all')}].concat(items);
    }
    function pickFolder(id){
      folder=id;
      if(id)localStorage.setItem(FOLDER_KEY,id);else localStorage.removeItem(FOLDER_KEY);
      touchFolder(id);
      // Switching folders starts the question over, so both wideners are dropped:
      // the page filter comes back, and the other folders go back into hiding —
      // otherwise the new folder would open already widened by a choice made
      // about the old one.
      showAll=false;otherFolders=false;
      var menu=root.querySelector('.pm-folder-menu');if(menu)menu.hidden=true;
      renderFolders();renderList();
    }
    // Hides the tabs that do not fit on one line and hands them to the ⋯ button.
    // Measured with the button already on screen, so the row is asked whether the
    // tabs fit in the width it will actually have rather than the width it has
    // while pretending the button is not there.
    function layoutFolders(){
      var wrap=root.querySelector('.pm-folders');if(!wrap||wrap.hidden)return;
      var row=wrap.querySelector('.pm-folder-row'),more=wrap.querySelector('.pm-folder-more');
      var tabs=Array.prototype.slice.call(row.children);
      tabs.forEach(function(el){el.hidden=false});
      more.hidden=false;
      var width=row.clientWidth;
      // Not laid out yet (a display:none ancestor, a popup still opening). Leaving
      // every tab visible is the harmless state: the row simply clips.
      if(!width||!tabs.length){more.hidden=true;return}
      // Every position is read before a single tab is hidden. Hiding one inside
      // the measuring loop would pull the rest leftwards, so a later tab could
      // then "fit" in the space a hidden earlier one left behind — and the row
      // would show tab 5 while tab 4 sat in the ⋯ menu, out of the order the
      // whole most-recently-used arrangement exists to express.
      var left=row.getBoundingClientRect().left;
      var rights=tabs.map(function(el){return el.getBoundingClientRect().right-left});
      var cut=-1;
      for(var i=0;i<tabs.length;i++){if(rights[i]>width+0.5){cut=i;break}}
      if(cut<0){more.hidden=true;return}
      for(var j=cut;j<tabs.length;j++)tabs[j].hidden=true;
    }
    function renderFolders(){
      var wrap=root.querySelector('.pm-folders');if(!wrap)return;
      // One row of tabs over an empty set of folders is a control that filters
      // nothing, so it stays out of the way until there is a folder to pick.
      wrap.hidden=!folders.length;
      if(wrap.hidden)return;
      var row=wrap.querySelector('.pm-folder-row');
      row.innerHTML=folderTabs().map(function(f){
        return'<button class="pm-folder-tab'+(f.id===folder?' active':'')+'" data-folder="'+esc(f.id)+'" title="'+esc(f.name)+'">'+esc(f.name)+'</button>'}).join('');
      layoutFolders();
    }
    function folderMenu(){
      var wrap=root.querySelector('.pm-folders'),menu=wrap.querySelector('.pm-folder-menu');
      var hiddenTabs=Array.prototype.filter.call(wrap.querySelectorAll('.pm-folder-tab'),function(el){return el.hidden});
      menu.innerHTML=hiddenTabs.map(function(el){
        return'<button data-folder="'+esc(el.dataset.folder)+'">'+esc(el.textContent)+'</button>'}).join('');
      menu.hidden=false;
    }
    // The entries move out first and the folder is deleted only once they have.
    // The other order would leave logins pointing at nothing for as long as the
    // updates take, and permanently if one of them failed.
    async function deleteFolder(id){
      var members=entries.filter(function(x){return x.folder_id===id});
      for(var i=0;i<members.length;i++){var value=withoutId(members[i]);delete value.folder_id;await saveEntry(members[i].id,value)}
      await api('/folders/'+encodeURIComponent(id),{method:'DELETE'});
      if(folder===id){folder='';localStorage.removeItem(FOLDER_KEY)}
      forgetFolder(id);
      await load(true);
    }
    function foldersDialog(){
      var overlay=document.createElement('div');overlay.className='pm-overlay';
      overlay.innerHTML='<div class="pm-dialog"><h3>'+esc(t('pm_folders'))+'</h3><p class="pm-import-info">'+esc(t('pm_folders_info'))+'</p><div class="pm-folder-list"></div><label>'+esc(t('pm_folder_new'))+'</label><div class="pm-folder-edit"><input class="f-new" placeholder="'+esc(t('pm_folder_new_placeholder'))+'"><button type="button" class="primary f-add" title="'+esc(t('pm_folder_add'))+'" aria-label="'+esc(t('pm_folder_add'))+'">＋</button></div><div class="pm-error"></div><div class="pm-actions"><button class="f-close">'+esc(t('pm_import_close'))+'</button></div></div>';
      root.appendChild(overlay);
      var list=overlay.querySelector('.pm-folder-list'),err=overlay.querySelector('.pm-error'),busy=false;
      function taken(name,exceptId){return folders.some(function(f){return f.id!==exceptId&&f.name.toLowerCase()===name.toLowerCase()})}
      function draw(){
        list.innerHTML=folders.length?folders.map(function(f){
          var n=entries.filter(function(x){return entryFolder(x)===f.id}).length;
          return'<div class="pm-folder-edit"><input class="f-fname" data-id="'+esc(f.id)+'" value="'+esc(f.name)+'"><button type="button" class="f-frename" data-id="'+esc(f.id)+'" title="'+esc(t('pm_folder_rename'))+'" aria-label="'+esc(t('pm_folder_rename'))+'">💾</button><button type="button" class="pm-danger f-fdel" data-id="'+esc(f.id)+'" data-count="'+n+'" title="'+esc(t('pm_folder_delete'))+'" aria-label="'+esc(t('pm_folder_delete'))+'">🗑</button></div>'}).join(''):'<div class="pm-folder-empty">'+esc(t('pm_folder_empty'))+'</div>';
      }
      async function run(job){if(busy)return;busy=true;err.textContent='';
        try{await job()}catch(_){err.textContent=t('pm_error')}
        busy=false;draw()}
      draw();
      list.onclick=function(e){
        var el=e.target.closest('button');if(!el)return;
        var id=el.dataset.id;
        if(el.classList.contains('f-frename')){
          var input=list.querySelector('.f-fname[data-id="'+id+'"]'),name=input.value.trim();
          if(!name){err.textContent=t('pm_folder_name_required');return}
          if(taken(name,id)){err.textContent=t('pm_folder_exists');return}
          run(async function(){await saveFolder(id,name);await load(true)});
        } else if(el.classList.contains('f-fdel')){
          var count=Number(el.dataset.count||0);
          if(!confirm(t(count?'pm_folder_delete_confirm_n':'pm_folder_delete_confirm',{name:folderName(id),n:count})))return;
          run(function(){return deleteFolder(id)});
        }
      };
      var newInput=overlay.querySelector('.f-new');
      function add(){var name=newInput.value.trim();
        if(!name){err.textContent=t('pm_folder_name_required');return}
        if(taken(name,null)){err.textContent=t('pm_folder_exists');return}
        run(async function(){await saveFolder(null,name);newInput.value='';await load(true)})}
      overlay.querySelector('.f-add').onclick=add;
      newInput.onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();add()}};
      list.onkeydown=function(e){if(e.key!=='Enter'||!e.target.classList.contains('f-fname'))return;
        e.preventDefault();
        var button=list.querySelector('.f-frename[data-id="'+e.target.dataset.id+'"]');if(button)button.click()};
      overlay.querySelector('.f-close').onclick=function(){if(!busy)overlay.remove()};
      setTimeout(function(){newInput.focus()},20);
    }
    function unlockScreen(vault,error){if(passkeyBusy)return;var creating=!vault,duration=localStorage.getItem(DURATION_KEY)||'session';root.innerHTML='<div class="pm pm-unlock"><div><h2>'+esc(t(creating?'pm_create_title':'pm_unlock'))+'</h2><p>'+esc(t(creating?'pm_create_info':'pm_unlock_info'))+'</p><input class="pm-master" type="password" autocomplete="new-password" placeholder="'+esc(t('pm_master'))+'">'+(creating?'<input class="pm-confirm" type="password" autocomplete="new-password" placeholder="'+esc(t('pm_confirm_master'))+'">':'')+'<label class="pm-duration-label">'+esc(t('pm_unlock_for'))+'</label><select class="pm-duration"><option value="5">'+esc(t('pm_minutes',{n:5}))+'</option><option value="15">'+esc(t('pm_minutes',{n:15}))+'</option><option value="60">'+esc(t('pm_hour'))+'</option><option value="240">'+esc(t('pm_hours',{n:4}))+'</option><option value="720">'+esc(t('pm_hours',{n:12}))+'</option><option value="1440">'+esc(t('pm_hours',{n:24}))+'</option><option value="10080">'+esc(t('pm_days',{n:7}))+'</option><option value="session">'+esc(t('pm_until_closed'))+'</option></select><div class="pm-duration-hint">'+esc(t('pm_unlock_sliding'))+'</div><div class="pm-error">'+esc(error||'')+'</div><button class="primary pm-go">'+esc(t(creating?'pm_create':'pm_unlock'))+'</button></div></div>';var select=root.querySelector('.pm-duration');select.value=duration;var input=root.querySelector('.pm-master');root.querySelector('.pm-go').onclick=async function(){var pass=input.value;
      // The length rule guards the choice of a new master password, so it applies
      // only when creating a vault. Enforcing it on unlock would lock a user out
      // of a vault whose password predates the rule — the password is already
      // chosen by then, and a wrong one fails at decryption anyway.
      if(creating&&pass.length<MIN_MASTER){unlockScreen(vault,t('pm_password_short',{n:MIN_MASTER}));return}
      if(!creating&&!pass){unlockScreen(vault,t('pm_unlock_failed'));return}if(creating&&pass!==root.querySelector('.pm-confirm').value){unlockScreen(vault,t('pm_passwords_differ'));return}try{if(creating){var salt=b64(crypto.getRandomValues(new Uint8Array(32)));await api('/vault',{method:'POST',body:JSON.stringify({salt:salt,iterations:600000})});vault={salt:salt,iterations:600000}}key=await derive(pass,vault.salt,vault.iterations);await load(creating);if(key)await cacheKey(select.value);}catch(_){key=null;unlockScreen(vault,t('pm_unlock_failed'))}};setTimeout(function(){input.focus()},30)}
    // An entry matches when any one of its addresses matches: the rule is the
    // same for all of them, but each is tested on its own, so a single bad
    // regex line cannot silently disqualify the addresses beside it.
    function matchesEntry(ctx,item){if(!ctx||!ctx.hostname)return true;var mode=item.match_mode&&item.match_mode!=='default'?item.match_mode:(extensionSettings.matching_mode||'domain');
      if(mode==='exact')return websites(item).some(function(site){return normalUrl(ctx.url)===normalUrl(site)});
      if(mode==='regex')return websites(item).some(function(site){try{return new RegExp(site,'i').test(ctx.url||'')}catch(_){return false}});
      return sameHost(ctx.hostname,item)}
    function inFolder(x){return folder===UNFILED?!entryFolder(x):entryFolder(x)===folder}
    // Everything the typed search or the open page asks for, before the folder is
    // applied.
    //
    // A search is a search of the whole vault. Narrowing to the current site is a
    // convenience for the untyped state only: the moment something is typed, the
    // site filter is dropped, otherwise an entry that exists but does not match
    // the open page is unfindable — you get "1 match" and no way to reach the
    // second one you know is there.
    function candidates(){
      var q=((root.querySelector('.pm-search')||{}).value||'').trim().toLowerCase();
      // The folder name joins the haystack, so "work" finds the logins in Work
      // even when the word appears nowhere inside them.
      if(q)return entries.filter(function(x){return(JSON.stringify(x)+' '+folderName(entryFolder(x))).toLowerCase().indexOf(q)>=0});
      return entries.filter(function(x){return showAll||matchesEntry(context,x)});
    }
    // A folder hides, it never re-matches. What the page (or the search) selected
    // is decided above and left alone; the folder only takes the matches sitting
    // in another folder off the screen. Two accounts for the same site, one in
    // Home and one in Work, with Home chosen: the Work one is hidden, not gone —
    // hiddenCount() counts it and renderList() offers to show it.
    //
    // "Show the rest" lasts for this view only. Nothing is written down, so the
    // next time the popup opens the chosen folder is hiding again, which is the
    // whole point of choosing one.
    function visible(){var list=candidates();return folder&&!otherFolders?list.filter(inFolder):list}
    function hiddenCount(){if(!folder||otherFolders)return 0;var list=candidates();return list.length-list.filter(inFolder).length}
    // The bar (with the search input) is built once per unlock and never
    // replaced afterwards. Rebuilding it on every keystroke — the old
    // behaviour — destroyed and recreated the <input>, which is what threw
    // focus and the cursor position away after the very first character.
    function renderShell(){if(!key||passkeyBusy)return;
      // The surface decides, not the licence. The desktop is the only place a
      // subscription can be activated, so it always shows the button: licensed
      // it works, unlicensed premiumGate turns the click into the subscription
      // dialog. A public page or extension visitor cannot activate anything and
      // is never told the feature exists — no button, no lock, no explanation,
      // exactly like an app that was never built with it.
      // The desktop always shows it: unlicensed, premiumGate turns it into the
      // upsell, which only makes sense where the person can actually buy.
      // Everywhere else — public page, extension — it appears only when the
      // installation is licensed, because there is nothing to sell to someone
      // who cannot reach Settings, and no reason to hide a feature they have.
      //
      // premiumGate, not a bare window.mvmOS check: apphub_pub/layout.js
      // creates a window.mvmOS on every /pub/ page to carry the language, so
      // its existence proves nothing. Only the real desktop SDK has premiumGate.
      var isDesktop=!!(window.mvmOS&&window.mvmOS.premiumGate);
      // auditOn comes from the server and is the truth about the licence right
      // now; mvmOS.premiumStatus is a desktop-side cache refreshed only when
      // the badge redraws, so a licence removed while the desktop stayed open
      // leaves it stale and premiumGate would wave the click through. Keep the
      // desktop button visible either way — unlicensed it must open the
      // subscription modal — but let the fresh answer drive the gate below.
      var showAudit=isDesktop||auditOn;
      root.innerHTML='<div class="pm"><div class="pm-bar"><div class="pm-bar-head"><span class="pm-title">🛡️ '+esc(t('pm_title'))+'</span></div><div class="pm-bar-tools"><input class="pm-search" placeholder="'+esc(t('pm_search'))+'"><button class="pm-menu-btn" title="'+esc(t('pm_menu'))+'" aria-label="'+esc(t('pm_menu'))+'">☰</button></div><div class="pm-folders" hidden><div class="pm-folder-row"></div><button class="pm-folder-more" hidden title="'+esc(t('pm_folder_more'))+'" aria-label="'+esc(t('pm_folder_more'))+'">⋯</button><div class="pm-folder-menu" hidden></div></div><span class="pm-context"></span></div><div class="pm-menu" hidden><button class="pm-add">'+esc(t('pm_add'))+'</button><button class="pm-folders-btn">'+esc(t('pm_folders'))+'</button>'+(showAudit?'<button class="pm-audit">'+esc(t('pm_audit_title'))+'</button>':'')+(parentOrigin?'':'<button class="pm-import">'+esc(t('pm_import_title'))+'</button>')+'<button class="pm-lock">'+esc(t('pm_lock'))+'</button></div><div class="pm-list"></div></div>';
      var search=root.querySelector('.pm-search');search.oninput=renderList;
      var menuBtn=root.querySelector('.pm-menu-btn'),menu=root.querySelector('.pm-menu');
      menuBtn.onclick=function(e){e.stopPropagation();menu.hidden=!menu.hidden};
      var folderWrap=root.querySelector('.pm-folders'),folderMore=folderWrap.querySelector('.pm-folder-more'),overflowMenu=folderWrap.querySelector('.pm-folder-menu');
      folderWrap.querySelector('.pm-folder-row').onclick=function(e){var el=e.target.closest('[data-folder]');if(el)pickFolder(el.dataset.folder)};
      overflowMenu.onclick=function(e){var el=e.target.closest('[data-folder]');if(el)pickFolder(el.dataset.folder)};
      folderMore.onclick=function(e){e.stopPropagation();if(overflowMenu.hidden)folderMenu();else overflowMenu.hidden=true};
      // The row is re-measured whenever it changes width — a resized desktop
      // window, a phone turned on its side — because which tabs fit is a fact
      // about the width and nothing else, and is wrong the moment that changes.
      if(folderObserver)folderObserver.disconnect();
      if(window.ResizeObserver){folderObserver=new ResizeObserver(function(){layoutFolders()});folderObserver.observe(folderWrap)}
      // renderShell() replaces the whole subtree on every unlock, so the previous
      // outside-click listener (closing over now-detached elements) is removed
      // first — otherwise each unlock/lock cycle would leak one more of these.
      if(outsideClickHandler)document.removeEventListener('click',outsideClickHandler);
      outsideClickHandler=function(e){if(!menu.hidden&&!menu.contains(e.target)&&e.target!==menuBtn)menu.hidden=true;
        if(!overflowMenu.hidden&&!overflowMenu.contains(e.target)&&e.target!==folderMore)overflowMenu.hidden=true};
      document.addEventListener('click',outsideClickHandler);
      root.querySelector('.pm-add').onclick=function(){menu.hidden=true;dialog(parentOrigin&&context&&context.hostname?{website:context.hostname}:null)};
      root.querySelector('.pm-folders-btn').onclick=function(){menu.hidden=true;foldersDialog()};
      var auditBtn=root.querySelector('.pm-audit');
      if(auditBtn){
        // auditOn is the server's answer, so it is right even when the desktop
        // has been open since before the licence changed. Without this check
        // the click would reach auditDialog(), which then fails to load the
        // premium script and leaves the user with a dialog that does nothing.
        // The server's answer is authoritative, so correct the desktop's cached
        // premiumStatus from it before premiumGate reads it. Without this a
        // licence removed while the desktop stayed open leaves the cache saying
        // 'premium', the gate waves the click through, and the dialog opens with
        // no premium script behind it.
        if(isDesktop&&!auditOn)window.mvmOS.premiumStatus='free';
        auditBtn.onclick=function(){menu.hidden=true;auditDialog()};
        // premiumGate intercepts the click in capture phase and shows the
        // subscription dialog instead whenever mvmOS.premiumStatus is not
        // 'premium', re-checked live — so this is correct both today and the
        // moment a licence is activated or lapses without a reload.
        if(window.mvmOS&&window.mvmOS.premiumGate)window.mvmOS.premiumGate(auditBtn,t('pm_audit_premium_info'));
      }
      var importButton=root.querySelector('.pm-import');if(importButton)importButton.onclick=function(){menu.hidden=true;importDialog()};
      if(!parentOrigin){
        function exportButton(className,label,action){var button=document.createElement('button');button.className=className;button.textContent=exportText(label);button.onclick=function(){menu.hidden=true;action()};menu.insertBefore(button,root.querySelector('.pm-lock'))}
        exportButton('pm-export-backup','backup',exportBackup);
        exportButton('pm-export-csv','csv',exportCsv);
      }
      root.querySelector('.pm-lock').onclick=function(){menu.hidden=true;lockNow()};
      renderFolders();renderList();
    }
    function renderList(){if(!key||passkeyBusy)return;var list=visible(),hasContext=context&&context.hostname,matchCount=hasContext?entries.filter(function(x){return matchesEntry(context,x)}).length:0;if(parentOrigin&&hasContext)window.parent.postMessage({source:'mvmos-public-app',appId:APP_ID,action:'password-match-count',count:matchCount},parentOrigin);
      // While a search is active the site filter is off (see visible()), so the
      // context line and the "show all" button must not claim otherwise.
      var searching=!!((root.querySelector('.pm-search')||{}).value||'').trim();
      // Whether the page is still narrowing the list, which is what the "show all
      // logins" button undoes. It stays reachable with a folder chosen, because
      // the folder no longer replaces that narrowing — without it, a folder opened
      // on a page it does not match would be an empty list with no way to see the
      // folder itself.
      var siteFilter=hasContext&&!showAll&&!searching;
      // A chosen folder is what the list is showing, so it is what the line says.
      var ctx=root.querySelector('.pm-context');if(ctx)ctx.textContent=folder?(folder===UNFILED?t('pm_folder_none'):folderName(folder)):(siteFilter?t('pm_matching',{host:context.hostname}):t('pm_all'));
      // No pagination: the grid is just as many auto-sized columns as the
      // width allows (CSS, not JS), and the list keeps growing downward with
      // a scrollbar — a phone-width container falls back to one column,
      // which is the same single stacked list it always was.
      var el=root.querySelector('.pm-list');
      el.className='pm-list pm-list-grid';
      // What the chosen folder is keeping off the screen. The count is the point
      // of the button: it says something is there without putting it in the way.
      var hidden=hiddenCount();
      var others=hidden?'<button class="pm-folder-others">'+esc(t('pm_folder_others',{n:hidden}))+'</button>':'';
      // An empty folder is a dead end unless the way out is on the screen that
      // shows it — but only when nothing is hidden either, since the button above
      // is already that way out and two of them side by side would just ask the
      // same question twice.
      var wayBack=!list.length&&folder&&!hidden?'<button class="pm-folder-clear">'+esc(t('pm_folder_show_all'))+'</button>':'';
      el.innerHTML=(list.length?list.map(card).join(''):'<div class="pm-empty">'+esc(t(folder?'pm_folder_empty_list':'pm_empty'))+(!folder?' <button class="pm-empty-add">'+esc(t('pm_add'))+'</button>':'')+'</div>')+others+wayBack+(siteFilter?'<button class="pm-show-all">'+esc(t('pm_show_all'))+'</button>':'');
      var all=el.querySelector('.pm-show-all');if(all)all.onclick=function(){showAll=true;renderList()};
      var clear=el.querySelector('.pm-folder-clear');if(clear)clear.onclick=function(){pickFolder('')};
      var more=el.querySelector('.pm-folder-others');if(more)more.onclick=function(){otherFolders=true;renderList()};
      var emptyAdd=el.querySelector('.pm-empty-add');if(emptyAdd)emptyAdd.onclick=function(){dialog(parentOrigin&&context&&context.hostname?{website:context.hostname}:null)};
      el.onclick=onClick;
    }
    // load() re-fetches after every save/delete/import while the shell is
    // already on screen; re-running renderShell() there would blow away the
    // search input (and any text mid-typed into it) for no reason, so it only
    // (re)builds the shell the first time, then always refreshes just the list.
    function render(){if(root.querySelector('.pm-bar')){renderFolders();renderList()}else renderShell()}
    function card(x){var matched=context&&context.hostname&&matchesEntry(context,x),badge=matched?'<span class="pm-match-badge"><img src="/apps/mvmpasswords/extension-icon.png" alt="">'+esc(t('pm_match'))+'</span>':'',keyBadge=x.passkey?'<span class="pm-passkey-badge">🔑 '+esc(t('pm_passkey_field'))+'</span>':'';// Icon-only buttons keep one card's actions on a single row on a phone, but an
    // icon alone names nothing — so each carries its label as both title and
    // aria-label, which is also what a screen reader reads out.
    function action(attr,id,label,icon,extra){return'<button '+attr+'="'+esc(id)+'" class="pm-icon-btn'+(extra?' '+extra:'')+'" title="'+esc(label)+'" aria-label="'+esc(label)+'">'+icon+'</button>'}
    // Delete moved into the edit dialog to free up a slot here; a card with no
    // website still needs that slot to hold its layout, so the open-link
    // button only renders when there is somewhere to send the click.
    var openBtn=websites(x).length?action('data-open',x.id,t('pm_open_url'),'↗️'):'<span class="pm-icon-btn pm-icon-spacer"></span>';
    return'<div class="pm-card" data-id="'+esc(x.id)+'"><div class="pm-head pm-head-click" data-view="'+esc(x.id)+'"><div class="pm-avatar">'+esc((x.name||'?')[0].toUpperCase())+'</div><div><div class="pm-name">'+esc(x.name)+badge+keyBadge+'</div><div class="pm-sub">'+esc(x.username||host(websites(x)[0]||''))+'</div></div></div><div class="pm-actions">'+(parentOrigin?action('data-fill',x.id,t('pm_fill'),'✒️','primary'):'')+action('data-cu',x.id,t('pm_copy_username'),'👤')+action('data-cp',x.id,t('pm_copy_password'),'🔑')+(totpReady()&&x.totp_id?action('data-ct',x.id,t('pm_copy_totp'),'🔢'):'')+action('data-edit',x.id,t('pm_edit'),'✏️')+openBtn+'</div></div>'}
    function find(id){return entries.find(function(x){return x.id===id})}

    // ---- import -----------------------------------------------------------
    // The file is read by FileReader and encrypted here with the key already in
    // memory; only {iv, ciphertext} is ever sent, over the same POST /entries
    // the manual form uses. The server has no endpoint that accepts a readable
    // login, so an import cannot leak one even by mistake.
    function importDialog(){
      var overlay=document.createElement('div');overlay.className='pm-overlay';
      overlay.innerHTML='<div class="pm-dialog pm-import"><h3>'+esc(t('pm_import_title'))+'</h3>'+
        '<p class="pm-import-info">'+esc(t('pm_import_info'))+'</p>'+
        '<div class="pm-import-drop"><button type="button" class="primary f-pick">'+esc(t('pm_import_pick'))+'</button>'+
        '<div class="pm-import-formats">'+esc(t('pm_import_formats'))+'</div></div>'+
        '<input type="file" class="f-file" accept=".json,.csv,.txt,application/json,text/csv,text/plain" hidden>'+
        '<div class="pm-import-status"></div><div class="pm-import-list"></div>'+
        '<div class="pm-error"></div><div class="pm-actions"><button class="primary f-go" hidden></button>'+
        '<button class="f-cancel">'+esc(t('pm_cancel'))+'</button></div></div>';
      root.appendChild(overlay);
      var file=overlay.querySelector('.f-file'),status=overlay.querySelector('.pm-import-status'),
          list=overlay.querySelector('.pm-import-list'),go=overlay.querySelector('.f-go'),
          error=overlay.querySelector('.pm-error'),cancel=overlay.querySelector('.f-cancel'),
          found=[],sourceFolders=[],ownBackup=false,busy=false;
      function close(){if(!busy)overlay.remove()}
      overlay.querySelector('.f-pick').onclick=function(){file.click()};
      cancel.onclick=close;

      function duplicate(candidate){
        // Same account on the same site is the only safe definition of a
        // duplicate: same name alone would collide across a "Google" entry the
        // user keeps twice on purpose, for two different accounts.
        // An import file gives one address per row, but an entry already in the
        // vault may cover several — so the row is a duplicate if that account
        // already lists this site anywhere, not only as its first address.
        var site=host(candidate.website),user=(candidate.username||'').toLowerCase();
        return entries.some(function(existing){
          return (existing.username||'').toLowerCase()===user&&(site||user)&&
            (site?websites(existing).some(function(v){return host(v)===site}):!websites(existing).length);
        });
      }
      function renderList(){
        list.innerHTML=found.map(function(item,index){
          return '<label class="pm-import-row"><input type="checkbox" data-i="'+index+'"'+(item._take?' checked':'')+'>'+
            '<span class="pm-import-name">'+esc(item.name||t('pm_import_no_name'))+'</span>'+
            '<span class="pm-import-sub">'+esc(host(item.website)||item.username||'')+'</span>'+
            (item._dupe?'<span class="pm-import-dupe">'+esc(t('pm_import_dupe'))+'</span>':'')+'</label>';
        }).join('');
        list.onchange=function(e){var box=e.target.closest('input[type=checkbox]');if(!box)return;
          found[Number(box.dataset.i)]._take=box.checked;updateGo()};
        updateGo();
      }
      function updateGo(){
        var n=found.filter(function(x){return x._take}).length;
        go.hidden=!found.length;go.textContent=t('pm_import_go',{n:n});go.disabled=!n;
      }
      function handle(text,filename){
        var parsed;
        try{parsed=window.MvmPasswordManagerImport.parse(text,filename)}catch(_){parsed=null}
        ownBackup=!!parsed&&parsed.kind==='mvmpasswords-backup';
        sourceFolders=ownBackup?parsed.folders:[];
        if(ownBackup)parsed=parsed.entries;
        if(parsed==='encrypted'){status.textContent='';error.textContent=t('pm_import_encrypted');return}
        if(!parsed){status.textContent='';error.textContent=t('pm_import_unreadable');return}
        if(!parsed.length){status.textContent='';error.textContent=t('pm_import_empty');return}
        error.textContent='';
        found=parsed.map(function(item){
          var dupe=duplicate(item);
          // Duplicates arrive unticked rather than hidden: the user may well
          // want the second copy, but should have to say so.
          return Object.assign({},item,{_dupe:dupe,_take:!dupe});
        });
        var dupes=found.filter(function(x){return x._dupe}).length;
        status.innerHTML='<div>'+esc(t('pm_import_found',{n:found.length}))+'</div>'+
          (dupes?'<div class="pm-import-note">'+esc(t('pm_import_dupes',{n:dupes}))+'</div>':'')+
          '<div class="pm-import-bulk"><button type="button" class="f-all">'+esc(t('pm_import_select_all'))+'</button>'+
          '<button type="button" class="f-none">'+esc(t('pm_import_select_none'))+'</button></div>';
        status.querySelector('.f-all').onclick=function(){found.forEach(function(x){x._take=true});renderList()};
        status.querySelector('.f-none').onclick=function(){found.forEach(function(x){x._take=false});renderList()};
        renderList();
      }
      file.onchange=function(){
        var chosen=file.files&&file.files[0];if(!chosen)return;
        error.textContent='';status.textContent=t('pm_import_reading');list.innerHTML='';go.hidden=true;found=[];
        var reader=new FileReader();
        reader.onload=function(){handle(String(reader.result||''),chosen.name)};
        reader.onerror=function(){status.textContent='';error.textContent=t('pm_import_unreadable')};
        reader.readAsText(chosen);
      };

      go.onclick=async function(){
        var take=found.filter(function(x){return x._take});
        if(!take.length){error.textContent=t('pm_import_nothing');return}
        busy=true;error.textContent='';list.innerHTML='';go.disabled=true;cancel.disabled=true;
        var saved=0,failed=0;
        var folderMap={};
        if(ownBackup){
          var required={};take.forEach(function(item){if(item.folder_id)required[item.folder_id]=true});
          sourceFolders.forEach(function(source){
            if(!required[source.id])return;
            var existing=folders.find(function(target){return target.name.toLowerCase()===source.name.toLowerCase()});
            if(existing)folderMap[source.id]=existing.id;
          });
          for(var f=0;f<sourceFolders.length;f++){
            var source=sourceFolders[f];if(!required[source.id]||folderMap[source.id])continue;
            try{var created=await saveFolder(null,source.name);folderMap[source.id]=created.id;folders.push({id:created.id,name:source.name})}catch(_){}
          }
        }
        for(var i=0;i<take.length;i++){
          status.textContent=t('pm_import_working',{done:i+1,total:take.length});
          var item=take[i];
          try{
            var value;
            if(ownBackup){
              value=withoutId(item);delete value._dupe;delete value._take;delete value.totp_id;
              if(value.folder_id&&folderMap[value.folder_id])value.folder_id=folderMap[value.folder_id];else delete value.folder_id;
            }else value={name:item.name||host(item.website)||item.username||t('pm_import_no_name'),
              website:item.website||'',match_mode:'default',username:item.username||'',
              password:item.password||'',notes:item.notes||''};
            await saveEntry(null,value);
            saved++;
          }catch(_){failed++}
        }
        busy=false;
        status.textContent=t('pm_import_done',{n:saved})+(failed?' '+t('pm_import_failed',{n:failed}):'');
        go.hidden=true;cancel.disabled=false;cancel.textContent=t('pm_import_close');
        await load(true);
      };
    }
    // Failure here is routine, not exceptional: the App API can be switched off,
    // mvm2factor can be uninstalled, the linked account can be deleted. None of
    // that is the vault's problem, so the button reports it on itself and the
    // rest of the entry keeps working exactly as before.
    async function totpCopy(el,accountId){
      var label=el.textContent;el.textContent='⏳';
      try{var data=await totpFetchCode(accountId);
        // Not swallowed: a refused clipboard write is the one failure the user
        // would otherwise discover by pasting nothing into a login form.
        await navigator.clipboard.writeText(data.code);
        el.classList.add('pm-copied');el.textContent='✅'}
      catch(_){el.textContent='⚠️';el.title=t('pm_totp_unavailable')}
      setTimeout(function(){el.textContent=label;render()},1200);
    }
    async function onClick(e){
      var head=e.target.closest('[data-view]');
      if(head&&!e.target.closest('button')){viewDialog(find(head.dataset.view));return}
      var el=e.target.closest('button');if(!el)return;
      var id=el.dataset.fill||el.dataset.cu||el.dataset.cp||el.dataset.ct||el.dataset.edit||el.dataset.open,item=find(id);if(!item)return;
      if(el.dataset.fill){
        // Filling a login that has 2FA leaves the user one field short, and the
        // code is the one thing autofill cannot type for them — the field is on
        // the next screen. So the code lands in the clipboard instead, ready to
        // paste. Fetched on the click and not earlier: it is valid for seconds.
        //
        // Order matters and is the whole reason this is not one line. Autofill
        // focuses the password field in the tab, which takes focus away from the
        // popup and lets the browser close it — and a clipboard write is refused
        // from a document that is not focused. So the code is fetched and copied
        // while this document still has focus, and the fill is sent only once
        // that is done. Sending the fill first silently copies nothing, which is
        // exactly how this read as "the button works but fill does not".
        var doFill=function(){window.parent.postMessage({source:'mvmos-public-app',appId:'mvmpasswords',action:'autofill-login',credentials:{username:item.username||'',password:item.password||''}},parentOrigin)};
        if(totpReady()&&item.totp_id)totpCopy(el,item.totp_id).then(doFill,doFill);
        else doFill()}
      else if(el.dataset.ct){await totpCopy(el,item.totp_id)}
      else if(el.dataset.cu||el.dataset.cp){await navigator.clipboard.writeText(el.dataset.cu?item.username:item.password).catch(function(){});
      // The button no longer has a text label to replace, so confirmation is a
      // brief checkmark on the icon itself; without it a tap gives no feedback.
      el.classList.add('pm-copied');el.textContent='✅';setTimeout(function(){render()},900)}
      else if(el.dataset.edit)dialog(item);
      // The first address is the entry's own; the rest are there so the popup
      // recognises the other places the same login is used, and opening one of
      // those instead would be a surprise.
      else if(el.dataset.open){var target=websites(item)[0]||'';if(target)window.open(target.indexOf('://')<0?'https://'+target:target,'_blank','noopener')}
    }
    // Quick view mirrors the edit dialog's visual shape but shows read-only
    // text instead of inputs, except the password keeps its show/hide toggle —
    // the one field where "read-only" still needs an explicit action to reveal.
    function viewDialog(item){if(!item)return;var overlay=document.createElement('div');overlay.className='pm-overlay';
      var passkeyBlock=item.passkey?'<label>'+esc(t('pm_passkey_field'))+'</label><div class="pm-view-value">🔑 '+esc(item.passkey.userDisplayName||item.passkey.userName||item.passkey.rpId||'')+'</div>':'';
      overlay.innerHTML='<div class="pm-dialog"><h3>'+esc(item.name||'')+'</h3>'+
        (entryFolder(item)?'<label>'+esc(t('pm_folder_field'))+'</label><div class="pm-view-value">🗂️ '+esc(folderName(entryFolder(item)))+'</div>':'')+
        '<label>'+esc(t('pm_website'))+'</label>'+(websites(item).length?websites(item).map(function(site){return'<div class="pm-view-value">'+esc(site)+'</div>'}).join(''):'<div class="pm-view-value">—</div>')+
        '<label>'+esc(t('pm_username'))+'</label><div class="pm-view-value">'+esc(item.username||'—')+'</div>'+
        '<label>'+esc(t('pm_password'))+'</label><div class="pm-password-field"><div class="pm-view-value f-pass-view">••••••••</div><button type="button" class="f-toggle" title="'+esc(t('pm_show_password'))+'">👁</button></div>'+
        (totpReady()&&item.totp_id?'<label>'+esc(t('pm_totp_field'))+'</label><div class="pm-password-field"><div class="pm-view-value f-totp-view">••••••</div><button type="button" class="f-totp-copy" title="'+esc(t('pm_copy_totp'))+'">🔢</button></div>':'')+
        (item.notes?'<label>'+esc(t('pm_notes'))+'</label><div class="pm-view-value pm-view-notes">'+esc(item.notes)+'</div>':'')+
        passkeyBlock+
        '<div class="pm-actions"><button class="primary f-edit">'+esc(t('pm_edit'))+'</button><button class="f-close">'+esc(t('pm_cancel'))+'</button></div></div>';
      root.appendChild(overlay);
      var passView=overlay.querySelector('.f-pass-view'),toggle=overlay.querySelector('.f-toggle'),shown=false;
      toggle.onclick=function(){shown=!shown;passView.textContent=shown?(item.password||''):'••••••••';toggle.textContent=shown?'🙈':'👁';toggle.title=t(shown?'pm_hide_password':'pm_show_password')};
      // The code is shown as well as copied here, because this dialog is where
      // someone looks at an entry rather than acting on it — and it is fetched
      // on this click alone, like everywhere else.
      var totpCopyBtn=overlay.querySelector('.f-totp-copy');
      if(totpCopyBtn)totpCopyBtn.onclick=async function(){
        var view=overlay.querySelector('.f-totp-view');totpCopyBtn.textContent='⏳';
        try{var data=await totpFetchCode(item.totp_id);
          view.textContent=data.code;
          await navigator.clipboard.writeText(data.code).catch(function(){});
          totpCopyBtn.textContent='✅'}
        catch(_){view.textContent=t('pm_totp_unavailable');totpCopyBtn.textContent='⚠️'}
        setTimeout(function(){totpCopyBtn.textContent='🔢'},1200)};
      overlay.querySelector('.f-close').onclick=function(){overlay.remove()};
      overlay.querySelector('.f-edit').onclick=function(){overlay.remove();dialog(item)};
    }
    // The check itself is subscriber-only by delivery, not by a flag read here:
    // GET /pub/mvmpasswords/audit.js 404s the instant this install is not
    // licensed, because premium/backend.py refuses to hand back the file.
    // Deliberately fetched fresh on every open, never cached across clicks:
    // caching "it loaded once" would let a page left open from before a
    // licence was revoked go on running an algorithm the server would no
    // longer send it. window.__mvmPmAudit is cleared first so a failed
    // reload (script never runs) can't fall back to a stale definition left
    // over from an earlier, licensed load.
    function loadAuditScript(){
      delete window.__mvmPmAudit;
      return new Promise(function(resolve){
        var el=document.createElement('script');
        el.src=API+'/audit.js?_='+Date.now();
        el.onload=function(){el.remove();resolve(!!window.__mvmPmAudit)};
        el.onerror=function(){el.remove();resolve(false)};
        document.head.appendChild(el)})}
    function auditDialog(){
      var overlay=document.createElement('div');overlay.className='pm-overlay';
      overlay.innerHTML='<div class="pm-dialog"><h3>'+esc(t('pm_audit_title'))+'</h3><div class="pm-audit-body">'+esc(t('pm_loading'))+'</div><div class="pm-actions"><button class="g-cancel">'+esc(t('pm_cancel'))+'</button></div></div>';
      root.appendChild(overlay);
      overlay.querySelector('.g-cancel').onclick=function(){overlay.remove()};
      var body=overlay.querySelector('.pm-audit-body');
      loadAuditScript().then(function(ok){
        // Reachable only by a licence lapsing between the vault load that
        // decided this button exists and the click — routine, not an error,
        // and never worth a paywall message: the desktop already told the
        // one person who can act on it, everyone else was never shown the
        // button at all.
        if(!ok){overlay.remove();return}
        renderAudit(body)})}
    function renderAudit(body){
      var result=window.__mvmPmAudit(entries),weak=result.weak,reused=result.reused;
      if(!weak.length&&!reused.length){body.innerHTML='<p class="pm-audit-ok">✅ '+esc(t('pm_audit_all_good'))+'</p>';return}
      var html='';
      if(reused.length){
        html+='<h4 class="pm-audit-h">'+esc(t('pm_audit_reused_title'))+'</h4>';
        reused.forEach(function(group){
          html+='<div class="pm-audit-group">'+group.map(function(e){return'<span class="pm-audit-chip pm-head-click" data-view="'+esc(e.id)+'">'+esc(e.name)+'</span>'}).join('')+'</div>'});
      }
      if(weak.length){
        html+='<h4 class="pm-audit-h">'+esc(t('pm_audit_weak_title'))+'</h4>';
        html+=weak.map(function(w){
          return'<div class="pm-audit-row pm-head-click" data-view="'+esc(w.entry.id)+'"><span class="pm-audit-name">'+esc(w.entry.name)+'</span><span class="pm-audit-badge pm-audit-'+w.strength.level+'">'+esc(t('pm_audit_level_'+w.strength.level))+'</span></div>'}).join('')}
      body.innerHTML=html;
      // Same data-view/find()/viewDialog() path the main list uses on its own
      // pm-head-click rows — clicking a flagged entry here opens the same quick
      // view, so seeing the problem and looking at the entry is one click.
      body.onclick=function(e){
        var el=e.target.closest('[data-view]');if(!el)return;
        var item=find(el.dataset.view);if(!item)return;
        var ov=body.closest('.pm-overlay');if(ov)ov.remove();
        viewDialog(item)}}
    // The folder picker is offered only once there is a folder to pick: a select
    // whose whole content is "No folder" asks a question with one answer. Until
    // then the manager in the ☰ menu is where a vault gets its first folder.
    function folderField(selected){return folders.length?'<label>'+esc(t('pm_folder_field'))+'</label><select class="f-folder"><option value="">'+esc(t('pm_folder_none'))+'</option>'+folders.map(function(f){return'<option value="'+esc(f.id)+'"'+(selected===f.id?' selected':'')+'>'+esc(f.name)+'</option>'}).join('')+'</select>':''}
    // Remembered per device on purpose — the user asked for it in localStorage
    // rather than the server so the same account can prefer different options
    // on different machines. Never skipped: only the pre-filled defaults change.
    var GEN_KEY='mvm_pm_gen_opts';
    function genOpts(){
      var out={length:10,lower:true,upper:true,digits:true,symbols:true};
      try{var saved=JSON.parse(localStorage.getItem(GEN_KEY));if(saved&&typeof saved==='object')Object.assign(out,saved)}catch(_){}
      return out}
    function saveGenOpts(opts){try{localStorage.setItem(GEN_KEY,JSON.stringify(opts))}catch(_){}}
    function generatePassword(opts){
      var sets=[];
      if(opts.lower)sets.push('abcdefghijklmnopqrstuvwxyz');
      if(opts.upper)sets.push('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
      if(opts.digits)sets.push('0123456789');
      if(opts.symbols)sets.push('!@#$%^&*()-_=+[]{};:,.<>?');
      if(!sets.length)return'';
      var all=sets.join(''),len=Math.max(1,opts.length|0),bytes=new Uint32Array(len);crypto.getRandomValues(bytes);
      var out=[];for(var i=0;i<len;i++)out.push(all[bytes[i]%all.length]);
      // Guarantee at least one character from every chosen set so a short
      // length can't land on, say, an all-digit result by pure chance.
      sets.forEach(function(set,i){if(i<out.length)out[i]=set[Math.floor(Math.random()*set.length)]});
      for(var i=out.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var tmp=out[i];out[i]=out[j];out[j]=tmp}
      return out.join('')}
    function genDialog(onUse){
      var opts=genOpts();
      var overlay=document.createElement('div');overlay.className='pm-overlay';
      overlay.innerHTML='<div class="pm-dialog"><h3>'+esc(t('pm_gen_title'))+'</h3>'+
        '<label>'+esc(t('pm_gen_length'))+'</label><input class="g-length" type="number" min="4" max="64" value="'+esc(opts.length)+'">'+
        '<label class="pm-gen-check"><input type="checkbox" class="g-lower"'+(opts.lower?' checked':'')+'> '+esc(t('pm_gen_lower'))+'</label>'+
        '<label class="pm-gen-check"><input type="checkbox" class="g-upper"'+(opts.upper?' checked':'')+'> '+esc(t('pm_gen_upper'))+'</label>'+
        '<label class="pm-gen-check"><input type="checkbox" class="g-digits"'+(opts.digits?' checked':'')+'> '+esc(t('pm_gen_digits'))+'</label>'+
        '<label class="pm-gen-check"><input type="checkbox" class="g-symbols"'+(opts.symbols?' checked':'')+'> '+esc(t('pm_gen_symbols'))+'</label>'+
        '<div class="pm-password-field"><div class="pm-view-value g-preview"></div><button type="button" class="g-reroll" title="'+esc(t('pm_gen_reroll'))+'">🎲</button></div>'+
        '<div class="pm-error"></div>'+
        '<div class="pm-actions"><button class="primary g-use">'+esc(t('pm_gen_use'))+'</button><button class="g-cancel">'+esc(t('pm_cancel'))+'</button></div></div>';
      root.appendChild(overlay);
      var lenInput=overlay.querySelector('.g-length'),lower=overlay.querySelector('.g-lower'),upper=overlay.querySelector('.g-upper'),
          digits=overlay.querySelector('.g-digits'),symbols=overlay.querySelector('.g-symbols'),preview=overlay.querySelector('.g-preview'),
          err=overlay.querySelector('.pm-error'),reroll=overlay.querySelector('.g-reroll');
      function current(){return{length:Math.max(4,Math.min(64,parseInt(lenInput.value,10)||10)),lower:lower.checked,upper:upper.checked,digits:digits.checked,symbols:symbols.checked}}
      function refresh(){
        var o=current();
        if(!o.lower&&!o.upper&&!o.digits&&!o.symbols){preview.textContent='';err.textContent=t('pm_gen_need_one');reroll.disabled=true;return}
        reroll.disabled=false;err.textContent='';preview.textContent=generatePassword(o)}
      [lenInput,lower,upper,digits,symbols].forEach(function(el){el.addEventListener('input',refresh)});
      reroll.onclick=refresh;
      refresh();
      overlay.querySelector('.g-cancel').onclick=function(){overlay.remove()};
      overlay.querySelector('.g-use').onclick=function(){
        var o=current();
        if(!o.lower&&!o.upper&&!o.digits&&!o.symbols){err.textContent=t('pm_gen_need_one');return}
        saveGenOpts(o);
        var value=preview.textContent||generatePassword(o);
        overlay.remove();onUse(value)}}
    function dialog(item){item=item||{};
      // A login added while a folder is open starts in that folder. Anything else
      // means filing it by hand immediately after choosing where to look.
      var startFolder=item.id?entryFolder(item):(folder&&folder!==UNFILED?folder:'');
      var overlay=document.createElement('div');overlay.className='pm-overlay';overlay.innerHTML='<div class="pm-dialog"><h3>'+esc(t(item.id?'pm_edit_entry':'pm_new_entry'))+'</h3><label>'+esc(t('pm_name'))+'</label><input class="f-name" value="'+esc(item.name)+'">'+folderField(startFolder)+'<label>'+esc(t('pm_website'))+'</label><div class="pm-web-list"></div><button type="button" class="pm-web-add">+ '+esc(t('pm_add_website'))+'</button><label>'+esc(t('pm_match_mode'))+'</label><select class="f-match"><option value="default">'+esc(t('pm_match_default'))+'</option><option value="domain">'+esc(t('pm_match_domain'))+'</option><option value="exact">'+esc(t('pm_match_exact'))+'</option><option value="regex">'+esc(t('pm_match_regex'))+'</option></select><label>'+esc(t('pm_username'))+'</label><input class="f-user" value="'+esc(item.username)+'"><label>'+esc(t('pm_password'))+'</label><div class="pm-password-field"><input class="f-pass" type="password" value="'+esc(item.password)+'"><button type="button" class="f-toggle" title="'+esc(t('pm_show_password'))+'">👁</button><button type="button" class="f-genpass" title="'+esc(t('pm_gen_title'))+'">🎲</button></div>'+(totpReady()?'<label>'+esc(t('pm_totp_field'))+'</label><select class="f-totp"><option value="">'+esc(t('pm_totp_none'))+'</option></select>':'')+'<label>'+esc(t('pm_notes'))+'</label><textarea class="f-notes">'+esc(item.notes)+'</textarea>'+(item.passkey?'<div class="pm-passkey-block"><label>'+esc(t('pm_passkey_field'))+'</label><div class="pm-passkey-row"><span class="pm-passkey-info">🔑 '+esc(item.passkey.userDisplayName||item.passkey.userName||item.passkey.rpId||'')+'</span><button type="button" class="f-passkey-del">'+esc(t('pm_passkey_remove'))+'</button></div></div>':'')+'<div class="pm-error"></div><div class="pm-actions"><button class="primary f-save">'+esc(t('pm_save'))+'</button><button class="f-cancel">'+esc(t('pm_cancel'))+'</button>'+(item.id?'<button class="pm-danger f-delete">'+esc(t('pm_delete'))+'</button>':'')+'</div></div>';root.appendChild(overlay);var pass=overlay.querySelector('.f-pass'),toggle=overlay.querySelector('.f-toggle'),match=overlay.querySelector('.f-match');match.value=item.match_mode||'default';
      // The address rows are built here rather than in the markup above because
      // there is no fixed number of them. A row can always be removed, including
      // the last one — an entry with no address at all is legitimate (a database
      // login, a wifi password), it simply never matches an open page.
      var webList=overlay.querySelector('.pm-web-list');
      function addWebRow(value){var row=document.createElement('div');row.className='pm-web-row';
        row.innerHTML='<input class="f-web" value="'+esc(value||'')+'" placeholder="'+esc(t('pm_website_placeholder'))+'"><button type="button" class="pm-web-del" title="'+esc(t('pm_remove_website'))+'" aria-label="'+esc(t('pm_remove_website'))+'">✕</button>';
        row.querySelector('.pm-web-del').onclick=function(){row.remove()};
        webList.appendChild(row);return row}
      // A brand-new entry still opens with one empty row, so the common case —
      // one address, typed straight in — needs no extra click.
      var existingSites=websites(item);if(!existingSites.length)existingSites=[''];existingSites.forEach(addWebRow);
      // Filled in after the dialog is already visible, never before it: this is
      // a hop into another app and making the editor wait for it would make
      // every edit feel slower for the sake of one optional field. Until the
      // list arrives the select holds the current value and nothing else, so a
      // save that happens first keeps the existing link rather than clearing it.
      var totpSelect=overlay.querySelector('.f-totp');
      if(totpSelect){
        if(item.totp_id)totpSelect.insertAdjacentHTML('beforeend','<option value="'+esc(item.totp_id)+'" selected>'+esc(t('pm_totp_loading'))+'</option>');
        totpFetchAccounts().then(function(list){
          if(!totpSelect.isConnected)return;
          var current=totpSelect.value;
          totpSelect.innerHTML='<option value="">'+esc(t('pm_totp_none'))+'</option>'+list.map(function(a){
            var label=a.issuer&&a.issuer!==a.name?a.issuer+' — '+a.name:a.name;
            return '<option value="'+esc(a.id)+'">'+esc(label)+'</option>'}).join('');
          // The linked account may have been deleted in mvm2factor since. Saying
          // so beats silently unlinking an entry the user never touched.
          if(current&&!list.some(function(a){return a.id===current}))
            totpSelect.insertAdjacentHTML('beforeend','<option value="'+esc(current)+'">'+esc(t('pm_totp_missing'))+'</option>');
          totpSelect.value=current;
        }).catch(function(){
          if(totpSelect.isConnected)totpSelect.insertAdjacentHTML('beforeend','<option value="" disabled>'+esc(t('pm_totp_unavailable'))+'</option>');
        });
      }
      overlay.querySelector('.pm-web-add').onclick=function(){addWebRow('').querySelector('.f-web').focus()};var keepPasskey=item.passkey||null,passkeyDel=overlay.querySelector('.f-passkey-del');if(passkeyDel)passkeyDel.onclick=function(){keepPasskey=null;overlay.querySelector('.pm-passkey-block').remove()};toggle.onclick=function(){var showing=pass.type==='text';pass.type=showing?'password':'text';toggle.textContent=showing?'👁':'🙈';toggle.title=t(showing?'pm_show_password':'pm_hide_password')};overlay.querySelector('.f-genpass').onclick=function(){genDialog(function(generated){pass.type='text';toggle.textContent='🙈';toggle.title=t('pm_hide_password');pass.value=generated})};overlay.querySelector('.f-cancel').onclick=function(){overlay.remove()};var delBtn=overlay.querySelector('.f-delete');if(delBtn)delBtn.onclick=async function(){if(!confirm(t('pm_delete_confirm',{name:item.name})))return;try{await api('/entries/'+encodeURIComponent(item.id),{method:'DELETE'});overlay.remove();await load(true)}catch(_){overlay.querySelector('.pm-error').textContent=t('pm_error')}};overlay.querySelector('.f-save').onclick=async function(){var value={name:overlay.querySelector('.f-name').value.trim(),website:Array.prototype.map.call(overlay.querySelectorAll('.f-web'),function(el){return el.value.trim()}).filter(Boolean).join('\n'),match_mode:match.value,username:overlay.querySelector('.f-user').value.trim(),password:pass.value,notes:overlay.querySelector('.f-notes').value};if(keepPasskey)value.passkey=keepPasskey;
        // Kept inside the encrypted blob like every other field, so the server
        // never learns which entry has 2FA. When the picker is absent — no
        // subscription, or the integration switched off — the existing link is
        // carried over untouched rather than dropped: turning the feature off
        // must not quietly destroy what turning it back on would restore.
        if(totpSelect){if(totpSelect.value)value.totp_id=totpSelect.value}else if(item.totp_id)value.totp_id=item.totp_id;
        // Same rule as the 2FA link above, and for the same reason: with no picker
        // on screen there was no chance to change this, so an existing filing is
        // carried over rather than silently cleared. A new login started inside a
        // folder keeps it even in the vault that has only that one.
        var folderSelect=overlay.querySelector('.f-folder');
        var chosenFolder=folderSelect?folderSelect.value:(item.folder_id||startFolder);
        if(chosenFolder)value.folder_id=chosenFolder;
        if(!value.name||(!value.password&&!value.passkey)){overlay.querySelector('.pm-error').textContent=t('pm_required');return}try{var out=await saveEntry(item.id,value);if(!item.id)value.id=out.id;overlay.remove();await load(true)}catch(_){overlay.querySelector('.pm-error').textContent=t('pm_error')}};setTimeout(function(){overlay.querySelector('.f-name').focus()},20)}
    // In the extension the key arrives from the parent only after a full
    // iframe->ready->vault-session round trip, and load() used to start its
    // /vault request from scratch afterwards — so the request queued behind the
    // handshake instead of running alongside it, and the popup sat blank for it.
    // The fetch is fired once at mount and both callers await the same promise.
    var vaultPromise=null;
    function fetchVault(force){if(force||!vaultPromise)vaultPromise=api('/vault').catch(function(e){vaultPromise=null;throw e});return vaultPromise}
    var lastVault=null;
    async function load(force){try{var payload=await fetchVault(force);if(!payload.vault){unlockScreen(null);return}
      lastVault=payload.vault;
      // Carried by the vault response, so every surface — desktop window, public
      // page, extension — learns it at the same moment it learns everything else
      // and none of them pays for an extra round trip to find out.
      totpOn=!!payload.totp;auditOn=!!payload.audit;if(!key&&!parentOrigin)await restoreLocalKey();if(!key){unlockScreen(payload.vault);return}
      // Every record is independent, so they decrypt concurrently. Sequential
      // awaits made this O(n) round trips through the crypto engine.
      var loaded=await Promise.all([Promise.all((payload.entries||[]).map(decrypt)),Promise.all((payload.folders||[]).map(decrypt))]);
      entries=loaded[0];
      // Alphabetical, and localeCompare rather than a plain sort because a vault
      // in Bulgarian would otherwise be ordered by code point. This is the order
      // the manager and the entry editor show, and the fallback the tab row uses
      // for folders that have not been picked yet.
      folders=loaded[1].map(function(f){return{id:f.id,name:String(f.name||'')}}).sort(function(a,b){return a.name.localeCompare(b.name)});
      // A remembered folder that has since been deleted — in another tab, on
      // another device — would filter the list down to nothing with no tab lit up
      // to explain why. Falling back to All is the only honest state.
      if(folder&&folder!==UNFILED&&!folders.some(function(f){return f.id===folder})){folder='';localStorage.removeItem(FOLDER_KEY)}
      touchFolder(folder);
      render()}catch(_){if(key){key=null;unlockScreen(lastVault,t('pm_unlock_failed'))}else root.innerHTML='<div class="pm-empty">'+esc(t('pm_error'))+'</div>'}}
    function pk(){return window.MvmPasswordManagerPasskey}
    function replyPasskey(reqId,result,error){passkeyBusy=false;if(parentOrigin)window.parent.postMessage({source:'mvmos-public-app',appId:APP_ID,action:'passkey-result',reqId:reqId,result:result,error:error},parentOrigin)}
    // A passkey is a field of an ordinary login, the way Bitwarden stores one, so
    // it is encrypted inside the entry itself and found by the same matching rule
    // the entry already uses for passwords. The rp id is kept as a fallback so a
    // passkey stays usable even if its login's website field is later edited.
    function passkeyOwners(rpId,origin,allow){return entries.filter(function(x){if(!x.passkey)return false;if(allow.length&&allow.indexOf(x.passkey.credentialId)<0)return false;return matchesEntry({hostname:rpId,url:origin},x)||String(x.passkey.rpId||'').toLowerCase()===rpId})}
    function passkeyLabel(x){return x.passkey&&(x.passkey.userDisplayName||x.passkey.userName)||x.name}
    function passkeyUnlockGate(job){return new Promise(function(resolve){if(key){resolve();return}root.innerHTML='<div class="pm pm-unlock"><div><h2>'+esc(t('pm_passkey_unlock_title'))+'</h2><p>'+esc(t('pm_unlock_info'))+'</p><input class="pm-master" type="password" autocomplete="current-password" placeholder="'+esc(t('pm_master'))+'"><div class="pm-error"></div><button class="primary pm-go">'+esc(t('pm_unlock'))+'</button></div></div>';var input=root.querySelector('.pm-master'),err=root.querySelector('.pm-error');root.querySelector('.pm-go').onclick=async function(){try{var payload=await api('/vault');if(!payload.vault)throw new Error('vault_missing');key=await derive(input.value,payload.vault.salt,payload.vault.iterations);await cacheKey(localStorage.getItem('mvm_pm_unlock_duration')||'session');resolve()}catch(_){err.textContent=t('pm_unlock_failed')}};setTimeout(function(){input.focus()},30)})}
    async function runPasskeyCreate(job){await passkeyUnlockGate(job);var opts=Object.assign({},unwrapBufs(job.options),{__origin:job.origin});var rpId=String((opts.rp&&opts.rp.id)||new URL(job.origin).hostname).toLowerCase();try{await loadEntries()}catch(_){}var targets=entries.filter(function(x){return !x.passkey&&matchesEntry({hostname:rpId,url:job.origin},x)});var account=(opts.user&&(opts.user.displayName||opts.user.name))||rpId;return new Promise(function(resolve){root.innerHTML='<div class="pm pm-unlock"><div><h2>'+esc(t('pm_passkey_create_title'))+'</h2><p>'+esc(t('pm_passkey_create_info',{host:rpId}))+'</p>'+'<label class="pm-duration-label">'+esc(t('pm_passkey_save_to'))+'</label><select class="pm-duration pm-passkey-target"><option value="">'+esc(t('pm_passkey_new_login'))+'</option>'+targets.map(function(x,i){return'<option value="'+i+'">'+esc(x.name)+'</option>'}).join('')+'</select>'+'<label class="pm-duration-label">'+esc(t('pm_passkey_name'))+'</label><input class="pm-passkey-name" value="'+esc(account)+'">'+'<div class="pm-error"></div><div class="pm-actions"><button class="primary pm-go">'+esc(t('pm_passkey_save'))+'</button><button class="pm-cancel">'+esc(t('pm_cancel'))+'</button></div></div></div>';var nameInput=root.querySelector('.pm-passkey-name'),target=root.querySelector('.pm-passkey-target'),err=root.querySelector('.pm-error');root.querySelector('.pm-cancel').onclick=function(){replyPasskey(job.reqId,null,'The operation was cancelled.');resolve()};root.querySelector('.pm-go').onclick=async function(){try{var result=await pk().createCredential(opts);var record=result.vaultRecord;record.userDisplayName=nameInput.value.trim()||record.userDisplayName||record.userName;record.signCount=1;if(target.value===''){await saveEntry(null,{name:record.rpName||rpId,website:rpId,match_mode:'default',username:record.userName||record.userDisplayName||'',password:'',notes:'',passkey:record})}else{var item=targets[Number(target.value)],value=withoutId(item);value.passkey=record;await saveEntry(item.id,value)}replyPasskey(job.reqId,{credentialId:result.credentialId,clientDataJSON:result.clientDataJSON,attestationObject:result.attestationObject,publicKeySpki:result.publicKeySpki});resolve()}catch(_){err.textContent=t('pm_error')}}})}
    async function runPasskeyGet(job){await passkeyUnlockGate(job);var opts=Object.assign({},unwrapBufs(job.options),{__origin:job.origin});var rpId=String(opts.rpId||new URL(job.origin).hostname).toLowerCase();try{await loadEntries()}catch(_){}var allow=(opts.allowCredentials||[]).map(function(c){return c&&c.id}).filter(Boolean);var candidates=passkeyOwners(rpId,job.origin,allow);if(!candidates.length){replyPasskey(job.reqId,null,'No matching passkey.');return}return new Promise(function(resolve){function pick(item){root.innerHTML='<div class="pm pm-unlock"><div><h2>'+esc(t('pm_passkey_confirm_title'))+'</h2><p>'+esc(t('pm_passkey_confirm_info',{name:passkeyLabel(item)}))+'</p><div class="pm-error"></div><div class="pm-actions"><button class="primary pm-go">'+esc(t('pm_passkey_use'))+'</button><button class="pm-cancel">'+esc(t('pm_cancel'))+'</button></div></div></div>';var err=root.querySelector('.pm-error');root.querySelector('.pm-cancel').onclick=function(){replyPasskey(job.reqId,null,'The operation was cancelled.');resolve()};root.querySelector('.pm-go').onclick=async function(){try{var assertion=await pk().getAssertion(opts,item.passkey);var value=withoutId(item);value.passkey=Object.assign({},item.passkey,{signCount:(item.passkey.signCount||0)+1});await saveEntry(item.id,value).catch(function(){});replyPasskey(job.reqId,assertion);resolve()}catch(_){err.textContent=t('pm_error')}}}if(candidates.length===1){pick(candidates[0]);return}root.innerHTML='<div class="pm"><div class="pm-bar"><span class="pm-title">🔑 '+esc(t('pm_passkey_pick_title'))+'</span></div><div class="pm-list">'+candidates.map(function(c,idx){return'<div class="pm-card"><div class="pm-head"><div class="pm-avatar">'+esc((passkeyLabel(c)||'?')[0].toUpperCase())+'</div><div><div class="pm-name">'+esc(passkeyLabel(c))+'</div><div class="pm-sub">'+esc(c.name)+' · '+esc(rpId)+'</div></div></div><div class="pm-actions"><button class="primary" data-pick="'+idx+'">'+esc(t('pm_passkey_use'))+'</button></div></div>'}).join('')+'</div></div>';root.querySelector('.pm-list').onclick=function(e){var el=e.target.closest('[data-pick]');if(!el)return;pick(candidates[Number(el.dataset.pick)])}})}
    function onMessage(e){if(e.source!==window.parent||!/^chrome-extension:\/\/|^moz-extension:\/\//.test(e.origin))return;var m=e.data||{};if(m.source!=='mvmos-extension'||m.appId!==APP_ID)return;if(m.type==='context'){parentOrigin=e.origin;extensionSettings=m.settings||{};if(passkeyBusy)return;context=m.context||{};showAll=false;otherFolders=false;render();return}if(m.type==='vault-session'&&m.session&&(!m.session.expires||m.session.expires>Date.now()))importKey(m.session.key).then(function(v){key=v;scheduleAutoLock(renewSession(m.session).expires);load()}).catch(function(){});if(m.type==='passkey-job'&&m.job&&pk()){passkeyBusy=true;try{context={hostname:new URL(m.job.origin).hostname.toLowerCase(),url:m.job.origin}}catch(_){}if(m.job.op==='create')runPasskeyCreate(m.job);else if(m.job.op==='get')runPasskeyGet(m.job);return}}
    // Fire the vault request before announcing readiness, so it travels while
    // the extension is still deciding to send the key back instead of starting
    // only once it has: in the popup that round trip was the whole visible wait.
    fetchVault().catch(function(){});
    window.addEventListener('message',onMessage);document.addEventListener('visibilitychange',onVisible);if(window.parent!==window)window.parent.postMessage({source:'mvmos-public-app',appId:APP_ID,action:'ready'},'*');load();return{destroy:function(){destroyed=true;clearTimeout(autoLockTimer);key=null;entries=[];folders=[];window.removeEventListener('message',onMessage);document.removeEventListener('visibilitychange',onVisible);if(outsideClickHandler)document.removeEventListener('click',outsideClickHandler);if(folderObserver){folderObserver.disconnect();folderObserver=null}}}
  }
  window.MvmPasswordManagerWidget={mount:mount};
})();
