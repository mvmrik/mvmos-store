// Tesla — one widget for the desktop window and the public page.
(function () {
  const API = '/pub/tesla';
  const t = (k, v) => (window.t || (x => x))(k, v);
  const V = window.TeslaViz;
  const { U, fmt, nf, esc } = V;
  const MODELS = { model3: 'Model 3', modely: 'Model Y', models: 'Model S', modelx: 'Model X', cybertruck: 'Cybertruck' };
  let chargeArtSeq = 0;
  const STATE_ICON = { online: '●', asleep: '☾', offline: '○', driving: '➤', charging: '⚡', unknown: '…' };

  const CSS = `
  .tsl{--tsl-pink:light-dark(#b62a78,#f472b6);--tsl-purple:light-dark(#7541bd,#a78bfa);--tsl-warning:light-dark(#946000,#fbbf24);--tsl-amber:light-dark(#996000,#f59e0b);--tsl-success:light-dark(#087552,#34d399);--tsl-mint:light-dark(#087552,#6ee7b7);--tsl-green:light-dark(#167739,#4ade80);--tsl-danger:light-dark(#b42335,#f87171);--tsl-rose:light-dark(#b4234b,#fb7185);--tsl-error:light-dark(#b42335,#fda4af);--tsl-info:light-dark(#245ea8,#93c5fd);--tsl-blue:light-dark(#2563b5,#60a5fa);--tsl-orange:light-dark(#a3470b,#fb923c);--tsl-muted:light-dark(#45566f,#a7bcdb);--tsl-seats:light-dark(#9b4b0e,#f4ad70);--tsl-heat:light-dark(#8d6200,#f9c56c);--tsl-climate:light-dark(#096e8d,#75d5f4);--tsl-security:light-dark(#6841bc,#b7a3fc)}
  .tsl.in-os{--pub-bg:var(--surface);--pub-surface1:var(--surface);--pub-surface2:var(--surface2);--pub-fg:var(--text);--pub-fg2:var(--text-dim);--pub-dim:var(--text-dim);--pub-border:var(--border);--pub-accent:var(--accent);--pub-accent-hover:var(--accent-hover);--pub-red:var(--danger)}

  .tsl-readonly #tsl-j-new,.tsl-readonly #tsl-j-edit,.tsl-readonly #tsl-j-delete,.tsl-readonly #tsl-j-action,.tsl-readonly #tsl-edit-charge-cost,.tsl-readonly #tsl-saveplace,.tsl-readonly #tsl-place-new,.tsl-readonly #tsl-tariff-new,.tsl-readonly [data-place-edit],.tsl-readonly [data-place-tariff],.tsl-readonly [data-tariff-edit],.tsl-readonly [data-tariff-delete]{display:none!important}
  .tsl-readonly .tsl-refresh:disabled{opacity:1;cursor:default;border-color:transparent}
  .tsl-shared-banner{padding:8px 12px;border:1px solid var(--pub-border,#ffffff20);border-radius:12px}.tsl-share-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 0;border-top:1px solid var(--pub-border,#ffffff15)}.tsl-share-row>div{flex:1;min-width:120px;overflow-wrap:anywhere}.tsl-share-row select{max-width:100%}.tsl-share-form select,.tsl-share-row select{padding:10px;background:var(--pub-surface2,#252d45);color:inherit;border:1px solid var(--pub-border,#ffffff20);border-radius:10px;font:inherit}

  .tsl-billing-dialog select,.tsl-billing-columns select{display:block;width:100%;max-width:100%;min-width:0;padding:11px;margin-top:7px;border:1px solid var(--pub-border,#ffffff20);border-radius:10px;background:var(--pub-surface2,#252d45);color:var(--pub-fg,#e6e9f2);font:inherit;color-scheme:inherit}
  .tsl-billing-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 12px}.tsl-billing-columns>label{min-width:0;display:block;font-size:.85rem;margin:12px 0;color:var(--pub-fg2,#9aa4bd)}.tsl-billing-dialog label:has([type=hidden]){min-width:0}.tsl-billing-dialog input[type=hidden]{display:none}
  .tsl-bill-season{display:flex;gap:8px}.tsl-bill-season select{flex:1}
  .tsl-bill-rule{padding:14px;border:1px solid var(--pub-border,#ffffff18);border-radius:14px;margin:12px 0;background:#889dc808}.tsl-bill-daysrow{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:4px 16px}.tsl-bill-season-field{display:block;font-size:.85rem;color:var(--pub-fg2,#9aa4bd);min-width:230px}.tsl-bill-days{display:flex;flex-wrap:wrap;gap:8px}.tsl-bill-days label{display:flex;align-items:center;gap:5px;margin:5px 0}.tsl-bill-days input[type=checkbox]{width:18px;height:18px;display:inline;margin:0;padding:0}
  .tsl-bill-bands{display:grid;gap:8px;margin:14px 0;font-size:.85rem;color:var(--pub-fg2,#9aa4bd)}.tsl-bill-bands b{color:var(--pub-fg,#e6e9f2);margin-right:5px}.tsl-bill-total{font-size:2.1rem;letter-spacing:-.04em;font-weight:750;margin:14px 0;overflow-wrap:anywhere}
  .tsl-bill-breakdown>div,.tsl-bill-place-total{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--pub-border,#ffffff12)}.tsl-bill-breakdown small,.tsl-bill-place-total small{display:block;color:var(--pub-fg2,#9aa4bd);font-size:.8rem;margin-top:5px}.tsl-bill-place-total>div{min-width:0}.tsl-bill-place-total>div b{overflow-wrap:anywhere}.tsl-bill-place-total>b{text-align:right;flex-shrink:0}
  .tsl-charge-tabs{gap:7px}.tsl-charge-tabs .tsl-btn{padding:9px 13px;min-height:40px}.tsl-billing-dialog .tsl-map{height:280px}
  @media(max-width:560px){.tsl-billing-columns{grid-template-columns:repeat(2,minmax(0,1fr))}.tsl-bill-total{font-size:1.65rem}.tsl-bill-rule{padding:10px}.tsl-charge-tabs .tsl-btn{flex:1;padding:8px;font-size:.8rem}.tsl-bill-place-total{align-items:flex-start;flex-wrap:wrap}}

  .tsl-drive-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:14px;margin-top:12px}
  .tsl-drive-card{display:block;width:100%;min-width:0;text-align:left;font:inherit;color:inherit;cursor:pointer;background:var(--pub-surface1,#1b2133);border:1px solid var(--pub-border,#ffffff18);border-radius:18px;padding:16px;box-shadow:0 3px 12px #0002;transition:border-color .15s,background .15s}
  .tsl-drive-card:hover{border-color:var(--pub-accent,var(--tsl-blue,#60a5fa));background:color-mix(in srgb,var(--pub-accent,var(--tsl-blue,#60a5fa)) 5%,var(--pub-surface1,#1b2133))}
  .tsl-drive-card:focus-visible{outline:2px solid var(--pub-accent,var(--tsl-blue,#60a5fa));outline-offset:3px}
  .tsl-drive-meta{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:.76rem;color:var(--pub-fg2,#9aa4bd)}
  .tsl-drive-meta time{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}.tsl-drive-meta time b{color:var(--pub-fg,#e6e9f2);font-weight:650}
  .tsl-drive-duration{white-space:nowrap;padding:5px 8px;background:var(--pub-surface2,#252d45);border-radius:8px}
  .tsl-drive-route{position:relative;display:grid;gap:13px;margin:18px 0;padding-left:23px;font-size:.98rem;font-weight:650;line-height:1.35}
  .tsl-drive-route:before{content:'';position:absolute;left:5px;top:8px;bottom:8px;width:2px;background:linear-gradient(var(--pub-accent,var(--tsl-blue,#60a5fa)),var(--tsl-success,#34d399))}
  .tsl-drive-route span{position:relative;overflow-wrap:anywhere}
  .tsl-drive-route span:before{content:'';position:absolute;left:-22px;top:.35em;width:10px;height:10px;border:2px solid var(--pub-accent,var(--tsl-blue,#60a5fa));border-radius:50%;background:var(--pub-surface1,#1b2133)}
  .tsl-drive-route span:last-child:before{border-color:var(--tsl-success,#34d399);background:var(--tsl-success,#34d399)}
  .tsl-drive-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
  .tsl-drive-metrics>span{min-width:0;padding:10px 6px;background:var(--pub-surface2,#252d45);border-radius:10px;text-align:center}
  .tsl-drive-metrics b{display:block;font-size:.95rem;font-weight:650;overflow-wrap:anywhere;line-height:1.4;font-variant-numeric:tabular-nums}
  .tsl-drive-metrics small{display:block;color:var(--pub-fg2,#9aa4bd);font-size:.62rem;line-height:1.3;margin-top:3px;overflow-wrap:anywhere}
  .tsl-drive-metrics>span:first-child b{color:var(--pub-accent,var(--tsl-blue,#60a5fa))}
  .tsl-drive-battery{display:flex;align-items:center;gap:10px;margin-top:13px;color:var(--pub-fg2,#9aa4bd);font-size:.72rem}
  .tsl-drive-battery>span{white-space:nowrap;font-variant-numeric:tabular-nums}
  .tsl-drive-battery-track{flex:1;min-width:20px;height:5px;background:var(--pub-bg,#0f1320);border-radius:9px;overflow:hidden;position:relative}
  .tsl-drive-battery-track i{position:absolute;top:0;bottom:0;left:0;border-radius:9px;background:var(--tsl-success,#34d399)}
  .tsl-drive-battery-track i.used{border-radius:0;background:var(--tsl-warning,#fbbf24)}
  @container(max-width:360px){.tsl-drive-card{padding:12px}.tsl-drive-metrics b{font-size:.84rem}.tsl-drive-meta{font-size:.7rem}.tsl-drive-list{gap:12px}}

  .tsl-journey-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:12px}
  .tsl-journey-card{position:relative;text-align:left;border:1px solid var(--pub-border,#ffffff12);color:inherit;font:inherit;cursor:pointer;min-width:0;width:100%;padding:20px}
  .tsl-journey-card:hover{border-color:var(--tsl-blue,#60a5fa)}.tsl-journey-card h2,.tsl-journey-heading h2{font-size:1.5rem;margin:10px 0;overflow-wrap:anywhere}.tsl-journey-card p{color:var(--pub-fg2,#9aa4bd);font-size:.85rem;line-height:1.6;padding-right:20px}.tsl-journey-card>span{position:absolute;right:18px;bottom:22px;color:var(--tsl-blue,#60a5fa)}
  .tsl-journey-heading{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}.tsl-journey-heading>div{min-width:0}.journey-active{background:#34d39926;color:var(--tsl-mint,#6ee7b7)}.journey-planned{color:var(--tsl-info,#93c5fd)}.journey-completed{color:var(--pub-fg2,#9aa4bd)}
  .tsl-report-summary{background:radial-gradient(ellipse at top left,#2563eb22,transparent),var(--pub-surface1,#1b2133)}.tsl-report-summary .tsl-tile{background:#8ca4df0a}.tsl-report-summary .tsl-tile b{font-variant-numeric:tabular-nums}
  .tsl-report-states{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.tsl-report-states>span{display:flex;align-items:center;gap:7px;font-size:.8rem;background:#8ca4df0a;border-radius:10px;padding:9px}.tsl-report-states i{width:7px;height:7px;border-radius:50%}.tsl-report-states b{margin-left:5px}
  .tsl-report-charts{display:grid;grid-template-columns:1fr 1fr;gap:12px;min-width:0}.tsl-report-charts>.tsl-card{min-width:0}
  .tsl-history-event{display:flex;align-items:flex-start;gap:12px;width:100%;text-align:left;background:transparent;color:inherit;font:inherit;border:0;border-bottom:1px solid var(--pub-border,#ffffff0d);padding:16px 0;min-width:0}.tsl-history-event>div{flex:1;min-width:0}.tsl-history-event b{font-size:.95rem;overflow-wrap:anywhere}.tsl-history-event small{display:block;color:var(--pub-fg2,#9aa4bd);font-size:.75rem;margin-top:5px;line-height:1.6}.tsl-history-event p{margin:8px 0 0;color:var(--tsl-muted,#a7bcdb);font-size:.85rem}button.tsl-history-event{cursor:pointer}button.tsl-history-event:hover{background:#8ca4df08}.tsl-history-icon{background:#60a5fa18;border-radius:12px;width:34px;height:34px;display:grid;place-items:center;flex-shrink:0;color:var(--tsl-info,#93c5fd)}.charge .tsl-history-icon{color:var(--tsl-mint,#6ee7b7);background:#34d39918}
  .tsl-journey-dialog,.tsl-journey-dialog *{box-sizing:border-box}.tsl-tire-dialog.tsl-journey-dialog{font-family:system-ui,sans-serif;color:var(--pub-fg,#e6e9f2)}
  .tsl-journey-dialog label{display:block;font-size:.85rem;margin:12px 0;color:var(--pub-fg2,#9aa4bd)}.tsl-journey-dialog input{display:block;width:100%;min-width:0;max-width:100%;margin-top:7px;padding:12px;border:1px solid var(--pub-border,#ffffff20);border-radius:10px;background:var(--pub-surface2,#252d45);color:var(--pub-fg,#e6e9f2);font:inherit;color-scheme:inherit}.tsl-journey-dates{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.tsl-journey-dates>label{min-width:0}.tsl-journey-error{color:var(--tsl-error,#fda4af);font-size:.85rem}.tsl-journey-dialog h2{font-size:1.3rem}.tsl-journey-dialog .tsl-note{line-height:1.6}
  @media(max-width:650px){.tsl-report-charts{grid-template-columns:1fr;gap:0}.tsl-journey-dates{grid-template-columns:1fr;gap:0}.tsl-report-summary .tsl-grid{grid-template-columns:1fr 1fr}.tsl-report-summary .tsl-tile{padding:10px}.tsl-report-summary .tsl-tile b{font-size:1.12rem}.tsl-journey-heading .tsl-btns{width:100%}.tsl-journey-heading .tsl-btns button{flex:1}}

  .tsl{container-type:inline-size;height:100%;overflow-y:auto;background:var(--pub-bg,#0f1320);color:var(--pub-fg,#e6e9f2);font-family:system-ui,sans-serif;-webkit-overflow-scrolling:touch}
  .tsl *{box-sizing:border-box}
  .tsl-wrap{max-width:1100px;margin:0 auto;padding:12px 14px 40px}
  .tsl-bar{position:sticky;top:0;z-index:5;background:linear-gradient(var(--pub-bg,#0f1320) 80%,transparent);padding:10px 0 8px}
  .tsl-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
  .tsl-tab{flex:0 0 auto;border:0;border-radius:999px;background:var(--pub-surface1,#1b2133);color:var(--pub-fg2,#9aa4bd);padding:10px 16px;font-size:.95rem;cursor:pointer;white-space:nowrap;min-height:42px}
  .tsl-tab.on{background:var(--pub-accent,var(--tsl-blue,#60a5fa));color:#0b1020;font-weight:700}
  .tsl-card{background:var(--pub-surface1,#1b2133);border-radius:18px;padding:16px;margin-top:12px;box-shadow:0 2px 14px #0004}
  .tsl-card h3{margin:0 0 10px;font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:var(--pub-fg2,#9aa4bd);font-weight:600}
  .tsl-hero{padding:16px;overflow:hidden;container-type:inline-size;background:radial-gradient(ellipse at 56% 52%,var(--pub-surface2,#252d45),var(--pub-surface1,#1b2133) 72%)}
  .tsl-hero-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
  .tsl-hero h2{margin:0;font-size:1.65rem;letter-spacing:-.04em;overflow-wrap:anywhere}
  .tsl-sub{color:var(--pub-fg2,#9aa4bd);font-size:.85rem;margin-top:4px}
  .tsl-cockpit{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(0,1fr);align-items:center;gap:18px;max-width:760px;margin:2px auto}
  .tsl-car-stage{position:relative;min-width:0;width:100%;max-width:400px;justify-self:center;aspect-ratio:1.05;isolation:isolate}
  .tsl-car-stage:before{content:'';position:absolute;inset:9% 17%;border:1px solid var(--pub-border,#ffffff0d);border-radius:50%;box-shadow:0 0 0 30px #8da7d603,0 0 0 60px #8da7d603;z-index:-1}
  .tsl-car{position:absolute;left:24%;top:0;width:52%;height:100%;filter:drop-shadow(0 10px 10px #0004)}
  .tsl-pressure{position:absolute;top:23%;width:max(11%,44px);height:max(14%,44px);border:0;background:transparent;color:var(--pub-fg2,#9aa4bd);padding:0;display:flex;align-items:center;cursor:pointer;z-index:2;font:inherit;font-variant-numeric:tabular-nums}
  .tsl-pressure.fl,.tsl-pressure.rl{left:25%;justify-content:flex-start}.tsl-pressure.fr,.tsl-pressure.rr{right:25%;justify-content:flex-end}
  .tsl-pressure.rl,.tsl-pressure.rr{top:69%}
  .tsl-pressure b{writing-mode:vertical-rl;text-orientation:mixed;font-size:.68rem;font-weight:550;white-space:nowrap;line-height:1.3}
  .tsl-pressure.warn{color:var(--tsl-warning,#fbbf24)}.tsl-pressure.bad{color:var(--tsl-danger,#f87171)}
  .tsl-pressure:hover{color:var(--pub-fg,#e6e9f2)}.tsl-pressure:hover b{background:var(--pub-surface2,#252d45);border-radius:5px}
  .tsl-pressure:focus-visible{outline:2px solid var(--pub-accent,var(--tsl-blue,#60a5fa));outline-offset:2px;border-radius:8px}
  .tsl-glass-lock{fill:none;stroke:#e2eaf5;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
  .tsl-glass-lock.unlocked{stroke:#fbbf24}
  .tsl-energy{min-width:0;--energy:#74c3fa;padding:18px;border-radius:19px;border:1px solid color-mix(in srgb,var(--energy) 16%,var(--pub-border,#ffffff12));background:radial-gradient(ellipse at 0 0,color-mix(in srgb,var(--energy) 9%,transparent),transparent 75%),color-mix(in srgb,var(--pub-surface2,#252d45) 48%,transparent);box-shadow:inset 0 1px 0 #ffffff05}
  .tsl-energy-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}
  .tsl-energy-label{display:flex;align-items:center;gap:7px;font-size:.69rem;color:var(--pub-fg2,#9aa4bd);font-weight:600;letter-spacing:.06em;text-transform:uppercase;min-width:0}
  .tsl-energy-label svg{width:19px;height:19px;flex:0 0 19px;fill:none;stroke:var(--energy);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
  .tsl-energy-limit{font-size:.69rem;line-height:1.3;color:var(--pub-fg2,#9aa4bd);background:var(--pub-bg,#0f1320);border:1px solid var(--pub-border,#ffffff0d);padding:5px 8px;border-radius:7px;white-space:nowrap}
  .tsl-energy-metrics{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;align-items:end;margin:20px 0 18px}
  .tsl-energy-value{font-size:3.2rem;line-height:1;font-weight:650;letter-spacing:-.06em;font-variant-numeric:tabular-nums;white-space:nowrap}
  .tsl-energy-value small{font-size:1.3rem;color:var(--pub-fg2,#9aa4bd);margin-left:3px;font-weight:400;letter-spacing:-.02em}
  .tsl-energy-distance{text-align:right;min-width:0;padding-bottom:3px}
  .tsl-energy-distance>span{display:block;font-size:.66rem;color:var(--pub-fg2,#9aa4bd);margin-bottom:5px}
  .tsl-energy-range{font-size:1.45rem;line-height:1.1;font-weight:600;letter-spacing:-.04em;font-variant-numeric:tabular-nums;white-space:nowrap}
  .tsl-energy-range small{font-size:.78rem;color:var(--pub-fg2,#9aa4bd);font-weight:400;letter-spacing:0}
  .tsl-energy-track{height:14px;position:relative;background:var(--pub-bg,#0f1320);border-radius:5px;border:1px solid var(--pub-border,#ffffff08);isolation:isolate}
  .tsl-energy-track:before{content:'';position:absolute;left:0;top:0;height:100%;width:var(--level);border-radius:4px;background:linear-gradient(90deg,color-mix(in srgb,var(--energy) 76%,#fff),var(--energy));box-shadow:0 0 18px color-mix(in srgb,var(--energy) 14%,transparent)}
  .tsl-energy-track:after{content:'';position:absolute;inset:0;border-radius:4px;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(10% - 2px),var(--pub-surface1,#1b2133) calc(10% - 2px),var(--pub-surface1,#1b2133) 10%);opacity:.7;pointer-events:none}
  .tsl-energy-track i{position:absolute;top:-4px;bottom:-4px;left:clamp(0px,var(--limit),calc(100% - 2px));width:2px;background:var(--pub-fg,#e6e9f2);border-radius:2px;z-index:1;opacity:.85}
  .tsl-live-status{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
  .tsl-live-status .tsl-pill{margin:0;font-size:.78rem;padding:5px 9px}
  .tsl-refresh{font:inherit;cursor:pointer;color:var(--pub-fg2,#9aa4bd);border:1px solid var(--pub-border,#ffffff20);background:transparent;border-radius:999px;min-height:38px;padding:6px 9px;font-size:.76rem}
  .tsl-refresh:hover{background:var(--pub-surface2,#252d45);color:var(--pub-fg,#e6e9f2)}
  .tsl-refresh:disabled{opacity:.5;cursor:wait}.tsl-refresh:focus-visible{outline:2px solid var(--pub-accent,var(--tsl-blue,#60a5fa));outline-offset:2px}
  .tsl-roof-temp{position:absolute;left:34%;top:40%;width:32%;text-align:center;pointer-events:none;font-size:1.2rem;color:#e2eaf5;font-weight:650;white-space:nowrap;text-shadow:0 1px 4px #000}
  .tsl-outside-temp{position:absolute;left:34%;top:13%;width:32%;text-align:center;line-height:1.25;color:#172333;background:#eef5fbe6;border-radius:7px;padding:2px 0}
  .tsl-outside-temp span{display:block;font-size:.6rem}.tsl-outside-temp b{font-size:.95rem}
  @container(max-width:330px){.tsl-roof-temp{font-size:1rem}.tsl-outside-temp b{font-size:.8rem}.tsl-outside-temp span{font-size:.55rem}}
  .tsl-climate-stream{fill:none;stroke:#a7edff;stroke-width:1.8;stroke-linecap:round;stroke-dasharray:12 24;animation:tsl-airflow 2.4s linear infinite;opacity:.8}
  .tsl-climate-haze{animation:tsl-airglow 3.5s ease-in-out infinite;opacity:.65}
  @keyframes tsl-airflow{to{stroke-dashoffset:-72}}
  @keyframes tsl-airglow{50%{opacity:.95}}
  .tsl-climate-glass{position:absolute;left:24%;top:0;width:52%;height:100%;pointer-events:none;overflow:visible}
  .tsl-climate-glass text{text-anchor:middle;font-family:inherit;fill:#e2f7ff;paint-order:stroke;stroke:#0b1727;stroke-width:2px;stroke-linejoin:round}
  .tsl-climate-glass .tsl-zone-value{font-size:14px;font-weight:650}
  @media(prefers-reduced-motion:reduce){.tsl-climate-stream,.tsl-climate-haze{animation:none}}
  .tsl-charge-cable{position:absolute;left:24%;top:0;width:52%;height:100%;overflow:visible;pointer-events:none;z-index:1}
  .tsl-charge-current{fill:none;stroke:#a7ffd9;stroke-width:3;stroke-linecap:round;stroke-dasharray:4 18;animation:tsl-charge-flow 1.7s linear infinite}
  @keyframes tsl-charge-flow{to{stroke-dashoffset:-66}}
  .tsl-charge-hit{position:absolute;left:2%;top:83%;width:34%;height:15%;min-height:44px;cursor:pointer;background:transparent;border:0;border-radius:12px;z-index:3}
  .tsl-charge-hit:hover{background:#5ff5bc0a}.tsl-charge-hit:focus-visible{outline:2px solid var(--tsl-mint,#6ee7b7);outline-offset:2px}
  .tsl-tire-dialog.tsl-charge-dialog{width:min(980px,calc(100vw - 24px));padding:18px;background:radial-gradient(ellipse at 24% 35%,color-mix(in srgb,var(--tsl-success) 12%,var(--pub-surface1,#1b2133)),var(--pub-surface1,#1b2133) 65%)}
  .tsl-charge-dialog header{position:sticky;top:-18px;z-index:2;background:var(--pub-surface1,#1b2133);border-radius:12px;padding:8px;margin:-4px -4px 12px}
  .tsl-charge-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:20px;align-items:center;margin-top:14px}
  .tsl-charge-floor{min-width:0;text-align:center}.tsl-charge-floor>svg{display:block;width:100%;max-height:490px}
  .tsl-charge-floor small{display:block;font-size:.75rem;color:var(--pub-fg2,#9aa4bd);margin-top:4px}
  .tsl-charge-summary{min-width:0}.tsl-charge-pct{font-size:3.6rem;line-height:1;font-weight:650;letter-spacing:-.05em;margin:0 0 12px;color:var(--tsl-success)}.tsl-charge-pct small{font-size:1.35rem;margin-left:4px;font-weight:400}
  .tsl-charge-target{display:flex;align-items:baseline;justify-content:space-between;gap:12px;color:var(--pub-fg2,#9aa4bd);font-size:.8rem}
  .tsl-charge-target strong{color:var(--pub-fg,#e6e9f2);font-size:1rem}
  .tsl-charge-progress{height:9px;background:var(--pub-bg,#0f1320);border-radius:9px;overflow:hidden;margin:10px 0 18px}.tsl-charge-progress i{display:block;height:100%;background:linear-gradient(90deg,#21bfa0,#b3ffcb);border-radius:9px}
  .tsl-charge-metrics{display:grid;grid-template-columns:1fr 1fr;gap:9px}
  .tsl-charge-metrics .tsl-tile{padding:11px}.tsl-charge-metrics .tsl-tile b{font-size:1.25rem}.tsl-charge-metrics .tsl-tile span{font-size:.65rem}
  .tsl-charge-electrical{display:flex;justify-content:space-around;gap:8px;flex-wrap:wrap;padding:14px 0;margin-top:10px;border-top:1px solid var(--pub-border,#ffffff18);border-bottom:1px solid var(--pub-border,#ffffff18)}
  .tsl-charge-electrical div{text-align:center}.tsl-charge-electrical b{display:block;font-size:1rem}.tsl-charge-electrical span{display:block;font-size:.65rem;color:var(--pub-fg2,#9aa4bd);margin-top:3px}
  .tsl-charge-footer{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;color:var(--pub-fg2,#9aa4bd);font-size:.75rem;margin-top:12px;line-height:1.5}
  @media(max-width:650px){.tsl-charge-layout{grid-template-columns:minmax(0,1fr);gap:12px}.tsl-charge-floor>svg{height:310px;max-height:none}.tsl-tire-dialog.tsl-charge-dialog{padding:12px}.tsl-charge-dialog header{top:-12px}.tsl-charge-pct{font-size:2.8rem}.tsl-charge-metrics .tsl-tile b{font-size:1.1rem}}
  @media(prefers-reduced-motion:reduce){.tsl-charge-current{animation:none}}
  .tsl-energy-side{min-width:0}.tsl-active-status{margin-bottom:12px}
  .tsl-status-groups{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .tsl-status-icon{position:relative;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;flex:0 0 38px;border:1px solid color-mix(in srgb,var(--status-color) 35%,transparent);border-radius:10px;background:color-mix(in srgb,var(--status-color) 9%,transparent);color:var(--status-color);padding:7px;cursor:pointer;font:inherit}
  .tsl-status-icon svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
  .tsl-status-icon:hover{background:color-mix(in srgb,var(--status-color) 23%,transparent)}.tsl-status-icon:focus-visible{outline:2px solid var(--status-color);outline-offset:2px}.tsl-status-icon.passive{cursor:default}
  .tsl-status-level{position:absolute;left:3px;bottom:2px;display:flex;gap:2px}.tsl-status-level i{width:3px;height:3px;border-radius:50%;background:currentColor}
  .tsl-status-auto{position:absolute;right:2px;top:1px;font-size:.65rem;line-height:1}
  .tsl-tire-dialog.tsl-status-dialog{width:min(850px,calc(100vw - 24px));background:radial-gradient(ellipse at 25% 45%,color-mix(in srgb,var(--status-color) 10%,var(--pub-surface1,#1b2133)),var(--pub-surface1,#1b2133) 65%)}
  .tsl-status-detail{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:20px;align-items:center;margin-top:14px}.tsl-status-art svg{width:100%;display:block;max-height:400px}
  .tsl-status-headline{display:flex;gap:12px;align-items:center;margin-bottom:15px;color:var(--status-color)}.tsl-status-headline>svg{width:42px;height:42px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}.tsl-status-headline b{font-size:2rem;font-weight:600}
  .tsl-status-readings{display:grid;grid-template-columns:1fr 1fr;gap:9px}.tsl-status-readings .tsl-tile{padding:12px}.tsl-status-readings .tsl-tile b{font-size:1.05rem}.tsl-status-readings .tsl-tile span{font-size:.65rem}
  .tsl-status-hot{fill:none;stroke:var(--status-color);stroke-width:2.5;stroke-linecap:round;stroke-dasharray:12 9;animation:tsl-status-heat 2s linear infinite}
  @keyframes tsl-status-heat{to{stroke-dashoffset:-42}}
  @media(max-width:560px){.tsl-status-detail{grid-template-columns:minmax(0,1fr);gap:8px}.tsl-status-art svg{height:240px}.tsl-status-headline{margin-bottom:10px}.tsl-status-headline b{font-size:1.6rem}}
  @media(prefers-reduced-motion:reduce){.tsl-status-hot{animation:none}}
  .tsl-ring{width:100%;max-width:210px;justify-self:end}
  .tsl-ring-v{font-size:46px;font-weight:700;fill:var(--pub-fg,#e6e9f2)}.tsl-ring-u{font-size:20px;fill:var(--pub-fg2,#9aa4bd)}.tsl-ring-s{font-size:15px;fill:var(--pub-fg2,#9aa4bd)}
  .tsl-row .d.dc{flex:0 0 18px}.tsl-tile.warn{box-shadow:inset 0 0 0 2px var(--tsl-amber,#f59e0b)}.tsl-tile.bad{box-shadow:inset 0 0 0 2px #ef4444}
  .tsl-tires{display:grid;grid-template-columns:1fr minmax(70px,110px) 1fr;gap:10px;align-items:center}
  .tsl-tire{background:var(--pub-surface2,#252d45);border-radius:14px;padding:12px 14px;text-align:center}.tsl-tire span{display:block;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--pub-fg2,#9aa4bd)}
  .tsl-tire b{display:block;font-size:1.3rem;margin:3px 0}.tsl-tire small{color:var(--pub-fg2,#9aa4bd)}
  .tsl-tire.warn{box-shadow:inset 0 0 0 2px var(--tsl-amber,#f59e0b)}.tsl-tire.warn small{color:var(--tsl-amber,#f59e0b)}.tsl-tire.bad{box-shadow:inset 0 0 0 2px #ef4444}.tsl-tire.bad small{color:#ef4444}
  .tsl-tire-dialog{color:inherit;background:var(--pub-surface1,#1b2133);border:1px solid var(--pub-border,#ffffff22);border-radius:20px;padding:16px;width:min(860px,calc(100vw - 24px));max-width:none;max-height:calc(100dvh - 32px);overflow:auto;overscroll-behavior:contain;box-shadow:0 24px 100px #0008}
  .tsl-tire-dialog::backdrop{background:#070c18b8;backdrop-filter:blur(5px)}
  .tsl-tire-dialog header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.tsl-tire-dialog header h2{font-size:1.1rem;margin:0}
  .tsl-tire-dialog .tsl-card{padding:0;margin:0;box-shadow:none}.tsl-tire-dialog .tsl-card>h3:first-child{display:none}.tsl-tire-dialog .tsl-tires{grid-template-columns:minmax(0,1fr) 70px minmax(0,1fr)}
  .tsl-tire-dialog .tsl-tire{padding:10px;min-width:0}.tsl-tire-dialog .tsl-tire small{display:block;font-size:.75rem}.tsl-tire-dialog .tsl-tire .tsl-measured{font-size:.68rem;margin-top:5px;color:var(--pub-fg2,#9aa4bd)}
  .tsl-tire-legend{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;font-size:.75rem;color:var(--pub-fg2,#9aa4bd)}
  @media(max-width:560px){.tsl-tire-dialog .tsl-tires{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.tsl-tire-dialog .tsl-tire b{font-size:1.12rem}}
  .tsl-tcar svg{width:100%;max-height:150px}
  .tsl-kv{display:flex;gap:10px;justify-content:space-between;align-items:baseline;padding:8px 4px;border-bottom:1px solid var(--pub-border,#ffffff14);cursor:pointer;flex-wrap:wrap}
  .tsl-kv:hover{background:#ffffff08}.tsl-kv code{color:var(--pub-fg2,#9aa4bd);font-size:.85rem;word-break:break-all}.tsl-kv span{font-weight:600;text-align:right;word-break:break-word}
  .tsl-sec summary{cursor:pointer;list-style:none;display:flex;gap:8px;align-items:baseline;margin-bottom:6px;font-size:1.05rem}.tsl-sec summary small{color:var(--pub-fg2,#9aa4bd)}
  .tsl-sit{padding:12px 0;border-top:1px solid var(--pub-border,#ffffff14)}.tsl-sit-h{display:flex;flex-direction:column;gap:2px;margin-bottom:6px}.tsl-sit-h small{color:var(--pub-fg2,#9aa4bd)}
  .tsl-schedule-time{display:inline-block;min-width:105px}.tsl-schedule-time .mvm-picker-trigger{padding:7px 10px;font-size:.85rem}
  .tsl-sit-r{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}.tsl-sit-r label{color:var(--pub-fg2,#9aa4bd);font-size:.9rem;min-width:70px}.tsl-sit-r small{color:var(--pub-fg2,#9aa4bd)}
  .tsl-every{display:inline-flex;gap:6px;align-items:center}.tsl-every input,.tsl-sit input[type=time],.tsl-sit input[type=number]{background:var(--pub-bg,#0f1320);color:inherit;border:1px solid var(--pub-border,#ffffff22);border-radius:10px;padding:9px;font-size:1rem}
  .tsl-every input{width:84px}.tsl-every select{background:var(--pub-bg,#0f1320);color:inherit;border:1px solid var(--pub-border,#ffffff22);border-radius:10px;padding:9px;font-size:1rem}
  .tsl-rule{background:var(--pub-surface2,#252d45);border-radius:12px;padding:8px 10px;margin:6px 0}.tsl-days{display:flex;gap:4px;flex-wrap:wrap}
  .tsl-days button{border:0;border-radius:8px;background:var(--pub-bg,#0f1320);color:var(--pub-fg2,#9aa4bd);padding:7px 9px;cursor:pointer;font-size:.85rem}.tsl-days button.on{background:var(--pub-accent,var(--tsl-blue,#60a5fa));color:#0b1020;font-weight:700}
  .tsl-dot{display:inline-block;width:12px;height:12px;border-radius:50%;vertical-align:middle}.tsl-pulse{animation:tslp 2.2s ease-in-out infinite}@keyframes tslp{50%{opacity:.55}}
  .tsl-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 12px;font-size:.85rem;font-weight:700;margin-top:8px;color:#0b1020}
  .tsl-setup-feedback{box-sizing:border-box;margin:12px 0;padding:14px 16px;border:1px solid var(--tsl-blue,#60a5fa);border-radius:12px;background:#17283f;color:#e0efff;line-height:1.5;font-size:1rem;overflow-wrap:anywhere;scroll-margin:16px}
  .tsl-setup-feedback[hidden]{display:none}.tsl-setup-feedback[data-state="error"]{border-color:var(--tsl-rose,#fb7185);background:#3d1b29;color:#ffe4e6}.tsl-setup-feedback[data-state="success"]{border-color:var(--tsl-green,#4ade80);background:#143326;color:#dcfce7}
  .tsl-note{color:var(--pub-fg2,#9aa4bd);font-size:.85rem;margin-top:8px;line-height:1.4}
  .tsl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  .tsl-tile{background:var(--pub-surface2,#252d45);border-radius:14px;padding:12px 14px}
  .tsl-tile{min-width:0}.tsl-tile span{overflow-wrap:anywhere;display:block;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--pub-fg2,#9aa4bd)}
  .tsl-tile b{display:block;font-size:1.3rem;margin-top:3px;overflow-wrap:break-word}
  .tsl-tile small{display:block;color:var(--pub-fg2,#9aa4bd);margin-top:2px;font-size:.8rem}
  .tsl-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
  .tsl-map{position:relative;height:300px;border-radius:14px;overflow:hidden;background:var(--tsl-map-bg,#1d2230);touch-action:none;cursor:grab}
  .tsl-map.tall{height:380px}
  .tsl-tiles img{position:absolute;width:256px;height:256px;max-width:none;filter:var(--tsl-map-filter,invert(1) hue-rotate(180deg) brightness(.82) contrast(.92) saturate(.7));user-select:none}
  .tsl-route{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
  .tsl-zoom{position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:4px}
  .tsl-zoom button{width:34px;height:34px;border:0;border-radius:9px;background:#fffd;color:#111;font-size:1.2rem;cursor:pointer}
  .tsl-attr{position:absolute;left:6px;bottom:4px;font-size:.65rem;color:#fffc;text-shadow:0 0 3px #000}
  .tsl-row{display:flex;gap:12px;align-items:center;padding:12px 4px;border-bottom:1px solid var(--pub-border,#ffffff14);cursor:pointer;flex-wrap:wrap}
  .tsl-row:last-child{border:0}
  .tsl-row:hover{background:#ffffff08}
  .tsl-row .d{flex:0 0 76px;color:var(--pub-fg2,#9aa4bd);font-size:.85rem}
  .tsl-row .m{flex:1 1 220px;min-width:0}
  .tsl-row .m b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tsl-row .m small{color:var(--pub-fg2,#9aa4bd)}
  .tsl-row .s{display:flex;gap:14px;flex-wrap:wrap;font-size:.92rem}
  .tsl-row .s span{white-space:nowrap}
  .tsl-badge{display:inline-block;border-radius:6px;padding:1px 7px;font-size:.72rem;font-weight:700;background:var(--pub-surface2,#252d45);margin-left:6px;vertical-align:middle}
  .tsl-badge.dc{background:var(--tsl-amber,#f59e0b);color:#1a1204}
  .tsl-btn{border:0;border-radius:12px;background:var(--pub-surface2,#252d45);color:inherit;font-size:.95rem;padding:10px 16px;cursor:pointer;min-height:42px}
  .tsl-btn.pri{background:var(--pub-accent,var(--tsl-blue,#60a5fa));color:#0b1020;font-weight:700}
  .tsl-btn.bad{background:#7f1d1d;color:#fff}
  .tsl-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
  .tsl-chart{position:relative}.tsl-chart svg{width:100%;height:auto;display:block;overflow:visible}
  .tsl-grid{stroke:var(--pub-border,#ffffff1a);stroke-width:1}.tsl-ax{fill:var(--pub-fg2,#9aa4bd);font-size:11px}.tsl-cross{stroke:#fff;stroke-opacity:.35;stroke-width:1}
  .tsl-tip{position:absolute;top:0;pointer-events:none;background:#000d;color:#fff;border-radius:8px;padding:6px 9px;font-size:.78rem;line-height:1.35;white-space:nowrap}
  .tsl-empty{color:var(--pub-fg2,#9aa4bd);padding:22px 8px;text-align:center}
  .tsl-strip{position:relative;height:26px;border-radius:8px;overflow:hidden;background:var(--pub-surface2,#252d45)}
  .tsl-strip div{position:absolute;top:0;bottom:0}
  .tsl-legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:.78rem;color:var(--pub-fg2,#9aa4bd)}
  .tsl-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px}
  .tsl-seg{display:inline-flex;background:var(--pub-surface2,#252d45);border-radius:12px;padding:3px;gap:2px;margin:0 0 4px}
  .tsl-seg button{border:0;background:none;color:var(--pub-fg2,#9aa4bd);padding:8px 14px;border-radius:9px;cursor:pointer;font-size:.9rem}
  .tsl-seg button.on{background:var(--pub-accent,var(--tsl-blue,#60a5fa));color:#0b1020;font-weight:700}
  .tsl-bar2{height:10px;border-radius:6px;background:var(--pub-surface2,#252d45);overflow:hidden;margin:10px 0 6px}
  .tsl-bar2 div{height:100%;background:linear-gradient(90deg,var(--tsl-blue,#60a5fa),var(--tsl-green,#4ade80))}
  .tsl-field{display:flex;flex-direction:column;gap:4px;margin:10px 0}
  .tsl-field label{font-size:.82rem;color:var(--pub-fg2,#9aa4bd)}
  .tsl-field input{background:var(--pub-bg,#0f1320);color:inherit;border:1px solid var(--pub-border,#ffffff22);border-radius:10px;padding:11px;font-size:1rem;width:100%}
  #tsl-credentials input{display:block;box-sizing:border-box;width:100%;min-width:0;margin-top:7px;padding:11px;border:1px solid var(--pub-border,#ffffff20);border-radius:10px;background:var(--pub-surface2,#252d45);color:var(--pub-fg,#e6e9f2);font:inherit}
  .tsl-setup summary{cursor:pointer;font-weight:650;padding:8px 0}.tsl-setup ol{padding-left:24px;margin:12px 0}.tsl-setup li{padding:7px 0;line-height:1.6}.tsl-setup a{color:var(--pub-accent,#79c8ff)}.tsl-setup-address{margin:12px 0;min-width:0}.tsl-setup-address label{display:block;font-size:.85rem;margin-bottom:6px;color:var(--pub-fg2,#9aa4bd)}.tsl-setup-copy{display:flex;align-items:flex-start;gap:8px;min-width:0}.tsl-setup-copy .tsl-code{flex:1;min-width:0}.tsl-setup-copy button{flex-shrink:0}.tsl-setup-warning{color:var(--tsl-warning,#fbbf24)}
  .tsl-code{background:var(--pub-bg,#0f1320);border-radius:10px;padding:10px 12px;font-family:monospace;font-size:.85rem;word-break:break-all;user-select:all}
  .tsl-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#111c;color:#fff;border-radius:12px;padding:12px 18px;z-index:30;max-width:90vw;text-align:center;backdrop-filter:blur(6px)}
  .tsl-dlg{position:fixed;inset:0;background:#000a;z-index:20;display:flex;align-items:center;justify-content:center;padding:16px}
  .tsl-dlg>div{background:var(--pub-surface1,#1b2133);border-radius:18px;padding:20px;width:100%;max-width:420px;max-height:90vh;overflow:auto}
  .tsl-place{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--pub-border,#ffffff14)}
  .tsl-place:last-child{border:0}.tsl-place div{flex:1;min-width:0}
  .tsl-center{text-align:center;padding:50px 16px;color:var(--pub-fg2,#9aa4bd);line-height:1.6}
  .tsl-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0 2px}
  .tsl-head h2{margin:0;font-size:1.3rem;flex:1}
  @media(max-width:560px){.tsl-tires{grid-template-columns:1fr 1fr}.tsl-tcar,.tsl-tgap{display:none}.tsl-row .m b{white-space:normal}.tsl-ring{justify-self:center;max-width:190px}.tsl-row .d{flex-basis:100%}}
  /* Put compact side rails around the full-size car on narrow screens. */
  @container(max-width:600px){
    .tsl-wrap{padding:4px 10px 24px}.tsl-bar{padding:4px 0}.tsl-tab{padding:8px 13px;font-size:.85rem}
    .tsl-hero{padding:12px;margin-top:6px;border-radius:16px}
    .tsl-hero-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 8px;align-items:center}
    .tsl-hero-head>div,.tsl-live-status{display:contents}
    .tsl-hero h2{font-size:1.25rem;grid-column:1;grid-row:1}
    .tsl-hero-head .tsl-sub{grid-column:1;grid-row:2;font-size:.7rem;margin:0;overflow-wrap:anywhere}
    .tsl-live-status .tsl-pill{grid-column:2;grid-row:1;justify-self:end;font-size:.68rem;padding:4px 7px;white-space:nowrap}
    .tsl-live-status .tsl-refresh{grid-column:2;grid-row:2;justify-self:end;min-height:36px;padding:4px 8px;font-size:.7rem}
    .tsl-cockpit{position:relative;grid-template-columns:80px minmax(0,1fr) 40px;gap:6px;max-width:520px;margin:8px auto 0;align-items:center}
    .tsl-energy-side{display:contents}
    .tsl-car-stage{grid-column:2;grid-row:1;aspect-ratio:.6;max-width:240px}
    .tsl-car,.tsl-climate-glass,.tsl-charge-cable{left:0;width:100%}
    .tsl-pressure.fl,.tsl-pressure.rl{left:3%}.tsl-pressure.fr,.tsl-pressure.rr{right:3%}
    .tsl-pressure b{font-size:.65rem}.tsl-roof-temp{left:25%;width:50%;font-size:1.3rem}
    .tsl-outside-temp{left:25%;width:50%}.tsl-outside-temp b{font-size:.95rem}
    .tsl-energy{grid-column:1;grid-row:1;padding:0;border:0;border-radius:0;background:none;box-shadow:none}
    .tsl-energy-head{flex-direction:column;align-items:flex-start;gap:9px}
    .tsl-energy-label{font-size:.6rem;letter-spacing:0;gap:4px;flex-wrap:wrap}
    .tsl-energy-label svg{width:16px;height:16px;flex-basis:16px}
    .tsl-energy-limit{font-size:.6rem;padding:4px 5px;white-space:normal}
    .tsl-energy-metrics{grid-template-columns:minmax(0,1fr);gap:20px;margin:14px 0}
    .tsl-energy-value{font-size:2.15rem}.tsl-energy-value small{font-size:.9rem;margin-left:1px}
    .tsl-energy-distance{text-align:left;padding:0}.tsl-energy-distance>span{margin-bottom:5px}
    .tsl-energy-range{font-size:1.3rem;white-space:normal}.tsl-energy-range small{display:block;margin-top:3px}
    .tsl-energy-track{width:14px;height:88px;margin-top:18px}
    .tsl-energy-track:before{top:auto;bottom:0;width:100%;height:var(--level);background:linear-gradient(0deg,color-mix(in srgb,var(--energy) 76%,#fff),var(--energy))}
    .tsl-energy-track:after{background:repeating-linear-gradient(0deg,transparent 0,transparent calc(10% - 2px),var(--pub-surface1,#1b2133) calc(10% - 2px),var(--pub-surface1,#1b2133) 10%)}
    .tsl-energy-track i{top:auto;bottom:clamp(0px,var(--limit),calc(100% - 2px));left:-3px;right:-3px;width:auto;height:2px}
    .tsl-active-status{position:absolute;inset:0;grid-column:3;grid-row:1;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;margin:0;padding:2px 0;overscroll-behavior:contain}
    .tsl-status-groups{flex-direction:column;flex-wrap:nowrap;gap:6px}
    .tsl-charge-hit{left:0;width:30%}
  }
  @container(max-width:330px){
    .tsl-cockpit{grid-template-columns:68px minmax(0,1fr) 40px;gap:4px}
    .tsl-energy-value{font-size:1.9rem}.tsl-energy-label{font-size:.56rem}
    .tsl-energy-track{height:64px;margin-top:12px}.tsl-energy-metrics{gap:14px}

  }
  .tsl-sit{margin-top:12px;padding:14px;background:color-mix(in srgb,var(--pub-surface2,#252d45) 55%,transparent);border:1px solid var(--pub-border,#ffffff0d);border-radius:12px}
  .tsl-sit-h{gap:5px;margin-bottom:10px}.tsl-sit-h small{line-height:1.5}.tsl-share-row{margin-top:10px;padding:12px;background:var(--pub-surface2,#252d45);border:0;border-radius:12px}
  .tsl-journey-period{display:grid;gap:9px;margin-top:15px;padding-left:12px;border-left:2px solid var(--pub-accent,var(--tsl-blue,#60a5fa));font-size:.85rem;line-height:1.5;color:var(--pub-fg2,#9aa4bd)}.tsl-journey-period span{overflow-wrap:anywhere}.tsl-journey-period small{display:block;font-size:.65rem;text-transform:uppercase;letter-spacing:.04em}
  /* Shared history cards and readable report surfaces. */
  .tsl-charge-card{--session-color:var(--tsl-success,#34d399)}.tsl-charge-card.dc{--session-color:var(--tsl-warning,#fbbf24)}
  .tsl-charge-location{display:flex;gap:10px;align-items:center;margin:18px 0;min-width:0}.tsl-charge-location strong{flex:1;min-width:0;font-size:1rem;line-height:1.4;overflow-wrap:anywhere}
  .tsl-charge-location .tsl-badge{max-width:35%;margin:0;white-space:normal;font-size:.65rem;line-height:1.4;padding:4px 7px}
  .tsl-session-icon{display:grid;place-items:center;flex:0 0 34px;height:42px;border-radius:11px;color:var(--session-color);background:color-mix(in srgb,var(--session-color) 12%,transparent)}
  .tsl-session-icon svg{width:23px;height:27px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linejoin:round}
  .tsl-charge-card .tsl-drive-metrics>span:first-child b{color:var(--session-color)}.tsl-drive-battery-track i.before{background:#30876b}
  .tsl-event-list{display:grid;gap:10px;margin-top:14px}
  .tsl-state-event{display:flex;gap:12px;padding:14px;background:var(--pub-surface1,#1b2133);border:1px solid var(--pub-border,#ffffff15);border-left:3px solid var(--event-color);border-radius:14px;min-width:0}
  .tsl-event-icon{flex:0 0 34px;height:34px;display:grid;place-items:center;border-radius:10px;color:var(--event-color);background:color-mix(in srgb,var(--event-color) 12%,transparent)}
  .tsl-event-body{flex:1;min-width:0}.tsl-event-heading{display:flex;gap:8px;justify-content:space-between;align-items:baseline;flex-wrap:wrap;font-size:.95rem}.tsl-event-heading strong{font-size:.85rem;color:var(--event-color);font-variant-numeric:tabular-nums}
  .tsl-event-body small{display:block;color:var(--pub-fg2,#9aa4bd);font-size:.75rem;line-height:1.5;margin-top:5px}.tsl-event-place{font-size:.85rem;margin-top:5px;overflow-wrap:anywhere}
  .tsl-event-battery{display:inline-flex;gap:8px;flex-wrap:wrap;margin-top:9px;padding:4px 8px;border-radius:7px;background:var(--pub-surface2,#252d45);font-size:.7rem;color:var(--pub-fg2,#9aa4bd)}.tsl-event-battery b{color:var(--pub-fg,#e6e9f2);font-weight:500}
  .tsl-state-share{height:5px;border-radius:9px;background:var(--pub-bg,#0f1320);overflow:hidden;margin-top:10px}.tsl-state-share i{display:block;height:100%;border-radius:9px}
  .tsl-drain-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:10px}.tsl-drain-entry{background:var(--pub-surface2,#252d45);padding:12px;border-radius:12px;min-width:0}.tsl-drain-values{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:12px;font-variant-numeric:tabular-nums}.tsl-drain-values strong{font-size:1.4rem;color:var(--tsl-orange,#fb923c)}.tsl-drain-values span{font-size:.85rem;color:var(--pub-fg2,#9aa4bd)}
  .tsl-two{grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}
  .tsl-card{min-width:0}.tsl-card h2{overflow-wrap:anywhere}.tsl-card>h3{display:flex;align-items:center;gap:8px;letter-spacing:.035em;line-height:1.5}
  .tsl-card>h3:before{content:'';width:4px;height:14px;border-radius:3px;flex-shrink:0;background:var(--pub-accent,var(--tsl-blue,#60a5fa));opacity:.75}
  .tsl-card .tsl-tile{border:1px solid var(--pub-border,#ffffff0a)}.tsl-tile b{font-variant-numeric:tabular-nums;line-height:1.3}.tsl-tile span{letter-spacing:.025em;line-height:1.5}
  .tsl-journey-list>.tsl-card{margin-top:0;border:1px solid var(--pub-border,#ffffff18)}.tsl-journey-list{margin-top:12px}.tsl-journey-card h2{font-size:1.25rem}.tsl-journey-card .tsl-badge{margin-left:0;padding:5px 9px;border-radius:7px}
  .tsl-journey-card:focus-visible,.tsl-btn:focus-visible,.tsl-tab:focus-visible,.tsl-seg button:focus-visible{outline:2px solid var(--pub-accent,var(--tsl-blue,#60a5fa));outline-offset:3px}
  .tsl-history-event{margin-top:8px;padding:12px;background:var(--pub-surface2,#252d45);border:1px solid var(--pub-border,#ffffff0a);border-radius:12px}.tsl-history-event:hover{border-color:var(--pub-accent,var(--tsl-blue,#60a5fa))}
  .tsl-sec summary{align-items:center;overflow-wrap:anywhere}.tsl-sec summary:before{content:'›';color:var(--pub-accent,var(--tsl-blue,#60a5fa));font-size:1.3rem}.tsl-sec[open]>summary:before{transform:rotate(90deg)}.tsl-sec summary small{margin-left:auto;background:var(--pub-surface2,#252d45);padding:3px 8px;border-radius:6px}
  .tsl-kv{padding:10px 8px;border-radius:8px;gap:5px 12px}.tsl-kv:nth-child(even){background:color-mix(in srgb,var(--pub-surface2,#252d45) 45%,transparent)}.tsl-kv span{max-width:100%}
  .tsl-place{padding:12px;background:var(--pub-surface2,#252d45);border:0;border-radius:12px;margin-top:8px;flex-wrap:wrap}.tsl-place div{overflow-wrap:anywhere}
  .tsl-bill-bands>span{background:var(--pub-surface2,#252d45);padding:10px;border-radius:9px;line-height:1.6}
  .tsl-note{line-height:1.6}.tsl-seg{max-width:100%;overflow-x:auto}.tsl-seg button{white-space:nowrap;min-height:40px}
  @container(max-width:600px){
    div.tsl-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .tsl-card .tsl-tile{padding:11px 10px}.tsl-tile b{font-size:1.15rem}.tsl-tile span{font-size:.65rem}.tsl-tile small{font-size:.72rem}
    .tsl-card:not(.tsl-hero){padding:14px;border-radius:16px}.tsl-card>h3{font-size:.72rem}
    .tsl-report-charts,.tsl-two{grid-template-columns:minmax(0,1fr);gap:0}.tsl-report-summary .tsl-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    .tsl-charge-tabs{flex-wrap:nowrap;overflow-x:auto;padding-bottom:5px}.tsl-charge-tabs .tsl-btn{flex:0 0 auto;white-space:nowrap;font-size:.8rem}
    .tsl-head h2{font-size:1.1rem}.tsl-seg button{padding:8px 11px;font-size:.8rem}.tsl-note{font-size:.78rem}
    .tsl-kv{flex-direction:column;align-items:stretch}.tsl-kv code{font-size:.75rem}.tsl-kv span{text-align:left;font-size:.9rem}
    .tsl-state-event{gap:9px;padding:12px}.tsl-event-heading{font-size:.88rem}.tsl-event-icon{flex-basis:28px;height:30px}
    .tsl-journey-list .tsl-btns .tsl-btn{font-size:.8rem;padding:9px 11px}
  }
  @media(prefers-reduced-motion:reduce){.tsl-drive-card{transition:none}}
  /* Metrics have pictograms; binary readings use compact, non-interactive indicators. */
  .tsl-metric-art{width:27px;height:27px;color:var(--pub-accent,var(--tsl-blue,#60a5fa));margin-bottom:9px}
  .tsl-metric-art svg,.tsl-indicator-art svg,.tsl-percent-ring svg{display:block;width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
  .tsl-visual-metric{position:relative;background:linear-gradient(145deg,color-mix(in srgb,var(--pub-accent,var(--tsl-blue,#60a5fa)) 6%,var(--pub-surface1,#1b2133)),var(--pub-surface1,#1b2133));padding:14px}
  .tsl-visual-metric>span,.tsl-percent-metric span{text-transform:none;letter-spacing:0;font-size:.76rem;line-height:1.4}
  .tsl-visual-metric>b{font-size:1.3rem;letter-spacing:-.025em;margin-top:6px;line-height:1.25}
  .tsl-report-summary .tsl-visual-metric{background:transparent;border:0;border-radius:0;border-bottom:1px solid var(--pub-border,#ffffff14)}
  .tsl-indicator{display:flex;align-items:center;gap:10px;min-width:0;padding:12px 10px;border-bottom:1px solid var(--pub-border,#ffffff10);--indicator-color:var(--pub-fg2,#9aa4bd)}
  .tsl-indicator.active{--indicator-color:var(--tsl-success,#34d399)}.tsl-indicator.attention{--indicator-color:var(--tsl-warning,#fbbf24)}
  .tsl-indicator-art{width:28px;height:28px;flex:0 0 28px;color:var(--indicator-color);opacity:.9}
  .tsl-indicator-copy{flex:1;min-width:0}.tsl-indicator-copy>span{display:block;color:var(--pub-fg,#e6e9f2);font-size:.78rem;line-height:1.4;overflow-wrap:anywhere}
  .tsl-indicator-copy>b{display:block;color:var(--indicator-color);font-size:.7rem;font-weight:500;line-height:1.4;margin-top:3px}.tsl-indicator-copy>small{display:block;font-size:.65rem;color:var(--pub-fg2,#9aa4bd);margin-top:4px;overflow-wrap:anywhere}
  .tsl-check{display:grid;place-items:center;flex:0 0 19px;height:19px;border-radius:6px;background:color-mix(in srgb,var(--indicator-color) 13%,transparent);border:1px solid color-mix(in srgb,var(--indicator-color) 45%,transparent);font-style:normal;color:var(--indicator-color);font-size:.75rem;font-weight:700}
  .tsl-heat-level{display:flex;gap:4px;margin-top:10px}.tsl-heat-level i{width:24px;height:5px;border-radius:4px;background:var(--pub-border,#ffffff20)}.tsl-heat-level i.lit{background:var(--tsl-orange,#fb923c)}
  .tsl-percent-metric{display:flex;gap:13px;align-items:center}.tsl-percent-ring{flex:0 0 50px;height:50px;display:grid;place-items:center;border-radius:50%;background:conic-gradient(var(--tsl-success,#34d399) var(--pct),var(--pub-border,#ffffff18) 0);position:relative;color:var(--tsl-success,#34d399)}
  .tsl-percent-ring:before{content:'';position:absolute;inset:4px;border-radius:50%;background:var(--pub-surface2,#252d45)}.tsl-percent-ring svg{position:relative;width:25px;height:25px}.tsl-percent-metric>div:last-child{min-width:0}
  .tsl-report-battery-flow{height:7px;background:var(--pub-bg,#0f1320);border-radius:4px;position:relative;overflow:hidden;margin-top:13px}.tsl-report-battery-flow i{position:absolute;inset:0 auto 0 0;background:var(--tsl-warning,#fbbf24);border-radius:4px}.tsl-report-battery-flow i.remaining{background:var(--tsl-success,#34d399)}
  @container(max-width:600px){
    .tsl-card .tsl-visual-metric{padding:12px 9px}.tsl-visual-metric>b{font-size:1.1rem}.tsl-visual-metric>span{font-size:.7rem}.tsl-metric-art{width:23px;height:23px;margin-bottom:7px}
    .tsl-card .tsl-grid:has(>.tsl-indicator){gap:5px 9px}.tsl-indicator{gap:7px;padding:10px 2px}.tsl-indicator-art{flex-basis:22px;width:22px;height:24px}.tsl-indicator-copy>span{font-size:.72rem}.tsl-indicator-copy>b{font-size:.66rem}.tsl-check{flex-basis:16px;height:16px;font-size:.65rem;border-radius:5px}
    .tsl-percent-metric{gap:8px}.tsl-percent-ring{flex-basis:36px;height:36px}.tsl-percent-ring svg{width:20px;height:20px}
  }
  .tsl-tire{position:relative;padding-top:14px}.tsl-wheel-symbol{display:block;width:33px;height:33px;margin:0 auto 8px;fill:none;stroke:var(--pub-accent,var(--tsl-blue,#60a5fa));stroke-width:1.5;stroke-linecap:round}.tsl-tire.warn .tsl-wheel-symbol{stroke:var(--tsl-warning,#fbbf24)}.tsl-tire.bad .tsl-wheel-symbol{stroke:var(--tsl-rose,#fb7185)}.tsl-tire .tsl-tire-status{display:inline-block;border-radius:6px;padding:3px 6px;font-size:.68rem;color:var(--tsl-success,#34d399);background:#34d39912}.tsl-tire.warn .tsl-tire-status{color:var(--tsl-warning,#fbbf24);background:#fbbf2412}.tsl-tire.bad .tsl-tire-status{color:var(--tsl-rose,#fb7185);background:#fb718512}
  .tsl-elev-credit{color:var(--pub-fg2,#9aa4bd);font-size:.68rem}.tsl-elevation-summary{margin-bottom:14px}.tsl-elevation-summary .tsl-tile{background:transparent;border:0;padding:9px}.tsl-elevation-summary .tsl-metric-art{display:none}
  .tsl-map-help{display:flex;flex-direction:column;max-height:calc(100% - 16px);position:absolute;top:8px;left:8px;z-index:2;max-width:calc(100% - 58px);cursor:default;touch-action:pan-y}.tsl-map-help[hidden],.tsl-map-legend[hidden]{display:none}
  .tsl-map-help-btn{flex-shrink:0;display:grid;place-items:center;width:36px;height:36px;min-height:36px;border:1px solid #ffffff30;border-radius:10px;background:#172033f2;color:#e6e9f2;box-shadow:0 2px 8px #0005;font:700 1rem system-ui;cursor:pointer}.tsl-map-help-btn:hover{background:#293852}.tsl-map-help-btn:focus-visible{outline:2px solid var(--tsl-blue,#60a5fa);outline-offset:2px}
  .tsl-map-legend{min-height:0;flex-shrink:1;margin-top:5px;width:240px;max-width:100%;max-height:240px;overflow-y:auto;overscroll-behavior:contain;padding:12px;border:1px solid #ffffff25;border-radius:12px;background:#131c2cf5;color:#e6e9f2;box-shadow:0 5px 24px #0007;font: .75rem/1.4 system-ui,sans-serif;cursor:default;scrollbar-width:thin}
  .tsl-map-legend>b{display:block;margin-bottom:8px}.tsl-map-legend>div,.tsl-map-ends>div{display:flex;align-items:center;gap:9px;margin-top:6px}.tsl-map-legend i.line{display:block;width:23px;height:4px;flex:0 0 23px;background:var(--legend-color);border-radius:4px}.tsl-map-legend i.point{width:11px;height:11px;flex:0 0 11px;border:2px solid #fff;background:var(--legend-color);border-radius:50%}.tsl-map-legend .tsl-map-ends{display:flex;gap:18px;padding-top:7px;margin-top:9px;border-top:1px solid #ffffff20;flex-wrap:wrap}.tsl-map-ends>div{margin:0}.tsl-map-legend p{margin:10px 0 0;font-size:.68rem;color:#b4c0d3}
  #tsl-replay{margin-top:14px}.tsl-replay-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:.85rem}.tsl-replay-head time{color:var(--pub-fg2,#9aa4bd);font-size:.75rem;font-variant-numeric:tabular-nums}
  .tsl-replay-controls{display:flex;align-items:center;gap:9px;margin:12px 0;flex-wrap:wrap}.tsl-replay-controls .tsl-btn{font-size:.8rem;min-width:100px}.tsl-replay-controls select{font:inherit;font-size:.8rem;padding:9px;border:1px solid var(--pub-border,#ffffff20);border-radius:9px;background:var(--pub-surface2,#252d45);color:inherit;min-height:42px}.tsl-replay-controls input{flex:1;min-width:100px;accent-color:var(--pub-accent,var(--tsl-blue,#60a5fa));cursor:pointer;min-height:32px}
  .tsl-replay-readings{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.tsl-replay-readings>div{padding:11px 8px;background:var(--pub-surface2,#252d45);border-radius:10px;min-width:0}.tsl-replay-readings small{display:block;color:var(--pub-fg2,#9aa4bd);font-size:.65rem}.tsl-replay-readings b{display:block;font-size:1.1rem;margin-top:5px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.tsl-replay-readings>div:first-child b{color:var(--pub-accent,var(--tsl-blue,#60a5fa))}.tsl-replay-caption{display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;margin-top:9px;font-size:.65rem;color:var(--pub-fg2,#9aa4bd)}
  @container(max-width:400px){.tsl-replay-controls input{flex-basis:100%}.tsl-replay-readings b{font-size:.95rem}}
  .tsl-replay-activity{font-size:.75rem;font-weight:650;padding:4px 7px;border-radius:7px;background:var(--pub-surface2,#252d45)}
  .tsl #tsl-page>[hidden],.tsl .tsl-hero [hidden]{display:none!important}.tsl-model-title{display:flex;align-items:center;gap:8px;min-width:0}.tsl-model-title h2{min-width:0;overflow-wrap:anywhere}.tsl-model-title [data-day-history]{flex-shrink:0;padding:3px 8px;min-height:32px}.tsl-day-history{border-top:1px solid #ffffff16;margin-top:16px;padding-top:14px}.tsl-day-toolbar,.tsl-day-playbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.tsl-day-toolbar{justify-content:space-between}.tsl-day-toolbar label{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--pub-fg2,#9aa4bd);font-size:12px}.tsl-day-toolbar input{min-width:0;max-width:100%;color:inherit;background:var(--pub-surface2,#252d45);border:1px solid #ffffff24;border-radius:10px;padding:8px;font:inherit;color-scheme:inherit}.tsl-day-playbar{margin-top:12px}.tsl-day-playbar b{font-variant-numeric:tabular-nums}.tsl-day-playbar small{margin-left:auto;color:var(--pub-fg2,#9aa4bd)}.tsl-day-history input[type=range]{display:block;width:100%;margin:14px 0 6px;accent-color:var(--tsl-blue,#60a5fa);cursor:pointer}.tsl-day-ends{display:flex;justify-content:space-between;font-size:11px;color:var(--pub-fg2,#9aa4bd)}.tsl-day-history .tsl-note{font-size:11px;margin-bottom:0}.tsl-refresh.on{color:var(--tsl-blue,#60a5fa);border-color:var(--tsl-blue,#60a5fa)}.tsl-day-history [data-day-metrics]{font-size:12px;color:var(--tsl-info,#93c5fd)}
  @container(max-width:600px){
    .tsl-history-open .tsl-cockpit{margin-top:6px;margin-bottom:0}
    .tsl-history-open .tsl-car-stage{height:var(--tsl-history-stage,280px);max-width:calc(var(--tsl-history-stage,280px) * .6);width:100%;aspect-ratio:.6}
    .tsl-history-open .tsl-energy-head{gap:5px}.tsl-history-open .tsl-energy-metrics{margin:8px 0;gap:8px}
    .tsl-history-open .tsl-energy-value{font-size:1.8rem}.tsl-history-open .tsl-energy-range{font-size:1.1rem}
    .tsl-history-open .tsl-energy-range small{display:inline;margin-left:3px}.tsl-history-open .tsl-energy-distance>span{margin-bottom:2px}
    .tsl-history-open .tsl-energy-track{height:48px;margin-top:9px}
    .tsl-history-open .tsl-day-history{margin-top:8px;padding-top:8px}
    .tsl-day-toolbar{flex-wrap:nowrap;gap:8px}.tsl-day-toolbar label{flex:1;min-width:0}.tsl-day-toolbar [data-day-calendar]{min-width:0;max-width:100%}
    .tsl-day-toolbar .tsl-day-label,.tsl-day-toolbar .tsl-day-live-copy{display:none}
    .tsl-day-toolbar .mvm-picker-trigger{font-size:.75rem;min-height:36px;padding:7px 10px}
    .tsl-day-toolbar [data-day-live]{font-size:1.1rem;min-width:40px;min-height:36px;padding:5px 10px}
    .tsl-day-playbar{margin-top:6px;gap:8px;flex-wrap:nowrap}.tsl-day-playbar b{font-size:.8rem}.tsl-day-playbar small{font-size:.65rem;white-space:nowrap}
    .tsl-day-playbar [data-day-play]{min-height:38px;min-width:42px;padding:6px 10px}.tsl-day-history [data-day-metrics]{font-size:.7rem}
    .tsl-day-history input[type=range]{min-height:26px;margin:1px 0 0}.tsl-day-ends{font-size:.6rem}
    .tsl-day-history [data-day-location]{font-size:.6rem;margin-top:5px;padding-right:24px}
  }
  .tsl-day-history [data-day-location]{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:24px;min-height:1.5em;line-height:1.5}.tsl-day-help{position:relative;margin-top:3px;font-size:11px;color:var(--pub-fg2,#9aa4bd)}.tsl-day-help summary{cursor:pointer;list-style:none;text-align:right;min-height:24px;line-height:24px}.tsl-day-help summary::-webkit-details-marker{display:none}.tsl-day-help p{margin:4px 0 0}.tsl-day-help:not([open]){height:0;margin:0}.tsl-day-help:not([open]) summary{position:absolute;right:0;bottom:0;width:24px}
    .tsl-replay-view{margin-top:10px;display:flex;width:fit-content}.tsl-replay-view button{font-size:.75rem;padding:8px 10px}

  .tsl-light .tsl-wrap .tsl-card{box-shadow:0 2px 10px #1523350d;border:1px solid var(--pub-border,#cbd1da)}
  .tsl-tire-history{margin-top:12px;border-top:1px solid var(--pub-border,#ffffff20);padding-top:10px}
  .tsl-tire-history summary{cursor:pointer;color:var(--pub-fg2,#9aa4bd);font-size:.78rem;min-height:28px;line-height:28px}
  /* Tire readings share the scale of the other vehicle metrics. */
  .tsl-tires{grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;align-items:stretch}
  .tsl-tires .tsl-tcar,.tsl-tires .tsl-tgap{display:none}
  .tsl-tire{min-width:0;padding:10px;text-align:left;border-radius:12px}
  .tsl-wheel-symbol{width:22px;height:22px;margin:0 0 6px}
  .tsl-tire b{font-size:1.15rem}.tsl-tire span{font-size:.65rem;letter-spacing:.025em}
  .tsl-tire .tsl-measured{display:block;font-size:.65rem;margin-top:5px;color:var(--pub-fg2,#9aa4bd)}
  .tsl-tire small{font-size:.68rem;overflow-wrap:anywhere}
  .tsl-tire-dialog .tsl-tires{grid-template-columns:repeat(2,minmax(0,1fr))}
  .tsl-charge-card{--session-color:var(--tsl-success)}.tsl-charge-card.dc{--session-color:var(--tsl-warning)}
  .tsl-tab.on,.tsl-btn.pri,.tsl-seg button.on,.tsl-days button.on{color:var(--on-accent,var(--pub-bg,#0f1320))}
  .tsl-day-history{border-color:var(--pub-border,#ffffff16)}
  .tsl-cross{stroke:var(--pub-fg,#fff)}
  .tsl-map-help-btn,.tsl-map-legend{background:var(--pub-surface1,#1b2133);color:var(--pub-fg,#e6e9f2);border-color:var(--pub-border,#ffffff25)}
  .tsl-map-legend p{color:var(--pub-fg2,#9aa4bd)}
  .tsl.tsl-light{--tsl-map-filter:none;--tsl-map-bg:#e5eaf0}
  .tsl.tsl-light .tsl-zoom button{background:var(--pub-surface1,#fff);color:var(--pub-fg,#1f2328);border:1px solid var(--pub-border,#d0d7de)}
  .tsl.tsl-light .tsl-attr{color:var(--pub-fg,#1f2328);background:var(--pub-surface1,#fff);text-shadow:none;padding:2px 5px;border-radius:4px}
  @container(max-width:600px){.tsl-tires{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}}
  `;
  function injectStyles() {
    if (document.getElementById('tsl-css')) return;
    const s = document.createElement('style'); s.id = 'tsl-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  let currency = 'EUR';
  fetch('/api/platform/settings').then(r => r.json()).then(c => { if (c && c.currency) currency = c.currency; }).catch(() => {});
  function money(n, code) {
    if (n == null) return '–';
    try { return new Intl.NumberFormat((window.mvmOS && window.mvmOS.lang) || 'en', { style: 'currency', currency:code||currency }).format(n); }
    catch (e) { return nf(n, 2) + ' ' + (code||currency); }
  }
  const unitPrice = (n,code) => new Intl.NumberFormat((window.mvmOS&&window.mvmOS.lang)||'en',{style:'currency',currency:code||currency,minimumFractionDigits:0,maximumFractionDigits:6}).format(n);
  const modelName = m => MODELS[m] || (m ? String(m) : 'Tesla');
  const place = (name, addr) => name || addr || t('tsl_unknown_place');
  const speedColor = v => v == null ? '#3b82f6' : v < 30 ? '#22c55e' : v < 70 ? '#eab308' : v < 110 ? '#f97316' : '#ef4444';

  function mount(root, opts) {
    opts = opts || {};
    injectStyles();
    const token = localStorage.getItem('apphub_token');
    root.innerHTML = '<div class="tsl"><div class="tsl-wrap"></div></div>';
    const scroller = root.firstChild, w = scroller.firstChild;
    if (opts.desktop) scroller.classList.add('in-os');
    const themePixel = document.createElement('canvas'); themePixel.width = themePixel.height = 1;
    const themeContext = themePixel.getContext('2d', {willReadFrequently:true});
    function syncTheme() {
      // Normalize modern CSS colors (including color-mix/oklch) to sRGB too.
      themeContext.clearRect(0, 0, 1, 1);
      themeContext.fillStyle = getComputedStyle(scroller).backgroundColor;
      themeContext.fillRect(0, 0, 1, 1);
      const rgb = themeContext.getImageData(0, 0, 1, 1).data;
      const light = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 140;
      const scheme = light ? 'light' : 'dark';
      if (scroller.style.colorScheme !== scheme) scroller.style.colorScheme = scheme;
      scroller.classList.toggle('tsl-light', !!light);
    }
    syncTheme();
    const themeObserver = new MutationObserver(syncTheme);
    for (let el = scroller.parentElement; el; el = el.parentElement) themeObserver.observe(el, {attributes:true,attributeFilter:['class','style','data-theme']});
    themeObserver.observe(document.head, {childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['href','media']});
    document.addEventListener('load', syncTheme, true);

    if (!token) {
      w.innerHTML = `<div class="tsl-center">${esc(t('tsl_login_required'))}</div>`;
      if (opts.onNeedLogin) opts.onNeedLogin(root);
      themeObserver.disconnect(); document.removeEventListener('load',syncTheme,true);
      return { destroy() {} };
    }

    const st = { refreshing: false, tab: 'now', status: null, vid: null, now: null, tl: null, trips: [], tripsTotal: 0, charges: [], chargesTotal: 0, detail: null, period: 'month', sHours: 24, states: [], statesTotal: 0 };
    let tireDialog = null, chargingDialog = null, statusDialog = null, schedulePickers=[];
    let destroyed = false, timer = null, maps = [], toastTimer = null, seqLoad = 0;

    function api(path, o) {
      o = o || {};
      if (st.status && !canManage() && o.method && !['GET','HEAD'].includes(o.method.toUpperCase())) return Promise.reject(new Error('view_only'));
      const headers = Object.assign({ 'X-Pub-Token': token, 'Content-Type': 'application/json' }, o.headers || {});
      return fetch(API + path, Object.assign({}, o, { headers })).then(async r => {
        if (r.status === 401 && opts.onNeedLogin) opts.onNeedLogin(root);
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { const error=new Error(data.error || data.detail || ('http_' + r.status)); error.status=r.status; throw error; }
        return data;
      });
    }
    function toast(msg) {
      const old = document.querySelector('.tsl-toast'); if (old) old.remove();
      const d = document.createElement('div'); d.className = 'tsl-toast'; d.textContent = msg; scroller.appendChild(d);
      clearTimeout(toastTimer); toastTimer = setTimeout(() => d.remove(), 4500);
    }
    let replayCleanup=null,replayPlaying=false,dayHistory=null;
    function clearMaps() { if(dayHistory)dayHistory.close(false); if(replayCleanup){replayCleanup();replayCleanup=null;} costControls.forEach(p=>p.destroy());costControls=[];schedulePickers.forEach(p=>p.destroy());schedulePickers=[];maps.forEach(m => m && m.destroy && m.destroy()); maps = []; }

    // Background updates keep the user's viewport and live map DOM intact.
    let pendingQuiet=null,quietTimer=null,lastInteraction=0;
    const activePointers=new Set();
    const interacted=()=>{lastInteraction=performance.now();};
    const pointerDown=e=>{if(root.contains(e.target)){activePointers.add(e.pointerId);interacted();}};
    const pointerEnd=e=>{if(activePointers.delete(e.pointerId))interacted();};
    const releasePointers=()=>{activePointers.clear();interacted();};
    const visibilityChanged=()=>{if(document.hidden)releasePointers();};
    window.addEventListener('blur',releasePointers);
    document.addEventListener('visibilitychange',visibilityChanged);
    document.addEventListener('pointerdown',pointerDown,true);
    document.addEventListener('pointerup',pointerEnd,true);
    document.addEventListener('pointercancel',pointerEnd,true);
    scroller.addEventListener('scroll',interacted,{passive:true});
    scroller.addEventListener('wheel',interacted,{passive:true});
    function queueQuietRender(apply) {
      pendingQuiet=apply;clearTimeout(quietTimer);
      const flush=()=>{
        if(destroyed){pendingQuiet=null;return;}
        if(activePointers.size || performance.now()-lastInteraction<250){quietTimer=setTimeout(flush,150);return;}
        const fn=pendingQuiet;pendingQuiet=null;quietTimer=null;if(fn)fn();
      };
      flush();
    }
    function replacePage(p,html,quiet) {
      if(!quiet){p.innerHTML=html;return ()=>{};}
      const scroll=scroller.scrollTop,viewport=scroller.getBoundingClientRect();
      const anchor=[...p.querySelectorAll('[id]')].find(el=>{
        if(el.matches('button,input,select'))return false;
        const r=el.getBoundingClientRect();return r.height>0&&r.bottom>viewport.top&&r.top<viewport.bottom;
      });
      const anchorId=anchor&&anchor.id,anchorTop=anchor&&anchor.getBoundingClientRect().top;
      const next=document.createElement('div');next.innerHTML=html;
      const kept=[];
      for(const map of maps){
        const el=map&&map.element,target=el&&el.id&&next.querySelector('#'+window.CSS.escape(el.id));
        if(target&&p.contains(el)){target.replaceWith(el);kept.push(map);}else if(map&&map.destroy)map.destroy();
      }
      maps=kept;p.replaceChildren(...next.childNodes);
      return ()=>{
        scroller.scrollTop=scroll;
        const newAnchor=anchorId&&p.querySelector('#'+window.CSS.escape(anchorId));
        if(newAnchor)scroller.scrollTop+=newAnchor.getBoundingClientRect().top-anchorTop;
      };
    }
    function mountPageMap(el,route,options) {
      const existing=maps.find(map=>map&&map.element===el);
      if(existing&&existing.update){existing.update(route,options);return existing;}
      const map=V.tileMap(el,route,options);if(map)maps.push(map);return map;
    }
    function discardPageMap(el) {
      maps=maps.filter(map=>{if(map&&map.element===el){map.destroy();return false;}return true;});
    }

    // ── Frame: tabs and vehicle ───────────────────────────────────────────
    const isOwner = () => !st.status?.access || st.status.access.is_owner === true;
    const canManage = () => st.status?.access?.role !== 'view';
    const TABS = ['now', 'trips', 'charges', 'states', 'stats', 'battery', 'car', 'data', 'settings', 'sharing'];
    function frame() {
      const veh = st.status && st.status.vehicles;
      const oldTabs=w.querySelector('.tsl-tabs'),tabsLeft=oldTabs?oldTabs.scrollLeft:0;
      w.classList.toggle('tsl-readonly', !canManage());
      const tabsToShow = TABS.filter(k => (k !== 'sharing' || isOwner()) && (k !== 'settings' || canManage()));
      w.innerHTML = `${!isOwner()?`<p class="tsl-note tsl-shared-banner">${esc(t('tsl_share_shared'))} · ${esc(t(canManage()?'tsl_share_admin':'tsl_share_view'))}</p>`:''}<div class="tsl-bar"><div class="tsl-tabs">${tabsToShow.map(k =>
        `<button class="tsl-tab ${(st.tab === k || k === 'trips' && st.tab === 'journeys') ? 'on' : ''}" data-tab="${k}">${esc(t('tsl_tab_' + k))}</button>`).join('')}</div>
        ${veh && veh.length > 1 ? `<div style="margin-top:8px"><select class="tsl-btn" id="tsl-veh">${veh.map(v => `<option value="${esc(v.id)}" ${v.id === st.vid ? 'selected' : ''}>${esc(v.name || modelName(v.model))}</option>`).join('')}</select></div>` : ''}
        ${st.status && st.status.reauth && st.tab !== 'settings' ? `<div class="tsl-note" style="color:var(--tsl-warning);margin-top:8px">${esc(t('tsl_set_reauth'))}</div>` : ''}
        </div>${['trips','journeys'].includes(st.tab)?`<div class="tsl-head tsl-trip-tabs" role="tablist" aria-label="${esc(t('tsl_tab_trips'))}"><button class="tsl-btn ${st.tab==='trips'?'pri':''}" role="tab" aria-selected="${st.tab==='trips'}" data-trip-tab="trips">${esc(t('tsl_trips_auto'))}</button><button class="tsl-btn ${st.tab==='journeys'?'pri':''}" role="tab" aria-selected="${st.tab==='journeys'}" data-trip-tab="journeys">${esc(t('tsl_tab_journeys'))}</button></div>`:''}<div id="tsl-page"></div>`;
      if(st.tab==='charges'){
        const nav=document.createElement('div');nav.className='tsl-head tsl-charge-tabs';nav.setAttribute('role','tablist');
        nav.innerHTML=['history','costs','places','tariffs'].map(k=>`<button class="tsl-btn ${(st.chargeTab||'history')===k?'pri':''}" role="tab" aria-selected="${(st.chargeTab||'history')===k}" data-charge-tab="${k}">${esc(t('tsl_bill_tab_'+k))}</button>`).join('');
        w.insertBefore(nav,page());nav.querySelectorAll('[data-charge-tab]').forEach(b=>b.onclick=()=>{st.chargeTab=b.dataset.chargeTab;st.detail=null;st.charges=[];clearMaps();frame();render();});
      }
      const tabs=w.querySelector('.tsl-tabs');tabs.scrollLeft=tabsLeft;
      const active=tabs.querySelector('.on');if(active){const a=active.getBoundingClientRect(),r=tabs.getBoundingClientRect();if(a.left<r.left)tabs.scrollLeft-=r.left-a.left+6;else if(a.right>r.right)tabs.scrollLeft+=a.right-r.right+6;}
      w.querySelectorAll('[data-trip-tab]').forEach(b=>b.onclick=()=>go(b.dataset.tripTab));
      w.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
      const sel = w.querySelector('#tsl-veh');
      if (sel) sel.addEventListener('change', () => { st.vid = sel.value; st.trips = []; st.charges = []; st.detail = null; go(st.tab); });
    }
    function page() { return w.querySelector('#tsl-page'); }
    function go(tab) {
      if ((tab === 'settings' && !canManage()) || (tab === 'sharing' && !isOwner())) return;
      ++seqLoad; closeBillingDialog();st.tab = tab; st.detail = null; st.journey = null; st.returnJourney = null; closeJourneyDialog(); clearMaps(); frame(); scroller.scrollTop = 0; render();
    }
    function render() {
      clearMaps();
      const p = page(); if (!p) return;
      if (st.tab === 'sharing') return renderSharing(p);
      if (st.tab === 'settings') return renderSettings(p);
      if (!st.status.vehicles.length) {
        p.innerHTML = `<div class="tsl-card tsl-center">${esc(st.status.connected || !canManage() ? t('tsl_wait_first') : t('tsl_not_connected_hint'))}
          ${st.status.connected || !canManage() ? '' : `<div class="tsl-btns" style="justify-content:center"><button class="tsl-btn pri" data-tab2="settings">${esc(t('tsl_tab_settings'))}</button></div>`}</div>`;
        const b = p.querySelector('[data-tab2]'); if (b) b.addEventListener('click', () => go('settings'));
        return;
      }
      ({ now: renderNow, journeys: renderJourneys, trips: renderTrips, charges: renderCharges, states: renderStates, stats: renderStats, battery: renderBattery, car: renderCar, data: renderData }[st.tab])(p);
    }

    // ── Now ───────────────────────────────────────────────────────────────
    async function renderNow(p, quiet) {
      if(dayHistory)return;
      const mySeq = ++seqLoad;
      if (!quiet) p.innerHTML = `<div class="tsl-center">${esc(t('tsl_loading'))}</div>`;
      try {
        const [d, tl, cr] = await Promise.all([api('/v/' + st.vid + '/now'), api('/v/' + st.vid + '/timeline?hours=48'), api('/v/' + st.vid + '/car').catch(() => null)]);
        if (destroyed || dayHistory || mySeq !== seqLoad || st.tab !== 'now') return;
        st.now = d; st.tl = tl; st.carNow = cr;
        const apply=()=>{if(!destroyed&&!dayHistory&&mySeq===seqLoad&&st.tab==='now'&&p===page())drawNow(p,quiet);};
        if(quiet)queueQuietRender(apply);else apply();
      } catch (e) { if (!quiet) p.innerHTML = `<div class="tsl-card tsl-center">${esc(t('tsl_error'))}</div>`; else if (st.refreshing) toast(t('tsl_error')); }
    }
    function metricArt(label) {
      const groups = [
        ['route', ['tsl_trip_distance','tsl_stats_total_km','tsl_odometer','tsl_c_ideal','tsl_bat_now']],
        ['clock', ['tsl_trip_duration','tsl_chg_duration','tsl_st_asleep','tsl_c_departure','tsl_c_update_when']],
        ['bolt', ['tsl_trip_energy','tsl_chg_added','tsl_stats_charged','tsl_power','tsl_chg_avg','tsl_chg_peak','tsl_c_voltage','tsl_c_amps','tsl_c_pilot','tsl_c_bat_heater']],
        ['regen', ['tsl_j_regen','tsl_bat_change','tsl_elev_ascent','tsl_elev_descent','tsl_elev_min','tsl_elev_max']],
        ['gauge', ['tsl_trip_avg','tsl_trip_max','tsl_trip_eff','tsl_stats_avg','tsl_c_rate','tsl_c_fan']],
        ['battery', ['tsl_trip_batt','tsl_c_limit','tsl_bat_drain_avg']],
        ['temp', ['tsl_inside','tsl_outside','tsl_c_driver_temp','tsl_c_pass_temp']],
        ['coin', ['tsl_chg_cost','tsl_stats_cost','tsl_bill_total']],
        ['chip', ['tsl_c_version','tsl_c_update','tsl_c_update_dl','tsl_c_update_in','tsl_c_model']]
      ];
      const kind = (groups.find(([,keys]) => keys.some(k => t(k) === label)) || ['detail'])[0];
      return statusArt(kind);
    }
    function statusArt(kind) {
      const paths = {
        route:'<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M5 7v7a4 4 0 0 0 4 4h6a4 4 0 0 0 0-8h-4"/>',
        clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
        bolt:'<path d="m13 2-8 12h6l-1 8 9-13h-7z"/>',
        regen:'<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/><path d="m13 8-4 5h4l-1 4"/>',
        gauge:'<path d="M4 19a10 10 0 1 1 16 0M6 15h1m10 0h1M8 7l1 1m7-1-1 1M12 4v2m0 8 5-4"/><circle cx="12" cy="14" r="2"/>',
        battery:'<rect x="2" y="6" width="18" height="12" rx="3"/><path d="M23 10v4M6 10v4m4-4v4m4-4v4"/>',
        temp:'<path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0M12 8v10m6-12h3m-3 4h2"/>',
        coin:'<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 4 16 4 16 0V6M4 12v6c0 4 16 4 16 0v-6"/>',
        chip:'<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>',
        lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
        door:'<path d="M5 21V5l12-3v19zM17 5h3v16h-3M12 12v2"/>',
        window:'<path d="M3 18V7a3 3 0 0 1 3-3h10l5 14zM3 21h18M8 7l-2 7m7-7-2 7"/>',
        shield:'<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6z"/><path d="m8 12 3 3 5-6"/>',
        heat:'<path d="M6 21h13M5 17V8m0 9h10l3 4M9 3c-3 3 3 4 0 7m5-7c-3 3 3 4 0 7m5-7c-3 3 3 4 0 7"/>',
        detail:'<path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5m-9 5v8"/>'
      };
      return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[kind] || paths.detail}</svg>`;
    }
    function tile(label, val, sub, cls) {
      return `<div class="tsl-tile tsl-visual-metric ${cls || ''}"><div class="tsl-metric-art">${metricArt(label)}</div><span>${esc(label)}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    }
    function batteryMetric(start, end) {
      const lo=Math.max(0,Math.min(100,Math.min(start,end))), hi=Math.max(lo,Math.min(100,Math.max(start,end)));
      return `<div class="tsl-tile tsl-visual-metric"><div class="tsl-metric-art">${statusArt('battery')}</div><span>${esc(t('tsl_trip_batt'))}</span><b>${esc(nf(start))}% → ${esc(nf(end))}%</b><div class="tsl-report-battery-flow" aria-hidden="true"><i style="width:${hi}%"></i><i class="remaining" style="width:${lo}%"></i></div></div>`;
    }
    function indicator(label, active, kind='detail', onText=t('tsl_c_on'), offText=t('tsl_c_off'), caution=false, sub='') {
      return `<div class="tsl-indicator ${active ? 'active' : 'inactive'} ${caution ? 'attention' : ''}"><div class="tsl-indicator-art">${statusArt(kind)}</div><div class="tsl-indicator-copy"><span>${esc(label)}</span><b>${esc(active ? onText : offText)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div><i class="tsl-check" aria-hidden="true">${caution ? '!' : active ? '✓' : '−'}</i></div>`;
    }
    function levelMetric(label, value) {
      return `<div class="tsl-tile tsl-visual-metric"><div class="tsl-metric-art">${statusArt('heat')}</div><span>${esc(label)}</span><b>${esc(nf(value))}</b><div class="tsl-heat-level" aria-hidden="true">${[1,2,3].map(n=>`<i class="${value>=n?'lit':''}"></i>`).join('')}</div></div>`;
    }
    function percentMetric(label, value) {
      const pct=Math.max(0,Math.min(100,value));
      return `<div class="tsl-tile tsl-percent-metric"><div class="tsl-percent-ring" style="--pct:${pct}%" aria-hidden="true">${statusArt('battery')}</div><div><span>${esc(label)}</span><b>${esc(nf(value))}%</b></div></div>`;
    }
    function compactAge(ts, now) {
      const minutes = Math.max(0, Math.floor(((now || Date.now() / 1000) - ts) / 60));
      const unit = minutes < 60 ? 'minute' : minutes < 1440 ? 'hour' : 'day';
      const value = unit === 'minute' ? minutes : unit === 'hour' ? Math.floor(minutes / 60) : Math.floor(minutes / 1440);
      return new Intl.NumberFormat((window.mvmOS && window.mvmOS.lang) || 'en', { style: 'unit', unit, unitDisplay: 'narrow' }).format(value).replace(/\s+/g, '');
    }
    const STATUS_ICONS = {
      seat: '<path d="M7 4v8a3 3 0 0 0 3 3h7l2 5M5 19h10M11 8c-2-2 2-3 0-5M15 8c-2-2 2-3 0-5M19 8c-2-2 2-3 0-5"/>',
      wheel: '<circle cx="12" cy="13" r="8"/><circle cx="12" cy="13" r="2"/><path d="M4 12h6m4 0h6m-8 3v6M9 3l1-2m4 2 1-2"/>',
      front: '<path d="M3 17 5 6Q12 2 19 6l2 11ZM8 14V8m4 6V7m4 7V8M6 10l2-2 2 2m0-1 2-2 2 2m0 1 2-2 2 2"/>',
      rear: '<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M7 15V8m5 7V8m5 7V8M5 10l2-2 2 2m1 0 2-2 2 2m1 0 2-2 2 2"/>',
      mirrors: '<path d="M8 6H5Q1 12 5 18h3Zm8 0h3q4 6 0 12h-3ZM11 7c-2 3 2 4 0 7m3-7c-2 3 2 4 0 7"/>',
      wiper: '<path d="M3 15 5 6Q12 2 19 6l2 9M5 16l13-6M12 20 5 16m2-2 10-5M10 7l1-2m3 2 1-2"/>',
      battery: '<rect x="3" y="7" width="17" height="12" rx="2"/><path d="M20 11h2v4h-2M8 15c-2-3 2-3 0-6m5 6c-2-3 2-3 0-6M8 4l1-2m4 2 1-2"/>',
      fan: '<circle cx="12" cy="12" r="2"/><path d="M11 10C3 8 7 0 11 4c2 2 1 5 1 6m2 1c2-8 10-4 6 0-2 2-5 1-6 1m-1 2c8 2 4 10 0 6-2-2-1-5-1-6m-2-1c-2 8-10 4-6 0 2-2 5-1 6-1"/>',
      precond: '<path d="M10 3a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0Zm2 5v8M18 5h4m-2-2v4M3 7l3 3m0-3-3 3"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
      dog: '<path d="m7 8-3-5-2 7 4 2v5l3 3h6l3-3v-5l4-2-2-7-3 5Q12 4 7 8Z"/><path d="M8 12h1m6 0h1m-6 4 2 1 2-1m-2 1v2"/>',
      auto: '<path d="M20 7a9 9 0 1 0 0 10M20 2v5h-5M8 16l4-9 4 9m-6-3h4"/>',
      camera: '<rect x="2" y="6" width="15" height="13" rx="3"/><path d="m17 10 5-3v11l-5-3"/><circle cx="9" cy="12.5" r="3"/>',
      sentry: '<path d="M12 2 3 6v6c0 6 9 10 9 10s9-4 9-10V6Z"/><path d="M6 11q6-6 12 0-6 6-12 0Z"/><circle cx="12" cy="11" r="2"/>',
      person: '<circle cx="12" cy="6" r="3"/><path d="M5 21v-5a7 7 0 0 1 14 0v5M9 15v6m6-6v6"/>',
    };
    function statusIcon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${STATUS_ICONS[name] || STATUS_ICONS.auto}</svg>`; }
    function statusReadings() {
      return st.carNow && st.carNow.data || {};
    }
    function activeStatuses() {
      const data = statusReadings(), cl = data.climate_state || {}, vs = data.vehicle_state || {};
      // /car retains the last snapshot while the vehicle sleeps or is offline.
      const awake = ['online', 'driving', 'charging'].includes(st.now && st.now.state);
      const current = awake && (!st.now.since || (st.carNow && st.carNow.ts >= st.now.since));
      const entries = [], on = t('tsl_c_on'), temp = n => typeof n === 'number' && Number.isFinite(n) ? fmt.temp(n) : null;
      const row = (label, value) => value == null ? null : [t(label), String(value)];
      const add = (id, group, label, icon, active, rows, opts) => { if (active) entries.push(Object.assign({ id, group, label: t(label), icon, rows: rows.filter(Boolean) }, opts || {})); };
      const seats = [['seat_heater_left', 'tsl_c_fl', 0], ['seat_heater_right', 'tsl_c_fr', 1], ['seat_heater_rear_left', 'tsl_c_rl', 2], ['seat_heater_rear_center', 'tsl_status_rear_center', 3], ['seat_heater_rear_right', 'tsl_c_rr', 4]];
      const seatStates = seats.map(([key, label, position]) => ({ position, label: t(label), level: typeof cl[key] === 'number' ? cl[key] : null, auto: position < 2 ? cl[position ? 'auto_seat_climate_right' : 'auto_seat_climate_left'] : null }));
      const seatsHeating = seatStates.some(s => s.level > 0), seatsAuto = seatStates.some(s => s.auto === true);
      add('seats', 'seats', 'tsl_status_seats', 'seat', seatsHeating || seatsAuto, seatStates.filter(s => s.level != null || s.auto != null).map(s => [s.label, `${t('tsl_status_level')} ${s.level == null ? '–' : nf(s.level)}${s.auto == null ? '' : ' · ' + t('tsl_status_auto') + ': ' + t(s.auto ? 'tsl_c_on' : 'tsl_c_off')}`]), { seatStates, auto: seatsAuto, autoOnly: !seatsHeating && seatsAuto });
      const wheelHeating = cl.steering_wheel_heater === true || cl.steering_wheel_heat_level > 0, wheelAuto = cl.auto_steering_wheel_heat === true;
      add('wheel', 'heat', 'tsl_c_steer_heat', 'wheel', wheelHeating || wheelAuto, [row('tsl_status_level', cl.steering_wheel_heat_level), row('tsl_status_state', cl.steering_wheel_heater == null && cl.steering_wheel_heat_level == null ? null : t(wheelHeating ? 'tsl_c_on' : 'tsl_c_off')), row('tsl_status_auto', cl.auto_steering_wheel_heat == null ? null : t(wheelAuto ? 'tsl_c_on' : 'tsl_c_off'))], { level: cl.steering_wheel_heat_level, auto: wheelAuto, autoOnly: !wheelHeating && wheelAuto });
      add('defrost', 'heat', 'tsl_c_defrost', 'front', cl.is_front_defroster_on === true || cl.is_rear_defroster_on === true, [row('tsl_status_front_defrost', cl.is_front_defroster_on == null ? null : t(cl.is_front_defroster_on ? 'tsl_c_on' : 'tsl_c_off')), row('tsl_status_rear_defrost', cl.is_rear_defroster_on == null ? null : t(cl.is_rear_defroster_on ? 'tsl_c_on' : 'tsl_c_off')), row('tsl_outside', temp(cl.outside_temp))], { frontDefrost: cl.is_front_defroster_on === true, rearDefrost: cl.is_rear_defroster_on === true });
      [['mirrors', 'tsl_c_mirrors', 'mirrors', 'side_mirror_heaters'], ['wipers', 'tsl_c_wiper', 'wiper', 'wiper_blade_heater'], ['battery_heat', 'tsl_c_bat_heater', 'battery', 'battery_heater']].forEach(([id, label, icon, key]) => add(id, 'heat', label, icon, cl[key] === true, [row('tsl_status_state', on), row('tsl_outside', temp(cl.outside_temp))]));
      const climateRows = [row('tsl_inside', temp(cl.inside_temp)), row('tsl_outside', temp(cl.outside_temp)), row('tsl_c_driver_temp', temp(cl.driver_temp_setting)), row('tsl_c_pass_temp', temp(cl.passenger_temp_setting)), row('tsl_c_fan', cl.fan_status)];
      const climateAuto = cl.hvac_auto_request === 'On' || cl.is_auto_conditioning_on === true;
      const climateRunning = cl.is_climate_on === true || cl.fan_status > 0;
      add('climate', 'climate', 'tsl_c_climate', 'fan', climateRunning || climateAuto, [row('tsl_status_state', cl.is_climate_on == null ? null : t(cl.is_climate_on ? 'tsl_c_on' : 'tsl_c_off')), row('tsl_status_auto', cl.hvac_auto_request == null && cl.is_auto_conditioning_on == null ? null : t(climateAuto ? 'tsl_c_on' : 'tsl_c_off')), ...climateRows], { auto: climateAuto, autoOnly: !climateRunning && climateAuto });
      add('preconditioning', 'climate', 'tsl_c_precond', 'precond', cl.is_preconditioning === true, climateRows);
      const overheatMode = String(cl.cabin_overheat_protection || '').trim().toLowerCase();
      // A configured mode alone is insufficient when protection is explicitly disallowed.
      const overheatEnabled = ['on', 'fanonly', 'noac'].includes(overheatMode) && cl.allow_cabin_overheat_protection !== false;
      const overheatCooling = current && cl.cabin_overheat_protection_actively_cooling === true;
      add('overheat', 'climate', 'tsl_c_overheat', 'sun', overheatEnabled || overheatCooling, [row('tsl_status_setting', cl.cabin_overheat_protection), row('tsl_status_cooling', !current || cl.cabin_overheat_protection_actively_cooling == null ? null : t(overheatCooling ? 'tsl_c_on' : 'tsl_c_off')), row('tsl_inside', temp(cl.inside_temp))], { auto: overheatEnabled, autoOnly: !overheatCooling });
      add('keeper', 'climate', 'tsl_status_keeper', 'dog', cl.climate_keeper_mode && cl.climate_keeper_mode !== 'off', [row('tsl_status_setting', cl.climate_keeper_mode), ...climateRows.slice(0, 4)]);
      add('dashcam', 'security', 'tsl_c_dashcam', 'camera', current && vs.dashcam_state === 'Recording', [row('tsl_status_recording', t('tsl_status_recording')), row('tsl_c_sentry', vs.sentry_mode == null ? null : t(vs.sentry_mode ? 'tsl_c_on' : 'tsl_c_off'))]);
      add('sentry', 'security', 'tsl_c_sentry', 'sentry', current && vs.sentry_mode === true, [row('tsl_status_state', on)]);
      add('present', 'security', 'tsl_c_user_present', 'person', vs.is_user_present === true, []);
      return entries;
    }
    const STATUS_COLORS = { seats: 'var(--tsl-seats)', heat: 'var(--tsl-heat)', climate: 'var(--tsl-climate)', security: 'var(--tsl-security)' };
    function statusStrip() {
      const entries = activeStatuses();
      if (!entries.length) return '';
      return `<div class="tsl-active-status"><div class="tsl-status-groups">${entries.map(e => {
        const clickable = e.rows.length > 0, tag = clickable ? 'button' : 'span';
        return `<${tag} class="tsl-status-icon${clickable ? '' : ' passive'}" style="--status-color:${STATUS_COLORS[e.group]}" ${clickable ? `type="button" data-status="${e.id}" aria-haspopup="dialog"` : 'role="img"'} aria-label="${esc(e.label + (e.auto ? ' · ' + t('tsl_status_auto') : ''))}" title="${esc(e.label + (e.auto ? ' · ' + t('tsl_status_auto') : '') + (!clickable ? ' · ' + t('tsl_status_no_details') : ''))}">${statusIcon(e.icon)}${e.level > 0 ? `<span class="tsl-status-level" aria-hidden="true">${Array.from({ length: Math.min(3, e.level) }, () => '<i></i>').join('')}</span>` : ''}${e.auto ? '<span class="tsl-status-auto" aria-hidden="true">↻</span>' : ''}</${tag}>`;
      }).join('')}</div></div>`;
    }
    function statusIllustration(e) {
      const color = STATUS_COLORS[e.group], isSeat = !!e.seatStates;
      const seat = (x, y, index) => {
        const reading = (e.seatStates || []).find(s => s.position === index), heating = reading && reading.level > 0, auto = reading && reading.auto === true;
        return `<g data-art-seat="${index}" data-heating="${!!heating}" data-auto="${!!auto}" transform="translate(${x} ${y})"><path d="M0 0h36q6 0 6 7v33q0 7-6 7H0q-6 0-6-7V7q0-7 6-7Z" fill="${heating ? '#62422e' : '#263a4c'}" stroke="${heating ? color : auto ? '#80d5ed' : '#60778b'}" stroke-width="${heating || auto ? 1.8 : 1}"/><path d="M-3 31h42M3 7v16m29-16v16" stroke="#91a5b6" stroke-opacity=".4"/>${heating ? '<path class="tsl-status-hot" d="M5 28c-7-7 7-7 0-17m13 17c-7-7 7-7 0-17m13 17c-7-7 7-7 0-17"/>' : ''}${reading && reading.level != null ? `<text x="18" y="43" text-anchor="middle" font-size="10" font-weight="650" fill="${heating ? '#ffd2aa' : '#c0d1df'}" font-family="system-ui">${nf(reading.level)}</text>` : ''}${auto ? '<text x="31" y="9" text-anchor="middle" font-size="11" fill="#a8ebff" font-family="system-ui">↻</text>' : ''}</g>`;
      };
      const heatGlass = (y, front) => `<g><path d="${front ? 'M67 78Q130 55 193 78L181 119H79Z' : 'M79 273H181L193 313Q130 334 67 313Z'}" fill="${color}" fill-opacity=".12" stroke="${color}"/>${[94, 130, 166].map(x => `<path class="tsl-status-hot" d="M${x} ${y + 25}c-10-9 10-9 0-26"/>`).join('')}</g>`;
      return `<svg viewBox="0 0 260 400" role="img" aria-label="${esc(e.label)}"><path d="M130 15Q62 15 51 64L48 325Q52 382 85 387H175Q208 382 212 325L209 64Q198 15 130 15Z" fill="#142536" stroke="#8299ac" stroke-width="2"/><path d="M66 78Q130 57 194 78L180 119H80Z M80 273H180L194 313Q130 337 66 313Z" fill="#2d485f" stroke="#91a6b6"/><path d="M60 128H200V263H60Z" fill="#0f1e2d" stroke="#3b5265"/>${seat(78, 146, 0)}${seat(151, 146, 1)}${seat(65, 215, 2)}${seat(109, 215, 3)}${seat(153, 215, 4)}
        <circle cx="92" cy="132" r="13" fill="#172837" stroke="${e.icon === 'wheel' ? color : '#8094a5'}" stroke-width="3"/><path d="M80 131h24m-12 2v11" stroke="${e.icon === 'wheel' ? color : '#8094a5'}" stroke-width="2"/>
        ${e.frontDefrost || e.id === 'wipers' ? heatGlass(81, true) : ''}${e.rearDefrost ? heatGlass(282, false) : ''}
        ${e.id === 'mirrors' ? '<path class="tsl-status-hot" d="M45 125l-16 7v21l16-7M215 125l16 7v21l-16-7"/>' : ''}
        ${e.id === 'battery_heat' ? '<rect x="63" y="139" width="134" height="127" rx="10" fill="#ecb36c" fill-opacity=".2" stroke="#ffc57d"/><path class="tsl-status-hot" d="M90 244c-20-30 20-30 0-70m40 70c-20-30 20-30 0-70m40 70c-20-30 20-30 0-70"/>' : ''}
        ${!isSeat && !['defrost','mirrors','wipers','battery_heat','wheel'].includes(e.id) ? `<g transform="translate(103 174) scale(2.25)" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${STATUS_ICONS[e.icon]}</g>` : ''}
        <path d="M83 365Q130 379 177 365" fill="none" stroke="#b75c68" stroke-width="3"/></svg>`;
    }
    function openStatus(id) {
      const e = activeStatuses().find(e => e.id === id);
      if (!e || !e.rows.length || statusDialog || destroyed) return;
      const dlg = document.createElement('dialog'); statusDialog = dlg;
      dlg.dataset.statusId = id;
      dlg.className = 'tsl-tire-dialog tsl-status-dialog'; dlg.style.setProperty('--status-color', STATUS_COLORS[e.group]); dlg.setAttribute('aria-label', e.label);
      dlg.innerHTML = `<header><h2>${esc(e.label)}</h2><button class="tsl-btn" type="button" data-close aria-label="${esc(t('tsl_back'))}">×</button></header><div class="tsl-status-detail"><div class="tsl-status-art">${statusIllustration(e)}</div><div><div class="tsl-status-headline">${statusIcon(e.icon)}<b>${esc(e.autoOnly ? t('tsl_status_auto') : e.level > 0 ? t('tsl_status_level') + ' ' + nf(e.level) : e.id === 'dashcam' ? t('tsl_status_recording') : t('tsl_c_on'))}</b></div><div class="tsl-status-readings">${e.rows.map(([label, value]) => tile(label, esc(value))).join('')}</div></div></div>`;
      scroller.appendChild(dlg);
      dlg.addEventListener('close', () => { if (statusDialog === dlg) statusDialog = null; dlg.remove(); if (!destroyed) { const b = w.querySelector(`[data-status="${id}"]`); if (b) b.focus({ preventScroll: true }); } }, { once: true });
      dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
      dlg.addEventListener('click', evt => { if (evt.target === dlg) { const r = dlg.getBoundingClientRect(); if (evt.clientX < r.left || evt.clientX > r.right || evt.clientY < r.top || evt.clientY > r.bottom) dlg.close(); } });
      dlg.showModal();
    }
    function chargingData(d, raw) {
      if (!d || !d.sample || d.state !== 'charging') return null;
      const s = d.sample, cs = sec(raw, 'charge_state'), session = d.charge || {};
      const reported = raw && raw.ts > s.ts ? (cs.charging_state || s.charging_state) : (s.charging_state || cs.charging_state);
      if (reported && reported !== 'Charging' && reported !== 'Starting') return null;
      const numeric = (...values) => values.find(v => typeof v === 'number' && Number.isFinite(v)) ?? null;
      const pct = v => v == null ? null : Math.max(0, Math.min(100, v));
      const battery = pct(numeric(s.battery, cs.battery_level));
      const limit = pct(numeric(s.charge_limit, cs.charge_limit_soc));
      const start = pct(numeric(session.start_batt));
      const range = numeric(s.range_km, typeof cs.battery_range === 'number' ? cs.battery_range * 1.609344 : null);
      const minutesLeft = numeric(s.to_full, cs.minutes_to_full_charge, typeof cs.time_to_full_charge === 'number' ? cs.time_to_full_charge * 60 : null);
      return {
        battery, limit, start, range,
        progress: start != null && limit != null && limit > start && battery != null ? Math.max(0, Math.min(100, (battery - start) / (limit - start) * 100)) : battery,
        power: numeric(s.charger_power, cs.charger_power, d.charge_power),
        added: numeric(s.energy_added, cs.charge_energy_added, session.kwh),
        voltage: numeric(s.voltage, cs.charger_voltage), amps: numeric(s.current, s.amps, cs.charger_actual_current),
        phases: numeric(s.phases, cs.charger_phases),
        rate: numeric(s.rate_kmh, typeof cs.charge_rate === 'number' ? cs.charge_rate * 1.609344 : null),
        minutesLeft: minutesLeft != null && minutesLeft >= 0 ? minutesLeft : null,
        elapsed: session.start_ts != null ? Math.max(0, ((d.now || Date.now() / 1000) - session.start_ts) / 60) : null,
        targetRange: battery != null && battery > 0 && range != null && limit != null ? range / battery * limit : null,
        cost: numeric(session.cost),costCurrency:session.cost_currency,
        dc: s.dc != null ? !!s.dc : cs.fast_charger_present != null ? !!cs.fast_charger_present : !!session.dc,
      };
    }
    function chargingCable() {
      return `<svg class="tsl-charge-cable" data-charge-open viewBox="0 0 240 440" aria-hidden="true">
        <path d="M-88 410C-88 352 -44 335 -17 354S14 393 42 370" fill="none" stroke="#050b10" stroke-width="13" stroke-linecap="round"/>
        <path d="M-88 410C-88 352 -44 335 -17 354S14 393 42 370" fill="none" stroke="#397268" stroke-width="7" stroke-linecap="round"/>
        <path class="tsl-charge-current" d="M-88 410C-88 352 -44 335 -17 354S14 393 42 370"/>
        <g transform="translate(41 370) rotate(-37)"><rect x="-16" y="-7" width="20" height="14" rx="4" fill="#1e333c" stroke="#a9e4d6" stroke-width="1.3"/><rect x="-1" y="-5" width="8" height="10" rx="2" fill="#98f1c7"/></g>
        <circle cx="47" cy="366" r="5" fill="#93ffcb" opacity=".85"/>
        <circle cx="-88" cy="410" r="10" fill="#183a34" stroke="#7cefc0"/><path d="M-87 403l-5 8h5l-2 6 7-9h-5Z" fill="#b4ffda"/>
        <path class="tsl-cable-hitpath" d="M-88 410C-88 352 -44 335 -17 354S14 393 42 370" fill="none" stroke="transparent" stroke-width="24" style="pointer-events:stroke;cursor:pointer"/>
      </svg><button type="button" class="tsl-charge-hit" data-charge-details aria-haspopup="dialog" aria-label="${esc(t('tsl_c_charging'))}" title="${esc(t('tsl_c_charging'))}"></button>`;
    }
    function batteryFloor(c) {
      const level = c.battery == null ? 0 : c.battery;
      const id = 'tslpack' + (++chargeArtSeq), packX = 120, packY = 155, packW = 180, packH = 255;
      const cells = Array.from({ length: 40 }, (_, i) => {
        const x = 126 + (i % 5) * 34, y = 162 + Math.floor(i / 5) * 31;
        return `<rect x="${x}" y="${y}" width="29" height="25" rx="3"/>`;
      }).join('');
      const limitY = c.limit == null ? null : packY + packH * (1 - c.limit / 100);
      return `<svg viewBox="0 0 420 540" role="img" aria-label="${esc(t('tsl_charge_floor') + ': ' + (c.battery == null ? t('tsl_st_unknown') : nf(c.battery) + '%') + (c.limit == null ? '' : ', ' + t('tsl_limit', { n: c.limit })))}"><defs>
        <linearGradient id="${id}steel" x1="0" x2="1"><stop stop-color="#273e4b"/><stop offset=".4" stop-color="#8ba2ac"/><stop offset=".55" stop-color="#506875"/><stop offset="1" stop-color="#1e3442"/></linearGradient>
        <linearGradient id="${id}cells" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#91ffd0"/><stop offset="1" stop-color="#199779"/></linearGradient>
        <clipPath id="${id}level"><rect x="${packX}" y="${packY + packH * (1 - level / 100)}" width="${packW}" height="${packH * level / 100}"/></clipPath>
      </defs>
      <ellipse cx="210" cy="284" rx="139" ry="233" fill="#050d15" opacity=".35"/>
      <g fill="#090f17" stroke="#3f5665" stroke-width="2"><rect x="72" y="99" width="25" height="64" rx="8"/><rect x="323" y="99" width="25" height="64" rx="8"/><rect x="72" y="391" width="25" height="64" rx="8"/><rect x="323" y="391" width="25" height="64" rx="8"/></g>
      <path d="M210 27C143 27 106 47 100 103L97 413Q98 487 130 506Q210 528 290 506Q322 487 323 413L320 103C314 47 277 27 210 27Z" fill="#203442" fill-opacity=".35" stroke="#90aab8" stroke-opacity=".5" stroke-width="2"/>
      <path d="M117 114Q210 70 303 114M115 459Q210 498 305 459" fill="none" stroke="#a9c3cf" stroke-opacity=".45" stroke-width="3"/>
      <path d="M96 130H324M96 425H324" stroke="#7b939f" stroke-width="8"/>
      <rect x="167" y="101" width="86" height="43" rx="12" fill="#233d4e" stroke="#819ca9"/><path d="M182 111h56m-56 10h56m-56 10h56" stroke="#6f8a98"/>
      <path d="M108 150V421M312 150V421" stroke="url(#${id}steel)" stroke-width="9"/>
      <rect x="116" y="151" width="188" height="263" rx="14" fill="#0c1c28" stroke="#9ab3bb" stroke-width="2"/>
      <g fill="#263c49" stroke="#405c66" stroke-width=".6">${cells}</g>
      <g fill="url(#${id}cells)" stroke="#c8ffe0" stroke-opacity=".4" stroke-width=".6" clip-path="url(#${id}level)">${cells}</g>
      ${limitY == null ? '' : `<path d="M119 ${limitY}H301" stroke="#d4ffe8" stroke-width="1.6" stroke-dasharray="5 4"/>
      <path d="M304 ${limitY}h21" stroke="#d4ffe8" stroke-width="1.2"/><text x="330" y="${limitY + 5}" fill="#d4ffe8" font-size="13" font-family="system-ui">${nf(c.limit)}%</text>`}
      <rect x="167" y="260" width="86" height="49" rx="12" fill="#0c2025" fill-opacity=".88"/><text x="210" y="294" text-anchor="middle" fill="#c0ffe1" font-size="30" font-weight="650" font-family="system-ui">${c.battery == null ? '–' : nf(c.battery) + '%'}</text>
      <path d="M36 476C44 429 63 417 102 424H119V399" fill="none" stroke="#173c35" stroke-width="11" stroke-linecap="round"/>
      <path class="tsl-charge-current" d="M36 476C44 429 63 417 102 424H119V399"/>
      <path d="M155 418v29h110v-29" fill="none" stroke="#d69b5f" stroke-width="3"/><rect x="173" y="433" width="74" height="27" rx="6" fill="#243e4c" stroke="#8ca6b1"/>
      <path d="M128 65Q210 42 292 65" fill="none" stroke="#c5dfeb" stroke-opacity=".45"/><path d="M139 493Q210 509 281 493" fill="none" stroke="#d7edf7" stroke-opacity=".45"/>
      </svg>`;
    }
    function chargingContents(c) {
      const value = (n, format) => n == null ? '–' : esc(format(n));
      return `<div class="tsl-charge-layout"><div class="tsl-charge-floor">${batteryFloor(c)}<small>${esc(t('tsl_charge_floor'))}</small></div>
        <div class="tsl-charge-summary"><div class="tsl-charge-pct">${c.battery == null ? '–' : nf(c.battery)}<small>%</small></div>
          <div class="tsl-charge-target"><span>${c.start == null ? '' : esc(t('tsl_charge_started')) + ' ' + nf(c.start) + '%'}</span><strong>${c.limit == null ? '–' : esc(t('tsl_limit', { n: c.limit }))}</strong></div>
          <div class="tsl-charge-progress" role="img" aria-label="${esc(t('tsl_charge_progress'))}: ${c.progress == null ? esc(t('tsl_st_unknown')) : nf(c.progress) + '%'}"><i style="width:${c.progress || 0}%"></i></div>
          <div class="tsl-charge-metrics">
            ${tile(t('tsl_power'), value(c.power, n => nf(n, Number.isInteger(n) ? 0 : 1) + ' ' + t('tsl_u_kw')))}${tile(t('tsl_charge_remaining'), value(c.minutesLeft, n => n === 0 ? nf(0) + ' ' + t('tsl_u_min') : fmt.dur(n * 60)))}
            ${tile(t('tsl_chg_added'), value(c.added, n => fmt.kwh(n, 1)))}${tile(t('tsl_c_rate'), value(c.rate, fmt.speed))}
            ${tile(t('tsl_c_ideal'), value(c.range, n => fmt.dist(n, 0)))}${tile(t('tsl_charge_target'), value(c.targetRange, n => fmt.dist(n, 0)))}
          </div>
          <div class="tsl-charge-electrical"><div><b>${value(c.voltage, n => nf(n) + ' V')}</b><span>${esc(t('tsl_c_voltage'))}</span></div><div><b>${value(c.amps, n => nf(n, 1) + ' A')}</b><span>${esc(t('tsl_c_amps'))}</span></div>${!c.dc && c.phases != null ? `<div><b>${nf(c.phases)}</b><span>${esc(t('tsl_c_phases'))}</span></div>` : ''}</div>
          <div class="tsl-charge-footer">${c.elapsed == null ? '' : `<span>${esc(t('tsl_chg_duration'))}: ${esc(fmt.dur(c.elapsed * 60))}</span>`}${c.cost == null ? '' : `<span>${esc(t('tsl_chg_cost'))}: ${esc(money(c.cost,c.costCurrency))}</span>`}</div>
        </div></div>`;
    }
    function refreshChargingDialog() {
      if (!chargingDialog) return;
      const c = chargingData(st.now, st.carNow);
      if (!c) { chargingDialog.close(); return; }
      chargingDialog.querySelector('[data-charge-type]').textContent = t(c.dc ? 'tsl_chg_dc' : 'tsl_chg_ac');
      chargingDialog.querySelector('[data-charge-content]').innerHTML = chargingContents(c);
    }
    function openCharging() {
      const c = chargingData(st.now, st.carNow);
      if (chargingDialog || destroyed || !c) return;
      const dlg = document.createElement('dialog');
      dlg.className = 'tsl-tire-dialog tsl-charge-dialog'; dlg.setAttribute('aria-label', t('tsl_c_charging'));
      dlg.innerHTML = `<header><h2>⚡ ${esc(t('tsl_c_charging'))} <span class="tsl-badge" data-charge-type>${esc(t(c.dc ? 'tsl_chg_dc' : 'tsl_chg_ac'))}</span></h2><button type="button" class="tsl-btn" data-close aria-label="${esc(t('tsl_back'))}">×</button></header><div data-charge-content>${chargingContents(c)}</div>`;
      chargingDialog = dlg; scroller.appendChild(dlg);
      dlg.addEventListener('close', () => { if (chargingDialog === dlg) chargingDialog = null; dlg.remove(); if (!destroyed) { const b = w.querySelector('[data-charge-details]'); if (b) b.focus({ preventScroll: true }); } }, { once: true });
      dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
      dlg.addEventListener('click', e => { if (e.target === dlg) { const r = dlg.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close(); } });
      dlg.showModal();
    }
    function nowHero(d, cr, col, note, charging) {
      const v = d.vehicle, s = d.sample, vs = sec(cr, 'vehicle_state');
      const config = sec(cr, 'vehicle_config'), cs = sec(cr, 'charge_state'), cl = sec(cr, 'climate_state');
      const climateOn = present(cl, 'is_climate_on') ? !!cl.is_climate_on : !!s.climate;
      const locked = present(vs, 'locked') ? vs.locked : s.locked;
      const lockLabel = locked == null ? t('tsl_st_unknown') : t(locked ? 'tsl_locked' : 'tsl_unlocked');
      const doors = {}, tireStates = {};
      ['df', 'dr', 'pf', 'pr', 'ft', 'rt'].forEach((key, i) => { doors[key] = present(vs, key) ? !!vs[key] : s.doors == null ? null : !!(s.doors & (1 << i)); });
      const tires = TIRE_KEYS.map(([key, label], i) => {
        const pressure = present(vs, 'tpms_pressure_' + key) ? vs['tpms_pressure_' + key] : s['tpms_' + key];
        const warning = tireState(vs, key) || ((s.tpms_hard & (1 << i)) ? 'bad' : (s.tpms_soft & (1 << i)) ? 'warn' : '');
        tireStates[key] = warning;
        const seen = Number(vs['tpms_last_seen_pressure_time_' + key]);
        const measured = pressure != null && Number.isFinite(seen) && seen > 0;
        const status = pressure == null ? t('tsl_st_unknown') : t(warning === 'bad' ? 'tsl_c_warn_hard' : warning === 'warn' ? 'tsl_c_warn_soft' : 'tsl_c_ok');
        const details = `${t(label)} · ${barFmt(pressure)} · ${status}${measured ? ' · ' + t('tsl_c_measured', { t: fmt.ago(seen, d.now) }) : ''}`;
        return `<button type="button" class="tsl-pressure ${key} ${warning}" data-tire="${key}" aria-haspopup="dialog" aria-label="${esc(t('tsl_c_tires') + ' · ' + details)}" title="${esc(details)}"><b>${esc(barFmt(pressure))}</b></button>`;
      }).join('');
      const driverKeys = config.rhd ? { df: 'pf', pf: 'df', dr: 'pr', pr: 'dr' } : {};
      const visualDoors = {}, visualWindows = {};
      Object.keys(doors).forEach(key => {
        visualDoors[driverKeys[key] || key] = doors[key];
      });
      ['fd_window', 'fp_window', 'rd_window', 'rp_window'].forEach((key, i) => {
        const open = present(vs, key) ? vs[key] : s.windows != null && (s.windows & (1 << i));
        const doorKey = ['df', 'pf', 'dr', 'pr'][i];
        visualWindows[driverKeys[doorKey] || doorKey] = present(vs, key) || s.windows != null ? !!open : null;
      });
      const level = s.battery == null ? null : Math.max(0, Math.min(100, s.battery));
      const limit = s.charge_limit == null ? null : Math.max(0, Math.min(100, s.charge_limit));
      const energy = charging ? 'var(--tsl-green)' : level != null && level <= 15 ? 'var(--tsl-danger)' : level != null && level <= 30 ? 'var(--tsl-warning)' : 'var(--tsl-blue)';
      const validSetpoint = key => typeof cl[key] === 'number' && Number.isFinite(cl[key]) && cl[key] > 0;
      const frontZones = [['driver', 'tsl_climate_driver', 'driver_temp_setting'], ['passenger', 'tsl_climate_passenger', 'passenger_temp_setting']];
      if (config.rhd) frontZones.reverse();
      // Rear seat heaters and rear vents do not imply independent temperature control.
      const rearZones = [['rear_left_temp_setting', 'tsl_c_rl'], ['rear_right_temp_setting', 'tsl_c_rr']]
        .filter(([key]) => validSetpoint(key));
      if (!rearZones.length && validSetpoint('rear_temp_setting')) rearZones.push(['rear_temp_setting', 'tsl_climate_rear']);
      const glassSetting = (key, label, value, x, y) => `<g class="tsl-zone-setting" data-climate-zone="${key}" aria-label="${esc(t(label) + ': ' + fmt.temp(value))}"><title>${esc(t(label) + ': ' + fmt.temp(value))}</title><text class="tsl-zone-value" x="${x}" y="${y}">${esc(fmt.temp(value))}</text></g>`;

      return `<div class="tsl-card tsl-hero">
        <div class="tsl-hero-head"><div><div class="tsl-model-title"><h2>${esc(v.name || modelName(v.model))}</h2><button type="button" class="tsl-refresh" data-day-history aria-expanded="false" title="${esc(t('tsl_history_title'))}" aria-label="${esc(t('tsl_history_title'))}">▷</button></div><div class="tsl-sub">${esc(modelName(v.model))}${v.trim ? ' ' + esc(String(v.trim).toUpperCase()) : ''}${s.odo_km != null ? ` · <span style="display:inline-block" title="${esc(t('tsl_odometer'))}">${esc(fmt.dist(s.odo_km, 0))}</span>` : ''}${v.version ? ' · ' + esc(v.version) : ''}</div></div>
          <div class="tsl-live-status"><span class="tsl-pill" style="background:${col}" title="${esc(note)}">${STATE_ICON[d.state] || ''} ${esc(t('tsl_st_' + d.state))}</span>
          <button class="tsl-refresh" data-refresh title="${esc((canManage()?t('tsl_refresh_live')+' · ':'')+t('tsl_updated', { t: fmt.ago(s.ts, d.now) }))}" aria-label="${esc(canManage()?t('tsl_refresh_live'):t('tsl_updated', { t: fmt.ago(s.ts, d.now) }))}" ${st.refreshing || !canManage() || !st.status.connected ? 'disabled' : ''}>↻ ${esc(compactAge(s.ts, d.now))}</button></div></div>
        <div class="tsl-cockpit"><div class="tsl-car-stage">
          ${V.car(v.color, { doors: visualDoors, windows: visualWindows, tires: tireStates, climate: climateOn, port: cs.charge_port_door_open })}${tires}${chargingData(d, cr) ? chargingCable() : ''}
          <b class="tsl-roof-temp" title="${esc(t('tsl_inside'))}" aria-label="${esc(t('tsl_inside'))}: ${s.inside_temp != null ? esc(fmt.temp(s.inside_temp)) : '–'}">${s.inside_temp != null ? esc(fmt.temp(s.inside_temp)) : '–'}</b>
          <svg class="tsl-climate-glass" viewBox="0 0 240 440" role="img" aria-label="${esc(t('tsl_c_climate') + ' · ' + lockLabel)}">
            <g class="tsl-climate-settings">${frontZones.map(([key, label, field], i) => validSetpoint(field) ? glassSetting(key, label, cl[field], i ? 155 : 85, 155) : '').join('')}</g>
            <svg class="tsl-glass-lock ${locked === false || locked === 0 ? 'unlocked' : ''}" x="108" y="222" width="24" height="28" viewBox="0 0 24 24" role="img" aria-label="${esc(lockLabel)}"><title>${esc(lockLabel)}</title><rect x="5" y="10" width="14" height="11" rx="3"/>${locked == null ? '<path d="M10 5a2 2 0 1 1 3 2l-1 1M12 15v2"/>' : `<path d="${locked ? 'M8 10V7a4 4 0 0 1 8 0v3' : 'M8 10V6a4 4 0 0 1 8 0'}M12 15v2"/>`}</svg>
            ${rearZones.length ? `<g class="tsl-climate-rear-settings">${rearZones.map(([key, label], i) => glassSetting(key, label, cl[key], rearZones.length === 1 ? 120 : i ? 148 : 92, 340)).join('')}</g>` : ''}
          </svg>
          <div class="tsl-outside-temp"><span>${esc(t('tsl_outside'))}</span><b>${s.outside_temp != null ? esc(fmt.temp(s.outside_temp)) : '–'}</b></div></div>
          <div class="tsl-energy-side">${statusStrip()}<div class="tsl-energy" style="--energy:${energy};--level:${level || 0}%;--limit:${limit || 0}%">
            <div class="tsl-energy-head"><div class="tsl-energy-label"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="6" width="17" height="12" rx="3"/><path d="M22 10v4"/>${charging ? '<path d="m11 8-4 5h4l-1 3 5-6h-4l1-2Z"/>' : '<path d="M6 10v4m4-4v4m4-4v4"/>'}</svg>${esc(t('tsl_tab_battery'))}</div>${limit != null ? `<span class="tsl-energy-limit">${esc(t('tsl_limit', { n: limit }))}</span>` : ''}</div>
            <div class="tsl-energy-metrics"><div class="tsl-energy-value">${level == null ? '–' : nf(level)}<small>%</small></div><div class="tsl-energy-distance"><span>${esc(t('tsl_energy_range'))}</span><div class="tsl-energy-range">${s.range_km != null ? `${esc(nf(U.dist(s.range_km), 0))}<small> ${esc(U.distU())}</small>` : '–'}</div></div></div>
            <div class="tsl-energy-track" ${level == null ? 'role="img"' : `role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${level}"`} aria-label="${esc(t('tsl_tab_battery'))}: ${level == null ? esc(t('tsl_st_unknown')) : nf(level) + '%'}">${limit != null ? '<i></i>' : ''}</div>
          </div></div></div>
      </div>`;
    }
    function refreshNotice() {
      return st.refreshNotice ? `<p class="tsl-note" role="status" aria-live="polite">${esc(t(st.refreshNotice))}</p>` : '';
    }
    function bindRefresh(p) {
      const button = p.querySelector('[data-refresh]');
      if (!button) return;
      button.addEventListener('click', async () => {
        if (st.refreshing || !canManage() || !st.status.connected) return;
        const vid = st.vid;
        st.refreshing = true; button.disabled = true; button.textContent = t('tsl_refresh_loading');
        st.refreshNotice = 'tsl_refresh_loading';
        try {
          const result = await api('/v/' + vid + '/refresh', { method: 'POST' });
          st.refreshNotice = result.updated ? 'tsl_refresh_done' : 'tsl_refresh_unavailable';
        } catch (e) {
          st.refreshNotice = e.message === 'refresh_busy' ? 'tsl_refresh_busy' : e.message === 'reauth' ? 'tsl_set_reauth' : 'tsl_refresh_failed';
        } finally {
          st.refreshing = false;
          if (!destroyed && st.tab === 'now' && st.vid === vid && p === page()) await renderNow(p, true);
        }
      });
    }
    function drawNow(p, quiet) {
      if(!quiet)clearMaps();
      const d = st.now, v = d.vehicle, s = d.sample, state = d.state;
      const col = V.STATE_COL[state] || '#64748b';
      let note = '';
      if (state === 'asleep') note = t('tsl_note_asleep');
      else if (state === 'online' && d.mode === 'suspend') note = t('tsl_note_rest');
      if (!s) {
        p.innerHTML = `<div class="tsl-card tsl-center"><h3>${esc(v.name || modelName(v.model))}</h3><p>${esc(t('tsl_wait_first'))}</p>${canManage() && st.status.connected ? `<button class="tsl-btn pri" data-refresh ${st.refreshing ? 'disabled' : ''}>↻ ${esc(t('tsl_refresh_live'))}</button>` : ''}${refreshNotice()}</div>`;
        bindRefresh(p); return;
      }
      const charging = state === 'charging';
      let html = nowHero(d, st.carNow, col, note, charging) + refreshNotice();

      if (state === 'driving' && d.trip) {
        html += `<div class="tsl-card"><h3>${esc(t('tsl_this_trip'))}</h3><div class="tsl-grid">
          ${tile(t('tsl_speed'), fmt.speed(s.speed || 0))}${tile(t('tsl_power'), fmt.kw(s.power || 0))}
          ${tile(t('tsl_trip_distance'), fmt.dist(d.trip.distance_km))}${tile(t('tsl_trip_energy'), fmt.kwh(d.trip.energy_kwh))}</div></div>`;
      }
      if (charging && d.charge) {
        html += `<div class="tsl-card"><h3>${esc(t('tsl_st_charging'))}</h3><div class="tsl-grid">
          ${tile(t('tsl_power'), fmt.kw(d.charge_power || 0))}
          ${tile(t('tsl_chg_added'), fmt.kwh(d.charge.kwh))}
          ${tile(t('tsl_tab_battery'), `${d.charge.start_batt}% → ${s.battery}%`, s.charge_limit ? esc(t('tsl_limit', { n: s.charge_limit })) : '')}
          ${s.to_full ? tile(t('tsl_full_in_label'), fmt.dur(s.to_full * 60)) : ''}
          ${d.charge.cost_totals&&d.charge.cost_totals.length ? tile(t('tsl_chg_cost'),esc((d.charge.cost_complete?'':'≥ ')+costMoney(d.charge))) : d.charge.cost!=null?tile(t('tsl_chg_cost'),money(d.charge.cost,d.charge.cost_currency)):''}</div></div>`;
      }

      const tdy = d.today;
      html += `<div class="tsl-card"><h3>${esc(t('tsl_today'))}</h3><div class="tsl-grid">
        ${tile(t('tsl_tab_trips'), nf(tdy.trips), fmt.dist(tdy.km))}
        ${tile(t('tsl_used'), fmt.kwh(tdy.kwh))}
        ${tile(t('tsl_charged'), fmt.kwh(tdy.charged_kwh))}</div></div>`;

      html += `<div class="tsl-two"><div class="tsl-card"><h3>${esc(t('tsl_position'))}${d.place ? ' · ' + esc(d.place) : ''}</h3><div id="tsl-nowmap"></div></div><div>`;
      if (d.last_trip) {
        const lt = d.last_trip;
        html += `<div class="tsl-card" style="margin-top:12px"><h3>${esc(t('tsl_last_trip'))}</h3>${tripRow(lt, 'last_trip')}</div>`;
      }
      if (d.last_charge) {
        html += `<div class="tsl-card"><h3>${esc(t('tsl_last_charge'))}</h3>${chargeRow(d.last_charge, 'last_charge')}</div>`;
      }
      html += `</div></div><div class="tsl-card"><h3>${esc(t('tsl_activity'))}</h3>${V.strip(st.tl)}</div>`;
      const restore=replacePage(p,html,quiet);
      refreshChargingDialog();
      if (statusDialog && !activeStatuses().some(e => e.id === statusDialog.dataset.statusId)) statusDialog.close();
      p.querySelectorAll('[data-charge-details],[data-charge-open]').forEach(cable => cable.addEventListener('click', openCharging));
      p.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => openStatus(b.dataset.status)));
      p.querySelectorAll('[data-tire]').forEach(b => b.addEventListener('click', () => openTires(b.dataset.tire)));
      bindRefresh(p);
      p.querySelector('[data-day-history]')?.addEventListener('click',()=>openDayHistory(p));
      p.querySelectorAll('[data-open]').forEach(r => r.addEventListener('click', () => {
        const [kind, id] = r.dataset.open.split(':'); openDetail(kind, +id);
      }));
      if (s.lat != null && s.lng != null) mountPageMap(p.querySelector('#tsl-nowmap'), [], { marker: [s.lat, s.lng] });
      else {discardPageMap(p.querySelector('#tsl-nowmap'));p.querySelector('#tsl-nowmap').innerHTML = `<div class="tsl-empty">${esc(t('tsl_no_position'))}</div>`;}
      const mm = p.querySelector('#tsl-nowmap .tsl-map'); if (mm) mm.classList.add('tall');
      const m0 = maps[0]; if (m0) setTimeout(() => m0.redraw(), 50);
      restore();
    }

    function openDayHistory(p) {
      if(dayHistory){dayHistory.close(true);return;}
      const liveNow=st.now,liveCar=st.carNow,vid=st.vid;
      let closed=false,request=0,frames=[],position=0,playing=false,raf=0,lastTick=0,acc=0,dayPicker=null,layoutFrame=0;
      const picker=window.mvmOS?.dateTimePicker,zone=picker?.settings({}).timeZone;
      const panel=document.createElement('div');panel.className='tsl-day-history';
      const localDate=ts=>{if(picker)return picker.fromEpoch(ts,{type:'date',timeZone:zone});const d=new Date(ts*1000);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
      panel.innerHTML=`<div class="tsl-day-toolbar"><label><span class="tsl-day-label">${esc(t('tsl_history_title'))}</span><span data-day-calendar><input type="hidden" data-day-date aria-label="${esc(t('tsl_history_date'))}"></span></label><button type="button" class="tsl-btn" data-day-live title="${esc(t('tsl_history_live'))}" aria-label="${esc(t('tsl_history_live'))}"><span aria-hidden="true">↩</span><span class="tsl-day-live-copy"> ${esc(t('tsl_history_live'))}</span></button></div><div data-day-content></div>`;
      p.querySelector('.tsl-hero').appendChild(panel);p.querySelector('.tsl-hero').classList.add('tsl-history-open');
      const siblings=[...p.children].filter(el=>!el.classList.contains('tsl-hero'));siblings.forEach(el=>el.hidden=true);
      let date=panel.querySelector('[data-day-date]');const body=panel.querySelector('[data-day-content]');
      const controller={close(redraw){if(closed)return;closed=true;++request;pause();cancelAnimationFrame(layoutFrame);layoutObserver.disconnect();if(dayPicker)dayPicker.destroy();document.removeEventListener('visibilitychange',visibility);dayHistory=null;st.now=liveNow;st.carNow=liveCar;panel.remove();p.querySelector('.tsl-hero')?.classList.remove('tsl-history-open');siblings.forEach(el=>el.hidden=false);closeDetails();if(redraw&&!destroyed&&st.tab==='now'&&p===page()){drawNow(p,true);renderNow(p,true);}}};
      function fitHistory(){cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(()=>{
        if(closed)return;const hero=p.querySelector('.tsl-hero');if(!hero)return;
        const box=hero.getBoundingClientRect(),outer=scroller.getBoundingClientRect();
        const top=box.top-outer.top+scroller.scrollTop;
        const style=getComputedStyle(hero),head=hero.querySelector('.tsl-hero-head');
        const room=scroller.clientHeight-top-head.offsetHeight-panel.offsetHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom)-30;
        hero.style.setProperty('--tsl-history-stage',Math.max(160,Math.min(360,room))+'px');
      });}
      const layoutObserver=new ResizeObserver(fitHistory);layoutObserver.observe(scroller);layoutObserver.observe(panel);
      dayHistory=controller;
      const time=ts=>new Intl.DateTimeFormat(window.mvmOS?.lang||'en',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:picker.settings({}).timeFormat==='12',timeZone:zone}).format(new Date(ts*1000));
      function closeDetails(){if(statusDialog)statusDialog.close();if(chargingDialog)chargingDialog.close();if(tireDialog)tireDialog.close();}
      function pause(){playing=false;cancelAnimationFrame(raf);const b=panel.querySelector('[data-day-play]');if(b){b.textContent='▶';b.setAttribute('aria-label',t('tsl_replay_play'));}}
      function visibility(){if(document.hidden)pause();}document.addEventListener('visibilitychange',visibility);
      function show(){
        const f=frames[position];if(!f)return;
        closeDetails();const s=f.sample;
        st.now={...liveNow,sample:s,state:f.state||s.state||'unknown',since:f.since??s.ts,now:f.ts??s.ts,trip:null,charge:f.charge||null,charge_power:s.charger_power};
        st.now.vehicle={...liveNow.vehicle,version:s.version||''};
        const data={...f.car.data},cl={...(data.climate_state||{})},vs={...(data.vehicle_state||{})};
        if(cl.is_climate_on==null&&s.climate!=null)cl.is_climate_on=!!s.climate;
        if(cl.inside_temp==null)cl.inside_temp=s.inside_temp;
        if(cl.outside_temp==null)cl.outside_temp=s.outside_temp;
        if(vs.sentry_mode==null&&s.sentry!=null)vs.sentry_mode=!!s.sentry;
        st.carNow={...f.car,data:{...data,climate_state:cl,vehicle_state:vs}};
        const hero=p.querySelector('.tsl-hero'),temp=document.createElement('div');
        temp.innerHTML=nowHero(st.now,st.carNow,V.STATE_COL[st.now.state]||'#64748b',t('tsl_history_title'),st.now.state==='charging');
        temp.firstElementChild.style.setProperty('--tsl-history-stage',hero.style.getPropertyValue('--tsl-history-stage')||'280px');
        panel.remove();hero.replaceWith(temp.firstElementChild);p.querySelector('.tsl-hero').classList.add('tsl-history-open');p.querySelector('.tsl-hero').appendChild(panel);fitHistory();
        const toggle=p.querySelector('[data-day-history]');toggle.classList.add('on');toggle.setAttribute('aria-expanded','true');toggle.onclick=()=>controller.close(true);
        const refresh=p.querySelector('[data-refresh]');if(refresh)refresh.hidden=true;
        p.querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>openStatus(b.dataset.status));
        p.querySelectorAll('[data-charge-details],[data-charge-open]').forEach(b=>b.onclick=openCharging);
        p.querySelectorAll('[data-tire]').forEach(b=>{b.disabled=true;});
        panel.querySelector('[data-day-seek]').value=position;
        panel.querySelector('[data-day-time]').textContent=time(f.ts??s.ts);
        panel.querySelector('[data-day-reading]').textContent=`${position+1} / ${frames.length}`;
        const location=panel.querySelector('[data-day-location]');
        location.textContent='⌖ '+(f.location||(Number.isFinite(s.lat)&&Number.isFinite(s.lng)?s.lat.toFixed(5)+', '+s.lng.toFixed(5):t('tsl_replay_no_position')));
        location.title=location.textContent;location.setAttribute('aria-label',t('tsl_position')+': '+location.textContent);
        panel.querySelector('[data-day-metrics]').textContent=[st.now.state==='driving'&&s.speed!=null?fmt.speed(s.speed):null,st.now.state==='charging'&&s.charger_power!=null?fmt.kw(s.charger_power):null].filter(Boolean).join(' · ');
      }
      function tick(now){if(!playing||closed)return;acc+=(now-lastTick)/1000;lastTick=now;if(acc>=1){const step=Math.floor(acc);acc-=step;position=Math.min(frames.length-1,position+step);show();if(position===frames.length-1){pause();return;}}raf=requestAnimationFrame(tick);}
      async function load(){
        pause();closeDetails();const serial=++request;frames=[];p.querySelector('.tsl-cockpit').hidden=true;p.querySelector('.tsl-sub').hidden=true;p.querySelector('.tsl-live-status .tsl-pill').hidden=true;p.querySelector('[data-refresh]').hidden=true;body.innerHTML=`<p class="tsl-note" role="status">${esc(t('tsl_loading'))}</p>`;
        try{
          const a=new Date(date.value+'T00:00:00'),b=new Date(a);b.setDate(b.getDate()+1);
          if(!Number.isFinite(+a))throw Error('invalid_date');
          const start=picker?picker.toEpoch(date.value,{type:'date',timeZone:zone}):Math.floor(+a/1000),end=picker?picker.toEpoch(datePlus(date.value,1),{type:'date',timeZone:zone}):Math.floor(+b/1000);
          const result=await api('/v/'+vid+'/history?start='+start+'&end='+end);
          if(closed||serial!==request)return;frames=result.frames||[];
          if(!frames.length){body.innerHTML=`<p class="tsl-note" role="status">${esc(t('tsl_history_empty'))}</p>`;p.querySelector('.tsl-cockpit').hidden=true;return;}
          body.innerHTML=`<div class="tsl-day-playbar"><button type="button" class="tsl-btn" data-day-play aria-label="${esc(t('tsl_replay_play'))}" ${frames.length<2?'disabled':''}>▶</button><b data-day-time></b><span data-day-metrics></span><small data-day-reading></small></div><input type="range" min="0" max="${frames.length-1}" step="1" value="0" data-day-seek aria-label="${esc(t('tsl_history_seek'))}"><div class="tsl-day-ends"><span>${esc(time(frames[0].ts??frames[0].sample.ts))}</span><span>${esc(time(frames.at(-1).ts??frames.at(-1).sample.ts))}</span></div><p class="tsl-note" data-day-location></p><details class="tsl-day-help"><summary aria-label="${esc(t('tsl_history_note'))}">ⓘ</summary><p>${esc(t('tsl_history_note'))}</p></details>`;
          position=0;show();
          panel.querySelector('[data-day-seek]').oninput=e=>{pause();position=+e.target.value;show();};
          panel.querySelector('[data-day-play]').onclick=()=>{if(playing){pause();return;}if(position>=frames.length-1){position=0;show();}playing=true;acc=0;lastTick=performance.now();const btn=panel.querySelector('[data-day-play]');btn.textContent='Ⅱ';btn.setAttribute('aria-label',t('tsl_replay_pause'));raf=requestAnimationFrame(tick);};
        }catch(e){if(!closed&&serial===request){body.innerHTML=`<p class="tsl-note" role="alert">${esc(t('tsl_error'))}</p><button type="button" class="tsl-btn" data-day-retry>${esc(t('tsl_elev_retry'))}</button>`;body.querySelector('button').onclick=load;}}
      }
      date.onchange=load;date.onfocus=pause;panel.querySelector('[data-day-live]').onclick=()=>controller.close(true);
      const toggle=p.querySelector('[data-day-history]');toggle.setAttribute('aria-expanded','true');
      (async()=>{try{const bounds=await api('/v/'+vid+'/history');if(closed)return;if(bounds.first!=null)date.min=localDate(bounds.first);if(bounds.last!=null)date.max=localDate(bounds.last);date.value=localDate(bounds.last??liveNow.sample.ts);if(picker){const value=date.value,min=date.min,max=date.max,host=panel.querySelector('[data-day-calendar]');host.replaceChildren();dayPicker=picker.create(host,{type:'date',timeZone:zone,label:t('tsl_history_date'),value,min,max,required:true});date=dayPicker.input;date.dataset.dayDate='';date.onchange=load;dayPicker.button.addEventListener('click',pause);}await load();}catch(e){if(!closed){body.innerHTML=`<p class="tsl-note" role="alert">${esc(t('tsl_error'))}</p>`;date.value=localDate(liveNow.sample.ts);}}})();
    }

    // ── Trips ─────────────────────────────────────────────────────────────
    function tripRow(r) {
      const start = r.start_batt == null ? null : Math.max(0, Math.min(100, r.start_batt));
      const end = r.end_batt == null ? null : Math.max(0, Math.min(100, r.end_batt));
      const metric = (label, value) => `<span><b>${esc(value)}</b><small>${esc(t(label))}</small></span>`;
      return `<button type="button" class="tsl-drive-card" data-open="trip:${r.id}">
        <div class="tsl-drive-meta"><time datetime="${new Date(r.start_ts * 1000).toISOString()}">${esc(fmt.date(r.start_ts))}<b>${esc(fmt.time(r.start_ts))}</b></time><span class="tsl-drive-duration">${esc(fmt.dur(r.duration))}</span></div>
        <div class="tsl-drive-route"><span>${esc(place(r.start_place, r.start_addr))}</span><span>${esc(place(r.end_place, r.end_addr))}</span></div>
        <div class="tsl-drive-metrics">${metric('tsl_trip_distance', fmt.dist(r.distance_km))}${metric('tsl_trip_energy', r.energy_kwh == null ? '–' : fmt.kwh(r.energy_kwh))}${metric('tsl_trip_eff', r.wh_km == null ? '–' : fmt.eff(r.wh_km))}</div>
        ${start != null && end != null ? `<div class="tsl-drive-battery"><span>${esc(t('tsl_trip_batt'))}</span><div class="tsl-drive-battery-track" aria-hidden="true"><i style="width:${Math.min(start,end)}%"></i><i class="used" style="left:${Math.min(start,end)}%;width:${Math.abs(start-end)}%"></i></div><span>${esc(nf(start))}% → ${esc(nf(end))}%</span></div>` : ''}
      </button>`;
    }
    async function renderTrips(p) {
      if (st.detail) return renderTripDetail(p);
      if (!st.trips.length) {
        p.innerHTML = `<div class="tsl-center">${esc(t('tsl_loading'))}</div>`;
        try { const d = await api('/v/' + st.vid + '/trips?limit=40'); st.trips = d.trips; st.tripsTotal = d.total; }
        catch (e) { p.innerHTML = `<div class="tsl-card tsl-center">${esc(t('tsl_error'))}</div>`; return; }
      }
      if (destroyed || st.tab !== 'trips' || st.detail) return;
      drawTrips(p);
    }
    function drawTrips(p) {
      if (!st.trips.length) { p.innerHTML = `<div class="tsl-card tsl-center">${esc(t('tsl_trips_none'))}</div>`; return; }
      p.innerHTML = `<div class="tsl-drive-list">${st.trips.map(r => tripRow(r)).join('')}</div>
        ${st.trips.length < st.tripsTotal ? `<div class="tsl-btns" style="justify-content:center"><button class="tsl-btn" id="tsl-more">${esc(t('tsl_more'))}</button></div>` : ''}`;
      p.querySelectorAll('[data-open]').forEach(r => r.addEventListener('click', () => openDetail('trip', +r.dataset.open.split(':')[1])));
      const more = p.querySelector('#tsl-more');
      if (more) more.addEventListener('click', async () => {
        const d = await api('/v/' + st.vid + '/trips?limit=40&offset=' + st.trips.length); st.trips = st.trips.concat(d.trips); drawTrips(p);
      });
    }
    async function openDetail(kind, id) {
      const vid=st.vid,seq=++seqLoad; st.journey=null; st.detail=null; st.tab = kind === 'trip' ? 'trips' : 'charges'; frame(); const p = page(); clearMaps();
      p.innerHTML = `<div class="tsl-center">${esc(t('tsl_loading'))}</div>`;
      try { const d=await api('/v/' + vid + '/' + (kind === 'trip' ? 'trips/' : 'charges/') + id);if(destroyed||seq!==seqLoad||st.vid!==vid)return;st.detail=Object.assign(d,{kind}); }
      catch (e) { p.innerHTML = `<div class="tsl-card tsl-center">${esc(t('tsl_error'))}</div>`; return; }
      if (destroyed) return;
      kind === 'trip' ? renderTripDetail(p) : renderChargeDetail(p);
    }
    function backBtn() { return `<div class="tsl-head"><button class="tsl-btn" id="tsl-back">← ${esc(t('tsl_back'))}</button></div>`; }
    function hookBack(p) { p.querySelector('#tsl-back').addEventListener('click', () => { if(st.returnJourney){const id=st.returnJourney;st.returnJourney=null;openJourney(id);}else{st.detail=null;st.journey=null;frame();render();} }); }
    function renderTripDetail(p) {
      const d = st.detail;
      if(d.analysis){p.innerHTML=backBtn()+`<div class="tsl-card"><h3>${esc(fmt.dateTime(d.start_ts))}</h3><b>${esc(place(d.start_place,d.start_addr))} → ${esc(place(d.end_place,d.end_addr))}</b></div>`+analysisMarkup(d.analysis,false)+`<div class="tsl-card"><h3>${esc(t('tsl_chart_speed'))}</h3><div id="tsl-drive-speed"></div></div><div class="tsl-card"><h3>${esc(t('tsl_chart_power'))}</h3><div id="tsl-drive-power"></div></div>`;hookBack(p);mountAnalysis(p,d.analysis,false);[[3,'#tsl-drive-speed','var(--tsl-blue,#60a5fa)',v=>U.speed(v),v=>fmt.speed(v)],[4,'#tsl-drive-power','var(--tsl-amber,#f59e0b)',v=>v,v=>fmt.kw(v)]].forEach(([i,id,color,convert,format])=>{const data=d.points.filter(x=>x[i]!=null).map(x=>[x[0],convert(x[i])]);if(data.length)V.chart(p.querySelector(id),{type:'line',series:[{color,data}],height:180,xFmt:x=>fmt.time(x),yFmt:v=>nf(v),tipFmt:i===3?v=>nf(v)+' '+U.speedU():format});});return;}
      p.innerHTML = `${backBtn()}<div class="tsl-card"><h3>${esc(fmt.dateTime(d.start_ts))}</h3>
        <div style="font-size:1.15rem;font-weight:700">${esc(place(d.start_place, d.start_addr))} → ${esc(place(d.end_place, d.end_addr))}</div>
        <div id="tsl-tmap" style="margin-top:12px"></div></div>
        <div class="tsl-card"><div class="tsl-grid">
        ${tile(t('tsl_trip_distance'), fmt.dist(d.distance_km))}${tile(t('tsl_trip_duration'), fmt.dur(d.duration))}
        ${tile(t('tsl_trip_avg'), fmt.speed(d.avg_speed))}${tile(t('tsl_trip_max'), fmt.speed(d.max_speed))}
        ${tile(t('tsl_trip_energy'), fmt.kwh(d.energy_kwh))}${tile(t('tsl_trip_eff'), d.wh_km ? fmt.eff(d.wh_km) : '–')}
        ${tile(t('tsl_trip_batt'), d.start_batt != null ? `${d.start_batt??'–'}% → ${d.end_batt??'–'}%` : '–')}${d.temp_out != null ? tile(t('tsl_outside'), fmt.temp(d.temp_out)) : ''}</div></div>
        <div class="tsl-card"><h3>${esc(t('tsl_chart_speed'))}</h3><div id="tsl-c1"></div></div>
        <div class="tsl-card"><h3>${esc(t('tsl_chart_power'))}</h3><div id="tsl-c2"></div></div>`;
      hookBack(p);
      const pts = d.points;
      maps.push(V.tileMap(p.querySelector('#tsl-tmap'), pts.map(x => [x[1], x[2], x[3]]), { color: speedColor }));
      const mm = p.querySelector('.tsl-map'); if (mm) mm.classList.add('tall');
      setTimeout(() => maps[0] && maps[0].redraw(), 50);
      V.chart(p.querySelector('#tsl-c1'), { type: 'line', series: [{ color: 'var(--tsl-blue,#60a5fa)', data: pts.map(x => [x[0], U.speed(x[3] || 0)]) }], xFmt: (x, full) => full ? fmt.time(x) : fmt.time(x), yFmt: v => nf(v), tipFmt: v => nf(v) + ' ' + U.speedU(), height: 180 });
      V.chart(p.querySelector('#tsl-c2'), { type: 'line', series: [{ color: 'var(--tsl-amber,#f59e0b)', data: pts.map(x => [x[0], x[4] || 0]) }], xFmt: x => fmt.time(x), yFmt: v => nf(v), tipFmt: v => nf(v) + ' ' + t('tsl_u_kw'), yMin: Math.min(0, Math.min.apply(null, pts.map(x => x[4] || 0))), height: 180 });
    }

    // Saved journeys and automatic drives share the same history report.
    const journeyDate = ts => window.mvmOS.dateTimePicker ? window.mvmOS.dateTimePicker.format(window.mvmOS.dateTimePicker.fromEpoch(ts)) : fmt.dateTime(ts);
    function journeyStatus(j) { return `<span class="tsl-badge journey-${j.status}">${esc(t('tsl_j_' + j.status))}</span>`; }
    let journeyDialog = null, journeyPickers=[];
    function closeJourneyDialog() { journeyPickers.forEach(p=>p.destroy());journeyPickers=[]; if (journeyDialog) { journeyDialog.close(); journeyDialog.remove(); journeyDialog = null; } }
    async function journeyEditor(j, remove) {
      if (!canManage()) return;
      const picker=window.mvmOS.dateTimePicker;
      if(!picker){toast(t('tsl_error'));return;}
      await picker.ready();if(destroyed)return;
      closeJourneyDialog();
      const vid = st.vid, dialog = document.createElement('dialog'), opener = document.activeElement;
      journeyDialog = dialog; dialog.className = 'tsl-tire-dialog tsl-journey-dialog';
      const local = ts => picker.fromEpoch(ts);
      const now = Math.floor(Date.now()/1000);
      dialog.innerHTML = `<form><header><h2>${esc(t(remove ? 'tsl_delete' : j ? 'tsl_edit' : 'tsl_j_new'))}</h2></header>${remove ? `<p>${esc(t('tsl_j_delete_hint'))}</p>` : `
        <label>${esc(t('tsl_j_name'))}<input name="name" required maxlength="120" value="${esc(j ? j.name : '')}" autocomplete="off"></label>
        <div class="tsl-journey-dates"><label>${esc(t('tsl_j_from'))}<div data-picker="start"></div></label>
        <label>${esc(t('tsl_j_to'))}<div data-picker="end"></div></label></div>
        <p class="tsl-note">${esc(t('tsl_j_hint'))}</p>`}
        <p role="alert" class="tsl-journey-error"></p><div class="tsl-btns"><button type="button" class="tsl-btn" data-cancel>${esc(t('tsl_cancel'))}</button><button type="submit" class="tsl-btn pri">${esc(t(remove ? 'tsl_delete' : 'tsl_save'))}</button></div></form>`;
      scroller.appendChild(dialog);
      let startPicker,endPicker;
      if(!remove){startPicker=picker.create(dialog.querySelector('[data-picker=start]'),{name:'start',label:t('tsl_j_from'),required:true,value:local(j?j.start_ts:now)});endPicker=picker.create(dialog.querySelector('[data-picker=end]'),{name:'end',label:t('tsl_j_to'),required:true,value:local(j?j.end_ts:now+86400*3)});journeyPickers=[startPicker,endPicker];}
      const cleanup = () => { journeyPickers.forEach(p=>p.destroy());journeyPickers=[];dialog.remove(); if(journeyDialog === dialog) journeyDialog = null; if(opener && opener.isConnected) opener.focus(); };
      dialog.addEventListener('close', cleanup, {once:true});
      dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
      dialog.querySelector('form').onsubmit = async e => {
        e.preventDefault(); const form = e.target, alert = form.querySelector('[role=alert]'), submit = form.querySelector('[type=submit]');
        let body;
        if (!remove) {
          body = {name:form.elements.name.value.trim(),start_ts:picker.toEpoch(startPicker.value),end_ts:picker.toEpoch(endPicker.value)};
          if(j&&startPicker.value===local(j.start_ts))body.start_ts=j.start_ts;
          if(j&&endPicker.value===local(j.end_ts))body.end_ts=j.end_ts;
          if (!body.name || !startPicker.validate() || !endPicker.validate() || !Number.isFinite(body.start_ts) || !Number.isFinite(body.end_ts) || body.end_ts <= body.start_ts) { alert.textContent = t('tsl_j_invalid'); return; }
        }
        submit.disabled = true;
        try {
          const saved = await api('/v/'+vid+'/journeys'+(j ? '/'+j.id : ''), {method:remove?'DELETE':j?'PUT':'POST', ...(body ? {body:JSON.stringify(body)} : {})});
          dialog.close();
          if (destroyed || st.vid !== vid) return;
          if(remove) go('journeys'); else openJourney(saved.id);
        } catch(e) { alert.textContent = t(e.message === 'invalid_journey' ? 'tsl_j_invalid' : 'tsl_error'); submit.disabled=false; }
      };
      dialog.showModal();
    }
    async function renderJourneys(p, quiet) {
      if (st.journey) return drawJourney(p);
      const vid = st.vid, seq = ++seqLoad;
      if(!quiet)p.innerHTML = `<div class="tsl-center">${esc(t('tsl_loading'))}</div>`;
      try {
        let offset=0, rows=[];
        const draw = () => {
          const restore=replacePage(p,`<div class="tsl-head"><button class="tsl-btn pri" id="tsl-j-new">＋ ${esc(t('tsl_j_new'))}</button></div><p class="tsl-note">${esc(t('tsl_j_hint'))}</p><div class="tsl-journey-list">${rows.length ? rows.map(j => `<button class="tsl-card tsl-journey-card" data-journey="${esc(j.id)}"><div>${journeyStatus(j)}<h2>${esc(j.name)}</h2></div><div class="tsl-journey-period"><span><small>${esc(t('tsl_j_from'))}</small>${esc(journeyDate(j.start_ts))}</span><span><small>${esc(t('tsl_j_to'))}</small>${esc(journeyDate(j.end_ts))}</span></div><span aria-hidden="true">↗</span></button>`).join('') : `<div class="tsl-card tsl-center">${esc(t('tsl_j_empty'))}</div>`}</div>${offset < total ? `<button class="tsl-btn" id="tsl-j-more">${esc(t('tsl_more'))}</button>` : ''}`,quiet);
          p.querySelector('#tsl-j-new').onclick=()=>journeyEditor();
          p.querySelectorAll('[data-journey]').forEach(b=>b.onclick=()=>openJourney(b.dataset.journey));
          restore();
          const more=p.querySelector('#tsl-j-more'); if(more) more.onclick=()=>{more.disabled=true; load().catch(()=>{more.disabled=false;toast(t('tsl_error'));});};
        };
        let total=0;
        const load = async () => {const d=await api('/v/'+vid+'/journeys?offset='+offset); if(destroyed||seq!==seqLoad||st.vid!==vid||st.tab!=='journeys'||st.journey)return; rows=rows.concat(d.journeys);offset=rows.length;total=d.total;const apply=()=>{if(!destroyed&&seq===seqLoad&&st.tab==='journeys'&&!st.journey)draw();};if(quiet)queueQuietRender(apply);else apply();};
        await load();
      } catch(e) { if(seq===seqLoad&&!quiet) p.innerHTML=`<div class="tsl-card tsl-center">${esc(t('tsl_error'))}</div>`; }
    }
    async function openJourney(id, quiet) {
      const vid=st.vid, seq=++seqLoad;
      st.tab='journeys'; st.detail=null;
      if(!quiet){clearMaps();frame();page().innerHTML=`<div class="tsl-center">${esc(t('tsl_loading'))}</div>`;}
      try {
        const d=await api('/v/'+vid+'/journeys/'+id);
        if(destroyed||seq!==seqLoad||st.vid!==vid||st.tab!=='journeys')return;
        const apply=()=>{if(destroyed||seq!==seqLoad||st.tab!=='journeys'||st.vid!==vid)return;st.journey=d;if(!quiet)clearMaps();drawJourney(page(),quiet);};if(quiet)queueQuietRender(apply);else apply();
      }catch(e){if(seq!==seqLoad)return;if(quiet)toast(t('tsl_error'));else page().innerHTML=backBtn()+`<div class="tsl-card tsl-center">${esc(t('tsl_error'))}</div>`;if(!quiet)hookBack(page());}
    }
    function drawJourney(p, quiet) {
      if(quiet && replayPlaying)return;
      const d=st.journey,j=d.journey;
      const restore=replacePage(p,backBtn()+`<div class="tsl-card tsl-journey-heading"><div>${journeyStatus(j)}<h2>${esc(j.name)}</h2><p class="tsl-sub">${esc(journeyDate(j.start_ts))} → ${esc(journeyDate(j.end_ts))}</p></div><div class="tsl-btns"><button class="tsl-btn" id="tsl-j-edit">${esc(t('tsl_edit'))}</button>${j.status!=='completed'?`<button class="tsl-btn pri" id="tsl-j-action">${esc(t(j.status==='planned'?'tsl_j_start':'tsl_j_stop'))}</button>`:''}<button class="tsl-btn" id="tsl-j-delete">${esc(t('tsl_delete'))}</button></div></div>`+analysisMarkup(d.analysis,true),quiet);
      hookBack(p);p.querySelector('#tsl-j-edit').onclick=()=>journeyEditor(j);p.querySelector('#tsl-j-delete').onclick=()=>journeyEditor(j,true);
      const action=p.querySelector('#tsl-j-action');if(action)action.onclick=async()=>{action.disabled=true;try{await api('/v/'+st.vid+'/journeys/'+j.id+'/'+(j.status==='planned'?'start':'stop'),{method:'POST'});if(st.tab==='journeys'&&st.journey&&st.journey.journey.id===j.id)await openJourney(j.id);}catch(e){action.disabled=false;toast(t('tsl_error'));}};
      mountAnalysis(p,d.analysis,true);restore();
    }
    const reportDur = n => n > 0 ? fmt.dur(n) : n === 0 ? '0 '+t('tsl_u_min') : '–';
    function analysisMarkup(a,saved) {
      const s=a.stats, readings=s.readings_stats, metric=(key,value,sub)=>key==='tsl_trip_batt' && s.start_battery!=null && s.end_battery!=null ? batteryMetric(s.start_battery,s.end_battery) : tile(t(key),esc(value),sub?esc(sub):'');
      const F={dist:v=>v==null?'–':fmt.dist(v),kwh:v=>v==null?'–':fmt.kwh(v),speed:v=>v==null?'–':fmt.speed(v)};
      const battery=s.start_battery!=null&&s.end_battery!=null?`${nf(s.start_battery)}% → ${nf(s.end_battery)}%`:'–';
      const range = r => r&&r.min!=null ? (fmt.temp(r.min)===fmt.temp(r.max)?fmt.temp(r.min):`${fmt.temp(r.min)} – ${fmt.temp(r.max)}`):'–';
      return `<div class="tsl-card tsl-report-summary"><div class="tsl-grid">${metric('tsl_trip_distance',(s.distance_complete?'':'≈ ')+F.dist(s.distance_km))}${metric('tsl_trip_duration',reportDur(s.driving_seconds),saved?`${nf(s.trips)} ${t('tsl_tab_trips')}`:'')}${metric('tsl_trip_energy',(s.energy_complete?'':'≈ ')+F.kwh(s.energy_kwh))}${metric('tsl_trip_eff',s.wh_km!=null?fmt.eff(s.wh_km):'–')}${metric('tsl_j_regen',F.kwh(s.regen_kwh))}${metric('tsl_trip_avg',F.speed(s.avg_speed))}${metric('tsl_trip_max',F.speed(s.max_speed))}${metric('tsl_trip_batt',battery)}${saved?`${metric('tsl_chg_added',(s.charged_complete?'':'≈ ')+F.kwh(s.charged_kwh),`${nf(s.charges)} ${t('tsl_tab_charges')} · ${nf(s.ac_charges)} AC / ${nf(s.dc_charges)} DC`)}${metric('tsl_chg_duration',reportDur(s.charging_seconds))}${metric('tsl_chg_cost',s.cost_totals&&s.cost_totals.length?s.cost_totals.map(c=>money(c.cost,c.currency)).join(' · '):s.cost!=null?money(s.cost):'–',s.cost_complete?'':t('tsl_j_unpriced'))}`:''}</div></div>
        <div class="tsl-card"><h3>${esc(t('tsl_elev_title'))}</h3><div id="tsl-elevation"><div class="tsl-empty">${esc(t('tsl_loading'))}</div></div><p class="tsl-note">${esc(t('tsl_elev_note'))}</p><a class="tsl-elev-credit" href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener noreferrer">Terrain Tiles · ${esc(t('tsl_elev_credits'))} ↗</a></div>
        <div class="tsl-card"><h3>${esc(t('tsl_j_routes'))}</h3><div id="tsl-report-map"></div><div id="tsl-replay"></div><p class="tsl-note">${esc(t('tsl_j_map_hint'))}</p></div>
        ${a.end>a.start?`<div class="tsl-card"><h3>${esc(t('tsl_states_totals'))}</h3>${V.strip({since:a.start,now:a.end,rows:a.timeline,labels:{unknown:t('tsl_j_unknown')}})}<div class="tsl-report-states">${Object.entries(s.state_seconds).map(([k,v])=>`<span><i style="background:${V.STATE_COL[k]||'#64748b'}"></i>${esc(t(k==='unknown'?'tsl_j_unknown':'tsl_st_'+k))}<b>${esc(reportDur(v))}</b></span>`).join('')}</div></div>`:''}
        <div class="tsl-report-charts"><div class="tsl-card"><h3>${esc(t('tsl_trip_batt'))}</h3><div id="tsl-report-battery"></div></div><div class="tsl-card"><h3>${esc(t('tsl_j_temperatures'))}</h3><div class="tsl-legend"><span style="color:var(--tsl-blue)">● ${esc(t('tsl_inside'))}</span><span style="color:var(--tsl-orange)">● ${esc(t('tsl_outside'))}</span></div><div id="tsl-report-temp"></div></div></div>
        <div class="tsl-card"><h3>${esc(t('tsl_j_observations'))}</h3><div class="tsl-grid">${metric('tsl_inside',range(readings.inside_temp))}${metric('tsl_outside',range(readings.outside_temp))}${Object.entries(s.flags).filter(([,v])=>v.observed_seconds>0).map(([k,v])=>metric('tsl_j_flag_'+k,reportDur(v.seconds))).join('')}${['fl','fr','rl','rr'].filter(k=>readings['tpms_'+k].min!=null).map(k=>tile(t('tsl_c_'+k),esc(nf(readings['tpms_'+k].min*(U.imperial?14.5038:1),U.imperial?0:2)+' – '+nf(readings['tpms_'+k].max*(U.imperial?14.5038:1),U.imperial?0:2)+(U.imperial?' psi':' bar')))).join('')}</div>${Object.values(s.flags).some(v=>v.observed_seconds>0)?`<p class="tsl-note">${esc(t('tsl_j_observed'))}</p>`:''}</div>
        <div class="tsl-card"><h3>${esc(t('tsl_j_history'))}</h3><div id="tsl-report-events"></div></div>
        <div class="tsl-card tsl-note"><b>${esc(t('tsl_j_coverage'))}</b><p>${esc(nf(s.readings))} ${esc(t('tsl_j_readings'))}${s.first_reading?` · ${esc(journeyDate(s.first_reading))} → ${esc(journeyDate(s.last_reading))}`:''}</p>${esc(t('tsl_j_coverage_hint'))}${a.partial?`<p>${esc(t('tsl_j_partial'))}</p>`:''}</div>`;
    }
    function mountReplay(p,a,map) {
      if(replayCleanup){replayCleanup();replayCleanup=null;}
      const host=p.querySelector('#tsl-replay'),points=(a.playback||[]).filter(p=>Number.isFinite(p[0]));
      if(!host || !map)return;
      if(points.length<2){host.innerHTML=`<p class="tsl-note">${esc(t('tsl_replay_empty'))}</p>`;return;}
      host.innerHTML=`<div class="tsl-replay-head"><b>${esc(t('tsl_replay_title'))}</b><time data-replay-clock></time></div><div class="tsl-seg tsl-replay-view"><button type="button" data-replay-view="follow" aria-pressed="true" class="on">◎ ${esc(t('tsl_replay_follow'))}</button><button type="button" data-replay-view="overview" aria-pressed="false">${esc(t('tsl_replay_overview'))}</button></div><div class="tsl-replay-controls"><button type="button" class="tsl-btn pri" data-replay-play>▶ ${esc(t('tsl_replay_play'))}</button><select data-replay-rate aria-label="${esc(t('tsl_replay_rate'))}">${[.5,1,2,4].map(n=>`<option value="${n}" ${n===1?'selected':''}>${nf(n)}×</option>`).join('')}</select><input data-replay-seek type="range" min="0" max="${points.length-1}" step="0.001" value="0" aria-label="${esc(t('tsl_replay_title'))}"></div><div class="tsl-replay-readings"><div><small>${esc(t('tsl_trip_avg'))}</small><b data-replay-speed></b></div><div><small>${esc(t('tsl_power'))}</small><b data-replay-power></b></div><div><small>${esc(t('tsl_trip_batt'))}</small><b data-replay-battery></b></div></div><div class="tsl-replay-caption"><span data-replay-reading></span><span class="tsl-replay-activity" data-replay-position></span></div><p class="tsl-note">${esc(t('tsl_replay_note'))}</p>`;
      // Reuse the speed unit label, without implying this is an average.
      host.querySelector('.tsl-replay-readings small').textContent=t('tsl_chart_speed');
      const button=host.querySelector('[data-replay-play]'),seek=host.querySelector('[data-replay-seek]'),rate=host.querySelector('select');
      const viewButtons=host.querySelectorAll('[data-replay-view]');
      map.onFollowChange(enabled=>viewButtons.forEach(b=>{const active=(b.dataset.replayView==='follow')===enabled;b.classList.toggle('on',active);b.setAttribute('aria-pressed',String(active));}));
      viewButtons.forEach(b=>b.onclick=()=>map.setFollow(b.dataset.replayView==='follow'));
      map.setFollow(true);
      let frame=null,position=0,last=null,closed=false;
      const valid=q=>Number.isFinite(q[1])&&Number.isFinite(q[2])&&Math.abs(q[1])<90&&Math.abs(q[2])<=180;
      function renderFrame(){
        const i=Math.min(points.length-1,Math.floor(position)),q=points[i],next=points[Math.min(i+1,points.length-1)],fraction=position-i;
        seek.value=position;
        host.querySelector('[data-replay-clock]').textContent=fmt.dateTime(q[0]+(next[0]-q[0])*fraction);
        host.querySelector('[data-replay-reading]').textContent=t('tsl_replay_reading')+' '+fmt.dateTime(q[0]);
        host.querySelector('[data-replay-speed]').textContent=q[3]==null?'–':fmt.speed(q[3]);
        const charging=q[6]==='charging',power=charging?q[7]:q[4];
        host.querySelector('[data-replay-power]').textContent=power==null?'–':fmt.kw(power);
        host.querySelector('[data-replay-power]').previousElementSibling.textContent=t(charging?'tsl_replay_charge_power':'tsl_power');
        host.querySelector('[data-replay-battery]').textContent=q[5]==null?'–':nf(q[5])+'%';
        const activity=host.querySelector('[data-replay-position]');activity.textContent=(q[6]?(STATE_ICON[q[6]]||'')+' '+t('tsl_st_'+q[6]):'')+(!valid(q)?' · '+t('tsl_replay_no_position'):'');activity.style.color=V.STATE_COL[q[6]]||'';
        if(valid(q)){
          const blend=valid(next),lat=q[1]+(blend?(next[1]-q[1])*fraction:0),deltaLng=blend?((next[2]-q[2]+540)%360-180):0,lng=((q[2]+deltaLng*fraction+540)%360)-180;
          const heading=blend?Math.atan2(deltaLng*Math.cos(lat*Math.PI/180),next[1]-q[1])*180/Math.PI:0;
          map.setCursor({lat,lng,heading});
        }else map.setCursor(null);
      }
      function pause(){replayPlaying=false;last=null;if(frame!=null)cancelAnimationFrame(frame);frame=null;button.textContent=(position>=points.length-1?'↺ '+t('tsl_replay_restart'):'▶ '+t('tsl_replay_play'));button.setAttribute('aria-pressed','false');}
      function tick(now){
        if(closed || destroyed || !host.isConnected){pause();return;}
        if(last!=null)position=Math.min(points.length-1,position+(now-last)/1000*Number(rate.value));
        last=now;renderFrame();
        if(position>=points.length-1)pause();else frame=requestAnimationFrame(tick);
      }
      button.onclick=()=>{if(replayPlaying){pause();return;}if(position>=points.length-1)position=0;replayPlaying=true;last=null;button.textContent='Ⅱ '+t('tsl_replay_pause');button.setAttribute('aria-pressed','true');frame=requestAnimationFrame(tick);};
      seek.oninput=()=>{position=Number(seek.value);last=null;renderFrame();if(position>=points.length-1)pause();};
      const visibility=()=>{if(document.hidden)pause();};document.addEventListener('visibilitychange',visibility);
      replayCleanup=()=>{closed=true;pause();document.removeEventListener('visibilitychange',visibility);map.onFollowChange(null);map.setCursor(null);map.setFollow(false);};
      renderFrame();
    }
    async function mountElevation(p, saved) {
      const el=p.querySelector('#tsl-elevation'), vid=st.vid;
      if(!el)return;
      const id=saved ? st.journey.journey.id : st.detail.id;
      try {
        const d=await api('/v/'+vid+'/'+(saved?'journeys/':'trips/')+encodeURIComponent(id)+'/elevation');
        if(destroyed || !el.isConnected || st.vid!==vid)return;
        if(d.samples<2)throw Error('no_elevation');
        const metres=v=>nf(U.imperial?v*3.28084:v,0)+' '+(U.imperial?'ft':'m');
        el.innerHTML=`<div class="tsl-grid tsl-elevation-summary">${tile(t('tsl_elev_ascent'),'↗ '+esc(metres(d.ascent_m)))}${tile(t('tsl_elev_descent'),'↘ '+esc(metres(d.descent_m)))}${tile(t('tsl_elev_min'),esc(metres(d.min_m)))}${tile(t('tsl_elev_max'),esc(metres(d.max_m)))}</div><div data-elevation-chart></div>${d.partial?`<p class="tsl-note">${esc(t('tsl_elev_partial'))}</p>`:''}`;
        const segments=[];let segment=[];for(const [km,m] of d.points){if(m==null){if(segment.length)segments.push({color:'var(--tsl-success,#34d399)',data:segment});segment=[];}else segment.push([U.dist(km),U.imperial?m*3.28084:m]);}if(segment.length)segments.push({color:'var(--tsl-success,#34d399)',data:segment});
        V.chart(el.querySelector('[data-elevation-chart]'),{type:'line',segmented:true,series:segments,height:190,xFmt:v=>nf(v,1)+' '+U.distU(),yFmt:v=>nf(v,0),tipFmt:v=>nf(v,0)+' '+(U.imperial?'ft':'m'),yMin:Math.floor((U.imperial?d.min_m*3.28084:d.min_m)-5)});
      } catch(e) {
        if(destroyed || !el.isConnected)return;
        el.innerHTML=`<div class="tsl-empty">${esc(t('tsl_elev_unavailable'))}</div><button type="button" class="tsl-btn">${esc(t('tsl_elev_retry'))}</button>`;
        el.querySelector('button').onclick=()=>{el.innerHTML=`<div class="tsl-empty">${esc(t('tsl_loading'))}</div>`;mountElevation(p,saved);};
      }
    }
    function mountAnalysis(p,a,saved) {
      mountElevation(p,saved);
      const firstPosition=(a.playback||[]).find(q=>Number.isFinite(q[1])&&Number.isFinite(q[2]));
      const replayMap=mountPageMap(p.querySelector('#tsl-report-map'),[],{routes:a.routes.map(r=>r.points),markers:a.markers,color:speedColor,marker:!a.routes.length&&firstPosition?[firstPosition[1],firstPosition[2]]:null});
      mountReplay(p,a,replayMap);
      const mm=p.querySelector('.tsl-map');if(mm)mm.classList.add('tall');
      const chart=(id,series,yFmt,yMin)=>{
        series=series.filter(s=>s.data.length);const el=p.querySelector(id);
        if(!series.length){el.innerHTML=`<div class="tsl-empty">${esc(t('tsl_j_no_readings'))}</div>`;return;}
        V.chart(el,{type:'line',series,height:180,xFmt:(x,full)=>full?journeyDate(x):a.end-a.start>86400?fmt.date(x):fmt.time(x),yFmt,tipFmt:yFmt,yMin});
      };
      chart('#tsl-report-battery',[{color:'var(--tsl-success,#34d399)',data:a.series.filter(x=>x[1]!=null).map(x=>[x[0],x[1]])}],v=>nf(v)+'%',0);
      chart('#tsl-report-temp',[{label:t('tsl_inside'),color:'var(--tsl-blue,#60a5fa)',data:a.series.filter(x=>x[2]!=null).map(x=>[x[0],U.temp(x[2])])},{label:t('tsl_outside'),color:'var(--tsl-orange,#fb923c)',data:a.series.filter(x=>x[3]!=null).map(x=>[x[0],U.temp(x[3])])}],v=>nf(v,1)+'°',undefined);
      let count=40;
      const drawEvents=()=>{
        const el=p.querySelector('#tsl-report-events');el.innerHTML=a.events.slice(0,count).map(e=>{
          const r=e.kind==='trip'?a.trips.find(x=>x.id===e.id):e.kind==='charge'?a.charges.find(x=>x.id===e.id):null;
          const title=e.kind==='trip'?`${place(r.start_place,r.start_addr)} → ${place(r.end_place,r.end_addr)}`:e.kind==='charge'?place(r.place,r.addr):t(e.state==='unknown'?'tsl_j_unknown':'tsl_st_'+e.state);
          const values=e.kind==='trip'?`${r.distance_km==null?'–':fmt.dist(r.distance_km)} · ${r.energy_kwh==null?'–':fmt.kwh(r.energy_kwh)}`:e.kind==='charge'?`${r.kwh==null?'–':fmt.kwh(r.kwh)} · ${r.max_power==null?'–':fmt.kw(r.max_power)}${r.cost_totals&&r.cost_totals.length?' · '+costMoney(r):r.cost!=null?' · '+money(r.cost):''}`:'';
          return `<${r?'button':'div'} class="tsl-history-event ${e.kind}" ${r?`data-event="${e.kind}:${e.id}"`:''}><span class="tsl-history-icon">${e.kind==='trip'?'➤':e.kind==='charge'?'ϟ':STATE_ICON[e.state]||'…'}</span><div><b>${esc(title)}</b><small>${esc(journeyDate(e.start))} → ${esc(journeyDate(e.end))} · ${esc(reportDur(e.end-e.start))}${e.partial?' · '+esc(t('tsl_j_partial_short')):''}</small>${values?`<p>${esc(values)}</p>`:''}</div>${r?'<span aria-hidden="true">↗</span>':''}</${r?'button':'div'}>`;
        }).join('')||`<div class="tsl-empty">${esc(t('tsl_j_no_readings'))}</div>`;
        if(count<a.events.length){const b=document.createElement('button');b.className='tsl-btn';b.textContent=t('tsl_more');b.onclick=()=>{count+=40;drawEvents();};el.appendChild(b);}
        el.querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>{const [kind,id]=b.dataset.event.split(':');if(saved)st.returnJourney=st.journey.journey.id;openDetail(kind,+id);});
      };drawEvents();
    }

    // ── Charges ───────────────────────────────────────────────────────────
    function chargeRow(r) {
      const metric = (key, value) => `<span><b>${esc(value)}</b><small>${esc(t(key))}</small></span>`;
      const start = r.start_batt == null ? null : Math.max(0, Math.min(100, r.start_batt));
      const end = r.end_batt == null ? null : Math.max(0, Math.min(100, r.end_batt));
      const cost = (r.cost_totals && r.cost_totals.length ? (r.cost_complete ? '' : '≥ ') : '') + (r.pricing_estimated ? '≈ ' : '') + costMoney(r);
      return `<button type="button" class="tsl-drive-card tsl-charge-card ${r.dc ? 'dc' : ''}" data-open="charge:${r.id}">
        <div class="tsl-drive-meta"><time datetime="${new Date(r.start_ts * 1000).toISOString()}">${esc(fmt.date(r.start_ts))}<b>${esc(fmt.time(r.start_ts))}</b></time><span class="tsl-drive-duration">${esc(fmt.dur((r.end_ts || r.start_ts) - r.start_ts))}</span></div>
        <div class="tsl-charge-location"><span class="tsl-session-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13 2 5 14h6l-1 8 9-13h-7z"/></svg></span><strong>${esc(place(r.place, r.addr))}</strong><span class="tsl-badge ${r.dc ? 'dc' : ''}">${esc(t(r.dc ? 'tsl_chg_dc' : 'tsl_chg_ac'))}</span></div>
        <div class="tsl-drive-metrics">${metric('tsl_chg_added',r.kwh == null ? '–' : '+' + fmt.kwh(r.kwh))}${metric('tsl_chg_peak',r.max_power == null ? '–' : fmt.kw(r.max_power))}${metric('tsl_chg_cost',cost)}</div>
        ${start != null && end != null ? `<div class="tsl-drive-battery"><span>${esc(t('tsl_trip_batt'))}</span><div class="tsl-drive-battery-track" aria-hidden="true"><i style="width:${end}%"></i><i class="before" style="width:${start}%"></i></div><span>${esc(nf(start))}% → ${esc(nf(end))}%</span></div>` : ''}
      </button>`;
    }
    async function renderCharges(p) {
      if (st.detail) return renderChargeDetail(p);
      if(st.chargeTab==='places')return renderChargePlaces(p);
      if(st.chargeTab==='tariffs')return renderTariffs(p);
      if(st.chargeTab==='costs')return renderCosts(p);
      if (!st.charges.length) {
        p.innerHTML = `<div class="tsl-center">${esc(t('tsl_loading'))}</div>`;
        try { const d = await api('/v/' + st.vid + '/charges?limit=40'); st.charges = d.charges; st.chargesTotal = d.total; }
        catch (e) { p.innerHTML = `<div class="tsl-card tsl-center">${esc(t('tsl_error'))}</div>`; return; }
      }
      if (destroyed || st.tab !== 'charges' || st.detail) return;
      drawCharges(p);
    }
    function drawCharges(p) {
      if (!st.charges.length) { p.innerHTML = `<div class="tsl-card tsl-center">${esc(t('tsl_chg_none'))}</div>`; return; }
      p.innerHTML = `<div class="tsl-drive-list">${st.charges.map(r => chargeRow(r)).join('')}</div>
        ${st.charges.length < st.chargesTotal ? `<div class="tsl-btns" style="justify-content:center"><button class="tsl-btn" id="tsl-more">${esc(t('tsl_more'))}</button></div>` : ''}`;
      p.querySelectorAll('[data-open]').forEach(r => r.addEventListener('click', () => openDetail('charge', +r.dataset.open.split(':')[1])));
      const more = p.querySelector('#tsl-more');
      if (more) more.addEventListener('click', async () => {
        const d = await api('/v/' + st.vid + '/charges?limit=40&offset=' + st.charges.length); st.charges = st.charges.concat(d.charges); drawCharges(p);
      });
    }
    function renderChargeDetail(p) {
      const d = st.detail, dur = (d.end_ts || d.start_ts) - d.start_ts;
      const avg = dur > 60 ? d.kwh / (dur / 3600) : 0;
      p.innerHTML = `${backBtn()}<div class="tsl-card"><h3>${esc(fmt.dateTime(d.start_ts))}</h3>
        <div style="font-size:1.15rem;font-weight:700">${esc(place(d.place, d.addr))}<span class="tsl-badge ${d.dc ? 'dc' : ''}">${esc(t(d.dc ? 'tsl_chg_dc' : 'tsl_chg_ac'))}</span></div>
        ${d.lat != null ? '<div id="tsl-cmap" style="margin-top:12px"></div>' : ''}</div>
        <div class="tsl-card"><div class="tsl-grid">
        ${tile(t('tsl_chg_added'), '+' + fmt.kwh(d.kwh), `${d.start_batt??'–'}% → ${d.end_batt??'–'}%`)}${tile(t('tsl_chg_duration'), fmt.dur(dur))}
        ${tile(t('tsl_chg_avg'), fmt.kw(avg))}${tile(t('tsl_chg_peak'), fmt.kw(d.max_power || 0))}
        ${tile(t('tsl_chg_cost'),esc(costMoney(d)))}</div>
        ${!d.place_id && d.lat != null ? `<div class="tsl-btns"><button class="tsl-btn" id="tsl-saveplace">${esc(t('tsl_chg_save_place'))}</button></div>` : ''}</div>
        ${costDetailMarkup(d)}
        <div class="tsl-card"><h3>${esc(t('tsl_chg_curve'))}</h3><div id="tsl-c1"></div></div>
        <div class="tsl-card"><h3>${esc(t('tsl_chg_level'))}</h3><div id="tsl-c2"></div></div>`;
      hookBack(p);
      if (d.lat != null) { maps.push(V.tileMap(p.querySelector('#tsl-cmap'), [], { marker: [d.lat, d.lng] })); setTimeout(() => maps[0] && maps[0].redraw(), 50); }
      const pts = d.points;
      V.chart(p.querySelector('#tsl-c1'), { type: 'line', series: [{ color: 'var(--tsl-green,#4ade80)', data: pts.map(x => [x[0], x[1] || 0]) }], xFmt: x => fmt.time(x), yFmt: v => nf(v), tipFmt: v => nf(v) + ' ' + t('tsl_u_kw'), height: 180 });
      V.chart(p.querySelector('#tsl-c2'), { type: 'line', series: [{ color: 'var(--tsl-blue,#60a5fa)', data: pts.map(x => [x[0], x[2] || 0]) }], xFmt: x => fmt.time(x), yFmt: v => nf(v) + '%', tipFmt: v => nf(v) + '%', yMin: 0, yMax: 100, height: 180 });
      p.querySelector('#tsl-edit-charge-cost').onclick=()=>chargeCostDialog(d);
      const sp = p.querySelector('#tsl-saveplace');
      if (sp) sp.addEventListener('click', () => placeDialog({ name: '', lat: d.lat, lng: d.lng, radius: 100 }, () => { st.charges = []; st.trips = []; st.detail = null; frame(); render(); }));
    }

    // Charging accounts: places, validity records, and retrospective corrections.
    let billingDialog=null,billingCleanup=null,costControls=[];
    const costMoney = d => d.cost_totals&&d.cost_totals.length ? d.cost_totals.map(x=>money(x.cost,x.currency)).join(' · ') : d.cost!=null?money(d.cost,d.cost_currency):'–';
    const currencyOptions = selected => [...new Set([selected,currency,...(Intl.supportedValuesOf?Intl.supportedValuesOf('currency'):['EUR','USD','GBP','BGN','RON','CHF','CAD','JPY','CNY'])].filter(Boolean))].map(c=>`<option value="${esc(c)}" ${c===selected?'selected':''}>${esc(c)}</option>`).join('');
    const datePlus = (date,n) => {const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
    function closeBillingDialog(){if(billingDialog){billingDialog.close();billingDialog.remove();billingDialog=null;}if(billingCleanup){billingCleanup();billingCleanup=null;}}
    function billingModal(title,html,save){
      closeBillingDialog();const opener=document.activeElement,d=document.createElement('dialog');billingDialog=d;d.className='tsl-tire-dialog tsl-journey-dialog tsl-billing-dialog';
      d.innerHTML=`<form><header><h2>${esc(title)}</h2></header>${html}<p role="alert" class="tsl-journey-error"></p><div class="tsl-btns"><button type="button" class="tsl-btn" data-cancel>${esc(t('tsl_cancel'))}</button><button type="submit" class="tsl-btn pri">${esc(t('tsl_save'))}</button></div></form>`;
      scroller.appendChild(d);d.querySelector('[data-cancel]').onclick=()=>d.close();
      d.addEventListener('close',()=>{if(billingDialog===d){billingDialog=null;if(billingCleanup){billingCleanup();billingCleanup=null;}}d.remove();if(opener&&opener.isConnected)opener.focus();},{once:true});
      d.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=d.querySelector('[type=submit]');b.disabled=true;d.querySelector('[role=alert]').textContent='';try{await save(d);d.close();}catch(err){b.disabled=false;d.querySelector('[role=alert]').textContent=t(['overlapping_tariffs','invalid_tariff','invalid_price','invalid_period'].includes(err.message)?'tsl_bill_'+err.message:'tsl_error');}};
      d.showModal();return d;
    }
    async function billingDelete(path,title,done){
      const d=billingModal(t('tsl_delete'),`<p>${esc(title)}</p><p class="tsl-note">${esc(t('tsl_bill_delete_hint'))}</p>`,async()=>{await api(path,{method:'DELETE'});await done();});d.querySelector('[type=submit]').textContent=t('tsl_delete');
    }
    function billingRefresh(){st.charges=[];st.journey=null;st.detail=null;frame();render();}
    async function renderChargePlaces(p){
      const vid=st.vid,seq=++seqLoad;p.innerHTML=`<div class="tsl-center">${esc(t('tsl_loading'))}</div>`;
      try{const d=await api('/places');if(destroyed||seq!==seqLoad||vid!==st.vid)return;
        p.innerHTML=`<div class="tsl-head"><button class="tsl-btn pri" id="tsl-place-new">＋ ${esc(t('tsl_set_add_place'))}</button></div><p class="tsl-note">${esc(t('tsl_bill_places_hint'))}</p><div class="tsl-journey-list">${d.places.map(pl=>`<div class="tsl-card"><h2>${esc(pl.name)}</h2><p class="tsl-sub">${nf(pl.radius)} m · ${nf(pl.lat,5)}, ${nf(pl.lng,5)}</p><div class="tsl-btns"><button class="tsl-btn" data-place-edit="${esc(pl.id)}">${esc(t('tsl_edit'))}</button><button class="tsl-btn" data-place-tariff="${esc(pl.id)}">${esc(t('tsl_bill_new_tariff'))}</button></div></div>`).join('')||`<div class="tsl-card tsl-center">${esc(t('tsl_set_none_places'))}</div>`}</div>`;
        p.querySelector('#tsl-place-new').onclick=()=>placeDialog({},billingRefresh);
        p.querySelectorAll('[data-place-edit]').forEach(b=>b.onclick=()=>placeDialog(d.places.find(x=>x.id===b.dataset.placeEdit),billingRefresh));
        p.querySelectorAll('[data-place-tariff]').forEach(b=>b.onclick=()=>tariffDialog({place_id:b.dataset.placeTariff},billingRefresh));
      }catch(e){if(seq===seqLoad)p.innerHTML=`<div class="tsl-card tsl-center">${esc(t('tsl_error'))}</div>`;}
    }
    async function placeDialog(pl,done){
      if (!canManage()) return;
      pl={name:'',radius:100,...pl};if(pl.lat==null){try{const d=st.now||await api('/v/'+st.vid+'/now');pl.lat=d.sample&&d.sample.lat;pl.lng=d.sample&&d.sample.lng;}catch(e){}}pl.lat=pl.lat==null?42.6977:pl.lat;pl.lng=pl.lng==null?23.3219:pl.lng;
      let map=null;
      const d=billingModal(t('tsl_set_add_place'),`<label>${esc(t('tsl_set_place_name'))}<input name="place_name" required maxlength="80" value="${esc(pl.name)}"></label><p class="tsl-note">${esc(t('tsl_bill_map_hint'))}</p><div id="tsl-place-map"></div><div class="tsl-billing-columns"><label>${esc(t('tsl_bill_lat'))}<input name="lat" type="number" step="any" min="-85" max="85" required value="${pl.lat}"></label><label>${esc(t('tsl_bill_lng'))}<input name="lng" type="number" step="any" min="-180" max="180" required value="${pl.lng}"></label><label>${esc(t('tsl_set_place_radius'))}<input name="radius" type="number" min="30" max="5000" required value="${pl.radius}"></label></div>${pl.id?`<button type="button" class="tsl-btn" data-remove-place>${esc(t('tsl_delete'))}</button>`:''}`,async()=>{
        const f=d.querySelector('form').elements;await api(pl.id?'/places/'+pl.id:'/places',{method:pl.id?'PUT':'POST',body:JSON.stringify({name:f.place_name.value,lat:+f.lat.value,lng:+f.lng.value,radius:+f.radius.value,ac_price:pl.ac_price??null,dc_price:pl.dc_price??null})});done();});
      const draw=()=>{if(map)map.destroy();const f=d.querySelector('form').elements;map=V.tileMap(d.querySelector('#tsl-place-map'),[],{circle:{lat:+f.lat.value,lng:+f.lng.value,radius:+f.radius.value},onPick:pos=>{f.lat.value=pos.lat.toFixed(6);f.lng.value=pos.lng.toFixed(6);draw();}});};
      draw();billingCleanup=()=>{if(map)map.destroy();};d.querySelectorAll('[name=lat],[name=lng],[name=radius]').forEach(el=>el.onchange=()=>{if(el.checkValidity())draw();});
      const del=d.querySelector('[data-remove-place]');if(del)del.onclick=()=>billingDelete('/places/'+pl.id,pl.name,done);
    }
    const tariffDate = (ts, timeZone) => {const picker=window.mvmOS.dateTimePicker;return picker.format(picker.fromEpoch(ts,{type:'date',timeZone}),{type:'date'});};
    const monthDay = md => String(Math.floor(md/100)).padStart(2,'0')+'-'+String(md%100).padStart(2,'0');
    const seasonDate = md => window.mvmOS.dateTimePicker.formatAnnual(monthDay(md),{monthNames:true});
    async function renderTariffs(p){
      const seq=++seqLoad;p.innerHTML=`<div class="tsl-center">${esc(t('tsl_loading'))}</div>`;
      try{await window.mvmOS.dateTimePicker.ready();const [d,pl]=await Promise.all([api('/tariffs'),api('/places')]);if(destroyed||seq!==seqLoad)return;
        p.innerHTML=`<div class="tsl-head"><button class="tsl-btn pri" id="tsl-tariff-new">＋ ${esc(t('tsl_bill_new_tariff'))}</button></div><p class="tsl-note">${esc(t('tsl_bill_tariff_hint'))}</p><div class="tsl-journey-list">${d.tariffs.map(r=>`<div class="tsl-card"><h2>${esc(r.name)}</h2><p>${esc((pl.places.find(x=>x.id===r.place_id)||{}).name||'')}</p><p class="tsl-sub">${esc(tariffDate(r.start_ts,r.timezone))} → ${esc(tariffDate(r.end_ts-1,r.timezone))} · ${esc(r.currency)} · ${esc(r.timezone)}</p><div class="tsl-bill-bands">${r.rules.map(rule=>`<span><b>${esc(rule.name)}</b> ${esc(window.mvmOS.dateTimePicker.format(rule.from,{type:'time'}))}–${esc(window.mvmOS.dateTimePicker.format(rule.to,{type:'time'}))} · ${esc(unitPrice(rule.price,r.currency))}/kWh <small>· ${esc(t('tsl_bill_yearly'))} ${esc(seasonDate(rule.season_from||101))}–${esc(seasonDate(rule.season_to||1231))}</small></span>`).join('')}</div><div class="tsl-btns"><button class="tsl-btn" data-tariff-edit="${esc(r.id)}">${esc(t('tsl_edit'))}</button><button class="tsl-btn" data-tariff-report="${esc(r.id)}">${esc(t('tsl_bill_report'))}</button><button class="tsl-btn" data-tariff-delete="${esc(r.id)}">${esc(t('tsl_delete'))}</button></div></div>`).join('')||`<div class="tsl-card tsl-center">${esc(t('tsl_bill_no_tariffs'))}</div>`}</div>        <div class="tsl-card" id="tsl-default-prices"><h3>${esc(t('tsl_set_prices'))}</h3><p class="tsl-note">${esc(t('tsl_bill_defaults_hint'))}</p>
        <div class="tsl-field"><label for="tsl-pac">${esc(t('tsl_set_price_ac'))} (${esc(currency)})</label><input ${canManage() ? '' : 'disabled'} min="0" id="tsl-pac" type="number" step="0.001" value="${(pl.prefs || {}).default_ac_price != null ? (pl.prefs || {}).default_ac_price : ''}"></div>
        <div class="tsl-field"><label for="tsl-pdc">${esc(t('tsl_set_price_dc'))} (${esc(currency)})</label><input ${canManage() ? '' : 'disabled'} min="0" id="tsl-pdc" type="number" step="0.001" value="${(pl.prefs || {}).default_dc_price != null ? (pl.prefs || {}).default_dc_price : ''}"></div>
        ${canManage() ? `<div class="tsl-btns"><button class="tsl-btn pri" id="tsl-saveprices">${esc(t('tsl_save'))}</button></div>` : ''}</div>
`;
        const savePrices=p.querySelector('#tsl-saveprices');
        if(savePrices)savePrices.addEventListener('click',async()=>{
          const fields=[p.querySelector('#tsl-pac'),p.querySelector('#tsl-pdc')];
          if(!fields.every(field=>field.reportValidity()))return;
          const values=fields.map(field=>field.value.trim()===''?null:Number(field.value));
          savePrices.disabled=true;
          try{await api('/prefs',{method:'PUT',body:JSON.stringify({default_ac_price:values[0],default_dc_price:values[1]})});st.charges=[];toast(t('tsl_saved'));}
          catch(e){toast(t('tsl_error'));}
          finally{if(savePrices.isConnected)savePrices.disabled=false;}
        });
        p.querySelector('#tsl-tariff-new').onclick=()=>pl.places.length?tariffDialog({},billingRefresh):placeDialog({},()=>renderTariffs(p));
        p.querySelectorAll('[data-tariff-edit]').forEach(b=>b.onclick=()=>tariffDialog(d.tariffs.find(x=>x.id===b.dataset.tariffEdit),billingRefresh));
        p.querySelectorAll('[data-tariff-delete]').forEach(b=>b.onclick=()=>billingDelete('/tariffs/'+b.dataset.tariffDelete,d.tariffs.find(x=>x.id===b.dataset.tariffDelete).name,billingRefresh));
        p.querySelectorAll('[data-tariff-report]').forEach(b=>b.onclick=()=>{const r=d.tariffs.find(x=>x.id===b.dataset.tariffReport);st.costFilters={start:r.start_ts,end:r.end_ts,place_id:r.place_id,kind:r.kind};st.chargeTab='costs';frame();render();});
      }catch(e){if(seq===seqLoad)p.innerHTML=`<div class="tsl-card tsl-center">${esc(t('tsl_error'))}</div>`;}
    }
    async function tariffDialog(plan,done){
      if (!canManage()) return;
      const picker=window.mvmOS.dateTimePicker;await picker.ready();const data=await api('/places');if(!data.places.length){placeDialog({},done);return;}
      const zone=plan.timezone||picker.settings({}).timeZone, dateOpts={type:'date',timeZone:zone};
      const nowDate=picker.fromEpoch(Date.now()/1000,dateOpts),year=nowDate.slice(0,4);
      let rules=plan.rules?JSON.parse(JSON.stringify(plan.rules)):[{name:t('tsl_bill_flat'),from:'00:00',to:'00:00',days:[0,1,2,3,4,5,6],price:null,season_from:101,season_to:1231}],rulePickers=[];
      const d=billingModal(t(plan.id?'tsl_edit':'tsl_bill_new_tariff'),`<div class="tsl-billing-columns"><label>${esc(t('tsl_bill_name'))}<input name="tariff_name" required maxlength="120" value="${esc(plan.name||'')}"></label><label>${esc(t('tsl_bill_place'))}<select name="place_id">${data.places.map(pl=>`<option value="${esc(pl.id)}" ${pl.id===plan.place_id?'selected':''}>${esc(pl.name)}</option>`).join('')}</select></label></div><div class="tsl-billing-columns"><label>${esc(t('tsl_bill_validity'))}<div data-plan-range></div></label><label>${esc(t('tsl_bill_currency'))}<select name="currency">${currencyOptions(plan.currency||currency)}</select></label><label>${esc(t('tsl_bill_zone'))}<input name="timezone" required value="${esc(zone)}"></label><label>${esc(t('tsl_bill_kind'))}<select name="kind">${['all','ac','dc'].map(k=>`<option value="${k}" ${(plan.kind||'all')===k?'selected':''}>${esc(k==='all'?t('tsl_bill_all'):k.toUpperCase())}</option>`).join('')}</select></label></div><details class="tsl-note"><summary>${esc(t('tsl_bill_how'))}</summary><p>${esc(t('tsl_bill_rules_hint'))}</p></details><div data-rules></div><button type="button" class="tsl-btn" data-add-rule>＋ ${esc(t('tsl_bill_add_band'))}</button>`,async()=>{
        collect();const f=d.querySelector('form').elements, tz=f.timezone.value.trim();
        if(!validityPicker.validate())throw Error('invalid_period');
        const period=validityPicker.value,start=picker.toEpoch(period.from,{type:'date',timeZone:tz}),end=picker.toEpoch(datePlus(period.to,1),{type:'date',timeZone:tz});
        if(start==null||end==null||start>=end)throw Error('invalid_period');
        await api('/tariffs'+(plan.id?'/'+plan.id:''),{method:plan.id?'PUT':'POST',body:JSON.stringify({name:f.tariff_name.value,place_id:f.place_id.value,start_ts:start,end_ts:end,currency:f.currency.value,timezone:tz,kind:f.kind.value,rules})});done();});
      const validityPicker=picker.createRange(d.querySelector('[data-plan-range]'),{required:true,label:t('tsl_bill_validity'),timeZone:zone,value:{from:plan.start_ts?picker.fromEpoch(plan.start_ts,dateOpts):year+'-01-01',to:plan.end_ts?picker.fromEpoch(plan.end_ts-1,dateOpts):year+'-12-31'}});
      const weekdayNames=Array.from({length:7},(_,i)=>new Intl.DateTimeFormat(window.mvmOS.lang||'en',{weekday:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2024,0,1+i))));
      function collect(){d.querySelectorAll('[data-band]').forEach((el,i)=>{
        const r=rules[i],fields=rulePickers[i],season=fields.season.value;
        if(!fields.season.validate())throw Error('invalid_tariff');
        r.name=el.querySelector('[data-name]').value;r.price=el.querySelector('[data-price]').value===''?null:+el.querySelector('[data-price]').value;
        r.days=[...el.querySelectorAll('[data-day]:checked')].map(x=>+x.dataset.day);r.from=fields.from.value;r.to=fields.to.value;
        r.season_from=+season.from.replace('-','');r.season_to=+season.to.replace('-','');
      });}
      function draw(){rulePickers.forEach(fields=>Object.values(fields).forEach(p=>p.destroy()));rulePickers=[];d.querySelector('[data-rules]').innerHTML=rules.map((r,i)=>`<section class="tsl-bill-rule" data-band="${i}"><div class="tsl-billing-columns"><label>${esc(t('tsl_bill_name'))}<input data-name required maxlength="80" value="${esc(r.name)}"></label><label>${esc(t('tsl_bill_unit_price'))}<input data-price type="number" step="any" min="0" max="100000" required value="${r.price??''}"></label><label>${esc(t('tsl_j_from'))}<div data-band-from></div></label><label>${esc(t('tsl_j_to'))}<div data-band-to></div></label></div><div class="tsl-bill-daysrow"><div class="tsl-bill-days">${weekdayNames.map((name,day)=>`<label><input type="checkbox" data-day="${day}" ${r.days.includes(day)?'checked':''}>${esc(name)}</label>`).join('')}</div><label class="tsl-bill-season-field">${esc(t('tsl_bill_season'))}<div data-band-season></div></label></div><button type="button" class="tsl-btn" data-remove-band="${i}">${esc(t('tsl_delete'))}</button></section>`).join('');
        d.querySelectorAll('[data-band]').forEach((el,i)=>{
          const fields={};for(const k of ['from','to'])fields[k]=picker.create(el.querySelector('[data-band-'+k+']'),{type:'time',required:true,value:rules[i][k],label:t(k==='from'?'tsl_j_from':'tsl_j_to')});
          fields.season=picker.createRange(el.querySelector('[data-band-season]'),{annual:true,monthNames:true,required:true,timeZone:zone,label:t('tsl_bill_season'),value:{from:monthDay(rules[i].season_from||101),to:monthDay(rules[i].season_to||1231)}});
          rulePickers.push(fields);
        });
        d.querySelectorAll('[data-remove-band]').forEach(b=>b.onclick=()=>{collect();rules.splice(+b.dataset.removeBand,1);draw();});}
      d.querySelector('[data-add-rule]').onclick=()=>{collect();rules.push({name:'',from:'00:00',to:'00:00',days:[0,1,2,3,4,5,6],price:null,season_from:101,season_to:1231});draw();};
      billingCleanup=()=>{validityPicker.destroy();rulePickers.forEach(fields=>Object.values(fields).forEach(p=>p.destroy()));};draw();
    }
    async function chargeCostDialog(ch){
      if (!canManage()) return;
      const pl=await api('/places'),manual=ch.manual_cost||{};
      const d=billingModal(t('tsl_bill_edit_cost'),`<p>${esc(fmt.dateTime(ch.start_ts))} · ${esc(fmt.kwh(ch.kwh))}</p><label>${esc(t('tsl_bill_cost_mode'))}<select name="mode"><option value="auto">${esc(t('tsl_bill_auto'))}</option><option value="unit" ${manual.unit_price!=null?'selected':''}>${esc(t('tsl_bill_unit_price'))}</option><option value="total" ${manual.total_cost!=null?'selected':''}>${esc(t('tsl_bill_total'))}</option></select></label><div class="tsl-billing-columns"><label>${esc(t('tsl_bill_amount'))}<input name="amount" type="number" step="any" min="0" value="${manual.total_cost??manual.unit_price??''}"></label><label>${esc(t('tsl_bill_currency'))}<select name="currency">${currencyOptions(manual.currency||ch.cost_currency||currency)}</select></label></div><label>${esc(t('tsl_bill_place'))}<select name="place_id"><option value="">${esc(t('tsl_bill_auto_place'))}</option>${pl.places.map(p=>`<option value="${esc(p.id)}" ${p.id===manual.place_id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><p class="tsl-note">${esc(t('tsl_bill_override_hint'))}</p>`,async()=>{const f=d.querySelector('form').elements,mode=f.mode.value;if(mode!=='auto'&&(f.amount.value===''||!Number.isFinite(+f.amount.value)))throw Error('invalid_price');await api('/v/'+st.vid+'/charges/'+ch.id+'/cost',{method:'PUT',body:JSON.stringify({currency:f.currency.value,unit_price:mode==='unit'?+f.amount.value:null,total_cost:mode==='total'?+f.amount.value:null,place_id:f.place_id.value||null})});st.charges=[];await openDetail('charge',ch.id);});
      const update=()=>{const f=d.querySelector('form').elements;f.amount.disabled=f.mode.value==='auto';f.amount.required=f.mode.value!=='auto';};d.querySelector('[name=mode]').onchange=update;update();
    }
    function costDetailMarkup(ch){return `<div class="tsl-card"><div class="tsl-head"><h2>${esc(t('tsl_chg_cost'))}</h2><button class="tsl-btn" id="tsl-edit-charge-cost">${esc(t('tsl_bill_edit_cost'))}</button></div><div class="tsl-bill-total">${esc(costMoney(ch))}</div>${!ch.cost_complete?`<p class="tsl-note">${esc(t('tsl_bill_unpriced'))}: ${ch.unpriced_kwh==null?'–':esc(fmt.kwh(ch.unpriced_kwh))}</p>`:''}${ch.pricing_estimated?`<p class="tsl-note">≈ ${esc(t('tsl_bill_estimate_hint'))}</p>`:''}<div class="tsl-bill-breakdown">${(ch.cost_breakdown||[]).map(b=>`<div><span>${esc(b.name||t('tsl_bill_source_'+b.source))}<small>${b.kwh==null?'':esc(fmt.kwh(b.kwh))}${b.price!=null?' · '+esc(unitPrice(b.price,b.currency))+'/kWh':''}</small></span><b>${esc(money(b.cost,b.currency))}</b></div>`).join('')}</div><p class="tsl-note">${esc(t('tsl_bill_basis_hint'))}</p></div>`;}
    async function renderCosts(p){
      const picker=window.mvmOS.dateTimePicker;await picker.ready();const vid=st.vid,seq=++seqLoad;
      let places;try{places=(await api('/places')).places;}catch(e){p.innerHTML=`<div class="tsl-card tsl-center">${esc(t('tsl_error'))}</div>`;return;}if(destroyed||seq!==seqLoad)return;
      const date=picker.fromEpoch(Date.now()/1000,{type:'date'}),filter=st.costFilters||{};
      p.innerHTML=`<div class="tsl-card"><div class="tsl-billing-columns"><label>${esc(t('tsl_j_from'))}<div data-cost-start></div></label><label>${esc(t('tsl_j_to'))}<div data-cost-end></div></label><label>${esc(t('tsl_bill_place'))}<select id="tsl-cost-place"><option value="">${esc(t('tsl_bill_all_places'))}</option>${places.map(pl=>`<option value="${esc(pl.id)}" ${filter.place_id===pl.id?'selected':''}>${esc(pl.name)}</option>`).join('')}</select></label><label>${esc(t('tsl_bill_kind'))}<select id="tsl-cost-kind">${['all','ac','dc'].map(k=>`<option value="${k}" ${(filter.kind||'all')===k?'selected':''}>${esc(k==='all'?t('tsl_bill_all'):k.toUpperCase())}</option>`).join('')}</select></label></div><div class="tsl-btns"><button class="tsl-btn pri" id="tsl-cost-load">${esc(t('tsl_bill_report'))}</button></div></div><div id="tsl-cost-results"></div>`;
      const start=picker.create(p.querySelector('[data-cost-start]'),{type:'date',required:true,value:filter.start?picker.fromEpoch(filter.start,{type:'date'}):date.slice(0,8)+'01',label:t('tsl_j_from')}),end=picker.create(p.querySelector('[data-cost-end]'),{type:'date',required:true,value:filter.end?picker.fromEpoch(filter.end-1,{type:'date'}):date,label:t('tsl_j_to')});costControls=[start,end];
      let loadSeq=0;
      async function load(){const n=++loadSeq,from=picker.toEpoch(start.value,{type:'date'}),until=picker.toEpoch(datePlus(end.value,1),{type:'date'}),place=p.querySelector('#tsl-cost-place').value,kind=p.querySelector('#tsl-cost-kind').value,button=p.querySelector('#tsl-cost-load'),box=p.querySelector('#tsl-cost-results');if(from==null||until==null||from>=until){toast(t('tsl_bill_invalid_period'));return;}button.disabled=true;st.costFilters={start:from,end:until,place_id:place,kind};
        try{const d=await api('/v/'+vid+'/costs?start='+from+'&end='+until+(place?'&place_id='+encodeURIComponent(place):'')+'&kind='+kind);if(destroyed||seq!==seqLoad||n!==loadSeq)return;const s=d.summary;
          box.innerHTML=`<div class="tsl-card tsl-report-summary"><div class="tsl-grid">${tile(t('tsl_bill_total'),esc(s.currencies.map(c=>money(c.cost,c.currency)).join(' · ')||'–'))}${tile(t('tsl_stats_charged'),esc(fmt.kwh(s.kwh)))}${tile(t('tsl_tab_charges'),esc(nf(s.sessions)))}${tile(t('tsl_bill_unpriced'),esc(nf(s.unpriced_sessions)),esc(fmt.kwh(s.unpriced_kwh)))}</div><p class="tsl-note">${esc(t('tsl_bill_report_hint'))}${s.estimated_sessions?' · ≈ '+esc(nf(s.estimated_sessions))+' '+esc(t('tsl_bill_estimated')):''}</p></div><div class="tsl-card"><h3>${esc(t('tsl_bill_by_place'))}</h3>${s.places.map(pl=>`<div class="tsl-bill-place-total"><div><b>${esc(pl.name||t('tsl_unknown_place'))}</b><small>${esc(fmt.kwh(pl.kwh))} · ${nf(pl.sessions)} ${esc(t('tsl_tab_charges'))}${pl.unpriced_sessions?' · '+nf(pl.unpriced_sessions)+' '+esc(t('tsl_bill_unpriced')):''}</small></div><b>${esc(pl.currencies.map(c=>money(c.cost,c.currency)).join(' · ')||'–')}</b></div>`).join('')||`<p class="tsl-note">${esc(t('tsl_chg_none'))}</p>`}</div><div class="tsl-drive-list">${d.charges.map(ch=>chargeRow(ch)).join('')}</div>`;
          box.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{openDetail('charge',+b.dataset.open.split(':')[1]);});
        }catch(e){if(n===loadSeq)box.innerHTML=`<div class="tsl-card tsl-center">${esc(t('tsl_error'))}</div>`;}finally{if(button.isConnected)button.disabled=false;}}
      p.querySelector('#tsl-cost-load').onclick=load;load();
    }

    // ── States: what the car was doing, from when until when ──────────────
    async function renderStates(p, more) {
      if (!more) { st.states = []; p.innerHTML = `<div class="tsl-center">${esc(t('tsl_loading'))}</div>`; }
      let d, tl;
      try {
        [d, tl] = await Promise.all([
          api('/v/' + st.vid + '/states?hours=' + st.sHours + '&limit=100&offset=' + st.states.length),
          more ? Promise.resolve(null) : api('/v/' + st.vid + '/timeline?hours=' + st.sHours)]);
      } catch (e) { p.innerHTML = `<div class="tsl-card tsl-center">${esc(t('tsl_error'))}</div>`; return; }
      if (destroyed || st.tab !== 'states') return;
      st.states = st.states.concat(d.states); st.statesTotal = d.total;
      if (tl) st.statesTl = tl;
      const totalSeconds = Object.values(d.totals).reduce((sum, n) => sum + n, 0) || 1;
      const tot = d.totals, order = ['driving', 'charging', 'online', 'asleep', 'offline'].filter(k => tot[k]);
      const row = r => {
        const dur = (r.end || d.now) - r.start;
        const col = V.STATE_COL[r.state] || '#64748b';
        const day = x => window.mvmOS.dateTimePicker.fromEpoch(x,{type:'date'});
        const sameDay = r.end && day(r.end) === day(r.start);
        return `<div class="tsl-state-event" style="--event-color:${col}"><span class="tsl-event-icon" aria-hidden="true">${STATE_ICON[r.state] || '…'}</span>
          <div class="tsl-event-body"><div class="tsl-event-heading"><b>${esc(t('tsl_st_' + r.state))}</b><strong>${esc(fmt.dur(dur))}</strong></div>
          ${r.place ? `<div class="tsl-event-place">${esc(r.place)}</div>` : ''}<small>${esc(fmt.dateTime(r.start))} – ${r.end ? esc(sameDay ? fmt.time(r.end) : fmt.dateTime(r.end)) : esc(t('tsl_states_now'))}</small>
          ${r.batt_start != null && r.batt_end != null ? `<span class="tsl-event-battery">${esc(t('tsl_trip_batt'))} <b>${esc(nf(r.batt_start))}% → ${esc(nf(r.batt_end))}%</b></span>` : ''}</div></div>`;
      };
      p.innerHTML = `<div class="tsl-head"><div class="tsl-seg">${[[24, 'tsl_states_day'], [168, 'tsl_stats_week'], [720, 'tsl_stats_month']].map(x =>
        `<button data-h="${x[0]}" class="${st.sHours === x[0] ? 'on' : ''}">${esc(t(x[1]))}</button>`).join('')}</div></div>
        <div class="tsl-card"><h3>${esc(t('tsl_states_totals'))}</h3>${V.strip(st.statesTl)}
        <div class="tsl-grid" style="margin-top:12px">${order.map(k => `<div class="tsl-tile"><span><i class="tsl-dot" style="background:${V.STATE_COL[k]}"></i> ${esc(t('tsl_st_' + k))}</span><b>${esc(fmt.dur(tot[k]))}</b><div class="tsl-state-share" aria-hidden="true"><i style="width:${Math.min(100,tot[k]/totalSeconds*100)}%;background:${V.STATE_COL[k]}"></i></div></div>`).join('')}</div></div>
        <div class="tsl-event-list">${st.states.length ? st.states.map(row).join('') : `<div class="tsl-empty">${esc(t('tsl_states_none'))}</div>`}
        ${st.states.length < st.statesTotal ? `<div class="tsl-btns" style="justify-content:center"><button class="tsl-btn" id="tsl-more">${esc(t('tsl_more'))}</button></div>` : ''}</div>`;
      p.querySelectorAll('[data-h]').forEach(b => b.addEventListener('click', () => { st.sHours = +b.dataset.h; renderStates(p); }));
      const mb = p.querySelector('#tsl-more'); if (mb) mb.addEventListener('click', () => renderStates(p, true));
    }

    // ── Statistics ────────────────────────────────────────────────────────
    async function renderStats(p) {
      const per = { week: { days: 7, group: 'day' }, month: { days: 30, group: 'day' }, year: { days: 365, group: 'month' } }[st.period];
      p.innerHTML = `<div class="tsl-center">${esc(t('tsl_loading'))}</div>`;
      let d;
      try { d = await api('/v/' + st.vid + '/stats?group=' + per.group + '&days=' + per.days); }
      catch (e) { p.innerHTML = `<div class="tsl-card tsl-center">${esc(t('tsl_error'))}</div>`; return; }
      if (destroyed || st.tab !== 'stats') return;
      const rows = d.rows;
      const sum = k => rows.reduce((a, r) => a + (r[k] || 0), 0);
      const km = sum('km'), kwh = sum('drive_kwh'), cost = sum('cost'), pricedKwh = sum('priced_kwh');
      const costTotals={};for(const row of rows)for(const [code,value] of Object.entries(row.cost_totals||{}))costTotals[code]=(costTotals[code]||0)+value;
      const codes=Object.keys(costTotals),costText=codes.map(c=>money(costTotals[c],c)).join(' · ');
      const label = (key, full) => {
        return window.mvmOS.dateTimePicker.format(key.length === 7 ? key + '-01' : key,{type:'date'});
      };
      const series = (k, conv) => rows.map((r, i) => [i, conv ? conv(r[k]) : r[k]]);
      const xf = i => rows[Math.round(i)] ? label(rows[Math.round(i)].key, true) : '';
      p.innerHTML = `<div class="tsl-head"><div class="tsl-seg">${['week', 'month', 'year'].map(k => `<button data-per="${k}" class="${st.period === k ? 'on' : ''}">${esc(t('tsl_stats_' + k))}</button>`).join('')}</div></div>
        <div class="tsl-card"><div class="tsl-grid">
        ${tile(t('tsl_stats_total_km'), fmt.dist(km, 0), nf(sum('trips')) + ' ' + esc(t('tsl_tab_trips').toLowerCase()))}
        ${tile(t('tsl_stats_avg'), km > 5 && kwh > 0 ? fmt.eff(kwh * 1000 / km) : '–')}
        ${tile(t('tsl_stats_charged'), fmt.kwh(sum('charged_kwh')))}
        ${tile(t('tsl_stats_cost'), costText||'–')}
        ${tile(t('tsl_stats_cost100', { u: U.distU() }), codes.length===1&&km>5&&pricedKwh>0&&!sum('unpriced_sessions') ? money(costTotals[codes[0]] / sum('charged_kwh') * (kwh / km) * 100 * (U.imperial ? 1.609344 : 1),codes[0]) : '–')}</div></div>
        <div class="tsl-card"><h3>${esc(t('tsl_stats_distance'))} (${esc(U.distU())})</h3><div id="tsl-s1"></div></div>
        <div class="tsl-two"><div class="tsl-card"><h3>${esc(t('tsl_stats_energy'))} (${esc(t('tsl_u_kwh'))})</h3><div id="tsl-s2"></div></div>
        <div class="tsl-card"><h3>${esc(t('tsl_stats_charged'))} (${esc(t('tsl_u_kwh'))})</h3><div id="tsl-s3"></div></div></div>
        <div class="tsl-card"><h3>${esc(t('tsl_stats_cost'))}</h3><div id="tsl-s4"></div></div>
        <div class="tsl-card"><h3>${esc(t('tsl_stats_temp'))}</h3><div id="tsl-s5"></div></div>`;
      p.querySelectorAll('[data-per]').forEach(b => b.addEventListener('click', () => { st.period = b.dataset.per; renderStats(p); }));
      V.chart(p.querySelector('#tsl-s1'), { type: 'bars', series: [{ color: 'var(--tsl-blue,#60a5fa)', data: series('km', U.dist) }], xFmt: xf, yFmt: v => nf(v), tipFmt: v => nf(v, 1) + ' ' + U.distU(), height: 190 });
      V.chart(p.querySelector('#tsl-s2'), { type: 'bars', series: [{ color: 'var(--tsl-amber,#f59e0b)', data: series('drive_kwh') }], xFmt: xf, yFmt: v => nf(v), tipFmt: v => nf(v, 1) + ' ' + t('tsl_u_kwh'), height: 170 });
      V.chart(p.querySelector('#tsl-s3'), { type: 'bars', series: [{ color: 'var(--tsl-green,#4ade80)', data: series('charged_kwh') }], xFmt: xf, yFmt: v => nf(v), tipFmt: v => nf(v, 1) + ' ' + t('tsl_u_kwh'), height: 170 });
      V.chart(p.querySelector('#tsl-s4'), { type: 'bars', series: codes.map((code,i)=>({label:code,color:['var(--tsl-purple,#a78bfa)','var(--tsl-success,#34d399)','var(--tsl-blue,#60a5fa)'][i%3],data:rows.map((r,n)=>[n,(r.cost_totals||{})[code]||0])})), xFmt: xf, yFmt: v => nf(v), tipFmt:(v,series)=>money(v,series.label), height: 170 });
      V.chart(p.querySelector('#tsl-s5'), { type: 'dots', series: [{ color: 'var(--tsl-pink,#f472b6)', data: d.efficiency.map(e => [U.temp(e.t), U.eff(e.wh_km)]) }], xFmt: x => nf(x) + U.tempU(), yFmt: v => nf(v), tipFmt: v => nf(v) + ' ' + U.effU(), yMin: 0, height: 190 });
    }

    // ── Battery and sleep ─────────────────────────────────────────────────
    async function renderBattery(p) {
      p.innerHTML = `<div class="tsl-center">${esc(t('tsl_loading'))}</div>`;
      let d;
      try { d = await api('/v/' + st.vid + '/battery'); }
      catch (e) { p.innerHTML = `<div class="tsl-card tsl-center">${esc(t('tsl_error'))}</div>`; return; }
      if (destroyed || st.tab !== 'battery') return;
      const s = d.series, last = s.length ? s[s.length - 1].full_km : null, first = s.length ? s[0].full_km : null;
      const dr = d.drain, hrs = dr.reduce((a, x) => a + x.hours, 0), lost = dr.reduce((a, x) => a + x.lost_pct, 0);
      const perDay = hrs >= 12 ? lost / hrs * 24 : null;
      const tot = d.sleep.reduce((a, x) => a + x.asleep, 0), all = d.sleep.reduce((a, x) => a + x.asleep + x.online + x.driving + x.charging + x.offline, 0);
      p.innerHTML = `<div class="tsl-card"><h3>${esc(t('tsl_bat_full'))}</h3><div class="tsl-grid">
        ${tile(t('tsl_bat_now'), last != null ? fmt.dist(last, 0) : '–')}
        ${tile(t('tsl_bat_change'), last != null && first ? (last >= first ? '+' : '') + nf((last - first) / first * 100, 1) + '%' : '–')}
        ${tile(t('tsl_bat_drain_avg'), perDay != null ? nf(perDay, 1) + '% ' + esc(t('tsl_bat_per_day')) : '–')}
        ${tile(t('tsl_st_asleep'), all ? nf(tot / all * 100) + '%' : '–')}</div>
        <div id="tsl-b1" style="margin-top:12px"></div><div class="tsl-note">${esc(t('tsl_bat_note'))}</div></div>
        <div class="tsl-card"><h3>${esc(t('tsl_bat_sleep'))}</h3><div id="tsl-b2"></div><div class="tsl-note">${esc(t('tsl_bat_sleep_note'))}</div></div>
        <div class="tsl-card"><h3>${esc(t('tsl_bat_drain'))}</h3>${dr.length ? `<div class="tsl-drain-list">` + dr.slice().reverse().slice(0, 12).map(x => `<div class="tsl-drain-entry"><div class="tsl-drive-meta"><b>${esc(fmt.date(x.start))}</b><span class="tsl-drive-duration">☾ ${esc(fmt.dur(x.hours * 3600))}</span></div><div class="tsl-drain-values"><strong>−${esc(nf(x.lost_pct,1))}%</strong><span>−${esc(fmt.dist(x.lost_km, 1))}</span></div><div class="tsl-state-share" aria-hidden="true"><i style="width:${Math.min(100,Math.max(0,x.lost_pct))}%;background:#fb923c"></i></div></div>`).join('') + '</div>' : `<div class="tsl-empty">${esc(t('tsl_bat_drain_none'))}</div>`}</div>`;
      V.chart(p.querySelector('#tsl-b1'), { type: 'line', series: [{ color: 'var(--tsl-blue,#60a5fa)', data: s.map((x, i) => [i, U.dist(x.full_km)]) }], xFmt: i => s[Math.round(i)] ? window.mvmOS.dateTimePicker.format(s[Math.round(i)].day,{type:'date'}) : '', yFmt: v => nf(v), tipFmt: v => nf(v, 0) + ' ' + U.distU(), yMin: s.length ? Math.floor(Math.min.apply(null, s.map(x => U.dist(x.full_km))) * 0.97) : 0, height: 190, empty: t('tsl_bat_drain_none') });
      const days = d.sleep, pct = k => days.map((x, i) => { const sum = x.asleep + x.online + x.driving + x.charging + x.offline || 1; return [i, x[k] / sum * 100]; });
      V.chart(p.querySelector('#tsl-b2'), { type: 'stack', yMax: 100, series: [
        { label: t('tsl_st_asleep'), color: V.STATE_COL.asleep, data: pct('asleep') }, { label: t('tsl_st_online'), color: V.STATE_COL.online, data: pct('online') },
        { label: t('tsl_st_charging'), color: V.STATE_COL.charging, data: pct('charging') }, { label: t('tsl_st_driving'), color: V.STATE_COL.driving, data: pct('driving') }],
        xFmt: i => days[Math.round(i)] ? window.mvmOS.dateTimePicker.format(days[Math.round(i)].day,{type:'date'}) : '', yFmt: v => nf(v) + '%', tipFmt: v => nf(v) + '%', height: 190 });
    }

    // ── Settings ──────────────────────────────────────────────────────────
    async function renderSharing(p) {
      if (!isOwner()) return;
      p.innerHTML=`<div class="tsl-card">${esc(t('tsl_loading'))}</div>`;
      try {
        const data=await api('/shares');
        if (destroyed || st.tab!=='sharing') return;
        const roles=selected=>['view','admin'].map(role=>`<option value="${role}" ${selected===role?'selected':''}>${esc(t('tsl_share_'+role))}</option>`).join('');
        p.innerHTML=`<div class="tsl-card"><h2>${esc(t('tsl_tab_sharing'))}</h2><p class="tsl-note">${esc(t('tsl_share_hint'))}</p><p class="tsl-note">${esc(t('tsl_share_roles'))}</p>
          <form class="tsl-share-form"><div class="tsl-billing-columns"><label>${esc(t('tsl_share_person'))}<select name="person" required><option value="">${esc(t('tsl_share_choose'))}</option>${data.people.filter(u=>!data.shares.some(s=>s.user_id===u.id)).map(u=>`<option value="${esc(u.id)}">${esc(u.display_name||u.username)}</option>`).join('')}</select></label><label>${esc(t('tsl_share_role'))}<select name="role">${roles('view')}</select></label></div><button class="tsl-btn pri" type="submit">${esc(t('tsl_share_add'))}</button></form>
          <p class="tsl-note">${esc(t('tsl_share_favourites'))}</p><p role="status" aria-live="polite" data-share-result></p>
          <div>${data.shares.map(row=>`<div class="tsl-share-row"><div><b>${esc(row.display_name||row.username||row.user_id)}</b>${row.username?`<small> @${esc(row.username)}</small>`:''}</div><select data-share-role="${esc(row.user_id)}" aria-label="${esc(t('tsl_share_role')+' · '+(row.display_name||row.username||row.user_id))}">${roles(row.role)}</select><button class="tsl-btn bad" data-unshare="${esc(row.user_id)}">${esc(t('tsl_share_remove'))}</button></div>`).join('')||`<p class="tsl-note">${esc(t('tsl_share_empty'))}</p>`}</div></div>`;
        const result=p.querySelector('[data-share-result]');
        async function change(path,method,body) {
          try { await api(path,{method,...(body?{body:JSON.stringify(body)}:{})}); await renderSharing(p); }
          catch(e) {result.textContent=t(e.message==='invalid_share'?'tsl_share_invalid':'tsl_error');}
        }
        const form=p.querySelector('form');
        form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;await change('/shares','PUT',{user_id:form.elements.person.value,role:form.elements.role.value});button.disabled=false;};
        p.querySelectorAll('[data-share-role]').forEach(select=>select.onchange=async()=>{select.disabled=true;await change('/shares','PUT',{user_id:select.dataset.shareRole,role:select.value});select.disabled=false;});
        p.querySelectorAll('[data-unshare]').forEach(button=>button.onclick=async()=>{button.disabled=true;await change('/shares/'+encodeURIComponent(button.dataset.unshare),'DELETE');button.disabled=false;});
      } catch(e) {p.innerHTML=`<div class="tsl-card">${esc(t('tsl_error'))}</div>`;}
    }

    async function renderSettings(p) {
      try { st.status = await api('/status'); } catch (e) { /* keep what we have */ }
      if (destroyed || st.tab !== 'settings') return;
      const s = st.status, u = s.usage;
      const setup = s.setup || {}, origin = setup.origin || location.origin, redirect = setup.callback || origin + '/pub/tesla/callback';
      const setupAddress = (id, label, value) => `<div class="tsl-setup-address"><label id="${id}-label">${esc(label)}</label><div class="tsl-setup-copy"><div class="tsl-code" id="${id}" aria-labelledby="${id}-label">${esc(value)}</div><button type="button" class="tsl-btn" data-copy-address="${id}" aria-label="${esc(t('tsl_setup_copy') + ' · ' + label)}">${esc(t('tsl_setup_copy'))}</button></div></div>`;
      const connState = s.reauth ? t('tsl_set_reauth') : s.connected ? t('tsl_set_connected') : t('tsl_set_not_connected');
      p.innerHTML = `<div class="tsl-card" data-owner-only><h3>${esc(t('tsl_set_connection'))}</h3>
        <div style="font-size:1.15rem;font-weight:700">${esc(connState)}</div>
        <div class="tsl-note">${esc(s.last_ok ? t('tsl_set_last_ok', { t: fmt.ago(s.last_ok, s.now) }) : t('tsl_set_never'))}${s.error ? ' · ' + esc(s.error) : ''}</div>
        ${!setup.server_ready ? `<p class="tsl-note">${esc(t('tsl_setup_server_required'))}</p>` : ''}${s.connected && !setup.ready ? `<p class="tsl-note">${esc(t('tsl_setup_legacy'))}</p>` : ''}
        <details class="tsl-setup" ${s.connected && !s.reauth ? '' : 'open'}><summary>${esc(t('tsl_setup_title'))}</summary>
          ${location.protocol !== 'https:' ? `<p class="tsl-setup-warning" role="note">${esc(t('tsl_setup_https'))}</p>` : ''}
          <ol><li>${esc(t('tsl_setup_account'))} <code>Authorization Code + Client Credentials (Machine-to-Machine)</code> <a href="https://developer.tesla.com/" target="_blank" rel="noopener noreferrer">${esc(t('tsl_setup_developer'))} ↗</a></li>
          <li>${esc(t('tsl_setup_addresses'))}${setupAddress('tsl-setup-origin', t('tsl_setup_origin'), origin)}${setupAddress('tsl-setup-callback', t('tsl_set_redirect'), redirect)}<p>${esc(t('tsl_setup_permissions'))}</p></li>
          <li>${esc(t('tsl_setup_credentials'))}</li><li>${esc(t('tsl_setup_register'))} <a href="https://developer.tesla.com/docs" target="_blank" rel="noopener noreferrer">${esc(t('tsl_setup_docs'))} ↗</a></li>
          <li>${esc(t('tsl_setup_finish'))}</li></ol>
        </details>
        <div class="tsl-btns">${s.connected && !s.reauth && s.configured && setup.ready ? `<button class="tsl-btn pri" id="tsl-connect">${esc(s.connected || s.reauth ? t('tsl_set_reconnect') : t('tsl_set_connect'))}</button>` : ''}
        ${s.connected || s.reauth ? `<button class="tsl-btn bad" id="tsl-disc">${esc(t('tsl_set_disconnect'))}</button>` : ''}</div></div>
        <details class="tsl-card" data-owner-only ${s.connected && !s.reauth ? '' : 'open'}><summary>${esc(t('tsl_setup_credentials_title'))}</summary><p class="tsl-note">${esc(t('tsl_setup_credentials_hint'))}</p>
        ${setup.can_configure ? `<form id="tsl-credentials"><div class="tsl-billing-columns">
          <label>${esc(t('tsl_setup_client_id'))}<input name="client_id" required maxlength="256" autocomplete="off" value="${esc(setup.client_id || '')}"></label>
          <label>${esc(t('tsl_setup_client_secret'))}<input name="client_secret" type="password" maxlength="2048" autocomplete="new-password" ${setup.has_secret ? '' : 'required'}></label>
          <label>${esc(t('tsl_setup_region'))}<select name="region">${['eu','na','cn'].map(value=>`<option value="${value}" ${setup.region===value?'selected':''}>${esc(t('tsl_setup_region_'+value))}</option>`).join('')}</select></label>
          <label>${esc(t('tsl_setup_budget'))}<input name="budget" type="number" min="0" max="10000" step="0.01" required value="${esc(setup.budget ?? 10)}"></label></div>
          ${setup.has_secret ? `<p class="tsl-note">${esc(t('tsl_setup_secret_hint'))}</p>` : ''}
          <div class="tsl-setup-feedback" role="status" aria-live="polite" aria-atomic="true" tabindex="-1" id="tsl-setup-result" hidden></div>
          <div class="tsl-btns"><button class="tsl-btn ${s.connected && !s.reauth ? '' : 'pri'}" type="submit" ${setup.server_ready ? '' : 'disabled'}>${esc(t(s.connected && !s.reauth ? 'tsl_setup_save' : 'tsl_set_connect'))}</button></div></form>` : `<p class="tsl-note">${esc(t(setup.server_ready?'tsl_setup_owner_only':'tsl_setup_server_required'))}</p>`}</details>
        <div class="tsl-card" data-owner-only><h3>${esc(t('tsl_set_usage'))}</h3>
        <div style="font-size:1.15rem;font-weight:700">${esc(nf(u.calls))}</div>
        <div class="tsl-note">${esc(t('tsl_set_usage_note'))}</div></div>
        <div class="tsl-card"><h3>${esc(t('tsl_set_units'))}</h3><div class="tsl-seg"><button data-u="m" class="${U.imperial ? '' : 'on'}">${esc(t('tsl_set_metric'))}</button><button data-u="i" class="${U.imperial ? 'on' : ''}">${esc(t('tsl_set_imperial'))}</button></div></div>
        <div id="tsl-sched"></div>
        `;
      if (!isOwner()) p.querySelectorAll('[data-owner-only]').forEach(el=>el.remove());
      p.querySelectorAll('[data-copy-address]').forEach(button => button.addEventListener('click', async () => {
        const address = p.querySelector('#' + button.dataset.copyAddress);
        try {
          await navigator.clipboard.writeText(address.textContent);
          toast(t('tsl_setup_copied'));
        } catch (e) {
          const selection = window.getSelection(), range = document.createRange();
          range.selectNodeContents(address); selection.removeAllRanges(); selection.addRange(range);
          toast(t('tsl_setup_copy_failed'));
        }
      }));
      function showSetupResult(message, state = 'progress') {
        const result = p.querySelector('#tsl-setup-result');
        if (!result || !result.isConnected) return;
        result.hidden = !message;
        result.dataset.state = state;
        result.setAttribute('role', state === 'error' ? 'alert' : 'status');
        result.setAttribute('aria-live', state === 'error' ? 'assertive' : 'polite');
        result.textContent = message;
        if (message) {
          if (state === 'error') result.focus({ preventScroll: true });
          result.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }
      }
      const credentials = p.querySelector('#tsl-credentials');
      async function savePersonal(connect) {
        if (!credentials.reportValidity()) return;
        const fields = credentials.elements;
        const controls = [...credentials.querySelectorAll('button')];
        if (controls.some(b => b.dataset.busy)) return;
        controls.forEach(b => { b.dataset.busy = '1'; b.disabled = true; });
        showSetupResult(connect ? t('tsl_setup_registering') : '');
        try {
          const saved = await api('/credentials', { method: 'PUT', body: JSON.stringify({ client_id: fields.client_id.value, client_secret: fields.client_secret.value, region: fields.region.value, budget: +fields.budget.value }) });
          fields.client_secret.value = ''; fields.client_secret.required = false;
          if (connect) {
            if (!saved.ready) await api('/register', { method: 'POST' });
            const response = await api('/connect?origin=' + encodeURIComponent(location.origin));
            location.href = response.url;
          } else {
            await renderSettings(p);
            showSetupResult(t('tsl_saved'), 'success');
          }
        } catch (e) {
          const key = 'tsl_setup_' + e.message;
          showSetupResult(t(key) === key ? t('tsl_error') : t(key), 'error');
        } finally {
          controls.forEach(b => { delete b.dataset.busy; b.disabled = !setup.server_ready; });
        }
      }
      if (credentials) {
        credentials.addEventListener('submit', e => { e.preventDefault(); savePersonal(!s.connected || s.reauth); });
      }
      renderSchedule(p.querySelector('#tsl-sched'));
      const c = p.querySelector('#tsl-connect');
      if (c) c.addEventListener('click', async () => {
        try { const r = await api('/connect?origin=' + encodeURIComponent(location.origin)); location.href = r.url; }
        catch (e) { const key='tsl_setup_'+e.message; toast(t(key)===key?t('tsl_error'):t(key)); }
      });
      const dsc = p.querySelector('#tsl-disc');
      if (dsc) dsc.addEventListener('click', async () => {
        if (!confirm(t('tsl_set_disconnect_q'))) return;
        await api('/disconnect', { method: 'POST' }); st.status = await api('/status'); render();
      });
      p.querySelectorAll('[data-u]').forEach(b => b.addEventListener('click', () => { U.set(b.dataset.u === 'i'); renderSettings(p); }));

    }

    // ── The car: tires, doors, climate, charging, software, configuration ──
    const sec = (d, name) => (d && d.data && d.data[name]) || {};
    const yn = v => esc(v ? t('tsl_c_yes') : t('tsl_c_no'));
    const onoff = v => esc(v ? t('tsl_c_on') : t('tsl_c_off'));
    const present = (o, k) => o[k] !== undefined && o[k] !== null;
    const barFmt = b => b == null ? '–' : U.imperial ? nf(b * 14.5038, 1) + ' psi' : nf(b, 2) + ' bar';
    const TIRE_KEYS = [['fl', 'tsl_c_fl'], ['fr', 'tsl_c_fr'], ['rl', 'tsl_c_rl'], ['rr', 'tsl_c_rr']];
    function tireState(vs, k) {
      if (vs['tpms_hard_warning_' + k]) return 'bad';
      if (vs['tpms_soft_warning_' + k]) return 'warn';
      return '';
    }
    function tiresBrief(d) {
      const vs = sec(d, 'vehicle_state');
      const vals = TIRE_KEYS.map(k => vs['tpms_pressure_' + k[0]]).filter(x => x != null);
      if (!vals.length) return null;
      const worst = TIRE_KEYS.some(k => tireState(vs, k[0]) === 'bad') ? 'bad' : TIRE_KEYS.some(k => tireState(vs, k[0]) === 'warn') ? 'warn' : '';
      return { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals), cls: worst };
    }
    function ctile(label, val, sub, cls) {
      return tile(label, val, sub, cls);
    }
    function carCard(title, tiles, extra) {
      const body = tiles.filter(Boolean).join('');
      return body || extra ? `<div class="tsl-card"><h3>${esc(title)}</h3>${body ? `<div class="tsl-grid">${body}</div>` : ''}${extra || ''}</div>` : '';
    }
    const epoch = x => x && x > 1e9 ? esc(fmt.dateTime(x)) : '–';
    function tireDetails(d, sample, compact) {
      const vs = sec(d, 'vehicle_state');
      sample = sample || {};
      const rcpF = vs.tpms_rcp_front_value, rcpR = vs.tpms_rcp_rear_value;
      const tireBox = k => {
        const val = present(vs, 'tpms_pressure_' + k[0]) ? vs['tpms_pressure_' + k[0]] : sample['tpms_' + k[0]], stt = tireState(vs, k[0]);
        const measured = Number(vs['tpms_last_seen_pressure_time_' + k[0]]);
        return `<div class="tsl-tire ${k[0]} ${stt}"><svg class="tsl-wheel-symbol" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13"/><circle cx="16" cy="16" r="8"/><circle cx="16" cy="16" r="2"/><path d="M16 8v6m0 4v6M8 16h6m4 0h6M10 10l4 4m4 4 4 4m0-12-4 4m-4 4-4 4"/></svg><span>${esc(t(k[1]))}</span><b>${esc(barFmt(val))}</b><small class="tsl-tire-status">${val == null ? '–' : stt === 'bad' ? '!' + ' ' + esc(t('tsl_c_warn_hard')) : stt === 'warn' ? '!' + ' ' + esc(t('tsl_c_warn_soft')) : '✓ ' + esc(t('tsl_c_ok'))}</small>${Number.isFinite(measured) && measured > 0 ? `<small class="tsl-measured" title="${esc(fmt.dateTime(measured))}">${esc(t('tsl_c_measured', { t: fmt.ago(measured) }))}</small>` : ''}</div>`;
      };
      return `<div class="tsl-card"><h3>${esc(t('tsl_c_tires'))}</h3>
        <div class="tsl-tires">${tireBox(TIRE_KEYS[0])}<div class="tsl-tcar"><svg viewBox="0 0 90 170"><rect x="14" y="6" width="62" height="158" rx="26" fill="var(--pub-surface2,#252d45)" stroke="#8a93a6" stroke-width="3"/><rect x="24" y="40" width="42" height="26" rx="8" fill="#0b1020" opacity=".7"/><rect x="24" y="108" width="42" height="26" rx="8" fill="#0b1020" opacity=".7"/></svg></div>${tireBox(TIRE_KEYS[1])}${tireBox(TIRE_KEYS[2])}<div class="tsl-tgap"></div>${tireBox(TIRE_KEYS[3])}</div>
        <div class="tsl-note">${rcpF || rcpR ? esc(t('tsl_c_rcp')) + ': ' + esc(barFmt(rcpF)) + (rcpR && rcpR !== rcpF ? ' / ' + esc(barFmt(rcpR)) : '') : ''}</div>
        ${compact ? `<details class="tsl-tire-history"><summary>${esc(t('tsl_c_tires_chart'))}</summary>` : `<h3 style="margin-top:14px">${esc(t('tsl_c_tires_chart'))}</h3>`}<div data-tirechart></div><div class="tsl-tire-legend">${TIRE_KEYS.map((k, i) => `<span><i style="color:${['var(--tsl-blue,#60a5fa)', 'var(--tsl-green,#4ade80)', 'var(--tsl-warning,#fbbf24)', 'var(--tsl-pink,#f472b6)'][i]}">●</i> ${esc(t(k[1]))}</span>`).join('')}</div>${compact ? '</details>' : ''}</div>`;

    }
    function drawTireChart(el, tr) {
        const rows = (tr.rows || []).filter(r => r.slice(1, 5).some(v => v != null && Number.isFinite(v)));
        const names = ['fl', 'fr', 'rl', 'rr'], cols = ['var(--tsl-blue,#60a5fa)', 'var(--tsl-green,#4ade80)', 'var(--tsl-warning,#fbbf24)', 'var(--tsl-pink,#f472b6)'];
        const conv = x => U.imperial ? x * 14.5038 : x;
        V.chart(el, { type: 'line', area: false,
          series: names.map((n, i) => ({ label: t(TIRE_KEYS[i][1]), color: cols[i], data: rows.map((r, j) => [j, r[i + 1] != null ? conv(r[i + 1]) : null]).filter(x => x[1] != null) })).filter(series => series.data.length),
          xFmt: i => rows[Math.round(i)] ? fmt.date(rows[Math.round(i)][0]) : '', yFmt: v => nf(v, U.imperial ? 0 : 1), tipFmt: v => (U.imperial ? nf(v, 1) + ' psi' : nf(v, 2) + ' bar'),
          yMin: rows.length ? Math.floor(conv(Math.min.apply(null, rows.map(r => Math.min.apply(null, [r[1], r[2], r[3], r[4]].filter(x => x != null)))) - 0.15) * 10) / 10 : 0, height: 190 });
        const ticks = el.querySelectorAll('text[text-anchor="middle"]');
        if (ticks.length > 1) { ticks[0].setAttribute('text-anchor', 'start'); ticks[ticks.length - 1].setAttribute('text-anchor', 'end'); }
    }
    async function openTires(key) {
      if (tireDialog) return;
      const vid = st.vid, dlg = document.createElement('dialog');
      dlg.className = 'tsl-tire-dialog'; dlg.setAttribute('aria-label', t('tsl_c_tires'));
      dlg.innerHTML = `<header><h2>${esc(t('tsl_c_tires'))}</h2><button type="button" class="tsl-btn" data-close aria-label="${esc(t('tsl_back'))}">×</button></header><div data-tire-content><div class="tsl-empty">${esc(t('tsl_loading'))}</div></div>`;
      tireDialog = dlg; scroller.appendChild(dlg);
      dlg.addEventListener('close', () => {
        if (tireDialog === dlg) tireDialog = null;
        dlg.remove();
        if (!destroyed) { const b = w.querySelector(`[data-tire="${key}"]`); if (b) b.focus({ preventScroll: true }); }
      }, { once: true });
      dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
      dlg.addEventListener('click', e => { if (e.target === dlg) { const r = dlg.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close(); } });
      dlg.showModal();
      try {
        const [d, tr] = await Promise.all([api('/v/' + vid + '/car'), api('/v/' + vid + '/tires?days=60')]);
        if (destroyed || tireDialog !== dlg || !dlg.open) return;
        dlg.querySelector('[data-tire-content]').innerHTML = tireDetails(d, st.now && st.now.sample);
        drawTireChart(dlg.querySelector('[data-tirechart]'), tr);
      } catch (e) {
        if (tireDialog === dlg && dlg.open) dlg.querySelector('[data-tire-content]').innerHTML = `<div class="tsl-empty">${esc(t('tsl_error'))}</div>`;
      }
    }
    async function renderCar(p) {
      p.innerHTML = `<div class="tsl-center">${esc(t('tsl_loading'))}</div>`;
      let d, tr;
      try { [d, tr] = await Promise.all([api('/v/' + st.vid + '/car'), api('/v/' + st.vid + '/tires?days=60')]); }
      catch (e) { p.innerHTML = `<div class="tsl-card tsl-center">${esc(t('tsl_error'))}</div>`; return; }
      if (destroyed || st.tab !== 'car') return;
      if (!d.ts) { p.innerHTML = `<div class="tsl-card tsl-center">${esc(t('tsl_wait_first'))}</div>`; return; }
      const vs = sec(d, 'vehicle_state'), cs = sec(d, 'charge_state'), cl = sec(d, 'climate_state'), vc = sec(d, 'vehicle_config');
      const sw = vs.software_update || {};
      const door = (k, label) => present(vs, k) ? indicator(t(label), !vs[k], k.includes('window') ? 'window' : 'door', t('tsl_c_closed'), t('tsl_c_open'), !!vs[k]) : '';

      const tiresHtml = TIRE_KEYS.some(k => present(vs, 'tpms_pressure_' + k[0])) ? tireDetails(d, null, true) : '';

      // Doors, windows, locks
      const doors = carCard(t('tsl_c_doors'), [
        present(vs, 'locked') ? indicator(t('tsl_lock'), vs.locked, 'lock', t('tsl_locked'), t('tsl_unlocked'), !vs.locked) : '',
        door('df', 'tsl_c_door_df'), door('pf', 'tsl_c_door_pf'), door('dr', 'tsl_c_door_dr'), door('pr', 'tsl_c_door_pr'), door('ft', 'tsl_c_door_ft'), door('rt', 'tsl_c_door_rt'),
        door('fd_window', 'tsl_c_win_fd'), door('fp_window', 'tsl_c_win_fp'), door('rd_window', 'tsl_c_win_rd'), door('rp_window', 'tsl_c_win_rp'),
        present(cs, 'charge_port_door_open') ? indicator(t('tsl_c_port'), !cs.charge_port_door_open, 'bolt', t('tsl_c_closed'), t('tsl_c_open'), false, cs.charge_port_latch || '') : '',
        present(vs, 'sentry_mode') ? indicator(t('tsl_c_sentry'), vs.sentry_mode, 'shield') : '',
        present(vs, 'valet_mode') ? indicator(t('tsl_c_valet'), vs.valet_mode, 'detail') : '',
        present(vs, 'is_user_present') ? indicator(t('tsl_c_user_present'), vs.is_user_present, 'detail', t('tsl_c_yes'), t('tsl_c_no')) : '',
        present(vs, 'dashcam_state') ? ctile(t('tsl_c_dashcam'), esc(vs.dashcam_state)) : '',
        present(vs, 'remote_start') ? indicator(t('tsl_c_remote_start'), vs.remote_start, 'detail') : '',
        vs.speed_limit_mode ? indicator(t('tsl_c_speed_limit'), vs.speed_limit_mode.active, 'gauge', t('tsl_c_on'), t('tsl_c_off'), false, vs.speed_limit_mode.current_limit_mph ? fmt.speed(vs.speed_limit_mode.current_limit_mph * 1.609344) : '') : '',
        present(vs, 'service_mode') ? indicator(t('tsl_c_service'), vs.service_mode, 'detail') : '',
      ]);

      // Climate
      const temp = x => x != null ? fmt.temp(x) : '–';
      const climate = carCard(t('tsl_c_climate'), [
        present(cl, 'inside_temp') ? ctile(t('tsl_inside'), esc(temp(cl.inside_temp))) : '',
        present(cl, 'outside_temp') ? ctile(t('tsl_outside'), esc(temp(cl.outside_temp))) : '',
        present(cl, 'driver_temp_setting') ? ctile(t('tsl_c_driver_temp'), esc(temp(cl.driver_temp_setting))) : '',
        present(cl, 'passenger_temp_setting') ? ctile(t('tsl_c_pass_temp'), esc(temp(cl.passenger_temp_setting))) : '',
        present(cl, 'is_climate_on') ? indicator(t('tsl_climate_on'), cl.is_climate_on, 'detail') : '',
        present(cl, 'fan_status') ? ctile(t('tsl_c_fan'), esc(cl.fan_status)) : '',
        present(cl, 'is_front_defroster_on') ? indicator(t('tsl_c_defrost'), cl.is_front_defroster_on || cl.is_rear_defroster_on, 'heat') : '',
        present(cl, 'steering_wheel_heat_level') || present(cl, 'steering_wheel_heater') ? (cl.steering_wheel_heat_level != null ? levelMetric(t('tsl_c_steer_heat'), cl.steering_wheel_heat_level) : indicator(t('tsl_c_steer_heat'), cl.steering_wheel_heater, 'heat')) : '',
        present(cl, 'seat_heater_left') ? levelMetric(t('tsl_c_seat_l'), cl.seat_heater_left) : '',
        present(cl, 'seat_heater_right') ? levelMetric(t('tsl_c_seat_r'), cl.seat_heater_right) : '',
        present(cl, 'battery_heater') ? indicator(t('tsl_c_bat_heater'), cl.battery_heater, 'heat') : '',
        present(cl, 'is_preconditioning') ? indicator(t('tsl_c_precond'), cl.is_preconditioning, 'heat') : '',
        present(cl, 'cabin_overheat_protection') ? ctile(t('tsl_c_overheat'), esc(cl.cabin_overheat_protection)) : '',
        present(cl, 'side_mirror_heaters') ? indicator(t('tsl_c_mirrors'), cl.side_mirror_heaters, 'heat') : '',
        present(cl, 'wiper_blade_heater') ? indicator(t('tsl_c_wiper'), cl.wiper_blade_heater, 'heat') : '',
      ]);

      // Charging details
      const charging = carCard(t('tsl_c_charging'), [
        present(cs, 'charging_state') ? ctile(t('tsl_st_charging'), esc(cs.charging_state)) : '',
        present(cs, 'charge_limit_soc') ? percentMetric(t('tsl_c_limit'), cs.charge_limit_soc) : '',
        present(cs, 'conn_charge_cable') ? ctile(t('tsl_c_cable'), esc(cs.conn_charge_cable)) : '',
        present(cs, 'charger_voltage') ? ctile(t('tsl_c_voltage'), esc(nf(cs.charger_voltage)) + ' V') : '',
        present(cs, 'charger_actual_current') ? ctile(t('tsl_c_amps'), esc(nf(cs.charger_actual_current, 1)) + ' A', cs.charge_current_request ? esc(t('tsl_c_requested')) + ': ' + esc(cs.charge_current_request) + ' A' : '') : '',
        present(cs, 'charger_phases') ? ctile(t('tsl_c_phases'), esc(cs.charger_phases)) : '',
        present(cs, 'charger_pilot_current') ? ctile(t('tsl_c_pilot'), esc(cs.charger_pilot_current) + ' A') : '',
        present(cs, 'charger_power') ? ctile(t('tsl_power'), esc(fmt.kw(cs.charger_power))) : '',
        present(cs, 'charge_rate') ? ctile(t('tsl_c_rate'), esc(fmt.speed(cs.charge_rate * 1.609344))) : '',
        present(cs, 'charge_energy_added') ? ctile(t('tsl_chg_added'), esc(fmt.kwh(cs.charge_energy_added))) : '',
        present(cs, 'ideal_battery_range') ? ctile(t('tsl_c_ideal'), esc(fmt.dist(cs.ideal_battery_range * 1.609344, 0))) : '',
        present(cs, 'fast_charger_present') && cs.fast_charger_present ? ctile(t('tsl_c_fast_brand'), esc(cs.fast_charger_brand || cs.fast_charger_type || '✓')) : '',
        present(cs, 'scheduled_charging_mode') ? ctile(t('tsl_c_sched_mode'), esc(cs.scheduled_charging_mode), cs.scheduled_charging_start_time ? epoch(cs.scheduled_charging_start_time) : '') : '',
        present(cs, 'scheduled_departure_time') && cs.scheduled_departure_time > 1e9 ? ctile(t('tsl_c_departure'), epoch(cs.scheduled_departure_time)) : '',
        present(cs, 'off_peak_charging_enabled') ? indicator(t('tsl_c_offpeak'), cs.off_peak_charging_enabled, 'detail') : '',
      ]);

      // Software
      const software = carCard(t('tsl_c_software'), [
        vs.car_version ? ctile(t('tsl_c_version'), esc(String(vs.car_version).split(' ')[0])) : '',
        sw.status !== undefined ? ctile(t('tsl_c_update'), esc(sw.status || t('tsl_c_update_none')), sw.version ? esc(t('tsl_c_update_ver')) + ': ' + esc(sw.version) : '') : '',
        sw.download_perc ? percentMetric(t('tsl_c_update_dl'), sw.download_perc) : '',
        sw.install_perc ? percentMetric(t('tsl_c_update_in'), sw.install_perc) : '',
        sw.scheduled_time_ms ? ctile(t('tsl_c_update_when'), epoch(sw.scheduled_time_ms / 1000)) : '',
        vs.odometer != null ? ctile(t('tsl_odometer'), esc(fmt.dist(vs.odometer * 1.609344, 0))) : '',
      ]);

      // Configuration
      const flag = (k, label) => present(vc, k) ? indicator(t(label), !!vc[k], 'detail', t('tsl_c_yes'), t('tsl_c_no')) : '';
      const val = (k, label) => present(vc, k) && vc[k] !== '' ? ctile(t(label), esc(vc[k])) : '';
      const config = carCard(t('tsl_c_config'), [
        vs.vehicle_name ? ctile(t('tsl_c_name'), esc(vs.vehicle_name)) : '',
        val('car_type', 'tsl_c_model'), val('trim_badging', 'tsl_c_trim'), val('exterior_color', 'tsl_c_color'), val('wheel_type', 'tsl_c_wheels'),
        val('roof_color', 'tsl_c_roof'), val('interior_trim_type', 'tsl_c_interior'), val('rear_drive_unit', 'tsl_c_drive_unit'),
        flag('efficiency_package', 'tsl_c_eff_pkg') && val('efficiency_package', 'tsl_c_eff_pkg'), val('performance_package', 'tsl_c_perf_pkg'),
        flag('has_air_suspension', 'tsl_c_air_susp'), flag('third_row_seats', 'tsl_c_third_row') && val('third_row_seats', 'tsl_c_third_row'),
        flag('sun_roof_installed', 'tsl_c_sunroof') && val('sun_roof_installed', 'tsl_c_sunroof'), flag('plg', 'tsl_c_liftgate'), flag('rhd', 'tsl_c_rhd'), flag('eu_vehicle', 'tsl_c_eu'),
        val('charge_port_type', 'tsl_c_port_type'),
      ]);

      p.innerHTML = `<div class="tsl-note" style="margin:10px 4px 0">${esc(t('tsl_d_last', { t: fmt.ago(d.ts) }))}</div>${tiresHtml}${doors}${climate}${charging}${software}${config}`;
      if (tiresHtml) p.querySelector('.tsl-tire-history').addEventListener('toggle', e => {if(e.currentTarget.open)drawTireChart(p.querySelector('[data-tirechart]'),tr);});
    }

    // ── Data: every field the car reports, with its history ───────────────
    const DIST_KEYS = /^(battery_range|ideal_battery_range|est_battery_range|odometer|charge_miles_added_ideal|charge_miles_added_rated)$/;
    const SPEED_KEYS = /^(speed|charge_rate|current_limit_mph)$/;
    const TEMP_KEYS = /(^|_)(inside_temp|outside_temp|driver_temp_setting|passenger_temp_setting|max_avail_temp|min_avail_temp)$/;
    const BAR_KEYS = /^(tpms_pressure_..|tpms_rcp_(front|rear)_value)$/;
    const TIME_KEYS = /(^timestamp$|^gps_as_of$|_time$|_time_..$|_start_time$)/;
    function convField(path, v) {
      const k = path.split('.').pop();
      if (typeof v !== 'number') return { text: v === null || v === undefined ? '–' : typeof v === 'boolean' ? (v ? '✓' : '✗') : String(v), num: null };
      if (DIST_KEYS.test(k)) return { text: fmt.dist(v * 1.609344, 1), num: U.dist(v * 1.609344), unit: U.distU() };
      if (SPEED_KEYS.test(k)) return { text: fmt.speed(v * 1.609344), num: U.speed(v * 1.609344), unit: U.speedU() };
      if (TEMP_KEYS.test(k)) return { text: fmt.temp(v), num: U.temp(v), unit: U.tempU() };
      if (BAR_KEYS.test(k)) return { text: barFmt(v), num: U.imperial ? v * 14.5038 : v, unit: U.imperial ? 'psi' : 'bar' };
      if (TIME_KEYS.test(k) && (v > 1e12 ? v / 1000 : v) > 1.5e9) { const sec2 = v > 1e12 ? v / 1000 : v; return { text: fmt.dateTime(sec2), num: v, unit: '' }; }
      return { text: nf(v, Number.isInteger(v) ? 0 : 3), num: v, unit: '' };
    }
    function flatten(obj, prefix, out) {
      Object.keys(obj).forEach(k => {
        const v = obj[k], path = prefix ? prefix + '.' + k : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out);
        else out.push([path, Array.isArray(v) ? JSON.stringify(v) : v]);
      });
      return out;
    }
    async function renderData(p) {
      p.innerHTML = `<div class="tsl-center">${esc(t('tsl_loading'))}</div>`;
      let d;
      try { d = await api('/v/' + st.vid + '/car'); }
      catch (e) { p.innerHTML = `<div class="tsl-card tsl-center">${esc(t('tsl_error'))}</div>`; return; }
      if (destroyed || st.tab !== 'data') return;
      if (!d.ts) { p.innerHTML = `<div class="tsl-card tsl-center">${esc(t('tsl_d_none'))}</div>`; return; }
      const top = {}, sections = [];
      Object.keys(d.data).forEach(k => { const v = d.data[k]; if (v && typeof v === 'object' && !Array.isArray(v)) sections.push([k, v]); else top[k] = v; });
      if (Object.keys(top).length) sections.unshift(['vehicle', top]);
      const rowHtml = (sectionName, path, v) => {
        const full = sectionName === 'vehicle' ? path : sectionName + '.' + path;
        const c = convField(path, v);
        return `<div class="tsl-kv" data-path="${esc(full)}" data-search="${esc(full.toLowerCase())}"><code>${esc(path)}</code><span>${esc(c.text)}</span></div>`;
      };
      p.innerHTML = `<div class="tsl-card"><h3>${esc(t('tsl_d_title'))}</h3>
        <div class="tsl-note" style="margin:0 0 10px">${esc(t('tsl_d_note'))} ${esc(t('tsl_d_last', { t: fmt.ago(d.ts) }))} · ${esc(t('tsl_d_readings', { n: nf(d.readings) }))}</div>
        <div class="tsl-field" style="margin:0"><input id="tsl-dsearch" type="search" placeholder="${esc(t('tsl_d_search'))}"></div></div>
        ${sections.map(([name, obj]) => { const rows = flatten(obj, '', []); return `<details class="tsl-card tsl-sec" open><summary><b>${esc(name)}</b> <small>${rows.length}</small></summary>${rows.map(r => rowHtml(name, r[0], r[1])).join('')}</details>`; }).join('')}`;
      const search = p.querySelector('#tsl-dsearch');
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        p.querySelectorAll('.tsl-kv').forEach(r => { r.style.display = !q || r.dataset.search.includes(q) ? '' : 'none'; });
        p.querySelectorAll('details.tsl-sec').forEach(s => { s.style.display = !q || Array.from(s.querySelectorAll('.tsl-kv')).some(r => r.style.display !== 'none') ? '' : 'none'; if (q) s.open = true; });
      });
      p.querySelectorAll('.tsl-kv').forEach(r => r.addEventListener('click', () => historyDialog(r.dataset.path)));
    }
    function historyDialog(path) {
      const dlg = document.createElement('div'); dlg.className = 'tsl-dlg';
      let hours = 168;
      dlg.innerHTML = `<div style="max-width:640px"><div style="display:flex;gap:10px;align-items:center"><h3 style="margin:0;flex:1;font-family:monospace;word-break:break-all">${esc(path)}</h3><button class="tsl-btn" id="hd-x">✕</button></div>
        <div class="tsl-seg" style="margin:12px 0">${[[24, 'tsl_states_day'], [168, 'tsl_stats_week'], [720, 'tsl_stats_month']].map(x => `<button data-h="${x[0]}" class="${x[0] === hours ? 'on' : ''}">${esc(t(x[1]))}</button>`).join('')}</div><div id="hd-chart"></div></div>`;
      scroller.appendChild(dlg);
      const close = () => dlg.remove();
      dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
      dlg.querySelector('#hd-x').addEventListener('click', close);
      async function load() {
        const box = dlg.querySelector('#hd-chart'); box.innerHTML = `<div class="tsl-empty">${esc(t('tsl_loading'))}</div>`;
        let r;
        try { r = await api('/v/' + st.vid + '/raw/series?path=' + encodeURIComponent(path) + '&hours=' + hours); } catch (e) { box.innerHTML = `<div class="tsl-empty">${esc(t('tsl_error'))}</div>`; return; }
        const pts = r.points.map(x => [x[0], convField(path, x[1]).num]).filter(x => x[1] != null);
        if (pts.length < 2) { box.innerHTML = `<div class="tsl-empty">${esc(t('tsl_d_no_series'))}</div>`; return; }
        const unit = convField(path, r.points[0][1]).unit || '';
        V.chart(box, { type: 'line', series: [{ color: 'var(--tsl-blue,#60a5fa)', data: pts }], xFmt: (x, full) => full ? fmt.dateTime(x) : (pts[pts.length - 1][0] - pts[0][0] < 129600 ? fmt.time(x) : fmt.date(x)),
          yFmt: v => nf(v, Math.abs(v) < 10 ? 1 : 0), tipFmt: v => nf(v, 2) + (unit ? ' ' + unit : ''), height: 220, yMin: Math.min.apply(null, pts.map(x => x[1])) });
      }
      dlg.querySelectorAll('[data-h]').forEach(b => b.addEventListener('click', () => { hours = +b.dataset.h; dlg.querySelectorAll('[data-h]').forEach(x => x.classList.toggle('on', x === b)); load(); }));
      load();
    }

    // ── The check schedule ────────────────────────────────────────────────
    const SITS = ['drive', 'charge_ac', 'charge_dc', 'idle', 'parked', 'parked_check', 'asleep'];
    const UNITS = [[3600, 'tsl_sch_u_h'], [60, 'tsl_sch_u_m'], [1, 'tsl_sch_u_s']];
    function everyControl(secs, cls, allowPause) {
      const pause = allowPause && secs === 0;
      const unit = pause ? 60 : (UNITS.find(u => secs % u[0] === 0) || UNITS[2])[0];
      return `<span class="tsl-every ${cls}"><input type="number" min="1" max="999" step="1" value="${pause ? '' : secs / unit}" ${pause ? 'style="display:none"' : ''}>
        <select>${UNITS.map(u => `<option value="${u[0]}" ${u[0] === unit && !pause ? 'selected' : ''}>${esc(t(u[1]))}</option>`).join('')}${allowPause ? `<option value="0" ${pause ? 'selected' : ''}>${esc(t('tsl_sch_pause'))}</option>` : ''}</select></span>`;
    }
    function readEvery(el) {
      const unit = +el.querySelector('select').value;
      if (unit === 0) return 0;
      const n = parseFloat(el.querySelector('input').value);
      return Math.round((isNaN(n) ? 0 : n) * unit);
    }
    function ruleHit(rule, wday, minute) {
      const a = +rule.from.slice(0, 2) * 60 + +rule.from.slice(3), b = +rule.to.slice(0, 2) * 60 + +rule.to.slice(3);
      if (a === b) return rule.days.includes(wday);
      if (a < b) return rule.days.includes(wday) && minute >= a && minute < b;
      return minute >= a ? rule.days.includes(wday) : rule.days.includes((wday + 6) % 7) && minute < b;
    }
    function estimate(sit, ed, wday) {
      let total = 0;
      for (let m = 0; m < 1440; m++) {
        const rule = (ed.rules[sit] || []).find(r => ruleHit(r, wday, m));
        const every = rule ? rule.every : ed.base[sit];
        if (every > 0) total += 60 / every;
      }
      return Math.round(total);
    }
    async function renderSchedule(box) {
      let info;
      try { info = await api('/schedule'); } catch (e) { box.innerHTML = ''; return; }
      if (destroyed || !box.isConnected) return;
      let ed = JSON.parse(JSON.stringify(info.schedule));
      const lng = (window.mvmOS && window.mvmOS.lang) || 'en';
      const dayNames = [0, 1, 2, 3, 4, 5, 6].map(i => new Date(2024, 0, 1 + i).toLocaleDateString(lng, { weekday: 'short' }));
      const today = (new Date().getDay() + 6) % 7;
      function draw() {
        schedulePickers.forEach(p=>p.destroy());schedulePickers=[];
        box.innerHTML = `<div class="tsl-card"><h3>${esc(t('tsl_sch_title'))}</h3>
          <div class="tsl-note" style="margin:0 0 6px">${esc(t('tsl_sch_note', { tz: info.tz + ' ' + info.offset }))}</div>
          ${SITS.map(sit => `<div class="tsl-sit" data-sit="${sit}"><div class="tsl-sit-h"><b>${esc(t('tsl_sit_' + sit))}</b><small>${esc(t('tsl_sit_' + sit + '_d'))}</small></div>
            <div class="tsl-sit-r"><label>${esc(t('tsl_sch_default'))}</label>${everyControl(ed.base[sit], 'base', false)}</div>
            ${(ed.rules[sit] || []).map((r, i) => `<div class="tsl-rule" data-i="${i}"><div class="tsl-days">${dayNames.map((n, d) => `<button type="button" data-d="${d}" class="${r.days.includes(d) ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>
              <div class="tsl-sit-r"><span class="tsl-schedule-time" data-rule-time="from"></span> – <span class="tsl-schedule-time" data-rule-time="to"></span> ${everyControl(r.every, 'rule', true)}<button class="tsl-btn" data-del="${i}">✕</button></div></div>`).join('')}
            <div class="tsl-sit-r"><button class="tsl-btn" data-add="${sit}">+ ${esc(t('tsl_sch_add'))}</button><small>${esc(t('tsl_sch_est', { n: nf(estimate(sit, ed, today)) }))}</small></div></div>`).join('')}
          <div class="tsl-sit"><div class="tsl-sit-r"><label>${esc(t('tsl_sch_grace'))}</label><input type="number" min="0" max="120" id="sch-grace" value="${Math.round(ed.grace / 60)}" style="width:80px"></div></div>
          <div class="tsl-btns"><button class="tsl-btn pri" id="sch-save">${esc(t('tsl_sch_save'))}</button><button class="tsl-btn" id="sch-reset">${esc(t('tsl_sch_reset'))}</button></div></div>`;
        box.querySelectorAll('[data-rule-time]').forEach(host=>{
          const rule=ed.rules[host.closest('.tsl-sit').dataset.sit][+host.closest('.tsl-rule').dataset.i],key=host.dataset.ruleTime;
          const picker=window.mvmOS.dateTimePicker.create(host,{type:'time',label:t(key==='from'?'tsl_j_from':'tsl_j_to'),required:true,value:rule[key]});
          picker.input.className=key==='from'?'rf':'rt';schedulePickers.push(picker);
        });
        box.querySelectorAll('.tsl-days button').forEach(b => b.addEventListener('click', () => {
          const rule = ed.rules[b.closest('.tsl-sit').dataset.sit][+b.closest('.tsl-rule').dataset.i], d = +b.dataset.d;
          rule.days = rule.days.includes(d) ? rule.days.filter(x => x !== d) : rule.days.concat(d).sort();
          b.classList.toggle('on');
        }));
        box.querySelectorAll('select').forEach(sel => sel.addEventListener('change', () => {
          const inp = sel.parentElement.querySelector('input'); if (inp) inp.style.display = sel.value === '0' ? 'none' : '';
        }));
        box.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => { collect(); ed.rules[b.dataset.add].push({ days: [0, 1, 2, 3, 4, 5, 6], from: '23:00', to: '08:00', every: 3600 }); draw(); }));
        box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { collect(); ed.rules[b.closest('.tsl-sit').dataset.sit].splice(+b.dataset.del, 1); draw(); }));
        box.querySelector('#sch-reset').addEventListener('click', () => { ed = JSON.parse(JSON.stringify(info.defaults)); draw(); });
        box.querySelector('#sch-save').addEventListener('click', async () => {
          collect();
          try { const r = await api('/schedule', { method: 'PUT', body: JSON.stringify(ed) }); ed = r.schedule; info.schedule = r.schedule; draw(); toast(t('tsl_sch_saved')); }
          catch (e) { toast(t('tsl_sch_invalid')); }
        });
      }
      // Pull what is typed in the fields back into the model.
      function collect() {
        box.querySelectorAll('.tsl-sit[data-sit]').forEach(el => {
          const sit = el.dataset.sit;
          ed.base[sit] = readEvery(el.querySelector('.tsl-every.base'));
          el.querySelectorAll('.tsl-rule').forEach(re => {
            const r = ed.rules[sit][+re.dataset.i];
            r.from = re.querySelector('.rf').value || r.from; r.to = re.querySelector('.rt').value || r.to; r.every = readEvery(re.querySelector('.tsl-every.rule'));
          });
        });
        const g = box.querySelector('#sch-grace'); if (g) ed.grace = Math.max(0, Math.round((parseFloat(g.value) || 0) * 60));
      }
      draw();
    }

    // ── Boot ──────────────────────────────────────────────────────────────
    async function boot() {
      w.innerHTML = `<div class="tsl-center">${esc(t('tsl_loading'))}</div>`;
      try { const values=await Promise.all([api('/status'),window.mvmOS.dateTimePicker?window.mvmOS.dateTimePicker.ready():Promise.resolve()]);st.status=values[0]; }
      catch (e) {
        if (destroyed) return;
        // The access dependency returns HTTP 403 before /status can return "private".
        const message = t(e.status === 403 || e.message === 'private' ? 'tsl_private' : e.status === 404 ? 'tsl_share_unavailable' : 'tsl_error');
        w.innerHTML = `<div class="tsl-center">${esc(message)}</div>`;
        // A fresh installation has no owner yet. Only the authenticated desktop
        // may provision one; public visitors must never claim the integration.
        if (opts.desktop && opts.onSetupRequired && [403, 404].includes(e.status)) {
          try {
            const response = await fetch('/api/apps/tesla/server');
            const server = response.ok ? await response.json() : null;
            if (!destroyed && server && !server.owner_id) {
              w.innerHTML = `<div class="tsl-card"><p class="tsl-note">${esc(message)}</p><div data-server-setup></div></div>`;
              await opts.onSetupRequired(w.querySelector('[data-server-setup]'), () => { if (!destroyed) return boot(); });
            }
          } catch (_) { /* Keep the access explanation if server setup is unavailable. */ }
        }
        return;
      }
      const q = new URLSearchParams(location.search);
      if (q.get('connected')) toast(t('tsl_ok_connected'));
      if (q.get('connect_error')) toast(t('tsl_err_' + q.get('connect_error')) || t('tsl_error'));
      if (q.get('connected') || q.get('connect_error')) history.replaceState(null, '', location.pathname);
      st.vid = st.status.vehicles.length ? st.status.vehicles[0].id : null;
      st.tab = st.status.vehicles.length || st.status.connected || !canManage() ? 'now' : 'settings';
      frame(); render();
      timer = setInterval(async () => {
        if (destroyed || document.hidden) return;
        try {
          const next = await api('/status');
          if (destroyed) return;
          const changed = st.status?.access?.role !== next.access?.role;
          st.status = next;
          if (changed) { closeBillingDialog(); closeJourneyDialog(); st.tab='now'; st.detail=null; st.journey=null; clearMaps(); frame(); render(); return; }
        } catch (e) {
          if ([401,403,404].includes(e.status)) {
            ++seqLoad; clearInterval(timer); clearMaps(); closeBillingDialog(); closeJourneyDialog();
            if (statusDialog) statusDialog.close(); if (chargingDialog) chargingDialog.close(); if (tireDialog) tireDialog.close();
            pendingQuiet=null; st.status=null; st.now=null; st.carNow=null; st.trips=[]; st.charges=[]; st.journey=null; st.detail=null;
            w.innerHTML=`<div class="tsl-card tsl-center">${esc(t('tsl_share_unavailable'))}</div>`;
          }
          return;
        }
        if (st.tab === 'now' && st.vid && !st.refreshing) { const p = page(); if (p) renderNow(p, true); }
        else if(st.tab==='journeys'&&st.vid&&!journeyDialog&&!billingDialog){if(st.journey&&st.journey.journey.status!=='completed')openJourney(st.journey.journey.id,true);else if(!st.journey)renderJourneys(page(),true);}
        else if (!st.vid) { try { st.status = await api('/status'); if (st.status.vehicles.length) { st.vid = st.status.vehicles[0].id; frame(); render(); } } catch (e) { /* retry */ } }
      }, 30000);
    }
    boot();

    return {
      destroy() { themeObserver.disconnect();document.removeEventListener('load',syncTheme,true);destroyed = true;window.removeEventListener('blur',releasePointers);document.removeEventListener('visibilitychange',visibilityChanged);pendingQuiet=null;clearTimeout(quietTimer);document.removeEventListener('pointerdown',pointerDown,true);document.removeEventListener('pointerup',pointerEnd,true);document.removeEventListener('pointercancel',pointerEnd,true);scroller.removeEventListener('scroll',interacted);scroller.removeEventListener('wheel',interacted);closeBillingDialog(); closeJourneyDialog(); if (statusDialog) { statusDialog.close(); statusDialog.remove(); statusDialog = null; } if (chargingDialog) { chargingDialog.close(); chargingDialog.remove(); chargingDialog = null; } if (tireDialog) { tireDialog.close(); tireDialog.remove(); tireDialog = null; } clearInterval(timer); clearMaps(); const x = document.querySelector('.tsl-toast'); if (x) x.remove(); },
    };
  }

  window.TeslaWidget = { mount };
})();
