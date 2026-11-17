# Nostradamus

Nostradamus 1.3.0 is a Nostr client with encrypted identity storage and browser connections to your relays. The master password unlocks the private key in the browser. A selected unlock duration is renewed when used; leaving the vault unused for that period requires unlocking again.

## Reading and posting

Following shows the people you follow; your own posts appear on your profile. Contact and profile lookups also query indexer relays, and responsive relays can finish a list without waiting for every unavailable one. Missing quoted notes show an unavailable message rather than loading forever.

Open an image in the app's preview and close it with Escape or the close button. The repost menu offers repost or quote. The menu on your own note offers edit or delete: editing publishes a replacement and requests deletion of the old event. Relays may retain the original. Muting a person updates the Nostr mute list while preserving unrelated tags and encrypted content. Notifications highlight new activity and include the related post.

## Optional Premium integrations

The administrator can enable DeepL translation and the AI helper in the app's settings. Without the Premium module, desktop controls open the Premium prompt and public pages hide the features. Ordinary Nostr reading and publishing remain available.

DeepL uses the reader's own key configured in DeepL Translator. AI explanations, questions and comment drafts require mvmAI with a usable AI provider and its App API enabled in Apps Hub → Settings → App APIs; this switch is off by default. The administrator can set a credit price for answered messages; failed requests are refunded.

Use the sparkle menu to explain a post, ask one question or suggest a comment. Review and edit a comment draft before publishing. Each profile can choose its comment language and style. Explanations and questions appear in read-only AI history; Start a discussion creates a saved conversation in mvmAI where you can continue. Comment drafts are not stored in that history.
