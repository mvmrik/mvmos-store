var b=Array(9).fill('');var bd=document.getElementById('bd');
function draw(){bd.innerHTML='';b.forEach(function(v,i){var x=document.createElement('button');x.textContent=v;x.style.height='80px';x.dataset.i=i;x.onclick=function(){mvm.room.send({move:i})};bd.appendChild(x)})}
draw();
mvm.room.onPlayers(function(p){document.getElementById('who').textContent=p.map(function(x){return x.name}).join(' vs ')});
mvm.room.onMessage(function(m){if(m.board){b=m.board;draw()}if(m.status)document.getElementById('st').textContent=m.status});