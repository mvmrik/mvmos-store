# Nutrition

Nutrition 1.0.0 keeps a food journal for each Apps Hub profile. The desktop window and public web page use the same profile and records.

## Start a journal

Install Nutrition from Health & Fitness and sign in to Apps Hub. For phone access, enable its public page in Apps Hub and open `/pub/nutrition/` on your server. Each profile has its own foods, journal, goals, restrictions and meals.

Choose a day and meal, search for food and enter the portion in grams or millilitres. The journal totals calories, protein, carbohydrates, sugar, fat, saturated fat, fibre and salt. Edit an entry's portion or meal, delete it, and review recent daily history. Entries retain a snapshot of nutrient data, so editing a saved food does not rewrite previous days.

## Foods and recipes

The built-in catalogue works without online lookup and has names in all nine interface languages. Create personal foods with values per 100 grams or millilitres. Build recipes from ingredients, set portions and optionally the final cooked weight; Nutrition calculates nutrient values and a portion size.

Search Open Food Facts by product name or barcode. Camera scanning uses the browser's built-in barcode reader where it exists and a bundled open-source reader (zxing, MIT licence) in browsers that lack one, such as Safari on iPhone; nothing is recorded from the camera. Typing the barcode digits works everywhere. Online lookup requires network access; scanning also needs a supported browser, camera permission and a secure browser context. Review product data and restrictions before relying on them.

## Goals, restrictions and meals

Set a calorie range, nutrient goals and goal type. The suggestion form uses your body data, activity and selected goal to propose values. You can retain your own values instead.

Restrictions use fixed, language-independent labels for how a food is prepared (fried, grilled, baked, boiled, raw, smoked, salted) and what kind of food it is (for example processed meat, red meat, citrus, nuts and seeds, caffeine, alcohol). Each entry can be avoid, good for you, a daily limit in grams or millilitres, an allergy or an intolerance. Standard foods, Open Food Facts products and recipes carry labels, and adding a food shows a warning or a note when it matches. Entries logged before labels existed give no warnings. The History tab shows a monthly calendar with each day's macros.

Several foods can be collected in a list and confirmed together. Foods added together are stored with a shared set identifier, and the next time you add one of them Nutrition offers the others with their last amounts. Foods and recipes can be shared with other profiles.

Add allergies, intolerances and foods to avoid. The food check combines those restrictions with the day's nutrient totals and goals. Warnings depend on the food and ingredient data available; they do not verify a product's complete composition.

In Settings, rename meals, change their icons and times, add meals up to the limit of twelve, or remove them. Set an end-of-day hour from midnight to 08:00 for logging after midnight into the previous food day. Regional dates and meal times follow the mvmOS or Apps Hub display preferences.

## Health integration

Health is optional. Enable its App API in Apps Hub → Settings → App APIs; this API is off by default. Each profile can choose separately to send daily nutrient totals and goals, read body data from Health for goal suggestions, and read totals from other sources recorded through Health. Turning on a link synchronizes recent days; changes to the journal update the affected day.

## Budget reward with Premium

The server owner enables Budget rewards in Nutrition's app settings. Each profile then chooses an amount, destination categories and an optional source category. Budget must be installed with its App API enabled in Apps Hub → Settings → App APIs; this API is off by default.

When Nutrition is opened, eligible finished days from the last seven days are settled. A day earns a reward only if its calories meet the configured range with a positive lower bound. Payment uses a separate Premium module and retry keys to avoid duplicate transfers. Without the Premium build, the desktop setting opens the Premium prompt and the public page hides the reward; the food journal remains usable.

## AI help with Premium

When the owner enables AI help in the app settings and mvmAI is installed with its App API enabled, adding food offers Create with AI and Goals offers Suggest with AI. The AI's proposal is shown for review first and nothing is saved until you confirm it. It is generated from the data you entered and is not medical information. Each request is charged through the credit feature declared in the manifest, priced by the administrator in Apps Hub → Paid Apps, and refunded if the AI cannot answer. Without the Premium build the desktop control opens the Premium prompt and the public page hides it.

## App API

Enable Nutrition's App API in Apps Hub → Settings → App APIs to let other apps call it; the switch is off by default. Its functions read profiles and journals, search or check foods, add, edit and delete entries, manage custom foods and recipes, configure goals and restrictions, and manage meals. Automations and External API access use the platform's corresponding controls and the calling profile's identity.

## Availability

Requires mvmOS Core 1.17.0 or later for the shared regional time picker. Nutrition's Premium module is distributed separately from the public app archive.
