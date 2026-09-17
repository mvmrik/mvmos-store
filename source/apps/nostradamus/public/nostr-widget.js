(function(){
  if(window.NostradamusWidget)return;
  var API='/pub/nostradamus';
  var bytesToHex=window.NostrCrypto.bytesToHex,hexToBytes=window.NostrCrypto.hexToBytes;
  function t(k,v){return(window.t||function(x){return x})(k,v)}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function b64(bytesIn){var s='';new Uint8Array(bytesIn).forEach(function(x){s+=String.fromCharCode(x)});return btoa(s)}
  function bytes(s){var bin=atob(s),out=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
  var DEFAULT_RELAYS=['wss://relay.damus.io','wss://nos.lol','wss://relay.nostr.band','wss://relay.primal.net'];
  var MIN_MASTER=10;
  // DeepL's full target-language list (matches apps/deepl/public/widget.js) —
  // this picks the DeepL translation target, not the mvmOS UI language, so it
  // isn't limited to the 9 languages the rest of the interface is translated into.
  var NOS_LANGS=[
    {value:'BG',label:'Bulgarian'},{value:'ZH',label:'Chinese'},{value:'CS',label:'Czech'},{value:'DA',label:'Danish'},
    {value:'NL',label:'Dutch'},{value:'EN-GB',label:'English (British)'},{value:'EN-US',label:'English (American)'},
    {value:'ET',label:'Estonian'},{value:'FI',label:'Finnish'},{value:'FR',label:'French'},{value:'DE',label:'German'},
    {value:'EL',label:'Greek'},{value:'HU',label:'Hungarian'},{value:'ID',label:'Indonesian'},{value:'IT',label:'Italian'},
    {value:'JA',label:'Japanese'},{value:'KO',label:'Korean'},{value:'LV',label:'Latvian'},{value:'LT',label:'Lithuanian'},
    {value:'NB',label:'Norwegian'},{value:'PL',label:'Polish'},{value:'PT-BR',label:'Portuguese (Brazilian)'},
    {value:'PT-PT',label:'Portuguese (European)'},{value:'RO',label:'Romanian'},{value:'RU',label:'Russian'},
    {value:'SK',label:'Slovak'},{value:'SL',label:'Slovenian'},{value:'ES',label:'Spanish'},{value:'SV',label:'Swedish'},
    {value:'TR',label:'Turkish'},{value:'UK',label:'Ukrainian'},
  ];

  // ---- NIP-19 bech32 (BIP-173 reference algorithm, hand-rolled: no CDN dep) ----
  var CHARSET='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  function polymod(values){
    var GEN=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3],chk=1;
    for(var p=0;p<values.length;p++){
      var top=chk>>25;
      chk=(chk&0x1ffffff)<<5^values[p];
      for(var i=0;i<5;i++)if((top>>i)&1)chk^=GEN[i];
    }
    return chk;
  }
  function hrpExpand(hrp){
    var ret=[],p;
    for(p=0;p<hrp.length;p++)ret.push(hrp.charCodeAt(p)>>5);
    ret.push(0);
    for(p=0;p<hrp.length;p++)ret.push(hrp.charCodeAt(p)&31);
    return ret;
  }
  function createChecksum(hrp,data){
    var values=hrpExpand(hrp).concat(data).concat([0,0,0,0,0,0]);
    var mod=polymod(values)^1,ret=[];
    for(var p=0;p<6;p++)ret.push((mod>>5*(5-p))&31);
    return ret;
  }
  function verifyChecksum(hrp,data){return polymod(hrpExpand(hrp).concat(data))===1}
  function bech32Encode(hrp,data){
    var combined=data.concat(createChecksum(hrp,data)),out=hrp+'1';
    for(var p=0;p<combined.length;p++)out+=CHARSET.charAt(combined[p]);
    return out;
  }
  function bech32Decode(str){
    str=String(str||'');
    if(str.toLowerCase()!==str&&str.toUpperCase()!==str)return null;
    str=str.toLowerCase();
    var pos=str.lastIndexOf('1');
    if(pos<1||pos+7>str.length||str.length>1000)return null;
    var hrp=str.substring(0,pos),data=[];
    for(var p=pos+1;p<str.length;p++){
      var d=CHARSET.indexOf(str.charAt(p));
      if(d===-1)return null;
      data.push(d);
    }
    if(!verifyChecksum(hrp,data))return null;
    return{hrp:hrp,data:data.slice(0,data.length-6)};
  }
  function convertBits(data,fromBits,toBits,pad){
    var acc=0,bits=0,ret=[],maxv=(1<<toBits)-1;
    for(var i=0;i<data.length;i++){
      var value=data[i];
      if(value<0||value>>fromBits!==0)return null;
      acc=(acc<<fromBits)|value;bits+=fromBits;
      while(bits>=toBits){bits-=toBits;ret.push((acc>>bits)&maxv)}
    }
    if(pad){if(bits>0)ret.push((acc<<(toBits-bits))&maxv)}
    else if(bits>=fromBits||((acc<<(toBits-bits))&maxv))return null;
    return ret;
  }
  function encodeBech32Bytes(hrp,byteArray){
    var words=convertBits(Array.prototype.slice.call(byteArray),8,5,true);
    return words?bech32Encode(hrp,words):null;
  }
  function decodeBech32Bytes(str){
    var d=bech32Decode(str);if(!d)return null;
    var out=convertBits(d.data,5,8,false);
    return out?{hrp:d.hrp,bytes:new Uint8Array(out)}:null;
  }
  function npubEncode(pubHex){return encodeBech32Bytes('npub',hexToBytes(pubHex))}
  function nsecEncode(privHex){return encodeBech32Bytes('nsec',hexToBytes(privHex))}
  function noteEncode(idHex){return encodeBech32Bytes('note',hexToBytes(idHex))}
  function nsecDecode(nsec){var d=decodeBech32Bytes(nsec);return d&&d.hrp==='nsec'?bytesToHex(d.bytes):null}
  function npubDecode(npub){var d=decodeBech32Bytes(npub);return d&&d.hrp==='npub'?bytesToHex(d.bytes):null}
  function shortNpub(npub){return npub.slice(0,10)+'…'+npub.slice(-6)}
  // nevent/nprofile carry a TLV payload; type 0 is the 32-byte id or pubkey and is
  // the only field a reader of a mention or a quote actually needs.
  function decodeTLV(raw){
    var out={},i=0;
    while(i+2<=raw.length){
      var type=raw[i],len=raw[i+1],value=raw.slice(i+2,i+2+len);
      if(value.length<len)break;
      (out[type]=out[type]||[]).push(value);
      i+=2+len;
    }
    return out;
  }
  function refToId(str){
    var d=decodeBech32Bytes(str);if(!d)return null;
    if(d.hrp==='note')return d.bytes.length===32?bytesToHex(d.bytes):null;
    if(d.hrp==='nevent'){var tlv=decodeTLV(d.bytes);return tlv[0]&&tlv[0][0].length===32?bytesToHex(tlv[0][0]):null}
    return null;
  }
  function refToPubkey(str){
    var d=decodeBech32Bytes(str);if(!d)return null;
    if(d.hrp==='npub')return d.bytes.length===32?bytesToHex(d.bytes):null;
    if(d.hrp==='nprofile'){var tlv=decodeTLV(d.bytes);return tlv[0]&&tlv[0][0].length===32?bytesToHex(tlv[0][0]):null}
    return null;
  }

  // ---- Nostr event crypto (NIP-01) ----
  function getXOnlyPubkey(priv){return window.NostrCrypto.getPublicKey(priv,true).slice(1)}
  function genPrivKey(){
    for(var i=0;i<10;i++){
      var candidate=crypto.getRandomValues(new Uint8Array(32));
      try{getXOnlyPubkey(candidate);return candidate}catch(_){}
    }
    throw new Error('keygen_failed');
  }
  async function sha256(dataBytes){return new Uint8Array(await crypto.subtle.digest('SHA-256',dataBytes))}
  function serializeEvent(ev){return JSON.stringify([0,ev.pubkey,ev.created_at,ev.kind,ev.tags,ev.content])}
  async function finalizeEvent(base,priv){
    var ev={kind:base.kind,tags:base.tags||[],content:base.content||'',created_at:Math.floor(Date.now()/1000)};
    ev.pubkey=bytesToHex(getXOnlyPubkey(priv));
    var idBytes=await sha256(new TextEncoder().encode(serializeEvent(ev)));
    ev.id=bytesToHex(idBytes);
    ev.sig=bytesToHex(window.NostrCrypto.schnorr.sign(idBytes,priv));
    return ev;
  }

  // ---- tag readers (NIP-10 / NIP-18) ----
  function tagsOf(ev,name){return(ev&&ev.tags||[]).filter(function(tg){return tg[0]===name})}
  function eTags(ev){return tagsOf(ev,'e')}
  function lastETag(ev){var list=eTags(ev);return list.length?list[list.length-1][1]:null}
  function isReply(ev){return eTags(ev).length>0}
  // NIP-10 leaves two conventions in the wild: marked tags, and the positional
  // form where the first e tag is the root and the last one is the parent. Reading
  // markers first and falling back to position is what makes threads from mixed
  // clients hang together instead of flattening.
  function replyTarget(ev){
    var list=eTags(ev);
    if(!list.length)return null;
    var marked=list.filter(function(tg){return tg[3]==='reply'});
    if(marked.length)return marked[marked.length-1][1];
    var root=list.filter(function(tg){return tg[3]==='root'});
    if(root.length&&list.length===1)return root[0][1];
    return list[list.length-1][1];
  }
  function rootTarget(ev){
    var list=eTags(ev);
    if(!list.length)return null;
    var root=list.filter(function(tg){return tg[3]==='root'});
    if(root.length)return root[0][1];
    return list[0][1];
  }
  function quotedId(ev){
    var q=tagsOf(ev,'q');
    if(q.length&&q[0][1])return q[0][1];
    var match=(ev.content||'').match(/nostr:(n(?:ote|event)1[023456789acdefghjklmnpqrstuvwxyz]+)/);
    return match?refToId(match[1]):null;
  }
  // What a reaction or a repost points at is always its last e tag; a reply's
  // target needs the NIP-10 reading above.
  function targetOf(ev){return ev.kind===1?replyTarget(ev):lastETag(ev)}

  // ---- relay pool: raw WebSocket per relay, NIP-01 REQ/EVENT/CLOSE ----
  function createPool(){
    var conns={},subs={},okWaiters={},statusListeners=[];
    function notifyStatus(){statusListeners.forEach(function(cb){cb()})}
    function send(c,msg){
      if(c.status==='open'&&c.ws&&c.ws.readyState===1)c.ws.send(JSON.stringify(msg));
      else c.buffer.push(msg);
    }
    function scheduleReconnect(c){
      if(c.closing)return;
      clearTimeout(c.timer);
      c.retries=(c.retries||0)+1;
      var delay=Math.min(30000,1000*Math.pow(2,c.retries));
      c.timer=setTimeout(function(){open(c)},delay);
    }
    function open(c){
      try{c.ws=new WebSocket(c.url)}catch(_){c.status='error';notifyStatus();scheduleReconnect(c);return}
      c.status='connecting';notifyStatus();
      c.ws.onopen=function(){
        c.status='open';c.retries=0;notifyStatus();
        Object.keys(subs).forEach(function(subId){
          var sub=subs[subId];
          if(sub.urls.indexOf(c.url)>=0)send(c,['REQ',subId].concat(sub.filters));
        });
        var queued=c.buffer;c.buffer=[];
        queued.forEach(function(msg){c.ws.send(JSON.stringify(msg))});
      };
      c.ws.onmessage=function(ev){
        var data;try{data=JSON.parse(ev.data)}catch(_){return}
        handleMessage(c.url,data);
      };
      c.ws.onclose=function(){c.status='closed';notifyStatus();scheduleReconnect(c)};
      c.ws.onerror=function(){c.status='error';notifyStatus()};
    }
    function connect(url){
      if(conns[url])return conns[url];
      var c={url:url,ws:null,status:'connecting',buffer:[],retries:0,timer:0,closing:false};
      conns[url]=c;open(c);return c;
    }
    function fireEose(subId){
      var sub=subs[subId];
      if(!sub||sub.eosed)return;
      sub.eosed=true;clearTimeout(sub.timer);
      if(sub.onEose)sub.onEose();
    }
    function handleMessage(url,data){
      var type=data[0];
      if(type==='EVENT'){
        var sub=subs[data[1]];
        if(sub&&sub.onEvent)sub.onEvent(data[2],url);
      }else if(type==='EOSE'){
        var sub2=subs[data[1]];
        if(sub2){delete sub2.pending[url];if(!Object.keys(sub2.pending).length)fireEose(data[1])}
      }else if(type==='OK'){
        var waiters=okWaiters[data[1]]||[];
        waiters.slice().forEach(function(fn){fn(url,data[2],data[3])});
      }
    }
    return{
      // One relay reaching the end of its stored events is not the end of the
      // query — the fastest relay is often the emptiest. Ranking a trending window
      // needs every relay's answer, so EOSE waits for all of them, with a ceiling
      // because a relay that is merely unreachable would otherwise never answer.
      subscribe:function(urls,subId,filters,onEvent,onEose){
        var sub={urls:urls,filters:filters,onEvent:onEvent,onEose:onEose,eosed:false,pending:{},timer:0};
        urls.forEach(function(url){sub.pending[url]=true});
        subs[subId]=sub;
        if(!urls.length){setTimeout(function(){fireEose(subId)},0);return}
        sub.timer=setTimeout(function(){fireEose(subId)},6000);
        urls.forEach(function(url){send(connect(url),['REQ',subId].concat(filters))});
      },
      unsubscribe:function(subId){
        var sub=subs[subId];if(!sub)return;
        clearTimeout(sub.timer);
        sub.urls.forEach(function(url){var c=conns[url];if(c)send(c,['CLOSE',subId])});
        delete subs[subId];
      },
      publish:function(urls,event){
        return new Promise(function(resolve){
          var results=[],pending=urls.length,finished=false;
          if(!pending){resolve(results);return}
          function finish(){if(finished)return;finished=true;clearTimeout(timer);
            var idx=(okWaiters[event.id]||[]).indexOf(fn);if(idx>=0)okWaiters[event.id].splice(idx,1);
            resolve(results);
          }
          function fn(url,ok,msg){
            if(urls.indexOf(url)<0)return;
            results.push({url:url,ok:ok,message:msg});
            pending--;if(pending<=0)finish();
          }
          okWaiters[event.id]=okWaiters[event.id]||[];okWaiters[event.id].push(fn);
          var timer=setTimeout(finish,8000);
          urls.forEach(function(url){send(connect(url),['EVENT',event])});
        });
      },
      // `keep` is for connections that are not relays and therefore are not in
      // the user's relay list — the ranking cache. Without it, saving the relay
      // tab would tear down a connection the relay list never described.
      setRelayUrls:function(urls,keep){
        keep=keep||[];
        Object.keys(conns).forEach(function(url){
          if(urls.indexOf(url)<0&&keep.indexOf(url)<0){var c=conns[url];c.closing=true;clearTimeout(c.timer);if(c.ws)c.ws.close();delete conns[url]}
        });
        urls.forEach(function(url){connect(url)});
        notifyStatus();
      },
      statusOf:function(url){return(conns[url]&&conns[url].status)||'closed'},
      onStatusChange:function(cb){statusListeners.push(cb)},
      destroy:function(){
        Object.keys(subs).forEach(function(subId){clearTimeout(subs[subId].timer)});
        Object.keys(conns).forEach(function(url){var c=conns[url];c.closing=true;clearTimeout(c.timer);if(c.ws)c.ws.close()});
        conns={};subs={};okWaiters={};
      }
    };
  }

  // ---- unlock session storage ----
  // The unlocked session keeps a non-extractable CryptoKey in IndexedDB. Web
  // Storage can only hold the raw exported bytes, and raw AES bytes sitting next
  // to the Apps Hub token in the same origin means one XSS anywhere on the domain
  // walks away with the nsec itself — the very thing the master password exists to
  // prevent. A CryptoKey survives the structured clone but never yields its
  // material to script, so the worst an attacker on the page can do is sign while
  // the session is live; the identity itself stays where it cannot be copied.
  var IDB_NAME='nostradamus',IDB_STORE='session';
  function idbOpen(){
    return new Promise(function(resolve,reject){
      var req=indexedDB.open(IDB_NAME,1);
      req.onupgradeneeded=function(){if(!req.result.objectStoreNames.contains(IDB_STORE))req.result.createObjectStore(IDB_STORE)};
      req.onsuccess=function(){resolve(req.result)};
      req.onerror=function(){reject(req.error)};
    });
  }
  function idbRun(mode,fn){
    return idbOpen().then(function(db){
      return new Promise(function(resolve,reject){
        var tx=db.transaction(IDB_STORE,mode),request=fn(tx.objectStore(IDB_STORE));
        tx.oncomplete=function(){db.close();resolve(request?request.result:null)};
        tx.onerror=function(){db.close();reject(tx.error)};
      });
    });
  }
  // A browser with IndexedDB blocked (private mode, hardened settings) simply gets
  // no persistence: the key lives in memory for as long as the widget is mounted
  // and the password is asked for again on reload. That is a worse experience than
  // a stored session but never a worse secret.
  // Keyed by npub, not a single fixed id: several identities can each hold a
  // live cached session at once, which is what lets switching between them
  // skip the password when both are still within their unlock window.
  function idbGet(id){return idbRun('readonly',function(store){return store.get(id)}).catch(function(){return null})}
  function idbPut(id,value){return idbRun('readwrite',function(store){store.put(value,id);return null}).catch(function(){})}
  function idbDel(id){return idbRun('readwrite',function(store){store.delete(id);return null}).catch(function(){})}

  var styled=false;
  function style(){if(styled)return;styled=true;var s=document.createElement('style');s.textContent='.nos,.nos *,.nos-modal,.nos-modal *{box-sizing:border-box}.nos{height:100%;display:flex;flex-direction:column;position:relative;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);font-family:system-ui,sans-serif;overflow:hidden}.nos-bar{border-bottom:1px solid var(--pub-border,#45475a);flex:0 0 auto}.nos-bar-head{display:flex;align-items:center;gap:.5rem;padding:.55rem .7rem}.nos-title{font-weight:700;font-size:.88rem;white-space:nowrap}.nos-tabs{display:flex;gap:.25rem;flex:1;overflow-x:auto;scrollbar-width:none}.nos-tabs::-webkit-scrollbar{display:none}.nos-tab{background:transparent;padding:.35rem .6rem;border-radius:.5rem;white-space:nowrap;position:relative}.nos-tab.active{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e)}.nos-badge{display:inline-block;min-width:1.05rem;padding:0 .25rem;margin-left:.25rem;border-radius:.6rem;background:var(--pub-red,#f38ba8);color:var(--pub-bg,#1e1e2e);font-size:.65rem;line-height:1.05rem;text-align:center}.nos-bar-btn{flex:0 0 auto;padding:.35rem .5rem;display:inline-flex;align-items:center;justify-content:center}.nos-me{flex:0 0 auto;padding:0;background:none!important}.nos-modes{display:flex;gap:.3rem;padding:0 .7rem .55rem;overflow-x:auto;scrollbar-width:none}.nos-modes::-webkit-scrollbar{display:none}.nos-mode{background:var(--pub-surface2,#313244);padding:.28rem .6rem;border-radius:999px;font-size:.74rem;white-space:nowrap}.nos-mode.active{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e)}.nos-body{flex:1;min-height:0;overflow:auto;padding:.7rem}.nos button,.nos input,.nos textarea,.nos select,.nos-modal button,.nos-modal textarea{font:inherit}.nos button,.nos-modal button{border:0;border-radius:.45rem;padding:.45rem .7rem;cursor:pointer;font-size:.8rem;font-weight:600;background:var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4);transition:filter .15s,transform .15s}.nos button:hover,.nos-modal button:hover{filter:brightness(1.12)}.nos button:active{transform:translateY(1px)}.nos button:disabled{opacity:.6;cursor:default}.nos .primary,.nos-modal .primary{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e)}.nos input,.nos textarea,.nos select,.nos-modal textarea{width:100%;background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);border-radius:.45rem;color:var(--pub-fg,#cdd6f4);padding:.55rem .65rem;outline:none;margin:.3rem 0}.nos input:focus,.nos textarea:focus,.nos select:focus,.nos-modal textarea:focus{border-color:var(--pub-accent,#89b4fa)}.nos-error{min-height:1.2rem;color:var(--pub-red,#f38ba8);font-size:.8rem;margin:.3rem 0}.nos-empty{display:flex;flex:1;align-items:center;justify-content:center;text-align:center;padding:1.5rem;color:var(--pub-fg2,#a6adc8);font-size:.85rem}.nos-unlock,.nos-onboard{display:flex;flex:1;align-items:center;justify-content:center;padding:1rem}.nos-unlock>div,.nos-card{width:100%;max-width:24rem;background:var(--pub-surface2,#313244);padding:1.25rem;border-radius:.7rem}.nos-unlock h2,.nos-card h2{font-size:1.05rem;margin:0 0 .4rem}.nos-unlock p,.nos-card p{font-size:.82rem;line-height:1.45;color:var(--pub-fg2,#a6adc8)}.nos-duration-hint{font-size:.72rem;opacity:.75;margin:.2rem 0 .6rem}.nos-warn{font-size:.78rem;line-height:1.45;color:var(--pub-yellow,#f9e2af);border:1px solid var(--pub-yellow,#f9e2af);border-radius:.45rem;padding:.5rem .6rem;margin:.5rem 0}.nos-link{background:none!important;padding:.4rem 0;font-size:.78rem;font-weight:400;color:var(--pub-accent,#89b4fa);text-decoration:underline}.nos-view-value{background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);border-radius:.45rem;padding:.55rem .65rem;font-size:.8rem;overflow-wrap:anywhere;margin:.3rem 0}.nos-key-value{font-family:monospace}.nos-check{display:flex!important;align-items:center;gap:.45rem;width:auto;font-size:.8rem;cursor:pointer}.nos-check input{width:auto;margin:0}.nos-note{border:1px solid var(--pub-border,#45475a);background:var(--pub-surface2,#313244);border-radius:.65rem;padding:.65rem;margin-bottom:.55rem;cursor:pointer;transition:background .3s}.nos-note:hover{filter:brightness(1.05)}.nos-note.nos-flat{border:0;background:none;padding:.55rem 0;border-bottom:1px solid var(--pub-border,#45475a);border-radius:0;margin:0}.nos-boost{font-size:.72rem;color:var(--pub-fg2,#a6adc8);margin-bottom:.35rem}.nos-note-head{display:flex;align-items:center;gap:.5rem}.nos-avatar-wrap{position:relative;width:2.1rem;height:2.1rem;flex:0 0 auto;cursor:pointer}.nos-avatar-wrap.nos-lg{width:4rem;height:4rem}.nos-avatar{position:absolute;inset:0;width:100%;height:100%;border-radius:.5rem;object-fit:cover;display:grid;place-items:center;background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);font-weight:800;overflow:hidden}.nos-avatar-img{background:var(--pub-surface2,#313244)}.nos-note-who{flex:1;min-width:0;cursor:pointer}.nos-note-name{display:block;font-weight:700;font-size:.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nos-note-time{display:block;font-size:.71rem;color:var(--pub-dim,#a6adc8)}.nos-nip05{font-size:.71rem;color:var(--pub-accent,#89b4fa)}.nos-follow-btn{flex:0 0 auto;padding:.28rem .55rem;font-size:.72rem}.nos-reply-of-wrap{margin:.35rem 0}.nos-reply-of-label{font-size:.72rem;color:var(--pub-fg2,#a6adc8);margin-bottom:.2rem}.nos-reply-of-wrap .nos-quote{margin:0;padding:.4rem .5rem}.nos-reply-of-wrap .nos-quote .nos-note-content{font-size:.76rem;max-height:5rem}.nos-reply-of-wrap .nos-avatar-wrap{width:1.5rem;height:1.5rem}.nos-reply-of-wrap .nos-note-name{font-size:.76rem}.nos-reply-of-wrap .nos-note-time{font-size:.66rem}.nos-note-content{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.86rem;margin:.4rem 0;overflow:hidden}.nos-note-content a{color:var(--pub-accent,#89b4fa)}.nos-mention{color:var(--pub-accent,#89b4fa);cursor:pointer}.nos-embed-link{display:block;width:100%}.nos-embed-img{display:block;max-width:100%;height:auto;max-height:22rem;border-radius:.5rem;margin-top:.4rem;object-fit:contain}.nos-embed-video{display:block;max-width:100%;height:auto;max-height:22rem;border-radius:.5rem;margin-top:.4rem;background:#000}.nos-embed-audio{display:block;width:100%;margin-top:.4rem}.nos-quote{border:1px solid var(--pub-border,#45475a);border-radius:.5rem;padding:.5rem;margin:.45rem 0;background:var(--pub-bg,#1e1e2e)}.nos-preview-card{display:flex;gap:.6rem;align-items:stretch;border:1px solid var(--pub-border,#45475a);border-radius:.5rem;margin:.45rem 0;background:var(--pub-bg,#1e1e2e);overflow:hidden;text-decoration:none;color:inherit}.nos-preview-card:hover{filter:brightness(1.08)}.nos-preview-img{width:5.5rem;flex:0 0 5.5rem;object-fit:cover;background:var(--pub-surface2,#313244)}.nos-preview-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:.15rem;padding:.5rem .55rem}.nos-preview-site{font-size:.68rem;color:var(--pub-fg2,#a6adc8);text-transform:uppercase;letter-spacing:.03em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nos-preview-title{font-size:.82rem;font-weight:700;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.nos-preview-desc{font-size:.74rem;color:var(--pub-fg2,#a6adc8);line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.nos-compose-preview:empty{display:none}.nos-quote .nos-note-content{font-size:.8rem;max-height:12rem}.nos-note-actions{display:flex;gap:.15rem;flex-wrap:wrap;margin-top:.2rem}.nos-act{background:transparent!important;padding:.3rem .45rem;font-size:.74rem;font-weight:400;color:var(--pub-fg2,#a6adc8)}.nos-act:hover{color:var(--pub-fg,#cdd6f4)}.nos-act.on{color:var(--pub-accent,#89b4fa);font-weight:700}.nos-act.nos-a-like.on{color:var(--pub-red,#f38ba8)}.nos-act.nos-a-repost.on{color:var(--pub-green,#a6e3a1)}.nos-note-translation{font-size:.82rem;line-height:1.4;font-style:italic;color:var(--pub-fg2,#a6adc8);border-top:1px dashed var(--pub-border,#45475a);padding-top:.35rem;margin-top:.2rem;overflow-wrap:anywhere;white-space:pre-wrap}.nos-modal{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;padding:1rem;z-index:20;overflow:auto}.nos-modal-card{width:100%;max-width:30rem;background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border-radius:.7rem;padding:.9rem;font-family:system-ui,sans-serif}.nos-modal-head{display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem}.nos-modal-title{flex:1;font-weight:700;font-size:.9rem}.nos-modal-input{min-height:6rem;resize:vertical}.nos-modal-foot{display:flex;gap:.4rem;justify-content:flex-end;align-items:center}.nos-modal-ctx{max-height:11rem;overflow:auto;margin-bottom:.5rem}.nos-user-head{margin-bottom:.7rem}.nos-banner{width:100%;height:6.5rem;object-fit:cover;border-radius:.5rem;background:var(--pub-surface2,#313244)}.nos-user-row{display:flex;align-items:flex-end;gap:.6rem;margin-top:-1.6rem;padding:0 .3rem}.nos-user-meta{flex:1;min-width:0;padding-bottom:.2rem}.nos-user-name{font-weight:800;font-size:1rem}.nos-user-about{font-size:.82rem;line-height:1.45;margin:.5rem 0;white-space:pre-wrap;overflow-wrap:anywhere}.nos-user-stats{font-size:.74rem;color:var(--pub-fg2,#a6adc8);display:flex;gap:.9rem;flex-wrap:wrap}.nos-notif{display:flex;gap:.5rem;align-items:flex-start;border-bottom:1px solid var(--pub-border,#45475a);padding:.55rem .1rem;cursor:pointer}.nos-notif-body{flex:1;min-width:0}.nos-notif-line{font-size:.8rem}.nos-notif-quote{font-size:.76rem;color:var(--pub-fg2,#a6adc8);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-top:.15rem}.nos-notif-time{font-size:.7rem;color:var(--pub-dim,#a6adc8)}.nos-profile-form label{display:block;font-size:.75rem;font-weight:700;color:var(--pub-fg2,#a6adc8);margin:.55rem 0 .15rem}.nos-profile-form textarea{min-height:4rem}.nos-profile-meta{margin-top:1rem;font-size:.76rem;color:var(--pub-fg2,#a6adc8)}.nos-relay-row{display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--pub-border,#45475a);font-size:.82rem;flex-wrap:wrap}.nos-relay-dot{width:.6rem;height:.6rem;border-radius:50%;flex:0 0 auto;background:var(--pub-dim,#a6adc8)}.nos-relay-open{background:var(--pub-green,#a6e3a1)}.nos-relay-connecting{background:var(--pub-yellow,#f9e2af)}.nos-relay-closed,.nos-relay-error{background:var(--pub-red,#f38ba8)}.nos-relay-url{flex:1;min-width:9rem;overflow-wrap:anywhere}.nos-relay-del{flex:0 0 auto;padding:.3rem .5rem}.nos-relay-add{display:flex;gap:.4rem;margin-top:.6rem}.nos-relay-add input{flex:1;margin:0}.nos-relay-add button{flex:0 0 auto}.nos-newposts{position:sticky;top:0;left:0;z-index:5;display:flex;align-items:center;gap:.4rem;margin:0 auto .6rem;padding:.4rem .8rem .4rem .4rem;border-radius:999px;background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);font-size:.78rem;font-weight:700;box-shadow:0 .25rem .6rem rgba(0,0,0,.25)}.nos-newposts-avatars{display:flex}.nos-newposts-avatars .nos-avatar-wrap{width:1.6rem;height:1.6rem;margin-left:-.6rem;border:2px solid var(--pub-accent,#89b4fa);border-radius:.6rem}.nos-newposts-avatars .nos-avatar-wrap:first-child{margin-left:0}.nos-newposts-avatars .nos-avatar{font-size:.68rem}.nos-people-stats{display:flex;gap:1rem;margin:.5rem 0}.nos-people-btn{background:none!important;padding:0;font-size:.8rem;font-weight:400;color:var(--pub-fg2,#a6adc8)}.nos-people-btn:hover{color:var(--pub-fg,#cdd6f4)}.nos-people-btn b{color:var(--pub-fg,#cdd6f4);font-weight:700}.nos-modal-images{display:flex;gap:.4rem;flex-wrap:wrap;margin:.3rem 0}.nos-modal-image{position:relative;width:4.5rem;height:4.5rem}.nos-modal-image img{width:100%;height:100%;object-fit:cover;border-radius:.45rem}.nos-modal-image-del{position:absolute;top:-.35rem;right:-.35rem;width:1.3rem;height:1.3rem;padding:0;border-radius:50%;background:var(--pub-red,#f38ba8)!important;color:var(--pub-bg,#1e1e2e);font-size:.65rem;line-height:1;display:flex;align-items:center;justify-content:center}.nos-modal-image-btn{background:transparent!important;font-size:1rem;padding:.4rem .5rem}.nos-modal-foot{align-items:center}.nos-identity-row{display:flex;align-items:center;gap:.5rem;padding:.45rem 0;border-bottom:1px solid var(--pub-border,#45475a)}.nos-identity-row[data-npub],.nos-identity-row[data-user]{cursor:pointer}.nos-search-input{margin:0 0 .6rem}.nos-search-results .nos-identity-row{padding:.55rem .1rem}.nos-search-results .nos-avatar-wrap{width:2.1rem;height:2.1rem}.nos-identity-row .nos-avatar-wrap{width:1.8rem;height:1.8rem}.nos-identity-label{flex:1;min-width:0;overflow-wrap:anywhere;font-size:.8rem}.nos-identity-actions{display:flex;gap:.3rem;flex:0 0 auto}.nos-identity-actions button{padding:.25rem .5rem;font-size:.72rem}.nos-identities-title{font-weight:700;font-size:.76rem;margin-top:.7rem}';document.head.appendChild(s)}

  function mount(root,opts){
    opts=opts||{};style();
    var token=localStorage.getItem('apphub_token');
    if(!token){root.innerHTML='<div class="nos-empty">'+esc(t('nos_login'))+'</div>';if(opts.onNeedLogin)opts.onNeedLogin();return{destroy:function(){}}}
    var DURATION_KEY='nos_vault_duration',TAB_KEY='nos_vault_tab',SEEN_KEY='nos_notif_seen',FEED_MODE_KEY='nos_feed_mode',ACTIVE_KEY='nos_active_npub';
    var TR_LANG_KEY='nos_translate_lang',PUB_LANG_KEY='nos_publish_lang';
    var FEED_MODES=['following','trending','discover'];
    // Anyone still carrying a saved '1', '4' or '24' from the old trending
    // windows lands on Discover rather than on a mode that no longer exists.
    var DISCOVER_LIMIT=100;
    // Popular. A relay has no ranking to offer — trending is a service built on
    // top of Nostr, not a part of the protocol — so this is the one connection
    // in the app the user did not choose themselves. Primal's cache speaks the
    // ordinary relay protocol, so the existing pool talks to it unchanged.
    //
    // Two lists rather than one, because measuring them showed they answer
    // different questions. Trending over 24h is dominated by notes old enough to
    // have gathered engagement (median age 19h), so on its own it barely moves
    // between visits. Most-zapped over 4h has a median age of 2h and turns over
    // within the hour. Merged and shown newest-first, the top of the list is
    // what is happening now and the day's big threads sit below it — and there
    // is no time window for anyone to have to pick.
    var TRENDING_URL='wss://cache2.primal.net/v1';
    var TRENDING_CACHES=['explore_global_trending_24h','explore_global_mostzapped_4h'];
    // The cache honours only the first filter of a REQ, so each list is its own
    // subscription rather than one request carrying both.
    var TRENDING_SUBS=TRENDING_CACHES.map(function(_,i){return 'trending'+i});
    // The background refresh asks the same two lists again, under its own ids, so
    // it never disturbs the subscriptions the open list is holding.
    var TRENDING_POLL_SUBS=TRENDING_CACHES.map(function(_,i){return 'poll-trending'+i});
    var TRENDING_TTL=300000;
    var PRIMAL_STATS_KIND=10000100;
    var MAX_STREAK=7;
    var key=null,privBytes=null,pubHex=null,vaultInfo=null,relays=[],autoLockTimer=0,destroyed=false,session=null;
    var _prefs={};
    fetch('/api/pub/apphub/me',{headers:{'X-Pub-Token':token}}).then(function(r){return r.ok?r.json():{}}).then(function(p){_prefs=p||{}}).catch(function(){});
    // Translate/publish target language, saved per Apps Hub account on the
    // server so it follows the user across devices instead of resetting on
    // every browser. _langPrefs starts empty and fills in once the fetch
    // below resolves; translateTargetLang/publishTargetLang fall back to
    // localStorage (pre-migration values from before this moved server-side)
    // until then, and one-time-migrate any such value up to the server.
    var _langPrefs={};
    fetch(API+'/prefs',{headers:{'X-Pub-Token':token}}).then(function(r){return r.ok?r.json():{}}).then(function(p){
      _langPrefs=p||{};
      var migrate={};
      if(!_langPrefs.translate_lang){var v=localStorage.getItem(TR_LANG_KEY);if(v)migrate.translate_lang=LEGACY_LANG_MAP[v]||v}
      if(!_langPrefs.publish_lang){var v2=localStorage.getItem(PUB_LANG_KEY);if(v2)migrate.publish_lang=LEGACY_LANG_MAP[v2]||v2}
      if(migrate.translate_lang||migrate.publish_lang){
        Object.assign(_langPrefs,migrate);
        fetch(API+'/prefs',{method:'PUT',headers:{'Content-Type':'application/json','X-Pub-Token':token},body:JSON.stringify(migrate)}).catch(function(){});
      }
      renderBody();
    }).catch(function(){});
    // The translate button and the composer's translate-before-publish button are
    // both premium-gated server-side: this flag only says whether the server has
    // turned the integration on, never anything about the viewer's own premium
    // status (the public page must never show premium messaging at all).
    var deeplEnabled=false;
    fetch(API+'/deepl-status').then(function(r){return r.ok?r.json():{}}).then(function(d){deeplEnabled=!!d.enabled;renderBody();scheduleRenderShell()}).catch(function(){});
    var translations={};
    // Values saved before the language list grew to DeepL's full set were the
    // 9 mvmOS UI locale codes (en, bg, zh-CN…) — map anyone's already-saved
    // choice onto its DeepL equivalent so it doesn't silently break.
    var LEGACY_LANG_MAP={en:'EN-US',bg:'BG',de:'DE',es:'ES',fr:'FR',ja:'JA','pt-BR':'PT-BR',ru:'RU','zh-CN':'ZH'};
    function translateTargetLang(){if(_langPrefs.translate_lang)return _langPrefs.translate_lang;var v=localStorage.getItem(TR_LANG_KEY);return LEGACY_LANG_MAP[v]||v||'EN-US'}
    function publishTargetLang(){if(_langPrefs.publish_lang)return _langPrefs.publish_lang;var v=localStorage.getItem(PUB_LANG_KEY);return LEGACY_LANG_MAP[v]||v||'EN-US'}
    // Posts to Nostradamus's own endpoint, never to the DeepL app directly:
    // the translation is a premium feature of *this* app, and only its premium
    // module can perform one. On an install without that module the route is
    // not there at all and this throws, which is the correct outcome.
    async function deeplTranslate(text,lang){
      var r=await fetch(API+'/translate',{method:'POST',headers:{'Content-Type':'application/json','X-Pub-Token':token},body:JSON.stringify({text:text,target_lang:lang||'EN-US'})});
      var d=await r.json().catch(function(){return{}});
      if(!r.ok)throw new Error(d.error||'error');
      return d.translated_text||'';
    }
    // Raw content can carry nostr: mention URIs and image/link URLs that are
    // rendered separately (quoted-note card, inline <img>) and never need
    // translating — sending them to DeepL just burns characters on gibberish.
    function textForTranslation(text){
      return text.replace(NOSTR_RE,'').replace(URL_RE,'').trim();
    }
    async function translateNote(id){
      var note=noteCache[id];if(!note)return;
      var tr=translations[id];
      if(tr&&tr.status==='done'){tr.shown=!tr.shown;renderBody();return}
      translations[id]={status:'loading',shown:true};
      renderBody();
      try{
        var text=await deeplTranslate(textForTranslation(note.content),translateTargetLang());
        translations[id]={status:'done',shown:true,text:text};
      }catch(_){translations[id]={status:'error',shown:true}}
      renderBody();
    }
    // All of the owner's identities (from GET /vaults); vaultInfo is whichever one
    // is active. addMode/switcherOpen drive the onboarding screen and the identity
    // switcher panel reused for "add another identity" and "switch identity".
    var identities=[],addMode=false,switcherOpen=false;
    var scrollReset=false;
    var searchQuery='',searchResults=[],searchSeq=0,searchBusy=false,searchDebounce=0;
    var activeTab='feed',feedMode=FEED_MODES.indexOf(localStorage.getItem(FEED_MODE_KEY))>=0?localStorage.getItem(FEED_MODE_KEY):'following',stack=[];
    var feedItems=[],feedKeys={},feedLoaded=false,feedToken=0;
    var pendingItems=[],pendingKeys={};
    // How many unseen following-feed items are waiting while Discover is the
    // active mode — shown as a badge on the Following button. Discover needs no
    // badge of its own: it holds an open subscription whenever it is on screen
    // and puts what arrives straight into its own "new posts" pill.
    // modeSeenKeys stops the background poll from re-counting the same note on
    // every tick; modeSeenInit seeds it silently on the first poll instead of
    // counting whatever it happens to find as "new".
    var modeCounts={following:0,trending:0,discover:0};
    // Engagement counts as the ranking service measured them, network-wide.
    // Kept apart from `stats`, which counts only what the user's own relays
    // happen to store: merging the two would either double-count the same
    // reaction or replace a network-wide number with a much smaller local one.
    var netStats={};
    var trendingFailed=false,trendingAt=0;
    var modeSeenKeys={following:{},trending:{}};
    var modeSeenInit={following:false,trending:false};
    var modePollTimer=0;
    var contactPubkeys=[];
    var profileCache={},noteCache={},stats={},myReactions={},myReposts={},ownProfileRaw={};
    var notifItems=[],notifKeys={},notifLoaded=false,notifSeen=Number(localStorage.getItem(SEEN_KEY)||0);
    var threadReplies=[],threadKeys={},threadLoaded=false;
    var userNotes=[],userKeys={},userLoaded=false;
    var peopleList=[],peopleKeys={},peopleLoaded=false;
    var composer=null;
    var obStep='choose',obPriv=null;
    function blankRecover(){return{nsec:'',pass:'',confirm:'',duration:''}}
    var recoverForm=blankRecover();
    // Builds before this one cached the raw exported AES key in Web Storage. That
    // entry is dead code now, but leaving it on disk would keep the exact secret
    // this vault stopped storing — so an upgraded install drops it on first run.
    try{localStorage.removeItem('nos_vault_session');sessionStorage.removeItem('nos_vault_session')}catch(_){}
    var pool=createPool();
    root.style.position='relative';
    function bindPool(){pool.onStatusChange(function(){if(activeTab==='relays'&&!stack.length)renderRelayList()})}
    bindPool();

    function api(path,options){options=options||{};var h=Object.assign({'X-Pub-Token':token,'Content-Type':'application/json'},options.headers||{});return fetch(API+path,Object.assign({},options,{headers:h})).then(async function(r){var d=await r.json().catch(function(){return{}});if(r.status===401&&opts.onNeedLogin)opts.onNeedLogin();if(!r.ok)throw new Error(d.error||'error');return d})}
    // Not extractable: the session is stored as this CryptoKey object itself, so
    // there is never a moment where the raw AES material exists as bytes in the page.
    async function derive(password,salt,iterations){var raw=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(salt),iterations:iterations,hash:'SHA-256'},raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
    async function encryptWithKey(k,rawBytes){var iv=crypto.getRandomValues(new Uint8Array(12));var data=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},k,rawBytes);return{iv:b64(iv),ciphertext:b64(data)}}
    function encryptPriv(rawBytes){return encryptWithKey(key,rawBytes)}
    async function decryptPriv(ivB64,ctB64){var out=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(ivB64)},key,bytes(ctB64));return new Uint8Array(out)}
    function minutesOf(value){return value==='session'?0:Number(value)||0}
    function dayStamp(){var now=new Date();return now.getFullYear()+'-'+(now.getMonth()+1)+'-'+now.getDate()}
    // A window that only counts down punishes the habit it should reward: pick 24
    // hours, open the app every day, and a single skipped day still costs you the
    // password. Every fresh day the session is actually used adds one more multiple
    // of the chosen base, up to seven — so a daily user drifts toward a week of
    // slack and stops being asked, while a vault left alone falls back to its base.
    function windowMinutes(saved){return saved.minutes*Math.min(Math.max(saved.streak||1,1),MAX_STREAK)}
    function expiryOf(saved){return saved.minutes?Date.now()+windowMinutes(saved)*60000:0}
    function scheduleAutoLock(expires){clearTimeout(autoLockTimer);if(!expires)return;var remaining=expires-Date.now();if(remaining<=0){lockNow();return}autoLockTimer=setTimeout(lockNow,remaining)}
    // "Until tab is closed" has to outlive nothing at all, but IndexedDB outlives
    // everything — so that mode is tied to a marker that only this tab's
    // sessionStorage holds, and a session whose tab is gone is unusable by design.
    function tabMarker(){var mark=sessionStorage.getItem(TAB_KEY);if(!mark){mark=b64(crypto.getRandomValues(new Uint8Array(12)));try{sessionStorage.setItem(TAB_KEY,mark)}catch(_){}}return mark}
    function saveSession(saved){idbPut(vaultInfo.npub,saved)}
    function renewSession(saved){
      if(!saved||!saved.minutes)return saved;
      var today=dayStamp();
      if(saved.day!==today){saved.streak=Math.min((saved.streak||1)+1,MAX_STREAK);saved.day=today}
      saved.expires=expiryOf(saved);
      saveSession(saved);
      return saved;
    }
    // A freshly typed password starts the streak over: the window is earned by
    // uninterrupted use, and this unlock is proof the previous run was interrupted.
    function buildSession(k,value){
      var minutes=minutesOf(value),saved={key:k,minutes:minutes,streak:1,day:dayStamp(),tab:minutes?null:tabMarker()};
      saved.expires=expiryOf(saved);
      return saved;
    }
    function cacheKey(value){
      var saved=buildSession(key,value);
      session=saved;
      scheduleAutoLock(saved.expires);
      try{localStorage.setItem(DURATION_KEY,value)}catch(_){}
      return idbPut(vaultInfo.npub,saved);
    }
    async function readSession(){
      var saved=await idbGet(vaultInfo.npub);
      if(!saved)return null;
      var alive=saved.minutes?saved.expires>Date.now():!!saved.tab&&saved.tab===sessionStorage.getItem(TAB_KEY);
      if(!alive){await idbDel(vaultInfo.npub);return null}
      return saved;
    }
    async function restoreLocalKey(){
      var saved=await readSession();
      if(!saved)return false;
      try{
        key=saved.key;
        privBytes=await decryptPriv(vaultInfo.iv,vaultInfo.ciphertext);
        pubHex=bytesToHex(getXOnlyPubkey(privBytes));
        session=renewSession(saved);
        scheduleAutoLock(session.expires);
        return true;
      }catch(_){await idbDel(vaultInfo.npub);key=null;privBytes=null;session=null;return false}
    }
    function onVisible(){
      if(document.hidden||!key)return;
      readSession().then(function(saved){
        if(!key)return;
        if(!saved){lockNow();return}
        session=renewSession(saved);
        scheduleAutoLock(session.expires);
      });
    }
    function clearCachedKey(){return idbDel(vaultInfo.npub)}
    function fmtTime(d){return _prefs.time_format?d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:_prefs.time_format==='12'}):d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}
    function fmtDate(d){return _prefs.date_format==='MM/DD/YYYY'?(d.getMonth()+1)+'/'+d.getDate()+'/'+d.getFullYear():_prefs.date_format==='YYYY-MM-DD'?d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'):_prefs.date_format==='DD/MM/YYYY'?d.getDate()+'/'+(d.getMonth()+1)+'/'+d.getFullYear():d.toLocaleDateString()}
    function lockedAtHint(){return session&&session.expires?t('nos_locks_at',{time:fmtDate(new Date(session.expires))+' '+fmtTime(new Date(session.expires))}):t('nos_lock')}
    function resetState(){
      clearTimeout(autoLockTimer);autoLockTimer=0;clearTimeout(renderTimer);clearTimeout(profileTimer);clearTimeout(noteTimer);
      clearTimeout(searchDebounce);searchQuery='';searchResults=[];searchBusy=false;searchSeq++;
      stopModePolling();
      key=null;privBytes=null;pubHex=null;session=null;composer=null;stack=[];activeTab='feed';
      feedItems=[];feedKeys={};feedLoaded=false;feedToken++;contactPubkeys=[];
      modeCounts={following:0,trending:0,discover:0};quietProfiles={};modeSeenKeys={following:{},trending:{}};modeSeenInit={following:false,trending:false};
      netStats={};trendingFailed=false;
      pendingItems=[];pendingKeys={};
      profileCache={};noteCache={};stats={};myReactions={};myReposts={};ownProfileRaw={};
      notifItems=[];notifKeys={};notifLoaded=false;profileQueue=[];noteQueue=[];
      clearCachedKey();pool.destroy();pool=createPool();bindPool();
    }
    function lockNow(){resetState();load()}
    function switchIdentity(npub){try{localStorage.setItem(ACTIVE_KEY,npub)}catch(_){}remount()}
    async function logoutIdentity(npub){
      await idbDel(npub);
      var other=identities.filter(function(v){return v.npub!==npub})[0];
      try{if(other)localStorage.setItem(ACTIVE_KEY,other.npub);else localStorage.removeItem(ACTIVE_KEY)}catch(_){}
      remount();
    }
    async function removeIdentity(npub){
      if(!confirm(t('nos_identity_confirm_remove')))return;
      try{await api('/vault?npub='+encodeURIComponent(npub),{method:'DELETE'})}catch(_){return}
      await idbDel(npub);
      if(npub===vaultInfo.npub){
        var other=identities.filter(function(v){return v.npub!==npub})[0];
        try{if(other)localStorage.setItem(ACTIVE_KEY,other.npub);else localStorage.removeItem(ACTIVE_KEY)}catch(_){}
      }
      remount();
    }
    function shortNpub(n){return n.slice(0,12)+'…'+n.slice(-6)}
    function closeSwitcher(){switcherOpen=false;renderSwitcher()}
    function startAddIdentity(){closeSwitcher();addMode=true;obStep='choose';obPriv=null;onboardingScreen()}
    function renderSwitcher(){
      var existing=root.querySelector('.nos-switcher');
      if(existing)existing.remove();
      if(!switcherOpen||!key)return;
      var wrap=document.createElement('div');
      wrap.className='nos-modal nos-switcher';
      wrap.innerHTML='<div class="nos-modal-card"><div class="nos-modal-head"><span class="nos-modal-title">'+esc(t('nos_switch_identity'))+'</span><button type="button" class="nos-modal-close">✕</button></div>'+
        identities.map(function(v){
          var active=v.npub===vaultInfo.npub,hex=active?pubHex:npubDecode(v.npub);
          if(hex)ensureProfile(hex);
          return'<div class="nos-identity-row"'+(active?'':' data-npub="'+esc(v.npub)+'"')+'>'+
            (hex?avatarHtml(hex):'<span class="nos-avatar-wrap"><span class="nos-avatar">?</span></span>')+
            '<span class="nos-identity-label">'+esc(hex?displayName(hex):shortNpub(v.npub))+(active?' — '+esc(t('nos_identity_current')):'')+'</span>'+
            '</div>';
        }).join('')+
        '<button type="button" class="nos-link nos-switcher-add">'+esc(t('nos_add_identity'))+'</button></div>';
      root.appendChild(wrap);
      wrap.querySelector('.nos-modal-close').onclick=closeSwitcher;
      wrap.querySelectorAll('.nos-identity-row[data-npub]').forEach(function(row){row.onclick=function(){switchIdentity(row.dataset.npub)}});
      wrap.querySelector('.nos-switcher-add').onclick=startAddIdentity;
    }

    function writeUrls(){return relays.filter(function(r){return r.write}).map(function(r){return r.url})}
    function readUrls(){return relays.filter(function(r){return r.read}).map(function(r){return r.url})}

    function durationOptions(){return'<option value="5">'+esc(t('nos_minutes',{n:5}))+'</option><option value="15">'+esc(t('nos_minutes',{n:15}))+'</option><option value="60">'+esc(t('nos_hour'))+'</option><option value="240">'+esc(t('nos_hours',{n:4}))+'</option><option value="1440">'+esc(t('nos_hours',{n:24}))+'</option><option value="10080">'+esc(t('nos_days',{n:7}))+'</option><option value="session">'+esc(t('nos_until_closed'))+'</option>'}
    function durationBlock(){return'<label class="nos-duration-label">'+esc(t('nos_unlock_for'))+'</label><select class="nos-duration">'+durationOptions()+'</select><div class="nos-duration-hint">'+esc(t('nos_unlock_sliding'))+'</div>'}
    function applyDuration(){var select=root.querySelector('.nos-duration');if(select)select.value=localStorage.getItem(DURATION_KEY)||'15';return select}

    function formatTime(ts){var diff=Math.floor(Date.now()/1000)-ts;if(diff<60)return t('nos_just_now');if(diff<3600)return t('nos_minutes_ago',{n:Math.floor(diff/60)});if(diff<86400)return t('nos_hours_ago',{n:Math.floor(diff/3600)});if(diff<604800)return t('nos_days_ago',{n:Math.floor(diff/86400)});return fmtDate(new Date(ts*1000))}

    // ---- onboarding ----
    function onboardingScreen(error){
      if(obStep==='choose'){
        var cancel=addMode?'<button type="button" class="nos-ob-cancel">'+esc(t('nos_back'))+'</button>':'';
        root.innerHTML='<div class="nos nos-onboard"><div class="nos-card"><h2>'+esc(addMode?t('nos_add_identity_title'):t('nos_welcome_title'))+'</h2><p>'+esc(t('nos_welcome_info'))+'</p><button class="primary nos-ob-generate">'+esc(t('nos_generate_key'))+'</button><button class="nos-ob-import">'+esc(t('nos_import_key'))+'</button>'+cancel+'<div class="nos-error">'+esc(error||'')+'</div></div></div>';
        root.querySelector('.nos-ob-generate').onclick=function(){obPriv=genPrivKey();obStep='reveal';onboardingScreen()};
        root.querySelector('.nos-ob-import').onclick=function(){obStep='import';onboardingScreen()};
        if(addMode)root.querySelector('.nos-ob-cancel').onclick=function(){addMode=false;renderShell()};
        return;
      }
      if(obStep==='reveal'){
        var nsec=nsecEncode(bytesToHex(obPriv));
        root.innerHTML='<div class="nos nos-onboard"><div class="nos-card"><h2>'+esc(t('nos_your_key'))+'</h2><p>'+esc(t('nos_key_warning'))+'</p><div class="nos-view-value nos-key-value">'+esc(nsec)+'</div><button type="button" class="nos-copy-key">'+esc(t('nos_copy'))+'</button><label class="nos-check"><input type="checkbox" class="nos-saved-check"> '+esc(t('nos_key_saved_confirm'))+'</label><button class="primary nos-ob-continue" disabled>'+esc(t('nos_continue'))+'</button><button class="nos-ob-back">'+esc(t('nos_back'))+'</button><div class="nos-error">'+esc(error||'')+'</div></div></div>';
        var check=root.querySelector('.nos-saved-check'),cont=root.querySelector('.nos-ob-continue');
        check.onchange=function(){cont.disabled=!check.checked};
        root.querySelector('.nos-copy-key').onclick=function(){if(navigator.clipboard)navigator.clipboard.writeText(nsec)};
        cont.onclick=function(){obStep='password';onboardingScreen()};
        root.querySelector('.nos-ob-back').onclick=function(){obStep='choose';obPriv=null;onboardingScreen()};
        return;
      }
      if(obStep==='import'){
        root.innerHTML='<div class="nos nos-onboard"><div class="nos-card"><h2>'+esc(t('nos_import_key'))+'</h2><p>'+esc(t('nos_import_info'))+'</p><input class="nos-import-input" type="password" placeholder="'+esc(t('nos_import_placeholder'))+'"><button class="primary nos-ob-import-go">'+esc(t('nos_continue'))+'</button><button class="nos-ob-back">'+esc(t('nos_back'))+'</button><div class="nos-error">'+esc(error||'')+'</div></div></div>';
        root.querySelector('.nos-ob-back').onclick=function(){obStep='choose';onboardingScreen()};
        root.querySelector('.nos-ob-import-go').onclick=function(){
          var raw=root.querySelector('.nos-import-input').value.trim();
          var privHex=raw.indexOf('nsec1')===0?nsecDecode(raw):(/^[0-9a-fA-F]{64}$/.test(raw)?raw:null);
          if(!privHex){obStep='import';onboardingScreen(t('nos_invalid_key'));return}
          try{obPriv=hexToBytes(privHex);getXOnlyPubkey(obPriv)}catch(_){obStep='import';onboardingScreen(t('nos_invalid_key'));return}
          obStep='password';onboardingScreen();
        };
        return;
      }
      if(obStep==='password'){
        root.innerHTML='<div class="nos nos-unlock"><div><h2>'+esc(t('nos_create_title'))+'</h2><p>'+esc(t('nos_create_info'))+'</p><input class="nos-master" type="password" autocomplete="new-password" placeholder="'+esc(t('nos_master'))+'"><input class="nos-confirm" type="password" autocomplete="new-password" placeholder="'+esc(t('nos_confirm_master'))+'">'+durationBlock()+'<div class="nos-error">'+esc(error||'')+'</div><button class="primary nos-ob-finish">'+esc(t('nos_create'))+'</button><button class="nos-ob-back">'+esc(t('nos_back'))+'</button></div></div>';
        var select=applyDuration();
        root.querySelector('.nos-ob-back').onclick=function(){obStep='choose';obPriv=null;onboardingScreen()};
        root.querySelector('.nos-ob-finish').onclick=async function(){
          var pass=root.querySelector('.nos-master').value,confirmPass=root.querySelector('.nos-confirm').value;
          if(pass.length<MIN_MASTER){onboardingScreen(t('nos_password_short',{n:MIN_MASTER}));return}
          if(pass!==confirmPass){onboardingScreen(t('nos_passwords_differ'));return}
          var priv=obPriv,pubHexLocal=bytesToHex(getXOnlyPubkey(priv)),npub=npubEncode(pubHexLocal);
          if(identities.some(function(v){return v.npub===npub})){onboardingScreen(t('nos_identity_exists'));return}
          try{
            var salt=b64(crypto.getRandomValues(new Uint8Array(32)));
            var newKey=await derive(pass,salt,600000);
            var enc=await encryptWithKey(newKey,priv);
            await api('/vault',{method:'POST',body:JSON.stringify({npub:npub,salt:salt,iterations:600000,iv:enc.iv,ciphertext:enc.ciphertext})});
            var saved=buildSession(newKey,select.value);
            await idbPut(npub,saved);
            try{localStorage.setItem(DURATION_KEY,select.value);localStorage.setItem(ACTIVE_KEY,npub)}catch(_){}
            obPriv=null;
            // In "add another identity" mode the currently active identity stays fully
            // untouched in memory (module key/vaultInfo were never reassigned above) —
            // the reload is what actually switches over to the new one.
            if(addMode){addMode=false;remount();return}
            key=newKey;privBytes=priv;pubHex=pubHexLocal;
            vaultInfo={npub:npub,salt:salt,iterations:600000,iv:enc.iv,ciphertext:enc.ciphertext};
            identities=[vaultInfo];session=saved;
            scheduleAutoLock(saved.expires);
            await afterUnlock();
          }catch(_){key=null;onboardingScreen(t('nos_save_error'))}
        };
        return;
      }
    }

    function unlockScreen(error){
      root.innerHTML='<div class="nos nos-unlock"><div><h2>'+esc(t('nos_unlock'))+'</h2><p>'+esc(t('nos_unlock_info'))+'</p><input class="nos-master" type="password" autocomplete="current-password" placeholder="'+esc(t('nos_master'))+'">'+durationBlock()+'<div class="nos-error">'+esc(error||'')+'</div><button class="primary nos-unlock-go">'+esc(t('nos_unlock'))+'</button><button type="button" class="nos-link nos-forgot">'+esc(t('nos_forgot'))+'</button></div></div>';
      var select=applyDuration();
      var input=root.querySelector('.nos-master'),go=root.querySelector('.nos-unlock-go');
      go.onclick=async function(){
        var pass=input.value;
        if(!pass){unlockScreen(t('nos_unlock_failed'));return}
        try{
          key=await derive(pass,vaultInfo.salt,vaultInfo.iterations);
          privBytes=await decryptPriv(vaultInfo.iv,vaultInfo.ciphertext);
          pubHex=bytesToHex(getXOnlyPubkey(privBytes));
          await cacheKey(select.value);
          await afterUnlock();
        }catch(_){key=null;privBytes=null;unlockScreen(t('nos_unlock_failed'))}
      };
      root.querySelector('.nos-forgot').onclick=function(){recoverForm=blankRecover();recoverScreen()};
      input.onkeydown=function(e){if(e.key==='Enter')go.click()};
      setTimeout(function(){input.focus()},30);
    }

    // A forgotten master password used to be the end of the account: the vault is
    // undecryptable and nothing in the UI offered a way past it. The private key is
    // the real credential though — proving you hold it is at least as strong as the
    // password it replaces, so it can mint a new one. A key that turns out to
    // belong to a different identity is rejected here rather than silently
    // overwriting this vault — that identity gets added alongside it instead,
    // through "Add account".
    function recoverScreen(error){
      root.innerHTML='<div class="nos nos-unlock"><div><h2>'+esc(t('nos_reset_title'))+'</h2><p>'+esc(t('nos_reset_info'))+'</p>'+
        '<input class="nos-r-key" type="password" autocomplete="off" placeholder="'+esc(t('nos_import_placeholder'))+'">'+
        '<input class="nos-r-pass" type="password" autocomplete="new-password" placeholder="'+esc(t('nos_master'))+'">'+
        '<input class="nos-r-confirm" type="password" autocomplete="new-password" placeholder="'+esc(t('nos_confirm_master'))+'">'+
        durationBlock()+
        '<div class="nos-error">'+esc(error||'')+'</div><button class="primary nos-r-go">'+esc(t('nos_reset_go'))+'</button><button type="button" class="nos-r-back">'+esc(t('nos_back'))+'</button></div></div>';
      var select=applyDuration();
      // Confirming the identity swap re-renders this screen, so what was typed is
      // carried across as values rather than markup — a password does not belong in
      // an HTML attribute, even one only this page will ever read.
      var keyInput=root.querySelector('.nos-r-key'),passInput=root.querySelector('.nos-r-pass'),confirmInput=root.querySelector('.nos-r-confirm');
      keyInput.value=recoverForm.nsec;passInput.value=recoverForm.pass;confirmInput.value=recoverForm.confirm;
      if(recoverForm.duration)select.value=recoverForm.duration;
      function readForm(){
        recoverForm.nsec=keyInput.value.trim();
        recoverForm.pass=passInput.value;
        recoverForm.confirm=confirmInput.value;
        recoverForm.duration=select.value;
      }
      root.querySelector('.nos-r-back').onclick=function(){recoverForm=blankRecover();unlockScreen()};
      root.querySelector('.nos-r-go').onclick=async function(){
        readForm();
        var raw=recoverForm.nsec;
        var privHex=raw.indexOf('nsec1')===0?nsecDecode(raw):(/^[0-9a-fA-F]{64}$/.test(raw)?raw:null);
        var priv=null,pubHexLocal=null;
        if(privHex){try{priv=hexToBytes(privHex);pubHexLocal=bytesToHex(getXOnlyPubkey(priv))}catch(_){priv=null}}
        if(!priv){recoverScreen(t('nos_invalid_key'));return}
        var npub=npubEncode(pubHexLocal);
        if(npub!==vaultInfo.npub){recoverScreen(t('nos_reset_wrong_key'));return}
        if(recoverForm.pass.length<MIN_MASTER){recoverScreen(t('nos_password_short',{n:MIN_MASTER}));return}
        if(recoverForm.pass!==recoverForm.confirm){recoverScreen(t('nos_passwords_differ'));return}
        var chosen=select.value;
        try{
          var salt=b64(crypto.getRandomValues(new Uint8Array(32)));
          key=await derive(recoverForm.pass,salt,600000);
          var enc=await encryptPriv(priv);
          var body={salt:salt,iterations:600000,iv:enc.iv,ciphertext:enc.ciphertext};
          await api('/vault?target_npub='+encodeURIComponent(vaultInfo.npub),{method:'PUT',body:JSON.stringify(body)});
          vaultInfo={npub:npub,salt:salt,iterations:600000,iv:enc.iv,ciphertext:enc.ciphertext};
          privBytes=priv;pubHex=pubHexLocal;
          recoverForm=blankRecover();
          await cacheKey(chosen);
          await afterUnlock();
        }catch(_){key=null;privBytes=null;recoverScreen(t('nos_save_error'))}
      };
      setTimeout(function(){root.querySelector('.nos-r-key').focus()},30);
    }

    async function load(){
      if(destroyed)return;
      try{var data=await api('/vaults');identities=data.vaults||[]}catch(_){root.innerHTML='<div class="nos-empty">'+esc(t('nos_load_error'))+'</div>';return}
      if(!identities.length){vaultInfo=null;obStep='choose';obPriv=null;onboardingScreen();return}
      var active=localStorage.getItem(ACTIVE_KEY);
      vaultInfo=identities.filter(function(v){return v.npub===active})[0]||identities[0];
      try{localStorage.setItem(ACTIVE_KEY,vaultInfo.npub)}catch(_){}
      var restored=await restoreLocalKey();
      if(restored){await afterUnlock();return}
      unlockScreen();
    }

    async function loadRelays(){
      var data=await api('/relays');
      relays=(data.relays&&data.relays.length)?data.relays:DEFAULT_RELAYS.map(function(u){return{url:u,read:1,write:1}});
      pool.setRelayUrls(relays.map(function(r){return r.url}),[TRENDING_URL]);
    }

    async function afterUnlock(){
      await loadRelays();
      renderShell();
      subscribeSelfMeta();
      subscribeContacts();
      loadNotifications();
    }

    // ---- profiles, notes and counters, fetched in batches ----
    // One subscription per pubkey was survivable for a feed of people you follow
    // and hopeless for a trending window, where fifty strangers appear at once.
    // Everything that needs looking up is queued, debounced and asked for in a
    // single REQ instead.
    var profileQueue=[],profileTimer=0,profileSubId=0;
    var noteQueue=[],noteTimer=0,noteSubId=0;
    var renderTimer=0;
    function scheduleRender(){clearTimeout(renderTimer);renderTimer=setTimeout(function(){renderBody();if(switcherOpen)renderSwitcher()},140)}
    var shellRenderTimer=0,pillTimer=0,quietProfiles={};
    function scheduleRenderShell(){clearTimeout(shellRenderTimer);shellRenderTimer=setTimeout(function(){if(key)renderShell()},140)}
    function parseProfile(ev){
      var data={};try{data=JSON.parse(ev.content)||{}}catch(_){}
      return{created_at:ev.created_at,raw:data,name:data.display_name||data.name||'',handle:data.name||'',
             about:data.about||'',picture:data.picture||'',banner:data.banner||'',website:data.website||'',nip05:data.nip05||''};
    }
    // `quiet` marks a profile wanted only for a post waiting behind the pill.
    // Nothing on screen is showing that author yet, so when the profile lands
    // there is nothing to redraw but the pill itself — and redrawing the feed for
    // it is exactly what made Discover flash, since a steady stream of new posts
    // is a steady stream of unknown authors.
    function ensureProfile(pk,quiet){
      if(!pk||profileCache[pk]!==undefined)return;
      if(quiet)quietProfiles[pk]=1;
      profileCache[pk]=null;
      profileQueue.push(pk);
      clearTimeout(profileTimer);profileTimer=setTimeout(flushProfiles,180);
    }
    function flushProfiles(){
      var batch=profileQueue.splice(0,profileQueue.length);
      if(!batch.length||!readUrls().length)return;
      var subId='meta-'+(++profileSubId);
      pool.subscribe(readUrls(),subId,[{kinds:[0],authors:batch}],function(ev){
        var prev=profileCache[ev.pubkey];
        if(prev&&prev.created_at>=ev.created_at)return;
        profileCache[ev.pubkey]=parseProfile(ev);
        if(ev.pubkey===pubHex){ownProfileRaw=profileCache[ev.pubkey].raw||{};scheduleRenderShell()}
        var quiet=quietProfiles[ev.pubkey];delete quietProfiles[ev.pubkey];
        if(quiet)schedulePill();else scheduleRender();
      },function(){pool.unsubscribe(subId)});
    }
    function ensureNote(id){
      if(!id||noteCache[id]!==undefined)return;
      noteCache[id]=null;
      noteQueue.push(id);
      clearTimeout(noteTimer);noteTimer=setTimeout(flushNotes,180);
    }
    function flushNotes(){
      var batch=noteQueue.splice(0,noteQueue.length);
      if(!batch.length||!readUrls().length)return;
      var subId='note-'+(++noteSubId);
      pool.subscribe(readUrls(),subId,[{ids:batch}],function(ev){
        noteCache[ev.id]=ev;ensureProfile(ev.pubkey);
        scheduleRender();
      },function(){pool.unsubscribe(subId)});
    }
    function statOf(id){return stats[id]||(stats[id]={replies:0,reposts:0,likes:0,seen:{}})}
    // Reply, repost and like counts for whatever is on screen, in one live
    // subscription that is replaced whenever the visible set changes.
    function refreshStats(ids){
      ids=ids.filter(function(id){return!!id}).slice(0,120);
      pool.unsubscribe('stats');
      if(!ids.length||!readUrls().length)return;
      pool.subscribe(readUrls(),'stats',[{kinds:[1,6,7],'#e':ids}],function(ev){
        var target=targetOf(ev);
        if(!target||ids.indexOf(target)<0)return;
        var s=statOf(target);
        if(s.seen[ev.id])return;
        s.seen[ev.id]=1;
        if(ev.kind===1)s.replies++;
        else if(ev.kind===6){s.reposts++;if(ev.pubkey===pubHex)myReposts[target]=ev.id}
        else if(ev.kind===7){s.likes++;if(ev.pubkey===pubHex)myReactions[target]=ev.id}
        scheduleRender();
      });
    }

    function subscribeSelfMeta(){
      ensureProfile(pubHex);
      pool.subscribe(readUrls(),'self-meta',[{kinds:[0],authors:[pubHex],limit:1}],function(ev){
        var prev=profileCache[pubHex];
        if(prev&&prev.created_at>=ev.created_at)return;
        profileCache[pubHex]=parseProfile(ev);
        ownProfileRaw=profileCache[pubHex].raw||{};
        scheduleRenderShell();
        scheduleRender();
      },function(){pool.unsubscribe('self-meta')});
    }
    function subscribeContacts(){
      pool.subscribe(readUrls(),'contacts',[{kinds:[3],authors:[pubHex],limit:1}],function(ev){
        contactPubkeys=tagsOf(ev,'p').map(function(tg){return tg[1]}).filter(Boolean);
        if(activeTab==='feed'&&feedMode==='following')loadFeed();
      },function(){pool.unsubscribe('contacts');if(activeTab==='feed'&&feedMode==='following'&&!feedItems.length)loadFeed()});
    }

    // ---- feed ----
    function pushItem(item){
      if(feedKeys[item.key])return;
      feedKeys[item.key]=1;
      var i=0;while(i<feedItems.length&&feedItems[i].at>item.at)i++;
      feedItems.splice(i,0,item);
      if(feedItems.length>200)feedItems.length=200;
      scheduleRender();
    }
    // Once the initial batch has loaded, notes that trickle in live no longer
    // jump straight into the list — that reflows whatever the user is reading,
    // same problem X.com's feed had before it gated new posts behind a button.
    // They wait in pendingItems until acceptPending() merges them in.
    function pushPending(item){
      if(feedKeys[item.key]||pendingKeys[item.key])return;
      // What you just posted yourself is not news to you. It used to land behind
      // the pill like everyone else's, so publishing a note announced "1 new
      // post" and made you press a button to see your own writing. Yours goes
      // straight into the list; a repost of it by somebody else still counts,
      // because there the new event is theirs, not yours.
      var author=item.boost?item.boost.pubkey:(noteCache[item.noteId]||{}).pubkey;
      if(author&&author===pubHex){pushItem(item);return}
      pendingKeys[item.key]=1;
      pendingItems.push(item);
      if(pendingItems.length>40)pendingItems.length=40;
      schedulePill();
    }
    // A post arriving while you read changes nothing in the list on screen — it
    // changes only the pill above it. Repainting the feed for that rebuilds every
    // note, reloads every image and re-queries every engagement count, and on
    // Discover, where notes stream in continuously, it reads as the whole screen
    // flashing. So the pill is patched in place and the list is left alone.
    function schedulePill(){clearTimeout(pillTimer);pillTimer=setTimeout(renderPendingPill,140)}
    function renderPendingPill(){
      var body=root.querySelector('.nos-body');
      if(!body||stack.length||activeTab!=='feed')return;
      var cur=body.querySelector('.nos-newposts'),html=pendingHtml();
      if(!html){if(cur)cur.remove();return}
      var tmp=document.createElement('div');tmp.innerHTML=html;
      var el=tmp.firstChild;
      el.onclick=function(e){e.stopPropagation();acceptPending()};
      if(cur)body.replaceChild(el,cur);else body.insertBefore(el,body.firstChild);
      bindImages(el);
    }
    function acceptPending(){
      quietProfiles={};
      pendingItems.forEach(function(item){delete pendingKeys[item.key];pushItem(item)});
      pendingItems=[];
      var body=root.querySelector('.nos-body');
      if(body)body.scrollTop=0;
      scheduleRender();
    }
    function addFeedEvent(ev){
      // Both modes hold an open subscription now, so anything arriving after the
      // stored batch is genuinely new and belongs behind the pill.
      var live=feedLoaded;
      if(ev.kind===6){
        var targetId=lastETag(ev);
        if(!targetId)return;
        var embedded=null;try{embedded=JSON.parse(ev.content)}catch(_){}
        // NIP-18 lets the repost carry the original inline; using it saves a
        // round trip, but only when it really is the event the tag points at.
        if(embedded&&embedded.id===targetId&&embedded.kind===1){noteCache[targetId]=embedded;ensureProfile(embedded.pubkey,live)}
        else ensureNote(targetId);
        ensureProfile(ev.pubkey,live);
        (live?pushPending:pushItem)({key:'boost:'+ev.id,noteId:targetId,boost:ev,at:ev.created_at});
        return;
      }
      if(ev.kind!==1)return;
      noteCache[ev.id]=ev;ensureProfile(ev.pubkey,live);
      (live?pushPending:pushItem)({key:ev.id,noteId:ev.id,boost:null,at:ev.created_at});
    }
    // Every other connection in this app is a relay the user picked. The ranking
    // cache is not, so what comes back from it is checked rather than trusted:
    // the id must be the hash of the event and the signature must match the
    // author's key. That bounds what a compromised ranking service can do to
    // choosing which real notes to show — it cannot put words in anyone's mouth.
    // Verification is per event as it streams in, so the cost never lands as one
    // block on the main thread.
    async function verifyEvent(ev){
      try{
        if(!ev||!ev.id||!ev.sig||!ev.pubkey||!Array.isArray(ev.tags))return false;
        var idBytes=await sha256(new TextEncoder().encode(serializeEvent(ev)));
        if(bytesToHex(idBytes)!==ev.id)return false;
        return window.NostrCrypto.schnorr.verify(hexToBytes(ev.sig),idBytes,hexToBytes(ev.pubkey));
      }catch(_){return false}
    }
    // The cache answers with the notes, the profiles behind them and its own
    // engagement counts in one stream, so a popular note arrives ready to draw:
    // no follow-up query for the author's avatar and none for the numbers.
    //
    // The same request serves both the first load and the background refresh.
    // Nothing already on screen moves on a refresh: a note the list did not have
    // waits behind the "new posts" pill exactly as in the other two modes, so the
    // ranking can keep changing underneath without costing the reader their
    // place. When Popular is not the open mode the new notes raise its badge
    // instead. Either way the ranking goes on being checked, which is the point —
    // nothing here should need reloading the app to notice that it moved.
    function fetchTrending(token,poll){
      var subs=poll?TRENDING_POLL_SUBS:TRENDING_SUBS;
      // Seeding. The very first answer is the state of the world, not news about
      // it: without this, opening the app on Following and letting the poll run
      // once would stamp the Popular button with the size of the whole ranking.
      var firstRun=!modeSeenInit.trending;
      if(!poll)trendingFailed=false;
      trendingAt=Date.now();
      var pendingSubs=subs.length,pendingChecks=0,got=0,eosed=false;
      // Signature checks are asynchronous, so the last EOSE is not the end of the
      // load: settling on it alone would flash the empty state over a list that
      // is about to arrive, and would call a working service dead.
      function settle(){
        if(!eosed||pendingChecks>0)return;
        modeSeenInit.trending=true;
        if(poll){subs.forEach(function(id){pool.unsubscribe(id)});return}
        if(token!==feedToken)return;
        feedLoaded=true;
        trendingFailed=got===0;
        scheduleRender();
      }
      subs.forEach(function(subId,i){
        if(poll)pool.unsubscribe(subId);
        pool.subscribe([TRENDING_URL],subId,[{cache:[TRENDING_CACHES[i]]}],function(ev){
          if(!poll&&token!==feedToken)return;
          if(ev.kind===0){
            var prev=profileCache[ev.pubkey];
            if(!prev||prev.created_at<ev.created_at)profileCache[ev.pubkey]=parseProfile(ev);
            return;
          }
          if(ev.kind===PRIMAL_STATS_KIND){
            try{
              var st=JSON.parse(ev.content||'{}');
              if(st.event_id)netStats[st.event_id]={
                replies:st.replies||0,reposts:st.reposts||0,
                likes:st.likes||0,zaps:st.zaps||0
              };
            }catch(_){}
            return;
          }
          if(ev.kind!==1||!String(ev.content||'').trim())return;
          got++;
          if(poll){
            // A refresh mostly returns the list it returned last time, and the
            // very first one returns all of it. Both are dropped before the
            // signature check rather than after: these ids only ever decide new
            // from already-counted, so re-verifying eighty notes every few
            // minutes would buy nothing.
            if(modeSeenKeys.trending[ev.id])return;
            if(firstRun){modeSeenKeys.trending[ev.id]=1;return}
          }
          pendingChecks++;
          verifyEvent(ev).then(function(ok){
            pendingChecks--;
            if(ok)takeTrending(token,ev,poll);
            settle();
          });
        },function(){if(--pendingSubs<=0){eosed=true;settle()}});
      });
    }
    function takeTrending(token,ev,poll){
      modeSeenKeys.trending[ev.id]=1;
      var item={key:ev.id,noteId:ev.id,boost:null,at:ev.created_at};
      // The two lists overlap by a note or two; both pushItem and pushPending key
      // them out, so the overlap costs nothing.
      if(!poll){
        if(token!==feedToken||feedMode!=='trending')return;
        noteCache[ev.id]=ev;ensureProfile(ev.pubkey);
        pushItem(item);
        return;
      }
      // Only the mode actually on screen needs the note itself. Counting for the
      // badge must never pull in avatars for a list nobody is looking at: each
      // profile that came back would repaint the feed that *is* on screen, so a
      // silent count on one button would flicker the other mode's list. Switching
      // to Popular fetches the notes properly anyway.
      if(feedMode==='trending'&&activeTab==='feed'){
        noteCache[ev.id]=ev;ensureProfile(ev.pubkey,true);
        pushPending(item);
      }else{modeCounts.trending++;scheduleRenderShell()}
    }
    function stopFeedSubs(){['feed','discover'].concat(TRENDING_SUBS).forEach(function(id){pool.unsubscribe(id)})}
    function loadFeed(){
      var token=++feedToken;
      feedItems=[];feedKeys={};feedLoaded=false;
      pendingItems=[];pendingKeys={};
      modeCounts[feedMode]=0;
      if(feedMode==='following'){modeSeenKeys.following={};modeSeenInit.following=true}
      stopFeedSubs();
      // Popular does not read from the user's relays, so it is the one mode that
      // still works on an installation with none configured yet.
      if(feedMode==='trending'){fetchTrending(token,false);scheduleRender();startModePolling();return}
      if(!readUrls().length){feedLoaded=true;scheduleRender();return}
      if(feedMode==='following'){
        var authors=[pubHex].concat(contactPubkeys);
        pool.subscribe(readUrls(),'feed',[{kinds:[1,6],authors:authors,limit:60}],
          function(ev){if(token===feedToken)addFeedEvent(ev)},
          function(){if(token===feedToken){feedLoaded=true;scheduleRender()}});
      }else loadDiscover(token);
      scheduleRender();
      startModePolling();
    }
    // Following streams live on its own open subscription, and Discover does too
    // now, so neither mode needs re-querying to notice new posts. What is still
    // needed is the count on the *other* button: while Discover is open, the
    // Following tab has no subscription of its own to raise its badge, so a small
    // periodic query fills it.
    var MODE_POLL_MS=90000;
    function startModePolling(){
      clearInterval(modePollTimer);
      modePollTimer=setInterval(pollAllModes,MODE_POLL_MS);
    }
    function stopModePolling(){
      clearInterval(modePollTimer);modePollTimer=0;
      TRENDING_POLL_SUBS.forEach(function(id){pool.unsubscribe(id)});
    }
    // Popular is the only mode with no open subscription of its own: the cache
    // answers once and closes, so a poll is the only thing that can notice the
    // ranking has moved. It moves by about a note every couple of minutes, so it
    // gets its own slower beat than the Following count — asking faster would
    // only re-download the list it just returned, and this is the heavier of the
    // two answers, carrying notes, profiles and counts together.
    var TRENDING_POLL_MS=180000;
    function pollAllModes(){
      if(activeTab!=='feed'||stack.length)return;
      // Not gated on the relay list: the ranking cache is not one of the user's
      // relays, so Popular keeps refreshing even where none are configured.
      if(Date.now()-trendingAt>=TRENDING_POLL_MS)fetchTrending(0,true);
      if(!readUrls().length||feedMode==='following')return;
      pollFollowingCount();
    }
    function pollFollowingCount(){
      var authors=[pubHex].concat(contactPubkeys),subId='poll-following',firstRun=!modeSeenInit.following;
      pool.unsubscribe(subId);
      pool.subscribe(readUrls(),subId,[{kinds:[1,6],authors:authors,limit:20}],function(ev){
        if(modeSeenKeys.following[ev.id])return;
        modeSeenKeys.following[ev.id]=1;
        // Same reason as pushPending: your own note must not raise the badge that
        // tells you there is something new to catch up on.
        if(!firstRun&&ev.pubkey!==pubHex){modeCounts.following++;scheduleRenderShell()}
      },function(){pool.unsubscribe(subId);modeSeenInit.following=true});
    }
    // A relay has no trending endpoint — trending is a service Primal runs on top
    // of Nostr, not a part of the protocol. This used to measure it honestly and
    // expensively: pull up to a thousand reactions from a chosen window, tally
    // what they pointed at, then fetch those notes. Three round trips across
    // every relay had to finish before a single note could be drawn, which is
    // why picking 1h/4h/24h meant waiting, sometimes minutes — and why having to
    // pick at all was a chore rather than a feature.
    //
    // Recency is the one thing every relay really does index, so Discover asks
    // for that and nothing else: one open subscription for recent notes. It
    // paints as events arrive rather than after the last of them, and because the
    // subscription stays open afterwards, new posts keep streaming into the
    // pill by themselves. No window to choose and nothing to poll.
    // Kind 1 means "a human wrote this", but nothing enforces that, and some
    // people run their infrastructure over it: device heartbeats, presence pings
    // and join events published as notes because a relay is a convenient message
    // bus. Measured against the live firehose it is about one note in thirteen,
    // from a handful of authors. There is nothing to draw — it is not a NIP, just
    // somebody's own JSON — so in Discover, the one feed nobody chose the authors
    // of, a note whose entire content is a JSON document is dropped. Following is
    // deliberately left alone: what someone you chose to follow posts is between
    // you and them, not something this app should quietly withhold.
    function isMachineNote(content){
      var c=content.charAt(0);
      if(c!=='{'&&c!=='[')return false;
      try{var v=JSON.parse(content);return v!==null&&typeof v==='object'}catch(_){return false}
    }
    function loadDiscover(token){
      pool.subscribe(readUrls(),'discover',[{kinds:[1],limit:DISCOVER_LIMIT}],function(ev){
        // Replies are conversation, not discovery, and an empty note is a relay
        // artefact; both would only pad the list out with things nobody can read.
        if(token!==feedToken||isReply(ev))return;
        var content=String(ev.content||'').trim();
        if(!content||isMachineNote(content))return;
        addFeedEvent(ev);
      },function(){if(token===feedToken){feedLoaded=true;scheduleRender()}});
    }

    // ---- notifications ----
    function loadNotifications(){
      pool.unsubscribe('notif');
      notifItems=[];notifKeys={};notifLoaded=false;
      if(!readUrls().length){notifLoaded=true;return}
      pool.subscribe(readUrls(),'notif',[{kinds:[1,6,7],'#p':[pubHex],limit:80}],function(ev){
        if(ev.pubkey===pubHex||notifKeys[ev.id])return;
        notifKeys[ev.id]=1;
        ensureProfile(ev.pubkey);
        var target=targetOf(ev);
        if(target)ensureNote(target);
        var i=0;while(i<notifItems.length&&notifItems[i].created_at>ev.created_at)i++;
        notifItems.splice(i,0,ev);
        if(notifItems.length>100)notifItems.length=100;
        scheduleRender();
      },function(){notifLoaded=true;scheduleRender()});
    }
    function unreadCount(){return notifItems.filter(function(ev){return ev.created_at>notifSeen}).length}
    function markNotifSeen(){
      if(!notifItems.length)return;
      notifSeen=Math.max(notifSeen,notifItems[0].created_at);
      try{localStorage.setItem(SEEN_KEY,String(notifSeen))}catch(_){}
    }

    // ---- thread and user views ----
    function pushView(view){stack.push(view);scrollReset=true;renderShell()}
    function popView(){
      stack.pop();
      scrollReset=true;
      var top=stack[stack.length-1];
      if(top&&top.type==='thread')loadThread(top.id);
      else if(top&&top.type==='user')loadUser(top.pubkey);
      else if(top&&top.type==='people')loadPeople(top.mode,top.pubkey);
      renderShell();
    }
    function openThread(id){
      if(!id)return;
      ensureNote(id);
      loadThread(id);
      pushView({type:'thread',id:id});
    }
    function openUser(pk){
      if(!pk)return;
      ensureProfile(pk);
      loadUser(pk);
      pushView({type:'user',pubkey:pk});
    }
    // Finding somebody by name is not something Nostr gives a client for free.
    // A relay indexes events, not people, and only relays that implement NIP-50
    // understand a text query at all. So this asks in three ways at once and
    // merges whatever answers: profiles already in this session's cache (instant,
    // and it covers everyone you follow), a NIP-05 address resolved against the
    // domain that owns it, and a NIP-50 query to the relays. Relays that do not
    // support NIP-50 ignore the search field and reply with unrelated profiles,
    // so every relay answer is checked against the query here before it is shown
    // — an unsupporting relay then simply contributes nothing instead of noise.
    var NIP05_RE=/^[\w.+-]+@(?:[\w-]+\.)+[a-z]{2,}$/i;
    function openSearch(){
      var top=stack[stack.length-1];
      if(top&&top.type==='search')return;
      // Your follow list is the most likely place for the person you are looking
      // for, and their profiles may never have been fetched if they have not
      // posted lately. One batched REQ through the existing queue covers it.
      contactPubkeys.slice(0,500).forEach(ensureProfile);
      pushView({type:'search'});
      setTimeout(function(){var i=root.querySelector('.nos-search-input');if(i)i.focus()},30);
    }
    function profileMatches(pk,q){
      var p=profileCache[pk];
      if(!p)return false;
      q=q.toLowerCase();
      return String(p.name||'').toLowerCase().indexOf(q)>=0||
             String(p.handle||'').toLowerCase().indexOf(q)>=0||
             String(p.nip05||'').toLowerCase().indexOf(q)>=0;
    }
    function addSearchResult(pk){
      if(!pk||searchResults.indexOf(pk)>=0||searchResults.length>=60)return;
      searchResults.push(pk);
      scheduleRender();
    }
    function scheduleSearch(q){clearTimeout(searchDebounce);searchDebounce=setTimeout(function(){runSearch(q)},350)}
    function runSearch(raw){
      var q=String(raw||'').trim();
      searchQuery=q;
      var seq=++searchSeq;
      pool.unsubscribe('search');
      searchResults=[];searchBusy=false;
      if(!q){scheduleRender();return}
      // A pasted npub or nostr: URI is not a search — it names one person exactly,
      // so go straight to them instead of pretending to look.
      var direct=npubDecode(q)||refToPubkey(q.replace(/^nostr:/,''))||(/^[0-9a-f]{64}$/i.test(q)?q.toLowerCase():null);
      if(direct){openUser(direct);return}
      searchBusy=true;
      Object.keys(profileCache).forEach(function(pk){if(profileMatches(pk,q))addSearchResult(pk)});
      if(NIP05_RE.test(q))resolveNip05(q,seq);
      if(!readUrls().length){searchBusy=false;scheduleRender();return}
      pool.subscribe(readUrls(),'search',[{kinds:[0],search:q,limit:40}],function(ev){
        if(seq!==searchSeq)return;
        var prev=profileCache[ev.pubkey];
        if(prev===undefined||prev===null||prev.created_at<ev.created_at)profileCache[ev.pubkey]=parseProfile(ev);
        if(profileMatches(ev.pubkey,q))addSearchResult(ev.pubkey);
      },function(){if(seq===searchSeq){searchBusy=false;pool.unsubscribe('search');scheduleRender()}});
      scheduleRender();
    }
    // NIP-05 is resolved by the domain in the address, not by a relay: the browser
    // asks that host directly, which is exactly what the spec describes and why
    // those hosts serve the file with permissive CORS. A host that does not is
    // simply one source that returns nothing; the other two still answer.
    function resolveNip05(q,seq){
      var at=q.indexOf('@'),name=q.slice(0,at),domain=q.slice(at+1);
      fetch('https://'+domain+'/.well-known/nostr.json?name='+encodeURIComponent(name),{referrerPolicy:'no-referrer'})
        .then(function(r){return r.ok?r.json():null})
        .then(function(d){
          if(seq!==searchSeq||!d||!d.names)return;
          var pk=d.names[name]||d.names[name.toLowerCase()];
          if(pk&&/^[0-9a-f]{64}$/i.test(pk)){ensureProfile(pk);addSearchResult(pk)}
        }).catch(function(){});
    }
    function searchRank(pk){
      var p=profileCache[pk]||{},n=String(p.name||p.handle||'').toLowerCase(),q=searchQuery.toLowerCase(),s=0;
      if(contactPubkeys.indexOf(pk)>=0)s+=8;
      if(n===q)s+=4;else if(n.indexOf(q)===0)s+=2;
      if(p.nip05)s+=1;
      return s;
    }
    // The input element is deliberately left in place across re-renders: this view
    // repaints whenever a relay answers, and rebuilding it would take the caret
    // and half-typed query with it.
    function renderSearch(body){
      var input=body.querySelector('.nos-search-input');
      if(!input){
        body.innerHTML='<div class="nos-search"><input class="nos-search-input" type="search" autocomplete="off" spellcheck="false" placeholder="'+esc(t('nos_search_placeholder'))+'" value="'+esc(searchQuery)+'">'+
          '<div class="nos-search-results"></div></div>';
        input=body.querySelector('.nos-search-input');
        input.oninput=function(){scheduleSearch(input.value)};
        input.onkeydown=function(e){if(e.key==='Enter'){clearTimeout(searchDebounce);runSearch(input.value)}};
      }
      var res=body.querySelector('.nos-search-results');
      if(!searchQuery)res.innerHTML='<div class="nos-empty">'+esc(t('nos_search_hint'))+'</div>';
      else if(!searchResults.length)res.innerHTML='<div class="nos-empty">'+esc(searchBusy?t('nos_searching'):t('nos_search_none'))+'</div>';
      else res.innerHTML=searchResults.slice().sort(function(a,b){return searchRank(b)-searchRank(a)}).map(function(pk){
        var p=profileCache[pk]||{};
        return'<div class="nos-identity-row" data-user="'+esc(pk)+'">'+avatarHtml(pk)+
          '<span class="nos-identity-label"><b>'+esc(displayName(pk))+'</b>'+
          (p.nip05?'<br><span class="nos-nip05">'+esc(p.nip05)+'</span>':'')+'</span></div>';
      }).join('')+(searchBusy?'<div class="nos-empty">'+esc(t('nos_searching'))+'</div>':'');
      bindList(res);
    }
    function openPeople(mode,pk){
      loadPeople(mode,pk);
      pushView({type:'people',mode:mode,pubkey:pk});
    }
    function loadThread(id){
      threadReplies=[];threadKeys={};threadLoaded=false;
      pool.unsubscribe('thread');
      var note=noteCache[id];
      if(note){var parent=replyTarget(note);if(parent)ensureNote(parent);var rootId=rootTarget(note);if(rootId)ensureNote(rootId)}
      if(!readUrls().length){threadLoaded=true;return}
      pool.subscribe(readUrls(),'thread',[{kinds:[1],'#e':[id],limit:100}],function(ev){
        if(threadKeys[ev.id]||replyTarget(ev)!==id)return;
        threadKeys[ev.id]=1;
        noteCache[ev.id]=ev;ensureProfile(ev.pubkey);
        var i=0;while(i<threadReplies.length&&threadReplies[i].created_at<ev.created_at)i++;
        threadReplies.splice(i,0,ev);
        scheduleRender();
      },function(){threadLoaded=true;scheduleRender()});
    }
    function loadUser(pk){
      userNotes=[];userKeys={};userLoaded=false;
      pool.unsubscribe('user');
      if(!readUrls().length){userLoaded=true;return}
      pool.subscribe(readUrls(),'user',[{kinds:[1],authors:[pk],limit:50}],function(ev){
        if(userKeys[ev.id])return;
        userKeys[ev.id]=1;
        noteCache[ev.id]=ev;
        var i=0;while(i<userNotes.length&&userNotes[i].created_at>ev.created_at)i++;
        userNotes.splice(i,0,ev);
        scheduleRender();
      },function(){userLoaded=true;scheduleRender()});
    }
    // Following comes straight from the already-loaded kind:3 list — no relay
    // round trip needed for your own. A stranger's following list, and anyone's
    // followers, aren't cached anywhere and have to be fetched on demand.
    function loadPeople(mode,pk){
      peopleList=[];peopleKeys={};peopleLoaded=false;
      pool.unsubscribe('people');
      if(mode==='following'&&pk===pubHex){
        peopleList=contactPubkeys.slice();
        peopleList.forEach(ensureProfile);
        peopleLoaded=true;
        scheduleRender();
        return;
      }
      if(!readUrls().length){peopleLoaded=true;scheduleRender();return}
      if(mode==='following'){
        pool.subscribe(readUrls(),'people',[{kinds:[3],authors:[pk],limit:1}],function(ev){
          tagsOf(ev,'p').map(function(tg){return tg[1]}).filter(Boolean).forEach(function(other){
            if(peopleKeys[other])return;
            peopleKeys[other]=1;peopleList.push(other);ensureProfile(other);
          });
          scheduleRender();
        },function(){peopleLoaded=true;scheduleRender()});
      }else{
        pool.subscribe(readUrls(),'people',[{kinds:[3],'#p':[pk],limit:500}],function(ev){
          if(peopleKeys[ev.pubkey])return;
          peopleKeys[ev.pubkey]=1;peopleList.push(ev.pubkey);ensureProfile(ev.pubkey);
          scheduleRender();
        },function(){peopleLoaded=true;scheduleRender()});
      }
    }

    // ---- publishing ----
    async function publish(base){
      var ev=await finalizeEvent(base,privBytes);
      var results=await pool.publish(writeUrls(),ev);
      if(!results.some(function(r){return r.ok}))throw new Error('publish_failed');
      return ev;
    }
    async function toggleFollow(pk){
      var idx=contactPubkeys.indexOf(pk);
      if(idx>=0)contactPubkeys.splice(idx,1);else contactPubkeys.push(pk);
      renderBody();
      try{await publish({kind:3,tags:contactPubkeys.map(function(x){return['p',x]}),content:''})}catch(_){}
      if(activeTab==='feed'&&feedMode==='following'&&!stack.length)loadFeed();
    }
    async function toggleLike(id){
      var note=noteCache[id];if(!note)return;
      var existing=myReactions[id],s=statOf(id);
      if(existing){
        delete myReactions[id];s.likes=Math.max(0,s.likes-1);renderBody();
        try{await publish({kind:5,tags:[['e',existing]],content:''})}catch(_){}
        return;
      }
      myReactions[id]='pending';s.likes++;renderBody();
      try{var ev=await publish({kind:7,tags:[['e',id],['p',note.pubkey]],content:'+'});myReactions[id]=ev.id;s.seen[ev.id]=1}
      catch(_){delete myReactions[id];s.likes=Math.max(0,s.likes-1);renderBody()}
    }
    async function toggleRepost(id){
      var note=noteCache[id];if(!note)return;
      var existing=myReposts[id],s=statOf(id);
      if(existing){
        delete myReposts[id];s.reposts=Math.max(0,s.reposts-1);renderBody();
        try{await publish({kind:5,tags:[['e',existing]],content:''})}catch(_){}
        return;
      }
      myReposts[id]='pending';s.reposts++;renderBody();
      try{
        var ev=await publish({kind:6,tags:[['e',id,readUrls()[0]||''],['p',note.pubkey]],content:JSON.stringify(note)});
        myReposts[id]=ev.id;s.seen[ev.id]=1;
      }catch(_){delete myReposts[id];s.reposts=Math.max(0,s.reposts-1);renderBody()}
    }

    // ---- composer ----
    var composePreviewTimer=0;
    function openComposer(mode,id){composer={mode:mode,id:id||null,error:'',busy:false,images:[],uploading:false};renderComposer()}
    function closeComposer(){clearTimeout(composePreviewTimer);composer=null;renderComposer()}
    // nostr.build's anonymous upload endpoint needs no account or signed auth,
    // unlike NIP-96/Blossom which require per-server discovery and a signed
    // NIP-98 event — too much for what this widget needs to do here. The
    // returned URL is plain text pasted into the note, so the existing
    // URL_RE/IMG_EXT_RE content regex embeds it with no extra rendering code.
    function uploadImage(file){
      var form=new FormData();
      form.append('file',file);
      return fetch('https://nostr.build/api/v2/upload/files',{method:'POST',body:form})
        .then(function(res){if(!res.ok)throw new Error('upload_failed');return res.json()})
        .then(function(data){
          var url=data&&data.data&&data.data[0]&&(data.data[0].url||data.data[0].original_url);
          if(!url)throw new Error('upload_failed');
          return url;
        });
    }
    function renderComposer(){
      var existing=root.querySelector('.nos-modal');
      if(existing)existing.remove();
      if(!composer)return;
      var target=composer.id?noteCache[composer.id]:null;
      var title=composer.mode==='reply'?t('nos_reply'):composer.mode==='quote'?t('nos_quote'):t('nos_new_note');
      var wrap=document.createElement('div');
      wrap.className='nos-modal';
      wrap.innerHTML='<div class="nos-modal-card"><div class="nos-modal-head"><span class="nos-modal-title">'+esc(title)+'</span><button type="button" class="nos-modal-close">✕</button></div>'+
        (target?'<div class="nos-modal-ctx">'+noteCardHtml({key:'ctx',noteId:target.id,boost:null},{flat:true,actions:false,clickable:false})+'</div>':'')+
        '<textarea class="nos-modal-input" placeholder="'+esc(composer.mode==='reply'?t('nos_reply_placeholder'):t('nos_compose_placeholder'))+'"></textarea>'+
        '<div class="nos-compose-preview"></div>'+
        (composer.images.length?'<div class="nos-modal-images">'+composer.images.map(function(url,i){
          return'<div class="nos-modal-image"><img src="'+esc(url)+'"><button type="button" class="nos-modal-image-del" data-i="'+i+'">✕</button></div>';
        }).join('')+'</div>':'')+
        '<div class="nos-error nos-modal-error">'+esc(composer.error||'')+'</div>'+
        '<div class="nos-modal-foot"><input type="file" accept="image/*" class="nos-modal-file" hidden>'+
        '<button type="button" class="nos-modal-image-btn" title="'+esc(t('nos_attach_image'))+'"'+(composer.uploading?' disabled':'')+'>'+(composer.uploading?'…':'🖼')+'</button>'+
        (deeplEnabled?'<button type="button" class="nos-modal-image-btn nos-modal-translate" title="'+esc(t('nos_translate'))+'"'+(composer.translating?' disabled':'')+'>'+(composer.translating?'…':'🌐')+'</button>':'')+
        '<span style="flex:1"></span>'+
        '<button type="button" class="nos-modal-cancel">'+esc(t('nos_cancel'))+'</button><button type="button" class="primary nos-modal-send"'+(composer.busy?' disabled':'')+'>'+esc(composer.busy?t('nos_sending'):t('nos_publish'))+'</button></div></div>';
      root.appendChild(wrap);
      var textarea=wrap.querySelector('.nos-modal-input');
      textarea.value=composer.text||'';
      // Seeing the card before publishing is the point: a link that will render as
      // a bare address, or with somebody else's stale title, is worth knowing
      // about while it can still be changed. Only this one box is rewritten —
      // re-rendering the composer would take the caret with it — and the lookup
      // waits for a pause in typing so a half-typed address is not fetched.
      function refreshComposePreview(){
        var box=wrap.querySelector('.nos-compose-preview');
        if(!box)return;
        var url=firstPlainLink(textarea.value);
        if(!url){box.innerHTML='';return}
        box.innerHTML=previewHtml(url);
        bindImages(box);
        requestPreview(url).then(function(){
          if(!wrap.parentNode||firstPlainLink(textarea.value)!==url)return;
          box.innerHTML=previewHtml(url);
          bindImages(box);
        });
      }
      textarea.oninput=function(){
        composer.text=textarea.value;
        clearTimeout(composePreviewTimer);
        composePreviewTimer=setTimeout(refreshComposePreview,700);
      };
      refreshComposePreview();
      wrap.querySelector('.nos-modal-close').onclick=closeComposer;
      wrap.querySelector('.nos-modal-cancel').onclick=closeComposer;
      wrap.onclick=function(e){if(e.target===wrap)closeComposer()};
      wrap.querySelectorAll('.nos-modal-image-del').forEach(function(btn){
        btn.onclick=function(){composer.text=textarea.value;composer.images.splice(Number(btn.dataset.i),1);renderComposer()};
      });
      var fileInput=wrap.querySelector('.nos-modal-file');
      wrap.querySelector('.nos-modal-image-btn').onclick=function(){fileInput.click()};
      var translateBtn=wrap.querySelector('.nos-modal-translate');
      if(translateBtn)translateBtn.onclick=async function(){
        var text=textarea.value.trim();
        if(!text)return;
        composer.text=text;composer.translating=true;composer.error='';renderComposer();
        try{
          var out=await deeplTranslate(text,publishTargetLang());
          composer.text=out;composer.translating=false;
          renderComposer();
        }catch(_){composer.translating=false;composer.error=t('nos_translate_error');renderComposer()}
      };
      fileInput.onchange=async function(){
        var file=fileInput.files&&fileInput.files[0];
        if(!file)return;
        composer.text=textarea.value;composer.uploading=true;composer.error='';renderComposer();
        try{
          var url=await uploadImage(file);
          composer.images.push(url);
        }catch(_){composer.error=t('nos_upload_error')}
        composer.uploading=false;renderComposer();
      };
      wrap.querySelector('.nos-modal-send').onclick=async function(){
        var text=textarea.value.trim();
        if(composer.images.length)text=(text?text+'\n\n':'')+composer.images.join('\n');
        if(!text&&composer.mode!=='quote')return;
        composer.text=textarea.value.trim();composer.busy=true;composer.error='';renderComposer();
        try{
          var ev=await publish(composeEvent(composer.mode,text,target));
          if(composer.mode==='reply'&&target)statOf(target.id).replies++;
          noteCache[ev.id]=ev;
          if(!stack.length&&activeTab==='feed')pushItem({key:ev.id,noteId:ev.id,boost:null,at:ev.created_at});
          var top=stack[stack.length-1];
          if(top&&top.type==='thread'&&composer.mode==='reply'&&target&&target.id===top.id&&!threadKeys[ev.id]){threadKeys[ev.id]=1;threadReplies.push(ev)}
          composer=null;renderComposer();renderBody();
        }catch(_){composer.busy=false;composer.error=t('nos_publish_error');renderComposer()}
      };
      setTimeout(function(){textarea.focus()},30);
    }
    // NIP-10 wants both ends of the conversation: the root so every client can
    // group the thread, and the direct parent so the reply lands under the right
    // note. A quote is a plain note that names what it points at, both as a q tag
    // for clients that read tags and as a nostr: URI for those that read text.
    function composeEvent(mode,text,target){
      if(mode==='reply'&&target){
        var rootId=rootTarget(target)||target.id;
        var tags=[['e',rootId,'','root']];
        if(rootId!==target.id)tags.push(['e',target.id,'','reply']);
        tags.push(['p',target.pubkey]);
        return{kind:1,tags:tags,content:text};
      }
      if(mode==='quote'&&target){
        var ref=noteEncode(target.id);
        return{kind:1,tags:[['q',target.id,'',target.pubkey],['p',target.pubkey]],content:(text?text+'\n\n':'')+'nostr:'+ref};
      }
      return{kind:1,tags:[],content:text};
    }

    // ---- rendering ----
    function displayName(pk){
      var p=profileCache[pk];
      if(p&&p.name)return p.name;
      var npub=npubEncode(pk);
      return npub?shortNpub(npub):pk.slice(0,10)+'…';
    }
    function avatarHtml(pk,large){
      var p=profileCache[pk],initial=(displayName(pk)||'?').charAt(0).toUpperCase();
      // The fallback initial is always in the DOM underneath: a picture URL that
      // 404s or refuses hotlinking then degrades to a letter instead of a broken
      // image icon, which is what a missing avatar looked like before.
      return'<span class="nos-avatar-wrap'+(large?' nos-lg':'')+'" data-user="'+esc(pk)+'"><span class="nos-avatar">'+esc(initial)+'</span>'+
        (p&&p.picture?'<img class="nos-avatar nos-avatar-img" src="'+esc(p.picture)+'" referrerpolicy="no-referrer" loading="lazy" alt="">':'')+'</span>';
    }
    var URL_RE=/https?:\/\/[^\s<]+[^\s<.,:;!?)'"]/g;
    var NOSTR_RE=/nostr:(n(?:pub|profile|ote|event)1[023456789acdefghjklmnpqrstuvwxyz]+)/g;
    var IMG_EXT_RE=/\.(png|jpe?g|gif|webp|avif)$/i;
    // Nostr has no media type on a link — an attachment is just a URL in the
    // text, so the extension is all there is to go on. Video was falling through
    // to the plain-link branch and an .mp4 someone posted read as a bare address.
    // preload="metadata" is what keeps that affordable: a feed can hold a dozen
    // clips and the browser fetches a few hundred bytes of header for each
    // instead of the files themselves.
    var VID_EXT_RE=/\.(mp4|webm|ogv|ogm|m4v|mov)$/i;
    var AUD_EXT_RE=/\.(mp3|oga|wav|m4a|flac)$/i;
    function renderContent(text,skipId){
      var out=esc(text).replace(URL_RE,function(url){
        var plain=url.replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"');
        var noQuery=plain.split(/[?#]/)[0];
        if(IMG_EXT_RE.test(noQuery))return'<a href="'+url+'" target="_blank" rel="noopener noreferrer" class="nos-embed-link"><img class="nos-embed-img" src="'+url+'" loading="lazy" referrerpolicy="no-referrer"></a>';
        if(VID_EXT_RE.test(noQuery))return'<video class="nos-embed-video" src="'+url+'" controls playsinline preload="metadata"></video>';
        if(AUD_EXT_RE.test(noQuery))return'<audio class="nos-embed-audio" src="'+url+'" controls preload="metadata"></audio>';
        return'<a href="'+url+'" target="_blank" rel="noopener noreferrer">'+url+'</a>';
      });
      return out.replace(NOSTR_RE,function(whole,ref){
        var id=refToId(ref);
        // The quoted note is rendered as a card below, so its URI is noise in the text.
        if(id)return id===skipId?'':'<span class="nos-mention" data-note="'+esc(id)+'">'+esc(t('nos_quoted_note'))+'</span>';
        var pk=refToPubkey(ref);
        if(pk){ensureProfile(pk);return'<span class="nos-mention" data-user="'+esc(pk)+'">@'+esc(displayName(pk))+'</span>'}
        return whole;
      });
    }
    // A link with nothing else to it is the one case worth previewing: an image,
    // a clip or an audio file already renders as itself, and a quoted note gets
    // its own card. Only the first such link is previewed — a note that is a list
    // of ten links should stay a list, not turn into ten cards.
    function firstPlainLink(text){
      var found=String(text||'').match(URL_RE);
      if(!found)return'';
      for(var i=0;i<found.length;i++){
        var noQuery=found[i].split(/[?#]/)[0];
        if(IMG_EXT_RE.test(noQuery)||VID_EXT_RE.test(noQuery)||AUD_EXT_RE.test(noQuery))continue;
        return found[i];
      }
      return'';
    }
    var previewCache={},previewInFlight={};
    // false means "asked, and there is nothing to show" — cached exactly like a
    // real answer so a link without Open Graph tags is not re-requested forever.
    function requestPreview(url){
      if(!url)return Promise.resolve(false);
      if(previewCache[url]!==undefined)return Promise.resolve(previewCache[url]);
      if(previewInFlight[url])return previewInFlight[url];
      previewInFlight[url]=fetch(API+'/preview?url='+encodeURIComponent(url),{headers:{'X-Pub-Token':token}})
        .then(function(r){return r.ok?r.json():null})
        .catch(function(){return null})
        .then(function(d){
          delete previewInFlight[url];
          previewCache[url]=(d&&(d.title||d.image))?d:false;
          scheduleRender();
          return previewCache[url];
        });
      return previewInFlight[url];
    }
    function previewHtml(url){
      if(!url)return'';
      var d=previewCache[url];
      // Not asked for yet: leave a marker the observer can pick up when the card
      // actually reaches the screen.
      if(d===undefined)return'<div class="nos-preview" data-preview-url="'+esc(url)+'"></div>';
      if(!d)return'';
      return'<a class="nos-preview-card" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+
        (d.image?'<img class="nos-preview-img" src="'+esc(d.image)+'" loading="lazy" referrerpolicy="no-referrer" alt="">':'')+
        '<span class="nos-preview-text">'+
          (d.site?'<span class="nos-preview-site">'+esc(d.site)+'</span>':'')+
          (d.title?'<span class="nos-preview-title">'+esc(d.title)+'</span>':'')+
          (d.description?'<span class="nos-preview-desc">'+esc(d.description)+'</span>':'')+
        '</span></a>';
    }
    // Discover can hold a hundred notes. Fetching a preview for every link in
    // them the moment they render would have the server open a hundred pages for
    // one scroll the reader may never reach the bottom of, so a preview is only
    // asked for once its card is near the screen.
    var previewObserver=('IntersectionObserver'in window)?new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(!entry.isIntersecting)return;
        previewObserver.unobserve(entry.target);
        requestPreview(entry.target.dataset.previewUrl);
      });
    },{rootMargin:'250px'}):null;
    function actionsHtml(id){
      var s=stats[id]||{replies:0,reposts:0,likes:0};
      // A note that trended did so across the whole network, while `stats` only
      // ever sees what the user's own handful of relays kept. Showing the larger
      // of the two keeps the number from collapsing to a fraction of the truth
      // the moment the local count starts coming in.
      var net=netStats[id];
      if(net)s={replies:Math.max(s.replies,net.replies),reposts:Math.max(s.reposts,net.reposts),
                likes:Math.max(s.likes,net.likes)};
      var liked=!!myReactions[id],reposted=!!myReposts[id];
      var tr=translations[id];
      var translateLabel=tr&&tr.status==='done'?(tr.shown?t('nos_show_original'):t('nos_translate')):tr&&tr.status==='loading'?t('nos_translating'):t('nos_translate');
      return'<div class="nos-note-actions">'+
        '<button type="button" class="nos-act nos-a-reply" data-act="reply" data-id="'+esc(id)+'">💬 '+(s.replies||'')+'</button>'+
        '<button type="button" class="nos-act nos-a-repost'+(reposted?' on':'')+'" data-act="repost" data-id="'+esc(id)+'" title="'+esc(t('nos_repost'))+'">🔁 '+(s.reposts||'')+'</button>'+
        '<button type="button" class="nos-act nos-a-quote" data-act="quote" data-id="'+esc(id)+'" title="'+esc(t('nos_quote'))+'">❝</button>'+
        '<button type="button" class="nos-act nos-a-like'+(liked?' on':'')+'" data-act="like" data-id="'+esc(id)+'" title="'+esc(t('nos_like'))+'">'+(liked?'❤️':'🤍')+' '+(s.likes||'')+'</button>'+
        (deeplEnabled?'<button type="button" class="nos-act nos-a-translate'+(tr&&tr.status==='done'&&tr.shown?' on':'')+'" data-act="translate" data-id="'+esc(id)+'"'+(tr&&tr.status==='loading'?' disabled':'')+'>🌐 '+esc(translateLabel)+'</button>':'')+
        '</div>';
    }
    function quoteHtml(id){
      var note=noteCache[id];
      if(!note){ensureNote(id);return'<div class="nos-quote">'+esc(t('nos_loading'))+'</div>'}
      ensureProfile(note.pubkey);
      return'<div class="nos-quote" data-note="'+esc(note.id)+'"><div class="nos-note-head">'+avatarHtml(note.pubkey)+
        '<div class="nos-note-who" data-user="'+esc(note.pubkey)+'"><span class="nos-note-name">'+esc(displayName(note.pubkey))+'</span><span class="nos-note-time">'+esc(formatTime(note.created_at))+'</span></div></div>'+
        '<div class="nos-note-content">'+renderContent(note.content)+'</div></div>';
    }
    function replyOfHtml(parent){
      return'<div class="nos-reply-of-wrap"><div class="nos-reply-of-label">'+esc(t('nos_reply_to'))+'</div>'+quoteHtml(parent)+'</div>';
    }
    function noteCardHtml(item,options){
      options=options||{};
      var note=noteCache[item.noteId];
      if(!note)return'<div class="nos-note'+(options.flat?' nos-flat':'')+'"><div class="nos-empty">'+esc(t('nos_loading'))+'</div></div>';
      var quoted=quotedId(note),parent=replyTarget(note);
      var isSelf=note.pubkey===pubHex,following=contactPubkeys.indexOf(note.pubkey)>=0;
      return'<div class="nos-note'+(options.flat?' nos-flat':'')+'"'+(options.clickable===false?'':' data-note="'+esc(note.id)+'"')+'>'+
        (item.boost?'<div class="nos-boost">🔁 '+esc(t('nos_reposted_by',{name:displayName(item.boost.pubkey)}))+'</div>':'')+
        '<div class="nos-note-head">'+avatarHtml(note.pubkey)+
          '<div class="nos-note-who" data-user="'+esc(note.pubkey)+'"><span class="nos-note-name">'+esc(displayName(note.pubkey))+'</span><span class="nos-note-time">'+esc(formatTime(note.created_at))+'</span></div>'+
          (isSelf||options.follow===false?'':'<button type="button" class="nos-follow-btn" data-act="'+(following?'unfollow':'follow')+'" data-pubkey="'+esc(note.pubkey)+'">'+esc(t(following?'nos_unfollow':'nos_follow'))+'</button>')+
        '</div>'+
        (parent&&options.showParent!==false?replyOfHtml(parent):'')+
        '<div class="nos-note-content">'+renderContent(note.content,quoted)+'</div>'+
        (quoted?quoteHtml(quoted):previewHtml(firstPlainLink(note.content)))+
        (translations[note.id]&&translations[note.id].shown?'<div class="nos-note-translation">'+
          (translations[note.id].status==='loading'?esc(t('nos_translating')):
           translations[note.id].status==='error'?esc(t('nos_translate_error')):
           esc(translations[note.id].text))+'</div>':'')+
        (options.actions===false?'':actionsHtml(note.id))+
        '</div>';
    }
    function listHtml(items,options){return items.map(function(item){return noteCardHtml(item,options)}).join('')}

    function barHtml(){
      var back=stack.length?'<button type="button" class="nos-bar-btn nos-back">←</button>':'';
      var unread=unreadCount();
      return'<div class="nos-bar"><div class="nos-bar-head">'+back+
        '<span class="nos-title">🔮 '+esc(t('nos_app_title'))+'</span>'+
        '<div class="nos-tabs">'+
          ['feed','notifications','profile','relays'].map(function(id){
            var label=t(id==='feed'?'nos_tab_feed':id==='notifications'?'nos_tab_notifications':id==='profile'?'nos_tab_profile':'nos_tab_relays');
            return'<button class="nos-tab'+(activeTab===id&&!stack.length?' active':'')+'" data-tab="'+id+'">'+esc(label)+(id==='notifications'&&unread?'<span class="nos-badge">'+(unread>99?'99+':unread)+'</span>':'')+'</button>';
          }).join('')+
        '</div>'+
        '<button type="button" class="nos-bar-btn nos-search-btn" title="'+esc(t('nos_search_title'))+'">🔍</button>'+
        '<button type="button" class="nos-bar-btn nos-new" title="'+esc(t('nos_new_note'))+'">✏️</button>'+
        (identities.length>1?'<button type="button" class="nos-bar-btn nos-switcher-btn" title="'+esc(t('nos_switch_identity'))+'">'+avatarHtml(pubHex)+'</button>':'')+
        '<button type="button" class="nos-bar-btn nos-lock-btn" title="'+esc(lockedAtHint())+'">🔒</button>'+
        '</div>'+
        (activeTab==='feed'&&!stack.length?'<div class="nos-modes">'+
          [['following','nos_mode_following'],['trending','nos_mode_trending'],['discover','nos_mode_discover']].map(function(pair){
            var count=modeCounts[pair[0]];
            return'<button class="nos-mode'+(feedMode===pair[0]?' active':'')+'" data-mode="'+pair[0]+'">'+esc(t(pair[1]))+
              (feedMode!==pair[0]&&count?'<span class="nos-badge">'+(count>99?'99+':count)+'</span>':'')+'</button>';
          }).join('')+'</div>':'')+
        '</div>';
    }
    function bindBar(){
      root.querySelectorAll('.nos-tab').forEach(function(btn){btn.onclick=function(){switchTab(btn.dataset.tab)}});
      root.querySelectorAll('.nos-mode').forEach(function(btn){btn.onclick=function(){if(feedMode===btn.dataset.mode)return;feedMode=btn.dataset.mode;try{localStorage.setItem(FEED_MODE_KEY,feedMode)}catch(_){}scrollReset=true;loadFeed();renderShell()}});
      root.querySelector('.nos-search-btn').onclick=openSearch;
      root.querySelector('.nos-new').onclick=function(){openComposer('note')};
      var switcherBtn=root.querySelector('.nos-switcher-btn');
      if(switcherBtn)switcherBtn.onclick=function(){switcherOpen=true;renderSwitcher()};
      root.querySelector('.nos-lock-btn').onclick=function(){lockNow()};
      var back=root.querySelector('.nos-back');
      if(back)back.onclick=popView;
    }
    // Repainting an unread badge used to rebuild the entire widget from scratch.
    // That threw away the .nos-body element itself, and with it the reader's
    // scroll position — a background poll landing while someone was halfway down
    // a post snapped them straight back to the top. It also wiped any open
    // composer, so a reply being typed vanished on the next poll. Only the bar is
    // swapped now; the body element and any modal above it survive untouched.
    function renderShell(){
      if(!key)return;
      var bar=root.querySelector('.nos > .nos-bar');
      if(bar)bar.outerHTML=barHtml();
      else root.innerHTML='<div class="nos">'+barHtml()+'<div class="nos-body"></div></div>';
      bindBar();
      renderBody();
    }
    function switchTab(tab){
      stack=[];
      activeTab=tab;
      if(tab==='notifications')markNotifSeen();
      // Following and Discover keep an open subscription, so they are still
      // current when the reader comes back. Popular has none — the ranking cache
      // answers once and closes. While the feed is on screen the background poll
      // keeps it moving, but the poll stands down whenever something else is, so
      // coming back after a while asks the ranking again. As a refresh, not a
      // reload: what is new arrives behind the pill, and the reader keeps both
      // the list and their place in it.
      if(tab==='feed'&&!feedItems.length)loadFeed();
      else if(tab==='feed'&&feedMode==='trending'&&Date.now()-trendingAt>TRENDING_TTL)fetchTrending(0,true);
      scrollReset=true;
      renderShell();
    }
    // Navigating somewhere new should start at the top; a repaint of the view the
    // reader is already in must not move them. The difference is explicit now
    // that a repaint no longer resets the scroll by destroying the element.
    function renderBody(){
      var body=root.querySelector('.nos-body');
      if(!body)return;
      var scroll=scrollReset?0:body.scrollTop;
      scrollReset=false;
      var view=stack[stack.length-1];
      if(view&&view.type==='thread')renderThread(body,view);
      else if(view&&view.type==='user')renderUser(body,view);
      else if(view&&view.type==='people')renderPeople(body,view);
      else if(view&&view.type==='search')renderSearch(body);
      else if(activeTab==='feed')renderFeed(body);
      else if(activeTab==='notifications')renderNotifications(body);
      else if(activeTab==='profile')renderProfileTab(body);
      else renderRelaysTab(body);
      body.scrollTop=scroll;
      bindImages(body);
    }
    function bindImages(container){
      container.querySelectorAll('.nos-avatar-img').forEach(function(img){img.onerror=function(){img.style.display='none'}});
      // A preview image that 404s or blocks hotlinking should leave the card's
      // text intact rather than a broken-image box.
      container.querySelectorAll('.nos-preview-img').forEach(function(img){img.onerror=function(){img.remove()}});
      container.querySelectorAll('.nos-preview[data-preview-url]').forEach(function(el){
        if(previewObserver)previewObserver.observe(el);
        else requestPreview(el.dataset.previewUrl);
      });
    }
    // One delegated handler per list beats a listener per button: the lists are
    // re-rendered on every incoming event, and re-binding hundreds of nodes each
    // time is what makes a live feed stutter.
    function bindList(container){
      container.onclick=function(e){
        var act=e.target.closest('[data-act]');
        if(act){
          e.stopPropagation();
          var id=act.dataset.id,pk=act.dataset.pubkey;
          if(act.dataset.act==='reply')openComposer('reply',id);
          else if(act.dataset.act==='quote')openComposer('quote',id);
          else if(act.dataset.act==='repost')toggleRepost(id);
          else if(act.dataset.act==='like')toggleLike(id);
          else if(act.dataset.act==='follow'||act.dataset.act==='unfollow')toggleFollow(pk);
          else if(act.dataset.act==='translate')translateNote(id);
          return;
        }
        // A note is clickable as a whole, so without this the play button, the
        // seek bar and the volume slider all opened the thread instead.
        if(e.target.closest('a,video,audio'))return;
        var user=e.target.closest('[data-user]');
        if(user){e.stopPropagation();openUser(user.dataset.user);return}
        var note=e.target.closest('[data-note]');
        if(note)openThread(note.dataset.note);
      };
    }
    function pendingHtml(){
      if(!pendingItems.length)return'';
      var seen={},authors=[];
      for(var i=pendingItems.length-1;i>=0&&authors.length<3;i--){
        var pk=pendingItems[i].boost?pendingItems[i].boost.pubkey:(noteCache[pendingItems[i].noteId]||{}).pubkey;
        if(pk&&!seen[pk]){seen[pk]=1;authors.push(pk)}
      }
      return'<button type="button" class="nos-newposts">'+
        '<span class="nos-newposts-avatars">'+authors.map(function(pk){return avatarHtml(pk)}).join('')+'</span>'+
        esc(t('nos_new_posts',{n:pendingItems.length}))+'</button>';
    }
    function renderFeed(body){
      var pending=pendingHtml();
      if(!feedItems.length){
        var emptyKey=feedMode==='following'?'nos_no_notes':feedMode==='trending'?(trendingFailed?'nos_trending_off':'nos_no_trending'):'nos_no_discover';
        body.innerHTML=pending+'<div class="nos-empty">'+esc(feedLoaded?t(emptyKey):t('nos_loading'))+'</div>';
        if(pending)body.querySelector('.nos-newposts').onclick=function(e){e.stopPropagation();acceptPending()};
        return;
      }
      body.innerHTML=pending+listHtml(feedItems,{});
      if(pending)body.querySelector('.nos-newposts').onclick=function(e){e.stopPropagation();acceptPending()};
      bindList(body);
      refreshStats(feedItems.map(function(item){return item.noteId}));
    }
    function renderNotifications(body){
      if(!notifItems.length){
        body.innerHTML='<div class="nos-empty">'+esc(notifLoaded?t('nos_no_notifications'):t('nos_loading'))+'</div>';
        return;
      }
      body.innerHTML=notifItems.map(function(ev){
        var target=targetOf(ev),note=target?noteCache[target]:null;
        var what=ev.kind===7?t('nos_notif_like'):ev.kind===6?t('nos_notif_repost'):(target?t('nos_notif_reply'):t('nos_notif_mention'));
        var preview=ev.kind===1?ev.content:(note?note.content:'');
        return'<div class="nos-notif"'+(target||ev.kind===1?' data-note="'+esc(ev.kind===1?ev.id:target)+'"':'')+'>'+avatarHtml(ev.pubkey)+
          '<div class="nos-notif-body"><div class="nos-notif-line"><b data-user="'+esc(ev.pubkey)+'">'+esc(displayName(ev.pubkey))+'</b> '+esc(what)+'</div>'+
          (preview?'<div class="nos-notif-quote">'+esc(preview.slice(0,180))+'</div>':'')+
          '<div class="nos-notif-time">'+esc(formatTime(ev.created_at))+'</div></div></div>';
      }).join('');
      bindList(body);
      markNotifSeen();
    }
    function renderThread(body,view){
      var note=noteCache[view.id];
      if(!note){body.innerHTML='<div class="nos-empty">'+esc(t('nos_loading'))+'</div>';return}
      var parent=replyTarget(note);
      body.innerHTML=(parent?noteCardHtml({key:'p',noteId:parent,boost:null},{flat:true,showParent:false}):'')+
        noteCardHtml({key:'root',noteId:view.id,boost:null},{showParent:false,clickable:false})+
        '<div class="nos-thread-replies">'+
          (threadReplies.length?listHtml(threadReplies.map(function(ev){return{key:ev.id,noteId:ev.id,boost:null}}),{flat:true,showParent:false})
            :'<div class="nos-empty">'+esc(threadLoaded?t('nos_no_replies'):t('nos_loading'))+'</div>')+
        '</div>';
      bindList(body);
      refreshStats([view.id].concat(threadReplies.map(function(ev){return ev.id})));
    }
    function peopleCountsHtml(pk){
      return'<div class="nos-people-stats">'+
        '<button type="button" class="nos-people-btn" data-people="following" data-pubkey="'+esc(pk)+'">'+
          '<b>'+(pk===pubHex?contactPubkeys.length:'…')+'</b> '+esc(t('nos_following'))+'</button>'+
        '<button type="button" class="nos-people-btn" data-people="followers" data-pubkey="'+esc(pk)+'">'+
          '<b>…</b> '+esc(t('nos_followers'))+'</button>'+
      '</div>';
    }
    function renderUser(body,view){
      var pk=view.pubkey,p=profileCache[pk]||{},following=contactPubkeys.indexOf(pk)>=0,isSelf=pk===pubHex;
      body.innerHTML='<div class="nos-user-head">'+
        (p.banner?'<img class="nos-banner" src="'+esc(p.banner)+'" referrerpolicy="no-referrer" alt="">':'<div class="nos-banner"></div>')+
        '<div class="nos-user-row">'+avatarHtml(pk,true)+
          '<div class="nos-user-meta"><div class="nos-user-name">'+esc(displayName(pk))+'</div>'+
          (p.nip05?'<div class="nos-nip05">'+esc(p.nip05)+'</div>':'')+'</div>'+
          (isSelf?'':'<button type="button" class="nos-follow-btn primary" data-act="'+(following?'unfollow':'follow')+'" data-pubkey="'+esc(pk)+'">'+esc(t(following?'nos_unfollow':'nos_follow'))+'</button>')+
        '</div>'+
        (p.about?'<div class="nos-user-about">'+renderContent(p.about)+'</div>':'')+
        peopleCountsHtml(pk)+
        (p.website?'<div class="nos-user-stats"><a href="'+esc(p.website)+'" target="_blank" rel="noopener noreferrer">'+esc(p.website)+'</a></div>':'')+
        '<div class="nos-view-value nos-key-value">'+esc(npubEncode(pk)||'')+'</div>'+
      '</div>'+
      (userNotes.length?listHtml(userNotes.map(function(ev){return{key:ev.id,noteId:ev.id,boost:null}}),{follow:false})
        :'<div class="nos-empty">'+esc(userLoaded?t('nos_no_notes'):t('nos_loading'))+'</div>');
      bindList(body);
      bindPeopleButtons(body);
      refreshStats(userNotes.map(function(ev){return ev.id}));
    }
    function renderPeople(body,view){
      body.innerHTML=(peopleList.length?peopleList.map(function(pk){
          return'<div class="nos-note nos-flat" data-user="'+esc(pk)+'"><div class="nos-note-head">'+avatarHtml(pk)+
            '<div class="nos-note-who" data-user="'+esc(pk)+'"><span class="nos-note-name">'+esc(displayName(pk))+'</span></div>'+
            (pk===pubHex?'':'<button type="button" class="nos-follow-btn" data-act="'+(contactPubkeys.indexOf(pk)>=0?'unfollow':'follow')+'" data-pubkey="'+esc(pk)+'">'+esc(t(contactPubkeys.indexOf(pk)>=0?'nos_unfollow':'nos_follow'))+'</button>')+
          '</div></div>';
        }).join('')
        :'<div class="nos-empty">'+esc(peopleLoaded?t('nos_no_people'):t('nos_loading'))+'</div>');
      bindList(body);
    }
    function bindPeopleButtons(body){
      body.querySelectorAll('[data-people]').forEach(function(btn){
        btn.onclick=function(e){e.stopPropagation();openPeople(btn.dataset.people,btn.dataset.pubkey)};
      });
    }
    function renderProfileTab(body){
      var p=profileCache[pubHex]||{};
      body.innerHTML='<div class="nos-profile-form">'+
        '<div class="nos-user-head">'+
          (p.banner?'<img class="nos-banner" src="'+esc(p.banner)+'" referrerpolicy="no-referrer" alt="">':'<div class="nos-banner"></div>')+
          '<div class="nos-user-row">'+avatarHtml(pubHex,true)+'<div class="nos-user-meta"><div class="nos-user-name">'+esc(displayName(pubHex))+'</div>'+
          (p.nip05?'<div class="nos-nip05">'+esc(p.nip05)+'</div>':'')+'</div></div>'+
          peopleCountsHtml(pubHex)+
        '</div>'+
        '<label>'+esc(t('nos_display_name'))+'</label><input class="nos-p-display" value="'+esc(p.name||'')+'">'+
        '<label>'+esc(t('nos_username'))+'</label><input class="nos-p-name" value="'+esc(p.handle||'')+'">'+
        '<label>'+esc(t('nos_about'))+'</label><textarea class="nos-p-about">'+esc(p.about||'')+'</textarea>'+
        '<label>'+esc(t('nos_picture_url'))+'</label><input class="nos-p-picture" value="'+esc(p.picture||'')+'">'+
        '<label>'+esc(t('nos_banner_url'))+'</label><input class="nos-p-banner" value="'+esc(p.banner||'')+'">'+
        '<label>'+esc(t('nos_website'))+'</label><input class="nos-p-website" value="'+esc(p.website||'')+'">'+
        '<label>'+esc(t('nos_nip05'))+'</label><input class="nos-p-nip05" value="'+esc(p.nip05||'')+'">'+
        '<div class="nos-error nos-profile-error"></div>'+
        '<button type="button" class="primary nos-profile-save">'+esc(t('nos_save'))+'</button>'+
        '<div class="nos-profile-meta">'+esc(t('nos_your_npub'))+'<div class="nos-view-value nos-key-value">'+esc(vaultInfo.npub)+'</div>'+
        '<div class="nos-identities-title">'+esc(t('nos_identities_title'))+'</div>'+
        identities.map(function(v){
          var active=v.npub===vaultInfo.npub;
          return'<div class="nos-identity-row"><span class="nos-identity-label">'+esc(shortNpub(v.npub))+(active?' — '+esc(t('nos_identity_current')):'')+'</span>'+
            '<span class="nos-identity-actions">'+
            (active?'<button type="button" class="nos-identity-logout" data-npub="'+esc(v.npub)+'">'+esc(t('nos_identity_logout'))+'</button>':
              '<button type="button" class="nos-identity-switch" data-npub="'+esc(v.npub)+'">'+esc(t('nos_switch_identity'))+'</button>')+
            '<button type="button" class="nos-identity-remove" data-npub="'+esc(v.npub)+'">'+esc(t('nos_identity_remove'))+'</button>'+
            '</span></div>';
        }).join('')+
        '<button type="button" class="nos-link nos-add-identity">'+esc(t('nos_add_identity'))+'</button>'+
        '</div>'+
        // Both of these choose a target language for a translation, so they
        // belong to the premium integration and go with it: the first is the
        // language the translate button renders a post into, the second the
        // one the composer translates a draft into before publishing. With no
        // integration there is nothing either could apply to.
        (deeplEnabled?
          '<label>'+esc(t('nos_translate_lang_label'))+'</label>'+
          '<select class="nos-p-translate-lang">'+NOS_LANGS.map(function(l){return'<option value="'+esc(l.value)+'"'+(l.value===translateTargetLang()?' selected':'')+'>'+esc(l.label)+'</option>'}).join('')+'</select>'+
          '<label>'+esc(t('nos_publish_lang_label'))+'</label>'+
          '<select class="nos-p-publish-lang">'+NOS_LANGS.map(function(l){return'<option value="'+esc(l.value)+'"'+(l.value===publishTargetLang()?' selected':'')+'>'+esc(l.label)+'</option>'}).join('')+'</select>'
        :'')+
        '</div>';
      function saveLangPref(field,value){
        var prev=_langPrefs[field];
        _langPrefs[field]=value;
        api('/prefs',{method:'PUT',body:JSON.stringify((function(o){o[field]=value;return o})({}))}).catch(function(){_langPrefs[field]=prev});
      }
      // Absent whenever the integration is off, and everything bound after
      // this — the identity buttons — would be left dead by the TypeError.
      var trLangSel=body.querySelector('.nos-p-translate-lang');
      if(trLangSel)trLangSel.onchange=function(e){saveLangPref('translate_lang',e.target.value)};
      var pubLangSel=body.querySelector('.nos-p-publish-lang');
      if(pubLangSel)pubLangSel.onchange=function(e){saveLangPref('publish_lang',e.target.value)};
      body.querySelector('.nos-add-identity').onclick=function(){addMode=true;obStep='choose';obPriv=null;onboardingScreen()};
      body.querySelectorAll('.nos-identity-switch').forEach(function(btn){btn.onclick=function(){switchIdentity(btn.dataset.npub)}});
      body.querySelectorAll('.nos-identity-logout').forEach(function(btn){btn.onclick=function(){logoutIdentity(btn.dataset.npub)}});
      body.querySelectorAll('.nos-identity-remove').forEach(function(btn){btn.onclick=function(){removeIdentity(btn.dataset.npub)}});
      bindPeopleButtons(body);
      body.querySelector('.nos-profile-save').onclick=async function(){
        var btn=body.querySelector('.nos-profile-save'),err=body.querySelector('.nos-profile-error');
        btn.disabled=true;err.textContent='';
        // Kind 0 is replaceable: publishing only the fields this form knows about
        // would silently delete anything another client put there, a lightning
        // address included. The last profile seen is the base; the form edits it.
        var edited=Object.assign({},ownProfileRaw,{
          display_name:body.querySelector('.nos-p-display').value.trim(),
          name:body.querySelector('.nos-p-name').value.trim(),
          about:body.querySelector('.nos-p-about').value.trim(),
          picture:body.querySelector('.nos-p-picture').value.trim(),
          banner:body.querySelector('.nos-p-banner').value.trim(),
          website:body.querySelector('.nos-p-website').value.trim(),
          nip05:body.querySelector('.nos-p-nip05').value.trim()
        });
        try{
          var ev=await publish({kind:0,tags:[],content:JSON.stringify(edited)});
          // Without this the feed keeps showing the old avatar until a relay
          // happens to echo the new profile back.
          profileCache[pubHex]=parseProfile(ev);
          ownProfileRaw=edited;
          renderBody();
        }catch(_){err.textContent=t('nos_publish_error')}
        btn.disabled=false;
      };
      bindImages(body);
    }
    function renderRelayList(){
      var list=root.querySelector('.nos-relay-list');if(!list)return;
      list.innerHTML=relays.map(function(r,i){var st=pool.statusOf(r.url);
        return'<div class="nos-relay-row"><span class="nos-relay-dot nos-relay-'+st+'"></span><span class="nos-relay-url">'+esc(r.url)+'</span><label class="nos-check"><input type="checkbox" class="nos-relay-read" data-i="'+i+'" '+(r.read?'checked':'')+'> '+esc(t('nos_read'))+'</label><label class="nos-check"><input type="checkbox" class="nos-relay-write" data-i="'+i+'" '+(r.write?'checked':'')+'> '+esc(t('nos_write'))+'</label><button type="button" class="nos-relay-del" data-i="'+i+'">🗑</button></div>'
      }).join('');
      list.querySelectorAll('.nos-relay-read').forEach(function(cb){cb.onchange=function(){relays[Number(cb.dataset.i)].read=cb.checked?1:0}});
      list.querySelectorAll('.nos-relay-write').forEach(function(cb){cb.onchange=function(){relays[Number(cb.dataset.i)].write=cb.checked?1:0}});
      list.querySelectorAll('.nos-relay-del').forEach(function(btn){btn.onclick=function(){relays.splice(Number(btn.dataset.i),1);renderRelayList()}});
    }
    function renderRelaysTab(body){
      body.innerHTML='<div class="nos-relays"><div class="nos-relay-list"></div><div class="nos-relay-add"><input class="nos-relay-url" placeholder="wss://relay.example.com"><button type="button" class="nos-relay-add-btn">'+esc(t('nos_add'))+'</button></div><div class="nos-error nos-relay-error"></div><button type="button" class="primary nos-relay-save">'+esc(t('nos_save'))+'</button></div>';
      renderRelayList();
      body.querySelector('.nos-relay-add-btn').onclick=function(){
        var input=body.querySelector('.nos-relay-url'),url=input.value.trim();
        if(!/^wss?:\/\/.+/.test(url)){body.querySelector('.nos-relay-error').textContent=t('nos_invalid_relay');return}
        if(relays.some(function(r){return r.url===url}))return;
        relays.push({url:url,read:1,write:1});input.value='';renderRelayList();
      };
      body.querySelector('.nos-relay-save').onclick=async function(){
        var err=body.querySelector('.nos-relay-error');err.textContent='';
        try{
          await api('/relays',{method:'PUT',body:JSON.stringify({relays:relays.map(function(r){return{url:r.url,read:!!r.read,write:!!r.write}})})});
          pool.setRelayUrls(relays.map(function(r){return r.url}),[TRENDING_URL]);
          loadFeed();loadNotifications();
        }catch(_){err.textContent=t('nos_save_error')}
      };
    }

    function destroy(){
      destroyed=true;
      clearTimeout(autoLockTimer);clearTimeout(renderTimer);clearTimeout(profileTimer);clearTimeout(noteTimer);
      clearTimeout(searchDebounce);
      stopModePolling();
      document.removeEventListener('visibilitychange',onVisible);
      pool.destroy();
    }
    // Switching/removing/logging out of an identity used to reload the whole
    // browser tab. On the public page that's just this one app's own tab, so
    // it's harmless — but on the desktop every app shares one page with the
    // rest of mvmOS, and a reload there wiped the whole running session, not
    // just this widget. Tear down and re-mount in place instead, there only.
    function remount(){if(opts.isDesktop){destroy();mount(root,opts)}else{location.reload()}}

    document.addEventListener('visibilitychange',onVisible);
    load();
    return{destroy:destroy};
  }

  window.NostradamusWidget={mount:mount};
})();
