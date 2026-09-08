(function () {
  const en = {
    sa_title:'Score Arena', sa_tagline:'Every throw. Every rival. Every result.', sa_game:'Game', sa_501:'Darts 501', sa_cricket:'Cricket', sa_bitcoin:'Bitcoin Darts',
    sa_match:'Match', sa_first_to:'First to', sa_legs:'legs', sa_rounds:'rounds', sa_order:'Starting order', sa_lobby_order:'Lobby order',
    sa_manual_first:'Choose first player', sa_random_dice:'Roll the dice', sa_first_player:'First player', sa_ready:'Ready — start when all players have joined.',
    sa_turn:'Turn', sa_remaining:'Remaining', sa_score:'Score', sa_checkout:'Checkout', sa_no_checkout:'No three-dart checkout', sa_darts:'This turn',
    sa_submit:'Save turn', sa_undo:'Undo', sa_miss:'Miss', sa_double:'Double', sa_triple:'Triple', sa_single:'Single', sa_bull:'Bull', sa_inner_bull:'Bullseye',
    sa_bust:'Bust', sa_leg_won:'Leg won', sa_round_won:'Round won', sa_wins:'Wins', sa_history:'Turn history', sa_no_throws:'No throws yet',
    sa_waiting:'Waiting for the first throw…', sa_closed:'Closed', sa_open:'Open', sa_marks:'Marks', sa_you_enter:'Enter the highlighted player’s throw.',
    sa_winner:'Match winner', sa_back:'Back to Game Hub', sa_dice_result:'Dice order', sa_need_dart:'Choose at least one dart.', sa_all_can_score:'Any player can keep score on this device.',
    sa_targets:'Targets', sa_players:'Players', sa_throw_label:'Throw', sa_bust_short:'BUST', sa_checkout_attempt:'Checkout attempt',
    sa_help:'Help', sa_ok:'OK', sa_bitcoin_block:'Block', sa_bitcoin_difficulty:'Difficulty', sa_bitcoin_reward:'Reward', sa_bitcoin_miss:'No block',
    sa_help_title_501:'How Darts 501 works', sa_help_501:'Every player starts at 501 points. Each turn, subtract what you hit from your remaining score. You must finish on a double — going below zero, hitting exactly 1, or finishing on anything but a double is a bust and your turn is undone. First to reach zero on a double wins the leg.',
    sa_help_title_cricket:'How Cricket works', sa_help_cricket:'Only 20, 19, 18, 17, 16, 15 and the bull count. Hit a number three times (singles, doubles and triples all count toward the three) to “close” it. Once you’ve closed a number, further hits score points equal to the number — but only while at least one opponent still has that number open. Whoever closes everything first while leading on points wins.',
    sa_help_title_bitcoin:'How Bitcoin Darts works', sa_help_bitcoin:'Each turn the board highlights the targets you must hit to “mine” the block — all of them, in the same three darts. Hit every highlighted target and you earn the current block reward; difficulty then goes up. Miss any of them and difficulty goes back down instead — no reward.\n\nThe reward halves every 21 blocks, just like real Bitcoin: 50 → 25 → 12.5 → 6.25 → 3.125 → 1.5625, down to a minimum. The game ends once the block reward has stayed at that minimum for a full cycle, or earlier if the leader gets so far ahead that nobody else can catch up even with every remaining block. Whoever holds the most coins at the end wins.'
  };
  const bg = {
    sa_title:'Score Arena', sa_tagline:'Всяко хвърляне. Всеки съперник. Всеки резултат.', sa_game:'Игра', sa_501:'Дартс 501', sa_cricket:'Крикет', sa_bitcoin:'Биткойн дартс',
    sa_match:'Мач', sa_first_to:'Първи до', sa_legs:'лега', sa_rounds:'рунда', sa_order:'Начален ред', sa_lobby_order:'Ред от стаята',
    sa_manual_first:'Избери първия', sa_random_dice:'Хвърляне на зарче', sa_first_player:'Първи играч', sa_ready:'Готово — стартирай, когато всички играчи са в стаята.',
    sa_turn:'Ход', sa_remaining:'Остават', sa_score:'Точки', sa_checkout:'Излизане', sa_no_checkout:'Няма излизане с три стрели', sa_darts:'Този ход',
    sa_submit:'Запази хода', sa_undo:'Назад', sa_miss:'Пропуск', sa_double:'Двойно', sa_triple:'Тройно', sa_single:'Единично', sa_bull:'Бул', sa_inner_bull:'Център',
    sa_bust:'Прегаряне', sa_leg_won:'Спечелен лег', sa_round_won:'Спечелен рунд', sa_wins:'Победи', sa_history:'История на ходовете', sa_no_throws:'Още няма хвърляния',
    sa_waiting:'Чака първото хвърляне…', sa_closed:'Затворено', sa_open:'Отворено', sa_marks:'Попадения', sa_you_enter:'Въведи хвърлянето на маркирания играч.',
    sa_winner:'Победител в мача', sa_back:'Към Game Hub', sa_dice_result:'Ред от зарчето', sa_need_dart:'Избери поне една стрела.', sa_all_can_score:'Всеки играч може да записва резултата от това устройство.',
    sa_targets:'Числа', sa_players:'Играчи', sa_throw_label:'Хвърляне', sa_bust_short:'BUST', sa_checkout_attempt:'Опит за излизане',
    sa_help:'Помощ', sa_ok:'ОК', sa_bitcoin_block:'Блок', sa_bitcoin_difficulty:'Трудност', sa_bitcoin_reward:'Награда', sa_bitcoin_miss:'Без блок',
    sa_help_title_501:'Как работи Дартс 501', sa_help_501:'Всеки играч започва със 501 точки. На всеки ход изваждаш това, което си уцелил, от оставащите точки. Трябва да завършиш на двойно — падане под нула, точно 1, или завършване на нещо различно от двойно е прегаряне и ходът се връща назад. Първият, който стигне до нула на двойно, печели лега.',
    sa_help_title_cricket:'Как работи Крикет', sa_help_cricket:'Броят се само 20, 19, 18, 17, 16, 15 и бул. Уцели число три пъти (единично, двойно и тройно се броят към трите), за да го „затвориш“. След затваряне допълнителните попадения носят точки, равни на числото — но само докато поне един противник още има това число отворено. Който затвори всичко пръв, докато води по точки, печели.',
    sa_help_title_bitcoin:'Как работи Биткойн дартс', sa_help_bitcoin:'На всеки ход мишената показва целите, които трябва да уцелиш, за да „изкопаеш“ блока — всичките, с едни и същи три стрели. Уцелиш ли всяка маркирана цел, получаваш текущата награда за блока и трудността се вдига. Пропуснеш ли дори една, трудността пада вместо това — без награда.\n\nНаградата се преполовява на всеки 21 блока, точно както при истинския Биткойн: 50 → 25 → 12.5 → 6.25 → 3.125 → 1.5625, до минимум. Играта свършва, щом наградата остане на този минимум за цял цикъл, или по-рано — ако лидерът се откъсне толкова, че никой друг не може да го настигне дори с всички оставащи блокове. Печели този с най-много монети накрая.'
  };
  const de = {
    sa_title:'Score Arena', sa_tagline:'Jeder Wurf. Jeder Rivale. Jedes Ergebnis.', sa_game:'Spiel', sa_501:'Darts 501', sa_cricket:'Cricket', sa_bitcoin:'Bitcoin Darts',
    sa_match:'Match', sa_first_to:'Zuerst bis', sa_legs:'Legs', sa_rounds:'Runden', sa_order:'Startreihenfolge', sa_lobby_order:'Reihenfolge aus der Lobby',
    sa_manual_first:'Ersten Spieler wählen', sa_random_dice:'Würfeln', sa_first_player:'Erster Spieler', sa_ready:'Bereit — starte, sobald alle Spieler beigetreten sind.',
    sa_turn:'Runde', sa_remaining:'Verbleibend', sa_score:'Punkte', sa_checkout:'Checkout', sa_no_checkout:'Kein Drei-Darts-Checkout', sa_darts:'Diese Runde',
    sa_submit:'Runde speichern', sa_undo:'Rückgängig', sa_miss:'Fehlwurf', sa_double:'Doppel', sa_triple:'Triple', sa_single:'Einzeln', sa_bull:'Bull', sa_inner_bull:'Bullseye',
    sa_bust:'Bust', sa_leg_won:'Leg gewonnen', sa_round_won:'Runde gewonnen', sa_wins:'Siege', sa_history:'Rundenverlauf', sa_no_throws:'Noch keine Würfe',
    sa_waiting:'Warte auf den ersten Wurf…', sa_closed:'Geschlossen', sa_open:'Offen', sa_marks:'Treffer', sa_you_enter:'Gib den Wurf des markierten Spielers ein.',
    sa_winner:'Matchsieger', sa_back:'Zurück zum Game Hub', sa_dice_result:'Würfelreihenfolge', sa_need_dart:'Wähle mindestens einen Dart.', sa_all_can_score:'Jeder Spieler kann auf diesem Gerät mitzählen.',
    sa_targets:'Ziele', sa_players:'Spieler', sa_throw_label:'Wurf', sa_bust_short:'BUST', sa_checkout_attempt:'Checkout-Versuch',
    sa_help:'Hilfe', sa_ok:'OK', sa_bitcoin_block:'Block', sa_bitcoin_difficulty:'Schwierigkeit', sa_bitcoin_reward:'Belohnung', sa_bitcoin_miss:'Kein Block',
    sa_help_title_501:'So funktioniert Darts 501', sa_help_501:'Jeder Spieler startet mit 501 Punkten. In jeder Runde wird das Getroffene vom verbleibenden Punktestand abgezogen. Du musst mit einem Doppel beenden — unter null fallen, genau 1 treffen oder mit etwas anderem als einem Doppel enden ist ein Bust, und die Runde wird rückgängig gemacht. Wer zuerst mit einem Doppel auf null kommt, gewinnt das Leg.',
    sa_help_title_cricket:'So funktioniert Cricket', sa_help_cricket:'Nur 20, 19, 18, 17, 16, 15 und der Bull zählen. Triff eine Zahl dreimal (Einzel, Doppel und Triple zählen alle zu den drei), um sie zu „schließen“. Nach dem Schließen bringen weitere Treffer Punkte in Höhe der Zahl — aber nur solange mindestens ein Gegner diese Zahl noch offen hat. Wer alles zuerst schließt und dabei in Punkten führt, gewinnt.',
    sa_help_title_bitcoin:'So funktioniert Bitcoin Darts', sa_help_bitcoin:'In jeder Runde markiert das Board die Ziele, die du treffen musst, um den Block zu „schürfen“ — alle davon, mit denselben drei Darts. Triffst du jedes markierte Ziel, erhältst du die aktuelle Blockbelohnung und die Schwierigkeit steigt. Verfehlst du auch nur eines, sinkt die Schwierigkeit stattdessen — keine Belohnung.\n\nDie Belohnung halbiert sich alle 21 Blöcke, genau wie beim echten Bitcoin: 50 → 25 → 12,5 → 6,25 → 3,125 → 1,5625, bis zu einem Minimum. Das Spiel endet, sobald die Blockbelohnung einen vollen Zyklus lang auf diesem Minimum geblieben ist, oder früher, falls der Anführer so weit vorne liegt, dass niemand mehr aufholen kann — selbst mit allen verbleibenden Blöcken. Wer am Ende die meisten Coins hat, gewinnt.'
  };
  const es = {
    sa_title:'Score Arena', sa_tagline:'Cada lanzamiento. Cada rival. Cada resultado.', sa_game:'Juego', sa_501:'Dardos 501', sa_cricket:'Cricket', sa_bitcoin:'Bitcoin Darts',
    sa_match:'Partida', sa_first_to:'Primero a', sa_legs:'legs', sa_rounds:'rondas', sa_order:'Orden inicial', sa_lobby_order:'Orden de la sala',
    sa_manual_first:'Elegir primer jugador', sa_random_dice:'Tirar los dados', sa_first_player:'Primer jugador', sa_ready:'Listo — empieza cuando todos los jugadores se hayan unido.',
    sa_turn:'Turno', sa_remaining:'Restante', sa_score:'Puntos', sa_checkout:'Checkout', sa_no_checkout:'Sin checkout de tres dardos', sa_darts:'Este turno',
    sa_submit:'Guardar turno', sa_undo:'Deshacer', sa_miss:'Fallo', sa_double:'Doble', sa_triple:'Triple', sa_single:'Sencillo', sa_bull:'Bull', sa_inner_bull:'Diana central',
    sa_bust:'Bust', sa_leg_won:'Leg ganado', sa_round_won:'Ronda ganada', sa_wins:'Victorias', sa_history:'Historial de turnos', sa_no_throws:'Aún no hay lanzamientos',
    sa_waiting:'Esperando el primer lanzamiento…', sa_closed:'Cerrado', sa_open:'Abierto', sa_marks:'Marcas', sa_you_enter:'Introduce el lanzamiento del jugador resaltado.',
    sa_winner:'Ganador de la partida', sa_back:'Volver a Game Hub', sa_dice_result:'Orden de los dados', sa_need_dart:'Elige al menos un dardo.', sa_all_can_score:'Cualquier jugador puede anotar desde este dispositivo.',
    sa_targets:'Objetivos', sa_players:'Jugadores', sa_throw_label:'Lanzamiento', sa_bust_short:'BUST', sa_checkout_attempt:'Intento de checkout',
    sa_help:'Ayuda', sa_ok:'Aceptar', sa_bitcoin_block:'Bloque', sa_bitcoin_difficulty:'Dificultad', sa_bitcoin_reward:'Recompensa', sa_bitcoin_miss:'Sin bloque',
    sa_help_title_501:'Cómo funciona Dardos 501', sa_help_501:'Cada jugador empieza con 501 puntos. En cada turno, se resta lo que aciertas de tu puntuación restante. Debes terminar en un doble — bajar de cero, acertar exactamente 1, o terminar en algo que no sea un doble es un bust y el turno se deshace. El primero en llegar a cero con un doble gana el leg.',
    sa_help_title_cricket:'Cómo funciona el Cricket', sa_help_cricket:'Solo cuentan el 20, 19, 18, 17, 16, 15 y el bull. Acierta un número tres veces (sencillos, dobles y triples cuentan para esas tres) para «cerrarlo». Una vez cerrado, los aciertos adicionales suman puntos iguales al número — pero solo mientras al menos un rival aún lo tenga abierto. Quien cierre todo primero yendo por delante en puntos, gana.',
    sa_help_title_bitcoin:'Cómo funciona Bitcoin Darts', sa_help_bitcoin:'En cada turno el tablero resalta los objetivos que debes acertar para «minar» el bloque — todos ellos, con los mismos tres dardos. Si aciertas cada objetivo resaltado, ganas la recompensa actual del bloque y la dificultad sube. Si fallas alguno, la dificultad baja en su lugar — sin recompensa.\n\nLa recompensa se reduce a la mitad cada 21 bloques, igual que en el Bitcoin real: 50 → 25 → 12,5 → 6,25 → 3,125 → 1,5625, hasta un mínimo. La partida termina cuando la recompensa del bloque se mantiene en ese mínimo durante un ciclo completo, o antes si el líder se adelanta tanto que nadie más puede alcanzarlo ni con todos los bloques restantes. Gana quien tenga más monedas al final.'
  };
  const fr = {
    sa_title:'Score Arena', sa_tagline:'Chaque lancer. Chaque rival. Chaque résultat.', sa_game:'Jeu', sa_501:'Fléchettes 501', sa_cricket:'Cricket', sa_bitcoin:'Bitcoin Darts',
    sa_match:'Match', sa_first_to:'Premier à', sa_legs:'manches', sa_rounds:'manches', sa_order:'Ordre de départ', sa_lobby_order:'Ordre du salon',
    sa_manual_first:'Choisir le premier joueur', sa_random_dice:'Lancer les dés', sa_first_player:'Premier joueur', sa_ready:'Prêt — démarre quand tous les joueurs ont rejoint.',
    sa_turn:'Tour', sa_remaining:'Restant', sa_score:'Score', sa_checkout:'Checkout', sa_no_checkout:'Pas de checkout en trois fléchettes', sa_darts:'Ce tour',
    sa_submit:'Valider le tour', sa_undo:'Annuler', sa_miss:'Raté', sa_double:'Double', sa_triple:'Triple', sa_single:'Simple', sa_bull:'Bull', sa_inner_bull:'Bullseye',
    sa_bust:'Bust', sa_leg_won:'Manche gagnée', sa_round_won:'Round gagné', sa_wins:'Victoires', sa_history:'Historique des tours', sa_no_throws:'Aucun lancer pour l’instant',
    sa_waiting:'En attente du premier lancer…', sa_closed:'Fermé', sa_open:'Ouvert', sa_marks:'Marques', sa_you_enter:'Saisis le lancer du joueur en surbrillance.',
    sa_winner:'Vainqueur du match', sa_back:'Retour au Game Hub', sa_dice_result:'Ordre des dés', sa_need_dart:'Choisis au moins une fléchette.', sa_all_can_score:'Chaque joueur peut marquer les points depuis cet appareil.',
    sa_targets:'Cibles', sa_players:'Joueurs', sa_throw_label:'Lancer', sa_bust_short:'BUST', sa_checkout_attempt:'Tentative de checkout',
    sa_help:'Aide', sa_ok:'OK', sa_bitcoin_block:'Bloc', sa_bitcoin_difficulty:'Difficulté', sa_bitcoin_reward:'Récompense', sa_bitcoin_miss:'Pas de bloc',
    sa_help_title_501:'Comment fonctionnent les Fléchettes 501', sa_help_501:'Chaque joueur commence avec 501 points. À chaque tour, ce qui est touché est soustrait du score restant. Il faut finir sur un double — descendre en dessous de zéro, tomber exactement sur 1, ou finir sur autre chose qu’un double est un bust et le tour est annulé. Le premier à atteindre zéro sur un double remporte la manche.',
    sa_help_title_cricket:'Comment fonctionne le Cricket', sa_help_cricket:'Seuls le 20, 19, 18, 17, 16, 15 et le bull comptent. Touche un numéro trois fois (simples, doubles et triples comptent tous pour ces trois) pour le « fermer ». Une fois fermé, les touches suivantes rapportent des points égaux au numéro — mais seulement tant qu’au moins un adversaire l’a encore ouvert. Celui qui ferme tout en premier tout en menant au score gagne.',
    sa_help_title_bitcoin:'Comment fonctionne Bitcoin Darts', sa_help_bitcoin:'À chaque tour, le plateau met en surbrillance les cibles à toucher pour « miner » le bloc — toutes, avec les trois mêmes fléchettes. Touche chaque cible en surbrillance et tu gagnes la récompense actuelle du bloc ; la difficulté augmente alors. Rate ne serait-ce qu’une seule cible et la difficulté baisse à la place — pas de récompense.\n\nLa récompense est divisée par deux tous les 21 blocs, exactement comme le vrai Bitcoin : 50 → 25 → 12,5 → 6,25 → 3,125 → 1,5625, jusqu’à un minimum. La partie se termine une fois que la récompense du bloc est restée à ce minimum pendant un cycle complet, ou plus tôt si le leader prend une avance telle que personne d’autre ne peut le rattraper même avec tous les blocs restants. Celui qui a le plus de pièces à la fin gagne.'
  };
  const ja = {
    sa_title:'Score Arena', sa_tagline:'すべての一投。すべてのライバル。すべての結果。', sa_game:'ゲーム', sa_501:'ダーツ501', sa_cricket:'クリケット', sa_bitcoin:'ビットコインダーツ',
    sa_match:'マッチ', sa_first_to:'先取', sa_legs:'レグ', sa_rounds:'ラウンド', sa_order:'開始順', sa_lobby_order:'ロビーの順番',
    sa_manual_first:'最初のプレイヤーを選ぶ', sa_random_dice:'サイコロを振る', sa_first_player:'最初のプレイヤー', sa_ready:'準備完了 — 全員が参加したら開始してください。',
    sa_turn:'ターン', sa_remaining:'残り', sa_score:'スコア', sa_checkout:'チェックアウト', sa_no_checkout:'3本でのチェックアウトなし', sa_darts:'このターン',
    sa_submit:'ターンを保存', sa_undo:'元に戻す', sa_miss:'ミス', sa_double:'ダブル', sa_triple:'トリプル', sa_single:'シングル', sa_bull:'ブル', sa_inner_bull:'ブルズアイ',
    sa_bust:'バースト', sa_leg_won:'レグ獲得', sa_round_won:'ラウンド獲得', sa_wins:'勝利数', sa_history:'ターン履歴', sa_no_throws:'まだ投げていません',
    sa_waiting:'最初の一投を待っています…', sa_closed:'クローズ', sa_open:'オープン', sa_marks:'マーク', sa_you_enter:'ハイライトされたプレイヤーの投球を入力してください。',
    sa_winner:'マッチの勝者', sa_back:'Game Hubに戻る', sa_dice_result:'サイコロの順番', sa_need_dart:'少なくとも1本のダーツを選んでください。', sa_all_can_score:'このデバイスでは誰でもスコアを記録できます。',
    sa_targets:'ターゲット', sa_players:'プレイヤー', sa_throw_label:'投球', sa_bust_short:'BUST', sa_checkout_attempt:'チェックアウトの試み',
    sa_help:'ヘルプ', sa_ok:'OK', sa_bitcoin_block:'ブロック', sa_bitcoin_difficulty:'難易度', sa_bitcoin_reward:'報酬', sa_bitcoin_miss:'ブロックなし',
    sa_help_title_501:'ダーツ501の遊び方', sa_help_501:'各プレイヤーは501点からスタートします。各ターンで、命中した分だけ残り点数から引きます。ダブルでフィニッシュする必要があります — 0未満になる、ちょうど1になる、ダブル以外でフィニッシュするのはバーストとなり、そのターンは取り消されます。最初にダブルで0にした人がレグの勝者です。',
    sa_help_title_cricket:'クリケットの遊び方', sa_help_cricket:'20、19、18、17、16、15とブルだけが対象です。ある数字に3回命中させる（シングル・ダブル・トリプルすべてが3回にカウントされます）とその数字を「クローズ」できます。クローズ後の追加命中は、その数字と同じ点数が入りますが、少なくとも1人の相手がまだその数字をオープンにしている場合に限ります。得点でリードしながら最初に全てをクローズした人が勝ちます。',
    sa_help_title_bitcoin:'ビットコインダーツの遊び方', sa_help_bitcoin:'各ターンでは、ブロックを「採掘」するために命中させるべきターゲットがボード上にハイライトされます — 同じ3本のダーツですべてです。ハイライトされたターゲットをすべて命中させると、現在のブロック報酬が得られ、難易度が上がります。1つでも外すと、代わりに難易度が下がります — 報酬なし。\n\n報酬は本物のビットコインと同じく21ブロックごとに半減します：50 → 25 → 12.5 → 6.25 → 3.125 → 1.5625、最小値まで。ブロック報酬がその最小値のまま1サイクル続くとゲームは終了します。あるいは、リーダーが残り全ブロックを使っても誰も追いつけないほど差をつけた時点でより早く終了します。最後にコインを最も多く持っている人の勝ちです。'
  };
  const pt = {
    sa_title:'Score Arena', sa_tagline:'Cada lançamento. Cada rival. Cada resultado.', sa_game:'Jogo', sa_501:'Dardos 501', sa_cricket:'Cricket', sa_bitcoin:'Bitcoin Darts',
    sa_match:'Partida', sa_first_to:'Primeiro a', sa_legs:'legs', sa_rounds:'rodadas', sa_order:'Ordem inicial', sa_lobby_order:'Ordem da sala',
    sa_manual_first:'Escolher primeiro jogador', sa_random_dice:'Lançar os dados', sa_first_player:'Primeiro jogador', sa_ready:'Pronto — comece quando todos os jogadores entrarem.',
    sa_turn:'Turno', sa_remaining:'Restante', sa_score:'Pontos', sa_checkout:'Checkout', sa_no_checkout:'Sem checkout de três dardos', sa_darts:'Este turno',
    sa_submit:'Guardar jogada', sa_undo:'Desfazer', sa_miss:'Erro', sa_double:'Duplo', sa_triple:'Triplo', sa_single:'Simples', sa_bull:'Bull', sa_inner_bull:'Mosca',
    sa_bust:'Bust', sa_leg_won:'Leg vencida', sa_round_won:'Rodada vencida', sa_wins:'Vitórias', sa_history:'Histórico de turnos', sa_no_throws:'Ainda sem lançamentos',
    sa_waiting:'Aguardando o primeiro lançamento…', sa_closed:'Fechado', sa_open:'Aberto', sa_marks:'Marcas', sa_you_enter:'Digite o lançamento do jogador em destaque.',
    sa_winner:'Vencedor da partida', sa_back:'Voltar ao Game Hub', sa_dice_result:'Ordem dos dados', sa_need_dart:'Escolha pelo menos um dardo.', sa_all_can_score:'Qualquer jogador pode registrar a pontuação neste dispositivo.',
    sa_targets:'Alvos', sa_players:'Jogadores', sa_throw_label:'Lançamento', sa_bust_short:'BUST', sa_checkout_attempt:'Tentativa de checkout',
    sa_help:'Ajuda', sa_ok:'OK', sa_bitcoin_block:'Bloco', sa_bitcoin_difficulty:'Dificuldade', sa_bitcoin_reward:'Recompensa', sa_bitcoin_miss:'Sem bloco',
    sa_help_title_501:'Como funciona o Dardos 501', sa_help_501:'Cada jogador começa com 501 pontos. A cada turno, o que você acertar é subtraído da sua pontuação restante. Você precisa terminar num duplo — ficar abaixo de zero, acertar exatamente 1, ou terminar em algo que não seja um duplo é um bust e o turno é desfeito. O primeiro a chegar a zero num duplo vence a leg.',
    sa_help_title_cricket:'Como funciona o Cricket', sa_help_cricket:'Só contam 20, 19, 18, 17, 16, 15 e o bull. Acerte um número três vezes (simples, duplos e triplos contam para essas três) para “fechá-lo”. Depois de fechado, acertos extras somam pontos iguais ao número — mas só enquanto pelo menos um adversário ainda tiver esse número aberto. Quem fechar tudo primeiro liderando em pontos vence.',
    sa_help_title_bitcoin:'Como funciona o Bitcoin Darts', sa_help_bitcoin:'A cada turno, o tabuleiro destaca os alvos que você precisa acertar para “minerar” o bloco — todos eles, com os mesmos três dardos. Acerte cada alvo destacado e você ganha a recompensa atual do bloco; a dificuldade então aumenta. Erre algum deles e a dificuldade diminui em vez disso — sem recompensa.\n\nA recompensa é reduzida à metade a cada 21 blocos, assim como no Bitcoin real: 50 → 25 → 12,5 → 6,25 → 3,125 → 1,5625, até um mínimo. O jogo termina quando a recompensa do bloco permanece nesse mínimo por um ciclo completo, ou antes, se o líder ficar tão à frente que ninguém mais possa alcançá-lo mesmo com todos os blocos restantes. Quem tiver mais moedas no final vence.'
  };
  const ru = {
    sa_title:'Score Arena', sa_tagline:'Каждый бросок. Каждый соперник. Каждый результат.', sa_game:'Игра', sa_501:'Дартс 501', sa_cricket:'Крикет', sa_bitcoin:'Bitcoin Дартс',
    sa_match:'Матч', sa_first_to:'Первый до', sa_legs:'легов', sa_rounds:'раундов', sa_order:'Порядок старта', sa_lobby_order:'Порядок из лобби',
    sa_manual_first:'Выбрать первого игрока', sa_random_dice:'Бросить кости', sa_first_player:'Первый игрок', sa_ready:'Готово — начинайте, когда все игроки присоединятся.',
    sa_turn:'Ход', sa_remaining:'Осталось', sa_score:'Очки', sa_checkout:'Чекаут', sa_no_checkout:'Нет чекаута тремя дротиками', sa_darts:'Этот ход',
    sa_submit:'Сохранить ход', sa_undo:'Отменить', sa_miss:'Промах', sa_double:'Дабл', sa_triple:'Трипл', sa_single:'Одиночное', sa_bull:'Бул', sa_inner_bull:'Яблочко',
    sa_bust:'Перебор', sa_leg_won:'Лег выигран', sa_round_won:'Раунд выигран', sa_wins:'Победы', sa_history:'История ходов', sa_no_throws:'Бросков пока нет',
    sa_waiting:'Ожидание первого броска…', sa_closed:'Закрыто', sa_open:'Открыто', sa_marks:'Отметки', sa_you_enter:'Введите бросок выделенного игрока.',
    sa_winner:'Победитель матча', sa_back:'Назад в Game Hub', sa_dice_result:'Порядок по костям', sa_need_dart:'Выберите хотя бы один дротик.', sa_all_can_score:'Любой игрок может вести счёт с этого устройства.',
    sa_targets:'Цели', sa_players:'Игроки', sa_throw_label:'Бросок', sa_bust_short:'BUST', sa_checkout_attempt:'Попытка чекаута',
    sa_help:'Помощь', sa_ok:'ОК', sa_bitcoin_block:'Блок', sa_bitcoin_difficulty:'Сложность', sa_bitcoin_reward:'Награда', sa_bitcoin_miss:'Без блока',
    sa_help_title_501:'Как играть в Дартс 501', sa_help_501:'Каждый игрок начинает со 501 очком. Каждый ход то, что вы попали, вычитается из оставшихся очков. Нужно закончить дублем — уйти ниже нуля, попасть ровно в 1 или закончить чем-то, кроме дубля — это перебор, и ход отменяется. Кто первым доходит до нуля дублем, выигрывает лег.',
    sa_help_title_cricket:'Как играть в Крикет', sa_help_cricket:'Считаются только 20, 19, 18, 17, 16, 15 и бул. Попадите в число три раза (одиночные, дабл и трипл — всё считается к этим трём), чтобы «закрыть» его. После закрытия дальнейшие попадания приносят очки, равные числу, — но только пока хотя бы один соперник ещё не закрыл это число. Кто первым закроет всё, лидируя по очкам, побеждает.',
    sa_help_title_bitcoin:'Как играть в Bitcoin Дартс', sa_help_bitcoin:'На каждом ходу мишень подсвечивает цели, которые нужно поразить, чтобы «намайнить» блок — все сразу, теми же тремя дротиками. Попадите по каждой подсвеченной цели — и получите текущую награду за блок, сложность при этом повышается. Промахнётесь хотя бы по одной — сложность вместо этого понижается, награды нет.\n\nНаграда уменьшается вдвое каждые 21 блок, точно как в настоящем биткойне: 50 → 25 → 12,5 → 6,25 → 3,125 → 1,5625, до минимума. Игра заканчивается, как только награда за блок остаётся на этом минимуме целый цикл, либо раньше — если лидер вырывается настолько вперёд, что никто уже не сможет догнать его даже на всех оставшихся блоках. Побеждает тот, у кого в итоге больше всего монет.'
  };
  const zh = {
    sa_title:'Score Arena', sa_tagline:'每一次投掷。每一位对手。每一个结果。', sa_game:'游戏', sa_501:'飞镖501', sa_cricket:'板球飞镖', sa_bitcoin:'比特币飞镖',
    sa_match:'比赛', sa_first_to:'先达到', sa_legs:'局', sa_rounds:'局', sa_order:'开始顺序', sa_lobby_order:'大厅顺序',
    sa_manual_first:'选择第一位玩家', sa_random_dice:'掷骰子', sa_first_player:'第一位玩家', sa_ready:'准备就绪 — 所有玩家加入后即可开始。',
    sa_turn:'回合', sa_remaining:'剩余', sa_score:'得分', sa_checkout:'终局', sa_no_checkout:'没有三镖终局方案', sa_darts:'本回合',
    sa_submit:'保存回合', sa_undo:'撤销', sa_miss:'未命中', sa_double:'双倍区', sa_triple:'三倍区', sa_single:'单倍区', sa_bull:'红心外圈', sa_inner_bull:'靶心',
    sa_bust:'爆分', sa_leg_won:'赢得一局', sa_round_won:'赢得一轮', sa_wins:'胜场', sa_history:'回合记录', sa_no_throws:'还没有投掷记录',
    sa_waiting:'等待第一次投掷…', sa_closed:'已封闭', sa_open:'未封闭', sa_marks:'标记', sa_you_enter:'请输入高亮玩家的投掷结果。',
    sa_winner:'比赛获胜者', sa_back:'返回 Game Hub', sa_dice_result:'掷骰顺序', sa_need_dart:'请至少选择一支飞镖。', sa_all_can_score:'任何玩家都可以在此设备上记分。',
    sa_targets:'目标', sa_players:'玩家', sa_throw_label:'投掷', sa_bust_short:'BUST', sa_checkout_attempt:'终局尝试',
    sa_help:'帮助', sa_ok:'确定', sa_bitcoin_block:'区块', sa_bitcoin_difficulty:'难度', sa_bitcoin_reward:'奖励', sa_bitcoin_miss:'未挖出区块',
    sa_help_title_501:'飞镖501玩法说明', sa_help_501:'每位玩家从501分开始。每个回合，命中的分数会从剩余分数中扣除。必须以双倍区结束——降到零以下、恰好剩1分，或以双倍区以外的方式结束都算爆分，该回合会被撤销。最先以双倍区达到零分的玩家赢得该局。',
    sa_help_title_cricket:'板球飞镖玩法说明', sa_help_cricket:'只计算20、19、18、17、16、15和红心。命中某个数字三次（单倍、双倍、三倍都计入这三次）即可将其“封闭”。封闭后，额外命中会获得等于该数字的分数——但仅在至少还有一名对手未封闭该数字时有效。谁先在领先得分的情况下封闭所有数字，谁就获胜。',
    sa_help_title_bitcoin:'比特币飞镖玩法说明', sa_help_bitcoin:'每个回合，靶盘会高亮显示你需要命中才能“挖出”该区块的目标——必须用同样的三支飞镖全部命中。命中所有高亮目标即可获得当前的区块奖励，难度随之提升；只要有一个未命中，难度反而会下降——没有奖励。\n\n奖励每21个区块减半一次，与真实比特币完全一致：50 → 25 → 12.5 → 6.25 → 3.125 → 1.5625，直到最低值。当区块奖励保持在该最低值整整一个周期后游戏结束；如果领先者遥遥领先，即使用完所有剩余区块其他人也无法追上，则游戏会提前结束。最终拥有最多金币的玩家获胜。'
  };
  const tables={bg,de,en,es,fr,ja,'pt-BR':pt,ru,'zh-CN':zh};
  function apply(lang){const table=tables[lang]||tables.en;window._i18n=window._i18n||{};for(const key in table)window._i18n[key]=table[key]}
  apply((window.mvmOS&&window.mvmOS.lang)||'en');
  if(window.mvmOS&&window.mvmOS.onLangChange)window.mvmOS.onLangChange(apply);
  window.SCOREARENA_I18N=true;
})();
