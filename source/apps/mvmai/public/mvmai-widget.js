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

  function highlightedCode(value, language) {
    var lang = String(language || 'text').toLowerCase();
    var code = String(value == null ? '' : value);
    if (lang === 'diff' || lang === 'patch') return code.split('\n').map(function (line) {
      var cls = line.startsWith('@@') ? 'hunk' : line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : '';
      return '<span class="mvmai-diff-' + cls + '">' + esc(line) + '</span>';
    }).join('\n');
    if (!/^(js|javascript|jsx|ts|typescript|tsx|json|py|python|bash|sh|shell|sql|css|html|xml|php|c|cpp|java|go|rust|rb|ruby|yaml|yml)$/.test(lang)) return esc(code);
    var token = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|\b(?:const|let|var|function|return|if|else|for|while|class|new|await|async|import|export|from|def|print|try|except|raise|with|as|pass|in|is|not|and|or|None|True|False|true|false|null|undefined|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|TABLE|echo|fi|then|do|done|sudo)\b|\b\d+(?:\.\d+)?\b)/g;
    var result = '', cursor = 0, match;
    while ((match = token.exec(code))) {
      result += esc(code.slice(cursor, match.index));
      var text = match[0], cls = /^['"`]/.test(text) ? 'string' : /^(\/\/|\/\*|#)/.test(text) ? 'comment' : /^\d/.test(text) ? 'number' : 'keyword';
      result += '<span class="mvmai-code-' + cls + '">' + esc(text) + '</span>'; cursor = token.lastIndex;
    }
    return result + esc(code.slice(cursor));
  }

  function codeBlock(code, language) {
    return '<pre class="mvmai-code-block"><code>' + highlightedCode(code, language) + '</code></pre>';
  }

  function nl2br(value) {
    var source = String(value == null ? '' : value), pattern = /```([\w+-]*)[^\S\n]*\n([\s\S]*?)(?:```|$)/g;
    var result = '', cursor = 0, match;
    while ((match = pattern.exec(source))) {
      result += esc(source.slice(cursor, match.index)).replace(/\n/g, '<br>');
      result += codeBlock(match[2], match[1]); cursor = pattern.lastIndex;
    }
    return result + esc(source.slice(cursor)).replace(/\n/g, '<br>');
  }

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.textContent = `
      .mvmai-code-block{background:#151922;color:#d9e2f1;text-align:left;padding:12px;border:1px solid #45475a;border-radius:7px;white-space:pre;overflow:auto;max-height:440px;max-width:100%;font:12px/1.6 ui-monospace,monospace;margin:8px 0}.mvmai-code-keyword{color:#cba6f7}.mvmai-code-string{color:#a6e3a1}.mvmai-code-number{color:#fab387}.mvmai-code-comment{color:#94a3b8}.mvmai-diff-add{color:#b5f2c1;background:#1c3c2a;display:inline-block;min-width:100%}.mvmai-diff-del{color:#ffbdc5;background:#48252e;display:inline-block;min-width:100%}.mvmai-diff-hunk{color:#91caff}.mvmai-git-file{display:block;max-width:100%;overflow-wrap:anywhere;background:none;border:0;color:var(--pub-accent,#89b4fa);text-align:left;cursor:pointer;padding:5px 0;font:12px ui-monospace,monospace}.mvmai-diff-dialog .mvmai-pub-dialog{width:min(1100px,96vw);max-width:96vw;max-height:90vh}.mvmai-diff-dialog .mvmai-code-block{max-height:65vh}.mvmai-diff-content{min-height:0;overflow:auto}.mvmai-diff-title{overflow-wrap:anywhere}.mvmai-live-preview{min-width:0;text-align:left!important}.mvmai-live-row{min-width:0}.mvmai-live-tool>summary{display:flex;align-items:center;gap:8px;list-style:none;cursor:pointer;min-width:0}.mvmai-live-tool>summary::-webkit-details-marker{display:none}.mvmai-live-tool>summary::before{content:'▸';flex-shrink:0}.mvmai-live-tool[open]>summary::before{content:'▾'}.mvmai-live-tool-status{font-size:.7rem;color:var(--pub-dim,#94a3b8);flex-shrink:0}.mvmai-live-tool-summary{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;font:12px/1.5 ui-monospace,monospace;color:var(--pub-fg,#cdd6f4)}.mvmai-live-stream{display:flex;flex-direction:column;gap:.7rem;flex-shrink:0;width:100%;min-width:0}.mvmai-live-row{flex-shrink:0;animation:mvmai-live-enter .2s ease-out}.mvmai-live-archive{display:flex;flex-direction:column;gap:.7rem;margin-top:.7rem}.mvmai-git-plus{color:color-mix(in srgb,#a6e3a1 35%,var(--pub-fg,var(--text,#cdd6f4)));font-weight:700}.mvmai-git-minus{color:color-mix(in srgb,#f38ba8 35%,var(--pub-fg,var(--text,#cdd6f4)));font-weight:700}@keyframes mvmai-live-enter{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.mvmai-live-row{animation:none}}
      .mvmai-widget,.mvmai-widget *{box-sizing:border-box}
      .mvmai-widget{height:100%;width:100%;display:flex;flex-direction:column;background:var(--pub-bg,#1e1e2e);
        color:var(--pub-fg,#cdd6f4);font-family:system-ui,sans-serif;overflow:hidden;position:relative}
      .mvmai-chat-col{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
      /* Desktop mvmOS window: persistent side-by-side sidebar, never an off-canvas
         overlay — unlike the public page, which stays a mobile-style slide-over. */
      .mvmai-widget.mvmai-desktop{flex-direction:row;--pub-accent:var(--accent,#89b4fa);--pub-on-accent:var(--on-accent,#1e1e2e)}
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
        background:var(--pub-accent,#89b4fa);color:var(--pub-on-accent,var(--pub-surface1,#1e1e2e));white-space:nowrap}
      .mvmai-price{margin-left:auto;font-size:.72rem;color:var(--pub-dim,#6c7086);white-space:nowrap}
      .mvmai-list{flex:1;min-height:0;overflow-y:auto;padding:.9rem;display:flex;flex-direction:column;gap:.7rem}
      .mvmai-start{margin:auto;display:flex;flex-direction:column;align-items:center;gap:.9rem;padding:1rem;width:100%;max-width:26rem}
      .mvmai-start-title{font-weight:600;font-size:1rem;color:var(--pub-fg,#cdd6f4)}
      .mvmai-start-new{border:0;border-radius:.6rem;padding:.55rem 1.3rem;font:inherit;font-size:.9rem;font-weight:600;cursor:pointer;
        background:var(--pub-accent,#89b4fa);color:var(--pub-on-accent,var(--pub-surface1,#1e1e2e))}
      .mvmai-start-new:hover{filter:brightness(1.08)}
      .mvmai-start-list{display:flex;flex-direction:column;gap:.15rem;width:100%;text-align:left}
      .mvmai-start-empty{color:var(--pub-fg2,#a6adc8);font-size:.8rem;text-align:center}
      .mvmai-welcome{color:var(--pub-fg2,#a6adc8);font-size:.85rem;text-align:center;margin:auto;padding:1rem}
      .mvmai-widget .mvmai-msg{display:block;max-width:85%;padding:.55rem .75rem;border-radius:.7rem;font-size:.88rem;line-height:1.45;
        overflow-wrap:anywhere;white-space:normal;user-select:text;-webkit-user-select:text}
      .mvmai-msg.user{align-self:flex-end;background:var(--pub-accent,#89b4fa);color:var(--pub-on-accent,var(--pub-surface1,#1e1e2e))}
      .mvmai-msg.assistant{align-self:flex-start;background:var(--pub-surface2,#313244)}
      .mvmai-msg-meta{display:flex;flex-wrap:wrap;gap:.2rem .55rem;margin-top:.45rem;padding-top:.35rem;
        border-top:1px solid var(--pub-border,rgba(255,255,255,.09));color:var(--pub-dim,#6c7086);
        font-size:.68rem;line-height:1.2;min-width:0}
      .mvmai-msg.user .mvmai-msg-meta{color:inherit;border-top-color:currentColor}
      .mvmai-msg.user a{color:inherit}
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
      .mvmai-confirm-yes{background:var(--pub-accent,#89b4fa);color:var(--pub-on-accent,var(--pub-surface1,#1e1e2e))}
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
      .mvmai-chat-col{position:relative}
      .mvmai-whereami{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem .7rem;padding:.35rem .9rem;flex-shrink:0;font-size:.76rem;
        background:var(--pub-surface1,#181825);border-bottom:1px solid var(--pub-border,#45475a);color:var(--pub-fg2,#a6adc8)}
      .mvmai-whereami[hidden]{display:none}
      .mvmai-whereami b{color:var(--pub-fg,#cdd6f4)}
      .mvmai-whereami .mvmai-where-path{color:var(--pub-dim,#6c7086);overflow-wrap:anywhere}
      .mvmai-branch-warn{display:inline-flex;align-items:center;justify-content:center;width:1.1rem;height:1.1rem;border-radius:50%;
        background:var(--pub-warn,#f9e2af);color:#1e1e2e;font-weight:800;font-size:.72rem;cursor:pointer;border:0;padding:0}
      .mvmai-branch-pop{position:absolute;z-index:45;width:260px;max-width:calc(100% - 1.2rem);padding:.6rem .7rem;border-radius:10px;font-size:.78rem;
        background:var(--pub-surface1,#181825);border:1px solid var(--pub-border,#45475a);color:var(--pub-fg2,#a6adc8);box-shadow:0 8px 24px rgba(0,0,0,.35);
        display:flex;flex-direction:column;gap:.45rem}
      .mvmai-branch-pop-btn{align-self:flex-start;border:0;border-radius:8px;padding:.35rem .6rem;cursor:pointer;font-size:.8rem;
        background:var(--pub-accent,#89b4fa);color:var(--pub-on-accent,var(--pub-surface1,#1e1e2e))}
      .mvmai-branch-label{font-size:.78rem;color:var(--pub-dim,#6c7086);margin:.55rem 0 .25rem}
      .mvmai-branch-search{width:100%;box-sizing:border-box;padding:.4rem .5rem;border-radius:8px;border:1px solid var(--pub-border,#45475a);
        background:var(--pub-surface2,#11111b);color:var(--pub-fg,#cdd6f4);font:inherit;font-size:.82rem}
      .mvmai-branch-list{max-height:9rem;overflow-y:auto;margin-top:.3rem;border:1px solid var(--pub-border,#45475a);border-radius:8px}
      .mvmai-branch-item{display:block;width:100%;text-align:left;border:0;background:transparent;color:var(--pub-fg,#cdd6f4);padding:.35rem .55rem;cursor:pointer;font:inherit;font-size:.8rem}
      .mvmai-branch-item:hover{background:var(--pub-border,#45475a)}
      .mvmai-branch-item.active{background:var(--pub-accent,#89b4fa);color:var(--pub-on-accent,var(--pub-surface1,#1e1e2e))}
      .mvmai-branch-item.none{font-style:italic}
      .mvmai-branch-mode{width:100%;margin-top:.25rem;padding:.3rem;border-radius:6px;border:1px solid var(--pub-border,#45475a);background:var(--pub-surface2,#11111b);color:var(--pub-fg,#cdd6f4);font:inherit;font-size:.78rem}
      .mvmai-msg-place{font-size:.72rem;color:var(--pub-dim,#6c7086);margin:0 0 .35rem;font-weight:600}
      .mvmai-toolbar-section{flex-shrink:0}
      .mvmai-toolbar-section[hidden]{display:none}
      .mvmai-section-select{background:var(--pub-surface2,#313244);color:inherit;border:1px solid var(--pub-border,#45475a);border-radius:.4rem;padding:.15rem .4rem;font:inherit;max-width:12rem}
      .mvmai-proj-editor{position:absolute;inset:0;z-index:40;display:flex;flex-direction:column;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);min-height:0}
      .mvmai-proj-editor-head{display:flex;align-items:center;gap:.7rem;padding:.7rem .9rem;border-bottom:1px solid var(--pub-border,#45475a);flex-shrink:0}
      .mvmai-proj-editor-head button{background:none;border:0;color:inherit;font-size:1.1rem;cursor:pointer;padding:.2rem .4rem}
      .mvmai-proj-editor-title{font-weight:700;font-size:1rem}
      .mvmai-proj-editor-body{flex:1;min-height:0;overflow:auto;padding:1rem .9rem 1.5rem;display:flex;flex-direction:column;gap:1.1rem}
      .mvmai-proj-editor-col{width:100%;max-width:56rem;margin:0 auto;display:flex;flex-direction:column;gap:1.1rem}
      .mvmai-proj-box{border:1px solid var(--pub-border,#45475a);border-radius:.6rem;padding:.9rem;display:flex;flex-direction:column;gap:.55rem;background:var(--pub-surface1,#181825)}
      .mvmai-proj-box h3{margin:0;font-size:.95rem}
      .mvmai-proj-box input[type=text],.mvmai-proj-box textarea{width:100%;box-sizing:border-box;background:var(--pub-surface2,#313244);color:inherit;border:1px solid var(--pub-border,#45475a);border-radius:.4rem;padding:.5rem .6rem;font:inherit}
      .mvmai-proj-box textarea{resize:vertical;min-height:5rem}
      .mvmai-proj-row{display:flex;gap:.4rem;align-items:center}
      .mvmai-proj-row input{flex:1;min-width:0}
      .mvmai-proj-row button,.mvmai-proj-editor-foot button,.mvmai-proj-add{background:var(--pub-border,#45475a);color:inherit;border:0;border-radius:.4rem;padding:.45rem .8rem;cursor:pointer;font:inherit;flex-shrink:0}
      .mvmai-proj-sec-head{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
      .mvmai-proj-sec-head input[type=text]{flex:1;min-width:10rem;font-weight:600}
      .mvmai-proj-sec-default{display:flex;align-items:center;gap:.35rem;font-size:.8rem;white-space:nowrap;cursor:pointer}
      .mvmai-proj-editor-foot{display:flex;justify-content:flex-end;gap:.6rem;padding:.7rem .9rem;border-top:1px solid var(--pub-border,#45475a);flex-shrink:0}
      .mvmai-proj-editor-foot .mvmai-proj-save{background:var(--pub-accent,#89b4fa);color:var(--on-accent,#11111b);font-weight:600}
      .mvmai-sec-remove{margin-left:auto;background:transparent;color:var(--pub-danger,#e0435f);border:1px solid currentColor;border-radius:.4rem;padding:.35rem .7rem;font:inherit;font-size:.8rem;cursor:pointer;white-space:nowrap}
      .mvmai-sec-remove:hover{background:color-mix(in srgb,var(--pub-danger,#e0435f) 14%,transparent)}
      .mvmai-sec-remove:focus-visible{outline:2px solid var(--pub-danger,#e0435f);outline-offset:2px}
      .mvmai-proj-lbl{font-size:.78rem;font-weight:600;color:var(--pub-fg2,#a6adc8);margin-top:.15rem}
      .mvmai-proj-err{color:var(--pub-danger,#f38ba8);font-size:.85rem}
      .mvmai-proj-err[hidden]{display:none}
      .mvmai-input{flex:1;resize:none;min-height:2.3rem;max-height:8rem;background:var(--pub-surface2,#313244);
        color:var(--pub-fg,#cdd6f4);border:1px solid var(--pub-border,#45475a);border-radius:.5rem;
        padding:.5rem .65rem;font:inherit;font-size:.88rem;outline:none}
      .mvmai-send{background:var(--pub-accent,#89b4fa);color:var(--pub-on-accent,var(--pub-surface1,#1e1e2e));border:0;border-radius:.5rem;
        padding:0 1rem;font-weight:700;cursor:pointer;font-size:.88rem}
      .mvmai-send:disabled{opacity:.5;cursor:default}
      .mva-chat-mode,.mva-agent-mode{cursor:pointer}
      .mvmai-thumbs{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.4rem}
      .mvmai-thumb{height:64px;max-width:120px;border-radius:.4rem;object-fit:cover;cursor:zoom-in;
        border:1px solid var(--pub-border,#45475a);background:var(--pub-surface2,#313244)}
      .mvmai-thumb.mvmai-genimg{display:block;height:auto;max-height:280px;max-width:100%;object-fit:contain}
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
      .mvmai-gal-tabs button.on{background:var(--pub-accent,#89b4fa);color:var(--pub-on-accent,var(--pub-surface1,#1e1e2e));border-color:transparent;font-weight:700}
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
        background:var(--pub-red,#f38ba8);color:var(--pub-surface1,#1e1e2e);font-size:.95rem;font-weight:700}
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
      .mvmai-sidebar-toolbar{display:flex;align-items:center;gap:.3rem;padding:.3rem .55rem;
        border-top:1px solid var(--pub-border,#45475a);flex-shrink:0}
      .mvmai-toolbar-branch{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mvmai-toolbar-branch .mvmai-sidebar-filetree-branch{padding:0}
      .mvmai-archive-link,.mvmai-filetree-link{background:none;border:1px solid transparent;border-radius:.4rem;
        color:var(--pub-fg2,#a6adc8);cursor:pointer;font:inherit;font-size:.78rem;padding:.2rem .4rem;white-space:nowrap}
      .mvmai-archive-link:hover,.mvmai-filetree-link:hover,.mvmai-archive-link.active,.mvmai-filetree-link.active{
        background:var(--pub-surface2,#313244);border-color:var(--pub-border,#45475a)}
      .mvmai-archive-actions{padding:0 .55rem;flex-shrink:0}
      .mvmai-archive-delete-all{background:none;border:0;color:var(--pub-red,#f38ba8);cursor:pointer;font:inherit;
        font-size:.78rem;padding:.2rem .1rem;text-align:left}
      .mvmai-archive-delete-all:hover{text-decoration:underline}
      .mvmai-archive-list{max-height:38%;overflow-y:auto;padding:.2rem .4rem .5rem;flex-shrink:0}
      .mvmai-archive-list[hidden]{display:none}
      .mvmai-filetree-nav[hidden]{display:none}
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
      .mvmai-session-project,.mvmai-archive-project{display:block;margin-top:.1rem;font-size:.68rem;font-weight:600;color:var(--pub-accent,#89b4fa);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
      .mvmai-exec-btn.auto{background:var(--pub-accent,#89b4fa);color:var(--pub-on-accent,var(--pub-surface1,#1e1e2e));border-color:var(--pub-accent,#89b4fa)}
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
        background:var(--pub-accent,#89b4fa);color:var(--pub-on-accent,var(--pub-surface1,#1e1e2e));font-size:.9rem;font-weight:700;
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
      .mvmai-branch-ask .mvmai-pub-dialog{width:min(90vw,380px);max-width:none;padding:1.25rem;gap:1rem;border-radius:.9rem;box-shadow:0 20px 60px rgba(0,0,0,.3)}
      .mvmai-branch-ask .mvmai-pub-dialog-title{font-size:1.05rem;line-height:1.35}
      .mvmai-branch-ask-rows{display:flex;flex-direction:column;gap:.45rem}
      .mvmai-branch-ask-row{display:flex;flex-direction:column;gap:.2rem;padding:.55rem .7rem;border-radius:.55rem;background:var(--pub-surface2,#313244)}
      .mvmai-branch-ask-label{font-size:.72rem;color:var(--pub-dim,#6c7086)}
      .mvmai-branch-ask-name{font:600 .88rem ui-monospace,monospace;overflow-wrap:anywhere;color:var(--pub-fg,#cdd6f4)}
      .mvmai-branch-ask .mvmai-pub-dialog-actions{flex-direction:column}
      .mvmai-branch-ask .mvmai-pub-dialog-actions button{width:100%;min-height:2.6rem;border:0;border-radius:.6rem;font:inherit;font-size:.88rem;font-weight:700;cursor:pointer;overflow-wrap:anywhere}
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
    var viewScope = 'all';      // what the sidebar lists: 'all' chats (home), 'none' (chats without a project) or 'project'
    var sessionsCache = [];
    var projectPoll = null;
    var providerPoll = null;
    var usagePoll = null;
    var titleRefreshTimer = null;
    var termPanel = null;    // the Premium terminal panel, once made
    var termLoading = null;
    var agentPanel = null;
    var agentMode = false;
    var agentModeSync = function () {};
    var sessionMenuCleanup = null;
    var openChatCleanup = null;
    var reviewCleanups = new Set();

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
                <div class="mvmai-exec-mode-label" style="margin-top:.6rem">${esc(t('mvmai_pub_branch_mode_label'))}</div>
                <select class="mvmai-branch-mode">
                  <option value="ask">${esc(t('mvmai_pub_branch_mode_ask'))}</option>
                  <option value="auto">${esc(t('mvmai_pub_branch_mode_auto'))}</option>
                  <option value="none">${esc(t('mvmai_pub_branch_mode_none'))}</option>
                </select>
              </div>
            </div>` : ''}
          </div>
          <div class="mvmai-sidebar-project-header" hidden>
            <button class="mvmai-sidebar-back" type="button">← ${esc(t('mvmai_pub_all_chats'))}</button>
            <span class="mvmai-sidebar-project-title"></span>
          </div>
          <div class="mvmai-sidebar-list"></div>
          <div class="mvmai-sidebar-toolbar">
            <select class="mvmai-section-select mvmai-toolbar-section" hidden></select>
            <span class="mvmai-toolbar-branch"></span>
            <div class="mvmai-filetree-nav" hidden><button class="mvmai-filetree-link" type="button" aria-expanded="false"></button></div>
            <div class="mvmai-archive-nav"><button class="mvmai-archive-link" type="button" aria-expanded="false"></button></div>
          </div>
          <div class="mvmai-archive-actions"><button class="mvmai-archive-delete-all" type="button" hidden>${esc(t('mvmai_pub_delete_all_archived'))}</button></div>
          <div class="mvmai-archive-list" hidden></div>
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
          <div class="mvmai-whereami" hidden></div>
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

      // Switching mode preserves the mounted chat, its draft and any running turn.
      var chatShell = root.querySelector('.mvmai-widget');
      var modes = document.createElement('div');
      modes.style.cssText = 'display:none;align-items:center;gap:8px;padding:8px 12px;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);border-bottom:1px solid var(--pub-border,#45475a);flex-shrink:0;font:13px system-ui';
      modes.innerHTML = '<button type="button" class="mva-chat-mode"></button><button type="button" class="mva-agent-mode"></button>';
      modes.querySelector('.mva-chat-mode').textContent = t('mvmai_agent_chats');
      modes.querySelector('.mva-agent-mode').textContent = 'mvmAgent';
      modes.querySelectorAll('button').forEach(function (b) { b.style.cssText = 'font:inherit;cursor:pointer;border:1px solid var(--pub-border,#45475a);border-radius:6px;padding:6px 12px;background:var(--pub-card,#313244);color:inherit'; });
      var agentsRoot = document.createElement('div');
      agentsRoot.style.cssText = 'flex:1;min-height:0;position:relative;display:none';
      root.style.display = 'flex'; root.style.flexDirection = 'column';
      chatShell.style.flex = '1'; chatShell.style.minHeight = '0'; chatShell.style.height = 'auto';
      root.prepend(modes); root.appendChild(agentsRoot);
      function setAgentMode(value) {
        agentMode = value;
        chatShell.style.display = value ? 'none' : '';
        agentsRoot.style.display = value ? '' : 'none';
        modes.querySelector('.mva-chat-mode').setAttribute('aria-pressed', String(!value));
        modes.querySelector('.mva-agent-mode').setAttribute('aria-pressed', String(value));
        if (agentPanel) agentPanel.show(value);
      }
      agentModeSync = function () {
        var shown = me.is_admin && (me.agents || (isDesktop && !me.bridge_premium));
        modes.style.display = shown ? 'flex' : 'none';
        if (!me.agents && agentMode) {
          setAgentMode(false);
          if (agentPanel) { agentPanel.destroy(); agentPanel = null; }
        }
      };
      modes.querySelector('.mva-chat-mode').onclick = function () { setAgentMode(false); };
      var agentButton = modes.querySelector('.mva-agent-mode');
      if (isDesktop && window.mvmOS && window.mvmOS.premiumGate) window.mvmOS.premiumGate(agentButton, t('mvmai_agent_premium'));
      agentButton.onclick = async function () {
        if (!me.agents) return;
        agentButton.disabled = true;
        try {
          if (!agentPanel) {
            var response = await fetch(window.asset(API + '/premium/agents.js'), {headers:{'X-Pub-Token':token},cache:'no-store'});
            if (!response.ok) throw new Error('unavailable');
            var script = document.createElement('script'); script.textContent = await response.text(); document.head.appendChild(script); script.remove();
            agentPanel = window.MvmaiPremium.createAgents({root:agentsRoot,api:api,t:t,esc:esc,lang:uiLang,
              // An administrator's file goes to their own folder on the server; the agent gets its path.
              upload:function (file) {
                return fetch(API + '/attach', {method:'POST',headers:{'X-Pub-Token':token,'X-File-Name':encodeURIComponent(file.name || 'file'),'Content-Type':'application/octet-stream'},body:file}).then(function (r) {
                  return r.json().catch(function () { return {}; }).then(function (d) {
                    if (!r.ok || !d.path) throw new Error(d.error === 'too_big' ? 'big' : 'failed');
                    return {name:d.name || file.name || 'file',path:d.path,dir:d.dir || ''};
                  });
                });
              }});
          }
          setAgentMode(true);
        } catch (_) { addNote(t('mvmai_pub_err')); }
        finally { agentButton.disabled = false; }
      };
      agentModeSync();
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
      // The last good reading per account: kept when a refresh fails, and kept in
      // the browser between visits, so the meter is there from the first moment of
      // a chat instead of appearing only when the first reading arrives.
      var USAGE_SAVED = 'mvmai_usage_v1';
      function loadUsageStore() {
        var out = {};
        try {
          var raw = JSON.parse(localStorage.getItem(USAGE_SAVED) || '{}');
          Object.keys(raw).forEach(function (k) {
            if (raw[k] && raw[k].data && Date.now() - raw[k].at < 86400000) out[k] = raw[k].data;
          });
        } catch (_) {}
        return out;
      }
      function saveUsage(key, data) {
        try {
          var raw = JSON.parse(localStorage.getItem(USAGE_SAVED) || '{}');
          raw[key] = {at: Date.now(), data: data};
          localStorage.setItem(USAGE_SAVED, JSON.stringify(raw));
        } catch (_) {}
      }
      var usageStore = loadUsageStore();
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
      function usageKey() {
        var provider = currentUsageProvider();
        return provider + '|' + (provider === 'gemini-cli' ? currentUsageModel() : '');
      }
      function paintUsage() {
        // A refresh that fails or is still on its way never blanks the meter:
        // the last good reading stays until a new one replaces it.
        var data = usageData && !usageData.unavailable ? usageData : usageStore[usageKey()];
        if (!composerModelEl || composerModelEl.hidden || !data || data.hide) return;
        var models = data.models || [];
        var bars = currentUsageProvider() === 'gemini-cli'
          ? models.map(function (window) {
              return usageBar(window, models.length === 1 ? t('mvmai_pub_usage_day') : window.model_label);
            }).filter(Boolean)
          : [usageBar(data.five_hour, t('mvmai_pub_usage_five_hour')),
            usageBar(data.week, t('mvmai_pub_usage_week'))].filter(Boolean);
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
          if (data.__status === 200 && !data.unavailable) { usageStore[provider + '|' + model] = data; saveUsage(provider + '|' + model, data); }
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
        renderSectionSelect();
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
          // The chosen app belongs to the chat it was chosen in; drop an old browser-wide choice.
          try { localStorage.removeItem(appKey); } catch (_) {}
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
          agentModeSync();
          refreshComposer();
        });
      }

      // A search box over a short list of branches; the first entry means "no branch".
      function branchPicker(host, branches, value, onChange) {
        var current = value || '';
        var all = branches.slice();
        if (current && all.indexOf(current) < 0) all.unshift(current);
        host.innerHTML = '<input class="mvmai-branch-search" type="text" autocomplete="off" placeholder="' + esc(t('mvmai_pub_branch_search')) + '"><div class="mvmai-branch-list" role="listbox"></div>';
        var input = host.querySelector('.mvmai-branch-search'), list = host.querySelector('.mvmai-branch-list');
        function paint() {
          var q = input.value.trim().toLowerCase();
          list.textContent = '';
          function add(label, v, cls) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'mvmai-branch-item' + (cls ? ' ' + cls : '') + (current === v ? ' active' : '');
            b.setAttribute('role', 'option');
            b.textContent = label;
            b.onclick = function (e) { e.stopPropagation(); current = v; onChange(v); paint(); };
            list.appendChild(b);
          }
          if (!q) add(t('mvmai_pub_branch_none'), '', 'none');
          var shown = all.filter(function (x) { return !q || x.toLowerCase().indexOf(q) >= 0; });
          shown.forEach(function (x) { add('⎇ ' + x, x); });
          if (q && !shown.length) {
            var empty = document.createElement('div');
            empty.className = 'mvmai-branch-item';
            empty.textContent = t('mvmai_pub_branch_no_match');
            list.appendChild(empty);
          }
        }
        input.oninput = paint;
        paint();
      }

      function chatBranch() {
        if (sessionId) {
          var row = sessionsCache.filter(function (x) { return x.id === sessionId; })[0];
          return row ? row.branch || '' : '';
        }
        return (newProjectModel && newProjectModel.branch) || '';
      }

      function switchToBranch(project, branch) {
        return api('/projects/' + encodeURIComponent(project.id) + '/checkout', {
          method: 'POST', body: JSON.stringify({branch: branch, section_id: project.section_id || ''})
        }).then(function (r) {
          if (r.__status !== 200 || r.error) {
            addNote(t('mvmai_pub_branch_switch_failed', {error: r.error || r.__status}));
            return false;
          }
          if (activeProject && activeProject.id === project.id && (activeProject.section_id || '') === (project.section_id || '')) {
            currentBranch = branch;
            updateWhereBar();
            renderInlineFileTree(true);
          }
          addNote(t('mvmai_pub_branch_switched', {branch: branch}));
          return true;
        });
      }

      function closeBranchPop() {
        root.querySelectorAll('.mvmai-branch-pop').forEach(function (el) { el.remove(); });
      }
      function openBranchWarn(anchor) {
        var want = chatBranch(), project = activeProject;
        if (!want || !project) return;
        closeBranchPop();
        var pop = document.createElement('div');
        pop.className = 'mvmai-branch-pop';
        pop.innerHTML = '<div>' + esc(t('mvmai_pub_branch_warn_text', {now: currentBranch})) + '</div>' +
          '<button type="button" class="mvmai-branch-pop-btn">⎇ <b></b></button>' +
          '<div>' + esc(t('mvmai_pub_branch_warn_hint')) + '</div>';
        pop.querySelector('b').textContent = want;
        var widget = root.querySelector('.mvmai-widget');
        widget.appendChild(pop);
        var wr = widget.getBoundingClientRect(), br = anchor.getBoundingClientRect();
        pop.style.top = (br.bottom - wr.top + 6) + 'px';
        pop.style.left = Math.max(8, Math.min(br.left - wr.left, wr.width - 272)) + 'px';
        pop.addEventListener('click', function (e) { e.stopPropagation(); });
        pop.querySelector('button').onclick = function () { closeBranchPop(); switchToBranch(project, want); };
        setTimeout(function () { document.addEventListener('click', closeBranchPop, {once: true}); }, 0);
      }

      // Opening a chat that belongs to another branch than the folder is on: ask, switch or ignore, as set.
      function checkBranchOnOpen(id) {
        var row = sessionsCache.filter(function (x) { return x.id === id; })[0];
        var project = activeProject;
        if (!me.is_admin || !row || !row.branch || !project || !project.path || archivedSession) return;
        if (chatContexts[id] && chatContexts[id].sending) return;
        Promise.all([api('/branch-settings'), api('/projects/' + encodeURIComponent(project.id) + '/branches' + sectionQuery(project, true))]).then(function (res) {
          var mode = res[0].__status === 200 ? res[0].mode : 'ask', info = res[1];
          if (mode === 'none' || sessionId !== id || activeProject !== project) return;
          if (info.__status !== 200 || !info.is_repo || info.error || !info.current) return;
          if (info.current === row.branch || (info.branches || []).indexOf(row.branch) < 0) return;
          currentBranch = info.current;
          updateWhereBar();
          if (mode === 'auto') { switchToBranch(project, row.branch); return; }
          var backdrop = document.createElement('div');
          backdrop.className = 'mvmai-pub-dialog-backdrop mvmai-branch-ask';
          backdrop.innerHTML = '<div class="mvmai-pub-dialog" role="dialog" aria-modal="true">' +
            '<div class="mvmai-pub-dialog-title"></div><div class="mvmai-branch-ask-rows">' +
            '<div class="mvmai-branch-ask-row"><span class="mvmai-branch-ask-label mvmai-ba-chat"></span><code class="mvmai-branch-ask-name mvmai-ba-chat-name"></code></div>' +
            '<div class="mvmai-branch-ask-row"><span class="mvmai-branch-ask-label mvmai-ba-now"></span><code class="mvmai-branch-ask-name mvmai-ba-now-name"></code></div></div>' +
            '<div class="mvmai-pub-dialog-actions"><button type="button" class="mvmai-confirm-yes"></button><button type="button" class="mvmai-confirm-no"></button></div></div>';
          backdrop.querySelector('.mvmai-pub-dialog-title').textContent = t('mvmai_pub_branch_ask_text');
          backdrop.querySelector('.mvmai-ba-chat').textContent = t('mvmai_pub_branch_ask_chat');
          backdrop.querySelector('.mvmai-ba-chat-name').textContent = row.branch;
          backdrop.querySelector('.mvmai-ba-now').textContent = t('mvmai_pub_branch_ask_now');
          backdrop.querySelector('.mvmai-ba-now-name').textContent = info.current;
          backdrop.querySelector('.mvmai-confirm-no').textContent = t('mvmai_pub_branch_ask_stay');
          backdrop.querySelector('.mvmai-confirm-yes').textContent = t('mvmai_pub_branch_ask_switch', {chat: row.branch});
          root.querySelector('.mvmai-widget').appendChild(backdrop);
          backdrop.querySelector('.mvmai-confirm-no').onclick = function () { backdrop.remove(); };
          backdrop.querySelector('.mvmai-confirm-yes').onclick = function () { backdrop.remove(); switchToBranch(project, row.branch); };
        });
      }

      // Change or remove the branch of one chat from its menu.
      function openBranchDialog(s) {
        if (!s.project_id || root.querySelector('.mvmai-branch-dialog')) return;
        var project = withSection(projects.filter(function (p) { return p.id === s.project_id; })[0] || {id: s.project_id, name: s.project_id, path: ''}, s.section_id);
        var backdrop = document.createElement('div');
        backdrop.className = 'mvmai-pub-dialog-backdrop mvmai-branch-dialog';
        backdrop.innerHTML = '<div class="mvmai-pub-dialog" role="dialog" aria-modal="true">' +
          '<div class="mvmai-pub-dialog-title"></div><div class="mvmai-branch-picker"><div class="mvmai-pub-dialog-hint"></div></div>' +
          '<div class="mvmai-pub-dialog-actions"><button type="button" class="mvmai-confirm-no"></button>' +
          '<button type="button" class="mvmai-confirm-yes" disabled></button></div></div>';
        backdrop.querySelector('.mvmai-pub-dialog-title').textContent = t('mvmai_pub_branch_dialog_title');
        backdrop.querySelector('.mvmai-confirm-no').textContent = t('mvmai_pub_cancel');
        var save = backdrop.querySelector('.mvmai-confirm-yes');
        save.textContent = t('mvmai_pub_branch_save');
        root.querySelector('.mvmai-widget').appendChild(backdrop);
        backdrop.querySelector('.mvmai-confirm-no').onclick = function () { backdrop.remove(); };
        var picked = s.branch || '';
        var host = backdrop.querySelector('.mvmai-branch-picker');
        api('/projects/' + encodeURIComponent(s.project_id) + '/branches' + sectionQuery(project, true)).then(function (info) {
          if (!backdrop.isConnected) return;
          if (info.__status !== 200 || !info.is_repo || info.error) {
            host.querySelector('.mvmai-pub-dialog-hint').textContent = t('mvmai_pub_git_not_repo');
            return;
          }
          branchPicker(host, info.branches || [], picked, function (v) { picked = v; });
          save.disabled = false;
        });
        save.onclick = function () {
          save.disabled = true;
          api('/sessions/' + encodeURIComponent(s.id) + '/branch', {method: 'POST', body: JSON.stringify({branch: picked})}).then(function (r) {
            if (r.__status !== 200) { save.disabled = false; return; }
            s.branch = picked;
            backdrop.remove();
            refreshSessionList().then(function () { if (s.id === sessionId) updateWhereBar(); });
          });
        };
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
          '<label>' + esc(t('mvmai_pub_model_model')) + '<select class="mvmai-model-select"></select></label><div class="mvmai-model-branch" hidden></div></div>' +
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
        // A new chat of a project may stay with one branch: the branch of the folder now, or another one, or none.
        var branchHost = backdrop.querySelector('.mvmai-model-branch');
        var pickedBranch = newProjectModel && typeof newProjectModel.branch === 'string' ? newProjectModel.branch : '';
        var folderBranch = '';
        if (!switching && activeProject && activeProject.path) {
          api('/projects/' + encodeURIComponent(activeProject.id) + '/branches' + sectionQuery(activeProject, true)).then(function (info) {
            if (!backdrop.isConnected || info.__status !== 200 || !info.is_repo || info.error) return;
            folderBranch = info.current || '';
            if (!(newProjectModel && typeof newProjectModel.branch === 'string')) pickedBranch = info.current || '';
            branchHost.hidden = false;
            branchHost.innerHTML = '<div class="mvmai-branch-label">' + esc(t('mvmai_pub_branch_label')) + '</div><div class="mvmai-branch-picker"></div>';
            branchPicker(branchHost.querySelector('.mvmai-branch-picker'), info.branches || [], pickedBranch, function (v) { pickedBranch = v; });
          });
        }
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
            var finishNew = function (branch) {
              newProjectModel = {provider: provider, model: model, label: labelFor(provider, model), branch: branch};
              backdrop.remove(); refreshComposer(); showWelcome(); inputEl.focus();
            };
            // A new chat for another branch moves the folder there at once, not after the first answer.
            if (pickedBranch && folderBranch && pickedBranch !== folderBranch && activeProject) {
              confirmBtn.disabled = true;
              switchToBranch(activeProject, pickedBranch).then(function (ok) { finishNew(ok ? pickedBranch : folderBranch); });
              return;
            }
            finishNew(pickedBranch);
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

      if (me.is_admin) {
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

        var branchModeSel = execMenu.querySelector('.mvmai-branch-mode');
        api('/branch-settings').then(function (data) { if (data.__status === 200 && data.mode) branchModeSel.value = data.mode; });
        branchModeSel.onchange = function () { api('/branch-settings', {method: 'POST', body: JSON.stringify({mode: branchModeSel.value})}); };
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
      var branchSlotEl = root.querySelector('.mvmai-toolbar-branch');
      var filetreeExpanded = false;
      var filetreeProjectId = null;

      function syncFiletreeVisibility() {
        var projectId = activeProject && activeProject.path ? activeProject.id + '|' + activeProject.path : null;
        if (projectId !== filetreeProjectId) {
          filetreeProjectId = projectId;
          filetreeExpanded = false;
          lastGitSignature = '';
          sidebarFiletreeEl.innerHTML = '';
          branchSlotEl.innerHTML = '';
        }
        filetreeNavEl.hidden = !projectId;
        sidebarFiletreeEl.hidden = !projectId || !filetreeExpanded;
        sidebarFiletreeEl.classList.toggle('collapsed', !filetreeExpanded);
        filetreeLinkEl.textContent = '📁';
        filetreeLinkEl.title = t('mvmai_pub_view_files');
        filetreeLinkEl.setAttribute('aria-label', t('mvmai_pub_view_files'));
        filetreeLinkEl.classList.toggle('active', filetreeExpanded);
        filetreeLinkEl.setAttribute('aria-expanded', String(filetreeExpanded));
      }

      filetreeLinkEl.onclick = function () {
        filetreeExpanded = !filetreeExpanded;
        syncFiletreeVisibility();
        if (filetreeExpanded) renderInlineFileTree(true);
      };

      function updateProjectBadge() {
        renderSectionSelect();
        updateWhereBar();
        if (!projectBadgeEl) return;
        if (!activeProject) { projectBadgeEl.hidden = true; return; }
        projectBadgeEl.hidden = false;
        projectBadgeEl.textContent = '📁 ' + activeProject.name + (activeProject.section_name ? ' · ' + activeProject.section_name : '');
      }

      // The project as the open chat uses it: the chosen section's folder replaces the project folder.
      function withSection(p, sectionId) {
        if (!p) return p;
        var pick = (p.sections || []).filter(function (x) { return x.id === sectionId; })[0] || null;
        if (!pick) return Object.assign({}, p, {section_id: '', section_name: ''});
        return Object.assign({}, p, {path: pick.path || p.path, section_id: pick.id, section_name: pick.name});
      }
      function mainLabel(p) { return (p && p.main_name) || t('mvmai_pub_section_general'); }
      function sectionQuery(project, first) {
        return project && project.section_id ? (first ? '?' : '&') + 'section_id=' + encodeURIComponent(project.section_id) : '';
      }

      var sectionSelectEl = root.querySelector('.mvmai-toolbar-section');
      var whereEl = root.querySelector('.mvmai-whereami');
      var currentBranch = '';

      // The section list in the sidebar, before the branch, and the strip above the chat.
      function renderSectionSelect() {
        if (!sectionSelectEl) return;
        var raw = activeProject && projects.filter(function (x) { return x.id === activeProject.id; })[0];
        var sections = raw ? raw.sections || [] : [];
        sectionSelectEl.hidden = !sections.length;
        sectionSelectEl.replaceChildren();
        if (!sections.length) return;
        [{id: '', name: mainLabel(raw)}].concat(sections).forEach(function (x) {
          var o = document.createElement('option');
          o.value = x.id; o.textContent = '📂 ' + x.name;
          if (x.id === (activeProject.section_id || '')) o.selected = true;
          sectionSelectEl.appendChild(o);
        });
        sectionSelectEl.disabled = sending || archivedSession;
        sectionSelectEl.title = t('mvmai_pub_section_pick');
        sectionSelectEl.setAttribute('aria-label', t('mvmai_pub_section_pick'));
      }
      if (sectionSelectEl) sectionSelectEl.onchange = function () {
        var raw = activeProject && projects.filter(function (x) { return x.id === activeProject.id; })[0];
        if (!raw) return;
        var ctx = saveChatContext();
        switchSection(ctx, raw, sectionSelectEl.value, 'user', null);
      };
      function updateWhereBar() {
        if (!whereEl) return;
        if (!activeProject) { whereEl.hidden = true; return; }
        whereEl.hidden = false;
        whereEl.replaceChildren();
        function part(html) { var span = document.createElement('span'); span.innerHTML = html; whereEl.appendChild(span); }
        part('📁 <b>' + esc(activeProject.name) + '</b>');
        var raw = projects.filter(function (x) { return x.id === activeProject.id; })[0];
        if ((raw && (raw.sections || []).length) || activeProject.section_name) {
          part('📂 <b>' + esc(activeProject.section_name || mainLabel(activeProject)) + '</b>');
        }
        if (currentBranch) {
          part('⎇ <b>' + esc(currentBranch) + '</b>');
          // Like the branch in the sidebar: opens Git Manager on this repository, when it is installed.
          if (typeof GitManager !== 'undefined' && activeProject.path) {
            var link = whereEl.lastChild, repoPath = activeProject.path;
            link.style.cursor = 'pointer';
            link.style.color = 'var(--pub-accent,#89b4fa)';
            link.setAttribute('role', 'button');
            link.tabIndex = 0;
            var open = function () { GitManager.openRepo(repoPath); };
            link.onclick = open;
            link.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
          }
          // The chat belongs to another branch than the folder is on now.
          var wanted = chatBranch();
          if (wanted && wanted !== currentBranch) {
            var warn = document.createElement('button');
            warn.type = 'button';
            warn.className = 'mvmai-branch-warn';
            warn.textContent = '!';
            warn.title = t('mvmai_pub_branch_warn_title', {chat: wanted});
            warn.setAttribute('aria-label', warn.title);
            warn.onclick = function (e) { e.stopPropagation(); openBranchWarn(warn); };
            whereEl.appendChild(warn);
          }
        }
        if (activeProject.path) part('<span class="mvmai-where-path">' + esc(activeProject.path) + '</span>');
      }

      function renderProjects() {
        if (!projectsListEl) return;
        projectsListEl.innerHTML = '';
        var noneRow = document.createElement('div');
        noneRow.className = 'mvmai-project-row mvmai-project-none';
        noneRow.innerHTML = '<span class="mvmai-project-row-title"></span>';
        noneRow.querySelector('.mvmai-project-row-title').textContent = '📂 ' + t('mvmai_pub_no_project');
        noneRow.onclick = enterNoProjectView;
        projectsListEl.appendChild(noneRow);
        if (!projects.length) {
          projectsListEl.insertAdjacentHTML('beforeend', '<div class="mvmai-no-sessions">' + esc(t('mvmai_pub_no_projects')) + '</div>');
          return;
        }
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
          if (viewScope === 'all' && me.is_admin) refreshSessionList();  // project labels need the names
        });
      }

      // Header, projects list and file tree follow what the sidebar is showing.
      function applyScopeChrome() {
        var inScope = viewScope !== 'all';
        sidebarProjectHeaderEl.hidden = !inScope;
        if (viewScope === 'none') sidebarProjectHeaderEl.querySelector('.mvmai-sidebar-project-title').textContent = '📂 ' + t('mvmai_pub_no_project');
        else if (viewScope === 'project' && activeProject) sidebarProjectHeaderEl.querySelector('.mvmai-sidebar-project-title').textContent = '📁 ' + activeProject.name;
        if (projectsSectionEl) projectsSectionEl.hidden = inScope;
        if (activeProject) renderInlineFileTree();
        else { if (sidebarFiletreeEl) sidebarFiletreeEl.innerHTML = ''; syncFiletreeVisibility(); }
        updateProjectBadge();
      }

      function enterNoProjectView() {
        newChatView();
        activeProject = null;
        viewScope = 'none';
        newProjectModel = null;
        var modelDialog = root.querySelector('.mvmai-model-dialog');
        if (modelDialog) modelDialog.remove();
        applyScopeChrome();
        sessionId = null;
        archivedSession = false;
        chatLabel = null;
        chatProvider = null;
        chatModel = null;
        history = [];
        if (termPanel) termPanel.setChat(null);
        refreshComposer();
        showWelcome();
        refreshSessionList();
      }

      function enterProjectView(p) {
        newChatView();
        activeProject = withSection(p, null);
        viewScope = 'project';
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
        viewScope = 'all';
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
        api('/projects/' + project.id + '/git-status' + sectionQuery(project, true)).then(function (git) {
          if (!activeProject || activeProject.id !== project.id || !root.isConnected || renderId !== filetreeRenderId) return;
          var signature = project.id + JSON.stringify(git);
          var existingBody = sidebarFiletreeEl.querySelector('.mvmai-sidebar-filetree-body');
          if (quiet && signature === lastGitSignature && (!filetreeExpanded || (existingBody && existingBody.dataset.loaded))) return;
          var statusMap = {};
          ((git && git.added) || []).forEach(function (f) { statusMap[f] = 'A'; });
          ((git && git.modified) || []).forEach(function (f) { statusMap[f] = 'M'; });
          ((git && git.deleted) || []).forEach(function (f) { statusMap[f] = 'D'; });
          ((git && git.untracked) || []).forEach(function (f) { statusMap[f] = 'U'; });
          currentBranch = git && git.is_repo && !git.error ? git.branch || '' : '';
          updateWhereBar();
          var branchLabel = git.error ? t('mvmai_pub_git_error') : git && git.is_repo ? ('⎇ ' + git.branch) : t('mvmai_pub_git_not_repo');
          var hasGitManager = typeof GitManager !== 'undefined';
          var canOpenGitManager = git && git.is_repo && hasGitManager;
          var showInstallHint = git && git.is_repo && !hasGitManager;
          // Keep the visible branch/tree in place until the complete replacement
          // is ready, avoiding intermediate loading and empty-directory layouts.
          var nextTree = document.createElement('div');
          var nextBranch = document.createElement('div');
          nextBranch.innerHTML = canOpenGitManager
            ? '<a href="#" class="mvmai-sidebar-filetree-branch mvmai-sidebar-filetree-branch-link">' + esc(branchLabel) + '</a>'
            : '<div class="mvmai-sidebar-filetree-branch">' + esc(branchLabel) + '</div>';
          nextTree.innerHTML =
            (showInstallHint && filetreeExpanded ? '<div class="mvmai-sidebar-filetree-hint">' + esc(t('mvmai_pub_install_git_manager_hint')) + '</div>' : '') +
            '<div class="mvmai-sidebar-filetree-body"></div>';
          if (canOpenGitManager) {
            var branchLink = nextBranch.querySelector('.mvmai-sidebar-filetree-branch-link');
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
            branchSlotEl.replaceChildren.apply(branchSlotEl, Array.from(nextBranch.childNodes));
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

      // The project editor fills the chat column like the chat itself; saving or cancelling shows the chat again.
      function showNewProjectDialog() { openProjectEditor(null); }
      function showEditProjectDialog(p) { openProjectEditor(p); }

      function openProjectEditor(p) {
        var col = root.querySelector('.mvmai-chat-col');
        var old = col.querySelector('.mvmai-proj-editor');
        if (old) old.remove();
        var editor = document.createElement('div');
        editor.className = 'mvmai-proj-editor';
        editor.innerHTML =
          '<div class="mvmai-proj-editor-head"><button type="button" class="mvmai-proj-back" aria-label="' + esc(t('mvmai_pub_cancel')) + '">←</button>' +
          '<span class="mvmai-proj-editor-title">' + esc(t(p ? 'mvmai_pub_edit_project' : 'mvmai_pub_new_project')) + '</span></div>' +
          '<div class="mvmai-proj-editor-body"><div class="mvmai-proj-editor-col">' +
          '<div class="mvmai-proj-box mvmai-proj-general"><h3>' + esc(t('mvmai_pub_project_general')) + '</h3>' +
          '<label class="mvmai-proj-lbl">' + esc(t('mvmai_pub_project_name_full')) + '</label>' +
          '<input type="text" class="mvmai-proj-name" placeholder="' + esc(t('mvmai_pub_project_name_full')) + '">' +
          '<label class="mvmai-proj-lbl">' + esc(t('mvmai_pub_main_name_label')) + '</label>' +
          '<input type="text" class="mvmai-proj-main-name" placeholder="' + esc(t('mvmai_pub_section_general')) + '">' +
          '<div class="mvmai-proj-row"><input type="text" class="mvmai-proj-path" readonly placeholder="' + esc(t('mvmai_pub_project_path_optional')) + '">' +
          '<button type="button" class="mvmai-proj-path-browse">' + esc(t('mvmai_pub_project_browse')) + '</button>' +
          '<button type="button" class="mvmai-proj-path-clear" title="' + esc(t('mvmai_pub_clear')) + '">✕</button></div>' +
          '<div class="mvmai-pub-dialog-hint">' + esc(t('mvmai_pub_project_path_hint')) + '</div>' +
          '<textarea class="mvmai-proj-instr" placeholder="' + esc(t('mvmai_pub_instructions_label')) + '"></textarea>' +
          '<div class="mvmai-proj-row"><input type="text" class="mvmai-proj-file" placeholder="' + esc(t('mvmai_pub_instructions_file_label')) + '">' +
          '<button type="button" class="mvmai-proj-file-browse">' + esc(t('mvmai_pub_project_browse')) + '</button>' +
          '<button type="button" class="mvmai-proj-file-clear" title="' + esc(t('mvmai_pub_clear')) + '">✕</button></div>' +
          '<div class="mvmai-pub-dialog-hint">' + esc(t('mvmai_pub_instructions_hint')) + '</div></div>' +
          '<div class="mvmai-proj-sections-head"><h3 style="margin:0">' + esc(t('mvmai_pub_section_title')) + '</h3>' +
          '<div class="mvmai-pub-dialog-hint">' + esc(t('mvmai_pub_section_hint')) + '</div></div>' +
          '<div class="mvmai-proj-sections" style="display:flex;flex-direction:column;gap:1.1rem"></div>' +
          '<div><button type="button" class="mvmai-proj-add">' + esc(t('mvmai_pub_section_add')) + '</button></div>' +
          '</div></div>' +
          '<div class="mvmai-proj-editor-foot"><span class="mvmai-proj-err" hidden style="margin-right:auto"></span>' +
          '<button type="button" class="mvmai-proj-cancel">' + esc(t('mvmai_pub_cancel')) + '</button>' +
          '<button type="button" class="mvmai-proj-save">' + esc(t(p ? 'mvmai_pub_save' : 'mvmai_pub_project_create')) + '</button></div>';
        col.appendChild(editor);
        function q(sel, scope) { return (scope || editor).querySelector(sel); }
        function close() { editor.remove(); }
        var nameEl = q('.mvmai-proj-name'), mainNameEl = q('.mvmai-proj-main-name'), pathEl = q('.mvmai-proj-path'), instrEl = q('.mvmai-proj-instr'), fileEl = q('.mvmai-proj-file');
        var errEl = q('.mvmai-proj-err'), listBox = q('.mvmai-proj-sections');
        nameEl.value = p ? p.name || '' : '';
        mainNameEl.value = p ? p.main_name || '' : '';
        pathEl.value = p ? p.path || '' : '';
        instrEl.value = p ? p.instructions || '' : '';
        fileEl.value = p ? p.instructions_file || '' : '';
        q('.mvmai-proj-back').onclick = close;
        q('.mvmai-proj-cancel').onclick = close;
        q('.mvmai-proj-path-browse').onclick = function () { showFolderPicker(pathEl.value || '/', function (c) { pathEl.value = c; }); };
        q('.mvmai-proj-path-clear').onclick = function () { pathEl.value = ''; };
        q('.mvmai-proj-file-browse').onclick = function () { showFilePicker(pathEl.value || '/', function (c) { fileEl.value = c; }); };
        q('.mvmai-proj-file-clear').onclick = function () { fileEl.value = ''; };

        var cards = [];
        function addSection(sec) {
          sec = sec || {};
          var box = document.createElement('div');
          box.className = 'mvmai-proj-box mvmai-proj-section';
          box.innerHTML =
            '<div class="mvmai-proj-sec-head"><input type="text" class="mvmai-sec-name" placeholder="' + esc(t('mvmai_pub_section_name_label')) + '">' +
            '<button type="button" class="mvmai-sec-remove">' + esc(t('mvmai_pub_section_remove')) + '</button></div>' +
            '<div class="mvmai-proj-row"><input type="text" class="mvmai-sec-path" readonly placeholder="' + esc(t('mvmai_pub_project_path_optional')) + '">' +
            '<button type="button" class="mvmai-sec-path-browse">' + esc(t('mvmai_pub_project_browse')) + '</button>' +
            '<button type="button" class="mvmai-sec-path-clear" title="' + esc(t('mvmai_pub_clear')) + '">✕</button></div>' +
            '<textarea class="mvmai-sec-desc" style="min-height:3.5rem" placeholder="' + esc(t('mvmai_pub_section_description_label')) + '"></textarea>' +
            '<textarea class="mvmai-sec-instr" placeholder="' + esc(t('mvmai_pub_instructions_label')) + '"></textarea>' +
            '<div class="mvmai-proj-row"><input type="text" class="mvmai-sec-file" placeholder="' + esc(t('mvmai_pub_instructions_file_label')) + '">' +
            '<button type="button" class="mvmai-sec-file-browse">' + esc(t('mvmai_pub_project_browse')) + '</button>' +
            '<button type="button" class="mvmai-sec-file-clear" title="' + esc(t('mvmai_pub_clear')) + '">✕</button></div>';
          listBox.appendChild(box);
          var card = {id: sec.id || '', box: box};
          function f(sel) { return box.querySelector(sel); }
          f('.mvmai-sec-name').value = sec.name || '';
          f('.mvmai-sec-path').value = sec.path || '';
          f('.mvmai-sec-desc').value = sec.description || '';
          f('.mvmai-sec-instr').value = sec.instructions || '';
          f('.mvmai-sec-file').value = sec.instructions_file || '';
          f('.mvmai-sec-path-browse').onclick = function () { showFolderPicker(f('.mvmai-sec-path').value || pathEl.value || '/', function (c) { f('.mvmai-sec-path').value = c; }); };
          f('.mvmai-sec-path-clear').onclick = function () { f('.mvmai-sec-path').value = ''; };
          f('.mvmai-sec-file-browse').onclick = function () { showFilePicker(f('.mvmai-sec-path').value || pathEl.value || '/', function (c) { f('.mvmai-sec-file').value = c; }); };
          f('.mvmai-sec-file-clear').onclick = function () { f('.mvmai-sec-file').value = ''; };
          f('.mvmai-sec-remove').onclick = function () {
            if (!confirm(t('mvmai_pub_section_remove_confirm'))) return;
            cards.splice(cards.indexOf(card), 1);
            box.remove();
          };
          card.value = function () {
            return {id: card.id, name: f('.mvmai-sec-name').value.trim(), path: f('.mvmai-sec-path').value.trim(),
              description: f('.mvmai-sec-desc').value, instructions: f('.mvmai-sec-instr').value,
              instructions_file: f('.mvmai-sec-file').value.trim()};
          };
          cards.push(card);
          return card;
        }
        ((p && p.sections) || []).forEach(addSection);
        q('.mvmai-proj-add').onclick = function () {
          var card = addSection({});
          card.box.scrollIntoView({block: 'nearest'});
          card.box.querySelector('.mvmai-sec-name').focus();
        };

        q('.mvmai-proj-save').onclick = function () {
          var btn = this;
          errEl.hidden = true;
          var name = nameEl.value.trim();
          if (!name) { errEl.hidden = false; errEl.textContent = t('mvmai_pub_project_name_required'); nameEl.focus(); return; }
          var sections = cards.map(function (c) { return c.value(); });
          if (sections.some(function (x) { return !x.name; })) { errEl.hidden = false; errEl.textContent = t('mvmai_pub_section_name_required'); return; }
          btn.disabled = true;
          var payload = {name: name, main_name: mainNameEl.value.trim(), path: pathEl.value.trim(), instructions: instrEl.value, instructions_file: fileEl.value.trim(), sections: sections};
          api(p ? '/projects/' + p.id : '/projects', {method: p ? 'PATCH' : 'POST', body: JSON.stringify(payload)}).then(function (data) {
            if (data.__status !== 200) {
              errEl.hidden = false; errEl.textContent = data.error || 'Error';
              btn.disabled = false;
              return;
            }
            close();
            var saved = data.project;
            if (p && activeProject && activeProject.id === p.id) {
              activeProject = withSection(saved, activeProject.section_id);
              sidebarProjectHeaderEl.querySelector('.mvmai-sidebar-project-title').textContent = '📁 ' + saved.name;
              renderInlineFileTree();
              updateProjectBadge();
              refreshComposer();
            }
            loadProjects();
          });
        };
        nameEl.focus();
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
        var archived = sessionsCache.filter(function (s) { return !!s.archived_at && inViewScope(s); });
        archiveLinkEl.textContent = '🗃 ' + archived.length;
        archiveLinkEl.title = t('mvmai_pub_archived') + ' (' + archived.length + ')';
        archiveLinkEl.setAttribute('aria-label', archiveLinkEl.title);
        archiveLinkEl.classList.toggle('active', archiveExpanded);
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
          row.innerHTML = '<div class="mvmai-session-text"><span class="mvmai-session-title"></span>' +
            (viewScope === 'all' && me.is_admin ? '<span class="mvmai-session-project"></span>' : '') + '</div>' +
            '<button class="mvmai-s-btn mvmai-s-restore" title="' + esc(t('mvmai_pub_restore')) + '">↩</button>' +
            '<button class="mvmai-s-btn mvmai-s-delete" title="' + esc(t('mvmai_pub_delete')) + '">🗑</button>';
          row.querySelector('.mvmai-session-title').textContent = s.title || t('mvmai_pub_new_chat');
          var archTag = row.querySelector('.mvmai-session-project');
          if (archTag) archTag.textContent = projectLabel(s);
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
        // At home that is every archived chat; inside a project or "No project" only the ones listed there.
        var doomed = sessionsCache.filter(function (s) { return !!s.archived_at && inViewScope(s); });
        var removal = viewScope === 'all'
          ? api('/sessions/archived', {method: 'DELETE'})
          : Promise.all(doomed.map(function (s) { return api('/sessions/' + encodeURIComponent(s.id), {method: 'DELETE'}); }))
            .then(function (results) { return {__status: results.every(function (r) { return r.__status === 200; }) ? 200 : 500}; });
        removal.then(function (data) {
          if (data.__status !== 200) return;
          if (archivedSession && (viewScope === 'all' || doomed.some(function (s) { return s.id === sessionId; }))) {
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
        if (me.is_admin && s.project_id && !s.archived_at) addAction(t('mvmai_pub_branch_menu'), function () { openBranchDialog(s); });
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

      // Chats of what the sidebar shows (home = every project), and the label saying which project one belongs to.
      function inViewScope(s) {
        if (viewScope === 'all') return true;
        return viewScope === 'project' && activeProject ? s.project_id === activeProject.id : !s.project_id;
      }
      function projectLabel(s) {
        var owner = s.project_id ? projects.filter(function (p) { return p.id === s.project_id; })[0] : null;
        return owner ? '📁 ' + owner.name : '📂 ' + t('mvmai_pub_no_project');
      }

      function refreshSessionList() {
        if (titleRefreshTimer) { clearTimeout(titleRefreshTimer); titleRefreshTimer = null; }
        return api('/sessions').then(function (data) {
          if (data.__status !== 200) return;
          closeSessionMenu();
          closeSessionActions();
          sessionsCache = data.sessions || [];
          if (me.is_admin && activeProject) updateWhereBar();
          if (sessionsCache.some(function (s) { return s.title_pending; })) {
            titleRefreshTimer = setTimeout(refreshSessionList, 2500);
          }
          var current = sessionsCache.filter(function (s) { return s.id === sessionId; })[0];
          if (current && archivedSession !== !!current.archived_at) {
            archivedSession = !!current.archived_at;
            refreshComposer();
          }
          var sessions = sessionsCache.filter(function (s) {
            return !s.archived_at && inViewScope(s);
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
              (viewScope === 'all' && me.is_admin ? '<span class="mvmai-session-project"></span>' : '') +
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
            var projTag = row.querySelector('.mvmai-session-project');
            if (projTag) projTag.textContent = projectLabel(s);
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
        function scrollOpenedChatDown() {
          var openedContext = chatContext;
          scrollDown();
          requestAnimationFrame(function () {
            if (chatContext === openedContext && sessionId === id) scrollDown();
          });
        }
        api('/sessions/' + encodeURIComponent(id) + '/messages?lang=' + encodeURIComponent(uiLang() || 'en')).then(function (data) {
          if (data.__status !== 200 || requestVersion !== viewVersion) return;
          var cached = chatContexts[id];
          if (cached === chatContext) { closeSidebar(); scrollOpenedChatDown(); refreshSessionList(); if (me.is_admin) loadProjects(); return; }
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
          activeProject = pid ? withSection(projects.filter(function (p) { return p.id === pid; })[0] || {id: pid, name: pid, path: ''}, row.section_id) : null;
          if (termPanel) termPanel.setChat(archivedSession ? null : id);
          if (activeProject) { if (viewScope === 'none') viewScope = 'project'; }
          else if (viewScope === 'project') viewScope = 'all';
          applyScopeChrome();
          if (!cached) {
            history = data.messages || [];
            listEl.innerHTML = '';
            var any = false;
            history.forEach(function (m) {
              if (m.role === 'model_switch') {
                addModelSwitchNote(m);
                any = true;
              } else if (m.role === 'section_switch') {
                addSectionNote(m, null, null);
                any = true;
              } else if (m.role === 'summary' && m.content) {
                addCompactedNote(m.content);
                any = true;
              } else if ((m.role === 'user' || m.role === 'assistant') && m.content) {
                addBubble(m.role, m.content, null, m.created_at, null, m.provider_label, m.duration_ms, m.place);
                any = true;
              } else if (m.role === 'tool' && m.content && m.content.indexOf('"image_id"') >= 0) {
                // A picture made earlier in this chat.
                try {
                  var made = JSON.parse(m.content);
                  if (made.image_id) {
                    var pic = document.createElement('div');
                    pic.className = 'mvmai-tool-card';
                    pic.innerHTML = '<div class="mvmai-tool-head">🖼 ' + esc(t('mvmai_pub_image_done')) + '</div>';
                    listEl.appendChild(pic);
                    showGeneratedImage(pic, made.image_id, function () {});
                    any = true;
                  }
                } catch (e) { /* not a picture */ }
              }
            });
            if (!any) showWelcome();
          }
          saveChatContext();
          closeSidebar();
          scrollOpenedChatDown();
          refreshSessionList().then(function () { updateWhereBar(); checkBranchOnOpen(id); });
          if (me.is_admin) loadProjects();
        });
      }

      newChatBtn.onclick = function () {
        newChatView();
        // From home or "No project" a new chat has no project; inside a project it belongs to it.
        if (viewScope !== 'project') { activeProject = null; applyScopeChrome(); }
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
          // A picture the model offers is shown as a preview that opens larger on click.
          var ext = f.path && /\.(png|jpe?g|webp|gif)$/i.exec(f.name);
          if (ext) {
            var headers = {'X-Pub-Token': token};
            if (isDesktop) headers['X-MvmAI-Surface'] = 'desktop';
            fetch(API + '/download?path=' + encodeURIComponent(f.path), {headers: headers})
              .then(function (r) { if (!r.ok) throw new Error('gone'); return r.blob(); })
              .then(function (blob) {
                var type = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif'}[ext[1].toLowerCase()];
                var img = makeThumb(URL.createObjectURL(new Blob([blob], {type: type})));
                img.classList.add('mvmai-genimg');
                img.alt = f.name;
                var wrap = document.createElement('div');
                wrap.style.flex = '0 0 100%';
                wrap.appendChild(img);
                row.insertBefore(wrap, row.firstChild);
                scrollDown();
              }).catch(function () {});
          }
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

      function addBubble(role, content, thumbs, createdAt, ctx, savedLabel, durationMs, place) {
        var targetList = ctx ? ctx.listEl : listEl;
        var el = document.createElement('div');
        el.className = 'mvmai-msg ' + role;
        var offered = role === 'assistant' ? extractDownloads(content) : null;
        el.innerHTML = nl2br(offered ? offered.text : content);
        if (role === 'assistant' && place && (place.s || place.b)) {
          var placeEl = document.createElement('div');
          placeEl.className = 'mvmai-msg-place';
          var placeName = place.s || (activeProject && (activeProject.sections || []).length ? mainLabel(activeProject) : '');
          placeEl.textContent = [placeName ? '📂 ' + placeName : '', place.b ? '⎇ ' + place.b : ''].filter(Boolean).join(' · ');
          el.insertBefore(placeEl, el.firstChild);
        }
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

      function openGitDiff(project, path) {
        var previous = document.activeElement, overlay = document.createElement('div');
        overlay.className = 'mvmai-pub-dialog-backdrop mvmai-diff-dialog';
        overlay.innerHTML = '<section class="mvmai-pub-dialog" role="dialog" aria-modal="true"><strong class="mvmai-diff-title"></strong><p class="mvmai-pub-dialog-hint"></p><div class="mvmai-diff-content"></div><button type="button" class="mvmai-confirm-no"></button></section>';
        overlay.querySelector('section').setAttribute('aria-label',path);
        overlay.querySelector('strong').textContent = path;
        overlay.querySelector('p').textContent = t('mvmai_pub_git_diff_hint');
        var content = overlay.querySelector('.mvmai-diff-content'), button = overlay.querySelector('button');button.textContent = t('mvmai_gal_close');
        function close() {overlay.remove();if (previous && previous.isConnected) previous.focus({preventScroll:true});}
        button.onclick = close;overlay.onmousedown = function(e){if(e.target === overlay) close();};
        overlay.onkeydown = function(e){if(e.key === 'Escape') close();if(e.key === 'Tab'){e.preventDefault();button.focus();}};
        root.appendChild(overlay);button.focus();
        api('/projects/' + encodeURIComponent(project.id) + '/git-diff?path=' + encodeURIComponent(path) + sectionQuery(project, false)).then(function(data){
          if(!overlay.isConnected)return;
          if(data.__status !== 200 || !data.is_repo){content.textContent=t('mvmai_pub_git_diff_error');return;}
          content.innerHTML = data.diff ? codeBlock(data.diff,'diff') : esc(t('mvmai_pub_git_diff_empty'));
          if(data.truncated){var note=document.createElement('p');note.textContent=t('mvmai_pub_git_diff_truncated');content.appendChild(note);}
        }).catch(function(){content.textContent=t('mvmai_pub_git_diff_error');});
      }

      function collapseGitPanels(turn) {
        if (!turn) return;
        Object.keys(turn.gitPanels || {}).forEach(function (k) { turn.gitPanels[k].panel.open = false; });
      }

      // What the AI changed in this answer, per section folder. No tokens are involved: it is local git status.
      // When the changes are in another section than the open one, the chat follows the work there.
      function updateGitChanges(current, ctx, force) {
        var project = ctx.activeProject;
        if(!me.is_admin || !project || !project.path || (!force && current.gitPending) || (!force && Date.now()-(current.gitCheckedAt||0)<5000))return Promise.resolve();
        var raw = projects.filter(function (x) { return x.id === project.id; })[0] || project;
        var multi = (raw.sections || []).length > 0;
        var targets = [], seen = {};
        function addTarget(key, name, path) { if (path && !seen[path]) { seen[path] = 1; targets.push({key: key, name: name, path: path}); } }
        if (multi) {
          addTarget('', mainLabel(raw), raw.path);
          raw.sections.forEach(function (x) { addTarget(x.id, x.name, x.path); });
        } else {
          addTarget('', '', project.path);
        }
        // The open section always has a place in the list, even when it shares its folder with another.
        var activeKey = project.section_id || '';
        if (!targets.some(function (x) { return x.key === activeKey; })) targets.push({key: activeKey, name: project.section_name || '', path: project.path});
        current.gitPending=true;current.gitCheckedAt=Date.now();
        var version=current.gitVersion=(current.gitVersion||0)+1;
        var since=encodeURIComponent(current.gitSince || current.startedAt / 1000);
        current.gitPanels = current.gitPanels || {};
        return current.gitLast = Promise.all(targets.map(function (tg) {
          return api('/projects/'+encodeURIComponent(project.id)+'/git-status?stats=true&since='+since+(tg.key ? '&section_id='+encodeURIComponent(tg.key) : '')).then(function (git) { return {tg: tg, git: git}; });
        })).then(function(results){
          if(version!==current.gitVersion)return;
          var counts = {};
          results.forEach(function (r) {
            var key = r.tg.key, git = r.git, entry = current.gitPanels[key];
            var files = git.__status===200 && git.is_repo ? [].concat(git.added||[],git.modified||[],git.deleted||[],git.untracked||[]).filter(function(path,i,all){return all.indexOf(path)===i;}).sort() : [];
            if(!files.length){if(entry){entry.panel.remove();delete current.gitPanels[key];}return;}
            counts[key] = files.length;
            if(!entry){
              // The AI worked in another section than the open one: say so, before the files. The open section stays.
              if (multi && key !== activeKey) {
                current.visited = current.visited || {};
                if (!current.visited[key]) {
                  current.visited[key] = true;
                  recordSectionNote(ctx, raw, activeKey, key, 'ai', true, current);
                }
              }
              var panel=document.createElement('details');panel.className='mvmai-msg system-note';
              var title=document.createElement('summary');title.textContent=t('mvmai_pub_git_changes')+(multi ? ' · 📂 '+(r.tg.name||mainLabel(raw)) : '');panel.appendChild(title);
              var body=document.createElement('div');panel.appendChild(body);panel.open=ctx.turn===current;body.style.cssText='max-height:220px;overflow:auto';
              ctx.listEl.insertBefore(panel,current.livePanel || (current.typing && current.typing.isConnected ? current.typing : null));
              entry=current.gitPanels[key]={panel:panel,body:body,signature:null};
            }
            var signature=JSON.stringify([files,git.stats||{}]);if(signature===entry.signature)return;entry.signature=signature;entry.body.replaceChildren();
            var diffProject = multi ? withSection(raw, key) : project;
            files.forEach(function(path){var button=document.createElement('button');button.type='button';button.className='mvmai-git-file';button.textContent=path;var count=(git.stats||{})[path];if(count && !count.binary && !count.unavailable){var plus=document.createElement('span'),minus=document.createElement('span');plus.className='mvmai-git-plus';minus.className='mvmai-git-minus';plus.textContent=' +'+count.added;minus.textContent=' −'+count.deleted;button.appendChild(plus);button.appendChild(minus);}button.onclick=function(){openGitDiff(diffProject,path);};entry.body.appendChild(button);});
          });
          if(ctx.turn===current)ctx.listEl.scrollTop=ctx.listEl.scrollHeight;
        }).catch(function(){}).finally(function(){if(version===current.gitVersion)current.gitPending=false;});
      }

      // A change of section, by the AI's work or by the person: shown in the chat and kept in its history.
      function sectionNoteText(marker) {
        var d = {};
        try { d = JSON.parse(marker.content || '{}'); } catch (e) {}
        var from = (d.from && d.from.name) || t('mvmai_pub_section_general'), to = (d.to && d.to.name) || t('mvmai_pub_section_general');
        var text = d.by === 'back' ? t('mvmai_pub_section_back', {to: to}) : t(d.by === 'ai' ? 'mvmai_pub_section_switched_ai' : 'mvmai_pub_section_switched_user', {from: from, to: to});
        return '📂 ' + text + (d.to && d.to.path ? ' · ' + d.to.path : '');
      }
      function addSectionNote(marker, ctx, current) {
        var targetList = ctx ? ctx.listEl : listEl;
        var el = document.createElement('div');
        el.className = 'mvmai-msg system-note';
        el.textContent = sectionNoteText(marker);
        var ref = current && current.livePanel ? current.livePanel : (current && current.typing && current.typing.isConnected ? current.typing : null);
        if (ref && ref.parentNode === targetList) targetList.insertBefore(el, ref); else targetList.appendChild(el);
        targetList.scrollTop = targetList.scrollHeight;
      }
      // Writes a note about a section into the chat and its history. With visit, the chat's own section is untouched.
      function recordSectionNote(ctx, raw, fromId, toId, by, visit, current) {
        var sid = ctx.sessionId || (ctx === chatContext ? sessionId : null);
        function nameOf(id) { var x = (raw.sections || []).filter(function (y) { return y.id === id; })[0]; return x ? x.name : (raw.main_name || ''); }
        function pathOf(id) { var x = (raw.sections || []).filter(function (y) { return y.id === id; })[0]; return (x && x.path) || raw.path || ''; }
        function fallbackMarker() {
          return {role: 'section_switch', created_at: Math.floor(Date.now() / 1000), content: JSON.stringify({
            from: {id: fromId || '', name: nameOf(fromId), path: pathOf(fromId)}, to: {id: toId || '', name: nameOf(toId), path: pathOf(toId)}, by: by})};
        }
        function record(marker) {
          (ctx.history || history).push(marker);
          addSectionNote(marker, ctx, current);
        }
        // Shown at once, so it stands before the files it is about; kept on the server in the background.
        record(fallbackMarker());
        if (sid) api('/sessions/' + encodeURIComponent(sid) + '/section', {method: 'POST', body: JSON.stringify({section_id: toId || '', from_id: fromId || '', by: by, visit: !!visit})});
      }

      // Only the person changes the section of a chat.
      function switchSection(ctx, raw, sectionId, by, current) {
        var before = ctx.activeProject;
        var fromId = before && before.section_id || '';
        if (fromId === (sectionId || '')) return;
        var next = withSection(raw, sectionId);
        ctx.activeProject = next;
        if (ctx === chatContext) {
          activeProject = next;
          currentBranch = '';
          renderInlineFileTree();
          updateProjectBadge();
        }
        recordSectionNote(ctx, raw, fromId, sectionId || '', by, false, current);
      }

      // Public progress is paced locally; it never enters model history.
      function renderLiveEvent(event, current, ctx, typing) {
        if (!current.livePanel) {
          var stream=document.createElement('div');stream.className='mvmai-live-stream';
          current.livePanel=stream;current.liveBody=stream;current.liveItems=Object.create(null);
          ctx.listEl.insertBefore(stream,typing && typing.isConnected ? typing : null);
        }
        var key=event.kind+':'+event.key,row=current.liveItems[key];
        if(!row){
          row=document.createElement('div');row.className='mvmai-msg assistant mvmai-live-row';
          current.liveItems[key]=row;current.liveBody.appendChild(row);
          if(current.liveBody.children.length>100){var oldest=current.liveBody.firstChild;Object.keys(current.liveItems).forEach(function(k){if(current.liveItems[k]===oldest)delete current.liveItems[k];});oldest.remove();}
        }
        if(event.kind==='message'){row.innerHTML=nl2br(event.text);return;}
        const wasOpen=!!row.querySelector('.mvmai-live-tool')?.open;
        row.replaceChildren();
        var details=document.createElement('details'),summary=document.createElement('summary'),status=document.createElement('span'),preview=document.createElement('code'),body=document.createElement('div');
        details.className='mvmai-live-tool';details.open=wasOpen;
        status.className='mvmai-live-tool-status';status.textContent=t(event.status==='done'?'mvmai_pub_live_done':'mvmai_pub_live_running');
        preview.className='mvmai-live-tool-summary';preview.textContent=event.text.split(/\r?\n/)[0].slice(0,160)+(event.text.includes('\n')||event.text.length>160?' …':'');
        summary.appendChild(status);summary.appendChild(preview);details.appendChild(summary);
        body.innerHTML=codeBlock(event.text,event.language || 'bash');
        if(event.output){var pre=document.createElement('pre');pre.className='mvmai-code-block';pre.textContent=event.output;body.appendChild(pre);}
        details.appendChild(body);row.appendChild(details);
      }

      function showLiveActivity(data, current, ctx, typing) {
        current.liveQueue=current.liveQueue||[];current.livePending=current.livePending||Object.create(null);
        (data.events||[]).forEach(function(event){
          if(event.seq<=(current.eventSeq||0))return;
          current.eventSeq=event.seq;if(!event.text)return;
          var key=event.kind+':'+event.key;
          if(!current.livePending[key])current.liveQueue.push(key);
          current.livePending[key]=event;
        });
        if(current.liveTimer || !current.liveQueue.length)return;
        function next(){
          current.liveTimer=null;
          if(current.stopped || !ctx.listEl.isConnected)return;
          var key=current.liveQueue.shift(),event=current.livePending[key];delete current.livePending[key];
          if(event){renderLiveEvent(event,current,ctx,typing);ctx.listEl.scrollTop=ctx.listEl.scrollHeight;}
          // Keep the cooldown even after the last item so two poll batches cannot burst.
          current.liveTimer=setTimeout(function(){current.liveTimer=null;if(current.liveQueue.length)next();},350);
        }
        next();
      }

      function collapseLiveProgress(current, ctx) {
        if(!current)return;
        if(current.liveTimer){clearTimeout(current.liveTimer);current.liveTimer=null;}
        if(current.livePanel && current.livePanel.tagName==='DETAILS'){current.livePanel.open=false;return;}
        // Final answers are never delayed by the visual queue. Store its tail behind
        // the collapsed summary, without flashing a batch of messages on screen.
        var remaining=(current.liveQueue||[]).map(function(key){return current.livePending[key];}).filter(Boolean);
        current.liveQueue=[];current.livePending=Object.create(null);
        if(!current.livePanel && !remaining.length)return;
        if(!current.livePanel)renderLiveEvent(remaining.shift(),current,ctx,current.typing);
        var stream=current.livePanel,panel=document.createElement('details'),title=document.createElement('summary'),body=document.createElement('div');
        panel.className='mvmai-live-preview mvmai-msg system-note';title.textContent=t('mvmai_pub_live_progress');body.className='mvmai-live-archive';panel.appendChild(title);panel.appendChild(body);
        stream.replaceWith(panel);while(stream.firstChild)body.appendChild(stream.firstChild);
        current.livePanel=panel;current.liveBody=body;
        remaining.forEach(function(event){renderLiveEvent(event,current,ctx,current.typing);});
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
          energy *= Math.exp(-Math.max(0, now - energyAt) / 2000);
          if (energy < .15) energy = 0;
          energyAt = now;
        }
        el.updateActivity = function (data) {
          if (Number(data.activity_seq) > seq) {
            var count = Number(data.activity_seq) - seq;
            seq = Number(data.activity_seq);
            decayEnergy(Date.now());
            if (data.activity_age != null && data.activity_age < 6) {
              // Any burst of activity lifts the line well up, and a bigger one
              // lifts it to the top, so a CLI that reports a few big events
              // (Codex) shows as clearly as one that streams every word
              // (Claude). This measures incoming activity, not reasoning
              // complexity.
              energy = Math.max(energy, Math.min(14, 9 + 5 * Math.min(1, Math.log2(1 + count) / 6)));
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
          // Between bursts the line keeps a faint pulse, so a flat line never
          // looks like a chat that has stopped.
          var wave = active ? energy * [0, .25, .7, 1, .45, 0][tick % 6] : 1.6 * (1 + Math.sin(tick * .5)) / 2;
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
          var input, picker = null;
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
          } else if ((f.type === 'date' || f.type === 'time') && window.mvmOS && window.mvmOS.dateTimePicker) {
            // The shared mvmOS picker, so the date follows the person's own
            // display settings instead of the browser's.
            var host = document.createElement('div');
            try { picker = window.mvmOS.dateTimePicker.create(host, {type: f.type, required: !!f.required, label: f.label, value: String(value)}); }
            catch (e) { picker = window.mvmOS.dateTimePicker.create(host, {type: f.type, required: !!f.required, label: f.label}); }
            input = picker.input;
          } else {
            input = document.createElement('input');
            input.type = f.type === 'number' ? 'number' : (f.type === 'date' || f.type === 'time' ? f.type : 'text');
            if (f.type === 'number') input.step = 'any';
            input.value = String(value);
          }
          card.appendChild(label);
          card.appendChild(picker ? picker.button.parentNode : input);
          inputs.push({f: f, el: input, picker: picker, before: f.type === 'bool' ? input.checked : input.value});
        });
        var observer = new MutationObserver(function () { if (!card.isConnected) cleanupPickers(); });
        function cleanupPickers() {
          inputs.forEach(function (i) { if (i.picker) { i.picker.destroy(); i.picker = null; } });
          observer.disconnect(); reviewCleanups.delete(cleanupPickers);
        }
        reviewCleanups.add(cleanupPickers);
        observer.observe(root, {childList: true, subtree: true});
        var state = document.createElement('div');
        state.className = 'mvmai-review-state';
        return {
          card: card,
          state: state,
          lock: function () { inputs.forEach(function (i) { i.el.disabled = true; if (i.picker) i.picker.button.disabled = true; }); },
          collect: function () {
            var values = {}, changed = {}, missing = false;
            inputs.forEach(function (i) {
              var v = i.f.type === 'bool' ? i.el.checked : i.el.value;
              i.el.style.borderColor = '';
              if (i.picker) i.picker.button.style.borderColor = '';
              if (i.f.type !== 'bool' && i.f.required && String(v).trim() === '') {
                i.el.style.borderColor = 'var(--pub-red,#f38ba8)';
                if (i.picker) i.picker.button.style.borderColor = 'var(--pub-red,#f38ba8)';
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

      async function reviewToolCall(call, name, args, pv, ctx) {
        if (window.mvmOS && window.mvmOS.dateTimePicker) await window.mvmOS.dateTimePicker.ready();
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
      async function reviewBatch(items, ctx) {
        if (window.mvmOS && window.mvmOS.dateTimePicker) await window.mvmOS.dateTimePicker.ready();
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

      // A picture the generator made, shown in a card; it is fetched with the
      // token, so it is a blob here and never a link anyone could share.
      function showGeneratedImage(card, imageId, scrollDown) {
        var box = document.createElement('div');
        box.className = 'mvmai-gen';
        card.appendChild(box);
        fetch(API + '/generated/' + encodeURIComponent(imageId), {headers: {'X-Pub-Token': token}}).then(function (r) {
          if (!r.ok) throw new Error('missing');
          return r.blob();
        }).then(function (blob) {
          var url = URL.createObjectURL(blob);
          box.innerHTML = '<img class="mvmai-gen-img" alt="" src="' + url + '"><a class="mvmai-gen-dl" download="' + esc(imageId) + '" href="' + url + '">⬇ ' + esc(t('mvmai_pub_image_download')) + '</a>';
          box.querySelector('img').addEventListener('load', scrollDown);
          scrollDown();
        }).catch(function () { box.textContent = t('mvmai_pub_image_failed'); });
      }
      function imageErrorText(code) {
        if (code === 'insufficient_credits') return t('mvmai_pub_image_credits');
        if (code === 'daily_limit') return t('mvmai_pub_image_limit');
        if (code === 'image_refused') return t('mvmai_pub_image_refused');
        return t('mvmai_pub_image_failed');
      }

      function readToolCall(call, name, args, ctx) {
        ctx = ctx || saveChatContext();
        var listEl = ctx.listEl, activeProject = ctx.activeProject;
        function scrollDown() { listEl.scrollTop = listEl.scrollHeight; }
        var card = document.createElement('div');
        card.className = 'mvmai-tool-card';
        card.innerHTML = name === 'generate_image'
          ? '<div class="mvmai-tool-head">🖼 ' + esc(t('mvmai_pub_image_making')) + '</div>'
          : '<div class="mvmai-tool-head">🔧 ' + esc(t('mvmai_pub_using_tool', {name: name})) + '</div>';
        listEl.appendChild(card);
        scrollDown();

        return api('/tool-call', {method: 'POST', body: JSON.stringify({name: name, arguments: args, lang: uiLang()})})
          .then(function (data) {
            var content;
            if (name === 'generate_image') {
              var head = card.querySelector('.mvmai-tool-head');
              if (data.__status === 200 && data.result && data.result.image_id) {
                if (head) head.textContent = '🖼 ' + t('mvmai_pub_image_done');
                showGeneratedImage(card, data.result.image_id, scrollDown);
                content = JSON.stringify(data.result);
              } else {
                if (head) head.textContent = '🖼 ' + imageErrorText(data.error);
                content = JSON.stringify({error: data.error || 'image_failed'});
              }
              return {role: 'tool', tool_call_id: call.id, content: content};
            }
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
          command: args.command || '', reason: args.reason || '', project_id: activeProject ? activeProject.id : null,
          section_id: activeProject ? activeProject.section_id || '' : null
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
          return api('/exec', {method: 'POST', body: JSON.stringify({command: args.command, confirmed: confirmed, project_id: activeProject ? activeProject.id : null, section_id: activeProject ? activeProject.section_id || '' : null})});
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
      // conversation forever. The summary is stateless and uncharged by mvmAI;
      // Claude/Codex also compact their original session before it is shown.
      // keepRecent itself defaults to 20 and is only adjustable
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
          session_id: sessionId,
          compact_cli: !!sessionId,
          compact_last: history[history.length - 1],
          app_id: chosenApp ? chosenApp.id : null,
          lang: uiLang(),
        })}).then(function (data) {
          if (data.__status !== 200 || !data.message || !data.message.content) {
            if (data.__status !== 409 && chatContext === compactedChat) {
              addBubble('assistant', t('mvmai_pub_compact_failed'));
            }
            return;
          }
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
            else if (m.role === 'section_switch') addSectionNote(m, null, null);
            else if ((m.role === 'user' || m.role === 'assistant') && m.content) addBubble(m.role, m.content, null, m.created_at, null, m.provider_label, m.duration_ms, m.place);
          });
          // Rendered after the recent bubbles (even though it summarizes the
          // older ones) so it lands as the newest, bottom-most item -- the
          // user is scrolled to the bottom mid-conversation and should see
          // it without having to scroll up looking for it.
          addCompactedNote(data.message.content);
          scrollDown();
        }).catch(function () {
          if (chatContext === compactedChat) addBubble('assistant', t('mvmai_pub_compact_failed'));
        });
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
        chosenApp = null; paintAppBtn();
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
        // The AI worked in another section during this answer: it is back with the person's section now.
        var finishing = ctx.turn;
        if (finishing && finishing.visited && Object.keys(finishing.visited).length && ctx.activeProject) {
          Promise.resolve(finishing.gitLast).then(function () {
            var raw = projects.filter(function (x) { return x.id === ctx.activeProject.id; })[0] || ctx.activeProject;
            var own = ctx.activeProject.section_id || '';
            recordSectionNote(ctx, raw, Object.keys(finishing.visited)[0], own, 'back', true, null);
          });
        }
        collapseGitPanels(ctx.turn);
        collapseLiveProgress(ctx.turn, ctx);
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
          current.eventSeq = 0; current.liveItems = null; current.livePanel = null;
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
            if (Number.isFinite(data.git_since) && !current.gitSince) current.gitSince = data.git_since;
            typing.updateActivity(data);
            showLiveActivity(data, current, ctx, typing);
            updateGitChanges(current, ctx, false);
            if (data.__status !== 202 || !data.pending) return Promise.resolve(data);
            return new Promise(function (resolve) { setTimeout(resolve, 2000); }).then(function () {
              if (current.stopped) return {error: 'stopped'};
              return api('/chat/turn/' + encodeURIComponent(current.id) + '?after=' + (current.eventSeq || 0),
                {signal: current.controller ? current.controller.signal : undefined});
            }).then(awaitTurn);
          }
          api('/chat', {method: 'POST', signal: current.controller ? current.controller.signal : undefined,
            body: JSON.stringify({messages: history, session_id: ctx.sessionId, project_id: ctx.activeProject ? ctx.activeProject.id : null, section_id: ctx.activeProject ? ctx.activeProject.section_id || '' : null,
              project_model: ctx.newProjectModel && history.length === 1 ? {provider: ctx.newProjectModel.provider, model: ctx.newProjectModel.model, branch: ctx.newProjectModel.branch || ''} : null,
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
            updateGitChanges(current, ctx, true);
            collapseGitPanels(current);
            collapseLiveProgress(current, ctx);
            history.push(msg);
            if (msg.content) addBubble('assistant', msg.content, null, msg.created_at, ctx, null, msg.duration_ms, msg.place);

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

      // Another app (Nostradamus "Start a discussion") can ask for one of the user's
      // chats to be opened: by an event when mvmAI is already open, by a one-shot
      // key when it is only now being opened.
      function takeOpenRequest(id) {
        try { if (!id || localStorage.getItem('mvmai_open_chat') === id) localStorage.removeItem('mvmai_open_chat'); } catch (_) {}
      }
      function onOpenChatRequest(event) {
        var id = event && event.detail;
        if (!id) return;
        takeOpenRequest(id);
        openSession(String(id));
      }
      window.addEventListener('mvmai-open-chat', onOpenChatRequest);
      openChatCleanup = function () { window.removeEventListener('mvmai-open-chat', onOpenChatRequest); };
      var requestedChat = null;
      try { requestedChat = localStorage.getItem('mvmai_open_chat'); } catch (_) {}
      if (requestedChat) { takeOpenRequest(requestedChat); openSession(requestedChat); }
    }

    return { destroy: function () {
      clearInterval(projectPoll); clearInterval(providerPoll); clearInterval(usagePoll); clearTimeout(titleRefreshTimer);
      if (sessionMenuCleanup) sessionMenuCleanup();
      if (openChatCleanup) openChatCleanup();
      reviewCleanups.forEach(function (cleanup) { cleanup(); });
      if (isDesktop) window.removeEventListener('settings-changed', refreshMessageTimes);
      if (termPanel) termPanel.destroy();
      if (agentPanel) agentPanel.destroy();
    } };
  }

  window.MvmaiWidget = { mount: mount };
})();
