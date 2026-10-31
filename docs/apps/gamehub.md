# Game Hub

Game Hub keeps player profiles and game results together. Open its public page from the desktop window to play under your Apps Hub account. Each profile has its own selection of games; the server owner installs the actual games through the mvmOS App Store.

## Your games and the Store

The Games tab shows the games you added. Filter by category or sort alphabetically, by most played or by recent play. The Store tab lists games available on this server, with categories and search. Add or remove a game to change your own page without deleting its results, rating or saved game. Existing profiles initially keep games they have already played; new profiles choose their games in the Store.

From Game Hub 1.17.0 on mvmOS 1.16.0, games that declare a picture icon use it in the library, game pages, history and statistics. Other games keep their emoji.

The library filters share one row, also on a phone. When you start a game while another run of it is still open, Game Hub asks whether to continue it or throw it away and start a new one; a thrown-away run is not recorded anywhere. A game continued from a saved position can tell its lobby that it is resuming, so it does not ask again for what the save already holds. Continue banners, saved games and invitations remain available from Games. A room lost during a server restart shows an explanation and a link back to Game Hub instead of reconnecting indefinitely.

On a game's page, **Start games in full screen** controls whether that game opens in browser full screen. The choice is saved for that game on the current device and starts on by default. Browsers without full-screen support do not show the option. A player joining a game already started enters full screen on the first touch or click; leaving the game exits full screen.

## Statistics and rankings

Open a game and choose Statistics. Solo and multiplayer have separate views. Each game declares the numbers it reports: choose a board, then best, average or total where that sum makes sense. Filters cover all time, the last 7 or 30 days, or the last year, and everyone, favourites or players you played with.

The page shows your position, a distribution of results, your progress against the field, records, direct comparisons and activity. Multiplayer adds an Elo rating starting at 1000; beating a stronger player earns more. Games whose scores cannot be compared between sessions can choose a win rate ranking instead.

The Ranking tab combines each game's solo and multiplayer ladders. Points depend on standing, with reduced weight until a player has five sessions and until three people share the ladder. A lone player earns no ranking points. A period filter selects the sessions considered; multiplayer ratings themselves are calculated from the full history.

The desktop Game Hub window also offers the shared statistics and overall ranking views.

## Results at the end of a game

Finished games show the all-time top 10 and your own position alongside the game actions. If you are outside the top 10, your row appears separately below them. Solo uses the game's declared primary ranking; multiplayer uses its Elo rating. The table loads after the session is saved, including when you reopen a finished room. A save-and-exit does not add an unfinished session to the ranking.

Flask Sort also tracks personal and overall records per numbered level. Sudoku and Jigsaw track completed puzzle records per difficulty. These records are independent of the final session: successfully completing a stage records it even if you save the remaining run for later. Only results completed since this feature was installed are available; earlier level scores were not stored separately.

## Profiles and comparisons

Profile totals cover the whole history. Solo games, multiplayer games and play time are counted separately; wins and win rate count multiplayer only. A table breaks these numbers down by game.

Open another player's profile for head-to-head wins, draws and losses, recent form and streaks. Choose a game to compare metrics and rating history, including a rating-based estimate for the next result. Open Game history or Games together when you want the recent sessions; those lists load on demand.

## Game integrations

Remember the Pairs reports pairs found, accuracy, best streak, timeouts and cards on the table. Belot reports deals, team contracts and points per deal. Find Yourself reports points per round, answered rounds and guess distances. Score Arena reports turns. Stonehold reports survival, kills, raids, enemy level and buildings. Tower Defense reports waves, kills and survival; Sudofall reports cleared lines, numbers dropped and points per minute from its browser session recorder. Existing solo session metadata is reused where its keys match declared metrics; unavailable older measurements are not invented.

For the manifest fields and recording API, see the [Developer Guide](../../DEVELOPER.md#statistics-say-what-you-measure-game-hub-draws-it).
