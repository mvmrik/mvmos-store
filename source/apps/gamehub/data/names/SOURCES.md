# Game Hub starter name catalogue

Nine countries initially represent the nine interface languages: Bulgaria, Germany,
the United States, Spain, France, Japan, Brazil, Russia and China. These are country
name pools, not translations of a single English pool. Each country has 100 male
and 100 female given names and 100 surnames in each gender category. Countries
without gendered surnames intentionally share the same surname lists.

The catalogue combines established names selected editorially with extracts from:

* Faker Python 40.52.0 person providers: https://github.com/joke2k/faker/tree/v40.52.0/faker/providers/person
* Faker JS 10.1.0 Japanese and Chinese person data: https://github.com/faker-js/faker/tree/v10.1.0/src/locales

Both upstream MIT license notices are included in this directory. The per-country
JSON files record the relevant provider links. Editorial selections replace the
Bulgarian provider, German given names and surnames, Spanish given names and
surnames, French female given names and Russian male given names. Other pools
include editorial additions and corrections. The lists are starter selections,
not official frequency rankings or claims that names determine nationality.

Japanese native names have explicit paired readings. A kanji name can have several
valid readings; each entry selects one. Chinese Latin spellings use untoned pinyin,
with surname-specific reading corrections. Bulgarian and Russian names use separate
transliteration mappings; Latin-script names preserve their accents. Native Chinese
names are joined without a space; Japanese names use a space. Both use family name
first. Other pools use given name first. Additional naming traditions and countries
can be introduced as separate pools later.

The two English team-word pools contain 100 editorially selected words each. They
produce combinations rather than referencing a list of real teams.

Bundled defaults are read-only in the editor. Administrator additions are kept in
Game Hub's runtime database (`name_catalog_custom`), not in these JSON files, and
are combined with the defaults. No runtime dependencies on Faker, transliteration
libraries or network services are required. No existing game identities are changed.

Display spellings follow the common script policy in `../name-display.json`.
Bulgarian and Russian interfaces both support Cyrillic and Latin; Japanese supports
Japanese and Latin; Simplified Chinese supports Simplified Chinese and Latin. The
other supported interface languages use Latin. Unknown viewer languages fall back
to Latin. This is a display convention, not a claim about a person's reading skills.
`display_name(identity, lang)` applies the same policy to saved identities as the
generator applies to new ones. No country-specific game code is needed.
