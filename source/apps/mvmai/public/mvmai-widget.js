// mvmAI public chat page.
(function () {
  if (window.MvmaiWidget) return;

  var API = '/pub/mvmai';

  function t(key, vars) {
    var s = (window.t || function (k) { return k; })(key);
    if (vars) {
      for (var k in vars) s = s.replace('{' + k + '}', vars[k]);
    }
    return s;
  }

  // The language the page is shown in, which mvmAI answers and writes in.
  function uiLang() {
    return (window.mvmOS && window.mvmOS.lang) || null;
  }

  // An app's name in the user's language (the manifest's name_i18n).
  function appName(app) {
    return window.mvmOS && window.mvmOS.appName ? window.mvmOS.appName(app) : app.name;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];
    });
  }

  function nl2br(value) {
    return esc(value).replace(/\n/g, '<br>');
  }

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.textContent = `
      .mvmai-widget,.mvmai-widget *{box-sizing:border-box}
      .mvmai-widget{height:100%;width:100%;display:flex;flex-direction:column;background:var(--pub-bg,#1e1e2e);
        color:var(--pub-fg,#cdd6f4);font-family:system-ui,sans-serif;overflow:hidden;position:relative}
      .mvmai-chat-col{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
      /* Desktop mvmOS window: persistent side-by-side sidebar, never an off-canvas
         overlay — unlike the public page, which stays a mobile-style slide-over. */
      .mvmai-widget.mvmai-desktop{flex-direction:row}
      .mvmai-widget.mvmai-desktop .mvmai-sidebar-backdrop{display:none}
      .mvmai-widget.mvmai-desktop .mvmai-hist-btn{display:none}
      .mvmai-widget.mvmai-desktop .mvmai-sidebar{
        position:relative!important;top:auto;left:auto;bottom:auto;width:240px;max-width:240px;
        transform:none!important;box-shadow:none;border-right:1px solid var(--pub-border,#45475a)}
      .mvmai-login,.mvmai-error{display:flex;align-items:center;justify-content:center;height:100%;
        color:var(--pub-fg2,#a6adc8);text-align:center;padding:1.25rem}
      .mvmai-header{display:flex;align-items:center;gap:.6rem;padding:.75rem .9rem;flex-shrink:0;
        border-bottom:1px solid var(--pub-border,#45475a)}
      .mvmai-header-title{font-weight:700;font-size:1rem}
      .mvmai-header-title{display:none}
      .mvmai-badge{font-size:.68rem;font-weight:700;padding:.15rem .5rem;border-radius:1rem;
        background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);white-space:nowrap}
      .mvmai-price{margin-left:auto;font-size:.72rem;color:var(--pub-dim,#6c7086);white-space:nowrap}
      .mvmai-list{flex:1;min-height:0;overflow-y:auto;padding:.9rem;display:flex;flex-direction:column;gap:.7rem}
      .mvmai-start{margin:auto;display:flex;flex-direction:column;align-items:center;gap:.9rem;padding:1rem;width:100%;max-width:26rem}
      .mvmai-start-title{font-weight:600;font-size:1rem;color:var(--pub-fg,#cdd6f4)}
      .mvmai-start-new{border:0;border-radius:.6rem;padding:.55rem 1.3rem;font:inherit;font-size:.9rem;font-weight:600;cursor:pointer;
        background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e)}
      .mvmai-start-new:hover{filter:brightness(1.08)}
      .mvmai-start-list{display:flex;flex-direction:column;gap:.15rem;width:100%;text-align:left}
      .mvmai-start-empty{color:var(--pub-fg2,#a6adc8);font-size:.8rem;text-align:center}
      .mvmai-welcome{color:var(--pub-fg2,#a6adc8);font-size:.85rem;text-align:center;margin:auto;padding:1rem}
      .mvmai-widget .mvmai-msg{display:block;max-width:85%;padding:.55rem .75rem;border-radius:.7rem;font-size:.88rem;line-height:1.45;
        overflow-wrap:anywhere;white-space:normal;user-select:text;-webkit-user-select:text}
      .mvmai-msg.user{align-self:flex-end;background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e)}
      .mvmai-msg.assistant{align-self:flex-start;background:var(--pub-surface2,#313244)}
      .mvmai-msg-meta{display:flex;flex-wrap:wrap;gap:.2rem .55rem;margin-top:.45rem;padding-top:.35rem;
        border-top:1px solid var(--pub-border,rgba(255,255,255,.09));color:var(--pub-dim,#6c7086);
        font-size:.68rem;line-height:1.2;min-width:0}
      .mvmai-provider-label{min-width:0;overflow-wrap:anywhere}
      .mvmai-msg-time{margin-left:auto;white-space:nowrap}
      .mvmai-msg.system-note{align-self:center;background:none;color:var(--pub-dim,#6c7086);font-size:.78rem;
        text-align:center;max-width:100%}
      .mvmai-tool-card{align-self:flex-start;max-width:90%;background:var(--pub-crust,#2a2a3d);
        border:1px solid var(--pub-border,#45475a);border-radius:.6rem;padding:.6rem .75rem;font-size:.8rem}
      .mvmai-tool-card .mvmai-tool-head{font-weight:600;margin-bottom:.3rem;display:flex;gap:.4rem;align-items:center}
      .mvmai-tool-card .mvmai-tool-cmd{font-family:monospace;background:var(--pub-surface2,#313244);
        padding:.3rem .45rem;border-radius:.35rem;overflow-wrap:anywhere;margin-bottom:.3rem}
      .mvmai-tool-card .mvmai-tool-out{font-family:monospace;font-size:.74rem;white-space:pre-wrap;
        overflow-wrap:anywhere;max-height:14rem;overflow-y:auto;color:var(--pub-fg2,#a6adc8)}
      .mvmai-tool-card .mvmai-dangerous{color:var(--pub-red,#f38ba8)}
      .mvmai-tool-card .mvmai-tool-toggle{background:none;border:1px solid var(--pub-border,#45475a);
        color:var(--pub-dim,#6c7086);border-radius:.35rem;padding:.15rem .5rem;font-size:.72rem;
        cursor:pointer;margin:.1rem 0 .3rem;display:inline-block}
      .mvmai-tool-card .mvmai-tool-toggle:hover{color:var(--pub-fg,#cdd6f4);border-color:var(--pub-accent,#89b4fa)}
      .mvmai-msg.system-note .mvmai-tool-toggle{background:none;border:1px solid var(--pub-border,#45475a);
        color:var(--pub-dim,#6c7086);border-radius:.35rem;padding:.15rem .5rem;font-size:.72rem;
        cursor:pointer;margin-top:.3rem}
      .mvmai-msg.system-note .mvmai-tool-out{text-align:left;font-family:monospace;font-size:.74rem;
        white-space:pre-wrap;overflow-wrap:anywhere;max-height:14rem;overflow-y:auto;
        color:var(--pub-fg2,#a6adc8);margin-top:.3rem;background:var(--pub-surface2,#313244);
        border-radius:.35rem;padding:.4rem .5rem}
      .mvmai-confirm-row{display:flex;gap:.5rem;margin-top:.4rem}
      .mvmai-confirm-row button{border:0;border-radius:.4rem;padding:.35rem .8rem;font-size:.8rem;
        font-weight:600;cursor:pointer}
      .mvmai-confirm-yes{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e)}
      .mvmai-confirm-no{background:var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4)}
      .mvmai-inputbar{display:flex;gap:.5rem;padding:.75rem .9rem;flex-shrink:0;
        border-top:1px solid var(--pub-border,#45475a)}
      .mvmai-composer-model{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem .45rem;
        flex-shrink:0;padding:.5rem .9rem 0;color:var(--pub-fg2,#a6adc8);
        border-top:1px solid var(--pub-border,#45475a);font-size:.76rem;line-height:1.35;overflow-wrap:anywhere}
      .mvmai-usage-list{display:flex;flex:1 1 22rem;min-width:0;gap:.4rem}
      .mvmai-usage-bar{position:relative;display:flex;align-items:center;justify-content:space-between;gap:.35rem;
        flex:1;min-width:0;height:1.5rem;box-sizing:border-box;padding:0 .4rem;overflow:hidden;
        border-radius:.2rem;background:color-mix(in srgb,var(--pub-bg,#1e1e2e) 90%,var(--pub-fg,#cdd6f4) 10%);
        box-shadow:inset 0 0 0 1px var(--pub-border,#45475a);font-size:.69rem;white-space:nowrap}
      .mvmai-usage-fill{position:absolute;inset:3px;--mvmai-usage-cell:calc(1.5rem - 6px);
        background:linear-gradient(to right,#53c878 0%,#8bce55 35%,#e8ce49 55%,#ee9852 75%,#e55b63 100%);
        --mvmai-usage-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 20'%3E%3Crect width='20' height='20' rx='2'/%3E%3C/svg%3E");
        -webkit-mask-image:var(--mvmai-usage-mask);mask-image:var(--mvmai-usage-mask);
        -webkit-mask-size:calc(var(--mvmai-usage-cell) + 2px) var(--mvmai-usage-cell);
        mask-size:calc(var(--mvmai-usage-cell) + 2px) var(--mvmai-usage-cell);
        -webkit-mask-position:left top;mask-position:left top;
        -webkit-mask-repeat:repeat-x;mask-repeat:repeat-x}
      .mvmai-usage-caption,.mvmai-usage-reset{position:relative;z-index:1;display:inline-flex;align-items:center;
        gap:.3rem;min-width:0;box-sizing:border-box;height:1.1rem;padding:0 .28rem;border-radius:.25rem;
        background:var(--pub-surface1,#181825);color:var(--pub-fg,#cdd6f4);
        border:1px solid var(--pub-border,#45475a);box-shadow:0 1px 2px rgba(0,0,0,.16);
        line-height:1;font-variant-numeric:tabular-nums}
      .mvmai-usage-window{min-width:0;font-weight:700;overflow:hidden;text-overflow:ellipsis}
      .mvmai-usage-percent{font-weight:700;flex-shrink:0}
      .mvmai-usage-reset{font-weight:600;margin-left:auto;flex-shrink:0}
      .mvmai-usage-next{display:none}
      .mvmai-composer-model[hidden]{display:none}
      .mvmai-composer-label.mvmai-model-change{border:0;background:none;color:inherit;padding:0;
        font:inherit;text-align:left;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px}
      .mvmai-composer-label.mvmai-model-change:hover{color:var(--pub-accent,#89b4fa)}
      .mvmai-composer-label.mvmai-model-change:focus-visible{outline:2px solid var(--pub-accent,#89b4fa);outline-offset:3px}
      .mvmai-composer-model:not([hidden])~.mvmai-inputbar{border-top:0}
      .mvmai-input{flex:1;resize:none;min-height:2.3rem;max-height:8rem;background:var(--pub-surface2,#313244);
        color:var(--pub-fg,#cdd6f4);border:1px solid var(--pub-border,#45475a);border-radius:.5rem;
        padding:.5rem .65rem;font:inherit;font-size:.88rem;outline:none}
      .mvmai-send{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);border:0;border-radius:.5rem;
        padding:0 1rem;font-weight:700;cursor:pointer;font-size:.88rem}
      .mvmai-send:disabled{opacity:.5;cursor:default}
      .mvmai-thumbs{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.4rem}
      .mvmai-thumb{height:64px;max-width:120px;border-radius:.4rem;object-fit:cover;cursor:zoom-in;
        border:1px solid var(--pub-border,#45475a);background:var(--pub-surface2,#313244)}
      .mvmai-chip .mvmai-thumb{height:28px;max-width:44px;border-radius:.25rem}
      .mvmai-lightbox{position:absolute;inset:0;z-index:80;background:rgba(0,0,0,.82);display:flex;
        align-items:center;justify-content:center;padding:1rem;cursor:zoom-out}
      .mvmai-lightbox img{max-width:100%;max-height:100%;border-radius:.4rem;box-shadow:0 0 30px rgba(0,0,0,.6)}
      .mvmai-lightbox-close{position:absolute;top:.6rem;right:.6rem;width:2.4rem;height:2.4rem;border-radius:50%;border:0;cursor:pointer;
        background:rgba(0,0,0,.65);color:#fff;font-size:1.1rem;line-height:1}
      .mvmai-term-btn{margin-left:auto;background:none;border:0;cursor:pointer;font-size:1rem;line-height:1;padding:.2rem .4rem;border-radius:.4rem;color:inherit;opacity:.8}
      .mvmai-gal-btn{margin-left:auto;background:none;border:0;cursor:pointer;font-size:1rem;line-height:1;padding:.2rem .4rem;border-radius:.4rem;color:inherit;opacity:.8}
      .mvmai-gal-btn:hover{opacity:1;background:var(--pub-surface2,#313244)}
      .mvmai-gal-btn+.mvmai-term-btn{margin-left:0}
      .mvmai-gal-btn+.mvmai-price{margin-left:.6rem}
      .mvmai-gal{position:absolute;inset:0;z-index:70;background:var(--pub-bg,#1e1e2e);display:flex;flex-direction:column;min-height:0}
      .mvmai-gal-head{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;padding:.6rem .9rem;flex-shrink:0;border-bottom:1px solid var(--pub-border,#45475a)}
      .mvmai-gal-head b{font-size:.95rem;margin-right:auto}
      .mvmai-gal-tabs{display:flex;gap:.3rem}
      .mvmai-gal-tabs button,.mvmai-gal-close{background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border:1px solid var(--pub-border,#45475a);border-radius:.4rem;padding:.25rem .6rem;font-size:.78rem;cursor:pointer}
      .mvmai-gal-tabs button.on{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);border-color:transparent;font-weight:700}
      .mvmai-gal-body{flex:1;min-height:0;overflow-y:auto;padding:.8rem .9rem}
      .mvmai-gal-wrap{overflow-x:auto}
      .mvmai-gal-table{width:100%;border-collapse:collapse;font-size:.8rem}
      .mvmai-gal-table th{text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--pub-fg2,#a6adc8);
        padding:.4rem .5rem;border-bottom:1px solid var(--pub-border,#45475a);white-space:nowrap;position:sticky;top:0;background:var(--pub-bg,#1e1e2e)}
      .mvmai-gal-table td{padding:.4rem .5rem;border-bottom:1px solid var(--pub-border,#45475a);vertical-align:middle}
      .mvmai-gal-table .c-prev{width:64px}
      .mvmai-gal-table .c-prev img,.mvmai-gal-table .c-prev .mvmai-gal-ico{width:56px;height:56px;border-radius:.4rem;object-fit:cover;display:flex;align-items:center;
        justify-content:center;background:var(--pub-surface2,#313244);font-size:1.5rem;cursor:default}
      .mvmai-gal-table .c-prev img{cursor:zoom-in}
      .mvmai-gal-table .c-name{min-width:9rem;max-width:16rem;overflow-wrap:anywhere}
      .mvmai-gal-table .c-chat{min-width:8rem;max-width:14rem}
      .mvmai-gal-table .c-chat .mvmai-gal-link{text-align:left}
      .mvmai-gal-table .c-num{white-space:nowrap;color:var(--pub-fg2,#a6adc8)}
      .mvmai-gal-table .c-act{white-space:nowrap;text-align:right}
      .mvmai-gal-table .c-act button{background:var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4);border:0;border-radius:.3rem;padding:.25rem .5rem;font-size:.85rem;cursor:pointer;margin-left:.2rem}
      .mvmai-gal-link{background:none!important;border:0;padding:0!important;color:var(--pub-accent,#89b4fa)!important;cursor:pointer;font:inherit;text-decoration:underline}
      .mvmai-gal-empty{text-align:center;color:var(--pub-fg2,#a6adc8);padding:2.5rem 1rem;font-size:.86rem}
      .mvmai-term-btn+.mvmai-price{margin-left:.6rem}
      .mvmai-term-btn:hover{opacity:1;background:var(--pub-surface2,#313244)}
      .mvmai-inputbar{position:relative;align-items:flex-end}
      .mvmai-inputbar .mvmai-send{flex-shrink:0;width:auto;height:auto;min-height:2.3rem;border-radius:.5rem;padding:0 1rem;white-space:nowrap}
      .mvmai-attach{flex-shrink:0;min-height:2.3rem;width:2.3rem;border:1px solid var(--pub-border,#45475a);border-radius:.5rem;
        background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);cursor:pointer;font-size:1rem;padding:0}
      .mvmai-chips{display:flex;flex-wrap:wrap;gap:.35rem;padding:.5rem .9rem 0;flex-shrink:0}
      .mvmai-chips[hidden]{display:none}
      .mvmai-chip{display:flex;align-items:center;gap:.35rem;max-width:100%;background:var(--pub-surface2,#313244);
        border:1px solid var(--pub-border,#45475a);border-radius:1rem;padding:.2rem .35rem .2rem .65rem;font-size:.76rem}
      .mvmai-chip.busy{opacity:.6}
      .mvmai-downloads{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem}
      .mvmai-download{cursor:pointer;background:var(--pub-surface2,#313244);color:inherit;border:1px solid var(--pub-border,#45475a);border-radius:.5rem;padding:.35rem .7rem;font:inherit;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mvmai-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:14rem}
      .mvmai-chip button{background:none;border:0;color:var(--pub-fg2,#a6adc8);cursor:pointer;padding:0 .3rem;font-size:.8rem}
      .mvmai-stop{flex-shrink:0;min-height:2.3rem;width:2.3rem;border:0;border-radius:.5rem;cursor:pointer;
        background:var(--pub-red,#f38ba8);color:var(--pub-bg,#1e1e2e);font-size:.95rem;font-weight:700}
      .mvmai-stop[hidden]{display:none}
      .mvmai-queue{display:flex;flex-direction:column;gap:.35rem;padding:.5rem .9rem 0;flex-shrink:0;max-height:10rem;overflow-y:auto}
      .mvmai-queue[hidden]{display:none}
      .mvmai-queue-head{font-size:.72rem;color:var(--pub-dim,#6c7086)}
      .mvmai-queue-item{display:flex;align-items:center;gap:.4rem;background:var(--pub-surface2,#313244);
        border:1px dashed var(--pub-border,#45475a);border-radius:.5rem;padding:.3rem .4rem .3rem .6rem;font-size:.82rem}
      .mvmai-queue-item.urgent{border-style:solid;border-color:var(--pub-accent,#89b4fa)}
      .mvmai-queue-text{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .mvmai-queue-item button{background:none;border:0;color:var(--pub-fg2,#a6adc8);cursor:pointer;
        font-size:.74rem;padding:.15rem .35rem;border-radius:.3rem;white-space:nowrap}
      .mvmai-queue-item button:hover{background:var(--pub-border,#45475a)}
      .mvmai-app-btn{background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border:1px solid var(--pub-border,#45475a);
        border-radius:.5rem;min-width:2.3rem;height:2.3rem;padding:0 .5rem;cursor:pointer;font-size:.95rem;
        display:flex;align-items:center;gap:.3rem;max-width:11rem;flex-shrink:0}
      .mvmai-app-btn.chosen{border-color:var(--pub-accent,#89b4fa)}
      .mvmai-app-btn .mvmai-app-name{font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .mvmai-app-pop{position:absolute;left:.9rem;bottom:calc(100% - .3rem);z-index:6;width:15rem;max-height:18rem;overflow-y:auto;
        background:var(--pub-surface1,#181825);border:1px solid var(--pub-border,#45475a);border-radius:.6rem;
        box-shadow:0 8px 24px rgba(0,0,0,.35);padding:.35rem}
      .mvmai-app-pop[hidden]{display:none}
      .mvmai-app-pop .mvmai-app-hint{font-size:.74rem;color:var(--pub-dim,#6c7086);padding:.3rem .45rem .45rem;line-height:1.4}
      .mvmai-app-item{display:flex;align-items:center;gap:.5rem;width:100%;background:none;border:0;color:var(--pub-fg,#cdd6f4);
        padding:.45rem .5rem;border-radius:.4rem;cursor:pointer;font-size:.84rem;text-align:left}
      .mvmai-app-item:hover,.mvmai-app-item.active{background:var(--pub-surface2,#313244)}
      .mvmai-review{max-width:min(28rem,92%)}
      .mvmai-review .mvmai-review-sum{color:var(--pub-fg2,#a6adc8);margin-bottom:.5rem;line-height:1.4}
      .mvmai-review label{display:block;font-size:.74rem;color:var(--pub-dim,#6c7086);margin:.45rem 0 .2rem}
      .mvmai-review input,.mvmai-review select,.mvmai-review textarea{width:100%;box-sizing:border-box;
        background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border:1px solid var(--pub-border,#45475a);
        border-radius:.4rem;padding:.35rem .5rem;font:inherit;font-size:.82rem}
      .mvmai-review input[type=checkbox]{width:auto}
      .mvmai-review textarea{min-height:3.5rem;font-family:monospace;font-size:.76rem}
      .mvmai-review .mvmai-review-state{margin-top:.5rem;font-weight:600}
      .mvmai-batch-nav{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.4rem}
      .mvmai-batch-nav button{background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border:1px solid var(--pub-border,#45475a);
        border-radius:.4rem;width:2rem;height:1.8rem;font-size:1rem;cursor:pointer}
      .mvmai-batch-nav button:disabled{opacity:.35;cursor:default}
      .mvmai-batch-pos{font-weight:600;font-size:.82rem}
      .mvmai-batch-page[hidden]{display:none}
      .mvmai-review label.mvmai-batch-include{display:flex;align-items:center;gap:.4rem;font-size:.8rem;
        color:var(--pub-fg,#cdd6f4);margin-top:.6rem;cursor:pointer}
      .mvmai-confirm-yes:disabled{opacity:.5;cursor:default}
      .mvmai-typing{align-self:flex-start;color:var(--pub-dim,#6c7086);font-size:.82rem;
        display:flex;align-items:center;gap:.6rem;height:20px}
      .mvmai-typing canvas{width:100px;height:18px;display:block}
      .mvmai-typing time{font-variant-numeric:tabular-nums;font-size:.75rem;min-width:3.2em}
      .mvmai-hist-btn{background:none;border:0;color:inherit;font-size:1.15rem;cursor:pointer;padding:.15rem .35rem;
        border-radius:.4rem;line-height:1}
      .mvmai-hist-btn:hover{background:var(--pub-surface2,#313244)}
      .mvmai-sidebar-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.4);z-index:4;
        opacity:0;pointer-events:none;transition:opacity .18s ease}
      .mvmai-sidebar-backdrop.open{opacity:1;pointer-events:auto}
      .mvmai-sidebar{position:absolute;top:0;left:0;bottom:0;width:80%;max-width:280px;
        background:var(--pub-surface1,#181825);border-right:1px solid var(--pub-border,#45475a);
        transform:translateX(-100%);transition:transform .18s ease;z-index:5;display:flex;flex-direction:column;
        overflow:hidden}
      .mvmai-sidebar.open{transform:translateX(0)}
      .mvmai-sidebar-head{padding:.7rem;border-bottom:1px solid var(--pub-border,#45475a);flex-shrink:0;
        display:flex;align-items:center;gap:.5rem}
      .mvmai-new-chat{flex:1;min-width:0;padding:.5rem;border:1px solid var(--pub-border,#45475a);border-radius:.5rem;
        background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);cursor:pointer;font-size:.84rem;
        font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .mvmai-sidebar-list{flex:1;min-height:0;overflow-y:auto;padding:.4rem}
      .mvmai-archive-nav{padding:.35rem .55rem;border-top:1px solid var(--pub-border,#45475a);flex-shrink:0}
      .mvmai-archive-link,.mvmai-archive-delete-all{background:none;border:0;color:var(--pub-fg2,#a6adc8);
        cursor:pointer;font:inherit;font-size:.78rem;padding:.2rem .1rem;text-align:left}
      .mvmai-archive-link:hover,.mvmai-archive-delete-all:hover{text-decoration:underline}
      .mvmai-archive-delete-all{color:var(--pub-red,#f38ba8);margin-left:.4rem}
      .mvmai-archive-list{max-height:38%;overflow-y:auto;padding:.2rem .4rem .5rem;flex-shrink:0}
      .mvmai-archive-list[hidden]{display:none}
      .mvmai-filetree-nav{padding:.35rem .55rem;border-top:1px solid var(--pub-border,#45475a);flex-shrink:0}
      .mvmai-filetree-nav[hidden]{display:none}
      .mvmai-filetree-link{background:none;border:0;color:var(--pub-fg2,#a6adc8);cursor:pointer;
        font:inherit;font-size:.78rem;padding:.2rem .1rem;text-align:left}
      .mvmai-filetree-link:hover{text-decoration:underline}
      .mvmai-archive-notice{padding:.7rem .9rem;border-top:1px solid var(--pub-border,#45475a);
        color:var(--pub-fg2,#a6adc8);font-size:.82rem}
      .mvmai-archive-notice[hidden]{display:none}
      .mvmai-archive-restore{margin-left:.5rem;border:1px solid var(--pub-border,#45475a);border-radius:.4rem;
        background:var(--pub-surface2,#313244);color:inherit;padding:.25rem .5rem;cursor:pointer}
      .mvmai-session-row{display:flex;align-items:center;gap:.2rem;padding:.5rem .55rem;border-radius:.4rem;
        cursor:pointer;font-size:.82rem}
      .mvmai-session-row:hover,.mvmai-session-row.active{background:var(--pub-surface2,#313244)}
      .mvmai-session-row.pinned{box-shadow:inset 3px 0 var(--pub-accent,#89b4fa)}
      .mvmai-session-row.mvmai-session-main{position:relative;overflow:hidden;--mvmai-actions-width:6.6rem}
      .mvmai-session-row.mvmai-session-main.pinned{--mvmai-actions-width:4.4rem}
      .mvmai-session-activity{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;
        opacity:.25;color:var(--pub-accent,#89b4fa)}
      .mvmai-session-text{flex:1;min-width:0;position:relative;z-index:1}
      .mvmai-session-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mvmai-session-row.active .mvmai-session-title{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere}
      .mvmai-session-label{display:block;margin-top:.1rem;font-size:.68rem;color:var(--pub-fg2,#a6adc8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mvmai-session-edit{flex:1;min-width:0;padding:.28rem .4rem;border:1px solid var(--pub-accent,#89b4fa);
        border-radius:.3rem;background:var(--pub-bg,#1e1e2e);color:inherit;font:inherit;outline:none}
      .mvmai-session-row .mvmai-s-btn{opacity:.55;background:none;border:0;color:inherit;cursor:pointer;
        font-size:.82rem;padding:.15rem .3rem;flex-shrink:0}
      .mvmai-session-row .mvmai-s-btn:hover{opacity:1}
      .mvmai-session-actions{display:none}
      .mvmai-session-menu{position:absolute;z-index:50;min-width:10rem;max-width:calc(100% - .5rem);
        padding:.25rem;border:1px solid var(--pub-border,#45475a);border-radius:.5rem;
        background:var(--pub-surface1,#181825);box-shadow:0 .4rem 1.3rem rgba(0,0,0,.25)}
      .mvmai-session-menu[hidden]{display:none}
      .mvmai-session-menu button{display:block;width:100%;padding:.45rem .6rem;border:0;border-radius:.3rem;
        background:none;color:var(--pub-fg,#cdd6f4);font:inherit;font-size:.8rem;text-align:left;cursor:pointer}
      .mvmai-session-menu button:hover,.mvmai-session-menu button:focus-visible{background:var(--pub-surface2,#313244)}
      .mvmai-session-menu button:disabled{opacity:.5;cursor:default}
      .mvmai-no-sessions{color:var(--pub-dim,#6c7086);font-size:.78rem;padding:.7rem .5rem;text-align:center}
      .mvmai-exec-wrap{flex:1;min-width:0}
      .mvmai-exec-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:.35rem;white-space:nowrap;
        overflow:hidden;text-overflow:ellipsis;
        padding:.4rem .5rem;border:1px solid var(--pub-border,#45475a);border-radius:.5rem;
        background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);cursor:pointer;font-size:.78rem}
      .mvmai-exec-btn.on{border-color:var(--pub-accent,#89b4fa);color:var(--pub-accent,#89b4fa)}
      .mvmai-exec-btn.auto{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);border-color:var(--pub-accent,#89b4fa)}
      .mvmai-exec-menu{position:absolute;top:3rem;left:.6rem;width:240px;max-width:calc(100% - 1.2rem);z-index:40;
        background:var(--pub-surface1,#181825);border:1px solid var(--pub-border,#45475a);border-radius:.5rem;
        padding:.6rem;display:flex;flex-direction:column;gap:.5rem;font-size:.78rem}
      .mvmai-exec-menu[hidden]{display:none}
      .mvmai-exec-row{display:flex;align-items:flex-start;gap:.4rem;cursor:pointer;line-height:1.35;overflow-wrap:anywhere}
      .mvmai-exec-row input{margin-top:.15rem;flex-shrink:0;cursor:pointer}
      .mvmai-exec-mode-wrap{display:flex;flex-direction:column;gap:.4rem;padding-top:.4rem;
        border-top:1px solid var(--pub-border,#45475a)}
      .mvmai-exec-mode-wrap[hidden]{display:none}
      .mvmai-exec-mode-label{font-size:.72rem;color:var(--pub-dim,#6c7086)}
      .mvmai-projects-section{border-top:1px solid var(--pub-border,#45475a);padding-top:.4rem;margin-top:.4rem}
      .mvmai-projects-head{display:flex;align-items:center;justify-content:space-between;padding:.3rem .5rem;
        font-size:.68rem;font-weight:700;color:var(--pub-dim,#6c7086);text-transform:uppercase;letter-spacing:.05em}
      .mvmai-project-new-btn{background:none;border:0;color:inherit;font-size:1rem;cursor:pointer;padding:0 .3rem}
      .mvmai-project-row{display:flex;align-items:center;gap:.3rem;padding:.5rem .55rem;border-radius:.4rem;
        cursor:pointer;font-size:.82rem}
      .mvmai-project-row:hover,.mvmai-project-row.active{background:var(--pub-surface2,#313244)}
      .mvmai-project-row-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mvmai-project-row .mvmai-s-btn{opacity:.55;background:none;border:0;color:inherit;cursor:pointer;
        font-size:.82rem;padding:.15rem .3rem;flex-shrink:0}
      .mvmai-project-row .mvmai-s-btn:hover{opacity:1}
      .mvmai-project-badge{margin-left:auto;font-size:.68rem;color:var(--pub-dim,#6c7086);white-space:nowrap;
        overflow:hidden;text-overflow:ellipsis;max-width:40%}
      .mvmai-sidebar-project-header{display:flex;flex-direction:column;gap:.3rem;padding:.5rem .5rem .4rem;
        border-bottom:1px solid var(--pub-border,#45475a);flex-shrink:0}
      .mvmai-sidebar-project-header[hidden]{display:none}
      .mvmai-sidebar-back{align-self:flex-start;background:none;border:0;color:var(--pub-accent,#89b4fa);
        cursor:pointer;font-size:.78rem;padding:.15rem .2rem}
      .mvmai-sidebar-project-title{font-size:.85rem;font-weight:700;padding:0 .2rem;overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap}
      .mvmai-sidebar-filetree{flex-shrink:0;max-height:38%;overflow-y:auto;border-top:1px solid var(--pub-border,#45475a);
        padding:.4rem}
      .mvmai-sidebar-filetree[hidden]{display:none}
      .mvmai-sidebar-filetree.collapsed .mvmai-sidebar-filetree-body,
      .mvmai-sidebar-filetree.collapsed .mvmai-sidebar-filetree-hint{display:none}
      .mvmai-sidebar-filetree:empty{display:none;border-top:none;padding:0}
      .mvmai-sidebar-filetree-branch{font-size:.7rem;color:var(--pub-dim,#6c7086);padding:.1rem .4rem .3rem;
        display:block;text-decoration:none}
      a.mvmai-sidebar-filetree-branch-link{color:var(--pub-accent,#89b4fa);cursor:pointer}
      a.mvmai-sidebar-filetree-branch-link:hover{text-decoration:underline}
      .mvmai-sidebar-filetree-hint{font-size:.66rem;color:var(--pub-dim,#6c7086);opacity:.75;
        padding:0 .4rem .3rem;font-style:italic}
      .mvmai-ft-dir,.mvmai-ft-file{display:flex;align-items:center;gap:.3rem;padding:.3rem .4rem;border-radius:.35rem;
        font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .mvmai-ft-dir{cursor:pointer}
      .mvmai-ft-dir:hover{background:var(--pub-surface2,#313244)}
      .mvmai-ft-name{flex:1;overflow:hidden;text-overflow:ellipsis}
      .mvmai-ft-children{padding-left:.7rem}
      .mvmai-ft-badge{font-size:.62rem;font-weight:700;padding:0 .3rem;border-radius:.3rem;flex-shrink:0}
      .mvmai-ft-badge.mvmai-ft-M{background:color-mix(in srgb,var(--pub-yellow,#e0a000) 20%,transparent);color:var(--pub-yellow,#e0a000)}
      .mvmai-ft-badge.mvmai-ft-A{background:color-mix(in srgb,var(--pub-green,#4cae5a) 20%,transparent);color:var(--pub-green,#4cae5a)}
      .mvmai-ft-badge.mvmai-ft-D{background:color-mix(in srgb,var(--pub-red,#e25555) 20%,transparent);color:var(--pub-red,#e25555)}
      .mvmai-ft-badge.mvmai-ft-U{background:rgba(127,127,127,.2);color:var(--pub-dim,#6c7086)}
      .mvmai-ft-badge.mvmai-ft-dir-badge{background:color-mix(in srgb,var(--pub-yellow,#e0a000) 25%,transparent);color:var(--pub-yellow,#e0a000);border-radius:1rem;
        min-width:1.1em;text-align:center}
      .mvmai-browse-row{padding:.5rem .55rem;cursor:pointer;font-size:.82rem;border-radius:.4rem}
      .mvmai-browse-row:hover{background:var(--pub-surface2,#313244)}
      .mvmai-pub-dialog-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:20;display:flex;
        align-items:center;justify-content:center}
      .mvmai-pub-dialog{background:var(--pub-surface1,#181825);border:1px solid var(--pub-border,#45475a);
        border-radius:.6rem;padding:1rem;width:88%;max-width:340px;max-height:75%;display:flex;flex-direction:column;
        gap:.6rem;overflow:hidden}
      .mvmai-pub-dialog-title{font-weight:700;font-size:.92rem}
      .mvmai-pub-dialog input,.mvmai-pub-dialog textarea{width:100%;box-sizing:border-box;background:var(--pub-surface2,#313244);
        color:var(--pub-fg,#cdd6f4);border:1px solid var(--pub-border,#45475a);border-radius:.4rem;
        padding:.4rem .55rem;font:inherit;font-size:.84rem}
      .mvmai-model-fields{display:flex;flex-direction:column;gap:.55rem}
      .mvmai-model-fields label{display:flex;flex-direction:column;gap:.25rem;font-size:.78rem}
      .mvmai-model-fields select{width:100%;box-sizing:border-box;background:var(--pub-surface2,#313244);
        color:var(--pub-fg,#cdd6f4);border:1px solid var(--pub-border,#45475a);border-radius:.4rem;
        padding:.4rem .55rem;font:inherit;font-size:.84rem}
      .mvmai-model-dialog .mvmai-pub-dialog{width:min(90vw,390px);max-width:none;padding:1.25rem;
        gap:1rem;border-radius:.9rem;box-shadow:0 20px 60px rgba(0,0,0,.3)}
      .mvmai-model-dialog .mvmai-pub-dialog-title{font-size:1.05rem;line-height:1.35}
      .mvmai-model-loading{display:flex;align-items:center;justify-content:center;gap:.7rem;
        min-height:5.5rem;color:var(--pub-fg2,#a6adc8);font-size:.82rem}
      .mvmai-model-loading[hidden]{display:none}
      .mvmai-model-spinner{width:1.2rem;height:1.2rem;border:2px solid var(--pub-border,#45475a);
        border-top-color:var(--pub-accent,#89b4fa);border-radius:50%;animation:mvmai-model-spin .7s linear infinite}
      @keyframes mvmai-model-spin{to{transform:rotate(360deg)}}
      .mvmai-model-dialog .mvmai-model-fields{gap:.85rem}
      .mvmai-model-dialog .mvmai-model-fields[hidden],.mvmai-model-dialog .mvmai-pub-dialog-actions[hidden]{display:none}
      .mvmai-model-dialog .mvmai-model-fields label{gap:.4rem;font-size:.8rem;font-weight:600}
      .mvmai-model-dialog .mvmai-model-fields select{min-height:2.75rem;border-radius:.55rem;padding:.55rem .7rem}
      .mvmai-model-dialog .mvmai-pub-dialog-actions{display:block}
      .mvmai-model-dialog .mvmai-model-confirm{width:100%;min-height:2.8rem;border:0;border-radius:.6rem;
        background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);font-size:.9rem;font-weight:700;
        cursor:pointer;transition:filter .15s,transform .15s}
      .mvmai-model-dialog .mvmai-model-confirm:hover:not(:disabled){filter:brightness(1.1);transform:translateY(-1px)}
      .mvmai-model-dialog .mvmai-model-confirm:focus-visible{outline:2px solid var(--pub-fg,#cdd6f4);outline-offset:3px}
      .mvmai-model-dialog .mvmai-model-confirm:disabled{opacity:.55;cursor:default}
      .mvmai-pub-dialog textarea{resize:vertical}
      .mvmai-pub-dialog-list{flex:1;overflow-y:auto;min-height:120px;border:1px solid var(--pub-border,#45475a);
        border-radius:.4rem}
      .mvmai-pub-dialog-path{font-size:.72rem;color:var(--pub-dim,#6c7086);font-family:monospace;overflow-wrap:anywhere}
      .mvmai-pub-dialog-hint{font-size:.72rem;color:var(--pub-dim,#6c7086)}
      .mvmai-pub-dialog-err{color:var(--pub-red,#f38ba8);font-size:.78rem}
      .mvmai-pub-dialog-actions{display:flex;gap:.5rem;justify-content:flex-end}
      @media (max-width:640px){
        .mvmai-session-row.mvmai-session-main{touch-action:pan-y}
        .mvmai-session-main .mvmai-session-text{transition:margin-right .18s ease}
        .mvmai-session-main.revealed .mvmai-session-text{margin-right:var(--mvmai-actions-width)}
        .mvmai-session-main .mvmai-session-actions{position:absolute;top:0;right:0;bottom:0;
          display:flex;width:var(--mvmai-actions-width);background:var(--pub-surface2,#313244);
          transform:translateX(100%);transition:transform .18s ease}
        .mvmai-session-main.revealed .mvmai-session-actions{transform:translateX(0)}
        .mvmai-session-main .mvmai-session-actions .mvmai-s-btn{flex:1;opacity:1;padding:0;
          border-left:1px solid var(--pub-border,#45475a);font-size:1rem}
        .mvmai-usage-list{flex-basis:10rem}
        .mvmai-usage-list.switchable{cursor:pointer;touch-action:manipulation}
        .mvmai-usage-list.switchable .mvmai-usage-bar{display:none}
        .mvmai-usage-list.switchable .mvmai-usage-bar.current{display:flex}
        .mvmai-usage-list.switchable .mvmai-usage-next{display:inline;position:relative;z-index:1;
          color:#111;font-size:1rem;line-height:1;flex-shrink:0}
        .mvmai-widget:not(.mvmai-desktop) .mvmai-inputbar{flex-wrap:wrap;gap:.5rem;padding:.65rem .75rem}
        .mvmai-widget:not(.mvmai-desktop) .mvmai-input{order:-1;flex:0 0 100%;min-width:0;min-height:5rem;
          max-height:35dvh;font-size:1rem}
        .mvmai-widget:not(.mvmai-desktop) .mvmai-app-btn,
        .mvmai-widget:not(.mvmai-desktop) .mvmai-attach,
        .mvmai-widget:not(.mvmai-desktop) .mvmai-stop,
        .mvmai-widget:not(.mvmai-desktop) .mvmai-send{min-height:2.75rem}
        .mvmai-widget:not(.mvmai-desktop) .mvmai-send{margin-left:auto}
      }
    `;
    document.head.appendChild(style);
  }

  function mount(root, opts) {
    opts = opts || {};
    injectStyles();
    var token = localStorage.getItem('apphub_token');
    if (!token) {
      root.innerHTML = '<div class="mvmai-login">' + esc(t('mvmai_pub_login_required')) + '</div>';
      if (opts.onNeedLogin) opts.onNeedLogin(root);
      return { destroy: function () {} };
    }

    var isDesktop = !!opts.isDesktopApp;
    var me = null;
    var publicPrefs = {};
    var history = [];       // {role, content, tool_calls?, tool_call_id?}
    var sending = false;
    var sessionId = null;
    // The provider and model the open chat is pinned to (shown to the administrator).
    var chatLabel = null;
    var chatProvider = null;
    var chatModel = null;
    var newProjectModel = null; // Confirmed choice for the next new chat.
    var projects = [];
    var activeProject = null;   // {id, name, path} — fixed at session creation
    var sessionsCache = [];
    var projectPoll = null;
    var providerPoll = null;
    var usagePoll = null;
    var titleRefreshTimer = null;
    var termPanel = null;    // the Premium terminal panel, once made
    var termLoading = null;
    var sessionMenuCleanup = null;

    function api(path, options) {
      options = options || {};
      var headers = Object.assign(
        {'X-Pub-Token': token, 'Content-Type': 'application/json'},
        options.headers || {}
      );
      if (isDesktop) headers['X-MvmAI-Surface'] = 'desktop';
      return fetch(API + path, Object.assign({}, options, {headers: headers})).then(async function (response) {
        var data = await response.json().catch(function () { return {__invalidResponse: true}; });
        if (response.status === 401 && opts.onNeedLogin) opts.onNeedLogin(root);
        data.__status = response.status;
        return data;
      });
    }

    root.innerHTML = '<div class="mvmai-error">' + esc(t('mvmai_pub_thinking')) + '</div>';

    api('/me').then(function (data) {
      if (data.__status !== 200) {
        root.innerHTML = '<div class="mvmai-error">' + esc(t('mvmai_pub_unauthorized')) + '</div>';
        return;
      }
      me = data;
      if (isDesktop) { renderShell(); return; }
      fetch('/api/pub/apphub/me', {headers: {'X-Pub-Token': token}})
        .then(function (response) { return response.ok ? response.json() : {}; })
        .then(function (prefs) { publicPrefs = prefs; })
        .catch(function () {})
        .then(renderShell);
    });

    function formatMessageTime(seconds) {
      if (!seconds) return '';
      var date = new Date(Number(seconds) * 1000);
      if (isNaN(date.getTime())) return '';
      var prefs = isDesktop ? (window._vosSettings || {}) : publicPrefs;
      var options = {year: 'numeric', month: '2-digit', day: '2-digit'};
      if (isDesktop && prefs.timezone) options.timeZone = prefs.timezone;
      var parts;
      try { parts = new Intl.DateTimeFormat(uiLang() || undefined, options).formatToParts(date); }
      catch (_) { delete options.timeZone; parts = new Intl.DateTimeFormat(uiLang() || undefined, options).formatToParts(date); }
      var values = {};
      parts.forEach(function (part) { values[part.type] = part.value; });
      var format = prefs.date_format || 'DD/MM/YYYY';
      var dateText = format === 'YYYY-MM-DD' ? values.year + '-' + values.month + '-' + values.day
        : format === 'MM/DD/YYYY' ? values.month + '/' + values.day + '/' + values.year
        : values.day + '/' + values.month + '/' + values.year;
      var timeOptions = {hour: '2-digit', minute: '2-digit', hour12: prefs.time_format === '12'};
      if (options.timeZone) timeOptions.timeZone = options.timeZone;
      return dateText + ' ' + date.toLocaleTimeString(uiLang() || undefined, timeOptions);
    }

    function refreshMessageTimes() {
      root.querySelectorAll('.mvmai-msg-time').forEach(function (el) {
        el.textContent = formatMessageTime(Date.parse(el.dateTime) / 1000);
      });
    }
    if (isDesktop) window.addEventListener('settings-changed', refreshMessageTimes);

    // The app picker exists where the data bridge does; on the desktop of an
    // install without Premium it is still shown, locked, and opens the
    // Premium dialog. The public page never shows it without the bridge.
    function showAppPicker() {
      return !!(me.has_api_bridge || (isDesktop && !me.bridge_premium && window.mvmOS && window.mvmOS.premiumGate));
    }

    // An open chat keeps the provider it started with; a new one takes the
    // one chosen in the settings.
    function currentLabel() {
      return me && me.is_admin ? (chatLabel || (newProjectModel && newProjectModel.label) || me.provider_label || null) : null;
    }

    function messagePlaceholder() {
      return t('mvmai_pub_placeholder');
    }

    // The terminal panel of the desktop (Premium). With the setting on it is
    // a button; on an install without Premium it is still shown, locked, and
    // opens the Premium dialog. The public page never has it.
    function terminalButtonShown() {
      return !!(isDesktop && me.is_admin && (me.terminal || (!me.bridge_premium && window.mvmOS && window.mvmOS.premiumGate)));
    }

    function renderShell() {
      var priceHint = '';
      if (me.credit_price) {
        priceHint = '<div class="mvmai-price">' + esc(t('mvmai_pub_price_hint', {
          price: me.credit_price, balance: me.credit_balance
        })) + '</div>';
      }
      root.innerHTML = `<div class="mvmai-widget${isDesktop ? ' mvmai-desktop' : ''}">
        <div class="mvmai-sidebar-backdrop"></div>
        <div class="mvmai-sidebar">
          <div class="mvmai-sidebar-head">
            <button class="mvmai-new-chat">+ ${esc(t('mvmai_pub_new_chat'))}</button>
            ${me.is_admin ? `<div class="mvmai-exec-wrap">
              <button class="mvmai-exec-btn" type="button"><span>⚡</span><span class="mvmai-exec-state"></span></button>
              <div class="mvmai-exec-menu" hidden>
                <div class="mvmai-exec-mode-label">${esc(t('mvmai_pub_exec_mode_label'))}</div>
                <label class="mvmai-exec-row"><input type="radio" name="mvmai-pub-exec-mode" value="readonly"> ${esc(t('mvmai_pub_exec_off'))}</label>
                <label class="mvmai-exec-row"><input type="radio" name="mvmai-pub-exec-mode" value="confirm"> ${esc(t('mvmai_pub_exec_mode_confirm'))}</label>
                <label class="mvmai-exec-row"><input type="radio" name="mvmai-pub-exec-mode" value="auto"> ${esc(t('mvmai_pub_exec_mode_auto'))}</label>
              </div>
            </div>` : ''}
          </div>
          <div class="mvmai-sidebar-project-header" hidden>
            <button class="mvmai-sidebar-back" type="button">← ${esc(t('mvmai_pub_all_chats'))}</button>
            <span class="mvmai-sidebar-project-title"></span>
          </div>
          <div class="mvmai-sidebar-list"></div>
          <div class="mvmai-archive-nav">
            <button class="mvmai-archive-link" type="button" aria-expanded="false"></button>
            <button class="mvmai-archive-delete-all" type="button" hidden>${esc(t('mvmai_pub_delete_all_archived'))}</button>
          </div>
          <div class="mvmai-archive-list" hidden></div>
          <div class="mvmai-filetree-nav" hidden><button class="mvmai-filetree-link" type="button" aria-expanded="false"></button></div>
          <div class="mvmai-sidebar-filetree" hidden></div>
          ${me.is_admin ? `<div class="mvmai-projects-section">
            <div class="mvmai-projects-head">
              <span>${esc(t('mvmai_pub_projects_title'))}</span>
              <button class="mvmai-project-new-btn" type="button" title="${esc(t('mvmai_pub_new_project'))}">+</button>
            </div>
            <div class="mvmai-projects-list"></div>
          </div>` : ''}
        </div>
        <div class="mvmai-chat-col">
          <div class="mvmai-header">
            <button class="mvmai-hist-btn" title="${esc(t('mvmai_pub_history'))}">🕘</button>
            <span class="mvmai-header-title">🤖 ${esc(t('mvmai_pub_title'))}</span>
            ${me.is_admin ? '<span class="mvmai-badge">' + esc(t('mvmai_pub_admin_badge')) + '</span>' : ''}
            <span class="mvmai-project-badge" hidden></span>
            <button class="mvmai-gal-btn" type="button" title="${esc(t('mvmai_gal_title'))}">🖼</button>
            ${terminalButtonShown() ? '<button class="mvmai-term-btn" type="button" title="' + esc(t('mvmai_pub_term_title')) + '">🖥</button>' : ''}
            ${priceHint}
          </div>
          <div class="mvmai-list"></div>
          <div class="mvmai-queue" hidden></div>
          <div class="mvmai-chips" hidden></div>
          ${me.is_admin ? '<div class="mvmai-composer-model" hidden></div>' : ''}
          <div class="mvmai-archive-notice" hidden>${esc(t('mvmai_pub_archived_readonly'))}<button class="mvmai-archive-restore" type="button">${esc(t('mvmai_pub_restore'))}</button></div>
          <div class="mvmai-inputbar">
            ${showAppPicker() ? '<button class="mvmai-app-btn" type="button" title="' + esc(t('mvmai_pub_app_pick')) + '"><span class="mvmai-app-icon">🧩</span><span class="mvmai-app-name" hidden></span></button><div class="mvmai-app-pop" hidden></div>' : ''}
            <button class="mvmai-attach" type="button" title="${esc(t('mvmai_pub_attach'))}">📎</button>
            <input class="mvmai-file" type="file" multiple hidden>
            <textarea class="mvmai-input" rows="1" placeholder="${esc(messagePlaceholder())}"></textarea>
            <button class="mvmai-send">${esc(t('mvmai_pub_send'))}</button>
            <button class="mvmai-stop" type="button" hidden title="${esc(t('mvmai_pub_stop'))}">■</button>
          </div>
        </div>
      </div>`;

      var listEl = root.querySelector('.mvmai-list');
      var inputEl = root.querySelector('.mvmai-input');
      var composerModelEl = root.querySelector('.mvmai-composer-model');
      var sendEl = root.querySelector('.mvmai-send');
      var stopEl = root.querySelector('.mvmai-stop');
      var queueEl = root.querySelector('.mvmai-queue');
      var sidebarEl = root.querySelector('.mvmai-sidebar');
      var backdropEl = root.querySelector('.mvmai-sidebar-backdrop');
      var sidebarListEl = root.querySelector('.mvmai-sidebar-list');
      var archiveLinkEl = root.querySelector('.mvmai-archive-link');
      var archiveListEl = root.querySelector('.mvmai-archive-list');
      var archiveDeleteAllEl = root.querySelector('.mvmai-archive-delete-all');
      var archiveNoticeEl = root.querySelector('.mvmai-archive-notice');
      var archiveRestoreEl = root.querySelector('.mvmai-archive-restore');
      var archiveExpanded = false;
      var archivedSession = false;
      var usageProvider = null;
      var usageModel = null;
      var usageData = null;
      var usageFetchedAt = 0;
      var usageRequest = 0;
      var usageVisibleIndex = 0;
      var usageDisplayKey = null;
      var histBtn = root.querySelector('.mvmai-hist-btn');
      var newChatBtn = root.querySelector('.mvmai-new-chat');
      var appBtn = root.querySelector('.mvmai-app-btn');
      var appPop = root.querySelector('.mvmai-app-pop');
      var appKey = 'mvmai_app_' + (isDesktop ? 'desktop' : 'public');
      var chosenApp = null;
      var bridgeApps = null;

      // In a project with no chat opened, the composer stays hidden until an
      // existing chat is opened or a new one gets its model chosen.
      function projectStartState() { return !!(me.is_admin && activeProject && !sessionId && !newProjectModel); }
      function currentUsageProvider() {
        return chatProvider || (newProjectModel && newProjectModel.provider) || me.provider || null;
      }
      function currentUsageModel() {
        if (chatProvider) return chatModel || '';
        if (newProjectModel) return newProjectModel.model || '';
        return me.model || '';
      }
      function resetCountdown(timestamp) {
        var total = Math.max(0, Math.ceil((Number(timestamp) * 1000 - Date.now()) / 60000));
        var days = Math.floor(total / 1440);
        var hours = Math.floor(total % 1440 / 60);
        var minutes = total % 60;
        var parts = [];
        if (days) parts.push(days + t('mvmai_pub_usage_days'));
        if (hours) parts.push(hours + t('mvmai_pub_usage_hours'));
        parts.push(minutes + t('mvmai_pub_usage_minutes'));
        return parts.join(' ');
      }
      function usageBar(window, label) {
        if (!window || !Number.isFinite(Number(window.used_percent))) return null;
        var percent = Math.round(Number(window.used_percent));
        var bar = document.createElement('span');
        bar.className = 'mvmai-usage-bar';
        var fill = document.createElement('span');
        fill.className = 'mvmai-usage-fill';
        fill.style.clipPath = 'inset(0 ' + (100 - Math.max(0, Math.min(100, percent))) + '% 0 0)';
        var name = document.createElement('span');
        name.className = 'mvmai-usage-window';
        name.textContent = label;
        var value = document.createElement('span');
        value.className = 'mvmai-usage-percent';
        value.textContent = percent + '%';
        var caption = document.createElement('span');
        caption.className = 'mvmai-usage-caption';
        caption.append(name, value);
        bar.append(fill, caption);
        var description = label + ' ' + percent + '%';
        if (window.resets_at) {
          var reset = document.createElement('span');
          reset.className = 'mvmai-usage-reset';
          reset.textContent = '🕒 ' + resetCountdown(window.resets_at);
          bar.appendChild(reset);
          description += ' ' + reset.textContent;
        }
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-label', description);
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        bar.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, percent))));
        bar.title = t('mvmai_pub_usage_used');
        return bar;
      }
      function paintUsage() {
        if (!composerModelEl || composerModelEl.hidden || !usageData || usageData.hide || usageData.unavailable) return;
        var models = usageData.models || [];
        var bars = currentUsageProvider() === 'gemini-cli'
          ? models.map(function (window) {
              return usageBar(window, models.length === 1 ? t('mvmai_pub_usage_day') : window.model_label);
            }).filter(Boolean)
          : [usageBar(usageData.five_hour, t('mvmai_pub_usage_five_hour')),
            usageBar(usageData.week, t('mvmai_pub_usage_week'))].filter(Boolean);
        if (bars.length) {
          var displayKey = [viewVersion, sessionId || 'new', currentUsageProvider(), currentUsageModel()].join(':');
          if (displayKey !== usageDisplayKey) { usageDisplayKey = displayKey; usageVisibleIndex = 0; }
          usageVisibleIndex %= bars.length;
          var list = document.createElement('span');
          list.className = 'mvmai-usage-list';
          if (bars.length > 1) {
            list.classList.add('switchable');
            list.title = t('mvmai_pub_usage_switch');
            bars.forEach(function (bar) {
              var next = document.createElement('span');
              next.className = 'mvmai-usage-next';
              next.setAttribute('aria-hidden', 'true');
              next.textContent = '›';
              bar.appendChild(next);
            });
            function showNext() {
              if (!window.matchMedia('(max-width:640px)').matches) return;
              usageVisibleIndex = (usageVisibleIndex + 1) % bars.length;
              bars.forEach(function (bar, i) { bar.classList.toggle('current', i === usageVisibleIndex); });
              list.setAttribute('aria-label', t('mvmai_pub_usage_switch') + ': ' + bars[usageVisibleIndex].getAttribute('aria-label'));
            }
            list.onclick = showNext;
            list.onkeydown = function (event) {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showNext(); }
            };
            if (window.matchMedia('(max-width:640px)').matches) {
              list.setAttribute('role', 'button');
              list.tabIndex = 0;
              list.setAttribute('aria-label', t('mvmai_pub_usage_switch') + ': ' + bars[usageVisibleIndex].getAttribute('aria-label'));
            }
          }
          bars.forEach(function (bar, i) {
            bar.classList.toggle('current', i === usageVisibleIndex);
            list.appendChild(bar);
          });
          composerModelEl.appendChild(list);
        } else {
          var unavailable = document.createElement('span');
          unavailable.textContent = t('mvmai_pub_usage_unavailable');
          composerModelEl.appendChild(unavailable);
        }
      }
      function updateUsage(force) {
        var provider = currentUsageProvider();
        var model = provider === 'gemini-cli' ? currentUsageModel() : '';
        if (!me.is_admin || archivedSession || !['claude-cli', 'codex-cli', 'gemini-cli'].includes(provider) || projectStartState()) {
          usageProvider = null; usageModel = null; usageData = null; usageRequest++;
          return;
        }
        if (provider !== usageProvider || model !== usageModel) {
          usageProvider = provider; usageModel = model; usageData = null; usageFetchedAt = 0; usageRequest++;
        }
        if (!force && Date.now() - usageFetchedAt < 60000) return;
        usageFetchedAt = Date.now();
        var request = ++usageRequest;
        api('/cli-usage?provider=' + encodeURIComponent(provider) + '&model=' + encodeURIComponent(model) +
          (force ? '&fresh=1' : '')).then(function (data) {
          if (request !== usageRequest || provider !== currentUsageProvider() ||
              model !== (provider === 'gemini-cli' ? currentUsageModel() : '') || !root.isConnected) return;
          usageData = data.__status === 200 ? data : {unavailable: true};
          refreshComposer();
        }).catch(function () {
          if (request !== usageRequest || provider !== currentUsageProvider() ||
              model !== (provider === 'gemini-cli' ? currentUsageModel() : '') || !root.isConnected) return;
          usageData = {unavailable: true};
          refreshComposer();
        });
      }
      function refreshComposer() {
        var bar = root.querySelector('.mvmai-inputbar');
        if (bar) bar.style.display = (projectStartState() || archivedSession) ? 'none' : '';
        archiveNoticeEl.hidden = !archivedSession;
        if (termBtn) termBtn.hidden = archivedSession;
        if (archivedSession && termPanel) termPanel.setChat(null);
        inputEl.placeholder = messagePlaceholder();
        if (composerModelEl) {
          var label = currentLabel();
          composerModelEl.textContent = '';
          if (label) {
            var canChoose = me.is_admin && !archivedSession;
            var labelEl = document.createElement(canChoose ? 'button' : 'span');
            labelEl.className = 'mvmai-composer-label' + (canChoose ? ' mvmai-model-change' : '');
            labelEl.textContent = label;
            if (canChoose) {
              labelEl.type = 'button';
              labelEl.title = t(sessionId ? 'mvmai_pub_model_change_title' : 'mvmai_pub_model_confirm_title');
              labelEl.disabled = sending;
              labelEl.onclick = function () { chooseProjectModel(!!sessionId); };
            }
            composerModelEl.appendChild(labelEl);
          }
          composerModelEl.hidden = !label || archivedSession;
          updateUsage(false);
          paintUsage();
        }
      }
      refreshComposer();
      if (me.is_admin) usagePoll = setInterval(function () {
        if (!root.isConnected) { clearInterval(usagePoll); return; }
        if (!document.hidden) { refreshComposer(); }
      }, 60000);

      function paintAppBtn() {
        if (!appBtn) return;
        appBtn.classList.toggle('chosen', !!chosenApp);
        appBtn.querySelector('.mvmai-app-icon').textContent = chosenApp ? chosenApp.icon : '🧩';
        var nameEl = appBtn.querySelector('.mvmai-app-name');
        nameEl.hidden = !chosenApp;
        nameEl.textContent = chosenApp ? appName(chosenApp) : '';
        appBtn.title = chosenApp ? t('mvmai_pub_app_chosen', {name: appName(chosenApp)}) : t('mvmai_pub_app_pick');
      }

      function chooseApp(app) {
        chosenApp = app;
        try { app ? localStorage.setItem(appKey, app.id) : localStorage.removeItem(appKey); } catch (_) {}
        paintAppBtn();
        appPop.hidden = true;
        inputEl.focus();
      }

      function renderAppPop() {
        appPop.innerHTML = '';
        var hint = document.createElement('div');
        hint.className = 'mvmai-app-hint';
        hint.textContent = bridgeApps && bridgeApps.length ? t('mvmai_pub_app_hint') : t('mvmai_pub_app_none_available');
        appPop.appendChild(hint);
        var items = [{id: '', icon: '💬', name: t('mvmai_pub_app_no_app')}].concat((bridgeApps || []).slice().sort(function (x, y) { return appName(x).localeCompare(appName(y)); }));
        items.forEach(function (app) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'mvmai-app-item' + ((chosenApp ? chosenApp.id : '') === app.id ? ' active' : '');
          b.innerHTML = '<span>' + esc(app.icon) + '</span><span>' + esc(appName(app)) + '</span>';
          b.addEventListener('click', function () { chooseApp(app.id ? app : null); });
          appPop.appendChild(b);
        });
      }

      function loadBridgeApps() {
        return api('/bridge-apps').then(function (data) {
          bridgeApps = data.__status === 200 ? (data.apps || []) : [];
          var saved = null;
          try { saved = localStorage.getItem(appKey); } catch (_) {}
          if (saved && !chosenApp) {
            var found = bridgeApps.filter(function (a) { return a.id === saved; })[0];
            if (found) { chosenApp = found; paintAppBtn(); }
          }
        });
      }

      if (appBtn && !me.has_api_bridge) {
        window.mvmOS.premiumGate(appBtn, t('mvmai_pub_app_premium'));
      } else if (appBtn) {
        loadBridgeApps();
        appBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!appPop.hidden) { appPop.hidden = true; return; }
          (bridgeApps ? Promise.resolve() : loadBridgeApps()).then(function () {
            renderAppPop();
            appPop.hidden = false;
          });
        });
        appPop.addEventListener('click', function (e) { e.stopPropagation(); });
        document.addEventListener('click', function () { if (appPop) appPop.hidden = true; });
      }

      function refreshProviderMetadata() {
        if (!me.is_admin) return Promise.resolve();
        return api('/me').then(function (freshMe) {
          if (freshMe.__status !== 200) return;
          me = freshMe;
          refreshComposer();
        });
      }

      function chooseProjectModel(switching) {
        switching = switching === true;
        if (!me.is_admin || root.querySelector('.mvmai-model-dialog')) return;
        if (archivedSession || sending || (switching ? !sessionId : !!sessionId)) return;
        var dialogTitle = t(switching ? 'mvmai_pub_model_change_title' : 'mvmai_pub_model_confirm_title');
        var backdrop = document.createElement('div');
        backdrop.className = 'mvmai-pub-dialog-backdrop mvmai-model-dialog';
        backdrop.innerHTML = '<div class="mvmai-pub-dialog" role="dialog" aria-modal="true" aria-label="' + esc(dialogTitle) + '">' +
          '<div class="mvmai-pub-dialog-title">' + esc(dialogTitle) + '</div>' +
          '<div class="mvmai-model-loading" role="status"><span class="mvmai-model-spinner"></span><span>' + esc(t('mvmai_pub_model_loading')) + '</span></div>' +
          '<div class="mvmai-model-fields" hidden>' +
          '<label>' + esc(t('mvmai_pub_model_provider')) + '<select class="mvmai-model-provider"></select></label>' +
          '<label>' + esc(t('mvmai_pub_model_model')) + '<select class="mvmai-model-select"></select></label></div>' +
          '<div class="mvmai-pub-dialog-hint mvmai-model-status" hidden></div>' +
          '<div class="mvmai-pub-dialog-actions" hidden>' +
          '<button type="button" class="mvmai-confirm-yes mvmai-model-confirm" disabled>' + esc(t(switching ? 'mvmai_pub_model_change_confirm' : 'mvmai_pub_model_confirm')) + '</button></div></div>';
        root.querySelector('.mvmai-widget').appendChild(backdrop);
        var loadingEl = backdrop.querySelector('.mvmai-model-loading');
        var fieldsEl = backdrop.querySelector('.mvmai-model-fields');
        var actionsEl = backdrop.querySelector('.mvmai-pub-dialog-actions');
        var providerSel = backdrop.querySelector('.mvmai-model-provider');
        var modelSel = backdrop.querySelector('.mvmai-model-select');
        var statusEl = backdrop.querySelector('.mvmai-model-status');
        var confirmBtn = backdrop.querySelector('.mvmai-model-confirm');
        var catalog, requestSeq = 0;
        function setLoading(busy) {
          loadingEl.hidden = !busy;
          fieldsEl.hidden = busy;
          actionsEl.hidden = busy;
          providerSel.disabled = busy;
          modelSel.disabled = busy;
          confirmBtn.disabled = busy;
          if (busy) statusEl.hidden = true;
        }
        function labelFor(provider, model) {
          var option = providerSel.selectedOptions[0];
          var name = option ? option.textContent : provider;
          return name + (model ? ' · ' + model : '');
        }
        function addModel(value) {
          var o = document.createElement('option'); o.value = value; o.textContent = value || t('mvmai_pub_model_default');
          modelSel.appendChild(o);
        }
        function loadModels(current) {
          var seq = ++requestSeq, provider = providerSel.value;
          setLoading(true);
          statusEl.hidden = true;
          modelSel.innerHTML = '';
          addModel('');
          var cli = (catalog.cli_providers || []).filter(function (p) { return p.id === provider; })[0];
          function finish(models, failed) {
            if (seq !== requestSeq || !backdrop.isConnected) return;
            modelSel.innerHTML = '';
            addModel('');
            models.forEach(addModel);
            if (current && !models.includes(current)) addModel(current);
            modelSel.value = current || '';
            setLoading(false);
            statusEl.textContent = failed ? t('mvmai_pub_model_failed') : '';
            statusEl.hidden = !failed;
          }
          if (cli && !cli.models_dynamic) {
            finish(cli.model_choices || [], false);
            return;
          }
          var path = cli ? '/model-options/cli-models' : '/model-options/models';
          api(path, {method: 'POST', body: JSON.stringify({provider: provider})}).then(function (data) {
            finish(data.models || [], data.__status !== 200 || (cli && !(data.models || []).length));
          }).catch(function () {
            finish([], true);
          });
        }
        api('/model-options').then(function (data) {
          if (!backdrop.isConnected) return;
          if (data.__status !== 200) {
            loadingEl.hidden = true;
            statusEl.textContent = t('mvmai_pub_err'); statusEl.hidden = false;
            return;
          }
          catalog = data;
          function group(label, providers) {
            if (!providers.length) return;
            var g = document.createElement('optgroup'); g.label = label;
            providers.forEach(function (p) {
              var o = document.createElement('option'); o.value = p.id; o.textContent = p.name; g.appendChild(o);
            });
            providerSel.appendChild(g);
          }
          group(t('mvmai_pub_model_cli_group'), data.cli_providers || []);
          group(t('mvmai_pub_model_api_group'), data.api_providers || []);
          providerSel.value = switching ? chatProvider : (newProjectModel ? newProjectModel.provider : data.provider);
          if (!providerSel.value && providerSel.options.length) providerSel.selectedIndex = 0;
          providerSel.onchange = function () { loadModels(''); };
          var selectedProvider = switching ? chatProvider : (newProjectModel ? newProjectModel.provider : data.provider);
          var selectedModel = switching ? chatModel : (newProjectModel ? newProjectModel.model : data.model);
          loadModels(providerSel.value === selectedProvider ? selectedModel : '');
          confirmBtn.onclick = function () {
            var provider = providerSel.value;
            var model = modelSel.value;
            if (switching) {
              if (provider === chatProvider && model === (chatModel || '')) {
                backdrop.remove();
                inputEl.focus();
                return;
              }
              var switchContext = saveChatContext();
              var switchId = sessionId;
              confirmBtn.disabled = true;
              api('/sessions/' + encodeURIComponent(switchId) + '/model', {method: 'POST', body: JSON.stringify({
                provider: provider, model: model, messages: switchContext.history
              })}).then(function (result) {
                if (result.__status !== 200) {
                  statusEl.textContent = t(result.error === 'chat_busy' || result.error === 'chat_changed' ? 'mvmai_pub_model_change_busy' : 'mvmai_pub_model_change_failed');
                  statusEl.hidden = false; confirmBtn.disabled = false; return;
                }
                if (result.unchanged) {
                  backdrop.remove();
                  if (switchContext === chatContext) inputEl.focus();
                  return;
                }
                switchContext.history.push(result.marker);
                addModelSwitchNote(result.marker, switchContext);
                switchContext.chatProvider = result.provider;
                switchContext.chatModel = result.model;
                switchContext.chatLabel = result.provider_label;
                backdrop.remove();
                syncChatContext(switchContext);
                refreshSessionList();
                if (switchContext === chatContext) inputEl.focus();
              }).catch(function () {
                statusEl.textContent = t('mvmai_pub_model_change_failed');
                statusEl.hidden = false; confirmBtn.disabled = false;
              });
              return;
            }
            newProjectModel = {provider: provider, model: model, label: labelFor(provider, model)};
            backdrop.remove(); refreshComposer(); showWelcome(); inputEl.focus();
          };
        }).catch(function () {
          if (!backdrop.isConnected) return;
          loadingEl.hidden = true;
          statusEl.textContent = t('mvmai_pub_err'); statusEl.hidden = false;
        });
      }

      // The work is done by the Premium code (premium/public/terminal.js),
      // fetched only when the server says the setting is on.
      var termBtn = root.querySelector('.mvmai-term-btn');
      function loadTerminalCode() {
        if (window.MvmaiPremium && window.MvmaiPremium.createTerminal) return Promise.resolve();
        if (termLoading) return termLoading;
        termLoading = fetch(window.asset(API + '/premium/terminal.js'), {headers: {'X-Pub-Token': token, 'X-MvmAI-Surface': 'desktop'}, cache: 'no-store'}).then(function (r) {
          if (!r.ok) throw new Error(String(r.status));
          return r.text();
        }).then(function (code) {
          var script = document.createElement('script');
          script.textContent = code;
          document.head.appendChild(script);
          script.remove();
        });
        termLoading.catch(function () { termLoading = null; });
        return termLoading;
      }
      function terminalPanel() {
        if (termPanel) return termPanel;
        termPanel = window.MvmaiPremium.createTerminal({
          widgetEl: root.querySelector('.mvmai-widget'),
          colEl: root.querySelector('.mvmai-chat-col'),
          toggleEl: termBtn,
          t: t,
          getProject: function () { return activeProject; },
        });
        return termPanel;
      }
      if (termBtn) {
        if (me.terminal) {
          termBtn.onclick = function () {
            loadTerminalCode().then(function () { terminalPanel().toggle(); }).catch(function () { addNote(t('mvmai_pub_err')); });
          };
          // A chat with a pinned terminal shows it at once.
          loadTerminalCode().then(function () { terminalPanel().setChat(sessionId); }).catch(function () {});
        } else {
          window.mvmOS.premiumGate(termBtn, t('mvmai_pub_term_premium'));
        }
      }

      // ── Gallery ──────────────────────────────────────────────────────────
      // Every file the user sent or the model offered, over all chats: pictures
      // as a grid, anything else as a list to download. Free for everyone; each
      // person sees only their own files.
      var galBtn = root.querySelector('.mvmai-gal-btn');
      function galSize(n) {
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
        return (n / 1048576).toFixed(1) + ' MB';
      }
      function openGallery() {
        var widget = root.querySelector('.mvmai-widget');
        if (widget.querySelector('.mvmai-gal')) return;
        var panel = document.createElement('div');
        panel.className = 'mvmai-gal';
        panel.innerHTML = '<div class="mvmai-gal-head"><b>🖼 ' + esc(t('mvmai_gal_title')) + '</b><div class="mvmai-gal-tabs"></div>' +
          '<button class="mvmai-gal-close" type="button">✕ ' + esc(t('mvmai_gal_close')) + '</button></div><div class="mvmai-gal-body"></div>';
        widget.appendChild(panel);
        var bodyEl = panel.querySelector('.mvmai-gal-body');
        var tabsEl = panel.querySelector('.mvmai-gal-tabs');
        var items = [], filter = 'all', urls = [], othersExpanded = false;
        var galleryProject = activeProject;
        var headers = {'X-Pub-Token': token};
        function close() {
          urls.forEach(function (u) { URL.revokeObjectURL(u); });
          if (observer) observer.disconnect();
          panel.remove();
          document.removeEventListener('keydown', onKey);
        }
        function onKey(e) { if (e.key === 'Escape' && !widget.querySelector('.mvmai-lightbox')) close(); }
        document.addEventListener('keydown', onKey);
        panel.querySelector('.mvmai-gal-close').onclick = close;

        function fileUrl(it, dl) { return API + '/gallery/file?id=' + encodeURIComponent(it.id) + (dl ? '&download=1' : ''); }
        function getBlob(it, dl) {
          return fetch(fileUrl(it, dl), {headers: headers}).then(function (r) {
            if (!r.ok) throw new Error('gone');
            return r.blob();
          });
        }
        function download(it) {
          getBlob(it, true).then(function (blob) {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = it.name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
          }).catch(function () { addNote(t('mvmai_gal_failed')); });
        }
        function remove(it) {
          if (!window.confirm(t(it.kind === 'sent' ? 'mvmai_gal_delete_confirm' : 'mvmai_gal_remove_confirm', {name: it.name}))) return;
          fetch(API + '/gallery/delete', {method: 'POST', headers: {'X-Pub-Token': token, 'Content-Type': 'application/json'},
            body: JSON.stringify({ids: [it.id]})}).then(function (r) {
            if (!r.ok) throw new Error('failed');
            items = items.filter(function (x) { return x.id !== it.id; });
            render();
          }).catch(function () { addNote(t('mvmai_gal_failed')); });
        }
        function chatLink(it) {
          if (!it.chat_id) return null;
          var a = document.createElement('button');
          a.type = 'button';
          a.className = 'mvmai-gal-link';
          a.textContent = it.chat_title || t('mvmai_gal_open_chat');
          a.onclick = function () { close(); openSession(it.chat_id); };
          return a;
        }
        function when(it) { return new Date(it.time * 1000).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'}); }
        var observer = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (!en.isIntersecting) return;
            observer.unobserve(en.target);
            en.target._load();
          });
        }, {root: bodyEl, rootMargin: '200px'}) : null;
        function iconBtn(text, title, fn) {
          var b = document.createElement('button');
          b.type = 'button';
          b.textContent = text;
          b.title = title;
          b.onclick = fn;
          return b;
        }
        function previewCell(it) {
          var td = document.createElement('td');
          td.className = 'c-prev';
          if (!it.image) {
            td.innerHTML = '<div class="mvmai-gal-ico">📄</div>';
            return td;
          }
          var img = document.createElement('img');
          img.alt = it.name;
          td.appendChild(img);
          td._load = function () {
            getBlob(it).then(function (blob) {
              var u = URL.createObjectURL(blob);
              urls.push(u);
              img.src = u;
              img.onclick = function () { openLightbox(u); };
            }).catch(function () {});
          };
          if (observer) observer.observe(td); else td._load();
          return td;
        }
        function cell(cls, text) {
          var td = document.createElement('td');
          td.className = cls;
          if (text !== undefined) td.textContent = text;
          return td;
        }
        function row(it) {
          var tr = document.createElement('tr');
          tr.appendChild(previewCell(it));
          tr.appendChild(cell('c-name', it.name));
          var chat = cell('c-chat');
          var link = chatLink(it);
          if (link) chat.appendChild(link);
          tr.appendChild(chat);
          tr.appendChild(cell('c-num', when(it)));
          tr.appendChild(cell('c-num', galSize(it.size)));
          var act = cell('c-act');
          act.appendChild(iconBtn('⬇', t('mvmai_gal_download'), function () { download(it); }));
          act.appendChild(iconBtn('🗑', t('mvmai_gal_delete'), function () { remove(it); }));
          tr.appendChild(act);
          return tr;
        }
        function render() {
          tabsEl.innerHTML = '';
          [['all', 'mvmai_gal_all'], ['sent', 'mvmai_gal_sent'], ['received', 'mvmai_gal_received']].forEach(function (f) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = t(f[1]);
            b.className = filter === f[0] ? 'on' : '';
            b.onclick = function () { filter = f[0]; render(); };
            tabsEl.appendChild(b);
          });
          if (observer) observer.disconnect();
          bodyEl.innerHTML = '';
          var shown = items.filter(function (it) { return filter === 'all' || it.kind === filter; });
          if (!galleryProject) { appendFiles(bodyEl, shown); return; }
          var current = [], other = [];
          shown.forEach(function (it) {
            var belongs = (it.project_ids || []).indexOf(galleryProject.id) !== -1 || it.project_id === galleryProject.id;
            (belongs ? current : other).push(it);
          });
          var heading = document.createElement('h3');
          heading.textContent = t('mvmai_gal_project_files', {name: galleryProject.name});
          bodyEl.appendChild(heading);
          appendFiles(bodyEl, current);
          if (other.length) {
            var details = document.createElement('details');
            details.className = 'mvmai-gal-other';
            var summary = document.createElement('summary');
            summary.textContent = t('mvmai_gal_other_files') + ' (' + other.length + ')';
            summary.style.cssText = 'cursor:pointer;padding:12px 0;font-weight:600';
            details.appendChild(summary);
            var loaded = false;
            function showOther() {
              if (!loaded) { appendFiles(details, other); loaded = true; }
            }
            details.ontoggle = function () {
              othersExpanded = details.open;
              if (details.open) showOther();
            };
            bodyEl.appendChild(details);
            details.open = othersExpanded;
            if (othersExpanded) showOther();
          }
        }
        function appendFiles(parent, shown) {
          if (!shown.length) {
            var empty = document.createElement('div');
            empty.className = 'mvmai-gal-empty';
            empty.textContent = t('mvmai_gal_empty');
            parent.appendChild(empty);
            return;
          }
          var wrap = document.createElement('div');
          wrap.className = 'mvmai-gal-wrap';
          var table = document.createElement('table');
          table.className = 'mvmai-gal-table';
          table.innerHTML = '<thead><tr><th></th><th>' + esc(t('mvmai_gal_col_name')) + '</th><th>' + esc(t('mvmai_gal_col_chat')) +
            '</th><th>' + esc(t('mvmai_gal_col_date')) + '</th><th>' + esc(t('mvmai_gal_col_size')) + '</th><th></th></tr></thead>';
          var tb = document.createElement('tbody');
          shown.forEach(function (it) { tb.appendChild(row(it)); });
          table.appendChild(tb);
          wrap.appendChild(table);
          parent.appendChild(wrap);
        }
        bodyEl.innerHTML = '<div class="mvmai-gal-empty">…</div>';
        fetch(API + '/gallery', {headers: headers}).then(function (r) {
          if (!r.ok) throw new Error('failed');
          return r.json();
        }).then(function (d) { items = d.items || []; render(); }).catch(function () {
          bodyEl.innerHTML = '';
          var err = document.createElement('div');
          err.className = 'mvmai-gal-empty';
          err.textContent = t('mvmai_gal_failed');
          bodyEl.appendChild(err);
        });
      }
      if (galBtn) galBtn.onclick = openGallery;

      if (isDesktop && me.is_admin) {
        providerPoll = setInterval(function () {
          if (!root.isConnected) { clearInterval(providerPoll); return; }
          refreshProviderMetadata();
        }, 1000);
      }

      if (me.is_admin) {
        var execWrap = root.querySelector('.mvmai-exec-wrap');
        var execBtn = root.querySelector('.mvmai-exec-btn');
        var execMenu = root.querySelector('.mvmai-exec-menu');
        var execState = { enabled: false, auto: false };

        function renderExecBtn() {
          execBtn.classList.toggle('on', execState.enabled && !execState.auto);
          execBtn.classList.toggle('auto', execState.enabled && execState.auto);
          execBtn.querySelector('.mvmai-exec-state').textContent = !execState.enabled
            ? t('mvmai_pub_exec_off') : (execState.auto ? t('mvmai_pub_exec_auto_short') : t('mvmai_pub_exec_confirm'));
          var mode = !execState.enabled ? 'readonly' : (execState.auto ? 'auto' : 'confirm');
          var radio = execMenu.querySelector('input[name="mvmai-pub-exec-mode"][value="' + mode + '"]');
          if (radio) radio.checked = true;
        }

        function saveExecMode(mode) {
          execState.enabled = mode !== 'readonly';
          execState.auto = mode === 'auto';
          renderExecBtn();
          api('/exec-settings', {method: 'POST', body: JSON.stringify({enabled: execState.enabled, auto: execState.auto})});
        }

        api('/exec-settings').then(function (data) {
          if (data.__status !== 200) return;
          execState.enabled = !!data.enabled;
          execState.auto = !!data.auto;
          renderExecBtn();
        });

        // The menu lives in the window itself, not in the sidebar, whose edge would cut it off.
        root.querySelector('.mvmai-widget').appendChild(execMenu);
        execBtn.onclick = function (e) {
          e.stopPropagation();
          execMenu.hidden = !execMenu.hidden;
          if (!execMenu.hidden) {
            var wr = root.querySelector('.mvmai-widget').getBoundingClientRect();
            var br = execBtn.getBoundingClientRect();
            execMenu.style.top = (br.bottom - wr.top + 6) + 'px';
            execMenu.style.left = Math.max(8, Math.min(br.left - wr.left, wr.width - 248)) + 'px';
          }
        };
        document.addEventListener('click', function (e) { if (!execWrap.contains(e.target) && !execMenu.contains(e.target)) execMenu.hidden = true; });
        execMenu.querySelectorAll('input[name="mvmai-pub-exec-mode"]').forEach(function (r) {
          r.addEventListener('change', function (e) { if (e.target.checked) saveExecMode(e.target.value); });
        });
      }

      var projectsListEl = root.querySelector('.mvmai-projects-list');
      var projectBadgeEl = root.querySelector('.mvmai-project-badge');
      var newProjectBtn = root.querySelector('.mvmai-project-new-btn');

      var sidebarProjectHeaderEl = root.querySelector('.mvmai-sidebar-project-header');
      var filetreeNavEl = root.querySelector('.mvmai-filetree-nav');
      var filetreeLinkEl = root.querySelector('.mvmai-filetree-link');
      var sidebarFiletreeEl = root.querySelector('.mvmai-sidebar-filetree');
      var projectsSectionEl = root.querySelector('.mvmai-projects-section');
      var filetreeExpanded = false;
      var filetreeProjectId = null;

      function syncFiletreeVisibility() {
        var projectId = activeProject && activeProject.path ? activeProject.id : null;
        if (projectId !== filetreeProjectId) {
          filetreeProjectId = projectId;
          filetreeExpanded = false;
          lastGitSignature = '';
          sidebarFiletreeEl.innerHTML = '';
        }
        filetreeNavEl.hidden = !projectId;
        sidebarFiletreeEl.hidden = !projectId;
        sidebarFiletreeEl.classList.toggle('collapsed', !filetreeExpanded);
        filetreeLinkEl.textContent = t('mvmai_pub_view_files') + ' ' + (filetreeExpanded ? '▴' : '▾');
        filetreeLinkEl.setAttribute('aria-expanded', String(filetreeExpanded));
      }

      filetreeLinkEl.onclick = function () {
        filetreeExpanded = !filetreeExpanded;
        syncFiletreeVisibility();
        if (filetreeExpanded) renderInlineFileTree(true);
      };

      function updateProjectBadge() {
        if (!projectBadgeEl) return;
        if (!activeProject) { projectBadgeEl.hidden = true; return; }
        projectBadgeEl.hidden = false;
        projectBadgeEl.textContent = '📁 ' + activeProject.name;
      }

      function renderProjects() {
        if (!projectsListEl) return;
        if (!projects.length) {
          projectsListEl.innerHTML = '<div class="mvmai-no-sessions">' + esc(t('mvmai_pub_no_projects')) + '</div>';
          return;
        }
        projectsListEl.innerHTML = '';
        projects.forEach(function (p) {
          var row = document.createElement('div');
          row.className = 'mvmai-project-row';
          row.innerHTML =
            '<span class="mvmai-project-row-title"></span>' +
            '<button class="mvmai-s-btn mvmai-project-edit-btn" title="' + esc(t('mvmai_pub_edit')) + '">✎</button>' +
            '<button class="mvmai-s-btn mvmai-project-del-btn" title="' + esc(t('mvmai_pub_delete')) + '">🗑</button>';
          row.querySelector('.mvmai-project-row-title').textContent = p.name;
          row.onclick = function () { enterProjectView(p); };
          row.querySelector('.mvmai-project-edit-btn').onclick = function (e) {
            e.stopPropagation();
            showEditProjectDialog(p);
          };
          row.querySelector('.mvmai-project-del-btn').onclick = function (e) {
            e.stopPropagation();
            if (!confirm(t('mvmai_pub_project_del_confirm'))) return;
            api('/projects/' + p.id, {method: 'DELETE'}).then(function () {
              if (activeProject && activeProject.id === p.id) exitProjectView();
              loadProjects();
            });
          };
          projectsListEl.appendChild(row);
        });
      }

      function loadProjects() {
        return api('/projects').then(function (data) {
          if (data.__status !== 200) return;
          projects = data.projects || [];
          renderProjects();
        });
      }

      function enterProjectView(p) {
        newChatView();
        activeProject = p;
        api('/projects/' + encodeURIComponent(p.id) + '/open', {method: 'POST'}).then(function (data) {
          if (data.__status === 200) loadProjects();
        });
        sidebarProjectHeaderEl.hidden = false;
        sidebarProjectHeaderEl.querySelector('.mvmai-sidebar-project-title').textContent = '📁 ' + p.name;
        if (projectsSectionEl) projectsSectionEl.hidden = true;
        updateProjectBadge();
        refreshSessionList();
        renderInlineFileTree();
        // Opening a project never continues whatever chat was open before.
        sessionId = null;
        archivedSession = false;
        newProjectModel = null;
        chatLabel = null;
        chatProvider = null;
        chatModel = null;
        history = [];
        if (termPanel) termPanel.setChat(null);
        var modelDialog = root.querySelector('.mvmai-model-dialog');
        if (modelDialog) modelDialog.remove();
        refreshComposer();
        showProjectStart();
      }

      function exitProjectView() {
        newChatView();
        activeProject = null;
        newProjectModel = null;
        var modelDialog = root.querySelector('.mvmai-model-dialog');
        if (modelDialog) modelDialog.remove();
        sidebarProjectHeaderEl.hidden = true;
        if (projectsSectionEl) projectsSectionEl.hidden = false;
        if (sidebarFiletreeEl) sidebarFiletreeEl.innerHTML = '';
        syncFiletreeVisibility();
        updateProjectBadge();
        sessionId = null;
        archivedSession = false;
        newProjectModel = null;
        chatLabel = null;
        chatProvider = null;
        chatModel = null;
        history = [];
        if (termPanel) termPanel.setChat(null);
        refreshComposer();
        showWelcome();
        refreshSessionList();
      }

      sidebarProjectHeaderEl.querySelector('.mvmai-sidebar-back').onclick = exitProjectView;

      function fillDir(dirPath, container, statusMap, rootPath) {
        return fetch('/api/files?path=' + encodeURIComponent(dirPath), {headers: {'X-Pub-Token': token}})
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var entries = (data.entries || data.files || data || []).filter(function (f) { return f.name.indexOf('.') !== 0; });
            entries.sort(function (a, b) {
              if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
            container.innerHTML = '';
            entries.forEach(function (f) {
              var full = dirPath.replace(/\/$/, '') + '/' + f.name;
              var rel = full.slice(rootPath.length + 1);
              var row = document.createElement('div');
              row.className = f.type === 'dir' ? 'mvmai-ft-dir' : 'mvmai-ft-file';
              var badge = '';
              if (f.type === 'dir') {
                var prefix = rel + '/';
                var changeCount = Object.keys(statusMap).filter(function (k) { return k.indexOf(prefix) === 0; }).length;
                if (changeCount) badge = '<span class="mvmai-ft-badge mvmai-ft-dir-badge" title="' + changeCount + '">' + changeCount + '</span>';
              } else if (statusMap[rel]) {
                badge = '<span class="mvmai-ft-badge mvmai-ft-' + statusMap[rel] + '">' + statusMap[rel] + '</span>';
              }
              row.innerHTML = '<span class="mvmai-ft-name">' + (f.type === 'dir' ? '📁' : '📄') + ' ' + esc(f.name) + '</span>' + badge;
              if (f.type === 'dir') {
                row.addEventListener('click', function () {
                  var next = row.nextElementSibling;
                  if (next && next.classList.contains('mvmai-ft-children')) { next.remove(); return; }
                  var sub = document.createElement('div');
                  sub.className = 'mvmai-ft-children';
                  row.after(sub);
                  fillDir(full, sub, statusMap, rootPath);
                });
              } else if (typeof CodeEditor !== 'undefined') {
                // Only present inside the mvmOS desktop shell — the public
                // page never loads codeeditor.js, so this stays read-only there.
                row.style.cursor = 'pointer';
                row.addEventListener('click', function () { CodeEditor.openFile(full); });
              }
              container.appendChild(row);
            });
            if (!entries.length) container.innerHTML = '<div class="mvmai-no-sessions">∅</div>';
          });
      }

      var lastGitSignature = '';
      var filetreeRenderId = 0;
      var gitPending = false;
      projectPoll = setInterval(function () {
        if (!root.isConnected) { clearInterval(projectPoll); return; }
        if (!document.hidden && activeProject && !gitPending) renderInlineFileTree(true);
      }, 5000);

      function renderInlineFileTree(quiet) {
        if (!sidebarFiletreeEl) return;
        syncFiletreeVisibility();
        if (!activeProject || !activeProject.path) return;
        var project = activeProject;
        var renderId = ++filetreeRenderId;
        gitPending = true;
        api('/projects/' + project.id + '/git-status').then(function (git) {
          if (!activeProject || activeProject.id !== project.id || !root.isConnected || renderId !== filetreeRenderId) return;
          var signature = project.id + JSON.stringify(git);
          var existingBody = sidebarFiletreeEl.querySelector('.mvmai-sidebar-filetree-body');
          if (quiet && signature === lastGitSignature && (!filetreeExpanded || (existingBody && existingBody.dataset.loaded))) return;
          var statusMap = {};
          ((git && git.added) || []).forEach(function (f) { statusMap[f] = 'A'; });
          ((git && git.modified) || []).forEach(function (f) { statusMap[f] = 'M'; });
          ((git && git.deleted) || []).forEach(function (f) { statusMap[f] = 'D'; });
          ((git && git.untracked) || []).forEach(function (f) { statusMap[f] = 'U'; });
          var branchLabel = git.error ? t('mvmai_pub_git_error') : git && git.is_repo ? ('⎇ ' + git.branch) : t('mvmai_pub_git_not_repo');
          var hasGitManager = typeof GitManager !== 'undefined';
          var canOpenGitManager = git && git.is_repo && hasGitManager;
          var showInstallHint = git && git.is_repo && !hasGitManager;
          // Keep the visible branch/tree in place until the complete replacement
          // is ready, avoiding intermediate loading and empty-directory layouts.
          var nextTree = document.createElement('div');
          nextTree.innerHTML =
            (canOpenGitManager
              ? '<a href="#" class="mvmai-sidebar-filetree-branch mvmai-sidebar-filetree-branch-link">' + esc(branchLabel) + '</a>'
              : '<div class="mvmai-sidebar-filetree-branch">' + esc(branchLabel) + '</div>') +
            (showInstallHint && filetreeExpanded ? '<div class="mvmai-sidebar-filetree-hint">' + esc(t('mvmai_pub_install_git_manager_hint')) + '</div>' : '') +
            '<div class="mvmai-sidebar-filetree-body"></div>';
          if (canOpenGitManager) {
            var branchLink = nextTree.querySelector('.mvmai-sidebar-filetree-branch-link');
            var repoPath = activeProject.path;
            branchLink.addEventListener('click', function (e) {
              e.preventDefault();
              GitManager.openRepo(repoPath);
            });
          }
          var nextBody = nextTree.querySelector('.mvmai-sidebar-filetree-body');
          var ready = filetreeExpanded ? fillDir(project.path, nextBody, statusMap, project.path).then(function () {
            nextBody.dataset.loaded = 'true';
          }) : Promise.resolve();
          return ready.then(function () {
            if (!activeProject || activeProject.id !== project.id || !root.isConnected || renderId !== filetreeRenderId) return;
            sidebarFiletreeEl.replaceChildren.apply(sidebarFiletreeEl, Array.from(nextTree.childNodes));
            lastGitSignature = signature;
          });
        }).catch(function () {
          if (renderId === filetreeRenderId) lastGitSignature = '';
        }).finally(function () { if (renderId === filetreeRenderId) gitPending = false; });
      }

      function showFolderPicker(startPath, onSelect) {
        var backdrop = document.createElement('div');
        backdrop.className = 'mvmai-pub-dialog-backdrop';
        backdrop.innerHTML =
          '<div class="mvmai-pub-dialog">' +
          '<div class="mvmai-pub-dialog-title">' + esc(t('mvmai_pub_browse_title')) + '</div>' +
          '<div class="mvmai-pub-dialog-path"></div>' +
          '<div class="mvmai-pub-dialog-list"></div>' +
          '<div class="mvmai-pub-dialog-actions">' +
          '<button class="mvmai-confirm-no">' + esc(t('mvmai_pub_cancel')) + '</button>' +
          '<button class="mvmai-confirm-yes">' + esc(t('mvmai_pub_browse_select')) + '</button>' +
          '</div></div>';
        document.body.appendChild(backdrop);
        var pathEl = backdrop.querySelector('.mvmai-pub-dialog-path');
        var listEl2 = backdrop.querySelector('.mvmai-pub-dialog-list');
        var current = startPath || '/';

        function load(path) {
          api('/browse?path=' + encodeURIComponent(path)).then(function (data) {
            if (data.__status !== 200) return;
            current = data.path;
            pathEl.textContent = current;
            listEl2.innerHTML = '';
            if (data.parent) {
              var up = document.createElement('div');
              up.className = 'mvmai-browse-row';
              up.textContent = t('mvmai_pub_browse_up');
              up.onclick = function () { load(data.parent); };
              listEl2.appendChild(up);
            }
            (data.dirs || []).forEach(function (name) {
              var row = document.createElement('div');
              row.className = 'mvmai-browse-row';
              row.textContent = '📁 ' + name;
              row.onclick = function () { load(current.replace(/\/$/, '') + '/' + name); };
              listEl2.appendChild(row);
            });
          });
        }
        load(current);

        backdrop.querySelector('.mvmai-confirm-no').onclick = function () { backdrop.remove(); };
        backdrop.querySelector('.mvmai-confirm-yes').onclick = function () { onSelect(current); backdrop.remove(); };
      }

      // Same browse endpoint, but files are selectable too (used for picking
      // an instructions file such as CLAUDE.md) — folders are only for navigating.
      function showFilePicker(startPath, onSelect) {
        var backdrop = document.createElement('div');
        backdrop.className = 'mvmai-pub-dialog-backdrop';
        backdrop.innerHTML =
          '<div class="mvmai-pub-dialog">' +
          '<div class="mvmai-pub-dialog-title">' + esc(t('mvmai_pub_browse_title')) + '</div>' +
          '<div class="mvmai-pub-dialog-path"></div>' +
          '<div class="mvmai-pub-dialog-list"></div>' +
          '<div class="mvmai-pub-dialog-actions">' +
          '<button class="mvmai-confirm-no">' + esc(t('mvmai_pub_cancel')) + '</button>' +
          '</div></div>';
        document.body.appendChild(backdrop);
        var pathEl = backdrop.querySelector('.mvmai-pub-dialog-path');
        var listEl2 = backdrop.querySelector('.mvmai-pub-dialog-list');
        var current = startPath || '/';

        function load(path) {
          api('/browse?path=' + encodeURIComponent(path)).then(function (data) {
            if (data.__status !== 200) return;
            current = data.path;
            pathEl.textContent = current;
            listEl2.innerHTML = '';
            if (data.parent) {
              var up = document.createElement('div');
              up.className = 'mvmai-browse-row';
              up.textContent = t('mvmai_pub_browse_up');
              up.onclick = function () { load(data.parent); };
              listEl2.appendChild(up);
            }
            (data.dirs || []).forEach(function (name) {
              var row = document.createElement('div');
              row.className = 'mvmai-browse-row';
              row.textContent = '📁 ' + name;
              row.onclick = function () { load(current.replace(/\/$/, '') + '/' + name); };
              listEl2.appendChild(row);
            });
            (data.files || []).forEach(function (name) {
              var row = document.createElement('div');
              row.className = 'mvmai-browse-row';
              row.textContent = '📄 ' + name;
              row.onclick = function () {
                onSelect(current.replace(/\/$/, '') + '/' + name);
                backdrop.remove();
              };
              listEl2.appendChild(row);
            });
          });
        }
        load(current);

        backdrop.querySelector('.mvmai-confirm-no').onclick = function () { backdrop.remove(); };
      }

      function showNewProjectDialog() {
        var backdrop = document.createElement('div');
        backdrop.className = 'mvmai-pub-dialog-backdrop';
        backdrop.innerHTML =
          '<div class="mvmai-pub-dialog">' +
          '<div class="mvmai-pub-dialog-title">' + esc(t('mvmai_pub_new_project')) + '</div>' +
          '<input class="mvmai-proj-name-input" placeholder="' + esc(t('mvmai_pub_project_name_label')) + '">' +
          '<div style="display:flex;gap:.4rem">' +
          '<input class="mvmai-proj-path-input" placeholder="' + esc(t('mvmai_pub_project_path_optional')) + '" readonly style="flex:1">' +
          '<button class="mvmai-confirm-no mvmai-proj-browse-btn" style="flex-shrink:0">' + esc(t('mvmai_pub_project_browse')) + '</button>' +
          '</div>' +
          '<div class="mvmai-pub-dialog-hint">' + esc(t('mvmai_pub_project_path_hint')) + '</div>' +
          '<textarea class="mvmai-proj-instructions-input" rows="4" style="resize:vertical;min-height:90px" placeholder="' + esc(t('mvmai_pub_instructions_label')) + '"></textarea>' +
          '<div style="display:flex;gap:.4rem">' +
          '<input class="mvmai-proj-instr-file-input" placeholder="' + esc(t('mvmai_pub_instructions_file_label')) + '" style="flex:1">' +
          '<button class="mvmai-confirm-no mvmai-proj-file-browse-btn" style="flex-shrink:0">' + esc(t('mvmai_pub_project_browse')) + '</button>' +
          '<button class="mvmai-confirm-no mvmai-proj-file-clear-btn" title="' + esc(t('mvmai_pub_clear')) + '" style="flex-shrink:0">✕</button>' +
          '</div>' +
          '<div class="mvmai-pub-dialog-hint">' + esc(t('mvmai_pub_instructions_hint')) + '</div>' +
          '<div class="mvmai-pub-dialog-err" hidden></div>' +
          '<div class="mvmai-pub-dialog-actions">' +
          '<button class="mvmai-confirm-no mvmai-proj-cancel-btn">' + esc(t('mvmai_pub_cancel')) + '</button>' +
          '<button class="mvmai-confirm-yes mvmai-proj-create-btn">' + esc(t('mvmai_pub_project_create')) + '</button>' +
          '</div></div>';
        document.body.appendChild(backdrop);
        var nameInput = backdrop.querySelector('.mvmai-proj-name-input');
        var pathInput = backdrop.querySelector('.mvmai-proj-path-input');
        var instrInput = backdrop.querySelector('.mvmai-proj-instructions-input');
        var fileInput = backdrop.querySelector('.mvmai-proj-instr-file-input');
        var errEl = backdrop.querySelector('.mvmai-pub-dialog-err');
        backdrop.querySelector('.mvmai-proj-cancel-btn').onclick = function () { backdrop.remove(); };
        backdrop.querySelector('.mvmai-proj-browse-btn').onclick = function () {
          showFolderPicker(pathInput.value || '/', function (chosen) { pathInput.value = chosen; });
        };
        backdrop.querySelector('.mvmai-proj-file-browse-btn').onclick = function () {
          showFilePicker(pathInput.value || '/', function (chosen) { fileInput.value = chosen; });
        };
        backdrop.querySelector('.mvmai-proj-file-clear-btn').onclick = function () { fileInput.value = ''; };
        backdrop.querySelector('.mvmai-proj-create-btn').onclick = function () {
          var name = nameInput.value.trim();
          var path = pathInput.value.trim();
          if (!name) { errEl.hidden = false; errEl.textContent = t('mvmai_pub_project_name_required'); return; }
          this.disabled = true; this.textContent = t('mvmai_pub_project_creating');
          var btn = this;
          api('/projects', {method: 'POST', body: JSON.stringify({name: name, path: path, instructions: instrInput.value, instructions_file: fileInput.value.trim()})}).then(function (data) {
            if (data.__status !== 200) {
              errEl.hidden = false; errEl.textContent = data.error || 'Error';
              btn.disabled = false; btn.textContent = t('mvmai_pub_project_create');
              return;
            }
            backdrop.remove();
            loadProjects();
          });
        };
      }

      function showEditProjectDialog(p) {
        var backdrop = document.createElement('div');
        backdrop.className = 'mvmai-pub-dialog-backdrop';
        backdrop.innerHTML =
          '<div class="mvmai-pub-dialog" style="max-width:400px">' +
          '<div class="mvmai-pub-dialog-title">' + esc(t('mvmai_pub_edit_project')) + '</div>' +
          '<input class="mvmai-proj-name-input" placeholder="' + esc(t('mvmai_pub_project_name_label')) + '">' +
          '<div style="display:flex;gap:.4rem">' +
          '<input class="mvmai-proj-path-input" placeholder="' + esc(t('mvmai_pub_project_path_optional')) + '" readonly style="flex:1">' +
          '<button class="mvmai-confirm-no mvmai-proj-browse-btn" style="flex-shrink:0">' + esc(t('mvmai_pub_project_browse')) + '</button>' +
          '<button class="mvmai-confirm-no mvmai-proj-path-clear-btn" title="' + esc(t('mvmai_pub_clear')) + '" style="flex-shrink:0">✕</button>' +
          '</div>' +
          '<textarea class="mvmai-proj-instructions-input" rows="4" style="resize:vertical;min-height:90px" placeholder="' + esc(t('mvmai_pub_instructions_label')) + '"></textarea>' +
          '<div style="display:flex;gap:.4rem">' +
          '<input class="mvmai-proj-instr-file-input" placeholder="' + esc(t('mvmai_pub_instructions_file_label')) + '" style="flex:1">' +
          '<button class="mvmai-confirm-no mvmai-proj-file-browse-btn" style="flex-shrink:0">' + esc(t('mvmai_pub_project_browse')) + '</button>' +
          '<button class="mvmai-confirm-no mvmai-proj-file-clear-btn" title="' + esc(t('mvmai_pub_clear')) + '" style="flex-shrink:0">✕</button>' +
          '</div>' +
          '<div class="mvmai-pub-dialog-hint">' + esc(t('mvmai_pub_instructions_hint')) + '</div>' +
          '<div class="mvmai-pub-dialog-err" hidden></div>' +
          '<div class="mvmai-pub-dialog-actions">' +
          '<button class="mvmai-confirm-no mvmai-proj-cancel-btn">' + esc(t('mvmai_pub_cancel')) + '</button>' +
          '<button class="mvmai-confirm-yes mvmai-proj-save-btn">' + esc(t('mvmai_pub_save')) + '</button>' +
          '</div></div>';
        document.body.appendChild(backdrop);
        var nameInput = backdrop.querySelector('.mvmai-proj-name-input');
        var pathInput = backdrop.querySelector('.mvmai-proj-path-input');
        var instrInput = backdrop.querySelector('.mvmai-proj-instructions-input');
        var fileInput = backdrop.querySelector('.mvmai-proj-instr-file-input');
        var errEl = backdrop.querySelector('.mvmai-pub-dialog-err');
        nameInput.value = p.name || '';
        pathInput.value = p.path || '';
        instrInput.value = p.instructions || '';
        fileInput.value = p.instructions_file || '';

        backdrop.querySelector('.mvmai-proj-cancel-btn').onclick = function () { backdrop.remove(); };
        backdrop.querySelector('.mvmai-proj-browse-btn').onclick = function () {
          showFolderPicker(pathInput.value || '/', function (chosen) { pathInput.value = chosen; });
        };
        backdrop.querySelector('.mvmai-proj-path-clear-btn').onclick = function () { pathInput.value = ''; };
        backdrop.querySelector('.mvmai-proj-file-browse-btn').onclick = function () {
          showFilePicker(pathInput.value || '/', function (chosen) { fileInput.value = chosen; });
        };
        backdrop.querySelector('.mvmai-proj-file-clear-btn').onclick = function () { fileInput.value = ''; };
        backdrop.querySelector('.mvmai-proj-save-btn').onclick = function () {
          var name = nameInput.value.trim();
          if (!name) { errEl.hidden = false; errEl.textContent = t('mvmai_pub_project_name_required'); return; }
          this.disabled = true; this.textContent = t('mvmai_pub_project_creating');
          var btn = this;
          api('/projects/' + p.id, {method: 'PATCH', body: JSON.stringify({
            name: name, path: pathInput.value.trim(),
            instructions: instrInput.value, instructions_file: fileInput.value.trim(),
          })}).then(function (data) {
            if (data.__status !== 200) {
              errEl.hidden = false; errEl.textContent = data.error || 'Error';
              btn.disabled = false; btn.textContent = t('mvmai_pub_save');
              return;
            }
            backdrop.remove();
            if (activeProject && activeProject.id === p.id) {
              activeProject = data.project;
              sidebarProjectHeaderEl.querySelector('.mvmai-sidebar-project-title').textContent = '📁 ' + data.project.name;
              renderInlineFileTree();
              updateProjectBadge();
            }
            loadProjects();
          });
        };
      }

      if (me.is_admin && newProjectBtn) {
        newProjectBtn.onclick = showNewProjectDialog;
        loadProjects();
      }

      function showWelcome() {
        var welcomeKey = me.is_admin ? 'mvmai_pub_welcome_admin'
          : (me.has_api_bridge ? 'mvmai_pub_welcome_user_bridge' : 'mvmai_pub_welcome_user_plain');
        listEl.innerHTML = '<div class="mvmai-welcome">' + esc(t(welcomeKey)) + '</div>';
      }
      showWelcome();

      // Opening a project starts no chat: it lists the project's chats and
      // offers a new one (which asks for its model first).
      function showProjectStart() {
        if (!projectStartState()) return;
        var project = activeProject;
        listEl.innerHTML = '<div class="mvmai-start"></div>';
        var box = listEl.firstChild;
        var title = document.createElement('div');
        title.className = 'mvmai-start-title';
        title.textContent = '📁 ' + project.name;
        var newBtn = document.createElement('button');
        newBtn.type = 'button';
        newBtn.className = 'mvmai-start-new';
        newBtn.textContent = '+ ' + t('mvmai_pub_new_chat');
        newBtn.onclick = function () { chooseProjectModel(); };
        box.append(title, newBtn);
        refreshSessionList().then(function () {
          if (!projectStartState() || activeProject !== project) return;
          var rows = sessionsCache.filter(function (x) { return !x.archived_at && x.project_id === project.id; });
          var list = document.createElement('div');
          list.className = 'mvmai-start-list';
          if (!rows.length) {
            var none = document.createElement('div');
            none.className = 'mvmai-start-empty';
            none.textContent = t('mvmai_pub_no_sessions');
            list.appendChild(none);
          }
          rows.forEach(function (x) {
            var b = document.createElement('div');
            b.className = 'mvmai-session-row';
            var tt = document.createElement('span');
            tt.className = 'mvmai-session-title';
            tt.textContent = x.title || t('mvmai_pub_new_chat');
            b.appendChild(tt);
            b.onclick = function () { openSession(x.id); };
            list.appendChild(b);
          });
          box.appendChild(list);
        });
      }

      function scrollDown() { listEl.scrollTop = listEl.scrollHeight; }

      function openSidebar() { sidebarEl.classList.add('open'); backdropEl.classList.add('open'); }
      function closeSidebar() { closeSessionMenu(); closeSessionActions(); sidebarEl.classList.remove('open'); backdropEl.classList.remove('open'); }
      histBtn.onclick = function () { openSidebar(); refreshSessionList(); };
      backdropEl.onclick = closeSidebar;
      archiveLinkEl.onclick = function () {
        archiveExpanded = !archiveExpanded;
        renderArchiveList();
      };

      function restoreSession(id) {
        if (sending) return;
        api('/sessions/' + encodeURIComponent(id) + '/restore', {method: 'POST'}).then(function (data) {
          if (data.__status !== 200) return;
          if (sessionId === id) {
            archivedSession = false;
            refreshComposer();
            if (termPanel) termPanel.setChat(id);
          }
          refreshSessionList();
        });
      }

      function renderArchiveList() {
        var archived = sessionsCache.filter(function (s) { return !!s.archived_at; });
        archiveLinkEl.textContent = t('mvmai_pub_archived') + ' (' + archived.length + ') ' + (archiveExpanded ? '▴' : '▾');
        archiveLinkEl.setAttribute('aria-expanded', String(archiveExpanded));
        archiveListEl.hidden = !archiveExpanded;
        archiveDeleteAllEl.hidden = !archiveExpanded || !archived.length;
        if (!archiveExpanded) return;
        archiveListEl.innerHTML = '';
        if (!archived.length) {
          archiveListEl.innerHTML = '<div class="mvmai-no-sessions">' + esc(t('mvmai_pub_no_archived')) + '</div>';
          return;
        }
        archived.forEach(function (s) {
          var row = document.createElement('div');
          row.className = 'mvmai-session-row' + (s.id === sessionId ? ' active' : '');
          row.innerHTML = '<div class="mvmai-session-text"><span class="mvmai-session-title"></span></div>' +
            '<button class="mvmai-s-btn mvmai-s-restore" title="' + esc(t('mvmai_pub_restore')) + '">↩</button>' +
            '<button class="mvmai-s-btn mvmai-s-delete" title="' + esc(t('mvmai_pub_delete')) + '">🗑</button>';
          row.querySelector('.mvmai-session-title').textContent = s.title || t('mvmai_pub_new_chat');
          row.onclick = function () { openSession(s.id); };
          row.querySelector('.mvmai-s-restore').onclick = function (e) {
            e.stopPropagation();
            restoreSession(s.id);
          };
          row.querySelector('.mvmai-s-delete').onclick = function (e) {
            e.stopPropagation();
            if (sending || !confirm(t('mvmai_pub_delete_confirm'))) return;
            api('/sessions/' + encodeURIComponent(s.id), {method: 'DELETE'}).then(function (data) {
              if (data.__status !== 200) return;
              if (s.id === sessionId) {
                sessionId = null; archivedSession = false; chatLabel = null; chatProvider = null; chatModel = null; history = [];
                if (termPanel) termPanel.setChat(null);
                refreshComposer(); showWelcome();
              }
              refreshSessionList();
            });
          };
          archiveListEl.appendChild(row);
        });
      }

      archiveDeleteAllEl.onclick = function () {
        if (sending || !confirm(t('mvmai_pub_delete_all_archived_confirm'))) return;
        api('/sessions/archived', {method: 'DELETE'}).then(function (data) {
          if (data.__status !== 200) return;
          if (archivedSession) {
            sessionId = null; archivedSession = false; chatLabel = null; chatProvider = null; chatModel = null; history = [];
            if (termPanel) termPanel.setChat(null);
            refreshComposer(); showWelcome();
          }
          refreshSessionList();
        });
      };
      archiveRestoreEl.onclick = function () {
        if (sessionId && archivedSession) restoreSession(sessionId);
      };

      var sessionMenuEl = document.createElement('div');
      sessionMenuEl.className = 'mvmai-session-menu';
      sessionMenuEl.setAttribute('role', 'menu');
      sessionMenuEl.setAttribute('aria-label', t('mvmai_pub_chat_actions_hint'));
      sessionMenuEl.hidden = true;
      sidebarEl.appendChild(sessionMenuEl);
      var revealedSessionRow = null;

      function closeSessionMenu() { sessionMenuEl.hidden = true; }
      function closeSessionActions() {
        if (revealedSessionRow) revealedSessionRow.classList.remove('revealed');
        revealedSessionRow = null;
      }
      function revealSessionActions(row) {
        closeSessionMenu();
        closeSessionActions();
        row.classList.add('revealed');
        revealedSessionRow = row;
      }

      function toggleSessionPin(s) {
        api('/sessions/' + encodeURIComponent(s.id) + '/pin', {
          method: 'POST', body: JSON.stringify({pinned: !s.pinned_at})
        }).then(function (data) { if (data.__status === 200) refreshSessionList(); });
      }

      function archiveActiveSession(s) {
        if (chatContexts[s.id] && chatContexts[s.id].sending) return;
        api('/sessions/' + encodeURIComponent(s.id) + '/archive', {method: 'POST'}).then(function (data) {
          if (data.__status !== 200) return;
          if (s.id === sessionId) { archivedSession = true; refreshComposer(); }
          archiveExpanded = true;
          refreshSessionList();
        });
      }

      function renameSession(s, row) {
        var titleEl = row.querySelector('.mvmai-session-title');
        if (!titleEl) return;
        var input = document.createElement('input');
        var finished = false;
        input.className = 'mvmai-session-edit';
        input.type = 'text';
        input.value = s.title || '';
        input.setAttribute('aria-label', t('mvmai_pub_rename'));
        titleEl.replaceWith(input);
        input.focus();
        input.select();

        function finish(save) {
          if (finished) return;
          finished = true;
          var next = input.value.trim();
          if (!save || !next || next === (s.title || '')) {
            refreshSessionList();
            return;
          }
          api('/sessions/' + encodeURIComponent(s.id), {
            method: 'PATCH', body: JSON.stringify({title: next})
          }).then(function () { refreshSessionList(); });
        }
        input.addEventListener('click', function (event) { event.stopPropagation(); });
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') { event.preventDefault(); finish(true); }
          else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', function () { finish(true); });
      }

      function openSessionMenu(s, row, clientX, clientY, focusMenu) {
        closeSessionActions();
        sessionMenuEl.textContent = '';
        function addAction(label, action, disabled) {
          var button = document.createElement('button');
          button.type = 'button';
          button.setAttribute('role', 'menuitem');
          button.textContent = label;
          button.disabled = !!disabled;
          button.onclick = function (event) { event.stopPropagation(); closeSessionMenu(); action(); };
          sessionMenuEl.appendChild(button);
        }
        addAction(t(s.pinned_at ? 'mvmai_pub_unpin' : 'mvmai_pub_pin'), function () { toggleSessionPin(s); });
        addAction(t('mvmai_pub_rename'), function () { renameSession(s, row); });
        if (!s.pinned_at) addAction(t('mvmai_pub_archive'), function () { archiveActiveSession(s); },
          chatContexts[s.id] && chatContexts[s.id].sending);
        sessionMenuEl.hidden = false;
        var bounds = sidebarEl.getBoundingClientRect();
        sessionMenuEl.style.left = Math.max(4, Math.min(clientX - bounds.left, bounds.width - sessionMenuEl.offsetWidth - 4)) + 'px';
        sessionMenuEl.style.top = Math.max(4, Math.min(clientY - bounds.top, bounds.height - sessionMenuEl.offsetHeight - 4)) + 'px';
        if (focusMenu) sessionMenuEl.querySelector('button').focus();
      }

      function onSessionMenuPointer(event) {
        if (!sessionMenuEl.hidden && !sessionMenuEl.contains(event.target)) closeSessionMenu();
        if (revealedSessionRow && !revealedSessionRow.contains(event.target)) closeSessionActions();
      }
      function onSessionMenuKey(event) {
        if (event.key === 'Escape' && !sessionMenuEl.hidden) { closeSessionMenu(); event.preventDefault(); }
      }
      document.addEventListener('pointerdown', onSessionMenuPointer);
      document.addEventListener('keydown', onSessionMenuKey);
      function onSessionListScroll() { closeSessionMenu(); closeSessionActions(); }
      sidebarListEl.addEventListener('scroll', onSessionListScroll);
      sessionMenuCleanup = function () {
        document.removeEventListener('pointerdown', onSessionMenuPointer);
        document.removeEventListener('keydown', onSessionMenuKey);
        sidebarListEl.removeEventListener('scroll', onSessionListScroll);
      };

      function refreshSessionList() {
        if (titleRefreshTimer) { clearTimeout(titleRefreshTimer); titleRefreshTimer = null; }
        return api('/sessions').then(function (data) {
          if (data.__status !== 200) return;
          closeSessionMenu();
          closeSessionActions();
          sessionsCache = data.sessions || [];
          if (sessionsCache.some(function (s) { return s.title_pending; })) {
            titleRefreshTimer = setTimeout(refreshSessionList, 2500);
          }
          var current = sessionsCache.filter(function (s) { return s.id === sessionId; })[0];
          if (current && archivedSession !== !!current.archived_at) {
            archivedSession = !!current.archived_at;
            refreshComposer();
          }
          var sessions = sessionsCache.filter(function (s) {
            return !s.archived_at && (activeProject ? s.project_id === activeProject.id : !s.project_id);
          });
          renderArchiveList();
          if (!sessions.length) {
            sidebarListEl.innerHTML = '<div class="mvmai-no-sessions">' + esc(t('mvmai_pub_no_sessions')) + '</div>';
            return;
          }
          sidebarListEl.innerHTML = '';
          sessions.forEach(function (s) {
            var row = document.createElement('div');
            row.className = 'mvmai-session-row mvmai-session-main' + (s.id === sessionId ? ' active' : '') + (s.pinned_at ? ' pinned' : '');
            row.innerHTML =
              '<div class="mvmai-session-text"><span class="mvmai-session-title"></span>' +
              (s.label ? '<span class="mvmai-session-label"></span>' : '') + '</div>' +
              '<div class="mvmai-session-actions">' +
              '<button class="mvmai-s-btn mvmai-s-pin" type="button" title="' +
              esc(t(s.pinned_at ? 'mvmai_pub_unpin' : 'mvmai_pub_pin')) + '" aria-label="' +
              esc(t(s.pinned_at ? 'mvmai_pub_unpin' : 'mvmai_pub_pin')) + '">📌</button>' +
              '<button class="mvmai-s-btn mvmai-s-rename" type="button" title="' + esc(t('mvmai_pub_rename')) +
              '" aria-label="' + esc(t('mvmai_pub_rename')) + '">✎</button>' +
              (s.pinned_at ? '' : '<button class="mvmai-s-btn mvmai-s-archive" type="button" title="' +
              esc(t('mvmai_pub_archive')) + '" aria-label="' + esc(t('mvmai_pub_archive')) + '">🗃</button>') + '</div>';
            row.querySelector('.mvmai-session-title').textContent = s.title || t('mvmai_pub_new_chat');
            if (chatContexts[s.id] && chatContexts[s.id].sending) {
              var workingTurn = chatContexts[s.id].turn;
              if (workingTurn) {
                var working = document.createElement('canvas');
                working.className = 'mvmai-session-activity';
                working.setAttribute('aria-hidden', 'true');
                row.insertBefore(working, row.firstChild);
                workingTurn.sidebarCanvas = working;
                row.setAttribute('aria-busy', 'true');
              }
            }
            if (s.label) row.querySelector('.mvmai-session-label').textContent = s.label;
            row.tabIndex = 0;
            row.setAttribute('role', 'group');
            row.setAttribute('aria-label', s.title || t('mvmai_pub_new_chat'));
            row.title = (s.title || t('mvmai_pub_new_chat')) + '\n' + t('mvmai_pub_chat_actions_hint');
            row.querySelector('.mvmai-s-pin').onclick = function (event) {
              event.stopPropagation(); closeSessionActions(); toggleSessionPin(s);
            };
            row.querySelector('.mvmai-s-rename').onclick = function (event) {
              event.stopPropagation(); closeSessionActions(); renameSession(s, row);
            };
            var mobileArchive = row.querySelector('.mvmai-s-archive');
            if (mobileArchive) {
              mobileArchive.disabled = !!(chatContexts[s.id] && chatContexts[s.id].sending);
              mobileArchive.onclick = function (event) {
                event.stopPropagation(); closeSessionActions(); archiveActiveSession(s);
              };
            }
            var suppressClickUntil = 0;
            var holdTimer = null;
            var holdX = 0, holdY = 0;
            var trackingTouch = false;
            function cancelHold() { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } }
            row.onclick = function () {
              if (Date.now() < suppressClickUntil) return;
              if (row.classList.contains('revealed')) { closeSessionActions(); return; }
              closeSessionMenu();
              openSession(s.id);
            };
            row.oncontextmenu = function (event) {
              event.preventDefault();
              cancelHold();
              if (event.pointerType === 'touch') suppressClickUntil = Date.now() + 600;
              openSessionMenu(s, row, event.clientX, event.clientY, false);
            };
            row.onpointerdown = function (event) {
              if (event.pointerType !== 'touch' || row.querySelector('.mvmai-session-actions').contains(event.target)) return;
              trackingTouch = true;
              holdX = event.clientX; holdY = event.clientY;
              cancelHold();
              holdTimer = setTimeout(function () {
                holdTimer = null;
                suppressClickUntil = Date.now() + 600;
                openSessionMenu(s, row, holdX, holdY, false);
              }, 500);
            };
            row.onpointermove = function (event) {
              if (holdTimer && (Math.abs(event.clientX - holdX) > 10 || Math.abs(event.clientY - holdY) > 10)) cancelHold();
            };
            row.onpointerup = function (event) {
              cancelHold();
              if (trackingTouch && window.matchMedia('(max-width:640px)').matches) {
                var dx = event.clientX - holdX;
                var dy = event.clientY - holdY;
                if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy) * 1.2) {
                  if (dx < 0) revealSessionActions(row);
                  else closeSessionActions();
                  suppressClickUntil = Date.now() + 600;
                }
              }
              trackingTouch = false;
            };
            row.onpointercancel = function () { cancelHold(); trackingTouch = false; };
            row.onkeydown = function (event) {
              if (event.target !== row) return;
              if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault();
                var bounds = row.getBoundingClientRect();
                openSessionMenu(s, row, bounds.left + 12, bounds.bottom, true);
              } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openSession(s.id);
              }
            };
            sidebarListEl.appendChild(row);
          });
        });
      }

      function openSession(id) {
        var requestVersion = ++viewVersion;
        api('/sessions/' + encodeURIComponent(id) + '/messages?lang=' + encodeURIComponent(uiLang() || 'en')).then(function (data) {
          if (data.__status !== 200 || requestVersion !== viewVersion) return;
          var cached = chatContexts[id];
          if (cached === chatContext) { closeSidebar(); refreshSessionList(); if (me.is_admin) loadProjects(); return; }
          if (cached) restoreChatContext(cached); else newChatView();
          sessionId = id;
          archivedSession = !!data.archived_at;
          newProjectModel = null;
          var modelDialog = root.querySelector('.mvmai-model-dialog');
          if (modelDialog) modelDialog.remove();
          chatLabel = data.provider_label || null;
          chatProvider = data.provider || null;
          chatModel = data.model || null;
          refreshComposer();
          var row = sessionsCache.filter(function (s) { return s.id === id; })[0];
          var pid = row && row.project_id;
          activeProject = pid ? (projects.filter(function (p) { return p.id === pid; })[0] || {id: pid, name: pid, path: ''}) : null;
          if (termPanel) termPanel.setChat(archivedSession ? null : id);
          if (activeProject) {
            sidebarProjectHeaderEl.hidden = false;
            sidebarProjectHeaderEl.querySelector('.mvmai-sidebar-project-title').textContent = '📁 ' + activeProject.name;
            if (projectsSectionEl) projectsSectionEl.hidden = true;
            renderInlineFileTree();
          } else {
            sidebarProjectHeaderEl.hidden = true;
            if (projectsSectionEl) projectsSectionEl.hidden = false;
            if (sidebarFiletreeEl) sidebarFiletreeEl.innerHTML = '';
            syncFiletreeVisibility();
          }
          updateProjectBadge();
          if (!cached) {
            history = data.messages || [];
            listEl.innerHTML = '';
            var any = false;
            history.forEach(function (m) {
              if (m.role === 'model_switch') {
                addModelSwitchNote(m);
                any = true;
              } else if (m.role === 'summary' && m.content) {
                addCompactedNote(m.content);
                any = true;
              } else if ((m.role === 'user' || m.role === 'assistant') && m.content) {
                addBubble(m.role, m.content, null, m.created_at, null, m.provider_label, m.duration_ms);
                any = true;
              }
            });
            if (!any) showWelcome();
          }
          saveChatContext();
          closeSidebar();
          refreshSessionList();
          if (me.is_admin) loadProjects();
        });
      }

      newChatBtn.onclick = function () {
        newChatView();
        sessionId = null;
        archivedSession = false;
        newProjectModel = null;
        if (termPanel) termPanel.setChat(null);
        chatLabel = null;
        chatProvider = null;
        chatModel = null;
        refreshComposer();
        history = [];
        showWelcome();
        closeSidebar();
        refreshSessionList();
        if (me.is_admin && activeProject) { showProjectStart(); chooseProjectModel(); }
      };

      refreshSessionList();

      // Files the model offers: [[file:/abs/path]] (administrators, fetched from the
      // server) and ```file:name.ext blocks (text made right here in the browser).
      function extractDownloads(content) {
        var files = [];
        var text = String(content || '').replace(/```file:([^\s`]{1,120})[^\n]*\n([\s\S]*?)```/g, function (all, name, body) {
          files.push({name: name.replace(/[\\/]/g, '_'), text: body});
          return '';
        });
        if (me && me.is_admin) {
          text = text.replace(/\[\[file:(\/[^\]\n]{1,1000})\]\]/g, function (all, path) {
            files.push({name: path.split('/').pop(), path: path});
            return '';
          });
        }
        return {text: text.trim(), files: files};
      }

      function saveBlob(blob, name) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      }

      function downloadRow(files) {
        var row = document.createElement('div');
        row.className = 'mvmai-downloads';
        files.forEach(function (f) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'mvmai-download';
          b.textContent = '⬇ ' + f.name;
          b.onclick = function () {
            if (f.path) {
              b.disabled = true;
              var headers = {'X-Pub-Token': token};
              if (isDesktop) headers['X-MvmAI-Surface'] = 'desktop';
              fetch(API + '/download?path=' + encodeURIComponent(f.path), {headers: headers})
                .then(function (r) { if (!r.ok) throw new Error('x'); return r.blob(); })
                .then(function (blob) { saveBlob(blob, f.name); })
                .catch(function () { addNote(t('mvmai_pub_download_failed')); })
                .then(function () { b.disabled = false; });
            } else {
              saveBlob(new Blob([f.text], {type: 'text/plain;charset=utf-8'}), f.name);
            }
          };
          row.appendChild(b);
        });
        return row;
      }

      // A picture shown larger over the chat; a click or Escape closes it.
      function openLightbox(src) {
        var box = document.createElement('div');
        box.className = 'mvmai-lightbox';
        var img = document.createElement('img');
        img.src = src;
        box.appendChild(img);
        function close() { box.remove(); document.removeEventListener('keydown', onKey); }
        function onKey(e) { if (e.key === 'Escape') close(); }
        var x = document.createElement('button');
        x.type = 'button';
        x.className = 'mvmai-lightbox-close';
        x.textContent = '✕';
        x.title = t('mvmai_gal_close');
        x.onclick = function (e) { e.stopPropagation(); close(); };
        box.appendChild(x);
        box.onclick = close;
        document.addEventListener('keydown', onKey);
        root.querySelector('.mvmai-widget').appendChild(box);
      }

      function makeThumb(src) {
        var img = document.createElement('img');
        img.className = 'mvmai-thumb';
        img.src = src;
        img.onclick = function (e) { e.stopPropagation(); openLightbox(src); };
        return img;
      }

      // Small pictures of what was attached: the ones sent a moment ago come
      // with the message; in an older chat the images the administrator saved on
      // the server are fetched again (they stay a week).
      function addThumbs(el, thumbs, content) {
        var box = document.createElement('div');
        box.className = 'mvmai-thumbs';
        (thumbs || []).forEach(function (src) { box.appendChild(makeThumb(src)); });
        if (!thumbs && me && me.is_admin) {
          var re = /\[Attached file saved on the server: ([^\]]+\.(?:png|jpe?g|webp|gif))\]/gi, m;
          while ((m = re.exec(content || ''))) {
            (function (path) {
              fetch(API + '/attachment?path=' + encodeURIComponent(path), {headers: {'X-Pub-Token': token}}).then(function (r) {
                if (!r.ok) throw new Error('gone');
                return r.blob();
              }).then(function (blob) {
                if (!box.parentNode) el.appendChild(box);
                box.appendChild(makeThumb(URL.createObjectURL(blob)));
                scrollDown();
              }).catch(function () {});
            })(m[1]);
          }
        }
        if (thumbs && thumbs.length) el.appendChild(box);
      }

      function formatElapsed(milliseconds) {
        var seconds = Math.max(0, Math.floor(milliseconds / 1000));
        return Math.floor(seconds / 60) + ':' + ('0' + seconds % 60).slice(-2);
      }

      function addBubble(role, content, thumbs, createdAt, ctx, savedLabel, durationMs) {
        var targetList = ctx ? ctx.listEl : listEl;
        var el = document.createElement('div');
        el.className = 'mvmai-msg ' + role;
        var offered = role === 'assistant' ? extractDownloads(content) : null;
        el.innerHTML = nl2br(offered ? offered.text : content);
        if (offered && offered.files.length) el.appendChild(downloadRow(offered.files));
        if (role === 'user') addThumbs(el, thumbs, content);
        var label = role === 'assistant' ? (savedLabel || (ctx ? ctx.chatLabel : currentLabel())) : null;
        var time = formatMessageTime(createdAt);
        if (label || time) {
          var meta = document.createElement('div');
          meta.className = 'mvmai-msg-meta';
          if (label) {
            var providerEl = document.createElement('span');
            providerEl.className = 'mvmai-provider-label';
            providerEl.textContent = label;
            meta.appendChild(providerEl);
          }
          if (time) {
            var timeEl = document.createElement('time');
            timeEl.className = 'mvmai-msg-time';
            timeEl.dateTime = new Date(Number(createdAt) * 1000).toISOString();
            timeEl.textContent = time;
            if (role === 'assistant' && Number.isFinite(durationMs) && durationMs >= 0) {
              timeEl.textContent += ' (' + formatElapsed(durationMs) + ')';
            }
            meta.appendChild(timeEl);
          }
          el.appendChild(meta);
        }
        targetList.appendChild(el);
        targetList.scrollTop = targetList.scrollHeight;
        return el;
      }

      function addNote(text, ctx) {
        var targetList = ctx ? ctx.listEl : listEl;
        var el = document.createElement('div');
        el.className = 'mvmai-msg system-note';
        el.textContent = text;
        targetList.appendChild(el);
        targetList.scrollTop = targetList.scrollHeight;
      }

      function addModelSwitchNote(message, ctx) {
        try {
          var details = JSON.parse(message.content || '{}');
          addNote(t('mvmai_pub_model_changed', {model: details.to || ''}), ctx);
        } catch (e) {}
      }

      function addCompactedNote(summaryText) {
        var el = document.createElement('div');
        el.className = 'mvmai-msg system-note';
        el.textContent = t('mvmai_pub_compacted_note');
        if (summaryText) {
          var body = document.createElement('div');
          body.className = 'mvmai-tool-out';
          body.textContent = summaryText;
          body.hidden = true;
          var toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'mvmai-tool-toggle';
          function sync() {
            toggle.textContent = (body.hidden ? '▸ ' : '▾ ') + t(body.hidden ? 'mvmai_pub_view_summary' : 'mvmai_pub_show_less');
          }
          toggle.onclick = function () { body.hidden = !body.hidden; sync(); scrollDown(); };
          sync();
          el.appendChild(document.createElement('br'));
          el.appendChild(toggle);
          el.appendChild(body);
        }
        listEl.appendChild(el);
        scrollDown();
      }

      // Shows only a short single-line preview of a command/output block by
      // default; the rest (full multi-line command, full output) stays
      // hidden behind a toggle so long tool output doesn't dominate the
      // chat, but is one click away when the user wants to inspect it.
      function shortPreview(text) {
        var s = text || '';
        var line = s.split('\n')[0];
        if (line.length > 80) return line.slice(0, 80) + '…';
        if (s.indexOf('\n') !== -1) return line + ' …';
        return line;
      }

      function addDetailsToggle(card) {
        var details = document.createElement('div');
        details.hidden = true;
        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'mvmai-tool-toggle';
        function sync() {
          toggle.textContent = (details.hidden ? '▸ ' : '▾ ') + t(details.hidden ? 'mvmai_pub_show_more' : 'mvmai_pub_show_less');
        }
        toggle.onclick = function () { details.hidden = !details.hidden; sync(); scrollDown(); };
        sync();
        card.appendChild(toggle);
        card.appendChild(details);
        return details;
      }

      function addTyping(ctx) {
        var targetList = ctx ? ctx.listEl : listEl;
        var current = ctx && ctx.turn;
        if (current && current.activityCleanup) current.activityCleanup();
        var el = document.createElement('div');
        el.className = 'mvmai-typing';
        var canvas = document.createElement('canvas');
        canvas.width = 200; canvas.height = 36;
        canvas.setAttribute('role', 'img');
        var clock = document.createElement('time');
        el.appendChild(canvas); el.appendChild(clock);
        var pen = canvas.getContext('2d');
        var baseline = 16;
        var samples = new Array(50).fill(baseline);
        var energy = 0, energyAt = Date.now(), seq = 0, tick = 0;
        var startedAt = current ? current.startedAt : Date.now();
        var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        function decayEnergy(now) {
          energy *= Math.exp(-Math.max(0, now - energyAt) / 1300);
          if (energy < .15) energy = 0;
          energyAt = now;
        }
        el.updateActivity = function (data) {
          if (Number(data.activity_seq) > seq) {
            var count = Number(data.activity_seq) - seq;
            seq = Number(data.activity_seq);
            decayEnergy(Date.now());
            if (data.activity_age != null && data.activity_age < 4) {
              // Event volume raises the peak; nearby bursts accumulate.
              // This measures incoming activity, not reasoning complexity.
              energy = Math.min(14, energy + 2 * Math.log2(1 + count));
            }
          }
        };
        function draw() {
          clock.textContent = formatElapsed(Date.now() - startedAt);
          decayEnergy(Date.now());
          var active = energy > 0;
          var label = t(active ? 'mvmai_pub_activity_active' : 'mvmai_pub_activity_waiting');
          canvas.setAttribute('aria-label', label); el.title = label;
          tick++;
          var wave = energy * [0, .25, .7, 1, .45, 0][tick % 6];
          samples.shift(); samples.push(baseline - wave);
          if (current && current.sidebarCanvas && current.sidebarCanvas.isConnected) {
            var background = current.sidebarCanvas;
            var width = background.clientWidth || 200, height = background.clientHeight || 40;
            if (background.width !== width * 2 || background.height !== height * 2) {
              background.width = width * 2; background.height = height * 2;
            }
            var bg = background.getContext('2d');
            if (bg) {
              bg.setTransform(2, 0, 0, 2, 0, 0);
              bg.clearRect(0, 0, width, height);
              bg.strokeStyle = getComputedStyle(background).color;
              bg.lineWidth = 1.5; bg.lineJoin = 'round';
              bg.beginPath();
              samples.forEach(function (y, i) {
                var x = i * width / (samples.length - 1);
                var scaledY = (reducedMotion ? baseline : y) / 18 * height;
                if (i) bg.lineTo(x, scaledY); else bg.moveTo(x, scaledY);
              });
              bg.stroke();
            }
          }
          if (!pen) return;
          pen.setTransform(2, 0, 0, 2, 0, 0);
          pen.clearRect(0, 0, 100, 18);
          pen.strokeStyle = getComputedStyle(el).color;
          pen.lineWidth = 1.2; pen.lineJoin = 'round';
          pen.beginPath();
          samples.forEach(function (y, i) {
            if (i) pen.lineTo(i * 2, reducedMotion ? baseline : y); else pen.moveTo(0, reducedMotion ? baseline : y);
          });
          pen.stroke();
          pen.beginPath(); pen.arc(98, reducedMotion ? baseline : samples[49], active ? 1.8 : 1, 0, Math.PI * 2);
          pen.fillStyle = pen.strokeStyle; pen.fill();
        }
        targetList.appendChild(el);
        targetList.scrollTop = targetList.scrollHeight;
        draw();
        var timer = setInterval(function () {
          if (!root.isConnected || (ctx && ctx.turn !== current)) { clearInterval(timer); return; }
          draw();
        }, 120);
        var remove = el.remove.bind(el);
        if (current) current.activityCleanup = function () { clearInterval(timer); };
        // The sidebar keeps settling while a tool runs between model steps.
        el.remove = function () { if (!current) clearInterval(timer); remove(); };
        return el;
      }

      function parseArgs(raw) {
        try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
      }

      function runToolCall(call, ctx) {
        ctx = ctx || saveChatContext();
        var listEl = ctx.listEl, activeProject = ctx.activeProject;
        function scrollDown() { listEl.scrollTop = listEl.scrollHeight; }
        var name = call.function && call.function.name;
        var args = parseArgs(call.function && call.function.arguments);

        if (name === 'run_command') {
          return runCommandCall(args, ctx).then(function (resultText) {
            return {role: 'tool', tool_call_id: call.id, content: resultText};
          });
        }

        if (name === 'inspect_server') {
          return inspectServerCall(args, ctx).then(function (resultText) {
            return {role: 'tool', tool_call_id: call.id, content: resultText};
          });
        }

        // A tool that changes data first becomes a form the user reviews,
        // corrects and saves; reads run straight away.
        return api('/tool-preview', {method: 'POST', body: JSON.stringify({name: name, arguments: args, lang: uiLang()})})
          .then(function (pv) {
            if (pv.__status === 200 && pv.write) return reviewToolCall(call, name, args, pv, ctx);
            return readToolCall(call, name, args, ctx);
          });
      }

      // The editable form of one change: its card, and how to read the
      // values the user left in it.
      function buildReview(pv) {
        var card = document.createElement('div');
        card.className = 'mvmai-tool-card mvmai-review';
        card.innerHTML = '<div class="mvmai-tool-head">' + esc(pv.app.icon) + ' ' + esc(appName(pv.app)) + ' · ' + esc(pv.action) + '</div>' +
          (pv.summary ? '<div class="mvmai-review-sum">' + esc(pv.summary) + '</div>' : '');
        var inputs = [];
        pv.fields.forEach(function (f) {
          var label = document.createElement('label');
          label.textContent = f.label + (f.required ? ' *' : '');
          var input;
          var value = f.value === null || f.value === undefined ? '' : f.value;
          if (f.options && f.options.length) {
            input = document.createElement('select');
            var opts = f.options.slice();
            if (value !== '' && !opts.some(function (o) { return String(o.value) === String(value); })) {
              opts.unshift({value: value, label: String(value)});
            }
            if (!f.required || value === '') opts.unshift({value: '', label: '—'});
            opts.forEach(function (o) {
              var op = document.createElement('option');
              op.value = String(o.value);
              op.textContent = o.label;
              input.appendChild(op);
            });
            input.value = String(value);
          } else if (f.type === 'bool') {
            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = value === true || value === 'true';
          } else if (f.type === 'json' || (f.type === 'text' && String(value).length > 60)) {
            input = document.createElement('textarea');
            input.value = String(value);
          } else {
            input = document.createElement('input');
            input.type = f.type === 'number' ? 'number' : (f.type === 'date' || f.type === 'time' ? f.type : 'text');
            if (f.type === 'number') input.step = 'any';
            input.value = String(value);
          }
          card.appendChild(label);
          card.appendChild(input);
          inputs.push({f: f, el: input, before: f.type === 'bool' ? input.checked : input.value});
        });
        var state = document.createElement('div');
        state.className = 'mvmai-review-state';
        return {
          card: card,
          state: state,
          lock: function () { inputs.forEach(function (i) { i.el.disabled = true; }); },
          collect: function () {
            var values = {}, changed = {}, missing = false;
            inputs.forEach(function (i) {
              var v = i.f.type === 'bool' ? i.el.checked : i.el.value;
              i.el.style.borderColor = '';
              if (i.f.type !== 'bool' && i.f.required && String(v).trim() === '') {
                i.el.style.borderColor = 'var(--pub-red,#f38ba8)';
                missing = true;
              }
              if (i.f.type === 'bool' || String(v).trim() !== '') values[i.f.id] = v;
              if (v !== i.before) changed[i.f.id] = v;
            });
            return {values: values, changed: changed, missing: missing};
          }
        };
      }

      function cancelledMsg(call) {
        return {role: 'tool', tool_call_id: call.id, content: JSON.stringify({
          cancelled: true, note: 'The user cancelled this change. Nothing was saved.'
        })};
      }

      // Runs a reviewed change and tells the model what was really saved.
      function saveReviewed(call, name, form, got) {
        form.state.textContent = t('mvmai_pub_review_saving');
        return api('/tool-call', {method: 'POST', body: JSON.stringify({name: name, arguments: got.values, confirmed: true, lang: uiLang()})})
          .then(function (data) {
            if (data.__status === 200) {
              form.state.textContent = '✓ ' + t('mvmai_pub_review_saved');
              var out = {saved: true, result: data.result};
              if (Object.keys(got.changed).length) out.user_changed = got.changed;
              return {ok: true, msg: {role: 'tool', tool_call_id: call.id, content: JSON.stringify(out)}};
            }
            form.state.textContent = t('mvmai_pub_err') + ': ' + (data.error || data.__status);
            return {ok: false, msg: {role: 'tool', tool_call_id: call.id, content: JSON.stringify({error: data.error || 'failed', saved: false})}};
          });
      }

      function reviewToolCall(call, name, args, pv, ctx) {
        ctx = ctx || saveChatContext();
        var listEl = ctx.listEl, activeProject = ctx.activeProject;
        function scrollDown() { listEl.scrollTop = listEl.scrollHeight; }
        return new Promise(function (resolve) {
          var form = buildReview(pv);
          var card = form.card;
          var row = document.createElement('div');
          row.className = 'mvmai-confirm-row';
          row.innerHTML = '<button class="mvmai-confirm-yes">' + esc(t('mvmai_pub_review_save')) + '</button>' +
            '<button class="mvmai-confirm-no">' + esc(t('mvmai_pub_review_cancel')) + '</button>';
          card.appendChild(row);
          card.appendChild(form.state);
          listEl.appendChild(card);
          scrollDown();

          row.querySelector('.mvmai-confirm-no').addEventListener('click', function () {
            form.lock();
            row.remove();
            form.state.textContent = t('mvmai_pub_review_cancelled');
            resolve(cancelledMsg(call));
          });

          row.querySelector('.mvmai-confirm-yes').addEventListener('click', function () {
            var got = form.collect();
            if (got.missing) { form.state.textContent = t('mvmai_pub_review_required'); return; }
            form.lock();
            row.remove();
            saveReviewed(call, name, form, got).then(function (r) { resolve(r.msg); });
          });
        });
      }

      // Several changes asked for in one reply become one card with a page
      // per change: the user goes through them, corrects or leaves out any,
      // and saves them all at once.
      function reviewBatch(items, ctx) {
        ctx = ctx || saveChatContext();
        var listEl = ctx.listEl, activeProject = ctx.activeProject;
        function scrollDown() { listEl.scrollTop = listEl.scrollHeight; }
        return new Promise(function (resolve) {
          var box = document.createElement('div');
          box.className = 'mvmai-tool-card mvmai-review mvmai-batch';
          var nav = document.createElement('div');
          nav.className = 'mvmai-batch-nav';
          nav.innerHTML = '<button class="mvmai-batch-prev" type="button">‹</button>' +
            '<span class="mvmai-batch-pos"></span>' +
            '<button class="mvmai-batch-next" type="button">›</button>';
          box.appendChild(nav);
          var pages = items.map(function (it) {
            var form = buildReview(it.pv);
            var page = document.createElement('div');
            page.className = 'mvmai-batch-page';
            form.card.className = 'mvmai-batch-form';
            var inc = document.createElement('label');
            inc.className = 'mvmai-batch-include';
            inc.innerHTML = '<input type="checkbox" checked> ' + esc(t('mvmai_pub_review_include'));
            page.appendChild(form.card);
            page.appendChild(inc);
            page.appendChild(form.state);
            box.appendChild(page);
            var check = inc.querySelector('input');
            check.addEventListener('change', function () { form.card.style.opacity = check.checked ? '' : '.45'; });
            return {it: it, form: form, page: page, check: check};
          });
          var row = document.createElement('div');
          row.className = 'mvmai-confirm-row';
          row.innerHTML = '<button class="mvmai-confirm-yes"></button>' +
            '<button class="mvmai-confirm-no">' + esc(t('mvmai_pub_review_cancel_all')) + '</button>';
          box.appendChild(row);
          var state = document.createElement('div');
          state.className = 'mvmai-review-state';
          box.appendChild(state);
          listEl.appendChild(box);

          var cur = 0;
          var yes = row.querySelector('.mvmai-confirm-yes');
          function show(i) {
            cur = Math.max(0, Math.min(pages.length - 1, i));
            pages.forEach(function (p, k) { p.page.hidden = k !== cur; });
            nav.querySelector('.mvmai-batch-pos').textContent = t('mvmai_pub_review_page', {a: cur + 1, b: pages.length});
            nav.querySelector('.mvmai-batch-prev').disabled = cur === 0;
            nav.querySelector('.mvmai-batch-next').disabled = cur === pages.length - 1;
            state.textContent = '';
            count();
          }
          // Until the last page the main button only moves on, so nothing is
          // saved before the user has seen every change in the batch.
          function count() {
            if (cur < pages.length - 1) {
              yes.textContent = t('mvmai_pub_review_next', {a: cur + 2, b: pages.length});
              yes.disabled = false;
              return;
            }
            var n = pages.filter(function (p) { return p.check.checked; }).length;
            yes.textContent = t('mvmai_pub_review_save_all', {n: n});
            yes.disabled = !n;
          }
          pages.forEach(function (p) { p.check.addEventListener('change', count); });
          nav.querySelector('.mvmai-batch-prev').onclick = function () { show(cur - 1); };
          nav.querySelector('.mvmai-batch-next').onclick = function () { show(cur + 1); };
          show(0);
          scrollDown();

          function lockAll() {
            pages.forEach(function (p) { p.form.lock(); p.check.disabled = true; });
            row.remove();
          }

          row.querySelector('.mvmai-confirm-no').addEventListener('click', function () {
            lockAll();
            state.textContent = t('mvmai_pub_review_cancelled');
            resolve(pages.map(function (p) { return cancelledMsg(p.it.call); }));
          });

          yes.addEventListener('click', function () {
            if (cur < pages.length - 1) {
              var here = pages[cur].check.checked ? pages[cur].form.collect() : null;
              if (here && here.missing) { state.textContent = t('mvmai_pub_review_required'); return; }
              show(cur + 1);
              return;
            }
            var gots = pages.map(function (p) { return p.check.checked ? p.form.collect() : null; });
            var bad = gots.findIndex(function (g) { return g && g.missing; });
            if (bad >= 0) { show(bad); state.textContent = t('mvmai_pub_review_required'); return; }
            lockAll();
            state.textContent = t('mvmai_pub_review_saving');
            Promise.all(pages.map(function (p, k) {
              if (!gots[k]) {
                p.form.state.textContent = t('mvmai_pub_review_cancelled');
                return Promise.resolve({ok: false, skipped: true, msg: cancelledMsg(p.it.call)});
              }
              return saveReviewed(p.it.call, p.it.name, p.form, gots[k]);
            })).then(function (rs) {
              var saved = rs.filter(function (r) { return r.ok; }).length;
              var tried = rs.filter(function (r) { return !r.skipped; }).length;
              state.textContent = (saved === tried ? '✓ ' : '') + t('mvmai_pub_review_saved_n', {a: saved, b: tried});
              resolve(rs.map(function (r) { return r.msg; }));
            });
          });
        });
      }

      // The tool calls of one reply, in their order: changes that need the
      // user's review are gathered into one paged card when there are several.
      function runToolCalls(calls, ctx) {
        ctx = ctx || saveChatContext();
        var listEl = ctx.listEl, activeProject = ctx.activeProject;
        function scrollDown() { listEl.scrollTop = listEl.scrollHeight; }
        var plain = function (c) {
          var n = c.function && c.function.name;
          return n === 'run_command' || n === 'inspect_server';
        };
        if (calls.length < 2) return Promise.all(calls.map(function (call) { return runToolCall(call, ctx); }));
        return Promise.all(calls.map(function (call) {
          if (plain(call)) return {call: call};
          var name = call.function && call.function.name;
          var args = parseArgs(call.function && call.function.arguments);
          return api('/tool-preview', {method: 'POST', body: JSON.stringify({name: name, arguments: args, lang: uiLang()})})
            .then(function (pv) { return {call: call, name: name, args: args, pv: pv}; });
        })).then(function (items) {
          var writes = items.filter(function (it) { return it.pv && it.pv.__status === 200 && it.pv.write; });
          var batch = writes.length > 1 ? reviewBatch(writes, ctx) : Promise.resolve([]);
          return Promise.all(items.map(function (it) {
            if (!it.pv) return runToolCall(it.call, ctx);
            if (writes.length > 1 && writes.indexOf(it) >= 0) {
              return batch.then(function (msgs) { return msgs[writes.indexOf(it)]; });
            }
            if (it.pv.__status === 200 && it.pv.write) return reviewToolCall(it.call, it.name, it.args, it.pv, ctx);
            return readToolCall(it.call, it.name, it.args, ctx);
          }));
        });
      }

      function readToolCall(call, name, args, ctx) {
        ctx = ctx || saveChatContext();
        var listEl = ctx.listEl, activeProject = ctx.activeProject;
        function scrollDown() { listEl.scrollTop = listEl.scrollHeight; }
        var card = document.createElement('div');
        card.className = 'mvmai-tool-card';
        card.innerHTML = '<div class="mvmai-tool-head">🔧 ' + esc(t('mvmai_pub_using_tool', {name: name})) + '</div>';
        listEl.appendChild(card);
        scrollDown();

        return api('/tool-call', {method: 'POST', body: JSON.stringify({name: name, arguments: args, lang: uiLang()})})
          .then(function (data) {
            var content;
            if (data.__status === 200) {
              content = JSON.stringify(data.result);
            } else {
              content = JSON.stringify({error: data.error || t('mvmai_pub_not_available')});
              var out = document.createElement('div');
              out.className = 'mvmai-tool-out';
              out.textContent = data.error === 'not_available' ? t('mvmai_pub_not_available') : (data.error || '');
              card.appendChild(out);
            }
            return {role: 'tool', tool_call_id: call.id, content: content};
          });
      }

      function inspectServerCall(args, ctx) {
        ctx = ctx || saveChatContext();
        var listEl = ctx.listEl, activeProject = ctx.activeProject;
        function scrollDown() { listEl.scrollTop = listEl.scrollHeight; }
        var card = document.createElement('div');
        card.className = 'mvmai-tool-card';
        var fullCmd = args.command || '';
        card.innerHTML =
          '<div class="mvmai-tool-head">🔎 ' + esc(t('mvmai_pub_using_tool', {name: 'inspect_server'})) + '</div>' +
          '<div class="mvmai-tool-cmd">' + esc(shortPreview(fullCmd)) + '</div>';
        listEl.appendChild(card);
        var details = addDetailsToggle(card);
        if (fullCmd !== shortPreview(fullCmd)) {
          var fullCmdEl = document.createElement('div');
          fullCmdEl.className = 'mvmai-tool-cmd';
          fullCmdEl.textContent = fullCmd;
          details.appendChild(fullCmdEl);
        }
        scrollDown();
        return api('/inspect', {method: 'POST', body: JSON.stringify({
          command: args.command || '', reason: args.reason || '', project_id: activeProject ? activeProject.id : null
        })}).then(function (data) {
          var content = data.__status === 200 ? JSON.stringify(data.result) : JSON.stringify({error: data.error || 'forbidden'});
          var out = document.createElement('div');
          out.className = 'mvmai-tool-out';
          out.textContent = data.__status === 200 ? JSON.stringify(data.result, null, 2) : (data.error || 'forbidden');
          details.appendChild(out);
          scrollDown();
          return content;
        });
      }

      function runCommandCall(args, ctx) {
        ctx = ctx || saveChatContext();
        var listEl = ctx.listEl, activeProject = ctx.activeProject;
        function scrollDown() { listEl.scrollTop = listEl.scrollHeight; }
        var card = document.createElement('div');
        card.className = 'mvmai-tool-card';
        var fullCmd = args.command || '';
        card.innerHTML =
          '<div class="mvmai-tool-head">▶ ' + esc(t('mvmai_pub_cmd_label')) + '</div>' +
          '<div class="mvmai-tool-cmd">' + esc(shortPreview(fullCmd)) + '</div>' +
          (args.reason ? '<div style="color:var(--pub-dim,#6c7086);font-size:.76rem;margin-bottom:.3rem">' +
            esc(t('mvmai_pub_reason_label')) + ': ' + esc(args.reason) + '</div>' : '');
        listEl.appendChild(card);
        var details = addDetailsToggle(card);
        if (fullCmd !== shortPreview(fullCmd)) {
          var fullCmdEl = document.createElement('div');
          fullCmdEl.className = 'mvmai-tool-cmd';
          fullCmdEl.textContent = fullCmd;
          details.appendChild(fullCmdEl);
        }
        scrollDown();

        function exec(confirmed) {
          return api('/exec', {method: 'POST', body: JSON.stringify({command: args.command, confirmed: confirmed, project_id: activeProject ? activeProject.id : null})});
        }

        function renderResult(data) {
          if (data.blocked) {
            var b = document.createElement('div');
            b.className = 'mvmai-dangerous';
            b.textContent = t('mvmai_pub_blocked') + ': ' + (data.reason || '');
            card.appendChild(b);
            return t('mvmai_pub_blocked') + ': ' + (data.reason || '');
          }
          var out = document.createElement('div');
          out.className = 'mvmai-tool-out';
          out.textContent =
            (data.stdout || '') + (data.stderr ? '\n' + data.stderr : '') +
            '\n[' + t('mvmai_pub_exit_code') + ' ' + data.code + ']';
          details.appendChild(out);
          return JSON.stringify({stdout: data.stdout, stderr: data.stderr, code: data.code});
        }

        return exec(false).then(function (data) {
          if (data.pending) {
            return new Promise(function (resolve) {
              var row = document.createElement('div');
              row.className = 'mvmai-confirm-row';
              if (data.is_dangerous) {
                var warn = document.createElement('div');
                warn.className = 'mvmai-dangerous';
                warn.textContent = t('mvmai_pub_dangerous');
                card.appendChild(warn);
              }
              var q = document.createElement('div');
              q.textContent = t('mvmai_pub_run_q');
              card.appendChild(q);
              var yes = document.createElement('button');
              yes.className = 'mvmai-confirm-yes';
              yes.textContent = t('mvmai_pub_run_yes');
              var no = document.createElement('button');
              no.className = 'mvmai-confirm-no';
              no.textContent = t('mvmai_pub_run_no');
              row.appendChild(yes);
              row.appendChild(no);
              card.appendChild(row);
              scrollDown();
              yes.onclick = function () {
                row.remove();
                exec(true).then(function (result) { resolve(renderResult(result)); });
              };
              no.onclick = function () {
                row.remove();
                var cancelled = document.createElement('div');
                cancelled.textContent = t('mvmai_pub_cancelled');
                card.appendChild(cancelled);
                resolve(t('mvmai_pub_cancelled'));
              };
            });
          }
          return renderResult(data);
        });
      }

      // ── history compaction ─────────────────────────────────────────────────────
      // Once a chat grows past 2x the keep-recent count, fold everything except
      // the most recent `keepRecent` messages into a single running summary, so
      // token cost per message stays bounded instead of re-sending the whole
      // conversation forever. no_persist:true keeps this maintenance call off
      // the visible history, off credit charging, and off the session it
      // belongs to. keepRecent itself defaults to 20 and is only adjustable
      // with a Premium licence (me.compact_keep_recent, resolved server-side
      // in premium/backend.py's resolve_compact_keep_recent).
      function compactKeepRecent() {
        var v = me && me.compact_keep_recent;
        return (typeof v === 'number' && v > 0) ? v : 20;
      }

      function maybeCompact() {
        var keepRecent = compactKeepRecent();
        var nonSummary = history.filter(function (m) { return m.role !== 'summary'; });
        if (nonSummary.length < keepRecent * 2) return;
        var toSummarize = nonSummary.slice(0, nonSummary.length - keepRecent);
        if (!toSummarize.length) return;

        var prevSummary = history.filter(function (m) { return m.role === 'summary'; })[0];
        var prevText = prevSummary ? prevSummary.content : null;
        var historyLines = toSummarize
          .filter(function (m) { return m.role === 'user' || m.role === 'assistant' || m.role === 'tool' || m.role === 'model_switch'; })
          .map(function (m) {
            var label = m.role === 'user' ? 'User' : (m.role === 'assistant' ? 'Assistant' : (m.role === 'model_switch' ? 'Model change' : 'Tool result'));
            return label + ': ' + (m.content || '');
          })
          .join('\n');
        var compactInstruction = prevText
          ? 'Here is the previous summary:\n' + prevText + '\n\nHere is the new conversation to add to it:\n' + historyLines + '\n\nWrite an updated single summary covering everything. Be concise but include key topics, decisions, context, and which run_command/tool calls actually succeeded (with their real results) so that capability is not lost or doubted later.'
          : 'Summarize this conversation concisely. Include key topics, decisions, important context, and which run_command/tool calls actually succeeded (with their real results) so that capability is not lost or doubted later:\n' + historyLines;

        var compactedChat = saveChatContext();
        var lengthBefore = history.length;
        api('/chat', {method: 'POST', body: JSON.stringify({
          messages: [{role: 'user', content: compactInstruction}],
          no_persist: true,
        })}).then(function (data) {
          if (data.__status !== 200 || !data.message || !data.message.content) return;
          // A new message went out meanwhile; summarise after its answer.
          if (chatContext !== compactedChat || sending || history.length !== lengthBefore) return;
          var recent = nonSummary.slice(nonSummary.length - keepRecent);
          history = [{role: 'summary', content: data.message.content}].concat(recent);
          compactedChat.history = history;
          // Match what's actually stored from here on -- the summarized bubbles
          // are gone from the persisted history the moment the next real
          // message is sent, so keep the screen in sync now rather than lie.
          listEl.innerHTML = '';
          recent.forEach(function (m) {
            if (m.role === 'model_switch') addModelSwitchNote(m);
            else if ((m.role === 'user' || m.role === 'assistant') && m.content) addBubble(m.role, m.content, null, m.created_at, null, m.provider_label, m.duration_ms);
          });
          // Rendered after the recent bubbles (even though it summarizes the
          // older ones) so it lands as the newest, bottom-most item -- the
          // user is scrolled to the bottom mid-conversation and should see
          // it without having to scroll up looking for it.
          addCompactedNote(data.message.content);
          scrollDown();
        }).catch(function () {});
      }

      // Messages written while mvmAI is answering wait here, visible above the
      // input: each can be removed, or marked to be shown to the model at its
      // next step without stopping the answer.
      // ── Attachments ──────────────────────────────────────────────────────
      // An administrator's files are uploaded to the server and the message
      // carries their path. Anyone else sends images inside the message and
      // text or PDF text as plain text; originals are kept for their gallery.
      var attachEl = root.querySelector('.mvmai-attach');
      var fileEl = root.querySelector('.mvmai-file');
      var chipsEl = root.querySelector('.mvmai-chips');
      var pending = [];
      var TEXT_EXT = /\.(txt|md|csv|tsv|json|xml|log|html?|ya?ml|ini|conf|js|ts|py|php|sql|sh|css)$/i;
      var MAX_TEXT = 60000, MAX_IMAGES = 6, MAX_FILE = 25 * 1024 * 1024;
      var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

      function pendingImages() {
        return pending.reduce(function (n, p) { return n + (p.images ? p.images.length : 0); }, 0);
      }

      function renderChips() {
        chipsEl.hidden = !pending.length;
        chipsEl.innerHTML = '';
        pending.forEach(function (p) {
          var chip = document.createElement('div');
          chip.className = 'mvmai-chip' + (p.busy ? ' busy' : '');
          chip.innerHTML = '<span></span><button type="button" title="' + esc(t('mvmai_pub_attach_remove')) + '">✕</button>';
          chip.querySelector('span').textContent = '📎 ' + p.name + (p.busy ? ' …' : '');
          // An image shows as a small picture, larger on a click.
          if (p.thumb) {
            var th = makeThumb(p.thumb);
            chip.insertBefore(th, chip.firstChild);
            chip.querySelector('span').textContent = (p.busy ? '… ' : '') + p.name;
          }
          chip.querySelector('button').onclick = function () {
            pending.splice(pending.indexOf(p), 1);
            renderChips();
          };
          chipsEl.appendChild(chip);
        });
      }

      function shrinkImage(file) {
        return new Promise(function (resolve, reject) {
          var url = URL.createObjectURL(file);
          var img = new Image();
          img.onload = function () {
            var scale = Math.min(1, 1600 / Math.max(img.width, img.height));
            var canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
          };
          img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image')); };
          img.src = url;
        });
      }

      function loadPdfJs() {
        if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return Promise.resolve(window.pdfjsLib); }
        return new Promise(function (resolve, reject) {
          var sc = document.createElement('script');
          sc.src = PDFJS;
          sc.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; resolve(window.pdfjsLib); };
          sc.onerror = function () { reject(new Error('pdfjs')); };
          document.head.appendChild(sc);
        });
      }

      // The text of a PDF; a scan with no text becomes its first pages as images.
      function readPdf(file) {
        return Promise.all([loadPdfJs(), file.arrayBuffer()]).then(function (r) {
          return r[0].getDocument({data: r[1]}).promise;
        }).then(function (pdf) {
          var pages = Math.min(pdf.numPages, 40), chain = Promise.resolve([]);
          for (var i = 1; i <= pages; i++) (function (n) {
            chain = chain.then(function (acc) {
              return pdf.getPage(n).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
                acc.push(tc.items.map(function (it) { return it.str; }).join(' '));
                return acc;
              });
            });
          })(i);
          return chain.then(function (texts) {
            var text = texts.join('\n\n').trim();
            if (text.length >= 40 * Math.min(pages, 5)) return {text: text.slice(0, MAX_TEXT)};
            var shots = Promise.resolve([]);
            for (var j = 1; j <= Math.min(pdf.numPages, Math.max(1, MAX_IMAGES - pendingImages())); j++) (function (n) {
              shots = shots.then(function (acc) {
                return pdf.getPage(n).then(function (pg) {
                  var vp = pg.getViewport({scale: 1.6});
                  var canvas = document.createElement('canvas');
                  canvas.width = vp.width; canvas.height = vp.height;
                  return pg.render({canvasContext: canvas.getContext('2d'), viewport: vp}).promise.then(function () {
                    acc.push(canvas.toDataURL('image/jpeg', 0.85));
                    return acc;
                  });
                });
              });
            })(j);
            return shots.then(function (images) { return {images: images}; });
          });
        });
      }

      function addFile(file) {
        var uploadContext = saveChatContext();
        var uploadPending = pending;
        if (file.size > (me.is_admin ? 500 * 1024 * 1024 : MAX_FILE)) { addNote(t('mvmai_pub_attach_big')); return; }
        var item = {name: file.name || 'file', busy: true};
        var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
        var isImage = /^image\/(png|jpeg|webp|gif)$/.test(file.type);
        var jobs = [];
        var inline = null;
        if (isImage) {
          if (pendingImages() >= MAX_IMAGES) { addNote(t('mvmai_pub_attach_limit', {n: MAX_IMAGES})); return; }
          inline = shrinkImage(file).then(function (url) { item.images = [url]; item.thumb = url; });
        } else if (isPdf) {
          inline = readPdf(file).then(function (r) { item.text = r.text; item.images = r.images; });
        } else if (/^text\//.test(file.type) || TEXT_EXT.test(file.name || '')) {
          inline = file.slice(0, MAX_TEXT * 4).text().then(function (txt) { item.text = txt.slice(0, MAX_TEXT); });
        } else if (!me.is_admin) {
          addNote(t('mvmai_pub_attach_type'));
          return;
        }
        if (me.is_admin) {
          // The administrator's file is also kept on the server, so the model can
          // work with the original; what it can read inline reaches it in every mode.
          var headers = {'X-Pub-Token': token, 'X-File-Name': encodeURIComponent(file.name || 'file'),
            'Content-Type': 'application/octet-stream'};
          jobs.push(fetch(API + '/attach', {method: 'POST', headers: headers, body: file}).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (d) {
              if (!r.ok || !d.path) throw new Error(d.error === 'too_big' ? 'big' : 'failed');
              item.uploadId = d.id;
              item.path = d.path;
              item.dir = d.dir || '';
            });
          }));
          // A file that cannot be read inline still goes up; a failed reading must not block it.
          if (inline) jobs.push(inline.catch(function () {}));
        } else {
          jobs.push(inline);
          // Kept only for the gallery; the model gets the file inside the message.
          jobs.push(fetch(API + '/attach', {method: 'POST', headers: {'X-Pub-Token': token, 'X-File-Name': encodeURIComponent(file.name || 'file'),
            'Content-Type': 'application/octet-stream'}, body: file}).then(function (r) {
              return r.json().then(function (d) { if (r.ok) item.uploadId = d.id; });
            }).catch(function () {}));
        }
        var job = Promise.all(jobs);
        uploadPending.push(item);
        if (pending === uploadPending) renderChips();
        job.then(function () { item.busy = false; if (pending === uploadPending) renderChips(); }).catch(function (e) {
          uploadPending.splice(uploadPending.indexOf(item), 1);
          if (pending === uploadPending) renderChips();
          addNote(t(e && e.message === 'big' ? 'mvmai_pub_attach_big' : 'mvmai_pub_attach_failed'), uploadContext);
        });
      }

      // The message as the model gets it (content, images) and as the user sees it (shown).
      function buildMessage(text, att) {
        var content = text, shown = text, images = [], thumbs = [], attachmentIds = [];
        att.forEach(function (a) {
          if (a.uploadId) attachmentIds.push(a.uploadId);
          if (a.thumb) thumbs.push(a.thumb);
          shown += (shown ? '\n' : '') + '📎 ' + a.name;
          if (a.path) content += '\n\n[Attached file saved on the server: ' + a.path + ']';
          if (a.dir) content += '\n[It is an archive; its contents were unpacked to: ' + a.dir + ']';
          if (a.text) content += '\n\n[Attached file: ' + a.name + ']\n' + a.text + '\n[End of attached file]';
          if (a.images && a.images.length) {
            images = images.concat(a.images);
            content += '\n\n[Attached ' + (a.images.length > 1 ? a.images.length + ' images' : 'image') + ': ' + a.name + ']';
          }
        });
        return {content: content.trim(), shown: shown, images: images, thumbs: thumbs, attachmentIds: attachmentIds};
      }

      attachEl.onclick = function () { fileEl.click(); };
      fileEl.onchange = function () {
        Array.prototype.forEach.call(fileEl.files, addFile);
        fileEl.value = '';
      };
      inputEl.addEventListener('paste', function (e) {
        var files = (e.clipboardData && e.clipboardData.files) || [];
        if (!files.length) return;
        e.preventDefault();
        Array.prototype.forEach.call(files, addFile);
      });

      var queue = [];
      var turn = null;
      var chatContexts = Object.create(null), chatContext = null, viewVersion = 0;

      function saveChatContext() {
        if (!chatContext) chatContext = {listEl: listEl};
        Object.assign(chatContext, {history: history, sessionId: sessionId, sending: sending, turn: turn,
          queue: queue, activeProject: activeProject, archivedSession: archivedSession,
          chatLabel: chatLabel, chatProvider: chatProvider, chatModel: chatModel,
          newProjectModel: newProjectModel, chosenApp: chosenApp, pending: pending, draft: inputEl.value});
        if (sessionId) chatContexts[sessionId] = chatContext;
        return chatContext;
      }
      function syncChatContext(ctx) {
        if (chatContext !== ctx) return;
        history = ctx.history; sessionId = ctx.sessionId; queue = ctx.queue;
        turn = ctx.turn; sending = ctx.sending; archivedSession = ctx.archivedSession;
        chatLabel = ctx.chatLabel; chatProvider = ctx.chatProvider; chatModel = ctx.chatModel;
        newProjectModel = ctx.newProjectModel;
        stopEl.hidden = !sending;
        refreshComposer(); renderQueue();
      }
      function newChatView() {
        saveChatContext(); viewVersion++;
        var nextList = listEl.cloneNode(false);
        listEl.replaceWith(nextList); listEl = nextList;
        chatContext = {listEl: nextList};
        queue = []; turn = null; pending = []; inputEl.value = ''; sending = false;
        stopEl.hidden = true; renderQueue(); renderChips();
      }
      function restoreChatContext(ctx) {
        saveChatContext();
        listEl.replaceWith(ctx.listEl); listEl = ctx.listEl; chatContext = ctx;
        activeProject = ctx.activeProject; chosenApp = ctx.chosenApp;
        pending = ctx.pending || []; inputEl.value = ctx.draft || '';
        syncChatContext(ctx); renderChips(); paintAppBtn();
      }


      function renderQueue() {
        queueEl.hidden = !queue.length;
        queueEl.innerHTML = queue.length ? '<div class="mvmai-queue-head">' + esc(t('mvmai_pub_queued')) + '</div>' : '';
        queue.forEach(function (q) {
          var item = document.createElement('div');
          item.className = 'mvmai-queue-item' + (q.urgent ? ' urgent' : '');
          item.innerHTML = '<span class="mvmai-queue-text"></span>' +
            (q.urgent ? '<span class="mvmai-queue-head">' + esc(t('mvmai_pub_queue_next_step')) + '</span>'
              : '<button type="button" class="mvmai-queue-now">' + esc(t('mvmai_pub_queue_now')) + '</button>') +
            '<button type="button" class="mvmai-queue-del" title="' + esc(t('mvmai_pub_queue_remove')) + '">✕</button>';
          item.querySelector('.mvmai-queue-text').textContent = q.text;
          item.querySelector('.mvmai-queue-text').title = q.text;
          var now = item.querySelector('.mvmai-queue-now');
          if (now) now.onclick = function () {
            var index = queue.indexOf(q);
            if (index < 0) return;
            queue.splice(index, 1);
            queue.unshift(q);
            if (turn) stopTurn(); else finishTurn();
          };
          item.querySelector('.mvmai-queue-del').onclick = function () {
            queue.splice(queue.indexOf(q), 1);
            renderQueue();
          };
          queueEl.appendChild(item);
        });
      }

      // Ends the answer: the next waiting message, if any, is sent on its own.
      function finishTurn(ctx) {
        ctx = ctx || saveChatContext();
        if (ctx.turn && ctx.turn.activityCleanup) ctx.turn.activityCleanup();
        if (ctx.turn && ctx.turn.sidebarCanvas) ctx.turn.sidebarCanvas.remove();
        ctx.turn = null; ctx.sending = false;
        syncChatContext(ctx);
        refreshSessionList();
        if (ctx === chatContext && !ctx.queue.length && !ctx.archivedSession) maybeCompact();
        if (ctx.queue.length) {
          var next = ctx.queue.shift();
          if (ctx === chatContext) renderQueue();
          sendText(next.msg, ctx);
        }
      }

      function stopTurn() {
        if (!turn) return;
        var current = turn;
        current.stopped = true;
        if (current.controller) current.controller.abort();
        if (current.typing) current.typing.remove();
        api('/stop', {method: 'POST', body: JSON.stringify({turn_id: current.id})}).catch(function () {});
        // Forms still waiting for a decision can no longer be saved.
        listEl.querySelectorAll('.mvmai-review .mvmai-confirm-row').forEach(function (row) {
          var card = row.closest('.mvmai-review');
          card.querySelectorAll('input,select,textarea').forEach(function (el) { el.disabled = true; });
          row.remove();
        });
        // Every tool call needs an answer before the conversation goes on.
        for (var i = history.length - 1; i >= 0 && history[i].role !== 'user'; i--) {
          var m = history[i];
          if (m.role === 'assistant' && m.tool_calls) {
            var answered = history.slice(i + 1).map(function (x) { return x.tool_call_id; });
            m.tool_calls.forEach(function (tc) {
              if (answered.indexOf(tc.id) < 0) {
                history.push({role: 'tool', tool_call_id: tc.id, content: JSON.stringify({
                  stopped: true, note: 'The user stopped waiting for this tool. An in-flight change may already have been saved; check the app before retrying.'
                })});
              }
            });
            break;
          }
        }
        addNote(t('mvmai_pub_stopped'));
        finishTurn();
      }

      function send() {
        if (archivedSession) return;
        if (me.is_admin && activeProject && !sessionId && !newProjectModel) {
          chooseProjectModel();
          return;
        }
        if (pending.some(function (p) { return p.busy; })) return;
        var text = inputEl.value.trim();
        if (!text && !pending.length) return;
        var msg = buildMessage(text, pending);
        pending = [];
        renderChips();
        inputEl.value = '';
        inputEl.style.height = 'auto';
        if (sending) {
          queue.push({text: msg.shown, msg: msg, urgent: false});
          renderQueue();
          return;
        }
        sendText(msg);
      }

      function sendText(msg, ctx) {
        ctx = ctx || saveChatContext();
        ctx.sending = true;
        var history = ctx.history, queue = ctx.queue;
        var current = ctx.turn = {id: Math.random().toString(36).slice(2) + Date.now().toString(36), stopped: false, startedAt: Date.now()};
        syncChatContext(ctx);
        var sentAt = Math.floor(Date.now() / 1000);
        addBubble('user', msg.shown, msg.thumbs, sentAt, ctx);
        history.push({role: 'user', content: msg.content, attachment_ids: msg.attachmentIds, images: msg.images.length ? msg.images : undefined, created_at: sentAt});

        function step() {
          if (current.stopped) return;
          // Waiting messages marked to be sent now join the answer here,
          // between two of its steps.
          queue.filter(function (q) { return q.urgent; }).forEach(function (q) {
            queue.splice(queue.indexOf(q), 1);
            var queuedAt = Math.floor(Date.now() / 1000);
            addBubble('user', q.msg.shown, q.msg.thumbs, queuedAt, ctx);
            history.push({role: 'user', content: q.msg.content, attachment_ids: q.msg.attachmentIds, images: q.msg.images.length ? q.msg.images : undefined, created_at: queuedAt});
          });
          if (ctx === chatContext) renderQueue();
          var typing = current.typing = addTyping(ctx);
          current.controller = window.AbortController ? new AbortController() : null;
          // A new chat gets its id here, so it is saved and listed at once
          // instead of after the answer.
          if (!ctx.sessionId) {
            var rnd = new Uint8Array(16);
            (window.crypto || {getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }}).getRandomValues(rnd);
            ctx.sessionId = Array.prototype.map.call(rnd, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
            chatContexts[ctx.sessionId] = ctx;
            syncChatContext(ctx);
            if (ctx === chatContext && termPanel) termPanel.setChat(ctx.sessionId, true);
          }
          setTimeout(function () { refreshSessionList(); if (me.is_admin) loadProjects(); }, 1500);
          function awaitTurn(data) {
            typing.updateActivity(data);
            if (data.__status !== 202 || !data.pending) return Promise.resolve(data);
            return new Promise(function (resolve) { setTimeout(resolve, 2000); }).then(function () {
              if (current.stopped) return {error: 'stopped'};
              return api('/chat/turn/' + encodeURIComponent(current.id),
                {signal: current.controller ? current.controller.signal : undefined});
            }).then(awaitTurn);
          }
          api('/chat', {method: 'POST', signal: current.controller ? current.controller.signal : undefined,
            body: JSON.stringify({messages: history, session_id: ctx.sessionId, project_id: ctx.activeProject ? ctx.activeProject.id : null,
              project_model: ctx.newProjectModel && history.length === 1 ? {provider: ctx.newProjectModel.provider, model: ctx.newProjectModel.model} : null,
              app_id: ctx.chosenApp ? ctx.chosenApp.id : null, turn_id: current.id, lang: uiLang(),
              elapsed_ms: Math.max(0, Date.now() - current.startedAt)})}).then(awaitTurn).then(function (data) {
            if (current.stopped) return;
            typing.remove();
            // The model has seen the images; they are not sent again.
            history.forEach(function (m) { delete m.images; });
            // A malformed response has no useful HTTP error code to display.
            if (data.__status !== 200 || data.error || !data.message) {
              if (data.error === 'archived') {
                ctx.queue = [];
                ctx.archivedSession = true;
                finishTurn(ctx);
                if (ctx === chatContext && ctx.sessionId) openSession(ctx.sessionId);
                return;
              }
              var key = data.error === 'insufficient_credits' ? 'mvmai_pub_insufficient_credits'
                : (data.__status === 401 ? 'mvmai_pub_unauthorized' : null);
              addNote(data.__invalidResponse ? t('mvmai_pub_err')
                : (key ? t(key) : (t('mvmai_pub_err') + ': ' + (data.error || data.__status))), ctx);
              if (data.images) addNote(t('mvmai_pub_images_failed'), ctx);
              finishTurn(ctx);
              return;
            }
            if (data.session_id) { ctx.sessionId = data.session_id; chatContexts[ctx.sessionId] = ctx; }
            if (data.provider_label) {
              ctx.chatLabel = data.provider_label; ctx.chatProvider = data.provider || null; ctx.chatModel = data.model || null;
              ctx.newProjectModel = null;
              if (ctx === chatContext) updateUsage(true);
            }
            syncChatContext(ctx);
            var msg = data.message;
            history.push(msg);
            if (msg.content) addBubble('assistant', msg.content, null, msg.created_at, ctx, null, msg.duration_ms);

            if (msg.tool_calls && msg.tool_calls.length) {
              runToolCalls(msg.tool_calls, ctx).then(function (toolMsgs) {
                if (current.stopped) return;
                toolMsgs.forEach(function (tm) { history.push(tm); });
                step();
              });
            } else {
              finishTurn(ctx);
            }
          }).catch(function () {
            if (current.stopped) return;
            typing.remove();
            addNote(t('mvmai_pub_err'), ctx);
            finishTurn(ctx);
          });
        }
        // Settings can change while this widget remains mounted in the
        // desktop app. Refresh the admin/provider metadata before the turn so
        // the response label reflects the provider the backend will actually
        // read from the database for this request.
        refreshProviderMetadata().then(function () { step(); }).catch(function () { step(); });
      }

      stopEl.onclick = stopTurn;
      sendEl.onclick = send;
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      });
      inputEl.addEventListener('input', function () {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 128) + 'px';
      });
    }

    return { destroy: function () {
      clearInterval(projectPoll); clearInterval(providerPoll); clearInterval(usagePoll); clearTimeout(titleRefreshTimer);
      if (sessionMenuCleanup) sessionMenuCleanup();
      if (isDesktop) window.removeEventListener('settings-changed', refreshMessageTimes);
      if (termPanel) termPanel.destroy();
    } };
  }

  window.MvmaiWidget = { mount: mount };
})();
