(function(){
  const keys=['ysql_ssh_label','ysql_ssh_none','ysql_ssh_hint'];
  const rows={
    en:['Connect through SSH','Directly (no SSH)','The host and port are those of the database as seen from the SSH server, usually localhost.'],
    bg:['Свързване през SSH','Директно (без SSH)','Хостът и портът са на базата, гледани от SSH сървъра — обикновено localhost.'],
    de:['Über SSH verbinden','Direkt (ohne SSH)','Host und Port sind die der Datenbank aus Sicht des SSH-Servers, meist localhost.'],
    es:['Conectar mediante SSH','Directo (sin SSH)','El host y el puerto son los de la base de datos vistos desde el servidor SSH, normalmente localhost.'],
    fr:['Se connecter via SSH','Directement (sans SSH)','L’hôte et le port sont ceux de la base de données vus depuis le serveur SSH, en général localhost.'],
    ja:['SSH経由で接続','直接接続（SSHなし）','ホストとポートは、SSHサーバーから見たデータベースのものです（通常はlocalhost）。'],
    'pt-BR':['Conectar via SSH','Direto (sem SSH)','O host e a porta são os do banco de dados vistos a partir do servidor SSH, normalmente localhost.'],
    ru:['Подключаться через SSH','Напрямую (без SSH)','Хост и порт — это адрес базы данных с точки зрения SSH-сервера, обычно localhost.'],
    'zh-CN':['通过SSH连接','直接连接（不使用SSH）','主机和端口是从SSH服务器看到的数据库地址，通常为localhost。']
  };
  function apply(lang){const values=rows[lang]||rows.en;const table={};keys.forEach((key,i)=>table[key]=values[i]);window._i18n=Object.assign({},window._i18n,table)}
  apply(window.mvmOS?.lang||'en');
  window.mvmOS?.onLangChange?.(apply);
})();
