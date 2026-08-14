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
      setRelayUrls:function(urls){
        Object.keys(conns).forEach(function(url){
          if(urls.indexOf(url)<0){var c=conns[url];c.closing=true;clearTimeout(c.timer);if(c.ws)c.ws.close();delete conns[url]}
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
  var IDB_NAME='nostradamus',IDB_STORE='session',IDB_ID='current';
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
  function idbGet(){return idbRun('readonly',function(store){return store.get(IDB_ID)}).catch(function(){return null})}
  function idbPut(value){return idbRun('readwrite',function(store){store.put(value,IDB_ID);return null}).catch(function(){})}
  function idbDel(){return idbRun('readwrite',function(store){store.delete(IDB_ID);return null}).catch(function(){})}

  var styled=false;
  function style(){if(styled)return;styled=true;var s=document.createElement('style');s.textContent='.nos,.nos *,.nos-modal,.nos-modal *{box-sizing:border-box}.nos{height:100%;display:flex;flex-direction:column;position:relative;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);font-family:system-ui,sans-serif;overflow:hidden}.nos-bar{border-bottom:1px solid var(--pub-border,#45475a);flex:0 0 auto}.nos-bar-head{display:flex;align-items:center;gap:.5rem;padding:.55rem .7rem}.nos-title{font-weight:700;font-size:.88rem;white-space:nowrap}.nos-tabs{display:flex;gap:.25rem;flex:1;overflow-x:auto;scrollbar-width:none}.nos-tabs::-webkit-scrollbar{display:none}.nos-tab{background:transparent;padding:.35rem .6rem;border-radius:.5rem;white-space:nowrap;position:relative}.nos-tab.active{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e)}.nos-badge{display:inline-block;min-width:1.05rem;padding:0 .25rem;margin-left:.25rem;border-radius:.6rem;background:var(--pub-red,#f38ba8);color:var(--pub-bg,#1e1e2e);font-size:.65rem;line-height:1.05rem;text-align:center}.nos-bar-btn{flex:0 0 auto;padding:.35rem .5rem}.nos-me{flex:0 0 auto;padding:0;background:none!important}.nos-modes{display:flex;gap:.3rem;padding:0 .7rem .55rem;overflow-x:auto;scrollbar-width:none}.nos-modes::-webkit-scrollbar{display:none}.nos-mode{background:var(--pub-surface2,#313244);padding:.28rem .6rem;border-radius:999px;font-size:.74rem;white-space:nowrap}.nos-mode.active{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e)}.nos-body{flex:1;min-height:0;overflow:auto;padding:.7rem}.nos button,.nos input,.nos textarea,.nos select,.nos-modal button,.nos-modal textarea{font:inherit}.nos button,.nos-modal button{border:0;border-radius:.45rem;padding:.45rem .7rem;cursor:pointer;font-size:.8rem;font-weight:600;background:var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4);transition:filter .15s,transform .15s}.nos button:hover,.nos-modal button:hover{filter:brightness(1.12)}.nos button:active{transform:translateY(1px)}.nos button:disabled{opacity:.6;cursor:default}.nos .primary,.nos-modal .primary{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e)}.nos input,.nos textarea,.nos select,.nos-modal textarea{width:100%;background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);border-radius:.45rem;color:var(--pub-fg,#cdd6f4);padding:.55rem .65rem;outline:none;margin:.3rem 0}.nos input:focus,.nos textarea:focus,.nos select:focus,.nos-modal textarea:focus{border-color:var(--pub-accent,#89b4fa)}.nos-error{min-height:1.2rem;color:var(--pub-red,#f38ba8);font-size:.8rem;margin:.3rem 0}.nos-empty{display:flex;flex:1;align-items:center;justify-content:center;text-align:center;padding:1.5rem;color:var(--pub-fg2,#a6adc8);font-size:.85rem}.nos-unlock,.nos-onboard{display:flex;flex:1;align-items:center;justify-content:center;padding:1rem}.nos-unlock>div,.nos-card{width:100%;max-width:24rem;background:var(--pub-surface2,#313244);padding:1.25rem;border-radius:.7rem}.nos-unlock h2,.nos-card h2{font-size:1.05rem;margin:0 0 .4rem}.nos-unlock p,.nos-card p{font-size:.82rem;line-height:1.45;color:var(--pub-fg2,#a6adc8)}.nos-duration-hint{font-size:.72rem;opacity:.75;margin:.2rem 0 .6rem}.nos-warn{font-size:.78rem;line-height:1.45;color:#f9e2af;border:1px solid #f9e2af;border-radius:.45rem;padding:.5rem .6rem;margin:.5rem 0}.nos-link{background:none!important;padding:.4rem 0;font-size:.78rem;font-weight:400;color:var(--pub-accent,#89b4fa);text-decoration:underline}.nos-view-value{background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);border-radius:.45rem;padding:.55rem .65rem;font-size:.8rem;overflow-wrap:anywhere;margin:.3rem 0}.nos-key-value{font-family:monospace}.nos-check{display:flex!important;align-items:center;gap:.45rem;width:auto;font-size:.8rem;cursor:pointer}.nos-check input{width:auto;margin:0}.nos-note{border:1px solid var(--pub-border,#45475a);background:var(--pub-surface2,#313244);border-radius:.65rem;padding:.65rem;margin-bottom:.55rem;cursor:pointer;transition:background .3s}.nos-note:hover{filter:brightness(1.05)}.nos-note.nos-flat{border:0;background:none;padding:.55rem 0;border-bottom:1px solid var(--pub-border,#45475a);border-radius:0;margin:0}.nos-boost{font-size:.72rem;color:var(--pub-fg2,#a6adc8);margin-bottom:.35rem}.nos-note-head{display:flex;align-items:center;gap:.5rem}.nos-avatar-wrap{position:relative;width:2.1rem;height:2.1rem;flex:0 0 auto;cursor:pointer}.nos-avatar-wrap.nos-lg{width:4rem;height:4rem}.nos-avatar{position:absolute;inset:0;width:100%;height:100%;border-radius:.5rem;object-fit:cover;display:grid;place-items:center;background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);font-weight:800;overflow:hidden}.nos-avatar-img{background:var(--pub-surface2,#313244)}.nos-note-who{flex:1;min-width:0;cursor:pointer}.nos-note-name{display:block;font-weight:700;font-size:.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nos-note-time{display:block;font-size:.71rem;color:var(--pub-dim,#a6adc8)}.nos-nip05{font-size:.71rem;color:var(--pub-accent,#89b4fa)}.nos-follow-btn{flex:0 0 auto;padding:.28rem .55rem;font-size:.72rem}.nos-reply-of-wrap{margin:.35rem 0}.nos-reply-of-label{font-size:.72rem;color:var(--pub-fg2,#a6adc8);margin-bottom:.2rem}.nos-reply-of-wrap .nos-quote{margin:0;padding:.4rem .5rem}.nos-reply-of-wrap .nos-quote .nos-note-content{font-size:.76rem;max-height:5rem}.nos-reply-of-wrap .nos-avatar-wrap{width:1.5rem;height:1.5rem}.nos-reply-of-wrap .nos-note-name{font-size:.76rem}.nos-reply-of-wrap .nos-note-time{font-size:.66rem}.nos-note-content{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.86rem;margin:.4rem 0;overflow:hidden}.nos-note-content a{color:var(--pub-accent,#89b4fa)}.nos-mention{color:var(--pub-accent,#89b4fa);cursor:pointer}.nos-embed-link{display:block;width:100%}.nos-embed-img{display:block;max-width:100%;height:auto;max-height:22rem;border-radius:.5rem;margin-top:.4rem;object-fit:contain}.nos-quote{border:1px solid var(--pub-border,#45475a);border-radius:.5rem;padding:.5rem;margin:.45rem 0;background:var(--pub-bg,#1e1e2e)}.nos-quote .nos-note-content{font-size:.8rem;max-height:12rem}.nos-note-actions{display:flex;gap:.15rem;flex-wrap:wrap;margin-top:.2rem}.nos-act{background:transparent!important;padding:.3rem .45rem;font-size:.74rem;font-weight:400;color:var(--pub-fg2,#a6adc8)}.nos-act:hover{color:var(--pub-fg,#cdd6f4)}.nos-act.on{color:var(--pub-accent,#89b4fa);font-weight:700}.nos-act.nos-a-like.on{color:var(--pub-red,#f38ba8)}.nos-act.nos-a-repost.on{color:var(--pub-green,#a6e3a1)}.nos-modal{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;padding:1rem;z-index:20;overflow:auto}.nos-modal-card{width:100%;max-width:30rem;background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border-radius:.7rem;padding:.9rem;font-family:system-ui,sans-serif}.nos-modal-head{display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem}.nos-modal-title{flex:1;font-weight:700;font-size:.9rem}.nos-modal-input{min-height:6rem;resize:vertical}.nos-modal-foot{display:flex;gap:.4rem;justify-content:flex-end;align-items:center}.nos-modal-ctx{max-height:11rem;overflow:auto;margin-bottom:.5rem}.nos-user-head{margin-bottom:.7rem}.nos-banner{width:100%;height:6.5rem;object-fit:cover;border-radius:.5rem;background:var(--pub-surface2,#313244)}.nos-user-row{display:flex;align-items:flex-end;gap:.6rem;margin-top:-1.6rem;padding:0 .3rem}.nos-user-meta{flex:1;min-width:0;padding-bottom:.2rem}.nos-user-name{font-weight:800;font-size:1rem}.nos-user-about{font-size:.82rem;line-height:1.45;margin:.5rem 0;white-space:pre-wrap;overflow-wrap:anywhere}.nos-user-stats{font-size:.74rem;color:var(--pub-fg2,#a6adc8);display:flex;gap:.9rem;flex-wrap:wrap}.nos-notif{display:flex;gap:.5rem;align-items:flex-start;border-bottom:1px solid var(--pub-border,#45475a);padding:.55rem .1rem;cursor:pointer}.nos-notif-body{flex:1;min-width:0}.nos-notif-line{font-size:.8rem}.nos-notif-quote{font-size:.76rem;color:var(--pub-fg2,#a6adc8);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-top:.15rem}.nos-notif-time{font-size:.7rem;color:var(--pub-dim,#a6adc8)}.nos-profile-form label{display:block;font-size:.75rem;font-weight:700;color:var(--pub-fg2,#a6adc8);margin:.55rem 0 .15rem}.nos-profile-form textarea{min-height:4rem}.nos-profile-meta{margin-top:1rem;font-size:.76rem;color:var(--pub-fg2,#a6adc8)}.nos-relay-row{display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--pub-border,#45475a);font-size:.82rem;flex-wrap:wrap}.nos-relay-dot{width:.6rem;height:.6rem;border-radius:50%;flex:0 0 auto;background:var(--pub-dim,#a6adc8)}.nos-relay-open{background:var(--pub-green,#a6e3a1)}.nos-relay-connecting{background:#f9e2af}.nos-relay-closed,.nos-relay-error{background:var(--pub-red,#f38ba8)}.nos-relay-url{flex:1;min-width:9rem;overflow-wrap:anywhere}.nos-relay-del{flex:0 0 auto;padding:.3rem .5rem}.nos-relay-add{display:flex;gap:.4rem;margin-top:.6rem}.nos-relay-add input{flex:1;margin:0}.nos-relay-add button{flex:0 0 auto}.nos-newposts{position:sticky;top:0;left:0;z-index:5;display:flex;align-items:center;gap:.4rem;margin:0 auto .6rem;padding:.4rem .8rem .4rem .4rem;border-radius:999px;background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);font-size:.78rem;font-weight:700;box-shadow:0 .25rem .6rem rgba(0,0,0,.25)}.nos-newposts-avatars{display:flex}.nos-newposts-avatars .nos-avatar-wrap{width:1.6rem;height:1.6rem;margin-left:-.6rem;border:2px solid var(--pub-accent,#89b4fa);border-radius:.6rem}.nos-newposts-avatars .nos-avatar-wrap:first-child{margin-left:0}.nos-newposts-avatars .nos-avatar{font-size:.68rem}.nos-people-stats{display:flex;gap:1rem;margin:.5rem 0}.nos-people-btn{background:none!important;padding:0;font-size:.8rem;font-weight:400;color:var(--pub-fg2,#a6adc8)}.nos-people-btn:hover{color:var(--pub-fg,#cdd6f4)}.nos-people-btn b{color:var(--pub-fg,#cdd6f4);font-weight:700}.nos-modal-images{display:flex;gap:.4rem;flex-wrap:wrap;margin:.3rem 0}.nos-modal-image{position:relative;width:4.5rem;height:4.5rem}.nos-modal-image img{width:100%;height:100%;object-fit:cover;border-radius:.45rem}.nos-modal-image-del{position:absolute;top:-.35rem;right:-.35rem;width:1.3rem;height:1.3rem;padding:0;border-radius:50%;background:var(--pub-red,#f38ba8)!important;color:var(--pub-bg,#1e1e2e);font-size:.65rem;line-height:1;display:flex;align-items:center;justify-content:center}.nos-modal-image-btn{background:transparent!important;font-size:1rem;padding:.4rem .5rem}.nos-modal-foot{align-items:center}';document.head.appendChild(s)}

  function mount(root,opts){
    opts=opts||{};style();
    var token=localStorage.getItem('apphub_token');
    if(!token){root.innerHTML='<div class="nos-empty">'+esc(t('nos_login'))+'</div>';if(opts.onNeedLogin)opts.onNeedLogin();return{destroy:function(){}}}
    var DURATION_KEY='nos_vault_duration',TAB_KEY='nos_vault_tab',SEEN_KEY='nos_notif_seen',FEED_MODE_KEY='nos_feed_mode';
    var FEED_MODES=['following','1','4','24'];
    var MAX_STREAK=7;
    var key=null,privBytes=null,pubHex=null,vaultInfo=null,relays=[],autoLockTimer=0,destroyed=false,session=null;
    var activeTab='feed',feedMode=FEED_MODES.indexOf(localStorage.getItem(FEED_MODE_KEY))>=0?localStorage.getItem(FEED_MODE_KEY):'following',stack=[];
    var feedItems=[],feedKeys={},feedLoaded=false,feedToken=0;
    var pendingItems=[],pendingKeys={};
    // Each loadTrending() call gets its own trend-e/n/r sub IDs so an overlapping
    // call (mode switch racing a still-loading previous mode, or the background
    // poll re-querying the active trending mode) can never clobber another's
    // in-flight subscriptions by reusing the same pool sub ID.
    var trendSeq=0,activeTrendSubs=[];
    // How many unseen following-feed items are waiting while some other mode
    // is active — shown as a badge on the "Следвани" nos-mode button. Trending
    // modes never get a background badge (only the active one polls itself,
    // via loadTrending's own live/pending gate), so only "following" is
    // tracked here. modeSeenKeys stops the background poll from re-counting
    // the same note on every tick; modeSeenInit seeds it silently on the
    // first poll instead of counting whatever it finds as "new".
    var modeCounts={following:0,'1':0,'4':0,'24':0};
    var modeSeenKeys={following:{}};
    var modeSeenInit={following:false};
    var modePollTimer=0;
    var contactPubkeys=[];
    var profileCache={},noteCache={},stats={},myReactions={},myReposts={},ownProfileRaw={};
    var notifItems=[],notifKeys={},notifLoaded=false,notifSeen=Number(localStorage.getItem(SEEN_KEY)||0);
    var threadReplies=[],threadKeys={},threadLoaded=false;
    var userNotes=[],userKeys={},userLoaded=false;
    var peopleList=[],peopleKeys={},peopleLoaded=false;
    var composer=null;
    var obStep='choose',obPriv=null;
    function blankRecover(){return{nsec:'',pass:'',confirm:'',replace:false,duration:''}}
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
    async function encryptPriv(rawBytes){var iv=crypto.getRandomValues(new Uint8Array(12));var data=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},key,rawBytes);return{iv:b64(iv),ciphertext:b64(data)}}
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
    function saveSession(saved){idbPut(saved)}
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
    function cacheKey(value){
      var minutes=minutesOf(value),saved={key:key,minutes:minutes,streak:1,day:dayStamp(),tab:minutes?null:tabMarker()};
      saved.expires=expiryOf(saved);
      session=saved;
      scheduleAutoLock(saved.expires);
      try{localStorage.setItem(DURATION_KEY,value)}catch(_){}
      return idbPut(saved);
    }
    async function readSession(){
      var saved=await idbGet();
      if(!saved)return null;
      var alive=saved.minutes?saved.expires>Date.now():!!saved.tab&&saved.tab===sessionStorage.getItem(TAB_KEY);
      if(!alive){await idbDel();return null}
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
      }catch(_){await idbDel();key=null;privBytes=null;session=null;return false}
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
    function clearCachedKey(){idbDel()}
    function lockedAtHint(){return session&&session.expires?t('nos_locks_at',{time:new Date(session.expires).toLocaleString()}):t('nos_lock')}
    function resetState(){
      clearTimeout(autoLockTimer);autoLockTimer=0;clearTimeout(renderTimer);clearTimeout(profileTimer);clearTimeout(noteTimer);
      stopModePolling();
      key=null;privBytes=null;pubHex=null;session=null;composer=null;stack=[];activeTab='feed';
      feedItems=[];feedKeys={};feedLoaded=false;feedToken++;contactPubkeys=[];
      modeCounts={following:0,'1':0,'4':0,'24':0};modeSeenKeys={following:{}};modeSeenInit={following:false};
      pendingItems=[];pendingKeys={};
      profileCache={};noteCache={};stats={};myReactions={};myReposts={};ownProfileRaw={};
      notifItems=[];notifKeys={};notifLoaded=false;profileQueue=[];noteQueue=[];
      clearCachedKey();pool.destroy();pool=createPool();bindPool();
    }
    function lockNow(){resetState();load()}
    function startRecover(){resetState();recoverForm=blankRecover();recoverScreen()}

    function writeUrls(){return relays.filter(function(r){return r.write}).map(function(r){return r.url})}
    function readUrls(){return relays.filter(function(r){return r.read}).map(function(r){return r.url})}

    function durationOptions(){return'<option value="5">'+esc(t('nos_minutes',{n:5}))+'</option><option value="15">'+esc(t('nos_minutes',{n:15}))+'</option><option value="60">'+esc(t('nos_hour'))+'</option><option value="240">'+esc(t('nos_hours',{n:4}))+'</option><option value="1440">'+esc(t('nos_hours',{n:24}))+'</option><option value="10080">'+esc(t('nos_days',{n:7}))+'</option><option value="session">'+esc(t('nos_until_closed'))+'</option>'}
    function durationBlock(){return'<label class="nos-duration-label">'+esc(t('nos_unlock_for'))+'</label><select class="nos-duration">'+durationOptions()+'</select><div class="nos-duration-hint">'+esc(t('nos_unlock_sliding'))+'</div>'}
    function applyDuration(){var select=root.querySelector('.nos-duration');if(select)select.value=localStorage.getItem(DURATION_KEY)||'15';return select}

    function formatTime(ts){var diff=Math.floor(Date.now()/1000)-ts;if(diff<60)return t('nos_just_now');if(diff<3600)return t('nos_minutes_ago',{n:Math.floor(diff/60)});if(diff<86400)return t('nos_hours_ago',{n:Math.floor(diff/3600)});if(diff<604800)return t('nos_days_ago',{n:Math.floor(diff/86400)});return new Date(ts*1000).toLocaleDateString()}

    // ---- onboarding ----
    function onboardingScreen(error){
      if(obStep==='choose'){
        root.innerHTML='<div class="nos nos-onboard"><div class="nos-card"><h2>'+esc(t('nos_welcome_title'))+'</h2><p>'+esc(t('nos_welcome_info'))+'</p><button class="primary nos-ob-generate">'+esc(t('nos_generate_key'))+'</button><button class="nos-ob-import">'+esc(t('nos_import_key'))+'</button><div class="nos-error">'+esc(error||'')+'</div></div></div>';
        root.querySelector('.nos-ob-generate').onclick=function(){obPriv=genPrivKey();obStep='reveal';onboardingScreen()};
        root.querySelector('.nos-ob-import').onclick=function(){obStep='import';onboardingScreen()};
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
          try{
            var salt=b64(crypto.getRandomValues(new Uint8Array(32)));
            key=await derive(pass,salt,600000);
            var enc=await encryptPriv(obPriv);
            var pubHexLocal=bytesToHex(getXOnlyPubkey(obPriv));
            var npub=npubEncode(pubHexLocal);
            await api('/vault',{method:'POST',body:JSON.stringify({npub:npub,salt:salt,iterations:600000,iv:enc.iv,ciphertext:enc.ciphertext})});
            privBytes=obPriv;pubHex=pubHexLocal;obPriv=null;
            vaultInfo={npub:npub,salt:salt,iterations:600000,iv:enc.iv,ciphertext:enc.ciphertext};
            await cacheKey(select.value);
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
    // password it replaces, so it can mint a new one. The same screen doubles as
    // "sign in as someone else": a key that is not the stored one replaces the
    // identity outright, which is destructive enough to demand an explicit tick.
    function recoverScreen(error){
      root.innerHTML='<div class="nos nos-unlock"><div><h2>'+esc(t('nos_reset_title'))+'</h2><p>'+esc(t('nos_reset_info'))+'</p>'+
        '<input class="nos-r-key" type="password" autocomplete="off" placeholder="'+esc(t('nos_import_placeholder'))+'">'+
        '<input class="nos-r-pass" type="password" autocomplete="new-password" placeholder="'+esc(t('nos_master'))+'">'+
        '<input class="nos-r-confirm" type="password" autocomplete="new-password" placeholder="'+esc(t('nos_confirm_master'))+'">'+
        durationBlock()+
        (recoverForm.replace?'<div class="nos-warn">'+esc(t('nos_reset_other_key'))+'</div><label class="nos-check"><input type="checkbox" class="nos-r-replace"> '+esc(t('nos_reset_replace_confirm'))+'</label>':'')+
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
        var npub=npubEncode(pubHexLocal),replacing=npub!==vaultInfo.npub;
        if(replacing&&!recoverForm.replace){recoverForm.replace=true;recoverScreen();return}
        if(replacing&&!root.querySelector('.nos-r-replace').checked){recoverScreen(t('nos_reset_needs_confirm'));return}
        if(recoverForm.pass.length<MIN_MASTER){recoverScreen(t('nos_password_short',{n:MIN_MASTER}));return}
        if(recoverForm.pass!==recoverForm.confirm){recoverScreen(t('nos_passwords_differ'));return}
        var chosen=select.value;
        try{
          var salt=b64(crypto.getRandomValues(new Uint8Array(32)));
          key=await derive(recoverForm.pass,salt,600000);
          var enc=await encryptPriv(priv);
          var body={salt:salt,iterations:600000,iv:enc.iv,ciphertext:enc.ciphertext};
          if(replacing)body.npub=npub;
          await api('/vault',{method:'PUT',body:JSON.stringify(body)});
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
      try{var data=await api('/vault');vaultInfo=data.vault}catch(_){root.innerHTML='<div class="nos-empty">'+esc(t('nos_load_error'))+'</div>';return}
      if(!vaultInfo){obStep='choose';obPriv=null;onboardingScreen();return}
      var restored=await restoreLocalKey();
      if(restored){await afterUnlock();return}
      unlockScreen();
    }

    async function loadRelays(){
      var data=await api('/relays');
      relays=(data.relays&&data.relays.length)?data.relays:DEFAULT_RELAYS.map(function(u){return{url:u,read:1,write:1}});
      pool.setRelayUrls(relays.map(function(r){return r.url}));
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
    function scheduleRender(){clearTimeout(renderTimer);renderTimer=setTimeout(renderBody,140)}
    var shellRenderTimer=0;
    function scheduleRenderShell(){clearTimeout(shellRenderTimer);shellRenderTimer=setTimeout(function(){if(key)renderShell()},140)}
    function parseProfile(ev){
      var data={};try{data=JSON.parse(ev.content)||{}}catch(_){}
      return{created_at:ev.created_at,raw:data,name:data.display_name||data.name||'',handle:data.name||'',
             about:data.about||'',picture:data.picture||'',banner:data.banner||'',website:data.website||'',nip05:data.nip05||''};
    }
    function ensureProfile(pk){
      if(!pk||profileCache[pk]!==undefined)return;
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
        if(ev.pubkey===pubHex)ownProfileRaw=profileCache[ev.pubkey].raw||{};
        scheduleRender();
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
      pendingKeys[item.key]=1;
      pendingItems.push(item);
      if(pendingItems.length>40)pendingItems.length=40;
      scheduleRender();
    }
    function acceptPending(){
      pendingItems.forEach(function(item){delete pendingKeys[item.key];pushItem(item)});
      pendingItems=[];
      var body=root.querySelector('.nos-body');
      if(body)body.scrollTop=0;
      scheduleRender();
    }
    function addFeedEvent(ev){
      var live=feedMode==='following'&&feedLoaded;
      if(ev.kind===6){
        var targetId=lastETag(ev);
        if(!targetId)return;
        var embedded=null;try{embedded=JSON.parse(ev.content)}catch(_){}
        // NIP-18 lets the repost carry the original inline; using it saves a
        // round trip, but only when it really is the event the tag points at.
        if(embedded&&embedded.id===targetId&&embedded.kind===1){noteCache[targetId]=embedded;ensureProfile(embedded.pubkey)}
        else ensureNote(targetId);
        ensureProfile(ev.pubkey);
        (live?pushPending:pushItem)({key:'boost:'+ev.id,noteId:targetId,boost:ev,at:ev.created_at});
        return;
      }
      if(ev.kind!==1)return;
      noteCache[ev.id]=ev;ensureProfile(ev.pubkey);
      (live?pushPending:pushItem)({key:ev.id,noteId:ev.id,boost:null,at:ev.created_at});
    }
    function stopFeedSubs(){['feed'].concat(activeTrendSubs).forEach(function(id){pool.unsubscribe(id)});activeTrendSubs=[]}
    function loadFeed(){
      var token=++feedToken;
      feedItems=[];feedKeys={};feedLoaded=false;
      pendingItems=[];pendingKeys={};
      modeCounts[feedMode]=0;
      if(feedMode==='following'){modeSeenKeys.following={};modeSeenInit.following=true}
      stopFeedSubs();
      if(!readUrls().length){feedLoaded=true;scheduleRender();return}
      if(feedMode==='following'){
        var authors=[pubHex].concat(contactPubkeys);
        pool.subscribe(readUrls(),'feed',[{kinds:[1,6],authors:authors,limit:60}],
          function(ev){if(token===feedToken)addFeedEvent(ev)},
          function(){if(token===feedToken){feedLoaded=true;scheduleRender()}});
      }else loadTrending(Number(feedMode),token);
      scheduleRender();
      startModePolling();
    }
    // Trending has no live subscription — it's one batch query — so the only
    // way for the active trending mode to notice new posts is to re-run that
    // query periodically. The other two trending modes are left alone (no
    // badge) — only following, which streams live anyway, gets a background
    // count, shown on its own nos-mode button while some trending mode is open.
    var MODE_POLL_MS=90000;
    function startModePolling(){
      clearInterval(modePollTimer);
      modePollTimer=setInterval(pollAllModes,MODE_POLL_MS);
    }
    function stopModePolling(){clearInterval(modePollTimer);modePollTimer=0}
    function pollAllModes(){
      if(activeTab!=='feed'||!readUrls().length||stack.length)return;
      if(feedMode==='following')return;
      // The active trending mode re-runs its own query to fill its "new posts"
      // pill, same gate as the following feed's live pushPending. Following
      // itself streams live already, so it never needs polling for its own
      // sake — this second call exists purely to fill the "Следвани" badge
      // while some trending mode is the active tab.
      loadTrending(Number(feedMode),feedToken,true);
      pollFollowingCount();
    }
    function pollFollowingCount(){
      var authors=[pubHex].concat(contactPubkeys),subId='poll-following',firstRun=!modeSeenInit.following;
      pool.unsubscribe(subId);
      pool.subscribe(readUrls(),subId,[{kinds:[1,6],authors:authors,limit:20}],function(ev){
        if(modeSeenKeys.following[ev.id])return;
        modeSeenKeys.following[ev.id]=1;
        if(!firstRun){modeCounts.following++;scheduleRenderShell()}
      },function(){pool.unsubscribe(subId);modeSeenInit.following=true});
    }
    // Plain relays have no trending endpoint — that is a service Primal runs on
    // top of Nostr, not part of the protocol. What a client can do honestly is
    // measure it: pull the reactions and reposts from the window, tally which
    // notes they point at, then fetch those notes. Reposts weigh more than likes
    // because they cost the sender their own audience.
    function loadTrending(hours,token,live){
      var since=Math.floor(Date.now()/1000)-hours*3600,scores={};
      var seq=++trendSeq,idE='trend-e-'+seq,idN='trend-n-'+seq,idR='trend-r-'+seq;
      if(!live)activeTrendSubs=[idE,idN,idR];
      function rank(ev){return(scores[ev.id]||0)*1e10+ev.created_at}
      function accept(ev){
        if(token!==feedToken||ev.kind!==1||ev.created_at<since||isReply(ev))return;
        noteCache[ev.id]=ev;ensureProfile(ev.pubkey);
        (live?pushPending:pushItem)({key:ev.id,noteId:ev.id,boost:null,at:rank(ev)});
      }
      pool.subscribe(readUrls(),idE,[{kinds:[6,7],since:since,limit:1000}],function(ev){
        var target=lastETag(ev);
        if(target)scores[target]=(scores[target]||0)+(ev.kind===6?3:1);
      },function(){
        if(token!==feedToken){pool.unsubscribe(idE);pool.unsubscribe(idN);pool.unsubscribe(idR);return}
        pool.unsubscribe(idE);
        var top=Object.keys(scores).sort(function(a,b){return scores[b]-scores[a]}).slice(0,60);
        if(top.length)pool.subscribe(readUrls(),idN,[{ids:top}],accept,function(){pool.unsubscribe(idN);if(token===feedToken){feedLoaded=true;scheduleRender()}});
        // A quiet hour on a small relay set produces almost no reactions, and an
        // empty tab reads as broken. Recent notes fill in below everything scored.
        pool.subscribe(readUrls(),idR,[{kinds:[1],since:since,limit:60}],accept,
          function(){pool.unsubscribe(idR);if(token===feedToken){feedLoaded=true;scheduleRender()}});
      });
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
    function pushView(view){stack.push(view);renderShell()}
    function popView(){
      stack.pop();
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
    function openComposer(mode,id){composer={mode:mode,id:id||null,error:'',busy:false,images:[],uploading:false};renderComposer()}
    function closeComposer(){composer=null;renderComposer()}
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
        (composer.images.length?'<div class="nos-modal-images">'+composer.images.map(function(url,i){
          return'<div class="nos-modal-image"><img src="'+esc(url)+'"><button type="button" class="nos-modal-image-del" data-i="'+i+'">✕</button></div>';
        }).join('')+'</div>':'')+
        '<div class="nos-error nos-modal-error">'+esc(composer.error||'')+'</div>'+
        '<div class="nos-modal-foot"><input type="file" accept="image/*" class="nos-modal-file" hidden>'+
        '<button type="button" class="nos-modal-image-btn" title="'+esc(t('nos_attach_image'))+'"'+(composer.uploading?' disabled':'')+'>'+(composer.uploading?'…':'🖼')+'</button>'+
        '<span style="flex:1"></span>'+
        '<button type="button" class="nos-modal-cancel">'+esc(t('nos_cancel'))+'</button><button type="button" class="primary nos-modal-send"'+(composer.busy?' disabled':'')+'>'+esc(composer.busy?t('nos_sending'):t('nos_publish'))+'</button></div></div>';
      root.appendChild(wrap);
      var textarea=wrap.querySelector('.nos-modal-input');
      textarea.value=composer.text||'';
      wrap.querySelector('.nos-modal-close').onclick=closeComposer;
      wrap.querySelector('.nos-modal-cancel').onclick=closeComposer;
      wrap.onclick=function(e){if(e.target===wrap)closeComposer()};
      wrap.querySelectorAll('.nos-modal-image-del').forEach(function(btn){
        btn.onclick=function(){composer.text=textarea.value;composer.images.splice(Number(btn.dataset.i),1);renderComposer()};
      });
      var fileInput=wrap.querySelector('.nos-modal-file');
      wrap.querySelector('.nos-modal-image-btn').onclick=function(){fileInput.click()};
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
          if(!stack.length&&activeTab==='feed')pushItem({key:ev.id,noteId:ev.id,boost:null,at:feedMode==='following'?ev.created_at:Date.now()/1000});
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
    function renderContent(text,skipId){
      var out=esc(text).replace(URL_RE,function(url){
        var plain=url.replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"');
        var noQuery=plain.split(/[?#]/)[0];
        if(IMG_EXT_RE.test(noQuery))return'<a href="'+url+'" target="_blank" rel="noopener noreferrer" class="nos-embed-link"><img class="nos-embed-img" src="'+url+'" loading="lazy" referrerpolicy="no-referrer"></a>';
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
    function actionsHtml(id){
      var s=stats[id]||{replies:0,reposts:0,likes:0};
      var liked=!!myReactions[id],reposted=!!myReposts[id];
      return'<div class="nos-note-actions">'+
        '<button type="button" class="nos-act nos-a-reply" data-act="reply" data-id="'+esc(id)+'">💬 '+(s.replies||'')+'</button>'+
        '<button type="button" class="nos-act nos-a-repost'+(reposted?' on':'')+'" data-act="repost" data-id="'+esc(id)+'" title="'+esc(t('nos_repost'))+'">🔁 '+(s.reposts||'')+'</button>'+
        '<button type="button" class="nos-act nos-a-quote" data-act="quote" data-id="'+esc(id)+'" title="'+esc(t('nos_quote'))+'">❝</button>'+
        '<button type="button" class="nos-act nos-a-like'+(liked?' on':'')+'" data-act="like" data-id="'+esc(id)+'" title="'+esc(t('nos_like'))+'">'+(liked?'❤️':'🤍')+' '+(s.likes||'')+'</button>'+
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
        (quoted?quoteHtml(quoted):'')+
        (options.actions===false?'':actionsHtml(note.id))+
        '</div>';
    }
    function listHtml(items,options){return items.map(function(item){return noteCardHtml(item,options)}).join('')}

    function renderShell(){
      if(!key)return;
      var back=stack.length?'<button type="button" class="nos-bar-btn nos-back">←</button>':'';
      var unread=unreadCount();
      root.innerHTML='<div class="nos"><div class="nos-bar"><div class="nos-bar-head">'+back+
        '<span class="nos-title">🔮 '+esc(t('nos_app_title'))+'</span>'+
        '<div class="nos-tabs">'+
          ['feed','notifications','profile','relays'].map(function(id){
            var label=t(id==='feed'?'nos_tab_feed':id==='notifications'?'nos_tab_notifications':id==='profile'?'nos_tab_profile':'nos_tab_relays');
            return'<button class="nos-tab'+(activeTab===id&&!stack.length?' active':'')+'" data-tab="'+id+'">'+esc(label)+(id==='notifications'&&unread?'<span class="nos-badge">'+(unread>99?'99+':unread)+'</span>':'')+'</button>';
          }).join('')+
        '</div>'+
        '<button type="button" class="nos-bar-btn nos-new" title="'+esc(t('nos_new_note'))+'">✏️</button>'+
        '<button type="button" class="nos-bar-btn nos-lock-btn" title="'+esc(lockedAtHint())+'">🔒</button>'+
        '</div>'+
        (activeTab==='feed'&&!stack.length?'<div class="nos-modes">'+
          [['following','nos_mode_following'],['1','nos_mode_1h'],['4','nos_mode_4h'],['24','nos_mode_24h']].map(function(pair){
            var count=modeCounts[pair[0]];
            return'<button class="nos-mode'+(feedMode===pair[0]?' active':'')+'" data-mode="'+pair[0]+'">'+esc(t(pair[1]))+
              (feedMode!==pair[0]&&count?'<span class="nos-badge">'+(count>99?'99+':count)+'</span>':'')+'</button>';
          }).join('')+'</div>':'')+
        '</div><div class="nos-body"></div></div>';
      root.querySelectorAll('.nos-tab').forEach(function(btn){btn.onclick=function(){switchTab(btn.dataset.tab)}});
      root.querySelectorAll('.nos-mode').forEach(function(btn){btn.onclick=function(){if(feedMode===btn.dataset.mode)return;feedMode=btn.dataset.mode;try{localStorage.setItem(FEED_MODE_KEY,feedMode)}catch(_){}loadFeed();renderShell()}});
      root.querySelector('.nos-new').onclick=function(){openComposer('note')};
      root.querySelector('.nos-lock-btn').onclick=function(){lockNow()};
      if(back)root.querySelector('.nos-back').onclick=popView;
      renderBody();
    }
    function switchTab(tab){
      stack=[];
      activeTab=tab;
      if(tab==='notifications')markNotifSeen();
      if(tab==='feed'&&!feedItems.length)loadFeed();
      renderShell();
    }
    function renderBody(){
      var body=root.querySelector('.nos-body');
      if(!body)return;
      var scroll=body.scrollTop;
      var view=stack[stack.length-1];
      if(view&&view.type==='thread')renderThread(body,view);
      else if(view&&view.type==='user')renderUser(body,view);
      else if(view&&view.type==='people')renderPeople(body,view);
      else if(activeTab==='feed')renderFeed(body);
      else if(activeTab==='notifications')renderNotifications(body);
      else if(activeTab==='profile')renderProfileTab(body);
      else renderRelaysTab(body);
      body.scrollTop=scroll;
      bindImages(body);
    }
    function bindImages(container){
      container.querySelectorAll('.nos-avatar-img').forEach(function(img){img.onerror=function(){img.style.display='none'}});
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
          return;
        }
        if(e.target.closest('a'))return;
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
        body.innerHTML=pending+'<div class="nos-empty">'+esc(feedLoaded?(feedMode==='following'?t('nos_no_notes'):t('nos_no_trending')):t('nos_loading'))+'</div>';
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
        '<button type="button" class="nos-link nos-switch-key">'+esc(t('nos_switch_key'))+'</button></div></div>';
      body.querySelector('.nos-switch-key').onclick=function(){startRecover()};
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
          pool.setRelayUrls(relays.map(function(r){return r.url}));
          loadFeed();loadNotifications();
        }catch(_){err.textContent=t('nos_save_error')}
      };
    }

    document.addEventListener('visibilitychange',onVisible);
    load();
    return{destroy:function(){
      destroyed=true;
      clearTimeout(autoLockTimer);clearTimeout(renderTimer);clearTimeout(profileTimer);clearTimeout(noteTimer);
      stopModePolling();
      document.removeEventListener('visibilitychange',onVisible);
      pool.destroy();
    }};
  }

  window.NostradamusWidget={mount:mount};
})();
